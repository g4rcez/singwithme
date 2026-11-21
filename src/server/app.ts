import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { HTMLBundle } from "bun";
import type { Difficulty, PartyState } from "../shared/types";
import { addScore, deleteSong, getSong, globalRanking, listSongs, songRanking, updateSong } from "./db";
import { importFromFile, importFromYoutube, type CommonOptions } from "./importer/pipeline";
import { getJob, listJobs, startJob } from "./jobs";
import {
  createDuo,
  currentInvite,
  dequeue,
  enqueue,
  findQueueItem,
  isInviteValid,
  join as joinParty,
  listDuos,
  listQueue,
  moveInQueue,
  ownsDuo,
  PartyError,
  publicOrigin,
  removeDuo,
  startSinging,
} from "./party";
import { CLOUD, DEMO, HOST_PIN, PUBLIC_MEDIA_DIR, songDir } from "./paths";
import { seedDemoSongs } from "./demo";
import { toolStatuses } from "./tools";

const SAFE_NAME = /^[\w-][\w.-]*$/;
const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];

const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (message: string, status = 400) => json({ error: message }, status);

/** Filled in once the server is listening; the route handlers below need it before `server` exists. */
const network = { addressOf: (_request: Request): string => "", port: 0 };

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * The host is whoever sits at the machine running the karaoke (or knows the host PIN, when one is set). Phones on the network may browse songs and
 * manage their own place in the queue, nothing else. A forwarded request came through a proxy or tunnel,
 * so its loopback address says nothing about who sent it.
 */
function isHost(request: Request): boolean {
  // With a PIN configured (always the case in the cloud, where "this machine" means nothing) the PIN decides.
  if (HOST_PIN) return request.headers.get("x-host-pin") === HOST_PIN;
  if (CLOUD || request.headers.has("x-forwarded-for")) return false;
  return LOOPBACK.has(network.addressOf(request));
}

/** Address to put in the QR code: the public URL in the cloud, the LAN address at home. */
function inviteOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (CLOUD && !process.env.PUBLIC_URL) {
    return forwardedHost ? `https://${forwardedHost}` : new URL(request.url).origin;
  }
  return publicOrigin(network.port);
}

const hostOnly = (request: Request) =>
  isHost(request) ? null : fail("Só o computador do karaokê pode fazer isso.", 403);

/** Runs a party action, turning its validation errors into HTTP responses. */
async function party(action: () => unknown): Promise<Response> {
  try {
    return json((await action()) ?? { ok: true });
  } catch (error) {
    if (error instanceof PartyError) return fail(error.message, error.status);
    throw error;
  }
}

const partyState = (request: Request): PartyState => ({
  isHost: isHost(request),
  demo: DEMO,
  pinRequired: HOST_PIN !== null,
  duos: listDuos(),
  queue: listQueue(),
});

/** Serves a media file with HTTP Range support, which <video>/<audio> need in order to seek. */
async function serveMedia(request: Request, id: string, name: string): Promise<Response> {
  if (!SAFE_NAME.test(id) || !SAFE_NAME.test(name)) return fail("Caminho inválido", 400);
  // Imported songs live in the data folder; the bundled demo songs ship with the app.
  let file = Bun.file(join(songDir(id), name));
  if (!(await file.exists())) file = Bun.file(join(PUBLIC_MEDIA_DIR, id, name));
  if (!(await file.exists())) return fail("Arquivo não encontrado", 404);

  const headers = { "Accept-Ranges": "bytes", "Content-Type": file.type };
  const range = request.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (!range || (!range[1] && !range[2])) {
    return new Response(file, { headers: { ...headers, "Content-Length": String(file.size) } });
  }
  // "bytes=-500" means the last 500 bytes.
  const start = range[1] ? Number(range[1]) : Math.max(0, file.size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1;
  if (start > end || start >= file.size) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}` } });
  }
  return new Response(file.slice(start, end + 1), {
    status: 206,
    headers: {
      ...headers,
      "Content-Range": `bytes ${start}-${end}/${file.size}`,
      "Content-Length": String(end - start + 1),
    },
  });
}

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

async function fileText(form: FormData, key: string): Promise<string | undefined> {
  const value = form.get(key);
  return value instanceof File && value.size > 0 ? value.text() : undefined;
}

async function commonOptions(form: FormData): Promise<CommonOptions> {
  return {
    title: text(form, "title"),
    artist: text(form, "artist"),
    language: text(form, "language"),
    separate: form.get("separate") === "true",
    lrc: await fileText(form, "lrc"),
    ultrastar: await fileText(form, "ultrastar"),
  };
}

/** In demo mode the library is fixed: there is no ffmpeg or durable disk to import into. */
const libraryLocked = (request: Request) =>
  hostOnly(request) ?? (DEMO ? fail("Esta é uma instância de demonstração: o acervo é fixo.", 403) : null);

/** Starts the HTTP server. `pages` are the HTML entry points Bun bundles on the fly (local runs only). */
export function startServer(pages: Record<string, HTMLBundle> = {}) {
  if (DEMO) seedDemoSongs();

  const server = Bun.serve({
    port: Number(process.env.PORT ?? 3210),
    // Reachable from the local network so phones can register and queue songs.
    hostname: process.env.HOST ?? "0.0.0.0",
    maxRequestBodySize: 2 * 1024 ** 3,
    development: process.env.NODE_ENV !== "production",
    routes: {
      ...pages,

      "/api/tools": () => json(toolStatuses()),
      "/api/ranking": () => json(globalRanking()),
      "/api/jobs": () => json(listJobs()),
      "/api/jobs/:id": (request) => {
        const job = getJob(request.params.id);
        return job ? json(job) : fail("Importação não encontrada", 404);
      },

      "/api/songs": (request) => json(listSongs(new URL(request.url).searchParams.get("q") ?? "")),
      "/api/songs/:id": {
        GET: (request) => {
          const song = getSong(request.params.id);
          return song ? json(song) : fail("Música não encontrada", 404);
        },
        PATCH: async (request) => {
          const denied = hostOnly(request);
          if (denied) return denied;
          const body = (await request.json()) as { title?: unknown; artist?: unknown; lyricsOffset?: unknown };
          if (!getSong(request.params.id)) return fail("Música não encontrada", 404);
          updateSong(request.params.id, {
            title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : undefined,
            artist: typeof body.artist === "string" && body.artist.trim() ? body.artist.trim() : undefined,
            lyricsOffset:
              typeof body.lyricsOffset === "number" && Number.isFinite(body.lyricsOffset)
                ? body.lyricsOffset
                : undefined,
          });
          return json(getSong(request.params.id));
        },
        DELETE: async (request) => {
          const denied = libraryLocked(request);
          if (denied) return denied;
          const { id } = request.params;
          if (!SAFE_NAME.test(id)) return fail("Identificador inválido");
          deleteSong(id);
          await rm(songDir(id), { recursive: true, force: true });
          return json({ ok: true });
        },
      },
      "/api/songs/:id/scores": {
        GET: (request) => json(songRanking(request.params.id)),
        POST: async (request) => {
          const denied = hostOnly(request);
          if (denied) return denied;
          const body = (await request.json()) as Record<string, unknown>;
          const player = typeof body.player === "string" ? body.player.trim().slice(0, 24) : "";
          const score = Number(body.score);
          const accuracy = Number(body.accuracy);
          const difficulty = body.difficulty as Difficulty;
          if (!player) return fail("Informe o nome do cantor.");
          if (!Number.isInteger(score) || score < 0 || score > 10000) return fail("Pontuação inválida.");
          if (!(accuracy >= 0 && accuracy <= 1)) return fail("Precisão inválida.");
          if (!DIFFICULTIES.includes(difficulty)) return fail("Dificuldade inválida.");
          if (!getSong(request.params.id)) return fail("Música não encontrada", 404);
          const entry = addScore({ songId: request.params.id, player, score, accuracy, difficulty });
          return json({ entry, ranking: songRanking(request.params.id) }, 201);
        },
      },

      "/api/import/youtube": {
        POST: async (request) => {
          const denied = libraryLocked(request);
          if (denied) return denied;
          const form = await request.formData();
          const url = text(form, "url");
          if (!url || !/^https?:\/\//i.test(url)) return fail("Informe o link do vídeo.");
          const options = { ...(await commonOptions(form)), url, audioOnly: form.get("audioOnly") === "true" };
          return json(
            startJob(options.title ?? url, (job) => importFromYoutube(options, job)),
            202,
          );
        },
      },
      "/api/import/file": {
        POST: async (request) => {
          const denied = libraryLocked(request);
          if (denied) return denied;
          const form = await request.formData();
          const media = form.get("media");
          if (!(media instanceof File) || media.size === 0) return fail("Envie o arquivo de áudio ou vídeo.");
          const options = { ...(await commonOptions(form)), media };
          return json(
            startJob(options.title ?? media.name, (job) => importFromFile(options, job)),
            202,
          );
        },
      },

      "/api/party": (request) => json(partyState(request)),
      "/api/party/invite": (request) => hostOnly(request) ?? json(currentInvite(inviteOrigin(request))),
      "/api/party/invite/:token": (request) => json({ valid: isInviteValid(request.params.token) }),
      "/api/party/join": {
        POST: (request) =>
          party(async () => {
            const body = (await request.json()) as { token?: unknown; members?: unknown };
            return joinParty(body.token, body.members);
          }),
      },
      "/api/party/duos": {
        POST: (request) =>
          hostOnly(request) ??
          party(async () => createDuo(((await request.json()) as { members?: unknown }).members).duo),
      },
      "/api/party/duos/:id": {
        DELETE: (request) => hostOnly(request) ?? party(() => removeDuo(request.params.id)),
      },
      "/api/party/queue": {
        POST: (request) =>
          party(async () => {
            const body = (await request.json()) as { songId?: unknown; duoId?: unknown };
            const duoId = String(body.duoId ?? "");
            if (!isHost(request) && !ownsDuo(duoId, request.headers.get("x-duo-secret"))) {
              throw new PartyError("Você só pode colocar a sua própria dupla na fila.", 403);
            }
            const song = getSong(String(body.songId ?? ""));
            if (!song) throw new PartyError("Música não encontrada.", 404);
            return enqueue(song, duoId);
          }),
      },
      "/api/party/queue/:id": {
        DELETE: (request) =>
          party(() => {
            const item = findQueueItem(request.params.id);
            if (item && !isHost(request) && !ownsDuo(item.duoId, request.headers.get("x-duo-secret"))) {
              throw new PartyError("Você só pode tirar a sua própria dupla da fila.", 403);
            }
            dequeue(request.params.id);
          }),
      },
      "/api/party/queue/:id/start": {
        POST: (request) => hostOnly(request) ?? party(() => startSinging(request.params.id)),
      },
      "/api/party/queue/:id/move": {
        POST: (request) =>
          hostOnly(request) ??
          party(async () => {
            const { direction } = (await request.json()) as { direction?: unknown };
            moveInQueue(request.params.id, direction === "up" ? -1 : 1);
          }),
      },

      "/media/:id/:file": (request) => serveMedia(request, request.params.id, request.params.file),
    },
    fetch: () => fail("Não encontrado", 404),
  });

  network.addressOf = (request) => server.requestIP(request)?.address ?? "";
  network.port = server.port ?? 3210;

  if (!CLOUD) {
    console.log(`SingWithMe rodando em http://localhost:${network.port}`);
    console.log(`Celulares na mesma rede: ${publicOrigin(network.port)}`);
  }
  return server;
}

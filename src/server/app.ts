import { rm } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import type { BunRequest, HTMLBundle } from "bun";
import type { Difficulty, EventStatus, Invite, Me } from "../shared/types";
import { auth, AUTH_MODE, currentUser, LOCAL_USER, migrateAuth, SIGN_IN_METHODS } from "./auth";
import { deleteSong, getSong, listSongs, migrate, updateSong } from "./db";
import { seedDemoSongs } from "./demo";
import { HttpError } from "./errors";
import { importFromFile, importFromYoutube, type CommonOptions } from "./importer/pipeline";
import { getJob, startJob } from "./jobs";
import { CLOUD, DEMO, HOST_PIN, PUBLIC_DIR, PUBLIC_MEDIA_DIR, songDir } from "./paths";
import {
  addPerformance,
  createDuo,
  createEvent,
  createGroup,
  currentInvite,
  dequeue,
  enqueue,
  eventHistory,
  eventState,
  findDuo,
  findInvite,
  findQueueItem,
  getEvent,
  groupHistory,
  groupRanking,
  isMember,
  join as joinEvent,
  listGroups,
  moveInQueue,
  removeDuo,
  setEventStatus,
  startSinging,
} from "./store";
import { toolStatuses } from "./tools";

const SAFE_NAME = /^[\w-][\w.-]*$/;
const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];

const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (message: string, status = 400) => json({ error: message }, status);

/** Filled in once the server is listening; the route handlers below need it before `server` exists. */
const network = { addressOf: (_request: Request): string => "", port: 0 };

/** One-time start-up work (schema, demo songs), awaited by every request so a cold start never races it. */
let ready: Promise<void> | null = null;
const prepare = () =>
  (ready ??= Promise.all([migrate(), migrateAuth()]).then(() => (DEMO ? seedDemoSongs() : undefined)));

type Handler = (request: Request, params: Record<string, string>) => unknown;

/** Wraps a handler: waits for start-up, serialises the result and turns HttpErrors into responses. */
const route = (handler: Handler) => async (request: Request) => {
  try {
    await prepare();
    const result = await handler(request, (request as BunRequest).params ?? {});
    return result instanceof Response ? result : json(result ?? { ok: true });
  } catch (error) {
    if (error instanceof HttpError) return fail(error.message, error.status);
    console.error(error);
    return fail("Erro interno. Tente de novo.", 500);
  }
};

const body = async (request: Request) => ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

// ---------------------------------------------------------------- who is asking

const userOf = (request: Request) => currentUser(request, network.addressOf(request));

async function signedIn(request: Request): Promise<string> {
  const user = await userOf(request);
  if (!user) throw new HttpError("Entre na sua conta para continuar.", 401);
  return user;
}

/** The signed-in member of a group, or an error. Members run the group's events and library. */
async function memberOf(request: Request, groupId: string): Promise<string> {
  const user = await signedIn(request);
  if (!(await isMember(groupId, user))) throw new HttpError("Você não faz parte deste grupo.", 403);
  return user;
}

async function isHostOf(request: Request, groupId: string): Promise<boolean> {
  const user = await userOf(request);
  return user !== null && (await isMember(groupId, user));
}

/** The event, after checking that the request comes from a member of its group. */
async function hostedEvent(request: Request, eventId: string) {
  const event = await getEvent(eventId);
  await memberOf(request, event.groupId);
  return event;
}

/** Phones prove which duo they are with the secret they received when registering. */
async function ownsDuo(request: Request, duoId: string): Promise<boolean> {
  const secret = request.headers.get("x-duo-secret");
  return secret !== null && (await findDuo(duoId))?.secret === secret;
}

function libraryUnlocked(): void {
  if (DEMO) throw new HttpError("Esta é uma instância de demonstração: o acervo é fixo.", 403);
}

/** The app's public address, as it must appear in QR codes. */
function appOrigin(request: Request): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) return `https://${forwardedHost}`;
  if (CLOUD) return new URL(request.url).origin;
  return lanOrigin(network.port);
}

/** Address phones on the same Wi-Fi can reach. */
function lanOrigin(port: number): string {
  const address = Object.values(networkInterfaces())
    .flat()
    .find((candidate) => candidate?.family === "IPv4" && !candidate.internal);
  return `http://${address?.address ?? "localhost"}:${port}`;
}

// ---------------------------------------------------------------- media and uploads

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

/** Serves the prebuilt interface from disk, for deployments where nothing else serves static files. */
async function serveStatic(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method !== "GET" || pathname.includes("..")) return fail("Não encontrado", 404);
  const file = Bun.file(join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname));
  if (!(await file.exists())) return fail("Não encontrado", 404);
  // Asset names carry a content hash, so they can be cached forever; the page itself must stay fresh.
  const cache = pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
  return new Response(file, { headers: { "Cache-Control": cache } });
}

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

async function fileText(form: FormData, key: string): Promise<string | undefined> {
  const value = form.get(key);
  return value instanceof File && value.size > 0 ? value.text() : undefined;
}

async function commonOptions(form: FormData, groupId: string): Promise<CommonOptions> {
  return {
    groupId,
    title: text(form, "title"),
    artist: text(form, "artist"),
    language: text(form, "language"),
    separate: form.get("separate") === "true",
    lrc: await fileText(form, "lrc"),
    ultrastar: await fileText(form, "ultrastar"),
  };
}

// ---------------------------------------------------------------- server

/** Starts the HTTP server. `pages` are the HTML entry points Bun bundles on the fly (local runs only). */
export function startServer(pages: Record<string, HTMLBundle> = {}) {
  const server = Bun.serve({
    port: Number(process.env.PORT ?? 3210),
    // Reachable from the local network so phones can register and queue songs.
    hostname: process.env.HOST ?? "0.0.0.0",
    maxRequestBodySize: 2 * 1024 ** 3,
    development: process.env.NODE_ENV !== "production" && !CLOUD,
    routes: {
      ...pages,

      // ---- account
      "/api/me": route(async (request): Promise<Me> => {
        const user = await userOf(request);
        return {
          user: user ? { email: user } : null,
          auth: AUTH_MODE,
          methods: SIGN_IN_METHODS,
          pinRequired: HOST_PIN !== null,
          demo: DEMO,
        };
      }),
      // Sign-in, sign-out, OAuth callbacks and sessions are served by Better Auth itself.
      "/api/auth/*": async (request: Request) => {
        if (!auth) return fail("Esta instalação não usa contas.", 404);
        await prepare();
        return auth.handler(request);
      },

      // ---- groups
      "/api/groups": {
        GET: route(async (request) => {
          const user = await signedIn(request);
          const groups = await listGroups(user);
          // Offline there is exactly one person, so the first group creates itself.
          if (!groups.length && user === LOCAL_USER) return [await createGroup("Meu karaokê", user)];
          return groups;
        }),
        POST: route(async (request) => {
          const user = await signedIn(request);
          return createGroup((await body(request)).name, user);
        }),
      },
      "/api/groups/:id/events": {
        POST: route(async (request, { id }) => {
          await memberOf(request, id!);
          return createEvent(id!, (await body(request)).name);
        }),
      },
      "/api/groups/:id/history": route(async (request, { id }) => {
        await memberOf(request, id!);
        return groupHistory(id!);
      }),
      "/api/groups/:id/ranking": route(async (request, { id }) => {
        await memberOf(request, id!);
        return groupRanking(id!);
      }),

      // ---- events
      "/api/events/:id": {
        // Anyone holding the (unguessable) event id may follow it: that is how phones see the queue.
        GET: route(async (request, { id }) => {
          const event = await getEvent(id!);
          return eventState(id!, await isHostOf(request, event.groupId));
        }),
        PATCH: route(async (request, { id }) => {
          await hostedEvent(request, id!);
          const { status } = await body(request);
          if (status !== "open" && status !== "closed") throw new HttpError("Situação inválida.");
          await setEventStatus(id!, status as EventStatus);
        }),
      },
      "/api/events/:id/history": route(async (request, { id }) => {
        await hostedEvent(request, id!);
        return eventHistory(id!);
      }),
      "/api/events/:id/songs": route(async (request, { id }) => {
        const event = await getEvent(id!);
        return listSongs(event.groupId, new URL(request.url).searchParams.get("q") ?? "");
      }),
      "/api/events/:id/songs/:songId": {
        GET: route(async (request, { id, songId }) => {
          const event = await hostedEvent(request, id!);
          const song = await getSong(songId!);
          if (!song || (song.groupId !== null && song.groupId !== event.groupId)) {
            throw new HttpError("Música não encontrada.", 404);
          }
          return song;
        }),
        PATCH: route(async (request, { id, songId }) => {
          const event = await hostedEvent(request, id!);
          const song = await getSong(songId!);
          if (!song) throw new HttpError("Música não encontrada.", 404);
          if (song.groupId !== event.groupId)
            throw new HttpError("Músicas compartilhadas não podem ser alteradas.", 403);
          const patch = await body(request);
          await updateSong(songId!, {
            title: typeof patch.title === "string" && patch.title.trim() ? patch.title.trim() : undefined,
            artist: typeof patch.artist === "string" && patch.artist.trim() ? patch.artist.trim() : undefined,
            lyricsOffset:
              typeof patch.lyricsOffset === "number" && Number.isFinite(patch.lyricsOffset)
                ? patch.lyricsOffset
                : undefined,
          });
        }),
        DELETE: route(async (request, { id, songId }) => {
          libraryUnlocked();
          const event = await hostedEvent(request, id!);
          const song = await getSong(songId!);
          if (!song || song.groupId !== event.groupId) throw new HttpError("Música não encontrada.", 404);
          await deleteSong(songId!);
          if (SAFE_NAME.test(songId!)) await rm(songDir(songId!), { recursive: true, force: true });
        }),
      },
      "/api/events/:id/songs/:songId/ranking": route(async (request, { id, songId }) => {
        const event = await hostedEvent(request, id!);
        return groupRanking(event.groupId, songId!, 50);
      }),
      "/api/events/:id/performances": {
        POST: route(async (request, { id }) => {
          const event = await hostedEvent(request, id!);
          const entry = await body(request);
          const singer = typeof entry.singer === "string" ? entry.singer.trim().slice(0, 60) : "";
          const score = Number(entry.score);
          const accuracy = Number(entry.accuracy);
          const difficulty = entry.difficulty as Difficulty;
          if (!singer) throw new HttpError("Informe quem cantou.");
          if (!Number.isInteger(score) || score < 0 || score > 10000) throw new HttpError("Pontuação inválida.");
          if (!(accuracy >= 0 && accuracy <= 1)) throw new HttpError("Precisão inválida.");
          if (!DIFFICULTIES.includes(difficulty)) throw new HttpError("Dificuldade inválida.");
          const songId = String(entry.songId ?? "");
          const performanceId = await addPerformance({ eventId: id!, songId, singer, score, accuracy, difficulty });
          return { id: performanceId, ranking: await groupRanking(event.groupId, songId, 50) };
        }),
      },

      // ---- duos and QR code invites
      "/api/events/:id/invite": route(async (request, { id }): Promise<Invite> => {
        await hostedEvent(request, id!);
        const token = await currentInvite(id!);
        return { token, url: `${appOrigin(request)}/#/join/${token}` };
      }),
      "/api/invites/:token": route(async (_request, { token }) => {
        const invite = await findInvite(token!);
        return { valid: invite !== null, eventName: invite?.eventName ?? null };
      }),
      "/api/join": {
        POST: route(async (request) => {
          const { token, members } = await body(request);
          return joinEvent(token, members);
        }),
      },
      "/api/events/:id/duos": {
        POST: route(async (request, { id }) => {
          await hostedEvent(request, id!);
          return (await createDuo(id!, (await body(request)).members)).duo;
        }),
      },
      "/api/duos/:id": {
        DELETE: route(async (request, { id }) => {
          const duo = await findDuo(id!);
          if (!duo) return;
          await hostedEvent(request, duo.eventId);
          await removeDuo(id!);
        }),
      },

      // ---- queue
      "/api/events/:id/queue": {
        POST: route(async (request, { id }) => {
          const event = await getEvent(id!);
          const { songId, duoId } = await body(request);
          if (!(await isHostOf(request, event.groupId)) && !(await ownsDuo(request, String(duoId ?? "")))) {
            throw new HttpError("Você só pode colocar a sua própria dupla na fila.", 403);
          }
          await enqueue(id!, String(songId ?? ""), String(duoId ?? ""));
        }),
      },
      "/api/queue/:id": {
        DELETE: route(async (request, { id }) => {
          const item = await findQueueItem(id!);
          if (!item) return;
          const event = await getEvent(item.eventId);
          if (!(await isHostOf(request, event.groupId)) && !(await ownsDuo(request, item.duoId))) {
            throw new HttpError("Você só pode tirar a sua própria dupla da fila.", 403);
          }
          await dequeue(id!);
        }),
      },
      "/api/queue/:id/start": {
        POST: route(async (request, { id }) => {
          const item = await findQueueItem(id!);
          if (!item) throw new HttpError("Este item não está mais na fila.", 404);
          await hostedEvent(request, item.eventId);
          await startSinging(id!);
        }),
      },
      "/api/queue/:id/move": {
        POST: route(async (request, { id }) => {
          const item = await findQueueItem(id!);
          if (!item) return;
          await hostedEvent(request, item.eventId);
          await moveInQueue(id!, (await body(request)).direction === "up" ? -1 : 1);
        }),
      },

      // ---- importing (needs ffmpeg and a real disk, so never in demo mode)
      "/api/tools": route(() => toolStatuses()),
      "/api/jobs/:id": route(async (request, { id }) => {
        await signedIn(request);
        const job = getJob(id!);
        if (!job) throw new HttpError("Importação não encontrada.", 404);
        return job;
      }),
      "/api/groups/:id/import/youtube": {
        POST: route(async (request, { id }) => {
          libraryUnlocked();
          await memberOf(request, id!);
          const form = await request.formData();
          const url = text(form, "url");
          if (!url || !/^https?:\/\//i.test(url)) throw new HttpError("Informe o link do vídeo.");
          const options = { ...(await commonOptions(form, id!)), url, audioOnly: form.get("audioOnly") === "true" };
          return startJob(options.title ?? url, (job) => importFromYoutube(options, job));
        }),
      },
      "/api/groups/:id/import/file": {
        POST: route(async (request, { id }) => {
          libraryUnlocked();
          await memberOf(request, id!);
          const form = await request.formData();
          const media = form.get("media");
          if (!(media instanceof File) || media.size === 0) throw new HttpError("Envie o arquivo de áudio ou vídeo.");
          const options = { ...(await commonOptions(form, id!)), media };
          return startJob(options.title ?? media.name, (job) => importFromFile(options, job));
        }),
      },

      "/media/:id/:file": (request) => serveMedia(request, request.params.id, request.params.file),
    },
    fetch: (request) => (CLOUD ? serveStatic(request) : fail("Não encontrado", 404)),
  });

  network.addressOf = (request) => server.requestIP(request)?.address ?? "";
  network.port = server.port ?? 3210;

  if (!CLOUD) {
    console.log(`SingWithMe rodando em http://localhost:${network.port}`);
    console.log(`Celulares na mesma rede: ${lanOrigin(network.port)}`);
  }
  return server;
}

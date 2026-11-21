import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Difficulty } from "../shared/types";
import app from "../web/index.html";
import { addScore, deleteSong, getSong, globalRanking, listSongs, songRanking, updateSong } from "./db";
import { importFromFile, importFromYoutube, type CommonOptions } from "./importer/pipeline";
import { getJob, listJobs, startJob } from "./jobs";
import { songDir } from "./paths";
import { toolStatuses } from "./tools";

const SAFE_NAME = /^[\w-][\w.-]*$/;
const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];

const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (message: string, status = 400) => json({ error: message }, status);

/** Serves a media file with HTTP Range support, which <video>/<audio> need in order to seek. */
async function serveMedia(request: Request, id: string, name: string): Promise<Response> {
  if (!SAFE_NAME.test(id) || !SAFE_NAME.test(name)) return fail("Caminho inválido", 400);
  const file = Bun.file(join(songDir(id), name));
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

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3210),
  // Local by default: the microphone only works on a secure context, and localhost is one.
  hostname: process.env.HOST ?? "127.0.0.1",
  maxRequestBodySize: 2 * 1024 ** 3,
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": app,

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
        const body = (await request.json()) as { title?: unknown; artist?: unknown; lyricsOffset?: unknown };
        if (!getSong(request.params.id)) return fail("Música não encontrada", 404);
        updateSong(request.params.id, {
          title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : undefined,
          artist: typeof body.artist === "string" && body.artist.trim() ? body.artist.trim() : undefined,
          lyricsOffset:
            typeof body.lyricsOffset === "number" && Number.isFinite(body.lyricsOffset) ? body.lyricsOffset : undefined,
        });
        return json(getSong(request.params.id));
      },
      DELETE: async (request) => {
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
        const form = await request.formData();
        const url = text(form, "url");
        if (!url || !/^https?:\/\//i.test(url)) return fail("Informe o link do vídeo.");
        const options = { ...(await commonOptions(form)), url, audioOnly: form.get("audioOnly") === "true" };
        return json(startJob(options.title ?? url, (job) => importFromYoutube(options, job)), 202);
      },
    },
    "/api/import/file": {
      POST: async (request) => {
        const form = await request.formData();
        const media = form.get("media");
        if (!(media instanceof File) || media.size === 0) return fail("Envie o arquivo de áudio ou vídeo.");
        const options = { ...(await commonOptions(form)), media };
        return json(startJob(options.title ?? media.name, (job) => importFromFile(options, job)), 202);
      },
    },

    "/media/:id/:file": (request) => serveMedia(request, request.params.id, request.params.file),
  },
  fetch: () => fail("Não encontrado", 404),
});

console.log(`SingWithMe rodando em ${server.url}`);

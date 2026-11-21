import { mkdir, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { parseLrc } from "../../shared/lyrics";
import type { Line, LyricsSource, Melody, Note, SongSource } from "../../shared/types";
import { parseUltraStar } from "../../shared/ultrastar";
import { saveSong } from "../db";
import type { JobHandle } from "../jobs";
import { songDir } from "../paths";
import { findTool } from "../tools";
import { extractMelody, probe, separateVocals } from "./audio";
import { findSyncedLyrics } from "./lrclib";
import { transcribe } from "./whisper";
import { download, downloadSubtitles, fetchInfo } from "./youtube";

interface Chart {
  lines: Line[];
  notes: Note[];
  lyricsSource: LyricsSource;
}

interface FinishRequest {
  id: string;
  mediaFile: string;
  source: SongSource;
  title: string;
  artist: string;
  language: string | null;
  separate: boolean;
  /** Lyrics the user supplied; when absent they are searched for and, failing that, transcribed. */
  chart: Chart | null;
  /** Extra lyric source tried after LRCLIB and before Whisper. */
  subtitles?: () => Promise<Line[] | null>;
}

/** Everything that happens once the media file is on disk: stems, lyrics, reference melody, database. */
async function finishImport(request: FinishRequest, job: JobHandle): Promise<string> {
  const dir = songDir(request.id);
  const media = join(dir, request.mediaFile);

  job.step("Analisando a mídia");
  const { duration, hasVideo } = await probe(media);

  let vocals: string | null = null;
  let instrumentalFile: string | null = null;
  if (request.separate) {
    job.step("Separando a voz do instrumental (demucs)");
    const stems = await separateVocals(media, dir, (line) => job.log(line));
    vocals = stems.vocals;
    instrumentalFile = "instrumental.mp3";
  }

  let chart = request.chart;
  let language = request.language;
  if (!chart) {
    job.step("Procurando letra sincronizada no LRCLIB");
    const match = await findSyncedLyrics(request.title, request.artist, duration);
    if (match?.tight) chart = { lines: match.lines, notes: [], lyricsSource: "lrclib" };

    if (!chart && request.subtitles) {
      job.step("Procurando legendas no vídeo");
      const lines = await request.subtitles();
      if (lines) chart = { lines, notes: [], lyricsSource: "youtube-subs" };
    }
    if (!chart && findTool("whisper")) {
      job.step("Transcrevendo a letra com Whisper (pode demorar)");
      const result = await transcribe(vocals ?? media, join(dir, "whisper"), language, (line) => job.log(line));
      language ??= result.language;
      if (result.lines.length) chart = { lines: result.lines, notes: [], lyricsSource: "whisper" };
    }
    if (!chart && match) {
      job.log(
        `Usando letra do LRCLIB de uma gravação ${match.durationGap.toFixed(0)}s diferente: ajuste o atraso da letra no player.`,
      );
      chart = { lines: match.lines, notes: [], lyricsSource: "lrclib-loose" };
    }
    if (!chart) {
      throw new Error(
        "Nenhuma letra encontrada. Instale o Whisper para transcrever offline (pip install whisper-ctranslate2) ou envie um arquivo .lrc.",
      );
    }
  }

  let melody: Melody | null = null;
  if (!chart.notes.length) {
    job.step("Estimando a melodia de referência");
    melody = await extractMelody(vocals ?? media);
  }

  saveSong({
    id: request.id,
    title: request.title,
    artist: request.artist,
    language,
    duration,
    source: request.source,
    lyricsSource: chart.lyricsSource,
    mediaFile: request.mediaFile,
    instrumentalFile,
    hasVideo,
    lines: chart.lines,
    notes: chart.notes,
    melody,
  });
  return request.id;
}

/** Removes the half-imported folder when anything goes wrong, so failed imports leave nothing behind. */
async function inFreshDir(id: string, work: (dir: string) => Promise<string>): Promise<string> {
  const dir = songDir(id);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  try {
    return await work(dir);
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

function chartFromText(text: string, kind: "lrc" | "ultrastar"): Chart {
  if (kind === "ultrastar") {
    const parsed = parseUltraStar(text);
    return { lines: parsed.lines, notes: parsed.notes, lyricsSource: "ultrastar" };
  }
  const lines = parseLrc(text);
  if (!lines.length) throw new Error("O arquivo .lrc não tem nenhuma linha com marcação de tempo.");
  return { lines, notes: [], lyricsSource: "lrc" };
}

export interface CommonOptions {
  title?: string;
  artist?: string;
  language?: string;
  separate: boolean;
  /** Optional lyrics/chart file contents. */
  lrc?: string;
  ultrastar?: string;
}

function suppliedChart(options: CommonOptions): Chart | null {
  if (options.ultrastar) return chartFromText(options.ultrastar, "ultrastar");
  if (options.lrc) return chartFromText(options.lrc, "lrc");
  return null;
}

export interface YoutubeOptions extends CommonOptions {
  url: string;
  audioOnly: boolean;
}

export async function importFromYoutube(options: YoutubeOptions, job: JobHandle): Promise<string> {
  // Parse first: a broken chart should fail before a long download.
  const chart = suppliedChart(options);
  const header = options.ultrastar ? parseUltraStar(options.ultrastar) : null;

  job.step("Lendo informações do vídeo");
  const info = await fetchInfo(options.url);
  const id = `yt-${info.id.replace(/[^\w-]/g, "")}`;

  return inFreshDir(id, async (dir) => {
    job.step("Baixando do YouTube", 0);
    const mediaFile = await download(
      options.url,
      dir,
      options.audioOnly,
      (fraction) => job.progress(fraction),
      (line) => job.log(line),
    );
    return finishImport(
      {
        id,
        mediaFile,
        source: "youtube",
        title: options.title || header?.title || info.title,
        artist: options.artist || header?.artist || info.artist,
        language: options.language || header?.language || info.language,
        separate: options.separate,
        chart,
        subtitles: () => downloadSubtitles(options.url, dir, info),
      },
      job,
    );
  });
}

export interface FileOptions extends CommonOptions {
  media: File;
}

export async function importFromFile(options: FileOptions, job: JobHandle): Promise<string> {
  const chart = suppliedChart(options);
  const header = options.ultrastar ? parseUltraStar(options.ultrastar) : null;
  const id = `local-${crypto.randomUUID().slice(0, 8)}`;
  const extension = extname(options.media.name).toLowerCase().replace(/[^.\w]/g, "") || ".bin";
  const fallbackTitle = options.media.name.replace(/\.[^.]+$/, "");

  return inFreshDir(id, async (dir) => {
    job.step("Copiando o arquivo");
    const mediaFile = `media${extension}`;
    await Bun.write(join(dir, mediaFile), options.media);
    return finishImport(
      {
        id,
        mediaFile,
        source: header ? "ultrastar" : "local",
        title: options.title || header?.title || fallbackTitle,
        artist: options.artist || header?.artist || "Desconhecido",
        language: options.language || header?.language || null,
        separate: options.separate,
        chart,
      },
      job,
    );
  });
}

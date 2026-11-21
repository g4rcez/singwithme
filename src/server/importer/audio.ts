import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { detectPitch, hzToMidi, smoothContour } from "../../shared/pitch";
import { SLOT_SECONDS } from "../../shared/scoring";
import type { Melody } from "../../shared/types";
import { requireTool, run } from "../tools";

export interface MediaInfo {
  duration: number;
  hasVideo: boolean;
}

export async function probe(file: string): Promise<MediaInfo> {
  const ffprobe = requireTool("ffprobe");
  const output = await run([
    ffprobe,
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,codec_name:stream_disposition=attached_pic",
    "-of",
    "json",
    file,
  ]).catch(() => {
    throw new Error("O arquivo enviado não é um áudio ou vídeo que o ffmpeg consiga ler.");
  });
  const info = JSON.parse(output) as {
    format?: { duration?: string };
    streams?: { codec_type: string; disposition?: { attached_pic?: number } }[];
  };
  const duration = Number(info.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Não foi possível ler a duração da mídia.");
  if (!info.streams?.some((stream) => stream.codec_type === "audio")) throw new Error("A mídia não tem trilha de áudio.");
  // Cover art embedded in audio files shows up as a video stream; it does not count.
  const hasVideo = info.streams.some((stream) => stream.codec_type === "video" && !stream.disposition?.attached_pic);
  return { duration, hasVideo };
}

const SAMPLE_RATE = 16_000;
const FRAME = 1024;
const HOP = Math.round(SAMPLE_RATE * SLOT_SECONDS);

/**
 * Estimates the sung melody of a recording: decodes it to mono PCM limited to the vocal range and runs a
 * pitch tracker over it. Works best on an isolated vocal stem; on a full mix it is only an approximation.
 */
export async function extractMelody(file: string): Promise<Melody> {
  const child = Bun.spawn(
    [
      requireTool("ffmpeg"),
      "-v",
      "error",
      "-i",
      file,
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-af",
      "highpass=f=90,lowpass=f=1100",
      "-f",
      "f32le",
      "-",
    ],
    { stdout: "pipe", stderr: "pipe", stdin: "ignore" },
  );
  const [buffer, stderr, code] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`ffmpeg falhou ao decodificar o áudio: ${stderr.trim().slice(-300)}`);

  const samples = new Float32Array(buffer, 0, Math.floor(buffer.byteLength / 4));
  const pitches: (number | null)[] = [];
  // Frame i is centred on i * HOP so that frame index and scoring slot share the same clock.
  for (let centre = 0; centre < samples.length; centre += HOP) {
    const begin = centre - FRAME / 2;
    if (begin < 0 || begin + FRAME > samples.length) {
      pitches.push(null);
      continue;
    }
    const hz = detectPitch(samples.subarray(begin, begin + FRAME), SAMPLE_RATE, {
      minHz: 80,
      maxHz: 1000,
      threshold: 0.2,
      minRms: 0.015,
    });
    pitches.push(hz === null ? null : Math.round(hzToMidi(hz) * 10) / 10);
  }
  return { hop: HOP / SAMPLE_RATE, pitches: smoothContour(pitches) };
}

export interface Stems {
  vocals: string;
  instrumental: string;
}

/** Splits a recording into vocals and accompaniment with Demucs. Slow, so it is opt-in. */
export async function separateVocals(file: string, dir: string, onLine: (line: string) => void): Promise<Stems> {
  const output = join(dir, "stems");
  await run([requireTool("demucs"), "--two-stems", "vocals", "--mp3", "-o", output, file], { onLine });
  const found = (await readdir(output, { recursive: true })).map((entry) => join(output, entry));
  const vocals = found.find((path) => /[\\/]vocals\.mp3$/.test(path));
  const instrumental = found.find((path) => /[\\/]no_vocals\.mp3$/.test(path));
  if (!vocals || !instrumental) throw new Error("O demucs terminou sem gerar as trilhas separadas.");
  await Bun.write(join(dir, "vocals.mp3"), Bun.file(vocals));
  await Bun.write(join(dir, "instrumental.mp3"), Bun.file(instrumental));
  return { vocals: join(dir, "vocals.mp3"), instrumental: join(dir, "instrumental.mp3") };
}

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseVtt } from "../../shared/lyrics";
import { guessTrack } from "../../shared/titles";
import type { Line } from "../../shared/types";
import { requireTool, run } from "../tools";

export interface VideoInfo {
  id: string;
  title: string;
  artist: string;
  language: string | null;
  duration: number;
  /** Languages that have subtitles written by a human (auto-captions are ignored: Whisper does better). */
  subtitleLanguages: string[];
}

interface RawInfo {
  id: string;
  title: string;
  track?: string;
  artist?: string;
  uploader?: string;
  duration?: number;
  language?: string;
  subtitles?: Record<string, unknown>;
}

export async function fetchInfo(url: string): Promise<VideoInfo> {
  const raw = JSON.parse(await run([requireTool("yt-dlp"), "-J", "--no-playlist", "--no-warnings", url])) as RawInfo;
  const guess = guessTrack(raw.title, raw.uploader);
  return {
    id: raw.id,
    // "track"/"artist" only exist when YouTube knows the recording; they beat any title parsing.
    title: raw.track ?? guess.title,
    artist: raw.artist?.split(",")[0]?.trim() ?? guess.artist,
    language: raw.language ?? null,
    duration: raw.duration ?? 0,
    subtitleLanguages: Object.keys(raw.subtitles ?? {}).filter((code) => code !== "live_chat"),
  };
}

/** Downloads the video (≤720p mp4) or just its audio into `dir` and returns the file name. */
export async function download(
  url: string,
  dir: string,
  audioOnly: boolean,
  onProgress: (fraction: number) => void,
  onLine: (line: string) => void,
): Promise<string> {
  const format = audioOnly
    ? ["-f", "ba[ext=m4a]/ba/b", "-x", "--audio-format", "m4a"]
    : ["-f", "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/b", "--merge-output-format", "mp4"];
  await run(
    [requireTool("yt-dlp"), "--no-playlist", "--newline", "--no-warnings", ...format, "-o", join(dir, "media.%(ext)s"), url],
    {
      onLine(line) {
        const percent = line.match(/\[download\]\s+([\d.]+)%/);
        if (percent) onProgress(Number(percent[1]) / 100);
        else onLine(line);
      },
    },
  );
  const media = (await readdir(dir)).find((name) => /^media\.(mp4|m4a|webm|mkv|mp3|opus)$/.test(name));
  if (!media) throw new Error("O yt-dlp terminou sem gerar o arquivo de mídia.");
  return media;
}

/** Fetches human-written subtitles, which on music videos are usually the lyrics. */
export async function downloadSubtitles(url: string, dir: string, info: VideoInfo): Promise<Line[] | null> {
  const wanted = info.language ?? "";
  const language =
    info.subtitleLanguages.find((code) => wanted && code.startsWith(wanted.slice(0, 2))) ?? info.subtitleLanguages[0];
  if (!language) return null;
  try {
    await run([
      requireTool("yt-dlp"),
      "--no-playlist",
      "--no-warnings",
      "--skip-download",
      "--write-subs",
      "--sub-langs",
      language,
      "--sub-format",
      "vtt",
      "-o",
      join(dir, "subs.%(ext)s"),
      url,
    ]);
    const file = (await readdir(dir)).find((name) => name.startsWith("subs.") && name.endsWith(".vtt"));
    if (!file) return null;
    const lines = parseVtt(await Bun.file(join(dir, file)).text());
    return lines.length ? lines : null;
  } catch {
    return null;
  }
}

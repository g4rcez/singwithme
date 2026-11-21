import type { Line, Word } from "./types";

const TIME_TAG = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const WORD_TAG = /<(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)>/g;
const toSeconds = (minutes: string, seconds: string) => Number(minutes) * 60 + Number(seconds.replace(":", "."));

/** Longest time a line stays on screen when the next line is far away (instrumental breaks). */
const MAX_LINE_SECONDS = 10;

function closeLines(open: { start: number; text: string; words?: Word[] }[], duration?: number): Line[] {
  open.sort((a, b) => a.start - b.start);
  const lines: Line[] = [];
  open.forEach((line, index) => {
    const next = open[index + 1]?.start ?? duration ?? line.start + 5;
    const lastWordEnd = line.words?.at(-1)?.end;
    const end = lastWordEnd ?? Math.min(next, line.start + MAX_LINE_SECONDS);
    // Empty lines only exist to mark where the previous one ends.
    if (line.text) lines.push({ ...line, end: Math.max(end, line.start + 0.2) });
  });
  return lines;
}

/** Parses LRC, including multi-timestamp lines and "enhanced" LRC with per-word `<mm:ss.xx>` tags. */
export function parseLrc(source: string, duration?: number): Line[] {
  const open: { start: number; text: string; words?: Word[] }[] = [];
  let offset = 0;

  for (const raw of source.split(/\r?\n/)) {
    const meta = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
    if (meta) {
      // LRC spec: positive offset makes lyrics appear sooner.
      offset = -Number(meta[1]) / 1000;
      continue;
    }
    const stamps = [...raw.matchAll(TIME_TAG)];
    if (!stamps.length) continue;
    const body = raw.replace(TIME_TAG, "").trim();

    for (const stamp of stamps) {
      const start = toSeconds(stamp[1]!, stamp[2]!);
      const tags = [...body.matchAll(WORD_TAG)];
      if (!tags.length) {
        open.push({ start, text: body });
        continue;
      }
      const words: Word[] = [];
      const pieces = body.split(WORD_TAG);
      // split() with capture groups yields [text, mm, ss, text, mm, ss, text...]
      let cursor = start;
      let pending = pieces[0]!.trim();
      for (let i = 1; i < pieces.length; i += 3) {
        const at = toSeconds(pieces[i]!, pieces[i + 1]!);
        if (pending) words.push({ start: cursor, end: at, text: pending });
        cursor = at;
        pending = (pieces[i + 2] ?? "").trim();
      }
      if (pending) words.push({ start: cursor, end: cursor + 0.6, text: pending });
      open.push({ start, text: words.map((word) => word.text).join(" "), words });
    }
  }

  return shiftLines(closeLines(open, duration), offset);
}

const VTT_TIME = /(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})/;

/** Parses WebVTT / SRT cues into lines, stripping markup and collapsing rolling duplicates. */
export function parseVtt(source: string): Line[] {
  const lines: Line[] = [];
  for (const block of source.replace(/\r/g, "").split(/\n{2,}/)) {
    const rows = block.split("\n");
    const at = rows.findIndex((row) => VTT_TIME.test(row));
    if (at === -1) continue;
    const m = rows[at]!.match(VTT_TIME)!;
    const start = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
    const end = Number(m[5] ?? 0) * 3600 + Number(m[6]) * 60 + Number(m[7]) + Number(m[8]) / 1000;
    const text = rows
      .slice(at + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/[♪♫]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || lines.at(-1)?.text === text) continue;
    lines.push({ start, end, text });
  }
  return lines;
}

export function shiftLines(lines: Line[], seconds: number): Line[] {
  if (!seconds) return lines;
  return lines.map((line) => ({
    ...line,
    start: line.start + seconds,
    end: line.end + seconds,
    words: line.words?.map((word) => ({ ...word, start: word.start + seconds, end: word.end + seconds })),
  }));
}

/** Index of the line that is active at `time`, or the next one coming up; -1 after the last line. */
export function lineIndexAt(lines: Line[], time: number): number {
  let low = 0;
  let high = lines.length - 1;
  let answer = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid]!.end >= time) {
      answer = mid;
      high = mid - 1;
    } else low = mid + 1;
  }
  return answer;
}

import type { Line, Note, NoteType, Word } from "./types";

export interface UltraStarSong {
  title: string;
  artist: string;
  language: string | null;
  audioFile: string | null;
  videoFile: string | null;
  lines: Line[];
  notes: Note[];
}

const NOTE_TYPES: Record<string, NoteType> = { ":": "normal", "*": "golden", F: "freestyle", R: "rap", G: "rap" };
/** UltraStar pitch 0 is C4. */
const MIDI_OFFSET = 60;

/**
 * Parses the UltraStar TXT format (https://usdx.eu/format). Notes are placed on a beat grid whose
 * resolution is four times the #BPM header, shifted by #GAP milliseconds.
 */
export function parseUltraStar(source: string): UltraStarSong {
  const headers: Record<string, string> = {};
  const notes: Note[] = [];
  const lines: Line[] = [];
  let current: Note[] = [];
  let beatSeconds = 0;
  let gap = 0;
  let relativeBase = 0;

  const flush = () => {
    if (!current.length) return;
    const words: Word[] = [];
    for (const note of current) {
      const end = note.start + note.duration;
      const previous = words.at(-1);
      // A syllable without a leading space continues the previous word.
      if (previous && !note.text.startsWith(" ") && !previous.text.endsWith(" ")) {
        previous.text += note.text;
        previous.end = end;
      } else words.push({ start: note.start, end, text: note.text });
    }
    const clean = words.map((word) => ({ ...word, text: word.text.trim() })).filter((word) => word.text);
    if (clean.length) {
      lines.push({
        start: clean[0]!.start,
        end: clean.at(-1)!.end,
        text: clean.map((word) => word.text).join(" "),
        words: clean,
      });
    }
    current = [];
  };

  for (const raw of source.replace(/^﻿/, "").split(/\r?\n/)) {
    if (raw.startsWith("#")) {
      const colon = raw.indexOf(":");
      if (colon > 0) headers[raw.slice(1, colon).trim().toUpperCase()] = raw.slice(colon + 1).trim();
      continue;
    }
    if (!beatSeconds) {
      const bpm = Number((headers.BPM ?? "").replace(",", "."));
      if (!bpm) {
        if (raw.trim()) throw new Error("Arquivo UltraStar inválido: cabeçalho #BPM ausente.");
        continue;
      }
      beatSeconds = 60 / (bpm * 4);
      gap = Number((headers.GAP ?? "0").replace(",", ".")) / 1000;
    }
    const relative = /^(yes|true)$/i.test(headers.RELATIVE ?? "");
    const kind = raw[0];
    if (kind === "E") break;
    if (kind === "-") {
      flush();
      const parts = raw.slice(1).trim().split(/\s+/).map(Number);
      if (relative) relativeBase += parts[1] ?? parts[0] ?? 0;
      continue;
    }
    const type = kind ? NOTE_TYPES[kind] : undefined;
    if (!type) continue; // P1/P2 duet markers, blank lines

    const match = raw.match(/^.\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s?(.*)$/);
    if (!match) continue;
    const note: Note = {
      start: gap + (relativeBase + Number(match[1])) * beatSeconds,
      duration: Math.max(1, Number(match[2])) * beatSeconds,
      pitch: Number(match[3]) + MIDI_OFFSET,
      text: match[4] ?? "",
      type,
    };
    notes.push(note);
    current.push(note);
  }
  flush();

  if (!notes.length) throw new Error("Arquivo UltraStar sem notas.");
  notes.sort((a, b) => a.start - b.start);
  lines.sort((a, b) => a.start - b.start);

  return {
    title: headers.TITLE ?? "Sem título",
    artist: headers.ARTIST ?? "Desconhecido",
    language: headers.LANGUAGE ?? null,
    audioFile: headers.AUDIO ?? headers.MP3 ?? null,
    videoFile: headers.VIDEO ?? null,
    lines,
    notes: notes.map((note) => ({ ...note, text: note.text.trim() })),
  };
}

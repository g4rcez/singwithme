export interface Word {
  start: number;
  end: number;
  text: string;
}

export interface Line {
  start: number;
  end: number;
  text: string;
  words?: Word[];
}

export type NoteType = "normal" | "golden" | "freestyle" | "rap";

/** A sung note with a known pitch (comes from UltraStar charts). Times in seconds, pitch in MIDI. */
export interface Note {
  start: number;
  duration: number;
  pitch: number;
  text: string;
  type: NoteType;
}

/** Reference pitch contour estimated from the recording. One MIDI value (or null = unvoiced) per hop. */
export interface Melody {
  hop: number;
  pitches: (number | null)[];
}

export type SongSource = "youtube" | "ultrastar" | "local";
export type LyricsSource = "ultrastar" | "lrc" | "lrclib" | "lrclib-loose" | "youtube-subs" | "whisper";

export interface SongSummary {
  id: string;
  title: string;
  artist: string;
  language: string | null;
  duration: number;
  source: SongSource;
  lyricsSource: LyricsSource;
  hasVideo: boolean;
  hasInstrumental: boolean;
  scoringMode: ScoringMode;
  createdAt: number;
  bestScore: number | null;
  bestPlayer: string | null;
}

export interface Song extends SongSummary {
  lines: Line[];
  notes: Note[];
  melody: Melody | null;
  lyricsOffset: number;
  mediaUrl: string;
  instrumentalUrl: string | null;
}

/** notes = exact chart; melody = contour estimated from the audio; rhythm = only "did you sing while lyrics were on". */
export type ScoringMode = "notes" | "melody" | "rhythm";
export type Difficulty = "easy" | "normal" | "hard";

export interface ScoreEntry {
  id: number;
  songId: string;
  player: string;
  score: number;
  accuracy: number;
  difficulty: Difficulty;
  createdAt: number;
}

export interface RankedScore extends ScoreEntry {
  songTitle: string;
  songArtist: string;
}

export type JobStatus = "running" | "done" | "error";

export interface Job {
  id: string;
  label: string;
  status: JobStatus;
  step: string;
  progress: number | null;
  log: string[];
  songId: string | null;
  error: string | null;
}

export interface ToolStatus {
  name: string;
  found: boolean;
  path: string | null;
  purpose: string;
  required: boolean;
  install: string;
}

import { Database } from "bun:sqlite";
import { scoringModeOf } from "../shared/scoring";
import type {
  Difficulty,
  Line,
  LyricsSource,
  Melody,
  Note,
  RankedScore,
  ScoreEntry,
  Song,
  SongSource,
  SongSummary,
} from "../shared/types";
import { DB_FILE } from "./paths";

const db = new Database(DB_FILE, { create: true });
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS songs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    language TEXT,
    duration REAL NOT NULL,
    source TEXT NOT NULL,
    lyrics_source TEXT NOT NULL,
    scoring_mode TEXT NOT NULL,
    media_file TEXT NOT NULL,
    instrumental_file TEXT,
    has_video INTEGER NOT NULL DEFAULT 0,
    lyrics_offset REAL NOT NULL DEFAULT 0,
    chart TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    player TEXT NOT NULL,
    score INTEGER NOT NULL,
    accuracy REAL NOT NULL,
    difficulty TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS scores_by_song ON scores(song_id, score DESC);
`);

interface SongRow {
  id: string;
  title: string;
  artist: string;
  language: string | null;
  duration: number;
  source: SongSource;
  lyrics_source: LyricsSource;
  scoring_mode: SongSummary["scoringMode"];
  media_file: string;
  instrumental_file: string | null;
  has_video: number;
  lyrics_offset: number;
  chart: string;
  created_at: number;
  best_score: number | null;
  best_player: string | null;
}

interface Chart {
  lines: Line[];
  notes: Note[];
  melody: Melody | null;
}

const SUMMARY_COLUMNS = `
  s.id, s.title, s.artist, s.language, s.duration, s.source, s.lyrics_source, s.scoring_mode,
  s.media_file, s.instrumental_file, s.has_video, s.lyrics_offset, s.created_at,
  (SELECT score FROM scores WHERE song_id = s.id ORDER BY score DESC, created_at ASC LIMIT 1) AS best_score,
  (SELECT player FROM scores WHERE song_id = s.id ORDER BY score DESC, created_at ASC LIMIT 1) AS best_player`;

const toSummary = (row: SongRow): SongSummary => ({
  id: row.id,
  title: row.title,
  artist: row.artist,
  language: row.language,
  duration: row.duration,
  source: row.source,
  lyricsSource: row.lyrics_source,
  hasVideo: row.has_video === 1,
  hasInstrumental: row.instrumental_file !== null,
  scoringMode: row.scoring_mode,
  createdAt: row.created_at,
  bestScore: row.best_score,
  bestPlayer: row.best_player,
});

export interface NewSong {
  id: string;
  title: string;
  artist: string;
  language: string | null;
  duration: number;
  source: SongSource;
  lyricsSource: LyricsSource;
  mediaFile: string;
  instrumentalFile: string | null;
  hasVideo: boolean;
  lines: Line[];
  notes: Note[];
  melody: Melody | null;
}

export function saveSong(song: NewSong): void {
  const chart: Chart = { lines: song.lines, notes: song.notes, melody: song.melody };
  db.query(
    `INSERT INTO songs (id, title, artist, language, duration, source, lyrics_source, scoring_mode, media_file,
       instrumental_file, has_video, chart, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, artist = excluded.artist, language = excluded.language,
       duration = excluded.duration, source = excluded.source, lyrics_source = excluded.lyrics_source,
       scoring_mode = excluded.scoring_mode, media_file = excluded.media_file,
       instrumental_file = excluded.instrumental_file, has_video = excluded.has_video, chart = excluded.chart`,
  ).run(
    song.id,
    song.title,
    song.artist,
    song.language,
    song.duration,
    song.source,
    song.lyricsSource,
    scoringModeOf(song),
    song.mediaFile,
    song.instrumentalFile,
    song.hasVideo ? 1 : 0,
    JSON.stringify(chart),
    Date.now(),
  );
}

export function listSongs(search = ""): SongSummary[] {
  const like = `%${search.trim()}%`;
  return db
    .query<SongRow, [string, string]>(
      `SELECT ${SUMMARY_COLUMNS} FROM songs s WHERE s.title LIKE ? OR s.artist LIKE ?
       ORDER BY s.artist COLLATE NOCASE, s.title COLLATE NOCASE`,
    )
    .all(like, like)
    .map(toSummary);
}

export function getSong(id: string): Song | null {
  const row = db.query<SongRow, [string]>(`SELECT ${SUMMARY_COLUMNS}, s.chart FROM songs s WHERE s.id = ?`).get(id);
  if (!row) return null;
  const chart = JSON.parse(row.chart) as Chart;
  return {
    ...toSummary(row),
    ...chart,
    lyricsOffset: row.lyrics_offset,
    mediaUrl: `/media/${row.id}/${row.media_file}`,
    instrumentalUrl: row.instrumental_file ? `/media/${row.id}/${row.instrumental_file}` : null,
  };
}

export function updateSong(id: string, patch: { title?: string; artist?: string; lyricsOffset?: number }): void {
  db.query(
    `UPDATE songs SET title = coalesce(?, title), artist = coalesce(?, artist),
       lyrics_offset = coalesce(?, lyrics_offset) WHERE id = ?`,
  ).run(patch.title ?? null, patch.artist ?? null, patch.lyricsOffset ?? null, id);
}

export function deleteSong(id: string): void {
  db.query("DELETE FROM songs WHERE id = ?").run(id);
}

interface ScoreRow {
  id: number;
  song_id: string;
  player: string;
  score: number;
  accuracy: number;
  difficulty: Difficulty;
  created_at: number;
  title?: string;
  artist?: string;
}

const toScore = (row: ScoreRow): ScoreEntry => ({
  id: row.id,
  songId: row.song_id,
  player: row.player,
  score: row.score,
  accuracy: row.accuracy,
  difficulty: row.difficulty,
  createdAt: row.created_at,
});

export function addScore(entry: Omit<ScoreEntry, "id" | "createdAt">): ScoreEntry {
  const createdAt = Date.now();
  const { lastInsertRowid } = db
    .query("INSERT INTO scores (song_id, player, score, accuracy, difficulty, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(entry.songId, entry.player, entry.score, entry.accuracy, entry.difficulty, createdAt);
  return { ...entry, id: Number(lastInsertRowid), createdAt };
}

export function songRanking(songId: string, limit = 50): ScoreEntry[] {
  return db
    .query<ScoreRow, [string, number]>(
      "SELECT * FROM scores WHERE song_id = ? ORDER BY score DESC, created_at ASC LIMIT ?",
    )
    .all(songId, limit)
    .map(toScore);
}

export function globalRanking(limit = 100): RankedScore[] {
  return db
    .query<ScoreRow, [number]>(
      `SELECT sc.*, s.title, s.artist FROM scores sc JOIN songs s ON s.id = sc.song_id
       ORDER BY sc.score DESC, sc.created_at ASC LIMIT ?`,
    )
    .all(limit)
    .map((row) => ({ ...toScore(row), songTitle: row.title ?? "", songArtist: row.artist ?? "" }));
}

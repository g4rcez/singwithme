import { SQL } from "bun";
import { scoringModeOf } from "../shared/scoring";
import type { Line, LyricsSource, Melody, Note, Song, SongSource, SongSummary } from "../shared/types";
import { DB_FILE } from "./paths";

/**
 * One SQL client for both deployments: Postgres when DATABASE_URL is set (the hosted service),
 * a local SQLite file otherwise (offline use). The schema and queries stick to what both understand:
 * text ids, integers for flags, doubles for timestamps, no dialect-specific functions.
 */
export const sql = process.env.DATABASE_URL
  ? // Behind a transaction pooler (PgBouncer, Neon's "-pooler" hosts) a connection is not ours between
    // statements, so named prepared statements cannot be reused.
    new SQL({ url: process.env.DATABASE_URL, prepare: !/-pooler\./.test(process.env.DATABASE_URL), max: 5 })
  : new SQL({ adapter: "sqlite", filename: DB_FILE });

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at DOUBLE PRECISION NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY (group_id, email))`,
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL,
    invite_token TEXT, created_at DOUBLE PRECISION NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS songs (
    id TEXT PRIMARY KEY, group_id TEXT, title TEXT NOT NULL, artist TEXT NOT NULL, language TEXT,
    duration DOUBLE PRECISION NOT NULL, source TEXT NOT NULL, lyrics_source TEXT NOT NULL,
    scoring_mode TEXT NOT NULL, media_file TEXT NOT NULL, instrumental_file TEXT,
    has_video INTEGER NOT NULL DEFAULT 0, lyrics_offset DOUBLE PRECISION NOT NULL DEFAULT 0,
    chart TEXT NOT NULL, created_at DOUBLE PRECISION NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS duos (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL, member_a TEXT NOT NULL,
    member_b TEXT NOT NULL, secret TEXT NOT NULL, created_at DOUBLE PRECISION NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS queue_items (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL, song_id TEXT NOT NULL, duo_id TEXT NOT NULL,
    position DOUBLE PRECISION NOT NULL, singing INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS performances (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL, group_id TEXT NOT NULL, song_id TEXT NOT NULL,
    song_title TEXT NOT NULL, song_artist TEXT NOT NULL, singer TEXT NOT NULL, score INTEGER NOT NULL,
    accuracy DOUBLE PRECISION NOT NULL, difficulty TEXT NOT NULL, created_at DOUBLE PRECISION NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS events_by_group ON events (group_id)`,
  `CREATE INDEX IF NOT EXISTS events_by_invite ON events (invite_token)`,
  `CREATE INDEX IF NOT EXISTS duos_by_event ON duos (event_id)`,
  `CREATE INDEX IF NOT EXISTS queue_by_event ON queue_items (event_id, position)`,
  `CREATE INDEX IF NOT EXISTS performances_by_group ON performances (group_id, song_id, score)`,
  `CREATE INDEX IF NOT EXISTS performances_by_event ON performances (event_id, created_at)`,
];

let ready: Promise<void> | null = null;

/** Creates the tables on first use. Every request awaits it, so a cold start never races the schema. */
export function migrate(): Promise<void> {
  ready ??= (async () => {
    for (const statement of SCHEMA) await sql.unsafe(statement);
  })();
  return ready;
}

export const newId = () => crypto.randomUUID().replaceAll("-", "");

interface SongRow {
  id: string;
  group_id: string | null;
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
  chart?: string;
  created_at: number;
  best_score?: number | null;
  best_player?: string | null;
}

interface Chart {
  lines: Line[];
  notes: Note[];
  melody: Melody | null;
}

const toSummary = (row: SongRow): SongSummary => ({
  id: row.id,
  groupId: row.group_id,
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
  bestScore: row.best_score ?? null,
  bestPlayer: row.best_player ?? null,
});

export interface NewSong {
  id: string;
  /** Owning group, or null for a song every group can sing (the bundled demo songs). */
  groupId: string | null;
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

export async function saveSong(song: NewSong): Promise<void> {
  const chart: Chart = { lines: song.lines, notes: song.notes, melody: song.melody };
  const row = {
    id: song.id,
    group_id: song.groupId,
    title: song.title,
    artist: song.artist,
    language: song.language,
    duration: song.duration,
    source: song.source,
    lyrics_source: song.lyricsSource,
    scoring_mode: scoringModeOf(song),
    media_file: song.mediaFile,
    instrumental_file: song.instrumentalFile,
    has_video: song.hasVideo ? 1 : 0,
    chart: JSON.stringify(chart),
    created_at: Date.now(),
  };
  // Re-importing the same video replaces the song but keeps its history.
  await sql`DELETE FROM songs WHERE id = ${song.id}`;
  await sql`INSERT INTO songs ${sql(row)}`;
}

/** Songs a group can sing: its own plus the shared ones, each with the group's record. */
export async function listSongs(groupId: string, search = ""): Promise<SongSummary[]> {
  const like = `%${search.trim().toLowerCase()}%`;
  const rows = await sql<SongRow[]>`
    SELECT s.id, s.group_id, s.title, s.artist, s.language, s.duration, s.source, s.lyrics_source,
      s.scoring_mode, s.media_file, s.instrumental_file, s.has_video, s.lyrics_offset, s.created_at,
      (SELECT p.score FROM performances p WHERE p.song_id = s.id AND p.group_id = ${groupId}
        ORDER BY p.score DESC, p.created_at ASC LIMIT 1) AS best_score,
      (SELECT p.singer FROM performances p WHERE p.song_id = s.id AND p.group_id = ${groupId}
        ORDER BY p.score DESC, p.created_at ASC LIMIT 1) AS best_player
    FROM songs s
    WHERE (s.group_id IS NULL OR s.group_id = ${groupId})
      AND (lower(s.title) LIKE ${like} OR lower(s.artist) LIKE ${like})
    ORDER BY lower(s.artist), lower(s.title)`;
  return rows.map(toSummary);
}

export async function getSong(id: string): Promise<Song | null> {
  const [row] = await sql<SongRow[]>`SELECT * FROM songs WHERE id = ${id}`;
  if (!row) return null;
  const chart = JSON.parse(row.chart ?? "{}") as Chart;
  return {
    ...toSummary(row),
    ...chart,
    lyricsOffset: row.lyrics_offset,
    mediaUrl: `/media/${row.id}/${row.media_file}`,
    instrumentalUrl: row.instrumental_file ? `/media/${row.id}/${row.instrumental_file}` : null,
  };
}

export async function updateSong(
  id: string,
  patch: { title?: string; artist?: string; lyricsOffset?: number },
): Promise<void> {
  await sql`UPDATE songs SET title = coalesce(${patch.title ?? null}, title),
    artist = coalesce(${patch.artist ?? null}, artist),
    lyrics_offset = coalesce(${patch.lyricsOffset ?? null}, lyrics_offset) WHERE id = ${id}`;
}

export async function deleteSong(id: string): Promise<void> {
  await sql`DELETE FROM queue_items WHERE song_id = ${id}`;
  await sql`DELETE FROM songs WHERE id = ${id}`;
}

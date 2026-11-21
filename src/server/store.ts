import type {
  Difficulty,
  Duo,
  DuoSession,
  EventState,
  EventStatus,
  EventSummary,
  Group,
  Performance,
  QueueItem,
} from "../shared/types";
import { newId, sql } from "./db";
import { HttpError } from "./errors";

const MAX_NAME = 24;
const MAX_TITLE = 60;

function cleanTitle(input: unknown, what: string): string {
  const name = typeof input === "string" ? input.trim() : "";
  if (!name) throw new HttpError(`Informe o nome ${what}.`);
  if (name.length > MAX_TITLE) throw new HttpError(`O nome ${what} pode ter até ${MAX_TITLE} letras.`);
  return name;
}

// ---------------------------------------------------------------- groups

interface EventRow {
  id: string;
  group_id: string;
  name: string;
  status: EventStatus;
  invite_token: string | null;
  created_at: number;
  performances?: number;
  group_name?: string;
}

const toEvent = (row: EventRow): EventSummary => ({
  id: row.id,
  groupId: row.group_id,
  name: row.name,
  status: row.status,
  createdAt: row.created_at,
  performances: row.performances ?? 0,
});

export async function createGroup(name: unknown, ownerEmail: string): Promise<Group> {
  const group = { id: newId(), name: cleanTitle(name, "do grupo"), created_at: Date.now() };
  await sql`INSERT INTO groups ${sql(group)}`;
  await sql`INSERT INTO group_members ${sql({ group_id: group.id, email: ownerEmail, role: "owner" })}`;
  return { id: group.id, name: group.name, events: [] };
}

/** The groups a person belongs to, each with its events, newest first. */
export async function listGroups(email: string): Promise<Group[]> {
  const groups = await sql<{ id: string; name: string }[]>`
    SELECT g.id, g.name FROM groups g JOIN group_members m ON m.group_id = g.id
    WHERE m.email = ${email} ORDER BY g.created_at`;
  const events = await sql<EventRow[]>`
    SELECT e.*, CAST((SELECT COUNT(*) FROM performances p WHERE p.event_id = e.id) AS INTEGER) AS performances
    FROM events e JOIN group_members m ON m.group_id = e.group_id
    WHERE m.email = ${email} ORDER BY e.created_at DESC`;
  return groups.map((group) => ({
    ...group,
    events: events.filter((event) => event.group_id === group.id).map(toEvent),
  }));
}

export async function isMember(groupId: string, email: string): Promise<boolean> {
  const rows = await sql`SELECT 1 AS ok FROM group_members WHERE group_id = ${groupId} AND email = ${email}`;
  return rows.length > 0;
}

// ---------------------------------------------------------------- events

export async function createEvent(groupId: string, name: unknown): Promise<EventSummary> {
  const row: EventRow = {
    id: newId(),
    group_id: groupId,
    name: cleanTitle(name, "do evento"),
    status: "open",
    invite_token: null,
    created_at: Date.now(),
  };
  await sql`INSERT INTO events ${sql(row)}`;
  return toEvent(row);
}

async function eventRow(id: string): Promise<EventRow> {
  const [row] = await sql<EventRow[]>`
    SELECT e.*, g.name AS group_name,
      CAST((SELECT COUNT(*) FROM performances p WHERE p.event_id = e.id) AS INTEGER) AS performances
    FROM events e JOIN groups g ON g.id = e.group_id WHERE e.id = ${id}`;
  if (!row) throw new HttpError("Evento não encontrado.", 404);
  return row;
}

export async function getEvent(id: string): Promise<EventState["event"]> {
  const row = await eventRow(id);
  return { ...toEvent(row), groupName: row.group_name ?? "" };
}

async function openEvent(id: string): Promise<EventRow> {
  const row = await eventRow(id);
  if (row.status !== "open") throw new HttpError("Este evento já foi encerrado.", 409);
  return row;
}

/** Closing an event freezes its history: the queue is cleared and nobody else can register. */
export async function setEventStatus(id: string, status: EventStatus): Promise<void> {
  if (status === "closed") {
    await sql`DELETE FROM queue_items WHERE event_id = ${id}`;
    await sql`UPDATE events SET status = 'closed', invite_token = NULL WHERE id = ${id}`;
  } else await sql`UPDATE events SET status = 'open' WHERE id = ${id}`;
}

// ---------------------------------------------------------------- duos and invites

interface DuoRow {
  id: string;
  event_id: string;
  name: string;
  member_a: string;
  member_b: string;
  secret: string;
}

const toDuo = (row: DuoRow): Duo => ({ id: row.id, name: row.name, members: [row.member_a, row.member_b] });

function cleanMembers(input: unknown): [string, string] {
  const names = Array.isArray(input) ? input.map((name) => (typeof name === "string" ? name.trim() : "")) : [];
  if (names.length !== 2 || names.some((name) => !name))
    throw new HttpError("Informe o nome das duas pessoas da dupla.");
  if (names.some((name) => name.length > MAX_NAME)) throw new HttpError(`Cada nome pode ter até ${MAX_NAME} letras.`);
  return [names[0]!, names[1]!];
}

export async function createDuo(eventId: string, members: unknown): Promise<DuoSession> {
  const pair = cleanMembers(members);
  await openEvent(eventId);
  const row = {
    id: newId(),
    event_id: eventId,
    name: `${pair[0]} & ${pair[1]}`,
    member_a: pair[0],
    member_b: pair[1],
    secret: newId(),
    created_at: Date.now(),
  };
  await sql`INSERT INTO duos ${sql(row)}`;
  return { eventId, duo: toDuo(row), secret: row.secret };
}

export async function findDuo(id: string): Promise<{ eventId: string; secret: string } | null> {
  const [row] = await sql<DuoRow[]>`SELECT * FROM duos WHERE id = ${id}`;
  return row ? { eventId: row.event_id, secret: row.secret } : null;
}

/** Whoever leaves the event also leaves its queue. Past performances stay in the history. */
export async function removeDuo(id: string): Promise<void> {
  await sql`DELETE FROM queue_items WHERE duo_id = ${id}`;
  await sql`DELETE FROM duos WHERE id = ${id}`;
}

/** The single invite currently on screen for an event. Using it burns it, and the next QR code is a new one. */
export async function currentInvite(eventId: string): Promise<string> {
  const row = await openEvent(eventId);
  if (row.invite_token) return row.invite_token;
  const token = newId();
  await sql`UPDATE events SET invite_token = ${token} WHERE id = ${eventId}`;
  return token;
}

export async function findInvite(token: string): Promise<{ eventId: string; eventName: string } | null> {
  if (!token) return null;
  const [row] = await sql<EventRow[]>`SELECT * FROM events WHERE invite_token = ${token} AND status = 'open'`;
  return row ? { eventId: row.id, eventName: row.name } : null;
}

/** Registers a duo from a scanned QR code. Each code works exactly once. */
export async function join(token: unknown, members: unknown): Promise<DuoSession> {
  const pair = cleanMembers(members);
  // Claiming the token and checking it are one statement, so two phones cannot both win the same code.
  const claimed = await sql<{ id: string }[]>`
    UPDATE events SET invite_token = NULL
    WHERE invite_token = ${typeof token === "string" && token ? token : "-"} AND status = 'open' RETURNING id`;
  if (!claimed[0]) {
    throw new HttpError("Este QR code já foi usado. Escaneie o novo código na tela do karaokê.", 410);
  }
  return createDuo(claimed[0].id, pair);
}

// ---------------------------------------------------------------- queue

interface QueueRow {
  id: string;
  event_id: string;
  song_id: string;
  duo_id: string;
  position: number;
  singing: number;
  song_title: string;
  song_artist: string;
  duo_name: string;
}

const toQueueItem = (row: QueueRow): QueueItem => ({
  id: row.id,
  songId: row.song_id,
  songTitle: row.song_title,
  songArtist: row.song_artist,
  duoId: row.duo_id,
  duoName: row.duo_name,
  singing: row.singing === 1,
});

async function queueRows(eventId: string): Promise<QueueRow[]> {
  return sql<QueueRow[]>`
    SELECT q.*, s.title AS song_title, s.artist AS song_artist, d.name AS duo_name
    FROM queue_items q JOIN songs s ON s.id = q.song_id JOIN duos d ON d.id = q.duo_id
    WHERE q.event_id = ${eventId} ORDER BY q.position`;
}

export async function eventState(eventId: string, isHost: boolean): Promise<EventState> {
  const [event, duos, queue] = await Promise.all([
    getEvent(eventId),
    sql<DuoRow[]>`SELECT * FROM duos WHERE event_id = ${eventId} ORDER BY created_at`,
    queueRows(eventId),
  ]);
  return { event, isHost, duos: duos.map(toDuo), queue: queue.map(toQueueItem) };
}

export async function enqueue(eventId: string, songId: string, duoId: string): Promise<void> {
  const event = await openEvent(eventId);
  const [duo] = await sql<DuoRow[]>`SELECT * FROM duos WHERE id = ${duoId} AND event_id = ${eventId}`;
  if (!duo) throw new HttpError("Dupla não encontrada. Cadastre-se de novo pelo QR code.", 404);
  const [song] = await sql<{ group_id: string | null }[]>`SELECT group_id FROM songs WHERE id = ${songId}`;
  if (!song || (song.group_id !== null && song.group_id !== event.group_id)) {
    throw new HttpError("Música não encontrada.", 404);
  }
  const queue = await queueRows(eventId);
  if (queue.some((item) => item.duo_id === duoId && item.song_id === songId)) {
    throw new HttpError("Esta dupla já está na fila com esta música.", 409);
  }
  const position = (queue.at(-1)?.position ?? 0) + 1;
  await sql`INSERT INTO queue_items ${sql({ id: newId(), event_id: eventId, song_id: songId, duo_id: duoId, position, singing: 0 })}`;
}

export async function findQueueItem(id: string): Promise<{ eventId: string; duoId: string } | null> {
  const [row] = await sql<QueueRow[]>`SELECT * FROM queue_items WHERE id = ${id}`;
  return row ? { eventId: row.event_id, duoId: row.duo_id } : null;
}

export async function dequeue(id: string): Promise<void> {
  await sql`DELETE FROM queue_items WHERE id = ${id}`;
}

/** Marks an item as the one on stage (only one at a time per event). */
export async function startSinging(id: string): Promise<void> {
  const item = await findQueueItem(id);
  if (!item) throw new HttpError("Este item não está mais na fila.", 404);
  await sql`UPDATE queue_items SET singing = 0 WHERE event_id = ${item.eventId}`;
  await sql`UPDATE queue_items SET singing = 1 WHERE id = ${id}`;
}

/** Moves an item one position up or down by swapping places with its neighbour. */
export async function moveInQueue(id: string, direction: -1 | 1): Promise<void> {
  const item = await findQueueItem(id);
  if (!item) return;
  const queue = await queueRows(item.eventId);
  const from = queue.findIndex((row) => row.id === id);
  const other = queue[from + direction];
  if (from === -1 || !other) return;
  await sql`UPDATE queue_items SET position = ${other.position} WHERE id = ${id}`;
  await sql`UPDATE queue_items SET position = ${queue[from]!.position} WHERE id = ${other.id}`;
}

// ---------------------------------------------------------------- performances (history and rankings)

interface PerformanceRow {
  id: string;
  event_id: string;
  event_name: string;
  song_id: string;
  song_title: string;
  song_artist: string;
  singer: string;
  score: number;
  accuracy: number;
  difficulty: Difficulty;
  created_at: number;
}

const toPerformance = (row: PerformanceRow): Performance => ({
  id: row.id,
  eventId: row.event_id,
  eventName: row.event_name,
  songId: row.song_id,
  songTitle: row.song_title,
  songArtist: row.song_artist,
  singer: row.singer,
  score: row.score,
  accuracy: row.accuracy,
  difficulty: row.difficulty,
  createdAt: row.created_at,
});

export interface NewPerformance {
  eventId: string;
  songId: string;
  singer: string;
  score: number;
  accuracy: number;
  difficulty: Difficulty;
}

/** Records a finished song. Title and artist are copied so the history survives the song being deleted. */
export async function addPerformance(entry: NewPerformance): Promise<string> {
  const event = await openEvent(entry.eventId);
  const [song] = await sql<
    { title: string; artist: string }[]
  >`SELECT title, artist FROM songs WHERE id = ${entry.songId}`;
  if (!song) throw new HttpError("Música não encontrada.", 404);
  const id = newId();
  await sql`INSERT INTO performances ${sql({
    id,
    event_id: entry.eventId,
    group_id: event.group_id,
    song_id: entry.songId,
    song_title: song.title,
    song_artist: song.artist,
    singer: entry.singer,
    score: entry.score,
    accuracy: entry.accuracy,
    difficulty: entry.difficulty,
    created_at: Date.now(),
  })}`;
  return id;
}

const PERFORMANCE_COLUMNS = sql`p.*, e.name AS event_name FROM performances p JOIN events e ON e.id = p.event_id`;

/** What was sung at one event, in the order it happened. */
export async function eventHistory(eventId: string): Promise<Performance[]> {
  const rows = await sql<PerformanceRow[]>`
    SELECT ${PERFORMANCE_COLUMNS} WHERE p.event_id = ${eventId} ORDER BY p.created_at`;
  return rows.map(toPerformance);
}

/** Everything a group has sung, newest first. */
export async function groupHistory(groupId: string, limit = 300): Promise<Performance[]> {
  const rows = await sql<PerformanceRow[]>`
    SELECT ${PERFORMANCE_COLUMNS} WHERE p.group_id = ${groupId} ORDER BY p.created_at DESC LIMIT ${limit}`;
  return rows.map(toPerformance);
}

/** A group's best performances, across all its events; optionally for a single song. */
export async function groupRanking(groupId: string, songId: string | null = null, limit = 100): Promise<Performance[]> {
  const rows = songId
    ? await sql<PerformanceRow[]>`
        SELECT ${PERFORMANCE_COLUMNS} WHERE p.group_id = ${groupId} AND p.song_id = ${songId}
        ORDER BY p.score DESC, p.created_at ASC LIMIT ${limit}`
    : await sql<PerformanceRow[]>`
        SELECT ${PERFORMANCE_COLUMNS} WHERE p.group_id = ${groupId}
        ORDER BY p.score DESC, p.created_at ASC LIMIT ${limit}`;
  return rows.map(toPerformance);
}

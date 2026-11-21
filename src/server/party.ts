import { networkInterfaces } from "node:os";
import type { Duo, DuoSession, Invite, QueueItem } from "../shared/types";

/**
 * Party state: duos, the singing queue and registration invites.
 * Deliberately kept in memory only, so every party starts clean.
 */
const duos = new Map<string, Duo>();
const secrets = new Map<string, string>();
const queue: QueueItem[] = [];
/** The single invite currently on screen. Using it burns it, and the next QR code is a new one. */
let openInvite: string | null = null;

const MAX_NAME = 24;
const token = () => crypto.randomUUID().replaceAll("-", "");

export class PartyError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function cleanMembers(input: unknown): [string, string] {
  const names = Array.isArray(input) ? input.map((name) => (typeof name === "string" ? name.trim() : "")) : [];
  if (names.length !== 2 || names.some((name) => !name)) throw new PartyError("Informe o nome das duas pessoas da dupla.");
  if (names.some((name) => name.length > MAX_NAME)) throw new PartyError(`Cada nome pode ter até ${MAX_NAME} letras.`);
  return [names[0]!, names[1]!];
}

export function createDuo(members: unknown): DuoSession {
  const pair = cleanMembers(members);
  const duo: Duo = { id: token().slice(0, 10), name: `${pair[0]} & ${pair[1]}`, members: pair };
  const secret = token();
  duos.set(duo.id, duo);
  secrets.set(duo.id, secret);
  return { duo, secret };
}

export function removeDuo(id: string): void {
  duos.delete(id);
  secrets.delete(id);
  // Whoever leaves the party also leaves the queue.
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.duoId === id) queue.splice(i, 1);
}

export const listDuos = () => [...duos.values()];
export const listQueue = () => [...queue];
export const ownsDuo = (duoId: string, secret: string | null) => secret !== null && secrets.get(duoId) === secret;

/** Address phones on the same Wi-Fi can reach. PUBLIC_URL overrides it (tunnels, reverse proxies). */
export function publicOrigin(port: number): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((address) => address?.family === "IPv4" && !address.internal);
  return `http://${addresses[0]?.address ?? "localhost"}:${port}`;
}

export function currentInvite(origin: string): Invite {
  openInvite ??= token();
  return { token: openInvite, url: `${origin}/#/join/${openInvite}` };
}

export const isInviteValid = (candidate: string) => openInvite !== null && candidate === openInvite;

/** Registers a duo from a scanned QR code. Each code works exactly once. */
export function join(candidate: unknown, members: unknown): DuoSession {
  if (typeof candidate !== "string" || !isInviteValid(candidate)) {
    throw new PartyError("Este QR code já foi usado. Escaneie o novo código na tela do karaokê.", 410);
  }
  const session = createDuo(members);
  openInvite = null;
  return session;
}

export function enqueue(song: { id: string; title: string; artist: string }, duoId: string): QueueItem {
  const duo = duos.get(duoId);
  if (!duo) throw new PartyError("Dupla não encontrada. Cadastre-se de novo pelo QR code.", 404);
  if (queue.some((item) => item.duoId === duoId && item.songId === song.id)) {
    throw new PartyError("Esta dupla já está na fila com esta música.", 409);
  }
  const item: QueueItem = {
    id: token().slice(0, 10),
    songId: song.id,
    songTitle: song.title,
    songArtist: song.artist,
    duoId,
    duoName: duo.name,
    singing: false,
  };
  queue.push(item);
  return item;
}

export const findQueueItem = (id: string) => queue.find((item) => item.id === id) ?? null;

export function dequeue(id: string): void {
  const index = queue.findIndex((item) => item.id === id);
  if (index !== -1) queue.splice(index, 1);
}

/** Marks an item as the one on stage (only one at a time). */
export function startSinging(id: string): QueueItem {
  const item = findQueueItem(id);
  if (!item) throw new PartyError("Este item não está mais na fila.", 404);
  for (const other of queue) other.singing = other === item;
  return item;
}

/** Moves an item one position up or down. */
export function moveInQueue(id: string, direction: -1 | 1): void {
  const from = queue.findIndex((item) => item.id === id);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= queue.length) return;
  [queue[from], queue[to]] = [queue[to]!, queue[from]!];
}

/** Forgets everything. Used by tests. */
export function resetParty(): void {
  duos.clear();
  secrets.clear();
  queue.length = 0;
  openInvite = null;
}

import type {
  Difficulty,
  Duo,
  DuoSession,
  EventState,
  EventStatus,
  EventSummary,
  Group,
  Invite,
  Job,
  Me,
  Performance,
  Song,
  SongSummary,
  ToolStatus,
} from "../shared/types";

const PIN_KEY = "singwithme.hostPin";

/** PIN that identifies the host on offline installs reached through a tunnel or another machine. */
export const hostPin = {
  get: () => localStorage.getItem(PIN_KEY),
  set: (pin: string) => localStorage.setItem(PIN_KEY, pin.trim()),
  clear: () => localStorage.removeItem(PIN_KEY),
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const pin = hostPin.get();
  if (pin) headers.set("X-Host-Pin", pin);
  const response = await fetch(path, { ...init, headers });
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || body === null) throw new Error(body?.error ?? `Erro ${response.status}`);
  return body;
}

const send = (method: string, data: unknown = {}, headers: Record<string, string> = {}): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(data),
});

/** Phones prove which duo they are with the secret they received when registering. */
const asDuo = (secret?: string): Record<string, string> => (secret ? { "X-Duo-Secret": secret } : {});

type Ok = { ok: true };
const id = encodeURIComponent;

export const api = {
  me: () => call<Me>("/api/me"),
  requestCode: (email: string) => call<Ok>("/api/auth/request", send("POST", { email })),
  verifyCode: (email: string, code: string) => call<Ok>("/api/auth/verify", send("POST", { email, code })),
  logout: () => call<Ok>("/api/auth/logout", send("POST")),

  groups: () => call<Group[]>("/api/groups"),
  createGroup: (name: string) => call<Group>("/api/groups", send("POST", { name })),
  createEvent: (groupId: string, name: string) =>
    call<EventSummary>(`/api/groups/${id(groupId)}/events`, send("POST", { name })),
  groupHistory: (groupId: string) => call<Performance[]>(`/api/groups/${id(groupId)}/history`),
  groupRanking: (groupId: string) => call<Performance[]>(`/api/groups/${id(groupId)}/ranking`),

  event: (eventId: string) => call<EventState>(`/api/events/${id(eventId)}`),
  setEventStatus: (eventId: string, status: EventStatus) =>
    call<Ok>(`/api/events/${id(eventId)}`, send("PATCH", { status })),
  eventHistory: (eventId: string) => call<Performance[]>(`/api/events/${id(eventId)}/history`),

  songs: (eventId: string, search = "") => call<SongSummary[]>(`/api/events/${id(eventId)}/songs?q=${id(search)}`),
  song: (eventId: string, songId: string) => call<Song>(`/api/events/${id(eventId)}/songs/${id(songId)}`),
  updateSong: (eventId: string, songId: string, patch: { title?: string; artist?: string; lyricsOffset?: number }) =>
    call<Ok>(`/api/events/${id(eventId)}/songs/${id(songId)}`, send("PATCH", patch)),
  deleteSong: (eventId: string, songId: string) =>
    call<Ok>(`/api/events/${id(eventId)}/songs/${id(songId)}`, { method: "DELETE" }),
  songRanking: (eventId: string, songId: string) =>
    call<Performance[]>(`/api/events/${id(eventId)}/songs/${id(songId)}/ranking`),
  savePerformance: (
    eventId: string,
    entry: { songId: string; singer: string; score: number; accuracy: number; difficulty: Difficulty },
  ) => call<{ id: string; ranking: Performance[] }>(`/api/events/${id(eventId)}/performances`, send("POST", entry)),

  invite: (eventId: string) => call<Invite>(`/api/events/${id(eventId)}/invite`),
  inviteInfo: (token: string) => call<{ valid: boolean; eventName: string | null }>(`/api/invites/${id(token)}`),
  join: (token: string, members: [string, string]) => call<DuoSession>("/api/join", send("POST", { token, members })),
  createDuo: (eventId: string, members: [string, string]) =>
    call<Duo>(`/api/events/${id(eventId)}/duos`, send("POST", { members })),
  removeDuo: (duoId: string) => call<Ok>(`/api/duos/${id(duoId)}`, { method: "DELETE" }),

  enqueue: (eventId: string, songId: string, duoId: string, secret?: string) =>
    call<Ok>(`/api/events/${id(eventId)}/queue`, send("POST", { songId, duoId }, asDuo(secret))),
  dequeue: (itemId: string, secret?: string) =>
    call<Ok>(`/api/queue/${id(itemId)}`, { method: "DELETE", headers: asDuo(secret) }),
  startItem: (itemId: string) => call<Ok>(`/api/queue/${id(itemId)}/start`, send("POST")),
  moveItem: (itemId: string, direction: "up" | "down") =>
    call<Ok>(`/api/queue/${id(itemId)}/move`, send("POST", { direction })),

  tools: () => call<ToolStatus[]>("/api/tools"),
  job: (jobId: string) => call<Job>(`/api/jobs/${id(jobId)}`),
  importYoutube: (groupId: string, form: FormData) =>
    call<Job>(`/api/groups/${id(groupId)}/import/youtube`, { method: "POST", body: form }),
  importFile: (groupId: string, form: FormData) =>
    call<Job>(`/api/groups/${id(groupId)}/import/file`, { method: "POST", body: form }),
};

import type {
  Difficulty,
  Duo,
  DuoSession,
  Invite,
  Job,
  PartyState,
  QueueItem,
  RankedScore,
  ScoreEntry,
  Song,
  SongSummary,
  ToolStatus,
} from "../shared/types";

const PIN_KEY = "singwithme.hostPin";

/** PIN that identifies the host on instances where "sitting at the server" is not possible. */
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

const jsonBody = (method: string, data: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(data),
});

/** Phones prove which duo they are with the secret they received when registering. */
const asDuo = (secret?: string): Record<string, string> => (secret ? { "X-Duo-Secret": secret } : {});

export const api = {
  songs: (search = "") => call<SongSummary[]>(`/api/songs?q=${encodeURIComponent(search)}`),
  song: (id: string) => call<Song>(`/api/songs/${id}`),
  updateSong: (id: string, patch: { title?: string; artist?: string; lyricsOffset?: number }) =>
    call<Song>(`/api/songs/${id}`, jsonBody("PATCH", patch)),
  deleteSong: (id: string) => call<{ ok: true }>(`/api/songs/${id}`, { method: "DELETE" }),
  scores: (id: string) => call<ScoreEntry[]>(`/api/songs/${id}/scores`),
  saveScore: (id: string, entry: { player: string; score: number; accuracy: number; difficulty: Difficulty }) =>
    call<{ entry: ScoreEntry; ranking: ScoreEntry[] }>(`/api/songs/${id}/scores`, jsonBody("POST", entry)),
  ranking: () => call<RankedScore[]>("/api/ranking"),
  tools: () => call<ToolStatus[]>("/api/tools"),
  job: (id: string) => call<Job>(`/api/jobs/${id}`),
  importYoutube: (form: FormData) => call<Job>("/api/import/youtube", { method: "POST", body: form }),
  importFile: (form: FormData) => call<Job>("/api/import/file", { method: "POST", body: form }),

  party: () => call<PartyState>("/api/party"),
  invite: () => call<Invite>("/api/party/invite"),
  inviteValid: (token: string) => call<{ valid: boolean }>(`/api/party/invite/${encodeURIComponent(token)}`),
  join: (token: string, members: [string, string]) =>
    call<DuoSession>("/api/party/join", jsonBody("POST", { token, members })),
  createDuo: (members: [string, string]) => call<Duo>("/api/party/duos", jsonBody("POST", { members })),
  removeDuo: (id: string) => call<{ ok: true }>(`/api/party/duos/${id}`, { method: "DELETE" }),
  enqueue: (songId: string, duoId: string, secret?: string) =>
    call<QueueItem>("/api/party/queue", jsonBody("POST", { songId, duoId }, asDuo(secret))),
  dequeue: (id: string, secret?: string) =>
    call<{ ok: true }>(`/api/party/queue/${id}`, { method: "DELETE", headers: asDuo(secret) }),
  startItem: (id: string) => call<QueueItem>(`/api/party/queue/${id}/start`, { method: "POST" }),
  moveItem: (id: string, direction: "up" | "down") =>
    call<{ ok: true }>(`/api/party/queue/${id}/move`, jsonBody("POST", { direction })),
};

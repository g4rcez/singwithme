import type { Difficulty, Job, RankedScore, ScoreEntry, Song, SongSummary, ToolStatus } from "../shared/types";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || body === null) throw new Error(body?.error ?? `Erro ${response.status}`);
  return body;
}

const jsonBody = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

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
};

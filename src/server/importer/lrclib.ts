import { parseLrc } from "../../shared/lyrics";
import type { Line } from "../../shared/types";

const BASE = process.env.SINGWITHME_LRCLIB_URL ?? "https://lrclib.net";
const HEADERS = { "User-Agent": "singwithme/0.1 (offline karaoke)" };
/** Beyond this the recording is probably a different cut and the timings will not line up. */
const TIGHT_DURATION_GAP = 3;

interface LrclibTrack {
  trackName: string;
  artistName: string;
  duration: number;
  syncedLyrics: string | null;
}

export interface LrclibMatch {
  lines: Line[];
  /** True when the recording length matches, so the timestamps can be trusted. */
  tight: boolean;
  durationGap: number;
}

async function request(path: string, params: Record<string, string>): Promise<unknown> {
  const url = `${BASE}${path}?${new URLSearchParams(params)}`;
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`LRCLIB respondeu ${response.status}`);
  return response.json();
}

/**
 * Looks for time-synced lyrics on LRCLIB (open, community-run, every language).
 * Returns null when there is nothing synced, or when the service is unreachable (the app is offline-first).
 */
export async function findSyncedLyrics(title: string, artist: string, duration: number): Promise<LrclibMatch | null> {
  try {
    const candidates: LrclibTrack[] = [];
    const exact = (await request("/api/get", {
      track_name: title,
      artist_name: artist,
      duration: String(Math.round(duration)),
    })) as LrclibTrack | null;
    if (exact) candidates.push(exact);
    if (!exact?.syncedLyrics) {
      const found = (await request("/api/search", { track_name: title, artist_name: artist })) as LrclibTrack[] | null;
      candidates.push(...(found ?? []));
    }

    const best = candidates
      .filter((track) => track.syncedLyrics)
      .sort((a, b) => Math.abs(a.duration - duration) - Math.abs(b.duration - duration))[0];
    if (!best?.syncedLyrics) return null;

    const lines = parseLrc(best.syncedLyrics, duration);
    if (!lines.length) return null;
    const durationGap = Math.abs(best.duration - duration);
    return { lines, tight: durationGap <= TIGHT_DURATION_GAP, durationGap };
  } catch {
    return null;
  }
}

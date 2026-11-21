import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

/** Running on Vercel: no durable disk, no ffmpeg, and every request arrives through a proxy. */
export const CLOUD = Boolean(process.env.VERCEL);
/** Demo mode ships a fixed library of bundled songs instead of importing. */
export const DEMO = CLOUD || process.env.SINGWITHME_DEMO === "1";
/** When set, whoever knows this PIN is the host, wherever they connect from. */
export const HOST_PIN = process.env.SINGWITHME_HOST_PIN?.trim() || null;

export const DATA_DIR = resolve(process.env.SINGWITHME_DATA ?? (CLOUD ? "/tmp/singwithme" : "data"));
export const PUBLIC_MEDIA_DIR = resolve("public/media");
export const SONGS_DIR = join(DATA_DIR, "songs");
export const DB_FILE = join(DATA_DIR, "singwithme.db");

mkdirSync(SONGS_DIR, { recursive: true });

export const songDir = (id: string) => join(SONGS_DIR, id);

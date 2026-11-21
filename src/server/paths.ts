import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export const DATA_DIR = resolve(process.env.SINGWITHME_DATA ?? "data");
export const SONGS_DIR = join(DATA_DIR, "songs");
export const DB_FILE = join(DATA_DIR, "singwithme.db");

mkdirSync(SONGS_DIR, { recursive: true });

export const songDir = (id: string) => join(SONGS_DIR, id);

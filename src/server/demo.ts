import { demoChart, DEMO_SONGS } from "../shared/demo";
import { getSong, saveSong } from "./db";

/** Adds the bundled demo songs to the library (their audio ships in `public/media`). */
export function seedDemoSongs(): void {
  for (const song of DEMO_SONGS) {
    if (getSong(song.id)) continue;
    const chart = demoChart(song);
    saveSong({
      id: song.id,
      title: song.title,
      artist: song.artist,
      language: song.language,
      duration: chart.duration,
      source: "local",
      lyricsSource: "demo",
      mediaFile: "media.mp3",
      instrumentalFile: null,
      hasVideo: false,
      lines: chart.lines,
      notes: chart.notes,
      melody: null,
    });
  }
}

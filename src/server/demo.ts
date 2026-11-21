import { demoChart, DEMO_SONGS } from "../shared/demo";
import { getSong, saveSong } from "./db";

/** Adds the bundled demo songs to the library (their audio ships in `public/media`). */
export async function seedDemoSongs(): Promise<void> {
  for (const song of DEMO_SONGS) {
    if (await getSong(song.id)) continue;
    const chart = demoChart(song);
    // Another instance starting at the same time may insert it first; that is as good as inserting it here.
    await saveSong({
      id: song.id,
      groupId: null,
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
    }).catch(async (error) => {
      if (!(await getSong(song.id))) throw error;
    });
  }
}

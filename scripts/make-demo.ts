/**
 * Synthesises the audio of the bundled demo songs into public/media/<id>/media.mp3.
 * Run with `bun scripts/make-demo.ts` (needs ffmpeg) after changing src/shared/demo.ts.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { COUNT_IN_BEATS, demoChart, DEMO_SONGS } from "../src/shared/demo";
import { midiToHz } from "../src/shared/pitch";

const SAMPLE_RATE = 44_100;

for (const song of DEMO_SONGS) {
  const chart = demoChart(song);
  const samples = new Float32Array(Math.ceil(chart.duration * SAMPLE_RATE));
  const beat = 60 / song.bpm;

  // Guide melody: a soft organ-like tone, plus the same line an octave down for body.
  for (const note of chart.notes) {
    const hz = midiToHz(note.pitch);
    const length = Math.floor(note.duration * SAMPLE_RATE);
    const begin = Math.floor(note.start * SAMPLE_RATE);
    for (let i = 0; i < length; i++) {
      const t = i / SAMPLE_RATE;
      const envelope = Math.min(1, i / 600, (length - i) / 2500);
      const phase = 2 * Math.PI * hz * t;
      const tone = 0.3 * Math.sin(phase) + 0.1 * Math.sin(2 * phase) + 0.05 * Math.sin(3 * phase) + 0.12 * Math.sin(phase / 2);
      samples[begin + i]! += envelope * tone;
    }
  }

  // Metronome: a short tick on every beat, louder during the count-in.
  const lastBeat = Math.floor((chart.duration - 2) / beat);
  for (let index = 0; index <= lastBeat; index++) {
    const begin = Math.floor(index * beat * SAMPLE_RATE);
    const gain = index < COUNT_IN_BEATS ? 0.35 : 0.08;
    for (let i = 0; i < 1800; i++) {
      samples[begin + i]! += gain * Math.exp(-i / 250) * Math.sin((2 * Math.PI * 1500 * i) / SAMPLE_RATE);
    }
  }

  const dir = join("public/media", song.id);
  await mkdir(dir, { recursive: true });
  const ffmpeg = Bun.spawn(
    ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", String(SAMPLE_RATE), "-ac", "1", "-i", "-", "-b:a", "64k", join(dir, "media.mp3")],
    { stdin: "pipe", stderr: "inherit" },
  );
  ffmpeg.stdin.write(new Uint8Array(samples.buffer));
  await ffmpeg.stdin.end();
  if ((await ffmpeg.exited) !== 0) throw new Error(`ffmpeg falhou para ${song.id}`);
  console.log(`${song.id}: ${chart.duration.toFixed(1)}s, ${chart.notes.length} notas`);
}

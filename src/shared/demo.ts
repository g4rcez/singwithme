import type { Line, Note, Word } from "./types";

/** One sung note: pitch name, length in beats and the syllable (a trailing "-" continues the word). */
type DemoNote = [pitch: string, beats: number, syllable: string];

export interface DemoSong {
  id: string;
  title: string;
  artist: string;
  language: string;
  bpm: number;
  /** One entry per lyric line. */
  phrases: DemoNote[][];
}

/** Beats of metronome before the first note, so singers can find the tempo. */
export const COUNT_IN_BEATS = 4;
const TAIL_SECONDS = 2;

const twinkleA: DemoNote[] = [["C4", 1, "Twin-"], ["C4", 1, "kle"], ["G4", 1, "twin-"], ["G4", 1, "kle"], ["A4", 1, "lit-"], ["A4", 1, "tle"], ["G4", 2, "star"]];
const twinkleB: DemoNote[] = [["F4", 1, "How"], ["F4", 1, "I"], ["E4", 1, "won-"], ["E4", 1, "der"], ["D4", 1, "what"], ["D4", 1, "you"], ["C4", 2, "are"]];
const jacques = (notes: DemoNote[]) => [notes, notes];

/** Traditional songs in the public domain, synthesised by `scripts/make-demo.ts`. */
export const DEMO_SONGS: DemoSong[] = [
  {
    id: "demo-twinkle",
    title: "Twinkle, Twinkle, Little Star",
    artist: "Tradicional (inglês)",
    language: "en",
    bpm: 96,
    phrases: [
      twinkleA,
      twinkleB,
      [["G4", 1, "Up"], ["G4", 1, "a-"], ["F4", 1, "bove"], ["F4", 1, "the"], ["E4", 1, "world"], ["E4", 1, "so"], ["D4", 2, "high"]],
      [["G4", 1, "Like"], ["G4", 1, "a"], ["F4", 1, "dia-"], ["F4", 1, "mond"], ["E4", 1, "in"], ["E4", 1, "the"], ["D4", 2, "sky"]],
      twinkleA,
      twinkleB,
    ],
  },
  {
    id: "demo-frere-jacques",
    title: "Frère Jacques",
    artist: "Tradicional (francês)",
    language: "fr",
    bpm: 104,
    phrases: [
      ...jacques([["C4", 1, "Frè-"], ["D4", 1, "re"], ["E4", 1, "Jac-"], ["C4", 1, "ques"]]),
      ...jacques([["E4", 1, "Dor-"], ["F4", 1, "mez-"], ["G4", 2, "vous?"]]),
      ...jacques([["G4", 0.5, "Son-"], ["A4", 0.5, "nez"], ["G4", 0.5, "les"], ["F4", 0.5, "ma-"], ["E4", 1, "ti-"], ["C4", 1, "nes"]]),
      ...jacques([["C4", 1, "Ding,"], ["G3", 1, "dang,"], ["C4", 2, "dong"]]),
    ],
  },
  {
    id: "demo-ode-an-die-freude",
    title: "Ode an die Freude",
    artist: "Beethoven / Schiller (alemão)",
    language: "de",
    bpm: 108,
    phrases: [
      [["E4", 1, "Freu-"], ["E4", 1, "de,"], ["F4", 1, "schö-"], ["G4", 1, "ner"], ["G4", 1, "Göt-"], ["F4", 1, "ter-"], ["E4", 1, "fun-"], ["D4", 1, "ken,"]],
      [["C4", 1, "Toch-"], ["C4", 1, "ter"], ["D4", 1, "aus"], ["E4", 1, "E-"], ["E4", 1.5, "ly-"], ["D4", 0.5, "si-"], ["D4", 2, "um,"]],
      [["E4", 1, "Wir"], ["E4", 1, "be-"], ["F4", 1, "tre-"], ["G4", 1, "ten"], ["G4", 1, "feu-"], ["F4", 1, "er-"], ["E4", 1, "trun-"], ["D4", 1, "ken,"]],
      [["C4", 1, "Himm-"], ["C4", 1, "li-"], ["D4", 1, "sche,"], ["E4", 1, "dein"], ["D4", 1.5, "Hei-"], ["C4", 0.5, "lig-"], ["C4", 2, "tum!"]],
    ],
  },
];

const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const noteToMidi = (name: string) => 12 * (Number(name.slice(-1)) + 1) + SEMITONES[name[0]!]!;

export interface DemoChart {
  lines: Line[];
  notes: Note[];
  duration: number;
}

/** Lays a demo song out in time: the same result drives the audio synthesis and the karaoke chart. */
export function demoChart(song: DemoSong): DemoChart {
  const beat = 60 / song.bpm;
  const lines: Line[] = [];
  const notes: Note[] = [];
  let cursor = COUNT_IN_BEATS * beat;

  for (const phrase of song.phrases) {
    const words: Word[] = [];
    let open = false;
    for (const [pitch, beats, syllable] of phrase) {
      const text = syllable.replace(/-$/, "");
      // Leave a small breath between notes so repeated pitches are heard as separate notes.
      const duration = beats * beat * 0.92;
      notes.push({ start: cursor, duration, pitch: noteToMidi(pitch), text, type: "normal" });
      const last = words.at(-1);
      if (open && last) {
        last.text += text;
        last.end = cursor + duration;
      } else words.push({ start: cursor, end: cursor + duration, text });
      open = syllable.endsWith("-");
      cursor += beats * beat;
    }
    lines.push({
      start: words[0]!.start,
      end: words.at(-1)!.end,
      text: words.map((word) => word.text).join(" "),
      words,
    });
  }
  return { lines, notes, duration: cursor + TAIL_SECONDS };
}

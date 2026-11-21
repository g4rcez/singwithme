import { describe, expect, test } from "bun:test";
import { lineIndexAt, parseLrc, parseVtt } from "../src/shared/lyrics";
import { detectPitch, foldToOctave, hzToMidi, midiToHz, pitchClassDistance } from "../src/shared/pitch";
import { MAX_SCORE, ScoreTracker, SLOT_SECONDS, scoringModeOf } from "../src/shared/scoring";
import { guessTrack } from "../src/shared/titles";
import type { Line, Melody, Note } from "../src/shared/types";
import { parseUltraStar } from "../src/shared/ultrastar";
import { whisperToLines } from "../src/server/importer/whisper";

const sine = (hz: number, sampleRate: number, length: number) =>
  Float32Array.from({ length }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / sampleRate));

describe("pitch", () => {
  test.each([110, 220, 261.63, 440, 659.25])("detects a %p Hz tone", (hz) => {
    const found = detectPitch(sine(hz, 48_000, 2048), 48_000);
    expect(found).not.toBeNull();
    expect(Math.abs(hzToMidi(found!) - hzToMidi(hz))).toBeLessThan(0.1);
  });

  test("treats silence and noise as unvoiced", () => {
    expect(detectPitch(new Float32Array(2048), 48_000)).toBeNull();
    let seed = 1;
    const noise = Float32Array.from({ length: 2048 }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.6);
    expect(detectPitch(noise, 48_000)).toBeNull();
  });

  test("compares pitches regardless of octave", () => {
    expect(pitchClassDistance(60, 72)).toBe(0);
    expect(pitchClassDistance(60, 71)).toBe(1);
    expect(pitchClassDistance(60, 66)).toBe(6);
    expect(foldToOctave(74, 60)).toBe(62);
    expect(midiToHz(69)).toBe(440);
  });
});

describe("lyrics", () => {
  test("parses LRC with repeated timestamps and closes each line at the next one", () => {
    const lines = parseLrc("[ti:x]\n[00:10.00]Olá mundo\n[00:12.50][00:20.00]Refrão\n[00:15.00]\n", 30);
    expect(lines.map((line) => [line.start, line.end, line.text])).toEqual([
      [10, 12.5, "Olá mundo"],
      [12.5, 15, "Refrão"],
      [20, 30, "Refrão"],
    ]);
  });

  test("parses per-word timestamps and the offset tag", () => {
    const [line] = parseLrc("[offset:500]\n[00:01.00]<00:01.00>Ser <00:01.50>ou <00:02.00>não");
    expect(line!.start).toBe(0.5);
    expect(line!.words).toEqual([
      { start: 0.5, end: 1, text: "Ser" },
      { start: 1, end: 1.5, text: "ou" },
      { start: 1.5, end: 2.1, text: "não" },
    ]);
  });

  test("parses WebVTT cues and drops markup and repeats", () => {
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<c>♪ Hello</c> there\n\n00:00:03.000 --> 00:00:04.000\nHello there\n\n1\n00:01:00,500 --> 00:01:02,000\nBye";
    expect(parseVtt(vtt)).toEqual([
      { start: 1, end: 3, text: "Hello there" },
      { start: 60.5, end: 62, text: "Bye" },
    ]);
  });

  test("finds the active or upcoming line", () => {
    const lines: Line[] = [
      { start: 1, end: 2, text: "a" },
      { start: 5, end: 6, text: "b" },
    ];
    expect([0, 1.5, 3, 5.5, 7].map((time) => lineIndexAt(lines, time))).toEqual([0, 0, 1, 1, -1]);
  });
});

describe("ultrastar", () => {
  const chart = [
    "#TITLE:Garota",
    "#ARTIST:Tom",
    "#LANGUAGE:Portuguese",
    "#MP3:song.mp3",
    "#BPM:150",
    "#GAP:1000",
    ": 0 4 0 O",
    ": 4 4 2 lha",
    "* 8 8 4  que",
    "- 20",
    "F 24 4 0 coi",
    "R 28 4 0 sa",
    "E",
  ].join("\n");

  test("converts beats to seconds and pitches to MIDI", () => {
    const song = parseUltraStar(chart);
    expect(song).toMatchObject({ title: "Garota", artist: "Tom", language: "Portuguese", audioFile: "song.mp3" });
    // 150 BPM -> a beat lasts 60 / (150 * 4) = 0.1s, after a 1s gap.
    expect(song.notes[1]).toEqual({ start: 1.4, duration: 0.4, pitch: 62, text: "lha", type: "normal" });
    expect(song.notes.map((note) => note.type)).toEqual(["normal", "normal", "golden", "freestyle", "rap"]);
  });

  test("joins syllables into words and splits lines at breaks", () => {
    const { lines } = parseUltraStar(chart);
    expect(lines.map((line) => line.text)).toEqual(["Olha que", "coisa"]);
    expect(lines[0]!.words!.map((word) => word.text)).toEqual(["Olha", "que"]);
    expect(lines[0]!.start).toBeCloseTo(1);
    expect(lines[0]!.end).toBeCloseTo(2.6);
  });

  test("rejects files without a BPM or without notes", () => {
    expect(() => parseUltraStar("#TITLE:x\n: 0 1 0 a")).toThrow("#BPM");
    expect(() => parseUltraStar("#BPM:100\nE")).toThrow("sem notas");
  });
});

describe("scoring", () => {
  const lines: Line[] = [{ start: 1, end: 3, text: "la la" }];
  const notes: Note[] = [
    { start: 1, duration: 1, pitch: 60, text: "la", type: "normal" },
    { start: 2, duration: 1, pitch: 64, text: "la", type: "golden" },
  ];
  const song = { lines, notes, melody: null, duration: 4 };

  /** Sings through the song at 100 samples per second using `voice` to choose the pitch. */
  const sing = (tracker: ScoreTracker, voice: (time: number) => number | null, until = 4) => {
    for (let time = 0; time < until; time += 0.01) tracker.push(time, voice(time));
    return tracker.result();
  };

  test("a perfect performance scores the maximum, in any octave", () => {
    const perfect = sing(new ScoreTracker(song), (time) => (time < 2 ? 60 : 64));
    expect(perfect.score).toBe(MAX_SCORE);
    expect(perfect.mode).toBe("notes");
    expect(sing(new ScoreTracker(song), (time) => (time < 2 ? 48 : 76)).score).toBe(MAX_SCORE);
  });

  test("silence and wrong notes score nothing", () => {
    expect(sing(new ScoreTracker(song), () => null).score).toBe(0);
    expect(sing(new ScoreTracker(song), () => 66).score).toBe(0);
  });

  test("golden notes weigh double", () => {
    // Only the first (normal) note is sung: 1 of 3 weighted parts.
    expect(sing(new ScoreTracker(song), (time) => (time < 2 ? 60 : null)).score).toBe(Math.round(MAX_SCORE / 3));
  });

  test("difficulty changes how far off a note may be", () => {
    const flat = (time: number) => (time < 2 ? 61.5 : 65.5);
    expect(sing(new ScoreTracker(song, "easy"), flat).score).toBe(MAX_SCORE);
    expect(sing(new ScoreTracker(song, "normal"), flat).score).toBe(0);
  });

  test("stopping early or sampling a slot twice cannot inflate the score", () => {
    const tracker = new ScoreTracker(song);
    for (let i = 0; i < 50; i++) tracker.push(1.01, 60);
    expect(tracker.score).toBe(Math.round(MAX_SCORE / 75));
    expect(sing(new ScoreTracker(song), () => 60, 2).score).toBe(Math.round(MAX_SCORE / 3));
  });

  test("falls back to the estimated melody, then to rhythm only", () => {
    const melody: Melody = {
      hop: SLOT_SECONDS,
      pitches: Array.from({ length: 100 }, (_, i) => (i >= 25 && i < 75 ? 57 : null)),
    };
    const estimated = { lines, notes: [], melody, duration: 4 };
    expect(scoringModeOf(estimated)).toBe("melody");
    expect(sing(new ScoreTracker(estimated), () => 57).score).toBe(MAX_SCORE);
    expect(sing(new ScoreTracker(estimated), () => 63).score).toBe(0);

    const bare = { lines, notes: [], melody: null, duration: 4 };
    expect(scoringModeOf(bare)).toBe("rhythm");
    expect(sing(new ScoreTracker(bare), () => 63).score).toBe(MAX_SCORE);
    expect(sing(new ScoreTracker(bare), (time) => (time < 2 ? 63 : null)).accuracy).toBeCloseTo(0.5, 1);
  });
});

describe("importers", () => {
  test.each([
    ["Chitãozinho & Xororó - Evidências (Clipe Oficial)", "", "Chitãozinho & Xororó", "Evidências"],
    ["Queen – Bohemian Rhapsody (Official Video Remastered)", "Queen Official", "Queen", "Bohemian Rhapsody"],
    ["YOASOBI - アイドル [Official Music Video]", "", "YOASOBI", "アイドル"],
    ["Garota de Ipanema", "Tom Jobim - Topic", "Tom Jobim", "Garota de Ipanema"],
    ["Shallow | Lyrics", "LadyGagaVEVO", "LadyGaga", "Shallow"],
  ])("guesses artist and title from %p", (videoTitle, uploader, artist, title) => {
    expect(guessTrack(videoTitle, uploader)).toEqual({ artist, title });
  });

  test("turns Whisper output into lines, splitting long segments", () => {
    const words = Array.from({ length: 14 }, (_, i) => ({ word: ` w${i}`, start: i, end: i + 0.5 }));
    const lines = whisperToLines({
      segments: [
        { start: 0, end: 14, text: "ignored", words },
        { start: 20, end: 22, text: " sem palavras " },
        { start: 30, end: 31, text: "  " },
      ],
    });
    expect(lines.map((line) => line.words?.length)).toEqual([7, 7, undefined]);
    expect(lines[1]).toMatchObject({ start: 7, end: 13.5, text: "w7 w8 w9 w10 w11 w12 w13" });
    expect(lines[2]).toEqual({ start: 20, end: 22, text: "sem palavras" });
  });
});

import { pitchClassDistance } from "./pitch";
import type { Difficulty, Line, Melody, Note, ScoringMode } from "./types";

/** Scoring grid: the song is cut into slots and each slot is judged at most once. */
export const SLOT_SECONDS = 0.04;
export const MAX_SCORE = 10000;

/** Allowed distance from the target pitch, in semitones. */
export const TOLERANCE: Record<Difficulty, number> = { easy: 2, normal: 1, hard: 0.5 };
/** An estimated contour is noisier than a hand-made chart, so it gets extra slack. */
const MELODY_EXTRA_TOLERANCE = 0.5;

export interface ScorableSong {
  lines: Line[];
  notes: Note[];
  melody: Melody | null;
  duration: number;
}

/** What the singer should be doing during one slot. `pitches: null` means "any voiced sound counts". */
export interface Target {
  pitches: number[] | null;
  weight: number;
  line: number;
}

export interface ScoreResult {
  score: number;
  accuracy: number;
  mode: ScoringMode;
  rating: string;
  lines: { hit: number; total: number }[];
}

export function scoringModeOf(song: Pick<ScorableSong, "notes" | "melody">): ScoringMode {
  if (song.notes.some((note) => note.type !== "freestyle")) return "notes";
  if (song.melody?.pitches.some((pitch) => pitch !== null)) return "melody";
  return "rhythm";
}

export const slotOf = (time: number) => Math.floor(time / SLOT_SECONDS + 1e-6);

function lineOf(lines: Line[], time: number): number {
  for (let i = 0; i < lines.length; i++) {
    if (time < lines[i]!.start) return Math.max(0, i - 1);
    if (time <= lines[i]!.end) return i;
  }
  return Math.max(0, lines.length - 1);
}

/** Builds the per-slot targets for a song. Slots with nothing to sing are absent from the map. */
export function buildTargets(song: ScorableSong): { mode: ScoringMode; targets: Map<number, Target> } {
  const mode = scoringModeOf(song);
  const targets = new Map<number, Target>();

  if (mode === "notes") {
    for (const note of song.notes) {
      if (note.type === "freestyle") continue;
      const line = lineOf(song.lines, note.start);
      const last = Math.max(slotOf(note.start), slotOf(note.start + note.duration) - 1);
      for (let slot = slotOf(note.start); slot <= last; slot++) {
        targets.set(slot, {
          pitches: note.type === "rap" ? null : [note.pitch],
          weight: note.type === "golden" ? 2 : 1,
          line,
        });
      }
    }
    return { mode, targets };
  }

  song.lines.forEach((line, index) => {
    for (let slot = slotOf(line.start); slot <= slotOf(line.end); slot++) {
      if (mode === "rhythm") {
        targets.set(slot, { pitches: null, weight: 1, line: index });
        continue;
      }
      // Accept the reference pitch of the neighbouring frames too: singers are never frame-exact.
      const melody = song.melody!;
      const centre = Math.round((slot * SLOT_SECONDS) / melody.hop);
      const pitches: number[] = [];
      for (let frame = centre - 2; frame <= centre + 2; frame++) {
        const pitch = melody.pitches[frame];
        if (pitch !== null && pitch !== undefined) pitches.push(pitch);
      }
      if (melody.pitches[centre] != null && pitches.length) targets.set(slot, { pitches, weight: 1, line: index });
    }
  });
  return { mode, targets };
}

export function ratingFor(score: number): string {
  if (score >= 9000) return "Lenda do karaokê";
  if (score >= 7500) return "Estrela";
  if (score >= 6000) return "Cantor de respeito";
  if (score >= 4000) return "Promissor";
  if (score >= 2000) return "Cantor de chuveiro";
  return "Desafinado com orgulho";
}

/**
 * Accumulates the singer's pitch samples and turns them into a score.
 * The denominator is fixed up front from the whole song, so skipping ahead never helps.
 */
export class ScoreTracker {
  readonly mode: ScoringMode;
  readonly targets: Map<number, Target>;
  private readonly tolerance: number;
  private readonly totalWeight: number;
  private readonly judged = new Map<number, boolean>();
  private readonly lineTotals: number[];
  private readonly lineHits: number[];
  private hitWeight = 0;

  constructor(song: ScorableSong, difficulty: Difficulty = "normal") {
    const built = buildTargets(song);
    this.mode = built.mode;
    this.targets = built.targets;
    this.tolerance = TOLERANCE[difficulty] + (this.mode === "melody" ? MELODY_EXTRA_TOLERANCE : 0);
    this.lineTotals = song.lines.map(() => 0);
    this.lineHits = song.lines.map(() => 0);
    let total = 0;
    for (const target of this.targets.values()) {
      total += target.weight;
      if (target.line < this.lineTotals.length) this.lineTotals[target.line]! += target.weight;
    }
    this.totalWeight = total;
  }

  targetAt(time: number): Target | undefined {
    return this.targets.get(slotOf(time));
  }

  matches(target: Target, pitch: number | null): boolean {
    if (pitch === null) return false;
    if (target.pitches === null) return true;
    return target.pitches.some((wanted) => pitchClassDistance(pitch, wanted) <= this.tolerance);
  }

  /**
   * Records what the singer was doing at `time` (song clock, already latency-compensated).
   * Returns whether the sample was on target, or null when nothing was expected.
   */
  push(time: number, pitch: number | null): boolean | null {
    const slot = slotOf(time);
    const target = this.targets.get(slot);
    if (!target) return null;
    const hit = this.matches(target, pitch);
    // A slot can be sampled several times per animation frame; a hit is never taken back.
    if (hit && !this.judged.get(slot)) {
      this.hitWeight += target.weight;
      if (target.line < this.lineHits.length) this.lineHits[target.line]! += target.weight;
    }
    this.judged.set(slot, this.judged.get(slot) || hit);
    return hit;
  }

  get score(): number {
    return this.totalWeight ? Math.round((MAX_SCORE * this.hitWeight) / this.totalWeight) : 0;
  }

  result(): ScoreResult {
    return {
      score: this.score,
      accuracy: this.totalWeight ? this.hitWeight / this.totalWeight : 0,
      mode: this.mode,
      rating: ratingFor(this.score),
      lines: this.lineTotals.map((total, index) => ({ hit: this.lineHits[index]!, total })),
    };
  }
}

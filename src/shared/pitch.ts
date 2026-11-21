export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Smallest distance in semitones between two pitches, ignoring the octave (0..6). */
export function pitchClassDistance(a: number, b: number): number {
  const d = (((a - b) % 12) + 12) % 12;
  return Math.min(d, 12 - d);
}

/** Moves `pitch` by whole octaves so it lands as close as possible to `reference`. */
export function foldToOctave(pitch: number, reference: number): number {
  return pitch - 12 * Math.round((pitch - reference) / 12);
}

export interface YinOptions {
  minHz?: number;
  maxHz?: number;
  /** Aperiodicity threshold: lower is stricter. */
  threshold?: number;
  /** Frames quieter than this RMS are treated as silence. */
  minRms?: number;
}

/**
 * YIN fundamental-frequency estimator (de Cheveigné & Kawahara, 2002).
 * Returns the frequency in Hz, or null when the frame is silent or not periodic enough.
 */
export function detectPitch(frame: Float32Array, sampleRate: number, options: YinOptions = {}): number | null {
  const { minHz = 70, maxHz = 1000, threshold = 0.15, minRms = 0.01 } = options;
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const tauMax = Math.min(Math.floor(sampleRate / minHz), Math.floor(frame.length / 2) - 1);
  if (tauMax <= tauMin) return null;
  const window = frame.length - tauMax;

  let energy = 0;
  for (let i = 0; i < frame.length; i++) energy += frame[i]! * frame[i]!;
  if (Math.sqrt(energy / frame.length) < minRms) return null;

  // Cumulative mean normalised difference function.
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < window; i++) {
      const delta = frame[i]! - frame[i + tau]!;
      sum += delta * delta;
    }
    running += sum;
    cmnd[tau] = running === 0 ? 1 : (sum * tau) / running;
  }

  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmnd[t]! < threshold) {
      while (t + 1 <= tauMax && cmnd[t + 1]! < cmnd[t]!) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) return null;

  // Parabolic interpolation around the minimum for sub-sample precision.
  const a = cmnd[tau - 1] ?? cmnd[tau]!;
  const b = cmnd[tau]!;
  const c = cmnd[tau + 1] ?? cmnd[tau]!;
  const denominator = a + c - 2 * b;
  const refined = denominator === 0 ? tau : tau + (a - c) / (2 * denominator);
  return sampleRate / refined;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Median filter that keeps unvoiced frames unvoiced and drops isolated voiced blips. */
export function smoothContour(pitches: (number | null)[], radius = 2): (number | null)[] {
  return pitches.map((pitch, index) => {
    if (pitch === null) return null;
    const neighbours: number[] = [];
    for (let i = Math.max(0, index - radius); i <= Math.min(pitches.length - 1, index + radius); i++) {
      const value = pitches[i];
      if (value !== null && value !== undefined) neighbours.push(value);
    }
    return neighbours.length < 2 ? null : median(neighbours);
  });
}

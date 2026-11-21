import { useEffect, useMemo, useRef } from "react";
import { foldToOctave } from "../shared/pitch";
import { SLOT_SECONDS, slotOf, type ScoreTracker } from "../shared/scoring";

export interface TrailPoint {
  time: number;
  pitch: number | null;
  hit: boolean;
}

const BEFORE = 1.5;
const AHEAD = 4.5;
const SPAN = BEFORE + AHEAD;

/** Pitch range worth showing: the bulk of the song's targets, with a little headroom. */
function pitchRange(tracker: ScoreTracker): [number, number] {
  const pitches: number[] = [];
  for (const target of tracker.targets.values()) if (target.pitches) pitches.push(target.pitches[0]!);
  if (!pitches.length) return [52, 76];
  pitches.sort((a, b) => a - b);
  const low = pitches[Math.floor(pitches.length * 0.03)]!;
  const high = pitches[Math.floor(pitches.length * 0.97)]!;
  return [low - 4, Math.max(high, low + 8) + 4];
}

/** Scrolling lane: what to sing (bars) against what the microphone hears (dots). */
export function PitchLane({ tracker, time, trail }: { tracker: ScoreTracker; time: number; trail: TrailPoint[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [low, high] = useMemo(() => pitchRange(tracker), [tracker]);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const ratio = devicePixelRatio || 1;
    const width = element.clientWidth;
    const height = element.clientHeight;
    if (element.width !== width * ratio || element.height !== height * ratio) {
      element.width = width * ratio;
      element.height = height * ratio;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const from = time - BEFORE;
    const x = (seconds: number) => ((seconds - from) / SPAN) * width;
    const y = (pitch: number) => {
      const clamped = Math.min(high, Math.max(low, pitch));
      return height - ((clamped - low) / (high - low)) * height;
    };
    const centre = (low + high) / 2;
    const targetPitch = (seconds: number) => {
      const target = tracker.targetAt(seconds);
      if (!target) return null;
      return target.pitches ? target.pitches[target.pitches.length >> 1]! : centre;
    };

    const slotWidth = (SLOT_SECONDS / SPAN) * width + 1;
    for (let slot = slotOf(from); slot <= slotOf(time + AHEAD); slot++) {
      const seconds = slot * SLOT_SECONDS;
      const pitch = targetPitch(seconds);
      if (pitch === null) continue;
      context.fillStyle = seconds < time ? "rgb(124 92 255 / 0.35)" : "rgb(124 92 255 / 0.9)";
      context.fillRect(x(seconds), y(pitch) - 6, slotWidth, 12);
    }

    context.fillStyle = "rgb(255 255 255 / 0.5)";
    context.fillRect(x(time), 0, 2, height);

    for (const point of trail) {
      if (point.pitch === null || point.time < from) continue;
      // Octaves are forgiven, so draw the voice in the octave of whatever it is being compared with.
      const shown = foldToOctave(point.pitch, targetPitch(point.time) ?? centre);
      context.fillStyle = point.hit ? "#3ddc97" : "rgb(255 255 255 / 0.55)";
      context.beginPath();
      context.arc(x(point.time), y(shown), point.hit ? 4 : 3, 0, Math.PI * 2);
      context.fill();
    }
  }, [tracker, time, trail, low, high]);

  return <canvas ref={canvas} className="h-40 w-full md:h-52" aria-hidden />;
}

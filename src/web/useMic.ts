import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detectPitch, hzToMidi } from "../shared/pitch";

export type MicStatus = "idle" | "starting" | "on" | "denied" | "unavailable";

export interface Mic {
  status: MicStatus;
  start: () => Promise<boolean>;
  stop: () => void;
  /** Current sung pitch as a MIDI number, or null when the singer is silent. */
  read: () => number | null;
}

/** Microphone capture with live pitch detection. Nothing is recorded or sent anywhere. */
export function useMic(): Mic {
  const [status, setStatus] = useState<MicStatus>("idle");
  const nodes = useRef<{ context: AudioContext; analyser: AnalyserNode; stream: MediaStream } | null>(null);
  const buffer = useRef(new Float32Array(2048));

  const stop = useCallback(() => {
    nodes.current?.stream.getTracks().forEach((track) => track.stop());
    void nodes.current?.context.close();
    nodes.current = null;
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (nodes.current) return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unavailable");
      return false;
    }
    setStatus("starting");
    try {
      // Processing meant for calls (echo cancelling, noise gates) mangles a singing voice.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = buffer.current.length;
      context.createMediaStreamSource(stream).connect(analyser);
      nodes.current = { context, analyser, stream };
      setStatus("on");
      return true;
    } catch {
      setStatus("denied");
      return false;
    }
  }, []);

  const read = useCallback(() => {
    const active = nodes.current;
    if (!active) return null;
    active.analyser.getFloatTimeDomainData(buffer.current);
    const hz = detectPitch(buffer.current, active.context.sampleRate, { minHz: 75, maxHz: 1000 });
    return hz === null ? null : hzToMidi(hz);
  }, []);

  useEffect(() => stop, [stop]);

  return useMemo(() => ({ status, start, stop, read }), [status, start, stop, read]);
}

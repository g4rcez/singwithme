import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shiftLines } from "../shared/lyrics";
import { ScoreTracker, type ScoreResult } from "../shared/scoring";
import type { Difficulty, Song } from "../shared/types";
import { api } from "./api";
import { clock, DIFFICULTY_LABEL, MODE_HELP, MODE_LABEL, points } from "./format";
import { Lyrics } from "./Lyrics";
import { PitchLane, type TrailPoint } from "./PitchLane";
import { Results } from "./Results";
import { useMic } from "./useMic";

type Phase = "ready" | "singing" | "results";

/** Time between a sound reaching the microphone and its pitch being available to the scorer. */
const MIC_LATENCY = 0.08;
const TRAIL_SECONDS = 2;
const OFFSET_STEP = 0.25;
const DIFFICULTY_KEY = "singwithme.difficulty";

const storedDifficulty = (): Difficulty => {
  const value = localStorage.getItem(DIFFICULTY_KEY);
  return value === "easy" || value === "hard" ? value : "normal";
};

export function Player({ songId }: { songId: string }) {
  const [song, setSong] = useState<Song | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [difficulty, setDifficulty] = useState(storedDifficulty);
  const [offset, setOffset] = useState(0);
  const [instrumental, setInstrumental] = useState(false);
  const [paused, setPaused] = useState(false);
  const [time, setTime] = useState(0);
  const [score, setScore] = useState(0);
  const [result, setResult] = useState<ScoreResult | null>(null);

  const mic = useMic();
  const video = useRef<HTMLVideoElement>(null);
  const backing = useRef<HTMLAudioElement>(null);
  const trail = useRef<TrailPoint[]>([]);

  useEffect(() => {
    api.song(songId).then(
      (loaded) => {
        setSong(loaded);
        setOffset(loaded.lyricsOffset);
      },
      (cause: Error) => setError(cause.message),
    );
  }, [songId]);

  // The lyrics offset moves the chart (lines and notes); the melody comes from the audio itself and stays put.
  const lines = useMemo(() => (song ? shiftLines(song.lines, offset) : []), [song, offset]);
  const tracker = useMemo(() => {
    if (!song) return null;
    const notes = song.notes.map((note) => ({ ...note, start: note.start + offset }));
    trail.current = [];
    return new ScoreTracker({ lines, notes, melody: song.melody, duration: song.duration }, difficulty);
  }, [song, lines, offset, difficulty]);

  const useBacking = instrumental && song?.instrumentalUrl != null;
  const master = useCallback(
    (): HTMLMediaElement | null => (useBacking ? backing.current : video.current),
    [useBacking],
  );

  const finish = useCallback(() => {
    video.current?.pause();
    backing.current?.pause();
    mic.stop();
    if (tracker) setResult(tracker.result());
    setPhase("results");
  }, [mic, tracker]);

  const start = async () => {
    const clockSource = master();
    if (!clockSource || !video.current) return;
    await mic.start();
    video.current.muted = useBacking;
    video.current.currentTime = 0;
    clockSource.currentTime = 0;
    setPaused(false);
    setPhase("singing");
    await Promise.all([video.current.play(), clockSource.play()]).catch(() => setPaused(true));
  };

  const togglePause = useCallback(() => {
    const clockSource = master();
    if (!clockSource) return;
    if (clockSource.paused) {
      void clockSource.play();
      void video.current?.play();
    } else {
      clockSource.pause();
      video.current?.pause();
    }
    setPaused(clockSource.paused);
  }, [master]);

  useEffect(() => {
    if (phase !== "singing" || !tracker || !song) return;
    let frame = 0;
    const tick = () => {
      const clockSource = master();
      if (!clockSource) return;
      const now = clockSource.currentTime;
      // With an instrumental backing track the (muted) video just follows the audio clock.
      if (clockSource !== video.current && video.current && Math.abs(video.current.currentTime - now) > 0.25) {
        video.current.currentTime = now;
      }
      if (!clockSource.paused) {
        const heardAt = now - MIC_LATENCY;
        const pitch = mic.read();
        const hit = tracker.push(heardAt, pitch) === true;
        trail.current.push({ time: heardAt, pitch, hit });
        while (trail.current[0] && trail.current[0].time < now - TRAIL_SECONDS) trail.current.shift();
      }
      setTime(now);
      setScore(tracker.score);
      if (clockSource.ended || now >= song.duration - 0.05) return finish();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, tracker, song, master, mic, finish]);

  useEffect(() => {
    if (phase !== "singing") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      event.preventDefault();
      togglePause();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [phase, togglePause]);

  const nudgeOffset = (delta: number) => {
    const value = Math.round((offset + delta) * 100) / 100;
    setOffset(value);
    void api.updateSong(songId, { lyricsOffset: value }).catch(() => undefined);
  };

  const pickDifficulty = (value: Difficulty) => {
    setDifficulty(value);
    localStorage.setItem(DIFFICULTY_KEY, value);
  };

  if (error) {
    return (
      <div className="grid h-screen place-items-center text-center">
        <div>
          <p className="mb-4">{error}</p>
          <a className="btn" href="#/">
            Voltar às músicas
          </a>
        </div>
      </div>
    );
  }
  if (!song || !tracker) return <p className="p-10 text-white/50">Carregando...</p>;

  if (phase === "results" && result) {
    return (
      <Results
        song={song}
        result={result}
        difficulty={difficulty}
        onAgain={() => {
          setResult(null);
          setScore(0);
          setTime(0);
          setPhase("ready");
        }}
      />
    );
  }

  return (
    <div className="relative h-screen overflow-hidden bg-black">
      <video
        ref={video}
        src={song.mediaUrl}
        playsInline
        preload="auto"
        className={`absolute inset-0 h-full w-full object-contain ${song.hasVideo ? "opacity-60" : "opacity-0"}`}
      />
      {song.instrumentalUrl && <audio ref={backing} src={song.instrumentalUrl} preload="auto" />}

      {phase === "ready" ? (
        <div className="absolute inset-0 grid place-items-center overflow-y-auto bg-ink/80 p-5">
          <div className="card w-full max-w-lg space-y-5 p-8">
            <div>
              <h1 className="text-3xl font-black">{song.title}</h1>
              <p className="text-white/60">
                {song.artist} · {clock(song.duration)}
              </p>
            </div>

            <div>
              <p className="mb-2 text-sm text-white/60">Dificuldade</p>
              <div className="flex gap-2">
                {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((level) => (
                  <button
                    key={level}
                    className={`btn flex-1 ${difficulty === level ? "border-glow bg-glow/20" : ""}`}
                    onClick={() => pickDifficulty(level)}
                  >
                    {DIFFICULTY_LABEL[level]}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-sm text-white/60">
              <strong className="text-white">{MODE_LABEL[tracker.mode]}.</strong> {MODE_HELP[tracker.mode]} Cantar uma
              oitava acima ou abaixo vale igual.
            </p>

            {song.lyricsSource === "lrclib-loose" && (
              <p className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-100/80">
                A letra veio de uma gravação com duração diferente. Se ela estiver adiantada ou atrasada, ajuste com os
                botões “Letra −/+” durante a música.
              </p>
            )}

            {song.instrumentalUrl && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={instrumental} onChange={(event) => setInstrumental(event.target.checked)} />
                Tocar sem a voz original (instrumental)
              </label>
            )}

            {(mic.status === "denied" || mic.status === "unavailable") && (
              <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">
                Não consegui acessar o microfone, então a pontuação ficará zerada. Libere o microfone para este site e
                abra o app por <code>localhost</code>.
              </p>
            )}

            <div className="flex gap-2">
              <a className="btn" href="#/">
                Voltar
              </a>
              <button className="btn btn-primary flex-1 text-base" onClick={start} disabled={mic.status === "starting"}>
                {mic.status === "denied" || mic.status === "unavailable" ? "Cantar sem pontuação" : "Começar a cantar"}
              </button>
            </div>
            <p className="text-center text-xs text-white/40">
              Use fones de ouvido: assim o microfone escuta só você, e não a música.
            </p>
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col justify-between bg-linear-to-b from-black/70 via-transparent to-black/85">
          <header className="flex items-center gap-3 p-4 text-sm">
            <div className="min-w-0">
              <p className="truncate font-bold">{song.title}</p>
              <p className="truncate text-xs text-white/60">{song.artist}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="chip" title="Microfone">
                {mic.status === "on" ? "🎤 ligado" : "🎤 desligado"}
              </span>
              <button
                className="btn px-2 py-1 text-xs"
                title="Adiantar a letra (reinicia a pontuação)"
                onClick={() => nudgeOffset(-OFFSET_STEP)}
              >
                Letra −
              </button>
              <span className="w-12 text-center font-mono text-xs">{offset.toFixed(2)}s</span>
              <button
                className="btn px-2 py-1 text-xs"
                title="Atrasar a letra (reinicia a pontuação)"
                onClick={() => nudgeOffset(OFFSET_STEP)}
              >
                Letra +
              </button>
              <button className="btn px-3 py-1 text-xs" onClick={togglePause}>
                {paused ? "Continuar" : "Pausar"}
              </button>
              <button className="btn px-3 py-1 text-xs" onClick={finish}>
                Encerrar
              </button>
            </div>
            <p className="w-28 text-right text-3xl font-black tabular-nums" data-testid="live-score">
              {points(score)}
            </p>
          </header>

          <div>
            <PitchLane tracker={tracker} time={time} trail={trail.current} />
            <div className="py-6">
              <Lyrics lines={lines} time={time} />
            </div>
            <div className="h-1 bg-white/10">
              <div className="h-full bg-accent" style={{ width: `${(time / song.duration) * 100}%` }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

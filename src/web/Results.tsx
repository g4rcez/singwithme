import { useEffect, useState, type FormEvent } from "react";
import type { ScoreResult } from "../shared/scoring";
import type { Difficulty, Performance, QueueItem, Song } from "../shared/types";
import { api } from "./api";
import { DIFFICULTY_LABEL, MODE_HELP, points } from "./format";
import { PerformanceTable } from "./Ranking";

const NAME_KEY = "singwithme.player";

interface Props {
  eventId: string;
  song: Song;
  result: ScoreResult;
  difficulty: Difficulty;
  /** Duo that sang, when the song came from the queue. */
  singer: string | null;
  onAgain: () => void;
}

export function Results({ eventId, song, result, difficulty, singer, onAgain }: Props) {
  const [ranking, setRanking] = useState<Performance[]>([]);
  const [saved, setSaved] = useState<{ id: string; singer: string } | null>(null);
  const [player, setPlayer] = useState(() => singer ?? localStorage.getItem(NAME_KEY) ?? "");
  const [upNext, setUpNext] = useState<QueueItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.songRanking(eventId, song.id).then(setRanking, () => undefined);
  }, [eventId, song.id]);

  useEffect(() => {
    // Whoever just sang may still be listed for a moment, so skip the item marked as on stage.
    api.event(eventId).then(
      (state) => setUpNext(state.queue.find((item) => !item.singing) ?? null),
      () => undefined,
    );
  }, [eventId]);

  const singNext = async (item: QueueItem) => {
    await api.startItem(item.id).catch(() => undefined);
    location.hash = `#/e/${eventId}/sing/${encodeURIComponent(item.songId)}?item=${item.id}`;
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const response = await api.savePerformance(eventId, {
        songId: song.id,
        singer: player,
        score: result.score,
        accuracy: result.accuracy,
        difficulty,
      });
      if (!singer) localStorage.setItem(NAME_KEY, player.trim());
      setSaved({ id: response.id, singer: player.trim() });
      setRanking(response.ranking);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const position = saved ? ranking.findIndex((entry) => entry.id === saved.id) + 1 : 0;

  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-5 py-10 md:grid-cols-2">
      <section className="card p-8 text-center">
        <p className="text-sm text-white/50">
          {song.title} · {song.artist}
        </p>
        <p className="mt-4 text-7xl font-black tabular-nums" data-testid="final-score">
          {points(result.score)}
        </p>
        <p className="mt-2 text-2xl font-bold text-accent">{result.rating}</p>
        <p className="mt-4 text-sm text-white/60">
          de 100 · {DIFFICULTY_LABEL[difficulty]}
        </p>
        <p className="mt-1 text-xs text-white/40">{MODE_HELP[result.mode]}</p>

        {saved ? (
          <p className="mt-6 font-semibold text-hit">
            Salvo! {saved.singer} está em {position}º lugar nesta música.
          </p>
        ) : (
          <form onSubmit={save} className="mt-6 flex gap-2">
            <input
              className="field"
              placeholder="Seu nome"
              aria-label="Seu nome"
              maxLength={24}
              required
              autoFocus
              value={player}
              onChange={(event) => setPlayer(event.target.value)}
            />
            <button className="btn btn-primary shrink-0">Salvar no ranking</button>
          </form>
        )}
        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {upNext && (
            <button className="btn btn-primary w-full" onClick={() => singNext(upNext)}>
              Próxima: {upNext.duoName} · {upNext.songTitle}
            </button>
          )}
          {!singer && (
            <button className="btn" onClick={onAgain}>
              Cantar de novo
            </button>
          )}
          <a className="btn" href={`#/e/${eventId}/party`}>
            Ver a fila
          </a>
          <a className="btn" href={`#/e/${eventId}`}>
            Voltar às músicas
          </a>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="mb-2 font-bold">Ranking do grupo em “{song.title}”</h2>
        <PerformanceTable entries={ranking} ranked showEvent highlight={saved?.id} />
      </section>
    </div>
  );
}

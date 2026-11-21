import { useCallback, useEffect, useState } from "react";
import type { SongSummary } from "../shared/types";
import { api } from "./api";
import { clock, LYRICS_LABEL, MODE_LABEL, points } from "./format";
import { ImportDialog } from "./ImportDialog";

export function Library() {
  const [songs, setSongs] = useState<SongSummary[] | null>(null);
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .songs(search)
      .then(setSongs)
      .catch((cause: Error) => setError(cause.message));
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(load, 150);
    return () => clearTimeout(timer);
  }, [load]);

  const remove = async (song: SongSummary) => {
    if (!confirm(`Apagar "${song.title}" e o ranking dela?`)) return;
    await api.deleteSong(song.id).catch((cause: Error) => setError(cause.message));
    load();
  };

  return (
    <main>
      <div className="mb-6 flex flex-wrap gap-3">
        <input
          className="field max-w-md flex-1"
          placeholder="Buscar por música ou artista"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button className="btn btn-primary ml-auto" onClick={() => setImporting(true)}>
          + Adicionar música
        </button>
      </div>

      {error && <p className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">{error}</p>}

      {songs?.length === 0 && (
        <div className="card p-10 text-center text-white/60">
          {search ? (
            "Nenhuma música encontrada."
          ) : (
            <>
              <p className="mb-1 text-lg font-semibold text-white">Seu acervo está vazio</p>
              <p>Adicione uma música pelo link do YouTube, um arquivo local ou um mapa UltraStar.</p>
            </>
          )}
        </div>
      )}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {songs?.map((song) => (
          <li key={song.id} className="card group flex flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold" title={song.title}>
                  {song.title}
                </h2>
                <p className="truncate text-sm text-white/60">{song.artist}</p>
              </div>
              <button
                className="cursor-pointer text-white/30 opacity-0 transition group-hover:opacity-100 hover:text-red-400 focus:opacity-100"
                title="Apagar música"
                aria-label={`Apagar ${song.title}`}
                onClick={() => remove(song)}
              >
                ✕
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="chip">{clock(song.duration)}</span>
              {song.language && <span className="chip uppercase">{song.language}</span>}
              <span className="chip">{MODE_LABEL[song.scoringMode]}</span>
              <span className="chip">{LYRICS_LABEL[song.lyricsSource]}</span>
            </div>
            <div className="mt-4 flex items-end justify-between">
              <p className="text-xs text-white/50">
                {song.bestScore === null ? (
                  "Ninguém cantou ainda"
                ) : (
                  <>
                    Recorde: <strong className="text-white">{points(song.bestScore)}</strong> · {song.bestPlayer}
                  </>
                )}
              </p>
              <a className="btn btn-primary" href={`#/sing/${encodeURIComponent(song.id)}`}>
                Cantar
              </a>
            </div>
          </li>
        ))}
      </ul>

      {importing && (
        <ImportDialog
          onClose={() => {
            setImporting(false);
            load();
          }}
        />
      )}
    </main>
  );
}

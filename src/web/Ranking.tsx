import { useEffect, useState } from "react";
import type { RankedScore, ScoreEntry } from "../shared/types";
import { api } from "./api";
import { DIFFICULTY_LABEL, points } from "./format";

/** Ranking table. `highlight` marks the entry that was just saved. */
export function ScoreTable({ entries, highlight }: { entries: (ScoreEntry | RankedScore)[]; highlight?: number }) {
  if (!entries.length) return <p className="py-6 text-center text-sm text-white/50">Nenhuma pontuação ainda.</p>;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-white/40 uppercase">
        <tr>
          <th className="py-2 pr-2">#</th>
          <th>Cantor</th>
          {"songTitle" in entries[0]! && <th>Música</th>}
          <th>Nível</th>
          <th className="text-right">Pontos</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, index) => (
          <tr key={entry.id} className={`border-t border-edge ${entry.id === highlight ? "bg-glow/20" : ""}`}>
            <td className="py-2 pr-2 font-bold text-white/50">{index + 1}</td>
            <td className="font-semibold">{entry.player}</td>
            {"songTitle" in entry && (
              <td className="text-white/60">
                <a className="hover:text-white" href={`#/sing/${encodeURIComponent(entry.songId)}`}>
                  {entry.songTitle} · {entry.songArtist}
                </a>
              </td>
            )}
            <td className="text-white/60">{DIFFICULTY_LABEL[entry.difficulty]}</td>
            <td className="text-right font-mono font-bold">{points(entry.score)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Ranking() {
  const [entries, setEntries] = useState<RankedScore[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.ranking().then(setEntries, (cause: Error) => setError(cause.message));
  }, []);

  return (
    <main className="card p-6">
      <h1 className="mb-1 text-xl font-bold">Ranking geral</h1>
      <p className="mb-4 text-sm text-white/50">
        As 100 melhores apresentações. O ranking de cada música aparece ao terminar de cantá-la.
      </p>
      {error && <p className="text-sm text-red-300">{error}</p>}
      {entries && <ScoreTable entries={entries} />}
    </main>
  );
}

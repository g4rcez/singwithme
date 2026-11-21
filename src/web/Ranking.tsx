import type { Performance } from "../shared/types";
import { DIFFICULTY_LABEL, points, when } from "./format";

interface Props {
  entries: Performance[];
  /** Show positions (a ranking) instead of dates (a history). */
  ranked: boolean;
  showSong?: boolean;
  showEvent?: boolean;
  /** Marks the entry that was just saved. */
  highlight?: string;
}

/** Table of performances, used for histories and rankings alike. */
export function PerformanceTable({ entries, ranked, showSong, showEvent, highlight }: Props) {
  if (!entries.length) return <p className="py-6 text-center text-sm text-white/50">Ninguém cantou ainda.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" data-testid="performances">
        <thead className="text-xs text-white/40 uppercase">
          <tr>
            <th className="py-2 pr-3">{ranked ? "#" : "Quando"}</th>
            <th className="pr-3">Quem cantou</th>
            {showSong && <th className="pr-3">Música</th>}
            {showEvent && <th className="pr-3">Evento</th>}
            <th className="pr-3">Nível</th>
            <th className="text-right">Pontos</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => (
            <tr key={entry.id} className={`border-t border-edge ${entry.id === highlight ? "bg-glow/20" : ""}`}>
              <td className="py-2 pr-3 whitespace-nowrap text-white/50">
                {ranked ? index + 1 : when(entry.createdAt)}
              </td>
              <td className="pr-3 font-semibold">{entry.singer}</td>
              {showSong && (
                <td className="pr-3 text-white/60">
                  {entry.songTitle} · {entry.songArtist}
                </td>
              )}
              {showEvent && <td className="pr-3 text-white/60">{entry.eventName}</td>}
              <td className="pr-3 text-white/60">{DIFFICULTY_LABEL[entry.difficulty]}</td>
              <td className="text-right font-mono font-bold">{points(entry.score)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import type { CSSProperties } from "react";
import { lineIndexAt } from "../shared/lyrics";
import type { Line } from "../shared/types";

const progress = (time: number, start: number, end: number) =>
  Math.min(1, Math.max(0, (time - start) / Math.max(0.05, end - start)));

function Wipe({ text, sung }: { text: string; sung: number }) {
  return (
    <span className="wipe" style={{ "--sung": `${(sung * 100).toFixed(1)}%` } as CSSProperties}>
      {text}
    </span>
  );
}

/** Shows the line being sung with a karaoke wipe, plus the line coming next. */
export function Lyrics({ lines, time }: { lines: Line[]; time: number }) {
  const index = lineIndexAt(lines, time);
  const current = index === -1 ? undefined : lines[index];
  const next = index === -1 ? undefined : lines[index + 1];
  const wait = current ? current.start - time : 0;

  return (
    <div className="px-6 text-center drop-shadow-[0_2px_8px_rgb(0_0_0/0.9)]">
      <p className="h-6 text-sm font-semibold tracking-widest text-accent">
        {wait > 3 ? `♪ ${Math.ceil(wait)}s` : wait > 0 ? "●".repeat(Math.ceil(wait)) : ""}
      </p>
      <p className="min-h-[2.6em] text-3xl leading-tight font-extrabold md:text-5xl" data-testid="current-line">
        {current?.words
          ? current.words.map((word, i) => (
              <span key={i}>
                <Wipe text={word.text} sung={progress(time, word.start, word.end)} />{" "}
              </span>
            ))
          : current && <Wipe text={current.text} sung={progress(time, current.start, current.end)} />}
      </p>
      <p className="mt-3 min-h-[1.5em] text-xl font-semibold text-white/45 md:text-2xl">{next?.text}</p>
    </div>
  );
}

import type { Difficulty, LyricsSource, ScoringMode } from "../shared/types";

export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

const DATE = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const when = (timestamp: number) => DATE.format(timestamp);

export const points = (score: number) => score.toLocaleString("pt-BR");

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "Fácil", normal: "Normal", hard: "Difícil" };

export const MODE_LABEL: Record<ScoringMode, string> = {
  notes: "Notas exatas",
  melody: "Melodia estimada",
  rhythm: "Só ritmo",
};

export const MODE_HELP: Record<ScoringMode, string> = {
  notes: "Pontua pela afinação em cada nota do mapa da música.",
  melody: "Pontua comparando sua voz com a melodia estimada da gravação original.",
  rhythm: "Sem melodia de referência: pontua por cantar enquanto a letra está na tela.",
};

export const LYRICS_LABEL: Record<LyricsSource, string> = {
  demo: "Demonstração",
  ultrastar: "UltraStar",
  lrc: "Arquivo LRC",
  lrclib: "LRCLIB",
  "lrclib-loose": "LRCLIB (ajustar atraso)",
  "youtube-subs": "Legenda do YouTube",
  whisper: "Whisper",
};

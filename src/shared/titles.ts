const NOISE =
  /\s*[\(\[\{【][^\)\]\}】]*(official|oficial|video|vídeo|clipe|audio|áudio|lyric|letra|legendado|karaok|hd|hq|4k|remaster|visualizer|m\/v|mv|ao vivo|live|full)[^\)\]\}】]*[\)\]\}】]/gi;

export interface TrackGuess {
  artist: string;
  title: string;
}

/** Best-effort split of a video title such as "Artist - Song (Official Video)" into artist and track. */
export function guessTrack(videoTitle: string, uploader = ""): TrackGuess {
  const cleaned = videoTitle
    .replace(NOISE, "")
    .replace(/\s*\|.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const channel = uploader.replace(/\s*-\s*Topic$/i, "").replace(/\s*VEVO$/i, "").replace(/VEVO$/i, "").trim();
  const parts = cleaned.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    return { artist: parts[0]!.trim(), title: parts.slice(1).join(" - ").replace(/^["“”']|["“”']$/g, "").trim() };
  }
  return { artist: channel || "Desconhecido", title: cleaned || videoTitle };
}

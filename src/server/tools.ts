import type { ToolStatus } from "../shared/types";

interface ToolSpec {
  name: string;
  binaries: string[];
  purpose: string;
  required: boolean;
  install: string;
}

const SPECS: ToolSpec[] = [
  {
    name: "ffmpeg",
    binaries: ["ffmpeg"],
    purpose: "Decodificar áudio e estimar a melodia de referência",
    required: true,
    install: "https://ffmpeg.org/download.html (brew install ffmpeg / apt install ffmpeg)",
  },
  {
    name: "ffprobe",
    binaries: ["ffprobe"],
    purpose: "Ler duração e trilhas da mídia",
    required: true,
    install: "Vem junto com o ffmpeg",
  },
  {
    name: "yt-dlp",
    binaries: ["yt-dlp"],
    purpose: "Baixar músicas do YouTube",
    required: false,
    install: "pip install -U yt-dlp (ou brew install yt-dlp)",
  },
  {
    name: "whisper",
    binaries: ["whisper-ctranslate2", "whisper"],
    purpose: "Transcrever a letra do áudio, offline, em ~100 idiomas",
    required: false,
    install: "pip install -U whisper-ctranslate2 (ou openai-whisper)",
  },
  {
    name: "demucs",
    binaries: ["demucs"],
    purpose: "Separar a voz (playback instrumental e melodia mais precisa)",
    required: false,
    install: "pip install -U demucs",
  },
];

export function findTool(name: string): string | null {
  const spec = SPECS.find((candidate) => candidate.name === name);
  for (const binary of spec?.binaries ?? [name]) {
    const path = Bun.which(binary);
    if (path) return path;
  }
  return null;
}

export function toolStatuses(): ToolStatus[] {
  return SPECS.map(({ name, purpose, required, install }) => {
    const path = findTool(name);
    return { name, found: path !== null, path, purpose, required, install };
  });
}

export function requireTool(name: string): string {
  const path = findTool(name);
  if (path) return path;
  const spec = SPECS.find((candidate) => candidate.name === name);
  throw new Error(`Ferramenta "${name}" não encontrada. Instale com: ${spec?.install ?? name}`);
}

export interface RunOptions {
  cwd?: string;
  /** Called for every line the process prints (stdout and stderr). */
  onLine?: (line: string) => void;
}

/** Runs a command to completion and returns stdout; rejects with the tail of stderr on failure. */
export async function run(command: string[], options: RunOptions = {}): Promise<string> {
  const child = Bun.spawn(command, { cwd: options.cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore" });

  const collect = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    let text = "";
    let pending = "";
    for await (const chunk of stream) {
      const piece = decoder.decode(chunk, { stream: true });
      text += piece;
      if (!options.onLine) continue;
      const rows = (pending + piece).split(/[\r\n]+/);
      pending = rows.pop() ?? "";
      for (const row of rows) if (row.trim()) options.onLine(row);
    }
    if (pending.trim()) options.onLine?.(pending);
    return text;
  };

  const [stdout, stderr, code] = await Promise.all([collect(child.stdout), collect(child.stderr), child.exited]);
  if (code !== 0) {
    const tail = stderr.trim().split("\n").slice(-4).join("\n");
    throw new Error(`${command[0]} falhou (código ${code}): ${tail || "sem saída de erro"}`);
  }
  return stdout;
}

import { basename, extname, join } from "node:path";
import type { Line, Word } from "../../shared/types";
import { requireTool, run } from "../tools";

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
  words?: WhisperWord[];
}

export interface WhisperOutput {
  language?: string;
  segments: WhisperSegment[];
}

/** Whisper sometimes returns very long segments; a karaoke line should fit on screen. */
const MAX_WORDS_PER_LINE = 10;

/** Converts the JSON written by openai-whisper / whisper-ctranslate2 into karaoke lines. */
export function whisperToLines(output: WhisperOutput): Line[] {
  const lines: Line[] = [];
  for (const segment of output.segments) {
    const words: Word[] = (segment.words ?? [])
      .map((word) => ({ start: word.start, end: word.end, text: word.word.trim() }))
      .filter((word) => word.text);

    if (!words.length) {
      const text = segment.text.trim();
      if (text) lines.push({ start: segment.start, end: segment.end, text });
      continue;
    }
    const chunks = Math.ceil(words.length / MAX_WORDS_PER_LINE);
    const size = Math.ceil(words.length / chunks);
    for (let i = 0; i < words.length; i += size) {
      const part = words.slice(i, i + size);
      lines.push({
        start: part[0]!.start,
        end: part.at(-1)!.end,
        text: part.map((word) => word.text).join(" "),
        words: part,
      });
    }
  }
  return lines;
}

export interface Transcription {
  lines: Line[];
  language: string | null;
}

/** Transcribes a recording locally with Whisper, with word-level timestamps. */
export async function transcribe(
  audioFile: string,
  outputDir: string,
  language: string | null,
  onLine: (line: string) => void,
): Promise<Transcription> {
  const whisper = requireTool("whisper");
  const model = process.env.SINGWITHME_WHISPER_MODEL ?? "small";
  const command = [
    whisper,
    audioFile,
    "--model",
    model,
    "--output_format",
    "json",
    "--output_dir",
    outputDir,
    "--word_timestamps",
    "True",
  ];
  if (language) command.push("--language", language);
  await run(command, { onLine });

  const jsonFile = join(outputDir, `${basename(audioFile, extname(audioFile))}.json`);
  const output = (await Bun.file(jsonFile).json()) as WhisperOutput;
  return { lines: whisperToLines(output), language: output.language ?? language };
}

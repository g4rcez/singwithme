export interface Word {
  start: number;
  end: number;
  text: string;
}

export interface Line {
  start: number;
  end: number;
  text: string;
  words?: Word[];
}

export type NoteType = "normal" | "golden" | "freestyle" | "rap";

/** A sung note with a known pitch (comes from UltraStar charts). Times in seconds, pitch in MIDI. */
export interface Note {
  start: number;
  duration: number;
  pitch: number;
  text: string;
  type: NoteType;
}

/** Reference pitch contour estimated from the recording. One MIDI value (or null = unvoiced) per hop. */
export interface Melody {
  hop: number;
  pitches: (number | null)[];
}

export type SongSource = "youtube" | "ultrastar" | "local";
export type LyricsSource = "demo" | "ultrastar" | "lrc" | "lrclib" | "lrclib-loose" | "youtube-subs" | "whisper";

export interface SongSummary {
  id: string;
  /** Owning group; null for songs shared by every group. */
  groupId: string | null;
  title: string;
  artist: string;
  language: string | null;
  duration: number;
  source: SongSource;
  lyricsSource: LyricsSource;
  hasVideo: boolean;
  hasInstrumental: boolean;
  scoringMode: ScoringMode;
  createdAt: number;
  bestScore: number | null;
  bestPlayer: string | null;
}

export interface Song extends SongSummary {
  lines: Line[];
  notes: Note[];
  melody: Melody | null;
  lyricsOffset: number;
  mediaUrl: string;
  instrumentalUrl: string | null;
}

/** notes = exact chart; melody = contour estimated from the audio; rhythm = only "did you sing while lyrics were on". */
export type ScoringMode = "notes" | "melody" | "rhythm";
export type Difficulty = "easy" | "normal" | "hard";

export type JobStatus = "running" | "done" | "error";

export interface Job {
  id: string;
  label: string;
  status: JobStatus;
  step: string;
  progress: number | null;
  log: string[];
  songId: string | null;
  error: string | null;
}

export interface ToolStatus {
  name: string;
  found: boolean;
  path: string | null;
  purpose: string;
  required: boolean;
  install: string;
}

/** A SaaS tenant: a bar, a family, a company. Owns songs, events and their history. */
export interface Group {
  id: string;
  name: string;
  events: EventSummary[];
}

export type EventStatus = "open" | "closed";

/** One karaoke night. Duos, the queue and the performances all belong to an event. */
export interface EventSummary {
  id: string;
  groupId: string;
  name: string;
  status: EventStatus;
  createdAt: number;
  performances: number;
}

/** Two people who sing together during one event. */
export interface Duo {
  id: string;
  name: string;
  members: [string, string];
}

export interface QueueItem {
  id: string;
  songId: string;
  songTitle: string;
  songArtist: string;
  duoId: string;
  duoName: string;
  singing: boolean;
}

export interface EventState {
  event: EventSummary & { groupName: string };
  /** True for a signed-in member of the event's group: they run the queue and show the QR codes. */
  isHost: boolean;
  duos: Duo[];
  queue: QueueItem[];
}

export interface Invite {
  token: string;
  url: string;
}

/** What a phone keeps after registering: the event, the duo and the secret that proves it owns it. */
export interface DuoSession {
  eventId: string;
  duo: Duo;
  secret: string;
}

/** One song sung at an event: the history and the rankings are built from these. */
export interface Performance {
  id: string;
  eventId: string;
  eventName: string;
  songId: string;
  songTitle: string;
  songArtist: string;
  singer: string;
  score: number;
  accuracy: number;
  difficulty: Difficulty;
  createdAt: number;
}

export interface Me {
  /** Null when nobody is signed in. */
  user: { email: string } | null;
  /** accounts: hosted, sign in through Better Auth. local: whoever sits at the karaoke machine (or knows the PIN). */
  auth: "accounts" | "local";
  /** Sign-in methods switched on for this instance (accounts mode). */
  methods: { github: boolean; google: boolean; password: boolean };
  pinRequired: boolean;
  /** Fixed library: importing and deleting songs is disabled. */
  demo: boolean;
}

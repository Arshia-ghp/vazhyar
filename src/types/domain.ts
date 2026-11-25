export const NOTE_KINDS = [
  { value: "word", label: "کلمه" },
  { value: "phrase", label: "عبارت و اصطلاح" },
  { value: "grammar", label: "گرامر" },
  { value: "sentence", label: "جمله کاربردی" },
  { value: "phrasal-verb", label: "فعل عبارتی" },
  { value: "pronunciation", label: "تلفظ" },
  { value: "speaking", label: "اسپیکینگ" }
] as const;

export type NoteKind = (typeof NOTE_KINDS)[number]["value"];
export type ReviewRating = "again" | "hard" | "good" | "easy";
export type FsrsModelVersion = "FSRS-7";

export interface LearningNote {
  id: string;
  kind: NoteKind;
  term: string;
  meaning: string;
  ipa: string;
  structure: string;
  example: string;
  exampleFa: string;
  source: string;
  notes: string;
  starred: boolean;
  normalizedTerm: string;
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp for soft deletion; null/undefined means active. */
  deletedAt?: string | null;
}

/** JSON-safe representation of the FSRS-7 card stored in IndexedDB. */
export interface PersistedFsrsCard {
  cardId: string | number;
  stabilityFast: number;
  stability: number;
  difficulty: number;
  dueAt: string;
  lastReviewAt: string | null;
  reps: number;
  lapses: number;
  scheduledDays: number;
  learningStep?: number;
  state: number;
  scheduleStatus: string;
}

export interface ReviewCardRecord {
  id: string;
  noteId: string;
  card: PersistedFsrsCard;
  updatedAt: string;
  modelVersion: FsrsModelVersion;
}

export interface ReviewLog {
  id: string;
  noteId: string;
  cardId: string;
  rating: ReviewRating;
  reviewedAt: string;
  dueAtBefore: string | null;
  dueAtAfter: string;
  intervalDays: number;
  stateAfter: number;
  stabilityAfter: number;
  stabilityFastAfter: number;
  difficultyAfter: number;
  modelVersion: FsrsModelVersion;
  rawRevlog: Record<string, unknown>;
}

export interface AppMeta {
  key: string;
  value: string;
}

export interface NoteFilters {
  query?: string | null;
  kind?: NoteKind | "all" | null;
  starredOnly?: boolean | null;
  source?: string | null;
  includeDeleted?: boolean | null;
}

export interface MirrorStatus {
  state: "idle" | "ok" | "warning" | "restored";
  message: string;
  savedAt?: string;
  sizeCharacters?: number;
}

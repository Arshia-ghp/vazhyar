import { NOTE_KINDS, type AppMeta, type LearningNote, type NoteKind, type PersistedFsrsCard, type ReviewCardRecord, type ReviewLog } from "../types/domain";
import { db } from "./database";
import { afterDatabaseWrite } from "./mirror";

const BACKUP_FORMAT = "vazhyar-backup" as const;
const BACKUP_VERSION = 2 as const;
const MAX_BACKUP_BYTES = 150 * 1024 * 1024;

export type BackupRestoreMode = "replace" | "merge";

export interface BackupFileV2 {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  app: { name: "واژه‌یار"; dataSchema: 2 };
  data: {
    notes: LearningNote[];
    reviewCards: ReviewCardRecord[];
    reviewLogs: ReviewLog[];
    meta: AppMeta[];
  };
}

interface LegacyBackupFile {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  data: {
    notes: LearningNote[];
    reviewCards: ReviewCardRecord[];
    reviewLogs: ReviewLog[];
  };
}

type ParsedBackup = BackupFileV2 | LegacyBackupFile;
const NOTE_KIND_VALUES = new Set<string>(NOTE_KINDS.map((item) => item.value));
const REVIEW_RATINGS = new Set(["again", "hard", "good", "easy"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoLikeDate(value: unknown, nullable = false): value is string | null {
  if (nullable && value === null) return true;
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

function isLearningNote(value: unknown): value is LearningNote {
  if (!isRecord(value)) return false;
  const stringFields = ["id", "term", "meaning", "ipa", "structure", "example", "exampleFa", "source", "notes", "normalizedTerm", "createdAt", "updatedAt"];
  if (!stringFields.every((key) => typeof value[key] === "string")) return false;
  if (!NOTE_KIND_VALUES.has(String(value["kind"])) || typeof value["starred"] !== "boolean") return false;
  if (value["deletedAt"] !== undefined && !isIsoLikeDate(value["deletedAt"], true)) return false;
  return typeof value["id"] === "string" && value["id"].length > 0
    && typeof value["term"] === "string" && value["term"].trim().length > 0;
}

function isPersistedCard(value: unknown): value is PersistedFsrsCard {
  if (!isRecord(value)) return false;
  const numericFields = ["stabilityFast", "stability", "difficulty", "reps", "lapses", "scheduledDays", "state"];
  if (!numericFields.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]))) return false;
  if (!isIsoLikeDate(value["dueAt"]) || !isIsoLikeDate(value["lastReviewAt"], true)) return false;
  if (typeof value["scheduleStatus"] !== "string" || !value["scheduleStatus"].trim()) return false;
  if (typeof value["cardId"] !== "string" && typeof value["cardId"] !== "number") return false;
  if (typeof value["cardId"] === "number" && !Number.isFinite(value["cardId"])) return false;
  if (typeof value["cardId"] === "string" && !value["cardId"].trim()) return false;
  if (value["learningStep"] !== undefined && (typeof value["learningStep"] !== "number" || !Number.isInteger(value["learningStep"]) || value["learningStep"] < 0)) return false;
  const stabilityFast = value["stabilityFast"] as number;
  const stability = value["stability"] as number;
  const difficulty = value["difficulty"] as number;
  const reps = value["reps"] as number;
  const lapses = value["lapses"] as number;
  const scheduledDays = value["scheduledDays"] as number;
  const state = value["state"] as number;
  return stabilityFast >= 0 && stability >= 0 && difficulty >= 0 && difficulty <= 10
    && reps >= 0 && lapses >= 0 && scheduledDays >= 0 && Number.isInteger(state) && state >= 0 && state <= 3;
}

function isReviewCard(value: unknown): value is ReviewCardRecord {
  return isRecord(value)
    && typeof value["id"] === "string"
    && typeof value["noteId"] === "string"
    && typeof value["updatedAt"] === "string"
    && value["modelVersion"] === "FSRS-7"
    && isPersistedCard(value["card"]);
}

function isReviewLog(value: unknown): value is ReviewLog {
  if (!isRecord(value)) return false;
  const numericFields = ["intervalDays", "stateAfter", "stabilityAfter", "stabilityFastAfter", "difficultyAfter"];
  return typeof value["id"] === "string"
    && typeof value["noteId"] === "string"
    && typeof value["cardId"] === "string"
    && REVIEW_RATINGS.has(String(value["rating"]))
    && isIsoLikeDate(value["reviewedAt"])
    && isIsoLikeDate(value["dueAtBefore"], true)
    && isIsoLikeDate(value["dueAtAfter"])
    && numericFields.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]))
    && value["modelVersion"] === "FSRS-7"
    && isRecord(value["rawRevlog"]);
}

function isAppMeta(value: unknown): value is AppMeta {
  return isRecord(value) && typeof value["key"] === "string" && typeof value["value"] === "string";
}

function parseBackup(value: unknown): ParsedBackup {
  if (!isRecord(value) || value["format"] !== BACKUP_FORMAT || !isRecord(value["data"])) {
    throw new Error("فایل انتخاب‌شده پشتیبان معتبر واژه‌یار نیست.");
  }

  const data = value["data"];
  const rawNotes = data["notes"];
  const rawCards = data["reviewCards"];
  const rawLogs = data["reviewLogs"];
  if (!Array.isArray(rawNotes) || !rawNotes.every(isLearningNote)
    || !Array.isArray(rawCards) || !rawCards.every(isReviewCard)
    || !Array.isArray(rawLogs) || !rawLogs.every(isReviewLog)) {
    throw new Error("ساختار داده‌های داخل پشتیبان ناقص یا نامعتبر است؛ هیچ اطلاعاتی تغییر نکرد.");
  }

  const notes = rawNotes as LearningNote[];
  const reviewCards = rawCards as ReviewCardRecord[];
  const reviewLogs = rawLogs as ReviewLog[];
  const exportedAt = typeof value["exportedAt"] === "string" ? value["exportedAt"] : "";

  if (value["version"] === 1) {
    return { format: BACKUP_FORMAT, version: 1, exportedAt, data: { notes, reviewCards, reviewLogs } };
  }

  if (value["version"] === 2) {
    const rawMeta = data["meta"];
    if (!Array.isArray(rawMeta) || !rawMeta.every(isAppMeta)) {
      throw new Error("بخش تنظیمات داخلی پشتیبان نامعتبر است.");
    }
    return {
      format: BACKUP_FORMAT,
      version: 2,
      exportedAt,
      app: { name: "واژه‌یار", dataSchema: 2 },
      data: { notes, reviewCards, reviewLogs, meta: rawMeta as AppMeta[] }
    };
  }

  throw new Error("نسخه این پشتیبان با برنامه فعلی سازگار نیست.");
}

export async function createBackupObject(): Promise<BackupFileV2> {
  const [notes, reviewCards, reviewLogs, meta] = await db.transaction(
    "r", db.notes, db.reviewCards, db.reviewLogs, db.meta,
    () => Promise.all([db.notes.toArray(), db.reviewCards.toArray(), db.reviewLogs.toArray(), db.meta.toArray()])
  );
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: { name: "واژه‌یار", dataSchema: 2 },
    data: { notes, reviewCards, reviewLogs, meta }
  };
}

export async function createBackupFile(): Promise<Blob> {
  return new Blob([JSON.stringify(await createBackupObject(), null, 2)], { type: "application/json;charset=utf-8" });
}

export async function downloadBackup(): Promise<void> {
  const blob = await createBackupFile();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `vazhyar-full-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function importBackupFile(file: File, mode: BackupRestoreMode = "merge"): Promise<{ notes: number; cards: number; logs: number; meta: number }> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error("حجم فایل پشتیبان بیش از حد مجاز است (۱۵۰ مگابایت).");
  const parsed: unknown = JSON.parse(await file.text());
  const backup = parseBackup(parsed);
  const { notes, reviewCards, reviewLogs } = backup.data;
  const meta = backup.version === 2 ? backup.data.meta : [];

  const noteIds = new Set(notes.map((note) => note.id));
  if (reviewCards.some((card) => !noteIds.has(card.noteId)) || reviewLogs.some((log) => !noteIds.has(log.noteId))) {
    throw new Error("پشتیبان شامل کارت یا سابقه‌ای است که یادداشت متناظر آن وجود ندارد.");
  }

  await afterDatabaseWrite(async () => {
    await db.transaction("rw", db.notes, db.reviewCards, db.reviewLogs, db.meta, async () => {
      if (mode === "replace") {
        await Promise.all([db.notes.clear(), db.reviewCards.clear(), db.reviewLogs.clear(), db.meta.clear()]);
      }
      await db.notes.bulkPut(notes);
      await db.reviewCards.bulkPut(reviewCards);
      await db.reviewLogs.bulkPut(reviewLogs);
      if (meta.length > 0) await db.meta.bulkPut(meta);
    });
  });

  return { notes: notes.length, cards: reviewCards.length, logs: reviewLogs.length, meta: meta.length };
}

export interface BackupValidationSummary {
  valid: boolean;
  version: number | null;
  notes: number;
  cards: number;
  logs: number;
}

export async function inspectBackupFile(file: File): Promise<BackupValidationSummary> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error("حجم فایل بیش از حد مجاز است.");
  const backup = parseBackup(JSON.parse(await file.text()));
  return { valid: true, version: backup.version, notes: backup.data.notes.length, cards: backup.data.reviewCards.length, logs: backup.data.reviewLogs.length };
}

export const BACKUP_CATEGORY_OPTIONS: ReadonlyArray<{ value: NoteKind; label: string }> = NOTE_KINDS;

import Dexie, { type Table } from "dexie";
import type {
  AppMeta,
  LearningNote,
  ReviewCardRecord,
  ReviewLog
} from "../types/domain";

export class LearningDatabase extends Dexie {
  notes!: Table<LearningNote, string>;
  reviewCards!: Table<ReviewCardRecord, string>;
  reviewLogs!: Table<ReviewLog, string>;
  meta!: Table<AppMeta, string>;

  constructor() {
    super("vazhyar-learning-db");

    this.version(1).stores({
      notes: "&id, kind, updatedAt, normalizedTerm, createdAt, source",
      reviewCards: "&id, noteId, updatedAt, modelVersion",
      reviewLogs: "&id, noteId, cardId, reviewedAt, rating, [noteId+reviewedAt]",
      meta: "&key"
    });

    this.version(2)
      .stores({
        notes: "&id, kind, updatedAt, normalizedTerm, createdAt, source, deletedAt",
        reviewCards: "&id, noteId, updatedAt, modelVersion",
        reviewLogs: "&id, noteId, cardId, reviewedAt, rating, [noteId+reviewedAt]",
        meta: "&key"
      })
      .upgrade(async (transaction) => {
        // Existing Phase 1 records remain active; only the new field is added.
        await transaction.table<LearningNote>("notes").toCollection().modify((note: LearningNote) => {
          if (note.deletedAt === undefined) note.deletedAt = null;
        });
      });
  }
}

export const db = new LearningDatabase();

export async function openDatabase(): Promise<void> {
  await db.open();
}

/** Ask the browser to protect this Origin's storage from automatic eviction. */
export async function requestPersistentStorage(): Promise<boolean | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return null;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

import type {
  LearningNote,
  NoteKind,
  ReviewCardRecord,
  ReviewLog,
  ReviewRating
} from "../types/domain";
import { createId, normalizeText, safeArray } from "../lib/safe";
import { filterNotes } from "../lib/filters";
import { db } from "./database";
import { afterDatabaseWrite, announceLocalDataChange, writeEmergencyMirror } from "./mirror";
import {
  calculateFsrsReviewWithScheduler,
  createInitialFsrsCard,
  getFsrsScheduler,
  type AppliedReview
} from "./fsrs";

export interface CreateNoteInput {
  kind: NoteKind;
  term: string;
  meaning?: string;
  ipa?: string;
  structure?: string;
  example?: string;
  exampleFa?: string;
  source?: string;
  notes?: string;
}

export type CreateNoteResult =
  | { created: true; note: LearningNote }
  | { created: false; duplicate: LearningNote };

export async function createNote(input: CreateNoteInput): Promise<CreateNoteResult> {
  const term = input.term.trim();
  const normalizedTerm = normalizeText(term);
  if (!term || !normalizedTerm) throw new Error("متن انگلیسی نمی‌تواند خالی باشد.");

  // Fast path for the common case; a second check inside the write
  // transaction closes the race between tabs sharing the same IndexedDB.
  const duplicate = await db.notes.where("normalizedTerm").equals(normalizedTerm).filter((note) => !note.deletedAt).first();
  if (duplicate) return { created: false, duplicate };

  const now = new Date().toISOString();
  const id = createId();
  const note: LearningNote = {
    id,
    kind: input.kind,
    term,
    meaning: input.meaning?.trim() ?? "",
    ipa: input.ipa?.trim() ?? "",
    structure: input.structure?.trim() ?? "",
    example: input.example?.trim() ?? "",
    exampleFa: input.exampleFa?.trim() ?? "",
    source: input.source?.trim() ?? "",
    notes: input.notes?.trim() ?? "",
    starred: false,
    normalizedTerm,
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };
  const fsrsCard = await createInitialFsrsCard(id);
  const cardRecord: ReviewCardRecord = {
    id,
    noteId: id,
    card: fsrsCard,
    updatedAt: now,
    modelVersion: "FSRS-7"
  };

  const transactionResult = await db.transaction(
    "rw",
    db.notes,
    db.reviewCards,
    async (): Promise<CreateNoteResult> => {
      const duplicateInsideTransaction = await db.notes
        .where("normalizedTerm")
        .equals(normalizedTerm)
        .filter((candidate) => !candidate.deletedAt)
        .first();
      if (duplicateInsideTransaction) {
        return { created: false, duplicate: duplicateInsideTransaction };
      }

      await db.notes.add(note);
      await db.reviewCards.add(cardRecord);
      return { created: true, note };
    }
  );

  if (!transactionResult.created) return transactionResult;
  await writeEmergencyMirror();
  announceLocalDataChange();
  return transactionResult;
}

export type UpdateNoteResult =
  | { updated: true; note: LearningNote }
  | { updated: false; duplicate: LearningNote };

export async function updateNote(noteId: string, input: CreateNoteInput): Promise<UpdateNoteResult> {
  const term = input.term.trim();
  const normalizedTerm = normalizeText(term);
  if (!term || !normalizedTerm) throw new Error("متن انگلیسی نمی‌تواند خالی باشد.");

  const resultHolder: { value: UpdateNoteResult | null } = { value: null };
  await afterDatabaseWrite(async () => {
    await db.transaction("rw", db.notes, async () => {
      const current = await db.notes.get(noteId);
      if (!current || current.deletedAt) throw new Error("یادداشت برای ویرایش پیدا نشد.");
      const duplicate = await db.notes
        .where("normalizedTerm")
        .equals(normalizedTerm)
        .filter((candidate) => candidate.id !== noteId && !candidate.deletedAt)
        .first();
      if (duplicate) {
        resultHolder.value = { updated: false, duplicate };
        return;
      }
      const updated: LearningNote = {
        ...current,
        kind: input.kind,
        term,
        normalizedTerm,
        meaning: input.meaning?.trim() ?? "",
        ipa: input.ipa?.trim() ?? "",
        structure: input.structure?.trim() ?? "",
        example: input.example?.trim() ?? "",
        exampleFa: input.exampleFa?.trim() ?? "",
        source: input.source?.trim() ?? "",
        notes: input.notes?.trim() ?? "",
        updatedAt: new Date().toISOString()
      };
      await db.notes.put(updated);
      resultHolder.value = { updated: true, note: updated };
    });
  });
  if (!resultHolder.value) throw new Error("ویرایش یادداشت انجام نشد.");
  return resultHolder.value;
}

export async function updateNoteStar(noteId: string, starred: boolean): Promise<void> {
  await afterDatabaseWrite(async () => {
    await db.transaction("rw", db.notes, async () => {
      const note = await db.notes.get(noteId);
      if (!note || note.deletedAt) throw new Error("یادداشت فعال موردنظر پیدا نشد.");
      await db.notes.put({ ...note, starred, updatedAt: new Date().toISOString() });
    });
  });
}

export async function deleteNote(noteId: string): Promise<void> {
  await afterDatabaseWrite(async () => {
    await db.transaction("rw", db.notes, async () => {
      const note = await db.notes.get(noteId);
      if (!note || note.deletedAt) return;
      const now = new Date().toISOString();
      await db.notes.put({ ...note, deletedAt: now, updatedAt: now });
    });
  });
}

export async function restoreNote(noteId: string): Promise<void> {
  await afterDatabaseWrite(async () => {
    await db.transaction("rw", db.notes, async () => {
      const note = await db.notes.get(noteId);
      if (!note) throw new Error("یادداشت پیدا نشد.");
      const duplicate = await db.notes
        .where("normalizedTerm")
        .equals(note.normalizedTerm)
        .filter((candidate) => candidate.id !== noteId && !candidate.deletedAt)
        .first();
      if (duplicate) throw new Error(`یادداشت فعال «${duplicate.term}» با همین عبارت وجود دارد.`);
      await db.notes.put({ ...note, deletedAt: null, updatedAt: new Date().toISOString() });
    });
  });
}

export async function getFilteredNotes(
  query?: string | null,
  kind?: NoteKind | "all" | null,
  starredOnly?: boolean | null
): Promise<LearningNote[]> {
  const allNotes = await db.notes.toArray();
  return filterNotes(allNotes, { query, kind, starredOnly });
}

export async function getNoteReviewHistory(noteId: string): Promise<ReviewLog[]> {
  const logs = await db.reviewLogs.where("noteId").equals(noteId).toArray();
  return safeArray(logs).sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt));
}

export async function reviewNote(
  noteId: string,
  rating: ReviewRating
): Promise<AppliedReview> {
  // Resolve the scheduler before opening the transaction. No network or
  // non-Dexie await is allowed while the IndexedDB transaction is active.
  const scheduler = await getFsrsScheduler();
  let applied: AppliedReview | null = null;

  await afterDatabaseWrite(async () => {
    await db.transaction("rw", db.notes, db.reviewCards, db.reviewLogs, async () => {
      const note = await db.notes.get(noteId);
      if (!note || note.deletedAt) throw new Error("یادداشت فعال برای ثبت مرور پیدا نشد.");
      const currentCard = await db.reviewCards.get(noteId);
      if (!currentCard) throw new Error("کارت مرور این یادداشت پیدا نشد.");

      const result = calculateFsrsReviewWithScheduler(
        scheduler,
        currentCard.card,
        noteId,
        rating,
        new Date()
      );
      applied = result;

      const updatedAt = new Date().toISOString();
      await db.reviewCards.put({
        ...currentCard,
        card: result.card,
        updatedAt,
        modelVersion: "FSRS-7"
      });
      await db.reviewLogs.add(result.log);
    });
  });

  if (!applied) throw new Error("نتیجه مرور ساخته نشد.");
  return applied;
}

export async function getDueNotes(now = new Date()): Promise<LearningNote[]> {
  const [notes, cards] = await Promise.all([db.notes.toArray(), db.reviewCards.toArray()]);
  const dueIds = new Set(
    safeArray(cards as Array<ReviewCardRecord | null | undefined>).flatMap((record) => {
      if (!record || typeof record.noteId !== "string") return [];
      const due = new Date(record.card?.dueAt ?? "");
      return Number.isFinite(due.getTime()) && due.getTime() <= now.getTime()
        ? [record.noteId]
        : [];
    })
  );
  return safeArray(notes).filter((note) => !note.deletedAt && dueIds.has(note.id));
}

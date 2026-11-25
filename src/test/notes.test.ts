import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../services/database";
import { createNote, deleteNote, restoreNote, updateNote, updateNoteStar } from "../services/notes";

beforeEach(async () => {
  await db.delete();
  await db.open();
  window.localStorage.clear();
});

afterEach(() => {
  db.close();
});

describe("local note management", () => {
  it("detects normalized duplicates and lets a soft-deleted item be replaced", async () => {
    const first = await createNote({ kind: "word", term: "Look after", meaning: "مراقبت کردن" });
    expect(first.created).toBe(true);
    if (!first.created) return;

    const duplicate = await createNote({ kind: "phrase", term: " look   AFTER " });
    expect(duplicate.created).toBe(false);

    await deleteNote(first.note.id);
    const deleted = await db.notes.get(first.note.id);
    expect(deleted?.deletedAt).toEqual(expect.any(String));

    const replacement = await createNote({ kind: "phrase", term: "look after" });
    expect(replacement.created).toBe(true);
  });

  it("updates the record, stars it and restores without discarding the review card", async () => {
    const created = await createNote({ kind: "word", term: "resilient", meaning: "تاب‌آور" });
    expect(created.created).toBe(true);
    if (!created.created) return;

    const updated = await updateNote(created.note.id, {
      kind: "word", term: "resilient", meaning: "مقاوم و تاب‌آور", ipa: "/rɪˈzɪliənt/"
    });
    expect(updated.updated).toBe(true);
    await updateNoteStar(created.note.id, true);
    await deleteNote(created.note.id);
    await restoreNote(created.note.id);

    const restored = await db.notes.get(created.note.id);
    expect(restored?.meaning).toBe("مقاوم و تاب‌آور");
    expect(restored?.starred).toBe(true);
    expect(restored?.deletedAt).toBeNull();
    expect(await db.reviewCards.get(created.note.id)).toBeDefined();
  });

  it("does not restore over an active duplicate", async () => {
    const original = await createNote({ kind: "word", term: "take off" });
    expect(original.created).toBe(true);
    if (!original.created) return;
    await deleteNote(original.note.id);
    const replacement = await createNote({ kind: "phrasal-verb", term: "take off" });
    expect(replacement.created).toBe(true);

    await expect(restoreNote(original.note.id)).rejects.toThrow("یادداشت فعال");
  });
});

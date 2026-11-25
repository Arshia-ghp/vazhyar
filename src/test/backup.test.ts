import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../services/database";
import { importBackupFile } from "../services/backup";
import type { LearningNote } from "../types/domain";

const note: LearningNote = {
  id: "backup-note", kind: "word", term: "resilient", meaning: "تاب‌آور", ipa: "", structure: "", example: "", exampleFa: "",
  source: "جلسه ۱", notes: "", starred: false, normalizedTerm: "resilient", createdAt: "2026-11-25T10:00:00.000Z",
  updatedAt: "2026-11-25T10:00:00.000Z", deletedAt: null
};

beforeEach(async () => {
  await db.delete();
  await db.open();
  window.localStorage.clear();
});

afterEach(() => db.close());

describe("complete JSON backup restore", () => {
  it("replaces all local learning tables atomically from a v2 backup", async () => {
    await db.notes.put({ ...note, id: "old", term: "old", normalizedTerm: "old" });
    const payload = {
      format: "vazhyar-backup", version: 2, exportedAt: new Date().toISOString(), app: { name: "واژه‌یار", dataSchema: 2 },
      data: { notes: [note], reviewCards: [], reviewLogs: [], meta: [{ key: "x", value: "y" }] }
    };
    const file = new File([JSON.stringify(payload)], "backup.json", { type: "application/json" });
    const result = await importBackupFile(file, "replace");

    expect(result.notes).toBe(1);
    expect(await db.notes.count()).toBe(1);
    expect(await db.notes.get("backup-note")).toEqual(note);
    expect(await db.meta.get("x")).toEqual({ key: "x", value: "y" });
  });

  it("accepts legacy v1 backup files without the meta table", async () => {
    const payload = {
      format: "vazhyar-backup", version: 1, exportedAt: new Date().toISOString(),
      data: { notes: [note], reviewCards: [], reviewLogs: [] }
    };
    const file = new File([JSON.stringify(payload)], "legacy.json", { type: "application/json" });
    const result = await importBackupFile(file, "merge");
    expect(result.notes).toBe(1);
    expect(result.meta).toBe(0);
    expect(await db.notes.get(note.id)).toEqual(note);
  });

  it("rejects malformed data before changing existing records", async () => {
    await db.notes.put(note);
    const file = new File([JSON.stringify({ format: "vazhyar-backup", version: 2, data: { notes: [{ id: "bad" }], reviewCards: [], reviewLogs: [], meta: [] } })], "bad.json");
    await expect(importBackupFile(file, "replace")).rejects.toThrow();
    expect(await db.notes.get(note.id)).toEqual(note);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { db } from "../services/database";
import {
  clearEmergencyMirrorForTests,
  restoreMirrorIfDatabaseEmpty,
  writeEmergencyMirror
} from "../services/mirror";
import type { LearningNote } from "../types/domain";

const note: LearningNote = {
  id: "mirror-note-1",
  kind: "word",
  term: "resilient",
  meaning: "تاب‌آور",
  ipa: "/rɪˈzɪliənt/",
  structure: "adjective",
  example: "She is resilient.",
  exampleFa: "او تاب‌آور است.",
  source: "test",
  notes: "",
  starred: false,
  normalizedTerm: "resilient",
  createdAt: "2026-11-25T12:00:00.000Z",
  updatedAt: "2026-11-25T12:00:00.000Z"
};

afterEach(async () => {
  await db.delete();
  clearEmergencyMirrorForTests();
});

describe("Emergency localStorage mirror", () => {
  it("restores a note when IndexedDB is empty and the mirror remains intact", async () => {
    await db.open();
    await db.notes.put(note);
    await writeEmergencyMirror();

    await db.delete();
    const restored = await restoreMirrorIfDatabaseEmpty();

    expect(restored).toBe(true);
    expect(await db.notes.get(note.id)).toEqual(note);
  });
});

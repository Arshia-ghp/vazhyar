import { describe, expect, it } from "vitest";
import { calculateLearningStatistics } from "../services/analytics";
import type { LearningNote, PersistedFsrsCard, ReviewCardRecord, ReviewLog } from "../types/domain";

const baseDate = new Date(2026, 10, 25, 12, 0, 0);
const dueTodayIso = new Date(2026, 10, 25, 10, 0, 0).toISOString();
const lastReviewIso = new Date(2026, 10, 24, 10, 0, 0).toISOString();

function makeNote(id: string, kind: LearningNote["kind"]): LearningNote {
  return {
    id, kind, term: id, meaning: "معنی", ipa: "", structure: "", example: "", exampleFa: "", source: "", notes: "",
    starred: false, normalizedTerm: id, createdAt: baseDate.toISOString(), updatedAt: baseDate.toISOString(), deletedAt: null
  };
}

function makeCard(noteId: string, overrides: Partial<PersistedFsrsCard> = {}): ReviewCardRecord {
  return {
    id: noteId, noteId, updatedAt: baseDate.toISOString(), modelVersion: "FSRS-7",
    card: {
      cardId: noteId, stabilityFast: 1, stability: 25, difficulty: 5, dueAt: dueTodayIso,
      lastReviewAt: lastReviewIso, reps: 6, lapses: 0, scheduledDays: 25, state: 2, scheduleStatus: "review", ...overrides
    }
  };
}

function makeLog(id: string, reviewedAt: string): ReviewLog {
  return {
    id, noteId: "a", cardId: "a", rating: "good", reviewedAt, dueAtBefore: null,
    dueAtAfter: reviewedAt, intervalDays: 1, stateAfter: 2, stabilityAfter: 25,
    stabilityFastAfter: 1, difficultyAfter: 5, modelVersion: "FSRS-7", rawRevlog: {}
  };
}

describe("learning analytics", () => {
  it("calculates due, mastery, categories, activity and streak from real events", () => {
    const notes = [makeNote("a", "word"), makeNote("b", "grammar"), { ...makeNote("deleted", "word"), deletedAt: baseDate.toISOString() }];
    const cards = [makeCard("a"), makeCard("b", { stability: 4, reps: 2, state: 1 })];
    const logs = [
      makeLog("today", new Date(2026, 10, 25, 9).toISOString()),
      makeLog("yesterday", new Date(2026, 10, 24, 9).toISOString()),
      makeLog("two-days", new Date(2026, 10, 23, 9).toISOString())
    ];
    const result = calculateLearningStatistics(notes, cards, logs, baseDate, 14);

    expect(result.totalNotes).toBe(2);
    expect(result.dueToday).toBe(2);
    expect(result.mastered).toBe(1);
    expect(result.streakDays).toBe(3);
    expect(result.reviewEvents).toBe(3);
    expect(result.activity).toHaveLength(14);
    expect(result.categories.find((item) => item.kind === "word")?.count).toBe(1);
  });

  it("does not count an expired streak as current", () => {
    const logs = [makeLog("old", new Date(2026, 10, 20, 9).toISOString())];
    const result = calculateLearningStatistics([makeNote("a", "word")], [], logs, baseDate, 7);
    expect(result.streakDays).toBe(0);
  });
});
import { describe, expect, it } from "vitest";
import { filterNotes } from "../lib/filters";
import type { LearningNote } from "../types/domain";

const sample: LearningNote = {
  id: "1",
  kind: "word",
  term: "Look after",
  meaning: "مراقبت کردن",
  ipa: "/lʊk ˈæftər/",
  structure: "look after + object",
  example: "I look after my sister.",
  exampleFa: "من از خواهرم مراقبت می‌کنم.",
  source: "جلسه اول",
  notes: "",
  starred: true,
  normalizedTerm: "look after",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

describe("filterNotes", () => {
  it("is safe with null, undefined and partial filters", () => {
    expect(filterNotes(null, undefined)).toEqual([]);
    expect(filterNotes([null, undefined, sample], null)).toEqual([sample]);
  });

  it("normalizes search text and applies optional category/star filters", () => {
    expect(filterNotes([sample], { query: "  LOOK   AFTER " })).toEqual([sample]);
    expect(filterNotes([sample], { kind: "grammar" })).toEqual([]);
    expect(filterNotes([sample], { starredOnly: true })).toEqual([sample]);
    expect(filterNotes([sample], { starredOnly: false, kind: "all" })).toEqual([sample]);
  });

  it("accepts omitted filters and ignores nullish data", () => {
    expect(filterNotes([null, undefined, sample])).toEqual([sample]);
  });

  it("normalizes Persian and Arabic yeh/kaf and filters by source", () => {
    const persianNote = { ...sample, term: "Teacher", meaning: "علي كاتب", source: "جلسه ۲" };
    expect(filterNotes([persianNote], { query: "علی کاتب" })).toEqual([persianNote]);
    expect(filterNotes([persianNote], { source: "جلسه ۲" })).toEqual([persianNote]);
    expect(filterNotes([persianNote], { source: "جلسه ۱" })).toEqual([]);
  });

  it("hides soft-deleted records unless the caller explicitly includes them", () => {
    const deleted = { ...sample, deletedAt: "2026-11-25T10:00:00.000Z" };
    expect(filterNotes([sample, deleted])).toEqual([sample]);
    expect(filterNotes([sample, deleted], { includeDeleted: true })).toHaveLength(2);
  });
});

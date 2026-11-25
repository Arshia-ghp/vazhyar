import { describe, expect, it } from "vitest";
import {
  calculateFsrsReview,
  createInitialFsrsCard,
  deserializeFsrsCard,
  previewFsrsRatings,
  resolveReviewTime
} from "../services/fsrs";

describe("FSRS-7 defensive adapter", () => {
  const fixedNow = new Date("2026-11-25T12:00:00.000Z");

  it("creates a finite initial card and previews all four grades", async () => {
    const card = await createInitialFsrsCard("test-card", fixedNow);
    const previews = await previewFsrsRatings(card, fixedNow);

    expect(previews).toHaveLength(4);
    expect(previews.every((item) => Number.isFinite(item.intervalMs))).toBe(true);
    expect(previews.every((item) => Number.isFinite(new Date(item.dueAt).getTime()))).toBe(true);
  });

  it("rejects corrupt dates and NaN memory values before calling FSRS", async () => {
    const card = await createInitialFsrsCard("bad-card", fixedNow);
    expect(deserializeFsrsCard({ ...card, dueAt: "not-a-date" })).toBeNull();
    expect(deserializeFsrsCard({ ...card, stability: Number.NaN })).toBeNull();
    await expect(previewFsrsRatings({ ...card, dueAt: "not-a-date" }, fixedNow)).rejects.toThrow();
  });

  it("uses the current time when the supplied Date is invalid", () => {
    expect(Number.isFinite(resolveReviewTime(new Date(Number.NaN)).getTime())).toBe(true);
  });

  it("rejects clock rollback before the scheduler can corrupt elapsed time", async () => {
    const first = await createInitialFsrsCard("clock-card", fixedNow);
    const reviewed = await calculateFsrsReview(first, "clock-card", "good", fixedNow);
    const earlier = new Date(fixedNow.getTime() - 60_000);
    await expect(previewFsrsRatings(reviewed.card, earlier)).rejects.toThrow(/عقب‌تر/);
    await expect(calculateFsrsReview(reviewed.card, "clock-card", "good", earlier)).rejects.toThrow(/عقب‌تر/);
  });

  it("produces a valid next due date and immutable review log", async () => {
    const card = await createInitialFsrsCard("review-card", fixedNow);
    const applied = await calculateFsrsReview(card, "review-card", "good", fixedNow);

    expect(Number.isFinite(new Date(applied.card.dueAt).getTime())).toBe(true);
    expect(applied.log.rating).toBe("good");
    expect(Number.isFinite(applied.log.intervalDays)).toBe(true);
    expect(applied.log.modelVersion).toBe("FSRS-7");
  });
});

import { describe, expect, it } from "vitest";
import { remoteWins, toSyncRecords } from "../services/syncMerge";

describe("sync merge rules", () => {
  it("accepts a newer remote timestamp", () => {
    expect(remoteWins({ updatedAt: "2026-01-01T10:00:00.000Z" }, { updatedAt: "2026-01-01T10:00:01.000Z" })).toBe(true);
  });

  it("keeps local when it is newer", () => {
    expect(remoteWins({ updatedAt: "2026-01-01T10:00:02.000Z" }, { updatedAt: "2026-01-01T10:00:01.000Z" })).toBe(false);
  });

  it("uses the server value for an exact timestamp tie", () => {
    expect(remoteWins({ updatedAt: "2026-01-01T10:00:00.000Z" }, { updatedAt: "2026-01-01T10:00:00.000Z" })).toBe(true);
  });

  it("stops Full Push instead of silently skipping malformed local data", () => {
    expect(() => toSyncRecords([
      { id: "valid", updatedAt: "2026-01-01T10:00:00.000Z" },
      { id: "bad-date", updatedAt: "not-a-date" }
    ])).toThrow(/زمان معتبر/);
  });
});

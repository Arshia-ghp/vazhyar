import type { LearningNote, ReviewCardRecord, ReviewLog } from "../types/domain";
import { db } from "./database";
import { writeEmergencyMirror } from "./mirror";
import type { PullPage, SyncEntity, SyncRecord } from "./syncTypes";

function timestamp(value: unknown): number {
  if (typeof value !== "string" || !value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function differs(left: unknown, right: unknown): boolean {
  return stableStringify(left) !== stableStringify(right);
}


/**
 * Last-Write-Wins by updatedAt. On exact timestamp ties, the server's
 * already-stored representation wins. Both server adapters use strict `>`
 * when accepting writes, so a subsequent Full Pull converges both devices.
 */
export function remoteWins<T extends { updatedAt?: string }>(local: T | undefined, remote: T): boolean {
  if (!local) return true;
  const localTime = timestamp(local.updatedAt);
  const remoteTime = timestamp(remote.updatedAt);
  if (remoteTime !== localTime) return remoteTime > localTime;
  // A tie means the backend did not accept the local write; pull its value.
  return true;
}

export interface MergeCounts {
  insertedOrUpdated: number;
  unchanged: number;
}

export async function mergePulledPage(entity: SyncEntity, page: PullPage): Promise<MergeCounts> {
  if (page.records.length === 0) return { insertedOrUpdated: 0, unchanged: 0 };
  let insertedOrUpdated = 0;
  let unchanged = 0;

  await db.transaction("rw", db.notes, db.reviewCards, db.reviewLogs, async () => {
    if (entity === "notes") {
      const incoming = page.records.map((row) => {
        const value = row.payload as LearningNote;
        if (!value || typeof value.id !== "string" || value.id !== row.id || timestamp(value.updatedAt) <= 0) {
          throw new Error(`رکورد یادداشت ${row.id || "بدون شناسه"} در سرور ساختار یا تاریخ معتبری ندارد؛ دریافت کامل متوقف شد.`);
        }
        return value;
      });
      const ids = incoming.map((row) => row.id);
      const existing = await db.notes.bulkGet(ids);
      const winners: LearningNote[] = [];
      incoming.forEach((remote, index) => {
        const local = existing[index];
        if (remoteWins(local, remote) && (!local || timestamp(remote.updatedAt) > timestamp(local.updatedAt) || differs(local, remote))) {
          winners.push(remote);
        } else unchanged += 1;
      });
      if (winners.length) {
        await db.notes.bulkPut(winners);
        insertedOrUpdated += winners.length;
      }
    } else if (entity === "reviewCards") {
      const incoming = page.records.map((row) => {
        const value = row.payload as ReviewCardRecord;
        if (!value || typeof value.id !== "string" || value.id !== row.id || timestamp(value.updatedAt) <= 0
          || timestamp(value.card?.dueAt) <= 0 || typeof value.noteId !== "string") {
          throw new Error(`کارت مرور ${row.id || "بدون شناسه"} در سرور ساختار یا زمان‌بندی معتبری ندارد؛ دریافت کامل متوقف شد.`);
        }
        return value;
      });
      const ids = incoming.map((row) => row.id);
      const existing = await db.reviewCards.bulkGet(ids);
      const winners: ReviewCardRecord[] = [];
      incoming.forEach((remote, index) => {
        const local = existing[index];
        if (remoteWins(local, remote) && (!local || timestamp(remote.updatedAt) > timestamp(local.updatedAt) || differs(local, remote))) {
          winners.push(remote);
        } else unchanged += 1;
      });
      if (winners.length) {
        await db.reviewCards.bulkPut(winners);
        insertedOrUpdated += winners.length;
      }
    } else {
      const incoming = page.records.map((row) => {
        const value = row.payload as ReviewLog;
        if (!value || typeof value.id !== "string" || value.id !== row.id || timestamp(value.reviewedAt) <= 0
          || typeof value.noteId !== "string" || typeof value.cardId !== "string") {
          throw new Error(`رویداد مرور ${row.id || "بدون شناسه"} در سرور معتبر نیست؛ دریافت کامل متوقف شد.`);
        }
        return value;
      });
      const ids = incoming.map((row) => row.id);
      const existing = await db.reviewLogs.bulkGet(ids);
      const winners: ReviewLog[] = [];
      incoming.forEach((remote, index) => {
        if (!existing[index]) winners.push(remote);
        else unchanged += 1;
      });
      if (winners.length) {
        await db.reviewLogs.bulkPut(winners);
        insertedOrUpdated += winners.length;
      }
    }
  });

  return { insertedOrUpdated, unchanged };
}

export function toSyncRecords(values: unknown[]): SyncRecord[] {
  return values.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`رکورد محلی شماره ${index + 1} ساختار معتبری ندارد؛ برای جلوگیری از جاافتادن داده، Full Push متوقف شد.`);
    }
        const row = value as Record<string, unknown>;
        const id = typeof row["id"] === "string" ? row["id"] : "";
	const updatedAt = typeof row["updatedAt"] === "string"
          ? row["updatedAt"]
         : typeof row["reviewedAt"] === "string" ? row["reviewedAt"] : "";
    if (!id || !Number.isFinite(Date.parse(updatedAt))) {
      throw new Error(`رکورد محلی شماره ${index + 1} شناسه یا زمان معتبر ندارد؛ داده را در همان دستگاه بررسی کن.`);
    }
    return { id, updatedAt, payload: row };
  });
}

export async function refreshEmergencyMirrorAfterSync(): Promise<void> {
  // Remote sync must not be rolled back just because the optional mirror is full.
  try {
    await writeEmergencyMirror();
  } catch (error) {
    console.warn("Emergency mirror could not be refreshed after sync", error);
  }
}

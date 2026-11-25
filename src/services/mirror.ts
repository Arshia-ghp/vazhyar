import type {
  AppMeta,
  LearningNote,
  MirrorStatus,
  ReviewCardRecord,
  ReviewLog
} from "../types/domain";
import { db, openDatabase, requestPersistentStorage } from "./database";

const MIRROR_KEY = "vazhyar.emergency-mirror.v1";
const MIRROR_SCHEMA_VERSION = 2;
// localStorage quotas vary. Keep a safety margin below common per-origin limits.
const MAX_MIRROR_CHARACTERS = 1_800_000;
const STATUS_EVENT = "vazhyar:mirror-status";

interface MirrorPayload {
  notes: LearningNote[];
  reviewCards: ReviewCardRecord[];
  reviewLogs: ReviewLog[];
  meta: AppMeta[];
}

interface MirrorEnvelope {
  schemaVersion: number;
  savedAt: string;
  payload: MirrorPayload;
  checksum: string;
}

let currentMirrorStatus: MirrorStatus = {
  state: "idle",
  message: "هنوز نسخه اضطراری ساخته نشده است."
};

function checksum(text: string): string {
  // FNV-1a is an integrity check, not a cryptographic signature.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function hasLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function publishStatus(status: MirrorStatus): void {
  currentMirrorStatus = status;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<MirrorStatus>(STATUS_EVENT, { detail: status }));
  }
}

export function getMirrorStatus(): MirrorStatus {
  return currentMirrorStatus;
}

export function subscribeMirrorStatus(callback: (status: MirrorStatus) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const listener = (event: Event): void => {
    const customEvent = event as CustomEvent<MirrorStatus>;
    callback(customEvent.detail);
  };
  window.addEventListener(STATUS_EVENT, listener);
  return () => window.removeEventListener(STATUS_EVENT, listener);
}

function validatePayload(value: unknown): value is MirrorPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MirrorPayload>;
  return (
    Array.isArray(candidate.notes) &&
    Array.isArray(candidate.reviewCards) &&
    Array.isArray(candidate.reviewLogs) &&
    (candidate.meta === undefined || Array.isArray(candidate.meta))
  );
}

function readMirror(): MirrorEnvelope | null {
  if (!hasLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(MIRROR_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const envelope = parsed as Partial<MirrorEnvelope>;
    if (
      (envelope.schemaVersion !== 1 && envelope.schemaVersion !== MIRROR_SCHEMA_VERSION) ||
      typeof envelope.savedAt !== "string" ||
      !validatePayload(envelope.payload) ||
      typeof envelope.checksum !== "string"
    ) {
      return null;
    }

    const serializedPayload = JSON.stringify(envelope.payload);
    if (checksum(serializedPayload) !== envelope.checksum) return null;

    const oldPayload = envelope.payload as MirrorPayload;
    return {
      ...(envelope as MirrorEnvelope),
      schemaVersion: MIRROR_SCHEMA_VERSION,
      payload: { ...oldPayload, meta: Array.isArray(oldPayload.meta) ? oldPayload.meta : [] }
    };
  } catch {
    return null;
  }
}

async function writeEmergencyMirrorInternal(): Promise<MirrorStatus> {
  if (!hasLocalStorage()) {
    const status: MirrorStatus = {
      state: "warning",
      message: "localStorage در این محیط در دسترس نیست؛ فقط IndexedDB فعال است."
    };
    publishStatus(status);
    return status;
  }

  try {
    const payload = await db.transaction("r", db.notes, db.reviewCards, db.reviewLogs, db.meta, async () => {
      const [notes, reviewCards, reviewLogs, meta] = await Promise.all([
        db.notes.toArray(),
        db.reviewCards.toArray(),
        db.reviewLogs.toArray(),
        db.meta.toArray()
      ]);
      return { notes, reviewCards, reviewLogs, meta } satisfies MirrorPayload;
    });
    const serializedPayload = JSON.stringify(payload);
    const envelope: MirrorEnvelope = {
      schemaVersion: MIRROR_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      payload,
      checksum: checksum(serializedPayload)
    };
    const serializedEnvelope = JSON.stringify(envelope);

    if (serializedEnvelope.length > MAX_MIRROR_CHARACTERS) {
      throw new Error(
        "حجم نسخه اضطراری از سقف ایمن localStorage بیشتر شده است. داده اصلی در IndexedDB باقی است؛ خروجی پشتیبان بگیرید."
      );
    }

    // setItem replaces the old snapshot atomically from the script's perspective.
    window.localStorage.setItem(MIRROR_KEY, serializedEnvelope);
    const status: MirrorStatus = {
      state: "ok",
      message: "نسخه اضطراری محلی به‌روز است.",
      savedAt: envelope.savedAt,
      sizeCharacters: serializedEnvelope.length
    };
    publishStatus(status);
    return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : "ساخت نسخه اضطراری ناموفق بود.";
    const status: MirrorStatus = {
      state: "warning",
      message: `${message} نسخه اصلی در IndexedDB ذخیره شده است.`
    };
    publishStatus(status);
    return status;
  }
}

// Serialize mirror writes so concurrent commits cannot let an older snapshot
// overwrite a newer one after an asynchronous read completes.
let mirrorQueue: Promise<unknown> = Promise.resolve();

export function writeEmergencyMirror(): Promise<MirrorStatus> {
  const next = mirrorQueue.then(writeEmergencyMirrorInternal, writeEmergencyMirrorInternal);
  mirrorQueue = next.then(() => undefined, () => undefined);
  return next;
}

/**
 * Best-effort mirror update after a successful IndexedDB transaction.
 * A mirror failure must not roll back or hide a successful primary write.
 */
let localChangesChannel: BroadcastChannel | null = null;

export function announceLocalDataChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("vazhyar:local-data-changed"));
  // Custom DOM events do not cross tabs. Keep one channel alive so an active
  // sync tab can request another Full Push after a sibling tab writes locally.
  try {
    if ("BroadcastChannel" in window) {
      localChangesChannel ??= new BroadcastChannel("vazhyar-local-data-v1");
      localChangesChannel.postMessage({ type: "changed", at: Date.now() });
    }
  } catch {
    // Same-tab event still works when BroadcastChannel is unavailable.
  }
}

export async function afterDatabaseWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = await operation();
  await writeEmergencyMirror();
  announceLocalDataChange();
  return result;
}

export async function restoreMirrorIfDatabaseEmpty(): Promise<boolean> {
  await openDatabase();
  const [noteCount, cardCount, logCount] = await Promise.all([
    db.notes.count(),
    db.reviewCards.count(),
    db.reviewLogs.count()
  ]);

  if (noteCount + cardCount + logCount > 0) {
    await writeEmergencyMirror();
    return false;
  }

  const mirror = readMirror();
  if (!mirror) {
    const status: MirrorStatus = {
      state: "warning",
      message: "پایگاه داده خالی است و نسخه اضطراری معتبر پیدا نشد."
    };
    publishStatus(status);
    return false;
  }

  await db.transaction("rw", db.notes, db.reviewCards, db.reviewLogs, db.meta, async () => {
    await db.notes.bulkPut(mirror.payload.notes);
    await db.reviewCards.bulkPut(mirror.payload.reviewCards);
    await db.reviewLogs.bulkPut(mirror.payload.reviewLogs);
    await db.meta.bulkPut(mirror.payload.meta);
  });

  const status: MirrorStatus = {
    state: "restored",
    message: "اطلاعات از نسخه اضطراری localStorage بازیابی شد.",
    savedAt: mirror.savedAt
  };
  publishStatus(status);
  return true;
}

let initializePromise: Promise<void> | null = null;

export function initializeLocalDatabase(): Promise<void> {
  if (!initializePromise) {
    initializePromise = (async () => {
      await restoreMirrorIfDatabaseEmpty();
      await openDatabase();
      // This is a browser request, not a guarantee; denial does not block the app.
      await requestPersistentStorage();
      // If there was no mirror yet, create the first snapshot.
      if (!readMirror()) await writeEmergencyMirror();
    })().catch((error: unknown) => {
      initializePromise = null;
      throw error;
    });
  }
  return initializePromise;
}

export function clearEmergencyMirrorForTests(): void {
  if (hasLocalStorage()) window.localStorage.removeItem(MIRROR_KEY);
}

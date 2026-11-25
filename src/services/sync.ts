import { db } from "./database";
import { AppsScriptProvider } from "./appsScriptTransport";
import { mergePulledPage, refreshEmergencyMirrorAfterSync, toSyncRecords } from "./syncMerge";
import { getAppsScriptPin, loadSyncSettings } from "./syncSettings";
import { SupabaseSyncProvider } from "./supabaseProvider";
import type {
  LocalSyncSnapshot,
  SyncEntity,
  SyncPhase,
  SyncProvider,
  SyncSettings,
  SyncStatus
} from "./syncTypes";

const DEVICE_ID_KEY = "vazhyar.sync.device-id.v1";
const LOCK_KEY = "vazhyar.sync.local-lock.v1";
const PAGE_SIZE = 25;
const PUSH_BATCH_SIZE = 20;
const MAX_PULL_PAGES_PER_ENTITY = 20_000;
const STABILITY_PASSES = 3;
const FALLBACK_LOCK_TTL_MS = 180_000;
const FALLBACK_LOCK_HEARTBEAT_MS = 15_000;
let inMemoryLockHeld = false;

const listeners = new Set<(status: SyncStatus) => void>();
let runningPromise: Promise<SyncResult> | null = null;
let rerunRequested = false;

export interface SyncResult {
  pushed: number;
  pulled: number;
  completedAt: string;
  provider: SyncSettings["provider"];
  snapshotToken: string;
}

const initialStatus: SyncStatus = {
  phase: "idle", message: "همگام‌سازی هنوز انجام نشده است.", startedAt: null,
  finishedAt: null, lastSuccessAt: null, pushed: 0, pulled: 0, error: null
};
let status: SyncStatus = { ...initialStatus };

export function getSyncStatus(): SyncStatus { return { ...status }; }
export function subscribeSyncStatus(listener: (next: SyncStatus) => void): () => void {
  listeners.add(listener);
  listener(getSyncStatus());
  return () => listeners.delete(listener);
}
function publish(next: Partial<SyncStatus>): void {
  status = { ...status, ...next };
  listeners.forEach((listener) => {
    try { listener(getSyncStatus()); } catch (error) { console.error("Sync status subscriber failed", error); }
  });
}
function setPhase(phase: SyncPhase, message: string): void { publish({ phase, message, error: null }); }

function getDeviceId(): string {
  const createId = () => typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = createId();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    // Private browsing/storage restrictions must not prevent a local sync run.
    return createId();
  }
}

async function readSnapshot(): Promise<LocalSyncSnapshot> {
  return db.transaction("r", db.notes, db.reviewCards, db.reviewLogs, async () => {
    const [notes, reviewCards, reviewLogs] = await Promise.all([
      db.notes.toArray(), db.reviewCards.toArray(), db.reviewLogs.toArray()
    ]);
    return { notes, reviewCards, reviewLogs };
  });
}

function getProvider(settings: SyncSettings): SyncProvider {
  if (settings.provider === "apps-script") {
    const pin = getAppsScriptPin();
    if (!settings.appsScriptUrl) throw new Error("نشانی Web App گوگل را وارد کن.");
    if (pin.length < 32) throw new Error("PIN همگام‌سازی باید حداقل ۳۲ نویسه داشته باشد.");
    return new AppsScriptProvider(settings.appsScriptUrl, pin);
  }
  return new SupabaseSyncProvider(settings);
}

async function withCrossTabLock<T>(task: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request("vazhyar-full-sync", { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock) throw new Error("همگام‌سازی در تب یا پنجره دیگری در حال اجراست؛ چند لحظه دیگر تلاش کن.");
      return task();
    });
  }

  // Fallback for browsers without Web Locks. A renewable lease avoids a stale
  // 60-second lock when a large library needs many timed network batches.
  let storageUsable = false;
  try {
    const probe = `${LOCK_KEY}.probe`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    storageUsable = true;
  } catch {
    storageUsable = false;
  }

  if (!storageUsable) {
    if (inMemoryLockHeld) throw new Error("همگام‌سازی در همین برنامه در حال اجراست.");
    inMemoryLockHeld = true;
    try { return await task(); }
    finally { inMemoryLockHeld = false; }
  }

  const owner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = Date.now();
  const readLease = (): { owner?: string; expiresAt?: number } | null => {
    try { return JSON.parse(localStorage.getItem(LOCK_KEY) ?? "null") as { owner?: string; expiresAt?: number } | null; }
    catch { return null; }
  };
  const previous = readLease();
  if (previous?.expiresAt && previous.expiresAt > now) {
    throw new Error("همگام‌سازی در تب یا پنجره دیگری در حال اجراست؛ چند لحظه دیگر تلاش کن.");
  }
  localStorage.setItem(LOCK_KEY, JSON.stringify({ owner, expiresAt: now + FALLBACK_LOCK_TTL_MS }));
  if (readLease()?.owner !== owner) throw new Error("قفل همگام‌سازی در تب دیگری گرفته شد؛ دوباره تلاش کن.");

  const heartbeat = window.setInterval(() => {
    const lease = readLease();
    if (lease?.owner === owner) {
      try { localStorage.setItem(LOCK_KEY, JSON.stringify({ owner, expiresAt: Date.now() + FALLBACK_LOCK_TTL_MS })); }
      catch { /* The in-flight operation still has its request timeouts. */ }
    }
  }, FALLBACK_LOCK_HEARTBEAT_MS);

  try {
    return await task();
  } finally {
    window.clearInterval(heartbeat);
    if (readLease()?.owner === owner) {
      try { localStorage.removeItem(LOCK_KEY); } catch { /* no-op */ }
    }
  }
}

async function pushSnapshot(provider: SyncProvider, snapshot: LocalSyncSnapshot): Promise<number> {
  let pushed = 0;
  const groups: Array<[SyncEntity, unknown[]]> = [
    ["notes", snapshot.notes],
    ["reviewCards", snapshot.reviewCards],
    ["reviewLogs", snapshot.reviewLogs]
  ];
  for (const [entity, values] of groups) {
    const records = toSyncRecords(values);
    for (let index = 0; index < records.length; index += PUSH_BATCH_SIZE) {
      const batch = records.slice(index, index + PUSH_BATCH_SIZE);
      const result = await provider.push(entity, batch);
      pushed += result.accepted;
      publish({ pushed });
    }
  }
  return pushed;
}

async function pullFullSnapshot(provider: SyncProvider): Promise<{ pulled: number; token: string }> {
  let pulled = 0;
  let snapshotToken = "0";
  let reachedStableSnapshot = false;
  const entities: SyncEntity[] = ["notes", "reviewCards", "reviewLogs"];

  // Full snapshot read, followed by a revision check. If a remote write
  // changes a row while paging, it gets a newer revision and is read again
  // from page one on the next pass. Never claim success on an unstable pull.
  for (let pass = 0; pass < STABILITY_PASSES; pass += 1) {
    const snapshot = await provider.beginPull();
    snapshotToken = snapshot.token;
    for (const entity of entities) {
      let cursor: string | number | null = null;
      let pageCount = 0;
      while (true) {
        pageCount += 1;
        if (pageCount > MAX_PULL_PAGES_PER_ENTITY) throw new Error("تعداد صفحات همگام‌سازی از حد ایمن بیشتر شد.");
        const page = await provider.pullPage(entity, snapshot, cursor, PAGE_SIZE);
        const merged = await mergePulledPage(entity, page);
        pulled += merged.insertedOrUpdated;
        publish({ pulled });
        if (page.done) break;
        if (page.nextCursor === null || page.nextCursor === cursor) {
          throw new Error("نشانگر صفحه‌بندی سرور پیشرفت نکرد؛ برای جلوگیری از حلقه بی‌نهایت سینک متوقف شد.");
        }
        cursor = page.nextCursor;
      }
    }
    const latest = await provider.beginPull();
    if (latest.token === snapshot.token) {
      reachedStableSnapshot = true;
      break;
    }
    if (pass < STABILITY_PASSES - 1) {
      publish({ message: "سرور هم‌زمان تغییر کرده است؛ دریافت کامل از ابتدا تکرار می‌شود…" });
    }
  }

  if (!reachedStableSnapshot) {
    throw new Error("هنگام دریافت کامل، داده‌های سرور پیوسته تغییر کردند. اطلاعات محلی حفظ شده‌اند؛ دوباره همگام‌سازی را اجرا کن.");
  }
  return { pulled, token: snapshotToken };
}

async function persistSyncMetadata(completedAt: string, deviceId: string): Promise<void> {
  await db.meta.bulkPut([
    { key: "sync.lastSuccessfulAt", value: completedAt },
    { key: "sync.deviceId", value: deviceId }
  ]);
}

async function performSync(settings: SyncSettings): Promise<SyncResult> {
  if (!navigator.onLine) throw new Error("این دستگاه آفلاین است؛ تغییرات محلی حفظ شده‌اند و بعد از اتصال دوباره سینک می‌شوند.");
  setPhase("connecting", "در حال برقراری ارتباط امن با سرویس همگام‌سازی…");
  const provider = getProvider(settings);
  const deviceId = getDeviceId();
  try {
    const localSnapshot = await readSnapshot();
    setPhase("pushing", "در حال ارسال همه تغییرات محلی (Full Push)…");
    await pushSnapshot(provider, localSnapshot);
    setPhase("pulling", "در حال دریافت کامل اطلاعات سرور (Full Pull)…");
    const pulled = await pullFullSnapshot(provider);
    setPhase("merging", "در حال ثبت نهایی تغییرات و Mirror اضطراری…");
    const completedAt = new Date().toISOString();
    await persistSyncMetadata(completedAt, deviceId);
    await refreshEmergencyMirrorAfterSync();
    return { pushed: status.pushed, pulled: pulled.pulled, completedAt, provider: settings.provider, snapshotToken: pulled.token };
  } finally {
    provider.close?.();
  }
}

export function runSync(settings = loadSyncSettings()): Promise<SyncResult> {
  if (runningPromise) {
    // A local edit that lands during a snapshot requests one more full pass.
    rerunRequested = true;
    return runningPromise;
  }
  const startedAt = new Date().toISOString();
  publish({
    phase: "connecting", message: "آماده‌سازی همگام‌سازی…", startedAt,
    finishedAt: null, pushed: 0, pulled: 0, error: null
  });
  const runUntilStable = async (): Promise<SyncResult> => {
    let result: SyncResult | null = null;
    do {
      rerunRequested = false;
      publish({ pushed: 0, pulled: 0 });
      result = await withCrossTabLock(() => performSync(settings));
    } while (rerunRequested && navigator.onLine);
    if (!result) throw new Error("همگام‌سازی نتیجه‌ای تولید نکرد.");
    return result;
  };
  runningPromise = runUntilStable()
    .then((result) => {
      publish({
        phase: "success", message: `همگام‌سازی کامل شد؛ ${result.pushed} ارسال و ${result.pulled} تغییر دریافت شد.`,
        finishedAt: result.completedAt, lastSuccessAt: result.completedAt, error: null
      });
      return result;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "همگام‌سازی ناموفق بود.";
      publish({ phase: "error", message, finishedAt: new Date().toISOString(), error: message });
      throw error;
    })
    .finally(() => { runningPromise = null; rerunRequested = false; });
  return runningPromise;
}

export async function testAppsScriptConnection(endpoint: string, pin: string): Promise<string> {
  const provider = new AppsScriptProvider(endpoint, pin);
  const result = await provider.ping();
  if (!result.ok) throw new Error("پاسخ Google Apps Script معتبر نیست.");
  return result.spreadsheet;
}

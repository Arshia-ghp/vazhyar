import {
  AlertCircle, BarChart3, BookOpen, CheckCircle2, Cloud, CloudOff, DatabaseBackup, Download,
  GraduationCap, Library, Moon, NotebookPen, Plus, RefreshCw, ShieldCheck, Star, Sun, Upload,
  Wifi, WifiOff, X, ClipboardList
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { safeArray } from "./lib/safe";
import { db } from "./services/database";
import { downloadBackup, importBackupFile } from "./services/backup";
import { applyPwaUpdate, registerPwaLifecycle } from "./services/pwa";
import {
  getMirrorStatus, initializeLocalDatabase, subscribeMirrorStatus, writeEmergencyMirror
} from "./services/mirror";
import { reviewNote } from "./services/notes";
import { previewFsrsRatings, type RatingPreview } from "./services/fsrs";
import { NoteEditorPage } from "./pages/NoteEditorPage";
import { MyBankPage } from "./pages/MyBankPage";
import { ReviewPage } from "./pages/ReviewPage";
import { StatsPage } from "./pages/StatsPage";
import { DataToolsPage } from "./pages/DataToolsPage";
import { SyncPage } from "./pages/SyncPage";
import { hasSyncConfiguration, loadSyncSettings } from "./services/syncSettings";
import { runSync } from "./services/sync";
import { getSupabaseSessionLabel } from "./services/supabaseProvider";
import {
  NOTE_KINDS,
  type LearningNote,
  type MirrorStatus,
  type ReviewCardRecord,
  type ReviewLog,
  type ReviewRating
} from "./types/domain";

type Palette = "violet" | "ocean" | "emerald" | "amber";
type ColorMode = "light" | "dark";
type Page = "dashboard" | "editor" | "bank" | "review" | "stats" | "data" | "sync";
interface Preferences { palette: Palette; mode: ColorMode; }

const THEME_STORAGE_KEY = "vazhyar.preferences.v1";
const DEFAULT_PREFERENCES: Preferences = { palette: "violet", mode: "light" };
const RATING_META: Array<{ value: ReviewRating; label: string; tone: string }> = [
  { value: "again", label: "دوباره", tone: "rating-again" },
  { value: "hard", label: "سخت", tone: "rating-hard" },
  { value: "good", label: "خوب", tone: "rating-good" },
  { value: "easy", label: "آسان", tone: "rating-easy" }
];

function readPreferences(): Preferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? "null") as Partial<Preferences> | null;
    const palette: Palette = ["violet", "ocean", "emerald", "amber"].includes(String(parsed?.palette)) ? parsed!.palette as Palette : "violet";
    return { palette, mode: parsed?.mode === "dark" ? "dark" : "light" };
  } catch { return DEFAULT_PREFERENCES; }
}
function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(date) : "تاریخ نامعتبر";
}
function formatInterval(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "نامشخص";
  if (milliseconds < 60_000) return "کمتر از ۱ دقیقه";
  if (milliseconds < 3_600_000) return `${Math.max(1, Math.round(milliseconds / 60_000))} دقیقه`;
  if (milliseconds < 86_400_000) return `${(milliseconds / 3_600_000).toFixed(1)} ساعت`;
  return `${(milliseconds / 86_400_000).toFixed(1)} روز`;
}
function kindLabel(value: string): string { return NOTE_KINDS.find((item) => item.value === value)?.label ?? "یادداشت"; }

export default function App() {
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const [page, setPage] = useState<Page>("dashboard");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [mirrorStatus, setMirrorStatus] = useState<MirrorStatus>(getMirrorStatus());
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<RatingPreview[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [backingUp, setBackingUp] = useState(false);

  const notes = useLiveQuery(
    async () => (await db.notes.orderBy("updatedAt").reverse().toArray()).filter((note) => !note.deletedAt),
    [], [] as LearningNote[]
  );
  const cards = useLiveQuery(() => db.reviewCards.toArray(), [], [] as ReviewCardRecord[]);
  const recentLogs = useLiveQuery(() => db.reviewLogs.orderBy("reviewedAt").reverse().limit(8).toArray(), [], [] as ReviewLog[]);
  const reviewCount = useLiveQuery(() => db.reviewLogs.count(), [], 0);
  const activeReviewNote = useMemo(
    () => safeArray(notes).find((note) => note.id === activeReviewId) ?? safeArray(notes)[0] ?? null,
    [notes, activeReviewId]
  );
  const activeCard = useLiveQuery(
    async () => activeReviewNote ? await db.reviewCards.get(activeReviewNote.id) : undefined,
    [activeReviewNote?.id]
  );
  const dueCount = useMemo(() => {
    const activeIds = new Set(safeArray(notes).map((note) => note.id));
    return safeArray(cards).filter((record) => {
      if (!activeIds.has(record?.noteId)) return false;
      const date = new Date(record?.card?.dueAt ?? "");
      return Number.isFinite(date.getTime()) && date.getTime() <= Date.now();
    }).length;
  }, [cards, notes]);
  const starredCount = useMemo(() => safeArray(notes).filter((note) => note.starred).length, [notes]);

  useEffect(() => {
    let mounted = true;
    void initializeLocalDatabase().then(() => { if (mounted) setReady(true); })
      .catch((error: unknown) => setBootError(error instanceof Error ? error.message : "بازکردن پایگاه داده ناموفق بود."));
    const unsubscribe = subscribeMirrorStatus(setMirrorStatus);
    return () => { mounted = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    document.documentElement.dataset["theme"] = preferences.palette;
    document.documentElement.dataset["mode"] = preferences.mode;
    const colors: Record<Palette, string> = { violet: "#6d5ce7", ocean: "#1679a6", emerald: "#16845b", amber: "#b7791f" };
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", preferences.mode === "dark" ? "#11121a" : colors[preferences.palette]);
    try { localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(preferences)); } catch { /* preference is non-critical */ }
  }, [preferences]);

  useEffect(() => {
    const setIsOnline = () => setOnline(true);
    const setIsOffline = () => setOnline(false);
    const update = () => setUpdateAvailable(true);
    const offline = () => setOfflineReady(true);
    window.addEventListener("online", setIsOnline);
    window.addEventListener("offline", setIsOffline);
    window.addEventListener("vazhyar:pwa-update", update);
    window.addEventListener("vazhyar:pwa-offline-ready", offline);
    try { registerPwaLifecycle(); } catch (error) { console.warn("PWA lifecycle unavailable", error); }
    return () => {
      window.removeEventListener("online", setIsOnline);
      window.removeEventListener("offline", setIsOffline);
      window.removeEventListener("vazhyar:pwa-update", update);
      window.removeEventListener("vazhyar:pwa-offline-ready", offline);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    let lastAttempt = 0;
    const attemptAutomaticSync = (force = false) => {
      if (!alive || !navigator.onLine) return;
      const settings = loadSyncSettings();
      if (!settings.autoSync || !hasSyncConfiguration(settings)) return;
      const now = Date.now();
      if (!force && now - lastAttempt < 8_000) return;
      lastAttempt = now;
      if (settings.provider === "supabase") {
        void getSupabaseSessionLabel(settings).then((label) => {
          if (alive && label) void runSync(settings).catch(() => undefined);
        }).catch(() => undefined);
      } else {
        void runSync(settings).catch(() => undefined);
      }
    };
    const handleOnline = () => { attemptAutomaticSync(); };
    const onVisibility = () => { if (document.visibilityState === "visible") attemptAutomaticSync(); };
    let changeTimer = 0;
    const onLocalDataChanged = () => {
      if (changeTimer) window.clearTimeout(changeTimer);
      changeTimer = window.setTimeout(() => attemptAutomaticSync(true), 1_200);
    };
    let crossTabChannel: BroadcastChannel | null = null;
    try {
      if ("BroadcastChannel" in window) {
        crossTabChannel = new BroadcastChannel("vazhyar-local-data-v1");
        crossTabChannel.addEventListener("message", onLocalDataChanged);
      }
    } catch { crossTabChannel = null; }
    window.addEventListener("online", handleOnline);
    window.addEventListener("vazhyar:local-data-changed", onLocalDataChanged);
    document.addEventListener("visibilitychange", onVisibility);
    attemptAutomaticSync();
    return () => {
      alive = false;
      if (changeTimer) window.clearTimeout(changeTimer);
      crossTabChannel?.removeEventListener("message", onLocalDataChanged);
      crossTabChannel?.close();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("vazhyar:local-data-changed", onLocalDataChanged);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ready]);

  useEffect(() => {
    let current = true;
    if (!activeCard?.card) {
      setPreviews([]);
      setPreviewError(null);
      return () => { current = false; };
    }
    void previewFsrsRatings(activeCard.card).then((result) => {
      if (current) { setPreviews(result); setPreviewError(null); }
    }).catch((error: unknown) => {
      if (current) { setPreviews([]); setPreviewError(error instanceof Error ? error.message : "پیش‌نمایش FSRS در دسترس نیست."); }
    });
    return () => { current = false; };
  }, [activeCard]);

  function notify(message: string, error = false): void { setToast({ message, error }); }
  function startNewNote(): void { setEditingId(null); setPage("editor"); }
  function editNote(noteId: string): void { setEditingId(noteId); setPage("editor"); }
  function savedNote(note: LearningNote): void {
    setEditingId(null);
    setPage("bank");
    setActiveReviewId(note.id);
    notify("یادداشت با موفقیت در حافظه محلی ذخیره شد.");
  }

  async function handleReview(rating: ReviewRating): Promise<void> {
    if (!activeReviewNote || reviewing) return;
    setReviewing(true);
    try {
      const result = await reviewNote(activeReviewNote.id, rating);
      const label = RATING_META.find((item) => item.value === rating)?.label ?? "مرور";
      notify(`${label} ثبت شد. موعد بعدی: ${formatDate(result.card.dueAt)}.`);
    } catch (error) { notify(error instanceof Error ? error.message : "ثبت مرور ناموفق بود.", true); }
    finally { setReviewing(false); }
  }

  async function exportBackup(): Promise<void> {
    setBackingUp(true);
    try { await downloadBackup(); notify("فایل پشتیبان آماده شد."); }
    catch (error) { notify(error instanceof Error ? error.message : "تهیه پشتیبان ناموفق بود.", true); }
    finally { setBackingUp(false); }
  }
  async function importBackup(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    try { const result = await importBackupFile(file, "merge"); notify(`${result.notes} یادداشت از پشتیبان ادغام شد.`); }
    catch (error) { notify(error instanceof Error ? error.message : "بازیابی پشتیبان ناموفق بود.", true); }
    finally { event.target.value = ""; }
  }
  async function mirrorNow(): Promise<void> {
    try { await writeEmergencyMirror(); notify("Mirror اضطراری به‌روز شد."); }
    catch (error) { notify(error instanceof Error ? error.message : "ساخت Mirror ناموفق بود.", true); }
  }

  if (bootError) return <main className="error-screen" dir="rtl"><section className="error-panel"><AlertCircle size={32} /><h1>بازکردن پایگاه داده ناموفق بود</h1><p className="muted">{bootError}</p><button className="button button-primary" type="button" onClick={() => location.reload()}><RefreshCw size={15} /> تلاش دوباره</button></section></main>;
  if (!ready) return <div className="app-boot" role="status">در حال آماده‌سازی پایگاه داده محلی…</div>;

  return (
    <div className="app-shell" dir="rtl">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark"><BookOpen size={21} /></div><div><div className="brand-title">واژه‌یار</div><div className="brand-subtitle">دفترچه هوشمند انگلیسی به فارسی</div></div></div>
        <nav className="main-nav" aria-label="ناوبری اصلی">
          <button type="button" className={page === "dashboard" ? "nav-link active" : "nav-link"} onClick={() => setPage("dashboard")}><GraduationCap size={16} /> داشبورد</button>
          <button type="button" className={page === "editor" ? "nav-link active" : "nav-link"} onClick={startNewNote}><NotebookPen size={16} /> ثبت / ویرایش</button>
          <button type="button" className={page === "bank" ? "nav-link active" : "nav-link"} onClick={() => { setEditingId(null); setPage("bank"); }}><Library size={16} /> بانک من</button>
          <button type="button" className={page === "review" ? "nav-link active" : "nav-link"} onClick={() => setPage("review")}><ClipboardList size={16} /> مرور</button>
          <button type="button" className={page === "stats" ? "nav-link active" : "nav-link"} onClick={() => setPage("stats")}><BarChart3 size={16} /> آمار</button>
          <button type="button" className={page === "data" ? "nav-link active" : "nav-link"} onClick={() => setPage("data")}><DatabaseBackup size={16} /> داده‌ها</button>
          <button type="button" className={page === "sync" ? "nav-link active" : "nav-link"} onClick={() => setPage("sync")}><RefreshCw size={16} /> همگام‌سازی</button>
        </nav>
        <div className="topbar-actions">
          <div className={`connection-pill ${online ? "is-online" : "is-offline"}`} title={online ? "اتصال اینترنت برقرار است" : "برنامه در حالت آفلاین است"}>{online ? <Wifi size={14} /> : <WifiOff size={14} />}<span>{online ? "آنلاین" : "آفلاین"}</span></div>
          <button className="icon-button" type="button" onClick={() => setPreferences((current) => ({ ...current, mode: current.mode === "dark" ? "light" : "dark" }))} aria-label="تغییر حالت شب">{preferences.mode === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>
          <select className="theme-select" aria-label="انتخاب تم رنگی" value={preferences.palette} onChange={(event) => setPreferences((current) => ({ ...current, palette: event.target.value as Palette }))}><option value="violet">بنفش</option><option value="ocean">اقیانوسی</option><option value="emerald">زمردی</option><option value="amber">کهربایی</option></select>
        </div>
      </header>

      {(updateAvailable || offlineReady) && <div className="system-banner" role="status"><span>{updateAvailable ? "نسخه جدید برنامه آماده است." : "فایل‌های اصلی برای استفاده آفلاین آماده‌اند."}</span><div className="flex items-center gap-2">{updateAvailable && <button type="button" className="button button-small button-primary" onClick={() => void applyPwaUpdate()}>به‌روزرسانی</button>}<button type="button" className="icon-button icon-button-small" onClick={() => { setUpdateAvailable(false); setOfflineReady(false); }} aria-label="بستن"><X size={15} /></button></div></div>}

      <main className="page-content">
        {page === "editor" && <NoteEditorPage key={editingId ?? "new"} noteId={editingId} onSaved={savedNote} onCancelEdit={() => { setEditingId(null); setPage("bank"); }} onOpenDuplicate={(id) => editNote(id)} />}
        {page === "bank" && <MyBankPage onEdit={editNote} onNotify={notify} />}
        {page === "review" && <ReviewPage onNotify={notify} />}
        {page === "stats" && <StatsPage />}
        {page === "data" && <DataToolsPage onNotify={notify} />}
        {page === "sync" && <SyncPage onNotify={notify} />}
        {page === "dashboard" && (
          <>
            <section className="welcome-row"><div><p className="eyebrow">فضای یادگیری شخصی</p><h1>یادگیری امروزت را ادامه بده</h1><p className="welcome-subtitle">ثبت و مرور بدون اینترنت؛ اطلاعات ابتدا روی همین دستگاه ذخیره می‌شوند.</p></div><div className="privacy-chip"><ShieldCheck size={16} /> ذخیره محلی و آفلاین</div></section>
            <section className="stats-grid">
              <article className="stat-card"><div className="stat-icon stat-purple"><BookOpen size={19} /></div><div><span className="stat-label">کل یادداشت‌ها</span><strong>{safeArray(notes).length.toLocaleString("fa-IR")}</strong></div></article>
              <article className="stat-card"><div className="stat-icon stat-orange"><Star size={19} /></div><div><span className="stat-label">علاقه‌مندی‌ها</span><strong>{starredCount.toLocaleString("fa-IR")}</strong></div></article>
              <article className="stat-card"><div className="stat-icon stat-green"><GraduationCap size={19} /></div><div><span className="stat-label">آماده مرور</span><strong>{dueCount.toLocaleString("fa-IR")}</strong></div></article>
              <article className="stat-card"><div className="stat-icon stat-blue"><CheckCircle2 size={19} /></div><div><span className="stat-label">مرورهای ثبت‌شده</span><strong>{reviewCount.toLocaleString("fa-IR")}</strong></div></article>
            </section>
            <section className="dashboard-grid">
              <div className="panel review-panel">
                <div className="section-heading"><div><p className="eyebrow">مرور فاصله‌دار</p><h2><GraduationCap size={19} /> تمرین FSRS</h2></div><span className="fsrs-pill">FSRS-7</span></div>
                {activeReviewNote ? <>
                  <label className="field review-select"><span>انتخاب یادداشت برای مرور</span><select value={activeReviewNote.id} onChange={(event) => setActiveReviewId(event.target.value)}>{safeArray(notes).map((note) => <option key={note.id} value={note.id}>{note.term}</option>)}</select></label>
                  <div className="flashcard"><div className="flashcard-topline"><span>{kindLabel(activeReviewNote.kind)}</span><span>EN ↔ FA</span></div><h3 dir="auto">{activeReviewNote.term}</h3><p>{activeReviewNote.meaning || "معنی ثبت نشده است."}</p>{activeReviewNote.ipa && <div className="flashcard-meta" dir="ltr">{activeReviewNote.ipa}</div>}{activeReviewNote.example && <blockquote dir="ltr">{activeReviewNote.example}</blockquote>}</div>
                  <p className="review-instruction">پس از یادآوری پاسخ، میزان دشواری را انتخاب کن.</p>
                  {previewError && <p className="inline-message message-error">{previewError}</p>}
                  <div className="rating-grid">{RATING_META.map((item) => {
                    const preview = previews.find((candidate) => candidate.rating === item.value);
                    return <button key={item.value} type="button" className={`rating-button ${item.tone}`} onClick={() => void handleReview(item.value)} disabled={reviewing || !activeCard || !preview || Boolean(previewError)}><strong>{item.label}</strong><span>{preview ? formatInterval(preview.intervalMs) : "—"}</span></button>;
                  })}</div>
                  {activeCard?.card && <div className="due-line"><span>موعد فعلی</span><b>{formatDate(activeCard.card.dueAt)}</b></div>}
                </> : <div className="empty-review"><GraduationCap size={30} /><strong>هنوز یادداشتی ثبت نشده است</strong><span>اولین آیتم را ثبت کن تا مرور FSRS فعال شود.</span><button className="button button-primary" onClick={startNewNote} type="button"><Plus size={15} /> ثبت اولین یادداشت</button></div>}
              </div>
              <aside className="side-column">
                <section className="panel storage-panel"><div className="section-heading compact-heading"><div><p className="eyebrow">پایداری داده</p><h2><ShieldCheck size={18} /> ذخیره‌سازی محلی</h2></div>{mirrorStatus.state === "ok" || mirrorStatus.state === "restored" ? <CheckCircle2 className="success-text" size={19} /> : <AlertCircle className="warning-text" size={19} />}</div>
                  <div className="storage-status"><div className="storage-icon"><Cloud size={18} /></div><div><strong>IndexedDB</strong><span>پایگاه داده اصلی برنامه</span></div><b className="status-ok">فعال</b></div>
                  <div className="storage-status"><div className="storage-icon"><ShieldCheck size={18} /></div><div><strong>Emergency Mirror</strong><span>{mirrorStatus.message}</span></div></div>
                  {mirrorStatus.savedAt && <p className="storage-time">آخرین Mirror: {formatDate(mirrorStatus.savedAt)}</p>}
                  <button className="button button-secondary button-full" type="button" onClick={() => void mirrorNow()}><RefreshCw size={15} /> به‌روزرسانی Mirror</button>
                  <div className="backup-actions"><button type="button" className="text-button" onClick={() => void exportBackup()} disabled={backingUp}><Download size={15} /> دریافت پشتیبان</button><label className="text-button file-button"><Upload size={15} /> بازیابی فایل<input type="file" accept="application/json,.json" onChange={(event) => void importBackup(event)} /></label></div>
                  <p className="storage-note"><CloudOff size={14} /> برای پشتیبان مستقل، فایل JSON را خارج از داده‌های مرورگر نگه دار.</p>
                </section>
                <section className="panel quick-tips"><p className="eyebrow">دسترسی سریع</p><h2>کارهای روزمره</h2><button className="button button-primary button-full" type="button" onClick={startNewNote}><Plus size={15} /> ثبت یادداشت جدید</button><button className="button button-secondary button-full quick-link" type="button" onClick={() => setPage("bank")}><Library size={15} /> مشاهده بانک من</button><div className="tip-footer"><CheckCircle2 size={15} /> کارکرد آفلاین فعال است.</div></section>
              </aside>
            </section>
            <section className="panel recent-panel dashboard-recent"><div className="section-heading compact-heading"><div><p className="eyebrow">ردپای یادگیری</p><h2>مرورهای اخیر</h2></div><span className="small-tag">{recentLogs.length.toLocaleString("fa-IR")} رویداد اخیر</span></div>
              {safeArray(recentLogs).length === 0 ? <p className="empty-inline">هنوز مروری ثبت نشده است.</p> : <div className="recent-list">{safeArray(recentLogs).map((log) => {
                const note = safeArray(notes).find((item) => item.id === log.noteId);
                const label = RATING_META.find((item) => item.value === log.rating)?.label ?? log.rating;
                return <div className="recent-row" key={log.id}><div><strong dir="auto">{note?.term ?? "یادداشت حذف‌شده"}</strong><span>{formatDate(log.reviewedAt)}</span></div><span className={`history-rating history-${log.rating}`}>{label}</span><small>{formatInterval(log.intervalDays * 86_400_000)} بعد</small></div>;
              })}</div>}
            </section>
          </>
        )}
      </main>
      {toast && <div className={`toast-message ${toast.error ? "toast-error" : "toast-success"}`} role="status"><span>{toast.error ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}</span><span>{toast.message}</span><button type="button" onClick={() => setToast(null)} aria-label="بستن"><X size={15} /></button></div>}
      <footer className="app-footer"><span>واژه‌یار · فاز ۱ تا ۴</span><span>{online ? "اتصال شبکه برقرار" : "حالت آفلاین فعال"}</span></footer>
    </div>
  );
}
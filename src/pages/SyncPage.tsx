import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Cloud, CloudDownload, CloudUpload, ExternalLink, KeyRound, LoaderCircle, RefreshCw, ShieldCheck, Wifi, WifiOff, Trash2 } from "lucide-react";
import { getAppsScriptPin, isValidAppsScriptUrl, loadSyncSettings, normalizeSupabaseUrl, saveAppsScriptPin, saveSyncSettings } from "../services/syncSettings";
import { getSyncStatus, runSync, subscribeSyncStatus, testAppsScriptConnection } from "../services/sync";
import { getSupabaseSessionLabel, signInSupabase, signOutSupabase } from "../services/supabaseProvider";
import type { SyncSettings, SyncStatus } from "../services/syncTypes";
import { db } from "../services/database";
import { clearVazhyarPwaCaches } from "../services/pwa";
import { useLiveQuery } from "dexie-react-hooks";

interface SyncPageProps { onNotify: (message: string, error?: boolean) => void; }

function formatDate(value: string | null): string {
  if (!value) return "هنوز انجام نشده";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(date)
    : "تاریخ نامعتبر";
}

export function SyncPage({ onNotify }: SyncPageProps) {
  const [settings, setSettings] = useState<SyncSettings>(loadSyncSettings);
  const [pin, setPin] = useState(getAppsScriptPin);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sessionLabel, setSessionLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus());
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const lastSyncedAt = useLiveQuery(async () => (await db.meta.get("sync.lastSuccessfulAt"))?.value ?? null, [], null);

  useEffect(() => subscribeSyncStatus(setStatus), []);

  useEffect(() => {
    let alive = true;
    if (settings.provider === "supabase" && settings.supabaseUrl && settings.supabaseAnonKey) {
      void getSupabaseSessionLabel(settings).then((label) => { if (alive) setSessionLabel(label); }).catch(() => { if (alive) setSessionLabel(null); });
    } else {
      setSessionLabel(null);
    }
    return () => { alive = false; };
  }, [settings.provider, settings.supabaseUrl, settings.supabaseAnonKey]);

  function patchSettings(patch: Partial<SyncSettings>): void {
    setSettings((current) => ({ ...current, ...patch }));
    setConnectionMessage(null);
  }

  function persistSettings(): SyncSettings {
    const cleaned: SyncSettings = {
      ...settings,
      appsScriptUrl: settings.appsScriptUrl.trim(),
      supabaseUrl: normalizeSupabaseUrl(settings.supabaseUrl),
      supabaseAnonKey: settings.supabaseAnonKey.trim()
    };
    saveSyncSettings(cleaned);
    saveAppsScriptPin(pin.trim(), cleaned.rememberAppsScriptPin);
    setSettings(cleaned);
    return cleaned;
  }

  async function handleSaveAndTest(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setConnectionMessage(null);
    try {
      const cleaned = persistSettings();
      if (cleaned.provider === "apps-script") {
        if (!isValidAppsScriptUrl(cleaned.appsScriptUrl)) throw new Error("نشانی باید URL کامل Web App گوگل و پایان‌یافته به /exec باشد.");
        if (pin.trim().length < 32) throw new Error("برای امنیت، یک PIN تصادفی حداقل ۳۲ نویسه‌ای وارد کن.");
        const spreadsheet = await testAppsScriptConnection(cleaned.appsScriptUrl, pin.trim());
        setConnectionMessage(`اتصال برقرار است؛ فایل Google Sheets: ${spreadsheet}`);
      } else {
        if (!cleaned.supabaseUrl || !cleaned.supabaseAnonKey) throw new Error("نشانی پروژه و کلید anon را وارد کن.");
        const label = await getSupabaseSessionLabel(cleaned);
        if (!label) throw new Error("تنظیمات ذخیره شد؛ اکنون با ایمیل و گذرواژه وارد Supabase شو.");
        setSessionLabel(label);
        setConnectionMessage(`اتصال و نشست معتبر است: ${label}`);
      }
      onNotify("تنظیمات همگام‌سازی ذخیره و اتصال آزمایش شد.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "آزمایش اتصال ناموفق بود.";
      setConnectionMessage(message);
      onNotify(message, true);
    } finally {
      setBusy(false);
    }
  }

  async function handleSupabaseLogin(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const cleaned = persistSettings();
      const label = await signInSupabase(cleaned, email, password);
      setSessionLabel(label);
      setPassword("");
      setConnectionMessage(`ورود موفق: ${label}`);
      onNotify("ورود به Supabase موفق بود.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "ورود ناموفق بود.", true);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout(): Promise<void> {
    setBusy(true);
    try {
      await signOutSupabase(settings);
      setSessionLabel(null);
      onNotify("از حساب Supabase خارج شدی.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "خروج ناموفق بود.", true);
    } finally { setBusy(false); }
  }

  async function handleSync(): Promise<void> {
    if (busy || status.phase === "connecting" || status.phase === "pushing" || status.phase === "pulling" || status.phase === "merging") return;
    setBusy(true);
    try {
      const cleaned = persistSettings();
      const result = await runSync(cleaned);
      onNotify(`همگام‌سازی کامل شد؛ ${result.pushed} ارسال و ${result.pulled} تغییر دریافت شد.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "همگام‌سازی ناموفق بود.", true);
    } finally { setBusy(false); }
  }

  async function handleClearPwaCache(): Promise<void> {
    if (busy) return;
    const confirmed = window.confirm("ابتدا مطمئن شو از اطلاعاتت بکاپ JSON گرفته‌ای یا سینک موفق داری. فقط Service Worker و کش فایل‌های برنامه پاک می‌شوند؛ IndexedDB و یادداشت‌ها حذف نمی‌شوند. ادامه می‌دهی؟");
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await clearVazhyarPwaCaches();
      onNotify(`${result.registrations} Service Worker و ${result.caches} کش حذف شد. صفحه اکنون دوباره بارگذاری می‌شود.`);
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "پاک‌سازی کش PWA ناموفق بود.", true);
    } finally {
      setBusy(false);
    }
  }

  const syncing = ["connecting", "pushing", "pulling", "merging"].includes(status.phase);
  const isOnline = typeof navigator === "undefined" || navigator.onLine;

  return (
    <div className="sync-page page-stack">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">گوشی ↔ لپ‌تاپ</p>
          <h1>همگام‌سازی و اتصال ابری</h1>
          <p className="welcome-subtitle">هر دستگاه ابتدا محلی کار می‌کند؛ هنگام اتصال، همه تغییرات محلی ارسال و سپس Full Pull انجام می‌شود.</p>
        </div>
        <div className={`privacy-chip ${isOnline ? "" : "offline-chip"}`}>{isOnline ? <Wifi size={15} /> : <WifiOff size={15} />}{isOnline ? "این دستگاه آنلاین است" : "این دستگاه آفلاین است"}</div>
      </section>

      <section className="panel sync-status-panel">
        <div className="section-heading">
          <div><p className="eyebrow">وضعیت زنده</p><h2><RefreshCw size={19} className={syncing ? "sync-spin" : ""} /> {syncing ? "همگام‌سازی در حال اجراست" : status.phase === "success" ? "آخرین همگام‌سازی موفق" : status.phase === "error" ? "همگام‌سازی نیازمند توجه است" : "آماده همگام‌سازی"}</h2></div>
          <span className={`sync-state-pill ${status.phase}`}>{status.phase.toUpperCase()}</span>
        </div>
        <p className="sync-message" role="status">{status.message}</p>
        <div className="sync-metrics">
          <div><span>ارسال‌شده</span><strong>{status.pushed.toLocaleString("fa-IR")}</strong></div>
          <div><span>دریافت‌شده/ادغام‌شده</span><strong>{status.pulled.toLocaleString("fa-IR")}</strong></div>
          <div><span>آخرین موفقیت</span><strong>{formatDate(lastSyncedAt ?? status.lastSuccessAt)}</strong></div>
        </div>
        {status.error && <p className="inline-message message-error"><AlertCircle size={14} /> {status.error}</p>}
        <button className="button button-primary sync-run-button" type="button" onClick={() => void handleSync()} disabled={!isOnline || busy || syncing}>
          {busy || syncing ? <LoaderCircle size={16} className="sync-spin" /> : <RefreshCw size={16} />}
          {busy || syncing ? "در حال همگام‌سازی…" : "همگام‌سازی دوطرفه اکنون"}
        </button>
      </section>

      <section className="panel sync-settings-panel">
        <div className="section-heading"><div><p className="eyebrow">انتخاب سرویس</p><h2><Cloud size={19} /> تنظیمات اتصال</h2></div><ShieldCheck size={20} className="success-text" /></div>
        <div className="segmented-control" role="group" aria-label="سرویس همگام‌سازی">
          <button type="button" className={settings.provider === "apps-script" ? "segment selected" : "segment"} onClick={() => patchSettings({ provider: "apps-script" })}>Google Sheets</button>
          <button type="button" className={settings.provider === "supabase" ? "segment selected" : "segment"} onClick={() => patchSettings({ provider: "supabase" })}>Supabase</button>
        </div>

        <form className="sync-config-form" onSubmit={(event) => void handleSaveAndTest(event)}>
          {settings.provider === "apps-script" ? <>
            <label className="field"><span>Web App URL (پایان /exec)</span><input dir="ltr" type="url" required placeholder="https://script.google.com/macros/s/.../exec" value={settings.appsScriptUrl} onChange={(event) => patchSettings({ appsScriptUrl: event.target.value })} /></label>
            <label className="field"><span><KeyRound size={14} /> PIN اختصاصی همگام‌سازی</span><input dir="ltr" type="password" required minLength={32} autoComplete="new-password" value={pin} onChange={(event) => { setPin(event.target.value); setConnectionMessage(null); }} placeholder="حداقل ۳۲ نویسه تصادفی (ترجیحاً ۶۴ رقم هگز)" /></label>
            <label className="remember-source"><input type="checkbox" checked={settings.rememberAppsScriptPin} onChange={(event) => patchSettings({ rememberAppsScriptPin: event.target.checked })} /><span>PIN روی همین دستگاه به‌صورت ماندگار ذخیره شود</span></label>
            <p className="helper-note">به‌صورت پیش‌فرض PIN فقط تا پایان نشست مرورگر نگهداری می‌شود. ذخیره ماندگار روی دستگاه راحت‌تر است، اما در برابر دسترسی محلی یا XSS محافظت رمزنگاری‌شده ندارد.</p>
            <p className="helper-note">برای اجرای مستقیم Google Sheets از فرم و iframe استفاده می‌شود تا به CORS و OPTIONS وابسته نباشد. دسترسی بدون VPN به دامنه‌های Google به شبکه و محل اتصال وابسته است و قابل تضمین نیست.</p>
          </> : <>
            <label className="field"><span>Supabase Project URL</span><input dir="ltr" type="url" required placeholder="https://your-project.supabase.co" value={settings.supabaseUrl} onChange={(event) => patchSettings({ supabaseUrl: event.target.value })} /></label>
            <label className="field"><span>Publishable / anon key</span><textarea dir="ltr" rows={2} required value={settings.supabaseAnonKey} onChange={(event) => patchSettings({ supabaseAnonKey: event.target.value })} placeholder="sb_publishable_… یا anon key" /></label>
            <div className="sync-login-grid">
              <label className="field"><span>ایمیل حساب Supabase</span><input dir="ltr" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
              <label className="field"><span>گذرواژه حساب</span><input dir="ltr" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="گذرواژه Supabase Auth" /></label>
            </div>
            {sessionLabel ? <div className="sync-session"><CheckCircle2 size={15} /> واردشده با {sessionLabel}<button type="button" className="text-button" onClick={() => void handleLogout()} disabled={busy}>خروج</button></div> : <button className="button button-secondary" type="button" disabled={busy || !email || !password || !settings.supabaseUrl || !settings.supabaseAnonKey} onClick={() => void handleSupabaseLogin()}>ورود به حساب Supabase</button>}
            <p className="helper-note">کلید service_role را هرگز اینجا وارد نکن. فقط کلید عمومی پروژه مجاز است. ابتدا فایل SQL همراه پروژه را در SQL Editor اجرا کن و برای دو دستگاه از یک حساب کاربری Supabase استفاده کن.</p>
          </>}

          <label className="remember-source"><input type="checkbox" checked={settings.autoSync} onChange={(event) => patchSettings({ autoSync: event.target.checked })} /><span>همگام‌سازی خودکار هنگام بازشدن برنامه، بازگشت اینترنت و فعال‌شدن دوباره صفحه</span></label>
          <div className="sync-form-actions">
            <button className="button button-secondary" type="submit" disabled={busy}><ShieldCheck size={15} /> ذخیره و آزمایش اتصال</button>
            <button className="button button-primary" type="button" onClick={() => void handleSync()} disabled={!isOnline || busy || syncing}><RefreshCw size={15} /> همگام‌سازی اکنون</button>
          </div>
          {connectionMessage && <p className={`inline-message ${connectionMessage.includes("ناموفق") || connectionMessage.includes("وارد شو") ? "message-error" : "message-success"}`}><CheckCircle2 size={14} /> {connectionMessage}</p>}
        </form>
      </section>

      <section className="grid-two sync-info-grid">
        <article className="panel"><h3><CloudUpload size={17} /> Full Push</h3><p>در هر نوبت، یادداشت‌ها، کارت‌های FSRS و رویدادهای مرور از روی IndexedDB خوانده و به‌صورت دسته‌ای ارسال می‌شوند. رکوردهای حذف‌شده نرم نیز ارسال می‌شوند.</p></article>
        <article className="panel"><h3><CloudDownload size={17} /> Full Pull</h3><p>پس از ارسال، همه صفحه‌های snapshot سرور دریافت می‌شوند. یادداشت و کارت با updatedAt و رویداد مرور با شناسه یکتا ادغام می‌شود؛ حذف سخت از سرور انجام نمی‌شود.</p></article>
      </section>
      <section className="panel pwa-maintenance-panel">
        <div className="section-heading"><div><p className="eyebrow">نگهداری نسخه نصب‌شده</p><h2><RefreshCw size={18} /> تازه‌سازی PWA</h2></div></div>
        <p className="helper-note">اگر پس از انتشار نسخه جدید، برنامه هنوز ظاهر قدیمی را نشان می‌دهد، ابتدا از داده‌ها پشتیبان بگیر یا موفقیت همگام‌سازی را بررسی کن. این ابزار فقط Service Worker و Cache Storage برنامه را پاک می‌کند و به IndexedDB یا یادداشت‌ها دست نمی‌زند.</p>
        <button className="button button-secondary" type="button" onClick={() => void handleClearPwaCache()} disabled={busy}><Trash2 size={15} /> پاک‌سازی کش فایل‌های برنامه و بارگذاری مجدد</button>
      </section>
      <p className="helper-note sync-disclaimer"><ExternalLink size={13} /> LWW به ساعت دستگاه‌ها وابسته است؛ تاریخ و ساعت خودکار هر دو دستگاه را فعال نگه دار. مرور هم‌زمان یک کارت روی دو دستگاه در تاریخچه حفظ می‌شود، اما وضعیت نهایی کارت با LWW انتخاب می‌شود؛ بهتر است یک کارت را هم‌زمان در دو دستگاه مرور نکنی.</p>
    </div>
  );
}

import type { SyncSettings } from "./syncTypes";

const SETTINGS_KEY = "vazhyar.sync.settings.v1";
const SESSION_PIN_KEY = "vazhyar.sync.apps-script.pin.session";
const REMEMBERED_PIN_KEY = "vazhyar.sync.apps-script.pin.remembered";

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  provider: "apps-script",
  appsScriptUrl: "",
  supabaseUrl: "",
  supabaseAnonKey: "",
  autoSync: true,
  rememberAppsScriptPin: false
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadSyncSettings(): SyncSettings {
  if (!canUseStorage()) return DEFAULT_SYNC_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SYNC_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<SyncSettings>;
    return {
      provider: parsed.provider === "supabase" ? "supabase" : "apps-script",
      appsScriptUrl: typeof parsed.appsScriptUrl === "string" ? parsed.appsScriptUrl.trim() : "",
      supabaseUrl: typeof parsed.supabaseUrl === "string" ? parsed.supabaseUrl.trim() : "",
      supabaseAnonKey: typeof parsed.supabaseAnonKey === "string" ? parsed.supabaseAnonKey.trim() : "",
      autoSync: parsed.autoSync !== false,
      rememberAppsScriptPin: parsed.rememberAppsScriptPin === true
    };
  } catch {
    return DEFAULT_SYNC_SETTINGS;
  }
}

export function saveSyncSettings(settings: SyncSettings): void {
  if (!canUseStorage()) throw new Error("ذخیره تنظیمات همگام‌سازی در این محیط در دسترس نیست.");
  // PINs and Supabase passwords are deliberately excluded from this object.
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function saveAppsScriptPin(pin: string, remember: boolean): void {
  if (typeof window === "undefined") throw new Error("ذخیره PIN در این محیط در دسترس نیست.");
  sessionStorage.removeItem(SESSION_PIN_KEY);
  localStorage.removeItem(REMEMBERED_PIN_KEY);
  if (!pin) return;
  if (remember) localStorage.setItem(REMEMBERED_PIN_KEY, pin);
  else sessionStorage.setItem(SESSION_PIN_KEY, pin);
}

export function getAppsScriptPin(): string {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(SESSION_PIN_KEY)
      ?? localStorage.getItem(REMEMBERED_PIN_KEY)
      ?? "";
  } catch {
    return "";
  }
}

export function hasSyncConfiguration(settings = loadSyncSettings()): boolean {
  if (settings.provider === "apps-script") {
    return Boolean(isValidAppsScriptUrl(settings.appsScriptUrl) && getAppsScriptPin().length >= 32);
  }
  return Boolean(settings.supabaseUrl && settings.supabaseAnonKey);
}

export function isValidAppsScriptUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.toLowerCase() === "script.google.com"
      && /\/macros\/s\/[\w-]+\/exec\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function normalizeSupabaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

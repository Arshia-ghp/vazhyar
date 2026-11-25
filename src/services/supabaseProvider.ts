import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PullPage, PullSnapshot, SyncEntity, SyncProvider, SyncRecord } from "./syncTypes";
import { normalizeSupabaseUrl } from "./syncSettings";

export interface SupabaseSettings {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

let cachedKey = "";
let cachedClient: SupabaseClient | null = null;

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(init?.signal?.reason);
  if (init?.signal?.aborted) onAbort();
  else init?.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = window.setTimeout(() => controller.abort(new DOMException("Network timeout", "TimeoutError")), 12_000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
    init?.signal?.removeEventListener("abort", onAbort);
  }
}

export function getSupabaseClient(settings: SupabaseSettings): SupabaseClient {
  const url = normalizeSupabaseUrl(settings.supabaseUrl);
  const key = `${url}|${settings.supabaseAnonKey}`;
  if (!url || !settings.supabaseAnonKey) throw new Error("نشانی پروژه و کلید عمومی Supabase را وارد کن.");
  if (cachedClient && cachedKey === key) return cachedClient;
  cachedClient?.auth.stopAutoRefresh();
  cachedClient = createClient(url, settings.supabaseAnonKey, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    global: { fetch: fetchWithTimeout }
  });
  cachedKey = key;
  return cachedClient;
}

export async function signInSupabase(settings: SupabaseSettings, email: string, password: string): Promise<string> {
  const client = getSupabaseClient(settings);
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(`ورود Supabase ناموفق بود: ${error.message}`);
  if (!data.user?.id) throw new Error("حساب Supabase شناسه کاربر معتبری برنگرداند.");
  return data.user.email ?? data.user.id;
}

export async function getSupabaseSessionLabel(settings: SupabaseSettings): Promise<string | null> {
  const { data, error } = await getSupabaseClient(settings).auth.getUser();
  if (error || !data.user) return null;
  return data.user.email ?? data.user.id;
}

export async function signOutSupabase(settings: SupabaseSettings): Promise<void> {
  const { error } = await getSupabaseClient(settings).auth.signOut();
  if (error) throw new Error(error.message);
}

export class SupabaseSyncProvider implements SyncProvider {
  private readonly client: SupabaseClient;
  private userId = "";

  constructor(settings: SupabaseSettings) {
    this.client = getSupabaseClient(settings);
  }

  async assertSession(): Promise<void> {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user) throw new Error("ابتدا با حساب Supabase وارد شو.");
    this.userId = data.user.id;
  }

  async push(entity: SyncEntity, records: SyncRecord[]): Promise<{ accepted: number }> {
    if (!this.userId) await this.assertSession();
    if (records.length === 0) return { accepted: 0 };
    const payload = records.map((record) => ({
      entity,
      id: record.id,
      updated_at: record.updatedAt,
      payload: record.payload
    }));
    const { data, error } = await this.client.rpc("merge_vazhyar_sync_records", { p_records: payload });
    if (error) throw new Error(`ذخیره در Supabase ناموفق بود: ${error.message}`);
    return { accepted: Number(data ?? 0) };
  }

  async beginPull(): Promise<PullSnapshot> {
    if (!this.userId) await this.assertSession();
    const { data, error } = await this.client.rpc("vazhyar_sync_snapshot_revision");
    if (error) throw new Error(`دریافت نسخه همگام‌سازی ناموفق بود: ${error.message}`);
    return { token: String(data ?? 0) };
  }

  async pullPage(entity: SyncEntity, snapshot: PullSnapshot, cursor: string | number | null, limit: number): Promise<PullPage> {
    let query = this.client.from("vazhyar_sync_records")
      .select("id, updated_at, payload, revision")
      .eq("entity", entity)
      .lte("revision", snapshot.token)
      .order("id", { ascending: true })
      .limit(limit);
    if (typeof cursor === "string" && cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw new Error(`دریافت اطلاعات از Supabase ناموفق بود: ${error.message}`);
    const rows = (data ?? []) as Array<{ id: string; updated_at: string; payload: unknown; revision: number }>;
    const records = rows.map((row) => ({ id: row.id, updatedAt: row.updated_at, payload: row.payload }));
    return {
      records,
      nextCursor: rows.length > 0 ? rows[rows.length - 1]!.id : cursor,
      done: rows.length < limit
    };
  }
}

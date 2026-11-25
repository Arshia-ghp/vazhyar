import type { PullPage, PullSnapshot, SyncEntity, SyncProvider, SyncRecord } from "./syncTypes";

const CHANNEL = "vazhyar-apps-script-sync-v1";
const DEFAULT_TIMEOUT_MS = 25_000;

interface BridgeResponse<T = unknown> {
  channel: string;
  requestId: string;
  ok: boolean;
  result?: T;
  error?: string;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Apps Script ContentService redirects to googleusercontent and is awkward to
 * consume with browser fetch/CORS. A normal HTML form POST to a hidden iframe
 * avoids preflight; the HtmlService response returns a correlated postMessage.
 */
export class AppsScriptBridge {
  constructor(private readonly endpoint: string, private readonly pin: string) {}

  request<T>(action: string, args: Record<string, unknown> = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return Promise.reject(new Error("ارتباط Google Sheets فقط در مرورگر قابل اجراست."));
    }
    const requestId = randomId();
    const payload = JSON.stringify({ action, pin: this.pin, requestId, ...args });

    return new Promise<T>((resolve, reject) => {
      const iframe = document.createElement("iframe");
      const form = document.createElement("form");
      const input = document.createElement("input");
      const target = `vazhyar_sync_${requestId.replace(/[^a-zA-Z0-9_]/g, "")}`;
      let settled = false;
      const cleanup = () => {
        window.clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        form.remove();
        iframe.remove();
      };
      const finish = (error?: Error, value?: T) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(value as T);
      };
      const onMessage = (event: MessageEvent<unknown>) => {
        if (event.source !== iframe.contentWindow) return;
        const data = event.data as Partial<BridgeResponse<T>> | null;
        if (!data || data.channel !== CHANNEL || data.requestId !== requestId) return;
        if (!data.ok) finish(new Error(typeof data.error === "string" ? data.error : "Google Apps Script درخواست را نپذیرفت."));
        else finish(undefined, data.result as T);
      };
      const timer = window.setTimeout(() => finish(new Error(`مهلت ارتباط با Google Sheets (${Math.round(timeoutMs / 1000)} ثانیه) تمام شد.`)), timeoutMs);

      iframe.name = target;
      iframe.setAttribute("aria-hidden", "true");
      iframe.tabIndex = -1;
      iframe.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
      form.method = "POST";
      form.action = this.endpoint;
      form.target = target;
      form.enctype = "application/x-www-form-urlencoded";
      form.acceptCharset = "UTF-8";
      input.type = "hidden";
      input.name = "payload";
      input.value = payload;
      form.append(input);
      window.addEventListener("message", onMessage);
      document.body.append(iframe, form);
      try {
        form.submit();
      } catch (error) {
        finish(error instanceof Error ? error : new Error("ارسال فرم همگام‌سازی انجام نشد."));
      }
    });
  }
}

export class AppsScriptProvider implements SyncProvider {
  private readonly bridge: AppsScriptBridge;

  constructor(endpoint: string, pin: string) {
    this.bridge = new AppsScriptBridge(endpoint, pin);
  }

  async ping(): Promise<{ ok: boolean; spreadsheet: string }> {
    return this.bridge.request("ping");
  }

  async push(entity: SyncEntity, records: SyncRecord[]): Promise<{ accepted: number }> {
    return this.bridge.request("merge", { entity, records });
  }

  async beginPull(): Promise<PullSnapshot> {
    return this.bridge.request("beginPull");
  }

  async pullPage(entity: SyncEntity, snapshot: PullSnapshot, cursor: string | number | null, limit: number): Promise<PullPage> {
    return this.bridge.request("pullPage", {
      entity,
      snapshotRevision: snapshot.token,
      snapshotRows: snapshot.rowCounts?.[entity] ?? 0,
      offset: typeof cursor === "number" ? cursor : 0,
      limit
    });
  }
}

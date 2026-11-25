import type { NoteKind } from "../types/domain";
import { normalizeText } from "../lib/safe";

export type EnrichmentProvider = "openrouter" | "gemini";

export interface EnrichmentSettings {
  provider: EnrichmentProvider;
  apiKey: string;
  model: string;
  /** Optional same-origin HTTPS server proxy. Server owns the secret in production. */
  proxyUrl: string;
  timeoutMs: number;
}

export interface EnrichmentInput {
  term: string;
  meaning: string;
  kind: NoteKind;
}

export interface EnrichmentPatch {
  term?: string;
  meaning?: string;
  ipa?: string;
  structure?: string;
  example?: string;
  exampleFa?: string;
  notes?: string;
}

export interface EnrichmentResult {
  patch: EnrichmentPatch;
  sources: string[];
  quality: "ai" | "quick" | "partial";
  message: string;
}

interface DictionaryDefinition {
  definition?: string;
  example?: string;
}
interface DictionaryMeaning {
  partOfSpeech?: string;
  definitions?: DictionaryDefinition[];
}
interface DictionaryPhonetic {
  text?: string;
  audio?: string;
}
interface DictionaryEntry {
  word?: string;
  phonetic?: string;
  phonetics?: DictionaryPhonetic[];
  meanings?: DictionaryMeaning[];
}
interface MyMemoryResponse {
  responseStatus?: number;
  responseData?: { translatedText?: string };
}

const AI_CONFIG_KEY = "vazhyar.enrichment.session.v1";
const translationCache = new Map<string, string>();
const dictionaryCache = new Map<string, NonNullable<Awaited<ReturnType<typeof dictionaryLookup>>>>();
const DEFAULT_TIMEOUT_MS = 1_800;
const QUICK_TIMEOUT_MS = 1_350;

export const DEFAULT_ENRICHMENT_SETTINGS: EnrichmentSettings = {
  provider: "gemini",
  apiKey: "",
  model: "gemini-4-hydrogen",
  proxyUrl: "",
  timeoutMs: DEFAULT_TIMEOUT_MS
};

export function loadEnrichmentSettings(): EnrichmentSettings {
  try {
    const raw = sessionStorage.getItem(AI_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_ENRICHMENT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<EnrichmentSettings>;
    const provider = parsed.provider === "openrouter" ? "openrouter" : "gemini";
    const model = typeof parsed.model === "string" && parsed.model.trim()
      ? parsed.model.trim()
      : provider === "gemini" ? "gemini-4-hydrogen" : "google/gemini-4-hydrogen";
    const timeoutMs = Number.isFinite(parsed.timeoutMs)
      ? Math.max(700, Math.min(3_500, Number(parsed.timeoutMs)))
      : DEFAULT_TIMEOUT_MS;
    return {
      provider,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      model,
      proxyUrl: typeof parsed.proxyUrl === "string" ? parsed.proxyUrl : "",
      timeoutMs
    };
  } catch {
    return { ...DEFAULT_ENRICHMENT_SETTINGS };
  }
}

export function saveEnrichmentSettings(settings: EnrichmentSettings): void {
  try {
    // Secrets are not written to IndexedDB, localStorage, or backup files.
    sessionStorage.setItem(AI_CONFIG_KEY, JSON.stringify(settings));
  } catch {
    // Enrichment is optional; storage denial must never interrupt note-taking.
  }
}

export function isPersianText(value: string): boolean {
  return /[\u0600-\u06FF]/u.test(value);
}

function timeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
  return { signal: controller.signal, clear: () => window.clearTimeout(timer) };
}

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const timeout = timeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: timeout.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as T;
  } finally {
    timeout.clear();
  }
}

async function dictionaryLookup(term: string): Promise<{ ipa: string; example: string; notes: string; source: string; audio?: string } | null> {
  const clean = term.trim();
  if (!clean || clean.length > 120) return null;
  const cacheKey = normalizeText(clean);
  const cached = dictionaryCache.get(cacheKey);
  if (cached) return cached;
  try {
    const data = await fetchJson<DictionaryEntry[]>(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(clean)}`,
      { method: "GET", headers: { Accept: "application/json" } },
      QUICK_TIMEOUT_MS
    );
    const entry = Array.isArray(data) ? data[0] : undefined;
    if (!entry) return null;
    const phonetics = Array.isArray(entry.phonetics) ? entry.phonetics : [];
    const ipa = entry.phonetic || phonetics.find((item) => item.text)?.text || "";
    const audio = phonetics.find((item) => item.audio)?.audio;
    const firstDefinition = entry.meanings?.flatMap((meaning) => meaning.definitions ?? [])
      .find((definition) => definition.example);
    const parts = (entry.meanings ?? []).map((meaning) => meaning.partOfSpeech).filter(Boolean);
    const result = {
      ipa,
      example: firstDefinition?.example ?? "",
      notes: parts.length ? `نوع واژه در دیکشنری: ${[...new Set(parts)].join("، ")}` : "",
      source: "Free Dictionary API",
      ...(audio ? { audio: audio.startsWith("//") ? `https:${audio}` : audio } : {})
    };
    dictionaryCache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

async function translate(text: string, direction: "en|fa" | "fa|en"): Promise<string> {
  const clean = text.trim();
  if (!clean || new TextEncoder().encode(clean).length > 480) return "";
  const cacheKey = `${direction}:${normalizeText(clean)}`;
  const cached = translationCache.get(cacheKey);
  if (cached) return cached;
  try {
    const params = new URLSearchParams({ q: clean, langpair: direction, mt: "1" });
    const data = await fetchJson<MyMemoryResponse>(
      `https://api.mymemory.translated.net/get?${params.toString()}`,
      { method: "GET", headers: { Accept: "application/json" } },
      QUICK_TIMEOUT_MS
    );
    if (Number(data.responseStatus) !== 200) return "";
    const translated = data.responseData?.translatedText?.trim() ?? "";
    if (!translated || normalizeText(translated) === normalizeText(clean)) return "";
    translationCache.set(cacheKey, translated);
    return translated;
  } catch {
    return "";
  }
}

function buildFastPatch(
  typedText: string,
  persianInput: boolean,
  translated: string,
  dictionary: Awaited<ReturnType<typeof dictionaryLookup>>
): EnrichmentPatch {
  const patch: EnrichmentPatch = {};
  if (persianInput) {
    if (translated) patch.term = translated;
    patch.meaning = typedText;
  } else {
    patch.term = typedText;
    if (translated) patch.meaning = translated;
  }
  if (dictionary?.ipa) patch.ipa = dictionary.ipa;
  if (dictionary?.example) patch.example = dictionary.example;
  if (dictionary?.notes) patch.notes = dictionary.notes;
  return patch;
}

function safePatch(value: unknown): EnrichmentPatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys: Array<keyof EnrichmentPatch> = ["term", "meaning", "ipa", "structure", "example", "exampleFa", "notes"];
  const result: EnrichmentPatch = {};
  for (const key of keys) {
    const field = record[key];
    if (typeof field === "string" && field.trim()) {
      (result as unknown as Record<keyof EnrichmentPatch, string>)[key] = field.trim().slice(0, 4_000);
    }
  }
  return Object.keys(result).length ? result : null;
}

function parseJsonText(text: string): EnrichmentPatch | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return safePatch(JSON.parse(cleaned));
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return safePatch(JSON.parse(cleaned.slice(start, end + 1))); } catch { return null; }
    }
    return null;
  }
}

function enrichmentPrompt(input: EnrichmentInput, resolvedTerm: string, resolvedMeaning: string): string {
  return [
    "You are a careful English-to-Persian language learning assistant.",
    "Return one JSON object only. Do not invent a pronunciation. Use standard Persian.",
    "Fields: term, meaning, ipa, structure, example, exampleFa, notes.",
    "For absent or uncertain fields return an empty string. Keep examples natural and concise.",
    `Category: ${input.kind}`,
    `English term/phrase: ${resolvedTerm || input.term}`,
    `Persian meaning/context: ${resolvedMeaning || input.meaning}`
  ].join("\n");
}

async function requestAi(
  input: EnrichmentInput,
  fastPatch: EnrichmentPatch,
  settings: EnrichmentSettings
): Promise<EnrichmentPatch | null> {
  const configuredProxy = settings.proxyUrl.trim();
  const configuredKey = settings.apiKey.trim();
  if (!configuredProxy && !configuredKey) return null;

  const resolvedTerm = fastPatch.term || input.term;
  const resolvedMeaning = fastPatch.meaning || input.meaning;
  const prompt = enrichmentPrompt(input, resolvedTerm, resolvedMeaning);
  const timeoutMs = Math.max(700, Math.min(3_500, settings.timeoutMs || DEFAULT_TIMEOUT_MS));

  try {
    if (configuredProxy) {
      const data = await fetchJson<unknown>(configuredProxy, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ provider: settings.provider, model: settings.model, input, prompt })
      }, timeoutMs);
      return safePatch(data) ?? safePatch((data as { result?: unknown } | null)?.result);
    }

    if (settings.provider === "openrouter") {
      const response = await fetchJson<{
        choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
      }>("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${configuredKey}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          model: settings.model || "google/gemini-4-hydrogen",
          temperature: 0.2,
          max_tokens: 450,
          messages: [
            { role: "system", content: "Return valid JSON only. No markdown fences." },
            { role: "user", content: prompt }
          ]
        })
      }, timeoutMs);
      const content = response.choices?.[0]?.message?.content;
      const text = typeof content === "string" ? content : content?.map((part) => part.text ?? "").join("") ?? "";
      return parseJsonText(text);
    }

    const model = encodeURIComponent(settings.model || "gemini-4-hydrogen");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const response = await fetchJson<{
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    }>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "x-goog-api-key": configuredKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 600, responseMimeType: "application/json" }
      })
    }, timeoutMs);
    const text = response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    return parseJsonText(text);
  } catch {
    // 401/403/429/5xx, blocked CORS, invalid key, overload and timeout all
    // converge to the fast dictionary/translation fallback. No user-facing error.
    return null;
  }
}

/**
 * Fast dictionary + translation requests begin immediately. AI is optional and
 * bounded by a short deadline; failures never block or reject the note form.
 */
export async function enrichNote(
  input: EnrichmentInput,
  settings: EnrichmentSettings = loadEnrichmentSettings()
): Promise<EnrichmentResult> {
  const term = input.term.trim();
  const meaning = input.meaning.trim();
  const typedText = term || meaning;
  if (!typedText) throw new Error("ابتدا کلمه انگلیسی یا معنی فارسی را وارد کن.");

  const persianInput = isPersianText(typedText);
  const quickPromise = (async () => {
    let translated = "";
    let dictionary: Awaited<ReturnType<typeof dictionaryLookup>> = null;
    if (persianInput) {
      translated = await translate(typedText, "fa|en");
      if (translated) dictionary = await dictionaryLookup(translated.split(/[;,،]/)[0]?.trim() ?? translated);
    } else {
      [dictionary, translated] = await Promise.all([
        dictionaryLookup(typedText),
        translate(typedText, "en|fa")
      ]);
    }
    const patch = buildFastPatch(typedText, persianInput, translated, dictionary);
    const sources = [dictionary?.source, translated ? "MyMemory Translator" : undefined].filter(
      (source): source is string => Boolean(source)
    );
    return { patch, sources };
  })();

  // Start both branches immediately. Cap the entire free-source branch as well
  // as each individual request: slow public APIs can never hold the form open.
  let quickTimer: number | undefined;
  const quickDeadline = new Promise<{ patch: EnrichmentPatch; sources: string[] }>((resolve) => {
    quickTimer = window.setTimeout(() => {
      resolve({ patch: buildFastPatch(typedText, persianInput, "", null), sources: [] });
    }, QUICK_TIMEOUT_MS + 180);
  });
  const boundedQuickPromise = Promise.race([quickPromise, quickDeadline]).finally(() => {
    if (quickTimer !== undefined) window.clearTimeout(quickTimer);
  });

  // Race the optional AI request against the bounded free-source branch. A slow
  // or overloaded AI provider can never delay a ready dictionary/translation
  // result; the fetch has its own AbortController timeout and is safely ignored.
  const aiPromise = requestAi(input, {}, settings).then(
    (patch) => ({ kind: "ai" as const, patch }),
    () => ({ kind: "ai" as const, patch: null })
  );
  const winner = await Promise.race([
    boundedQuickPromise.then((quick) => ({ kind: "quick" as const, quick })),
    aiPromise
  ]);

  if (winner.kind === "ai" && winner.patch) {
    return {
      patch: winner.patch,
      sources: [settings.proxyUrl ? "AI Proxy" : settings.provider === "gemini" ? "Gemini" : "OpenRouter"],
      quality: "ai",
      message: "پیشنهاد هوشمند آماده شد؛ قبل از ذخیره فیلدها را بازبینی کن."
    };
  }

  const quick = winner.kind === "quick" ? winner.quick : await boundedQuickPromise;

  const hasQuick = quick.sources.length > 0;
  return {
    patch: quick.patch,
    sources: quick.sources,
    quality: hasQuick ? "quick" : "partial",
    message: hasQuick
      ? "اطلاعات سریع آماده شد. سرویس هوش مصنوعی در دسترس نبود یا تنظیم نشده بود."
      : "منبع سریع پاسخی نداد؛ می‌توانی اطلاعات را دستی وارد کنی."
  };
}

export const ENRICHMENT_LIMITS = {
  quickTimeoutMs: QUICK_TIMEOUT_MS,
  defaultAiTimeoutMs: DEFAULT_TIMEOUT_MS
} as const;

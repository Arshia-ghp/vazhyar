/** Defensive primitives used at storage, filtering and scheduling boundaries. */
export function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function normalizeText(value: unknown): string {
  return safeString(value)
    .normalize("NFKC")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function safeDate(value: unknown, fallback: Date = new Date()): Date {
  if (value instanceof Date && isValidDate(value)) return new Date(value.getTime());
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (isValidDate(parsed)) return parsed;
  }
  return new Date(fallback.getTime());
}

export function safeIsoDate(value: unknown): string | null {
  const parsed = safeDate(value, new Date(Number.NaN));
  return isValidDate(parsed) ? parsed.toISOString() : null;
}

export function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

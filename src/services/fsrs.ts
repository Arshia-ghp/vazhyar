import { DefaultScheduler as createDefaultScheduler, Rating } from "ts-fsrs";
import type { DefaultScheduler as FsrsSchedulerType } from "ts-fsrs";
import type { Grade } from "ts-fsrs";
import type {
  FsrsModelVersion,
  PersistedFsrsCard,
  ReviewLog,
  ReviewRating
} from "../types/domain";
import { createId } from "../lib/safe";
import { isValidDate } from "../lib/safe";

export type FsrsScheduler = FsrsSchedulerType<"FSRS-7">;
export type FsrsCard = ReturnType<FsrsScheduler["newCard"]>;

export interface RatingPreview {
  rating: ReviewRating;
  dueAt: string;
  intervalMs: number;
  intervalDays: number;
}

export interface AppliedReview {
  card: PersistedFsrsCard;
  log: ReviewLog;
}

const MODEL_VERSION: FsrsModelVersion = "FSRS-7";
const DAY_MS = 86_400_000;

const ratingToGrade: Record<ReviewRating, Rating> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy
};

const gradeToRating = new Map<number, ReviewRating>([
  [Rating.Again, "again"],
  [Rating.Hard, "hard"],
  [Rating.Good, "good"],
  [Rating.Easy, "easy"]
]);

let schedulerPromise: Promise<FsrsScheduler> | null = null;

export function getFsrsScheduler(): Promise<FsrsScheduler> {
  if (!schedulerPromise) {
    schedulerPromise = createDefaultScheduler<"FSRS-7">({
      version: "FSRS-7",
      desiredRetention: 0.9,
      enableShortTerm: true,
      learningSteps: ["1m", "10m"],
      relearningSteps: ["10m"],
      enableFuzz: false,
      maximumInterval: 36_500
    }).catch((error: unknown) => {
      schedulerPromise = null;
      throw error;
    });
  }
  return schedulerPromise;
}

/** Invalid wall-clock input is replaced by the current valid local time. */
export function resolveReviewTime(input?: Date): Date {
  return input && isValidDate(input) ? new Date(input.getTime()) : new Date();
}

function requireValidDate(value: unknown, fieldName: string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (!isValidDate(parsed)) {
    throw new RangeError(`تاریخ ${fieldName} نامعتبر است؛ وضعیت مرور تغییر نکرد.`);
  }
  return parsed;
}

function requireFinite(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`مقدار ${fieldName} نامعتبر است؛ از ذخیره نتیجه FSRS جلوگیری شد.`);
  }
  return value;
}

export function serializeFsrsCard(card: FsrsCard): PersistedFsrsCard {
  const dueAt = requireValidDate(card.dueAt, "dueAt");
  const lastReviewAt = card.lastReviewAt === null
    ? null
    : requireValidDate(card.lastReviewAt, "lastReviewAt");
  const stabilityFast = requireFinite(card.stabilityFast, "stabilityFast");
  const stability = requireFinite(card.stability, "stability");
  const difficulty = requireFinite(card.difficulty, "difficulty");
  const reps = requireFinite(card.reps, "reps");
  const lapses = requireFinite(card.lapses, "lapses");
  const scheduledDays = requireFinite(card.scheduledDays, "scheduledDays");
  const state = requireFinite(card.state, "state");

  if (
    (typeof card.cardId !== "string" && typeof card.cardId !== "number") ||
    (typeof card.cardId === "string" && card.cardId.trim().length === 0) ||
    (typeof card.cardId === "number" && !Number.isFinite(card.cardId)) ||
    stabilityFast < 0 || stability < 0 || difficulty < 0 || difficulty > 10 ||
    reps < 0 || lapses < 0 || scheduledDays < 0 ||
    !Number.isInteger(state) || state < 0 || state > 3 ||
    (state !== 0 && (stabilityFast === 0 || stability === 0 || difficulty < 1))
  ) {
    throw new RangeError("ساختار کارت FSRS خارج از محدوده معتبر است؛ داده ذخیره نشد.");
  }

  const learningStep = card.learningStep === undefined
    ? undefined
    : requireFinite(card.learningStep, "learningStep");
  if (learningStep !== undefined && (!Number.isInteger(learningStep) || learningStep < 0)) {
    throw new RangeError("learningStep کارت FSRS نامعتبر است.");
  }
  if (typeof card.scheduleStatus !== "string" || !card.scheduleStatus.trim()) {
    throw new RangeError("scheduleStatus کارت FSRS نامعتبر است.");
  }

  return {
    cardId: card.cardId,
    stabilityFast,
    stability,
    difficulty,
    dueAt: dueAt.toISOString(),
    lastReviewAt: lastReviewAt?.toISOString() ?? null,
    reps,
    lapses,
    scheduledDays,
    ...(learningStep === undefined ? {} : { learningStep }),
    state,
    scheduleStatus: card.scheduleStatus
  };
}

/**
 * Rehydrate a JSON-safe card. Invalid data returns null instead of entering
 * ts-fsrs and contaminating its date/number calculations with NaN.
 */
export function deserializeFsrsCard(value: PersistedFsrsCard | null | undefined): FsrsCard | null {
  if (!value || typeof value !== "object") return null;

  if (
    typeof value.dueAt !== "string" ||
    (value.lastReviewAt !== null && typeof value.lastReviewAt !== "string") ||
    typeof value.scheduleStatus !== "string" ||
    value.scheduleStatus.trim().length === 0
  ) return null;

  const dueAt = new Date(value.dueAt);
  const lastReviewAt = value.lastReviewAt === null ? null : new Date(value.lastReviewAt);
  const numericFields = [
    value.stabilityFast,
    value.stability,
    value.difficulty,
    value.reps,
    value.lapses,
    value.scheduledDays,
    value.state
  ];

  if (
    !isValidDate(dueAt) ||
    (lastReviewAt !== null && !isValidDate(lastReviewAt)) ||
    numericFields.some((field) => typeof field !== "number" || !Number.isFinite(field)) ||
    (value.learningStep !== undefined && (!Number.isFinite(value.learningStep) || !Number.isInteger(value.learningStep) || value.learningStep < 0)) ||
    (typeof value.cardId !== "string" && typeof value.cardId !== "number") ||
    (typeof value.cardId === "string" && value.cardId.trim().length === 0) ||
    (typeof value.cardId === "number" && !Number.isFinite(value.cardId)) ||
    value.stabilityFast < 0 || value.stability < 0 ||
    value.difficulty < 0 || value.difficulty > 10 ||
    value.reps < 0 || value.lapses < 0 || value.scheduledDays < 0 ||
    !Number.isInteger(value.state) || value.state < 0 || value.state > 3 ||
    (value.state !== 0 && (value.stabilityFast === 0 || value.stability === 0 || value.difficulty < 1))
  ) {
    return null;
  }

  return {
    ...value,
    dueAt,
    lastReviewAt
  } as unknown as FsrsCard;
}

export async function createInitialFsrsCard(cardId: string, nowInput?: Date): Promise<PersistedFsrsCard> {
  const scheduler = await getFsrsScheduler();
  const now = resolveReviewTime(nowInput);
  const card = scheduler.newCard({ cardId, now });
  return serializeFsrsCard(card);
}

export async function previewFsrsRatings(
  storedCard: PersistedFsrsCard,
  nowInput?: Date
): Promise<RatingPreview[]> {
  const scheduler = await getFsrsScheduler();
  const card = deserializeFsrsCard(storedCard);
  if (!card) {
    throw new RangeError("اطلاعات زمان‌بندی این کارت خراب یا ناقص است؛ هیچ تغییری ذخیره نشد.");
  }

  const now = resolveReviewTime(nowInput);
  if (card.lastReviewAt && now.getTime() < card.lastReviewAt.getTime()) {
    throw new RangeError("ساعت دستگاه از زمان آخرین مرور عقب‌تر است؛ پیش‌نمایش زمان‌بندی انجام نشد.");
  }
  const previews: RatingPreview[] = [];

  for (const candidate of scheduler.preview({ card, now })) {
    const rating = gradeToRating.get(Number(candidate.grade));
    if (!rating) continue;

    const dueAt = requireValidDate(candidate.card.dueAt, "preview.dueAt");
    const intervalMs = dueAt.getTime() - now.getTime();
    if (!Number.isFinite(intervalMs)) {
      throw new RangeError("FSRS بازه زمانی نامعتبر تولید کرد؛ نتیجه نمایش داده نشد.");
    }

    previews.push({
      rating,
      dueAt: dueAt.toISOString(),
      intervalMs: Math.max(0, intervalMs),
      intervalDays: Math.max(0, intervalMs / DAY_MS)
    });
  }

  return previews.sort((a, b) => ratingOrder(a.rating) - ratingOrder(b.rating));
}

function ratingOrder(rating: ReviewRating): number {
  return ["again", "hard", "good", "easy"].indexOf(rating);
}

export async function calculateFsrsReview(
  storedCard: PersistedFsrsCard,
  noteId: string,
  rating: ReviewRating,
  nowInput?: Date
): Promise<AppliedReview> {
  const scheduler = await getFsrsScheduler();
  return calculateFsrsReviewWithScheduler(scheduler, storedCard, noteId, rating, nowInput);
}

/** Synchronous variant for use inside a Dexie transaction after scheduler warm-up. */
export function calculateFsrsReviewWithScheduler(
  scheduler: FsrsScheduler,
  storedCard: PersistedFsrsCard,
  noteId: string,
  rating: ReviewRating,
  nowInput?: Date
): AppliedReview {
  const card = deserializeFsrsCard(storedCard);
  if (!card) {
    throw new RangeError("اطلاعات کارت FSRS نامعتبر است؛ مرور ثبت نشد.");
  }

  const now = resolveReviewTime(nowInput);
  if (!Object.prototype.hasOwnProperty.call(ratingToGrade, rating)) {
    throw new RangeError("امتیاز مرور نامعتبر است؛ نتیجه ثبت نشد.");
  }
  const beforeDueAt = requireValidDate(card.dueAt, "card.dueAt");
  if (card.lastReviewAt && now.getTime() < card.lastReviewAt.getTime()) {
    throw new RangeError("ساعت دستگاه از زمان آخرین مرور عقب‌تر است؛ مرور ثبت نشد.");
  }
  const result = scheduler.review({
  card,
  grade: (rating === "again" ? 1 : rating === "hard" ? 2 : rating === "good" ? 3 : 4) as Grade,
  now,
});
  const persistedCard = serializeFsrsCard(result.card);
  const dueAfter = requireValidDate(result.card.dueAt, "result.dueAt");
  const intervalMs = dueAfter.getTime() - now.getTime();
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new RangeError("بازه مرور تولیدشده نامعتبر است؛ نتیجه ذخیره نشد.");
  }

  const rawRevlog = JSON.parse(JSON.stringify(result.revlog)) as Record<string, unknown>;
  const log: ReviewLog = {
    id: createId(),
    noteId,
    cardId: String(card.cardId),
    rating,
    reviewedAt: now.toISOString(),
    dueAtBefore: beforeDueAt.toISOString(),
    dueAtAfter: dueAfter.toISOString(),
    intervalDays: requireFinite(intervalMs / DAY_MS, "intervalDays"),
    stateAfter: requireFinite(result.card.state, "state"),
    stabilityAfter: requireFinite(result.card.stability, "stability"),
    stabilityFastAfter: requireFinite(result.card.stabilityFast, "stabilityFast"),
    difficultyAfter: requireFinite(result.card.difficulty, "difficulty"),
    modelVersion: MODEL_VERSION,
    rawRevlog
  };

  return { card: persistedCard, log };
}

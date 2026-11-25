import { NOTE_KINDS, type LearningNote, type ReviewCardRecord, type ReviewLog } from "../types/domain";
import { safeArray } from "../lib/safe";

export const MASTERY_MIN_STABILITY_DAYS = 21;
export const MASTERY_MIN_REPS = 5;

export interface ActivityDay {
  key: string;
  label: string;
  count: number;
}

export interface CategoryStatistic {
  kind: string;
  label: string;
  count: number;
  percentage: number;
}

export interface LearningStatistics {
  totalNotes: number;
  dueToday: number;
  mastered: number;
  reviewEvents: number;
  streakDays: number;
  activity: ActivityDay[];
  categories: CategoryStatistic[];
}

function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseValidDate(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function dateFromLocalKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year ?? 2000, (month ?? 1) - 1, day ?? 1, 12, 0, 0, 0);
}

function getStreak(logs: ReviewLog[], now: Date): number {
  const days = new Set<string>();
  for (const log of logs) {
    const date = parseValidDate(log?.reviewedAt);
    if (date) days.add(localDayKey(date));
  }
  const today = localDayKey(now);
  const yesterdayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
  const startKey = days.has(today) ? today : localDayKey(yesterdayDate);
  if (!days.has(startKey)) return 0;

  let streak = 0;
  const cursor = dateFromLocalKey(startKey);
  while (days.has(localDayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function calculateLearningStatistics(
  inputNotes: Array<LearningNote | null | undefined>,
  inputCards: Array<ReviewCardRecord | null | undefined>,
  inputLogs: Array<ReviewLog | null | undefined>,
  nowInput: Date = new Date(),
  activityDays = 14
): LearningStatistics {
  const now = Number.isFinite(nowInput.getTime()) ? new Date(nowInput.getTime()) : new Date();
  const notes = safeArray(inputNotes).filter((note): note is LearningNote => Boolean(note && typeof note.id === "string" && !note.deletedAt));
  const cards = safeArray(inputCards).filter((card): card is ReviewCardRecord => Boolean(card && typeof card.noteId === "string"));
  const logs = safeArray(inputLogs).filter((log): log is ReviewLog => Boolean(log && typeof log.reviewedAt === "string"));
  const activeIds = new Set(notes.map((note) => note.id));
  const cardByNote = new Map(cards.filter((card) => activeIds.has(card.noteId)).map((card) => [card.noteId, card]));

  const dueToday = notes.reduce((count, note) => {
    const due = parseValidDate(cardByNote.get(note.id)?.card?.dueAt);
    return count + (due && due.getTime() <= now.getTime() ? 1 : 0);
  }, 0);

  const mastered = notes.reduce((count, note) => {
    const card = cardByNote.get(note.id)?.card;
    const stable = typeof card?.stability === "number" && Number.isFinite(card.stability);
    const reps = typeof card?.reps === "number" && Number.isFinite(card.reps) ? card.reps : 0;
    return count + (card?.state === 2 && stable && card.stability >= MASTERY_MIN_STABILITY_DAYS && reps >= MASTERY_MIN_REPS ? 1 : 0);
  }, 0);

  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const requestedDays = Number.isFinite(activityDays) ? Math.trunc(activityDays) : 14;
  const totalDays = Math.max(1, Math.min(60, requestedDays));
  const countsByDay = new Map<string, number>();
  for (const log of logs) {
    const reviewedAt = parseValidDate(log.reviewedAt);
    if (!reviewedAt) continue;
    const key = localDayKey(reviewedAt);
    countsByDay.set(key, (countsByDay.get(key) ?? 0) + 1);
  }

  const activity: ActivityDay[] = [];
  for (let offset = totalDays; offset > 0; offset -= 1) {
    const date = new Date(end);
    date.setDate(end.getDate() - (offset - 1));
    const key = localDayKey(date);
    activity.push({
      key,
      label: new Intl.DateTimeFormat("fa-IR", { weekday: "short", day: "numeric" }).format(date),
      count: countsByDay.get(key) ?? 0
    });
  }

  const categories: CategoryStatistic[] = NOTE_KINDS.map((kind) => {
    const count = notes.filter((note) => note.kind === kind.value).length;
    return {
      kind: kind.value,
      label: kind.label,
      count,
      percentage: notes.length ? Math.round((count / notes.length) * 100) : 0
    };
  });

  return {
    totalNotes: notes.length,
    dueToday,
    mastered,
    reviewEvents: logs.length,
    streakDays: getStreak(logs, now),
    activity,
    categories
  };
}

export function localDayKeyForTests(date: Date): string {
  return localDayKey(date);
}

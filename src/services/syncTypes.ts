import type { LearningNote, ReviewCardRecord, ReviewLog } from "../types/domain";

export type SyncEntity = "notes" | "reviewCards" | "reviewLogs";
export type SyncProviderKind = "apps-script" | "supabase";

export interface SyncRecord<T = unknown> {
  id: string;
  updatedAt: string;
  payload: T;
}

export interface PullSnapshot {
  token: string;
  rowCounts?: Record<SyncEntity, number>;
}

export interface PullPage<T = unknown> {
  records: SyncRecord<T>[];
  nextCursor: string | number | null;
  done: boolean;
}

export interface SyncProvider {
  push(entity: SyncEntity, records: SyncRecord[]): Promise<{ accepted: number }>;
  beginPull(): Promise<PullSnapshot>;
  pullPage(entity: SyncEntity, snapshot: PullSnapshot, cursor: string | number | null, limit: number): Promise<PullPage>;
  close?(): void;
}

export interface SyncSettings {
  provider: SyncProviderKind;
  appsScriptUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  autoSync: boolean;
  rememberAppsScriptPin: boolean;
}

export type SyncPhase = "idle" | "connecting" | "pushing" | "pulling" | "merging" | "success" | "error";

export interface SyncStatus {
  phase: SyncPhase;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastSuccessAt: string | null;
  pushed: number;
  pulled: number;
  error: string | null;
}

export interface LocalSyncSnapshot {
  notes: LearningNote[];
  reviewCards: ReviewCardRecord[];
  reviewLogs: ReviewLog[];
}

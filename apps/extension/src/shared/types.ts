/**
 * src/shared/types.ts
 * Shared TypeScript schemas, types, and messaging contracts for Brainroad.
 */

export type PlatformType = 'instagram' | 'youtube';

export interface PlatformStats {
  total: number;
  today: number;
}

export interface DayHistoryRecord {
  total: number;
  instagram: number;
  youtube: number;
}

export interface BrainroadStats {
  version: number;
  total: number;
  today: number;
  lastActiveDate: string; // "YYYY-MM-DD" in local timezone
  platforms: {
    instagram: PlatformStats;
    youtube: PlatformStats;
  };
  history: Record<string, DayHistoryRecord>; // Keyed by "YYYY-MM-DD"
  updatedAt: number; // Unix epoch millis
}

export type MessageRequest =
  | { type: 'RECORD_VIEW'; platform: PlatformType; id: string; timestamp?: number }
  | { type: 'GET_STATS' }
  | { type: 'RESET_STATS'; scope?: 'today' | 'all' }
  | { type: 'GET_SESSION_SEEN' }
  | { type: 'REEL_DETECTED'; platform: 'instagram'; id: string; timestamp?: number }
  | { type: 'SHORT_VIEWED'; platform: 'youtube'; videoId?: string; id?: string; timestamp?: number };

export type MessageResponse =
  | { ok: true; stats: BrainroadStats; newlyCounted: boolean }
  | { ok: true; stats: BrainroadStats }
  | { ok: true; seenIds: string[] }
  | { ok: true; count?: number }
  | { ok: false; error: string };

export type FatigueStage = 'fresh' | 'warming' | 'tired' | 'drained' | 'rot';

export interface FatigueStageDefinition {
  stage: FatigueStage;
  name: string;
  min: number;
  max: number;
  color: string;
  textColor: string;
  description: string;
}

export const STORAGE_KEY_STATS = 'brainroad_stats';
export const STORAGE_KEY_SESSION_SEEN = 'brainroad_session_seen';

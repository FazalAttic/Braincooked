/**
 * src/background/storage.ts
 * Brainroad Storage Engine & Promise Mutex Queue.
 * Single-writer atomic persistence to chrome.storage.local with daily rollover and session deduplication.
 */

import {
  BrainroadStats,
  PlatformType,
  DayHistoryRecord,
  STORAGE_KEY_STATS,
  STORAGE_KEY_SESSION_SEEN
} from '../shared/types';
import { MAX_SESSION_SEEN_ITEMS, MAX_HISTORY_RETENTION_DAYS } from '../shared/constants';

export const STORAGE_KEY = STORAGE_KEY_STATS;
export { STORAGE_KEY_STATS, STORAGE_KEY_SESSION_SEEN };
export type { BrainroadStats, PlatformType, DayHistoryRecord };

/**
 * Single-writer asynchronous mutex queue.
 * Guarantees serial execution of asynchronous tasks, preventing read-modify-write lost updates.
 */
export class AsyncMutex {
  private queue: Promise<void> = Promise.resolve();

  public async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    // Synchronously advance queue tail pointer
    this.queue = current;

    try {
      // Await preceding task completion; suppress predecessor errors to prevent deadlock
      await previous.catch(() => {});
      return await task();
    } finally {
      release!();
    }
  }
}

/**
 * Generates ISO date string "YYYY-MM-DD" matching the local timezone calendar day.
 */
export function getTodayDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Produces clean default schema state.
 */
export function createDefaultStats(todayDateStr: string = getTodayDateString()): BrainroadStats {
  return {
    version: 1,
    total: 0,
    today: 0,
    lastActiveDate: todayDateStr,
    platforms: {
      instagram: { total: 0, today: 0 },
      youtube: { total: 0, today: 0 }
    },
    history: {},
    updatedAt: Date.now()
  };
}

/**
 * Validates and migrates raw storage data to compliant version 1 BrainroadStats.
 */
export function migrateStats(raw: any, todayStr: string = getTodayDateString()): BrainroadStats {
  if (!raw || typeof raw !== 'object') {
    return createDefaultStats(todayStr);
  }

  const total = typeof raw.total === 'number' && !isNaN(raw.total) && raw.total >= 0 ? raw.total : 0;
  const today = typeof raw.today === 'number' && !isNaN(raw.today) && raw.today >= 0 ? raw.today : 0;
  const lastActiveDate =
    typeof raw.lastActiveDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastActiveDate)
      ? raw.lastActiveDate
      : todayStr;

  const instagramTotal =
    typeof raw.platforms?.instagram?.total === 'number' && raw.platforms.instagram.total >= 0
      ? raw.platforms.instagram.total
      : 0;
  const instagramToday =
    typeof raw.platforms?.instagram?.today === 'number' && raw.platforms.instagram.today >= 0
      ? raw.platforms.instagram.today
      : 0;
  const youtubeTotal =
    typeof raw.platforms?.youtube?.total === 'number' && raw.platforms.youtube.total >= 0
      ? raw.platforms.youtube.total
      : 0;
  const youtubeToday =
    typeof raw.platforms?.youtube?.today === 'number' && raw.platforms.youtube.today >= 0
      ? raw.platforms.youtube.today
      : 0;

  const history: Record<string, DayHistoryRecord> = {};
  if (raw.history && typeof raw.history === 'object' && !Array.isArray(raw.history)) {
    for (const [dateKey, record] of Object.entries(raw.history)) {
      if (record && typeof record === 'object') {
        history[dateKey] = {
          total: typeof (record as any).total === 'number' ? (record as any).total : 0,
          instagram: typeof (record as any).instagram === 'number' ? (record as any).instagram : 0,
          youtube: typeof (record as any).youtube === 'number' ? (record as any).youtube : 0
        };
      }
    }
  }

  return {
    version: 1,
    total,
    today,
    lastActiveDate,
    platforms: {
      instagram: { total: instagramTotal, today: instagramToday },
      youtube: { total: youtubeTotal, today: youtubeToday }
    },
    history,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
  };
}

/**
 * Compares lastActiveDate with today's calendar date, archives previous tallies if changed,
 * and resets active today counters. Enforces rolling retention pruning.
 */
export function applyDailyRolloverIfNeeded(
  stats: BrainroadStats,
  todayStr: string
): { stats: BrainroadStats; rolledOver: boolean } {
  if (stats.lastActiveDate === todayStr) {
    return { stats, rolledOver: false };
  }

  // Archive previous day's metrics if there was any activity
  if (stats.today > 0 || stats.platforms.instagram.today > 0 || stats.platforms.youtube.today > 0) {
    stats.history[stats.lastActiveDate] = {
      total: stats.today,
      instagram: stats.platforms.instagram.today,
      youtube: stats.platforms.youtube.today
    };
  }

  // Prune history entries exceeding retention window (sorted chronologically)
  const historyDates = Object.keys(stats.history).sort();
  if (historyDates.length > MAX_HISTORY_RETENTION_DAYS) {
    const datesToPrune = historyDates.slice(0, historyDates.length - MAX_HISTORY_RETENTION_DAYS);
    for (const d of datesToPrune) {
      delete stats.history[d];
    }
  }

  // Reset active today tallies
  stats.today = 0;
  stats.platforms.instagram.today = 0;
  stats.platforms.youtube.today = 0;
  stats.lastActiveDate = todayStr;
  stats.updatedAt = Date.now();

  return { stats, rolledOver: true };
}

/**
 * StorageEngine orchestrates all reads and mutations through AsyncMutex.
 */
export class StorageEngine {
  private mutex = new AsyncMutex();
  private inMemorySessionFallback = new Set<string>();

  /**
   * Reads raw stats from chrome.storage.local with migration.
   */
  private async getRawStats(): Promise<{ stats: BrainroadStats; isUninitialized: boolean }> {
    const result = await chrome.storage.local.get(STORAGE_KEY_STATS);
    const raw = result ? result[STORAGE_KEY_STATS] : undefined;
    const isUninitialized = raw === undefined || raw === null;
    return {
      stats: migrateStats(raw),
      isUninitialized
    };
  }

  /**
   * Persists stats to chrome.storage.local.
   */
  public async saveRawStats(stats: BrainroadStats): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEY_STATS]: stats });
  }

  /**
   * Retrieves cross-tab session seen keys from chrome.storage.session with fallback.
   */
  private async getSessionSeenKeys(): Promise<Set<string>> {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      try {
        const res = await chrome.storage.session.get(STORAGE_KEY_SESSION_SEEN);
        const list = res ? res[STORAGE_KEY_SESSION_SEEN] : undefined;
        if (Array.isArray(list)) {
          return new Set(list);
        }
      } catch (err) {
        console.warn('[Brainroad Storage] storage.session read fallback:', err);
      }
    }
    return new Set(this.inMemorySessionFallback);
  }

  /**
   * Persists cross-tab session seen keys with bounded capacity.
   */
  private async saveSessionSeenKeys(seen: Set<string>): Promise<void> {
    let list = Array.from(seen);
    if (list.length > MAX_SESSION_SEEN_ITEMS) {
      list = list.slice(list.length - MAX_SESSION_SEEN_ITEMS);
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      try {
        await chrome.storage.session.set({ [STORAGE_KEY_SESSION_SEEN]: list });
        return;
      } catch (err) {
        console.warn('[Brainroad Storage] storage.session write fallback:', err);
      }
    }
    this.inMemorySessionFallback = new Set(list);
  }

  /**
   * Clears session seen keys (used on stats reset).
   */
  public async clearSessionSeenKeys(): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      try {
        await chrome.storage.session.remove(STORAGE_KEY_SESSION_SEEN);
      } catch {
        // Suppress
      }
    }
    this.inMemorySessionFallback.clear();
  }

  /**
   * Retrieves active stats, automatically applying day rollover if date changed.
   * Persists the initialized schema on pristine storage.
   */
  public async getStats(currentDate: Date = new Date()): Promise<BrainroadStats> {
    return this.mutex.runExclusive(async () => {
      const { stats, isUninitialized } = await this.getRawStats();
      const todayStr = getTodayDateString(currentDate);
      const { stats: updatedStats, rolledOver } = applyDailyRolloverIfNeeded(stats, todayStr);
      if (isUninitialized || rolledOver) {
        await this.saveRawStats(updatedStats);
      }
      return updatedStats;
    });
  }

  /**
   * Atomically records a qualified view.
   * Handles session deduplication, date rollover, counter increments, and persistence.
   */
  public async recordView(
    platform: PlatformType,
    id: string,
    timestamp: number = Date.now()
  ): Promise<{ ok: boolean; stats: BrainroadStats; newlyCounted: boolean }> {
    return this.mutex.runExclusive(async () => {
      const compositeKey = `${platform}:${id}`;
      const seen = await this.getSessionSeenKeys();

      // Tier 2 Deduplication Check
      if (seen.has(compositeKey)) {
        const { stats } = await this.getRawStats();
        const todayStr = getTodayDateString(new Date(timestamp));
        const { stats: updatedStats, rolledOver } = applyDailyRolloverIfNeeded(stats, todayStr);
        if (rolledOver) {
          await this.saveRawStats(updatedStats);
        }
        return { ok: true, stats: updatedStats, newlyCounted: false };
      }

      // Mark seen in session
      seen.add(compositeKey);
      await this.saveSessionSeenKeys(seen);

      // Mutate stats
      const { stats } = await this.getRawStats();
      const todayStr = getTodayDateString(new Date(timestamp));
      const { stats: updatedStats } = applyDailyRolloverIfNeeded(stats, todayStr);

      updatedStats.total += 1;
      updatedStats.today += 1;
      updatedStats.platforms[platform].total += 1;
      updatedStats.platforms[platform].today += 1;
      updatedStats.updatedAt = timestamp;

      await this.saveRawStats(updatedStats);

      return { ok: true, stats: updatedStats, newlyCounted: true };
    });
  }

  /**
   * Resets counts. Supports resetting 'all' or just 'today'.
   */
  public async resetStats(scope: 'all' | 'today' = 'all'): Promise<BrainroadStats> {
    return this.mutex.runExclusive(async () => {
      const todayStr = getTodayDateString();
      const { stats: currentStats } = await this.getRawStats();
      let stats = currentStats;

      if (scope === 'today') {
        stats.today = 0;
        stats.platforms.instagram.today = 0;
        stats.platforms.youtube.today = 0;
        stats.updatedAt = Date.now();
      } else {
        // Reset all metrics
        stats = createDefaultStats(todayStr);
        await this.clearSessionSeenKeys();
      }

      await this.saveRawStats(stats);
      return stats;
    });
  }

  /**
   * Returns list of currently seen session IDs.
   */
  public async getSessionSeen(): Promise<string[]> {
    const seen = await this.getSessionSeenKeys();
    return Array.from(seen);
  }
}

// Default singleton instance and top-level helper functions
export const defaultStorage = new StorageEngine();

export const getStats = (currentDate?: Date) => defaultStorage.getStats(currentDate);
export const recordView = (platform: PlatformType, id: string, timestamp?: number) =>
  defaultStorage.recordView(platform, id, timestamp);
export const resetStats = (scope?: 'all' | 'today') => defaultStorage.resetStats(scope);
export const getSessionSeen = () => defaultStorage.getSessionSeen();

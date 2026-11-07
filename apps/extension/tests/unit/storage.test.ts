/**
 * tests/unit/storage.test.ts
 * Unit tests for Brainroad Storage Engine & Mutex Concurrency.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mockChrome } from '../mocks/chrome';
import {
  getStats,
  recordView,
  resetStats,
  STORAGE_KEY,
  getTodayDateString,
  BrainroadStats
} from '../../src/background/storage';

describe('Storage Engine (src/background/storage.ts)', () => {
  beforeEach(() => {
    mockChrome.resetAll();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('1. Schema Initialization', () => {
    it('initializes default schema when storage is completely empty', async () => {
      const stats = await getStats();

      expect(stats).toBeDefined();
      expect(stats.version).toBe(1);
      expect(stats.total).toBe(0);
      expect(stats.today).toBe(0);
      expect(stats.lastActiveDate).toBe(getTodayDateString());
      expect(stats.platforms.instagram).toEqual({ total: 0, today: 0 });
      expect(stats.platforms.youtube).toEqual({ total: 0, today: 0 });
      expect(stats.history).toEqual({});
      expect(typeof stats.updatedAt).toBe('number');
    });

    it('persists the initialized schema in chrome.storage.local', async () => {
      await getStats();
      const raw = await mockChrome.storage.local.get(STORAGE_KEY);
      expect(raw[STORAGE_KEY]).toBeDefined();
      expect(raw[STORAGE_KEY].version).toBe(1);
    });
  });

  describe('2. Atomic Mutex Concurrency (50 Parallel recordView Calls)', () => {
    it('accurately serializes 50 concurrent recordView calls without lost updates', async () => {
      // 30 Instagram items + 20 YouTube items
      const instagramTasks = Array.from({ length: 30 }, (_, i) => ({
        platform: 'instagram' as const,
        id: `ig_reel_concurrent_${i}`,
        timestamp: Date.now() + i
      }));

      const youtubeTasks = Array.from({ length: 20 }, (_, i) => ({
        platform: 'youtube' as const,
        id: `yt_short_concurrent_${i}`,
        timestamp: Date.now() + 100 + i
      }));

      // Interleave tasks to maximize concurrent collision potential
      const allTasks = [];
      const maxLen = Math.max(instagramTasks.length, youtubeTasks.length);
      for (let i = 0; i < maxLen; i++) {
        if (i < instagramTasks.length) allTasks.push(instagramTasks[i]);
        if (i < youtubeTasks.length) allTasks.push(youtubeTasks[i]);
      }

      expect(allTasks.length).toBe(50);

      // Launch all 50 operations simultaneously via Promise.all
      const results = await Promise.all(
        allTasks.map((t) => recordView(t.platform, t.id, t.timestamp))
      );

      // Every single call must succeed and confirm newlyCounted
      for (const res of results) {
        expect(res.ok).toBe(true);
        expect(res.newlyCounted).toBe(true);
      }

      // Verify final aggregated counters in storage
      const finalStats = await getStats();
      expect(finalStats.total).toBe(50);
      expect(finalStats.today).toBe(50);
      expect(finalStats.platforms.instagram.total).toBe(30);
      expect(finalStats.platforms.instagram.today).toBe(30);
      expect(finalStats.platforms.youtube.total).toBe(20);
      expect(finalStats.platforms.youtube.today).toBe(20);
    });
  });

  describe('3. Daily Midnight Rollover', () => {
    it('archives previous day tallies and resets today counter when date changes', async () => {
      // Setup: Simulate yesterday (2026-11-05)
      const yesterdayDate = '2026-11-05';
      const initialStats: BrainroadStats = {
        version: 1,
        total: 100,
        today: 42,
        lastActiveDate: yesterdayDate,
        platforms: {
          instagram: { total: 60, today: 25 },
          youtube: { total: 40, today: 17 }
        },
        history: {},
        updatedAt: Date.now() - 86400000
      };

      await mockChrome.storage.local.set({ [STORAGE_KEY]: initialStats });

      // Advance mock system date to today (2026-11-06)
      vi.useFakeTimers();
      const mockToday = new Date('2026-11-06T12:00:00Z');
      vi.setSystemTime(mockToday);

      // Trigger first view of the new day
      const result = await recordView('instagram', 'new_day_reel_01', mockToday.getTime());
      expect(result.ok).toBe(true);
      expect(result.newlyCounted).toBe(true);

      const updatedStats = await getStats();

      // Assertions
      expect(updatedStats.lastActiveDate).toBe('2026-11-06');
      expect(updatedStats.today).toBe(1); // Reset to 0 + 1 for new view
      expect(updatedStats.total).toBe(101); // 100 + 1

      expect(updatedStats.platforms.instagram.today).toBe(1); // 0 + 1
      expect(updatedStats.platforms.instagram.total).toBe(61); // 60 + 1

      expect(updatedStats.platforms.youtube.today).toBe(0); // Reset for new day
      expect(updatedStats.platforms.youtube.total).toBe(40); // Preserved

      // Verify history archival
      expect(updatedStats.history[yesterdayDate]).toEqual({
        total: 42,
        instagram: 25,
        youtube: 17
      });
    });

    it('accumulates subsequent views on the same day without re-archiving', async () => {
      vi.useFakeTimers();
      const mockToday = new Date('2026-11-06T14:00:00Z');
      vi.setSystemTime(mockToday);

      await recordView('instagram', 'reel_1', mockToday.getTime());
      await recordView('youtube', 'short_1', mockToday.getTime());

      const stats = await getStats();
      expect(stats.today).toBe(2);
      expect(stats.total).toBe(2);
      expect(stats.platforms.instagram.today).toBe(1);
      expect(stats.platforms.youtube.today).toBe(1);
      // History should not contain today's date yet
      expect(stats.history['2026-11-06']).toBeUndefined();
    });
  });

  describe('4. Platform Counter Separation', () => {
    it('increments only Instagram counters when recording Instagram reel', async () => {
      await recordView('instagram', 'ig_exclusive_1', Date.now());

      const stats = await getStats();
      expect(stats.total).toBe(1);
      expect(stats.today).toBe(1);
      expect(stats.platforms.instagram).toEqual({ total: 1, today: 1 });
      expect(stats.platforms.youtube).toEqual({ total: 0, today: 0 });
    });

    it('increments only YouTube counters when recording YouTube short', async () => {
      await recordView('youtube', 'yt_exclusive_1', Date.now());

      const stats = await getStats();
      expect(stats.total).toBe(1);
      expect(stats.today).toBe(1);
      expect(stats.platforms.youtube).toEqual({ total: 1, today: 1 });
      expect(stats.platforms.instagram).toEqual({ total: 0, today: 0 });
    });
  });

  describe('5. Reset Stats', () => {
    it('resets all tallies and history to zero while preserving schema version', async () => {
      // Seed storage with existing data
      await recordView('instagram', 'ig_1', Date.now());
      await recordView('youtube', 'yt_1', Date.now());

      const beforeReset = await getStats();
      expect(beforeReset.total).toBe(2);

      // Perform reset
      await resetStats();

      const afterReset = await getStats();
      expect(afterReset.version).toBe(1);
      expect(afterReset.total).toBe(0);
      expect(afterReset.today).toBe(0);
      expect(afterReset.platforms.instagram).toEqual({ total: 0, today: 0 });
      expect(afterReset.platforms.youtube).toEqual({ total: 0, today: 0 });
      expect(afterReset.history).toEqual({});
      expect(afterReset.lastActiveDate).toBe(getTodayDateString());
    });
  });

  describe('6. Deduplication & Idempotence', () => {
    it('suppresses duplicate count when same ID is recorded within the same session', async () => {
      const first = await recordView('instagram', 'dup_reel_100', Date.now());
      expect(first.newlyCounted).toBe(true);

      const second = await recordView('instagram', 'dup_reel_100', Date.now() + 5000);
      expect(second.newlyCounted).toBe(false);

      const stats = await getStats();
      expect(stats.total).toBe(1);
      expect(stats.today).toBe(1);
    });
  });
});

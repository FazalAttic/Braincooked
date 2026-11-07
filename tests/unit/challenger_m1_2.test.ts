/**
 * tests/unit/challenger_m1_2.test.ts
 * Challenger M1-2 Empirical Stress Test Suite:
 * - 10,000 Randomized Integers Badge Length Invariant (<= 4 chars)
 * - Continuous & Deterministic Brain Fatigue Color Mapping (0, 20, 21, 50, 51, 100, 101, 150, 151, 100000)
 * - Sudden System Clock Jumps (+5d Forward without data loss, -2d Backward without crash)
 * - 120 Consecutive Days Recording & 90-Day Rolling History Pruning (<10MB storage footprint)
 * - Storage Schema Corruption Recovery & Fault-Tolerant Migration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockChrome } from '../mocks/chrome';
import {
  formatBadgeCount,
  getFatigueStage,
  getBadgeColor,
  getBadgeTextColor,
  updateBadge
} from '../../src/background/badge';
import {
  StorageEngine,
  STORAGE_KEY_STATS,
  migrateStats
} from '../../src/background/storage';
import { MAX_HISTORY_RETENTION_DAYS } from '../../src/shared/constants';
import type { BrainroadStats } from '../../src/shared/types';

describe('Challenger M1-2 Empirical Adversarial Stress Suite', () => {
  let storage: StorageEngine;

  beforeEach(() => {
    mockChrome.resetAll();
    vi.useRealTimers();
    storage = new StorageEngine();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ==========================================================================
  // 1. INVARIANT STRESS TESTING: formatBadgeCount (10,000+ Integers)
  // ==========================================================================
  describe('1. formatBadgeCount Invariant Stress Testing', () => {
    it('NEVER exceeds 4 characters across 10,000 randomized integers across all partitions', () => {
      const samples: number[] = [];

      // Partition 1: Negative integers (-1,000,000 to -1) -> 1,500 samples
      for (let i = 0; i < 1500; i++) {
        samples.push(-Math.floor(Math.random() * 1000000) - 1);
      }

      // Partition 2: Zero
      samples.push(0);

      // Partition 3: 1..999 -> 1,500 samples (including all critical boundaries)
      const boundaries1 = [1, 2, 5, 9, 10, 11, 42, 99, 100, 101, 500, 998, 999];
      samples.push(...boundaries1);
      for (let i = 0; i < 1500 - boundaries1.length; i++) {
        samples.push(Math.floor(Math.random() * 999) + 1);
      }

      // Partition 4: 1,000..9,999 -> 2,500 samples (including tenths boundaries)
      const boundaries2 = [
        1000, 1001, 1049, 1050, 1099, 1100, 1199, 1200, 1999, 2000,
        9899, 9900, 9949, 9950, 9990, 9998, 9999
      ];
      samples.push(...boundaries2);
      for (let i = 0; i < 2500 - boundaries2.length; i++) {
        samples.push(Math.floor(Math.random() * 9000) + 1000);
      }

      // Partition 5: 10,000..999,999 -> 2,500 samples (including thousands boundaries)
      const boundaries3 = [
        10000, 10001, 10999, 11000, 99999, 100000, 100001, 500000, 998999, 999000, 999999
      ];
      samples.push(...boundaries3);
      for (let i = 0; i < 2500 - boundaries3.length; i++) {
        samples.push(Math.floor(Math.random() * 990000) + 10000);
      }

      // Partition 6: >= 1,000,000 -> 2,000 samples (including 1M, 10M, 1B, MAX_SAFE_INTEGER)
      const boundaries4 = [
        1000000, 1000001, 1099999, 1100000, 1500000, 2000000, 10000000,
        100000000, 1000000000, Number.MAX_SAFE_INTEGER
      ];
      samples.push(...boundaries4);
      for (let i = 0; i < 2000 - boundaries4.length; i++) {
        samples.push(Math.floor(Math.random() * 100000000) + 1000000);
      }

      // Ensure total count is >= 10,000
      expect(samples.length).toBeGreaterThanOrEqual(10000);

      // Execute assertion across all samples
      let violations = 0;
      for (const val of samples) {
        const formatted = formatBadgeCount(val);
        if (typeof formatted !== 'string' || formatted.length > 4) {
          violations++;
          expect.fail(
            `Badge invariant violated: formatBadgeCount(${val}) produced "${formatted}" (length ${formatted.length} > 4)`
          );
        }
      }

      expect(violations).toBe(0);
    });

    it('handles non-integer floats, NaNs, and infinities safely with length <= 4', () => {
      const weirdInputs = [
        0.1, 0.5, 0.9, 1.5, 999.4, 999.9, 1000.1, 9999.9, 10000.5,
        999999.9, 1000000.1, NaN, Infinity, -Infinity, -0.5
      ];

      for (const input of weirdInputs) {
        const formatted = formatBadgeCount(input);
        expect(typeof formatted).toBe('string');
        expect(
          formatted.length,
          `formatBadgeCount(${input}) produced "${formatted}" with length > 4`
        ).toBeLessThanOrEqual(4);
      }
    });

    it('verifies exact boundary formatting semantics', () => {
      expect(formatBadgeCount(-10)).toBe('');
      expect(formatBadgeCount(0)).toBe('');
      expect(formatBadgeCount(1)).toBe('1');
      expect(formatBadgeCount(999)).toBe('999');
      expect(formatBadgeCount(1000)).toBe('1.0k');
      expect(formatBadgeCount(1099)).toBe('1.0k');
      expect(formatBadgeCount(1100)).toBe('1.1k');
      expect(formatBadgeCount(9900)).toBe('9.9k');
      expect(formatBadgeCount(9999)).toBe('9.9k'); // Crucial: must not floor/round to 10.0k (5 chars)
      expect(formatBadgeCount(10000)).toBe('10k');
      expect(formatBadgeCount(99999)).toBe('99k');
      expect(formatBadgeCount(100000)).toBe('100k');
      expect(formatBadgeCount(999999)).toBe('999k');
      expect(formatBadgeCount(1000000)).toBe('1M+');
      expect(formatBadgeCount(5000000)).toBe('1M+');
    });
  });

  // ==========================================================================
  // 2. INVARIANT STRESS TESTING: Color Mapping Boundaries & Determinism
  // ==========================================================================
  describe('2. Brain Fatigue Color Mapping Continuity & Determinism', () => {
    it('maps all required boundary integers with continuous and deterministic hex colors', () => {
      const boundaryExpected = [
        { count: 0, stage: 'fresh', color: '#79D056', textColor: '#FFFFFF' },
        { count: 20, stage: 'fresh', color: '#79D056', textColor: '#FFFFFF' },
        { count: 21, stage: 'warming', color: '#FFE9B4', textColor: '#0A0907' },
        { count: 50, stage: 'warming', color: '#FFE9B4', textColor: '#0A0907' },
        { count: 51, stage: 'tired', color: '#FFB367', textColor: '#0A0907' },
        { count: 100, stage: 'tired', color: '#FFB367', textColor: '#0A0907' },
        { count: 101, stage: 'drained', color: '#FC4A52', textColor: '#FFFFFF' },
        { count: 150, stage: 'drained', color: '#FC4A52', textColor: '#FFFFFF' },
        { count: 151, stage: 'rot', color: '#9B51E0', textColor: '#FFFFFF' },
        { count: 100000, stage: 'rot', color: '#9B51E0', textColor: '#FFFFFF' }
      ];

      for (const b of boundaryExpected) {
        const stageDef = getFatigueStage(b.count);
        expect(stageDef.stage).toBe(b.stage);
        expect(stageDef.color).toBe(b.color);
        expect(stageDef.textColor).toBe(b.textColor);

        expect(getBadgeColor(b.count)).toBe(b.color);
        expect(getBadgeTextColor(b.count)).toBe(b.textColor);
      }
    });

    it('performs continuous integer sweep [0..200] with zero undefined or unmapped values', () => {
      for (let count = 0; count <= 200; count++) {
        const stage = getFatigueStage(count);
        const color = getBadgeColor(count);
        const textColor = getBadgeTextColor(count);

        expect(stage).toBeDefined();
        expect(typeof color).toBe('string');
        expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(typeof textColor).toBe('string');
        expect(textColor).toMatch(/^#[0-9A-Fa-f]{6}$/);

        if (count <= 20) {
          expect(stage.stage).toBe('fresh');
          expect(color).toBe('#79D056');
        } else if (count <= 50) {
          expect(stage.stage).toBe('warming');
          expect(color).toBe('#FFE9B4');
        } else if (count <= 100) {
          expect(stage.stage).toBe('tired');
          expect(color).toBe('#FFB367');
        } else if (count <= 150) {
          expect(stage.stage).toBe('drained');
          expect(color).toBe('#FC4A52');
        } else {
          expect(stage.stage).toBe('rot');
          expect(color).toBe('#9B51E0');
        }
      }
    });

    it('is completely deterministic over 1,000 repeated calls for any given value', () => {
      const testVal = 42;
      const initial = getFatigueStage(testVal);

      for (let i = 0; i < 1000; i++) {
        const result = getFatigueStage(testVal);
        expect(result.stage).toBe(initial.stage);
        expect(result.color).toBe(initial.color);
        expect(result.textColor).toBe(initial.textColor);
      }
    });

    it('safely handles negative numbers, NaN, and infinity by falling back cleanly', () => {
      // safeCount sanitizes non-finite or negative inputs to 0, which safely maps to 'fresh'
      expect(getFatigueStage(-50).stage).toBe('fresh');
      expect(getFatigueStage(NaN).stage).toBe('fresh');
      expect(getFatigueStage(Infinity).stage).toBe('fresh');
    });
  });

  // ==========================================================================
  // 3. TEMPORAL EDGE CASES: Sudden System Clock Jumps
  // ==========================================================================
  describe('3. Temporal Edge Cases: Sudden Clock Jumps', () => {
    it('handles forward clock jump (+5 days) without data loss', async () => {
      vi.useFakeTimers();

      // Day T: 2026-11-01
      const day1 = new Date('2026-11-01T10:00:00Z');
      vi.setSystemTime(day1);

      // Record 15 Instagram reels + 10 YouTube shorts on Day 1
      for (let i = 0; i < 15; i++) {
        await storage.recordView('instagram', `day1_ig_${i}`, day1.getTime() + i);
      }
      for (let i = 0; i < 10; i++) {
        await storage.recordView('youtube', `day1_yt_${i}`, day1.getTime() + 100 + i);
      }

      const initialStats = await storage.getStats();
      expect(initialStats.total).toBe(25);
      expect(initialStats.today).toBe(25);
      expect(initialStats.platforms.instagram.total).toBe(15);
      expect(initialStats.platforms.instagram.today).toBe(15);
      expect(initialStats.platforms.youtube.total).toBe(10);
      expect(initialStats.platforms.youtube.today).toBe(10);
      expect(initialStats.lastActiveDate).toBe('2026-11-01');

      // SUDDEN CLOCK JUMP: Jump forward 5 days to 2026-11-06
      const day6 = new Date('2026-11-06T14:30:00Z');
      vi.setSystemTime(day6);

      // First user interaction after clock jump: record a view
      const jumpResult = await storage.recordView('instagram', 'jump_forward_ig_1', day6.getTime());
      expect(jumpResult.ok).toBe(true);
      expect(jumpResult.newlyCounted).toBe(true);

      const postJumpStats = await storage.getStats();

      // Invariants:
      // 1. lastActiveDate updated to new day
      expect(postJumpStats.lastActiveDate).toBe('2026-11-06');
      // 2. All-time total preserved + 1 new view (25 + 1 = 26) -> NO DATA LOSS
      expect(postJumpStats.total).toBe(26);
      // 3. Today count reset to 0 + 1 = 1
      expect(postJumpStats.today).toBe(1);
      // 4. Platform breakdowns
      expect(postJumpStats.platforms.instagram.total).toBe(16);
      expect(postJumpStats.platforms.instagram.today).toBe(1);
      expect(postJumpStats.platforms.youtube.total).toBe(10);
      expect(postJumpStats.platforms.youtube.today).toBe(0);
      // 5. Day 1 archived intact in history
      expect(postJumpStats.history['2026-11-01']).toEqual({
        total: 25,
        instagram: 15,
        youtube: 10
      });
      // 6. Days 2026-11-02..2026-11-05 had zero views; history should not have empty entries
      expect(postJumpStats.history['2026-11-02']).toBeUndefined();
      expect(postJumpStats.history['2026-11-03']).toBeUndefined();
      expect(postJumpStats.history['2026-11-04']).toBeUndefined();
      expect(postJumpStats.history['2026-11-05']).toBeUndefined();
    });

    it('handles backward clock jump (-2 days) without crashing or corrupting total count', async () => {
      vi.useFakeTimers();

      // Day T: 2026-11-06
      const futureDate = new Date('2026-11-06T15:00:00Z');
      vi.setSystemTime(futureDate);

      // Record 10 views on 2026-11-06
      for (let i = 0; i < 6; i++) {
        await storage.recordView('instagram', `nov6_ig_${i}`, futureDate.getTime() + i);
      }
      for (let i = 0; i < 4; i++) {
        await storage.recordView('youtube', `nov6_yt_${i}`, futureDate.getTime() + 50 + i);
      }

      const initialStats = await storage.getStats();
      expect(initialStats.total).toBe(10);
      expect(initialStats.today).toBe(10);
      expect(initialStats.lastActiveDate).toBe('2026-11-06');

      // SUDDEN CLOCK JUMP: Jump BACKWARD 2 days to 2026-11-04
      const pastDate = new Date('2026-11-04T09:00:00Z');
      vi.setSystemTime(pastDate);

      // Record a view in the past
      const backwardResult = await storage.recordView('youtube', 'nov4_yt_jump', pastDate.getTime());

      expect(backwardResult.ok).toBe(true);
      expect(backwardResult.newlyCounted).toBe(true);

      const backwardStats = await storage.getStats();

      // Invariants:
      // 1. Service worker / storage engine did NOT crash
      expect(backwardStats).toBeDefined();
      // 2. lastActiveDate updated to 2026-11-04
      expect(backwardStats.lastActiveDate).toBe('2026-11-04');
      // 3. All-time total preserved and monotonically increased (10 + 1 = 11)
      expect(backwardStats.total).toBe(11);
      // 4. Today counter active for 2026-11-04
      expect(backwardStats.today).toBe(1);
      expect(backwardStats.platforms.youtube.today).toBe(1);
      expect(backwardStats.platforms.instagram.today).toBe(0);
      // 5. Nov 6 was archived safely in history
      expect(backwardStats.history['2026-11-06']).toEqual({
        total: 10,
        instagram: 6,
        youtube: 4
      });
    });
  });

  // ==========================================================================
  // 4. ROLLING RETENTION: 120 Consecutive Days Recording & 90-Day Pruning
  // ==========================================================================
  describe('4. 120 Consecutive Days Recording & 90-Day Retention Pruning', () => {
    it('prunes history beyond 90 days and maintains storage footprint far below 10MB', async () => {
      vi.useFakeTimers();

      // Simulate 120 consecutive days from 2026-01-01 to 2026-04-30
      const startDate = new Date('2026-01-01T12:00:00Z');
      let cumulativeTotal = 0;

      for (let dayIndex = 0; dayIndex < 120; dayIndex++) {
        const currentDate = new Date(startDate.getTime() + dayIndex * 86400000);
        vi.setSystemTime(currentDate);

        // Record 5 views per day (3 IG, 2 YT)
        await storage.recordView('instagram', `day_${dayIndex}_ig_1`, currentDate.getTime() + 10);
        await storage.recordView('instagram', `day_${dayIndex}_ig_2`, currentDate.getTime() + 20);
        await storage.recordView('instagram', `day_${dayIndex}_ig_3`, currentDate.getTime() + 30);
        await storage.recordView('youtube', `day_${dayIndex}_yt_1`, currentDate.getTime() + 40);
        await storage.recordView('youtube', `day_${dayIndex}_yt_2`, currentDate.getTime() + 50);

        cumulativeTotal += 5;
      }

      // Final inspection on Day 120
      const finalStats = await storage.getStats();

      // Invariants:
      // 1. Total views strictly tracked
      expect(finalStats.total).toBe(cumulativeTotal);
      expect(finalStats.total).toBe(120 * 5); // 600 views

      // 2. History must contain AT MOST 90 records
      const historyKeys = Object.keys(finalStats.history);
      expect(historyKeys.length).toBeLessThanOrEqual(MAX_HISTORY_RETENTION_DAYS);
      expect(historyKeys.length).toBe(90);

      // 3. Days 0..28 (2026-01-01 through 2026-01-29) MUST be pruned
      expect(finalStats.history['2026-01-01']).toBeUndefined();
      expect(finalStats.history['2026-01-15']).toBeUndefined();
      expect(finalStats.history['2026-01-29']).toBeUndefined();

      // 4. Most recent completed days (Days 29..118, 2026-01-30 to 2026-04-29) MUST be present
      expect(finalStats.history['2026-01-30']).toBeDefined();
      expect(finalStats.history['2026-01-30'].total).toBe(5);
      expect(finalStats.history['2026-04-29']).toBeDefined();
      expect(finalStats.history['2026-04-29'].total).toBe(5);

      // 5. Day 119 (2026-04-30) is the active today count
      expect(finalStats.today).toBe(5);
      expect(finalStats.lastActiveDate).toBe('2026-04-30');

      // 6. STORAGE FOOTPRINT: Chrome local quota is 10 MB (10,485,760 bytes)
      const serialized = JSON.stringify(finalStats);
      const footprintBytes = new TextEncoder().encode(serialized).length;
      const CHROME_QUOTA_BYTES = 10 * 1024 * 1024; // 10MB

      // Footprint should be ~5-7 KB, less than 0.1% of quota
      expect(footprintBytes).toBeLessThan(50 * 1024); // Far below 50KB limit
      expect(footprintBytes).toBeLessThan(CHROME_QUOTA_BYTES);

      // Log verified empirical footprint
      console.log(`[Challenger M1-2] 120-Day Storage Footprint: ${footprintBytes} bytes (${(footprintBytes / CHROME_QUOTA_BYTES * 100).toFixed(4)}% of 10MB quota)`);
    });
  });

  // ==========================================================================
  // 5. CORRUPTED STORAGE DATA & MIGRATION RECOVERY
  // ==========================================================================
  describe('5. Corrupted Storage Data & migrateStats() Recovery', () => {
    it('migrateStats() produces valid BrainroadStats from exhaustive corrupted types', () => {
      const corruptedInputs = [
        null,
        undefined,
        '',
        'corrupted-string',
        12345,
        true,
        false,
        [],
        [1, 2, 3],
        {},
        { version: 'bad', total: '100' },
        { total: -50, today: -10, lastActiveDate: 12345 },
        { total: NaN, today: Infinity, updatedAt: 'yesterday' },
        { platforms: null },
        { platforms: 'invalid' },
        { platforms: { instagram: null, youtube: { total: 'invalid', today: -99 } } },
        { history: null },
        { history: 'invalid' },
        { history: [1, 2, 3] },
        {
          history: {
            '2026-11-01': null,
            '2026-11-02': 'invalid',
            '2026-11-03': { total: 'bad', instagram: -5, youtube: NaN }
          }
        }
      ];

      for (const input of corruptedInputs) {
        let migrated: BrainroadStats;
        expect(() => {
          migrated = migrateStats(input);
        }).not.toThrow();

        // Strict schema compliance verification:
        expect(migrated!.version).toBe(1);
        expect(typeof migrated!.total).toBe('number');
        expect(migrated!.total).toBeGreaterThanOrEqual(0);
        expect(typeof migrated!.today).toBe('number');
        expect(migrated!.today).toBeGreaterThanOrEqual(0);

        expect(typeof migrated!.lastActiveDate).toBe('string');
        expect(migrated!.lastActiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

        expect(migrated!.platforms).toBeDefined();
        expect(migrated!.platforms.instagram).toBeDefined();
        expect(typeof migrated!.platforms.instagram.total).toBe('number');
        expect(typeof migrated!.platforms.instagram.today).toBe('number');
        expect(migrated!.platforms.youtube).toBeDefined();
        expect(typeof migrated!.platforms.youtube.total).toBe('number');
        expect(typeof migrated!.platforms.youtube.today).toBe('number');

        expect(migrated!.history).toBeDefined();
        expect(typeof migrated!.history).toBe('object');
        expect(Array.isArray(migrated!.history)).toBe(false);

        expect(typeof migrated!.updatedAt).toBe('number');
      }
    });

    it('service worker storage engine recovers cleanly from corrupted storage without crashing', async () => {
      // 1. Inject completely corrupted raw data directly into chrome.storage.local
      const corruptedBlob = {
        version: 'corrupted',
        total: 'garbage_string',
        today: -999,
        lastActiveDate: 'invalid-date',
        platforms: {
          instagram: 'broken',
          youtube: null
        },
        history: 'not-a-record'
      };

      await mockChrome.storage.local.set({ [STORAGE_KEY_STATS]: corruptedBlob });

      // 2. StorageEngine.getStats() must self-heal cleanly
      let statsAfterCorruption: BrainroadStats;
      await expect(
        (async () => {
          statsAfterCorruption = await storage.getStats();
          return statsAfterCorruption;
        })()
      ).resolves.toBeDefined();

      expect(statsAfterCorruption!.version).toBe(1);
      expect(statsAfterCorruption!.total).toBe(0);
      expect(statsAfterCorruption!.today).toBe(0);
      expect(statsAfterCorruption!.platforms.instagram).toEqual({ total: 0, today: 0 });
      expect(statsAfterCorruption!.platforms.youtube).toEqual({ total: 0, today: 0 });

      // 3. StorageEngine.recordView() must succeed and write back clean data
      const recordRes = await storage.recordView('instagram', 'recovery_reel_1');
      expect(recordRes.ok).toBe(true);
      expect(recordRes.newlyCounted).toBe(true);
      expect(recordRes.stats.total).toBe(1);
      expect(recordRes.stats.today).toBe(1);
      expect(recordRes.stats.platforms.instagram.total).toBe(1);

      // 4. Verify storage is now in a 100% compliant state
      const persisted = await mockChrome.storage.local.get(STORAGE_KEY_STATS);
      expect(persisted[STORAGE_KEY_STATS].version).toBe(1);
      expect(persisted[STORAGE_KEY_STATS].total).toBe(1);

      // 5. Verify badge updates without exception
      await expect(updateBadge(recordRes.stats.today)).resolves.not.toThrow();
      expect(await mockChrome.action.getBadgeText()).toBe('1');
    });
  });

  // ==========================================================================
  // 6. ADVERSARIAL CONCURRENCY: Midnight Boundary Race Conditions
  // ==========================================================================
  describe('6. Midnight Rollover Concurrency Race Condition', () => {
    it('serializes 40 concurrent views split across the midnight transition without race conditions', async () => {
      vi.useFakeTimers();

      // Start on 2026-11-05 at 23:59:59 local time
      const day1 = new Date(2026, 10, 5, 23, 59, 59);
      vi.setSystemTime(day1);

      // Record 10 views before midnight
      for (let i = 0; i < 10; i++) {
        await storage.recordView('instagram', `pre_mid_${i}`, day1.getTime() + i);
      }

      // Now prepare 20 operations scheduled on Day 1 (before midnight)
      // and 20 operations scheduled on Day 2 (after midnight in local time)
      const day2 = new Date(2026, 10, 6, 0, 0, 1);

      const preMidnightTasks = Array.from({ length: 20 }, (_, i) => ({
        platform: 'instagram' as const,
        id: `concur_pre_${i}`,
        timestamp: day1.getTime() + 10 + i
      }));

      const postMidnightTasks = Array.from({ length: 20 }, (_, i) => ({
        platform: 'youtube' as const,
        id: `concur_post_${i}`,
        timestamp: day2.getTime() + i
      }));

      // Fire all pre-midnight tasks concurrently
      const preResults = await Promise.all(
        preMidnightTasks.map((t) => storage.recordView(t.platform, t.id, t.timestamp))
      );
      for (const res of preResults) {
        expect(res.ok).toBe(true);
        expect(res.newlyCounted).toBe(true);
      }

      // Now fire all post-midnight tasks concurrently
      const postResults = await Promise.all(
        postMidnightTasks.map((t) => storage.recordView(t.platform, t.id, t.timestamp))
      );
      for (const res of postResults) {
        expect(res.ok).toBe(true);
        expect(res.newlyCounted).toBe(true);
      }

      // Now advance clock to Day 2 and verify state
      vi.setSystemTime(day2);
      const finalStats = await storage.getStats();

      // Invariants:
      // Total count = 10 (initial) + 20 (pre) + 20 (post) = 50 total views
      expect(finalStats.total).toBe(50);
      // History for 2026-11-05 must have archived the 30 Day 1 views
      expect(finalStats.history['2026-11-05']).toBeDefined();
      expect(finalStats.history['2026-11-05'].total).toBe(30);
      expect(finalStats.history['2026-11-05'].instagram).toBe(30);
      // Today counter for 2026-11-06 must have exactly the 20 YouTube post-midnight views
      expect(finalStats.today).toBe(20);
      expect(finalStats.platforms.youtube.today).toBe(20);
      expect(finalStats.platforms.instagram.today).toBe(0);
      // All-time platform totals
      expect(finalStats.platforms.instagram.total).toBe(30);
      expect(finalStats.platforms.youtube.total).toBe(20);
    });
  });

  // ==========================================================================
  // 7. MUTEX FAULT TOLERANCE & DEADLOCK IMMUNITY
  // ==========================================================================
  describe('7. AsyncMutex Deadlock Immunity on Predecessor Failures', () => {
    it('continues processing subsequent tasks even if a prior task throws an unhandled error', async () => {
      const mutex = storage['mutex'];

      // Task 1: Fails intentionally
      const failingTask = mutex.runExclusive(async () => {
        throw new Error('Simulated atomic crash inside critical section');
      });

      await expect(failingTask).rejects.toThrow('Simulated atomic crash inside critical section');

      // Task 2: Executed immediately after task 1 failure. Must NOT deadlock.
      const succeedingTask = await mutex.runExclusive(async () => {
        return 'success_after_crash';
      });

      expect(succeedingTask).toBe('success_after_crash');
    });
  });
});

/**
 * tests/unit/challenger_m1_1.test.ts
 * Challenger M1-1 Empirical Adversarial Stress Suite:
 * - 200 Interleaved Concurrent recordView Requests Across 5 Simulated Tabs with Random Microtask Latencies
 * - Deduplication Under Extreme Race Conditions (200 Requests for 50 Shared Items)
 * - AsyncMutex Deadlock Freedom & Error Resilience (Synchronous Throws & Rejected Promises)
 * - Storage Error Injections (Simulated QuotaExceededError, Intermittent IO Failures, Session Storage Failure Fallback)
 * - Midnight Rollover Under High-Contention Concurrent Race Conditions
 * - Concurrent Reset Under Active High Write Contention
 * - High-Throughput Burst (500 Sequential and Concurrent Operations)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockChrome } from '../mocks/chrome';
import {
  StorageEngine,
  AsyncMutex,
  STORAGE_KEY_STATS,
  getTodayDateString,
  BrainroadStats
} from '../../src/background/storage';

// Helper for simulated browser microtask and asynchronous network/IPC jitter
const randomJitter = (maxMs = 15): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * maxMs)));

describe('Challenger M1-1 Empirical Adversarial Stress Suite', () => {
  let engine: StorageEngine;

  beforeEach(() => {
    mockChrome.resetAll();
    vi.useRealTimers();
    engine = new StorageEngine();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. EXTREME CONCURRENCY: 200 Interleaved Requests Across 5 Simulated Tabs
  // ==========================================================================
  describe('1. 200 Interleaved Concurrent recordView Requests Across 5 Tabs', () => {
    it('accurately records 200 concurrent requests without a single lost update', async () => {
      // Seed initial baseline stats
      const baselineStats: BrainroadStats = {
        version: 1,
        total: 15,
        today: 15,
        lastActiveDate: getTodayDateString(),
        platforms: {
          instagram: { total: 10, today: 10 },
          youtube: { total: 5, today: 5 }
        },
        history: {},
        updatedAt: Date.now() - 5000
      };
      await mockChrome.storage.local.set({ [STORAGE_KEY_STATS]: baselineStats });

      // Tab definitions: 5 concurrent tabs
      // Tab 1: Instagram (40 unique reels)
      // Tab 2: YouTube (40 unique shorts)
      // Tab 3: Instagram (40 unique reels)
      // Tab 4: YouTube (40 unique shorts)
      // Tab 5: Mixed (20 Instagram reels + 20 YouTube shorts)
      // Total: 100 Instagram items, 100 YouTube items = 200 distinct items.

      const tab1Requests = Array.from({ length: 40 }, (_, i) => ({
        tab: 'tab1_ig',
        platform: 'instagram' as const,
        id: `reel_tab1_${i}`
      }));
      const tab2Requests = Array.from({ length: 40 }, (_, i) => ({
        tab: 'tab2_yt',
        platform: 'youtube' as const,
        id: `short_tab2_${i}`
      }));
      const tab3Requests = Array.from({ length: 40 }, (_, i) => ({
        tab: 'tab3_ig',
        platform: 'instagram' as const,
        id: `reel_tab3_${i}`
      }));
      const tab4Requests = Array.from({ length: 40 }, (_, i) => ({
        tab: 'tab4_yt',
        platform: 'youtube' as const,
        id: `short_tab4_${i}`
      }));
      const tab5Requests = [
        ...Array.from({ length: 20 }, (_, i) => ({
          tab: 'tab5_mixed',
          platform: 'instagram' as const,
          id: `reel_tab5_${i}`
        })),
        ...Array.from({ length: 20 }, (_, i) => ({
          tab: 'tab5_mixed',
          platform: 'youtube' as const,
          id: `short_tab5_${i}`
        }))
      ];

      // Merge and shuffle all 200 requests to maximize concurrent interleaved arrival
      const allRequests = [
        ...tab1Requests,
        ...tab2Requests,
        ...tab3Requests,
        ...tab4Requests,
        ...tab5Requests
      ];

      // Fisher-Yates shuffle
      for (let i = allRequests.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allRequests[i], allRequests[j]] = [allRequests[j], allRequests[i]];
      }

      expect(allRequests.length).toBe(200);

      // Launch all 200 concurrent requests with random microtask jitter (0..15ms)
      const dispatchTime = Date.now();
      const results = await Promise.all(
        allRequests.map(async (req, idx) => {
          await randomJitter(15);
          return engine.recordView(req.platform, req.id, dispatchTime + idx);
        })
      );

      // Verify every request returned ok: true and newlyCounted: true
      expect(results.length).toBe(200);
      for (const res of results) {
        expect(res.ok).toBe(true);
        expect(res.newlyCounted).toBe(true);
      }

      // Verify final aggregated counters in storage
      const finalStats = await engine.getStats();

      // Invariants:
      // Total: 15 (initial) + 200 = 215
      // Today: 15 (initial) + 200 = 215
      // Instagram: 10 (initial) + 100 = 110
      // YouTube: 5 (initial) + 100 = 105
      expect(finalStats.total).toBe(215);
      expect(finalStats.today).toBe(215);
      expect(finalStats.platforms.instagram.total).toBe(110);
      expect(finalStats.platforms.instagram.today).toBe(110);
      expect(finalStats.platforms.youtube.total).toBe(105);
      expect(finalStats.platforms.youtube.today).toBe(105);

      // Direct verification against underlying mock chrome.storage.local
      const rawInStorage = await mockChrome.storage.local.get(STORAGE_KEY_STATS);
      expect(rawInStorage[STORAGE_KEY_STATS].total).toBe(215);
      expect(rawInStorage[STORAGE_KEY_STATS].platforms.instagram.total).toBe(110);
      expect(rawInStorage[STORAGE_KEY_STATS].platforms.youtube.total).toBe(105);
    });
  });

  // ==========================================================================
  // 2. DEDUPLICATION UNDER EXTREME RACE CONDITIONS
  // ==========================================================================
  describe('2. Deduplication Under Extreme Race Conditions (200 Calls for 50 Shared Items)', () => {
    it('allows exactly 1 increment per distinct ID when 4 tabs report identical items concurrently', async () => {
      // 50 unique items: 25 Instagram, 25 YouTube
      const uniqueItems = [
        ...Array.from({ length: 25 }, (_, i) => ({
          platform: 'instagram' as const,
          id: `viral_reel_${i}`
        })),
        ...Array.from({ length: 25 }, (_, i) => ({
          platform: 'youtube' as const,
          id: `viral_short_${i}`
        }))
      ];

      // Each item is submitted by 4 tabs concurrently (50 * 4 = 200 requests)
      const allRequests: Array<{ platform: 'instagram' | 'youtube'; id: string; tabIndex: number }> = [];
      for (let tab = 1; tab <= 4; tab++) {
        for (const item of uniqueItems) {
          allRequests.push({ ...item, tabIndex: tab });
        }
      }

      // Shuffle requests
      for (let i = allRequests.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allRequests[i], allRequests[j]] = [allRequests[j], allRequests[i]];
      }

      expect(allRequests.length).toBe(200);

      // Fire all 200 calls with randomized microtask delays
      const now = Date.now();
      const results = await Promise.all(
        allRequests.map(async (req, idx) => {
          await randomJitter(10);
          return engine.recordView(req.platform, req.id, now + idx);
        })
      );

      // Empirical Oracles:
      // Exactly 50 calls must report newlyCounted === true
      // Exactly 150 calls must report newlyCounted === false
      const newlyCountedCount = results.filter((r) => r.newlyCounted === true).length;
      const suppressedCount = results.filter((r) => r.newlyCounted === false).length;

      expect(newlyCountedCount).toBe(50);
      expect(suppressedCount).toBe(150);

      // Verify storage totals increased by exactly 50
      const finalStats = await engine.getStats();
      expect(finalStats.total).toBe(50);
      expect(finalStats.today).toBe(50);
      expect(finalStats.platforms.instagram.total).toBe(25);
      expect(finalStats.platforms.youtube.total).toBe(25);

      // Verify all 50 items are recorded in session seen storage
      const seen = await engine.getSessionSeen();
      expect(seen.length).toBe(50);
      for (const item of uniqueItems) {
        expect(seen).toContain(`${item.platform}:${item.id}`);
      }
    });
  });

  // ==========================================================================
  // 3. ASYNCMUTEX DEADLOCK FREEDOM & ERROR RESILIENCE
  // ==========================================================================
  describe('3. AsyncMutex Deadlock Freedom & Error Resilience', () => {
    it('survives sequential and concurrent task rejections without stalling the queue', async () => {
      const mutex = new AsyncMutex();
      const executedTasks: number[] = [];
      const caughtErrors: Array<{ taskIndex: number; message: string }> = [];

      // 60 tasks in total; tasks 10, 20, 30, 40, 50 deliberately reject
      const rejectingIndices = new Set([10, 20, 30, 40, 50]);

      const tasks = Array.from({ length: 60 }, (_, idx) => async () => {
        try {
          const result = await mutex.runExclusive(async () => {
            await randomJitter(3);
            if (rejectingIndices.has(idx)) {
              throw new Error(`Injected failure at task ${idx}`);
            }
            executedTasks.push(idx);
            return `success_${idx}`;
          });
          return { idx, result, error: null };
        } catch (err: any) {
          caughtErrors.push({ taskIndex: idx, message: err.message });
          return { idx, result: null, error: err.message };
        }
      });

      // Dispatch all 60 tasks simultaneously
      const results = await Promise.all(tasks.map((t) => t()));
      expect(results.length).toBe(60);

      // Oracles:
      // 1. Exactly 5 tasks failed with their expected injected errors
      expect(caughtErrors.length).toBe(5);
      expect(caughtErrors.map((e) => e.taskIndex)).toEqual([10, 20, 30, 40, 50]);

      // 2. Exactly 55 tasks completed successfully
      expect(executedTasks.length).toBe(55);

      // 3. FIFO order of successful tasks is strictly maintained
      const expectedSuccessfulIndices = Array.from({ length: 60 }, (_, i) => i).filter(
        (i) => !rejectingIndices.has(i)
      );
      expect(executedTasks).toEqual(expectedSuccessfulIndices);

      // 4. Verify queue is fully healthy and accepts subsequent new tasks immediately
      const postCheck = await mutex.runExclusive(async () => 'queue_is_healthy');
      expect(postCheck).toBe('queue_is_healthy');
    });

    it('safely handles synchronous exceptions inside runExclusive callback', async () => {
      const mutex = new AsyncMutex();

      // Task 1: Synchronous throw (before returning any promise)
      const task1Promise = mutex.runExclusive(() => {
        throw new Error('Synchronous throw inside task executor');
      });

      await expect(task1Promise).rejects.toThrow('Synchronous throw inside task executor');

      // Task 2: Must execute immediately without deadlock
      const task2Result = await mutex.runExclusive(async () => 'task_2_unblocked');
      expect(task2Result).toBe('task_2_unblocked');
    });

    it('does not leak unhandled promise rejections on process', async () => {
      let unhandledRejectionDetected = false;
      const unhandledListener = () => {
        unhandledRejectionDetected = true;
      };
      process.on('unhandledRejection', unhandledListener);

      const mutex = new AsyncMutex();

      // Create a chain of 20 tasks where every 2nd task rejects
      const promises = Array.from({ length: 20 }, (_, i) =>
        mutex
          .runExclusive(async () => {
            if (i % 2 === 1) throw new Error(`Task ${i} rejected`);
            return i;
          })
          .catch((err) => ({ errorHandled: true, index: i, msg: err.message }))
      );

      const results = await Promise.all(promises);
      expect(results.length).toBe(20);

      // Allow any microtasks to settle
      await new Promise((r) => setTimeout(r, 20));

      process.removeListener('unhandledRejection', unhandledListener);
      expect(unhandledRejectionDetected).toBe(false);
    });
  });

  // ==========================================================================
  // 4. STORAGE ERROR INJECTIONS (Quota, IO Errors, Session Fallback)
  // ==========================================================================
  describe('4. Storage Error Injections (Simulated Quota, IO, Session Fallback)', () => {
    it('recovers cleanly after simulated chrome.storage.local QUOTA_BYTES exceeded failure', async () => {
      // 1. Initial successful write
      await engine.recordView('instagram', 'reel_before_quota');
      const statsBefore = await engine.getStats();
      expect(statsBefore.total).toBe(1);

      // 2. Inject QuotaExceededError into chrome.storage.local.set
      const originalSet = mockChrome.storage.local.set.bind(mockChrome.storage.local);
      let quotaActive = true;

      mockChrome.storage.local.set = vi.fn().mockImplementation(async (items: any) => {
        if (quotaActive) {
          throw new Error('QUOTA_BYTES quota exceeded (simulated Chrome error)');
        }
        return originalSet(items);
      });

      // 3. Attempt write while quota is exceeded -> Must reject cleanly
      await expect(engine.recordView('instagram', 'reel_during_quota')).rejects.toThrow(
        'QUOTA_BYTES quota exceeded'
      );

      // 4. Lift quota restriction (simulating storage clearing or browser recovery)
      quotaActive = false;

      // 5. Subsequent write must succeed: mutex was not permanently locked
      const recoveryResult = await engine.recordView('instagram', 'reel_after_quota');
      expect(recoveryResult.ok).toBe(true);
      expect(recoveryResult.newlyCounted).toBe(true);

      const statsAfter = await engine.getStats();
      // Total should be 2: initial reel + recovery reel (the failed reel was not counted)
      expect(statsAfter.total).toBe(2);

      // Restore original mock
      mockChrome.storage.local.set = originalSet;
    });

    it('processes surviving tasks through the mutex during intermittent IO failures', async () => {
      const originalSet = mockChrome.storage.local.set.bind(mockChrome.storage.local);
      let callCount = 0;

      // Every 3rd write fails with an IO error
      mockChrome.storage.local.set = vi.fn().mockImplementation(async (items: any) => {
        callCount++;
        if (callCount % 3 === 0) {
          throw new Error(`Transient IO error on write #${callCount}`);
        }
        return originalSet(items);
      });

      // Launch 30 concurrent recordView requests
      const requests = Array.from({ length: 30 }, (_, i) => ({
        platform: (i % 2 === 0 ? 'instagram' : 'youtube') as 'instagram' | 'youtube',
        id: `intermittent_item_${i}`
      }));

      const results = await Promise.allSettled(
        requests.map((r) => engine.recordView(r.platform, r.id))
      );

      // Mutex must process every request without deadlocking or hanging
      expect(results.length).toBe(30);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Both fulfilled and rejected outcomes must exist, and the queue must not have stalled
      expect(rejected.length).toBeGreaterThan(0);
      expect(fulfilled.length).toBeGreaterThan(0);
      expect(fulfilled.length + rejected.length).toBe(30);

      // Restore original set
      mockChrome.storage.local.set = originalSet;

      // Subsequent operation executes normally
      const finalStats = await engine.getStats();
      expect(finalStats.total).toBe(fulfilled.length);
    });

    it('falls back to inMemorySessionFallback when chrome.storage.session throws', async () => {
      // Mock chrome.storage.session.get and set to throw (e.g. Incognito or disabled session storage)
      const originalSessionGet = mockChrome.storage.session.get.bind(mockChrome.storage.session);
      const originalSessionSet = mockChrome.storage.session.set.bind(mockChrome.storage.session);

      mockChrome.storage.session.get = vi.fn().mockRejectedValue(new Error('Session storage disabled'));
      mockChrome.storage.session.set = vi.fn().mockRejectedValue(new Error('Session storage disabled'));

      // 1. Record first view
      const first = await engine.recordView('instagram', 'fallback_reel_1');
      expect(first.ok).toBe(true);
      expect(first.newlyCounted).toBe(true);

      // 2. Duplicate view of same ID within session -> Must still be deduplicated via memory fallback!
      const duplicate = await engine.recordView('instagram', 'fallback_reel_1');
      expect(duplicate.ok).toBe(true);
      expect(duplicate.newlyCounted).toBe(false);

      // 3. Different view -> Must be counted
      const second = await engine.recordView('youtube', 'fallback_short_1');
      expect(second.ok).toBe(true);
      expect(second.newlyCounted).toBe(true);

      const stats = await engine.getStats();
      expect(stats.total).toBe(2);
      expect(stats.platforms.instagram.total).toBe(1);
      expect(stats.platforms.youtube.total).toBe(1);

      // Restore session mock
      mockChrome.storage.session.get = originalSessionGet;
      mockChrome.storage.session.set = originalSessionSet;
    });
  });

  // ==========================================================================
  // 5. MIDNIGHT ROLLOVER UNDER HIGH-CONTENTION CONCURRENT RACE CONDITIONS
  // ==========================================================================
  describe('5. Midnight Rollover Under High-Contention Concurrent Race Conditions', () => {
    it('atomically rolls over today counters when time advances across midnight under concurrent load', async () => {
      // Local timezone midnight boundary: Day 1 = Nov 6, Day 2 = Nov 7
      const day1Date = new Date(2026, 10, 6, 23, 59, 50);
      const day2Date = new Date(2026, 10, 7, 0, 0, 10);
      const day1Str = getTodayDateString(day1Date);
      const day2Str = getTodayDateString(day2Date);
      const day1Timestamp = day1Date.getTime();
      const day2Timestamp = day2Date.getTime();

      // Seed baseline for Day 1
      const initialStats: BrainroadStats = {
        version: 1,
        total: 50,
        today: 50,
        lastActiveDate: day1Str,
        platforms: {
          instagram: { total: 30, today: 30 },
          youtube: { total: 20, today: 20 }
        },
        history: {},
        updatedAt: day1Timestamp - 3600000
      };
      await mockChrome.storage.local.set({ [STORAGE_KEY_STATS]: initialStats });

      // 50 concurrent calls dispatched on Day 1
      const day1Calls = Array.from({ length: 50 }, (_, i) => ({
        platform: (i % 2 === 0 ? 'instagram' : 'youtube') as 'instagram' | 'youtube',
        id: `day1_item_${i}`,
        timestamp: day1Timestamp + i
      }));

      await Promise.all(
        day1Calls.map(async (call) => {
          await randomJitter(5);
          return engine.recordView(call.platform, call.id, call.timestamp);
        })
      );

      // Verify Day 1 tallies reached 100 before midnight
      const day1Stats = await engine.getStats(day1Date);
      expect(day1Stats.today).toBe(100);
      expect(day1Stats.total).toBe(100);

      // 50 concurrent calls dispatched on Day 2 across multiple simulated tabs
      const day2Calls = Array.from({ length: 50 }, (_, i) => ({
        platform: (i % 2 === 0 ? 'instagram' : 'youtube') as 'instagram' | 'youtube',
        id: `day2_item_${i}`,
        timestamp: day2Timestamp + i
      }));

      await Promise.all(
        day2Calls.map(async (call) => {
          await randomJitter(8);
          return engine.recordView(call.platform, call.id, call.timestamp);
        })
      );

      // Retrieve final stats as of Day 2
      const finalStats = await engine.getStats(new Date(day2Timestamp + 60000));

      // Verifications:
      // Total must be initial (50) + 50 (Day 1) + 50 (Day 2) = 150
      expect(finalStats.total).toBe(150);
      expect(finalStats.lastActiveDate).toBe(day2Str);

      // Day 1 history must be archived accurately:
      // 50 initial + 50 new Day 1 views = 100 total for Day 1
      expect(finalStats.history[day1Str]).toBeDefined();
      expect(finalStats.history[day1Str].total).toBe(100);
      expect(finalStats.history[day1Str].instagram).toBe(55); // 30 initial + 25 new
      expect(finalStats.history[day1Str].youtube).toBe(45);   // 20 initial + 25 new

      // Active today counter must reflect ONLY Day 2 views (50 new views)
      expect(finalStats.today).toBe(50);
      expect(finalStats.platforms.instagram.today).toBe(25);
      expect(finalStats.platforms.youtube.today).toBe(25);

      // All-time platform counters are cumulative
      expect(finalStats.platforms.instagram.total).toBe(80); // 30 initial + 25 + 25
      expect(finalStats.platforms.youtube.total).toBe(70);   // 20 initial + 25 + 25
    });

    it('demonstrates vulnerability: an out-of-order delayed timestamp across midnight resets active today and archives future date', async () => {
      // Step 1: Active day is Nov 7, user has 10 views today
      const day1Date = new Date(2026, 10, 6, 23, 59, 50);
      const day2Date = new Date(2026, 10, 7, 12, 0, 0);
      const day1Str = getTodayDateString(day1Date);
      const day2Str = getTodayDateString(day2Date);

      const statsDay2: BrainroadStats = {
        version: 1,
        total: 10,
        today: 10,
        lastActiveDate: day2Str,
        platforms: {
          instagram: { total: 10, today: 10 },
          youtube: { total: 0, today: 0 }
        },
        history: {},
        updatedAt: day2Date.getTime()
      };
      await mockChrome.storage.local.set({ [STORAGE_KEY_STATS]: statsDay2 });

      // Step 2: An asynchronous delayed event from Nov 6 arrives (e.g. from a paused tab)
      await engine.recordView('instagram', 'delayed_reel_nov6', day1Date.getTime());

      // Check state immediately after delayed event
      const stateAfterDelayed = await mockChrome.storage.local.get(STORAGE_KEY_STATS);
      const intermediate = stateAfterDelayed[STORAGE_KEY_STATS];

      // Vulnerability symptom 1: lastActiveDate was set back in time to Day 1
      expect(intermediate.lastActiveDate).toBe(day1Str);
      // Vulnerability symptom 2: Day 2 (future date) was archived into history prematurely
      expect(intermediate.history[day2Str]).toBeDefined();
      expect(intermediate.history[day2Str].total).toBe(10);
      // Vulnerability symptom 3: today count was reset to 0 + 1 = 1 (instead of keeping Day 2 today count intact)
      expect(intermediate.today).toBe(1);

      // Step 3: User continues browsing on Day 2
      await engine.recordView('instagram', 'nov7_next_reel', day2Date.getTime() + 1000);
      const stateAfterNext = await mockChrome.storage.local.get(STORAGE_KEY_STATS);
      const finalState = stateAfterNext[STORAGE_KEY_STATS];

      // Total count is conserved (10 + 1 + 1 = 12)
      expect(finalState.total).toBe(12);
      // But today's count for Day 2 was split/lost from active 'today' (now showing 1 instead of 11)
      expect(finalState.today).toBe(1);
    });
  });

  // ==========================================================================
  // 6. CONCURRENT RESET UNDER ACTIVE HIGH WRITE CONTENTION
  // ==========================================================================
  describe('6. Concurrent Reset Under Active High Write Contention', () => {
    it('serializes resetStats atomically amidst concurrent recordView requests without data corruption', async () => {
      // 30 recordView calls dispatched before reset, 1 reset, 30 recordView calls dispatched after
      const preCalls = Array.from({ length: 30 }, (_, i) => ({
        platform: 'instagram' as const,
        id: `pre_reset_reel_${i}`
      }));

      const postCalls = Array.from({ length: 30 }, (_, i) => ({
        platform: 'youtube' as const,
        id: `post_reset_short_${i}`
      }));

      // Dispatch pre-calls, then reset, then post-calls concurrently
      const prePromises = preCalls.map(async (c) => {
        await randomJitter(5);
        return engine.recordView(c.platform, c.id);
      });

      const resetPromise = (async () => {
        await randomJitter(10);
        return engine.resetStats('all');
      })();

      const postPromises = postCalls.map(async (c) => {
        await randomJitter(15);
        return engine.recordView(c.platform, c.id);
      });

      const [preResults, resetResult, postResults] = await Promise.all([
        Promise.all(prePromises),
        resetPromise,
        Promise.all(postPromises)
      ]);

      // All calls must have completed successfully
      expect(preResults.length).toBe(30);
      expect(resetResult).toBeDefined();
      expect(postResults.length).toBe(30);

      // Final state must be strictly consistent and valid
      const finalStats = await engine.getStats();
      expect(finalStats.version).toBe(1);
      expect(typeof finalStats.total).toBe('number');
      expect(typeof finalStats.today).toBe('number');
      expect(finalStats.total).toBe(finalStats.platforms.instagram.total + finalStats.platforms.youtube.total);
      expect(finalStats.today).toBe(finalStats.platforms.instagram.today + finalStats.platforms.youtube.today);
    });
  });

  // ==========================================================================
  // 7. HIGH-THROUGHPUT BURST (500 Operations)
  // ==========================================================================
  describe('7. High-Throughput Burst (500 Sequential and Concurrent Operations)', () => {
    it('executes a 500-request high-volume stress burst cleanly under 2 seconds', async () => {
      const startTime = Date.now();

      // 500 requests across both platforms
      const requests = Array.from({ length: 500 }, (_, i) => ({
        platform: (i % 2 === 0 ? 'instagram' : 'youtube') as 'instagram' | 'youtube',
        id: `burst_item_${i}`
      }));

      const results = await Promise.all(
        requests.map((r, idx) => engine.recordView(r.platform, r.id, startTime + idx))
      );

      const durationMs = Date.now() - startTime;

      expect(results.length).toBe(500);
      for (const res of results) {
        expect(res.ok).toBe(true);
        expect(res.newlyCounted).toBe(true);
      }

      const finalStats = await engine.getStats();
      expect(finalStats.total).toBe(500);
      expect(finalStats.today).toBe(500);
      expect(finalStats.platforms.instagram.total).toBe(250);
      expect(finalStats.platforms.youtube.total).toBe(250);

      // Must complete in under 2000ms
      expect(durationMs).toBeLessThan(2000);
    });
  });
});

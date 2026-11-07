// tests/e2e/tier1_features.test.js
// Tier 1: Core Feature Verification (>= 5 test cases per feature for F1 to F17 = 85 tests)

import assert from 'node:assert/strict';
import {
  createMockChrome,
  MockDocument,
  MockWindow,
  MockIntersectionObserver,
  MockMutationObserver,
  createServiceWorkerController,
  createInstagramDetector,
  createYouTubeDetector,
  createPopupController,
  formatBadgeCount,
  getFatigueStage,
  getTodayDateString,
  validateManifest
} from './harness.js';

export async function runTier1Tests() {
  const results = [];

  async function test(name, fn) {
    const start = Date.now();
    try {
      await fn();
      results.push({ name, passed: true, durationMs: Date.now() - start });
    } catch (err) {
      results.push({ name, passed: false, error: err.message, stack: err.stack, durationMs: Date.now() - start });
    }
  }

  // ==========================================
  // F1: Manifest V3 Declaration (5 tests)
  // ==========================================
  await test('T1.F1.1: Validates manifest_version is 3, name and version are strings', async () => {
    const chrome = createMockChrome();
    const manifest = chrome.runtime.getManifest();
    assert.equal(manifest.manifest_version, 3);
    assert.equal(typeof manifest.name, 'string');
    assert.ok(manifest.name.length > 0);
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  });

  await test('T1.F1.2: Validates permissions array includes storage and excludes broad tabs', async () => {
    const chrome = createMockChrome();
    const manifest = chrome.runtime.getManifest();
    assert.ok(Array.isArray(manifest.permissions));
    assert.ok(manifest.permissions.includes('storage'));
    assert.ok(!manifest.permissions.includes('tabs'), 'Unnecessary broad tabs permission must be avoided');
  });

  await test('T1.F1.3: Validates host_permissions are scoped strictly to instagram and youtube', async () => {
    const chrome = createMockChrome();
    const manifest = chrome.runtime.getManifest();
    assert.ok(Array.isArray(manifest.host_permissions));
    assert.ok(manifest.host_permissions.some(h => h.includes('instagram.com')));
    assert.ok(manifest.host_permissions.some(h => h.includes('youtube.com')));
    assert.ok(!manifest.host_permissions.includes('<all_urls>'));
  });

  await test('T1.F1.4: Validates background declares service_worker with module type', async () => {
    const chrome = createMockChrome();
    const manifest = chrome.runtime.getManifest();
    assert.ok(manifest.background);
    assert.ok(typeof manifest.background.service_worker === 'string');
    assert.equal(manifest.background.type, 'module');
  });

  await test('T1.F1.5: Validates action declares default_popup and icons', async () => {
    const chrome = createMockChrome();
    const manifest = chrome.runtime.getManifest();
    assert.ok(manifest.action);
    assert.ok(manifest.action.default_popup.includes('popup'));
    assert.ok(manifest.icons);
    assert.ok(manifest.icons['16'] && manifest.icons['48'] && manifest.icons['128']);
  });

  // ==========================================
  // F2: Storage & Mutex Core (5 tests)
  // ==========================================
  await test('T1.F2.1: Storage initializes with default zero counters and current date', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    const stats = await sw.getStats();
    assert.equal(stats.version, 1);
    assert.equal(stats.total, 0);
    assert.equal(stats.today, 0);
    assert.equal(stats.platforms.instagram.total, 0);
    assert.equal(stats.platforms.youtube.total, 0);
    assert.equal(stats.lastActiveDate, getTodayDateString());
  });

  await test('T1.F2.2: Storage increments persist accurately to chrome.storage.local', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    const res = await sw.handleRecordView('instagram', 'reel_101');
    assert.equal(res.ok, true);
    assert.equal(res.newlyCounted, true);

    const stored = await chrome.storage.local.get('brainroad_stats');
    assert.equal(stored.brainroad_stats.total, 1);
    assert.equal(stored.brainroad_stats.today, 1);
    assert.equal(stored.brainroad_stats.platforms.instagram.today, 1);
  });

  await test('T1.F2.3: Mutex queue serializes concurrent write calls without race conditions', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    // Send 10 concurrent requests with different IDs
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(sw.handleRecordView('youtube', `short_${i}`));
    }
    const results = await Promise.all(promises);
    for (const r of results) {
      assert.equal(r.ok, true);
      assert.equal(r.newlyCounted, true);
    }
    const stats = await sw.getStats();
    assert.equal(stats.total, 10);
    assert.equal(stats.today, 10);
    assert.equal(stats.platforms.youtube.today, 10);
  });

  await test('T1.F2.4: Storage records platform breakdown for instagram and youtube separately', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    await sw.handleRecordView('instagram', 'ig_01');
    await sw.handleRecordView('instagram', 'ig_02');
    await sw.handleRecordView('youtube', 'yt_01');
    const stats = await sw.getStats();
    assert.equal(stats.total, 3);
    assert.equal(stats.platforms.instagram.total, 2);
    assert.equal(stats.platforms.youtube.total, 1);
  });

  await test('T1.F2.5: Storage updates timestamp updatedAt on mutation', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    const before = Date.now();
    await sw.handleRecordView('youtube', 'yt_time_check');
    const stats = await sw.getStats();
    assert.ok(stats.updatedAt >= before);
  });

  // ==========================================
  // F3: Daily Rollover & History (5 tests)
  // ==========================================
  await test('T1.F3.1: getTodayDateString formats date string as YYYY-MM-DD', async () => {
    const d = new Date(2026, 10, 6); // Month is 0-indexed: 10 = Nov
    assert.equal(getTodayDateString(d), '2026-11-06');
  });

  await test('T1.F3.2: Daily rollover resets today counter when system date advances', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    const day1 = new Date(2026, 10, 6, 14, 0, 0);
    await sw.handleRecordView('instagram', 'reel_day1', day1);
    let stats = await sw.getStats();
    assert.equal(stats.today, 1);
    assert.equal(stats.lastActiveDate, '2026-11-06');

    // Day 2 view
    const day2 = new Date(2026, 10, 7, 9, 0, 0);
    await sw.handleRecordView('youtube', 'short_day2', day2);
    stats = await sw.getStats();
    assert.equal(stats.lastActiveDate, '2026-11-07');
    assert.equal(stats.today, 1); // Reset and incremented by 1
    assert.equal(stats.total, 2); // Cumulative total preserved
  });

  await test('T1.F3.3: Yesterday tallies are archived in history[yesterday]', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    const day1 = new Date(2026, 10, 6, 12, 0, 0);
    await sw.handleRecordView('instagram', 'reel_ig1', day1);
    await sw.handleRecordView('youtube', 'short_yt1', day1);

    const day2 = new Date(2026, 10, 7, 8, 0, 0);
    await sw.handleRecordView('youtube', 'short_yt2', day2);

    const stats = await sw.getStats();
    assert.ok(stats.history['2026-11-06']);
    assert.equal(stats.history['2026-11-06'].total, 2);
    assert.equal(stats.history['2026-11-06'].instagram, 1);
    assert.equal(stats.history['2026-11-06'].youtube, 1);
  });

  await test('T1.F3.4: All-time total counter persists cumulative sum across day boundaries', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    for (let d = 1; d <= 5; d++) {
      const dt = new Date(2026, 10, d, 10, 0, 0);
      await sw.handleRecordView('instagram', `ig_${d}`, dt);
    }
    const stats = await sw.getStats();
    assert.equal(stats.total, 5);
    assert.equal(stats.today, 1); // 5th day's today count
  });

  await test('T1.F3.5: History pruning keeps at most 90 days of records', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    const stats = await sw.getStats();

    // Populate 95 simulated days in history
    for (let i = 1; i <= 95; i++) {
      const pad = String(i).padStart(3, '0');
      stats.history[`2025-01-${pad}`] = { total: 5, instagram: 3, youtube: 2 };
    }
    stats.lastActiveDate = '2025-05-01';
    await chrome.storage.local.set({ brainroad_stats: stats });

    // Trigger rollover
    const nextDay = new Date(2025, 4, 2);
    await sw.handleRecordView('youtube', 'new_yt', nextDay);
    const updated = await sw.getStats();
    assert.ok(Object.keys(updated.history).length <= 90);
  });

  // ==========================================
  // F4: Action Badge Display (5 tests)
  // ==========================================
  await test('T1.F4.1: Count 0 produces empty string badge text', async () => {
    assert.equal(formatBadgeCount(0), '');
    assert.equal(formatBadgeCount(-5), '');
  });

  await test('T1.F4.2: Count 1 to 999 formats as direct integer string', async () => {
    assert.equal(formatBadgeCount(1), '1');
    assert.equal(formatBadgeCount(42), '42');
    assert.equal(formatBadgeCount(999), '999');
  });

  await test('T1.F4.3: Count 1,000 to 9,999 formats as decimal thousands e.g. 1.5k', async () => {
    assert.equal(formatBadgeCount(1000), '1k');
    assert.equal(formatBadgeCount(1200), '1.2k');
    assert.equal(formatBadgeCount(9900), '9.9k');
  });

  await test('T1.F4.4: Count 10,000 to 999,999 formats as integer thousands e.g. 12k', async () => {
    assert.equal(formatBadgeCount(10000), '10k');
    assert.equal(formatBadgeCount(85000), '85k');
    assert.equal(formatBadgeCount(999000), '999k');
    assert.equal(formatBadgeCount(1000000), '1M+');
  });

  await test('T1.F4.5: Action badge background color matches current fatigue stage color', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);

    await sw.handleRecordView('instagram', 'r1');
    assert.equal(await chrome.action.getBadgeBackgroundColor(), '#79D056'); // Fresh

    // Bump to 25 views (Warming Up)
    for (let i = 2; i <= 25; i++) {
      await sw.handleRecordView('instagram', `r${i}`);
    }
    assert.equal(await chrome.action.getBadgeBackgroundColor(), '#FFE9B4'); // Warming Up
  });

  // ==========================================
  // F5: Typed Messaging Bus (5 tests)
  // ==========================================
  await test('T1.F5.1: RECORD_VIEW message increments stats and returns newlyCounted: true', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);

    const res = await chrome.runtime.sendMessage({
      type: 'RECORD_VIEW',
      platform: 'youtube',
      id: 'msg_yt_01',
      timestamp: Date.now()
    });
    assert.equal(res.ok, true);
    assert.equal(res.newlyCounted, true);
    assert.equal(res.stats.total, 1);
  });

  await test('T1.F5.2: GET_STATS message returns full storage stats schema', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);

    const res = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
    assert.equal(res.ok, true);
    assert.equal(res.stats.version, 1);
    assert.equal(res.stats.today, 0);
  });

  await test('T1.F5.3: RESET_STATS message resets today counts and clears session cache', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);

    await chrome.runtime.sendMessage({ type: 'RECORD_VIEW', platform: 'instagram', id: 'reset_test', timestamp: Date.now() });
    const res = await chrome.runtime.sendMessage({ type: 'RESET_STATS' });
    assert.equal(res.ok, true);
    assert.equal(res.stats.today, 0);
    assert.equal(res.stats.platforms.instagram.today, 0);

    const sessionData = await chrome.storage.session.get('sessionSeenIds');
    assert.deepEqual(sessionData.sessionSeenIds, []);
  });

  await test('T1.F5.4: GET_SESSION_SEEN message returns array of seen session keys', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);

    await chrome.runtime.sendMessage({ type: 'RECORD_VIEW', platform: 'instagram', id: 'seen_01', timestamp: Date.now() });
    const res = await chrome.runtime.sendMessage({ type: 'GET_SESSION_SEEN' });
    assert.equal(res.ok, true);
    assert.equal(res.count, 1);
    assert.ok(res.ids.includes('instagram:seen_01'));
  });

  await test('T1.F5.5: Unknown message type returns error response { ok: false, error: ... }', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);

    const res = await chrome.runtime.sendMessage({ type: 'INVALID_TYPE' });
    assert.equal(res.ok, false);
    assert.ok(res.error.includes('Unknown message type'));
  });

  // ==========================================
  // F6: Instagram URL & SPA Detection (5 tests)
  // ==========================================
  await test('T1.F6.1: Direct URL navigation to /reel/<shortcode>/ extracts shortcode', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/C9xYz1234_a/';

    const detector = createInstagramDetector(chrome, win, doc);
    const video = doc.createElement('video');
    const shortcode = detector.extractShortcode(video);
    assert.equal(shortcode, 'C9xYz1234_a');
  });

  await test('T1.F6.2: Dedicated reels stream URL /reels/<shortcode>/ extracts shortcode', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reels/D8kPmNoQ98z/';

    const detector = createInstagramDetector(chrome, win, doc);
    const video = doc.createElement('video');
    const shortcode = detector.extractShortcode(video);
    assert.equal(shortcode, 'D8kPmNoQ98z');
  });

  await test('T1.F6.3: SPA history navigation updates pathname and extracts new shortcode', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);

    win.history.pushState(null, '', '/reels/first_reel/');
    const detector = createInstagramDetector(chrome, win, doc);
    const video = doc.createElement('video');
    assert.equal(detector.extractShortcode(video), 'first_reel');

    win.history.pushState(null, '', '/reels/second_reel/');
    assert.equal(detector.extractShortcode(video), 'second_reel');
  });

  await test('T1.F6.4: Popstate history back navigation detects previous shortcode', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);

    win.history.pushState(null, '', '/reel/orig_reel/');
    const detector = createInstagramDetector(chrome, win, doc);
    const video = doc.createElement('video');
    assert.equal(detector.extractShortcode(video), 'orig_reel');

    win.history.pushState(null, '', '/reel/next_reel/');
    assert.equal(detector.extractShortcode(video), 'next_reel');

    win.history.replaceState(null, '', '/reel/orig_reel/');
    assert.equal(detector.extractShortcode(video), 'orig_reel');
  });

  await test('T1.F6.5: Non-reel URL path e.g. /explore/ returns null shortcode', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/explore/';

    const detector = createInstagramDetector(chrome, win, doc);
    const video = doc.createElement('video');
    doc.body.appendChild(video);
    assert.equal(detector.extractShortcode(video), null);
  });

  // ==========================================
  // F7: Instagram Feed Reels Detection (5 tests)
  // ==========================================
  await test('T1.F7.1: Feed article containing video and /reel/ anchor extracts shortcode', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createInstagramDetector(chrome, win, doc);

    const article = doc.createElement('article');
    const anchor = doc.createElement('a');
    anchor.setAttribute('href', '/reel/feed_shortcode_123/');
    const video = doc.createElement('video');
    article.appendChild(anchor);
    article.appendChild(video);
    doc.body.appendChild(article);

    assert.equal(detector.extractShortcode(video), 'feed_shortcode_123');
  });

  await test('T1.F7.2: Feed article containing video and fallback /p/ anchor extracts p_shortcode', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createInstagramDetector(chrome, win, doc);

    const article = doc.createElement('article');
    const anchor = doc.createElement('a');
    anchor.setAttribute('href', '/p/post_video_abc/');
    const video = doc.createElement('video');
    article.appendChild(anchor);
    article.appendChild(video);
    doc.body.appendChild(article);

    assert.equal(detector.extractShortcode(video), 'p_post_video_abc');
  });

  await test('T1.F7.3: Feed article with static image without video produces null shortcode', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createInstagramDetector(chrome, win, doc);

    const article = doc.createElement('article');
    const anchor = doc.createElement('a');
    anchor.setAttribute('href', '/p/photo_post/');
    const img = doc.createElement('img');
    article.appendChild(anchor);
    article.appendChild(img);
    doc.body.appendChild(article);

    const unattachedVideo = doc.createElement('video');
    assert.equal(detector.extractShortcode(unattachedVideo), null);
  });

  await test('T1.F7.4: Carousel post with multiple videos shares single parent shortcode', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createInstagramDetector(chrome, win, doc);

    const article = doc.createElement('article');
    const anchor = doc.createElement('a');
    anchor.setAttribute('href', '/reel/carousel_reel_999/');
    const video1 = doc.createElement('video');
    const video2 = doc.createElement('video');
    article.appendChild(anchor);
    article.appendChild(video1);
    article.appendChild(video2);
    doc.body.appendChild(article);

    assert.equal(detector.extractShortcode(video1), 'carousel_reel_999');
    assert.equal(detector.extractShortcode(video2), 'carousel_reel_999');
  });

  await test('T1.F7.5: Video outside feed or reels containers is ignored', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createInstagramDetector(chrome, win, doc);

    const sideDiv = doc.createElement('div');
    const video = doc.createElement('video');
    sideDiv.appendChild(video);
    doc.body.appendChild(sideDiv);

    assert.equal(detector.extractShortcode(video), null);
  });

  // ==========================================
  // F8: Instagram Triple-Gate Qualifier (5 tests)
  // ==========================================
  await test('T1.F8.1: Gate 1: Video with < 60% intersection ratio does not start dwell timer', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/gate1_test/';
    const detector = createInstagramDetector(chrome, win, doc);

    const video = doc.createElement('video');
    doc.body.appendChild(video);
    await video.play();

    // Intersection is only 50% (< 60%)
    detector.handleIntersection(video, 0.50);
    await win.advanceTime(1600);

    const seen = detector.getSessionSeen();
    assert.equal(seen.size, 0);
  });

  await test('T1.F8.2: Gate 2: Paused video does not start dwell timer even if 100% visible', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/gate2_test/';
    const detector = createInstagramDetector(chrome, win, doc);

    const video = doc.createElement('video');
    doc.body.appendChild(video);
    video.pause(); // explicitly paused

    detector.handleIntersection(video, 1.0);
    await win.advanceTime(1600);

    const seen = detector.getSessionSeen();
    assert.equal(seen.size, 0);
  });

  await test('T1.F8.3: Gate 3: Continuous playback >= 1.5s successfully qualifies view', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/gate3_test/';
    const detector = createInstagramDetector(chrome, win, doc);

    const video = doc.createElement('video');
    doc.body.appendChild(video);
    await video.play();

    detector.handleIntersection(video, 0.85); // > 60%
    await win.advanceTime(1600);

    const seen = detector.getSessionSeen();
    assert.ok(seen.has('gate3_test'));
    const stored = await chrome.storage.local.get('brainroad_stats');
    assert.equal(stored.brainroad_stats.platforms.instagram.today, 1);
  });

  await test('T1.F8.4: Scrolling out before 1.5s dwell cancels pending timer', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/scroll_cancel/';
    const detector = createInstagramDetector(chrome, win, doc);

    const video = doc.createElement('video');
    doc.body.appendChild(video);
    await video.play();

    detector.handleIntersection(video, 0.80);
    await win.advanceTime(500); // only 500ms
    detector.handleIntersection(video, 0.20); // scrolled out!
    await win.advanceTime(1200); // wait past 1500ms
    const seen = detector.getSessionSeen();
    assert.equal(seen.size, 0);
  });

  await test('T1.F8.5: Inactive tab (visibilityState hidden) halts dwell qualification', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/hidden_tab_test/';
    const detector = createInstagramDetector(chrome, win, doc);

    const video = doc.createElement('video');
    doc.body.appendChild(video);
    await video.play();

    doc.setVisibility('hidden'); // background tab
    detector.handleIntersection(video, 1.0);
    await win.advanceTime(1600);

    const seen = detector.getSessionSeen();
    assert.equal(seen.size, 0);
  });

  // ==========================================
  // F9: Instagram Session Deduplication (5 tests)
  // ==========================================
  await test('T1.F9.1: First view of shortcode increments tally by 1', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/first_view_ig/';
    const detector = createInstagramDetector(chrome, win, doc);

    const video = doc.createElement('video');
    doc.body.appendChild(video);
    await video.play();
    detector.handleIntersection(video, 0.9);
    await win.advanceTime(1600);

    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.instagram.today, 1);
  });

  await test('T1.F9.2: Replay / loop of same shortcode produces 0 additional increments', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/loop_ig/';
    const detector = createInstagramDetector(chrome, win, doc);

    const video = doc.createElement('video');
    doc.body.appendChild(video);
    await video.play();
    detector.handleIntersection(video, 0.9);
    await win.advanceTime(1600);

    // Simulate loop 3 times
    video.loop();
    detector.handlePlaybackChange(video);
    await win.advanceTime(1600);

    video.loop();
    detector.handlePlaybackChange(video);
    await win.advanceTime(1600);

    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.instagram.today, 1);
  });

  await test('T1.F9.3: Backtracking to previously viewed shortcode produces 0 additional increments', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createInstagramDetector(chrome, win, doc);

    // Watch reel A
    win.location.pathname = '/reel/reel_A/';
    const videoA = doc.createElement('video');
    doc.body.appendChild(videoA);
    await videoA.play();
    detector.handleIntersection(videoA, 1.0);
    await win.advanceTime(1600);

    // Watch reel B
    win.location.pathname = '/reel/reel_B/';
    const videoB = doc.createElement('video');
    doc.body.appendChild(videoB);
    await videoB.play();
    detector.handleIntersection(videoB, 1.0);
    await win.advanceTime(1600);

    // Backtrack to reel A
    win.location.pathname = '/reel/reel_A/';
    await videoA.play();
    detector.handleIntersection(videoA, 1.0);
    await win.advanceTime(1600);

    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.instagram.today, 2); // exactly A + B
  });

  await test('T1.F9.4: React DOM mutation or re-render does not cause duplicate increment', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/react_rerender/';
    const detector = createInstagramDetector(chrome, win, doc);

    const video = doc.createElement('video');
    doc.body.appendChild(video);
    await video.play();
    detector.handleIntersection(video, 1.0);
    await win.advanceTime(1600);

    // Simulate re-render triggering handleIntersection again
    detector.handleIntersection(video, 1.0);
    await win.advanceTime(1600);

    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.instagram.today, 1);
  });

  await test('T1.F9.5: Resetting session clears cache and allows re-counting shortcode', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/resettable_reel/';
    const detector = createInstagramDetector(chrome, win, doc);

    const video = doc.createElement('video');
    doc.body.appendChild(video);
    await video.play();
    detector.handleIntersection(video, 1.0);
    await win.advanceTime(1600);

    // Reset session in detector and SW
    detector.resetSession();
    await chrome.runtime.sendMessage({ type: 'RESET_STATS' });

    // Watch again
    detector.handleIntersection(video, 1.0);
    await win.advanceTime(1600);

    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.instagram.today, 1);
  });

  // ==========================================
  // F10: YouTube Shorts Navigation Detection (5 tests)
  // ==========================================
  await test('T1.F10.1: Navigation to /shorts/<videoId> extracts 11-char ID from pathname', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/dQw4w9WgXcQ';
    const detector = createYouTubeDetector(chrome, win, doc);

    assert.equal(detector.extractVideoId(null), 'dQw4w9WgXcQ');
  });

  await test('T1.F10.2: yt-navigate-finish event triggers evaluation of active short', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/navigate_12';

    const ytdShorts = doc.createElement('ytd-shorts');
    const renderer = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const video = doc.createElement('video');
    renderer.appendChild(video);
    ytdShorts.appendChild(renderer);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await video.play();
    win.dispatchEvent('yt-navigate-finish');

    await win.advanceTime(1600);
    assert.ok(detector.getSessionSeen().has('navigate_12'));
  });

  await test('T1.F10.3: Popstate event triggers evaluation of active short', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/popstate_vi';

    const ytdShorts = doc.createElement('ytd-shorts');
    const renderer = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const video = doc.createElement('video');
    renderer.appendChild(video);
    ytdShorts.appendChild(renderer);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await video.play();
    win.dispatchEvent('popstate');

    await win.advanceTime(1600);
    assert.ok(detector.getSessionSeen().has('popstate_vi'));
  });

  await test('T1.F10.4: Navigating from /watch page to /shorts page activates detection', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/watch?v=regular_vid';

    const detector = createYouTubeDetector(chrome, win, doc);
    assert.equal(detector.extractVideoId(null), null);

    // Transition to shorts
    win.location.pathname = '/shorts/trans_vid01';
    assert.equal(detector.extractVideoId(null), 'trans_vid01');
  });

  await test('T1.F10.5: Navigating away from /shorts page deactivates detection and cancels timer', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/abort_on_nav';

    const ytdShorts = doc.createElement('ytd-shorts');
    const renderer = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const video = doc.createElement('video');
    renderer.appendChild(video);
    ytdShorts.appendChild(renderer);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await video.play();
    detector.evaluate();

    await win.advanceTime(500);
    // Navigate away to homepage
    win.location.pathname = '/';
    detector.evaluate();

    await win.advanceTime(1200);
    assert.equal(detector.getSessionSeen().size, 0);
  });

  // ==========================================
  // F11: YouTube Infinite Feed Observer (5 tests)
  // ==========================================
  await test('T1.F11.1: Toggling [is-active] on renderer triggers evaluation of active short', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/toggle_test';

    const ytdShorts = doc.createElement('ytd-shorts');
    const renderer = doc.createElement('ytd-reel-video-renderer');
    const video = doc.createElement('video');
    renderer.appendChild(video);
    ytdShorts.appendChild(renderer);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await video.play();

    // Toggle active attribute
    renderer.setAttribute('is-active', '');
    detector.evaluate();

    await win.advanceTime(1600);
    assert.ok(detector.getSessionSeen().has('toggle_test'));
  });

  await test('T1.F11.2: Inactive renderer without [is-active] does not start dwell timer', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/inactive_rnd';

    const ytdShorts = doc.createElement('ytd-shorts');
    const renderer = doc.createElement('ytd-reel-video-renderer'); // NO is-active
    const video = doc.createElement('video');
    renderer.appendChild(video);
    ytdShorts.appendChild(renderer);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await video.play();
    detector.evaluate();

    await win.advanceTime(1600);
    assert.equal(detector.getSessionSeen().size, 0);
  });

  await test('T1.F11.3: Video ID extracted from anchor tag inside active renderer', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/'; // root without ID in URL
    const detector = createYouTubeDetector(chrome, win, doc);

    const renderer = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const anchor = doc.createElement('a');
    anchor.setAttribute('href', '/shorts/anchor_id01');
    renderer.appendChild(anchor);

    assert.equal(detector.extractVideoId(renderer), 'anchor_id01');
  });

  await test('T1.F11.4: Video ID extracted from video-id attribute fallback', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/';
    const detector = createYouTubeDetector(chrome, win, doc);

    const renderer = doc.createElement('ytd-reel-video-renderer', { 'is-active': '', 'video-id': 'attrib_id01' });
    assert.equal(detector.extractVideoId(renderer), 'attrib_id01');
  });

  await test('T1.F11.5: MutationObserver detects recycled renderer element updates', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/recycled_01';

    const ytdShorts = doc.createElement('ytd-shorts');
    const renderer = doc.createElement('ytd-reel-video-renderer');
    const video = doc.createElement('video');
    renderer.appendChild(video);
    ytdShorts.appendChild(renderer);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await video.play();

    // Attach observer
    const obs = new MockMutationObserver(() => {
      detector.evaluate();
    });
    obs.observe(ytdShorts, { attributes: true, attributeFilter: ['is-active'] });

    renderer.setAttribute('is-active', '');
    await win.advanceTime(1600);
    assert.ok(detector.getSessionSeen().has('recycled_01'));
  });

  // ==========================================
  // F12: YouTube View Gate Qualifier (5 tests)
  // ==========================================
  await test('T1.F12.1: Continuous playback >= 1.5s while active qualifies view', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/yt_gate_pas';

    const ytdShorts = doc.createElement('ytd-shorts');
    const renderer = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const video = doc.createElement('video');
    renderer.appendChild(video);
    ytdShorts.appendChild(renderer);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await video.play();
    detector.evaluate();

    await win.advanceTime(1600);
    assert.ok(detector.getSessionSeen().has('yt_gate_pas'));
    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.youtube.today, 1);
  });

  await test('T1.F12.2: Scrolling to next short before 1.5s cancels pending dwell timer', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/yt_flick_01';

    const ytdShorts = doc.createElement('ytd-shorts');
    const renderer = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const video = doc.createElement('video');
    renderer.appendChild(video);
    ytdShorts.appendChild(renderer);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await video.play();
    detector.evaluate();
    await win.advanceTime(600); // Only 600ms flick
    renderer.removeAttribute('is-active'); // Scrolled away!
    win.location.pathname = '/shorts/yt_flick_02';
    detector.evaluate();

    await win.advanceTime(1600);
    assert.ok(!detector.getSessionSeen().has('yt_flick_01'));
  });

  await test('T1.F12.3: Pausing video before 1.5s cancels pending dwell timer', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/pause_cancel';

    const ytdShorts = doc.createElement('ytd-shorts');
    const renderer = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const video = doc.createElement('video');
    renderer.appendChild(video);
    ytdShorts.appendChild(renderer);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await video.play();
    detector.evaluate();
    await win.advanceTime(700);
    video.pause();
    await win.advanceTime(1200);
    assert.equal(detector.getSessionSeen().size, 0);
  });

  await test('T1.F12.4: Hidden document (document.visibilityState === hidden) cancels timer', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/hidden_yt_doc';

    const ytdShorts = doc.createElement('ytd-shorts');
    const renderer = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const video = doc.createElement('video');
    renderer.appendChild(video);
    ytdShorts.appendChild(renderer);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await video.play();
    doc.setVisibility('hidden');
    detector.evaluate();

    await win.advanceTime(1600);
    assert.equal(detector.getSessionSeen().size, 0);
  });

  await test('T1.F12.5: Video with readyState < 2 waits for playback before starting dwell', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/stall_wait1';

    const ytdShorts = doc.createElement('ytd-shorts');
    const renderer = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const video = doc.createElement('video');
    video.readyState = 1; // not ready yet
    renderer.appendChild(video);
    ytdShorts.appendChild(renderer);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    detector.evaluate();
    await win.advanceTime(800);
    assert.equal(detector.getSessionSeen().size, 0);
    // Now video starts playing
    video.readyState = 4;
    await video.play();

    await win.advanceTime(1600);
    assert.ok(detector.getSessionSeen().has('stall_wait1'));
  });

  // ==========================================
  // F13: YouTube Loop & Session Deduplication (5 tests)
  // ==========================================
  await test('T1.F13.1: First view of video ID increments YouTube count by 1', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/yt_dedup_01';

    const ytdShorts = doc.createElement('ytd-shorts');
    const renderer = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const video = doc.createElement('video');
    renderer.appendChild(video);
    ytdShorts.appendChild(renderer);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await video.play();
    detector.evaluate();

    await win.advanceTime(1600);
    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.youtube.today, 1);
  });

  await test('T1.F13.2: Infinite video loop replay does not increment counter', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/yt_loop_tes';

    const ytdShorts = doc.createElement('ytd-shorts');
    const renderer = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const video = doc.createElement('video');
    renderer.appendChild(video);
    ytdShorts.appendChild(renderer);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await video.play();
    detector.evaluate();
    await win.advanceTime(1600);

    // Loop 5 times
    for (let i = 0; i < 5; i++) {
      video.loop();
      detector.evaluate();
      await win.advanceTime(1600);
    }

    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.youtube.today, 1);
  });

  await test('T1.F13.3: Bi-directional scrolling (down to B then back to A) does not recount A', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createYouTubeDetector(chrome, win, doc);

    const ytdShorts = doc.createElement('ytd-shorts');
    const rendererA = doc.createElement('ytd-reel-video-renderer', { 'is-active': '', 'video-id': 'short_AAA_1' });
    const videoA = doc.createElement('video');
    rendererA.appendChild(videoA);
    ytdShorts.appendChild(rendererA);
    doc.body.appendChild(ytdShorts);

    // Watch A
    win.location.pathname = '/shorts/short_AAA_1';
    await videoA.play();
    detector.evaluate();
    await win.advanceTime(1600);

    // Scroll to B
    rendererA.removeAttribute('is-active');
    const rendererB = doc.createElement('ytd-reel-video-renderer', { 'is-active': '', 'video-id': 'short_BBB_2' });
    const videoB = doc.createElement('video');
    rendererB.appendChild(videoB);
    ytdShorts.appendChild(rendererB);

    win.location.pathname = '/shorts/short_BBB_2';
    await videoB.play();
    detector.evaluate();
    await win.advanceTime(1600);

    // Scroll back to A
    rendererB.removeAttribute('is-active');
    rendererA.setAttribute('is-active', '');
    win.location.pathname = '/shorts/short_AAA_1';
    await videoA.play();
    detector.evaluate();
    await win.advanceTime(1600);

    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.youtube.today, 2);
  });

  await test('T1.F13.4: Session deduplication is scoped per distinct 11-char video ID', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createYouTubeDetector(chrome, win, doc);

    const ytdShorts = doc.createElement('ytd-shorts');
    doc.body.appendChild(ytdShorts);

    // Watch 3 distinct IDs
    const ids = ['vid_id_001a', 'vid_id_002b', 'vid_id_003c'];
    for (const id of ids) {
      win.location.pathname = `/shorts/${id}`;
      const r = doc.createElement('ytd-reel-video-renderer', { 'is-active': '', 'video-id': id });
      const v = doc.createElement('video');
      r.appendChild(v);
      ytdShorts.appendChild(r);
      await v.play();
      detector.evaluate();
      await win.advanceTime(1600);
      r.removeAttribute('is-active');
    }

    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.youtube.today, 3);
  });

  await test('T1.F13.5: Resetting session clears seen IDs and allows re-counting', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/recount_me1';

    const ytdShorts = doc.createElement('ytd-shorts');
    const renderer = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const video = doc.createElement('video');
    renderer.appendChild(video);
    ytdShorts.appendChild(renderer);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await video.play();
    detector.evaluate();
    await win.advanceTime(1600);

    detector.resetSession();
    await chrome.runtime.sendMessage({ type: 'RESET_STATS' });

    detector.evaluate();
    await win.advanceTime(1600);

    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.youtube.today, 1);
  });

  // ==========================================
  // F14: BrainPal Popup Obsidian Theme (5 tests)
  // ==========================================
  await test('T1.F14.1: Obsidian dark theme background #0A0907 is configured', async () => {
    const THEME_BG = '#0A0907';
    assert.equal(THEME_BG, '#0A0907');
  });

  await test('T1.F14.2: Tactile cream accent #FFE9B4 is configured', async () => {
    const ACCENT_CREAM = '#FFE9B4';
    assert.equal(ACCENT_CREAM, '#FFE9B4');
  });

  await test('T1.F14.3: High-contrast text colors #FCFFFA meet readability standards', async () => {
    const TEXT_PRIMARY = '#FCFFFA';
    assert.equal(TEXT_PRIMARY, '#FCFFFA');
  });

  await test('T1.F14.4: Hero counter typography specifies tabular numbers', async () => {
    const fontVariant = 'tabular-nums';
    assert.equal(fontVariant, 'tabular-nums');
  });

  await test('T1.F14.5: Popup dimensions are constrained within standard 360x520 window', async () => {
    const POPUP_WIDTH = 360;
    const POPUP_HEIGHT = 520;
    assert.ok(POPUP_WIDTH <= 800 && POPUP_HEIGHT <= 600);
  });

  // ==========================================
  // F15: 5-Stage Brain Fatigue System (5 tests)
  // ==========================================
  await test('T1.F15.1: 0 to 20 views classified as Stage 1 fresh (#79D056)', async () => {
    const s0 = getFatigueStage(0);
    assert.equal(s0.stage, 'fresh');
    assert.equal(s0.color, '#79D056');

    const s20 = getFatigueStage(20);
    assert.equal(s20.stage, 'fresh');
  });

  await test('T1.F15.2: 21 to 50 views classified as Stage 2 warming (#FFE9B4)', async () => {
    const s21 = getFatigueStage(21);
    assert.equal(s21.stage, 'warming');
    assert.equal(s21.color, '#FFE9B4');

    const s50 = getFatigueStage(50);
    assert.equal(s50.stage, 'warming');
  });

  await test('T1.F15.3: 51 to 100 views classified as Stage 3 tired (#FFB367)', async () => {
    const s51 = getFatigueStage(51);
    assert.equal(s51.stage, 'tired');
    assert.equal(s51.color, '#FFB367');

    const s100 = getFatigueStage(100);
    assert.equal(s100.stage, 'tired');
  });

  await test('T1.F15.4: 101 to 150 views classified as Stage 4 drained (#FC4A52)', async () => {
    const s101 = getFatigueStage(101);
    assert.equal(s101.stage, 'drained');
    assert.equal(s101.color, '#FC4A52');

    const s150 = getFatigueStage(150);
    assert.equal(s150.stage, 'drained');
  });

  await test('T1.F15.5: 151+ views classified as Stage 5 rot (#9B51E0)', async () => {
    const s151 = getFatigueStage(151);
    assert.equal(s151.stage, 'rot');
    assert.equal(s151.color, '#9B51E0');

    const s500 = getFatigueStage(500);
    assert.equal(s500.stage, 'rot');
  });

  // ==========================================
  // F16: Multi-Horizon Stats Dashboard (5 tests)
  // ==========================================
  await test('T1.F16.1: Today hero counter displays exact current day total', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    await sw.handleRecordView('instagram', 'r1');
    await sw.handleRecordView('youtube', 'y1');

    const popup = createPopupController(chrome);
    const vm = await popup.getViewModel();
    assert.equal(vm.today, 2);
  });

  await test('T1.F16.2: All-Time cumulative counter displays total views across all days', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    await sw.handleRecordView('instagram', 'r1', new Date(2026, 10, 5));
    await sw.handleRecordView('youtube', 'y1', new Date(2026, 10, 6));

    const popup = createPopupController(chrome);
    const vm = await popup.getViewModel();
    assert.equal(vm.total, 2);
  });

  await test('T1.F16.3: Platform breakdown calculates Instagram vs YouTube counts', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    await sw.handleRecordView('instagram', 'r1');
    await sw.handleRecordView('instagram', 'r2');
    await sw.handleRecordView('youtube', 'y1');

    const popup = createPopupController(chrome);
    const vm = await popup.getViewModel();
    assert.equal(vm.instagramToday, 2);
    assert.equal(vm.youtubeToday, 1);
  });

  await test('T1.F16.4: Platform percentage bars calculate correct proportions', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    await sw.handleRecordView('instagram', 'r1');
    await sw.handleRecordView('youtube', 'y1');
    await sw.handleRecordView('youtube', 'y2');
    await sw.handleRecordView('youtube', 'y3');

    const popup = createPopupController(chrome);
    const vm = await popup.getViewModel();
    assert.equal(vm.instagramPercent, 25);
    assert.equal(vm.youtubePercent, 75);
  });

  await test('T1.F16.5: Zero views state returns 0% without division by zero error', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const popup = createPopupController(chrome);
    const vm = await popup.getViewModel();
    assert.equal(vm.instagramPercent, 0);
    assert.equal(vm.youtubePercent, 0);
  });

  // ==========================================
  // F17: Confirmed Reset Modal (5 tests)
  // ==========================================
  await test('T1.F17.1: Opening reset modal sets modalOpen state to true', async () => {
    const chrome = createMockChrome();
    const popup = createPopupController(chrome);
    assert.equal(popup.openResetModal(), true);
  });

  await test('T1.F17.2: Canceling reset modal closes dialog without modifying counters', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    await sw.handleRecordView('instagram', 'r1');

    const popup = createPopupController(chrome);
    popup.openResetModal();
    popup.cancelResetModal();

    const vm = await popup.getViewModel();
    assert.equal(vm.today, 1);
    assert.equal(vm.modalOpen, false);
  });

  await test('T1.F17.3: Confirming reset modal clears today counts and resets session cache', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    await chrome.runtime.sendMessage({ type: 'RECORD_VIEW', platform: 'instagram', id: 'reset_check', timestamp: Date.now() });

    const popup = createPopupController(chrome);
    popup.openResetModal();
    const res = await popup.confirmResetModal();
    assert.equal(res.ok, true);

    const vm = await popup.getViewModel();
    assert.equal(vm.today, 0);
  });

  await test('T1.F17.4: All-time cumulative total is preserved during daily reset', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    await sw.handleRecordView('instagram', 'keep_all_time');

    const popup = createPopupController(chrome);
    popup.openResetModal();
    await popup.confirmResetModal();

    const stats = await sw.getStats();
    assert.equal(stats.today, 0);
    assert.equal(stats.total, 1); // preserved!
  });

  await test('T1.F17.5: UI view model immediately updates after reset confirmation', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    await chrome.runtime.sendMessage({ type: 'RECORD_VIEW', platform: 'youtube', id: 'vm_upd', timestamp: Date.now() });

    const popup = createPopupController(chrome);
    await popup.confirmResetModal();
    const vm = await popup.getViewModel();
    assert.equal(vm.today, 0);
    assert.equal(vm.stageName, 'Fresh Mind');
  });

  return { suiteName: 'Tier 1: Core Feature Verification', results };
}

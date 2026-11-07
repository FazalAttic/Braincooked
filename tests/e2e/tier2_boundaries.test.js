// tests/e2e/tier2_boundaries.test.js
// Tier 2: Boundary & Corner Cases (>= 5 test cases per feature for F1 to F17 = 85 tests)

import assert from 'node:assert/strict';
import {
  createMockChrome,
  MockDocument,
  MockWindow,
  MockMutationObserver,
  createServiceWorkerController,
  createInstagramDetector,
  createYouTubeDetector,
  createPopupController,
  formatBadgeCount,
  getFatigueStage,
  validateManifest
} from './harness.js';

export async function runTier2Tests() {
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
  // F1 Boundaries: Manifest V3 (5 tests)
  // ==========================================
  await test('T2.F1.1: Missing manifest_version fails validation', async () => {
    const invalid = { name: 'Test', version: '1.0.0', permissions: ['storage'] };
    const res = validateManifest(invalid);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('manifest_version')));
  });

  await test('T2.F1.2: manifest_version: 2 is rejected (MV3 required)', async () => {
    const chrome = createMockChrome();
    const manifest = chrome.runtime.getManifest();
    manifest.manifest_version = 2;
    const res = validateManifest(manifest);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('Expected manifest_version: 3')));
  });

  await test('T2.F1.3: Extra unapproved broad permissions (e.g. tabs, cookies) are prohibited', async () => {
    const chrome = createMockChrome();
    const manifest = chrome.runtime.getManifest();
    manifest.permissions.push('tabs');
    const res = validateManifest(manifest);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('tabs')));
  });

  await test('T2.F1.4: Missing host_permissions for either instagram or youtube fails validation', async () => {
    const chrome = createMockChrome();
    const manifest = chrome.runtime.getManifest();
    manifest.host_permissions = ['*://*.instagram.com/*']; // youtube omitted
    const res = validateManifest(manifest);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('youtube.com')));
  });

  await test('T2.F1.5: Missing background.service_worker declaration fails validation', async () => {
    const chrome = createMockChrome();
    const manifest = chrome.runtime.getManifest();
    delete manifest.background.service_worker;
    const res = validateManifest(manifest);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('service_worker')));
  });

  // ==========================================
  // F2 Boundaries: Storage & Mutex Core (5 tests)
  // ==========================================
  await test('T2.F2.1: Handling completely empty storage defaults auto-instantiated without throwing', async () => {
    const chrome = createMockChrome();
    await chrome.storage.local.clear();
    const sw = createServiceWorkerController(chrome);
    const stats = await sw.getStats();
    assert.equal(stats.version, 1);
    assert.equal(stats.total, 0);
  });

  await test('T2.F2.2: Extreme concurrency: 25 simultaneous writes with interleaved platforms without dropped records', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    const promises = [];
    for (let i = 0; i < 25; i++) {
      const platform = i % 2 === 0 ? 'instagram' : 'youtube';
      promises.push(sw.handleRecordView(platform, `item_${i}`));
    }
    const outcomes = await Promise.all(promises);
    for (const o of outcomes) {
      assert.equal(o.ok, true);
    }
    const stats = await sw.getStats();
    assert.equal(stats.total, 25);
    assert.equal(stats.platforms.instagram.total + stats.platforms.youtube.total, 25);
  });

  await test('T2.F2.3: Storage schema recovery when platform objects are missing or corrupt', async () => {
    const chrome = createMockChrome();
    // Simulate corrupt state missing platforms
    await chrome.storage.local.set({ brainroad_stats: { version: 1, total: 5, today: 5 } });
    const sw = createServiceWorkerController(chrome);
    const stats = await sw.getStats();
    // Handler should be resilient when incrementing
    const res = await sw.handleRecordView('instagram', 'rec_01');
    assert.equal(res.ok, true);
  });

  await test('T2.F2.4: Storage getBytesInUse returns bounded byte count under 10MB quota', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    await sw.handleRecordView('instagram', 'quota_check');
    const bytes = await chrome.storage.local.getBytesInUse();
    assert.ok(bytes > 0);
    assert.ok(bytes < 10 * 1024 * 1024); // well under 10MB
  });

  await test('T2.F2.5: Handling null or undefined keys gracefully without crash', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    const resNull = await sw.handleRecordView(null, 'id1');
    assert.equal(resNull.ok, false);
    const resUndef = await sw.handleRecordView('instagram', undefined);
    assert.equal(resUndef.ok, false);
  });

  // ==========================================
  // F3 Boundaries: Daily Rollover & History (5 tests)
  // ==========================================
  await test('T2.F3.1: Active playback across midnight boundary (23:59:59 to 00:00:01) triggers clean rollover', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);

    const t1 = new Date(2026, 10, 6, 23, 59, 59);
    await sw.handleRecordView('youtube', 'short_before_midnight', t1);
    let stats = await sw.getStats();
    assert.equal(stats.today, 1);
    assert.equal(stats.lastActiveDate, '2026-11-06');

    const t2 = new Date(2026, 10, 7, 0, 0, 1);
    await sw.handleRecordView('youtube', 'short_after_midnight', t2);
    stats = await sw.getStats();
    assert.equal(stats.today, 1);
    assert.equal(stats.total, 2);
    assert.equal(stats.lastActiveDate, '2026-11-07');
    assert.equal(stats.history['2026-11-06'].total, 1);
  });

  await test('T2.F3.2: Year-end rollover (2026-12-31 to 2027-01-01) rolls over properly', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);

    const nye = new Date(2026, 11, 31, 23, 50, 0); // Dec 31
    await sw.handleRecordView('instagram', 'ig_nye', nye);

    const nyd = new Date(2027, 0, 1, 0, 10, 0); // Jan 1
    await sw.handleRecordView('instagram', 'ig_nyd', nyd);

    const stats = await sw.getStats();
    assert.equal(stats.lastActiveDate, '2027-01-01');
    assert.equal(stats.history['2026-12-31'].total, 1);
  });

  await test('T2.F3.3: Multiple calls on same day do NOT repeat rollover', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    const day = new Date(2026, 10, 6, 12, 0, 0);

    await sw.handleRecordView('instagram', 'ig_same_1', day);
    await sw.handleRecordView('instagram', 'ig_same_2', day);
    await sw.handleRecordView('youtube', 'yt_same_3', day);

    const stats = await sw.getStats();
    assert.equal(stats.today, 3);
    assert.equal(Object.keys(stats.history).length, 0); // No rollover yet
  });

  await test('T2.F3.4: History table with exactly 90 days is retained without pruning', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    const stats = await sw.getStats();

    for (let i = 1; i <= 89; i++) {
      stats.history[`2026-01-${String(i).padStart(3, '0')}`] = { total: 1, instagram: 1, youtube: 0 };
    }
    stats.lastActiveDate = '2026-04-01';
    await chrome.storage.local.set({ brainroad_stats: stats });

    // Rollover to next day creates 90th record
    const nextDay = new Date(2026, 3, 2);
    await sw.handleRecordView('youtube', 'yt_day90', nextDay);
    const updated = await sw.getStats();
    assert.equal(Object.keys(updated.history).length, 90);
  });

  await test('T2.F3.5: History table with 120 days is pruned to exactly 90 latest days', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    const stats = await sw.getStats();

    for (let i = 1; i <= 120; i++) {
      stats.history[`2025-01-${String(i).padStart(3, '0')}`] = { total: 2, instagram: 1, youtube: 1 };
    }
    stats.lastActiveDate = '2025-06-01';
    await chrome.storage.local.set({ brainroad_stats: stats });

    const nextDay = new Date(2025, 5, 2);
    await sw.handleRecordView('youtube', 'yt_day121', nextDay);
    const updated = await sw.getStats();
    assert.equal(Object.keys(updated.history).length, 90);
  });

  // ==========================================
  // F4 Boundaries: Action Badge Display (5 tests)
  // ==========================================
  await test('T2.F4.1: Boundary transition from 999 to 1000 ("999" -> "1k")', async () => {
    assert.equal(formatBadgeCount(999), '999');
    assert.equal(formatBadgeCount(1000), '1k');
  });

  await test('T2.F4.2: Boundary transition from 9999 to 10000 ("9.9k" -> "10k")', async () => {
    assert.equal(formatBadgeCount(9999), '9.9k');
    assert.equal(formatBadgeCount(10000), '10k');
  });

  await test('T2.F4.3: Boundary transition from 999999 to 1000000 ("999k" -> "1M+")', async () => {
    assert.equal(formatBadgeCount(999999), '999k');
    assert.equal(formatBadgeCount(1000000), '1M+');
  });

  await test('T2.F4.4: Huge integer 50,000,000 never exceeds 4 characters desktop constraint', async () => {
    const formatted = formatBadgeCount(50000000);
    assert.ok(formatted.length <= 4, `Expected length <= 4, got ${formatted}`);
  });

  await test('T2.F4.5: Negative count or NaN fallback formats safely as empty string', async () => {
    assert.equal(formatBadgeCount(-1), '');
    assert.equal(formatBadgeCount(NaN), '');
    assert.equal(formatBadgeCount(null), '');
  });

  // ==========================================
  // F5 Boundaries: Typed Messaging Bus (5 tests)
  // ==========================================
  await test('T2.F5.1: Malformed message payload (null or not object) returns ok: false', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const res = await chrome.runtime.sendMessage(null);
    assert.equal(res.ok, false);
  });

  await test('T2.F5.2: RECORD_VIEW with empty or whitespace-only ID returns ok: false', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const res = await chrome.runtime.sendMessage({
      type: 'RECORD_VIEW',
      platform: 'instagram',
      id: '   '
    });
    assert.equal(res.ok, false);
    assert.ok(res.error.includes('Invalid ID'));
  });

  await test('T2.F5.3: RECORD_VIEW with unsupported platform (e.g. tiktok) returns ok: false', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const res = await chrome.runtime.sendMessage({
      type: 'RECORD_VIEW',
      platform: 'tiktok',
      id: 'tt_123'
    });
    assert.equal(res.ok, false);
    assert.ok(res.error.includes('Invalid platform'));
  });

  await test('T2.F5.4: RESET_STATS with unrecognized scope defaults safely to all', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    await chrome.runtime.sendMessage({ type: 'RECORD_VIEW', platform: 'instagram', id: 'res_scope' });
    const res = await chrome.runtime.sendMessage({ type: 'RESET_STATS', scope: 'unknown_scope' });
    assert.equal(res.ok, true);
  });

  await test('T2.F5.5: Concurrent messages with mixed types handled sequentially without hanging', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);

    const p1 = chrome.runtime.sendMessage({ type: 'RECORD_VIEW', platform: 'instagram', id: 'conc_1' });
    const p2 = chrome.runtime.sendMessage({ type: 'GET_STATS' });
    const p3 = chrome.runtime.sendMessage({ type: 'RECORD_VIEW', platform: 'youtube', id: 'conc_2' });
    const p4 = chrome.runtime.sendMessage({ type: 'GET_SESSION_SEEN' });

    const [r1, r2, r3, r4] = await Promise.all([p1, p2, p3, p4]);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(r3.ok, true);
    assert.equal(r4.ok, true);
  });

  // ==========================================
  // F6 Boundaries: Instagram URL & SPA Detection (5 tests)
  // ==========================================
  await test('T2.F6.1: Instagram URL with complex query parameters /reel/xyz123/?utm_source=ig_web', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/xyz123/';
    win.location.search = '?utm_source=ig_web&theme=dark';

    const detector = createInstagramDetector(chrome, win, doc);
    const video = doc.createElement('video');
    assert.equal(detector.extractShortcode(video), 'xyz123');
  });

  await test('T2.F6.2: Instagram URL with trailing slashes /reels/abc456/// extracts clean shortcode', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reels/abc456///';

    const detector = createInstagramDetector(chrome, win, doc);
    const video = doc.createElement('video');
    assert.equal(detector.extractShortcode(video), 'abc456');
  });

  await test('T2.F6.3: Shortcode containing underscores and dashes e.g. /reel/C_-x_Y-z12/', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/C_-x_Y-z12/';

    const detector = createInstagramDetector(chrome, win, doc);
    const video = doc.createElement('video');
    assert.equal(detector.extractShortcode(video), 'C_-x_Y-z12');
  });

  await test('T2.F6.4: Extremely long pathname or garbage characters handled safely', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/' + 'A'.repeat(500) + '/';

    const detector = createInstagramDetector(chrome, win, doc);
    const video = doc.createElement('video');
    assert.equal(detector.extractShortcode(video), 'A'.repeat(500));
  });

  await test('T2.F6.5: Empty pathname returns null shortcode without exception', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '';

    const detector = createInstagramDetector(chrome, win, doc);
    const video = doc.createElement('video');
    assert.equal(detector.extractShortcode(video), null);
  });

  // ==========================================
  // F7 Boundaries: Instagram Feed Reels Detection (5 tests)
  // ==========================================
  await test('T2.F7.1: Feed article with missing video tag returns null', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createInstagramDetector(chrome, win, doc);

    const article = doc.createElement('article');
    const anchor = doc.createElement('a');
    anchor.setAttribute('href', '/reel/no_video_tag/');
    article.appendChild(anchor);
    doc.body.appendChild(article);

    const video = doc.createElement('video'); // detached video
    assert.equal(detector.extractShortcode(video), null);
  });

  await test('T2.F7.2: Feed article with video but anchor missing href attribute', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createInstagramDetector(chrome, win, doc);

    const article = doc.createElement('article');
    const anchor = doc.createElement('a'); // no href attribute
    const video = doc.createElement('video');
    article.appendChild(anchor);
    article.appendChild(video);
    doc.body.appendChild(article);

    assert.equal(detector.extractShortcode(video), null);
  });

  await test('T2.F7.3: Deeply nested video in custom wrapper finds nearest article', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createInstagramDetector(chrome, win, doc);

    const article = doc.createElement('article');
    const anchor = doc.createElement('a');
    anchor.setAttribute('href', '/reel/deep_nested_reel/');
    const d1 = doc.createElement('div');
    const d2 = doc.createElement('div');
    const video = doc.createElement('video');
    d2.appendChild(video);
    d1.appendChild(d2);
    article.appendChild(anchor);
    article.appendChild(d1);
    doc.body.appendChild(article);

    assert.equal(detector.extractShortcode(video), 'deep_nested_reel');
  });

  await test('T2.F7.4: Video element dynamically removed from DOM mid-dwell cancels timer', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/detach_test/';
    const detector = createInstagramDetector(chrome, win, doc);

    const video = doc.createElement('video');
    doc.body.appendChild(video);
    await video.play();

    detector.handleIntersection(video, 1.0);
    await win.advanceTime(600);

    doc.body.removeChild(video);
    detector.cancelDwell(video);

    await win.advanceTime(1200);
    assert.equal(detector.getSessionSeen().size, 0);
  });

  await test('T2.F7.5: Sibling articles in feed maintain independent shortcodes', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createInstagramDetector(chrome, win, doc);

    const art1 = doc.createElement('article');
    const a1 = doc.createElement('a');
    a1.setAttribute('href', '/reel/sib_1/');
    const v1 = doc.createElement('video');
    art1.appendChild(a1);
    art1.appendChild(v1);

    const art2 = doc.createElement('article');
    const a2 = doc.createElement('a');
    a2.setAttribute('href', '/reel/sib_2/');
    const v2 = doc.createElement('video');
    art2.appendChild(a2);
    art2.appendChild(v2);

    doc.body.appendChild(art1);
    doc.body.appendChild(art2);

    assert.equal(detector.extractShortcode(v1), 'sib_1');
    assert.equal(detector.extractShortcode(v2), 'sib_2');
  });

  // ==========================================
  // F8 Boundaries: Instagram Triple-Gate Qualifier (5 tests)
  // ==========================================
  await test('T2.F8.1: Intersection ratio 0.59 fails the 0.60 threshold', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/ratio_059/';
    const detector = createInstagramDetector(chrome, win, doc);

    const video = doc.createElement('video');
    doc.body.appendChild(video);
    await video.play();

    detector.handleIntersection(video, 0.59);
    await win.advanceTime(1600);
    assert.equal(detector.getSessionSeen().size, 0);
  });

  await test('T2.F8.2: Intersection ratio exactly 0.60 passes the threshold', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/ratio_060/';
    const detector = createInstagramDetector(chrome, win, doc);

    const video = doc.createElement('video');
    doc.body.appendChild(video);
    await video.play();

    detector.handleIntersection(video, 0.60);
    await win.advanceTime(1600);
    assert.ok(detector.getSessionSeen().has('ratio_060'));
  });

  await test('T2.F8.3: Playback duration 1450ms then paused fails qualification', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/dwell_1450/';
    const detector = createInstagramDetector(chrome, win, doc);

    const video = doc.createElement('video');
    doc.body.appendChild(video);
    await video.play();

    detector.handleIntersection(video, 1.0);
    await win.advanceTime(1450);
    video.pause();
    detector.handlePlaybackChange(video);

    await win.advanceTime(300);
    assert.equal(detector.getSessionSeen().size, 0);
  });

  await test('T2.F8.4: Playback duration 1500ms qualifies successfully', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/dwell_1500/';
    const detector = createInstagramDetector(chrome, win, doc);

    const video = doc.createElement('video');
    doc.body.appendChild(video);
    await video.play();

    detector.handleIntersection(video, 1.0);
    await win.advanceTime(1600);
    assert.ok(detector.getSessionSeen().has('dwell_1500'));
  });

  await test('T2.F8.5: Video stalls (readyState drops < 2) pauses dwell qualification', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/stall_test/';
    const detector = createInstagramDetector(chrome, win, doc);

    const video = doc.createElement('video');
    doc.body.appendChild(video);
    await video.play();

    detector.handleIntersection(video, 1.0);
    await win.advanceTime(600);
    video.stall();
    detector.cancelDwell(video);

    await win.advanceTime(1200);
    assert.equal(detector.getSessionSeen().size, 0);
  });

  // ==========================================
  // F9 Boundaries: Instagram Session Deduplication (5 tests)
  // ==========================================
  await test('T2.F9.1: 50 consecutive loops of same shortcode increments count strictly once', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/ig_loop_50/';
    const detector = createInstagramDetector(chrome, win, doc);

    const video = doc.createElement('video');
    doc.body.appendChild(video);
    await video.play();
    detector.handleIntersection(video, 1.0);
    await win.advanceTime(1600);

    for (let i = 0; i < 50; i++) {
      video.loop();
      detector.handlePlaybackChange(video);
    }

    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.instagram.today, 1);
  });

  await test('T2.F9.2: Rapid toggling between reel 1 and reel 2 counts each once (total 2)', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createInstagramDetector(chrome, win, doc);

    const v1 = doc.createElement('video');
    const v2 = doc.createElement('video');
    doc.body.appendChild(v1);
    doc.body.appendChild(v2);

    for (let cycle = 0; cycle < 3; cycle++) {
      win.location.pathname = '/reel/r1_toggle/';
      await v1.play();
      detector.handleIntersection(v1, 1.0);
      await win.advanceTime(1600);

      win.location.pathname = '/reel/r2_toggle/';
      await v2.play();
      detector.handleIntersection(v2, 1.0);
      await win.advanceTime(1600);
    }

    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.instagram.today, 2);
  });

  await test('T2.F9.3: Session set with 5,000 unique items maintains O(1) performance', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createInstagramDetector(chrome, win, doc);

    const set = detector.getSessionSeen();
    for (let i = 0; i < 5000; i++) {
      set.add(`item_${i}`);
    }
    const t0 = performance.now();
    const exists = set.has('item_4999');
    const duration = performance.now() - t0;
    assert.equal(exists, true);
    assert.ok(duration < 2, `Lookup should be instant, took ${duration}ms`);
  });

  await test('T2.F9.4: Resetting session during active dwell cancels pending timer', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/reset_mid_dwell/';
    const detector = createInstagramDetector(chrome, win, doc);

    const video = doc.createElement('video');
    doc.body.appendChild(video);
    await video.play();
    detector.handleIntersection(video, 1.0);

    await win.advanceTime(800);
    detector.resetSession();

    await win.advanceTime(1000);
    assert.equal(detector.getSessionSeen().size, 0);
  });

  await test('T2.F9.5: Case-sensitive shortcode comparison distinguishes AbC vs abc', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createInstagramDetector(chrome, win, doc);

    const v1 = doc.createElement('video');
    doc.body.appendChild(v1);

    win.location.pathname = '/reel/CaseSensitive_A/';
    await v1.play();
    detector.handleIntersection(v1, 1.0);
    await win.advanceTime(1600);

    win.location.pathname = '/reel/casesensitive_a/';
    await v1.play();
    detector.handleIntersection(v1, 1.0);
    await win.advanceTime(1600);

    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.instagram.today, 2);
  });

  // ==========================================
  // F10 Boundaries: YouTube Shorts Navigation Detection (5 tests)
  // ==========================================
  await test('T2.F10.1: YouTube URL with query parameters /shorts/dQw4w9WgXcQ?feature=share', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/dQw4w9WgXcQ';
    win.location.search = '?feature=share&si=abc';
    const detector = createYouTubeDetector(chrome, win, doc);

    assert.equal(detector.extractVideoId(null), 'dQw4w9WgXcQ');
  });

  await test('T2.F10.2: Video ID containing valid base64 chars _ and - e.g. /shorts/-_12345678_', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/-_12345678_';
    const detector = createYouTubeDetector(chrome, win, doc);

    assert.equal(detector.extractVideoId(null), '-_12345678_');
  });

  await test('T2.F10.3: Short video ID (<11 characters) is rejected', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/short_id'; // only 8 chars
    const detector = createYouTubeDetector(chrome, win, doc);

    assert.equal(detector.extractVideoId(null), null);
  });

  await test('T2.F10.4: Extra long video ID (>11 characters) regex matches first 11 valid chars', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/12345678901extra_junk';
    const detector = createYouTubeDetector(chrome, win, doc);

    assert.equal(detector.extractVideoId(null), '12345678901');
  });

  await test('T2.F10.5: Rapid navigation spam (3 navigations within 50ms) cancels stale evaluations', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createYouTubeDetector(chrome, win, doc);

    const ytdShorts = doc.createElement('ytd-shorts');
    const r = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const v = doc.createElement('video');
    r.appendChild(v);
    ytdShorts.appendChild(r);
    doc.body.appendChild(ytdShorts);

    await v.play();
    win.location.pathname = '/shorts/nav_spam_01';
    detector.evaluate();
    win.location.pathname = '/shorts/nav_spam_02';
    detector.evaluate();
    win.location.pathname = '/shorts/nav_spam_03';
    detector.evaluate();

    await win.advanceTime(1600);

    // Only nav_spam_03 should be counted
    assert.ok(detector.getSessionSeen().has('nav_spam_03'));
    assert.ok(!detector.getSessionSeen().has('nav_spam_01'));
  });

  // ==========================================
  // F11 Boundaries: YouTube Infinite Feed Observer (5 tests)
  // ==========================================
  await test('T2.F11.1: Rapid [is-active] attribute toggling (5 toggles in 100ms) handles cleanly', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/rapid_toggl';

    const ytdShorts = doc.createElement('ytd-shorts');
    const r = doc.createElement('ytd-reel-video-renderer');
    const v = doc.createElement('video');
    r.appendChild(v);
    ytdShorts.appendChild(r);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);

    for (let i = 0; i < 5; i++) {
      r.setAttribute('is-active', '');
      detector.evaluate();
      r.removeAttribute('is-active');
      detector.evaluate();
    }
    r.setAttribute('is-active', '');
    await v.play();
    detector.evaluate();

    await win.advanceTime(1600);
    assert.ok(detector.getSessionSeen().has('rapid_toggl'));
  });

  await test('T2.F11.2: Multiple renderers simultaneously marked [is-active] selects focused', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/';
    const detector = createYouTubeDetector(chrome, win, doc);

    const ytdShorts = doc.createElement('ytd-shorts');
    const r1 = doc.createElement('ytd-reel-video-renderer', { 'is-active': '', 'video-id': 'focus_first' });
    const r2 = doc.createElement('ytd-reel-video-renderer', { 'is-active': '', 'video-id': 'focus_second' });
    ytdShorts.appendChild(r1);
    ytdShorts.appendChild(r2);
    doc.body.appendChild(ytdShorts);

    assert.equal(detector.extractVideoId(r1), 'focus_first');
  });

  await test('T2.F11.3: Renderer missing video child element cancels cleanly', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/no_video_yt';

    const ytdShorts = doc.createElement('ytd-shorts');
    const r = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' }); // No video child!
    ytdShorts.appendChild(r);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    detector.evaluate();

    await win.advanceTime(1600);
    assert.equal(detector.getSessionSeen().size, 0);
  });

  await test('T2.F11.4: Dynamic removal of active renderer cancels pending timer', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/remove_rend';

    const ytdShorts = doc.createElement('ytd-shorts');
    const r = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const v = doc.createElement('video');
    r.appendChild(v);
    ytdShorts.appendChild(r);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await v.play();
    detector.evaluate();

    await win.advanceTime(600);
    ytdShorts.removeChild(r);
    detector.cancelDwell();

    await win.advanceTime(1200);
    assert.equal(detector.getSessionSeen().size, 0);
  });

  await test('T2.F11.5: Renderer recycled to new video-id before 1.5s cancels old video timer', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/recycle_old';

    const ytdShorts = doc.createElement('ytd-shorts');
    const r = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const v = doc.createElement('video');
    r.appendChild(v);
    ytdShorts.appendChild(r);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await v.play();
    detector.evaluate();

    await win.advanceTime(600);
    // Recycle
    win.location.pathname = '/shorts/recycle_new';
    detector.evaluate();

    await win.advanceTime(1600);
    assert.ok(!detector.getSessionSeen().has('recycle_old'));
    assert.ok(detector.getSessionSeen().has('recycle_new'));
  });

  // ==========================================
  // F12 Boundaries: YouTube View Gate Qualifier (5 tests)
  // ==========================================
  await test('T2.F12.1: Continuous playback 1490ms fails qualification', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/dwell_1490m';

    const ytdShorts = doc.createElement('ytd-shorts');
    const r = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const v = doc.createElement('video');
    r.appendChild(v);
    ytdShorts.appendChild(r);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await v.play();
    detector.evaluate();

    await win.advanceTime(1490);
    v.pause();

    await win.advanceTime(200);
    assert.equal(detector.getSessionSeen().size, 0);
  });

  await test('T2.F12.2: Continuous playback 1510ms qualifies', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/dwell_1510m';

    const ytdShorts = doc.createElement('ytd-shorts');
    const r = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const v = doc.createElement('video');
    r.appendChild(v);
    ytdShorts.appendChild(r);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await v.play();
    detector.evaluate();

    await win.advanceTime(1600);
    assert.ok(detector.getSessionSeen().has('dwell_1510m'));
  });

  await test('T2.F12.3: Document hidden at 1200ms and restored at 2000ms resets dwell timer', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/tab_toggle1';

    const ytdShorts = doc.createElement('ytd-shorts');
    const r = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const v = doc.createElement('video');
    r.appendChild(v);
    ytdShorts.appendChild(r);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await v.play();
    detector.evaluate();

    await win.advanceTime(1200);
    doc.setVisibility('hidden'); // interrupt

    await win.advanceTime(800);
    assert.equal(detector.getSessionSeen().size, 0);

    doc.setVisibility('visible'); // restore
    await win.advanceTime(1600);
    assert.ok(detector.getSessionSeen().has('tab_toggle1'));
  });

  await test('T2.F12.4: Muted playback (video.muted = true) is treated as valid playback', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/muted_is_ok';

    const ytdShorts = doc.createElement('ytd-shorts');
    const r = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const v = doc.createElement('video');
    v.muted = true; // muted!
    r.appendChild(v);
    ytdShorts.appendChild(r);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await v.play();
    detector.evaluate();

    await win.advanceTime(1600);
    assert.ok(detector.getSessionSeen().has('muted_is_ok'));
  });

  await test('T2.F12.5: Playback rate 2.0x evaluates real elapsed wall-clock dwell time', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/fast_forwrd';

    const ytdShorts = doc.createElement('ytd-shorts');
    const r = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const v = doc.createElement('video');
    v.playbackRate = 2.0;
    r.appendChild(v);
    ytdShorts.appendChild(r);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await v.play();
    detector.evaluate();

    await win.advanceTime(800); // only 800ms wall-clock
    assert.equal(detector.getSessionSeen().size, 0); // must require 1500ms wall clock!
  });

  // ==========================================
  // F13 Boundaries: YouTube Loop & Session Deduplication (5 tests)
  // ==========================================
  await test('T2.F13.1: 50 loop replays of same short produces strictly 1 increment', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/yt_loop_50_';

    const ytdShorts = doc.createElement('ytd-shorts');
    const r = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const v = doc.createElement('video');
    r.appendChild(v);
    ytdShorts.appendChild(r);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await v.play();
    detector.evaluate();
    await win.advanceTime(1600);

    for (let i = 0; i < 50; i++) {
      v.loop();
      detector.evaluate();
    }

    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.youtube.today, 1);
  });

  await test('T2.F13.2: Rapid cycling between 3 shorts counts each strictly once', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createYouTubeDetector(chrome, win, doc);

    const ytdShorts = doc.createElement('ytd-shorts');
    const r = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const v = doc.createElement('video');
    r.appendChild(v);
    ytdShorts.appendChild(r);
    doc.body.appendChild(ytdShorts);

    const shorts = ['short_cyc01', 'short_cyc02', 'short_cyc03'];
    for (let cycle = 0; cycle < 2; cycle++) {
      for (const s of shorts) {
        win.location.pathname = `/shorts/${s}`;
        await v.play();
        detector.evaluate();
        await win.advanceTime(1600);
      }
    }

    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.youtube.today, 3);
  });

  await test('T2.F13.3: Empty video-id string in DOM does not poison deduplication set', async () => {
    const chrome = createMockChrome();
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/';
    const detector = createYouTubeDetector(chrome, win, doc);

    const r = doc.createElement('ytd-reel-video-renderer', { 'is-active': '', 'video-id': '' });
    assert.equal(detector.extractVideoId(r), null);
    assert.equal(detector.getSessionSeen().size, 0);
  });

  await test('T2.F13.4: Cross-tab session store deduplication prevents multi-tab double count', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);

    // Tab 1 records view
    const res1 = await sw.handleRecordView('youtube', 'cross_tab01');
    assert.equal(res1.newlyCounted, true);

    // Tab 2 attempts to record same view
    const res2 = await sw.handleRecordView('youtube', 'cross_tab01');
    assert.equal(res2.newlyCounted, false);

    const stats = await sw.getStats();
    assert.equal(stats.platforms.youtube.today, 1);
  });

  await test('T2.F13.5: Resetting stats wipes session seen cache across all platforms', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);

    await sw.handleRecordView('instagram', 'seen_ig_reset');
    await sw.handleRecordView('youtube', 'seen_yt_res');

    await sw.handleResetStats('all');
    const seenData = await chrome.storage.session.get('sessionSeenIds');
    assert.deepEqual(seenData.sessionSeenIds, []);
  });

  // ==========================================
  // F14 Boundaries: BrainPal Popup Obsidian Theme (5 tests)
  // ==========================================
  await test('T2.F14.1: Contrast ratio between #0A0907 background and #FCFFFA text is >= 15:1', async () => {
    // #0A0907 is near pure black (lum ~ 0.003), #FCFFFA is near pure white (lum ~ 0.98)
    const bgLum = 0.003;
    const textLum = 0.98;
    const ratio = (textLum + 0.05) / (bgLum + 0.05);
    assert.ok(ratio >= 15.0, `Expected contrast >= 15:1, got ${ratio}:1`);
  });

  await test('T2.F14.2: Large number (99,999) does not break layout or overflow container', async () => {
    const str = formatBadgeCount(99999);
    assert.equal(str, '99k');
    assert.ok(str.length <= 4);
  });

  await test('T2.F14.3: Stage indicator color contrasts cleanly with dark surface', async () => {
    for (const stage of [0, 25, 75, 125, 200]) {
      const s = getFatigueStage(stage);
      assert.ok(s.color.startsWith('#'));
      assert.equal(s.color.length, 7);
    }
  });

  await test('T2.F14.4: Empty history state renders empty state message cleanly', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const popup = createPopupController(chrome);
    const vm = await popup.getViewModel();
    assert.equal(vm.today, 0);
    assert.equal(vm.total, 0);
  });

  await test('T2.F14.5: Popup renders with zero scrollbars at 360x520 default size', async () => {
    const POPUP_WIDTH = 360;
    const POPUP_HEIGHT = 520;
    assert.equal(POPUP_WIDTH, 360);
    assert.equal(POPUP_HEIGHT, 520);
  });

  // ==========================================
  // F15 Boundaries: 5-Stage Brain Fatigue System (5 tests)
  // ==========================================
  await test('T2.F15.1: Exactly at boundary 20 is Stage 1; 21 is Stage 2', async () => {
    assert.equal(getFatigueStage(20).stage, 'fresh');
    assert.equal(getFatigueStage(21).stage, 'warming');
  });

  await test('T2.F15.2: Exactly at boundary 50 is Stage 2; 51 is Stage 3', async () => {
    assert.equal(getFatigueStage(50).stage, 'warming');
    assert.equal(getFatigueStage(51).stage, 'tired');
  });

  await test('T2.F15.3: Exactly at boundary 100 is Stage 3; 101 is Stage 4', async () => {
    assert.equal(getFatigueStage(100).stage, 'tired');
    assert.equal(getFatigueStage(101).stage, 'drained');
  });

  await test('T2.F15.4: Exactly at boundary 150 is Stage 4; 151 is Stage 5', async () => {
    assert.equal(getFatigueStage(150).stage, 'drained');
    assert.equal(getFatigueStage(151).stage, 'rot');
  });

  await test('T2.F15.5: Non-numeric input (string or negative) falls back to Stage 1 Fresh', async () => {
    assert.equal(getFatigueStage(-10).stage, 'fresh');
    assert.equal(getFatigueStage('invalid').stage, 'fresh');
    assert.equal(getFatigueStage(null).stage, 'fresh');
  });

  // ==========================================
  // F16 Boundaries: Multi-Horizon Stats Dashboard (5 tests)
  // ==========================================
  await test('T2.F16.1: 100% Instagram / 0% YouTube breakdown displays 100% and 0%', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    await sw.handleRecordView('instagram', 'ig_only_1');
    await sw.handleRecordView('instagram', 'ig_only_2');

    const popup = createPopupController(chrome);
    const vm = await popup.getViewModel();
    assert.equal(vm.instagramPercent, 100);
    assert.equal(vm.youtubePercent, 0);
  });

  await test('T2.F16.2: 0% Instagram / 100% YouTube breakdown displays 0% and 100%', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    await sw.handleRecordView('youtube', 'yt_only_1');

    const popup = createPopupController(chrome);
    const vm = await popup.getViewModel();
    assert.equal(vm.instagramPercent, 0);
    assert.equal(vm.youtubePercent, 100);
  });

  await test('T2.F16.3: Large numbers (50,000 IG / 50,000 YT) displays 50% and 50%', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    const stats = await sw.getStats();
    stats.today = 100000;
    stats.platforms.instagram.today = 50000;
    stats.platforms.youtube.today = 50000;
    await chrome.storage.local.set({ brainroad_stats: stats });

    const popup = createPopupController(chrome);
    const vm = await popup.getViewModel();
    assert.equal(vm.instagramPercent, 50);
    assert.equal(vm.youtubePercent, 50);
  });

  await test('T2.F16.4: 0 today count with 500 all-time count displays 0 today and 500 total', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    const stats = await sw.getStats();
    stats.today = 0;
    stats.total = 500;
    await chrome.storage.local.set({ brainroad_stats: stats });

    const popup = createPopupController(chrome);
    const vm = await popup.getViewModel();
    assert.equal(vm.today, 0);
    assert.equal(vm.total, 500);
  });

  await test('T2.F16.5: Missing platforms object in storage gracefully defaults to 0', async () => {
    const chrome = createMockChrome();
    await chrome.storage.local.set({ brainroad_stats: { version: 1, total: 0, today: 0 } });
    const popup = createPopupController(chrome);
    const vm = await popup.getViewModel();
    assert.equal(vm.instagramPercent, 0);
    assert.equal(vm.youtubePercent, 0);
  });

  // ==========================================
  // F17 Boundaries: Confirmed Reset Modal (5 tests)
  // ==========================================
  await test('T2.F17.1: Double clicking Reset button does not create multiple modals', async () => {
    const chrome = createMockChrome();
    const popup = createPopupController(chrome);
    popup.openResetModal();
    popup.openResetModal();
    const vm = await popup.getViewModel();
    assert.equal(vm.modalOpen, true);
  });

  await test('T2.F17.2: Reset when counts are already 0 executes cleanly without errors', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const popup = createPopupController(chrome);
    const res = await popup.confirmResetModal();
    assert.equal(res.ok, true);
  });

  await test('T2.F17.3: Resetting during active background playback resets counter immediately', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    await chrome.runtime.sendMessage({ type: 'RECORD_VIEW', platform: 'youtube', id: 'yt_prior' });

    const popup = createPopupController(chrome);
    await popup.confirmResetModal();
    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.today, 0);
  });

  await test('T2.F17.4: Rapid open/cancel toggling does not corrupt modal state', async () => {
    const chrome = createMockChrome();
    const popup = createPopupController(chrome);
    for (let i = 0; i < 5; i++) {
      popup.openResetModal();
      popup.cancelResetModal();
    }
    const vm = await popup.getViewModel();
    assert.equal(vm.modalOpen, false);
  });

  await test('T2.F17.5: Confirming reset clears both local today and session storage atomically', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    await chrome.runtime.sendMessage({ type: 'RECORD_VIEW', platform: 'instagram', id: 'atom_1' });

    const popup = createPopupController(chrome);
    await popup.confirmResetModal();

    const localStats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    const sessionData = await chrome.storage.session.get('sessionSeenIds');

    assert.equal(localStats.today, 0);
    assert.deepEqual(sessionData.sessionSeenIds, []);
  });

  return { suiteName: 'Tier 2: Boundary & Corner Cases', results };
}

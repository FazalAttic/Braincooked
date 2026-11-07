// tests/e2e/tier4_scenarios.test.js
// Tier 4: Real-World Workload User Scenarios (10 comprehensive end-to-end user flows)

import assert from 'node:assert/strict';
import {
  createMockChrome,
  MockDocument,
  MockWindow,
  createServiceWorkerController,
  createInstagramDetector,
  createYouTubeDetector,
  createPopupController,
  formatBadgeCount,
  getFatigueStage,
  advanceTime
} from './harness.js';

export async function runTier4Tests() {
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

  // SCEN-01: Morning Commute Doomscroll
  await test('SCEN-01: Morning Commute Doomscroll (25 shorts: 5 flicks, 15 singles, 5 loops)', async () => {
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

    // 1. 5 rapid flicks (< 1.5s each: 400ms)
    for (let i = 1; i <= 5; i++) {
      win.location.pathname = `/shorts/flk_${String(i).padStart(7, '0')}`;
      await v.play();
      detector.evaluate();
      await advanceTime(400);
      r.removeAttribute('is-active');
      detector.evaluate();
      r.setAttribute('is-active', '');
    }

    // 2. 15 watched once (1.6s each)
    for (let i = 1; i <= 15; i++) {
      win.location.pathname = `/shorts/sng_${String(i).padStart(7, '0')}`;
      await v.play();
      detector.evaluate();
      await advanceTime(1600);
    }

    // 3. 5 watched and looped 3 times each
    for (let i = 1; i <= 5; i++) {
      win.location.pathname = `/shorts/lop_${String(i).padStart(7, '0')}`;
      await v.play();
      detector.evaluate();
      await advanceTime(1600);

      // Loop 3 times
      for (let l = 0; l < 3; l++) {
        v.loop();
        detector.evaluate();
        await advanceTime(200);
      }
    }

    // Invariants check:
    // Flicks (5) = 0
    // Singles (15) = 15
    // Loops (5) = 5
    // Total YouTube views = 20
    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.youtube.today, 20);
    assert.equal(stats.today, 20);

    const badgeText = await chrome.action.getBadgeText();
    assert.equal(badgeText, '20');

    const popup = createPopupController(chrome);
    const vm = await popup.getViewModel();
    assert.equal(vm.stageName, 'Fresh Mind'); // Stage 1 (0-20)
  });

  // SCEN-02: Lunch Break Instagram Binge
  await test('SCEN-02: Lunch Break Instagram Binge (10 photos, 15 feed reels, 8 feed flicks, 12 dedicated reels)', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);

    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createInstagramDetector(chrome, win, doc);

    // 1. 10 static photo posts in feed (0 counts)
    for (let i = 1; i <= 10; i++) {
      const art = doc.createElement('article');
      const a = doc.createElement('a');
      a.setAttribute('href', `/p/photo_${i}/`);
      const img = doc.createElement('img');
      art.appendChild(a);
      art.appendChild(img);
      doc.body.appendChild(art);
    }

    // 2. 15 valid video reels in feed (>=1.6s dwell)
    for (let i = 1; i <= 15; i++) {
      const art = doc.createElement('article');
      const a = doc.createElement('a');
      a.setAttribute('href', `/reel/feed_binge_${i}/`);
      const v = doc.createElement('video');
      art.appendChild(a);
      art.appendChild(v);
      doc.body.appendChild(art);

      await v.play();
      detector.handleIntersection(v, 1.0);
      await advanceTime(1600);
    }

    // 3. 8 rapid feed scroll flicks (< 1.0s dwell: 300ms)
    for (let i = 1; i <= 8; i++) {
      const art = doc.createElement('article');
      const a = doc.createElement('a');
      a.setAttribute('href', `/reel/feed_flick_${i}/`);
      const v = doc.createElement('video');
      art.appendChild(a);
      art.appendChild(v);
      doc.body.appendChild(art);

      await v.play();
      detector.handleIntersection(v, 1.0);
      await advanceTime(300);
      detector.handleIntersection(v, 0.1); // scrolled past
    }

    // 4. Navigate to dedicated reels stream and watch 12 dedicated reels
    win.location.pathname = '/reels/';
    for (let i = 1; i <= 12; i++) {
      win.location.pathname = `/reels/dedicated_binge_${i}/`;
      const v = doc.createElement('video');
      doc.body.appendChild(v);
      await v.play();
      detector.handleIntersection(v, 1.0);
      await advanceTime(1600);
    }

    // Invariants:
    // Photos = 0
    // Feed valid = 15
    // Feed flicks = 0
    // Dedicated reels = 12
    // Total IG = 27
    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.instagram.today, 27);
    assert.equal(stats.today, 27);

    const popup = createPopupController(chrome);
    const vm = await popup.getViewModel();
    assert.equal(vm.stageName, 'Warming Up'); // 21 - 50 is Warming Up
    assert.equal(vm.stageColor, '#FFE9B4');
    assert.equal(vm.instagramPercent, 100);
  });

  // SCEN-03: Night Owl Midnight Rollover
  await test('SCEN-03: Night Owl Midnight Rollover (15 shorts pre-midnight + 10 shorts post-midnight)', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);

    // 15 shorts on Day 1 (23:45 to 23:59)
    for (let i = 1; i <= 15; i++) {
      const time = new Date(2026, 10, 6, 23, 45 + i % 14, 0);
      await sw.handleRecordView('youtube', `owl_pre_${i}`, time);
    }

    let stats = await sw.getStats();
    assert.equal(stats.today, 15);
    assert.equal(stats.total, 15);
    assert.equal(await chrome.action.getBadgeText(), '15');

    // Midnight strikes: 10 shorts on Day 2 (00:01 to 00:20)
    for (let i = 1; i <= 10; i++) {
      const time = new Date(2026, 10, 7, 0, 1 + i, 0);
      await sw.handleRecordView('youtube', `owl_post_${i}`, time);
    }

    stats = await sw.getStats();
    assert.equal(stats.lastActiveDate, '2026-11-07');
    assert.equal(stats.today, 10); // reset and counted 10
    assert.equal(stats.total, 25); // cumulative all-time preserved
    assert.equal(stats.history['2026-11-06'].total, 15); // archived!
    assert.equal(await chrome.action.getBadgeText(), '10');
  });

  // SCEN-04: Deep Doomscroll Cognitive Fatigue Progression
  await test('SCEN-04: Deep Doomscroll Cognitive Fatigue Progression (165 views across 5 stages)', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    const popup = createPopupController(chrome);

    // Stage 1: Fresh (1 to 20)
    for (let i = 1; i <= 20; i++) {
      await sw.handleRecordView('youtube', `stage_flow_${i}`);
    }
    let vm = await popup.getViewModel();
    assert.equal(vm.stageName, 'Fresh Mind');
    assert.equal(vm.stageColor, '#79D056');
    assert.equal(await chrome.action.getBadgeBackgroundColor(), '#79D056');

    // Stage 2: Warming Up (21 to 50)
    for (let i = 21; i <= 50; i++) {
      await sw.handleRecordView('instagram', `stage_flow_${i}`);
    }
    vm = await popup.getViewModel();
    assert.equal(vm.stageName, 'Warming Up');
    assert.equal(vm.stageColor, '#FFE9B4');
    assert.equal(await chrome.action.getBadgeBackgroundColor(), '#FFE9B4');

    // Stage 3: Tired Brain (51 to 100)
    for (let i = 51; i <= 100; i++) {
      await sw.handleRecordView('youtube', `stage_flow_${i}`);
    }
    vm = await popup.getViewModel();
    assert.equal(vm.stageName, 'Tired Brain');
    assert.equal(vm.stageColor, '#FFB367');
    assert.equal(await chrome.action.getBadgeBackgroundColor(), '#FFB367');

    // Stage 4: Drained (101 to 150)
    for (let i = 101; i <= 150; i++) {
      await sw.handleRecordView('instagram', `stage_flow_${i}`);
    }
    vm = await popup.getViewModel();
    assert.equal(vm.stageName, 'Drained');
    assert.equal(vm.stageColor, '#FC4A52');
    assert.equal(await chrome.action.getBadgeBackgroundColor(), '#FC4A52');

    // Stage 5: Brain Rot Alert (151 to 165)
    for (let i = 151; i <= 165; i++) {
      await sw.handleRecordView('youtube', `stage_flow_${i}`);
    }
    vm = await popup.getViewModel();
    assert.equal(vm.stageName, 'Brain Rot Alert');
    assert.equal(vm.stageColor, '#9B51E0');
    assert.equal(await chrome.action.getBadgeBackgroundColor(), '#9B51E0');
  });

  // SCEN-05: Multi-Tab Power User Session
  await test('SCEN-05: Multi-Tab Power User Session (3 tabs concurrent, mutex atomicity, zero race conditions)', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);

    // 3 tabs concurrently transmitting 10 views each
    const tab1Promises = Array.from({ length: 10 }, (_, i) => sw.handleRecordView('instagram', `t1_reel_${i}`));
    const tab2Promises = Array.from({ length: 10 }, (_, i) => sw.handleRecordView('instagram', `t2_reel_${i}`));
    const tab3Promises = Array.from({ length: 10 }, (_, i) => sw.handleRecordView('youtube', `t3_short_${i}`));

    await Promise.all([...tab1Promises, ...tab2Promises, ...tab3Promises]);

    const stats = await sw.getStats();
    assert.equal(stats.total, 30);
    assert.equal(stats.platforms.instagram.today, 20);
    assert.equal(stats.platforms.youtube.today, 10);
  });

  // SCEN-06: Mindful Reset & Recovery Cycle
  await test('SCEN-06: Mindful Reset & Recovery Cycle (110 views, cancel prompt, confirm prompt, UI reset)', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);

    for (let i = 1; i <= 60; i++) await sw.handleRecordView('instagram', `mind_ig_${i}`);
    for (let i = 1; i <= 50; i++) await sw.handleRecordView('youtube', `mind_yt_${i}`);

    const popup = createPopupController(chrome);
    let vm = await popup.getViewModel();
    assert.equal(vm.today, 110);
    assert.equal(vm.stageName, 'Drained');

    // User opens reset modal and clicks cancel
    popup.openResetModal();
    popup.cancelResetModal();
    vm = await popup.getViewModel();
    assert.equal(vm.today, 110); // stats preserved

    // User confirms reset
    popup.openResetModal();
    await popup.confirmResetModal();

    vm = await popup.getViewModel();
    assert.equal(vm.today, 0);
    assert.equal(vm.stageName, 'Fresh Mind');
    assert.equal(vm.stageColor, '#79D056');
    assert.equal(vm.total, 110); // All time preserved!

    assert.equal(await chrome.action.getBadgeText(), '');
  });

  // SCEN-07: Browser Crash & Cold Restart
  await test('SCEN-07: Browser Crash & Cold Restart (30 shorts viewed, session wiped, persistent storage retained)', async () => {
    const chrome = createMockChrome();
    let sw = createServiceWorkerController(chrome);

    for (let i = 1; i <= 30; i++) {
      await sw.handleRecordView('youtube', `crash_yt_${i}`);
    }

    let stats = await sw.getStats();
    assert.equal(stats.total, 30);

    // Browser crashes and restarts: session storage wiped, service worker respawned
    await chrome.storage.session.clear();
    sw = createServiceWorkerController(chrome);

    // Watching video 30 again in the new session is now counted because session cache was wiped!
    const res = await sw.handleRecordView('youtube', 'crash_yt_30');
    assert.equal(res.newlyCounted, true);

    stats = await sw.getStats();
    assert.equal(stats.total, 31);
  });

  // SCEN-08: Tab Visibility & Background Audio
  await test('SCEN-08: Tab Visibility & Background Audio (hidden tab playback rejected until visible)', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);

    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/shorts/audio_bg_te';

    const ytdShorts = doc.createElement('ytd-shorts');
    const r = doc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const v = doc.createElement('video');
    r.appendChild(v);
    ytdShorts.appendChild(r);
    doc.body.appendChild(ytdShorts);

    const detector = createYouTubeDetector(chrome, win, doc);
    await v.play();
    detector.evaluate();

    await advanceTime(500);
    doc.setVisibility('hidden'); // Switched to work tab

    await advanceTime(1500); // Audio plays in background
    assert.equal(detector.getSessionSeen().size, 0); // Not counted while hidden!

    doc.setVisibility('visible'); // Returned to video tab
    await advanceTime(1600); // Full 1.5s visible dwell
    assert.ok(detector.getSessionSeen().has('audio_bg_te'));
  });

  // SCEN-09: Long-Term 100-Day History Pruning
  await test('SCEN-09: Long-Term 100-Day History Pruning (120 consecutive daily records pruned to 90)', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    const stats = await sw.getStats();

    // 120 days in history
    for (let i = 1; i <= 120; i++) {
      const pad = String(i).padStart(3, '0');
      stats.history[`2024-01-${pad}`] = { total: 10, instagram: 5, youtube: 5 };
    }
    stats.lastActiveDate = '2024-05-01';
    await chrome.storage.local.set({ brainroad_stats: stats });

    const newDay = new Date(2024, 4, 2);
    await sw.handleRecordView('instagram', 'prune_trigger', newDay);

    const updated = await sw.getStats();
    assert.equal(Object.keys(updated.history).length, 90);
  });

  // SCEN-10: Million+ View Badge Formatting Stress
  await test('SCEN-10: Million+ View Badge Formatting Stress (large numbers format <= 4 chars)', async () => {
    const samples = [
      { count: 0, expected: '' },
      { count: 999, expected: '999' },
      { count: 1000, expected: '1k' },
      { count: 1250, expected: '1.2k' },
      { count: 9999, expected: '9.9k' },
      { count: 10000, expected: '10k' },
      { count: 99999, expected: '99k' },
      { count: 999999, expected: '999k' },
      { count: 1000000, expected: '1M+' },
      { count: 50000000, expected: '1M+' }
    ];

    for (const s of samples) {
      const formatted = formatBadgeCount(s.count);
      assert.equal(formatted, s.expected);
      assert.ok(formatted.length <= 4, `String '${formatted}' exceeds 4 chars!`);
    }
  });

  return { suiteName: 'Tier 4: Real-World User Scenarios', results };
}

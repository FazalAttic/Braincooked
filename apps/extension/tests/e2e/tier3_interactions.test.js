// tests/e2e/tier3_interactions.test.js
// Tier 3: Cross-Module & Multi-Tab Interaction Flows (24 pairwise tests)

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

export async function runTier3Tests() {
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

  // INT-01: Full user journey: IG Feed -> IG Reels -> YT Shorts -> View Popup
  await test('INT-01: Full user journey: Watch IG Feed -> Watch IG Reels -> Watch YT Shorts -> View Popup', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);

    // 1. Instagram Feed
    const igDoc = new MockDocument();
    const igWin = new MockWindow(igDoc);
    const igDetector = createInstagramDetector(chrome, igWin, igDoc);

    const article = igDoc.createElement('article');
    const aFeed = igDoc.createElement('a');
    aFeed.setAttribute('href', '/reel/journey_feed_1/');
    const vFeed = igDoc.createElement('video');
    article.appendChild(aFeed);
    article.appendChild(vFeed);
    igDoc.body.appendChild(article);

    await vFeed.play();
    igDetector.handleIntersection(vFeed, 1.0);
    await advanceTime(1600);

    // 2. Dedicated IG Reels
    igWin.location.pathname = '/reels/journey_reels_2/';
    const vReel = igDoc.createElement('video');
    igDoc.body.appendChild(vReel);
    await vReel.play();
    igDetector.handleIntersection(vReel, 1.0);
    await advanceTime(1600);

    // 3. YouTube Shorts
    const ytDoc = new MockDocument();
    const ytWin = new MockWindow(ytDoc);
    ytWin.location.pathname = '/shorts/journey_yt_3';
    const ytShorts = ytDoc.createElement('ytd-shorts');
    const ytRenderer = ytDoc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const ytVideo = ytDoc.createElement('video');
    ytRenderer.appendChild(ytVideo);
    ytShorts.appendChild(ytRenderer);
    ytDoc.body.appendChild(ytShorts);

    const ytDetector = createYouTubeDetector(chrome, ytWin, ytDoc);
    await ytVideo.play();
    ytDetector.evaluate();
    await advanceTime(1600);

    // 4. View Popup
    const popup = createPopupController(chrome);
    const vm = await popup.getViewModel();
    assert.equal(vm.today, 3);
    assert.equal(vm.instagramToday, 2);
    assert.equal(vm.youtubeToday, 1);
    assert.equal(vm.instagramPercent, 67);
    assert.equal(vm.youtubePercent, 33);
  });

  // INT-02: Concurrent multi-tab session: IG Tab and YT Tab active simultaneously
  await test('INT-02: Concurrent multi-tab session: IG Tab and YT Tab active simultaneously reporting views to single-writer SW', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);

    const igDoc = new MockDocument();
    const igWin = new MockWindow(igDoc);
    igWin.location.pathname = '/reel/ig_tab_conc/';
    const igDet = createInstagramDetector(chrome, igWin, igDoc);
    const igV = igDoc.createElement('video');
    igDoc.body.appendChild(igV);

    const ytDoc = new MockDocument();
    const ytWin = new MockWindow(ytDoc);
    ytWin.location.pathname = '/shorts/yt_tab_conc';
    const ytShorts = ytDoc.createElement('ytd-shorts');
    const ytR = ytDoc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const ytV = ytDoc.createElement('video');
    ytR.appendChild(ytV);
    ytShorts.appendChild(ytR);
    ytDoc.body.appendChild(ytShorts);
    const ytDet = createYouTubeDetector(chrome, ytWin, ytDoc);

    // Both play concurrently
    await Promise.all([igV.play(), ytV.play()]);
    igDet.handleIntersection(igV, 1.0);
    ytDet.evaluate();

    await advanceTime(1600);

    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.total, 2);
    assert.equal(stats.platforms.instagram.today, 1);
    assert.equal(stats.platforms.youtube.today, 1);
  });

  // INT-03: Live Popup Sync: Storage mutation in content script immediately updates open popup
  await test('INT-03: Live Popup Sync: Storage mutation in content script immediately updates open popup view model', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const popup = createPopupController(chrome);

    let initialVm = await popup.getViewModel();
    assert.equal(initialVm.today, 0);

    // Simulate content script recording view while popup is open
    await chrome.runtime.sendMessage({ type: 'RECORD_VIEW', platform: 'youtube', id: 'live_sync_01', timestamp: Date.now() });

    let updatedVm = await popup.getViewModel();
    assert.equal(updatedVm.today, 1);
    assert.equal(updatedVm.youtubeToday, 1);
  });

  // INT-04: Reset mid-session: User resets via popup modal, resets both content detector and SW cache
  await test('INT-04: Reset mid-session: User resets via popup modal, resets both content detector and SW cache', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);

    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/mid_session_r/';
    const detector = createInstagramDetector(chrome, win, doc);

    const v = doc.createElement('video');
    doc.body.appendChild(v);
    await v.play();
    detector.handleIntersection(v, 1.0);
    await advanceTime(1600);

    // Reset via popup
    const popup = createPopupController(chrome);
    popup.openResetModal();
    await popup.confirmResetModal();
    detector.resetSession();

    const vmAfterReset = await popup.getViewModel();
    assert.equal(vmAfterReset.today, 0);

    // Watch same reel again -> successfully recounts!
    detector.handleIntersection(v, 1.0);
    await advanceTime(1600);

    const vmAfterReplay = await popup.getViewModel();
    assert.equal(vmAfterReplay.today, 1);
  });

  // INT-05: Multi-day cross-platform history
  await test('INT-05: Multi-day cross-platform history: IG on Day 1, YT on Day 2, verifies partition in history', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);

    const day1 = new Date(2026, 10, 6, 15, 0, 0);
    await sw.handleRecordView('instagram', 'day1_ig', day1);

    const day2 = new Date(2026, 10, 7, 10, 0, 0);
    await sw.handleRecordView('youtube', 'day2_yt', day2);

    const stats = await sw.getStats();
    assert.equal(stats.history['2026-11-06'].instagram, 1);
    assert.equal(stats.history['2026-11-06'].youtube, 0);
    assert.equal(stats.today, 1);
    assert.equal(stats.platforms.youtube.today, 1);
    assert.equal(stats.platforms.instagram.today, 0);
  });

  // INT-06: Tab switching between IG and YT
  await test('INT-06: Tab switching between IG and YT: Leaving IG tab pauses dwell timer, switching to YT tab begins dwell timer', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);

    const igDoc = new MockDocument();
    const igWin = new MockWindow(igDoc);
    igWin.location.pathname = '/reel/switch_ig/';
    const igDet = createInstagramDetector(chrome, igWin, igDoc);
    const igV = igDoc.createElement('video');
    igDoc.body.appendChild(igV);
    await igV.play();
    igDet.handleIntersection(igV, 1.0);

    await advanceTime(600); // 600ms on IG
    igDoc.setVisibility('hidden'); // switch tab away

    // Switch to YT tab
    const ytDoc = new MockDocument();
    const ytWin = new MockWindow(ytDoc);
    ytWin.location.pathname = '/shorts/switch_yt_0';
    const ytShorts = ytDoc.createElement('ytd-shorts');
    const ytR = ytDoc.createElement('ytd-reel-video-renderer', { 'is-active': '' });
    const ytV = ytDoc.createElement('video');
    ytR.appendChild(ytV);
    ytShorts.appendChild(ytR);
    ytDoc.body.appendChild(ytShorts);
    const ytDet = createYouTubeDetector(chrome, ytWin, ytDoc);

    await ytV.play();
    ytDet.evaluate();
    await advanceTime(1600); // 1600ms on YT

    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.instagram.today, 0); // IG was aborted!
    assert.equal(stats.platforms.youtube.today, 1); // YT counted!
  });

  // INT-07: Simultaneous deduplication check across tabs
  await test('INT-07: Simultaneous deduplication check: Same ID presented to two concurrent tabs is counted exactly once', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);

    const p1 = sw.handleRecordView('youtube', 'shared_video');
    const p2 = sw.handleRecordView('youtube', 'shared_video');

    const [r1, r2] = await Promise.all([p1, p2]);
    const newlyCountedCount = (r1.newlyCounted ? 1 : 0) + (r2.newlyCounted ? 1 : 0);
    assert.equal(newlyCountedCount, 1);

    const stats = await sw.getStats();
    assert.equal(stats.platforms.youtube.today, 1);
  });

  // INT-08: Action badge text and color synchronization with popup fatigue stage
  await test('INT-08: Action badge text and color synchronization with popup fatigue stage during sequential views', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    const popup = createPopupController(chrome);

    for (let i = 1; i <= 21; i++) {
      await sw.handleRecordView('youtube', `badge_sync_${i}`);
    }

    const badgeText = await chrome.action.getBadgeText();
    const badgeColor = await chrome.action.getBadgeBackgroundColor();
    const vm = await popup.getViewModel();

    assert.equal(badgeText, '21');
    assert.equal(badgeColor, '#FFE9B4'); // Warming up
    assert.equal(vm.stageName, 'Warming Up');
    assert.equal(vm.stageColor, '#FFE9B4');
  });

  // INT-09: Feed scroll -> click to dedicated reel -> back to feed without phantom counts
  await test('INT-09: Feed scroll -> click to dedicated reel -> back to feed without phantom counts', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createInstagramDetector(chrome, win, doc);

    // Feed post
    const article = doc.createElement('article');
    const a = doc.createElement('a');
    a.setAttribute('href', '/reel/flow_feed_01/');
    const v1 = doc.createElement('video');
    article.appendChild(a);
    article.appendChild(v1);
    doc.body.appendChild(article);
    await v1.play();
    detector.handleIntersection(v1, 1.0);
    await advanceTime(1600);

    // User clicks and navigates to dedicated reels
    win.location.pathname = '/reels/flow_dedicated_02/';
    const v2 = doc.createElement('video');
    doc.body.appendChild(v2);
    await v2.play();
    detector.handleIntersection(v2, 1.0);
    await advanceTime(1600);

    // User clicks back to feed
    win.location.pathname = '/';
    detector.handleIntersection(v1, 1.0); // feed video still present
    await advanceTime(1600);

    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.instagram.today, 2); // exactly feed_01 and dedicated_02
  });

  // INT-10: YouTube infinite scroll down 3 shorts, scroll up 2 shorts, then navigate to watch page
  await test('INT-10: YouTube infinite scroll down 3 shorts, scroll up 2 shorts, then navigate to watch page', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createYouTubeDetector(chrome, win, doc);

    const ytdShorts = doc.createElement('ytd-shorts');
    doc.body.appendChild(ytdShorts);

    const ids = ['yt_seq_0111', 'yt_seq_0222', 'yt_seq_0333'];
    const renderers = [];

    for (const id of ids) {
      const r = doc.createElement('ytd-reel-video-renderer', { 'video-id': id });
      const v = doc.createElement('video');
      r.appendChild(v);
      ytdShorts.appendChild(r);
      renderers.push({ r, v, id });
    }

    // Scroll down 1, 2, 3
    for (const item of renderers) {
      renderers.forEach(x => x.r.removeAttribute('is-active'));
      item.r.setAttribute('is-active', '');
      win.location.pathname = `/shorts/${item.id}`;
      await item.v.play();
      detector.evaluate();
      await advanceTime(1600);
    }

    // Scroll back up to 2 and 1
    for (let i = 1; i >= 0; i--) {
      renderers.forEach(x => x.r.removeAttribute('is-active'));
      renderers[i].r.setAttribute('is-active', '');
      win.location.pathname = `/shorts/${renderers[i].id}`;
      await renderers[i].v.play();
      detector.evaluate();
      await advanceTime(1600);
    }

    // Navigate to watch page
    win.location.pathname = '/watch?v=long_form_vid';
    detector.evaluate();

    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.youtube.today, 3);
  });

  // INT-11: Cross-platform reset verification: Resetting today zeroes both IG and YT today counts
  await test('INT-11: Cross-platform reset verification: Resetting today zeroes both IG and YT today counts while preserving all-time', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);

    await sw.handleRecordView('instagram', 'r_ig');
    await sw.handleRecordView('youtube', 'r_yt');

    await sw.handleResetStats('all');
    const stats = await sw.getStats();

    assert.equal(stats.today, 0);
    assert.equal(stats.platforms.instagram.today, 0);
    assert.equal(stats.platforms.youtube.today, 0);
    assert.equal(stats.total, 2);
    assert.equal(stats.platforms.instagram.total, 1);
    assert.equal(stats.platforms.youtube.total, 1);
  });

  // INT-12: Rollover while YouTube tab is open: midnight rollover updates today count and badge immediately
  await test('INT-12: Rollover while YouTube tab is open: midnight rollover updates today count and badge immediately', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);

    const d1 = new Date(2026, 10, 6, 23, 59, 0);
    await sw.handleRecordView('youtube', 'y_pre_mid', d1);
    assert.equal(await chrome.action.getBadgeText(), '1');

    const d2 = new Date(2026, 10, 7, 0, 1, 0);
    await sw.handleRecordView('youtube', 'y_post_mid', d2);

    assert.equal(await chrome.action.getBadgeText(), '1'); // Today is 1
    const stats = await sw.getStats();
    assert.equal(stats.total, 2);
  });

  // INT-13: Instagram carousel post viewed in feed while dedicated reels tab is pre-loaded
  await test('INT-13: Instagram carousel post viewed in feed while dedicated reels tab is pre-loaded in background', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);

    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createInstagramDetector(chrome, win, doc);

    const article = doc.createElement('article');
    const a = doc.createElement('a');
    a.setAttribute('href', '/reel/carousel_main/');
    const v1 = doc.createElement('video');
    const v2 = doc.createElement('video');
    article.appendChild(a);
    article.appendChild(v1);
    article.appendChild(v2);
    doc.body.appendChild(article);

    await v1.play();
    detector.handleIntersection(v1, 1.0);
    await advanceTime(1600);

    // Swipe to slide 2
    await v2.play();
    detector.handleIntersection(v2, 1.0);
    await advanceTime(1600);

    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.instagram.today, 1); // Deduplicated to 1!
  });

  // INT-14: Rapid tab switching spam: toggling visibility between 2 tabs does not accumulate fragmented dwell times
  await test('INT-14: Rapid tab switching spam: toggling visibility between 2 tabs does not accumulate fragmented dwell times', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);

    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/frag_dwell/';
    const detector = createInstagramDetector(chrome, win, doc);

    const v = doc.createElement('video');
    doc.body.appendChild(v);
    await v.play();

    // 4 cycles of 400ms visible + 400ms hidden (total 1600ms visible fragmented)
    for (let i = 0; i < 4; i++) {
      doc.setVisibility('visible');
      detector.handleIntersection(v, 1.0);
      await advanceTime(400);
      doc.setVisibility('hidden');
      await advanceTime(100);
    }

    const stored = await chrome.storage.local.get('brainroad_stats');
    const igToday = stored.brainroad_stats?.platforms?.instagram?.today || 0;
    assert.equal(igToday, 0); // No continuous 1.5s dwell!
  });

  // INT-15: Popup confirmed reset cancels and re-checks before confirming
  await test('INT-15: Popup confirmed reset cancels and re-checks before confirming', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);
    await sw.handleRecordView('youtube', 'y_safe_test');

    const popup = createPopupController(chrome);
    popup.openResetModal();
    popup.cancelResetModal();

    let stats = await sw.getStats();
    assert.equal(stats.today, 1);

    popup.openResetModal();
    await popup.confirmResetModal();

    stats = await sw.getStats();
    assert.equal(stats.today, 0);
  });

  // INT-16: Storage listener error isolation: Corrupted external listener does not halt internal increments
  await test('INT-16: Storage listener error isolation: Corrupted external listener does not halt internal increments', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);

    chrome.storage.onChanged.addListener(() => {
      throw new Error('Broken external listener');
    });

    const res = await sw.handleRecordView('instagram', 'err_isol_01');
    assert.equal(res.ok, true);
    assert.equal(res.newlyCounted, true);
  });

  // INT-17: Cross-platform identical ID collision: IG shortcode and YT videoId tracked independently
  await test('INT-17: Cross-platform identical ID collision: IG shortcode and YT videoId tracked independently', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);

    const resIg = await sw.handleRecordView('instagram', 'identical_id');
    const resYt = await sw.handleRecordView('youtube', 'identical_id');

    assert.equal(resIg.newlyCounted, true);
    assert.equal(resYt.newlyCounted, true);

    const stats = await sw.getStats();
    assert.equal(stats.total, 2);
    assert.equal(stats.platforms.instagram.today, 1);
    assert.equal(stats.platforms.youtube.today, 1);
  });

  // INT-18: Service worker cold start re-hydration: Sw wakes up, reads local storage, formats badge correctly
  await test('INT-18: Service worker cold start re-hydration: Sw wakes up, reads local storage, formats badge correctly', async () => {
    const chrome = createMockChrome();
    // Simulate pre-existing storage from previous session
    const stats = {
      version: 1,
      total: 45,
      today: 45,
      lastActiveDate: '2026-11-06',
      platforms: {
        instagram: { total: 20, today: 20 },
        youtube: { total: 25, today: 25 }
      },
      history: {},
      updatedAt: Date.now()
    };
    await chrome.storage.local.set({ brainroad_stats: stats });

    const sw = createServiceWorkerController(chrome);
    const readStats = await sw.getStats();
    await sw.updateBadge(readStats.today);

    assert.equal(await chrome.action.getBadgeText(), '45');
    assert.equal(await chrome.action.getBadgeBackgroundColor(), '#FFE9B4');
  });

  // INT-19: Fast feed scrolling followed by genuine 2-second dwell on 5th post
  await test('INT-19: Fast feed scrolling followed by genuine 2-second dwell on 5th post: exactly 1 post counted', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const detector = createInstagramDetector(chrome, win, doc);

    // Fast flick through 4 posts (300ms each)
    for (let i = 1; i <= 4; i++) {
      win.location.pathname = `/reel/flick_past_${i}/`;
      const v = doc.createElement('video');
      doc.body.appendChild(v);
      await v.play();
      detector.handleIntersection(v, 1.0);
      await advanceTime(300);
      detector.handleIntersection(v, 0.1); // scroll past
    }

    // Genuine dwell on 5th post
    win.location.pathname = '/reel/genuine_dwell_5/';
    const v5 = doc.createElement('video');
    doc.body.appendChild(v5);
    await v5.play();
    detector.handleIntersection(v5, 1.0);
    await advanceTime(1600);

    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.instagram.today, 1);
  });

  // INT-20: Muted autoplay in feed with manual unpause: dwell starts only upon genuine playback
  await test('INT-20: Muted autoplay in feed with manual unpause: dwell starts only upon genuine playback', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    win.location.pathname = '/reel/autoplay_click/';
    const detector = createInstagramDetector(chrome, win, doc);

    const v = doc.createElement('video');
    v.muted = true;
    v.pause(); // Autoplay blocked!
    doc.body.appendChild(v);

    detector.handleIntersection(v, 1.0);
    await advanceTime(1600);
    assert.equal(detector.getSessionSeen().size, 0);

    // User clicks play
    await v.play();
    detector.handlePlaybackChange(v);
    await advanceTime(1600);
    assert.ok(detector.getSessionSeen().has('autoplay_click'));
  });

  // INT-21: Dynamic DOM recycling on YouTube Shorts while Instagram tab performs background sync
  await test('INT-21: Dynamic DOM recycling on YouTube Shorts while Instagram tab performs background sync', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);

    const ytDoc = new MockDocument();
    const ytWin = new MockWindow(ytDoc);
    const ytDet = createYouTubeDetector(chrome, ytWin, ytDoc);

    const ytdShorts = ytDoc.createElement('ytd-shorts');
    ytDoc.body.appendChild(ytdShorts);

    const r = ytDoc.createElement('ytd-reel-video-renderer', { 'is-active': '', 'video-id': 'recycle_A_01' });
    const v = ytDoc.createElement('video');
    r.appendChild(v);
    ytdShorts.appendChild(r);

    winLocation(ytWin, '/shorts/recycle_A_01');
    await v.play();
    ytDet.evaluate();
    await advanceTime(1600);

    // YouTube mutates same renderer for video B
    r.setAttribute('video-id', 'recycle_B_02');
    winLocation(ytWin, '/shorts/recycle_B_02');
    ytDet.evaluate();
    await advanceTime(1600);

    const stats = (await chrome.storage.local.get('brainroad_stats')).brainroad_stats;
    assert.equal(stats.platforms.youtube.today, 2);
  });

  // INT-22: Badge transition across all fatigue colors matching popup mascot
  await test('INT-22: Badge transition across all fatigue colors matching popup mascot during active viewing session', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);

    // Test transition points: 20 (green) -> 21 (cream) -> 51 (apricot) -> 101 (amber/red) -> 151 (purple)
    const points = [
      { count: 20, color: '#79D056' },
      { count: 21, color: '#FFE9B4' },
      { count: 51, color: '#FFB367' },
      { count: 101, color: '#FC4A52' },
      { count: 151, color: '#9B51E0' }
    ];

    for (const p of points) {
      await sw.updateBadge(p.count);
      assert.equal(await chrome.action.getBadgeBackgroundColor(), p.color);
    }
  });

  // INT-23: Offline recovery: Storage set failure caught and handled gracefully
  await test('INT-23: Offline recovery: Storage set failure caught and handled gracefully without crashing detector', async () => {
    const chrome = createMockChrome();
    createServiceWorkerController(chrome);

    // Simulate temporary storage failure
    const originalSet = chrome.storage.local.set;
    chrome.storage.local.set = async () => { throw new Error('Disk IO Full'); };

    const res = await chrome.runtime.sendMessage({ type: 'RECORD_VIEW', platform: 'instagram', id: 'fail_safe' });
    assert.equal(res.ok, false);
    assert.ok(res.error.includes('Disk IO Full'));

    // Restore
    chrome.storage.local.set = originalSet;
  });

  // INT-24: Full end-to-end multi-platform lifecycle: IG view -> YT view -> Midnight -> IG view -> Reset -> YT view
  await test('INT-24: Full end-to-end multi-platform lifecycle: IG view -> YT view -> Midnight -> IG view -> Reset -> YT view', async () => {
    const chrome = createMockChrome();
    const sw = createServiceWorkerController(chrome);

    // Day 1
    const d1 = new Date(2026, 10, 6, 22, 0, 0);
    await sw.handleRecordView('instagram', 'cycle_ig1', d1);
    await sw.handleRecordView('youtube', 'cycle_yt1', d1);

    let stats = await sw.getStats();
    assert.equal(stats.today, 2);

    // Midnight rollover to Day 2
    const d2 = new Date(2026, 10, 7, 0, 15, 0);
    await sw.handleRecordView('instagram', 'cycle_ig2', d2);

    stats = await sw.getStats();
    assert.equal(stats.today, 1);
    assert.equal(stats.total, 3);
    assert.equal(stats.history['2026-11-06'].total, 2);

    // Midday reset
    await sw.handleResetStats('all');
    stats = await sw.getStats();
    assert.equal(stats.today, 0);

    // Continue on Day 2
    await sw.handleRecordView('youtube', 'cycle_yt2', d2);
    stats = await sw.getStats();
    assert.equal(stats.today, 1);
    assert.equal(stats.total, 4);
  });

  function winLocation(win, path) {
    win.location.pathname = path;
  }

  return { suiteName: 'Tier 3: Cross-Module Interactions & Pairwise Flows', results };
}

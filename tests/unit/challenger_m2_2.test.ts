/**
 * tests/unit/challenger_m2_2.test.ts
 * Challenger M2-2 Empirical Adversarial Stress Test Suite:
 * 
 * Focus Areas:
 * 1. Tab Visibility & Background Audio Edge Cases
 *    - Continuous non-cumulative dwell verification across tab backgrounding (document.visibilityState = 'hidden')
 *    - Immediate dwell timer cancellation on 'hidden'
 *    - Zero increment while tab is hidden with video playing (background audio simulation)
 *    - Restart of full 1.5s continuous dwell from zero upon returning to tab ('visible')
 *    - Background tab behavior when video continues playing vs pauses
 * 
 * 2. Route Thrashing & Anchor Mutation Edge Cases
 *    - 30 rapid client-side URL changes in under 500ms via popstate, hashchange, and window.navigation
 *    - Detection of timer memory leaks, uncancelled timeouts, or duplicate view counts
 *    - Corrupted, missing, and dynamically mutating anchor links mid-playback
 *    - Mid-playback anchor href mutation (dynamic shortcode swap)
 *    - Mid-playback anchor removal from container
 *    - React Virtual DOM recycling across corrupted and valid fixtures
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockChrome } from '../mocks/chrome';
import { MockIntersectionObserver, createMockVideo } from '../mocks/video';
import {
  createFeedReelFixture,
  createDedicatedReelFixture,
  createCorruptedReelFixture,
  createRecycledFeedContainer
} from '../mocks/dom';
import {
  InstagramReelDetector,
  extractReelShortcode,
  DEFAULT_DWELL_MS,
  DEFAULT_VISIBILITY_THRESHOLD
} from '../../src/content/instagram';

// Suppress auto-initialization of live detector in test environment
(window as any).__BRAINROAD_TEST_ENV__ = true;

describe('Challenger M2-2 Empirical Adversarial Stress Suite', () => {
  let detector: InstagramReelDetector;

  it('declares correct default timing and visibility constants', () => {
    expect(DEFAULT_DWELL_MS).toBe(1500);
    expect(DEFAULT_VISIBILITY_THRESHOLD).toBe(0.60);
  });

  beforeEach(() => {
    (window as any).__BRAINROAD_TEST_ENV__ = true;
    mockChrome.resetAll();
    MockIntersectionObserver.install();
    MockIntersectionObserver.reset();

    // Default document visibility to 'visible'
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true
    });

    // Reset location pathname & href
    Object.defineProperty(window, 'location', {
      value: {
        pathname: '/',
        href: 'https://www.instagram.com/',
        search: '',
        hash: ''
      },
      writable: true,
      configurable: true
    });

    delete (window as any).navigation;
    document.body.innerHTML = '';
    vi.useFakeTimers();

    detector = new InstagramReelDetector();
    detector.init();
  });

  afterEach(() => {
    detector.destroy();
    delete (window as any).navigation;
    MockIntersectionObserver.reset();
    MockIntersectionObserver.uninstall();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // ==========================================================================
  // SECTION 1: TAB VISIBILITY & BACKGROUND AUDIO EDGE CASES
  // ==========================================================================
  describe('1. Tab Visibility & Background Audio Stress Tests', () => {
    it('cancels dwell timer immediately when tab switches to hidden after 800ms', async () => {
      const fixture = createFeedReelFixture('VIS_TEST_01');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.8, true);

      // Verify dwell timer starts
      expect(detector.isDwellActive(fixture.video)).toBe(true);

      // Advance 800ms (< 1500ms)
      await vi.advanceTimersByTimeAsync(800);
      expect(detector.isDwellActive(fixture.video)).toBe(true);

      // User switches tab: visibilityState becomes 'hidden'
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      // Invariant: dwell timer must be cancelled immediately
      expect(detector.isDwellActive(fixture.video)).toBe(false);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(0);
      expect(detector.getSessionSeen().has('VIS_TEST_01')).toBe(false);
    });

    it('does not increment counter or record dwell while video plays in hidden tab for 10 seconds', async () => {
      const fixture = createFeedReelFixture('BG_AUDIO_PLAYING');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      // Video starts playing with sound
      fixture.video.muted = false;
      fixture.video.volume = 1.0;
      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.9, true);

      // User quickly switches away at 400ms
      await vi.advanceTimersByTimeAsync(400);
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(detector.isDwellActive(fixture.video)).toBe(false);

      // Video continues playing in background with audio for 10,000ms
      for (let sec = 0; sec < 10; sec++) {
        fixture.video.simulateTimeUpdate(fixture.video.currentTime + 1);
        await vi.advanceTimersByTimeAsync(1000);
      }

      // Invariants:
      // Video is still unpaused
      expect(fixture.video.paused).toBe(false);
      // Dwell timer was never resurrected while hidden
      expect(detector.isDwellActive(fixture.video)).toBe(false);
      // Zero messages sent
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(0);
      // Not marked as seen
      expect(detector.getSessionSeen().has('BG_AUDIO_PLAYING')).toBe(false);
    });

    it('requires full continuous 1500ms dwell from ZERO upon returning to tab (non-cumulative)', async () => {
      const fixture = createFeedReelFixture('NON_CUMULATIVE_REEL');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.85, true);

      // Phase 1: Play for 1200ms in visible state (80% of threshold)
      await vi.advanceTimersByTimeAsync(1200);
      expect(detector.isDwellActive(fixture.video)).toBe(true);

      // Phase 2: Tab hidden for 3000ms
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(detector.isDwellActive(fixture.video)).toBe(false);
      await vi.advanceTimersByTimeAsync(3000);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(0);

      // Phase 3: Tab becomes visible again
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      // Video signals active playback
      fixture.video.dispatchEvent(new Event('playing'));
      expect(detector.isDwellActive(fixture.video)).toBe(true);

      // Advance 400ms. In a cumulative timer, 1200 + 400 = 1600ms would qualify!
      // But Brainroad requires STRICT continuous dwell:
      await vi.advanceTimersByTimeAsync(400);
      expect(detector.getSessionSeen().has('NON_CUMULATIVE_REEL')).toBe(false);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(0);

      // Advance another 1000ms (total 1400ms since return < 1500ms)
      await vi.advanceTimersByTimeAsync(1000);
      expect(detector.getSessionSeen().has('NON_CUMULATIVE_REEL')).toBe(false);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(0);

      // Advance final 200ms (now 1600ms continuous dwell since return >= 1500ms)
      await vi.advanceTimersByTimeAsync(200);
      expect(detector.getSessionSeen().has('NON_CUMULATIVE_REEL')).toBe(true);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe('NON_CUMULATIVE_REEL');
    });

    it('handles multiple rapid tab switching (5 hidden-visible oscillations)', async () => {
      const fixture = createFeedReelFixture('RAPID_TAB_FLIP');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.75, true);

      // 5 rapid tab switches every 500ms (never reaching 1500ms)
      for (let i = 0; i < 5; i++) {
        // Tab visible for 500ms
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        fixture.video.dispatchEvent(new Event('playing'));
        expect(detector.isDwellActive(fixture.video)).toBe(true);
        await vi.advanceTimersByTimeAsync(500);

        // Tab hidden for 500ms
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        expect(detector.isDwellActive(fixture.video)).toBe(false);
        await vi.advanceTimersByTimeAsync(500);
      }

      // Assert zero views qualified after 5 oscillations
      expect(detector.getSessionSeen().has('RAPID_TAB_FLIP')).toBe(false);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(0);

      // Finally stay visible for 1600ms
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      fixture.video.dispatchEvent(new Event('playing'));
      await vi.advanceTimersByTimeAsync(1600);

      // Qualifies exactly once
      expect(detector.getSessionSeen().has('RAPID_TAB_FLIP')).toBe(true);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);
    });

    it('CONFIRMED GAP / VULNERABILITY: continuously playing video does NOT resume dwell upon visibilitychange to visible without external media event', async () => {
      const fixture = createFeedReelFixture('VIS_BUG_DEMO');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      // 1. Video starts playing while tab is visible
      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.8, true);
      expect(detector.isDwellActive(fixture.video)).toBe(true);

      // 2. Tab becomes hidden at 500ms
      await vi.advanceTimersByTimeAsync(500);
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      // Dwell timer is aborted
      expect(detector.isDwellActive(fixture.video)).toBe(false);

      // 3. Video continues playing in background with audio for 3000ms
      await vi.advanceTimersByTimeAsync(3000);
      expect(fixture.video.paused).toBe(false);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(0);

      // 4. Tab becomes visible again
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      // EMPIRICAL OBSERVATION: handleVisibilityChange() has no logic for document.visibilityState === 'visible'
      // Therefore, isDwellActive remains FALSE without an external play/playing or intersection event!
      expect(detector.isDwellActive(fixture.video)).toBe(false);

      // 5. User watches the reel in the active visible tab for another 3000ms
      await vi.advanceTimersByTimeAsync(3000);

      // VULNERABILITY CONFIRMED: The view is NEVER counted because the dwell timer was never restarted!
      expect(detector.getSessionSeen().has('VIS_BUG_DEMO')).toBe(false);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(0);

      // 6. Verification of fix path: If handlePlaybackChange or a media event is triggered, dwell recovers
      detector.handlePlaybackChange(fixture.video);
      expect(detector.isDwellActive(fixture.video)).toBe(true);

      // And requires full 1500ms from zero to qualify
      await vi.advanceTimersByTimeAsync(1400); // 1400 < 1500ms
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(200); // 1600 >= 1500ms
      expect(detector.getSessionSeen().has('VIS_BUG_DEMO')).toBe(true);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);
    });
  });

  // ==========================================================================
  // SECTION 2: ROUTE THRASHING EDGE CASES (30 RAPID URL CHANGES < 500ms)
  // ==========================================================================
  describe('2. Route Thrashing Stress Tests', () => {
    it('handles 30 rapid popstate client-side URL changes in under 500ms without memory leaks or double counts', async () => {
      const fixture = createDedicatedReelFixture('THRASH_FINAL_30');
      document.body.appendChild(fixture.container);
      detector.observeVideo(fixture.video);
      await fixture.video.play();

      // Simulate 30 rapid popstate events, 15ms apart (total 450ms < 500ms)
      for (let i = 0; i < 30; i++) {
        const tempPath = `/reel/THRASH_ROUTE_${i}/`;
        window.location.pathname = tempPath;
        window.location.href = `https://www.instagram.com${tempPath}`;

        window.dispatchEvent(new PopStateEvent('popstate', { state: { index: i } }));

        // Advance 15ms
        await vi.advanceTimersByTimeAsync(15);

        // Memory invariant: activeTimers must never accumulate more than 1 timer per video
        expect(detector['activeTimers'].size).toBeLessThanOrEqual(1);
      }

      // None of the intermediate routes should have qualified
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(0);
      expect(detector.getSessionSeen().size).toBe(0);

      // Now set final URL and let it settle
      const finalPath = '/reel/THRASH_FINAL_30/';
      window.location.pathname = finalPath;
      window.location.href = `https://www.instagram.com${finalPath}`;
      window.dispatchEvent(new PopStateEvent('popstate', { state: { index: 30 } }));

      // Settle and dwell for full 1600ms
      await vi.advanceTimersByTimeAsync(1600);

      // Invariant: strictly 1 view qualified for the settled shortcode
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe('THRASH_FINAL_30');
      expect(detector.getSessionSeen().size).toBe(1);
      expect(detector.getSessionSeen().has('THRASH_FINAL_30')).toBe(true);
    });

    it('handles 30 rapid window.navigation events without crashing or timer leakage', async () => {
      const fixture = createDedicatedReelFixture('NAV_FINAL_30');
      // Destroy default detector to avoid dual tracking
      detector.destroy();

      // Mock window.navigation interface if absent in test runner
      const mockNav = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };
      (window as any).navigation = mockNav;

      // Re-init detector with navigation support
      detector = new InstagramReelDetector({
        window,
        document
      });
      detector.init();
      document.body.appendChild(fixture.container);
      detector.observeVideo(fixture.video);
      await fixture.video.play();

      // Extract bound listener from mockNav
      const navigateCall = mockNav.addEventListener.mock.calls.find((c: any) => c[0] === 'navigate');
      const navigateListener = navigateCall ? navigateCall[1] : null;
      expect(navigateListener).toBeDefined();

      // Fire 30 rapid navigate events
      for (let i = 0; i < 30; i++) {
        const nextUrl = `https://www.instagram.com/reel/NAV_ROUTE_${i}/`;
        navigateListener({
          destination: { url: nextUrl }
        });
        await vi.advanceTimersByTimeAsync(10);
      }

      // Memory invariant: activeTimers must remain bounded
      expect(detector['activeTimers'].size).toBeLessThanOrEqual(1);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(0);

      // Final navigate event
      const finalUrl = 'https://www.instagram.com/reel/NAV_FINAL_30/';
      navigateListener({
        destination: { url: finalUrl }
      });

      await vi.advanceTimersByTimeAsync(1600);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe('NAV_FINAL_30');
    });

    it('rapid popstate thrashing on the SAME route does not create duplicate timers or multiple dispatches', async () => {
      const fixture = createFeedReelFixture('SAME_ROUTE_THRASH');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);
      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.8, true);

      // Fire 30 popstate events on identical URL within 300ms (every 10ms)
      for (let i = 0; i < 30; i++) {
        window.dispatchEvent(new PopStateEvent('popstate'));
        await vi.advanceTimersByTimeAsync(10);
      }

      // Total time so far = 300ms. Dwell timer was reset each time, so not qualified yet.
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(0);
      expect(detector.getSessionSeen().has('SAME_ROUTE_THRASH')).toBe(false);

      // Now dwell continuously for 1600ms without interruption
      await vi.advanceTimersByTimeAsync(1600);

      // Must qualify exactly once
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe('SAME_ROUTE_THRASH');
      expect(detector.getSessionSeen().has('SAME_ROUTE_THRASH')).toBe(true);

      // 10 more popstates AFTER qualification must NOT re-qualify
      for (let i = 0; i < 10; i++) {
        window.dispatchEvent(new PopStateEvent('popstate'));
        await vi.advanceTimersByTimeAsync(100);
      }
      await vi.advanceTimersByTimeAsync(2000);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);
    });
  });

  // ==========================================================================
  // SECTION 3: ANCHOR MUTATION & CORRUPTION EDGE CASES
  // ==========================================================================
  describe('3. Anchor Mutation & Corrupted DOM Stress Tests', () => {
    it('handles anchor href dynamically modified mid-playback safely', async () => {
      const fixture = createFeedReelFixture('ORIGINAL_SHORTCODE');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.8, true);

      // Starts dwell for 'ORIGINAL_SHORTCODE'
      expect(detector.isDwellActive(fixture.video)).toBe(true);
      await vi.advanceTimersByTimeAsync(500);

      // Mid-playback: React dynamically mutates the anchor href to 'MUTATED_SHORTCODE'
      const anchor = fixture.article.querySelector('a')!;
      anchor.setAttribute('href', '/reel/MUTATED_SHORTCODE/');

      // Advance past remaining 1000ms
      await vi.advanceTimersByTimeAsync(1100);

      // Verification: One view dispatched, no unhandled exception
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);
      const dispatchedId = mockChrome.runtime.sendMessageCalls[0].message.id;
      // Either original (captured in dwell closure) or mutated ID is safely accepted
      expect(['ORIGINAL_SHORTCODE', 'MUTATED_SHORTCODE']).toContain(dispatchedId);
    });

    it('handles anchor element completely removed from DOM mid-playback safely', async () => {
      const fixture = createFeedReelFixture('ANCHOR_REMOVED_MID');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.8, true);
      expect(detector.isDwellActive(fixture.video)).toBe(true);
      await vi.advanceTimersByTimeAsync(600);

      // Mid-playback: anchor element is unmounted/removed by React virtual DOM
      const anchor = fixture.article.querySelector('a')!;
      anchor.remove();

      // Video remains playing in container
      expect(fixture.article.querySelector('a')).toBeNull();

      // Advance past dwell threshold
      await vi.advanceTimersByTimeAsync(1000);

      // Invariant: no crash, captured closure shortcode dispatched safely
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe('ANCHOR_REMOVED_MID');
    });

    it('rejects corrupt, empty, and malicious anchor hrefs without throwing', () => {
      const testCases = [
        { href: '', expected: null },
        { href: '#', expected: null },
        { href: 'javascript:void(0)', expected: null },
        { href: '/reel/', expected: null },
        { href: '/reels/', expected: null },
        { href: '/reel//', expected: null },
        { href: '/p/', expected: null },
        { href: '/explore/', expected: null },
        { href: '/stories/user/123/', expected: null },
        { href: 'https://evil.com/reel/MALICIOUS/', expected: 'MALICIOUS' }, // Path match safe
        { href: '/reel/VALID_CODE_123/?utm_source=ig_web', expected: 'VALID_CODE_123' },
        { href: '/reels/DEDICATED_456/', expected: 'DEDICATED_456' },
        { href: '/p/PHOTO_POST_789/', expected: 'p_PHOTO_POST_789' }
      ];

      for (const tc of testCases) {
        const article = document.createElement('article');
        const video = createMockVideo();
        article.appendChild(video);

        if (tc.href !== '') {
          const a = document.createElement('a');
          a.setAttribute('href', tc.href);
          article.appendChild(a);
        }

        const extracted = extractReelShortcode(video);
        expect(extracted).toBe(tc.expected);
      }
    });

    it('recycled container cycling between valid -> corrupted -> valid shortcodes', async () => {
      const feed = createRecycledFeedContainer();
      document.body.appendChild(feed.container);

      // Cycle 1: Valid Reel
      const validReel1 = createFeedReelFixture('RECYCLE_VALID_1');
      feed.mountArticle(validReel1);
      detector.observeVideo(validReel1.video);
      await validReel1.video.play();
      MockIntersectionObserver.simulate(validReel1.video, 0.8, true);
      await vi.advanceTimersByTimeAsync(1600);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe('RECYCLE_VALID_1');

      // Unmount Cycle 1
      feed.unmountArticle(validReel1);

      // Cycle 2: Corrupted Reel (missing valid anchor link)
      const corruptedReel = createCorruptedReelFixture();
      feed.mountArticle(corruptedReel as any);
      detector.observeVideo(corruptedReel.video);
      await corruptedReel.video.play();
      MockIntersectionObserver.simulate(corruptedReel.video, 0.8, true);
      await vi.advanceTimersByTimeAsync(1600);
      // Corrupted reel must NOT dispatch any message
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);

      // Unmount Cycle 2
      feed.unmountArticle(corruptedReel as any);

      // Cycle 3: Second Valid Reel
      const validReel2 = createFeedReelFixture('RECYCLE_VALID_2');
      feed.mountArticle(validReel2);
      detector.observeVideo(validReel2.video);
      await validReel2.video.play();
      MockIntersectionObserver.simulate(validReel2.video, 0.8, true);
      await vi.advanceTimersByTimeAsync(1600);

      // Must have qualified both valid reels, total dispatches = 2
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(2);
      expect(mockChrome.runtime.sendMessageCalls[1].message.id).toBe('RECYCLE_VALID_2');
      expect(detector.getSessionSeen().size).toBe(2);
      expect(detector.getSessionSeen().has('RECYCLE_VALID_1')).toBe(true);
      expect(detector.getSessionSeen().has('RECYCLE_VALID_2')).toBe(true);
    });

    it('safely handles deeply nested DOM structures and detached nodes without throwing', async () => {
      const deepContainer = document.createElement('article');
      let currentParent: HTMLElement = deepContainer;
      for (let i = 0; i < 20; i++) {
        const div = document.createElement('div');
        currentParent.appendChild(div);
        currentParent = div;
      }

      const anchor = document.createElement('a');
      anchor.setAttribute('href', '/reel/DEEP_NESTED_REEL/');
      deepContainer.appendChild(anchor);

      const video = createMockVideo();
      currentParent.appendChild(video);
      document.body.appendChild(deepContainer);

      detector.observeVideo(video);
      await video.play();
      MockIntersectionObserver.simulate(video, 0.7, true);

      expect(detector.isDwellActive(video)).toBe(true);
      await vi.advanceTimersByTimeAsync(1600);

      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe('DEEP_NESTED_REEL');

      // Now detach element entirely from DOM mid-timer
      const detachedVideo = createMockVideo();
      deepContainer.appendChild(detachedVideo);
      detector.observeVideo(detachedVideo);
      await detachedVideo.play();
      MockIntersectionObserver.simulate(detachedVideo, 0.7, true);

      // Remove before timer expires
      deepContainer.remove();
      // Wait for timer
      await vi.advanceTimersByTimeAsync(1600);
      // Disconnected video check in startDwell prevents double count
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);
    });
  });
});

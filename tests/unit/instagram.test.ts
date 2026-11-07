/**
 * tests/unit/instagram.test.ts
 * Comprehensive Unit and DOM Integration Test Suite for Instagram Reel Detection,
 * Triple-Gate Qualification, and Session Deduplication (Milestone M2: TC-01 to TC-10).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockChrome } from '../mocks/chrome';
import { MockIntersectionObserver, createMockVideo } from '../mocks/video';
import {
  createFeedReelFixture,
  createDedicatedReelFixture,
  createImagePostFixture,
  createCorruptedReelFixture,
  createRecycledFeedContainer
} from '../mocks/dom';
import {
  InstagramReelDetector,
  extractReelShortcode,
  createInstagramDetector,
  DWELL_THRESHOLD_MS,
  VISIBILITY_THRESHOLD_RATIO
} from '../../src/content/instagram';

describe('Instagram Reel Detection & Qualification (Milestone M2)', () => {
  let detector: InstagramReelDetector;

  beforeEach(() => {
    // Reset mock Chrome runtime and storage
    mockChrome.resetAll();

    // Install mock IntersectionObserver into JSDOM environment
    MockIntersectionObserver.install();
    MockIntersectionObserver.reset();

    // Default document visibility to 'visible'
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true
    });

    // Reset location pathname
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

    // Clear document body
    document.body.innerHTML = '';

    // Enable Vitest fake timers
    vi.useFakeTimers();

    // Instantiate fresh detector
    detector = new InstagramReelDetector();
    detector.init();
  });

  afterEach(() => {
    detector.destroy();
    MockIntersectionObserver.reset();
    MockIntersectionObserver.uninstall();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // ============================================================================
  // CONSTANTS SANITY CHECK
  // ============================================================================
  describe('Constants Configuration', () => {
    it('declares correct dwell threshold of 1500ms', () => {
      expect(DWELL_THRESHOLD_MS).toBe(1500);
    });

    it('declares correct visibility ratio threshold of 0.60 (60%)', () => {
      expect(VISIBILITY_THRESHOLD_RATIO).toBe(0.60);
    });
  });

  // ============================================================================
  // DOM EXTRACTION UNIT SUITE
  // ============================================================================
  describe('DOM Extraction: extractReelShortcode', () => {
    it('extracts Base64 shortcode from feed reel permalink (/reel/<shortcode>/)', () => {
      const fixture = createFeedReelFixture('C8xYz_123');
      const shortcode = extractReelShortcode(fixture.video);
      expect(shortcode).toBe('C8xYz_123');
    });

    it('extracts Base64 shortcode from dedicated reels link (/reels/<shortcode>/)', () => {
      const fixture = createDedicatedReelFixture('D9kPm_456');
      const shortcode = extractReelShortcode(fixture.video);
      expect(shortcode).toBe('D9kPm_456');
    });

    it('extracts shortcode from window.location.pathname fallback', () => {
      window.location.pathname = '/reel/LOC_PATH_789/';
      const video = createMockVideo();
      document.body.appendChild(video);

      const shortcode = extractReelShortcode(video, window.location.pathname);
      expect(shortcode).toBe('LOC_PATH_789');
    });

    it('extracts feed video post fallback (/p/<id>/) with "p_" prefix', () => {
      const article = document.createElement('article');
      const video = createMockVideo();
      article.appendChild(video);

      const anchor = document.createElement('a');
      anchor.setAttribute('href', '/p/FEED_POST_001/');
      article.appendChild(anchor);

      const shortcode = extractReelShortcode(video);
      expect(shortcode).toBe('p_FEED_POST_001');
    });

    it('returns null when anchor is missing or corrupt', () => {
      const corrupted = createCorruptedReelFixture();
      const shortcode = extractReelShortcode(corrupted.video);
      expect(shortcode).toBeNull();
    });

    it('handles query parameters and trailing slashes safely', () => {
      const article = document.createElement('article');
      const video = createMockVideo();
      article.appendChild(video);

      const anchor = document.createElement('a');
      anchor.setAttribute('href', '/reel/QUERY_PARAM_REEL/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==');
      article.appendChild(anchor);

      const shortcode = extractReelShortcode(video);
      expect(shortcode).toBe('QUERY_PARAM_REEL');
    });

    it('returns null when video is null or not in a reel/post container', () => {
      expect(extractReelShortcode(null)).toBeNull();

      const sideDiv = document.createElement('div');
      const video = createMockVideo();
      sideDiv.appendChild(video);
      document.body.appendChild(sideDiv);

      expect(extractReelShortcode(video)).toBeNull();
    });
  });

  // ============================================================================
  // SCENARIO TEST CASES (TC-01 to TC-10)
  // ============================================================================

  describe('TC-01: Standard feed reel view', () => {
    it('qualifies reel view after >= 60% visibility and >= 1.5s playback, dispatching RECORD_VIEW', async () => {
      const fixture = createFeedReelFixture('TC01_FEED_REEL');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      // Play video
      await fixture.video.play();

      // Simulate viewport intersection at 65% (>= 60%)
      MockIntersectionObserver.simulate(fixture.video, 0.65, true);

      expect(detector.isDwellActive(fixture.video)).toBe(true);

      // Advance time by 1600ms (exceeding 1500ms threshold)
      await vi.advanceTimersByTimeAsync(1600);

      // Verify session seen set updated
      expect(detector.getSessionSeen().has('TC01_FEED_REEL')).toBe(true);

      // Verify RECORD_VIEW dispatched via chrome.runtime.sendMessage
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message).toEqual(
        expect.objectContaining({
          type: 'RECORD_VIEW',
          platform: 'instagram',
          id: 'TC01_FEED_REEL'
        })
      );
    });
  });

  describe('TC-02: Rapid scrolling skip (<1.5s visibility)', () => {
    it('aborts dwell timer and records zero counts when scrolled out before 1.5s', async () => {
      const fixture = createFeedReelFixture('TC02_RAPID_SKIP');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.7, true);
      expect(detector.isDwellActive(fixture.video)).toBe(true);

      // User scrolls past after 500ms (< 1500ms)
      await vi.advanceTimersByTimeAsync(500);

      // Element leaves viewport: ratio drops to 0.1 (< 60%)
      MockIntersectionObserver.simulate(fixture.video, 0.1, false);

      expect(detector.isDwellActive(fixture.video)).toBe(false);

      // Advance past the remaining duration
      await vi.advanceTimersByTimeAsync(2000);

      // Zero counts recorded
      expect(detector.getSessionSeen().has('TC02_RAPID_SKIP')).toBe(false);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(0);
    });
  });

  describe('TC-03: Reel loop playback (5 continuous loops)', () => {
    it('increments count exactly once when video loops 5 times in continuous session', async () => {
      const fixture = createFeedReelFixture('TC03_LOOP_REEL');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.8, true);

      // Initial qualification at 1.6s
      await vi.advanceTimersByTimeAsync(1600);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);

      // Video loops 5 times
      for (let i = 1; i <= 5; i++) {
        fixture.video.simulateLoop();
        await vi.advanceTimersByTimeAsync(5000);
      }

      // Assert STRICTLY 1 dispatch occurred despite 5 loops
      expect(detector.getSessionSeen().has('TC03_LOOP_REEL')).toBe(true);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);
    });
  });

  describe('TC-04: Scroll away and scroll back (same shortcode in session)', () => {
    it('deduplicates re-scrolled reel and does not increment counter again', async () => {
      const fixtureA = createFeedReelFixture('TC04_REEL_A');
      const fixtureB = createFeedReelFixture('TC04_REEL_B');
      document.body.appendChild(fixtureA.article);
      document.body.appendChild(fixtureB.article);

      detector.observeVideo(fixtureA.video);
      detector.observeVideo(fixtureB.video);

      // 1. Watch Reel A
      await fixtureA.video.play();
      MockIntersectionObserver.simulate(fixtureA.video, 0.8, true);
      await vi.advanceTimersByTimeAsync(1600);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);

      // 2. Scroll away from Reel A to Reel B
      MockIntersectionObserver.simulate(fixtureA.video, 0.0, false);
      await fixtureB.video.play();
      MockIntersectionObserver.simulate(fixtureB.video, 0.8, true);
      await vi.advanceTimersByTimeAsync(1600);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(2);

      // 3. Scroll back up to Reel A and watch for 3s
      MockIntersectionObserver.simulate(fixtureB.video, 0.0, false);
      MockIntersectionObserver.simulate(fixtureA.video, 0.8, true);
      await vi.advanceTimersByTimeAsync(3000);

      // Total dispatches MUST remain exactly 2 (A and B once each)
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(2);
      expect(mockChrome.runtime.sendMessageCalls.map((c) => c.message.id)).toEqual([
        'TC04_REEL_A',
        'TC04_REEL_B'
      ]);
    });
  });

  describe('TC-05: Dedicated reel page navigation (/reel/XYZ123/)', () => {
    it('extracts shortcode and records view on dedicated /reel/ route', async () => {
      window.location.pathname = '/reel/XYZ123/';
      const fixture = createDedicatedReelFixture('XYZ123');
      document.body.appendChild(fixture.container);
      detector.observeVideo(fixture.video);

      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 1.0, true);

      await vi.advanceTimersByTimeAsync(1600);

      expect(detector.getSessionSeen().has('XYZ123')).toBe(true);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe('XYZ123');
    });
  });

  describe('TC-06: Tab visibility change (background tab aborts dwell timer)', () => {
    it('aborts dwell timer when tab hides and only qualifies upon return and full dwell', async () => {
      const fixture = createFeedReelFixture('TC06_TAB_VISIBILITY');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.8, true);

      // Play for 800ms (of required 1500ms)
      await vi.advanceTimersByTimeAsync(800);
      expect(detector.isDwellActive(fixture.video)).toBe(true);

      // User switches to background tab
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      // Dwell timer MUST be aborted
      expect(detector.isDwellActive(fixture.video)).toBe(false);

      // Video continues playing in background for 5000ms
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(0);

      // User switches back to tab
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      // Re-trigger playback event
      fixture.video.dispatchEvent(new Event('playing'));
      expect(detector.isDwellActive(fixture.video)).toBe(true);

      // Advance full 1600ms while visible
      await vi.advanceTimersByTimeAsync(1600);

      expect(detector.getSessionSeen().has('TC06_TAB_VISIBILITY')).toBe(true);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);
    });
  });

  describe('TC-07: Static photo posts in feed (no video)', () => {
    it('completely ignores static photo posts without creating timers or dispatching messages', async () => {
      const imagePost = createImagePostFixture('PHOTO_999');
      document.body.appendChild(imagePost);

      // Simulate observer trigger on image article
      MockIntersectionObserver.simulate(imagePost, 1.0, true);

      await vi.advanceTimersByTimeAsync(5000);

      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(0);
      expect(detector.getSessionSeen().size).toBe(0);
    });
  });

  describe('TC-08: Video paused by user before 1.5s', () => {
    it('cancels dwell timer on video pause and records zero increments', async () => {
      const fixture = createFeedReelFixture('TC08_PAUSED_REEL');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.8, true);

      // Plays for 1000ms (< 1500ms)
      await vi.advanceTimersByTimeAsync(1000);
      expect(detector.isDwellActive(fixture.video)).toBe(true);

      // User pauses video
      fixture.video.pause();
      expect(detector.isDwellActive(fixture.video)).toBe(false);

      // Time elapses while paused
      await vi.advanceTimersByTimeAsync(3000);

      expect(detector.getSessionSeen().has('TC08_PAUSED_REEL')).toBe(false);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(0);
    });
  });

  describe('TC-09: Corrupted or missing anchor link', () => {
    it('gracefully handles missing shortcode link without throwing unhandled exceptions', async () => {
      const corrupted = createCorruptedReelFixture();
      document.body.appendChild(corrupted.article);
      detector.observeVideo(corrupted.video);

      await corrupted.video.play();
      MockIntersectionObserver.simulate(corrupted.video, 0.9, true);

      // Should not start dwell because shortcode cannot be extracted
      expect(detector.isDwellActive(corrupted.video)).toBe(false);

      await vi.advanceTimersByTimeAsync(2000);

      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(0);
    });
  });

  describe('TC-10: React virtual DOM node recycling/re-rendering in feed', () => {
    it('handles article re-renders and virtual node recycling accurately', async () => {
      const feed = createRecycledFeedContainer();
      document.body.appendChild(feed.container);

      // 1. Initial reel mounted and viewed
      const reel1 = createFeedReelFixture('REEL_RECYCLED_1');
      feed.mountArticle(reel1);
      detector.observeVideo(reel1.video);

      await reel1.video.play();
      MockIntersectionObserver.simulate(reel1.video, 0.8, true);
      await vi.advanceTimersByTimeAsync(1600);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);

      // 2. React virtual list recycles the article node for a new shortcode
      feed.unmountArticle(reel1);

      const reel2 = createFeedReelFixture('REEL_RECYCLED_2');
      feed.mountArticle(reel2);
      detector.observeVideo(reel2.video);

      await reel2.video.play();
      MockIntersectionObserver.simulate(reel2.video, 0.8, true);
      await vi.advanceTimersByTimeAsync(1600);

      // Both reels counted once each
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(2);
      expect(mockChrome.runtime.sendMessageCalls.map((c) => c.message.id)).toEqual([
        'REEL_RECYCLED_1',
        'REEL_RECYCLED_2'
      ]);
    });
  });

  // ============================================================================
  // ADDITIONAL ROBUSTNESS & EDGE CASE TESTS
  // ============================================================================
  describe('Robustness & Edge Cases', () => {
    it('cancels dwell timer when video stalls/buffers (waiting event or readyState < 2)', async () => {
      const fixture = createFeedReelFixture('STALL_TEST_REEL');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.8, true);
      await vi.advanceTimersByTimeAsync(500);
      expect(detector.isDwellActive(fixture.video)).toBe(true);

      // Video stalls due to network buffering
      fixture.video.simulateStall();
      expect(detector.isDwellActive(fixture.video)).toBe(false);

      await vi.advanceTimersByTimeAsync(3000);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(0);
      expect(detector.getSessionSeen().has('STALL_TEST_REEL')).toBe(false);
    });

    it('clears active timers and seen set on resetSession()', async () => {
      const fixture = createFeedReelFixture('RESET_SESSION_REEL');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.8, true);
      await vi.advanceTimersByTimeAsync(1600);

      expect(detector.getSessionSeen().has('RESET_SESSION_REEL')).toBe(true);

      // Reset session
      detector.resetSession();
      expect(detector.getSessionSeen().size).toBe(0);

      // Can be counted again in new session
      MockIntersectionObserver.simulate(fixture.video, 0.8, true);
      await vi.advanceTimersByTimeAsync(1600);

      expect(detector.getSessionSeen().has('RESET_SESSION_REEL')).toBe(true);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(2);
    });

    it('sub-60% intersection ratio (e.g. 50%) does not qualify view', async () => {
      const fixture = createFeedReelFixture('SUB_60_REEL');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.50, false);

      expect(detector.isDwellActive(fixture.video)).toBe(false);

      await vi.advanceTimersByTimeAsync(2000);
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(0);
    });

    it('carousel post with multiple videos shares single parent shortcode and counts once', async () => {
      const article = document.createElement('article');
      article.setAttribute('role', 'presentation');

      const anchor = document.createElement('a');
      anchor.setAttribute('href', '/reel/CAROUSEL_REEL_ABC/');
      article.appendChild(anchor);

      const video1 = createMockVideo();
      const video2 = createMockVideo();
      article.appendChild(video1);
      article.appendChild(video2);
      document.body.appendChild(article);

      detector.observeVideo(video1);
      detector.observeVideo(video2);

      // Play video 1
      await video1.play();
      MockIntersectionObserver.simulate(video1, 0.8, true);
      await vi.advanceTimersByTimeAsync(1600);

      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);

      // User swipes to video 2 in same post
      await video2.play();
      MockIntersectionObserver.simulate(video2, 0.8, true);
      await vi.advanceTimersByTimeAsync(1600);

      // Total calls must still be 1 (deduplicated by shortcode)
      expect(mockChrome.runtime.sendMessageCalls).toHaveLength(1);
      expect(detector.getSessionSeen().has('CAROUSEL_REEL_ABC')).toBe(true);
    });

    it('createInstagramDetector factory returns controller implementing expected interface', async () => {
      const controller = createInstagramDetector(mockChrome, window, document);
      expect(typeof controller.extractShortcode).toBe('function');
      expect(typeof controller.handleIntersection).toBe('function');
      expect(typeof controller.handlePlaybackChange).toBe('function');
      expect(typeof controller.cancelDwell).toBe('function');
      expect(typeof controller.isDwellActive).toBe('function');
      expect(typeof controller.getSessionSeen).toBe('function');
      expect(typeof controller.resetSession).toBe('function');
      expect(typeof controller.destroy).toBe('function');
      expect(controller.detector).toBeInstanceOf(InstagramReelDetector);
      controller.destroy();
    });
  });
});

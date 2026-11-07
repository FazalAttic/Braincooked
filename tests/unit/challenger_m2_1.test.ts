/**
 * tests/unit/challenger_m2_1.test.ts
 * Challenger M2-1 Empirical Adversarial Stress & Verification Suite:
 * - Suite 1: Rapid scrolling stress (100 consecutive feed videos flicked past rapidly < 1500ms => 0 views)
 * - Suite 2: Loop playback stress (Reel looping 10 consecutive times => strictly 1 view)
 * - Suite 3: Virtual list DOM recycling stress (Re-using identical article & video nodes for 50 distinct reels => 50 views)
 * - Suite 4: Adversarial Temporal, Spatial, & Visibility Interruption Stress (Flapping play/pause, sub-60% intersection flapping, background tab hiding, scrubbing/seeking, network buffering/stalls, DOM detachment)
 * - Suite 5: Session Lifecycle & High-Volume Rapid Burst Stress (500 flicks, resetSession under active dwell)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockChrome } from '../mocks/chrome';
import { MockIntersectionObserver } from '../mocks/video';
import {
  createFeedReelFixture,
  createDedicatedReelFixture,
  createRecycledFeedContainer
} from '../mocks/dom';
import { InstagramReelDetector } from '../../src/content/instagram';

describe('Challenger M2-1: Empirical Adversarial Stress Suite (Instagram Detection & Deduplication)', () => {
  let detector: InstagramReelDetector;

  beforeEach(() => {
    mockChrome.resetAll();
    MockIntersectionObserver.install();
    MockIntersectionObserver.reset();

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true
    });

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

    document.body.innerHTML = '';
    vi.useFakeTimers();

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

  // ==========================================================================
  // SUITE 1: RAPID SCROLLING STRESS (100 consecutive flicks past < 1500ms)
  // ==========================================================================
  describe('Suite 1: Rapid Scrolling Stress (100 consecutive feed videos < 1500ms)', () => {
    it('records ZERO views when 100 consecutive feed videos are flicked past between 200ms and 800ms', async () => {
      const TOTAL_FLICKS = 100;
      const feed = createRecycledFeedContainer();
      document.body.appendChild(feed.container);

      for (let i = 1; i <= TOTAL_FLICKS; i++) {
        const shortcode = `FLICK_REEL_${String(i).padStart(3, '0')}`;
        const fixture = createFeedReelFixture(shortcode);
        feed.mountArticle(fixture);
        detector.observeVideo(fixture.video);

        // Start playback
        await fixture.video.play();

        // Intersect viewport above 60% threshold (e.g. 75% to 90%)
        const ratio = 0.70 + ((i % 5) * 0.05);
        MockIntersectionObserver.simulate(fixture.video, ratio, true);

        expect(detector.isDwellActive(fixture.video)).toBe(true);

        // Dwell between 200ms and 800ms (strictly < 1500ms)
        const dwellTime = 200 + ((i * 37) % 600); // 200ms to 799ms
        await vi.advanceTimersByTimeAsync(dwellTime);

        // User flicks past: intersection drops to 0
        MockIntersectionObserver.simulate(fixture.video, 0.0, false);
        expect(detector.isDwellActive(fixture.video)).toBe(false);

        // Feed unmounts article as it scrolls out of view
        feed.unmountArticle(fixture);
        detector.unobserveVideo(fixture.video);

        // Slight micro-pause between reels (e.g. 50ms)
        await vi.advanceTimersByTimeAsync(50);
      }

      // Advance by extra 5000ms to ensure no deferred timer fires
      await vi.advanceTimersByTimeAsync(5000);

      // Empirical Assertions
      expect(detector.getSessionSeen().size).toBe(0);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
    });

    it('records ZERO views when 100 pre-rendered feed videos are flicked past without unmounting', async () => {
      const TOTAL_VIDEOS = 100;
      const fixtures = [];

      // Mount all 100 articles in the DOM feed
      for (let i = 1; i <= TOTAL_VIDEOS; i++) {
        const fixture = createFeedReelFixture(`PRELOAD_FLICK_${i}`);
        document.body.appendChild(fixture.article);
        detector.observeVideo(fixture.video);
        fixtures.push(fixture);
      }

      for (let i = 0; i < TOTAL_VIDEOS; i++) {
        const current = fixtures[i];
        await current.video.play();
        MockIntersectionObserver.simulate(current.video, 0.85, true);
        expect(detector.isDwellActive(current.video)).toBe(true);

        // Visible for 600ms
        await vi.advanceTimersByTimeAsync(600);

        // Scrolls out
        MockIntersectionObserver.simulate(current.video, 0.0, false);
        expect(detector.isDwellActive(current.video)).toBe(false);
      }

      await vi.advanceTimersByTimeAsync(5000);

      expect(detector.getSessionSeen().size).toBe(0);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
    });

    it('rigorously tests exact dwell boundary: 1450ms (fail) vs 1550ms (qualify)', async () => {
      // Sub-threshold reel: 1450ms
      const nearMissFixture = createFeedReelFixture('BOUNDARY_NEAR_MISS_1450');
      document.body.appendChild(nearMissFixture.article);
      detector.observeVideo(nearMissFixture.video);

      await nearMissFixture.video.play();
      MockIntersectionObserver.simulate(nearMissFixture.video, 0.8, true);
      await vi.advanceTimersByTimeAsync(1450); // 50ms short of 1500ms threshold

      // Scroll away
      MockIntersectionObserver.simulate(nearMissFixture.video, 0.1, false);
      expect(detector.isDwellActive(nearMissFixture.video)).toBe(false);

      await vi.advanceTimersByTimeAsync(2000);
      expect(detector.getSessionSeen().has('BOUNDARY_NEAR_MISS_1450')).toBe(false);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);

      // Threshold-qualifying reel: 1550ms
      const qualifyingFixture = createFeedReelFixture('BOUNDARY_QUALIFIED_1550');
      document.body.appendChild(qualifyingFixture.article);
      detector.observeVideo(qualifyingFixture.video);

      await qualifyingFixture.video.play();
      MockIntersectionObserver.simulate(qualifyingFixture.video, 0.8, true);
      await vi.advanceTimersByTimeAsync(1550);

      expect(detector.getSessionSeen().has('BOUNDARY_QUALIFIED_1550')).toBe(true);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe('BOUNDARY_QUALIFIED_1550');
    });
  });

  // ==========================================================================
  // SUITE 2: LOOP PLAYBACK STRESS (10 consecutive loops)
  // ==========================================================================
  describe('Suite 2: Loop Playback Stress (10 consecutive loops => strictly 1 view)', () => {
    it('counts strictly ONE view when a reel loops 10 times consecutively with varying durations', async () => {
      const fixture = createFeedReelFixture('LOOP_STRESS_REEL_10X');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.9, true);

      // Initial playback: qualifies at 1600ms
      await vi.advanceTimersByTimeAsync(1600);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      expect(detector.getSessionSeen().has('LOOP_STRESS_REEL_10X')).toBe(true);

      // Execute 10 consecutive loops
      for (let loop = 1; loop <= 10; loop++) {
        // simulateLoop triggers 'ended', resets currentTime, then triggers 'play' and 'playing'
        fixture.video.simulateLoop();

        // Advance random loop duration (e.g. 5s to 25s)
        const loopDuration = 5000 + (loop * 1500);
        fixture.video.simulateTimeUpdate(loopDuration / 1000);
        await vi.advanceTimersByTimeAsync(loopDuration);

        // Verify invariant: STILL strictly 1 message dispatched
        expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
        expect(detector.isDwellActive(fixture.video)).toBe(false);
      }

      // Assert final state after 10 loops
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      expect(detector.getSessionSeen().size).toBe(1);
    });

    it('tracks 5 distinct reels, each looping 5 times, correctly recording exactly 5 views', async () => {
      const REEL_COUNT = 5;
      const LOOPS_PER_REEL = 5;

      for (let r = 1; r <= REEL_COUNT; r++) {
        const shortcode = `MULTI_LOOP_REEL_${r}`;
        const fixture = createFeedReelFixture(shortcode);
        document.body.appendChild(fixture.article);
        detector.observeVideo(fixture.video);

        await fixture.video.play();
        MockIntersectionObserver.simulate(fixture.video, 0.8, true);

        // Qualify reel
        await vi.advanceTimersByTimeAsync(1600);
        expect(mockChrome.runtime.sendMessageCalls.length).toBe(r);

        // Loop 5 times
        for (let l = 1; l <= LOOPS_PER_REEL; l++) {
          fixture.video.simulateLoop();
          await vi.advanceTimersByTimeAsync(4000);
        }

        expect(mockChrome.runtime.sendMessageCalls.length).toBe(r);

        // User scrolls to next reel
        MockIntersectionObserver.simulate(fixture.video, 0.0, false);
        fixture.article.remove();
        detector.unobserveVideo(fixture.video);
      }

      expect(mockChrome.runtime.sendMessageCalls.length).toBe(5);
      expect(detector.getSessionSeen().size).toBe(5);
    });
  });

  // ==========================================================================
  // SUITE 3: VIRTUAL LIST DOM RECYCLING STRESS (50 reels on recycled nodes)
  // ==========================================================================
  describe('Suite 3: Virtual List DOM Recycling Stress (Re-using DOM nodes for 50 distinct reels)', () => {
    it('qualifies and counts all 50 distinct reels using the EXACT SAME <article> and <video> DOM elements', async () => {
      const TOTAL_REELS = 50;

      // Create a single persistent <article> and <video>
      const baseFixture = createFeedReelFixture('RECYCLED_INIT');
      document.body.appendChild(baseFixture.article);
      detector.observeVideo(baseFixture.video);

      for (let i = 1; i <= TOTAL_REELS; i++) {
        const shortcode = `RECYCLED_REEL_${String(i).padStart(3, '0')}`;

        // 1. Mutate existing anchor href in-place to new shortcode (simulating React virtual list prop update)
        baseFixture.anchor.setAttribute('href', `/reel/${shortcode}/`);

        // 2. Simulate video stream update: triggers play
        await baseFixture.video.play();

        // 3. Ensure intersection ratio is qualified
        MockIntersectionObserver.simulate(baseFixture.video, 0.85, true);

        expect(detector.isDwellActive(baseFixture.video)).toBe(true);

        // 4. Advance time by 1600ms (exceeding 1500ms dwell threshold)
        await vi.advanceTimersByTimeAsync(1600);

        // 5. Verify reel was qualified and recorded
        expect(detector.getSessionSeen().has(shortcode)).toBe(true);
        expect(mockChrome.runtime.sendMessageCalls.length).toBe(i);
        expect(mockChrome.runtime.sendMessageCalls[i - 1].message.id).toBe(shortcode);

        // 6. Simulate scroll transition before next reel
        MockIntersectionObserver.simulate(baseFixture.video, 0.0, false);
        await vi.advanceTimersByTimeAsync(100);
      }

      // Assert final state
      expect(detector.getSessionSeen().size).toBe(50);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(50);

      // Verify all 50 shortcodes are present in exact order
      for (let i = 1; i <= TOTAL_REELS; i++) {
        const expectedId = `RECYCLED_REEL_${String(i).padStart(3, '0')}`;
        expect(mockChrome.runtime.sendMessageCalls[i - 1].message.id).toBe(expectedId);
      }
    });

    it('simulates a 3-slot virtual window recycling through 50 reels total', async () => {
      const TOTAL_REELS = 50;
      const WINDOW_SIZE = 3;

      // Create 3 reusable slots
      const slots = [];
      for (let s = 0; s < WINDOW_SIZE; s++) {
        const slot = createFeedReelFixture(`SLOT_${s}`);
        document.body.appendChild(slot.article);
        detector.observeVideo(slot.video);
        slots.push(slot);
      }

      for (let i = 0; i < TOTAL_REELS; i++) {
        const slotIndex = i % WINDOW_SIZE;
        const currentSlot = slots[slotIndex];
        const shortcode = `WINDOW_REEL_${i}`;

        // Update slot for this reel
        currentSlot.anchor.setAttribute('href', `/reel/${shortcode}/`);
        await currentSlot.video.play();
        MockIntersectionObserver.simulate(currentSlot.video, 0.9, true);

        await vi.advanceTimersByTimeAsync(1600);

        expect(detector.getSessionSeen().has(shortcode)).toBe(true);
        expect(mockChrome.runtime.sendMessageCalls.length).toBe(i + 1);

        // Scroll out
        MockIntersectionObserver.simulate(currentSlot.video, 0.0, false);
        await vi.advanceTimersByTimeAsync(50);
      }

      expect(detector.getSessionSeen().size).toBe(TOTAL_REELS);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(TOTAL_REELS);
    });

    it('correctly deduplicates recurring reels interleaved within a 50-item recycled virtual feed', async () => {
      // 50 total slots, but reel 'POPULAR_REEL_A' appears at index 5, 20, 35
      // and 'POPULAR_REEL_B' appears at index 10, 25, 40
      // 4 duplicates total => 46 unique reels expected
      const fixture = createFeedReelFixture('INIT');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      let expectedDispatches = 0;

      for (let i = 0; i < 50; i++) {
        let shortcode = `UNIQUE_REEL_${i}`;
        let isDuplicate = false;

        if (i === 5 || i === 20 || i === 35) {
          shortcode = 'POPULAR_REEL_A';
          isDuplicate = i !== 5;
        } else if (i === 10 || i === 25 || i === 40) {
          shortcode = 'POPULAR_REEL_B';
          isDuplicate = i !== 10;
        }

        fixture.anchor.setAttribute('href', `/reel/${shortcode}/`);
        await fixture.video.play();
        MockIntersectionObserver.simulate(fixture.video, 0.8, true);

        await vi.advanceTimersByTimeAsync(1600);

        if (!isDuplicate) {
          expectedDispatches++;
        }

        expect(mockChrome.runtime.sendMessageCalls.length).toBe(expectedDispatches);

        MockIntersectionObserver.simulate(fixture.video, 0.0, false);
        await vi.advanceTimersByTimeAsync(50);
      }

      // Expected: exactly 46 unique shortcodes dispatched
      expect(expectedDispatches).toBe(46);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(46);
      expect(detector.getSessionSeen().size).toBe(46);
    });
  });

  // ==========================================================================
  // SUITE 4: ADVERSARIAL TEMPORAL, SPATIAL, & VISIBILITY INTERRUPTION STRESS
  // ==========================================================================
  describe('Suite 4: Adversarial Temporal, Spatial, & Visibility Interruption Stress', () => {
    it('aborts dwell and records ZERO views during rapid play/pause flapping (cumulative 7.5s, max continuous 300ms)', async () => {
      const fixture = createFeedReelFixture('FLAPPING_PAUSE_REEL');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      MockIntersectionObserver.simulate(fixture.video, 0.8, true);

      // 25 cycles of 300ms play + 200ms pause = 7500ms total play time
      for (let cycle = 0; cycle < 25; cycle++) {
        await fixture.video.play();
        expect(detector.isDwellActive(fixture.video)).toBe(true);

        await vi.advanceTimersByTimeAsync(300);

        fixture.video.pause();
        expect(detector.isDwellActive(fixture.video)).toBe(false);

        await vi.advanceTimersByTimeAsync(200);
      }

      // Assert ZERO counts despite 7.5s cumulative play time
      expect(detector.getSessionSeen().has('FLAPPING_PAUSE_REEL')).toBe(false);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
    });

    it('records ZERO views when intersection ratio flaps across 0.60 threshold (0.58 vs 0.62)', async () => {
      const fixture = createFeedReelFixture('FLAPPING_RATIO_REEL');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      await fixture.video.play();

      // Oscillate across threshold every 500ms for 20 cycles (10 seconds total)
      for (let i = 0; i < 20; i++) {
        // Above threshold
        MockIntersectionObserver.simulate(fixture.video, 0.62, true);
        expect(detector.isDwellActive(fixture.video)).toBe(true);
        await vi.advanceTimersByTimeAsync(500);

        // Sub-threshold (0.58 < 0.60)
        MockIntersectionObserver.simulate(fixture.video, 0.58, false);
        expect(detector.isDwellActive(fixture.video)).toBe(false);
        await vi.advanceTimersByTimeAsync(500);
      }

      expect(detector.getSessionSeen().has('FLAPPING_RATIO_REEL')).toBe(false);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
    });

    it('completely suppresses background tab dwelling and requires fresh 1500ms visible dwell', async () => {
      const fixture = createFeedReelFixture('BACKGROUND_TAB_ATTACK');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.8, true);

      // Play visible for 1300ms (just 200ms shy of qualifying)
      await vi.advanceTimersByTimeAsync(1300);
      expect(detector.isDwellActive(fixture.video)).toBe(true);

      // User hides tab
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(detector.isDwellActive(fixture.video)).toBe(false);

      // Video continues playing in hidden tab for 30 seconds
      await vi.advanceTimersByTimeAsync(30000);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);

      // User returns to tab
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      // Fire playing event
      fixture.video.dispatchEvent(new Event('playing'));
      expect(detector.isDwellActive(fixture.video)).toBe(true);

      // Advance only 1000ms: must NOT qualify yet (cannot carry over previous 1300ms)
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);

      // Advance remaining 600ms (reaching 1600ms continuous dwell since visible return)
      await vi.advanceTimersByTimeAsync(600);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      expect(detector.getSessionSeen().has('BACKGROUND_TAB_ATTACK')).toBe(true);
    });

    it('aborts dwell and records ZERO views during repeated seeking, qualifying only after continuous playback', async () => {
      const fixture = createFeedReelFixture('SCRUBBING_SEEK_REEL');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.85, true);

      // Seek every 800ms for 10 iterations (8 seconds total seeking)
      for (let s = 1; s <= 10; s++) {
        await vi.advanceTimersByTimeAsync(800);
        fixture.video.simulateSeek(s * 2);
        // Seeking cancels dwell
        expect(detector.isDwellActive(fixture.video)).toBe(false);
        // Invariant: ZERO views qualified while actively scrubbing
        expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);

        // Resume playback after seek (starts new dwell)
        await fixture.video.play();
      }

      // At end of scrubbing, pause video: must still have ZERO views
      fixture.video.pause();
      await vi.advanceTimersByTimeAsync(3000);
      expect(detector.getSessionSeen().has('SCRUBBING_SEEK_REEL')).toBe(false);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);

      // Now resume and let play continuously for 1600ms without seeking
      await fixture.video.play();
      expect(detector.isDwellActive(fixture.video)).toBe(true);
      await vi.advanceTimersByTimeAsync(1600);

      // Now it must qualify exactly once
      expect(detector.getSessionSeen().has('SCRUBBING_SEEK_REEL')).toBe(true);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
    });

    it('cancels dwell when video experiences network buffering / stall', async () => {
      const fixture = createFeedReelFixture('BUFFERING_STALL_REEL');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.8, true);

      // Plays for 1200ms
      await vi.advanceTimersByTimeAsync(1200);
      expect(detector.isDwellActive(fixture.video)).toBe(true);

      // Network stalls
      fixture.video.simulateStall();
      expect(detector.isDwellActive(fixture.video)).toBe(false);

      // Stalled for 5 seconds
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);

      // Network recovers
      fixture.video.simulateReady();
      fixture.video.resume();
      expect(detector.isDwellActive(fixture.video)).toBe(true);

      // Full 1600ms required after recovery
      await vi.advanceTimersByTimeAsync(1600);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      expect(detector.getSessionSeen().has('BUFFERING_STALL_REEL')).toBe(true);
    });

    it('aborts view qualification if video node is unmounted / disconnected mid-dwell', async () => {
      const fixture = createFeedReelFixture('DISCONNECT_MID_DWELL');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.8, true);

      await vi.advanceTimersByTimeAsync(1000);
      expect(detector.isDwellActive(fixture.video)).toBe(true);

      // Disconnect video element from DOM tree
      fixture.article.remove();
      Object.defineProperty(fixture.video, 'isConnected', { value: false, configurable: true });

      // Advance remaining time
      await vi.advanceTimersByTimeAsync(1000);

      // Must NOT qualify disconnected node
      expect(detector.getSessionSeen().has('DISCONNECT_MID_DWELL')).toBe(false);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
    });
  });

  // ==========================================================================
  // SUITE 5: SESSION LIFECYCLE & HIGH-VOLUME RAPID BURST STRESS
  // ==========================================================================
  describe('Suite 5: Session Lifecycle & High-Volume Rapid Burst Stress', () => {
    it('cancels active dwell timers immediately on resetSession() and does not execute orphan callbacks', async () => {
      const fixture = createFeedReelFixture('ORPHAN_TIMER_TEST');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.8, true);

      await vi.advanceTimersByTimeAsync(1000);
      expect(detector.isDwellActive(fixture.video)).toBe(true);

      // Trigger resetSession
      detector.resetSession();
      expect(detector.isDwellActive(fixture.video)).toBe(false);
      expect(detector.getSessionSeen().size).toBe(0);

      // Advance past remaining time of original timer
      await vi.advanceTimersByTimeAsync(2000);

      // Invariant: no orphan message was dispatched
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
      expect(detector.getSessionSeen().size).toBe(0);
    });

    it('survives a high-volume burst of 500 rapid flick cycles without memory leaks or unhandled errors', async () => {
      const BURST_COUNT = 500;
      const fixture = createFeedReelFixture('BURST_TEST');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      for (let i = 0; i < BURST_COUNT; i++) {
        fixture.anchor.setAttribute('href', `/reel/BURST_REEL_${i}/`);
        await fixture.video.play();
        MockIntersectionObserver.simulate(fixture.video, 0.8, true);

        // Advance 100ms (< 1500ms)
        await vi.advanceTimersByTimeAsync(100);

        MockIntersectionObserver.simulate(fixture.video, 0.0, false);
      }

      await vi.advanceTimersByTimeAsync(3000);

      // Strict validation: ZERO views counted, zero active timers
      expect(detector.getSessionSeen().size).toBe(0);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
      expect(detector.isDwellActive(fixture.video)).toBe(false);
    });
  });

  // ==========================================================================
  // SUITE 6: SPA NAVIGATION, YO-YO FLICKING, MULTI-RATIO STAGGER & RESILIENCE
  // ==========================================================================
  describe('Suite 6: SPA Navigation, Yo-Yo Flicking, Multi-Ratio Stagger & Error Resilience', () => {
    it('handles rapid SPA navigation transitions across 10 dedicated reel pages', async () => {
      // Simulate dedicated reel viewer navigation
      for (let i = 1; i <= 10; i++) {
        const shortcode = `DEDICATED_SPA_${i}`;
        window.location.pathname = `/reel/${shortcode}/`;
        window.location.href = `https://www.instagram.com/reel/${shortcode}/`;

        const fixture = createDedicatedReelFixture(shortcode);
        document.body.innerHTML = '';
        document.body.appendChild(fixture.container);
        detector.observeVideo(fixture.video);

        // Trigger popstate
        window.dispatchEvent(new Event('popstate'));

        await fixture.video.play();
        MockIntersectionObserver.simulate(fixture.video, 1.0, true);

        // Dwell 1600ms
        await vi.advanceTimersByTimeAsync(1600);

        expect(detector.getSessionSeen().has(shortcode)).toBe(true);
        expect(mockChrome.runtime.sendMessageCalls.length).toBe(i);
        expect(mockChrome.runtime.sendMessageCalls[i - 1].message.id).toBe(shortcode);
      }

      expect(detector.getSessionSeen().size).toBe(10);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(10);
    });

    it('records ZERO views during rapid yo-yo scrolling back and forth between 2 reels (10 cycles of 700ms)', async () => {
      const fixtureA = createFeedReelFixture('YOYO_REEL_A');
      const fixtureB = createFeedReelFixture('YOYO_REEL_B');
      document.body.appendChild(fixtureA.article);
      document.body.appendChild(fixtureB.article);
      detector.observeVideo(fixtureA.video);
      detector.observeVideo(fixtureB.video);

      await fixtureA.video.play();
      await fixtureB.video.play();

      // 10 cycles alternating between A and B, 700ms each (< 1500ms)
      for (let c = 0; c < 10; c++) {
        // Reel A visible
        MockIntersectionObserver.simulate(fixtureB.video, 0.0, false);
        MockIntersectionObserver.simulate(fixtureA.video, 0.85, true);
        expect(detector.isDwellActive(fixtureA.video)).toBe(true);
        await vi.advanceTimersByTimeAsync(700);

        // Reel B visible
        MockIntersectionObserver.simulate(fixtureA.video, 0.0, false);
        MockIntersectionObserver.simulate(fixtureB.video, 0.85, true);
        expect(detector.isDwellActive(fixtureB.video)).toBe(true);
        await vi.advanceTimersByTimeAsync(700);
      }

      // User scrolls past both reels
      MockIntersectionObserver.simulate(fixtureB.video, 0.0, false);
      expect(detector.isDwellActive(fixtureB.video)).toBe(false);

      await vi.advanceTimersByTimeAsync(3000);

      // Invariant: ZERO views counted despite 7000ms total elapsed time on each
      expect(detector.getSessionSeen().has('YOYO_REEL_A')).toBe(false);
      expect(detector.getSessionSeen().has('YOYO_REEL_B')).toBe(false);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
    });

    it('qualifies ONLY the single video >= 60% in a multi-video feed layout with 5 staggered ratios', async () => {
      // 5 videos with ratios: 0.15, 0.35, 0.50, 0.59 (sub-threshold), and 0.65 (qualifying)
      const ratios = [0.15, 0.35, 0.50, 0.59, 0.65];
      const fixtures = [];

      for (let idx = 0; idx < ratios.length; idx++) {
        const fixture = createFeedReelFixture(`STAGGER_REEL_${idx}`);
        document.body.appendChild(fixture.article);
        detector.observeVideo(fixture.video);
        await fixture.video.play();
        MockIntersectionObserver.simulate(fixture.video, ratios[idx], ratios[idx] >= 0.60);
        fixtures.push(fixture);
      }

      // Check only index 4 (0.65) has active dwell
      expect(detector.isDwellActive(fixtures[0].video)).toBe(false);
      expect(detector.isDwellActive(fixtures[1].video)).toBe(false);
      expect(detector.isDwellActive(fixtures[2].video)).toBe(false);
      expect(detector.isDwellActive(fixtures[3].video)).toBe(false);
      expect(detector.isDwellActive(fixtures[4].video)).toBe(true);

      await vi.advanceTimersByTimeAsync(1600);

      // Strictly 1 message dispatched (for index 4)
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe('STAGGER_REEL_4');
      expect(detector.getSessionSeen().size).toBe(1);
    });

    it('resiliently handles extension context invalidation without throwing unhandled exceptions', async () => {
      // Mock chrome.runtime.sendMessage throwing "Extension context invalidated"
      mockChrome.runtime.sendMessage = vi.fn().mockRejectedValue(new Error('Extension context invalidated'));

      const fixture = createFeedReelFixture('CONTEXT_INVALIDATED_REEL');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.8, true);

      // Should advance timer and catch error inside onViewQualified without crashing
      await expect(vi.advanceTimersByTimeAsync(1600)).resolves.not.toThrow();

      // Reel was still added to session seen set to prevent retry loops
      expect(detector.getSessionSeen().has('CONTEXT_INVALIDATED_REEL')).toBe(true);
    });

    it('destroy() is idempotent and immediately cancels all timers and observers', async () => {
      const fixture = createFeedReelFixture('TEARDOWN_REEL');
      document.body.appendChild(fixture.article);
      detector.observeVideo(fixture.video);

      await fixture.video.play();
      MockIntersectionObserver.simulate(fixture.video, 0.8, true);
      expect(detector.isDwellActive(fixture.video)).toBe(true);

      // Call destroy
      detector.destroy();
      expect(detector.isDwellActive(fixture.video)).toBe(false);

      // Multiple destroy calls should not throw
      expect(() => detector.destroy()).not.toThrow();

      // Time advances: no messages
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
    });
  });
});

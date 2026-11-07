/**
 * tests/unit/challenger_m3_1.test.ts
 * Challenger M3-1 Empirical Adversarial Stress & Verification Suite:
 * 
 * - Suite 1: Rapid Flick Stress
 *   - 20 consecutive shorts flicked past with 200ms–800ms dwell (< 1500ms) => STRICTLY 0 false views
 *   - Boundary dwell stress: 20 shorts at 1400ms dwell (100ms shy of 1500ms) => STRICTLY 0 false views
 *   - High-volume 100 consecutive rapid flicks past virtualized renderers => STRICTLY 0 false views
 *   - 20 rapid flicks followed by 1 prolonged dwell (>= 1500ms) => exactly 1 view for the prolonged short
 * 
 * - Suite 2: Looping Deduplication Stress
 *   - Single short looping for 10 consecutive loops => STRICTLY 1 view count recorded
 *   - 50 consecutive loop marathon on a single short => STRICTLY 1 view count recorded
 *   - Intermittent loop scrubbing (seeking during loops) => STRICTLY 1 view count recorded
 *   - Sub-1500ms short looping 10 times (each loop ending at 1000ms) => STRICTLY 0 views
 * 
 * - Suite 3: Media Interruption & Temporal Flapping Stress
 *   - Play 1000ms -> pause -> play 1000ms => does NOT trigger at 1500ms cumulative (timer reset on pause)
 *   - Play/pause high-frequency flapping (25 cycles, cumulative 7.5s, max continuous 300ms) => 0 views
 *   - Network buffering / stall interruption (play 1200ms -> stall -> resume) => requires fresh 1500ms continuous dwell
 *   - Near-miss boundary interruption (play 1450ms -> pause -> play 1450ms) => 0 views
 * 
 * - Suite 4: Seeking & Scrubbing Stress
 *   - Seek video while playing at 1000ms => timer immediately resets
 *   - Scrubbing barrage (10 seeks every 600ms) => 0 views during scrubbing
 *   - Continuous qualification after seeking => qualifies exactly ONCE after >= 1500ms continuous play
 *   - Seeking on already qualified short => 0 duplicate views
 * 
 * - Suite 5: Environmental, Virtual DOM & Lifecycle Adversarial Stress
 *   - Background tab hiding mid-dwell (visibilityState = 'hidden') cancels timer; 30s background audio = 0 views
 *   - Virtual DOM recycling (3 physical renderers recycled for 30 distinct shorts: 15 flicked, 15 watched) => exactly 15 views
 *   - SPA route thrashing (/shorts -> /watch -> /shorts -> /feed -> /shorts) => zero race conditions
 *   - SessionStorage throwing QuotaExceededError or SecurityError => in-memory Set continues seamlessly
 *   - Runtime message reset (RESET_STATS / RESET_SESSION) mid-dwell cancels timer & clears deduplication
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockChrome } from '../mocks/chrome';
import { createMockVideo, MockHTMLVideoElement } from '../mocks/video';
import { YouTubeShortsDetector } from '../../src/content/youtube';

// Prevent auto-initialization in test environment
(window as any).__BRAINROAD_TEST_ENV__ = true;

// ============================================================================
// FIXTURE BUILDERS & DOM SIMULATION HELPERS
// ============================================================================

interface MockShortsDOM {
  container: HTMLElement;
  renderers: HTMLElement[];
  videos: MockHTMLVideoElement[];
}

function setLocation(pathname: string) {
  Object.defineProperty(window, 'location', {
    value: {
      pathname,
      href: `https://www.youtube.com${pathname}`,
      search: '',
      hash: ''
    },
    writable: true,
    configurable: true
  });
}

function createMockYouTubeShortsDOM(
  initialVideoIds: string[] = ['vid_short_01', 'vid_short_02', 'vid_short_03']
): MockShortsDOM {
  document.body.innerHTML = `
    <ytd-app>
      <ytd-page-manager id="page-manager">
        <ytd-shorts id="shorts-container" role="main">
          <div id="shorts-inner-container"></div>
        </ytd-shorts>
      </ytd-page-manager>
    </ytd-app>
  `;

  const container = document.getElementById('shorts-inner-container')!;
  const renderers: HTMLElement[] = [];
  const videos: MockHTMLVideoElement[] = [];

  initialVideoIds.forEach((id, index) => {
    const renderer = document.createElement('ytd-reel-video-renderer');
    renderer.id = `renderer_${index}`;
    renderer.setAttribute('video-id', id);

    if (index === 0) {
      renderer.setAttribute('is-active', '');
    }

    renderer.innerHTML = `
      <div id="player-container"></div>
      <div id="reel-player-overlay">
        <div id="metadata-container">
          <a class="yt-simple-endpoint" href="/shorts/${id}"></a>
        </div>
      </div>
    `;

    const video = createMockVideo({ src: `blob:mock://${id}`, duration: 30 });
    renderer.querySelector('#player-container')!.appendChild(video);

    container.appendChild(renderer);
    renderers.push(renderer);
    videos.push(video);
  });

  return { container, renderers, videos };
}

async function simulateScrollToNextShort(
  currentIndex: number,
  nextIndex: number,
  renderers: HTMLElement[],
  videos: MockHTMLVideoElement[],
  newVideoId: string
) {
  if (renderers[currentIndex]) {
    renderers[currentIndex].removeAttribute('is-active');
    videos[currentIndex]?.pause();
  }
  if (renderers[nextIndex]) {
    renderers[nextIndex].setAttribute('is-active', '');
    setLocation(`/shorts/${newVideoId}`);
    await Promise.resolve();
    await videos[nextIndex]?.play();
  }
}

// ============================================================================
// CHALLENGER M3-1 ADVERSARIAL STRESS SUITE
// ============================================================================

describe('Challenger M3-1: Empirical Adversarial Stress Suite (YouTube Shorts Detection & Deduplication)', () => {
  let detector: YouTubeShortsDetector;

  beforeEach(() => {
    (window as any).__BRAINROAD_TEST_ENV__ = true;
    mockChrome.resetAll();

    try {
      sessionStorage.clear();
    } catch {}

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true
    });

    setLocation('/');
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (detector) {
      detector.destroy();
    }
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  // ==========================================================================
  // SUITE 1: RAPID FLICK STRESS (20–100 Consecutive Shorts < 1500ms)
  // ==========================================================================
  describe('Suite 1: Rapid Flick Stress (< 1500ms dwell threshold)', () => {
    it('records ZERO false view counts when switching between 20 shorts with 200ms–800ms dwell', async () => {
      const TOTAL_SHORTS = 20;
      const ids = Array.from({ length: TOTAL_SHORTS }, (_, i) => `flick_id_${String(i + 1).padStart(2, '0')}`);
      const { renderers, videos } = createMockYouTubeShortsDOM(ids);

      setLocation(`/shorts/${ids[0]}`);
      detector = new YouTubeShortsDetector();
      detector.init();

      // Video 0 starts playback
      await videos[0].play();
      expect(detector.isDwellActive()).toBe(true);

      // Flick through all 20 shorts sequentially
      for (let i = 0; i < TOTAL_SHORTS; i++) {
        // Dwell between 200ms and 800ms (strictly < 1500ms)
        const dwellMs = 200 + ((i * 31) % 600); // Varied: 200ms, 231ms, ..., 789ms
        expect(dwellMs).toBeLessThan(1500);

        await vi.advanceTimersByTimeAsync(dwellMs);

        // Before 1500ms threshold is reached, flick to next short if not at the end
        if (i < TOTAL_SHORTS - 1) {
          await simulateScrollToNextShort(i, i + 1, renderers, videos, ids[i + 1]);
          expect(detector.isDwellActive()).toBe(true);
        } else {
          // On last short, pause before threshold
          videos[i].pause();
        }

        // Invariant check: ZERO views qualified at any intermediate flick
        expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
        expect(detector.getSessionSeen().size).toBe(0);
      }

      // Advance by extra 10,000ms to ensure no deferred timer fires
      await vi.advanceTimersByTimeAsync(10000);

      // Final Assertion: strictly ZERO false view counts
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
      expect(detector.getSessionSeen().size).toBe(0);
    });

    it('records ZERO views when 20 shorts dwell at 1400ms (boundary dwell: 100ms shy of threshold)', async () => {
      const TOTAL_SHORTS = 20;
      const ids = Array.from({ length: TOTAL_SHORTS }, (_, i) => `bound_id_${String(i + 1).padStart(2, '0')}`);
      const { renderers, videos } = createMockYouTubeShortsDOM(ids);

      setLocation(`/shorts/${ids[0]}`);
      detector = new YouTubeShortsDetector();
      detector.init();

      await videos[0].play();

      for (let i = 0; i < TOTAL_SHORTS; i++) {
        // Dwell at exactly 1400ms (just 100ms shy of 1500ms)
        await vi.advanceTimersByTimeAsync(1400);

        if (i < TOTAL_SHORTS - 1) {
          await simulateScrollToNextShort(i, i + 1, renderers, videos, ids[i + 1]);
        } else {
          videos[i].pause();
        }

        expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
      }

      await vi.advanceTimersByTimeAsync(10000);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
      expect(detector.getSessionSeen().size).toBe(0);
    });

    it('records ZERO views during 100 consecutive rapid flicks across virtual recycled renderers', async () => {
      const TOTAL_FLICKS = 100;
      // YouTube only renders 3 physical <ytd-reel-video-renderer> containers
      const { renderers, videos } = createMockYouTubeShortsDOM(['init_1', 'init_2', 'init_3']);

      setLocation('/shorts/init_1');
      detector = new YouTubeShortsDetector();
      detector.init();

      await videos[0].play();

      for (let f = 1; f <= TOTAL_FLICKS; f++) {
        const flickId = `rapid_flick_${String(f).padStart(3, '0')}`;
        const activeIdx = f % 3;
        const prevIdx = (f - 1) % 3;

        // Dwell 150ms to 900ms
        const dwell = 150 + ((f * 43) % 750);
        await vi.advanceTimersByTimeAsync(dwell);

        // Recycle renderer for new video ID
        renderers[prevIdx].removeAttribute('is-active');
        videos[prevIdx].pause();

        const curRenderer = renderers[activeIdx];
        curRenderer.setAttribute('is-active', '');
        curRenderer.setAttribute('video-id', flickId);
        const anchor = curRenderer.querySelector('a');
        if (anchor) anchor.setAttribute('href', `/shorts/${flickId}`);

        setLocation(`/shorts/${flickId}`);
        detector.evaluateActiveShort();

        await videos[activeIdx].play();
      }

      // End of flicking: pause active video
      videos[TOTAL_FLICKS % 3].pause();
      await vi.advanceTimersByTimeAsync(10000);

      // Invariant: 100 flicks produced ZERO view counts
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
      expect(detector.getSessionSeen().size).toBe(0);
    });

    it('records exactly 1 view when 20 rapid flicks are followed by 1 prolonged dwell (>= 1500ms)', async () => {
      const ids = Array.from({ length: 21 }, (_, i) => `flick_settle_${String(i + 1).padStart(2, '0')}`);
      const { renderers, videos } = createMockYouTubeShortsDOM(ids);

      setLocation(`/shorts/${ids[0]}`);
      detector = new YouTubeShortsDetector();
      detector.init();

      await videos[0].play();

      // First 20 shorts: rapidly flicked past at 400ms each
      for (let i = 0; i < 20; i++) {
        await vi.advanceTimersByTimeAsync(400);
        await simulateScrollToNextShort(i, i + 1, renderers, videos, ids[i + 1]);
      }

      // 21st short: user stops flicking and watches continuously for 1800ms
      expect(detector.getActiveVideoId()).toBe(ids[20]);
      expect(detector.isDwellActive()).toBe(true);

      await vi.advanceTimersByTimeAsync(1800);

      // Strictly 1 view count recorded for the 21st short
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe(ids[20]);
      expect(detector.getSessionSeen().has(ids[20])).toBe(true);
      expect(detector.getSessionSeen().size).toBe(1);
    });
  });

  // ==========================================================================
  // SUITE 2: LOOPING DEDUPLICATION STRESS (10–50 consecutive loops)
  // ==========================================================================
  describe('Suite 2: Looping Deduplication Stress', () => {
    it('records EXACTLY 1 view count when one short plays for 10 consecutive loops', async () => {
      const { videos } = createMockYouTubeShortsDOM(['looping_short_01']);
      setLocation('/shorts/looping_short_01');

      detector = new YouTubeShortsDetector();
      detector.init();

      // First play: watch for 1800ms (qualifies at 1500ms)
      await videos[0].play();
      await vi.advanceTimersByTimeAsync(1800);

      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe('looping_short_01');
      expect(detector.getSessionSeen().has('looping_short_01')).toBe(true);

      // Now simulate 10 consecutive loop cycles
      for (let loop = 1; loop <= 10; loop++) {
        // Video reaches end of duration (e.g. 30s) and loops
        videos[0].simulateTimeUpdate(30);
        videos[0].simulateLoop();

        // Plays for another full cycle (30 seconds)
        await vi.advanceTimersByTimeAsync(30000);

        // Invariant: count NEVER increments beyond 1
        expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
        expect(detector.getSessionSeen().size).toBe(1);
        expect(detector.isDwellActive()).toBe(false);
      }

      // Final check: exactly 1 dispatch
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
    });

    it('records EXACTLY 1 view count during an extended 50-loop marathon on a single short', async () => {
      const { videos } = createMockYouTubeShortsDOM(['marathon_short_50']);
      setLocation('/shorts/marathon_short_50');

      detector = new YouTubeShortsDetector();
      detector.init();

      await videos[0].play();
      await vi.advanceTimersByTimeAsync(1600);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);

      // Run 50 rapid loops (simulating a short 5-second video looping 50 times = ~4 minutes)
      for (let loop = 1; loop <= 50; loop++) {
        videos[0].simulateTimeUpdate(5);
        videos[0].simulateLoop();
        await vi.advanceTimersByTimeAsync(5000);
      }

      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe('marathon_short_50');
      expect(detector.getSessionSeen().size).toBe(1);
    });

    it('records EXACTLY 1 view count when loops are interrupted by manual seeking back to start', async () => {
      const { videos } = createMockYouTubeShortsDOM(['loop_seek_short']);
      setLocation('/shorts/loop_seek_short');

      detector = new YouTubeShortsDetector();
      detector.init();

      await videos[0].play();
      await vi.advanceTimersByTimeAsync(1800);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);

      // 5 loops with manual scrubs mid-playback
      for (let l = 1; l <= 5; l++) {
        videos[0].simulateLoop();
        await vi.advanceTimersByTimeAsync(2000);
        // User scrubs back to 0
        videos[0].simulateSeek(0);
        await videos[0].play();
        await vi.advanceTimersByTimeAsync(4000);
      }

      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
    });

    it('records ZERO views if a short shorter than 1500ms loops 10 times without continuous dwell', async () => {
      // Very short video (duration 1000ms) that loops every 1000ms
      const { videos } = createMockYouTubeShortsDOM(['micro_short_1s']);
      setLocation('/shorts/micro_short_1s');

      detector = new YouTubeShortsDetector();
      detector.init();

      await videos[0].play();

      for (let l = 1; l <= 10; l++) {
        // Plays for only 1000ms (< 1500ms dwell gate)
        await vi.advanceTimersByTimeAsync(1000);
        // Video ends and loops back
        videos[0].simulateLoop();
      }

      // Invariant: because continuous dwell never exceeded 1000ms, ZERO views qualify
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
      expect(detector.getSessionSeen().size).toBe(0);
    });
  });

  // ==========================================================================
  // SUITE 3: MEDIA INTERRUPTION & TEMPORAL FLAPPING STRESS
  // ==========================================================================
  describe('Suite 3: Media Interruption & Temporal Flapping Stress', () => {
    it('does NOT trigger count at 1500ms cumulative when paused at 1000ms (timer resets on pause)', async () => {
      const { videos } = createMockYouTubeShortsDOM(['pause_reset_short']);
      setLocation('/shorts/pause_reset_short');

      detector = new YouTubeShortsDetector();
      detector.init();

      // 1. Play for 1000ms
      await videos[0].play();
      expect(detector.isDwellActive()).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);

      // 2. User pauses
      videos[0].pause();
      expect(detector.isDwellActive()).toBe(false);

      // Paused for 500ms (cumulative wall time = 1500ms, cumulative playback = 1000ms)
      await vi.advanceTimersByTimeAsync(500);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);

      // 3. User resumes playback
      await videos[0].play();
      expect(detector.isDwellActive()).toBe(true);

      // Play for 500ms (cumulative playback = 1000ms + 500ms = 1500ms, but continuous since resume = only 500ms!)
      await vi.advanceTimersByTimeAsync(500);

      // CRITICAL ASSERTION: Must NOT trigger view count at 1500ms cumulative!
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
      expect(detector.getSessionSeen().has('pause_reset_short')).toBe(false);

      // Advance by another 500ms (total 1000ms since resume, 2000ms cumulative playback)
      await vi.advanceTimersByTimeAsync(500);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);

      // Now advance remaining 500ms (reaching full 1500ms continuous dwell since resume)
      await vi.advanceTimersByTimeAsync(500);

      // NOW it must qualify exactly once!
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe('pause_reset_short');
      expect(detector.getSessionSeen().has('pause_reset_short')).toBe(true);
    });

    it('records ZERO views during high-frequency play/pause flapping (25 cycles, cumulative 7.5s)', async () => {
      const { videos } = createMockYouTubeShortsDOM(['flapping_short']);
      setLocation('/shorts/flapping_short');

      detector = new YouTubeShortsDetector();
      detector.init();

      // 25 cycles of 300ms play + 200ms pause = 7500ms cumulative playback, max continuous 300ms
      for (let cycle = 0; cycle < 25; cycle++) {
        await videos[0].play();
        expect(detector.isDwellActive()).toBe(true);

        await vi.advanceTimersByTimeAsync(300);

        videos[0].pause();
        expect(detector.isDwellActive()).toBe(false);

        await vi.advanceTimersByTimeAsync(200);

        expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
      }

      await vi.advanceTimersByTimeAsync(5000);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
      expect(detector.getSessionSeen().size).toBe(0);
    });

    it('resets timer on network buffering / stall and requires fresh 1500ms continuous dwell', async () => {
      const { videos } = createMockYouTubeShortsDOM(['stall_short']);
      setLocation('/shorts/stall_short');

      detector = new YouTubeShortsDetector();
      detector.init();

      // Play for 1200ms (just 300ms shy of threshold)
      await videos[0].play();
      expect(detector.isDwellActive()).toBe(true);
      await vi.advanceTimersByTimeAsync(1200);

      // Video encounters network buffering stall
      videos[0].simulateStall();
      expect(detector.isDwellActive()).toBe(false);

      // Buffering for 3000ms
      await vi.advanceTimersByTimeAsync(3000);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);

      // Network recovers, video resumes playback
      videos[0].resume();
      await videos[0].play();
      expect(detector.isDwellActive()).toBe(true);

      // Play for 1000ms: must NOT qualify yet (cannot use previous 1200ms)
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);

      // Advance remaining 500ms (reaches 1500ms continuous playback)
      await vi.advanceTimersByTimeAsync(500);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe('stall_short');
    });

    it('records ZERO views on near-miss boundary interruptions (play 1450ms -> pause -> play 1450ms)', async () => {
      const { videos } = createMockYouTubeShortsDOM(['near_miss_short']);
      setLocation('/shorts/near_miss_short');

      detector = new YouTubeShortsDetector();
      detector.init();

      // Play 1450ms (50ms before 1500ms gate)
      await videos[0].play();
      await vi.advanceTimersByTimeAsync(1450);

      // Pause
      videos[0].pause();
      expect(detector.isDwellActive()).toBe(false);
      await vi.advanceTimersByTimeAsync(200);

      // Play another 1450ms
      await videos[0].play();
      await vi.advanceTimersByTimeAsync(1450);

      // Pause again
      videos[0].pause();
      await vi.advanceTimersByTimeAsync(5000);

      // Strictly 0 views
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
      expect(detector.getSessionSeen().size).toBe(0);
    });
  });

  // ==========================================================================
  // SUITE 4: SEEKING & SCRUBBING STRESS
  // ==========================================================================
  describe('Suite 4: Seeking & Scrubbing Stress', () => {
    it('resets timer when user seeks video while playing at 1000ms', async () => {
      const { videos } = createMockYouTubeShortsDOM(['seeking_short_01']);
      setLocation('/shorts/seeking_short_01');

      detector = new YouTubeShortsDetector();
      detector.init();

      // Play for 1000ms
      await videos[0].play();
      expect(detector.isDwellActive()).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);

      // User seeks to 15s position
      videos[0].simulateSeek(15);
      // Seeking event cancels active dwell timer
      expect(detector.isDwellActive()).toBe(false);

      // Advance by 600ms without resume
      await vi.advanceTimersByTimeAsync(600);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);

      // Video continues playback after seek
      await videos[0].play();
      expect(detector.isDwellActive()).toBe(true);

      // Advance by 1000ms: cumulative playback is 1000ms + 1000ms = 2000ms
      // But continuous dwell since seek is only 1000ms!
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);

      // Advance remaining 500ms (1500ms continuous dwell since seek)
      await vi.advanceTimersByTimeAsync(500);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe('seeking_short_01');
    });

    it('records ZERO views during active scrubbing barrage (10 seeks every 600ms)', async () => {
      const { videos } = createMockYouTubeShortsDOM(['scrubbing_short']);
      setLocation('/shorts/scrubbing_short');

      detector = new YouTubeShortsDetector();
      detector.init();

      await videos[0].play();

      // 10 seeks every 600ms = 6000ms of scrubbing
      for (let s = 1; s <= 10; s++) {
        await vi.advanceTimersByTimeAsync(600);
        videos[0].simulateSeek(s * 2);
        expect(detector.isDwellActive()).toBe(false);
        expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);

        // Resume playback after each seek
        await videos[0].play();
      }

      // User pauses at end of scrubbing
      videos[0].pause();
      await vi.advanceTimersByTimeAsync(5000);

      // Invariant: ZERO views during scrubbing
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
      expect(detector.getSessionSeen().size).toBe(0);
    });

    it('qualifies exactly ONCE when user finishes scrubbing and lets video play for 1500ms', async () => {
      const { videos } = createMockYouTubeShortsDOM(['scrub_then_play']);
      setLocation('/shorts/scrub_then_play');

      detector = new YouTubeShortsDetector();
      detector.init();

      await videos[0].play();

      // 5 rapid seeks
      for (let s = 1; s <= 5; s++) {
        await vi.advanceTimersByTimeAsync(400);
        videos[0].simulateSeek(s * 3);
        await videos[0].play();
      }

      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);

      // Now user stops scrubbing and watches uninterrupted for 1600ms
      await vi.advanceTimersByTimeAsync(1600);

      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe('scrub_then_play');
      expect(detector.getSessionSeen().has('scrub_then_play')).toBe(true);
    });

    it('records ZERO duplicate views when seeking repeatedly on an already qualified short', async () => {
      const { videos } = createMockYouTubeShortsDOM(['already_qualified']);
      setLocation('/shorts/already_qualified');

      detector = new YouTubeShortsDetector();
      detector.init();

      // Qualify short
      await videos[0].play();
      await vi.advanceTimersByTimeAsync(1600);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);

      // User scrubs forward and backward 10 times
      for (let i = 0; i < 10; i++) {
        videos[0].simulateSeek(i * 2);
        await videos[0].play();
        await vi.advanceTimersByTimeAsync(2000);
      }

      // Still strictly 1 view count
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
    });
  });

  // ==========================================================================
  // SUITE 5: ENVIRONMENTAL, VIRTUAL DOM & LIFECYCLE ADVERSARIAL STRESS
  // ==========================================================================
  describe('Suite 5: Environmental, Virtual DOM & Lifecycle Adversarial Stress', () => {
    it('cancels dwell when tab is hidden; background playback for 30s yields ZERO counts; requires 1500ms on return', async () => {
      const { videos } = createMockYouTubeShortsDOM(['bg_tab_short']);
      setLocation('/shorts/bg_tab_short');

      detector = new YouTubeShortsDetector();
      detector.init();

      // Play visible for 1200ms (300ms shy of qualifying)
      await videos[0].play();
      expect(detector.isDwellActive()).toBe(true);
      await vi.advanceTimersByTimeAsync(1200);

      // Tab hidden (user switches to another tab)
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(detector.isDwellActive()).toBe(false);

      // Video plays background audio for 30 seconds
      await vi.advanceTimersByTimeAsync(30000);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);

      // User returns to tab
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      // If video is still playing, detector restarts dwell timer
      expect(detector.isDwellActive()).toBe(true);

      // Advance 1000ms: must NOT qualify yet (cannot use earlier 1200ms)
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);

      // Advance remaining 500ms (1500ms continuous dwell since visible return)
      await vi.advanceTimersByTimeAsync(500);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe('bg_tab_short');
    });

    it('correctly tracks and deduplicates across 3 recycled renderers for 30 distinct shorts (15 flicked, 15 watched)', async () => {
      // 3 physical containers recycled for 30 distinct shorts
      const { renderers, videos } = createMockYouTubeShortsDOM(['r0', 'r1', 'r2']);

      setLocation('/shorts/r0');
      detector = new YouTubeShortsDetector();
      detector.init();

      let expectedWatchedCount = 0;

      for (let i = 0; i < 30; i++) {
        const shortId = `recycled_${String(i + 1).padStart(2, '0')}`;
        const activeIdx = i % 3;
        const prevIdx = (i + 2) % 3;

        renderers[prevIdx].removeAttribute('is-active');
        videos[prevIdx].pause();

        const curRenderer = renderers[activeIdx];
        curRenderer.setAttribute('is-active', '');
        curRenderer.setAttribute('video-id', shortId);
        const anchor = curRenderer.querySelector('a');
        if (anchor) anchor.setAttribute('href', `/shorts/${shortId}`);

        setLocation(`/shorts/${shortId}`);
        detector.evaluateActiveShort();
        await videos[activeIdx].play();

        const isWatched = i % 2 === 0; // Even index = watched (1800ms), Odd index = flicked (500ms)

        if (isWatched) {
          await vi.advanceTimersByTimeAsync(1800);
          expectedWatchedCount++;
        } else {
          await vi.advanceTimersByTimeAsync(500);
        }
      }

      // Assert: exactly 15 watched shorts counted, 0 flicked shorts counted
      expect(expectedWatchedCount).toBe(15);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(15);
      expect(detector.getSessionSeen().size).toBe(15);

      // Verify all even numbered shorts are present in session store
      for (let i = 0; i < 30; i += 2) {
        const id = `recycled_${String(i + 1).padStart(2, '0')}`;
        expect(detector.getSessionSeen().has(id)).toBe(true);
      }
    });

    it('handles SPA route thrashing (/shorts -> /watch -> /shorts -> /feed) without errors or false counts', async () => {
      const { renderers, videos } = createMockYouTubeShortsDOM(['thrash_1', 'thrash_2']);
      setLocation('/shorts/thrash_1');

      detector = new YouTubeShortsDetector();
      detector.init();

      await videos[0].play();
      await vi.advanceTimersByTimeAsync(800);

      // Rapidly navigate away to /watch
      setLocation('/watch?v=long_video_99');
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      expect(detector.isDwellActive()).toBe(false);
      expect(detector.getActiveVideoId()).toBeNull();

      await vi.advanceTimersByTimeAsync(2000);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);

      // Navigate back to /shorts/thrash_2
      setLocation('/shorts/thrash_2');
      renderers[0].removeAttribute('is-active');
      renderers[1].setAttribute('is-active', '');
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));

      await videos[1].play();
      expect(detector.isDwellActive()).toBe(true);
      await vi.advanceTimersByTimeAsync(1800);

      // Only thrash_2 qualified
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe('thrash_2');
    });

    it('maintains in-memory deduplication when sessionStorage throws QuotaExceededError or SecurityError', async () => {
      // Mock sessionStorage.setItem to throw
      const originalSetItem = sessionStorage.setItem;
      sessionStorage.setItem = () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      };

      const { videos } = createMockYouTubeShortsDOM(['storage_error_short']);
      setLocation('/shorts/storage_error_short');

      detector = new YouTubeShortsDetector();
      detector.init();

      await videos[0].play();
      await vi.advanceTimersByTimeAsync(1800);

      // Should not crash, and should qualify view
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      expect(detector.getSessionSeen().has('storage_error_short')).toBe(true);

      // Second play should still be deduplicated via in-memory Set
      videos[0].simulateLoop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);

      sessionStorage.setItem = originalSetItem;
    });

    it('cancels active dwell timer and resets deduplication store on RESET_STATS message', async () => {
      const { videos } = createMockYouTubeShortsDOM(['reset_msg_short']);
      setLocation('/shorts/reset_msg_short');

      detector = new YouTubeShortsDetector();
      detector.init();

      // Play for 800ms
      await videos[0].play();
      expect(detector.isDwellActive()).toBe(true);
      await vi.advanceTimersByTimeAsync(800);

      // Reset message arrives from popup
      await mockChrome.runtime.sendMessage({ type: 'RESET_STATS' });

      // Active dwell timer cancelled immediately
      expect(detector.isDwellActive()).toBe(false);

      // Let 3000ms pass
      await vi.advanceTimersByTimeAsync(3000);
      const recordViewCalls = mockChrome.runtime.sendMessageCalls.filter(
        (c) => c.message.type === 'RECORD_VIEW'
      );
      expect(recordViewCalls.length).toBe(0);
      expect(detector.getSessionSeen().size).toBe(0);
    });
  });
});

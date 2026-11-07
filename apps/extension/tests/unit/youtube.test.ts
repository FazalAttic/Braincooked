/**
 * tests/unit/youtube.test.ts
 * Comprehensive Unit and DOM Integration Test Suite for YouTube Shorts Detection,
 * Active Short Observation, View Gate Qualification, and Session Deduplication (Milestone M3: TC-YT-01 to TC-YT-07).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockChrome } from '../mocks/chrome';
import { createMockVideo, MockHTMLVideoElement } from '../mocks/video';
import {
  YouTubeShortsDetector,
  extractYouTubeShortId,
  qualifyYouTubeView,
  createYouTubeDetector,
  initYouTubeTracking,
  DEFAULT_VIEW_DURATION_THRESHOLD_MS,
  SESSION_STORAGE_KEY,
  sendYouTubeRecordView
} from '../../src/content/youtube';

// ============================================================================
// TEST FIXTURES & SIMULATION HELPERS
// ============================================================================

interface MockShortsDOM {
  container: HTMLElement;
  renderers: HTMLElement[];
  videos: MockHTMLVideoElement[];
}

function createMockYouTubeShortsDOM(
  initialVideoIds: string[] = ['vid_short_1', 'vid_short_2', 'vid_short_3']
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

    const video = createMockVideo({ src: `blob:mock://${id}` });
    renderer.querySelector('#player-container')!.appendChild(video);

    container.appendChild(renderer);
    renderers.push(renderer);
    videos.push(video);
  });

  return { container, renderers, videos };
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

function simulateNavigate(pathname: string) {
  setLocation(pathname);
  window.dispatchEvent(
    new CustomEvent('yt-navigate-finish', {
      detail: { endpoint: { commandMetadata: { webCommandMetadata: { url: pathname } } } }
    })
  );
}

// ============================================================================
// TEST SUITE: YOUTUBE SHORTS DETECTION & DEDUPLICATION (M3)
// ============================================================================

describe('YouTube Shorts Detection & Deduplication (Milestone M3)', () => {
  let detector: YouTubeShortsDetector;

  beforeEach(() => {
    // Reset mock chrome framework
    mockChrome.resetAll();

    // Reset sessionStorage
    try {
      sessionStorage.clear();
    } catch {}

    // Default document visibility to 'visible'
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true
    });

    // Default location to home page
    setLocation('/');

    // Clear document body
    document.body.innerHTML = '';

    // Use Vitest fake timers
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

  // ============================================================================
  // 1. CONSTANTS SANITY CHECK
  // ============================================================================
  describe('Constants Configuration', () => {
    it('declares correct dwell threshold of 1500ms', () => {
      expect(DEFAULT_VIEW_DURATION_THRESHOLD_MS).toBe(1500);
    });

    it('declares correct sessionStorage key', () => {
      expect(SESSION_STORAGE_KEY).toBe('brainroad_yt_session');
    });
  });

  // ============================================================================
  // 2. VIDEO ID EXTRACTION CASCADE
  // ============================================================================
  describe('Video ID Extraction: extractYouTubeShortId', () => {
    it('extracts 11-char ID from canonical pathname (/shorts/<id>)', () => {
      const id = extractYouTubeShortId(null, '/shorts/dQw4w9WgXcQ');
      expect(id).toBe('dQw4w9WgXcQ');
    });

    it('extracts ID when query parameters are present (/shorts/<id>?feature=share)', () => {
      const id = extractYouTubeShortId(null, '/shorts/dQw4w9WgXcQ?feature=share');
      expect(id).toBe('dQw4w9WgXcQ');
    });

    it('extracts ID with trailing slash (/shorts/<id>/)', () => {
      const id = extractYouTubeShortId(null, '/shorts/dQw4w9WgXcQ/');
      expect(id).toBe('dQw4w9WgXcQ');
    });

    it('extracts ID from window object', () => {
      const fakeWin = { location: { pathname: '/shorts/abc123xyz89', href: 'https://youtube.com/shorts/abc123xyz89' } } as any;
      const id = extractYouTubeShortId(null, fakeWin);
      expect(id).toBe('abc123xyz89');
    });

    it('falls back to active renderer anchor tag href when URL is not a Shorts path', () => {
      const renderer = document.createElement('div');
      renderer.innerHTML = '<a href="/shorts/vid_short_1"></a>';
      const id = extractYouTubeShortId(renderer, '/watch?v=long_vid_99');
      expect(id).toBe('vid_short_1');
    });

    it('falls back to renderer video-id attribute', () => {
      const renderer = document.createElement('div');
      renderer.setAttribute('video-id', 'vid_attr_01');
      const id = extractYouTubeShortId(renderer, '/');
      expect(id).toBe('vid_attr_01');
    });

    it('falls back to renderer data-video-id attribute', () => {
      const renderer = document.createElement('div');
      renderer.setAttribute('data-video-id', 'vid_data_02');
      const id = extractYouTubeShortId(renderer, '/');
      expect(id).toBe('vid_data_02');
    });

    it('returns null on standard non-Shorts YouTube pages', () => {
      expect(extractYouTubeShortId(null, '/watch?v=12345678901')).toBeNull();
      expect(extractYouTubeShortId(null, '/')).toBeNull();
      expect(extractYouTubeShortId(null, '/feed/subscriptions')).toBeNull();
      expect(extractYouTubeShortId(null, '/feed/trending')).toBeNull();
    });

    it('returns null when input is empty or null', () => {
      expect(extractYouTubeShortId(null, '')).toBeNull();
      expect(extractYouTubeShortId(null, null as any)).toBeNull();
    });
  });

  // ============================================================================
  // 3. QUALIFICATION HELPER: qualifyYouTubeView
  // ============================================================================
  describe('Instantaneous Qualification Gate: qualifyYouTubeView', () => {
    it('returns true when visible, playing, unended, and readyState >= 2', () => {
      const video = createMockVideo();
      video.paused = false;
      video.ended = false;
      video.readyState = 4;
      expect(qualifyYouTubeView(video, true)).toBe(true);
    });

    it('returns false when document is not visible', () => {
      const video = createMockVideo();
      video.paused = false;
      video.ended = false;
      video.readyState = 4;
      expect(qualifyYouTubeView(video, false)).toBe(false);
    });

    it('returns false when video is paused', () => {
      const video = createMockVideo();
      video.paused = true;
      video.ended = false;
      expect(qualifyYouTubeView(video, true)).toBe(false);
    });

    it('returns false when video has ended', () => {
      const video = createMockVideo();
      video.paused = false;
      video.ended = true;
      expect(qualifyYouTubeView(video, true)).toBe(false);
    });

    it('returns false when video is null', () => {
      expect(qualifyYouTubeView(null, true)).toBe(false);
    });
  });

  // ============================================================================
  // 4. TC-YT-01: INITIAL LOAD & QUALIFIED VIEW
  // ============================================================================
  describe('TC-YT-01: Initial Load & Qualified View', () => {
    it('qualifies short view after continuous 1.8s playback and dispatches RECORD_VIEW', async () => {
      const { videos } = createMockYouTubeShortsDOM(['vid_short_1', 'vid_short_2']);
      setLocation('/shorts/vid_short_1');

      detector = new YouTubeShortsDetector();
      detector.init();

      // Video begins playback
      await videos[0].play();
      expect(detector.isDwellActive()).toBe(true);

      // Advance clock past 1500ms threshold (1800ms)
      vi.advanceTimersByTime(1800);
      await Promise.resolve(); // Flush microtasks

      // Verify message was dispatched to background service worker
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      const call = mockChrome.runtime.sendMessageCalls[0];
      expect(call.message).toMatchObject({
        type: 'RECORD_VIEW',
        platform: 'youtube',
        id: 'vid_short_1'
      });
      expect(typeof call.message.timestamp).toBe('number');

      // Verify video ID is registered in session deduplication store
      expect(detector.getSessionSeen().has('vid_short_1')).toBe(true);
      expect(detector.isDwellActive()).toBe(false);
    });
  });

  // ============================================================================
  // 5. TC-YT-02: FLICK / SKIM NAVIGATION (< 1.5 SECONDS)
  // ============================================================================
  describe('TC-YT-02: Flick/Skim Navigation Suppression', () => {
    it('does not increment counter or dispatch view when user scrolls away after 600ms', async () => {
      const { renderers, videos } = createMockYouTubeShortsDOM(['vid_short_1', 'vid_short_2', 'vid_short_3']);
      setLocation('/shorts/vid_short_1');

      detector = new YouTubeShortsDetector();
      detector.init();

      // Start on Short 1, scroll immediately to Short 2
      await simulateScrollToNextShort(0, 1, renderers, videos, 'vid_short_2');
      expect(detector.isDwellActive()).toBe(true);

      // User watches for only 600ms (flick/skim)
      vi.advanceTimersByTime(600);

      // User flicks to Short 3 before reaching 1500ms threshold
      await simulateScrollToNextShort(1, 2, renderers, videos, 'vid_short_3');

      // Let time pass
      vi.advanceTimersByTime(1000);
      await Promise.resolve();

      // Verify Short 2 was NEVER dispatched or added to seen set
      expect(detector.getSessionSeen().has('vid_short_2')).toBe(false);
      const short2Calls = mockChrome.runtime.sendMessageCalls.filter(
        (c) => c.message.id === 'vid_short_2'
      );
      expect(short2Calls.length).toBe(0);
    });
  });

  // ============================================================================
  // 6. TC-YT-03: INFINITE LOOPING DEDUPLICATION
  // ============================================================================
  describe('TC-YT-03: Infinite Looping Deduplication', () => {
    it('increments counter strictly once when video loops repeatedly', async () => {
      const { videos } = createMockYouTubeShortsDOM(['vid_short_1']);
      setLocation('/shorts/vid_short_1');

      detector = new YouTubeShortsDetector();
      detector.init();

      // First playback plays for 1.8s and qualifies
      await videos[0].play();
      vi.advanceTimersByTime(1800);
      await Promise.resolve();

      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      expect(detector.getSessionSeen().has('vid_short_1')).toBe(true);

      // Video reaches end of duration (30s) and loops back to 0
      videos[0].simulateTimeUpdate(30);
      videos[0].simulateLoop();

      // Plays for another full cycle (30 seconds)
      vi.advanceTimersByTime(30000);
      await Promise.resolve();

      // Video loops a third time
      videos[0].simulateLoop();
      vi.advanceTimersByTime(15000);
      await Promise.resolve();

      // Verify message dispatch occurred strictly ONCE
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
    });
  });

  // ============================================================================
  // 7. TC-YT-04: BI-DIRECTIONAL SCROLLING DEDUPLICATION
  // ============================================================================
  describe('TC-YT-04: Bi-Directional Scrolling Deduplication', () => {
    it('suppresses duplicate count when scrolling back up to previously viewed short', async () => {
      const { renderers, videos } = createMockYouTubeShortsDOM(['vid_short_1', 'vid_short_2']);
      setLocation('/shorts/vid_short_1');

      detector = new YouTubeShortsDetector();
      detector.init();

      // 1. View Short 1 for 2 seconds (qualified)
      await videos[0].play();
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe('vid_short_1');

      // 2. Scroll down to Short 2, watch for 2 seconds (qualified)
      await simulateScrollToNextShort(0, 1, renderers, videos, 'vid_short_2');
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(2);
      expect(mockChrome.runtime.sendMessageCalls[1].message.id).toBe('vid_short_2');

      // 3. Scroll back up to Short 1, watch for 5 seconds
      await simulateScrollToNextShort(1, 0, renderers, videos, 'vid_short_1');
      expect(detector.isDwellActive()).toBe(false); // Should NOT start dwell timer
      vi.advanceTimersByTime(5000);
      await Promise.resolve();

      // Verify total message dispatches remains 2 (Short 1 not recounted)
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(2);
    });
  });

  // ============================================================================
  // 8. TC-YT-05: SPA NAVIGATION TRANSITION (WATCH -> SHORTS)
  // ============================================================================
  describe('TC-YT-05: SPA Navigation from /watch into Shorts', () => {
    it('activates detection when yt-navigate-finish fires entering /shorts/', async () => {
      // Start on /watch page
      setLocation('/watch?v=long_video_01');
      document.body.innerHTML = '<ytd-app><div id="page-manager"></div></ytd-app>';

      detector = new YouTubeShortsDetector();
      detector.init();

      expect(detector.isDwellActive()).toBe(false);
      expect(detector.getActiveVideoId()).toBeNull();

      // User clicks Shorts button: DOM mounts <ytd-shorts> and yt-navigate-finish fires
      const { videos } = createMockYouTubeShortsDOM(['vid_short_3']);
      simulateNavigate('/shorts/vid_short_3');

      // Video begins playing
      await videos[0].play();
      expect(detector.isDwellActive()).toBe(true);

      vi.advanceTimersByTime(1800);
      await Promise.resolve();

      // Verify Short 3 qualified and dispatched
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe('vid_short_3');
    });

    it('clears active observation when navigating away from Shorts to /watch', async () => {
      const { videos } = createMockYouTubeShortsDOM(['vid_short_1']);
      setLocation('/shorts/vid_short_1');

      detector = new YouTubeShortsDetector();
      detector.init();

      await videos[0].play();
      expect(detector.isDwellActive()).toBe(true);

      // User navigates away to home page before 1.5s
      simulateNavigate('/');

      vi.advanceTimersByTime(2000);
      await Promise.resolve();

      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
      expect(detector.isDwellActive()).toBe(false);
      expect(detector.getActiveVideoId()).toBeNull();
    });
  });

  // ============================================================================
  // 9. TC-YT-06: VIRTUAL DOM RECYCLING OBSERVATION
  // ============================================================================
  describe('TC-YT-06: Virtual DOM Renderer Recycling', () => {
    it('detects recycled renderer attribute updates and binds to newly mounted short', async () => {
      const { renderers, videos } = createMockYouTubeShortsDOM(['vid_short_1']);
      setLocation('/shorts/vid_short_1');

      detector = new YouTubeShortsDetector();
      detector.init();

      await videos[0].play();
      vi.advanceTimersByTime(1800);
      await Promise.resolve();
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);

      // YouTube virtualizes: recycles the renderer element for a new video ID
      const activeRenderer = renderers[0];
      activeRenderer.setAttribute('video-id', 'vid_recyc_02');
      const anchor = activeRenderer.querySelector('a');
      if (anchor) anchor.setAttribute('href', '/shorts/vid_recyc_02');
      setLocation('/shorts/vid_recyc_02');

      // Trigger mutation evaluation
      detector.evaluateActiveShort();

      // Play new recycled short
      await videos[0].play();
      expect(detector.isDwellActive()).toBe(true);

      vi.advanceTimersByTime(1800);
      await Promise.resolve();

      // Verify new recycled short was counted
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(2);
      expect(mockChrome.runtime.sendMessageCalls[1].message.id).toBe('vid_recyc_02');
    });
  });

  // ============================================================================
  // 10. TC-YT-07: BACKGROUND TAB & VISIBILITY HANDLING
  // ============================================================================
  describe('TC-YT-07: Background Tab & Visibility Gate', () => {
    it('aborts dwell timer when tab is hidden and resumes when visible', async () => {
      const { videos } = createMockYouTubeShortsDOM(['vid_short_1']);
      setLocation('/shorts/vid_short_1');

      detector = new YouTubeShortsDetector();
      detector.init();

      await videos[0].play();
      expect(detector.isDwellActive()).toBe(true);

      // Plays for 800ms
      vi.advanceTimersByTime(800);

      // User switches to another tab -> document visibility becomes 'hidden'
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true
      });
      document.dispatchEvent(new Event('visibilitychange'));

      // Dwell timer should immediately abort
      expect(detector.isDwellActive()).toBe(false);

      // Advance time by 3 seconds while in background tab
      vi.advanceTimersByTime(3000);
      await Promise.resolve();

      // Should NOT have registered a view
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);

      // User returns to tab -> visibility becomes 'visible'
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true
      });
      document.dispatchEvent(new Event('visibilitychange'));

      // Timer should restart
      expect(detector.isDwellActive()).toBe(true);

      // Plays continuously for 1500ms in visible tab
      vi.advanceTimersByTime(1500);
      await Promise.resolve();

      // Now qualified!
      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message.id).toBe('vid_short_1');
    });
  });

  // ============================================================================
  // 11. PLAYBACK INTERRUPTIONS (PAUSE, STALL, SEEK)
  // ============================================================================
  describe('Playback Interruptions Handling', () => {
    it('aborts dwell timer when video is paused before 1.5s', async () => {
      const { videos } = createMockYouTubeShortsDOM(['vid_short_1']);
      setLocation('/shorts/vid_short_1');

      detector = new YouTubeShortsDetector();
      detector.init();

      await videos[0].play();
      expect(detector.isDwellActive()).toBe(true);

      vi.advanceTimersByTime(1000);
      videos[0].pause();

      expect(detector.isDwellActive()).toBe(false);

      vi.advanceTimersByTime(2000);
      await Promise.resolve();

      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
    });

    it('aborts dwell timer when video stalls or buffers', async () => {
      const { videos } = createMockYouTubeShortsDOM(['vid_short_1']);
      setLocation('/shorts/vid_short_1');

      detector = new YouTubeShortsDetector();
      detector.init();

      await videos[0].play();
      vi.advanceTimersByTime(900);

      videos[0].simulateStall();
      expect(detector.isDwellActive()).toBe(false);

      vi.advanceTimersByTime(2000);
      await Promise.resolve();

      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
    });
  });

  // ============================================================================
  // 12. SESSION PERSISTENCE & HYDRATION
  // ============================================================================
  describe('Session Storage Hydration & Persistence', () => {
    it('hydrates pre-cached seen IDs from sessionStorage', async () => {
      sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify(['cached_short_1', 'cached_short_2'])
      );

      const { videos } = createMockYouTubeShortsDOM(['cached_short_1']);
      setLocation('/shorts/cached_short_1');

      detector = new YouTubeShortsDetector();
      detector.init();

      expect(detector.getSessionSeen().has('cached_short_1')).toBe(true);
      expect(detector.getSessionSeen().has('cached_short_2')).toBe(true);

      // Play the pre-cached video
      await videos[0].play();
      expect(detector.isDwellActive()).toBe(false);

      vi.advanceTimersByTime(2000);
      await Promise.resolve();

      expect(mockChrome.runtime.sendMessageCalls.length).toBe(0);
    });

    it('persists newly qualified IDs into sessionStorage', async () => {
      const { videos } = createMockYouTubeShortsDOM(['vid_persist_1']);
      setLocation('/shorts/vid_persist_1');

      detector = new YouTubeShortsDetector();
      detector.init();

      await videos[0].play();
      vi.advanceTimersByTime(1800);
      await Promise.resolve();

      const stored = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) || '[]');
      expect(stored).toContain('vid_persist_1');
    });

    it('clears sessionStorage on resetSession()', async () => {
      const { videos } = createMockYouTubeShortsDOM(['vid_short_1']);
      setLocation('/shorts/vid_short_1');

      detector = new YouTubeShortsDetector();
      detector.init();

      await videos[0].play();
      vi.advanceTimersByTime(1800);
      await Promise.resolve();

      expect(detector.getSessionSeen().size).toBe(1);

      detector.resetSession();
      expect(detector.getSessionSeen().size).toBe(0);
      expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    });
  });

  // ============================================================================
  // 13. RUNTIME RESET MESSAGES
  // ============================================================================
  describe('Runtime Messaging Reset Listener', () => {
    it('resets session deduplication when RESET_STATS message is received', async () => {
      const { videos } = createMockYouTubeShortsDOM(['vid_short_1']);
      setLocation('/shorts/vid_short_1');

      detector = new YouTubeShortsDetector();
      detector.init();

      await videos[0].play();
      vi.advanceTimersByTime(1800);
      await Promise.resolve();

      expect(detector.getSessionSeen().has('vid_short_1')).toBe(true);

      // Simulate RESET_STATS message from popup
      await mockChrome.runtime.sendMessage({ type: 'RESET_STATS' });

      expect(detector.getSessionSeen().size).toBe(0);
    });
  });

  // ============================================================================
  // 14. MESSAGING BUS: sendYouTubeRecordView
  // ============================================================================
  describe('sendYouTubeRecordView Messaging Bus', () => {
    it('dispatches RECORD_VIEW message with correct platform and ID', async () => {
      const res = await sendYouTubeRecordView(mockChrome as any, 'vid_test_123', 123456789);
      expect(res.ok).toBe(true);

      expect(mockChrome.runtime.sendMessageCalls.length).toBe(1);
      expect(mockChrome.runtime.sendMessageCalls[0].message).toEqual({
        type: 'RECORD_VIEW',
        platform: 'youtube',
        id: 'vid_test_123',
        timestamp: 123456789
      });
    });

    it('returns error when chrome context is unavailable', async () => {
      const res = await sendYouTubeRecordView(null as any, 'vid_test_123');
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Extension context unavailable');
    });
  });

  // ============================================================================
  // 15. FACTORY & LIFECYCLE CONTROLLERS
  // ============================================================================
  describe('createYouTubeDetector & initYouTubeTracking', () => {
    it('creates functional controller via createYouTubeDetector factory', async () => {
      const { videos } = createMockYouTubeShortsDOM(['vid_fact_01']);
      setLocation('/shorts/vid_fact_01');

      const controller = createYouTubeDetector({
        chrome: mockChrome as any,
        window,
        document
      });

      expect(controller.extractVideoId()).toBe('vid_fact_01');
      await videos[0].play();
      expect(controller.isDwellActive()).toBe(true);

      vi.advanceTimersByTime(1800);
      await Promise.resolve();

      expect(controller.getSessionSeen().has('vid_fact_01')).toBe(true);
      controller.destroy();
    });

    it('initializes and tears down tracking via initYouTubeTracking', () => {
      createMockYouTubeShortsDOM(['vid_init_01']);
      setLocation('/shorts/vid_init_01');

      const teardown = initYouTubeTracking({
        chrome: mockChrome as any,
        window,
        document
      });

      expect(typeof teardown).toBe('function');
      teardown();
    });
  });
});

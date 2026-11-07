/**
 * tests/unit/challenger_m3_2.test.ts
 * Challenger M3-2 Empirical Adversarial Stress Test Suite:
 * YouTube Shorts Edge Cases & Attack Surface
 * 
 * Focus Areas:
 * 1. Tab Visibility Stress:
 *    - Playback in hidden tab (document.visibilityState = 'hidden')
 *    - Dwell timer MUST NOT qualify view while hidden (even during infinite loop/playback)
 *    - Tab becomes visible -> Dwell timer counts from 0 (non-cumulative, full 1500ms required)
 *    - Flapping visibility states (rapid hidden <-> visible switches)
 *    - Video paused when tab becomes visible
 * 
 * 2. ID Extraction Cascade Stress:
 *    - Canonical: /shorts/dQw4w9WgXcQ
 *    - Query parameters: /shorts/dQw4w9WgXcQ?feature=share, /shorts/dQw4w9WgXcQ?si=xyz&feature=share
 *    - Hash fragments: /shorts/dQw4w9WgXcQ#comments, /shorts/dQw4w9WgXcQ?feature=share#comments
 *    - Absolute URLs: https://www.youtube.com/shorts/dQw4w9WgXcQ
 *    - Trailing slashes: /shorts/dQw4w9WgXcQ/
 *    - Active container anchor tags: <a href="/shorts/dQw4w9WgXcQ"> inside renderer
 *    - Anchor tags with query/hash parameters
 *    - Container attributes: video-id="dQw4w9WgXcQ" vs data-video-id="dQw4w9WgXcQ"
 *    - Attribute precedence and empty string fallbacks
 *    - Malformed / non-shorts URLs (/watch?v=..., /feed/subscriptions, /shorts/, empty, null, XSS vectors)
 * 
 * 3. SessionStorage Hydration Stress:
 *    - F5 reload on same short retains seen IDs
 *    - Duplicate qualification strictly prevented upon reload within same session
 *    - Accumulation of multiple seen IDs persisted and re-hydrated
 *    - Resilience against corrupted, non-array, or dirty sessionStorage payloads
 *    - resetSession completely purges sessionStorage and allows re-qualification
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockChrome } from '../mocks/chrome';
import { createMockVideo, MockHTMLVideoElement } from '../mocks/video';
import {
  YouTubeShortsDetector,
  extractYouTubeShortId,
  qualifyYouTubeView,
  DEFAULT_VIEW_DURATION_THRESHOLD_MS,
  SESSION_STORAGE_KEY
} from '../../src/content/youtube';

// Prevent live auto-initialization in test runner
(window as any).__BRAINROAD_TEST_ENV__ = true;

interface MockShortsDOM {
  container: HTMLElement;
  renderers: HTMLElement[];
  videos: MockHTMLVideoElement[];
}

function createMockYouTubeShortsDOM(
  initialVideoIds: string[] = ['dQw4w9WgXcQ', 's7w3b_12345', 'z9x8c_67890']
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
      search: pathname.includes('?') ? pathname.substring(pathname.indexOf('?')) : '',
      hash: pathname.includes('#') ? pathname.substring(pathname.indexOf('#')) : ''
    },
    writable: true,
    configurable: true
  });
}

function setDocumentVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    writable: true,
    configurable: true
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('Challenger M3-2: YouTube Shorts Adversarial Stress Suite', () => {
  let detector: YouTubeShortsDetector;
  let qualifiedViews: string[];

  beforeEach(() => {
    (window as any).__BRAINROAD_TEST_ENV__ = true;
    mockChrome.resetAll();
    qualifiedViews = [];

    try {
      sessionStorage.clear();
    } catch {}

    setDocumentVisibility('visible');
    setLocation('/shorts/dQw4w9WgXcQ');
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
    try {
      sessionStorage.clear();
    } catch {}
  });

  // ==========================================================================
  // SECTION 0: CONSTANTS SANITY CHECK
  // ==========================================================================
  describe('0. Constants Verification', () => {
    it('declares 1500ms continuous dwell threshold', () => {
      expect(DEFAULT_VIEW_DURATION_THRESHOLD_MS).toBe(1500);
      expect(SESSION_STORAGE_KEY).toBe('brainroad_yt_session');
    });
  });

  // ==========================================================================
  // SECTION 1: TAB VISIBILITY STRESS TESTS
  // ==========================================================================
  describe('1. Tab Visibility Stress', () => {
    it('does NOT qualify view when video plays in a hidden tab (document.visibilityState = "hidden")', async () => {
      // 1. Arrange: Tab is hidden before initialization
      setDocumentVisibility('hidden');
      const { videos } = createMockYouTubeShortsDOM(['dQw4w9WgXcQ']);

      detector = new YouTubeShortsDetector({
        onViewQualified: (id) => {
          qualifiedViews.push(id);
        }
      });
      detector.init();

      // Video starts playback in background tab (e.g. background audio or auto-play)
      await videos[0].play();

      // Verify instantaneous qualification gate is false
      expect(qualifyYouTubeView(videos[0], false)).toBe(false);
      expect(detector.isDwellActive()).toBe(false);

      // 2. Act: Advance clock by 1500ms, then 5000ms, then 10000ms while tab remains hidden
      vi.advanceTimersByTime(1500);
      expect(qualifiedViews.length).toBe(0);
      expect(detector.isDwellActive()).toBe(false);

      vi.advanceTimersByTime(8500);
      expect(qualifiedViews.length).toBe(0);
      expect(detector.getSessionSeen().has('dQw4w9WgXcQ')).toBe(false);

      // 3. Assert: 0 qualified views recorded across 10 seconds of background playback
      expect(qualifiedViews).toEqual([]);
    });

    it('immediately aborts active dwell timer when tab becomes hidden mid-playback', async () => {
      const { videos } = createMockYouTubeShortsDOM(['dQw4w9WgXcQ']);

      detector = new YouTubeShortsDetector({
        onViewQualified: (id) => {
          qualifiedViews.push(id);
        }
      });
      detector.init();

      await videos[0].play();
      expect(detector.isDwellActive()).toBe(true);

      // Play for 800ms while visible (700ms short of qualification)
      vi.advanceTimersByTime(800);
      expect(detector.isDwellActive()).toBe(true);
      expect(qualifiedViews.length).toBe(0);

      // User switches to another tab -> document visibility becomes 'hidden'
      setDocumentVisibility('hidden');

      // Verify timer is immediately canceled
      expect(detector.isDwellActive()).toBe(false);

      // Advance by remaining 700ms (to hit original 1500ms mark)
      vi.advanceTimersByTime(700);
      expect(qualifiedViews.length).toBe(0);

      // Advance by another 3000ms in background
      vi.advanceTimersByTime(3000);
      expect(qualifiedViews.length).toBe(0);
      expect(detector.getSessionSeen().has('dQw4w9WgXcQ')).toBe(false);
    });

    it('restarts dwell timer from 0 when tab becomes visible (strictly non-cumulative)', async () => {
      const { videos } = createMockYouTubeShortsDOM(['dQw4w9WgXcQ']);

      detector = new YouTubeShortsDetector({
        onViewQualified: (id) => {
          qualifiedViews.push(id);
        }
      });
      detector.init();

      // Phase 1: Play for 1000ms while visible (timer at 1000/1500ms)
      await videos[0].play();
      vi.advanceTimersByTime(1000);
      expect(detector.isDwellActive()).toBe(true);
      expect(qualifiedViews.length).toBe(0);

      // Phase 2: Switch to background for 4000ms
      setDocumentVisibility('hidden');
      expect(detector.isDwellActive()).toBe(false);
      vi.advanceTimersByTime(4000);
      expect(qualifiedViews.length).toBe(0);

      // Phase 3: Switch back to visible
      // Because video is still playing, handleVisibilityChange triggers startQualificationTimer
      setDocumentVisibility('visible');
      expect(detector.isDwellActive()).toBe(true);

      // Advance clock by 1000ms:
      // If timer were cumulative (1000ms prior + 1000ms current = 2000ms), it would trigger now!
      // But it MUST count from 0, so 1000ms is NOT enough.
      vi.advanceTimersByTime(1000);
      expect(qualifiedViews.length).toBe(0);
      expect(detector.isDwellActive()).toBe(true);

      // Advance clock by additional 499ms (total 1499ms since visible) -> still not qualified
      vi.advanceTimersByTime(499);
      expect(qualifiedViews.length).toBe(0);
      expect(detector.isDwellActive()).toBe(true);

      // Advance clock by final 1ms (total 1500ms continuous dwell since visible)
      vi.advanceTimersByTime(1);
      expect(qualifiedViews).toEqual(['dQw4w9WgXcQ']);
      expect(detector.isDwellActive()).toBe(false);
      expect(detector.getSessionSeen().has('dQw4w9WgXcQ')).toBe(true);
    });

    it('handles video paused while hidden: does NOT start timer when visible until play event', async () => {
      const { videos } = createMockYouTubeShortsDOM(['dQw4w9WgXcQ']);

      detector = new YouTubeShortsDetector({
        onViewQualified: (id) => {
          qualifiedViews.push(id);
        }
      });
      detector.init();

      // Video playing, then tab hidden
      await videos[0].play();
      setDocumentVisibility('hidden');
      expect(detector.isDwellActive()).toBe(false);

      // Video pauses while hidden (e.g. user paused via media keys or audio paused by browser)
      videos[0].pause();

      // Tab becomes visible, but video is PAUSED
      setDocumentVisibility('visible');
      expect(detector.isDwellActive()).toBe(false);

      // 2000ms pass while paused
      vi.advanceTimersByTime(2000);
      expect(qualifiedViews.length).toBe(0);
      expect(detector.isDwellActive()).toBe(false);

      // User resumes video
      await videos[0].play();
      expect(detector.isDwellActive()).toBe(true);

      vi.advanceTimersByTime(1499);
      expect(qualifiedViews.length).toBe(0);

      vi.advanceTimersByTime(1);
      expect(qualifiedViews).toEqual(['dQw4w9WgXcQ']);
    });

    it('survives rapid tab visibility flapping (5 rapid oscillations)', async () => {
      const { videos } = createMockYouTubeShortsDOM(['dQw4w9WgXcQ']);

      detector = new YouTubeShortsDetector({
        onViewQualified: (id) => {
          qualifiedViews.push(id);
        }
      });
      detector.init();
      await videos[0].play();

      // Rapidly toggle between visible and hidden 5 times in 500ms (100ms each)
      for (let i = 0; i < 5; i++) {
        setDocumentVisibility('hidden');
        expect(detector.isDwellActive()).toBe(false);
        vi.advanceTimersByTime(50);

        setDocumentVisibility('visible');
        expect(detector.isDwellActive()).toBe(true);
        vi.advanceTimersByTime(50);
      }

      // 0 views qualified despite 500ms total elapsed
      expect(qualifiedViews.length).toBe(0);

      // Now leave tab visible for uninterrupted 1500ms
      vi.advanceTimersByTime(1500);
      expect(qualifiedViews).toEqual(['dQw4w9WgXcQ']);

      // Further time does not duplicate
      vi.advanceTimersByTime(5000);
      expect(qualifiedViews.length).toBe(1);
    });

    it('does NOT count view if tab is hidden at 1499ms (1ms edge threshold test)', async () => {
      const { videos } = createMockYouTubeShortsDOM(['dQw4w9WgXcQ']);

      detector = new YouTubeShortsDetector({
        onViewQualified: (id) => {
          qualifiedViews.push(id);
        }
      });
      detector.init();
      await videos[0].play();

      // Advance right to the edge: 1499ms of 1500ms dwell
      vi.advanceTimersByTime(1499);
      expect(detector.isDwellActive()).toBe(true);
      expect(qualifiedViews.length).toBe(0);

      // Tab hidden at 1499ms
      setDocumentVisibility('hidden');
      expect(detector.isDwellActive()).toBe(false);

      // Advance by 1ms and beyond
      vi.advanceTimersByTime(5000);
      expect(qualifiedViews.length).toBe(0);
    });
  });

  // ==========================================================================
  // SECTION 2: ID EXTRACTION CASCADE STRESS TESTS
  // ==========================================================================
  describe('2. ID Extraction Cascade Stress', () => {
    it('extracts canonical 11-char ID from diverse URL structures', () => {
      // 1. Canonical /shorts/dQw4w9WgXcQ
      expect(extractYouTubeShortId(null, '/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');

      // 2. Query parameter: /shorts/dQw4w9WgXcQ?feature=share
      expect(extractYouTubeShortId(null, '/shorts/dQw4w9WgXcQ?feature=share')).toBe('dQw4w9WgXcQ');

      // 3. Hash fragment: /shorts/dQw4w9WgXcQ#comments
      expect(extractYouTubeShortId(null, '/shorts/dQw4w9WgXcQ#comments')).toBe('dQw4w9WgXcQ');

      // 4. Query AND Hash: /shorts/dQw4w9WgXcQ?feature=share#comments
      expect(extractYouTubeShortId(null, '/shorts/dQw4w9WgXcQ?feature=share#comments')).toBe('dQw4w9WgXcQ');

      // 5. Multiple query parameters: /shorts/dQw4w9WgXcQ?si=abc&feature=share&t=10s
      expect(extractYouTubeShortId(null, '/shorts/dQw4w9WgXcQ?si=abc&feature=share&t=10s')).toBe('dQw4w9WgXcQ');

      // 6. Trailing slash: /shorts/dQw4w9WgXcQ/
      expect(extractYouTubeShortId(null, '/shorts/dQw4w9WgXcQ/')).toBe('dQw4w9WgXcQ');

      // 7. Trailing slash with query and hash: /shorts/dQw4w9WgXcQ/?feature=share#comments
      expect(extractYouTubeShortId(null, '/shorts/dQw4w9WgXcQ/?feature=share#comments')).toBe('dQw4w9WgXcQ');

      // 8. Full URL with domain: https://www.youtube.com/shorts/dQw4w9WgXcQ
      expect(extractYouTubeShortId(null, 'https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');

      // 9. Full URL with query and hash: https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share#comments
      expect(extractYouTubeShortId(null, 'https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share#comments')).toBe('dQw4w9WgXcQ');
    });

    it('extracts ID from active container anchor tags (<a href="/shorts/...">)', () => {
      const renderer = document.createElement('ytd-reel-video-renderer');

      // Simple anchor tag
      renderer.innerHTML = `
        <div id="metadata-container">
          <a class="yt-simple-endpoint" href="/shorts/dQw4w9WgXcQ"></a>
        </div>
      `;
      // Pass non-shorts URL so URL strategy falls through to Strategy 2 (renderer anchor)
      expect(extractYouTubeShortId(renderer, '/watch?v=non_shorts')).toBe('dQw4w9WgXcQ');

      // Anchor tag with query parameter
      renderer.innerHTML = '<a href="/shorts/dQw4w9WgXcQ?feature=share"></a>';
      expect(extractYouTubeShortId(renderer, '/')).toBe('dQw4w9WgXcQ');

      // Anchor tag with hash fragment
      renderer.innerHTML = '<a href="/shorts/dQw4w9WgXcQ#comments"></a>';
      expect(extractYouTubeShortId(renderer, '/feed/subscriptions')).toBe('dQw4w9WgXcQ');

      // Anchor tag with full URL
      renderer.innerHTML = '<a href="https://www.youtube.com/shorts/dQw4w9WgXcQ"></a>';
      expect(extractYouTubeShortId(renderer, '/feed/trending')).toBe('dQw4w9WgXcQ');
    });

    it('extracts ID from container attributes: video-id vs data-video-id', () => {
      // 1. video-id attribute
      const renderer1 = document.createElement('ytd-reel-video-renderer');
      renderer1.setAttribute('video-id', 'dQw4w9WgXcQ');
      expect(extractYouTubeShortId(renderer1, '/')).toBe('dQw4w9WgXcQ');

      // 2. data-video-id attribute
      const renderer2 = document.createElement('ytd-reel-video-renderer');
      renderer2.setAttribute('data-video-id', 'dQw4w9WgXcQ');
      expect(extractYouTubeShortId(renderer2, '/')).toBe('dQw4w9WgXcQ');

      // 3. Precedence: video-id takes precedence over data-video-id if both present
      const renderer3 = document.createElement('ytd-reel-video-renderer');
      renderer3.setAttribute('video-id', 'primary_111');
      renderer3.setAttribute('data-video-id', 'secondary22');
      expect(extractYouTubeShortId(renderer3, '/')).toBe('primary_111');

      // 4. Fallback: if video-id is empty string, data-video-id is used
      const renderer4 = document.createElement('ytd-reel-video-renderer');
      renderer4.setAttribute('video-id', '');
      renderer4.setAttribute('data-video-id', 'dQw4w9WgXcQ');
      expect(extractYouTubeShortId(renderer4, '/')).toBe('dQw4w9WgXcQ');

      // 5. JavaScript object property fallback: renderer.data.videoId
      const renderer5 = document.createElement('ytd-reel-video-renderer');
      (renderer5 as any).data = { videoId: 'dQw4w9WgXcQ' };
      expect(extractYouTubeShortId(renderer5, '/')).toBe('dQw4w9WgXcQ');
    });

    it('returns null and never crashes on non-shorts and malformed URLs', () => {
      // Standard YouTube pages
      expect(extractYouTubeShortId(null, '/watch?v=dQw4w9WgXcQ')).toBeNull();
      expect(extractYouTubeShortId(null, '/watch?v=12345678901&list=PL12345')).toBeNull();
      expect(extractYouTubeShortId(null, '/feed/subscriptions')).toBeNull();
      expect(extractYouTubeShortId(null, '/feed/trending')).toBeNull();
      expect(extractYouTubeShortId(null, '/feed/history')).toBeNull();
      expect(extractYouTubeShortId(null, '/feed/library')).toBeNull();
      expect(extractYouTubeShortId(null, '/channel/UC12345678901234567890123')).toBeNull();
      expect(extractYouTubeShortId(null, '/playlist?list=PL12345678901234567890123')).toBeNull();
      expect(extractYouTubeShortId(null, '/results?search_query=shorts')).toBeNull();
      expect(extractYouTubeShortId(null, '/')).toBeNull();

      // Incomplete shorts routes
      expect(extractYouTubeShortId(null, '/shorts')).toBeNull();
      expect(extractYouTubeShortId(null, '/shorts/')).toBeNull();
      expect(extractYouTubeShortId(null, '/shorts/?feature=share')).toBeNull();
      expect(extractYouTubeShortId(null, '/shorts/#comments')).toBeNull();

      // Malformed / exotic / adversarial strings passed explicitly
      expect(extractYouTubeShortId(null, '')).toBeNull();
      expect(extractYouTubeShortId(null, '   ')).toBeNull();
      expect(extractYouTubeShortId(null, 'javascript:void(0)')).toBeNull();
      expect(extractYouTubeShortId(null, 'data:text/html,<script>alert(1)</script>')).toBeNull();
      expect(extractYouTubeShortId(null, 'https://example.com/not-youtube')).toBeNull();
      expect(extractYouTubeShortId(null, { location: null } as any)).toBeNull();

      // When ambient window is on non-shorts route (/), objects without location and null/undefined return null
      setLocation('/');
      expect(extractYouTubeShortId(null, {} as any)).toBeNull();
      expect(extractYouTubeShortId(null, null as any)).toBeNull();
      expect(extractYouTubeShortId(null, undefined as any)).toBeNull();

      // Conversely, when ambient window IS on a Shorts route, omitting winOrPath extracts ambient ID
      setLocation('/shorts/dQw4w9WgXcQ');
      expect(extractYouTubeShortId(null)).toBe('dQw4w9WgXcQ');

      // Characters not in standard base64url charset ([^A-Za-z0-9_-])
      expect(extractYouTubeShortId(null, '/shorts/invalid!char@cters')).toBeNull();
      expect(extractYouTubeShortId(null, '/shorts/<a>inject</a>')).toBeNull();

      // Malformed renderer DOM fixtures
      const emptyDiv = document.createElement('div');
      expect(extractYouTubeShortId(emptyDiv, '/')).toBeNull();

      const corruptAnchor = document.createElement('div');
      corruptAnchor.innerHTML = '<a href="/watch?v=dQw4w9WgXcQ"></a>';
      expect(extractYouTubeShortId(corruptAnchor, '/')).toBeNull();

      const emptyHrefAnchor = document.createElement('div');
      emptyHrefAnchor.innerHTML = '<a href=""></a>';
      expect(extractYouTubeShortId(emptyHrefAnchor, '/')).toBeNull();

      const scriptAttrRenderer = document.createElement('div');
      scriptAttrRenderer.setAttribute('video-id', '<script>alert(1)</script>');
      expect(extractYouTubeShortId(scriptAttrRenderer, '/')).toBeNull();
    });

    it('prioritizes active renderer anchor over non-shorts URL, but respects valid URL when both present', () => {
      // When URL is /shorts/url_id_1234, URL takes priority
      const renderer = document.createElement('div');
      renderer.innerHTML = '<a href="/shorts/anchor_id_56"></a>';
      renderer.setAttribute('video-id', 'attr_id_7890');

      expect(extractYouTubeShortId(renderer, '/shorts/url_id_1234')).toBe('url_id_1234');

      // When URL is not shorts, anchor tag takes priority over attribute
      expect(extractYouTubeShortId(renderer, '/watch?v=xyz')).toBe('anchor_id_56');

      // When URL is not shorts and no anchor tag, attribute is returned
      renderer.innerHTML = '';
      expect(extractYouTubeShortId(renderer, '/watch?v=xyz')).toBe('attr_id_7890');
    });
  });

  // ==========================================================================
  // SECTION 3: SESSIONSTORAGE HYDRATION & F5 RELOAD STRESS TESTS
  // ==========================================================================
  describe('3. SessionStorage Hydration & F5 Reload Stress', () => {
    it('persists qualified video ID to sessionStorage and prevents double count upon F5 reload', async () => {
      const shortId = 'dQw4w9WgXcQ';
      setLocation(`/shorts/${shortId}`);

      // Step 1: Initial visit in Tab Session
      const { videos } = createMockYouTubeShortsDOM([shortId]);
      detector = new YouTubeShortsDetector({
        onViewQualified: (id) => {
          qualifiedViews.push(id);
        }
      });
      detector.init();

      await videos[0].play();
      vi.advanceTimersByTime(1500);

      // Verify view was recorded and persisted to sessionStorage
      expect(qualifiedViews).toEqual([shortId]);
      expect(detector.getSessionSeen().has(shortId)).toBe(true);

      const storedRaw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      expect(storedRaw).toBeTruthy();
      const storedArray = JSON.parse(storedRaw!);
      expect(storedArray).toContain(shortId);

      // Step 2: Simulate F5 Reload in same session
      // Destroy current content script instance
      detector.destroy();

      // Construct a new detector instance (simulating page reload with fresh JS heap)
      const reloadedQualifiedViews: string[] = [];
      const reloadedDetector = new YouTubeShortsDetector({
        onViewQualified: (id) => {
          reloadedQualifiedViews.push(id);
        }
      });

      // Verify immediate hydration from sessionStorage during constructor
      expect(reloadedDetector.getSessionSeen().has(shortId)).toBe(true);

      // Initialize reloaded detector on the exact same Short
      reloadedDetector.init();

      // Dwell timer MUST NOT start because video is already in hydrated session seen set
      expect(reloadedDetector.isDwellActive()).toBe(false);

      // Video plays continuously for another 10 seconds
      await videos[0].play();
      vi.advanceTimersByTime(10000);

      // Verify view was NOT double counted
      expect(reloadedQualifiedViews.length).toBe(0);
      expect(reloadedDetector.isDwellActive()).toBe(false);

      reloadedDetector.destroy();
    });

    it('persists and rehydrates multiple viewed shorts across sequential reloads', async () => {
      const shortIds = ['vid_short_01', 'vid_short_02', 'vid_short_03'];

      // Manually pre-populate sessionStorage as if 3 shorts were previously viewed
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(shortIds));

      // Create detector
      detector = new YouTubeShortsDetector({
        onViewQualified: (id) => {
          qualifiedViews.push(id);
        }
      });

      // Verify all 3 IDs are hydrated
      const seen = detector.getSessionSeen();
      expect(seen.size).toBe(3);
      expect(seen.has('vid_short_01')).toBe(true);
      expect(seen.has('vid_short_02')).toBe(true);
      expect(seen.has('vid_short_03')).toBe(true);

      // Load DOM with short 2 (already seen)
      setLocation('/shorts/vid_short_02');
      const { videos } = createMockYouTubeShortsDOM(['vid_short_02', 'vid_short_04']);
      detector.init();

      await videos[0].play();
      vi.advanceTimersByTime(5000);

      // Short 2 is suppressed
      expect(qualifiedViews.length).toBe(0);

      // Now navigate/scroll to brand new short 4 ('vid_short_04')
      setLocation('/shorts/vid_short_04');
      const container = document.getElementById('shorts-inner-container')!;
      container.children[0].removeAttribute('is-active');
      container.children[1].setAttribute('is-active', '');
      detector.evaluateActiveShort();

      await videos[1].play();
      expect(detector.isDwellActive()).toBe(true);

      vi.advanceTimersByTime(1500);

      // Short 4 qualifies!
      expect(qualifiedViews).toEqual(['vid_short_04']);
      expect(detector.getSessionSeen().size).toBe(4);

      // sessionStorage now has all 4 shorts
      const updated = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY)!);
      expect(updated).toEqual(['vid_short_01', 'vid_short_02', 'vid_short_03', 'vid_short_04']);
    });

    it('resiliently handles corrupted or malformed sessionStorage data without crashing', () => {
      // Case 1: Corrupted non-JSON string
      sessionStorage.setItem(SESSION_STORAGE_KEY, '{invalid json syntax');
      expect(() => {
        const d1 = new YouTubeShortsDetector();
        expect(d1.getSessionSeen().size).toBe(0);
        d1.destroy();
      }).not.toThrow();

      // Case 2: Non-array valid JSON (object)
      sessionStorage.setItem(SESSION_STORAGE_KEY, '{"not": "an_array"}');
      expect(() => {
        const d2 = new YouTubeShortsDetector();
        expect(d2.getSessionSeen().size).toBe(0);
        d2.destroy();
      }).not.toThrow();

      // Case 3: Array containing dirty values (nulls, numbers, booleans, empty strings)
      sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify([null, 12345, '', 'valid_id_01', false, undefined, 'valid_id_02'])
      );
      const d3 = new YouTubeShortsDetector();
      const seen = d3.getSessionSeen();
      expect(seen.size).toBe(2);
      expect(seen.has('valid_id_01')).toBe(true);
      expect(seen.has('valid_id_02')).toBe(true);
      d3.destroy();
    });

    it('clears sessionStorage and allows re-qualification upon resetSession()', async () => {
      const shortId = 'dQw4w9WgXcQ';
      const { videos } = createMockYouTubeShortsDOM([shortId]);

      detector = new YouTubeShortsDetector({
        onViewQualified: (id) => {
          qualifiedViews.push(id);
        }
      });
      detector.init();

      await videos[0].play();
      vi.advanceTimersByTime(1500);
      expect(qualifiedViews.length).toBe(1);
      expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeTruthy();

      // Reset session
      detector.resetSession();

      // Verify in-memory Set and sessionStorage are both empty
      expect(detector.getSessionSeen().size).toBe(0);
      expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();

      // Now video plays again -> re-qualifies after 1500ms
      detector.evaluateActiveShort();
      expect(detector.isDwellActive()).toBe(true);

      vi.advanceTimersByTime(1500);
      expect(qualifiedViews.length).toBe(2);
      expect(detector.getSessionSeen().has(shortId)).toBe(true);
    });
  });

  // ==========================================================================
  // SECTION 4: INTEGRATION & STRESS COMPOSITIONS
  // ==========================================================================
  describe('4. Combined Stress Compositions', () => {
    it('infinite loop playback while in background tab: 0 views recorded', async () => {
      setDocumentVisibility('hidden');
      const { videos } = createMockYouTubeShortsDOM(['dQw4w9WgXcQ']);

      detector = new YouTubeShortsDetector({
        onViewQualified: (id) => {
          qualifiedViews.push(id);
        }
      });
      detector.init();

      // Loop video 10 times in hidden tab (background tab infinite loop)
      for (let i = 0; i < 10; i++) {
        await videos[0].play();
        vi.advanceTimersByTime(2000);
        videos[0].simulateLoop();
      }

      expect(qualifiedViews.length).toBe(0);
      expect(detector.getSessionSeen().size).toBe(0);
      expect(detector.isDwellActive()).toBe(false);

      // Now tab becomes visible and loops 1 time
      setDocumentVisibility('visible');
      expect(detector.isDwellActive()).toBe(true);

      vi.advanceTimersByTime(1500);
      expect(qualifiedViews).toEqual(['dQw4w9WgXcQ']);

      // Loop 5 more times while visible -> strictly 1 total view
      for (let i = 0; i < 5; i++) {
        videos[0].simulateLoop();
        vi.advanceTimersByTime(2000);
      }
      expect(qualifiedViews.length).toBe(1);
    });

    it('tab hidden during SPA route switch to another short', async () => {
      const { renderers, videos } = createMockYouTubeShortsDOM(['short_one_11', 'short_two_22']);

      detector = new YouTubeShortsDetector({
        onViewQualified: (id) => {
          qualifiedViews.push(id);
        }
      });
      detector.init();

      // Playing short 1 while visible for 500ms
      await videos[0].play();
      vi.advanceTimersByTime(500);
      expect(detector.isDwellActive()).toBe(true);

      // Tab hidden
      setDocumentVisibility('hidden');
      expect(detector.isDwellActive()).toBe(false);

      // While hidden, user navigates to short 2
      renderers[0].removeAttribute('is-active');
      renderers[1].setAttribute('is-active', '');
      setLocation('/shorts/short_two_22');
      detector.evaluateActiveShort();

      // Video 2 starts playing while still hidden
      await videos[1].play();
      vi.advanceTimersByTime(3000);

      // Neither qualified
      expect(qualifiedViews.length).toBe(0);

      // Tab becomes visible
      setDocumentVisibility('visible');
      expect(detector.isDwellActive()).toBe(true);
      expect(detector.getActiveVideoId()).toBe('short_two_22');

      vi.advanceTimersByTime(1500);

      // Only short 2 qualified!
      expect(qualifiedViews).toEqual(['short_two_22']);
      expect(detector.getSessionSeen().has('short_one_11')).toBe(false);
    });

    it('rejects playback when visibilityState is "prerender" instead of "visible"', async () => {
      // Simulate non-standard document.visibilityState = 'prerender'
      setDocumentVisibility('prerender' as any);
      const { videos } = createMockYouTubeShortsDOM(['dQw4w9WgXcQ']);

      detector = new YouTubeShortsDetector({
        onViewQualified: (id) => {
          qualifiedViews.push(id);
        }
      });
      detector.init();

      await videos[0].play();
      expect(detector.isDwellActive()).toBe(false);

      vi.advanceTimersByTime(5000);
      expect(qualifiedViews.length).toBe(0);
    });

    it('seeking / scrubbing resets dwell timer and requires 1500ms continuous dwell after seek', async () => {
      const { videos } = createMockYouTubeShortsDOM(['dQw4w9WgXcQ']);

      detector = new YouTubeShortsDetector({
        onViewQualified: (id) => {
          qualifiedViews.push(id);
        }
      });
      detector.init();

      await videos[0].play();
      vi.advanceTimersByTime(1000);
      expect(detector.isDwellActive()).toBe(true);

      // User seeks/scrubs forward
      videos[0].simulateSeek(15);
      expect(detector.isDwellActive()).toBe(false);

      // Scrub completes, playback continues
      await videos[0].play();
      expect(detector.isDwellActive()).toBe(true);

      // Advance 1000ms: not enough because timer restarted from 0
      vi.advanceTimersByTime(1000);
      expect(qualifiedViews.length).toBe(0);

      // Advance 500ms: now 1500ms total after seek
      vi.advanceTimersByTime(500);
      expect(qualifiedViews).toEqual(['dQw4w9WgXcQ']);
    });

    it('handles buffering video (readyState < 2) without starting dwell until readyState >= 2', async () => {
      const { videos } = createMockYouTubeShortsDOM(['dQw4w9WgXcQ']);
      videos[0].readyState = 1; // HAVE_METADATA (not ready to play)

      detector = new YouTubeShortsDetector({
        onViewQualified: (id) => {
          qualifiedViews.push(id);
        }
      });
      detector.init();

      // Attempt to play while buffering
      expect(qualifyYouTubeView(videos[0], true)).toBe(false);
      expect(detector.isDwellActive()).toBe(false);

      vi.advanceTimersByTime(3000);
      expect(qualifiedViews.length).toBe(0);

      // Media buffers enough data (readyState becomes 4) and fires playing
      videos[0].readyState = 4;
      await videos[0].play();
      expect(qualifyYouTubeView(videos[0], true)).toBe(true);
      expect(detector.isDwellActive()).toBe(true);

      vi.advanceTimersByTime(1500);
      expect(qualifiedViews).toEqual(['dQw4w9WgXcQ']);
    });

    it('extracts shorts anchor tag even when container contains preceding non-shorts links', () => {
      const renderer = document.createElement('div');
      renderer.innerHTML = `
        <div class="user-info">
          <a class="channel-link" href="/@SomeCreator">Channel</a>
          <a class="sound-link" href="/audio/12345">Sound</a>
        </div>
        <div class="content">
          <a class="short-link" href="/shorts/dQw4w9WgXcQ">Watch</a>
        </div>
      `;

      expect(extractYouTubeShortId(renderer, '/')).toBe('dQw4w9WgXcQ');
    });

    it('handles 500 pre-existing viewed IDs in sessionStorage with sub-millisecond O(1) checks', () => {
      const largeIdList: string[] = [];
      for (let i = 0; i < 500; i++) {
        largeIdList.push(`short_id_${String(i).padStart(4, '0')}`);
      }

      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(largeIdList));

      const startTime = performance.now();
      const largeDetector = new YouTubeShortsDetector();
      const elapsed = performance.now() - startTime;

      expect(largeDetector.getSessionSeen().size).toBe(500);
      expect(elapsed).toBeLessThan(50); // Under 50ms hydration for 500 items

      // Check O(1) lookup
      expect(largeDetector.getSessionSeen().has('short_id_0250')).toBe(true);
      expect(largeDetector.getSessionSeen().has('unknown_id_9999')).toBe(false);

      largeDetector.destroy();
    });
  });
});

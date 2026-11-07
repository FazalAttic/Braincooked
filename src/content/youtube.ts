/**
 * src/content/youtube.ts
 * Brainroad YouTube Shorts Content Script
 * 
 * Manifest V3 compliant detection engine implementing:
 * 1. SPA Navigation Detection (yt-navigate-finish, popstate, hashchange, navigation API, and URL polling/monitoring).
 * 2. Active Short Observation via MutationObserver targeted on attributeFilter: ['is-active'] on <ytd-shorts>.
 * 3. Robust Video ID extraction cascade (/shorts/([A-Za-z0-9_-]{11})/) across window.location, anchor links, and renderer attributes.
 * 4. Continuous >= 1500ms View Gate Qualification (active container, unpaused playback, tab visible, not ended).
 * 5. Session Deduplication (in-memory Set<string> + sessionStorage cache) suppressing duplicate loops & re-scrolls.
 * 6. Typed message dispatch (RECORD_VIEW) to the background service worker.
 * 7. Dual packaging export: self-executing in live browser, fully modular for unit testing.
 */

import type { MessageRequest } from '../shared/types';
import { CountBubbleController } from './overlay';

// ============================================================================
// 1. CONSTANTS & REGEX MATCHERS
// ============================================================================

export const YOUTUBE_SHORTS_REGEX = /\/shorts\/([A-Za-z0-9_-]{11})(?:[/?#]|$)/;
export const YOUTUBE_SHORTS_FALLBACK_REGEX = /\/shorts\/([A-Za-z0-9_-]+)(?:[/?#]|$)/;

export const DEFAULT_VIEW_DURATION_THRESHOLD_MS = 1500;
export const VIEW_DURATION_THRESHOLD_MS = DEFAULT_VIEW_DURATION_THRESHOLD_MS;
export const SESSION_STORAGE_KEY = 'brainroad_yt_session';

// ============================================================================
// 2. VIDEO ID EXTRACTION CASCADE
// ============================================================================

/**
 * Extracts the YouTube video ID using a robust cascade:
 * 1. Current window/URL pathname matching /shorts/([A-Za-z0-9_-]{11})(?:[/?#]|$) or fallback
 * 2. Active renderer anchor tag: a[href*="/shorts/"]
 * 3. Active renderer element attributes: video-id, data-video-id, or data.videoId
 */
export function extractYouTubeShortId(
  renderer?: Element | null,
  winOrPath?: Window | string
): string | null {
  // Strategy 1: URL Pathname Extraction
  let pathname = '';
  if (typeof winOrPath === 'string') {
    pathname = winOrPath;
  } else if (winOrPath && typeof winOrPath === 'object' && 'location' in winOrPath) {
    pathname = (winOrPath as Window).location?.pathname || (winOrPath as Window).location?.href || '';
  } else if (typeof window !== 'undefined' && window.location) {
    pathname = window.location.pathname || window.location.href || '';
  }

  if (pathname) {
    const strictMatch = pathname.match(YOUTUBE_SHORTS_REGEX);
    if (strictMatch && strictMatch[1]) {
      return strictMatch[1];
    }
    const fallbackMatch = pathname.match(YOUTUBE_SHORTS_FALLBACK_REGEX);
    if (fallbackMatch && fallbackMatch[1]) {
      return fallbackMatch[1];
    }
  }

  // Strategy 2: Active Renderer Anchor Links
  if (renderer) {
    const anchor = renderer.querySelector<HTMLAnchorElement>('a[href*="/shorts/"]');
    if (anchor) {
      const href = anchor.getAttribute('href') || anchor.href || '';
      const anchorMatch = href.match(YOUTUBE_SHORTS_REGEX);
      if (anchorMatch && anchorMatch[1]) {
        return anchorMatch[1];
      }
      const anchorFallback = href.match(YOUTUBE_SHORTS_FALLBACK_REGEX);
      if (anchorFallback && anchorFallback[1]) {
        return anchorFallback[1];
      }
    }

    // Strategy 3: Renderer element attributes or data properties
    const attrId =
      renderer.getAttribute('video-id') ||
      renderer.getAttribute('data-video-id') ||
      (renderer as any).data?.videoId ||
      (renderer as any).videoId;

    if (attrId && typeof attrId === 'string' && /^[A-Za-z0-9_-]+$/.test(attrId)) {
      return attrId;
    }
  }

  return null;
}

// Alias for blueprint compatibility
export const extractActiveVideoId = extractYouTubeShortId;

// ============================================================================
// 3. VIEW GATE QUALIFICATION HELPER
// ============================================================================

/**
 * Validates whether the active video element and document meet instantaneous playback criteria.
 */
export function qualifyYouTubeView(video: HTMLVideoElement | null, isVisible: boolean): boolean {
  if (!video) return false;
  return (
    isVisible &&
    !video.paused &&
    !video.ended &&
    (video.readyState === undefined || video.readyState >= 2)
  );
}

// ============================================================================
// 4. MESSAGING DISPATCHER
// ============================================================================

export async function sendYouTubeRecordView(
  chromeInstance: typeof chrome,
  videoId: string,
  timestamp: number = Date.now()
): Promise<{ ok: boolean; newlyCounted?: boolean; error?: string }> {
  if (!chromeInstance?.runtime?.sendMessage) {
    return { ok: false, error: 'Extension context unavailable' };
  }

  const payload: MessageRequest = {
    type: 'RECORD_VIEW',
    platform: 'youtube',
    id: videoId,
    timestamp
  };

  try {
    const res = await chromeInstance.runtime.sendMessage(payload);
    return res || { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// ============================================================================
// 5. YOUTUBE SHORTS DETECTOR CONTROLLER & CLASS
// ============================================================================

export interface YouTubeDetectorOptions {
  chrome?: typeof globalThis.chrome;
  window?: Window;
  document?: Document;
  dwellMs?: number;
  onViewQualified?: (videoId: string) => Promise<void> | void;
}

/**
 * Core YouTube Shorts Detection, View Qualification, and Session Deduplication Engine
 */
export class YouTubeShortsDetector {
  private chromeApi: typeof globalThis.chrome;
  private win: Window;
  private doc: Document;
  private readonly dwellMs: number;
  private onViewQualified: (videoId: string) => Promise<void> | void;

  private sessionViewedIds = new Set<string>();
  private activeVideoId: string | null = null;
  private activeVideoElement: HTMLVideoElement | null = null;
  private activeRenderer: Element | null = null;
  private activeTimer: number | null = null;

  private isTracking = true;
  private mutationObserver: MutationObserver | null = null;
  private lastUrl = '';

  // Bound listeners for clean lifecycle attachment and teardown
  private onYtNavigateFinishBound: () => void;
  private onPopStateBound: () => void;
  private onHashChangeBound: () => void;
  private onVisibilityChangeBound: () => void;
  private onNavigateBound: (e: any) => void;
  private onRuntimeMessageBound: (msg: any) => void;

  private boundVideoPlay: () => void;
  private boundVideoPause: () => void;

  private onDocumentPlayBound: () => void;
  private onDocumentPlayingBound: () => void;

  constructor(options: YouTubeDetectorOptions = {}) {
    this.chromeApi = options.chrome ?? (typeof chrome !== 'undefined' ? chrome : ({} as any));
    this.win = options.window ?? (typeof window !== 'undefined' ? window : ({} as any));
    this.doc = options.document ?? (typeof document !== 'undefined' ? document : ({} as any));
    this.dwellMs = options.dwellMs ?? DEFAULT_VIEW_DURATION_THRESHOLD_MS;
    this.onViewQualified = options.onViewQualified ?? this.defaultDispatchView.bind(this);

    this.onYtNavigateFinishBound = () => this.handleNavigationChange();
    this.onPopStateBound = () => this.handleNavigationChange();
    this.onHashChangeBound = () => this.handleNavigationChange();
    this.onVisibilityChangeBound = () => this.handleVisibilityChange();
    this.onNavigateBound = () => this.handleNavigationChange();
    this.onRuntimeMessageBound = (msg: any) => this.handleRuntimeMessage(msg);

    this.boundVideoPlay = () => this.onVideoPlay();
    this.boundVideoPause = () => this.onVideoPause();

    this.onDocumentPlayBound = () => this.evaluateActiveShort();
    this.onDocumentPlayingBound = () => this.evaluateActiveShort();

    if (this.win?.location?.href) {
      this.lastUrl = this.win.location.href;
    }

    // Hydrate in-memory session deduplication set from sessionStorage if available
    this.hydrateSessionFromStorage();
  }

  /**
   * Initializes navigation listeners, DOM MutationObserver, and inspects initial DOM.
   */
  public init(): void {
    if (!this.doc) return;

    // 1. YouTube SPA Navigation lifecycle events
    if (this.win?.addEventListener) {
      this.win.addEventListener('yt-navigate-finish', this.onYtNavigateFinishBound);
      this.win.addEventListener('popstate', this.onPopStateBound);
      this.win.addEventListener('hashchange', this.onHashChangeBound);

      if ('navigation' in this.win && (this.win as any).navigation?.addEventListener) {
        try {
          (this.win as any).navigation.addEventListener('navigate', this.onNavigateBound);
        } catch {
          // Navigation API not fully supported
        }
      }
    }

    // 2. Document visibility listener
    if (this.doc.addEventListener) {
      this.doc.addEventListener('visibilitychange', this.onVisibilityChangeBound);

      // Capture-phase media listeners: any Short starting to play (even when the
      // `is-active` attribute is absent on the current YouTube UI) triggers a
      // re-evaluation of the active short.
      this.doc.addEventListener('play', this.onDocumentPlayBound, true);
      this.doc.addEventListener('playing', this.onDocumentPlayingBound, true);
    }

    // 3. Runtime message listener for session/stats resets
    if (this.chromeApi?.runtime?.onMessage?.addListener) {
      try {
        this.chromeApi.runtime.onMessage.addListener(this.onRuntimeMessageBound);
      } catch {
        // Suppress if mock chrome without addListener
      }
    }

    // 4. MutationObserver watching for [is-active] toggles on Shorts renderers
    this.setupMutationObserver();

    // 5. Initial evaluation on page load / script injection
    this.evaluateActiveShort();
  }

  /**
   * Sets up MutationObserver targeting attribute changes on [is-active] and childList.
   */
  private setupMutationObserver(): void {
    if (typeof MutationObserver === 'undefined') return;

    try {
      this.mutationObserver = new MutationObserver((mutations) => {
        if (!this.isTracking) return;

        // Check if URL changed behind the scenes (history.replaceState during infinite scroll)
        if (this.win?.location?.href && this.win.location.href !== this.lastUrl) {
          this.lastUrl = this.win.location.href;
        }

        let shouldEvaluate = false;

        for (const mut of mutations) {
          if (mut.type === 'attributes') {
            if (
              mut.attributeName === 'is-active' ||
              mut.attributeName === 'video-id' ||
              mut.attributeName === 'data-video-id'
            ) {
              shouldEvaluate = true;
              break;
            }
          } else if (mut.type === 'childList') {
            if (mut.addedNodes && mut.addedNodes.length > 0) {
              shouldEvaluate = true;
              break;
            }
          }
        }

        if (shouldEvaluate) {
          this.evaluateActiveShort();
        }
      });

      const rootElement =
        this.doc.querySelector('ytd-shorts') ||
        this.doc.getElementById('page-manager') ||
        this.doc.body ||
        (this.doc as any).documentElement;

      if (rootElement) {
        this.mutationObserver.observe(rootElement, {
          attributes: true,
          attributeFilter: ['is-active', 'video-id', 'data-video-id'],
          childList: true,
          subtree: true
        });
      }
    } catch {
      // Suppress if MutationObserver cannot be constructed in test env
    }
  }

  /**
   * Locates the currently active Short's renderer and <video> element using a
   * resilient cascade that works across YouTube UI variations:
   *   1. <ytd-reel-video-renderer[is-active]> (classic Shorts UI)
   *   2. #shorts-player video (newer Shorts player container)
   *   3. The actively-playing <video> inside any reel renderer
   *   4. Any actively-playing <video> inside <ytd-shorts>
   */
  private locateActiveShort(): { renderer: Element; video: HTMLVideoElement } | null {
    // 1. Classic [is-active] renderer marker
    const activeRenderer =
      this.doc.querySelector<Element>('ytd-shorts ytd-reel-video-renderer[is-active]') ||
      this.doc.querySelector<Element>('ytd-reel-video-renderer[is-active]');

    if (activeRenderer) {
      const video = activeRenderer.querySelector<HTMLVideoElement>('video');
      if (video) {
        return { renderer: activeRenderer, video };
      }
    }

    // 2. Newer #shorts-player container fallback
    const shortsPlayerVideo = this.doc.querySelector<HTMLVideoElement>('#shorts-player video');
    if (shortsPlayerVideo) {
      const parent = shortsPlayerVideo.closest<Element>('ytd-reel-video-renderer');
      return { renderer: parent ?? shortsPlayerVideo, video: shortsPlayerVideo };
    }

    // 3. Any playing video inside a reel renderer (attribute-free detection)
    const renderers = this.doc.querySelectorAll<Element>('ytd-reel-video-renderer');
    for (const renderer of Array.from(renderers)) {
      const video = renderer.querySelector<HTMLVideoElement>('video');
      if (video && !video.paused && !video.ended) {
        return { renderer, video };
      }
    }

    // 4. Any playing video inside <ytd-shorts>
    const shortsRoot = this.doc.querySelector<Element>('ytd-shorts');
    if (shortsRoot) {
      const videos = shortsRoot.querySelectorAll<HTMLVideoElement>('video');
      for (const video of Array.from(videos)) {
        if (!video.paused && !video.ended) {
          const parent = video.closest<Element>('ytd-reel-video-renderer');
          return { renderer: parent ?? video, video };
        }
      }
    }

    return null;
  }

  /**
   * Evaluates the current YouTube page state, locates the active Short,
   * extracts its video ID, checks session deduplication, and coordinates the 1.5s view gate.
   */
  public evaluateActiveShort(): void {
    if (!this.isTracking) return;

    // Check if on a Shorts route
    const pathname = this.win?.location?.pathname || '';
    const href = this.win?.location?.href || '';
    const isShortsRoute = pathname.includes('/shorts') || href.includes('/shorts');

    if (!isShortsRoute) {
      // User navigated away from Shorts to /watch or /
      this.clearActiveObservation();
      return;
    }

    // Locate the active short (renderer + video) using a robust cascade that
    // does not hard-depend on the transient `is-active` attribute.
    const located = this.locateActiveShort();
    if (!located) {
      this.clearActiveObservation();
      return;
    }

    const activeRenderer = located.renderer;
    const video = located.video;

    // Extract video ID from active renderer or URL cascade
    const videoId = extractYouTubeShortId(activeRenderer, this.win);
    if (!videoId) {
      this.clearActiveObservation();
      return;
    }

    // Session deduplication check: if already viewed in this continuous session, suppress
    if (this.sessionViewedIds.has(videoId)) {
      this.clearActiveTimer();
      this.activeVideoId = videoId;
      this.activeRenderer = activeRenderer;
      this.activeVideoElement = video;
      return;
    }

    // If already actively tracking this exact video element and videoId, let timer run
    if (
      this.activeVideoId === videoId &&
      this.activeVideoElement === video &&
      this.activeRenderer === activeRenderer &&
      this.activeTimer !== null
    ) {
      return;
    }

    // New active short detected: clean up previous short observation
    this.clearActiveObservation();

    this.activeVideoId = videoId;
    this.activeRenderer = activeRenderer;
    this.activeVideoElement = video;

    // Attach media listeners to monitor playback gates
    this.attachVideoListeners(video);

    // If video is already playing and document is visible, begin qualification dwell timer
    if (qualifyYouTubeView(video, this.isDocumentVisible())) {
      this.startQualificationTimer(videoId, activeRenderer, video);
    }
  }

  /**
   * Initiates continuous dwell timer (>= 1500ms) for an active Short.
   */
  private startQualificationTimer(
    videoId: string,
    renderer: Element,
    video: HTMLVideoElement
  ): void {
    if (this.activeTimer !== null || this.sessionViewedIds.has(videoId)) {
      return;
    }

    const setTimeoutFn = this.win?.setTimeout ? this.win.setTimeout.bind(this.win) : setTimeout;

    this.activeTimer = setTimeoutFn(async () => {
      this.activeTimer = null;

      // Final verification of all qualification gates. We deliberately do NOT
      // require the transient `is-active` attribute (it is absent on some
      // YouTube UIs); the active short is instead implied by the renderer still
      // being attached and its video still actively playing.
      if (!this.isTracking) return;
      if (!this.isDocumentVisible()) return;
      if (renderer.isConnected === false || video.isConnected === false) return;
      if (video.paused || video.ended) return;
      if (this.sessionViewedIds.has(videoId)) return;

      // View qualified! Add to session deduplication store
      this.sessionViewedIds.add(videoId);
      this.persistSessionToStorage();

      try {
        await this.onViewQualified(videoId);
      } catch (err) {
        console.error('[Brainroad YT] Error dispatching qualified view:', err);
      }
    }, this.dwellMs) as unknown as number;
  }

  /**
   * Cancels any pending dwell qualification timer without detaching media listeners.
   */
  public clearActiveTimer(): void {
    if (this.activeTimer !== null) {
      const clearTimeoutFn = this.win?.clearTimeout ? this.win.clearTimeout.bind(this.win) : clearTimeout;
      clearTimeoutFn(this.activeTimer);
      this.activeTimer = null;
    }
  }

  /**
   * Completely clears active short observation, aborting timers and detaching video listeners.
   */
  public clearActiveObservation(): void {
    this.clearActiveTimer();

    if (this.activeVideoElement) {
      this.detachVideoListeners(this.activeVideoElement);
      this.activeVideoElement = null;
    }

    this.activeVideoId = null;
    this.activeRenderer = null;
  }

  /**
   * Attaches play/pause/stall/seek listeners to video element.
   */
  private attachVideoListeners(video: HTMLVideoElement): void {
    video.addEventListener?.('play', this.boundVideoPlay);
    video.addEventListener?.('playing', this.boundVideoPlay);
    video.addEventListener?.('pause', this.boundVideoPause);
    video.addEventListener?.('ended', this.boundVideoPause);
    video.addEventListener?.('waiting', this.boundVideoPause);
    video.addEventListener?.('stalled', this.boundVideoPause);
    video.addEventListener?.('seeking', this.boundVideoPause);
  }

  /**
   * Detaches listeners from video element.
   */
  private detachVideoListeners(video: HTMLVideoElement): void {
    video.removeEventListener?.('play', this.boundVideoPlay);
    video.removeEventListener?.('playing', this.boundVideoPlay);
    video.removeEventListener?.('pause', this.boundVideoPause);
    video.removeEventListener?.('ended', this.boundVideoPause);
    video.removeEventListener?.('waiting', this.boundVideoPause);
    video.removeEventListener?.('stalled', this.boundVideoPause);
    video.removeEventListener?.('seeking', this.boundVideoPause);
  }

  /**
   * Responds to video 'play' or 'playing' events.
   */
  private onVideoPlay(): void {
    if (!this.isTracking || !this.activeVideoId || !this.activeRenderer || !this.activeVideoElement) {
      return;
    }

    if (this.sessionViewedIds.has(this.activeVideoId)) {
      this.clearActiveTimer();
      return;
    }

    if (qualifyYouTubeView(this.activeVideoElement, this.isDocumentVisible())) {
      this.startQualificationTimer(this.activeVideoId, this.activeRenderer, this.activeVideoElement);
    }
  }

  /**
   * Responds to video 'pause', 'ended', 'waiting', 'stalled', or 'seeking' events.
   * Cancels dwell timer immediately to eliminate paused/skimming false positives.
   */
  private onVideoPause(): void {
    this.clearActiveTimer();
  }

  /**
   * Handles document visibilitychange event (e.g. background tab switching).
   */
  private handleVisibilityChange(): void {
    if (!this.isTracking) return;

    if (!this.isDocumentVisible()) {
      // Tab hidden: abort active qualification timer
      this.clearActiveTimer();
    } else {
      // Tab became visible: if active video is currently playing, resume/restart qualification
      if (
        this.activeVideoId &&
        this.activeRenderer &&
        this.activeVideoElement &&
        !this.sessionViewedIds.has(this.activeVideoId) &&
        qualifyYouTubeView(this.activeVideoElement, true)
      ) {
        this.startQualificationTimer(this.activeVideoId, this.activeRenderer, this.activeVideoElement);
      }
    }
  }

  /**
   * Handles SPA history and custom navigation events.
   */
  private handleNavigationChange(): void {
    if (this.win?.location?.href) {
      this.lastUrl = this.win.location.href;
    }
    this.evaluateActiveShort();
  }

  /**
   * Responds to reset messages from popup or background.
   */
  private handleRuntimeMessage(msg: any): void {
    if (msg && (msg.type === 'RESET_STATS' || msg.type === 'RESET_SESSION')) {
      this.resetSession();
    }
  }

  /**
   * Checks whether the current document is visible.
   */
  private isDocumentVisible(): boolean {
    return (this.doc?.visibilityState || 'visible') === 'visible';
  }

  /**
   * Hydrates in-memory session deduplication set from sessionStorage.
   */
  private hydrateSessionFromStorage(): void {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const id of parsed) {
              if (typeof id === 'string' && id) {
                this.sessionViewedIds.add(id);
              }
            }
          }
        }
      }
    } catch {
      // Suppress security or storage disabled errors
    }
  }

  /**
   * Persists session deduplication set to sessionStorage.
   */
  private persistSessionToStorage(): void {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(
          SESSION_STORAGE_KEY,
          JSON.stringify(Array.from(this.sessionViewedIds))
        );
      }
    } catch {
      // Suppress security or quota errors
    }
  }

  /**
   * Default IPC message dispatcher to background service worker.
   */
  private async defaultDispatchView(videoId: string): Promise<void> {
    await sendYouTubeRecordView(this.chromeApi, videoId);
  }

  // ============================================================================
  // PUBLIC INSPECTION & CONTROL APIS
  // ============================================================================

  /**
   * Returns true if a dwell qualification timer is currently ticking.
   */
  public isDwellActive(): boolean {
    return this.activeTimer !== null;
  }

  /**
   * Returns the current active video ID being observed, or null if none.
   */
  public getActiveVideoId(): string | null {
    return this.activeVideoId;
  }

  /**
   * Returns a copy of the in-memory session deduplication Set.
   */
  public getSessionSeen(): Set<string> {
    return new Set(this.sessionViewedIds);
  }

  /**
   * Extracts video ID using the 3-tier cascade.
   */
  public extractVideoId(renderer?: Element | null): string | null {
    return extractYouTubeShortId(renderer, this.win);
  }

  /**
   * Clears session deduplication cache and aborts active qualification timer.
   */
  public resetSession(): void {
    this.sessionViewedIds.clear();
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch {
      // Suppress
    }
    this.clearActiveObservation();
  }

  /**
   * Tears down all event listeners, observers, and timers cleanly.
   */
  public destroy(): void {
    this.isTracking = false;
    this.clearActiveObservation();

    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    if (this.win?.removeEventListener) {
      this.win.removeEventListener('yt-navigate-finish', this.onYtNavigateFinishBound);
      this.win.removeEventListener('popstate', this.onPopStateBound);
      this.win.removeEventListener('hashchange', this.onHashChangeBound);
      if ('navigation' in this.win && (this.win as any).navigation?.removeEventListener) {
        try {
          (this.win as any).navigation.removeEventListener('navigate', this.onNavigateBound);
        } catch {
          // Suppress
        }
      }
    }

    if (this.doc?.removeEventListener) {
      this.doc.removeEventListener('visibilitychange', this.onVisibilityChangeBound);
      this.doc.removeEventListener('play', this.onDocumentPlayBound, true);
      this.doc.removeEventListener('playing', this.onDocumentPlayingBound, true);
    }

    if (this.chromeApi?.runtime?.onMessage?.removeListener) {
      try {
        this.chromeApi.runtime.onMessage.removeListener(this.onRuntimeMessageBound);
      } catch {
        // Suppress
      }
    }
  }
}

// ============================================================================
// 6. FACTORY & LIFECYCLE FUNCTIONS
// ============================================================================

export interface YouTubeDetectorController {
  extractVideoId: (renderer?: Element | null) => string | null;
  evaluateActiveShort: () => void;
  isDwellActive: () => boolean;
  getActiveVideoId: () => string | null;
  getSessionSeen: () => Set<string>;
  resetSession: () => void;
  destroy: () => void;
  detector: YouTubeShortsDetector;
}

/**
 * Factory function creating a YouTubeDetectorController.
 */
export function createYouTubeDetector(
  options?: YouTubeDetectorOptions
): YouTubeDetectorController {
  const detector = new YouTubeShortsDetector(options);
  detector.init();

  return {
    extractVideoId: (renderer?: Element | null) => detector.extractVideoId(renderer),
    evaluateActiveShort: () => detector.evaluateActiveShort(),
    isDwellActive: () => detector.isDwellActive(),
    getActiveVideoId: () => detector.getActiveVideoId(),
    getSessionSeen: () => detector.getSessionSeen(),
    resetSession: () => detector.resetSession(),
    destroy: () => detector.destroy(),
    detector
  };
}

/**
 * Initializes YouTube Shorts content script tracking and returns a teardown function.
 */
export function initYouTubeTracking(options?: YouTubeDetectorOptions): () => void {
  const detector = new YouTubeShortsDetector(options);
  detector.init();
  return () => detector.destroy();
}

export const initYouTubeContentScript = initYouTubeTracking;

// ============================================================================
// 7. AUTO-INITIALIZATION IN LIVE BROWSER
// ============================================================================

if (
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  typeof chrome !== 'undefined' &&
  chrome.runtime &&
  chrome.runtime.id &&
  !(window as any).__BRAINROAD_TEST_ENV__
) {
  try {
    const liveDetector = new YouTubeShortsDetector({
      chrome,
      window,
      document
    });
    liveDetector.init();
    (window as any).__brainroadYouTube = liveDetector;
    console.log('[Brainroad] YouTube Shorts content script active');

    // Floating live-count bubble pinned to the top of the page
    try {
      const bubble = new CountBubbleController({ chrome, document });
      bubble.mount();
      (window as any).__brainroadYouTubeBubble = bubble;
    } catch (bubbleErr) {
      console.error('[Brainroad] Failed to mount YouTube count bubble:', bubbleErr);
    }
  } catch (err) {
    console.error('[Brainroad] Failed to initialize YouTube Shorts detector:', err);
  }
}

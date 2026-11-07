/**
 * src/content/instagram.ts
 * Brainroad Instagram Content Script
 * 
 * Manifest V3 compliant detection engine implementing:
 * 1. SPA Navigation Detection (window.navigation, popstate, hashchange, URL-monitoring MutationObserver).
 * 2. Zero-Class DOM Traversal (strictly semantic elements: article, video, div[role="dialog"], div[data-pressable-container="true"]).
 * 3. Robust Base64 Shortcode Extraction from DOM permalink anchors and URL pathnames.
 * 4. Triple-Gate Qualification:
 *    - Spatial Gate: intersection ratio >= 0.60
 *    - Playback Gate: unpaused, not ended, readyState >= 2, document visible
 *    - Temporal Gate: continuous non-cumulative dwell >= 1500ms
 * 5. In-Memory Session Deduplication (Set<string>).
 * 6. Resilient Service Worker Messaging Bus (RECORD_VIEW).
 */

import type { MessageRequest } from '../shared/types';
import { CountBubbleController } from './overlay';

// ============================================================================
// 1. CONSTANTS & REGEX MATCHERS
// ============================================================================

export const REEL_PATH_REGEX = /\/(?:reel|reels)\/([A-Za-z0-9_-]+)/;
export const POST_PATH_REGEX = /\/p\/([A-Za-z0-9_-]+)/;

export const DEFAULT_DWELL_MS = 1500;
export const DEFAULT_VISIBILITY_THRESHOLD = 0.60;

// Aliases for blueprint compatibility
export const DWELL_THRESHOLD_MS = DEFAULT_DWELL_MS;
export const VISIBILITY_THRESHOLD_RATIO = DEFAULT_VISIBILITY_THRESHOLD;

// ============================================================================
// 2. ZERO-CLASS DOM TRAVERSAL & SHORTCODE EXTRACTION
// ============================================================================

/**
 * Extracts a unique reel shortcode from a video element or current window/pathname context.
 * Strictly avoids minified CSS class names.
 * Supports:
 * - /reel/<shortcode>/ and /reels/<shortcode>/ permalink anchors in parent post container
 * - /p/<shortcode>/ fallback for feed video posts (namespaced as p_<shortcode>)
 * - URL pathname fallback when on dedicated /reel/<shortcode>/ or /reels/<shortcode>/ pages
 */
export function extractReelShortcode(
  video: HTMLVideoElement | Element | null,
  winOrPath?: Window | string
): string | null {
  if (!video) return null;

  // Strategy 1: Find enclosing post or reel container
  if (typeof (video as HTMLElement).closest === 'function') {
    const container = (video as HTMLElement).closest(
      'article, div[data-pressable-container="true"], div[role="dialog"]'
    );

    if (container) {
      // 1a. Explicit reel anchor (/reel/ or /reels/)
      const reelAnchor = container.querySelector<HTMLAnchorElement>('a[href*="/reel/"], a[href*="/reels/"]');
      if (reelAnchor) {
        const href = reelAnchor.getAttribute('href') || reelAnchor.href || '';
        const match = href.match(REEL_PATH_REGEX);
        if (match && match[1]) {
          return match[1];
        }
      }

      // 1b. Feed video post fallback (/p/<shortcode>/)
      const postAnchor = container.querySelector<HTMLAnchorElement>('a[href*="/p/"]');
      if (postAnchor) {
        const href = postAnchor.getAttribute('href') || postAnchor.href || '';
        const match = href.match(POST_PATH_REGEX);
        if (match && match[1]) {
          return `p_${match[1]}`;
        }
      }
    }
  }

  // Strategy 2: URL pathname fallback (string parameter or window.location.pathname)
  if (typeof winOrPath === 'string') {
    const match = winOrPath.match(REEL_PATH_REGEX);
    if (match && match[1]) {
      return match[1];
    }
  } else {
    const win = (winOrPath && typeof winOrPath === 'object')
      ? winOrPath
      : (typeof window !== 'undefined' ? window : null);

    const pathname = win?.location?.pathname || '';
    if (pathname) {
      const urlMatch = pathname.match(REEL_PATH_REGEX);
      if (urlMatch && urlMatch[1]) {
        return urlMatch[1];
      }
    }
  }

  return null;
}

// ============================================================================
// 3. MESSAGING DISPATCHER
// ============================================================================

export async function sendRecordView(
  chromeInstance: typeof chrome,
  shortcode: string,
  timestamp: number = Date.now()
): Promise<{ ok: boolean; newlyCounted?: boolean; error?: string }> {
  if (!chromeInstance?.runtime?.sendMessage) {
    return { ok: false, error: 'Extension context unavailable' };
  }

  const payload: MessageRequest = {
    type: 'RECORD_VIEW',
    platform: 'instagram',
    id: shortcode,
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
// 4. INSTAGRAM DETECTOR CONTROLLER & CLASS
// ============================================================================

export interface InstagramDetectorOptions {
  chrome?: typeof globalThis.chrome;
  window?: Window;
  document?: Document;
  dwellMs?: number;
  visibilityRatio?: number;
  onViewQualified?: (shortcode: string) => Promise<void> | void;
}

/**
 * Core Instagram Reel Detection, Qualification, and Session Deduplication Engine
 */
export class InstagramReelDetector {
  private chromeApi: typeof globalThis.chrome;
  private win: Window;
  private doc: Document;
  private readonly dwellMs: number;
  private readonly visibilityRatio: number;
  private onViewQualified: (shortcode: string) => Promise<void> | void;

  private sessionSeen = new Set<string>();
  private activeTimers = new Map<HTMLVideoElement, number>();
  private monitoredVideos = new Set<HTMLVideoElement>();
  private videoRatios = new WeakMap<HTMLVideoElement, number>();
  private intersectionObserver: IntersectionObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private isTracking = true;
  private lastUrl = '';

  // Bound event listeners for clean teardown
  private onVisibilityChangeBound: () => void;
  private onPopStateBound: () => void;
  private onHashChangeBound: () => void;
  private onNavigateBound: (e: any) => void;

  constructor(options: InstagramDetectorOptions = {}) {
    this.chromeApi = options.chrome ?? (typeof chrome !== 'undefined' ? chrome : ({} as any));
    this.win = options.window ?? (typeof window !== 'undefined' ? window : ({} as any));
    this.doc = options.document ?? (typeof document !== 'undefined' ? document : ({} as any));
    this.dwellMs = options.dwellMs ?? DEFAULT_DWELL_MS;
    this.visibilityRatio = options.visibilityRatio ?? DEFAULT_VISIBILITY_THRESHOLD;
    this.onViewQualified = options.onViewQualified ?? this.defaultDispatchView.bind(this);

    this.onVisibilityChangeBound = this.handleVisibilityChange.bind(this);
    this.onPopStateBound = () => this.handleNavigationChange();
    this.onHashChangeBound = () => this.handleNavigationChange();
    this.onNavigateBound = (e: any) => {
      const destUrl = e?.destination?.url;
      this.handleNavigationChange(destUrl);
    };

    if (this.win?.location?.href) {
      this.lastUrl = this.win.location.href;
    }
  }

  /**
   * Initializes DOM observers, history navigation listeners, and scans initial videos.
   */
  public init(): void {
    if (!this.doc) return;

    // 1. Document visibilitychange listener
    if (this.doc.addEventListener) {
      this.doc.addEventListener('visibilitychange', this.onVisibilityChangeBound);
    }

    // 2. SPA Navigation listeners
    if (this.win?.addEventListener) {
      this.win.addEventListener('popstate', this.onPopStateBound);
      this.win.addEventListener('hashchange', this.onHashChangeBound);

      if ('navigation' in this.win && (this.win as any).navigation?.addEventListener) {
        try {
          (this.win as any).navigation.addEventListener('navigate', this.onNavigateBound);
        } catch {
          // Suppress if navigation API throws
        }
      }
    }

    // 3. Setup IntersectionObserver
    if (typeof IntersectionObserver !== 'undefined') {
      try {
        this.intersectionObserver = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const video = entry.target as HTMLVideoElement;
              this.handleIntersection(video, entry.intersectionRatio);
            }
          },
          {
            root: null,
            threshold: [0, 0.25, 0.5, 0.6, 0.75, 1.0]
          }
        );
      } catch {
        // Fallback if IntersectionObserver not constructible in mock
      }
    }

    // 4. Setup MutationObserver for dynamic React DOM additions/removals
    const rootElement = this.doc.body || (this.doc as any).documentElement;
    if (typeof MutationObserver !== 'undefined' && rootElement) {
      try {
        this.mutationObserver = new MutationObserver((mutations) => {
          if (!this.isTracking) return;

          // Reactive URL check
          if (this.win?.location?.href && this.win.location.href !== this.lastUrl) {
            this.handleNavigationChange(this.win.location.href);
          }

          for (const mut of mutations) {
            if (mut.type === 'childList') {
              if (mut.addedNodes && mut.addedNodes.length > 0) {
                for (let i = 0; i < mut.addedNodes.length; i++) {
                  const node = mut.addedNodes[i];
                  if (node instanceof HTMLElement || (node as any)?.tagName) {
                    const el = node as HTMLElement;
                    if (el.tagName?.toLowerCase() === 'video') {
                      this.attachVideo(el as HTMLVideoElement);
                    } else if (typeof el.querySelectorAll === 'function') {
                      const nested = el.querySelectorAll<HTMLVideoElement>('video');
                      for (let j = 0; j < nested.length; j++) {
                        this.attachVideo(nested[j]);
                      }
                    }
                  }
                }
              }

              if (mut.removedNodes && mut.removedNodes.length > 0) {
                for (let i = 0; i < mut.removedNodes.length; i++) {
                  const node = mut.removedNodes[i];
                  if (node instanceof HTMLElement || (node as any)?.tagName) {
                    const el = node as HTMLElement;
                    if (el.tagName?.toLowerCase() === 'video') {
                      this.detachVideo(el as HTMLVideoElement);
                    } else if (typeof el.querySelectorAll === 'function') {
                      const nested = el.querySelectorAll<HTMLVideoElement>('video');
                      for (let j = 0; j < nested.length; j++) {
                        this.detachVideo(nested[j]);
                      }
                    }
                  }
                }
              }
            }
          }
        });

        this.mutationObserver.observe(rootElement, {
          childList: true,
          subtree: true
        });
      } catch {
        // Suppress if MutationObserver not constructible in mock
      }
    }

    // 5. Initial DOM video scan
    if (typeof rootElement?.querySelectorAll === 'function') {
      const initialVideos = rootElement.querySelectorAll<HTMLVideoElement>('video');
      for (let i = 0; i < initialVideos.length; i++) {
        this.attachVideo(initialVideos[i]);
      }
    }

    // 6. Listen for runtime reset messages from popup or background
    if (this.chromeApi?.runtime?.onMessage?.addListener) {
      this.chromeApi.runtime.onMessage.addListener((message: any) => {
        if (message && (message.type === 'RESET_SESSION' || message.type === 'RESET_STATS')) {
          this.resetSession();
        }
      });
    }
  }

  /**
   * Attaches observation and playback listeners to a video element.
   */
  public observeVideo(video: HTMLVideoElement): void {
    this.attachVideo(video);
  }

  /**
   * Attaches observation and playback listeners to a video element.
   */
  public attachVideo(video: HTMLVideoElement): void {
    if (!video || this.monitoredVideos.has(video)) return;
    this.monitoredVideos.add(video);

    if (this.intersectionObserver) {
      this.intersectionObserver.observe(video);
    }

    const onPlayEvent = () => this.handlePlaybackChange(video);
    const onPauseEvent = () => this.cancelDwell(video);
    const onStallEvent = () => this.cancelDwell(video);

    (video as any)._br_onPlay = onPlayEvent;
    (video as any)._br_onPause = onPauseEvent;
    (video as any)._br_onStall = onStallEvent;

    video.addEventListener?.('play', onPlayEvent);
    video.addEventListener?.('playing', onPlayEvent);
    video.addEventListener?.('pause', onPauseEvent);
    video.addEventListener?.('ended', onPauseEvent);
    video.addEventListener?.('waiting', onStallEvent);
    video.addEventListener?.('stalled', onStallEvent);
    video.addEventListener?.('seeking', onStallEvent);

    // Initial check
    this.handlePlaybackChange(video);
  }

  /**
   * Detaches video listeners and unobserves from IntersectionObserver.
   */
  public unobserveVideo(video: HTMLVideoElement): void {
    this.detachVideo(video);
  }

  /**
   * Cleans up listeners and cancels pending dwell timer when a video is unmounted.
   */
  public detachVideo(video: HTMLVideoElement): void {
    if (!video) return;
    this.cancelDwell(video);
    this.monitoredVideos.delete(video);

    if (this.intersectionObserver) {
      this.intersectionObserver.unobserve(video);
    }

    if ((video as any)._br_onPlay) {
      video.removeEventListener?.('play', (video as any)._br_onPlay);
      video.removeEventListener?.('playing', (video as any)._br_onPlay);
      video.removeEventListener?.('pause', (video as any)._br_onPause);
      video.removeEventListener?.('ended', (video as any)._br_onPause);
      video.removeEventListener?.('waiting', (video as any)._br_onStall);
      video.removeEventListener?.('stalled', (video as any)._br_onStall);
      video.removeEventListener?.('seeking', (video as any)._br_onStall);
      delete (video as any)._br_onPlay;
      delete (video as any)._br_onPause;
      delete (video as any)._br_onStall;
    }
  }

  /**
   * Gate 1 Evaluator: Responds to spatial intersection ratio changes.
   */
  public handleIntersection(video: HTMLVideoElement, ratio: number): void {
    if (!this.isTracking || !video) return;
    this.videoRatios.set(video, ratio);

    const shortcode = this.extractShortcode(video);
    if (!shortcode || this.sessionSeen.has(shortcode)) {
      this.cancelDwell(video);
      return;
    }

    const isVisible = (this.doc?.visibilityState || 'visible') === 'visible';
    const isPlaying = !video.paused && !video.ended && (video.readyState === undefined || video.readyState >= 2);

    if (ratio >= this.visibilityRatio && isPlaying && isVisible) {
      this.startDwell(video, shortcode);
    } else {
      this.cancelDwell(video);
    }
  }

  /**
   * Gate 2 Evaluator: Responds to media playback changes (play, playing, stall, loop).
   */
  public handlePlaybackChange(video: HTMLVideoElement): void {
    if (!this.isTracking || !video) return;

    const shortcode = this.extractShortcode(video);
    if (!shortcode || this.sessionSeen.has(shortcode)) {
      this.cancelDwell(video);
      return;
    }

    const ratio = this.videoRatios.get(video) ?? 1.0;
    const isVisible = (this.doc?.visibilityState || 'visible') === 'visible';
    const isPlaying = !video.paused && !video.ended && (video.readyState === undefined || video.readyState >= 2);

    if (ratio >= this.visibilityRatio && isPlaying && isVisible) {
      this.startDwell(video, shortcode);
    } else {
      this.cancelDwell(video);
    }
  }

  /**
   * Gate 3 Initiator: Begins continuous non-cumulative dwell timer (default 1500ms).
   */
  public startDwell(video: HTMLVideoElement, shortcode: string): void {
    if (!this.isTracking) return;
    if (this.activeTimers.has(video)) return;
    if (this.sessionSeen.has(shortcode)) return;
    if ((this.doc?.visibilityState || 'visible') === 'hidden') return;
    if (video.paused || video.ended) return;
    if (video.readyState !== undefined && video.readyState < 2) return;

    const setTimeoutFn = (this.win?.setTimeout ? this.win.setTimeout.bind(this.win) : setTimeout);
    const timer = setTimeoutFn(async () => {
      this.activeTimers.delete(video);
      if (!this.isTracking) return;
      if ((this.doc?.visibilityState || 'visible') === 'hidden') return;
      if (video.paused || video.ended) return;
      if (video.readyState !== undefined && video.readyState < 2) return;
      if (video.isConnected === false) return;

      if (!this.sessionSeen.has(shortcode)) {
        this.sessionSeen.add(shortcode);
        try {
          await this.onViewQualified(shortcode);
        } catch (err) {
          console.error('[Brainroad IG] Error handling qualified view:', err);
        }
      }
    }, this.dwellMs) as unknown as number;

    this.activeTimers.set(video, timer);
  }

  /**
   * Immediately cancels active dwell timer for a video.
   */
  public cancelDwell(video: HTMLVideoElement): void {
    if (this.activeTimers.has(video)) {
      const timer = this.activeTimers.get(video);
      const clearTimeoutFn = (this.win?.clearTimeout ? this.win.clearTimeout.bind(this.win) : clearTimeout);
      clearTimeoutFn(timer!);
      this.activeTimers.delete(video);
    }
  }

  /**
   * Returns true if a dwell timer is currently running for the video.
   */
  public isDwellActive(video: HTMLVideoElement): boolean {
    return this.activeTimers.has(video);
  }

  /**
   * Aborts all dwell timers when tab is hidden.
   */
  private handleVisibilityChange(): void {
    if ((this.doc?.visibilityState || 'visible') === 'hidden') {
      for (const [video] of this.activeTimers) {
        this.cancelDwell(video);
      }
    }
  }

  /**
   * Re-evaluates active videos on SPA history transitions.
   */
  private handleNavigationChange(newUrl?: string): void {
    if (newUrl) {
      if (newUrl === this.lastUrl) return;
      this.lastUrl = newUrl;
    } else if (this.win?.location?.href) {
      this.lastUrl = this.win.location.href;
    }

    for (const video of this.monitoredVideos) {
      this.cancelDwell(video);
      this.handlePlaybackChange(video);
    }
  }

  /**
   * Extracts shortcode using the zero-class cascading selector algorithm.
   */
  public extractShortcode(video: HTMLVideoElement): string | null {
    return extractReelShortcode(video, this.win);
  }

  /**
   * Default IPC message dispatcher to background service worker.
   */
  private async defaultDispatchView(shortcode: string): Promise<void> {
    await sendRecordView(this.chromeApi, shortcode);
  }

  /**
   * Returns a copy of the in-memory session deduplication Set.
   */
  public getSessionSeen(): Set<string> {
    return new Set(this.sessionSeen);
  }

  /**
   * Resets session deduplication cache and clears all active dwell timers.
   */
  public resetSession(): void {
    this.sessionSeen.clear();
    for (const [video] of this.activeTimers) {
      this.cancelDwell(video);
    }
  }

  /**
   * Completely tears down observers and listeners.
   */
  public destroy(): void {
    this.isTracking = false;
    for (const [video] of this.activeTimers) {
      this.cancelDwell(video);
    }

    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }

    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    if (this.doc?.removeEventListener) {
      this.doc.removeEventListener('visibilitychange', this.onVisibilityChangeBound);
    }

    if (this.win?.removeEventListener) {
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

    for (const video of this.monitoredVideos) {
      this.detachVideo(video);
    }
    this.monitoredVideos.clear();
  }
}

// ============================================================================
// 5. FACTORY & LIFECYCLE FUNCTIONS
// ============================================================================

export interface InstagramDetectorController {
  extractShortcode: (video: HTMLVideoElement) => string | null;
  handleIntersection: (video: HTMLVideoElement, ratio: number) => void;
  handlePlaybackChange: (video: HTMLVideoElement) => void;
  cancelDwell: (video: HTMLVideoElement) => void;
  isDwellActive: (video: HTMLVideoElement) => boolean;
  getSessionSeen: () => Set<string>;
  resetSession: () => void;
  destroy: () => void;
  observeVideo: (video: HTMLVideoElement) => void;
  attachVideo: (video: HTMLVideoElement) => void;
  detector: InstagramReelDetector;
}

/**
 * Factory function creating an InstagramDetectorController.
 * Fully compatible with both Vitest unit test harnesses and E2E test suites.
 */
export function createInstagramDetector(
  chromeInstance?: any,
  windowInstance?: any,
  documentInstance?: any
): InstagramDetectorController {
  const detector = new InstagramReelDetector({
    chrome: chromeInstance,
    window: windowInstance,
    document: documentInstance
  });

  detector.init();

  return {
    extractShortcode: (video: HTMLVideoElement) => detector.extractShortcode(video),
    handleIntersection: (video: HTMLVideoElement, ratio: number) => detector.handleIntersection(video, ratio),
    handlePlaybackChange: (video: HTMLVideoElement) => detector.handlePlaybackChange(video),
    cancelDwell: (video: HTMLVideoElement) => detector.cancelDwell(video),
    isDwellActive: (video: HTMLVideoElement) => detector.isDwellActive(video),
    getSessionSeen: () => detector.getSessionSeen(),
    resetSession: () => detector.resetSession(),
    destroy: () => detector.destroy(),
    observeVideo: (video: HTMLVideoElement) => detector.observeVideo(video),
    attachVideo: (video: HTMLVideoElement) => detector.attachVideo(video),
    detector
  };
}

/**
 * Initializes Instagram content script tracking and returns a teardown function.
 */
export function initInstagramTracking(options?: InstagramDetectorOptions): () => void {
  const detector = new InstagramReelDetector(options);
  detector.init();
  return () => detector.destroy();
}

export const initInstagramContentScript = initInstagramTracking;

// ============================================================================
// 6. AUTO-INITIALIZATION IN LIVE BROWSER
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
    const liveDetector = new InstagramReelDetector({
      chrome,
      window,
      document
    });
    liveDetector.init();
    (window as any).__brainroadInstagram = liveDetector;
    console.log('[Brainroad] Instagram content script active');

    // Floating live-count bubble pinned to the top of the page
    try {
      const bubble = new CountBubbleController({ chrome, document });
      bubble.mount();
      (window as any).__brainroadInstagramBubble = bubble;
    } catch (bubbleErr) {
      console.error('[Brainroad] Failed to mount Instagram count bubble:', bubbleErr);
    }
  } catch (err) {
    console.error('[Brainroad] Failed to initialize Instagram detector:', err);
  }
}

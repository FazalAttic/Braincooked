/**
 * tests/unit/bubble_visibility.test.ts
 * Unit tests verifying that the floating count bubble overlay automatically appears
 * when viewing Shorts or Reels, and completely disappears when browsing non-shorts/reels.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CountBubbleController } from '../../src/content/overlay';
import { YouTubeShortsDetector, isYouTubeShortsUrl } from '../../src/content/youtube';
import { InstagramReelDetector, isInstagramReelsUrl } from '../../src/content/instagram';
import { mockChrome } from '../mocks/chrome';
import { createMockVideo } from '../mocks/video';

describe('CountBubble Visibility Controller', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    const existing = document.getElementById('brainroad-count-bubble');
    if (existing) existing.remove();
  });

  it('mounts hidden when initialVisible is false', () => {
    const bubble = new CountBubbleController({
      chrome: mockChrome as any,
      document,
      window,
      initialVisible: false
    });
    bubble.mount();

    const host = document.getElementById('brainroad-count-bubble');
    expect(host).not.toBeNull();
    expect(host?.classList.contains('brb-hidden')).toBe(true);
    expect(host?.style.display).toBe('none');
    expect(bubble.isVisible()).toBe(false);

    bubble.destroy();
  });

  it('mounts visible when initialVisible is true (default)', () => {
    const bubble = new CountBubbleController({
      chrome: mockChrome as any,
      document,
      window,
      initialVisible: true
    });
    bubble.mount();

    const host = document.getElementById('brainroad-count-bubble');
    expect(host).not.toBeNull();
    expect(host?.classList.contains('brb-hidden')).toBe(false);
    expect(host?.style.display).not.toBe('none');
    expect(bubble.isVisible()).toBe(true);

    bubble.destroy();
  });

  it('toggles visibility via show(), hide(), and setVisible()', () => {
    const bubble = new CountBubbleController({
      chrome: mockChrome as any,
      document,
      window,
      initialVisible: true
    });
    bubble.mount();

    const host = document.getElementById('brainroad-count-bubble')!;
    expect(bubble.isVisible()).toBe(true);

    bubble.hide();
    expect(bubble.isVisible()).toBe(false);
    expect(host.classList.contains('brb-hidden')).toBe(true);
    expect(host.style.display).toBe('none');

    bubble.show();
    expect(bubble.isVisible()).toBe(true);
    expect(host.classList.contains('brb-hidden')).toBe(false);
    expect(host.style.display).not.toBe('none');

    bubble.setVisible(false);
    expect(bubble.isVisible()).toBe(false);
    expect(host.style.display).toBe('none');

    bubble.setVisible(true);
    expect(bubble.isVisible()).toBe(true);
    expect(host.style.display).not.toBe('none');

    bubble.destroy();
  });
});

describe('YouTube Shorts Bubble Auto-Visibility Integration', () => {
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

  beforeEach(() => {
    document.body.innerHTML = `
      <ytd-app>
        <ytd-page-manager id="page-manager">
          <ytd-shorts id="shorts-container" role="main">
            <div id="shorts-inner-container"></div>
          </ytd-shorts>
        </ytd-page-manager>
      </ytd-app>
    `;
    setLocation('/watch?v=regular_video_123');
  });

  afterEach(() => {
    const existing = document.getElementById('brainroad-count-bubble');
    if (existing) existing.remove();
  });

  it('correctly detects YouTube Shorts URL vs non-shorts URL', () => {
    expect(isYouTubeShortsUrl('https://www.youtube.com/shorts/abc12345678')).toBe(true);
    expect(isYouTubeShortsUrl('/shorts/abc12345678')).toBe(true);
    expect(isYouTubeShortsUrl('/watch?v=long_video')).toBe(false);
    expect(isYouTubeShortsUrl('/')).toBe(false);
    expect(isYouTubeShortsUrl('/feed/subscriptions')).toBe(false);
  });

  it('hides bubble on non-shorts YouTube pages and shows when navigating to Shorts', () => {
    setLocation('/watch?v=regular_video_123');
    const bubble = new CountBubbleController({
      chrome: mockChrome as any,
      document,
      window,
      initialVisible: false
    });
    bubble.mount();
    expect(bubble.isVisible()).toBe(false);

    const detector = new YouTubeShortsDetector({
      chrome: mockChrome as any,
      window,
      document,
      bubble
    });
    detector.init();

    // On /watch, bubble remains hidden
    expect(bubble.isVisible()).toBe(false);

    // Navigate into Shorts
    setLocation('/shorts/vid_short_01');
    window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
    expect(bubble.isVisible()).toBe(true);

    // Navigate back to YouTube home
    setLocation('/');
    window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
    expect(bubble.isVisible()).toBe(false);

    detector.destroy();
    bubble.destroy();
  });
});

describe('Instagram Reels Bubble Auto-Visibility Integration', () => {
  function setLocation(pathname: string) {
    Object.defineProperty(window, 'location', {
      value: {
        pathname,
        href: `https://www.instagram.com${pathname}`,
        search: '',
        hash: ''
      },
      writable: true,
      configurable: true
    });
  }

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="root">
        <main role="main">
          <div id="posts-container"></div>
        </main>
      </div>
    `;
    setLocation('/direct/inbox/');
  });

  afterEach(() => {
    const existing = document.getElementById('brainroad-count-bubble');
    if (existing) existing.remove();
  });

  it('correctly detects Instagram Reels URL vs non-reels URL', () => {
    expect(isInstagramReelsUrl('https://www.instagram.com/reels/')).toBe(true);
    expect(isInstagramReelsUrl('/reels/')).toBe(true);
    expect(isInstagramReelsUrl('/reel/CxY123abc/')).toBe(true);
    expect(isInstagramReelsUrl('/direct/inbox/')).toBe(false);
    expect(isInstagramReelsUrl('/explore/')).toBe(false);
    expect(isInstagramReelsUrl('/username/')).toBe(false);
  });

  it('hides bubble on DMs and shows on Reels route', () => {
    setLocation('/direct/inbox/');
    const bubble = new CountBubbleController({
      chrome: mockChrome as any,
      document,
      window,
      initialVisible: false
    });
    bubble.mount();
    expect(bubble.isVisible()).toBe(false);

    const detector = new InstagramReelDetector({
      chrome: mockChrome as any,
      window,
      document,
      bubble
    });
    detector.init();

    expect(bubble.isVisible()).toBe(false);

    // Navigate to Reels
    setLocation('/reels/');
    window.dispatchEvent(new Event('popstate'));
    expect(bubble.isVisible()).toBe(true);

    // Navigate to DMs
    setLocation('/direct/inbox/');
    window.dispatchEvent(new Event('popstate'));
    expect(bubble.isVisible()).toBe(false);

    detector.destroy();
    bubble.destroy();
  });

  it('shows bubble in feed when a Reel is in viewport and hides when scrolled away', () => {
    setLocation('/');
    const bubble = new CountBubbleController({
      chrome: mockChrome as any,
      document,
      window,
      initialVisible: false
    });
    bubble.mount();
    expect(bubble.isVisible()).toBe(false);

    const detector = new InstagramReelDetector({
      chrome: mockChrome as any,
      window,
      document,
      bubble
    });
    detector.init();
    expect(bubble.isVisible()).toBe(false);

    // Mount a reel post in the feed
    const container = document.getElementById('posts-container')!;
    const article = document.createElement('article');
    const reelAnchor = document.createElement('a');
    reelAnchor.href = '/reel/feed_shortcode_123/';
    article.appendChild(reelAnchor);

    const video = createMockVideo();
    article.appendChild(video);
    container.appendChild(article);

    detector.attachVideo(video);

    // Video scrolls into view (intersection ratio 0.8)
    detector.handleIntersection(video, 0.8);
    expect(bubble.isVisible()).toBe(true);

    // Video scrolls out of view (intersection ratio 0)
    detector.handleIntersection(video, 0.0);
    expect(bubble.isVisible()).toBe(false);

    detector.destroy();
    bubble.destroy();
  });
});

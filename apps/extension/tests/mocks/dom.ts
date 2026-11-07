/**
 * tests/mocks/dom.ts
 * Mock DOM fixture factories for Instagram & YouTube testing.
 */
import { createMockVideo, MockHTMLVideoElement } from './video';

export interface FeedReelFixture {
  article: HTMLElement;
  video: MockHTMLVideoElement;
  anchor: HTMLAnchorElement;
}

export function createFeedReelFixture(shortcode: string): FeedReelFixture {
  const article = document.createElement('article');
  article.setAttribute('role', 'presentation');

  const header = document.createElement('header');
  header.innerHTML = '<div class="user-header"><span>creator_user</span></div>';

  const mediaContainer = document.createElement('div');
  mediaContainer.className = 'media-container';
  const video = createMockVideo();
  mediaContainer.appendChild(video);

  const footer = document.createElement('footer');
  const anchor = document.createElement('a');
  anchor.setAttribute('href', `/reel/${shortcode}/`);
  anchor.setAttribute('role', 'link');
  anchor.innerHTML = '<time datetime="2026-11-06T12:00:00Z">2 hours ago</time>';
  footer.appendChild(anchor);

  article.appendChild(header);
  article.appendChild(mediaContainer);
  article.appendChild(footer);

  return { article, video, anchor };
}

export interface DedicatedReelFixture {
  container: HTMLElement;
  video: MockHTMLVideoElement;
  anchor: HTMLAnchorElement;
}

export function createDedicatedReelFixture(shortcode: string): DedicatedReelFixture {
  const container = document.createElement('div');
  container.setAttribute('data-pressable-container', 'true');

  const videoWrapper = document.createElement('div');
  videoWrapper.className = 'video-wrapper';
  const video = createMockVideo();
  videoWrapper.appendChild(video);

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const anchor = document.createElement('a');
  anchor.setAttribute('href', `/reels/${shortcode}/`);
  anchor.setAttribute('role', 'link');
  anchor.textContent = 'View Reel';
  overlay.appendChild(anchor);

  container.appendChild(videoWrapper);
  container.appendChild(overlay);

  return { container, video, anchor };
}

export function createImagePostFixture(postId = 'IMG_PHOTO_123'): HTMLElement {
  const article = document.createElement('article');
  article.setAttribute('role', 'presentation');

  const header = document.createElement('header');
  header.innerHTML = '<div><span>photographer</span></div>';

  const mediaContainer = document.createElement('div');
  mediaContainer.className = 'media-container';
  const img = document.createElement('img');
  img.src = 'https://instagram.com/p/sample.jpg';
  img.alt = 'Photo post';
  mediaContainer.appendChild(img);

  const footer = document.createElement('footer');
  const anchor = document.createElement('a');
  anchor.setAttribute('href', `/p/${postId}/`);
  anchor.textContent = 'View photo';
  footer.appendChild(anchor);

  article.appendChild(header);
  article.appendChild(mediaContainer);
  article.appendChild(footer);

  return article;
}

export function createCorruptedReelFixture(): { article: HTMLElement; video: MockHTMLVideoElement } {
  const article = document.createElement('article');
  article.setAttribute('role', 'presentation');

  const mediaContainer = document.createElement('div');
  const video = createMockVideo();
  mediaContainer.appendChild(video);

  const footer = document.createElement('footer');
  const anchor = document.createElement('a');
  anchor.setAttribute('href', '#');
  footer.appendChild(anchor);

  article.appendChild(mediaContainer);
  article.appendChild(footer);

  return { article, video };
}

export function createRecycledFeedContainer(): {
  container: HTMLElement;
  mountArticle(fixture: FeedReelFixture): void;
  unmountArticle(fixture: FeedReelFixture): void;
  clear(): void;
} {
  const container = document.createElement('div');
  container.className = 'feed-stream';

  return {
    container,
    mountArticle: (fixture) => {
      container.appendChild(fixture.article);
    },
    unmountArticle: (fixture) => {
      if (fixture.article.parentElement === container) {
        container.removeChild(fixture.article);
      }
    },
    clear: () => {
      container.innerHTML = '';
    }
  };
}

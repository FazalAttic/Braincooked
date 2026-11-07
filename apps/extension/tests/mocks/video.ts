/**
 * tests/mocks/video.ts
 * High-fidelity HTML5 Video & IntersectionObserver mock engine for Vitest JSDOM environment.
 */

export interface MockVideoController {
  paused: boolean;
  ended: boolean;
  readyState: number;
  currentTime: number;
  duration: number;
  muted: boolean;
  volume: number;
  playbackRate: number;
  play(): Promise<void>;
  pause(): void;
  simulateTimeUpdate(time: number): void;
  simulateEnded(): void;
  simulateLoop(): void;
  simulateStall(): void;
  stall(): void;
  simulateReady(): void;
  resume(): void;
  simulateSeek(time: number): void;
}

export type MockHTMLVideoElement = HTMLVideoElement & MockVideoController;

export function createMockVideo(options?: Partial<{
  src: string;
  duration: number;
  muted: boolean;
  readyState: number;
}>): MockHTMLVideoElement {
  const video = document.createElement('video') as MockHTMLVideoElement;

  let _paused = true;
  let _ended = false;
  let _readyState = options?.readyState ?? 4; // HAVE_ENOUGH_DATA
  let _currentTime = 0;
  let _duration = options?.duration ?? 30;
  let _muted = options?.muted ?? true;
  let _volume = 1.0;
  let _playbackRate = 1.0;

  if (options?.src) {
    video.src = options.src;
  } else {
    video.src = 'blob:https://www.instagram.com/mock-video-stream';
  }

  video.setAttribute('playsinline', '');
  video.setAttribute('autoplay', '');
  video.setAttribute('loop', '');

  Object.defineProperty(video, 'paused', {
    get: () => _paused,
    set: (v: boolean) => { _paused = v; },
    configurable: true
  });

  Object.defineProperty(video, 'ended', {
    get: () => _ended,
    set: (v: boolean) => { _ended = v; },
    configurable: true
  });

  Object.defineProperty(video, 'readyState', {
    get: () => _readyState,
    set: (v: number) => { _readyState = v; },
    configurable: true
  });

  Object.defineProperty(video, 'currentTime', {
    get: () => _currentTime,
    set: (v: number) => { _currentTime = v; },
    configurable: true
  });

  Object.defineProperty(video, 'duration', {
    get: () => _duration,
    set: (v: number) => { _duration = v; },
    configurable: true
  });

  Object.defineProperty(video, 'muted', {
    get: () => _muted,
    set: (v: boolean) => { _muted = v; },
    configurable: true
  });

  Object.defineProperty(video, 'volume', {
    get: () => _volume,
    set: (v: number) => { _volume = v; },
    configurable: true
  });

  Object.defineProperty(video, 'playbackRate', {
    get: () => _playbackRate,
    set: (v: number) => { _playbackRate = v; },
    configurable: true
  });

  video.play = async (): Promise<void> => {
    _paused = false;
    _ended = false;
    video.dispatchEvent(new Event('play'));
    video.dispatchEvent(new Event('playing'));
  };

  video.pause = (): void => {
    _paused = true;
    video.dispatchEvent(new Event('pause'));
  };

  video.simulateTimeUpdate = (time: number): void => {
    _currentTime = time;
    video.dispatchEvent(new Event('timeupdate'));
  };

  video.simulateEnded = (): void => {
    _ended = true;
    _paused = true;
    video.dispatchEvent(new Event('ended'));
  };

  video.simulateLoop = (): void => {
    _currentTime = 0;
    video.dispatchEvent(new Event('ended'));
    _paused = false;
    _ended = false;
    video.dispatchEvent(new Event('play'));
    video.dispatchEvent(new Event('playing'));
  };

  video.simulateStall = (): void => {
    _readyState = 1; // HAVE_METADATA
    video.dispatchEvent(new Event('waiting'));
  };

  video.stall = (): void => {
    video.simulateStall();
  };

  video.simulateReady = (): void => {
    _readyState = 4; // HAVE_ENOUGH_DATA
    video.dispatchEvent(new Event('canplay'));
  };

  video.resume = (): void => {
    video.simulateReady();
    if (!_paused) {
      video.dispatchEvent(new Event('playing'));
    }
  };

  video.simulateSeek = (time: number): void => {
    _currentTime = time;
    video.dispatchEvent(new Event('seeking'));
    video.dispatchEvent(new Event('seeked'));
  };

  return video;
}

export class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = '0px';
  readonly thresholds: ReadonlyArray<number> = [0];

  public callback: IntersectionObserverCallback;
  public observedElements = new Set<Element>();
  static instances: MockIntersectionObserver[] = [];

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    if (options?.root) this.root = options.root;
    if (options?.rootMargin) this.rootMargin = options.rootMargin;
    if (options?.threshold) {
      this.thresholds = Array.isArray(options.threshold) ? options.threshold : [options.threshold];
    }
    MockIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observedElements.add(target);
  }

  unobserve(target: Element): void {
    this.observedElements.delete(target);
  }

  disconnect(): void {
    this.observedElements.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  simulateEntry(target: Element, ratio: number, isIntersecting?: boolean): void {
    if (!this.observedElements.has(target)) return;
    const entry: IntersectionObserverEntry = {
      boundingClientRect: target.getBoundingClientRect ? target.getBoundingClientRect() : ({} as DOMRectReadOnly),
      intersectionRatio: ratio,
      intersectionRect: {} as DOMRectReadOnly,
      isIntersecting: isIntersecting ?? (ratio >= 0.6),
      rootBounds: null,
      target,
      time: performance.now()
    };
    this.callback([entry], this);
  }

  static simulate(target: Element, ratio: number, isIntersecting?: boolean): void {
    for (const inst of MockIntersectionObserver.instances) {
      if (inst.observedElements.has(target)) {
        inst.simulateEntry(target, ratio, isIntersecting);
      }
    }
  }

  static reset(): void {
    for (const inst of MockIntersectionObserver.instances) {
      inst.disconnect();
    }
    MockIntersectionObserver.instances = [];
  }

  static install(): void {
    (globalThis as any).IntersectionObserver = MockIntersectionObserver;
  }

  static uninstall(): void {
    delete (globalThis as any).IntersectionObserver;
  }
}

/**
 * src/content/overlay.ts
 * Shared floating, draggable count bubble overlay for the Instagram & YouTube
 * content scripts.
 *
 * - Defaults to top-center (over the Short/Reel).
 * - The user can drag it anywhere; the chosen position is remembered in
 *   chrome.storage.local and restored on every page load.
 * - The counter text is animated with a small rolling-number "odometer"
 *   (src/content/rolling.ts) as the numbers change.
 */

import type { BrainroadStats } from '../shared/types';
import { STORAGE_KEY_STATS } from '../shared/types';
import { FATIGUE_STAGES } from '../shared/constants';
import { RollingNumber } from './rolling';

const HOST_ID = 'brainroad-count-bubble';
const STYLE_ID = 'brainroad-bubble-style';
const POSITION_STORAGE_KEY = 'brainroad_bubble_position';

interface BubblePosition {
  left: number;
  top: number;
}

export interface CountBubbleOptions {
  chrome?: typeof globalThis.chrome;
  document?: Document;
  window?: Window;
  initialVisible?: boolean;
}

/**
 * Bubble styles. Scoped under the host id (high specificity) and marked
 * !important so host-page CSS cannot distort the widget.
 */
const BUBBLE_CSS = `
#${HOST_ID} {
  position: fixed !important;
  top: 16px !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  z-index: 2147483647 !important;
  margin: 0 !important;
  padding: 0 !important;
  pointer-events: auto !important;
  cursor: grab !important;
  line-height: 0 !important;
  touch-action: none !important;
}
#${HOST_ID}.brb-hidden {
  display: none !important;
}
#${HOST_ID} .brb-bubble {
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
  box-sizing: border-box !important;
  padding: 8px 14px !important;
  background: rgba(10, 9, 7, 0.9) !important;
  border: 1px solid rgba(255, 233, 180, 0.2) !important;
  border-radius: 999px !important;
  color: #FCFFFA !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4) !important;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  user-select: none !important;
  -webkit-user-select: none !important;
  line-height: 1 !important;
}
#${HOST_ID} .brb-dot {
  flex: none !important;
  width: 10px !important;
  height: 10px !important;
  border-radius: 50% !important;
  background: var(--br-accent, #79D056) !important;
  box-shadow: 0 0 8px var(--br-accent, #79D056) !important;
  transition: background 0.3s ease, box-shadow 0.3s ease !important;
}
#${HOST_ID} .brb-main {
  display: flex !important;
  flex-direction: column !important;
  align-items: flex-start !important;
  line-height: 1.05 !important;
}
#${HOST_ID} .brb-today {
  font-size: 17px !important;
  font-weight: 800 !important;
  letter-spacing: -0.02em !important;
  font-variant-numeric: tabular-nums !important;
}
#${HOST_ID} .brb-label {
  font-size: 8.5px !important;
  font-weight: 700 !important;
  letter-spacing: 0.08em !important;
  text-transform: uppercase !important;
  color: rgba(252, 255, 250, 0.5) !important;
}
#${HOST_ID} .brb-divider {
  flex: none !important;
  width: 1px !important;
  height: 22px !important;
  background: rgba(255, 233, 180, 0.14) !important;
}
#${HOST_ID} .brb-split {
  display: flex !important;
  flex-direction: column !important;
  align-items: flex-start !important;
  gap: 1px !important;
  line-height: 1.15 !important;
}
#${HOST_ID} .brb-yt {
  color: #FF6B66 !important;
  font-size: 11px !important;
  font-weight: 700 !important;
}
#${HOST_ID} .brb-ig {
  color: #E1306C !important;
  font-size: 11px !important;
  font-weight: 700 !important;
}
#${HOST_ID} .brb-yt b,
#${HOST_ID} .brb-ig b {
  font-weight: 800 !important;
  font-variant-numeric: tabular-nums !important;
}
#${HOST_ID} .brn-roll {
  display: inline-block !important;
  line-height: 0 !important;
  white-space: nowrap !important;
}
#${HOST_ID} .brn-col {
  display: inline-block !important;
  overflow: hidden !important;
  height: 1em !important;
  line-height: 1 !important;
  vertical-align: top !important;
}
#${HOST_ID} .brn-digit {
  display: inline-block !important;
  line-height: 1 !important;
  vertical-align: top !important;
}
`;

/**
 * Lightweight controller managing the floating, draggable, animated counter.
 */
export class CountBubbleController {
  private chromeApi: typeof globalThis.chrome;
  private doc: Document;
  private win: Window | null;

  private host: HTMLElement | null = null;
  private todayEl: HTMLElement | null = null;
  private ytEl: HTMLElement | null = null;
  private igEl: HTMLElement | null = null;
  private accentEl: HTMLElement | null = null;

  private todayRoll: RollingNumber | null = null;
  private ytRoll: RollingNumber | null = null;
  private igRoll: RollingNumber | null = null;

  private boundStorageChange:
    | ((changes: Record<string, chrome.storage.StorageChange>, area: string) => void)
    | null = null;

  private visible = true;

  // Drag state
  private dragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private dragW = 0;
  private dragH = 0;

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.host) return;
    this.dragging = true;

    const rect = this.host.getBoundingClientRect();
    this.dragOffsetX = e.clientX - rect.left;
    this.dragOffsetY = e.clientY - rect.top;
    this.dragW = rect.width;
    this.dragH = rect.height;

    this.host.style.setProperty('cursor', 'grabbing', 'important');

    if (this.win) {
      this.win.addEventListener('pointermove', this.onPointerMove);
      this.win.addEventListener('pointerup', this.onPointerUp);
      this.win.addEventListener('pointercancel', this.onPointerUp);
    }

    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging || !this.host || !this.win) return;

    const maxLeft = Math.max(0, (this.win.innerWidth ?? 0) - this.dragW);
    const maxTop = Math.max(0, (this.win.innerHeight ?? 0) - this.dragH);

    const left = Math.min(Math.max(0, e.clientX - this.dragOffsetX), maxLeft);
    const top = Math.min(Math.max(0, e.clientY - this.dragOffsetY), maxTop);

    this.host.style.setProperty('left', `${left}px`, 'important');
    this.host.style.setProperty('top', `${top}px`, 'important');
    this.host.style.setProperty('transform', 'none', 'important');

    e.preventDefault();
  };

  private onPointerUp = (): void => {
    if (!this.dragging) return;
    this.dragging = false;

    if (this.host) {
      this.host.style.setProperty('cursor', 'grab', 'important');
    }
    if (this.win) {
      this.win.removeEventListener('pointermove', this.onPointerMove);
      this.win.removeEventListener('pointerup', this.onPointerUp);
      this.win.removeEventListener('pointercancel', this.onPointerUp);
    }

    this.savePosition();
  };

  constructor(options: CountBubbleOptions = {}) {
    this.chromeApi = options.chrome ?? (typeof chrome !== 'undefined' ? chrome : ({} as any));
    this.doc = options.document ?? (typeof document !== 'undefined' ? document : ({} as any));
    this.win = options.window ?? this.doc?.defaultView ?? (typeof window !== 'undefined' ? window : null);
    if (typeof options.initialVisible === 'boolean') {
      this.visible = options.initialVisible;
    }
  }

  /**
   * Creates and appends the bubble DOM, then hydrates with current stats.
   * Safe to call multiple times: a second call is a no-op if already mounted.
   */
  public mount(): void {
    if (!this.doc || this.host) return;

    this.ensureStyle();

    const existing = this.doc.getElementById(HOST_ID) as HTMLElement | null;
    if (existing) {
      this.host = existing;
      this.cacheElementRefs();
      this.setupRolling();
      this.attachDragHandlers();
      this.registerStorageListener();
      this.loadInitialStats();
      this.applyVisibility();
      return;
    }

    const host = this.doc.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('role', 'status');
    host.setAttribute('aria-label', 'Brainroad today count');
    host.title = 'Drag to move';

    const bubble = this.doc.createElement('div');
    bubble.className = 'brb-bubble';

    const dot = this.doc.createElement('span');
    dot.className = 'brb-dot';
    dot.setAttribute('aria-hidden', 'true');
    bubble.appendChild(dot);

    const main = this.doc.createElement('div');
    main.className = 'brb-main';
    const today = this.doc.createElement('span');
    today.className = 'brb-today';
    today.textContent = '0';
    const label = this.doc.createElement('span');
    label.className = 'brb-label';
    label.textContent = 'today';
    main.appendChild(today);
    main.appendChild(label);
    bubble.appendChild(main);

    const divider = this.doc.createElement('span');
    divider.className = 'brb-divider';
    divider.setAttribute('aria-hidden', 'true');
    bubble.appendChild(divider);

    const split = this.doc.createElement('div');
    split.className = 'brb-split';
    const yt = this.doc.createElement('span');
    yt.className = 'brb-yt';
    yt.innerHTML = 'YT&nbsp;<b>0</b>';
    const ig = this.doc.createElement('span');
    ig.className = 'brb-ig';
    ig.innerHTML = 'IG&nbsp;<b>0</b>';
    split.appendChild(yt);
    split.appendChild(ig);
    bubble.appendChild(split);

    host.appendChild(bubble);

    const mountPoint = this.doc.body || this.doc.documentElement;
    if (mountPoint) {
      mountPoint.appendChild(host);
    }

    this.host = host;
    this.todayEl = today;
    this.ytEl = yt.querySelector('b');
    this.igEl = ig.querySelector('b');
    this.accentEl = bubble;

    this.applyVisibility();
    this.setupRolling();
    this.attachDragHandlers();
    this.registerStorageListener();
    this.loadInitialStats();

    // Restore the user's saved position (if any), overriding the default center.
    this.loadPosition()
      .then((pos) => {
        if (pos && this.host) {
          this.applyPosition(pos.left, pos.top);
        }
      })
      .catch(() => {
        // Suppress storage read errors; default position remains.
      });
  }

  /**
   * Updates the bubble with fresh stats and the matching fatigue-stage accent.
   */
  public update(stats: BrainroadStats): void {
    if (!stats) return;

    this.todayRoll?.update(String(stats.today ?? 0));
    this.ytRoll?.update(String(stats.platforms?.youtube?.today ?? 0));
    this.igRoll?.update(String(stats.platforms?.instagram?.today ?? 0));

    const accent = this.stageColor(stats.today ?? 0);
    if (this.accentEl) {
      this.accentEl.style.setProperty('--br-accent', accent);
    }
  }

  /**
   * Shows the count bubble.
   */
  public show(): void {
    this.visible = true;
    this.applyVisibility();
  }

  /**
   * Hides the count bubble completely from view and pointer interactions.
   */
  public hide(): void {
    this.visible = false;
    this.applyVisibility();
  }

  /**
   * Sets visibility of the count bubble.
   */
  public setVisible(visible: boolean): void {
    this.visible = visible;
    this.applyVisibility();
  }

  /**
   * Returns true if the bubble is currently marked visible.
   */
  public isVisible(): boolean {
    return this.visible;
  }

  private applyVisibility(): void {
    if (!this.host) return;
    if (this.visible) {
      this.host.classList.remove('brb-hidden');
      this.host.style.removeProperty('display');
    } else {
      this.host.classList.add('brb-hidden');
      this.host.style.setProperty('display', 'none', 'important');
    }
  }

  /**
   * Removes the bubble, listeners, and DOM node.
   */
  public destroy(): void {
    if (this.boundStorageChange && this.chromeApi?.storage?.onChanged) {
      try {
        this.chromeApi.storage.onChanged.removeListener(this.boundStorageChange);
      } catch {
        // Suppress
      }
    }
    this.boundStorageChange = null;

    this.todayRoll?.destroy();
    this.ytRoll?.destroy();
    this.igRoll?.destroy();
    this.todayRoll = null;
    this.ytRoll = null;
    this.igRoll = null;

    if (this.host) {
      this.host.removeEventListener('pointerdown', this.onPointerDown);
      this.host.remove();
      this.host = null;
    }

    if (this.win) {
      this.win.removeEventListener('pointermove', this.onPointerMove);
      this.win.removeEventListener('pointerup', this.onPointerUp);
      this.win.removeEventListener('pointercancel', this.onPointerUp);
    }

    this.todayEl = null;
    this.ytEl = null;
    this.igEl = null;
    this.accentEl = null;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private ensureStyle(): void {
    if (!this.doc || this.doc.getElementById(STYLE_ID)) return;
    const style = this.doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = BUBBLE_CSS;
    const head = this.doc.head || this.doc.documentElement;
    head.appendChild(style);
  }

  private cacheElementRefs(): void {
    if (!this.host) return;
    this.todayEl = this.host.querySelector<HTMLElement>('.brb-today');
    this.ytEl = this.host.querySelector<HTMLElement>('.brb-yt b');
    this.igEl = this.host.querySelector<HTMLElement>('.brb-ig b');
    this.accentEl = this.host.querySelector<HTMLElement>('.brb-bubble');
  }

  private setupRolling(): void {
    this.todayRoll?.destroy();
    this.ytRoll?.destroy();
    this.igRoll?.destroy();

    if (this.todayEl) {
      this.todayRoll = new RollingNumber(this.todayEl, 400);
    }
    if (this.ytEl) {
      this.ytRoll = new RollingNumber(this.ytEl, 400);
    }
    if (this.igEl) {
      this.igRoll = new RollingNumber(this.igEl, 400);
    }
  }

  private attachDragHandlers(): void {
    if (!this.host) return;
    this.host.addEventListener('pointerdown', this.onPointerDown);
  }

  private applyPosition(left: number, top: number): void {
    if (!this.host || !this.win) return;

    const w = this.host.offsetWidth || 0;
    const h = this.host.offsetHeight || 0;
    const maxLeft = Math.max(0, (this.win.innerWidth ?? 0) - w);
    const maxTop = Math.max(0, (this.win.innerHeight ?? 0) - h);

    this.host.style.setProperty('left', `${Math.min(Math.max(0, left), maxLeft)}px`, 'important');
    this.host.style.setProperty('top', `${Math.min(Math.max(0, top), maxTop)}px`, 'important');
    this.host.style.setProperty('transform', 'none', 'important');
  }

  private stageColor(count: number): string {
    const safeCount = Math.max(0, count);
    for (const def of FATIGUE_STAGES) {
      if (safeCount >= def.min && safeCount <= def.max) {
        return def.color;
      }
    }
    return FATIGUE_STAGES[0].color;
  }

  private registerStorageListener(): void {
    if (!this.chromeApi?.storage?.onChanged) return;

    this.boundStorageChange = (changes, areaName) => {
      if (areaName === 'local' && changes[STORAGE_KEY_STATS]) {
        const newStats = changes[STORAGE_KEY_STATS].newValue as BrainroadStats | undefined;
        if (newStats) {
          this.update(newStats);
        }
      }
    };

    try {
      this.chromeApi.storage.onChanged.addListener(this.boundStorageChange);
    } catch {
      // Suppress if listener cannot be registered
    }
  }

  private async loadInitialStats(): Promise<void> {
    // 1. Prefer the typed IPC route through the service worker
    try {
      if (this.chromeApi?.runtime?.sendMessage) {
        const res = await this.chromeApi.runtime.sendMessage({ type: 'GET_STATS' });
        if (res && res.ok && res.stats) {
          this.update(res.stats as BrainroadStats);
          return;
        }
      }
    } catch {
      // Fall through to a direct storage read
    }

    // 2. Direct chrome.storage.local read fallback
    try {
      if (this.chromeApi?.storage?.local) {
        const stored = await this.chromeApi.storage.local.get(STORAGE_KEY_STATS);
        const raw = stored && stored[STORAGE_KEY_STATS];
        if (raw) {
          this.update(raw as BrainroadStats);
        }
      }
    } catch {
      // Suppress storage read errors
    }
  }

  private async loadPosition(): Promise<BubblePosition | null> {
    try {
      if (this.chromeApi?.storage?.local) {
        const stored = await this.chromeApi.storage.local.get(POSITION_STORAGE_KEY);
        const raw = stored && stored[POSITION_STORAGE_KEY];
        if (raw && typeof raw.left === 'number' && typeof raw.top === 'number') {
          return { left: raw.left, top: raw.top };
        }
      }
    } catch {
      // Suppress storage read errors
    }
    return null;
  }

  private savePosition(): void {
    if (!this.host) return;
    const rect = this.host.getBoundingClientRect();
    const pos: BubblePosition = { left: Math.round(rect.left), top: Math.round(rect.top) };

    try {
      this.chromeApi?.storage?.local?.set({ [POSITION_STORAGE_KEY]: pos });
    } catch {
      // Suppress storage write errors
    }
  }
}

/**
 * Convenience factory: mounts a count bubble and returns its controller.
 */
export function mountCountBubble(options?: CountBubbleOptions): CountBubbleController {
  const controller = new CountBubbleController(options);
  controller.mount();
  return controller;
}

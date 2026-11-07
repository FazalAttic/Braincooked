/**
 * src/popup/index.ts
 * BrainPal Obsidian Popup UI Controller & Fatigue Dashboard Logic.
 * Handles stats rendering, 5-stage brain fatigue progression, platform comparison,
 * reactive storage sync, and native reset confirmation modal.
 */

import type { BrainroadStats, FatigueStage, FatigueStageDefinition } from '../shared/types';
import { STORAGE_KEY_STATS, STORAGE_KEY_SESSION_SEEN } from '../shared/types';
import { FATIGUE_STAGES } from '../shared/constants';
import { getMascotSvg } from '../assets/mascots';

// ============================================================================
// 1. DATA CONTRACTS & VIEW MODEL
// ============================================================================

export interface PlatformBreakdown {
  igPercent: number;
  ytPercent: number;
}

export interface PopupViewModel {
  today: number;
  total: number;
  session: number;
  stage: FatigueStage;
  stageNumber: number;
  stageName: string;
  stageColor: string;
  stageDescription: string;
  instagramToday: number;
  youtubeToday: number;
  instagramPercent: number;
  youtubePercent: number;
  modalOpen: boolean;
}

// ============================================================================
// 2. PURE CALCULATION HELPERS
// ============================================================================

/**
 * Maps view count to the appropriate 5-stage fatigue definition.
 */
export function getFatigueStage(count: number): FatigueStageDefinition {
  const safeCount = Math.max(0, count);
  for (const def of FATIGUE_STAGES) {
    if (safeCount >= def.min && safeCount <= def.max) {
      return def;
    }
  }
  return FATIGUE_STAGES[0];
}

/**
 * Calculates Instagram vs YouTube proportion percentages.
 * Returns 0% for both if no views recorded today, avoiding division by zero.
 */
export function calculatePlatformBreakdown(instagramToday: number, youtubeToday: number): PlatformBreakdown {
  const ig = Math.max(0, instagramToday);
  const yt = Math.max(0, youtubeToday);
  const total = ig + yt;

  if (total <= 0) {
    return { igPercent: 0, ytPercent: 0 };
  }

  const igPercent = Math.round((ig / total) * 100);
  const ytPercent = Math.round((yt / total) * 100);

  return { igPercent, ytPercent };
}

/**
 * Creates default initial statistics.
 */
export function createInitialStats(): BrainroadStats {
  const todayStr = new Date().toISOString().slice(0, 10);
  return {
    version: 1,
    total: 0,
    today: 0,
    lastActiveDate: todayStr,
    platforms: {
      instagram: { total: 0, today: 0 },
      youtube: { total: 0, today: 0 }
    },
    history: {},
    updatedAt: Date.now()
  };
}

/**
 * Transforms domain statistics into the UI View Model.
 */
export function createPopupViewModel(
  stats: BrainroadStats,
  sessionCount = 0,
  modalOpen = false
): PopupViewModel {
  const stageDef = getFatigueStage(stats.today);
  const stageIdx = FATIGUE_STAGES.findIndex((s) => s.stage === stageDef.stage);
  const stageNumber = stageIdx >= 0 ? stageIdx + 1 : 1;
  const breakdown = calculatePlatformBreakdown(
    stats.platforms.instagram.today,
    stats.platforms.youtube.today
  );

  return {
    today: stats.today,
    total: stats.total,
    session: sessionCount,
    stage: stageDef.stage,
    stageNumber,
    stageName: stageDef.name,
    stageColor: stageDef.color,
    stageDescription: stageDef.description,
    instagramToday: stats.platforms.instagram.today,
    youtubeToday: stats.platforms.youtube.today,
    instagramPercent: breakdown.igPercent,
    youtubePercent: breakdown.ytPercent,
    modalOpen
  };
}

// ============================================================================
// 3. POPUP UI CONTROLLER CLASS
// ============================================================================

export class PopupController {
  private document: Document;
  private currentStats: BrainroadStats;
  private sessionCount: number;
  private isModalOpen: boolean;

  // Cached DOM elements
  private heroTodayEl: HTMLElement | null = null;
  private mascotContainerEl: HTMLElement | null = null;
  private stageBadgeEl: HTMLElement | null = null;
  private stageNameEl: HTMLElement | null = null;
  private stageDescEl: HTMLElement | null = null;
  private igCountEl: HTMLElement | null = null;
  private igPercentEl: HTMLElement | null = null;
  private igBarEl: HTMLElement | null = null;
  private igProgressEl: HTMLElement | null = null;
  private ytCountEl: HTMLElement | null = null;
  private ytPercentEl: HTMLElement | null = null;
  private ytBarEl: HTMLElement | null = null;
  private ytProgressEl: HTMLElement | null = null;
  private horizonTodayEl: HTMLElement | null = null;
  private horizonSessionEl: HTMLElement | null = null;
  private horizonTotalEl: HTMLElement | null = null;
  private btnOpenResetEl: HTMLButtonElement | null = null;
  private btnCancelResetEl: HTMLButtonElement | null = null;
  private btnConfirmResetEl: HTMLButtonElement | null = null;
  private resetModalEl: HTMLDialogElement | null = null;

  private boundStorageChangeHandler: ((changes: Record<string, chrome.storage.StorageChange>, area: string) => void) | null = null;

  constructor(doc: Document = document) {
    this.document = doc;
    this.currentStats = createInitialStats();
    this.sessionCount = 0;
    this.isModalOpen = false;
  }

  /**
   * Initializes DOM bindings, loads stats, registers storage & modal listeners.
   */
  public async init(): Promise<void> {
    this.cacheDomElements();
    this.attachEventListeners();
    await this.loadInitialData();
    this.render();
    this.setupStorageListener();
  }

  /**
   * Disconnects storage listeners.
   */
  public destroy(): void {
    if (this.boundStorageChangeHandler && typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(this.boundStorageChangeHandler);
      this.boundStorageChangeHandler = null;
    }
  }

  /**
   * Current View Model representation.
   */
  public getViewModel(): PopupViewModel {
    return createPopupViewModel(this.currentStats, this.sessionCount, this.isModalOpen);
  }

  /**
   * Updates state with new BrainroadStats and triggers re-render.
   */
  public updateStats(newStats: BrainroadStats, newSessionCount?: number): void {
    this.currentStats = newStats;
    if (typeof newSessionCount === 'number') {
      this.sessionCount = newSessionCount;
    }
    this.render();
  }

  /**
   * Opens the Reset Confirmation Modal.
   */
  public openResetModal(): boolean {
    this.isModalOpen = true;
    if (this.resetModalEl) {
      if (typeof this.resetModalEl.showModal === 'function') {
        try {
          if (!this.resetModalEl.open) {
            this.resetModalEl.showModal();
          }
        } catch {
          this.resetModalEl.setAttribute('open', '');
        }
      } else {
        this.resetModalEl.setAttribute('open', '');
      }
    }
    return this.isModalOpen;
  }

  /**
   * Cancels the reset action, closing the modal and preserving counters.
   */
  public cancelResetModal(): boolean {
    this.isModalOpen = false;
    if (this.resetModalEl) {
      if (typeof this.resetModalEl.close === 'function') {
        try {
          this.resetModalEl.close('cancel');
        } catch {
          this.resetModalEl.removeAttribute('open');
        }
      } else {
        this.resetModalEl.removeAttribute('open');
      }
      this.resetModalEl.returnValue = '';
    }
    return this.isModalOpen;
  }

  /**
   * Confirms the reset action: sends message, updates UI to 0, preserves all-time history.
   */
  public async confirmResetModal(): Promise<{ ok: boolean; stats?: BrainroadStats }> {
    this.isModalOpen = false;
    if (this.resetModalEl) {
      if (typeof this.resetModalEl.close === 'function') {
        try {
          this.resetModalEl.close('confirm');
        } catch {
          this.resetModalEl.removeAttribute('open');
        }
      } else {
        this.resetModalEl.removeAttribute('open');
      }
      this.resetModalEl.returnValue = '';
    }

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        const response = await chrome.runtime.sendMessage({ type: 'RESET_STATS', scope: 'today' });
        if (response && response.ok && response.stats) {
          this.currentStats = response.stats;
          this.sessionCount = 0;
          this.render();
          return { ok: true, stats: response.stats };
        }
      }
    } catch (err) {
      console.warn('[Brainroad Popup] RESET_STATS message dispatch error:', err);
    }

    // Direct fallback if messaging is unavailable or returns void
    this.currentStats.today = 0;
    this.currentStats.platforms.instagram.today = 0;
    this.currentStats.platforms.youtube.today = 0;
    this.sessionCount = 0;
    this.render();
    return { ok: true, stats: this.currentStats };
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  private cacheDomElements(): void {
    const doc = this.document;
    this.heroTodayEl = doc.getElementById('hero-today-count');
    this.mascotContainerEl = doc.getElementById('mascot-container');
    this.stageBadgeEl = doc.getElementById('stage-badge');
    this.stageNameEl = doc.getElementById('stage-name');
    this.stageDescEl = doc.getElementById('stage-description');

    this.igCountEl = doc.getElementById('ig-count');
    this.igPercentEl = doc.getElementById('ig-percent');
    this.igBarEl = doc.getElementById('ig-bar');
    this.igProgressEl = doc.getElementById('ig-progress');

    this.ytCountEl = doc.getElementById('yt-count');
    this.ytPercentEl = doc.getElementById('yt-percent');
    this.ytBarEl = doc.getElementById('yt-bar');
    this.ytProgressEl = doc.getElementById('yt-progress');

    this.horizonTodayEl = doc.getElementById('horizon-today');
    this.horizonSessionEl = doc.getElementById('horizon-session');
    this.horizonTotalEl = doc.getElementById('horizon-total');

    this.btnOpenResetEl = doc.getElementById('btn-open-reset') as HTMLButtonElement | null;
    this.btnCancelResetEl = doc.getElementById('btn-cancel-reset') as HTMLButtonElement | null;
    this.btnConfirmResetEl = doc.getElementById('btn-confirm-reset') as HTMLButtonElement | null;
    this.resetModalEl = doc.getElementById('reset-modal') as HTMLDialogElement | null;
  }

  private attachEventListeners(): void {
    if (this.btnOpenResetEl) {
      this.btnOpenResetEl.addEventListener('click', () => {
        this.openResetModal();
      });
    }

    if (this.btnCancelResetEl) {
      this.btnCancelResetEl.addEventListener('click', () => {
        this.cancelResetModal();
      });
    }

    if (this.btnConfirmResetEl) {
      this.btnConfirmResetEl.addEventListener('click', () => {
        this.confirmResetModal().catch((err) => {
          console.error('[Brainroad Popup] Confirm reset error:', err);
        });
      });
    }

    if (this.resetModalEl) {
      // Light-dismiss & backdrop click handling
      this.resetModalEl.addEventListener('click', (e) => {
        if (e.target === this.resetModalEl) {
          this.cancelResetModal();
        }
      });

      this.resetModalEl.addEventListener('cancel', () => {
        this.cancelResetModal();
      });

      this.resetModalEl.addEventListener('close', () => {
        this.isModalOpen = false;
        if (this.resetModalEl) {
          this.resetModalEl.returnValue = '';
        }
      });
    }
  }

  private async loadInitialData(): Promise<void> {
    if (typeof chrome === 'undefined') {
      return;
    }

    // 1. Attempt IPC message to service worker
    try {
      if (chrome.runtime?.sendMessage) {
        const res = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
        if (res && res.ok && res.stats) {
          this.currentStats = res.stats;
        }
      }
    } catch {
      // Fallback to direct chrome.storage.local read below
    }

    // 2. Direct storage read fallback
    try {
      if (chrome.storage?.local) {
        const stored = await chrome.storage.local.get(STORAGE_KEY_STATS);
        if (stored && stored[STORAGE_KEY_STATS]) {
          this.currentStats = stored[STORAGE_KEY_STATS] as BrainroadStats;
        }
      }
    } catch (err) {
      console.warn('[Brainroad Popup] Storage read error:', err);
    }

    // 3. Query session seen count if available
    try {
      if (chrome.storage?.session) {
        const sessionData = await chrome.storage.session.get(STORAGE_KEY_SESSION_SEEN);
        const seenList = sessionData[STORAGE_KEY_SESSION_SEEN];
        if (Array.isArray(seenList)) {
          this.sessionCount = seenList.length;
        }
      }
    } catch {
      // Session storage might be restricted or empty
    }
  }

  private setupStorageListener(): void {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) {
      return;
    }

    this.boundStorageChangeHandler = (changes, areaName) => {
      if (areaName === 'local' && changes[STORAGE_KEY_STATS]) {
        const newStats = changes[STORAGE_KEY_STATS].newValue as BrainroadStats | undefined;
        if (newStats) {
          this.currentStats = newStats;
          this.render();
        }
      }

      if (areaName === 'session' && changes[STORAGE_KEY_SESSION_SEEN]) {
        const seenList = changes[STORAGE_KEY_SESSION_SEEN].newValue;
        if (Array.isArray(seenList)) {
          this.sessionCount = seenList.length;
          if (this.horizonSessionEl) {
            this.horizonSessionEl.textContent = String(this.sessionCount);
          }
        }
      }
    };

    chrome.storage.onChanged.addListener(this.boundStorageChangeHandler);
  }

  /**
   * Renders the current view model state to the cached DOM nodes.
   */
  public render(): void {
    if (!this.heroTodayEl) {
      this.cacheDomElements();
    }
    const vm = this.getViewModel();

    // 1. Hero Counter
    if (this.heroTodayEl) {
      this.heroTodayEl.textContent = String(vm.today);
    }

    // 2. Mascot SVG
    if (this.mascotContainerEl) {
      this.mascotContainerEl.innerHTML = getMascotSvg(vm.stage);
    }

    // 3. Stage Badge & Description
    if (this.stageBadgeEl) {
      this.stageBadgeEl.style.setProperty('--stage-color', vm.stageColor);
      this.stageBadgeEl.setAttribute('data-stage', vm.stage);
    }

    if (this.stageNameEl) {
      this.stageNameEl.textContent = vm.stageName;
      this.stageNameEl.style.color = vm.stageColor;
    }

    if (this.stageDescEl) {
      this.stageDescEl.textContent = vm.stageDescription;
    }

    // 4. Platform Breakdown
    if (this.igCountEl) {
      this.igCountEl.textContent = String(vm.instagramToday);
    }
    if (this.igPercentEl) {
      this.igPercentEl.textContent = `(${vm.instagramPercent}%)`;
    }
    if (this.igBarEl) {
      this.igBarEl.style.width = `${vm.instagramPercent}%`;
    }
    if (this.igProgressEl) {
      this.igProgressEl.setAttribute('aria-valuenow', String(vm.instagramPercent));
    }

    if (this.ytCountEl) {
      this.ytCountEl.textContent = String(vm.youtubeToday);
    }
    if (this.ytPercentEl) {
      this.ytPercentEl.textContent = `(${vm.youtubePercent}%)`;
    }
    if (this.ytBarEl) {
      this.ytBarEl.style.width = `${vm.youtubePercent}%`;
    }
    if (this.ytProgressEl) {
      this.ytProgressEl.setAttribute('aria-valuenow', String(vm.youtubePercent));
    }

    // 5. Multi-Horizon Breakdown
    if (this.horizonTodayEl) {
      this.horizonTodayEl.textContent = String(vm.today);
    }
    if (this.horizonSessionEl) {
      this.horizonSessionEl.textContent = String(vm.session);
    }
    if (this.horizonTotalEl) {
      this.horizonTotalEl.textContent = String(vm.total);
    }
  }
}

// ============================================================================
// 4. BROWSER POPUP RUNTIME AUTO-INITIALIZATION
// ============================================================================

export let globalPopupController: PopupController | null = null;

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      globalPopupController = new PopupController(document);
      globalPopupController.init().catch((err) => {
        console.error('[Brainroad] Failed to initialize popup UI:', err);
      });
    });
  } else {
    globalPopupController = new PopupController(document);
    globalPopupController.init().catch((err) => {
      console.error('[Brainroad] Failed to initialize popup UI:', err);
    });
  }
}

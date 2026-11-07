/**
 * tests/unit/popup.test.ts
 * Comprehensive Unit and DOM Integration Tests for BrainPal Popup UI & Fatigue Dashboard (Milestone M4).
 *
 * Verifies:
 * 1. Initial state rendering with zero counts
 * 2. 5-Stage Brain Fatigue transitions & boundary thresholds (0..20, 21..50, 51..100, 101..150, 151+)
 * 3. Platform breakdown percentage calculations (Instagram vs YouTube, division by zero prevention)
 * 4. Confirmed reset action modal (Cancel preserves count, Confirm resets today to 0 and updates badge)
 * 5. Reactive storage synchronization from background tab events
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mockChrome, installMockChrome } from '../mocks/chrome';
import {
  PopupController,
  getFatigueStage,
  calculatePlatformBreakdown,
  createInitialStats,
  createPopupViewModel
} from '../../src/popup/index';
import { STORAGE_KEY_STATS, STORAGE_KEY_SESSION_SEEN, type BrainroadStats } from '../../src/shared/types';
import { getMascotSvg } from '../../src/assets/mascots';

describe('BrainPal Popup UI & Fatigue Dashboard (Milestone M4)', () => {
  let controller: PopupController;

  beforeEach(async () => {
    installMockChrome();
    mockChrome.resetAll();

    // Load actual HTML template into JSDOM body
    const htmlPath = path.resolve(__dirname, '../../src/popup/index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    document.body.innerHTML = bodyMatch ? bodyMatch[1] : htmlContent;

    // Polyfill HTMLDialogElement showModal and close for JSDOM if needed
    const dialog = document.getElementById('reset-modal') as HTMLDialogElement;
    if (dialog) {
      if (!dialog.showModal) {
        dialog.showModal = function () {
          this.setAttribute('open', '');
        };
      }
      if (!dialog.close) {
        dialog.close = function (returnValue?: string) {
          this.removeAttribute('open');
          if (returnValue !== undefined) {
            this.returnValue = returnValue;
          }
        };
      }
    }

    controller = new PopupController(document);
    await controller.init();
  });

  afterEach(() => {
    if (controller) {
      controller.destroy();
    }
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // SUITE 1: Pure Functions & View Model Transformations
  // ==========================================================================
  describe('1. Pure Calculations & View Model Mapping', () => {
    describe('calculatePlatformBreakdown', () => {
      it('returns 0% for both when zero views have been recorded without NaN or division by zero', () => {
        const result = calculatePlatformBreakdown(0, 0);
        expect(result.igPercent).toBe(0);
        expect(result.ytPercent).toBe(0);
      });

      it('handles negative or invalid counts gracefully by clamping to 0', () => {
        const result = calculatePlatformBreakdown(-5, -10);
        expect(result.igPercent).toBe(0);
        expect(result.ytPercent).toBe(0);
      });

      it('calculates 100% Instagram when only Instagram reels seen', () => {
        const result = calculatePlatformBreakdown(15, 0);
        expect(result.igPercent).toBe(100);
        expect(result.ytPercent).toBe(0);
      });

      it('calculates 100% YouTube when only YouTube shorts seen', () => {
        const result = calculatePlatformBreakdown(0, 25);
        expect(result.igPercent).toBe(0);
        expect(result.ytPercent).toBe(100);
      });

      it('calculates 50% split accurately on equal counts', () => {
        const result = calculatePlatformBreakdown(20, 20);
        expect(result.igPercent).toBe(50);
        expect(result.ytPercent).toBe(50);
      });

      it('calculates 25% IG vs 75% YT on 1 vs 3 counts', () => {
        const result = calculatePlatformBreakdown(1, 3);
        expect(result.igPercent).toBe(25);
        expect(result.ytPercent).toBe(75);
      });

      it('correctly rounds percentages on asymmetric counts (35 vs 52)', () => {
        const result = calculatePlatformBreakdown(35, 52);
        // Total = 87. IG: 35/87 = 40.23% -> 40%. YT: 52/87 = 59.77% -> 60%.
        expect(result.igPercent).toBe(40);
        expect(result.ytPercent).toBe(60);
      });
    });

    describe('getFatigueStage thresholds', () => {
      it('classifies 0 to 20 views as Stage 1: Fresh Mind (#79D056)', () => {
        for (const count of [0, 1, 10, 19, 20]) {
          const stage = getFatigueStage(count);
          expect(stage.stage).toBe('fresh');
          expect(stage.name).toBe('Fresh Mind');
          expect(stage.color).toBe('#79D056');
        }
      });

      it('classifies 21 to 50 views as Stage 2: Warming Up (#FFE9B4)', () => {
        for (const count of [21, 30, 45, 50]) {
          const stage = getFatigueStage(count);
          expect(stage.stage).toBe('warming');
          expect(stage.name).toBe('Warming Up');
          expect(stage.color).toBe('#FFE9B4');
        }
      });

      it('classifies 51 to 100 views as Stage 3: Tired Brain (#FFB367)', () => {
        for (const count of [51, 65, 80, 100]) {
          const stage = getFatigueStage(count);
          expect(stage.stage).toBe('tired');
          expect(stage.name).toBe('Tired Brain');
          expect(stage.color).toBe('#FFB367');
        }
      });

      it('classifies 101 to 150 views as Stage 4: Drained (#FC4A52)', () => {
        for (const count of [101, 120, 140, 150]) {
          const stage = getFatigueStage(count);
          expect(stage.stage).toBe('drained');
          expect(stage.name).toBe('Drained');
          expect(stage.color).toBe('#FC4A52');
        }
      });

      it('classifies 151+ views as Stage 5: Brain Rot Alert (#9B51E0)', () => {
        for (const count of [151, 152, 200, 500, 10000]) {
          const stage = getFatigueStage(count);
          expect(stage.stage).toBe('rot');
          expect(stage.name).toBe('Brain Rot Alert');
          expect(stage.color).toBe('#9B51E0');
        }
      });

      it('accurately distinguishes strict boundary transitions', () => {
        expect(getFatigueStage(20).stage).toBe('fresh');
        expect(getFatigueStage(21).stage).toBe('warming');

        expect(getFatigueStage(50).stage).toBe('warming');
        expect(getFatigueStage(51).stage).toBe('tired');

        expect(getFatigueStage(100).stage).toBe('tired');
        expect(getFatigueStage(101).stage).toBe('drained');

        expect(getFatigueStage(150).stage).toBe('drained');
        expect(getFatigueStage(151).stage).toBe('rot');
      });
    });

    describe('createPopupViewModel', () => {
      it('creates full view model structure with initial zero stats', () => {
        const stats = createInitialStats();
        const vm = createPopupViewModel(stats, 0, false);

        expect(vm.today).toBe(0);
        expect(vm.total).toBe(0);
        expect(vm.session).toBe(0);
        expect(vm.stage).toBe('fresh');
        expect(vm.stageNumber).toBe(1);
        expect(vm.stageName).toBe('Fresh Mind');
        expect(vm.stageColor).toBe('#79D056');
        expect(vm.instagramToday).toBe(0);
        expect(vm.youtubeToday).toBe(0);
        expect(vm.instagramPercent).toBe(0);
        expect(vm.youtubePercent).toBe(0);
        expect(vm.modalOpen).toBe(false);
      });
    });
  });

  // ==========================================================================
  // SUITE 2: DOM Initial State Rendering (Zero Counts)
  // ==========================================================================
  describe('2. Initial State DOM Rendering', () => {
    it('renders zero counts across hero, horizon, and platform breakdown', async () => {
      await controller.init();

      const heroToday = document.getElementById('hero-today-count');
      const horizonToday = document.getElementById('horizon-today');
      const horizonSession = document.getElementById('horizon-session');
      const horizonTotal = document.getElementById('horizon-total');
      const igCount = document.getElementById('ig-count');
      const ytCount = document.getElementById('yt-count');

      expect(heroToday?.textContent).toBe('0');
      expect(horizonToday?.textContent).toBe('0');
      expect(horizonSession?.textContent).toBe('0');
      expect(horizonTotal?.textContent).toBe('0');
      expect(igCount?.textContent).toBe('0');
      expect(ytCount?.textContent).toBe('0');
    });

    it('renders Stage 1 Fresh Mind mascot SVG and badge styles initially', async () => {
      await controller.init();

      const mascotContainer = document.getElementById('mascot-container');
      const stageBadge = document.getElementById('stage-badge');
      const stageName = document.getElementById('stage-name');

      expect(mascotContainer?.innerHTML).toContain('Fresh Mind Mascot');
      expect(mascotContainer?.innerHTML).toContain('#79D056');
      expect(stageName?.textContent).toBe('Fresh Mind');
      expect(stageBadge?.getAttribute('data-stage')).toBe('fresh');
    });

    it('renders progress tracks at 0% width with correct ARIA attributes', async () => {
      await controller.init();

      const igBar = document.getElementById('ig-bar');
      const ytBar = document.getElementById('yt-bar');
      const igProgress = document.getElementById('ig-progress');
      const ytProgress = document.getElementById('yt-progress');

      expect(igBar?.style.width).toBe('0%');
      expect(ytBar?.style.width).toBe('0%');
      expect(igProgress?.getAttribute('aria-valuenow')).toBe('0');
      expect(ytProgress?.getAttribute('aria-valuenow')).toBe('0');
    });

    it('renders reset modal initially closed', async () => {
      await controller.init();

      const resetModal = document.getElementById('reset-modal') as HTMLDialogElement;
      expect(resetModal.hasAttribute('open')).toBe(false);
      expect(controller.getViewModel().modalOpen).toBe(false);
    });
  });

  // ==========================================================================
  // SUITE 3: Dynamic Fatigue Stage Transitions in DOM
  // ==========================================================================
  describe('3. Dynamic Fatigue Stage Transitions in DOM', () => {
    it('transitions to Stage 2 Warming Up at 25 views', () => {
      const stats = createInitialStats();
      stats.today = 25;
      stats.platforms.instagram.today = 15;
      stats.platforms.youtube.today = 10;
      stats.total = 100;

      controller.updateStats(stats);

      const heroToday = document.getElementById('hero-today-count');
      const mascot = document.getElementById('mascot-container');
      const stageBadge = document.getElementById('stage-badge');
      const stageName = document.getElementById('stage-name');

      expect(heroToday?.textContent).toBe('25');
      expect(stageBadge?.getAttribute('data-stage')).toBe('warming');
      expect(stageName?.textContent).toBe('Warming Up');
      expect(mascot?.innerHTML).toContain('Warming Up Mascot');
      expect(mascot?.innerHTML).toContain('#FFE9B4');
    });

    it('transitions to Stage 3 Tired Brain at 75 views', () => {
      const stats = createInitialStats();
      stats.today = 75;
      stats.platforms.instagram.today = 30;
      stats.platforms.youtube.today = 45;
      stats.total = 200;

      controller.updateStats(stats);

      const mascot = document.getElementById('mascot-container');
      const stageBadge = document.getElementById('stage-badge');
      const stageName = document.getElementById('stage-name');

      expect(stageBadge?.getAttribute('data-stage')).toBe('tired');
      expect(stageName?.textContent).toBe('Tired Brain');
      expect(mascot?.innerHTML).toContain('Tired Brain Mascot');
      expect(mascot?.innerHTML).toContain('#FFB367');
    });

    it('transitions to Stage 4 Drained at 125 views', () => {
      const stats = createInitialStats();
      stats.today = 125;
      stats.platforms.instagram.today = 60;
      stats.platforms.youtube.today = 65;
      stats.total = 350;

      controller.updateStats(stats);

      const mascot = document.getElementById('mascot-container');
      const stageBadge = document.getElementById('stage-badge');
      const stageName = document.getElementById('stage-name');

      expect(stageBadge?.getAttribute('data-stage')).toBe('drained');
      expect(stageName?.textContent).toBe('Drained');
      expect(mascot?.innerHTML).toContain('Drained Brain Mascot');
      expect(mascot?.innerHTML).toContain('#FC4A52');
    });

    it('transitions to Stage 5 Brain Rot Alert at 175 views', () => {
      const stats = createInitialStats();
      stats.today = 175;
      stats.platforms.instagram.today = 75;
      stats.platforms.youtube.today = 100;
      stats.total = 500;

      controller.updateStats(stats);

      const mascot = document.getElementById('mascot-container');
      const stageBadge = document.getElementById('stage-badge');
      const stageName = document.getElementById('stage-name');

      expect(stageBadge?.getAttribute('data-stage')).toBe('rot');
      expect(stageName?.textContent).toBe('Brain Rot Alert');
      expect(mascot?.innerHTML).toContain('Brain Rot Alert Mascot');
      expect(mascot?.innerHTML).toContain('#9B51E0');
    });

    it('updates multi-horizon counters accurately on stats update', () => {
      const stats = createInitialStats();
      stats.today = 42;
      stats.total = 1337;

      controller.updateStats(stats, 15);

      const horizonToday = document.getElementById('horizon-today');
      const horizonSession = document.getElementById('horizon-session');
      const horizonTotal = document.getElementById('horizon-total');

      expect(horizonToday?.textContent).toBe('42');
      expect(horizonSession?.textContent).toBe('15');
      expect(horizonTotal?.textContent).toBe('1337');
    });
  });

  // ==========================================================================
  // SUITE 4: Platform Breakdown Percentage DOM Updates
  // ==========================================================================
  describe('4. Platform Breakdown DOM Updates', () => {
    it('updates progress bars and labels to 25% IG and 75% YT', () => {
      const stats = createInitialStats();
      stats.today = 4;
      stats.platforms.instagram.today = 1;
      stats.platforms.youtube.today = 3;

      controller.updateStats(stats);

      const igCount = document.getElementById('ig-count');
      const igPercent = document.getElementById('ig-percent');
      const igBar = document.getElementById('ig-bar');

      const ytCount = document.getElementById('yt-count');
      const ytPercent = document.getElementById('yt-percent');
      const ytBar = document.getElementById('yt-bar');

      expect(igCount?.textContent).toBe('1');
      expect(igPercent?.textContent).toBe('(25%)');
      expect(igBar?.style.width).toBe('25%');

      expect(ytCount?.textContent).toBe('3');
      expect(ytPercent?.textContent).toBe('(75%)');
      expect(ytBar?.style.width).toBe('75%');
    });

    it('updates progress bars to 100% IG when all views are Instagram', () => {
      const stats = createInitialStats();
      stats.today = 10;
      stats.platforms.instagram.today = 10;
      stats.platforms.youtube.today = 0;

      controller.updateStats(stats);

      const igBar = document.getElementById('ig-bar');
      const ytBar = document.getElementById('yt-bar');

      expect(igBar?.style.width).toBe('100%');
      expect(ytBar?.style.width).toBe('0%');
    });
  });

  // ==========================================================================
  // SUITE 5: Confirmed Reset Modal Actions (Cancel vs Confirm)
  // ==========================================================================
  describe('5. Confirmed Reset Modal User Actions', () => {
    it('clicking Reset Today button opens the confirmation modal', async () => {
      await controller.init();

      const btnOpen = document.getElementById('btn-open-reset');
      const modal = document.getElementById('reset-modal') as HTMLDialogElement;

      expect(modal.hasAttribute('open')).toBe(false);

      btnOpen?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(modal.hasAttribute('open')).toBe(true);
      expect(controller.getViewModel().modalOpen).toBe(true);
    });

    it('clicking Cancel button closes the modal and preserves current counters', async () => {
      await controller.init();

      // Seed stats with active counts
      const stats = createInitialStats();
      stats.today = 45;
      stats.total = 120;
      stats.platforms.instagram.today = 20;
      stats.platforms.youtube.today = 25;
      controller.updateStats(stats);

      // Open modal
      controller.openResetModal();
      const modal = document.getElementById('reset-modal') as HTMLDialogElement;
      expect(modal.hasAttribute('open')).toBe(true);

      // Click Cancel
      const btnCancel = document.getElementById('btn-cancel-reset');
      btnCancel?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // Modal closed
      expect(modal.hasAttribute('open')).toBe(false);
      expect(controller.getViewModel().modalOpen).toBe(false);

      // Counts remain untouched!
      const vm = controller.getViewModel();
      expect(vm.today).toBe(45);
      expect(vm.total).toBe(120);
      expect(vm.instagramToday).toBe(20);
      expect(vm.youtubeToday).toBe(25);
    });

    it('clicking Confirm button dispatches RESET_STATS message, resets today to 0, and preserves all-time', async () => {
      await controller.init();

      // Seed stats
      const stats = createInitialStats();
      stats.today = 88;
      stats.total = 540;
      stats.platforms.instagram.today = 40;
      stats.platforms.youtube.today = 48;
      controller.updateStats(stats);

      // Mock service worker response to RESET_STATS
      const sendMessageSpy = vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue({
        ok: true,
        stats: {
          ...stats,
          today: 0,
          platforms: {
            instagram: { total: stats.platforms.instagram.total, today: 0 },
            youtube: { total: stats.platforms.youtube.total, today: 0 }
          },
          updatedAt: Date.now()
        }
      });

      // Open modal
      controller.openResetModal();
      const modal = document.getElementById('reset-modal') as HTMLDialogElement;
      expect(modal.hasAttribute('open')).toBe(true);

      // Click Confirm
      const btnConfirm = document.getElementById('btn-confirm-reset');
      btnConfirm?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // Await next microtask tick for async confirm
      await Promise.resolve();
      await Promise.resolve();

      expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'RESET_STATS', scope: 'today' });
      expect(modal.hasAttribute('open')).toBe(false);

      const vm = controller.getViewModel();
      expect(vm.today).toBe(0);
      expect(vm.total).toBe(540); // All-time preserved!
      expect(vm.instagramToday).toBe(0);
      expect(vm.youtubeToday).toBe(0);
      expect(vm.stageName).toBe('Fresh Mind');
      expect(vm.stageColor).toBe('#79D056');
    });

    it('cancels modal when user clicks directly on backdrop', async () => {
      await controller.init();
      controller.openResetModal();

      const modal = document.getElementById('reset-modal') as HTMLDialogElement;
      expect(modal.hasAttribute('open')).toBe(true);

      // Simulate click directly on dialog element (backdrop target)
      modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(modal.hasAttribute('open')).toBe(false);
      expect(controller.getViewModel().modalOpen).toBe(false);
    });
  });

  // ==========================================================================
  // SUITE 6: Reactive Sync from chrome.storage.onChanged
  // ==========================================================================
  describe('6. Reactive Storage Synchronization', () => {
    it('updates popup UI in real-time when chrome.storage.local fires onChanged', async () => {
      await controller.init();

      expect(document.getElementById('hero-today-count')?.textContent).toBe('0');

      const updatedStats: BrainroadStats = {
        version: 1,
        total: 15,
        today: 15,
        lastActiveDate: new Date().toISOString().slice(0, 10),
        platforms: {
          instagram: { total: 10, today: 10 },
          youtube: { total: 5, today: 5 }
        },
        history: {},
        updatedAt: Date.now()
      };

      // Trigger mock storage change event
      await mockChrome.storage.local.set({ [STORAGE_KEY_STATS]: updatedStats });

      const heroToday = document.getElementById('hero-today-count');
      const igCount = document.getElementById('ig-count');
      const ytCount = document.getElementById('yt-count');
      const stageBadge = document.getElementById('stage-badge');

      expect(heroToday?.textContent).toBe('15');
      expect(igCount?.textContent).toBe('10');
      expect(ytCount?.textContent).toBe('5');
      expect(stageBadge?.getAttribute('data-stage')).toBe('fresh');
    });

    it('updates session counter when session storage changes', async () => {
      await controller.init();

      await mockChrome.storage.session.set({
        [STORAGE_KEY_SESSION_SEEN]: ['id1', 'id2', 'id3', 'id4', 'id5']
      });

      const horizonSession = document.getElementById('horizon-session');
      expect(horizonSession?.textContent).toBe('5');
    });
  });

  // ==========================================================================
  // SUITE 7: Visual SVG Mascot Assets Integrity
  // ==========================================================================
  describe('7. SVG Brain Mascot Assets Integrity', () => {
    it('all 5 SVG mascot states return valid non-empty SVG markup with correct stage colors', () => {
      const stages = ['fresh', 'warming', 'tired', 'drained', 'rot'] as const;
      const expectedColors = ['#79D056', '#FFE9B4', '#FFB367', '#FC4A52', '#9B51E0'];

      stages.forEach((stage, idx) => {
        const svg = getMascotSvg(stage);
        expect(svg).toBeTruthy();
        expect(svg).toContain('<svg');
        expect(svg).toContain('</svg>');
        expect(svg).toContain('viewBox="0 0 120 120"');
        expect(svg).toContain(expectedColors[idx]);
      });
    });

    it('standalone SVG files exist on disk in src/assets/ matching the 5 stages', () => {
      const assetsDir = path.resolve(__dirname, '../../src/assets');
      const expectedFiles = [
        'brain-fresh.svg',
        'brain-warming.svg',
        'brain-tired.svg',
        'brain-drained.svg',
        'brain-rot.svg'
      ];

      for (const file of expectedFiles) {
        const filePath = path.join(assetsDir, file);
        expect(fs.existsSync(filePath)).toBe(true);
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('<svg');
        expect(content).toContain('</svg>');
      }
    });
  });
});

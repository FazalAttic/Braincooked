/**
 * tests/unit/challenger_m4_1.test.ts
 * Empirical Adversarial Challenge Test Suite for Milestone M4 (BrainPal Popup UI).
 *
 * Authored by: Challenger M4-1 (teamwork_challenger)
 * Verified against:
 * 1. Stage threshold boundaries & off-by-one transitions (0, 19, 20 vs 21; 49, 50 vs 51; 99, 100 vs 101; 149, 150 vs 151)
 * 2. Extreme values (10,000, 999,999, 1,000,000, MAX_SAFE_INTEGER) and layout/string resilience
 * 3. Platform breakdown mathematical boundary stress (0/0, 100/0, 0/100, 1/2 rounding, negative clamping)
 * 4. Confirmed Reset Modal behavior under Cancel, Backdrop click, and Confirm flows with all-time retention
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mockChrome, installMockChrome } from '../mocks/chrome';
import {
  PopupController,
  getFatigueStage,
  calculatePlatformBreakdown,
  createInitialStats
} from '../../src/popup/index';

describe('Adversarial Challenge M4-1: BrainPal Popup UI & Fatigue Dashboard', () => {
  let controller: PopupController;

  beforeEach(async () => {
    installMockChrome();
    mockChrome.resetAll();

    // Load actual HTML template into JSDOM body
    const htmlPath = path.resolve(__dirname, '../../src/popup/index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    document.body.innerHTML = bodyMatch ? bodyMatch[1] : htmlContent;

    // Polyfill HTMLDialogElement showModal and close for JSDOM
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
  // SECTION 1: STAGE THRESHOLD BOUNDARIES & OFF-BY-ONE TRANSITIONS
  // ==========================================================================
  describe('1. Stage Threshold Boundaries & Off-By-One Transitions', () => {
    it('accurately verifies Fresh Mind (0..20) vs Warming Up (21) boundary transition', () => {
      // Boundaries: 0, 19, 20 must be Fresh Mind
      expect(getFatigueStage(0).stage).toBe('fresh');
      expect(getFatigueStage(0).name).toBe('Fresh Mind');
      expect(getFatigueStage(0).color).toBe('#79D056');

      expect(getFatigueStage(19).stage).toBe('fresh');
      expect(getFatigueStage(19).name).toBe('Fresh Mind');
      expect(getFatigueStage(19).color).toBe('#79D056');

      expect(getFatigueStage(20).stage).toBe('fresh');
      expect(getFatigueStage(20).name).toBe('Fresh Mind');
      expect(getFatigueStage(20).color).toBe('#79D056');

      // 21 must step up to Warming Up
      expect(getFatigueStage(21).stage).toBe('warming');
      expect(getFatigueStage(21).name).toBe('Warming Up');
      expect(getFatigueStage(21).color).toBe('#FFE9B4');
    });

    it('accurately verifies Warming Up (21..50) vs Tired Brain (51) boundary transition', () => {
      expect(getFatigueStage(49).stage).toBe('warming');
      expect(getFatigueStage(49).name).toBe('Warming Up');
      expect(getFatigueStage(49).color).toBe('#FFE9B4');

      expect(getFatigueStage(50).stage).toBe('warming');
      expect(getFatigueStage(50).name).toBe('Warming Up');
      expect(getFatigueStage(50).color).toBe('#FFE9B4');

      // 51 must step up to Tired Brain
      expect(getFatigueStage(51).stage).toBe('tired');
      expect(getFatigueStage(51).name).toBe('Tired Brain');
      expect(getFatigueStage(51).color).toBe('#FFB367');
    });

    it('accurately verifies Tired Brain (51..100) vs Drained (101) boundary transition', () => {
      expect(getFatigueStage(99).stage).toBe('tired');
      expect(getFatigueStage(99).name).toBe('Tired Brain');
      expect(getFatigueStage(99).color).toBe('#FFB367');

      expect(getFatigueStage(100).stage).toBe('tired');
      expect(getFatigueStage(100).name).toBe('Tired Brain');
      expect(getFatigueStage(100).color).toBe('#FFB367');

      // 101 must step up to Drained
      expect(getFatigueStage(101).stage).toBe('drained');
      expect(getFatigueStage(101).name).toBe('Drained');
      expect(getFatigueStage(101).color).toBe('#FC4A52');
    });

    it('accurately verifies Drained (101..150) vs Brain Rot Alert (151) boundary transition', () => {
      expect(getFatigueStage(149).stage).toBe('drained');
      expect(getFatigueStage(149).name).toBe('Drained');
      expect(getFatigueStage(149).color).toBe('#FC4A52');

      expect(getFatigueStage(150).stage).toBe('drained');
      expect(getFatigueStage(150).name).toBe('Drained');
      expect(getFatigueStage(150).color).toBe('#FC4A52');

      // 151 must step up to Brain Rot Alert
      expect(getFatigueStage(151).stage).toBe('rot');
      expect(getFatigueStage(151).name).toBe('Brain Rot Alert');
      expect(getFatigueStage(151).color).toBe('#9B51E0');
    });

    it('adversarially tests extreme large values: 10,000, 999,999, 1,000,000, Number.MAX_SAFE_INTEGER', () => {
      const extremeValues = [10_000, 999_999, 1_000_000, 100_000_000, Number.MAX_SAFE_INTEGER];
      for (const val of extremeValues) {
        const stage = getFatigueStage(val);
        expect(stage.stage).toBe('rot');
        expect(stage.name).toBe('Brain Rot Alert');
        expect(stage.color).toBe('#9B51E0');
      }
    });

    it('resiliently handles negative and non-integer edge cases in getFatigueStage', () => {
      // Negative numbers clamped to 0 -> fresh
      expect(getFatigueStage(-1).stage).toBe('fresh');
      expect(getFatigueStage(-1000).stage).toBe('fresh');

      // Fractional values within range
      expect(getFatigueStage(10.5).stage).toBe('fresh');
      expect(getFatigueStage(35.2).stage).toBe('warming');
      expect(getFatigueStage(75.8).stage).toBe('tired');
      expect(getFatigueStage(125.1).stage).toBe('drained');
      expect(getFatigueStage(250.9).stage).toBe('rot');
    });
  });

  // ==========================================================================
  // SECTION 2: PLATFORM BREAKDOWN BOUNDARY STRESS
  // ==========================================================================
  describe('2. Platform Breakdown Boundary Stress', () => {
    it('verifies 0 IG / 0 YT yields 0% / 0% without NaN or error', () => {
      const breakdown = calculatePlatformBreakdown(0, 0);
      expect(breakdown.igPercent).toBe(0);
      expect(breakdown.ytPercent).toBe(0);
      expect(Number.isNaN(breakdown.igPercent)).toBe(false);
      expect(Number.isNaN(breakdown.ytPercent)).toBe(false);
    });

    it('verifies 100 IG / 0 YT yields 100% / 0%', () => {
      const breakdown = calculatePlatformBreakdown(100, 0);
      expect(breakdown.igPercent).toBe(100);
      expect(breakdown.ytPercent).toBe(0);
    });

    it('verifies 0 IG / 100 YT yields 0% / 100%', () => {
      const breakdown = calculatePlatformBreakdown(0, 100);
      expect(breakdown.igPercent).toBe(0);
      expect(breakdown.ytPercent).toBe(100);
    });

    it('verifies 1 IG / 2 YT yields 33% / 67% proper rounding', () => {
      const breakdown = calculatePlatformBreakdown(1, 2);
      expect(breakdown.igPercent).toBe(33);
      expect(breakdown.ytPercent).toBe(67);
      expect(breakdown.igPercent + breakdown.ytPercent).toBe(100);
    });

    it('verifies 2 IG / 1 YT yields 67% / 33% proper rounding', () => {
      const breakdown = calculatePlatformBreakdown(2, 1);
      expect(breakdown.igPercent).toBe(67);
      expect(breakdown.ytPercent).toBe(33);
      expect(breakdown.igPercent + breakdown.ytPercent).toBe(100);
    });

    it('verifies extreme volume breakdown: 500,000 IG / 500,000 YT yields 50% / 50%', () => {
      const breakdown = calculatePlatformBreakdown(500_000, 500_000);
      expect(breakdown.igPercent).toBe(50);
      expect(breakdown.ytPercent).toBe(50);
    });

    it('verifies heavy skew: 1 IG / 999,999 YT yields 0% / 100%', () => {
      const breakdown = calculatePlatformBreakdown(1, 999_999);
      expect(breakdown.igPercent).toBe(0);
      expect(breakdown.ytPercent).toBe(100);
    });

    it('verifies negative inputs are clamped safely without producing negative percentages', () => {
      const b1 = calculatePlatformBreakdown(-10, -50);
      expect(b1.igPercent).toBe(0);
      expect(b1.ytPercent).toBe(0);

      const b2 = calculatePlatformBreakdown(-10, 40);
      expect(b2.igPercent).toBe(0);
      expect(b2.ytPercent).toBe(100);

      const b3 = calculatePlatformBreakdown(40, -10);
      expect(b3.igPercent).toBe(100);
      expect(b3.ytPercent).toBe(0);
    });
  });

  // ==========================================================================
  // SECTION 3: RESET MODAL LOGIC STRESS
  // ==========================================================================
  describe('3. Reset Modal Logic Stress', () => {
    it('verifies Cancel button retains counts completely', async () => {
      const stats = createInitialStats();
      stats.today = 95;
      stats.total = 1250;
      stats.platforms.instagram.today = 40;
      stats.platforms.youtube.today = 55;
      controller.updateStats(stats, 30);

      controller.openResetModal();
      const modal = document.getElementById('reset-modal') as HTMLDialogElement;
      expect(modal.hasAttribute('open')).toBe(true);

      const btnCancel = document.getElementById('btn-cancel-reset');
      btnCancel?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(modal.hasAttribute('open')).toBe(false);

      const vm = controller.getViewModel();
      expect(vm.today).toBe(95);
      expect(vm.total).toBe(1250);
      expect(vm.session).toBe(30);
      expect(vm.instagramToday).toBe(40);
      expect(vm.youtubeToday).toBe(55);
    });

    it('verifies Backdrop click cancels modal and retains counts completely', async () => {
      const stats = createInitialStats();
      stats.today = 60;
      stats.total = 800;
      stats.platforms.instagram.today = 30;
      stats.platforms.youtube.today = 30;
      controller.updateStats(stats);

      controller.openResetModal();
      const modal = document.getElementById('reset-modal') as HTMLDialogElement;
      expect(modal.hasAttribute('open')).toBe(true);

      // Backdrop click target is dialog itself
      modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(modal.hasAttribute('open')).toBe(false);

      const vm = controller.getViewModel();
      expect(vm.today).toBe(60);
      expect(vm.total).toBe(800);
    });

    it('verifies Escape / cancel event cancels modal and retains counts completely', async () => {
      const stats = createInitialStats();
      stats.today = 35;
      stats.total = 400;
      controller.updateStats(stats);

      controller.openResetModal();
      const modal = document.getElementById('reset-modal') as HTMLDialogElement;
      expect(modal.hasAttribute('open')).toBe(true);

      modal.dispatchEvent(new Event('cancel', { bubbles: true }));

      expect(modal.hasAttribute('open')).toBe(false);
      expect(controller.getViewModel().today).toBe(35);
      expect(controller.getViewModel().total).toBe(400);
    });

    it('verifies Confirm button resets today count to 0 while keeping all-time total untouched', async () => {
      const stats = createInitialStats();
      stats.today = 110;
      stats.total = 3450;
      stats.platforms.instagram.today = 50;
      stats.platforms.youtube.today = 60;
      controller.updateStats(stats, 45);

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

      controller.openResetModal();
      const btnConfirm = document.getElementById('btn-confirm-reset');
      btnConfirm?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      await Promise.resolve();
      await Promise.resolve();

      expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'RESET_STATS', scope: 'today' });

      // View model assertions
      const vm = controller.getViewModel();
      expect(vm.today).toBe(0);
      expect(vm.total).toBe(3450); // Untouched!
      expect(vm.instagramToday).toBe(0);
      expect(vm.youtubeToday).toBe(0);
      expect(vm.instagramPercent).toBe(0);
      expect(vm.youtubePercent).toBe(0);
      expect(vm.stage).toBe('fresh');
      expect(vm.stageName).toBe('Fresh Mind');
      expect(vm.stageColor).toBe('#79D056');

      // DOM assertions
      const heroToday = document.getElementById('hero-today-count');
      const horizonToday = document.getElementById('horizon-today');
      const horizonTotal = document.getElementById('horizon-total');
      const igCount = document.getElementById('ig-count');
      const ytCount = document.getElementById('yt-count');
      const igBar = document.getElementById('ig-bar');
      const ytBar = document.getElementById('yt-bar');
      const stageBadge = document.getElementById('stage-badge');

      expect(heroToday?.textContent).toBe('0');
      expect(horizonToday?.textContent).toBe('0');
      expect(horizonTotal?.textContent).toBe('3450');
      expect(igCount?.textContent).toBe('0');
      expect(ytCount?.textContent).toBe('0');
      expect(igBar?.style.width).toBe('0%');
      expect(ytBar?.style.width).toBe('0%');
      expect(stageBadge?.getAttribute('data-stage')).toBe('fresh');
    });

    it('verifies resilient fallback when chrome.runtime.sendMessage fails or is unavailable', async () => {
      const stats = createInitialStats();
      stats.today = 80;
      stats.total = 1000;
      stats.platforms.instagram.today = 40;
      stats.platforms.youtube.today = 40;
      controller.updateStats(stats);

      // Force runtime message error
      vi.spyOn(chrome.runtime, 'sendMessage').mockRejectedValue(new Error('Extension context invalidated'));

      controller.openResetModal();
      const res = await controller.confirmResetModal();

      expect(res.ok).toBe(true);
      expect(res.stats?.today).toBe(0);
      expect(res.stats?.total).toBe(1000); // Preserved!
      expect(controller.getViewModel().today).toBe(0);
      expect(controller.getViewModel().total).toBe(1000);
      expect(document.getElementById('hero-today-count')?.textContent).toBe('0');
      expect(document.getElementById('horizon-total')?.textContent).toBe('1000');
    });
  });

  // ==========================================================================
  // SECTION 4: EXTREME LARGE VALUE DOM RENDERING & OVERFLOW RESILIENCE
  // ==========================================================================
  describe('4. Extreme Large Value Rendering & DOM Resilience', () => {
    it('renders 10,000, 999,999, and 1,000,000 without crashing or corrupting DOM state', () => {
      const testCases = [
        { today: 10_000, total: 50_000 },
        { today: 999_999, total: 2_500_000 },
        { today: 1_000_000, total: 10_000_000 }
      ];

      for (const tc of testCases) {
        const stats = createInitialStats();
        stats.today = tc.today;
        stats.total = tc.total;
        stats.platforms.instagram.today = Math.floor(tc.today / 2);
        stats.platforms.youtube.today = Math.ceil(tc.today / 2);

        controller.updateStats(stats, 500);

        const heroToday = document.getElementById('hero-today-count');
        const horizonToday = document.getElementById('horizon-today');
        const horizonTotal = document.getElementById('horizon-total');
        const mascotContainer = document.getElementById('mascot-container');
        const stageBadge = document.getElementById('stage-badge');
        const stageName = document.getElementById('stage-name');

        // Text content matches exact numbers
        expect(heroToday?.textContent).toBe(String(tc.today));
        expect(horizonToday?.textContent).toBe(String(tc.today));
        expect(horizonTotal?.textContent).toBe(String(tc.total));

        // Mascot is Brain Rot Alert with #9B51E0
        expect(stageBadge?.getAttribute('data-stage')).toBe('rot');
        expect(stageName?.textContent).toBe('Brain Rot Alert');
        expect(mascotContainer?.innerHTML).toContain('Brain Rot Alert Mascot');
        expect(mascotContainer?.innerHTML).toContain('#9B51E0');

        // Mascot SVG contains valid SVG root
        expect(mascotContainer?.innerHTML).toContain('<svg');
        expect(mascotContainer?.innerHTML).toContain('</svg>');
      }
    });

    it('verifies CSS container constraints and tabular-nums styling prevent layout shifts', () => {
      const cssPath = path.resolve(__dirname, '../../src/popup/index.css');
      const cssContent = fs.readFileSync(cssPath, 'utf-8');

      // Body constraints: width 360px, overflow-x hidden
      expect(cssContent).toContain('width: 360px');
      expect(cssContent).toContain('overflow-x: hidden');

      // Tabular numbers applied to numeric readouts
      expect(cssContent).toContain('font-variant-numeric: tabular-nums');

      // Modal containment rules per Modern Web Guidance
      expect(cssContent).toContain('dialog:modal');
      expect(cssContent).toContain('overscroll-behavior: contain');
      expect(cssContent).toContain('dialog::backdrop');
    });

    it('verifies that progress bars never exceed 100% width or drop below 0%', () => {
      const breakdownCases = [
        { ig: 0, yt: 0 },
        { ig: 100, yt: 0 },
        { ig: 0, yt: 100 },
        { ig: 50, yt: 50 },
        { ig: 1_000_000, yt: 0 },
        { ig: 0, yt: 1_000_000 }
      ];

      for (const bc of breakdownCases) {
        const stats = createInitialStats();
        stats.today = bc.ig + bc.yt;
        stats.platforms.instagram.today = bc.ig;
        stats.platforms.youtube.today = bc.yt;

        controller.updateStats(stats);

        const igBar = document.getElementById('ig-bar');
        const ytBar = document.getElementById('yt-bar');

        const igWidth = parseFloat(igBar?.style.width || '0');
        const ytWidth = parseFloat(ytBar?.style.width || '0');

        expect(igWidth).toBeGreaterThanOrEqual(0);
        expect(igWidth).toBeLessThanOrEqual(100);
        expect(ytWidth).toBeGreaterThanOrEqual(0);
        expect(ytWidth).toBeLessThanOrEqual(100);
      }
    });
  });
});

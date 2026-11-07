/**
 * tests/unit/badge.test.ts
 * Unit tests for Action Badge Manager, Formatting, and Brain Fatigue Stages.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mockChrome } from '../mocks/chrome';
import {
  formatBadgeCount,
  getFatigueStage,
  getBadgeColor,
  getBadgeTextColor,
  updateBadge,
  clearBadge,
  FATIGUE_STAGES
} from '../../src/background/badge';

describe('Action Badge Manager (src/background/badge.ts)', () => {
  beforeEach(() => {
    mockChrome.resetAll();
  });

  describe('1. formatBadgeCount Precision Formatting', () => {
    it('returns empty string for zero, negative, or invalid numbers', () => {
      expect(formatBadgeCount(0)).toBe('');
      expect(formatBadgeCount(-1)).toBe('');
      expect(formatBadgeCount(-500)).toBe('');
      expect(formatBadgeCount(NaN)).toBe('');
      expect(formatBadgeCount(-Infinity)).toBe('');
    });

    it('formats single-digit counts (1..9)', () => {
      expect(formatBadgeCount(1)).toBe('1');
      expect(formatBadgeCount(5)).toBe('5');
      expect(formatBadgeCount(9)).toBe('9');
    });

    it('formats two-digit and three-digit counts (10..999)', () => {
      expect(formatBadgeCount(10)).toBe('10');
      expect(formatBadgeCount(42)).toBe('42');
      expect(formatBadgeCount(99)).toBe('99');
      expect(formatBadgeCount(100)).toBe('100');
      expect(formatBadgeCount(500)).toBe('500');
      expect(formatBadgeCount(999)).toBe('999');
    });

    it('formats single-decimal thousands (1000..9999) without overflowing 4 characters', () => {
      expect(formatBadgeCount(1000)).toBe('1.0k');
      expect(formatBadgeCount(1200)).toBe('1.2k');
      expect(formatBadgeCount(1500)).toBe('1.5k');
      expect(formatBadgeCount(1999)).toBe('1.9k');
      expect(formatBadgeCount(9900)).toBe('9.9k');
      // Crucial edge case: 9999 must NOT round to 10.0k (5 chars)
      expect(formatBadgeCount(9999)).toBe('9.9k');
    });

    it('formats ten-thousands to hundreds of thousands (10000..999999)', () => {
      expect(formatBadgeCount(10000)).toBe('10k');
      expect(formatBadgeCount(12500)).toBe('12k');
      expect(formatBadgeCount(50000)).toBe('50k');
      expect(formatBadgeCount(99999)).toBe('99k');
      expect(formatBadgeCount(100000)).toBe('100k');
      expect(formatBadgeCount(500000)).toBe('500k');
      expect(formatBadgeCount(999000)).toBe('999k');
      expect(formatBadgeCount(999999)).toBe('999k');
    });

    it('formats 1,000,000+ as "1M+"', () => {
      expect(formatBadgeCount(1000000)).toBe('1M+');
      expect(formatBadgeCount(1500000)).toBe('1M+');
      expect(formatBadgeCount(10000000)).toBe('1M+');
      expect(formatBadgeCount(999999999)).toBe('1M+');
    });

    it('PROPERTY INVARIANT: every integer from -100 to 2,000,000 has length <= 4', () => {
      const testSamples = [
        ...Array.from({ length: 150 }, (_, i) => i - 50),
        ...Array.from({ length: 100 }, (_, i) => 950 + i),
        ...Array.from({ length: 100 }, (_, i) => 9950 + i),
        ...Array.from({ length: 50 }, (_, i) => 99950 + i),
        ...Array.from({ length: 50 }, (_, i) => 999950 + i),
        1500000, 2000000, 100000000
      ];

      for (const sample of testSamples) {
        const formatted = formatBadgeCount(sample);
        expect(
          formatted.length,
          `Expected formatBadgeCount(${sample}) -> "${formatted}" to have length <= 4`
        ).toBeLessThanOrEqual(4);
      }
    });
  });

  describe('2. Brain Fatigue Stages & Dynamic Colors', () => {
    it('defines exactly 5 fatigue stages matching BrainPal specifications', () => {
      expect(FATIGUE_STAGES).toHaveLength(5);
    });

    it('Stage 1: Fresh Mind (0..20) -> #79D056 with White text', () => {
      for (const count of [0, 1, 10, 19, 20]) {
        const stage = getFatigueStage(count);
        expect(stage.stage).toBe('fresh');
        expect(stage.color).toBe('#79D056');
        expect(stage.textColor).toBe('#FFFFFF');
        expect(getBadgeColor(count)).toBe('#79D056');
        expect(getBadgeTextColor(count)).toBe('#FFFFFF');
      }
    });

    it('Stage 2: Warming Up (21..50) -> #FFE9B4 with Dark text contrast', () => {
      for (const count of [21, 22, 35, 49, 50]) {
        const stage = getFatigueStage(count);
        expect(stage.stage).toBe('warming');
        expect(stage.color).toBe('#FFE9B4');
        expect(stage.textColor).toBe('#0A0907'); // High contrast dark text on yellow
        expect(getBadgeColor(count)).toBe('#FFE9B4');
        expect(getBadgeTextColor(count)).toBe('#0A0907');
      }
    });

    it('Stage 3: Tired Brain (51..100) -> #FFB367 with Dark text contrast', () => {
      for (const count of [51, 52, 75, 99, 100]) {
        const stage = getFatigueStage(count);
        expect(stage.stage).toBe('tired');
        expect(stage.color).toBe('#FFB367');
        expect(stage.textColor).toBe('#0A0907');
        expect(getBadgeColor(count)).toBe('#FFB367');
        expect(getBadgeTextColor(count)).toBe('#0A0907');
      }
    });

    it('Stage 4: Drained (101..150) -> #FC4A52 with White text', () => {
      for (const count of [101, 102, 125, 149, 150]) {
        const stage = getFatigueStage(count);
        expect(stage.stage).toBe('drained');
        expect(stage.color).toBe('#FC4A52');
        expect(stage.textColor).toBe('#FFFFFF');
        expect(getBadgeColor(count)).toBe('#FC4A52');
        expect(getBadgeTextColor(count)).toBe('#FFFFFF');
      }
    });

    it('Stage 5: Brain Rot Alert (151+) -> #9B51E0 with White text', () => {
      for (const count of [151, 152, 200, 500, 1000, 50000]) {
        const stage = getFatigueStage(count);
        expect(stage.stage).toBe('rot');
        expect(stage.color).toBe('#9B51E0');
        expect(stage.textColor).toBe('#FFFFFF');
        expect(getBadgeColor(count)).toBe('#9B51E0');
        expect(getBadgeTextColor(count)).toBe('#FFFFFF');
      }
    });
  });

  describe('3. Chrome Action API Integration', () => {
    it('updateBadge(0) clears the badge text', async () => {
      await updateBadge(0);
      expect(mockChrome.action.setBadgeTextCalls).toHaveLength(1);
      expect(mockChrome.action.setBadgeTextCalls[0]).toEqual({ text: '' });
      expect(await mockChrome.action.getBadgeText()).toBe('');
    });

    it('updateBadge(15) sets "15", #79D056 background, and #FFFFFF text', async () => {
      await updateBadge(15);

      expect(mockChrome.action.setBadgeTextCalls.at(-1)).toEqual({ text: '15' });
      expect(mockChrome.action.setBadgeBackgroundColorCalls.at(-1)).toEqual({ color: '#79D056', tabId: undefined });
      expect(mockChrome.action.setBadgeTextColorCalls.at(-1)).toEqual({ color: '#FFFFFF', tabId: undefined });
    });

    it('updateBadge(35) sets "35", #FFE9B4 background, and #0A0907 text for contrast', async () => {
      await updateBadge(35);

      expect(mockChrome.action.setBadgeTextCalls.at(-1)).toEqual({ text: '35' });
      expect(mockChrome.action.setBadgeBackgroundColorCalls.at(-1)).toEqual({ color: '#FFE9B4', tabId: undefined });
      expect(mockChrome.action.setBadgeTextColorCalls.at(-1)).toEqual({ color: '#0A0907', tabId: undefined });
    });

    it('updateBadge(120) sets "120" and #FC4A52 (Drained)', async () => {
      await updateBadge(120);

      expect(mockChrome.action.setBadgeTextCalls.at(-1)).toEqual({ text: '120' });
      expect(mockChrome.action.setBadgeBackgroundColorCalls.at(-1)).toEqual({ color: '#FC4A52', tabId: undefined });
    });

    it('updateBadge(250) sets "250" and #9B51E0 (Brain Rot Alert)', async () => {
      await updateBadge(250);

      expect(mockChrome.action.setBadgeTextCalls.at(-1)).toEqual({ text: '250' });
      expect(mockChrome.action.setBadgeBackgroundColorCalls.at(-1)).toEqual({ color: '#9B51E0', tabId: undefined });
    });

    it('updateBadge(1500) sets "1.5k" and #9B51E0 (Rot stage)', async () => {
      await updateBadge(1500);

      expect(mockChrome.action.setBadgeTextCalls.at(-1)).toEqual({ text: '1.5k' });
      expect(mockChrome.action.setBadgeBackgroundColorCalls.at(-1)).toEqual({ color: '#9B51E0', tabId: undefined });
    });

    it('clearBadge() invokes chrome.action.setBadgeText with empty string', async () => {
      await updateBadge(42);
      expect(await mockChrome.action.getBadgeText()).toBe('42');

      await clearBadge();
      expect(mockChrome.action.setBadgeTextCalls.at(-1)).toEqual({ text: '' });
      expect(await mockChrome.action.getBadgeText()).toBe('');
    });
  });
});

/**
 * src/background/badge.ts
 * Brainroad Action Badge Manager.
 * Handles compact 4-character badge count formatting and dynamic brain fatigue color shifts.
 */

import { FATIGUE_STAGES } from '../shared/constants';
import type { FatigueStage, FatigueStageDefinition } from '../shared/types';

export { FATIGUE_STAGES };
export type { FatigueStage, FatigueStageDefinition };

/**
 * Formats a numerical count into a strict <= 4-character string for Chrome action badge.
 *
 * Rules:
 *  - count <= 0: '' (badge cleared)
 *  - 1..999: '1'..'999' (1-3 chars)
 *  - 1000..9999: '1.0k'..'9.9k' (4 chars, floored tenths to prevent 10.0k overflow)
 *  - 10000..999999: '10k'..'999k' (3-4 chars)
 *  - >= 1000000: '1M+' (4 chars)
 */
export function formatBadgeCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) {
    return '';
  }

  const intCount = Math.floor(count);

  if (intCount < 1000) {
    return String(intCount);
  }

  if (intCount < 10000) {
    // Floor to nearest tenth to guarantee never exceeding 4 chars (e.g. 9999 -> 9.9k, not 10.0k)
    const tenths = (Math.floor(intCount / 100) / 10).toFixed(1);
    return `${tenths}k`;
  }

  if (intCount < 1000000) {
    const thousands = Math.floor(intCount / 1000);
    return `${thousands}k`;
  }

  return '1M+';
}

/**
 * Resolves the active Fatigue Stage definition for a given count.
 */
export function getFatigueStage(count: number): FatigueStageDefinition {
  const safeCount = Math.max(0, Number.isFinite(count) ? Math.floor(count) : 0);
  for (const stage of FATIGUE_STAGES) {
    if (safeCount <= stage.max) {
      return stage;
    }
  }
  return FATIGUE_STAGES[FATIGUE_STAGES.length - 1];
}

/**
 * Returns the hex background color corresponding to the active fatigue stage.
 */
export function getBadgeColor(count: number): string {
  return getFatigueStage(count).color;
}

/**
 * Returns the high-contrast hex text color for the active fatigue stage.
 */
export function getBadgeTextColor(count: number): string {
  return getFatigueStage(count).textColor;
}

/**
 * Updates the Chrome extension action badge text, background color, and text color globally.
 * Invoked by service worker whenever storage changes or counts increment.
 */
export async function updateBadge(count: number): Promise<void> {
  const text = formatBadgeCount(count);
  const stage = getFatigueStage(count);

  // 1. Set Badge Text (global, tabId omitted)
  await chrome.action.setBadgeText({ text });

  // 2. Set Colors if badge has content
  if (text !== '') {
    await chrome.action.setBadgeBackgroundColor({ color: stage.color });

    if (typeof chrome.action.setBadgeTextColor === 'function') {
      try {
        await chrome.action.setBadgeTextColor({ color: stage.textColor });
      } catch {
        // Fallback gracefully if Chromium platform doesn't support setBadgeTextColor
      }
    }
  }
}

/**
 * Explicitly clears the action badge overlay.
 */
export async function clearBadge(): Promise<void> {
  await chrome.action.setBadgeText({ text: '' });
}

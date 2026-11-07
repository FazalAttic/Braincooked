/**
 * src/shared/constants.ts
 * Brainroad global constants: fatigue stages, branding colors, and retention policies.
 */

import type { FatigueStageDefinition } from './types';

export const FATIGUE_STAGES: readonly FatigueStageDefinition[] = [
  {
    stage: 'fresh',
    name: 'Fresh Mind',
    min: 0,
    max: 20,
    color: '#79D056',
    textColor: '#FFFFFF',
    description: 'Clear mind and high focus. Keep it mindful!'
  },
  {
    stage: 'warming',
    name: 'Warming Up',
    min: 21,
    max: 50,
    color: '#FFE9B4',
    textColor: '#0A0907',
    description: 'Light dopamine buildup detected. Stay intentional.'
  },
  {
    stage: 'tired',
    name: 'Tired Brain',
    min: 51,
    max: 100,
    color: '#FFB367',
    textColor: '#0A0907',
    description: 'Attention fatigue setting in. Consider taking a break.'
  },
  {
    stage: 'drained',
    name: 'Drained',
    min: 101,
    max: 150,
    color: '#FC4A52',
    textColor: '#FFFFFF',
    description: 'Brain drain warning. Diminishing returns on focus.'
  },
  {
    stage: 'rot',
    name: 'Brain Rot Alert',
    min: 151,
    max: Infinity,
    color: '#9B51E0',
    textColor: '#FFFFFF',
    description: 'Dopamine overload! Close the feed and step outside.'
  }
] as const;

export const THEME_COLORS = {
  obsidian: '#0A0907',
  cream: '#FFE9B4',
  cardBg: '#181612',
  cardBorder: '#2E2B25',
  textMuted: '#9B968C',
  textMain: '#FFFFFF',
} as const;

export const MAX_SESSION_SEEN_ITEMS = 5000;
export const MAX_HISTORY_RETENTION_DAYS = 90;
export const DWELL_TIME_THRESHOLD_MS = 1500;

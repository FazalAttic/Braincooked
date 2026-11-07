/**
 * web/lib/constants.ts
 * Shared constants and fatigue stage thresholds for Brainroad web.
 */

export interface FatigueStageDefinition {
  stage: 'fresh' | 'warming' | 'tired' | 'drained' | 'rot';
  name: string;
  min: number;
  max: number;
  color: string;
  textColor: string;
  description: string;
}

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

export function getFatigueStage(count: number): FatigueStageDefinition {
  const safeCount = Math.max(0, Number.isFinite(count) ? Math.floor(count) : 0);
  for (const def of FATIGUE_STAGES) {
    if (safeCount <= def.max) {
      return def;
    }
  }
  return FATIGUE_STAGES[FATIGUE_STAGES.length - 1];
}


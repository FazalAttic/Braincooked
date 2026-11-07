/**
 * packages/shared/index.ts
 * Universal schemas, types, and contracts shared across
 * Extension, ElysiaJS backend, and Next.js frontend.
 */

export type PlatformType = 'instagram' | 'youtube';

export type FatigueStage = 'fresh' | 'warming' | 'tired' | 'drained' | 'rot';

export interface FatigueStageDefinition {
  stage: FatigueStage;
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

export const THEME_COLORS = {
  obsidian: '#0A0907',
  cream: '#FFE9B4',
  cardBg: '#181612',
  cardBorder: '#2E2B25',
  textMuted: '#9B968C',
  textMain: '#FCFFFA',
  youtube: '#FF6B66',
  instagram: '#E1306C'
} as const;

export const DWELL_TIME_THRESHOLD_MS = 1500;

// ----------------------------------------------------------------------------
// Cloud Ingestion & Sync Contracts
// ----------------------------------------------------------------------------

export interface VideoEvent {
  platform: PlatformType;
  videoId: string;
  dwellMs: number;
  watchedAt: number; // Unix timestamp in ms
}

export interface BatchSyncRequest {
  apiKey?: string;
  deviceId?: string;
  events: VideoEvent[];
}

export interface BatchSyncResponse {
  ok: boolean;
  syncedCount: number;
  todayCount: number;
  totalCount: number;
  fatigueStage: FatigueStage;
  error?: string;
}

export interface DashboardStats {
  today: number;
  total: number;
  todayDwellMinutes: number;
  averageDwellSeconds: number;
  dopamineIndex: number; // 0 - 100
  fatigueStage: FatigueStageDefinition;
  platforms: {
    youtube: {
      today: number;
      total: number;
      dwellMinutes: number;
    };
    instagram: {
      today: number;
      total: number;
      dwellMinutes: number;
    };
  };
  history7Days: Array<{
    date: string;
    total: number;
    youtube: number;
    instagram: number;
    dwellMinutes: number;
  }>;
  hourlyDistributionToday: number[]; // 24 numbers, index 0 to 23
  recentEvents: VideoEvent[];
}


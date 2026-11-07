/**
 * apps/backend/src/db/index.ts
 * Database connection setup using Drizzle ORM and PostgreSQL pool.
 * Includes seamless in-memory fallback store when PostgreSQL is offline.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { eq, desc, and, gte } from 'drizzle-orm';
import { getFatigueStage } from '../../../../packages/shared';

const connectionString = process.env.DATABASE_URL || 'postgresql://brainroad_user:brainroad_password@localhost:5432/brainroad?sslmode=disable';

export let isPostgresAvailable = false;
let pool: Pool | null = null;
export let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

try {
  pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 2000,
    max: 20
  });

  db = drizzle(pool, { schema });

  // Test connection non-blocking
  pool.query('SELECT 1')
    .then(() => {
      isPostgresAvailable = true;
      console.log('✅ [Drizzle] Connected to PostgreSQL database');
    })
    .catch(() => {
      isPostgresAvailable = false;
      console.log('ℹ️  [Drizzle] PostgreSQL not reachable. Operating with high-performance In-Memory Store.');
    });
} catch {
  isPostgresAvailable = false;
}

// ----------------------------------------------------------------------------
// In-Memory Fallback Store (For offline / instant dev)
// ----------------------------------------------------------------------------

interface MemoryUser {
  id: string;
  email: string;
  name: string;
  dailyBudgetMinutes: number;
}

interface MemoryEvent {
  id: string;
  userId: string;
  platform: 'youtube' | 'instagram';
  videoId: string;
  dwellMs: number;
  watchedAt: Date;
}

const memoryStore = {
  defaultUser: {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'user@brainroad.local',
    name: 'Mindful Scroller',
    dailyBudgetMinutes: 30
  } as MemoryUser,
  tokens: new Map<string, string>([['br_dev_token_secret_12345', '00000000-0000-0000-0000-000000000001']]),
  events: [] as MemoryEvent[],
  seenIds: new Set<string>()
};

// ----------------------------------------------------------------------------
// High-Level Data Service
// ----------------------------------------------------------------------------

export const dbService = {
  /**
   * Resolves or creates a default demo user.
   */
  async getOrCreateUser(apiKey?: string): Promise<{ id: string; email: string; name: string }> {
    if (isPostgresAvailable && db) {
      try {
        if (apiKey) {
          const tokenRecord = await db.query.apiTokens.findFirst({
            where: eq(schema.apiTokens.token, apiKey),
            with: { user: true }
          });
          if (tokenRecord?.user) {
            return tokenRecord.user;
          }
        }

        // Default local user
        let user = await db.query.users.findFirst({
          where: eq(schema.users.email, 'user@brainroad.local')
        });

        if (!user) {
          const inserted = await db.insert(schema.users).values({
            email: 'user@brainroad.local',
            name: 'Mindful Scroller',
            dailyBudgetMinutes: 30
          }).returning();
          user = inserted[0];
        }

        return user;
      } catch (err) {
        console.warn('[Drizzle] Error querying user from Postgres, falling back to memory:', err);
      }
    }

    // In-memory fallback
    if (apiKey && memoryStore.tokens.has(apiKey)) {
      return memoryStore.defaultUser;
    }
    return memoryStore.defaultUser;
  },

  /**
   * Ingests a batch of video events under heavy load.
   */
  async ingestBatch(userId: string, events: Array<{ platform: 'youtube' | 'instagram'; videoId: string; dwellMs: number; watchedAt: number }>) {
    if (!events || events.length === 0) return { insertedCount: 0 };

    if (isPostgresAvailable && db) {
      try {
        const records = events.map(e => ({
          userId,
          platform: e.platform,
          videoId: e.videoId,
          dwellMs: e.dwellMs || 1500,
          watchedAt: new Date(e.watchedAt || Date.now())
        }));

        // Batch insert video events
        await db.insert(schema.videoEvents)
          .values(records)
          .onConflictDoNothing();

        return { insertedCount: records.length };
      } catch (err) {
        console.warn('[Drizzle] Batch insert to Postgres failed, saving to memory store:', err);
      }
    }

    // In-memory insertion
    let count = 0;
    for (const e of events) {
      const dedupKey = `${userId}:${e.platform}:${e.videoId}:${Math.floor(e.watchedAt / 1000)}`;
      if (!memoryStore.seenIds.has(dedupKey)) {
        memoryStore.seenIds.add(dedupKey);
        memoryStore.events.push({
          id: String(memoryStore.events.length + 1),
          userId,
          platform: e.platform,
          videoId: e.videoId,
          dwellMs: e.dwellMs || 1500,
          watchedAt: new Date(e.watchedAt || Date.now())
        });
        count++;
      }
    }

    return { insertedCount: count };
  },

  /**
   * Aggregates stats for the dashboard.
   */
  async getDashboardStats(userId: string) {
    const todayStr = new Date().toISOString().split('T')[0];
    const startOfToday = new Date(`${todayStr}T00:00:00.000Z`);

    if (isPostgresAvailable && db) {
      try {
        const allUserEvents = await db.query.videoEvents.findMany({
          where: eq(schema.videoEvents.userId, userId),
          orderBy: [desc(schema.videoEvents.watchedAt)],
          limit: 1000
        });

        return computeStatsFromEvents(allUserEvents, startOfToday);
      } catch (err) {
        console.warn('[Drizzle] Error computing stats from Postgres, using memory:', err);
      }
    }

    // In-memory computation
    const userEvents = memoryStore.events
      .filter(e => e.userId === userId)
      .sort((a, b) => b.watchedAt.getTime() - a.watchedAt.getTime());

    return computeStatsFromEvents(userEvents, startOfToday);
  }
};

function computeStatsFromEvents(events: Array<{ platform: string; videoId: string; dwellMs: number; watchedAt: Date }>, startOfToday: Date) {
  let todayCount = 0;
  let ytToday = 0;
  let igToday = 0;
  let ytTotal = 0;
  let igTotal = 0;
  let todayDwellMs = 0;
  let ytDwellMs = 0;
  let igDwellMs = 0;

  const hourlyMap = new Array<number>(24).fill(0);
  const historyMap = new Map<string, { total: number; youtube: number; instagram: number; dwellMs: number }>();

  for (const ev of events) {
    const isToday = ev.watchedAt >= startOfToday;
    const dateStr = ev.watchedAt.toISOString().split('T')[0];

    // History map
    const hist = historyMap.get(dateStr) ?? { total: 0, youtube: 0, instagram: 0, dwellMs: 0 };
    hist.total++;
    hist.dwellMs += ev.dwellMs;
    if (ev.platform === 'youtube') {
      hist.youtube++;
      ytTotal++;
      if (isToday) {
        ytToday++;
        ytDwellMs += ev.dwellMs;
      }
    } else {
      hist.instagram++;
      igTotal++;
      if (isToday) {
        igToday++;
        igDwellMs += ev.dwellMs;
      }
    }
    historyMap.set(dateStr, hist);

    if (isToday) {
      todayCount++;
      todayDwellMs += ev.dwellMs;
      const hour = ev.watchedAt.getHours();
      hourlyMap[hour]++;
    }
  }

  const fatigueStage = getFatigueStage(todayCount);
  const todayDwellMinutes = Math.round((todayDwellMs / 60000) * 10) / 10;
  const averageDwellSeconds = todayCount > 0 ? Math.round((todayDwellMs / todayCount / 1000) * 10) / 10 : 0;

  // Dopamine Index formula: weighted by volume and rapid switching
  const dopamineIndex = Math.min(100, Math.round((todayCount * 0.5) + (hourlyMap[23] * 2) + (hourlyMap[0] * 3)));

  // Generate 7 days history
  const history7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    const data = historyMap.get(key) ?? { total: 0, youtube: 0, instagram: 0, dwellMs: 0 };
    history7Days.push({
      date: key,
      total: data.total,
      youtube: data.youtube,
      instagram: data.instagram,
      dwellMinutes: Math.round((data.dwellMs / 60000) * 10) / 10
    });
  }

  const recentEvents = events.slice(0, 15).map(e => ({
    platform: e.platform as 'youtube' | 'instagram',
    videoId: e.videoId,
    dwellMs: e.dwellMs,
    watchedAt: e.watchedAt.getTime()
  }));

  return {
    today: todayCount,
    total: events.length,
    todayDwellMinutes,
    averageDwellSeconds,
    dopamineIndex,
    fatigueStage,
    platforms: {
      youtube: {
        today: ytToday,
        total: ytTotal,
        dwellMinutes: Math.round((ytDwellMs / 60000) * 10) / 10
      },
      instagram: {
        today: igToday,
        total: igTotal,
        dwellMinutes: Math.round((igDwellMs / 60000) * 10) / 10
      }
    },
    history7Days,
    hourlyDistributionToday: hourlyMap,
    recentEvents
  };
}


/**
 * apps/backend/src/index.ts
 * ElysiaJS high-throughput ingestion and analytics backend powered by Bun & Drizzle ORM.
 */

import { Elysia, t } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { dbService, isPostgresAvailable } from './db';
import { getFatigueStage } from '../../../packages/shared';

const PORT = Number(process.env.PORT || 4000);

export const app = new Elysia()
  // --------------------------------------------------------------------------
  // 1. Plugins: CORS & OpenAPI / Swagger Documentation
  // --------------------------------------------------------------------------
  .use(
    cors({
      origin: true, // Allow chrome extensions (chrome-extension://*) & Next.js (http://localhost:3000)
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
    })
  )
  .use(
    swagger({
      documentation: {
        info: {
          title: 'Brainroad Ingestion API',
          version: '1.0.0',
          description: 'High-throughput event streaming and analytics backend for Brainroad mindfulness tracker.'
        }
      }
    })
  )

  // --------------------------------------------------------------------------
  // 2. Health & Status
  // --------------------------------------------------------------------------
  .get('/', () => ({
    name: 'Brainroad Heavy Loading API',
    runtime: 'Bun ' + Bun.version,
    framework: 'ElysiaJS',
    orm: 'Drizzle ORM',
    status: 'online',
    postgres: isPostgresAvailable ? 'connected' : 'in-memory fallback',
    timestamp: new Date().toISOString()
  }))

  .get('/api/health', () => ({
    ok: true,
    bun: Bun.version,
    uptimeSeconds: Math.floor(process.uptime()),
    database: isPostgresAvailable ? 'postgres' : 'memory'
  }))

  // --------------------------------------------------------------------------
  // 3. Batch Ingestion Endpoint (Heavy Loading for Extension Sync Queue)
  // --------------------------------------------------------------------------
  .post(
    '/api/sync',
    async ({ body, headers, set }) => {
      try {
        const apiKey = body.apiKey || (headers['x-api-key'] as string | undefined);
        const user = await dbService.getOrCreateUser(apiKey);

        if (!body.events || body.events.length === 0) {
          const stats = await dbService.getDashboardStats(user.id);
          return {
            ok: true,
            syncedCount: 0,
            todayCount: stats.today,
            totalCount: stats.total,
            fatigueStage: stats.fatigueStage.stage
          };
        }

        // Heavy-duty batch ingestion through Drizzle
        const { insertedCount } = await dbService.ingestBatch(user.id, body.events);
        const stats = await dbService.getDashboardStats(user.id);

        return {
          ok: true,
          syncedCount: insertedCount,
          todayCount: stats.today,
          totalCount: stats.total,
          fatigueStage: stats.fatigueStage.stage
        };
      } catch (err: any) {
        set.status = 500;
        return {
          ok: false,
          error: err?.message || 'Failed to ingest batch events'
        };
      }
    },
    {
      body: t.Object({
        apiKey: t.Optional(t.String()),
        deviceId: t.Optional(t.String()),
        events: t.Array(
          t.Object({
            platform: t.Union([t.Literal('youtube'), t.Literal('instagram')]),
            videoId: t.String(),
            dwellMs: t.Number(),
            watchedAt: t.Number()
          })
        )
      }),
      detail: {
        summary: 'Ingest a batch of Short/Reel view events from the Chrome Extension'
      }
    }
  )

  // --------------------------------------------------------------------------
  // 4. Analytics & Dashboard Statistics
  // --------------------------------------------------------------------------
  .get(
    '/api/stats',
    async ({ query }) => {
      const user = await dbService.getOrCreateUser(query?.apiKey);
      const stats = await dbService.getDashboardStats(user.id);
      return {
        ok: true,
        stats
      };
    },
    {
      query: t.Optional(
        t.Object({
          apiKey: t.Optional(t.String())
        })
      ),
      detail: {
        summary: 'Retrieve real-time analytics and charts for the Next.js dashboard'
      }
    }
  )

  // --------------------------------------------------------------------------
  // 5. Extension Pairing & Device Token Generation
  // --------------------------------------------------------------------------
  .post(
    '/api/auth/pair',
    async ({ body }) => {
      const user = await dbService.getOrCreateUser();
      const token = 'br_' + crypto.randomUUID().replace(/-/g, '');
      return {
        ok: true,
        token,
        deviceName: body?.deviceName || 'Chrome Extension',
        message: 'Pairing token generated. Paste this into the Brainroad extension settings to sync.'
      };
    },
    {
      body: t.Optional(
        t.Object({
          deviceName: t.Optional(t.String())
        })
      )
    }
  )

  // --------------------------------------------------------------------------
  // Listen on port 4000
  // --------------------------------------------------------------------------
  .listen(PORT);

console.log(`🚀 [Brainroad Backend] ElysiaJS listening on http://localhost:${PORT}`);
console.log(`📖 [Brainroad Swagger] API documentation available at http://localhost:${PORT}/swagger`);


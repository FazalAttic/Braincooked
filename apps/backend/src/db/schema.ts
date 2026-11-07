/**
 * apps/backend/src/db/schema.ts
 * Drizzle ORM schema for Brainroad PostgreSQL database.
 */

import { pgTable, uuid, varchar, integer, bigint, timestamp, date, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ----------------------------------------------------------------------------
// 1. Users Table
// ----------------------------------------------------------------------------
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 100 }).default('Mindful Scroller'),
  dailyBudgetMinutes: integer('daily_budget_minutes').default(30),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

// ----------------------------------------------------------------------------
// 2. Extension Pairing Tokens
// ----------------------------------------------------------------------------
export const apiTokens = pgTable('api_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 64 }).notNull().unique(),
  deviceName: varchar('device_name', { length: 100 }).default('Chrome Extension'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index('idx_api_tokens_token').on(table.token)
]);

// ----------------------------------------------------------------------------
// 3. Granular Time-Series Video Events (Heavy load ingestion table)
// ----------------------------------------------------------------------------
export const videoEvents = pgTable('video_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  platform: varchar('platform', { length: 20 }).notNull(), // 'youtube' | 'instagram'
  videoId: varchar('video_id', { length: 100 }).notNull(),
  dwellMs: integer('dwell_ms').notNull().default(1500),
  watchedAt: timestamp('watched_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index('idx_video_events_user_time').on(table.userId, table.watchedAt),
  index('idx_video_events_user_platform').on(table.userId, table.platform),
  uniqueIndex('idx_video_events_dedup').on(table.userId, table.platform, table.videoId, table.watchedAt)
]);

// ----------------------------------------------------------------------------
// 4. Pre-computed Daily Summaries
// ----------------------------------------------------------------------------
export const dailySummaries = pgTable('daily_summaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  totalCount: integer('total_count').notNull().default(0),
  youtubeCount: integer('youtube_count').notNull().default(0),
  instagramCount: integer('instagram_count').notNull().default(0),
  totalDwellMs: bigint('total_dwell_ms', { mode: 'number' }).notNull().default(0),
  fatigueStage: varchar('fatigue_stage', { length: 20 }).notNull().default('fresh'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index('idx_daily_summaries_user_date').on(table.userId, table.date),
  uniqueIndex('uq_user_date').on(table.userId, table.date)
]);

// ----------------------------------------------------------------------------
// Table Relations
// ----------------------------------------------------------------------------
export const usersRelations = relations(users, ({ many }) => ({
  tokens: many(apiTokens),
  events: many(videoEvents),
  summaries: many(dailySummaries)
}));

export const apiTokensRelations = relations(apiTokens, ({ one }) => ({
  user: one(users, {
    fields: [apiTokens.userId],
    references: [users.id]
  })
}));

export const videoEventsRelations = relations(videoEvents, ({ one }) => ({
  user: one(users, {
    fields: [videoEvents.userId],
    references: [users.id]
  })
}));

export const dailySummariesRelations = relations(dailySummaries, ({ one }) => ({
  user: one(users, {
    fields: [dailySummaries.userId],
    references: [users.id]
  })
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type VideoEvent = typeof videoEvents.$inferSelect;
export type NewVideoEvent = typeof videoEvents.$inferInsert;
export type DailySummary = typeof dailySummaries.$inferSelect;
export type NewDailySummary = typeof dailySummaries.$inferInsert;
export type ApiToken = typeof apiTokens.$inferSelect;
export type NewApiToken = typeof apiTokens.$inferInsert;


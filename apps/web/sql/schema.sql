-- ============================================================================
-- Brainroad PostgreSQL Database Schema
-- Digital Wellbeing, Attention Analytics, and Extension Cloud Sync
-- ============================================================================

-- Extensions for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Users & Profiles
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(100) DEFAULT 'Mindful Scroller',
    daily_budget_minutes INT DEFAULT 30,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Extension Pairing Tokens
CREATE TABLE IF NOT EXISTS api_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(64) UNIQUE NOT NULL,
    device_name VARCHAR(100) DEFAULT 'Chrome Browser Extension',
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_token ON api_tokens(token);

-- 3. Granular Time-Series Video Events (Batch-synced from Extension)
CREATE TABLE IF NOT EXISTS video_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('youtube', 'instagram')),
    video_id VARCHAR(100) NOT NULL,
    dwell_ms INT NOT NULL DEFAULT 1500,
    watched_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Compound index for fast deduplication and range queries
CREATE INDEX IF NOT EXISTS idx_video_events_user_time ON video_events(user_id, watched_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_events_user_platform ON video_events(user_id, platform);
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_events_dedup ON video_events(user_id, platform, video_id, watched_at);

-- 4. Daily Pre-computed Summaries (Fast dashboard queries)
CREATE TABLE IF NOT EXISTS daily_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    total_count INT NOT NULL DEFAULT 0,
    youtube_count INT NOT NULL DEFAULT 0,
    instagram_count INT NOT NULL DEFAULT 0,
    total_dwell_ms BIGINT NOT NULL DEFAULT 0,
    fatigue_stage VARCHAR(20) NOT NULL DEFAULT 'fresh',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_user_date UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_summaries_user_date ON daily_summaries(user_id, date DESC);


/**
 * web/lib/redis.ts
 * Redis client with automatic fallback for local/offline environments.
 */

import Redis from 'ioredis';

let redisInstance: Redis | null = null;
let isRedisAvailable = false;

export function getRedisClient(): Redis | null {
  if (redisInstance) return isRedisAvailable ? redisInstance : null;

  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  try {
    redisInstance = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      lazyConnect: true,
      retryStrategy: () => null // Don't crash if Redis is unavailable
    });

    redisInstance.connect()
      .then(() => {
        isRedisAvailable = true;
        console.log('[Brainroad Web] Connected to Redis cache');
      })
      .catch(() => {
        isRedisAvailable = false;
        // Suppress connection failure log in dev when redis not running
      });

    redisInstance.on('error', () => {
      isRedisAvailable = false;
    });

    return redisInstance;
  } catch {
    return null;
  }
}

export async function cacheGet(key: string): Promise<string | null> {
  const client = getRedisClient();
  if (!client || !isRedisAvailable) return null;
  try {
    return await client.get(key);
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds = 300): Promise<void> {
  const client = getRedisClient();
  if (!client || !isRedisAvailable) return;
  try {
    await client.set(key, value, 'EX', ttlSeconds);
  } catch {
    // Suppress cache write error
  }
}


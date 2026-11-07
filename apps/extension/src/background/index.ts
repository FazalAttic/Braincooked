/**
 * src/background/index.ts
 * Brainroad Background Service Worker Entry Point.
 * Manifest V3 compliant ephemeral worker with synchronous top-level event registrations.
 */

import { StorageEngine, STORAGE_KEY_STATS } from './storage';
import { updateBadge } from './badge';
import { SyncEngine } from './sync';
import type { MessageRequest, MessageResponse, BrainroadStats } from '../shared/types';

const storage = new StorageEngine();
export const syncEngine = new SyncEngine();
syncEngine.init().catch(() => {});

// ============================================================================
// 1. TOP-LEVEL SYNCHRONOUS EVENT REGISTRATION
// ============================================================================

/**
 * Extension Installation / Update Lifecycle
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    const stats = await storage.getStats();
    await updateBadge(stats.today);
    console.log('[Brainroad SW] Installed/Updated:', details.reason, 'Initialized today count:', stats.today);
  } catch (err) {
    console.error('[Brainroad SW] onInstalled initialization failed:', err);
  }
});

/**
 * Chromium Browser Startup
 */
if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(async () => {
    try {
      const stats = await storage.getStats();
      await updateBadge(stats.today);
    } catch (err) {
      console.error('[Brainroad SW] onStartup initialization failed:', err);
    }
  });
}

/**
 * Reactive Storage Listener: Keeps Action Badge Synchronized
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[STORAGE_KEY_STATS]) {
    const newStats = changes[STORAGE_KEY_STATS].newValue as BrainroadStats | undefined;
    if (newStats && typeof newStats.today === 'number') {
      updateBadge(newStats.today).catch((err) => {
        console.error('[Brainroad SW] Failed to sync badge from storage change:', err);
      });
    }
  }
});

/**
 * Central Message Router
 */
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  routeMessage(message as MessageRequest, sender)
    .then((response) => {
      sendResponse(response);
    })
    .catch((error: Error) => {
      console.error('[Brainroad SW] Unhandled message error:', error);
      sendResponse({
        ok: false,
        error: error?.message || 'Internal service worker error'
      } satisfies MessageResponse);
    });

  // CRITICAL: Synchronously return true to keep the IPC response port open
  return true;
});

// ============================================================================
// 2. MESSAGE ROUTER IMPLEMENTATION
// ============================================================================

async function routeMessage(
  message: MessageRequest,
  _sender: chrome.runtime.MessageSender
): Promise<MessageResponse> {
  if (!message || typeof message !== 'object') {
    return { ok: false, error: 'Malformed message: payload must be an object' };
  }

  switch (message.type) {
    case 'RECORD_VIEW': {
      const { platform, id, timestamp } = message;

      if (platform !== 'instagram' && platform !== 'youtube') {
        return { ok: false, error: `Invalid platform: '${String(platform)}'. Expected 'instagram' | 'youtube'` };
      }

      if (!id || typeof id !== 'string' || id.trim().length === 0) {
        return { ok: false, error: 'Invalid id: ID must be a non-empty string' };
      }

      const result = await storage.recordView(platform, id.trim(), timestamp);
      if (result.newlyCounted) {
        syncEngine.enqueue(platform, id.trim()).catch(() => {});
      }
      return {
        ok: true,
        stats: result.stats,
        newlyCounted: result.newlyCounted
      };
    }

    // Survey 2 Content Script Prototype Alias
    case 'REEL_DETECTED' as any: {
      const msg = message as any;
      if (!msg.id || typeof msg.id !== 'string') {
        return { ok: false, error: 'REEL_DETECTED requires shortcode id string' };
      }
      const result = await storage.recordView('instagram', msg.id.trim(), msg.timestamp);
      if (result.newlyCounted) {
        syncEngine.enqueue('instagram', msg.id.trim(), msg.timestamp).catch(() => {});
      }
      return { ok: true, stats: result.stats, newlyCounted: result.newlyCounted };
    }

    // Survey 3 Content Script Prototype Alias
    case 'SHORT_VIEWED' as any: {
      const msg = message as any;
      const videoId = msg.videoId || msg.id;
      if (!videoId || typeof videoId !== 'string') {
        return { ok: false, error: 'SHORT_VIEWED requires videoId string' };
      }
      const result = await storage.recordView('youtube', videoId.trim(), msg.timestamp);
      if (result.newlyCounted) {
        syncEngine.enqueue('youtube', videoId.trim(), msg.timestamp).catch(() => {});
      }
      return { ok: true, stats: result.stats, newlyCounted: result.newlyCounted };
    }

    case 'GET_STATS': {
      const stats = await storage.getStats();
      return { ok: true, stats };
    }

    case 'RESET_STATS': {
      const scope = message.scope === 'all' ? 'all' : 'today';
      const stats = await storage.resetStats(scope);
      // Explicitly update badge on reset
      await updateBadge(stats.today);
      return { ok: true, stats };
    }

    case 'GET_SESSION_SEEN': {
      const seenIds = await storage.getSessionSeen();
      return { ok: true, seenIds };
    }

    default:
      return {
        ok: false,
        error: `Unrecognized message type: '${(message as any)?.type}'`
      };
  }
}

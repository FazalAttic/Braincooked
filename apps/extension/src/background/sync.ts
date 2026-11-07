/**
 * src/background/sync.ts
 * Offline-First Batch Sync Client for Brainroad.
 *
 * Buffers qualified view events locally in chrome.storage.local and
 * dispatches them in compact batches to the ElysiaJS backend (http://localhost:4000/api/sync).
 * If the backend is offline, events remain securely queued with zero impact on local UI.
 */

import type { PlatformType } from '../shared/types';

export interface QueuedViewEvent {
  platform: PlatformType;
  videoId: string;
  dwellMs: number;
  watchedAt: number;
}

const SYNC_STORAGE_KEY = 'brainroad_sync_queue';
const SYNC_SETTINGS_KEY = 'brainroad_sync_settings';

export interface SyncSettings {
  enabled: boolean;
  endpoint: string;
  apiKey?: string;
  flushIntervalMs: number;
  batchThreshold: number;
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  enabled: true,
  endpoint: 'http://localhost:4000/api/sync',
  apiKey: 'br_dev_token_secret_12345',
  flushIntervalMs: 30000, // 30 seconds
  batchThreshold: 5       // Flush early if 5+ events queued
};

export class SyncEngine {
  private queue: QueuedViewEvent[] = [];
  private settings: SyncSettings = { ...DEFAULT_SYNC_SETTINGS };
  private flushTimer: number | null = null;
  private isFlushing = false;
  private chromeApi: typeof globalThis.chrome;

  constructor(chromeInstance?: typeof globalThis.chrome) {
    this.chromeApi = chromeInstance ?? (typeof chrome !== 'undefined' ? chrome : ({} as any));
  }

  /**
   * Initializes queue and settings from storage, starts periodic flush timer.
   */
  public async init(): Promise<void> {
    await this.loadQueue();
    await this.loadSettings();

    // Start background flush loop
    if (typeof setInterval !== 'undefined') {
      this.flushTimer = setInterval(() => {
        this.flush().catch(() => {});
      }, this.settings.flushIntervalMs) as unknown as number;
    }
  }

  /**
   * Enqueues a newly qualified view event.
   */
  public async enqueue(platform: PlatformType, videoId: string, dwellMs = 1500): Promise<void> {
    const event: QueuedViewEvent = {
      platform,
      videoId,
      dwellMs,
      watchedAt: Date.now()
    };

    this.queue.push(event);
    await this.saveQueue();

    // Early flush if batch threshold is reached
    if (this.queue.length >= this.settings.batchThreshold) {
      this.flush().catch(() => {});
    }
  }

  /**
   * Dispatches the queued batch to ElysiaJS backend.
   */
  public async flush(): Promise<{ flushedCount: number; success: boolean }> {
    if (!this.settings.enabled || this.isFlushing || this.queue.length === 0) {
      return { flushedCount: 0, success: true };
    }

    this.isFlushing = true;
    const batchToSend = [...this.queue];

    try {
      const response = await fetch(this.settings.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.settings.apiKey ? { 'x-api-key': this.settings.apiKey } : {})
        },
        body: JSON.stringify({
          apiKey: this.settings.apiKey,
          events: batchToSend
        })
      });

      if (response.ok) {
        // Drain sent items
        this.queue = this.queue.slice(batchToSend.length);
        await this.saveQueue();
        console.log(`[Brainroad Sync] Successfully synced ${batchToSend.length} events to ElysiaJS backend`);
        return { flushedCount: batchToSend.length, success: true };
      } else {
        console.warn(`[Brainroad Sync] Backend returned status ${response.status}. Keeping items in local queue.`);
        return { flushedCount: 0, success: false };
      }
    } catch {
      // Offline / server not running: retain in local queue gracefully
      return { flushedCount: 0, success: false };
    } finally {
      this.isFlushing = false;
    }
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public destroy(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async loadQueue(): Promise<void> {
    try {
      if (this.chromeApi?.storage?.local) {
        const stored = await this.chromeApi.storage.local.get(SYNC_STORAGE_KEY);
        if (Array.isArray(stored[SYNC_STORAGE_KEY])) {
          this.queue = stored[SYNC_STORAGE_KEY];
        }
      }
    } catch {
      // Suppress
    }
  }

  private async saveQueue(): Promise<void> {
    try {
      if (this.chromeApi?.storage?.local) {
        await this.chromeApi.storage.local.set({ [SYNC_STORAGE_KEY]: this.queue });
      }
    } catch {
      // Suppress
    }
  }

  private async loadSettings(): Promise<void> {
    try {
      if (this.chromeApi?.storage?.local) {
        const stored = await this.chromeApi.storage.local.get(SYNC_SETTINGS_KEY);
        if (stored[SYNC_SETTINGS_KEY]) {
          this.settings = { ...DEFAULT_SYNC_SETTINGS, ...stored[SYNC_SETTINGS_KEY] };
        }
      }
    } catch {
      // Suppress
    }
  }
}


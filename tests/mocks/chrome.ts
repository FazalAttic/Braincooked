/**
 * tests/mocks/chrome.ts
 * In-memory Mock Chrome Framework for Vitest unit testing.
 * Replicates chrome.storage.local, chrome.storage.session, chrome.action, and chrome.runtime.
 */

export interface StorageChange<T = any> {
  oldValue?: T;
  newValue?: T;
}

export type StorageChanges = Record<string, StorageChange>;
export type StorageAreaName = 'local' | 'session' | 'sync';
export type StorageChangeListener = (changes: StorageChanges, areaName: StorageAreaName) => void;

/**
 * In-Memory Storage Area Mock (Local or Session)
 */
export class MockStorageArea {
  private store = new Map<string, any>();
  private readonly areaName: StorageAreaName;
  private readonly changeListeners: Set<StorageChangeListener>;

  constructor(areaName: StorageAreaName, changeListeners: Set<StorageChangeListener>) {
    this.areaName = areaName;
    this.changeListeners = changeListeners;
  }

  async get(keys?: string | string[] | Record<string, any> | null): Promise<Record<string, any>> {
    await Promise.resolve(); // Microtask tick

    if (keys === null || keys === undefined) {
      const result: Record<string, any> = {};
      for (const [k, v] of this.store.entries()) {
        result[k] = JSON.parse(JSON.stringify(v));
      }
      return result;
    }

    if (typeof keys === 'string') {
      const result: Record<string, any> = {};
      if (this.store.has(keys)) {
        result[keys] = JSON.parse(JSON.stringify(this.store.get(keys)));
      }
      return result;
    }

    if (Array.isArray(keys)) {
      const result: Record<string, any> = {};
      for (const k of keys) {
        if (this.store.has(k)) {
          result[k] = JSON.parse(JSON.stringify(this.store.get(k)));
        }
      }
      return result;
    }

    if (typeof keys === 'object') {
      const result: Record<string, any> = {};
      for (const [k, defaultValue] of Object.entries(keys)) {
        if (this.store.has(k)) {
          result[k] = JSON.parse(JSON.stringify(this.store.get(k)));
        } else {
          result[k] = JSON.parse(JSON.stringify(defaultValue));
        }
      }
      return result;
    }

    return {};
  }

  async set(items: Record<string, any>): Promise<void> {
    await Promise.resolve(); // Microtask tick

    const changes: StorageChanges = {};

    for (const [key, value] of Object.entries(items)) {
      const oldValue = this.store.has(key)
        ? JSON.parse(JSON.stringify(this.store.get(key)))
        : undefined;
      const newValue = JSON.parse(JSON.stringify(value));

      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes[key] = { oldValue, newValue };
        this.store.set(key, newValue);
      }
    }

    if (Object.keys(changes).length > 0) {
      for (const listener of this.changeListeners) {
        try {
          listener(changes, this.areaName);
        } catch (err) {
          console.error('[MockStorageArea] Change listener error:', err);
        }
      }
    }
  }

  async remove(keys: string | string[]): Promise<void> {
    await Promise.resolve();

    const keyList = Array.isArray(keys) ? keys : [keys];
    const changes: StorageChanges = {};

    for (const key of keyList) {
      if (this.store.has(key)) {
        const oldValue = JSON.parse(JSON.stringify(this.store.get(key)));
        this.store.delete(key);
        changes[key] = { oldValue, newValue: undefined };
      }
    }

    if (Object.keys(changes).length > 0) {
      for (const listener of this.changeListeners) {
        try {
          listener(changes, this.areaName);
        } catch (err) {
          console.error('[MockStorageArea] Change listener error:', err);
        }
      }
    }
  }

  async clear(): Promise<void> {
    await Promise.resolve();

    const changes: StorageChanges = {};
    for (const [key, val] of this.store.entries()) {
      changes[key] = { oldValue: JSON.parse(JSON.stringify(val)), newValue: undefined };
    }

    this.store.clear();

    if (Object.keys(changes).length > 0) {
      for (const listener of this.changeListeners) {
        try {
          listener(changes, this.areaName);
        } catch (err) {
          console.error('[MockStorageArea] Change listener error:', err);
        }
      }
    }
  }

  async getBytesInUse(keys?: string | string[] | null): Promise<number> {
    await Promise.resolve();
    const data = await this.get(keys);
    return new TextEncoder().encode(JSON.stringify(data)).length;
  }

  /**
   * Test helper to inspect store directly without serialization.
   */
  _dump(): Record<string, any> {
    return Object.fromEntries(this.store);
  }

  _reset(): void {
    this.store.clear();
  }
}

/**
 * Mock Chrome Action Subsystem
 */
export class MockAction {
  private currentText = '';
  private currentBackgroundColor = '';
  private currentTextColor = '';
  private currentTitle = '';

  public setBadgeTextCalls: Array<{ text: string; tabId?: number }> = [];
  public setBadgeBackgroundColorCalls: Array<{ color: string; tabId?: number }> = [];
  public setBadgeTextColorCalls: Array<{ color: string; tabId?: number }> = [];
  public setTitleCalls: Array<{ title: string; tabId?: number }> = [];

  // Alias for backward compatibility with potential typo references
  public get setBadgeTextTextColorCalls(): Array<{ color: string; tabId?: number }> {
    return this.setBadgeTextColorCalls;
  }
  public set setBadgeTextTextColorCalls(calls: Array<{ color: string; tabId?: number }>) {
    this.setBadgeTextColorCalls = calls;
  }

  async setBadgeText(details: { text: string; tabId?: number }): Promise<void> {
    await Promise.resolve();
    this.currentText = details.text ?? '';
    this.setBadgeTextCalls.push({ ...details });
  }

  async getBadgeText(_details?: { tabId?: number }): Promise<string> {
    await Promise.resolve();
    return this.currentText;
  }

  async setBadgeBackgroundColor(details: {
    color: string | [number, number, number, number];
    tabId?: number;
  }): Promise<void> {
    await Promise.resolve();
    const colorStr = Array.isArray(details.color)
      ? `rgba(${details.color.join(',')})`
      : details.color;
    this.currentBackgroundColor = colorStr;
    this.setBadgeBackgroundColorCalls.push({ color: colorStr, tabId: details.tabId });
  }

  async getBadgeBackgroundColor(_details?: { tabId?: number }): Promise<string> {
    await Promise.resolve();
    return this.currentBackgroundColor;
  }

  async setBadgeTextColor(details: {
    color: string | [number, number, number, number];
    tabId?: number;
  }): Promise<void> {
    await Promise.resolve();
    const colorStr = Array.isArray(details.color)
      ? `rgba(${details.color.join(',')})`
      : details.color;
    this.currentTextColor = colorStr;
    this.setBadgeTextColorCalls.push({ color: colorStr, tabId: details.tabId });
  }

  async getBadgeTextColor(_details?: { tabId?: number }): Promise<string> {
    await Promise.resolve();
    return this.currentTextColor;
  }

  async setTitle(details: { title: string; tabId?: number }): Promise<void> {
    await Promise.resolve();
    this.currentTitle = details.title ?? '';
    this.setTitleCalls.push({ ...details });
  }

  async getTitle(_details?: { tabId?: number }): Promise<string> {
    await Promise.resolve();
    return this.currentTitle;
  }

  _reset(): void {
    this.currentText = '';
    this.currentBackgroundColor = '';
    this.currentTextColor = '';
    this.currentTitle = '';
    this.setBadgeTextCalls = [];
    this.setBadgeBackgroundColorCalls = [];
    this.setBadgeTextColorCalls = [];
    this.setTitleCalls = [];
  }
}

/**
 * Mock Chrome Runtime Subsystem
 */
export class MockRuntime {
  public id = 'mock-brainroad-extension-id';
  public lastError: { message: string } | undefined = undefined;

  private messageListeners = new Set<
    (message: any, sender: any, sendResponse: (res?: any) => void) => boolean | void | Promise<any>
  >();

  private installedListeners = new Set<
    (details: { reason: 'install' | 'update' | 'chrome_update'; previousVersion?: string }) => void
  >();

  public sendMessageCalls: Array<{ message: any }> = [];

  public onMessage = {
    addListener: (
      listener: (message: any, sender: any, sendResponse: (res?: any) => void) => boolean | void | Promise<any>
    ) => {
      this.messageListeners.add(listener);
    },
    removeListener: (listener: any) => {
      this.messageListeners.delete(listener);
    },
    hasListener: (listener: any) => this.messageListeners.has(listener)
  };

  public onInstalled = {
    addListener: (
      listener: (details: { reason: 'install' | 'update' | 'chrome_update'; previousVersion?: string }) => void
    ) => {
      this.installedListeners.add(listener);
    },
    removeListener: (listener: any) => {
      this.installedListeners.delete(listener);
    },
    hasListener: (listener: any) => this.installedListeners.has(listener)
  };

  getURL(path: string): string {
    return `chrome-extension://${this.id}/${path.replace(/^\//, '')}`;
  }

  async sendMessage(message: any): Promise<any> {
    await Promise.resolve();
    this.sendMessageCalls.push({ message });

    const sender = { id: this.id, url: this.getURL(''), tab: undefined };
    const promises: Promise<any>[] = [];

    for (const listener of this.messageListeners) {
      let isAsync = false;
      const resPromise = new Promise((resolve) => {
        const sendResponse = (response?: any) => {
          resolve(response);
        };

        const result = listener(message, sender, sendResponse);
        if (result === true) {
          isAsync = true;
        } else if (result && typeof (result as any).then === 'function') {
          (result as Promise<any>).then(resolve);
        } else {
          resolve(result);
        }
      });

      if (isAsync) {
        promises.push(resPromise);
      }
    }

    if (promises.length > 0) {
      return Promise.race(promises);
    }
    return undefined;
  }

  dispatchInstalled(details: { reason: 'install' | 'update' | 'chrome_update'; previousVersion?: string }): void {
    for (const listener of this.installedListeners) {
      listener(details);
    }
  }

  _reset(): void {
    this.lastError = undefined;
    this.messageListeners.clear();
    this.installedListeners.clear();
    this.sendMessageCalls = [];
  }
}

/**
 * Root Mock Chrome Facade
 */
export class MockChrome {
  private globalChangeListeners = new Set<StorageChangeListener>();

  public storage = {
    local: new MockStorageArea('local', this.globalChangeListeners),
    session: new MockStorageArea('session', this.globalChangeListeners),
    onChanged: {
      addListener: (listener: StorageChangeListener) => {
        this.globalChangeListeners.add(listener);
      },
      removeListener: (listener: StorageChangeListener) => {
        this.globalChangeListeners.delete(listener);
      },
      hasListener: (listener: StorageChangeListener) => {
        return this.globalChangeListeners.has(listener);
      }
    }
  };

  public action = new MockAction();
  public runtime = new MockRuntime();

  public resetAll(): void {
    this.storage.local._reset();
    this.storage.session._reset();
    this.globalChangeListeners.clear();
    this.action._reset();
    this.runtime._reset();
  }
}

export const mockChrome = new MockChrome();

/**
 * Installs mockChrome onto globalThis.chrome.
 */
export function installMockChrome(): MockChrome {
  (globalThis as any).chrome = mockChrome;
  return mockChrome;
}

/**
 * Resets all internal stores, listeners, and spies in mockChrome.
 */
export function resetMockChrome(): void {
  mockChrome.resetAll();
}

// tests/e2e/harness.js
// High-fidelity in-memory Chrome MV3 Extension API mock & DOM simulation harness for Brainroad E2E testing

// --- 1. Pure Domain Logic & Invariant Helpers ---

export const FATIGUE_STAGES = [
  { min: 0, max: 20, stage: 'fresh', name: 'Fresh Mind', color: '#79D056' },
  { min: 21, max: 50, stage: 'warming', name: 'Warming Up', color: '#FFE9B4' },
  { min: 51, max: 100, stage: 'tired', name: 'Tired Brain', color: '#FFB367' },
  { min: 101, max: 150, stage: 'drained', name: 'Drained', color: '#FC4A52' },
  { min: 151, max: Infinity, stage: 'rot', name: 'Brain Rot Alert', color: '#9B51E0' }
];

export function getFatigueStage(count) {
  const c = Math.max(0, Number(count) || 0);
  for (const s of FATIGUE_STAGES) {
    if (c >= s.min && c <= s.max) {
      return s;
    }
  }
  return FATIGUE_STAGES[0];
}

export function formatBadgeCount(count) {
  const c = Number(count) || 0;
  if (c <= 0) return '';
  if (c < 1000) return String(c);
  if (c < 10000) {
    const k = (Math.floor(c / 100) / 10).toFixed(1);
    return k.endsWith('.0') ? `${Math.floor(c / 1000)}k` : `${k}k`;
  }
  if (c < 1000000) return `${Math.floor(c / 1000)}k`;
  return '1M+';
}

export function getTodayDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createDefaultStats(dateStr = getTodayDateString()) {
  return {
    version: 1,
    total: 0,
    today: 0,
    lastActiveDate: dateStr,
    platforms: {
      instagram: { total: 0, today: 0 },
      youtube: { total: 0, today: 0 }
    },
    history: {},
    updatedAt: Date.now()
  };
}

// --- 2. High-Fidelity Mock Chrome APIs ---

export function createMockChromeStorage(areaName) {
  let memoryStore = {};
  const listeners = [];

  return {
    _areaName: areaName,
    _getStore: () => memoryStore,
    _setStoreDirectly: (data) => { memoryStore = JSON.parse(JSON.stringify(data)); },
    _addListener: (fn) => { listeners.push(fn); },
    _clearListeners: () => { listeners.length = 0; },

    get: async (keys) => {
      if (keys === null || keys === undefined) {
        return JSON.parse(JSON.stringify(memoryStore));
      }
      if (typeof keys === 'string') {
        const val = memoryStore[keys];
        return val !== undefined ? { [keys]: JSON.parse(JSON.stringify(val)) } : {};
      }
      if (Array.isArray(keys)) {
        const res = {};
        for (const k of keys) {
          if (memoryStore[k] !== undefined) {
            res[k] = JSON.parse(JSON.stringify(memoryStore[k]));
          }
        }
        return res;
      }
      if (typeof keys === 'object') {
        const res = { ...keys };
        for (const k of Object.keys(keys)) {
          if (memoryStore[k] !== undefined) {
            res[k] = JSON.parse(JSON.stringify(memoryStore[k]));
          }
        }
        return res;
      }
      return JSON.parse(JSON.stringify(memoryStore));
    },

    set: async (items) => {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = {
          oldValue: memoryStore[k] !== undefined ? JSON.parse(JSON.stringify(memoryStore[k])) : undefined,
          newValue: JSON.parse(JSON.stringify(v))
        };
        memoryStore[k] = JSON.parse(JSON.stringify(v));
      }
      for (const listener of listeners) {
        try {
          listener(changes, areaName);
        } catch (e) {
          console.error('Storage listener error:', e);
        }
      }
    },

    remove: async (keys) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      const changes = {};
      for (const k of keyList) {
        if (memoryStore[k] !== undefined) {
          changes[k] = { oldValue: memoryStore[k], newValue: undefined };
          delete memoryStore[k];
        }
      }
      for (const listener of listeners) {
        listener(changes, areaName);
      }
    },

    clear: async () => {
      const changes = {};
      for (const [k, v] of Object.entries(memoryStore)) {
        changes[k] = { oldValue: v, newValue: undefined };
      }
      memoryStore = {};
      for (const listener of listeners) {
        listener(changes, areaName);
      }
    },

    getBytesInUse: async (keys) => {
      const s = JSON.stringify(keys ? (memoryStore[keys] || null) : memoryStore);
      return s ? Buffer.byteLength(s, 'utf8') : 0;
    }
  };
}

export function createMockChromeAction() {
  let badgeText = '';
  let badgeBgColor = '#6366F1';
  let badgeTextColor = '#FFFFFF';

  return {
    setBadgeText: async (details) => {
      badgeText = details?.text ?? '';
    },
    getBadgeText: async () => badgeText,
    setBadgeBackgroundColor: async (details) => {
      badgeBgColor = details?.color ?? '';
    },
    getBadgeBackgroundColor: async () => badgeBgColor,
    setBadgeTextColor: async (details) => {
      badgeTextColor = details?.color ?? '';
    },
    getBadgeTextColor: async () => badgeTextColor,
    _reset: () => {
      badgeText = '';
      badgeBgColor = '#6366F1';
      badgeTextColor = '#FFFFFF';
    }
  };
}

export function createMockChromeRuntime() {
  const messageListeners = [];
  let manifest = {
    manifest_version: 3,
    name: 'Brainroad — Reel & Short Counter',
    version: '1.0.0',
    description: 'Mindfulness tracker counting reels and shorts watched on Instagram and YouTube desktop web.',
    icons: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png'
    },
    permissions: ['storage'],
    host_permissions: ['*://*.instagram.com/*', '*://*.youtube.com/*'],
    background: {
      service_worker: 'src/background/index.ts',
      type: 'module'
    },
    action: {
      default_popup: 'src/popup/index.html',
      default_title: 'Brainroad Counter'
    }
  };

  return {
    lastError: null,
    getManifest: () => JSON.parse(JSON.stringify(manifest)),
    setManifest: (newManifest) => { manifest = JSON.parse(JSON.stringify(newManifest)); },

    onMessage: {
      addListener: (fn) => { messageListeners.push(fn); },
      removeListener: (fn) => {
        const idx = messageListeners.indexOf(fn);
        if (idx !== -1) messageListeners.splice(idx, 1);
      },
      hasListeners: () => messageListeners.length > 0
    },

    sendMessage: async (message) => {
      let finalResponse = undefined;
      let replied = false;

      for (const listener of [...messageListeners]) {
        await new Promise((resolve) => {
          let asyncFlag = false;
          const sendResponse = (resp) => {
            if (!replied) {
              replied = true;
              finalResponse = resp;
            }
            resolve(resp);
          };

          try {
            const keepOpen = listener(message, { id: 'brainroad_ext' }, sendResponse);
            if (keepOpen === true) {
              asyncFlag = true;
            } else {
              resolve(undefined);
            }
          } catch (err) {
            resolve({ ok: false, error: err.message });
          }
        });
        if (replied) break;
      }

      return finalResponse !== undefined ? finalResponse : { ok: false, error: 'No response' };
    },

    _clearListeners: () => { messageListeners.length = 0; }
  };
}

export function createMockChrome() {
  const local = createMockChromeStorage('local');
  const session = createMockChromeStorage('session');
  const action = createMockChromeAction();
  const runtime = createMockChromeRuntime();

  const onChangedListeners = [];
  const broadcastStorageChange = (changes, areaName) => {
    for (const fn of onChangedListeners) {
      fn(changes, areaName);
    }
  };

  local._addListener(broadcastStorageChange);
  session._addListener(broadcastStorageChange);

  return {
    storage: {
      local,
      session,
      onChanged: {
        addListener: (fn) => onChangedListeners.push(fn),
        removeListener: (fn) => {
          const idx = onChangedListeners.indexOf(fn);
          if (idx !== -1) onChangedListeners.splice(idx, 1);
        }
      }
    },
    action,
    runtime
  };
}

// --- 3. Mock DOM & Video Playback Simulator ---

export class MockDOMElement {
  constructor(tagName, attributes = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this.children = [];
    this.parentElement = null;
    this.listeners = {};
    this.style = {};
    this.textContent = '';
  }

  setAttribute(k, v = '') {
    const oldVal = this.attributes[k];
    this.attributes[k] = String(v);
    this._notifyMutation('attributes', k, oldVal, this.attributes[k]);
  }

  getAttribute(k) {
    return this.attributes[k] !== undefined ? this.attributes[k] : null;
  }

  hasAttribute(k) {
    return this.attributes[k] !== undefined;
  }

  removeAttribute(k) {
    if (this.attributes[k] !== undefined) {
      const oldVal = this.attributes[k];
      delete this.attributes[k];
      this._notifyMutation('attributes', k, oldVal, null);
    }
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    this._notifyMutation('childList', null, null, null, [child], []);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
      this._notifyMutation('childList', null, null, null, [], [child]);
    }
    return child;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (curr._matchesSimple && curr._matchesSimple(selector)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector) {
    if (selector.includes(',')) {
      const parts = selector.split(',').map(s => s.trim());
      const res = [];
      for (const p of parts) {
        for (const el of this.querySelectorAll(p)) {
          if (!res.includes(el)) res.push(el);
        }
      }
      return res;
    }

    const parts = selector.trim().split(/\s+/);
    if (parts.length > 1) {
      let current = [this];
      for (const part of parts) {
        const next = [];
        for (const node of current) {
          next.push(...node.querySelectorAll(part));
        }
        current = next;
      }
      return current;
    }

    const results = [];
    const walk = (node) => {
      for (const c of node.children) {
        if (c._matchesSimple && c._matchesSimple(selector)) {
          results.push(c);
        }
        if (c.children && c.children.length > 0) {
          walk(c);
        }
      }
    };
    walk(this);
    return results;
  }

  _matchesSimple(selector) {
    const sel = selector.trim();
    if (sel.includes(',')) {
      return sel.split(',').some(s => this._matchesSimple(s.trim()));
    }
    // Tag check e.g. "video", "article"
    if (/^[A-Za-z0-9_-]+$/.test(sel)) {
      return this.tagName.toLowerCase() === sel.toLowerCase();
    }
    // Attribute exists check e.g. "[is-active]"
    const attrMatch = sel.match(/^\[([A-Za-z0-9_-]+)\]$/);
    if (attrMatch) {
      return this.hasAttribute(attrMatch[1]);
    }
    // Tag + attribute exists check e.g. "ytd-reel-video-renderer[is-active]"
    const tagAttrMatch = sel.match(/^([A-Za-z0-9_-]+)\[([A-Za-z0-9_-]+)\]$/);
    if (tagAttrMatch) {
      const [, tag, attr] = tagAttrMatch;
      return this.tagName.toLowerCase() === tag.toLowerCase() && this.hasAttribute(attr);
    }
    // Attribute value check e.g. a[href*="/reel/"] or [data-pressable-container="true"]
    const attrValMatch = sel.match(/^([A-Za-z0-9_-]*)\[([A-Za-z0-9_-]+)([\*\^=]+)"?([^"\]]*)"?\]$/);
    if (attrValMatch) {
      const [, tag, attr, op, val] = attrValMatch;
      if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) return false;
      const attrVal = this.getAttribute(attr);
      if (attrVal === null) return false;
      if (op === '=') return attrVal === val;
      if (op === '*=') return attrVal.includes(val);
      if (op === '^=') return attrVal.startsWith(val);
    }
    return false;
  }

  _notifyMutation(type, attributeName, oldValue, newValue, addedNodes = [], removedNodes = []) {
    MockMutationObserver._dispatchMutation({
      target: this,
      type,
      attributeName,
      oldValue,
      newValue,
      addedNodes,
      removedNodes
    });
  }

  addEventListener(event, fn, options = {}) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push({ fn, once: !!options.once });
  }

  removeEventListener(event, fn) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(l => l.fn !== fn);
  }

  dispatchEvent(event) {
    const eventType = typeof event === 'string' ? event : event.type;
    const list = this.listeners[eventType] || [];
    this.listeners[eventType] = list.filter(l => !l.once);
    for (const item of list) {
      item.fn({ type: eventType, target: this });
    }
  }
}

export class MockVideoElement extends MockDOMElement {
  constructor(src = 'blob:test/video') {
    super('video');
    this.src = src;
    this.paused = true;
    this.ended = false;
    this.readyState = 4; // HAVE_ENOUGH_DATA
    this.currentTime = 0;
    this.duration = 30;
    this.muted = true;
    this.playbackRate = 1.0;
  }

  async play() {
    this.paused = false;
    this.ended = false;
    this.dispatchEvent('play');
    this.dispatchEvent('playing');
  }

  pause() {
    this.paused = true;
    this.dispatchEvent('pause');
  }

  stall() {
    this.readyState = 1; // HAVE_METADATA only
    this.dispatchEvent('waiting');
  }

  resume() {
    this.readyState = 4;
    this.dispatchEvent('canplay');
    if (!this.paused) this.dispatchEvent('playing');
  }

  loop() {
    this.currentTime = 0;
    this.dispatchEvent('ended');
    this.dispatchEvent('play');
    this.dispatchEvent('playing');
  }
}


export class MockIntersectionObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.observed = new Set();
    MockIntersectionObserver.instances.push(this);
  }

  observe(el) {
    this.observed.add(el);
  }

  unobserve(el) {
    this.observed.delete(el);
  }

  disconnect() {
    this.observed.clear();
  }

  simulateIntersection(target, intersectionRatio, isIntersecting = intersectionRatio >= 0.6) {
    if (!this.observed.has(target)) return;
    this.callback([
      {
        target,
        intersectionRatio,
        isIntersecting,
        time: Date.now()
      }
    ], this);
  }

  static reset() {
    MockIntersectionObserver.instances.length = 0;
  }
}

export class MockMutationObserver {
  static observers = [];

  constructor(callback) {
    this.callback = callback;
    this.target = null;
    this.options = {};
    MockMutationObserver.observers.push(this);
  }

  observe(target, options = {}) {
    this.target = target;
    this.options = options;
  }

  disconnect() {
    this.target = null;
  }

  static _dispatchMutation(mutation) {
    for (const obs of MockMutationObserver.observers) {
      if (!obs.target) continue;
      // Check if mutation happened inside observed target
      let curr = mutation.target;
      let inside = false;
      while (curr) {
        if (curr === obs.target) {
          inside = true;
          break;
        }
        curr = curr.parentElement;
      }
      if (!inside && obs.target !== mutation.target) continue;

      if (mutation.type === 'attributes') {
        if (!obs.options.attributes) continue;
        if (obs.options.attributeFilter && !obs.options.attributeFilter.includes(mutation.attributeName)) {
          continue;
        }
      }
      if (mutation.type === 'childList' && !obs.options.childList) continue;

      obs.callback([mutation], obs);
    }
  }

  static reset() {
    MockMutationObserver.observers.length = 0;
  }
}

export class MockDocument extends MockDOMElement {
  constructor() {
    super('document');
    this.visibilityState = 'visible';
    this.body = new MockDOMElement('body');
    this.body.parentElement = this;
    this.children.push(this.body);
  }

  createElement(tag, attributes = {}) {
    if (tag.toLowerCase() === 'video') {
      const v = new MockVideoElement();
      for (const [k, val] of Object.entries(attributes)) v.setAttribute(k, val);
      return v;
    }
    return new MockDOMElement(tag, attributes);
  }

  setVisibility(state) {
    this.visibilityState = state;
    this.dispatchEvent({ type: 'visibilitychange' });
  }
}

export class MockWindow {
  static instances = [];

  constructor(document) {
    MockWindow.instances.push(this);
    this.document = document;
    this.location = {
      pathname: '/',
      href: 'https://www.instagram.com/',
      search: '',
      hash: ''
    };
    this.history = {
      state: null,
      pushState: (state, title, url) => {
        this.location.pathname = url.split('?')[0];
        this.location.href = `https://www.youtube.com${url}`;
      },
      replaceState: (state, title, url) => {
        this.location.pathname = url.split('?')[0];
        this.location.href = `https://www.youtube.com${url}`;
      }
    };
    this.listeners = {};
    this.sessionStorage = new Map();
    this._currentTime = 0;
    this._timers = [];
    this._nextTimerId = 1;
  }

  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  removeEventListener(event, fn) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(f => f !== fn);
  }

  dispatchEvent(event) {
    const type = typeof event === 'string' ? event : event.type;
    const list = this.listeners[type] || [];
    for (const fn of list) fn(event);
  }

  setTimeout(fn, delay = 0) {
    const id = this._nextTimerId++;
    this._timers.push({ id, fn, triggerAt: this._currentTime + delay, cancelled: false });
    return id;
  }

  clearTimeout(id) {
    const t = this._timers.find(item => item.id === id);
    if (t) t.cancelled = true;
  }

  async advanceTime(ms = 0) {
    this._currentTime += ms;
    let loopCount = 0;
    while (loopCount < 200) {
      loopCount++;
      const nextTimer = this._timers
        .filter(t => !t.cancelled && t.triggerAt <= this._currentTime)
        .sort((a, b) => a.triggerAt - b.triggerAt)[0];

      if (!nextTimer) break;
      nextTimer.cancelled = true;
      await nextTimer.fn();
    }
    this._timers = this._timers.filter(t => !t.cancelled);
  }

  static reset() {
    MockWindow.instances.length = 0;
  }
}

export async function advanceTime(ms = 1600) {
  for (const w of [...MockWindow.instances]) {
    await w.advanceTime(ms);
  }
}

// --- 4. Service Worker Controller Implementation (Opaque Reference) ---

export function createServiceWorkerController(chrome) {
  let writeMutex = Promise.resolve();

  async function getStats() {
    const data = await chrome.storage.local.get('brainroad_stats');
    if (!data.brainroad_stats) {
      const initial = createDefaultStats();
      await chrome.storage.local.set({ brainroad_stats: initial });
      return initial;
    }
    const stats = data.brainroad_stats;
    if (!stats.platforms) {
      stats.platforms = { instagram: { total: 0, today: 0 }, youtube: { total: 0, today: 0 } };
    }
    if (!stats.history) stats.history = {};
    return stats;
  }

  function checkRollover(stats, now = new Date()) {
    const today = getTodayDateString(now);
    if (stats.lastActiveDate !== today) {
      // Archive yesterday
      stats.history[stats.lastActiveDate] = {
        total: stats.today,
        instagram: stats.platforms.instagram.today,
        youtube: stats.platforms.youtube.today
      };
      // Reset today
      stats.today = 0;
      stats.platforms.instagram.today = 0;
      stats.platforms.youtube.today = 0;
      stats.lastActiveDate = today;

      // Retention pruning: keep latest 90 days
      const dates = Object.keys(stats.history).sort();
      if (dates.length > 90) {
        const excess = dates.length - 90;
        for (let i = 0; i < excess; i++) {
          delete stats.history[dates[i]];
        }
      }
    }
  }

  async function updateBadge(todayCount) {
    const text = formatBadgeCount(todayCount);
    await chrome.action.setBadgeText({ text });
    const stage = getFatigueStage(todayCount);
    await chrome.action.setBadgeBackgroundColor({ color: stage.color });
  }

  async function handleRecordView(platform, id, now = new Date()) {
    return new Promise((resolve) => {
      writeMutex = writeMutex.then(async () => {
        try {
          if (!platform || (platform !== 'instagram' && platform !== 'youtube')) {
            return resolve({ ok: false, error: 'Invalid platform' });
          }
          if (!id || typeof id !== 'string' || id.trim() === '') {
            return resolve({ ok: false, error: 'Invalid ID' });
          }

          // Check cross-tab session storage
          const sessionData = await chrome.storage.session.get('sessionSeenIds');
          const seen = sessionData.sessionSeenIds || [];
          const sessionKey = `${platform}:${id}`;

          if (seen.includes(sessionKey)) {
            const currentStats = await getStats();
            return resolve({ ok: true, stats: currentStats, newlyCounted: false });
          }

          // Mark novel
          seen.push(sessionKey);
          await chrome.storage.session.set({ sessionSeenIds: seen });

          // Atomic store increment
          const stats = await getStats();
          checkRollover(stats, now);

          stats.total += 1;
          stats.today += 1;
          stats.platforms[platform].total += 1;
          stats.platforms[platform].today += 1;
          stats.updatedAt = now.getTime();

          await chrome.storage.local.set({ brainroad_stats: stats });
          await updateBadge(stats.today);

          resolve({ ok: true, stats, newlyCounted: true });
        } catch (err) {
          resolve({ ok: false, error: err.message });
        }
      });
    });
  }

  async function handleResetStats(scope = 'today') {
    return new Promise((resolve) => {
      writeMutex = writeMutex.then(async () => {
        try {
          const stats = await getStats();
          if (scope === 'today' || scope === 'all') {
            stats.today = 0;
            stats.platforms.instagram.today = 0;
            stats.platforms.youtube.today = 0;
          }
          stats.updatedAt = Date.now();
          await chrome.storage.local.set({ brainroad_stats: stats });
          await chrome.storage.session.set({ sessionSeenIds: [] });
          await updateBadge(0);
          resolve({ ok: true, stats });
        } catch (err) {
          resolve({ ok: false, error: err.message });
        }
      });
    });
  }

  const messageHandler = (message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') {
      sendResponse({ ok: false, error: 'Malformed message' });
      return true;
    }

    if (message.type === 'RECORD_VIEW') {
      handleRecordView(message.platform, message.id, message.timestamp ? new Date(message.timestamp) : new Date())
        .then(sendResponse);
      return true;
    }

    if (message.type === 'GET_STATS') {
      getStats().then(stats => sendResponse({ ok: true, stats }));
      return true;
    }

    if (message.type === 'RESET_STATS') {
      handleResetStats(message.scope).then(sendResponse);
      return true;
    }

    if (message.type === 'GET_SESSION_SEEN') {
      chrome.storage.session.get('sessionSeenIds').then(data => {
        sendResponse({ ok: true, count: (data.sessionSeenIds || []).length, ids: data.sessionSeenIds || [] });
      });
      return true;
    }

    sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
    return true;
  };

  chrome.runtime.onMessage.addListener(messageHandler);

  return {
    getStats,
    handleRecordView,
    handleResetStats,
    updateBadge,
    checkRollover
  };
}

// --- 5. Content Script Detector Implementations (Opaque Reference) ---

export function createInstagramDetector(chrome, window, document) {
  const sessionSeen = new Set();
  const activeTimers = new Map();
  const DWELL_MS = 1500;
  const VISIBILITY_RATIO = 0.6;
  let isTracking = true;

  function extractShortcode(video) {
    // 1. Enclosing container anchor
    const container = video.closest('article, div[data-pressable-container="true"], div[role="dialog"]');
    if (container) {
      const anchor = container.querySelector('a[href*="/reel/"], a[href*="/reels/"]');
      if (anchor) {
        const href = anchor.getAttribute('href');
        const match = href.match(/\/(?:reel|reels)\/([A-Za-z0-9_-]+)/);
        if (match && match[1]) return match[1];
      }
      // Feed fallback /p/
      const pAnchor = container.querySelector('a[href*="/p/"]');
      if (pAnchor) {
        const href = pAnchor.getAttribute('href');
        const match = href.match(/\/p\/([A-Za-z0-9_-]+)/);
        if (match && match[1]) return `p_${match[1]}`;
      }
    }

    // 2. URL path match
    const urlMatch = window.location.pathname.match(/\/(?:reel|reels)\/([A-Za-z0-9_-]+)/);
    if (urlMatch && urlMatch[1]) {
      return urlMatch[1];
    }
    return null;
  }

  function cancelDwell(video) {
    if (activeTimers.has(video)) {
      window.clearTimeout(activeTimers.get(video));
      activeTimers.delete(video);
    }
  }

  function startDwell(video, shortcode) {
    if (activeTimers.has(video)) return;
    if (sessionSeen.has(shortcode)) return;
    if (document.visibilityState === 'hidden') return;
    if (video.paused || video.ended || video.readyState < 2) return;

    const timer = window.setTimeout(async () => {
      activeTimers.delete(video);
      if (!isTracking) return;
      if (document.visibilityState === 'hidden') return;
      if (video.paused || video.ended) return;

      if (!sessionSeen.has(shortcode)) {
        sessionSeen.add(shortcode);
        await chrome.runtime.sendMessage({
          type: 'RECORD_VIEW',
          platform: 'instagram',
          id: shortcode,
          timestamp: Date.now()
        });
      }
    }, DWELL_MS);

    activeTimers.set(video, timer);
  }

  function handleIntersection(video, ratio) {
    if (!isTracking) return;
    const shortcode = extractShortcode(video);
    if (!shortcode || sessionSeen.has(shortcode)) {
      cancelDwell(video);
      return;
    }

    if (ratio >= VISIBILITY_RATIO && !video.paused && !video.ended && document.visibilityState === 'visible') {
      startDwell(video, shortcode);
    } else {
      cancelDwell(video);
    }
  }

  function handlePlaybackChange(video) {
    if (!isTracking) return;
    const shortcode = extractShortcode(video);
    if (!shortcode || sessionSeen.has(shortcode)) {
      cancelDwell(video);
      return;
    }

    if (!video.paused && !video.ended && document.visibilityState === 'visible') {
      startDwell(video, shortcode);
    } else {
      cancelDwell(video);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      for (const [video] of activeTimers) {
        cancelDwell(video);
      }
    }
  });

  return {
    extractShortcode,
    handleIntersection,
    handlePlaybackChange,
    cancelDwell,
    getSessionSeen: () => new Set(sessionSeen),
    resetSession: () => {
      sessionSeen.clear();
      for (const [video] of activeTimers) cancelDwell(video);
    },
    destroy: () => {
      isTracking = false;
      for (const [video] of activeTimers) cancelDwell(video);
    }
  };
}

export function createYouTubeDetector(chrome, window, document) {
  const sessionSeen = new Set();
  let activeTimer = null;
  let activeVideo = null;
  let activeId = null;
  const DWELL_MS = 1500;
  let isTracking = true;

  function extractVideoId(renderer) {
    const urlMatch = window.location.pathname.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
    if (urlMatch && urlMatch[1]) return urlMatch[1];

    if (renderer) {
      const anchor = renderer.querySelector('a[href*="/shorts/"]');
      if (anchor) {
        const href = anchor.getAttribute('href');
        const match = href.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
        if (match && match[1]) return match[1];
      }
      const raw = renderer.getAttribute('video-id') || renderer.getAttribute('data-video-id');
      if (raw && /^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
    }
    return null;
  }

  function cancelDwell() {
    if (activeTimer) {
      window.clearTimeout(activeTimer);
      activeTimer = null;
    }
    activeVideo = null;
    activeId = null;
  }

  function evaluate() {
    if (!isTracking) return;
    if (!window.location.pathname.startsWith('/shorts/')) {
      cancelDwell();
      return;
    }

    const activeRenderer = document.querySelector('ytd-shorts ytd-reel-video-renderer[is-active]');
    if (!activeRenderer) {
      cancelDwell();
      return;
    }

    const videoId = extractVideoId(activeRenderer);
    if (!videoId || sessionSeen.has(videoId)) {
      cancelDwell();
      return;
    }

    const video = activeRenderer.querySelector('video');
    if (!video) {
      cancelDwell();
      return;
    }

    if (activeId === videoId && activeTimer) {
      return; // already qualifying
    }

    cancelDwell();
    activeId = videoId;
    activeVideo = video;

    const startTimer = () => {
      if (activeTimer || sessionSeen.has(videoId)) return;
      if (document.visibilityState === 'hidden') return;

      activeTimer = window.setTimeout(async () => {
        activeTimer = null;
        if (!isTracking) return;
        if (
          document.visibilityState === 'visible' &&
          activeRenderer.hasAttribute('is-active') &&
          !video.paused &&
          !video.ended &&
          !sessionSeen.has(videoId)
        ) {
          sessionSeen.add(videoId);
          await chrome.runtime.sendMessage({
            type: 'RECORD_VIEW',
            platform: 'youtube',
            id: videoId,
            timestamp: Date.now()
          });
        }
      }, DWELL_MS);
    };

    if (!video.paused && !video.ended && video.readyState >= 2) {
      startTimer();
    }

    video.addEventListener('playing', startTimer, { once: true });
    video.addEventListener('pause', cancelDwell);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      cancelDwell();
    } else {
      evaluate();
    }
  });

  window.addEventListener('yt-navigate-finish', evaluate);
  window.addEventListener('popstate', evaluate);

  return {
    extractVideoId,
    evaluate,
    cancelDwell,
    getSessionSeen: () => new Set(sessionSeen),
    resetSession: () => {
      sessionSeen.clear();
      cancelDwell();
    },
    destroy: () => {
      isTracking = false;
      cancelDwell();
    }
  };
}

// --- 6. Popup Controller & View Model ---

export function createPopupController(chrome) {
  let modalOpen = false;

  async function getViewModel() {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
    const stats = (response && response.ok) ? response.stats : createDefaultStats();
    const stage = getFatigueStage(stats.today);

    const totalViews = stats.platforms.instagram.today + stats.platforms.youtube.today;
    const igPercent = totalViews > 0 ? Math.round((stats.platforms.instagram.today / totalViews) * 100) : 0;
    const ytPercent = totalViews > 0 ? Math.round((stats.platforms.youtube.today / totalViews) * 100) : 0;

    return {
      today: stats.today,
      total: stats.total,
      stageNumber: FATIGUE_STAGES.findIndex(s => s.stage === stage.stage) + 1,
      stageName: stage.name,
      stageColor: stage.color,
      instagramToday: stats.platforms.instagram.today,
      youtubeToday: stats.platforms.youtube.today,
      instagramPercent: igPercent,
      youtubePercent: ytPercent,
      modalOpen
    };
  }

  function openResetModal() {
    modalOpen = true;
    return modalOpen;
  }

  function cancelResetModal() {
    modalOpen = false;
    return modalOpen;
  }

  async function confirmResetModal() {
    modalOpen = false;
    const res = await chrome.runtime.sendMessage({ type: 'RESET_STATS' });
    return res;
  }

  return {
    getViewModel,
    openResetModal,
    cancelResetModal,
    confirmResetModal
  };
}

// --- 7. Manifest V3 Validator ---

export function validateManifest(manifest) {
  const errors = [];
  if (manifest.manifest_version !== 3) {
    errors.push(`Expected manifest_version: 3, got: ${manifest.manifest_version}`);
  }
  if (!manifest.name || typeof manifest.name !== 'string') {
    errors.push('Manifest name missing or invalid');
  }
  if (!manifest.version || !/^\d+(\.\d+)*$/.test(manifest.version)) {
    errors.push(`Manifest version invalid: ${manifest.version}`);
  }
  if (!manifest.permissions || !Array.isArray(manifest.permissions) || !manifest.permissions.includes('storage')) {
    errors.push('Manifest permissions must include "storage"');
  }
  if (manifest.permissions && manifest.permissions.includes('tabs')) {
    errors.push('Manifest permissions must NOT include unnecessary "tabs" permission');
  }
  if (!manifest.host_permissions || !Array.isArray(manifest.host_permissions)) {
    errors.push('Manifest host_permissions missing or not an array');
  } else {
    const igMatch = manifest.host_permissions.some(h => h.includes('instagram.com'));
    const ytMatch = manifest.host_permissions.some(h => h.includes('youtube.com'));
    if (!igMatch || !ytMatch) {
      errors.push('host_permissions must target instagram.com and youtube.com');
    }
  }
  if (!manifest.background || !manifest.background.service_worker) {
    errors.push('Manifest background service_worker missing');
  }
  if (!manifest.action || !manifest.action.default_popup) {
    errors.push('Manifest action default_popup missing');
  }
  return {
    valid: errors.length === 0,
    errors
  };
}

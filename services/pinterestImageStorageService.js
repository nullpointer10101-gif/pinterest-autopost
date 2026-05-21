'use strict';

const fs = require('fs');
const path = require('path');
const persistencePolicy = require('./persistencePolicy');

const { UPSTASH_URL, UPSTASH_TOKEN, USE_UPSTASH } = persistencePolicy;

const APP_STATE_KEY = process.env.APP_PINTEREST_IMAGE_STATE_KEY || 'pinterest_image_state_v1';
const LOCAL_STATE_FILE = persistencePolicy.getStateFilePath('pinterest-image-state.json');
const REPO_DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_TTL_MS = Math.max(5000, Number.parseInt(process.env.PINTEREST_IMAGE_STATE_CACHE_TTL_MS || '15000', 10));

const DEFAULT_STATE = {
  channels: [],
  queue: [],
  pins: {},
  posted: {},
  logs: [],
  publisher: {},
};

let memoryCache = null;
let memoryCacheTime = 0;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeState(state = {}) {
  return {
    channels: Array.isArray(state.channels) ? state.channels : [],
    queue: Array.isArray(state.queue) ? state.queue : [],
    pins: isPlainObject(state.pins) ? state.pins : {},
    posted: isPlainObject(state.posted) ? state.posted : {},
    logs: Array.isArray(state.logs) ? state.logs : [],
    publisher: isPlainObject(state.publisher) ? state.publisher : {},
  };
}

function readRepoJson(filename, fallback) {
  try {
    const filePath = path.join(REPO_DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function readLocalStateSync() {
  try {
    if (!persistencePolicy.isLocalStateEnabled()) return null;
    if (!fs.existsSync(LOCAL_STATE_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(LOCAL_STATE_FILE, 'utf8'));
    return isPlainObject(parsed) ? normalizeState(parsed) : null;
  } catch {
    return null;
  }
}

function writeLocalStateSync(state) {
  try {
    if (!persistencePolicy.isLocalStateEnabled()) return;
    persistencePolicy.ensureParentDir(LOCAL_STATE_FILE);
    fs.writeFileSync(LOCAL_STATE_FILE, JSON.stringify(normalizeState(state), null, 2), 'utf8');
  } catch (err) {
    console.warn('[Pinterest Image Storage] Local backup write failed:', err.message);
  }
}

function seedFromRepoFiles() {
  const imageChannels = readRepoJson('pinterest-image-accounts.json', null);
  const legacyChannels = readRepoJson('pinterest-accounts.json', []);
  const queue = readRepoJson('pinterest-image-queue.json', []);
  const legacyQueue = readRepoJson('pinterest_queue.json', []);
  const pins = readRepoJson('pinterest-image-pins.json', {});
  const legacyPins = readRepoJson('pinterest_pins.json', {});
  const posted = readRepoJson('pinterest-image-posted.json', {});
  const legacyPosted = readRepoJson('pinterest_reposted.json', {});
  const logs = readRepoJson('pinterest-image-logs.json', []);

  return normalizeState({
    channels: Array.isArray(imageChannels) ? imageChannels : legacyChannels,
    queue: Array.isArray(queue) && queue.length > 0 ? queue : legacyQueue,
    pins: Object.keys(pins || {}).length > 0 ? pins : legacyPins,
    posted: Object.keys(posted || {}).length > 0 ? posted : legacyPosted,
    logs,
  });
}

async function runUpstashCommand(command) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(UPSTASH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Upstash HTTP ${res.status}${data?.error ? `: ${data.error}` : ''}`);
    if (data?.error) throw new Error(`Upstash error: ${data.error}`);
    return data?.result ?? null;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Upstash request timed out');
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function loadState() {
  const now = Date.now();
  if (memoryCache && now - memoryCacheTime < CACHE_TTL_MS) {
    return clone(memoryCache);
  }

  if (USE_UPSTASH) {
    try {
      const raw = await runUpstashCommand(['GET', APP_STATE_KEY]);
      if (raw !== null && typeof raw !== 'undefined') {
        let parsed = raw;
        if (typeof raw === 'string') {
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = null;
          }
        }
        if (isPlainObject(parsed)) {
          const state = normalizeState(parsed);
          memoryCache = state;
          memoryCacheTime = Date.now();
          writeLocalStateSync(state);
          return clone(state);
        }
      }

      const local = readLocalStateSync();
      const seeded = local || seedFromRepoFiles();
      await runUpstashCommand(['SET', APP_STATE_KEY, JSON.stringify(seeded)]).catch((err) => {
        console.warn('[Pinterest Image Storage] Upstash seed write failed:', err.message);
      });
      memoryCache = seeded;
      memoryCacheTime = Date.now();
      return clone(seeded);
    } catch (err) {
      if (!persistencePolicy.isLocalStateEnabled()) {
        throw new Error(`[Pinterest Image Storage] Upstash read failed: ${err.message}`);
      }
      console.warn('[Pinterest Image Storage] Upstash read failed, falling back locally:', err.message);
    }
  }

  const local = readLocalStateSync();
  const state = local || seedFromRepoFiles() || clone(DEFAULT_STATE);
  writeLocalStateSync(state);
  memoryCache = state;
  memoryCacheTime = Date.now();
  return clone(state);
}

async function saveState(nextState) {
  const state = normalizeState(nextState);
  memoryCache = clone(state);
  memoryCacheTime = Date.now();

  if (USE_UPSTASH) {
    try {
      await runUpstashCommand(['SET', APP_STATE_KEY, JSON.stringify(state)]);
      writeLocalStateSync(state);
      return state;
    } catch (err) {
      if (!persistencePolicy.isLocalStateEnabled()) {
        throw new Error(`[Pinterest Image Storage] Upstash write failed: ${err.message}`);
      }
      console.warn('[Pinterest Image Storage] Upstash write failed, saving locally:', err.message);
    }
  }

  writeLocalStateSync(state);
  return state;
}

function getStorageInfo() {
  return {
    mode: persistencePolicy.getStorageMode(),
    appStateKey: APP_STATE_KEY,
    localStateFile: LOCAL_STATE_FILE,
    localStateEnabled: persistencePolicy.isLocalStateEnabled(),
    externalStateOnly: persistencePolicy.isExternalStateOnly(),
  };
}

module.exports = {
  loadState,
  saveState,
  getStorageInfo,
};

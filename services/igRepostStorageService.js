const fs = require('fs');
const persistencePolicy = require('./persistencePolicy');

const { IS_SERVERLESS, UPSTASH_URL, UPSTASH_TOKEN, USE_UPSTASH } = persistencePolicy;
const LOCAL_STATE_FILE = persistencePolicy.getStateFilePath('ig-repost-state.json');
const APP_STATE_KEY = process.env.APP_IG_REPOST_STATE_KEY || 'ig_repost_pipeline_state_v1';

if (persistencePolicy.isLocalStateEnabled()) {
  persistencePolicy.ensureParentDir(LOCAL_STATE_FILE);
}

async function runUpstashCommand(command) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

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

    const data = await res.json();
    if (data?.error) throw new Error(`Upstash error: ${data.error}`);
    return data?.result ?? null;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Upstash request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function readLocalStateSync() {
  try {
    if (!persistencePolicy.isLocalStateEnabled()) return null;
    if (!fs.existsSync(LOCAL_STATE_FILE)) return null;
    const raw = fs.readFileSync(LOCAL_STATE_FILE, 'utf8').trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocalStateSync(state) {
  try {
    if (!persistencePolicy.isLocalStateEnabled()) return;
    if (!state || typeof state !== 'object' || Array.isArray(state)) return;
    fs.writeFileSync(LOCAL_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.warn('[IG-Repost Storage] Local backup write failed:', err.message);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isValidState(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

let memoryCache = null;
let memoryCacheTime = 0;

async function loadState(defaultState = {}) {
  const now = Date.now();
  if (memoryCache && (now - memoryCacheTime < 10000)) {
    return clone(memoryCache);
  }

  if (USE_UPSTASH) {
    try {
      const raw = await runUpstashCommand(['GET', APP_STATE_KEY]);
      if (raw === null) {
        const local = readLocalStateSync();
        const result = isValidState(local) ? local : clone(defaultState);
        if (persistencePolicy.isLocalStateEnabled() && isValidState(local)) {
          await runUpstashCommand(['SET', APP_STATE_KEY, JSON.stringify(local)]).catch(() => {});
        }
        memoryCache = result;
        memoryCacheTime = Date.now();
        return clone(result);
      }

      let parsed = raw;
      if (typeof raw === 'string') {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }
      }

      if (isValidState(parsed)) {
        writeLocalStateSync(parsed);
        memoryCache = parsed;
        memoryCacheTime = Date.now();
        return clone(parsed);
      }

      const local = readLocalStateSync();
      const healed = isValidState(local) ? local : clone(defaultState);
      if (persistencePolicy.isLocalStateEnabled() && isValidState(local)) {
        await runUpstashCommand(['SET', APP_STATE_KEY, JSON.stringify(local)]).catch(() => {});
      }
      memoryCache = healed;
      memoryCacheTime = Date.now();
      return clone(healed);
    } catch (err) {
      if (!persistencePolicy.isLocalStateEnabled()) {
        throw new Error(`[IG-Repost Storage] Upstash read failed in external-only mode: ${err.message}`);
      }
      console.warn('[IG-Repost Storage] Upstash read failed:', err.message);
    }
  }

  const local = readLocalStateSync();
  const result = isValidState(local) ? local : clone(defaultState);
  if (!local) writeLocalStateSync(result);
  memoryCache = result;
  memoryCacheTime = Date.now();
  return clone(result);
}

async function saveState(state) {
  if (!isValidState(state)) return;

  memoryCache = clone(state);
  memoryCacheTime = Date.now();

  if (USE_UPSTASH) {
    try {
      await runUpstashCommand(['SET', APP_STATE_KEY, JSON.stringify(state)]);
      writeLocalStateSync(state);
      return;
    } catch (err) {
      if (!persistencePolicy.isLocalStateEnabled()) {
        throw new Error(`[IG-Repost Storage] Upstash write failed in external-only mode: ${err.message}`);
      }
      console.warn('[IG-Repost Storage] Upstash write failed:', err.message);
    }
  }

  writeLocalStateSync(state);
}

async function getJsonKey(key) {
  const cleanKey = String(key || '').trim();
  if (!cleanKey || !USE_UPSTASH) return null;

  try {
    const raw = await runUpstashCommand(['GET', cleanKey]);
    if (raw === null || typeof raw === 'undefined') return null;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return clone(raw);
  } catch (err) {
    console.warn('[IG-Repost Storage] getJsonKey failed:', err.message);
    return null;
  }
}

async function setJsonKey(key, value, ttlSeconds = 86400) {
  const cleanKey = String(key || '').trim();
  if (!cleanKey || !USE_UPSTASH) return false;

  try {
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    const ttl = Number.parseInt(ttlSeconds, 10);
    const command = Number.isFinite(ttl) && ttl > 0
      ? ['SET', cleanKey, payload, 'EX', ttl]
      : ['SET', cleanKey, payload];
    await runUpstashCommand(command);
    return true;
  } catch (err) {
    console.warn('[IG-Repost Storage] setJsonKey failed:', err.message);
    return false;
  }
}

function getStorageInfo() {
  return {
    mode: persistencePolicy.getStorageMode(),
    localStateFile: LOCAL_STATE_FILE,
    appStateKey: APP_STATE_KEY,
    isServerless: IS_SERVERLESS,
    localStateEnabled: persistencePolicy.isLocalStateEnabled(),
    externalStateOnly: persistencePolicy.isExternalStateOnly(),
  };
}

module.exports = {
  loadState,
  saveState,
  getJsonKey,
  setJsonKey,
  getStorageInfo,
};

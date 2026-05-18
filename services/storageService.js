/**
 * storageService.js — Persistent State Storage
 * ─────────────────────────────────────────────────────────────────────────────
 * Strategy:
 *   PRIMARY  : Upstash Redis (when UPSTASH_REDIS_REST_URL + TOKEN configured)
 *   LOCAL    : Optional JSON fallback only when external-only mode is disabled
 *
 * Rules:
 *   SAVE  → write to Upstash first
 *           if local fallback is enabled, also write local backup
 *           if external-only mode is active, never write to disk
 *   LOAD  → read Upstash; validate it is a real JSON object (not a string/null)
 *           if local fallback is enabled, local backup can heal Upstash
 *           if external-only mode is active, never read state from disk
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const fs = require('fs');
const persistencePolicy = require('./persistencePolicy');

const { IS_SERVERLESS, UPSTASH_URL, UPSTASH_TOKEN, USE_UPSTASH } = persistencePolicy;

const LOCAL_STATE_FILE = persistencePolicy.getStateFilePath('state.json');
const APP_STATE_KEY    = process.env.APP_STATE_KEY || 'pinterest_autopost_state_v1';

if (persistencePolicy.isLocalStateEnabled()) {
  try { persistencePolicy.ensureParentDir(LOCAL_STATE_FILE); } catch {}
}

// ── Upstash REST helper ───────────────────────────────────────────────────────

async function runUpstashCommand(command) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(UPSTASH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    const data = await res.json();
    if (data?.error) throw new Error(`Upstash error: ${data.error}`);
    return data?.result ?? null;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Upstash request timed out');
    throw err;
  }
}

// ── Local file helpers ────────────────────────────────────────────────────────

function readLocalStateSync() {
  try {
    if (!persistencePolicy.isLocalStateEnabled()) return null;
    if (!fs.existsSync(LOCAL_STATE_FILE)) return null;
    const raw = fs.readFileSync(LOCAL_STATE_FILE, 'utf8').trim();
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

function writeLocalStateSync(state) {
  try {
    if (!persistencePolicy.isLocalStateEnabled()) return;
    if (!state || typeof state !== 'object') return;
    fs.writeFileSync(LOCAL_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Storage] Local backup write failed:', e.message);
  }
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Returns true only if `val` is a plain object (not a string, array, or null).
 * Protects against corrupt Upstash values like the key-name-as-string bug.
 */
function isValidState(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

// ── Public API ────────────────────────────────────────────────────────────────

let _memoryCache = null;
let _memoryCacheTime = 0;

/**
 * loadState(defaultState)
 * Loads state from Upstash (preferred) or local file backup.
 * Automatically heals a corrupt Upstash key if local has good data.
 */
async function loadState(defaultState = {}) {
  const now = Date.now();
  if (_memoryCache && (now - _memoryCacheTime < 15000)) {
    // Prevent double Upstash timeout penalties within the same Vercel request
    return JSON.parse(JSON.stringify(_memoryCache));
  }

  if (USE_UPSTASH) {
    try {
      const raw = await runUpstashCommand(['GET', APP_STATE_KEY]);

      // raw is null → key doesn't exist yet
      if (raw === null) {
        let result = JSON.parse(JSON.stringify(defaultState));
        const local = readLocalStateSync();
        if (persistencePolicy.isLocalStateEnabled() && isValidState(local)) {
          console.log('[Storage] Upstash key missing — restoring from local backup.');
          await runUpstashCommand(['SET', APP_STATE_KEY, JSON.stringify(local)]).catch(() => {});
          result = local;
        }
        _memoryCache = result;
        _memoryCacheTime = Date.now();
        return result;
      }

      // raw might be a string (already a JS string from Upstash REST) or JSON
      let parsed;
      if (typeof raw === 'string') {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }
      } else {
        parsed = raw; // Upstash may auto-parse
      }

      let finalResult;
      if (isValidState(parsed)) {
        // Good Upstash data — refresh local backup only when explicitly allowed
        writeLocalStateSync(parsed);
        finalResult = parsed;
      } else {
        console.warn('[Storage] Upstash returned invalid state (got:', typeof parsed, ').');
        const local = readLocalStateSync();
        if (persistencePolicy.isLocalStateEnabled() && isValidState(local)) {
          console.log('[Storage] Healing Upstash with local backup data...');
          await runUpstashCommand(['SET', APP_STATE_KEY, JSON.stringify(local)]).catch(() => {});
          finalResult = local;
        } else {
          console.warn('[Storage] No valid local backup available. Starting fresh.');
          finalResult = JSON.parse(JSON.stringify(defaultState));
        }
      }

      _memoryCache = finalResult;
      _memoryCacheTime = Date.now();
      return finalResult;

    } catch (err) {
      if (!persistencePolicy.isLocalStateEnabled()) {
        throw new Error(`[Storage] Upstash read failed in external-only mode: ${err.message}`);
      }
      console.warn('[Storage] Upstash read failed:', err.message, '— falling back to local file.');
    }
  }

  // Upstash not configured or failed — use local file
  const local = readLocalStateSync();
  let finalLocal;
  if (!local) {
    finalLocal = JSON.parse(JSON.stringify(defaultState));
    writeLocalStateSync(finalLocal);
  } else {
    finalLocal = local;
  }
  
  _memoryCache = finalLocal;
  _memoryCacheTime = Date.now();
  return finalLocal;
}

/**
 * saveState(state)
 * Saves state to Upstash first; on success also writes local backup.
 * If Upstash fails, writes local only (data preserved).
 */
async function saveState(state) {
  if (!isValidState(state)) {
    console.warn('[Storage] saveState called with non-object state — ignoring to prevent data loss.');
    return;
  }

  if (USE_UPSTASH) {
    try {
      await runUpstashCommand(['SET', APP_STATE_KEY, JSON.stringify(state)]);
      writeLocalStateSync(state);
      return;
    } catch (err) {
      if (!persistencePolicy.isLocalStateEnabled()) {
        throw new Error(`[Storage] Upstash write failed in external-only mode: ${err.message}`);
      }
      console.warn('[Storage] Upstash write failed:', err.message, '— saving to local file only.');
    }
  }

  writeLocalStateSync(state);
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

// Legacy compat — some callers pass (key, defaultState) instead of (defaultState)
// We detect and handle both signatures
const _loadState = loadState;
module.exports.loadState = async function (arg1, arg2) {
  if (typeof arg1 === 'object' || arg1 === undefined) return _loadState(arg1);
  // Called as loadState(keyString, defaultState) — ignore keyString, use our configured key
  return _loadState(arg2);
};

const _saveState = saveState;
module.exports.saveState = async function (arg1, arg2) {
  if (typeof arg1 === 'object') return _saveState(arg1);
  // Called as saveState(keyString, state) — ignore keyString
  return _saveState(arg2);
};

module.exports.getStorageInfo = getStorageInfo;
module.exports.getStorageMode = () => getStorageInfo().mode;

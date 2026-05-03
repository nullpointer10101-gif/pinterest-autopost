/**
 * storageService.js — Persistent State Storage
 * ─────────────────────────────────────────────────────────────────────────────
 * Strategy:
 *   PRIMARY  : Upstash Redis (when UPSTASH_REDIS_REST_URL + TOKEN configured)
 *   BACKUP   : Local JSON file (always kept in sync as a fallback copy)
 *
 * Rules:
 *   SAVE  → write to Upstash first; if OK, also write local backup
 *           if Upstash fails, write local only (so data is never lost)
 *   LOAD  → read Upstash; validate it is a real JSON object (not a string/null)
 *           if invalid or Upstash unreachable, read local backup
 *           if local backup has good data, heal Upstash by writing it back
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const axios = require('axios');

const IS_SERVERLESS = !!(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.NETLIFY
);

const dataDir = IS_SERVERLESS
  ? path.join(os.tmpdir(), 'pinterest-autoposter')
  : path.join(__dirname, '..', 'data');

const LOCAL_STATE_FILE = path.join(dataDir, 'state.json');
const APP_STATE_KEY    = process.env.APP_STATE_KEY || 'pinterest_autopost_state_v1';

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL   || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const USE_UPSTASH   = !!(UPSTASH_URL && UPSTASH_TOKEN);

// Ensure data dir exists (no-op on serverless /tmp)
if (!IS_SERVERLESS) {
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
} else {
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
}

// ── Upstash REST helper ───────────────────────────────────────────────────────

async function runUpstashCommand(command) {
  const res = await axios.post(UPSTASH_URL, command, {
    timeout: 15_000,
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  if (res.data?.error) throw new Error(`Upstash error: ${res.data.error}`);
  return res.data?.result ?? null;
}

// ── Local file helpers ────────────────────────────────────────────────────────

function readLocalStateSync() {
  try {
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

/**
 * loadState(defaultState)
 * Loads state from Upstash (preferred) or local file backup.
 * Automatically heals a corrupt Upstash key if local has good data.
 */
async function loadState(defaultState = {}) {
  if (USE_UPSTASH) {
    try {
      const raw = await runUpstashCommand(['GET', APP_STATE_KEY]);

      // raw is null → key doesn't exist yet
      if (raw === null) {
        // Try local backup first, then default
        const local = readLocalStateSync();
        if (isValidState(local)) {
          console.log('[Storage] Upstash key missing — restoring from local backup.');
          await runUpstashCommand(['SET', APP_STATE_KEY, JSON.stringify(local)]).catch(() => {});
          return local;
        }
        return JSON.parse(JSON.stringify(defaultState));
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

      if (isValidState(parsed)) {
        // Good Upstash data — also refresh local backup
        writeLocalStateSync(parsed);
        return parsed;
      }

      // Upstash has corrupt/invalid data — try local backup to heal it
      console.warn('[Storage] Upstash returned invalid state (got:', typeof parsed, ') — checking local backup...');
      const local = readLocalStateSync();
      if (isValidState(local)) {
        console.log('[Storage] Healing Upstash with local backup data...');
        await runUpstashCommand(['SET', APP_STATE_KEY, JSON.stringify(local)]).catch(() => {});
        return local;
      }

      // Both corrupt — return default
      console.warn('[Storage] Both Upstash and local backup are invalid. Starting fresh.');
      return JSON.parse(JSON.stringify(defaultState));

    } catch (err) {
      console.warn('[Storage] Upstash read failed:', err.message, '— falling back to local file.');
    }
  }

  // Upstash not configured or failed — use local file
  const local = readLocalStateSync();
  if (!local) {
    const fresh = JSON.parse(JSON.stringify(defaultState));
    writeLocalStateSync(fresh);
    return fresh;
  }
  return local;
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
      // Write-through: keep local backup in sync
      writeLocalStateSync(state);
      return;
    } catch (err) {
      console.warn('[Storage] Upstash write failed:', err.message, '— saving to local file only.');
    }
  }

  writeLocalStateSync(state);
}

function getStorageInfo() {
  return {
    mode: USE_UPSTASH ? 'upstash' : (IS_SERVERLESS ? 'local-ephemeral' : 'local-file'),
    localStateFile: LOCAL_STATE_FILE,
    appStateKey: APP_STATE_KEY,
    isServerless: IS_SERVERLESS,
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

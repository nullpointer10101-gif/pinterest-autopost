const fs = require('fs');
const axios = require('axios');
const persistencePolicy = require('./persistencePolicy');

const { IS_SERVERLESS, UPSTASH_URL, UPSTASH_TOKEN, USE_UPSTASH } = persistencePolicy;
const LOCAL_STATE_FILE = persistencePolicy.getStateFilePath('x-state.json');
const APP_STATE_KEY = process.env.APP_X_STATE_KEY || 'x_autopost_state_v1';

if (persistencePolicy.isLocalStateEnabled()) {
  persistencePolicy.ensureParentDir(LOCAL_STATE_FILE);
}

async function runUpstashCommand(command) {
  try {
    const res = await axios.post(UPSTASH_URL, command, {
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
    if (res.data?.error) {
      throw new Error(`Upstash error: ${res.data.error}`);
    }
    return res.data?.result ?? null;
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      console.warn('[X-Storage] Upstash timeout, checking connection...');
    }
    throw err;
  }
}

async function readLocalState() {
  try {
    if (!persistencePolicy.isLocalStateEnabled()) return null;
    if (!fs.existsSync(LOCAL_STATE_FILE)) {
      return null;
    }
    const raw = await fs.promises.readFile(LOCAL_STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeLocalState(state) {
  if (!persistencePolicy.isLocalStateEnabled()) return;
  await fs.promises.writeFile(LOCAL_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

async function loadState(defaultState) {
  if (USE_UPSTASH) {
    try {
      const raw = await runUpstashCommand(['GET', APP_STATE_KEY]);
      if (!raw) return JSON.parse(JSON.stringify(defaultState));
      return JSON.parse(raw);
    } catch (err) {
      if (!persistencePolicy.isLocalStateEnabled()) {
        throw new Error(`[X-Storage] Upstash read failed in external-only mode: ${err.message}`);
      }
      console.warn('[X-Storage] Upstash read failed, falling back to local file:', err.message);
    }
  }

  const local = await readLocalState();
  if (!local) {
    const state = JSON.parse(JSON.stringify(defaultState));
    await writeLocalState(state);
    return state;
  }
  return local;
}

async function saveState(state) {
  if (USE_UPSTASH) {
    try {
      await runUpstashCommand(['SET', APP_STATE_KEY, JSON.stringify(state)]);
      return;
    } catch (err) {
      if (!persistencePolicy.isLocalStateEnabled()) {
        throw new Error(`[X-Storage] Upstash write failed in external-only mode: ${err.message}`);
      }
      console.warn('[X-Storage] Upstash write failed, falling back to local file:', err.message);
    }
  }
  await writeLocalState(state);
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
  getStorageInfo,
};

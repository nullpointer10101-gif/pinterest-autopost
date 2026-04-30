const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');

const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
const dataDir = IS_SERVERLESS
  ? path.join(os.tmpdir(), 'pinterest-autoposter')
  : path.join(__dirname, '..', 'data');
const LOCAL_STATE_FILE = path.join(dataDir, 'ig-tracker-state.json');
const APP_STATE_KEY = process.env.APP_IG_TRACKER_STATE_KEY || 'ig_tracker_state_v1';

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const USE_UPSTASH = !!(UPSTASH_URL && UPSTASH_TOKEN);

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
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
      console.warn('[IG-Storage] Upstash timeout...');
    }
    throw err;
  }
}

async function readLocalState() {
  try {
    if (!fs.existsSync(LOCAL_STATE_FILE)) return null;
    const raw = await fs.promises.readFile(LOCAL_STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeLocalState(state) {
  await fs.promises.writeFile(LOCAL_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

async function loadState(defaultState) {
  if (USE_UPSTASH) {
    try {
      const raw = await runUpstashCommand(['GET', APP_STATE_KEY]);
      if (!raw) return JSON.parse(JSON.stringify(defaultState));
      return JSON.parse(raw);
    } catch (err) {
      console.warn('[IG-Storage] Upstash read failed, falling back to local file:', err.message);
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
      console.warn('[IG-Storage] Upstash write failed, falling back to local file:', err.message);
    }
  }
  await writeLocalState(state);
}

function getStorageInfo() {
  return {
    mode: USE_UPSTASH ? 'upstash' : (IS_SERVERLESS ? 'local-ephemeral' : 'local-file'),
    localStateFile: LOCAL_STATE_FILE,
    appStateKey: APP_STATE_KEY,
    isServerless: IS_SERVERLESS,
  };
}

module.exports = { loadState, saveState, getStorageInfo };

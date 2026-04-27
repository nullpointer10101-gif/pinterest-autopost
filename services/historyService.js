const { v4: uuidv4 } = require('uuid');
const storageService = require('./storageService');

const DEFAULT_STATE = {
  posts: [],
  engagements: [],
  queue: [],
  pkce: {},
  tokens: {},
  session: {
    cookie: '',
    updatedAt: null,
    label: '',
  },
  automation: {
    dateKey: '',
    postsToday: 0,
    lastRunAt: null,
  },
};

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

async function readState() {
  const state = await storageService.loadState(cloneDefault());
  return {
    ...cloneDefault(),
    ...state,
    posts: Array.isArray(state?.posts) ? state.posts : [],
    engagements: Array.isArray(state?.engagements) ? state.engagements : [],
    queue: Array.isArray(state?.queue) ? state.queue : [],
    pkce: state?.pkce || {},
    tokens: state?.tokens || {},
    session: {
      ...DEFAULT_STATE.session,
      ...(state?.session || {}),
    },
    automation: {
      ...DEFAULT_STATE.automation,
      ...(state?.automation || {}),
    },
  };
}

async function writeState(state) {
  await storageService.saveState(state);
}

async function add(entry) {
  const state = await readState();
  const record = {
    id: uuidv4(),
    ...entry,
    createdAt: new Date().toISOString(),
  };
  state.posts.unshift(record);
  await writeState(state);
  return record;
}

async function getAll() {
  const state = await readState();
  return state.posts;
}

async function getById(id) {
  const state = await readState();
  return state.posts.find(post => post.id === id) || null;
}

async function remove(id) {
  const state = await readState();
  state.posts = state.posts.filter(post => post.id !== id);
  await writeState(state);
}

async function updateById(id, patch) {
  const state = await readState();
  const idx = state.posts.findIndex(post => post.id === id);
  if (idx === -1) return null;

  const current = state.posts[idx];
  const next = {
    ...current,
    ...patch,
    reelData: {
      ...(current.reelData || {}),
      ...(patch?.reelData || {}),
    },
  };

  state.posts[idx] = next;
  await writeState(state);
  return next;
}

async function updateLatest(data) {
  const state = await readState();
  if (!state.posts.length) return;
  state.posts[0] = { ...state.posts[0], ...data };
  await writeState(state);
}

async function clear() {
  const state = await readState();
  state.posts = [];
  await writeState(state);
}

async function savePkce(stateKey, codeVerifier) {
  const state = await readState();
  state.pkce[stateKey] = { codeVerifier, createdAt: Date.now() };

  const cutoff = Date.now() - (10 * 60 * 1000);
  for (const key of Object.keys(state.pkce)) {
    if (state.pkce[key]?.createdAt < cutoff) delete state.pkce[key];
  }
  await writeState(state);
}

async function getPkce(stateKey) {
  const state = await readState();
  const entry = state.pkce?.[stateKey];
  if (!entry) return null;
  if (Date.now() - entry.createdAt > 10 * 60 * 1000) {
    delete state.pkce[stateKey];
    await writeState(state);
    return null;
  }
  return entry.codeVerifier;
}

async function deletePkce(stateKey) {
  const state = await readState();
  delete state.pkce[stateKey];
  await writeState(state);
}

async function saveTokens(tokens) {
  const state = await readState();
  state.tokens = { ...tokens, updatedAt: new Date().toISOString() };
  await writeState(state);

  if (tokens.access_token) process.env.PINTEREST_ACCESS_TOKEN = tokens.access_token;
  if (tokens.refresh_token) process.env.PINTEREST_REFRESH_TOKEN = tokens.refresh_token;
}

async function getTokens() {
  const state = await readState();
  return state.tokens || {};
}

async function clearTokens() {
  const state = await readState();
  state.tokens = {};
  await writeState(state);
  
  // Clear process env too
  delete process.env.PINTEREST_ACCESS_TOKEN;
  delete process.env.PINTEREST_REFRESH_TOKEN;
  return {};
}

function maskCookie(cookie) {
  if (!cookie || cookie.length < 12) return '';
  return `${cookie.slice(0, 6)}...${cookie.slice(-6)}`;
}

async function setSessionCookie(cookie, label = '') {
  const state = await readState();
  state.session = {
    cookie: String(cookie || '').trim(),
    updatedAt: new Date().toISOString(),
    label: String(label || '').trim(),
  };
  await writeState(state);

  if (state.session.cookie) {
    process.env.PINTEREST_SESSION_COOKIE = state.session.cookie;
  }

  return {
    hasSession: !!state.session.cookie,
    updatedAt: state.session.updatedAt,
    label: state.session.label,
    masked: maskCookie(state.session.cookie),
  };
}

async function getSessionCookie() {
  const state = await readState();
  const stored = state.session?.cookie || '';
  const envCookie = process.env.PINTEREST_SESSION_COOKIE || '';
  const cookie = stored || envCookie;
  return {
    cookie,
    hasSession: !!cookie,
    source: stored ? 'storage' : (envCookie ? 'env' : 'none'),
    updatedAt: state.session?.updatedAt || null,
    label: state.session?.label || '',
    masked: maskCookie(cookie),
  };
}

async function clearSessionCookie() {
  const state = await readState();
  state.session = {
    cookie: '',
    updatedAt: new Date().toISOString(),
    label: '',
  };
  await writeState(state);
  process.env.PINTEREST_SESSION_COOKIE = '';
  return {
    hasSession: false,
    updatedAt: state.session.updatedAt,
    label: '',
    masked: '',
  };
}

async function addEngagement(entry) {
  const state = await readState();
  const record = {
    id: uuidv4(),
    ...entry,
    createdAt: new Date().toISOString(),
  };
  state.engagements.unshift(record);
  await writeState(state);
  return record;
}

async function getEngagements() {
  const state = await readState();
  return state.engagements || [];
}

async function clearEngagements() {
  const state = await readState();
  state.engagements = [];
  await writeState(state);
}

async function getQueueData() {
  const state = await readState();
  return state.queue || [];
}

async function setQueueData(queue) {
  const state = await readState();
  state.queue = Array.isArray(queue) ? queue : [];
  await writeState(state);
  return state.queue;
}

async function getAutomationState() {
  const state = await readState();
  return state.automation || { ...DEFAULT_STATE.automation };
}

async function setAutomationState(automation) {
  const state = await readState();
  state.automation = {
    ...DEFAULT_STATE.automation,
    ...automation,
  };
  await writeState(state);
  return state.automation;
}

function getStorageInfo() {
  return storageService.getStorageInfo();
}

module.exports = {
  add,
  getAll,
  getById,
  updateById,
  remove,
  updateLatest,
  clear,
  savePkce,
  getPkce,
  deletePkce,
  saveTokens,
  getTokens,
  setSessionCookie,
  getSessionCookie,
  clearSessionCookie,
  addEngagement,
  getEngagements,
  clearEngagements,
  getQueueData,
  setQueueData,
  getAutomationState,
  setAutomationState,
  getStorageInfo,
};

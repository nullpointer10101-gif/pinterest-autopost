const { v4: uuidv4 } = require('uuid');
const xStorageService = require('./xStorageService');

const DEFAULT_STATE = {
  posts: [],
  engagements: [],
  queue: [],
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
  const state = await xStorageService.loadState(cloneDefault());
  return {
    ...cloneDefault(),
    ...state,
    posts: Array.isArray(state?.posts) ? state.posts : [],
    engagements: Array.isArray(state?.engagements) ? state.engagements : [],
    queue: Array.isArray(state?.queue) ? state.queue : [],
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
  await xStorageService.saveState(state);
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
  };

  state.posts[idx] = next;
  await writeState(state);
  return next;
}

async function clear() {
  const state = await readState();
  state.posts = [];
  await writeState(state);
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
    process.env.X_SESSION_COOKIE = state.session.cookie;
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
  const envCookie = process.env.X_SESSION_COOKIE || '';
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
  process.env.X_SESSION_COOKIE = '';
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
  return xStorageService.getStorageInfo();
}

module.exports = {
  add,
  getAll,
  getById,
  updateById,
  remove,
  clear,
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

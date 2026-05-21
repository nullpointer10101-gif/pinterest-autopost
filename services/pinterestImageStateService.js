const storageService = require('./pinterestImageStorageService');

async function loadPins() {
  const state = await storageService.loadState();
  return state.pins || {};
}

async function saveScrapedPins(pins = []) {
  const state = await storageService.loadState();
  const pinsMap = state.pins || {};
  let added = 0;
  const now = new Date().toISOString();

  for (const pin of pins) {
    const pinId = String(pin?.pinId || '').trim();
    if (!pinId) continue;
    if (!pinsMap[pinId]) added += 1;
    pinsMap[pinId] = {
      ...pinsMap[pinId],
      ...pin,
      pinId,
      lastScrapedAt: now,
    };
  }

  if (pins.length > 0) {
    state.pins = pinsMap;
    await storageService.saveState(state);
  }

  return added;
}

async function getPinById(pinId) {
  const pinsMap = await loadPins();
  return pinsMap[String(pinId || '').trim()] || null;
}

async function loadPosted() {
  const state = await storageService.loadState();
  return state.posted || {};
}

async function isPosted(pinId) {
  const posted = await loadPosted();
  return !!posted[String(pinId || '').trim()];
}

async function getPostedByPinId(pinId) {
  const posted = await loadPosted();
  return posted[String(pinId || '').trim()] || null;
}

async function markPosted(originalPinId, newPinId, meta = {}) {
  const pinId = String(originalPinId || '').trim();
  if (!pinId) throw new Error('originalPinId is required');

  const state = await storageService.loadState();
  const posted = state.posted || {};
  posted[pinId] = {
    newPinId,
    postedAt: new Date().toISOString(),
    ...meta,
  };
  state.posted = posted;
  await storageService.saveState(state);
  return posted[pinId];
}

async function appendLog(type, message, meta = {}) {
  const state = await storageService.loadState();
  const logs = Array.isArray(state.logs) ? state.logs : [];
  const entry = {
    id: `pinimglog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    message,
    meta,
    createdAt: new Date().toISOString(),
  };
  const next = [entry, ...(Array.isArray(logs) ? logs : [])].slice(0, 500);
  state.logs = next;
  await storageService.saveState(state);
  return entry;
}

async function getLogs(limit = 80) {
  const state = await storageService.loadState();
  const logs = state.logs || [];
  const max = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 80));
  return Array.isArray(logs) ? logs.slice(0, max) : [];
}

function formatLogCycleTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return 'unknown time';
  return date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

function summarizePublishCompletedGroup(group = []) {
  const newest = group[0] || {};
  const sourceAccount = String(newest.meta?.sourceAccount || '').trim();
  const posted = group.length;
  return {
    id: `pinimgcycle_${newest.id || newest.createdAt || Date.now()}`,
    type: 'publish.cycle_completed',
    message: `Posted ${posted} pin${posted === 1 ? '' : 's'}${sourceAccount ? ` from @${sourceAccount}` : ''}; ended at ${formatLogCycleTime(newest.createdAt)}.`,
    meta: {
      sourceAccount,
      posted,
      endedAt: newest.createdAt || new Date().toISOString(),
      collapsedFrom: 'publish.completed',
    },
    createdAt: newest.createdAt || new Date().toISOString(),
  };
}

function getDisplayLogsFromState(state = {}, limit = 80) {
  const logs = Array.isArray(state.logs) ? state.logs : [];
  const max = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 80));
  const displayLogs = [];

  for (let i = 0; i < logs.length && displayLogs.length < max; i += 1) {
    const log = logs[i];
    if (log?.type !== 'publish.completed') {
      displayLogs.push(log);
      continue;
    }

    const group = [log];
    const sourceAccount = String(log.meta?.sourceAccount || '').trim();
    const startedAt = new Date(log.createdAt || 0).getTime();

    while (i + 1 < logs.length) {
      const next = logs[i + 1];
      if (next?.type !== 'publish.completed') break;

      const nextSource = String(next.meta?.sourceAccount || '').trim();
      const nextAt = new Date(next.createdAt || 0).getTime();
      const sameSource = nextSource === sourceAccount;
      const withinCycle = Number.isFinite(startedAt)
        && Number.isFinite(nextAt)
        && Math.abs(startedAt - nextAt) <= 2 * 60 * 60 * 1000;

      if (!sameSource || !withinCycle) break;

      group.push(next);
      i += 1;
    }

    displayLogs.push(summarizePublishCompletedGroup(group));
  }

  return displayLogs.slice(0, max);
}

async function getDisplayLogs(limit = 80) {
  const state = await storageService.loadState();
  return getDisplayLogsFromState(state, limit);
}

async function getStats() {
  const state = await storageService.loadState();
  const pins = state.pins || {};
  const posted = state.posted || {};
  const logs = getDisplayLogsFromState(state, 20);
  return {
    scrapedPins: Object.keys(pins).length,
    postedPins: Object.keys(posted).length,
    recentLogs: logs,
    storage: storageService.getStorageInfo(),
  };
}

module.exports = {
  saveScrapedPins,
  getPinById,
  isPosted,
  getPostedByPinId,
  markPosted,
  getLogs,
  getDisplayLogs,
  appendLog,
  getStats,
};

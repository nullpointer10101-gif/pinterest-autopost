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

async function getStats() {
  const state = await storageService.loadState();
  const pins = state.pins || {};
  const posted = state.posted || {};
  const logs = Array.isArray(state.logs) ? state.logs.slice(0, 20) : [];
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
  markPosted,
  getLogs,
  appendLog,
  getStats,
};

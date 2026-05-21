const fs = require('fs/promises');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PINS_FILE = path.join(DATA_DIR, 'pinterest-image-pins.json');
const POSTED_FILE = path.join(DATA_DIR, 'pinterest-image-posted.json');
const LOGS_FILE = path.join(DATA_DIR, 'pinterest-image-logs.json');

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson(filePath, fallback) {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await ensureDataDir();
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function loadPins() {
  return readJson(PINS_FILE, {});
}

async function saveScrapedPins(pins = []) {
  const pinsMap = await loadPins();
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
    await writeJson(PINS_FILE, pinsMap);
  }

  return added;
}

async function getPinById(pinId) {
  const pinsMap = await loadPins();
  return pinsMap[String(pinId || '').trim()] || null;
}

async function loadPosted() {
  return readJson(POSTED_FILE, {});
}

async function isPosted(pinId) {
  const posted = await loadPosted();
  return !!posted[String(pinId || '').trim()];
}

async function markPosted(originalPinId, newPinId, meta = {}) {
  const pinId = String(originalPinId || '').trim();
  if (!pinId) throw new Error('originalPinId is required');

  const posted = await loadPosted();
  posted[pinId] = {
    newPinId,
    postedAt: new Date().toISOString(),
    ...meta,
  };
  await writeJson(POSTED_FILE, posted);
  return posted[pinId];
}

async function appendLog(type, message, meta = {}) {
  const logs = await readJson(LOGS_FILE, []);
  const entry = {
    id: `pinimglog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    message,
    meta,
    createdAt: new Date().toISOString(),
  };
  const next = [entry, ...(Array.isArray(logs) ? logs : [])].slice(0, 500);
  await writeJson(LOGS_FILE, next);
  return entry;
}

async function getLogs(limit = 80) {
  const logs = await readJson(LOGS_FILE, []);
  const max = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 80));
  return Array.isArray(logs) ? logs.slice(0, max) : [];
}

async function getStats() {
  const [pins, posted, logs] = await Promise.all([
    loadPins(),
    loadPosted(),
    getLogs(20),
  ]);
  return {
    scrapedPins: Object.keys(pins).length,
    postedPins: Object.keys(posted).length,
    recentLogs: logs,
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

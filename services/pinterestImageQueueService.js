const storageService = require('./pinterestImageStorageService');

function normalizeSourceAccount(username) {
  return String(username || '').replace(/^@/, '').trim().toLowerCase();
}

async function loadQueue() {
  const state = await storageService.loadState();
  return Array.isArray(state.queue) ? state.queue : [];
}

async function saveQueue(queue) {
  const state = await storageService.loadState();
  state.queue = Array.isArray(queue) ? queue : [];
  await storageService.saveState(state);
}

function normalizeQueuePin(pin = {}) {
  const pinId = String(pin.pinId || pin.sourcePinId || '').trim();
  if (!pinId) return null;

  return {
    ...pin,
    id: pin.id || `pinimg_${pinId}`,
    pinId,
    sourcePinId: pinId,
    sourceAccount: normalizeSourceAccount(pin.sourceAccount),
    mediaType: pin.mediaType || 'image',
    imageUrls: Array.isArray(pin.imageUrls) ? pin.imageUrls.filter(Boolean) : [],
    attempts: Number.parseInt(pin.attempts, 10) || 0,
    queuedAt: pin.queuedAt || new Date().toISOString(),
  };
}

async function addPinsToQueue(newPins = []) {
  const queue = await loadQueue();
  const seen = new Set(queue.map((pin) => String(pin.pinId || pin.sourcePinId || '').trim()).filter(Boolean));
  const added = [];
  const skipped = [];

  for (const rawPin of newPins) {
    const pin = normalizeQueuePin(rawPin);
    if (!pin || pin.imageUrls.length === 0) {
      skipped.push({ pinId: rawPin?.pinId || '', reason: 'invalid_image_pin' });
      continue;
    }
    if (seen.has(pin.pinId)) {
      skipped.push({ pinId: pin.pinId, reason: 'already_queued' });
      continue;
    }
    queue.push(pin);
    seen.add(pin.pinId);
    added.push(pin);
  }

  if (added.length > 0) {
    await saveQueue(queue);
  }

  return { added, skipped };
}

async function popPinsFromQueue(count = 5, options = {}) {
  const queue = await loadQueue();
  const limit = Math.max(1, Number.parseInt(count, 10) || 5);
  const sourceAccount = normalizeSourceAccount(options.sourceAccount);

  if (!sourceAccount) {
    const popped = queue.splice(0, limit);
    await saveQueue(queue);
    return popped;
  }

  const popped = [];
  const remaining = [];

  for (const pin of queue) {
    if (popped.length < limit && normalizeSourceAccount(pin.sourceAccount) === sourceAccount) {
      popped.push(pin);
    } else {
      remaining.push(pin);
    }
  }

  await saveQueue(remaining);
  return popped;
}

async function prependPins(pins = []) {
  if (!Array.isArray(pins) || pins.length === 0) return loadQueue();
  const queue = await loadQueue();
  const normalized = pins.map(normalizeQueuePin).filter(Boolean);
  const next = [...normalized, ...queue];
  await saveQueue(next);
  return next;
}

async function removeBySourceAccount(username) {
  const cleanUsername = normalizeSourceAccount(username);
  const queue = await loadQueue();
  const next = queue.filter((pin) => String(pin.sourceAccount || '').toLowerCase() !== cleanUsername);
  await saveQueue(next);
  return {
    removed: queue.length - next.length,
    queue: next,
  };
}

async function getQueueStats() {
  const queue = await loadQueue();
  const bySource = {};
  for (const pin of queue) {
    const source = String(pin.sourceAccount || 'unknown').toLowerCase();
    bySource[source] = (bySource[source] || 0) + 1;
  }
  return {
    total: queue.length,
    bySource,
  };
}

module.exports = {
  normalizeSourceAccount,
  loadQueue,
  saveQueue,
  addPinsToQueue,
  popPinsFromQueue,
  prependPins,
  removeBySourceAccount,
  getQueueStats,
};

const pinterestImageQueueService = require('./pinterestImageQueueService');
const storageService = require('./pinterestImageStorageService');

function normalizeUsername(input) {
  let clean = String(input || '').trim().toLowerCase();
  if (!clean) return '';

  try {
    const parsed = new URL(clean);
    const host = parsed.hostname.toLowerCase();
    if (!host.includes('pinterest.')) return '';
    const segments = parsed.pathname.split('/').filter(Boolean);
    clean = segments[0] || '';
  } catch {
    const match = clean.match(/pinterest\.[a-z.]+\/([a-z0-9._-]+)/i);
    if (match) clean = match[1];
  }

  clean = clean.replace(/^@/, '').split('/')[0].split('?')[0].trim();
  const reserved = new Set(['pin', 'board', 'search', 'explore', 'ideas', 'settings', 'today', 'login', 'signup']);
  if (!clean || reserved.has(clean)) return '';
  return /^[a-z0-9._-]+$/i.test(clean) ? clean : '';
}

function normalizeChannelRecord(channel) {
  const username = normalizeUsername(typeof channel === 'string' ? channel : channel?.username);
  if (!username) return null;
  return {
    username,
    active: channel?.active !== false,
    status: channel?.status || 'active',
    addedAt: channel?.addedAt || new Date().toISOString(),
    updatedAt: channel?.updatedAt || new Date().toISOString(),
    lastScannedAt: channel?.lastScannedAt || null,
    lastQueuedAt: channel?.lastQueuedAt || null,
  };
}

async function readChannels() {
  const state = await storageService.loadState();
  return (state.channels || [])
    .map(normalizeChannelRecord)
    .filter(Boolean)
    .sort((a, b) => a.username.localeCompare(b.username));
}

async function writeChannels(channels) {
  const state = await storageService.loadState();
  state.channels = (channels || []).map(normalizeChannelRecord).filter(Boolean);
  await storageService.saveState(state);
}

async function listChannels() {
  return readChannels();
}

async function addChannel(input) {
  const username = normalizeUsername(input);
  if (!username) {
    throw new Error('Enter a valid Pinterest username or profile URL.');
  }

  const state = await storageService.loadState();
  const channels = (state.channels || []).map(normalizeChannelRecord).filter(Boolean);
  const existing = channels.find((channel) => channel.username === username);
  const now = new Date().toISOString();

  if (existing) {
    if (existing.active === false || existing.status === 'removed') {
      existing.active = true;
      existing.status = 'active';
      existing.updatedAt = now;
      state.channels = channels;
      await storageService.saveState(state);
      return { channel: existing, created: false, reactivated: true };
    }

    const err = new Error(`@${username} is already in Pinterest image sources.`);
    err.code = 'DUPLICATE_ACCOUNT';
    err.username = username;
    throw err;
  }

  const channel = {
    username,
    active: true,
    status: 'active',
    addedAt: now,
    updatedAt: now,
    lastScannedAt: null,
    lastQueuedAt: null,
  };
  channels.push(channel);
  state.channels = channels;
  await storageService.saveState(state);
  return { channel, created: true, reactivated: false };
}

async function removeChannel(input) {
  const username = normalizeUsername(input);
  if (!username) {
    throw new Error('Enter a valid Pinterest username or profile URL.');
  }

  const state = await storageService.loadState();
  const channels = (state.channels || []).map(normalizeChannelRecord).filter(Boolean);
  const next = channels.filter((channel) => channel.username !== username);
  const removed = channels.length - next.length;
  state.channels = next;
  await storageService.saveState(state);
  const queueResult = await pinterestImageQueueService.removeBySourceAccount(username);

  return {
    username,
    removed,
    removedQueuedPins: queueResult.removed,
    channels: next,
  };
}

async function markChannelScan(usernameInput, patch = {}) {
  const username = normalizeUsername(usernameInput);
  if (!username) return null;
  const state = await storageService.loadState();
  const channels = (state.channels || []).map(normalizeChannelRecord).filter(Boolean);
  const channel = channels.find((entry) => entry.username === username);
  if (!channel) return null;
  Object.assign(channel, patch, { updatedAt: new Date().toISOString() });
  state.channels = channels;
  await storageService.saveState(state);
  return channel;
}

module.exports = {
  normalizeUsername,
  listChannels,
  addChannel,
  removeChannel,
  markChannelScan,
};

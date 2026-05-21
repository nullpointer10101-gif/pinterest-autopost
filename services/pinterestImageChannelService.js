const fs = require('fs/promises');
const path = require('path');
const pinterestImageQueueService = require('./pinterestImageQueueService');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CHANNELS_FILE = path.join(DATA_DIR, 'pinterest-image-accounts.json');
const LEGACY_CHANNELS_FILE = path.join(DATA_DIR, 'pinterest-accounts.json');

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

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

async function readJson(filePath, fallback) {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function writeChannels(channels) {
  await ensureDataDir();
  await fs.writeFile(CHANNELS_FILE, JSON.stringify(channels, null, 2), 'utf8');
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
  let channels = await readJson(CHANNELS_FILE, null);
  if (!channels) {
    const legacy = await readJson(LEGACY_CHANNELS_FILE, []);
    channels = legacy.map(normalizeChannelRecord).filter(Boolean);
    if (channels.length > 0) {
      await writeChannels(channels);
    }
  }

  return (channels || [])
    .map(normalizeChannelRecord)
    .filter(Boolean)
    .sort((a, b) => a.username.localeCompare(b.username));
}

async function listChannels() {
  return readChannels();
}

async function addChannel(input) {
  const username = normalizeUsername(input);
  if (!username) {
    throw new Error('Enter a valid Pinterest username or profile URL.');
  }

  const channels = await readChannels();
  const existing = channels.find((channel) => channel.username === username);
  const now = new Date().toISOString();

  if (existing) {
    if (existing.active === false || existing.status === 'removed') {
      existing.active = true;
      existing.status = 'active';
      existing.updatedAt = now;
      await writeChannels(channels);
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
  await writeChannels(channels);
  return { channel, created: true, reactivated: false };
}

async function removeChannel(input) {
  const username = normalizeUsername(input);
  if (!username) {
    throw new Error('Enter a valid Pinterest username or profile URL.');
  }

  const channels = await readChannels();
  const next = channels.filter((channel) => channel.username !== username);
  const removed = channels.length - next.length;
  await writeChannels(next);
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
  const channels = await readChannels();
  const channel = channels.find((entry) => entry.username === username);
  if (!channel) return null;
  Object.assign(channel, patch, { updatedAt: new Date().toISOString() });
  await writeChannels(channels);
  return channel;
}

module.exports = {
  normalizeUsername,
  listChannels,
  addChannel,
  removeChannel,
  markChannelScan,
};

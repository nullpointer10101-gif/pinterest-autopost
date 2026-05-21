const pinterestImageQueueService = require('./pinterestImageQueueService');
const storageService = require('./pinterestImageStorageService');

const RESERVED_PINTEREST_PATHS = new Set(['pin', 'board', 'search', 'explore', 'ideas', 'settings', 'today', 'login', 'signup']);
const URL_RESOLVE_TIMEOUT_MS = 8000;

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
  if (!clean || RESERVED_PINTEREST_PATHS.has(clean)) return '';
  return /^[a-z0-9._-]+$/i.test(clean) ? clean : '';
}

function isResolvablePinterestUrl(input) {
  const raw = String(input || '').trim();
  if (!/^https?:\/\//i.test(raw)) return false;

  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === 'pin.it' || host.endsWith('.pin.it') || host.includes('pinterest.');
  } catch {
    return false;
  }
}

async function followPinterestRedirects(url, maxRedirects = 8) {
  let currentUrl = url;

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), URL_RESOLVE_TIMEOUT_MS);

    try {
      const response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      });

      const location = response.headers.get('location');
      if ([301, 302, 303, 307, 308].includes(response.status) && location) {
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      return currentUrl;
    } catch (err) {
      if (err?.name === 'AbortError') throw new Error('Pinterest URL resolver timed out');
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error('Pinterest URL had too many redirects');
}

async function resolveUsername(input) {
  const normalized = normalizeUsername(input);
  if (normalized) return normalized;

  if (!isResolvablePinterestUrl(input)) return '';

  const resolvedUrl = await followPinterestRedirects(String(input).trim());
  return normalizeUsername(resolvedUrl);
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
  const username = await resolveUsername(input);
  if (!username) {
    throw new Error('Enter a valid Pinterest username, profile URL, or pin.it profile invite link.');
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
  const username = await resolveUsername(input);
  if (!username) {
    throw new Error('Enter a valid Pinterest username, profile URL, or pin.it profile invite link.');
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
  resolveUsername,
  listChannels,
  addChannel,
  removeChannel,
  markChannelScan,
};

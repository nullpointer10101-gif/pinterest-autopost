const pinterestImageQueueService = require('./pinterestImageQueueService');
const storageService = require('./pinterestImageStorageService');

const RESERVED_PINTEREST_PATHS = new Set(['pin', 'board', 'search', 'explore', 'ideas', 'settings', 'today', 'login', 'signup']);
const URL_RESOLVE_TIMEOUT_MS = 8000;
const PROFILE_FETCH_TIMEOUT_MS = 12000;
const PROFILE_PIC_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PROFILE_PIC_ERROR_TTL_MS = 6 * 60 * 60 * 1000;
const PROFILE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

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

function decodeJsonString(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
  } catch {
    return raw
      .replace(/\\u0026/g, '&')
      .replace(/\\\//g, '/')
      .replace(/&amp;/g, '&');
  }
}

function isUsableProfileImageUrl(url) {
  const clean = String(url || '').trim();
  if (!/^https?:\/\//i.test(clean)) return false;
  if (!/pinimg\.com/i.test(clean)) return false;
  if (/default_open_graph/i.test(clean)) return false;
  return /\/(?:\d+x\d+_RS|avatars|user|profile)\//i.test(clean)
    || /image_(?:xlarge|medium|small)_url/i.test(clean)
    || /pinimg\.com\/\d+x\d+_RS\//i.test(clean);
}

function extractProfilePicUrlFromHtml(html) {
  const text = String(html || '');
  const candidates = [];
  const patterns = [
    /"image_xlarge_url"\s*:\s*"([^"]+)"/gi,
    /"image_medium_url"\s*:\s*"([^"]+)"/gi,
    /"image_small_url"\s*:\s*"([^"]+)"/gi,
    /"profile_image"\s*:\s*"([^"]+)"/gi,
    /"profileImage"\s*:\s*"([^"]+)"/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) {
      const url = decodeJsonString(match[1]);
      if (isUsableProfileImageUrl(url)) candidates.push(url);
    }
  }

  return candidates[0] || '';
}

async function fetchProfilePicUrl(usernameInput) {
  const username = normalizeUsername(usernameInput);
  if (!username) return '';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROFILE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`https://www.pinterest.com/${encodeURIComponent(username)}/`, {
      headers: PROFILE_HEADERS,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Pinterest profile HTTP ${response.status}`);
    const html = await response.text();
    return extractProfilePicUrlFromHtml(html);
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Pinterest profile image lookup timed out');
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function shouldRefreshProfilePic(channel = {}, nowMs = Date.now(), force = false) {
  if (force) return true;

  const fetchedAt = channel.profilePicFetchedAt ? new Date(channel.profilePicFetchedAt).getTime() : 0;
  if (channel.profilePicUrl && fetchedAt && nowMs - fetchedAt < PROFILE_PIC_TTL_MS) return false;

  const errorAt = channel.profilePicErrorAt ? new Date(channel.profilePicErrorAt).getTime() : 0;
  if (!channel.profilePicUrl && errorAt && nowMs - errorAt < PROFILE_PIC_ERROR_TTL_MS) return false;

  return true;
}

function getFirstSource(...values) {
  for (const value of values) {
    const source = normalizeUsername(value);
    if (source) return source;
  }
  return '';
}

function addCount(counts, source, amount = 1) {
  const cleanSource = normalizeUsername(source);
  if (!cleanSource || amount <= 0) return;
  counts[cleanSource] = (counts[cleanSource] || 0) + amount;
}

function getPublishCompletedSourcesByPin(logs = []) {
  const sourcesByPin = new Map();
  if (!Array.isArray(logs)) return sourcesByPin;

  for (const log of logs) {
    if (log?.type !== 'publish.completed') continue;
    const pinId = String(log.meta?.pinId || log.meta?.sourcePinId || '').trim();
    if (!pinId || sourcesByPin.has(pinId)) continue;
    const source = getFirstSource(
      log.meta?.sourceAccount,
      log.meta?.username,
      log.meta?.sourceUsername
    );
    if (source) sourcesByPin.set(pinId, source);
  }

  return sourcesByPin;
}

function getPublishCycleSourceHints(logs = []) {
  const hints = {};
  if (!Array.isArray(logs)) return hints;

  for (const log of logs) {
    if (log?.type !== 'publish.cycle_completed') continue;
    const source = getFirstSource(log.meta?.sourceAccount, log.meta?.username);
    const posted = Number.parseInt(log.meta?.posted, 10) || 0;
    if (source && posted > 0) addCount(hints, source, posted);
  }

  return hints;
}

function getPinSource(pin = {}) {
  const record = pin && typeof pin === 'object' ? pin : {};
  return getFirstSource(
    record.sourceAccount,
    record.username,
    record.sourceUsername,
    record.owner?.username,
    record.ownerUsername,
    record.pinner?.username,
    record.user?.username
  );
}

function getPostSource(record = {}, pin = {}, logSource = '') {
  const post = record && typeof record === 'object' ? record : {};
  const sourcePin = pin && typeof pin === 'object' ? pin : {};
  return getFirstSource(
    post.sourceAccount,
    post.username,
    post.sourceUsername,
    post.owner?.username,
    post.ownerUsername,
    post.pinner?.username,
    post.user?.username,
    post.pin?.sourceAccount,
    post.pin?.username,
    post.pin?.sourceUsername,
    sourcePin.sourceAccount,
    sourcePin.username,
    sourcePin.sourceUsername,
    logSource
  );
}

function getSourceStats(state = {}, channels = []) {
  const postedBySource = {};
  const exactPostedBySource = {};
  const recoveredPostedBySource = {};
  const scrapedBySource = {};
  const queuedBySource = {};
  const posted = state.posted && typeof state.posted === 'object' ? state.posted : {};
  const pins = state.pins && typeof state.pins === 'object' ? state.pins : {};
  const queue = Array.isArray(state.queue) ? state.queue : [];
  const logs = Array.isArray(state.logs) ? state.logs : [];
  const completedLogSources = getPublishCompletedSourcesByPin(logs);
  const cycleSourceHints = getPublishCycleSourceHints(logs);
  let totalPosted = 0;
  let attributedPosted = 0;

  for (const pin of Object.values(pins)) {
    addCount(scrapedBySource, getPinSource(pin));
  }

  for (const pin of queue) {
    addCount(queuedBySource, getPinSource(pin));
  }

  for (const [pinId, record] of Object.entries(posted)) {
    totalPosted += 1;
    const postRecord = record && typeof record === 'object' ? record : {};
    const sourcePinId = String(postRecord.pinId || postRecord.sourcePinId || pinId || '').trim();
    const pin = pins[pinId] || pins[sourcePinId] || {};
    const source = getPostSource(postRecord, pin, completedLogSources.get(pinId) || completedLogSources.get(sourcePinId) || '');
    if (!source) continue;
    addCount(postedBySource, source);
    addCount(exactPostedBySource, source);
    attributedPosted += 1;
  }

  const unattributedPosted = Math.max(0, totalPosted - attributedPosted);
  const normalizedChannels = (channels || []).map(normalizeChannelRecord).filter(Boolean);
  if (unattributedPosted > 0 && normalizedChannels.length > 0) {
    const zeroPostedChannels = normalizedChannels.filter((channel) => !postedBySource[channel.username]);
    const cycleHintCandidates = zeroPostedChannels.filter((channel) => cycleSourceHints[channel.username] > 0);
    const activeScrapedCandidates = zeroPostedChannels.filter((channel) => (
      (scrapedBySource[channel.username] || 0) + (queuedBySource[channel.username] || 0)
    ) > 0);

    let recoveredChannel = null;
    if (cycleHintCandidates.length === 1) {
      recoveredChannel = cycleHintCandidates[0];
    } else if (activeScrapedCandidates.length === 1) {
      recoveredChannel = activeScrapedCandidates[0];
    } else if (
      zeroPostedChannels.length === 1
      && normalizedChannels.every((channel) => (
        (scrapedBySource[channel.username] || 0) + (queuedBySource[channel.username] || 0)
      ) === 0)
    ) {
      recoveredChannel = zeroPostedChannels[0];
    }

    if (recoveredChannel) {
      addCount(postedBySource, recoveredChannel.username, unattributedPosted);
      addCount(recoveredPostedBySource, recoveredChannel.username, unattributedPosted);
    }
  }

  return {
    postedBySource,
    exactPostedBySource,
    recoveredPostedBySource,
    scrapedBySource,
    queuedBySource,
    totalPosted,
    unattributedPosted,
  };
}

async function saveChannelProfilePatch(usernameInput, patch = {}) {
  const username = normalizeUsername(usernameInput);
  if (!username) return null;

  const latestState = await storageService.loadState();
  const latestChannels = (latestState.channels || []).map(normalizeChannelRecord).filter(Boolean);
  const channel = latestChannels.find((entry) => entry.username === username);
  if (!channel) return null;

  Object.assign(channel, patch, { updatedAt: new Date().toISOString() });
  latestState.channels = latestChannels;
  await storageService.saveState(latestState);
  return channel;
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
    profilePicUrl: String(channel?.profilePicUrl || '').trim() || null,
    profilePicFetchedAt: channel?.profilePicFetchedAt || null,
    profilePicErrorAt: channel?.profilePicErrorAt || null,
    profilePicError: channel?.profilePicError || null,
  };
}

async function readChannels(options = {}) {
  const backfillProfiles = options.backfillProfiles !== false;
  const maxProfileBackfills = Math.max(0, Number.parseInt(options.maxProfileBackfills, 10) || 3);
  const state = await storageService.loadState();
  const channels = (state.channels || [])
    .map(normalizeChannelRecord)
    .filter(Boolean);
  const sourceStats = getSourceStats(state, channels);

  let changed = false;
  let backfilled = 0;
  const now = Date.now();
  if (backfillProfiles && maxProfileBackfills > 0) {
    for (const channel of channels) {
      if (backfilled >= maxProfileBackfills) break;
      if (!shouldRefreshProfilePic(channel, now)) continue;
      backfilled += 1;
      try {
        const profilePicUrl = await fetchProfilePicUrl(channel.username);
        if (profilePicUrl) {
          channel.profilePicUrl = profilePicUrl;
          channel.profilePicFetchedAt = new Date().toISOString();
          channel.profilePicError = null;
          channel.profilePicErrorAt = null;
          changed = true;
        }
      } catch (err) {
        channel.profilePicError = err.message;
        channel.profilePicErrorAt = new Date().toISOString();
        changed = true;
      }
    }
  }

  if (changed) {
    const latestState = await storageService.loadState();
    const latestChannels = (latestState.channels || []).map(normalizeChannelRecord).filter(Boolean);
    for (const updated of channels) {
      const hit = latestChannels.find((channel) => channel.username === updated.username);
      if (!hit) continue;
      hit.profilePicUrl = updated.profilePicUrl || null;
      hit.profilePicFetchedAt = updated.profilePicFetchedAt || null;
      hit.profilePicError = updated.profilePicError || null;
      hit.profilePicErrorAt = updated.profilePicErrorAt || null;
    }
    latestState.channels = latestChannels;
    await storageService.saveState(latestState);
  }

  return channels
    .map((channel) => ({
      ...channel,
      postedPins: sourceStats.postedBySource[channel.username] || 0,
      postedPinsExact: sourceStats.exactPostedBySource[channel.username] || 0,
      legacyRecoveredPostedPins: sourceStats.recoveredPostedBySource[channel.username] || 0,
      scrapedPins: sourceStats.scrapedBySource[channel.username] || 0,
      queuedPins: sourceStats.queuedBySource[channel.username] || 0,
    }))
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

async function ensureChannelProfilePic(input, options = {}) {
  const username = await resolveUsername(input);
  if (!username) return { username: '', profilePicUrl: '' };

  const state = await storageService.loadState();
  const channels = (state.channels || []).map(normalizeChannelRecord).filter(Boolean);
  const channel = channels.find((entry) => entry.username === username);
  const now = Date.now();

  if (channel && !shouldRefreshProfilePic(channel, now, options.force === true)) {
    return { username, profilePicUrl: channel.profilePicUrl || '' };
  }

  const profilePicUrl = await fetchProfilePicUrl(username).catch((err) => {
    if (channel) {
      channel.profilePicError = err.message;
      channel.profilePicErrorAt = new Date().toISOString();
    }
    return '';
  });

  if (channel && profilePicUrl) {
    await saveChannelProfilePatch(username, {
      profilePicUrl,
      profilePicFetchedAt: new Date().toISOString(),
      profilePicError: null,
      profilePicErrorAt: null,
    });
  } else if (channel) {
    await saveChannelProfilePatch(username, {
      profilePicError: channel.profilePicError,
      profilePicErrorAt: channel.profilePicErrorAt,
    });
  }

  return { username, profilePicUrl };
}

async function addChannel(input) {
  const username = await resolveUsername(input);
  if (!username) {
    throw new Error('Enter a valid Pinterest username, profile URL, or pin.it profile invite link.');
  }

  const now = new Date().toISOString();
  const profilePatch = {
    profilePicUrl: null,
    profilePicFetchedAt: null,
    profilePicErrorAt: null,
    profilePicError: null,
  };
  try {
    const profilePicUrl = await fetchProfilePicUrl(username);
    if (profilePicUrl) {
      profilePatch.profilePicUrl = profilePicUrl;
      profilePatch.profilePicFetchedAt = now;
    }
  } catch (err) {
    profilePatch.profilePicError = err.message;
    profilePatch.profilePicErrorAt = now;
  }

  const state = await storageService.loadState();
  const channels = (state.channels || []).map(normalizeChannelRecord).filter(Boolean);
  const existing = channels.find((channel) => channel.username === username);

  if (existing) {
    if (existing.active === false || existing.status === 'removed') {
      existing.active = true;
      existing.status = 'active';
      existing.updatedAt = now;
      if (profilePatch.profilePicUrl) {
        Object.assign(existing, profilePatch);
      } else {
        existing.profilePicError = profilePatch.profilePicError;
        existing.profilePicErrorAt = profilePatch.profilePicErrorAt;
      }
      state.channels = channels;
      await storageService.saveState(state);
      const sourceStats = getSourceStats(state, channels);
      return {
        channel: {
          ...existing,
          postedPins: sourceStats.postedBySource[existing.username] || 0,
          postedPinsExact: sourceStats.exactPostedBySource[existing.username] || 0,
          legacyRecoveredPostedPins: sourceStats.recoveredPostedBySource[existing.username] || 0,
          scrapedPins: sourceStats.scrapedBySource[existing.username] || 0,
          queuedPins: sourceStats.queuedBySource[existing.username] || 0,
        },
        created: false,
        reactivated: true,
      };
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
    ...profilePatch,
  };
  channels.push(channel);
  state.channels = channels;
  await storageService.saveState(state);
  const sourceStats = getSourceStats(state, channels);
  return {
    channel: {
      ...channel,
      postedPins: sourceStats.postedBySource[channel.username] || 0,
      postedPinsExact: sourceStats.exactPostedBySource[channel.username] || 0,
      legacyRecoveredPostedPins: sourceStats.recoveredPostedBySource[channel.username] || 0,
      scrapedPins: sourceStats.scrapedBySource[channel.username] || 0,
      queuedPins: sourceStats.queuedBySource[channel.username] || 0,
    },
    created: true,
    reactivated: false,
  };
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
  ensureChannelProfilePic,
  addChannel,
  removeChannel,
  markChannelScan,
};

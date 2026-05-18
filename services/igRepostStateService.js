const storageService = require('./igRepostStorageService');

const MAX_LOGS = 1000;
const MAX_POSTS = 2000;
const LOOK_INDEX_TTL = 60 * 60 * 24 * 90;
const LOOK_INDEX_PREFIX = 'iglook:';

const DEFAULT_STATE = {
  accounts: {},
  reels: {},
  queue: [],
  posts: [],
  logs: [],
  scheduler: {
    lastWakeAt: null,
    lastRunStartedAt: null,
    lastRunCompletedAt: null,
    lastRunStatus: 'idle',
    lastRunId: null,
    lastError: null,
    totalRuns: 0,
    totalScans: 0,
    totalPosts: 0,
    lastDispatchAt: null,
    lock: null,
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeUsername(input) {
  if (!input) return null;
  let clean = String(input).trim().toLowerCase();
  if (clean.includes('instagram.com/')) {
    const match = clean.match(/instagram\.com\/([A-Za-z0-9._]+)/);
    if (match) clean = match[1];
  }
  clean = clean.replace(/^@/, '');
  clean = clean.split('/')[0].split('?')[0].trim();
  return clean || null;
}

function parseShortcode(url) {
  const match = String(url || '').match(/\/(reel|p|tv)\/([A-Za-z0-9_-]+)/);
  return match ? match[2] : null;
}

function normalizeScheduledAfter(value) {
  if (!value) return null;
  const ts = new Date(value);
  if (!Number.isFinite(ts.getTime())) return null;
  return ts.toISOString();
}

function normalizeShortcode(input) {
  return String(input || '').trim();
}

function reelKey(username, shortcode) {
  return `${username}:${shortcode}`;
}

function buildLookPayload(record = {}) {
  const shortcode = normalizeShortcode(record.shortcode || record?.reelData?.shortcode);
  if (!shortcode) return null;

  const title = String(
    record?.aiContent?.title ||
    record?.title ||
    record?.productInfo?.name ||
    'Shop The Look'
  ).trim();

  const description = String(
    record?.aiContent?.description ||
    record?.description ||
    ''
  ).trim();

  return {
    source: 'ig_repost',
    id: record.id || createId('iglook'),
    shortcode,
    title,
    description,
    thumbnailUrl: record.thumbnailUrl || record?.reelData?.thumbnailUrl || '',
    mediaUrl: record.mediaUrl || record?.reelData?.mediaUrl || record.thumbnailUrl || '',
    affiliateLink: record.affiliateLink || null,
    productInfo: record.productInfo || null,
    aiContent: {
      title,
      description,
    },
    boardName: record.boardName || '',
    createdAt: record.postedAt || record.createdAt || nowIso(),
  };
}

async function writeLookIndex(record) {
  const payload = buildLookPayload(record);
  if (!payload) return false;
  return storageService.setJsonKey(`${LOOK_INDEX_PREFIX}${payload.shortcode}`, payload, LOOK_INDEX_TTL);
}

async function readState() {
  const state = await storageService.loadState(DEFAULT_STATE);
  return {
    ...clone(DEFAULT_STATE),
    ...state,
    accounts: state?.accounts && typeof state.accounts === 'object' ? state.accounts : {},
    reels: state?.reels && typeof state.reels === 'object' ? state.reels : {},
    queue: Array.isArray(state?.queue) ? state.queue : [],
    posts: Array.isArray(state?.posts) ? state.posts : [],
    logs: Array.isArray(state?.logs) ? state.logs : [],
    scheduler: {
      ...DEFAULT_STATE.scheduler,
      ...(state?.scheduler || {}),
    },
  };
}

async function writeState(state) {
  await storageService.saveState(state);
}

function appendLogToState(state, level, type, message, meta = {}) {
  state.logs.unshift({
    id: createId('iglog'),
    level,
    type,
    message,
    meta,
    createdAt: nowIso(),
  });
  state.logs = state.logs.slice(0, MAX_LOGS);
}

function ensureAccountRecord(state, username) {
  if (!state.accounts[username]) {
    const now = nowIso();
    state.accounts[username] = {
      username,
      status: 'pending_validation',
      addedAt: now,
      updatedAt: now,
      activeAt: null,
      profilePicUrl: null,
      lastScannedAt: null,
      lastSuccessfulPostAt: null,
      lastFailureAt: null,
      failureCount: 0,
      validation: {
        pending: true,
        lastRequestedAt: now,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastError: null,
      },
    };
  }
  return state.accounts[username];
}

function ensureReelRecord(state, username, shortcode, patch = {}) {
  const key = reelKey(username, shortcode);
  const current = state.reels[key] || {
    key,
    username,
    shortcode,
    firstSeenAt: nowIso(),
    lastSeenAt: null,
    sourceUrl: '',
    mediaUrl: '',
    thumbnailUrl: '',
    mediaType: 'video',
    caption: '',
    isPinned: false,
    pinnedSkippedAt: null,
    status: 'discovered',
    repostedAt: null,
    lastAttemptAt: null,
    retryCount: 0,
    failureCount: 0,
    lastError: null,
    queueItemId: null,
    updatedAt: null,
  };

  state.reels[key] = {
    ...current,
    ...patch,
    username,
    shortcode,
    key,
    updatedAt: nowIso(),
  };

  return state.reels[key];
}

async function listAccounts() {
  const state = await readState();
  return Object.values(state.accounts)
    .sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')));
}

async function getAccount(input) {
  const username = normalizeUsername(input);
  if (!username) return null;
  const state = await readState();
  return state.accounts[username] || null;
}

async function addAccount(input, options = {}) {
  const username = normalizeUsername(input);
  if (!username) throw new Error('Invalid username or Instagram URL');

  const state = await readState();
  const account = ensureAccountRecord(state, username);
  const now = nowIso();

  account.updatedAt = now;
  account.status = options.activate ? 'active' : 'pending_validation';
  account.validation = {
    ...(account.validation || {}),
    pending: !options.activate,
    lastRequestedAt: now,
    lastError: null,
  };

  if (options.profilePicUrl) {
    account.profilePicUrl = options.profilePicUrl;
  }

  appendLogToState(state, 'info', 'account.added', `Added @${username} to the IG repost pipeline.`, {
    username,
  });

  await writeState(state);
  return clone(account);
}

async function removeAccount(input) {
  const username = normalizeUsername(input);
  if (!username) throw new Error('Invalid username or Instagram URL');

  const state = await readState();
  delete state.accounts[username];

  state.queue = state.queue.filter((item) => normalizeUsername(item.username) !== username);
  Object.keys(state.reels).forEach((key) => {
    if (key.startsWith(`${username}:`)) {
      delete state.reels[key];
    }
  });

  appendLogToState(state, 'info', 'account.removed', `Removed @${username} from the IG repost pipeline.`, {
    username,
  });

  await writeState(state);
  return Object.values(state.accounts)
    .sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')));
}

async function setAccountProfilePic(input, profilePicUrl) {
  const username = normalizeUsername(input);
  if (!username) return null;
  const state = await readState();
  const account = ensureAccountRecord(state, username);
  account.profilePicUrl = profilePicUrl || null;
  account.updatedAt = nowIso();
  await writeState(state);
  return clone(account);
}

async function markAccountValidationStarted(input, meta = {}) {
  const username = normalizeUsername(input);
  if (!username) return null;
  const state = await readState();
  const account = ensureAccountRecord(state, username);
  const now = nowIso();
  account.status = 'pending_validation';
  account.updatedAt = now;
  account.validation = {
    ...(account.validation || {}),
    pending: true,
    lastRequestedAt: meta.requestedAt || now,
    lastAttemptAt: now,
    lastError: null,
  };
  appendLogToState(state, 'info', 'validation.started', `Validation started for @${username}.`, {
    username,
    ...meta,
  });
  await writeState(state);
  return clone(account);
}

async function markAccountActive(input, meta = {}) {
  const username = normalizeUsername(input);
  if (!username) return null;
  const state = await readState();
  const account = ensureAccountRecord(state, username);
  const now = nowIso();
  account.status = 'active';
  account.activeAt = account.activeAt || now;
  account.updatedAt = now;
  account.lastSuccessfulPostAt = meta.postedAt || account.lastSuccessfulPostAt || now;
  account.validation = {
    ...(account.validation || {}),
    pending: false,
    lastAttemptAt: meta.attemptedAt || now,
    lastSuccessAt: now,
    lastError: null,
  };
  appendLogToState(state, 'info', 'account.active', `Account @${username} is now active.`, {
    username,
    ...meta,
  });
  await writeState(state);
  return clone(account);
}

async function markAccountFailed(input, error, meta = {}) {
  const username = normalizeUsername(input);
  if (!username) return null;
  const state = await readState();
  const account = ensureAccountRecord(state, username);
  const now = nowIso();
  account.status = meta.keepPending ? 'pending_validation' : 'error';
  account.updatedAt = now;
  account.lastFailureAt = now;
  account.failureCount = Number(account.failureCount || 0) + 1;
  account.validation = {
    ...(account.validation || {}),
    pending: !!meta.keepPending,
    lastAttemptAt: now,
    lastFailureAt: now,
    lastError: String(error || 'Unknown error'),
  };
  appendLogToState(state, 'error', 'account.failed', `Account @${username} failed validation or repost processing.`, {
    username,
    error: String(error || 'Unknown error'),
    ...meta,
  });
  await writeState(state);
  return clone(account);
}

async function noteAccountScan(input, meta = {}) {
  const username = normalizeUsername(input);
  if (!username) return null;
  const state = await readState();
  const account = ensureAccountRecord(state, username);
  account.lastScannedAt = nowIso();
  account.updatedAt = nowIso();
  if (typeof meta.failureCountDelta === 'number' && meta.failureCountDelta > 0) {
    account.failureCount = Number(account.failureCount || 0) + meta.failureCountDelta;
  }
  await writeState(state);
  return clone(account);
}

async function upsertReelMeta(reel, patch = {}) {
  const username = normalizeUsername(reel?.username);
  const shortcode = String(reel?.shortcode || parseShortcode(reel?.url || '') || '').trim();
  if (!username || !shortcode) return null;

  const state = await readState();
  const record = ensureReelRecord(state, username, shortcode, {
    sourceUrl: reel.url || '',
    mediaUrl: reel.mediaUrl || '',
    thumbnailUrl: reel.thumbnailUrl || '',
    mediaType: reel.mediaType || 'video',
    caption: reel.caption || '',
    lastSeenAt: nowIso(),
    ...patch,
  });
  await writeState(state);
  return clone(record);
}

async function markPinnedSkipped(reel, meta = {}) {
  const username = normalizeUsername(reel?.username);
  const shortcode = String(reel?.shortcode || parseShortcode(reel?.url || '') || '').trim();
  if (!username || !shortcode) return null;

  const state = await readState();
  const record = ensureReelRecord(state, username, shortcode, {
    sourceUrl: reel.url || '',
    mediaUrl: reel.mediaUrl || '',
    thumbnailUrl: reel.thumbnailUrl || '',
    mediaType: reel.mediaType || 'video',
    caption: reel.caption || '',
    lastSeenAt: nowIso(),
    isPinned: true,
    pinnedSkippedAt: nowIso(),
    status: 'skipped_pinned',
  });

  appendLogToState(state, 'info', 'reel.skipped_pinned', `Skipped pinned reel ${shortcode} from @${username}.`, {
    username,
    shortcode,
    ...meta,
  });

  await writeState(state);
  return clone(record);
}

async function hasSuccessfulPost(usernameInput, shortcode) {
  const username = normalizeUsername(usernameInput);
  if (!username || !shortcode) return false;
  const state = await readState();
  const record = state.reels[reelKey(username, shortcode)];
  return !!(record && record.status === 'posted' && record.repostedAt);
}

async function addQueueItems(items = []) {
  const state = await readState();
  const added = [];
  const skipped = [];
  const now = nowIso();

  for (const item of items) {
    const username = normalizeUsername(item.username);
    const shortcode = String(item.shortcode || parseShortcode(item.sourceUrl || '') || '').trim();
    if (!username || !shortcode || !item.mediaUrl) {
      skipped.push({ username, shortcode, reason: 'invalid_item' });
      continue;
    }

    const existingReel = state.reels[reelKey(username, shortcode)];
    if (existingReel?.status === 'posted') {
      skipped.push({ username, shortcode, reason: 'already_posted' });
      continue;
    }

    const queued = state.queue.find((entry) => (
      normalizeUsername(entry.username) === username &&
      String(entry.shortcode || '') === shortcode &&
      ['pending', 'processing'].includes(String(entry.status || '').toLowerCase())
    ));

    if (queued) {
      skipped.push({ username, shortcode, reason: 'already_queued' });
      continue;
    }

    const next = {
      id: item.id || createId('igjob'),
      username,
      shortcode,
      sourceUrl: item.sourceUrl || `https://www.instagram.com/reel/${shortcode}/`,
      mediaUrl: item.mediaUrl,
      thumbnailUrl: item.thumbnailUrl || item.mediaUrl,
      caption: item.caption || '',
      mediaType: item.mediaType || 'video',
      title: item.title || '',
      description: item.description || '',
      altText: item.altText || '',
      externalLink: item.externalLink || '',
      boardName: item.boardName || '',
      productInfo: item.productInfo || null,
      aiContent: item.aiContent || null,
      status: 'pending',
      addedAt: now,
      updatedAt: now,
      scheduledAfter: normalizeScheduledAfter(item.scheduledAfter) || now,
      attempts: 0,
      maxAttempts: Math.max(1, Number.parseInt(item.maxAttempts, 10) || 3),
      lastError: null,
      processingAt: null,
      completedAt: null,
      failedAt: null,
      validationJob: !!item.validationJob,
      reason: item.reason || 'scheduled_scan',
    };

    state.queue.push(next);
    ensureReelRecord(state, username, shortcode, {
      sourceUrl: next.sourceUrl,
      mediaUrl: next.mediaUrl,
      thumbnailUrl: next.thumbnailUrl,
      mediaType: next.mediaType,
      caption: next.caption,
      status: 'queued',
      queueItemId: next.id,
      lastSeenAt: now,
    });
    added.push(clone(next));
  }

  if (added.length > 0) {
    state.queue.sort((a, b) => {
      if (!!a.validationJob !== !!b.validationJob) return a.validationJob ? -1 : 1;
      const aTs = new Date(a.scheduledAfter || a.addedAt || 0).getTime();
      const bTs = new Date(b.scheduledAfter || b.addedAt || 0).getTime();
      return aTs - bTs;
    });
    appendLogToState(state, 'info', 'queue.added', `Queued ${added.length} IG repost job(s).`, {
      added: added.map((item) => ({ username: item.username, shortcode: item.shortcode })),
      skipped,
    });
    await writeState(state);
  }

  return { added, skipped };
}

async function resetStuckProcessingItems(maxAgeMs = 2 * 60 * 60 * 1000) {
  const state = await readState();
  const now = Date.now();
  let changed = 0;

  state.queue = state.queue.map((item) => {
    if (String(item.status || '') !== 'processing') return item;
    const started = new Date(item.processingAt || item.updatedAt || item.addedAt || 0).getTime();
    if (!Number.isFinite(started) || (now - started) < maxAgeMs) return item;

    changed += 1;
    return {
      ...item,
      status: 'pending',
      updatedAt: nowIso(),
      processingAt: null,
      lastError: 'Recovered stale processing job',
    };
  });

  if (changed > 0) {
    appendLogToState(state, 'warn', 'queue.recovered', `Recovered ${changed} stale IG repost job(s).`, {
      changed,
    });
    await writeState(state);
  }

  return changed;
}

async function claimNextReadyQueueItem(options = {}) {
  const state = await readState();
  const now = Date.now();
  const filterUsername = normalizeUsername(options.username || '');

  let chosenIndex = -1;
  for (let i = 0; i < state.queue.length; i += 1) {
    const item = state.queue[i];
    if (String(item.status || '') !== 'pending') continue;
    if (filterUsername && normalizeUsername(item.username) !== filterUsername) continue;
    const scheduledAt = new Date(item.scheduledAfter || item.addedAt || 0).getTime();
    if (Number.isFinite(scheduledAt) && scheduledAt > now) continue;
    if (chosenIndex === -1) {
      chosenIndex = i;
      continue;
    }
    const chosen = state.queue[chosenIndex];
    if (!!item.validationJob !== !!chosen.validationJob) {
      if (item.validationJob) chosenIndex = i;
      continue;
    }
    const chosenTime = new Date(chosen.scheduledAfter || chosen.addedAt || 0).getTime();
    if (scheduledAt < chosenTime) chosenIndex = i;
  }

  if (chosenIndex === -1) return null;

  const item = state.queue[chosenIndex];
  const nowStamp = nowIso();
  state.queue[chosenIndex] = {
    ...item,
    status: 'processing',
    attempts: Number(item.attempts || 0) + 1,
    updatedAt: nowStamp,
    processingAt: nowStamp,
    lastError: null,
  };

  ensureReelRecord(state, item.username, item.shortcode, {
    status: 'processing',
    queueItemId: item.id,
    lastAttemptAt: nowStamp,
    retryCount: Math.max(0, Number(state.reels[reelKey(item.username, item.shortcode)]?.retryCount || 0)),
  });

  await writeState(state);
  return clone(state.queue[chosenIndex]);
}

async function completeQueueItem(itemId, result = {}) {
  const state = await readState();
  const index = state.queue.findIndex((item) => item.id === itemId);
  if (index === -1) return null;
  const item = state.queue[index];
  const completedAt = nowIso();

  state.queue[index] = {
    ...item,
    status: 'completed',
    updatedAt: completedAt,
    completedAt,
    processingAt: null,
    lastError: null,
    publishResult: result,
  };

  const reel = ensureReelRecord(state, item.username, item.shortcode, {
    status: 'posted',
    repostedAt: completedAt,
    queueItemId: item.id,
    lastError: null,
  });

  const postRecord = {
    id: createId('igpost'),
    username: item.username,
    shortcode: item.shortcode,
    sourceUrl: item.sourceUrl,
    title: result.title || item.title || '',
    description: result.description || item.description || '',
    pinUrl: result.pinUrl || '',
    pinId: result.pinId || '',
    affiliateLink: result.externalLink || item.externalLink || null,
    productInfo: result.productInfo || item.productInfo || null,
    boardName: result.boardName || item.boardName || '',
    aiContent: {
      title: result.title || item.title || '',
      description: result.description || item.description || '',
    },
    thumbnailUrl: item.thumbnailUrl || '',
    mediaUrl: item.mediaUrl || '',
    reelData: {
      shortcode: item.shortcode,
      username: item.username,
      caption: item.caption || '',
      thumbnailUrl: item.thumbnailUrl || '',
      mediaUrl: item.mediaUrl || '',
      mediaType: item.mediaType || 'video',
    },
    validationJob: !!item.validationJob,
    reason: item.reason || 'scheduled_scan',
    postedAt: completedAt,
  };

  state.posts.unshift(postRecord);
  state.posts = state.posts.slice(0, MAX_POSTS);

  const account = ensureAccountRecord(state, item.username);
  account.lastSuccessfulPostAt = completedAt;
  account.updatedAt = completedAt;

  state.scheduler.totalPosts = Number(state.scheduler.totalPosts || 0) + 1;

  appendLogToState(state, 'info', 'queue.completed', `Posted reel ${item.shortcode} from @${item.username}.`, {
    username: item.username,
    shortcode: item.shortcode,
    pinUrl: result.pinUrl || '',
  });

  await writeState(state);
  writeLookIndex(postRecord).catch(() => {});
  return clone({ ...state.queue[index], reel });
}

async function failQueueItem(itemId, error, options = {}) {
  const state = await readState();
  const index = state.queue.findIndex((item) => item.id === itemId);
  if (index === -1) return null;
  const item = state.queue[index];
  const now = nowIso();
  const message = String(error || 'Unknown error');
  const attempts = Number(item.attempts || 0);
  const shouldRetry = attempts < Math.max(1, Number.parseInt(item.maxAttempts, 10) || 3) && options.retry !== false;
  const nextRetryAt = shouldRetry ? normalizeScheduledAfter(options.nextRetryAt || now) : null;

  state.queue[index] = {
    ...item,
    status: shouldRetry ? 'pending' : 'failed',
    updatedAt: now,
    processingAt: null,
    failedAt: shouldRetry ? item.failedAt || null : now,
    scheduledAfter: shouldRetry ? nextRetryAt : item.scheduledAfter,
    lastError: message,
  };

  const reel = ensureReelRecord(state, item.username, item.shortcode, {
    status: shouldRetry ? 'retry_scheduled' : 'failed',
    queueItemId: item.id,
    lastAttemptAt: now,
    lastError: message,
    retryCount: shouldRetry
      ? Math.max(1, Number(state.reels[reelKey(item.username, item.shortcode)]?.retryCount || 0) + 1)
      : Math.max(0, Number(state.reels[reelKey(item.username, item.shortcode)]?.retryCount || 0)),
    failureCount: Math.max(1, Number(state.reels[reelKey(item.username, item.shortcode)]?.failureCount || 0) + 1),
  });

  appendLogToState(state, shouldRetry ? 'warn' : 'error', 'queue.failed', `Failed reel ${item.shortcode} from @${item.username}.`, {
    username: item.username,
    shortcode: item.shortcode,
    error: message,
    shouldRetry,
    nextRetryAt,
  });

  await writeState(state);
  return clone({ ...state.queue[index], reel, shouldRetry, nextRetryAt });
}

async function getQueueStats() {
  const state = await readState();
  const now = Date.now();
  const pending = state.queue.filter((item) => item.status === 'pending').length;
  const processing = state.queue.filter((item) => item.status === 'processing').length;
  const failed = state.queue.filter((item) => item.status === 'failed').length;
  const completed = state.queue.filter((item) => item.status === 'completed').length;
  const scheduled = state.queue.filter((item) => (
    item.status === 'pending' &&
    new Date(item.scheduledAfter || item.addedAt || 0).getTime() > now
  )).length;
  return {
    total: state.queue.length,
    pending,
    ready: pending - scheduled,
    scheduled,
    processing,
    failed,
    completed,
  };
}

async function appendLog(level, type, message, meta = {}) {
  const state = await readState();
  appendLogToState(state, level, type, message, meta);
  await writeState(state);
}

async function acquireRunLock(owner, ttlMs = 90 * 60 * 1000) {
  const state = await readState();
  const now = Date.now();
  const lock = state.scheduler.lock;
  const expiresAt = lock?.expiresAt ? new Date(lock.expiresAt).getTime() : 0;

  if (lock?.owner && expiresAt > now && lock.owner !== owner) {
    return { acquired: false, lock: clone(lock) };
  }

  state.scheduler.lock = {
    owner,
    acquiredAt: nowIso(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
  await writeState(state);
  return { acquired: true, lock: clone(state.scheduler.lock) };
}

async function releaseRunLock(owner) {
  const state = await readState();
  if (state.scheduler.lock?.owner === owner) {
    state.scheduler.lock = null;
    await writeState(state);
    return true;
  }
  return false;
}

async function markRunStarted(runId, meta = {}) {
  const state = await readState();
  state.scheduler.lastWakeAt = nowIso();
  state.scheduler.lastRunStartedAt = nowIso();
  state.scheduler.lastRunStatus = 'running';
  state.scheduler.lastRunId = runId;
  state.scheduler.lastError = null;
  state.scheduler.totalRuns = Number(state.scheduler.totalRuns || 0) + 1;
  if (meta.dispatchedAt) state.scheduler.lastDispatchAt = meta.dispatchedAt;
  appendLogToState(state, 'info', 'scheduler.started', `IG repost pipeline started (${runId}).`, meta);
  await writeState(state);
}

async function markRunCompleted(runId, status, meta = {}) {
  const state = await readState();
  state.scheduler.lastRunCompletedAt = nowIso();
  state.scheduler.lastRunStatus = status;
  if (meta.error) state.scheduler.lastError = String(meta.error);
  if (meta.scans) state.scheduler.totalScans = Number(state.scheduler.totalScans || 0) + Number(meta.scans || 0);
  appendLogToState(state, status === 'success' ? 'info' : 'error', 'scheduler.completed', `IG repost pipeline finished (${runId}) with status ${status}.`, meta);
  await writeState(state);
}

async function markDispatch(meta = {}) {
  const state = await readState();
  state.scheduler.lastDispatchAt = nowIso();
  appendLogToState(state, 'info', 'scheduler.dispatched', 'Dispatched IG repost pipeline workflow.', meta);
  await writeState(state);
}

async function getLookDataByShortcode(shortcodeInput) {
  const shortcode = normalizeShortcode(shortcodeInput);
  if (!shortcode) return null;

  const indexed = await storageService.getJsonKey(`${LOOK_INDEX_PREFIX}${shortcode}`);
  if (indexed && typeof indexed === 'object') {
    return indexed;
  }

  const state = await readState();

  const postRecord = state.posts.find((post) => (
    normalizeShortcode(post.shortcode) === shortcode ||
    normalizeShortcode(post?.reelData?.shortcode) === shortcode ||
    String(post.sourceUrl || '').includes(shortcode)
  ));
  if (postRecord) {
    return buildLookPayload(postRecord);
  }

  const queueRecord = state.queue.find((item) => (
    normalizeShortcode(item.shortcode) === shortcode ||
    String(item.sourceUrl || '').includes(shortcode)
  ));
  if (queueRecord) {
    return buildLookPayload({
      id: queueRecord.id,
      shortcode: queueRecord.shortcode,
      title: queueRecord.title,
      description: queueRecord.description,
      thumbnailUrl: queueRecord.thumbnailUrl,
      mediaUrl: queueRecord.mediaUrl,
      affiliateLink: queueRecord.externalLink || null,
      productInfo: queueRecord.productInfo || null,
      boardName: queueRecord.boardName || '',
      aiContent: queueRecord.aiContent || null,
      createdAt: queueRecord.completedAt || queueRecord.updatedAt || queueRecord.addedAt,
      reelData: {
        shortcode: queueRecord.shortcode,
        username: queueRecord.username,
        caption: queueRecord.caption || '',
        thumbnailUrl: queueRecord.thumbnailUrl || '',
        mediaUrl: queueRecord.mediaUrl || '',
        mediaType: queueRecord.mediaType || 'video',
      },
    });
  }

  const reelRecord = state.reels[Object.keys(state.reels).find((key) => (
    normalizeShortcode(state.reels[key]?.shortcode) === shortcode
  ))];

  if (!reelRecord) return null;

  return buildLookPayload({
    id: reelRecord.queueItemId || createId('iglook'),
    shortcode: reelRecord.shortcode,
    title: '',
    description: reelRecord.caption || '',
    thumbnailUrl: reelRecord.thumbnailUrl || '',
    mediaUrl: reelRecord.mediaUrl || '',
    createdAt: reelRecord.updatedAt || reelRecord.firstSeenAt,
    reelData: {
      shortcode: reelRecord.shortcode,
      username: reelRecord.username,
      caption: reelRecord.caption || '',
      thumbnailUrl: reelRecord.thumbnailUrl || '',
      mediaUrl: reelRecord.mediaUrl || '',
      mediaType: reelRecord.mediaType || 'video',
    },
  });
}

async function getStatus() {
  const state = await readState();
  return {
    channels: Object.values(state.accounts)
      .sort((a, b) => String(a.username || '').localeCompare(String(b.username || ''))),
    channelCount: Object.keys(state.accounts).length,
    queue: await getQueueStats(),
    scheduler: state.scheduler,
    storage: storageService.getStorageInfo(),
    recentLogs: state.logs.slice(0, 20),
    totalReelsTracked: Object.keys(state.reels).length,
    totalPosts: state.posts.length,
  };
}

module.exports = {
  normalizeUsername,
  parseShortcode,
  reelKey,
  listAccounts,
  getAccount,
  addAccount,
  removeAccount,
  setAccountProfilePic,
  markAccountValidationStarted,
  markAccountActive,
  markAccountFailed,
  noteAccountScan,
  upsertReelMeta,
  markPinnedSkipped,
  hasSuccessfulPost,
  addQueueItems,
  resetStuckProcessingItems,
  claimNextReadyQueueItem,
  completeQueueItem,
  failQueueItem,
  getQueueStats,
  appendLog,
  acquireRunLock,
  releaseRunLock,
  markRunStarted,
  markRunCompleted,
  markDispatch,
  getLookDataByShortcode,
  getStatus,
};

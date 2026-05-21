const aiService = require('./aiService');
const pinterestService = require('./pinterestService');
const queueService = require('./pinterestImageQueueService');
const stateService = require('./pinterestImageStateService');
const storageService = require('./pinterestImageStorageService');
const contentFilter = require('./pinterestImageContentFilterService');

const DEFAULT_MAX_POSTS = 6;
let boardCache = null;

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanText(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().substring(0, max);
}

function buildHourlySlotKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}`;
}

function normalizeBoardName(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getBoardCache() {
  if (boardCache) return boardCache;
  try {
    const boards = await pinterestService.getBoards();
    boardCache = Array.isArray(boards) ? boards : [];
  } catch (err) {
    console.warn('[Pinterest Image Publish] Board lookup failed:', err.message);
    boardCache = [];
  }
  return boardCache;
}

async function resolveTargetBoard(pin = {}, options = {}) {
  const fallbackBoardId = options.boardId
    || process.env.PINTEREST_IMAGE_TARGET_BOARD
    || process.env.PINTEREST_TARGET_BOARD
    || '';
  const preferredName = process.env.PINTEREST_IMAGE_BOARD_NAME || 'pinss';
  const cleanPreferredName = normalizeBoardName(preferredName);

  if (!cleanPreferredName) {
    return { boardId: fallbackBoardId, boardName: '' };
  }

  const boards = await getBoardCache();
  const exact = boards.find((board) => normalizeBoardName(board.name) === cleanPreferredName);
  if (exact?.id) {
    return { boardId: exact.id, boardName: exact.name || preferredName };
  }

  const loose = boards.find((board) => {
    const cleanName = normalizeBoardName(board.name);
    return cleanName && (
      cleanName.includes(cleanPreferredName) ||
      cleanPreferredName.includes(cleanName)
    );
  });
  if (loose?.id) {
    return { boardId: loose.id, boardName: loose.name || preferredName };
  }

  if (preferredName) {
    console.warn(`[Pinterest Image Publish] Board "${preferredName}" not found. Falling back to configured board ID.`);
  }
  return { boardId: fallbackBoardId, boardName: preferredName };
}

function getPreferredBoardName() {
  return process.env.PINTEREST_IMAGE_BOARD_NAME || 'pinss';
}

function getActiveSourceOrder(state = {}) {
  const channels = Array.isArray(state.channels) ? state.channels : [];
  const activeChannels = channels
    .filter((channel) => channel && channel.active !== false && channel.status !== 'removed')
    .map((channel) => queueService.normalizeSourceAccount(channel.username))
    .filter(Boolean);
  return Array.from(new Set(activeChannels));
}

function getQueuedSources(state = {}) {
  const queue = Array.isArray(state.queue) ? state.queue : [];
  const sources = new Set();
  for (const pin of queue) {
    const source = queueService.normalizeSourceAccount(pin.sourceAccount);
    if (source) sources.add(source);
  }
  return sources;
}

function pickNextSourceAccount(state = {}) {
  const queuedSources = getQueuedSources(state);
  const channelOrder = getActiveSourceOrder(state);
  const fallbackOrder = Array.from(queuedSources).sort();
  const sourceOrder = channelOrder.length > 0 ? channelOrder : fallbackOrder;
  const eligible = sourceOrder.filter((source) => queuedSources.has(source));

  if (eligible.length === 0) {
    return {
      sourceAccount: '',
      eligibleSources: [],
      lastSourceAccount: queueService.normalizeSourceAccount(state.publisher?.lastSourceAccount),
    };
  }

  const lastSourceAccount = queueService.normalizeSourceAccount(state.publisher?.lastSourceAccount);
  const lastIndex = eligible.indexOf(lastSourceAccount);
  const nextIndex = lastIndex >= 0 ? (lastIndex + 1) % eligible.length : 0;

  return {
    sourceAccount: eligible[nextIndex],
    eligibleSources: eligible,
    lastSourceAccount,
  };
}

async function getScheduledPublishPlan(options = {}) {
  const explicitSourceAccount = queueService.normalizeSourceAccount(options.sourceAccount);
  const scheduledRun = options.scheduledRun === true;
  const slotKey = buildHourlySlotKey();
  const state = await storageService.loadState();
  const publisherState = state.publisher || {};

  if (scheduledRun && !explicitSourceAccount && publisherState.lastSlotKey === slotKey) {
    return {
      skipped: true,
      slotKey,
      reason: 'already_published_this_hour',
      sourceAccount: publisherState.lastSourceAccount || '',
      publisher: publisherState,
    };
  }

  if (explicitSourceAccount) {
    return {
      skipped: false,
      slotKey,
      sourceAccount: explicitSourceAccount,
      explicitSource: true,
      eligibleSources: [],
      lastSourceAccount: queueService.normalizeSourceAccount(publisherState.lastSourceAccount),
    };
  }

  const rotation = pickNextSourceAccount(state);
  return {
    skipped: false,
    slotKey,
    ...rotation,
  };
}

async function markScheduledPublishSlot(plan, result) {
  if (!plan?.slotKey || plan.explicitSource) return;

  const state = await storageService.loadState();
  state.publisher = {
    ...(state.publisher || {}),
    lastSlotKey: plan.slotKey,
    lastRunAt: new Date().toISOString(),
    lastSourceAccount: plan.sourceAccount || state.publisher?.lastSourceAccount || '',
    lastResult: {
      attempted: result.attempted,
      posted: result.posted,
      failed: result.failed,
      deferred: result.deferred,
      skipped: result.skipped,
    },
    rotationSources: plan.eligibleSources || [],
  };
  await storageService.saveState(state);
}

async function resolvePostingMethod() {
  const configured = String(process.env.PINTEREST_IMAGE_POSTING_METHOD || process.env.PINTEREST_POSTING_METHOD || 'auto').trim().toLowerCase();
  if (['api', 'pinterest_api'].includes(configured)) return 'api';
  if (['bot', 'browser', 'browser_bot'].includes(configured)) return 'browser_bot';

  try {
    const historyService = require('./historyService');
    const session = await historyService.getSessionCookie();
    if (session?.hasSession) return 'browser_bot';
  } catch (err) {
    console.warn('[Pinterest Image Publish] Session lookup failed:', err.message);
  }

  return 'api';
}

async function createPinWithBrowserBot(pin, content, targetBoard) {
  const { createPinWithBot } = require('./puppeteerService');
  if (!createPinWithBot) {
    throw new Error('Pinterest browser bot is not available in this runtime. Run publisher in GitHub Actions.');
  }

  const mediaUrl = Array.isArray(pin.imageUrls) ? pin.imageUrls[0] : '';
  if (!mediaUrl) throw new Error(`Pin ${pin.pinId || pin.sourcePinId || ''} has no image URL for bot upload.`);

  const botResult = await createPinWithBot({
    title: content.title,
    description: content.description,
    alt_text: content.altText || '',
    link: content.link || '',
    boardName: targetBoard.boardName || getPreferredBoardName(),
    media_source: {
      url: mediaUrl,
    },
  });

  const pinId = botResult?.pin?.id || botResult?.id || `bot_${Date.now()}`;
  const pinUrl = botResult?.pin?.url || botResult?.url || '';
  return {
    id: pinId,
    url: pinUrl,
    isDemoMode: false,
    method: 'browser_bot',
  };
}

async function publishPin(pin, options = {}) {
  const pinId = String(pin.pinId || pin.sourcePinId || '').trim();
  if (!pinId) throw new Error('Queued pin is missing pinId.');
  if (!Array.isArray(pin.imageUrls) || pin.imageUrls.length === 0) {
    throw new Error(`Pin ${pinId} has no image URLs.`);
  }

  const aiResult = await aiService.generatePinterestContent({
    caption: `${pin.title || ''} ${pin.description || ''}`.trim(),
    username: pin.sourceAccount || 'pinterest',
    mediaType: 'image',
  });

  const title = cleanText(aiResult.title || pin.title || 'Pinterest Inspiration', 100);
  const description = cleanText(aiResult.description || pin.description || '', 800);
  const hashtags = Array.isArray(aiResult.hashtags) ? aiResult.hashtags : [];
  const link = pin.link || '';
  const postingMethod = await resolvePostingMethod();
  const content = { title, description, altText: pin.altText || '', link };
  let targetBoard;
  let result;

  if (postingMethod === 'browser_bot') {
    targetBoard = {
      boardId: '',
      boardName: getPreferredBoardName(),
    };
    result = await createPinWithBrowserBot(pin, content, targetBoard);
  } else {
    targetBoard = await resolveTargetBoard(pin, options);
    result = await pinterestService.createPin({
      title,
      description,
      hashtags,
      imageUrls: pin.imageUrls,
      link,
      boardId: targetBoard.boardId,
    });

    if (result?.isDemoMode && process.env.PINTEREST_IMAGE_ALLOW_DEMO !== 'true') {
      throw new Error('Pinterest API token missing; demo pin was not recorded as posted.');
    }
  }

  await stateService.markPosted(pinId, result.id, {
    pinUrl: result.url || '',
    sourceAccount: pin.sourceAccount || '',
    bridgeLink: link,
    title,
    method: result.method || postingMethod,
    sourceBoardName: pin.boardName || '',
    targetBoardName: targetBoard.boardName || '',
    targetBoardId: targetBoard.boardId || '',
  });
  await stateService.appendLog('publish.completed', `Published Pinterest image pin ${pinId}.`, {
    pinId,
    newPinId: result.id,
    pinUrl: result.url || '',
    sourceAccount: pin.sourceAccount || '',
    sourceBoardName: pin.boardName || '',
    targetBoardName: targetBoard.boardName || '',
    method: result.method || postingMethod,
  });

  return {
    ...result,
    title,
    description,
    targetBoard,
    originalPinId: pinId,
  };
}

async function publishNextBatch(options = {}) {
  const maxPosts = Math.max(1, toInt(options.maxPosts || process.env.PINTEREST_IMAGE_MAX_POSTS_PER_RUN, DEFAULT_MAX_POSTS));
  const maxAttempts = Math.max(1, toInt(process.env.PINTEREST_IMAGE_MAX_ATTEMPTS, 3));
  const scheduledRun = options.scheduledRun === true;
  const publishPlan = await getScheduledPublishPlan({
    scheduledRun,
    sourceAccount: options.sourceAccount
      || process.env.PINTEREST_IMAGE_PUBLISH_SOURCE_ACCOUNT
      || process.env.PINTEREST_IMAGE_SOURCE_ACCOUNT,
  });

  if (publishPlan.skipped) {
    return {
      success: true,
      skippedRun: true,
      reason: publishPlan.reason,
      slotKey: publishPlan.slotKey,
      sourceAccount: publishPlan.sourceAccount || '',
      attempted: 0,
      posted: 0,
      failed: 0,
      deferred: 0,
      skipped: 0,
      items: [],
      queue: await queueService.getQueueStats(),
      message: `Pinterest image publisher already ran for hour ${publishPlan.slotKey}.`,
    };
  }

  const sourceAccount = publishPlan.sourceAccount || '';
  const pins = await queueService.popPinsFromQueue(maxPosts, { sourceAccount });
  const failedForRetry = [];
  const items = [];
  let posted = 0;
  let failed = 0;
  let deferred = 0;
  let skipped = 0;

  for (const pin of pins) {
    try {
      const eligibility = contentFilter.evaluatePin(pin);
      if (!eligibility.eligible) {
        skipped += 1;
        await stateService.appendLog('publish.skipped', `Skipped off-niche Pinterest image pin ${pin.pinId}: ${eligibility.keyword || eligibility.reason}.`, {
          pinId: pin.pinId,
          sourceAccount: pin.sourceAccount || '',
          sourceBoardName: pin.boardName || '',
          reason: eligibility.reason,
          keyword: eligibility.keyword || '',
        });
        items.push({
          pinId: pin.pinId,
          status: 'skipped',
          reason: eligibility.reason,
          keyword: eligibility.keyword || '',
        });
        continue;
      }

      const result = await publishPin(pin, options);
      posted += 1;
      items.push({
        pinId: pin.pinId,
        status: 'posted',
        newPinId: result.id,
        pinUrl: result.url || '',
      });
    } catch (err) {
      const attempts = toInt(pin.attempts, 0) + 1;
      const retry = attempts < maxAttempts;
      const failedPin = {
        ...pin,
        attempts,
        lastError: err.message,
        lastAttemptAt: new Date().toISOString(),
      };

      if (retry) {
        deferred += 1;
        failedForRetry.push(failedPin);
      } else {
        failed += 1;
      }

      await stateService.appendLog(retry ? 'publish.retry' : 'publish.failed', `Pinterest image publish failed for ${pin.pinId}: ${err.message}`, {
        pinId: pin.pinId,
        sourceAccount: pin.sourceAccount || '',
        attempts,
        retry,
        error: err.message,
      });
      items.push({
        pinId: pin.pinId,
        status: retry ? 'retry_queued' : 'failed',
        attempts,
        error: err.message,
      });
    }
  }

  if (failedForRetry.length > 0) {
    await queueService.prependPins(failedForRetry);
  }

  const result = {
    success: failed === 0,
    sourceAccount: sourceAccount || '',
    slotKey: publishPlan.slotKey,
    rotation: {
      enabled: scheduledRun && !publishPlan.explicitSource,
      previousSourceAccount: publishPlan.lastSourceAccount || '',
      eligibleSources: publishPlan.eligibleSources || [],
    },
    attempted: pins.length,
    posted,
    failed,
    deferred,
    skipped,
    items,
    queue: await queueService.getQueueStats(),
  };

  if (scheduledRun && !publishPlan.explicitSource) {
    await markScheduledPublishSlot(publishPlan, result);
  }

  return result;
}

module.exports = {
  publishPin,
  publishNextBatch,
};

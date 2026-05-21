const aiService = require('./aiService');
const pinterestService = require('./pinterestService');
const queueService = require('./pinterestImageQueueService');
const stateService = require('./pinterestImageStateService');

const DEFAULT_MAX_POSTS = 6;
let boardCache = null;

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanText(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().substring(0, max);
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
  const pins = await queueService.popPinsFromQueue(maxPosts);
  const failedForRetry = [];
  const items = [];
  let posted = 0;
  let failed = 0;
  let deferred = 0;

  for (const pin of pins) {
    try {
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

  return {
    success: failed === 0,
    attempted: pins.length,
    posted,
    failed,
    deferred,
    items,
    queue: await queueService.getQueueStats(),
  };
}

module.exports = {
  publishPin,
  publishNextBatch,
};

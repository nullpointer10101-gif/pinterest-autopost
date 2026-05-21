const axios = require('axios');
const legacyScraper = require('./pinterestScraperService');
const channelService = require('./pinterestImageChannelService');
const queueService = require('./pinterestImageQueueService');
const stateService = require('./pinterestImageStateService');
const contentFilter = require('./pinterestImageContentFilterService');

const PINTEREST_ORIGIN = 'https://www.pinterest.com';
const VERIFIED_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};
const BOARD_ALLOW_KEYWORDS = [
  'outfit',
  'fashion',
  'style',
  'streetwear',
  'mens',
  "men's",
  'men ',
  'shirt',
  'trouser',
  'pants',
  'college',
  'summer',
  'wardrobe',
  'look',
];

function getAppBaseUrl() {
  const explicit = process.env.APP_BASE_URL || process.env.BASE_URL || '';
  if (explicit) return explicit.replace(/\/+$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`.replace(/\/+$/, '');
  return 'http://localhost:3000';
}

function withBridgeLink(pin, sourceAccount) {
  const pinId = String(pin.pinId || '').trim();
  const bridgeLink = `${getAppBaseUrl()}/bridge/${encodeURIComponent(pinId)}`;
  return {
    ...pin,
    pinId,
    sourcePinId: pinId,
    sourceAccount,
    originalLink: pin.originalLink || pin.link || '',
    link: bridgeLink,
    scrapedAt: new Date().toISOString(),
  };
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'undefined' || value === null || value === '') return fallback;
  const clean = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(clean)) return true;
  if (['0', 'false', 'no', 'off'].includes(clean)) return false;
  return fallback;
}

function extractObjectAfterKey(text, key) {
  const keyIdx = text.indexOf(key);
  if (keyIdx === -1) return null;
  const start = text.indexOf('{', keyIdx + key.length);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

function extractStateMap(html, key) {
  try {
    const raw = extractObjectAfterKey(String(html || ''), `"${key}":`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function fetchPinterestHtml(pathOrUrl) {
  const url = /^https?:\/\//i.test(pathOrUrl)
    ? pathOrUrl
    : `${PINTEREST_ORIGIN}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
  const response = await axios.get(url, {
    headers: VERIFIED_HEADERS,
    timeout: 20000,
    maxRedirects: 5,
  });
  return String(response.data || '');
}

function normalizeBoardName(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isAllowedProfileBoard(board = {}) {
  const name = normalizeBoardName(board.name);
  if (!name) return false;
  return BOARD_ALLOW_KEYWORDS.some((keyword) => name.includes(keyword));
}

function normalizeVerifiedBoard(rawBoard = {}, username = '') {
  const url = String(rawBoard.url || '').trim();
  const name = String(rawBoard.name || '').trim();
  if (!url || !name) return null;
  if (username && !url.toLowerCase().startsWith(`/${username.toLowerCase()}/`)) return null;
  return {
    id: String(rawBoard.id || rawBoard.node_id || url),
    name,
    url,
    pinCount: Number.parseInt(rawBoard.pin_count, 10) || 0,
  };
}

function getImageFromObject(imageObj = {}) {
  return imageObj?.orig?.url
    || imageObj?.originals?.url
    || imageObj?.['1200x']?.url
    || imageObj?.['736x']?.url
    || imageObj?.['474x']?.url
    || imageObj?.['236x']?.url
    || '';
}

function extractPinImageUrls(rawPin = {}) {
  const urls = [];
  const direct = getImageFromObject(rawPin.images || {});
  if (direct) urls.push(direct);

  const pages = rawPin.story_pin_data?.pages || rawPin.story_pin_data?.pages_preview || [];
  for (const page of Array.isArray(pages) ? pages : []) {
    const blocks = page.blocks || [];
    for (const block of Array.isArray(blocks) ? blocks : []) {
      const imageUrl = getImageFromObject(block?.image?.images || {});
      if (imageUrl) urls.push(imageUrl);
    }
  }

  const slots = rawPin.carousel_data?.carousel_slots || [];
  for (const slot of Array.isArray(slots) ? slots : []) {
    const imageUrl = getImageFromObject(slot?.images || {});
    if (imageUrl) urls.push(imageUrl);
  }

  return Array.from(new Set(urls.filter(Boolean)));
}

function normalizeVerifiedPin(rawPin = {}, boardName = '') {
  const pinId = String(rawPin.id || rawPin.pin_id || '').trim();
  if (!pinId) return null;
  const imageUrls = extractPinImageUrls(rawPin);
  if (imageUrls.length === 0) return null;

  return {
    pinId,
    mediaType: rawPin.is_video ? 'video' : 'image',
    mediaUrl: imageUrls[0],
    thumbnailUrl: imageUrls[0],
    imageUrls,
    title: rawPin.title || rawPin.grid_title || '',
    description: rawPin.description || rawPin.unified_user_note || rawPin.seo_alt_text || rawPin.unauth_on_page_description || '',
    link: rawPin.link || rawPin.rich_metadata?.url || rawPin.url || '',
    boardName: rawPin.board?.name || boardName || '',
    createdAt: rawPin.created_at || rawPin.createdAt || null,
    verifiedSource: 'pinterest_html',
  };
}

async function fetchVerifiedProfileBoards(username) {
  const html = await fetchPinterestHtml(`/${username}/`);
  const boardsMap = extractStateMap(html, 'boards');
  const boards = Object.values(boardsMap)
    .map((board) => normalizeVerifiedBoard(board, username))
    .filter(Boolean);
  const unique = new Map();
  for (const board of boards) {
    if (isAllowedProfileBoard(board)) unique.set(board.url, board);
  }
  return Array.from(unique.values());
}

async function fetchVerifiedBoardPins(board) {
  const html = await fetchPinterestHtml(board.url);
  const pinsMap = extractStateMap(html, 'pins');
  return Object.values(pinsMap)
    .map((pin) => normalizeVerifiedPin(pin, board.name))
    .filter((pin) => pin && pin.mediaType === 'image');
}

async function fetchVerifiedProfilePins(username, limit = 2000) {
  const boards = await fetchVerifiedProfileBoards(username);
  const pinsById = new Map();

  for (const board of boards) {
    const boardPins = await fetchVerifiedBoardPins(board);
    for (const pin of boardPins) {
      if (pinsById.size >= limit) break;
      pinsById.set(pin.pinId, pin);
    }
    if (pinsById.size >= limit) break;
  }

  return {
    boards,
    pins: Array.from(pinsById.values()).slice(0, limit),
  };
}

async function fetchLatestImagePins(usernameInput, limit = 2000) {
  const username = channelService.normalizeUsername(usernameInput);
  if (!username) throw new Error('Invalid Pinterest username.');

  let verified = await fetchVerifiedProfilePins(username, limit);
  let pins = verified.pins;

  if (pins.length === 0 && parseBoolean(process.env.PINTEREST_IMAGE_ALLOW_UNVERIFIED_SCRAPER, false)) {
    console.warn('[Pinterest Image Sync] Verified profile scrape returned 0 pins; using unverified fallback because PINTEREST_IMAGE_ALLOW_UNVERIFIED_SCRAPER=true.');
    pins = await legacyScraper.fetchViaPuppeteer(username, limit);
    if (pins.length < 5) {
      const htmlPins = await legacyScraper.fetchViaHtml(username);
      if (htmlPins.length > pins.length) pins = htmlPins;
    }
  }

  const rawImagePins = pins
    .filter((pin) => pin?.mediaType === 'image' && Array.isArray(pin.imageUrls) && pin.imageUrls.length > 0)
    .slice(0, limit)
    .map((pin) => withBridgeLink(pin, username));
  const { eligible: imagePins, skipped } = contentFilter.filterPins(rawImagePins);

  await stateService.saveScrapedPins(imagePins);
  await channelService.markChannelScan(username, {
    lastScannedAt: new Date().toISOString(),
    status: 'active',
  });

  await stateService.appendLog('scrape.completed', `Scraped ${imagePins.length} eligible Pinterest image pin(s) from @${username}.`, {
    username,
    count: imagePins.length,
    rawCount: rawImagePins.length,
    filtered: skipped.length,
    verifiedSource: true,
    boards: verified.boards.map((board) => ({ name: board.name, url: board.url, pinCount: board.pinCount })),
  });

  if (skipped.length > 0) {
    await stateService.appendLog('scrape.filtered', `Skipped ${skipped.length} off-niche Pinterest image pin(s) from @${username}.`, {
      username,
      count: skipped.length,
      sample: skipped.slice(0, 20),
    });
  }

  return imagePins;
}

async function syncChannel(usernameInput, options = {}) {
  const username = channelService.normalizeUsername(usernameInput);
  const limit = Math.max(1, Number.parseInt(options.limit, 10) || 2000);
  const pins = await fetchLatestImagePins(username, limit);
  const pendingPins = [];
  let alreadyPosted = 0;

  for (const pin of pins) {
    if (await stateService.isPosted(pin.pinId)) {
      alreadyPosted += 1;
      continue;
    }
    pendingPins.push(pin);
  }

  const queueResult = await queueService.addPinsToQueue(pendingPins);
  if (queueResult.added.length > 0) {
    await channelService.markChannelScan(username, {
      lastQueuedAt: new Date().toISOString(),
    });
  }
  await stateService.appendLog('sync.completed', `Queued ${queueResult.added.length} new Pinterest image pin(s) from @${username}.`, {
    username,
    scraped: pins.length,
    queued: queueResult.added.length,
    alreadyPosted,
    skipped: queueResult.skipped.length,
  });

  return {
    username,
    scraped: pins.length,
    queued: queueResult.added.length,
    alreadyPosted,
    skipped: queueResult.skipped,
  };
}

async function syncAll(options = {}) {
  const channels = await channelService.listChannels();
  const activeChannels = channels.filter((channel) => channel.active !== false);
  const results = [];

  for (const channel of activeChannels) {
    try {
      results.push(await syncChannel(channel.username, options));
    } catch (err) {
      await channelService.markChannelScan(channel.username, {
        status: 'error',
        lastError: err.message,
      });
      await stateService.appendLog('sync.failed', `Pinterest image sync failed for @${channel.username}: ${err.message}`, {
        username: channel.username,
        error: err.message,
      });
      results.push({
        username: channel.username,
        scraped: 0,
        queued: 0,
        error: err.message,
      });
    }
  }

  return {
    success: results.every((result) => !result.error),
    channels: activeChannels.length,
    queued: results.reduce((sum, result) => sum + Number(result.queued || 0), 0),
    results,
  };
}

module.exports = {
  fetchLatestImagePins,
  fetchVerifiedProfileBoards,
  fetchVerifiedProfilePins,
  syncChannel,
  syncAll,
};

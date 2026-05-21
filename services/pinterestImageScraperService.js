const legacyScraper = require('./pinterestScraperService');
const channelService = require('./pinterestImageChannelService');
const queueService = require('./pinterestImageQueueService');
const stateService = require('./pinterestImageStateService');

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

async function fetchLatestImagePins(usernameInput, limit = 2000) {
  const username = channelService.normalizeUsername(usernameInput);
  if (!username) throw new Error('Invalid Pinterest username.');

  let pins = await legacyScraper.fetchViaApify(username, limit);
  if (pins.length < 10) {
    const puppeteerPins = await legacyScraper.fetchViaPuppeteer(username, limit);
    if (puppeteerPins.length > pins.length) pins = puppeteerPins;
  }
  if (pins.length < 5) {
    const htmlPins = await legacyScraper.fetchViaHtml(username);
    if (htmlPins.length > pins.length) pins = htmlPins;
  }

  const imagePins = pins
    .filter((pin) => pin?.mediaType === 'image' && Array.isArray(pin.imageUrls) && pin.imageUrls.length > 0)
    .slice(0, limit)
    .map((pin) => withBridgeLink(pin, username));

  await stateService.saveScrapedPins(imagePins);
  await channelService.markChannelScan(username, {
    lastScannedAt: new Date().toISOString(),
    status: 'active',
  });

  await stateService.appendLog('scrape.completed', `Scraped ${imagePins.length} Pinterest image pin(s) from @${username}.`, {
    username,
    count: imagePins.length,
  });

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
  syncChannel,
  syncAll,
};

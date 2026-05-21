#!/usr/bin/env node
require('dotenv').config();

const channelService = require('../services/pinterestImageChannelService');
const scraperService = require('../services/pinterestImageScraperService');
const queueService = require('../services/pinterestImageQueueService');

function readArg(name) {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : '';
}

async function main() {
  const username = process.env.PINTEREST_IMAGE_USERNAME
    || process.env.PINTEREST_TARGET_USERNAME
    || readArg('username');
  const limit = process.env.PINTEREST_IMAGE_SCRAPE_LIMIT || readArg('limit') || 2000;

  console.log('[Pinterest Image Sync] Starting...');
  console.log(username ? `[Pinterest Image Sync] Target: @${username}` : '[Pinterest Image Sync] Target: all active channels');

  const result = username
    ? {
      success: true,
      channels: 1,
      results: [await scraperService.syncChannel(username, { limit })],
    }
    : await scraperService.syncAll({ limit });

  const queue = await queueService.getQueueStats();
  const channels = await channelService.listChannels();

  console.log('[Pinterest Image Sync] Result:');
  console.log(JSON.stringify({
    ...result,
    channelCount: channels.length,
    queue,
  }, null, 2));

  if (!result.success) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[Pinterest Image Sync] Fatal error:', err.message);
    process.exit(1);
  });
}

module.exports = { main };

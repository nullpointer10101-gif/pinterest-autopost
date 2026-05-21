#!/usr/bin/env node
require('dotenv').config();

const channelService = require('../services/pinterestImageChannelService');
const queueService = require('../services/pinterestImageQueueService');
const stateService = require('../services/pinterestImageStateService');

async function main() {
  const [channels, queue, state] = await Promise.all([
    channelService.listChannels(),
    queueService.getQueueStats(),
    stateService.getStats(),
  ]);

  console.log(JSON.stringify({
    channels,
    queue,
    ...state,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[Pinterest Image Status] Fatal error:', err.message);
    process.exit(1);
  });
}

module.exports = { main };

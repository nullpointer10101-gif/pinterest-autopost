#!/usr/bin/env node
require('dotenv').config();

const publisherService = require('../services/pinterestImagePublisherService');

function readArg(name) {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : '';
}

async function main() {
  const isScheduledRun = process.env.GITHUB_EVENT_NAME === 'schedule';
  const autoPublishSetting = String(process.env.PINTEREST_IMAGE_AUTO_PUBLISH_ENABLED || '').trim().toLowerCase();
  const autoPublishDisabled = ['0', 'false', 'no', 'off'].includes(autoPublishSetting);
  if (isScheduledRun && autoPublishDisabled) {
    console.log('[Pinterest Image Publish] Scheduled auto-publish is paused because PINTEREST_IMAGE_AUTO_PUBLISH_ENABLED=false.');
    return;
  }

  const maxPosts = process.env.PINTEREST_IMAGE_MAX_POSTS_PER_RUN || readArg('max') || 6;

  console.log('[Pinterest Image Publish] Starting...');
  console.log(`[Pinterest Image Publish] Max posts this run: ${maxPosts}`);

  const result = await publisherService.publishNextBatch({ maxPosts });

  console.log('[Pinterest Image Publish] Result:');
  console.log(JSON.stringify(result, null, 2));

  if (result.attempted > 0 && result.posted === 0 && (result.failed > 0 || result.deferred > 0)) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[Pinterest Image Publish] Fatal error:', err.message);
    process.exit(1);
  });
}

module.exports = { main };

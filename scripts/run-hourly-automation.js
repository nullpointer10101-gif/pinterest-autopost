#!/usr/bin/env node
require('dotenv').config();

const automationService = require('../services/automationService');

async function main() {
  console.log('[Automation] Starting Hourly Pipeline...');
  console.log('[Automation] Instagram scraping/reposting is handled by the isolated IG repost pipeline.');

  try {
    const queueService = require('../services/queueService');
    const retried = await queueService.retryFailedItems();
    if (retried > 0) {
      console.log(`[Automation] Automatically reset ${retried} failed items for retry.`);
    }
  } catch (err) {
    console.error('[Automation] Failed to reset retry items:', err.message);
  }

  console.log('[Automation] Processing Queue & Engagement Bot...');
  const result = await automationService.runHourlyAutomation({
    maxPostsPerDay: process.env.AUTOMATION_MAX_POSTS_PER_DAY,
    maxPostsPerRun: process.env.AUTOMATION_MAX_POSTS_PER_RUN,
    engagementCount: process.env.AUTOMATION_ENGAGEMENTS_PER_HOUR,
    engagementNiche: process.env.AUTOMATION_ENGAGEMENT_NICHE || 'all',
    timeZone: process.env.AUTOMATION_TIMEZONE || 'Asia/Calcutta',
    force: process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' || process.argv.includes('--force'),
  });

  console.log('[Automation] Hourly run result:');
  console.log(JSON.stringify(result, null, 2));

  if (!result.success) {
    process.exitCode = 1;
    if (process.env.DISCORD_WEBHOOK_URL) {
      await require('axios').post(process.env.DISCORD_WEBHOOK_URL, {
        content: `Pinterest Automation Failed\nError: ${result.message || 'Unknown failure'}`,
      }).catch(() => {});
    }
  } else if (result.posts?.processed > 0 && process.env.DISCORD_WEBHOOK_URL) {
    await require('axios').post(process.env.DISCORD_WEBHOOK_URL, {
      content: `Pinterest Automation Success\nSuccessfully posted ${result.posts.processed} pin(s).`,
    }).catch(() => {});
  }
}

main().catch(async (err) => {
  console.error('[Automation] Fatal error:', err.message);
  if (process.env.DISCORD_WEBHOOK_URL) {
    await require('axios').post(process.env.DISCORD_WEBHOOK_URL, {
      content: `Pinterest Automation Fatal Crash\nError: ${err.message}`,
    }).catch(() => {});
  }
  process.exit(1);
});

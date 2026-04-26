#!/usr/bin/env node
require('dotenv').config();

const automationService = require('../services/automationService');

async function main() {
  const result = await automationService.runHourlyAutomation({
    maxPostsPerDay: process.env.AUTOMATION_MAX_POSTS_PER_DAY,
    maxPostsPerRun: process.env.AUTOMATION_MAX_POSTS_PER_RUN,
    engagementCount: process.env.AUTOMATION_ENGAGEMENTS_PER_HOUR,
    timeZone: process.env.AUTOMATION_TIMEZONE || 'Asia/Calcutta',
  });

  console.log('[Automation] Hourly run result:');
  console.log(JSON.stringify(result, null, 2));

  if (!result.success) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[Automation] Fatal error:', err.message);
  process.exit(1);
});

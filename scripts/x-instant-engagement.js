require('dotenv').config();
const xPuppeteerService = require('../services/xPuppeteerService');

async function runInstantEngagement() {
  console.log('====================================================');
  console.log(`[X-Instant-Engagement] Start: ${new Date().toISOString()}`);
  console.log('====================================================');

  try {
    const targetCount = parseInt(process.env.X_ENGAGEMENT_COUNT || '3', 10);
    const result = await xPuppeteerService.runAutoEngagerSafe({
      count: targetCount, 
      minGapMs: 10000, 
      maxGapMs: 30000, 
      commentChance: 0.60,
      context: {
        source: process.env.GITHUB_ACTIONS === 'true' ? 'github_actions' : 'local',
        command: 'node scripts/x-instant-engagement.js',
      },
    });

    console.log('\n--- X INSTANT ENGAGEMENT SUMMARY ---');
    console.log(`Success:  ${result.success}`);
    console.log(`Executed: ${result.executed}`);
    console.log(`Message:  ${result.message}`);
    console.log('====================================================\n');
    
    process.exit(0);
  } catch (err) {
    console.error('\n[X-Instant-Engagement ERROR] Fatal error:');
    console.error(err);
    process.exit(1);
  }
}

runInstantEngagement();

require('dotenv').config();
const xAutomationService = require('../services/xAutomationService');

async function main() {
  console.log('====================================================');
  console.log(`[X-Hourly Automation] Start: ${new Date().toISOString()}`);
  console.log('====================================================');

  try {
    const result = await xAutomationService.runHourlyAutomation({ force: false });

    console.log('\n--- X AUTOMATION SUMMARY ---');
    console.log(`Success:    ${result.success}`);
    console.log(`Time Zone:  ${result.timeZone}`);
    console.log(`Date Key:   ${result.dateKey}`);

    if (result.skipped) {
      console.log(`Status:     SKIPPED`);
      console.log(`Reason:     ${result.message}`);
    } else {
      console.log('\n[Posts]');
      console.log(`Max/Day:    ${result.limits?.maxPostsPerDay}`);
      console.log(`Max/Run:    ${result.limits?.maxPostsPerRun}`);
      console.log(`Today:      ${result.posts?.postsToday} (Rem: ${result.limits?.postsRemainingAfterRun})`);
      console.log(`Processed:  ${result.posts?.processed}`);
      
      console.log('\n[Engagement]');
      console.log(`Requested:  ${result.engagement?.requested}`);
      console.log(`Attempted:  ${result.engagement?.attempted}`);
      console.log(`Executed:   ${result.engagement?.executed}`);
      console.log(`Message:    ${result.engagement?.message}`);

      console.log('\n[X Queue Stats]');
      console.log(`Pending:    ${result.queue?.pending}`);
      console.log(`Processing: ${result.queue?.processing}`);
      console.log(`Completed:  ${result.queue?.completed}`);
      console.log(`Failed:     ${result.queue?.failed}`);
      console.log(`Total:      ${result.queue?.total}`);
    }

    console.log('====================================================');
    console.log(`[X-Hourly Automation] End: ${new Date().toISOString()}`);
    console.log('====================================================\n');
    
    process.exit(0);
  } catch (err) {
    console.error('\n[X-Automation ERROR] Fatal error during run:');
    console.error(err);
    process.exit(1);
  }
}

main();

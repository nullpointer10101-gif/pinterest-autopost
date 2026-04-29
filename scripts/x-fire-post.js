require('dotenv').config();
const xQueueService = require('../services/xQueueService');

async function firePost() {
  console.log('====================================================');
  console.log(`[X-Fire-Post] Instant Mission Start: ${new Date().toISOString()}`);
  console.log('====================================================');

  try {
    const queue = await xQueueService.getQueue();
    const pendingCount = queue.filter(i => i.status === 'pending').length;
    console.log(`[X-Fire-Post] Found ${pendingCount} pending items in X queue.`);

    if (pendingCount === 0) {
      console.log('[X-Fire-Post] Nothing to process. Exiting.');
      process.exit(0);
    }

    // Process exactly ONE post per run to keep workflow time low
    const processed = await xQueueService.processNextInQueue();
    
    if (processed) {
      if (processed.status === 'completed') {
        console.log(`[X-Fire-Post] ✅ Successfully posted: ${processed.title || processed.id}`);
      } else {
        console.log(`[X-Fire-Post] ❌ Failed to post: ${processed.error || 'Unknown error'}`);
        process.exit(1); 
      }
    } else {
      console.log('[X-Fire-Post] Processing skipped (already running or none found).');
    }

    console.log('====================================================');
    console.log(`[X-Fire-Post] Instant Mission End: ${new Date().toISOString()}`);
    console.log('====================================================');
    process.exit(0);
  } catch (err) {
    console.error('\n[X-Fire-Post ERROR] Fatal error during instant post:');
    console.error(err);
    process.exit(1);
  }
}

firePost();

#!/usr/bin/env node
/**
 * 🚀 fire-post.js — Schedule-aware instant post runner (v2)
 * 
 * Processes pending queue items that are READY (not scheduled for the future).
 * Respects scheduledAfter timestamps so scheduled items aren't posted early.
 * 
 * Designed to finish in under 60 seconds per post.
 */
require('dotenv').config();

const queueService = require('../services/queueService');

async function main() {
  console.log('[🚀 FirePost v2] Starting...');
  const startMs = Date.now();

  // Show queue status before processing
  const stats = await queueService.getQueueStats();
  console.log(`[🚀 FirePost v2] Queue: ${stats.pending} pending (${stats.ready} ready, ${stats.scheduled} scheduled for later)`);

  let posted = 0;
  let failed = 0;
  let skipped = 0;
  const maxPosts = parseInt(process.env.FIRE_POST_MAX || '5', 10);

  for (let i = 0; i < maxPosts; i++) {
    // processNextInQueue already respects scheduledAfter timestamps
    const result = await queueService.processNextInQueue();
    
    if (!result) {
      console.log('[🚀 FirePost v2] No more ready items in queue.');
      break;
    }

    if (result.status === 'completed') {
      posted++;
      const link = result.destinationLink || result.link || 'no link';
      console.log(`[🚀 FirePost v2] ✅ Posted: "${result.title || result.id}"`);
      console.log(`[🚀 FirePost v2]    Link: ${link}`);
      console.log(`[🚀 FirePost v2]    Shortcode: ${result.shortcode || 'N/A'}`);
    } else if (result.error?.includes('Duplicate')) {
      skipped++;
      console.log(`[🚀 FirePost v2] ⛔ Skipped duplicate: "${result.title || result.id}"`);
    } else {
      failed++;
      console.log(`[🚀 FirePost v2] ❌ Failed: "${result.title || result.id}" — ${result.error}`);
    }
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\n[🚀 FirePost v2] Done in ${elapsed}s — ${posted} posted, ${skipped} skipped (dedup), ${failed} failed.`);

  if (posted === 0 && failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[🚀 FirePost v2] Fatal error:', err.message);
  process.exit(1);
});

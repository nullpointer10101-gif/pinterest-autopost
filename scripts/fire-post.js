#!/usr/bin/env node
/**
 * 🚀 fire-post.js — Ultra-fast single post runner
 * 
 * Grabs the FIRST pending item from the queue and posts it via Puppeteer bot.
 * No daily limits. No engagement. No jitter. No waiting.
 * Designed to finish in under 60 seconds.
 */
require('dotenv').config();

const queueService = require('../services/queueService');

async function main() {
  console.log('[🚀 FirePost] Starting instant post...');
  const startMs = Date.now();

  // Process ALL pending items (instant ones first since they're prepended)
  let posted = 0;
  let failed = 0;
  const maxPosts = parseInt(process.env.FIRE_POST_MAX || '5', 10);

  for (let i = 0; i < maxPosts; i++) {
    const result = await queueService.processNextInQueue();
    
    if (!result) {
      console.log('[🚀 FirePost] No more pending items in queue.');
      break;
    }

    if (result.status === 'completed') {
      posted++;
      console.log(`[🚀 FirePost] ✅ Posted: "${result.title || result.id}"`);
    } else {
      failed++;
      console.log(`[🚀 FirePost] ❌ Failed: "${result.title || result.id}" — ${result.error}`);
    }
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`[🚀 FirePost] Done in ${elapsed}s — ${posted} posted, ${failed} failed.`);

  if (posted === 0 && failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[🚀 FirePost] Fatal error:', err.message);
  process.exit(1);
});

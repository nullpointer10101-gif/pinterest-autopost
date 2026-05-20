#!/usr/bin/env node
require('dotenv').config();

/**
 * pinterest:publish  ─  run-pinterest-pipeline.js
 *
 * Pops up to MAX_POSTS pins from the persistent queue, rewrites them
 * with AI, and publishes them to your Pinterest account.
 *
 * Runs every hour via GitHub Actions (6 pins/hr → ~144 pins/day).
 * Failed pins are pushed back to the FRONT of the queue so they retry next run.
 */

const fs   = require('fs/promises');
const path = require('path');

const pinterestQueueService      = require('../services/pinterestQueueService');
const pinterestRepostStateService = require('../services/pinterestRepostStateService');
const pinterestService           = require('../services/pinterestService');
const aiService                  = require('../services/aiService');

const MAX_POSTS   = 6;   // pins published per hourly run
const POST_DELAY  = 5000; // ms between each post (looks more natural)

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('[Pinterest-Pipeline] ─────────────────────────────────────────');
  console.log('[Pinterest-Pipeline] Starting hourly publisher (max 6 pins)...');

  const queueLength = await pinterestQueueService.getQueueLength();
  console.log(`[Pinterest-Pipeline] Queue currently has ${queueLength} pins waiting.`);

  if (queueLength === 0) {
    console.log('[Pinterest-Pipeline] ⚠️  Queue is EMPTY.');
    console.log('[Pinterest-Pipeline] Run "npm run pinterest:sync" (or trigger the Ingestor workflow) to fill it.');
    process.exit(0);
  }

  const pinsToProcess = await pinterestQueueService.popPinsFromQueue(MAX_POSTS);
  console.log(`[Pinterest-Pipeline] Popped ${pinsToProcess.length} pin(s) from queue.`);

  const targetBoard   = process.env.PINTEREST_TARGET_BOARD || '';
  const failedPins    = [];

  let postedCount = 0;
  let failCount   = 0;

  for (let i = 0; i < pinsToProcess.length; i++) {
    const pin = pinsToProcess[i];
    console.log(`\n[Pinterest-Pipeline] [${i + 1}/${pinsToProcess.length}] Processing pin ${pin.pinId}...`);

    try {
      // ── Step 1: Rewrite with AI ──────────────────────────────────────────
      const aiResult = await aiService.generatePinterestContent({
        caption  : `${pin.title || ''} ${pin.description || ''}`.trim(),
        username : pin.sourceAccount || 'creator',
        mediaType: 'image',
      });

      const title       = (aiResult.title       || pin.title       || 'Inspiration').substring(0, 100);
      const description = (aiResult.description || pin.description || '').substring(0, 800);
      const hashtags    = aiResult.tags || [];

      // ── Step 2: Publish ───────────────────────────────────────────────────
      console.log(`[Pinterest-Pipeline] Publishing "${title}" (${pin.imageUrls?.length || 1} image(s))...`);
      const publishedPin = await pinterestService.createPin({
        title,
        description,
        hashtags,
        imageUrls : pin.imageUrls,
        link      : pin.link, // bridge page URL
        boardId   : targetBoard,
      });

      if (publishedPin) {
        const url = publishedPin.url || publishedPin.id;
        const tag = publishedPin.isDemoMode ? '[DEMO]' : '[LIVE]';
        console.log(`[Pinterest-Pipeline] ${tag} Posted → ${url}`);
        await pinterestRepostStateService.markAsReposted(pin.pinId, publishedPin.id);
        postedCount++;
      }
    } catch (err) {
      console.error(`[Pinterest-Pipeline] ❌ Failed to post pin ${pin.pinId}:`, err.message);
      failedPins.push(pin); // will be re-queued at front
      failCount++;
    }

    // Jitter between posts so it looks human
    if (i < pinsToProcess.length - 1) {
      await sleep(POST_DELAY);
    }
  }

  // ── Re-queue failed pins at the FRONT so they retry next run ─────────────
  if (failedPins.length > 0) {
    const currentQueue = await pinterestQueueService.loadQueue();
    const combined = [...failedPins, ...currentQueue];
    await pinterestQueueService.saveQueue(combined);
    console.log(`\n[Pinterest-Pipeline] ↩️  ${failedPins.length} failed pin(s) pushed back to front of queue.`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const remainingQueue = await pinterestQueueService.getQueueLength();
  console.log('\n[Pinterest-Pipeline] ═════════════════════════════════════════');
  console.log(`[Pinterest-Pipeline] ✅ Posted   : ${postedCount}`);
  console.log(`[Pinterest-Pipeline] ❌ Failed   : ${failCount}`);
  console.log(`[Pinterest-Pipeline] 🗂️  In Queue : ${remainingQueue} pins remaining`);
  console.log('[Pinterest-Pipeline] ═════════════════════════════════════════');

  if (postedCount === 0 && failCount > 0) {
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('[Pinterest-Pipeline] Fatal error:', err.message);
  process.exit(1);
});

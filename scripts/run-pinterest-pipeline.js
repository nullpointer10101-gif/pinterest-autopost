#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const pinterestScraperService = require('../services/pinterestScraperService');
const pinterestRepostStateService = require('../services/pinterestRepostStateService');
const pinterestService = require('../services/pinterestService');
const aiService = require('../services/aiService');

const ACCOUNTS_FILE = path.join(__dirname, '..', 'data', 'pinterest-accounts.json');

async function loadAccounts() {
  try {
    const data = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
    return JSON.parse(data).filter(acc => acc.active !== false);
  } catch (err) {
    console.warn('[Pinterest-Pipeline] Warning: Could not read pinterest-accounts.json. Please create it.');
    return [];
  }
}

async function main() {
  console.log('[Pinterest-Pipeline] Starting robust Pinterest-to-Pinterest auto-poster...');

  // 1. Determine targets
  let targets = [];
  const envTarget = process.env.PINTEREST_TARGET_USERNAME || process.argv[2];
  if (envTarget) {
    targets = [{ username: envTarget, active: true }];
  } else {
    targets = await loadAccounts();
  }

  if (targets.length === 0) {
    console.log('[Pinterest-Pipeline] No active accounts to scrape. Exiting.');
    process.exit(0);
  }

  console.log(`[Pinterest-Pipeline] Found ${targets.length} target(s).`);

  const results = {
    totalAccounts: targets.length,
    successes: 0,
    failures: 0,
    totalPinsScraped: 0,
    totalPinsReposted: 0,
    details: []
  };

  const pinterestQueueService = require('../services/pinterestQueueService');
  
  // 2. Process from Queue
  console.log(`\n-----------------------------------------`);
  console.log(`[Pinterest-Pipeline] Checking Queue...`);
  
  const MAX_POSTS = 6; // Limit posts per run to avoid spam
  let postedCount = 0;
  const targetBoard = process.env.PINTEREST_TARGET_BOARD || '';

  try {
    const pinsToProcess = await pinterestQueueService.popPinsFromQueue(MAX_POSTS);

    if (pinsToProcess.length === 0) {
      console.log(`[Pinterest-Pipeline] Queue is empty. Please run sync-pinterest-queue.js to fetch more pins.`);
    } else {
      console.log(`[Pinterest-Pipeline] Popped ${pinsToProcess.length} pins from queue to process.`);

      for (const pin of pinsToProcess) {
        console.log(`[Pinterest-Pipeline] Reposting Pin ID: ${pin.pinId}...`);
        
        // 1. Generate new content using AI
        const aiResult = await aiService.generatePinterestContent({
          caption: `${pin.title} ${pin.description}`,
          username: pin.sourceAccount || 'creator',
          mediaType: 'image'
        });

        // 2. Publish to our Pinterest account
        const publishedPin = await pinterestService.createPin({
          title: aiResult.title || pin.title || 'Inspiration',
          description: aiResult.description || pin.description || '',
          hashtags: aiResult.tags || [],
          imageUrls: pin.imageUrls,
          link: pin.link, // Overridden link to Bridge Page
          boardId: targetBoard
        });

        if (publishedPin && !publishedPin.isDemoMode) {
          console.log(`[Pinterest-Pipeline] Successfully posted to Pinterest! New Pin URL: ${publishedPin.url}`);
          await pinterestRepostStateService.markAsReposted(pin.pinId, publishedPin.id);
          postedCount++;
        } else if (publishedPin && publishedPin.isDemoMode) {
          console.log(`[Pinterest-Pipeline] Demo Mode Post Simulated: ${publishedPin.url}`);
          await pinterestRepostStateService.markAsReposted(pin.pinId, publishedPin.id);
          postedCount++;
        }
        
        // Jitter between posts
        await new Promise(r => setTimeout(r, 4000));
      }
      
      results.successes += postedCount;
      results.totalPinsReposted += postedCount;
      results.details.push({ status: 'success', repostedCount: postedCount });
    }
  } catch (err) {
    console.error(`[Pinterest-Pipeline] Error during pipeline execution:`, err.message);
    results.failures++;
    results.details.push({ status: 'failed', error: err.message });
  }

  // 3. Summarize
  console.log(`\n=========================================`);
  console.log('[Pinterest-Pipeline] Pipeline Run Summary:');
  console.log(JSON.stringify(results, null, 2));

  if (results.failures > 0 && results.successes === 0) {
    console.error('[Pinterest-Pipeline] Pipeline finished with ALL FAILURES.');
    process.exitCode = 1;
  } else if (results.failures > 0) {
    console.warn('[Pinterest-Pipeline] Pipeline finished with partial failures.');
    process.exitCode = 0; // Don't fail the github action if at least one succeeded
  } else {
    console.log('[Pinterest-Pipeline] Pipeline finished successfully.');
  }
}

main().catch(err => {
  console.error('[Pinterest-Pipeline] Fatal error in pipeline:', err.message);
  process.exit(1);
});

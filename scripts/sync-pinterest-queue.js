#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const pinterestScraperService = require('../services/pinterestScraperService');
const pinterestQueueService = require('../services/pinterestQueueService');
const pinterestRepostStateService = require('../services/pinterestRepostStateService');

const ACCOUNTS_FILE = path.join(__dirname, '..', 'data', 'pinterest-accounts.json');

async function loadAccounts() {
  try {
    const data = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
    return JSON.parse(data).filter(acc => acc.active !== false);
  } catch (err) {
    console.warn('[Queue-Sync] Warning: Could not read pinterest-accounts.json.');
    return [];
  }
}

async function main() {
  console.log('[Queue-Sync] Starting deep sync to fill Pinterest Queue...');

  let targets = [];
  const envTarget = process.env.PINTEREST_TARGET_USERNAME || process.argv[2];
  if (envTarget) {
    targets = [{ username: envTarget, active: true }];
  } else {
    targets = await loadAccounts();
  }

  if (targets.length === 0) {
    console.log('[Queue-Sync] No active accounts to scrape. Exiting.');
    process.exit(0);
  }

  for (const target of targets) {
    console.log(`\n-----------------------------------------`);
    console.log(`[Queue-Sync] Aggressively scraping @${target.username}...`);
    try {
      // Scrape up to 2000 pins
      const pins = await pinterestScraperService.fetchLatestPins(target.username, 2000);
      
      if (!pins || pins.success === false) {
        throw new Error('All scraping tiers failed.');
      }

      console.log(`[Queue-Sync] Scraped ${pins.length} total image pins for @${target.username}.`);
      
      // Filter out pins already posted
      const pendingPins = [];
      for (const pin of pins) {
        const isReposted = await pinterestRepostStateService.isReposted(pin.pinId);
        if (!isReposted) {
          pendingPins.push({ ...pin, sourceAccount: target.username });
        }
      }

      console.log(`[Queue-Sync] Found ${pendingPins.length} NEW pins not yet posted.`);
      
      if (pendingPins.length > 0) {
        const added = await pinterestQueueService.addPinsToQueue(pendingPins);
        console.log(`[Queue-Sync] Successfully added ${added} unique pins to the queue.`);
      }

    } catch (err) {
      console.error(`[Queue-Sync] Error processing @${target.username}:`, err.message);
    }
  }

  const finalLength = await pinterestQueueService.getQueueLength();
  console.log(`\n=========================================`);
  console.log(`[Queue-Sync] Done! Current Queue Length: ${finalLength} pins.`);
}

main().catch(err => {
  console.error('[Queue-Sync] Fatal error:', err.message);
  process.exit(1);
});

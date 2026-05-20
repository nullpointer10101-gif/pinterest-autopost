#!/usr/bin/env node
require('dotenv').config();

/**
 * pinterest:status  ─  check-pinterest-status.js
 *
 * Prints the current state of the Pinterest automation system:
 * - Queue length
 * - Reposted pin count
 * - Target accounts
 */

const fs   = require('fs/promises');
const path = require('path');

const QUEUE_FILE    = path.join(__dirname, '..', 'data', 'pinterest_queue.json');
const REPOSTED_FILE = path.join(__dirname, '..', 'data', 'pinterest_reposted.json');
const ACCOUNTS_FILE = path.join(__dirname, '..', 'data', 'pinterest-accounts.json');

async function readJson(filePath, fallback) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

async function main() {
  const queue    = await readJson(QUEUE_FILE, []);
  const reposted = await readJson(REPOSTED_FILE, {});
  const accounts = await readJson(ACCOUNTS_FILE, []);

  const repostedCount = Object.keys(reposted).length;

  // Estimate hours to clear queue at 6 pins/hr
  const hoursToComplete = Math.ceil(queue.length / 6);
  const daysToComplete  = (queue.length / (6 * 24)).toFixed(1);

  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║       Pinterest Auto-Poster — Status Report       ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  🗂️  Queue Length        : ${String(queue.length).padEnd(21)} ║`);
  console.log(`║  ✅  Pins Reposted       : ${String(repostedCount).padEnd(21)} ║`);
  console.log(`║  ⏱️  Hours to Clear Queue: ${String(hoursToComplete).padEnd(21)} ║`);
  console.log(`║  📅  Days to Clear Queue : ${String(daysToComplete).padEnd(21)} ║`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  Target Accounts:                                 ║');
  for (const acc of accounts) {
    const status = acc.active !== false ? '✅ active' : '⛔ disabled';
    console.log(`║    @${acc.username.padEnd(20)} ${status.padEnd(21)} ║`);
  }
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  if (queue.length === 0) {
    console.log('⚠️  Queue is empty! Run: npm run pinterest:sync');
  } else if (queue.length < 20) {
    console.log('⚠️  Queue is running low. Consider running: npm run pinterest:sync');
  } else {
    console.log('✅ Queue is healthy. Publisher will run every hour automatically.');
  }
  console.log('');
}

main().catch(err => {
  console.error('Error reading status:', err.message);
  process.exit(1);
});

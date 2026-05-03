#!/usr/bin/env node
const queueService = require('../services/queueService');
const historyService = require('../services/historyService');
const igTrackerService = require('../services/igTrackerService');
const aiService = require('../services/aiService');
const githubService = require('../services/githubService');

async function runTest() {
  console.log('--- 🛡️ PMC SYSTEM DIAGNOSTICS ---');
  
  try {
    // 1. Storage Test
    console.log('[1/5] Checking Storage & DB...');
    const stats = await queueService.getQueueStats();
    console.log(`   ✅ DB Connected. Mode: ${stats.storageMode}. Pending Items: ${stats.pending}`);

    // 2. AI Test
    console.log('[2/5] Checking AI Engine (Gemini)...');
    const aiTest = await aiService.generatePinterestContent({
      caption: 'Test mission for Pinterest Mission Control',
      username: 'diagnostic_bot'
    });
    console.log(`   ✅ AI Responsive. Sample Title: "${aiTest.title}"`);

    // 3. IG Tracker Test
    console.log('[3/5] Checking IG Tracker...');
    const trackerStatus = await igTrackerService.getTrackerStatus();
    console.log(`   ✅ Tracker State OK. Channels tracked: ${trackerStatus.channels.length}`);

    // 4. GitHub Connectivity
    console.log('[4/5] Checking GitHub Dispatch Config...');
    const token = process.env.GH_PAT_TOKEN || process.env.GITHUB_TOKEN;
    if (token) {
      console.log(`   ✅ Token found (${token.slice(0, 4)}...${token.slice(-4)})`);
    } else {
      console.log('   ⚠️ No GitHub Token found in environment.');
    }

    // 5. Queue Integrity
    console.log('[5/5] Verifying Queue Integrity...');
    const queue = await queueService.getQueue();
    console.log(`   ✅ Queue contains ${queue.length} items.`);

    console.log('\n--- ✨ ALL CORE SERVICES OPERATIONAL ---');
  } catch (err) {
    console.error('\n--- ❌ DIAGNOSTIC FAILED ---');
    console.error(err.message);
    process.exit(1);
  }
}

runTest();

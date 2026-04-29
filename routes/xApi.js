const express = require('express');
const router = express.Router();

const xQueueService = require('../services/xQueueService');
const xHistoryService = require('../services/xHistoryService');
const xAutomationService = require('../services/xAutomationService');
const githubService = require('../services/githubService');

// === X QUEUE ROUTES ===

router.get('/queue', async (req, res) => {
  try {
    const queue = await xQueueService.getQueue();
    const stats = xQueueService.getQueueStats ? await xQueueService.getQueueStats() : null;
    res.json({ success: true, queue, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/queue', async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Non-empty items array is required' });
    }
    const added = await xQueueService.addToQueue(items);
    
    // Fire instant mission
    githubService.triggerXFirePost().catch(() => {});

    res.json({ success: true, added, message: `Added ${added.length} item(s) to X queue. GitHub Bot fired!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/queue', async (req, res) => {
  try {
    await xQueueService.clearQueue();
    res.json({ success: true, message: 'X Queue cleared' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === X HISTORY ROUTES ===

router.get('/history', async (req, res) => {
  try {
    const history = await xHistoryService.getAll();
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/engagements', async (req, res) => {
  try {
    const engagements = await xHistoryService.getEngagements();
    res.json({ success: true, engagements });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === X AUTOMATION ROUTES ===

router.post('/automation/run', async (req, res) => {
  try {
    const { force } = req.body || {};
    const result = await xAutomationService.runHourlyAutomation({ force });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === X FIRE POST ROUTE ===

router.post('/fire-post', async (req, res) => {
  try {
    console.log('[X-Queue] 🚀 Firing GitHub Bot instant mission...');
    githubService.triggerXFirePost().catch(() => {});
    return res.json({ 
      success: true, 
      queued: true, 
      message: '🚀 GitHub Bot fired for X! Processing will begin in ~30 seconds.' 
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// === X SESSION ROUTES ===

router.post('/session', async (req, res) => {
  try {
    const { cookie } = req.body;
    if (!cookie) return res.status(400).json({ success: false, error: 'Cookie required' });
    const result = await xHistoryService.setSessionCookie(cookie, 'manual-api');
    res.json({ success: true, session: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === X ENGAGE ROUTE ===
router.post('/engage', async (req, res) => {
  try {
    const count = parseInt(req.body.count, 10) || 3;
    console.log(`[X-Engage] 🚀 Firing GitHub Bot instant engagement with count: ${count}...`);
    githubService.triggerXInstantEngagement(count).catch(() => {});
    return res.json({ 
      success: true, 
      queued: true, 
      message: `🚀 X Engager fired for ${count} tweets! It will run in the background.` 
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

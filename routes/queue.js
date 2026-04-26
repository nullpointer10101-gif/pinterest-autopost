const express = require('express');
const router = express.Router();
const queueService = require('../services/queueService');
const githubService = require('../services/githubService');

router.get('/', async (req, res) => {
  try {
    const queue = await queueService.getQueue();
    const stats = queueService.getQueueStats ? await queueService.getQueueStats() : null;
    res.json({ success: true, queue, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Non-empty items array is required' });
    }
    const added = await queueService.addToQueue(items);
    
    githubService.triggerAutomation().catch(() => {});

    res.json({ success: true, added, message: `Added ${added.length} item(s) to queue.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/', async (req, res) => {
  try {
    await queueService.clearQueue();
    res.json({ success: true, message: 'Queue cleared' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/retry-failed', async (req, res) => {
  try {
    const changed = await queueService.retryFailedItems();
    res.json({ success: true, changed, message: `Moved ${changed} failed item(s) back to pending.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/process', async (req, res) => {
  try {
    const processed = await queueService.processNextInQueue();
    if (!processed) {
      return res.json({ success: true, processed: null, message: 'No pending queue items.' });
    }
    return res.json({ success: true, processed, message: `Processed queue item ${processed.id}` });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

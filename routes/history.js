const express = require('express');
const router = express.Router();
const historyService = require('../services/historyService');
const { puppeteerService } = require('./utils');

router.get('/history', async (req, res) => {
  try {
    const history = await historyService.getAll();
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/history/:id', async (req, res) => {
  try {
    await historyService.remove(req.params.id);
    res.json({ success: true, message: 'Entry removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/history', async (req, res) => {
  try {
    await historyService.clear();
    res.json({ success: true, message: 'History cleared' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/engagements', async (req, res) => {
  try {
    const engagements = await historyService.getEngagements();
    res.json({ success: true, engagements });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/engagements', async (req, res) => {
  try {
    await historyService.clearEngagements();
    res.json({ success: true, message: 'Engagements cleared' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/engage', async (req, res) => {
  try {
    const hardCap = Math.max(1, parseInt(process.env.AUTOMATION_ENGAGEMENTS_HARD_CAP || '2', 10));
    const requested = Math.max(1, parseInt(req.body?.count || '2', 10));
    const targetCount = Math.min(requested, hardCap);
    if (!puppeteerService || typeof puppeteerService.runAutoEngager !== 'function') {
      return res.status(500).json({
        success: false,
        error: 'Algorithm booster requires puppeteer and is unavailable in this environment.',
      });
    }

    puppeteerService.runAutoEngager({ count: targetCount }).catch(err => {
      console.error('[Engager] Background error:', err.message);
    });

    res.json({
      success: true,
      requested,
      targetCount,
      hardCap,
      message: `Started background engager for ${targetCount} pin(s).`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

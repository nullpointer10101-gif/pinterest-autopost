const express = require('express');
const router = express.Router();
const igTrackerService = require('../services/igTrackerService');

// GET /api/ig-tracker/status
router.get('/status', async (req, res) => {
  try {
    const status = await igTrackerService.getTrackerStatus();
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/ig-tracker/channels
router.get('/channels', async (req, res) => {
  try {
    const channels = await igTrackerService.getChannels();
    res.json({ success: true, channels });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/ig-tracker/channels  { username: "techburner" }
router.post('/channels', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ success: false, error: 'username is required' });
    const channels = await igTrackerService.addChannel(username);
    res.json({ success: true, channels });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/ig-tracker/channels  { username: "techburner" }
router.delete('/channels', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ success: false, error: 'username is required' });
    const channels = await igTrackerService.removeChannel(username);
    res.json({ success: true, channels });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/ig-tracker/scan  — trigger a manual scan now
router.post('/scan', async (req, res) => {
  try {
    const newReels = await igTrackerService.scanForNewReels();
    res.json({ success: true, newReels: newReels.length, reels: newReels.map(r => ({ shortcode: r.shortcode, url: r.url, username: r.username })) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

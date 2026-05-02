const express = require('express');
const router = express.Router();
const igTrackerService = require('../services/igTrackerService');
const automationService = require('../services/automationService');

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
    let channels = await igTrackerService.getChannels();

    // Backfill missing profile pics for existing channels so avatar UI self-heals.
    const missingUsers = channels
      .filter(ch => !ch?.profilePicUrl && ch?.username)
      .map(ch => ch.username);

    if (missingUsers.length > 0) {
      try {
        await Promise.race([
          Promise.allSettled(
            missingUsers.slice(0, 6).map(username => igTrackerService.ensureChannelProfilePic(username))
          ),
          new Promise(resolve => setTimeout(resolve, 6500))
        ]);
        channels = await igTrackerService.getChannels();
      } catch (metaErr) {
        console.warn('[API] Channel profile pic backfill failed:', metaErr.message);
      }
    }

    res.json({ success: true, channels });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/ig-tracker/channels  { username: "techburner" }
router.post('/channels', async (req, res) => {
  try {
    const { username: rawInput } = req.body;
    if (!rawInput) return res.status(400).json({ success: false, error: 'username or URL is required' });
    
    // 1. Normalize and add channel
    const username = await igTrackerService.addChannel(rawInput);

    // 1.5 Try to fetch/store profile pic immediately so UI can display it on first refresh.
    // Do not fail the add flow if Instagram blocks this request.
    try {
      await Promise.race([
        igTrackerService.ensureChannelProfilePic(username),
        new Promise(resolve => setTimeout(() => resolve(null), 6500))
      ]);
    } catch (metaErr) {
      console.warn(`[API] Profile pic sync failed for @${username}:`, metaErr.message);
    }
    
    // 2. Trigger initial processing (top 3 reels) in the background
    // We don't await this as we want to return the response quickly
    automationService.processInstagramReels({
      username: username,
      limit: 3,
      force: true // Force it to process even if they've been seen before (unlikely for new channel but good for verification)
    }).catch(err => console.error(`[API] Initial processing failed for @${username}:`, err.message));

    const channels = await igTrackerService.getChannels();
    res.json({ success: true, username, channels, message: `Channel @${username} added. Initial processing of top 3 reels started in background.` });
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

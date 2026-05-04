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

// GET /api/ig-tracker/profile-pic?username=lookbyn
router.get('/profile-pic', async (req, res) => {
  try {
    const { username: rawInput } = req.query;
    if (!rawInput) {
      return res.status(400).json({ success: false, error: 'username is required' });
    }

    const profilePicUrl = await igTrackerService.ensureChannelProfilePic(rawInput);
    res.json({
      success: true,
      username: igTrackerService.normalizeUsername(rawInput),
      profilePicUrl,
    });
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

/**
 * POST /api/ig-tracker/channels  { username: "techburner" }
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * NEW CHANNEL FLOW (v2):
 * 1. Normalize and add channel to tracker
 * 2. Fetch profile pic for UI
 * 3. Start background pipeline:
 *    - Fetch latest 3 video reels
 *    - Triple-layer dedup (queue + history + seen)
 *    - AI product identification → Flipkart → EarnKaro affiliate link
 *    - AI Pinterest content generation
 *    - Queue with schedule: Reel 0 = instant, Reel 1 = +60min, Reel 2 = +120min
 *    - Trigger fire-post.yml for instant reel
 * ═══════════════════════════════════════════════════════════════════════════
 */
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
    
    // 2. Trigger the FULL pipeline in background
    // This will:
    //   - Fetch top 3 reels
    //   - Run triple-layer dedup
    //   - AI identify products + generate affiliate links
    //   - AI generate Pinterest content
    //   - Queue: reel 0, 1, 2 = instant
    //   - Trigger fire-post.yml for the instant reels
    console.log(`[API] 🚀 Starting full pipeline for @${username} (top 3 reels, instant)...`);
    automationService.processInstagramReels({
      username: username,
      limit: 3,
      force: true
    }).then(result => {
      console.log(`[API] ✅ Pipeline complete for @${username}:`, JSON.stringify({
        success: result.success,
        queued: result.success,
        skipped: result.skipped || 0,
        failed: result.failed || 0,
      }));
    }).catch(err => {
      console.error(`[API] ❌ Pipeline failed for @${username}:`, err.message);
    });

    const channels = await igTrackerService.getChannels();
    res.json({ 
      success: true, 
      username, 
      channels, 
      message: `Channel @${username} added. Processing top 3 reels instantly. Affiliate links will be generated automatically.` 
    });
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

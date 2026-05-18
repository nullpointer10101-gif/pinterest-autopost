const express = require('express');

const igRepostService = require('../services/igRepostService');
const igRepostWorkflowService = require('../services/igRepostWorkflowService');
const igTrackerService = require('../services/igTrackerService');

const router = express.Router();

router.get('/status', async (req, res) => {
  try {
    await igRepostService.migrateLegacyChannels({ onlyIfEmpty: true });
    const status = await igRepostService.getStatus();
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/profile-pic', async (req, res) => {
  try {
    const { username: rawInput } = req.query;
    if (!rawInput) {
      return res.status(400).json({ success: false, error: 'username is required' });
    }

    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const profilePicUrl = await igTrackerService.ensureChannelProfilePic(rawInput, { forceRefresh });
    if (profilePicUrl) {
      await igRepostService.setChannelProfilePic(rawInput, profilePicUrl);
    }

    res.json({
      success: true,
      username: igTrackerService.normalizeUsername(rawInput),
      profilePicUrl,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/channels', async (req, res) => {
  try {
    await igRepostService.migrateLegacyChannels({ onlyIfEmpty: true });
    let channels = await igRepostService.listChannels();

    const missingUsers = channels
      .filter((channel) => !channel?.profilePicUrl && channel?.username)
      .map((channel) => channel.username);

    if (missingUsers.length > 0) {
      try {
        await Promise.race([
          Promise.allSettled(
            missingUsers.slice(0, 6).map(async (username) => {
              const profilePicUrl = await igTrackerService.ensureChannelProfilePic(username);
              if (profilePicUrl) {
                await igRepostService.setChannelProfilePic(username, profilePicUrl);
              }
            })
          ),
          new Promise((resolve) => setTimeout(resolve, 6500)),
        ]);
        channels = await igRepostService.listChannels();
      } catch (metaErr) {
        console.warn('[API] Channel profile pic backfill failed:', metaErr.message);
      }
    }

    res.json({ success: true, channels });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/channels', async (req, res) => {
  try {
    const { username: rawInput } = req.body;
    if (!rawInput) {
      return res.status(400).json({ success: false, error: 'username or URL is required' });
    }

    const account = await igRepostService.addChannel(rawInput, { rejectExisting: true });
    const username = account.username;

    try {
      const profilePicUrl = await Promise.race([
        igTrackerService.ensureChannelProfilePic(username),
        new Promise((resolve) => setTimeout(() => resolve(null), 6500)),
      ]);
      if (profilePicUrl) {
        await igRepostService.setChannelProfilePic(username, profilePicUrl);
      }
    } catch (metaErr) {
      console.warn(`[API] Profile pic sync failed for @${username}:`, metaErr.message);
    }

    const dispatch = await igRepostWorkflowService.triggerValidation(username);
    if (!dispatch.success) {
      return res.status(500).json({
        success: false,
        error: `Channel added, but validation dispatch failed: ${dispatch.error}`,
      });
    }

    await igRepostService.markDispatch({
      username,
      mode: 'validate',
      reason: 'new_account_validation',
    });

    const channels = await igRepostService.listChannels();
    res.json({
      success: true,
      username,
      channels,
      message: `Channel @${username} added. Independent validation repost has started.`,
    });
  } catch (err) {
    if (err.code === 'DUPLICATE_ACCOUNT') {
      return res.status(409).json({
        success: false,
        error: err.message,
        code: err.code,
        username: err.username,
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/channels', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ success: false, error: 'username is required' });
    }

    const channels = await igRepostService.removeChannel(username);
    res.json({ success: true, channels });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/scan', async (req, res) => {
  try {
    const dispatch = await igRepostWorkflowService.triggerScheduledScan();
    if (!dispatch.success) {
      return res.status(500).json({ success: false, error: dispatch.error });
    }

    await igRepostService.markDispatch({
      mode: 'scan',
      reason: 'manual_scan',
    });

    res.json({
      success: true,
      queued: true,
      message: 'Independent IG repost scan dispatched.',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

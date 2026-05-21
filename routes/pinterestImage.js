const express = require('express');
const path = require('path');

const channelService = require('../services/pinterestImageChannelService');
const queueService = require('../services/pinterestImageQueueService');
const stateService = require('../services/pinterestImageStateService');
const githubService = require('../services/githubService');

const router = express.Router();

router.get('/status', async (req, res) => {
  try {
    const [channels, queue, state] = await Promise.all([
      channelService.listChannels(),
      queueService.getQueueStats(),
      stateService.getStats(),
    ]);
    res.json({ success: true, channels, queue, ...state });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/channels', async (req, res) => {
  try {
    const channels = await channelService.listChannels();
    const queue = await queueService.getQueueStats();
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json({ success: true, channels, queue });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/channels', async (req, res) => {
  try {
    const rawInput = req.body?.username || req.body?.url || '';
    if (!rawInput) {
      return res.status(400).json({ success: false, error: 'username or profile URL is required' });
    }

    const result = await channelService.addChannel(rawInput);
    const channels = await channelService.listChannels();
    res.json({
      success: true,
      username: result.channel.username,
      channel: result.channel,
      channels,
      message: result.reactivated
        ? `Pinterest image source @${result.channel.username} reactivated.`
        : `Pinterest image source @${result.channel.username} added.`,
    });
  } catch (err) {
    if (err.code === 'DUPLICATE_ACCOUNT') {
      return res.status(409).json({
        success: false,
        code: err.code,
        username: err.username,
        error: err.message,
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/channels', async (req, res) => {
  try {
    const rawInput = req.body?.username || req.query?.username || '';
    if (!rawInput) {
      return res.status(400).json({ success: false, error: 'username is required' });
    }

    const result = await channelService.removeChannel(rawInput);
    res.json({
      success: true,
      ...result,
      message: `Pinterest image source @${result.username} removed${result.removedQueuedPins ? ` with ${result.removedQueuedPins} queued pin(s)` : ''}.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/queue', async (req, res) => {
  try {
    const [queue, stats] = await Promise.all([
      queueService.loadQueue(),
      queueService.getQueueStats(),
    ]);
    res.json({ success: true, queue, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/logs', async (req, res) => {
  try {
    const logs = await stateService.getLogs(100);
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/sync', async (req, res) => {
  try {
    const username = req.body?.username || req.query?.username || '';
    const dispatch = await githubService.triggerPinterestImageSync(username);
    if (dispatch.success) {
      return res.json({
        success: true,
        queued: true,
        message: username
          ? `Pinterest image sync dispatched for @${channelService.normalizeUsername(username)}.`
          : 'Pinterest image sync dispatched for all active sources.',
      });
    }

    const isServerless = !!(process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
    if (isServerless) {
      return res.status(502).json({ success: false, error: dispatch.error || 'GitHub dispatch failed' });
    }

    const { exec } = require('child_process');
    const scriptPath = path.join(__dirname, '..', 'scripts', 'pinterest-image-sync.js');
    const cleanUsername = channelService.normalizeUsername(username);
    const suffix = cleanUsername ? ` --username=${cleanUsername}` : '';
    exec(`node "${scriptPath}"${suffix}`, (error) => {
      if (error) console.error('[Pinterest Image API] Local sync failed:', error);
    });

    return res.json({
      success: true,
      queued: true,
      local: true,
      message: 'Pinterest image sync started locally.',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/publish', async (req, res) => {
  try {
    const dispatch = await githubService.triggerPinterestImagePublish();
    if (dispatch.success) {
      return res.json({ success: true, queued: true, message: 'Pinterest image publisher dispatched.' });
    }

    const isServerless = !!(process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
    if (isServerless) {
      return res.status(502).json({ success: false, error: dispatch.error || 'GitHub dispatch failed' });
    }

    const { exec } = require('child_process');
    const scriptPath = path.join(__dirname, '..', 'scripts', 'pinterest-image-publish.js');
    exec(`node "${scriptPath}"`, (error) => {
      if (error) console.error('[Pinterest Image API] Local publish failed:', error);
    });
    return res.json({ success: true, queued: true, local: true, message: 'Pinterest image publisher started locally.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

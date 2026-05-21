const express = require('express');
const path = require('path');

const channelService = require('../services/pinterestImageChannelService');
const queueService = require('../services/pinterestImageQueueService');
const stateService = require('../services/pinterestImageStateService');
const githubService = require('../services/githubService');

const router = express.Router();
const DEFAULT_BOOTSTRAP_POSTS = 6;

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'undefined' || value === null || value === '') return fallback;
  const clean = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(clean)) return true;
  if (['0', 'false', 'no', 'off'].includes(clean)) return false;
  return fallback;
}

function getMaxPosts(req) {
  const raw = req.body?.maxPosts || req.body?.max_posts || req.query?.maxPosts || req.query?.max_posts;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BOOTSTRAP_POSTS;
}

async function dispatchPinterestImageSync(username, options = {}) {
  const maxPosts = Number.parseInt(options.maxPosts, 10) || DEFAULT_BOOTSTRAP_POSTS;
  const publishAfterSync = options.publishAfterSync === true;
  const dispatch = await githubService.triggerPinterestImageSync(username, {
    publishAfterSync,
    maxPosts,
  });

  return {
    ...dispatch,
    publishAfterSync,
    maxPosts,
  };
}

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
    const bootstrapEnabled = parseBoolean(req.body?.bootstrap ?? req.query?.bootstrap, true);
    const publishAfterSync = parseBoolean(req.body?.publishAfterSync ?? req.body?.publish_after_sync ?? req.query?.publishAfterSync ?? req.query?.publish_after_sync, true);
    const bootstrap = bootstrapEnabled
      ? await dispatchPinterestImageSync(result.channel.username, {
        publishAfterSync,
        maxPosts: getMaxPosts(req),
      })
      : null;

    const baseMessage = result.reactivated
      ? `Pinterest image source @${result.channel.username} reactivated.`
      : `Pinterest image source @${result.channel.username} added.`;
    const bootstrapMessage = bootstrap
      ? (bootstrap.success
        ? (publishAfterSync
          ? ` Sync started and will publish up to ${bootstrap.maxPosts} queued pins.`
          : ' Sync started; publishing will wait for the next publish run.')
        : ` Auto sync did not start: ${bootstrap.error || 'GitHub dispatch failed'}.`)
      : '';

    res.json({
      success: true,
      username: result.channel.username,
      channel: result.channel,
      channels,
      bootstrap,
      message: `${baseMessage}${bootstrapMessage}`,
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
    const cleanUsername = username ? await channelService.resolveUsername(username) : '';
    if (username && !cleanUsername) {
      return res.status(400).json({ success: false, error: 'Enter a valid Pinterest username, profile URL, or pin.it profile invite link.' });
    }

    const publishAfterSync = parseBoolean(req.body?.publishAfterSync ?? req.body?.publish_after_sync ?? req.query?.publishAfterSync ?? req.query?.publish_after_sync, true);
    const maxPosts = getMaxPosts(req);
    const dispatch = await dispatchPinterestImageSync(cleanUsername, { publishAfterSync, maxPosts });
    if (dispatch.success) {
      return res.json({
        success: true,
        queued: true,
        publishAfterSync,
        maxPosts,
        message: username
          ? `Pinterest image sync dispatched for @${cleanUsername}${publishAfterSync ? ` and will publish up to ${maxPosts} pins after sync` : ''}.`
          : `Pinterest image sync dispatched for all active sources${publishAfterSync ? ` and will publish up to ${maxPosts} pins after sync` : ''}.`,
      });
    }

    const isServerless = !!(process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
    if (isServerless) {
      return res.status(502).json({ success: false, error: dispatch.error || 'GitHub dispatch failed' });
    }

    const { exec } = require('child_process');
    const scriptPath = path.join(__dirname, '..', 'scripts', 'pinterest-image-sync.js');
    const suffix = cleanUsername ? ` --username=${cleanUsername}` : '';
    const publishScriptPath = path.join(__dirname, '..', 'scripts', 'pinterest-image-publish.js');
    const command = publishAfterSync
      ? `node "${scriptPath}"${suffix} && node "${publishScriptPath}" --max=${maxPosts}`
      : `node "${scriptPath}"${suffix}`;
    exec(command, (error) => {
      if (error) console.error('[Pinterest Image API] Local sync failed:', error);
    });

    return res.json({
      success: true,
      queued: true,
      local: true,
      publishAfterSync,
      maxPosts,
      message: publishAfterSync
        ? `Pinterest image sync started locally. Publisher will post up to ${maxPosts} pins after sync.`
        : 'Pinterest image sync started locally.',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/publish', async (req, res) => {
  try {
    const username = req.body?.username || req.query?.username || req.body?.sourceAccount || req.query?.sourceAccount || '';
    const cleanUsername = username ? await channelService.resolveUsername(username) : '';
    if (username && !cleanUsername) {
      return res.status(400).json({ success: false, error: 'Enter a valid Pinterest username, profile URL, or pin.it profile invite link.' });
    }

    const maxPosts = getMaxPosts(req);
    const dispatch = await githubService.triggerPinterestImagePublish({
      username: cleanUsername,
      maxPosts,
    });
    if (dispatch.success) {
      return res.json({
        success: true,
        queued: true,
        username: cleanUsername,
        maxPosts,
        message: cleanUsername
          ? `Pinterest image publisher dispatched for @${cleanUsername} (up to ${maxPosts} pins).`
          : 'Pinterest image publisher dispatched.',
      });
    }

    const isServerless = !!(process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
    if (isServerless) {
      return res.status(502).json({ success: false, error: dispatch.error || 'GitHub dispatch failed' });
    }

    const { exec } = require('child_process');
    const scriptPath = path.join(__dirname, '..', 'scripts', 'pinterest-image-publish.js');
    const suffix = cleanUsername ? ` --source=${cleanUsername}` : '';
    exec(`node "${scriptPath}" --max=${maxPosts}${suffix}`, (error) => {
      if (error) console.error('[Pinterest Image API] Local publish failed:', error);
    });
    return res.json({
      success: true,
      queued: true,
      local: true,
      username: cleanUsername,
      maxPosts,
      message: cleanUsername
        ? `Pinterest image publisher started locally for @${cleanUsername}.`
        : 'Pinterest image publisher started locally.',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

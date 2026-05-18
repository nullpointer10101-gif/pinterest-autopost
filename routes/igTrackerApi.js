const express = require('express');

const igRepostService = require('../services/igRepostService');
const igRepostWorkflowService = require('../services/igRepostWorkflowService');
const igTrackerService = require('../services/igTrackerService');

const router = express.Router();

function avatarHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
    'Referer': 'https://www.instagram.com/',
    'Origin': 'https://www.instagram.com',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'sec-fetch-dest': 'image',
    'sec-fetch-mode': 'no-cors',
    'sec-fetch-site': 'cross-site',
  };
}

async function fetchAvatarStream(profilePicUrl) {
  const cleanUrl = String(profilePicUrl || '').trim();
  if (!/^https?:\/\//i.test(cleanUrl)) return null;

  const axios = require('axios');
  const response = await axios.get(cleanUrl, {
    responseType: 'stream',
    headers: avatarHeaders(),
    timeout: 15000,
    maxRedirects: 5,
    validateStatus: () => true,
  });

  const contentType = response.headers['content-type'] || '';
  if (response.status < 200 || response.status >= 300 || !contentType.startsWith('image/')) {
    if (response.data?.resume) response.data.resume();
    return null;
  }

  return response;
}

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
    const profilePicUrl = await igTrackerService.ensureChannelProfilePic(rawInput, {
      forceRefresh,
      allowApify: true,
    });
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

router.get('/avatar', async (req, res) => {
  try {
    const { username: rawInput } = req.query;
    if (!rawInput) {
      return res.status(400).send('username is required');
    }

    const username = igTrackerService.normalizeUsername(rawInput);
    if (!username) {
      return res.status(400).send('invalid username');
    }

    let profilePicUrl = await igTrackerService.ensureChannelProfilePic(username, {
      allowApify: true,
      forceRefresh: req.query.refresh === '1' || req.query.refresh === 'true',
    });

    let avatarResponse = await fetchAvatarStream(profilePicUrl);
    if (!avatarResponse) {
      profilePicUrl = await igTrackerService.ensureChannelProfilePic(username, {
        forceRefresh: true,
        allowApify: true,
      });
      avatarResponse = await fetchAvatarStream(profilePicUrl);
    }

    if (!avatarResponse) {
      return res.status(404).send('profile picture unavailable');
    }

    await igRepostService.setChannelProfilePic(username, profilePicUrl);

    res.setHeader('Content-Type', avatarResponse.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=1800, stale-while-revalidate=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    avatarResponse.data.pipe(res);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.post('/sync-avatars', async (req, res) => {
  try {
    const username = req.body?.username || req.query?.username || '';
    const dispatch = await igRepostWorkflowService.triggerAvatarSync(username);
    if (!dispatch.success) {
      return res.status(500).json({
        success: false,
        error: `Avatar sync dispatch failed: ${dispatch.error}`,
      });
    }

    res.json({
      success: true,
      message: username
        ? `Avatar sync started for @${igTrackerService.normalizeUsername(username)}.`
        : 'Avatar sync started for all target channels.',
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
        igTrackerService.ensureChannelProfilePic(username, { allowApify: true }),
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

    let avatarSyncStarted = false;
    try {
      const avatarDispatch = await igRepostWorkflowService.triggerAvatarSync(username);
      avatarSyncStarted = avatarDispatch.success;
      if (avatarDispatch.success) {
        await igRepostService.markDispatch({
          username,
          mode: 'sync-avatars',
          reason: 'new_account_avatar_sync',
        });
      } else {
        console.warn(`[API] Avatar sync dispatch failed for @${username}:`, avatarDispatch.error);
      }
    } catch (avatarErr) {
      console.warn(`[API] Avatar sync dispatch failed for @${username}:`, avatarErr.message);
    }

    const channels = await igRepostService.listChannels();
    res.json({
      success: true,
      username,
      channels,
      avatarSyncStarted,
      message: avatarSyncStarted
        ? `Channel @${username} added. Validation repost and profile picture sync have started.`
        : `Channel @${username} added. Independent validation repost has started.`,
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

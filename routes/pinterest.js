const express = require('express');
const router = express.Router();
const historyService = require('../services/historyService');
const queueService = require('../services/queueService');
const githubService = require('../services/githubService');

function normalizeSessionCookie(input) {
  let raw = String(input || '').trim();
  if (!raw) return '';

  if (/^cookie:/i.test(raw)) {
    raw = raw.replace(/^cookie:/i, '').trim();
  }

  if (raw.includes(';')) {
    const parts = raw.split(';').map(p => p.trim()).filter(Boolean);
    const hit = parts.find(p => /^_pinterest_sess=/i.test(p));
    if (hit) {
      raw = hit.replace(/^_pinterest_sess=/i, '').trim();
    } else if (/^_pinterest_sess=/i.test(parts[0] || '')) {
      raw = (parts[0] || '').replace(/^_pinterest_sess=/i, '').trim();
    }
  } else if (/^_pinterest_sess=/i.test(raw)) {
    raw = raw.replace(/^_pinterest_sess=/i, '').trim();
  }

  raw = raw.replace(/^['"]|['"]$/g, '').trim();
  raw = raw.replace(/[\r\n\t ]+/g, '');
  return raw;
}

function normalizeDestinationLink(input) {
  let raw = String(input || '').trim();
  if (!raw) return '';

  if (!/^https?:\/\//i.test(raw) && /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}([/:?#].*)?$/.test(raw)) {
    raw = `https://${raw}`;
  }

  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

// ─── Status — GitHub Bot mode info ────────────────────────────────────────────
function publicSessionStatus(session = {}) {
  return {
    hasSession: !!session.hasSession,
    source: session.source || 'none',
    updatedAt: session.updatedAt || null,
    label: session.label || '',
    masked: session.masked || '',
  };
}

router.get('/boards', async (req, res) => {
  // No API boards — the bot uses the default board on Pinterest
  res.json({ success: true, boards: [] });
});

router.get('/status', async (req, res) => {
  try {
    const session = await historyService.getSessionCookie();
    res.json({
      success: true,
      connected: !!session.hasSession,
      username: null,
      profileImage: null,
      isDemoMode: false,
      sessionLinked: !!session.hasSession,
      sessionSource: session.source,
      sessionUpdatedAt: session.updatedAt,
      postingMode: 'bot',
      resolvedPostingMode: 'bot',
      isServerless: false,
      message: 'GitHub Bot mode — all posts go through GitHub Actions.',
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ─── Post Now — GitHub Bot Only (No API, No Queue Wait) ───────────────────────
router.post('/post', async (req, res) => {
  try {
    const {
      title,
      description,
      altText,
      hashtags,
      mediaUrl,
      sourceUrl,
      destinationLink,
      reelMeta,
      autoEdit,
      affiliateLinks,
      productInfo,
      sourcePipeline,
    } = req.body;
    if (!title || !mediaUrl) {
      return res.status(400).json({ success: false, error: 'title and mediaUrl are required' });
    }
    if (title.length > 100) {
      return res.status(400).json({ success: false, error: 'Title exceeds 100-character limit' });
    }
    if (description && description.length > 800) {
      return res.status(400).json({ success: false, error: 'Description exceeds 800-character limit' });
    }

    const cleanLink = normalizeDestinationLink(destinationLink);
    const hashtagText = Array.isArray(hashtags) ? hashtags.join(' ') : '';
    const descWithTags = `${(description || '').trim()}${hashtagText ? `\n\n${hashtagText}` : ''}`.trim();

    const missionId = `mission_${Date.now()}`;

    // Extract shortcode from the original reel URL for dedup and look page
    const shortcodeMatch = (sourceUrl || '').match(/\/(reel|p|tv)\/([A-Za-z0-9_-]+)/);
    const shortcode = shortcodeMatch ? shortcodeMatch[2] : (reelMeta?.shortcode || null);
    const isStudioMission =
      String(sourcePipeline || '').toLowerCase() === 'studio' &&
      String(autoEdit?.source || '').toLowerCase() === 'studio';

    // 🚀 INSTANT GitHub Bot — prepend to queue front + fire immediately
    console.log(`[Post Mission] 🚀 Instant GitHub Bot — queueing + firing NOW... shortcode=${shortcode || 'N/A'}`);

    const added = await queueService.addToQueue([{
      id: missionId,
      shortcode,
      title: title.trim(),
      description: descWithTags,
      altText: altText ? altText.trim() : '',
      mediaUrl,
      sourceUrl: sourceUrl || '',   // keep original IG URL for shortcode dedup
      originalSourceUrl: sourceUrl || '',
      destinationLink: cleanLink,
      username: reelMeta?.username || 'unknown',
      caption: reelMeta?.caption || '',
      thumbnailUrl: reelMeta?.thumbnailUrl || mediaUrl,
      smartCover: true,
      smartCoverSource: isStudioMission ? 'direct_reel_studio' : 'manual_url_post_now',
      sourcePipeline: isStudioMission ? 'studio' : 'manual_post_now',
      autoEdit: isStudioMission ? autoEdit : null,
      affiliateLinks: Array.isArray(affiliateLinks) ? affiliateLinks : [],
      productInfo: productInfo || null,
      reelMeta,
      isInstant: true,
    }], true); // true = prepend to front of queue

    if (!added || added.length === 0) {
      return res.status(409).json({
        success: false,
        error: 'This reel was already posted or is already in the queue (dedup blocked it). Try a different reel.',
      });
    }

    // Fire GitHub Actions immediately and fail loudly if dispatch does not start.
    const fireDispatch = await githubService.triggerInstantMission();
    if (!fireDispatch.success) {
      return res.status(502).json({
        success: false,
        queued: true,
        missionId,
        shortcode,
        error: `Mission was queued, but GitHub Bot did not start: ${fireDispatch.error || 'dispatch failed'}`,
      });
    }

    return res.json({
      success: true,
      queued: true,
      firePostDispatched: true,
      missionId,
      shortcode,
      message: `🚀 Instant Mission fired! GitHub Bot will post${shortcode ? ` reel /${shortcode}` : ''} in ~60 seconds.`,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


router.get('/session/status', async (req, res) => {
  try {
    const session = await historyService.getSessionCookie();
    res.json({ success: true, session: publicSessionStatus(session) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/session/link', async (req, res) => {
  try {
    const cookie = normalizeSessionCookie(req.body?.cookie);
    const label = String(req.body?.label || '').trim();

    if (!cookie || cookie.length < 20) {
      return res.status(400).json({
        success: false,
        error: 'Valid _pinterest_sess cookie is required (paste raw value or full Cookie header).',
      });
    }

    const session = await historyService.setSessionCookie(cookie, label);
    return res.json({
      success: true,
      session,
      message: 'Session linked successfully. No restart required.',
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/session/unlink', async (req, res) => {
  try {
    const session = await historyService.clearSessionCookie();
    return res.json({
      success: true,
      session,
      message: 'Session removed.',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/unlink', async (req, res) => {
  try {
    await historyService.clearTokens();
    return res.json({
      success: true,
      message: 'Pinterest API connection unlinked.',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const pinterestImageChannelService = require('../services/pinterestImageChannelService');
const pinterestImageQueueService = require('../services/pinterestImageQueueService');
const pinterestImageStateService = require('../services/pinterestImageStateService');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ─── Resolve Pinterest short URLs (pin.it, etc.) ──────────────────────────────
function followRedirects(url, maxRedirects = 8) {
  return new Promise((resolve, reject) => {
    let redirects = 0;

    function doRequest(currentUrl) {
      const lib = currentUrl.startsWith('https') ? https : http;
      const req = lib.get(currentUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        timeout: 8000,
      }, (res) => {
        const location = res.headers['location'];
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && location) {
          if (++redirects > maxRedirects) return reject(new Error('Too many redirects'));
          const next = location.startsWith('http') ? location : new URL(location, currentUrl).toString();
          res.resume(); // drain response
          return doRequest(next);
        }
        resolve(currentUrl);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    }

    doRequest(url);
  });
}

function extractPinterestUsername(url) {
  try {
    const parsed = new URL(url);
    // Must be a pinterest domain
    if (!parsed.hostname.includes('pinterest.')) return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    const username = segments[0] || '';
    // Filter out non-profile paths
    const reserved = new Set(['pin', 'board', 'search', 'explore', 'ideas', 'settings', 'today', 'login', 'signup']);
    if (!username || reserved.has(username.toLowerCase())) return null;
    if (!/^[a-z0-9._-]+$/i.test(username)) return null;
    return username.toLowerCase();
  } catch {
    return null;
  }
}

router.get('/resolve-url', async (req, res) => {
  try {
    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl) {
      return res.status(400).json({ success: false, error: 'url query param is required' });
    }

    // Only bother resolving if it looks like a short/invite URL
    const isPinIt = /^https?:\/\/pin\.it\//i.test(rawUrl);
    const isPinterestWithQuery = /^https?:\/\/[a-z.]*pinterest\.[a-z.]+\/[^?]+\?/i.test(rawUrl);

    let finalUrl = rawUrl;
    if (isPinIt || isPinterestWithQuery) {
      finalUrl = await followRedirects(rawUrl);
    }

    const username = extractPinterestUsername(finalUrl);
    if (!username) {
      return res.status(422).json({
        success: false,
        error: 'Could not extract a Pinterest username from this URL. Please paste the profile URL directly (e.g. https://pinterest.com/username) or just the username.',
        resolvedUrl: finalUrl,
      });
    }

    res.json({ success: true, username, resolvedUrl: finalUrl });
  } catch (err) {
    res.status(500).json({ success: false, error: `Failed to resolve URL: ${err.message}` });
  }
});

// ─── Target Channels Management ───────────────────────────────────────────────
router.get('/channels', async (req, res) => {
  try {
    const channels = await pinterestImageChannelService.listChannels();
    const queue = await pinterestImageQueueService.getQueueStats();
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json({ success: true, channels, queue });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/channels', async (req, res) => {
  try {
    const { username: rawInput } = req.body;
    if (!rawInput) {
      return res.status(400).json({ success: false, error: 'username is required' });
    }
    const result = await pinterestImageChannelService.addChannel(rawInput);
    const account = result.channel;
    const channels = await pinterestImageChannelService.listChannels();
    res.json({
      success: true,
      username: account.username,
      channels,
      message: result.reactivated
        ? `Pinterest image source @${account.username} reactivated.`
        : `Pinterest image source @${account.username} added. Scraper will process it on the next sync.`,
    });
  } catch (err) {
    if (err.code === 'DUPLICATE_ACCOUNT') {
      return res.status(409).json({ success: false, error: err.message, code: err.code, username: err.username });
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
    const result = await pinterestImageChannelService.removeChannel(username);
    res.json({
      success: true,
      channels: result.channels,
      removedQueuedPins: result.removedQueuedPins,
      message: `Pinterest image source @${result.username} removed${result.removedQueuedPins ? ` with ${result.removedQueuedPins} queued pin(s)` : ''}.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Logs ─────────────────────────────────────────────────────────────────────
router.get('/logs', async (req, res) => {
  try {
    const rawLogs = typeof pinterestImageStateService.getDisplayLogs === 'function'
      ? await pinterestImageStateService.getDisplayLogs(80)
      : await pinterestImageStateService.getLogs(80);
    const logs = rawLogs.map((entry) => ({
      id: entry.id,
      when: entry.createdAt,
      action: entry.type,
      url: entry.meta?.pinUrl || entry.meta?.bridgeLink || '',
      pinTitle: entry.meta?.pinId || entry.message,
      boardName: entry.meta?.username || entry.meta?.sourceAccount || 'pinterest_image',
      status: entry.type.includes('failed') ? 'error' : 'success',
      message: entry.message,
    }));
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Scan ───────────────────────────────────────────────────────────────────────
router.post('/scan', async (req, res) => {
  try {
    const { exec } = require('child_process');
    const username = req.body?.username || req.query?.username || '';
    const dispatch = await githubService.triggerPinterestImageSync(username);
    if (dispatch.success) {
      return res.json({
        success: true,
        queued: true,
        message: username
          ? `Pinterest image sync dispatched for @${pinterestImageChannelService.normalizeUsername(username)}.`
          : 'Pinterest image sync dispatched for all active sources.',
      });
    }

    const isServerless = !!(process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
    if (isServerless) {
      return res.status(502).json({
        success: false,
        error: `GitHub dispatch failed: ${dispatch.error || 'token missing'}`,
      });
    }

    const scriptPath = path.join(__dirname, '..', 'scripts', 'pinterest-image-sync.js');
    const cleanUsername = pinterestImageChannelService.normalizeUsername(username);
    const suffix = cleanUsername ? ` --username=${cleanUsername}` : '';
    exec(`node "${scriptPath}"${suffix}`, (error) => {
      if (error) console.error('Pinterest image sync error:', error);
    });
    res.json({
      success: true,
      queued: true,
      local: true,
      message: 'Pinterest image sync started locally.',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/image/status', async (req, res) => {
  try {
    const [channels, queue, state] = await Promise.all([
      pinterestImageChannelService.listChannels(),
      pinterestImageQueueService.getQueueStats(),
      pinterestImageStateService.getStats(),
    ]);
    res.json({
      success: true,
      channels,
      queue,
      ...state,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/image/publish', async (req, res) => {
  try {
    const dispatch = await githubService.triggerPinterestImagePublish();
    if (!dispatch.success) {
      return res.status(502).json({ success: false, error: dispatch.error || 'GitHub dispatch failed' });
    }
    res.json({ success: true, queued: true, message: 'Pinterest image publisher dispatched.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

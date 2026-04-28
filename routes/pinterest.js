const express = require('express');
const router = express.Router();
const pinterestService = require('../services/pinterestService');
const historyService = require('../services/historyService');
const queueService = require('../services/queueService');
const githubService = require('../services/githubService');
const { resolvePostingMode, IS_SERVERLESS, puppeteerService } = require('./utils');

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

router.get('/boards', async (req, res) => {
  try {
    const boards = await pinterestService.getBoards();
    res.json({ success: true, boards });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/status', async (req, res) => {
  try {
    const status = await pinterestService.getStatus();
    const session = await historyService.getSessionCookie();
    const posting = resolvePostingMode();
    res.json({
      success: true,
      ...status,
      sessionLinked: !!session.hasSession,
      sessionSource: session.source,
      sessionUpdatedAt: session.updatedAt,
      puppeteerAvailable: !!puppeteerService,
      postingMode: posting.configuredMode,
      resolvedPostingMode: posting.resolvedMode,
      isServerless: IS_SERVERLESS,
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/post', async (req, res) => {
  try {
    const { title, description, altText, hashtags, mediaUrl, sourceUrl, reelMeta } = req.body;
    if (!title || !mediaUrl) {
      return res.status(400).json({ success: false, error: 'title and mediaUrl are required' });
    }
    if (title.length > 100) {
      return res.status(400).json({ success: false, error: 'Title exceeds 100-character limit' });
    }
    if (description && description.length > 800) {
      return res.status(400).json({ success: false, error: 'Description exceeds 800-character limit' });
    }

    const cleanLink = normalizeDestinationLink(sourceUrl);

    const hashtagText = Array.isArray(hashtags) ? hashtags.join(' ') : '';
    const descWithTags = `${(description || '').trim()}${hashtagText ? `\n\n${hashtagText}` : ''}`.trim();

    const pinData = {
      title: title.trim(),
      description: descWithTags,
      link: cleanLink,
      alt_text: altText ? altText.trim() : undefined,
      media_source: {
        source_type: 'video_url',
        url: mediaUrl,
      },
    };

    const posting = resolvePostingMode();
    let result;
    
    // DECISION: API timeout & video_url bugs are fixed! We now prefer Native API for 'Post Now'
    // This allows manual direct posts to process instantly (10-15s) instead of waiting for GitHub Actions.
    const hasApiToken = !!(await pinterestService.getStatus()).connected;
    
    if (hasApiToken && !posting.useBrowserBot) {
      console.log('[Post Mission] Attempting Ultra-Fast NATIVE API...');
      try {
        const apiResult = await pinterestService.createPin({
          title: pinData.title,
          description: pinData.description,
          altText: pinData.alt_text || '',
          mediaUrl,
          link: cleanLink,
        });
        
        result = { success: true, pin: apiResult };
        console.log('[Post Mission] NATIVE API success!');
        
        // We will jump straight to the history logging below
      } catch (apiErr) {
        console.warn('[Post Mission] API failed, falling back to Cloud Bot:', apiErr.message);
        // Fall through to Cloud Bot logic if API fails
      }
    }
    
    // Fallback: If API fails/missing, use Browser Bot
    if (!result) {
      if (!IS_SERVERLESS) {
        console.log('[Post Mission] Running LOCAL Browser Bot for INSTANT post...');
        const puppeteerService = require('../services/puppeteerService');
        try {
          const pinResult = await puppeteerService.createPinWithBot({
            title: pinData.title,
            description: pinData.description,
            alt_text: pinData.alt_text || '',
            media_source: { url: mediaUrl },
            link: cleanLink,
          });
          result = { success: true, pin: pinResult.pin };
        } catch (botErr) {
          throw new Error('Local Browser Bot failed: ' + botErr.message);
        }
      } else {
        console.log('[Post Mission] Routing to Cloud Bot (GitHub Actions)...');
        const missionId = `mission_${Date.now()}`;
        
        // 1. Add to the FRONT of the queue for immediate processing
        await queueService.addToQueue([{
          id: missionId,
          title: pinData.title,
          description: pinData.description,
          altText: pinData.alt_text || '',
          mediaUrl,
          sourceUrl: cleanLink,
          reelMeta,
          isInstant: true // Flag for the automation to prioritize this
        }], true); // true = prepend to queue
        
        // 2. Wake up the GitHub Action immediately using the new INSTANT pipeline
        githubService.triggerInstantMission().catch(() => {});

        return res.json({
          success: true,
          queued: true,
          missionId,
          message: 'Instant Cloud Mission launched! Bot will finish in seconds...',
        });
      }
    }

    await historyService.add({
      url: cleanLink || sourceUrl,
      reelData: {
        username: reelMeta?.username || 'unknown',
        caption: reelMeta?.caption || '',
        thumbnailUrl: reelMeta?.thumbnailUrl || '',
        mediaType: reelMeta?.mediaType || 'video',
      },
      aiContent: {
        title: title.trim(),
        description: (description || '').trim(),
        hashtags: hashtags || [],
      },
      pinterestPin: {
        id: result.pin?.id || `pin_${Date.now()}`,
        url: result.pin?.url || '#',
        method: posting.useBrowserBot ? 'browser_bot' : 'api',
      },
      status: 'success',
      postedAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: posting.useBrowserBot
        ? 'Posted successfully with browser bot.'
        : 'Posted successfully with Pinterest API.',
      pin: result.pin,
    });
  } catch (error) {
    await historyService.add({
      url: req.body?.sourceUrl || '',
      reelData: {
        username: req.body?.reelMeta?.username || 'unknown',
        caption: '',
        thumbnailUrl: req.body?.reelMeta?.thumbnailUrl || '',
        mediaType: 'video',
      },
      aiContent: {
        title: req.body?.title || 'Failed post',
        description: '',
        hashtags: [],
      },
      pinterestPin: null,
      status: 'error',
      error: error.message,
      postedAt: new Date().toISOString(),
    });

    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/session/status', async (req, res) => {
  try {
    const session = await historyService.getSessionCookie();
    res.json({ success: true, session });
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

router.post('/session/auto-link', async (req, res) => {
  try {
    if (IS_SERVERLESS) {
      return res.status(400).json({
        success: false,
        error: 'Auto-link works only on local desktop runtime, not on serverless hosting.',
      });
    }

    if (!puppeteerService || typeof puppeteerService.autoLinkSessionFromLocalBrowser !== 'function') {
      return res.status(500).json({
        success: false,
        error: 'Puppeteer auto-link is unavailable in this environment.',
      });
    }

    const timeoutRaw = Number.parseInt(req.body?.timeoutMs || '120000', 10);
    const timeoutMs = Number.isFinite(timeoutRaw) ? Math.max(20000, timeoutRaw) : 120000;
    const profileDir = String(req.body?.profileDir || '').trim();

    const result = await puppeteerService.autoLinkSessionFromLocalBrowser({
      timeoutMs,
      profileDir,
    });

    return res.json({
      success: true,
      ...result,
      message: 'Session auto-linked from local browser.',
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

module.exports = router;

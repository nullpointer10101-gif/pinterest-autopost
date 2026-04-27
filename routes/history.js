const express = require('express');
const router = express.Router();
const axios = require('axios');
const historyService = require('../services/historyService');
const instagramService = require('../services/instagramService');
const { puppeteerService, IS_SERVERLESS } = require('./utils');
const githubService = require('../services/githubService');

const FALLBACK_THUMB =
  'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=100&h=130&fit=crop';

function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const clean = url.trim();
  if (!clean) return '';
  if (!/^https:\/\//i.test(clean)) return '';
  return clean;
}

function uniqueUrls(urls) {
  return Array.from(new Set(urls.filter(Boolean)));
}

function getHistoryThumbCandidates(item) {
  return uniqueUrls([
    normalizeUrl(item?.reelData?.thumbnailUrl),
    normalizeUrl(item?.thumbnailUrl),
    normalizeUrl(item?.mediaUrl),
  ]);
}

function getHistorySourceUrl(item) {
  return normalizeUrl(item?.url || item?.sourceUrl || '');
}

function isInstagramPostUrl(url) {
  return /instagram\.com\/(reel|p|tv)\//i.test(url || '');
}

async function fetchImageStream(url) {
  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 15000,
    maxRedirects: 5,
    validateStatus: () => true,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      Referer: 'https://www.instagram.com/',
    },
  });

  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  const okStatus = response.status >= 200 && response.status < 300;
  if (!okStatus || !contentType.startsWith('image/')) {
    response.data.resume();
    return null;
  }

  return {
    stream: response.data,
    contentType: response.headers['content-type'] || 'image/jpeg',
    contentLength: response.headers['content-length'] || null,
  };
}

async function tryStreamFirstImage(res, urls) {
  for (const url of urls) {
    try {
      const hit = await fetchImageStream(url);
      if (!hit) continue;
      res.setHeader('Content-Type', hit.contentType);
      if (hit.contentLength) res.setHeader('Content-Length', hit.contentLength);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      hit.stream.pipe(res);
      return true;
    } catch {
      // try next source
    }
  }
  return false;
}

router.get('/history', async (req, res) => {
  try {
    const history = await historyService.getAll();
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/history/thumb/:id', async (req, res) => {
  try {
    const item = await historyService.getById(req.params.id);
    if (!item) return res.redirect(FALLBACK_THUMB);

    const directCandidates = getHistoryThumbCandidates(item);
    const directHit = await tryStreamFirstImage(res, directCandidates);
    if (directHit) return;

    const sourceUrl = getHistorySourceUrl(item);
    if (isInstagramPostUrl(sourceUrl)) {
      try {
        const fresh = await instagramService.extractReel(sourceUrl);
        const refreshedThumb = normalizeUrl(fresh?.thumbnailUrl);
        const refreshedMedia = normalizeUrl(fresh?.mediaUrl);

        if (refreshedThumb && refreshedThumb !== normalizeUrl(item?.reelData?.thumbnailUrl)) {
          await historyService.updateById(item.id, { reelData: { thumbnailUrl: refreshedThumb } });
        }

        const refreshedHit = await tryStreamFirstImage(
          res,
          uniqueUrls([refreshedThumb, refreshedMedia])
        );
        if (refreshedHit) return;
      } catch {
        // fall back below
      }
    }

    return res.redirect(FALLBACK_THUMB);
  } catch {
    return res.redirect(FALLBACK_THUMB);
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

    if (IS_SERVERLESS) {
      console.log('[Engager] Routing to Cloud Bot (GitHub Actions)...');
      githubService.triggerInstantEngagement().catch(() => {});
      return res.json({
        success: true,
        queued: true,
        message: `Instant Algorithm Mission launched! Bot will start engaging in seconds...`,
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

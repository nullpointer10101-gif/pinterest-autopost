const express = require('express');
const router = express.Router();
const queueService = require('../services/queueService');
const githubService = require('../services/githubService');
const instagramService = require('../services/instagramService');
const axios = require('axios');

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

function getQueueThumbCandidates(item) {
  return uniqueUrls([
    normalizeUrl(item?.thumbnailUrl),
    normalizeUrl(item?.reelMeta?.thumbnailUrl),
    normalizeUrl(item?.mediaUrl),
  ]);
}

function getQueueSourceUrl(item) {
  return normalizeUrl(item?.sourceUrl || item?.originalSourceUrl || item?.url || '');
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

router.get('/', async (req, res) => {
  try {
    const queue = await queueService.getQueue();
    const stats = queueService.getQueueStats ? await queueService.getQueueStats() : null;
    res.json({ success: true, queue, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/thumb/:id', async (req, res) => {
  try {
    const queue = await queueService.getQueue();
    const item = queue.find((entry) => entry.id === req.params.id);
    if (!item) return res.redirect(FALLBACK_THUMB);

    const directCandidates = getQueueThumbCandidates(item);
    const directHit = await tryStreamFirstImage(res, directCandidates);
    if (directHit) return;

    const sourceUrl = getQueueSourceUrl(item);
    if (isInstagramPostUrl(sourceUrl)) {
      try {
        const fresh = await instagramService.extractReel(sourceUrl);
        const refreshedThumb = normalizeUrl(fresh?.thumbnailUrl);
        const refreshedMedia = normalizeUrl(fresh?.mediaUrl);
        const refreshedHit = await tryStreamFirstImage(
          res,
          uniqueUrls([refreshedThumb, refreshedMedia])
        );
        if (refreshedHit) return;
      } catch {
        // fall through
      }
    }

    return res.redirect(FALLBACK_THUMB);
  } catch {
    return res.redirect(FALLBACK_THUMB);
  }
});

router.post('/', async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Non-empty items array is required' });
    }
    const added = await queueService.addToQueue(items);
    
    // Fire instant mission immediately — no waiting
    githubService.triggerInstantMission().catch(() => {});

    res.json({ success: true, added, message: `Added ${added.length} item(s) to queue. GitHub Bot fired!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/', async (req, res) => {
  try {
    await queueService.clearQueue();
    res.json({ success: true, message: 'Queue cleared' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/retry-failed', async (req, res) => {
  try {
    const changed = await queueService.retryFailedItems();

    // Fire instant mission to process retried items
    if (changed > 0) {
      githubService.triggerInstantMission().catch(() => {});
    }

    res.json({ success: true, changed, message: `Moved ${changed} failed item(s) back to pending. Bot fired!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/process', async (req, res) => {
  try {
    // Always fire GitHub instant mission — no local processing
    console.log('[Queue] 🚀 Firing GitHub Bot instant mission...');
    githubService.triggerInstantMission().catch(() => {});
    return res.json({ 
      success: true, 
      queued: true, 
      message: '🚀 GitHub Bot fired! Processing will begin in ~30 seconds.' 
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await queueService.removeItem(req.params.id);
    res.json({ success: true, message: 'Item removed from queue' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/promote/:id', async (req, res) => {
  try {
    await queueService.promoteToFront(req.params.id);
    // Fire GitHub bot for the now-first item
    githubService.triggerInstantMission().catch(() => {});
    res.json({ success: true, message: 'Item promoted to front and bot fired!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;


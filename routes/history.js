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

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getPinterestEngagementTargets() {
  return {
    likeTarget: Math.max(0, toInt(process.env.AUTOMATION_ENGAGEMENT_LIKE_TARGET ?? process.env.AUTOMATION_ENGAGEMENT_LIKES_PER_HOUR, 5)),
    commentTarget: Math.max(0, toInt(process.env.AUTOMATION_ENGAGEMENT_COMMENT_TARGET ?? process.env.AUTOMATION_ENGAGEMENT_COMMENTS_PER_HOUR, 3)),
    niche: String(process.env.AUTOMATION_ENGAGEMENT_NICHE || 'mens_outfits').trim() || 'mens_outfits',
  };
}

function getEngagementDateKey(timeZone = 'Asia/Calcutta') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value || '1970';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  const day = parts.find((part) => part.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

function countEngagementKinds(entries = []) {
  const totals = { likes: 0, comments: 0, dispatches: 0, resets: 0 };
  for (const entry of entries) {
    const action = String(entry?.action || '').toLowerCase();
    if (action.includes('like')) totals.likes += 1;
    if (action.includes('comment')) totals.comments += 1;
    if (action.includes('dispatch')) totals.dispatches += 1;
    if (action.includes('reset')) totals.resets += 1;
  }
  return totals;
}

async function buildPinterestEngagementSummary(engagements = []) {
  const automation = await historyService.getAutomationState();
  const targets = getPinterestEngagementTargets();
  const currentDateKey = getEngagementDateKey(process.env.AUTOMATION_TIMEZONE || 'Asia/Calcutta');
  const now = Date.now();
  const windowStart = now - (24 * 60 * 60 * 1000);
  const recent = engagements.filter((entry) => {
    const ts = new Date(entry?.engagedAt || entry?.createdAt || '').getTime();
    return Number.isFinite(ts) && ts >= windowStart;
  });
  const recentCounts = countEngagementKinds(recent);
  const guardUntil = automation.circuitBreaker && new Date(automation.circuitBreaker).getTime() > now
    ? automation.circuitBreaker
    : null;

  return {
    strategy: 'random_mens_outfit_pins',
    strategyLabel: "Random men's outfit pins",
    targets,
    today: {
      likes: automation.engagementDateKey === currentDateKey ? Math.max(0, toInt(automation.likesToday, 0)) : 0,
      comments: automation.engagementDateKey === currentDateKey ? Math.max(0, toInt(automation.commentsToday, 0)) : 0,
    },
    last24h: recentCounts,
    guard: {
      active: !!guardUntil,
      until: guardUntil,
    },
    noSaves: true,
    lastActionAt: engagements[0]?.engagedAt || engagements[0]?.createdAt || null,
    lastHourlyRunAt: automation.lastRunAt || null,
  };
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

router.get('/history/snapshots', async (req, res) => {
  try {
    const snapshots = await historyService.listSnapshots('history');
    res.json({ success: true, snapshots });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/history/snapshots', async (req, res) => {
  try {
    const history = await historyService.getAll();
    const snapshot = await historyService.createSnapshot(
      'history',
      { items: history },
      {
        label: req.body?.label || 'History Snapshot',
        reason: req.body?.reason || 'manual',
      }
    );
    res.json({ success: true, snapshot, message: `History snapshot saved (${snapshot.count} items).` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/history/snapshots/:id/restore', async (req, res) => {
  try {
    const snapshot = await historyService.getSnapshot('history', req.params.id);
    if (!snapshot) {
      return res.status(404).json({ success: false, error: 'History snapshot not found.' });
    }

    await historyService.setPostsData(Array.isArray(snapshot.items) ? snapshot.items : []);
    res.json({ success: true, restoredCount: snapshot.count || 0, message: 'History restored from snapshot.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/engagements', async (req, res) => {
  try {
    const engagements = await historyService.getEngagements();
    const summary = await buildPinterestEngagementSummary(engagements);
    res.json({ success: true, engagements, summary });
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

router.post('/engagements/reset-state', async (req, res) => {
  try {
    const resetDaily = req.body?.resetDaily === true;
    const automation = await historyService.resetEngagementAutomationState({ resetDaily });

    await historyService.addEngagement({
      url: '',
      action: resetDaily ? 'Reset Engagement State' : 'Reset Engagement Guard',
      comment: resetDaily
        ? 'Daily Pinterest engagement counters and guard were reset from the dashboard.'
        : 'Pinterest engagement circuit breaker was cleared from the dashboard.',
      source: 'api_manual',
      command: 'POST /api/engagements/reset-state',
      actor: 'dashboard_user',
      engagedAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      automation,
      message: resetDaily
        ? 'Engagement guard and daily counters reset.'
        : 'Engagement guard reset.',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/engage', async (req, res) => {
  try {
    const hardCap = Math.max(1, parseInt(process.env.AUTOMATION_ENGAGEMENTS_HARD_CAP || '20', 10));
    const defaults = getPinterestEngagementTargets();
    const requestedLikeTarget = Math.max(1, toInt(req.body?.likeTarget ?? req.body?.count, defaults.likeTarget));
    const requestedCommentTarget = Math.max(0, toInt(req.body?.commentTarget, defaults.commentTarget));
    const likeTarget = Math.min(requestedLikeTarget, hardCap);
    const commentTarget = Math.max(0, Math.min(requestedCommentTarget, Math.max(0, hardCap - likeTarget)));
    const totalTarget = Math.max(1, likeTarget + commentTarget);
    const niche = String(req.body?.niche || defaults.niche).trim() || defaults.niche;
    const targetCount = Math.min(totalTarget, hardCap);
    
    if (!puppeteerService || typeof puppeteerService.runAutoEngager !== 'function') {
      return res.status(500).json({
        success: false,
        error: 'Algorithm booster requires puppeteer and is unavailable in this environment.',
      });
    }

    if (IS_SERVERLESS) {
      console.log(`[Engager] Routing to Cloud Bot (GitHub Actions)... Niche: ${niche} | Likes: ${likeTarget} | Comments: ${commentTarget}`);
      await historyService.addEngagement({
        url: '',
        action: 'Dispatch Engagement Mission',
        comment: `Queued Pinterest engagement profile: ${likeTarget} likes + ${commentTarget} comments for ${niche}.`,
        source: 'github_actions',
        command: 'workflow_dispatch instant-engagement.yml',
        workflow: 'instant-engagement.yml',
        actor: 'dashboard_user',
        engagedAt: new Date().toISOString(),
      });
      const dispatch = await githubService.triggerInstantEngagement({ likeTarget, commentTarget, niche });
      if (!dispatch.success) {
        return res.status(502).json({
          success: false,
          queued: true,
          error: `Engagement mission was recorded, but GitHub Actions did not start: ${dispatch.error || 'dispatch failed'}`,
        });
      }
      return res.json({
        success: true,
        queued: true,
        engagementDispatched: true,
        message: `Pinterest engagement mission launched for ${likeTarget} likes and ${commentTarget} comments.`,
      });
    }

    puppeteerService.runAutoEngager({
      count: targetCount,
      niche: niche,
      likeTarget,
      commentTarget,
      context: {
        source: 'api_manual',
        command: 'POST /api/engage',
      },
    }).catch(err => {
      console.error('[Engager] Background error:', err.message);
    });

    res.json({
      success: true,
      requested: totalTarget,
      targetCount,
      hardCap,
      targets: { likeTarget, commentTarget, niche },
      message: `Started Pinterest engagement for ${likeTarget} likes and ${commentTarget} comments.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

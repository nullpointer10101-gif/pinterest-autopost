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

    const missionId = `mission_${Date.now()}`;

    // 🚀 INSTANT GitHub Bot — prepend to queue front + fire immediately
    console.log(`[Post Mission] 🚀 Instant GitHub Bot — queueing + firing NOW...`);

    await queueService.addToQueue([{
      id: missionId,
      title: title.trim(),
      description: descWithTags,
      altText: altText ? altText.trim() : '',
      mediaUrl,
      sourceUrl: cleanLink,
      originalSourceUrl: sourceUrl || '',
      username: reelMeta?.username || 'unknown',
      caption: reelMeta?.caption || '',
      thumbnailUrl: reelMeta?.thumbnailUrl || mediaUrl,
      reelMeta,
      isInstant: true,
    }], true); // true = prepend to front of queue

    // Fire GitHub Actions instant mission — fire-and-forget, no blocking
    githubService.triggerInstantMission().catch((err) => {
      console.error('[Post Mission] GitHub trigger background error:', err.message);
    });

    return res.json({
      success: true,
      queued: true,
      missionId,
      message: '🚀 Instant Mission fired! GitHub Bot will post in ~60 seconds.',
    });
  } catch (error) {
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

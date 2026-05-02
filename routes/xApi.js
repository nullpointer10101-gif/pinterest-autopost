const express = require('express');
const router = express.Router();

const xQueueService = require('../services/xQueueService');
const xHistoryService = require('../services/xHistoryService');
const xAutomationService = require('../services/xAutomationService');
const githubService = require('../services/githubService');

// === X QUEUE ROUTES ===

router.get('/queue', async (req, res) => {
  try {
    const queue = await xQueueService.getQueue();
    const stats = xQueueService.getQueueStats ? await xQueueService.getQueueStats() : null;
    res.json({ success: true, queue, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/queue', async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Non-empty items array is required' });
    }
    const added = await xQueueService.addToQueue(items);
    
    // Fire instant mission
    githubService.triggerXFirePost().catch(() => {});

    res.json({ success: true, added, message: `Added ${added.length} item(s) to X queue. GitHub Bot fired!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/queue', async (req, res) => {
  try {
    await xQueueService.clearQueue();
    res.json({ success: true, message: 'X Queue cleared' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === X HISTORY ROUTES ===

router.get('/history', async (req, res) => {
  try {
    const history = await xHistoryService.getAll();
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/engagements', async (req, res) => {
  try {
    const engagements = await xHistoryService.getEngagements();
    res.json({ success: true, engagements });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === X AUTOMATION ROUTES ===

router.post('/automation/run', async (req, res) => {
  try {
    const { force } = req.body || {};
    const result = await xAutomationService.runHourlyAutomation({ force });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === X FIRE POST ROUTE ===

router.post('/fire-post', async (req, res) => {
  try {
    console.log('[X-Queue] 🚀 Firing GitHub Bot instant mission...');
    githubService.triggerXFirePost().catch(() => {});
    return res.json({ 
      success: true, 
      queued: true, 
      message: '🚀 GitHub Bot fired for X! Processing will begin in ~30 seconds.' 
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// === X SESSION ROUTES ===

router.post('/session', async (req, res) => {
  try {
    const { cookie } = req.body;
    if (!cookie) return res.status(400).json({ success: false, error: 'Cookie required' });
    const result = await xHistoryService.setSessionCookie(cookie, 'manual-api');
    res.json({ success: true, session: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/session/status', async (req, res) => {
  try {
    const session = await xHistoryService.getSessionCookie();
    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/session', async (req, res) => {
  try {
    const result = await xHistoryService.clearSessionCookie();
    res.json({ success: true, session: result, message: 'X session unlinked.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === X ENGAGE ROUTE ===
router.post('/engage', async (req, res) => {
  try {
    const count = parseInt(req.body.count, 10) || 3;
    console.log(`[X-Engage] 🚀 Firing GitHub Bot instant engagement with count: ${count}...`);
    
    const result = await githubService.triggerXInstantEngagement(count);
    
    if (!result.success) {
      return res.status(500).json({ 
        success: false, 
        error: result.error || 'GitHub dispatch failed',
        hint: !process.env.GH_PAT_TOKEN 
          ? 'GH_PAT_TOKEN is missing from Vercel environment variables. Add it with workflow scope.' 
          : 'Check that GH_PAT_TOKEN has the correct workflow permissions.'
      });
    }

    return res.json({ 
      success: true, 
      queued: true, 
      message: `🚀 X Engager fired for ${count} tweets! It will run in the background.` 
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// === DIAGNOSTIC: Test GitHub dispatch ===
router.get('/debug-dispatch', async (req, res) => {
  const axios = require('axios');
  const token = process.env.GH_PAT_TOKEN || process.env.GITHUB_TOKEN;

  if (!token) {
    return res.json({ success: false, error: 'No token found', env: { GH_PAT_TOKEN: false, GITHUB_TOKEN: false } });
  }

  const tokenPreview = `${token.slice(0, 6)}...${token.slice(-4)}`;

  try {
    // Test 1: Check token scopes
    const meResp = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      }
    });
    const scopes = meResp.headers['x-oauth-scopes'] || 'not returned';
    const login = meResp.data.login;

    // Test 2: Try actual dispatch
    let dispatchStatus = null;
    let dispatchError = null;
    try {
      const dispatchResp = await axios.post(
        `https://api.github.com/repos/nullpointer10101-gif/pinterest-autopost/actions/workflows/x-instant-engagement.yml/dispatches`,
        { ref: 'main', inputs: { count: '1' } },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          }
        }
      );
      dispatchStatus = dispatchResp.status;
    } catch (e) {
      dispatchError = { status: e.response?.status, message: e.response?.data?.message || e.message };
    }

    return res.json({
      success: true,
      token: tokenPreview,
      tokenType: process.env.GH_PAT_TOKEN ? 'GH_PAT_TOKEN' : 'GITHUB_TOKEN',
      githubLogin: login,
      scopes,
      dispatchStatus,
      dispatchError,
      hasWorkflowScope: scopes.includes('workflow') || scopes.includes('repo'),
    });
  } catch (e) {
    return res.json({ success: false, tokenPreview, error: e.response?.data?.message || e.message });
  }
});

module.exports = router;

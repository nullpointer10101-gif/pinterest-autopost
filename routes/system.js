const express = require('express');
const router = express.Router();
const historyService = require('../services/historyService');
const queueService = require('../services/queueService');
const { IS_PRODUCTION, IS_SERVERLESS, resolvePostingMode, puppeteerService } = require('./utils');

router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'API is running',
    timestamp: new Date().toISOString(),
    environment: IS_PRODUCTION ? 'production' : 'development',
    isServerless: IS_SERVERLESS,
    puppeteerAvailable: !!puppeteerService,
  });
});

router.get('/status', async (req, res) => {
  try {
    const queueStats = queueService.getQueueStats ? await queueService.getQueueStats() : null;
    const storage = historyService.getStorageInfo ? historyService.getStorageInfo() : null;
    const session = await historyService.getSessionCookie();
    const posting = resolvePostingMode();

    res.json({
      success: true,
      runtime: {
        environment: IS_PRODUCTION ? 'production' : 'development',
        platform: process.env.VERCEL
          ? 'vercel'
          : process.env.NETLIFY
            ? 'netlify'
            : process.env.AWS_LAMBDA_FUNCTION_NAME
              ? 'aws_lambda'
              : 'node',
        isServerless: IS_SERVERLESS,
        nodeVersion: process.version,
      },
      posting: {
        configuredMode: 'bot',
        resolvedMode: 'bot',
        botAvailable: true,
        botUsable: true,
        sessionCookieConfigured: !!session.hasSession,
        recommendation: 'GitHub Bot mode — all posting goes through GitHub Actions.',
      },
      queue: queueStats,
      storage,
      session,
      ai: {
        configured: !!(process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY),
        model: process.env.AI_MODEL || process.env.OPENAI_MODEL || process.env.QWEN_MODEL || process.env.DASHSCOPE_MODEL || null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const ALLOWED_PROXY_DOMAINS = [
  'instagram.com',
  'cdninstagram.com',
  'fbcdn.net',
  'scontent.cdninstagram.com',
  'images.unsplash.com',
  'i.pinimg.com',
  'pinimg.com',
];

function isAllowedProxyUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_PROXY_DOMAINS.some(domain => u.hostname.endsWith(domain));
  } catch {
    return false;
  }
}

router.get('/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('URL is required');
  if (!isAllowedProxyUrl(url)) {
    return res.status(403).send('Domain not allowed');
  }

  try {
    const axios = require('axios');
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      Referer: 'https://www.instagram.com/',
    };
    if (req.headers.range) headers.range = req.headers.range;

    const response = await axios.get(url, {
      responseType: 'stream',
      headers,
      timeout: 10000,
    });

    res.set('Content-Type', response.headers['content-type']);
    if (response.headers['content-length']) res.set('Content-Length', response.headers['content-length']);
    if (response.headers['accept-ranges']) res.set('Accept-Ranges', response.headers['accept-ranges']);
    if (response.headers['content-range']) res.set('Content-Range', response.headers['content-range']);

    response.data.pipe(res);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;

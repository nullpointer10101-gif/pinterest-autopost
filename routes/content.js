const express = require('express');
const router = express.Router();
const instagramService = require('../services/instagramService');
const aiService = require('../services/aiService');

router.post('/extract', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'URL is required' });
    const data = await instagramService.extractReel(url);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/test-extract', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ success: false, error: 'url query param required' });
  try {
    const data = await instagramService.extractReel(url);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/generate', async (req, res) => {
  try {
    const { caption, username, mediaType } = req.body;
    const content = await aiService.generatePinterestContent({ caption, username, mediaType });
    res.json({ success: true, content });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('URL required');
  
  try {
    const axios = require('axios');
    const response = await axios.get(url, {
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        'Referer': 'https://www.instagram.com/',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"iOS"',
        'sec-fetch-dest': 'image',
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-site': 'cross-site'
      },
      timeout: 10000,
      validateStatus: false
    });
    
    const contentType = response.headers['content-type'];
    if (contentType) res.setHeader('Content-Type', contentType);
    
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    response.data.pipe(res);
  } catch (err) {
    console.error('[Ghost Proxy] Error:', err.message);
    res.status(500).send('Proxy failure');
  }
});

module.exports = router;

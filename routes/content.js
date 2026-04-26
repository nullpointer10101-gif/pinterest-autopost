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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Referer': 'https://www.instagram.com/'
      }
    });
    
    res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24h
    response.data.pipe(res);
  } catch (err) {
    console.error('[Proxy] Error fetching media:', err.message);
    res.status(500).send('Error fetching media');
  }
});

module.exports = router;

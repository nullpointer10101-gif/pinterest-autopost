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

module.exports = router;

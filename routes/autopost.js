const express = require('express');
const router = express.Router();
const instagramService = require('../services/instagramService');
const aiService = require('../services/aiService');
const historyService = require('../services/historyService');
const queueService = require('../services/queueService');
const githubService = require('../services/githubService');

router.post('/', async (req, res) => {
  const { url, altText = '', autoPost = true } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'Instagram Reel URL is required' });

  const jobStatus = { step: '', reelData: null, aiContent: null };

  try {
    jobStatus.step = 'extracting';
    const reelData = await instagramService.extractReel(url);
    jobStatus.reelData = reelData;

    jobStatus.step = 'generating';
    const aiContent = await aiService.generatePinterestContent({
      caption: reelData.caption,
      username: reelData.username,
      mediaType: reelData.mediaType,
    });
    jobStatus.aiContent = aiContent;

    if (autoPost) {
      jobStatus.step = 'posting';
      const missionId = `autopost_${Date.now()}`;

      // Queue + fire GitHub Bot immediately
      await queueService.addToQueue([{
        id: missionId,
        title: (aiContent.title || '').substring(0, 100),
        description: (aiContent.description || '').substring(0, 800),
        altText,
        mediaUrl: reelData.mediaUrl || reelData.thumbnailUrl,
        sourceUrl: url,
        reelMeta: {
          username: reelData.username,
          caption: reelData.caption,
          thumbnailUrl: reelData.thumbnailUrl,
          mediaType: reelData.mediaType,
        },
        isInstant: true,
      }], true);

      githubService.triggerInstantMission().catch(() => {});

      res.json({
        success: true,
        step: 'queued',
        reelData,
        aiContent,
        missionId,
        message: '🚀 Mission fired! GitHub Bot will post in ~60 seconds.',
      });
    } else {
      await historyService.add({
        url,
        reelData: {
          username: reelData.username,
          caption: reelData.caption,
          thumbnailUrl: reelData.thumbnailUrl,
          mediaType: reelData.mediaType,
        },
        aiContent,
        pinterestPin: null,
        status: 'preview',
        postedAt: new Date().toISOString(),
      });

      res.json({
        success: true,
        step: 'preview',
        reelData,
        aiContent,
        message: 'Content generated and ready to review.',
      });
    }
  } catch (err) {
    console.error('[PIPELINE ERROR]', err.message);
    res.status(400).json({
      success: false,
      step: jobStatus.step,
      error: err.message,
    });
  }
});

module.exports = router;

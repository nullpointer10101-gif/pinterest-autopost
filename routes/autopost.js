const express = require('express');
const router = express.Router();
const instagramService = require('../services/instagramService');
const aiService = require('../services/aiService');
const pinterestService = require('../services/pinterestService');
const historyService = require('../services/historyService');
const { resolvePostingMode, puppeteerService } = require('./utils');

router.post('/', async (req, res) => {
  const { url, altText = '', autoPost = true } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'Instagram Reel URL is required' });

  const jobStatus = { step: '', reelData: null, aiContent: null, pinterestResult: null };

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

    let pinterestResult = null;
    const posting = resolvePostingMode();
    if (autoPost) {
      jobStatus.step = 'posting';
      if (posting.useBrowserBot) {
        pinterestResult = await puppeteerService.createPinWithBot({
          title: aiContent.title,
          description: aiContent.description,
          alt_text: altText,
          link: url,
          media_source: { url: reelData.thumbnailUrl || reelData.mediaUrl, source_type: 'video_url' },
        });
        pinterestResult = pinterestResult.pin;
      } else {
        pinterestResult = await pinterestService.createPin({
          title: aiContent.title,
          description: aiContent.description,
          hashtags: aiContent.hashtags,
          altText,
          mediaUrl: reelData.thumbnailUrl || reelData.mediaUrl,
          link: url,
        });
      }
      jobStatus.pinterestResult = pinterestResult;
    }

    await historyService.add({
      url,
      reelData: {
        username: reelData.username,
        caption: reelData.caption,
        thumbnailUrl: reelData.thumbnailUrl,
        mediaType: reelData.mediaType,
      },
      aiContent,
      pinterestPin: autoPost ? pinterestResult : null,
      status: autoPost ? 'success' : 'preview',
      postedAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      step: autoPost ? 'posted' : 'preview',
      reelData,
      aiContent,
      pinterestResult,
      message: autoPost ? 'Successfully posted to Pinterest.' : 'Content generated and ready to review.',
    });
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

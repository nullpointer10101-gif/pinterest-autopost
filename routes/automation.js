const express = require('express');
const router = express.Router();
const queueService = require('../services/queueService');
const historyService = require('../services/historyService');
const automationService = require('../services/automationService');

function isAutomationAuthorized(req) {
  const secret = process.env.AUTOMATION_SECRET;
  if (!secret) return false;
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  return token === secret;
}

router.get('/status', async (req, res) => {
  if (!isAutomationAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized automation request' });
  }

  try {
    const queueStats = await queueService.getQueueStats();
    const automation = await historyService.getAutomationState();
    return res.json({
      success: true,
      queue: queueStats,
      automation,
      limits: {
        maxPostsPerDay: parseInt(process.env.AUTOMATION_MAX_POSTS_PER_DAY || '10', 10),
        maxPostsPerRun: parseInt(process.env.AUTOMATION_MAX_POSTS_PER_RUN || '2', 10),
        engagementsPerHour: parseInt(process.env.AUTOMATION_ENGAGEMENTS_PER_HOUR || '2', 10),
        engagementsHardCap: parseInt(process.env.AUTOMATION_ENGAGEMENTS_HARD_CAP || '2', 10),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/run-hourly', async (req, res) => {
  if (!isAutomationAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized automation request' });
  }

  try {
    const result = await automationService.runHourlyAutomation({
      maxPostsPerDay: req.body?.maxPostsPerDay,
      maxPostsPerRun: req.body?.maxPostsPerRun,
      engagementCount: req.body?.engagementCount,
      timeZone: req.body?.timeZone,
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

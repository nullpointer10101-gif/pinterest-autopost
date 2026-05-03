const express = require('express');
const router = express.Router();
const historyService = require('../services/historyService');


const authRoutes = require('./auth');
const contentRoutes = require('./content');
const pinterestRoutes = require('./pinterest');
const queueRoutes = require('./queue');
const systemRoutes = require('./system');
const historyRoutes = require('./history');
const automationRoutes = require('./automation');
const autopostRoutes = require('./autopost');
const xApiRoutes = require('./xApi');
const igTrackerRoutes = require('./igTrackerApi');

// Mount sub-routers - System first for priority
router.use('/system', systemRoutes);

// Direct fallback for workflow toggles to ensure zero-fail UI connectivity
router.post('/system/workflows', async (req, res) => {
  try {
    const config = await historyService.setWorkflowConfig(req.body);
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.use('/', authRoutes);
router.use('/', contentRoutes);
router.use('/pinterest', pinterestRoutes);
router.use('/', historyRoutes);
router.use('/autopost', autopostRoutes);
router.use('/queue', queueRoutes);
router.use('/automation', automationRoutes);
router.use('/x', xApiRoutes);
router.use('/ig-tracker', igTrackerRoutes);

module.exports = router;

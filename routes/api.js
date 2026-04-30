const express = require('express');
const router = express.Router();

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

// Mount sub-routers
// We mount most at root '/' to maintain exact backwards compatibility with existing frontend paths
router.use('/', authRoutes);
router.use('/', contentRoutes);
router.use('/pinterest', pinterestRoutes);
router.use('/', systemRoutes);
router.use('/', historyRoutes);
router.use('/autopost', autopostRoutes);
router.use('/queue', queueRoutes);
router.use('/automation', automationRoutes);
router.use('/x', xApiRoutes);
router.use('/ig-tracker', igTrackerRoutes);

module.exports = router;

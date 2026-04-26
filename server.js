require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const apiRoutes = require('./routes/api');
const queueService = require('./services/queueService');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', apiRoutes);
app.use('/auth', apiRoutes);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error',
  });
});

// In serverless environments there is no reliable always-on process.
if (!IS_SERVERLESS) {
  setInterval(() => {
    queueService.processNextInQueue().catch((err) => {
      console.error('[Queue Worker] Error:', err.message);
    });
  }, 2 * 60 * 1000);
}

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\nReel to Pinterest Auto Poster running at http://localhost:${PORT}`);
    console.log(`Dashboard: http://localhost:${PORT}`);
    console.log(`API:       http://localhost:${PORT}/api`);
    if (!IS_SERVERLESS) {
      console.log('Queue processor: enabled (checks every 2 mins)');
    }
    console.log('');
  });
}

module.exports = app;

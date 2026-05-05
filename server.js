require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', apiRoutes);
app.use('/auth', apiRoutes);

// Dynamic Shop The Look Landing Pages
const lookRoutes = require('./routes/look');
app.use('/look', lookRoutes);

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

// No local queue processor — all posting goes through GitHub Actions bot
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\nReel to Pinterest Auto Poster running at http://localhost:${PORT}`);
    console.log(`Dashboard: http://localhost:${PORT}`);
    console.log(`API:       http://localhost:${PORT}/api`);
    console.log('Posting mode: GitHub Actions Bot (instant fire-and-forget)');
    console.log('');
  });
}

module.exports = app;

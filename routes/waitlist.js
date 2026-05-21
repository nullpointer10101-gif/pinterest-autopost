const express = require('express');
const waitlistStorageService = require('../services/waitlistStorageService');

const router = express.Router();

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

router.post('/', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim();
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, error: 'Enter a valid email address.' });
    }

    const result = await waitlistStorageService.addSignup({
      name: req.body?.name,
      email,
      company: req.body?.company,
      role: req.body?.role,
      website: req.body?.website,
      monthlyVolume: req.body?.monthlyVolume || req.body?.monthly_volume,
      primaryUseCase: req.body?.primaryUseCase || req.body?.primary_use_case,
      socialHandle: req.body?.socialHandle || req.body?.social_handle,
      message: req.body?.message,
      source: req.body?.source || 'landing_page',
      userAgent: req.get('user-agent') || '',
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '',
    });

    res.json({
      success: true,
      duplicate: result.duplicate,
      message: result.duplicate
        ? 'You are already on the waitlist. Your details were updated.'
        : 'You are on the waitlist. We will reach out when access opens.',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const signups = await waitlistStorageService.getSignups();
    res.json({ success: true, total: signups.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

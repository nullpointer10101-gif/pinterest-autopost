const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const historyService = require('../services/historyService');
const { getRedirectUri, IS_PRODUCTION } = require('./utils');

router.get(['/pinterest', '/auth/pinterest'], async (req, res) => {
  const appId = process.env.PINTEREST_APP_ID;
  if (!appId) return res.status(500).send('PINTEREST_APP_ID not set in .env');

  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  await historyService.savePkce(state, codeVerifier);

  const redirectUri = getRedirectUri(req);
  const params = new URLSearchParams({
    consumer_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'pins:write,pins:read,boards:read,user_accounts:read',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });

  res.redirect(`https://www.pinterest.com/oauth/?${params}`);
});

router.get(['/callback', '/auth/callback'], async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    return res.send(oauthPage('error', `Pinterest denied access: ${error}`));
  }

  const codeVerifier = state ? await historyService.getPkce(state) : null;
  if (!code || !state || !codeVerifier) {
    return res.send(oauthPage('error', 'Invalid OAuth state. Please try again.'));
  }

  await historyService.deletePkce(state);

  try {
    const redirectUri = getRedirectUri(req);
    const tokenRes = await axios.post(
      'https://api.pinterest.com/v5/oauth/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${process.env.PINTEREST_APP_ID}:`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenRes.data;
    await historyService.saveTokens({ access_token, refresh_token, expires_in });

    if (!IS_PRODUCTION) {
      try {
        const envPath = path.join(__dirname, '../.env');
        if (fs.existsSync(envPath)) {
          let envContent = fs.readFileSync(envPath, 'utf8');
          envContent = envContent.replace(/PINTEREST_ACCESS_TOKEN=.*/, `PINTEREST_ACCESS_TOKEN=${access_token}`);
          envContent = envContent.replace(/PINTEREST_SANDBOX=true\n?/g, '');
          if (refresh_token) {
            if (envContent.includes('PINTEREST_REFRESH_TOKEN=')) {
              envContent = envContent.replace(/PINTEREST_REFRESH_TOKEN=.*/, `PINTEREST_REFRESH_TOKEN=${refresh_token}`);
            } else {
              envContent += `\nPINTEREST_REFRESH_TOKEN=${refresh_token}`;
            }
          }
          fs.writeFileSync(envPath, envContent.trim() + '\n');
        }
      } catch (e) {
        console.warn('[OAuth] Failed to write .env:', e.message);
      }
    }

    return res.send(oauthPage('success', 'Pinterest connected successfully.'));
  } catch (err) {
    const detail = JSON.stringify(err.response?.data || err.message, null, 2);
    console.error('[OAuth] Token exchange error:', detail);
    return res.send(oauthPage('error', `Token exchange failed: ${detail}`));
  }
});

function oauthPage(type, message) {
  const success = type === 'success';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${success ? 'Pinterest Connected' : 'OAuth Error'}</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:#0e1116; color:#f5f7fa; margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; }
    .box { max-width:520px; background:#171b22; border:1px solid #2a303a; border-radius:14px; padding:28px; }
    h1 { margin:0 0 10px; color:${success ? '#10b981' : '#ef4444'}; font-size:24px; }
    p { margin:0 0 16px; color:#bcc6d4; line-height:1.5; }
    a { display:inline-block; background:#e60023; color:#fff; text-decoration:none; padding:10px 16px; border-radius:8px; font-weight:600; }
  </style>
</head>
<body>
  <div class="box">
    <h1>${success ? 'Connection Complete' : 'Connection Failed'}</h1>
    <p>${message}</p>
    ${success ? '<a href="/">Open dashboard</a>' : ''}
  </div>
</body>
</html>`;
}

module.exports = router;

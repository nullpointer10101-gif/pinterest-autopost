const crypto = require('crypto');
const express = require('express');

const router = express.Router();

const COOKIE_NAME = 'pa_owner_session';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const OWNER_USERNAME = process.env.OWNER_USERNAME || 'meela';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'meela';
const OWNER_SECRET = process.env.OWNER_SESSION_SECRET
  || process.env.AUTOMATION_API_TOKEN
  || process.env.GITHUB_TOKEN
  || 'pinterest-autopost-owner-session';

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function signPayload(payload) {
  const encoded = base64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', OWNER_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyToken(token) {
  const [encoded, signature] = String(token || '').split('.');
  if (!encoded || !signature) return null;
  const expected = crypto
    .createHmac('sha256', OWNER_SECRET)
    .update(encoded)
    .digest('base64url');
  const valid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return null;

  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function parseCookies(header = '') {
  return String(header || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const idx = part.indexOf('=');
      if (idx === -1) return cookies;
      cookies[part.slice(0, idx)] = decodeURIComponent(part.slice(idx + 1));
      return cookies;
    }, {});
}

function getOwnerSession(req) {
  try {
    const cookies = parseCookies(req.headers.cookie || '');
    return verifyToken(cookies[COOKIE_NAME]);
  } catch {
    return null;
  }
}

function setOwnerCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure}`
  );
}

function clearOwnerCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
}

function requireOwnerSession(req, res, next) {
  const session = getOwnerSession(req);
  if (session) {
    req.owner = session;
    return next();
  }

  if ((req.get('accept') || '').includes('application/json')) {
    return res.status(401).json({ success: false, error: 'Owner login required' });
  }
  return res.redirect('/?login=1');
}

router.get('/me', (req, res) => {
  const session = getOwnerSession(req);
  res.json({
    success: true,
    loggedIn: !!session,
    username: session?.sub || '',
  });
});

router.post('/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (username !== OWNER_USERNAME || password !== OWNER_PASSWORD) {
    return res.status(401).json({ success: false, error: 'Invalid username or password.' });
  }

  const now = Math.floor(Date.now() / 1000);
  const token = signPayload({
    sub: OWNER_USERNAME,
    iat: now,
    exp: now + SESSION_SECONDS,
  });
  setOwnerCookie(res, token);
  res.json({ success: true, redirect: '/dashboard' });
});

router.post('/logout', (req, res) => {
  clearOwnerCookie(res);
  res.json({ success: true });
});

module.exports = {
  router,
  requireOwnerSession,
  getOwnerSession,
};

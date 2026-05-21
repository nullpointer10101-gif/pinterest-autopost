const fs = require('fs/promises');
const path = require('path');
const persistencePolicy = require('./persistencePolicy');

const REPO_WAITLIST_FILE = path.join(__dirname, '..', 'data', 'waitlist.json');
const WAITLIST_FILE = persistencePolicy.getStateFilePath('waitlist.json');
const WAITLIST_KEY = process.env.APP_WAITLIST_STATE_KEY || 'product_waitlist_v1';

async function runUpstashCommand(command) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(persistencePolicy.UPSTASH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${persistencePolicy.UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Upstash HTTP ${res.status}${data?.error ? `: ${data.error}` : ''}`);
    if (data?.error) throw new Error(`Upstash error: ${data.error}`);
    return data?.result ?? null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function ensureDataDir() {
  await fs.mkdir(path.dirname(WAITLIST_FILE), { recursive: true }).catch(() => {});
}

async function readLocalWaitlist(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLocalWaitlist(signups) {
  await ensureDataDir();
  await fs.writeFile(WAITLIST_FILE, JSON.stringify(signups, null, 2), 'utf-8');
}

async function loadWaitlist() {
  if (persistencePolicy.USE_UPSTASH) {
    try {
      const raw = await runUpstashCommand(['GET', WAITLIST_KEY]);
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(parsed) ? parsed : [];
      }

      const seeded = await readLocalWaitlist(REPO_WAITLIST_FILE);
      await runUpstashCommand(['SET', WAITLIST_KEY, JSON.stringify(seeded)]).catch(() => {});
      return seeded;
    } catch (err) {
      console.warn('[Waitlist Storage] Upstash read failed:', err.message);
      if (!persistencePolicy.isLocalStateEnabled()) return [];
    }
  }

  const local = await readLocalWaitlist(WAITLIST_FILE);
  return local.length > 0 ? local : readLocalWaitlist(REPO_WAITLIST_FILE);
}

async function saveWaitlist(signups) {
  const safeSignups = Array.isArray(signups) ? signups : [];
  if (persistencePolicy.USE_UPSTASH) {
    try {
      await runUpstashCommand(['SET', WAITLIST_KEY, JSON.stringify(safeSignups)]);
      if (persistencePolicy.isLocalStateEnabled()) await writeLocalWaitlist(safeSignups).catch(() => {});
      return;
    } catch (err) {
      console.warn('[Waitlist Storage] Upstash write failed:', err.message);
      if (!persistencePolicy.isLocalStateEnabled()) throw err;
    }
  }

  await writeLocalWaitlist(safeSignups);
}

function cleanText(value, maxLength = 240) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function addSignup(input = {}) {
  const email = normalizeEmail(input.email);
  if (!email) throw new Error('Email is required');

  const waitlist = await loadWaitlist();
  const now = new Date().toISOString();
  const nextSignup = {
    id: cleanText(input.id, 80) || `wait_${Date.now()}`,
    name: cleanText(input.name, 120),
    email,
    company: cleanText(input.company, 140),
    role: cleanText(input.role, 120),
    website: cleanText(input.website, 220),
    monthlyVolume: cleanText(input.monthlyVolume, 80),
    primaryUseCase: cleanText(input.primaryUseCase, 180),
    socialHandle: cleanText(input.socialHandle, 140),
    message: cleanText(input.message, 800),
    source: cleanText(input.source, 120) || 'landing_page',
    userAgent: cleanText(input.userAgent, 260),
    ip: cleanText(input.ip, 80),
    createdAt: now,
    updatedAt: now,
  };

  const existingIndex = waitlist.findIndex((signup) => normalizeEmail(signup.email) === email);
  if (existingIndex >= 0) {
    const existing = waitlist[existingIndex];
    waitlist[existingIndex] = {
      ...existing,
      ...nextSignup,
      id: existing.id || nextSignup.id,
      createdAt: existing.createdAt || nextSignup.createdAt,
      updatedAt: now,
    };
    await saveWaitlist(waitlist);
    return { signup: waitlist[existingIndex], duplicate: true };
  }

  waitlist.push(nextSignup);
  await saveWaitlist(waitlist);
  return { signup: nextSignup, duplicate: false };
}

async function getSignups() {
  return loadWaitlist();
}

module.exports = {
  addSignup,
  getSignups,
};

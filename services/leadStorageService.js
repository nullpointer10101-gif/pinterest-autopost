const fs = require('fs/promises');
const path = require('path');
const persistencePolicy = require('./persistencePolicy');

const REPO_LEADS_FILE = path.join(__dirname, '..', 'data', 'leads.json');
const LEADS_FILE = persistencePolicy.getStateFilePath('leads.json');
const LEADS_KEY = process.env.APP_LEADS_STATE_KEY || 'bridge_leads_v1';

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
  const dir = path.dirname(LEADS_FILE);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    // ignore
  }
}

async function readLocalLeads(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

async function writeLocalLeads(leads) {
  await ensureDataDir();
  await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2), 'utf-8');
}

async function loadLeads() {
  if (persistencePolicy.USE_UPSTASH) {
    try {
      const raw = await runUpstashCommand(['GET', LEADS_KEY]);
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(parsed) ? parsed : [];
      }

      const seeded = await readLocalLeads(REPO_LEADS_FILE);
      await runUpstashCommand(['SET', LEADS_KEY, JSON.stringify(seeded)]).catch(() => {});
      return seeded;
    } catch (err) {
      console.warn('[Lead Storage] Upstash read failed:', err.message);
      if (!persistencePolicy.isLocalStateEnabled()) return [];
    }
  }

  const local = await readLocalLeads(LEADS_FILE);
  return local.length > 0 ? local : readLocalLeads(REPO_LEADS_FILE);
}

async function saveLeads(leads) {
  const safeLeads = Array.isArray(leads) ? leads : [];
  if (persistencePolicy.USE_UPSTASH) {
    try {
      await runUpstashCommand(['SET', LEADS_KEY, JSON.stringify(safeLeads)]);
      if (persistencePolicy.isLocalStateEnabled()) await writeLocalLeads(safeLeads).catch(() => {});
      return;
    } catch (err) {
      console.warn('[Lead Storage] Upstash write failed:', err.message);
      if (!persistencePolicy.isLocalStateEnabled()) throw err;
    }
  }

  await writeLocalLeads(safeLeads);
}

async function addLead({ email, pinId, targetUrl }) {
  const leads = await loadLeads();
  const newLead = {
    id: Date.now().toString(),
    email: email.trim(),
    pinId: pinId || 'unknown',
    targetUrl: targetUrl || '',
    timestamp: new Date().toISOString(),
  };
  leads.push(newLead);
  await saveLeads(leads);
  return newLead;
}

async function getLeads() {
  return await loadLeads();
}

module.exports = {
  addLead,
  getLeads
};

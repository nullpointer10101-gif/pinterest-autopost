const fs = require('fs/promises');
const path = require('path');

const LEADS_FILE = path.join(__dirname, '..', 'data', 'leads.json');

async function ensureDataDir() {
  const dir = path.dirname(LEADS_FILE);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    // ignore
  }
}

async function loadLeads() {
  await ensureDataDir();
  try {
    const data = await fs.readFile(LEADS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

async function saveLeads(leads) {
  await ensureDataDir();
  await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2), 'utf-8');
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

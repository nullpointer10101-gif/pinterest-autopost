const fs = require('fs/promises');
const path = require('path');

const REPOST_FILE = path.join(__dirname, '..', 'data', 'pinterest_reposted.json');

async function ensureDataDir() {
  const dir = path.dirname(REPOST_FILE);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {}
}

async function loadReposted() {
  await ensureDataDir();
  try {
    const data = await fs.readFile(REPOST_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return {};
  }
}

async function saveReposted(stateMap) {
  await ensureDataDir();
  await fs.writeFile(REPOST_FILE, JSON.stringify(stateMap, null, 2), 'utf-8');
}

async function isReposted(originalPinId) {
  const state = await loadReposted();
  return !!state[originalPinId];
}

async function markAsReposted(originalPinId, newPinId) {
  const state = await loadReposted();
  state[originalPinId] = {
    newPinId,
    timestamp: new Date().toISOString()
  };
  await saveReposted(state);
}

module.exports = {
  isReposted,
  markAsReposted
};

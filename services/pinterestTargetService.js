const fs = require('fs');
const path = require('path');
const DATA_FILE = path.join(__dirname, '..', 'data', 'pinterest-accounts.json');

function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    return [];
  }
  try {
    const content = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error('[PinterestTargetService] Error reading data:', err);
    return [];
  }
}

function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[PinterestTargetService] Error writing data:', err);
  }
}

async function listChannels() {
  return readData();
}

async function addChannel(username) {
  const cleanUsername = username.replace(/^@/, '').trim().toLowerCase();
  if (!cleanUsername) throw new Error('Invalid username');

  const channels = readData();
  const existing = channels.find((c) => c.username.toLowerCase() === cleanUsername);

  if (existing) {
    if (!existing.active) {
      existing.active = true;
      writeData(channels);
    }
    const error = new Error('Channel already exists');
    error.code = 'DUPLICATE_ACCOUNT';
    error.username = cleanUsername;
    throw error;
  }

  const newChannel = {
    username: cleanUsername,
    active: true,
  };

  channels.push(newChannel);
  writeData(channels);
  return newChannel;
}

async function removeChannel(username) {
  const cleanUsername = username.replace(/^@/, '').trim().toLowerCase();
  let channels = readData();
  channels = channels.filter((c) => c.username.toLowerCase() !== cleanUsername);
  writeData(channels);
  return channels;
}

module.exports = {
  listChannels,
  addChannel,
  removeChannel,
};

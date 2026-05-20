const fs = require('fs/promises');
const path = require('path');

const PINS_FILE = path.join(__dirname, '..', 'data', 'pinterest_pins.json');

async function ensureDataDir() {
  const dir = path.dirname(PINS_FILE);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {}
}

async function loadPins() {
  await ensureDataDir();
  try {
    const data = await fs.readFile(PINS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return {};
  }
}

async function savePins(pinsMap) {
  await ensureDataDir();
  await fs.writeFile(PINS_FILE, JSON.stringify(pinsMap, null, 2), 'utf-8');
}

async function saveScrapedPins(pinsArray) {
  const pinsMap = await loadPins();
  let added = 0;
  for (const pin of pinsArray) {
    if (!pinsMap[pin.pinId]) {
      pinsMap[pin.pinId] = pin;
      added++;
    } else {
      // Update existing if needed
      pinsMap[pin.pinId] = { ...pinsMap[pin.pinId], ...pin };
    }
  }
  if (added > 0 || pinsArray.length > 0) {
    await savePins(pinsMap);
  }
  return added;
}

async function getPinById(pinId) {
  const pinsMap = await loadPins();
  return pinsMap[pinId] || null;
}

module.exports = {
  saveScrapedPins,
  getPinById
};

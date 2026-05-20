const fs = require('fs/promises');
const path = require('path');

const QUEUE_FILE = path.join(__dirname, '..', 'data', 'pinterest_queue.json');

async function ensureDataDir() {
  const dir = path.dirname(QUEUE_FILE);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {}
}

async function loadQueue() {
  await ensureDataDir();
  try {
    const data = await fs.readFile(QUEUE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

async function saveQueue(queueArray) {
  await ensureDataDir();
  await fs.writeFile(QUEUE_FILE, JSON.stringify(queueArray, null, 2), 'utf-8');
}

/**
 * Adds new pins to the queue, avoiding duplicates based on pinId.
 */
async function addPinsToQueue(newPins) {
  const queue = await loadQueue();
  const existingMap = new Map(queue.map(p => [p.pinId, p]));
  let addedCount = 0;

  for (const pin of newPins) {
    if (!existingMap.has(pin.pinId)) {
      queue.push(pin);
      existingMap.set(pin.pinId, pin);
      addedCount++;
    }
  }

  if (addedCount > 0) {
    await saveQueue(queue);
  }
  return addedCount;
}

/**
 * Removes and returns up to `count` pins from the top of the queue.
 */
async function popPinsFromQueue(count = 2) {
  const queue = await loadQueue();
  if (queue.length === 0) return [];

  const popped = queue.splice(0, count);
  await saveQueue(queue);
  return popped;
}

/**
 * Returns the current total number of pins in the queue.
 */
async function getQueueLength() {
  const queue = await loadQueue();
  return queue.length;
}

module.exports = {
  loadQueue,
  saveQueue,
  addPinsToQueue,
  popPinsFromQueue,
  getQueueLength
};

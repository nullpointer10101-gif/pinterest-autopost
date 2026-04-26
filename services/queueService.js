const aiService = require('./aiService');
const pinterestService = require('./pinterestService');
const historyService = require('./historyService');

let createPinWithBot = null;
try {
  ({ createPinWithBot } = require('./puppeteerService'));
} catch (err) {
  console.warn('[Queue] Puppeteer service unavailable. Queue will use API mode.');
}

const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);

async function loadState() {
  const posts = await historyService.getAll();
  const storageInfo = historyService.getStorageInfo();
  const queue = await historyService.getQueueData();
  return { posts, queue, storageInfo };
}

async function saveQueue(queue) {
  await historyService.setQueueData(queue);
}

function getPostingMode() {
  return (process.env.PINTEREST_POSTING_MODE || 'auto').toLowerCase();
}

function shouldUseBrowserBot() {
  const mode = getPostingMode();
  if (mode === 'api') return false;
  if (mode === 'bot') return !!createPinWithBot;
  if (IS_SERVERLESS) return false;
  return !!createPinWithBot;
}

async function getQueue() {
  const { queue } = await loadState();
  return queue;
}

async function getQueueStats() {
  const { queue, storageInfo } = await loadState();
  const pending = queue.filter(item => item.status === 'pending').length;
  const processing = queue.filter(item => item.status === 'processing').length;
  const completed = queue.filter(item => item.status === 'completed').length;
  const failed = queue.filter(item => item.status === 'failed').length;
  return {
    total: queue.length,
    pending,
    processing,
    completed,
    failed,
    storageMode: storageInfo.mode === 'upstash' ? 'cloud' : (IS_SERVERLESS ? 'ephemeral' : 'persistent'),
  };
}

async function addToQueue(items, prepend = false) {
  const queue = await getQueue();
  const now = new Date().toISOString();
  const newItems = items.map(item => ({
    id: item.id || `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    ...item,
    status: 'pending',
    addedAt: now,
  }));

  const updated = prepend ? [...newItems, ...queue] : [...queue, ...newItems];
  await saveQueue(updated);
  return newItems;
}

async function clearQueue() {
  await saveQueue([]);
  return [];
}

async function retryFailedItems() {
  const queue = await getQueue();
  const resetAt = new Date().toISOString();
  let changed = 0;
  for (const item of queue) {
    if (item.status === 'failed') {
      item.status = 'pending';
      item.error = null;
      item.retryAt = resetAt;
      changed += 1;
    }
  }
  await saveQueue(queue);
  return changed;
}

let isProcessing = false;

async function processNextInQueue() {
  if (isProcessing) return null;

  const queue = await getQueue();
  const nextItemIndex = queue.findIndex(item => item.status === 'pending');
  if (nextItemIndex === -1) return null;

  isProcessing = true;
  const item = queue[nextItemIndex];
  item.status = 'processing';
  item.processingAt = new Date().toISOString();
  await saveQueue(queue);

  try {
    let aiContent = item.aiContent;
    if (!aiContent && item.caption) {
      aiContent = await aiService.generatePinterestContent({
        caption: item.caption,
        username: item.username || 'unknown',
        mediaType: 'video',
      });
    }

    const title = (aiContent?.title || item.title || 'Pinterest Post').substring(0, 100);
    const description = (aiContent?.description || item.description || '').substring(0, 800);
    const altText = (item.altText || '').substring(0, 500);
    const link = item.sourceUrl || '';
    const mediaUrl = item.mediaUrl;

    let result;
    let method = 'api';

    if (shouldUseBrowserBot()) {
      method = 'browser_bot';
      result = await createPinWithBot({
        title,
        description,
        alt_text: altText,
        link,
        media_source: { url: mediaUrl },
      });
    } else {
      const pin = await pinterestService.createPin({
        title,
        description,
        altText,
        mediaUrl,
        link,
      });
      result = { success: true, pin };
    }

    item.status = 'completed';
    item.method = method;
    item.result = result;
    item.completedAt = new Date().toISOString();

    await historyService.add({
      url: item.sourceUrl || '',
      reelData: {
        username: item.username || 'unknown',
        caption: item.caption || '',
        thumbnailUrl: item.thumbnailUrl || mediaUrl,
        mediaType: 'video',
      },
      aiContent: {
        title,
        description,
        hashtags: aiContent?.hashtags || [],
      },
      pinterestPin: {
        id: item.id || result?.pin?.id || `pin_${Date.now()}`,
        url: result?.pin?.url || '#',
        method,
      },
      status: 'success',
      postedAt: new Date().toISOString(),
    });
  } catch (error) {
    item.status = 'failed';
    item.error = error.message;
    item.failedAt = new Date().toISOString();

    await historyService.add({
      url: item.sourceUrl || '',
      reelData: {
        username: item.username || 'unknown',
        caption: item.caption || '',
        thumbnailUrl: item.thumbnailUrl || item.mediaUrl || '',
        mediaType: 'video',
      },
      aiContent: {
        title: item.title || 'Queued post failed',
        description: item.description || '',
        hashtags: item.aiContent?.hashtags || [],
      },
      pinterestPin: {
        id: item.id || `fail_${Date.now()}`
      },
      status: 'error',
      error: error.message,
      postedAt: new Date().toISOString(),
    });
  } finally {
    await saveQueue(queue);
    isProcessing = false;
  }

  return item;
}

module.exports = {
  getQueue,
  addToQueue,
  clearQueue,
  retryFailedItems,
  processNextInQueue,
  getQueueStats,
  shouldUseBrowserBot,
  getPostingMode,
};

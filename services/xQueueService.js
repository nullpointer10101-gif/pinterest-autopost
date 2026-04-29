const aiService = require('./aiService');
const xHistoryService = require('./xHistoryService');

let createTweetWithBot = null;
try {
  ({ createTweetWithBot } = require('./xPuppeteerService'));
} catch (err) {
  console.warn('[X-Queue] Puppeteer service unavailable. Queue will rely on GitHub Actions bot.');
}

const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);

async function loadState() {
  const posts = await xHistoryService.getAll();
  const storageInfo = xHistoryService.getStorageInfo();
  const queue = await xHistoryService.getQueueData();
  return { posts, queue, storageInfo };
}

async function saveQueue(queue) {
  await xHistoryService.setQueueData(queue);
}

function getPostingMode() {
  return 'bot';
}

function shouldUseBrowserBot() {
  return !!createTweetWithBot;
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
    id: item.id || `x_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
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
      }); // We can reuse aiService to generate concise text with hashtags
    }

    const title = (aiContent?.title || item.title || '').substring(0, 50);
    const description = (aiContent?.description || item.description || '').substring(0, 200);
    // Combine for tweet text
    const tweetText = `${title}\n\n${description}`.trim().substring(0, 280);
    const mediaUrl = item.mediaUrl;

    let result;
    const method = 'browser_bot';

    if (!createTweetWithBot) {
      throw new Error('Puppeteer browser bot is not available in this runtime. Ensure this runs in GitHub Actions.');
    }

    result = await createTweetWithBot({
      text: tweetText,
      media_source: { url: mediaUrl },
    });

    item.status = 'completed';
    item.method = method;
    item.result = result;
    item.completedAt = new Date().toISOString();

    await xHistoryService.add({
      url: item.sourceUrl || '',
      reelData: {
        username: item.username || 'unknown',
        caption: item.caption || '',
        thumbnailUrl: item.thumbnailUrl || mediaUrl,
        mediaType: 'video',
      },
      aiContent: {
        tweetText,
        hashtags: aiContent?.hashtags || [],
      },
      xPost: {
        id: item.id || result?.tweet?.id || `tweet_${Date.now()}`,
        url: result?.tweet?.url || '#',
        method,
      },
      status: 'success',
      postedAt: new Date().toISOString(),
    });
  } catch (error) {
    item.status = 'failed';
    item.error = error.message;
    item.failedAt = new Date().toISOString();

    await xHistoryService.add({
      url: item.sourceUrl || '',
      reelData: {
        username: item.username || 'unknown',
        caption: item.caption || '',
        thumbnailUrl: item.thumbnailUrl || item.mediaUrl || '',
        mediaType: 'video',
      },
      aiContent: {
        tweetText: item.title || 'Queued post failed',
      },
      xPost: {
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

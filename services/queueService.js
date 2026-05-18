const aiService = require('./aiService');
const historyService = require('./historyService');
const productCurationService = require('./productCurationService');

let selectBoard = () => null; // safe default: no board forced
try {
  ({ selectBoard } = require('./boardSelectorService'));
} catch (err) {
  console.warn('[Queue] boardSelectorService unavailable:', err.message);
}

let createPinWithBot = null;
try {
  ({ createPinWithBot } = require('./puppeteerService'));
} catch (err) {
  console.warn('[Queue] Puppeteer service unavailable. Queue will rely on GitHub Actions bot.');
}

const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
const PRIORITY_LEVELS = ['low', 'normal', 'high', 'urgent'];
const PRIORITY_WEIGHT = {
  low: 1,
  normal: 2,
  high: 3,
  urgent: 4,
};

async function loadState() {
  const posts = await historyService.getAll();
  const storageInfo = historyService.getStorageInfo();
  const queue = await historyService.getQueueData();
  return { posts, queue, storageInfo };
}

async function saveQueue(queue) {
  await historyService.setQueueData(queue);
}

function normalizePriority(priority) {
  const value = String(priority || '').trim().toLowerCase();
  return PRIORITY_LEVELS.includes(value) ? value : 'normal';
}

function normalizeScheduledAfter(value) {
  if (!value) return null;
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return null;
  return timestamp.toISOString();
}

function isScheduledForFuture(item, referenceTime = Date.now()) {
  if (!item?.scheduledAfter) return false;
  const ts = new Date(item.scheduledAfter).getTime();
  if (!Number.isFinite(ts)) return false;
  return ts > referenceTime;
}

function getPostingMode() {
  // Always bot mode now — no API posting
  return 'bot';
}

function shouldUseBrowserBot() {
  // Always true if puppeteer is available
  return !!createPinWithBot;
}

async function getQueue() {
  const { queue } = await loadState();
  return queue;
}

async function getQueueStats() {
  const { queue, storageInfo } = await loadState();
  const pending = queue.filter(item => item.status === 'pending').length;
  const scheduled = queue.filter(item => item.status === 'pending' && item.scheduledAfter && new Date(item.scheduledAfter) > new Date()).length;
  const ready = pending - scheduled;
  const processing = queue.filter(item => item.status === 'processing').length;
  const completed = queue.filter(item => item.status === 'completed').length;
  const failed = queue.filter(item => item.status === 'failed').length;
  return {
    total: queue.length,
    pending,
    scheduled,
    ready,
    processing,
    completed,
    failed,
    storageMode: storageInfo.mode === 'upstash' ? 'cloud' : (IS_SERVERLESS ? 'ephemeral' : 'persistent'),
  };
}

/**
 * Extract shortcode from a queue item using all possible fields.
 * This is the SINGLE SOURCE OF TRUTH for shortcode extraction.
 */
function extractShortcode(item) {
  // Direct shortcode field (preferred — new format)
  if (item.shortcode) return item.shortcode;
  // Legacy tags.shortcode
  if (item.tags?.shortcode) return item.tags.shortcode;
  // Extract from sourceUrl
  if (item.sourceUrl) {
    const match = item.sourceUrl.match(/\/(reel|p|tv)\/([A-Za-z0-9_-]+)/);
    if (match) return match[2];
  }
  // Extract from originalSourceUrl
  if (item.originalSourceUrl) {
    const match = item.originalSourceUrl.match(/\/(reel|p|tv)\/([A-Za-z0-9_-]+)/);
    if (match) return match[2];
  }
  return null;
}

/**
 * Check if a shortcode already exists in post history (already published).
 */
async function isAlreadyPosted(shortcode) {
  if (!shortcode) return false;
  const posts = await historyService.getAll();
  return posts.some(post => {
    // Check post URL for shortcode
    if (post.url && post.url.includes(shortcode)) return true;
    // Check reel data
    if (post.reelData?.shortcode === shortcode) return true;
    // Check source URL in the post
    const postUrl = post.url || '';
    const match = postUrl.match(/\/(reel|p|tv)\/([A-Za-z0-9_-]+)/);
    if (match && match[2] === shortcode) return true;
    return false;
  });
}

async function addToQueue(items, prepend = false) {
  const queue = await getQueue();
  const now = new Date().toISOString();
  
  // ═══════════════════════════════════════════════════════════════════════
  // TRIPLE-LAYER DEDUPLICATION
  // Layer 1: Check against existing queue (by shortcode OR sourceUrl)
  // Layer 2: Check against post history (already published pins)
  // Layer 3: Caller is responsible for IG tracker seen list
  // ═══════════════════════════════════════════════════════════════════════
  
  const filteredItems = [];
  
  for (const newItem of items) {
    const newShortcode = extractShortcode(newItem);
    const newUrl = newItem.sourceUrl;
    
    // Layer 1: Queue dedup — check ALL statuses (pending, completed, processing, failed)
    const existsInQueue = queue.some(existing => {
      const existingShortcode = extractShortcode(existing);
      
      // Match by shortcode (strongest signal)
      if (newShortcode && existingShortcode && newShortcode === existingShortcode) {
        return true;
      }
      // Match by sourceUrl
      if (newUrl && existing.sourceUrl && newUrl === existing.sourceUrl) {
        return true;
      }
      // Match by mediaUrl (same video file = same content)
      if (newItem.mediaUrl && existing.mediaUrl && newItem.mediaUrl === existing.mediaUrl) {
        return true;
      }
      return false;
    });

    if (existsInQueue) {
      console.log(`[Queue] ⛔ BLOCKED duplicate (in queue): shortcode=${newShortcode || 'N/A'}, url=${newUrl || 'N/A'}`);
      continue;
    }

    // Layer 2: History dedup — check if this was already posted to Pinterest
    if (newShortcode) {
      const alreadyPosted = await isAlreadyPosted(newShortcode);
      if (alreadyPosted) {
        console.log(`[Queue] ⛔ BLOCKED duplicate (already posted): shortcode=${newShortcode}`);
        continue;
      }
    }

    filteredItems.push(newItem);
  }

  if (filteredItems.length === 0) {
    console.log('[Queue] All items were duplicates. Nothing added.');
    return [];
  }

  const newItems = filteredItems.map(item => ({
    id: item.id || `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    ...item,
    // Ensure shortcode is always a top-level field for future dedup
    shortcode: extractShortcode(item) || null,
    priority: normalizePriority(item.priority),
    scheduledAfter: normalizeScheduledAfter(item.scheduledAfter),
    status: 'pending',
    addedAt: now,
  }));

  const updated = prepend ? [...newItems, ...queue] : [...queue, ...newItems];
  await saveQueue(updated);
  
  console.log(`[Queue] ✅ Added ${newItems.length} new item(s) (${filteredItems.length} passed dedup, ${items.length - filteredItems.length} blocked)`);
  return newItems;
}

async function clearQueue() {
  await saveQueue([]);
  return [];
}

async function clearPending() {
  const queue = await getQueue();
  const clean = queue.filter(item => item.status !== 'pending');
  await saveQueue(clean);
  return clean;
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

async function removeItem(id) {
  const queue = await getQueue();
  const updated = queue.filter(item => item.id !== id);
  await saveQueue(updated);
  return updated;
}

async function promoteToFront(id) {
  const queue = await getQueue();
  const index = queue.findIndex(item => item.id === id);
  if (index === -1) return queue;

  const item = queue[index];
  if (item.status !== 'pending') return queue;

  queue.splice(index, 1);
  const updated = [item, ...queue];
  await saveQueue(updated);
  return updated;
}

async function reorderQueue(orderedIds = []) {
  const queue = await getQueue();
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return queue;

  const knownIds = new Set(queue.map((item) => item.id));
  const cleanIds = orderedIds.filter((id) => knownIds.has(id));
  if (cleanIds.length === 0) return queue;

  const orderedSet = new Set(cleanIds);
  const idToItem = new Map(queue.map((item) => [item.id, item]));
  const ordered = cleanIds.map((id) => idToItem.get(id)).filter(Boolean);
  const untouched = queue.filter((item) => !orderedSet.has(item.id));
  const merged = [...ordered, ...untouched];
  await saveQueue(merged);
  return merged;
}

async function updateQueueItem(id, patch = {}) {
  const queue = await getQueue();
  const index = queue.findIndex((item) => item.id === id);
  if (index === -1) throw new Error('Queue item not found');

  const current = queue[index];
  const next = { ...current };

  if (Object.prototype.hasOwnProperty.call(patch, 'priority')) {
    next.priority = normalizePriority(patch.priority);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'scheduledAfter')) {
    next.scheduledAfter = normalizeScheduledAfter(patch.scheduledAfter);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
    const status = String(patch.status || '').trim().toLowerCase();
    if (status) next.status = status;
  }

  next.updatedAt = new Date().toISOString();
  queue[index] = next;
  await saveQueue(queue);
  return next;
}

async function bulkUpdateQueue(ids = [], patch = {}) {
  const queue = await getQueue();
  const selected = new Set(Array.isArray(ids) ? ids.filter(Boolean) : []);
  if (selected.size === 0) return { changed: 0, queue };

  let changed = 0;
  const now = new Date().toISOString();
  const nextQueue = queue.map((item) => {
    if (!selected.has(item.id)) return item;
    const next = { ...item };

    if (Object.prototype.hasOwnProperty.call(patch, 'priority')) {
      next.priority = normalizePriority(patch.priority);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'scheduledAfter')) {
      next.scheduledAfter = normalizeScheduledAfter(patch.scheduledAfter);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
      const status = String(patch.status || '').trim().toLowerCase();
      if (status) next.status = status;
    }
    next.updatedAt = now;
    changed += 1;
    return next;
  });

  await saveQueue(nextQueue);
  return { changed, queue: nextQueue };
}

async function bulkRemoveQueue(ids = []) {
  const queue = await getQueue();
  const selected = new Set(Array.isArray(ids) ? ids.filter(Boolean) : []);
  if (selected.size === 0) return { removed: 0, queue };

  const nextQueue = queue.filter((item) => !selected.has(item.id));
  const removed = queue.length - nextQueue.length;
  await saveQueue(nextQueue);
  return { removed, queue: nextQueue };
}


let isProcessing = false;

async function processNextInQueue() {
  if (isProcessing) return null;

  const queue = await getQueue();
  
  // ═══════════════════════════════════════════════════════════════════════
  // SCHEDULE-AWARE QUEUE PROCESSING
  // Only pick items where scheduledAfter is null/undefined OR in the past
  // ═══════════════════════════════════════════════════════════════════════
  const now = Date.now();
  let nextItemIndex = -1;
  let bestWeight = -Infinity;

  queue.forEach((item, index) => {
    if (item.status !== 'pending') return;
    if (isScheduledForFuture(item, now)) return;

    const weight = PRIORITY_WEIGHT[normalizePriority(item.priority)] || PRIORITY_WEIGHT.normal;
    if (weight > bestWeight) {
      bestWeight = weight;
      nextItemIndex = index;
      return;
    }

    if (weight === bestWeight && nextItemIndex === -1) {
      nextItemIndex = index;
    }
  });
  
  if (nextItemIndex === -1) {
    // Log how many are scheduled for later
    const scheduledCount = queue.filter((item) => item.status === 'pending' && isScheduledForFuture(item, now)).length;
    if (scheduledCount > 0) {
      console.log(`[Queue] No ready items. ${scheduledCount} item(s) scheduled for later.`);
    }
    return null;
  }

  isProcessing = true;
  
  // RE-FETCH the queue to ensure we have the absolute latest state before marking as processing
  const freshQueue = await getQueue();
  const item = freshQueue.find((it, idx) => idx === nextItemIndex && it.status === 'pending');
  
  if (!item) {
    console.log('[Queue] Item was already picked up or changed status. Skipping.');
    isProcessing = false;
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FINAL DEDUP CHECK: Right before processing, verify this shortcode
  // hasn't been posted while it was waiting in the queue
  // ═══════════════════════════════════════════════════════════════════════
  const itemShortcode = extractShortcode(item);
  if (itemShortcode) {
    const alreadyPosted = await isAlreadyPosted(itemShortcode);
    if (alreadyPosted) {
      console.log(`[Queue] ⛔ BLOCKED at processing: shortcode=${itemShortcode} was already posted. Removing from queue.`);
      item.status = 'failed';
      item.error = 'Duplicate: Already posted to Pinterest';
      item.failedAt = new Date().toISOString();
      await saveQueue(freshQueue);
      isProcessing = false;
      return item;
    }
  }

  item.status = 'processing';
  item.processingAt = new Date().toISOString();
  await saveQueue(freshQueue);

  try {
    const mediaUrl = item.mediaUrl;

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Extract a representative video frame ONCE.
    // This frame is reused for BOTH content generation AND product ID so
    // we never download the video twice.
    // ═══════════════════════════════════════════════════════════════════════
    let videoFrame = null;
    if (mediaUrl) {
      try {
        const { extractFrameFromVideo } = require('./frameExtractorService');
        videoFrame = await extractFrameFromVideo(mediaUrl);
        if (videoFrame) console.log('[Queue] 🎬 Video frame cached for AI pipeline.');
      } catch (e) {
        console.warn('[Queue] Frame extraction failed (will use thumbnail):', e.message);
      }
    }

    // Thumbnail fallback if no frame was extracted
    const thumbnailForAI = videoFrame ? null : (item.thumbnailUrl || '');

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Generate Pinterest title + description based on the video frame.
    // If we have a frame → AI writes content from what it SEES.
    // If no frame → fall back to cleaned caption.
    // ═══════════════════════════════════════════════════════════════════════
    let aiContent = item.aiContent;
    if (!aiContent) {
      console.log('[Queue] 📝 Generating Pinterest content from video frame...');
      aiContent = await aiService.generatePinterestContent({
        caption: item.caption || '',
        username: item.username || 'unknown',
        mediaType: 'video',
        imageData: videoFrame || null,
      });
    }

    const title = (aiContent?.title || item.title || 'Pinterest Post').substring(0, 100);
    let description = (aiContent?.description || item.description || '').substring(0, 800);
    const altText = (item.altText || '').substring(0, 500);

    
    // ═══════════════════════════════════════════════════════════════════════
    // AI PIPELINE: Multi-Product Curation & Affiliate Links
    // finalLink must NEVER be an Instagram URL — Pinterest silently rejects them.
    // ═══════════════════════════════════════════════════════════════════════
    // Start with any pre-existing affiliate link, or empty (NOT the IG source URL)
    let finalLink = item.destinationLink || item.link || '';
    let affiliateLinks = [];
    let mainProductName = null;
    let outfitName = null;
    const appDomain = process.env.APP_BASE_URL || 'https://pinterest-autopost.vercel.app';
    
    // Always pre-build the storefront URL as our safe fallback (if we have a shortcode)
    const storefrontUrl = itemShortcode ? `${appDomain.replace(/\/$/, '')}/look/${itemShortcode}` : '';
    
    // Only run AI pipeline if we don't already have a valid affiliate destination link
    if (!item.destinationLink && itemShortcode && item.sourceUrl) {
      console.log(`[Queue] 🤖 AI identifying outfit for shortcode: ${itemShortcode}...`);
      const outfitData = await aiService.identifyOutfit({
        caption: item.caption || '',
        username: item.username || '',
        thumbnailUrl: item.thumbnailUrl || '',
        mediaUrl: mediaUrl || '',
        imageData: videoFrame || null
      });
      
      if (outfitData.found && outfitData.items) {
        console.log(`[Queue] 🎯 Found product focus: "${outfitData.outfitName}"`);
        const resolved = await productCurationService.buildSameTypeShelfFromOutfit(outfitData, {
          limit: 4,
          fallbackName: title,
          logPrefix: '[Queue]',
        });
        affiliateLinks = resolved.affiliateLinks;
        mainProductName = resolved.mainProductName;
        outfitName = resolved.outfitName;
      } else {
        console.log(`[Queue] 🤖 Outfit not found. Trying single product identification...`);
        const productData = await aiService.identifyProduct({
          caption: item.caption || '',
          username: item.username || '',
          thumbnailUrl: item.thumbnailUrl || '',
          mediaUrl: mediaUrl || '',
          imageData: videoFrame || null
        });
        
        if (productData.found) {
           console.log(`[Queue] 🎯 Found single product: "${productData.productName}"`);
           const resolved = await productCurationService.buildSameTypeShelfFromProductData(productData, {
             limit: 4,
             logPrefix: '[Queue]',
           });
           affiliateLinks = resolved.affiliateLinks;
           mainProductName = resolved.mainProductName;
           outfitName = resolved.productTypeLabel ? `${resolved.productTypeLabel} Finds` : null;
        }
      }
      
      // If we found products, use storefront. Otherwise still use storefront as safe fallback.
      if (affiliateLinks.length > 0) {
        finalLink = storefrontUrl;
        description = `${description}\n\nShop matching product finds here -> ${finalLink}`.substring(0, 800);
        console.log(`[Queue] ✨ Storefront with products: ${finalLink}`);
      } else if (storefrontUrl) {
        // Use storefront as safe fallback (prevents posting with empty/IG link)
        finalLink = storefrontUrl;
        console.log(`[Queue] 🔗 No products found — using storefront as fallback: ${finalLink}`);
      }
    } else if (!finalLink && storefrontUrl) {
      // No existing link + no shortcode pipeline → use storefront URL if possible
      finalLink = storefrontUrl;
    }

    if (item.destinationLink) {
      console.log(`[Queue] 🔗 Using pre-set affiliate link: ${item.destinationLink}`);
    } else if (affiliateLinks.length > 0) {
      console.log(`[Queue] 🔗 Using AI-generated storefront: ${finalLink}`);
    } else if (finalLink) {
      console.log(`[Queue] 🔗 Using storefront fallback: ${finalLink}`);
    } else {
      console.log(`[Queue] ⚠️ No link available — posting without destination link.`);
    }

    let result;
    const method = 'browser_bot';

    // Always use browser bot — no API path
    if (!createPinWithBot) {
      throw new Error('Puppeteer browser bot is not available in this runtime. Ensure this runs in GitHub Actions.');
    }

    // ── Board Selection ─────────────────────────────────────────────────────
    // Build all product signals we have and let boardSelectorService score them.
    // We always pass something — even the AI title is useful as a keyword source.
    const boardSignals = {
      productName: mainProductName || title,
      exactMatchQuery: mainProductName || '',
      outfitName: outfitName || '',
      // Use title/description as fallback keyword sources
      titleSignal: title,
      items: affiliateLinks.map(l => ({ type: l.type, query: l.name })),
    };
    const boardForPost = selectBoard(boardSignals);
    if (boardForPost) {
      console.log(`[Queue] 📌 Board selected: "${boardForPost}"`);
    } else {
      console.log('[Queue] 📌 No specific board — Pinterest will use default.');
    }

    result = await createPinWithBot({
      title,
      description,
      alt_text: altText,
      link: finalLink,
      boardName: boardForPost,
      shortcode: itemShortcode || item.shortcode || '',
      media_source: {
        url: mediaUrl,
        // URL-created reel missions opt into product-focused cover selection.
        thumbnailUrl: item.thumbnailUrl || '',
        smartCover: item.smartCover === true,
        smartCoverSource: item.smartCoverSource || '',
      },
    });

    if (result && result.success === false) {
      throw new Error(result.error || 'Browser bot reported failure without throwing an exception');
    }

    item.status = 'completed';
    item.method = method;
    item.result = result;
    item.link = finalLink; // Ensure fire-post.js logs the correct link
    item.completedAt = new Date().toISOString();

    const historyAffiliateLink = finalLink && finalLink !== item.sourceUrl && finalLink !== storefrontUrl
      ? finalLink
      : null;

    await historyService.add({
      url: item.sourceUrl || '',
      reelData: {
        username: item.username || 'unknown',
        caption: item.caption || '',
        thumbnailUrl: item.thumbnailUrl || mediaUrl,
        mediaType: 'video',
        shortcode: itemShortcode || null,
      },
      aiContent: {
        title,
        description,
        hashtags: aiContent?.hashtags || [],
      },
      affiliateLink: historyAffiliateLink,
      productInfo: affiliateLinks.length > 0 ? {
        name: outfitName || mainProductName || 'Curated Look',
        outfit: affiliateLinks
      } : (item.destinationLink ? {
        name: 'Featured Item',
        affiliateUrl: item.destinationLink,
        outfit: []
      } : undefined),
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
        shortcode: itemShortcode || null,
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
    await saveQueue(freshQueue);
    isProcessing = false;
  }

  return item;
}

module.exports = {
  getQueue,
  addToQueue,
  clearQueue,
  clearPending,
  saveQueue,
  retryFailedItems,
  removeItem,
  promoteToFront,
  reorderQueue,
  updateQueueItem,
  bulkUpdateQueue,
  bulkRemoveQueue,
  processNextInQueue,
  getQueueStats,
  shouldUseBrowserBot,
  getPostingMode,
  extractShortcode,
  isAlreadyPosted,
  normalizePriority,
  normalizeScheduledAfter,
};

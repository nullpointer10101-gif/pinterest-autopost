const queueService = require('./queueService');
const historyService = require('./historyService');

let puppeteerService = null;
try {
  puppeteerService = require('./puppeteerService');
} catch (err) {
  console.warn('[Automation] Puppeteer service unavailable:', err.message);
}

const igTrackerService = require('./igTrackerService');
const aiService = require('./aiService');
const flipkartSearchService = require('./flipkartSearchService');
const earnKaroService = require('./earnKaroService');

// Lazy-loaded — only available in GitHub Actions (Node env with ffmpeg)
// NEVER imported at module level to avoid crashing Vercel serverless cold start
let _thumbnailService = null;
function getThumbnailService() {
  if (_thumbnailService) return _thumbnailService;
  try {
    _thumbnailService = require('./thumbnailService');
  } catch (e) {
    console.warn('[Automation] thumbnailService not available:', e.message);
    _thumbnailService = { selectBestThumbnailSafe: async (reel) => reel.thumbnailUrl || reel.mediaUrl || '' };
  }
  return _thumbnailService;
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFloat(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function randomInt(min, max) {
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getDateKey(timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const y = parts.find(p => p.type === 'year')?.value || '1970';
  const m = parts.find(p => p.type === 'month')?.value || '01';
  const d = parts.find(p => p.type === 'day')?.value || '01';
  return `${y}-${m}-${d}`;
}

async function runHourlyAutomation(options = {}) {
  const maxPostsPerDay = Math.max(1, toInt(options.maxPostsPerDay ?? process.env.AUTOMATION_MAX_POSTS_PER_DAY, 10));
  const maxPostsPerRun = Math.max(0, toInt(options.maxPostsPerRun ?? process.env.AUTOMATION_MAX_POSTS_PER_RUN, 2));
  const requestedEngagementCount = Math.max(0, toInt(options.engagementCount ?? process.env.AUTOMATION_ENGAGEMENTS_PER_HOUR, 2));
  const engagementHardCap = Math.max(1, toInt(process.env.AUTOMATION_ENGAGEMENTS_HARD_CAP, 20));
  const engagementCount = Math.min(requestedEngagementCount, engagementHardCap);
  const timeZone = options.timeZone || process.env.AUTOMATION_TIMEZONE || 'Asia/Calcutta';
  const engagementStartJitterMinMs = Math.max(0, toInt(process.env.AUTOMATION_ENGAGEMENT_START_JITTER_MIN_MS, 30000));
  const engagementStartJitterMaxMs = Math.max(
    engagementStartJitterMinMs,
    toInt(process.env.AUTOMATION_ENGAGEMENT_START_JITTER_MAX_MS, 2 * 60 * 1000)
  );
  const engagementMinGapMs = Math.max(10000, toInt(process.env.AUTOMATION_ENGAGEMENT_MIN_GAP_MS, 3 * 60 * 1000));
  const engagementMaxGapMs = Math.max(
    engagementMinGapMs,
    toInt(process.env.AUTOMATION_ENGAGEMENT_MAX_GAP_MS, 8 * 60 * 1000)
  );
  const commentChance = Math.min(1, Math.max(0.25, toFloat(process.env.AUTOMATION_COMMENT_PROBABILITY, 0.85)));

  const dateKey = getDateKey(timeZone);
  const automation = await historyService.getAutomationState();
  const config = await historyService.getWorkflowConfig();

  if (config.pinterestEngagement === false) {
    console.log('[Automation] Pinterest Engagement is DISABLED in Workflow Config. Skipping bot session.');
    // We might still want to process queue if pinterestPosting is on
  }

  if (!options.force && automation.lastRunAt) {
    const lastRunTime = new Date(automation.lastRunAt).getTime();
    const minutesSinceLastRun = (Date.now() - lastRunTime) / (1000 * 60);
    if (minutesSinceLastRun < 45) {
      console.log(`[Automation] Skipped: Last run was ${Math.round(minutesSinceLastRun)}m ago (min 45m).`);
      return {
        success: true,
        skipped: true,
        message: `Skipped to prevent double-execution. Last run was ${Math.round(minutesSinceLastRun)}m ago.`,
      };
    }
  }

  let postsToday = dateKey === automation.dateKey ? (automation.postsToday || 0) : 0;

  const postsRemaining = Math.max(0, maxPostsPerDay - postsToday);
  const targetPostsThisRun = Math.min(postsRemaining, maxPostsPerRun);

  console.log(`[Automation] Date: ${dateKey} | Posts Today: ${postsToday} | Remaining: ${postsRemaining}`);
  console.log(`[Automation] Target posts this run: ${targetPostsThisRun}`);

  let postsProcessed = 0;
  let attempts = 0;
  const maxAttempts = Math.max(3, targetPostsThisRun * 4);
  const processedItems = [];

  if (targetPostsThisRun > 0) {
    const config = await historyService.getWorkflowConfig();
    if (config.pinterestPosting === false && !options.force) {
      console.log('[Automation] Pinterest Posting is DISABLED. Skipping queue processing.');
    } else {
      const queue = await queueService.getQueue();
      const pending = queue.filter(item => item.status === 'pending').length;
      const now = new Date();
      const ready = queue.filter(item => {
        if (item.status !== 'pending') return false;
        if (item.scheduledAfter && new Date(item.scheduledAfter) > now) return false;
        return true;
      }).length;
      console.log(`[Automation] Found ${pending} pending items in queue (${ready} ready now, ${pending - ready} scheduled for later).`);

      while (postsProcessed < targetPostsThisRun && attempts < maxAttempts) {
        attempts += 1;
        console.log(`[Automation] Processing post attempt ${attempts}...`);
        const processed = await queueService.processNextInQueue();
        if (!processed) {
          console.log('[Automation] No more items to process in queue.');
          break;
        }
        processedItems.push({
          id: processed.id,
          status: processed.status,
          method: processed.method || null,
          error: processed.error || null,
        });
        if (processed.status === 'completed') {
          console.log(`[Automation] ✅ Successfully posted: ${processed.title}`);
          postsProcessed += 1;
        } else {
          console.log(`[Automation] ❌ Failed to post: ${processed.error || 'Unknown error'}`);
        }
      }
    }
  } else {
    console.log('[Automation] Skipping queue processing (limit reached or target is 0).');
  }

  postsToday += postsProcessed;
  await historyService.setAutomationState({
    ...automation,
    dateKey,
    postsToday,
    lastRunAt: new Date().toISOString(),
  });

  let engagement = {
    requested: requestedEngagementCount,
    attempted: engagementCount,
    executed: 0,
    success: false,
    message: 'Engagement skipped',
    startDelayMs: 0,
  };

  if (engagementCount > 0) {
    const config = await historyService.getWorkflowConfig();
    if (config.pinterestEngagement === false && !options.force) {
       console.log('[Automation] Pinterest Engagement is DISABLED. Skipping bot.');
    } else if (puppeteerService && typeof puppeteerService.runAutoEngagerSafe === 'function') {
      try {
        const startDelayMs = randomInt(engagementStartJitterMinMs, engagementStartJitterMaxMs);
        if (startDelayMs > 0) {
          console.log(`[Automation] Initial jitter: Waiting ${Math.round(startDelayMs / 1000)}s before starting engagement...`);
          await sleep(startDelayMs);
        }

        console.log(`[Automation] Launching browser for ${engagementCount} engagement(s)...`);
        
        const result = await puppeteerService.runAutoEngagerSafe({
          count: engagementCount,
          niche: options.engagementNiche || 'all',
          minGapMs: engagementMinGapMs,
          maxGapMs: engagementMaxGapMs,
          commentChance,
          context: {
            source: process.env.GITHUB_ACTIONS === 'true' ? 'github_actions' : 'local',
            command: 'node scripts/run-hourly-automation.js',
          },
        });

        const executedTotal = Math.max(0, toInt(result?.executed, 0));
        console.log(`[Automation] All engagements complete. Browser shut down.`);

        engagement = {
          requested: requestedEngagementCount,
          attempted: engagementCount,
          executed: executedTotal,
          success: true,
          message: `Completed ${executedTotal} engagements in a single session.`,
          startDelayMs,
        };
      } catch (err) {
        engagement = {
          requested: requestedEngagementCount,
          attempted: engagementCount,
          executed: 0,
          success: false,
          message: err.message,
          startDelayMs: 0,
        };
      }
    } else {
      engagement = {
        requested: requestedEngagementCount,
        attempted: engagementCount,
        executed: 0,
        success: false,
        message: 'Puppeteer engager unavailable in this runtime',
        startDelayMs: 0,
      };
    }
  }

  const queueStats = await queueService.getQueueStats();

  return {
    success: true,
    timeZone,
    dateKey,
    limits: {
      maxPostsPerDay,
      maxPostsPerRun,
      postsRemainingAfterRun: Math.max(0, maxPostsPerDay - postsToday),
    },
    posts: {
      processed: postsProcessed,
      attemptedItems: attempts,
      postsToday,
      details: processedItems,
    },
    engagement,
    queue: queueStats,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * processInstagramReels — CORE PIPELINE (Redesigned v2)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * When a new channel is added:
 *   1. Fetch latest 3 video reels from the Instagram account
 *   2. For EACH reel, run triple-layer dedup:
 *      - Queue check (shortcode in any queue item)
 *      - History check (shortcode in completed posts)
 *      - Seen list check (shortcode already processed)
 *   3. For EACH passing reel:
 *      - AI identifies product from caption + thumbnail
 *      - Flipkart search finds matching product
 *      - EarnKaro generates affiliate link
 *      - AI generates Pinterest SEO title/description
 *   4. Schedule: Reel 0 = instant, Reel 1 = +60min, Reel 2 = +120min
 *   5. Trigger fire-post.yml (processes only Reel 0)
 *   6. Reels 1 & 2 are picked up by hourly automation when their time comes
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */
async function processInstagramReels(options = {}) {
  const config = await historyService.getWorkflowConfig();
  if (config.pinterestPosting === false && !options.force) {
    console.log('[Automation] Instagram-to-Pinterest Posting is DISABLED. Skipping scan.');
    return { success: true, count: 0, message: 'Workflow disabled' };
  }

  const username = options.username; // If provided, only process this channel
  const limit = options.limit || 0; // If provided, limit number of reels processed
  const force = !!options.force;
  
  // Schedule gap in minutes between each queued reel
  const SCHEDULE_GAP_MINUTES = toInt(process.env.REEL_SCHEDULE_GAP_MINUTES, 60);

  console.log(`[Automation] ═══════════════════════════════════════════════════`);
  console.log(`[Automation] Processing Instagram reels... (Channel: ${username || 'ALL'}, Limit: ${limit || 'None'})`);
  console.log(`[Automation] Schedule gap: ${SCHEDULE_GAP_MINUTES} minutes between posts`);
  console.log(`[Automation] ═══════════════════════════════════════════════════`);

  try {
    let reels = [];
    if (username) {
      // Direct fetch for a single channel (used when adding a new channel)
      const allReels = await igTrackerService.fetchLatestReels(username);
      if (force) {
        reels = allReels;
      } else {
        const allNew = await igTrackerService.scanForNewReels();
        reels = allNew.filter(r => r.username === username);
      }
    } else {
      reels = await igTrackerService.scanForNewReels();
    }

    if (limit > 0) {
      reels = reels.slice(0, limit);
    } else if (username && force) {
      // User specifically requested TOP 3 for newly added channels
      reels = reels.slice(0, 3);
    }

    if (reels.length === 0) {
      console.log('[Automation] No new reels to process.');
      return { success: true, count: 0 };
    }

    console.log(`[Automation] Found ${reels.length} reels to process.`);
    const results = { success: 0, failed: 0, skipped: 0, details: [] };
    
    // ═══════════════════════════════════════════════════════════════════
    // PRE-FLIGHT: Load existing queue and history for dedup
    // ═══════════════════════════════════════════════════════════════════
    const existingQueue = await queueService.getQueue();
    const postHistory = await historyService.getAll();
    
    // Build dedup sets for O(1) lookup
    const queueShortcodes = new Set();
    const queueMediaUrls = new Set();
    for (const item of existingQueue) {
      const sc = queueService.extractShortcode(item);
      if (sc) queueShortcodes.add(sc);
      if (item.mediaUrl) queueMediaUrls.add(item.mediaUrl);
    }
    
    const postedShortcodes = new Set();
    for (const post of postHistory) {
      if (post.reelData?.shortcode) postedShortcodes.add(post.reelData.shortcode);
      if (post.url) {
        const match = post.url.match(/\/(reel|p|tv)\/([A-Za-z0-9_-]+)/);
        if (match) postedShortcodes.add(match[2]);
      }
    }
    
    console.log(`[Automation] Dedup sets loaded: ${queueShortcodes.size} in queue, ${postedShortcodes.size} in history`);

    let queuedIndex = 0; // Tracks how many reels actually passed dedup and got queued

    for (let reelIdx = 0; reelIdx < reels.length; reelIdx++) {
      const reel = reels[reelIdx];
      
      try {
        console.log(`\n[Automation] ─── Reel ${reelIdx + 1}/${reels.length}: ${reel.shortcode} from @${reel.username} ───`);
        
        // ═══════════════════════════════════════════════════════════════
        // TRIPLE-LAYER DEDUP CHECK
        // ═══════════════════════════════════════════════════════════════
        
        // Layer 1: Queue dedup
        if (reel.shortcode && queueShortcodes.has(reel.shortcode)) {
          console.log(`[Automation] ⛔ SKIP: ${reel.shortcode} already in queue`);
          await igTrackerService.markReelAsSeen(reel.username, reel.shortcode);
          results.skipped++;
          results.details.push({ shortcode: reel.shortcode, status: 'skipped', reason: 'in_queue' });
          continue;
        }
        
        // Layer 2: History dedup
        if (reel.shortcode && postedShortcodes.has(reel.shortcode)) {
          console.log(`[Automation] ⛔ SKIP: ${reel.shortcode} already posted to Pinterest`);
          await igTrackerService.markReelAsSeen(reel.username, reel.shortcode);
          results.skipped++;
          results.details.push({ shortcode: reel.shortcode, status: 'skipped', reason: 'already_posted' });
          continue;
        }
        
        // Layer 3: Media URL dedup (same video = same content)
        if (reel.mediaUrl && queueMediaUrls.has(reel.mediaUrl)) {
          console.log(`[Automation] ⛔ SKIP: ${reel.shortcode} media URL already in queue`);
          await igTrackerService.markReelAsSeen(reel.username, reel.shortcode);
          results.skipped++;
          results.details.push({ shortcode: reel.shortcode, status: 'skipped', reason: 'media_in_queue' });
          continue;
        }

        console.log(`[Automation] ✅ Passed dedup. Processing reel ${reel.shortcode}...`);
        
        // ═══════════════════════════════════════════════════════════════
        // STEP 1: AI Product Identification
        // ═══════════════════════════════════════════════════════════════
        console.log(`[Automation] 🤖 Step 1: Identifying product...`);
        const productResult = await aiService.identifyProduct({
          caption: reel.caption || '',
          username: reel.username,
          thumbnailUrl: reel.thumbnailUrl || reel.mediaUrl
        });

        let affiliateUrl = null;
        let productName = null;

        if (productResult.found) {
          productName = productResult.productName;
          console.log(`[Automation] 🎯 Product found: "${productName}" (${productResult.category})`);
          
          // ═══════════════════════════════════════════════════════════════
          // STEP 2: Flipkart Search → EarnKaro Affiliate Link
          // ═══════════════════════════════════════════════════════════════
          console.log(`[Automation] 🔍 Step 2: Searching Flipkart...`);
          const fp = await flipkartSearchService.findProduct(productResult, productName);
          if (fp) {
            console.log(`[Automation] 🛒 Flipkart match: "${fp.title}"`);
            console.log(`[Automation] 🔗 Step 3: Generating EarnKaro affiliate link...`);
            const ek = await earnKaroService.makeAffiliateLink(fp.url);
            affiliateUrl = ek.affiliateUrl;
            console.log(`[Automation] ✅ Affiliate link: ${affiliateUrl} (source: ${ek.source})`);
            
            // Cache the affiliate link
            await igTrackerService.setCachedAffiliateLink(reel.shortcode, affiliateUrl);
          } else {
            console.log(`[Automation] ⚠️ No Flipkart match. Will post without affiliate link.`);
          }
        } else {
          console.log(`[Automation] ℹ️ No shoppable product detected. Posting as standard Pin.`);
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 2b: Smart Thumbnail Selection (AI picks best product frame)
        // ═══════════════════════════════════════════════════════════════
        console.log(`[Automation] 🖼️ Step 2b: Selecting best product thumbnail...`);
        const { selectBestThumbnailSafe } = getThumbnailService();
        const bestThumbnailUrl = await selectBestThumbnailSafe(reel, productName || '');
        const thumbnailChanged = bestThumbnailUrl !== (reel.thumbnailUrl || reel.mediaUrl);
        if (thumbnailChanged) {
          console.log(`[Automation] ✅ Smart thumbnail selected (frame extraction succeeded).`);
        } else {
          console.log(`[Automation] ℹ️ Using original thumbnail (frame extraction skipped or fallback).`);
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 3: Generate Pinterest Content
        // ═══════════════════════════════════════════════════════════════
        console.log(`[Automation] ✍️ Step 4: Generating Pinterest content...`);
        const pinContent = await aiService.generatePinterestContent({
          caption: reel.caption,
          username: reel.username,
          productName: productName
        });

        // Build description with affiliate CTA
        let finalDescription = pinContent.description;
        if (affiliateUrl) {
          finalDescription = `${pinContent.description}\n\n🛒 Shop this look → ${affiliateUrl}`.substring(0, 800);
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 4: Calculate schedule time
        // ═══════════════════════════════════════════════════════════════
        let scheduledAfter = null; // Always post instantly when a new channel is added
        console.log(`[Automation] 🚀 Reel ${queuedIndex}: Will be posted INSTANTLY`);

        // ═══════════════════════════════════════════════════════════════
        // STEP 5: Build queue item with ALL correct fields
        // ═══════════════════════════════════════════════════════════════
        const queueItem = {
          title: pinContent.title,
          description: finalDescription,
          altText: `${productName ? `Product: ${productName}` : 'Showcased item'} from @${reel.username}`,
          mediaUrl: reel.mediaUrl,
          sourceUrl: reel.url,
          // CRITICAL: destinationLink is the affiliate/product link
          destinationLink: affiliateUrl || '',
          link: affiliateUrl || '',
          originalSourceUrl: reel.url,
          username: reel.username,
          caption: reel.caption || '',
          // Use AI-selected best thumbnail (base64 data URI or original URL)
          thumbnailUrl: bestThumbnailUrl || reel.thumbnailUrl || reel.mediaUrl,
          // CRITICAL: Store shortcode as top-level field for dedup
          shortcode: reel.shortcode,
          // Schedule
          scheduledAfter: scheduledAfter,
          // AI Content blob
          aiContent: {
            title: pinContent.title,
            description: finalDescription,
            hashtags: pinContent.hashtags || [],
          },
          // Metadata
          productInfo: productResult.found ? {
            name: productName,
            category: productResult.category,
            affiliateUrl: affiliateUrl,
          } : null,
          // Thumbnail metadata for debugging
          thumbnailMeta: {
            source: thumbnailChanged ? 'ai_frame_selection' : 'original',
            productName: productName || null,
          },
        };

        const isFirst = queuedIndex === 0;
        await queueService.addToQueue([queueItem], isFirst);
        console.log(`[Automation] ✅ Added to queue: ${reel.shortcode} (${isFirst ? '🚀 INSTANT' : `⏰ SCHEDULED +${SCHEDULE_GAP_MINUTES * queuedIndex}min`})`);
        console.log(`[Automation]    Title: "${pinContent.title}"`);
        console.log(`[Automation]    Affiliate: ${affiliateUrl || 'NONE'}`);

        // Mark seen AFTER successful queue add
        await igTrackerService.markReelAsSeen(reel.username, reel.shortcode);
        
        // Update dedup sets for remaining reels in this batch
        queueShortcodes.add(reel.shortcode);
        if (reel.mediaUrl) queueMediaUrls.add(reel.mediaUrl);
        
        results.success++;
        results.details.push({ 
          shortcode: reel.shortcode, 
          status: 'queued',
          scheduledAfter: scheduledAfter || 'instant',
          affiliateUrl: affiliateUrl || 'none',
        });
        queuedIndex++;

        // Add a small delay between reels to avoid AI rate limits
        if (reelIdx < reels.length - 1) {
          const waitMs = force ? 2000 : 10000;
          await sleep(waitMs);
        }
      } catch (err) {
        console.error(`[Automation] ❌ Failed to process reel ${reel.shortcode}:`, err.message);
        results.failed++;
        results.details.push({ shortcode: reel.shortcode, status: 'failed', error: err.message });
      }
    }


    // Trigger GitHub Action to process the first queued item (instant post)
    if (results.success > 0) {
      console.log(`\n[Automation] 🚀 Triggering fire-post for instant item...`);
      const githubService = require('./githubService');
      githubService.triggerInstantMission().catch(() => {});
    }

    console.log(`\n[Automation] ═══════════════════════════════════════════════════`);
    console.log(`[Automation] PIPELINE COMPLETE`);
    console.log(`[Automation]   ✅ Queued: ${results.success}`);
    console.log(`[Automation]   ⛔ Skipped (dedup): ${results.skipped}`);
    console.log(`[Automation]   ❌ Failed: ${results.failed}`);
    console.log(`[Automation] ═══════════════════════════════════════════════════`);

    return { success: true, ...results };
  } catch (err) {
    console.error('[Automation] Fatal error in processInstagramReels:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  runHourlyAutomation,
  processInstagramReels,
};

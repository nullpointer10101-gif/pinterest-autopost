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
    console.log(`[Automation] Found ${pending} pending items in queue.`);

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

async function processInstagramReels(options = {}) {
  const config = await historyService.getWorkflowConfig();
  if (config.pinterestPosting === false && !options.force) {
    console.log('[Automation] Instagram-to-Pinterest Posting is DISABLED. Skipping scan.');
    return { success: true, count: 0, message: 'Workflow disabled' };
  }

  const username = options.username; // If provided, only process this channel
  const limit = options.limit || 0; // If provided, limit number of reels processed
  const force = !!options.force;

  console.log(`[Automation] Processing Instagram reels... (Channel: ${username || 'ALL'}, Limit: ${limit || 'None'})`);

  try {
    let reels = [];
    if (username) {
      // Direct fetch for a single channel (often used when adding a new channel)
      const allReels = await igTrackerService.fetchLatestReels(username);
      if (force) {
        reels = allReels;
      } else {
        const state = await igTrackerService.getTrackerStatus(); // We need a better way to check seen for a single channel
        // Actually, scanForNewReels handles the seen logic, but it's for all channels.
        // Let's just use scanForNewReels and filter if username is provided.
        const allNew = await igTrackerService.scanForNewReels();
        reels = allNew.filter(r => r.username === username);
      }
    } else {
      reels = await igTrackerService.scanForNewReels();
    }

    if (limit > 0) {
      reels = reels.slice(0, limit);
    }

    if (reels.length === 0) {
      console.log('[Automation] No new reels to process.');
      return { success: true, count: 0 };
    }

    console.log(`[Automation] Found ${reels.length} reels to process.`);
    const results = { success: 0, failed: 0, details: [] };

    for (const reel of reels) {
      try {
        console.log(`[Automation] Processing reel ${reel.shortcode} from @${reel.username}...`);
        
        // Add a small delay between reels to avoid AI rate limits
        if (results.success > 0 || results.failed > 0) {
          console.log('[Automation] Sleeping 15s to respect rate limits...');
          await sleep(15000);
        }

        // 1. Identify product
        const productResult = await aiService.identifyProduct({
          caption: reel.caption || '',
          username: reel.username,
          thumbnailUrl: reel.thumbnailUrl || reel.mediaUrl
        });

        let affiliateUrl = null;
        let productName = null;

        if (productResult.found) {
          productName = productResult.productName;
          console.log(`[Automation] Product: ${productName}`);

          // 2. Search Flipkart
          const fp = await flipkartSearchService.findProduct(productResult, productName);
          if (fp) {
            // 3. Make affiliate link
            const ek = await earnKaroService.makeAffiliateLink(fp.url);
            affiliateUrl = ek.affiliateUrl;
            console.log(`[Automation] Affiliate Link: ${affiliateUrl}`);
          }
        }

        // 4. Generate Pinterest Content
        const pinContent = await aiService.generatePinterestContent({
          caption: reel.caption,
          username: reel.username,
          productName: productName
        });

        const finalDescription = affiliateUrl 
          ? `${pinContent.description}\n\n🛒 Buy it here → ${affiliateUrl}`.substring(0, 800)
          : pinContent.description;

        // 5. Post DIRECTLY to Pinterest
        const pinData = {
          title: pinContent.title,
          description: finalDescription,
          link: affiliateUrl || '',
          media_source: { url: reel.mediaUrl },
        };

        const postResult = await puppeteerService.createPinWithBot(pinData);
        console.log(`[Automation] ✅ Posted successfully!`);

        // 6. Mark seen
        await igTrackerService.markReelAsSeen(reel.username, reel.shortcode);
        
        results.success++;
        results.details.push({ shortcode: reel.shortcode, status: 'posted', url: postResult.url });
      } catch (err) {
        console.error(`[Automation] ❌ Failed to process reel ${reel.shortcode}:`, err.message);
        results.failed++;
        results.details.push({ shortcode: reel.shortcode, status: 'failed', error: err.message });
      }
    }

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

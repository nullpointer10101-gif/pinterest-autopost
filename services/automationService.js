const queueService = require('./queueService');
const historyService = require('./historyService');

let puppeteerService = null;
try {
  puppeteerService = require('./puppeteerService');
} catch (err) {
  console.warn('[Automation] Puppeteer service unavailable:', err.message);
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
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDateKey(timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const y = parts.find((part) => part.type === 'year')?.value || '1970';
  const m = parts.find((part) => part.type === 'month')?.value || '01';
  const d = parts.find((part) => part.type === 'day')?.value || '01';
  return `${y}-${m}-${d}`;
}

async function runHourlyAutomation(options = {}) {
  const engagementLikeTarget = Math.max(0, toInt(
    options.engagementLikeTarget ?? process.env.AUTOMATION_ENGAGEMENT_LIKE_TARGET ?? process.env.AUTOMATION_ENGAGEMENT_LIKES_PER_HOUR,
    5
  ));
  const engagementCommentTarget = Math.max(0, toInt(
    options.engagementCommentTarget ?? process.env.AUTOMATION_ENGAGEMENT_COMMENT_TARGET ?? process.env.AUTOMATION_ENGAGEMENT_COMMENTS_PER_HOUR,
    3
  ));
  const engagementOnly = options.engagementOnly === true || process.env.AUTOMATION_ENGAGEMENT_ONLY === 'true';
  const requireEngagementSuccess = options.requireEngagementSuccess === true
    || process.env.AUTOMATION_REQUIRE_ENGAGEMENT_SUCCESS === 'true';
  const maxPostsPerDay = Math.max(0, toInt(options.maxPostsPerDay ?? process.env.AUTOMATION_MAX_POSTS_PER_DAY, 10));
  const maxPostsPerRun = Math.max(0, toInt(options.maxPostsPerRun ?? process.env.AUTOMATION_MAX_POSTS_PER_RUN, 2));
  const requestedEngagementCount = Math.max(
    0,
    toInt(
      options.engagementCount ?? process.env.AUTOMATION_ENGAGEMENTS_PER_HOUR,
      engagementLikeTarget + engagementCommentTarget
    )
  );
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
    console.log('[Automation] Pinterest engagement is disabled in workflow config. Skipping bot session unless forced.');
  }

  const runGuardField = engagementOnly ? 'lastEngagementRunAt' : 'lastRunAt';
  if (!options.force && automation[runGuardField]) {
    const lastRunTime = new Date(automation[runGuardField]).getTime();
    const minutesSinceLastRun = (Date.now() - lastRunTime) / (1000 * 60);
    if (minutesSinceLastRun < 45) {
      console.log(`[Automation] Skipped: last ${engagementOnly ? 'engagement' : 'automation'} run was ${Math.round(minutesSinceLastRun)}m ago (min 45m).`);
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
  console.log('[Automation] Instagram scraping/reposting is intentionally handled by the isolated IG repost pipeline.');
  console.log(`[Automation] Target posts this run: ${targetPostsThisRun}`);

  let postsProcessed = 0;
  let attempts = 0;
  const maxAttempts = Math.max(3, targetPostsThisRun * 4);
  const processedItems = [];

  if (!engagementOnly && targetPostsThisRun > 0) {
    if (config.pinterestPosting === false && !options.force) {
      console.log('[Automation] Pinterest posting is disabled. Skipping queue processing.');
    } else {
      const queue = await queueService.getQueue();
      const pending = queue.filter((item) => item.status === 'pending').length;
      const now = new Date();
      const ready = queue.filter((item) => {
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
          console.log(`[Automation] Successfully posted: ${processed.title}`);
          postsProcessed += 1;
        } else {
          console.log(`[Automation] Failed to post: ${processed.error || 'Unknown error'}`);
        }
      }
    }
  } else {
    console.log('[Automation] Skipping queue processing (limit reached or target is 0).');
  }

  postsToday += postsProcessed;
  if (!engagementOnly) {
    await historyService.setAutomationState({
      ...automation,
      dateKey,
      postsToday,
      lastRunAt: new Date().toISOString(),
    });
  }

  let engagement = {
    requested: requestedEngagementCount,
    attempted: engagementCount,
    executed: 0,
    success: false,
    message: 'Engagement skipped',
    startDelayMs: 0,
  };

  let shouldRunEngagement = engagementCount > 0;
  if (shouldRunEngagement && !engagementOnly && !options.force && automation.lastEngagementRunAt) {
    const lastEngagementTime = new Date(automation.lastEngagementRunAt).getTime();
    const minutesSinceEngagement = (Date.now() - lastEngagementTime) / (1000 * 60);
    if (Number.isFinite(minutesSinceEngagement) && minutesSinceEngagement < 45) {
      console.log(`[Automation] Skipping engagement: dedicated engagement ran ${Math.round(minutesSinceEngagement)}m ago.`);
      engagement = {
        requested: requestedEngagementCount,
        attempted: 0,
        executed: 0,
        success: true,
        skipped: true,
        message: `Skipped because engagement ran ${Math.round(minutesSinceEngagement)}m ago.`,
        startDelayMs: 0,
      };
      shouldRunEngagement = false;
    }
  }

  if (shouldRunEngagement) {
    if (config.pinterestEngagement === false && !options.force) {
      console.log('[Automation] Pinterest engagement is disabled. Skipping bot.');
    } else if (puppeteerService && typeof puppeteerService.runAutoEngagerSafe === 'function') {
      try {
        const startDelayMs = randomInt(engagementStartJitterMinMs, engagementStartJitterMaxMs);
        if (startDelayMs > 0) {
          console.log(`[Automation] Initial jitter: waiting ${Math.round(startDelayMs / 1000)}s before starting engagement...`);
          await sleep(startDelayMs);
        }

        console.log(`[Automation] Launching browser for ${engagementCount} engagement(s)...`);

        const result = await puppeteerService.runAutoEngagerSafe({
          count: engagementCount,
          niche: options.engagementNiche || 'all',
          likeTarget: engagementLikeTarget,
          commentTarget: engagementCommentTarget,
          minGapMs: engagementMinGapMs,
          maxGapMs: engagementMaxGapMs,
          commentChance,
          context: {
            source: process.env.GITHUB_ACTIONS === 'true' ? 'github_actions' : 'local',
            command: 'node scripts/run-hourly-automation.js',
          },
        });

        const executedTotal = Math.max(0, toInt(result?.executed, 0));
        console.log('[Automation] All engagements complete. Browser shut down.');

        engagement = {
          requested: requestedEngagementCount,
          attempted: engagementCount,
          executed: executedTotal,
          success: true,
          partial: Boolean(result?.partial),
          message: result?.partial
            ? `Completed ${executedTotal} engagement(s) before Pinterest slowed down; counted as a safe partial success.`
            : `Completed ${executedTotal} engagements in a single session.`,
          startDelayMs,
          targets: {
            likes: engagementLikeTarget,
            comments: engagementCommentTarget,
          },
          completed: {
            likes: Math.max(0, toInt(result?.likesCompleted, 0)),
            comments: Math.max(0, toInt(result?.commentsCompleted, 0)),
          },
          niche: result?.niche || options.engagementNiche || 'all',
        };
        if (executedTotal > 0) {
          const automationState = await historyService.getAutomationState();
          await historyService.setAutomationState({
            ...automationState,
            lastEngagementRunAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        engagement = {
          requested: requestedEngagementCount,
          attempted: engagementCount,
          executed: 0,
          success: false,
          message: err.message,
          startDelayMs: 0,
          targets: {
            likes: engagementLikeTarget,
            comments: engagementCommentTarget,
          },
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
        targets: {
          likes: engagementLikeTarget,
          comments: engagementCommentTarget,
        },
      };
    }
  }

  const queueStats = await queueService.getQueueStats();
  const engagementFailedRequired = requireEngagementSuccess
    && engagementCount > 0
    && (!engagement.success || Number(engagement.executed || 0) <= 0);

  return {
    success: !engagementFailedRequired,
    message: engagementFailedRequired
      ? `Engagement did not complete any actions: ${engagement.message || '0 actions'}`
      : undefined,
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

module.exports = {
  runHourlyAutomation,
};

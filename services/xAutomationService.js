const xQueueService = require('./xQueueService');
const xHistoryService = require('./xHistoryService');

let xPuppeteerService = null;
try {
  xPuppeteerService = require('./xPuppeteerService');
} catch (err) {
  console.warn('[X-Automation] Puppeteer service unavailable:', err.message);
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
  const maxPostsPerDay = Math.max(1, toInt(options.maxPostsPerDay ?? process.env.X_AUTOMATION_MAX_POSTS_PER_DAY, 5));
  const maxPostsPerRun = Math.max(0, toInt(options.maxPostsPerRun ?? process.env.X_AUTOMATION_MAX_POSTS_PER_RUN, 1));
  const requestedEngagementCount = Math.max(0, toInt(options.engagementCount ?? process.env.X_AUTOMATION_ENGAGEMENTS_PER_HOUR, 2));
  const engagementHardCap = Math.max(1, toInt(process.env.X_AUTOMATION_ENGAGEMENTS_HARD_CAP, 5));
  const engagementCount = Math.min(requestedEngagementCount, engagementHardCap);
  const timeZone = options.timeZone || process.env.AUTOMATION_TIMEZONE || 'Asia/Calcutta';
  const engagementStartJitterMinMs = Math.max(0, toInt(process.env.AUTOMATION_ENGAGEMENT_START_JITTER_MIN_MS, 15000));
  const engagementStartJitterMaxMs = Math.max(
    engagementStartJitterMinMs,
    toInt(process.env.AUTOMATION_ENGAGEMENT_START_JITTER_MAX_MS, 60000)
  );
  const engagementMinGapMs = Math.max(10000, toInt(process.env.AUTOMATION_ENGAGEMENT_MIN_GAP_MS, 60000));
  const engagementMaxGapMs = Math.max(
    engagementMinGapMs,
    toInt(process.env.AUTOMATION_ENGAGEMENT_MAX_GAP_MS, 3 * 60 * 1000)
  );
  const commentChance = Math.min(1, Math.max(0.1, toFloat(process.env.X_AUTOMATION_COMMENT_PROBABILITY, 0.50)));

  const dateKey = getDateKey(timeZone);
  const automation = await xHistoryService.getAutomationState();

  if (!options.force && automation.lastRunAt) {
    const lastRunTime = new Date(automation.lastRunAt).getTime();
    const minutesSinceLastRun = (Date.now() - lastRunTime) / (1000 * 60);
    if (minutesSinceLastRun < 45) {
      console.log(`[X-Automation] Skipped: Last run was ${Math.round(minutesSinceLastRun)}m ago (min 45m).`);
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

  console.log(`[X-Automation] Date: ${dateKey} | Posts Today: ${postsToday} | Remaining: ${postsRemaining}`);
  console.log(`[X-Automation] Target posts this run: ${targetPostsThisRun}`);

  let postsProcessed = 0;
  let attempts = 0;
  const maxAttempts = Math.max(3, targetPostsThisRun * 4);
  const processedItems = [];

  if (targetPostsThisRun > 0) {
    const queue = await xQueueService.getQueue();
    const pending = queue.filter(item => item.status === 'pending').length;
    console.log(`[X-Automation] Found ${pending} pending items in queue.`);

    while (postsProcessed < targetPostsThisRun && attempts < maxAttempts) {
      attempts += 1;
      console.log(`[X-Automation] Processing post attempt ${attempts}...`);
      const processed = await xQueueService.processNextInQueue();
      if (!processed) {
        console.log('[X-Automation] No more items to process in queue.');
        break;
      }
      processedItems.push({
        id: processed.id,
        status: processed.status,
        method: processed.method || null,
        error: processed.error || null,
      });
      if (processed.status === 'completed') {
        console.log(`[X-Automation] ✅ Successfully posted: ${processed.title}`);
        postsProcessed += 1;
      } else {
        console.log(`[X-Automation] ❌ Failed to post: ${processed.error || 'Unknown error'}`);
      }
    }
  } else {
    console.log('[X-Automation] Skipping queue processing (limit reached or target is 0).');
  }

  postsToday += postsProcessed;
  await xHistoryService.setAutomationState({
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
    if (xPuppeteerService && typeof xPuppeteerService.runAutoEngagerSafe === 'function') {
      try {
        const startDelayMs = randomInt(engagementStartJitterMinMs, engagementStartJitterMaxMs);
        if (startDelayMs > 0) {
          console.log(`[X-Automation] Initial jitter: Waiting ${Math.round(startDelayMs / 1000)}s before starting engagement...`);
          await sleep(startDelayMs);
        }

        console.log(`[X-Automation] Launching browser for ${engagementCount} engagement(s)...`);
        
        const result = await xPuppeteerService.runAutoEngagerSafe({
          count: engagementCount,
          minGapMs: engagementMinGapMs,
          maxGapMs: engagementMaxGapMs,
          commentChance,
          context: {
            source: process.env.GITHUB_ACTIONS === 'true' ? 'github_actions' : 'local',
            command: 'node scripts/run-x-hourly-automation.js',
          },
        });

        const executedTotal = Math.max(0, toInt(result?.executed, 0));
        console.log(`[X-Automation] All engagements complete. Browser shut down.`);

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

  const queueStats = await xQueueService.getQueueStats();

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

module.exports = {
  runHourlyAutomation,
};

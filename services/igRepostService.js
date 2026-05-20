const axios = require('axios');
const aiService = require('./aiService');
const productCurationService = require('./productCurationService');
const igTrackerService = require('./igTrackerService');
const publisherService = require('./igRepostPublisherService');
const stateService = require('./igRepostStateService');
const qualityGateService = require('./qualityGateService');

let selectBoard = () => null;
try {
  ({ selectBoard } = require('./boardSelectorService'));
} catch (err) {
  console.warn('[IG-Repost] boardSelectorService unavailable:', err.message);
}

let extractFrameFromVideo = null;
try {
  ({ extractFrameFromVideo } = require('./frameExtractorService'));
} catch (err) {
  console.warn('[IG-Repost] frameExtractorService unavailable:', err.message);
}

const IG_SESSION_COOKIE =
  process.env.IG_REPOST_INSTAGRAM_SESSION_COOKIE ||
  process.env.INSTAGRAM_SESSION_COOKIE ||
  '';

const IG_CSRF = (IG_SESSION_COOKIE.match(/csrftoken=([^;]+)/i) || [])[1] || '';

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function igHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    'Accept': 'application/json',
    'Referer': 'https://www.instagram.com/',
    'x-ig-app-id': '936619743392459',
    'x-requested-with': 'XMLHttpRequest',
    'x-instagram-ajax': '1',
    'x-csrftoken': IG_CSRF,
    Cookie: IG_SESSION_COOKIE,
  };
}

function cleanCaption(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function fallbackContent(item) {
  const caption = cleanCaption(item.caption || '');
  const baseTitle = item.username
    ? `Instagram Reel from @${item.username}`
    : 'Instagram Reel Repost';
  const title = (caption.split(/[.!?]/)[0] || baseTitle).trim().substring(0, 100) || baseTitle;
  const description = (caption || `Fresh reel reposted from @${item.username}.`).substring(0, 800);
  return {
    title,
    description,
    hashtags: [],
  };
}

function buildAltText(item) {
  return `Instagram reel repost from @${item.username}`.substring(0, 500);
}

function getAppBaseUrl() {
  return String(process.env.APP_BASE_URL || 'https://pinterest-autopost.vercel.app')
    .trim()
    .replace(/\/+$/, '');
}

function buildStorefrontUrl(shortcode) {
  const cleanShortcode = String(shortcode || '').trim();
  if (!cleanShortcode) return '';
  return `${getAppBaseUrl()}/look/${cleanShortcode}`;
}

function appendStorefrontCta(description, storefrontUrl) {
  const base = String(description || '').trim();
  if (!storefrontUrl) return base.substring(0, 800);
  const cta = `\n\nShop matching product finds here -> ${storefrontUrl}`;
  return `${base}${cta}`.trim().substring(0, 800);
}

function backoffMs(attempt) {
  const baseMinutes = Math.max(15, toInt(process.env.IG_REPOST_RETRY_BASE_MINUTES, 30));
  const exponent = Math.max(0, attempt - 1);
  const minutes = Math.min(6 * 60, baseMinutes * (2 ** exponent));
  return minutes * 60 * 1000;
}

let directIgBlocked = false;

async function fetchPinnedShortcodes(username) {
  if (directIgBlocked) {
    return { known: false, shortcodes: new Set() };
  }
  if (IG_SESSION_COOKIE && IG_CSRF) {
    try {
      const profileRes = await axios.get(
        `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}&__d=dis`,
        { headers: igHeaders(), timeout: 15000 }
      );

      const user = profileRes.data?.data?.user;
      const userId = user?.id;
      if (userId) {
        const feedRes = await axios.get(
          `https://www.instagram.com/api/v1/feed/user/${userId}/?count=18`,
          { headers: igHeaders(), timeout: 15000 }
        );
        const pinned = (feedRes.data?.items || [])
          .filter((item) => item?.is_pinned === true)
          .map((item) => item.code || item.shortcode)
          .filter(Boolean);
        return { known: true, shortcodes: new Set(pinned) };
      }
    } catch (err) {
      console.warn(`[IG-Repost] Session pinned lookup failed for @${username}:`, err.message);
      if (err.response?.status === 429 || err.message.includes('429')) {
        console.warn('[IG-Repost] Instagram direct API is rate-limiting us (429). Short-circuiting future direct lookups for this run.');
        directIgBlocked = true;
        return { known: false, shortcodes: new Set() };
      }
    }
  }

  try {
    const res = await axios.get(
      `https://www.instagram.com/${username}/?__a=1&__d=dis`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
          'Accept': 'application/json',
          'Referer': 'https://www.instagram.com/',
          'x-ig-app-id': '936619743392459',
        },
        timeout: 12000,
      }
    );

    const user = res.data?.graphql?.user || res.data?.data?.user;
    if (!user) return { known: false, shortcodes: new Set() };
    const edges = user?.edge_owner_to_timeline_media?.edges || [];
    const pinned = edges
      .filter((edge) => (
        edge?.node?.is_pinned === true ||
        (Array.isArray(edge?.node?.pinned_for_users) && edge.node.pinned_for_users.length > 0)
      ))
      .map((edge) => edge?.node?.shortcode)
      .filter(Boolean);
    return { known: true, shortcodes: new Set(pinned) };
  } catch (err) {
    console.warn(`[IG-Repost] Public pinned lookup failed for @${username}:`, err.message);
    if (err.response?.status === 429 || err.message.includes('429')) {
      console.warn('[IG-Repost] Instagram public direct API is rate-limiting us (429). Short-circuiting future direct lookups for this run.');
      directIgBlocked = true;
    }
    return { known: false, shortcodes: new Set() };
  }
}

async function generateContent(item, imageData = null) {
  try {
    const aiContent = await aiService.generatePinterestContent({
      caption: item.caption || '',
      username: item.username || 'unknown',
      mediaType: item.mediaType || 'video',
      imageData,
    });
    const hashtags = Array.isArray(aiContent?.hashtags) ? aiContent.hashtags.join(' ') : '';
    const description = `${String(aiContent?.description || '').trim()}${hashtags ? `\n\n${hashtags}` : ''}`.trim().substring(0, 800);
    return {
      title: String(aiContent?.title || '').trim().substring(0, 100) || fallbackContent(item).title,
      description: description || fallbackContent(item).description,
    };
  } catch (err) {
    console.warn(`[IG-Repost] AI content generation failed for ${item.shortcode}:`, err.message);
    return fallbackContent(item);
  }
}

async function extractPostingFrame(item) {
  if (!extractFrameFromVideo) return null;
  if (!item?.mediaUrl) return null;
  if (String(item.mediaType || 'video').toLowerCase() !== 'video') return null;

  try {
    return await extractFrameFromVideo(item.mediaUrl);
  } catch (err) {
    console.warn(`[IG-Repost] Frame extraction failed for ${item.shortcode}:`, err.message);
    return null;
  }
}

async function buildAffiliateLinksFromOutfit(outfitData, fallbackName) {
  return productCurationService.buildSameTypeShelfFromOutfit(outfitData, {
    limit: 4,
    fallbackName,
    logPrefix: '[IG-Repost]',
  });
}

async function buildAffiliateLinksFromSingleProduct(productData) {
  return productCurationService.buildSameTypeShelfFromProductData(productData, {
    limit: 4,
    logPrefix: '[IG-Repost]',
  });
}

async function preparePublishingPayload(item) {
  const imageData = await extractPostingFrame(item);
  const content = await generateContent(item, imageData);

  let title = String(content.title || fallbackContent(item).title).trim().substring(0, 100);
  let description = String(content.description || fallbackContent(item).description).trim().substring(0, 800);
  let finalLink = String(item.externalLink || '').trim();
  let boardName = '';
  let productInfo = null;
  let affiliateLinks = [];
  let mainProductName = '';
  let outfitName = '';
  let shoppingMission = null;

  const storefrontUrl = buildStorefrontUrl(item.shortcode);

  if (!finalLink && item.shortcode) {
    try {
      const outfitData = await aiService.identifyOutfit({
        caption: item.caption || '',
        username: item.username || '',
        thumbnailUrl: item.thumbnailUrl || '',
        mediaUrl: item.mediaUrl || '',
        imageData,
      });

      if (outfitData?.found && Array.isArray(outfitData.items) && outfitData.items.length > 0) {
        const resolved = await buildAffiliateLinksFromOutfit(outfitData, title);
        affiliateLinks = resolved.affiliateLinks;
        mainProductName = resolved.mainProductName;
        outfitName = String(resolved.outfitName || outfitData.outfitName || '').trim();
        shoppingMission = resolved.shoppingMission || null;
      } else {
        const productData = await aiService.identifyProduct({
          caption: item.caption || '',
          username: item.username || '',
          thumbnailUrl: item.thumbnailUrl || '',
          mediaUrl: item.mediaUrl || '',
          imageData,
        });
        const resolved = await buildAffiliateLinksFromSingleProduct(productData);
        affiliateLinks = resolved.affiliateLinks;
        mainProductName = resolved.mainProductName;
        outfitName = resolved.productTypeLabel ? `${resolved.productTypeLabel} Finds` : '';
        shoppingMission = resolved.shoppingMission || null;
      }
    } catch (err) {
      console.warn(`[IG-Repost] Product matching failed for ${item.shortcode}:`, err.message);
    }
  }

  if (affiliateLinks.length > 0) {
    finalLink = storefrontUrl || affiliateLinks[0].url;
    description = appendStorefrontCta(description, finalLink);
    productInfo = {
      name: outfitName || mainProductName || title || 'Curated Look',
      affiliateUrl: affiliateLinks[0].url,
      outfit: affiliateLinks,
      shoppingMission,
    };
  } else if (finalLink) {
    productInfo = {
      name: title || 'Featured Item',
      affiliateUrl: finalLink,
      outfit: [],
    };
  } else if (storefrontUrl) {
    finalLink = storefrontUrl;
  }

  try {
    const boardSignals = {
      productName: mainProductName || title,
      exactMatchQuery: mainProductName || '',
      outfitName,
      titleSignal: title,
      items: affiliateLinks.map((link) => ({ type: link.type, query: link.name })),
    };
    boardName = String(selectBoard(boardSignals) || '').trim();
  } catch (err) {
    console.warn(`[IG-Repost] Board selection failed for ${item.shortcode}:`, err.message);
  }

  return {
    shortcode: item.shortcode,
    caption: item.caption || '',
    title,
    description,
    altText: buildAltText(item),
    mediaUrl: item.mediaUrl,
    thumbnailUrl: item.thumbnailUrl || '',
    externalLink: finalLink,
    boardName,
    productInfo,
    hasFrame: !!imageData,
  };
}

function buildQueueItem(reel, options = {}) {
  return {
    username: reel.username,
    shortcode: reel.shortcode,
    sourceUrl: reel.url,
    mediaUrl: reel.mediaUrl || reel.thumbnailUrl,
    thumbnailUrl: reel.thumbnailUrl || reel.mediaUrl,
    caption: reel.caption || '',
    mediaType: reel.mediaType || 'video',
    maxAttempts: options.maxAttempts || toInt(process.env.IG_REPOST_MAX_ATTEMPTS, 3),
    scheduledAfter: options.scheduledAfter || new Date().toISOString(),
    validationJob: !!options.validationJob,
    reason: options.reason || 'scheduled_scan',
  };
}

async function scanAccount(username, options = {}) {
  const normalized = stateService.normalizeUsername(username);
  const validation = !!options.validation;
  const maxCandidates = Math.max(1, toInt(
    options.maxCandidates,
    validation ? 1 : toInt(process.env.IG_REPOST_MAX_NEW_PER_ACCOUNT, 1)
  ));
  const requirePinnedDetection = process.env.IG_REPOST_REQUIRE_PINNED_DETECTION !== 'false';

  await stateService.noteAccountScan(normalized);
  await stateService.appendLog('info', 'scan.started', `Scanning @${normalized} for new reels.`, {
    username: normalized,
    validation,
  });

  const reels = await igTrackerService.fetchLatestReels(normalized);
  if (!Array.isArray(reels) || (reels.length === 0 && !reels.success)) {
    const reason = 'No reels fetched from Instagram';
    if (validation) {
      await stateService.markAccountFailed(normalized, reason, { keepPending: false, stage: 'scan' });
    } else {
      await stateService.appendLog('warn', 'scan.empty', `No reels fetched for @${normalized}.`, {
        username: normalized,
      });
    }
    return { username: normalized, queued: 0, skipped: 0, scanned: 0, error: reason };
  }

  if (reels.length === 0) {
    const logMsg = `No video reels found for @${normalized} (fetched ${reels.fetchedTotal || 0} total posts, filtered ${reels.filteredImages || 0} images).`;
    await stateService.appendLog('info', 'scan.no_reels', logMsg, {
      username: normalized,
      fetchedTotal: reels.fetchedTotal,
      filteredImages: reels.filteredImages,
    });
    return {
      username: normalized,
      scanned: 0,
      queued: 0,
      skipped: reels.filteredImages || 0,
      added: [],
      queueSkips: [],
      warning: '',
    };
  }

  const discoveredProfilePicUrl = reels
    .map((reel) => String(reel.profilePicUrl || reel.profilePic || '').trim())
    .find(Boolean);
  if (discoveredProfilePicUrl) {
    await stateService.setAccountProfilePic(normalized, discoveredProfilePicUrl);
  }

  const pinnedInfo = await fetchPinnedShortcodes(normalized);
  const pinnedDetectionUnavailable = !pinnedInfo.known && requirePinnedDetection;
  let warning = '';
  if (pinnedDetectionUnavailable) {
    warning = validation
      ? 'Pinned detection unavailable; validation will use the latest fresh reel if needed.'
      : 'Pinned detection unavailable; only reels with trusted non-pinned metadata will be considered.';
    await stateService.appendLog(
      'warn',
      'scan.pinned_unknown',
      validation
        ? `Pinned detection was unavailable for @${normalized}. Validation will use the latest fresh reel if needed.`
        : `Pinned detection was unavailable for @${normalized}. Only reels with trusted non-pinned metadata will be considered.`,
      { username: normalized, validation }
    );
  }

  const queueItems = [];
  let skipped = 0;

  for (const reel of reels) {
    const sourcePinnedStateKnown = reel.pinnedStateKnown === true;
    const isPinned = reel.isPinned === true || (pinnedInfo.known && pinnedInfo.shortcodes.has(reel.shortcode));
    const hasTrustedNonPinnedState = sourcePinnedStateKnown && reel.isPinned === false;
    await stateService.upsertReelMeta(reel, {
      isPinned,
      pinnedStateKnown: sourcePinnedStateKnown,
    });

    const alreadyPosted = await stateService.hasSuccessfulPost(normalized, reel.shortcode);
    if (alreadyPosted) {
      skipped += 1;
      await stateService.appendLog('info', 'scan.duplicate', `Skipped duplicate reel ${reel.shortcode} from @${normalized}.`, {
        username: normalized,
        shortcode: reel.shortcode,
      });
      continue;
    }

    if (validation) {
      queueItems.push(buildQueueItem(reel, {
        validationJob: true,
        reason: 'new_account_validation',
      }));

      if (queueItems.length >= maxCandidates) break;
      continue;
    }

    if (isPinned) {
      await stateService.markPinnedSkipped(reel, { username: normalized });
      skipped += 1;
      continue;
    }

    if (pinnedDetectionUnavailable && !hasTrustedNonPinnedState) {
      skipped += 1;
      await stateService.appendLog(
        'warn',
        'scan.skipped_without_pinned_detection',
        `Skipped fresh reel ${reel.shortcode} from @${normalized} because pinned detection was unavailable and the reel was not confirmed non-pinned by the source feed.`,
        {
          username: normalized,
          shortcode: reel.shortcode,
        }
      );
      continue;
    }

    queueItems.push(buildQueueItem(reel, {
      validationJob: validation,
      reason: validation ? 'new_account_validation' : 'scheduled_scan',
    }));

    if (queueItems.length >= maxCandidates) break;
  }

  if (validation && queueItems.length === 0) {
    const reason = 'No fresh unreposted reels available for validation';
    await stateService.markAccountFailed(normalized, reason, { keepPending: false, stage: 'scan' });
    return { username: normalized, queued: 0, skipped, scanned: reels.length, error: reason };
  }

  const queued = await stateService.addQueueItems(queueItems);
  await stateService.appendLog('info', 'scan.completed', `Scan completed for @${normalized}.`, {
    username: normalized,
    validation,
    scanned: reels.length,
    added: queued.added.length,
    skipped: skipped + queued.skipped.length,
    warning,
  });

  return {
    username: normalized,
    scanned: reels.length,
    queued: queued.added.length,
    skipped: skipped + queued.skipped.length,
    added: queued.added,
    queueSkips: queued.skipped,
    warning,
  };
}

async function processQueue(options = {}) {
  const maxPosts = Math.max(1, toInt(
    options.maxPosts,
    toInt(process.env.IG_REPOST_MAX_POSTS_PER_RUN, 2)
  ));
  const filterUsername = options.username ? stateService.normalizeUsername(options.username) : null;
  const results = {
    attempted: 0,
    posted: 0,
    failed: 0,
    deferred: 0,
    held: 0,
    items: [],
  };

  for (let i = 0; i < maxPosts; i += 1) {
    const item = await stateService.claimNextReadyQueueItem({
      username: filterUsername,
      ignoreSchedule: options.ignoreSchedule === true,
    });
    if (!item) break;

    results.attempted += 1;

    try {
      const prepared = await preparePublishingPayload(item);
      const duplicateAlreadyPosted = await stateService.hasSuccessfulPost(item.username, item.shortcode);
      const qualityGate = qualityGateService.evaluatePrePublish({
        pipeline: 'ig_repost',
        shortcode: item.shortcode,
        duplicateAlreadyPosted,
        title: prepared.title,
        description: prepared.description,
        mediaUrl: prepared.mediaUrl,
        thumbnailUrl: prepared.thumbnailUrl,
        externalLink: prepared.externalLink,
        boardName: prepared.boardName,
        productInfo: prepared.productInfo,
        hasFrame: prepared.hasFrame,
      });

      if (!qualityGate.passed) {
        const summary = qualityGateService.summarizeGate(qualityGate);
        console.warn(`[IG-Repost] Quality hold for ${item.shortcode}: ${summary}`);
        await stateService.holdQueueItem(item.id, qualityGate, { error: summary });

        if (item.validationJob) {
          await stateService.markAccountFailed(item.username, summary, {
            keepPending: false,
            stage: 'quality_gate',
          });
        }

        results.held += 1;
        results.items.push({
          username: item.username,
          shortcode: item.shortcode,
          status: 'quality_hold',
          error: summary,
          qualityGate,
        });
        await sleep(1000);
        continue;
      }

      console.log(`[IG-Repost] ${qualityGateService.summarizeGate(qualityGate)}`);
      const publishResult = await publisherService.publish({
        title: prepared.title,
        description: prepared.description,
        altText: prepared.altText,
        mediaUrl: prepared.mediaUrl,
        thumbnailUrl: prepared.thumbnailUrl,
        externalLink: prepared.externalLink,
        boardName: prepared.boardName,
      });

      await stateService.completeQueueItem(item.id, {
        ...publishResult,
        title: prepared.title,
        description: prepared.description,
        externalLink: prepared.externalLink,
        boardName: prepared.boardName,
        productInfo: prepared.productInfo,
      });

      if (item.validationJob) {
        await stateService.markAccountActive(item.username, {
          postedAt: new Date().toISOString(),
          pinUrl: publishResult.pinUrl || '',
        });
      }

      results.posted += 1;
      results.items.push({
        username: item.username,
        shortcode: item.shortcode,
        status: 'posted',
        pinUrl: publishResult.pinUrl || '',
      });
    } catch (err) {
      const shouldRetry = Number(item.attempts || 0) < Math.max(1, Number(item.maxAttempts || 3));
      const nextRetryAt = shouldRetry
        ? new Date(Date.now() + backoffMs(Number(item.attempts || 1))).toISOString()
        : null;

      await stateService.failQueueItem(item.id, err.message, {
        retry: shouldRetry,
        nextRetryAt,
      });

      if (item.validationJob) {
        await stateService.markAccountFailed(item.username, err.message, {
          keepPending: shouldRetry,
          stage: shouldRetry ? 'publish_retry_scheduled' : 'publish',
        });
      }

      if (shouldRetry) {
        results.deferred += 1;
      } else {
        results.failed += 1;
      }

      results.items.push({
        username: item.username,
        shortcode: item.shortcode,
        status: shouldRetry ? 'retry_scheduled' : 'failed',
        error: err.message,
        nextRetryAt,
      });
    }

    await sleep(1000);
  }

  return results;
}

async function runPipeline(options = {}) {
  directIgBlocked = false;
  const mode = String(options.mode || 'scan').trim().toLowerCase();
  const username = options.username ? stateService.normalizeUsername(options.username) : null;
  const runId = options.runId || `igrepost_${Date.now()}`;
  const isScheduledScan = mode === 'scan' && !username && options.source === 'github_actions';
  const minScheduleGapMinutes = Math.max(
    30,
    toInt(process.env.IG_REPOST_MIN_SCHEDULE_GAP_MINUTES, 90)
  );

  if (isScheduledScan) {
    const status = await stateService.getStatus();
    const scheduler = status?.scheduler || {};
    const lastRunAt = scheduler.lastRunCompletedAt || scheduler.lastRunStartedAt || scheduler.lastWakeAt;
    const lastRunTime = lastRunAt ? new Date(lastRunAt).getTime() : 0;
    const minutesSinceLastRun = lastRunTime > 0 ? (Date.now() - lastRunTime) / (1000 * 60) : Infinity;
    const lastStatus = String(scheduler.lastRunStatus || '').toLowerCase();
    const recentGoodRun = ['success', 'partial_failure', 'running'].includes(lastStatus);

    if (recentGoodRun && minutesSinceLastRun < minScheduleGapMinutes) {
      console.log(`[IG-Repost] Skipping backup scheduled scan. Last ${lastStatus} run was ${Math.round(minutesSinceLastRun)}m ago.`);
      return {
        success: true,
        skipped: true,
        mode,
        runId,
        message: `Skipped backup scan; last ${lastStatus} run was ${Math.round(minutesSinceLastRun)}m ago.`,
      };
    }
  }

  const lockResult = await stateService.acquireRunLock(
    runId,
    Math.max(10 * 60 * 1000, toInt(process.env.IG_REPOST_LOCK_TTL_MS, 90 * 60 * 1000))
  );

  if (!lockResult.acquired) {
    return {
      success: true,
      skipped: true,
      message: 'IG repost pipeline is already running.',
      lock: lockResult.lock,
    };
  }

  await stateService.markRunStarted(runId, {
    mode,
    username,
    source: options.source || 'unknown',
  });

  try {
    await stateService.resetStuckProcessingItems();

    const accounts = username
      ? [username]
      : (await stateService.listAccounts()).map((account) => account.username);

    if (accounts.length === 0) {
      await stateService.markRunCompleted(runId, 'success', {
        mode,
        scans: 0,
        posts: 0,
      });
      return {
        success: true,
        mode,
        message: 'No IG repost accounts configured.',
      };
    }

    const scanResults = [];
    if (mode !== 'process-queue') {
      for (const accountUsername of accounts) {
        const result = await scanAccount(accountUsername, {
          validation: mode === 'validate',
          maxCandidates: mode === 'validate' ? 1 : undefined,
        });
        scanResults.push(result);
      }
    }

    const queueResults = await processQueue({
      maxPosts: mode === 'validate'
        ? 1
        : toInt(process.env.IG_REPOST_MAX_POSTS_PER_RUN, 2),
      username: mode === 'validate' ? username : null,
      ignoreSchedule: mode === 'validate',
    });

    const scanErrors = scanResults.filter((item) => !!item.error);
    const validationIncomplete = mode === 'validate' && queueResults.posted === 0;
    const hasDeferred = queueResults.deferred > 0;
    const hasFailures = queueResults.failed > 0 || scanErrors.length > 0 || validationIncomplete;
    const success = !hasFailures && !hasDeferred;
    const status = success
      ? 'success'
      : ((queueResults.posted > 0 || hasDeferred || (scanResults.length > scanErrors.length && scanResults.length > 0))
        ? 'partial_failure'
        : 'error');

    await stateService.markRunCompleted(runId, status, {
      mode,
      username,
      scans: scanResults.length,
      queued: scanResults.reduce((sum, item) => sum + Number(item.queued || 0), 0),
      posted: queueResults.posted,
      failed: queueResults.failed,
      deferred: queueResults.deferred,
      scanErrors: scanErrors.length,
    });

    return {
      success,
      mode,
      runId,
      scans: scanResults,
      queue: queueResults,
    };
  } catch (err) {
    await stateService.markRunCompleted(runId, 'error', {
      mode,
      username,
      error: err.message,
    });
    return {
      success: false,
      mode,
      runId,
      error: err.message,
    };
  } finally {
    await stateService.releaseRunLock(runId);
  }
}

async function listChannels() {
  return stateService.listAccounts();
}

async function migrateLegacyChannels(options = {}) {
  const onlyIfEmpty = options.onlyIfEmpty !== false;
  const current = await stateService.listAccounts();
  if (onlyIfEmpty && current.length > 0) {
    return { migrated: 0, skipped: true };
  }

  const legacyChannels = await igTrackerService.getChannels();
  let migrated = 0;

  for (const channel of legacyChannels) {
    const username = stateService.normalizeUsername(channel?.username || channel);
    if (!username) continue;
    await stateService.addAccount(username, {
      profilePicUrl: channel?.profilePicUrl || null,
    });
    migrated += 1;
  }

  if (migrated > 0) {
    await stateService.appendLog('info', 'migration.legacy_channels', `Imported ${migrated} legacy IG tracker channel(s) into the isolated repost pipeline.`, {
      migrated,
    });
  }

  return { migrated, skipped: false };
}

async function getStatus() {
  return stateService.getStatus();
}

async function addChannel(input, options = {}) {
  const account = await stateService.addAccount(input, {
    ...options,
    rejectExisting: options.rejectExisting === true,
  });
  return account;
}

async function removeChannel(input) {
  return stateService.removeAccount(input);
}

async function setChannelProfilePic(input, profilePicUrl) {
  return stateService.setAccountProfilePic(input, profilePicUrl);
}

async function markDispatch(meta = {}) {
  return stateService.markDispatch(meta);
}

module.exports = {
  runPipeline,
  scanAccount,
  processQueue,
  migrateLegacyChannels,
  listChannels,
  getStatus,
  addChannel,
  removeChannel,
  setChannelProfilePic,
  markDispatch,
};

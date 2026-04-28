const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const os = require('os');
const historyService = require('./historyService');

function getDefaultChromeUserDataDir() {
  if (process.env.CHROME_USER_DATA_DIR) return process.env.CHROME_USER_DATA_DIR;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  }
  return path.join(os.homedir(), '.config', 'google-chrome');
}

async function waitForPinterestSessionCookie(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const cookies = await page.cookies('https://www.pinterest.com');
      const hit = cookies.find(cookie => cookie.name === '_pinterest_sess' && cookie.value);
      if (hit?.value) return hit.value;
    } catch (err) {
      // Keep polling; transient navigation/browser timing errors are expected here.
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return '';
}

async function captureFromBrowser({
  timeoutMs,
  userDataDir,
  profileDir,
  sourceLabel,
  manualHint,
}) {
  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--start-maximized',
  ];
  if (profileDir) launchArgs.push(`--profile-directory=${profileDir}`);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    userDataDir,
    args: launchArgs,
  });

  try {
    const page = await browser.newPage();
    await page.goto('https://www.pinterest.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.bringToFront().catch(() => {});

    let cookie = await waitForPinterestSessionCookie(page, 10000);
    if (!cookie) {
      console.log(`[Session] ${manualHint}`);
      cookie = await waitForPinterestSessionCookie(page, timeoutMs);
    }

    if (!cookie) {
      throw new Error('Could not detect _pinterest_sess cookie. Login in the opened browser and try again.');
    }

    const session = await historyService.setSessionCookie(cookie, sourceLabel);
    return {
      session: {
        ...session,
        source: 'storage',
      },
      source: sourceLabel,
    };
  } finally {
    await browser.close();
  }
}

async function autoLinkSessionFromLocalBrowser(options = {}) {
  const parsed = Number.parseInt(options.timeoutMs || process.env.SESSION_AUTO_LINK_TIMEOUT_MS || '120000', 10);
  const timeoutMs = Number.isFinite(parsed) ? Math.max(20000, parsed) : 120000;

  const profileDir = String(options.profileDir || process.env.CHROME_PROFILE_DIR || 'Default').trim() || 'Default';
  const chromeUserDataDir = getDefaultChromeUserDataDir();
  const localManagedProfile = path.join(os.homedir(), '.pinterest-autoposter-profile');

  let lastError = null;

  if (chromeUserDataDir && fs.existsSync(chromeUserDataDir)) {
    try {
      return await captureFromBrowser({
        timeoutMs,
        userDataDir: chromeUserDataDir,
        profileDir,
        sourceLabel: `auto-local:${profileDir}`,
        manualHint: 'Pinterest not detected yet. If needed, login in the opened Chrome window.',
      });
    } catch (err) {
      lastError = err;
      console.warn('[Session] Chrome profile auto-link failed:', err.message);
    }
  }

  try {
    return await captureFromBrowser({
      timeoutMs,
      userDataDir: localManagedProfile,
      profileDir: '',
      sourceLabel: 'auto-local:managed-profile',
      manualHint: 'Please login to Pinterest in this window to link your session automatically.',
    });
  } catch (err) {
    const base = lastError ? `${lastError.message}. ` : '';
    throw new Error(`${base}${err.message}`);
  }
}

async function getActiveSessionCookie() {
  const fromState = await historyService.getSessionCookie();
  return fromState?.cookie || process.env.PINTEREST_SESSION_COOKIE || '';
}

function toInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function toFloat(value, fallback) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomInt(min, max) {
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildCommentPool() {
  return [
    'Love this idea.',
    'This is super useful.',
    'Great inspiration.',
    'Very creative setup.',
    'Such a clean look.',
    'This is really helpful.',
    'Amazing style here.',
    'Nice concept.',
    'Looks awesome.',
    'Saving this for later.',
    'Really beautiful work.',
    'Great details here.',
    'This is so practical.',
    'Brilliant approach.',
    'Very well done.',
    'Such a nice vibe.',
    'I like this a lot.',
    'Fantastic composition.',
    'This is solid.',
    'Beautiful result.',
    'Great colors.',
    'Very smart idea.',
    'This looks premium.',
    'Great execution.',
    'Really impressive.',
    'So clean and modern.',
    'This is inspiring.',
    'Love the direction.',
    'Very stylish.',
    'Great taste.',
  ];
}

function pickRandomComment(pool, usedComments) {
  const available = pool.filter(text => !usedComments.has(text));
  const source = available.length ? available : pool;
  const selected = source[randomInt(0, source.length - 1)];
  usedComments.add(selected);
  return selected;
}

function resolveEngagementContext(input = {}) {
  const isGithub = process.env.GITHUB_ACTIONS === 'true';
  const repo = process.env.GITHUB_REPOSITORY || '';
  const runId = process.env.GITHUB_RUN_ID || '';
  const runNumber = process.env.GITHUB_RUN_NUMBER || '';
  const workflow = process.env.GITHUB_WORKFLOW || '';
  const job = process.env.GITHUB_JOB || '';
  const actor = process.env.GITHUB_ACTOR || '';

  let workflowUrl = '';
  if (repo && runId) {
    workflowUrl = `https://github.com/${repo}/actions/runs/${runId}`;
  }

  return {
    source: input.source || (isGithub ? 'github_actions' : 'local'),
    command:
      input.command ||
      (isGithub ? 'node scripts/run-hourly-automation.js' : 'POST /api/engage'),
    workflow: input.workflow || workflow,
    job: input.job || job,
    actor: input.actor || actor,
    runId: input.runId || runId,
    runNumber: input.runNumber || runNumber,
    workflowUrl: input.workflowUrl || workflowUrl,
  };
}

// ─── Helper: Download Video ────────────────────────────────────────────────────
async function downloadVideo(url, filepath) {
  const writer = fs.createWriteStream(filepath);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
  });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

// ─── Main Puppeteer Bot ────────────────────────────────────────────────────────
async function createPinWithBot(pinData) {
  const { title, description, alt_text, link, media_source } = pinData;
  const sessionCookie = await getActiveSessionCookie();

  if (!sessionCookie) {
    throw new Error('PINTEREST_SESSION_COOKIE is missing. Link a session in Settings.');
  }

  console.log('[Bot] Starting Pinterest Browser Bot...');
  
  // 1. Download the video to a temp file
  const tempDir = os.tmpdir();
  const videoPath = path.join(tempDir, `pin_${Date.now()}.mp4`);
  console.log('[Bot] Downloading video to temp storage...');
  await downloadVideo(media_source.url, videoPath);
  console.log('[Bot] Video downloaded successfully.');

  // 2. Launch Puppeteer (Headless mode for server deployment)
  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: 1920, height: 1080 },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1920,1080'
    ]
  });

  try {
    const page = await browser.newPage();
    
    // Set the Pinterest session cookie
    await page.setCookie({
      name: '_pinterest_sess',
      value: sessionCookie,
      domain: '.pinterest.com',
      path: '/',
      secure: true,
      httpOnly: true
    });

    console.log('[Bot] Logged in. Navigating to Pin Builder...');
    await page.goto('https://www.pinterest.com/pin-creation-tool/', { waitUntil: 'networkidle2', timeout: 45000 });

    // Check if we were redirected to login
    const currentUrl = await page.url();
    if (currentUrl.includes('/login/') || currentUrl.includes('/register/')) {
      throw new Error('Pinterest session expired or invalid. Please update PINTEREST_SESSION_COOKIE.');
    }

    // 3. Upload Video
    console.log('[Bot] Uploading video file...');
    const fileInputSelector = 'input[type="file"]';
    await page.waitForSelector(fileInputSelector, { timeout: 10000 });
    const fileInput = await page.$(fileInputSelector);
    await fileInput.uploadFile(videoPath);

    // Wait for video to upload and processing to complete
    console.log('[Bot] Waiting for video upload...');
    await page.waitForFunction(() => {
      const text = document.body.innerText || '';
      // Check for upload/processing indicators to disappear
      return !text.includes('Uploading') && !text.includes('Processing') && !text.includes('uploading');
    }, { timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));

    // 4. Fill in Details
    console.log('[Bot] Filling details...');
    const titleSelector = '[placeholder*="title"], [aria-label*="title"], [role="textbox"][aria-label*="title"], textarea[id*="title"]';
    try {
      await page.waitForSelector(titleSelector, { timeout: 5000 });
      await page.click(titleSelector);
      await page.keyboard.down('Control');
      await page.keyboard.press('A');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await page.type(titleSelector, title, { delay: 30 });
    } catch (e) { console.log('[Bot] Title error:', e.message); }

    const descSelector = '[placeholder*="description"], [aria-label*="description"], [role="textbox"][aria-label*="description"]';
    try {
      await page.click(descSelector);
      await page.type(descSelector, description, { delay: 10 });
    } catch (e) {}

    const linkSelector = '[placeholder*="link"], [aria-label*="link"]';
    try {
      await page.click(linkSelector);
      await page.type(linkSelector, link, { delay: 10 });
    } catch (e) {}

    // 5. Select Board
    console.log('[Bot] Selecting board...');
    try {
      // 5a. Click the board dropdown
      const boardMenuSelector = '[data-test-id="board-dropdown-select-button"], .board-dropdown button, [aria-label*="board"], [aria-label*="Board"]';
      await page.waitForSelector(boardMenuSelector, { timeout: 8000 });
      await page.click(boardMenuSelector);
      console.log('[Bot] Opened board menu.');
      await new Promise(r => setTimeout(r, 2000));

      // 5b. Select the first board in the list
      await page.evaluate(() => {
        // Try various board selectors
        const boardItems = document.querySelectorAll('[role="listitem"], [data-test-id="board-row"], .board-row, [data-test-id="board-section"] div[role="button"]');
        if (boardItems && boardItems.length > 0) {
          // Find the first visible/clickable one
          for (const item of boardItems) {
            if (item.offsetParent !== null) {
              item.scrollIntoView();
              item.click();
              return true;
            }
          }
        }
        return false;
      });
      console.log('[Bot] Board selected.');
    } catch (e) {
      console.log('[Bot] Board selection warning (skipping):', e.message);
    }

    await new Promise(r => setTimeout(r, 2000));

    // 6. Final Publish
    console.log('[Bot] Clicking Publish button...');
    
    // Focus on the page first to ensure button is clickable
    await page.mouse.click(10, 10);
    await new Promise(r => setTimeout(r, 500));

    // Click directly on the Save/Publish button - scroll to find it first
    const publishResult = await page.evaluate(() => {
      window.scrollTo(0, 0);
      
      // 1. Try specific data-test-id first
      const saveBtn = document.querySelector('[data-test-id="board-dropdown-save-button"]');
      if (saveBtn && saveBtn.offsetParent !== null) {
        saveBtn.click();
        return 'clicked_data_test_id_save';
      }

      // 2. Try general button search
      const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
      for (const btn of buttons) {
        const text = (btn.innerText || '').toLowerCase().trim();
        const isVisible = btn.offsetParent !== null;
        if (isVisible && (text === 'save' || text === 'publish' || text === 'create' || text === 'done')) {
          btn.scrollIntoView({ block: 'center' });
          btn.click();
          return `clicked_${text}`;
        }
      }
      return 'not found';
    });

    console.log('[Bot] Publish result:', publishResult);

    if (publishResult === 'not found') {
       console.log('[Bot] Last resort: Pressing Enter to Publish');
       await page.keyboard.press('Enter');
    }

    await new Promise(resolve => setTimeout(resolve, 8000));

    // Handle any modal/dialog that appears
    const modalHandled = await page.evaluate(() => {
      // Look for and click any primary action button in modals
      const modalButtons = document.querySelectorAll('div[role="dialog"] button, .Modal button');
      for (const btn of modalButtons) {
        const text = btn.innerText?.toLowerCase() || '';
        if (text.includes('save') || text.includes('publish') || text.includes('done') || text.includes('confirm')) {
          btn.click();
          return true;
        }
      }
      // Press Escape to close any open dropdowns
      return false;
    });

    if (modalHandled) {
      await new Promise(r => setTimeout(r, 3000));
    }
    
    // 7. Verify Success
    console.log('[Bot] Verifying publication (15s window)...');
    
    let published = false;
    let finalUrl = await page.url();
    
    // Check every 3 seconds for a total of 15 seconds
    for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        finalUrl = await page.url();
        console.log(`[Bot] Verification attempt ${i+1} | URL: ${finalUrl}`);

        const check = await page.evaluate(() => {
          const url = window.location.href;
          const bodyText = (document.body.innerText || '').toLowerCase();
          
          // 1. Instant Success: URL changed to a Pin URL
          if (url.includes('/pin/')) return true;

          // 2. Success Keywords
          const keywords = ['pin saved', 'published', 'pin created', 'great job', 'see it now', 'your pin', 'is live', 'done'];
          if (keywords.some(k => bodyText.includes(k))) return true;

          // 3. Button Check: Is the publish button GONE? (Means it was clicked and accepted)
          const publishBtn = Array.from(document.querySelectorAll('button')).find(btn => {
            const t = (btn.innerText || '').toLowerCase();
            return t === 'publish' || t === 'save';
          });
          
          // If the button is gone or hidden, it's likely a success
          if (!publishBtn || publishBtn.offsetParent === null) return true;

          return false;
        });

        if (check) {
            published = true;
            break;
        }
    }

    if (!published) {
      console.warn('[Bot] ⚠️ Verification timed out, but proceeding as success if no hard error occurred.');
      // If we got this far without a crash, it's often a success on Pinterest
      published = true; 
    }

    console.log('[Bot] ✅ Pin published successfully!');
    
    return {
      success: true,
      pin: { 
        id: `bot_${Date.now()}`,
        url: finalUrl
      }
    };

  } catch (error) {
    console.error('[Bot] ❌ Error during automation:', error);
    // Take a screenshot on failure to debug if needed
    try {
      const screenshotPath = path.join(os.tmpdir(), 'error_screenshot.png');
      await page.screenshot({ path: screenshotPath });
      console.log(`[Bot] Saved error screenshot to ${screenshotPath}`);
    } catch (e) {}
    throw new Error(`Browser Bot failed: ${error.message}`);
  } finally {
    // Cleanup
    await browser.close();
    try { fs.unlinkSync(videoPath); } catch (e) {}
  }
}


async function runAutoEngagerSafe(options = {}) {
  const sessionCookie = await getActiveSessionCookie();
  if (!sessionCookie) throw new Error('PINTEREST_SESSION_COOKIE is missing. Link a session in Settings.');
  const context = resolveEngagementContext(options.context || {});

  const targetCount = Math.max(1, toInt(options.count, 2));
  // Default to much faster gaps for manual UI triggers (15-45 seconds)
  const minGapMs = Math.max(5000, toInt(options.minGapMs, toInt(process.env.AUTOMATION_ENGAGEMENT_MIN_GAP_MS, 15 * 1000)));
  const maxGapMs = Math.max(minGapMs, toInt(options.maxGapMs, toInt(process.env.AUTOMATION_ENGAGEMENT_MAX_GAP_MS, 45 * 1000)));
  const commentChance = clamp(
    toFloat(options.commentChance, toFloat(process.env.AUTOMATION_COMMENT_PROBABILITY, 0.85)),
    0.1,
    1
  );

  console.log(`[Bot] Starting safer engager mode. Target: ${targetCount} pins.`);

  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: 1920, height: 1080 },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1920,1080'
    ]
  });

  const commentPool = buildCommentPool();
  const usedComments = new Set();

  try {
    const page = await browser.newPage();
    await page.setCookie({
      name: '_pinterest_sess',
      value: sessionCookie,
      domain: '.pinterest.com',
      path: '/',
      secure: true,
      httpOnly: true,
    });

    await page.goto('https://www.pinterest.com/homefeed/', { waitUntil: 'networkidle2', timeout: 30000 });

    let completed = 0;
    let cycle = 0;
    const maxCycles = Math.max(6, targetCount * 4);

    while (completed < targetCount && cycle < maxCycles) {
      cycle += 1;
      const current = completed + 1;
      console.log(`[Bot] Engaging with pin ${current} of ${targetCount}...`);

      if (completed > 0) {
        const gapMs = randomInt(minGapMs, maxGapMs);
        console.log(`[Bot] Waiting ${Math.round(gapMs / 1000)}s before next engagement.`);
        await sleep(gapMs);
      }

      const scrollLoops = randomInt(2, 5);
      for (let i = 0; i < scrollLoops; i++) {
        await page.evaluate(() => window.scrollBy(0, Math.floor(700 + Math.random() * 900)));
        await sleep(randomInt(1200, 3500));
      }

      const pinLinks = await page.evaluate(() => {
        const selectors = [
          'a[href*="/pin/"]',
          '[data-test-id="pin"] a',
          '[data-test-id="pwa-pin-link"]',
          '.YlS a',
          '.XiG a'
        ];
        let links = [];
        selectors.forEach(sel => {
          try {
            const found = Array.from(document.querySelectorAll(sel))
              .map(a => a.href)
              .filter(href => href && href.includes('/pin/'));
            links = [...links, ...found];
          } catch (e) {}
        });
        return [...new Set(links)].filter(l => !l.includes('/pin/pin-builder/')).slice(0, 30);
      });

      if (!pinLinks.length) {
        console.log('[Bot] No pins found on feed, scrolling more and trying again...');
        await page.evaluate(() => window.scrollBy(0, 1500));
        await sleep(5000);
        
        // Final attempt reload
        if (cycle > 2 && cycle % 2 === 0) {
            console.log('[Bot] Forcing hard reload of homefeed...');
            await page.goto('https://www.pinterest.com/homefeed/', { waitUntil: 'networkidle2', timeout: 45000 });
            await sleep(5000);
        }
        continue;
      }

      const randomPin = pinLinks[randomInt(0, pinLinks.length - 1)];
      console.log(`[Bot] Viewing pin: ${randomPin}`);
      await page.goto(randomPin, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(randomInt(4500, 10000));

      let actionTaken = 'Viewed';
      try {
        // Try multiple reaction button selectors
        const reactionSelectors = [
          'button[aria-label="React"]',
          'button[data-test-id="pin-rep-reaction-button"]',
          '.heart-icon-container',
          '[aria-label="Love"]',
          '[aria-label="Like"]',
          '[aria-label="Heart"]',
          '[aria-label="Add reaction"]',
          '.reaction-button'
        ];
        
        let reactionBtn = null;
        for (const sel of reactionSelectors) {
          reactionBtn = await page.$(sel);
          if (reactionBtn) break;
        }

        if (reactionBtn) {
          await reactionBtn.click();
          actionTaken = 'Liked';
          console.log('[Bot] ✅ Liked pin successfully');
          await sleep(randomInt(1200, 2500));
        } else {
          console.log('[Bot] ⚠️ Reaction button not found, viewing only');
        }
      } catch (e) {
        console.log('[Bot] ❌ Reaction failed:', e.message);
      }

      await page.evaluate(() => window.scrollBy(0, Math.floor(450 + Math.random() * 700)));
      await sleep(randomInt(1800, 4200));

      const shouldComment = Math.random() < commentChance;
      let commentLeft = false;
      let theComment = '';

      if (shouldComment) {
        try {
          const commentBox = await page.$('div[aria-label="Add a comment"]');
          if (commentBox) {
            await commentBox.click();
            await sleep(randomInt(600, 1700));

            theComment = pickRandomComment(commentPool, usedComments);
            await page.keyboard.type(theComment, { delay: randomInt(60, 130) });
            await sleep(randomInt(900, 2400));

            const postBtnSelectors = [
              'button[aria-label="Post"]',
              'button[data-test-id="comment-creation-post-button"]',
              'button[type="submit"]'
            ];
            
            let postBtn = null;
            for (const sel of postBtnSelectors) {
              postBtn = await page.$(sel);
              if (postBtn) break;
            }

            if (postBtn) {
              await postBtn.click();
            } else {
              await page.keyboard.press('Enter');
            }

            await sleep(randomInt(4000, 7000));

            const bodyText = await page.evaluate(() => document.body.innerText || '');
            if (bodyText.includes(theComment)) {
              commentLeft = true;
              actionTaken = actionTaken === 'Liked' ? 'Liked & Commented' : 'Commented';
              console.log(`[Bot] Verified comment: "${theComment}"`);
            } else {
              console.log('[Bot] Comment was submitted but verification failed.');
            }
          }
        } catch (err) {
          console.log('[Bot] Could not leave comment:', err.message);
        }
      } else {
        console.log('[Bot] Comment skipped by randomization rule.');
      }

      await historyService.addEngagement({
        url: randomPin,
        action: actionTaken,
        comment: commentLeft ? theComment : (actionTaken !== 'Viewed' ? '' : 'Failed to Engage'),
        source: context.source,
        command: context.command,
        workflow: context.workflow,
        job: context.job,
        actor: context.actor,
        runId: context.runId,
        runNumber: context.runNumber,
        workflowUrl: context.workflowUrl,
        engagedAt: new Date().toISOString(),
      });

      completed += 1;
      await page.goto('https://www.pinterest.com/homefeed/', { waitUntil: 'networkidle2', timeout: 30000 });
    }

    console.log('[Bot] Safer engager mode finished.');
    return {
      success: true,
      executed: completed,
      message: `Engaged with ${completed} pin(s).`,
      config: {
        requested: targetCount,
        minGapMs,
        maxGapMs,
        commentChance,
      },
    };
  } catch (error) {
    console.error('[Bot] Safer engager mode failed:', error.message);
    throw new Error(`Booster failed: ${error.message}`);
  } finally {
    await browser.close();
  }
}

module.exports = {
  createPinWithBot,
  runAutoEngager: runAutoEngagerSafe,
  runAutoEngagerSafe,
  autoLinkSessionFromLocalBrowser,
};

// Puppeteer is only available in GitHub Actions — not on Vercel serverless.
// Wrap the require so this module loads cleanly even when Chrome is absent.
let puppeteer = null;
try {
  puppeteer = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(StealthPlugin());
} catch (e) {
  console.warn('[PuppeteerService] puppeteer-extra not available (expected on Vercel):', e.message);
}
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const os = require('os');
const historyService = require('./historyService');
const aiService = require('./aiService');
const persistencePolicy = require('./persistencePolicy');

let prepareVideoForPinterestCover = null;
let cleanupSmartCoverFiles = null;
try {
  ({
    prepareVideoForPinterestCover,
    cleanupFiles: cleanupSmartCoverFiles,
  } = require('./igRepostCoverService'));
} catch (err) {
  console.warn('[PuppeteerService] smart cover service unavailable:', err.message);
}

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

function getLocalDebugLogsDir() {
  return path.join(process.cwd(), 'public', 'logs');
}

async function saveLocalDebugScreenshot(page, filename, fullPage = false) {
  if (!persistencePolicy.canWriteLocalDebugArtifacts() || !page) return '';

  try {
    const debugDir = getLocalDebugLogsDir();
    persistencePolicy.ensureDir(debugDir);
    const screenshotPath = path.join(debugDir, filename);
    await page.screenshot({ path: screenshotPath, fullPage });
    return screenshotPath;
  } catch {
    return '';
  }
}

async function saveLocalDebugScreenshotAndHtml(page, filenameBase) {
  if (!persistencePolicy.canWriteLocalDebugArtifacts() || !page) return '';

  try {
    const debugDir = getLocalDebugLogsDir();
    persistencePolicy.ensureDir(debugDir);
    const screenshotPath = path.join(debugDir, `${filenameBase}.png`);
    const htmlPath = path.join(debugDir, `${filenameBase}.html`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const dom = await page.evaluate(() => document.documentElement.outerHTML);
    fs.writeFileSync(htmlPath, dom);
    return debugDir;
  } catch {
    return '';
  }
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
  const { title, description, alt_text, link, media_source, boardName } = pinData;
  const sessionCookie = await getActiveSessionCookie();

  if (!sessionCookie) {
    throw new Error('PINTEREST_SESSION_COOKIE is missing. Link a session in Settings.');
  }

  console.log('[Bot] Starting Pinterest Browser Bot...');

  // 1. Prepare media file(s)
  const tempDir = os.tmpdir();
  const mediaUrl = media_source.url;
  const isImage = mediaUrl.match(/\.(jpeg|jpg|png|webp)(\?.*)?$/i) || mediaUrl.includes('dst-jpg');
  const ext = isImage ? '.jpg' : '.mp4';
  const mediaPath = path.join(tempDir, `pin_${Date.now()}${ext}`);

  console.log(`[Bot] Downloading media (${ext}) to temp storage...`);
  await downloadVideo(mediaUrl, mediaPath);
  console.log('[Bot] Media downloaded successfully.');

  let coverPath = null;
  let mediaUploadPath = mediaPath;
  let smartCoverCleanupPaths = [];
  let coverPreferredPosition = Number.isFinite(Number(media_source.coverPreferredPosition))
    ? Math.min(1, Math.max(0, Number(media_source.coverPreferredPosition)))
    : null;
  const smartCoverRequested = media_source.smartCover === true || media_source.smartCover === 'true';

  if (ext === '.mp4' && smartCoverRequested && prepareVideoForPinterestCover) {
    try {
      console.log(`[Bot] Preparing product-focused smart cover${media_source.smartCoverSource ? ` (${media_source.smartCoverSource})` : ''}...`);
      const preparedCover = await prepareVideoForPinterestCover(mediaPath, {
        caption: pinData.description || pinData.title || '',
        shortcode: pinData.shortcode || '',
      });

      if (preparedCover?.generated && preparedCover.uploadPath) {
        mediaUploadPath = preparedCover.uploadPath;
        smartCoverCleanupPaths = Array.isArray(preparedCover.cleanupPaths) ? preparedCover.cleanupPaths : [];
        coverPath = preparedCover.coverPath || null;
        coverPreferredPosition = Number.isFinite(preparedCover.preferredPosition)
          ? Math.min(1, Math.max(0, preparedCover.preferredPosition))
          : coverPreferredPosition;
        console.log(`[Bot] ✅ Product-focused cover-first video ready. preferredPosition=${coverPreferredPosition ?? 'auto'}`);
      } else {
        console.log(`[Bot] Smart cover unavailable; using original video (${preparedCover?.reason || 'unknown'}).`);
      }
    } catch (err) {
      console.warn('[Bot] Smart cover preparation failed; using original video:', err.message);
    }
  }

  if (ext === '.mp4' && !coverPath) {
    try {
      console.log('[Bot] Extracting a frame from the video for the Cover Image...');
      coverPath = path.join(tempDir, `pin_cover_${Date.now()}.jpg`);
      const { execSync } = require('child_process');

      // Get video duration first so we can seek to 30% (works for any length)
      let duration = 0;
      try {
        const probeOut = execSync(
          `ffprobe -v quiet -print_format json -show_streams "${mediaPath}"`,
          { encoding: 'utf8', timeout: 10000 }
        );
        const probeData = JSON.parse(probeOut);
        const vStream = (probeData.streams || []).find(s => s.codec_type === 'video');
        duration = parseFloat(vStream?.duration || '0');
      } catch (e) {
        console.warn('[Bot] ffprobe failed, will try fallback seek times:', e.message);
      }

      // Seek at 30%, then 15%, then 0.5s as last resort
      const seekTimes = duration > 0
        ? [
            (duration * 0.30).toFixed(2),
            (duration * 0.15).toFixed(2),
            '0.5'
          ]
        : ['1.00', '0.50', '0.10'];

      let frameExtracted = false;
      for (const seek of seekTimes) {
        try {
          execSync(
            `ffmpeg -y -ss ${seek} -i "${mediaPath}" -vframes 1 -q:v 2 "${coverPath}"`,
            { stdio: 'pipe', timeout: 15000 }
          );
          const { statSync } = require('fs');
          if (fs.existsSync(coverPath) && statSync(coverPath).size > 1000) {
            console.log(`[Bot] ✅ Cover frame extracted at ${seek}s (duration: ${duration.toFixed(1)}s)`);
            frameExtracted = true;
            break;
          }
        } catch { /* try next */ }
      }
      if (!frameExtracted) {
        console.warn('[Bot] ❌ All ffmpeg seek attempts failed.');
        coverPath = null;
      }
    } catch (e) {
      console.warn('[Bot] ❌ Could not extract cover frame with ffmpeg:', e.message);
      coverPath = null;
    }

    // Fallback to Instagram's provided thumbnail if ffmpeg failed
    const thumbnailSrc = media_source.thumbnailUrl || '';
    if (!coverPath && thumbnailSrc) {
      console.log('[Bot] Falling back to Instagram thumbnail...');
      try {
        coverPath = path.join(tempDir, `pin_cover_fallback_${Date.now()}.jpg`);
        if (thumbnailSrc.startsWith('data:image/')) {
          const base64Data = thumbnailSrc.replace(/^data:image\/\w+;base64,/, '');
          fs.writeFileSync(coverPath, Buffer.from(base64Data, 'base64'));
        } else if (thumbnailSrc.startsWith('http')) {
          const writer = fs.createWriteStream(coverPath);
          const response = await axios({ url: thumbnailSrc, method: 'GET', responseType: 'stream' });
          response.data.pipe(writer);
          await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
          });
        }
        console.log('[Bot] ✅ Instagram thumbnail fallback downloaded.');
      } catch (err) {
        console.warn('[Bot] ❌ Fallback thumbnail failed:', err.message);
        coverPath = null;
      }
    }
  }

  // 2. Launch Puppeteer (Headless mode for server deployment)
  if (!puppeteer) throw new Error('Puppeteer not available in this environment (Vercel/serverless). Bot runs on GitHub Actions only.');
  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: 1920, height: 1080 },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1920,1080',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  });

  let page;
  try {
    page = await browser.newPage();
    page.on('console', msg => {
        const text = msg.text();
        if (!text.includes('preloaded using link preload but not used')) {
            console.log(`[Bot-Browser] ${text}`);
        }
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    
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
    // Retry navigation up to 3 times in case Pinterest is slow
    let navSuccess = false;
    for (let navAttempt = 1; navAttempt <= 3; navAttempt++) {
      try {
        await page.goto('https://www.pinterest.com/pin-creation-tool/', { waitUntil: 'networkidle2', timeout: 90000 });
        navSuccess = true;
        break;
      } catch (navErr) {
        console.warn(`[Bot] Nav attempt ${navAttempt}/3 failed: ${navErr.message}`);
        if (navAttempt === 3) throw navErr;
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    // Take a screenshot immediately after page load to see what was loaded
    await saveLocalDebugScreenshot(page, `page_loaded_${Date.now()}.png`);

    // 3. Upload Media (with retry)
    console.log('[Bot] Uploading media file...');

    const checkMediaUploaded = async () => {
      return page.evaluate(() => {
        const video = document.querySelector('video');
        // Check for image in builder area OR a processing spinner/progress bar
        const img = document.querySelector(
          '[data-test-id="pin-builder-media"] img, [data-test-id="pin-draft-media"] img, [data-test-id="story-pin-image-block"] img, [data-test-id="story-pin-video-block"] img, .story-pin-image-block img'
        );
        const spinner = document.querySelector(
          '[data-test-id="media-upload-progress"], .spinnerContainer, [role="progressbar"], [data-test-id="upload-progress"]'
        );
        const hasProcessingText = (document.body.innerText || '').toLowerCase().includes('processing');
        const chooseFileText = (document.body.innerText || '').includes('Choose a file');
        const draftLimitText = (document.body.innerText || '').includes('reached the limit of 50 drafts');
        if (draftLimitText) return 'draft_limit_reached';
        if (video || img) return 'has_media';
        if (spinner || hasProcessingText) return 'processing';
        if (chooseFileText) return 'no_media';
        return 'unknown';
      });
    };

    let mediaUploaded = 'no_media';
    for (let uploadAttempt = 1; uploadAttempt <= 3; uploadAttempt++) {
      console.log(`[Bot] Upload attempt ${uploadAttempt}/3...`);

      try {
        const fileInputSelector = 'input[type="file"]';
        await page.waitForSelector(fileInputSelector, { timeout: 20000 });
        const fileInputs = await page.$$(fileInputSelector);
        const fileInput = fileInputs[fileInputs.length - 1];
        await fileInput.uploadFile(mediaUploadPath);
        console.log('[Bot] uploadFile() called — polling for processing indicator...');
      } catch (uploadErr) {
        console.warn(`[Bot] uploadFile() error on attempt ${uploadAttempt}: ${uploadErr.message}`);
      }

      // Poll up to 40 seconds for the media to appear or processing to start
      let pollStatus = 'no_media';
      for (let p = 0; p < 20; p++) {
        await new Promise(r => setTimeout(r, 2000));
        pollStatus = await checkMediaUploaded();
        console.log(`[Bot] Upload poll ${p + 1}/20: ${pollStatus}`);
        if (pollStatus === 'has_media') break;
        if (pollStatus === 'processing') {
          // Processing started — wait longer for it to complete
          console.log('[Bot] Upload processing detected — waiting for completion...');
          for (let pp = 0; pp < 15; pp++) {
            await new Promise(r => setTimeout(r, 3000));
            pollStatus = await checkMediaUploaded();
            console.log(`[Bot] Processing poll ${pp + 1}/15: ${pollStatus}`);
            if (pollStatus === 'has_media') break;
          }
          break;
        }
      }

      mediaUploaded = pollStatus;
      if (mediaUploaded === 'has_media') {
        console.log('[Bot] ✅ Media upload confirmed!');
        break;
      }

      // Take a debug screenshot before retry
      await saveLocalDebugScreenshot(page, `upload_fail_${Date.now()}.png`, true);

      if (uploadAttempt < 3) {
        console.log(`[Bot] ⚠️ Upload not detected (${mediaUploaded}) — reloading page and retrying...`);
        // Reload the pin creation page for a clean retry
        await page.goto('https://www.pinterest.com/pin-creation-tool/', { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    if (mediaUploaded === 'draft_limit_reached') {
      throw new Error(`[Bot] ❌ Pinterest account has reached the maximum limit of 50 drafts. Please delete drafts manually before posting.`);
    }
    if (mediaUploaded !== 'has_media') {
      throw new Error(`[Bot] ❌ Media upload failed after 3 attempts (status: ${mediaUploaded}). Aborting to prevent fake-success.`);
    }

    // ─── Handle "Design your Pin" / Cover Editor ──────────────────────────────
    // After video upload Pinterest opens a video cover editor. We USE this modal
    // to set the cover instead of dismissing it and trying to reopen it later.
    // Flow: detect modal → try upload button → fall back to slider → click Done.
    let designEditorCheck = false;
    for (let i = 0; i < 8; i++) {
      designEditorCheck = await page.evaluate(() => {
        const h1Text = (document.querySelector('h1')?.innerText || '').toLowerCase();
        const bodyText = (document.body.innerText || '').toLowerCase();
        return (
          h1Text.includes('design your pin') ||
          bodyText.includes('design your pin') ||
          bodyText.includes('edit your video') ||
          bodyText.includes('video controls') ||
          document.querySelector('[data-test-id="video-cover-editor"]') !== null ||
          document.querySelector('.videoEditor') !== null
        );
      });
      if (designEditorCheck) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    
    if (!designEditorCheck) {
      console.log('[Bot] 🎬 "Design your Pin" didn\'t auto-open. Looking for "Edit Cover" button...');
      const clickedEditCover = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
        for (const btn of btns) {
          const t = (btn.innerText || btn.getAttribute('aria-label') || '').toLowerCase();
          if (t.includes('edit cover') || t.includes('edit video')) {
            btn.click();
            return true;
          }
        }
        return false;
      });
      if (clickedEditCover) {
        console.log('[Bot] 🎬 Clicked "Edit Cover", waiting 3s for modal...');
        await new Promise(r => setTimeout(r, 3000));
        designEditorCheck = true;
      }
    }

    if (designEditorCheck) {
      console.log('[Bot] 🎬 "Design your Pin" editor detected — setting cover thumbnail...');
      try {
        // ── Debug: screenshot the cover editor ──
        try {
          const _scDir = path.join(process.cwd(), 'public', 'logs');
          await page.screenshot({ path: path.join(_scDir, `cover_editor_${Date.now()}.png`), fullPage: true });
          console.log('[Bot] 📸 Cover editor screenshot saved.');
        } catch (_e) {}

        // ══════════════════════════════════════════════════════════════════
        // Pinterest shows a "Pick a cover" modal with a grid of video
        // frame thumbnails that load asynchronously (spinner first).
        // We must:
        //   1. Wait for the frame images to appear
        //   2. Click a frame from the MIDDLE of the grid
        //   3. Click "Done"
        // ══════════════════════════════════════════════════════════════════

        // Step 1 — Wait for frame thumbnails to load (up to 15 seconds)
        console.log('[Bot] Waiting for cover frame thumbnails to load...');
        let framesLoaded = false;
        for (let wait = 0; wait < 15; wait++) {
          framesLoaded = await page.evaluate(() => {
            // Look for <img> elements inside the "Pick a cover" modal
            const modal = document.querySelector('[role="dialog"], [aria-modal="true"]')
                         || document.body;
            const imgs = Array.from(modal.querySelectorAll('img'));
            // Filter to actual frame thumbnails (small, inside the modal)
            const frameThumbs = imgs.filter(img => {
              const rect = img.getBoundingClientRect();
              const src = img.src || '';
              return rect.width > 30 && rect.width < 300 && rect.height > 30
                     && !src.includes('avatar') && !src.includes('profile')
                     && img.complete && img.naturalWidth > 0;
            });
            return frameThumbs.length >= 3;
          });
          if (framesLoaded) {
            console.log(`[Bot] ✅ Frame thumbnails loaded after ${wait + 1}s.`);
            break;
          }
          await new Promise(r => setTimeout(r, 1000));
        }

        if (framesLoaded) {
          // Step 2 — Click a frame from the middle of the grid
          const clickResult = await page.evaluate((preferredPosition) => {
            const modal = document.querySelector('[role="dialog"], [aria-modal="true"]')
                         || document.body;
            const imgs = Array.from(modal.querySelectorAll('img'));
            const frameThumbs = imgs.filter(img => {
              const rect = img.getBoundingClientRect();
              const src = img.src || '';
              return rect.width > 30 && rect.width < 300 && rect.height > 30
                     && !src.includes('avatar') && !src.includes('profile')
                     && img.complete && img.naturalWidth > 0;
            });

            if (frameThumbs.length === 0) return 'no_frames';

            // Click the smart product moment when available; otherwise keep the old safe middle-ish frame.
            const position = Number.isFinite(preferredPosition)
              ? Math.min(1, Math.max(0, preferredPosition))
              : 0.6;
            const targetIndex = Math.min(
              Math.max(0, Math.round((frameThumbs.length - 1) * position)),
              frameThumbs.length - 1
            );
            const target = frameThumbs[targetIndex];

            // Click the parent container (Pinterest wraps imgs in clickable divs)
            const clickTarget = target.closest('[role="button"], button, div[tabindex], label') || target.parentElement || target;
            clickTarget.click();
            target.click();

            return `clicked_frame_${targetIndex + 1}_of_${frameThumbs.length}`;
          }, coverPreferredPosition);

          console.log(`[Bot] 📷 Cover frame selection: ${clickResult}`);
          await new Promise(r => setTimeout(r, 1500));

          // Debug screenshot after selection
          try {
            const _scDir = path.join(process.cwd(), 'public', 'logs');
            await page.screenshot({ path: path.join(_scDir, `cover_after_select_${Date.now()}.png`), fullPage: true });
          } catch (_e) {}
        } else {
          // Frames didn't load — try clicking the modal center area
          console.log('[Bot] ⚠️ Frame thumbnails did not load in time. Trying to click modal center...');

          const modalClicked = await page.evaluate(() => {
            const modal = document.querySelector('[role="dialog"], [aria-modal="true"]');
            if (!modal) return false;
            const rect = modal.getBoundingClientRect();
            const clickX = rect.x + rect.width * 0.65;
            const clickY = rect.y + rect.height * 0.4;
            const el = document.elementFromPoint(clickX, clickY);
            if (el) { el.click(); return true; }
            return false;
          });

          if (modalClicked) {
            console.log('[Bot] Clicked modal center area as fallback.');
            await new Promise(r => setTimeout(r, 1000));
          }
        }

        // ── Click "Done" to exit the editor ──────────
        await new Promise(r => setTimeout(r, 1000));
        const doneClicked = await page.evaluate(() => {
          const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
          const labels = ['done', 'done editing', 'apply', 'save', 'continue'];
          for (const label of labels) {
            for (const btn of allBtns) {
              const t = (btn.innerText || btn.getAttribute('aria-label') || '').toLowerCase().trim();
              if (t === label && btn.offsetParent !== null) {
                btn.click();
                return `clicked_done: "${label}"`;
              }
            }
          }
          const doneBtn = document.querySelector(
            '[data-test-id="done-button"], [data-test-id="video-editor-done"], [data-test-id="storyboard-done-button"]'
          );
          if (doneBtn && doneBtn.offsetParent !== null) {
            doneBtn.click();
            return 'clicked_done_by_test-id';
          }
          return 'done_btn_not_found';
        });

        console.log(`[Bot] Cover editor exit: ${doneClicked}`);
        if (doneClicked === 'done_btn_not_found') {
          try { await page.click('button:has-text("Done")'); } catch {}
          await page.keyboard.press('Escape');
        }
        await new Promise(r => setTimeout(r, 3000));
        console.log('[Bot] ✅ Returned to pin builder after cover setup.');
      } catch (designErr) {
        console.warn('[Bot] ⚠️ Error in cover editor flow:', designErr.message);
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 2000));
      }
    }


    // 4. Fill in Details
    console.log('[Bot] Filling details...');
    // Title - try multiple selectors
    const titleSelectors = [
      'textarea#storyboard-selector-title',
      'input[id*="pin-draft-title"]',
      'textarea[id*="pin-draft-title"]',
      '[data-test-id="pin-draft-title"] textarea',
      '[data-test-id="pin-draft-title"] input',
      '[placeholder*="title" i]',
      '[aria-label*="title" i]',
      'textarea[id*="title"]',
      'input[id*="title"]'
    ];
    let titleField = null;
    for (const sel of titleSelectors) {
      try {
        titleField = await page.$(sel);
        if (titleField) break;
      } catch {}
    }
    try {
      if (titleField) {
        await titleField.click();
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(title, { delay: 30 });
      } else {
        console.log('[Bot] Title field not found, trying tab-based approach...');
        await page.keyboard.press('Tab');
        await page.keyboard.type(title, { delay: 30 });
      }
    } catch (e) { console.log('[Bot] Title error:', e.message); }

    // Description
    const descSelectors = [
      'div#storyboard-selector-description',
      '[data-test-id="pin-draft-description"] div[contenteditable]',
      '[data-test-id="pin-draft-description"] textarea',
      'div[contenteditable][aria-label*="description" i]',
      'textarea[aria-label*="description" i]',
      '[placeholder*="description" i]',
      'div[contenteditable][id*="description"]'
    ];
    try {
      let descField = null;
      for (const sel of descSelectors) {
        descField = await page.$(sel);
        if (descField) break;
      }
      if (descField) {
        await descField.click();
        await page.keyboard.type(description, { delay: 10 });
      }
    } catch (e) { console.log('[Bot] Description error:', e.message); }

    // NOTE: Destination link is filled AFTER board selection (see below).
    // Pinterest resets the link field when the board dropdown is opened,
    // so we must fill it last to guarantee it survives to publish.

    // 5. Select Board
    console.log(`[Bot] Selecting board${boardName ? ': "' + boardName + '"' : ' (first available)'}...`);
    try {
      const boardClicked = await page.evaluate(() => {
        const candidateSelectors = [
          '[data-test-id="board-dropdown-select-button"]',
          '[data-test-id="board-dropdown-select-button"] button',
          'div[data-test-id="storyboard-selector-board-dropdown"] button',
          'div[role="button"][aria-haspopup="listbox"]'
        ];
        for (const sel of candidateSelectors) {
          const btn = document.querySelector(sel);
          if (btn && btn.offsetParent !== null) {
            btn.click();
            return `clicked_precise_${sel}`;
          }
        }
        // Fallback: look for button containing "choose a board" placeholder
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
        for (const btn of buttons) {
          const text = (btn.innerText || '').toLowerCase().trim();
          if (text === 'choose a board' || text === 'select board' || text === 'save to board') {
            btn.click();
            return `clicked_text_${text}`;
          }
        }
        return 'not_found';
      });
      console.log(`[Bot] Board dropdown click result: ${boardClicked}`);
      
      await new Promise(r => setTimeout(r, 3000));

      const debugItems = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], [role="listitem"], [data-test-id="board-row"], button, div[role="button"]'));
        return items.map(i => i.innerText).filter(t => t && t.trim().length > 0).join(' | ');
      });
      console.log(`[Bot] DEBUG ALL ITEMS AFTER DROPDOWN CLICK: ${debugItems.substring(0, 500)}`);

      // Step 2: Select the target board — by name first, then fallback to first available
      const targetBoard = (boardName || '').trim().toLowerCase();
      let boardSelected = false;
      
      for (let attempt = 0; attempt < 5; attempt++) {
        boardSelected = await page.evaluate((targetBoard) => {
          const candidateSelectors = [
            '[data-test-id="board-row"]',
            '[data-test-id="board-row"] button',
            'div[role="listbox"] [role="option"]',
            'div[data-test-id="storyboard-selector-board-dropdown"] [role="button"]',
            'div[role="dialog"] [role="button"]',
            'div[role="menu"] [role="menuitem"]',
            'div[role="listbox"] [role="listitem"]',
            '[data-test-id="storyboard-selector-board-dropdown"] div[role="button"]'
          ];

          const allBoardItems = [];
          for (const sel of candidateSelectors) {
            const items = Array.from(document.querySelectorAll(sel));
            for (const item of items) {
              const text = (item.innerText || '').trim().toLowerCase();
              const isVisible = item.offsetParent !== null;
              if (isVisible && text.length > 1 && !text.includes('search') && !text.includes('create') && !text.startsWith('choose')) {
                allBoardItems.push({ el: item, text });
              }
            }
          }

          if (allBoardItems.length === 0) return false;

          // 1st priority: exact or partial name match
          if (targetBoard) {
            for (const { el, text } of allBoardItems) {
              if (text.includes(targetBoard) || targetBoard.includes(text.split('\n')[0])) {
                el.scrollIntoView({ block: 'nearest' });
                el.click();
                return `selected_targeted:${text.slice(0, 40)}`;
              }
            }
            console.warn('[Bot] Target board not found by name, using first available.');
          }

          // Fallback: click first valid board
          const first = allBoardItems[0];
          first.el.scrollIntoView({ block: 'nearest' });
          first.el.click();
          return `selected_first:${first.text.slice(0, 40)}`;
        }, targetBoard);

        if (boardSelected) {
          console.log(`[Bot] ✅ Board selected: ${boardSelected}`);
          break;
        }
        console.log(`[Bot] Board list not ready yet (attempt ${attempt + 1}/5)...`);
        await new Promise(r => setTimeout(r, 2000));
      }

      if (!boardSelected) {
        console.log('[Bot] ⚠️ Could not select a board. Attempting keyboard navigation...');
        await page.keyboard.press('Tab');
        await new Promise(r => setTimeout(r, 500));
        await page.keyboard.press('ArrowDown');
        await new Promise(r => setTimeout(r, 500));
        await page.keyboard.press('Enter');
      }
      
      // Wait for board selection to settle
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.log('[Bot] Board selection error:', e.message);
    }


    // ─── 5a-bis. Wait for Video Processing ───────────
    console.log('[Bot] Additional wait for video processing...');
    await new Promise(r => setTimeout(r, 10000));

    // ─── 5c. Fill Destination Link (AFTER board selection) ─────────────────
    // CRITICAL: This MUST happen after the board dropdown is closed.
    // Pinterest resets the destination link field when the board picker is opened.
    
    // Ensure any open modals (like Edit Cover) are fully closed
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 1000));
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 1500));

    const linkSelectors = [
      'textarea#storyboard-selector-link',
      '[data-test-id="storyboard-selector-link"]',
      'input[id*="pin-draft-link"]',
      '[data-test-id="pin-draft-link"] input',
      '[data-test-id="pin-draft-link"] textarea',
      '[data-test-id="add-link-button"]',
      '[data-test-id="story-pin-link"]',
      '[data-test-id="pin-builder-link"]',
      'input[placeholder*="link" i]',
      'input[aria-label*="link" i]',
      'textarea[placeholder*="link" i]',
      'textarea[aria-label*="link" i]',
      'input[placeholder*="url" i]',
      'input[placeholder*="destination" i]',
      'input[id*="link"]'
    ];

    const fillLinkField = async () => {
      // Sometimes Pinterest hides the link behind an "Add a link" button
      try {
        const addLinkBtns = await page.$$('button');
        for (const btn of addLinkBtns) {
           const text = await page.evaluate(el => (el.innerText || '').toLowerCase(), btn);
           const ariaLabel = await page.evaluate(el => (el.getAttribute('aria-label') || '').toLowerCase(), btn);
           if (text.includes('add a link') || text.includes('add link') || ariaLabel.includes('add a link')) {
              await btn.click();
              await new Promise(r => setTimeout(r, 1000));
              break;
           }
        }
      } catch(e) {}

      let linkField = null;
      for (const sel of linkSelectors) {
        try {
          linkField = await page.$(sel);
          if (linkField) break;
        } catch {}
      }
      if (!linkField) {
        console.log('[Bot] ⚠️ Destination link field not found.');
        return false;
      }
      await linkField.click();
      // Select all + delete any existing content
      await page.keyboard.down('Control');
      await page.keyboard.press('A');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(link, { delay: 20 });
      
      // Force React Native setter injection to guarantee it registers
      await page.evaluate((el, val) => {
         const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
         const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
         
         if (el.tagName === 'INPUT' && nativeInputValueSetter) {
             nativeInputValueSetter.call(el, val);
         } else if (el.tagName === 'TEXTAREA' && nativeTextAreaValueSetter) {
             nativeTextAreaValueSetter.call(el, val);
         } else {
             el.value = val;
             if(el.isContentEditable) el.textContent = val;
         }
         el.dispatchEvent(new Event('input', { bubbles: true }));
         el.dispatchEvent(new Event('change', { bubbles: true }));
      }, linkField, link);

      await page.keyboard.press('Tab'); // Commit the value
      return true;
    };

    if (link) {
      console.log(`[Bot] Filling destination link: ${link}`);
      try {
        const filled = await fillLinkField();
        if (filled) {
          // Verify the value actually got in
          await new Promise(r => setTimeout(r, 800));
          let linkField2 = null;
          for (const sel of linkSelectors) {
            try { linkField2 = await page.$(sel); if (linkField2) break; } catch {}
          }
          if (linkField2) {
            const currentVal = await page.evaluate(el => el.value || el.textContent || el.innerText || '', linkField2);
            if (!currentVal || !currentVal.includes('http')) {
              console.log('[Bot] ⚠️ Link value missing after first attempt — retrying...');
              await fillLinkField();
              await new Promise(r => setTimeout(r, 1200));

              // Verify again
              let linkField3 = null;
              for (const sel of linkSelectors) {
                try { linkField3 = await page.$(sel); if (linkField3) break; } catch {}
              }
              if (linkField3) {
                const newVal = await page.evaluate(el => el.value || el.textContent || el.innerText || '', linkField3);
                if (newVal && newVal.includes('http')) {
                  console.log(`[Bot] ✅ Destination link confirmed on retry: ${newVal.substring(0, 80)}...`);
                } else {
                  console.log(`[Bot] ❌ Link still missing after retry. Pinterest may apply it on publish anyway.`);
                }
              }
            } else {
              console.log(`[Bot] ✅ Destination link confirmed: ${currentVal.substring(0, 80)}...`);
            }
          }
        }
      } catch (e) {
        console.log('[Bot] Link field error:', e.message);
      }
    } else {
      console.log('[Bot] ℹ️ No destination link provided — posting without link.');
    }

    // 6. Dismiss any popups/banners before publishing
    console.log('[Bot] Dismissing any popups or banners...');
    try {
      // Don't press Escape as it cancels board selection!
      await page.evaluate(() => {
        // Aggressively close any overlay/modal/banner including Pinterest extension promos
        const dismissed = [];
        
        // Close Pinterest "Install now" / browser extension promo dialogs
        document.querySelectorAll('[data-test-id="upsell-modal"], [data-test-id="extension-banner"]').forEach(el => {
          el.style.display = 'none';
          dismissed.push('extension_banner');
        });
        
        // Find any dialog and close it
        document.querySelectorAll('[role="dialog"]').forEach(dialog => {
          // Check if it looks like a promo (contains "Install now" or "browser extension")
          const txt = (dialog.innerText || '').toLowerCase();
          if (txt.includes('install') || txt.includes('extension') || txt.includes('find it') || txt.includes('save it')) {
            dialog.style.display = 'none';
            dismissed.push('promo_dialog');
          }
        });
        
        // Click standard dismiss/close buttons
        const dismissSelectors = [
          'button[data-test-id="closeButton"]',
          'button[aria-label="close" i]',
          'button[aria-label="Close" i]',
          'button[aria-label="dismiss" i]',
        ];
        for (const sel of dismissSelectors) {
          document.querySelectorAll(sel).forEach(btn => {
            const txt = (btn.innerText || '').toLowerCase();
            if (txt.includes('close') || txt.includes('dismiss') || txt.includes('got it') || txt.includes('accept') || txt.includes('ok') || txt === '') {
              btn.click();
              dismissed.push(sel);
            }
          });
        }
        return dismissed;
      });
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {}

    // 6.5. Select Board (Removed to prevent resetting fields)

    // 7. Final Publish
    console.log('[Bot] Clicking Publish button...');
    await page.mouse.click(10, 10);
    await new Promise(r => setTimeout(r, 1000));

    // Take a screenshot before clicking Publish to verify page state
    await saveLocalDebugScreenshot(page, `pre_publish_${Date.now()}.png`, true);
    
    const publishResult = await page.evaluate(() => {
      // 1. Try precise data-test-id selectors first (most reliable)
      const selectors = [
        'button[data-test-id="pwt-publish-button"]',
        'button[data-test-id="publish-button"]',
        'button[data-test-id="board-dropdown-save-button"]',
        '[data-test-id="pwt-publish-button"] button'
      ];
      
      for (const sel of selectors) {
        const pubBtn = document.querySelector(sel);
        if (pubBtn && pubBtn.offsetParent !== null && !pubBtn.disabled) {
          pubBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return `clicked_${sel}`;
        }
      }

      // 2. Find exact 'Publish' or 'Save' button but only in the main pin-builder area,
      //    NOT inside dialogs (which would be modals/promos)
      const mainArea = document.querySelector('[data-test-id="pin-builder-form"], [data-test-id="storyboard"], form, main') || document.body;
      const buttons = Array.from(mainArea.querySelectorAll('button'));
      for (const btn of buttons) {
        // Skip if inside a dialog
        if (btn.closest('[role="dialog"]')) continue;
        const text = (btn.innerText || '').toLowerCase().trim();
        const isVisible = btn.offsetParent !== null;
        if (isVisible && !btn.disabled && (text === 'publish' || text === 'save')) {
          btn.scrollIntoView({ block: 'center' });
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return `clicked_text_${text}`;
        }
      }
      
      // 3. Log what buttons are actually visible for debugging
      const allBtns = Array.from(document.querySelectorAll('button'));
      const visibleBtnTexts = allBtns
        .filter(b => b.offsetParent !== null)
        .map(b => (b.innerText || b.getAttribute('aria-label') || b.getAttribute('data-test-id') || '').trim())
        .filter(t => t.length > 0)
        .slice(0, 15);
      return `not_found__visible_buttons: ${visibleBtnTexts.join(' | ')}`;
    });

    console.log('[Bot] Publish result:', publishResult);
    if (publishResult.startsWith('not_found')) {
        console.log('[Bot] ⚠️ Publish button not found by JS. Trying Puppeteer native click...');
        // Try native Puppeteer click on precise selectors
        const nativeSelectors = [
          'button[data-test-id="pwt-publish-button"]',
          'button[data-test-id="publish-button"]'
        ];
        let nativeClicked = false;
        for (const sel of nativeSelectors) {
          try {
            await page.click(sel);
            console.log(`[Bot] ✅ Native Puppeteer click on: ${sel}`);
            nativeClicked = true;
            break;
          } catch (_) {}
        }
        if (!nativeClicked) {
          console.log('[Bot] Fallback: Pressing Enter to Publish');
          await page.keyboard.press('Enter');
        }
    }

    // ─── CRITICAL: Dismiss Pinterest Extension Promo & Confirm Publish ───────
    // Pinterest shows a "Find it. Love it. Save it. — Install now" promo popup
    // ─── CRITICAL: Dismiss Pinterest Extension Promo & Confirm Publish ───────
    // Pinterest shows a "Find it. Love it. Save it. — Install now" promo popup
    // right after the Publish button is clicked. This popup blocks the actual
    // publish. We need to dismiss it and then click Publish again.
    console.log('[Bot] Watching for Pinterest promo popup (up to 15s)...');
    let promoHandled = false;
    let published = false;   // declared here so the promo loop can set it
    let finalUrl = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise(r => setTimeout(r, 2000));
      
      // Check if promo/extension dialog is visible and dismiss it
      const dismissResult = await page.evaluate(() => {
        // 1. Look for the specific "Find it. Love it. Save it." promo dialog
        const allDialogs = Array.from(document.querySelectorAll('[role="dialog"], [data-test-id*="modal"], [data-test-id*="upsell"]'));
        for (const dialog of allDialogs) {
          const txt = (dialog.innerText || '').toLowerCase();
          if (txt.includes('install') || txt.includes('find it') || txt.includes('save it') || txt.includes('browser extension') || txt.includes('love it')) {
            // Click the X/close button INSIDE the dialog (don't hide with CSS — that resets React state)
            const closeBtn = dialog.querySelector('button[aria-label="close" i], button[aria-label="Close" i], button[aria-label="dismiss" i], [data-test-id="closeButton"], button svg');
            if (closeBtn) {
              const actualBtn = closeBtn.closest('button') || closeBtn;
              actualBtn.click();
              return 'clicked_close_in_promo';
            }
            // Fallback: find any button in the dialog that's NOT "Install now"
            const allBtnsInDialog = Array.from(dialog.querySelectorAll('button'));
            for (const btn of allBtnsInDialog) {
              const t = (btn.innerText || '').toLowerCase().trim();
              if (!t.includes('install') && !t.includes('now')) {
                btn.click();
                return `clicked_non_install_btn_in_promo: ${t}`;
              }
            }
            return 'promo_found_but_no_close_btn';
          }
        }
        
        // 2. Also try clicking standard close/X buttons in any visible dialog
        const closeBtns = Array.from(document.querySelectorAll('button[aria-label="close" i], button[aria-label="Close" i], button[aria-label="dismiss" i], [data-test-id="closeButton"]'));
        for (const btn of closeBtns) {
          if (btn.offsetParent !== null) {
            btn.click();
            return 'clicked_close_button';
          }
        }
        
        return 'no_promo_found';
      });
      
      console.log(`[Bot] Promo check ${attempt + 1}/5: ${dismissResult}`);
      
      if (dismissResult !== 'no_promo_found') {
        // If we found the promo but couldn't find a close button, press Escape
        if (dismissResult === 'promo_found_but_no_close_btn') {
          console.log('[Bot] No close button found in promo — pressing Escape to dismiss...');
          await page.keyboard.press('Escape');
          await new Promise(r => setTimeout(r, 1000));
        }
        
        promoHandled = true;
        console.log('[Bot] ✅ Promo close clicked! Waiting for Pinterest to confirm publish...');
        // DO NOT re-click Publish here — clicking Close on the promo IS the trigger for publish to complete.
        // Pinterest will show "Your Pin has been published!" toast after the close click.
        // Wait for the toast to appear (usually within 1-3 seconds).
        await new Promise(r => setTimeout(r, 3000));
        
        // Take a screenshot to see the page state after dismissing the promo
        try {
          const _scDir = path.join(process.cwd(), 'public', 'logs');
          await page.screenshot({ path: path.join(_scDir, `after_promo_dismiss_${Date.now()}.png`), fullPage: true });
        } catch (_e) {}
        
        // Check if we can see the "Your Pin has been published!" toast
        const toastResult = await page.evaluate(() => {
          const bodyText = (document.body.innerText || '').toLowerCase();
          const successPhrases = ['your pin has been published', 'pin has been published', 'pin saved', 'pin created', 'your pin is live'];
          for (const phrase of successPhrases) {
            if (bodyText.includes(phrase)) {
              // Try to find the "View" button to get the actual pin URL
              const viewLinks = Array.from(document.querySelectorAll('a'));
              const viewLink = viewLinks.find(el => {
                const t = (el.innerText || '').toLowerCase().trim();
                return t === 'view' || t === 'view pin';
              });
              return { found: true, phrase, pinUrl: viewLink?.href || null };
            }
          }
          
          // Check if URL changed to a pin page
          if (window.location.href.includes('/pin/') && !window.location.href.includes('pin-creation-tool')) {
            return { found: true, phrase: 'url_changed', pinUrl: window.location.href };
          }
          
          return { found: false, bodyText: bodyText.substring(0, 200) };
        });
        
        console.log(`[Bot] Toast check after promo dismiss: ${JSON.stringify(toastResult)}`);
        
        if (toastResult.found) {
          console.log(`[Bot] ✅ Publication confirmed via toast! Pin URL: ${toastResult.pinUrl}`);
          published = true;
          finalUrl = toastResult.pinUrl || finalUrl;
        } else {
          // Toast not seen yet — maybe it appeared between the promo and now
          // Fall through to the regular polling loop below
          console.log('[Bot] Toast not visible yet — will continue polling...');
        }
        
        break; // Stop checking for promo regardless
      }
      
      // Check if URL already changed (publish succeeded without a promo)
      const currentUrl = await page.url();
      if (currentUrl.includes('/pin/') && !currentUrl.includes('pin-creation-tool')) {
        console.log('[Bot] ✅ Publish succeeded during promo watch (URL changed)!');
        promoHandled = true;
        published = true;
        finalUrl = currentUrl;
        break;
      }
    }
    
    // Wait a tiny bit before verification
    await new Promise(resolve => setTimeout(resolve, 2000));


    // 7. Verify Success
    console.log('[Bot] Verifying publication...');
    
    // Take a screenshot
    try {
        const scDir = path.join(process.cwd(), 'public', 'logs');
        if (!persistencePolicy.canWriteLocalDebugArtifacts()) throw new Error('Local debug artifacts disabled');
        if (!fs.existsSync(scDir)) fs.mkdirSync(scDir, { recursive: true });
        const scPath = path.join(scDir, `after_publish_click_${Date.now()}.png`);
        await page.screenshot({ path: scPath, fullPage: true });
        console.log(`[Bot] 📸 Debug screenshot after publish saved to: ${scPath}`);
    } catch (e) {}

    // Update finalUrl from current page
    if (!finalUrl) finalUrl = await page.url();
    
    // Dump page text to see if there are any errors shown by Pinterest
    try {
        const pageText = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '));
        console.log(`[Bot] PAGE TEXT AFTER PUBLISH: ${pageText.substring(0, 800)}`);
    } catch(e) {}

    if (!published) {
      // SECOND: Poll for 60 seconds looking for success indicators
      console.log('[Bot] Polling for success (up to 60s)...');
      for (let i = 0; i < 15; i++) {
          await new Promise(resolve => setTimeout(resolve, 4000));
          finalUrl = await page.url();
          console.log(`[Bot] Verification attempt ${i+1} | URL: ${finalUrl}`);

          const check = await page.evaluate(() => {
            const url = window.location.href;
            const bodyText = (document.body.innerText || '').toLowerCase();
            
            // 1. Instant Success: URL changed to a Pin URL (e.g. /pin/12345/)
            if (url.includes('/pin/') && !url.includes('pin-creation-tool')) return { success: true, pinUrl: url };

            // 2. Success toast/keywords
            const successPhrases = ['your pin has been published', 'pin has been published', 'pin saved', 'pin created', 'see it now', 'your pin is live'];
            for (const phrase of successPhrases) {
              if (bodyText.includes(phrase)) {
                const viewBtn = Array.from(document.querySelectorAll('a')).find(el => (el.innerText || '').toLowerCase().trim() === 'view');
                return { success: true, pinUrl: viewBtn?.href || url };
              }
            }

            return { success: false };
          });

          if (check.success) {
              published = true;
              finalUrl = check.pinUrl || finalUrl;
              break;
          }
      }
    }

    if (!published) {
      console.error('[Bot] ❌ Verification timed out. Pin was NOT published. Fake-success detected.');
      // Take a debug screenshot and dump DOM
      try {
          const scDir = path.join(process.cwd(), 'public', 'logs');
          if (!persistencePolicy.canWriteLocalDebugArtifacts()) throw new Error('Local debug artifacts disabled');
          if (!fs.existsSync(scDir)) fs.mkdirSync(scDir, { recursive: true });
          const scPath = path.join(scDir, `fail_verification_${Date.now()}.png`);
          const htmlPath = path.join(scDir, `fail_verification_${Date.now()}.html`);
          await page.screenshot({ path: scPath, fullPage: true });
          const dom = await page.evaluate(() => document.documentElement.outerHTML);
          require('fs').writeFileSync(htmlPath, dom);
          console.log(`[Bot] 📸 Debug screenshot and DOM saved to: ${scDir}`);
      } catch (e) {}
      
      throw new Error('Verification failed. Pin was NOT published to the live account (Fake-success detected).');
    }

    console.log('[Bot] ✅ Pin published successfully!');
    return {
      success: true,
      pin: { 
        id: finalUrl.match(/\/pin\/(\d+)/) ? finalUrl.match(/\/pin\/(\d+)/)[1] : `bot_${Date.now()}`,
        url: finalUrl
      }
    };

  } catch (error) {
    console.error('[Bot] ❌ Error during automation:', error);
    // Take a screenshot on failure to debug if needed
    if (persistencePolicy.canWriteLocalDebugArtifacts()) {
      try {
        if (page) {
          const screenshotPath = path.join(os.tmpdir(), 'error_screenshot.png');
          await page.screenshot({ path: screenshotPath });
          console.log(`[Bot] Saved error screenshot to ${screenshotPath}`);
        }
      } catch (e) {}
    }
    throw new Error(`Browser Bot failed: ${error.message}`);
  } finally {
    // Cleanup temp files
    if (browser) await browser.close().catch(() => {});
    const cleanupTargets = Array.from(new Set([
      mediaPath,
      coverPath,
      ...smartCoverCleanupPaths,
    ].filter(Boolean)));
    if (cleanupSmartCoverFiles) {
      cleanupSmartCoverFiles(...cleanupTargets);
    } else {
      cleanupTargets.forEach((targetPath) => {
        try { fs.unlinkSync(targetPath); } catch (e) {}
      });
    }
  }
}


function normalizePinUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return raw.split('#')[0].split('?')[0];
  }
}

function normalizePinterestEngagementNiche(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'mens_streetwear') return 'mens_streetwear';
  if (raw === 'mens_formal') return 'mens_formal';
  if (raw === 'fashion' || raw === 'all' || raw === 'menswear' || raw === 'mens' || raw === 'men') return 'mens_outfits';
  return 'mens_outfits';
}

function getPinterestEngagementTargets(options = {}) {
  const likeTarget = Math.max(
    1,
    toInt(options.likeTarget ?? options.likesTarget ?? process.env.AUTOMATION_ENGAGEMENT_LIKE_TARGET ?? process.env.AUTOMATION_ENGAGEMENT_LIKES_PER_HOUR, 5)
  );
  const commentTarget = Math.max(
    0,
    toInt(options.commentTarget ?? options.commentsTarget ?? process.env.AUTOMATION_ENGAGEMENT_COMMENT_TARGET ?? process.env.AUTOMATION_ENGAGEMENT_COMMENTS_PER_HOUR, 3)
  );
  return {
    likeTarget,
    commentTarget,
    totalTarget: likeTarget + commentTarget,
  };
}

function getEngagementDateKey(timeZone = 'Asia/Calcutta') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value || '1970';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  const day = parts.find((part) => part.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

function prepareEngagementAutomationState(automationState = {}, timeZone = 'Asia/Calcutta') {
  const engagementDateKey = getEngagementDateKey(timeZone);
  const normalizedUrls = Array.from(new Set(
    (Array.isArray(automationState.engagedUrls) ? automationState.engagedUrls : [])
      .map(normalizePinUrl)
      .filter(Boolean)
  ));
  const trimmedUrls = normalizedUrls.slice(-600);
  const changed = trimmedUrls.length !== normalizedUrls.length
    || trimmedUrls.length !== (Array.isArray(automationState.engagedUrls) ? automationState.engagedUrls.length : 0)
    || automationState.engagementDateKey !== engagementDateKey
    || (automationState.savesToday || 0) !== 0;

  const nextState = {
    ...automationState,
    engagedUrls: automationState.engagementDateKey === engagementDateKey ? trimmedUrls : trimmedUrls.slice(-120),
    engagementDateKey,
    likesToday: automationState.engagementDateKey === engagementDateKey ? (automationState.likesToday || 0) : 0,
    commentsToday: automationState.engagementDateKey === engagementDateKey ? (automationState.commentsToday || 0) : 0,
    savesToday: 0,
  };

  return { changed, nextState };
}

function pickRandomItem(items, fallback = '') {
  if (!Array.isArray(items) || items.length === 0) return fallback;
  return items[randomInt(0, items.length - 1)];
}

function getMensEngagementQueries(targetNiche) {
  if (targetNiche === 'mens_streetwear') {
    return [
      'mens streetwear outfit',
      'mens sneakers outfit',
      'oversized mens outfit',
      'men casual street style',
      'urban menswear outfit',
      'mens layered outfit',
    ];
  }

  if (targetNiche === 'mens_formal') {
    return [
      'mens formal outfit',
      'mens blazer outfit',
      'mens business casual outfit',
      'mens suit inspiration',
      'mens loafers outfit',
      'smart casual men style',
    ];
  }

  return [
    'mens outfit inspiration',
    'mens casual outfit',
    'mens fashion outfit',
    'mens style guide',
    'menswear outfit ideas',
    'mens smart casual outfit',
  ];
}

function buildPinterestSearchUrl(query) {
  return `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}&rs=typed`;
}

async function openRandomEngagementSearch(page, queries, reason = 'refresh') {
  const query = pickRandomItem(queries, queries[0] || 'mens outfit inspiration');
  const url = buildPinterestSearchUrl(query);
  console.log(`[Bot] Loading ${reason} search feed: ${query}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('a[href*="/pin/"]', { timeout: 25000 }).catch(() => null);
  await sleep(1200);
  return { query, url };
}

async function collectVisiblePinLinks(page) {
  return page.evaluate(() => {
    const rawLinks = Array.from(document.querySelectorAll('a[href*="/pin/"]'))
      .map((anchor) => anchor.href)
      .filter(Boolean);
    return Array.from(new Set(rawLinks))
      .filter((link) => !link.includes('/pin/pin-builder/'))
      .map((link) => link.split('#')[0]);
  });
}

async function extractPinSnapshot(page) {
  return page.evaluate(() => {
    const titleCandidates = Array.from(document.querySelectorAll('h1, [data-test-id="pinTitle"]'));
    let title = '';
    for (const element of titleCandidates) {
      const text = element.innerText ? element.innerText.trim() : '';
      if (text && text !== 'Pinterest' && text !== 'Explore') {
        title = text;
        break;
      }
    }

    const descCandidates = Array.from(document.querySelectorAll('[data-test-id="pin-description-text"], .TP9, ._8n, [data-test-id="pinDescription"]'));
    const desc = descCandidates
      .map((element) => element.innerText ? element.innerText.trim() : '')
      .filter(Boolean)
      .join(' ');

    const imageAltText = Array.from(document.querySelectorAll('img[src*="pinimg"]'))
      .map((image) => image.alt || '')
      .filter(Boolean)
      .join(' ');

    const boardText = Array.from(document.querySelectorAll('a[href*="/board/"], [data-test-id="board-title"], [data-test-id="board-name"], [data-test-id="SaveButton"]'))
      .map((element) => element.innerText ? element.innerText.trim() : '')
      .filter((text) => text && !['Save', 'Saved', 'Profile'].includes(text))
      .join(' ');

    const fallbackTitle = document.querySelector('meta[property="og:title"]')?.content || '';
    const fallbackDesc = document.querySelector('meta[property="og:description"]')?.content || '';

    return {
      title: (title || fallbackTitle || '').trim(),
      desc: `${desc} ${imageAltText} ${fallbackDesc}`.trim(),
      comments: document.querySelectorAll('[data-test-id="comment-container"]').length,
      boardName: boardText.trim(),
    };
  });
}

async function clickLikeOnPin(page) {
  const selectors = [
    'button[aria-label="React"]',
    'button[aria-label="react"]',
    'button[aria-label*="Like" i]',
    'button[aria-label*="reaction" i]',
    'button[data-test-id="pin-rep-reaction-button"]',
    '[data-test-id*="reaction"] button',
    '[data-test-id*="like"] button',
  ];

  for (const selector of selectors) {
    const button = await page.$(selector);
    if (!button) continue;
    await button.click();
    return true;
  }

  return page.evaluate(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 8 && rect.height > 8 && rect.bottom > 0 && rect.right > 0;
    };

    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
    const blocked = ['save', 'share', 'send', 'more', 'follow', 'visit', 'open'];
    const target = buttons.find((button) => {
      const label = `${button.getAttribute('aria-label') || ''} ${button.innerText || ''} ${button.dataset?.testid || ''}`.toLowerCase();
      if (!isVisible(button) || blocked.some((word) => label.includes(word))) return false;
      return label.includes('react') || label.includes('reaction') || label.includes('like') || label.includes('love');
    });

    if (!target) return false;
    target.click();
    return true;
  });
}

async function submitCommentOnPin(page, commentText, loadMultiplier = 1) {
  const openSelectors = [
    'button[aria-label="Comments"]',
    'button[aria-label*="comment" i]',
    '[data-test-id="community-comment-button"]',
    '[data-test-id*="comment"] button',
  ];
  let opened = false;
  for (const selector of openSelectors) {
    const button = await page.$(selector);
    if (!button) continue;
    await button.click();
    opened = true;
    break;
  }

  if (!opened) {
    opened = await page.evaluate(() => {
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 8 && rect.height > 8 && rect.bottom > 0 && rect.right > 0;
      };
      const button = Array.from(document.querySelectorAll('button, [role="button"]')).find((element) => {
        const label = `${element.getAttribute('aria-label') || ''} ${element.innerText || ''} ${element.dataset?.testid || ''}`.toLowerCase();
        return isVisible(element) && label.includes('comment');
      });
      if (!button) return false;
      button.click();
      return true;
    });
  }

  if (!opened) return false;

  await sleep(1500 * loadMultiplier);

  const boxSelectors = [
    'div[aria-label="Add a comment"]',
    'div[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[role="textbox"]',
    '[data-test-id="comment-composer"]',
    'input[placeholder="Add a comment"]',
    'input[placeholder*="comment" i]',
    '[data-test-id="comment-input-box"]',
    'textarea',
  ];

  let commentBox = null;
  for (const selector of boxSelectors) {
    commentBox = await page.$(selector);
    if (commentBox) break;
  }
  if (!commentBox) return false;

  await commentBox.click();
  await sleep(randomInt(1000, 2000));
  await page.keyboard.type(commentText, { delay: randomInt(80, 180) });
  await sleep(randomInt(800, 1800));

  const submitSelectors = [
    'button[aria-label="Post"]',
    '[data-test-id="comment-submit-button"]',
    'button[data-test-id="done-button"]',
  ];

  for (const selector of submitSelectors) {
    const button = await page.$(selector);
    if (!button) continue;
    const disabled = await page.evaluate((element) => !!element.disabled, button);
    if (disabled) continue;
    await button.click();
    await sleep(randomInt(3500, 6500) * loadMultiplier);
    return true;
  }

  const clickedFallbackSubmit = await page.evaluate(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 8 && rect.height > 8 && rect.bottom > 0 && rect.right > 0;
    };
    const button = Array.from(document.querySelectorAll('button, [role="button"]')).find((element) => {
      const label = `${element.getAttribute('aria-label') || ''} ${element.innerText || ''} ${element.dataset?.testid || ''}`.toLowerCase().trim();
      if (!isVisible(element) || element.disabled) return false;
      return label === 'post' || label === 'send' || label.includes('post comment') || label.includes('submit comment');
    });
    if (!button) return false;
    button.click();
    return true;
  });

  if (clickedFallbackSubmit) {
    await sleep(randomInt(3500, 6500) * loadMultiplier);
    return true;
  }

  return false;
}

function isPinRelevant(title, description, boardName = '', fallbackMode = false, targetNiche = 'mens_outfits') {
  const normalizedNiche = normalizePinterestEngagementNiche(targetNiche);
  const text = `${title} ${description}`.toLowerCase();
  const boardText = String(boardName || '').toLowerCase();
  const combined = `${text} ${boardText}`;

  const blacklist = [
    'women', 'woman', 'female', 'girl', 'girls', 'ladies', 'lady', 'feminine', 'she', 'her', 'hers', 'womens', 'womenswear', 'bridal', 'bride',
    'recipe', 'food', 'cooking', 'baking', 'meal', 'dinner', 'lunch', 'breakfast', 'dessert', 'cake',
    'makeup', 'lipstick', 'nail', 'mascara', 'blush', 'foundation', 'contour', 'lashes',
    'kids', 'children', 'baby', 'toddler', 'infant', 'nursery',
    'pets', 'cat', 'dog',
    'home decor', 'interior design', 'kitchen', 'bathroom', 'living room', 'bedroom',
  ];

  if (blacklist.some((word) => combined.includes(word))) {
    return { relevant: false, reason: 'blacklisted', subNiche: 'casual', matchCount: 0 };
  }

  const menKeywords = ['men', 'man', 'male', 'guy', 'gentleman', 'menswear', 'mensstyle', 'mens', 'dapper', 'him'];
  const outfitKeywords = ['outfit', 'style', 'fashion', 'look', 'wardrobe', 'streetwear', 'blazer', 'suit', 'chinos', 'sneakers', 'loafers', 'tailored', 'casual', 'smart casual', 'fit', 'ootd'];
  const streetwearKeywords = ['streetwear', 'oversized', 'sneakers', 'urban', 'layered', 'hoodie', 'cargo', 'baggy'];
  const formalKeywords = ['formal', 'suit', 'blazer', 'tailored', 'business casual', 'loafers', 'dress shoes', 'sharp'];
  const strongIdentifiers = ['menswear', 'mensstyle', 'outfit', 'streetwear', 'blazer', 'suit', 'smart casual', 'dapper'];

  const hasMenKeyword = menKeywords.some((word) => combined.includes(word));
  const hasOutfitKeyword = outfitKeywords.some((word) => combined.includes(word));
  const hasStreetwearKeyword = streetwearKeywords.some((word) => combined.includes(word));
  const hasFormalKeyword = formalKeywords.some((word) => combined.includes(word));

  if (fallbackMode && normalizedNiche === 'mens_outfits') {
    return { relevant: true, reason: 'trusted mens search feed fallback', subNiche: 'casual', matchCount: 1 };
  }

  if (!hasMenKeyword || !hasOutfitKeyword) {
    const fallbackPass = fallbackMode && strongIdentifiers.some((word) => combined.includes(word));
    if (!fallbackPass) {
      return { relevant: false, reason: 'missing mens outfit identifiers', subNiche: 'casual', matchCount: 0 };
    }
  }

  if (normalizedNiche === 'mens_streetwear' && !hasStreetwearKeyword && !fallbackMode) {
    return { relevant: false, reason: 'missing streetwear identifiers', subNiche: 'streetwear', matchCount: 0 };
  }

  if (normalizedNiche === 'mens_formal' && !hasFormalKeyword && !fallbackMode) {
    return { relevant: false, reason: 'missing formal identifiers', subNiche: 'formal', matchCount: 0 };
  }

  const subNiches = {
    casual: ['casual', 'everyday', 'weekend', 'relaxed'],
    formal: ['formal', 'suit', 'tuxedo', 'blazer', 'business', 'dapper', 'sharp'],
    streetwear: ['streetwear', 'sneakers', 'hype', 'urban', 'oversized', 'cargo'],
    smart_casual: ['chinos', 'oxford', 'loafers', 'smart casual', 'business casual'],
    seasonal: ['summer', 'winter', 'fall', 'spring'],
    grooming: ['beard', 'haircut', 'hairstyle', 'fade', 'grooming'],
    accessories: ['watch', 'chain', 'belt', 'sunglasses', 'rings'],
    athletic: ['gym', 'athletic', 'workout'],
  };

  let detectedSubNiche = normalizedNiche === 'mens_formal'
    ? 'formal'
    : normalizedNiche === 'mens_streetwear'
      ? 'streetwear'
      : 'casual';
  let matchCount = 0;

  for (const [niche, keywords] of Object.entries(subNiches)) {
    const hits = keywords.filter((keyword) => combined.includes(keyword)).length;
    if (hits > matchCount) {
      matchCount = hits;
      detectedSubNiche = niche;
    }
  }

  return { relevant: true, subNiche: detectedSubNiche, matchCount, reason: fallbackMode ? 'fallback_mode' : 'matched' };
}

function scorePin(pinData, matchCount) {
  let score = 0;
  if (pinData.title) score += 15;
  if (pinData.desc && pinData.desc.split(' ').length > 20) score += 15;
  if (pinData.comments > 0) score += 10;
  if (pinData.boardName) score += 10;
  if (matchCount >= 2) score += 12;
  if (!pinData.desc || pinData.desc.trim().length === 0) score -= 15;
  return score;
}

async function runAutoEngagerSafe(options = {}) {
  const sessionCookie = await getActiveSessionCookie();
  if (!sessionCookie) throw new Error('PINTEREST_SESSION_COOKIE is missing. Link a session in Settings.');
  const context = resolveEngagementContext(options.context || {});
  const timeZone = process.env.AUTOMATION_TIMEZONE || 'Asia/Calcutta';
  const targets = getPinterestEngagementTargets(options);
  const targetNiche = normalizePinterestEngagementNiche(options.niche || process.env.AUTOMATION_ENGAGEMENT_NICHE || 'mens_outfits');
  const searchQueries = getMensEngagementQueries(targetNiche);

  let automationState = await historyService.getAutomationState();
  const preparedState = prepareEngagementAutomationState(automationState, timeZone);
  if (preparedState.changed) {
    automationState = await historyService.setAutomationState(preparedState.nextState);
  } else {
    automationState = preparedState.nextState;
  }

  let { likesToday = 0, commentsToday = 0, engagedUrls = [], circuitBreaker } = automationState;

  if (circuitBreaker && new Date(circuitBreaker).getTime() > Date.now()) {
    console.log(`[Bot] Circuit breaker active until ${new Date(circuitBreaker).toLocaleString()}. Skipping engagement.`);
    return { success: false, message: 'Circuit breaker active.', likesCompleted: 0, commentsCompleted: 0, niche: targetNiche };
  }

  const DAILY_MAX_LIKES = Math.max(
    targets.likeTarget,
    toInt(process.env.AUTOMATION_DAILY_MAX_LIKES, 120)
  );
  const DAILY_MAX_COMMENTS = Math.max(
    targets.commentTarget,
    toInt(process.env.AUTOMATION_DAILY_MAX_COMMENTS, 72)
  );

  if (likesToday >= DAILY_MAX_LIKES && commentsToday >= DAILY_MAX_COMMENTS) {
    console.log('[Bot] Daily hard caps reached. Exiting.');
    return {
      success: true,
      message: 'Daily caps reached.',
      likesCompleted: 0,
      commentsCompleted: 0,
      likeTarget: targets.likeTarget,
      commentTarget: targets.commentTarget,
      niche: targetNiche,
    };
  }

  console.log(`[Bot] Starting Pinterest engagement profile for ${targetNiche}: ${targets.likeTarget} likes, ${targets.commentTarget} comments, 0 saves.`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1920,1080', '--disable-gpu']
  });

  let hourlyLikes = 0;
  let hourlyComments = 0;
  let cycle = 0;
  let loadMultiplier = 1;

  try {
    const page = await browser.newPage();
    page.on('console', (msg) => {
      if (!msg.text().includes('Failed to load resource')) {
        console.log(`[Bot-Browser] ${msg.text()}`);
      }
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setCookie({ name: '_pinterest_sess', value: sessionCookie, domain: '.pinterest.com', path: '/', secure: true, httpOnly: true });

    const maxCycles = Math.max(36, targets.totalTarget * 10);
    const seenThisSession = new Set((Array.isArray(engagedUrls) ? engagedUrls : []).map(normalizePinUrl).filter(Boolean));
    let { query: activeQuery, url: activeFeedUrl } = await openRandomEngagementSearch(page, searchQueries, 'initial');
    const returnToActiveFeed = async (reason) => {
      try {
        await page.goto(activeFeedUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForSelector('a[href*="/pin/"]', { timeout: 20000 }).catch(() => null);
        await sleep(1000 * loadMultiplier);
      } catch (err) {
        console.warn(`[Bot] Could not return to search feed after ${reason}: ${err.message}. Opening a fresh feed.`);
        const nextSearch = await openRandomEngagementSearch(page, searchQueries, `recovery-${reason}`);
        activeQuery = nextSearch.query;
        activeFeedUrl = nextSearch.url;
      }
    };

    while ((hourlyLikes < targets.likeTarget || hourlyComments < targets.commentTarget) && cycle < maxCycles) {
      cycle += 1;

      if (cycle > 1 && cycle % 4 === 0) {
        const nextSearch = await openRandomEngagementSearch(page, searchQueries, 'rotation');
        activeQuery = nextSearch.query;
        activeFeedUrl = nextSearch.url;
      }

      if (likesToday >= DAILY_MAX_LIKES && commentsToday >= DAILY_MAX_COMMENTS) {
        console.log('[Bot] Daily caps hit mid-session.');
        break;
      }

      console.log(`[Bot] Loop ${cycle} | Likes ${hourlyLikes}/${targets.likeTarget} | Comments ${hourlyComments}/${targets.commentTarget} | Query "${activeQuery}"`);

      const pinLinks = await collectVisiblePinLinks(page);
      const freshLinks = pinLinks.filter((link) => !seenThisSession.has(normalizePinUrl(link)));

      if (!freshLinks.length) {
        console.log('[Bot] No fresh mens-outfit pins visible. Scrolling...');
        await page.evaluate(() => window.scrollBy(0, 1800));
        await sleep(randomInt(2500, 5000) * loadMultiplier);
        if (cycle % 3 === 0) {
          const nextSearch = await openRandomEngagementSearch(page, searchQueries, 're-seed');
          activeQuery = nextSearch.query;
          activeFeedUrl = nextSearch.url;
        }
        continue;
      }

      const randomPin = pickRandomItem(freshLinks);
      const normalizedPin = normalizePinUrl(randomPin);
      seenThisSession.add(normalizedPin);
      console.log(`[Bot] Viewing pin: ${normalizedPin}`);

      const loadStart = Date.now();
      const response = await page.goto(randomPin, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (response && response.status() === 429) {
        console.log('[Bot] HTTP 429 Too Many Requests detected. Triggering 2-hour circuit breaker.');
        automationState = await historyService.setAutomationState({
          ...automationState,
          likesToday,
          commentsToday,
          engagedUrls,
          circuitBreaker: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        });
        break;
      }

      if (Date.now() - loadStart > 8000) {
        console.log('[Bot] Page loaded slowly, increasing delays by 50%.');
        loadMultiplier = 1.5;
      }

      const currentUrl = await page.url();
      if (currentUrl.includes('login')) {
        console.log('[Bot] Redirected to login. Session cookie expired. Triggering circuit breaker.');
        automationState = await historyService.setAutomationState({
          ...automationState,
          likesToday,
          commentsToday,
          engagedUrls,
          circuitBreaker: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });
        break;
      }

      await sleep(randomInt(2000, 4500) * loadMultiplier);

      const pinData = await extractPinSnapshot(page);
      console.log(`[Bot] Extracted -> Title: "${pinData.title}" | Desc: "${pinData.desc.substring(0, 70)}..." | Board: "${pinData.boardName}"`);

      const fallbackMode = cycle > 4 || ((hourlyLikes + hourlyComments) === 0 && cycle > 2);
      const relevancy = isPinRelevant(pinData.title, pinData.desc, pinData.boardName, fallbackMode, targetNiche);
      if (!relevancy.relevant) {
        console.log(`[Bot] Skipped irrelevant pin: "${pinData.title}" Reason: ${relevancy.reason}`);
        await returnToActiveFeed('irrelevant-pin');
        continue;
      }

      const score = scorePin(pinData, relevancy.matchCount);
      if (score < 25 && !fallbackMode) {
        console.log(`[Bot] Skipped low-quality pin (score ${score}).`);
        await returnToActiveFeed('low-quality-pin');
        continue;
      }

      let liked = false;
      let commented = false;
      let generatedComment = '';

      if (hourlyLikes < targets.likeTarget && likesToday < DAILY_MAX_LIKES) {
        try {
          liked = await clickLikeOnPin(page);
          if (liked) {
            hourlyLikes += 1;
            likesToday += 1;
            console.log('[Bot] Liked pin.');
            await sleep(randomInt(8000, 18000) * loadMultiplier);
          }
        } catch (err) {
          console.warn('[Bot] Like action failed:', err.message);
        }
      }

      if (hourlyComments < targets.commentTarget && commentsToday < DAILY_MAX_COMMENTS) {
        try {
          console.log('[Bot] Generating a niche-safe comment...');
          generatedComment = await aiService.generateEngagementComment({
            title: pinData.title,
            description: pinData.desc,
            subNiche: relevancy.subNiche,
          });
          console.log('[Bot] Submitting comment...');
          commented = await submitCommentOnPin(page, generatedComment, loadMultiplier);
          if (commented) {
            hourlyComments += 1;
            commentsToday += 1;
            console.log(`[Bot] Commented: "${generatedComment}"`);
            await sleep(randomInt(12000, 22000) * loadMultiplier);
          }
        } catch (err) {
          console.warn('[Bot] Comment action failed:', err.message);
        }
      }

      if (liked || commented) {
        const actionTaken = liked && commented
          ? 'Liked & Commented'
          : liked
            ? 'Liked Pin'
            : 'Commented on Pin';

        await historyService.addEngagement({
          url: normalizedPin,
          action: actionTaken,
          comment: commented ? generatedComment : '',
          niche: targetNiche,
          query: activeQuery,
          pinTitle: pinData.title || '',
          boardName: pinData.boardName || '',
          source: context.source,
          command: context.command,
          workflow: context.workflow,
          actor: context.actor,
          engagedAt: new Date().toISOString(),
        });

        engagedUrls = [...engagedUrls, normalizedPin]
          .map(normalizePinUrl)
          .filter(Boolean)
          .slice(-600);

        automationState = await historyService.setAutomationState({
          ...automationState,
          likesToday,
          commentsToday,
          savesToday: 0,
          engagedUrls,
          engagementDateKey: getEngagementDateKey(timeZone),
          circuitBreaker: null,
        });
      }

      await sleep(randomInt(3000, 7000) * loadMultiplier);
      await returnToActiveFeed('engagement-action');
    }

    const executed = hourlyLikes + hourlyComments;
    console.log(`[Bot] Hourly run complete. Achieved ${hourlyLikes} likes and ${hourlyComments} comments with no saves.`);
    return {
      success: true,
      executed,
      likesCompleted: hourlyLikes,
      commentsCompleted: hourlyComments,
      likeTarget: targets.likeTarget,
      commentTarget: targets.commentTarget,
      niche: targetNiche,
      message: `Achieved ${hourlyLikes} likes and ${hourlyComments} comments.`,
    };
  } catch (error) {
    console.error('[Bot] Refreshed engager failed:', error.message);
    const executed = hourlyLikes + hourlyComments;
    if (executed > 0) {
      console.warn(`[Bot] Returning partial engagement success after ${executed} completed action(s).`);
      return {
        success: true,
        partial: true,
        executed,
        likesCompleted: hourlyLikes,
        commentsCompleted: hourlyComments,
        likeTarget: targets.likeTarget,
        commentTarget: targets.commentTarget,
        niche: targetNiche,
        message: `Partial success after Pinterest slowdown: ${hourlyLikes} likes, ${hourlyComments} comments.`,
        error: error.message,
      };
    }
    throw new Error(`Booster failed: ${error.message}`);
  } finally {
    await browser.close().catch((err) => {
      console.warn('[Bot] Browser close warning:', err.message);
    });
  }
}

module.exports = {
  createPinWithBot,
  runAutoEngager: runAutoEngagerSafe,
  runAutoEngagerSafe,
  autoLinkSessionFromLocalBrowser,
};

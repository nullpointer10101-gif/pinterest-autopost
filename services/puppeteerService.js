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
  if (ext === '.mp4') {
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
    try {
      const _scDir = path.join(process.cwd(), 'public', 'logs');
      if (!fs.existsSync(_scDir)) fs.mkdirSync(_scDir, { recursive: true });
      await page.screenshot({ path: path.join(_scDir, `page_loaded_${Date.now()}.png`), fullPage: false });
    } catch (_e) {}

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
        await fileInput.uploadFile(mediaPath);
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
      try {
        const _scDir = path.join(process.cwd(), 'public', 'logs');
        if (!fs.existsSync(_scDir)) fs.mkdirSync(_scDir, { recursive: true });
        await page.screenshot({ path: path.join(_scDir, `upload_fail_${Date.now()}.png`), fullPage: true });
      } catch (_e) {}

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
    const designEditorCheck = await page.evaluate(() => {
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

    if (designEditorCheck) {
      console.log('[Bot] 🎬 "Design your Pin" editor detected — setting cover thumbnail...');
      try {
        // ── Strategy 1: Look for "Upload cover image" button inside the modal ──
        const uploadCoverClicked = await page.evaluate(() => {
          const allBtns = Array.from(document.querySelectorAll('button, [role="button"], label'));
          for (const btn of allBtns) {
            const t = (btn.innerText || btn.getAttribute('aria-label') || btn.getAttribute('for') || '').toLowerCase();
            if (
              t.includes('upload cover') ||
              t.includes('upload image') ||
              t.includes('choose an image') ||
              t.includes('add cover') ||
              t.includes('custom cover')
            ) {
              btn.click();
              return `clicked: "${btn.innerText || btn.getAttribute('aria-label')}"`;
            }
          }
          return null;
        });

        if (uploadCoverClicked && coverPath && fs.existsSync(coverPath)) {
          console.log(`[Bot] Found upload button: ${uploadCoverClicked}`);
          await new Promise(r => setTimeout(r, 1500));

          // Now find the file input that appeared (could be anywhere in DOM — Pinterest uses hidden inputs)
          const fileInputs = await page.$$('input[type="file"]');
          if (fileInputs.length > 0) {
            const targetInput = fileInputs[fileInputs.length - 1];
            await targetInput.uploadFile(coverPath);
            console.log('[Bot] ✅ Cover image uploaded via "Upload cover image" button.');
            await new Promise(r => setTimeout(r, 3000));
          } else {
            // Try making the input visible and using it
            await page.evaluate(() => {
              document.querySelectorAll('input[type="file"]').forEach(el => {
                el.style.opacity = '1';
                el.style.display = 'block';
                el.style.position = 'fixed';
                el.style.top = '0';
                el.style.left = '0';
                el.style.zIndex = '99999';
              });
            });
            const fileInputs2 = await page.$$('input[type="file"]');
            if (fileInputs2.length > 0) {
              await fileInputs2[fileInputs2.length - 1].uploadFile(coverPath);
              console.log('[Bot] ✅ Cover uploaded via revealed hidden input.');
              await new Promise(r => setTimeout(r, 3000));
            } else {
              console.log('[Bot] ⚠️ No file input found after clicking upload button.');
            }
          }
        } else {
          // ── Strategy 2: Slider-based frame picker — seek to 30% mark ──────────
          console.log('[Bot] No upload button found — using timeline slider to pick a clear frame...');
          const sliderMoved = await page.evaluate(() => {
            const slider = document.querySelector(
              '[role="slider"], input[type="range"], [data-test-id="video-scrubber"], [data-test-id="timeline-scrubber"]'
            );
            if (!slider) return false;
            // Set value to 30% of the range
            const min = parseFloat(slider.getAttribute('min') || '0');
            const max = parseFloat(slider.getAttribute('max') || '100');
            const target = min + (max - min) * 0.30;
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, target);
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            slider.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          });

          if (sliderMoved) {
            console.log('[Bot] ✅ Slider moved to 30% frame.');
            await new Promise(r => setTimeout(r, 1500));
          } else {
            // Try using arrow keys on focused slider
            try {
              await page.focus('[role="slider"], input[type="range"]');
              for (let k = 0; k < 3; k++) {
                await page.keyboard.press('ArrowRight');
                await new Promise(r => setTimeout(r, 200));
              }
              console.log('[Bot] ✅ Advanced slider via arrow keys.');
            } catch {}
          }
        }

        // ── Click "Done" to exit the editor and return to pin builder ──────────
        await new Promise(r => setTimeout(r, 1000));
        const doneClicked = await page.evaluate(() => {
          const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
          // Priority: "Done" > "Apply" > "Save" > "Continue"
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
    try {
      const _scDir = path.join(process.cwd(), 'public', 'logs');
      if (!fs.existsSync(_scDir)) fs.mkdirSync(_scDir, { recursive: true });
      await page.screenshot({ path: path.join(_scDir, `pre_publish_${Date.now()}.png`), fullPage: true });
    } catch (_e) {}
    
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
    try {
      if (page) {
        const screenshotPath = path.join(os.tmpdir(), 'error_screenshot.png');
        await page.screenshot({ path: screenshotPath });
        console.log(`[Bot] Saved error screenshot to ${screenshotPath}`);
      }
    } catch (e) {}
    throw new Error(`Browser Bot failed: ${error.message}`);
  } finally {
    // Cleanup temp files
    await browser.close();
    try { fs.unlinkSync(mediaPath); } catch (e) {}
    if (coverPath) { try { fs.unlinkSync(coverPath); } catch (e) {} }
  }
}


function isPinRelevant(title, description, boardName = '', fallbackMode = false, targetNiche = 'all') {
  const text = `${title} ${description}`.toLowerCase();
  const boardText = (boardName || '').toLowerCase();
  
  // STEP 1: Blacklist is the only hard reject
  const baseBlacklist = [
    'women', 'woman', 'female', 'girl', 'girls', 'ladies', 'lady', 'feminine', 'she', 'her', 'hers', 'womens', 'womenswear', 'bridal', 'bride',
    'recipe', 'food', 'cooking', 'baking', 'meal', 'dinner', 'lunch', 'breakfast', 'dessert', 'cake',
    'makeup', 'lipstick', 'nail', 'mascara', 'blush', 'foundation', 'contour', 'lashes',
    'kids', 'children', 'baby', 'toddler', 'infant', 'nursery',
    'pets', 'cat', 'dog'
  ];
  
  // Add niche-specific blacklists
  let blacklisted = [...baseBlacklist];
  if (targetNiche === 'fashion') {
      blacklisted.push('decor', 'interior', 'home', 'room', 'bedroom', 'living room', 'kitchen', 'bathroom', 'furniture', 'diy', 'craft', 'car', 'vehicle', 'tech', 'software');
  } else if (targetNiche === 'home') {
      blacklisted.push('outfit', 'streetwear', 'menswear', 'suit', 'blazer', 'sneakers', 'grooming', 'beard', 'cologne');
  }

  if (blacklisted.some(word => text.includes(word) || boardText.includes(word))) return { relevant: false, reason: 'blacklisted' };

  // STEP 2: Strict filtering based on niche
  if (targetNiche === 'fashion') {
      const fashionRelatedWords = ['outfit', 'look', 'style', 'fit', 'drip', 'fashion', 'wear', 'wardrobe', 'clothing', 'apparel', 'dressed', 'ootd', 'blazer', 'suit', 'chinos', 'sneakers', 'streetwear', 'menswear', 'dapper', 'grooming', 'beard', 'fade', 'cologne', 'loafers', 'oxford', 'tailored', 'aesthetic'];
      const menKeywords = ['men', 'man', 'male', 'guy', 'gentleman', 'menswear', 'mensstyle', 'outfit men', 'style men', 'fashion men', 'masculine', 'bro', 'him', 'mens'];

      const hasMenKeyword = menKeywords.some(w => text.includes(w) || boardText.includes(w));
      const hasFashionKeyword = fashionRelatedWords.some(w => text.includes(w) || boardText.includes(w));

      if (!hasMenKeyword || !hasFashionKeyword) {
          const strictFashionWords = ['menswear', 'dapper', 'chinos', 'blazer', 'loafers', 'streetwear', 'mensstyle', 'ootd', 'outfit', 'suit'];
          const hasStrictFashion = strictFashionWords.some(w => text.includes(w) || boardText.includes(w));
          
          if (fallbackMode && hasStrictFashion) {
              // Allowed through fallback
          } else {
              return { relevant: false, reason: 'missing strict mens or fashion identifiers' };
          }
      }
  } else if (targetNiche === 'home') {
      const homeKeywords = ['decor', 'interior', 'home', 'room', 'bedroom', 'living room', 'kitchen', 'bathroom', 'furniture', 'diy', 'craft', 'design', 'architecture', 'renovation', 'apartment', 'house'];
      const hasHomeKeyword = homeKeywords.some(w => text.includes(w) || boardText.includes(w));
      if (!hasHomeKeyword && !fallbackMode) {
          return { relevant: false, reason: 'missing home identifiers' };
      }
  }

  // STEP 3: Sub-niche detection
  const subNiches = {
    casual: ['streetwear', 'casual', 'everyday', 'weekend', 'relaxed'],
    formal: ['suit', 'tuxedo', 'blazer', 'formal', 'business', 'dapper', 'sharp'],
    streetwear: ['sneakers', 'hypebeast', 'urban', 'hype', 'drops'],
    smart_casual: ['chinos', 'oxford', 'loafers', 'smart casual', 'business casual'],
    seasonal: ['summer', 'winter', 'fall', 'spring'],
    grooming: ['beard', 'haircut', 'hairstyle', 'fade', 'lineup', 'grooming'],
    accessories: ['watch', 'chain', 'belt', 'sunglasses', 'rings'],
    luxury: ['designer', 'gucci', 'louis vuitton', 'luxury'],
    athletic: ['gym', 'athletic', 'workout'],
    cultural: ['korean', 'italian', 'african', 'japan']
  };

  let detectedSubNiche = 'casual';
  let matchCount = 0;
  for (const [niche, keywords] of Object.entries(subNiches)) {
    let hits = keywords.filter(k => text.includes(k) || boardText.includes(k)).length;
    if (hits > 0) {
      if (hits > matchCount) {
        matchCount = hits;
        detectedSubNiche = niche;
      }
    }
  }

  if (fallbackMode && targetNiche === 'fashion' && (!hasMenKeyword || !hasFashionKeyword)) {
      return { relevant: true, subNiche: detectedSubNiche, matchCount: 1, reason: 'fallback_mode' };
  }

  return { relevant: true, subNiche: detectedSubNiche, matchCount, reason: 'matched' };
}

function scorePin(pinData, matchCount) {
  let score = 0;
  if (pinData.saves > 50) score += 20;
  if (pinData.desc && pinData.desc.split(' ').length > 30) score += 15;
  if (pinData.comments > 0) score += 10;
  if (matchCount >= 2) score += 10;
  if (!pinData.desc || pinData.desc.trim().length === 0) score -= 20;
  return score;
}

async function runAutoEngagerSafe(options = {}) {
  const sessionCookie = await getActiveSessionCookie();
  if (!sessionCookie) throw new Error('PINTEREST_SESSION_COOKIE is missing. Link a session in Settings.');
  const context = resolveEngagementContext(options.context || {});

  const automationState = await historyService.getAutomationState();
  let { likesToday = 0, commentsToday = 0, savesToday = 0, engagedUrls = [], circuitBreaker } = automationState;
  
  if (circuitBreaker && new Date(circuitBreaker).getTime() > Date.now()) {
    console.log(`[Bot] Circuit breaker active until ${new Date(circuitBreaker).toLocaleString()}. Skipping engagement.`);
    return { success: false, message: 'Circuit breaker active.' };
  }

  const DAILY_MAX_LIKES = 25;
  const DAILY_MAX_COMMENTS = 12;
  const DAILY_MAX_SAVES = 8;
  
  if (likesToday >= DAILY_MAX_LIKES && commentsToday >= DAILY_MAX_COMMENTS) {
    console.log('[Bot] Daily hard caps reached. Exiting.');
    return { success: true, message: 'Daily caps reached.' };
  }

  console.log(`[Bot] Starting strict hourly engagement mode.`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1920,1080', '--disable-gpu']
  });

  try {
    const page = await browser.newPage();
    page.on('console', msg => { if (!msg.text().includes('Failed to load resource')) console.log(`[Bot-Browser] ${msg.text()}`); });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setCookie({ name: '_pinterest_sess', value: sessionCookie, domain: '.pinterest.com', path: '/', secure: true, httpOnly: true });

    const targetNiche = options.niche || 'all';
    let targetBoards = ["Men's Style Guide", "Gentleman's Wardrobe", "Streetwear Men", "Suits and Formal Men", "Men's Outfits", "Menswear Inspiration"];
    
    if (targetNiche === 'home') {
      targetBoards = ["Home Decor", "Interior Design", "Living Room Ideas", "Minimalist Home", "Cozy Bedroom"];
    } else if (targetNiche === 'all') {
      targetBoards = [...targetBoards, "Home Decor", "Interior Design", "Tech Gadgets", "Luxury Cars"];
    }
    let feedUrl = 'https://www.pinterest.com/homefeed/';
    
    // 60% home feed, 40% direct board
    if (Math.random() < 0.4) {
      const board = targetBoards[Math.floor(Math.random() * targetBoards.length)];
      feedUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(board)}`;
      console.log(`[Bot] Routing to specific board search: ${board}`);
    } else {
      console.log(`[Bot] Routing to home feed.`);
    }

    await page.goto(feedUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    let hourlyLikes = 0;
    let hourlyComments = 0;
    let cycle = 0;
    const maxCycles = 50; 
    let loadMultiplier = 1;

    // The session is complete ONLY when BOTH minimums are true (unless hard caps hit).
    while ((hourlyLikes < 5 || hourlyComments < 3) && cycle < maxCycles) {
      cycle++;
      
      if (likesToday >= DAILY_MAX_LIKES && commentsToday >= DAILY_MAX_COMMENTS) {
          console.log('[Bot] Daily caps hit mid-session.');
          break;
      }

      console.log(`[Bot] Target Loop ${cycle} | Hourly: ${hourlyLikes}/5 Likes, ${hourlyComments}/3 Comments`);

      const pinLinks = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/pin/"]')).map(a => a.href);
        return [...new Set(links)].filter(l => !l.includes('/pin/pin-builder/'));
      });

      const unengagedLinks = pinLinks.filter(l => !engagedUrls.some(e => l.includes(e)));

      if (!unengagedLinks.length) {
        console.log('[Bot] No fresh pins found, scrolling deeper...');
        await page.evaluate(() => window.scrollBy(0, 1500));
        await sleep(randomInt(3000, 5000) * loadMultiplier);
        
        if (cycle > 5 && cycle % 3 === 0) {
            console.log('[Bot] Mid-session route switch to find more pins...');
            const board = targetBoards[Math.floor(Math.random() * targetBoards.length)];
            await page.goto(`https://www.pinterest.com/search/pins/?q=${encodeURIComponent(board)}`, { waitUntil: 'networkidle2', timeout: 45000 });
            await sleep(5000 * loadMultiplier);
        }
        continue;
      }

      const randomPin = unengagedLinks[randomInt(0, unengagedLinks.length - 1)];
      console.log(`[Bot] Viewing pin: ${randomPin}`);
      
      const loadStart = Date.now();
      const response = await page.goto(randomPin, { waitUntil: 'networkidle2', timeout: 45000 });
      if (response && response.status() === 429) {
          console.log('[Bot] HTTP 429 Too Many Requests detected. Triggering 2-hour circuit breaker.');
          await historyService.setAutomationState({ ...automationState, circuitBreaker: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() });
          break;
      }
      
      if (Date.now() - loadStart > 8000) {
          console.log('[Bot] Page loaded slowly, increasing delays by 50%.');
          loadMultiplier = 1.5;
      }

      // Check for login redirect / cookie expiration
      if ((await page.url()).includes('login')) {
          console.log('[Bot] Redirected to login. Session cookie expired. Triggering circuit breaker.');
          await historyService.setAutomationState({ ...automationState, circuitBreaker: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
          break;
      }

      await sleep(randomInt(2000, 5000) * loadMultiplier); // Read time

      const pinData = await page.evaluate(() => {
        const titleEls = document.querySelectorAll('h1, [data-test-id="pinTitle"]');
        let title = '';
        for (const el of titleEls) {
          if (el.innerText && el.innerText.trim() !== 'Pinterest' && el.innerText.trim() !== 'Explore') {
            title = el.innerText.trim();
            break;
          }
        }
        
        const descEls = document.querySelectorAll('[data-test-id="pin-description-text"], .TP9, ._8n, [data-test-id="pinDescription"]');
        let desc = '';
        for (const el of descEls) {
          if (el.innerText && el.innerText.trim() !== '') {
            desc += ' ' + el.innerText.trim();
          }
        }
        
        const images = document.querySelectorAll('img[src*="pinimg"]');
        for (const img of images) {
          if (img.alt) desc += ' ' + img.alt;
        }

        const comments = document.querySelectorAll('[data-test-id="comment-container"]').length;
        
        const boardEls = document.querySelectorAll('a[href*="/board/"], [data-test-id="board-title"], [data-test-id="board-name"], [data-test-id="SaveButton"]');
        let boardName = '';
        for (const el of boardEls) {
            const txt = el.innerText ? el.innerText.trim() : '';
            if (txt && !['Save', 'Saved', 'Profile'].includes(txt)) {
                boardName += ' ' + txt;
            }
        }
        
        if (!title) {
            title = document.querySelector('meta[property="og:title"]')?.content || '';
        }
        if (!desc.trim()) {
            desc += ' ' + (document.querySelector('meta[property="og:description"]')?.content || '');
        }

        return { title: title.trim(), desc: desc.trim(), saves: 0, comments, boardName: boardName.trim() };
      });

      console.log(`[Bot] Extracted -> Title: "${pinData.title}" | Desc: "${pinData.desc.substring(0, 50)}..." | Board: "${pinData.boardName}"`);

      const fallbackMode = cycle > 10;
      const relevancy = isPinRelevant(pinData.title, pinData.desc, pinData.boardName, fallbackMode, targetNiche);
      if (!relevancy.relevant) {
        console.log(`[Bot] ⏭️ Skipped irrelevant pin: "${pinData.title}" Reason: ${relevancy.reason}`);
        continue;
      }

      const score = scorePin(pinData, relevancy.matchCount);
      const isUrgent = hourlyLikes < 5 || hourlyComments < 3;
      if (score < 40 && !isUrgent && relevancy.reason !== 'fallback_mode') {
          console.log(`[Bot] ⏭️ Skipped due to low score (${score}) and minimums are met.`);
          continue;
      }

      console.log(`[Bot] ✅ Pin relevant (Score: ${score}, Sub-niche: ${relevancy.subNiche}, Reason: ${relevancy.reason}). Engaging...`);

      // 1. Like
      let liked = false;
      if (likesToday < DAILY_MAX_LIKES && hourlyLikes < 5 || Math.random() > 0.5) {
          try {
            const reactionBtn = await page.$('button[aria-label="React"], button[aria-label="react"], button[data-test-id="pin-rep-reaction-button"]');
            if (reactionBtn) {
              await reactionBtn.click();
              console.log('[Bot] ❤️ Liked pin');
              liked = true;
              hourlyLikes++;
              likesToday++;
              await sleep(randomInt(18000, 90000) * loadMultiplier); // Human delay 18-90s
            }
          } catch(e) {}
      }

      // 2. Comment
      let commented = false;
      let theComment = '';
      if (commentsToday < DAILY_MAX_COMMENTS && (hourlyComments < 3 || Math.random() > 0.5)) {
          try {
              console.log(`[Bot] Generating comment for sub-niche: ${relevancy.subNiche}`);
              theComment = await aiService.generateEngagementComment({
                  title: pinData.title,
                  description: pinData.desc,
                  subNiche: relevancy.subNiche
              });

              // Click comment box
              const openBtn = await page.$('button[aria-label="Comments"], [data-test-id="community-comment-button"]');
              if (openBtn) await openBtn.click();
              await sleep(1500 * loadMultiplier);

              const commentBox = await page.$('div[aria-label="Add a comment"], [data-test-id="comment-composer"], input[placeholder="Add a comment"], [data-test-id="comment-input-box"]');
              if (commentBox) {
                  await commentBox.click();
                  await sleep(randomInt(1000, 2000));
                  
                  // Type with character delays 80-200ms
                  await page.keyboard.type(theComment, { delay: randomInt(80, 200) });
                  await sleep(randomInt(1000, 2000));
                  
                  const postBtn = await page.$('button[aria-label="Post"], [data-test-id="comment-submit-button"], button[data-test-id="done-button"]');
                  if (postBtn && !(await page.evaluate(el => el.disabled, postBtn))) {
                      await postBtn.click();
                      await sleep(randomInt(4000, 7000));
                      console.log(`[Bot] 💬 Commented: "${theComment}"`);
                      commented = true;
                      hourlyComments++;
                      commentsToday++;
                      await sleep(randomInt(45000, 120000) * loadMultiplier); // Human delay 45-120s
                  }
              }
          } catch(e) {}
      }

      // 3. Save (optional)
      let saved = false;
      if (savesToday < DAILY_MAX_SAVES && Math.random() > 0.7) {
          try {
            const saveBtn = await page.$('button[aria-label="Save"], button[data-test-id="pin-save-button"]');
            if (saveBtn) {
                await saveBtn.click();
                console.log('[Bot] 📌 Saved pin');
                saved = true;
                savesToday++;
                await sleep(randomInt(5000, 10000) * loadMultiplier);
            }
          } catch(e) {}
      }

      // Record History
      const actionParts = [];
      if (liked) actionParts.push('Liked');
      if (commented) actionParts.push('Commented');
      if (saved) actionParts.push('Saved');
      const actionTaken = actionParts.length ? actionParts.join(' & ') : 'Viewed';

      await historyService.addEngagement({
        url: randomPin,
        action: actionTaken,
        comment: commented ? theComment : '',
        source: context.source,
        command: context.command,
        workflow: context.workflow,
        actor: context.actor,
        engagedAt: new Date().toISOString(),
      });
      
      engagedUrls.push(randomPin.split('?')[0]);
      
      // Update state live
      await historyService.setAutomationState({ ...automationState, likesToday, commentsToday, savesToday, engagedUrls });

      // Between scrolling and clicking wait 3-8s for next cycle
      await sleep(randomInt(3000, 8000) * loadMultiplier);
      
      // Back to feed
      await page.goto(feedUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    }

    console.log(`[Bot] Hourly run complete. Achieved ${hourlyLikes} Likes, ${hourlyComments} Comments.`);
    return { success: true, message: `Achieved ${hourlyLikes} likes, ${hourlyComments} comments.` };
    
  } catch (error) {
    console.error('[Bot] Strict engager failed:', error.message);
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

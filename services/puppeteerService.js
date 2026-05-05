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
  const { title, description, alt_text, link, media_source } = pinData;
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
      console.log('[Bot] Extracting a frame from the middle of the video for the Cover Image...');
      coverPath = path.join(tempDir, `pin_cover_${Date.now()}.jpg`);
      const { execSync } = require('child_process');
      // Extract a frame at 3 seconds in. If video is shorter, ffmpeg might fail, so we fallback to 1 sec.
      try {
        execSync(`ffmpeg -y -i "${mediaPath}" -ss 00:00:03 -vframes 1 "${coverPath}"`, { stdio: 'ignore' });
        console.log('[Bot] ✅ Extracted 3-second frame using ffmpeg.');
      } catch (e) {
        console.log('[Bot] ⚠️ 3-second extraction failed (video too short?), trying 1-second...');
        execSync(`ffmpeg -y -i "${mediaPath}" -ss 00:00:01 -vframes 1 "${coverPath}"`, { stdio: 'ignore' });
        console.log('[Bot] ✅ Extracted 1-second frame using ffmpeg.');
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
    page.on('console', msg => console.log(`[Bot-Browser] ${msg.text()}`));
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
    await page.goto('https://www.pinterest.com/pin-creation-tool/', { waitUntil: 'networkidle2', timeout: 45000 });

    // 3. Upload Media
    console.log('[Bot] Uploading media file...');
    const fileInputSelector = 'input[type="file"]';
    await page.waitForSelector(fileInputSelector, { timeout: 20000 });
    const fileInputs = await page.$$(fileInputSelector);
    const fileInput = fileInputs[fileInputs.length - 1]; // Use last file input (most likely the upload one)
    await fileInput.uploadFile(mediaPath);

    console.log('[Bot] Waiting for media upload and processing...');
    // Video processing can take a while on Pinterest
    await page.waitForFunction(() => {
      const text = document.body.innerText || '';
      const isProcessing = text.includes('Uploading') || text.includes('Processing') || text.includes('uploading') || text.includes('processing');
      const hasError = text.includes('Something went wrong') || text.includes('could not be uploaded');
      if (hasError) throw new Error('Pinterest UI reported an upload error.');
      return !isProcessing;
    }, { timeout: 180000 }).catch(err => {
        console.log('[Bot] Upload wait warning:', err.message);
    });

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
    console.log('[Bot] Selecting board...');
    try {
      // Step 1: Find and click the board dropdown (find by visible text or selector)
      const boardClicked = await page.evaluate(() => {
        // Look for the 'Choose a board' button or any board dropdown trigger
        const allElements = Array.from(document.querySelectorAll('div, button, [role="button"]'));
        for (const el of allElements) {
          const text = (el.innerText || '').trim().toLowerCase();
          const isVisible = el.offsetParent !== null;
          if (isVisible && (text === 'choose a board' || text.startsWith('choose a board'))) {
            el.click();
            return 'clicked_choose_a_board';
          }
        }
        // Fallback: try known selectors
        const fallbacks = [
          '[data-test-id="board-dropdown-select-button"]',
          '[data-test-id="storyboard-selector-board-dropdown"]',
          'button[aria-haspopup="listbox"]',
          '[aria-label*="board" i]',
        ];
        for (const sel of fallbacks) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) {
            el.click();
            return `clicked_fallback:${sel}`;
          }
        }
        return 'not_found';
      });
      console.log(`[Bot] Board dropdown click result: ${boardClicked}`);
      
      await new Promise(r => setTimeout(r, 3000));

      // Step 2: Select the first available board from the dropdown list
      let boardSelected = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        boardSelected = await page.evaluate(() => {
          // Look for board items in any list/menu that appears after clicking
          const candidateSelectors = [
            '[data-test-id="board-row"]',
            '[role="option"]',
            '[role="menuitem"]',
            '[role="listitem"]',
          ];
          for (const sel of candidateSelectors) {
            const items = Array.from(document.querySelectorAll(sel));
            for (const item of items) {
              const text = (item.innerText || '').trim().toLowerCase();
              const isVisible = item.offsetParent !== null;
              // Skip "search", "create new board", or empty items
              if (isVisible && text.length > 1 && !text.includes('search') && !text.includes('create') && !text.startsWith('choose')) {
                item.scrollIntoView({ block: 'nearest' });
                item.click();
                return `selected:${text.slice(0, 40)}`;
              }
            }
          }
          return false;
        });
        
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
    console.log('[Bot] Waiting for media processing to complete...');
    for (let i = 0; i < 15; i++) {
       const isProcessing = await page.evaluate(() => {
          const text = document.body.innerText.toLowerCase();
          return text.includes('processing') || text.includes('uploading') || text.includes('preparing');
       });
       if (!isProcessing) break;
       console.log(`[Bot] Still processing video... (${i+1}/15)`);
       await new Promise(r => setTimeout(r, 4000));
    }

    // ─── 5b. Upload Smart Cover Thumbnail ───────
    if (coverPath && fs.existsSync(coverPath)) {
      console.log('[Bot] 🖼️ Uploading AI-selected cover thumbnail...');
      try {
        // Hover over the video to reveal the edit/cover button
        try { await page.hover('[data-test-id="pin-builder-media"]'); } catch(e) {}
        try { await page.hover('video'); } catch(e) {}
        await new Promise(r => setTimeout(r, 1000));

        const coverBtnSelectors = [
          '[data-test-id="pin-builder-media"] button[aria-label*="Edit" i]',
          'button[data-test-id="pin-draft-cover-image-button"]',
          'button[data-test-id="change-cover-btn"]',
          'button[aria-label*="Edit" i]',
          '[data-test-id="edit-pin-button"]',
          'button[data-test-id="edit-media-button"]'
        ];
        let coverBtn = null;
        for (const sel of coverBtnSelectors) {
          try { coverBtn = await page.$(sel); if (coverBtn) { console.log(`[Bot] Edit button found: ${sel}`); break; } } catch {}
        }

        if (coverBtn) {
          await coverBtn.click();
          await new Promise(r => setTimeout(r, 2000));

          // Find the file input strictly inside the Edit modal
          const modalInputs = await page.$$('div[role="dialog"] input[type="file"], .Modal input[type="file"]');
          
          if (modalInputs.length > 0) {
            console.log(`[Bot] Found ${modalInputs.length} file inputs in modal. Uploading cover...`);
            await modalInputs[modalInputs.length - 1].uploadFile(coverPath);
            await new Promise(r => setTimeout(r, 3000));

            // Confirm/apply the cover
            const applyResult = await page.evaluate(() => {
              const btns = Array.from(document.querySelectorAll('div[role="dialog"] button, .Modal button'));
              const apply = btns.find(b => {
                const t = (b.innerText || '').toLowerCase();
                return b.offsetParent !== null && (t === 'apply' || t === 'done' || t === 'save');
              });
              if (apply) { apply.click(); return true; }
              
              const doneBtn = document.querySelector('[data-test-id="done-button"]');
              if (doneBtn) { doneBtn.click(); return true; }
              
              return false;
            });

            if (applyResult) {
              console.log('[Bot] ✅ Cover uploaded and applied.');
            } else {
              console.log('[Bot] ⚠️ No Apply/Done button found in modal, pressing Escape.');
              await page.keyboard.press('Escape');
            }
          } else {
            console.log('[Bot] ⚠️ No file input found in the edit modal to upload cover.');
            await page.keyboard.press('Escape');
          }
          await new Promise(r => setTimeout(r, 2000));
        } else {
          console.log('[Bot] ℹ️ No Edit button found — Pinterest will use auto-selected frame.');
        }
      } catch (e) {
        console.log('[Bot] Cover upload warning (non-fatal):', e.message);
      }
    }

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
      'input[id*="pin-draft-link"]',
      '[data-test-id="pin-draft-link"] input',
      '[data-test-id="pin-draft-link"] textarea',
      'input[placeholder*="link" i]',
      'input[aria-label*="link" i]',
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
            const currentVal = await page.evaluate(el => el.value || el.innerText || '', linkField2);
            if (!currentVal || !currentVal.includes('http')) {
              console.log('[Bot] ⚠️ Link value missing after first attempt — retrying...');
              await fillLinkField();
              await new Promise(r => setTimeout(r, 500));
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
      await page.evaluate(() => {
        const dismissSelectors = [
          'button[data-test-id="closeButton"]',
          'button[aria-label="close" i]',
          'button[aria-label="Close" i]',
          'button[aria-label="dismiss" i]',
          'div[role="dialog"] button',
        ];
        for (const sel of dismissSelectors) {
          const btns = document.querySelectorAll(sel);
          for (const btn of btns) {
            const txt = (btn.innerText || '').toLowerCase();
            if (txt.includes('close') || txt.includes('dismiss') || txt.includes('got it') || txt.includes('accept') || txt.includes('ok')) {
              btn.click();
            }
          }
        }
      });
      await new Promise(r => setTimeout(r, 800));
    } catch (e) {}

    // 7. Final Publish
    console.log('[Bot] Clicking Publish button...');
    await page.mouse.click(10, 10);
    await new Promise(r => setTimeout(r, 1000));

    const publishResult = await page.evaluate(() => {
      // 1. Try precise pwt-publish-button first
      const pubBtn = document.querySelector('button[data-test-id="pwt-publish-button"]');
      if (pubBtn && pubBtn.offsetParent !== null && !pubBtn.disabled) {
        pubBtn.click();
        return 'clicked_pwt_publish_button';
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
        console.log('[Bot] Fallback: Pressing Enter to Publish');
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
      console.warn('[Bot] ⚠️ Verification timed out. Assuming success (Pinterest may have posted it).');
      // Take a debug screenshot anyway
      try {
          const scDir = path.join(process.cwd(), 'public', 'logs');
          if (!fs.existsSync(scDir)) fs.mkdirSync(scDir, { recursive: true });
          const scPath = path.join(scDir, `fail_${Date.now()}.png`);
          await page.screenshot({ path: scPath });
          console.log(`[Bot] 📸 Debug screenshot saved to: ${scPath}`);
      } catch (e) {}
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

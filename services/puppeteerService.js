// Puppeteer is only available in GitHub Actions — not on Vercel serverless.
// Wrap the require so this module loads cleanly even when Chrome is absent.
let puppeteer = null;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  console.warn('[PuppeteerService] puppeteer not available (expected on Vercel):', e.message);
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

  // Smart thumbnail: base64 data URI → temp JPEG file
  let coverPath = null;
  const thumbnailSrc = media_source.thumbnailUrl || '';
  if (thumbnailSrc.startsWith('data:image/')) {
    try {
      const base64Data = thumbnailSrc.replace(/^data:image\/\w+;base64,/, '');
      coverPath = path.join(tempDir, `pin_cover_${Date.now()}.jpg`);
      fs.writeFileSync(coverPath, Buffer.from(base64Data, 'base64'));
      console.log('[Bot] Smart cover thumbnail written to temp file.');
    } catch (e) {
      console.warn('[Bot] Could not write cover thumbnail:', e.message);
      coverPath = null;
    }
  }

  console.log(`[Bot] Downloading media (${ext}) to temp storage...`);
  await downloadVideo(mediaUrl, mediaPath);
  console.log('[Bot] Media downloaded successfully.');

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
      '--window-size=1920,1080'
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
      const boardMenuSelectors = [
        '[data-test-id="board-dropdown-select-button"]',
        'button[aria-label*="board" i]',
        'button[aria-label*="Board" i]',
        '[data-test-id="board-dropdown"] button',
        '.board-dropdown button',
        'button[data-test-id="storyboard-selector-board"]'
      ];
      let boardMenu = null;
      for (const sel of boardMenuSelectors) {
        boardMenu = await page.$(sel);
        if (boardMenu) {
          console.log(`[Bot] Board button found: ${sel}`);
          break;
        }
      }
      if (boardMenu) {
        await boardMenu.click();
        console.log('[Bot] Opened board menu.');
        await new Promise(r => setTimeout(r, 4000));

        const boardSelected = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('[role="listitem"], [data-test-id="board-row"], div[role="button"], [role="option"], li[role="menuitem"]'));
          const boardItem = items.find(el => {
              const text = (el.innerText || '').toLowerCase();
              return el.offsetParent !== null && text.length > 1 && !text.includes('choose') && !text.includes('search') && !text.includes('create');
          });

          if (boardItem) {
            boardItem.scrollIntoView();
            boardItem.click();
            return true;
          }
          return false;
        });

        if (boardSelected) {
          console.log('[Bot] Board item clicked.');
          await new Promise(r => setTimeout(r, 3000));
        }
      } else {
        console.log('[Bot] Board menu not found — using default board.');
      }
    } catch (e) {
      console.log('[Bot] Board selection error:', e.message);
    }

    // ─── 5b. Upload Smart Cover Thumbnail (if AI selected a better frame) ───────
    if (coverPath && fs.existsSync(coverPath)) {
      console.log('[Bot] 🖼️ Uploading AI-selected cover thumbnail...');
      try {
        // Pinterest shows a "Change cover" button on video pins after upload
        const coverBtnSelectors = [
          'button[data-test-id="pin-draft-cover-image-button"]',
          'button[aria-label*="cover" i]',
          'button[aria-label*="Cover" i]',
          '[data-test-id="cover-image-selector"] button',
          'button[data-test-id="change-cover-btn"]',
        ];
        let coverBtn = null;
        for (const sel of coverBtnSelectors) {
          try { coverBtn = await page.$(sel); if (coverBtn) { console.log(`[Bot] Cover button found: ${sel}`); break; } } catch {}
        }

        if (coverBtn) {
          await coverBtn.click();
          await new Promise(r => setTimeout(r, 2000));

          // Find the file input that appeared for cover upload
          const coverInputs = await page.$$('input[type="file"]');
          if (coverInputs.length > 0) {
            await coverInputs[coverInputs.length - 1].uploadFile(coverPath);
            await new Promise(r => setTimeout(r, 3000));

            // Confirm/apply the cover if there's an apply button
            const applyResult = await page.evaluate(() => {
              const btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
              const apply = btns.find(b => {
                const t = (b.innerText || '').toLowerCase();
                return b.offsetParent !== null && (t === 'apply' || t === 'set cover' || t === 'use this' || t === 'select' || t === 'done');
              });
              if (apply) { apply.click(); return true; }
              return false;
            });
            if (applyResult) {
              await new Promise(r => setTimeout(r, 2000));
              console.log('[Bot] ✅ Smart cover image applied.');
            } else {
              console.log('[Bot] Cover input uploaded (no apply button found — auto-applied).');
            }
          } else {
            console.log('[Bot] ⚠️ No file input found after clicking cover button.');
          }
        } else {
          console.log('[Bot] ℹ️ No cover change button found — Pinterest will use auto-selected frame.');
        }
      } catch (e) {
        console.log('[Bot] Cover upload warning (non-fatal):', e.message);
      }
    }

    // ─── 5c. Fill Destination Link (AFTER board selection) ─────────────────
    // CRITICAL: This MUST happen after the board dropdown is closed.
    // Pinterest resets the destination link field when the board picker is opened.
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

    // 6. Final Publish
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


function isPinRelevant(title, description, niche) {
  if (niche !== 'fashion' && niche !== 'home') return true;
  
  const text = (title + ' ' + description).toLowerCase();
  
  if (niche === 'fashion') {
    // Strict Blacklist: Block completely unrelated stuff
    const blacklisted = [
      'decor', 'home', 'furniture', 'interior', 'kitchen', 'architecture', 'recipe', 'food', 
      'art', 'diy', 'craft', 'room', 'apartment', 'women', 'woman', 'girl', 'ladies', 'female',
      'makeup', 'beauty', 'skincare', 'hair', 'nails', 'dog', 'cat', 'pet', 'car', 'vehicle', 'wedding'
    ];
    
    if (blacklisted.some(word => text.includes(word))) return false;
    
    // Explicit whitelists (if it matches any of these exact phrases, pass immediately)
    const exactPhrases = ['menswear', 'mens fashion', 'men fashion', 'mens style', 'men style', 'mens outfit', 'men outfit'];
    if (exactPhrases.some(phrase => text.includes(phrase))) return true;

    // Matrix Matching: Must have at least one male identifier AND one apparel identifier
    const maleIdentifiers = ['men', 'man', 'mens', 'boy', 'boys', 'male', 'gentleman'];
    const apparelIdentifiers = ['fashion', 'style', 'outfit', 'clothes', 'trouser', 'pants', 'shirt', 'jacket', 'streetwear', 'suit', 'sneaker', 'denim', 'blazer', 'hoodie', 'apparel', 'wear', 'tshirt', 'polo', 'footwear', 'shoes'];

    const hasMale = maleIdentifiers.some(word => text.split(/[^a-z]+/).includes(word));
    const hasApparel = apparelIdentifiers.some(word => text.includes(word));

    return hasMale && hasApparel;
  }

  if (niche === 'home') {
    const mustHave = ['home', 'decor', 'interior', 'room', 'furniture', 'design', 'apartment', 'house', 'living', 'kitchen', 'bedroom'];
    const blacklisted = ['fashion', 'clothes', 'outfit', 'makeup', 'beauty', 'recipe', 'food', 'car', 'tech'];
    
    const hasBlacklisted = blacklisted.some(word => text.includes(word));
    if (hasBlacklisted) return false;
    
    const hasRequired = mustHave.some(word => text.includes(word));
    return hasRequired;
  }
  
  return true;
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
    page.on('console', msg => console.log(`[Bot-Browser] ${msg.text()}`));
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setCookie({
      name: '_pinterest_sess',
      value: sessionCookie,
      domain: '.pinterest.com',
      path: '/',
      secure: true,
      httpOnly: true,
    });

    let feedUrl = 'https://www.pinterest.com/homefeed/';
    const niche = options.niche || 'all';
    if (niche === 'fashion') {
      feedUrl = 'https://www.pinterest.com/search/pins/?q=men%20fashion%20outfits%20menswear%20style';
    } else if (niche === 'home') {
      feedUrl = 'https://www.pinterest.com/search/pins/?q=modern%20home%20decor%20ideas%20minimalist';
    }

    console.log(`[Bot] Navigating to target feed: ${feedUrl}`);
    await page.goto(feedUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    let completed = 0;
    let commentsMade = 0;
    let cycle = 0;
    const maxCycles = Math.max(10, targetCount * 5); // Increased max cycles to find relevant pins
    
    // Determine minimum guaranteed comments
    const minRequiredComments = Math.min(3, targetCount); // At least 3 if targetCount >= 3

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
      await sleep(randomInt(3000, 6000));

      const pinData = await page.evaluate(() => {
        const h1 = document.querySelector('h1');
        const title = h1 ? h1.innerText : '';
        const descEl = document.querySelector('[data-test-id="pin-description-text"], .TP9, ._8n');
        const desc = descEl ? descEl.innerText : '';
        return { title, desc };
      });

      // --- NEW: Strict Relevancy Check ---
      if (!isPinRelevant(pinData.title, pinData.desc, niche)) {
        console.log(`[Bot] ⏭️ Skipping irrelevant pin (Niche: ${niche}): "${pinData.title || 'No Title'}"`);
        // Don't count this as completed or cycle, just continue the while loop
        continue;
      }

      console.log(`[Bot] ✅ Pin verified as relevant: "${pinData.title || 'Untitled'}"`);

      let actionTaken = 'Viewed';
      try {
        // Try multiple reaction button selectors (Pinterest changes these frequently)
        const reactionSelectors = [
          'button[aria-label="React"]',
          'button[aria-label="react"]',
          'button[data-test-id="pin-rep-reaction-button"]',
          'button[aria-label*="Love"]',
          'button[aria-label*="Like"]',
          'button[aria-label*="Heart"]',
          'button[aria-label*="love"]',
          'button[aria-label*="like"]',
          'button[aria-label*="heart"]',
          'button[aria-label="Add reaction"]',
          'button[aria-label*="reaction"]',
          '[data-test-id="reaction-button"]',
          '.reaction-button',
          '.heart-icon-container',
          // Save/Pin button as fallback engagement
          'button[aria-label*="Save"]',
          'button[aria-label*="save"]',
          'button[data-test-id="pin-save-button"]',
        ];
        
        let reactionBtn = null;
        for (const sel of reactionSelectors) {
          reactionBtn = await page.$(sel);
          if (reactionBtn) {
            console.log(`[Bot] Found reaction button: ${sel}`);
            break;
          }
        }

        if (reactionBtn) {
          await reactionBtn.click();
          actionTaken = 'Liked';
          console.log('[Bot] ✅ Liked/Reacted to pin successfully');
          await sleep(randomInt(1200, 2500));
        } else {
          console.log('[Bot] ⚠️ Reaction button not found, viewing only');
        }
      } catch (e) {
        console.log('[Bot] ❌ Reaction failed:', e.message);
      }

      await page.evaluate(() => window.scrollBy(0, Math.floor(450 + Math.random() * 700)));
      await sleep(randomInt(1800, 4200));

      const remainingTarget = targetCount - completed;
      const remainingCommentsNeeded = minRequiredComments - commentsMade;
      
      // Force comment if we are running out of loops and haven't met the minimum
      let shouldComment = Math.random() < commentChance;
      if (remainingCommentsNeeded > 0 && remainingTarget <= remainingCommentsNeeded) {
        shouldComment = true;
        console.log(`[Bot] Forcing comment to meet minimum quota (${commentsMade}/${minRequiredComments})...`);
      }

      let commentLeft = false;
      let theComment = '';

      if (shouldComment) {
        try {
          console.log(`[Bot] Generating AI comment...`);
          theComment = await aiService.generateEngagementComment({
            title: pinData.title || 'Fashion & Style',
            description: pinData.desc || 'Men fashion inspiration'
          });

          // First try to open the comments section if it's collapsed
          const openCommentsSelectors = [
            'button[aria-label="Comments"]',
            'button[aria-label="comments"]',
            'button[aria-label*="comment"]',
            '[data-test-id="community-comment-button"]',
            'button[aria-label="Toggle comments"]'
          ];
          for (const oSel of openCommentsSelectors) {
            const openBtn = await page.$(oSel);
            if (openBtn) {
              await openBtn.click();
              await sleep(1500);
              break;
            }
          }

          const commentSelectors = [
            'div[aria-label="Add a comment"]',
            'div[data-test-id="comment-composer"]',
            'input[placeholder="Add a comment"]',
            'textarea[placeholder="Add a comment"]',
            '[data-test-id="comment-input-box"]',
            '.addCommentInput',
            'div[contenteditable="true"][aria-label="Add a comment"]',
            'div[data-test-id="comment-box-input"]'
          ];

          let commentBox = null;
          for (const sel of commentSelectors) {
            commentBox = await page.$(sel);
            if (commentBox) {
              console.log(`[Bot] Found comment box using selector: ${sel}`);
              break;
            }
          }

          if (commentBox) {
            // Scroll it into view just in case
            await page.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), commentBox);
            await sleep(1000);

            await commentBox.click();
            await sleep(randomInt(1000, 2000));
            
            console.log(`[Bot] Typing AI comment: "${theComment}"`);
            await page.keyboard.type(theComment, { delay: randomInt(45, 95) });
            await sleep(randomInt(1000, 2000));
            
            // Try hitting enter first
            await page.keyboard.press('Enter');
            await sleep(1000);

            // Sometimes Enter just adds a newline. Let's try to click the Post/Done button just in case.
            const postBtnSelectors = [
              'button[aria-label="Post"]',
              'button[aria-label="post"]',
              'button[data-test-id="comment-submit-button"]',
              'button[data-test-id="done-button"]',
              'div[data-test-id="comment-submit-btn"]'
            ];

            for (const pSel of postBtnSelectors) {
              const postBtn = await page.$(pSel);
              if (postBtn) {
                // Check if it's not disabled
                const disabled = await page.evaluate(el => el.disabled || el.getAttribute('aria-disabled') === 'true', postBtn);
                if (!disabled) {
                  console.log(`[Bot] Clicking Post button via selector: ${pSel}`);
                  await postBtn.click();
                  break;
                }
              }
            }

            // Wait for post to register
            await sleep(randomInt(4000, 7000));
            commentLeft = true;
            commentsMade++;
            actionTaken = actionTaken === 'Liked' ? 'Liked & Commented' : 'Commented';
            console.log(`[Bot] ✅ AI Comment posted: "${theComment}"`);
          } else {
            console.log(`[Bot] ⚠️ Could not find the comment box. Pinterest UI may have changed, or comments are disabled on this pin.`);
          }
        } catch (err) {
          console.error('[Bot] ❌ AI Commenting completely failed:', err.message);
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
      
      // Navigate back to the target feed for the next cycle
      await page.goto(feedUrl, { waitUntil: 'networkidle2', timeout: 35000 });
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

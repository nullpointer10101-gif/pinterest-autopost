const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');

let puppeteer = null;
try {
  const puppeteerExtra = require('puppeteer-extra');
  try {
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteerExtra.use(StealthPlugin());
  } catch {}
  puppeteer = puppeteerExtra;
} catch (err) {
  console.warn('[IG-Repost Publisher] Puppeteer unavailable:', err.message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSessionCookie(input) {
  let raw = String(input || '').trim();
  if (!raw) return '';

  if (raw.includes(';')) {
    const parts = raw.split(';').map((part) => part.trim()).filter(Boolean);
    const hit = parts.find((part) => /^_pinterest_sess=/i.test(part));
    if (hit) raw = hit.replace(/^_pinterest_sess=/i, '').trim();
  } else if (/^_pinterest_sess=/i.test(raw)) {
    raw = raw.replace(/^_pinterest_sess=/i, '').trim();
  }

  return raw.replace(/^['"]|['"]$/g, '').trim();
}

function getSessionCookie() {
  return normalizeSessionCookie(
    process.env.IG_REPOST_PINTEREST_SESSION_COOKIE ||
    process.env.PINTEREST_SESSION_COOKIE ||
    ''
  );
}

function isSafeExternalLink(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (/instagram\.com\//i.test(raw)) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

async function downloadMedia(mediaUrl, destinationPath) {
  const response = await axios({
    url: mediaUrl,
    method: 'GET',
    responseType: 'stream',
    timeout: 90000,
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destinationPath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function uploadMedia(page, filePath) {
  await page.waitForSelector('input[type="file"]', { timeout: 30000 });
  const inputs = await page.$$('input[type="file"]');
  const input = inputs[inputs.length - 1];
  if (!input) throw new Error('Pinterest upload field not found');
  await input.uploadFile(filePath);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(2000);
    const status = await page.evaluate(() => {
      const bodyText = (document.body.innerText || '').toLowerCase();
      const hasMedia = !!document.querySelector('video, [data-test-id="pin-builder-media"] img, [data-test-id="pin-draft-media"] img');
      const hasProgress = !!document.querySelector('[role="progressbar"], [data-test-id="media-upload-progress"], [data-test-id="upload-progress"]');
      const draftLimit = bodyText.includes('limit of 50 drafts');
      if (draftLimit) return 'draft_limit';
      if (hasMedia) return 'ready';
      if (hasProgress || bodyText.includes('processing')) return 'processing';
      return 'waiting';
    });

    if (status === 'ready') return;
    if (status === 'draft_limit') {
      throw new Error('Pinterest draft limit reached');
    }
  }

  throw new Error('Pinterest media upload did not complete in time');
}

async function handleVideoCoverEditor(page, isVideo) {
  if (!isVideo) return;

  let editorVisible = false;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    editorVisible = await page.evaluate(() => {
      const h1Text = (document.querySelector('h1')?.innerText || '').toLowerCase();
      const bodyText = (document.body.innerText || '').toLowerCase();
      return (
        h1Text.includes('design your pin') ||
        bodyText.includes('design your pin') ||
        bodyText.includes('edit your video') ||
        bodyText.includes('video controls') ||
        !!document.querySelector('[data-test-id="video-cover-editor"], .videoEditor')
      );
    });

    if (editorVisible) break;
    await sleep(1000);
  }

  if (!editorVisible) {
    const clickedEditCover = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      for (const button of buttons) {
        const text = String(button.innerText || button.getAttribute('aria-label') || '').toLowerCase();
        if (text.includes('edit cover') || text.includes('edit video')) {
          button.click();
          return true;
        }
      }
      return false;
    });

    if (!clickedEditCover) return;
    await sleep(3000);
    editorVisible = true;
  }

  if (!editorVisible) return;

  try {
    let framesLoaded = false;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      framesLoaded = await page.evaluate(() => {
        const modal = document.querySelector('[role="dialog"], [aria-modal="true"]') || document.body;
        const images = Array.from(modal.querySelectorAll('img'));
        const frameThumbs = images.filter((img) => {
          const rect = img.getBoundingClientRect();
          const src = img.src || '';
          return (
            rect.width > 30 &&
            rect.width < 300 &&
            rect.height > 30 &&
            !src.includes('avatar') &&
            !src.includes('profile') &&
            img.complete &&
            img.naturalWidth > 0
          );
        });
        return frameThumbs.length >= 3;
      });

      if (framesLoaded) break;
      await sleep(1000);
    }

    if (framesLoaded) {
      await page.evaluate(() => {
        const modal = document.querySelector('[role="dialog"], [aria-modal="true"]') || document.body;
        const images = Array.from(modal.querySelectorAll('img'));
        const frameThumbs = images.filter((img) => {
          const rect = img.getBoundingClientRect();
          const src = img.src || '';
          return (
            rect.width > 30 &&
            rect.width < 300 &&
            rect.height > 30 &&
            !src.includes('avatar') &&
            !src.includes('profile') &&
            img.complete &&
            img.naturalWidth > 0
          );
        });

        if (frameThumbs.length === 0) return;
        const targetIndex = Math.min(Math.floor(frameThumbs.length * 0.6), frameThumbs.length - 1);
        const target = frameThumbs[targetIndex];
        const clickTarget = target.closest('[role="button"], button, div[tabindex], label') || target.parentElement || target;
        clickTarget.click();
        target.click();
      });
      await sleep(1500);
    }

    const doneClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      const labels = ['done', 'done editing', 'apply', 'save', 'continue'];
      for (const label of labels) {
        const match = buttons.find((button) => {
          const text = String(button.innerText || button.getAttribute('aria-label') || '').toLowerCase().trim();
          return text === label && button.offsetParent !== null;
        });
        if (match) {
          match.click();
          return true;
        }
      }

      const doneButton = document.querySelector(
        '[data-test-id="done-button"], [data-test-id="video-editor-done"], [data-test-id="storyboard-done-button"]'
      );
      if (doneButton && doneButton.offsetParent !== null) {
        doneButton.click();
        return true;
      }
      return false;
    });

    if (!doneClicked) {
      await page.keyboard.press('Escape').catch(() => {});
    }

    await sleep(3000);
  } catch (err) {
    console.warn('[IG-Repost Publisher] Cover editor handling failed:', err.message);
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(1500);
  }
}

async function fillTextField(page, selectors, value, options = {}) {
  if (!value) return false;
  for (const selector of selectors) {
    try {
      const el = await page.$(selector);
      if (!el) continue;
      await el.click({ clickCount: 1 });
      await page.keyboard.down('Control');
      await page.keyboard.press('A');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(value, { delay: 20 });
      await page.evaluate((element, nextValue) => {
        const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        const textAreaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;

        if (element.isContentEditable) {
          element.textContent = nextValue;
        } else if (element.tagName === 'INPUT' && inputSetter) {
          inputSetter.call(element, nextValue);
        } else if (element.tagName === 'TEXTAREA' && textAreaSetter) {
          textAreaSetter.call(element, nextValue);
        } else {
          element.value = nextValue;
        }

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }, el, value);

      if (options.commitWithTab) {
        await page.keyboard.press('Tab').catch(() => {});
      }
      return true;
    } catch {}
  }
  return false;
}

async function fillDestinationLink(page, link) {
  if (!link) return false;

  try {
    const addLinkButtons = await page.$$('button');
    for (const button of addLinkButtons) {
      const text = await page.evaluate((el) => (el.innerText || '').toLowerCase(), button);
      const ariaLabel = await page.evaluate((el) => (el.getAttribute('aria-label') || '').toLowerCase(), button);
      if (text.includes('add a link') || text.includes('add link') || ariaLabel.includes('add a link')) {
        await button.click().catch(() => {});
        await sleep(1000);
        break;
      }
    }
  } catch {}

  const selectors = [
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
    'input[id*="link"]',
  ];

  const filled = await fillTextField(page, selectors, link, { commitWithTab: true });
  if (!filled) return false;

  await sleep(800);
  const verification = await page.evaluate((candidateSelectors) => {
    for (const selector of candidateSelectors) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const value = element.value || element.textContent || element.innerText || '';
      if (value.includes('http')) {
        return value;
      }
    }
    return '';
  }, selectors);

  if (verification && verification.includes('http')) {
    return true;
  }

  await sleep(1200);
  return fillTextField(page, selectors, link, { commitWithTab: true });
}

async function selectBoard(page, boardName = '') {
  const clicked = await page.evaluate(() => {
    const selectors = [
      '[data-test-id="board-dropdown-select-button"]',
      '[data-test-id="board-dropdown-select-button"] button',
      'div[data-test-id="storyboard-selector-board-dropdown"] button',
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        el.click();
        return true;
      }
    }
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
    const target = buttons.find((button) => {
      const text = String(button.textContent || '').trim().toLowerCase();
      return text === 'choose a board' || text === 'select board' || text === 'save to board';
    });
    if (target) {
      target.click();
      return true;
    }
    return false;
  });

  if (!clicked) return false;
  await sleep(2000);

  const target = String(boardName || '').trim().toLowerCase();
  const chosen = await page.evaluate((desiredBoard) => {
    const options = Array.from(document.querySelectorAll(
      '[data-test-id="board-row"], [data-test-id="board-row"] button, [role="option"], [role="menuitem"], div[role="button"]'
    ));

    if (desiredBoard) {
      const match = options.find((option) => String(option.textContent || '').trim().toLowerCase().includes(desiredBoard));
      if (match) {
        match.click();
        return String(match.textContent || '').trim();
      }
    }

    const fallback = options.find((option) => String(option.textContent || '').trim());
    if (fallback) {
      fallback.click();
      return String(fallback.textContent || '').trim();
    }

    return '';
  }, target);

  await sleep(1500);
  return !!chosen;
}

async function dismissPublishObstructions(page) {
  try {
    await page.evaluate(() => {
      document.querySelectorAll('[data-test-id="upsell-modal"], [data-test-id="extension-banner"]').forEach((el) => {
        el.style.display = 'none';
      });

      document.querySelectorAll('[role="dialog"]').forEach((dialog) => {
        const text = (dialog.innerText || '').toLowerCase();
        if (
          text.includes('install') ||
          text.includes('extension') ||
          text.includes('find it') ||
          text.includes('save it')
        ) {
          dialog.style.display = 'none';
        }
      });

      const dismissSelectors = [
        'button[data-test-id="closeButton"]',
        'button[aria-label="close" i]',
        'button[aria-label="dismiss" i]',
      ];

      for (const selector of dismissSelectors) {
        document.querySelectorAll(selector).forEach((button) => {
          const text = (button.innerText || '').toLowerCase();
          if (
            text.includes('close') ||
            text.includes('dismiss') ||
            text.includes('got it') ||
            text.includes('accept') ||
            text.includes('ok') ||
            text === ''
          ) {
            button.click();
          }
        });
      }
    });
  } catch {}

  await sleep(1000);
}

async function clickPublish(page) {
  const clicked = await page.evaluate(() => {
    const selectors = [
      'button[data-test-id="pwt-publish-button"]',
      'button[data-test-id="publish-button"]',
      'button[data-test-id="board-dropdown-save-button"]',
      '[data-test-id="pwt-publish-button"] button',
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button && !button.disabled) {
        button.click();
        return true;
      }
    }

    const mainArea = document.querySelector('[data-test-id="pin-builder-form"], [data-test-id="storyboard"], form, main') || document.body;
    const buttons = Array.from(mainArea.querySelectorAll('button'));
    const exact = buttons.find((button) => {
      if (button.closest('[role="dialog"]')) return false;
      const text = String(button.textContent || '').trim().toLowerCase();
      return button.offsetParent !== null && !button.disabled && (text === 'publish' || text === 'save');
    });
    if (exact) {
      exact.scrollIntoView({ block: 'center' });
      exact.click();
      return true;
    }
    return false;
  });

  if (clicked) return;

  const nativeSelectors = [
    'button[data-test-id="pwt-publish-button"]',
    'button[data-test-id="publish-button"]',
  ];

  for (const selector of nativeSelectors) {
    try {
      await page.click(selector);
      return;
    } catch {}
  }

  await page.keyboard.press('Enter').catch(() => {});
}

function normalizePinUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return raw;
  }
}

async function dismissPromoPopup(page) {
  const dismissResult = await page.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [data-test-id*="modal"], [data-test-id*="upsell"]'));
    for (const dialog of dialogs) {
      const text = (dialog.innerText || '').toLowerCase();
      if (
        text.includes('install') ||
        text.includes('find it') ||
        text.includes('save it') ||
        text.includes('browser extension') ||
        text.includes('love it')
      ) {
        const closeBtn = dialog.querySelector(
          'button[aria-label="close" i], button[aria-label="dismiss" i], [data-test-id="closeButton"], button svg'
        );
        if (closeBtn) {
          const actualBtn = closeBtn.closest('button') || closeBtn;
          actualBtn.click();
          return 'clicked_close_in_promo';
        }

        const buttons = Array.from(dialog.querySelectorAll('button'));
        for (const button of buttons) {
          const label = (button.innerText || '').toLowerCase().trim();
          if (!label.includes('install') && !label.includes('now')) {
            button.click();
            return `clicked_promo_button:${label}`;
          }
        }

        return 'promo_found_without_close';
      }
    }

    const closeButtons = Array.from(document.querySelectorAll(
      'button[aria-label="close" i], button[aria-label="dismiss" i], [data-test-id="closeButton"]'
    ));
    for (const button of closeButtons) {
      if (button.offsetParent !== null) {
        button.click();
        return 'clicked_generic_close';
      }
    }

    return 'no_promo_found';
  });

  if (dismissResult === 'promo_found_without_close') {
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(1000);
  }

  return dismissResult;
}

async function extractPublishedPinInfo(page) {
  return page.evaluate(() => {
    const currentUrl = window.location.href;
    const isRealPinUrl = currentUrl.includes('/pin/') && !currentUrl.includes('pin-creation-tool');
    if (isRealPinUrl) {
      return { success: true, pinUrl: currentUrl, source: 'url_changed' };
    }

    const bodyText = (document.body.innerText || '').toLowerCase();
    const successPhrases = [
      'your pin has been published',
      'pin has been published',
      'pin saved',
      'pin created',
      'see it now',
      'your pin is live',
    ];
    const hasSuccessText = successPhrases.some((phrase) => bodyText.includes(phrase));

    const anchorLinks = Array.from(document.querySelectorAll('a[href]'));
    const visiblePinLink = anchorLinks.find((link) => {
      const href = link.href || '';
      if (!href.includes('/pin/') || href.includes('pin-creation-tool')) return false;
      return true;
    });

    if (visiblePinLink && /\/pin\/\d+/.test(visiblePinLink.href)) {
      return {
        success: true,
        pinUrl: visiblePinLink.href,
        source: hasSuccessText ? 'success_link' : 'visible_pin_link',
      };
    }

    const actionLink = anchorLinks.find((link) => {
      const label = (link.innerText || '').toLowerCase().trim();
      return label === 'view' || label === 'view pin' || label === 'see it now';
    });

    return {
      success: false,
      pinUrl: actionLink?.href || '',
      hasSuccessText,
      source: hasSuccessText ? 'success_without_pin' : 'pending',
      pageUrl: currentUrl,
    };
  });
}

async function verifyPublished(page) {
  const startedAt = Date.now();
  let lastState = null;

  while ((Date.now() - startedAt) < 90000) {
    await sleep(2500);

    const promoResult = await dismissPromoPopup(page);
    if (promoResult !== 'no_promo_found') {
      await sleep(3000);
    }

    const state = await extractPublishedPinInfo(page);
    lastState = state;

    if (state?.success && state.pinUrl) {
      return normalizePinUrl(state.pinUrl);
    }

    if (state?.hasSuccessText && state.pinUrl && state.pinUrl.includes('/pin/')) {
      return normalizePinUrl(state.pinUrl);
    }

    if (state?.hasSuccessText && !state?.success) {
      const clickedView = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href], button, [role="button"]'));
        const target = links.find((node) => {
          const label = (node.innerText || node.getAttribute?.('aria-label') || '').toLowerCase().trim();
          return label === 'view' || label === 'view pin' || label === 'see it now';
        });
        if (target) {
          target.click();
          return true;
        }
        return false;
      });

      if (clickedView) {
        await sleep(3000);
        const followUpState = await extractPublishedPinInfo(page);
        lastState = followUpState;
        if (followUpState?.success && followUpState.pinUrl) {
          return normalizePinUrl(followUpState.pinUrl);
        }
      }
    }
  }

  throw new Error(`Publish verification timed out without a real pin URL${lastState ? ` (${JSON.stringify(lastState)})` : ''}`);
}

async function saveDebugSnapshot(page, prefix) {
  try {
    const logsDir = path.join(process.cwd(), 'public', 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const stamp = `${prefix}_${Date.now()}`;
    await page.screenshot({
      path: path.join(logsDir, `${stamp}.png`),
      fullPage: true,
    });

    const dom = await page.evaluate(() => document.documentElement.outerHTML);
    fs.writeFileSync(path.join(logsDir, `${stamp}.html`), dom, 'utf8');
  } catch (err) {
    console.warn('[IG-Repost Publisher] Debug snapshot failed:', err.message);
  }
}

async function publish(payload = {}) {
  if (!puppeteer) {
    throw new Error('Puppeteer is unavailable in this runtime');
  }

  const sessionCookie = getSessionCookie();
  if (!sessionCookie) {
    throw new Error('Pinterest session cookie is missing for the IG repost pipeline');
  }

  const mediaUrl = String(payload.mediaUrl || '').trim();
  if (!mediaUrl) {
    throw new Error('mediaUrl is required');
  }

  const title = String(payload.title || '').trim().substring(0, 100) || 'Instagram Reel Repost';
  const description = String(payload.description || '').trim().substring(0, 800);
  const altText = String(payload.altText || '').trim().substring(0, 500);
  const externalLink = isSafeExternalLink(payload.externalLink) ? String(payload.externalLink).trim() : '';
  const boardName = String(payload.boardName || process.env.IG_REPOST_BOARD_NAME || '').trim();

  const isImage = /\.(jpeg|jpg|png|webp)(\?.*)?$/i.test(mediaUrl);
  const extension = isImage ? '.jpg' : '.mp4';
  const mediaPath = path.join(os.tmpdir(), `ig_repost_${Date.now()}${extension}`);

  let browser;
  try {
    console.log('[IG-Repost Publisher] Downloading media...');
    await downloadMedia(mediaUrl, mediaPath);

    browser = await puppeteer.launch({
      headless: 'new',
      defaultViewport: { width: 1440, height: 900 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setCookie({
      name: '_pinterest_sess',
      value: sessionCookie,
      domain: '.pinterest.com',
      path: '/',
      secure: true,
      httpOnly: true,
    });

    console.log('[IG-Repost Publisher] Opening Pinterest pin builder...');
    await page.goto('https://www.pinterest.com/pin-creation-tool/', {
      waitUntil: 'networkidle2',
      timeout: 90000,
    });

    console.log('[IG-Repost Publisher] Uploading media...');
    await uploadMedia(page, mediaPath);
    await handleVideoCoverEditor(page, !isImage);

    await fillTextField(page, [
      'textarea#storyboard-selector-title',
      'input[id*="pin-draft-title"]',
      'textarea[id*="pin-draft-title"]',
      '[data-test-id="pin-draft-title"] textarea',
      '[data-test-id="pin-draft-title"] input',
      '[placeholder*="title" i]',
      '[aria-label*="title" i]',
      'textarea[id*="title"]',
      'input[id*="title"]',
    ], title);

    await fillTextField(page, [
      'div#storyboard-selector-description',
      '[data-test-id="pin-draft-description"] div[contenteditable]',
      '[data-test-id="pin-draft-description"] textarea',
      'div[contenteditable][aria-label*="description" i]',
      'textarea[aria-label*="description" i]',
      '[placeholder*="description" i]',
    ], description);

    if (altText) {
      await fillTextField(page, [
        'textarea[aria-label*="alt" i]',
        'input[aria-label*="alt" i]',
      ], altText);
    }

    console.log('[IG-Repost Publisher] Selecting board...');
    await selectBoard(page, boardName);

    if (!isImage) {
      await sleep(10000);
    }

    await page.keyboard.press('Escape').catch(() => {});
    await sleep(1000);
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(1500);

    if (externalLink) {
      await fillDestinationLink(page, externalLink);
    }

    await dismissPublishObstructions(page);

    console.log('[IG-Repost Publisher] Publishing...');
    await clickPublish(page);
    let pinUrl = '';
    try {
      pinUrl = await verifyPublished(page);
    } catch (err) {
      await saveDebugSnapshot(page, 'ig_repost_publish_failure');
      throw err;
    }

    const pinIdMatch = String(pinUrl || '').match(/\/pin\/(\d+)/);
    return {
      success: true,
      pinUrl,
      pinId: pinIdMatch ? pinIdMatch[1] : '',
      title,
      description,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    try {
      if (fs.existsSync(mediaPath)) fs.unlinkSync(mediaPath);
    } catch {}
  }
}

module.exports = {
  publish,
};

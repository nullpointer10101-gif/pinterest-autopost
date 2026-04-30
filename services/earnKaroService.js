const puppeteer = require('puppeteer');

const EK_BASE = 'https://earnkaro.com';
const EK_COOKIE = process.env.EARNKARO_SESSION_COOKIE || '';

function parseCookies(cookieString) {
  return cookieString.split(';').map(part => {
    const [name, ...rest] = part.trim().split('=');
    return {
      name: name.trim(),
      value: rest.join('=').trim(),
      domain: 'earnkaro.com',
      path: '/',
    };
  }).filter(c => c.name && c.value);
}

/**
 * Use Puppeteer to generate an EarnKaro fktr.in profit link for any Flipkart URL.
 * Intercepts the /pps/user/makeearnlink API response directly in the browser.
 */
async function makeAffiliateLink(productUrl) {
  if (!EK_COOKIE) {
    console.warn('[EarnKaro] No EARNKARO_SESSION_COOKIE set. Using raw product URL as fallback.');
    return { affiliateUrl: productUrl, source: 'raw_fallback' };
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setCookie(...parseCookies(EK_COOKIE));

    // Intercept the makeearnlink API response
    let capturedLink = null;
    page.on('response', async (response) => {
      if (response.url().includes('makeearnlink')) {
        try {
          const body = await response.json();
          if (body?.code === 'success' && body?.shared_link) {
            capturedLink = body.shared_link;
          }
        } catch (e) {}
      }
    });

    console.log('[EarnKaro] Navigating to create-earn-link...');
    await page.goto(`${EK_BASE}/create-earn-link`, { waitUntil: 'networkidle2', timeout: 30000 });

    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/signin')) {
      throw new Error('EarnKaro session expired. Please refresh EARNKARO_SESSION_COOKIE.');
    }

    // React-compatible value setter
    await page.waitForSelector('input[name="deallink"]', { timeout: 15000 });
    await page.evaluate((url) => {
      const input = document.querySelector('input[name="deallink"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, url);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, productUrl);

    await new Promise(r => setTimeout(r, 1000));

    // Click MAKE PROFIT LINK button via evaluate (most reliable)
    console.log('[EarnKaro] Clicking MAKE PROFIT LINK...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => /MAKE PROFIT/i.test(b.innerText));
      if (btn) btn.click();
    });

    // Wait for the API response (up to 20s)
    const deadline = Date.now() + 20000;
    while (!capturedLink && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 500));
    }

    if (!capturedLink) throw new Error('makeearnlink response not received within 20s');

    console.log(`[EarnKaro] ✅ Affiliate link: ${capturedLink}`);
    return { affiliateUrl: capturedLink, source: 'earnkaro' };

  } catch (err) {
    console.warn(`[EarnKaro] Failed (${err.message}). Using raw URL.`);
    return { affiliateUrl: productUrl, source: 'raw_fallback' };
  } finally {
    await browser.close();
  }
}

module.exports = { makeAffiliateLink };

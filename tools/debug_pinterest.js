const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function debugPinterest() {
  const sessionCookie = process.env.PINTEREST_SESSION_COOKIE;
  if (!sessionCookie) {
    console.error('PINTEREST_SESSION_COOKIE is missing');
    return;
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setCookie({
      name: '_pinterest_sess',
      value: sessionCookie,
      domain: '.pinterest.com',
      path: '/',
      secure: true,
      httpOnly: true
    });

    console.log('Navigating to Pinterest Home...');
    await page.goto('https://www.pinterest.com/', { waitUntil: 'networkidle2' });
    
    console.log('Scrolling...');
    await page.evaluate(() => window.scrollBy(0, 1000));
    await new Promise(r => setTimeout(r, 5000));

    console.log('Taking screenshot...');
    await page.screenshot({ path: 'pinterest_debug.png', fullPage: false });
    
    console.log('Analyzing links...');
    const data = await page.evaluate(() => {
      const allLinks = Array.from(document.querySelectorAll('a')).map(a => ({
        href: a.href,
        text: a.innerText,
        classes: a.className,
        rect: a.getBoundingClientRect()
      }));
      return allLinks.filter(l => l.href.includes('/pin/')).slice(0, 5);
    });
    
    console.log('Sample Pin Links found:', JSON.stringify(data, null, 2));
    
    if (data.length === 0) {
      console.log('CRITICAL: No pin links found. Body length:', (await page.content()).length);
      // Log some of the body to see if it's a login wall
      const text = await page.evaluate(() => document.body.innerText.substring(0, 500));
      console.log('Body Text starts with:', text);
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

debugPinterest();

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function debugPinterest() {
  const sessionCookie = process.env.PINTEREST_SESSION_COOKIE;
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

    console.log('Navigating to Pinterest Homefeed...');
    await page.goto('https://www.pinterest.com/homefeed/', { waitUntil: 'networkidle2' });
    
    console.log('Scrolling...');
    await page.evaluate(() => window.scrollBy(0, 1000));
    await new Promise(r => setTimeout(r, 5000));

    console.log('Analyzing links...');
    const data = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/pin/"]')).map(a => a.href);
      return [...new Set(links)].slice(0, 5);
    });
    
    console.log('Pin Links found on homefeed:', JSON.stringify(data, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

debugPinterest();

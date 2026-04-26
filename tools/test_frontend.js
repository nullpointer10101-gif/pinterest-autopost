const puppeteer = require('puppeteer');

async function testFrontend() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.toString()));
  
  await page.goto('http://localhost:3000');
  
  await page.type('#reel-url', 'https://www.instagram.com/reel/DWluc7Dk8GI/');
  await page.click('#fetch-btn');
  
  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
}

testFrontend();

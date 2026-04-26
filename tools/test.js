const puppeteer = require('puppeteer');
require('dotenv').config();

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setCookie({
    name: '_pinterest_sess',
    value: process.env.PINTEREST_SESSION_COOKIE,
    domain: '.pinterest.com',
    path: '/',
    secure: true,
    httpOnly: true
  });
  await page.goto('https://www.pinterest.com/pin-creation-tool/', {waitUntil: 'networkidle2'});
  
  await page.click('[data-test-id="board-dropdown-select-button"]');
  await new Promise(r => setTimeout(r, 1000));
  
  const boards = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('div')).filter(d => d.innerText && d.innerText.includes('Aura Closet') && !d.innerText.includes('Publish')).map(d => ({
      text: d.innerText,
      className: d.className,
      testId: d.getAttribute('data-test-id')
    }));
  });
  console.log('Boards:', JSON.stringify(boards, null, 2));

  await browser.close();
})();

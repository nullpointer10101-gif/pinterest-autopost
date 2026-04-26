const puppeteer = require('puppeteer');

async function testIG(url) {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  try {
    console.log("Navigating to", url);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    const videoUrl = await page.evaluate(() => {
      const vid = document.querySelector('video');
      return vid ? vid.src : null;
    });
    console.log("Found video:", videoUrl);
  } catch (e) {
    console.log("Error:", e.message);
  } finally {
    await browser.close();
  }
}

testIG('https://www.instagram.com/reel/DWOBjQoCdJN/');

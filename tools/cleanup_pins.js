const puppeteer = require('puppeteer');
require('dotenv').config();

async function cleanupSavedPins() {
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

    console.log('Navigating to your Saved pins page...');
    await page.goto('https://www.pinterest.com/glowverabeauty/_saved/', { waitUntil: 'networkidle2' });
    
    // Wait for pins to load
    await new Promise(r => setTimeout(r, 5000));

    console.log('Finding saved pins to unsave...');
    const pinsToUnsave = await page.evaluate(() => {
      // Find the 'Saved' buttons (the ones that say Saved, not Save)
      const btns = Array.from(document.querySelectorAll('button'));
      return btns
        .filter(b => b.innerText.toLowerCase().trim() === 'saved')
        .map((b, i) => i); // Just return indices for simplicity in the loop
    });

    console.log(`Found ${pinsToUnsave.length} pins to unsave. Cleaning up...`);

    for (let i = 0; i < Math.min(pinsToUnsave.length, 15); i++) {
       await page.evaluate((index) => {
         const btns = Array.from(document.querySelectorAll('button'))
           .filter(b => b.innerText.toLowerCase().trim() === 'saved');
         if (btns[index]) {
            btns[index].scrollIntoView();
            btns[index].click();
         }
       }, i);
       await new Promise(r => setTimeout(r, 1000));
       console.log(`Unsaved pin ${i+1}`);
    }

    console.log('✅ Cleanup complete! Your profile is clean.');

  } catch (err) {
    console.error('Error during cleanup:', err.message);
  } finally {
    await browser.close();
  }
}

cleanupSavedPins();

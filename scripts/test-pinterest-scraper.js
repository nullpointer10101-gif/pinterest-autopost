require('dotenv').config();
const pinterestScraperService = require('../services/pinterestScraperService');

async function main() {
  const username = process.argv[2] || 'techburner';
  
  console.log(`[Test] Starting Pinterest Scraper for @${username}...`);
  console.log('[Test] We will test the full fetchLatestPins pipeline (includes bridge links and state saving).');
  
  const pins = await pinterestScraperService.fetchLatestPins(username, 5);
  
  console.log(`\n[Test] Pipeline returned ${pins.length} image pins.`);
  if (pins.length > 0) {
    console.log('[Test] Sample pin:');
    console.log(JSON.stringify(pins[0], null, 2));
  }
  
  console.log('\n[Test] Done.');
}

main().catch(err => {
  console.error('[Test] Fatal error:', err);
  process.exit(1);
});

const axios = require('axios');

let puppeteerExtra = null;
try {
  puppeteerExtra = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteerExtra.use(StealthPlugin());
} catch (e) {
  console.warn('[Pinterest-Scraper] puppeteer-extra not available (expected on Vercel):', e.message);
}

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN || '';

/**
 * Format raw pinterest data into standard pin objects
 */
function normalizePinData(rawPin) {
  if (!rawPin || !rawPin.id) return null;
  
  const isVideo = rawPin.is_video === true || !!rawPin.story_pin_data || !!rawPin.videos;
  let mediaUrl = '';
  let thumbnailUrl = '';
  let imageUrls = [];
  
  if (isVideo && rawPin.videos?.video_list) {
    const videoList = rawPin.videos.video_list;
    const bestVideo = videoList['V_720P'] || videoList['V_1080P'] || Object.values(videoList)[0];
    mediaUrl = bestVideo?.url || '';
    thumbnailUrl = rawPin.images?.orig?.url || rawPin.images?.['736x']?.url || '';
    if (thumbnailUrl) imageUrls.push(thumbnailUrl);
  } else if (rawPin.story_pin_data && rawPin.story_pin_data.pages?.length > 0) {
    // Idea Pins
    for (const page of rawPin.story_pin_data.pages) {
      const img = page.image?.images?.orig?.url || page.image?.images?.['736x']?.url;
      if (img) imageUrls.push(img);
    }
    const firstPage = rawPin.story_pin_data.pages[0];
    mediaUrl = firstPage.blocks?.[0]?.video?.video_list?.['V_720P']?.url || firstPage.blocks?.[0]?.video?.video_list?.['V_1080P']?.url || imageUrls[0] || '';
    thumbnailUrl = imageUrls[0] || '';
  } else {
    // Normal Pin or Carousel
    if (rawPin.carousel_data && rawPin.carousel_data.carousel_slots?.length > 0) {
      for (const slot of rawPin.carousel_data.carousel_slots) {
        const img = slot.images?.orig?.url || slot.images?.['736x']?.url;
        if (img) imageUrls.push(img);
      }
    } else {
      const singleImg = rawPin.images?.orig?.url || rawPin.images?.['736x']?.url;
      if (singleImg) imageUrls.push(singleImg);
    }
    mediaUrl = imageUrls[0] || '';
    thumbnailUrl = mediaUrl;
  }
  
  return {
    pinId: rawPin.id,
    mediaType: isVideo ? 'video' : 'image',
    mediaUrl,
    thumbnailUrl,
    imageUrls,
    title: rawPin.title || '',
    description: rawPin.description || rawPin.grid_title || '',
    link: rawPin.link || '',
    boardName: rawPin.board?.name || '',
    createdAt: rawPin.created_at || null,
  };
}

/**
 * Tier 1: Apify scraper
 */
async function fetchViaApify(username) {
  if (!APIFY_API_TOKEN) return [];
  console.log(`[Pinterest-Scraper] Fetching @${username} via Apify...`);
  
  try {
    const runRes = await axios.post(
      'https://api.apify.com/v2/acts/mikesimple~pinterest-scraper/run-sync-get-dataset-items',
      {
        startUrls: [{ url: `https://www.pinterest.com/${username}/` }],
        maxItems: 2000,
      },
      {
        timeout: 90000,
        headers: { Authorization: `Bearer ${APIFY_API_TOKEN}` },
      }
    );
    
    const items = runRes.data || [];
    return items.map(item => normalizePinData(item)).filter(p => p && p.mediaUrl);
  } catch (err) {
    console.log(`[Pinterest-Scraper] Apify failed for @${username}:`, err.message);
    return [];
  }
}

/**
 * Tier 2: Puppeteer Stealth API Interception
 */
async function fetchViaPuppeteer(username) {
  if (!puppeteerExtra) {
    console.log(`[Pinterest-Scraper] Puppeteer not available, skipping stealth fetch.`);
    return [];
  }
  console.log(`[Pinterest-Scraper] Fetching @${username} via Puppeteer API interception...`);
  
  const browser = await puppeteerExtra.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  
  try {
    const page = await browser.newPage();
    const collectedPins = new Map();
    
    // Intercept GraphQL/JSON requests
    page.on('response', async (res) => {
      const u = res.url();
      if (u.includes('resource/UserPinsResource/get/')) {
        try {
          const json = await res.json();
          const pins = json?.resource_response?.data || [];
          for (const pin of pins) {
            const normalized = normalizePinData(pin);
            if (normalized && normalized.mediaUrl) {
              collectedPins.set(normalized.pinId, normalized);
            }
          }
        } catch (e) {}
      }
    });

    await page.goto(`https://www.pinterest.com/${username}/_created/`, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Scroll a few times to trigger pagination
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    return Array.from(collectedPins.values());
  } catch (err) {
    console.log(`[Pinterest-Scraper] Puppeteer failed for @${username}:`, err.message);
    return [];
  } finally {
    await browser.close();
  }
}

/**
 * Tier 3: HTML State Extraction
 */
async function fetchViaHtml(username) {
  console.log(`[Pinterest-Scraper] Fetching @${username} via HTML State extraction...`);
  try {
    const res = await axios.get(`https://www.pinterest.com/${username}/_created/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      },
      timeout: 15000,
    });
    
    // Look for application/json script block with id __PWS_DATA__
    const jsonMatch = res.data.match(/<script id="__PWS_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!jsonMatch) return [];
    
    const data = JSON.parse(jsonMatch[1]);
    const pins = [];
    
    // The structure changes, search deeply for UserPinsResource
    if (data.props?.initialReduxState?.pins) {
      const pinMap = data.props.initialReduxState.pins;
      for (const pinId of Object.keys(pinMap)) {
        const normalized = normalizePinData(pinMap[pinId]);
        if (normalized && normalized.mediaUrl) {
          pins.push(normalized);
        }
      }
    }
    
    return pins;
  } catch (err) {
    console.log(`[Pinterest-Scraper] HTML extraction failed for @${username}:`, err.message);
    return [];
  }
}

const pinterestStateService = require('./pinterestStateService');

/**
 * Fetch all pins using cascading fallback methods
 */
async function fetchLatestPins(username, limit = 50) {
  let pins = [];
  
  pins = await fetchViaApify(username);
  if (pins.length === 0) pins = await fetchViaPuppeteer(username);
  if (pins.length === 0) pins = await fetchViaHtml(username);
  
  if (pins.length === 0) {
    console.warn(`[Pinterest-Scraper] ⚠️ Could not fetch pins for @${username}. All methods failed.`);
    const emptyResult = [];
    emptyResult.success = false;
    return emptyResult;
  }

  // Filter out videos, we only want image pins
  const imagePins = pins.filter(p => p.mediaType === 'image');

  // Save them to state so the bridge page can look them up by ID
  await pinterestStateService.saveScrapedPins(imagePins);

  // Map the link to our bridge page
  // Assuming BASE_URL is set in environment, or default to localhost for testing
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  
  const finalPins = imagePins.slice(0, limit).map(pin => {
    return {
      ...pin,
      // Keep original link somewhere if needed, but override main link
      originalLink: pin.link,
      link: `${baseUrl}/bridge/${pin.pinId}`
    };
  });

  return finalPins;
}

module.exports = {
  fetchLatestPins,
  fetchViaApify,
  fetchViaPuppeteer,
  fetchViaHtml
};

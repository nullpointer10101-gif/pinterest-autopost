const axios = require('axios');

let puppeteerExtra = null;
try {
  puppeteerExtra = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteerExtra.use(StealthPlugin());
} catch (e) {
  console.warn('[Pinterest-Scraper] puppeteer-extra not available:', e.message);
}

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN || '';

// Known working Apify Pinterest actors (tried in order)
const APIFY_ACTORS = [
  {
    id: 'epctex~pinterest-scraper',
    buildInput: (username, maxItems) => ({
      startUrls: [{ url: `https://www.pinterest.com/${username}/` }],
      maxItems,
      type: 'USER',
    }),
  },
  {
    id: 'crawlerbros~pinterest-scraper-pro',
    buildInput: (username, maxItems) => ({
      startUrls: [{ url: `https://www.pinterest.com/${username}/` }],
      maxItems,
    }),
  },
  {
    id: 'apify~pinterest-scraper',
    buildInput: (username, maxItems) => ({
      startUrls: [{ url: `https://www.pinterest.com/${username}/` }],
      maxItems,
    }),
  },
];

/**
 * Format raw pinterest data into standard pin objects
 */
function normalizePinData(rawPin) {
  if (!rawPin) return null;
  // Handle different actor output formats
  const id = rawPin.id || rawPin.pinId || rawPin.pin_id;
  if (!id) return null;

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
    mediaUrl = firstPage.blocks?.[0]?.video?.video_list?.['V_720P']?.url
      || firstPage.blocks?.[0]?.video?.video_list?.['V_1080P']?.url
      || imageUrls[0] || '';
    thumbnailUrl = imageUrls[0] || '';
  } else {
    // Normal Pin or Carousel
    if (rawPin.carousel_data && rawPin.carousel_data.carousel_slots?.length > 0) {
      for (const slot of rawPin.carousel_data.carousel_slots) {
        const img = slot.images?.orig?.url || slot.images?.['736x']?.url;
        if (img) imageUrls.push(img);
      }
    } else {
      // Try multiple image URL formats from different actors
      const singleImg = rawPin.images?.orig?.url
        || rawPin.images?.['736x']?.url
        || rawPin.imageUrl
        || rawPin.image_url
        || rawPin.thumbnailUrl
        || rawPin.thumbnail_url;
      if (singleImg) imageUrls.push(singleImg);
    }
    mediaUrl = imageUrls[0] || '';
    thumbnailUrl = mediaUrl;
  }

  return {
    pinId: String(id),
    mediaType: isVideo ? 'video' : 'image',
    mediaUrl,
    thumbnailUrl,
    imageUrls,
    title: rawPin.title || rawPin.grid_title || '',
    description: rawPin.description || rawPin.grid_title || '',
    link: rawPin.link || rawPin.url || '',
    boardName: rawPin.board?.name || rawPin.boardName || '',
    createdAt: rawPin.created_at || rawPin.createdAt || null,
  };
}

/**
 * Tier 1: Apify – tries multiple actors until one works
 */
async function fetchViaApify(username, maxItems = 2000) {
  if (!APIFY_API_TOKEN) {
    console.log('[Pinterest-Scraper] No APIFY_API_TOKEN set, skipping Apify tier.');
    return [];
  }

  for (const actor of APIFY_ACTORS) {
    console.log(`[Pinterest-Scraper] Trying Apify actor: ${actor.id}...`);
    try {
      const runRes = await axios.post(
        `https://api.apify.com/v2/acts/${actor.id}/run-sync-get-dataset-items`,
        actor.buildInput(username, maxItems),
        {
          timeout: 300000, // 5 minutes for large scrapes
          params: { token: APIFY_API_TOKEN },
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const items = Array.isArray(runRes.data) ? runRes.data : [];
      if (items.length === 0) {
        console.log(`[Pinterest-Scraper] Actor ${actor.id} returned 0 items, trying next...`);
        continue;
      }

      const pins = items.map(item => normalizePinData(item)).filter(p => p && p.mediaUrl);
      console.log(`[Pinterest-Scraper] Actor ${actor.id} returned ${pins.length} usable pins.`);
      return pins;
    } catch (err) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.message || err.message;
      console.log(`[Pinterest-Scraper] Actor ${actor.id} failed (${status}): ${msg}`);
    }
  }

  console.log('[Pinterest-Scraper] All Apify actors failed.');
  return [];
}

/**
 * Tier 2: Puppeteer deep scrolling (aggressive — for 1k+ pins)
 * Intercepts Pinterest's internal API responses during infinite scroll.
 */
async function fetchViaPuppeteer(username, maxItems = 2000) {
  if (!puppeteerExtra) {
    console.log('[Pinterest-Scraper] Puppeteer not available.');
    return [];
  }
  console.log(`[Pinterest-Scraper] Deep-scrolling @${username} via Puppeteer (target: ${maxItems} pins)...`);

  const browser = await puppeteerExtra.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1920,1080',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    const collectedPins = new Map();

    // Intercept Pinterest internal API calls during scroll
    page.on('response', async (res) => {
      const u = res.url();
      const isRelevant = u.includes('/resource/UserPinsResource/')
        || u.includes('/resource/BoardResource/')
        || u.includes('/resource/UserActivityPinsResource/')
        || u.includes('pin_feed')
        || u.includes('board_feed');

      if (!isRelevant) return;

      try {
        const text = await res.text();
        const json = JSON.parse(text);

        // Try multiple response shapes
        const pins = json?.resource_response?.data
          || json?.resource_response?.data?.board_feed
          || json?.resource_response?.data?.pins
          || json?.data
          || [];

        if (Array.isArray(pins)) {
          for (const pin of pins) {
            const normalized = normalizePinData(pin);
            if (normalized && normalized.mediaUrl && !collectedPins.has(normalized.pinId)) {
              collectedPins.set(normalized.pinId, normalized);
            }
          }
          if (collectedPins.size % 50 === 0 && collectedPins.size > 0) {
            console.log(`[Pinterest-Scraper] Collected ${collectedPins.size} pins so far...`);
          }
        }
      } catch (e) {
        // Non-JSON responses — ignore
      }
    });

    // Navigate to created pins page
    await page.goto(`https://www.pinterest.com/${username}/_created/`, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Deep scroll — keep scrolling until we have enough pins or nothing new loads
    let lastCount = 0;
    let noNewPinsRounds = 0;
    const MAX_NO_NEW_ROUNDS = 5; // Stop after 5 consecutive rounds with no new pins
    const MAX_SCROLL_ROUNDS = 200; // Safety cap

    for (let i = 0; i < MAX_SCROLL_ROUNDS; i++) {
      if (collectedPins.size >= maxItems) {
        console.log(`[Pinterest-Scraper] Reached target of ${maxItems} pins. Stopping scroll.`);
        break;
      }

      // Scroll to bottom
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      // Wait for new content to load
      await new Promise(r => setTimeout(r, 1500));

      if (collectedPins.size === lastCount) {
        noNewPinsRounds++;
        if (noNewPinsRounds >= MAX_NO_NEW_ROUNDS) {
          console.log(`[Pinterest-Scraper] No new pins after ${MAX_NO_NEW_ROUNDS} scrolls. Reached end.`);
          break;
        }
        // Wait a bit longer when content is slow to load
        await new Promise(r => setTimeout(r, 2000));
      } else {
        noNewPinsRounds = 0;
        lastCount = collectedPins.size;
      }
    }

    const result = Array.from(collectedPins.values()).slice(0, maxItems);
    console.log(`[Pinterest-Scraper] Puppeteer collected ${result.length} total pins.`);
    return result;
  } catch (err) {
    console.log(`[Pinterest-Scraper] Puppeteer failed for @${username}:`, err.message);
    return [];
  } finally {
    await browser.close();
  }
}

/**
 * Tier 3: Pinterest __PWS_DATA__ HTML extraction (initial page load only)
 */
async function fetchViaHtml(username) {
  console.log(`[Pinterest-Scraper] Fetching @${username} via HTML state extraction...`);
  try {
    const res = await axios.get(`https://www.pinterest.com/${username}/_created/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 15000,
    });

    const jsonMatch = res.data.match(/<script id="__PWS_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!jsonMatch) return [];

    const data = JSON.parse(jsonMatch[1]);
    const pins = [];

    if (data.props?.initialReduxState?.pins) {
      const pinMap = data.props.initialReduxState.pins;
      for (const pinId of Object.keys(pinMap)) {
        const normalized = normalizePinData(pinMap[pinId]);
        if (normalized && normalized.mediaUrl) {
          pins.push(normalized);
        }
      }
    }

    console.log(`[Pinterest-Scraper] HTML extraction got ${pins.length} pins.`);
    return pins;
  } catch (err) {
    console.log(`[Pinterest-Scraper] HTML extraction failed for @${username}:`, err.message);
    return [];
  }
}

const pinterestStateService = require('./pinterestStateService');

/**
 * Master fetch: cascading fallback Apify → Puppeteer → HTML
 * Only returns image pins (videos filtered out).
 */
async function fetchLatestPins(username, limit = 2000) {
  let pins = [];

  // Try each tier in order
  pins = await fetchViaApify(username, limit);
  if (pins.length < 10) {
    console.log('[Pinterest-Scraper] Apify yielded too few results, trying Puppeteer...');
    const puppeteerPins = await fetchViaPuppeteer(username, limit);
    if (puppeteerPins.length > pins.length) pins = puppeteerPins;
  }
  if (pins.length < 5) {
    console.log('[Pinterest-Scraper] Trying HTML extraction as last resort...');
    const htmlPins = await fetchViaHtml(username);
    if (htmlPins.length > pins.length) pins = htmlPins;
  }

  if (pins.length === 0) {
    console.warn(`[Pinterest-Scraper] ⚠️  All scraping methods failed for @${username}.`);
    const empty = [];
    empty.success = false;
    return empty;
  }

  // Filter out videos — only image pins
  const imagePins = pins.filter(p => p.mediaType === 'image' && p.imageUrls.length > 0);
  console.log(`[Pinterest-Scraper] ${imagePins.length} image pins (${pins.length - imagePins.length} videos filtered).`);

  // Save to state so the bridge page can serve them by ID
  await pinterestStateService.saveScrapedPins(imagePins);

  const baseUrl = process.env.BASE_URL || process.env.APP_BASE_URL || 'http://localhost:3000';

  const finalPins = imagePins.slice(0, limit).map(pin => ({
    ...pin,
    originalLink: pin.link,
    link: `${baseUrl}/bridge/${pin.pinId}`,
  }));

  return finalPins;
}

module.exports = {
  fetchLatestPins,
  fetchViaApify,
  fetchViaPuppeteer,
  fetchViaHtml,
};

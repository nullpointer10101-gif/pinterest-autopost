const axios = require('axios');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());
const igStorageService = require('./igStorageService');

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';
const IG_SESSION_COOKIE = process.env.INSTAGRAM_SESSION_COOKIE || '';
// Extract csrftoken from cookie string for API header
const IG_CSRF = (IG_SESSION_COOKIE.match(/csrftoken=([^;]+)/) || [])[1] || '';
const MAX_SEEN_PER_CHANNEL = 50;


const DEFAULT_STATE = {
  channels: [],
  seen: {},         // { username: [shortcode, ...] }
  affiliateCache: {}, // { shortcode: earnkaro_url }
  lastRunAt: null,
};

// ─── State helpers ─────────────────────────────────────────────────────────────

async function readState() {
  const state = await igStorageService.loadState(DEFAULT_STATE);
  return {
    ...DEFAULT_STATE,
    ...state,
    channels: Array.isArray(state?.channels) ? state.channels : [],
    seen: state?.seen || {},
    affiliateCache: state?.affiliateCache || {},
  };
}

async function writeState(state) {
  await igStorageService.saveState(state);
}

// ─── Shortcode helpers ─────────────────────────────────────────────────────────

function parseShortcode(url) {
  const match = url.match(/\/(reel|p|tv)\/([A-Za-z0-9_-]+)/);
  return match ? match[2] : null;
}

function hasSeen(state, username, shortcode) {
  return Array.isArray(state.seen[username]) && state.seen[username].includes(shortcode);
}

function markSeen(state, username, shortcode) {
  if (!Array.isArray(state.seen[username])) state.seen[username] = [];
  state.seen[username].unshift(shortcode);
  // Keep only the last MAX_SEEN_PER_CHANNEL entries
  state.seen[username] = state.seen[username].slice(0, MAX_SEEN_PER_CHANNEL);
}

// ─── IG Fetching Methods ──────────────────────────────────────────────────────

/**
 * Standard Instagram API headers using our session cookie.
 */
function igHeaders() {
  return {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'cookie': IG_SESSION_COOKIE,
    'referer': 'https://www.instagram.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'x-asbd-id': '198387',
    'x-csrftoken': IG_CSRF,
    'x-ig-app-id': '936619743392459',
    'x-ig-www-claim': '0',
    'x-requested-with': 'XMLHttpRequest',
  };
}

/**
 * Method 0 (PRIMARY): Instagram internal mobile feed API.
 * Step 1: username → user_id via web_profile_info
 * Step 2: /api/v1/feed/user/{user_id}/ → real posts with captions
 * Confirmed working: 6 reels returned with full caption text.
 */
async function fetchViaSessionApi(username) {
  if (!IG_SESSION_COOKIE || !IG_CSRF) return [];
  try {
    // Step 1: resolve user ID
    const profileRes = await axios.get(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
      { headers: igHeaders(), timeout: 12000 }
    );
    const userId = profileRes.data?.data?.user?.id;
    if (!userId) {
      console.log(`[IG-Tracker] Session API: no user ID for @${username}`);
      return [];
    }

    // Step 2: get actual feed
    const feedRes = await axios.get(
      `https://www.instagram.com/api/v1/feed/user/${userId}/?count=6`,
      { headers: igHeaders(), timeout: 12000 }
    );
    const items = feedRes.data?.items || [];
    return items.map(item => {
      const isVideo = item.media_type === 2 || !!item.video_url;
      const shortcode = item.code || item.shortcode;
      const imageVersions = item.image_versions2?.candidates || [];
      const thumbnailUrl = imageVersions[0]?.url || item.thumbnail_url || '';
      const videoUrl = item.video_url || item.video_versions?.[0]?.url || '';
      return {
        shortcode,
        url: `https://www.instagram.com/reel/${shortcode}/`,
        mediaUrl: isVideo ? (videoUrl || thumbnailUrl) : thumbnailUrl,
        thumbnailUrl,
        caption: item.caption?.text || '',
        username,
        mediaType: isVideo ? 'video' : 'image',
      };
    }).filter(r => r.shortcode && r.thumbnailUrl);
  } catch (err) {
    console.log(`[IG-Tracker] Session API failed for @${username}: ${err.message}`);
    return [];
  }
}

/**
 * Method 1: Puppeteer with stealth (primary — no Instagram login needed).
 * Tries imginn → picuki → Instagram ?__a=1 as stealth browser requests.
 */
async function fetchViaPuppeteer(username) {
  const browser = await puppeteerExtra.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    // — Attempt 1: imginn.com —
    try {
      console.log(`[IG-Tracker] Stealth → imginn.com/@${username}`);
      await page.goto(`https://imginn.com/${username}/`, { waitUntil: 'networkidle2', timeout: 25000 });
      const title = await page.title();
      if (!title.toLowerCase().includes('moment') && !title.toLowerCase().includes('cloudflare')) {
        const results = await page.evaluate((user) => {
          const posts = [];
          const links = Array.from(document.querySelectorAll('a[href]'))
            .filter(a => /\/(p|reel|media)\//.test(a.href)).slice(0, 5);
          links.forEach((link, i) => {
            const m = link.href.match(/\/(p|reel|media)\/([A-Za-z0-9_-]{5,})/);
            const shortcode = m?.[2];
            const container = link.closest('li, article, div[class*="item"], div[class*="post"]') || link.parentElement;
            const img = container?.querySelector('img');
            const thumbnailUrl = img?.src || img?.dataset?.src || '';
            const isVideo = !!(container?.querySelector('[class*="play"],[class*="video"],svg'));
            if (shortcode) {
              posts.push({ shortcode, username: user, url: `https://www.instagram.com/reel/${shortcode}/`, mediaUrl: thumbnailUrl, thumbnailUrl, caption: '', mediaType: isVideo ? 'video' : 'image' });
            }
          });
          return posts;
        }, username);
        if (results.length > 0) return results;
      }
    } catch (e) { console.log(`[IG-Tracker] imginn stealth: ${e.message}`); }

    // — Attempt 2: picuki.com —
    try {
      console.log(`[IG-Tracker] Stealth → picuki.com/@${username}`);
      await page.goto(`https://www.picuki.com/profile/${username}`, { waitUntil: 'networkidle2', timeout: 25000 });
      const title = await page.title();
      if (!title.toLowerCase().includes('moment') && !title.toLowerCase().includes('cloudflare')) {
        const results = await page.evaluate((user) => {
          const posts = [];
          const items = document.querySelectorAll('.box-photo, .photo, [class*="photo-item"]');
          items.forEach((item, i) => {
            if (i >= 5) return;
            const link = item.querySelector('a[href]');
            const m = (link?.href || '').match(/\/(p|reel|media)\/([A-Za-z0-9_-]{5,})/);
            const shortcode = m?.[2];
            const img = item.querySelector('img');
            const thumbnailUrl = img?.src || '';
            const isVideo = !!(item.querySelector('[class*="play"],[class*="video"]'));
            if (shortcode && thumbnailUrl) {
              posts.push({ shortcode, username: user, url: `https://www.instagram.com/reel/${shortcode}/`, mediaUrl: thumbnailUrl, thumbnailUrl, caption: '', mediaType: isVideo ? 'video' : 'image' });
            }
          });
          return posts;
        }, username);
        if (results.length > 0) return results;
      }
    } catch (e) { console.log(`[IG-Tracker] picuki stealth: ${e.message}`); }

    // — Attempt 3: Instagram with session cookie (most reliable once sessionid is set) —
    try {
      console.log(`[IG-Tracker] Stealth → instagram.com/@${username} with session`);
      // Inject session cookies if available
      if (IG_SESSION_COOKIE) {
        const igCookies = IG_SESSION_COOKIE.split(';').map(part => {
          const [name, ...rest] = part.trim().split('=');
          return { name: name.trim(), value: rest.join('=').trim(), domain: '.instagram.com', path: '/' };
        }).filter(c => c.name && c.value && !c.value.includes('PASTE_YOUR'));
        if (igCookies.length > 0) await page.setCookie(...igCookies);
      }

      let apiData = null;
      page.on('response', async (res) => {
        const u = res.url();
        if (u.includes('web_profile_info') || (u.includes('__a=1') && u.includes(username))) {
          try { apiData = await res.json(); } catch (e) {}
        }
      });

      await page.goto(`https://www.instagram.com/${username}/?__a=1&__d=dis`, {
        waitUntil: 'networkidle2', timeout: 20000,
      });
      await new Promise(r => setTimeout(r, 3000));

      const user = apiData?.graphql?.user || apiData?.data?.user;
      if (user) {
        const edges = user?.edge_owner_to_timeline_media?.edges || [];
        const results = edges.slice(0, 5).map(e => {
          const node = e.node;
          return {
            shortcode: node.shortcode, username,
            url: `https://www.instagram.com/reel/${node.shortcode}/`,
            mediaUrl: node.video_url || node.display_url,
            thumbnailUrl: node.thumbnail_src || node.display_url,
            caption: node.edge_media_to_caption?.edges?.[0]?.node?.text || '',
            mediaType: node.is_video ? 'video' : 'image',
          };
        }).filter(r => r.shortcode && r.mediaUrl);
        if (results.length > 0) return results;
      }
    } catch (e) { console.log(`[IG-Tracker] Instagram stealth: ${e.message}`); }


    return [];
  } finally {
    await browser.close();
  }
}

/**
 * Method 1: Instagram's undocumented JSON endpoint (fast, no auth, often works)
 */
async function fetchViaUnofficialApi(username) {
  try {
    const url = `https://www.instagram.com/${username}/?__a=1&__d=dis`;
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
        'Accept': 'application/json',
        'Referer': 'https://www.instagram.com/',
        'x-ig-app-id': '936619743392459',
      },
      timeout: 12000,
    });
    const user = res.data?.graphql?.user || res.data?.data?.user;
    if (!user) return [];

    const edges = user?.edge_owner_to_timeline_media?.edges || [];
    return edges.slice(0, 5).map(e => {
      const node = e.node;
      const isVideo = node.is_video === true;
      const shortcode = node.shortcode;
      return {
        shortcode,
        url: `https://www.instagram.com/reel/${shortcode}/`,
        mediaUrl: node.video_url || node.display_url,
        thumbnailUrl: node.thumbnail_src || node.display_url,
        caption: node.edge_media_to_caption?.edges?.[0]?.node?.text || '',
        username,
        mediaType: isVideo ? 'video' : 'image',
      };
    }).filter(r => r.shortcode && r.mediaUrl);
  } catch (err) {
    console.log(`[IG-Tracker] Unofficial API failed for @${username}: ${err.message}`);
    return [];
  }
}

/**
 * Method 2: Picuki (public IG mirror — no auth, no rate limit)
 */
async function fetchViaPicuki(username) {
  try {
    const url = `https://www.picuki.com/profile/${username}`;
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      },
      timeout: 15000,
    });
    const html = res.data;

    // Extract reel/post links from picuki's listing
    const linkMatches = [...html.matchAll(/href="https:\/\/www\.picuki\.com\/media\/([A-Za-z0-9_-]+)"/g)];
    const captionMatches = [...html.matchAll(/<div class="photo-description">([\s\S]*?)<\/div>/g)];
    const videoMatches = [...html.matchAll(/src="(https:\/\/[^"]+\.mp4[^"]*)"/g)];
    const thumbMatches = [...html.matchAll(/<img[^>]*src="(https:\/\/[^"]+instagram[^"]*)"[^>]*class="[^"]*post-image[^"]*"/g)];

    const results = [];
    for (let i = 0; i < Math.min(linkMatches.length, 5); i++) {
      const shortcode = linkMatches[i][1];
      const caption = captionMatches[i]
        ? captionMatches[i][1].replace(/<[^>]+>/g, '').trim()
        : '';
      const mediaUrl = videoMatches[i]?.[1] || thumbMatches[i]?.[1] || '';
      const isVideo = !!videoMatches[i];

      if (shortcode && mediaUrl) {
        results.push({
          shortcode,
          url: `https://www.instagram.com/reel/${shortcode}/`,
          mediaUrl,
          thumbnailUrl: thumbMatches[i]?.[1] || mediaUrl,
          caption,
          username,
          mediaType: isVideo ? 'video' : 'image',
        });
      }
    }
    return results;
  } catch (err) {
    console.log(`[IG-Tracker] Picuki failed for @${username}: ${err.message}`);
    return [];
  }
}

/**
 * Method 3: RapidAPI Instagram Scraper (uses existing RAPIDAPI_KEY)
 */
async function fetchViaRapidAPI(username) {
  if (!RAPIDAPI_KEY) return [];
  try {
    const res = await axios.get(
      `https://instagram-scraper-api2.p.rapidapi.com/v1/posts`,
      {
        params: { username_or_id_or_url: username },
        headers: {
          'x-rapidapi-key': RAPIDAPI_KEY,
          'x-rapidapi-host': 'instagram-scraper-api2.p.rapidapi.com',
        },
        timeout: 12000,
      }
    );
    const items = res.data?.data?.items || res.data?.items || [];
    return items.slice(0, 5).map(item => {
      const isVideo = item.media_type === 2 || !!item.video_url;
      const shortcode = item.code || item.shortcode || parseShortcode(item.link || '');
      return {
        shortcode,
        url: `https://www.instagram.com/reel/${shortcode}/`,
        mediaUrl: item.video_url || item.image_versions?.items?.[0]?.url || '',
        thumbnailUrl: item.image_versions?.items?.[0]?.url || '',
        caption: item.caption?.text || '',
        username,
        mediaType: isVideo ? 'video' : 'image',
      };
    }).filter(r => r.shortcode && r.mediaUrl);
  } catch (err) {
    console.log(`[IG-Tracker] RapidAPI failed for @${username}: ${err.message}`);
    return [];
  }
}

/**
 * Fetch latest reels for a given username.
 * Priority: Session API → Puppeteer stealth → Unofficial API → Picuki → RapidAPI
 */
async function fetchLatestReels(username) {
  console.log(`[IG-Tracker] Fetching reels for @${username}...`);

  // Method 0: Instagram internal API with session cookie (fastest, most reliable)
  if (IG_SESSION_COOKIE) {
    const reels = await fetchViaSessionApi(username);
    if (reels.length > 0) {
      console.log(`[IG-Tracker] ✅ Got ${reels.length} reels via Session API for @${username}`);
      return reels;
    }
  }

  // Method 1: Puppeteer stealth (no login needed)
  let reels = await fetchViaPuppeteer(username);
  if (reels.length > 0) {
    console.log(`[IG-Tracker] ✅ Got ${reels.length} reels via Puppeteer for @${username}`);
    return reels;
  }

  // Method 2: Instagram unofficial API
  reels = await fetchViaUnofficialApi(username);
  if (reels.length > 0) {
    console.log(`[IG-Tracker] ✅ Got ${reels.length} reels via unofficial API for @${username}`);
    return reels;
  }

  // Method 3: Picuki mirror
  reels = await fetchViaPicuki(username);
  if (reels.length > 0) {
    console.log(`[IG-Tracker] ✅ Got ${reels.length} reels via Picuki for @${username}`);
    return reels;
  }

  // Method 4: RapidAPI
  reels = await fetchViaRapidAPI(username);
  if (reels.length > 0) {
    console.log(`[IG-Tracker] ✅ Got ${reels.length} reels via RapidAPI for @${username}`);
    return reels;
  }

  console.warn(`[IG-Tracker] ⚠️ Could not fetch reels for @${username}`);
  return [];
}

// ─── Channel Management ────────────────────────────────────────────────────────

async function getChannels() {
  const state = await readState();
  return state.channels;
}

async function addChannel(username) {
  const clean = username.replace(/^@/, '').trim().toLowerCase();
  const state = await readState();
  if (!state.channels.includes(clean)) {
    state.channels.push(clean);
    await writeState(state);
  }
  return state.channels;
}

async function removeChannel(username) {
  const clean = username.replace(/^@/, '').trim().toLowerCase();
  const state = await readState();
  state.channels = state.channels.filter(c => c !== clean);
  await writeState(state);
  return state.channels;
}

// ─── Affiliate Cache ───────────────────────────────────────────────────────────

async function getCachedAffiliateLink(shortcode) {
  const state = await readState();
  return state.affiliateCache?.[shortcode] || null;
}

async function setCachedAffiliateLink(shortcode, url) {
  const state = await readState();
  if (!state.affiliateCache) state.affiliateCache = {};
  state.affiliateCache[shortcode] = url;
  await writeState(state);
}

// ─── Main: Scan all channels for new reels ─────────────────────────────────────

/**
 * Scan all configured channels and return an array of new (unseen) reels.
 * Also marks them as seen so they won't be returned again.
 */
async function scanForNewReels() {
  const state = await readState();
  const newReels = [];

  for (const username of state.channels) {
    const reels = await fetchLatestReels(username);
    for (const reel of reels) {
      if (!reel.shortcode) continue;
      if (hasSeen(state, username, reel.shortcode)) {
        console.log(`[IG-Tracker] Already seen reel ${reel.shortcode} from @${username}, skipping.`);
        continue;
      }
      markSeen(state, username, reel.shortcode);
      newReels.push(reel);
    }
  }

  state.lastRunAt = new Date().toISOString();
  await writeState(state);

  console.log(`[IG-Tracker] Scan complete. Found ${newReels.length} new reel(s).`);
  return newReels;
}

async function getTrackerStatus() {
  const state = await readState();
  return {
    channels: state.channels,
    totalSeen: Object.values(state.seen).reduce((acc, arr) => acc + arr.length, 0),
    affiliateCacheSize: Object.keys(state.affiliateCache || {}).length,
    lastRunAt: state.lastRunAt,
    storage: igStorageService.getStorageInfo(),
  };
}

module.exports = {
  scanForNewReels,
  fetchLatestReels,
  getChannels,
  addChannel,
  removeChannel,
  getCachedAffiliateLink,
  setCachedAffiliateLink,
  getTrackerStatus,
};

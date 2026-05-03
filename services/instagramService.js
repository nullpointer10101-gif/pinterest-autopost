const axios = require('axios');

// instagram-url-direct may have optional native deps — guard for Vercel
let ig = null;
try {
  ig = require('instagram-url-direct').instagramGetUrl;
} catch (e) {
  console.warn('[Instagram] instagram-url-direct not available:', e.message);
}

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

function parseShortcode(url) {
  const match = url.match(/\/(reel|p|tv)\/([A-Za-z0-9_-]+)/);
  return match ? match[2] : 'UNKNOWN';
}

function cleanInstagramUrl(url) {
  try {
    const u = new URL(url);
    // Remove query parameters (utm_, etc.)
    return `${u.origin}${u.pathname}`.replace(/\/$/, '') + '/';
  } catch {
    return url;
  }
}

// ─── 1. Instagram URL Direct (local NPM) ──────────────────────────────────────
async function extractViaIGDirect(url) {
  if (!ig) return null;
  try {
    const cleaned = cleanInstagramUrl(url);
    const result = await ig(cleaned);
    // Result structure: { results_number, url_list, post_info, media_details: [...] }
    const mediaDetails = result?.media_details;
    if (Array.isArray(mediaDetails) && mediaDetails.length > 0) {
      const item = mediaDetails[0];
      const isVideo = item.type === 'video' || (item.url && item.url.toLowerCase().includes('.mp4'));
      return {
        username: result?.post_info?.owner_username || 'instagram_creator',
        caption: result?.post_info?.caption || '',
        thumbnailUrl: item.thumbnail || item.url,
        mediaUrl: item.url,
        mediaType: isVideo ? 'video' : 'image',
        shortcode: parseShortcode(url),
      };
    }
  } catch (e) {
    console.log('[Instagram] IG-Direct failed:', e.message);
  }
  return null;
}



// ─── 2. Ollie API (FREE, no key required) ─────────────────────────────────────
async function extractViaOllie(url) {
  try {
    const res = await axios.get(`https://ollie-api.com/ollie?url=${encodeURIComponent(url)}`, {
      timeout: 15000,
    });
    
    const d = res.data;
    // Ollie returns { image: "...", video: "...", title: "..." } or similar
    if (!d) return null;

    // Prefer video if present
    if (d.video) {
      return {
        username: 'instagram_creator',
        caption: d.title || '',
        thumbnailUrl: d.image || d.video,
        mediaUrl: d.video,
        mediaType: 'video',
        shortcode: parseShortcode(url),
      };
    } else if (d.image) {
      return {
        username: 'instagram_creator',
        caption: d.title || '',
        thumbnailUrl: d.image,
        mediaUrl: d.image,
        mediaType: 'image',
        shortcode: parseShortcode(url),
      };
    }
  } catch (e) {
    console.log(`[Ollie] failed: ${e.message}`);
  }
  return null;
}


// ─── 3. HTML scraping (deep: og:video + embedded JSON) ─────────────────────────
async function extractViaHTML(url) {
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 15000,
      maxRedirects: 5,
    });
    const html = res.data;

    // Helper: extract meta content
    const getMetaContent = (prop) => {
      const r1 = new RegExp(`<meta[^>]*?property\\s*=\\s*['"]${prop}['"][^>]*?content\\s*=\\s*['"]([^'"]+)['"][^>]*>`, 'i');
      const m = html.match(r1);
      if (m) return m[1];
      const r2 = new RegExp(`<meta[^>]*?content\\s*=\\s*['"]([^'"]+)['"][^>]*?property\\s*=\\s*['"]${prop}['"][^>]*>`, 'i');
      const r = html.match(r2);
      return r ? r[1] : null;
    };

    // Quick check: og:video
    let videoUrl = getMetaContent('og:video') || getMetaContent('og:video:url') || getMetaContent('og:video:secure_url');
    let imageUrl = getMetaContent('og:image') || getMetaContent('og:image:url') || getMetaContent('og:image:secure_url');
    const titleMatch = html.match(/<meta\s+property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i);

    if (videoUrl) {
      return {
        username: 'instagram_creator',
        caption: (titleMatch ? titleMatch[1] : '').replace(/&amp;/g, '&'),
        thumbnailUrl: (imageUrl || videoUrl).replace(/&amp;/g, '&'),
        mediaUrl: videoUrl.replace(/&amp;/g, '&'),
        mediaType: 'video',
        shortcode: parseShortcode(url),
      };
    }

    // If no og:video, try to extract from embedded JSON (application/ld+json or <script>window._sharedData)
    // Look for JSON-LD: <script type="application/ld+json">{"@type":"VideoObject","contentUrl":"..."}</script>
    const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (jsonLdMatch) {
      try {
        const ld = JSON.parse(jsonLdMatch[1]);
        // ld could be an array or single object
        const obj = Array.isArray(ld) ? ld.find(o => o['@type'] === 'VideoObject') || ld[0] : ld;
        if (obj && (obj.contentUrl || obj.videoUrl || obj.url)) {
          return {
            username: 'instagram_creator',
            caption: obj.description || obj.name || '',
            thumbnailUrl: obj.thumbnailUrl || obj.image || obj.contentUrl,
            mediaUrl: obj.contentUrl || obj.videoUrl || obj.url,
            mediaType: 'video',
            shortcode: parseShortcode(url),
          };
        }
      } catch (e) {
        console.log('[HTML] JSON-LD parse failed:', e.message);
      }
    }

    // Look for Instagram's internal JSON: window._sharedData = {...}; or __SEARCH_QUERY__
    const sharedDataMatch = html.match(/window\._sharedData\s*=\s*({[\s\S]*?});\s*<\/script>/);
    if (!sharedDataMatch) {
      // Try alternate pattern: <script type="text/javascript">window.__additionalDataLoaded(...)
      const additionalMatch = html.match(/window\.__additionalDataLoaded\('.*?',\s*({[\s\S]*?})\);/);
      if (additionalMatch) {
        // Could contain entry_data
      }
    }
    if (sharedDataMatch) {
      try {
        const shared = JSON.parse(sharedDataMatch[1]);
        const entry = shared?.entry_data?.post_page?.[0]?.graphql?.shortcode_media;
        if (entry) {
          const isVideo = entry?.is_video === true;
          const videoUrl = entry?.video_url || entry?.video_resources_video_url;
          const imageUrl = entry?.display_url || entry?.thumbnail_src;
          return {
            username: entry?.owner?.username || 'instagram_creator',
            caption: entry?.edge_media_to_caption?.edges?.[0]?.node?.text || '',
            thumbnailUrl: imageUrl,
            mediaUrl: videoUrl || imageUrl,
            mediaType: isVideo ? 'video' : 'image',
            shortcode: parseShortcode(url),
          };
        }
      } catch (e) {
        console.log('[HTML] sharedData parse failed:', e.message);
      }
    }

    // Fallback: if only image available
    if (imageUrl) {
      return {
        username: 'instagram_creator',
        caption: (titleMatch ? titleMatch[1] : '').replace(/&amp;/g, '&'),
        thumbnailUrl: imageUrl.replace(/&amp;/g, '&'),
        mediaUrl: imageUrl.replace(/&amp;/g, '&'),
        mediaType: 'image',
        shortcode: parseShortcode(url),
      };
    }
  } catch (e) {
    console.log('[Instagram] HTML scrape failed:', e.message);
  }
  return null;
}

// ─── 4. Microlink (FREE tier) ─────────────────────────────────────────────────
async function extractViaMicrolink(url) {
  try {
    const res = await axios.get(`https://api.microlink.io/?url=${encodeURIComponent(url)}&video=true`, { timeout: 10000 });
    if (res.data.status === 'success') {
      const d = res.data.data;
      return {
        username: d.author || 'creator',
        caption: d.title || '',
        thumbnailUrl: d.image?.url || '',
        mediaUrl: d.video?.url || d.image?.url || '',
        mediaType: d.video ? 'video' : 'image',
        shortcode: parseShortcode(url)
      };
    }
  } catch (e) {
    console.log('[Instagram] Microlink failed:', e.message);
  }
  return null;
}

// ─── 5. RapidAPI (only if key provided) ─────────────────────────────────────
async function extractViaRapidAPI(url) {
  if (!RAPIDAPI_KEY) return null;

  const services = [
    { host: 'instagram-downloader-download-instagram-stories-videos4.p.rapidapi.com', endpoint: 'https://instagram-downloader-download-instagram-stories-videos4.p.rapidapi.com/convert', paramMap: u => ({ url: u }) },
    { host: 'instagram-extractor.p.rapidapi.com', endpoint: 'https://instagram-extractor.p.rapidapi.com/api/v1/ig/post', paramMap: u => ({ url: u }) },
  ];

  for (const svc of services) {
    try {
      const res = await axios.get(svc.endpoint, {
        params: svc.paramMap(url),
        headers: { 'x-rapidapi-key': RAPIDAPI_KEY, 'x-rapidapi-host': svc.host },
        timeout: 10000,
      });
      const item = res.data?.result || res.data?.data || res.data;
      if (!item) continue;

      const mediaUrl = item?.video_url || item?.url || item?.download_url || '';
      const thumbnailUrl = item?.thumbnail || item?.thumbnail_url || item?.image || mediaUrl;

      if (mediaUrl || thumbnailUrl) {
        return {
          username: item?.username || item?.author || 'instagram_creator',
          caption: item?.caption || item?.title || item?.description || '',
          thumbnailUrl,
          mediaUrl,
          mediaType: (mediaUrl || '').toLowerCase().includes('.mp4') ? 'video' : 'image',
          shortcode: parseShortcode(url),
        };
      }
    } catch (e) {
      console.log(`[RapidAPI] ${svc.host} failed: ${e.message}`);
    }
  }
  return null;
}

// ─── Main Export ─────────────────────────────────────────────────────────────
async function extractReel(url) {
  if (!url || typeof url !== 'string') throw new Error('Invalid URL provided');
  const clean = url.trim();
  if (!/instagram\.com\/(reel|p|tv)\/[A-Za-z0-9_-]+/.test(clean)) {
    throw new Error('Not a valid Instagram URL');
  }

  console.log('[Instagram] Extracting:', clean);

  // Try in order of reliability (all free)
  let data = await extractViaIGDirect(clean);   // 1. Local NPM (fast, no rate limits)
  if (data) console.log('[Instagram] ✅ IG-Direct:', data.mediaType, data.mediaUrl?.substring(0, 80));

  if (!data) data = await extractViaOllie(clean); // 2. Ollie API (direct video)
  if (data) console.log('[Instagram] ✅ Ollie:', data.mediaType, data.mediaUrl?.substring(0, 80));

  if (!data) data = await extractViaHTML(clean);  // 3. HTML og:video scrape
  if (data) console.log('[Instagram] ✅ HTML:', data.mediaType, data.mediaUrl?.substring(0, 80));

  if (!data) data = await extractViaMicrolink(clean); // 4. Microlink free tier
  if (data) console.log('[Instagram] ✅ Microlink:', data.mediaType, data.mediaUrl?.substring(0, 80));


  if (!data) {
    console.log('[Instagram] ❌ All methods failed → demo mode');
    return {
      username: 'demo_user',
      caption: 'Demo: Could not fetch reel. Try a different URL.',
      thumbnailUrl: 'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=800',
      mediaUrl: 'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=800',
      mediaType: 'image',
      shortcode: parseShortcode(clean),
      isDemoMode: true,
    };
  }

  return data;
}

module.exports = { extractReel };

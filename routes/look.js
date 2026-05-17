'use strict';
const express = require('express');
const router  = express.Router();
const queueService   = require('../services/queueService');
const historyService = require('../services/historyService');

// ── Upstash helpers ───────────────────────────────────────────────────────────
const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL   || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

async function upstashGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(UPSTASH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', key]),
      signal: ctrl.signal
    });
    clearTimeout(t);
    const data = await res.json();
    const raw = data?.result;
    if (!raw) return null;
    return JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
  } catch { return null; }
}

async function upstashSet(key, value, ttl = 86400) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    await fetch(UPSTASH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', key, JSON.stringify(value), 'EX', ttl]),
      signal: ctrl.signal
    });
    clearTimeout(t);
  } catch {}
}

// ── Product Image via Serper Image Search ────────────────────────────────────
// Searches for product image using product name via Serper.dev images API
router.get('/:shortcode/product-image', async (req, res) => {
  const { url, name } = req.query;
  if (!url && !name) return res.json({ image: null });

  const cacheKey = `img2:${Buffer.from(url || name).toString('base64').slice(0, 40)}`;
  const cached = await upstashGet(cacheKey);
  if (cached) return res.json({ image: cached });

  const SERPER_KEY = process.env.SERPER_API_KEY || '';
  if (!SERPER_KEY) return res.json({ image: null });

  try {
    // Use Serper.dev images API to get real product photo
    const query = name || url;
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query + ' flipkart product', gl: 'in', hl: 'en', num: 5 }),
      signal: ctrl.signal
    });
    if (r.ok) {
      const data = await r.json();
      const images = data?.images || [];
      // Pick first image from Flipkart or any valid product image
      let imageUrl = null;
      for (const img of images) {
        const src = img.imageUrl || img.thumbnailUrl;
        if (src && (src.includes('rukminim') || src.includes('flipkart') || src.includes('fkimg'))) {
          imageUrl = src;
          break;
        }
      }
      // Fallback: just use first image result
      if (!imageUrl && images[0]) imageUrl = images[0].imageUrl || images[0].thumbnailUrl || null;
      if (imageUrl) {
        await upstashSet(cacheKey, imageUrl, 60 * 60 * 24 * 7);
        return res.json({ image: imageUrl });
      }
    }
    return res.json({ image: null });
  } catch (err) {
    console.warn('[Look] product-image serper error:', err.message);
    return res.json({ image: null });
  }
});

// ── Fresh Video URL ────────────────────────────────────────────────────────────
// Fetches fresh Instagram video URL using instagram-url-direct package
router.get('/:shortcode/fresh-video', async (req, res) => {
  const { shortcode } = req.params;
  const cacheKey = `freshvid2:${shortcode}`;
  const cached = await upstashGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const { instagramGetUrl } = require('instagram-url-direct');
    const result = await instagramGetUrl(`https://www.instagram.com/reel/${shortcode}/`);
    const videoUrl = result?.url_list?.[0] || null;
    const thumbnail = result?.media_details?.[0]?.thumbnail || null;
    if (videoUrl) {
      const data = { videoUrl, thumbnailUrl: thumbnail };
      // Cache for 3 hours — Instagram CDN URLs typically live 4-6h
      await upstashSet(cacheKey, data, 60 * 60 * 3);
      return res.json(data);
    }
  } catch (err) {
    console.warn('[Look] fresh-video error:', err.message);
  }

  return res.json({ videoUrl: null, thumbnailUrl: null });
});

// ── Products API ──────────────────────────────────────────────────────────────
router.get('/:shortcode/products', async (req, res) => {
  const { shortcode } = req.params;
  try {
    const lookData = await upstashGet(`look:${shortcode}`);
    let outfit = [];
    if (lookData?.productInfo?.outfit?.length > 0) {
      outfit = lookData.productInfo.outfit;
    } else if (lookData?.productInfo?.affiliateUrl) {
      outfit = [{ type: 'Main Piece', name: lookData.productInfo.name || 'Featured Item', url: lookData.productInfo.affiliateUrl, image: null }];
    }
    return res.json({ found: !!lookData, outfit });
  } catch (err) {
    return res.status(500).json({ found: false, outfit: [], error: err.message });
  }
});

// ── Main Storefront Page ──────────────────────────────────────────────────────
router.get('/:shortcode', async (req, res) => {
  try {
    const { shortcode } = req.params;

    // Fast path: individual Upstash key
    let lookData = await upstashGet(`look:${shortcode}`);
    if (lookData) {
      console.log(`[Look] ⚡ Fast path hit for ${shortcode}`);
    } else {
      console.log(`[Look] 🐢 No index key — falling back to full state for ${shortcode}`);
      const [queue, history] = await Promise.all([queueService.getQueue(), historyService.getAll()]);
      let found = queue.find(i => i.shortcode === shortcode) || null;
      const historyData = history.find(i =>
        i.shortcode === shortcode ||
        i.reelData?.shortcode === shortcode ||
        (i.url || '').includes(shortcode)
      );
      if (historyData) {
        if (!found) found = historyData;
        else if (!found.productInfo && historyData.productInfo) found.productInfo = historyData.productInfo;
      }
      lookData = found;
    }

    if (!lookData) {
      return res.status(404).send(`<!DOCTYPE html><html><body style="background:#09090b;color:white;font-family:sans-serif;text-align:center;padding:80px 20px">
        <div style="font-size:3rem;margin-bottom:20px">🔍</div>
        <h2 style="font-size:1.5rem;margin-bottom:12px">Look Not Found</h2>
        <p style="color:#a1a1aa">This link may have expired or does not exist.</p>
      </body></html>`);
    }

    const title        = lookData.aiContent?.title || lookData.productInfo?.name || lookData.title || 'Shop The Look';
    const thumbnailUrl = lookData.thumbnailUrl || lookData.reelData?.thumbnailUrl || '';
    const storedVideo  = lookData.mediaUrl || lookData.reelData?.mediaUrl || '';

    let outfit = [];
    if (lookData.productInfo?.outfit?.length > 0) {
      outfit = lookData.productInfo.outfit;
    } else if (lookData.productInfo?.affiliateUrl || lookData.affiliateLink) {
      outfit = [{
        type: 'Main Piece',
        name: lookData.productInfo?.name || lookData.aiContent?.title || 'Featured Item',
        url: lookData.productInfo?.affiliateUrl || lookData.affiliateLink,
        image: null,
        originalPrice: null
      }];
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Shop The Look</title>
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="Shop this curated look! Click to see all products.">
  <meta property="og:image" content="${thumbnailUrl}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #09090b;
      --card-bg: rgba(255,255,255,0.03);
      --card-border: rgba(255,255,255,0.08);
      --text: #ffffff;
      --muted: #a1a1aa;
      --accent: #f43f5e;
      --accent-glow: rgba(244,63,94,0.4);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      min-height: 100vh;
      background-image:
        radial-gradient(circle at 15% 50%, rgba(244,63,94,0.08), transparent 30%),
        radial-gradient(circle at 85% 20%, rgba(139,92,246,0.08), transparent 30%);
    }
    .container { max-width: 480px; margin: 0 auto; padding-bottom: 80px; }

    /* Header */
    .store-header {
      position: sticky; top: 0; z-index: 100;
      padding: 18px 24px;
      display: flex; align-items: center; justify-content: center; gap: 10px;
      font-weight: 800; font-size: 18px; letter-spacing: 3px; text-transform: uppercase;
      background: rgba(9,9,11,0.75); backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--card-border);
    }
    .store-header span {
      background: linear-gradient(135deg, #fff 0%, #a1a1aa 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .header-dot {
      width: 8px; height: 8px; border-radius: 50%; background: var(--accent);
      box-shadow: 0 0 8px var(--accent-glow); animation: pulse 2s infinite;
    }
    @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.6;transform:scale(0.85)} }

    /* Video Player */
    .video-wrap {
      position: relative; width: 100%; aspect-ratio: 9/16;
      background: #000; overflow: hidden;
      box-shadow: 0 24px 48px rgba(0,0,0,0.6);
    }
    .video-wrap::after {
      content: ''; position: absolute; bottom: 0; left: 0; right: 0;
      height: 200px;
      background: linear-gradient(to top, var(--bg) 0%, transparent 100%);
      pointer-events: none; z-index: 2;
    }
    #main-video {
      width: 100%; height: 100%; object-fit: cover;
      position: absolute; top: 0; left: 0;
    }
    .video-poster {
      width: 100%; height: 100%; object-fit: cover;
      position: absolute; top: 0; left: 0;
      transition: opacity 0.4s ease;
    }
    .video-loading {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      z-index: 3;
    }
    .spinner {
      width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.15);
      border-top-color: white; border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Section Title */
    .section-title {
      padding: 0 20px; margin: 28px 0 16px;
      display: flex; align-items: center; justify-content: space-between;
    }
    .section-title h2 { font-size: 1.2rem; font-weight: 700; }
    .count-badge {
      font-size: 0.75rem; font-weight: 700;
      background: #fff; color: #000;
      padding: 5px 12px; border-radius: 20px;
    }

    /* Product Grid */
    .product-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 0 12px;
    }
    .product-card {
      background: var(--card-bg); border: 1px solid var(--card-border);
      border-radius: 16px; overflow: hidden;
      transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
    }
    .product-card:hover {
      transform: translateY(-6px);
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
      border-color: rgba(255,255,255,0.18);
      background: rgba(255,255,255,0.05);
    }
    .product-card a { text-decoration: none; color: inherit; display: flex; flex-direction: column; height: 100%; }
    .img-wrap {
      position: relative; width: 100%; aspect-ratio: 3/4; overflow: hidden;
      background: #18181b;
    }
    .img-wrap img {
      width: 100%; height: 100%; object-fit: cover;
      transition: transform 0.5s ease;
    }
    .product-card:hover .img-wrap img { transform: scale(1.06); }
    .img-shimmer {
      position: absolute; inset: 0;
      background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }
    @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
    .type-badge {
      position: absolute; top: 8px; left: 8px;
      background: rgba(0,0,0,0.65); backdrop-filter: blur(6px);
      color: #fff; font-size: 9px; font-weight: 700;
      padding: 5px 10px; border-radius: 20px;
      text-transform: uppercase; letter-spacing: 1px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .product-body { padding: 14px; display: flex; flex-direction: column; flex: 1; }
    .product-name {
      font-size: 0.82rem; font-weight: 500; line-height: 1.4; margin-bottom: 8px;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .product-price { font-size: 1rem; font-weight: 700; margin-bottom: 14px; }
    .shop-btn {
      margin-top: auto; width: 100%;
      background: rgba(255,255,255,0.08); color: #fff;
      border: 1px solid rgba(255,255,255,0.15);
      padding: 11px 0; border-radius: 10px;
      font-family: 'Outfit', sans-serif; font-size: 0.78rem; font-weight: 700;
      letter-spacing: 1.2px; text-transform: uppercase; cursor: pointer;
      display: flex; align-items: center; justify-content: center; gap: 7px;
      transition: all 0.3s ease;
    }
    .product-card:hover .shop-btn { background: #fff; color: #000; box-shadow: 0 0 20px rgba(255,255,255,0.25); }

    /* Empty state */
    .empty-state {
      grid-column: 1/-1; text-align: center; padding: 50px 20px; color: var(--muted);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="store-header">
      <div class="header-dot"></div>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
      <span>Shop The Look</span>
      <div class="header-dot"></div>
    </div>

    <!-- Video Player -->
    <div class="video-wrap" id="video-wrap">
      ${thumbnailUrl ? `<img class="video-poster" id="video-poster" src="${thumbnailUrl}" alt="Loading video...">` : ''}
      <div class="video-loading" id="video-loading"><div class="spinner"></div></div>
      <video id="main-video" controls muted playsinline preload="auto"
        style="opacity:0;transition:opacity 0.5s ease;"
        onerror="window._videoFailed=true;document.getElementById('video-loading').style.display='none'">
      </video>
    </div>

    <!-- Products Section -->
    <div class="section-title">
      <h2>Curated Outfit</h2>
      <span class="count-badge" id="count-badge">${outfit.length} Items</span>
    </div>
    <div class="product-grid" id="product-grid"></div>
  </div>

  <script>
  (function() {
    const SHORTCODE = ${JSON.stringify(shortcode)};
    const STORED_VIDEO = ${JSON.stringify(storedVideo)};
    const outfit = ${JSON.stringify(outfit)};
    const grid = document.getElementById('product-grid');
    const video = document.getElementById('main-video');
    const poster = document.getElementById('video-poster');
    const loading = document.getElementById('video-loading');

    // ── Video Loading ───────────────────────────────────────────────────────────
    function tryPlayVideo(src) {
      if (!src) return false;
      video.src = src;
      video.load();
      
      video.addEventListener('canplay', () => {
        video.style.opacity = '1';
        if (poster) poster.style.opacity = '0';
        loading.style.display = 'none';
      }, { once: true });
      
      video.addEventListener('error', () => {
        loading.style.display = 'none';
        video.style.opacity = '0';
        if (poster) poster.style.opacity = '1';
      }, { once: true });

      return true;
    }

    // Try stored video URL first, fetch fresh if it fails
    async function initVideo() {
      // If stored URL is a direct video file (not Instagram CDN), use it
      if (STORED_VIDEO && !STORED_VIDEO.includes('cdninstagram') && !STORED_VIDEO.includes('.jpg') && !STORED_VIDEO.includes('.jpeg')) {
        tryPlayVideo(STORED_VIDEO);
        return;
      }

      // Fetch fresh video URL from our endpoint
      try {
        const r = await fetch('/look/' + SHORTCODE + '/fresh-video');
        const data = await r.json();
        if (data.videoUrl) {
          tryPlayVideo(data.videoUrl);
          return;
        }
      } catch {}

      // Final fallback: try stored URL anyway
      if (STORED_VIDEO && !STORED_VIDEO.includes('.jpg')) {
        tryPlayVideo(STORED_VIDEO);
        return;
      }

      // All failed — just show the poster image
      loading.style.display = 'none';
      if (poster) poster.style.opacity = '1';
    }

    initVideo();

    // ── Product Grid ────────────────────────────────────────────────────────────
    if (outfit.length === 0) {
      grid.innerHTML = '<div class="empty-state"><div style="font-size:2.5rem;margin-bottom:14px">🛍️</div><p style="font-size:1rem;font-weight:600;margin-bottom:8px">Products Coming Soon</p><p style="font-size:0.85rem">We are curating the best affiliate links for this look.</p></div>';
      return;
    }

    // Render cards with shimmer placeholders first
    grid.innerHTML = outfit.map((item, i) => \`
      <div class="product-card">
        <a href="\${item.url}" target="_blank" rel="noopener noreferrer">
          <div class="img-wrap">
            <div class="img-shimmer" id="shimmer-\${i}"></div>
            <img id="img-\${i}" src="" alt="\${item.name}"
              style="opacity:0;transition:opacity 0.4s ease;"
              onerror="this.src='/img-fallback.svg';this.style.opacity='1';document.getElementById('shimmer-\${i}').remove()">
            <span class="type-badge">\${item.type}</span>
          </div>
          <div class="product-body">
            <p class="product-name">\${item.name}</p>
            <p class="product-price">\${item.originalPrice ? '₹' + item.originalPrice : 'View Price'}</p>
            <button class="shop-btn">
              Shop Item
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </button>
          </div>
        </a>
      </div>
    \`).join('');

    // Now fetch real product images in parallel
    outfit.forEach((item, i) => {
      if (item.image) {
        // Already have an image stored
        const imgEl = document.getElementById('img-' + i);
        const shimEl = document.getElementById('shimmer-' + i);
        if (imgEl) {
          imgEl.onload = () => { imgEl.style.opacity = '1'; if (shimEl) shimEl.remove(); };
          imgEl.src = item.image;
        }
      } else if (item.url || item.name) {
        // Fetch via Serper image search using product name
        const encodedName = encodeURIComponent(item.name || '');
        const encodedUrl = encodeURIComponent(item.url || '');
        fetch('/look/' + SHORTCODE + '/product-image?name=' + encodedName + '&url=' + encodedUrl)
          .then(r => r.json())
          .then(data => {
            const imgEl = document.getElementById('img-' + i);
            const shimEl = document.getElementById('shimmer-' + i);
            if (imgEl && data.image) {
              imgEl.onload = () => { imgEl.style.opacity = '1'; if (shimEl) shimEl.remove(); };
              imgEl.onerror = () => { imgEl.src = ''; imgEl.style.opacity = '0'; if (shimEl) shimEl.style.animation = 'none'; };
              imgEl.src = data.image;
            } else if (shimEl) {
              shimEl.style.animation = 'none';
              shimEl.style.background = '#18181b';
            }
          })
          .catch(() => {
            const shimEl = document.getElementById('shimmer-' + i);
            if (shimEl) { shimEl.style.animation = 'none'; shimEl.style.background = '#18181b'; }
          });
      } else {
        const shimEl = document.getElementById('shimmer-' + i);
        if (shimEl) { shimEl.style.animation = 'none'; shimEl.style.background = '#18181b'; }
      }
    });

  })();
  </script>
</body>
</html>`;

    res.send(html);
  } catch (err) {
    console.error('[Look Route] Error:', err);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;

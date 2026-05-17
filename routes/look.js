const express = require('express');
const router = express.Router();
const queueService = require('../services/queueService');
const historyService = require('../services/historyService');
const aiService = require('../services/aiService');
const flipkartSearchService = require('../services/flipkartSearchService');
const earnKaroService = require('../services/earnKaroService');
const axios = require('axios');

// ── Upstash cache helpers ─────────────────────────────────────────────────────
const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL   || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

async function cacheGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const res = await axios.post(UPSTASH_URL, ['GET', key], {
      timeout: 4000,
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    });
    const raw = res.data?.result;
    if (!raw) return null;
    return JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
  } catch { return null; }
}

async function cacheSet(key, value) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  try {
    await axios.post(UPSTASH_URL, ['SET', key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS], {
      timeout: 4000,
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    });
  } catch {}
}


router.get('/:shortcode', async (req, res) => {
  try {
    const { shortcode } = req.params;
    
    const queue = await queueService.getQueue();
    let lookData = queue.find(item => item.shortcode === shortcode);
    
    if (!lookData) {
      const history = await historyService.getAll();
      lookData = history.find(item => 
        item.shortcode === shortcode || 
        item.reelData?.shortcode === shortcode || 
        (item.url || '').includes(`/${shortcode}`)
      );
    }
    
    if (!lookData) {
      return res.status(404).send(`
        <html>
        <body style="background:#0f0f11; color:white; font-family:sans-serif; text-align:center; padding:50px;">
          <h2>Look Not Found or Expired</h2>
        </body>
        </html>
      `);
    }

    // Normalize fields — queue items and history items have different shapes
    const caption = lookData.caption || lookData.reelData?.caption || lookData.aiContent?.description || '';
    const username = lookData.username || lookData.reelData?.username || '';
    const thumbnailUrl = lookData.thumbnailUrl || lookData.reelData?.thumbnailUrl || '';
    const mediaUrl = lookData.mediaUrl || lookData.reelData?.thumbnailUrl || '';

    let outfit = [];
    const cacheKey = `look_outfit_${shortcode}`;

    // 1. Best case: productInfo.outfit already populated (AI ran during posting)
    if (lookData.productInfo?.outfit?.length > 0) {
      outfit = lookData.productInfo.outfit;
      console.log(`[Look] ✅ Using stored outfit (${outfit.length} items) for ${shortcode}`);
    }
    // 2. Single affiliateUrl stored directly on productInfo
    else if (lookData.productInfo?.affiliateUrl) {
      outfit.push({
        type: 'Main Piece',
        name: lookData.productInfo.name || 'Featured Item',
        url: lookData.productInfo.affiliateUrl,
        image: thumbnailUrl,
        originalPrice: null
      });
    }
    // 3. Check Upstash cache before running an expensive live search
    else {
      const cached = await cacheGet(cacheKey);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        outfit = cached;
        console.log(`[Look] ⚡ Cache hit for ${shortcode} (${outfit.length} items)`);
      } else {
        // 4. Cache miss — run full live AI + Flipkart + EarnKaro pipeline
        console.log(`[Look] No stored products for ${shortcode} — running live search...`);
        try {
          // Try outfit first
          const outfitData = await aiService.identifyOutfit({ caption, username, thumbnailUrl, mediaUrl });
          const itemsToSearch = (outfitData.found && outfitData.items?.length > 0)
            ? outfitData.items
            : null;

          if (itemsToSearch) {
            for (const outItem of itemsToSearch) {
              const queries = {
                exactMatchQuery: outItem.query,
                similarMatchQuery: outItem.query,
                broadMatchQuery: outItem.query.split(' ').slice(0, 3).join(' ')
              };
              const fp = await flipkartSearchService.findProduct(queries, outItem.query);
              if (fp) {
                const ek = await earnKaroService.makeAffiliateLink(fp.url);
                if (ek?.affiliateUrl) {
                  outfit.push({
                    type: outItem.type || 'Item',
                    name: fp.title,
                    url: ek.affiliateUrl,
                    image: fp.image || thumbnailUrl,
                    originalPrice: fp.price
                  });
                }
              }
            }
          }

          // If outfit search failed, try single product
          if (outfit.length === 0) {
            const productData = await aiService.identifyProduct({ caption, username, thumbnailUrl, mediaUrl });
            if (productData.found) {
              const queries = {
                exactMatchQuery: productData.exactMatchQuery,
                similarMatchQuery: productData.similarMatchQuery,
                broadMatchQuery: productData.broadMatchQuery
              };
              const fp = await flipkartSearchService.findProduct(queries, productData.productName);
              if (fp) {
                const ek = await earnKaroService.makeAffiliateLink(fp.url);
                if (ek?.affiliateUrl) {
                  outfit.push({
                    type: 'Main Piece',
                    name: fp.title,
                    url: ek.affiliateUrl,
                    image: fp.image || thumbnailUrl,
                    originalPrice: fp.price
                  });
                }
              }
            }
          }

          // Cache results if we found anything (24h TTL)
          if (outfit.length > 0) {
            await cacheSet(cacheKey, outfit);
            console.log(`[Look] 💾 Cached ${outfit.length} products for ${shortcode}`);
          }
        } catch (aiErr) {
          console.warn(`[Look] Live product search failed for ${shortcode}:`, aiErr.message);
        }
      }
    }

    const title = lookData.title || lookData.aiContent?.title || lookData.productInfo?.name || 'Shop The Look';
    const fallbackImage = thumbnailUrl;


    let itemsHtml = '';
    for (const item of outfit) {
      const priceDisplay = item.originalPrice ? '<div class="price">₹' + item.originalPrice + '</div>' : '<div class="price">View Price</div>';
      
      itemsHtml += `
        <div class="product-card">
          <a href="${item.url}" target="_blank" rel="noopener noreferrer">
            <div class="img-wrapper">
              <img src="${item.image || fallbackImage}" alt="${item.name}">
              <div class="glass-badge">${item.type}</div>
            </div>
            <div class="product-info">
              <h3 class="product-name">${item.name}</h3>
              ${priceDisplay}
              <button class="buy-button">
                <span>Shop Item</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
              </button>
            </div>
          </a>
        </div>
      `;
    }

    if (outfit.length === 0) {
      itemsHtml = `
        <div style="grid-column:1/-1; text-align:center; padding:40px 20px; color:var(--text-muted);">
          <div style="font-size:2rem; margin-bottom:12px;">🛍️</div>
          <p style="font-size:1rem; font-weight:500; margin-bottom:8px;">Products Coming Soon</p>
          <p style="font-size:0.85rem;">We're curating the best affiliate links for this look.</p>
        </div>
      `;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Shop The Look</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-color: #09090b;
      --card-bg: rgba(255, 255, 255, 0.03);
      --card-border: rgba(255, 255, 255, 0.08);
      --text-main: #ffffff;
      --text-muted: #a1a1aa;
      --accent: #f43f5e;
      --accent-glow: rgba(244, 63, 94, 0.4);
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body { 
      font-family: 'Outfit', sans-serif; 
      background-color: var(--bg-color); 
      color: var(--text-main); 
      line-height: 1.5;
      background-image: 
        radial-gradient(circle at 15% 50%, rgba(244, 63, 94, 0.08), transparent 25%),
        radial-gradient(circle at 85% 30%, rgba(139, 92, 246, 0.08), transparent 25%);
      min-height: 100vh;
    }

    .container { 
      max-width: 540px; 
      margin: 0 auto; 
      padding-bottom: 60px;
      position: relative;
    }

    /* Modern Glass Header */
    .store-header { 
      position: sticky; 
      top: 0; 
      z-index: 100;
      padding: 20px; 
      text-align: center; 
      font-weight: 800; 
      font-size: 22px; 
      letter-spacing: 2px; 
      text-transform: uppercase;
      background: rgba(9, 9, 11, 0.7);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--card-border);
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 10px;
    }
    
    .store-header span {
      background: linear-gradient(135deg, #fff, #a1a1aa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    /* Cinematic Video Player */
    .video-section { 
      position: relative; 
      width: 100%; 
      aspect-ratio: 9/16; 
      background: #000; 
      overflow: hidden;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }
    
    .video-section::after {
      content: '';
      position: absolute;
      bottom: 0; left: 0; right: 0; height: 150px;
      background: linear-gradient(to top, var(--bg-color) 0%, transparent 100%);
      pointer-events: none;
    }

    video { 
      width: 100%; 
      height: 100%; 
      object-fit: cover; 
    }

    /* Shop Title Area */
    .shop-title-container {
      padding: 0 24px;
      margin-top: -30px;
      position: relative;
      z-index: 10;
      margin-bottom: 24px;
    }

    .shop-title { 
      font-size: 1.5rem; 
      font-weight: 700; 
      display: flex; 
      align-items: center; 
      justify-content: space-between;
    }

    .item-count { 
      font-size: 0.8rem; 
      font-weight: 600; 
      color: var(--bg-color); 
      background: #fff; 
      padding: 6px 12px; 
      border-radius: 30px;
      box-shadow: 0 4px 15px rgba(255,255,255,0.2);
    }

    /* Premium Glassmorphic Grid */
    .product-grid { 
      display: grid; 
      grid-template-columns: 1fr 1fr; 
      gap: 16px; 
      padding: 0 20px; 
    }

    .product-card { 
      background: var(--card-bg); 
      border: 1px solid var(--card-border);
      border-radius: 16px; 
      overflow: hidden; 
      transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }
    
    .product-card a { 
      text-decoration: none; 
      color: inherit; 
      display: flex; 
      flex-direction: column; 
      height: 100%; 
    }

    .img-wrapper { 
      position: relative; 
      width: 100%; 
      aspect-ratio: 4/5; 
      overflow: hidden; 
    }
    
    .img-wrapper img { 
      width: 100%; 
      height: 100%; 
      object-fit: cover; 
      transition: transform 0.5s ease;
    }

    .glass-badge { 
      position: absolute; 
      top: 10px; 
      left: 10px; 
      background: rgba(0,0,0,0.6); 
      backdrop-filter: blur(4px);
      color: #fff; 
      font-size: 10px; 
      padding: 6px 10px; 
      border-radius: 20px; 
      text-transform: uppercase; 
      letter-spacing: 1px; 
      font-weight: 600; 
      border: 1px solid rgba(255,255,255,0.1);
    }

    .product-info { 
      padding: 16px; 
      display: flex; 
      flex-direction: column; 
      flex-grow: 1; 
    }

    .product-name { 
      font-size: 0.9rem; 
      font-weight: 500; 
      color: var(--text-main); 
      margin-bottom: 8px; 
      display: -webkit-box; 
      -webkit-line-clamp: 2; 
      -webkit-box-orient: vertical; 
      overflow: hidden; 
      line-height: 1.4;
    }

    .price { 
      font-weight: 700; 
      font-size: 1rem; 
      margin-bottom: 16px; 
      color: #fff; 
    }

    .buy-button { 
      margin-top: auto; 
      width: 100%; 
      background: rgba(255,255,255,0.1); 
      color: #fff; 
      border: 1px solid rgba(255,255,255,0.2); 
      padding: 12px 0; 
      border-radius: 12px; 
      font-weight: 600; 
      font-size: 0.85rem; 
      cursor: pointer; 
      text-transform: uppercase; 
      letter-spacing: 1px;
      font-family: 'Outfit', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.3s ease;
    }

    /* Hover Micro-Animations */
    .product-card:hover { 
      transform: translateY(-5px); 
      box-shadow: 0 15px 30px rgba(0,0,0,0.4);
      border-color: rgba(255,255,255,0.15);
      background: rgba(255, 255, 255, 0.05);
    }
    
    .product-card:hover .img-wrapper img {
      transform: scale(1.05);
    }
    
    .product-card:hover .buy-button { 
      background: #fff; 
      color: #000;
      box-shadow: 0 0 20px rgba(255,255,255,0.3);
    }

    /* Add pulsing animation to header */
    @keyframes pulse-glow {
      0% { box-shadow: 0 0 0 0 var(--accent-glow); }
      70% { box-shadow: 0 0 0 10px rgba(244, 63, 94, 0); }
      100% { box-shadow: 0 0 0 0 rgba(244, 63, 94, 0); }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="store-header">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
      <span>Shop The Look</span>
    </div>
    
    <div class="video-section">
      <video src="${mediaUrl}" poster="${fallbackImage}" controls autoplay loop muted playsinline></video>
    </div>
    
    <div class="shop-title-container">
      <div class="shop-title">
        Curated Outfit
        <span class="item-count">${outfit.length} Items</span>
      </div>
    </div>

    <div class="product-grid">
      ${itemsHtml}
    </div>
  </div>
</body>
</html>`;

    res.send(html);
  } catch (err) {
    console.error('[Look Route] Error:', err);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;

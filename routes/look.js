const express = require('express');
const router = express.Router();
const queueService = require('../services/queueService');
const historyService = require('../services/historyService');

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

    const outfit = lookData.productInfo?.outfit || [];
    
    if (outfit.length === 0 && lookData.productInfo?.affiliateUrl) {
      outfit.push({
        type: 'Main Piece',
        name: lookData.productInfo.name || 'Featured Item',
        url: lookData.productInfo.affiliateUrl,
        image: lookData.thumbnailUrl,
        originalPrice: null
      });
    }

    const title = lookData.title || lookData.productInfo?.name || 'Shop The Look';
    const videoUrl = lookData.mediaUrl;
    const fallbackImage = lookData.thumbnailUrl;

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
      <video src="${videoUrl}" poster="${fallbackImage}" controls autoplay loop muted playsinline></video>
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

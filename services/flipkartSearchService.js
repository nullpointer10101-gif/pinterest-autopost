const axios = require('axios');

const FLIPKART_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-IN,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
};

/**
 * Extract product list from Flipkart search page HTML using JSON-LD (stable, CSS-independent).
 */
function extractFromJsonLd(html) {
  const products = [];
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        // ItemList from search results
        if (item['@type'] === 'ItemList' && Array.isArray(item.itemListElement)) {
          for (const el of item.itemListElement) {
            const product = el.item || el;
            if (product.name && product.url) {
              products.push({
                title: product.name,
                url: product.url.startsWith('http') ? product.url : `https://www.flipkart.com${product.url}`,
                price: product.offers?.price || product.offers?.lowPrice || null,
                rating: product.aggregateRating?.ratingValue || null,
                image: product.image || null,
              });
            }
          }
        }
        // Single Product page
        if (item['@type'] === 'Product' && item.name && item.url) {
          products.push({
            title: item.name,
            url: item.url.startsWith('http') ? item.url : `https://www.flipkart.com${item.url}`,
            price: item.offers?.price || null,
            rating: item.aggregateRating?.ratingValue || null,
            image: item.image || null,
          });
        }
      }
    } catch (e) {
      // silent — bad JSON-LD block
    }
  }
  return products;
}

/**
 * Fallback: extract product links from raw HTML anchor tags.
 */
function extractFromHtmlLinks(html) {
  const products = [];
  // Match product links like /product-name/p/ITEMCODE
  const linkRegex = /href="(\/[^"]*\/p\/[A-Z0-9]{16}[^"]*)"/g;
  const titleRegex = /<[^>]+class="[^"]*KzDlHZ[^"]*"[^>]*>([^<]{5,120})<\/[^>]+>/g;

  const links = [];
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    const url = `https://www.flipkart.com${m[1].split('"')[0]}`;
    if (!links.includes(url)) links.push(url);
  }

  const titles = [];
  while ((m = titleRegex.exec(html)) !== null) {
    titles.push(m[1].trim());
  }

  for (let i = 0; i < Math.min(links.length, 5); i++) {
    products.push({
      title: titles[i] || `Product ${i + 1}`,
      url: links[i],
      price: null,
      rating: null,
      image: null,
    });
  }
  return products;
}

/**
 * Search Flipkart for a product query. Returns the best matching product.
 */
async function searchFlipkart(query) {
  const encoded = encodeURIComponent(query);
  const searchUrl = `https://www.flipkart.com/search?q=${encoded}&sort=popularity`;

  console.log(`[Flipkart] Searching: "${query}"`);

  try {
    const res = await axios.get(searchUrl, {
      headers: FLIPKART_HEADERS,
      timeout: 15000,
      maxRedirects: 3,
    });

    const html = res.data;

    // Primary: JSON-LD (most stable)
    let products = extractFromJsonLd(html);

    // Fallback: HTML link scraping
    if (products.length === 0) {
      console.log('[Flipkart] JSON-LD empty, falling back to HTML link scrape...');
      products = extractFromHtmlLinks(html);
    }

    if (products.length === 0) {
      console.warn('[Flipkart] No products found for query:', query);
      return null;
    }

    // Prefer products with rating >= 4.0
    const highRated = products.filter(p => p.rating && parseFloat(p.rating) >= 4.0);
    const best = highRated.length > 0 ? highRated[0] : products[0];

    console.log(`[Flipkart] ✅ Found: "${best.title}" — ${best.url}`);
    return best;
  } catch (err) {
    console.error('[Flipkart] Search failed:', err.message);
    return null;
  }
}

/**
 * Main entry: tries exact query, then falls back to category-level search.
 * @param {string} productName - Exact product name from AI
 * @param {string} category - Product category (electronics|fashion|home|beauty|other)
 */
async function findProduct(productName, category = 'other') {
  // Step 1: Try exact product name
  let result = await searchFlipkart(productName);
  if (result) return result;

  // Step 2: Try simplified query (first 4 words only)
  const simplified = productName.split(' ').slice(0, 4).join(' ');
  if (simplified !== productName) {
    console.log(`[Flipkart] Trying simplified query: "${simplified}"`);
    result = await searchFlipkart(simplified);
    if (result) return result;
  }

  // Step 3: Category fallback
  const categoryQueries = {
    electronics: 'best selling electronics gadgets',
    fashion: 'trending fashion outfit',
    home: 'home decor bestseller',
    beauty: 'skincare beauty bestseller',
    other: 'trending products bestseller',
  };
  const fallbackQuery = categoryQueries[category] || categoryQueries.other;
  console.log(`[Flipkart] Category fallback: "${fallbackQuery}"`);
  result = await searchFlipkart(fallbackQuery);
  return result; // may be null — caller handles this
}

module.exports = { findProduct, searchFlipkart };

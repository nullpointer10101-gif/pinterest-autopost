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
 * We extract the title from the URL slug since CSS classes change constantly.
 */
function extractFromHtmlLinks(html) {
  const products = [];
  // Match product links like /product-name/p/ITEMCODE
  const linkRegex = /href="(\/([^"]+)\/p\/[A-Z0-9]{16}[^"]*)"/g;
  
  const linksMap = new Map();
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    const fullPath = m[1];
    const slug = m[2]; // this is the product-name part
    const url = `https://www.flipkart.com${fullPath.split('"')[0]}`;
    
    if (!linksMap.has(url)) {
      // Decode slug and replace hyphens with spaces to form a readable title
      let title = decodeURIComponent(slug).replace(/-/g, ' ');
      // Capitalize words
      title = title.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      linksMap.set(url, title);
    }
  }

  let i = 0;
  for (const [url, title] of linksMap.entries()) {
    if (i >= 5) break;
    products.push({
      title: title || `Product ${i + 1}`,
      url: url,
      price: null,
      rating: null,
      image: null,
    });
    i++;
  }
  return products;
}

/**
 * Calculate simple text similarity score (0 to 1) based on word overlap.
 */
function calculateSimilarity(target, candidate) {
  if (!target || !candidate) return 0;
  
  const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  const targetWords = normalize(target);
  const candidateWords = normalize(candidate);
  
  if (targetWords.length === 0) return 0;
  
  let matches = 0;
  for (const word of targetWords) {
    if (candidateWords.includes(word)) matches++;
  }
  
  return matches / targetWords.length;
}

/**
 * Search Flipkart for a product query. Returns a list of products.
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
      products = extractFromHtmlLinks(html);
    }

    if (products.length === 0) {
      console.warn('[Flipkart] No products found for query:', query);
      return [];
    }
    
    return products;
  } catch (err) {
    console.error('[Flipkart] Search failed:', err.message);
    return [];
  }
}

/**
 * High System Design Algorithm for finding the most accurate product.
 * Evaluates results from tiered queries (Exact -> Similar -> Broad) using a similarity threshold.
 * 
 * @param {Object} queries - Object containing exactMatchQuery, similarMatchQuery, broadMatchQuery
 * @param {string} originalProductName - The full product name generated by AI for scoring baseline
 */
async function findProduct(queries, originalProductName) {
  const queryTiers = [
    { name: 'Exact', text: queries.exactMatchQuery, minScore: 0.5 },
    { name: 'Similar', text: queries.similarMatchQuery, minScore: 0.3 },
    { name: 'Broad', text: queries.broadMatchQuery, minScore: 0.1 }
  ];

  let bestMatch = null;
  let highestScore = -1;

  for (const tier of queryTiers) {
    if (!tier.text || tier.text === 'other') continue;

    console.log(`\n[Flipkart] Trying ${tier.name} Query: "${tier.text}"`);
    const products = await searchFlipkart(tier.text);
    
    if (products.length === 0) continue;

    // Score all products returned by this query
    for (const product of products) {
      // Score against both the original name and the query itself
      const scoreVsName = calculateSimilarity(originalProductName, product.title);
      const scoreVsQuery = calculateSimilarity(tier.text, product.title);
      const finalScore = Math.max(scoreVsName, scoreVsQuery);

      // Boost score slightly if it has a price (filters out junk/accessories sometimes)
      const priceBoost = product.price ? 0.1 : 0;
      const totalScore = finalScore + priceBoost;

      if (totalScore > highestScore) {
        highestScore = totalScore;
        bestMatch = product;
      }
    }

    // If we found a product that meets the minimum confidence threshold for this tier, stop searching.
    if (highestScore >= tier.minScore && bestMatch) {
      console.log(`[Flipkart] ✅ Passed threshold (${highestScore.toFixed(2)} >= ${tier.minScore}) on ${tier.name} tier.`);
      console.log(`[Flipkart] ✅ Winner: "${bestMatch.title}" — ${bestMatch.url}`);
      return bestMatch;
    } else if (bestMatch) {
      console.log(`[Flipkart] ⚠️ Best match on ${tier.name} tier scored ${highestScore.toFixed(2)} (below threshold ${tier.minScore}). Exploring next tier...`);
    }
  }

  // If we exhausted all tiers and nothing passed the minimum threshold, reject it.
  // We strictly want the EXACT or highly similar product, not a random guess.
  console.log(`[Flipkart] ❌ Exhausted all tiers. No product met the strict similarity threshold.`);
  console.log(`[Flipkart] ❌ Rejecting best match (Score: ${highestScore.toFixed(2)}) to avoid posting the wrong product.`);
  return null;
}

module.exports = { findProduct, searchFlipkart };

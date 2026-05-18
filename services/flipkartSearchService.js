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

const STOP_WORDS = new Set([
  'for', 'and', 'the', 'with', 'men', 'man', 'mens', 'boys', 'women', 'womens',
  'shop', 'buy', 'online', 'pack', 'combo', 'set', 'new', 'latest', 'style',
]);

const COLOR_TERMS = [
  'black', 'white', 'red', 'blue', 'navy', 'green', 'olive', 'grey', 'gray',
  'brown', 'beige', 'cream', 'khaki', 'maroon', 'burgundy', 'yellow', 'orange',
  'pink', 'purple', 'violet', 'teal', 'cyan', 'charcoal', 'tan', 'camel',
  'mustard', 'lavender', 'ivory', 'off white', 'sky blue',
];

const STYLE_TERMS = [
  'oversized', 'slim fit', 'regular fit', 'relaxed fit', 'loose fit', 'baggy',
  'formal', 'casual', 'printed', 'solid', 'striped', 'checked', 'denim',
  'corduroy', 'linen', 'cotton', 'cargo', 'track', 'polo', 'graphic',
  'satin', 'leather', 'suede', 'high top', 'low top',
];

const PRODUCT_TYPE_RULES = [
  {
    key: 'tshirt',
    label: 'T-Shirt',
    queryTerm: 'men t shirt',
    terms: ['t shirt', 'tshirt', 'tee', 'tees', 'polo tshirt', 'polo t shirt', 'round neck'],
  },
  {
    key: 'shirt',
    label: 'Shirt',
    queryTerm: 'men shirt',
    terms: ['shirt', 'shirts', 'button down', 'buttondown', 'overshirt', 'formal shirt', 'casual shirt'],
    exclude: ['t shirt', 'tshirt', 'tee', 'tees', 'round neck'],
  },
  {
    key: 'pants',
    label: 'Pants',
    queryTerm: 'men pants',
    terms: ['pants', 'pant', 'trouser', 'trousers', 'track pants', 'cargo pants', 'chinos', 'joggers'],
  },
  {
    key: 'jeans',
    label: 'Jeans',
    queryTerm: 'men jeans',
    terms: ['jeans', 'denim jeans'],
  },
  {
    key: 'shorts',
    label: 'Shorts',
    queryTerm: 'men shorts',
    terms: ['shorts', 'bermuda'],
  },
  {
    key: 'hoodie',
    label: 'Hoodie',
    queryTerm: 'men hoodie',
    terms: ['hoodie', 'hoodies', 'hooded sweatshirt'],
  },
  {
    key: 'sweatshirt',
    label: 'Sweatshirt',
    queryTerm: 'men sweatshirt',
    terms: ['sweatshirt', 'sweatshirts', 'sweater'],
  },
  {
    key: 'jacket',
    label: 'Jacket',
    queryTerm: 'men jacket',
    terms: ['jacket', 'jackets', 'bomber', 'windcheater', 'shacket'],
  },
  {
    key: 'blazer',
    label: 'Blazer',
    queryTerm: 'men blazer',
    terms: ['blazer', 'blazers'],
  },
  {
    key: 'kurta',
    label: 'Kurta',
    queryTerm: 'men kurta',
    terms: ['kurta', 'kurtas', 'sherwani'],
  },
  {
    key: 'shoes',
    label: 'Shoes',
    queryTerm: 'men shoes',
    terms: ['shoe', 'shoes', 'sneaker', 'sneakers', 'loafer', 'loafers', 'boots', 'sandals', 'sliders'],
  },
  {
    key: 'belt',
    label: 'Belt',
    queryTerm: 'men belt',
    terms: ['belt', 'belts'],
  },
  {
    key: 'watch',
    label: 'Watch',
    queryTerm: 'men watch',
    terms: ['watch', 'watches'],
  },
  {
    key: 'sunglasses',
    label: 'Sunglasses',
    queryTerm: 'men sunglasses',
    terms: ['sunglasses', 'sunglass', 'shades'],
  },
  {
    key: 'wallet',
    label: 'Wallet',
    queryTerm: 'men wallet',
    terms: ['wallet', 'wallets'],
  },
  {
    key: 'bag',
    label: 'Bag',
    queryTerm: 'men bag',
    terms: ['bag', 'bags', 'backpack', 'sling bag', 'duffle'],
  },
  {
    key: 'cap',
    label: 'Cap',
    queryTerm: 'men cap',
    terms: ['cap', 'caps', 'hat', 'beanie'],
  },
];

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasTerm(text, term) {
  const normalizedTerm = normalizeText(term);
  if (!normalizedTerm) return false;
  return new RegExp(`(^|\\s)${normalizedTerm.replace(/\s+/g, '\\s+')}($|\\s)`, 'i').test(text);
}

function detectProductType(text) {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  for (const rule of PRODUCT_TYPE_RULES) {
    const hasExcludedTerm = (rule.exclude || []).some((term) => hasTerm(normalized, term));
    if (hasExcludedTerm) continue;

    if (rule.terms.some((term) => hasTerm(normalized, term))) {
      return rule.key;
    }
  }

  return null;
}

function detectAllProductTypes(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const matches = [];
  for (const rule of PRODUCT_TYPE_RULES) {
    const hasExcludedTerm = (rule.exclude || []).some((term) => hasTerm(normalized, term));
    if (hasExcludedTerm) continue;
    if (rule.terms.some((term) => hasTerm(normalized, term))) {
      matches.push(rule.key);
    }
  }
  return Array.from(new Set(matches));
}

function getProductTypeLabel(type) {
  const rule = PRODUCT_TYPE_RULES.find((item) => item.key === type);
  return rule?.label || 'Product';
}

function getProductTypeQueryTerm(type) {
  const rule = PRODUCT_TYPE_RULES.find((item) => item.key === type);
  return rule?.queryTerm || '';
}

function isProductTypeMatch(targetText, candidateText, expectedType = null) {
  const targetType = expectedType || detectProductType(targetText);
  if (!targetType) return true;

  const candidateTypes = detectAllProductTypes(candidateText);
  if (!candidateTypes.length) return false;
  return candidateTypes.length === 1 && candidateTypes[0] === targetType;
}

function extractVisualSignals(text) {
  const normalized = normalizeText(text);
  const colors = COLOR_TERMS.filter((term) => hasTerm(normalized, term));
  const styles = STYLE_TERMS.filter((term) => hasTerm(normalized, term));
  return {
    colors: Array.from(new Set(colors)),
    styles: Array.from(new Set(styles)),
  };
}

function buildVisualQuery(originalProductName, expectedType) {
  const typeQueryTerm = getProductTypeQueryTerm(expectedType);
  const signals = extractVisualSignals(originalProductName);
  return [
    ...signals.colors.slice(0, 2),
    ...signals.styles.slice(0, 3),
    typeQueryTerm,
  ].filter(Boolean).join(' ');
}

/**
 * Calculate text similarity score (0 to 1) based on meaningful word overlap.
 */
function calculateSimilarity(target, candidate) {
  if (!target || !candidate) return 0;

  const normalizeWords = (str) => normalizeText(str)
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));

  const targetWords = normalizeWords(target);
  const candidateWords = new Set(normalizeWords(candidate));

  if (targetWords.length === 0) return 0;

  let matches = 0;
  for (const word of targetWords) {
    if (candidateWords.has(word)) matches++;
  }

  return matches / targetWords.length;
}

const { findProductUrls } = require('./productSearch');

/**
 * Search Flipkart for a product query. Returns a list of products.
 */
async function searchFlipkart(query) {
  try {
    const products = await findProductUrls(query, { platform: 'flipkart', strictMatch: true });
    
    // Add null price since search APIs don't easily return precise product prices
    return products.map(p => ({
      title: p.title,
      url: p.url,
      price: null, 
      image: null
    }));
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
function buildQueryTiers(queries, originalProductName, expectedType = null) {
  const typeQueryTerm = getProductTypeQueryTerm(expectedType);
  const baseExact = queries?.exactMatchQuery || originalProductName || '';
  const baseSimilar = queries?.similarMatchQuery || baseExact;
  const baseBroad = queries?.broadMatchQuery || baseSimilar;

  return [
    { name: 'Exact', text: baseExact, minScore: 0.5 },
    { name: 'Similar', text: baseSimilar, minScore: 0.3 },
    { name: 'Broad', text: baseBroad, minScore: 0.18 },
    { name: 'Category', text: typeQueryTerm, minScore: 0.1 },
  ];
}

function normalizeProductUrl(url) {
  return String(url || '').split('?')[0].replace(/\/$/, '');
}

function scoreProduct({ product, tierText, originalProductName, expectedType }) {
  const productTitle = product?.title || '';
  if (!productTitle || !product?.url) {
    return { accepted: false, score: 0, reason: 'missing title/url' };
  }

  if (!isProductTypeMatch(originalProductName || tierText, productTitle, expectedType)) {
    const candidateType = detectAllProductTypes(productTitle).join(', ') || 'unknown';
    return {
      accepted: false,
      score: 0,
      reason: `type mismatch (${candidateType} != ${expectedType})`,
    };
  }

  const scoreVsName = calculateSimilarity(originalProductName, productTitle);
  const scoreVsQuery = calculateSimilarity(tierText, productTitle);
  const finalScore = Math.max(scoreVsName, scoreVsQuery);
  const typeBoost = expectedType ? 0.3 : 0;
  const priceBoost = product.price ? 0.1 : 0;
  const signals = extractVisualSignals(originalProductName);
  const productText = normalizeText(productTitle);
  const colorBoost = signals.colors.some((color) => hasTerm(productText, color)) ? 0.22 : 0;
  const styleBoost = signals.styles.some((style) => hasTerm(productText, style)) ? 0.12 : 0;

  return {
    accepted: true,
    score: finalScore + typeBoost + priceBoost + colorBoost + styleBoost,
    reason: 'accepted',
  };
}

async function findProduct(queries, originalProductName, options = {}) {
  const expectedType = options.expectedType || detectProductType([
    originalProductName,
    queries?.exactMatchQuery,
    queries?.similarMatchQuery,
    queries?.broadMatchQuery,
  ].filter(Boolean).join(' '));

  if (expectedType) {
    console.log(`[Flipkart] Product type guard active: ${getProductTypeLabel(expectedType)}`);
  }

  const queryTiers = buildQueryTiers(queries, originalProductName, expectedType);

  let bestMatch = null;
  let highestScore = -1;

  for (const tier of queryTiers) {
    if (!tier.text || tier.text === 'other') continue;

    console.log(`\n[Flipkart] Trying ${tier.name} Query: "${tier.text}"`);
    const products = await searchFlipkart(tier.text);
    
    if (products.length === 0) continue;

    for (const product of products) {
      const { accepted, score, reason } = scoreProduct({
        product,
        tierText: tier.text,
        originalProductName,
        expectedType,
      });

      if (!accepted) {
        console.log(`[Flipkart] Skipping "${product.title}" - ${reason}`);
        continue;
      }

      if (score > highestScore) {
        highestScore = score;
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

function buildSameTypeQueries(queries, originalProductName, expectedType) {
  const typeQueryTerm = getProductTypeQueryTerm(expectedType);
  const visualQuery = buildVisualQuery(originalProductName, expectedType);
  const seedQueries = [
    queries?.exactMatchQuery,
    queries?.similarMatchQuery,
    queries?.broadMatchQuery,
    originalProductName,
    visualQuery,
  ].filter(Boolean);

  const querySet = new Set();
  for (const query of seedQueries) {
    const clean = String(query || '').trim();
    if (!clean || clean === 'other') continue;
    querySet.add(clean);
    if (expectedType && !hasTerm(normalizeText(clean), getProductTypeLabel(expectedType))) {
      querySet.add(`${clean} ${typeQueryTerm}`.trim());
    }
  }

  if (typeQueryTerm) {
    if (visualQuery && visualQuery !== typeQueryTerm) {
      querySet.add(`${visualQuery} for men`);
      querySet.add(`similar ${visualQuery}`);
    }
    querySet.add(typeQueryTerm);
  }

  return Array.from(querySet).slice(0, 8);
}

async function findProductsForSameType(queries, originalProductName, options = {}) {
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 4;
  const expectedType = options.expectedType || detectProductType([
    originalProductName,
    queries?.exactMatchQuery,
    queries?.similarMatchQuery,
    queries?.broadMatchQuery,
  ].filter(Boolean).join(' '));

  if (expectedType) {
    console.log(`[Flipkart] Same-type product shelf: ${getProductTypeLabel(expectedType)} x${limit}`);
  } else {
    console.log('[Flipkart] Same-type product shelf: type unknown, using similarity only.');
  }

  const queryList = buildSameTypeQueries(queries, originalProductName, expectedType);
  const seen = new Set();
  const scoredMatches = [];

  for (const query of queryList) {
    console.log(`\n[Flipkart] Shelf Query: "${query}"`);
    const products = await searchFlipkart(query);

    for (const product of products) {
      const normalizedUrl = normalizeProductUrl(product.url);
      if (!normalizedUrl || seen.has(normalizedUrl)) continue;

      const { accepted, score, reason } = scoreProduct({
        product,
        tierText: query,
        originalProductName,
        expectedType,
      });

      if (!accepted) {
        console.log(`[Flipkart] Shelf skip "${product.title}" - ${reason}`);
        continue;
      }

      seen.add(normalizedUrl);
      scoredMatches.push({
        ...product,
        matchedType: expectedType || detectProductType(product.title),
        matchScore: score,
      });
    }

    if (scoredMatches.length >= limit) break;
  }

  const winners = scoredMatches
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);

  console.log(`[Flipkart] Shelf selected ${winners.length}/${limit} same-type products.`);
  return winners;
}

module.exports = {
  findProduct,
  findProductsForSameType,
  searchFlipkart,
  detectProductType,
  getProductTypeLabel,
  getProductTypeQueryTerm,
  isProductTypeMatch,
  calculateSimilarity,
};

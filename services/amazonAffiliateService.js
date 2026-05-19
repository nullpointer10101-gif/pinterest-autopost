'use strict';

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

const AMAZON_SEARCH_CACHE_TTL_MS = Math.max(60000, parseInt(process.env.PRODUCT_SEARCH_CACHE_TTL_MS || '21600000', 10));
const amazonSearchCache = new Map();
const amazonInFlight = new Map();

function cleanCacheText(value) {
  return cleanText(value).toLowerCase();
}

function getCachedSearch(key) {
  const hit = amazonSearchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > AMAZON_SEARCH_CACHE_TTL_MS) {
    amazonSearchCache.delete(key);
    return null;
  }
  return hit.value;
}

async function withAmazonSearchCache(key, loader) {
  const cached = getCachedSearch(key);
  if (cached) return cached.map((item) => ({ ...item }));
  if (amazonInFlight.has(key)) {
    const value = await amazonInFlight.get(key);
    return value.map((item) => ({ ...item }));
  }

  const promise = Promise.resolve()
    .then(loader)
    .then((value) => {
      const safeValue = Array.isArray(value) ? value : [];
      amazonSearchCache.set(key, { at: Date.now(), value: safeValue });
      return safeValue;
    })
    .finally(() => amazonInFlight.delete(key));

  amazonInFlight.set(key, promise);
  const value = await promise;
  return value.map((item) => ({ ...item }));
}

function getAssociateTag() {
  return cleanText(
    process.env.AMAZON_ASSOCIATE_TAG ||
    process.env.AMAZON_PARTNER_TAG ||
    process.env.AMAZON_TRACKING_ID ||
    process.env.AMAZON_AFFILIATE_TAG ||
    ''
  );
}

function getMarketplaceHost() {
  const raw = cleanText(process.env.AMAZON_MARKETPLACE || process.env.AMAZON_DOMAIN || 'www.amazon.in')
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
  return raw || 'www.amazon.in';
}

function fetchWithTimeout(url, init = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function isConfigured() {
  return Boolean(getAssociateTag());
}

function buildSearchUrl(query, options = {}) {
  const tag = cleanText(options.tag || getAssociateTag());
  const host = cleanText(options.marketplace || getMarketplaceHost());
  const cleanQuery = cleanText(query);

  if (!tag || !cleanQuery) return '';

  const params = new URLSearchParams({
    k: cleanQuery,
    tag,
  });

  return `https://${host}/s?${params.toString()}`;
}

function extractAsin(value = '') {
  const raw = String(value || '').trim();
  const decoded = (() => {
    try { return decodeURIComponent(raw); } catch { return raw; }
  })();
  const match = decoded.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?&]|$)/i);
  return match ? match[1].toUpperCase() : '';
}

function extractProductPath(value = '', asin = '') {
  const raw = String(value || '').trim();
  const decoded = (() => {
    try { return decodeURIComponent(raw); } catch { return raw; }
  })();
  const safeAsin = String(asin || extractAsin(decoded)).toUpperCase();
  if (!safeAsin) return '';

  const slugMatch = decoded.match(new RegExp(`https?://[^/]+(/[^?#]*?/dp/${safeAsin})(?:[/?#]|$)`, 'i'))
    || decoded.match(new RegExp(`(/[^?#]*?/dp/${safeAsin})(?:[/?#]|$)`, 'i'));
  if (slugMatch?.[1]) {
    return slugMatch[1]
      .split('/')
      .filter(Boolean)
      .map((part) => encodeURIComponent(part))
      .join('/');
  }

  return `dp/${safeAsin}`;
}

function buildTaggedProductUrl(productUrl, options = {}) {
  const tag = cleanText(options.tag || getAssociateTag());
  if (!tag) return '';

  try {
    const parsed = new URL(String(productUrl || '').trim());
    const asin = extractAsin(parsed.toString());
    if (!asin) return '';

    const configuredHost = cleanText(options.marketplace || getMarketplaceHost());
    const host = parsed.hostname.toLowerCase().includes('amazon.')
      ? parsed.hostname
      : configuredHost;
    const canonicalPath = `/${extractProductPath(productUrl, asin)}`;
    const tagged = new URL(`https://${host}${canonicalPath}`);
    tagged.searchParams.set('tag', tag);
    return tagged.toString();
  } catch {
    return '';
  }
}

function titleizeQuery(query) {
  return cleanText(query)
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function includesAllWords(base, phrase) {
  const words = new Set(cleanText(base).toLowerCase().split(/\s+/).filter(Boolean));
  return cleanText(phrase).toLowerCase().split(/\s+/).filter(Boolean).every((word) => words.has(word));
}

function buildSameTypeSearchShelf({
  query,
  typeQuery,
  typeLabel = 'Product',
  limit = 4,
  logPrefix = '[Amazon]',
} = {}) {
  const maxItems = Math.max(0, Number.isFinite(Number(limit)) ? Number(limit) : 4);
  if (maxItems <= 0) return [];

  if (!isConfigured()) {
    console.warn(`${logPrefix} Amazon fallback skipped: AMAZON_ASSOCIATE_TAG is not configured.`);
    return [];
  }

  const cleanQuery = cleanText(query);
  const cleanTypeQuery = cleanText(typeQuery);
  const typedQuery = cleanQuery && cleanTypeQuery && !includesAllWords(cleanQuery, cleanTypeQuery)
    ? `${cleanQuery} ${cleanTypeQuery}`
    : '';
  const seeds = [
    cleanQuery,
    cleanQuery ? `best ${cleanQuery}` : '',
    cleanQuery ? `latest ${cleanQuery}` : '',
    typedQuery,
    typedQuery ? `best ${typedQuery}` : '',
    cleanTypeQuery ? `${cleanTypeQuery} fashion` : '',
  ].filter(Boolean);

  const seen = new Set();
  const shelf = [];

  for (const seed of seeds) {
    const normalized = seed.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const url = buildSearchUrl(seed);
    if (!url) continue;

    shelf.push({
      type: typeLabel,
      name: `${typeLabel}: ${titleizeQuery(seed)}`,
      url,
      image: null,
      originalPrice: null,
      source: 'amazon_search',
      affiliateProvider: 'amazon_associates',
    });

    if (shelf.length >= maxItems) break;
  }

  console.log(`${logPrefix} Amazon fallback generated ${shelf.length}/${maxItems} affiliate search link(s).`);
  return shelf;
}

async function searchAmazonProducts(query, options = {}) {
  const cleanQuery = cleanText(query);
  const limit = Math.max(1, Number.isFinite(Number(options.limit)) ? Number(options.limit) : 4);
  const logPrefix = options.logPrefix || '[Amazon]';
  if (!cleanQuery || !isConfigured()) return [];

  const keys = [
    process.env.SERPER_API_KEY,
    process.env.SERPER_API_KEY_BACKUP,
  ].filter(Boolean);

  if (!keys.length) {
    console.warn(`${logPrefix} Amazon exact-product search skipped: SERPER_API_KEY is not configured.`);
    return [];
  }

  const cacheKey = ['amazon-products', getMarketplaceHost(), limit, cleanCacheText(cleanQuery)].join(':');
  return withAmazonSearchCache(cacheKey, () => searchAmazonProductsUncached(cleanQuery, {
    ...options,
    limit,
    keys,
    logPrefix,
  }));
}

async function searchAmazonProductsUncached(cleanQuery, options = {}) {
  const limit = Math.max(1, Number.isFinite(Number(options.limit)) ? Number(options.limit) : 4);
  const logPrefix = options.logPrefix || '[Amazon]';
  const keys = Array.isArray(options.keys) ? options.keys.filter(Boolean) : [
    process.env.SERPER_API_KEY,
    process.env.SERPER_API_KEY_BACKUP,
  ].filter(Boolean);
  const domain = getMarketplaceHost();
  const serperQueries = [
    `site:${domain} ${cleanQuery} dp`,
    `${cleanQuery} site:${domain} "/dp/"`,
  ].slice(0, Math.max(1, parseInt(process.env.AMAZON_SERPER_QUERY_VARIANTS || '1', 10)));

  for (const serperQuery of serperQueries) {
    let retryWithBackup = false;
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      if (keyIndex > 0 && !retryWithBackup) break;
      const apiKey = keys[keyIndex];
      retryWithBackup = false;
      try {
        const res = await fetchWithTimeout('https://google.serper.dev/search', {
          method: 'POST',
          headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            q: serperQuery,
            gl: 'in',
            hl: 'en',
            num: Math.max(3, Math.min(5, limit * 2)),
          }),
        }, 20000);

        if (res.status === 401 || res.status === 429) {
          console.warn(`${logPrefix} Serper key could not search Amazon (${res.status}); trying fallback if available.`);
          retryWithBackup = true;
          continue;
        }
        if (!res.ok) {
          console.warn(`${logPrefix} Serper Amazon search HTTP ${res.status}.`);
          continue;
        }

        const data = await res.json();
        const organic = Array.isArray(data?.organic) ? data.organic : [];
        const seen = new Set();
        const exactProducts = [];

        for (const product of organic) {
          const rawUrl = product.link || product.url || '';
          const taggedUrl = buildTaggedProductUrl(rawUrl);
          const asin = extractAsin(taggedUrl || rawUrl);
          if (!taggedUrl || !asin || seen.has(asin)) continue;
          seen.add(asin);

          exactProducts.push({
            title: product.title || `Amazon Product ${asin}`,
            url: taggedUrl,
            image: product.image || null,
            price: product.price || null,
            source: 'amazon_product',
            affiliateProvider: 'amazon_associates',
            asin,
          });

          if (exactProducts.length >= limit) break;
        }

        if (exactProducts.length > 0) {
          console.log(`${logPrefix} Amazon exact-product search found ${exactProducts.length}/${limit} for "${cleanQuery}".`);
          return exactProducts;
        }
        break;
      } catch (err) {
        console.warn(`${logPrefix} Amazon exact-product search failed for "${cleanQuery}": ${err.message}`);
        break;
      }
    }
  }

  console.log(`${logPrefix} Amazon exact-product search found 0/${limit} for "${cleanQuery}".`);
  return [];
}

function isAmazonUrl(value = '') {
  try {
    const parsed = new URL(String(value || '').trim());
    const host = parsed.hostname.toLowerCase();
    return host.includes('amazon.') || host === 'amzn.to';
  } catch {
    return false;
  }
}

module.exports = {
  buildSearchUrl,
  buildSameTypeSearchShelf,
  buildTaggedProductUrl,
  extractAsin,
  getAssociateTag,
  getMarketplaceHost,
  isAmazonUrl,
  isConfigured,
  searchAmazonProducts,
};

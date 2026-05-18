'use strict';

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
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
    typedQuery,
    cleanTypeQuery ? `best ${cleanTypeQuery}` : '',
    cleanTypeQuery ? `latest ${cleanTypeQuery}` : '',
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

    if (shelf.length >= limit) break;
  }

  console.log(`${logPrefix} Amazon fallback generated ${shelf.length}/${limit} affiliate search link(s).`);
  return shelf;
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
  getAssociateTag,
  getMarketplaceHost,
  isAmazonUrl,
  isConfigured,
};

'use strict';

const flipkartSearchService = require('./flipkartSearchService');
const earnKaroService = require('./earnKaroService');
const amazonAffiliateService = require('./amazonAffiliateService');

function cleanQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 20000, retries = 2) {
  let attempt = 1;
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);

      const isTransient = err.name === 'AbortError' ||
                          err.message.includes('fetch failed') ||
                          err.message.includes('timeout') ||
                          (err.cause && (err.cause.code === 'UND_ERR_SOCKET' || err.cause.name === 'ConnectTimeoutError'));

      if (isTransient && attempt <= retries) {
        console.warn(`[Network] fetch failed for ${url} (attempt ${attempt}/${retries}). Retrying in ${attempt}s... Error: ${err.message}`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        attempt++;
        continue;
      }
      throw err;
    }
  }
}

function isSafeHttpUrl(value = '') {
  try {
    const parsed = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function isKnownCommerceUrl(value = '') {
  try {
    const host = new URL(String(value || '').trim()).hostname.toLowerCase();
    return host.includes('flipkart.com') ||
      host.includes('fktr.in') ||
      host.includes('amazon.') ||
      host === 'amzn.to';
  } catch {
    return false;
  }
}

async function isReachableUrl(url, logPrefix = '[Product Curation]') {
  if (!isSafeHttpUrl(url) || !isKnownCommerceUrl(url)) return false;

  try {
    const res = await fetchWithTimeout(url, {
      method: 'HEAD',
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PinterestAutopostProductCheck/1.0)',
      },
    }, 12000);
    if (res.status >= 200 && res.status < 400) return true;
    if ([403, 405, 429].includes(res.status)) return true;
  } catch (err) {
    console.warn(`${logPrefix} Link HEAD check inconclusive for ${url}: ${err.message}`);
  }

  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PinterestAutopostProductCheck/1.0)',
        Accept: 'text/html,*/*;q=0.8',
      },
    }, 9000);
    return res.status >= 200 && res.status < 400 || [403, 429].includes(res.status);
  } catch (err) {
    console.warn(`${logPrefix} Link GET check failed for ${url}: ${err.message}`);
    return false;
  }
}

function normalizeForDedupe(value) {
  return cleanQuery(value)
    .toLowerCase()
    .replace(/\b(flipkart|amazon|assured|prime|buy online|online)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function productSignature(product = {}) {
  let urlKey = '';
  try {
    const parsed = new URL(String(product.url || '').trim());
    urlKey = `${parsed.hostname}${parsed.pathname}`.toLowerCase().replace(/\/$/, '');
  } catch {}

  const titleKey = normalizeForDedupe(product.title || product.name || '');
  const imageKey = cleanQuery(product.image || '').split('?')[0].toLowerCase();
  return {
    urlKey,
    titleKey,
    imageKey,
  };
}

function dedupeProducts(products = []) {
  const seen = new Set();
  const deduped = [];

  for (const product of products || []) {
    const signature = productSignature(product);
    const keys = [
      signature.urlKey && `url:${signature.urlKey}`,
      signature.titleKey && `title:${signature.titleKey}`,
      signature.imageKey && `image:${signature.imageKey}`,
    ].filter(Boolean);

    if (keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    deduped.push(product);
  }

  return deduped;
}

function hasWord(text, term) {
  const normalized = normalizeForDedupe(text);
  const normalizedTerm = normalizeForDedupe(term);
  if (!normalizedTerm) return false;
  return new RegExp(`(^|\\s)${normalizedTerm.replace(/\s+/g, '\\s+')}($|\\s)`, 'i').test(normalized);
}

const COLOR_FAMILIES = [
  ['white', 'off white', 'ivory', 'cream'],
  ['grey', 'gray', 'charcoal'],
  ['blue', 'navy', 'sky blue'],
  ['brown', 'tan', 'camel'],
  ['red', 'maroon', 'burgundy'],
];

function compatibleColorSet(colors = []) {
  const allowed = new Set(colors);
  for (const color of colors) {
    const family = COLOR_FAMILIES.find((group) => group.includes(color));
    if (family) family.forEach((item) => allowed.add(item));
  }
  return allowed;
}

function uniqueClean(values = []) {
  const seen = new Set();
  const list = [];
  for (const value of values) {
    const clean = cleanQuery(value);
    const key = clean.toLowerCase();
    if (!clean || clean === 'other' || seen.has(key)) continue;
    seen.add(key);
    list.push(clean);
  }
  return list;
}

function intEnv(name, fallback, min = 0, max = 100) {
  const parsed = parseInt(process.env[name] || '', 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, value));
}

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

function getSearchPolicy() {
  const roleKeys = uniqueClean(String(process.env.PRODUCT_HUNTER_ROLES || 'exact_flipkart,budget_pick').split(','))
    .map((key) => key.toLowerCase());
  return {
    maxRoles: intEnv('PRODUCT_HUNTER_MAX_ROLES', 2, 1, 4),
    roleKeys,
    maxInitialQueries: intEnv('PRODUCT_SEARCH_MAX_INITIAL_QUERIES', 2, 1, 4),
    maxQueriesPerRole: intEnv('PRODUCT_SEARCH_MAX_QUERIES_PER_ROLE', 1, 1, 4),
    maxMarketplacesPerRole: intEnv('PRODUCT_SEARCH_MAX_MARKETPLACES_PER_ROLE', 1, 1, 2),
    maxValidationCandidates: intEnv('PRODUCT_SEARCH_MAX_VALIDATION_CANDIDATES', 2, 1, 8),
    maxImageLookups: intEnv('SERPER_MAX_IMAGE_SEARCHES_PER_POST', 2, 0, 8),
    imageLookupEnabled: boolEnv('SERPER_IMAGE_LOOKUP_ENABLED', true),
  };
}

function createSearchBudget(policy = getSearchPolicy()) {
  return {
    imageLookups: 0,
    maxImageLookups: policy.maxImageLookups,
  };
}

function takeRoleQueries(mission, roleKey, policy) {
  return roleQueriesForMission(mission, roleKey).slice(0, policy.maxQueriesPerRole);
}

const FABRIC_TERMS = ['linen', 'cotton', 'denim', 'corduroy', 'leather', 'suede', 'satin'];
const FIT_TERMS = ['oversized', 'slim fit', 'regular fit', 'relaxed fit', 'loose fit', 'baggy'];

function firstMatchedTerm(text, terms) {
  return terms.find((term) => hasWord(text, term)) || '';
}

function inferVibe(text, expectedType) {
  const normalized = normalizeForDedupe(text);
  if (hasWord(normalized, 'formal') || expectedType === 'blazer') return 'sharp formal';
  if (hasWord(normalized, 'streetwear') || hasWord(normalized, 'oversized') || hasWord(normalized, 'baggy')) return 'streetwear';
  if (hasWord(normalized, 'linen') || hasWord(normalized, 'loose fit')) return 'resort casual';
  if (hasWord(normalized, 'leather') || hasWord(normalized, 'suede')) return 'premium classic';
  if (expectedType === 'shoes') return 'sneaker rotation';
  if (expectedType === 'kurta') return 'festive menswear';
  return 'everyday menswear';
}

function inferOccasion(vibe, expectedType) {
  if (vibe.includes('formal')) return 'office, dinners, polished evenings';
  if (vibe.includes('streetwear')) return 'casual outings and street-style fits';
  if (vibe.includes('resort')) return 'summer days and vacation looks';
  if (expectedType === 'kurta') return 'festive wear and family events';
  if (expectedType === 'shoes') return 'daily wear and weekend outfits';
  return 'daily outfit rotation';
}

function buildShoppingMission({ query, queries = {}, expectedType, productTypeLabel }) {
  const sourceText = uniqueClean([
    query,
    queries.exactMatchQuery,
    queries.similarMatchQuery,
    queries.broadMatchQuery,
  ]).join(' ');
  const visualSignals = flipkartSearchService.extractVisualSignals(sourceText);
  const typeQuery = flipkartSearchService.getProductTypeQueryTerm(expectedType);
  const visualQuery = cleanQuery(flipkartSearchService.buildVisualQuery(sourceText, expectedType)) || cleanQuery(query) || typeQuery;
  const primaryQuery = cleanQuery(query || queries.exactMatchQuery || visualQuery);
  const fabric = firstMatchedTerm(sourceText, FABRIC_TERMS);
  const fit = firstMatchedTerm(sourceText, FIT_TERMS);
  const vibe = inferVibe(sourceText, expectedType);
  const occasion = inferOccasion(vibe, expectedType);

  const exactQueries = uniqueClean([
    primaryQuery,
    queries.exactMatchQuery,
    visualQuery,
    queries.similarMatchQuery,
    `${visualQuery} for men`,
  ]);

  const premiumQueries = uniqueClean([
    `premium ${visualQuery}`,
    `branded ${visualQuery}`,
    `luxury ${visualQuery}`,
    fabric ? `premium ${fabric} ${typeQuery}` : '',
    primaryQuery,
  ]);

  const budgetQueries = uniqueClean([
    `affordable ${visualQuery}`,
    `budget ${visualQuery}`,
    `${visualQuery} under 999`,
    `best value ${visualQuery}`,
    primaryQuery,
  ]);

  return {
    mode: 'AI Product Hunter',
    primaryQuery,
    visualQuery,
    productType: expectedType,
    productTypeLabel,
    typeQuery,
    colors: visualSignals.colors || [],
    styles: visualSignals.styles || [],
    fabric,
    fit,
    vibe,
    occasion,
    priceRange: 'budget, exact, and premium alternatives',
    exactQueries,
    premiumQueries,
    budgetQueries,
  };
}

function roleQueriesForMission(mission, roleKey) {
  if (roleKey === 'premium') return mission.premiumQueries;
  if (roleKey === 'budget') return mission.budgetQueries;
  return mission.exactQueries;
}

function candidateMatchesMission(productTitle, mission, roleKey) {
  const candidateTypes = flipkartSearchService.detectAllProductTypes(productTitle);
  const hasWrongType = candidateTypes.some((type) => type !== mission.productType);
  const hasExpectedType = candidateTypes.includes(mission.productType);
  if (hasWrongType || (candidateTypes.length > 0 && !hasExpectedType)) {
    return { accepted: false, score: 0, reason: `type mismatch (${candidateTypes.join(', ') || 'unknown'} != ${mission.productType})` };
  }

  const title = normalizeForDedupe(productTitle);
  const colorRequired = mission.colors.length > 0;
  const colorMatch = !colorRequired || mission.colors.some((color) => hasWord(title, color));
  if (!colorMatch) {
    return { accepted: false, score: 0, reason: `missing color (${mission.colors.join(', ')})` };
  }

  if (colorRequired) {
    const candidateColors = flipkartSearchService.extractVisualSignals(productTitle).colors || [];
    const allowedColors = compatibleColorSet(mission.colors);
    const conflictingColors = candidateColors.filter((color) => !allowedColors.has(color));
    if (conflictingColors.length > 0) {
      return { accepted: false, score: 0, reason: `conflicting color (${conflictingColors.join(', ')})` };
    }
  }

  let score = 0.35;
  if (mission.colors.some((color) => hasWord(title, color))) score += 0.2;
  if (mission.fabric && hasWord(title, mission.fabric)) score += 0.14;
  if (mission.fit && hasWord(title, mission.fit)) score += 0.1;
  if (mission.styles.some((style) => hasWord(title, style))) score += 0.1;
  if (mission.visualQuery && flipkartSearchService.calculateSimilarity(mission.visualQuery, productTitle) >= 0.3) score += 0.18;
  if (mission.primaryQuery && flipkartSearchService.calculateSimilarity(mission.primaryQuery, productTitle) >= 0.3) score += 0.12;
  if (roleKey === 'premium' && /premium|luxury|linen|leather|designer|branded|tailored/i.test(productTitle)) score += 0.08;
  if (roleKey === 'budget' && /budget|affordable|value|under|sale|combo/i.test(productTitle)) score += 0.06;

  return { accepted: true, score, reason: 'accepted' };
}

function sortCandidatesForMission(candidates, mission, roleKey) {
  return dedupeProducts(candidates)
    .map((product) => {
      const scored = candidateMatchesMission(product.title || product.name || '', mission, roleKey);
      return { ...product, hunterScore: scored.score, hunterRejectReason: scored.reason, accepted: scored.accepted };
    })
    .filter((product) => product.accepted)
    .sort((a, b) => b.hunterScore - a.hunterScore);
}

function choosePreferredImage(images = [], provider = '') {
  const preferred = images
    .map((image) => image?.imageUrl || image?.thumbnailUrl || '')
    .filter(Boolean);

  if (provider === 'amazon') {
    return preferred.find((src) => /media-amazon|ssl-images-amazon|amazon/i.test(src)) || preferred[0] || null;
  }

  if (provider === 'flipkart') {
    return preferred.find((src) => /rukminim|flipkart|fkimg/i.test(src)) || preferred[0] || null;
  }

  return preferred[0] || null;
}

const IMAGE_LOOKUP_CACHE_TTL_MS = Math.max(60000, parseInt(process.env.PRODUCT_SEARCH_CACHE_TTL_MS || '21600000', 10));
const imageLookupCache = new Map();
const imageLookupInFlight = new Map();

function getCachedImage(key) {
  const hit = imageLookupCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > IMAGE_LOOKUP_CACHE_TTL_MS) {
    imageLookupCache.delete(key);
    return null;
  }
  return hit.value;
}

async function withImageCache(key, loader) {
  const cached = getCachedImage(key);
  if (cached !== null) return cached;
  if (imageLookupInFlight.has(key)) return imageLookupInFlight.get(key);

  const promise = Promise.resolve()
    .then(loader)
    .then((value) => {
      imageLookupCache.set(key, { at: Date.now(), value: value || '' });
      return value || null;
    })
    .finally(() => imageLookupInFlight.delete(key));

  imageLookupInFlight.set(key, promise);
  return promise;
}

async function findProductImage(name, url, logPrefix = '[Product Curation]', searchBudget = null) {
  const key = process.env.SERPER_API_KEY || process.env.SERPER_API_KEY_BACKUP || '';
  if (!key) return null;
  const policy = getSearchPolicy();
  if (!policy.imageLookupEnabled) return null;

  const isAmazon = amazonAffiliateService.isAmazonUrl(url);
  const isFlipkart = /flipkart\.com|fktr\.in/i.test(String(url || ''));
  const provider = isAmazon ? 'amazon' : isFlipkart ? 'flipkart' : '';
  const providerHint = provider === 'amazon' ? 'amazon product' : provider === 'flipkart' ? 'flipkart product' : 'product';
  const query = cleanQuery(name || url);
  if (!query) return null;
  const cacheKey = ['image', provider || 'any', normalizeForDedupe(query)].join(':');
  const cached = getCachedImage(cacheKey);
  if (cached !== null) return cached || null;

  if (searchBudget) {
    if (searchBudget.imageLookups >= searchBudget.maxImageLookups) {
      console.warn(`${logPrefix} Image lookup skipped for "${query}" - per-post Serper image budget reached.`);
      return null;
    }
    searchBudget.imageLookups += 1;
  }

  return withImageCache(cacheKey, async () => {
    const res = await fetchWithTimeout('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: `${query} ${providerHint}`, gl: 'in', hl: 'en', num: 8 }),
    }, 15000);

    if (!res.ok) return null;
    const data = await res.json();
    return choosePreferredImage(data?.images || [], provider);
  }).catch((err) => {
    console.warn(`${logPrefix} Image lookup failed for "${query}": ${err.message}`);
    return null;
  });
}

async function enrichAndValidateLinks(links, {
  expectedType,
  logPrefix = '[Product Curation]',
  limit = 4,
  searchBudget = null,
} = {}) {
  const validated = [];

  for (const link of links || []) {
    if (validated.length >= limit) break;

    const linkType = flipkartSearchService.detectProductType(`${link.name || ''} ${link.type || ''}`);
    if (expectedType && linkType && linkType !== expectedType) {
      console.log(`${logPrefix} Dropping product "${link.name}" - type mismatch (${linkType} != ${expectedType}).`);
      continue;
    }

    const reachable = await isReachableUrl(link.url, logPrefix);
    if (!reachable) {
      console.log(`${logPrefix} Dropping product "${link.name}" - link did not pass reachability check.`);
      continue;
    }

    let image = cleanQuery(link.image);
    if (!image) {
      image = await findProductImage(link.name, link.url, logPrefix, searchBudget);
    }

    if (!image) {
      console.log(`${logPrefix} Dropping product "${link.name}" - no usable image found.`);
      continue;
    }

    validated.push({
      ...link,
      image,
      imageVerified: true,
      linkVerified: true,
    });
  }

  return dedupeProducts(validated).slice(0, limit);
}

function getBalancedTargets(limit) {
  const total = Math.max(1, Number.isFinite(Number(limit)) ? Number(limit) : 4);
  if (total >= 4) {
    return { flipkartTarget: 2, amazonTarget: 2 };
  }
  const flipkartTarget = Math.ceil(total / 2);
  return { flipkartTarget, amazonTarget: total - flipkartTarget };
}

function buildQueriesFromText(query, extraQueries = []) {
  const clean = cleanQuery(query);
  const extras = (Array.isArray(extraQueries) ? extraQueries : [])
    .map(cleanQuery)
    .filter(Boolean);
  return {
    exactMatchQuery: clean,
    similarMatchQuery: extras[0] || clean,
    broadMatchQuery: extras[1] || clean.split(' ').slice(0, 4).join(' '),
  };
}

function buildQueriesFromProductData(productData = {}) {
  const productName = cleanQuery(productData.productName || productData.exactMatchQuery || '');
  return {
    exactMatchQuery: cleanQuery(productData.exactMatchQuery || productName),
    similarMatchQuery: cleanQuery(productData.similarMatchQuery || productName),
    broadMatchQuery: cleanQuery(productData.broadMatchQuery || productName.split(' ').slice(0, 4).join(' ')),
  };
}

function pickPrimaryItem(outfitData = {}) {
  const items = Array.isArray(outfitData.items) ? outfitData.items : [];
  if (items.length === 0) return null;

  return (
    items.find((item) => String(item?.type || '').toLowerCase() === 'main' && cleanQuery(item?.query)) ||
    items.find((item) => flipkartSearchService.detectProductType(item?.query)) ||
    items.find((item) => cleanQuery(item?.query)) ||
    null
  );
}

async function buildAffiliateShelf(products, { typeLabel, fallbackType = 'Main Piece', logPrefix = '[Product Curation]' } = {}) {
  const affiliateLinks = [];
  const seen = new Set();

  for (const product of dedupeProducts(products || [])) {
    if (!product?.url) continue;

    try {
      const isAmazonProduct = product.source === 'amazon_product' || amazonAffiliateService.isAmazonUrl(product.url);
      const affiliate = isAmazonProduct
        ? { affiliateUrl: amazonAffiliateService.buildTaggedProductUrl(product.url) || product.url, source: 'amazon_associates' }
        : await earnKaroService.makeAffiliateLink(product.url);
      const affiliateUrl = cleanQuery(affiliate?.affiliateUrl || product.url);
      if (!affiliateUrl) continue;

      const signature = productSignature({ ...product, url: affiliateUrl });
      const key = signature.urlKey || signature.titleKey;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);

      affiliateLinks.push({
        type: typeLabel || fallbackType,
        name: product.title || typeLabel || 'Featured Item',
        url: affiliateUrl,
        image: product.image || null,
        originalPrice: product.price || null,
        source: product.source || 'flipkart_product',
        affiliateProvider: affiliate?.source === 'earnkaro'
          ? 'earnkaro'
          : affiliate?.source === 'amazon_associates'
            ? 'amazon_associates'
            : 'raw_or_existing',
      });
    } catch (err) {
      console.warn(`${logPrefix} Affiliate link failed for "${product.title || product.url}": ${err.message}`);
    }
  }

  return affiliateLinks;
}

const HUNTER_ROLES = [
  {
    key: 'exact_flipkart',
    label: 'Exact Match',
    badge: 'Exact',
    preferredMarketplace: 'flipkart',
    queryGroup: 'exact',
  },
  {
    key: 'exact_amazon',
    label: 'Exact Alternative',
    badge: 'Exact',
    preferredMarketplace: 'amazon',
    queryGroup: 'exact',
  },
  {
    key: 'premium_pick',
    label: 'Premium Pick',
    badge: 'Premium',
    preferredMarketplace: 'amazon',
    queryGroup: 'premium',
  },
  {
    key: 'budget_pick',
    label: 'Budget Pick',
    badge: 'Budget',
    preferredMarketplace: 'flipkart',
    queryGroup: 'budget',
  },
];

function getActiveHunterRoles(policy = getSearchPolicy()) {
  const keyedRoles = policy.roleKeys.length
    ? HUNTER_ROLES.filter((role) => policy.roleKeys.includes(role.key))
    : HUNTER_ROLES;
  return (keyedRoles.length ? keyedRoles : HUNTER_ROLES).slice(0, policy.maxRoles);
}

async function searchFlipkartHunterCandidates(mission, role, seedProducts = [], logPrefix = '[Product Curation]', policy = getSearchPolicy()) {
  const roleKey = role.queryGroup || 'exact';
  const products = role.key === 'exact_flipkart' && Array.isArray(seedProducts) && seedProducts.length
    ? seedProducts
    : [];
  const seen = new Set(products.map((product) => productSignature(product).urlKey).filter(Boolean));

  if (role.key === 'exact_flipkart' && products.length) {
    const sortedSeed = sortCandidatesForMission(products, mission, roleKey);
    console.log(`${logPrefix} Hunter ${role.label} Flipkart candidates from seed cache: ${sortedSeed.length}.`);
    return sortedSeed;
  }

  for (const query of takeRoleQueries(mission, roleKey, policy)) {
    if (products.length >= 10) break;

    const roleQueries = {
      exactMatchQuery: query,
      similarMatchQuery: mission.visualQuery,
      broadMatchQuery: mission.typeQuery,
    };

    const found = await flipkartSearchService.findProductsForSameType(roleQueries, mission.primaryQuery, {
      limit: 6,
      expectedType: mission.productType,
      maxQueries: 1,
    });

    for (const product of found || []) {
      const signature = productSignature(product);
      const key = signature.urlKey || signature.titleKey;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      products.push({
        ...product,
        source: product.source || 'flipkart_product',
        marketplace: 'flipkart',
      });
    }
  }

  const sorted = sortCandidatesForMission(products, mission, roleKey);
  console.log(`${logPrefix} Hunter ${role.label} Flipkart candidates: ${sorted.length}.`);
  return sorted;
}

async function searchAmazonHunterCandidates(mission, role, logPrefix = '[Product Curation]', policy = getSearchPolicy()) {
  const roleKey = role.queryGroup || 'exact';
  const products = [];
  const seen = new Set();

  for (const query of takeRoleQueries(mission, roleKey, policy)) {
    if (products.length >= 10) break;
    const found = await amazonAffiliateService.searchAmazonProducts(query, {
      limit: 8,
      logPrefix,
    });

    for (const product of found || []) {
      const signature = productSignature(product);
      const key = product.asin || signature.urlKey || signature.titleKey;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      products.push({
        ...product,
        source: 'amazon_product',
        marketplace: 'amazon',
      });
    }
  }

  const sorted = sortCandidatesForMission(products, mission, roleKey);
  console.log(`${logPrefix} Hunter ${role.label} Amazon candidates: ${sorted.length}.`);
  return sorted;
}

function hasGlobalDuplicate(link, seenGlobal) {
  const signature = productSignature(link);
  const keys = [
    signature.urlKey && `url:${signature.urlKey}`,
    signature.titleKey && `title:${signature.titleKey}`,
    signature.imageKey && `image:${signature.imageKey}`,
  ].filter(Boolean);
  return keys.some((key) => seenGlobal.has(key));
}

function rememberGlobalProduct(link, seenGlobal) {
  const signature = productSignature(link);
  [
    signature.urlKey && `url:${signature.urlKey}`,
    signature.titleKey && `title:${signature.titleKey}`,
    signature.imageKey && `image:${signature.imageKey}`,
  ].filter(Boolean).forEach((key) => seenGlobal.add(key));
}

async function validateHunterCandidate(candidate, role, mission, seenGlobal, logPrefix, searchBudget) {
  const rawLinks = await buildAffiliateShelf([candidate], {
    typeLabel: mission.productTypeLabel,
    logPrefix,
  });

  const validated = await enrichAndValidateLinks(rawLinks, {
    expectedType: mission.productType,
    logPrefix,
    limit: 1,
    searchBudget,
  });

  const link = validated[0];
  if (!link || hasGlobalDuplicate(link, seenGlobal)) return null;
  rememberGlobalProduct(link, seenGlobal);

  return {
    ...link,
    type: mission.productTypeLabel,
    role: role.label,
    roleBadge: role.badge,
    hunterRole: role.key,
    marketplace: candidate.marketplace || (amazonAffiliateService.isAmazonUrl(link.url) ? 'amazon' : 'flipkart'),
    hunterScore: candidate.hunterScore || null,
    hunterMission: {
      mode: mission.mode,
      primaryQuery: mission.primaryQuery,
      visualQuery: mission.visualQuery,
      productTypeLabel: mission.productTypeLabel,
      colors: mission.colors,
      styles: mission.styles,
      fabric: mission.fabric,
      fit: mission.fit,
      vibe: mission.vibe,
      occasion: mission.occasion,
    },
  };
}

async function buildProductHunterShelf(products, {
  query,
  queries = {},
  expectedType,
  productTypeLabel,
  limit,
  logPrefix = '[Product Curation]',
} = {}) {
  if (!expectedType) return [];

  const mission = buildShoppingMission({ query, queries, expectedType, productTypeLabel });
  console.log(`${logPrefix} AI Product Hunter mission: ${JSON.stringify({
    product: mission.primaryQuery,
    color: mission.colors.join(', ') || 'any',
    fabric: mission.fabric || 'any',
    fit: mission.fit || 'any',
    vibe: mission.vibe,
    occasion: mission.occasion,
  })}`);

  const finalLinks = [];
  const seenGlobal = new Set();
  const policy = getSearchPolicy();
  const searchBudget = createSearchBudget(policy);
  const maxItems = Math.min(Number.isFinite(Number(limit)) ? Number(limit) : 4, policy.maxRoles);

  for (const role of getActiveHunterRoles(policy).slice(0, maxItems)) {
    const preferredMarketplaces = role.preferredMarketplace === 'amazon'
      ? ['amazon', 'flipkart']
      : ['flipkart', 'amazon'];
    const marketplaces = preferredMarketplaces.slice(0, policy.maxMarketplacesPerRole);
    let selected = null;

    for (const marketplace of marketplaces) {
      const candidates = marketplace === 'amazon'
        ? await searchAmazonHunterCandidates(mission, role, logPrefix, policy)
        : await searchFlipkartHunterCandidates(mission, role, products, logPrefix, policy);

      for (const candidate of candidates.slice(0, policy.maxValidationCandidates)) {
        selected = await validateHunterCandidate(candidate, role, mission, seenGlobal, logPrefix, searchBudget);
        if (selected) break;
      }

      if (selected) break;
    }

    if (selected) {
      finalLinks.push(selected);
      console.log(`${logPrefix} Hunter selected ${role.label}: "${selected.name}" (${selected.marketplace}).`);
    } else {
      console.warn(`${logPrefix} Hunter could not validate a product for ${role.label}.`);
    }
  }

  console.log(`${logPrefix} AI Product Hunter selected ${finalLinks.length}/${maxItems} visible working product(s).`);
  return {
    affiliateLinks: finalLinks,
    shoppingMission: mission,
  };
}

async function buildSameTypeShelfFromQuery(query, {
  limit = 4,
  logPrefix = '[Product Curation]',
  fallbackName = '',
  extraQueries = [],
} = {}) {
  const clean = cleanQuery(query || fallbackName);
  if (!clean) {
    return {
      affiliateLinks: [],
      mainProductName: '',
      productType: null,
      productTypeLabel: 'Product',
    };
  }

  const expectedType = flipkartSearchService.detectProductType(clean);
  const productTypeLabel = flipkartSearchService.getProductTypeLabel(expectedType);
  const sameTypeExtraQueries = (Array.isArray(extraQueries) ? extraQueries : [])
    .map(cleanQuery)
    .filter((candidate) => {
      const candidateType = flipkartSearchService.detectProductType(candidate);
      return !candidateType || candidateType === expectedType;
    });
  const queries = buildQueriesFromText(clean, sameTypeExtraQueries);

  if (!expectedType) {
    console.warn(`${logPrefix} Product type unclear for "${clean}". Skipping storefront products to avoid mixed/wrong categories.`);
    return {
      affiliateLinks: [],
      mainProductName: clean,
      productType: null,
      productTypeLabel,
    };
  }

  console.log(`${logPrefix} Building same-type shelf from "${clean}"${expectedType ? ` (${productTypeLabel})` : ''}`);
  const policy = getSearchPolicy();
  const products = await flipkartSearchService.findProductsForSameType(queries, clean, {
    limit: getBalancedTargets(limit).flipkartTarget,
    expectedType,
    maxQueries: policy.maxInitialQueries,
  });

  const hunterResult = await buildProductHunterShelf(products, {
    query: clean,
    queries,
    expectedType,
    productTypeLabel,
    limit,
    logPrefix,
  });
  const completedLinks = hunterResult.affiliateLinks || [];

  return {
    affiliateLinks: completedLinks,
    mainProductName: completedLinks[0]?.name || clean,
    productType: expectedType,
    productTypeLabel,
    shoppingMission: hunterResult.shoppingMission || null,
  };
}

async function buildSameTypeShelfFromOutfit(outfitData, options = {}) {
  const primaryItem = pickPrimaryItem(outfitData);
  const primaryQuery = cleanQuery(primaryItem?.query);
  const extraQueries = (Array.isArray(outfitData?.items) ? outfitData.items : [])
    .filter((item) => item !== primaryItem)
    .map((item) => item?.query)
    .filter(Boolean);

  if (!primaryQuery) {
    return {
      affiliateLinks: [],
      mainProductName: options.fallbackName || '',
      outfitName: '',
      productType: null,
      productTypeLabel: 'Product',
    };
  }

  const resolved = await buildSameTypeShelfFromQuery(primaryQuery, {
    ...options,
    extraQueries,
  });

  return {
    ...resolved,
    outfitName: cleanQuery(outfitData?.outfitName) || `${resolved.productTypeLabel} Finds`,
    primaryQuery,
  };
}

async function buildSameTypeShelfFromProductData(productData, {
  limit = 4,
  logPrefix = '[Product Curation]',
} = {}) {
  if (!productData?.found) {
    return {
      affiliateLinks: [],
      mainProductName: '',
      productType: null,
      productTypeLabel: 'Product',
    };
  }

  const productName = cleanQuery(productData.productName || productData.exactMatchQuery);
  const queries = buildQueriesFromProductData(productData);
  const expectedType = flipkartSearchService.detectProductType([
    productName,
    queries.exactMatchQuery,
    queries.similarMatchQuery,
    queries.broadMatchQuery,
  ].filter(Boolean).join(' '));
  const productTypeLabel = flipkartSearchService.getProductTypeLabel(expectedType);

  if (!expectedType) {
    console.warn(`${logPrefix} Product type unclear for "${productName}". Skipping storefront products to avoid mixed/wrong categories.`);
    return {
      affiliateLinks: [],
      mainProductName: productName,
      productType: null,
      productTypeLabel,
    };
  }

  console.log(`${logPrefix} Building same-type shelf from single product "${productName}"${expectedType ? ` (${productTypeLabel})` : ''}`);
  const policy = getSearchPolicy();
  const products = await flipkartSearchService.findProductsForSameType(queries, productName, {
    limit: getBalancedTargets(limit).flipkartTarget,
    expectedType,
    maxQueries: policy.maxInitialQueries,
  });

  const hunterResult = await buildProductHunterShelf(products, {
    query: productName,
    queries,
    expectedType,
    productTypeLabel,
    limit,
    logPrefix,
  });
  const completedLinks = hunterResult.affiliateLinks || [];

  return {
    affiliateLinks: completedLinks,
    mainProductName: completedLinks[0]?.name || productName,
    productType: expectedType,
    productTypeLabel,
    shoppingMission: hunterResult.shoppingMission || null,
  };
}

module.exports = {
  buildSameTypeShelfFromOutfit,
  buildSameTypeShelfFromProductData,
  buildSameTypeShelfFromQuery,
  pickPrimaryItem,
};

'use strict';

const flipkartSearchService = require('./flipkartSearchService');
const earnKaroService = require('./earnKaroService');
const amazonAffiliateService = require('./amazonAffiliateService');

function cleanQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function fetchWithTimeout(url, init = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
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
    }, 8000);
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

async function findProductImage(name, url, logPrefix = '[Product Curation]') {
  const key = process.env.SERPER_API_KEY || process.env.SERPER_API_KEY_BACKUP || '';
  if (!key) return null;

  const isAmazon = amazonAffiliateService.isAmazonUrl(url);
  const isFlipkart = /flipkart\.com|fktr\.in/i.test(String(url || ''));
  const provider = isAmazon ? 'amazon' : isFlipkart ? 'flipkart' : '';
  const providerHint = provider === 'amazon' ? 'amazon product' : provider === 'flipkart' ? 'flipkart product' : 'product';
  const query = cleanQuery(name || url);
  if (!query) return null;

  try {
    const res = await fetchWithTimeout('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: `${query} ${providerHint}`, gl: 'in', hl: 'en', num: 8 }),
    }, 9000);

    if (!res.ok) return null;
    const data = await res.json();
    return choosePreferredImage(data?.images || [], provider);
  } catch (err) {
    console.warn(`${logPrefix} Image lookup failed for "${query}": ${err.message}`);
    return null;
  }
}

async function enrichAndValidateLinks(links, {
  expectedType,
  logPrefix = '[Product Curation]',
  limit = 4,
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
      image = await findProductImage(link.name, link.url, logPrefix);
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

async function buildBalancedMarketplaceShelf(products, {
  query,
  queries = {},
  expectedType,
  productTypeLabel,
  limit,
  logPrefix = '[Product Curation]',
} = {}) {
  if (!expectedType) return [];

  const { flipkartTarget, amazonTarget } = getBalancedTargets(limit);
  const typeQuery = flipkartSearchService.getProductTypeQueryTerm(expectedType);
  const visualQuery = flipkartSearchService.buildVisualQuery(query, expectedType);

  let flipkartLinks = await buildAffiliateShelf(dedupeProducts(products || []).slice(0, flipkartTarget), {
    typeLabel: productTypeLabel,
    logPrefix,
  });

  const amazonQuerySeeds = dedupeProducts([
    { title: query, url: `query:${query}` },
    queries.exactMatchQuery ? { title: queries.exactMatchQuery, url: `query:${queries.exactMatchQuery}` } : null,
    queries.similarMatchQuery ? { title: queries.similarMatchQuery, url: `query:${queries.similarMatchQuery}` } : null,
    visualQuery ? { title: visualQuery, url: `query:${visualQuery}` } : null,
    { title: typeQuery, url: `query:${typeQuery}` },
  ].filter(Boolean)).map((item) => item.title);

  const amazonProducts = [];
  const amazonSeen = new Set();
  for (const seed of amazonQuerySeeds) {
    if (amazonProducts.length >= amazonTarget) break;
    const found = await amazonAffiliateService.searchAmazonProducts(seed, {
      limit: Math.max(amazonTarget * 3, 6),
      logPrefix,
    });

    for (const product of found) {
      const candidateTypes = flipkartSearchService.detectAllProductTypes(product.title);
      const hasWrongType = candidateTypes.some((type) => type !== expectedType);
      const hasExpectedType = candidateTypes.includes(expectedType);
      if (hasWrongType || (candidateTypes.length > 0 && !hasExpectedType)) {
        console.log(`${logPrefix} Amazon skip "${product.title}" - type mismatch (${candidateTypes.join(', ') || 'unknown'} != ${expectedType})`);
        continue;
      }

      const signature = productSignature(product);
      const key = product.asin || signature.urlKey || signature.titleKey;
      if (!key || amazonSeen.has(key)) continue;
      amazonSeen.add(key);
      amazonProducts.push(product);
      if (amazonProducts.length >= amazonTarget) break;
    }
  }

  const amazonLinks = await buildAffiliateShelf(amazonProducts.slice(0, amazonTarget), {
    typeLabel: productTypeLabel,
    logPrefix,
  });

  const balanced = await enrichAndValidateLinks(flipkartLinks.concat(amazonLinks), {
    expectedType,
    logPrefix,
    limit: Number(limit || 4),
  });
  console.log(`${logPrefix} Balanced product shelf validated ${balanced.length}/${Number(limit || 4)} visible working product(s).`);
  return balanced;
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
  const products = await flipkartSearchService.findProductsForSameType(queries, clean, {
    limit: getBalancedTargets(limit).flipkartTarget,
    expectedType,
  });

  const completedLinks = await buildBalancedMarketplaceShelf(products, {
    query: clean,
    queries,
    expectedType,
    productTypeLabel,
    limit,
    logPrefix,
  });

  return {
    affiliateLinks: completedLinks,
    mainProductName: completedLinks[0]?.name || clean,
    productType: expectedType,
    productTypeLabel,
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
  const products = await flipkartSearchService.findProductsForSameType(queries, productName, {
    limit: getBalancedTargets(limit).flipkartTarget,
    expectedType,
  });

  const completedLinks = await buildBalancedMarketplaceShelf(products, {
    query: productName,
    queries,
    expectedType,
    productTypeLabel,
    limit,
    logPrefix,
  });

  return {
    affiliateLinks: completedLinks,
    mainProductName: completedLinks[0]?.name || productName,
    productType: expectedType,
    productTypeLabel,
  };
}

module.exports = {
  buildSameTypeShelfFromOutfit,
  buildSameTypeShelfFromProductData,
  buildSameTypeShelfFromQuery,
  pickPrimaryItem,
};

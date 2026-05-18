'use strict';

const flipkartSearchService = require('./flipkartSearchService');
const earnKaroService = require('./earnKaroService');
const amazonAffiliateService = require('./amazonAffiliateService');

function cleanQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function titleizeQuery(query) {
  return cleanQuery(query)
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function includesAllWords(base, phrase) {
  const words = new Set(cleanQuery(base).toLowerCase().split(/\s+/).filter(Boolean));
  return cleanQuery(phrase).toLowerCase().split(/\s+/).filter(Boolean).every((word) => words.has(word));
}

function buildFlipkartSearchUrl(query) {
  const clean = cleanQuery(query);
  return clean ? `https://www.flipkart.com/search?q=${encodeURIComponent(clean)}` : '';
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

  for (const product of products || []) {
    if (!product?.url) continue;

    try {
      const affiliate = await earnKaroService.makeAffiliateLink(product.url);
      const affiliateUrl = cleanQuery(affiliate?.affiliateUrl || product.url);
      if (!affiliateUrl) continue;

      affiliateLinks.push({
        type: typeLabel || fallbackType,
        name: product.title || typeLabel || 'Featured Item',
        url: affiliateUrl,
        image: product.image || null,
        originalPrice: product.price || null,
        source: product.source || 'flipkart_product',
        affiliateProvider: affiliate?.source === 'earnkaro' ? 'earnkaro' : 'raw_or_existing',
      });
    } catch (err) {
      console.warn(`${logPrefix} Affiliate link failed for "${product.title || product.url}": ${err.message}`);
    }
  }

  return affiliateLinks;
}

function buildFlipkartSearchFallbackProducts({
  query,
  typeQuery,
  typeLabel = 'Product',
  limit,
} = {}) {
  const maxItems = Math.max(0, Number.isFinite(Number(limit)) ? Number(limit) : 0);
  if (maxItems <= 0) return [];

  const clean = cleanQuery(query);
  const typedQuery = clean && typeQuery && !includesAllWords(clean, typeQuery)
    ? `${clean} ${typeQuery}`
    : '';
  const seeds = [
    clean,
    clean ? `best ${clean}` : '',
    clean ? `latest ${clean}` : '',
    typedQuery,
    typedQuery ? `best ${typedQuery}` : '',
  ].filter(Boolean);

  const seen = new Set();
  const products = [];

  for (const seed of seeds) {
    const normalized = seed.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const url = buildFlipkartSearchUrl(seed);
    if (!url) continue;

    products.push({
      title: `${typeLabel}: ${titleizeQuery(seed)}`,
      url,
      image: null,
      price: null,
      source: 'flipkart_search',
    });

    if (products.length >= maxItems) break;
  }

  return products;
}

async function buildBalancedMarketplaceShelf(products, {
  query,
  expectedType,
  productTypeLabel,
  limit,
  logPrefix = '[Product Curation]',
} = {}) {
  if (!expectedType) return [];

  const { flipkartTarget, amazonTarget } = getBalancedTargets(limit);
  const typeQuery = flipkartSearchService.getProductTypeQueryTerm(expectedType);

  let flipkartLinks = await buildAffiliateShelf((products || []).slice(0, flipkartTarget), {
    typeLabel: productTypeLabel,
    logPrefix,
  });

  if (flipkartLinks.length < flipkartTarget) {
    const fallbackProducts = buildFlipkartSearchFallbackProducts({
      query,
      typeQuery,
      typeLabel: productTypeLabel,
      limit: flipkartTarget - flipkartLinks.length,
    });
    const fallbackLinks = await buildAffiliateShelf(fallbackProducts, {
      typeLabel: productTypeLabel,
      logPrefix,
    });
    flipkartLinks = flipkartLinks.concat(fallbackLinks).slice(0, flipkartTarget);
  }

  const amazonLinks = amazonAffiliateService.buildSameTypeSearchShelf({
    query,
    typeQuery,
    typeLabel: productTypeLabel,
    limit: amazonTarget,
    logPrefix,
  });

  const balanced = flipkartLinks.concat(amazonLinks).slice(0, Number(limit || 4));
  console.log(`${logPrefix} Balanced product shelf: ${flipkartLinks.length} Flipkart + ${amazonLinks.length} Amazon.`);
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

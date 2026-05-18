'use strict';

const flipkartSearchService = require('./flipkartSearchService');
const earnKaroService = require('./earnKaroService');
const amazonAffiliateService = require('./amazonAffiliateService');

function cleanQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildQueriesFromText(query) {
  const clean = cleanQuery(query);
  return {
    exactMatchQuery: clean,
    similarMatchQuery: clean,
    broadMatchQuery: clean.split(' ').slice(0, 4).join(' '),
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
      });
    } catch (err) {
      console.warn(`${logPrefix} Affiliate link failed for "${product.title || product.url}": ${err.message}`);
    }
  }

  return affiliateLinks;
}

function fillWithAmazonFallback(affiliateLinks, {
  query,
  expectedType,
  productTypeLabel,
  limit,
  logPrefix = '[Product Curation]',
} = {}) {
  const remaining = Math.max(0, Number(limit || 0) - affiliateLinks.length);
  if (remaining <= 0) return affiliateLinks;
  if (!expectedType) return affiliateLinks;

  const typeQuery = flipkartSearchService.getProductTypeQueryTerm(expectedType);
  const amazonLinks = amazonAffiliateService.buildSameTypeSearchShelf({
    query,
    typeQuery,
    typeLabel: productTypeLabel,
    limit: remaining,
    logPrefix,
  });

  return affiliateLinks.concat(amazonLinks);
}

async function buildSameTypeShelfFromQuery(query, {
  limit = 4,
  logPrefix = '[Product Curation]',
  fallbackName = '',
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
  const queries = buildQueriesFromText(clean);

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
    limit,
    expectedType,
  });

  const affiliateLinks = await buildAffiliateShelf(products, {
    typeLabel: productTypeLabel,
    logPrefix,
  });
  const completedLinks = fillWithAmazonFallback(affiliateLinks, {
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

  if (!primaryQuery) {
    return {
      affiliateLinks: [],
      mainProductName: options.fallbackName || '',
      outfitName: '',
      productType: null,
      productTypeLabel: 'Product',
    };
  }

  const resolved = await buildSameTypeShelfFromQuery(primaryQuery, options);

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
    limit,
    expectedType,
  });

  const affiliateLinks = await buildAffiliateShelf(products, {
    typeLabel: productTypeLabel,
    logPrefix,
  });
  const completedLinks = fillWithAmazonFallback(affiliateLinks, {
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

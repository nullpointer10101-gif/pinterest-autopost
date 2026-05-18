'use strict';

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isEnabled() {
  return String(process.env.QUALITY_GATE_ENABLED || 'true').toLowerCase() !== 'false';
}

function minScore() {
  return Math.max(1, Math.min(100, toInt(process.env.QUALITY_GATE_MIN_SCORE, 75)));
}

function minProducts() {
  return Math.max(1, toInt(process.env.QUALITY_GATE_MIN_PRODUCTS, 2));
}

function requireBoard() {
  return String(process.env.QUALITY_GATE_REQUIRE_BOARD || '').toLowerCase() === 'true';
}

function cleanText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function safeUrl(value = '') {
  const raw = cleanText(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function isLookUrl(value = '') {
  try {
    const parsed = new URL(value);
    return /^\/look\/[^/]+\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isUnsafeDestination(value = '') {
  const url = safeUrl(value);
  if (!url) return true;
  if (/instagram\.com\//i.test(url)) return true;
  return false;
}

function normalizeProductUrl(value = '') {
  const url = safeUrl(value);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.searchParams.delete('utm_source');
    parsed.searchParams.delete('utm_medium');
    parsed.searchParams.delete('utm_campaign');
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase().replace(/\/$/, '');
  } catch {
    return url.toLowerCase();
  }
}

function collectProducts(payload = {}) {
  const outfit = Array.isArray(payload?.productInfo?.outfit) ? payload.productInfo.outfit : [];
  const links = Array.isArray(payload.affiliateLinks) ? payload.affiliateLinks : [];
  const fallbackAffiliate = payload?.productInfo?.affiliateUrl
    ? [{ name: payload.productInfo.name || 'Featured Item', url: payload.productInfo.affiliateUrl }]
    : [];

  const seen = new Set();
  const products = [];

  for (const item of [...outfit, ...links, ...fallbackAffiliate]) {
    const url = safeUrl(item?.url || item?.affiliateUrl || '');
    const key = normalizeProductUrl(url) || cleanText(item?.name || item?.title || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    products.push({
      name: cleanText(item?.name || item?.title || item?.query || 'Product'),
      url,
      image: cleanText(item?.image || item?.thumbnail || ''),
      linkVerified: item?.linkVerified !== false,
      imageVerified: item?.imageVerified !== false,
      marketplace: cleanText(item?.marketplace || item?.source || item?.affiliateProvider || ''),
    });
  }

  return products;
}

function hasWeakCaption(title = '', description = '') {
  const text = `${title} ${description}`.toLowerCase();
  const titleClean = cleanText(title);
  const descClean = cleanText(description);
  if (titleClean.length < 12) return true;
  if (descClean.length < 60) return true;
  if (/^(instagram reel repost|pinterest post|shop the look|queued post failed)$/i.test(titleClean)) return true;
  if (/comment\s+(link|links)|link\s+in\s+bio|dm\s+for\s+link/i.test(text) && descClean.length < 180) return true;
  return false;
}

function evaluatePrePublish(payload = {}) {
  const enabled = isEnabled();
  const threshold = minScore();
  const minProductCount = minProducts();
  const products = collectProducts(payload);
  const title = cleanText(payload.title);
  const description = cleanText(payload.description);
  const mediaUrl = safeUrl(payload.mediaUrl);
  const thumbnailUrl = safeUrl(payload.thumbnailUrl);
  const externalLink = safeUrl(payload.externalLink || payload.link || payload.finalLink || '');
  const boardName = cleanText(payload.boardName);
  const hasFrame = !!payload.hasFrame || !!payload.imageData;
  const hasSmartCover = payload.smartCover === true || !!payload.smartCoverSource;
  const duplicateAlreadyPosted = payload.duplicateAlreadyPosted === true;
  const validProducts = products.filter((product) => (
    product.url &&
    !isLookUrl(product.url) &&
    !/instagram\.com\//i.test(product.url) &&
    product.linkVerified &&
    product.image &&
    product.imageVerified
  ));
  const duplicateProductCount = Math.max(0, products.length - new Set(products.map((product) => normalizeProductUrl(product.url) || product.name.toLowerCase())).size);
  const hasSafeDestination = externalLink && !isUnsafeDestination(externalLink);
  const storefrontDestination = hasSafeDestination && isLookUrl(externalLink);
  const weakCaption = hasWeakCaption(title, description);
  const hasVisualEvidence = hasFrame || !!thumbnailUrl || hasSmartCover || validProducts.length > 0;
  const hasThumbnailEvidence = !!thumbnailUrl || hasFrame || hasSmartCover;

  const checks = {
    duplicateSafe: !duplicateAlreadyPosted,
    mediaPresent: !!mediaUrl,
    thumbnailGood: hasThumbnailEvidence,
    productVisibleEvidence: hasVisualEvidence,
    captionStrong: !weakCaption,
    productsFound: validProducts.length >= minProductCount,
    linksWorking: validProducts.length >= minProductCount,
    noDuplicateProducts: duplicateProductCount === 0,
    destinationSafe: !!hasSafeDestination,
    boardSelected: !!boardName,
  };

  let score = 0;
  if (checks.duplicateSafe) score += 15;
  if (checks.mediaPresent) score += 10;
  if (checks.thumbnailGood) score += 10;
  if (checks.productVisibleEvidence) score += 10;
  if (checks.captionStrong) score += 15;
  score += Math.min(25, Math.round((validProducts.length / minProductCount) * 25));
  if (checks.noDuplicateProducts) score += 5;
  if (checks.destinationSafe) score += 5;
  if (checks.boardSelected) score += 5;

  score = Math.max(0, Math.min(100, score));

  const reasons = [];
  if (!checks.duplicateSafe) reasons.push('duplicate reel/post already exists');
  if (!checks.mediaPresent) reasons.push('media URL missing');
  if (!checks.thumbnailGood) reasons.push('thumbnail or product-frame evidence missing');
  if (!checks.productVisibleEvidence) reasons.push('product visibility evidence missing');
  if (!checks.captionStrong) reasons.push('caption/title too weak or generic');
  if (!checks.productsFound) reasons.push(`only ${validProducts.length}/${minProductCount} verified product(s) found`);
  if (!checks.linksWorking) reasons.push('product links/images are not fully verified');
  if (!checks.noDuplicateProducts) reasons.push('duplicate product cards detected');
  if (!checks.destinationSafe) reasons.push('safe destination link missing');
  if (requireBoard() && !checks.boardSelected) reasons.push('board was not selected');

  const hardBlock = duplicateAlreadyPosted ||
    !checks.mediaPresent ||
    !checks.productsFound ||
    !checks.linksWorking ||
    !checks.destinationSafe ||
    (requireBoard() && !checks.boardSelected);
  const passed = !enabled || (!hardBlock && score >= threshold);

  return {
    enabled,
    passed,
    decision: passed ? 'pass' : 'hold',
    score,
    threshold,
    minProducts: minProductCount,
    reasons,
    checks,
    metrics: {
      productCount: products.length,
      verifiedProductCount: validProducts.length,
      duplicateProductCount,
      hasFrame,
      hasSmartCover,
      hasThumbnail: !!thumbnailUrl,
      hasStorefrontDestination: storefrontDestination,
      hasBoard: !!boardName,
      pipeline: payload.pipeline || '',
      shortcode: payload.shortcode || '',
    },
  };
}

function summarizeGate(result = {}) {
  const reasons = Array.isArray(result.reasons) && result.reasons.length
    ? result.reasons.join('; ')
    : 'no blocking reasons';
  const blockedByChecks = result.decision === 'hold' && Number(result.score || 0) >= Number(result.threshold || 0);
  const suffix = blockedByChecks ? 'mandatory checks failed' : reasons;
  return `Quality gate ${result.decision || 'unknown'}: score ${result.score}/${result.threshold} (${suffix}${blockedByChecks ? `: ${reasons}` : ''})`;
}

module.exports = {
  evaluatePrePublish,
  summarizeGate,
};

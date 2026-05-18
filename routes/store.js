'use strict';

const express = require('express');
const router = express.Router();
const historyService = require('../services/historyService');
const igRepostStateService = require('../services/igRepostStateService');

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJson(value) {
  return JSON.stringify(value ?? null)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function parseShortcode(value = '') {
  const match = String(value || '').match(/\/(?:reel|p|tv|look)\/([A-Za-z0-9_-]+)/i);
  return match ? match[1] : '';
}

function normalizeDate(value) {
  const date = new Date(value || '');
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatDate(value) {
  const date = normalizeDate(value);
  if (!date) return 'Recently posted';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function timeAgo(value) {
  const date = normalizeDate(value);
  if (!date) return 'recently';
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function isLookPageUrl(value = '') {
  try {
    const parsed = new URL(String(value || '').trim());
    return /^\/look\/[^/]+\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isSafeRemoteImageUrl(value = '') {
  try {
    const parsed = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function normalizeMarketplace(item = {}) {
  const text = [
    item.marketplace,
    item.source,
    item.affiliateProvider,
    item.url,
  ].filter(Boolean).join(' ').toLowerCase();

  if (text.includes('amazon')) return 'Amazon';
  if (text.includes('flipkart') || text.includes('fktr')) return 'Flipkart';
  if (text.includes('earnkaro')) return 'EarnKaro';
  return '';
}

function normalizeOutfitItems(record = {}) {
  const outfit = Array.isArray(record?.productInfo?.outfit) ? record.productInfo.outfit : [];
  if (outfit.length > 0) return outfit;

  const fallbackUrl = record?.productInfo?.affiliateUrl || record?.affiliateLink || '';
  if (fallbackUrl && !isLookPageUrl(fallbackUrl)) {
    return [{
      type: 'Main Piece',
      name: record?.productInfo?.name || record?.aiContent?.title || record?.title || 'Featured Item',
      url: fallbackUrl,
      image: '',
      marketplace: normalizeMarketplace({ url: fallbackUrl }),
    }];
  }

  return [];
}

function resolveShortcode(record = {}) {
  return String(
    record.shortcode ||
    record?.reelData?.shortcode ||
    parseShortcode(record.url || record.sourceUrl || record.affiliateLink || '')
  ).trim();
}

function resolveThumbnail(record = {}, shortcode = '') {
  const direct = String(record.thumbnailUrl || record?.reelData?.thumbnailUrl || '').trim();
  if (record.source === 'history' && record.id) {
    return `/api/history/thumb/${encodeURIComponent(record.id)}`;
  }
  if (shortcode && direct && isSafeRemoteImageUrl(direct)) {
    return `/look/${encodeURIComponent(shortcode)}/image-proxy?src=${encodeURIComponent(direct)}`;
  }
  return '';
}

function normalizeLook(record = {}, source = 'history') {
  const shortcode = resolveShortcode(record);
  if (!shortcode) return null;

  const outfit = normalizeOutfitItems(record);
  const shoppingMission = record?.productInfo?.shoppingMission || null;
  const productType = String(
    shoppingMission?.productTypeLabel ||
    outfit[0]?.type ||
    record?.productInfo?.category ||
    'Look'
  ).trim();
  const productNames = outfit
    .map((item) => String(item.name || item.title || item.query || '').trim())
    .filter(Boolean);
  const marketplaces = Array.from(new Set(outfit.map(normalizeMarketplace).filter(Boolean)));
  const username = String(record.username || record?.reelData?.username || '').trim();
  const title = String(
    record?.aiContent?.title ||
    record.title ||
    record?.productInfo?.name ||
    productNames[0] ||
    'Shop The Look'
  ).trim();
  const description = String(
    record?.aiContent?.description ||
    record.description ||
    record.caption ||
    record?.reelData?.caption ||
    'Curated product finds from this Reel Orbit look.'
  ).trim();
  const createdAt = record.postedAt || record.createdAt || record.updatedAt || record.completedAt || '';

  return {
    id: String(record.id || `${source}-${shortcode}`),
    source,
    sourceLabel: source === 'ig_repost' ? 'IG Repost' : 'FirePost',
    shortcode,
    href: `/look/${encodeURIComponent(shortcode)}`,
    title,
    description,
    username,
    createdAt,
    displayDate: formatDate(createdAt),
    timeAgo: timeAgo(createdAt),
    thumbnail: resolveThumbnail({ ...record, source }, shortcode),
    productType,
    productCount: outfit.length,
    marketplaces,
    colors: Array.isArray(shoppingMission?.colors) ? shoppingMission.colors.slice(0, 3) : [],
    vibe: shoppingMission?.vibe || '',
    productNames: productNames.slice(0, 4),
    searchText: [
      title,
      description,
      username,
      productType,
      record.boardName,
      marketplaces.join(' '),
      productNames.join(' '),
      Array.isArray(shoppingMission?.colors) ? shoppingMission.colors.join(' ') : '',
      shoppingMission?.fabric || '',
      shoppingMission?.vibe || '',
      shoppingMission?.occasion || '',
    ].join(' ').toLowerCase(),
  };
}

function dedupeLooks(looks = []) {
  const seen = new Set();
  const result = [];

  for (const look of looks) {
    if (!look?.shortcode) continue;
    const key = look.shortcode.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(look);
  }

  return result.sort((a, b) => {
    const aTime = normalizeDate(a.createdAt)?.getTime() || 0;
    const bTime = normalizeDate(b.createdAt)?.getTime() || 0;
    return bTime - aTime;
  });
}

async function loadStoreLooks() {
  const [historyPosts, igPosts] = await Promise.all([
    historyService.getAll().catch(() => []),
    typeof igRepostStateService.listLookPosts === 'function'
      ? igRepostStateService.listLookPosts(800).catch(() => [])
      : Promise.resolve([]),
  ]);

  return dedupeLooks([
    ...historyPosts.map((post) => normalizeLook(post, 'history')),
    ...igPosts.map((post) => normalizeLook(post, 'ig_repost')),
  ].filter(Boolean));
}

function buildStats(looks = []) {
  const productTotal = looks.reduce((sum, look) => sum + Number(look.productCount || 0), 0);
  const withProducts = looks.filter((look) => look.productCount > 0).length;
  const marketplaceSet = new Set();
  looks.forEach((look) => look.marketplaces.forEach((name) => marketplaceSet.add(name)));
  return {
    looks: looks.length,
    withProducts,
    products: productTotal,
    marketplaces: marketplaceSet.size,
  };
}

function buildTopShelves(looks = [], limit = 6) {
  const counts = new Map();
  for (const look of looks) {
    const type = String(look.productType || '').trim();
    if (!type || type.toLowerCase() === 'look') continue;
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function renderCard(look, index) {
  const image = look.thumbnail
    ? `<img src="${escapeHtml(look.thumbnail)}" alt="${escapeHtml(look.title)}" loading="${index < 8 ? 'eager' : 'lazy'}" onerror="this.closest('.look-media').classList.add('image-failed'); this.remove();">`
    : '';
  const marketBadges = look.marketplaces.slice(0, 2)
    .map((name) => `<span>${escapeHtml(name)}</span>`)
    .join('');
  const chips = [
    look.productType,
    ...look.colors,
    look.vibe,
  ].filter(Boolean).slice(0, 4);
  const productPreview = look.productNames.length
    ? look.productNames.slice(0, 3).map((name) => `<li>${escapeHtml(name)}</li>`).join('')
    : '<li>Products open inside this look.</li>';

  return `
    <a class="look-card" href="${escapeHtml(look.href)}" data-card data-source="${escapeHtml(look.source)}" data-products="${look.productCount}" data-date="${escapeHtml(look.createdAt)}" data-search="${escapeHtml(look.searchText)}">
      <div class="look-media">
        ${image}
        <div class="image-fallback">
          <span>${String(index + 1).padStart(2, '0')}</span>
          <strong>${escapeHtml(look.productType)}</strong>
        </div>
        <div class="look-badges">
          <span>${escapeHtml(look.sourceLabel)}</span>
          <span>${look.productCount || 0} products</span>
        </div>
      </div>
      <div class="look-body">
        <div class="look-meta">
          <span>${escapeHtml(look.timeAgo)}</span>
          ${look.username ? `<span>@${escapeHtml(look.username)}</span>` : '<span>Reel Orbit</span>'}
        </div>
        <h2>${escapeHtml(look.title)}</h2>
        <p>${escapeHtml(look.description).slice(0, 155)}${look.description.length > 155 ? '...' : ''}</p>
        <div class="chip-row">
          ${chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join('')}
        </div>
        <ul class="product-preview">${productPreview}</ul>
        <div class="card-foot">
          <div class="market-row">${marketBadges || '<span>Storefront</span>'}</div>
          <strong>Open look</strong>
        </div>
      </div>
    </a>
  `;
}

function renderStorePage(looks = []) {
  const stats = buildStats(looks);
  const topShelves = buildTopShelves(looks);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reel Orbit Store | Shop The Looks</title>
  <meta name="description" content="Browse every Reel Orbit look and open curated products inside each reel.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #070706;
      --panel: #11110f;
      --panel-2: #191915;
      --text: #f8f0df;
      --muted: rgba(248, 240, 223, .62);
      --line: rgba(248, 240, 223, .13);
      --gold: #f0c95a;
      --green: #81d6a4;
      --orange: #f36b3d;
      --blue: #9ac8ff;
      --shadow: 0 28px 90px rgba(0, 0, 0, .45);
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Manrope, sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at 12% 12%, rgba(129, 214, 164, .14), transparent 32%),
        radial-gradient(circle at 88% 8%, rgba(240, 201, 90, .16), transparent 28%),
        radial-gradient(circle at 60% 80%, rgba(243, 107, 61, .10), transparent 36%),
        linear-gradient(180deg, #0b0b09 0%, var(--bg) 56%, #050505 100%);
    }
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: .18;
      background-image:
        linear-gradient(rgba(248, 240, 223, .06) 1px, transparent 1px),
        linear-gradient(90deg, rgba(248, 240, 223, .05) 1px, transparent 1px);
      background-size: 64px 64px;
      mask-image: linear-gradient(to bottom, black, transparent 80%);
    }
    a { color: inherit; text-decoration: none; }
    button, input, select { font: inherit; }
    .shell { width: min(1440px, calc(100% - 34px)); margin: 0 auto; position: relative; z-index: 1; }
    .topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      border-bottom: 1px solid var(--line);
      background: rgba(7, 7, 6, .78);
      backdrop-filter: blur(18px);
    }
    .topbar-inner {
      min-height: 72px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .mark {
      width: 42px;
      height: 42px;
      border-radius: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background:
        radial-gradient(circle at 70% 20%, rgba(255, 255, 255, .42), transparent 24%),
        linear-gradient(135deg, var(--gold), var(--green));
      box-shadow: 0 0 34px rgba(240, 201, 90, .24);
      border: 1px solid rgba(248, 240, 223, .28);
      flex: 0 0 auto;
    }
    .mark svg {
      width: 25px;
      height: 25px;
      display: block;
    }
    .brand strong {
      display: block;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 19px;
      letter-spacing: -.03em;
    }
    .brand span { display: block; color: var(--muted); font-size: 12px; font-weight: 800; }
    .top-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .nav-btn {
      min-height: 42px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 0 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(248, 240, 223, .06);
      color: var(--text);
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: .04em;
      transition: transform .18s ease, background .18s ease, border-color .18s ease;
    }
    .nav-btn:hover { transform: translateY(-2px); background: rgba(240, 201, 90, .12); border-color: rgba(240, 201, 90, .45); }
    .hero {
      padding: 52px 0 26px;
      display: grid;
      grid-template-columns: minmax(320px, 1.05fr) minmax(390px, .95fr);
      gap: 34px;
      align-items: stretch;
    }
    .hero-copy {
      border: 1px solid var(--line);
      border-radius: 30px;
      padding: clamp(24px, 4vw, 48px);
      background: linear-gradient(145deg, rgba(248, 240, 223, .08), rgba(248, 240, 223, .03));
      box-shadow: var(--shadow);
      overflow: hidden;
      position: relative;
    }
    .hero-copy::after {
      content: '';
      position: absolute;
      width: 220px;
      height: 220px;
      right: -80px;
      top: -80px;
      border-radius: 999px;
      background: radial-gradient(circle, rgba(240, 201, 90, .28), transparent 68%);
    }
    .kicker {
      color: var(--green);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    h1 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: clamp(48px, 7vw, 104px);
      line-height: .88;
      letter-spacing: -.07em;
      margin: 18px 0;
      max-width: 780px;
    }
    .hero-copy p {
      color: var(--muted);
      font-size: 17px;
      line-height: 1.7;
      max-width: 680px;
      margin: 0;
    }
    .hero-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 24px; }
    .primary-cta {
      min-height: 48px;
      padding: 0 20px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      gap: 9px;
      background: var(--gold);
      color: #15120c;
      font-weight: 950;
      border: 0;
      box-shadow: 0 18px 42px rgba(240, 201, 90, .18);
    }
    .hero-search-panel {
      width: 100%;
      margin-top: 24px;
      min-height: 66px;
      border: 1px solid rgba(248, 240, 223, .16);
      border-radius: 22px;
      padding: 12px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: rgba(7, 7, 6, .34);
      color: var(--text);
      cursor: pointer;
      text-align: left;
      transition: transform .18s ease, border-color .18s ease, background .18s ease;
    }
    .hero-search-panel:hover {
      transform: translateY(-2px);
      border-color: rgba(240, 201, 90, .5);
      background: rgba(240, 201, 90, .08);
    }
    .hero-search-panel span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      font-weight: 950;
      text-transform: uppercase;
      letter-spacing: .12em;
    }
    .hero-search-panel strong {
      display: block;
      margin-top: 4px;
      font-size: 15px;
      font-weight: 900;
    }
    .hero-search-panel em {
      width: 38px;
      height: 38px;
      border-radius: 999px;
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      background: var(--gold);
      color: #15120c;
      font-style: normal;
      font-weight: 950;
    }
    .quick-shelves {
      margin-top: 28px;
      padding-top: 22px;
      border-top: 1px solid var(--line);
    }
    .quick-shelves strong {
      display: block;
      color: var(--muted);
      font-size: 11px;
      font-weight: 950;
      letter-spacing: .14em;
      text-transform: uppercase;
      margin-bottom: 10px;
    }
    .shelf-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .shelf-chip {
      min-height: 34px;
      border: 1px solid rgba(248, 240, 223, .16);
      border-radius: 999px;
      padding: 0 11px;
      background: rgba(248, 240, 223, .07);
      color: var(--text);
      cursor: pointer;
      font-size: 11px;
      font-weight: 950;
      text-transform: uppercase;
      transition: transform .18s ease, background .18s ease, border-color .18s ease;
    }
    .shelf-chip:hover {
      transform: translateY(-2px);
      background: rgba(129, 214, 164, .16);
      border-color: rgba(129, 214, 164, .42);
    }
    .benefit-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-top: 22px;
    }
    .benefit-card {
      border: 1px solid var(--line);
      border-radius: 18px;
      background: rgba(7, 7, 6, .28);
      padding: 13px;
    }
    .benefit-card span {
      color: var(--gold);
      font-size: 11px;
      font-weight: 950;
      text-transform: uppercase;
    }
    .benefit-card p {
      margin: 6px 0 0;
      color: rgba(248, 240, 223, .78);
      font-size: 12px;
      line-height: 1.45;
    }
    .store-console {
      border: 1px solid rgba(240, 201, 90, .22);
      border-radius: 30px;
      background:
        linear-gradient(150deg, rgba(240, 201, 90, .12), transparent 32%),
        linear-gradient(160deg, rgba(25, 25, 21, .98), rgba(12, 12, 10, .98));
      box-shadow: var(--shadow);
      padding: clamp(18px, 2.8vw, 28px);
      position: relative;
      overflow: hidden;
    }
    .store-console::before {
      content: '';
      position: absolute;
      inset: -1px;
      background:
        linear-gradient(90deg, transparent 0 46%, rgba(248, 240, 223, .08) 46% 47%, transparent 47% 100%),
        linear-gradient(0deg, transparent 0 46%, rgba(248, 240, 223, .06) 46% 47%, transparent 47% 100%);
      background-size: 86px 86px;
      opacity: .22;
      pointer-events: none;
    }
    .console-head {
      position: relative;
      z-index: 1;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 18px;
    }
    .console-head span {
      color: var(--muted);
      font-size: 11px;
      font-weight: 950;
      letter-spacing: .16em;
      text-transform: uppercase;
    }
    .console-head strong {
      min-height: 28px;
      border: 1px solid rgba(129, 214, 164, .34);
      border-radius: 999px;
      padding: 0 10px;
      display: grid;
      place-items: center;
      color: var(--green);
      background: rgba(129, 214, 164, .09);
      font-size: 11px;
      font-weight: 950;
    }
    .store-stat-grid {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .mission-card {
      position: relative;
      z-index: 1;
      margin-top: 14px;
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 18px;
      background: rgba(7, 7, 6, .35);
    }
    .mission-card h2 {
      margin: 0 0 14px;
      font-family: 'Space Grotesk', sans-serif;
      font-size: clamp(24px, 3vw, 38px);
      line-height: .98;
      letter-spacing: -.05em;
    }
    .mission-steps {
      display: grid;
      gap: 9px;
    }
    .mission-step {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      color: rgba(248, 240, 223, .78);
      font-size: 13px;
      line-height: 1.45;
    }
    .mission-step span {
      width: 24px;
      height: 24px;
      border-radius: 999px;
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      color: #15120c;
      background: var(--green);
      font-size: 11px;
      font-weight: 950;
    }
    .source-row {
      position: relative;
      z-index: 1;
      margin-top: 14px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .source-row span {
      border: 1px solid rgba(248, 240, 223, .16);
      border-radius: 999px;
      padding: 8px 10px;
      color: var(--muted);
      background: rgba(248, 240, 223, .06);
      font-size: 11px;
      font-weight: 950;
      text-transform: uppercase;
    }
    .style-finder {
      position: relative;
      z-index: 1;
      margin-top: 14px;
      border: 1px solid rgba(129, 214, 164, .22);
      border-radius: 24px;
      padding: 18px;
      background:
        radial-gradient(circle at 92% 12%, rgba(129, 214, 164, .16), transparent 34%),
        rgba(7, 7, 6, .34);
    }
    .style-finder h2 {
      margin: 0 0 6px;
      font-family: 'Space Grotesk', sans-serif;
      font-size: clamp(24px, 3vw, 36px);
      letter-spacing: -.05em;
      line-height: 1;
    }
    .style-finder p {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      line-height: 1.5;
    }
    .finder-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 14px;
    }
    .finder-btn {
      min-height: 44px;
      border: 1px solid rgba(248, 240, 223, .14);
      border-radius: 16px;
      background: rgba(248, 240, 223, .06);
      color: var(--text);
      cursor: pointer;
      padding: 9px 10px;
      text-align: left;
      font-size: 12px;
      font-weight: 950;
      transition: transform .18s ease, border-color .18s ease, background .18s ease;
    }
    .finder-btn:hover {
      transform: translateY(-2px);
      border-color: rgba(240, 201, 90, .45);
      background: rgba(240, 201, 90, .1);
    }
    .finder-btn span {
      display: block;
      margin-top: 2px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 850;
    }
    .stat-card {
      min-height: 116px;
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 18px;
      background: linear-gradient(145deg, rgba(25, 25, 21, .92), rgba(17, 17, 15, .72));
      position: relative;
      overflow: hidden;
    }
    .stat-card::after {
      content: '';
      position: absolute;
      inset: auto -40px -60px auto;
      width: 150px;
      height: 150px;
      border-radius: 999px;
      background: radial-gradient(circle, rgba(129, 214, 164, .18), transparent 70%);
    }
    .stat-card span {
      color: var(--muted);
      font-size: 11px;
      font-weight: 950;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .stat-card strong {
      display: block;
      margin-top: 14px;
      font-family: 'Space Grotesk', sans-serif;
      font-size: clamp(32px, 4vw, 54px);
      line-height: .9;
    }
    .insight-strip {
      margin: 0 0 22px;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .insight-card {
      border: 1px solid var(--line);
      border-radius: 22px;
      background: rgba(17, 17, 15, .66);
      padding: 16px;
    }
    .insight-card strong {
      display: block;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 20px;
      letter-spacing: -.03em;
      margin-bottom: 6px;
    }
    .insight-card span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      line-height: 1.45;
    }
    .toolbar {
      margin: 18px 0 26px;
      display: grid;
      grid-template-columns: minmax(260px, 1fr) auto auto;
      gap: 12px;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 24px;
      background: rgba(17, 17, 15, .76);
      padding: 12px;
    }
    .search {
      min-height: 48px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: rgba(248, 240, 223, .08);
      color: var(--text);
      padding: 0 16px;
      outline: none;
    }
    .search:focus { border-color: rgba(240, 201, 90, .55); }
    .filter-row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .filter-btn {
      min-height: 40px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 0 13px;
      background: rgba(248, 240, 223, .06);
      color: var(--muted);
      cursor: pointer;
      font-size: 12px;
      font-weight: 900;
    }
    .filter-btn.active { color: #15120c; background: var(--green); border-color: var(--green); }
    .sort-select {
      min-height: 44px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(248, 240, 223, .08);
      color: var(--text);
      padding: 0 14px;
      outline: none;
      font-weight: 900;
    }
    .sort-select option { background: #11110f; color: var(--text); }
    .section-head {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 16px;
      margin: 22px 0 16px;
    }
    .section-head h2 {
      margin: 0;
      font-family: 'Space Grotesk', sans-serif;
      font-size: clamp(28px, 4vw, 54px);
      letter-spacing: -.05em;
    }
    .section-head p { margin: 0; color: var(--muted); font-weight: 800; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(245px, 1fr));
      gap: 16px;
      padding-bottom: 56px;
    }
    .look-card {
      display: flex;
      min-height: 100%;
      flex-direction: column;
      border: 1px solid var(--line);
      border-radius: 26px;
      overflow: hidden;
      background: linear-gradient(160deg, rgba(25, 25, 21, .98), rgba(14, 14, 12, .96));
      box-shadow: 0 20px 70px rgba(0,0,0,.24);
      transition: transform .2s ease, border-color .2s ease, box-shadow .2s ease;
    }
    .look-card:hover {
      transform: translateY(-6px);
      border-color: rgba(240, 201, 90, .45);
      box-shadow: 0 30px 90px rgba(0,0,0,.34);
    }
    .look-card.hidden { display: none; }
    .look-media {
      position: relative;
      aspect-ratio: 4 / 5;
      overflow: hidden;
      background:
        radial-gradient(circle at 32% 22%, rgba(240, 201, 90, .26), transparent 40%),
        linear-gradient(145deg, #201d18, #0f0f0d);
    }
    .look-media img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      transition: transform .32s ease, opacity .2s ease;
    }
    .look-card:hover .look-media img { transform: scale(1.045); }
    .image-fallback {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 20px;
      text-align: center;
      color: var(--muted);
      z-index: 0;
    }
    .image-fallback span {
      display: block;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 64px;
      color: rgba(248, 240, 223, .08);
    }
    .image-fallback strong {
      display: block;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 20px;
      color: rgba(248, 240, 223, .56);
    }
    .look-media img + .image-fallback { display: none; }
    .look-media.image-failed .image-fallback { display: grid; }
    .look-badges {
      position: absolute;
      left: 12px;
      right: 12px;
      bottom: 12px;
      display: flex;
      justify-content: space-between;
      gap: 8px;
      z-index: 2;
    }
    .look-badges span {
      border: 1px solid rgba(248, 240, 223, .22);
      background: rgba(7, 7, 6, .72);
      backdrop-filter: blur(12px);
      border-radius: 999px;
      padding: 7px 9px;
      color: var(--text);
      font-size: 10px;
      font-weight: 950;
      text-transform: uppercase;
    }
    .look-body {
      flex: 1;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .look-meta {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
    }
    .look-body h2 {
      margin: 0;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 22px;
      line-height: 1.05;
      letter-spacing: -.04em;
    }
    .look-body p {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.55;
    }
    .chip-row, .market-row {
      display: flex;
      gap: 7px;
      flex-wrap: wrap;
    }
    .chip-row span, .market-row span {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 6px 8px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 950;
      text-transform: uppercase;
    }
    .product-preview {
      margin: 0;
      padding: 0 0 0 18px;
      color: rgba(248, 240, 223, .78);
      font-size: 12px;
      line-height: 1.55;
    }
    .card-foot {
      margin-top: auto;
      padding-top: 12px;
      border-top: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .card-foot strong {
      color: var(--gold);
      font-size: 12px;
      font-weight: 950;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .empty {
      border: 1px dashed rgba(248, 240, 223, .22);
      border-radius: 28px;
      padding: 44px;
      text-align: center;
      background: rgba(248, 240, 223, .04);
      color: var(--muted);
      margin-bottom: 56px;
    }
    .toast {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 50;
      padding: 12px 14px;
      border: 1px solid rgba(129, 214, 164, .35);
      border-radius: 16px;
      background: rgba(7, 7, 6, .86);
      color: var(--text);
      font-size: 13px;
      font-weight: 900;
      opacity: 0;
      transform: translateY(12px);
      transition: opacity .2s ease, transform .2s ease;
      pointer-events: none;
    }
    .toast.visible { opacity: 1; transform: translateY(0); }
    @media (max-width: 980px) {
      .hero { grid-template-columns: 1fr; padding-top: 28px; }
      .store-stat-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .stat-card { min-height: 124px; padding: 16px; border-radius: 20px; }
      .toolbar { grid-template-columns: 1fr; }
      .filter-row { justify-content: flex-start; }
    }
    @media (max-width: 680px) {
      .shell { width: min(100% - 22px, 1440px); }
      .topbar-inner { align-items: flex-start; flex-direction: column; padding: 12px 0; }
      .top-actions { width: 100%; }
      .nav-btn { flex: 1; min-width: 0; }
      .hero-copy { border-radius: 24px; padding: 24px; }
      .benefit-grid,
      .insight-strip { grid-template-columns: 1fr; }
      .store-stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .stat-card strong { font-size: 38px; }
      .section-head { align-items: flex-start; flex-direction: column; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="shell topbar-inner">
      <a class="brand" href="/">
        <span class="mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" role="img" aria-label="Reel Orbit logo">
            <path d="M16 4.8c6.2 0 11.2 5 11.2 11.2S22.2 27.2 16 27.2 4.8 22.2 4.8 16 9.8 4.8 16 4.8Z" fill="none" stroke="#15120c" stroke-width="2.4"/>
            <path d="M10.4 16h11.2M16 10.4v11.2" stroke="#15120c" stroke-width="2.4" stroke-linecap="round"/>
            <path d="M21.6 6.8 25.2 3.2M25.2 3.2h-5M25.2 3.2v5" stroke="#15120c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        <span>
          <strong>Reel Orbit Store</strong>
          <span>Shop every posted menswear look</span>
        </span>
      </a>
      <nav class="top-actions" aria-label="Store navigation">
        <a class="nav-btn" href="/">Dashboard</a>
        <a class="nav-btn" href="/store">Store</a>
        <button class="nav-btn" id="copy-store" type="button">Copy Link</button>
      </nav>
    </div>
  </header>

  <main class="shell">
    <section class="hero">
      <div class="hero-copy">
        <span class="kicker">Reel Orbit Storefront</span>
        <h1>One clean shop for every posted reel.</h1>
        <p>A dark, simple storefront for your men&apos;s fashion archive. Browse by category, open any reel card, and shop the matched products inside the look page.</p>
        <div class="hero-actions">
          <a class="primary-cta" href="#looks">Browse looks</a>
          <a class="nav-btn" href="/">Dashboard</a>
        </div>
        <button class="hero-search-panel" type="button" data-focus-search>
          <span>Find a look fast</span>
          <strong>Search shirts, shoes, pants, channels, Amazon, or Flipkart</strong>
          <em>Go</em>
        </button>
        <div class="quick-shelves">
          <strong>Quick shelves</strong>
          <div class="shelf-row">
            ${topShelves.length
              ? topShelves.map((shelf) => `<button class="shelf-chip" type="button" data-search-chip="${escapeHtml(shelf.label)}">${escapeHtml(shelf.label)} - ${shelf.count}</button>`).join('')
              : '<button class="shelf-chip" type="button" data-search-chip="shirt">Shirts</button><button class="shelf-chip" type="button" data-search-chip="shoes">Shoes</button><button class="shelf-chip" type="button" data-search-chip="pants">Pants</button>'}
          </div>
        </div>
        <div class="benefit-grid">
          <div class="benefit-card"><span>Matched products</span><p>Cards open into exact look pages with curated product links.</p></div>
          <div class="benefit-card"><span>Fast discovery</span><p>Search by item, color, creator, Amazon, or Flipkart instantly.</p></div>
          <div class="benefit-card"><span>No dead archive</span><p>New posted reels appear here from the same history records.</p></div>
        </div>
      </div>
      <aside class="store-console" aria-label="Store status">
        <div class="console-head">
          <span>Shop system</span>
          <strong>Live</strong>
        </div>
        <div class="store-stat-grid">
          <div class="stat-card"><span>Total looks</span><strong>${stats.looks}</strong></div>
          <div class="stat-card"><span>With products</span><strong>${stats.withProducts}</strong></div>
          <div class="stat-card"><span>Product cards</span><strong>${stats.products}</strong></div>
          <div class="stat-card"><span>Sources</span><strong>${stats.marketplaces || 0}</strong></div>
        </div>
        <div class="mission-card">
          <h2>How shoppers use it</h2>
          <div class="mission-steps">
            <div class="mission-step"><span>1</span><p>Pick a reel from the archive grid.</p></div>
            <div class="mission-step"><span>2</span><p>Open the look page with product cards inside.</p></div>
            <div class="mission-step"><span>3</span><p>Shop matching Amazon and Flipkart finds directly.</p></div>
          </div>
        </div>
        <div class="style-finder">
          <h2>Style Finder</h2>
          <p>Shortcut the archive by shopping intent.</p>
          <div class="finder-grid">
            <button class="finder-btn" type="button" data-style-filter="budget">Budget finds<span>value pieces</span></button>
            <button class="finder-btn" type="button" data-style-filter="premium">Premium picks<span>higher quality</span></button>
            <button class="finder-btn" type="button" data-style-filter="amazon">Amazon only<span>direct affiliate</span></button>
            <button class="finder-btn" type="button" data-style-filter="flipkart">Flipkart only<span>local finds</span></button>
          </div>
        </div>
        <div class="source-row">
          <span>Amazon ready</span>
          <span>Flipkart ready</span>
          <span>Mobile first</span>
          <span>No random featured product</span>
        </div>
      </aside>
    </section>

    <section class="insight-strip" aria-label="Store benefits">
      <div class="insight-card"><strong>Reel first</strong><span>Visitors browse by the content they saw, then open products inside the look.</span></div>
      <div class="insight-card"><strong>Affiliate ready</strong><span>Amazon and Flipkart cards stay attached to each shoppable reel page.</span></div>
      <div class="insight-card"><strong>Mobile friendly</strong><span>Wide on laptop, single-column and touch friendly on phones.</span></div>
    </section>

    <section class="toolbar" aria-label="Store filters">
      <input id="store-search" class="search" type="search" placeholder="Search shirts, sneakers, @channel, Amazon, Flipkart...">
      <div class="filter-row" aria-label="Quick filters">
        <button class="filter-btn active" type="button" data-filter="all">All</button>
        <button class="filter-btn" type="button" data-filter="products">Has products</button>
        <button class="filter-btn" type="button" data-filter="amazon">Amazon</button>
        <button class="filter-btn" type="button" data-filter="flipkart">Flipkart</button>
      </div>
      <select id="store-sort" class="sort-select" aria-label="Sort looks">
        <option value="newest">Newest first</option>
        <option value="products">Most products</option>
        <option value="oldest">Oldest first</option>
      </select>
    </section>

    <section id="looks">
      <div class="section-head">
        <div>
          <h2>Look archive</h2>
          <p id="result-copy">${looks.length} looks ready to browse.</p>
        </div>
        <p>Click a card to open the products inside.</p>
      </div>
      ${looks.length ? `<div id="store-grid" class="grid">${looks.map(renderCard).join('')}</div>` : '<div class="empty"><h2>No store looks yet.</h2><p>Once FirePost or the independent IG repost pipeline publishes a reel with a shortcode, it will appear here automatically.</p></div>'}
    </section>
  </main>
  <div id="toast" class="toast" role="status" aria-live="polite">Copied.</div>
  <script>
    const LOOKS = ${safeJson(looks.map((look) => ({
      shortcode: look.shortcode,
      source: look.source,
      productCount: look.productCount,
      marketplaces: look.marketplaces,
      searchText: look.searchText,
      createdAt: look.createdAt,
    })))};
    const cards = Array.from(document.querySelectorAll('[data-card]'));
    const searchInput = document.getElementById('store-search');
    const sortSelect = document.getElementById('store-sort');
    const resultCopy = document.getElementById('result-copy');
    const grid = document.getElementById('store-grid');
    const toast = document.getElementById('toast');
    let activeFilter = 'all';

    function showToast(message) {
      if (!toast) return;
      toast.textContent = message;
      toast.classList.add('visible');
      clearTimeout(showToast.timer);
      showToast.timer = setTimeout(() => toast.classList.remove('visible'), 1700);
    }

    function passesFilter(card) {
      const search = (searchInput?.value || '').trim().toLowerCase();
      const text = card.dataset.search || '';
      const products = Number(card.dataset.products || 0);
      if (search && !text.includes(search)) return false;
      if (activeFilter === 'products' && products <= 0) return false;
      if (activeFilter === 'amazon' && !text.includes('amazon')) return false;
      if (activeFilter === 'flipkart' && !text.includes('flipkart')) return false;
      return true;
    }

    function sortCards() {
      if (!grid) return;
      const sorted = cards.slice().sort((a, b) => {
        if (sortSelect.value === 'products') return Number(b.dataset.products || 0) - Number(a.dataset.products || 0);
        const aDate = Date.parse(a.dataset.date || '') || 0;
        const bDate = Date.parse(b.dataset.date || '') || 0;
        return sortSelect.value === 'oldest' ? aDate - bDate : bDate - aDate;
      });
      sorted.forEach((card) => grid.appendChild(card));
    }

    function applyFilters() {
      sortCards();
      let visible = 0;
      cards.forEach((card) => {
        const show = passesFilter(card);
        card.classList.toggle('hidden', !show);
        if (show) visible += 1;
      });
      if (resultCopy) resultCopy.textContent = visible + ' of ' + cards.length + ' looks showing.';
    }

    document.querySelectorAll('[data-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        activeFilter = button.dataset.filter || 'all';
        document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('active', item === button));
        applyFilters();
      });
    });

    document.querySelectorAll('[data-search-chip]').forEach((button) => {
      button.addEventListener('click', () => {
        if (searchInput) searchInput.value = button.dataset.searchChip || '';
        activeFilter = 'all';
        document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('active', item.dataset.filter === 'all'));
        document.getElementById('looks')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        applyFilters();
      });
    });

    document.querySelectorAll('[data-focus-search]').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelector('.toolbar')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(() => searchInput?.focus(), 320);
      });
    });

    document.querySelectorAll('[data-style-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        const intent = button.dataset.styleFilter || '';
        if (intent === 'amazon' || intent === 'flipkart') {
          activeFilter = intent;
          if (searchInput) searchInput.value = '';
          document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('active', item.dataset.filter === intent));
        } else {
          activeFilter = 'all';
          if (searchInput) searchInput.value = intent;
          document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('active', item.dataset.filter === 'all'));
        }
        document.getElementById('looks')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        applyFilters();
      });
    });

    searchInput?.addEventListener('input', applyFilters);
    sortSelect?.addEventListener('change', applyFilters);
    document.getElementById('copy-store')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        showToast('Store link copied.');
      } catch {
        showToast('Copy failed.');
      }
    });

    applyFilters();
  </script>
</body>
</html>`;
}

router.get('/data', async (req, res) => {
  try {
    const looks = await loadStoreLooks();
    return res.json({ success: true, count: looks.length, looks });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const looks = await loadStoreLooks();
    return res.send(renderStorePage(looks));
  } catch (err) {
    console.error('[Store] render failed:', err);
    return res.status(500).send('Store unavailable');
  }
});

module.exports = router;

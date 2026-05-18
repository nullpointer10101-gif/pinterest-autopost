'use strict';
const express = require('express');
const router  = express.Router();
const queueService   = require('../services/queueService');
const historyService = require('../services/historyService');
const igRepostStateService = require('../services/igRepostStateService');

// ── Upstash helpers ───────────────────────────────────────────────────────────
const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL   || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

async function upstashGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(UPSTASH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', key]),
      signal: ctrl.signal
    });
    clearTimeout(t);
    const data = await res.json();
    const raw = data?.result;
    if (!raw) return null;
    return JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
  } catch { return null; }
}

async function upstashSet(key, value, ttl = 86400) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    await fetch(UPSTASH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', key, JSON.stringify(value), 'EX', ttl]),
      signal: ctrl.signal
    });
    clearTimeout(t);
  } catch {}
}

async function loadLookData(shortcode) {
  const cleanShortcode = String(shortcode || '').trim();
  if (!cleanShortcode) return null;

  const direct = await upstashGet(`look:${cleanShortcode}`);
  if (direct) return direct;

  const isolated = await upstashGet(`iglook:${cleanShortcode}`);
  if (isolated) return isolated;

  return igRepostStateService.getLookDataByShortcode(cleanShortcode);
}

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

function normalizePrice(value) {
  if (value === null || typeof value === 'undefined') return null;
  const digits = String(value).replace(/[^\d.]/g, '');
  const parsed = Number.parseFloat(digits);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function normalizeOutfitItem(item = {}, index = 0) {
  const rawUrl = String(item.url || item.affiliateUrl || '').trim();
  let safeUrl = rawUrl;
  try {
    const parsed = new URL(rawUrl);
    safeUrl = ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch {
    safeUrl = '';
  }

  return {
    id: `piece-${index + 1}`,
    type: String(item.type || item.category || (index === 0 ? 'Main Piece' : 'Style Piece')).trim(),
    name: String(item.name || item.title || item.query || 'Featured Item').trim(),
    url: safeUrl,
    image: String(item.image || item.thumbnail || '').trim(),
    originalPrice: normalizePrice(item.originalPrice || item.price || item.salePrice),
  };
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

function toProxyImageUrl(shortcode, imageUrl) {
  const raw = String(imageUrl || '').trim();
  if (!raw) return null;
  if (raw.startsWith('/look/')) return raw;
  if (!isSafeRemoteImageUrl(raw)) return null;
  return `/look/${encodeURIComponent(shortcode)}/image-proxy?src=${encodeURIComponent(raw)}`;
}

// Same-origin product image proxy. Some commerce CDNs block direct browser embeds,
// so the storefront loads them through our route without storing files locally.
router.get('/:shortcode/image-proxy', async (req, res) => {
  const src = String(req.query.src || '').trim();
  if (!isSafeRemoteImageUrl(src)) {
    return res.status(400).send('Invalid image URL');
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const imageRes = await fetch(src, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PinterestAutopostLook/1.0)',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!imageRes.ok) {
      return res.status(502).send('Image fetch failed');
    }

    const contentType = imageRes.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return res.status(415).send('Unsupported image');
    }

    const contentLength = Number.parseInt(imageRes.headers.get('content-length') || '0', 10);
    if (Number.isFinite(contentLength) && contentLength > 8 * 1024 * 1024) {
      return res.status(413).send('Image too large');
    }

    const buffer = Buffer.from(await imageRes.arrayBuffer());
    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(413).send('Image too large');
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
    return res.send(buffer);
  } catch (err) {
    console.warn('[Look] image-proxy error:', err.message);
    return res.status(502).send('Image unavailable');
  }
});

function buildLookPage({ shortcode, title, thumbnailUrl, storedVideo, outfit, lookData }) {
  const safeTitle = escapeHtml(title);
  const safeThumb = escapeHtml(thumbnailUrl);
  const displayThumbnailUrl = toProxyImageUrl(shortcode, thumbnailUrl) || thumbnailUrl;
  const subtitle = lookData?.aiContent?.description || lookData?.description || lookData?.caption || '';
  const pieces = outfit.map(normalizeOutfitItem).filter(item => item.name || item.url);
  const pricedItems = pieces.filter(item => item.originalPrice);
  const estimate = pricedItems.reduce((sum, item) => sum + item.originalPrice, 0);
  const createdAt = lookData?.createdAt || lookData?.updatedAt || lookData?.reelData?.createdAt || null;
  const username = lookData?.reelData?.username || lookData?.username || '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle} | Shop The Look</title>
  <meta name="description" content="Shop a curated men's outfit inspired by this reel.">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="Shop this curated look with matching outfit pieces.">
  <meta property="og:image" content="${safeThumb}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --paper: #f6f1e8;
      --paper-soft: #fffaf1;
      --ink: #141414;
      --muted: #6f685f;
      --line: rgba(20, 20, 20, 0.12);
      --charcoal: #1d1d1b;
      --pine: #1f5d4b;
      --brick: #c94a32;
      --sky: #dcebf2;
      --gold: #cfa44b;
      --shadow: 0 24px 70px rgba(20, 20, 20, 0.16);
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      font-family: 'Manrope', sans-serif;
      color: var(--ink);
      background:
        linear-gradient(135deg, rgba(31, 93, 75, 0.13) 0 22%, transparent 22% 100%),
        linear-gradient(0deg, rgba(201, 74, 50, 0.09), transparent 34%),
        var(--paper);
      min-height: 100vh;
    }
    a { color: inherit; }
    button, input { font: inherit; }
    button { -webkit-tap-highlight-color: transparent; }
    .shell { width: min(1180px, calc(100% - 32px)); margin: 0 auto; }
    .scroll-progress {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 3px;
      z-index: 80;
      background: transparent;
      pointer-events: none;
    }
    .scroll-progress span {
      display: block;
      width: 0%;
      height: 100%;
      background: linear-gradient(90deg, var(--pine), var(--gold), var(--brick));
      transition: width .12s linear;
    }
    .topbar {
      position: sticky; top: 0; z-index: 30;
      border-bottom: 1px solid var(--line);
      background: rgba(246, 241, 232, 0.88);
      backdrop-filter: blur(18px);
    }
    .topbar-inner {
      min-height: 66px;
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
    }
    .brand {
      display: flex; align-items: center; gap: 10px;
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; letter-spacing: 0;
    }
    .brand-mark {
      width: 34px; height: 34px; border-radius: 8px;
      display: grid; place-items: center;
      background: var(--charcoal); color: var(--paper);
      box-shadow: 6px 6px 0 var(--gold);
    }
    .top-actions { display: flex; gap: 10px; align-items: center; }
    .icon-btn, .primary-btn, .ghost-btn {
      border: 1px solid var(--line);
      min-height: 42px;
      border-radius: 8px;
      cursor: pointer;
      transition: transform .2s ease, box-shadow .2s ease, background .2s ease;
    }
    .icon-btn {
      width: 42px;
      display: grid; place-items: center;
      background: rgba(255, 250, 241, 0.78);
      color: var(--ink);
    }
    .primary-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 9px;
      padding: 0 16px;
      background: var(--ink); color: var(--paper);
      font-weight: 800;
      text-decoration: none;
      box-shadow: 4px 4px 0 var(--brick);
    }
    .ghost-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 9px;
      padding: 0 14px;
      background: rgba(255, 250, 241, 0.75);
      color: var(--ink);
      font-weight: 800;
    }
    .icon-btn:hover, .primary-btn:hover, .ghost-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 28px rgba(20,20,20,.12);
    }
    .hero {
      display: grid;
      grid-template-columns: minmax(300px, 430px) minmax(0, 1fr);
      gap: 42px;
      padding: 42px 0 30px;
      align-items: start;
    }
    .media-card {
      position: sticky; top: 88px;
      border: 1px solid var(--line);
      background: var(--charcoal);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: var(--shadow);
    }
    .video-wrap {
      position: relative;
      width: 100%;
      aspect-ratio: 9/16;
      background: #10100f;
      overflow: hidden;
    }
    #main-video, .video-poster {
      position: absolute; inset: 0;
      width: 100%; height: 100%;
      object-fit: cover;
    }
    #main-video { opacity: 0; transition: opacity .45s ease; }
    .video-poster { transition: opacity .45s ease; }
    .video-overlay {
      position: absolute; inset: auto 0 0;
      padding: 90px 18px 18px;
      color: white;
      background: linear-gradient(to top, rgba(0,0,0,.78), transparent);
      pointer-events: none;
    }
    .video-kicker {
      display: inline-flex; align-items: center; gap: 8px;
      font-size: 12px; font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0;
    }
    .live-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #64d18a;
      box-shadow: 0 0 0 6px rgba(100, 209, 138, .15);
    }
    .video-loading {
      position: absolute; inset: 0;
      display: grid; place-items: center;
      color: white;
      background: rgba(0,0,0,.2);
    }
    .spinner {
      width: 42px; height: 42px; border-radius: 50%;
      border: 3px solid rgba(255,255,255,.25);
      border-top-color: white;
      animation: spin .8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .media-tools {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 1px;
      background: rgba(255,255,255,.14);
    }
    .media-tools button {
      border: 0;
      background: #242420;
      color: var(--paper);
      min-height: 48px;
      cursor: pointer;
      font-weight: 800;
    }
    .mobile-hero-card {
      display: none;
      margin: 0 10px 18px;
      border: 1px solid var(--line);
      background: rgba(255,250,241,.92);
      border-radius: 8px;
      padding: 14px;
      box-shadow: 0 14px 36px rgba(20,20,20,.1);
    }
    .mobile-hero-card strong {
      display: block;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 24px;
      line-height: 1;
      margin-bottom: 8px;
    }
    .mobile-hero-card span {
      color: var(--muted);
      font-size: 13px;
      font-weight: 800;
    }
    .story-panel { padding-top: 12px; }
    .eyebrow {
      display: inline-flex; align-items: center; gap: 8px;
      color: var(--brick);
      font-weight: 900;
      text-transform: uppercase;
      font-size: 12px;
    }
    .eyebrow::before {
      content: '';
      width: 28px; height: 2px;
      background: var(--brick);
    }
    h1 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: clamp(40px, 6vw, 78px);
      line-height: .94;
      letter-spacing: 0;
      margin: 18px 0 18px;
      max-width: 820px;
    }
    .lede {
      color: var(--muted);
      font-size: 18px;
      line-height: 1.65;
      max-width: 720px;
      margin: 0 0 24px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      border: 1px solid var(--line);
      background: rgba(255, 250, 241, .65);
      border-radius: 8px;
      overflow: hidden;
      margin: 26px 0;
    }
    .meta-item {
      min-height: 98px;
      padding: 16px;
      border-right: 1px solid var(--line);
    }
    .meta-item:last-child { border-right: 0; }
    .meta-label {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .meta-value {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 24px;
      font-weight: 700;
      line-height: 1;
    }
    .dynamic-panel {
      display: grid;
      grid-template-columns: 1.1fr .9fr;
      gap: 16px;
      margin: 24px 0 8px;
    }
    .fit-card, .selection-card {
      border: 1px solid var(--line);
      background: rgba(255, 250, 241, .78);
      border-radius: 8px;
      padding: 18px;
    }
    .fit-card h2, .selection-card h2, .products-head h2 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 22px;
      margin: 0 0 14px;
    }
    .fit-meter {
      height: 12px;
      border-radius: 99px;
      overflow: hidden;
      background: rgba(20,20,20,.1);
      margin: 12px 0;
    }
    .fit-meter span {
      display: block; height: 100%;
      width: var(--score, 72%);
      background: linear-gradient(90deg, var(--pine), var(--gold), var(--brick));
    }
    .fit-progress-row {
      display: grid;
      grid-template-columns: 86px minmax(0, 1fr);
      gap: 14px;
      align-items: center;
      margin-top: 16px;
    }
    .fit-ring {
      width: 82px;
      aspect-ratio: 1;
      border-radius: 999px;
      display: grid;
      place-items: center;
      background: conic-gradient(var(--pine) var(--ring, 0deg), rgba(20,20,20,.11) 0);
      position: relative;
    }
    .fit-ring::after {
      content: '';
      position: absolute;
      inset: 9px;
      border-radius: inherit;
      background: var(--paper-soft);
    }
    .fit-ring strong {
      position: relative;
      z-index: 1;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 18px;
    }
    .fit-progress-copy {
      color: var(--muted);
      font-size: 13px;
      font-weight: 750;
      line-height: 1.5;
    }
    .fit-tags {
      display: flex; flex-wrap: wrap; gap: 8px;
      margin-top: 14px;
    }
    .fit-tags span {
      border: 1px solid var(--line);
      background: var(--sky);
      border-radius: 999px;
      padding: 7px 10px;
      font-size: 12px;
      font-weight: 800;
    }
    .fit-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 14px;
    }
    .fit-actions button {
      min-height: 44px;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: var(--paper-soft);
      color: var(--ink);
      cursor: pointer;
      font-weight: 900;
    }
    .fit-actions button:first-child {
      background: var(--pine);
      border-color: var(--pine);
      color: white;
    }
    .selection-list {
      display: grid;
      gap: 8px;
      min-height: 88px;
      color: var(--muted);
      font-size: 14px;
    }
    .selection-row {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      border-bottom: 1px solid rgba(20,20,20,.08);
      padding-bottom: 8px;
      color: var(--ink);
      font-weight: 700;
    }
    .selection-total {
      display: flex; align-items: center; justify-content: space-between; gap: 14px;
      margin-top: 12px;
      font-weight: 900;
    }
    .toolbar {
      display: grid;
      grid-template-columns: minmax(180px, 1fr) auto;
      gap: 12px;
      align-items: center;
      margin: 32px 0 18px;
    }
    .search-wrap {
      position: relative;
    }
    .search-wrap svg {
      position: absolute; left: 14px; top: 50%;
      transform: translateY(-50%);
      color: var(--muted);
    }
    .search-wrap input {
      width: 100%;
      min-height: 48px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255,250,241,.82);
      color: var(--ink);
      padding: 0 14px 0 42px;
      outline: none;
      font-weight: 700;
    }
    .filter-pills {
      display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px;
      scrollbar-width: none;
    }
    .filter-pills::-webkit-scrollbar { display: none; }
    .filter-pill {
      border: 1px solid var(--line);
      background: rgba(255,250,241,.78);
      color: var(--ink);
      border-radius: 999px;
      min-height: 44px;
      padding: 0 14px;
      white-space: nowrap;
      cursor: pointer;
      font-weight: 900;
    }
    .filter-pill.active {
      background: var(--pine);
      color: white;
      border-color: var(--pine);
    }
    .products-section {
      padding: 8px 0 84px;
    }
    .products-head {
      display: flex; align-items: end; justify-content: space-between; gap: 18px;
      margin-bottom: 18px;
    }
    .products-head p {
      margin: 6px 0 0;
      color: var(--muted);
    }
    .product-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
    }
    .product-card {
      position: relative;
      border: 1px solid var(--line);
      background: rgba(255,250,241,.82);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 12px 40px rgba(20,20,20,.07);
      transition: transform .22s ease, box-shadow .22s ease;
    }
    .product-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 24px 62px rgba(20,20,20,.16);
    }
    .product-card.selected {
      outline: 3px solid rgba(31,93,75,.32);
      background: #fffdf7;
    }
    .product-card.match-highlight {
      animation: matchPulse .65s ease;
    }
    @keyframes matchPulse {
      0% { box-shadow: 0 0 0 0 rgba(201,74,50,.28); }
      100% { box-shadow: 0 0 0 18px rgba(201,74,50,0); }
    }
    .product-card.hidden { display: none; }
    .img-wrap {
      position: relative;
      aspect-ratio: 4/5;
      background:
        linear-gradient(135deg, rgba(220,235,242,.95), rgba(255,250,241,.9)),
        repeating-linear-gradient(45deg, rgba(20,20,20,.05) 0 1px, transparent 1px 10px);
      overflow: hidden;
    }
    .img-wrap img {
      width: 100%; height: 100%; object-fit: cover;
      opacity: 0; transition: opacity .35s ease, transform .5s ease;
    }
    .product-card:hover .img-wrap img { transform: scale(1.04); }
    .img-placeholder {
      position: absolute; inset: 0;
      display: grid; place-items: center;
      color: rgba(20,20,20,.38);
      font-weight: 900;
      text-transform: uppercase;
      font-size: 12px;
    }
    .type-badge {
      position: absolute; left: 12px; top: 12px;
      background: rgba(20,20,20,.82);
      color: var(--paper);
      border-radius: 999px;
      padding: 7px 10px;
      font-size: 11px;
      font-weight: 900;
      max-width: calc(100% - 64px);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .select-toggle {
      position: absolute; right: 10px; top: 10px;
      width: 36px; height: 36px;
      border: 1px solid rgba(255,255,255,.65);
      border-radius: 999px;
      background: rgba(255,250,241,.94);
      color: var(--ink);
      display: grid; place-items: center;
      cursor: pointer;
    }
    .product-card.selected .select-toggle {
      background: var(--pine);
      color: white;
    }
    .product-body {
      padding: 16px;
      display: grid;
      gap: 12px;
    }
    .product-name {
      margin: 0;
      font-weight: 850;
      line-height: 1.35;
      min-height: 45px;
    }
    .price-row {
      display: flex; justify-content: space-between; align-items: center; gap: 10px;
      color: var(--muted);
      font-size: 14px;
      font-weight: 800;
    }
    .price-row strong {
      color: var(--ink);
      font-size: 18px;
      font-family: 'Space Grotesk', sans-serif;
    }
    .card-actions {
      display: grid;
      grid-template-columns: 1fr 44px;
      gap: 8px;
    }
    .shop-link {
      min-height: 44px;
      border-radius: 8px;
      background: var(--ink);
      color: var(--paper);
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      text-decoration: none;
      font-weight: 900;
      box-shadow: 4px 4px 0 var(--gold);
    }
    .copy-product {
      min-height: 44px;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: transparent;
      cursor: pointer;
      display: grid; place-items: center;
    }
    .empty-state {
      grid-column: 1/-1;
      min-height: 260px;
      border: 1px dashed rgba(20,20,20,.24);
      border-radius: 8px;
      display: grid;
      place-items: center;
      text-align: center;
      color: var(--muted);
      padding: 28px;
      background: rgba(255,250,241,.62);
    }
    .sticky-bag {
      position: fixed;
      left: 50%;
      bottom: 18px;
      transform: translateX(-50%);
      width: min(680px, calc(100% - 24px));
      z-index: 35;
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 10px;
      background: rgba(20,20,20,.94);
      color: var(--paper);
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,.35);
    }
    .sticky-bag.visible { display: flex; }
    .sticky-bag strong { display: block; }
    .sticky-bag span { color: rgba(246,241,232,.72); font-size: 13px; }
    .mobile-dock {
      display: none;
      position: fixed;
      left: 10px;
      right: 10px;
      bottom: calc(10px + env(safe-area-inset-bottom, 0px));
      z-index: 36;
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 12px;
      background: rgba(20,20,20,.95);
      color: var(--paper);
      padding: 8px;
      box-shadow: 0 18px 50px rgba(0,0,0,.34);
      grid-template-columns: 1fr 1fr 1.1fr;
      gap: 8px;
    }
    .mobile-dock button,
    .mobile-dock a {
      min-height: 48px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,.14);
      background: rgba(255,255,255,.08);
      color: var(--paper);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      text-decoration: none;
      font-weight: 900;
      font-size: 13px;
    }
    .mobile-dock .mobile-dock-primary {
      background: var(--paper);
      color: var(--ink);
    }
    .toast {
      position: fixed;
      top: 82px;
      right: 18px;
      z-index: 60;
      background: var(--ink);
      color: var(--paper);
      border-radius: 8px;
      padding: 12px 14px;
      font-weight: 800;
      opacity: 0;
      transform: translateY(-10px);
      pointer-events: none;
      transition: opacity .2s ease, transform .2s ease;
    }
    .toast.visible {
      opacity: 1;
      transform: translateY(0);
    }
    @media (max-width: 980px) {
      .hero { grid-template-columns: 1fr; gap: 28px; }
      .media-card {
        position: relative; top: 0;
        width: min(420px, 100%);
        margin: 0 auto;
      }
      .dynamic-panel { grid-template-columns: 1fr; }
      .product-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 640px) {
      body {
        background:
          linear-gradient(160deg, rgba(31,93,75,.2) 0 18%, transparent 18%),
          linear-gradient(0deg, rgba(207,164,75,.14), transparent 32%),
          var(--paper);
        padding-bottom: 86px;
      }
      .shell { width: 100%; padding: 0 10px; }
      .topbar {
        border-bottom-color: rgba(20,20,20,.08);
      }
      .topbar-inner { min-height: 58px; }
      .brand span { display: none; }
      .top-actions .ghost-btn { display: none; }
      .top-actions .primary-btn {
        min-height: 40px;
        padding: 0 13px;
        box-shadow: 3px 3px 0 var(--brick);
      }
      .hero {
        display: flex;
        flex-direction: column;
        gap: 0;
        padding: 10px 0 18px;
      }
      .media-card {
        width: calc(100% + 20px);
        margin: 0 -10px;
        border-radius: 0 0 18px 18px;
        border-left: 0;
        border-right: 0;
        box-shadow: 0 18px 50px rgba(20,20,20,.24);
      }
      .video-wrap {
        height: min(68vh, 620px);
        aspect-ratio: auto;
      }
      .video-overlay {
        padding: 120px 14px 14px;
      }
      .media-tools {
        position: absolute;
        right: 10px;
        bottom: 10px;
        width: auto;
        grid-template-columns: repeat(2, 76px);
        border-radius: 999px;
        overflow: hidden;
        z-index: 5;
        background: rgba(255,255,255,.2);
      }
      .media-tools button {
        min-height: 42px;
        background: rgba(20,20,20,.78);
        backdrop-filter: blur(12px);
        font-size: 12px;
      }
      .mobile-hero-card {
        display: block;
        transform: translateY(-14px);
        margin-bottom: 0;
      }
      .story-panel {
        padding: 0 4px;
      }
      .story-panel > .eyebrow,
      .story-panel > h1,
      .story-panel > .lede {
        display: none;
      }
      h1 { font-size: 40px; }
      .lede { font-size: 15px; }
      .meta-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        margin: 0 0 12px;
      }
      .meta-item {
        min-height: 76px;
        padding: 12px 10px;
        border-bottom: 0;
      }
      .meta-label { font-size: 10px; }
      .meta-value { font-size: 18px; }
      .dynamic-panel {
        grid-template-columns: 1fr;
        gap: 10px;
        margin: 12px 0;
      }
      .fit-card, .selection-card {
        padding: 14px;
      }
      .fit-actions button {
        min-height: 48px;
      }
      .fit-card h2, .selection-card h2, .products-head h2 {
        font-size: 20px;
      }
      .fit-progress-row {
        grid-template-columns: 68px minmax(0,1fr);
      }
      .fit-ring {
        width: 66px;
      }
      .selection-list {
        max-height: 132px;
        overflow: auto;
      }
      .toolbar {
        position: sticky;
        top: 58px;
        z-index: 25;
        grid-template-columns: 1fr;
        gap: 9px;
        margin: 0 -10px 14px;
        padding: 10px;
        background: rgba(246,241,232,.94);
        border-top: 1px solid rgba(20,20,20,.06);
        border-bottom: 1px solid rgba(20,20,20,.08);
        backdrop-filter: blur(16px);
      }
      .search-wrap input {
        min-height: 52px;
        border-radius: 10px;
        background: var(--paper-soft);
      }
      .filter-pill {
        min-height: 42px;
        padding: 0 13px;
      }
      .products-head { align-items: start; flex-direction: column; }
      .products-head .ghost-btn { display: none; }
      .products-section {
        padding: 10px 0 112px;
      }
      .product-grid {
        grid-template-columns: 1fr;
        gap: 12px;
      }
      .product-card {
        display: grid;
        grid-template-columns: minmax(118px, 38%) minmax(0, 1fr);
        min-height: 178px;
      }
      .img-wrap {
        aspect-ratio: auto;
        height: 100%;
        min-height: 178px;
      }
      .product-body {
        padding: 13px;
        align-content: space-between;
        gap: 10px;
      }
      .product-name {
        min-height: auto;
        font-size: 14px;
      }
      .price-row {
        align-items: flex-start;
        flex-direction: column;
        gap: 4px;
      }
      .card-actions {
        grid-template-columns: 1fr 42px;
      }
      .shop-link, .copy-product {
        min-height: 46px;
      }
      .type-badge {
        max-width: calc(100% - 18px);
        right: 9px;
        left: 9px;
        text-align: center;
      }
      .select-toggle {
        width: 42px;
        height: 42px;
        right: 8px;
        bottom: 8px;
        top: auto;
      }
      .sticky-bag {
        display: none !important;
      }
      .mobile-dock {
        display: grid;
      }
      .toast {
        top: 68px;
        left: 10px;
        right: 10px;
        text-align: center;
      }
    }
  </style>
</head>
<body>
  <div class="scroll-progress" aria-hidden="true"><span id="scroll-progress-bar"></span></div>
  <div class="topbar">
    <div class="shell topbar-inner">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
        </div>
        <span>Shop The Look</span>
      </div>
      <div class="top-actions">
        <button class="icon-btn" id="share-btn" type="button" title="Share this look" aria-label="Share this look">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/></svg>
        </button>
        <a class="primary-btn" href="#products">
          Shop Now
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        </a>
      </div>
    </div>
  </div>

  <main class="shell">
    <section class="hero">
      <aside class="media-card">
        <div class="video-wrap" id="video-wrap">
          ${displayThumbnailUrl ? `<img class="video-poster" id="video-poster" src="${escapeHtml(displayThumbnailUrl)}" alt="${safeTitle}">` : ''}
          <div class="video-loading" id="video-loading"><div class="spinner"></div></div>
          <video id="main-video" controls muted playsinline preload="auto"></video>
          <div class="video-overlay">
            <div class="video-kicker"><span class="live-dot"></span> Reel sourced look</div>
          </div>
        </div>
        <div class="media-tools">
          <button id="replay-btn" type="button">Replay</button>
          <button id="mute-btn" type="button">Sound</button>
        </div>
      </aside>

      <section class="story-panel">
        <div class="mobile-hero-card">
          <strong>${safeTitle}</strong>
          <span>${pieces.length || 0} pieces ready to shop${estimate ? ` - Rs ${estimate.toLocaleString('en-IN')} estimated` : ''}</span>
        </div>
        <div class="eyebrow">${username ? `From @${escapeHtml(username)}` : 'Curated outfit edit'}</div>
        <h1>${safeTitle}</h1>
        <p class="lede">${escapeHtml(String(subtitle || 'A clean outfit board built from the reel, with shoppable pieces pulled together in one place.').replace(/\s+/g, ' ').slice(0, 220))}</p>

        <div class="meta-grid">
          <div class="meta-item">
            <span class="meta-label">Pieces</span>
            <strong class="meta-value">${pieces.length || 0}</strong>
          </div>
          <div class="meta-item">
            <span class="meta-label">Estimate</span>
            <strong class="meta-value">${estimate ? `Rs ${estimate.toLocaleString('en-IN')}` : 'Live'}</strong>
          </div>
          <div class="meta-item">
            <span class="meta-label">Updated</span>
            <strong class="meta-value">${createdAt ? escapeHtml(new Date(createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })) : 'Now'}</strong>
          </div>
        </div>

        <div class="dynamic-panel">
          <div class="fit-card">
            <h2>Fit Builder</h2>
            <p class="lede" style="font-size:14px;margin:0;color:var(--muted)">Select pieces to build your version of the outfit. Your picks stay on this device for this look.</p>
            <div class="fit-meter" style="--score:${Math.min(96, Math.max(42, pieces.length * 22))}%"><span></span></div>
            <div class="fit-progress-row">
              <div class="fit-ring" id="fit-ring" style="--ring:0deg"><strong id="fit-percent">0%</strong></div>
              <div class="fit-progress-copy" id="fit-progress-copy">Pick the pieces you want and the outfit builder will track your set.</div>
            </div>
            <div class="fit-tags" id="fit-tags"></div>
            <div class="fit-actions">
              <button id="select-full-look" type="button">Select Full Look</button>
              <button id="clear-selection" type="button">Clear</button>
            </div>
          </div>
          <div class="selection-card">
            <h2>Your Picks</h2>
            <div class="selection-list" id="selection-list">No pieces selected yet.</div>
            <div class="selection-total">
              <span>Total</span>
              <strong id="selection-total">Rs 0</strong>
            </div>
          </div>
        </div>
      </section>
    </section>

    <section class="products-section" id="products">
      <div class="products-head">
        <div>
          <h2>Shop The Pieces</h2>
          <p id="results-copy">${pieces.length} curated pieces ready to browse.</p>
        </div>
        <button class="ghost-btn" id="open-selected-top" type="button">Open Selected</button>
      </div>

      <div class="toolbar">
        <label class="search-wrap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>
          <input id="product-search" type="search" placeholder="Search jacket, shoes, watch..." autocomplete="off">
        </label>
        <div class="filter-pills" id="filter-pills"></div>
      </div>

      <div class="product-grid" id="product-grid"></div>
    </section>
  </main>

  <div class="sticky-bag" id="sticky-bag">
    <div>
      <strong id="bag-title">0 pieces selected</strong>
      <span id="bag-subtitle">Build your outfit, then open selected links together.</span>
    </div>
    <button class="primary-btn" id="open-selected" type="button">Open</button>
  </div>
  <div class="mobile-dock" id="mobile-dock">
    <a href="#products">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/></svg>
      Pieces
    </a>
    <button id="mobile-share-btn" type="button">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/></svg>
      Share
    </button>
    <button class="mobile-dock-primary" id="mobile-open-selected" type="button">
      <span id="mobile-selected-count">0</span>
      Selected
    </button>
  </div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>

  <script>
  (function() {
    const SHORTCODE = ${safeJson(shortcode)};
    const STORED_VIDEO = ${safeJson(storedVideo)};
    const THUMBNAIL_URL = ${safeJson(thumbnailUrl)};
    const outfit = ${safeJson(pieces)};
    const storageKey = 'look-picks:' + SHORTCODE;

    const grid = document.getElementById('product-grid');
    const video = document.getElementById('main-video');
    const poster = document.getElementById('video-poster');
    const loading = document.getElementById('video-loading');
    const fitTags = document.getElementById('fit-tags');
    const selectionList = document.getElementById('selection-list');
    const selectionTotal = document.getElementById('selection-total');
    const stickyBag = document.getElementById('sticky-bag');
    const bagTitle = document.getElementById('bag-title');
    const bagSubtitle = document.getElementById('bag-subtitle');
    const searchInput = document.getElementById('product-search');
    const filterPills = document.getElementById('filter-pills');
    const resultsCopy = document.getElementById('results-copy');
    const toast = document.getElementById('toast');
    const fitRing = document.getElementById('fit-ring');
    const fitPercent = document.getElementById('fit-percent');
    const fitProgressCopy = document.getElementById('fit-progress-copy');
    const mobileSelectedCount = document.getElementById('mobile-selected-count');
    const scrollProgressBar = document.getElementById('scroll-progress-bar');
    let activeFilter = 'all';
    let selected = new Set(readPicks());

    function money(value) {
      return value ? 'Rs ' + Number(value).toLocaleString('en-IN') : 'View price';
    }

    function escapeText(value) {
      return String(value || '').replace(/[&<>"']/g, function(ch) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
      });
    }

    function readPicks() {
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
        return Array.isArray(saved) ? saved : [];
      } catch {
        return [];
      }
    }

    function savePicks() {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(selected)));
    }

    function showToast(message) {
      toast.textContent = message;
      toast.classList.add('visible');
      clearTimeout(showToast.timer);
      showToast.timer = setTimeout(() => toast.classList.remove('visible'), 1800);
    }

    function itemTypes() {
      const seen = new Set();
      const types = ['all'];
      outfit.forEach(item => {
        const type = (item.type || 'piece').toLowerCase();
        if (!seen.has(type)) {
          seen.add(type);
          types.push(type);
        }
      });
      return types;
    }

    function renderFilters() {
      filterPills.innerHTML = itemTypes().map(type => {
        const label = type === 'all' ? 'All pieces' : type.replace(/\\b\\w/g, c => c.toUpperCase());
        return '<button class="filter-pill ' + (activeFilter === type ? 'active' : '') + '" data-filter="' + escapeText(type) + '" type="button">' + escapeText(label) + '</button>';
      }).join('');
    }

    function renderTags() {
      const tags = itemTypes().filter(type => type !== 'all').slice(0, 5);
      fitTags.innerHTML = tags.length
        ? tags.map(type => '<span>' + escapeText(type.replace(/\\b\\w/g, c => c.toUpperCase())) + '</span>').join('')
        : '<span>Mens style</span><span>Easy outfit</span>';
    }

    function productImageMarkup(item, index) {
      const label = escapeText((item.type || 'Item').split(' ')[0]);
      return [
        '<div class="img-wrap">',
        '<div class="img-placeholder" id="placeholder-' + index + '">' + label + '</div>',
        '<img id="img-' + index + '" alt="' + escapeText(item.name) + '">',
        '<span class="type-badge">' + escapeText(item.type) + '</span>',
        '<button class="select-toggle" type="button" data-select="' + escapeText(item.id) + '" aria-label="Select piece">',
        selected.has(item.id) ? checkIcon() : plusIcon(),
        '</button>',
        '</div>'
      ].join('');
    }

    function checkIcon() {
      return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    }

    function plusIcon() {
      return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
    }

    function renderProducts() {
      if (!outfit.length) {
        grid.innerHTML = '<div class="empty-state"><div><h2>Products Coming Soon</h2><p>We are still curating shoppable links for this look.</p></div></div>';
        resultsCopy.textContent = 'No product links are ready yet.';
        return;
      }

      grid.innerHTML = outfit.map((item, index) => {
        const url = item.url || '#';
        return [
          '<article class="product-card ' + (selected.has(item.id) ? 'selected' : '') + '" data-id="' + escapeText(item.id) + '" data-type="' + escapeText((item.type || '').toLowerCase()) + '" data-name="' + escapeText((item.name || '').toLowerCase()) + '">',
          productImageMarkup(item, index),
          '<div class="product-body">',
          '<p class="product-name">' + escapeText(item.name) + '</p>',
          '<div class="price-row"><span>' + escapeText(item.type || 'Piece') + '</span><strong>' + money(item.originalPrice) + '</strong></div>',
          '<div class="card-actions">',
          '<a class="shop-link" href="' + escapeText(url) + '" target="_blank" rel="noopener noreferrer">Shop item <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg></a>',
          '<button class="copy-product" type="button" data-copy="' + escapeText(url) + '" aria-label="Copy product link"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>',
          '</div>',
          '</div>',
          '</article>'
        ].join('');
      }).join('');

      hydrateImages();
      filterProducts();
    }

    function hydrateImages() {
      outfit.forEach((item, index) => {
        const imgEl = document.getElementById('img-' + index);
        const placeholder = document.getElementById('placeholder-' + index);
        if (!imgEl) return;

        function reveal(src) {
          if (!src) return;
          imgEl.onload = () => {
            imgEl.style.opacity = '1';
            if (placeholder) placeholder.style.display = 'none';
          };
          imgEl.onerror = () => {
            imgEl.style.opacity = '0';
            if (placeholder) placeholder.style.display = 'grid';
          };
          imgEl.src = src;
        }

        if (item.image) {
          reveal(item.image);
          return;
        }

        const encodedName = encodeURIComponent(item.name || '');
        const encodedUrl = encodeURIComponent(item.url || '');
        fetch('/look/' + SHORTCODE + '/product-image?name=' + encodedName + '&url=' + encodedUrl)
          .then(r => r.json())
          .then(data => reveal(data.image || ''))
          .catch(() => {});
      });
    }

    function filterProducts() {
      const query = (searchInput.value || '').trim().toLowerCase();
      let visible = 0;
      document.querySelectorAll('.product-card').forEach(card => {
        const typeMatch = activeFilter === 'all' || card.dataset.type === activeFilter;
        const textMatch = !query || card.dataset.name.includes(query) || card.dataset.type.includes(query);
        const show = typeMatch && textMatch;
        card.classList.toggle('hidden', !show);
        card.classList.toggle('match-highlight', show && !!query);
        if (show) visible += 1;
      });
      resultsCopy.textContent = visible + ' of ' + outfit.length + ' pieces showing.';
    }

    function selectedItems() {
      return outfit.filter(item => selected.has(item.id));
    }

    function renderSelection() {
      const items = selectedItems();
      const total = items.reduce((sum, item) => sum + (item.originalPrice || 0), 0);

      selectionList.innerHTML = items.length
        ? items.map(item => '<div class="selection-row"><span>' + escapeText(item.name) + '</span><strong>' + money(item.originalPrice) + '</strong></div>').join('')
        : 'No pieces selected yet.';

      selectionTotal.textContent = total ? money(total) : 'Rs 0';
      bagTitle.textContent = items.length + (items.length === 1 ? ' piece selected' : ' pieces selected');
      bagSubtitle.textContent = total ? money(total) + ' estimated total' : 'Select pieces to build your outfit.';
      stickyBag.classList.toggle('visible', items.length > 0);
      mobileSelectedCount.textContent = String(items.length);

      const percent = outfit.length ? Math.round((items.length / outfit.length) * 100) : 0;
      fitRing.style.setProperty('--ring', (percent * 3.6) + 'deg');
      fitPercent.textContent = percent + '%';
      fitProgressCopy.textContent = items.length
        ? items.length + ' of ' + outfit.length + ' pieces selected. Add more pieces to complete the look.'
        : 'Pick the pieces you want and the outfit builder will track your set.';

      document.querySelectorAll('.product-card').forEach(card => {
        const isSelected = selected.has(card.dataset.id);
        card.classList.toggle('selected', isSelected);
        const btn = card.querySelector('.select-toggle');
        if (btn) btn.innerHTML = isSelected ? checkIcon() : plusIcon();
      });
    }

    function openSelected() {
      const items = selectedItems().filter(item => item.url);
      if (!items.length) {
        showToast('Select at least one piece first.');
        return;
      }
      items.slice(0, 5).forEach(item => window.open(item.url, '_blank', 'noopener,noreferrer'));
    }

    function selectFullLook() {
      outfit.forEach(item => selected.add(item.id));
      savePicks();
      renderSelection();
      showToast('Full look selected.');
    }

    function clearSelection() {
      selected.clear();
      savePicks();
      renderSelection();
      showToast('Selection cleared.');
    }

    function updateScrollProgress() {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const progress = Math.min(100, Math.max(0, (window.scrollY / max) * 100));
      scrollProgressBar.style.width = progress + '%';
    }

    async function sharePage() {
      const shareData = { title: document.title, url: window.location.href };
      try {
        if (navigator.share) await navigator.share(shareData);
        else {
          await navigator.clipboard.writeText(window.location.href);
          showToast('Page link copied.');
        }
      } catch {}
    }

    function tryPlayVideo(src) {
      if (!src) return false;
      video.src = src;
      video.load();
      video.addEventListener('canplay', () => {
        video.style.opacity = '1';
        if (poster) poster.style.opacity = '0';
        loading.style.display = 'none';
      }, { once: true });
      video.addEventListener('error', () => {
        loading.style.display = 'none';
        video.style.opacity = '0';
        if (poster) poster.style.opacity = '1';
      }, { once: true });
      return true;
    }

    async function initVideo() {
      if (STORED_VIDEO && !STORED_VIDEO.includes('cdninstagram') && !/\\.jpe?g(\\?|$)/i.test(STORED_VIDEO)) {
        tryPlayVideo(STORED_VIDEO);
        return;
      }
      try {
        const r = await fetch('/look/' + SHORTCODE + '/fresh-video');
        const data = await r.json();
        if (data.videoUrl) {
          tryPlayVideo(data.videoUrl);
          return;
        }
      } catch {}
      if (STORED_VIDEO && !/\\.jpe?g(\\?|$)/i.test(STORED_VIDEO)) {
        tryPlayVideo(STORED_VIDEO);
        return;
      }
      loading.style.display = 'none';
      if (poster) poster.style.opacity = '1';
    }

    document.addEventListener('click', event => {
      const selectButton = event.target.closest('[data-select]');
      if (selectButton) {
        const id = selectButton.dataset.select;
        selected.has(id) ? selected.delete(id) : selected.add(id);
        savePicks();
        renderSelection();
        return;
      }

      const copyButton = event.target.closest('[data-copy]');
      if (copyButton) {
        navigator.clipboard?.writeText(copyButton.dataset.copy || window.location.href);
        showToast('Link copied.');
        return;
      }

      const filterButton = event.target.closest('[data-filter]');
      if (filterButton) {
        activeFilter = filterButton.dataset.filter;
        renderFilters();
        filterProducts();
      }
    });

    searchInput.addEventListener('input', filterProducts);
    document.getElementById('open-selected').addEventListener('click', openSelected);
    document.getElementById('open-selected-top').addEventListener('click', openSelected);
    document.getElementById('mobile-open-selected').addEventListener('click', openSelected);
    document.getElementById('select-full-look').addEventListener('click', selectFullLook);
    document.getElementById('clear-selection').addEventListener('click', clearSelection);
    document.getElementById('replay-btn').addEventListener('click', () => {
      video.currentTime = 0;
      video.play().catch(() => {});
    });
    document.getElementById('mute-btn').addEventListener('click', event => {
      video.muted = !video.muted;
      event.currentTarget.textContent = video.muted ? 'Sound' : 'Mute';
    });
    document.getElementById('share-btn').addEventListener('click', sharePage);
    document.getElementById('mobile-share-btn').addEventListener('click', sharePage);
    window.addEventListener('scroll', updateScrollProgress, { passive: true });
    window.addEventListener('resize', updateScrollProgress);

    renderTags();
    renderFilters();
    renderProducts();
    renderSelection();
    updateScrollProgress();
    initVideo();
  })();
  </script>
</body>
</html>`;
}

// ── Product Image via Serper Image Search ────────────────────────────────────
// Searches for product image using product name via Serper.dev images API
router.get('/:shortcode/product-image', async (req, res) => {
  const { url, name } = req.query;
  if (!url && !name) return res.json({ image: null });

  const cacheKey = `img2:${Buffer.from(url || name).toString('base64').slice(0, 40)}`;
  const cached = await upstashGet(cacheKey);
  if (cached) return res.json({ image: toProxyImageUrl(req.params.shortcode, cached) || cached });

  const SERPER_KEY = process.env.SERPER_API_KEY || '';
  if (!SERPER_KEY) return res.json({ image: null });

  try {
    // Use Serper.dev images API to get real product photo
    const query = name || url;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query + ' flipkart product', gl: 'in', hl: 'en', num: 5 }),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (r.ok) {
      const data = await r.json();
      const images = data?.images || [];
      // Pick first image from Flipkart or any valid product image
      let imageUrl = null;
      for (const img of images) {
        const src = img.imageUrl || img.thumbnailUrl;
        if (src && (src.includes('rukminim') || src.includes('flipkart') || src.includes('fkimg'))) {
          imageUrl = src;
          break;
        }
      }
      // Fallback: just use first image result
      if (!imageUrl && images[0]) imageUrl = images[0].imageUrl || images[0].thumbnailUrl || null;
      if (imageUrl) {
        await upstashSet(cacheKey, imageUrl, 60 * 60 * 24 * 7);
        return res.json({ image: toProxyImageUrl(req.params.shortcode, imageUrl) || imageUrl });
      }
    }
    return res.json({ image: null });
  } catch (err) {
    console.warn('[Look] product-image serper error:', err.message);
    return res.json({ image: null });
  }
});

// ── Fresh Video URL ────────────────────────────────────────────────────────────
// Fetches fresh Instagram video URL using instagram-url-direct package
router.get('/:shortcode/fresh-video', async (req, res) => {
  const { shortcode } = req.params;
  const cacheKey = `freshvid2:${shortcode}`;
  const cached = await upstashGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const { instagramGetUrl } = require('instagram-url-direct');
    const result = await instagramGetUrl(`https://www.instagram.com/reel/${shortcode}/`);
    const videoUrl = result?.url_list?.[0] || null;
    const thumbnail = result?.media_details?.[0]?.thumbnail || null;
    if (videoUrl) {
      const data = { videoUrl, thumbnailUrl: thumbnail };
      // Cache for 3 hours — Instagram CDN URLs typically live 4-6h
      await upstashSet(cacheKey, data, 60 * 60 * 3);
      return res.json(data);
    }
  } catch (err) {
    console.warn('[Look] fresh-video error:', err.message);
  }

  return res.json({ videoUrl: null, thumbnailUrl: null });
});

// ── Products API ──────────────────────────────────────────────────────────────
router.get('/:shortcode/products', async (req, res) => {
  const { shortcode } = req.params;
  try {
    const lookData = await loadLookData(shortcode);
    let outfit = [];
    if (lookData?.productInfo?.outfit?.length > 0) {
      outfit = lookData.productInfo.outfit;
    } else if (lookData?.productInfo?.affiliateUrl) {
      outfit = [{ type: 'Main Piece', name: lookData.productInfo.name || 'Featured Item', url: lookData.productInfo.affiliateUrl, image: null }];
    }
    return res.json({ found: !!lookData, outfit });
  } catch (err) {
    return res.status(500).json({ found: false, outfit: [], error: err.message });
  }
});

// ── Main Storefront Page ──────────────────────────────────────────────────────
router.get('/:shortcode', async (req, res) => {
  try {
    const { shortcode } = req.params;

    // Fast path: individual Upstash key
    let lookData = await loadLookData(shortcode);
    if (lookData) {
      console.log(`[Look] ⚡ Fast path hit for ${shortcode}`);
    } else {
      console.log(`[Look] 🐢 No index key — falling back to full state for ${shortcode}`);
      const [queue, history] = await Promise.all([queueService.getQueue(), historyService.getAll()]);
      let found = queue.find(i => i.shortcode === shortcode) || null;
      const historyData = history.find(i =>
        i.shortcode === shortcode ||
        i.reelData?.shortcode === shortcode ||
        (i.url || '').includes(shortcode)
      );
      if (historyData) {
        if (!found) found = historyData;
        else if (!found.productInfo && historyData.productInfo) found.productInfo = historyData.productInfo;
      }
      lookData = found;
    }

    if (!lookData) {
      return res.status(404).send(`<!DOCTYPE html><html><body style="background:#09090b;color:white;font-family:sans-serif;text-align:center;padding:80px 20px">
        <div style="font-size:3rem;margin-bottom:20px">🔍</div>
        <h2 style="font-size:1.5rem;margin-bottom:12px">Look Not Found</h2>
        <p style="color:#a1a1aa">This link may have expired or does not exist.</p>
      </body></html>`);
    }

    const title        = lookData.aiContent?.title || lookData.productInfo?.name || lookData.title || 'Shop The Look';
    const thumbnailUrl = lookData.thumbnailUrl || lookData.reelData?.thumbnailUrl || '';
    const storedVideo  = lookData.mediaUrl || lookData.reelData?.mediaUrl || '';

    let outfit = [];
    if (lookData.productInfo?.outfit?.length > 0) {
      outfit = lookData.productInfo.outfit;
    } else if (lookData.productInfo?.affiliateUrl || lookData.affiliateLink) {
      outfit = [{
        type: 'Main Piece',
        name: lookData.productInfo?.name || lookData.aiContent?.title || 'Featured Item',
        url: lookData.productInfo?.affiliateUrl || lookData.affiliateLink,
        image: null,
        originalPrice: null
      }];
    }

    return res.send(buildLookPage({
      shortcode,
      title,
      thumbnailUrl,
      storedVideo,
      outfit,
      lookData,
    }));
  } catch (err) {
    console.error('[Look Route] Error:', err);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const axios = require('axios');
const pinterestStateService = require('../services/pinterestStateService');
const pinterestImageStateService = require('../services/pinterestImageStateService');
const leadStorageService = require('../services/leadStorageService');

const PINTEREST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};
const livePinCache = new Map();

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function cleanText(value, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMetaContent(html, keys = []) {
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const isMatch = keys.some((key) => {
      const escaped = escapeRegex(key);
      return new RegExp(`(?:property|name)=["']${escaped}["']`, 'i').test(tag);
    });
    if (!isMatch) continue;

    const content = tag.match(/\bcontent=["']([^"']*)["']/i);
    if (content?.[1]) return cleanText(decodeHtml(content[1]));
  }

  return '';
}

function extractTitleTag(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? cleanText(decodeHtml(match[1])) : '';
}

function canonicalImageKey(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\.(jpe?g|png|webp|gif)$/i, '');
  } catch {
    return String(url || '').trim().replace(/\?.*$/, '').replace(/\.(jpe?g|png|webp|gif)$/i, '');
  }
}

function getPinImages(pin = {}) {
  const urls = [
    pin.mediaUrl,
    pin.thumbnailUrl,
    ...(Array.isArray(pin.imageUrls) ? pin.imageUrls : []),
  ].filter(Boolean);
  const unique = new Map();

  for (const url of urls) {
    const cleanUrl = String(url || '').trim();
    const key = canonicalImageKey(cleanUrl);
    if (cleanUrl && key && !unique.has(key)) unique.set(key, cleanUrl);
  }

  return Array.from(unique.values());
}

function getDisplayTitle(value) {
  const title = cleanText(value, 'Shop this look');
  const withoutPrefix = title.replace(/^Pin on\s+/i, '');
  return withoutPrefix
    .split('|')[0]
    .replace(/\s+\d{4}$/, '')
    .trim()
    .slice(0, 86);
}

async function fetchLivePinterestPin(pinId) {
  const cleanPinId = String(pinId || '').trim();
  if (!/^\d{6,}$/.test(cleanPinId)) return null;
  if (livePinCache.has(cleanPinId)) return livePinCache.get(cleanPinId);

  try {
    const response = await axios.get(`https://www.pinterest.com/pin/${encodeURIComponent(cleanPinId)}/`, {
      headers: PINTEREST_HEADERS,
      timeout: 12000,
      maxRedirects: 5,
    });
    const html = String(response.data || '');
    const imageUrl = extractMetaContent(html, ['og:image', 'twitter:image:src', 'twitter:image']);
    const title = extractMetaContent(html, ['og:title', 'twitter:title']) || extractTitleTag(html);
    const description = extractMetaContent(html, ['og:description', 'description', 'twitter:description']);

    if (!imageUrl && !title && !description) return null;

    const recoveredPin = {
      pinId: cleanPinId,
      title: title || 'Shop this look',
      description: description || 'Leave your email and we will send the product link shortly.',
      mediaUrl: imageUrl || '',
      thumbnailUrl: imageUrl || '',
      imageUrls: imageUrl ? [imageUrl] : [],
      originalLink: '',
      targetUrl: '',
      sourceUrl: '',
      boardName: '',
      sourceAccount: '',
      recoveredFromPinterest: true,
    };
    livePinCache.set(cleanPinId, recoveredPin);
    return recoveredPin;
  } catch (err) {
    console.warn(`[Bridge] Live Pinterest recovery failed for ${cleanPinId}: ${err.message}`);
    livePinCache.set(cleanPinId, null);
    return null;
  }
}

async function getBridgePin(pinId) {
  const directPin = await pinterestImageStateService.getPinById(pinId)
    || await pinterestStateService.getPinById(pinId);
  if (directPin) return { pin: directPin, recovered: false };

  const posted = typeof pinterestImageStateService.getPostedByPinId === 'function'
    ? await pinterestImageStateService.getPostedByPinId(pinId)
    : null;
  const livePin = await fetchLivePinterestPin(pinId);
  if (posted) {
    return {
      recovered: true,
      pin: {
        ...(livePin || {}),
        pinId,
        title: posted.title || livePin?.title || 'Shop this look',
        description: livePin?.description || 'Leave your email and we will send the product link shortly.',
        sourceAccount: posted.sourceAccount || '',
        boardName: posted.sourceBoardName || livePin?.boardName || '',
        targetUrl: posted.targetUrl || '',
        originalLink: posted.originalLink || '',
        sourceUrl: posted.sourceUrl || '',
      },
    };
  }

  if (livePin) return { pin: livePin, recovered: true };

  return {
    recovered: true,
    pin: {
      pinId,
      title: 'Shop this look',
      description: 'Leave your email and we will send the product link shortly.',
      boardName: 'Saved find',
      sourceAccount: '',
    },
  };
}

function resolveTargetUrl(pin = {}) {
  const targetUrl = pin.originalLink || pin.targetUrl || pin.sourceUrl || '';
  if (!targetUrl || String(targetUrl).includes('/bridge/')) return '';
  return targetUrl;
}

// Serve the bridge landing page
router.get('/:pinId', async (req, res) => {
  const { pinId } = req.params;
  const { pin, recovered } = await getBridgePin(pinId);

  const imageUrls = getPinImages(pin);
  const hasMultipleImages = imageUrls.length > 1;
  const title = getDisplayTitle(pin.title);
  const description = cleanText(pin.description || pin.caption, recovered
    ? 'Leave your email and we will send the product link shortly.'
    : 'Get the direct link for this Pinterest find.');
  const shortDescription = description.length > 112 ? `${description.slice(0, 109).trim()}...` : description;
  const brandName = cleanText(process.env.BRIDGE_BRAND_NAME, 'Aura Closet');
  const boardName = cleanText(pin.boardName || pin.sourceBoardName, 'Pinterest find');
  const sourceAccount = cleanText(pin.sourceAccount ? `@${pin.sourceAccount}` : '', '');
  const primaryImage = imageUrls[0] || '';
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(shortDescription);
  const safeBrandName = escapeHtml(brandName);
  const safeBoardName = escapeHtml(boardName);
  const safeSourceAccount = escapeHtml(sourceAccount);
  const safeRecoveredNote = escapeHtml(recovered
    ? 'We found this older pin link. Send your email and we will match the product link manually.'
    : 'We will send the matched product link to your email within 5 minutes.');
  const imageAlt = escapeHtml(title || 'Pinned product image');

  let imageHtml = '';
  if (hasMultipleImages) {
    const slides = imageUrls.map((url, i) => `
          <figure class="slide" aria-label="Image ${i + 1} of ${imageUrls.length}">
            <img src="${escapeHtml(url)}" alt="${imageAlt}" ${i === 0 ? 'loading="eager"' : 'loading="lazy"'} decoding="async" />
          </figure>
        `).join('');
    const dots = imageUrls.map((_, i) => `
          <button class="dot ${i === 0 ? 'active' : ''}" type="button" data-index="${i}" aria-label="Show image ${i + 1}"></button>
        `).join('');
    imageHtml = `
        <div class="slider" aria-roledescription="carousel">
          <div class="slides">${slides}</div>
          <div class="image-badge">Shop the look</div>
          <div class="image-error" aria-hidden="true">
            <span>${safeBrandName}</span>
          </div>
          <button class="slider-btn slider-btn-prev" type="button" aria-label="Previous image">&#8249;</button>
          <button class="slider-btn slider-btn-next" type="button" aria-label="Next image">&#8250;</button>
          <div class="slider-footer">
            <div class="slider-dots">${dots}</div>
            <span class="image-count"><span id="slide-current">1</span>/${imageUrls.length}</span>
          </div>
        </div>
      `;
  } else if (primaryImage) {
    imageHtml = `
        <div class="single-image">
          <img src="${escapeHtml(primaryImage)}" alt="${imageAlt}" loading="eager" decoding="async" />
          <div class="image-badge">Shop the look</div>
          <div class="image-error" aria-hidden="true">
            <span>${safeBrandName}</span>
          </div>
        </div>
      `;
  } else {
    imageHtml = `
        <div class="image-fallback" aria-label="Pinned product image">
          <span>Product link</span>
        </div>
      `;
  }

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
      <meta name="theme-color" content="#ffffff">
      <meta name="description" content="${safeDescription}">
      <meta property="og:title" content="${safeTitle}">
      <meta property="og:description" content="${safeDescription}">
      ${primaryImage ? `<meta property="og:image" content="${escapeHtml(primaryImage)}">` : ''}
      <title>${safeTitle}</title>
      <style>
        :root {
          color-scheme: light;
          --paper: #ffffff;
          --canvas: #f3f5f4;
          --ink: #15161a;
          --muted: #656b76;
          --line: #e4e7eb;
          --soft: #edf7f2;
          --accent: #e21d2b;
          --accent-dark: #b81420;
          --success: #087f5b;
          --warm: #fff7ed;
          --shadow: 0 18px 44px rgba(15, 23, 42, 0.14);
        }

        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          background: var(--canvas);
          color: var(--ink);
          min-height: 100svh;
          -webkit-font-smoothing: antialiased;
          text-rendering: optimizeLegibility;
        }

        button,
        input {
          font: inherit;
        }

        .page {
          min-height: 100svh;
          display: grid;
          place-items: center;
          padding: 20px;
        }

        .bridge-shell {
          width: 100%;
          max-width: 1040px;
          display: grid;
          grid-template-columns: minmax(0, 1.08fr) minmax(340px, 0.92fr);
          background: var(--paper);
          border: 1px solid var(--line);
          border-radius: 8px;
          box-shadow: var(--shadow);
          overflow: hidden;
        }

        .visual-panel {
          min-width: 0;
          background: #eef0ef;
          display: grid;
          padding: 12px;
        }

        .single-image,
        .slider,
        .image-fallback {
          width: 100%;
          min-height: 560px;
          max-height: 720px;
          position: relative;
          overflow: hidden;
          background: #f7f8fa;
          border-radius: 8px;
        }

        .single-image img,
        .slide img {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
          background: #f7f8fa;
        }

        .single-image.image-missing img {
          display: none;
        }

        .image-badge {
          position: absolute;
          top: 12px;
          left: 12px;
          z-index: 3;
          display: inline-flex;
          align-items: center;
          min-height: 32px;
          padding: 0 12px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.9);
          color: var(--ink);
          font-size: 12px;
          font-weight: 900;
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.14);
          backdrop-filter: blur(10px);
        }

        .image-error {
          position: absolute;
          inset: 0;
          display: none;
          place-items: center;
          background: linear-gradient(135deg, #f7f8fa, #ecf6f1);
          color: var(--ink);
          font-weight: 900;
        }

        .single-image.image-missing .image-error {
          display: grid;
        }

        .slider.image-missing .image-error {
          display: grid;
        }

        .slider.image-missing .slides,
        .slider.image-missing .slider-btn,
        .slider.image-missing .slider-footer {
          display: none;
        }

        .image-fallback {
          display: grid;
          place-items: center;
          color: var(--ink);
          background:
            radial-gradient(circle at 30% 20%, rgba(226, 29, 43, 0.14), transparent 34%),
            linear-gradient(135deg, #fff7ed, #edf7f2);
          font-weight: 900;
          letter-spacing: 0;
        }

        .slides {
          display: flex;
          height: 100%;
          overflow-x: auto;
          scroll-snap-type: x mandatory;
          scroll-behavior: smooth;
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .slides::-webkit-scrollbar {
          display: none;
        }

        .slide {
          flex: 0 0 100%;
          width: 100%;
          height: 100%;
          margin: 0;
          scroll-snap-align: center;
        }

        .slider-btn {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          width: 42px;
          height: 42px;
          border: 1px solid rgba(255, 255, 255, 0.24);
          border-radius: 999px;
          background: rgba(18, 20, 23, 0.58);
          color: #ffffff;
          font-size: 30px;
          line-height: 1;
          display: grid;
          place-items: center;
          cursor: pointer;
          backdrop-filter: blur(10px);
          transition: transform 0.2s ease, background 0.2s ease;
        }

        .slider-btn:active {
          transform: translateY(-50%) scale(0.96);
        }

        .slider-btn-prev {
          left: 14px;
        }

        .slider-btn-next {
          right: 14px;
        }

        .slider-footer {
          position: absolute;
          left: 14px;
          right: 14px;
          bottom: 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          pointer-events: none;
        }

        .slider-dots {
          display: flex;
          gap: 7px;
          padding: 8px 10px;
          border-radius: 999px;
          background: rgba(18, 20, 23, 0.46);
          backdrop-filter: blur(10px);
          pointer-events: auto;
        }

        .dot {
          width: 7px;
          height: 7px;
          padding: 0;
          border: 0;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.42);
          cursor: pointer;
          transition: width 0.2s ease, background 0.2s ease;
        }

        .dot.active {
          background: #fff;
          width: 18px;
          border-radius: 999px;
        }

        .image-count {
          color: #ffffff;
          font-size: 12px;
          font-weight: 800;
          padding: 7px 10px;
          border-radius: 999px;
          background: rgba(18, 20, 23, 0.52);
          backdrop-filter: blur(10px);
        }

        .unlock-panel {
          min-width: 0;
          padding: 38px 36px;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .brand-row {
          display: flex;
          align-items: center;
          gap: 10px;
          color: var(--ink);
          font-size: 14px;
          font-weight: 800;
          margin-bottom: 24px;
        }

        .brand-mark {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: var(--accent);
          color: #ffffff;
          display: grid;
          place-items: center;
          font-size: 15px;
          font-weight: 900;
        }

        .eyebrow {
          color: var(--success);
          font-size: 12px;
          line-height: 1.2;
          font-weight: 900;
          letter-spacing: 0;
          text-transform: uppercase;
          margin: 0 0 10px;
        }

        h1 {
          font-size: clamp(30px, 4vw, 44px);
          line-height: 1.04;
          letter-spacing: 0;
          margin: 0;
          font-weight: 900;
        }

        .lead {
          color: var(--muted);
          font-size: 16px;
          line-height: 1.55;
          margin: 15px 0 20px;
        }

        .meta-strip {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 24px;
        }

        .chip {
          display: inline-flex;
          align-items: center;
          min-height: 34px;
          padding: 0 12px;
          border: 1px solid var(--line);
          border-radius: 999px;
          background: var(--soft);
          color: #26312f;
          font-size: 13px;
          font-weight: 800;
        }

        .unlock-form {
          display: grid;
          gap: 12px;
        }

        .unlock-form[hidden] {
          display: none;
        }

        label {
          color: var(--ink);
          font-size: 13px;
          font-weight: 800;
        }

        .input-wrap {
          position: relative;
        }

        input[type="email"] {
          width: 100%;
          min-height: 54px;
          padding: 0 15px;
          border: 1.5px solid var(--line);
          border-radius: 8px;
          font-size: 16px;
          color: var(--ink);
          background: #ffffff;
          outline: none;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }

        input[type="email"]:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 4px rgba(217, 33, 40, 0.12);
        }

        input[type="email"]::placeholder {
          color: #9aa0a8;
        }

        .submit-btn {
          width: 100%;
          min-height: 56px;
          padding: 0 18px;
          background: var(--accent);
          color: #ffffff;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 900;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          box-shadow: 0 12px 24px rgba(226, 29, 43, 0.24);
          transition: background 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
        }

        .submit-btn:hover {
          background: var(--accent-dark);
          box-shadow: 0 14px 28px rgba(170, 21, 26, 0.26);
        }

        .submit-btn:active {
          transform: translateY(1px);
        }

        .submit-btn:disabled {
          cursor: progress;
          opacity: 0.78;
        }

        .loader {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255, 255, 255, 0.42);
          border-top-color: #ffffff;
          border-radius: 50%;
          display: none;
          animation: spin 0.8s linear infinite;
        }

        .submit-btn.loading .loader {
          display: inline-block;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .privacy {
          color: var(--muted);
          font-size: 12px;
          line-height: 1.45;
          margin: 2px 0 0;
        }

        .success-card {
          display: grid;
          gap: 12px;
          padding: 16px;
          border: 1px solid #bfe9dc;
          border-radius: 8px;
          background: linear-gradient(135deg, #f0fdf8, #fff7ed);
          box-shadow: 0 14px 30px rgba(8, 127, 91, 0.12);
        }

        .success-card[hidden] {
          display: none;
        }

        .success-icon {
          width: 46px;
          height: 46px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          background: var(--success);
          color: #ffffff;
          font-size: 24px;
          font-weight: 900;
        }

        .success-card h2 {
          margin: 0;
          color: var(--ink);
          font-size: 24px;
          line-height: 1.08;
          letter-spacing: 0;
        }

        .success-card p {
          margin: 0;
          color: #40504b;
          font-size: 14px;
          line-height: 1.5;
        }

        .success-email {
          display: inline-flex;
          max-width: 100%;
          padding: 8px 10px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.78);
          color: var(--ink);
          font-size: 13px;
          font-weight: 850;
          overflow-wrap: anywhere;
        }

        #error-msg {
          color: var(--accent-dark);
          background: #fff1f1;
          border: 1px solid #ffd0d0;
          border-radius: 8px;
          padding: 10px 12px;
          font-size: 13px;
          font-weight: 750;
          display: none;
        }

        @media (max-width: 760px) {
          .page {
            display: block;
            padding: 10px;
            background: var(--canvas);
          }

          .bridge-shell {
            min-height: calc(100svh - 20px);
            display: flex;
            flex-direction: column;
            border: 1px solid var(--line);
            border-radius: 8px;
            box-shadow: 0 14px 34px rgba(15, 23, 42, 0.12);
          }

          .visual-panel {
            background: #eef0ef;
            padding: 8px;
          }

          .single-image,
          .slider,
          .image-fallback {
            min-height: auto;
            height: clamp(330px, 48vh, 430px);
            max-height: none;
            border-radius: 8px;
          }

          .unlock-panel {
            flex: 1;
            padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
            justify-content: flex-start;
            background: var(--paper);
          }

          .brand-row {
            margin-bottom: 12px;
          }

          .brand-mark {
            width: 26px;
            height: 26px;
            font-size: 14px;
          }

          .eyebrow {
            margin-bottom: 6px;
          }

          h1 {
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
            font-size: clamp(24px, 6.6vw, 29px);
            line-height: 1.07;
          }

          .lead {
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            font-size: 14px;
            line-height: 1.38;
            margin: 9px 0 12px;
          }

          .meta-strip {
            margin-bottom: 12px;
          }

          .chip {
            min-height: 30px;
          }

          .unlock-form {
            gap: 8px;
          }

          .unlock-form label {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
          }

          .slider-btn {
            display: none;
          }

          .slider-footer {
            left: 12px;
            right: 12px;
            bottom: 12px;
          }

          .submit-btn,
          input[type="email"] {
            min-height: 54px;
          }
        }

        @media (max-width: 380px) {
          .unlock-panel {
            padding-left: 14px;
            padding-right: 14px;
          }

          .chip {
            font-size: 12px;
            min-height: 32px;
            padding: 0 10px;
          }
        }

        @media (max-width: 760px) and (max-height: 760px) {
          .single-image,
          .slider,
          .image-fallback {
            height: clamp(260px, 39vh, 310px);
          }

          .brand-row {
            margin-bottom: 8px;
          }

          .lead {
            -webkit-line-clamp: 1;
          }
        }
      </style>
    </head>
    <body>
      <main class="page">
        <section class="bridge-shell" aria-label="Pinned product link">
          <div class="visual-panel">
            ${imageHtml}
          </div>

          <div class="unlock-panel">
            <div class="brand-row">
              <span class="brand-mark" aria-hidden="true">A</span>
              <span>${safeBrandName}</span>
            </div>

            <p class="eyebrow">Pinterest find</p>
            <h1>${safeTitle}</h1>
            <p class="lead">${safeDescription}</p>

            <div class="meta-strip" aria-label="Pin details">
              <span class="chip">${safeBoardName}</span>
              ${sourceAccount ? `<span class="chip">${safeSourceAccount}</span>` : ''}
            </div>

            <form id="lead-form" class="unlock-form">
              <div id="error-msg" role="alert"></div>
              <label for="email">Email for the direct link</label>
              <div class="input-wrap">
                <input type="email" id="email" name="email" placeholder="you@example.com" autocomplete="email" inputmode="email" required />
              </div>
              <button class="submit-btn" type="submit">
                <span class="button-text">Unlock shopping link</span>
                <span class="loader" aria-hidden="true"></span>
              </button>
              <p class="privacy">${safeRecoveredNote}</p>
            </form>

            <div id="success-card" class="success-card" hidden>
              <div class="success-icon" aria-hidden="true">✓</div>
              <h2>Request received</h2>
              <p>Your product link will arrive in your email within 5 minutes.</p>
              <span id="success-email" class="success-email"></span>
              <p>Check Promotions or Spam too if it does not appear.</p>
            </div>
          </div>
        </section>
      </main>

      <script>
        const PIN_ID = ${safeJson(pinId)};
        const slides = document.querySelector('.slides');
        const current = document.getElementById('slide-current');
        const prevBtn = document.querySelector('.slider-btn-prev');
        const nextBtn = document.querySelector('.slider-btn-next');

        function getSlideEls() {
          return Array.from(document.querySelectorAll('.slide'));
        }

        function getDotEls() {
          return Array.from(document.querySelectorAll('.dot'));
        }

        function reindexDots() {
          getDotEls().forEach((dot, index) => {
            dot.dataset.index = String(index);
            dot.setAttribute('aria-label', 'Show image ' + (index + 1));
          });
        }

        function syncCarouselControls() {
          const slideCount = getSlideEls().length;
          const footer = document.querySelector('.slider-footer');
          const count = document.querySelector('.image-count');
          const controls = [footer, prevBtn, nextBtn].filter(Boolean);
          controls.forEach((control) => {
            control.style.display = slideCount > 1 ? '' : 'none';
          });
          if (count) count.lastChild.textContent = '/' + slideCount;
        }

        function handleBrokenImage(img) {
          const slide = img.closest('.slide');
          const slider = img.closest('.slider');
          if (slide && slider) {
            const index = getSlideEls().indexOf(slide);
            slide.remove();
            const dot = getDotEls()[index];
            if (dot) dot.remove();
            reindexDots();
            if (getSlideEls().length === 0) {
              slider.classList.add('image-missing');
            }
            syncCarouselControls();
            updateDots();
            return;
          }

          const single = img.closest('.single-image');
          if (single) single.classList.add('image-missing');
        }

        function setSlide(index) {
          if (!slides) return;
          slides.scrollTo({ left: index * slides.offsetWidth, behavior: 'smooth' });
        }

        function updateDots() {
          const dots = getDotEls();
          if (!slides || dots.length === 0) return;
          const index = Math.max(0, Math.min(dots.length - 1, Math.round(slides.scrollLeft / slides.offsetWidth)));
          dots.forEach((dot, i) => {
            dot.classList.toggle('active', i === index);
          });
          if (current) current.textContent = String(index + 1);
        }

        document.querySelectorAll('.visual-panel img').forEach((img) => {
          img.addEventListener('error', () => handleBrokenImage(img), { once: true });
          if (img.complete && img.naturalWidth === 0) handleBrokenImage(img);
        });

        if (slides && getDotEls().length > 0) {
          let scrollTimer = null;
          slides.addEventListener('scroll', () => {
            window.clearTimeout(scrollTimer);
            scrollTimer = window.setTimeout(updateDots, 40);
          }, { passive: true });
          getDotEls().forEach((dot) => dot.addEventListener('click', () => setSlide(Number.parseInt(dot.dataset.index, 10) || 0)));
          prevBtn?.addEventListener('click', () => setSlide(Math.max(0, Math.round(slides.scrollLeft / slides.offsetWidth) - 1)));
          nextBtn?.addEventListener('click', () => {
            const dots = getDotEls();
            setSlide(Math.min(dots.length - 1, Math.round(slides.scrollLeft / slides.offsetWidth) + 1));
          });
          window.addEventListener('resize', updateDots);
          syncCarouselControls();
          updateDots();
        }

        document.getElementById('lead-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const email = document.getElementById('email').value.trim();
          const btn = e.target.querySelector('button');
          const buttonText = btn.querySelector('.button-text');
          const errorMsg = document.getElementById('error-msg');
          const successCard = document.getElementById('success-card');
          const successEmail = document.getElementById('success-email');
          
          if (!email) return;

          buttonText.textContent = 'Sending request...';
          btn.classList.add('loading');
          btn.disabled = true;
          errorMsg.style.display = 'none';

          try {
            const res = await fetch('/bridge/api/leads', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, pinId: PIN_ID })
            });
            const data = await res.json();

            if (!data.success) throw new Error(data.error || 'Failed to request link');

            e.target.hidden = true;
            if (successEmail) successEmail.textContent = email;
            if (successCard) successCard.hidden = false;
          } catch (err) {
            errorMsg.textContent = err.message;
            errorMsg.style.display = 'block';
            buttonText.textContent = 'Unlock shopping link';
            btn.classList.remove('loading');
            btn.disabled = false;
          }
        });
      </script>
    </body>
    </html>
  `;
  res.send(html);
});

// API to capture lead and return destination URL
router.post('/api/leads', async (req, res) => {
  const { email, pinId } = req.body;
  if (!email || !pinId) {
    return res.status(400).json({ success: false, error: 'Email and Pin ID are required' });
  }

  const { pin: imagePin } = await getBridgePin(pinId);
  const targetUrl = resolveTargetUrl(imagePin);

  try {
    await leadStorageService.addLead({ email, pinId, targetUrl });
    return res.json({
      success: true,
      message: 'Your product link will arrive in your email within 5 minutes.',
    });
  } catch (err) {
    console.error('[Bridge] Error saving lead:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

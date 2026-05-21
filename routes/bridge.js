const express = require('express');
const router = express.Router();
const pinterestStateService = require('../services/pinterestStateService');
const pinterestImageStateService = require('../services/pinterestImageStateService');
const leadStorageService = require('../services/leadStorageService');

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

function getPinImages(pin = {}) {
  const urls = Array.isArray(pin.imageUrls) ? pin.imageUrls : [];
  return Array.from(new Set([
    ...urls,
    pin.mediaUrl,
    pin.thumbnailUrl,
  ].filter(Boolean)));
}

// Serve the bridge landing page
router.get('/:pinId', async (req, res) => {
  const { pinId } = req.params;
  const pin = await pinterestImageStateService.getPinById(pinId)
    || await pinterestStateService.getPinById(pinId);

  if (!pin) {
    return res.status(404).send('Pin not found');
  }

  const imageUrls = getPinImages(pin);
  const hasMultipleImages = imageUrls.length > 1;
  const title = cleanText(pin.title, 'Shop this look');
  const description = cleanText(pin.description || pin.caption, 'Get the direct link for this Pinterest find.');
  const shortDescription = description.length > 138 ? `${description.slice(0, 135).trim()}...` : description;
  const brandName = cleanText(process.env.BRIDGE_BRAND_NAME, 'Aura Closet');
  const boardName = cleanText(pin.boardName || pin.sourceBoardName, 'Pinterest find');
  const sourceAccount = cleanText(pin.sourceAccount ? `@${pin.sourceAccount}` : '', '');
  const primaryImage = imageUrls[0] || '';
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(shortDescription);
  const safeBrandName = escapeHtml(brandName);
  const safeBoardName = escapeHtml(boardName);
  const safeSourceAccount = escapeHtml(sourceAccount);
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
        </div>
      `;
  } else {
    imageHtml = `
        <div class="image-fallback" aria-label="Pinned product image">
          <span>${safeBrandName}</span>
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
          --canvas: #f5f6f8;
          --ink: #121417;
          --muted: #626873;
          --line: #e2e5ea;
          --soft: #eef6f1;
          --accent: #d92128;
          --accent-dark: #aa151a;
          --success: #0f766e;
          --shadow: 0 18px 42px rgba(18, 20, 23, 0.12);
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
          max-width: 980px;
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(340px, 0.95fr);
          background: var(--paper);
          border: 1px solid var(--line);
          border-radius: 8px;
          box-shadow: var(--shadow);
          overflow: hidden;
        }

        .visual-panel {
          min-width: 0;
          background: #f7f8fa;
          display: grid;
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
        }

        .single-image img,
        .slide img {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
          background: #f7f8fa;
        }

        .image-fallback {
          display: grid;
          place-items: center;
          color: #ffffff;
          font-weight: 800;
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
          padding: 34px;
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
          margin-bottom: 26px;
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
          font-size: clamp(28px, 5vw, 42px);
          line-height: 1.02;
          letter-spacing: 0;
          margin: 0;
          font-weight: 900;
        }

        .lead {
          color: var(--muted);
          font-size: 16px;
          line-height: 1.55;
          margin: 16px 0 22px;
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
          border: 1px solid var(--line);
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
          box-shadow: 0 12px 24px rgba(217, 33, 40, 0.24);
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
            padding: 0;
            background: var(--paper);
          }

          .bridge-shell {
            min-height: 100svh;
            display: flex;
            flex-direction: column;
            border: 0;
            border-radius: 0;
            box-shadow: none;
          }

          .visual-panel {
            background: var(--paper);
          }

          .single-image,
          .slider,
          .image-fallback {
            min-height: auto;
            height: clamp(300px, 42vh, 390px);
            max-height: none;
            border-radius: 0 0 8px 8px;
          }

          .unlock-panel {
            flex: 1;
            padding: 16px 18px calc(16px + env(safe-area-inset-bottom));
            justify-content: flex-start;
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
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            font-size: clamp(24px, 6.8vw, 30px);
            line-height: 1.05;
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
              <p class="privacy">We will send you straight to the source link after this step.</p>
            </form>
          </div>
        </section>
      </main>

      <script>
        const PIN_ID = ${safeJson(pinId)};
        const slides = document.querySelector('.slides');
        const dots = document.querySelectorAll('.dot');
        const current = document.getElementById('slide-current');
        const prevBtn = document.querySelector('.slider-btn-prev');
        const nextBtn = document.querySelector('.slider-btn-next');

        function setSlide(index) {
          if (!slides) return;
          slides.scrollTo({ left: index * slides.offsetWidth, behavior: 'smooth' });
        }

        function updateDots() {
          if (!slides || dots.length === 0) return;
          const index = Math.max(0, Math.min(dots.length - 1, Math.round(slides.scrollLeft / slides.offsetWidth)));
          dots.forEach((dot, i) => {
            dot.classList.toggle('active', i === index);
          });
          if (current) current.textContent = String(index + 1);
        }

        if (slides && dots.length > 0) {
          let scrollTimer = null;
          slides.addEventListener('scroll', () => {
            window.clearTimeout(scrollTimer);
            scrollTimer = window.setTimeout(updateDots, 40);
          }, { passive: true });
          dots.forEach((dot, index) => dot.addEventListener('click', () => setSlide(index)));
          prevBtn?.addEventListener('click', () => setSlide(Math.max(0, Math.round(slides.scrollLeft / slides.offsetWidth) - 1)));
          nextBtn?.addEventListener('click', () => setSlide(Math.min(dots.length - 1, Math.round(slides.scrollLeft / slides.offsetWidth) + 1)));
          window.addEventListener('resize', updateDots);
        }

        document.getElementById('lead-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const email = document.getElementById('email').value.trim();
          const btn = e.target.querySelector('button');
          const buttonText = btn.querySelector('.button-text');
          const errorMsg = document.getElementById('error-msg');
          
          if (!email) return;

          buttonText.textContent = 'Opening link...';
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

            if (data.success && data.targetUrl) {
              window.location.href = data.targetUrl;
            } else {
              throw new Error(data.error || 'Failed to unlock link');
            }
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

  const imagePin = await pinterestImageStateService.getPinById(pinId)
    || await pinterestStateService.getPinById(pinId);
  if (!imagePin) {
    return res.status(404).json({ success: false, error: 'Pin not found' });
  }

  const targetUrl = imagePin.originalLink || imagePin.targetUrl || imagePin.sourceUrl || imagePin.link || '#';

  try {
    await leadStorageService.addLead({ email, pinId, targetUrl });
    return res.json({ success: true, targetUrl });
  } catch (err) {
    console.error('[Bridge] Error saving lead:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const pinterestStateService = require('../services/pinterestStateService');
const pinterestImageStateService = require('../services/pinterestImageStateService');
const leadStorageService = require('../services/leadStorageService');

// Serve the bridge landing page
router.get('/:pinId', async (req, res) => {
  const { pinId } = req.params;
  const pin = await pinterestImageStateService.getPinById(pinId)
    || await pinterestStateService.getPinById(pinId);

  if (!pin) {
    return res.status(404).send('Pin not found');
  }

  const hasMultipleImages = pin.imageUrls && pin.imageUrls.length > 1;
  let imageHtml = '';
  if (hasMultipleImages) {
    const slides = pin.imageUrls.map((url, i) => `<img src="${url}" class="slide" alt="Product Image ${i + 1}" />`).join('');
    imageHtml = `
      <div class="slider">
        <div class="slides">${slides}</div>
        <div class="slider-dots">
          ${pin.imageUrls.map((_, i) => `<div class="dot ${i === 0 ? 'active' : ''}"></div>`).join('')}
        </div>
      </div>
    `;
  } else {
    imageHtml = `<img src="${pin.thumbnailUrl}" alt="Product Image" class="image-preview" />`;
  }

  // A sleek, conversion-optimized landing page
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${pin.title || 'Unlock Product Link'}</title>
      <style>
        body {
          margin: 0;
          font-family: 'Inter', -apple-system, sans-serif;
          background: #f6f1e8;
          color: #1a1a1a;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
        }
        .container {
          background: #fff;
          border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.08);
          max-width: 400px;
          width: 100%;
          padding: 30px;
          text-align: center;
        }
        .image-preview {
          width: 100%;
          border-radius: 8px;
          margin-bottom: 20px;
          object-fit: cover;
          max-height: 400px;
        }
        .slider {
          position: relative;
          width: 100%;
          border-radius: 8px;
          overflow: hidden;
          margin-bottom: 20px;
        }
        .slides {
          display: flex;
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
          object-fit: cover;
          scroll-snap-align: center;
          max-height: 400px;
        }
        .slider-dots {
          position: absolute;
          bottom: 10px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 6px;
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.5);
          transition: background 0.3s;
        }
        .dot.active {
          background: #fff;
        }
        h1 {
          font-size: 24px;
          margin: 0 0 10px;
          font-weight: 700;
        }
        p {
          color: #666;
          font-size: 15px;
          margin-bottom: 24px;
        }
        input[type="email"] {
          width: 100%;
          padding: 14px;
          border: 1px solid #ddd;
          border-radius: 8px;
          font-size: 16px;
          box-sizing: border-box;
          margin-bottom: 16px;
        }
        button {
          width: 100%;
          padding: 14px;
          background: #1a1a1a;
          color: #fff;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
        }
        button:hover {
          background: #333;
        }
        #error-msg {
          color: #d93025;
          font-size: 14px;
          margin-bottom: 10px;
          display: none;
        }
      </style>
    </head>
    <body>
      <div class="container">
        ${imageHtml}
        <h1>Unlock Direct Link</h1>
        <p>Enter your email below to get the direct link to this product.</p>
        <form id="lead-form">
          <div id="error-msg"></div>
          <input type="email" id="email" placeholder="Enter your email address" required />
          <button type="submit">Get Link Now</button>
        </form>
      </div>

      <script>
        // Optional: Update dots on scroll
        const slides = document.querySelector('.slides');
        const dots = document.querySelectorAll('.dot');
        if (slides && dots.length > 0) {
          slides.addEventListener('scroll', () => {
            const index = Math.round(slides.scrollLeft / slides.offsetWidth);
            dots.forEach((dot, i) => {
              dot.classList.toggle('active', i === index);
            });
          });
        }

        document.getElementById('lead-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const email = document.getElementById('email').value;
          const btn = e.target.querySelector('button');
          const errorMsg = document.getElementById('error-msg');
          
          btn.textContent = 'Unlocking...';
          btn.disabled = true;
          errorMsg.style.display = 'none';

          try {
            const res = await fetch('/bridge/api/leads', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, pinId: '${pinId}' })
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
            btn.textContent = 'Get Link Now';
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

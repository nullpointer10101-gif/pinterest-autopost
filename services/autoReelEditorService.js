'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const mediaTools = require('./mediaToolService');

const MAX_DOWNLOAD_BYTES = Number.parseInt(process.env.AUTO_EDITOR_MAX_SOURCE_MB || '120', 10) * 1024 * 1024;
const MAX_RENDER_SECONDS = Number.parseFloat(process.env.AUTO_EDITOR_MAX_SECONDS || '28');
const DEFAULT_PROFILE = 'pro_fashion';

function clamp(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function cleanText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateText(value = '', max = 42) {
  const clean = cleanText(value);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function pickFontPath(candidates = []) {
  const fallback = mediaTools.getBundledFontPath();
  const paths = [...candidates, fallback].filter(Boolean);
  return paths.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  }) || fallback;
}

function getUiFontPath() {
  return pickFontPath([
    'C:\\Windows\\Fonts\\segoeuib.ttf',
    'C:\\Windows\\Fonts\\GILB____.TTF',
    'C:\\Windows\\Fonts\\bahnschrift.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf',
  ]);
}

function getDisplayFontPath() {
  return pickFontPath([
    'C:\\Windows\\Fonts\\GILSANUB.TTF',
    'C:\\Windows\\Fonts\\GILB____.TTF',
    'C:\\Windows\\Fonts\\CENSCBK.TTF',
    'C:\\Windows\\Fonts\\bahnschrift.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf',
  ]);
}

function getCopyFontPath() {
  return pickFontPath([
    'C:\\Windows\\Fonts\\segoeui.ttf',
    'C:\\Windows\\Fonts\\Candara.ttf',
    'C:\\Windows\\Fonts\\ARIALN.TTF',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ]);
}

function getBrandFontPath() {
  return pickFontPath([
    'C:\\Windows\\Fonts\\KUNSTLER.TTF',
    'C:\\Windows\\Fonts\\BRUSHSCI.TTF',
    'C:\\Windows\\Fonts\\FRSCRIPT.TTF',
    'C:\\Windows\\Fonts\\SCRIPTBL.TTF',
    'C:\\Windows\\Fonts\\BOD_B.TTF',
    'C:\\Windows\\Fonts\\BASKVILL.TTF',
    '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',
  ]);
}

function asciiFallback(value = '') {
  return cleanText(value)
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeDrawText(value = '', { allowUnicode = false } = {}) {
  const clean = allowUnicode ? cleanText(value) : asciiFallback(value);
  return clean
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/%/g, '\\%');
}

function slugify(value = '') {
  const slug = cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || `edit-${Date.now()}`;
}

function tmpFile(prefix, ext) {
  return path.join(os.tmpdir(), `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function removeQuietly(...files) {
  for (const file of files) {
    try {
      if (file && fs.existsSync(file)) fs.unlinkSync(file);
    } catch {}
  }
}

function normalizeProfile(value = '') {
  const clean = String(value || '').toLowerCase().trim();
  if (['pro_fashion', 'outfit_breakdown', 'viral_hook', 'luxury_minimal', 'budget_find', 'shop_the_look'].includes(clean)) return clean;
  return DEFAULT_PROFILE;
}

function normalizeAudioMode(value = '') {
  const clean = String(value || '').toLowerCase().trim();
  if (['mute', 'beat', 'licensed'].includes(clean)) return clean;
  return 'original';
}

function normalizeOptions(options = {}) {
  return {
    enabled: options.enabled !== false,
    profile: normalizeProfile(options.profile || options.preset),
    audioMode: normalizeAudioMode(options.audioMode),
    intensity: clamp(options.intensity ?? 72, 0, 100, 72),
    addHook: options.addHook !== false,
    addProductChips: options.addProductChips !== false,
    addOutro: options.addOutro !== false,
    addWatermark: options.addWatermark !== false,
    addAdvancedFx: options.addAdvancedFx !== false,
    renderPreview: options.renderPreview !== false,
    brandName: truncateText(options.brandName || process.env.STUDIO_BRAND_NAME || 'Aura Closet', 28),
    channelName: truncateText(options.channelName || process.env.STUDIO_CHANNEL_NAME || 'glowareabeauty', 28),
    watermark: truncateText(options.watermark || process.env.AUTO_EDITOR_WATERMARK || 'Aura Closet', 28),
  };
}

function getProfileCopy(profile, title, products = []) {
  const productType = cleanText(products[0]?.type || products[0]?.category || '');
  const product = products[0]?.name || products[0]?.query || '';
  const productTitle = productType
    ? `Shop The ${productType}`
    : truncateText(title || product || 'Shop This Look', 36);
  const safeTitle = truncateText(productTitle, 34);

  const map = {
    pro_fashion: {
      hook: safeTitle.startsWith('Shop') ? safeTitle : `Shop ${safeTitle}`,
      sub: 'Aura Closet edit with matched store picks',
      cta: 'Shop the edited picks',
    },
    shop_the_look: {
      hook: safeTitle.startsWith('Shop') ? safeTitle : `Shop ${safeTitle}`,
      sub: 'Curated picks by Aura Closet',
      cta: 'Shop the full edit',
    },
    outfit_breakdown: {
      hook: 'Outfit Breakdown',
      sub: safeTitle,
      cta: 'Tap for every piece',
    },
    viral_hook: {
      hook: safeTitle,
      sub: 'Save this fit idea',
      cta: 'Steal the look today',
    },
    luxury_minimal: {
      hook: safeTitle,
      sub: 'Clean pieces. Sharp finish.',
      cta: 'Open the curated edit',
    },
    budget_find: {
      hook: 'Budget Version Found',
      sub: safeTitle,
      cta: 'Tap for affordable picks',
    },
  };

  return map[profile] || map.shop_the_look;
}

function buildProductLabels(products = [], title = '') {
  const fromProducts = products
    .map((product) => {
      const role = cleanText(product?.roleBadge || product?.role || '');
      const type = cleanText(product?.type || product?.category || '');
      if (/premium/i.test(role)) return 'Premium Pick';
      if (/budget/i.test(role)) return 'Budget Pick';
      if (/exact/i.test(role)) return type ? `Exact ${type}` : 'Exact Match';
      return type || product?.name || product?.query || product?.title || '';
    })
    .map((name) => truncateText(name, 22))
    .filter(Boolean);

  if (fromProducts.length) return Array.from(new Set(fromProducts)).slice(0, 3);

  const cleanTitle = cleanText(title);
  const fallback = cleanTitle
    ? cleanTitle.split(/[|,]/).map((part) => truncateText(part, 26)).filter(Boolean)
    : [];

  return (fallback.length ? fallback : ['Exact Match', 'Premium Pick', 'Budget Pick']).slice(0, 3);
}

function colorForProfile(profile) {
  const colors = {
    pro_fashion: { accent: '0xF4485F', accentSoft: '0xF4DFA4', dark: '0x060606' },
    shop_the_look: { accent: '0xF4485F', accentSoft: '0xF9D85E', dark: '0x09090B' },
    outfit_breakdown: { accent: '0x20C997', accentSoft: '0x8CE99A', dark: '0x071311' },
    viral_hook: { accent: '0xFF3D7F', accentSoft: '0xFFE066', dark: '0x10040A' },
    luxury_minimal: { accent: '0xD6B56D', accentSoft: '0xF4E7C2', dark: '0x0B0B0A' },
    budget_find: { accent: '0x2F9E44', accentSoft: '0xB2F2BB', dark: '0x06120A' },
  };
  return colors[profile] || colors.shop_the_look;
}

function drawTextFilter({ text, x, y, size = 48, color = 'white', alpha = 1, enable = '', box = false, boxColor = 'black@0.42', fontPath = '', allowUnicode = false }) {
  const font = fontPath ? `fontfile='${mediaTools.escapeFilterPath(fontPath)}':` : '';
  const pieces = [
    `drawtext=${font}text='${escapeDrawText(text, { allowUnicode })}'`,
    `x=${x}`,
    `y=${y}`,
    `fontsize=${size}`,
    `fontcolor=${color}`,
    `alpha=${alpha}`,
    'line_spacing=10',
  ];
  if (box) {
    pieces.push('box=1', `boxcolor=${boxColor}`, 'boxborderw=22');
  }
  if (enable) pieces.push(`enable='${enable}'`);
  return pieces.join(':');
}

function drawBoxFilter({ x, y, w, h, color = 'black@0.38', enable = '' }) {
  const filter = `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}:t=fill`;
  return enable ? `${filter}:enable='${enable}'` : filter;
}

function logoCircleLavfi(size = 82) {
  const radiusExpression = '(W/2)*(W/2)';
  const distanceExpression = '(X-W/2)*(X-W/2)+(Y-H/2)*(Y-H/2)';
  return `color=c=black@0:s=${size}x${size},format=rgba,geq=r='0':g='0':b='0':a='if(lte(${distanceExpression},${radiusExpression}),242,0)'`;
}

function logoTextFilters(enable = '') {
  const uiFontPath = getUiFontPath();
  const brandFontPath = getBrandFontPath();
  return [
    drawTextFilter({
      text: 'Aura',
      x: 89,
      y: 87,
      size: 33,
      color: 'white',
      alpha: 1,
      enable,
      fontPath: brandFontPath,
    }),
    drawTextFilter({
      text: 'CLOSET',
      x: 100,
      y: 117,
      size: 7,
      color: 'white@0.84',
      alpha: 0.84,
      enable,
      fontPath: uiFontPath,
    }),
  ].join(',');
}

function buildLogoOverlayChain({ logoInputIndex, outputLabel, enable = '' }) {
  const overlayEnable = enable ? `:enable='${enable}'` : '';
  return `[base][${logoInputIndex}:v]overlay=x=75:y=70${overlayEnable},${logoTextFilters(enable)},format=yuv420p[${outputLabel}]`;
}

function buildVideoFilterComplex({ videoFilter, logoInputIndex, duration }) {
  const enable = `between(t,0,${Math.min(duration, 4.2).toFixed(2)})`;
  return `[0:v]${videoFilter}[base];${buildLogoOverlayChain({ logoInputIndex, outputLabel: 'v', enable })}`;
}

function buildCoverFilterComplex({ coverFilter, logoInputIndex }) {
  return `[0:v]${coverFilter}[base];${buildLogoOverlayChain({ logoInputIndex, outputLabel: 'v' })}`;
}

function buildVideoFilter({ title, description, products, options, duration }) {
  const uiFontPath = getUiFontPath();
  const displayFontPath = getDisplayFontPath();
  const copyFontPath = getCopyFontPath();
  const copy = getProfileCopy(options.profile, title, products);
  const labels = buildProductLabels(products, title);
  const colors = colorForProfile(options.profile);
  const intensity = options.intensity / 100;
  const contrast = (1.04 + intensity * 0.07).toFixed(2);
  const saturation = (1.08 + intensity * 0.12).toFixed(2);
  const brightness = (0.001 + intensity * 0.006).toFixed(3);
  const hookEnd = Math.min(2.6, Math.max(1.6, duration * 0.2));
  const outroStart = Math.max(0.2, duration - Math.min(3.0, Math.max(1.7, duration * 0.22)));
  const flashEnd = Math.min(0.15, Math.max(0.09, duration * 0.015));
  const glitchShift = Math.round(1 + intensity * 2);
  const grain = Math.round(3 + intensity * 5);

  const filters = [
    'scale=1180:2098:force_original_aspect_ratio=increase',
    "crop=1080:1920:x='(in_w-out_w)/2+14*sin(2*PI*t/5)+4*sin(2*PI*t*1.7)':y='(in_h-out_h)/2+8*sin(2*PI*t/7)'",
    `eq=contrast=${contrast}:saturation=${saturation}:brightness=${brightness}`,
  ];

  if (options.addAdvancedFx) {
    filters.push(
      'curves=preset=medium_contrast',
      'colorbalance=rs=0.018:gs=0.002:bs=-0.018:rm=0.008:gm=0.004:bm=-0.012:rh=0.012:gh=0.006:bh=-0.004',
      `chromashift=cbh=${glitchShift}:crh=-${glitchShift}`,
      'lenscorrection=k1=-0.018:k2=0.006',
      'vignette=angle=PI/5:mode=backward',
      `noise=alls=${grain}:allf=t+u`
    );
  }

  filters.push(
    'unsharp=5:5:0.42',
    'format=yuv420p',
  );

  if (options.addAdvancedFx) {
    filters.push(drawBoxFilter({
      x: 0,
      y: 0,
      w: 1080,
      h: 1920,
      color: 'white@0.10',
      enable: `between(t,0.02,${flashEnd.toFixed(2)})+between(t,1.06,1.09)+between(t,2.12,2.15)`,
    }));
    filters.push(drawBoxFilter({
      x: 0,
      y: 0,
      w: 1080,
      h: 76,
      color: 'black@0.34',
      enable: `between(t,0,${hookEnd.toFixed(2)})+gte(t,${outroStart.toFixed(2)})`,
    }));
    filters.push(drawBoxFilter({
      x: 0,
      y: 1844,
      w: 1080,
      h: 76,
      color: 'black@0.34',
      enable: `between(t,0,${hookEnd.toFixed(2)})+gte(t,${outroStart.toFixed(2)})`,
    }));
    filters.push(drawBoxFilter({
      x: 40,
      y: 238,
      w: 1000,
      h: 2,
      color: `${colors.accentSoft}@0.60`,
      enable: `between(t,0.18,${Math.min(hookEnd, 1.15).toFixed(2)})`,
    }));
  }

  if (options.addWatermark) {
    filters.push(drawBoxFilter({
      x: 54,
      y: 54,
      w: 438,
      h: 112,
      color: 'white@0.88',
      enable: `between(t,0,${Math.min(duration, 4.2).toFixed(2)})`,
    }));
    filters.push(drawTextFilter({
      text: options.brandName,
      x: 164,
      y: 72,
      size: 33,
      color: 'black',
      alpha: 1,
      enable: `between(t,0,${Math.min(duration, 4.2).toFixed(2)})`,
      fontPath: uiFontPath,
    }));
    filters.push(drawTextFilter({
      text: options.channelName,
      x: 166,
      y: 113,
      size: 21,
      color: '0x454545',
      alpha: 1,
      enable: `between(t,0,${Math.min(duration, 4.2).toFixed(2)})`,
      fontPath: copyFontPath,
    }));
    filters.push(drawTextFilter({
      text: options.brandName,
      x: 'w-tw-54',
      y: 54,
      size: 25,
      color: 'white@0.72',
      alpha: 0.72,
      enable: `gt(t,${Math.min(duration, 4.2).toFixed(2)})`,
      fontPath: copyFontPath,
    }));
  }

  if (options.addHook) {
    filters.push(drawBoxFilter({
      x: 54,
      y: 1264,
      w: 744,
      h: 190,
      color: `${colors.dark}@0.62`,
      enable: `between(t,0,${hookEnd.toFixed(2)})`,
    }));
    filters.push(drawBoxFilter({
      x: 78,
      y: 1288,
      w: 688,
      h: 2,
      color: `white@0.28`,
      enable: `between(t,0.20,${hookEnd.toFixed(2)})`,
    }));
    filters.push(drawBoxFilter({
      x: 54,
      y: 1264,
      w: 10,
      h: 190,
      color: `${colors.accent}@0.95`,
      enable: `between(t,0,${hookEnd.toFixed(2)})`,
    }));
    filters.push(drawTextFilter({
      text: copy.hook,
      x: 90,
      y: 1306,
      size: options.profile === 'luxury_minimal' ? 44 : 50,
      color: 'white',
      alpha: 1,
      enable: `between(t,0,${hookEnd.toFixed(2)})`,
      fontPath: displayFontPath,
    }));
    filters.push(drawTextFilter({
      text: copy.sub || description,
      x: 90,
      y: 1382,
      size: 25,
      color: colors.accentSoft,
      alpha: 0.96,
      enable: `between(t,0.25,${hookEnd.toFixed(2)})`,
      fontPath: copyFontPath,
    }));
  }

  if (options.addProductChips) {
    labels.forEach((label, index) => {
      const start = Math.min(Math.max(2.8 + index * 2.4, 0.7), Math.max(0.8, duration - 4));
      const end = Math.min(duration - 2.2, start + 2.2);
      const y = 1350 + index * 82;
      const x = 66;
      const width = 428;
      if (options.addAdvancedFx) {
        filters.push(drawBoxFilter({
          x: 0,
          y: y - 22,
          w: 1080,
          h: 104,
          color: 'black@0.12',
          enable: `between(t,${start.toFixed(2)},${end.toFixed(2)})`,
        }));
        filters.push(drawBoxFilter({
          x: 64,
          y: y - 8,
          w: width + 42,
          h: 2,
          color: `${colors.accentSoft}@0.58`,
          enable: `between(t,${start.toFixed(2)},${Math.min(end, start + 0.45).toFixed(2)})`,
        }));
      }
      filters.push(drawBoxFilter({
        x,
        y,
        w: width,
        h: 58,
        color: 'black@0.58',
        enable: `between(t,${start.toFixed(2)},${end.toFixed(2)})`,
      }));
      filters.push(drawBoxFilter({
        x,
        y,
        w: 8,
        h: 58,
        color: `${colors.accent}@0.95`,
        enable: `between(t,${start.toFixed(2)},${end.toFixed(2)})`,
      }));
      filters.push(drawTextFilter({
        text: label,
        x: x + 28,
        y: y + 14,
        size: 26,
        color: 'white',
        alpha: 1,
        enable: `between(t,${start.toFixed(2)},${end.toFixed(2)})`,
        fontPath: copyFontPath,
      }));
    });
  }

  if (options.addOutro) {
    filters.push(drawBoxFilter({
      x: 0,
      y: 1508,
      w: 1080,
      h: 412,
      color: 'black@0.62',
      enable: `gte(t,${outroStart.toFixed(2)})`,
    }));
    filters.push(drawTextFilter({
      text: copy.cta,
      x: '(w-tw)/2',
      y: 1608,
      size: 54,
      color: 'white',
      alpha: 1,
      enable: `gte(t,${outroStart.toFixed(2)})`,
      fontPath: displayFontPath,
    }));
    filters.push(drawTextFilter({
      text: `${options.brandName} | ${options.channelName}`,
      x: '(w-tw)/2',
      y: 1702,
      size: 27,
      color: colors.accentSoft,
      alpha: 0.95,
      enable: `gte(t,${outroStart.toFixed(2)})`,
      fontPath: copyFontPath,
    }));
  }

  filters.push('fade=t=in:st=0:d=0.18', `fade=t=out:st=${Math.max(0, duration - 0.35).toFixed(2)}:d=0.35`);
  return filters.join(',');
}

async function downloadSource(inputUrl) {
  const clean = String(inputUrl || '').trim();
  if (!clean) throw new Error('inputUrl is required');

  if (fs.existsSync(clean)) {
    return { filePath: clean, cleanup: false };
  }

  const parsed = new URL(clean);
  const ext = mediaTools.isImagePath(parsed.pathname) ? path.extname(parsed.pathname) || '.jpg' : '.mp4';
  const destination = tmpFile('auto_edit_source', ext);
  const response = await axios.get(clean, {
    responseType: 'stream',
    timeout: 30000,
    maxRedirects: 5,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Referer: 'https://www.instagram.com/',
      Range: `bytes=0-${MAX_DOWNLOAD_BYTES - 1}`,
    },
    validateStatus: (status) => (status >= 200 && status < 300) || status === 206,
  });

  await new Promise((resolve, reject) => {
    let received = 0;
    const writer = fs.createWriteStream(destination);
    response.data.on('data', (chunk) => {
      received += chunk.length;
      if (received > MAX_DOWNLOAD_BYTES) {
        response.data.destroy(new Error('Source media is too large for the free local editor limit.'));
      }
    });
    response.data.on('error', reject);
    writer.on('finish', resolve);
    writer.on('error', reject);
    response.data.pipe(writer);
  });

  return { filePath: destination, cleanup: true };
}

function resolveOutputPaths({ persist, title, shortcode }) {
  const id = `${slugify(shortcode || title)}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  if (persist) {
    const publicDir = path.join(process.cwd(), 'public', 'generated', 'reels');
    ensureDir(publicDir);
    return {
      id,
      outputPath: path.join(publicDir, `${id}.mp4`),
      thumbnailPath: path.join(publicDir, `${id}.jpg`),
      publicMediaPath: `/generated/reels/${id}.mp4`,
      publicThumbnailPath: `/generated/reels/${id}.jpg`,
    };
  }

  return {
    id,
    outputPath: tmpFile('auto_edit_render', '.mp4'),
    thumbnailPath: tmpFile('auto_edit_thumb', '.jpg'),
    publicMediaPath: '',
    publicThumbnailPath: '',
  };
}

function normalizeProducts(products = []) {
  if (!Array.isArray(products)) return [];
  return products
    .map((product) => ({
      name: cleanText(product?.name || product?.query || product?.title || ''),
      type: cleanText(product?.type || product?.category || ''),
      role: cleanText(product?.role || ''),
      roleBadge: cleanText(product?.roleBadge || ''),
      url: cleanText(product?.url || product?.affiliateUrl || ''),
      image: cleanText(product?.image || product?.thumbnail || ''),
    }))
    .filter((product) => product.name)
    .slice(0, 4);
}

function buildCoverFilter({ title, products, options }) {
  const uiFontPath = getUiFontPath();
  const displayFontPath = getDisplayFontPath();
  const copyFontPath = getCopyFontPath();
  const copy = getProfileCopy(options.profile, title, products);
  const labels = buildProductLabels(products, title).slice(0, 2);
  const colors = colorForProfile(options.profile);

  const filters = [
    'scale=1180:2098:force_original_aspect_ratio=increase',
    "crop=1080:1920:x='(in_w-out_w)/2':y='(in_h-out_h)/2'",
    'eq=contrast=1.10:saturation=1.16:brightness=0.004',
    'curves=preset=medium_contrast',
    'colorbalance=rs=0.018:gs=0.002:bs=-0.018:rm=0.008:gm=0.004:bm=-0.012:rh=0.012:gh=0.006:bh=-0.004',
    'chromashift=cbh=2:crh=-2',
    'lenscorrection=k1=-0.018:k2=0.006',
    'vignette=angle=PI/5:mode=backward',
    'noise=alls=3:allf=t+u',
    'unsharp=5:5:0.42',
    'format=yuv420p',
    drawBoxFilter({ x: 0, y: 0, w: 1080, h: 1920, color: 'black@0.08' }),
    drawBoxFilter({ x: 54, y: 54, w: 438, h: 112, color: 'white@0.92' }),
    drawTextFilter({
      text: options.brandName,
      x: 164,
      y: 72,
      size: 33,
      color: 'black',
      fontPath: uiFontPath,
    }),
    drawTextFilter({
      text: options.channelName,
      x: 166,
      y: 113,
      size: 21,
      color: '0x454545',
      fontPath: copyFontPath,
    }),
    drawBoxFilter({ x: 54, y: 1378, w: 972, h: 324, color: 'black@0.64' }),
    drawBoxFilter({ x: 54, y: 1378, w: 12, h: 324, color: `${colors.accent}@0.95` }),
    drawBoxFilter({ x: 90, y: 1416, w: 872, h: 2, color: 'white@0.26' }),
    drawTextFilter({
      text: copy.hook,
      x: 92,
      y: 1434,
      size: 60,
      color: 'white',
      fontPath: displayFontPath,
    }),
    drawTextFilter({
      text: 'Advanced edit + product links',
      x: 94,
      y: 1532,
      size: 30,
      color: colors.accentSoft,
      fontPath: copyFontPath,
    }),
  ];

  labels.forEach((label, index) => {
    filters.push(drawTextFilter({
      text: label,
      x: 94 + index * 300,
      y: 1614,
      size: 24,
      color: 'white',
      box: true,
      boxColor: 'white@0.16',
      fontPath: copyFontPath,
    }));
  });

  return filters.join(',');
}

async function renderAutoEditedReel(input = {}) {
  const options = normalizeOptions(input.options || input.autoEdit || {});
  const inputUrl = input.inputUrl || input.mediaUrl || input.reelData?.mediaUrl || '';
  const title = cleanText(input.title || input.aiContent?.title || 'Shop This Look');
  const description = cleanText(input.description || input.aiContent?.description || '');
  const shortcode = cleanText(input.shortcode || input.reelData?.shortcode || '');
  const products = normalizeProducts(input.products || input.affiliateLinks || input.productInfo?.outfit || []);
  const cleanupPaths = [];

  if (!options.enabled) {
    return { rendered: false, reason: 'auto_edit_disabled', mediaUrl: inputUrl, cleanupPaths };
  }
  if (!inputUrl) {
    return { rendered: false, reason: 'missing_media_url', mediaUrl: inputUrl, cleanupPaths };
  }
  if (!mediaTools.isFfmpegAvailable()) {
    return { rendered: false, reason: 'ffmpeg_unavailable', mediaUrl: inputUrl, cleanupPaths };
  }

  let source = null;
  try {
    source = await downloadSource(inputUrl);
    if (source.cleanup) cleanupPaths.push(source.filePath);

    const info = await mediaTools.probeVideo(source.filePath);
    const duration = clamp(
      info.duration || Number.parseFloat(input.duration || '0') || 12,
      3,
      Number.isFinite(MAX_RENDER_SECONDS) && MAX_RENDER_SECONDS > 0 ? MAX_RENDER_SECONDS : 28,
      12
    );
    const paths = resolveOutputPaths({ persist: !!input.persist, title, shortcode });
    const vf = buildVideoFilter({ title, description, products, options, duration });
    const ffmpeg = mediaTools.resolveFfmpegPath();
    const audioMode = options.audioMode;
    const licensedAudio = process.env.AUTO_EDITOR_AUDIO_PATH && fs.existsSync(process.env.AUTO_EDITOR_AUDIO_PATH)
      ? process.env.AUTO_EDITOR_AUDIO_PATH
      : '';

    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', source.filePath];
    let audioInputIndex = null;
    let nextInputIndex = 1;

    if (audioMode === 'licensed' && licensedAudio) {
      args.push('-stream_loop', '-1', '-i', licensedAudio);
      audioInputIndex = nextInputIndex++;
    } else if (audioMode === 'beat') {
      args.push('-f', 'lavfi', '-t', String(duration), '-i', 'sine=frequency=98:sample_rate=44100');
      audioInputIndex = nextInputIndex++;
    }

    const logoInputIndex = nextInputIndex++;
    args.push('-f', 'lavfi', '-i', logoCircleLavfi());

    args.push(
      '-t', String(duration),
      '-filter_complex', buildVideoFilterComplex({ videoFilter: vf, logoInputIndex, duration }),
      '-map', '[v]'
    );

    if (audioMode === 'mute') {
      args.push('-an');
    } else if (audioInputIndex !== null) {
      args.push('-map', `${audioInputIndex}:a:0`, '-shortest', '-af', 'volume=0.42');
    } else if (info.hasAudio) {
      args.push('-map', '0:a?', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11');
    } else {
      args.push('-an');
    }

    args.push(
      '-r', '30',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart'
    );

    if (audioMode !== 'mute' && (info.hasAudio || audioInputIndex !== null)) {
      args.push('-c:a', 'aac', '-b:a', '128k', '-ar', '44100');
    }

    args.push(paths.outputPath);

    await mediaTools.execFileAsync(ffmpeg, args, {
      timeout: Number.parseInt(process.env.AUTO_EDITOR_RENDER_TIMEOUT_MS || '240000', 10),
      maxBuffer: 1024 * 1024 * 4,
    });

    const coverSeek = Math.max(1, Math.min(duration - 0.8, duration * 0.42));
    const coverFilter = buildCoverFilter({ title, products, options });
    await mediaTools.execFileAsync(ffmpeg, [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-ss', String(coverSeek.toFixed(2)),
      '-i', source.filePath,
      '-f', 'lavfi',
      '-i', logoCircleLavfi(),
      '-frames:v', '1',
      '-filter_complex', buildCoverFilterComplex({ coverFilter, logoInputIndex: 1 }),
      '-map', '[v]',
      '-q:v', '2',
      paths.thumbnailPath,
    ], { timeout: 15000, maxBuffer: 1024 * 1024 });

    if (!input.persist) {
      cleanupPaths.push(paths.outputPath, paths.thumbnailPath);
    }

    return {
      rendered: true,
      editId: paths.id,
      outputPath: paths.outputPath,
      thumbnailPath: paths.thumbnailPath,
      mediaUrl: paths.publicMediaPath || inputUrl,
      thumbnailUrl: paths.publicThumbnailPath || '',
      duration,
      cleanupPaths,
      recipe: options,
      effects: [
        '9:16 Pinterest crop',
        'motion crop pulses',
        'cinematic color grade',
        ...(options.addAdvancedFx ? [
          'contrast curves',
          'subtle chroma shift',
          'lens polish',
          'film grain',
          'vignette',
          'flash cuts',
          'spotlight sweeps',
        ] : []),
        'Aura Closet brand lockup',
        'clean hook card',
        'minimal product chips',
        'branded cover thumbnail',
        'CTA outro',
        audioMode === 'licensed' && licensedAudio ? 'licensed audio bed' : audioMode,
      ],
    };
  } catch (err) {
    removeQuietly(...cleanupPaths);
    return {
      rendered: false,
      reason: err.message,
      mediaUrl: inputUrl,
      cleanupPaths: [],
      recipe: options,
      effects: [],
    };
  }
}

function cleanupRenderResult(result = {}) {
  if (Array.isArray(result.cleanupPaths)) {
    removeQuietly(...result.cleanupPaths);
  }
}

module.exports = {
  normalizeOptions,
  renderAutoEditedReel,
  cleanupRenderResult,
};

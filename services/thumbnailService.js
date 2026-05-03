/**
 * ═══════════════════════════════════════════════════════════════════════════
 * thumbnailService.js — Smart Product-Focused Thumbnail Selector
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * For each reel video, this service:
 *   1. Downloads a small segment of the video to a temp file
 *   2. Extracts ~6 evenly spaced frames using ffmpeg (if available)
 *   3. Uploads frame candidates to Gemini Vision (multimodal)
 *   4. Returns the single best frame where the product is MOST VISIBLE
 *      (clear, well-lit, product centered/prominent, not blurry)
 *
 * Falls back to the original thumbnailUrl on any error so the pipeline
 * never fails because of thumbnail selection.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const axios = require('axios');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

// ── Config ────────────────────────────────────────────────────────────────────
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '';
const GEMINI_VISION_MODEL = 'gemini-2.0-flash';
const GEMINI_BASE     = 'https://generativelanguage.googleapis.com/v1beta';

// How many frames to extract and evaluate
const FRAME_COUNT     = 6;
// Max video bytes to download for frame extraction (20 MB)
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
// Timeout for the whole thumbnail selection (30s)
const SELECTION_TIMEOUT_MS = 30_000;

// ── ffmpeg Detection ──────────────────────────────────────────────────────────
let FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
let ffmpegAvailable = null; // null = not yet checked

async function checkFfmpeg() {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    await execFileAsync(FFMPEG_PATH, ['-version']);
    ffmpegAvailable = true;
    console.log('[Thumbnail] ffmpeg is available.');
  } catch {
    ffmpegAvailable = false;
    console.log('[Thumbnail] ffmpeg not found. Frame extraction will be skipped.');
  }
  return ffmpegAvailable;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tmpFile(ext) {
  return path.join(os.tmpdir(), `yt_thumb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`);
}

function cleanup(...files) {
  for (const f of files) {
    try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

/**
 * Download up to MAX_VIDEO_BYTES of a video URL into a temp file.
 */
async function downloadVideoChunk(videoUrl, destPath) {
  const response = await axios.get(videoUrl, {
    responseType: 'stream',
    timeout: 20_000,
    headers: {
      'User-Agent':  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer':     'https://www.instagram.com/',
      'Range':       `bytes=0-${MAX_VIDEO_BYTES - 1}`,
    },
    maxRedirects: 5,
    validateStatus: s => s < 400 || s === 206,
  });

  return new Promise((resolve, reject) => {
    let received = 0;
    const writer = fs.createWriteStream(destPath);
    response.data.on('data', chunk => {
      received += chunk.length;
      if (received > MAX_VIDEO_BYTES) {
        response.data.destroy();
        writer.close();
        resolve();
        return;
      }
    });
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
    response.data.on('error', reject);
  });
}

/**
 * Extract FRAME_COUNT evenly spaced JPEG frames from a video file.
 * Returns array of temp file paths.
 */
async function extractFrames(videoPath) {
  const frameDir = path.join(os.tmpdir(), `frames_${Date.now()}`);
  fs.mkdirSync(frameDir, { recursive: true });

  const outputPattern = path.join(frameDir, 'frame_%02d.jpg');

  // Use select filter to pick evenly spaced frames
  // fps=1/N means one frame every N seconds — we aim for ~6 total from the chunk
  // Using vf "select" with scene change + fps is most reliable
  await execFileAsync(FFMPEG_PATH, [
    '-i', videoPath,
    '-vf', `fps=1,select='not(mod(n\\,5))'`,   // pick every 5th second-sampled frame
    '-vframes', String(FRAME_COUNT),
    '-q:v', '4',      // JPEG quality (1=best, 31=worst) — 4 is good enough
    '-vsync', 'vfr',
    outputPattern,
    '-y',
  ], { timeout: 15_000 });

  const frames = fs.readdirSync(frameDir)
    .filter(f => f.endsWith('.jpg'))
    .sort()
    .map(f => path.join(frameDir, f));

  return { frames, frameDir };
}

/**
 * Convert a JPEG file to base64 inline data URI.
 */
function fileToBase64(filePath) {
  const data = fs.readFileSync(filePath);
  return data.toString('base64');
}

/**
 * Ask Gemini Vision which frame best shows the product.
 * Returns 0-based index of the best frame (or 0 as default).
 */
async function askGeminiForBestFrame(frames, caption, productName) {
  if (!GEMINI_API_KEY) {
    console.log('[Thumbnail] No Gemini API key — using middle frame as best.');
    return Math.floor(frames.length / 2);
  }

  const productHint = productName
    ? `The main product being sold is: "${productName}".`
    : 'Identify the main product or item being showcased.';

  const systemInstruction = `You are a Pinterest thumbnail expert. ${productHint}
Your job is to select the single BEST frame for a Pinterest Pin cover image.
The best frame has: the product CLEARLY VISIBLE and centered, good lighting, product not cut off, not blurry, no hands covering the product, human face optional but product must be dominant.
Return ONLY a JSON object like: {"bestFrame": 2, "reason": "Product clearly visible, well lit"}
The frame indices are 0-based.`;

  // Build the parts array: one text + one image per frame
  const parts = [
    { text: `${systemInstruction}\n\nCaption: "${caption.substring(0, 200)}"\n\nHere are ${frames.length} frames from the reel. Choose the best one:` }
  ];

  for (let i = 0; i < frames.length; i++) {
    parts.push({ text: `Frame ${i}:` });
    parts.push({
      inline_data: {
        mime_type: 'image/jpeg',
        data: fileToBase64(frames[i]),
      }
    });
  }

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature:      0.1,
      maxOutputTokens:  80,
      responseMimeType: 'application/json',
    },
  };

  const res = await axios.post(
    `${GEMINI_BASE}/models/${GEMINI_VISION_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    body,
    { timeout: 20_000, headers: { 'Content-Type': 'application/json' } }
  );

  const raw = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const cleaned = raw.replace(/```json/i, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleaned);

  const idx = Number.parseInt(parsed.bestFrame, 10);
  const reason = parsed.reason || '';
  console.log(`[Thumbnail] Gemini chose frame ${idx}: ${reason}`);

  if (Number.isFinite(idx) && idx >= 0 && idx < frames.length) return idx;
  return 0;
}

/**
 * Upload a local JPEG to Gemini Files API and return a file URI
 * (used as fallback if inline data exceeds size limits).
 * Returns null if upload fails.
 */
async function uploadFrameToGemini(framePath) {
  const data   = fs.readFileSync(framePath);
  const size   = data.length;
  const mimeType = 'image/jpeg';

  // Step 1: Initiate resumable upload
  const initRes = await axios.post(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`,
    null,
    {
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(size),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      data: JSON.stringify({ file: { display_name: path.basename(framePath) } }),
      timeout: 10_000,
    }
  );

  const uploadUrl = initRes.headers['x-goog-upload-url'];
  if (!uploadUrl) return null;

  // Step 2: Upload the bytes
  await axios.post(uploadUrl, data, {
    headers: {
      'Content-Length': String(size),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
      'Content-Type': mimeType,
    },
    timeout: 15_000,
  });

  return null; // We'll use inline_data instead; this is only a reference
}

// ── Main Export ───────────────────────────────────────────────────────────────

/**
 * selectBestThumbnail(reel) — core function
 *
 * @param {object} reel - reel object with { mediaUrl, thumbnailUrl, caption, shortcode }
 * @param {string} [productName] - optional product name hint from AI identification
 * @returns {Promise<string>} - best thumbnail URL (base64 data URI or original URL)
 */
async function selectBestThumbnail(reel, productName = '') {
  const { mediaUrl, thumbnailUrl, caption = '', shortcode = '' } = reel;
  const fallback = thumbnailUrl || mediaUrl || '';

  // Skip if it's already an image (not a video reel)
  if (!mediaUrl || !/\.(mp4|mov|webm|m4v)/i.test(mediaUrl)) {
    console.log(`[Thumbnail] ${shortcode}: Not a video URL, keeping original thumbnail.`);
    return fallback;
  }

  // Skip if no ffmpeg available
  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    console.log(`[Thumbnail] ${shortcode}: ffmpeg not available, using original thumbnail.`);
    return fallback;
  }

  const videoPath  = tmpFile('.mp4');
  let   frameDir   = null;
  const framePaths = [];

  try {
    // 1. Download video chunk
    console.log(`[Thumbnail] ${shortcode}: Downloading video chunk...`);
    await downloadVideoChunk(mediaUrl, videoPath);

    const videoSize = fs.existsSync(videoPath) ? fs.statSync(videoPath).size : 0;
    if (videoSize < 10_000) {
      console.log(`[Thumbnail] ${shortcode}: Video chunk too small (${videoSize} bytes), using fallback.`);
      return fallback;
    }
    console.log(`[Thumbnail] ${shortcode}: Downloaded ${Math.round(videoSize / 1024)} KB`);

    // 2. Extract frames
    console.log(`[Thumbnail] ${shortcode}: Extracting ${FRAME_COUNT} frames...`);
    const extracted = await extractFrames(videoPath);
    frameDir = extracted.frameDir;
    framePaths.push(...extracted.frames);

    if (framePaths.length === 0) {
      console.log(`[Thumbnail] ${shortcode}: No frames extracted, using fallback.`);
      return fallback;
    }
    console.log(`[Thumbnail] ${shortcode}: Extracted ${framePaths.length} frames.`);

    // 3. Ask AI for best frame
    console.log(`[Thumbnail] ${shortcode}: Sending frames to Gemini Vision for product visibility scoring...`);
    const bestIdx = await askGeminiForBestFrame(framePaths, caption, productName);
    const bestFramePath = framePaths[bestIdx];

    console.log(`[Thumbnail] ${shortcode}: ✅ Best frame = ${bestIdx} of ${framePaths.length}`);

    // 4. Return as base64 data URI (so Puppeteer can upload it directly)
    const imageData = fs.readFileSync(bestFramePath);
    const base64    = imageData.toString('base64');
    return `data:image/jpeg;base64,${base64}`;

  } catch (err) {
    console.warn(`[Thumbnail] ${shortcode}: Frame selection failed (${err.message}). Using original thumbnail.`);
    return fallback;
  } finally {
    cleanup(videoPath);
    // Clean up all extracted frames
    for (const f of framePaths) cleanup(f);
    if (frameDir) {
      try { fs.rmdirSync(frameDir); } catch {}
    }
  }
}

/**
 * withTimeout wrapper — ensures thumbnail selection never blocks the pipeline.
 */
async function selectBestThumbnailSafe(reel, productName = '') {
  const fallback = reel.thumbnailUrl || reel.mediaUrl || '';
  try {
    return await Promise.race([
      selectBestThumbnail(reel, productName),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), SELECTION_TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    console.warn(`[Thumbnail] selectBestThumbnailSafe timed out or failed: ${err.message}`);
    return fallback;
  }
}

module.exports = { selectBestThumbnailSafe };

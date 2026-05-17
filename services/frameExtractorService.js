/**
 * frameExtractorService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Extracts a representative frame from a video URL using ffmpeg.
 * The frame is taken at ~30% into the video to get a clear product shot
 * (skips intros, blurry first frames, and fade-ins).
 *
 * Returns: { base64: string, mimeType: 'image/jpeg' } or null on failure.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');

/**
 * Check if ffmpeg is available on the system.
 */
function isFfmpegAvailable() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the duration of a video file in seconds using ffprobe.
 */
function getVideoDuration(videoFile) {
  try {
    const output = execSync(
      `ffprobe -v quiet -print_format json -show_streams "${videoFile}"`,
      { timeout: 10000, encoding: 'utf8' }
    );
    const info = JSON.parse(output);
    const stream = info.streams?.find(s => s.codec_type === 'video');
    const dur = parseFloat(stream?.duration || '0');
    return dur > 0 ? dur : null;
  } catch {
    return null;
  }
}

/**
 * Download a video from a URL to a local temp file.
 * Returns the local file path or null on failure.
 */
async function downloadVideo(videoUrl) {
  const tmpFile = path.join(os.tmpdir(), `vid_extract_${Date.now()}.mp4`);
  try {
    const response = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: 80 * 1024 * 1024, // 80 MB max
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15',
        'Referer': 'https://www.instagram.com/',
      },
    });
    fs.writeFileSync(tmpFile, Buffer.from(response.data));
    return tmpFile;
  } catch (err) {
    console.warn('[FrameExtractor] Video download failed:', err.message);
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
    return null;
  }
}

/**
 * Main export — extract a frame from a video URL.
 *
 * Strategy:
 *   1. Download the video
 *   2. Probe duration
 *   3. Extract frame at 30% into the video (good product visibility)
 *   4. If 30% fails, fall back to 2s, then 1s into the video
 *   5. Return as { base64, mimeType } for direct use in AI API calls
 *
 * @param {string} videoUrl - Direct video URL
 * @returns {{ base64: string, mimeType: string } | null}
 */
async function extractFrameFromVideo(videoUrl) {
  if (!videoUrl) return null;

  if (!isFfmpegAvailable()) {
    console.warn('[FrameExtractor] ffmpeg not available — skipping frame extraction.');
    return null;
  }

  let videoFile = null;
  let frameFile = null;

  try {
    console.log('[FrameExtractor] Downloading video for frame extraction...');
    videoFile = await downloadVideo(videoUrl);
    if (!videoFile) return null;

    frameFile = path.join(os.tmpdir(), `frame_${Date.now()}.jpg`);

    // Get duration to calculate seek point
    const duration = getVideoDuration(videoFile);
    
    // Try multiple seek points from most to least ideal
    const seekTimes = duration
      ? [
          Math.max(1, duration * 0.30).toFixed(2), // 30% in — usually a clear product shot
          Math.max(1, duration * 0.15).toFixed(2), // 15% fallback
          '1.00',                                   // 1s fallback
        ]
      : ['2.00', '1.00'];

    let frameExtracted = false;
    for (const seekTime of seekTimes) {
      try {
        execSync(
          `ffmpeg -ss ${seekTime} -i "${videoFile}" -vframes 1 -q:v 2 -vf "scale=720:-1" "${frameFile}" -y`,
          { timeout: 20000, stdio: 'pipe' }
        );
        if (fs.existsSync(frameFile) && fs.statSync(frameFile).size > 1000) {
          console.log(`[FrameExtractor] ✅ Frame extracted at ${seekTime}s (${Math.round(fs.statSync(frameFile).size / 1024)}KB)`);
          frameExtracted = true;
          break;
        }
      } catch {
        // Try next seek time
      }
    }

    if (!frameExtracted) {
      console.warn('[FrameExtractor] All seek attempts failed.');
      return null;
    }

    const buffer = fs.readFileSync(frameFile);
    const base64 = buffer.toString('base64');
    return { base64, mimeType: 'image/jpeg' };

  } catch (err) {
    console.warn('[FrameExtractor] Unexpected error:', err.message);
    return null;
  } finally {
    // Always clean up temp files
    try { if (videoFile && fs.existsSync(videoFile)) fs.unlinkSync(videoFile); } catch {}
    try { if (frameFile && fs.existsSync(frameFile)) fs.unlinkSync(frameFile); } catch {}
  }
}

module.exports = { extractFrameFromVideo, isFfmpegAvailable };

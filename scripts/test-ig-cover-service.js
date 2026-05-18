'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  getCandidateTimes,
  isSmartCoverSupported,
  prepareVideoForPinterestCover,
  scoreRawRgbFrame,
} = require('../services/igRepostCoverService');

function makeFlatFrame(width, height, rgb = [110, 110, 110]) {
  const buffer = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    buffer[i * 3] = rgb[0];
    buffer[i * 3 + 1] = rgb[1];
    buffer[i * 3 + 2] = rgb[2];
  }
  return buffer;
}

function makeProductLikeFrame(width, height) {
  const buffer = makeFlatFrame(width, height, [95, 92, 88]);

  const left = Math.floor(width * 0.27);
  const right = Math.floor(width * 0.73);
  const top = Math.floor(height * 0.28);
  const bottom = Math.floor(height * 0.72);

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const stripe = ((x + y) % 11) < 5;
      const index = (y * width + x) * 3;
      buffer[index] = stripe ? 218 : 28;
      buffer[index + 1] = stripe ? 80 : 32;
      buffer[index + 2] = stripe ? 42 : 26;
    }
  }

  return buffer;
}

function tmpFile(name) {
  return path.join(os.tmpdir(), `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp4`);
}

function cleanup(...files) {
  for (const file of files) {
    try {
      if (file && fs.existsSync(file)) fs.unlinkSync(file);
    } catch {}
  }
}

async function runFfmpegIntegrationTest() {
  if (!isSmartCoverSupported()) return { skipped: true };

  const sourceVideo = tmpFile('ig_cover_source');
  let prepared = null;

  try {
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=#777777:s=360x640:d=1.5',
      '-f', 'lavfi',
      '-i', 'color=c=#5b4e3e:s=360x640:d=2.5,drawbox=x=78:y=190:w=204:h=270:color=#d83a28:t=fill,drawbox=x=118:y=230:w=126:h=186:color=#111111:t=fill,drawbox=x=100:y=458:w=168:h=44:color=#f0d060:t=fill',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p[v]',
      '-map', '[v]',
      '-t', '4',
      sourceVideo,
    ], { stdio: 'pipe', timeout: 20000 });

    prepared = await prepareVideoForPinterestCover(sourceVideo, {
      shortcode: 'synthetic_cover_test',
      caption: 'Synthetic test: first frame is flat mat, later frame contains visible product.',
    });

    assert.strictEqual(prepared.generated, true, `Expected generated cover-first video, got ${JSON.stringify(prepared)}`);
    assert(fs.existsSync(prepared.uploadPath), 'Prepared upload video must exist.');
    assert(fs.existsSync(prepared.coverPath), 'Selected cover frame must exist.');
    assert(
      prepared.selectedFrame.seekTime >= 1.45,
      `Expected later product frame, got seek=${prepared.selectedFrame.seekTime}`
    );

    return {
      skipped: false,
      selectedSeekTime: prepared.selectedFrame.seekTime,
      generatedBytes: fs.statSync(prepared.uploadPath).size,
    };
  } finally {
    cleanup(sourceVideo, ...(prepared?.cleanupPaths || []));
  }
}

(async () => {
  const width = 96;
  const height = 160;
  const flat = scoreRawRgbFrame(makeFlatFrame(width, height), width, height);
  const product = scoreRawRgbFrame(makeProductLikeFrame(width, height), width, height);

  assert(product.score > flat.score + 40, `Expected product-like frame to beat flat mat frame. flat=${flat.score}, product=${product.score}`);

  const times = getCandidateTimes(20);
  assert(times.length >= 5, 'Expected several candidate cover times.');
  assert(times[0] > 0, 'Candidate times must not use the first frame.');
  assert(!times.includes(0), 'Candidate times must skip timestamp 0.');

  const fallback = await prepareVideoForPinterestCover('missing-file.mp4');
  assert.strictEqual(fallback.generated, false, 'Missing video should safely fallback.');
  const ffmpegIntegration = await runFfmpegIntegrationTest();

  console.log(JSON.stringify({
    ok: true,
    ffmpegAvailable: isSmartCoverSupported(),
    ffmpegIntegration,
    flatScore: Number(flat.score.toFixed(2)),
    productScore: Number(product.score.toFixed(2)),
    candidateTimes: times,
  }, null, 2));
})();

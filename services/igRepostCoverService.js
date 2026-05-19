'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const mediaTools = require('./mediaToolService');

const execFileAsync = promisify(execFile);

const FFMPEG = mediaTools.resolveFfmpegPath();
const FFPROBE = mediaTools.resolveFfprobePath();
const INTRO_SECONDS = clampNumber(Number.parseFloat(process.env.IG_REPOST_COVER_INTRO_SECONDS || '0.75'), 0.35, 1.5);
const RAW_W = 96;
const RAW_H = 160;

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function tmpFile(prefix, ext) {
  return path.join(os.tmpdir(), `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
}

function cleanupFiles(...files) {
  for (const file of files) {
    try {
      if (file && fs.existsSync(file)) fs.unlinkSync(file);
    } catch {}
  }
}

function isCommandAvailable(command, args = ['-version']) {
  try {
    execFileSync(command, args, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function isSmartCoverSupported() {
  return isCommandAvailable(FFMPEG) && isCommandAvailable(FFPROBE);
}

async function probeVideo(videoPath) {
  try {
    const { stdout } = await execFileAsync(FFPROBE, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,duration:format=duration',
      '-of', 'json',
      videoPath,
    ], { timeout: 10000, maxBuffer: 1024 * 1024 });

    const parsed = JSON.parse(stdout || '{}');
    const stream = parsed.streams?.[0] || {};
    const duration = Number.parseFloat(stream.duration || parsed.format?.duration || '0');
    const width = Number.parseInt(stream.width || '0', 10);
    const height = Number.parseInt(stream.height || '0', 10);

    return {
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
      width: Number.isFinite(width) && width > 0 ? width : 0,
      height: Number.isFinite(height) && height > 0 ? height : 0,
    };
  } catch (err) {
    console.warn('[IG Cover] ffprobe failed:', err.message);
    return { duration: 0, width: 0, height: 0 };
  }
}

function parseCandidatePercents() {
  const raw = String(process.env.IG_REPOST_COVER_SEEK_PCTS || '').trim();
  if (!raw) return [0.18, 0.28, 0.38, 0.5, 0.62, 0.74, 0.86];

  const values = raw
    .split(',')
    .map((part) => Number.parseFloat(part.trim()))
    .filter((value) => Number.isFinite(value) && value > 0 && value < 1);

  return values.length ? values : [0.18, 0.28, 0.38, 0.5, 0.62, 0.74, 0.86];
}

function uniqueSorted(values) {
  return Array.from(new Set(values.map((value) => Number(value).toFixed(2))))
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
}

function getCandidateTimes(duration) {
  if (!Number.isFinite(duration) || duration <= 0) {
    return [1, 2, 3, 4, 5];
  }

  const minimumSeek = Math.min(Math.max(0.6, duration * 0.12), Math.max(0.2, duration - 0.2));
  const maximumSeek = Math.max(0.2, duration - 0.18);
  const fromPercents = parseCandidatePercents()
    .map((percent) => duration * percent)
    .filter((seek) => seek >= minimumSeek && seek <= maximumSeek);

  const fixedFallbacks = [1, 1.5, 2, 3, 4]
    .filter((seek) => seek >= minimumSeek && seek <= maximumSeek);

  const candidates = uniqueSorted([...fromPercents, ...fixedFallbacks]);
  if (candidates.length) return candidates.slice(0, 9);

  return [Math.max(0.2, Math.min(duration * 0.5, maximumSeek))];
}

async function readRawFrame(videoPath, seekTime) {
  const scaleFilter = `scale=${RAW_W}:${RAW_H}:force_original_aspect_ratio=decrease,pad=${RAW_W}:${RAW_H}:(ow-iw)/2:(oh-ih)/2:black`;
  const { stdout } = await execFileAsync(FFMPEG, [
    '-hide_banner',
    '-loglevel', 'error',
    '-ss', String(seekTime),
    '-i', videoPath,
    '-frames:v', '1',
    '-vf', scaleFilter,
    '-pix_fmt', 'rgb24',
    '-f', 'rawvideo',
    'pipe:1',
  ], {
    encoding: 'buffer',
    timeout: 12000,
    maxBuffer: RAW_W * RAW_H * 3 + 1024,
  });

  return stdout;
}

function scoreRawRgbFrame(buffer, width = RAW_W, height = RAW_H) {
  if (!Buffer.isBuffer(buffer) || buffer.length < width * height * 3) {
    return { score: -Infinity, metrics: {} };
  }

  const lumas = new Float32Array(width * height);
  let count = 0;
  let mean = 0;
  let meanSq = 0;
  let satSum = 0;
  let centerSatSum = 0;
  let centerWeightSum = 0;
  let brightPadding = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3;
      const r = buffer[index];
      const g = buffer[index + 1];
      const b = buffer[index + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      lumas[y * width + x] = luma;

      if (luma <= 4) {
        brightPadding += 1;
        continue;
      }

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max > 0 ? (max - min) / max : 0;
      const dx = (x - (width - 1) / 2) / (width / 2);
      const dy = (y - (height - 1) / 2) / (height / 2);
      const centerWeight = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));

      count += 1;
      mean += luma;
      meanSq += luma * luma;
      satSum += saturation;
      centerSatSum += saturation * centerWeight;
      centerWeightSum += centerWeight;
    }
  }

  if (count === 0) return { score: -Infinity, metrics: {} };

  mean /= count;
  meanSq /= count;
  const variance = Math.max(0, meanSq - mean * mean);
  const contrast = Math.sqrt(variance);
  const avgSaturation = satSum / count;
  const centerSaturation = centerWeightSum > 0 ? centerSatSum / centerWeightSum : avgSaturation;

  let edge = 0;
  let centerEdge = 0;
  let edgeCount = 0;
  let centerEdgeWeight = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const current = lumas[y * width + x];
      if (current <= 4) continue;

      const diff = (
        Math.abs(current - lumas[y * width + x + 1]) +
        Math.abs(current - lumas[(y + 1) * width + x])
      ) / 2;
      const dx = (x - (width - 1) / 2) / (width / 2);
      const dy = (y - (height - 1) / 2) / (height / 2);
      const centerWeight = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));

      edge += diff;
      edgeCount += 1;
      centerEdge += diff * centerWeight;
      centerEdgeWeight += centerWeight;
    }
  }

  edge = edgeCount > 0 ? edge / edgeCount : 0;
  centerEdge = centerEdgeWeight > 0 ? centerEdge / centerEdgeWeight : edge;

  const brightnessScore = clampNumber(1 - Math.abs(mean - 118) / 118, 0, 1);
  const paddingRatio = brightPadding / (width * height);
  const centerDominance = edge > 0 ? centerEdge / edge : 1;
  const uniformPenalty = contrast < 28 ? (28 - contrast) * 1.35 : 0;
  const lowColorPenalty = avgSaturation < 0.12 ? (0.12 - avgSaturation) * 110 : 0;
  const paddingPenalty = paddingRatio > 0.18 ? paddingRatio * 38 : 0;
  const centerBonus = centerDominance > 1 ? Math.min(22, (centerDominance - 1) * 24) : -Math.min(18, (1 - centerDominance) * 24);

  const score =
    (centerEdge * 1.35) +
    (edge * 0.45) +
    (contrast * 1.1) +
    (avgSaturation * 78) +
    (centerSaturation * 46) +
    (brightnessScore * 48) +
    centerBonus -
    uniformPenalty -
    lowColorPenalty -
    paddingPenalty;

  return {
    score,
    metrics: {
      mean: Number(mean.toFixed(2)),
      contrast: Number(contrast.toFixed(2)),
      avgSaturation: Number(avgSaturation.toFixed(3)),
      centerSaturation: Number(centerSaturation.toFixed(3)),
      edge: Number(edge.toFixed(2)),
      centerEdge: Number(centerEdge.toFixed(2)),
      centerDominance: Number(centerDominance.toFixed(2)),
      paddingRatio: Number(paddingRatio.toFixed(3)),
      brightnessScore: Number(brightnessScore.toFixed(3)),
    },
  };
}

async function extractJpegFrame(videoPath, seekTime, destinationPath) {
  await execFileAsync(FFMPEG, [
    '-hide_banner',
    '-loglevel', 'error',
    '-ss', String(seekTime),
    '-i', videoPath,
    '-frames:v', '1',
    '-q:v', '2',
    destinationPath,
    '-y',
  ], { timeout: 15000, maxBuffer: 1024 * 1024 });

  if (!fs.existsSync(destinationPath) || fs.statSync(destinationPath).size < 1000) {
    throw new Error('Extracted cover frame is empty');
  }
}

async function selectBestCoverFrame(videoPath, options = {}) {
  if (!isSmartCoverSupported()) {
    return null;
  }

  const probe = await probeVideo(videoPath);
  const candidateTimes = getCandidateTimes(probe.duration);
  const candidates = [];
  const createdFrames = [];

  for (const seekTime of candidateTimes) {
    const framePath = tmpFile('ig_cover_candidate', '.jpg');
    try {
      const raw = await readRawFrame(videoPath, seekTime);
      const scored = scoreRawRgbFrame(raw);
      await extractJpegFrame(videoPath, seekTime, framePath);
      createdFrames.push(framePath);
      candidates.push({
        seekTime,
        framePath,
        score: scored.score,
        metrics: scored.metrics,
      });
    } catch (err) {
      cleanupFiles(framePath);
      console.warn(`[IG Cover] Candidate frame at ${seekTime}s failed:`, err.message);
    }
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  for (const frame of createdFrames) {
    if (frame !== best.framePath) cleanupFiles(frame);
  }

  const compactScores = candidates.slice(0, 5).map((candidate) => ({
    t: candidate.seekTime,
    score: Number(candidate.score.toFixed(1)),
    contrast: candidate.metrics.contrast,
    center: candidate.metrics.centerDominance,
    sat: candidate.metrics.avgSaturation,
  }));

  console.log(`[IG Cover] Selected product-focused cover at ${best.seekTime}s`, compactScores);

  return {
    coverPath: best.framePath,
    seekTime: best.seekTime,
    duration: probe.duration,
    score: best.score,
    metrics: best.metrics,
    preferredPosition: probe.duration > 0
      ? clampNumber((best.seekTime + INTRO_SECONDS) / (probe.duration + INTRO_SECONDS), 0, 1)
      : 0.5,
  };
}

async function createCoverFirstVideo(videoPath, coverPath, options = {}) {
  const probe = await probeVideo(videoPath);
  if (!probe.width || !probe.height) {
    throw new Error('Could not determine source video dimensions');
  }

  const outputPath = tmpFile('ig_repost_cover_first', '.mp4');
  const introSeconds = clampNumber(options.introSeconds || INTRO_SECONDS, 0.35, 1.5);
  const width = probe.width % 2 === 0 ? probe.width : probe.width - 1;
  const height = probe.height % 2 === 0 ? probe.height : probe.height - 1;
  const filter = [
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=yuv420p[v0]`,
    `[1:v]scale=${width}:${height},setsar=1,format=yuv420p,setpts=PTS-STARTPTS[v1]`,
    '[v0][v1]concat=n=2:v=1:a=0[outv]',
  ].join(';');

  try {
    await execFileAsync(FFMPEG, [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-loop', '1',
      '-t', String(introSeconds),
      '-i', coverPath,
      '-i', videoPath,
      '-filter_complex', filter,
      '-map', '[outv]',
      '-map', '1:a?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath,
    ], { timeout: 90000, maxBuffer: 1024 * 1024 });

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
      throw new Error('Cover-first video output is empty');
    }

    console.log(`[IG Cover] Created cover-first upload video (${Math.round(fs.statSync(outputPath).size / 1024)}KB).`);
    return outputPath;
  } catch (err) {
    cleanupFiles(outputPath);
    throw err;
  }
}

async function prepareVideoForPinterestCover(videoPath, options = {}) {
  if (!videoPath || !fs.existsSync(videoPath)) {
    return { uploadPath: videoPath, generated: false, reason: 'missing_video' };
  }

  if (!isSmartCoverSupported()) {
    console.warn('[IG Cover] ffmpeg/ffprobe unavailable; uploading original video.');
    return { uploadPath: videoPath, generated: false, reason: 'ffmpeg_unavailable' };
  }

  let selected = null;
  let generatedVideoPath = '';

  try {
    selected = await selectBestCoverFrame(videoPath, options);
    if (!selected?.coverPath) {
      return { uploadPath: videoPath, generated: false, reason: 'no_cover_frame' };
    }

    generatedVideoPath = await createCoverFirstVideo(videoPath, selected.coverPath, options);
    return {
      uploadPath: generatedVideoPath,
      generated: true,
      coverPath: selected.coverPath,
      generatedVideoPath,
      selectedFrame: selected,
      preferredPosition: selected.preferredPosition,
      cleanupPaths: [generatedVideoPath, selected.coverPath],
    };
  } catch (err) {
    console.warn('[IG Cover] Smart cover preparation failed; uploading original video:', err.message);
    cleanupFiles(generatedVideoPath, selected?.coverPath);
    return { uploadPath: videoPath, generated: false, reason: err.message };
  }
}

module.exports = {
  cleanupFiles,
  createCoverFirstVideo,
  getCandidateTimes,
  isSmartCoverSupported,
  prepareVideoForPinterestCover,
  scoreRawRgbFrame,
  selectBestCoverFrame,
};

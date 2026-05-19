'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function tryRequire(name) {
  try {
    return require(name);
  } catch {
    return null;
  }
}

function resolveFfmpegPath() {
  return process.env.FFMPEG_PATH || tryRequire('ffmpeg-static') || 'ffmpeg';
}

function resolveFfprobePath() {
  const ffprobeStatic = tryRequire('ffprobe-static');
  return process.env.FFPROBE_PATH || ffprobeStatic?.path || 'ffprobe';
}

function commandExists(command, args = ['-version']) {
  try {
    execFileSync(command, args, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function isFfmpegAvailable() {
  return commandExists(resolveFfmpegPath());
}

function isFfprobeAvailable() {
  return commandExists(resolveFfprobePath());
}

function isVideoPath(value = '') {
  return /\.(mp4|mov|webm|m4v)(\?.*)?$/i.test(String(value || ''));
}

function isImagePath(value = '') {
  return /\.(jpe?g|png|webp)(\?.*)?$/i.test(String(value || ''));
}

function getBundledFontPath() {
  const candidates = [
    process.env.AUTO_EDITOR_FONT_PATH,
    'C:\\Windows\\Fonts\\arialbd.ttf',
    'C:\\Windows\\Fonts\\arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/Library/Fonts/Arial Bold.ttf',
  ].filter(Boolean);

  return candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  }) || '';
}

function escapeFilterPath(filePath = '') {
  const clean = path.resolve(filePath).replace(/\\/g, '/');
  return clean.replace(/^([A-Za-z]):/, '$1\\:').replace(/'/g, "\\'");
}

async function probeVideo(filePath) {
  const ffprobe = resolveFfprobePath();
  if (!filePath || !isFfprobeAvailable()) {
    return { duration: 0, width: 0, height: 0, hasAudio: false };
  }

  try {
    const { stdout } = await execFileAsync(ffprobe, [
      '-v', 'error',
      '-show_streams',
      '-show_format',
      '-of', 'json',
      filePath,
    ], { timeout: 10000, maxBuffer: 1024 * 1024 });

    const parsed = JSON.parse(stdout || '{}');
    const videoStream = parsed.streams?.find((stream) => stream.codec_type === 'video') || {};
    const audioStream = parsed.streams?.find((stream) => stream.codec_type === 'audio') || null;
    const duration = Number.parseFloat(videoStream.duration || parsed.format?.duration || '0');
    const width = Number.parseInt(videoStream.width || '0', 10);
    const height = Number.parseInt(videoStream.height || '0', 10);

    return {
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
      width: Number.isFinite(width) && width > 0 ? width : 0,
      height: Number.isFinite(height) && height > 0 ? height : 0,
      hasAudio: !!audioStream,
    };
  } catch {
    return { duration: 0, width: 0, height: 0, hasAudio: false };
  }
}

module.exports = {
  execFileAsync,
  resolveFfmpegPath,
  resolveFfprobePath,
  isFfmpegAvailable,
  isFfprobeAvailable,
  isVideoPath,
  isImagePath,
  getBundledFontPath,
  escapeFilterPath,
  probeVideo,
};

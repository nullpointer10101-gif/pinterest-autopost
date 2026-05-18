'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_SERVERLESS = !!(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.NETLIFY
);

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const USE_UPSTASH = !!(UPSTASH_URL && UPSTASH_TOKEN);

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'undefined' || value === null || value === '') return fallback;

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

const EXTERNAL_STATE_ONLY = parseBoolean(process.env.EXTERNAL_STATE_ONLY, USE_UPSTASH);
const LOCAL_STATE_ENABLED = !USE_UPSTASH || !EXTERNAL_STATE_ONLY;
const LOCAL_DEBUG_ARTIFACTS_ENABLED = parseBoolean(process.env.ENABLE_LOCAL_DEBUG_ARTIFACTS, false);

function getDataDir() {
  return IS_SERVERLESS
    ? path.join(os.tmpdir(), 'pinterest-autoposter')
    : path.join(__dirname, '..', 'data');
}

function getStateFilePath(filename) {
  return path.join(getDataDir(), filename);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureParentDir(filePath) {
  ensureDir(path.dirname(filePath));
}

function isExternalStateOnly() {
  return USE_UPSTASH && EXTERNAL_STATE_ONLY;
}

function isLocalStateEnabled() {
  return LOCAL_STATE_ENABLED;
}

function canWriteLocalDebugArtifacts() {
  return LOCAL_DEBUG_ARTIFACTS_ENABLED;
}

function getStorageMode() {
  return USE_UPSTASH ? 'upstash' : (IS_SERVERLESS ? 'local-ephemeral' : 'local-file');
}

module.exports = {
  IS_SERVERLESS,
  UPSTASH_URL,
  UPSTASH_TOKEN,
  USE_UPSTASH,
  canWriteLocalDebugArtifacts,
  ensureDir,
  ensureParentDir,
  getDataDir,
  getStateFilePath,
  getStorageMode,
  isExternalStateOnly,
  isLocalStateEnabled,
  parseBoolean,
};

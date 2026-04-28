const path = require('path');
const queueService = require('../services/queueService');

let puppeteerService = null;
try {
  puppeteerService = require('../services/puppeteerService');
} catch (e) {
  // Suppress warning in utils
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);

function getRedirectUri(req) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${protocol}://${host}/auth/callback`;
}

function resolvePostingMode() {
  // Always GitHub Bot mode — no API posting
  return {
    configuredMode: 'bot',
    resolvedMode: 'bot',
    useBrowserBot: true,
  };
}

module.exports = {
  IS_PRODUCTION,
  IS_SERVERLESS,
  getRedirectUri,
  resolvePostingMode,
  puppeteerService
};

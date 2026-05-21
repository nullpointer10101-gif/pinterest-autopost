const DEFAULT_BLOCKED_KEYWORDS = [
  'python',
  'programming',
  'programmer',
  'coding',
  'code',
  'software',
  'development',
  'developer',
  'computer',
  'tech',
  'javascript',
  'typescript',
  'java',
  'react',
  'html',
  'css',
  'web dev',
  'dev',
  'devops',
  'django',
  'linux',
  'github',
  'terminal',
  'database',
  'algorithm',
  'data science',
  'ai tools',
  'aitools',
  'chatgpt',
  'prompt',
  'prompts',
  'artificial intelligence',
  'tutorial',
  'scripting',
  'electronics',
  'math',
  'epidemiology',
  'notion',
  'bash',
  'ajax',
  'jquery',
  'php',
  'mysql',
  'bootstrap',
  'qa engineer',
  'informatica',
  'computacion',
  'computación',
  'matrix',
  'programacion',
  'programação',
  'programowanie',
  'yazilim',
  'yazılım',
];

function splitKeywords(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getBlockedKeywords() {
  const custom = splitKeywords(process.env.PINTEREST_IMAGE_BLOCKED_KEYWORDS);
  return custom.length > 0 ? custom : DEFAULT_BLOCKED_KEYWORDS;
}

function getAllowedKeywords() {
  return splitKeywords(process.env.PINTEREST_IMAGE_ALLOWED_KEYWORDS);
}

function requiresAllowedKeyword() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.PINTEREST_IMAGE_REQUIRE_ALLOWED_KEYWORD || '').toLowerCase());
}

function pinSearchText(pin = {}) {
  return normalizeText([
    pin.boardName,
    pin.title,
    pin.description,
    pin.altText,
    pin.link,
    pin.originalLink,
  ].filter(Boolean).join(' '));
}

function hasKeyword(text, keyword) {
  const cleanKeyword = normalizeText(keyword);
  if (!cleanKeyword) return false;
  return text.includes(cleanKeyword);
}

function evaluatePin(pin = {}) {
  const text = pinSearchText(pin);
  const blockedKeyword = getBlockedKeywords().find((keyword) => hasKeyword(text, keyword));
  if (blockedKeyword) {
    return {
      eligible: false,
      reason: 'blocked_keyword',
      keyword: blockedKeyword,
    };
  }

  const allowed = getAllowedKeywords();
  if (requiresAllowedKeyword() && allowed.length > 0) {
    const allowedKeyword = allowed.find((keyword) => hasKeyword(text, keyword));
    if (!allowedKeyword) {
      return {
        eligible: false,
        reason: 'missing_allowed_keyword',
      };
    }
  }

  return {
    eligible: true,
    reason: '',
  };
}

function filterPins(pins = []) {
  const eligible = [];
  const skipped = [];

  for (const pin of Array.isArray(pins) ? pins : []) {
    const result = evaluatePin(pin);
    if (result.eligible) {
      eligible.push(pin);
    } else {
      skipped.push({
        pinId: pin?.pinId || pin?.sourcePinId || '',
        boardName: pin?.boardName || '',
        reason: result.reason,
        keyword: result.keyword || '',
      });
    }
  }

  return { eligible, skipped };
}

module.exports = {
  evaluatePin,
  filterPins,
  pinSearchText,
};

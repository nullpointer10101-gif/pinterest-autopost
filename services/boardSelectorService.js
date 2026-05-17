'use strict';

/**
 * boardSelectorService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Maps identified product types to the user's saved Pinterest boards.
 *
 * Board names must EXACTLY match what appears on Pinterest (case-insensitive
 * matching is handled in puppeteerService, but keep them accurate).
 *
 * DEFAULT_BOARD: Used when no specific match is found. Set to null to post
 * without selecting a board (Pinterest picks the last used board).
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Your saved boards ─────────────────────────────────────────────────────────
const DEFAULT_BOARD = null; // null = let Pinterest decide (no forced selection)

const BOARD_MAP = [
  {
    board: 'My Watch Collection',
    keywords: ['watch', 'watches', 'wristwatch', 'smartwatch', 'analog watch', 'timepiece', 'chronograph'],
    categories: [],
  },
  {
    board: 'My SHOE Collection',
    keywords: ['shoe', 'shoes', 'sneaker', 'sneakers', 'boots', 'loafer', 'sandal', 'sandals', 'footwear', 'slipper', 'heels', 'chappal'],
    categories: ['shoes', 'footwear'],
  },
  {
    board: 'My SHIRT Collection',
    keywords: ['shirt', 'shirts', 'polo shirt', 'dress shirt', 'formal shirt', 'check shirt', 'flannel', 'button up', 'button down', 'overshirt'],
    categories: ['shirt'],
  },
  {
    board: 'my TSHIRT collection',
    keywords: ['t-shirt', 'tshirt', 't shirt', 'tee', 'graphic tee', 'oversized tee', 'round neck', 'crew neck', 'half sleeve'],
    categories: ['tshirt', 't-shirt'],
  },
  {
    board: 'My TROUSER collection',
    keywords: ['trouser', 'trousers', 'chino', 'chinos', 'formal pant', 'formal pants', 'slim fit pant', 'tailored pant'],
    categories: ['trouser', 'trousers'],
  },
  {
    board: 'My PANT Collection',
    keywords: ['pant', 'pants', 'jeans', 'denim', 'jogger', 'joggers', 'cargo pant', 'cargo pants', 'track pant', 'sweatpant', 'corduroy pant', 'corduroy pants', 'baggy pant', 'wide leg pant', 'palazzo'],
    categories: ['pants', 'jeans', 'denim'],
  },
  {
    board: 'my jersey collection',
    keywords: ['jersey', 'jerseys', 'sports jersey', 'football jersey', 'basketball jersey', 'cricket jersey', 'team jersey', 'sports wear', 'sportswear', 'athletic wear'],
    categories: ['jersey', 'sportswear'],
  },
];

// ── Matching Logic ────────────────────────────────────────────────────────────

/**
 * Pick the best Pinterest board for the identified product.
 *
 * @param {object} productInfo - Output from identifyProduct or identifyOutfit:
 *   { productName, exactMatchQuery, category, outfitName, items }
 * @returns {string|null} - Exact board name to select, or null for default
 */
function selectBoard(productInfo) {
  if (!productInfo) return DEFAULT_BOARD;

  // Gather all text signals we have
  const signals = [
    productInfo.productName || '',
    productInfo.exactMatchQuery || '',
    productInfo.similarMatchQuery || '',
    productInfo.broadMatchQuery || '',
    productInfo.category || '',
    productInfo.outfitName || '',
    productInfo.titleSignal || '',    // AI-generated pin title is also a good signal
    // Also check main item from outfit array
    ...(productInfo.items || []).filter(i => i.type === 'main').map(i => i.query || ''),
    // All outfit items contribute
    ...(productInfo.items || []).map(i => i.query || ''),
  ].join(' ').toLowerCase();

  if (!signals.trim()) {
    console.log('[BoardSelector] ⚠️ No signals found in productInfo — cannot match board.');
    return DEFAULT_BOARD;
  }

  console.log(`[BoardSelector] Signals: "${signals.substring(0, 200)}..."`);

  // Score each board by how many of its keywords appear in the signals
  let bestBoard = null;
  let bestScore = 0;

  for (const entry of BOARD_MAP) {
    let score = 0;
    for (const kw of entry.keywords) {
      if (signals.includes(kw.toLowerCase())) {
        // Longer keyword matches get higher score (more specific = better)
        score += kw.split(' ').length;
      }
    }
    for (const cat of entry.categories) {
      if (signals.includes(cat.toLowerCase())) {
        score += 2;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestBoard = entry.board;
    }
  }

  if (bestBoard) {
    console.log(`[BoardSelector] ✅ Matched board: "${bestBoard}" (score: ${bestScore})`);
    return bestBoard;
  }

  console.log(`[BoardSelector] ℹ️ No board matched (best score was 0) — using default`);
  return DEFAULT_BOARD;
}

module.exports = { selectBoard, BOARD_MAP, DEFAULT_BOARD };

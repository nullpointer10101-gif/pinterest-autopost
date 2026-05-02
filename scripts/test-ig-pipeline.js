/**
 * Test script: runs the FULL affiliate pipeline for 1 new reel per channel.
 * Bypasses the seen-dedup so we can test without waiting for new uploads.
 * Does NOT mark reels as seen, so the real tracker still picks them up normally.
 */
require('dotenv').config();
const igTrackerService = require('../services/igTrackerService');
const aiService = require('../services/aiService');
const flipkartSearchService = require('../services/flipkartSearchService');
const earnKaroService = require('../services/earnKaroService');
const queueService = require('../services/queueService');

const CHANNELS = ['vishu_rajput_22'];

async function processReel(reel) {
  console.log('\n' + '='.repeat(60));
  console.log('Channel  : @' + reel.username);
  console.log('Shortcode: ' + reel.shortcode);
  console.log('Type     : ' + reel.mediaType);
  console.log('Caption  : ' + (reel.caption || '').substring(0, 100) + '...');
  console.log('='.repeat(60));

  let affiliateUrl = null;
  let productName = null;
  let flipkartUrl = null;

  // Step 1: AI product identification
  console.log('\n[1] AI product identification...');
  let productResult = await aiService.identifyProduct({
    caption: reel.caption || '',
    username: reel.username,
  if (productResult.found) {
    productName = productResult.productName;
    console.log('    ✅ Product: "' + productName + '" (' + productResult.category + ')');
    console.log('    Exact query: "' + productResult.exactMatchQuery + '"');

    // Step 2: Search on Flipkart
    console.log('\n[2] Searching Flipkart...');
    const fp = await flipkartSearchService.findProduct(
      productResult,
      productResult.productName
    );
    if (fp) {
      flipkartUrl = fp.url;
      console.log('    ✅ Found: "' + fp.title + '"');
      console.log('    URL: ' + flipkartUrl);

      // Step 3: EarnKaro affiliate link
      console.log('\n[3] Generating EarnKaro affiliate link...');
      const ekResult = await earnKaroService.makeAffiliateLink(flipkartUrl);
      affiliateUrl = ekResult.affiliateUrl;
      console.log('    Source : ' + ekResult.source);
      console.log('    Link   : ' + affiliateUrl);
    } else {
      console.log('    ⚠️  No Flipkart match. Posting without affiliate link.');
    }
  } else {
    console.log('    ℹ️  No shoppable product detected. Posting as standard Pin.');
  }

  // Step 4: Generate Pinterest caption
  console.log('\n[4] Generating Pinterest caption...');
  const captionForAI = [
    reel.caption || '',
    affiliateUrl ? '\n\n🛒 Shop this look: ' + affiliateUrl : '',
  ].join('').trim();

  const pinContent = await aiService.generatePinterestContent({
    caption: captionForAI,
    username: reel.username,
    mediaType: reel.mediaType || 'video',
  });

  let finalDescription = pinContent.description;
  if (affiliateUrl) {
    finalDescription = (finalDescription + '\n\n🛒 Buy it here → ' + affiliateUrl).substring(0, 800);
  }

  console.log('    Title      : ' + pinContent.title);
  console.log('    Description: ' + finalDescription.substring(0, 100) + '...');

  // Step 5: Add to queue
  console.log('\n[5] Adding to Pinterest queue...');
  await queueService.addToQueue([{
    sourceUrl: affiliateUrl || '',
    caption: reel.caption || '',
    username: reel.username,
    thumbnailUrl: reel.thumbnailUrl || reel.mediaUrl,
    mediaUrl: reel.mediaUrl,
    title: pinContent.title,
    description: finalDescription,
    aiContent: {
      title: pinContent.title,
      description: finalDescription,
      hashtags: pinContent.hashtags || [],
    },
    tags: {
      channel: reel.username,
      shortcode: reel.shortcode + '_retry', // Bypass deduplicator to forcefully republish
      hasAffiliate: !!affiliateUrl,
      product: productName || null,
      flipkartUrl: flipkartUrl || null,
      testRun: true,
    },
  }]);

  console.log('\n✅ QUEUED SUCCESSFULLY!');
  console.log('   Affiliate link: ' + (affiliateUrl ? affiliateUrl : 'NONE (standard pin)'));
  return { shortcode: reel.shortcode, affiliateUrl, productName };
}

async function main() {
  console.log('\n🚀 IG AFFILIATE PIPELINE — TEST RUN (1 reel per channel)');
  console.log('Time: ' + new Date().toISOString() + '\n');

  for (const username of CHANNELS) {
    console.log('\n📥 Fetching reels for @' + username + '...');
    const reels = await igTrackerService.fetchLatestReels(username);

    // Pick the first 2 non-pinned reels
    const targetReels = reels.filter(r => !r.isPinned).slice(0, 2);
    if (targetReels.length === 0) {
      console.log('⚠️  No non-pinned reels found for @' + username);
      continue;
    }

    for (const reel of targetReels) {
      try {
        // Sleep to avoid AI rate limits
        await new Promise(r => setTimeout(r, 10000));
        await processReel(reel);
      } catch (err) {
        console.error('❌ Failed for @' + username + ':', err.message);
      }
    }
  }

  console.log('\n\n🎉 Test run complete! Check your Pinterest queue to see the new pins.');
  console.log('Dashboard: http://localhost:3000\n');
}

main().catch(console.error);

require('dotenv').config();
const igTrackerService = require('../services/igTrackerService');
const aiService = require('../services/aiService');
const flipkartSearchService = require('../services/flipkartSearchService');
const earnKaroService = require('../services/earnKaroService');
const queueService = require('../services/queueService');
const historyService = require('../services/historyService');
const puppeteerService = require('../services/puppeteerService');

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * IG-to-Pinterest Affiliate Pipeline v2
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Algorithm:
 * 1. Scan all tracked IG channels for new (unseen) video reels
 * 2. Triple-layer dedup: queue + history + seen list
 * 3. For each passing reel:
 *    a. AI identifies product → Flipkart search → EarnKaro affiliate link
 *    b. AI generates Pinterest SEO title + description
 *    c. Post DIRECTLY to Pinterest via Puppeteer bot
 * 4. Never posts the same reel twice
 * 5. Always includes affiliate/product links when available
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

async function runIgPinterestPipeline() {
  console.log('════════════════════════════════════════════════════════');
  console.log(`[Pipeline] IG-to-Pinterest Affiliate Pipeline v2`);
  console.log(`[Pipeline] Start: ${new Date().toISOString()}`);
  console.log('════════════════════════════════════════════════════════');

  const results = {
    scanned: 0,
    withProduct: 0,
    posted: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: Scan all channels for new reels
    // ═══════════════════════════════════════════════════════════════════
    const newReels = await igTrackerService.scanForNewReels();
    results.scanned = newReels.length;

    if (newReels.length === 0) {
      console.log('[Pipeline] No new reels found across all channels. Exiting.');
      console.log('════════════════════════════════════════════════════════\n');
      process.exit(0);
    }

    console.log(`\n[Pipeline] Found ${newReels.length} new reel(s) to process.\n`);

    // ═══════════════════════════════════════════════════════════════════
    // PRE-FLIGHT: Build dedup sets for O(1) lookup
    // ═══════════════════════════════════════════════════════════════════
    const existingQueue = await queueService.getQueue();
    const postHistory = await historyService.getAll();
    
    const queueShortcodes = new Set();
    const queueMediaUrls = new Set();
    for (const item of existingQueue) {
      const sc = queueService.extractShortcode(item);
      if (sc) queueShortcodes.add(sc);
      if (item.mediaUrl) queueMediaUrls.add(item.mediaUrl);
    }
    
    const postedShortcodes = new Set();
    for (const post of postHistory) {
      if (post.reelData?.shortcode) postedShortcodes.add(post.reelData.shortcode);
      if (post.url) {
        const match = post.url.match(/\/(reel|p|tv)\/([A-Za-z0-9_-]+)/);
        if (match) postedShortcodes.add(match[2]);
      }
    }
    
    console.log(`[Pipeline] Dedup: ${queueShortcodes.size} in queue, ${postedShortcodes.size} in history\n`);

    for (const reel of newReels) {
      console.log(`\n──── Reel: ${reel.shortcode} from @${reel.username} ────`);
      console.log(`  URL: ${reel.url}`);
      console.log(`  Caption: ${(reel.caption || '').substring(0, 100)}...`);

      try {
        // ═══════════════════════════════════════════════════════════════
        // TRIPLE-LAYER DEDUP
        // ═══════════════════════════════════════════════════════════════
        
        // Layer 1: Queue dedup
        if (reel.shortcode && queueShortcodes.has(reel.shortcode)) {
          console.log(`  ⛔ SKIP: Already in queue`);
          await igTrackerService.markReelAsSeen(reel.username, reel.shortcode);
          results.skipped++;
          continue;
        }
        
        // Layer 2: History dedup
        if (reel.shortcode && postedShortcodes.has(reel.shortcode)) {
          console.log(`  ⛔ SKIP: Already posted to Pinterest`);
          await igTrackerService.markReelAsSeen(reel.username, reel.shortcode);
          results.skipped++;
          continue;
        }
        
        // Layer 3: Media URL dedup
        if (reel.mediaUrl && queueMediaUrls.has(reel.mediaUrl)) {
          console.log(`  ⛔ SKIP: Same media URL already in queue`);
          await igTrackerService.markReelAsSeen(reel.username, reel.shortcode);
          results.skipped++;
          continue;
        }

        console.log(`  ✅ Passed dedup. Processing...`);

        // ═══════════════════════════════════════════════════════════════
        // STEP 2: Check affiliate cache first
        // ═══════════════════════════════════════════════════════════════
        let affiliateUrl = await igTrackerService.getCachedAffiliateLink(reel.shortcode);
        let productName = null;

        if (affiliateUrl) {
          console.log(`  [Cache HIT] Affiliate: ${affiliateUrl}`);
        } else {
          // ═══════════════════════════════════════════════════════════════
          // STEP 3: AI Product Identification
          // ═══════════════════════════════════════════════════════════════
          const productResult = await aiService.identifyProduct({
            caption: reel.caption || '',
            username: reel.username,
            thumbnailUrl: reel.thumbnailUrl || reel.mediaUrl
          });

          if (productResult.found) {
            results.withProduct++;
            productName = productResult.productName;
            console.log(`  🎯 Product: "${productName}" (${productResult.category})`);
            console.log(`  🔍 Exact Query: "${productResult.exactMatchQuery}"`);

            // ═══════════════════════════════════════════════════════════════
            // STEP 4: Flipkart Search
            // ═══════════════════════════════════════════════════════════════
            const flipkartProduct = await flipkartSearchService.findProduct(
              productResult,
              productResult.productName
            );

            if (flipkartProduct) {
              console.log(`  🛒 Flipkart: "${flipkartProduct.title}"`);

              // ═══════════════════════════════════════════════════════════════
              // STEP 5: EarnKaro Affiliate Link
              // ═══════════════════════════════════════════════════════════════
              const ekResult = await earnKaroService.makeAffiliateLink(flipkartProduct.url);
              affiliateUrl = ekResult.affiliateUrl;
              console.log(`  🔗 Affiliate (${ekResult.source}): ${affiliateUrl}`);

              // Cache for future use
              await igTrackerService.setCachedAffiliateLink(reel.shortcode, affiliateUrl);
            } else {
              console.log('  ⚠️ No Flipkart match. Posting without affiliate link.');
            }
          } else {
            console.log('  ℹ️ No shoppable product detected. Standard Pin.');
          }
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 6: Generate Pinterest Content
        // ═══════════════════════════════════════════════════════════════
        const captionForAI = [
          reel.caption || '',
          affiliateUrl ? `\n\n🛒 Shop this look: ${affiliateUrl}` : '',
        ].join('').trim();

        const pinContent = await aiService.generatePinterestContent({
          caption: captionForAI,
          username: reel.username,
          mediaType: reel.mediaType || 'video',
        });

        // Build final description with affiliate CTA
        let finalDescription = pinContent.description;
        if (affiliateUrl) {
          finalDescription = `${finalDescription}\n\n🛒 Buy it here → ${affiliateUrl}`.substring(0, 800);
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 7: POST DIRECTLY TO PINTEREST
        // CRITICAL: link field = affiliate URL (NOT the Instagram URL)
        // ═══════════════════════════════════════════════════════════════
        console.log(`  🚀 Posting to Pinterest...`);
        console.log(`  📌 Title: "${pinContent.title}"`);
        console.log(`  🔗 Destination Link: ${affiliateUrl || '(none)'}`);
        
        const pinData = {
          title: pinContent.title,
          description: finalDescription,
          alt_text: `${productName ? `Product: ${productName}` : 'Showcased item'} from @${reel.username}`,
          // CRITICAL: This is what gets typed into Pinterest's "destination link" field
          // Must be the affiliate link, NOT the Instagram reel URL
          link: affiliateUrl || '',
          media_source: { url: reel.mediaUrl },
        };

        try {
          const postResult = await puppeteerService.createPinWithBot(pinData);
          console.log(`  ✅ POSTED! ${postResult?.pin?.url || 'Live'}`);
          
          // Record in history with shortcode for future dedup
          await historyService.add({
            url: reel.url,
            reelData: {
              username: reel.username,
              caption: reel.caption || '',
              thumbnailUrl: reel.thumbnailUrl || reel.mediaUrl,
              mediaType: 'video',
              shortcode: reel.shortcode,
            },
            aiContent: {
              title: pinContent.title,
              description: finalDescription,
              hashtags: pinContent.hashtags || [],
            },
            affiliateLink: affiliateUrl || null,
            pinterestPin: {
              id: postResult?.pin?.id || `pin_${Date.now()}`,
              url: postResult?.pin?.url || '#',
              method: 'browser_bot',
            },
            status: 'success',
            postedAt: new Date().toISOString(),
          });
          
          // Mark as seen AFTER successful post
          await igTrackerService.markReelAsSeen(reel.username, reel.shortcode);
          
          // Update dedup sets
          postedShortcodes.add(reel.shortcode);
          if (reel.mediaUrl) queueMediaUrls.add(reel.mediaUrl);
          
          results.posted++;
          console.log(`  ✅ Complete! Affiliate: ${affiliateUrl ? 'YES ✓' : 'NO'}`);
        } catch (postErr) {
          console.error(`  ❌ Post failed: ${postErr.message}`);
          results.errors.push({ shortcode: reel.shortcode, error: postErr.message });
          results.skipped++;
        }
        

      } catch (reelErr) {
        console.error(`  ❌ Processing failed: ${reelErr.message}`);
        results.errors.push({ shortcode: reel.shortcode, error: reelErr.message });
        results.skipped++;
      }
    }
  } catch (err) {
    console.error('\n[Pipeline] Fatal error:', err.message);
    results.errors.push({ shortcode: 'fatal', error: err.message });
  }

  console.log('\n════════════════════════════════════════════════════════');
  console.log('[Pipeline] SUMMARY');
  console.log(`  Reels scanned:     ${results.scanned}`);
  console.log(`  Products found:    ${results.withProduct}`);
  console.log(`  Pins posted:       ${results.posted}`);
  console.log(`  Skipped (dedup):   ${results.skipped}`);
  if (results.errors.length > 0) {
    console.log(`  Errors: ${JSON.stringify(results.errors)}`);
  }
  console.log('════════════════════════════════════════════════════════\n');

  process.exit(results.errors.some(e => e.shortcode === 'fatal') ? 1 : 0);
}

runIgPinterestPipeline();

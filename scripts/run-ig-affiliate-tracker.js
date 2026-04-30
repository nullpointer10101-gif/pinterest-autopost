require('dotenv').config();
const igTrackerService = require('../services/igTrackerService');
const aiService = require('../services/aiService');
const flipkartSearchService = require('../services/flipkartSearchService');
const earnKaroService = require('../services/earnKaroService');
const queueService = require('../services/queueService');

async function runIgAffiliateTracker() {
  console.log('====================================================');
  console.log(`[IG-Tracker] Start: ${new Date().toISOString()}`);
  console.log('====================================================');

  const results = {
    scanned: 0,
    withProduct: 0,
    queued: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // Step 1: Scan all channels for new reels
    const newReels = await igTrackerService.scanForNewReels();
    results.scanned = newReels.length;

    if (newReels.length === 0) {
      console.log('[IG-Tracker] No new reels found. Exiting.');
      console.log('====================================================\n');
      process.exit(0);
    }

    console.log(`\n[IG-Tracker] Processing ${newReels.length} new reel(s)...\n`);

    for (const reel of newReels) {
      console.log(`\n--- Processing reel: ${reel.url} ---`);
      console.log(`  Channel: @${reel.username}`);
      console.log(`  Caption: ${(reel.caption || '').substring(0, 100)}...`);

      try {
        // Step 2: Check affiliate cache first
        let affiliateUrl = await igTrackerService.getCachedAffiliateLink(reel.shortcode);
        let productName = null;
        let flipkartUrl = null;

        if (affiliateUrl) {
          console.log(`  [Cache HIT] Using cached affiliate link: ${affiliateUrl}`);
        } else {
          // Step 3: AI product identification
          const productResult = await aiService.identifyProduct({
            caption: reel.caption || '',
            username: reel.username,
          });

          if (productResult.found) {
            results.withProduct++;
            productName = productResult.productName;
            console.log(`  [AI] Product identified: "${productName}" (${productResult.category})`);
            console.log(`  [AI] Flipkart query: "${productResult.flipkartQuery}"`);

            // Step 4: Find on Flipkart
            const flipkartProduct = await flipkartSearchService.findProduct(
              productResult.flipkartQuery,
              productResult.category
            );

            if (flipkartProduct) {
              flipkartUrl = flipkartProduct.url;
              console.log(`  [Flipkart] Found: "${flipkartProduct.title}"`);
              console.log(`  [Flipkart] URL: ${flipkartUrl}`);

              // Step 5: Convert to EarnKaro affiliate link
              const ekResult = await earnKaroService.makeAffiliateLink(flipkartUrl);
              affiliateUrl = ekResult.affiliateUrl;
              console.log(`  [EarnKaro] Source: ${ekResult.source}`);
              console.log(`  [EarnKaro] Affiliate: ${affiliateUrl}`);

              // Cache for future use
              await igTrackerService.setCachedAffiliateLink(reel.shortcode, affiliateUrl);
            } else {
              console.log('  [Flipkart] No product match found. Posting without affiliate link.');
            }
          } else {
            console.log('  [AI] No shoppable product detected. Posting as standard Pin.');
          }
        }

        // Step 6: Generate Pinterest caption using existing AI system
        // Append affiliate CTA to caption so the AI can incorporate it
        const captionForAI = [
          reel.caption || '',
          affiliateUrl ? `\n\n🛒 Shop this look: ${affiliateUrl}` : '',
        ].join('').trim();

        const pinContent = await aiService.generatePinterestContent({
          caption: captionForAI,
          username: reel.username,
          mediaType: reel.mediaType || 'video',
        });

        // Inject affiliate link clearly at end of description
        let finalDescription = pinContent.description;
        if (affiliateUrl) {
          finalDescription = `${finalDescription}\n\n🛒 Buy it here → ${affiliateUrl}`.substring(0, 800);
        }

        // Step 7: Queue the pin
        await queueService.addToQueue([{
          sourceUrl: reel.url,
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
          // link field = the Pin "source URL" that Pinterest shows
          sourceUrl: affiliateUrl || reel.url,
          tags: {
            channel: reel.username,
            shortcode: reel.shortcode,
            hasAffiliate: !!affiliateUrl,
            product: productName || null,
            flipkartUrl: flipkartUrl || null,
          },
        }]);

        results.queued++;
        console.log(`  ✅ Queued successfully! Affiliate: ${affiliateUrl ? 'YES' : 'NO'}`);
      } catch (reelErr) {
        console.error(`  ❌ Failed to process reel ${reel.shortcode}: ${reelErr.message}`);
        results.errors.push({ shortcode: reel.shortcode, error: reelErr.message });
        results.skipped++;
      }
    }
  } catch (err) {
    console.error('\n[IG-Tracker] Fatal error:', err.message);
    results.errors.push({ shortcode: 'fatal', error: err.message });
  }

  console.log('\n====================================================');
  console.log('[IG-Tracker] SUMMARY');
  console.log(`  Reels scanned:   ${results.scanned}`);
  console.log(`  Products found:  ${results.withProduct}`);
  console.log(`  Pins queued:     ${results.queued}`);
  console.log(`  Skipped/errors:  ${results.skipped}`);
  if (results.errors.length > 0) {
    console.log(`  Errors: ${JSON.stringify(results.errors)}`);
  }
  console.log('====================================================\n');

  process.exit(results.errors.some(e => e.shortcode === 'fatal') ? 1 : 0);
}

runIgAffiliateTracker();

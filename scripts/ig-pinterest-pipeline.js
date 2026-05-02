require('dotenv').config();
const igTrackerService = require('../services/igTrackerService');
const aiService = require('../services/aiService');
const flipkartSearchService = require('../services/flipkartSearchService');
const earnKaroService = require('../services/earnKaroService');
const queueService = require('../services/queueService');
const puppeteerService = require('../services/puppeteerService');

async function runIgPinterestPipeline() {
  console.log('====================================================');
  console.log(`[IG-Pinterest-Pipeline] Start: ${new Date().toISOString()}`);
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
        // Step 1.5: Check if this shortcode is already in the queue to prevent duplicates
        const currentQueue = await queueService.getQueue();
        const isAlreadyQueued = currentQueue.some(item => item.tags && item.tags.shortcode === reel.shortcode);
        if (isAlreadyQueued) {
          console.log(`  [Skip] Reel ${reel.shortcode} is already in the queue. Marking as seen.`);
          await igTrackerService.markReelAsSeen(reel.username, reel.shortcode);
          continue;
        }

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
            thumbnailUrl: reel.thumbnailUrl || reel.mediaUrl
          });

          if (productResult.found) {
            results.withProduct++;
            productName = productResult.productName;
            console.log(`  [AI] Product identified: "${productName}" (${productResult.category})`);
            console.log(`  [AI] Exact Query: "${productResult.exactMatchQuery}"`);

            // Step 4: Find on Flipkart using precise visual query, falling back to generalized query
            console.log('\n[2] Searching Flipkart...');
            const flipkartProduct = await flipkartSearchService.findProduct(
              productResult,
              productResult.productName
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

        // Step 7: POST DIRECTLY TO PINTEREST (Instant Mode)
        console.log(`  🚀 [Instant] Posting reel ${reel.shortcode} to Pinterest...`);
        
        const pinData = {
          title: pinContent.title,
          description: finalDescription,
          alt_text: `Product: ${productName || 'Showcased item'} from @${reel.username}`,
          link: affiliateUrl || '',
          media_source: { url: reel.mediaUrl },
        };

        try {
          const postResult = await puppeteerService.createPinWithBot(pinData);
          console.log(`  ✅ [Instant] Posted successfully: ${postResult.url || 'Live'}`);
          
          // Still add to queue/history but marked as COMPLETED
          await queueService.addToQueue([{
            ...pinData,
            status: 'completed',
            username: reel.username,
            thumbnailUrl: reel.thumbnailUrl || reel.mediaUrl,
            mediaUrl: reel.mediaUrl,
            aiContent: {
              title: pinContent.title,
              description: finalDescription,
              hashtags: pinContent.hashtags || [],
            },
            sourceUrl: reel.url, // Original IG URL
            link: affiliateUrl || '', // Affiliate link
            tags: {
              channel: reel.username,
              shortcode: reel.shortcode,
              hasAffiliate: !!affiliateUrl,
              product: productName || null,
              flipkartUrl: flipkartUrl || null,
              isInstant: true,
              publishUrl: postResult.url || null
            },
          }]);
          results.queued++;
        } catch (postErr) {
          console.error(`  ⚠️ [Instant] Direct posting failed, falling back to Queue: ${postErr.message}`);
          // If posting fails, add to queue as PENDING so it can be retried later by fire-post
          await queueService.addToQueue([{
            ...pinData,
            status: 'pending',
            username: reel.username,
            thumbnailUrl: reel.thumbnailUrl || reel.mediaUrl,
            mediaUrl: reel.mediaUrl,
            aiContent: {
              title: pinContent.title,
              description: finalDescription,
              hashtags: pinContent.hashtags || [],
            },
            sourceUrl: reel.url, // Original IG URL
            link: affiliateUrl || '', // Affiliate link
            tags: {
              channel: reel.username,
              shortcode: reel.shortcode,
              hasAffiliate: !!affiliateUrl,
              product: productName || null,
              flipkartUrl: flipkartUrl || null,
              isInstant: true,
              error: postErr.message
            },
          }]);
          results.skipped++;
        }
        
        // Step 8: Mark as seen because it is now securely in the queue or posted
        await igTrackerService.markReelAsSeen(reel.username, reel.shortcode);
        console.log(`  ✅ Successfully processed and marked seen! Affiliate: ${affiliateUrl ? 'YES' : 'NO'}`);
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

runIgPinterestPipeline();

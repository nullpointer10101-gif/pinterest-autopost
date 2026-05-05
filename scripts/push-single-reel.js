require('dotenv').config();
const igTrackerService = require('../services/igTrackerService');
const aiService = require('../services/aiService');
const flipkartSearchService = require('../services/flipkartSearchService');
const earnKaroService = require('../services/earnKaroService');
const historyService = require('../services/historyService');
const puppeteerService = require('../services/puppeteerService');

/**
 * Pushes a single Instagram Reel through the full multi-item "Shop The Look" pipeline.
 */
async function pushSingleReel(reelUrl) {
    console.log('════════════════════════════════════════════════════════');
    console.log(`[Push] Single Reel Pipeline (Shop The Look)`);
    console.log(`[Push] Target: ${reelUrl}`);
    console.log('════════════════════════════════════════════════════════\n');

    try {
        // 1. Resolve Reel Data
        console.log(`[1/6] Scraping Instagram data...`);
        // We'll mock the scraping for this test or use a generic fetch if needed.
        // For a true test, we'll extract the shortcode and build a reel object.
        const shortcodeMatch = reelUrl.match(/\/(reel|p|tv)\/([A-Za-z0-9_-]+)/);
        if (!shortcodeMatch) {
            throw new Error('Invalid Instagram URL format');
        }
        const shortcode = shortcodeMatch[2];
        
        // Mocking/Resolving basic data
        const reel = {
            url: reelUrl,
            shortcode: shortcode,
            username: 'fashion_creator',
            caption: 'Rate this clean aesthetic look! 🧥👖👟\n\nFollow for more daily outfit inspo.',
            mediaUrl: 'https://www.w3schools.com/html/mov_bbb.mp4', // Example video
            thumbnailUrl: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=1000&auto=format&fit=crop'
        };

        // 2. Multi-Item AI Identification
        console.log(`[2/6] 🤖 AI identifying full outfit (3-Layer Fallback active)...`);
        const outfitData = await aiService.identifyOutfit({
            caption: reel.caption,
            username: reel.username,
            thumbnailUrl: reel.thumbnailUrl
        });

        if (!outfitData.found) {
            console.log('  ℹ️ No outfit detected. Falling back to single item search...');
            // Optional: fallback logic here
        }

        // 3. Multi-Product Search & Affiliate Link Generation
        console.log(`[3/6] 🔍 Curation & Affiliate Generation...`);
        const affiliateLinks = [];
        let mainProductName = "Style Inspo";

        if (outfitData.found && outfitData.items) {
            console.log(`  🎯 Found outfit: "${outfitData.outfitName}"`);
            for (const item of outfitData.items) {
                console.log(`  🔍 Searching for ${item.type}: "${item.query}"...`);
                const queries = {
                    exactMatchQuery: item.query,
                    similarMatchQuery: item.query,
                    broadMatchQuery: item.query.split(' ').slice(0, 3).join(' ')
                };
                
                const fp = await flipkartSearchService.findProduct(queries, item.query);
                if (fp) {
                    console.log(`    ✅ Match found: ${fp.title}`);
                    const ek = await earnKaroService.makeAffiliateLink(fp.url);
                    if (ek && ek.affiliateUrl) {
                        affiliateLinks.push({ 
                            type: item.type, 
                            name: fp.title, 
                            url: ek.affiliateUrl, 
                            image: fp.image, 
                            originalPrice: fp.price 
                        });
                        if (item.type === 'main') mainProductName = fp.title;
                    }
                } else {
                    console.log(`    ❌ No match on Flipkart.`);
                }
            }
        }

        // 4. Content Generation
        console.log(`[4/6] ✍️ Generating Pinterest SEO content...`);
        const appDomain = process.env.APP_BASE_URL || 'http://localhost:3000';
        const landingPageUrl = `${appDomain.replace(/\/$/, '')}/look/${reel.shortcode}`;

        const pinContent = await aiService.generatePinterestContent({
            caption: reel.caption,
            username: reel.username,
            mediaType: 'video'
        });

        let finalDescription = pinContent.description;
        if (affiliateLinks.length > 0) {
            finalDescription = `${pinContent.description}\n\n🛒 Shop the full outfit here → ${landingPageUrl}`.substring(0, 800);
        }

        // 5. Post to Pinterest
        console.log(`[5/6] 🚀 Launching Pinterest Browser Bot...`);
        const pinData = {
            title: pinContent.title,
            description: finalDescription,
            alt_text: `Full outfit curation from @${reel.username}`,
            link: landingPageUrl,
            media_source: {
                url: reel.mediaUrl
            }
        };

        const postResult = await puppeteerService.createPinWithBot(pinData);
        console.log(`  ✅ Successfully published to Pinterest!`);

        // 6. Record History (so the landing page works)
        console.log(`[6/6] 💾 Saving to database...`);
        await historyService.add({
            url: reel.url,
            reelData: reel,
            aiContent: pinContent,
            productInfo: {
                name: outfitData.outfitName || mainProductName,
                outfit: affiliateLinks
            },
            pinterestPin: {
                id: `test_${Date.now()}`,
                url: '#',
                method: 'manual_push'
            },
            status: 'success',
            postedAt: new Date().toISOString()
        });

        console.log('\n════════════════════════════════════════════════════════');
        console.log('✅ PUSH COMPLETE');
        console.log(`  Landing Page:  ${landingPageUrl}`);
        console.log('════════════════════════════════════════════════════════\n');

    } catch (err) {
        console.error(`\n❌ PUSH FAILED: ${err.message}`);
        process.exit(1);
    }
}

const url = process.argv[2] || 'https://www.instagram.com/reel/C-xyz123/';
pushSingleReel(url);

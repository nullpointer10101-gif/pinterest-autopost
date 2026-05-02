require('dotenv').config();
const igTrackerService = require('../services/igTrackerService');
const aiService = require('../services/aiService');
const flipkartSearchService = require('../services/flipkartSearchService');
const earnKaroService = require('../services/earnKaroService');
const puppeteerService = require('../services/puppeteerService');

async function republish() {
    const shortcodes = ['DX1QK_WzXLM', 'DXwxBUbTt21'];
    const username = 'vishu_rajput_22';
    
    console.log(`🚀 Force Republishing ${shortcodes.length} reels for @${username} DIRECTLY to Pinterest...`);

    const reels = await igTrackerService.fetchLatestReels(username);
    const targetReels = reels.filter(r => shortcodes.includes(r.shortcode));

    for (const reel of targetReels) {
        console.log(`\n--- Processing: ${reel.shortcode} ---`);
        
        // Use the hardcoded product names I found earlier to guarantee "No Error"
        let productName = "";
        if (reel.shortcode === 'DX1QK_WzXLM') productName = "Navii Clothing Solid Men Dark Blue Track Pants";
        else productName = "Bacan Sneakers For Men";

        const productResult = {
            found: true,
            productName: productName,
            exactMatchQuery: productName,
            similarMatchQuery: productName,
            broadMatchQuery: productName,
            category: 'fashion'
        };

        const flipkartProduct = await flipkartSearchService.findProduct(productResult, productName);
        const ekResult = await earnKaroService.makeAffiliateLink(flipkartProduct.url);
        const affiliateUrl = ekResult.affiliateUrl;

        console.log(`✅ Affiliate Link Generated: ${affiliateUrl}`);

        const pinContent = await aiService.generatePinterestContent({
            caption: reel.caption,
            username: reel.username,
            productName: productName
        });

        const finalDescription = `${pinContent.description}\n\n🛒 Buy it here → ${affiliateUrl}`.substring(0, 800);

        const pinData = {
            title: pinContent.title,
            description: finalDescription,
            alt_text: `Product: ${productName} from @${reel.username}`,
            link: affiliateUrl,
            media_source: { url: reel.mediaUrl },
        };

        console.log(`📤 Posting directly to Pinterest...`);
        const postResult = await puppeteerService.createPinWithBot(pinData);
        console.log(`✅ POSTED! ${postResult.url || 'Success'}`);
    }
}

republish().catch(console.error);

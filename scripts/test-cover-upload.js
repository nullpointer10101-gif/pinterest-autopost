require('dotenv').config();
const igTrackerService = require('../services/igTrackerService');
const puppeteerService = require('../services/puppeteerService');
const historyService = require('../services/historyService');

async function testSingleReelCoverUpload() {
    console.log('[Test] Fetching 1 reel from @fashion_nestt to test Cover Upload...');
    
    // 1. Fetch reels from a target account
    const reels = await igTrackerService.fetchLatestReels('nithclothing');
    
    if (reels.length < 2) {
        console.error('[Test] Could not find enough reels from nithclothing');
        return;
    }

    // Pick the third reel to ensure it's different
    const targetReel = reels[2];
    console.log(`[Test] Selected Reel: ${targetReel.url}`);
    console.log(`[Test] Video URL: ${targetReel.mediaUrl}`);
    console.log(`[Test] Cover Thumbnail URL: ${targetReel.thumbnailUrl}`);

    // 2. Prepare Pin Data (mocking the AI to avoid rate limits and post instantly)
    const pinData = {
        title: 'Test Outfit Post',
        description: targetReel.caption || 'This is a test post to verify cover image uploading.',
        alt_text: 'Fashion outfit test',
        link: 'https://example.com',
        media_source: {
            url: targetReel.mediaUrl,
            thumbnailUrl: targetReel.thumbnailUrl
        }
    };

    console.log('[Test] Initiating Pinterest Upload Process...');
    
    try {
        const result = await puppeteerService.createPinWithBot(pinData);
        console.log('[Test] SUCCESS! Pin posted with custom cover image.');
        console.log(`[Test] View it here: ${result.pin.url}`);
        
        // Add to history so it's not picked up by the main pipeline later
        await historyService.add({
            url: targetReel.url,
            reelData: targetReel,
            aiContent: { title: pinData.title, description: pinData.description, hashtags: [] },
            affiliateLink: pinData.link,
            pinterestPin: result.pin,
            status: 'success',
            postedAt: new Date().toISOString()
        });
        
    } catch (e) {
        console.error('[Test] FAILED:', e.message);
    }
}

testSingleReelCoverUpload();

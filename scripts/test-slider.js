require('dotenv').config();
const puppeteerService = require('../services/puppeteerService');

async function testSlider() {
    console.log('[Test] Initiating Pinterest Upload Process for Slider Test...');
    
    // A dummy video
    const pinData = {
        title: 'Slider Test Pin',
        description: 'Testing the slider natively.',
        alt_text: 'Test',
        link: 'https://example.com',
        media_source: {
            url: 'https://videos.pexels.com/video-files/853889/853889-hd_1920_1080_25fps.mp4',
            thumbnailUrl: ''
        }
    };

    try {
        const result = await puppeteerService.createPinWithBot(pinData);
        console.log('[Test] SUCCESS! Pin posted.');
        console.log(`[Test] View it here: ${result.pin.url}`);
    } catch (e) {
        console.error('[Test] FAILED:', e.message);
    }
}

testSlider();

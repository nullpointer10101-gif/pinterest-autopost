require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const historyService = require('../services/historyService');
const puppeteerService = require('../services/puppeteerService');

async function testSingle() {
    console.log('[Test] Running single test upload with Cover image...');

    // A dummy video and a dummy thumbnail
    const videoUrl = 'https://videos.pexels.com/video-files/853889/853889-hd_1920_1080_25fps.mp4';
    const thumbnailUrl = 'https://images.pexels.com/photos/1761279/pexels-photo-1761279.jpeg';

    const pinData = {
        title: 'Test Pin With Cover',
        description: 'This is a test pin to verify cover image uploading.',
        alt_text: 'Test Alt Text',
        link: 'https://example.com',
        media_source: {
            url: videoUrl,
            thumbnailUrl: thumbnailUrl
        }
    };

    try {
        await puppeteerService.createPinWithBot(pinData);
        console.log('[Test] Success!');
    } catch (e) {
        console.error('[Test] Failed:', e.message);
    }
}

testSingle();

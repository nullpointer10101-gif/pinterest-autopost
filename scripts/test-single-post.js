require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const historyService = require('../services/historyService');
const puppeteerService = require('../services/puppeteerService');

async function testSingle() {
    console.log('[Test] Running single test upload with Cover image...');

    const imageUrl = 'https://images.pexels.com/photos/1761279/pexels-photo-1761279.jpeg';

    const pinData = {
        title: 'Test Pin Instant',
        description: 'This is a test pin to verify publishing.',
        alt_text: 'Test Alt Text',
        link: 'https://example.com',
        media_source: {
            url: imageUrl
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

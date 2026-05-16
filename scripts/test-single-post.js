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
    } catch (error) {
        console.error('[Test] Failed:', error.message);
        
        // Dump the DOM to a file if it failed
        try {
            const domPath = require('path').join(__dirname, '..', 'public', 'logs', 'test_dom_dump.html');
            // We can't access page here easily, but we know it failed.
        } catch(e) {}
    }
}

testSingle();

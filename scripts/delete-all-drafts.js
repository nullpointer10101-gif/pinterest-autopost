require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const historyService = require('../services/historyService');

(async () => {
    console.log('[DraftCleaner] Starting...');
    const cookie = (await historyService.getSessionCookie())?.cookie || process.env.PINTEREST_SESSION_COOKIE;
    
    const browser = await puppeteer.launch({headless: 'new', args: ['--no-sandbox', '--window-size=1920,1080']});
    const page = await browser.newPage();
    await page.setViewport({width: 1920, height: 1080});
    await page.setCookie({name: '_pinterest_sess', value: cookie, domain: '.pinterest.com', path: '/', secure: true, httpOnly: true});
    
    await page.goto('https://www.pinterest.com/pin-creation-tool/', {waitUntil: 'networkidle2'});
    await new Promise(r => setTimeout(r, 5000));
    
    for (let i = 0; i < 50; i++) {
        console.log(`[DraftCleaner] Deleting draft ${i+1}...`);
        try {
            const deleted = await page.evaluate(async () => {
                // Find first draft actions button
                const actionsBtn = document.querySelector('[data-test-id="pin-draft-actions"] button, [data-test-id="pin-draft-actions"]');
                if (!actionsBtn) return false;
                
                // Hover or click to reveal delete
                actionsBtn.click();
                await new Promise(r => setTimeout(r, 500));
                
                // Find delete button
                const btns = Array.from(document.querySelectorAll('button, div[role="menuitem"]'));
                const delBtn = btns.find(b => (b.innerText || '').toLowerCase() === 'delete');
                if (delBtn) {
                    delBtn.click();
                    return true;
                }
                
                // Maybe the actionsBtn ITSELF is the delete button? (trash icon)
                const ariaLabel = (actionsBtn.getAttribute('aria-label') || '').toLowerCase();
                if (ariaLabel.includes('delete') || ariaLabel.includes('remove')) {
                    actionsBtn.click();
                    return true;
                }
                
                return false;
            });
            
            if (!deleted) {
                console.log('[DraftCleaner] No more drafts found or failed to delete.');
                break;
            }
            
            await new Promise(r => setTimeout(r, 1000));
            // Confirm dialog
            await page.evaluate(() => {
                const dialogBtns = Array.from(document.querySelectorAll('[role="dialog"] button'));
                const confirm = dialogBtns.find(b => (b.innerText || '').toLowerCase() === 'delete');
                if (confirm) confirm.click();
            });
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
            console.error('[DraftCleaner] Error:', e.message);
            break;
        }
    }
    
    await browser.close();
})();

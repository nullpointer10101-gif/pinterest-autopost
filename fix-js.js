const fs = require('fs');
let js = fs.readFileSync('public/js/app.js', 'utf8');

// The toggle logic
const toggleJs = `
// Desktop UI Toggle Logic
const savedDesktopUi = localStorage.getItem('desktop_ui_mode');
if (savedDesktopUi === 'creator') {
    document.body.setAttribute('data-desktop-ui', 'creator');
}

const railwayToggleBtn = document.getElementById('ui-toggle-btn');
if (railwayToggleBtn) {
    railwayToggleBtn.addEventListener('click', () => {
        document.body.setAttribute('data-desktop-ui', 'creator');
        localStorage.setItem('desktop_ui_mode', 'creator');
    });
}

const creatorToggleBtn = document.getElementById('creator-ui-toggle-btn');
if (creatorToggleBtn) {
    creatorToggleBtn.addEventListener('click', () => {
        document.body.removeAttribute('data-desktop-ui');
        localStorage.removeItem('desktop_ui_mode');
    });
}

// Bind Creator tabs to switchTab
document.querySelectorAll('.desktop-creator-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.getAttribute('data-tab');
        if (tab) {
            if (typeof switchTab === 'function') switchTab(tab);
            
            // Update active state in Creator UI topbar
            document.querySelectorAll('.desktop-creator-tab').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
        }
    });
});
`;

// Insert it at the end of DOMContentLoaded or just append it at the end of the file.
// Let's append to the end of the file.

fs.writeFileSync('public/js/app.js', js + '\n' + toggleJs);
console.log('Successfully updated app.js with toggle logic');

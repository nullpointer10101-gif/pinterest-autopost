const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// 1. Add toggle to railway UI
html = html.replace(
    '<div id="live-time" class="clock">00:00</div>',
    `<button id="ui-toggle-btn" class="btn btn-secondary compact-btn" type="button" title="Toggle Laptop UI">
                    <i data-lucide="monitor" class="btn-icon"></i>
                    <span>Laptop UI</span>
                </button>
                <div id="live-time" class="clock">00:00</div>`
);

// 2. Add toggle to Creator UI
html = html.replace(
    '<button id="creator-sync-btn" class="desktop-creator-action rail-refresh-button" type="button">\n                    <i data-lucide="refresh-cw" class="btn-icon"></i>\n                    <span>Refresh</span>\n                </button>',
    `<button id="creator-ui-toggle-btn" class="desktop-creator-action" type="button" title="Toggle Laptop UI">
                    <i data-lucide="layout-dashboard" class="btn-icon"></i>
                    <span>Railway UI</span>
                </button>
                <button id="creator-sync-btn" class="desktop-creator-action rail-refresh-button" type="button">
                    <i data-lucide="refresh-cw" class="btn-icon"></i>
                    <span>Refresh</span>
                </button>`
);

// 3. Add the missing navigation tabs to Creator UI
const tabsHtml = `
            <div class="desktop-creator-tabs">
                <button class="desktop-creator-tab tab-btn active" data-tab="dashboard">Dashboard</button>
                <button class="desktop-creator-tab tab-btn" data-tab="queue">Queue</button>
                <button class="desktop-creator-tab tab-btn" data-tab="studio">Studio</button>
                <button class="desktop-creator-tab tab-btn" data-tab="history">History</button>
                <button class="desktop-creator-tab tab-btn" data-tab="channels">Targets</button>
            </div>
`;

html = html.replace(
    '<div class="rail-topbar-center">\n                <span id="rail-status-chip" class="rail-status-chip"><span class="status-dot green"></span>ONLINE</span>\n            </div>',
    tabsHtml + '            <div class="rail-topbar-center">\n                <span id="rail-status-chip" class="rail-status-chip"><span class="status-dot green"></span>ONLINE</span>\n            </div>'
);

fs.writeFileSync('public/index.html', html);
console.log('Successfully updated index.html with toggles and tabs');

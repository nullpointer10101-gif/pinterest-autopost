const fs = require('fs');
let css = fs.readFileSync('public/css/style.css', 'utf8');

const creatorStart = css.indexOf('/* Reel Orbit Creator: replacement laptop UI');

if (creatorStart !== -1) {
    let beforeCreator = css.slice(0, creatorStart);
    let creatorUI = css.slice(creatorStart);

    creatorUI = creatorUI.replace(/body\[data-visual-mode\]/g, 'body[data-desktop-ui="creator"][data-visual-mode]');
    creatorUI = creatorUI.replace(/  body \{/g, '  body[data-desktop-ui="creator"] {');
    creatorUI = creatorUI.replace(/  body::before/g, '  body[data-desktop-ui="creator"]::before');
    creatorUI = creatorUI.replace(/  body::after/g, '  body[data-desktop-ui="creator"]::after');
    
    const toggleOverrides = `
/* --- UI TOGGLE OVERRIDES --- */
@media (min-width: 761px) {
  /* Default: Railway UI is active, Creator UI is hidden */
  body:not([data-desktop-ui="creator"]) .desktop-creator-topbar,
  body:not([data-desktop-ui="creator"]) .panel-dashboard > .desktop-creator-home {
    display: none !important;
  }
  
  /* When Creator UI is active */
  body[data-desktop-ui="creator"] .rail-desktop-only,
  body[data-desktop-ui="creator"] .rail-page-head,
  body[data-desktop-ui="creator"] .rail-stats-grid,
  body[data-desktop-ui="creator"] .signal-alerts,
  body[data-desktop-ui="creator"] .dashboard-grid,
  body[data-desktop-ui="creator"] .app-shell > .topbar,
  body[data-desktop-ui="creator"] .app-shell > .tab-nav,
  body[data-desktop-ui="creator"] .ops-ribbon,
  body[data-desktop-ui="creator"] .orbit-deck,
  body[data-desktop-ui="creator"] .flow-board {
    display: none !important;
  }
  
  body[data-desktop-ui="creator"] main {
    margin-left: 0 !important;
    margin-top: 0 !important;
    padding: 22px 0 36px !important;
  }
}
`;

    fs.writeFileSync('public/css/style.css', beforeCreator + creatorUI + toggleOverrides);
    console.log('Successfully scoped Creator UI to body[data-desktop-ui="creator"]');
} else {
    console.log('Could not find Creator UI marker');
}

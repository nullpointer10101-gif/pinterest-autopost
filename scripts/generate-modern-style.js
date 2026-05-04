const fs = require('fs');
const path = require('path');

const lines = [];

const add = (block = '') => {
  const normalized = block.replace(/\r/g, '').trim();
  if (!normalized) return;
  lines.push(...normalized.split('\n'));
};

add(`
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;600;700;800&family=Manrope:wght@400;500;600;700;800&display=swap');

:root {
  color-scheme: dark;
  --cursor-x: 50vw;
  --cursor-y: 28vh;

  --bg-0: #040812;
  --bg-1: #071227;
  --bg-2: #0d1b34;
  --bg-3: #111f3a;

  --surface-0: rgba(11, 21, 40, 0.86);
  --surface-1: rgba(13, 24, 46, 0.92);
  --surface-2: rgba(16, 30, 58, 0.96);
  --surface-raised: rgba(19, 35, 65, 0.95);

  --line-weak: rgba(144, 176, 227, 0.15);
  --line: rgba(133, 172, 234, 0.24);
  --line-strong: rgba(131, 188, 255, 0.38);

  --text: #ebf4ff;
  --text-strong: #ffffff;
  --text-mid: #bbd0ed;
  --text-soft: #8ea8ca;

  --accent: #36a1ff;
  --accent-strong: #1c82ef;
  --accent-2: #20d4c5;
  --accent-3: #4f6bff;

  --good: #2bd6a3;
  --warn: #efbf67;
  --bad: #ff758e;

  --radius-xs: 8px;
  --radius-sm: 12px;
  --radius-md: 16px;
  --radius-lg: 22px;
  --radius-xl: 28px;

  --shadow-sm: 0 8px 20px rgba(5, 12, 24, 0.28);
  --shadow-md: 0 16px 36px rgba(3, 10, 20, 0.42);
  --shadow-lg: 0 28px 52px rgba(2, 8, 18, 0.5);

  --card-pad: clamp(14px, 2vw, 22px);
  --ring: 0 0 0 2px rgba(54, 161, 255, 0.38);
}

body[data-visual-mode="light"] {
  color-scheme: light;

  --bg-0: #edf2fb;
  --bg-1: #f4f8ff;
  --bg-2: #e6eefb;
  --bg-3: #dce8fb;

  --surface-0: rgba(255, 255, 255, 0.84);
  --surface-1: rgba(255, 255, 255, 0.92);
  --surface-2: rgba(252, 255, 255, 0.98);
  --surface-raised: rgba(255, 255, 255, 0.98);

  --line-weak: rgba(43, 73, 118, 0.14);
  --line: rgba(42, 84, 143, 0.22);
  --line-strong: rgba(44, 99, 166, 0.34);

  --text: #12243f;
  --text-strong: #091a30;
  --text-mid: #345576;
  --text-soft: #6481a3;

  --accent: #0e7ef2;
  --accent-strong: #095fbb;
  --accent-2: #099f8d;
  --accent-3: #3f57df;

  --good: #0f9a66;
  --warn: #9f6a10;
  --bad: #be3f5b;

  --shadow-sm: 0 8px 18px rgba(28, 55, 88, 0.12);
  --shadow-md: 0 14px 32px rgba(24, 56, 93, 0.16);
  --shadow-lg: 0 24px 48px rgba(24, 56, 93, 0.19);

  --ring: 0 0 0 2px rgba(14, 126, 242, 0.34);
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  min-height: 100%;
}

body {
  margin: 0;
  color: var(--text);
  font-family: 'Manrope', sans-serif;
  line-height: 1.5;
  letter-spacing: 0.01em;
  background:
    radial-gradient(1300px 600px at var(--cursor-x) var(--cursor-y), rgba(54, 161, 255, 0.17), transparent 60%),
    radial-gradient(800px 460px at 12% -8%, rgba(79, 107, 255, 0.18), transparent 65%),
    radial-gradient(760px 420px at 92% -10%, rgba(32, 212, 197, 0.14), transparent 64%),
    linear-gradient(180deg, var(--bg-2), var(--bg-1) 38%, var(--bg-0));
  overflow-x: hidden;
}

body.preview-scroll-lock {
  overflow: hidden;
}

a {
  color: inherit;
  text-decoration: none;
}

img,
video {
  max-width: 100%;
  display: block;
}

button,
input,
select,
textarea {
  font: inherit;
}

:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}

.scene-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}

.scene-gradient {
  position: absolute;
  border-radius: 999px;
  filter: blur(2px);
}

.scene-gradient-a {
  width: 62vw;
  max-width: 900px;
  height: 62vw;
  max-height: 900px;
  left: -22vw;
  top: -34vw;
  background: radial-gradient(circle, rgba(79, 107, 255, 0.3), rgba(79, 107, 255, 0));
}

.scene-gradient-b {
  width: 56vw;
  max-width: 820px;
  height: 56vw;
  max-height: 820px;
  right: -18vw;
  top: -32vw;
  background: radial-gradient(circle, rgba(32, 212, 197, 0.24), rgba(32, 212, 197, 0));
}

.scene-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(121, 159, 219, 0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(121, 159, 219, 0.07) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(circle at center, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0.1) 75%);
}

.app-shell {
  position: relative;
  z-index: 1;
  width: min(1480px, 100%);
  margin: 0 auto;
  padding: clamp(12px, 2vw, 22px);
}

.topbar {
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-xl);
  background:
    linear-gradient(155deg, rgba(255, 255, 255, 0.04), transparent 40%),
    linear-gradient(170deg, var(--surface-2), var(--surface-1));
  box-shadow: var(--shadow-md);
  padding: clamp(12px, 2vw, 20px);
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}

.brand-wrap {
  display: grid;
  gap: 6px;
}

.brand-tag {
  margin: 0;
  width: fit-content;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 800;
  color: var(--accent-2);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  background: rgba(32, 212, 197, 0.1);
}

.brand-title {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: 'Orbitron', sans-serif;
  font-size: clamp(1rem, 2vw, 1.45rem);
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--text-strong);
}

.brand-icon {
  width: 20px;
  height: 20px;
  color: var(--accent);
  flex-shrink: 0;
}

.brand-subtitle {
  margin: 0;
  color: var(--text-soft);
  font-size: 13px;
  max-width: 84ch;
}

.status-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.header-tools {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  align-items: center;
}

.switch-wrap {
  min-height: 42px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-0);
  padding: 8px 12px;
  color: var(--text-mid);
  font-size: 12px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.switch-wrap input {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
}

.clock {
  min-height: 42px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: linear-gradient(160deg, var(--surface-0), rgba(255, 255, 255, 0.01));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: 'Orbitron', sans-serif;
  font-size: 13px;
  font-weight: 700;
  color: var(--accent-2);
  letter-spacing: 0.06em;
  padding: 0 12px;
}

.tab-nav {
  margin: 14px 0 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: linear-gradient(170deg, var(--surface-1), var(--surface-0));
  box-shadow: var(--shadow-sm);
  padding: 8px;
  display: flex;
  gap: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}

.tab-nav::-webkit-scrollbar {
  height: 8px;
}

.tab-nav::-webkit-scrollbar-thumb {
  background: rgba(125, 161, 214, 0.45);
  border-radius: 999px;
}

.tab-btn {
  appearance: none;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-mid);
  min-height: 44px;
  min-width: 130px;
  padding: 8px 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  transition: border-color 170ms ease, background-color 170ms ease, color 170ms ease, transform 170ms ease;
}

.tab-btn:hover {
  border-color: var(--line);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
}

.tab-btn.active {
  border-color: rgba(54, 161, 255, 0.7);
  background:
    linear-gradient(160deg, rgba(54, 161, 255, 0.26), rgba(54, 161, 255, 0.08)),
    radial-gradient(circle at 12% 20%, rgba(255, 255, 255, 0.18), transparent 40%);
  color: #ebf7ff;
  transform: translateY(-1px);
}

body[data-visual-mode="light"] .tab-btn.active {
  color: #0f3f7f;
}

.tab-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.panel {
  display: grid;
  gap: 14px;
}

.panel.hidden,
.hidden {
  display: none !important;
}

.card {
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background:
    linear-gradient(160deg, rgba(255, 255, 255, 0.03), transparent 34%),
    linear-gradient(165deg, var(--surface-1), var(--surface-0));
  box-shadow: var(--shadow-sm);
  padding: var(--card-pad);
  position: relative;
  overflow: hidden;
}

.card::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(120deg, rgba(255, 255, 255, 0.06), transparent 24%, transparent 72%, rgba(255, 255, 255, 0.03));
  opacity: 0.3;
}

.card > * {
  position: relative;
  z-index: 1;
}

.card:hover {
  border-color: var(--line-strong);
  box-shadow: var(--shadow-md);
}

.card-title-wrap {
  display: grid;
  gap: 6px;
  margin-bottom: 14px;
}

.card-title-wrap h2 {
  margin: 0;
  font-family: 'Orbitron', sans-serif;
  font-size: clamp(0.96rem, 1.3vw, 1.15rem);
  font-weight: 600;
  letter-spacing: 0.05em;
  display: inline-flex;
  align-items: center;
  gap: 9px;
}

.heading-icon {
  width: 17px;
  height: 17px;
  color: var(--accent);
  flex-shrink: 0;
}

.heading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.muted-text {
  margin: 0;
  color: var(--text-soft);
  font-size: 13px;
}

.hero-panel {
  min-height: clamp(260px, 34vw, 360px);
}

.hero-grid {
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
}

.hero-content {
  display: grid;
  align-content: start;
  gap: 12px;
}

.hero-pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hero-pill {
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 4px 10px;
  border: 1px solid transparent;
}

.hero-pill-primary {
  border-color: rgba(54, 161, 255, 0.56);
  color: #c9ebff;
  background: rgba(54, 161, 255, 0.2);
}

.hero-pill-secondary {
  border-color: rgba(32, 212, 197, 0.56);
  color: #c4fff3;
  background: rgba(32, 212, 197, 0.2);
}

.hero-title {
  margin: 0;
  font-family: 'Orbitron', sans-serif;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.16;
  font-size: clamp(1.4rem, 3.2vw, 2.5rem);
  max-width: 20ch;
}

.hero-description {
  margin: 0;
  color: var(--text-mid);
  max-width: 66ch;
  font-size: 14px;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 4px;
}

.hero-action {
  min-width: 150px;
}

.hero-side {
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: linear-gradient(160deg, var(--surface-2), var(--surface-1));
  padding: 12px;
  display: grid;
  align-content: start;
  gap: 12px;
}

.hero-mode-box {
  border: 1px solid var(--line-weak);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.03);
  padding: 11px;
  display: grid;
  gap: 4px;
}

.hero-mode-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-weight: 800;
  color: var(--text-soft);
}

.hero-mode-value {
  font-size: 1.16rem;
  font-family: 'Orbitron', sans-serif;
  color: var(--accent-2);
}

.hero-side-grid {
  display: grid;
  gap: 8px;
}

.hero-side-item {
  border: 1px solid var(--line-weak);
  border-radius: var(--radius-sm);
  padding: 9px 10px;
  background: rgba(255, 255, 255, 0.02);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-mid);
}

.hero-side-item strong {
  color: var(--text-strong);
  font-family: 'Orbitron', sans-serif;
  font-size: 0.9rem;
}

.hero-metrics-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}

.hero-metric-card {
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.03), transparent 48%), var(--surface-0);
  padding: 12px;
  display: grid;
  gap: 6px;
}

.hero-metric-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-soft);
  font-weight: 800;
}

.hero-metric-value {
  font-family: 'Orbitron', sans-serif;
  font-size: clamp(1.1rem, 2vw, 1.5rem);
  color: var(--text-strong);
}

.stats-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
}

.stat-card {
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--surface-0);
  padding: 12px;
  display: grid;
  gap: 7px;
}

.stat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.stat-label {
  font-size: 11px;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: var(--text-soft);
  font-weight: 800;
}

.stat-icon {
  width: 15px;
  height: 15px;
  color: var(--accent);
}

.stat-value {
  font-family: 'Orbitron', sans-serif;
  font-size: clamp(1.06rem, 2.2vw, 1.44rem);
  color: var(--text-strong);
}

.dashboard-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(12, minmax(0, 1fr));
}

.dashboard-card {
  min-height: 100%;
}

.dashboard-card-workflow {
  grid-column: span 6;
}

.dashboard-card-queue,
.dashboard-card-history,
.dashboard-card-cycle {
  grid-column: span 3;
}

.workflow-grid {
  display: grid;
  gap: 10px;
}

.workflow-item {
  border: 1px solid var(--line-weak);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.02);
  padding: 9px 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.workflow-info {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.workflow-icon {
  width: 15px;
  height: 15px;
  color: var(--accent-2);
  flex-shrink: 0;
}

.workflow-name {
  color: var(--text-strong);
  font-size: 13px;
  font-weight: 700;
}

.workflow-desc {
  color: var(--text-soft);
  font-size: 11px;
}

.master-switch {
  position: relative;
  width: 48px;
  height: 28px;
  display: inline-flex;
  flex-shrink: 0;
}

.master-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.master-slider {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(122, 144, 176, 0.2);
  transition: background-color 180ms ease, border-color 180ms ease;
}

.master-slider::before {
  content: '';
  position: absolute;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  top: 2px;
  left: 2px;
  background: #f0f7ff;
  box-shadow: 0 4px 9px rgba(0, 0, 0, 0.3);
  transition: transform 180ms ease;
}

.master-switch input:checked + .master-slider {
  background: linear-gradient(140deg, var(--accent), var(--accent-2));
  border-color: rgba(32, 212, 197, 0.62);
}

.master-switch input:checked + .master-slider::before {
  transform: translateX(20px);
}

.countdown-wrap {
  border: 1px solid var(--line-weak);
  border-radius: var(--radius-md);
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
  display: grid;
  gap: 6px;
}

.countdown-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.11em;
  color: var(--text-soft);
  font-weight: 800;
}

.countdown-timer {
  font-family: 'Orbitron', sans-serif;
  font-size: clamp(1.15rem, 2vw, 1.46rem);
  color: var(--text-strong);
}

.countdown-subtext {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-soft);
  font-size: 12px;
}

.mini-icon {
  width: 14px;
  height: 14px;
  color: var(--accent);
}

.health-grid {
  margin-top: 12px;
  display: grid;
  gap: 8px;
}

.health-item {
  border: 1px solid var(--line-weak);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.02);
  padding: 9px 10px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.status-light {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgba(131, 153, 184, 0.75);
  box-shadow: 0 0 0 3px rgba(131, 153, 184, 0.2);
  flex-shrink: 0;
}

.status-light.active {
  background: var(--good);
  box-shadow: 0 0 0 3px rgba(43, 214, 163, 0.24), 0 0 12px rgba(43, 214, 163, 0.44);
}

.status-light.warn {
  background: var(--warn);
  box-shadow: 0 0 0 3px rgba(239, 191, 103, 0.24), 0 0 12px rgba(239, 191, 103, 0.44);
}

.status-light.error {
  background: var(--bad);
  box-shadow: 0 0 0 3px rgba(255, 117, 142, 0.24), 0 0 12px rgba(255, 117, 142, 0.44);
}

.engage-inline {
  margin-top: 12px;
  display: grid;
  gap: 8px;
}

.engage-inline label {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-mid);
}

.engage-inline-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.engage-inline-controls input[type="range"] {
  width: 100%;
  accent-color: var(--accent);
}

#engage-count-value-dashboard {
  min-width: 30px;
  text-align: right;
  font-family: 'Orbitron', sans-serif;
  color: var(--accent-2);
}

.panel-grid {
  display: grid;
  gap: 12px;
}

.panel-grid-main {
  grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
}

.panel-grid-secondary {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.sidebar-col {
  display: grid;
  align-content: start;
  gap: 12px;
}

.list {
  border: 1px solid var(--line-weak);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.02);
  padding: 8px;
  display: grid;
  gap: 8px;
  min-height: 112px;
}

.list-item {
  border: 1px solid var(--line-weak);
  border-radius: var(--radius-sm);
  padding: 10px 11px;
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.03), transparent 46%), rgba(255, 255, 255, 0.01);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.list-item-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.item-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-strong);
  word-break: break-word;
}

.item-meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-soft);
  word-break: break-word;
}

.item-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.pulse-item {
  border: 1px dashed var(--line);
  border-radius: var(--radius-sm);
  padding: 10px;
  color: var(--text-soft);
  font-size: 12px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02));
  background-size: 220% 100%;
  animation: shimmer 2.2s ease-in-out infinite;
}

.error-text {
  color: var(--bad);
  border-color: rgba(255, 117, 142, 0.44);
}

.channel-list-grid {
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
}

.field-wrap {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
}

.field-wrap:last-child {
  margin-bottom: 0;
}

.field-wrap label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--text-mid);
}

.inline-field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.inline-field-reel {
  align-items: stretch;
}

.inline-actions {
  display: flex;
  gap: 8px;
}

.preview-shell {
  margin-top: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.02);
  padding: 12px;
  display: grid;
  gap: 12px;
}

.preview-media-wrap {
  border: 1px solid var(--line-weak);
  border-radius: var(--radius-sm);
  overflow: hidden;
  position: relative;
  background: #000;
}

.preview-img,
.preview-video {
  width: 100%;
  max-height: min(62vh, 520px);
  object-fit: cover;
}

.preview-media-actions {
  position: absolute;
  left: 10px;
  bottom: 10px;
  display: flex;
  gap: 8px;
}

.preview-fields {
  display: grid;
  gap: 4px;
}

input[type="text"],
input[type="password"],
input[type="number"],
select,
textarea {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  color: var(--text);
  padding: 10px 12px;
  font-size: 13px;
  transition: border-color 170ms ease, box-shadow 170ms ease, background-color 170ms ease;
}

textarea {
  resize: vertical;
  min-height: 118px;
}

input::placeholder,
textarea::placeholder {
  color: rgba(147, 170, 201, 0.82);
}

input:hover,
select:hover,
textarea:hover {
  border-color: var(--line-strong);
}

input:focus,
select:focus,
textarea:focus {
  border-color: var(--accent);
}

button {
  border: none;
}

.btn {
  appearance: none;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  min-height: 42px;
  padding: 9px 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  transition: transform 160ms ease, filter 160ms ease, border-color 160ms ease, background-color 160ms ease;
}

.btn:hover {
  transform: translateY(-1px);
  filter: brightness(1.04);
}

.btn:active {
  transform: translateY(0);
}

.btn-primary {
  border-color: rgba(54, 161, 255, 0.72);
  color: #eaf6ff;
  background: linear-gradient(140deg, var(--accent), var(--accent-strong));
}

body[data-visual-mode="light"] .btn-primary {
  color: #ffffff;
}

.btn-secondary {
  color: var(--text);
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.02));
}

.btn-danger {
  border-color: rgba(255, 117, 142, 0.66);
  color: #ffeef2;
  background: linear-gradient(145deg, #de4f6c, #b63c55);
}

body[data-visual-mode="light"] .btn-danger {
  color: #ffffff;
}

.btn-danger-text {
  border-color: rgba(255, 117, 142, 0.44);
  background: rgba(255, 117, 142, 0.14);
  color: var(--bad);
}

.btn-icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

.compact-btn {
  min-height: 38px;
  padding: 8px 11px;
  font-size: 11px;
}

.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.inline-actions-row {
  margin: 6px 0 2px;
}

.quick-actions {
  display: grid;
  gap: 8px;
}

.align-end {
  justify-content: flex-end;
}

.card-footer {
  margin-top: 10px;
  display: flex;
}

.control-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(170px, 220px);
  gap: 8px;
  margin: 4px 0 12px;
}

.pill-btn {
  appearance: none;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-mid);
  min-height: 34px;
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;
}

.pill-btn:hover {
  border-color: var(--line-strong);
  color: var(--text);
  background: rgba(255, 255, 255, 0.1);
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid var(--line);
  min-height: 24px;
  padding: 2px 9px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-mid);
  background: rgba(255, 255, 255, 0.05);
}

.badge-success {
  border-color: rgba(43, 214, 163, 0.64);
  color: #baf7e2;
  background: rgba(43, 214, 163, 0.17);
}

.badge-error {
  border-color: rgba(255, 117, 142, 0.64);
  color: #ffd4df;
  background: rgba(255, 117, 142, 0.18);
}

.badge-warn {
  border-color: rgba(239, 191, 103, 0.62);
  color: #ffe2b0;
  background: rgba(239, 191, 103, 0.16);
}

body[data-visual-mode="light"] .badge-success {
  color: #0e784f;
}

body[data-visual-mode="light"] .badge-error {
  color: #9f2944;
}

body[data-visual-mode="light"] .badge-warn {
  color: #7c4f0b;
}

.status-pending {
  border-color: rgba(239, 191, 103, 0.58);
  color: #ffe3b3;
  background: rgba(239, 191, 103, 0.16);
}

.status-processing {
  border-color: rgba(54, 161, 255, 0.6);
  color: #c8e7ff;
  background: rgba(54, 161, 255, 0.16);
}

.status-success {
  border-color: rgba(43, 214, 163, 0.64);
  color: #baf7e2;
  background: rgba(43, 214, 163, 0.17);
}

.status-failed,
.status-error {
  border-color: rgba(255, 117, 142, 0.64);
  color: #ffd4df;
  background: rgba(255, 117, 142, 0.18);
}

.status-preview {
  border-color: rgba(79, 107, 255, 0.6);
  color: #d0d7ff;
  background: rgba(79, 107, 255, 0.16);
}

.sub-title {
  margin: 6px 0 6px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text-mid);
}

.field-inline-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.input-meta {
  color: var(--text-soft);
  font-size: 11px;
}

.input-meta.warn,
.warn {
  color: var(--warn);
}

.input-meta.error,
.error {
  color: var(--bad);
}

.input-meta.success,
.success {
  color: var(--good);
}

.draft-strip {
  margin-top: 8px;
  border-top: 1px solid var(--line-weak);
  padding-top: 12px;
}

.stats-mini-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
  margin: 8px 0 10px;
}

.mini-stat-card {
  border: 1px solid var(--line-weak);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.03);
  padding: 10px;
}

.mini-stat-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-soft);
  font-weight: 700;
}

.mini-stat-value {
  margin-top: 4px;
  font-size: 13px;
  color: var(--text-strong);
  font-weight: 700;
}

.segmented-control {
  display: inline-flex;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
}

.segment-btn {
  appearance: none;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--text-mid);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  min-height: 30px;
  padding: 5px 12px;
  cursor: pointer;
}

.segment-btn.active {
  border-color: rgba(54, 161, 255, 0.7);
  color: #def1ff;
  background: linear-gradient(140deg, rgba(54, 161, 255, 0.28), rgba(54, 161, 255, 0.09));
}

body[data-visual-mode="light"] .segment-btn.active {
  color: #0f3f7f;
}

.audit-list {
  display: grid;
  gap: 8px;
}

.audit-card {
  border: 1px solid var(--line-weak);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.02);
  padding: 10px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
}

.audit-icon-wrap {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: rgba(54, 161, 255, 0.14);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.audit-icon {
  width: 14px;
  height: 14px;
  color: var(--accent);
}

.audit-content {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.audit-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-strong);
  word-break: break-word;
}

.audit-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  color: var(--text-soft);
  font-size: 11px;
}

.audit-time-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--text-soft);
  display: inline-block;
}

.audit-note {
  margin-top: 4px;
  color: var(--text-mid);
  font-size: 12px;
  font-style: italic;
}

.audit-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
}

.channel-avatar {
  flex-shrink: 0;
}

.avatar-circle {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid var(--line);
  background: linear-gradient(150deg, rgba(54, 161, 255, 0.32), rgba(79, 107, 255, 0.2));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.avatar-stack {
  position: relative;
}

.avatar-fallback {
  font-size: 12px;
  font-weight: 800;
  color: #ffffff;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.channel-avatar.has-avatar .avatar-fallback {
  display: none;
}

.thumb-img {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  object-fit: cover;
  border: 1px solid var(--line);
  flex-shrink: 0;
}

.diag-list {
  display: grid;
  gap: 8px;
}

.diag-item {
  border: 1px solid var(--line-weak);
  border-radius: var(--radius-sm);
  padding: 9px 10px;
  background: rgba(255, 255, 255, 0.02);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--text-mid);
}

.section-divider {
  border-top: 1px dashed var(--line);
  padding-top: 10px;
}

.settings-link {
  width: fit-content;
  text-decoration: none;
}

#toast-container {
  position: fixed;
  right: 14px;
  bottom: 14px;
  z-index: 9999;
  display: grid;
  gap: 8px;
  width: min(320px, calc(100vw - 24px));
}

.toast {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text);
  box-shadow: var(--shadow-md);
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.4;
  animation: slideToast 300ms ease;
}

.toast.success {
  border-color: rgba(43, 214, 163, 0.7);
}

.toast.error {
  border-color: rgba(255, 117, 142, 0.72);
}

.toast.warn {
  border-color: rgba(239, 191, 103, 0.72);
}

.visual-mode-btn {
  min-width: 116px;
}

.card-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.inline-actions-row .btn {
  width: fit-content;
}

#x-field-text,
#field-desc {
  min-height: 132px;
}

.preview-shell .button-row {
  margin-top: 2px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes shimmer {
  0% {
    background-position: 180% 0;
  }
  100% {
    background-position: -50% 0;
  }
}

@keyframes slideToast {
  from {
    transform: translateY(8px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.animate-spin {
  animation: spin 1s linear infinite;
}

@media (min-width: 1040px) {
  .topbar {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  .header-tools {
    grid-template-columns: repeat(2, minmax(150px, 1fr));
    width: min(560px, 100%);
  }

  .hero-grid {
    grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
    align-items: stretch;
  }

  .tab-nav {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    overflow: visible;
  }

  .tab-btn {
    min-width: 0;
  }
}

@media (max-width: 1260px) {
  .dashboard-card-workflow {
    grid-column: span 12;
  }

  .dashboard-card-queue,
  .dashboard-card-history,
  .dashboard-card-cycle {
    grid-column: span 6;
  }
}

@media (max-width: 1080px) {
  .panel-grid-main {
    grid-template-columns: 1fr;
  }

  .panel-grid-secondary {
    grid-template-columns: 1fr;
  }

  .sidebar-col {
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    align-items: start;
  }
}

@media (max-width: 860px) {
  .dashboard-card-queue,
  .dashboard-card-history,
  .dashboard-card-cycle {
    grid-column: span 12;
  }

  .card-header-row {
    flex-direction: column;
    align-items: stretch;
  }

  .control-row {
    grid-template-columns: 1fr;
  }

  .inline-field,
  .inline-field-reel {
    flex-direction: column;
    align-items: stretch;
  }

  .inline-actions {
    width: 100%;
  }

  .inline-actions .btn {
    flex: 1;
  }

  .button-row .btn {
    flex: 1 1 180px;
  }
}

@media (max-width: 640px) {
  .app-shell {
    padding: 10px;
  }

  .topbar,
  .card {
    border-radius: 16px;
  }

  .header-tools {
    grid-template-columns: 1fr;
  }

  .switch-wrap,
  .clock {
    width: 100%;
  }

  .hero-title {
    font-size: clamp(1.28rem, 8vw, 1.8rem);
  }

  .hero-actions .btn {
    width: 100%;
  }

  .hero-action {
    min-width: 0;
  }

  .list-item {
    flex-direction: column;
    align-items: flex-start;
  }

  .item-actions {
    width: 100%;
    justify-content: flex-start;
  }

  #toast-container {
    right: 10px;
    left: 10px;
    width: auto;
  }

  .audit-card {
    grid-template-columns: 1fr;
  }

  .audit-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 460px) {
  .btn {
    width: 100%;
  }

  .button-row {
    display: grid;
  }

  .segmented-control {
    width: 100%;
    justify-content: space-between;
  }

  .segment-btn {
    flex: 1;
  }

  .hero-pill-row {
    display: grid;
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`);

for (let i = 0; i <= 160; i += 1) {
  lines.push(`.u-m-${i}{margin:${i}px !important;}`);
  lines.push(`.u-mx-${i}{margin-left:${i}px !important;margin-right:${i}px !important;}`);
  lines.push(`.u-my-${i}{margin-top:${i}px !important;margin-bottom:${i}px !important;}`);
  lines.push(`.u-mt-${i}{margin-top:${i}px !important;}`);
  lines.push(`.u-mr-${i}{margin-right:${i}px !important;}`);
  lines.push(`.u-mb-${i}{margin-bottom:${i}px !important;}`);
  lines.push(`.u-ml-${i}{margin-left:${i}px !important;}`);

  lines.push(`.u-p-${i}{padding:${i}px !important;}`);
  lines.push(`.u-px-${i}{padding-left:${i}px !important;padding-right:${i}px !important;}`);
  lines.push(`.u-py-${i}{padding-top:${i}px !important;padding-bottom:${i}px !important;}`);
  lines.push(`.u-pt-${i}{padding-top:${i}px !important;}`);
  lines.push(`.u-pr-${i}{padding-right:${i}px !important;}`);
  lines.push(`.u-pb-${i}{padding-bottom:${i}px !important;}`);
  lines.push(`.u-pl-${i}{padding-left:${i}px !important;}`);
}

for (let i = 0; i <= 96; i += 1) {
  lines.push(`.u-gap-${i}{gap:${i}px !important;}`);
  lines.push(`.u-row-gap-${i}{row-gap:${i}px !important;}`);
  lines.push(`.u-col-gap-${i}{column-gap:${i}px !important;}`);
}

for (let i = 8; i <= 96; i += 1) {
  const rem = (i / 16).toFixed(4).replace(/\\.0+$/, '').replace(/(\\.[0-9]*?)0+$/, '$1');
  lines.push(`.u-fs-${i}{font-size:${rem}rem !important;}`);
}

for (let i = 1; i <= 120; i += 1) {
  lines.push(`.u-z-${i}{z-index:${i} !important;}`);
}

for (let i = 0; i <= 100; i += 2) {
  lines.push(`.u-opacity-${i}{opacity:${(i / 100).toFixed(2)} !important;}`);
}

for (let i = 0; i <= 40; i += 1) {
  lines.push(`.u-radius-${i}{border-radius:${i}px !important;}`);
}

for (let i = 0; i <= 100; i += 1) {
  lines.push(`.u-wp-${i}{width:${i}% !important;}`);
  lines.push(`.u-hp-${i}{height:${i}% !important;}`);
}

for (let i = 0; i <= 720; i += 4) {
  lines.push(`.u-w-${i}{width:${i}px !important;}`);
  lines.push(`.u-h-${i}{height:${i}px !important;}`);
}

for (let i = 100; i <= 900; i += 100) {
  lines.push(`.u-fw-${i}{font-weight:${i} !important;}`);
}

for (let i = 1; i <= 60; i += 1) {
  lines.push(`.u-lh-${i}{line-height:${(i / 10).toFixed(1)} !important;}`);
}

for (let i = 0; i <= 360; i += 3) {
  lines.push(`.u-hue-${i}{filter:hue-rotate(${i}deg) !important;}`);
}

for (let i = -240; i <= 240; i += 4) {
  const safe = i < 0 ? `n${Math.abs(i)}` : `${i}`;
  lines.push(`.u-tx-${safe}{transform:translateX(${i}px) !important;}`);
  lines.push(`.u-ty-${safe}{transform:translateY(${i}px) !important;}`);
}

for (let i = 50; i <= 200; i += 2) {
  lines.push(`.u-scale-${i}{transform:scale(${(i / 100).toFixed(2)}) !important;}`);
}

for (let i = 0; i <= 72; i += 2) {
  lines.push(`.u-blur-${i}{backdrop-filter:blur(${(i / 4).toFixed(1)}px) !important;-webkit-backdrop-filter:blur(${(i / 4).toFixed(1)}px) !important;}`);
}

for (let i = 0; i <= 24; i += 1) {
  lines.push(`.u-grid-${i}{display:grid !important;grid-template-columns:repeat(${Math.max(1, i)}, minmax(0, 1fr)) !important;}`);
}

for (let i = 0; i <= 40; i += 1) {
  lines.push(`.u-shadow-${i}{box-shadow:0 ${i}px ${i * 2}px rgba(0,0,0,0.16) !important;}`);
}

for (let i = 0; i <= 360; i += 6) {
  lines.push(`.u-rot-${i}{transform:rotate(${i}deg) !important;}`);
}

for (let i = 5; i <= 100; i += 5) {
  lines.push(`.u-min-wp-${i}{min-width:${i}% !important;}`);
  lines.push(`.u-max-wp-${i}{max-width:${i}% !important;}`);
  lines.push(`.u-min-hp-${i}{min-height:${i}% !important;}`);
  lines.push(`.u-max-hp-${i}{max-height:${i}% !important;}`);
}

for (let i = 0; i <= 90; i += 3) {
  lines.push(`.u-rotateX-${i}{transform:rotateX(${i}deg) !important;}`);
  lines.push(`.u-rotateY-${i}{transform:rotateY(${i}deg) !important;}`);
}

for (let i = 0; i <= 120; i += 2) {
  lines.push(`.u-letter-${i}{letter-spacing:${(i / 100).toFixed(2)}em !important;}`);
}

for (let i = 0; i <= 200; i += 5) {
  lines.push(`.u-max-w-${i * 10}{max-width:${i * 10}px !important;}`);
  lines.push(`.u-min-w-${i * 10}{min-width:${i * 10}px !important;}`);
}

for (let i = 0; i <= 60; i += 1) {
  lines.push(`.u-order-${i}{order:${i} !important;}`);
}

for (let i = -60; i <= 60; i += 1) {
  const key = i < 0 ? `n${Math.abs(i)}` : `${i}`;
  lines.push(`.u-top-${key}{top:${i}px !important;}`);
  lines.push(`.u-left-${key}{left:${i}px !important;}`);
  lines.push(`.u-right-${key}{right:${i}px !important;}`);
  lines.push(`.u-bottom-${key}{bottom:${i}px !important;}`);
}

add(`
.u-flex{display:flex !important;}
.u-inline-flex{display:inline-flex !important;}
.u-grid{display:grid !important;}
.u-block{display:block !important;}
.u-inline-block{display:inline-block !important;}
.u-hidden{display:none !important;}
.u-items-start{align-items:flex-start !important;}
.u-items-center{align-items:center !important;}
.u-items-end{align-items:flex-end !important;}
.u-justify-start{justify-content:flex-start !important;}
.u-justify-center{justify-content:center !important;}
.u-justify-end{justify-content:flex-end !important;}
.u-justify-between{justify-content:space-between !important;}
.u-wrap{flex-wrap:wrap !important;}
.u-nowrap{flex-wrap:nowrap !important;}
.u-col{flex-direction:column !important;}
.u-row{flex-direction:row !important;}
.u-grow{flex:1 1 auto !important;}
.u-no-grow{flex:0 0 auto !important;}
.u-text-left{text-align:left !important;}
.u-text-center{text-align:center !important;}
.u-text-right{text-align:right !important;}
.u-uppercase{text-transform:uppercase !important;}
.u-capitalize{text-transform:capitalize !important;}
.u-lowercase{text-transform:lowercase !important;}
.u-relative{position:relative !important;}
.u-absolute{position:absolute !important;}
.u-sticky{position:sticky !important;}
.u-fixed{position:fixed !important;}
.u-overflow-hidden{overflow:hidden !important;}
.u-overflow-auto{overflow:auto !important;}
.u-overflow-x-auto{overflow-x:auto !important;}
.u-overflow-y-auto{overflow-y:auto !important;}
.u-pointer{cursor:pointer !important;}
.u-no-pointer{pointer-events:none !important;}
.u-select-none{user-select:none !important;}
`);

const output = `${lines.join('\n')}\n`;
const outPath = path.join(__dirname, '..', 'public', 'css', 'style.css');
fs.writeFileSync(outPath, output, 'utf8');
console.log(`Generated ${outPath}`);
console.log(`Line count: ${output.split('\n').length - 1}`);

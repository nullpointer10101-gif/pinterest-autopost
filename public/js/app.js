const state = {
  stats: { totalPosts: 0, queuePending: 0, successRate: 0 },
  currentTab: 'dashboard',
  history: [],
  queue: []
};

document.addEventListener('DOMContentLoaded', () => {
  refreshOverview();
  setInterval(refreshOverview, 30000);
  switchTab('dashboard');
});

function switchTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(el => el.classList.add('hidden'));

  const tabEl = document.getElementById(`tab-${tab}`);
  const panelEl = document.getElementById(`panel-${tab}`);

  if (tabEl) tabEl.classList.add('active');
  if (panelEl) panelEl.classList.remove('hidden');

  if (tab === 'dashboard') loadMiniQueue();
  if (tab === 'queue') loadQueue();
  if (tab === 'history') loadHistory();
  if (tab === 'lab') loadEngagements();
  if (tab === 'settings') loadDiagnostics();
}

async function refreshOverview() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    state.stats = data;

    const totalEl = document.getElementById('stat-total-posts');
    const queueEl = document.getElementById('stat-queue-pending');
    const rateEl = document.getElementById('stat-success-rate');

    if (totalEl) totalEl.textContent = data.totalPosts;
    if (queueEl) queueEl.textContent = data.queuePending;
    if (rateEl) rateEl.textContent = data.successRate + '%';

    if (state.currentTab === 'dashboard') loadMiniQueue();
  } catch (err) {}
}

async function handleFetch() {
  const url = document.getElementById('reel-url').value.trim();
  if (!url) return showToast('Paste a Reel URL first.', 'error');

  try {
    const res = await fetch('/api/pinterest/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showPreview(data);
  } catch (err) { showToast(err.message, 'error'); }
}

function handleManualMedia() {
  const url = document.getElementById('manual-media-url').value.trim();
  if (!url) return showToast('Enter a direct media URL.', 'error');

  const data = {
    reelData: { thumbnailUrl: url, mediaUrl: url, username: 'manual', caption: '' },
    aiContent: { title: 'New Manual Pin', description: 'Published via manual URL input.' }
  };
  showPreview(data);
}

function showPreview(data) {
  document.getElementById('preview-section').classList.remove('hidden');
  document.getElementById('preview-img').src = data.reelData.thumbnailUrl;
  document.getElementById('field-title').value = data.aiContent.title;
  document.getElementById('field-desc').value = data.aiContent.description;
  state.lastExtracted = data;
}

async function handlePost() {
  if (!state.lastExtracted) return;
  try {
    const res = await fetch('/api/pinterest/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...state.lastExtracted,
        title: document.getElementById('field-title').value,
        description: document.getElementById('field-desc').value
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showToast('Deployment successful.', 'success');
    refreshOverview();
  } catch (err) { showToast(err.message, 'error'); }
}

async function handleQueue() {
  if (!state.lastExtracted) return;
  try {
    const res = await fetch('/api/queue/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...state.lastExtracted,
        title: document.getElementById('field-title').value,
        description: document.getElementById('field-desc').value
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showToast('Mission queued.', 'success');
    refreshOverview();
    document.getElementById('preview-section').classList.add('hidden');
  } catch (err) { showToast(err.message, 'error'); }
}

async function loadHistory() {
  try {
    const res = await fetch('/api/history');
    const data = await res.json();
    state.history = data.history;
    const list = document.getElementById('history-list');
    if (!list) return;

    list.innerHTML = data.history.map(item => `
      <div class="list-item">
        <img class="thumb-img" src="${item.thumb || 'https://via.placeholder.com/50'}">
        <div style="flex:1;">
          <div style="font-weight:600; color:#fff;">${escHtml(item.title)}</div>
          <div style="font-size:12px; color:var(--text-2);">@${escHtml(item.username)} • ${new Date(item.createdAt).toLocaleDateString()}</div>
        </div>
        <span class="badge ${item.status === 'error' ? 'badge-error' : 'badge-success'}">${item.status === 'error' ? 'Failed' : 'Posted'}</span>
      </div>
    `).join('');
  } catch (err) {}
}

async function loadQueue() {
  try {
    const res = await fetch('/api/queue');
    const data = await res.json();
    const list = document.getElementById('queue-list');
    if (!list) return;

    list.innerHTML = data.queue.map(item => `
      <div class="list-item">
        <div style="flex:1;">
          <div style="font-weight:600; color:#fff;">${escHtml(item.title)}</div>
          <div style="font-size:12px; color:var(--text-2);">Scheduled Mission</div>
        </div>
        <div style="display:flex; align-items:center; gap:12px;">
            <span class="badge" style="background:rgba(255,255,255,0.05); color:#fff;">PENDING</span>
            <button onclick="deleteQueueItem('${item.id}')" style="background:transparent; border:none; color:var(--accent); cursor:pointer; font-size:16px;">&times;</button>
        </div>
      </div>
    `).join('');
  } catch (err) {}
}

async function loadMiniQueue() {
  try {
    const res = await fetch('/api/queue');
    const data = await res.json();
    const list = document.getElementById('queue-list-mini');
    if (!list) return;
    list.innerHTML = data.queue.slice(0, 3).map(item => `
      <div class="list-item">
        <div style="flex:1;">
          <div style="font-size:14px; font-weight:500;">${escHtml(item.title)}</div>
        </div>
        <span class="badge" style="background:rgba(255,255,255,0.05); font-size:10px;">WAIT</span>
      </div>
    `).join('');
  } catch (err) {}
}

async function loadEngagements() {
  try {
    const res = await fetch('/api/engagements');
    const data = await res.json();
    const list = document.getElementById('engagement-logs');
    if (!list) return;
    list.innerHTML = data.logs.slice(0, 10).map(log => `
      <div class="list-item" style="font-size:13px;">
        <div style="flex:1;">
          <span style="color:var(--accent); font-weight:600;">${log.action.toUpperCase()}</span> 
          <span style="color:var(--text-2); opacity:0.6;">@${new Date(log.timestamp).toLocaleTimeString()}</span>
        </div>
        <a href="${log.url}" target="_blank" style="color:#fff; text-decoration:none; font-size:11px; opacity:0.8;">View</a>
      </div>
    `).join('');
  } catch (err) {}
}

async function startEngager() {
  const niche = document.getElementById('engage-niche').value;
  const count = document.getElementById('engage-count').value;
  const btn = document.getElementById('engage-btn');
  btn.disabled = true;
  btn.textContent = 'Launching...';

  try {
    const res = await fetch('/api/pinterest/engage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ niche, count: parseInt(count) })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showToast('Booster mission active.', 'success');
    loadEngagements();
  } catch (err) { showToast(err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Launch Booster'; }
}

async function loadDiagnostics() {
  try {
    const res = await fetch('/api/system/status');
    const data = await res.json();
    const h = document.getElementById('diag-hosting');
    const g = document.getElementById('diag-github');
    const s = document.getElementById('diag-session');
    if (h) { h.textContent = data.isVercel ? 'Vercel' : 'Local'; h.className = 'badge badge-success'; }
    if (g) { g.textContent = data.githubActions ? 'Active' : 'Error'; g.className = data.githubActions ? 'badge badge-success' : 'badge-error'; }
    if (s) { s.textContent = data.hasSession ? 'Valid' : 'Expired'; s.className = data.hasSession ? 'badge badge-success' : 'badge-error'; }
  } catch (err) {}
}

async function processQueueNow() {
  try {
    const res = await fetch('/api/queue/process', { method: 'POST' });
    const data = await res.json();
    showToast(data.message || 'Bot triggered.');
    refreshOverview();
  } catch (err) {}
}

async function deleteQueueItem(id) {
    if (!confirm('Remove this mission?')) return;
    try {
        await fetch(`/api/queue/${id}`, { method: 'DELETE' });
        loadQueue();
        refreshOverview();
    } catch (err) {}
}

async function clearQueue() {
    if (!confirm('Clear all pending missions?')) return;
    try {
        await fetch('/api/queue/clear', { method: 'POST' });
        loadQueue();
        refreshOverview();
    } catch (err) {}
}

async function clearHistory() {
    if (!confirm('Reset history?')) return;
    try {
        await fetch('/api/history/clear', { method: 'POST' });
        loadHistory();
        refreshOverview();
    } catch (err) {}
}

function exportHistoryJson() {
    const data = state.history || [];
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pinterest-history.json`;
    a.click();
}

async function linkSessionCookie() {
  const cookie = document.getElementById('session-cookie').value;
  try {
    const res = await fetch('/api/session/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showToast('Session Linked.', 'success');
  } catch (err) { showToast(err.message, 'error'); }
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'glass-card';
  toast.style.padding = '12px 20px';
  toast.style.marginBottom = '10px';
  toast.style.fontSize = '13px';
  toast.style.borderLeft = `4px solid ${type === 'error' ? '#ef4444' : '#10b981'}`;
  toast.style.animation = 'slideUp 0.3s ease';
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

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

    document.getElementById('stat-total-posts').textContent = data.totalPosts;
    document.getElementById('stat-queue-pending').textContent = data.queuePending;
    document.getElementById('stat-success-rate').textContent = data.successRate + '%';

    if (state.currentTab === 'dashboard') loadMiniQueue();
  } catch (err) {}
}

async function handleFetch() {
  const url = document.getElementById('reel-url').value.trim();
  if (!url) return showToast('Paste a URL first.', 'error');

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
  if (!url) return showToast('Enter media URL.', 'error');

  const data = {
    reelData: { thumbnailUrl: url, mediaUrl: url, username: 'manual', caption: '' },
    aiContent: { title: 'Untitled Pin', description: 'Added via manual URL.' }
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
    alert('Signal sent to Cloud Bot.');
    refreshOverview();
  } catch (err) { alert(err.message); }
}

async function loadHistory() {
  try {
    const res = await fetch('/api/history');
    const data = await res.json();
    const list = document.getElementById('history-list');
    list.innerHTML = data.history.map(item => `
      <div class="list-item">
        <img class="thumb-img" src="${item.thumb || 'https://via.placeholder.com/50'}">
        <div style="flex:1;">
          <div style="font-weight:600; color:#fff;">${item.title}</div>
          <div style="font-size:12px; color:var(--text-2);">@${item.username} • ${new Date(item.createdAt).toLocaleDateString()}</div>
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
    list.innerHTML = data.queue.map(item => `
      <div class="list-item">
        <div style="flex:1;">
          <div style="font-weight:600; color:#fff;">${item.title}</div>
          <div style="font-size:12px; color:var(--text-2);">Queued Mission</div>
        </div>
        <span class="badge" style="background:rgba(255,255,255,0.05); color:#fff;">Pending</span>
      </div>
    `).join('');
  } catch (err) {}
}

async function loadMiniQueue() {
  try {
    const res = await fetch('/api/queue');
    const data = await res.json();
    const list = document.getElementById('queue-list-mini');
    list.innerHTML = data.queue.slice(0, 3).map(item => `
      <div class="list-item">
        <div style="flex:1;">
          <div style="font-size:14px; font-weight:500;">${item.title}</div>
        </div>
        <span class="badge" style="background:rgba(255,255,255,0.05); font-size:10px;">WAIT</span>
      </div>
    `).join('');
  } catch (err) {}
}

async function loadDiagnostics() {
  try {
    const res = await fetch('/api/system/status');
    const data = await res.json();
    
    const h = document.getElementById('diag-hosting');
    const g = document.getElementById('diag-github');
    const s = document.getElementById('diag-session');

    if (h) {
        h.textContent = data.isVercel ? 'Vercel Cloud' : 'Local Node';
        h.className = 'badge badge-success';
    }
    if (g) {
        g.textContent = data.githubActions ? 'Configured' : 'Missing API Key';
        g.className = data.githubActions ? 'badge badge-success' : 'badge-error';
    }
    if (s) {
        s.textContent = data.hasSession ? 'Active' : 'Expired';
        s.className = data.hasSession ? 'badge badge-success' : 'badge-error';
    }
  } catch (err) {}
}

async function startEngager() {
  const niche = document.getElementById('engage-niche').value;
  const count = document.getElementById('engage-count').value;
  
  const btn = document.getElementById('engage-btn');
  btn.disabled = true;
  btn.textContent = 'Launching Mission...';

  try {
    const res = await fetch('/api/pinterest/engage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ niche, count: parseInt(count) })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    
    showToast('Engagement mission deployed to cloud bot.', 'success');
    loadEngagements();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Launch Mission';
  }
}

async function loadEngagements() {
  try {
    const res = await fetch('/api/engagements');
    const data = await res.json();
    const list = document.getElementById('engagement-logs');
    if (!list) return;
    
    if (!data.logs.length) {
        list.innerHTML = '<div style="color:var(--text-2); font-size:12px; text-align:center;">No recent lab missions.</div>';
        return;
    }

    list.innerHTML = data.logs.slice(0, 10).map(log => `
        <div class="list-item" style="font-size:13px; border-bottom:1px solid rgba(255,255,255,0.05);">
            <div style="flex:1;">
                <span style="color:var(--accent); font-weight:600;">${log.action.toUpperCase()}</span> 
                <span style="color:var(--text-2); opacity:0.6;">@${new Date(log.timestamp).toLocaleTimeString()}</span>
            </div>
            <a href="${log.url}" target="_blank" style="color:var(--text-1); text-decoration:none; font-size:11px;">View Pin</a>
        </div>
    `).join('');
  } catch (err) {}
}

async function clearQueue() {
    if (!confirm('Clear all pending missions?')) return;
    try {
        await fetch('/api/queue/clear', { method: 'POST' });
        showToast('Queue cleared.');
        loadQueue();
        refreshOverview();
    } catch (err) {}
}

async function clearHistory() {
    if (!confirm('Reset all activity logs?')) return;
    try {
        await fetch('/api/history/clear', { method: 'POST' });
        showToast('History reset.');
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
    a.download = `pinterest-history-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
}

function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'glass-card';
    toast.style.padding = '12px 24px';
    toast.style.marginBottom = '10px';
    toast.style.borderLeft = `4px solid ${type === 'error' ? '#ef4444' : '#10b981'}`;
    toast.style.fontSize = '14px';
    toast.style.animation = 'slideUp 0.3s ease';
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

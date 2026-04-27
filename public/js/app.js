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
  const url = document.getElementById('reel-url').value;
  if (!url) return;

  try {
    const res = await fetch('/api/pinterest/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    document.getElementById('preview-section').classList.remove('hidden');
    document.getElementById('preview-img').src = data.reelData.thumbnailUrl;
    document.getElementById('field-title').value = data.aiContent.title;
    document.getElementById('field-desc').value = data.aiContent.description;
    
    state.lastExtracted = data;
  } catch (err) { alert(err.message); }
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

async function processQueueNow() {
  try {
    await fetch('/api/queue/process', { method: 'POST' });
    alert('Bot triggered.');
    refreshOverview();
  } catch (err) {}
}

async function linkSessionCookie() {
  const cookie = document.getElementById('session-cookie').value;
  try {
    await fetch('/api/session/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie })
    });
    alert('Cookie Linked.');
  } catch (err) {}
}

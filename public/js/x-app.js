const xState = {
  queue: [],
  history: [],
  engagements: [],
  lastLoaded: null,
  connected: false,
};

document.addEventListener('DOMContentLoaded', () => {
  bindXEvents();
  refreshXData();
  
  // hook into global refresh
  const originalRefreshAll = window.refreshAll;
  window.refreshAll = async function() {
    if (originalRefreshAll) await originalRefreshAll();
    await refreshXData();
  };
});

function bindXEvents() {
  on('x-manual-load-btn', 'click', handleXManualLoad);
  on('x-queue-btn', 'click', handleXQueue);
  on('x-run-bot-btn', 'click', fireXQueue);
  on('x-engage-btn', 'click', startXEngager);
  on('link-x-session-btn', 'click', linkXSession);
  on('unlink-x-session-btn', 'click', unlinkXSession);
  on('x-field-text', 'input', updateXTextMeta);
}

async function unlinkXSession() {
  if (!confirm('Are you sure you want to unlink X session?')) return;
  try {
    const res = await fetch('/api/x/session', { method: 'DELETE' }).then(r => r.json());
    if (res.success) {
      showToast('X Session Unlinked', 'success');
      if (typeof refreshAll === 'function') refreshAll();
    } else {
      showToast(res.error || 'Failed to unlink', 'error');
    }
  } catch(e) {
    showToast(e.message, 'error');
  }
}

function updateXTextMeta() {
  const el = document.getElementById('x-field-text');
  const meta = document.getElementById('x-field-text-meta');
  if (el && meta) {
    meta.textContent = `${el.value.length}/280 chars`;
  }
}
window.updateXTextMeta = updateXTextMeta;

async function refreshXData() {
  try {
    const [qRes, hRes, eRes, sRes] = await Promise.all([
      fetch('/api/x/queue').then(r => r.json()),
      fetch('/api/x/history').then(r => r.json()),
      fetch('/api/x/engagements').then(r => r.json()),
      fetch('/api/x/session/status').then(r => r.json()).catch(() => ({ success: false })),
    ]);
    if (qRes.success) xState.queue = qRes.queue || [];
    if (hRes.success) xState.history = hRes.history || [];
    if (eRes.success) xState.engagements = eRes.engagements || [];
    xState.connected = !!(sRes.success && sRes.session && sRes.session.hasSession);

    renderXQueueMini();
    renderXHistory();
    renderXEngagements();
  } catch(e) {
    console.error('Failed to fetch X data', e);
  }
}

function handleXManualLoad() {
  const url = document.getElementById('x-manual-media-url').value.trim();
  if (!url) return showToast('Enter media URL for X.', 'error');
  
  xState.lastLoaded = { mediaUrl: url };
  const preview = document.getElementById('x-preview-section');
  const img = document.getElementById('x-preview-img');
  const vid = document.getElementById('x-preview-video');
  
  if (url.includes('.mp4')) {
    img.classList.add('hidden');
    vid.classList.remove('hidden');
    vid.src = url;
  } else {
    vid.classList.add('hidden');
    img.classList.remove('hidden');
    img.src = url;
  }
  
  preview.classList.remove('hidden');
  showToast('X Media loaded', 'success');
}

async function handleXQueue() {
  if (!xState.lastLoaded) return showToast('Load media first.', 'error');
  
  const text = document.getElementById('x-field-text').value.trim();
  const btn = document.getElementById('x-queue-btn');
  btn.disabled = true;
  btn.textContent = 'Queuing...';

  try {
    const res = await fetch('/api/x/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{
          title: text,
          description: '',
          mediaUrl: xState.lastLoaded.mediaUrl
        }]
      })
    }).then(r => r.json());

    if (res.success) {
      showToast(res.message || 'Queued to X.', 'success');
      document.getElementById('x-preview-section').classList.add('hidden');
      document.getElementById('x-field-text').value = '';
      refreshXData();
    } else {
      showToast(res.error || 'Failed to queue.', 'error');
    }
  } catch(e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Queue Tweet';
  }
}

async function fireXQueue() {
  const btn = document.getElementById('x-run-bot-btn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/x/fire-post', { method: 'POST' }).then(r=>r.json());
    if (res.success) showToast(res.message, 'success');
    else showToast(res.error, 'error');
  } catch(e) { showToast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

async function startXEngager() {
  const btn = document.getElementById('x-engage-btn');
  const countInput = document.getElementById('x-engage-count');
  const count = countInput ? countInput.value : 3;
  
  if (count < 1 || count > 20) {
    return showToast('Engagement count must be between 1 and 20', 'error');
  }

  btn.disabled = true;
  try {
    const res = await fetch('/api/x/engage', { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: parseInt(count, 10) })
    }).then(r=>r.json());
    if (res.success) showToast(res.message, 'success');
    else showToast(res.error, 'error');
  } catch(e) { showToast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

async function linkXSession() {
  const val = document.getElementById('x-session-cookie').value.trim();
  if(!val) return showToast('Enter auth_token for X', 'error');
  
  const btn = document.getElementById('link-x-session-btn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/x/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: val })
    }).then(r => r.json());

    if (res.success) {
      showToast('X Session Linked!', 'success');
      document.getElementById('x-session-cookie').value = '';
    } else {
      showToast(res.error || 'Failed to link session', 'error');
    }
  } catch(e) { showToast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

function renderXQueueMini() {
  const list = document.getElementById('x-queue-list-mini');
  if(!list) return;
  const pending = xState.queue.filter(i => i.status === 'pending');
  if(!pending.length) {
    list.innerHTML = '<div class="pulse-item">No pending X missions.</div>';
    return;
  }
  list.innerHTML = pending.slice(0, 4).map(i => `
    <div class="list-item">
      <div class="list-item-main">
        <div>
          <div class="item-title">${i.title || 'Tweet'}</div>
        </div>
      </div>
      <div class="item-actions"><span class="badge status-pending">PENDING</span></div>
    </div>
  `).join('');
}

function renderXHistory() {
  const list = document.getElementById('x-history-list');
  if(!list) return;
  if(!xState.history.length) {
    list.innerHTML = '<div class="pulse-item">No X history yet.</div>';
    return;
  }
  list.innerHTML = xState.history.slice(0, 10).map(i => `
    <div class="list-item">
      <div class="list-item-main">
        <div>
          <div class="item-title">${i.aiContent?.tweetText || 'Tweet'}</div>
          <div class="item-meta">${i.status.toUpperCase()}</div>
        </div>
      </div>
    </div>
  `).join('');
}

function renderXEngagements() {
  const list = document.getElementById('x-engagements-list');
  if(!list) return;
  if(!xState.engagements.length) {
    list.innerHTML = '<div class="pulse-item">No X engagements yet.</div>';
    return;
  }
  list.innerHTML = xState.engagements.slice(0, 10).map(i => `
    <div class="list-item">
      <div class="list-item-main">
        <div>
          <div class="item-title">${i.action.toUpperCase()}</div>
          <div class="item-meta">${i.comment || ''}</div>
        </div>
      </div>
    </div>
  `).join('');
}

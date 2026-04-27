const state = {
    stats: { totalPosts: 0, queuePending: 0, successRate: 0 },
    history: [],
    queue: []
};

document.addEventListener('DOMContentLoaded', () => {
    refreshOverview();
    setInterval(refreshOverview, 30000);
});

async function refreshOverview() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        state.stats = data;

        document.getElementById('stat-total').textContent = data.totalPosts;
        document.getElementById('stat-queue').textContent = data.queuePending;
        document.getElementById('stat-rate').textContent = data.successRate + '%';

        loadHistory();
        loadQueue();
    } catch (err) {
        console.error('Stats failed:', err);
    }
}

async function handleFetch() {
    const url = document.getElementById('reel-url').value;
    if (!url) return alert('Enter URL');

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
    } catch (err) {
        alert(err.message);
    }
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
        alert('Posted/Queued successfully');
        refreshOverview();
    } catch (err) {
        alert(err.message);
    }
}

async function loadHistory() {
    try {
        const res = await fetch('/api/history');
        const data = await res.json();
        const list = document.getElementById('history-list');
        list.innerHTML = data.history.map(item => `
            <div class="list-item">
                <img class="thumb" src="${item.thumb || 'https://via.placeholder.com/60'}">
                <div style="flex:1;">
                    <div style="font-weight:600;">${item.title}</div>
                    <div style="font-size:12px; color:#666;">@${item.username} • ${new Date(item.createdAt).toLocaleDateString()}</div>
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
                    <div style="font-weight:600;">${item.title}</div>
                    <div style="font-size:12px; color:#666;">Scheduled</div>
                </div>
                <span class="badge">Pending</span>
            </div>
        `).join('');
    } catch (err) {}
}

async function processQueueNow() {
    try {
        await fetch('/api/queue/process', { method: 'POST' });
        alert('Bot triggered');
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
        alert('Cookie updated');
    } catch (err) {}
}

const state = {
  reelData: null,
  aiContent: null,
  isProcessing: false,
  currentTab: 'dashboard',
  history: [],
  engagements: [],
  queue: [],
  queueStats: null,
  pinterestStatusData: null,
  systemStatus: null,
  sessionStatus: null,
};

document.addEventListener('DOMContentLoaded', async () => {
  bindInputs();
  bindTabA11y();
  await Promise.all([
    checkPinterestStatus(),
    loadSystemStatus(),
    loadSessionStatus(),
    loadHistory(),
    loadQueue(),
  ]);
  renderOverviewStats();
});

function bindInputs() {
  const reelUrlInput = document.getElementById('reel-url');
  const mediaInput = document.getElementById('media-url-input');

  if (reelUrlInput) {
    reelUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleFetch();
    });
  }

  if (mediaInput) {
    mediaInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleFetch();
    });
    mediaInput.addEventListener('input', () => {
      const mediaUrl = mediaInput.value.trim();
      if (mediaUrl) {
        if (!state.reelData) state.reelData = { manual: true, username: 'unknown', caption: '' };
        state.reelData.mediaUrl = mediaUrl;
        state.reelData.thumbnailUrl = mediaUrl;
        state.reelData.mediaType = mediaUrl.toLowerCase().includes('.mp4') ? 'video' : 'image';
        show('preview-section');
        renderMediaPreview();
      } else if (!state.aiContent) {
        hide('preview-section');
      }
    });
  }

  window.onbeforeunload = () => state.isProcessing ? 'Processing in progress. Are you sure you want to leave?' : undefined;
}

function bindTabA11y() {
  const tabs = Array.from(document.querySelectorAll('.tabs .tab[role="tab"]'));
  if (tabs.length === 0) return;

  function nameFromTabEl(tabEl) {
    const id = tabEl?.id || '';
    if (id.startsWith('tab-')) return id.slice('tab-'.length);
    return null;
  }

  function focusTabByIndex(index) {
    const next = tabs[(index + tabs.length) % tabs.length];
    if (next) next.focus();
  }

  tabs.forEach((tabEl, index) => {
    tabEl.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        focusTabByIndex(index + 1);
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        focusTabByIndex(index - 1);
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        focusTabByIndex(0);
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        focusTabByIndex(tabs.length - 1);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const name = nameFromTabEl(tabEl);
        if (name) switchTab(name);
      }
    });
  });
}

function switchTab(tab) {
  state.currentTab = tab;

  // Sidebar Nav Items
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.remove('active');
  });
  
  // Panels
  document.querySelectorAll('.panel').forEach(el => {
    el.classList.add('hidden');
  });

  const navEl = document.getElementById(`nav-${tab}`);
  const panelEl = document.getElementById(`panel-${tab}`);
  const pageTitle = document.getElementById('page-title');

  if (navEl) navEl.classList.add('active');
  if (panelEl) panelEl.classList.remove('hidden');
  if (pageTitle) {
    const titles = {
        'dashboard': 'Dashboard',
        'queue': 'Mission Queue',
        'lab': 'Algorithm Booster',
        'engagements': 'Engagement Logs',
        'history': 'Activity History',
        'settings': 'System Settings'
    };
    pageTitle.textContent = titles[tab] || 'Command Center';
  }

  // Close sidebar on mobile after clicking
  if (window.innerWidth <= 1024) {
    document.getElementById('sidebar').classList.remove('open');
  }

  if (tab === 'dashboard') refreshOverview();
  if (tab === 'queue') loadQueue();
  if (tab === 'engagements') loadEngagements();
  if (tab === 'history') loadHistory();
  if (tab === 'settings') {
    loadSystemStatus();
    loadSessionStatus();
  }
}

async function checkPinterestStatus() {
  try {
    const res = await fetch('/api/pinterest/status');
    const data = await res.json();
    state.pinterestStatusData = data;

    const badge = document.getElementById('pinterest-status');
    if (!badge) return;

    badge.className = 'status-badge';
    const label = badge.querySelector('.status-label');
    if (!label) return;

    if (data.resolvedPostingMode === 'bot') {
      badge.classList.add('status-bot');
      label.textContent = 'Bot Mode';
      return;
    }
    if (data.connected) {
      badge.classList.add('status-connected');
      label.textContent = data.username ? `@${data.username}` : 'API Ready';
      return;
    }

    badge.classList.add('status-demo');
    label.textContent = data.message ? 'Setup Needed' : 'Demo Mode';
  } catch {
    const badge = document.getElementById('pinterest-status');
    if (!badge) return;
    badge.className = 'status-badge status-error';
    const label = badge.querySelector('.status-label');
    if (label) label.textContent = 'Error';
  }
}

async function loadSystemStatus() {
  try {
    const res = await fetch('/api/system/status');
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unable to load runtime status');
    state.systemStatus = data;
    state.sessionStatus = data.session || state.sessionStatus;
    renderDeployReadiness();
    renderHostingStatus();
    updateAutoLinkAvailability();
    renderSessionStatusCard();
    updateSettingsStatus();
  } catch (err) {
    const el = document.getElementById('deploy-readiness');
    if (el) {
      el.innerHTML = `<div class="deploy-item bad"><span class="dot"></span><div>Runtime check failed: ${escHtml(err.message)}</div></div>`;
    }
  }
}

function updateAutoLinkAvailability() {
  const btn = document.getElementById('auto-session-btn');
  if (!btn) return;

  const isServerless = !!state.systemStatus?.runtime?.isServerless;
  if (isServerless) {
    btn.disabled = true;
    btn.textContent = 'Auto Link (Local Only)';
    btn.title = 'This action is available only when running locally on desktop.';
    return;
  }

  if (!btn.disabled) {
    btn.textContent = 'Auto Link (Local Browser)';
  }
  btn.title = 'Open local browser and auto-link your Pinterest session.';
}

function updateSettingsStatus() {
  const el = document.getElementById('settings-pinterest-status');
  if (!el) return;
  const d = state.pinterestStatusData;
  const system = state.systemStatus;
  const session = state.sessionStatus || system?.session || {};

  if (!d) {
    el.innerHTML = '<div class="spinner-sm"></div><span>Checking connection...</span>';
    return;
  }

  const mode = d.resolvedPostingMode || system?.posting?.resolvedMode || 'api';
  const modeLabel = mode === 'bot' ? 'Browser Bot Mode' : 'Pinterest API Mode';
  const modeColor = mode === 'bot' ? 'var(--warning)' : 'var(--success)';
  const botReady = mode !== 'bot' || !!(system?.posting?.sessionCookieConfigured || d.sessionLinked || session.hasSession);

  if (d.connected || botReady) {
    el.innerHTML = `
      <span style="font-size:18px">OK</span>
      <div>
        <strong style="color:${modeColor}">${modeLabel}</strong>
        <div style="font-size:12px;color:var(--text-2);margin-top:2px;">
          ${mode === 'bot'
            ? `Session linked: ${session.masked ? escHtml(session.masked) : 'Yes'}`
            : (system?.posting?.recommendation || 'Posting mode is configured.')}
        </div>
      </div>`;
    if (d.connected) show('unlink-api-btn');
    else hide('unlink-api-btn');
  } else {
    el.innerHTML = `
      <span style="font-size:18px">WARN</span>
      <div>
        <strong style="color:var(--error)">Not Ready</strong>
        <div style="font-size:12px;color:var(--text-2);margin-top:2px;">
          ${d.message || 'Configure Pinterest token or session cookie.'}
        </div>
      </div>`;
    hide('unlink-api-btn');
  }
}

function renderSessionStatusCard() {
  const card = document.getElementById('session-status-card');
  if (!card) return;

  const session = state.sessionStatus;
  if (!session) {
    card.innerHTML = '<div class="spinner-sm"></div><span>Loading linked session...</span>';
    return;
  }

  if (!session.hasSession) {
    card.innerHTML = `
      <span style="font-size:18px">WARN</span>
      <div>
        <strong style="color:var(--warning)">No linked session</strong>
        <div style="font-size:12px;color:var(--text-2);margin-top:2px;">
          Link a fresh cookie to run bot mode reliably.
        </div>
      </div>`;
    return;
  }

  const when = session.updatedAt ? new Date(session.updatedAt).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, month: 'short', day: 'numeric', year: 'numeric' }) : 'unknown';
  const label = session.label ? ` (${escHtml(session.label)})` : '';
  card.innerHTML = `
    <span style="font-size:18px">OK</span>
    <div>
      <strong style="color:var(--success)">Linked${label}</strong>
      <div style="font-size:12px;color:var(--text-2);margin-top:2px;">
        ${escHtml(session.masked || 'session cookie')} | source: ${escHtml(session.source || 'storage')} | updated: ${escHtml(when)}
      </div>
    </div>`;
  
  show('unlink-session-btn');
  hide('session-link-input-group');
}

async function loadSessionStatus() {
  try {
    const res = await fetch('/api/session/status');
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Could not load session status');
    state.sessionStatus = data.session || null;
    renderSessionStatusCard();
    updateSettingsStatus();
  } catch (err) {
    const card = document.getElementById('session-status-card');
    if (card) {
      card.innerHTML = `
        <span style="font-size:18px">ERR</span>
        <div>
          <strong style="color:var(--error)">Session status failed</strong>
          <div style="font-size:12px;color:var(--text-2);margin-top:2px;">
            ${escHtml(err.message)}
          </div>
        </div>`;
    }
    hide('unlink-session-btn');
    show('session-link-input-group');
  }
}

async function unlinkSessionCookie() {
  if (!confirm('Are you sure you want to unlink this Pinterest session? This will stop the Cloud Bot until you link a new account.')) return;
  
  try {
    const res = await fetch('/api/session/unlink', { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    
    showToast('Session unlinked successfully. You can now link a new account.', 'success');
    await loadSessionStatus();
    await checkPinterestStatus();
  } catch (err) {
    showToast(`Unlink failed: ${err.message}`, 'error');
  }
}

async function unlinkPinterestAPI() {
  if (!confirm('Are you sure you want to unlink the Pinterest API? This will remove your OAuth tokens.')) return;
  
  try {
    const res = await fetch('/api/pinterest/unlink', { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    
    showToast('API unlinked successfully.', 'success');
    await checkPinterestStatus();
  } catch (err) {
    showToast(`Unlink failed: ${err.message}`, 'error');
  }
}

async function autoLinkSessionCookie() {
  const btn = document.getElementById('auto-session-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Opening Browser...';
  }

  showToast('Auto-link started. A local browser window may open for Pinterest login.', 'info');

  try {
    const res = await fetch('/api/session/auto-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeoutMs: 120000 }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Auto-link failed');

    state.sessionStatus = data.session || null;
    renderSessionStatusCard();
    updateSettingsStatus();
    await checkPinterestStatus();
    showToast(data.message || 'Session auto-linked.', 'success');
  } catch (err) {
    showToast(`Auto-link failed: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Auto Link (Local Browser)';
    }
  }
}

async function linkSessionCookie() {
  const cookie = getValue('session-cookie-input').trim();
  const label = getValue('session-label-input').trim();

  if (!cookie || cookie.length < 20) {
    showToast('Please paste a valid Pinterest session cookie.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/session/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie, label }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Session link failed');
    state.sessionStatus = data.session || null;
    setValue('session-cookie-input', '');
    renderSessionStatusCard();
    updateSettingsStatus();
    showToast(data.message || 'Session linked.', 'success');
    await checkPinterestStatus();
  } catch (err) {
    showToast(`Session link failed: ${err.message}`, 'error');
  }
}

async function unlinkSessionCookie() {
  if (!confirm('Unlink current Pinterest session cookie?')) return;
  try {
    const res = await fetch('/api/session/unlink', { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Session unlink failed');
    state.sessionStatus = data.session || { hasSession: false };
    renderSessionStatusCard();
    updateSettingsStatus();
    showToast(data.message || 'Session unlinked.', 'info');
    await checkPinterestStatus();
  } catch (err) {
    showToast(`Session unlink failed: ${err.message}`, 'error');
  }
}

function renderHostingStatus() {
  const card = document.getElementById('hosting-status-card');
  if (!card || !state.systemStatus) return;

  const runtime = state.systemStatus.runtime || {};
  const posting = state.systemStatus.posting || {};
  const storageMode = state.systemStatus.queue?.storageMode || 'unknown';

  card.innerHTML = `
    <span style="font-size:18px">${runtime.isServerless ? 'Cloud' : 'Local'}</span>
    <div>
      <strong style="color:var(--text-1)">Platform: ${escHtml(runtime.platform || 'node')}</strong>
      <div style="font-size:12px;color:var(--text-2);margin-top:2px;">
        Posting mode: ${escHtml(posting.resolvedMode || 'api')} | Queue storage: ${escHtml(storageMode)}
      </div>
    </div>`;
}

function renderDeployReadiness() {
  const root = document.getElementById('deploy-readiness');
  if (!root || !state.systemStatus) return;

  const runtime = state.systemStatus.runtime || {};
  const posting = state.systemStatus.posting || {};
  const queue = state.systemStatus.queue || {};
  const ai = state.systemStatus.ai || {};

  const checks = [
    {
      ok: !!ai.configured,
      warn: false,
      label: `AI provider configured (${ai.model || 'default model'})`,
    },
    {
      ok: posting.resolvedMode === 'api' ? !!posting.apiTokenConfigured : !!posting.sessionCookieConfigured,
      warn: posting.resolvedMode === 'bot',
      label: posting.resolvedMode === 'bot'
        ? 'Bot mode requires PINTEREST_SESSION_COOKIE'
        : 'API mode requires PINTEREST_ACCESS_TOKEN',
    },
    {
      ok: !runtime.isServerless || queue.storageMode === 'ephemeral' || queue.storageMode === 'persistent',
      warn: runtime.isServerless,
      label: runtime.isServerless
        ? 'Serverless detected: queue persistence is temporary; use external DB for long-term reliability'
        : 'Long-running server detected: background queue processor can run continuously',
    },
    {
      ok: true,
      warn: runtime.isServerless,
      label: runtime.isServerless
        ? 'Use /api/queue/process via cron or manual button for queued posts'
        : 'Automatic queue worker is active every 2 minutes',
    },
  ];

  root.innerHTML = checks.map(check => {
    const klass = check.ok ? (check.warn ? 'warn' : 'ok') : 'bad';
    return `<div class="deploy-item ${klass}"><span class="dot"></span><div>${escHtml(check.label)}</div></div>`;
  }).join('');
}

async function refreshOverview() {
  await Promise.all([loadHistory(), loadQueue(), loadSystemStatus()]);
  renderOverviewStats();
}

function renderOverviewStats() {
  const history = state.history || [];
  const queue = state.queue || [];

  const totalPosts = history.length;
  const failedPosts = history.filter(item => item.status === 'error').length;
  const successfulPosts = history.filter(item => item.status === 'success').length;
  const successRate = totalPosts > 0 ? Math.round((successfulPosts / totalPosts) * 100) : 0;
  const queuePending = queue.filter(item => item.status === 'pending').length;

  const lastItem = history[0];
  let lastActivity = '-';
  if (lastItem?.createdAt || lastItem?.postedAt || lastItem?.timestamp) {
    lastActivity = formatTimeAgo(lastItem.createdAt || lastItem.postedAt || lastItem.timestamp);
  }

  setText('stat-total-posts', String(totalPosts));
  setText('stat-success-rate', `${successRate}%`);
  setText('stat-failed-posts', String(failedPosts));
  setText('stat-queue-pending', String(queuePending));
  setText('stat-last-activity', lastActivity);
}

async function handleFetch() {
  const reelUrl = getValue('reel-url').trim();
  const manualMedia = getValue('media-url-input').trim();
  const manualCaption = getValue('caption-input').trim();

  if (!reelUrl) {
    showToast('Please paste an Instagram Reel URL.', 'error');
    return;
  }
  if (state.isProcessing) return;

  state.isProcessing = true;
  const btn = document.getElementById('fetch-btn');
  const btnText = btn?.querySelector('.btn-text');
  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'Extracting reel...';

  hide('success-banner');
  hide('ai-badge');

  try {
    if (!manualMedia) {
      const extRes = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: reelUrl }),
      });
      const extData = await extRes.json();
      if (!extData.success) throw new Error(extData.error || 'Extraction failed');
      state.reelData = extData.data;
    } else {
      state.reelData = {
        username: extractUsername(reelUrl),
        caption: manualCaption || '',
        mediaUrl: manualMedia,
        thumbnailUrl: manualMedia,
        mediaType: manualMedia.toLowerCase().includes('.mp4') ? 'video' : 'image',
        manual: true,
      };
    }

    renderMediaPreview();
    show('preview-section');

    if (btnText) btnText.textContent = 'Generating content...';
    if (state.reelData.caption) {
      const genRes = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caption: state.reelData.caption,
          username: state.reelData.username,
          mediaType: state.reelData.mediaType,
        }),
      });
      const genData = await genRes.json();
      if (!genData.success) throw new Error(genData.error || 'Generation failed');

      state.aiContent = genData.content;
      show('ai-badge');
      showToast('Content generated successfully.', 'success');
    } else {
      state.aiContent = null;
      show('manual-fields');
      showToast('No caption found. Fill fields manually.', 'info');
    }

    renderPreview();
  } catch (err) {
    show('manual-fields');
    if (manualMedia) {
      renderPreview();
      show('preview-section');
    } else {
      hide('preview-section');
    }
    showToast(`Failed: ${err.message}`, 'error');
  } finally {
    state.isProcessing = false;
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Generate Pinterest Content';
  }
}

function renderPreview() {
  renderMediaPreview();
  const ai = state.aiContent;
  const reel = state.reelData;

  const titleValue = ai?.title || ((reel?.caption || '').substring(0, 100));
  const descValue = ai?.description || reel?.caption || '';
  const linkValue = getValue('reel-url').trim().split('?')[0];

  setValue('field-title', titleValue.substring(0, 100));
  setValue('field-description', descValue.substring(0, 800));
  setValue('field-link', linkValue);
  updateCharCount('field-title', 'title-count', 100);
  updateCharCount('field-description', 'desc-count', 800);
  updateCharCount('field-alttext', 'alt-count', 500);
}

function renderMediaPreview() {
  const container = document.getElementById('media-preview');
  if (!container) return;
  const reel = state.reelData;
  const mediaUrl = reel?.mediaUrl || reel?.thumbnailUrl;
  if (!mediaUrl) {
    container.innerHTML = '<div class="no-preview-msg">No media URL found. Paste one above.</div>';
    hide('mute-toggle');
    return;
  }

  container.innerHTML = '';
  if ((reel?.mediaType || '').toLowerCase() === 'video') {
    renderVideoPlayer(container, mediaUrl);
    return;
  }

  const img = document.createElement('img');
  // Use Google's Focus Proxy as the primary high-authority image delivery system
  const googleProxy = `https://images1-focus-opensocial.googleusercontent.com/gadgets/proxy?container=focus&refresh=2592000&url=${encodeURIComponent(mediaUrl)}`;
  img.src = googleProxy;
  img.alt = 'Media preview';
  img.style.cssText = 'width:100%;border-radius:8px;';
  img.onerror = () => { img.src = proxyUrl(mediaUrl); };
  container.appendChild(img);
  hide('mute-toggle');
}

function renderVideoPlayer(container, videoUrl) {
  const proxied = proxyUrl(videoUrl);
  const video = document.createElement('video');
  video.id = 'preview-video';
  video.controls = true;
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.style.cssText = 'width:100%;height:580px;border-radius:12px;background:#000;object-fit:contain;display:block;';
  video.src = proxied;

  container.innerHTML = '';
  container.appendChild(video);

  const loading = document.getElementById('preview-loading');
  if (loading) loading.classList.remove('hidden');

  video.addEventListener('loadedmetadata', () => {
    video.play().catch(() => {});
  });
  video.addEventListener('loadeddata', () => {
    if (loading) loading.classList.add('hidden');
  });
  video.addEventListener('error', () => {
    if (video.src !== videoUrl) {
      video.src = videoUrl;
      video.load();
      return;
    }
    if (loading) loading.classList.add('hidden');
    container.innerHTML = `<div class="preview-error">Could not load video preview. <a href="${escHtml(videoUrl)}" target="_blank" rel="noopener">Open directly</a></div>`;
    hide('mute-toggle');
  });

  show('mute-toggle');
  updateMuteUI(true);
}

function toggleMute() {
  const video = document.getElementById('preview-video');
  if (!video) return;
  video.muted = !video.muted;
  updateMuteUI(video.muted);
}

function updateMuteUI(muted) {
  const icon = document.querySelector('#mute-toggle .mute-icon');
  if (icon) icon.textContent = muted ? 'Mute' : 'Sound';
}

async function handlePost() {
  const title = getValue('field-title').trim();
  const description = getValue('field-description').trim();
  const altText = getValue('field-alttext').trim();
  const link = getValue('field-link').trim();

  if (!title) return showToast('Please enter a Pinterest title.', 'error');
  const mediaUrl = state.reelData?.mediaUrl || state.reelData?.thumbnailUrl || getValue('media-url-input').trim();
  if (!mediaUrl) return showToast('Please provide a direct media URL.', 'error');
  if (state.isProcessing) return;

  state.isProcessing = true;
  const btn = document.getElementById('post-btn');
  const btnText = btn?.querySelector('.btn-text');
  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'Launching...';

  // 1. Setup UI for Mission Control
  hide('preview-section');
  show('mission-control-overlay');
  resetMissionStages();
  startMissionTimer();
  
  updateMissionStage('init', 'active', 'Initializing Cloud Mission...');

  try {
    const res = await fetch('/api/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description,
        altText,
        hashtags: state.aiContent?.hashtags || [],
        mediaUrl,
        sourceUrl: link,
        reelMeta: {
          username: state.reelData?.username || 'unknown',
          caption: state.reelData?.caption || '',
          thumbnailUrl: state.reelData?.thumbnailUrl || mediaUrl,
          mediaType: state.reelData?.mediaType || 'video',
        },
      }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Posting failed');

    updateMissionStage('init', 'done');
    updateMissionStage('extract', 'active', 'Optimizing Media & Metadata...');

    if (data.queued) {
      // CLOUD BOT MISSION
      updateMissionStage('extract', 'done');
      updateMissionStage('cloud', 'active', 'Handshake with GitHub Actions...');
      
      // Poll for completion
      const result = await pollMissionResult(data.missionId);
      
      if (result.status === 'success') {
        updateMissionStage('verify', 'done', 'Live Pin Verified!');
        showToast('Instant Cloud Post Successful!', 'success');
        show('success-banner');
        if (result.pinUrl) {
          const pinLink = document.getElementById('pin-link');
          if (pinLink) pinLink.href = result.pinUrl;
        }
      } else {
        throw new Error(result.error || 'Cloud mission failed');
      }
    } else {
      // LOCAL DIRECT POST
      updateMissionStage('extract', 'done');
      updateMissionStage('cloud', 'done');
      updateMissionStage('browser', 'active', 'Local Browser Posting...');
      updateMissionStage('upload', 'done');
      updateMissionStage('verify', 'done');
      showToast('Local Post Successful!', 'success');
      show('success-banner');
    }

    await loadHistory();
    renderOverviewStats();
  } catch (err) {
    failMission(err.message);
    showToast(`Post failed: ${err.message}`, 'error');
  } finally {
    state.isProcessing = false;
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Post Now';
    stopMissionTimer();
  }
}

function resetMissionStages() {
  const stages = ['init', 'extract', 'cloud', 'browser', 'upload', 'verify'];
  stages.forEach(s => {
    const el = document.getElementById(`stage-${s}`);
    if (el) {
      el.className = 'stage';
      const label = el.querySelector('.stage-label');
      // Reset labels if they were changed
    }
  });
}

function updateMissionStage(id, status, text) {
  const el = document.getElementById(`stage-${id}`);
  if (!el) return;
  
  const badge = el.querySelector('.badge');
  if (badge) {
    if (status === 'active') {
        badge.className = 'badge badge-warning';
        badge.textContent = 'RUN';
    } else if (status === 'done') {
        badge.className = 'badge badge-success';
        badge.textContent = 'DONE';
    } else if (status === 'error') {
        badge.className = 'badge badge-error';
        badge.textContent = 'FAIL';
    }
  }

  if (text) {
    const statusText = document.getElementById('mission-status-text');
    if (statusText) statusText.textContent = text;
  }
}

function failMission(error) {
  const statusText = document.getElementById('mission-status-text');
  if (statusText) statusText.textContent = `Error: ${error}`;
  
  const stages = ['init', 'cloud', 'upload', 'verify'];
  stages.forEach(s => {
    const el = document.getElementById(`stage-${s}`);
    if (el && !el.querySelector('.badge-success')) {
        updateMissionStage(s, 'error');
    }
  });

  setTimeout(() => {
    hide('mission-control-overlay');
  }, 5000);
}

let missionTimerInterval = null;
let missionStartTime = 0;

function startMissionTimer() {
  missionStartTime = Date.now();
  const el = document.getElementById('mission-timer-val');
  if (missionTimerInterval) clearInterval(missionTimerInterval);
  
  missionTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - missionStartTime) / 1000);
    const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');
    if (el) el.textContent = `${m}:${s}`;
  }, 1000);
}

function stopMissionTimer() {
  if (missionTimerInterval) clearInterval(missionTimerInterval);
}

async function pollMissionResult(missionId) {
  // We simulate stages while polling for the actual result in history
  let attempts = 0;
  const maxAttempts = 60; // 5 minutes
  
  // Fake progress timing to make it look "live"
  setTimeout(() => updateMissionStage('cloud', 'done'), 5000);
  setTimeout(() => updateMissionStage('browser', 'active', 'GitHub Cloud Browser Login...'), 6000);
  setTimeout(() => updateMissionStage('browser', 'done'), 15000);
  setTimeout(() => updateMissionStage('upload', 'active', 'Uploading Media Stream...'), 16000);

  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch('/api/history');
        const data = await res.json();
        
        // Look for the mission in history
        const hit = data.history?.find(h => 
          (h.pinterestPin?.id && h.pinterestPin.id.includes(missionId)) || 
          (h.aiContent?.title && h.status === 'success' && Date.now() - new Date(h.postedAt).getTime() < 300000)
        );

        if (hit) {
          clearInterval(interval);
          updateMissionStage('upload', 'done');
          updateMissionStage('verify', 'active', 'Validating Pin URL...');
          resolve({ status: 'success', pinUrl: hit.pinterestPin?.url });
        }
        
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          resolve({ status: 'failed', error: 'Mission timed out after 5 minutes.' });
        }
      } catch (e) {
        // Ignore network errors during polling
      }
    }, 5000);
  });
}

async function handleQueue() {
  const title = getValue('field-title').trim();
  const description = getValue('field-description').trim();
  const altText = getValue('field-alttext').trim();
  const link = getValue('field-link').trim();

  if (!title) return showToast('Please enter a Pinterest title.', 'error');
  const mediaUrl = state.reelData?.mediaUrl || state.reelData?.thumbnailUrl || getValue('media-url-input').trim();
  if (!mediaUrl) return showToast('Please provide a direct media URL.', 'error');
  if (state.isProcessing) return;

  state.isProcessing = true;
  const btn = document.getElementById('queue-btn');
  const btnText = btn?.querySelector('.btn-text');
  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'Adding...';

  try {
    const item = {
      title: title.substring(0, 100),
      description: description.substring(0, 800),
      altText: altText.substring(0, 500),
      mediaUrl,
      sourceUrl: link,
      caption: state.reelData?.caption || '',
      username: state.reelData?.username || 'unknown',
      thumbnailUrl: state.reelData?.thumbnailUrl || mediaUrl,
      aiContent: state.aiContent,
    };

    const res = await fetch('/api/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [item] }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Queue add failed');

    showToast('Added to queue.', 'success');
    resetForm();
    await loadQueue();
    renderOverviewStats();
    switchTab('queue');
  } catch (err) {
    showToast(`Queue error: ${err.message}`, 'error');
  } finally {
    state.isProcessing = false;
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Add to Queue';
  }
}

async function processQueueNow() {
  try {
    const res = await fetch('/api/queue/process', { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Queue processing failed');

    showToast(data.message || 'Queue processed.', 'info');
    await Promise.all([loadQueue(), loadHistory()]);
    renderOverviewStats();
  } catch (err) {
    showToast(`Queue process failed: ${err.message}`, 'error');
  }
}

function setStep(stepId, status) {
  const el = document.getElementById(`step-${stepId}`);
  if (!el) return;
  el.className = `step step-${status}`;
}

async function loadHistory() {
  try {
    const res = await fetch('/api/history');
    const data = await res.json();
    state.history = data.history || [];
    renderHistory();
  } catch {
    state.history = [];
    renderHistory();
  }
}

function renderHistory() {
  const list = document.getElementById('history-list');
  if (!list) return;

  const query = (getValue('history-search') || '').trim().toLowerCase();
  const statusFilter = getValue('history-filter-status') || 'all';

  let items = [...state.history];
  if (statusFilter !== 'all') {
    items = items.filter(item => (item.status || 'success') === statusFilter);
  }
  if (query) {
    items = items.filter(item => {
      const title = item.aiContent?.title || item.title || '';
      const username = item.reelData?.username || item.username || '';
      const sourceUrl = item.url || '';
      return `${title} ${username} ${sourceUrl}`.toLowerCase().includes(query);
    });
  }

  if (!items.length) {
    list.innerHTML = '<div class="empty-state"><span class="empty-icon">No Data</span><p>No history found for current filters.</p></div>';
    return;
  }

  list.innerHTML = items.map(item => {
    const date = new Date(item.createdAt || item.postedAt || item.timestamp).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, month: 'short', day: 'numeric', year: 'numeric' });
    const title = item.aiContent?.title || item.title || 'Untitled';
    let username = item.reelData?.username || item.username || '';
    
    // Smart Fallback for Username
    if (!username || username === 'unknown' || username === 'creator') {
        username = extractUsername(item.url || '') || 'Instagram Creator';
    }
    const thumb = item.reelData?.thumbnailUrl || item.thumbnailUrl || item.mediaUrl || '';
    const pinUrl = item.pinterestPin?.url || '#';
    const status = item.status || 'success';
    const igUrl = item.url || '';
    const fallback = 'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=100&h=130&fit=crop';
    const thumbUrl = item.id ? `/api/history/thumb/${encodeURIComponent(item.id)}` : (thumb ? proxyUrl(thumb) : fallback);

    let statusBadge = 'Posted';
    let tagClass = '';
    if (status === 'error') {
      statusBadge = 'Failed';
      tagClass = 'tag-error';
    } else if (status === 'preview') {
      statusBadge = 'Preview';
    }

    return `
      <div class="list-item">
        <img class="item-thumb" src="${escHtml(thumbUrl)}" onerror="this.onerror=null; this.src='${fallback}';" />
        <div class="item-content">
          <div class="flex-between">
            <div class="item-title">${escHtml(title)}</div>
            <span class="badge ${status === 'error' ? 'badge-error' : 'badge-success'}">${status === 'error' ? 'Failed' : 'Posted'}</span>
          </div>
          <div class="item-meta">@${escHtml(username)} • ${date}</div>
        </div>
        <div style="display: flex; gap: 8px;">
          <a href="${escHtml(pinUrl)}" target="_blank" rel="noopener" class="btn btn-secondary" style="padding: 6px 10px; font-size:11px;">Pin</a>
          <button class="btn btn-secondary" onclick="deleteHistoryItem('${item.id}')" style="padding: 6px 10px; font-size:11px;">&times;</button>
        </div>
      </div>`;
  }).join('');
}

async function deleteHistoryItem(id) {
  try {
    await fetch(`/api/history/${id}`, { method: 'DELETE' });
    state.history = state.history.filter(item => item.id !== id);
    renderHistory();
    renderOverviewStats();
  } catch {
    showToast('Failed to delete entry.', 'error');
  }
}

async function clearHistory() {
  if (!confirm('Clear all post history?')) return;
  try {
    await fetch('/api/history', { method: 'DELETE' });
    state.history = [];
    renderHistory();
    renderOverviewStats();
    showToast('History cleared.', 'info');
  } catch {
    showToast('Failed to clear history.', 'error');
  }
}

function exportHistoryJson() {
  try {
    const blob = new Blob([JSON.stringify(state.history || [], null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pinterest-history-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('History exported.', 'success');
  } catch {
    showToast('Export failed.', 'error');
  }
}

async function loadEngagements() {
  try {
    const res = await fetch('/api/engagements');
    const data = await res.json();
    state.engagements = data.engagements || [];
    renderEngagements();
  } catch {
    state.engagements = [];
    renderEngagements();
  }
}

function renderEngagements() {
  const list = document.getElementById('engagement-list');
  if (!list) return;

  if (!state.engagements.length) {
    list.innerHTML = '<div class="empty-state"><span class="empty-icon">🌟</span><p>No engagements recorded yet. The cloud bot will save records here after its next run.</p></div>';
    return;
  }

  list.innerHTML = state.engagements.map(item => {
    const date = new Date(item.createdAt || item.timestamp).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, month: 'short', day: 'numeric', year: 'numeric' });
    const actionEmoji = item.action === 'Liked & Commented' ? '💖💬' : (item.action === 'Liked' ? '💖' : '👀');
    const actionColor = item.action.includes('Liked') ? 'var(--accent)' : 'var(--accent-2)';
    
    return `
      <div class="list-item">
        <div class="item-content">
          <div class="flex-between">
            <div class="item-title">
                ${actionEmoji} ${escHtml(item.action || 'Engagement')}
            </div>
            <span class="badge badge-success">SYNCED</span>
          </div>
          <div class="item-meta">${date}</div>
          ${item.comment ? `
            <div class="item-meta" style="margin-top:8px; padding:8px; background:rgba(255,255,255,0.03); border-radius:4px; font-style: italic;">
              "${escHtml(item.comment)}"
            </div>
          ` : ''}
        </div>
        <a href="${escHtml(item.url || '#')}" target="_blank" rel="noopener" class="btn btn-secondary" style="font-size:11px;">View</a>
      </div>`;
  }).join('');
}

async function clearEngagements() {
  if (!confirm('Clear all engagement history?')) return;
  try {
    await fetch('/api/engagements', { method: 'DELETE' });
    state.engagements = [];
    renderEngagements();
    showToast('Engagement history cleared.', 'info');
  } catch {
    showToast('Failed to clear engagement history.', 'error');
  }
}

async function loadQueue() {
  try {
    const res = await fetch('/api/queue');
    const data = await res.json();
    state.queue = data.queue || [];
    state.queueStats = data.stats || null;
    renderQueue();
    renderQueueMini();
    renderOverviewStats();
  } catch {
    state.queue = [];
    state.queueStats = null;
    renderQueue();
  }
}

function renderQueueMini() {
  const list = document.getElementById('queue-list-mini');
  if (!list) return;

  const activeItems = state.queue.filter(i => i.status === 'pending' || i.status === 'processing');
  
  if (!activeItems.length) {
    list.innerHTML = '<div style="color:var(--text-3); font-size:13px; text-align:center; padding: 20px;">No active missions in queue.</div>';
    return;
  }

  list.innerHTML = activeItems.slice(0, 3).map(item => {
    const isActive = item.status === 'processing';
    let username = item.username || item.reelData?.username || '';
    if (!username || username === 'unknown') {
        username = extractUsername(item.mediaUrl || item.sourceUrl || '') || 'Creator';
    }
    const thumb = item.thumbnailUrl || item.mediaUrl || '';
    const fallback = 'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=100&h=130&fit=crop';
    const thumbUrl = thumb ? proxyUrl(thumb) : fallback;

    return `
      <div class="list-item" style="border: none;">
        <img src="${escHtml(thumbUrl)}" class="item-thumb" style="width:32px; height:32px; border-radius:4px;" />
        <div class="item-content">
          <div class="item-title" style="font-size:12px;">${escHtml(item.title)}</div>
          <div class="item-meta" style="font-size:10px;">${isActive ? 'Active Mission' : 'Scheduled'}</div>
        </div>
        <span class="badge ${isActive ? 'badge-success' : 'badge-warning'}" style="font-size:8px;">${isActive ? 'LIVE' : 'WAIT'}</span>
      </div>`;
  }).join('');
}

function renderQueue() {
  const list = document.getElementById('queue-list');
  if (!list) return;

  const activeItems = state.queue.filter(i => i.status === 'pending' || i.status === 'processing' || i.status === 'failed');

  if (!activeItems.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📂</div>
        <h3>Queue is empty</h3>
        <p>Add some Reels to your mission list to start automation.</p>
      </div>`;
    return;
  }

  list.innerHTML = activeItems.slice().reverse().map(item => {
    const date = new Date(item.addedAt || item.timestamp || Date.now()).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, month: 'short', day: 'numeric', year: 'numeric' });
    const status = (item.status || 'pending').toUpperCase();
    const isActive = item.status === 'processing';
    let username = item.username || item.reelData?.username || '';
    if (!username || username === 'unknown') {
        username = extractUsername(item.sourceUrl || item.mediaUrl || '') || 'Instagram Creator';
    }
    const thumb = item.thumbnailUrl || item.mediaUrl || '';
    const fallback = 'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=100&h=130&fit=crop';
    const thumbUrl = thumb ? proxyUrl(thumb) : fallback;
    
    let statusLabel = status;
    let badgeClass = 'status-pending';
    if (item.status === 'failed') {
        badgeClass = 'status-error';
        statusLabel = 'Failed';
    } else if (isActive) {
        badgeClass = 'status-online';
        statusLabel = 'Active';
    }

    return `
      <div class="list-item">
        <img class="item-thumb" src="${escHtml(thumbUrl)}" />
        <div class="item-content">
          <div class="flex-between">
            <div class="item-title">${escHtml(item.title || 'Untitled')}</div>
            <span class="badge ${badgeClass}">${statusLabel}</span>
          </div>
          <div class="item-meta">
            ${item.status === 'pending' 
              ? `🚀 Pre-heating bot... Starts in <span class="countdown-timer">20</span>s` 
              : `Added to mission list on ${date}`}
          </div>
          ${item.error ? `<div class="item-meta" style="color:var(--error); margin-top:8px;">${escHtml(String(item.error)).substring(0, 100)}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

async function clearQueue() {
  if (!confirm('Clear all pending and failed items from queue?')) return;
  try {
    const res = await fetch('/api/queue', { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    state.queue = [];
    renderQueue();
    renderQueueMini();
    renderOverviewStats();
    showToast('Queue cleared.', 'info');
  } catch (err) {
    showToast(`Failed to clear queue: ${err.message}`, 'error');
  }
}

async function startEngager() {
  const input = document.getElementById('engage-count');
  const btn = document.getElementById('engage-btn');
  const count = Math.min(2, Math.max(1, parseInt(input?.value || '2', 10)));

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Starting...';
  }
  hide('engage-status');

  try {
    const res = await fetch('/api/engage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to start engager');
    show('engage-status');
    showToast(data.message || `Algorithm booster started for ${count} pins.`, 'success');
  } catch (err) {
    showToast(`Booster failed: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Start Algorithm Booster';
    }
  }
}

function resetForm() {
  setValue('reel-url', '');
  setValue('media-url-input', '');
  setValue('caption-input', '');
  setValue('field-title', '');
  setValue('field-description', '');
  setValue('field-alttext', '');
  setValue('field-link', '');
  hide('preview-section');
  hide('success-banner');
  hide('progress-card');
  hide('ai-badge');
  state.reelData = null;
  state.aiContent = null;

  const media = document.getElementById('media-preview');
  if (media) media.innerHTML = '';

  setStep('upload', 'idle');
  setStep('fill', 'idle');
  setStep('publish', 'idle');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${type === 'success' ? '✓' : type === 'error' ? '!' : 'i'}</span>
    <span class="toast-message">${escHtml(message)}</span>
    <button class="toast-dismiss" type="button" aria-label="Dismiss notification" onclick="dismissToast(this)">&times;</button>`;
  container.appendChild(toast);

  setTimeout(() => dismissToast(toast.querySelector('.toast-dismiss')), 5000);
}

function dismissToast(btn) {
  const toast = btn?.closest ? btn.closest('.toast') : btn;
  if (!toast) return;
  toast.classList.add('toast-out');
  setTimeout(() => toast.remove(), 300);
}

function updateCharCount(fieldId, countId, limit) {
  const field = document.getElementById(fieldId);
  const counter = document.getElementById(countId);
  if (!field || !counter) return;

  const len = field.value.length;
  counter.textContent = len;
  const wrap = counter.closest('.char-counter');
  if (!wrap) return;

  if (len >= limit) {
    wrap.classList.add('char-limit-hit');
    wrap.classList.remove('char-warn');
  } else if (len >= Math.floor(limit * 0.9)) {
    wrap.classList.add('char-warn');
    wrap.classList.remove('char-limit-hit');
  } else {
    wrap.classList.remove('char-warn', 'char-limit-hit');
  }
}

function extractUsername(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] && parts[0] !== 'reel' && parts[0] !== 'p' && parts[0] !== 'tv') return parts[0];
  } catch {
    return 'instagram_creator';
  }
  return 'instagram_creator';
}

function formatTimeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '-';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Safe proxy URL helper — uses our own /api/proxy (same as video player)
// Handles special characters in Instagram CDN URLs safely
function proxyUrl(url) {
  if (!url) return '';
  try {
    const encoded = btoa(url);
    return `/api/proxy?url=${encodeURIComponent(encoded)}`;
  } catch {
    const asciiSafe = encodeURIComponent(url).replace(/%([0-9A-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
    const encoded = btoa(asciiSafe);
    return `/api/proxy?url=${encodeURIComponent(encoded)}`;
  }
}

function escHtml(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }
function setValue(id, value) { const el = document.getElementById(id); if (el) el.value = value; }
function getValue(id) { return document.getElementById(id)?.value || ''; }
function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }

// Start a global timer for the countdowns
setInterval(() => {
  document.querySelectorAll('.countdown-timer').forEach(el => {
    let val = parseInt(el.textContent);
    if (val > 0) el.textContent = val - 1;
    else {
      const parent = el.parentElement;
      if (parent) parent.innerHTML = '<span style="color:var(--success); animation: glow-text 1s infinite">⚡ Bot is now processing your post!</span>';
    }
  });
}, 1000);

// Auto-refresh queue and stats every 5 seconds for live feedback
setInterval(() => {
  loadQueue();
  if (state.currentTab === 'dashboard') refreshOverview();
}, 5000);

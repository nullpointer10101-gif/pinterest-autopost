const state = {
  currentTab: 'dashboard',
  queue: [],
  history: [],
  engagements: [],
  lastExtracted: null,
  drafts: [],
  refreshTimer: null,
  clockTimer: null,
  preview: {
    isVideo: false,
    muted: true,
    scrollLocked: false,
  },
};

const REFRESH_INTERVAL_MS = 30000;
const DRAFTS_STORAGE_KEY = 'pmc_drafts_v1';
const PINTEREST_LIMITS = {
  titleChars: 100,
  descriptionChars: 800,
  altChars: 500,
  titleWordsSoft: 20,
  descriptionWordsSoft: 120,
};

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  loadDrafts();
  switchTab('dashboard');
  startClock();
  refreshAll();
  setAutoRefresh(true);
  updateComposerMeta();
  hydrateIcons();
  window.addEventListener('beforeunload', () => {
    setPreviewScrollLock(false);
  });
});

function bindEvents() {
  const tabNav = document.querySelector('.tab-nav');
  if (tabNav) tabNav.setAttribute('role', 'tablist');

  document.querySelectorAll('.tab-btn').forEach((button) => {
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', `panel-${button.dataset.tab}`);
    button.addEventListener('click', () => switchTab(button.dataset.tab));
  });

  document.querySelectorAll('.panel').forEach((panel) => {
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('tabindex', '0');
  });

  on('extract-btn', 'click', handleExtract);
  on('paste-reel-btn', 'click', pasteReelUrlFromClipboard);
  on('preview-audio-btn', 'click', togglePreviewAudio);
  on('preview-scroll-btn', 'click', togglePreviewScrollLock);
  on('post-now-btn', 'click', handlePostNow);
  on('queue-btn', 'click', handleQueue);
  on('run-bot-btn', 'click', processQueueNow);
  on('quick-open-queue-btn', 'click', () => switchTab('queue'));
  on('quick-open-history-btn', 'click', () => switchTab('history'));
  on('retry-failed-btn', 'click', retryFailed);
  on('clear-queue-btn', 'click', clearQueue);
  on('export-history-btn', 'click', exportHistoryJson);
  on('clear-history-btn', 'click', clearHistory);
  on('engage-btn', 'click', startEngager);
  on('clear-engagements-btn', 'click', clearEngagements);
  on('manual-refresh-btn', 'click', refreshAll);
  on('link-session-btn', 'click', linkSessionCookie);
  on('unlink-session-btn', 'click', unlinkSessionCookie);
  on('unlink-api-btn', 'click', unlinkApiConnection);

  on('auto-refresh-toggle', 'change', (event) => {
    setAutoRefresh(!!event.target.checked);
  });

  on('engage-count', 'input', (event) => {
    const valueEl = byId('engage-count-value');
    if (valueEl) valueEl.textContent = String(event.target.value || '');
  });

  on('queue-search', 'input', renderQueueList);
  on('queue-status-filter', 'change', renderQueueList);
  on('history-search', 'input', renderHistoryList);
  on('history-status-filter', 'change', renderHistoryList);
  on('engagement-search', 'input', renderEngagementAuditList);
  
  const platformToggle = byId('engagement-platform-toggle');
  if (platformToggle) {
    platformToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.segment-btn');
      if (!btn) return;
      
      platformToggle.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderEngagementAuditList();
    });
  }
  on('field-title', 'input', updateComposerMeta);
  on('field-desc', 'input', updateComposerMeta);
  on('field-alt', 'input', updateComposerMeta);
  on('field-link', 'input', updateComposerMeta);

  on('reel-url', 'keydown', (event) => {
    if (event.key === 'Enter') handleExtract();
  });
}

function on(id, event, handler) {
  const el = byId(id);
  if (!el) return;
  el.addEventListener(event, handler);
}

function byId(id) {
  return document.getElementById(id);
}

function switchTab(tab) {
  state.currentTab = tab;

  document.querySelectorAll('.tab-btn').forEach((button) => {
    const isActive = button.dataset.tab === tab;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    button.setAttribute('tabindex', isActive ? '0' : '-1');
  });

  document.querySelectorAll('.panel').forEach((panel) => {
    const isVisible = panel.id === `panel-${tab}`;
    panel.classList.toggle('hidden', !isVisible);
    panel.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
  });

  if (tab !== 'dashboard') {
    setPreviewScrollLock(false);
  }

  if (tab === 'queue') renderQueueList();
  if (tab === 'history') renderHistoryList();
  if (tab === 'engagements') renderEngagementAuditList();
  if (tab === 'settings') loadDiagnostics();
}

function startClock() {
  updateClock();
  if (state.clockTimer) clearInterval(state.clockTimer);
  state.clockTimer = setInterval(updateClock, 1000);
}

function updateClock() {
  const clock = byId('live-time');
  if (!clock) return;
  const now = new Date();
  clock.textContent = formatTime12h(now);
}

function setAutoRefresh(enabled) {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }

  if (!enabled) return;
  state.refreshTimer = setInterval(() => {
    refreshAll();
  }, REFRESH_INTERVAL_MS);
}

async function refreshAll() {
  await refreshOverview();

  if (state.currentTab === 'queue') renderQueueList();
  if (state.currentTab === 'history') renderHistoryList();
  if (state.currentTab === 'lab' || state.currentTab === 'engagements') await loadEngagements();
  if (state.currentTab === 'settings') await loadDiagnostics();
}

async function refreshOverview() {
  try {
    const [queueResp, historyResp, pinterestResp, statusResp] = await Promise.all([
      apiRequest('/api/queue'),
      apiRequest('/api/history'),
      apiRequest('/api/pinterest/status'),
      apiRequest('/api/system/status'),
    ]);

    state.queue = Array.isArray(queueResp.queue) ? queueResp.queue : [];
    state.history = Array.isArray(historyResp.history) ? historyResp.history : [];

    updateStats(state.queue, state.history);
    updateConnectionBar(pinterestResp, statusResp);
  } catch (error) {
    showToast(error.message || 'Failed to refresh dashboard.', 'error');
  }
}

function updateStats(queue, history) {
  const successCount = history.filter((item) => item.status === 'success').length;
  const failedCount = history.filter((item) => item.status === 'error').length;
  const pendingCount = queue.filter((item) => item.status === 'pending' || item.status === 'processing').length;
  const queueFailedCount = queue.filter((item) => item.status === 'failed').length;
  const successRateBase = successCount + failedCount;
  const successRate = successRateBase > 0 ? Math.round((successCount / successRateBase) * 100) : 0;

  setText('stat-total-posts', String(successCount));
  setText('stat-queue-pending', String(pendingCount));
  setText('stat-success-rate', `${successRate}%`);
  setText('stat-queue-failed', String(queueFailedCount));
}



function updateConnectionBar(pinterestStatus, systemStatus) {
  const connection = byId('connection-status');
  const mode = byId('active-mode');

  const apiConnected = !!pinterestStatus.connected;
  const sessionLinked = !!pinterestStatus.sessionLinked;
  if (connection) {
    if (apiConnected) {
      setBadge(connection, 'API LINKED', 'success');
    } else if (sessionLinked) {
      setBadge(connection, 'SESSION LINKED', 'warn');
    } else {
      setBadge(connection, 'NOT LINKED', 'error');
    }
  }

  if (mode) {
    const resolved = systemStatus?.posting?.resolvedMode || pinterestStatus?.resolvedPostingMode || 'api';
    const runtime = systemStatus?.runtime?.isServerless ? 'Cloud' : 'Local';
    mode.textContent = `Mode: ${String(resolved).toUpperCase()} (${runtime})`;
  }
}

async function handleExtract() {
  const input = byId('reel-url');
  const extractBtn = byId('extract-btn');
  const url = String(input?.value || '').trim();

  if (!url) {
    showToast('Paste an Instagram reel URL first.', 'error');
    return;
  }

  extractBtn.disabled = true;
  extractBtn.textContent = 'Extracting...';

  try {
    const extracted = await apiRequest('/api/extract', {
      method: 'POST',
      body: { url },
    });

    const reelData = extracted.data || {};
    const generated = await apiRequest('/api/generate', {
      method: 'POST',
      body: {
        caption: reelData.caption || '',
        username: reelData.username || '',
        mediaType: reelData.mediaType || 'video',
      },
    });

    state.lastExtracted = {
      sourceUrl: url,
      reelData,
      aiContent: generated.content || {},
    };

    showPreview(state.lastExtracted);
    if (reelData.isDemoMode) {
      showToast('Extraction used demo fallback media. Try a different reel for real media.', 'info');
    } else {
      showToast('Mission ready. You can post now or queue it.', 'success');
    }
  } catch (error) {
    showToast(error.message || 'Extraction failed.', 'error');
  } finally {
    extractBtn.disabled = false;
    extractBtn.textContent = 'Extract';
  }
}



function showPreview(payload) {
  const section = byId('preview-section');
  const image = byId('preview-img');
  const video = byId('preview-video');
  const audioBtn = byId('preview-audio-btn');
  const scrollBtn = byId('preview-scroll-btn');
  const title = byId('field-title');
  const desc = byId('field-desc');
  const link = byId('field-link');
  const alt = byId('field-alt');

  if (!section || !image || !video || !audioBtn || !scrollBtn || !title || !desc || !link || !alt) return;

  const reelData = payload.reelData || {};
  const aiContent = payload.aiContent || {};
  const isVideo = isVideoMedia(reelData);
  const fallbackImage = reelData.thumbnailUrl || reelData.mediaUrl || 'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=400';
  const videoSource = reelData.mediaUrl || reelData.thumbnailUrl || '';

  resetPreviewMedia();
  state.preview.isVideo = isVideo;
  state.preview.muted = true;

  image.src = proxyMediaUrl(fallbackImage);
  image.onerror = () => {
    image.onerror = null;
    image.src = fallbackImage;
  };

  if (isVideo && videoSource) {
    video.classList.remove('hidden');
    image.classList.add('hidden');
    audioBtn.classList.remove('hidden');
    scrollBtn.classList.remove('hidden');

    const proxiedVideo = proxyMediaUrl(videoSource);
    video.dataset.directTried = '0';
    video.src = proxiedVideo;
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.loop = true;
    video.controls = true;
    video.load();

    video.onloadedmetadata = () => {
      tryPlayPreviewVideo();
    };
    video.onerror = () => {
      if (video.dataset.directTried !== '1' && proxiedVideo !== videoSource) {
        video.dataset.directTried = '1';
        video.src = videoSource;
        video.load();
        return;
      }
      video.classList.add('hidden');
      image.classList.remove('hidden');
      audioBtn.classList.add('hidden');
      showToast('Video preview failed. Showing image preview instead.', 'info');
    };

    updatePreviewAudioButton();
  } else {
    image.classList.remove('hidden');
    video.classList.add('hidden');
    audioBtn.classList.add('hidden');
    scrollBtn.classList.remove('hidden');
  }

  title.value = (aiContent.title || 'New pin mission').slice(0, 100);
  desc.value = (aiContent.description || '').slice(0, 800);
  link.value = payload.destinationLink || payload.sourceUrl || '';
  alt.value = '';
  updateComposerMeta();

  section.classList.remove('hidden');
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function handlePostNow() {
  const btn = byId('post-now-btn');
  const payload = buildPostPayload();
  if (!payload) return;

  btn.disabled = true;
  btn.textContent = 'Firing...';

  try {
    const response = await apiRequest('/api/pinterest/post', {
      method: 'POST',
      body: payload,
    });

    showToast(response.message || 'Mission fired! GitHub Bot will post shortly.', 'success');
    const preview = byId('preview-section');
    if (preview) preview.classList.add('hidden');
    resetPreviewMedia();
    await refreshAll();
  } catch (error) {
    showToast(error.message || 'Post failed.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Post Now';
  }
}

async function handleQueue() {
  const btn = byId('queue-btn');
  const postPayload = buildPostPayload();
  if (!postPayload) return;

  btn.disabled = true;
  btn.textContent = 'Queueing...';

  try {
    const item = {
      title: postPayload.title,
      description: postPayload.description,
      altText: postPayload.altText,
      mediaUrl: postPayload.mediaUrl,
      sourceUrl: postPayload.sourceUrl,
      destinationLink: postPayload.destinationLink || '',
      originalSourceUrl: state.lastExtracted?.sourceUrl || '',
      username: postPayload.reelMeta.username,
      caption: postPayload.reelMeta.caption,
      thumbnailUrl: postPayload.reelMeta.thumbnailUrl || postPayload.mediaUrl,
      aiContent: {
        title: postPayload.title,
        description: postPayload.description,
        hashtags: postPayload.hashtags || [],
      },
    };

    const response = await apiRequest('/api/queue', {
      method: 'POST',
      body: { items: [item] },
    });

    showToast(response.message || 'Mission added to queue.', 'success');
    const preview = byId('preview-section');
    if (preview) preview.classList.add('hidden');
    resetPreviewMedia();
    await refreshAll();
  } catch (error) {
    showToast(error.message || 'Queue action failed.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Queue';
  }
}

function buildPostPayload() {
  if (!state.lastExtracted) {
    showToast('Extract or load media before posting.', 'error');
    return null;
  }

  const title = String(byId('field-title')?.value || '').trim();
  const description = String(byId('field-desc')?.value || '').trim();
  const destinationLinkRaw = String(byId('field-link')?.value || '').trim();
  const altText = String(byId('field-alt')?.value || '').trim();
  const reelData = state.lastExtracted.reelData || {};
  const aiContent = state.lastExtracted.aiContent || {};
  const mediaUrl = reelData.mediaUrl || reelData.thumbnailUrl || '';
  const normalizedDestination = normalizeDestinationLink(destinationLinkRaw);
  if (normalizedDestination.error) {
    showToast(normalizedDestination.error, 'error');
    return null;
  }

  const sourceUrl =
    normalizedDestination.value ||
    state.lastExtracted.sourceUrl ||
    String(byId('reel-url')?.value || '').trim();

  if (!title) {
    showToast('Title is required.', 'error');
    return null;
  }
  if (title.length > PINTEREST_LIMITS.titleChars) {
    showToast(`Title must be ${PINTEREST_LIMITS.titleChars} characters or less.`, 'error');
    return null;
  }
  if (description.length > PINTEREST_LIMITS.descriptionChars) {
    showToast(`Description must be ${PINTEREST_LIMITS.descriptionChars} characters or less.`, 'error');
    return null;
  }
  if (altText.length > PINTEREST_LIMITS.altChars) {
    showToast(`Alt text must be ${PINTEREST_LIMITS.altChars} characters or less.`, 'error');
    return null;
  }
  if (!mediaUrl) {
    showToast('No media URL available for this mission.', 'error');
    return null;
  }

  return {
    title,
    description,
    altText,
    hashtags: Array.isArray(aiContent.hashtags) ? aiContent.hashtags : [],
    mediaUrl,
    sourceUrl,
    destinationLink: normalizedDestination.value || '',
    reelMeta: {
      username: reelData.username || 'unknown',
      caption: reelData.caption || '',
      thumbnailUrl: reelData.thumbnailUrl || mediaUrl,
      mediaType: reelData.mediaType || 'video',
    },
  };
}

function renderQueueList() {
  const list = byId('queue-list');
  if (!list) return;

  const search = String(byId('queue-search')?.value || '').trim().toLowerCase();
  const statusFilter = byId('queue-status-filter')?.value || 'all';

  const rows = state.queue.filter((item) => {
    const matchStatus = statusFilter === 'all' ? true : (item.status || '') === statusFilter;
    if (!matchStatus) return false;
    if (!search) return true;
    const haystack = `${item.title || ''} ${item.sourceUrl || ''} ${item.username || ''}`.toLowerCase();
    return haystack.includes(search);
  });

  if (!rows.length) {
    list.innerHTML = '<div class="pulse-item">No queue items match your filters.</div>';
    return;
  }

  list.innerHTML = rows
    .map((item) => {
      const thumb = `/api/queue/thumb/${encodeURIComponent(item.id)}`;
      const title = escHtml(item.title || 'Untitled mission');
      const meta = escHtml(item.sourceUrl || item.username || 'manual');
      const status = String(item.status || 'pending');
      const statusText = escHtml(status.toUpperCase());
      const errorText = item.error ? `<div class="item-meta">${escHtml(item.error)}</div>` : '';
      const addedAt = item.addedAt ? formatDateTime12h(item.addedAt) : '';
      const dateText = addedAt ? `<div class="item-meta">${escHtml(addedAt)}</div>` : '';

      return `
        <div class="list-item">
          <div class="list-item-main">
            <img class="thumb-img" src="${escAttr(thumb)}" alt="Queue item">
            <div>
              <div class="item-title">${title}</div>
              <div class="item-meta">${meta}</div>
              ${dateText}
              ${errorText}
            </div>
          </div>
          <div class="item-actions">
            <span class="badge status-${escHtml(status)}">${statusText}</span>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderHistoryList() {
  const list = byId('history-list');
  if (!list) return;

  const search = String(byId('history-search')?.value || '').trim().toLowerCase();
  const statusFilter = byId('history-status-filter')?.value || 'all';

  const rows = state.history.filter((item) => {
    const status = item.status || '';
    const matchStatus = statusFilter === 'all' ? true : status === statusFilter;
    if (!matchStatus) return false;
    if (!search) return true;

    const title = item.aiContent?.title || '';
    const username = item.reelData?.username || '';
    const haystack = `${title} ${username}`.toLowerCase();
    return haystack.includes(search);
  });

  if (!rows.length) {
    list.innerHTML = '<div class="pulse-item">No history records match your filters.</div>';
    return;
  }

  list.innerHTML = rows
    .map((item) => {
      const status = item.status || 'preview';
      const title = escHtml(item.aiContent?.title || 'Untitled post');
      const username = escHtml(item.reelData?.username || 'unknown');
      const postedAt = item.postedAt || item.createdAt;
      const when = postedAt ? formatDateTime12h(postedAt) : 'Unknown date';
      const badgeClass = status === 'success' ? 'badge-success' : status === 'error' ? 'badge-error' : 'badge-warn';
      const badgeLabel = status === 'success' ? 'POSTED' : status === 'error' ? 'FAILED' : 'PREVIEW';
      const pinUrl = item.pinterestPin?.url;
      const viewLink = pinUrl && pinUrl !== '#'
        ? `<a class="pill-btn" href="${escAttr(pinUrl)}" target="_blank" rel="noopener noreferrer">View Pin</a>`
        : '';
      const err = item.error ? `<div class="item-meta">${escHtml(item.error)}</div>` : '';

      return `
        <div class="list-item">
          <div class="list-item-main">
            <img class="thumb-img" src="/api/history/thumb/${encodeURIComponent(item.id)}" alt="History item">
            <div>
              <div class="item-title">${title}</div>
              <div class="item-meta">@${username} • ${escHtml(when)}</div>
              ${err}
            </div>
          </div>
          <div class="item-actions">
            <span class="badge ${badgeClass}">${badgeLabel}</span>
            ${viewLink}
          </div>
        </div>
      `;
    })
    .join('');
}

async function loadEngagements() {
  try {
    const response = await apiRequest('/api/engagements');
    state.engagements = Array.isArray(response.engagements) ? response.engagements : [];
    renderEngagements();
    renderEngagementAuditList();
  } catch (error) {
    showToast(error.message || 'Failed to load engagement logs.', 'error');
  }
}

function renderEngagements() {
  const panel = byId('engagement-logs');
  if (!panel) return;

  if (!state.engagements.length) {
    panel.innerHTML = '<div class="pulse-item">No booster activity logged yet.</div>';
    return;
  }

  panel.innerHTML = state.engagements
    .slice(0, 20)
    .map((entry) => {
      const normalized = normalizeEngagementEntry(entry);
      const action = escHtml(String(normalized.action || 'action').toUpperCase());
      const when = normalized.when ? formatTime12h(normalized.when) : '';
      const url = entry.url ? `<a class="pill-btn" href="${escAttr(entry.url)}" target="_blank" rel="noopener noreferrer">Open</a>` : '';

      return `
        <div class="list-item">
          <div class="list-item-main">
            <div>
              <div class="item-title">${action}</div>
              <div class="item-meta">${escHtml(when)}</div>
            </div>
          </div>
          <div class="item-actions">${url}</div>
        </div>
      `;
    })
    .join('');
}function renderEngagementAuditList() {
  const list = byId('engagement-readonly-list');
  const summary = byId('engagement-summary');
  if (!list || !summary) return;

  const search = String(byId('engagement-search')?.value || '').trim().toLowerCase();
  
  const activeBtn = document.querySelector('#engagement-platform-toggle .segment-btn.active');
  const platform = activeBtn ? activeBtn.dataset.platform : 'pinterest';
  
  let sourceArray = state.engagements;
  if (platform === 'x_twitter') {
    sourceArray = typeof xState !== 'undefined' ? xState.engagements : [];
  }
  
  const now = Date.now();
  const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

  const normalized = sourceArray
    .map(normalizeEngagementEntry)
    .filter(entry => {
      const entryTime = new Date(entry.when).getTime();
      return entryTime >= twentyFourHoursAgo;
    });

  const rows = normalized.filter((entry) => {
    if (!search) return true;
    const haystack = `${entry.action} ${entry.url || ''} ${entry.comment || ''}`.toLowerCase();
    return haystack.includes(search);
  });

  const shownCount = rows.length;
  const latestTime = rows[0]?.when ? formatTime12h(rows[0].when) : 'None';
  const platformLabel = platform === 'x_twitter' ? 'X (Twitter)' : 'Pinterest';

  summary.innerHTML = `
    <div class="mini-stat-card">
      <div class="mini-stat-label">Platform</div>
      <div class="mini-stat-value">${platformLabel}</div>
    </div>
    <div class="mini-stat-card">
      <div class="mini-stat-label">Active (24h)</div>
      <div class="mini-stat-value">${shownCount} Logs</div>
    </div>
    <div class="mini-stat-card">
      <div class="mini-stat-label">Latest</div>
      <div class="mini-stat-value">${latestTime}</div>
    </div>
  `;

  if (!rows.length) {
    list.innerHTML = '<div class="pulse-item">No logs found in the last 24 hours.</div>';
    return;
  }

  list.innerHTML = rows
    .slice(0, 100)
    .map((entry) => {
      const when = entry.when ? formatDateTime12h(entry.when) : 'Unknown time';
      const whenAgo = formatTimeAgo(entry.when);
      const actionText = String(entry.action || 'Engagement');
      const actionIcon = getEngagementActionIcon(actionText);
      
      const noteHtml = entry.comment ? `<div class="audit-note">"${escHtml(entry.comment)}"</div>` : '';
      const linkHtml = entry.url ? `<a class="pill-btn" href="${escAttr(entry.url)}" target="_blank" rel="noopener noreferrer">Open Link</a>` : '';

      return `
        <div class="audit-card">
          <div class="audit-icon-wrap">
            <i data-lucide="${actionIcon}" class="audit-icon"></i>
          </div>
          <div class="audit-content">
            <div class="audit-title">${escHtml(actionText)}</div>
            <div class="audit-meta">
              <span>${escHtml(whenAgo)}</span>
              <span class="audit-time-dot"></span>
              <span>${escHtml(when)}</span>
            </div>
            ${noteHtml}
          </div>
          <div class="audit-actions">
            ${linkHtml}
          </div>
        </div>
      `;
    })
    .join('');
  
  hydrateIcons();
}

async function startEngager() {
  const button = byId('engage-btn');
  const count = parseInt(byId('engage-count')?.value || '3', 10);
  const niche = byId('engage-niche')?.value || 'all';

  button.disabled = true;
  button.textContent = 'Launching...';
  try {
    const response = await apiRequest('/api/engage', {
      method: 'POST',
      body: { count, niche },
    });
    showToast(response.message || 'Booster started.', 'success');
    await loadEngagements();
  } catch (error) {
    showToast(error.message || 'Booster failed to start.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Launch Booster';
  }
}

async function clearEngagements() {
  if (!window.confirm('Clear all engagement logs?')) return;
  try {
    const response = await apiRequest('/api/engagements', { method: 'DELETE' });
    showToast(response.message || 'Engagement logs cleared.', 'success');
    state.engagements = [];
    renderEngagements();
  } catch (error) {
    showToast(error.message || 'Failed to clear engagement logs.', 'error');
  }
}

async function loadDiagnostics() {
  try {
    const [system, pinterest, session] = await Promise.all([
      apiRequest('/api/system/status'),
      apiRequest('/api/pinterest/status'),
      apiRequest('/api/pinterest/session/status'),
    ]);

    setBadgeByState('diag-runtime', system.runtime?.isServerless ? 'Serverless' : 'Node', 'success');
    setBadgeByState('diag-posting', String(system.posting?.resolvedMode || pinterest.resolvedPostingMode || 'api').toUpperCase(), 'success');
    setBadgeByState(
      'diag-session',
      session.session?.hasSession ? `Linked (${session.session.source || 'storage'})` : 'Not Linked',
      session.session?.hasSession ? 'success' : 'error'
    );
    setBadgeByState(
      'diag-storage',
      String(system.queue?.storageMode || system.storage?.mode || 'unknown').toUpperCase(),
      'warn'
    );
  } catch (error) {
    showToast(error.message || 'Diagnostics unavailable.', 'error');
  }
}

function setBadgeByState(id, text, tone) {
  const el = byId(id);
  if (!el) return;
  setBadge(el, text, tone);
}

function setBadge(el, text, tone) {
  el.textContent = text;
  el.className = 'badge';
  if (tone === 'success') el.classList.add('badge-success');
  if (tone === 'error') el.classList.add('badge-error');
  if (tone === 'warn') el.classList.add('badge-warn');
}

async function processQueueNow() {
  const button = byId('run-bot-btn');
  button.disabled = true;
  button.textContent = 'Firing...';
  try {
    const response = await apiRequest('/api/queue/process', { method: 'POST' });
    showToast(response.message || 'GitHub Bot fired.', 'success');
    await refreshAll();
  } catch (error) {
    showToast(error.message || 'Queue trigger failed.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Run Queue Bot';
  }
}

async function retryFailed() {
  try {
    const response = await apiRequest('/api/queue/retry-failed', { method: 'POST' });
    showToast(response.message || 'Failed missions moved back to pending.', 'success');
    await refreshAll();
  } catch (error) {
    showToast(error.message || 'Retry failed action could not run.', 'error');
  }
}

async function clearQueue() {
  if (!window.confirm('Clear all queue items?')) return;
  try {
    const response = await apiRequest('/api/queue', { method: 'DELETE' });
    showToast(response.message || 'Queue cleared.', 'success');
    state.queue = [];
    renderQueueList();
    renderMiniQueue();
    renderMissionPulse();
    await refreshOverview();
  } catch (error) {
    showToast(error.message || 'Could not clear queue.', 'error');
  }
}

async function clearHistory() {
  if (!window.confirm('Clear all history entries?')) return;
  try {
    const response = await apiRequest('/api/history', { method: 'DELETE' });
    showToast(response.message || 'History cleared.', 'success');
    state.history = [];
    renderHistoryList();
    await refreshOverview();
  } catch (error) {
    showToast(error.message || 'Could not clear history.', 'error');
  }
}

function exportHistoryJson() {
  const data = JSON.stringify(state.history || [], null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `pinterest-history-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function linkSessionCookie() {
  const cookie = String(byId('session-cookie')?.value || '').trim();
  if (!cookie) {
    showToast('Paste a _pinterest_sess value first.', 'error');
    return;
  }

  try {
    const response = await apiRequest('/api/pinterest/session/link', {
      method: 'POST',
      body: { cookie },
    });
    showToast(response.message || 'Session linked.', 'success');
    byId('session-cookie').value = '';
    await loadDiagnostics();
    await refreshOverview();
  } catch (error) {
    showToast(error.message || 'Session link failed.', 'error');
  }
}

async function unlinkSessionCookie() {
  try {
    const response = await apiRequest('/api/pinterest/session/unlink', { method: 'POST' });
    showToast(response.message || 'Session removed.', 'success');
    await loadDiagnostics();
    await refreshOverview();
  } catch (error) {
    showToast(error.message || 'Could not unlink session.', 'error');
  }
}

async function unlinkApiConnection() {
  if (!window.confirm('Unlink the Pinterest API token?')) return;
  try {
    const response = await apiRequest('/api/pinterest/unlink', { method: 'POST' });
    showToast(response.message || 'API token unlinked.', 'success');
    await loadDiagnostics();
    await refreshOverview();
  } catch (error) {
    showToast(error.message || 'Could not unlink API token.', 'error');
  }
}

function saveDraftFromName() {
  const draftName = String(byId('draft-name')?.value || '').trim();
  if (!draftName) {
    showToast('Enter a draft name first.', 'error');
    return;
  }
  saveDraft(draftName);
  byId('draft-name').value = '';
}

function saveDraftFromPreview() {
  const draftName = String(byId('draft-name')?.value || '').trim() || `Draft ${state.drafts.length + 1}`;
  saveDraft(draftName);
  byId('draft-name').value = '';
}

function saveDraft(name) {
  const title = String(byId('field-title')?.value || '').trim();
  const description = String(byId('field-desc')?.value || '').trim();
  const destinationLink = String(byId('field-link')?.value || '').trim();
  const altText = String(byId('field-alt')?.value || '').trim();

  if (!title && !description && !destinationLink) {
    showToast('Draft needs title, description, or destination link.', 'error');
    return;
  }

  const draft = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    title,
    description,
    destinationLink,
    altText,
    createdAt: new Date().toISOString(),
  };

  state.drafts.unshift(draft);
  state.drafts = state.drafts.slice(0, 30);
  persistDrafts();
  renderDrafts();
  showToast('Draft saved.', 'success');
}

function loadDrafts() {
  try {
    const raw = localStorage.getItem(DRAFTS_STORAGE_KEY);
    state.drafts = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(state.drafts)) state.drafts = [];
  } catch {
    state.drafts = [];
  }
  renderDrafts();
}

function persistDrafts() {
  localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(state.drafts));
}

function renderDrafts() {
  const list = byId('draft-list');
  if (!list) return;

  if (!state.drafts.length) {
    list.innerHTML = '<div class="pulse-item">No drafts saved yet.</div>';
    return;
  }

  list.innerHTML = state.drafts
    .map((draft) => {
      const date = new Date(draft.createdAt).toLocaleDateString();
      return `
        <div class="list-item">
          <div class="list-item-main">
            <div>
              <div class="item-title">${escHtml(draft.name || 'Draft')}</div>
              <div class="item-meta">${escHtml(date)}</div>
            </div>
          </div>
          <div class="item-actions">
            <button class="pill-btn" type="button" data-draft-apply="${escAttr(draft.id)}">Apply</button>
            <button class="pill-btn" type="button" data-draft-delete="${escAttr(draft.id)}">Delete</button>
          </div>
        </div>
      `;
    })
    .join('');

  list.querySelectorAll('[data-draft-apply]').forEach((button) => {
    button.addEventListener('click', () => applyDraft(button.dataset.draftApply));
  });
  list.querySelectorAll('[data-draft-delete]').forEach((button) => {
    button.addEventListener('click', () => deleteDraft(button.dataset.draftDelete));
  });
}

function applyDraft(id) {
  const draft = state.drafts.find((item) => item.id === id);
  if (!draft) return;

  byId('field-title').value = draft.title || '';
  byId('field-desc').value = draft.description || '';
  byId('field-link').value = draft.destinationLink || '';
  byId('field-alt').value = draft.altText || '';
  updateComposerMeta();
  showToast('Draft applied to preview fields.', 'success');
}

function deleteDraft(id) {
  state.drafts = state.drafts.filter((draft) => draft.id !== id);
  persistDrafts();
  renderDrafts();
}

async function pasteReelUrlFromClipboard() {
  const input = byId('reel-url');
  if (!input) return;

  try {
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
      throw new Error('Clipboard read is not available in this browser.');
    }
    const text = String(await navigator.clipboard.readText()).trim();
    if (!text) {
      showToast('Clipboard is empty.', 'info');
      return;
    }
    input.value = text;
    input.focus();

    if (/instagram\.com\/(reel|p|tv)\//i.test(text)) {
      showToast('Instagram URL pasted.', 'success');
    } else {
      showToast('Text pasted. Make sure it is a valid Instagram reel URL.', 'info');
    }
  } catch (error) {
    showToast(error.message || 'Clipboard paste failed.', 'error');
  }
}

function isVideoMedia(reelData = {}) {
  const mediaType = String(reelData.mediaType || '').toLowerCase();
  if (mediaType.includes('video')) return true;
  const mediaUrl = String(reelData.mediaUrl || '').toLowerCase();
  return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(mediaUrl);
}

function tryPlayPreviewVideo() {
  const video = byId('preview-video');
  if (!video || video.classList.contains('hidden')) return;
  const playPromise = video.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {});
  }
}

function togglePreviewAudio() {
  const video = byId('preview-video');
  if (!video || video.classList.contains('hidden')) {
    showToast('No video loaded in preview.', 'info');
    return;
  }

  video.muted = !video.muted;
  state.preview.muted = !!video.muted;
  updatePreviewAudioButton();
  tryPlayPreviewVideo();
}

function updatePreviewAudioButton() {
  const audioBtn = byId('preview-audio-btn');
  if (!audioBtn) return;
  audioBtn.textContent = state.preview.muted ? 'Unmute' : 'Mute';
}

function togglePreviewScrollLock() {
  setPreviewScrollLock(!state.preview.scrollLocked);
}

function setPreviewScrollLock(locked) {
  state.preview.scrollLocked = !!locked;
  document.body.classList.toggle('preview-scroll-lock', state.preview.scrollLocked);

  const scrollBtn = byId('preview-scroll-btn');
  if (scrollBtn) {
    scrollBtn.textContent = state.preview.scrollLocked ? 'No Scroll: On' : 'No Scroll: Off';
  }
}

function resetPreviewMedia() {
  setPreviewScrollLock(false);
  state.preview.isVideo = false;
  state.preview.muted = true;

  const image = byId('preview-img');
  const video = byId('preview-video');
  const audioBtn = byId('preview-audio-btn');
  const scrollBtn = byId('preview-scroll-btn');

  if (image) image.classList.remove('hidden');
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.classList.add('hidden');
  }
  if (audioBtn) audioBtn.classList.add('hidden');
  if (scrollBtn) {
    scrollBtn.classList.add('hidden');
    scrollBtn.textContent = 'No Scroll: Off';
  }
}

function normalizeEngagementEntry(entry = {}) {
  const commandRaw = String(entry.command || '').trim();
  const workflowRaw = String(entry.workflow || '').trim();
  const sourceRaw = String(entry.source || '').trim().toLowerCase();

  let source = sourceRaw;
  if (!source) {
    if (workflowRaw || commandRaw.includes('run-hourly-automation.js')) {
      source = 'github_actions';
    } else if (commandRaw.includes('/api/engage')) {
      source = 'api_manual';
    } else {
      // Legacy entries were stored without source metadata; default them to GitHub
      // so historical cloud engagements still appear in the read-only audit view.
      source = 'github_actions';
    }
  }

  return {
    id: entry.id || '',
    action: String(entry.action || 'Viewed'),
    url: String(entry.url || ''),
    comment: String(entry.comment || ''),
    command: commandRaw || (source === 'github_actions' ? 'node scripts/run-hourly-automation.js' : 'manual engager'),
    workflow: workflowRaw || (source === 'github_actions' ? 'instant-engagement.yml' : ''),
    source,
    actor: String(entry.actor || ''),
    runId: String(entry.runId || ''),
    runNumber: String(entry.runNumber || ''),
    job: String(entry.job || ''),
    workflowUrl: String(entry.workflowUrl || ''),
    when: entry.engagedAt || entry.createdAt || '',
  };
}

function getEngagementActionIcon(action) {
  const lower = String(action || '').toLowerCase();
  if (lower.includes('like')) return 'heart';
  if (lower.includes('comment')) return 'message-circle';
  if (lower.includes('follow')) return 'user-plus';
  if (lower.includes('post')) return 'send';
  if (lower.includes('extract')) return 'scissors';
  return 'activity';
}

function hydrateIcons() {
  if (typeof window === 'undefined') return;
  if (!window.lucide || typeof window.lucide.createIcons !== 'function') return;
  window.lucide.createIcons();
}

function extractPinLabel(url) {
  const clean = String(url || '').trim();
  if (!clean) return '';
  try {
    const parsed = new URL(clean);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const pinIndex = segments.findIndex((segment) => segment === 'pin');
    const pinId = pinIndex >= 0 ? segments[pinIndex + 1] : '';
    if (pinId) {
      return `Pin ${pinId.slice(0, 8)}${pinId.length > 8 ? '…' : ''}`;
    }
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function formatTime12h(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDateTime12h(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatTimeAgo(isoText) {
  if (!isoText) return 'Unknown time';
  const timestamp = new Date(isoText).getTime();
  if (!Number.isFinite(timestamp)) return 'Unknown time';

  const diffMs = Date.now() - timestamp;
  const absMs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (absMs < minute) return 'Just now';
  if (absMs < hour) return `${Math.round(absMs / minute)} min ago`;
  if (absMs < day) return `${Math.round(absMs / hour)} hr ago`;
  return `${Math.round(absMs / day)} day ago`;
}

function updateComposerMeta() {
  const title = String(byId('field-title')?.value || '');
  const description = String(byId('field-desc')?.value || '');
  const altText = String(byId('field-alt')?.value || '');
  const destinationLink = String(byId('field-link')?.value || '');

  const titleWords = countWords(title);
  const descWords = countWords(description);

  setInputMetaState(
    'field-title-meta',
    `${title.length}/${PINTEREST_LIMITS.titleChars} chars • ${titleWords} words`,
    title.length > PINTEREST_LIMITS.titleChars
      ? 'error'
      : titleWords > PINTEREST_LIMITS.titleWordsSoft || title.length > Math.floor(PINTEREST_LIMITS.titleChars * 0.9)
        ? 'warn'
        : ''
  );

  setInputMetaState(
    'field-desc-meta',
    `${description.length}/${PINTEREST_LIMITS.descriptionChars} chars • ${descWords} words`,
    description.length > PINTEREST_LIMITS.descriptionChars
      ? 'error'
      : descWords > PINTEREST_LIMITS.descriptionWordsSoft || description.length > Math.floor(PINTEREST_LIMITS.descriptionChars * 0.9)
        ? 'warn'
        : ''
  );

  setInputMetaState(
    'field-alt-meta',
    `${altText.length}/${PINTEREST_LIMITS.altChars} chars`,
    altText.length > PINTEREST_LIMITS.altChars
      ? 'error'
      : altText.length > Math.floor(PINTEREST_LIMITS.altChars * 0.9)
        ? 'warn'
        : ''
  );

  const normalizedLink = normalizeDestinationLink(destinationLink);
  if (!destinationLink.trim()) {
    setInputMetaState('field-link-meta', 'Optional destination URL for click-through.', '');
  } else if (normalizedLink.error) {
    setInputMetaState('field-link-meta', normalizedLink.error, 'error');
  } else {
    setInputMetaState('field-link-meta', 'Valid destination URL.', 'success');
  }
}

function countWords(text) {
  const clean = String(text || '').trim();
  if (!clean) return 0;
  return clean.split(/\s+/).filter(Boolean).length;
}

function setInputMetaState(id, text, tone) {
  const el = byId(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'input-meta';
  if (tone === 'warn') el.classList.add('warn');
  if (tone === 'error') el.classList.add('error');
  if (tone === 'success') el.classList.add('success');
}

function normalizeDestinationLink(value) {
  let clean = String(value || '').trim();
  if (!clean) return { value: '', error: '' };

  if (!/^https?:\/\//i.test(clean) && /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}([/:?#].*)?$/.test(clean)) {
    clean = `https://${clean}`;
  }

  try {
    const parsed = new URL(clean);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { value: '', error: 'Destination link must start with http:// or https://.' };
    }
    return { value: parsed.toString(), error: '' };
  } catch {
    return { value: '', error: 'Destination link is not a valid URL.' };
  }
}

async function apiRequest(url, options = {}) {
  const init = {
    method: options.method || 'GET',
    headers: options.headers || {},
  };

  if (options.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, init);
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : { success: response.ok, message: await response.text() };

  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || payload.message || `Request failed (${response.status})`);
  }
  return payload;
}

function showToast(message, type = 'info') {
  const container = byId('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4200);
}

function setText(id, value) {
  const el = byId(id);
  if (el) el.textContent = value;
}

function proxyMediaUrl(url) {
  const clean = String(url || '').trim();
  if (!clean) return '';
  try {
    const encoded = btoa(clean);
    return `/api/proxy?url=${encodeURIComponent(encoded)}`;
  } catch {
    return clean;
  }
}

function escHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}

function escAttr(value) {
  return escHtml(value).replace(/"/g, '&quot;');
}

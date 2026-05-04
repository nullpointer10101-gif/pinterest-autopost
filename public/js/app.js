const state = {
  currentTab: 'dashboard',
  queue: [],
  history: [],
  channels: [],
  engagements: [],
  lastExtracted: null,
  drafts: [],
  refreshTimer: null,
  clockTimer: null,
  channelAvatarRequests: {},
  preview: {
    isVideo: false,
    muted: true,
    scrollLocked: false,
  },
  visual: {
    mode: 'dark',
    pointerX: null,
    pointerY: null,
    pointerRaf: null,
    pointerBound: false,
  },
  performance: {
    enabled: false,
    lastRefreshAt: 0,
  },
  queuePlanner: {
    selectedIds: new Set(),
    draggingId: '',
  },
  commandPalette: {
    open: false,
    activeIndex: 0,
    results: [],
  },
  autosave: {
    timer: null,
    undoStack: [],
    redoStack: [],
    applying: false,
  },
  alerts: [],
};

const REFRESH_INTERVAL_MS = 30000;
const PERFORMANCE_REFRESH_INTERVAL_MS = 60000;
const PERFORMANCE_REFRESH_THROTTLE_MS = 8000;
const DEFAULT_REFRESH_THROTTLE_MS = 2500;
const DRAFTS_STORAGE_KEY = 'pmc_drafts_v1';
const VISUAL_MODE_STORAGE_KEY = 'pmc_visual_mode_v1';
const PERFORMANCE_MODE_STORAGE_KEY = 'pmc_performance_mode_v1';
const AUTOSAVE_STORAGE_KEY = 'pmc_autosave_v1';
const AUTOSAVE_MAX_STACK = 40;
const QUEUE_PRIORITY_ORDER = ['low', 'normal', 'high', 'urgent'];
const VISUAL_MODES = {
  dark: {
    label: 'Dark',
    themeColor: '#050b16',
    icon: 'moon-star',
  },
  light: {
    label: 'Light',
    themeColor: '#edf3fb',
    icon: 'sun-medium',
  },
  neon: {
    label: 'Neon',
    themeColor: '#0a0317',
    icon: 'sparkles',
  },
  graphite: {
    label: 'Graphite',
    themeColor: '#121316',
    icon: 'hexagon',
  },
  aurora: {
    label: 'Aurora',
    themeColor: '#07131f',
    icon: 'atom',
  },
};
const PINTEREST_LIMITS = {
  titleChars: 100,
  descriptionChars: 800,
  altChars: 500,
  titleWordsSoft: 20,
  descriptionWordsSoft: 120,
};

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  initVisualSystem();
  loadDrafts();
  switchTab('dashboard');
  startClock();
  refreshAll({ force: true });
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
  on('manual-refresh-btn', 'click', () => refreshAll({ force: true }));
  on('visual-mode-btn', 'click', handleVisualModeToggle);
  on('hero-open-channels-btn', 'click', () => switchTab('channels'));
  on('hero-open-history-btn', 'click', () => switchTab('history'));
  on('hero-refresh-btn', 'click', () => refreshAll({ force: true }));
  on('link-session-btn', 'click', linkSessionCookie);
  on('unlink-session-btn', 'click', unlinkSessionCookie);
  on('link-ig-session-btn', 'click', linkIgSession);
  on('add-channel-btn', 'click', handleAddChannel);

  on('auto-refresh-toggle', 'change', (event) => {
    setAutoRefresh(!!event.target.checked);
  });

  const syncEngageCountDisplay = (value, source = 'manual') => {
    const text = String(value || '');
    const valueEl = byId('engage-count-value');
    if (valueEl) valueEl.textContent = text;

    const dashboardValueEl = byId('engage-count-value-dashboard');
    if (dashboardValueEl) dashboardValueEl.textContent = text;

    if (source !== 'manual') {
      const manualInput = byId('engage-count-manual');
      if (manualInput) manualInput.value = text;
    }

    if (source !== 'dashboard') {
      const dashboardRange = byId('engage-count');
      if (dashboardRange) dashboardRange.value = text;
    }
  };

  on('engage-count-manual', 'input', (event) => {
    syncEngageCountDisplay(event.target.value, 'manual');
  });

  on('engage-count', 'input', (event) => {
    syncEngageCountDisplay(event.target.value, 'dashboard');
  });

  syncEngageCountDisplay(byId('engage-count-manual')?.value || byId('engage-count')?.value || '20');

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
  on('new-channel-input', 'keydown', (event) => {
    if (event.key === 'Enter') handleAddChannel();
  });

  ['wf-pinterest-posting', 'wf-pinterest-engagement', 'wf-x-posting', 'wf-x-engagement'].forEach(id => {
    on(id, 'change', (e) => handleWorkflowToggle(id, e.target.checked));
  });

  document.querySelectorAll('.mobile-tab-btn').forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
  });

  document.addEventListener('keydown', handleGlobalKeyDown);
}

function on(id, event, handler) {
  const el = byId(id);
  if (!el) return;
  el.addEventListener(event, handler);
}

function byId(id) {
  return document.getElementById(id);
}

function resolveVisualMode(mode) {
  return Object.prototype.hasOwnProperty.call(VISUAL_MODES, mode) ? mode : 'dark';
}

function updateThemeMetaColor(color) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && color) meta.setAttribute('content', color);
}

function applyVisualMode(mode, options = {}) {
  const { persist = true, notify = false } = options;
  const resolvedMode = resolveVisualMode(mode);
  const modeMeta = VISUAL_MODES[resolvedMode];

  state.visual.mode = resolvedMode;
  if (document.body) {
    document.body.dataset.visualMode = resolvedMode;
  }

  const label = byId('visual-mode-label');
  if (label) label.textContent = modeMeta.label;

  const heroLabel = byId('hero-mode-label');
  if (heroLabel) heroLabel.textContent = modeMeta.label;

  const btn = byId('visual-mode-btn');
  if (btn) {
    btn.setAttribute('aria-label', `Switch visual mode. Current mode: ${modeMeta.label}`);
    btn.setAttribute('title', `Switch visual mode (current: ${modeMeta.label})`);
    const icon = btn.querySelector('.btn-icon');
    if (icon) {
      icon.setAttribute('data-lucide', modeMeta.icon || 'palette');
    }
  }

  updateThemeMetaColor(modeMeta.themeColor);
  hydrateIcons();

  if (persist) {
    try {
      localStorage.setItem(VISUAL_MODE_STORAGE_KEY, resolvedMode);
    } catch {
      // Ignore storage failures (private mode, blocked storage, etc)
    }
  }

  if (notify) {
    showToast(`Style mode changed to ${modeMeta.label}.`, 'success');
  }
}

function queuePointerGlowUpdate(x, y) {
  state.visual.pointerX = x;
  state.visual.pointerY = y;
  if (state.visual.pointerRaf) return;

  state.visual.pointerRaf = window.requestAnimationFrame(() => {
    const px = Number.isFinite(state.visual.pointerX) ? state.visual.pointerX : window.innerWidth * 0.5;
    const py = Number.isFinite(state.visual.pointerY) ? state.visual.pointerY : window.innerHeight * 0.34;
    document.documentElement.style.setProperty('--cursor-x', `${Math.round(px)}px`);
    document.documentElement.style.setProperty('--cursor-y', `${Math.round(py)}px`);
    state.visual.pointerRaf = null;
  });
}

function bindPointerGlow() {
  if (state.visual.pointerBound) return;
  state.visual.pointerBound = true;

  const seedCenter = () => {
    queuePointerGlowUpdate(window.innerWidth * 0.5, window.innerHeight * 0.34);
  };

  seedCenter();

  window.addEventListener('resize', seedCenter, { passive: true });

  window.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    queuePointerGlowUpdate(event.clientX, event.clientY);
  }, { passive: true });
}

function initVisualSystem() {
  let savedMode = '';
  try {
    savedMode = localStorage.getItem(VISUAL_MODE_STORAGE_KEY) || '';
  } catch {
    savedMode = '';
  }

  applyVisualMode(savedMode || 'dark', { persist: false, notify: false });
  // Performance mode: disable pointer-tracking UI effects.
  document.documentElement.style.setProperty('--cursor-x', '50vw');
  document.documentElement.style.setProperty('--cursor-y', '28vh');
}

function initPerformanceMode() {
  let saved = '';
  try {
    saved = localStorage.getItem(PERFORMANCE_MODE_STORAGE_KEY) || '';
  } catch {
    saved = '';
  }
  const enabled = saved === '1';
  applyPerformanceMode(enabled, { persist: false, notify: false });
}

function applyPerformanceMode(enabled, options = {}) {
  const { persist = true, notify = false } = options;
  state.performance.enabled = !!enabled;

  if (document.body) {
    document.body.classList.toggle('performance-mode', state.performance.enabled);
  }

  const toggle = byId('performance-mode-toggle');
  if (toggle) toggle.checked = state.performance.enabled;

  if (persist) {
    try {
      localStorage.setItem(PERFORMANCE_MODE_STORAGE_KEY, state.performance.enabled ? '1' : '0');
    } catch {
      // ignore storage errors
    }
  }

  const autoEnabled = !!byId('auto-refresh-toggle')?.checked;
  setAutoRefresh(autoEnabled);
  if (state.currentTab === 'queue') renderQueueList();
  if (state.currentTab === 'history') renderHistoryList();

  if (notify) {
    showToast(`Performance mode ${state.performance.enabled ? 'enabled' : 'disabled'}.`, 'info');
  }
}

function handlePerformanceToggle(event) {
  applyPerformanceMode(!!event?.target?.checked, { persist: true, notify: true });
}

function handleVisualModeToggle() {
  const modeKeys = Object.keys(VISUAL_MODES);
  const currentIndex = modeKeys.indexOf(resolveVisualMode(state.visual.mode));
  const nextMode = modeKeys[(currentIndex + 1) % modeKeys.length];
  applyVisualMode(nextMode, { persist: true, notify: true });
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

  document.querySelectorAll('.mobile-tab-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });

  if (tab !== 'dashboard') {
    setPreviewScrollLock(false);
  }

  if (tab === 'history') renderHistoryList();
  if (tab === 'channels') refreshChannels();
  if (tab === 'engagements') {
      loadEngagements();
      if (typeof window.refreshXData === 'function') window.refreshXData();
  }
  if (tab === 'settings') loadDiagnostics();
}

function startClock() {
  updateClock();
  if (state.clockTimer) clearInterval(state.clockTimer);
  state.clockTimer = setInterval(updateClock, 1000);
}

function updateClock() {
  const clock = byId('live-time');
  const countdown = byId('countdown-clock');
  if (clock) {
    const now = new Date();
    clock.textContent = formatTime12h(now);
  }

  if (countdown) {
    const now = new Date();
    const mins = now.getMinutes();
    const secs = now.getSeconds();
    
    let targetMin = 15;
    let remainingSecs = 0;
    
    const currentTotalSecs = mins * 60 + secs;
    const targetTotalSecs = targetMin * 60;
    
    if (currentTotalSecs < targetTotalSecs) {
      remainingSecs = targetTotalSecs - currentTotalSecs;
    } else {
      remainingSecs = (3600 - currentTotalSecs) + targetTotalSecs;
    }
    
    const displayMins = Math.floor(remainingSecs / 60);
    const displaySecs = remainingSecs % 60;
    const countdownText = `${String(displayMins).padStart(2, '0')}:${String(displaySecs).padStart(2, '0')}`;
    countdown.textContent = countdownText;
    setText('hero-next-cycle', countdownText);
  }
}

function setAutoRefresh(enabled) {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }

  if (!enabled) return;
  const intervalMs = state.performance.enabled ? PERFORMANCE_REFRESH_INTERVAL_MS : REFRESH_INTERVAL_MS;
  state.refreshTimer = setInterval(() => {
    // Use window.refreshAll so x-app.js override is honored
    if (typeof window.refreshAll === 'function') window.refreshAll();
    else refreshAll();
  }, intervalMs);
}

async function refreshAll(options = {}) {
  const force = options === true || options.force === true;
  const now = Date.now();
  const minGap = state.performance.enabled ? PERFORMANCE_REFRESH_THROTTLE_MS : DEFAULT_REFRESH_THROTTLE_MS;
  if (!force && state.performance.lastRefreshAt && (now - state.performance.lastRefreshAt) < minGap) {
    return;
  }
  state.performance.lastRefreshAt = now;

  await refreshOverview();

  if (state.currentTab === 'queue') renderQueueList();
  if (state.currentTab === 'history') renderHistoryList();
  if (state.currentTab === 'channels') refreshChannels();
  if (state.currentTab === 'pinterest') renderMiniQueue();
  if (state.currentTab === 'engagements') await renderEngagementAuditList();
  if (state.currentTab === 'settings') await loadDiagnostics();
}

async function refreshOverview() {
  // ── Each fetch is isolated so one failure cannot blank the whole dashboard ──
  const [queueResp, historyResp, pinterestResp, systemStatus, trackerStatusResp] =
    await Promise.all([
      apiRequest('/api/queue').catch(err => { console.warn('[Dashboard] Queue fetch failed:', err.message); return null; }),
      apiRequest('/api/history').catch(err => { console.warn('[Dashboard] History fetch failed:', err.message); return null; }),
      apiRequest('/api/pinterest/status').catch(err => { console.warn('[Dashboard] Pinterest status failed:', err.message); return {}; }),
      apiRequest('/api/system/status').catch(err => { console.warn('[Dashboard] System status failed:', err.message); return {}; }),
      apiRequest('/api/ig-tracker/status').catch(() => null),
    ]);

  // Only update state if the fetch succeeded (non-null response)
  if (queueResp !== null) {
    state.queue = Array.isArray(queueResp.queue) ? queueResp.queue : [];
    pruneQueueSelection();
  }
  if (historyResp !== null) {
    state.history = Array.isArray(historyResp.history) ? historyResp.history : [];
  }

  // Always update channel count from tracker status (not tab-dependent)
  if (trackerStatusResp?.status) {
    const chCount = Array.isArray(trackerStatusResp.status.channels)
      ? trackerStatusResp.status.channels.length
      : (trackerStatusResp.status.channelCount ?? 0);
    setText('hero-channel-count', String(chCount));
    // Sync state.channels so channel tab is pre-populated
    if (Array.isArray(trackerStatusResp.status.channels) && trackerStatusResp.status.channels.length > 0) {
      state.channels = trackerStatusResp.status.channels;
    }
  }

  updateStats(state.queue, state.history);
  updateConnectionBar(pinterestResp || {}, systemStatus || {});
  updateHealthDashboard(pinterestResp || {}, systemStatus || {});
  renderMiniQueue();
  renderDashboardHistory();

  // Always re-render current tab lists with fresh data
  if (state.currentTab === 'history') renderHistoryList();
  if (state.currentTab === 'queue') renderQueueList();
  if (state.currentTab === 'channels') renderChannelsList();

  // Sync workflow toggles
  try {
    if (systemStatus && systemStatus.workflows) {
      updateWorkflowUI(systemStatus.workflows);
    } else {
      const wfResp = await apiRequest('/api/system/workflows').catch(() => null);
      if (wfResp && wfResp.success) updateWorkflowUI(wfResp.config);
    }
  } catch (e) {
    console.warn('[Dashboard] Workflow sync failed:', e.message);
  }
}

function updateStats(queue, history) {
  // Count both 'success' and 'completed' as successfully published pins
  const successCount = history.filter((item) => item.status === 'success' || item.status === 'completed').length;
  const failedCount = history.filter((item) => item.status === 'error' || item.status === 'failed').length;
  const pendingCount = queue.filter((item) => item.status === 'pending' || item.status === 'processing').length;
  const queueFailedCount = queue.filter((item) => item.status === 'failed' || item.status === 'error').length;
  const successRateBase = successCount + failedCount;
  const successRate = successRateBase > 0 ? Math.round((successCount / successRateBase) * 100) : 0;

  setText('stat-total-posts', String(successCount));
  setText('stat-queue-pending', String(pendingCount));
  setText('stat-success-rate', `${successRate}%`);
  setText('stat-queue-failed', String(queueFailedCount));
  setText('hero-total-posts', String(successCount));
  setText('hero-queue-pending', String(pendingCount));
  setText('hero-success-rate', `${successRate}%`);
  setText('hero-queue-failed', String(queueFailedCount));
}

function updateConnectionBar(pinterestStatus, systemStatus) {
  const connection = byId('connection-status');
  const heroConnection = byId('hero-connection-status');
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

  if (heroConnection) {
    if (apiConnected) {
      setBadge(heroConnection, 'API LINKED', 'success');
    } else if (sessionLinked) {
      setBadge(heroConnection, 'SESSION LINKED', 'warn');
    } else {
      setBadge(heroConnection, 'NOT LINKED', 'error');
    }
  }

  if (mode) {
    const resolved = systemStatus?.posting?.resolvedMode || pinterestStatus?.resolvedPostingMode || 'api';
    const runtime = systemStatus?.runtime?.isServerless ? 'Cloud' : 'Local';
    mode.textContent = `Mode: ${String(resolved).toUpperCase()} (${runtime})`;
  }
}

function updateHealthDashboard(pinterestStatus, systemStatus) {
  const pLight = byId('light-pinterest');
  const pText = byId('status-text-pinterest');
  const aiLight = byId('light-ai');
  const aiText = byId('status-text-ai');
  const xLight = byId('light-x');
  const xText = byId('status-text-x');

  if (pLight && pText) {
    if (pinterestStatus.connected) {
      pLight.className = 'status-light active';
      pText.textContent = 'API Connected';
    } else if (pinterestStatus.sessionLinked) {
      pLight.className = 'status-light warn';
      pText.textContent = 'Session Cookie Only';
    } else {
      pLight.className = 'status-light error';
      pText.textContent = 'Not Connected';
    }
  }

  if (aiLight && aiText) {
    aiLight.className = 'status-light active';
    aiText.textContent = 'Ready (Gemini 1.5)';
  }
  
  if (xLight && xText) {
    const xActive = typeof xState !== 'undefined' && xState.connected;
    xLight.className = xActive ? 'status-light active' : 'status-light warn';
    xText.textContent = xActive ? 'Linked' : 'Check Session';
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

  const rows = getFilteredQueueRows();

  if (!rows.length) {
    list.innerHTML = '<div class="pulse-item">No queue items match your filters.</div>';
    return;
  }

  list.innerHTML = rows.map((item) => {
    const thumb = `/api/queue/thumb/${encodeURIComponent(item.id)}`;
    const title = escHtml(item.title || 'Untitled mission');
    const meta = escHtml(item.sourceUrl || item.username || 'manual');
    const status = String(item.status || 'pending');
    const statusText = escHtml(status.toUpperCase());
    const priority = normalizeQueuePriority(item.priority);
    const errorText = item.error ? `<div class="item-meta">${escHtml(item.error)}</div>` : '';
    const addedAt = item.addedAt ? formatDateTime12h(item.addedAt) : '';
    const dateText = addedAt ? `<div class="item-meta">Added ${escHtml(addedAt)}</div>` : '';
    const scheduleLabel = formatScheduledTime(item.scheduledAfter);
    const actionBtns = status === 'pending' || status === 'failed'
      ? `
        <button class="pill-btn" onclick="handlePromoteQueueItem('${escAttr(item.id)}')">Post Now</button>
        <button class="pill-btn btn-danger-text" onclick="handleRemoveQueueItem('${escAttr(item.id)}')">Remove</button>
      `
      : '';

    return `
      <div class="list-item queue-row">
        <div class="list-item-main">
          <img class="thumb-img" src="${escAttr(thumb)}" alt="Queue item">
          <div class="queue-main">
            <div class="item-title">${title}</div>
            <div class="item-meta">${meta}</div>
            <div class="queue-meta-grid">
              <span class="badge status-${escHtml(status)}">${statusText}</span>
              <span class="priority-badge priority-${escAttr(priority)}">${escHtml(priority.toUpperCase())}</span>
              <span class="item-meta">${escHtml(scheduleLabel)}</span>
            </div>
            ${dateText}
            ${errorText}
          </div>
        </div>
        <div class="item-actions queue-ops">
          ${actionBtns}
        </div>
      </div>
    `;
  }).join('');
  hydrateIcons();
}

function normalizeQueuePriority(value) {
  const priority = String(value || '').trim().toLowerCase();
  return QUEUE_PRIORITY_ORDER.includes(priority) ? priority : 'normal';
}

function getFilteredQueueRows() {
  const search = String(byId('queue-search')?.value || '').trim().toLowerCase();
  const statusFilter = byId('queue-status-filter')?.value || 'all';

  return state.queue.filter((item) => {
    const status = String(item.status || '').toLowerCase();
    const matchStatus = statusFilter === 'all' ? true : status === statusFilter;
    if (!matchStatus) return false;
    if (!search) return true;
    const haystack = `${item.title || ''} ${item.sourceUrl || ''} ${item.username || ''}`.toLowerCase();
    return haystack.includes(search);
  });
}

function getVirtualWindow(listEl, rows, key) {
  if (!state.performance.enabled || rows.length <= 40) {
    return { items: rows, top: 0, bottom: 0 };
  }

  const rowHeight = key === 'queue' ? 126 : 108;
  const viewport = Math.max(320, listEl.clientHeight || 440);
  const scrollTop = listEl.scrollTop || 0;
  const visible = Math.ceil(viewport / rowHeight) + 10;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
  const end = Math.min(rows.length, start + visible);
  return {
    items: rows.slice(start, end),
    top: start * rowHeight,
    bottom: Math.max(0, (rows.length - end) * rowHeight),
  };
}

function bindVirtualScroll(listEl, key, renderer) {
  const attr = key === 'queue' ? 'data-vscroll-queue' : 'data-vscroll-history';
  if (listEl.getAttribute(attr) === '1') return;
  listEl.setAttribute(attr, '1');
  let ticking = false;
  listEl.addEventListener('scroll', () => {
    if (!state.performance.enabled) return;
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(() => {
      ticking = false;
      renderer();
    });
  }, { passive: true });
}

function bindQueueRowEvents(list, canDrag) {
  list.querySelectorAll('[data-queue-select]').forEach((el) => {
    el.addEventListener('change', () => {
      const id = el.getAttribute('data-queue-select');
      if (!id) return;
      if (el.checked) state.queuePlanner.selectedIds.add(id);
      else state.queuePlanner.selectedIds.delete(id);
      syncQueueSelectionControls();
    });
  });

  list.querySelectorAll('[data-queue-priority]').forEach((el) => {
    el.addEventListener('change', async () => {
      const id = el.getAttribute('data-queue-priority');
      if (!id) return;
      await updateQueueItemPatch(id, { priority: el.value });
    });
  });

  list.querySelectorAll('[data-queue-schedule]').forEach((el) => {
    el.addEventListener('change', async () => {
      const id = el.getAttribute('data-queue-schedule');
      if (!id) return;
      await updateQueueItemPatch(id, { scheduledAfter: fromLocalDateTimeInput(el.value) });
    });
  });

  if (!canDrag) return;

  list.querySelectorAll('.queue-row[data-queue-id]').forEach((row) => {
    row.addEventListener('dragstart', (event) => {
      const id = row.getAttribute('data-queue-id');
      if (!id) return;
      state.queuePlanner.draggingId = id;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', id);
      }
    });

    row.addEventListener('dragover', (event) => {
      event.preventDefault();
      row.classList.add('queue-drop-target');
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('queue-drop-target');
    });

    row.addEventListener('drop', async (event) => {
      event.preventDefault();
      row.classList.remove('queue-drop-target');
      const targetId = row.getAttribute('data-queue-id');
      const dragId = state.queuePlanner.draggingId || event.dataTransfer?.getData('text/plain') || '';
      state.queuePlanner.draggingId = '';
      if (!dragId || !targetId || dragId === targetId) return;
      await reorderQueueByDrag(dragId, targetId);
    });

    row.addEventListener('dragend', () => {
      state.queuePlanner.draggingId = '';
      row.classList.remove('queue-drop-target');
    });
  });
}

function formatScheduledTime(value) {
  if (!value) return 'No schedule';
  const ts = new Date(value);
  if (!Number.isFinite(ts.getTime())) return 'No schedule';
  return `Scheduled ${formatDateTime12h(ts.toISOString())}`;
}

function toLocalDateTimeInput(value) {
  if (!value) return '';
  const ts = new Date(value);
  if (!Number.isFinite(ts.getTime())) return '';
  const offsetMs = ts.getTimezoneOffset() * 60000;
  const local = new Date(ts.getTime() - offsetMs);
  return local.toISOString().slice(0, 16);
}

function fromLocalDateTimeInput(value) {
  const clean = String(value || '').trim();
  if (!clean) return null;
  const ts = new Date(clean);
  if (!Number.isFinite(ts.getTime())) return null;
  return ts.toISOString();
}

function pruneQueueSelection() {
  const validIds = new Set((state.queue || []).map((item) => item.id));
  state.queuePlanner.selectedIds.forEach((id) => {
    if (!validIds.has(id)) state.queuePlanner.selectedIds.delete(id);
  });
}

function syncQueueSelectionControls() {
  const selectAll = byId('queue-select-all');
  if (selectAll) {
    const rows = getFilteredQueueRows();
    const selectableIds = rows.map((item) => item.id);
    const selectedCount = selectableIds.filter((id) => state.queuePlanner.selectedIds.has(id)).length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < selectableIds.length;
    selectAll.checked = selectableIds.length > 0 && selectedCount === selectableIds.length;
  }

  const clearBtn = byId('queue-bulk-clear-btn');
  if (clearBtn) {
    clearBtn.textContent = `Clear Selection (${state.queuePlanner.selectedIds.size})`;
  }
}

function handleQueueSelectAll(event) {
  const checked = !!event?.target?.checked;
  const rows = getFilteredQueueRows();
  rows.forEach((item) => {
    if (checked) state.queuePlanner.selectedIds.add(item.id);
    else state.queuePlanner.selectedIds.delete(item.id);
  });
  renderQueueList();
}

function clearQueueSelection() {
  state.queuePlanner.selectedIds.clear();
  renderQueueList();
}

function updateQueueBulkControls() {
  const action = byId('queue-bulk-action')?.value || 'priority';
  const priorityField = byId('queue-bulk-priority');
  const scheduleField = byId('queue-bulk-schedule');
  if (priorityField) priorityField.disabled = action !== 'priority';
  if (scheduleField) scheduleField.disabled = action !== 'schedule';
}

async function applyQueueBulkAction() {
  const ids = Array.from(state.queuePlanner.selectedIds);
  if (!ids.length) {
    showToast('Select at least one queue item first.', 'warn');
    return;
  }

  const action = byId('queue-bulk-action')?.value || 'priority';
  try {
    if (action === 'remove') {
      if (!window.confirm(`Remove ${ids.length} selected queue item(s)?`)) return;
      const response = await apiRequest('/api/queue/bulk-remove', {
        method: 'POST',
        body: { ids },
      });
      showToast(response.message || 'Selected queue items removed.', 'success');
      state.queuePlanner.selectedIds.clear();
      await refreshAll({ force: true });
      return;
    }

    let patch = {};
    if (action === 'priority') {
      patch.priority = byId('queue-bulk-priority')?.value || 'normal';
    } else if (action === 'schedule') {
      patch.scheduledAfter = fromLocalDateTimeInput(byId('queue-bulk-schedule')?.value || '');
      if (!patch.scheduledAfter) {
        showToast('Select a valid schedule time for bulk scheduling.', 'warn');
        return;
      }
    } else if (action === 'clear_schedule') {
      patch.scheduledAfter = null;
    }

    const response = await apiRequest('/api/queue/bulk-update', {
      method: 'POST',
      body: { ids, patch },
    });
    showToast(response.message || 'Bulk queue update applied.', 'success');
    await refreshAll({ force: true });
  } catch (error) {
    showToast(error.message || 'Bulk queue action failed.', 'error');
  }
}

async function updateQueueItemPatch(id, patch) {
  try {
    await apiRequest(`/api/queue/item/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch,
    });

    state.queue = state.queue.map((item) => (
      item.id === id
        ? {
          ...item,
          ...patch,
          priority: Object.prototype.hasOwnProperty.call(patch, 'priority')
            ? normalizeQueuePriority(patch.priority)
            : normalizeQueuePriority(item.priority),
          scheduledAfter: Object.prototype.hasOwnProperty.call(patch, 'scheduledAfter')
            ? (patch.scheduledAfter || null)
            : (item.scheduledAfter || null),
        }
        : item
    ));

    renderQueueList();
    renderMiniQueue();
  } catch (error) {
    showToast(error.message || 'Queue item update failed.', 'error');
    await refreshAll({ force: true });
  }
}

async function reorderQueueByDrag(dragId, targetId) {
  const fromIndex = state.queue.findIndex((item) => item.id === dragId);
  const toIndex = state.queue.findIndex((item) => item.id === targetId);
  if (fromIndex === -1 || toIndex === -1) return;

  const updated = [...state.queue];
  const [moved] = updated.splice(fromIndex, 1);
  updated.splice(toIndex, 0, moved);
  state.queue = updated;
  renderQueueList();

  try {
    await apiRequest('/api/queue/reorder', {
      method: 'POST',
      body: { orderedIds: updated.map((item) => item.id) },
    });
  } catch (error) {
    showToast(error.message || 'Queue reorder failed.', 'error');
    await refreshAll({ force: true });
  }
}

function renderMiniQueue() {
  const lists = [byId('pin-queue-list-mini'), byId('dashboard-queue-list')].filter(Boolean);
  if (lists.length === 0) return;

  const pending = state.queue.filter(item => item.status === 'pending' || item.status === 'processing');
  
  lists.forEach(list => {
    if (!pending.length) {
      list.innerHTML = '<div class="pulse-item">No pending Pinterest missions.</div>';
      return;
    }

    list.innerHTML = pending.slice(0, 5).map(item => `
      <div class="list-item" style="padding: 8px;">
        <div class="list-item-main">
          <div style="font-size: 13px; font-weight: 600;">${escHtml(item.title || 'Untitled')}</div>
        </div>
        <span class="badge status-${escHtml(item.status || 'pending')}" style="font-size: 10px;">${String(item.status || 'PENDING').toUpperCase()}</span>
      </div>
    `).join('');
  });
}

function renderDashboardHistory() {
  const list = byId('dashboard-history-list');
  if (!list) return;

  if (!state.history.length) {
    list.innerHTML = '<div class="pulse-item">No recent post history yet. Posts will appear here after the bot runs.</div>';
    return;
  }

  list.innerHTML = state.history.slice(0, 5).map(item => {
    const title = escHtml(item.aiContent?.title || item.title || 'Untitled');
    const status = item.status || 'success';
    const badgeClass = status === 'success' ? 'badge-success' : 'badge-error';
    const username = item.reelData?.username ? `@${escHtml(item.reelData.username)}` : '';
    const hasLink = !!(item.affiliateLink);
    const linkBadge = hasLink ? `<span class="badge badge-success" style="font-size:9px;margin-left:4px;">🔗 Link</span>` : '';
    const postedAt = item.postedAt || item.createdAt;
    const when = postedAt ? formatTimeAgo(postedAt) : '';
    return `
      <div class="list-item" style="padding: 8px;">
        <div class="list-item-main">
          <div>
            <div style="font-size: 13px; font-weight: 600;">${title}${linkBadge}</div>
            ${username || when ? `<div style="font-size:11px;opacity:0.6;">${username}${username && when ? ' · ' : ''}${escHtml(when)}</div>` : ''}
          </div>
        </div>
        <span class="badge ${badgeClass}" style="font-size: 10px;">${status.toUpperCase()}</span>
      </div>
    `;
  }).join('');
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

  const virtual = getVirtualWindow(list, rows, 'history');
  const itemsHtml = virtual.items
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

  const topSpacer = virtual.top > 0 ? `<div class="virtual-spacer" style="height:${virtual.top}px"></div>` : '';
  const bottomSpacer = virtual.bottom > 0 ? `<div class="virtual-spacer" style="height:${virtual.bottom}px"></div>` : '';
  list.innerHTML = `${topSpacer}${itemsHtml}${bottomSpacer}`;
  bindVirtualScroll(list, 'history', renderHistoryList);
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
  const count = parseInt(byId('engage-count-manual')?.value || byId('engage-count')?.value || '20', 10);
  const niche = byId('engage-niche')?.value || 'all';

  button.disabled = true;
  button.textContent = 'Firing...';
  try {
    const response = await apiRequest('/api/engage', {
      method: 'POST',
      body: { count, niche },
    });
    showToast(response.message || 'Booster started.', 'success');
    await renderEngagementAuditList();
  } catch (error) {
    showToast(error.message || 'Booster failed to start.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Engage Bot';
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

    // System Status Panel
    setBadgeByState('diag-runtime', system.runtime?.isServerless ? 'Cloud' : 'Local', 'success');
    setBadgeByState('diag-posting', String(system.posting?.resolvedMode || pinterest.resolvedPostingMode || 'api').toUpperCase(), 'success');
    setBadgeByState('diag-storage', String(system.queue?.storageMode || system.storage?.mode || 'memory').toUpperCase(), 'warn');

    // Pinterest Setup Card
    const pinBadge = byId('settings-badge-pin');
    const pinLinkBtn = byId('link-session-btn');
    const pinUnlinkBtn = byId('unlink-session-btn');
    
    if (session.session?.hasSession) {
      setBadge(pinBadge, 'Linked', 'success');
      pinLinkBtn?.classList.add('hidden');
      pinUnlinkBtn?.classList.remove('hidden');
    } else {
      setBadge(pinBadge, 'Not Linked', 'error');
      pinLinkBtn?.classList.remove('hidden');
      pinUnlinkBtn?.classList.add('hidden');
    }

    // X Console Setup Card (Mock check using system status or global xState)
    const xBadge = byId('settings-badge-x');
    const xLinkBtn = byId('link-x-session-btn');
    const xUnlinkBtn = byId('unlink-x-session-btn');
    const xActive = typeof xState !== 'undefined' && xState.connected;

    if (xActive) {
      setBadge(xBadge, 'Linked', 'success');
      xLinkBtn?.classList.add('hidden');
      xUnlinkBtn?.classList.remove('hidden');
    } else {
      setBadge(xBadge, 'Not Linked', 'error');
      xLinkBtn?.classList.remove('hidden');
      xUnlinkBtn?.classList.add('hidden');
    }

  } catch (error) {
    console.error('Diagnostics failed', error);
  }
}

async function linkIgSession() {
  const val = byId('ig-session-cookie')?.value.trim();
  if (!val) return showToast('Enter Instagram sessionid', 'error');
  
  try {
    // We assume an endpoint for IG session exists or will be added
    const res = await apiRequest('/api/ig/session', {
      method: 'POST',
      body: { cookie: val }
    });
    showToast(res.message || 'Instagram session saved', 'success');
    byId('ig-session-cookie').value = '';
  } catch (error) {
    showToast(error.message || 'Failed to save IG session', 'error');
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
    state.queuePlanner.selectedIds.clear();
    renderQueueList();
    renderMiniQueue();
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

async function createQueueSnapshot(reason = 'manual') {
  const response = await apiRequest('/api/queue/snapshots', {
    method: 'POST',
    body: {
      label: `Queue Snapshot ${new Date().toLocaleString()}`,
      reason,
    },
  });
  if (reason === 'manual') {
    showToast(response.message || 'Queue snapshot created.', 'success');
  }
  return response.snapshot;
}

async function restoreLatestQueueSnapshot() {
  try {
    const response = await apiRequest('/api/queue/snapshots');
    const latest = Array.isArray(response.snapshots) ? response.snapshots[0] : null;
    if (!latest) {
      showToast('No queue snapshot found to restore.', 'warn');
      return;
    }
    if (!window.confirm(`Restore queue snapshot from ${formatDateTime12h(latest.createdAt)}?`)) return;
    const restore = await apiRequest(`/api/queue/snapshots/${encodeURIComponent(latest.id)}/restore`, { method: 'POST' });
    showToast(restore.message || 'Queue snapshot restored.', 'success');
    state.queuePlanner.selectedIds.clear();
    await refreshAll({ force: true });
  } catch (error) {
    showToast(error.message || 'Failed to restore queue snapshot.', 'error');
  }
}

async function createHistorySnapshot(reason = 'manual') {
  const response = await apiRequest('/api/history/snapshots', {
    method: 'POST',
    body: {
      label: `History Snapshot ${new Date().toLocaleString()}`,
      reason,
    },
  });
  if (reason === 'manual') {
    showToast(response.message || 'History snapshot created.', 'success');
  }
  return response.snapshot;
}

async function restoreLatestHistorySnapshot() {
  try {
    const response = await apiRequest('/api/history/snapshots');
    const latest = Array.isArray(response.snapshots) ? response.snapshots[0] : null;
    if (!latest) {
      showToast('No history snapshot found to restore.', 'warn');
      return;
    }
    if (!window.confirm(`Restore history snapshot from ${formatDateTime12h(latest.createdAt)}?`)) return;
    const restore = await apiRequest(`/api/history/snapshots/${encodeURIComponent(latest.id)}/restore`, { method: 'POST' });
    showToast(restore.message || 'History snapshot restored.', 'success');
    await refreshAll({ force: true });
  } catch (error) {
    showToast(error.message || 'Failed to restore history snapshot.', 'error');
  }
}


async function handleRemoveQueueItem(id) {
  if (!confirm('Remove this item from queue?')) return;
  try {
    const res = await apiRequest(`/api/queue/${id}`, { method: 'DELETE' });
    showToast(res.message || 'Item removed.', 'success');
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handlePromoteQueueItem(id) {
  try {
    const res = await apiRequest(`/api/queue/promote/${id}`, { method: 'POST' });
    showToast(res.message || 'Item promoted and bot fired!', 'success');
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

window.handleRemoveQueueItem = handleRemoveQueueItem;
window.handlePromoteQueueItem = handlePromoteQueueItem;

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

function renderAlertCenter(pinterestStatus = {}, systemStatus = {}) {
  const list = byId('alert-center-list');
  const countBadge = byId('alert-center-count');
  if (!list || !countBadge) return;

  const alerts = [];
  const pendingCount = state.queue.filter((item) => ['pending', 'processing'].includes(String(item.status || '').toLowerCase())).length;
  const failedQueueCount = state.queue.filter((item) => ['failed', 'error'].includes(String(item.status || '').toLowerCase())).length;
  const failedHistoryCount = state.history.filter((item) => ['failed', 'error'].includes(String(item.status || '').toLowerCase())).length;

  if (!pinterestStatus.connected && !pinterestStatus.sessionLinked) {
    alerts.push({
      level: 'error',
      title: 'Pinterest account is not connected',
      subtitle: 'Link API token or session cookie to publish successfully.',
      actionLabel: 'Open Settings',
      action: () => switchTab('settings'),
    });
  }

  if (failedQueueCount > 0) {
    alerts.push({
      level: 'warn',
      title: `${failedQueueCount} failed queue item(s) need attention`,
      subtitle: 'Review failures, retry, or remove problematic missions.',
      actionLabel: 'Open Queue',
      action: () => {
        switchTab('queue');
        const statusFilter = byId('queue-status-filter');
        if (statusFilter) statusFilter.value = 'failed';
        renderQueueList();
      },
    });
  }

  if (failedHistoryCount > 0) {
    alerts.push({
      level: 'warn',
      title: `${failedHistoryCount} failed history entry(s) detected`,
      subtitle: 'Inspect posting errors and verify account/session health.',
      actionLabel: 'Open History',
      action: () => {
        switchTab('history');
        const statusFilter = byId('history-status-filter');
        if (statusFilter) statusFilter.value = 'error';
        renderHistoryList();
      },
    });
  }

  if (pendingCount >= 25) {
    alerts.push({
      level: 'info',
      title: `Queue backlog is high (${pendingCount} pending)`,
      subtitle: 'Consider running queue bot now or prioritizing urgent missions.',
      actionLabel: 'Run Bot',
      action: () => processQueueNow(),
    });
  }

  if (state.performance.enabled) {
    alerts.push({
      level: 'info',
      title: 'Performance mode is enabled',
      subtitle: 'Animations are reduced and refreshes are throttled for smoother UX.',
      actionLabel: 'Disable',
      action: () => applyPerformanceMode(false, { persist: true, notify: true }),
    });
  }

  if (!alerts.length) {
    alerts.push({
      level: 'info',
      title: 'All systems nominal',
      subtitle: `Runtime ${systemStatus?.runtime?.isServerless ? 'Cloud' : 'Local'} and queue health look good.`,
      actionLabel: 'Refresh',
      action: () => refreshAll({ force: true }),
    });
  }

  state.alerts = alerts;
  countBadge.textContent = `${alerts.length} ALERT${alerts.length === 1 ? '' : 'S'}`;

  list.innerHTML = alerts.map((alert, index) => `
    <div class="alert-item alert-${escAttr(alert.level)}" data-alert-index="${index}">
      <div class="alert-item-main">
        <div class="alert-item-title">${escHtml(alert.title)}</div>
        <div class="alert-item-sub">${escHtml(alert.subtitle)}</div>
      </div>
      <button class="pill-btn" type="button" data-alert-action="${index}">${escHtml(alert.actionLabel || 'Open')}</button>
    </div>
  `).join('');

  list.querySelectorAll('[data-alert-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.getAttribute('data-alert-action'));
      const alert = state.alerts[index];
      if (alert && typeof alert.action === 'function') alert.action();
    });
  });
}

function getCommandItems() {
  return [
    { title: 'Open Dashboard', meta: 'Tab', run: () => switchTab('dashboard') },
    { title: 'Open Queue', meta: 'Tab', run: () => switchTab('queue') },
    { title: 'Open Pinterest Builder', meta: 'Tab', run: () => switchTab('pinterest') },
    { title: 'Open History', meta: 'Tab', run: () => switchTab('history') },
    { title: 'Open Settings', meta: 'Tab', run: () => switchTab('settings') },
    { title: 'Refresh Everything', meta: 'Action', run: () => refreshAll({ force: true }) },
    { title: 'Run Queue Bot', meta: 'Action', run: () => processQueueNow() },
    { title: 'Retry Failed Queue Items', meta: 'Action', run: () => retryFailed() },
    { title: 'Toggle Performance Mode', meta: 'System', run: () => applyPerformanceMode(!state.performance.enabled, { persist: true, notify: true }) },
    { title: 'Cycle Visual Theme', meta: 'System', run: () => handleVisualModeToggle() },
    { title: 'Create Queue Snapshot', meta: 'Safety', run: () => createQueueSnapshot('manual') },
    { title: 'Restore Latest Queue Snapshot', meta: 'Safety', run: () => restoreLatestQueueSnapshot() },
    { title: 'Create History Snapshot', meta: 'Safety', run: () => createHistorySnapshot('manual') },
    { title: 'Restore Latest History Snapshot', meta: 'Safety', run: () => restoreLatestHistorySnapshot() },
  ];
}

function initCommandPalette() {
  const input = byId('command-input');
  if (input) {
    input.addEventListener('input', renderCommandResults);
    input.addEventListener('keydown', handleCommandInputKeydown);
  }
}

function openCommandPalette() {
  const root = byId('command-palette');
  const input = byId('command-input');
  if (!root || !input) return;
  root.classList.remove('hidden');
  state.commandPalette.open = true;
  state.commandPalette.activeIndex = 0;
  input.value = '';
  renderCommandResults();
  setTimeout(() => input.focus(), 0);
}

function closeCommandPalette() {
  const root = byId('command-palette');
  if (!root) return;
  root.classList.add('hidden');
  state.commandPalette.open = false;
}

function renderCommandResults() {
  const resultsEl = byId('command-results');
  const input = byId('command-input');
  if (!resultsEl || !input) return;

  const query = String(input.value || '').trim().toLowerCase();
  const all = getCommandItems();
  const results = all.filter((item) => {
    if (!query) return true;
    return `${item.title} ${item.meta}`.toLowerCase().includes(query);
  });

  state.commandPalette.results = results;
  if (state.commandPalette.activeIndex >= results.length) state.commandPalette.activeIndex = 0;

  if (!results.length) {
    resultsEl.innerHTML = '<div class="pulse-item">No command found.</div>';
    return;
  }

  resultsEl.innerHTML = results.map((item, index) => `
    <button class="command-item ${index === state.commandPalette.activeIndex ? 'active' : ''}" type="button" data-command-index="${index}">
      <span>
        <span class="command-item-title">${escHtml(item.title)}</span>
        <span class="command-item-meta">${escHtml(item.meta)}</span>
      </span>
      <span class="badge">${index === state.commandPalette.activeIndex ? 'ENTER' : ''}</span>
    </button>
  `).join('');

  resultsEl.querySelectorAll('[data-command-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.getAttribute('data-command-index'));
      runPaletteCommand(index);
    });
  });
}

function handleCommandInputKeydown(event) {
  if (!state.commandPalette.open) return;
  const max = state.commandPalette.results.length - 1;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    state.commandPalette.activeIndex = Math.min(max, state.commandPalette.activeIndex + 1);
    renderCommandResults();
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    state.commandPalette.activeIndex = Math.max(0, state.commandPalette.activeIndex - 1);
    renderCommandResults();
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    runPaletteCommand(state.commandPalette.activeIndex);
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closeCommandPalette();
  }
}

function runPaletteCommand(index) {
  const item = state.commandPalette.results[index];
  if (!item) return;
  closeCommandPalette();
  try {
    item.run();
  } catch (error) {
    showToast(error.message || 'Command failed.', 'error');
  }
}

function handleGlobalKeyDown(event) {
  if (event.key === 'Escape') setPreviewScrollLock(false);
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

function getAutosaveFieldIds() {
  return [
    'reel-url',
    'field-title',
    'field-desc',
    'field-link',
    'field-alt',
    'x-field-text',
    'session-cookie',
    'x-session-cookie',
    'ig-session-cookie',
    'engage-niche',
    'engage-count-manual',
    'x-engage-count',
    'new-channel-input',
  ];
}

function readAutosaveValues() {
  const values = {};
  getAutosaveFieldIds().forEach((id) => {
    const el = byId(id);
    if (!el) return;
    values[id] = String(el.value ?? '');
  });
  return values;
}

function writeAutosaveValues(values = {}) {
  state.autosave.applying = true;
  getAutosaveFieldIds().forEach((id) => {
    const el = byId(id);
    if (!el) return;
    if (Object.prototype.hasOwnProperty.call(values, id)) {
      el.value = String(values[id] ?? '');
    }
  });
  state.autosave.applying = false;

  updateComposerMeta();
  if (typeof window.updateXTextMeta === 'function') {
    try { window.updateXTextMeta(); } catch {}
  }

  const manualCount = byId('engage-count-manual');
  const dashboardCount = byId('engage-count');
  if (manualCount && dashboardCount) dashboardCount.value = manualCount.value;
  setText('engage-count-value', manualCount?.value || '');
  setText('engage-count-value-dashboard', dashboardCount?.value || manualCount?.value || '');
}

function snapshotHash(values) {
  return JSON.stringify(values);
}

function updateAutosaveStatus(text, tone = '') {
  const status = byId('autosave-status');
  if (!status) return;
  status.textContent = text;
  status.className = 'input-meta';
  if (tone) status.classList.add(tone);
}

function persistAutosave() {
  const payload = {
    values: readAutosaveValues(),
    undoStack: state.autosave.undoStack.slice(-AUTOSAVE_MAX_STACK),
    redoStack: state.autosave.redoStack.slice(-AUTOSAVE_MAX_STACK),
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

function pushAutosaveSnapshot(values, label = 'Saved') {
  const hash = snapshotHash(values);
  const previous = state.autosave.undoStack[state.autosave.undoStack.length - 1];
  if (previous && snapshotHash(previous.values) === hash) return;

  state.autosave.undoStack.push({
    values,
    at: Date.now(),
  });
  if (state.autosave.undoStack.length > AUTOSAVE_MAX_STACK) {
    state.autosave.undoStack = state.autosave.undoStack.slice(-AUTOSAVE_MAX_STACK);
  }
  state.autosave.redoStack = [];
  persistAutosave();
  updateAutosaveStatus(`${label} ${formatTime12h(new Date())}`, 'success');
}

function handleAutosaveTrackedInput() {
  if (state.autosave.applying) return;
  if (state.autosave.timer) clearTimeout(state.autosave.timer);
  state.autosave.timer = setTimeout(() => {
    const values = readAutosaveValues();
    pushAutosaveSnapshot(values, 'Autosaved');
  }, 300);
}

function initAutosaveSystem() {
  let payload = null;
  try {
    payload = JSON.parse(localStorage.getItem(AUTOSAVE_STORAGE_KEY) || 'null');
  } catch {
    payload = null;
  }

  if (payload && payload.values && typeof payload.values === 'object') {
    writeAutosaveValues(payload.values);
  }

  state.autosave.undoStack = Array.isArray(payload?.undoStack) ? payload.undoStack.slice(-AUTOSAVE_MAX_STACK) : [];
  state.autosave.redoStack = Array.isArray(payload?.redoStack) ? payload.redoStack.slice(-AUTOSAVE_MAX_STACK) : [];

  if (!state.autosave.undoStack.length) {
    pushAutosaveSnapshot(readAutosaveValues(), 'Autosave baseline');
  } else {
    updateAutosaveStatus(`Restored ${formatTime12h(payload?.savedAt || new Date())}`, 'success');
  }
}

function undoAutosaveSnapshot() {
  if (state.autosave.undoStack.length <= 1) {
    showToast('No more undo history.', 'info');
    return;
  }

  const current = state.autosave.undoStack.pop();
  if (current) state.autosave.redoStack.push(current);
  const previous = state.autosave.undoStack[state.autosave.undoStack.length - 1];
  if (!previous) return;
  writeAutosaveValues(previous.values || {});
  persistAutosave();
  updateAutosaveStatus(`Undo ${formatTime12h(new Date())}`, 'warn');
}

function redoAutosaveSnapshot() {
  if (!state.autosave.redoStack.length) {
    showToast('No redo history.', 'info');
    return;
  }

  const next = state.autosave.redoStack.pop();
  if (!next) return;
  state.autosave.undoStack.push(next);
  writeAutosaveValues(next.values || {});
  persistAutosave();
  updateAutosaveStatus(`Redo ${formatTime12h(new Date())}`, 'warn');
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
    // Use encodeURIComponent-safe base64 encoding to avoid btoa() crashes
    // on Instagram CDN URLs that contain non-Latin-1 characters.
    const bytes = new TextEncoder().encode(clean);
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    const encoded = btoa(binary);
    return `/api/proxy?url=${encodeURIComponent(encoded)}`;
  } catch {
    // Final fallback: send raw URL directly (server will validate)
    return `/api/proxy?url=${encodeURIComponent(clean)}`;
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

function normalizeUsernameValue(value) {
  return String(value || '').trim().toLowerCase();
}

async function refreshChannels() {
  const list = byId('channels-list');
  if (!list) return;

  try {
    const res = await apiRequest('/api/ig-tracker/channels');
    state.channels = Array.isArray(res.channels) ? res.channels : [];
    renderChannelsList();
  } catch (err) {
    list.innerHTML = `<div class="pulse-item error-text">Failed to load channels: ${err.message}</div>`;
  }
}

function renderChannelsList() {
  const list = byId('channels-list');
  if (!list) return;

  if (state.channels.length === 0) {
    list.innerHTML = '<div class="pulse-item">No target channels added yet.</div>';
    setText('hero-channel-count', '0');
    return;
  }

  list.innerHTML = state.channels.map(ch => {
    const username = String(typeof ch === 'string' ? ch : ch.username || '').trim();
    if (!username) return '';
    const pic = typeof ch === 'object' && ch.profilePicUrl ? ch.profilePicUrl : '';
    const avatarLabel = (username.charAt(0) || '@').toUpperCase();
    const avatarHtml = `
      <div class="avatar-circle avatar-stack channel-avatar ${pic ? 'has-avatar' : ''}" data-avatar-username="${escAttr(normalizeUsernameValue(username))}" data-avatar-state="${pic ? 'ready' : 'pending'}">
        <span class="avatar-fallback">${escHtml(avatarLabel)}</span>
        ${pic ? `<img src="${escAttr(proxyMediaUrl(pic))}" class="avatar-img" alt="@${escAttr(username)} profile picture" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.channel-avatar')?.classList.remove('has-avatar'); this.remove();">` : ''}
      </div>
    `;

    return `
      <div class="list-item">
        <div class="list-item-main">
          ${avatarHtml}
          <div>
            <div class="item-title">@${escHtml(username)}</div>
            <div class="item-meta">Instagram Target Channel</div>
          </div>
        </div>
        <div class="item-actions">
          <a href="https://www.instagram.com/${escHtml(username)}" target="_blank" class="pill-btn">View Profile</a>
          <button class="btn btn-danger compact-btn" onclick="handleRemoveChannel('${escAttr(username)}')">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  setText('hero-channel-count', String(state.channels.length));
  void hydrateChannelAvatars();
  
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function applyChannelAvatar(username, profilePicUrl) {
  const cleanUsername = normalizeUsernameValue(username);
  if (!cleanUsername || !profilePicUrl) return;

  state.channels = state.channels.map((ch) => {
    if (typeof ch === 'string') {
      return normalizeUsernameValue(ch) === cleanUsername
        ? { username: ch, profilePicUrl }
        : ch;
    }

    const chUsername = normalizeUsernameValue(ch?.username);
    return chUsername === cleanUsername
      ? { ...ch, profilePicUrl }
      : ch;
  });

  const avatarEl = Array.from(document.querySelectorAll('.channel-avatar')).find(el => el.dataset.avatarUsername === cleanUsername);
  if (!avatarEl) return;

  avatarEl.dataset.avatarState = 'ready';
  avatarEl.classList.add('has-avatar');

  let img = avatarEl.querySelector('.avatar-img');
  if (!img) {
    img = document.createElement('img');
    img.className = 'avatar-img';
    img.alt = `@${username} profile picture`;
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => {
      avatarEl.classList.remove('has-avatar');
      avatarEl.dataset.avatarState = 'missing';
      img.remove();
    };
    avatarEl.appendChild(img);
  }

  img.src = proxyMediaUrl(profilePicUrl);
}

async function hydrateChannelAvatars() {
  const pendingAvatars = Array.from(document.querySelectorAll('.channel-avatar[data-avatar-state="pending"]'));
  if (pendingAvatars.length === 0) return;

  await Promise.allSettled(pendingAvatars.map(async (avatarEl) => {
    const username = String(avatarEl.dataset.avatarUsername || '').trim();
    if (!username) return;

    const lastRequestAt = Number(state.channelAvatarRequests?.[username] || 0);
    if (lastRequestAt && (Date.now() - lastRequestAt) < 60000) return;

    state.channelAvatarRequests[username] = Date.now();
    avatarEl.dataset.avatarState = 'loading';

    try {
      const res = await apiRequest(`/api/ig-tracker/profile-pic?username=${encodeURIComponent(username)}`);
      if (res.profilePicUrl) {
        applyChannelAvatar(res.username || username, res.profilePicUrl);
      } else {
        avatarEl.dataset.avatarState = 'missing';
      }
    } catch {
      avatarEl.dataset.avatarState = 'missing';
    }
  }));
}

async function handleAddChannel() {
  const input = byId('new-channel-input');
  const btn = byId('add-channel-btn');
  const rawInput = String(input?.value || '').trim();

  if (!rawInput) {
    showToast('Please enter a username or Instagram URL.', 'error');
    return;
  }

  btn.disabled = true;
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i data-lucide="loader-2" class="btn-icon animate-spin"></i><span>Adding...</span>';
  if (typeof lucide !== 'undefined') lucide.createIcons();

  try {
    const res = await apiRequest('/api/ig-tracker/channels', {
      method: 'POST',
      body: { username: rawInput }
    });

    showToast(res.message || `Channel @${res.username} added. Verification started.`, 'success');
    input.value = '';
    await refreshChannels();
  } catch (err) {
    showToast(err.message || 'Failed to add channel.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

async function handleRemoveChannel(username) {
  if (!confirm(`Remove @${username} from target channels?`)) return;

  try {
    await apiRequest('/api/ig-tracker/channels', {
      method: 'DELETE',
      body: { username }
    });
    showToast(`Channel @${username} removed.`, 'success');
    await refreshChannels();
  } catch (err) {
    showToast(err.message || 'Failed to remove channel.', 'error');
  }
}

window.handleRemoveChannel = handleRemoveChannel;

async function handleWorkflowToggle(id, enabled) {
  const mapping = {
    'wf-pinterest-posting': 'pinterestPosting',
    'wf-pinterest-engagement': 'pinterestEngagement',
    'wf-x-posting': 'xPosting',
    'wf-x-engagement': 'xEngagement'
  };
  
  const key = mapping[id];
  if (!key) return;

  try {
    await apiRequest('/api/system/workflows', {
      method: 'POST',
      body: { [key]: enabled }
    });
    showToast(`${key} workflow ${enabled ? 'ENABLED' : 'DISABLED'}`, 'info');
  } catch (err) {
    showToast(`Failed to update workflow: ${err.message}`, 'error');
    // Revert UI on failure
    const el = byId(id);
    if (el) el.checked = !enabled;
  }
}

function updateWorkflowUI(config) {
  if (!config) return;
  const mapping = {
    'pinterestPosting': 'wf-pinterest-posting',
    'pinterestEngagement': 'wf-pinterest-engagement',
    'xPosting': 'wf-x-posting',
    'xEngagement': 'wf-x-engagement'
  };

  for (const [key, id] of Object.entries(mapping)) {
    const el = byId(id);
    if (el && typeof config[key] !== 'undefined') {
      el.checked = !!config[key];
    }
  }
}

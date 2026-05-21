const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function formatNumber(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('en-IN').format(number);
}

function openLogin() {
  const dialog = $('#login-dialog');
  if (!dialog) return;
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
  window.setTimeout(() => {
    $('input[name="username"]', dialog)?.focus();
  }, 40);
}

function closeLogin() {
  const dialog = $('#login-dialog');
  if (!dialog) return;
  if (typeof dialog.close === 'function') dialog.close();
  dialog.removeAttribute('open');
}

async function apiPost(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.message || `Request failed with ${response.status}`);
  }
  return data;
}

function collectForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setStatus(el, message, type = '') {
  if (!el) return;
  el.textContent = message;
  el.classList.remove('success', 'error');
  if (type) el.classList.add(type);
}

async function handleWaitlistSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $('#waitlist-status');
  const submit = $('button[type="submit"]', form);

  setStatus(status, 'Sending your request...', '');
  if (submit) submit.disabled = true;

  try {
    const payload = collectForm(form);
    payload.source = 'public_homepage';
    const result = await apiPost('/api/waitlist', payload);
    setStatus(status, result.message || 'You are on the waitlist. We will reach out soon.', 'success');
    if (!result.duplicate) form.reset();
  } catch (err) {
    setStatus(status, err.message || 'Could not send waitlist request.', 'error');
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $('#login-status');
  const submit = $('button[type="submit"]', form);

  setStatus(status, 'Checking owner access...', '');
  if (submit) submit.disabled = true;

  try {
    const result = await apiPost('/api/owner/login', collectForm(form));
    window.location.href = result.redirect || '/dashboard';
  } catch (err) {
    setStatus(status, err.message || 'Login failed.', 'error');
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function loadLiveStats() {
  try {
    const [status, waitlist] = await Promise.all([
      fetch('/api/pinterest-image/status', { headers: { 'Cache-Control': 'no-cache' } }).then((res) => res.json()),
      fetch('/api/waitlist/stats', { headers: { 'Cache-Control': 'no-cache' } }).then((res) => res.json()).catch(() => null),
    ]);
    if (status?.success !== false) {
      setText('stat-scraped', formatNumber(status.scrapedPins));
      setText('stat-queued', formatNumber(status.queue?.total));
      setText('stat-posted', formatNumber(status.postedPins));
      setText('stat-sources', formatNumber(status.channels?.length));
      setText('live-engine-state', 'online');
    }
    if (waitlist?.total > 0) {
      const note = $('.waitlist-note span');
      if (note) note.textContent = `${formatNumber(waitlist.total)} operator request${waitlist.total === 1 ? '' : 's'} captured so far. New requests go straight to admin review.`;
    }
  } catch {
    setText('live-engine-state', 'preview');
  }
}

function bindInteractions() {
  $$('[data-open-login]').forEach((button) => {
    button.addEventListener('click', openLogin);
  });
  $$('[data-close-login]').forEach((button) => {
    button.addEventListener('click', closeLogin);
  });

  $('#login-dialog')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeLogin();
  });
  $('#waitlist-form')?.addEventListener('submit', handleWaitlistSubmit);
  $('#login-form')?.addEventListener('submit', handleLoginSubmit);

  if (new URLSearchParams(window.location.search).get('login') === '1') {
    openLogin();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  bindInteractions();
  loadLiveStats();
  if (window.lucide) window.lucide.createIcons();
});

const express = require('express');
const router = express.Router();
const leadStorageService = require('../services/leadStorageService');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

function normalizeLead(lead = {}) {
  return {
    id: String(lead.id || ''),
    email: String(lead.email || '').trim(),
    pinId: String(lead.pinId || 'unknown').trim(),
    targetUrl: String(lead.targetUrl || '').trim(),
    timestamp: lead.timestamp || '',
    capturedAt: formatDate(lead.timestamp),
  };
}

function csvCell(value) {
  return `"${String(value || '').replace(/"/g, '""')}"`;
}

async function getSortedLeads() {
  const leads = await leadStorageService.getLeads();
  return (Array.isArray(leads) ? leads : [])
    .map(normalizeLead)
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
}

function renderDashboard(leads) {
  const total = leads.length;
  const uniqueEmails = new Set(leads.map((lead) => lead.email.toLowerCase()).filter(Boolean)).size;
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const todayCount = leads.filter((lead) => {
    if (!lead.timestamp) return false;
    return new Date(lead.timestamp).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === todayKey;
  }).length;

  const rows = leads.map((lead) => `
    <tr data-search="${escapeHtml(`${lead.email} ${lead.pinId} ${lead.targetUrl} ${lead.capturedAt}`.toLowerCase())}">
      <td data-label="Email">
        <div class="email-cell">
          <strong>${escapeHtml(lead.email || 'No email')}</strong>
          <button class="icon-btn" type="button" data-copy="${escapeHtml(lead.email)}" aria-label="Copy email">Copy</button>
        </div>
      </td>
      <td data-label="Captured">${escapeHtml(lead.capturedAt)}</td>
      <td data-label="Bridge Pin"><a href="/bridge/${encodeURIComponent(lead.pinId)}" target="_blank" rel="noopener">${escapeHtml(lead.pinId)}</a></td>
      <td data-label="Target">
        ${lead.targetUrl
          ? `<a class="target-link" href="${escapeHtml(lead.targetUrl)}" target="_blank" rel="noopener">Open</a>`
          : '<span class="muted">Manual match</span>'}
      </td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
      <meta name="robots" content="noindex,nofollow">
      <title>Admin - Captured Leads</title>
      <style>
        :root {
          --paper: #ffffff;
          --canvas: #f3f5f4;
          --ink: #15161a;
          --muted: #667085;
          --line: #e4e7eb;
          --accent: #e21d2b;
          --success: #087f5b;
          --soft: #edf7f2;
        }

        * { box-sizing: border-box; }

        body {
          margin: 0;
          min-height: 100svh;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          background: var(--canvas);
          color: var(--ink);
        }

        .page {
          width: min(1180px, 100%);
          margin: 0 auto;
          padding: 28px 18px;
        }

        .topbar {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 18px;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 10px;
          font-weight: 900;
        }

        .brand-mark {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          background: var(--accent);
          color: #ffffff;
          font-weight: 900;
        }

        h1 {
          margin: 14px 0 6px;
          font-size: clamp(30px, 5vw, 48px);
          line-height: 1;
          letter-spacing: 0;
        }

        .subtitle {
          margin: 0;
          color: var(--muted);
          font-size: 15px;
          line-height: 1.5;
        }

        .actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .btn,
        .icon-btn {
          border: 1px solid var(--line);
          background: var(--paper);
          color: var(--ink);
          border-radius: 8px;
          min-height: 38px;
          padding: 0 12px;
          font: inherit;
          font-size: 13px;
          font-weight: 850;
          cursor: pointer;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .btn.primary {
          background: var(--accent);
          border-color: var(--accent);
          color: #ffffff;
        }

        .stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          margin: 22px 0;
        }

        .stat {
          background: var(--paper);
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 16px;
        }

        .stat span {
          display: block;
          color: var(--muted);
          font-size: 12px;
          font-weight: 850;
          text-transform: uppercase;
          letter-spacing: 0;
        }

        .stat strong {
          display: block;
          margin-top: 8px;
          font-size: 30px;
          line-height: 1;
        }

        .panel {
          background: var(--paper);
          border: 1px solid var(--line);
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 14px 36px rgba(15, 23, 42, 0.08);
        }

        .panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 14px;
          border-bottom: 1px solid var(--line);
        }

        .search {
          width: min(420px, 100%);
          min-height: 42px;
          border: 1.5px solid var(--line);
          border-radius: 8px;
          padding: 0 13px;
          font: inherit;
          outline: none;
        }

        .search:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 4px rgba(226, 29, 43, 0.1);
        }

        .table-wrap { overflow-x: auto; }

        table {
          width: 100%;
          border-collapse: collapse;
          min-width: 760px;
        }

        th,
        td {
          padding: 13px 14px;
          text-align: left;
          border-bottom: 1px solid var(--line);
          vertical-align: middle;
          font-size: 14px;
        }

        th {
          color: #475467;
          background: #f8faf9;
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0;
        }

        tr:last-child td { border-bottom: 0; }
        a { color: #155eef; text-decoration: none; font-weight: 800; }
        a:hover { text-decoration: underline; }
        .muted { color: var(--muted); }

        .email-cell {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .empty {
          padding: 34px 16px;
          text-align: center;
          color: var(--muted);
        }

        .toast {
          position: fixed;
          left: 50%;
          bottom: 18px;
          transform: translateX(-50%) translateY(20px);
          opacity: 0;
          pointer-events: none;
          background: var(--ink);
          color: #ffffff;
          min-height: 40px;
          display: flex;
          align-items: center;
          padding: 0 14px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 850;
          transition: opacity 0.2s ease, transform 0.2s ease;
        }

        .toast.show {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }

        @media (max-width: 720px) {
          .page { padding: 18px 10px; }
          .topbar { display: block; }
          .actions { justify-content: flex-start; margin-top: 14px; }
          .stats { grid-template-columns: 1fr; }
          .panel-head { display: grid; }
          table { min-width: 0; }
          thead { display: none; }
          tbody, tr, td { display: block; width: 100%; }
          tr { border-bottom: 1px solid var(--line); padding: 10px 0; }
          tr:last-child { border-bottom: 0; }
          td { border: 0; padding: 7px 14px; }
          td::before {
            content: attr(data-label);
            display: block;
            color: var(--muted);
            font-size: 11px;
            font-weight: 900;
            text-transform: uppercase;
            margin-bottom: 4px;
          }
        }
      </style>
    </head>
    <body>
      <main class="page">
        <div class="topbar">
          <div>
            <div class="brand"><span class="brand-mark">A</span><span>Aura Closet Admin</span></div>
            <h1>Captured Leads</h1>
            <p class="subtitle">Emails collected from Pinterest bridge pages. Times are shown in IST.</p>
          </div>
          <div class="actions">
            <button class="btn" type="button" id="copy-emails">Copy emails</button>
            <a class="btn primary" href="/admin/leads.csv">Export CSV</a>
          </div>
        </div>

        <section class="stats" aria-label="Lead stats">
          <div class="stat"><span>Total leads</span><strong>${total}</strong></div>
          <div class="stat"><span>Unique emails</span><strong>${uniqueEmails}</strong></div>
          <div class="stat"><span>Today</span><strong>${todayCount}</strong></div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <strong>Email leads</strong>
            <input id="lead-search" class="search" type="search" placeholder="Search email, pin, or link..." autocomplete="off">
          </div>
          ${rows ? `
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Captured</th>
                    <th>Bridge Pin</th>
                    <th>Target</th>
                  </tr>
                </thead>
                <tbody id="lead-rows">${rows}</tbody>
              </table>
            </div>
          ` : '<div class="empty">No leads captured yet.</div>'}
        </section>
      </main>
      <div id="toast" class="toast" role="status"></div>

      <script>
        const LEADS = ${safeJson(leads)};
        const search = document.getElementById('lead-search');
        const rows = Array.from(document.querySelectorAll('#lead-rows tr'));
        const toast = document.getElementById('toast');

        function showToast(message) {
          if (!toast) return;
          toast.textContent = message;
          toast.classList.add('show');
          window.clearTimeout(showToast.timer);
          showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 1800);
        }

        async function copyText(text, message) {
          try {
            await navigator.clipboard.writeText(text);
            showToast(message);
          } catch {
            showToast('Copy failed');
          }
        }

        search?.addEventListener('input', () => {
          const query = search.value.trim().toLowerCase();
          rows.forEach((row) => {
            row.hidden = query && !row.dataset.search.includes(query);
          });
        });

        document.addEventListener('click', (event) => {
          const copyBtn = event.target.closest('[data-copy]');
          if (copyBtn) copyText(copyBtn.dataset.copy || '', 'Email copied');
        });

        document.getElementById('copy-emails')?.addEventListener('click', () => {
          const emails = Array.from(new Set(LEADS.map((lead) => lead.email).filter(Boolean)));
          copyText(emails.join('\\n'), emails.length ? 'All emails copied' : 'No emails yet');
        });
      </script>
    </body>
    </html>
  `;
}

router.get('/', async (req, res) => {
  const leads = await getSortedLeads();
  res.send(renderDashboard(leads));
});

router.get('/leads', async (req, res) => {
  const leads = await getSortedLeads();
  res.send(renderDashboard(leads));
});

router.get('/api/leads', async (req, res) => {
  const leads = await getSortedLeads();
  res.json({ success: true, total: leads.length, leads });
});

router.get('/leads.csv', async (req, res) => {
  const leads = await getSortedLeads();
  const header = ['timestamp', 'email', 'pinId', 'targetUrl'];
  const lines = [
    header.map(csvCell).join(','),
    ...leads.map((lead) => [lead.timestamp, lead.email, lead.pinId, lead.targetUrl].map(csvCell).join(',')),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="bridge-leads.csv"');
  res.send(lines.join('\n'));
});

module.exports = router;

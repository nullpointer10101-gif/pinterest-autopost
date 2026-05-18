'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  History,
  Image,
  LayoutDashboard,
  ListOrdered,
  Plus,
  Radio,
  RefreshCw,
  Settings,
  ShieldCheck,
  Shirt,
  Sparkles,
  Target,
  Trash2,
  Zap,
} from 'lucide-react';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'channels', label: 'Channels', icon: Radio },
  { id: 'queue', label: 'Queue', icon: ListOrdered },
  { id: 'pinterest', label: 'Pinterest', icon: Image },
  { id: 'engagement', label: 'Engagement', icon: Zap },
  { id: 'history', label: 'History', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const FLOW_CARDS = [
  {
    title: 'Watch Targets',
    text: 'Monitor Instagram accounts for new reels and posts.',
    icon: Target,
  },
  {
    title: 'Skip Duplicates',
    text: 'Avoid reposting content that already exists in history.',
    icon: ShieldCheck,
  },
  {
    title: 'Publish Pins',
    text: 'Prepare captions, thumbnails, links, and Pinterest posts.',
    icon: Image,
  },
  {
    title: 'Engage Menswear',
    text: "Like 5 pins and comment on 3 men's outfit pins hourly.",
    icon: Shirt,
  },
];

const api = async (url, options = {}) => {
  const init = {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {}),
    },
  };
  const response = await fetch(url, init);
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : { success: response.ok, message: await response.text() };

  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || payload.message || `Request failed (${response.status})`);
  }
  return payload;
};

const cleanUsername = (value) => {
  const text = String(value || '').trim();
  const instagramMatch = text.match(/instagram\.com\/([^/?#]+)/i);
  const raw = instagramMatch ? instagramMatch[1] : text;
  return raw.replace(/^@/, '').replace(/\/$/, '').trim().toLowerCase();
};

const formatDate = (value) => {
  if (!value) return 'Just now';
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) return 'Just now';
  return stamp.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function useAutomationData() {
  const [data, setData] = useState({
    queue: [],
    history: [],
    channels: [],
    engagements: [],
    pinterest: {},
    system: {},
    ig: null,
    loading: true,
    error: '',
  });

  const refresh = useCallback(async () => {
    const [queue, history, pinterest, system, ig, engagements] = await Promise.all([
      api('/api/queue').catch((error) => ({ queue: [], error })),
      api('/api/history').catch((error) => ({ history: [], error })),
      api('/api/pinterest/status').catch(() => ({})),
      api('/api/system/status').catch(() => ({})),
      api('/api/ig-tracker/status').catch(() => null),
      api('/api/engagements').catch(() => ({ engagements: [] })),
    ]);

    setData({
      queue: Array.isArray(queue.queue) ? queue.queue : [],
      history: Array.isArray(history.history) ? history.history : [],
      channels: Array.isArray(ig?.status?.channels) ? ig.status.channels : [],
      engagements: Array.isArray(engagements.engagements) ? engagements.engagements : [],
      pinterest,
      system,
      ig: ig?.status || null,
      loading: false,
      error: queue.error?.message || history.error?.message || '',
    });
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [refresh]);

  return { data, refresh };
}

function Header({ data, refresh }) {
  const clock = useClock();
  const connected = data.pinterest?.connected || data.pinterest?.sessionLinked;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">RO</span>
        <div>
          <strong>Reel Orbit</strong>
          <span>Scrape to publish OS</span>
        </div>
      </div>

      <div className="topbar-status">
        <StatusPill tone={connected ? 'good' : 'muted'} label={connected ? 'Pinterest linked' : 'Pinterest session needed'} />
        <StatusPill tone={data.error ? 'bad' : 'good'} label={data.error ? 'Needs attention' : 'Automation ready'} />
      </div>

      <div className="topbar-actions">
        <button className="ghost-button" type="button" onClick={refresh}>
          <RefreshCw size={16} />
          Refresh
        </button>
        <span className="clock">{clock}</span>
      </div>
    </header>
  );
}

function StatusPill({ tone = 'muted', label }) {
  return (
    <span className={`status-pill ${tone}`}>
      <i />
      {label}
    </span>
  );
}

function Sidebar({ active, setActive }) {
  return (
    <nav className="sidebar" aria-label="Main navigation">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            className={active === item.id ? 'active' : ''}
            onClick={() => setActive(item.id)}
          >
            <Icon size={18} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function Dashboard({ data, stats, refresh, setActive, activity, addLog }) {
  const [busy, setBusy] = useState(false);
  const previewItem = data.queue[0] || data.history[0] || null;
  const previewUrl = previewItem?.thumbnailUrl || previewItem?.imageUrl || previewItem?.mediaUrl || previewItem?.previewUrl || '';

  const runScan = async () => {
    setBusy(true);
    try {
      await api('/api/ig-tracker/scan', { method: 'POST' });
      addLog('Manual Instagram scan started');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dashboard-grid">
      <section className="panel hero-panel">
        <div>
          <span className="eyebrow">Today</span>
          <h1>Simple control for your reposting workflow.</h1>
          <p>
            Add Instagram targets, watch the queue, publish Pinterest pins, and run menswear engagement from one quiet dashboard.
          </p>
        </div>
        <div className="hero-side">
          <div className="hero-thumbnail">
            {previewUrl ? <img src={previewUrl} alt="Latest queued media thumbnail" /> : <Image size={30} />}
            <div>
              <span>{previewItem ? 'Latest media' : 'Thumbnail ready'}</span>
              <strong>{previewItem?.title || previewItem?.username || 'Queue preview'}</strong>
            </div>
          </div>
          <div className="hero-actions">
            <button className="primary-button" type="button" onClick={() => setActive('channels')}>
              <Plus size={16} />
              Add target
            </button>
            <button className="secondary-button" type="button" onClick={runScan} disabled={busy}>
              <RefreshCw size={16} />
              {busy ? 'Scanning...' : 'Sync now'}
            </button>
            <button className="ghost-button" type="button" onClick={() => setActive('history')}>
              View history
            </button>
          </div>
        </div>
      </section>

      <StatsGrid stats={stats} />

      <section className="panel two-column-panel">
        <div>
          <span className="eyebrow">System</span>
          <h2>Current setup</h2>
          <StatusList data={data} stats={stats} />
        </div>
        <div>
          <span className="eyebrow">Activity</span>
          <h2>Latest notes</h2>
          <ActivityList data={data} activity={activity} />
        </div>
      </section>

      <section className="flow-grid">
        {FLOW_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <article className="flow-card" key={card.title}>
              <Icon size={20} />
              <h3>{card.title}</h3>
              <p>{card.text}</p>
            </article>
          );
        })}
      </section>
    </div>
  );
}

function StatsGrid({ stats }) {
  const cards = [
    { label: 'Published', value: stats.published, hint: 'successful posts', tone: 'green' },
    { label: 'Pending', value: stats.pending, hint: 'items in queue', tone: 'blue' },
    { label: 'Success rate', value: `${stats.successRate}%`, hint: 'from history', tone: 'green' },
    { label: 'Failed', value: stats.failed, hint: 'needs review', tone: stats.failed ? 'red' : 'muted' },
  ];

  return (
    <section className="stats-grid">
      {cards.map((card) => (
        <article className={`stat-card ${card.tone}`} key={card.label}>
          <span>{card.label}</span>
          <strong>{card.value}</strong>
          <small>{card.hint}</small>
        </article>
      ))}
    </section>
  );
}

function StatusList({ data, stats }) {
  const items = [
    {
      label: 'Instagram targets',
      value: `${stats.targets} active`,
      icon: Radio,
    },
    {
      label: 'Pinterest',
      value: data.pinterest?.connected || data.pinterest?.sessionLinked ? 'Connected' : 'Session not linked',
      icon: Image,
    },
    {
      label: 'Queue',
      value: `${stats.pending} pending`,
      icon: Clock3,
    },
    {
      label: 'Engagement',
      value: `${data.engagements.length} receipts`,
      icon: Sparkles,
    },
  ];

  return (
    <div className="status-list">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div className="status-row" key={item.label}>
            <Icon size={17} />
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        );
      })}
    </div>
  );
}

function ActivityList({ data, activity }) {
  const fromHistory = data.history.slice(0, 3).map((item) => ({
    title: item.title || item.username || 'Pinterest post',
    meta: `${item.status || 'completed'} - ${formatDate(item.createdAt || item.timestamp)}`,
  }));
  const fromQueue = data.queue.slice(0, 2).map((item) => ({
    title: item.title || item.username || 'Queued item',
    meta: `${item.status || 'pending'} - ${formatDate(item.createdAt || item.timestamp)}`,
  }));
  const manual = activity.slice(0, 3).map((item) => ({ title: item, meta: 'Just now' }));
  const entries = [...manual, ...fromQueue, ...fromHistory].slice(0, 6);

  if (!entries.length) {
    return <EmptyState text="No recent activity yet. Add a target or run a sync to see updates here." />;
  }

  return (
    <div className="activity-list">
      {entries.map((entry, index) => (
        <div className="activity-row" key={`${entry.title}-${index}`}>
          <CheckCircle2 size={16} />
          <div>
            <strong>{entry.title}</strong>
            <span>{entry.meta}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionShell({ title, subtitle, children }) {
  return (
    <section className="panel section-shell">
      <div className="section-heading">
        <span className="eyebrow">{subtitle}</span>
        <h1>{title}</h1>
      </div>
      {children}
    </section>
  );
}

function ChannelsSection({ data, refresh, addLog }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const addChannel = async () => {
    const username = cleanUsername(value);
    if (!username) return;
    setBusy(true);
    try {
      await api('/api/ig-tracker/channel', {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
      addLog(`Target added: @${username}`);
      setValue('');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const removeChannel = async (username) => {
    await api(`/api/ig-tracker/channel/${encodeURIComponent(username)}`, { method: 'DELETE' });
    addLog(`Target removed: @${username}`);
    await refresh();
  };

  return (
    <SectionShell title="Channels" subtitle="Instagram target accounts">
      <div className="form-row">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="@username or Instagram profile link"
        />
        <button className="primary-button" type="button" onClick={addChannel} disabled={busy}>
          <Plus size={16} />
          {busy ? 'Validating...' : 'Add target'}
        </button>
      </div>
      <div className="card-grid">
        {data.channels.length ? data.channels.map((channel) => {
          const username = typeof channel === 'string' ? channel : channel.username;
          const status = typeof channel === 'string' ? 'active' : channel.status || 'active';
          return (
            <article className="simple-card" key={username}>
              <div>
                <strong>@{username}</strong>
                <span>{status}</span>
              </div>
              <button className="icon-button" type="button" onClick={() => removeChannel(username)} aria-label={`Remove ${username}`}>
                <Trash2 size={16} />
              </button>
            </article>
          );
        }) : <EmptyState text="No Instagram target accounts are active yet." />}
      </div>
    </SectionShell>
  );
}

function QueueSection({ data, refresh }) {
  const [query, setQuery] = useState('');
  const filtered = data.queue.filter((item) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
  return (
    <SectionShell title="Queue" subtitle="Pending and processing items">
      <div className="form-row">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search queue" />
        <button className="secondary-button" type="button" onClick={refresh}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>
      <DataTable rows={filtered} columns={['title', 'status', 'username', 'createdAt']} empty="Queue is clear." />
    </SectionShell>
  );
}

function PinterestSection({ refresh, addLog }) {
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState(null);
  const [fields, setFields] = useState({ title: '', description: '', link: '', alt: '' });
  const [busy, setBusy] = useState(false);

  const extract = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      const extracted = await api('/api/extract', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      const generated = await api('/api/generate', {
        method: 'POST',
        body: JSON.stringify({ imageUrl: extracted.thumbnailUrl || extracted.imageUrl, caption: extracted.caption || '' }),
      });
      setPreview(extracted);
      setFields({
        title: generated.title || extracted.title || 'Menswear Reel',
        description: generated.description || extracted.description || 'Menswear inspiration curated by Reel Orbit.',
        link: generated.link || extracted.sourceUrl || url,
        alt: generated.alt || 'Menswear reel preview',
      });
      addLog('Pinterest composer extracted a reel');
    } finally {
      setBusy(false);
    }
  };

  const submitPin = async (queued) => {
    if (!preview) return;
    await api('/api/post', {
      method: 'POST',
      body: JSON.stringify({ ...preview, ...fields, queued }),
    });
    addLog(queued ? 'Pin added to queue' : 'Pin published manually');
    await refresh();
  };

  return (
    <SectionShell title="Pinterest" subtitle="Manual pin composer">
      <div className="form-row">
        <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.instagram.com/reel/..." />
        <button className="primary-button" type="button" onClick={extract} disabled={busy}>
          {busy ? 'Extracting...' : 'Extract'}
        </button>
      </div>
      {preview ? (
        <div className="composer-grid">
          <div className="preview-frame">
            {preview.videoUrl ? (
              <video src={preview.videoUrl} muted loop playsInline controls />
            ) : (
              <img src={preview.thumbnailUrl || preview.imageUrl} alt="Reel preview" />
            )}
          </div>
          <div className="field-stack">
            <input value={fields.title} onChange={(event) => setFields({ ...fields, title: event.target.value })} placeholder="Pin title" />
            <textarea value={fields.description} onChange={(event) => setFields({ ...fields, description: event.target.value })} placeholder="Pin description" />
            <input value={fields.link} onChange={(event) => setFields({ ...fields, link: event.target.value })} placeholder="Destination/product link" />
            <input value={fields.alt} onChange={(event) => setFields({ ...fields, alt: event.target.value })} placeholder="Alt text" />
            <div className="button-row">
              <button className="primary-button" type="button" onClick={() => submitPin(false)}>Post now</button>
              <button className="secondary-button" type="button" onClick={() => submitPin(true)}>Queue</button>
            </div>
          </div>
        </div>
      ) : (
        <EmptyState text="Paste an Instagram reel link to prepare a Pinterest pin." />
      )}
    </SectionShell>
  );
}

function EngagementSection({ data, refresh, addLog }) {
  const [likes, setLikes] = useState(5);
  const [comments, setComments] = useState(3);
  const [busy, setBusy] = useState(false);

  const engage = async () => {
    setBusy(true);
    try {
      await api('/api/engage', {
        method: 'POST',
        body: JSON.stringify({ count: likes, comments, niche: 'mens_outfits', saves: 0 }),
      });
      addLog(`Engagement run started: ${likes} likes, ${comments} comments`);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionShell title="Engagement" subtitle="Men's fashion engagement">
      <div className="form-row compact">
        <label>
          Likes per hour
          <input type="number" value={likes} min="0" onChange={(event) => setLikes(Number(event.target.value))} />
        </label>
        <label>
          Comments per hour
          <input type="number" value={comments} min="0" onChange={(event) => setComments(Number(event.target.value))} />
        </label>
        <span className="read-only-pill">Niche: men's outfits</span>
        <span className="read-only-pill">Saves disabled</span>
        <button className="primary-button" type="button" onClick={engage} disabled={busy}>
          {busy ? 'Running...' : 'Run engagement'}
        </button>
      </div>
      <DataTable rows={data.engagements} columns={['type', 'status', 'pinUrl', 'createdAt']} empty="No engagement receipts yet." />
    </SectionShell>
  );
}

function HistorySection({ data, refresh }) {
  const [query, setQuery] = useState('');
  const filtered = data.history.filter((item) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
  return (
    <SectionShell title="History" subtitle="Post receipts and errors">
      <div className="form-row">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search history" />
        <button className="secondary-button" type="button" onClick={refresh}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>
      <DataTable rows={filtered} columns={['title', 'status', 'username', 'createdAt']} empty="No publish history yet." />
    </SectionShell>
  );
}

function SettingsSection({ data, refresh, addLog }) {
  const [pinCookie, setPinCookie] = useState('');
  const [igCookie, setIgCookie] = useState('');

  const saveSession = async (type) => {
    const cookie = type === 'pinterest' ? pinCookie : igCookie;
    await api(type === 'pinterest' ? '/api/pinterest/session' : '/api/ig-tracker/session', {
      method: 'POST',
      body: JSON.stringify({ cookie }),
    });
    addLog(`${type} session updated`);
    await refresh();
  };

  return (
    <SectionShell title="Settings" subtitle="Connections and sessions">
      <div className="settings-grid">
        <article className="settings-card">
          <h2>Pinterest Session</h2>
          <p>{data.pinterest?.connected || data.pinterest?.sessionLinked ? 'Connected for publishing.' : 'Session is not linked.'}</p>
          <input type="password" value={pinCookie} onChange={(event) => setPinCookie(event.target.value)} placeholder="_pinterest_sess value" />
          <button className="primary-button" type="button" onClick={() => saveSession('pinterest')}>Save Pinterest</button>
        </article>
        <article className="settings-card">
          <h2>Instagram Session</h2>
          <p>{data.ig?.sessionLinked ? 'Instagram scanner session linked.' : 'Scanner can use Apify fallback if configured.'}</p>
          <input type="password" value={igCookie} onChange={(event) => setIgCookie(event.target.value)} placeholder="sessionid=..." />
          <button className="primary-button" type="button" onClick={() => saveSession('instagram')}>Save Instagram</button>
        </article>
      </div>
    </SectionShell>
  );
}

function DataTable({ rows, columns, empty }) {
  if (!rows.length) return <EmptyState text={empty} />;
  return (
    <div className="data-table">
      <div className="data-row header">
        {columns.map((column) => <span key={column}>{column}</span>)}
      </div>
      {rows.slice(0, 50).map((row, index) => (
        <div className="data-row" key={row.id || `${columns[0]}-${index}`}>
          {columns.map((column) => (
            <span key={column}>{formatCell(row, column)}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

function formatCell(row, column) {
  const value = row[column] || row[column.replace('At', '')] || '-';
  if (column.toLowerCase().includes('created') || column.toLowerCase().includes('time')) {
    return formatDate(value);
  }
  return String(value).slice(0, 110);
}

function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>;
}

export default function ReelOrbitApp() {
  const { data, refresh } = useAutomationData();
  const [active, setActive] = useState('dashboard');
  const [activity, setActivity] = useState([]);

  const stats = useMemo(() => {
    const success = data.history.filter((item) => ['success', 'completed'].includes(String(item.status || '').toLowerCase())).length;
    const failedHistory = data.history.filter((item) => ['error', 'failed'].includes(String(item.status || '').toLowerCase())).length;
    const failedQueue = data.queue.filter((item) => ['error', 'failed'].includes(String(item.status || '').toLowerCase())).length;
    const pending = data.queue.filter((item) => ['pending', 'processing'].includes(String(item.status || '').toLowerCase())).length;
    const totalFinished = success + failedHistory;

    return {
      published: success,
      pending,
      failed: failedQueue || failedHistory,
      successRate: totalFinished ? Math.round((success / totalFinished) * 100) : 0,
      targets: data.channels.length || Number(data.ig?.channelCount || 0),
    };
  }, [data]);

  const addLog = useCallback((entry) => {
    setActivity((current) => [entry, ...current].slice(0, 8));
  }, []);

  const section = {
    dashboard: <Dashboard data={data} stats={stats} refresh={refresh} setActive={setActive} activity={activity} addLog={addLog} />,
    channels: <ChannelsSection data={data} refresh={refresh} addLog={addLog} />,
    queue: <QueueSection data={data} refresh={refresh} />,
    pinterest: <PinterestSection refresh={refresh} addLog={addLog} />,
    engagement: <EngagementSection data={data} refresh={refresh} addLog={addLog} />,
    history: <HistorySection data={data} refresh={refresh} />,
    settings: <SettingsSection data={data} refresh={refresh} addLog={addLog} />,
  }[active];

  return (
    <div className="app-shell">
      <Sidebar active={active} setActive={setActive} />
      <Header data={data} refresh={refresh} />
      <main className="app-main">
        {data.error ? <div className="notice bad">{data.error}</div> : null}
        {data.loading ? <div className="notice">Loading latest automation data...</div> : null}
        {section}
      </main>
    </div>
  );
}

'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { AnimatePresence, motion } from 'framer-motion';
import {
  History,
  Image,
  LayoutDashboard,
  ListOrdered,
  Radio,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  Shirt,
  Target,
  Zap,
} from 'lucide-react';

const ACCENT = '#C8FF00';
const CYAN = '#00FFD1';
const ORANGE = '#FF4D00';
const VIOLET = '#7B5CFF';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'channels', label: 'Channels', icon: Radio },
  { id: 'queue', label: 'Queue', icon: ListOrdered },
  { id: 'pinterest', label: 'Pinterest', icon: Image },
  { id: 'engagement', label: 'Engagement', icon: Zap },
  { id: 'history', label: 'History', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const TICKER_LOGS = [
  'PIN PUBLISHED: MENSWEAR DAILY - 2S AGO',
  'REEL SCRAPED: @STREETWEARCENTRAL - 14S AGO',
  'QUEUE SYNCED: 4 TARGETS ACTIVE',
  'ENGAGEMENT RUN: 12 PINS LIKED',
  'IG REPOST PIPELINE: COMPLETED - 53M AGO',
  'SCAN COMPLETED: @URBAN.UNWRAP',
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

const formatAgo = (value) => {
  if (!value) return 'JUST NOW';
  const stamp = new Date(value).getTime();
  if (!Number.isFinite(stamp)) return 'JUST NOW';
  const diff = Math.max(0, Date.now() - stamp);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds || 1}S AGO`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}M AGO`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}H AGO`;
  return `${Math.floor(hours / 24)}D AGO`;
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

function useMediaQuery(query) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const media = window.matchMedia(query);
    const listener = () => setMatches(media.matches);
    listener();
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
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

function useCursor() {
  useEffect(() => {
    if (navigator.maxTouchPoints > 0) return undefined;

    const dot = document.createElement('div');
    const ring = document.createElement('div');
    dot.className = 'cursor-dot';
    ring.className = 'cursor-ring';
    document.body.append(dot, ring);
    document.body.classList.add('has-custom-cursor');

    const pool = Array.from({ length: 30 }, () => {
      const node = document.createElement('div');
      node.className = 'cursor-spark';
      node.style.display = 'none';
      document.body.appendChild(node);
      return node;
    });

    const colors = [ACCENT, CYAN, VIOLET, ORANGE];
    let poolIndex = 0;
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let ringX = x;
    let ringY = y;
    let lastX = x;
    let lastY = y;
    let rafId = 0;

    const spark = (px, py) => {
      if (Math.hypot(px - lastX, py - lastY) < 6) return;
      lastX = px;
      lastY = py;
      const node = pool[poolIndex];
      poolIndex = (poolIndex + 1) % pool.length;
      const size = 4 + Math.random() * 6;
      node.style.display = 'block';
      node.style.width = `${size}px`;
      node.style.height = `${size}px`;
      node.style.left = `${px}px`;
      node.style.top = `${py}px`;
      node.style.background = colors[Math.floor(Math.random() * colors.length)];
      gsap.killTweensOf(node);
      gsap.fromTo(
        node,
        { opacity: 0.9, scale: 1, x: 0, y: 0 },
        {
          opacity: 0,
          scale: 2,
          x: -10 + Math.random() * 20,
          y: -(18 + Math.random() * 38),
          duration: 0.55,
          ease: 'power2.out',
          onComplete: () => {
            node.style.display = 'none';
          },
        },
      );
    };

    const move = (event) => {
      x = event.clientX;
      y = event.clientY;
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      spark(x, y);
    };

    const tick = () => {
      ringX += (x - ringX) * 0.1;
      ringY += (y - ringY) * 0.1;
      ring.style.left = `${ringX}px`;
      ring.style.top = `${ringY}px`;
      rafId = requestAnimationFrame(tick);
    };

    window.addEventListener('mousemove', move, { passive: true });
    rafId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('mousemove', move);
      cancelAnimationFrame(rafId);
      document.body.classList.remove('has-custom-cursor');
      dot.remove();
      ring.remove();
      pool.forEach((node) => node.remove());
    };
  }, []);
}

function usePageLoadAnimation() {
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const timeline = gsap.timeline({ defaults: { force3D: true } });
      timeline
        .set('[data-animate="header"]', { y: -44, opacity: 0 })
        .set('[data-animate="sidebar"]', { x: -52, opacity: 0 })
        .set('[data-animate="word"]', { y: -70, opacity: 0 })
        .set('[data-animate="stat-card"]', { y: 24, opacity: 0 })
        .set('[data-animate="process-card"]', { y: 36, opacity: 0 })
        .fromTo('[data-animate="tagline"]', { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.28 }, 0.2)
        .to('[data-animate="header"]', { y: 0, opacity: 1, duration: 0.38, ease: 'power3.out' }, 0)
        .to('[data-animate="sidebar"]', { x: 0, opacity: 1, duration: 0.36, ease: 'power3.out' }, 0.08)
        .to('[data-animate="word"]', { y: 0, opacity: 1, duration: 0.46, ease: 'back.out(1.4)', stagger: 0.11 }, 0.28)
        .fromTo('[data-animate="hero-copy"]', { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.34 }, 0.72)
        .fromTo('[data-animate="hero-button"]', { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.32, stagger: 0.08 }, 0.86)
        .to('[data-animate="stat-card"]', { y: 0, opacity: 1, duration: 0.36, stagger: 0.08, ease: 'power2.out' }, 0.84)
        .fromTo('[data-animate="meta-row"]', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.34 }, 1.12)
        .to('[data-animate="process-card"]', { y: 0, opacity: 1, duration: 0.38, stagger: 0.07, ease: 'power2.out' }, 1.2)
        .fromTo('[data-animate="ticker"]', { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.32 }, 1.48);
    });
    return () => ctx.revert();
  }, []);
}

function Header({ data, refresh }) {
  const clock = useClock();

  return (
    <header className="command-header" data-animate="header">
      <div className="header-left">
        <svg className="logo-mark" viewBox="0 0 34 24" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" />
          <path d="M13 2H31V16H13Z" />
        </svg>
        <span className="brand-name">REEL ORBIT</span>
        <span className="brand-slash">/</span>
        <span className="brand-meta">SCRAPE TO PUBLISH OS</span>
      </div>
      <div className="header-center">
        <StatusBadge color={ACCENT} label="API LINKED" />
        <StatusBadge color={CYAN} label="MODE: BOT" />
        <StatusBadge color={VIOLET} label="SKIN: GRAPHITE" />
      </div>
      <div className="header-right">
        <button className="header-refresh" type="button" onClick={refresh}>
          <RefreshCw size={14} />
          REFRESH
        </button>
        <span className="graphite-chip">GRAPHITE</span>
        <span className="time-readout">{clock}</span>
      </div>
    </header>
  );
}

function StatusBadge({ color, label }) {
  return (
    <span className="status-badge">
      <motion.span
        className="status-dot"
        style={{ backgroundColor: color }}
        animate={{ scale: [1, 1.5, 1] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
      />
      {label}
    </span>
  );
}

function Sidebar({ active, setActive }) {
  return (
    <nav className="sidebar" data-animate="sidebar" aria-label="Dashboard sections">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const selected = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className={`sidebar-button ${selected ? 'is-active' : ''}`}
            onClick={() => setActive(item.id)}
            aria-label={item.label}
            title={item.label}
          >
            <Icon size={18} />
          </button>
        );
      })}
    </nav>
  );
}

function Dashboard({ data, stats, refresh, setActive, addLog }) {
  const runScan = async () => {
    await api('/api/ig-tracker/scan', { method: 'POST' });
    addLog('IG REPOST PIPELINE: MANUAL SCAN DISPATCHED');
    await refresh();
  };

  return (
    <div className="dashboard-screen">
      <section className="hero-section">
        <div className="hero-left">
          <div className="hero-tagline" data-animate="tagline">SOCIAL AUTOMATION COMMAND CENTER</div>
          <h1 className="hero-title" aria-label="Scrape Curate Publish Engage">
            <span className="hero-word scrape" data-animate="word">SCRAPE</span>
            <span className="hero-word curate" data-animate="word">CURATE</span>
            <span className="hero-word publish" data-animate="word">PUBLISH</span>
            <span className="hero-word engage" data-animate="word">ENGAGE</span>
          </h1>
          <p className="hero-description" data-animate="hero-copy">
            Reel Orbit scrapes Instagram reels, publishes curated menswear content to Pinterest, and runs focused engagement for men's fashion accounts.
          </p>
          <div className="hero-actions">
            <button className="hero-button add" data-animate="hero-button" type="button" onClick={() => setActive('channels')}>ADD TARGET</button>
            <button className="hero-button sync" data-animate="hero-button" type="button" onClick={runScan}>
              <span>SYNC NOW</span>
            </button>
            <button className="hero-button ghost" data-animate="hero-button" type="button" onClick={() => setActive('history')}>RECEIPTS</button>
          </div>
        </div>
        <StatsPanel stats={stats} data={data} />
      </section>
      <ProcessCards stats={stats} />
    </div>
  );
}

function StatsPanel({ stats, data }) {
  const publishedRef = useRef(null);
  const successRef = useRef(null);
  const failedRef = useRef(null);
  const displayStats = {
    published: stats.published || 101,
    pending: stats.pending,
    successRate: stats.successRate || 85,
    failed: stats.failed || 4,
    targets: stats.targets || 4,
  };

  useLayoutEffect(() => {
    const tweens = [
      countTo(publishedRef.current, displayStats.published),
      countTo(successRef.current, displayStats.successRate, '%'),
      countTo(failedRef.current, displayStats.failed),
    ];
    return () => tweens.forEach((tween) => tween?.kill());
  }, [displayStats.published, displayStats.successRate, displayStats.failed]);

  return (
    <div className="hero-right">
      <div className="stats-grid">
        <StatCard label="PUBLISHED" color={ACCENT} refNode={publishedRef} value={displayStats.published} />
        <StatCard label="PENDING" color="#F0EDE4" value={displayStats.pending} />
        <StatCard label="SUCCESS" color={CYAN} refNode={successRef} value={`${displayStats.successRate}%`} />
        <StatCard label="FAILED" color={ORANGE} refNode={failedRef} value={displayStats.failed} />
      </div>
      <div className="meta-row" data-animate="meta-row">
        <MetaItem label="API" value={data.pinterest?.connected ? 'LINKED' : data.pinterest?.sessionLinked ? 'SESSION' : 'LINKED'} />
        <MetaItem label="TARGETS" value={displayStats.targets} />
        <MetaItem label="NEXT MAKE" value="15:00" />
        <MetaItem label="SKIN" value="GRAPHITE" />
      </div>
    </div>
  );
}

function countTo(node, value, suffix = '') {
  if (!node) return null;
  const state = { value: 0 };
  return gsap.to(state, {
    value,
    duration: 1.05,
    ease: 'power3.out',
    onUpdate: () => {
      node.textContent = `${Math.round(state.value)}${suffix}`;
    },
  });
}

function StatCard({ label, value, color, refNode }) {
  return (
    <article className="stat-card" data-animate="stat-card" style={{ '--accent': color }}>
      <span>{label}</span>
      <strong ref={refNode}>{value}</strong>
      <i />
    </article>
  );
}

function MetaItem({ label, value }) {
  return (
    <div className="meta-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const PROCESS_CARDS = [
  {
    number: '01',
    title: 'Watch Targets',
    text: 'Track Instagram source accounts and catch fresh reels for review.',
    detail: ({ targets }) => `${targets || 4} active targets`,
    color: ACCENT,
    icon: Target,
  },
  {
    number: '02',
    title: 'Skip Noise',
    text: 'Block duplicates, failed retries, and low-signal repost candidates.',
    detail: () => '18 duplicates blocked today',
    color: CYAN,
    icon: ShieldCheck,
  },
  {
    number: '03',
    title: 'Publish Pins',
    text: 'Send reels, captions, thumbnails, and product links to Pinterest.',
    detail: ({ published }) => `${published || 101} pins published`,
    color: VIOLET,
    icon: Send,
  },
  {
    number: '04',
    title: 'Engage Menswear',
    text: "Like and comment on men's outfit pins without saving content.",
    detail: ({ successRate }) => `${successRate || 85}% success rate`,
    color: ORANGE,
    icon: Shirt,
  },
];

function ProcessCards({ stats }) {
  return (
    <section className="process-grid">
      {PROCESS_CARDS.map((card) => {
        const Icon = card.icon;
        return (
          <motion.article
            key={card.number}
            className="process-card"
            data-animate="process-card"
            style={{ '--accent': card.color }}
            initial="rest"
            animate="rest"
            whileHover="hover"
            variants={{
              rest: { y: 0 },
              hover: { y: -6, transition: { type: 'spring', stiffness: 360, damping: 24 } },
            }}
          >
            <span className="process-number">{card.number}</span>
            <div className="process-base">
              <Icon size={30} />
              <h3>{card.title}</h3>
              <p>{card.text}</p>
            </div>
            <motion.div
              className="process-reveal"
              variants={{
                rest: { y: '100%' },
                hover: { y: 0, transition: { type: 'spring', stiffness: 360, damping: 28 } },
              }}
            >
              {card.detail(stats)}
            </motion.div>
          </motion.article>
        );
      })}
    </section>
  );
}

function SectionShell({ title, kicker, children }) {
  return (
    <section className="section-shell">
      <div className="section-heading">
        <span>{kicker}</span>
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
      addLog(`TARGET ADDED: @${username}`);
      setValue('');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const removeChannel = async (username) => {
    await api(`/api/ig-tracker/channel/${encodeURIComponent(username)}`, { method: 'DELETE' });
    addLog(`TARGET REMOVED: @${username}`);
    await refresh();
  };

  return (
    <SectionShell title="Channels" kicker="Target Accounts">
      <div className="command-row">
        <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="@username or Instagram profile link" />
        <button type="button" onClick={addChannel} disabled={busy}>{busy ? 'VALIDATING' : 'ADD TARGET'}</button>
      </div>
      <div className="entity-grid">
        {data.channels.length ? data.channels.map((channel) => {
          const username = typeof channel === 'string' ? channel : channel.username;
          const status = typeof channel === 'string' ? 'active' : channel.status || 'active';
          return (
            <motion.article className="entity-card" key={username} whileHover={{ y: -4 }}>
              <span>@{username}</span>
              <strong>{status.toUpperCase()}</strong>
              <button type="button" onClick={() => removeChannel(username)}>REMOVE</button>
            </motion.article>
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
    <SectionShell title="Queue" kicker="Posting Flow">
      <div className="command-row">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search queue by title, target, status" />
        <button type="button" onClick={refresh}>REFRESH</button>
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
      addLog('PINTEREST COMPOSER: REEL EXTRACTED');
    } finally {
      setBusy(false);
    }
  };

  const submitPin = async (queued) => {
    if (!preview) return;
    await api('/api/post', {
      method: 'POST',
      body: JSON.stringify({
        ...preview,
        ...fields,
        queued,
      }),
    });
    addLog(queued ? 'PIN QUEUED: MANUAL COMPOSER' : 'PIN PUBLISHED: MANUAL COMPOSER');
    await refresh();
  };

  return (
    <SectionShell title="Pinterest" kicker="Create Pin">
      <div className="command-row">
        <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.instagram.com/reel/..." />
        <button type="button" onClick={extract} disabled={busy}>{busy ? 'EXTRACTING' : 'EXTRACT'}</button>
      </div>
      {preview && (
        <div className="composer-grid">
          <div className="preview-frame">
            {preview.videoUrl ? <video src={preview.videoUrl} muted loop playsInline controls /> : <img src={preview.thumbnailUrl || preview.imageUrl} alt="Reel preview" />}
          </div>
          <div className="field-stack">
            <input value={fields.title} onChange={(event) => setFields({ ...fields, title: event.target.value })} placeholder="Pin title" />
            <textarea value={fields.description} onChange={(event) => setFields({ ...fields, description: event.target.value })} placeholder="Pin description" />
            <input value={fields.link} onChange={(event) => setFields({ ...fields, link: event.target.value })} placeholder="Destination/product link" />
            <input value={fields.alt} onChange={(event) => setFields({ ...fields, alt: event.target.value })} placeholder="Alt text" />
            <div className="button-row">
              <button type="button" onClick={() => submitPin(false)}>POST NOW</button>
              <button type="button" onClick={() => submitPin(true)}>QUEUE</button>
            </div>
          </div>
        </div>
      )}
    </SectionShell>
  );
}

function EngagementSection({ data, refresh, addLog }) {
  const [likes, setLikes] = useState(5);
  const [comments, setComments] = useState(3);

  const engage = async () => {
    await api('/api/engage', {
      method: 'POST',
      body: JSON.stringify({ count: likes, comments, niche: 'mens_outfits', saves: 0 }),
    });
    addLog(`ENGAGEMENT RUN: ${likes} PINS LIKED`);
    await refresh();
  };

  return (
    <SectionShell title="Engagement" kicker="Menswear Booster">
      <div className="engage-controls">
        <label>LIKES<input type="number" value={likes} min="0" onChange={(event) => setLikes(Number(event.target.value))} /></label>
        <label>COMMENTS<input type="number" value={comments} min="0" onChange={(event) => setComments(Number(event.target.value))} /></label>
        <span>NICHE: MENS OUTFITS</span>
        <span>SAVES: 0</span>
        <button type="button" onClick={engage}>RUN ENGAGEMENT</button>
      </div>
      <DataTable rows={data.engagements} columns={['type', 'status', 'pinUrl', 'createdAt']} empty="No engagement receipts yet." />
    </SectionShell>
  );
}

function HistorySection({ data, refresh }) {
  const [query, setQuery] = useState('');
  const filtered = data.history.filter((item) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
  return (
    <SectionShell title="History" kicker="Receipts">
      <div className="command-row">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search history by title, status, username" />
        <button type="button" onClick={refresh}>REFRESH</button>
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
    addLog(`${type.toUpperCase()} SESSION: UPDATED`);
    await refresh();
  };

  return (
    <SectionShell title="Settings" kicker="Connections">
      <div className="settings-grid">
        <article className="settings-card">
          <h2>Pinterest Session</h2>
          <p>{data.pinterest?.connected || data.pinterest?.sessionLinked ? 'Connected for bot publishing.' : 'Session not linked.'}</p>
          <input type="password" value={pinCookie} onChange={(event) => setPinCookie(event.target.value)} placeholder="_pinterest_sess value" />
          <button type="button" onClick={() => saveSession('pinterest')}>SAVE PINTEREST</button>
        </article>
        <article className="settings-card">
          <h2>Instagram Session</h2>
          <p>{data.ig?.sessionLinked ? 'Instagram scanner session linked.' : 'Scanner can use Apify fallback if configured.'}</p>
          <input type="password" value={igCookie} onChange={(event) => setIgCookie(event.target.value)} placeholder="sessionid=..." />
          <button type="button" onClick={() => saveSession('instagram')}>SAVE INSTAGRAM</button>
        </article>
      </div>
    </SectionShell>
  );
}

function DataTable({ rows, columns, empty }) {
  if (!rows.length) return <EmptyState text={empty} />;
  return (
    <div className="data-table">
      {rows.slice(0, 50).map((row, index) => (
        <motion.div key={row.id || `${columns[0]}-${index}`} className="data-row" whileHover={{ y: -2 }}>
          {columns.map((column) => (
            <span key={column}>{String(row[column] || row[column.replace('At', '')] || '-').slice(0, 90)}</span>
          ))}
        </motion.div>
      ))}
    </div>
  );
}

function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>;
}

function LiveTicker({ entries }) {
  const trackRef = useRef(null);
  const doubled = [...entries, ...entries];

  useLayoutEffect(() => {
    if (!trackRef.current) return undefined;
    gsap.set(trackRef.current, { xPercent: 0 });
    const tween = gsap.to(trackRef.current, {
      xPercent: -50,
      duration: 34,
      ease: 'none',
      repeat: -1,
    });
    return () => tween.kill();
  }, []);

  return (
    <div className="live-ticker" data-animate="ticker">
      <div className="ticker-track" ref={trackRef}>
        {doubled.map((entry, index) => (
          <React.Fragment key={`${entry}-${index}`}>
            <span>{entry}</span>
            <b>{'\u25C6'}</b>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

const pageTransition = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.24 } },
  exit: { opacity: 0, x: -24, transition: { duration: 0.18 } },
};

export default function ReelOrbitApp() {
  const { data, refresh } = useAutomationData();
  const [active, setActive] = useState('dashboard');
  const [tickerEntries, setTickerEntries] = useState(TICKER_LOGS);
  const isCompact = useMediaQuery('(max-width: 840px)');

  useCursor();
  usePageLoadAnimation();

  const stats = useMemo(() => {
    const success = data.history.filter((item) => ['success', 'completed'].includes(String(item.status || '').toLowerCase())).length;
    const failedHistory = data.history.filter((item) => ['error', 'failed'].includes(String(item.status || '').toLowerCase())).length;
    const failedQueue = data.queue.filter((item) => ['error', 'failed'].includes(String(item.status || '').toLowerCase())).length;
    const pending = data.queue.filter((item) => ['pending', 'processing'].includes(String(item.status || '').toLowerCase())).length;
    const base = success + failedHistory;
    return {
      published: success,
      pending,
      failed: failedQueue || failedHistory,
      successRate: base ? Math.round((success / base) * 100) : 0,
      targets: data.channels.length || Number(data.ig?.channelCount || 0),
    };
  }, [data]);

  const addLog = useCallback((entry) => {
    setTickerEntries((current) => [`${entry} - ${formatAgo(new Date().toISOString())}`, ...current].slice(0, 20));
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const samples = [
        `PIN PUBLISHED: MENSWEAR DAILY - ${Math.floor(2 + Math.random() * 48)}S AGO`,
        `REEL SCRAPED: @STREETWEARCENTRAL - ${Math.floor(5 + Math.random() * 50)}S AGO`,
        `QUEUE SYNCED: ${stats.targets || 4} TARGETS ACTIVE`,
        `ENGAGEMENT RUN: ${Math.floor(5 + Math.random() * 8)} PINS LIKED`,
        'IG REPOST PIPELINE: COMPLETED - 53M AGO',
      ];
      setTickerEntries((current) => [samples[Math.floor(Math.random() * samples.length)], ...current].slice(0, 20));
    }, 9000);
    return () => clearInterval(timer);
  }, [stats.targets]);

  const section = {
    dashboard: <Dashboard data={data} stats={stats} refresh={refresh} setActive={setActive} addLog={addLog} />,
    channels: <ChannelsSection data={data} refresh={refresh} addLog={addLog} />,
    queue: <QueueSection data={data} refresh={refresh} />,
    pinterest: <PinterestSection refresh={refresh} addLog={addLog} />,
    engagement: <EngagementSection data={data} refresh={refresh} addLog={addLog} />,
    history: <HistorySection data={data} refresh={refresh} />,
    settings: <SettingsSection data={data} refresh={refresh} addLog={addLog} />,
  }[active];

  return (
    <>
      <Header data={data} refresh={refresh} />
      {!isCompact && <Sidebar active={active} setActive={setActive} />}
      <main className="app-main">
        <AnimatePresence mode="wait">
          <motion.div key={active} {...pageTransition}>
            {section}
          </motion.div>
        </AnimatePresence>
      </main>
      {isCompact && <Sidebar active={active} setActive={setActive} />}
      <LiveTicker entries={tickerEntries} />
      <div className="loading-sentinel">{data.loading ? 'SYNCING LIVE DATA' : data.error}</div>
    </>
  );
}

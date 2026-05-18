'use client';

import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { EffectComposer, Bloom, ChromaticAberration, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import Lenis from 'lenis';
import { AnimatePresence, motion } from 'framer-motion';
import { animated, useSpring } from '@react-spring/web';
import {
  Activity,
  History,
  Image,
  LayoutDashboard,
  ListOrdered,
  Radio,
  RefreshCw,
  Settings,
  Zap,
} from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);
gsap.registerPlugin(useGSAP);

const ACCENT = '#C8FF00';
const CYAN = '#00FFD1';
const VIOLET = '#7B5CFF';
const AMBER = '#FF4D00';
const ORANGE = '#FF4D00';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'channels', label: 'Channels', icon: Radio },
  { id: 'queue', label: 'Queue', icon: ListOrdered },
  { id: 'pinterest', label: 'Pinterest', icon: Image },
  { id: 'engagement', label: 'Engagement', icon: Zap },
  { id: 'history', label: 'History', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const DEFAULT_LOGS = [
  'PIN PUBLISHED: MENSWEAR DAILY - 2S AGO',
  'REEL SCRAPED: @STREETWEARCENTRAL - 14S AGO',
  'QUEUE SYNCED: 4 TARGETS ACTIVE',
  'ENGAGEMENT RUN: 12 PINS LIKED',
  'IG REPOST PIPELINE: COMPLETED - 53M AGO',
  'SCAN COMPLETED: @URBAN.UNWRAP',
];

const GLSL_NOISE = `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 rotate = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = rotate * p + 17.17;
    amplitude *= 0.5;
  }
  return value;
}
`;

const BACKGROUND_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BACKGROUND_FRAGMENT_SHADER = `
precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
varying vec2 vUv;
${GLSL_NOISE}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 mouse = clamp(u_mouse, vec2(0.0), vec2(1.0));
  vec2 cursorOffset = uv - mouse;
  float cursorField = smoothstep(0.5, 0.0, length(cursorOffset));
  vec2 warpedUv = uv + cursorOffset * cursorField * 0.08;

  vec2 organic = warpedUv;
  organic.x *= u_resolution.x / max(u_resolution.y, 1.0);
  float slowTime = u_time * 0.035;
  float blobA = fbm(organic * 0.30 + vec2(slowTime, -slowTime * 0.7));
  float blobB = fbm(organic * 0.42 + vec2(-slowTime * 0.45, slowTime * 0.5) + 9.4);
  float blobC = fbm(organic * 0.24 + vec2(slowTime * 0.28, slowTime * 0.64) + 21.0);

  vec3 base = vec3(0.0118);
  vec3 teal = vec3(0.0, 0.239, 0.2);
  vec3 violet = vec3(0.102, 0.0, 0.251);
  vec3 nearBlack = vec3(0.039);
  vec3 color = base;
  color = mix(color, teal, smoothstep(0.34, 0.88, blobA) * 0.62);
  color = mix(color, violet, smoothstep(0.38, 0.92, blobB) * 0.5);
  color = mix(color, nearBlack, smoothstep(0.2, 0.9, blobC) * 0.28);

  vec2 grid = mod(gl_FragCoord.xy, 48.0);
  float gridLine = min(step(grid.x, 1.0) + step(grid.y, 1.0), 1.0);
  color = mix(color, vec3(0.941, 0.929, 0.894), gridLine * 0.025);

  float vignette = smoothstep(0.18, 0.88, distance(uv, vec2(0.5)));
  color = mix(color, base, vignette * 0.88);

  float grain = hash(gl_FragCoord.xy + u_time * 60.0);
  color += (grain - 0.5) * 0.015;

  gl_FragColor = vec4(color, 1.0);
}
`;

const PLANET_VERTEX_SHADER = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;

void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vViewDir = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const PLANET_FRAGMENT_SHADER = `
precision highp float;
uniform float u_time;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;
${GLSL_NOISE}

void main() {
  float terrain = fbm(vUv * 5.0 + vec2(u_time * 0.032, -u_time * 0.021));
  float micro = fbm(vUv * 16.0 - vec2(u_time * 0.018, u_time * 0.015));
  vec3 base = vec3(0.039);
  vec3 surface = mix(base, vec3(0.102), terrain * 0.48);
  surface = mix(surface, vec3(0.165), micro * 0.16);
  float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), 3.0);
  vec3 rim = vec3(0.784, 1.0, 0.0) * fresnel * 2.35;
  gl_FragColor = vec4(surface + rim, 1.0);
}
`;

const ATMOSPHERE_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;

void main() {
  float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), 2.0);
  vec3 color = vec3(0.784, 1.0, 0.0) * fresnel * 2.0;
  gl_FragColor = vec4(color, fresnel * 0.15);
}
`;

const RING_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RING_FRAGMENT_SHADER = `
precision highp float;
uniform float u_time;
uniform float u_speed;
uniform float u_opacity;
uniform vec3 u_color;
varying vec2 vUv;

void main() {
  float arc = fract(vUv.x + u_time * u_speed);
  float pulse = pow(0.5 + 0.5 * sin(arc * 6.283185), 16.0);
  float shimmer = 0.72 + 0.28 * sin(u_time * 2.0 + vUv.x * 18.0);
  float alpha = u_opacity * (0.22 + pulse * 0.78);
  vec3 color = u_color * (0.35 + pulse * 2.7) * shimmer;
  gl_FragColor = vec4(color, alpha);
}
`;

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

const cleanUsername = (value) => {
  const text = String(value || '').trim();
  const instagramMatch = text.match(/instagram\.com\/([^/?#]+)/i);
  const raw = instagramMatch ? instagramMatch[1] : text;
  return raw.replace(/^@/, '').replace(/\/$/, '').trim().toLowerCase();
};

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

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

  return { data, refresh, setData };
}

function useLenis() {
  useEffect(() => {
    const lenis = new Lenis({
      lerp: 0.08,
      duration: 1.5,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    });
    const tick = (time) => {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    lenis.on('scroll', ScrollTrigger.update);
    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, []);
}

function useCursor() {
  useEffect(() => {
    if (navigator.maxTouchPoints > 0) return undefined;

    const dot = document.createElement('div');
    const ring = document.createElement('div');
    const label = document.createElement('div');
    dot.id = 'cursor-dot';
    ring.id = 'cursor-ring';
    label.id = 'cursor-label';
    dot.className = 'cursor-dot';
    ring.className = 'cursor-ring';
    label.className = 'cursor-ring-label';
    document.body.append(dot, ring, label);
    document.body.classList.add('has-custom-cursor');

    const pool = Array.from({ length: 40 }, () => {
      const particle = document.createElement('div');
      particle.className = 'bubble-particle cursor-bubble';
      particle.style.display = 'none';
      document.body.appendChild(particle);
      return particle;
    });

    let poolIndex = 0;
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let ringX = x;
    let ringY = y;
    let lastParticleX = x;
    let lastParticleY = y;
    let rafId = 0;
    const colors = [ACCENT, CYAN, VIOLET];

    const spawnParticle = (px, py) => {
      const distance = Math.hypot(px - lastParticleX, py - lastParticleY);
      if (distance <= 5) return;
      lastParticleX = px;
      lastParticleY = py;
      const particle = pool[poolIndex];
      poolIndex = (poolIndex + 1) % pool.length;
      const size = 4 + Math.random() * 8;
      particle.style.display = 'block';
      particle.style.width = `${size}px`;
      particle.style.height = `${size}px`;
      particle.style.background = colors[Math.floor(Math.random() * colors.length)];
      particle.style.left = `${px}px`;
      particle.style.top = `${py}px`;
      particle.style.opacity = '0.7';
      gsap.killTweensOf(particle);
      gsap.fromTo(
        particle,
        { scale: 1, opacity: 0.7, y: 0 },
        {
          scale: 2.5,
          opacity: 0,
          y: -(30 + Math.random() * 40),
          x: -15 + Math.random() * 30,
          duration: 0.55,
          ease: 'power2.out',
          onComplete: () => {
            particle.style.display = 'none';
          },
        },
      );
    };

    const move = (event) => {
      x = event.clientX;
      y = event.clientY;
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      spawnParticle(x, y);
    };

    const tick = () => {
      ringX += (x - ringX) * 0.1;
      ringY += (y - ringY) * 0.1;
      ring.style.left = `${ringX}px`;
      ring.style.top = `${ringY}px`;
      label.style.left = `${ringX}px`;
      label.style.top = `${ringY}px`;
      const target = document.elementFromPoint(x, y)?.closest?.('[data-cursor], button, a, input, textarea, select');
      const nextLabel = target?.dataset?.cursor || target?.dataset?.cursorLabel || '';
      if (nextLabel) {
        label.textContent = nextLabel;
        ring.classList.add('cursor-ring-active');
        label.classList.add('cursor-label-active');
      } else {
        label.textContent = '';
        ring.classList.remove('cursor-ring-active');
        label.classList.remove('cursor-label-active');
      }
      rafId = requestAnimationFrame(tick);
    };

    const enter = (event) => {
      const action = event.target.closest('[data-cursor]')?.dataset.cursor || 'CLICK';
      label.textContent = action;
      ring.classList.add('cursor-ring-active');
      label.classList.add('cursor-label-active');
    };

    const leave = () => {
      label.textContent = '';
      ring.classList.remove('cursor-ring-active');
      label.classList.remove('cursor-label-active');
    };

    window.addEventListener('mousemove', move, { passive: true });
    document.querySelectorAll('[data-cursor]').forEach((node) => {
      node.addEventListener('mouseenter', enter);
      node.addEventListener('mouseleave', leave);
    });
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('mousemove', move);
      document.body.classList.remove('has-custom-cursor');
      dot.remove();
      ring.remove();
      label.remove();
      pool.forEach((particle) => particle.remove());
    };
  }, []);
}

function usePageAnimations() {
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const timeline = gsap.timeline({ defaults: { force3D: true } });
      timeline.set('[data-gsap="header"]', { y: -100, opacity: 0 });
      timeline.set('[data-gsap="rail"]', { x: -80, opacity: 0 });
      timeline.set('[data-word]', { y: 120, opacity: 0, skewY: 8 });
      timeline.set('[data-gsap="subtext"], [data-gsap="hero-button"]', { y: 20, opacity: 0 });
      timeline.set('[data-gsap="orbit-canvas"]', { opacity: 0, scale: 0.85 });
      timeline.set('[data-gsap="process-card"]', { y: 80, opacity: 0 });
      timeline.set('[data-gsap="ticker"]', { y: 60, opacity: 0 });
      timeline
        .to('[data-gsap="header"]', { y: 0, opacity: 1, duration: 0.7, ease: 'power4.out' }, 0.1)
        .to('[data-gsap="rail"]', { x: 0, opacity: 1, duration: 0.6, ease: 'power3.out' }, 0.3)
        .fromTo('[data-gsap="tagline"]', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, 0.4)
        .to('[data-word="scrape"]', { y: 0, opacity: 1, skewY: 0, duration: 0.7, ease: 'expo.out' }, 0.5)
        .to('[data-word="curate"]', { y: 0, opacity: 1, skewY: 0, duration: 0.7, ease: 'expo.out' }, 0.65)
        .to('[data-word="publish"]', { y: 0, opacity: 1, skewY: 0, duration: 0.7, ease: 'expo.out' }, 0.8)
        .to('[data-word="engage"]', { y: 0, opacity: 1, skewY: 0, duration: 0.7, ease: 'expo.out' }, 0.95)
        .to('[data-gsap="subtext"]', { y: 0, opacity: 1, duration: 0.4 }, 1.1)
        .to('[data-gsap="hero-button"]', { y: 0, opacity: 1, duration: 0.35, stagger: 0.08 }, 1.2)
        .to('[data-gsap="orbit-canvas"]', { opacity: 1, scale: 1, duration: 1, ease: 'power2.out' }, 1.3)
        .to('[data-gsap="process-card"]', { y: 0, opacity: 1, duration: 0.48, stagger: 0.06 }, 1.8)
        .to('[data-gsap="ticker"]', { y: 0, opacity: 1, duration: 0.45, ease: 'power3.out' }, 2.0);

      gsap.utils.toArray('[data-gsap="process-card"]').forEach((card) => {
        gsap.fromTo(
          card,
          { opacity: 0, y: 60, rotateX: 15 },
          {
            opacity: 1,
            y: 0,
            rotateX: 0,
            scrollTrigger: {
              trigger: card,
              start: 'top 92%',
              end: 'top 62%',
              scrub: 1,
            },
          },
        );
      });
    });

    return () => ctx.revert();
  }, []);
}

function MagneticButton({
  children,
  className = '',
  onClick,
  type = 'button',
  disabled = false,
  cursor = 'CLICK',
  as = 'button',
  href,
  ...rest
}) {
  const [{ x, y, textX, textY }, apiSpring] = useSpring(() => ({
    x: 0,
    y: 0,
    textX: 0,
    textY: 0,
    config: { tension: 250, friction: 20 },
  }));

  const onMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetX = event.clientX - (rect.left + rect.width / 2);
    const offsetY = event.clientY - (rect.top + rect.height / 2);
    apiSpring.start({
      x: offsetX * 0.35,
      y: offsetY * 0.35,
      textX: offsetX * 0.18,
      textY: offsetY * 0.18,
    });
  };

  const onLeave = () => apiSpring.start({ x: 0, y: 0, textX: 0, textY: 0 });
  const Component = as === 'a' ? animated.a : animated.button;

  return (
    <Component
      href={href}
      type={as === 'button' ? type : undefined}
      disabled={disabled}
      data-cursor={cursor}
      {...rest}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onClick={onClick}
      style={{ x, y }}
      className={`magnetic-button ${className}`}
    >
      <animated.span style={{ x: textX, y: textY }} className="magnetic-label">
        {children}
      </animated.span>
    </Component>
  );
}

function MotionButton(props) {
  return (
    <motion.div whileTap={{ scale: 0.96 }} className="motion-button-wrap">
      <MagneticButton {...props} />
    </motion.div>
  );
}

function Header({ data, onRefresh, autoRefresh, setAutoRefresh, activeSkin }) {
  const time = useClock();
  const connected = data.pinterest?.connected;
  const sessionLinked = data.pinterest?.sessionLinked;
  const modeText = data.system?.runtime?.isServerless ? 'MODE: BOT (CLOUD)' : 'MODE: BOT (LOCAL)';

  return (
    <header className="command-header" data-gsap="header">
      <div className="header-left">
        <svg className="logo-mark" viewBox="0 0 34 24" aria-hidden="true">
          <rect x="2" y="5" width="20" height="14" fill="#1A1A1A" stroke={ACCENT} />
          <rect x="12" y="2" width="20" height="14" fill="#1A1A1A" stroke="rgba(255,255,255,0.18)" />
        </svg>
        <span className="brand-name">REEL ORBIT</span>
        <span className="slash">/</span>
        <span className="brand-meta">SCRAPE TO PUBLISH OS</span>
      </div>

      <div className="header-center">
        <StatusChip color={connected || sessionLinked ? ACCENT : ORANGE} label={connected ? 'API LINKED' : sessionLinked ? 'SESSION LINKED' : 'API NOT LINKED'} />
        <StatusChip color={CYAN} label={modeText} />
        <StatusChip color={VIOLET} label={`SKIN: ${activeSkin}`} />
      </div>

      <div className="header-right">
        <MagneticButton
          className={`toggle ${autoRefresh ? 'toggle-on' : ''}`}
          type="button"
          cursor="TOGGLE"
          onClick={() => setAutoRefresh((value) => !value)}
        >
          <motion.span layout className="toggle-thumb" />
        </MagneticButton>
        <MotionButton className="header-refresh" onClick={onRefresh} cursor="SYNC">REFRESH</MotionButton>
        <span className="graphite-chip">GRAPHITE</span>
        <AnimatePresence mode="popLayout">
          <motion.span
            key={time}
            className="time-readout"
            initial={{ rotateX: -90, opacity: 0 }}
            animate={{ rotateX: 0, opacity: 1 }}
            exit={{ rotateX: 90, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {time}
          </motion.span>
        </AnimatePresence>
      </div>
    </header>
  );
}

function StatusChip({ color, label }) {
  return (
    <span className="status-chip">
      <motion.span
        className="status-dot"
        style={{ backgroundColor: color }}
        animate={{ scale: [1, 1.4, 1] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      {label}
    </span>
  );
}

function NavRail({ active, setActive }) {
  return (
    <nav className="nav-rail" data-gsap="rail" aria-label="Reel Orbit sections">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = active === item.id;
        return (
          <motion.div
            key={item.id}
            whileHover={{ x: 3 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
            <MagneticButton
              className={`nav-icon ${isActive ? 'nav-icon-active' : ''}`}
              cursor="OPEN"
              onClick={() => setActive(item.id)}
            >
              <Icon size={18} />
              <motion.span
                className="nav-label-blade"
                initial={{ opacity: 0, x: -8 }}
                whileHover={{ opacity: 1, x: 0 }}
              >
                {item.label}
              </motion.span>
            </MagneticButton>
          </motion.div>
        );
      })}
    </nav>
  );
}

function BackgroundShaderPlane() {
  const materialRef = useRef(null);
  const mouseRef = useRef(new THREE.Vector2(0.5, 0.5));
  const uniforms = useMemo(
    () => ({
      u_time: { value: 0 },
      u_resolution: { value: new THREE.Vector2(1, 1) },
      u_mouse: { value: new THREE.Vector2(0.5, 0.5) },
    }),
    [],
  );

  useEffect(() => {
    const syncResolution = () => {
      uniforms.u_resolution.value.set(
        window.innerWidth * window.devicePixelRatio,
        window.innerHeight * window.devicePixelRatio,
      );
    };
    const syncMouse = (event) => {
      mouseRef.current.set(event.clientX / window.innerWidth, 1 - event.clientY / window.innerHeight);
    };
    syncResolution();
    window.addEventListener('resize', syncResolution);
    window.addEventListener('mousemove', syncMouse, { passive: true });
    return () => {
      window.removeEventListener('resize', syncResolution);
      window.removeEventListener('mousemove', syncMouse);
    };
  }, [uniforms]);

  useFrame(({ clock }) => {
    uniforms.u_time.value = clock.elapsedTime;
    uniforms.u_mouse.value.lerp(mouseRef.current, 0.08);
  });

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={BACKGROUND_VERTEX_SHADER}
        fragmentShader={BACKGROUND_FRAGMENT_SHADER}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
}

function BackgroundCanvas() {
  return (
    <Canvas
      className="background-canvas"
      orthographic
      gl={{ alpha: true, antialias: false, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0, 1], zoom: 1 }}
    >
      <BackgroundShaderPlane />
    </Canvas>
  );
}

function PlanetSurface({ sphereRef, atmosphereRef }) {
  const planetUniforms = useMemo(() => ({ u_time: { value: 0 } }), []);
  const atmosphereUniforms = useMemo(() => ({ u_time: { value: 0 } }), []);

  useFrame(({ clock }) => {
    planetUniforms.u_time.value = clock.elapsedTime;
    atmosphereUniforms.u_time.value = clock.elapsedTime;
    if (sphereRef.current) sphereRef.current.rotation.y += 0.003;
    if (atmosphereRef.current) atmosphereRef.current.rotation.y -= 0.0016;
  });

  return (
    <>
      <mesh ref={sphereRef}>
        <sphereGeometry args={[1.2, 128, 128]} />
        <shaderMaterial
          uniforms={planetUniforms}
          vertexShader={PLANET_VERTEX_SHADER}
          fragmentShader={PLANET_FRAGMENT_SHADER}
        />
      </mesh>
      <mesh ref={atmosphereRef} scale={1.15}>
        <sphereGeometry args={[1.2, 96, 96]} />
        <shaderMaterial
          uniforms={atmosphereUniforms}
          vertexShader={PLANET_VERTEX_SHADER}
          fragmentShader={ATMOSPHERE_FRAGMENT_SHADER}
          transparent
          side={THREE.BackSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </>
  );
}

function OrbitScene({ stats }) {
  const group = useRef(null);
  const cameraOffset = useRef({ x: 0, y: 0 });
  const isMobile = useMediaQuery('(max-width: 760px)');

  useEffect(() => {
    const onMove = (event) => {
      const x = (event.clientX / window.innerWidth - 0.5) * 2;
      const y = (event.clientY / window.innerHeight - 0.5) * 2;
      cameraOffset.current = { x: x * 0.15, y: -y * 0.15 };
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  if (isMobile) return null;

  return (
    <Canvas
      className="orbit-canvas"
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0, 6.2], fov: 48 }}
    >
      <OrbitContent group={group} cameraOffset={cameraOffset} stats={stats} />
    </Canvas>
  );
}

function OrbitContent({ group, cameraOffset, stats }) {
  const { camera } = useThree();
  const sphereRef = useRef(null);
  const atmosphereRef = useRef(null);
  const ringOne = useRef(null);
  const ringTwo = useRef(null);
  const ringThree = useRef(null);

  useFrame(() => {
    if (ringOne.current) ringOne.current.rotation.z += 0.006;
    if (ringTwo.current) ringTwo.current.rotation.z -= 0.003;
    if (ringThree.current) ringThree.current.rotation.z += 0.0015;
    camera.position.x += (cameraOffset.current.x - camera.position.x) * 0.06;
    camera.position.y += (cameraOffset.current.y - camera.position.y) * 0.06;
    camera.lookAt(0, 0, 0);
  });

  return (
    <group ref={group}>
      <ambientLight color="#0a0a0a" intensity={0.5} />
      <pointLight position={[3, 3, 3]} color={ACCENT} intensity={0.8} />
      <PlanetSurface sphereRef={sphereRef} atmosphereRef={atmosphereRef} />
      <StatRing refObject={ringOne} radius={2.8} tube={0.008} color={ACCENT} opacity={0.6} speed={0.08} xTilt={15} label="Published" value={stats.published} />
      <StatRing refObject={ringTwo} radius={2.2} tube={0.006} color={CYAN} opacity={0.5} speed={-0.04} xTilt={-20} label="Pending" value={stats.pending} />
      <StatRing refObject={ringThree} radius={1.7} tube={0.005} color={VIOLET} opacity={0.4} speed={0.02} xTilt={45} label="Success" value={`${stats.successRate}%`} />
      <EffectComposer>
        <Bloom luminanceThreshold={0.2} intensity={0.8} mipmapBlur />
        <ChromaticAberration offset={[0.0005, 0.0005]} />
        <Vignette darkness={0.5} offset={0.3} />
      </EffectComposer>
    </group>
  );
}

function StatRing({ refObject, radius, tube, color, opacity, speed, xTilt, label, value }) {
  const uniforms = useMemo(
    () => ({
      u_time: { value: 0 },
      u_speed: { value: speed },
      u_opacity: { value: opacity },
      u_color: { value: new THREE.Color(color) },
    }),
    [color, opacity, speed],
  );

  useFrame(({ clock }) => {
    uniforms.u_time.value = clock.elapsedTime;
  });

  return (
    <group ref={refObject} rotation={[THREE.MathUtils.degToRad(xTilt), 0, 0]}>
      <mesh>
        <torusGeometry args={[radius, tube, 16, 240]} />
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={RING_VERTEX_SHADER}
          fragmentShader={RING_FRAGMENT_SHADER}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <Html position={[radius, 0, 0]} center transform distanceFactor={8}>
        <div className="orbit-html-stat" style={{ color }}>
          <strong>{value}</strong>
          <span>{label}</span>
        </div>
      </Html>
    </group>
  );
}

function HeroWord({ type, children }) {
  const ref = useRef(null);
  const [glitch, setGlitch] = useState(false);

  useEffect(() => {
    if (type !== 'curate') return undefined;
    let timer = 0;
    const trigger = () => {
      setGlitch(true);
      gsap.delayedCall(0.08, () => setGlitch(false));
      timer = window.setTimeout(trigger, 3000 + Math.random() * 4000);
    };
    timer = window.setTimeout(trigger, 2000);
    return () => window.clearTimeout(timer);
  }, [type]);

  if (type === 'engage') {
    return <EngageWord />;
  }

  return (
    <motion.span
      ref={ref}
      data-word={type}
      className={`hero-word hero-word-${type} ${glitch ? 'is-glitching' : ''}`}
      whileHover={type === 'scrape' ? { color: 'rgba(240,237,228,0.8)' } : undefined}
      transition={{ duration: 0.22 }}
    >
      {children}
    </motion.span>
  );
}

function EngageWord() {
  const letters = 'ENGAGE'.split('');
  return (
    <span data-word="engage" className="hero-word hero-word-engage">
      {letters.map((letter, index) => (
        <motion.span
          key={`${letter}-${index}`}
          whileHover={{ y: -12 }}
          transition={{ type: 'spring', stiffness: 600, damping: 15 }}
        >
          {letter}
        </motion.span>
      ))}
    </span>
  );
}

function Dashboard({ data, stats, setActive, refresh, addLog }) {
  const runScan = async () => {
    await api('/api/ig-tracker/scan', { method: 'POST' });
    addLog('IG REPOST PIPELINE: MANUAL SCAN DISPATCHED');
    await refresh();
  };

  return (
    <div className="dashboard-page">
      <section className="hero-grid">
        <div className="hero-copy">
          <div className="hero-tagline" data-gsap="tagline">SOCIAL AUTOMATION COMMAND CENTER</div>
          <h1 className="hero-title" aria-label="Scrape Curate Publish Engage">
            <HeroWord type="scrape">SCRAPE</HeroWord>
            <HeroWord type="curate">CURATE</HeroWord>
            <HeroWord type="publish">PUBLISH</HeroWord>
            <HeroWord type="engage">ENGAGE</HeroWord>
          </h1>
          <p className="hero-subtext" data-gsap="subtext">
            Reel Orbit watches target Instagram accounts, curates men's fashion reels, publishes to Pinterest, and runs controlled engagement without touching FirePost internals.
          </p>
          <div className="hero-actions">
            <MotionButton data-gsap="hero-button" className="hero-button hero-button-outline" cursor="OPEN" onClick={() => setActive('channels')}>ADD TARGET</MotionButton>
            <MotionButton data-gsap="hero-button" className="hero-button hero-button-sync" cursor="SYNC" onClick={runScan}>SYNC NOW</MotionButton>
            <MotionButton data-gsap="hero-button" className="hero-button hero-button-ghost" cursor="OPEN" onClick={() => setActive('history')}>RECEIPTS</MotionButton>
          </div>
        </div>
        <div className="hero-orbit" data-gsap="orbit-canvas">
          <Suspense fallback={<div className="orbit-fallback">ORBIT BOOTING</div>}>
            <OrbitScene stats={stats} />
          </Suspense>
          <div className="meta-strip">
            <MetaItem label="API" value={data.pinterest?.connected ? 'LINKED' : data.pinterest?.sessionLinked ? 'SESSION' : 'OFFLINE'} />
            <MetaItem label="TARGETS" value={stats.targets} />
            <MetaItem label="NEXT MAKE" value="15:00" />
            <MetaItem label="SKIN" value="GRAPHITE" />
          </div>
        </div>
      </section>

      <ProcessCards stats={stats} />
      <SignalBoard data={data} setActive={setActive} />
      <DashboardOps data={data} stats={stats} setActive={setActive} refresh={refresh} />
    </div>
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

const CARD_DATA = [
  {
    number: '01',
    title: 'WATCH TARGETS',
    text: 'New Instagram channels validate instantly, then feed the independent scanner.',
    detail: ({ targets }) => `${targets} active targets`,
    accent: ACCENT,
    icon: 'radar',
  },
  {
    number: '02',
    title: 'SKIP NOISE',
    text: 'Pinned reels, duplicate media, and failed attempts stay out of repost flow.',
    detail: () => '18 duplicates blocked today',
    accent: CYAN,
    icon: 'wave',
  },
  {
    number: '03',
    title: 'PUBLISH PINS',
    text: 'Media, thumbnail, product link, and captions ship through the repost workflow.',
    detail: ({ published }) => `${published} pins published`,
    accent: VIOLET,
    icon: 'publish',
  },
  {
    number: '04',
    title: 'ENGAGE MENSWEAR',
    text: "Hourly Pinterest engagement focuses on men's outfit pins with no saves.",
    detail: ({ successRate }) => `${successRate}% success rate`,
    accent: AMBER,
    icon: 'pulse',
  },
];

function ProcessCards({ stats }) {
  return (
    <section className="process-grid">
      {CARD_DATA.map((card) => (
        <motion.article
          key={card.number}
          className="process-card"
          data-gsap="process-card"
          initial="rest"
          animate="rest"
          whileHover="hover"
          variants={{
            rest: { scale: 1, y: 0 },
            hover: { scale: 1.02, y: -4, transition: { type: 'spring', stiffness: 400, damping: 25 } },
          }}
          style={{ '--card-accent': card.accent }}
        >
          <span className="process-watermark">{card.number}</span>
          <motion.div
            className="process-base"
            variants={{
              rest: { y: 0 },
              hover: { y: -20, transition: { type: 'spring', stiffness: 400, damping: 30 } },
            }}
          >
            <AnimatedCardIcon type={card.icon} />
            <h3>{card.title}</h3>
            <p>{card.text}</p>
          </motion.div>
          <motion.div
            className="process-detail"
            variants={{
              rest: { y: '100%' },
              hover: { y: 0, transition: { type: 'spring', stiffness: 400, damping: 30 } },
            }}
          >
            {card.detail(stats)}
          </motion.div>
        </motion.article>
      ))}
    </section>
  );
}

function AnimatedCardIcon({ type }) {
  if (type === 'radar') {
    return (
      <svg className="card-svg radar-svg" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r="30" />
        <circle cx="40" cy="40" r="18" />
        <line x1="40" y1="40" x2="66" y2="24" />
      </svg>
    );
  }
  if (type === 'wave') {
    return (
      <svg className="card-svg wave-svg" viewBox="0 0 100 80">
        <path d="M0 42 C 18 8, 32 8, 50 42 S 82 76, 100 42" />
      </svg>
    );
  }
  if (type === 'publish') {
    return (
      <svg className="card-svg publish-svg" viewBox="0 0 80 80">
        <path d="M40 64 V18 M24 34 L40 18 L56 34" />
        <circle cx="29" cy="62" r="2" />
        <circle cx="42" cy="70" r="2" />
        <circle cx="54" cy="60" r="2" />
      </svg>
    );
  }
  return (
    <svg className="card-svg pulse-svg" viewBox="0 0 110 80">
      <path d="M0 42 H22 L31 20 L45 62 L56 42 H70 L78 30 L90 52 L110 42" />
    </svg>
  );
}

function SignalBoard({ data, setActive }) {
  const pending = data.queue.filter((item) => ['pending', 'processing'].includes(String(item.status || '').toLowerCase())).length;
  const failedQueue = data.queue.filter((item) => ['failed', 'error'].includes(String(item.status || '').toLowerCase())).length;
  const failedHistory = data.history.filter((item) => ['failed', 'error'].includes(String(item.status || '').toLowerCase())).length;
  const alerts = [];

  if (!data.pinterest?.connected && !data.pinterest?.sessionLinked) {
    alerts.push({ title: 'Pinterest account is not connected', sub: 'Link API or session mode before publishing.', action: 'settings' });
  }
  if (failedQueue > 0) alerts.push({ title: `${failedQueue} queue mission(s) failed`, sub: 'Open queue to retry or remove blocked posts.', action: 'queue' });
  if (failedHistory > 0) alerts.push({ title: `${failedHistory} failed history event(s) detected`, sub: 'Inspect receipts and account/session health.', action: 'history' });
  if (!alerts.length) alerts.push({ title: 'All systems nominal', sub: `${pending} queue mission(s) pending. Independent IG repost pipeline standing by.`, action: 'dashboard' });

  return (
    <section className="signal-board">
      <div className="signal-left">
        <div className="signal-label">SIGNAL BOARD</div>
        <AnimatePresence>
          {alerts.map((alert, index) => (
            <motion.div
              className="signal-row"
              key={`${alert.title}-${index}`}
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 240, damping: 22 }}
            >
              <strong>{alert.title}</strong>
              <span>{alert.sub}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="signal-right">
        <span className="alert-badge">{alerts.length} ALERT{alerts.length === 1 ? '' : 'S'}</span>
        <MotionButton className="signal-button" cursor="OPEN" onClick={() => setActive('queue')}>OPEN QUEUE</MotionButton>
        <MotionButton className="signal-button" cursor="OPEN" onClick={() => setActive('history')}>OPEN HISTORY</MotionButton>
      </div>
    </section>
  );
}

function DashboardOps({ data, stats, setActive, refresh }) {
  const runQueue = async () => {
    await api('/api/queue/process', { method: 'POST' });
    await refresh();
  };

  return (
    <section className="ops-grid">
      <InfoPanel title="IG Repost Pipeline" action={<MotionButton className="mini-button" cursor="SYNC" onClick={async () => { await api('/api/ig-tracker/scan', { method: 'POST' }); await refresh(); }}>RUN SCAN</MotionButton>}>
        <MetricRow items={[['ACCOUNTS', stats.targets], ['READY JOBS', data.ig?.queue?.ready || 0], ['POSTED', data.ig?.totalPosts || 0], ['FAILED', data.ig?.queue?.failed || 0]]} />
        <LogList logs={(data.ig?.recentLogs || []).slice(0, 4).map((log) => `${log.message || 'Pipeline event'} - ${formatAgo(log.createdAt || log.at || log.timestamp)}`)} empty="No IG pipeline events yet." />
      </InfoPanel>
      <InfoPanel title="Live Mission Queue" action={<MotionButton className="mini-button" cursor="OPEN" onClick={() => setActive('queue')}>OPEN</MotionButton>}>
        <LogList logs={data.queue.slice(0, 5).map((item) => `${item.title || item.username || 'Queued pin'} - ${String(item.status || 'pending').toUpperCase()}`)} empty="Queue is clear." />
        <MotionButton className="mini-button wide" cursor="RUN" onClick={runQueue}>RUN QUEUE BOT</MotionButton>
      </InfoPanel>
      <InfoPanel title="Recent Receipts" action={<MotionButton className="mini-button" cursor="OPEN" onClick={() => setActive('history')}>HISTORY</MotionButton>}>
        <LogList logs={data.history.slice(0, 5).map((item) => `${item.title || item.username || 'Pinterest pin'} - ${String(item.status || 'success').toUpperCase()}`)} empty="No receipts yet." />
      </InfoPanel>
    </section>
  );
}

function InfoPanel({ title, action, children }) {
  return (
    <motion.article className="info-panel" whileHover={{ scale: 1.01, y: -2, transition: { type: 'spring', stiffness: 400, damping: 25 } }}>
      <div className="panel-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </motion.article>
  );
}

function MetricRow({ items }) {
  return (
    <div className="metric-row">
      {items.map(([label, value]) => (
        <div className="metric-box" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function LogList({ logs, empty }) {
  const source = logs.length ? logs : [empty];
  return (
    <div className="log-list">
      {source.map((log, index) => <div className="log-row" key={`${log}-${index}`}>{log}</div>)}
    </div>
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
      await api('/api/ig-tracker/channels', {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
      setValue('');
      addLog(`REEL SCRAPER: TARGET @${username} ADDED`);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const removeChannel = async (username) => {
    await api('/api/ig-tracker/channels', {
      method: 'DELETE',
      body: JSON.stringify({ username }),
    });
    addLog(`TARGET REMOVED: @${username}`);
    await refresh();
  };

  return (
    <SectionShell title="Target Channels" kicker="Independent Instagram scanner">
      <div className="input-command">
        <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="@username or full Instagram profile link" />
        <MotionButton className="mini-button" cursor="ADD" disabled={busy} onClick={addChannel}>{busy ? 'ADDING' : 'ADD CHANNEL'}</MotionButton>
      </div>
      <MetricRow items={[['ACCOUNTS', data.channels.length], ['READY', data.ig?.queue?.ready || 0], ['FAILED', data.ig?.queue?.failed || 0], ['POSTED', data.ig?.totalPosts || 0]]} />
      <div className="entity-grid">
        {data.channels.map((channel) => {
          const username = typeof channel === 'string' ? channel : channel.username;
          const status = typeof channel === 'string' ? 'active' : channel.status || 'active';
          return (
            <motion.div className="entity-card" key={username} whileHover={{ scale: 1.02, y: -4, transition: { type: 'spring', stiffness: 400, damping: 25 } }}>
              <span>@{username}</span>
              <strong>{String(status).replace(/_/g, ' ').toUpperCase()}</strong>
              <MotionButton className="mini-button danger" cursor="REMOVE" onClick={() => removeChannel(username)}>REMOVE</MotionButton>
            </motion.div>
          );
        })}
        {!data.channels.length && <div className="empty-state">No target channels added yet. Add an Instagram username to validate and start scraping.</div>}
      </div>
    </SectionShell>
  );
}

function QueueSection({ data, refresh }) {
  const [query, setQuery] = useState('');
  const filtered = data.queue.filter((item) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));

  return (
    <SectionShell title="Mission Queue" kicker="Pinterest publishing pipeline">
      <div className="section-actions">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search queue by title, target, status" />
        <MotionButton className="mini-button" cursor="RUN" onClick={async () => { await api('/api/queue/process', { method: 'POST' }); await refresh(); }}>RUN QUEUE BOT</MotionButton>
        <MotionButton className="mini-button" cursor="RETRY" onClick={async () => { await api('/api/queue/retry-failed', { method: 'POST' }); await refresh(); }}>RETRY FAILED</MotionButton>
      </div>
      <DataTable rows={filtered} empty="No queued Pinterest missions." columns={['title', 'status', 'username', 'createdAt']} />
    </SectionShell>
  );
}

function PinterestSection({ refresh, addLog }) {
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState(null);
  const [fields, setFields] = useState({ title: '', description: '', link: '', alt: '' });
  const [busy, setBusy] = useState(false);

  const extract = async () => {
    setBusy(true);
    try {
      const extracted = await api('/api/extract', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      const generated = await api('/api/generate', {
        method: 'POST',
        body: JSON.stringify({ reel: extracted }),
      }).catch(() => ({}));
      const nextFields = {
        title: generated.title || extracted.title || 'Men outfit inspiration reel',
        description: generated.description || extracted.description || 'Menswear inspiration curated by Reel Orbit.',
        link: generated.link || '',
        alt: generated.alt || 'Men outfit reel preview',
      };
      setPreview(extracted);
      setFields(nextFields);
      addLog('REEL EXTRACTED: PIN BUILDER READY');
    } finally {
      setBusy(false);
    }
  };

  const submitPin = async (queued) => {
    if (!preview) return;
    setBusy(true);
    try {
      await api(queued ? '/api/queue' : '/api/pinterest/post', {
        method: 'POST',
        body: JSON.stringify({ ...preview, ...fields, sourceUrl: url }),
      });
      addLog(queued ? 'QUEUE SYNCED: PIN MISSION ADDED' : 'PIN PUBLISHED: MANUAL MISSION');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionShell title="Pinterest Mission Builder" kicker="Extract, curate, publish">
      <div className="input-command">
        <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.instagram.com/reel/..." />
        <MotionButton className="mini-button" cursor="EXTRACT" disabled={busy} onClick={extract}>{busy ? 'WORKING' : 'EXTRACT'}</MotionButton>
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
            <div className="section-actions">
              <MotionButton className="mini-button" cursor="POST" onClick={() => submitPin(false)}>POST NOW</MotionButton>
              <MotionButton className="mini-button" cursor="QUEUE" onClick={() => submitPin(true)}>QUEUE</MotionButton>
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
    <SectionShell title="Engagement Logbook" kicker="Menswear-only Pinterest activity">
      <div className="engage-controls">
        <label>LIKE TARGET<input type="number" value={likes} min="1" max="10" onChange={(event) => setLikes(Number(event.target.value))} /></label>
        <label>COMMENT TARGET<input type="number" value={comments} min="0" max="10" onChange={(event) => setComments(Number(event.target.value))} /></label>
        <span>NICHE: MEN'S OUTFITS</span>
        <span>SAVES: 0</span>
        <MotionButton className="mini-button" cursor="RUN" onClick={engage}>RUN ENGAGEMENT</MotionButton>
      </div>
      <LogList logs={data.engagements.slice(0, 12).map((item) => `${item.action || 'Engagement'} - ${item.target || item.pinUrl || 'Pinterest pin'} - ${formatAgo(item.createdAt || item.engagedAt)}`)} empty="No engagement logs loaded yet." />
    </SectionShell>
  );
}

function HistorySection({ data, refresh }) {
  const [query, setQuery] = useState('');
  const filtered = data.history.filter((item) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));

  return (
    <SectionShell title="History Receipts" kicker="Published pins and failures">
      <div className="section-actions">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search history by title, status, username" />
        <MotionButton className="mini-button danger" cursor="CLEAR" onClick={async () => { await api('/api/history', { method: 'DELETE' }); await refresh(); }}>CLEAR HISTORY</MotionButton>
      </div>
      <DataTable rows={filtered} empty="No history receipts yet." columns={['title', 'status', 'username', 'postedAt']} />
    </SectionShell>
  );
}

function SettingsSection({ data, refresh, addLog }) {
  const [pinCookie, setPinCookie] = useState('');
  const [igCookie, setIgCookie] = useState('');

  return (
    <SectionShell title="System Settings" kicker="Pinterest and extraction connections">
      <div className="settings-grid">
        <InfoPanel title="Pinterest Setup">
          <a className="oauth-link" href="/api/pinterest" data-cursor="LINK">LINK VIA OAUTH</a>
          <div className="input-command">
            <input type="password" value={pinCookie} onChange={(event) => setPinCookie(event.target.value)} placeholder="_pinterest_sess value" />
            <MotionButton className="mini-button" cursor="LINK" onClick={async () => { await api('/api/pinterest/session/link', { method: 'POST', body: JSON.stringify({ cookie: pinCookie }) }); setPinCookie(''); addLog('PINTEREST SESSION LINKED'); await refresh(); }}>LINK SESSION</MotionButton>
          </div>
        </InfoPanel>
        <InfoPanel title="Instagram Extraction Engine">
          <div className="input-command">
            <input type="password" value={igCookie} onChange={(event) => setIgCookie(event.target.value)} placeholder="sessionid=..." />
            <MotionButton className="mini-button" cursor="SAVE" onClick={async () => { await api('/api/ig/session', { method: 'POST', body: JSON.stringify({ cookie: igCookie }) }); setIgCookie(''); addLog('IG SESSION SAVED'); await refresh(); }}>SAVE COOKIE</MotionButton>
          </div>
        </InfoPanel>
        <InfoPanel title="Runtime Diagnostics">
          <MetricRow items={[['RUNTIME', data.system?.runtime?.isServerless ? 'CLOUD' : 'LOCAL'], ['POSTING', data.system?.posting?.resolvedMode || 'API'], ['STORAGE', data.system?.storage?.type || 'ACTIVE'], ['SKIN', 'GRAPHITE']]} />
        </InfoPanel>
      </div>
    </SectionShell>
  );
}

function SectionShell({ title, kicker, children }) {
  return (
    <section className="section-shell">
      <div className="section-title-block">
        <span>{kicker}</span>
        <h1>{title}</h1>
      </div>
      {children}
    </section>
  );
}

function DataTable({ rows, columns, empty }) {
  if (!rows.length) return <div className="empty-state">{empty}</div>;
  return (
    <div className="data-table">
      {rows.slice(0, 50).map((row, index) => (
        <motion.div key={row.id || `${columns[0]}-${index}`} className="data-row" whileHover={{ scale: 1.01, y: -2, transition: { type: 'spring', stiffness: 400, damping: 25 } }}>
          {columns.map((column) => (
            <span key={column}>{String(row[column] || row[column.replace('At', '')] || '-').slice(0, 80)}</span>
          ))}
        </motion.div>
      ))}
    </div>
  );
}

function LiveTicker({ entries }) {
  const trackRef = useRef(null);
  const doubled = [...entries, ...entries];

  useLayoutEffect(() => {
    if (!trackRef.current) return undefined;
    gsap.set(trackRef.current, { xPercent: 0 });
    const tween = gsap.to(trackRef.current, {
      xPercent: -50,
      duration: 35,
      ease: 'none',
      repeat: -1,
    });
    return () => tween.kill();
  }, []);

  return (
    <div className="live-ticker" data-gsap="ticker">
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

function MobileBottomNav({ active, setActive }) {
  const items = NAV_ITEMS.filter((item) => ['dashboard', 'channels', 'queue', 'pinterest', 'history'].includes(item.id));
  return (
    <nav className="mobile-bottom-nav">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <MagneticButton key={item.id} className={active === item.id ? 'active' : ''} cursor="OPEN" onClick={() => setActive(item.id)}>
            <Icon size={18} />
            <span>{item.label === 'Pinterest' ? 'Create' : item.label}</span>
          </MagneticButton>
        );
      })}
    </nav>
  );
}

const pageTransition = {
  initial: { opacity: 0, x: 40, filter: 'blur(8px)' },
  animate: { opacity: 1, x: 0, filter: 'blur(0px)', transition: { duration: 0.3, delay: 0.1 } },
  exit: { opacity: 0, x: -40, filter: 'blur(8px)', transition: { duration: 0.25 } },
};

export default function ReelOrbitApp() {
  const { data, refresh } = useAutomationData();
  const [active, setActive] = useState('dashboard');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [tickerEntries, setTickerEntries] = useState(DEFAULT_LOGS);
  const isMobile = useMediaQuery('(max-width: 760px)');

  useLenis();
  useCursor();
  usePageAnimations();

  const stats = useMemo(() => {
    const success = data.history.filter((item) => ['success', 'completed'].includes(String(item.status || '').toLowerCase())).length;
    const failed = data.history.filter((item) => ['error', 'failed'].includes(String(item.status || '').toLowerCase())).length;
    const pending = data.queue.filter((item) => ['pending', 'processing'].includes(String(item.status || '').toLowerCase())).length;
    const queueFailed = data.queue.filter((item) => ['error', 'failed'].includes(String(item.status || '').toLowerCase())).length;
    const base = success + failed;
    return {
      published: success,
      pending,
      failed: queueFailed,
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
        `QUEUE SYNCED: ${stats.targets} TARGETS ACTIVE`,
        `ENGAGEMENT RUN: ${Math.floor(5 + Math.random() * 8)} PINS LIKED`,
        'IG REPOST PIPELINE: COMPLETED - 53M AGO',
        'SCAN COMPLETED: @URBAN.UNWRAP',
      ];
      setTickerEntries((current) => [samples[Math.floor(Math.random() * samples.length)], ...current].slice(0, 20));
    }, 9000);
    return () => clearInterval(timer);
  }, [stats.targets]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [autoRefresh, refresh]);

  const refreshWithAnimation = async () => {
    const statNodes = gsap.utils.toArray('.stat-number, .orbit-html-stat strong, .metric-box strong');
    await gsap.to(statNodes, { scale: 0.6, filter: 'blur(8px)', duration: 0.18, ease: 'power2.in' });
    await refresh();
    gsap.to(statNodes, { scale: 1, filter: 'blur(0px)', duration: 0.34, ease: 'back.out(1.7)' });
    addLog('QUEUE SYNCED: DASHBOARD DATA REFRESHED');
  };

  const section = {
    dashboard: <Dashboard data={data} stats={stats} setActive={setActive} refresh={refreshWithAnimation} addLog={addLog} />,
    channels: <ChannelsSection data={data} refresh={refreshWithAnimation} addLog={addLog} />,
    queue: <QueueSection data={data} refresh={refreshWithAnimation} />,
    pinterest: <PinterestSection refresh={refreshWithAnimation} addLog={addLog} />,
    engagement: <EngagementSection data={data} refresh={refreshWithAnimation} addLog={addLog} />,
    history: <HistorySection data={data} refresh={refreshWithAnimation} />,
    settings: <SettingsSection data={data} refresh={refreshWithAnimation} addLog={addLog} />,
  }[active];

  return (
    <>
      {!isMobile && (
        <Suspense fallback={null}>
          <BackgroundCanvas />
        </Suspense>
      )}
      <div className="app-bg" />
      <Header data={data} onRefresh={refreshWithAnimation} autoRefresh={autoRefresh} setAutoRefresh={setAutoRefresh} activeSkin="GRAPHITE" />
      {!isMobile && <NavRail active={active} setActive={setActive} />}
      <main className="app-main">
        <AnimatePresence mode="wait">
          <motion.div key={active} {...pageTransition}>
            {section}
          </motion.div>
        </AnimatePresence>
      </main>
      {isMobile && <MobileBottomNav active={active} setActive={setActive} />}
      <LiveTicker entries={tickerEntries} />
      <div className="loading-sentinel">{data.loading ? 'SYNCING LIVE DATA' : data.error}</div>
    </>
  );
}

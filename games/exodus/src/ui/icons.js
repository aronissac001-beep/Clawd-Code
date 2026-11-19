// ===== icons.js : the Exodus icon set (inline SVG line icons) and painted scene art for headers =====
// Every icon is drawn on a 24x24 grid with round strokes, so they read as one family next to each other.
const SVGNS = 'http://www.w3.org/2000/svg';
const ICON_PATHS = {
  // yields
  food: 'M12 21V9 M12 13c-3.5 0-5.5-2-6-5 3.3-.2 5.6 1.3 6 5z M12 10c3-.2 5-2 5.6-5-3.2 0-5.3 1.6-5.6 5z M12 17c3 0 5-1.6 5.6-4.2-2.8-.2-5 1.2-5.6 4.2z',
  prod: 'M10.3 3.5h3.4l.5 2.3 1.6.9 2.2-.8 1.7 2.9-1.7 1.6v1.9l1.7 1.6-1.7 2.9-2.2-.8-1.6.9-.5 2.3h-3.4l-.5-2.3-1.6-.9-2.2.8-1.7-2.9 1.7-1.6v-1.9L4.3 8.8 6 5.9l2.2.8 1.6-.9z M12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z',
  credits: 'M12 2.8l6.4 6.4L12 21.2 5.6 9.2z M5.6 9.2h12.8 M9.2 9.2L12 21.2l2.8-12 M9.2 9.2L12 2.8l2.8 6.4',
  science: 'M9.5 3.5h5 M10.5 3.5v5.2L5.2 18.2a1.6 1.6 0 0 0 1.4 2.3h10.8a1.6 1.6 0 0 0 1.4-2.3L13.5 8.7V3.5 M7.4 14.5h9.2 M10.4 17.4h.01 M13.6 16.6h.01',
  culture: 'M12 3.5c4.7 0 8.5 3.8 8.5 8.5s-3.8 8.5-8.5 8.5c-2.6 0-4.3-1.6-4.3-3.6 0-1.6 1.3-2.6 1.3-4 0-1.2-1-2-2.3-2H5.4C4.4 10.9 3.5 10 3.5 9 4.8 5.8 8.1 3.5 12 3.5z M15.6 8.4h.01 M11.4 7.4h.01 M17 12.6h.01',
  morale: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z M8.4 14.2c1.8 2.2 5.4 2.2 7.2 0 M9 9.6h.01 M15 9.6h.01',
  unhappy: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z M8.4 16c1.8-2.2 5.4-2.2 7.2 0 M9 9.6h.01 M15 9.6h.01',
  // affinities
  communion: 'M5 19c0-8 5-13 14-14-.4 9-5.6 14-14 14z M5 19l8-8 M9.6 14.4h3.6 M12 12v-3',
  lattice: 'M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z M12 7.6l3.8 2.2v4.4L12 16.4l-3.8-2.2V9.8z M12 2.8v4.8 M20 7.4l-4.2 2.4 M20 16.6l-4.2-2.4 M12 21.2v-4.8 M4 16.6l4.2-2.4 M4 7.4l4.2 2.4',
  lineage: 'M7 3c0 6 10 6 10 12 0 3-2 5-5 6 M17 3c0 6-10 6-10 12 0 3 2 5 5 6 M8.2 6.5h7.6 M8.2 17.5h7.6 M9.6 10h4.8',
  // map buttons and HUD
  menu: 'M4.5 7h15 M4.5 12h15 M4.5 17h15',
  world: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z M3.5 12h17 M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5s1.2-6.1 3.8-8.5z',
  lens: 'M2.5 12c2.4-4.2 5.6-6.3 9.5-6.3s7.1 2.1 9.5 6.3c-2.4 4.2-5.6 6.3-9.5 6.3S4.9 16.2 2.5 12z M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z',
  virtues: 'M6.5 4.5h8l3 3v12h-11z M14.5 4.5v3h3 M9.5 12.5l1.8 1.8 3.4-3.6',
  affinity: 'M12 3l2.2 4.5 4.8.7-3.5 3.4.8 4.8L12 14.2l-4.3 2.2.8-4.8L5 8.2l4.8-.7z M12 17.5v3.5 M8 21h8',
  diplomacy: 'M3.5 12.5l3.5-3.5 3 1.5 2.5-2 2.5 2 3-1.5 3.5 3.5 M7 9l-3.5 4 5 5 2-1.5 M17 9l3.5 4-5 5-2-1.5 M10.5 16.5l1.5 1.2 1.5-1.2',
  victory: 'M8 4h8v4.5a4 4 0 0 1-8 0z M8 5.5H5c0 2.6 1.4 4 3.2 4.2 M16 5.5h3c0 2.6-1.4 4-3.2 4.2 M12 12.5v3.5 M8.5 20h7 M9.5 16h5v4h-5z',
  goals: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z M12 11.2a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z M17.5 6.5l3-3',
  turn: 'M7 3.5h10 M7 20.5h10 M8 3.5c0 4 8 5 8 8.5s-8 4.5-8 8.5 M16 3.5c0 4-8 5-8 8.5s8 4.5 8 8.5',
  // planet
  veil: 'M4 14.5c1.6-1.6 3.4-1.6 5 0s3.4 1.6 5 0 3.4-1.6 5 0 M4 18.5c1.6-1.6 3.4-1.6 5 0s3.4 1.6 5 0 3.4-1.6 5 0 M8 10a4 4 0 0 1 8 0 M12 4.5v1.5 M7 6.5l1 1 M17 6.5l-1 1',
  storm: 'M5 11a5 5 0 0 1 9.6-2 4 4 0 1 1 1.4 7.7H7.5A3.5 3.5 0 0 1 5 11z M12.5 14l-2 4h3l-2 4',
  colony: 'M3.5 19.5h17 M5.5 19.5a6.5 6.5 0 0 1 13 0 M12 6.5v6.5 M9 9.5h6 M12 4.2v2.3',
  citizens: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3.8 19.5c.5-3.2 2.6-5 5.2-5s4.7 1.8 5.2 5 M16.5 10.5a2.5 2.5 0 1 0 0-5 M17 14.5c2 .3 3.3 1.9 3.7 4.5',
  sat: 'M9.2 9.2l5.6 5.6 M7.8 10.6l-4-4 2.8-2.8 4 4 M16.2 13.4l4 4-2.8 2.8-4-4 M10.5 13.5a2 2 0 1 0 2.9-2.9 M18.5 4.5a3.5 3.5 0 0 1 1 4 M15.8 5.2a1.6 1.6 0 0 1 3 1.2',
  shield: 'M12 3l7.5 2.8v5.4c0 4.6-3.2 8-7.5 9.8-4.3-1.8-7.5-5.2-7.5-9.8V5.8z',
  sword: 'M14.5 4.5h5v5L10 19l-2.5.2L5 16.7l.2-2.5z M13 11l-6.5 6.5 M4.5 15.5l4 4 M3.5 20.5l2-2',
  fire: 'M12 3.5c1 3 4.5 4.8 4.5 9a4.5 4.5 0 0 1-9 0c0-1.8.8-3 2-4 .2 1.6 1 2.6 2 3 0-3-.8-5.6.5-8z',
  laurel: 'M12 20.5c-4-1.5-7-5.4-7-10 M12 20.5c4-1.5 7-5.4 7-10 M5.4 13.6c1.6-.2 2.8.5 3.4 1.9 M5 9.8c1.5 0 2.6.9 3 2.2 M5.6 6.3c1.3.2 2.2 1.1 2.4 2.4 M18.6 13.6c-1.6-.2-2.8.5-3.4 1.9 M19 9.8c-1.5 0-2.6.9-3 2.2 M18.4 6.3c-1.3.2-2.2 1.1-2.4 2.4 M12 4l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z',
};
// Colors per icon, from the design tokens (see style.css :root).
const ICON_COLOR = { food: 'var(--y-food)', prod: 'var(--y-prod)', credits: 'var(--y-gold)', science: 'var(--y-sci)', culture: 'var(--y-cul)', morale: 'var(--y-hap)', unhappy: 'var(--bad)',
  communion: 'var(--aff-communion)', lattice: 'var(--aff-lattice)', lineage: 'var(--aff-lineage)', veil: 'var(--veil)', storm: 'var(--veil)', fire: '#ff8a5c', laurel: 'var(--acc)' };
function icon(name, size, color) {
  const d = ICON_PATHS[name]; if (!d) return document.createTextNode('');
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'ico ico-' + name);
  if (size) { svg.style.width = size + 'px'; svg.style.height = size + 'px'; }
  const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', d);
  svg.style.color = color || ICON_COLOR[name] || 'currentColor';
  svg.appendChild(p);
  return svg;
}
// Emoji in the game's text that have a drawn icon. Text across the UI is scanned and these are swapped for icons,
// so yields and affinities look the same everywhere without rewriting every string.
const EMOJI_ICON = { '👥': 'citizens', '🌾': 'food', '⚙️': 'prod', '⚙': 'prod', '💠': 'credits', '🔬': 'science', '🎭': 'culture', '🌿': 'communion', '⬢': 'lattice', '🧬': 'lineage', '🌫️': 'veil', '🌫': 'veil', '⛈️': 'storm', '⛈': 'storm', '🔥': 'fire' };
const EMOJI_RE = /(👥|⚙️|⚙|🌾|💠|🔬|🎭|🌿|⬢|🧬|🌫️|🌫|⛈️|⛈|🔥)/;
function iconizeNode(root) {
  if (!root || Settings.get('emojiIcons') === true) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => EMOJI_RE.test(n.nodeValue) && !(n.parentElement && n.parentElement.closest('textarea,input,svg,.noicon')) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
  const list = []; let n; while ((n = walker.nextNode())) list.push(n);
  for (const t of list) {
    const parts = t.nodeValue.split(EMOJI_RE), frag = document.createDocumentFragment();
    for (const part of parts) { if (!part) continue; const k = EMOJI_ICON[part]; frag.appendChild(k ? icon(k) : document.createTextNode(part)); }
    t.parentNode.replaceChild(frag, t);
  }
}
let _iconQ = new Set(), _iconT = 0;
function watchIcons() {
  const roots = ['hud', 'screens', 'modal', 'sel'].map(id => document.getElementById(id)).filter(Boolean);
  const mo = new MutationObserver(muts => {
    for (const m of muts) for (const nd of m.addedNodes) if (nd.nodeType === 1 || nd.nodeType === 3) _iconQ.add(nd.nodeType === 3 ? nd.parentNode : nd);
    if (!_iconT) _iconT = requestAnimationFrame(() => { _iconT = 0; const q = Array.from(_iconQ); _iconQ.clear(); for (const r of q) if (r && r.isConnected) iconizeNode(r); });
  });
  for (const r of roots) { mo.observe(r, { childList: true, subtree: true, characterData: false }); iconizeNode(r); }
}

// ---- painted scene art: an alien horizon used for dialog and screen headers ----
// opts: { seed, tint (hex), ark (bool), storm (bool), h }
const _sceneCache = new Map();
function sceneArt(w, h, opts) {
  opts = opts || {};
  const dpr = Math.min(2, window.devicePixelRatio || 1), key = [w, h, dpr, opts.seed, opts.tint, opts.ark, opts.storm, opts.night].join('|');
  if (_sceneCache.has(key)) { const c0 = _sceneCache.get(key), c = document.createElement('canvas'); c.width = c0.width; c.height = c0.height; c.getContext('2d').drawImage(c0, 0, 0); c.className = 'scene'; return c; }
  const c = document.createElement('canvas'); c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.className = 'scene';
  const x = c.getContext('2d'); x.scale(dpr, dpr);
  let s = 0; for (const ch of String(opts.seed || 'veyra')) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const tint = opts.tint || '#4fe3c1';
  // sky
  const sky = x.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#120634'); sky.addColorStop(0.55, '#2a1157'); sky.addColorStop(1, '#0d3a44');
  x.fillStyle = sky; x.fillRect(0, 0, w, h);
  // stars
  for (let i = 0; i < 60; i++) { x.fillStyle = `rgba(255,255,255,${0.25 + rnd() * 0.6})`; x.fillRect(rnd() * w, rnd() * h * 0.6, rnd() < 0.15 ? 1.6 : 1, rnd() < 0.15 ? 1.6 : 1); }
  // aurora in the affinity tint
  x.globalCompositeOperation = 'lighter';
  for (let b = 0; b < 3; b++) {
    const y0 = h * (0.18 + b * 0.11), g = x.createLinearGradient(0, y0 - 20, 0, y0 + 30); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, hexA(tint, 0.22 - b * 0.05)); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.moveTo(0, y0);
    for (let i = 0; i <= 12; i++) x.lineTo(w * i / 12, y0 + Math.sin(i * 0.9 + rnd() * 2) * 12);
    x.lineTo(w, y0 + 40); x.lineTo(0, y0 + 40); x.closePath(); x.fill();
  }
  x.globalCompositeOperation = 'source-over';
  // twin moons
  const moon = (mx, my, r, col) => { const g = x.createRadialGradient(mx - r * 0.3, my - r * 0.3, r * 0.1, mx, my, r); g.addColorStop(0, col); g.addColorStop(1, '#3a2a63'); x.fillStyle = g; x.beginPath(); x.arc(mx, my, r, 0, 6.283); x.fill(); x.fillStyle = 'rgba(255,255,255,.08)'; x.beginPath(); x.arc(mx, my, r * 1.6, 0, 6.283); x.fill(); };
  moon(w * (0.72 + rnd() * 0.15), h * 0.22, Math.min(w, h) * 0.13, '#efe4ff'); moon(w * (0.55 + rnd() * 0.1), h * 0.12, Math.min(w, h) * 0.05, '#bfe9ff');
  // storm vortex
  if (opts.storm) { x.save(); x.translate(w * 0.3, h * 0.35); for (let a = 0; a < 3; a++) { x.beginPath(); for (let k = 0; k <= 30; k++) { const f = k / 30, an = a * 2.09 + f * 4, rr = h * 0.4 * f; x.lineTo(Math.cos(an) * rr, Math.sin(an) * rr * 0.45); } x.strokeStyle = 'rgba(255,140,230,.35)'; x.lineWidth = 3; x.stroke(); } x.restore(); }
  // far ridges with crystal spires
  const ridge = (yb, amp, col, spires) => {
    x.fillStyle = col; x.beginPath(); x.moveTo(0, h);
    for (let i = 0; i <= 20; i++) { const px = w * i / 20, py = yb - Math.abs(Math.sin(i * 0.7 + rnd() * 3)) * amp; x.lineTo(px, py); if (spires && rnd() < 0.35) { x.lineTo(px + 3, py - amp * (0.6 + rnd())); x.lineTo(px + 6, py); } }
    x.lineTo(w, h); x.closePath(); x.fill();
  };
  ridge(h * 0.7, h * 0.12, '#1d1145', true); ridge(h * 0.8, h * 0.09, '#140b33', false);
  // glowing fungal forest in the foreground
  for (let i = 0; i < 14; i++) {
    const fx = rnd() * w, fy = h * (0.86 + rnd() * 0.12), r = 6 + rnd() * 14;
    x.strokeStyle = '#0b0620'; x.lineWidth = Math.max(2, r * 0.2); x.beginPath(); x.moveTo(fx, h); x.lineTo(fx, fy); x.stroke();
    x.fillStyle = '#160c34'; x.beginPath(); x.ellipse(fx, fy, r, r * 0.45, 0, Math.PI, 0); x.fill();
    const g = x.createRadialGradient(fx, fy, 0, fx, fy, r * 1.6); g.addColorStop(0, hexA(i % 3 ? tint : '#ff8adf', 0.55)); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.globalCompositeOperation = 'lighter'; x.fillStyle = g; x.beginPath(); x.arc(fx, fy, r * 1.6, 0, 6.283); x.fill(); x.globalCompositeOperation = 'source-over';
  }
  // the ark coming down
  if (opts.ark) {
    const ax = w * 0.38, ay = h * 0.4, sc = h / 140;
    const g = x.createLinearGradient(ax, ay, ax, ay + 50 * sc); g.addColorStop(0, hexA(tint, 0.7)); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.moveTo(ax - 6 * sc, ay + 6 * sc); x.lineTo(ax + 6 * sc, ay + 6 * sc); x.lineTo(ax + 16 * sc, ay + 60 * sc); x.lineTo(ax - 16 * sc, ay + 60 * sc); x.closePath(); x.fill();
    x.fillStyle = '#d9d3ef'; x.strokeStyle = '#0b0620'; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(ax, ay - 16 * sc); x.lineTo(ax + 9 * sc, ay + 6 * sc); x.lineTo(ax - 9 * sc, ay + 6 * sc); x.closePath(); x.fill(); x.stroke();
    x.fillStyle = tint; x.fillRect(ax - 9 * sc, ay + 2 * sc, 18 * sc, 3 * sc);
  }
  // fade into the panel below
  const fade = x.createLinearGradient(0, h * 0.6, 0, h); fade.addColorStop(0, 'rgba(14,9,32,0)'); fade.addColorStop(1, 'rgba(14,9,32,.95)');
  x.fillStyle = fade; x.fillRect(0, 0, w, h);
  _sceneCache.set(key, c);
  if (_sceneCache.size > 24) _sceneCache.delete(_sceneCache.keys().next().value);
  const out = document.createElement('canvas'); out.width = c.width; out.height = c.height; out.getContext('2d').drawImage(c, 0, 0); out.className = 'scene'; return out;
}
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
function affColor(key) { const A = AFFINITIES.find(x => x.key === key); return A ? A.color : '#4fe3c1'; }
// Motion: a short pulse when a number changes (skipped when the player prefers reduced motion).
function reduceMotion() { return (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) || Settings.get('anim') === 'off'; }
function tickNum(el, v) {
  if (el._last !== undefined && el._last !== v && !reduceMotion()) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  el._last = v;
}
// A dialog header: painted scene, the kind label and a badge icon.
function dlgArt(kind, opts, ic) {
  return h('div', { class: 'art' }, sceneArt(358, 112, opts), h('div', { class: 'evk' }, kind), ic ? h('div', { class: 'badge-ic' }, icon(ic, 22, opts && opts.tint)) : null);
}

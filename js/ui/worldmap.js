// The world map component (owner I; EMBERCROWN-WORLD.md 8.3 "WORLD MAP", G8, G22, section 10 rows "World map
// frame", "World map memory" and Battery; step W2.6). One shared map for embark (W2.7) and the World tab (W3.7):
// pan, pinch with snapping to three zoom levels, the layer chips with their 14 px legend strips, the loupe and
// the selection frame. C's js/engine/render/atlas.js bakes and draws; this file only handles input, the camera
// and the chrome. It never writes game state and draws only on input, during a snap, or (when still) at 10 fps
// for the cloud drift and the frame pulse; under Battery saver it draws on input only.
//
//   const map = createWorldMap(host, realm, opts)
//     opts { layer: 'atlas', readOnly: false, selected: {rx, ry} | null, home: {rx, ry} | null,
//            onSelect(rx, ry), onPeek(rx, ry), onLayer(id), onView(view),
//            settings: () => ({ reduceMotion, batterySaver }), chips: true, atlas: a baked atlas to reuse,
//            chipsInto: an element for the layer chips (the top bar in landscape, 8.3), else above the legend }
//   map.select(rx, ry, { reveal })   move the selection frame (no callback); reveal keeps it in the uncovered map
//   map.setLayer(id) / map.zoomTo(level, anchor) / map.fit() / map.zoomIn() / map.zoomOut()
//   map.setInset({ t, r, b, l })     the part of the map a sheet covers (G22): pan limits and reveal respect it
//   map.setView({ ox, oy, scale })   set the camera (a fly-to; the bench sweep)
//   map.setMatches(list)             regions to mark (the site finder's matches): [{ rx, ry }]
//   map.state() / map.stats()        camera, level, loupe, selection / frame times (p95), bake and layer ms
//   map.destroy()                    stop drawing and release the atlas canvases (the screen closed)
// Zoom levels: fit (the whole world), 4x and 8x of a unit that is the fit scale but never under 5.5 pt, so an
// 8x region cell is >= 44 pt at every size and viewport. Below 4x a tap opens the loupe (5 x 5 regions, each
// cell >= 44 pt); a tap on a loupe cell chooses it. At 4x and above a tap chooses directly. In read-only mode
// (the World tab) a choice is a peek: onPeek fires and the frame stays on the hold's region.
// Strings: the 'worldmap.*' rows of strings-en.js (G25).
// t-keys: worldmap.*
import { h, onTap, clear } from './kit.js';
import { t } from './strings.js';
import { PAL } from '../engine/art/palette.js';
import { ATLAS_LAYERS, ATLAS_BIOME, TINCTURES, layerDef } from '../engine/art/atlas.js';
import { createAtlas, setLayer as bakeLayer, drawAtlas, drawFrame, drawLoupe, regionAt, releaseAtlas } from '../engine/render/atlas.js';
import { REALM_BIOMES } from '../data/realm/biomes.js';

const tx = t;

export const LAYER_IDS = Object.freeze(ATLAS_LAYERS.map((l) => l.id));
export const LEVELS = Object.freeze(['fit', '4x', '8x']);
const MIN_UNIT = 44 / 8;      // pt per region at "1x" at least: 8x is >= 44 pt
const LOUPE_CELL = 44;        // pt per region inside the loupe
const TAP_SLOP = 8;           // pt a finger may move and still tap
const IDLE_MS = 100;          // 10 fps when still (section 10 Battery)
const SNAP_MS = 140;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** The three level scales (pt per region) for a map box of W x H and a world of n x n. Pure (tested in the flow). */
export function levelScales(W, H, n) {
  const fit = Math.max(0.5, Math.min(W, H) / n), unit = Math.max(fit, MIN_UNIT);
  return [fit, 4 * unit, 8 * unit];
}
/** The index of the level nearest to scale, in log space. */
export function nearestLevel(scales, s) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < scales.length; i++) { const d = Math.abs(Math.log(s / scales[i])); if (d < bd) { bd = d; best = i; } }
  return best;
}

function prefersReduced() { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; } }

/** The legend of a layer: { lo, hi, stops: [colour], cats: [{ c, label }] }. */
function legendOf(def, realm) {
  const col = (name) => PAL[name] || name;
  if (def.kind === 'atlas') {
    const stops = REALM_BIOMES.filter((b) => b.embark).map((b) => (ATLAS_BIOME[b.id] || ATLAS_BIOME.greenvale).r[2]);
    return { lo: tx('worldmap.legend.biomes'), hi: '', stops };
  }
  if (def.kind === 'seq') {
    const stops = def.stops.map(col);
    if (def.id === 'temp') return { lo: tx('worldmap.legend.deg', { n: def.range[0] }), hi: tx('worldmap.legend.deg', { n: def.range[1] }), stops };
    return { lo: tx('worldmap.legend.' + def.id + '.lo'), hi: tx('worldmap.legend.' + def.id + '.hi'), stops };
  }
  if (def.id === 'peoples') {
    const civs = (realm.tables && realm.tables.civs) || [];
    const cats = [{ c: col(def.none), label: tx('worldmap.legend.unclaimed') }];
    for (const cv of civs.slice(0, 8)) if (cv && cv.name) cats.push({ c: TINCTURES[(cv.id !== undefined ? cv.id : 0) % TINCTURES.length], label: cv.name });
    return { cats };
  }
  return { cats: def.stops.map((s, i) => ({ c: col(s), label: tx('worldmap.rock.' + i) })) };
}

/** Mount the world map in host (which it fills). Returns the map's handle. */
export function createWorldMap(host, realm, opts = {}) {
  const readOnly = !!opts.readOnly, n = realm.n;
  const ownAtlas = !opts.atlas;
  const at = opts.atlas || createAtlas(realm);
  const settings = () => { let s = null; try { s = opts.settings ? opts.settings() : null; } catch (_) { s = null; } return { reduceMotion: s ? !!s.reduceMotion : prefersReduced(), batterySaver: !!(s && s.batterySaver) }; };

  // ---- DOM ------------------------------------------------------------------------------------------
  const root = h('div.ec-wmap', { 'data-wmap': readOnly ? 'view' : 'embark', style: { position: 'relative', display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: '0', overflow: 'hidden', background: PAL.deep } });
  const chipRow = h('div.ec-wmap-chips', { role: 'toolbar', 'aria-label': tx('worldmap.layers'), style: { display: 'flex', gap: '6px', padding: '4px 8px', overflowX: 'auto', overflowY: 'hidden', flex: 'none', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } });
  const legend = h('div.ec-wmap-legend', { 'aria-hidden': 'true', style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px 4px', minHeight: '20px', flex: 'none', fontSize: 'var(--fs-1, 14px)', color: 'var(--dim, #d3c3a3)', overflowX: 'auto', overflowY: 'hidden', whiteSpace: 'nowrap', scrollbarWidth: 'none' } });
  const stage = h('div.ec-wmap-stage', { style: { position: 'relative', flex: '1 1 auto', minHeight: '0', overflow: 'hidden', touchAction: 'none' } });
  const cv = h('canvas.ec-wmap-cv', { tabindex: '0', role: 'application', 'aria-label': tx('worldmap.label'), style: { position: 'absolute', left: '0', top: '0', touchAction: 'none', imageRendering: 'pixelated', outline: 'none' } });
  const live = h('div.ec-wmap-live', { 'aria-live': 'polite', style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' } });
  const hint = h('div.ec-wmap-hint', { hidden: true, style: { position: 'absolute', top: '8px', left: '50%', transform: 'translateX(-50%)', padding: '4px 12px', borderRadius: 'var(--r-pill, 22px)', background: 'var(--glass, rgba(34,27,30,0.9))', border: '1px solid var(--line-soft, rgba(201,151,62,0.32))', color: 'var(--text, #f6ead2)', fontSize: 'var(--fs-1, 14px)', pointerEvents: 'none', whiteSpace: 'nowrap' } }, tx('worldmap.hint.loupe'));
  const zoomBox = h('div.ec-wmap-zoom', { style: { position: 'absolute', left: '8px', bottom: '8px', display: 'flex', gap: '6px' } });
  const zbtn = (act, text, label, fn) => onTap(h('button.ec-ibtn.ec-wmap-zb', { type: 'button', 'data-act': act, 'aria-label': label, style: { fontSize: 'var(--fs-3, 16px)', fontWeight: '650', width: act === 'wm-fit' ? '56px' : '44px' } }, text), fn);
  zoomBox.append(
    zbtn('wm-out', '-', tx('worldmap.zoomOut'), () => api.zoomOut()),
    zbtn('wm-fit', tx('worldmap.fit'), tx('worldmap.fitLabel'), () => api.fit()),
    zbtn('wm-in', '+', tx('worldmap.zoomIn'), () => api.zoomIn()));
  stage.append(cv, hint, zoomBox, live);
  if (opts.chips !== false) {
    if (opts.chipsInto) { chipRow.style.flex = '1 1 auto'; chipRow.style.minWidth = '0'; chipRow.style.padding = '0 4px'; opts.chipsInto.append(chipRow); root.append(legend); }
    else root.append(chipRow, legend);
  }
  root.append(stage);
  host.append(root);
  const g = cv.getContext('2d');

  // ---- state (UI only, never saved) -----------------------------------------------------------------
  let W = 1, H = 1, d = 1, scales = [1, 4, 8], level = 0;
  const view = { ox: 0, oy: 0, scale: 1, w: 1, h: 1, dpr: 1 };
  const inset = { t: 0, r: 0, b: 0, l: 0 };
  let sel = opts.selected ? { rx: opts.selected.rx, ry: opts.selected.ry } : null;
  const home = opts.home ? { rx: opts.home.rx, ry: opts.home.ry } : null;
  if (readOnly && home && !sel) sel = { ...home };
  let loupe = null, matches = [], snap = null, raf = 0, idle = 0, dead = false;
  const times = [], counts = { draws: 0, layer: 0 };

  // ---- camera ---------------------------------------------------------------------------------------
  function clampView() {
    const x0 = inset.l, y0 = inset.t, x1 = W - inset.r, y1 = H - inset.b, mw = n * view.scale, mh = n * view.scale;
    view.ox = mw <= x1 - x0 ? x0 + (x1 - x0 - mw) / 2 : clamp(view.ox, x1 - mw, x0);
    view.oy = mh <= y1 - y0 ? y0 + (y1 - y0 - mh) / 2 : clamp(view.oy, y1 - mh, y0);
  }
  /** Set the scale keeping map point under (ax, ay) fixed. */
  function scaleAround(s, ax, ay) {
    const wx = (ax - view.ox) / view.scale, wy = (ay - view.oy) / view.scale;
    view.scale = s; view.ox = ax - wx * s; view.oy = ay - wy * s;
    clampView();
  }
  function centreOn(rx, ry) {
    const cx = (inset.l + W - inset.r) / 2, cy = (inset.t + H - inset.b) / 2;
    view.ox = cx - (rx + 0.5) * view.scale; view.oy = cy - (ry + 0.5) * view.scale; clampView();
  }
  /** Keep region (rx, ry) inside the uncovered map, at least 48 pt from its edges (or centred when too small). */
  function reveal(rx, ry) {
    const m = Math.min(48, (W - inset.l - inset.r) / 4, (H - inset.t - inset.b) / 4), s = view.scale;
    const x = view.ox + rx * s, y = view.oy + ry * s;
    if (x < inset.l + m) view.ox += inset.l + m - x; else if (x + s > W - inset.r - m) view.ox -= x + s - (W - inset.r - m);
    if (y < inset.t + m) view.oy += inset.t + m - y; else if (y + s > H - inset.b - m) view.oy -= y + s - (H - inset.b - m);
    clampView();
  }
  const anchorDefault = () => {
    if (sel) { const x = view.ox + (sel.rx + 0.5) * view.scale, y = view.oy + (sel.ry + 0.5) * view.scale; if (x >= inset.l && x <= W - inset.r && y >= inset.t && y <= H - inset.b) return { x, y }; }
    return { x: (inset.l + W - inset.r) / 2, y: (inset.t + H - inset.b) / 2 };
  };
  function animateTo(target, anchor) {
    const s0 = view.scale, s1 = scales[target];
    level = target;
    if (settings().reduceMotion || Math.abs(Math.log(s1 / s0)) < 1e-3) { scaleAround(s1, anchor.x, anchor.y); snap = null; changed(); return; }
    snap = { t0: now(), s0, s1, ax: anchor.x, ay: anchor.y };
    request();
  }
  function stepSnap(tm) {
    if (!snap) return;
    const k = clamp((tm - snap.t0) / SNAP_MS, 0, 1), e = 1 - (1 - k) * (1 - k);
    scaleAround(k >= 1 ? snap.s1 : Math.exp(Math.log(snap.s0) + (Math.log(snap.s1) - Math.log(snap.s0)) * e), snap.ax, snap.ay);
    if (k >= 1) { snap = null; changed(); }
  }
  const changed = () => { request(); if (opts.onView) try { opts.onView({ ...view, level }); } catch (_) { /* a caller's bug never breaks the map */ } };

  function resize() {
    const r = stage.getBoundingClientRect(), w = Math.max(1, Math.round(r.width)), hh = Math.max(1, Math.round(r.height));
    const nd = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    if (w === W && hh === H && nd === d && cv.width) return;
    const first = !cv.width, a = anchorDefault(), wx = (a.x - view.ox) / view.scale, wy = (a.y - view.oy) / view.scale;
    W = w; H = hh; d = nd;
    cv.width = Math.round(W * d); cv.height = Math.round(H * d); cv.style.width = W + 'px'; cv.style.height = H + 'px';
    view.w = W; view.h = H; view.dpr = d;
    scales = levelScales(W, H, n);
    view.scale = scales[level];
    if (first) { if (sel && level > 0) centreOn(sel.rx, sel.ry); else clampView(); }
    else { const ax = (inset.l + W - inset.r) / 2, ay = (inset.t + H - inset.b) / 2; view.ox = ax - wx * view.scale; view.oy = ay - wy * view.scale; clampView(); }
    loupe = null; hint.hidden = true;
    request();
  }

  // ---- drawing --------------------------------------------------------------------------------------
  function request() { if (!raf && !dead) raf = requestAnimationFrame(frame); }
  function animated() { const s = settings(); return !s.batterySaver && !s.reduceMotion; }
  function frame(tm) {
    raf = 0;
    if (dead) return;
    if (typeof document !== 'undefined' && document.hidden) return; // visibilitychange redraws
    stepSnap(tm);
    draw(tm / 1000);
    if (snap) request();
    else scheduleIdle();
  }
  function scheduleIdle() {
    clearTimeout(idle); idle = 0;
    if (dead || !animated() || !root.isConnected) return;
    idle = setTimeout(() => { idle = 0; request(); }, IDLE_MS);
  }
  function lpGeom(lp) {
    const ppr = at.ppr, span = 5 * ppr, size = span * lp.k;
    const sx = clamp((lp.rx - 2) * ppr, 0, at.size - span), sy = clamp((lp.ry - 2) * ppr, 0, at.size - span);
    return { x: lp.cx - size / 2, y: lp.cy - size / 2, size, cell: ppr * lp.k, rx0: sx / ppr, ry0: sy / ppr };
  }
  function draw(ts) {
    const t0 = now(), s = settings(), tPulse = s.batterySaver || s.reduceMotion ? 0 : ts;
    const ms = drawAtlas(g, at, view, { clouds: s.batterySaver ? 'off' : s.reduceMotion ? 'static' : 'drift', t: ts, sites: true });
    // matches: a gold pip in each matched region (2 device px at least)
    if (matches.length) {
      const pip = Math.max(2, Math.round(view.scale * d * 0.34)), u = Math.max(1, Math.round(d));
      for (const m of matches) {
        const cx = Math.round((view.ox + (m.rx + 0.5) * view.scale) * d), cy = Math.round((view.oy + (m.ry + 0.5) * view.scale) * d);
        if (cx < -pip || cy < -pip || cx > W * d + pip || cy > H * d + pip) continue;
        g.fillStyle = PAL.ink; g.fillRect(cx - (pip >> 1) - u, cy - (pip >> 1) - u, pip + 2 * u, pip + 2 * u);
        g.fillStyle = PAL.gold; g.fillRect(cx - (pip >> 1), cy - (pip >> 1), pip, pip);
      }
    }
    if (home && readOnly) drawFrame(g, at, view, home.rx, home.ry, 0);
    else if (sel) drawFrame(g, at, view, sel.rx, sel.ry, tPulse);
    if (loupe) {
      const L = lpGeom(loupe), u = Math.max(1, Math.round(d));
      // the loupe's 5 x 5 window on the map: a 1 px bone outline
      const x = Math.round((view.ox + L.rx0 * view.scale) * d), y = Math.round((view.oy + L.ry0 * view.scale) * d), S = Math.round(5 * view.scale * d);
      g.fillStyle = PAL.bone; g.fillRect(x - u, y - u, S + 2 * u, u); g.fillRect(x - u, y + S, S + 2 * u, u); g.fillRect(x - u, y, u, S); g.fillRect(x + S, y, u, S);
      drawLoupe(g, at, view, loupe.rx, loupe.ry, loupe.cx, loupe.cy, loupe.k);
    }
    counts.draws++;
    const total = now() - t0;
    times.push(Math.max(ms, total)); if (times.length > 240) times.shift();
  }

  // ---- the loupe and choosing -----------------------------------------------------------------------
  function openLoupe(r, x, y) {
    // k: CSS px per atlas px, in steps that are whole device px (pixel art stays crisp); the smallest with a 44 pt cell
    const ppr = at.ppr, box = Math.min(W - inset.l - inset.r, H - inset.t - inset.b) - 8;
    let k = Math.ceil(LOUPE_CELL * d / ppr) / d;
    while (k > 1 && 5 * ppr * k + 6 > box) k -= 1 / d;
    const size = 5 * ppr * k, half = size / 2 + 4, lift = 24;
    let cx = x, cy = y - half - lift;
    if (cy - half < inset.t) cy = y + half + lift;                         // no room above: below the finger
    if (cy + half > H - inset.b) { cy = (inset.t + H - inset.b) / 2; cx = x < W / 2 ? x + half + lift : x - half - lift; } // beside it
    cx = clamp(cx, inset.l + half, Math.max(inset.l + half, W - inset.r - half));
    cy = clamp(cy, inset.t + half, Math.max(inset.t + half, H - inset.b - half));
    loupe = { rx: r.rx, ry: r.ry, cx, cy, k };
    // the hint goes on the side the loupe leaves free: under it (above the zoom buttons) or over it
    const low = cy - half > (inset.t + H - inset.b) / 2 - half / 2;
    hint.style.top = low ? (inset.t + 8) + 'px' : 'auto';
    hint.style.bottom = low ? 'auto' : (inset.b + 60) + 'px';
    hint.hidden = false;
    say(r.rx, r.ry);
    request();
  }
  function closeLoupe() { if (loupe) { loupe = null; hint.hidden = true; request(); } }
  function loupeCell(x, y) {
    if (!loupe) return undefined;
    const L = lpGeom(loupe);
    if (x < L.x || y < L.y || x >= L.x + L.size || y >= L.y + L.size) return undefined;
    return { rx: L.rx0 + Math.floor((x - L.x) / L.cell), ry: L.ry0 + Math.floor((y - L.y) / L.cell) };
  }
  function say(rx, ry) {
    const b = REALM_BIOMES[realm.fields.biome[ry * n + rx]];
    live.textContent = tx('worldmap.region', { x: rx, y: ry, biome: b ? b.name : '' });
  }
  function choose(r) {
    closeLoupe();
    say(r.rx, r.ry);
    if (readOnly) { if (opts.onPeek) opts.onPeek(r.rx, r.ry); request(); return; }
    sel = { rx: r.rx, ry: r.ry };
    reveal(r.rx, r.ry);
    request();
    if (opts.onSelect) opts.onSelect(r.rx, r.ry);
  }
  function tapAt(x, y) {
    const c = loupeCell(x, y);
    if (c) { choose(c); return; }
    const r = regionAt(at, view, x, y);
    if (!r) { closeLoupe(); return; }
    if (view.scale >= scales[1] - 1e-6) choose(r);
    else openLoupe(r, x, y);
  }

  // ---- input ----------------------------------------------------------------------------------------
  const ptrs = new Map();
  let gest = null;
  const local = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const two = () => { const [a, b] = [...ptrs.values()]; return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  function startGesture() {
    if (ptrs.size >= 2) { const m = two(); gest = { kind: 'pinch', d0: m.d, s0: gest && gest.pinched ? gest.s0 : view.scale, lv0: gest && gest.pinched ? gest.lv0 : nearestLevel(scales, view.scale), wx: (m.x - view.ox) / view.scale, wy: (m.y - view.oy) / view.scale, ax: m.x, ay: m.y }; closeLoupe(); }
    else if (ptrs.size === 1) { const p = [...ptrs.values()][0], was = gest; gest = { kind: was && was.kind !== 'tap' ? 'pan' : 'tap', x0: p.x, y0: p.y, ox0: view.ox, oy0: view.oy, t0: now(), pinched: !!(was && (was.kind === 'pinch' || was.pinched)), s0: was && was.s0, lv0: was && was.lv0 }; }
    else gest = null;
  }
  cv.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
    snap = null;
    ptrs.set(e.pointerId, local(e));
    startGesture();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId) || !gest) return;
    ptrs.set(e.pointerId, local(e));
    if (gest.kind === 'pinch' && ptrs.size >= 2) {
      const m = two(), s = clamp(gest.s0 * m.d / gest.d0, scales[0] * 0.8, scales[2] * 1.25);
      view.scale = s; view.ox = m.x - gest.wx * s; view.oy = m.y - gest.wy * s; gest.ax = m.x; gest.ay = m.y;
      clampView(); request();
    } else if (ptrs.size === 1) {
      const p = ptrs.get(e.pointerId);
      if (gest.kind === 'tap' && Math.hypot(p.x - gest.x0, p.y - gest.y0) > TAP_SLOP) { gest.kind = 'pan'; closeLoupe(); }
      if (gest.kind === 'pan') { view.ox = gest.ox0 + p.x - gest.x0; view.oy = gest.oy0 + p.y - gest.y0; clampView(); request(); }
    }
  });
  /** The level a pinch snaps to: the nearest, but a pinch of 25 % or more always leaves its start level. */
  function snapLevel(g0) {
    const near = nearestLevel(scales, view.scale), r = view.scale / (g0.s0 || view.scale);
    if (near === g0.lv0 && r >= 1.25) return Math.min(2, near + 1);
    if (near === g0.lv0 && r <= 0.8) return Math.max(0, near - 1);
    return near;
  }
  const end = (e, ok) => {
    if (!ptrs.has(e.pointerId)) return;
    const p = local(e), g0 = gest;
    ptrs.delete(e.pointerId);
    if (g0 && g0.kind === 'pinch') {
      if (ptrs.size === 0) { gest = null; animateTo(snapLevel(g0), { x: g0.ax, y: g0.ay }); }
      else startGesture(); // the other finger pans on; the snap waits for it
      return;
    }
    if (ptrs.size) { startGesture(); return; }
    gest = null;
    if (g0 && g0.kind === 'tap' && ok && now() - g0.t0 < 800) tapAt(p.x, p.y);
    else if (g0 && g0.pinched) animateTo(snapLevel(g0), { x: p.x, y: p.y });
    else if (g0 && g0.kind === 'pan') changed();
  };
  cv.addEventListener('pointerup', (e) => end(e, true));
  cv.addEventListener('pointercancel', (e) => end(e, false));
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e), next = clamp(nearestLevel(scales, view.scale) + (e.deltaY < 0 ? 1 : -1), 0, 2);
    animateTo(next, p);
  }, { passive: false });
  cv.addEventListener('keydown', (e) => {
    const k = e.key, mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
    if (mv) {
      e.preventDefault();
      if (readOnly) { view.ox -= mv[0] * 4 * view.scale; view.oy -= mv[1] * 4 * view.scale; clampView(); changed(); return; }
      const c = sel || { rx: n >> 1, ry: n >> 1 };
      choose({ rx: clamp(c.rx + mv[0], 0, n - 1), ry: clamp(c.ry + mv[1], 0, n - 1) });
    } else if (k === '+' || k === '=') { e.preventDefault(); api.zoomIn(); }
    else if (k === '-') { e.preventDefault(); api.zoomOut(); }
    else if (k === '0') { e.preventDefault(); api.fit(); }
    else if (k === 'Escape' && loupe) { e.preventDefault(); closeLoupe(); }
  });
  const onVis = () => { if (!document.hidden) request(); };
  document.addEventListener('visibilitychange', onVis);
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => resize()); ro.observe(stage); }
  else window.addEventListener('resize', resize);

  // ---- layer chips and legend -----------------------------------------------------------------------
  const chips = {};
  function paintLegend() {
    clear(legend);
    const L = legendOf(layerDef(at.layer), realm);
    const sw = (c, w) => h('span', { style: { display: 'inline-block', flex: w ? 'none' : '1 1 0', width: w || 'auto', height: '14px', background: c } });
    if (L.stops) {
      if (L.lo) legend.append(h('span.ec-wmap-lo', { style: { flex: 'none' } }, L.lo));
      legend.append(h('span.ec-wmap-strip', { style: { display: 'flex', flex: '1 1 auto', minWidth: '96px', maxWidth: '280px', height: '14px', boxShadow: '0 0 0 1px ' + PAL.ink } }, L.stops.map((c) => sw(c))));
      if (L.hi) legend.append(h('span.ec-wmap-hi', { style: { flex: 'none' } }, L.hi));
    } else {
      for (const c of L.cats) legend.append(h('span.ec-wmap-cat', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px', flex: 'none' } }, sw(c.c, '14px'), c.label));
    }
    legend.dataset.layer = at.layer;
  }
  for (const id of LAYER_IDS) {
    const b = onTap(h('button.ec-wmap-chip', { type: 'button', 'data-act': 'wm-layer-' + id, 'data-layer': id, 'aria-pressed': 'false',
      style: { flex: 'none', minWidth: '44px', height: '44px', padding: '0 12px', borderRadius: 'var(--r-pill, 22px)', border: '1px solid var(--line-soft, rgba(201,151,62,0.32))', background: 'var(--surface-2, #261f23)', color: 'var(--dim, #d3c3a3)', fontSize: 'var(--fs-2, 15px)', fontWeight: '600', whiteSpace: 'nowrap' } },
    tx('worldmap.layer.' + id)), () => api.setLayer(id));
    chips[id] = b; chipRow.append(b);
  }
  function paintChips() {
    for (const id of LAYER_IDS) {
      const on = id === at.layer, b = chips[id];
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.style.background = on ? 'var(--sel, #4d3722)' : 'var(--surface-2, #261f23)';
      b.style.color = on ? 'var(--text, #f6ead2)' : 'var(--dim, #d3c3a3)';
      b.style.borderColor = on ? 'var(--brass-hi, #f0c86a)' : 'var(--line-soft, rgba(201,151,62,0.32))';
    }
  }

  // ---- the handle -----------------------------------------------------------------------------------
  const api = {
    root, canvas: cv, atlas: at,
    select(rx, ry, o = {}) {
      if (rx === null || rx === undefined) { sel = readOnly && home ? { ...home } : null; request(); return; }
      sel = { rx: clamp(rx | 0, 0, n - 1), ry: clamp(ry | 0, 0, n - 1) };
      if (o.reveal !== false) reveal(sel.rx, sel.ry);
      request();
    },
    setLayer(id) {
      const def = layerDef(id);
      if (def.id !== at.layer) { counts.layer = bakeLayer(at, def.id); paintLegend(); paintChips(); request(); if (opts.onLayer) opts.onLayer(def.id); }
      const c = chips[def.id]; if (c && c.scrollIntoView) try { c.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) { /* old engines */ }
      return counts.layer;
    },
    zoomTo(lv, anchor) { closeLoupe(); animateTo(clamp(lv | 0, 0, 2), anchor || anchorDefault()); },
    fit() { api.zoomTo(0); },
    zoomIn() { api.zoomTo(nearestLevel(scales, view.scale) + 1); },
    zoomOut() { api.zoomTo(nearestLevel(scales, view.scale) - 1); },
    setInset(o = {}) { inset.t = o.t || 0; inset.r = o.r || 0; inset.b = o.b || 0; inset.l = o.l || 0; clampView(); if (sel) reveal(sel.rx, sel.ry); loupe = null; hint.hidden = true; changed(); },
    setMatches(list) { matches = (list || []).map((m) => (typeof m === 'number' ? { rx: m % n, ry: Math.floor(m / n) } : { rx: m.rx, ry: m.ry })); request(); },
    reveal(rx, ry) { reveal(rx, ry); request(); },
    /** Set the camera ({ ox, oy, scale } CSS px; scale clamped to fit..8x); the level becomes the nearest one. */
    setView(v = {}) {
      snap = null;
      if (v.scale) view.scale = clamp(v.scale, scales[0], scales[2]);
      if (v.ox !== undefined) view.ox = v.ox;
      if (v.oy !== undefined) view.oy = v.oy;
      level = nearestLevel(scales, view.scale); clampView(); request();
    },
    resize,
    redraw: () => request(),
    state: () => ({ view: { ...view }, level, levels: scales.slice(), layer: at.layer, selected: sel && { ...sel }, home: home && { ...home }, readOnly,
      loupe: loupe && { ...loupe, ...lpGeom(loupe) }, inset: { ...inset }, matches: matches.length, snapping: !!snap }),
    stats() {
      const s = times.slice().sort((a, b) => a - b), q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0);
      return { frames: times.length, draws: counts.draws, p95: +q(0.95).toFixed(3), max: +q(1).toFixed(3), bake: at.ms && at.ms.bake, layer: counts.layer };
    },
    /** Draw one frame now and return its time (the bench and the flow's frame-time sweep). */
    drawNow(ts = now() / 1000) { draw(ts); return times[times.length - 1]; },
    destroy() {
      if (dead) return;
      dead = true;
      if (raf) cancelAnimationFrame(raf); raf = 0;
      clearTimeout(idle);
      if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
      chipRow.remove();
      document.removeEventListener('visibilitychange', onVis);
      if (ownAtlas) releaseAtlas(at);
      cv.width = cv.height = 0;
      root.remove();
    },
  };

  if (opts.layer && opts.layer !== 'atlas') counts.layer = bakeLayer(at, layerDef(opts.layer).id);
  paintChips(); paintLegend();
  resize();
  return api;
}

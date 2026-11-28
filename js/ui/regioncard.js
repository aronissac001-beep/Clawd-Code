// The region card and the map panel around it (owner I; EMBERCROWN-WORLD.md 3.1-3.4, 3.7, G8, G21; step W2.7b).
//   const rp = createRegionPanel(panel, realm, opts)   the embark map's panel: a hint, the region card or the finder
//     opts { map (worldmap.js handle), used: [[slot, rx, ry]] (the world index), start: a start id or null,
//            onSettle(rx, ry) (Settle here), onSelect(rx, ry) (the selection moved: a neighbour tap, Next match) }
//     rp.hint()            no selection: the hint and Find a site
//     rp.show(rx, ry)      the region card of (rx, ry)
//     rp.finder()          the site finder sheet (finderui.js) in the panel
//     rp.state()           { mode, sel, matches, k } (tests)
//     rp.destroy()
//   previewPlane(realm, rx, ry)  the region's real surface (mapgen3 previewSurface), LRU of 4, cosmetic
// The card (3.3): every fact in words with its number on a smaller line; the 3 x 3 local area as 72 pt cells (the
// centre is the hold's real surface at 1 px a tile, 2 px when tapped; the neighbours biome glyphs with river arrows
// and a shade on their massif side; a tap moves the selection); Settle here, off with a reason (3.2). The facts come
// from js/game/realm/finder.js cardFacts (built on region.js regionFacts and regionOpts); the card root carries
// them in data-* for the phone flow. Render-side only: never writes game state or reads s.rng.
// Strings: the 'card.*' rows of strings-en.js.
// t-keys: card.why.* card.cls.* card.soil.* card.ore.* card.oreName.* card.river.* card.cav.* card.front.* card.side.* card.nb.* card.season.* card.geo.*
import { h, clear, onTap } from './kit.js';
import { t, list } from './strings.js';
import { PAL, BAYER4 } from '../engine/art/palette.js';
import { biomeArt, glyphSheet } from '../engine/art/atlas.js';
import { previewSurface, PREVIEW_KEYS } from '../game/world/mapgen3.js';
import * as GRID from '../game/core/grid.js';
import { setMapSize } from '../game/core/grid.js';
import { FORTRESS_D, FORTRESS_ZS } from '../game/core/setup.js';
import * as WX from '../game/world/weather.js';
import { regionOpts } from '../game/realm/region.js';
import { cardFacts, localArea, compass } from '../game/realm/finder.js';
import { finderSession, renderFinder } from './finderui.js';
import { REALM_BIOMES } from '../data/realm/biomes.js';

const raf = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));
const land = () => typeof innerWidth === 'number' && innerWidth > innerHeight;

// ---- the preview (3.7): LRU of 4 ---------------------------------------------------------------------------------
const PV = new Map();
const PV_MAX = 4, HOLD_W = 128;
/** The colour-index plane of region (rx, ry)'s surface: { w, h, colour, ms }. Cached (LRU of 4). */
export function previewPlane(realm, rx, ry) {
  const key = `${realm.wid >>> 0}:${rx}:${ry}`;
  if (PV.has(key)) { const v = PV.get(key); PV.delete(key); PV.set(key, v); return v; }
  const t0 = performance.now();
  const o = regionOpts(realm, rx, ry);
  // previewSurface reads the live map shape: the hold's (128 x 128 x 20, surface 14) for the call, then the old one back
  const was = [GRID.W, GRID.H, GRID.D, GRID.zS];
  let p;
  try { setMapSize(HOLD_W, HOLD_W, FORTRESS_D, FORTRESS_ZS); p = previewSurface(o.seed, { region: o }); } finally { setMapSize(...was); }
  const v = { w: p.w, h: p.h, colour: p.colour, biome: realm.fields.biome[ry * realm.n + rx], ms: +(performance.now() - t0).toFixed(1) };
  PV.set(key, v);
  while (PV.size > PV_MAX) PV.delete(PV.keys().next().value);
  return v;
}
export const previewCacheKeys = () => [...PV.keys()];
const PK_COLOUR = Object.freeze({
  grass: PAL.moss2, meadow: PAL.moss3, dirt: PAL.umber2, sand: PAL.sand, rich: PAL.umber1, marsh: PAL.leaf, shallow: PAL.shallow, deep: PAL.deep,
  ice: PAL.frost, tree: PAL.moss0, bush: PAL.moss1, rock1: PAL.stone0, rock2: PAL.stone1, rock3: PAL.slate2, rock4: PAL.slate3, rock5: PAL.mist,
  ramp: PAL.tan, ravine: PAL.ink, blight: PAL.plum1, hearth: PAL.flame, other: PAL.slate1,
});
const rgbOf = (hex) => { const v = parseInt(String(hex).slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const PK_RGB = PREVIEW_KEYS.map((k) => rgbOf(PK_COLOUR[k] || PAL.slate1));
const PK_BIOME = Object.freeze({ grass: 1, meadow: 2, bush: 0 });   // these keys take the biome's map ramp (atlas.js)
function paintPreview(cv, pv) {
  cv.width = pv.w; cv.height = pv.h;
  const g = cv.getContext('2d'), img = g.createImageData(pv.w, pv.h), d = img.data, r = biomeArt(pv.biome).r;
  const pal = PREVIEW_KEYS.map((k, n) => (PK_BIOME[k] !== undefined ? rgbOf(r[PK_BIOME[k]]) : PK_RGB[n]));
  for (let c = 0; c < pv.w * pv.h; c++) { const col = pal[pv.colour[c]] || PK_RGB[PK_RGB.length - 1], o = c * 4; d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255; }
  g.putImageData(img, 0, 0);
}

// ---- the neighbour thumbnails: 24 x 24 px, shown at 72 pt ------------------------------------------------------
const TH = 24;
const EDGE = { n: [12, 0], s: [12, 23], e: [23, 12], w: [0, 12] };
function paintThumb(cv, cell) {
  cv.width = TH; cv.height = TH;
  const g = cv.getContext('2d');
  if (!cell.inside) { g.fillStyle = PAL.ink; g.fillRect(0, 0, TH, TH); return; }
  const art = biomeArt(cell.sea ? 0 : cell.biome), r = art.r;
  g.fillStyle = r[2]; g.fillRect(0, 0, TH, TH);
  g.fillStyle = r[1];
  for (let y = 0; y < TH; y++) for (let x = 0; x < TH; x++) if (BAYER4[(y & 3) * 4 + (x & 3)] < 3) g.fillRect(x, y, 1, 1);
  if (cell.side) {   // a shade on the massif side
    g.fillStyle = r[0];
    const s = cell.side, k = 4;
    if (s === 'n') g.fillRect(0, 0, TH, k); else if (s === 's') g.fillRect(0, TH - k, TH, k); else if (s === 'e') g.fillRect(TH - k, 0, k, TH); else g.fillRect(0, 0, k, TH);
  }
  const gs = glyphSheet(), kinds = art.glyphs;
  g.drawImage(gs.canvas, gs.at[kinds[0]], 0, 8, 8, 3, 4, 8, 8);
  g.drawImage(gs.canvas, gs.at[kinds[kinds.length - 1]], 0, 8, 8, 13, 12, 8, 8);
  if (cell.lake) { g.fillStyle = PAL.water; g.fillRect(9, 9, 6, 5); }
  if (cell.river) {   // river in and out: a 2 px line through the middle, an arrow head at the exit
    g.fillStyle = PAL.shallow;
    const line = (a, b) => { const [x0, y0] = a, [x1, y1] = b, n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1; for (let i = 0; i <= n; i++) { const x = Math.round(x0 + ((x1 - x0) * i) / n), y = Math.round(y0 + ((y1 - y0) * i) / n); g.fillRect(x - 1, y - 1, 2, 2); } };
    line(EDGE[cell.river.in], [12, 12]); line([12, 12], EDGE[cell.river.out]);
    g.fillStyle = PAL.bone;
    const [ex, ey] = EDGE[cell.river.out], dx = Math.sign(ex - 12), dy = Math.sign(ey - 12), bx = ex - dx * 3, by = ey - dy * 3;
    g.fillRect(bx - (dy ? 2 : 0), by - (dx ? 2 : 0), dy ? 5 : 1, dx ? 5 : 1);
    g.fillRect(ex - dx - (dy ? 1 : 0), ey - dy - (dx ? 1 : 0), dy ? 3 : 1, dx ? 3 : 1);
  }
}

// ---- words ---------------------------------------------------------------------------------------------------------
const summerWord = (c) => (c < 10 ? 'cool' : c < 20 ? 'mild' : c < 28 ? 'warm' : 'hot');
const winterWord = (c) => (c < -10 ? 'bitter' : c < 0 ? 'hard' : c < 6 ? 'cold' : 'mild');
const FRONT_SEASON = Object.freeze({ fog: 'thaw', snow: 'deepcold', drought: 'highsun', ashfall: 'ashfall', storm: 'highsun', blizzard: 'deepcold' });
const BLOCK_KEY = Object.freeze({ sea: 'card.why.sea', peak: 'card.why.peak', edge: 'card.why.edge', site: 'card.why.site', used: 'card.why.used', reach: 'card.why.reach' });
/** The season means and growing season of a region climate (weather.js climateTable when present, else mean +- amp). */
function climateNumbers(c) {
  if (typeof WX.climateTable === 'function') {
    const tb = WX.climateTable(c);
    return { summer: tb.points[1], winter: tb.points[3], grow: tb.grow.days };
  }
  return { summer: c.mean + c.amp, winter: c.mean - c.amp, grow: null };
}
/** A why-text for a Settle block code. */
export const blockText = (code) => (code ? t(BLOCK_KEY[code] || 'card.why.edge') : '');

// ---- the card --------------------------------------------------------------------------------------------------
const S = {
  h: { margin: '0', fontSize: 'var(--fs-3, 16px)', color: 'var(--brass-hi, #f0c86a)', lineHeight: '1.25' },
  sec: { margin: '6px 0 0', fontSize: 'var(--fs-2, 15px)', fontWeight: '650', color: 'var(--brass, #c9973e)', textTransform: 'none' },
  word: { fontSize: 'var(--fs-2, 15px)', color: 'var(--text, #f6ead2)', lineHeight: '1.3' },
  num: { fontSize: 'var(--fs-1, 14px)', color: 'var(--dim, #d3c3a3)', lineHeight: '1.25' },
};
const fact = (word, num, key) => h('div.ec-rc-fact', { 'data-fact': key || null, style: { display: 'flex', flexDirection: 'column', gap: '1px' } },
  h('span', { text: word, style: S.word }), num ? h('span', { text: num, style: S.num }) : null);
const section = (title, ...facts) => h('section.ec-rc-sec', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, h('h4', { text: title, style: S.sec }), ...facts);

/** The card body of (rx, ry): { el, cf, grid, big }. */
function cardBody(realm, rx, ry, { used, start, onPick, onPreview }) {
  const cf = cardFacts(realm, rx, ry, { used, start }), F = cf.facts;
  const el = h('div.ec-rcard', { dataset: { rx: String(rx), ry: String(ry), biome: F.biome, temp: String(F.temp), amp: String(F.amp), rain: String(F.rain),
    river: String(F.river), lake: F.lake ? '1' : '0', geo: F.geo, taint: String(F.taint), wild: String(F.wild), sea: F.sea ? '1' : '0', block: cf.block || '' },
  style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
  el.append(h('p', { text: F.desc, style: { margin: '0', ...S.word, color: 'var(--dim, #d3c3a3)' } }));
  // notes: unsettled world, a close neighbour, out of reach with an "alone" start
  if (!F.sea) {
    const R = cf.reach;
    if (R.unsettled) el.append(h('p.ec-rc-note', { text: t('card.note.unsettled'), style: { margin: '0', ...S.num } }));
    else if (R.alone) el.append(h('p.ec-rc-note', { text: t('card.note.alone'), style: { margin: '0', ...S.num, color: 'var(--ember, #f2a24a)' } }));
    if (cf.neighbours.some((x) => x.days <= 1.5)) el.append(h('p.ec-rc-note', { text: t('card.note.close'), style: { margin: '0', ...S.num } }));
  }
  // the 3 x 3 local area
  const grid = h('div.ec-rc-grid', { role: 'group', 'aria-label': t('card.local'), style: { display: 'grid', gridTemplateColumns: 'repeat(3, 72px)', gridTemplateRows: 'repeat(3, 72px)', gap: '4px', alignSelf: 'center', flex: 'none' } });
  let big = null;
  for (const cell of localArea(realm, rx, ry)) {
    const centre = !cell.dx && !cell.dy;
    const cv = h('canvas', { width: centre ? 128 : TH, height: centre ? 128 : TH, style: { width: '72px', height: '72px', imageRendering: 'pixelated', display: 'block', borderRadius: '4px' } });
    const dir = centre ? 'here' : compass(0, 0, cell.dx, cell.dy);
    const name = !cell.inside ? t('card.offMap') : cell.sea ? t('card.sea') : (REALM_NAME(cell.biome));
    const b = h('button.ec-rc-cell', { type: 'button', 'data-act': centre ? 'rc-preview' : `rc-nb-${cell.dx}-${cell.dy}`, 'aria-label': centre ? t('card.previewAria') : t('card.nbAria', { dir: t('card.nb.' + dir), name }),
      style: { width: '72px', height: '72px', padding: '0', border: centre ? '2px solid var(--brass-hi, #f0c86a)' : '1px solid var(--line-soft, rgba(201,151,62,0.32))', borderRadius: '6px', background: 'var(--well, #120f15)', overflow: 'hidden', boxSizing: 'border-box' } }, cv);
    if (centre) {
      cv.dataset.preview = 'pending';
      if (F.sea) { paintThumb(cv, cell); cv.dataset.preview = 'sea'; b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
      else raf(() => setTimeout(() => { if (!cv.isConnected) return; const pv = previewPlane(realm, rx, ry); paintPreview(cv, pv); cv.dataset.preview = 'ok'; cv.dataset.ms = String(pv.ms); if (big && big.isConnected) paintPreview(big.firstChild, pv); }, 0));
      onTap(b, () => { if (big && big.isConnected) { big.remove(); big = null; return; } big = bigPreview(realm, rx, ry); grid.after(big); if (onPreview) onPreview(); });
    } else {
      paintThumb(cv, cell);
      if (!cell.inside) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
      else onTap(b, () => onPick(cell.rx, cell.ry));
    }
    grid.append(b);
  }
  el.append(grid);
  if (F.sea) return { el, cf, grid };
  const G = cf.ground, C = climateNumbers(cf.opts.climate);
  // climate
  const fronts = cf.climate.fronts.map((k) => t('card.front.' + k, { season: t('card.season.' + (FRONT_SEASON[k] || 'thaw')) }));
  el.append(section(t('card.sec.climate'),
    fact(t('card.climate', { s: t('card.cls.summer.' + summerWord(C.summer)), w: t('card.cls.winter.' + winterWord(C.winter)) }), t('card.climateNum', { s: C.summer, w: C.winter }), 'climate'),
    fact(t('card.cls.rain.' + cf.climate.rain), t('card.rainNum', { n: F.rain }), 'rain'),
    C.grow !== null ? fact(C.grow ? t('card.grow', { n: C.grow }) : t('card.growNone'), t('card.growNum', { n: C.grow }), 'grow') : null,
    fact(fronts.length ? list(fronts) : t('card.frontsNone'), null, 'fronts')));
  // ground
  el.append(section(t('card.sec.ground'),
    fact(t('card.cls.aquifer.' + G.aquifer), t('card.aquiferNum', { n: G.aquiferPct }), 'aquifer'),
    fact(t('card.soil.' + G.soil), null, 'soil'),
    fact(t('card.massif', { side: t('card.side.' + G.side), thick: t('card.cls.massif.' + G.massif) }), t('card.massifNum', { n: G.massifPct, band: G.band }), 'massif'),
    fact(G.river ? t('card.river.' + G.river.cls, { from: t('card.side.' + cf.opts.river.in), to: t('card.side.' + cf.opts.river.out) }) : t('card.river.0'), null, 'river'),
    G.lake || G.coast ? fact(G.lake ? t('card.lake') : t('card.coast'), null, 'lake') : null));
  // stone and ore
  const stones = Object.values(cf.rock.stones || {}).flat();
  el.append(section(t('card.sec.rock'),
    fact(t('card.geo.' + cf.rock.geo), stones.length ? t('card.stones', { list: list(stones) }) : null, 'geo'),
    fact(list(cf.rock.ores.map((o) => t('card.ore.' + o.word, { ore: t('card.oreName.' + o.k) }))), null, 'ores')));
  // depth
  el.append(section(t('card.sec.depth'),
    fact(cf.depth.shallow ? t('card.emberShallow') : t('card.emberDeep'), t('card.emberNum', { n: -cf.depth.rel }), 'ember'),
    fact(t('card.cav.' + cf.depth.caverns), null, 'caverns')));
  // danger
  const D = cf.danger;
  el.append(section(t('card.sec.danger'),
    fact(t('card.cls.hollow.' + D.hollow), t('card.hollowNum', { n: F.taint }), 'hollow'),
    fact(t('card.cls.wild.' + D.wild), t('card.wildNum', { n: F.wild }), 'wild'),
    D.lean ? fact(t('card.lean', { lean: D.lean }), null, 'lean') : null,
    ...D.lairs.map((b) => fact(t('card.lair', { name: b.name, n: b.d, dir: t('card.nb.' + b.dir) }), null, 'lair')),
    fact(D.enemies ? t('card.enemies', { n: D.enemies }) : t('card.enemiesNone'), null, 'enemies')));
  // neighbours and history (the W2 world is unsettled: W3 fills sites, civs and events)
  el.append(section(t('card.sec.neighbours'), ...(cf.neighbours.length
    ? cf.neighbours.map((x) => fact(t('card.site', { name: x.name, civ: x.civ || t('card.nobody') }), t('card.siteNum', { people: x.people || t('card.nobody'), n: Number.isFinite(x.days) ? Math.round(x.days) : '-' }), 'site'))
    : [fact(t('card.noSites'), null, 'sites')])));
  el.append(section(t('card.sec.history'), ...(cf.history.length ? cf.history.slice(0, 3).map((e) => fact(e.text || '', e.year !== undefined ? t('card.year', { n: e.year }) : null, 'event')) : [fact(t('card.noHistory'), null, 'history')])));
  return { el, cf, grid };
}
const REALM_NAME = (b) => (REALM_BIOMES[b] ? REALM_BIOMES[b].name : '');

/** The 2 px preview (the large view): the centre's surface at 2 px a tile, inside the panel's width. */
function bigPreview(realm, rx, ry) {
  const cv = h('canvas', { width: 128, height: 128, style: { width: '100%', maxWidth: '256px', aspectRatio: '1 / 1', imageRendering: 'pixelated', display: 'block' } });
  const box = h('div.ec-rc-big', { 'data-preview': 'big', style: { alignSelf: 'center', width: '100%', maxWidth: '256px', flex: 'none' } }, cv);
  const key = `${realm.wid >>> 0}:${rx}:${ry}`;
  if (PV.has(key)) paintPreview(cv, previewPlane(realm, rx, ry));
  return box;
}

// ---- the panel ------------------------------------------------------------------------------------------------------
/** The embark map's panel (see the header). */
export function createRegionPanel(panel, realm, { map = null, used = [], start = null, onSettle = () => {}, onSelect = () => {} } = {}) {
  let mode = 'hint', sel = null, fs = null;
  const keepMax = panel.style.maxHeight;
  const detent = (large) => { if (!land()) panel.style.maxHeight = large ? '76%' : keepMax; };
  const para = (text, extra = {}) => h('p', { text, style: { margin: '0', fontSize: 'var(--fs-2, 15px)', color: 'var(--dim, #d3c3a3)', lineHeight: '1.35', ...extra } });
  const findBtn = (wide) => {
    const b = h('button.ec-btn', { type: 'button', 'data-act': 'find-site', 'aria-label': t('card.findAria'), style: wide ? { flex: 'none' } : { flex: 'none', width: 'auto', minHeight: '44px', padding: '0 12px' } },
      h('span.ec-btn-label', { text: t('card.find') }), wide ? h('span.ec-btn-sub', { text: t('card.findSub') }) : null);
    return onTap(b, () => api.finder());
  };
  const select = (rx, ry) => { sel = { rx, ry }; if (map) map.select(rx, ry, { reveal: true }); onSelect(rx, ry); api.show(rx, ry); };
  const api = {
    hint() {
      mode = 'hint'; detent(false); clear(panel);
      panel.append(para(t('embark.mapHint')), findBtn(true));
    },
    show(rx, ry) {
      mode = 'card'; sel = { rx, ry }; detent(false); clear(panel);
      const cf0 = { used, start };
      const body = cardBody(realm, rx, ry, { ...cf0, onPick: select });
      const F = body.cf.facts;
      const head = h('div.ec-rc-head', { style: { display: 'flex', alignItems: 'center', gap: '8px', flex: 'none' } },
        h('h3.ec-sub', { text: t('card.title', { name: F.name, x: rx, y: ry }), style: { ...S.h, flex: '1 1 auto', minWidth: '0' } }), findBtn(false));
      const parts = [head];
      if (fs && fs.active && fs.result.count) {
        const k = fs.at(rx, ry);
        const next = onTap(h('button.ec-btn', { type: 'button', 'data-act': 'next-match', style: { flex: 'none', width: 'auto', minHeight: '44px', padding: '0 12px' } }, h('span.ec-btn-label', { text: t('finder.next') })), () => { const m = fs.next(); if (m) select(m.rx, m.ry); });
        parts.push(h('div.ec-rc-match', { style: { display: 'flex', alignItems: 'center', gap: '8px', flex: 'none' } },
          h('span', { text: k >= 0 ? t('card.match', { k: k + 1, n: fs.result.count }) : t('card.notMatch', { n: fs.result.count }), style: { ...S.num, flex: '1 1 auto', minWidth: '0' } }), next));
      }
      const sc = h('div.ec-embark-scroll', { style: { flex: '0 1 auto', minHeight: '0', overflowY: 'auto', touchAction: 'pan-y', display: 'flex', flexDirection: 'column', gap: '8px' } }, body.el);
      const why = blockText(body.cf.block);
      const go = h('button.ec-btn.primary.ec-settle', { type: 'button', 'data-act': 'settle', style: { flex: 'none' } }, h('span.ec-btn-label', { text: t('embark.settle') }));
      if (why) { go.disabled = true; go.setAttribute('aria-disabled', 'true'); }
      onTap(go, () => onSettle(rx, ry));
      const foot = h('div.ec-rc-foot', { style: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 'none' } }, why ? para(why, { color: 'var(--ember, #f2a24a)' }) : null, go);
      panel.append(...parts, sc, foot);
    },
    finder() {
      mode = 'finder'; detent(true);
      if (!fs) fs = finderSession(realm, { used, start });
      renderFinder(panel, fs, {
        onClose: () => (sel ? api.show(sel.rx, sel.ry) : api.hint()),
        onNext: (m) => select(m.rx, m.ry),
        onChange: (r) => { if (map) map.setMatches(fs.active ? r.list : []); },
      });
    },
    state: () => ({ mode, sel: sel && { ...sel }, matches: fs ? fs.result.count : 0, k: fs ? fs.k : -1, active: !!(fs && fs.active), ms: fs ? fs.result.ms : 0 }),
    session: () => fs,
    destroy() { if (map) try { map.setMatches([]); } catch (_) { /* map gone */ } clear(panel); },
  };
  return api;
}

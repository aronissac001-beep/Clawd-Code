// Embark, first half (owner I; EMBERCROWN-WORLD.md 3.1, 3.5 item 2, 1.5, 8.3 WORLDS / CREATE WORLD / GENERATING,
// 9.2 World index; step W2.7a). Title > New hold > World > Map > (W2.7b: region card) > Start > Found now.
//   worldsView(ctx, mode)   the World step ('new': Quick start card first) or the Worlds screen ('manage'), drawn
//                           into the title's list: the saved worlds (from the world index, 9.2), each opens its map;
//                           Delete (refused while holds use it, then a second tap confirms and lists them); Create
//   openCreate(ctx)         the Create world sheet (1.5 fields), then the animated generation with Cancel
//   quickStart(ctx)         a Standard world from a random seed, stored, then quickPick's region, founded at once
//   The map screen          js/ui/worldmap.js with a selection strip and Settle here (disabled with a reason on sea,
//                           a peak or a region a hold of this world already uses), then the band sheet's Start
//                           segment: the starts.js presets with a fit word, and Found now (the preset's defaults).
//   ctx (front.js):         { api, root, status, busy(on), show(view), refresh(), pick: { difficulty, storyteller } }
//   Founding calls api.newColony({ seed: <hold seed G2>, name, start, difficulty, storyteller, realm, wid, rx, ry })
//   then notes the hold in the world index (noteHold) and api.enter(s). W2.8 makes foundColony read realm/rx/ry.
// Render-side only: generation reads no state and never touches s.rng (the realm is its own seeded generator).
// Strings: the 'embark.*' rows of strings-en.js.
import { h, clear, onTap } from './kit.js';
import { t } from './strings.js';
import { createWorldMap } from './worldmap.js';
import { createRegionPanel } from './regioncard.js';
import { PAL } from '../engine/art/palette.js';
import { biomeArt } from '../engine/art/atlas.js';
import { randomSeedText } from '../engine/rng.js';
import { createRealm, worldName, normalizeParams } from '../game/realm/gen.js';
import { decodeRecord } from '../game/realm/record.js';
import { holdSeed } from '../game/realm/region.js';
import { idx, inside, isEmbarkable, isSea, band, riverClass, isLake, startFits, biomeOf } from '../game/realm/query.js';
import { BAND } from '../game/realm/biomes.js';
import { SIZES, PARAM_ROWS, START_FIT } from '../data/realm/params.js';
import { all } from '../game/core/content.js';
import { writeRealm, readRealmBytes, listWorlds, readWorld, writeWorld, noteHold, deleteRealm, rebuildWorldIndex } from '../game/save/realmstore.js';

// t-keys: embark.*

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const raf = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));
const msg = (e) => (e && e.message ? e.message : String(e));
const sizeName = (n) => { for (const [k, v] of Object.entries(SIZES)) if (v === n) return k; return 'standard'; };
const land = () => typeof innerWidth === 'number' && innerWidth > innerHeight;

// ---- pure parts (tested by the worlds flow) --------------------------------------------------------------
/**
 * The Quick start region (3.1): the best embarkable Greenvale region (the W2 world has no civs yet, so "near a human
 * civ" waits for W3 and W2.7b's finder): a river first, a lake next, then low taint and wildness, near the middle.
 * Any embarkable region when no Greenvale is free. `used`: [[slot, rx, ry]]. Deterministic.
 */
export function quickPick(realm, used = []) {
  const n = realm.n, f = realm.fields, taken = new Set(used.map((u) => u[2] * n + u[1]));
  let best = null, bestS = -Infinity;
  for (let i = 0; i < n * n; i++) {
    if (!isEmbarkable(realm, i) || taken.has(i)) continue;
    const x = i % n, y = (i - x) / n, green = biomeOf(realm, i).id === 'greenvale';
    const s = (green ? 1000 : 0) + (startFits(realm, i, 'hearthwatch') ? 200 : 0) + (riverClass(realm, i) ? 60 + 10 * riverClass(realm, i) : 0)
      + (isLake(realm, i) ? 25 : 0) - f.taint[i] / 4 - f.wild[i] / 8 - (Math.abs(x - n / 2) + Math.abs(y - n / 2));
    if (s > bestS) { bestS = s; best = { rx: x, ry: y }; }
  }
  return best;
}
/** Why Settle here is off for region (rx, ry), or null: sea, a peak, not embarkable, or used by a hold of this world. */
export function settleBlock(realm, rx, ry, used = []) {
  if (!inside(realm, rx, ry)) return t('embark.why.edge');
  const i = idx(realm, rx, ry);
  if (isSea(realm, i)) return t('embark.why.sea');
  if (band(realm, i) === BAND.PEAK) return t('embark.why.peak');
  if (!isEmbarkable(realm, i)) return t('embark.why.edge');
  if (used.some((u) => u[1] === rx && u[2] === ry)) return t('embark.why.used');
  return null;
}
const NEED = { relief: 'embark.need.thick', deepSoil: 'embark.need.soil', water: 'embark.need.water', biomes: 'embark.need.biomes', civ: 'embark.need.civ' };
/** The Start segment rows (3.5 item 2): every starts.js preset with its fit word; fitting ones first. */
export function startRows(realm, rx, ry) {
  let starts = [];
  try { starts = all('start'); } catch (_) { starts = []; }
  const i = idx(realm, rx, ry);
  const rows = starts.map((st, k) => {
    const need = Object.keys(START_FIT[st.id] || {}).filter((x) => x !== 'civ');   // the civ part waits for W3
    const fits = START_FIT[st.id] ? startFits(realm, i, st.id) : true;
    const why = need.map((x) => t(NEED[x])).join(', ');
    return { id: st.id, name: st.name, text: st.text || '', hard: !!st.hard, def: !!st.default, k, fits,
      word: !fits ? t('embark.fit.not', { why }) : need.length ? t('embark.fit.good', { why }) : t('embark.fit.any') };
  });
  return rows.sort((a, b) => (b.fits - a.fits) || (b.def - a.def) || (a.hard - b.hard) || (a.k - b.k));
}

// ---- the frame log (oracle: no generation frame over 50 ms) ----------------------------------------------
const LOG = { frames: [], gaps: [], phases: [], runs: 0 };
/** The last generation's frame log: work ms per frame, rAF gaps, and the phases seen. */
export function embarkStats() {
  const max = (a) => a.reduce((m, x) => (x > m ? x : m), 0);
  return { runs: LOG.runs, frames: LOG.frames.slice(), gaps: LOG.gaps.slice(), phases: LOG.phases.slice(), maxMs: +max(LOG.frames).toFixed(2), maxGap: +max(LOG.gaps).toFixed(2) };
}

// ---- the preview canvas (generation) ---------------------------------------------------------------------
const rgbCache = new Map();
function rgb(hex) {
  let c = rgbCache.get(hex);
  if (!c) { const v = parseInt(String(hex).slice(1), 16); c = [(v >> 16) & 255, (v >> 8) & 255, v & 255]; rgbCache.set(hex, c); }
  return c;
}
const LAND_RAMP = [PAL.umber1, PAL.umber2, PAL.umber3, PAL.tan, PAL.bone];
/** Draw the world so far at 1 px a region: stage 0 land and sea, 1 rivers and lakes, 2 biomes. */
function drawPreview(cv, f, n, seaLevel, bands, stage) {
  if (!f || !f.elev || seaLevel === undefined) return;
  if (cv.width !== n) { cv.width = n; cv.height = n; }
  const g = cv.getContext('2d'), img = g.createImageData(n, n), d = img.data;
  const cuts = bands || [seaLevel, seaLevel + 40, seaLevel + 80, seaLevel + 120];
  for (let i = 0; i < n * n; i++) {
    const e = f.elev[i];
    let col;
    if (e < seaLevel) col = e < seaLevel - 24 ? PAL.deep : PAL.water;
    else if (stage >= 1 && f.flow && (f.flow[i] & 0x20)) col = PAL.water;
    else if (stage >= 1 && f.flow && ((f.flow[i] >> 3) & 3)) col = PAL.shallow;
    else if (stage >= 2 && f.biome) col = biomeArt(f.biome[i]).r[2];
    else col = LAND_RAMP[e >= cuts[3] ? 4 : e >= cuts[2] ? 3 : e >= cuts[1] ? 2 : e >= cuts[0] + 8 ? 1 : 0];
    const c = rgb(col), o = i * 4;
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}
const STAGE_OF = { plates: -1, elevation: 0, temperature: 0, rainfall: 0, drainage: 0, rivers: 1, geology: 1, biomes: 2, guarantees: 2 };

// ---- overlays (full screen over the title) ----------------------------------------------------------------
const PAD = { paddingTop: 'calc(var(--sa-t, 0px) + 8px)', paddingRight: 'calc(var(--sa-r, 0px) + 12px)', paddingBottom: 'calc(var(--sa-b, 0px) + 8px)', paddingLeft: 'calc(var(--sa-l, 0px) + 12px)' };
let overlay = null;
function openOverlay(ctx, kind) {
  closeOverlay();
  const el = h('div.ec-embark', { 'data-screen': kind, role: 'dialog', 'aria-modal': 'true', style: { position: 'absolute', inset: '0', zIndex: '8', display: 'flex', flexDirection: 'column', background: 'var(--bg, #16131b)', color: 'var(--text, #f6ead2)', boxSizing: 'border-box', overflow: 'hidden', ...PAD } });
  (ctx.root || document.body).append(el);
  overlay = { el, kind, destroy: [] };
  return overlay;
}
/** Tests: the open overlay's screen, map handle and realm (UI memory only). */
export const embarkDebug = () => (overlay ? { screen: overlay.kind, map: overlay.map || null, realm: overlay.realm || null, panel: overlay.panel || null } : null);
/** Close the embark overlay (the map, the sheet or the generation screen). */
export function closeOverlay() {
  if (!overlay) return;
  for (const f of overlay.destroy) { try { f(); } catch (_) { /* gone */ } }
  overlay.el.remove();
  overlay = null;
}
const btn = (spec, act, label, sub, fn, attrs = {}) => {
  const b = h('button.ec-btn' + spec, { type: 'button', 'data-act': act, ...attrs }, h('span.ec-btn-label', { text: label }), sub ? h('span.ec-btn-sub', { text: sub }) : null);
  if (fn) onTap(b, fn);
  return b;
};
const ibtn = (act, text, label, fn, style = {}) => onTap(h('button.ec-ibtn', { type: 'button', 'data-act': act, 'aria-label': label, style: { minWidth: '44px', minHeight: '44px', fontSize: 'var(--fs-3, 16px)', fontWeight: '650', flex: 'none', ...style } }, text), fn);
const bar = (...kids) => h('div.ec-embark-bar', { style: { display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px', flex: 'none' } }, ...kids);

// ---- the World step and the Worlds screen -------------------------------------------------------------------
/** Draw the World step ('new') or the Worlds screen ('manage') into ctx.list. */
export function worldsView(ctx, mode = 'new') {
  const { list, status } = ctx;
  list.append(h('h2.ec-title-h', { text: mode === 'new' ? t('embark.chooseWorld') : t('embark.worlds') }));
  if (mode === 'new') list.append(btn('.primary.ec-quick', 'quick', t('embark.quick'), t('embark.quickSub'), () => quickStart(ctx)));
  const box = h('div.ec-worlds', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, h('p.ec-title-more', { text: t('embark.reading') }));
  list.append(box,
    btn('.ec-create', 'create-world', t('embark.create'), t('embark.createSub'), () => openCreate(ctx)),
    btn('.ec-back', 'title-back', t('embark.back'), null, () => ctx.show('main')));
  const cards = (() => { try { return ctx.api.listColonies() || []; } catch (_) { return []; } })();
  const nameOf = (slot) => { const c = cards.find((x) => x.id === slot); return c ? c.name : null; };
  (async () => {
    let rows = await listWorlds();
    if (!rows.length && cards.some((c) => Number.isInteger(c.wid))) rows = await rebuildWorldIndex();
    if (!box.isConnected) return;
    clear(box);
    if (!rows.length) { box.append(h('p.ec-title-more', { text: t('embark.none') })); return; }
    for (const row of rows) {
      const holds = row.holds.filter((x) => nameOf(x[0]));
      const names = holds.map((x) => nameOf(x[0])).slice(0, 3).join(', ');
      const when = row.year ? t('embark.year', { n: row.year }) : t('embark.unsettled');
      const sub = [t('embark.size.' + sizeName(row.size)), when, holds.length ? t('embark.holds', { n: holds.length, names }) : t('embark.noHolds')].join(' · ');
      const open = btn('', 'world-open', row.name, sub, () => openWorld(ctx, row), { dataset: { wid: String(row.wid) } });
      Object.assign(open.style, { flex: '1 1 auto', minWidth: '0', textAlign: 'left' });
      const del = btn('.ec-world-del', 'world-delete', t('embark.del'), null, null, { 'aria-label': t('embark.delAria', { name: row.name }) });
      Object.assign(del.style, { flex: 'none', minWidth: '88px' });
      let disarm = null, force = false;
      onTap(del, async () => {
        const lab = del.querySelector('.ec-btn-label');
        if (del.dataset.sure !== '1') {
          del.dataset.sure = '1'; del.classList.add('bad'); lab.textContent = t('embark.delSure');
          status.textContent = t('embark.delWarn', { name: row.name });
          disarm = setTimeout(() => { delete del.dataset.sure; del.classList.remove('bad'); lab.textContent = t('embark.del'); force = false; }, 5000);
          return;
        }
        clearTimeout(disarm);
        try {
          const r = await deleteRealm(row.wid, { force });
          if (!r.deleted) {   // holds use it: say which, and the next tap deletes anyway (9.2)
            force = true;
            status.textContent = t('embark.delHolds', { names: r.holds.map((s) => nameOf(s) || s).join(', ') });
            disarm = setTimeout(() => { delete del.dataset.sure; del.classList.remove('bad'); lab.textContent = t('embark.del'); force = false; }, 5000);
            return;
          }
          status.textContent = t('embark.deleted', { name: row.name }); ctx.refresh();
        } catch (e) { status.textContent = t('embark.failed', { why: msg(e) }); }
      });
      box.append(h('div.ec-world-row', { style: { display: 'flex', gap: '8px', alignItems: 'stretch' } }, open, del));
    }
  })().catch((e) => { if (box.isConnected) { clear(box); box.append(h('p.ec-title-more', { text: t('embark.failed', { why: msg(e) }) })); } });
}

async function openWorld(ctx, row) {
  ctx.status.textContent = t('embark.opening', { name: row.name });
  try {
    const bytes = await readRealmBytes(row.wid);
    if (!bytes) { ctx.status.textContent = t('embark.missing'); return; }
    const realm = await decodeRecord(bytes);
    ctx.status.textContent = '';
    openMap(ctx, realm, row);
  } catch (e) { ctx.status.textContent = t('embark.missing'); }
}

// ---- Create world (1.5) ----------------------------------------------------------------------------------
const FIELDS = [['size', (v) => t('embark.size.' + v)], ['history', (v) => t('embark.yearsN', { n: v })], ['peoples', (v) => t('embark.v.' + v)],
  ['wildness', (v) => t('embark.v.' + v)], ['hollowing', (v) => t('embark.v.' + v)], ['sea', (v) => t(v === 'random' ? 'embark.v.random' : 'embark.v.sea' + v)]];
/** Open the Create world sheet. */
export function openCreate(ctx) {
  const o = openOverlay(ctx, 'create');
  const p = { seed: randomSeedText(), name: '', named: false };
  for (const k of Object.keys(PARAM_ROWS)) p[k] = PARAM_ROWS[k].def;
  p.name = worldName(p.seed);
  const body = h('div.ec-embark-body', { style: { flex: '1 1 auto', minHeight: '0', overflowY: 'auto', touchAction: 'pan-y', display: 'flex', flexDirection: 'column', gap: '6px', paddingBottom: '8px' } });
  const head = bar(ibtn('create-close', 'x', t('embark.close'), () => closeOverlay()),
    h('h2.ec-title-h', { text: t('embark.createTitle'), style: { margin: '0', flex: '1 1 auto' } }));
  const label = (text) => h('span.ec-embark-lab', { text, style: { flex: '0 0 76px', fontSize: 'var(--fs-2, 15px)', color: 'var(--dim, #d3c3a3)' } });
  const line = (...kids) => h('div.ec-embark-line', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0' } }, ...kids);
  const input = (act, val, max, set) => {
    const e = h('input.ec-copybox.ec-title-input', { type: 'text', maxlength: String(max), value: val, 'data-act': act, style: { flex: '1 1 auto', minWidth: '0', margin: '0', fontSize: 'var(--fs-3, 16px)' } });
    e.addEventListener('input', () => set(e.value));
    return e;
  };
  const nameIn = input('cw-name', p.name, 24, (v) => { p.name = v; p.named = true; });
  const seedIn = input('cw-seed', p.seed, 24, (v) => { p.seed = v; if (!p.named) { p.name = worldName(v || 1); nameIn.value = p.name; } });
  body.append(
    line(label(t('embark.f.name')), nameIn, ibtn('cw-name-new', '~', t('embark.reName'), () => { p.name = worldName(randomSeedText()); p.named = true; nameIn.value = p.name; })),
    line(label(t('embark.f.seed')), seedIn, ibtn('cw-seed-new', '~', t('embark.reSeed'), () => { p.seed = randomSeedText(); seedIn.value = p.seed; if (!p.named) { p.name = worldName(p.seed); nameIn.value = p.name; } })));
  for (const [k, word] of FIELDS) {
    const seg = h('div.ec-seg', { role: 'radiogroup', 'aria-label': t('embark.f.' + k), style: { flex: '1 1 auto', minWidth: '0', margin: '0' } });
    const paint = () => { for (const b of seg.children) { const on = b.dataset.v === String(p[k]); b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); } };
    for (const v of PARAM_ROWS[k].values) {
      const b = h('button.ec-seg-b', { type: 'button', role: 'radio', 'data-act': `cw-${k}-${v}`, dataset: { v: String(v) }, style: { flex: '1 1 auto', whiteSpace: 'nowrap' }, text: word(v) });
      onTap(b, () => { p[k] = v; paint(); });
      seg.append(b);
    }
    paint();
    body.append(line(label(t('embark.f.' + k)), seg));
  }
  const go = btn('.primary.ec-generate', 'cw-generate', t('embark.generate'), null, () => {
    const params = { seed: p.seed || randomSeedText(), name: (p.name || '').trim() };
    for (const k of Object.keys(PARAM_ROWS)) params[k] = p[k];
    generate(ctx, params, { then: 'map' });
  });
  Object.assign(go.style, { flex: 'none' });
  o.el.append(head, body, go);
}

// ---- generation (animated, with Cancel) ----------------------------------------------------------------
/**
 * Run createRealm one phase a frame, drawing the world as it forms; store it (read back and CRC-checked, 9.2); then
 * open the map (then 'map') or found at once on quickPick's region (then 'quick'). Cancel stops it: nothing stored.
 */
export function generate(ctx, rawParams, { then = 'map' } = {}) {
  const params = normalizeParams(rawParams);
  const o = openOverlay(ctx, 'gen');
  const run = { cancelled: false, stored: null };
  o.destroy.push(() => { run.cancelled = true; });
  const reduce = (() => { try { const s = ctx.api.readSettings ? ctx.api.readSettings() : null; return !!(s && s.reduceMotion) || matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } })();
  const cv = h('canvas.ec-gen-cv', { width: '1', height: '1', 'aria-hidden': 'true', style: { imageRendering: 'pixelated', background: PAL.deep, border: '1px solid var(--line, rgba(201,151,62,0.55))', borderRadius: '4px', flex: 'none' } });
  const phase = h('p.ec-gen-phase', { role: 'status', 'aria-live': 'polite', text: t('embark.ph.plates'), style: { margin: '0', fontSize: 'var(--fs-3, 16px)', color: 'var(--text, #f6ead2)' } });
  const fill = h('div.ec-gen-fill', { style: { height: '100%', width: '0%', background: 'var(--ember, #f2a24a)', borderRadius: '4px' } });
  const track = h('div.ec-gen-track', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', style: { flex: '1 1 auto', height: '14px', background: 'var(--well, rgba(8,6,10,0.28))', border: '1px solid var(--line-soft, rgba(201,151,62,0.32))', borderRadius: '5px', overflow: 'hidden' } }, fill);
  const pct = h('span.ec-gen-pct', { text: t('embark.pct', { n: 0 }), style: { flex: '0 0 auto', minWidth: '48px', textAlign: 'right', fontSize: 'var(--fs-2, 15px)', color: 'var(--dim, #d3c3a3)' } });
  const cancel = btn('.ec-gen-cancel', 'gen-cancel', t('embark.cancel'), null, () => {
    run.cancelled = true; closeOverlay(); ctx.status.textContent = t('embark.cancelled'); ctx.busy(false); ctx.refresh();
  });
  Object.assign(cancel.style, { flex: 'none', alignSelf: 'flex-end', minWidth: '120px' });
  const text = h('div.ec-gen-text', { style: { display: 'flex', flexDirection: 'column', gap: '10px', flex: '1 1 auto', minWidth: '0', justifyContent: 'center' } },
    h('h2.ec-title-h', { text: params.name, style: { margin: '0' } }), phase, h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, track, pct), cancel);
  const wrap = h('div.ec-gen', { style: { flex: '1 1 auto', minHeight: '0', display: 'flex', flexDirection: land() ? 'row' : 'column', alignItems: land() ? 'center' : 'stretch', justifyContent: 'center', gap: '14px' } }, cv, text);
  o.el.append(wrap);
  const fit = () => {
    const W = o.el.clientWidth - 24, H = o.el.clientHeight - 16;
    const side = Math.max(96, Math.floor(land() ? Math.min(H, W * 0.5) : Math.min(W, H - 190)));
    cv.style.width = side + 'px'; cv.style.height = side + 'px'; cv.style.alignSelf = 'center';
  };
  fit();
  const show = (key, frac) => {
    phase.textContent = t('embark.ph.' + key);
    const n = Math.max(0, Math.min(100, Math.round(frac * 100)));
    fill.style.width = n + '%'; pct.textContent = t('embark.pct', { n }); track.setAttribute('aria-valuenow', String(n));
  };
  LOG.frames = []; LOG.gaps = []; LOG.phases = []; LOG.runs++;
  ctx.busy(true);
  const it = createRealm(params);
  let last = now(), live = false, steps = 0;
  const N = SIZES[params.size];
  const step = () => {
    if (run.cancelled) return;
    const t0 = now();
    LOG.gaps.push(t0 - last);
    let r;
    try { r = it.next(); } catch (e) { closeOverlay(); ctx.busy(false); ctx.status.textContent = t('embark.failed', { why: msg(e) }); return; }
    steps++;
    if (!r.done) {
      const y = r.value;
      LOG.phases.push(y.phase);
      const f = y.fields || (y.rx && y.rx.f);   // a live field view when gen.js yields one (requested of L)
      if (f) { live = true; drawPreview(cv, f, N, y.seaLevel !== undefined ? y.seaLevel : y.rx && y.rx.seaLevel, y.bands || (y.rx && y.rx.bands), STAGE_OF[y.phase] || 0); }
      show(y.phase, Math.min(0.9, (0.9 * steps) / y.of));
      last = now(); LOG.frames.push(last - t0);
      raf(step);
      return;
    }
    const realm = r.value;
    LOG.frames.push(now() - t0);
    reveal(realm);
  };
  // without a live field view the finished world is shown phase by phase: land, rivers, biomes
  const reveal = (realm) => {
    const stages = live ? [2] : [0, 1, 2];
    let k = 0;
    const next = () => {
      if (run.cancelled) return;
      const t0 = now();
      LOG.gaps.push(t0 - last);
      drawPreview(cv, realm.fields, realm.n, realm.seaLevel, realm.bands, stages[k]);
      LOG.frames.push(now() - t0); last = now();
      k++;
      if (k < stages.length) setTimeout(() => { last = now(); raf(next); }, reduce ? 0 : 260);   // the pause is not a frame
      else { show('storing', 0.95); setTimeout(() => store(realm), reduce ? 0 : 200); }
    };
    raf(next);
  };
  const store = async (realm) => {
    if (run.cancelled) return;
    try {
      const had = await readRealmBytes(realm.wid);
      if (!had) { run.stored = realm.wid; await writeRealm(realm); }
      const row = (await readWorld(realm.wid)) || (await writeWorld({ wid: realm.wid, name: realm.params.name, size: realm.n, year: realm.year | 0, holds: [] }));
      if (run.cancelled) {   // Cancel came during the write: take the new record out again
        if (run.stored !== null) await deleteRealm(realm.wid, { force: false }).catch(() => null);
        return;
      }
      show('storing', 1);
      ctx.busy(false);
      if (then === 'quick') {
        const at = quickPick(realm, row.holds);
        if (!at) { openMap(ctx, realm, row); return; }
        const rows = startRows(realm, at.rx, at.ry);
        const st = rows.find((x) => x.def && x.fits) || rows.find((x) => x.fits) || rows[0];
        phase.textContent = t('embark.ph.carving');
        cancel.disabled = true;
        found(ctx, realm, row, at.rx, at.ry, st ? st.id : null);
      } else openMap(ctx, realm, row);
    } catch (e) { closeOverlay(); ctx.busy(false); ctx.status.textContent = t('embark.failed', { why: msg(e) }); }
  };
  raf(step);
}

/** Quick start (3.1): a Standard world from a random seed, then found at once on its best mild valley. */
export function quickStart(ctx) {
  const room = ctx.api.colonyRoom ? ctx.api.colonyRoom() : null;
  if (room) { ctx.status.textContent = room; return; }
  generate(ctx, { seed: randomSeedText(), size: 'standard' }, { then: 'quick' });
}

// ---- the map, the selection strip and the Start segment ------------------------------------------------------
function openMap(ctx, realm, row) {
  const o = openOverlay(ctx, 'map');
  const used = (row && row.holds) || [];
  const back = ibtn('map-back', '<', t('embark.back'), () => { closeOverlay(); ctx.refresh(); });
  const sub = row && row.year ? t('embark.year', { n: row.year }) : t('embark.unsettled');
  const titleBox = h('div', { style: { flex: '0 0 auto', maxWidth: land() ? '30%' : 'calc(100% - 60px)', minWidth: '0', display: 'flex', flexDirection: 'column' } },
    h('span.ec-embark-name', { text: realm.params.name, style: { fontSize: 'var(--fs-3, 16px)', fontWeight: '650', color: 'var(--brass-hi, #f0c86a)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }),
    h('span', { text: sub, style: { fontSize: 'var(--fs-1, 14px)', color: 'var(--dim, #d3c3a3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }));
  const top = bar(back, titleBox);
  const isLand = land();
  const body = h('div.ec-embark-main', { style: { flex: '1 1 auto', minHeight: '0', display: 'flex', flexDirection: isLand ? 'row' : 'column', gap: '8px' } });
  const host = h('div.ec-embark-map', { style: { position: 'relative', flex: '1 1 auto', minHeight: '0', minWidth: '0', borderRadius: '6px', overflow: 'hidden' } });
  const panel = h('div.ec-embark-panel', { style: { flex: isLand ? '0 0 45%' : '0 0 auto', maxHeight: isLand ? 'none' : '58%', minHeight: '0', minWidth: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', boxSizing: 'border-box', background: 'var(--panel, rgba(30,25,29,0.96))', border: '1px solid var(--line-soft, rgba(201,151,62,0.32))', borderRadius: '10px' } });
  body.append(host, panel);
  o.el.append(top, body);
  const settings = () => { try { const s = ctx.api.readSettings ? ctx.api.readSettings() : null; return s ? { reduceMotion: !!s.reduceMotion, batterySaver: !!s.batterySaver } : null; } catch (_) { return null; } };
  let sel = null;
  const map = createWorldMap(host, realm, { chipsInto: isLand ? top : null, settings, onSelect: (rx, ry) => { sel = { rx, ry }; strip(); } });
  o.destroy.push(() => map.destroy());
  o.map = map; o.realm = realm;
  const para = (text, extra = {}) => h('p', { text, style: { margin: '0', fontSize: 'var(--fs-2, 15px)', color: 'var(--dim, #d3c3a3)', lineHeight: '1.35', ...extra } });
  // the panel: a scrolling part and a footer that always shows its action (the band's Found now on a 335 pt screen)
  const scroller = () => h('div.ec-embark-scroll', { style: { flex: '0 1 auto', minHeight: '0', overflowY: 'auto', touchAction: 'pan-y', display: 'flex', flexDirection: 'column', gap: '8px' } });
  // the region card and the site finder (W2.7b, js/ui/regioncard.js)
  const rp = createRegionPanel(panel, realm, { map, used, onSettle: () => bandSheet(), onSelect: (rx, ry) => { sel = { rx, ry }; } });
  o.destroy.push(() => rp.destroy());
  o.panel = rp;
  function strip() { if (!sel) rp.hint(); else rp.show(sel.rx, sel.ry); }
  function bandSheet() {
    clear(panel);
    const rows = startRows(realm, sel.rx, sel.ry);
    let pick = (rows.find((x) => x.def && x.fits) || rows.find((x) => x.fits) || rows[0] || {}).id || null;
    const head = h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flex: 'none' } },
      ibtn('band-back', '<', t('embark.back'), () => strip()),
      h('span', { text: t('embark.band'), style: { fontSize: 'var(--fs-3, 16px)', fontWeight: '650', flex: '1 1 auto' } }),
      h('div.ec-seg', { role: 'tablist', style: { margin: '0', flex: '0 0 auto' } }, h('button.ec-seg-b.on', { type: 'button', role: 'tab', 'aria-selected': 'true', 'data-act': 'seg-start', text: t('embark.seg.start'), style: { padding: '0 14px' } })));
    const listEl = h('div', { role: 'radiogroup', 'aria-label': t('embark.startH'), style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    const paint = () => { for (const b of listEl.children) { const on = b.dataset.id === pick; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.style.borderColor = on ? 'var(--brass-hi, #f0c86a)' : ''; } };
    for (const r of rows) {
      const b = h('button.ec-btn.ec-start-row', { type: 'button', role: 'radio', 'data-act': 'start-' + r.id, dataset: { id: r.id }, style: { textAlign: 'left' } },
        h('span.ec-btn-label', { text: r.name + (r.hard ? ' · ' + t('embark.hard') : '') }),
        h('span.ec-btn-sub', { text: r.word, style: { color: r.fits ? 'var(--dim, #d3c3a3)' : 'var(--faint, #b1a48e)' } }));
      if (!r.fits) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
      onTap(b, () => { pick = r.id; paint(); });
      listEl.append(b);
    }
    paint();
    const go = btn('.primary.ec-found-now', 'found-now', t('embark.foundNow'), t('embark.foundSub'), () => { go.disabled = true; found(ctx, realm, row, sel.rx, sel.ry, pick); });
    Object.assign(go.style, { flex: 'none' });
    const sc = scroller(); sc.append(listEl);
    panel.append(head, sc, go);
  }
  strip();
}

// ---- founding --------------------------------------------------------------------------------------------
/** Found the hold in region (rx, ry) with start `start`, note it in the world index and enter it. */
function found(ctx, realm, row, rx, ry, start) {
  const room = ctx.api.colonyRoom ? ctx.api.colonyRoom() : null;
  if (room) { closeOverlay(); ctx.busy(false); ctx.status.textContent = room; return; }
  ctx.status.textContent = t('embark.ph.carving');
  const pick = ctx.pick || {};
  const opts = { seed: String(holdSeed(realm, rx, ry)), name: pick.name || undefined, start, difficulty: pick.difficulty || null, storyteller: pick.storyteller || null, realm, wid: realm.wid, rx, ry };
  // paint "Carving the hold" before mapgen3 runs (two frames)
  raf(() => raf(async () => {
    try {
      const s0 = await ctx.api.newColony(opts);
      if (s0 && s0.id) await noteHold(realm.wid, s0.id, rx, ry, { name: realm.params.name, size: realm.n, year: (row && row.year) | 0 }).catch(() => null);
      closeOverlay();
      ctx.status.textContent = '';
      ctx.entered();
      ctx.api.enter(s0);
    } catch (e) { closeOverlay(); ctx.busy(false); ctx.status.textContent = t('embark.failed', { why: msg(e) }); }
  }));
}

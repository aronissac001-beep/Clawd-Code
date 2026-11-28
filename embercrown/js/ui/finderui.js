// The site finder sheet (owner I; EMBERCROWN-WORLD.md 3.4, G8; step W2.7b). Filter rows as 44 pt segmented
// controls and chip strips, about 8 rows visible and scrolling; a live count; every match pinned on the map;
// Next match walks the matches in score order. js/game/realm/finder.js does the scoring (pure, < 1 ms a pass).
//   const fs = finderSession(realm, { used, wid })   the filters (remembered per world in localStorage, a
//                                                   convenience only) and the current matches
//     fs.filters / fs.result / fs.set(id, value) / fs.toggle(id, opt) / fs.reset() / fs.next() / fs.at(rx, ry)
//   renderFinder(host, fs, { onClose, onNext, onChange })   draw the sheet into host (the embark panel)
// Render-side only: reads the realm, never game state or s.rng. Strings: the 'finder.*' rows of strings-en.js.
// t-keys: finder.row.* finder.opt.* finder.aria.*
import { h, clear, onTap } from './kit.js';
import { t } from './strings.js';
import { FILTERS, defaultFilters, cleanFilters, findSites } from '../game/realm/finder.js';
import { REALM_BIOMES, BIOME_INDEX } from '../data/realm/biomes.js';
import { all } from '../game/core/content.js';

const KEY = (wid) => 'ec.finder.' + (wid >>> 0);
function readStored(wid) { try { const v = localStorage.getItem(KEY(wid)); return v ? cleanFilters(JSON.parse(v)) : defaultFilters(); } catch (_) { return defaultFilters(); } }
function store(wid, F) { try { localStorage.setItem(KEY(wid), JSON.stringify(F)); } catch (_) { /* private mode: the filters are a convenience */ } }
const isDefault = (F) => JSON.stringify(F) === JSON.stringify(defaultFilters());

/** The starts the Start fit row offers: the starts.js presets that have a fit row (3.8). */
export function fitStarts() {
  let rows = [];
  try { rows = all('start'); } catch (_) { rows = []; }
  const ok = FILTERS.find((r) => r.id === 'fit').opts;
  return rows.filter((s) => ok.includes(s.id)).map((s) => ({ id: s.id, name: s.name }));
}

/** A finder session over one realm. */
export function finderSession(realm, { used = [], wid = realm.wid, start = null } = {}) {
  const fs = {
    realm, used, start, filters: readStored(wid), result: { list: [], count: 0, ms: 0 }, k: -1, active: false,
    run() { const t0 = performance.now(); fs.result = findSites(realm, fs.filters, { used, start: fs.filters.fit || start }); fs.result.ms = +(performance.now() - t0).toFixed(3); fs.active = !isDefault(fs.filters); fs.k = -1; store(wid, fs.filters); return fs.result; },
    set(id, v) { fs.filters = cleanFilters({ ...fs.filters, [id]: v }); return fs.run(); },
    toggle(id, opt) { const cur = fs.filters[id] || []; return fs.set(id, cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt]); },
    reset() { fs.filters = defaultFilters(); return fs.run(); },
    /** The next match in score order (wraps), or null. */
    next() { const L = fs.result.list; if (!L.length) return null; fs.k = (fs.k + 1) % L.length; return L[fs.k]; },
    /** The position of (rx, ry) among the matches (and the cursor moves there), or -1. */
    at(rx, ry) { const k = fs.result.list.findIndex((m) => m.rx === rx && m.ry === ry); if (k >= 0) fs.k = k; return k; },
  };
  fs.run();
  return fs;
}

const ROW_STYLE = { display: 'flex', alignItems: 'center', gap: '8px', minHeight: '48px', flex: 'none' };
const LABEL_STYLE = { flex: '0 0 84px', fontSize: 'var(--fs-2, 15px)', color: 'var(--dim, #d3c3a3)', lineHeight: '1.2' };
/** One segmented control (one choice). */
function seg(id, opts, cur, pick) {
  const box = h('div.ec-seg', { role: 'radiogroup', 'aria-label': t('finder.row.' + id), style: { margin: '0', flex: '1 1 auto', minWidth: '0' } });
  for (const o of opts) {
    const on = cur === o;
    const b = h('button.ec-seg-b' + (on ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', 'data-act': `fd-${id}-${o}`,
      'aria-label': t('finder.aria.' + id + '.' + o), text: t('finder.opt.' + id + '.' + o), style: { minWidth: '44px', fontSize: 'var(--fs-1, 14px)', lineHeight: '1.1' } });
    onTap(b, () => pick(o));
    box.append(b);
  }
  return box;
}
/** One chip strip (several choices), scrolling sideways inside its row. */
function chips(id, items, cur, pick) {
  const box = h('div.ec-fd-chips', { role: 'group', 'aria-label': t('finder.row.' + id), style: { display: 'flex', gap: '6px', overflowX: 'auto', touchAction: 'pan-x', flex: '1 1 auto', minWidth: '0', paddingBottom: '2px' } });
  for (const it of items) {
    const on = cur.includes(it.id);
    const b = h('button.ec-chip' + (on ? '.on' : ''), { type: 'button', 'aria-pressed': on ? 'true' : 'false', 'data-act': `fd-${id}-${it.id}`, text: it.name,
      style: { flex: 'none', minHeight: '44px', minWidth: '44px', padding: '0 12px', fontSize: 'var(--fs-2, 15px)', borderColor: on ? 'var(--brass-hi, #f0c86a)' : '', color: on ? 'var(--brass-hi, #f0c86a)' : '' } });
    onTap(b, () => pick(it.id));
    box.append(b);
  }
  return box;
}

/** Draw the finder sheet into host. opts: { onClose(), onNext(match), onChange(result) }. */
export function renderFinder(host, fs, { onClose = () => {}, onNext = () => {}, onChange = () => {} } = {}) {
  clear(host);
  const head = h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flex: 'none' } });
  const back = onTap(h('button.ec-ibtn', { type: 'button', 'data-act': 'fd-close', 'aria-label': t('finder.close'), text: '<', style: { minWidth: '44px', minHeight: '44px', fontSize: 'var(--fs-3, 16px)', fontWeight: '650', flex: 'none' } }), () => onClose());
  const reset = onTap(h('button.ec-btn', { type: 'button', 'data-act': 'fd-reset', style: { flex: 'none', minHeight: '44px', width: 'auto', padding: '0 12px' } }, h('span.ec-btn-label', { text: t('finder.reset') })), () => { fs.reset(); draw(); onChange(fs.result); });
  head.append(back, h('span', { text: t('finder.title'), style: { fontSize: 'var(--fs-3, 16px)', fontWeight: '650', flex: '1 1 auto', color: 'var(--brass-hi, #f0c86a)' } }), reset);
  const rows = h('div.ec-fd-rows', { style: { flex: '1 1 auto', minHeight: '0', overflowY: 'auto', touchAction: 'pan-y', display: 'flex', flexDirection: 'column', gap: '4px' } });
  const count = h('div.ec-fd-count', { role: 'status', 'aria-live': 'polite', style: { fontSize: 'var(--fs-2, 15px)', color: 'var(--text, #f6ead2)', flex: '1 1 auto', minWidth: '0' } });
  const next = onTap(h('button.ec-btn.primary', { type: 'button', 'data-act': 'fd-next', style: { flex: 'none', width: 'auto', minHeight: '44px', padding: '0 16px' } }, h('span.ec-btn-label', { text: t('finder.next') })), () => { const m = fs.next(); if (m) onNext(m); });
  const foot = h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flex: 'none' } }, count, next);
  host.append(head, rows, foot);
  const biomes = FILTERS.find((r) => r.id === 'biomes').opts.map((id) => ({ id, name: REALM_BIOMES[BIOME_INDEX[id]].name }));
  const ores = FILTERS.find((r) => r.id === 'ores').opts.map((id) => ({ id, name: t('finder.opt.ores.' + id) }));
  const starts = fitStarts();
  function draw() {
    const F = fs.filters, keep = rows.scrollTop;
    clear(rows);
    const change = (fn) => () => { fn(); draw(); onChange(fs.result); };
    for (const row of FILTERS) {
      let ctl;
      if (row.id === 'biomes') ctl = chips('biomes', biomes, F.biomes, (id) => change(() => fs.toggle('biomes', id))());
      else if (row.id === 'ores') ctl = chips('ores', ores, F.ores, (id) => change(() => fs.toggle('ores', id))());
      else if (row.id === 'fit') ctl = chips('fit', [{ id: 'any', name: t('finder.opt.fit.any') }, ...starts], [F.fit || 'any'], (id) => change(() => fs.set('fit', id === 'any' ? null : id))());
      else ctl = seg(row.id, row.opts, F[row.id], (o) => change(() => fs.set(row.id, o))());
      rows.append(h('div.ec-fd-row', { 'data-row': row.id, style: ROW_STYLE }, h('span', { text: t('finder.row.' + row.id), style: LABEL_STYLE }), ctl));
    }
    rows.scrollTop = keep;
    const n = fs.result.count;
    count.textContent = n ? t('finder.count', { n }) : t('finder.none');
    next.disabled = !n; if (!n) next.setAttribute('aria-disabled', 'true'); else next.removeAttribute('aria-disabled');
  }
  draw();
  onChange(fs.result);
  return { draw };
}

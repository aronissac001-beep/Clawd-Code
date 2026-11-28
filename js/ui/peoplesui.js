// Peoples and factions (owner I; EMBERCROWN-WORLD.md 8.1 bar slot 5, 8.5, 4.4, 2.7; step W3.9). One card per civ:
// crest, people, standing bar (-100..+100), ethic summary and refused goods, oath, open demands with their
// deadlines, the last caravan and the next one expected. Also the World map tab's model: the hold's liege, its 6
// nearest neighbours with travel days, the caravan routes and the wars now (worldui.js draws them).
// Pure reads. The hold's realm record comes from annals.js holdRealm (the UI's copy); the sim's helpers in
// factions.js and caravans.js read it through a shadow of the state (shadowOf: s.rt.realm = the record, and the
// roles bound as the sim will bind them when the save has not bound them yet), so nothing here writes the state.
//   realmView(s, R)               { home, liege, bind, rows, wars, sources, routes, days(x, y), sh } (cached per tick)
//   peoplesView(el, ctx, R, opt)  the Peoples tab: the cards, the fallen civs; opt.showSite(rx, ry), opt.open(key)
//   civCard(ctx, R, id, opt)      one civ's card (also the page a neighbour row pushes)
//   openCivPage(ctx, R, id, opt)  push "World / <civ>" with the card, Show on map and Annals
//   crestCanvas(civ, k)           the civ's crest: a 12 x 14 pixel shield baked once, k CSS px per pixel
// Strings: PEOPLES_TEXT below until the 'world.peoples.*' rows land in strings-en.js (G25; see the W3.9 report).
import { h, onTap } from './kit.js';
import { def } from '../game/core/content.js';
import { TICKS_PER_DAY } from '../game/core/time.js';
import { PAL } from '../engine/art/palette.js';
import { TINCTURES } from '../engine/art/atlas.js';
import { ETHIC_AXES } from '../data/realm/ethics.js';
import { CIVKINDS } from '../data/realm/civkinds.js';
import { WORLD_TEXT as WT, civName, civText, peopleWord, oathText, yearText, warName, CIVKIND_WORDS, SITE_WORDS } from '../data/text/realm.js';
import { realmRec, sitesNow, bindRoles, factionOfCiv, goodwill, standingOf, civOfFaction, ROLE_IDS } from '../game/colony/factions.js';
import { caravanSources, cadenceDays, REALM_CARAVAN, atWarWithLiege } from '../game/colony/caravans.js';
import { isSea, riverClass, band } from '../game/realm/query.js';
import { BAND } from '../game/realm/biomes.js';
import { DX, DY } from '../game/realm/fields.js';

export const PEOPLES_TEXT = Object.freeze({
  tab: 'Peoples',
  intro: 'Every civilization of the world: how it stands with the hold, what it believes and refuses, its oath, what it asks and when its caravans come.',
  neighbours: 'Neighbours', news: 'News', noNews: 'No wars are being fought in the world now.',
  liege: 'Liege', atWar: 'At war', fallenHead: (n) => `Fallen (${n})`,
  days: (d) => (d === Infinity || d === null ? 'over the sea' : `${d} ${d === 1 ? 'day' : 'days'}`),
  nbSub: (rel, g, d) => `${rel} \u00b7 ${g > 0 ? '+' : ''}${g} \u00b7 ${d}`,
  nbName: (site, civ) => `${site}, ${civ}`,
  standing: (word, g) => `Standing: ${word} ${g > 0 ? '+' : ''}${g}`,
  strong: (list) => `Holds hard to: ${list}.`, leans: (list) => `Leans to: ${list}.`, noEthic: 'Holds no strong beliefs.',
  refuses: (list) => `Will not buy ${list}.`,
  oath: (o) => `Its oath: ${o}.`,
  demand: (n, what, day) => `Asks for ${n} ${what} by day ${day}.`, noDemand: 'Asks nothing of the hold now.',
  here: (site) => `A caravan from ${site} is at the hold now.`,
  next: (site, d, days) => `Caravans come from ${site}, ${days} away; the next in about ${d} ${d === 1 ? 'day' : 'days'}.`,
  nextDue: (site, days) => `Caravans come from ${site}, ${days} away; one is due now.`,
  last: (d) => (d <= 0 ? 'The last one came today.' : `The last one came ${d} ${d === 1 ? 'day' : 'days'} ago.`),
  firstCaravan: 'None has come yet.',
  warNoTrade: 'At war with your liege: no caravans.',
  farTrade: (r) => `No town of theirs lies within ${r} days: no caravans.`,
  coldTrade: 'Too unfriendly to send caravans.',
  fell: (y) => `Fell in ${yearText(y)}.`,
  showOnMap: 'Show on map', annals: 'Annals',
  homeRow: 'Your hold', crest: (n) => `Crest of ${n}`,
  noLiege: 'The hold has no liege.',
  civSub: (people, kind) => `${people} ${kind}`.trim(),
  war: (name, liege) => `War: ${name}${liege ? ' (your liege)' : ''}`, warSince: (y) => `Since ${yearText(y)}`,
});
const P = PEOPLES_TEXT;

/** The ethic words (4.4): [the minus side, the plus side]. */
const ETHIC_WORDS = Object.freeze({
  trees: ['old trees are timber', 'old trees are sacred'], deep: ['deep digging is a disturbance', 'deep digging is holy work'],
  fire: ['flame is dangerous', 'flame is honoured'], water: ['water is a resource', 'still water is sacred'],
  beasts: ['beasts are quarry', 'beasts are kin'], dead: ['the dead are nothing', 'the dead must be honoured'],
  coin: ['trade is a vice', 'trade is a virtue'], law: ['freedom over law', 'order and oaths'],
});
/** Goods refused at +2 (4.4 Refusals). */
const REFUSED = Object.freeze({ trees: 'old-growth timber', water: 'Mere-salt goods', fire: 'water-quenched steel', beasts: 'leather and bone goods', dead: 'grave goods' });
const join = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** The ethic summary of an 8-axis vector: { strong, leans, refuses } lines (null when empty). */
export function ethicLines(eth) {
  const strong = [], leans = [], refuses = [];
  if (Array.isArray(eth)) ETHIC_AXES.forEach((ax, k) => {
    const v = eth[k] | 0, w = ETHIC_WORDS[ax];
    if (!v || !w) return;
    (Math.abs(v) >= 2 ? strong : leans).push(w[v > 0 ? 1 : 0]);
    if (v >= 2 && REFUSED[ax]) refuses.push(REFUSED[ax]);
  });
  return { strong: strong.length ? P.strong(join(strong.slice(0, 3))) : null, leans: leans.length ? P.leans(join(leans.slice(0, 3))) : null, refuses: refuses.length ? P.refuses(join(refuses)) : null, none: !strong.length && !leans.length };
}

// ---- the shadow state and the model ----------------------------------------------------------------------------
/**
 * A read-only view of s for factions.js and caravans.js: s.rt.realm is R, and when the save has not bound the
 * roles yet s.realm.bind is the binding the sim will make (bindRoles on a copy). Never written back.
 */
export function shadowOf(s, R) {
  if (!s || !s.realm || !R) return s;
  const bound = s.realm.bind && Object.keys(s.realm.bind).length;
  if (realmRec(s) === R && bound) return s;
  const sh = Object.create(s);
  sh.rt = Object.assign(Object.create(s.rt || null), { realm: R });
  sh.realm = { ...s.realm, bind: bound ? s.realm.bind : {} };
  if (!bound) bindRoles(sh, R);
  return sh;
}

/** Step cost in half-days of entering j from i (query.js travelDays and caravans.js travelField: the same rules). */
function stepCost(R, i, j) {
  if (isSea(R, j)) return 0;
  if (riverClass(R, i) && riverClass(R, j)) return 1;
  if (R.fields.road[j]) return 2;
  const b = band(R, j);
  return b >= BAND.HIGH ? 6 : b === BAND.UP ? 4 : 2;
}
const routeCache = new WeakMap();
/** One Dijkstra from the hold's region with predecessors (8-connected, ties by region index): { cost, from }. */
function routeField(R, rx, ry) {
  let byR = routeCache.get(R);
  if (!byR) routeCache.set(R, (byR = new Map()));
  const key = rx + ',' + ry;
  if (byR.has(key)) return byR.get(key);
  const n = R.n, N = n * n, cost = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), heap = [];
  const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (e) => { heap.push(e); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (!less(heap[c], heap[p])) break; [heap[c], heap[p]] = [heap[p], heap[c]]; c = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && less(heap[l], heap[m])) m = l; if (r < heap.length && less(heap[r], heap[m])) m = r; if (m === c) break; [heap[c], heap[m]] = [heap[m], heap[c]]; c = m; } }
    return top;
  };
  const src = ry * n + rx;
  cost[src] = 0; push([0, src]);
  while (heap.length) {
    const [c, i] = pop();
    if (c > cost[i]) continue;
    const x = i % n, y = (i - x) / n;
    for (let d = 0; d < 8; d++) {
      const xx = x + DX[d], yy = y + DY[d];
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const j = yy * n + xx, w = stepCost(R, i, j);
      if (w && c + w < cost[j]) { cost[j] = c + w; from[j] = i; push([c + w, j]); }
    }
  }
  const out = { cost, from };
  byR.set(key, out);
  return out;
}
/** The land route from region i back to the hold: region indices from i to the hold, or null over the sea. */
function routeTo(F, i, home) {
  if (!(F.cost[i] < Infinity)) return null;
  const out = [i];
  for (let k = i; k !== home && out.length < 4096; ) { k = F.from[k]; if (k < 0) return null; out.push(k); }
  return out;
}

/** The wars going on now (record wars and the s.realm.wars deltas): [{ id, a, b, began }], id the record war or null. */
export function warsNow(s, R) {
  const m = new Map();
  const put = (a, b, began, ended, id) => { if (Number.isInteger(a) && Number.isInteger(b)) { const k = `${Math.min(a, b)}:${Math.max(a, b)}:${began | 0}`; const o = m.get(k); m.set(k, { a, b, began: began | 0, ended: ended === undefined ? null : ended, id: o && o.id !== null ? o.id : id }); } };
  for (const w of R.tables.wars || []) put(w.a, w.b, w.began, w.ended, w.id);
  for (const d of (s.realm && s.realm.wars) || []) { if (Array.isArray(d)) put(d[0], d[1], d[2], d[3], null); else if (d && typeof d === 'object') put(d.a, d.b, d.began, d.ended, null); }
  return [...m.values()].filter((w) => w.ended === null).sort((x, y) => x.began - y.began || x.a - y.a || x.b - y.b);
}

const views = new WeakMap();
/**
 * The World tab's model (cached per state, tick and record): the hold's region, the liege civ, the bound roles,
 * the neighbour rows (the liege's nearest site first, then the nearest site of each of the 6 nearest other civs,
 * topped up with the next nearest sites when fewer civs live: { site, civ, role,
 * days, fac, goodwill, word }), the wars now with a front region each, the caravan sources and their land routes.
 */
export function realmView(s, R) {
  const c0 = views.get(s);
  if (c0 && c0.R === R && c0.tick === s.tick && c0.n === (((s.realm && s.realm.sites) || []).length + ((s.realm && s.realm.wars) || []).length)) return c0.v;
  const sh = shadowOf(s, R), n = R.n, rx = s.realm.rx | 0, ry = s.realm.ry | 0, home = ry * n + rx, civs = R.tables.civs;
  const F = routeField(R, rx, ry), days = (x, y) => { const c = F.cost[y * n + x]; return c < Infinity ? Math.ceil(c / 2) : Infinity; };
  const bind = sh.realm.bind || {};
  const liege = Number.isInteger(bind.hearthwatch) ? bind.hearthwatch : Number.isInteger(s.realm.civ) ? s.realm.civ : null;
  const sites = sitesNow(sh, R);
  const living = (x) => x.civ !== null && civs[x.civ] && civs[x.civ].fell === null && !(x.x === rx && x.y === ry);
  const d2 = (x) => (x.x - rx) * (x.x - rx) + (x.y - ry) * (x.y - ry);
  const near = sites.filter(living).sort((a, b) => days(a.x, a.y) - days(b.x, b.y) || d2(a) - d2(b) || a.id - b.id);
  const row = (x, role) => {
    const fac = factionOfCiv(sh, x.civ), g = goodwill(sh, fac);
    return { site: x.id, x: x.x, y: x.y, name: R.tables.sites[x.id].name || '', kind: x.kind, civ: x.civ, role, days: days(x.x, x.y), fac, goodwill: g,
      word: x.civ === liege ? P.liege : atWarWithLiege(sh, R, x.civ) ? P.atWar : standingOf(sh, fac) };
  };
  const liegeSite = liege !== null ? near.find((x) => x.civ === liege) || null : null;
  const rows = [];
  // the neighbours: the nearest site of each of the 6 nearest other civs; with fewer civs, the next nearest sites
  const cap = liegeSite ? 7 : 6, seen = new Set(liegeSite ? [liegeSite.civ] : []), used = new Set(liegeSite ? [liegeSite.id] : []);
  if (liegeSite) rows.push(row(liegeSite, 'liege'));
  for (const x of near) { if (rows.length >= cap) break; if (!seen.has(x.civ)) { seen.add(x.civ); used.add(x.id); rows.push(row(x, 'near')); } }
  for (const x of near) { if (rows.length >= cap) break; if (!used.has(x.id)) { used.add(x.id); rows.push(row(x, 'near')); } }
  // the wars now: a front where the two civs' living sites come closest
  const wars = warsNow(s, R).map((w) => {
    let best = null, bd = Infinity;
    for (const p of near) { if (p.civ !== w.a) continue; for (const q of near) { if (q.civ !== w.b) continue; const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2; if (d < bd) { bd = d; best = [p, q]; } } }
    return { ...w, front: best ? { rx: (best[0].x + best[1].x) >> 1, ry: (best[0].y + best[1].y) >> 1 } : null, liege: liege !== null && (w.a === liege || w.b === liege) };
  });
  const sources = caravanSources(sh, R);
  const routes = sources.map((c) => { const x = R.tables.sites[c.site]; return { site: c.site, path: routeTo(F, x.y * n + x.x, home) }; }).filter((r) => r.path);
  const v = { home: { rx, ry }, liege, bind, rows, wars, sources, routes, days, sh, sites };
  views.set(s, { R, tick: s.tick, n: (((s.realm && s.realm.sites) || []).length + ((s.realm && s.realm.wars) || []).length), v });
  return v;
}

// ---- the crest ---------------------------------------------------------------------------------------------------
// A 12 x 14 shield. Rows: '#' the field, '.' outside. The ink outline is the field's border.
const SHIELD = ['############', '############', '############', '############', '############', '############', '############', '############',
  '############', '.##########.', '.##########.', '..########..', '...######...', '.....##.....'];
/** 5 x 5 charges (our own marks): a star, a tower, a crown, a key, a flame, a wheel. */
const CHARGES = [
  ['..#..', '.###.', '#####', '.###.', '..#..'], ['#.#.#', '#####', '.###.', '.#.#.', '.###.'], ['#.#.#', '#####', '#####', '.....', '.....'],
  ['.##..', '#..#.', '.##..', '..#..', '..##.'], ['..#..', '.##..', '.###.', '#####', '.###.'], ['.###.', '#.#.#', '#####', '#.#.#', '.###.'],
];
const DIVS = ['plain', 'pale', 'fess', 'bend', 'chevron', 'quarter'];
/** The crest of a civ (from its `herald` bits and tincture) as a canvas baked once: 12 x 14 pixels at k CSS px. */
export function crestCanvas(civ, k = 2) {
  const W = 12, H = 14, cv = h('canvas.ec-crest', { width: String(W), height: String(H), role: 'img', 'aria-label': P.crest(civName(civ) || ''),
    style: { width: W * k + 'px', height: H * k + 'px', imageRendering: 'pixelated', flex: 'none' } });
  let g = null;
  try { g = cv.getContext('2d'); } catch (_) { g = null; }
  if (!g || !civ) return cv;
  const hb = (civ.herald | 0) >>> 0, field = TINCTURES[(civ.id | 0) % TINCTURES.length], metal = hb & 1 ? PAL.bone : PAL.gold;
  const second = field === PAL.gold || field === PAL.bone || field === PAL.sand || field === PAL.frost ? PAL.umber1 : metal;
  const div = DIVS[(hb >>> 1) % DIVS.length], ch = CHARGES[(hb >>> 4) % CHARGES.length];
  const inDiv = (x, y) => (div === 'pale' ? x >= 6 : div === 'fess' ? y >= 7 : div === 'bend' ? x - y > 0 : div === 'chevron' ? y >= 8 - Math.min(x, 11 - x) * 0.6 + 2 : div === 'quarter' ? (x >= 6) !== (y >= 7) : false);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (SHIELD[y][x] !== '#') continue;
    const edge = y === 0 || x === 0 || x === W - 1 || SHIELD[y][x - 1] !== '#' || SHIELD[y][x + 1] !== '#' || !SHIELD[y + 1] || SHIELD[y + 1][x] !== '#';
    g.fillStyle = edge ? PAL.ink : inDiv(x, y) ? second : field;
    g.fillRect(x, y, 1, 1);
  }
  // the charge, in the metal (or ink on a light field), with an ink edge where it meets the field
  const cc = field === PAL.bone || field === PAL.frost || field === PAL.sand || field === PAL.gold ? PAL.ink : metal;
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if (ch[y][x] === '#') { g.fillStyle = cc; g.fillRect(x + 4, y + 3, 1, 1); }
  return cv;
}

// ---- the card ------------------------------------------------------------------------------------------------------
const kindOf = (c) => (typeof c.kind === 'number' ? (CIVKINDS[c.kind] || {}).id : c.kind);
const line = (text, extra = {}) => h('p.ec-bio-d', { text, style: { margin: '0', ...extra } });
/** The standing bar: -100..+100, the fill from the centre, the number and word beside it as text. */
function standingBar(g, word) {
  const v = Math.max(-100, Math.min(100, g | 0)), w = Math.abs(v) / 2;
  const fill = h('span', { style: { position: 'absolute', top: '0', bottom: '0', left: v >= 0 ? '50%' : 50 - w + '%', width: w + '%', background: v >= 0 ? 'var(--good, #8fd16a)' : 'var(--bad-text, #ff8a7a)' } });
  return h('div.ec-civ-standing', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
    h('span', { text: P.standing(word, v), style: { fontSize: 'var(--fs-2, 15px)', fontWeight: '600' } }),
    h('span', { role: 'meter', 'aria-valuemin': '-100', 'aria-valuemax': '100', 'aria-valuenow': String(v), 'aria-label': P.standing(word, v),
      style: { position: 'relative', display: 'block', height: '10px', background: 'var(--surface-2, #261f23)', boxShadow: '0 0 0 1px ' + PAL.ink } },
    fill, h('span', { style: { position: 'absolute', left: 'calc(50% - 1px)', top: '-2px', bottom: '-2px', width: '2px', background: PAL.bone } })));
}
/** The caravan line(s) of civ id: here now, the next expected and the last; or why none come. */
function caravanLines(s, R, V, id) {
  const src = V.sources.find((c) => c.civ === id);
  if (!src) {
    if (atWarWithLiege(V.sh, R, id)) return [P.warNoTrade];
    const anyNear = V.sites.some((x) => x.civ === id && REALM_CARAVAN.kinds.includes(x.kind) && x.size >= REALM_CARAVAN.minSize && V.days(x.x, x.y) <= REALM_CARAVAN.reach);
    return [anyNear ? P.coldTrade : P.farTrade(REALM_CARAVAN.reach)];
  }
  const rec = (s.colony && s.colony.trade) || {}, D = TICKS_PER_DAY, dd = P.days(Math.ceil(src.days));
  if ((rec.visits || []).some((v) => v.site === src.site)) return [P.here(src.name)];
  const r = Array.isArray(rec.sites) ? rec.sites.find((x) => Array.isArray(x) && x[0] === src.site) : null;
  const next = r ? Math.max(0, Math.ceil((r[1] - s.tick) / D)) : Math.max(REALM_CARAVAN.first, Math.ceil(src.days));
  const out = [next > 0 ? P.next(src.name, next, dd) : P.nextDue(src.name, dd)];
  // the last arrival: K's row [site, next, last] when it carries one, else next minus the cadence when that is a past tick
  const last = r ? (Number.isInteger(r[2]) ? r[2] : r[1] - cadenceDays(src.days) * D) : -1;
  out.push(r && last >= 0 && last <= s.tick ? P.last(Math.floor((s.tick - last) / D)) : P.firstCaravan);
  return out;
}
/** The open demands of civ id: the waiting envoy's, when its faction is this civ. */
function demandLines(s, V, id) {
  const e = s.colony && s.colony.trade && s.colony.trade.envoy;
  if (!e || civOfFaction(V.sh, e.faction) !== id) return [P.noDemand];
  const it = def('item', e.k) || { name: e.k };
  return [P.demand(e.n, String(it.name || e.k).toLowerCase(), Math.floor((e.until | 0) / TICKS_PER_DAY) + 1)];
}

/** One civ's card. opt: { showSite(rx, ry), open(key), page: true on its own page (no row buttons) }. */
export function civCard(ctx, R, id, opt = {}) {
  const s = ctx.s, V = realmView(s, R), c = R.tables.civs[id];
  if (!c) return h('p.ec-note', { text: WT.gone });
  const fac = factionOfCiv(V.sh, id), g = goodwill(V.sh, fac), liege = id === V.liege, war = atWarWithLiege(V.sh, R, id);
  const word = liege ? P.liege : war ? P.atWar : standingOf(V.sh, fac);
  const E = ethicLines(c.eth);
  const seat = (V.sites.find((x) => x.id === c.cap && x.civ === id) || V.sites.filter((x) => x.civ === id).sort((a, b) => V.days(a.x, a.y) - V.days(b.x, b.y) || a.id - b.id)[0]) || null;
  const nearest = V.sites.filter((x) => x.civ === id).sort((a, b) => V.days(a.x, a.y) - V.days(b.x, b.y) || a.id - b.id)[0] || seat;
  const card = h('section.ec-civ-card', { 'data-civ': String(id), 'data-role': liege ? 'liege' : 'civ', 'data-fac': fac,
    style: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 12px', margin: '0 0 10px', border: '1px solid ' + (liege ? 'var(--brass-hi, #f0c86a)' : 'var(--line-soft, rgba(201,151,62,0.32))'), borderRadius: '6px', background: 'var(--surface-1, #2b2327)' } });
  card.append(h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, crestCanvas(c, 3),
    h('div', { style: { display: 'flex', flexDirection: 'column', minWidth: '0', flex: '1 1 auto' } },
      h('b', { text: civName(c), style: { fontSize: 'var(--fs-3, 16px)', overflowWrap: 'anywhere' } }),
      line(`${P.civSub(peopleWord(c.people), String(CIVKIND_WORDS[kindOf(c)] || '').toLowerCase())}${seat ? ' \u00b7 ' + WT.capital(R.tables.sites[seat.id].name).replace(/\.$/, '') : ''}`)),
    h('span', { text: word, 'data-word': word, style: { flex: 'none', fontSize: 'var(--fs-1, 14px)', fontWeight: '650', padding: '2px 8px', borderRadius: '11px', color: war ? 'var(--bad-text, #ff8a7a)' : liege ? 'var(--brass-hi, #f0c86a)' : 'var(--dim, #d3c3a3)', border: '1px solid currentColor' } })));
  card.append(standingBar(g, standingOf(V.sh, fac)));
  card.append(h('div.ec-civ-ethic', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, ...[E.strong, E.leans, E.none ? P.noEthic : null, E.refuses].filter(Boolean).map((x) => line(x))));
  card.append(line(P.oath(oathText(c.oath))));
  card.append(h('div.ec-civ-demands', null, ...demandLines(s, V, id).map((x) => line(x))));
  card.append(h('div.ec-civ-caravans', null, ...caravanLines(s, R, V, id).map((x) => line(x))));
  const btns = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
  if (nearest && opt.showSite) btns.append(onTap(h('button.ec-btn', { type: 'button', 'data-act': 'civ-map', 'data-rx': String(nearest.x), 'data-ry': String(nearest.y), style: { minHeight: '44px', flex: '1 1 120px' } }, h('span.ec-btn-label', { text: P.showOnMap })), () => opt.showSite(nearest.x, nearest.y)));
  if (opt.open) btns.append(onTap(h('button.ec-btn', { type: 'button', 'data-act': 'civ-annals', 'data-key': 'wc' + id, style: { minHeight: '44px', flex: '1 1 120px' } }, h('span.ec-btn-label', { text: P.annals })), () => opt.open('wc' + id)));
  if (btns.childNodes.length) card.append(btns);
  return card;
}

/** The civs in card order: the liege, the other bound roles (in role order), then by travel days to their nearest site. */
export function civOrder(s, R) {
  const V = realmView(s, R), civs = R.tables.civs, roleOf = new Map();
  ROLE_IDS.forEach((r, k) => { const b = V.bind[r]; if (Number.isInteger(b) && !roleOf.has(b)) roleOf.set(b, k); });
  const dist = new Map();
  for (const x of V.sites) if (x.civ !== null) { const d = V.days(x.x, x.y); if (!dist.has(x.civ) || d < dist.get(x.civ)) dist.set(x.civ, d); }
  const live = civs.filter((c) => c && c.fell === null).map((c) => c.id);
  const key = (id) => [id === V.liege ? 0 : roleOf.has(id) ? 1 : 2, roleOf.has(id) ? roleOf.get(id) : 0, dist.has(id) ? dist.get(id) : Infinity, id];
  live.sort((a, b) => { const p = key(a), q = key(b); for (let k = 0; k < 4; k++) if (p[k] !== q[k]) return p[k] < q[k] ? -1 : 1; return 0; });
  return { live, fallen: civs.filter((c) => c && c.fell !== null).map((c) => c.id) };
}

/** The Peoples tab: one card per living civ, then the fallen civs as rows that open their Annals record. */
export function peoplesView(el, ctx, R, opt = {}) {
  const { live, fallen } = civOrder(ctx.s, R);
  const box = h('div.ec-peoples', { 'data-civs': String(live.length) });
  if (realmView(ctx.s, R).liege === null) box.append(h('p.ec-note', { text: P.noLiege }));
  for (const id of live) box.append(civCard(ctx, R, id, opt));
  if (fallen.length) {
    box.append(h('h3.ec-sub', { text: P.fallenHead(fallen.length) }));
    for (const id of fallen) {
      const c = R.tables.civs[id];
      const b = h('button.ec-row', { type: 'button', 'data-act': 'civ-fallen', 'data-civ': String(id) }, crestCanvas(c, 2), h('span.ec-row-n', { text: civName(c) }), h('span.ec-row-s', { text: P.fell(c.fell) }));
      if (opt.open) onTap(b, () => opt.open('wc' + id));
      box.append(b);
    }
  }
  el.append(box);
  return box;
}

/** Push "World / <civ>": the civ's card with Show on map and Annals (a neighbour row's page). */
export function openCivPage(ctx, R, id, opt = {}) {
  const c = R.tables.civs[id];
  ctx.openSheet(civName(c) || WT.gone, (el) => {
    const box = h('div.ec-world-box', { 'data-world': 'civ', 'data-civ': String(id) });
    if (opt.site !== undefined && opt.site !== null && R.tables.sites[opt.site]) {
      const x = R.tables.sites[opt.site], V = realmView(ctx.s, R);
      box.append(h('p.ec-bio-d', { 'data-site': String(opt.site), text: `${x.name}: ${WT.siteSub(SITE_WORDS[x.kind] || x.kind, civText(c))}, ${P.days(V.days(x.x, x.y))} away.`, style: { margin: '0 0 8px' } }));
    }
    box.append(civCard(ctx, R, id, { ...opt, page: true }));
    el.append(box);
  }, { push: true });
}

/** A war's News line. */
export const warLine = (R, w) => P.war(warName(R, w), w.liege);

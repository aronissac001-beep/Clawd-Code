// World beasts of the realm's history (EMBERCROWN-WORLD.md 2.2, 2.3 step 6; owner L). Called by history.js at its
// step 6 hook over the history context H; heroes hunt them as a deed (figures.js `hunt`).
//
//   initBeasts(H)    the beasts stream, the count for the wildness param and the years the late beasts wake
//   yearBeasts(H)    year 0: the first lairs (after the first capitals); later wakes; every 5-20 years a beast
//                    roams out of its lair and razes a hamlet or village within 4 regions (scaled); 'beast.woke'
//                    marks a late beast's first waking, 'beast.razed' each razing
//   beastName(seed)  the name legends.js beastIdentity gives the same identity seed (finder, region card)
//
// A beast row: { id, seed, name, site, x, y, born, alive, slain, by, kills, wounds, razed, next }. `seed` is the
// identity seed of js/game/threat/beasts/gen.js (beastIdentity); `site` is its lair (a 'lair' site, no owner);
// a slain beast's lair stays as a site holding its trophy (figures.js). Draws come from the private 'beasts'
// stream (H.BR); beasts run in id order. Lint: tools/check-mapgen.mjs.
import { HISTORY_GEN } from '../../data/realm/civkinds.js';
import { EVENT_INDEX as E, NONE, DEATH } from '../../data/realm/events.js';
import { TABLES } from '../../data/text/legends.js';
import { hashString } from '../core/rand.js';
import { stream, gen, ri, rf, ru } from './fields.js';

/**
 * G data: HISTORY_GEN.beasts in js/data/realm/civkinds.js. count: beasts at the Standard size by
 * the wildness param (scaled by area, within [min, max]); first: the share there at year 0 (the rest wake over
 * [wake0, years - wake1]); wild: the least `wild` of a lair region; gap: lairs at least this far apart; siteGap:
 * from living sites; roam: years between outings; reach: the raze reach; kill: chance a figure at home dies in a raze.
 */
export const BEAST = HISTORY_GEN.beasts;

/** The beast name of identity seed `seed`: the same words as legends.js beastIdentity(seed).full. */
export function beastName(seed) {
  const h = hashString('beast:' + (seed >>> 0)), T = TABLES;
  const b = (h >>> 10) % T.beastBody.length, m = (h >>> 14) % T.beastMat.length;
  return `${T.beastA[h % T.beastA.length]}${T.beastB[(h >>> 5) % T.beastB.length]} the ${T.beastMat[m]} ${T.beastBody[b]}`;
}

const cheb = (a, b) => { const dx = a.x > b.x ? a.x - b.x : b.x - a.x, dy = a.y > b.y ? a.y - b.y : b.y - a.y; return dx > dy ? dx : dy; };
const live = (s) => s.razed === null && s.civ !== null;

export function initBeasts(H) {
  H.BR = gen(stream('beasts', H.realm.seed, H.reroll));
  H.beasts = [];
  const B = BEAST, w = H.realm.params.wildness || 'normal';
  let total = Math.round((B.count[w] || B.count.normal) * H.sc * H.sc);
  total = total < B.min ? B.min : total > Math.round(B.max * H.sc * H.sc) ? Math.round(B.max * H.sc * H.sc) : total;
  H.beastFirst = Math.round(total * B.first);
  const late = [];
  for (let k = H.beastFirst; k < total; k++) late.push(ri(H.BR, B.wake[0], Math.max(B.wake[0], H.Y - B.wake[1])));
  late.sort((a, b) => a - b);
  H.beastWake = late;
}

/** A lair region: land, free, wild at least BEAST.wild, `gap` from other lairs and `siteGap` from living sites; the wildest (with jitter). -1 when none. */
function lairRegion(H) {
  const { realm, n } = H, f = realm.fields, N = n * n, B = BEAST, gap = Math.max(2, Math.round(B.gap * H.sc));
  if (H.sites.length >= H.siteCap - 4) return -1;
  let best = -1, bs = -1;
  for (let i = 0; i < N; i++) {
    if (H.siteAt[i] || f.elev[i] < realm.seaLevel || f.wild[i] < B.wild) continue;
    const p = { x: i % n, y: (i - (i % n)) / n };
    let ok = true;
    for (const b of H.beasts) if (cheb(b, p) < gap) { ok = false; break; }
    if (!ok) continue;
    for (const s of H.sites) if (live(s) && cheb(s, p) < B.siteGap) { ok = false; break; }
    if (!ok) continue;
    const sc = f.wild[i] + rf(H.BR) * 40;
    if (sc > bs) { bs = sc; best = i; }
  }
  return best;
}
function spawn(H, ancient) {
  const i = lairRegion(H);
  if (i < 0) return null;
  const s = H.fx.addSite('lair', i, null, 0), R = H.BR, seed = ru(R) >>> 0;
  const b = { id: H.beasts.length, seed, name: beastName(seed), site: s.id, x: s.x, y: s.y,
    born: ancient ? -ri(R, BEAST.ancient[0], BEAST.ancient[1]) : H.year, alive: true, slain: null, by: -1, kills: 0, wounds: 0, razed: 0,
    next: H.year + ri(R, BEAST.roam[0], BEAST.roam[1]) };
  H.beasts.push(b);
  if (!ancient) H.fx.log(E['beast.woke'], b.id, NONE, s.id);
  return b;
}

/** 2.3 step 6. */
export function yearBeasts(H) {
  const y = H.year;
  if (y === 0) for (let k = 0; k < H.beastFirst; k++) spawn(H, true);
  while (H.beastWake.length && H.beastWake[0] <= y) { H.beastWake.shift(); spawn(H, false); }
  for (const b of H.beasts) {
    if (!b.alive || y < b.next) continue;
    b.next = y + ri(H.BR, BEAST.roam[0], BEAST.roam[1]);
    roam(H, b);
  }
}
/** The beast roams out: it razes the nearest hamlet or village (a living site of size 1-2) within reach, if any. */
function roam(H, b) {
  const R = Math.max(2, Math.round(BEAST.reach * H.sc));
  let t = null, td = 1e9;
  for (const s of H.sites) if (live(s) && s.size >= 1 && s.size <= 2) { const d = cheb(s, b); if (d <= R && d < td) { td = d; t = s; } }
  if (!t) return;
  const civ = t.civ;
  H.fx.log(E['beast.razed'], b.id, civ, t.id);
  t.beast = b.id;
  b.razed++;
  H.fx.loseSite(t, null, 'beast', null, NONE);
  // figures at home there may die (ids in order; the newborn of this year are spared)
  const F = H.figures, n = F.length;
  for (let k = 0; k < n; k++) {
    const f = F[k];
    if (f.died !== null || f.home !== t.id || f.born >= H.year) continue;
    if (rf(H.BR) < BEAST.kill) { b.kills++; H.fx.kill(f, DEATH.beast, t.id, { beast: b.id }); }
  }
}

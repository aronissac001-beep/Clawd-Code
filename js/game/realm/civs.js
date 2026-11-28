// Civs of the realm's history (EMBERCROWN-WORLD.md 2.2-2.3, 4.4-4.5; owner L): peoples and biome fit, ethic
// vectors and relations, names and oaths, and the opening roster with capital placement. Pure helpers over a
// history context H (history.js); every draw comes from H.R, the 'history' stream (1.2). Lint: tools/check-mapgen.mjs.
import { HISTORY_PEOPLES, OTHER_FIT, CIVKINDS, CIVKIND_INDEX, ROSTER, ROSTER_EXTRA, PLACE_PARTS, SITE_PARTS, HISTORY_GEN, SETTLE_KINDS, SITE_KINDS } from '../../data/realm/civkinds.js';
import { PEOPLE_ETHIC, ETHIC_AXES, REL, OATH_PARTS } from '../../data/realm/ethics.js';
import { REALM_BIOMES } from '../../data/realm/biomes.js';
import { ri, rf } from './fields.js';
import { BAND, bandOf } from './biomes.js';
import { FLOW } from './rivers.js';

/** The peoples history can found civs of, in a fixed order. */
export const PEOPLES = Object.freeze(Object.keys(HISTORY_PEOPLES));
const AX = ETHIC_AXES.length;

/** Whether region i can hold a living site: land, not a peak, not a lake. */
export function settleable(realm, i) {
  const f = realm.fields;
  return f.elev[i] >= realm.seaLevel && bandOf(f.elev[i], realm.bands) !== BAND.PEAK && !(f.flow[i] & FLOW.LAKE);
}

/** Biome fit 0-3 of every region for people `p` (0 where no site can stand): a Float32Array. */
export function fitField(realm, p) {
  const P = HISTORY_PEOPLES[p], f = realm.fields, N = realm.n * realm.n, out = new Float32Array(N);
  const w = REALM_BIOMES.map((b) => (P.homeBiomes[b.id] !== undefined ? P.homeBiomes[b.id] : OTHER_FIT));
  for (let i = 0; i < N; i++) {
    if (!settleable(realm, i)) continue;
    let v = w[f.biome[i]];
    if (P.water && !(f.flow[i] & (FLOW.CLS | FLOW.COAST))) v -= 2;
    if (P.relief) { const bd = bandOf(f.elev[i], realm.bands); if (bd === BAND.UP || bd === BAND.HIGH) v += P.relief; }
    if (P.open && bandOf(f.elev[i], realm.bands) === BAND.LOW) { const id = REALM_BIOMES[f.biome[i]].id; if (id === 'greenvale' || id === 'moor') v -= 1; }
    out[i] = v < 0 ? 0 : v > 3 ? 3 : v;
  }
  return out;
}

/** A civ's ethic vector: its people's plus +-1 on REL.jitterAxes seeded axes, clamped to -2..2 (4.4). */
export function ethicOf(H, people) {
  const base = PEOPLE_ETHIC[people] || new Array(AX).fill(0), e = base.slice(0, AX);
  for (let k = 0; k < REL.jitterAxes; k++) {
    const a = ri(H.R, 0, AX - 1), d = ri(H.R, 0, 1) ? 1 : -1, v = e[a] + d;
    e[a] = v < -2 ? -2 : v > 2 ? 2 : v;
  }
  return e;
}
/** L1 distance of two ethic vectors (0-32). */
export function ethicDistance(a, b) { let d = 0; for (let k = 0; k < AX; k++) d += a[k] > b[k] ? a[k] - b[k] : b[k] - a[k]; return d; }
/** Whether two peoples share a home biome (weight 2 or more in both). */
export function sharedHome(pa, pb) {
  const A = HISTORY_PEOPLES[pa].homeBiomes, B = HISTORY_PEOPLES[pb].homeBiomes;
  for (const k of Object.keys(A).sort()) if (A[k] >= 2 && B[k] >= 2) return true;
  return false;
}

const pick = (H, a) => a[ri(H.R, 0, a.length - 1)];
/** A civ name: "Kingdom of Varnholt" or "the Szarmaw Clans" (original parts). */
export function civName(H, people, kind) {
  const P = PLACE_PARTS[people] || PLACE_PARTS.human, K = CIVKINDS[kind];
  for (let t = 0; t < 8; t++) {
    const base = pick(H, P.a) + pick(H, P.b), name = K.style === 'of' ? `${K.noun} of ${base}` : `the ${base} ${K.noun}`;
    if (!H.names.has(name)) { H.names.add(name); return name; }
  }
  const name = `${K.style === 'of' ? K.noun + ' of ' : 'the '}${pick(H, P.a)}${pick(H, P.b)} ${H.civs.length + 1}`;
  H.names.add(name);
  return name;
}
/** A site name (original parts), unique within the world while the parts last. */
export function siteName(H) {
  for (let t = 0; t < 6; t++) { const s = pick(H, SITE_PARTS.c) + pick(H, SITE_PARTS.d); if (!H.names.has(s)) { H.names.add(s); return s; } }
  return pick(H, SITE_PARTS.c) + pick(H, SITE_PARTS.d);
}
/** A civ's oath (4.4) as a small id: form * 10000 + x * 100 + y. oathText(id) gives the words. */
export function oathOf(H) {
  if (ri(H.R, 0, 1)) return 10000 + ri(H.R, 0, OATH_PARTS.a.length - 1) * 100 + ri(H.R, 0, OATH_PARTS.b.length - 1);
  return 20000 + ri(H.R, 0, OATH_PARTS.c.length - 1) * 100 + ri(H.R, 0, OATH_PARTS.d.length - 1);
}
export function oathText(id) {
  const form = Math.floor(id / 10000), x = Math.floor(id / 100) % 100, y = id % 100;
  return form === 1 ? `the ${OATH_PARTS.a[x]}-and-${OATH_PARTS.b[y]} pact` : `the ${OATH_PARTS.c[x]} ${OATH_PARTS.d[y]}`;
}

/** The living-site kind (a SITE_KINDS id) of people p at size z. */
export function siteKind(people, z) {
  const st = SETTLE_KINDS[(HISTORY_PEOPLES[people] || {}).settle] || SETTLE_KINDS.town;
  return st[z < 0 ? 0 : z > 5 ? 5 : z];
}
export const SITE_KIND_INDEX = Object.freeze(Object.fromEntries(SITE_KINDS.map((k, i) => [k, i])));

/** A kind id for people p: the roster's if it fits, else the first kind that lists p (or '*'). */
function kindFor(people, want) {
  const k = CIVKIND_INDEX[want];
  if (k !== undefined && (CIVKINDS[k].peoples.includes(people) || CIVKINDS[k].peoples.includes('*'))) return k;
  for (let j = 0; j < CIVKINDS.length; j++) if (CIVKINDS[j].peoples.includes(people)) return j;
  return CIVKIND_INDEX.realm;
}

/** The opening roster: [{ people, kind }] for `count` civs (ROSTER rows first, then seeded ROSTER_EXTRA rows). */
export function rosterOf(H, count) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const row = k < ROSTER.length ? ROSTER[k] : ROSTER_EXTRA[ri(H.R, 0, ROSTER_EXTRA.length - 1)];
    const people = row[0] === '*' ? PEOPLES[ri(H.R, 0, PEOPLES.length - 1)] : row[0];
    out.push({ people, kind: kindFor(people, row[1]) });
  }
  return out;
}

/**
 * The best free region for a new civ's capital: the highest of fit * 10 + a seeded jitter over settleable
 * regions with taint at most capital.taintMax and no capital within capital.minGap (Chebyshev, scaled).
 * The gap halves (down to 2) when no region qualifies. Returns a region index or -1.
 */
export function placeCapital(H, people) {
  const { realm, n } = H, f = realm.fields, N = n * n, fit = H.fit[people], C = HISTORY_GEN.capital;
  for (let gap = Math.max(2, Math.round(C.minGap * H.sc)); gap >= 2; gap = gap > 2 ? Math.max(2, gap >> 1) : 1) {
    let best = -1, bs = -1;
    for (let i = 0; i < N; i++) {
      if (!fit[i] || H.siteAt[i] || f.taint[i] > C.taintMax) continue;
      const x = i % n, y = (i - x) / n;
      let near = false;
      for (const c of H.civs) {
        const s = H.sites[c.cap];
        const dx = s.x > x ? s.x - x : x - s.x, dy = s.y > y ? s.y - y : y - s.y;
        if ((dx > dy ? dx : dy) < gap) { near = true; break; }
      }
      if (near) continue;
      const sc = fit[i] * 10 + rf(H.R) * 6;
      if (sc > bs) { bs = sc; best = i; }
    }
    if (best >= 0) return best;
    if (gap === 2) break;
  }
  return -1;
}

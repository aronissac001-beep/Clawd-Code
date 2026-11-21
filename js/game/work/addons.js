// Workshop add-ons (EMBERCROWN-FORTRESS.md 3.7, F12; step Z2.4). Owner E. Data: js/data/addons.js (G), its live
// and staged rows (ALL_ADDONS: a staged row's recipes and gear join the data at the Z2 switch).
//
// An add-on is either a structure built on a tile next to its bench (form 'structure': its structure def has
// the add-on's id) or a master set (form 'master': open while the hold has a living Master, level 15+, of the
// bench's skill). While an add-on is open for a bench, that bench may work the recipes the add-on lists
// (recipe.addon) and has its rules (addon.adds.rules: temper, refit, meltDown, ...). A bench may have any
// number of add-ons; one add-on structure may serve every bench it touches. Nothing is ever picked.
//
// The ember forge (3.7) is an add-on structure of the forge, bloomery and blast furnace that must stand
// beside an ember pool on its level: a bench beside it needs no fuel, rolls quality once more and alone can
// make embersteel. Ember-proof gear (EMBERPROOF item kinds) makes its wearer ignore Sweltering and ember splash.
//
// No saved state and no rt key: everything is read from s.bld, s.col and the fluid layer. addonsOf() memoises
// per tick in a WeakMap on s.rt (pure, F25: a hit returns what a rebuild would, and the sim never depends on
// warmth).
//
// Hooks into other owners' code (requests in the Z2.4 report; until they land this module is dark):
//   bills.js (E)        billWanted/workableBill: `addonOpen(s, b, r)` beside the tech gate (a recipe with an addon
//                       is workable only at a bench that has it); spawnProducts: `extraQualityRolls(s, b)`;
//                       the fuel check skips { cat: 'fuel' } ingredients when `needsNoFuel(s, b)`
//   apply.js (A)        pass the level to BUS.canPlace: firstHook(BUS.canPlace, s, d, x, y, rot, AZ)
//   colony/index.js (K) installAddons() with the research gates (it pushes the placement hook)
//   personality.js (F)  heat: a colonist wearing `isEmberproof(k)` gear skips Sweltering and Heatstroke
//   ui (I)              bench sheet: `addonLines(s, b)` (built add-ons and what each adds, with its verb)

import { BUS } from '../core/bus.js';
import { idx, inB, PLANE } from '../core/grid.js';
import { structDef, sizeOf } from '../world/defs.js';
import { level } from '../people/skills.js';
import { ALL_ADDONS, VERB_OF, EMBER_FORGE, EMBERPROOF } from '../../data/addons.js';

export const MASTER_LVL = 15;
/** Add-on rows by id, and the master sets' skills (the skill of the recipes they add, else the bench's). */
export const ADDONS = Object.freeze(Object.fromEntries(ALL_ADDONS.map((a) => [a.id, a])));
export const ADDON_IDS = Object.freeze(ALL_ADDONS.map((a) => a.id));
export const MASTER_SKILL = Object.freeze({ matched_sets: 'woodcraft', war_smith: 'smithing', feast_hall: 'cooking', herbalist: 'medicine' });
const EMBER_BIT = 8;                       // pass.js / mapgen3 FL bits (2.8): EMBER 8, depth in the low 3 bits

const baseId = (defId) => (defId && defId.includes(':') ? defId.split(':')[0] : defId);
const done = (b) => !!b && b.st === 'done';
const alive = (c) => !!c && !(c.hp && c.hp.dead) && !c.gone;

/** Footprint rectangle of a building: [x0, y0, x1, y1, z]. */
function rectOf(b) {
  const d = structDef(b.def);
  const [w, h] = sizeOf(d, b.rot | 0);
  return [b.x, b.y, b.x + w - 1, b.y + h - 1, b.z | 0];
}
/** True when two footprints on the same level touch (Chebyshev distance 1, corners included) without overlapping. */
export function touches(a, b) {
  if (a[4] !== b[4]) return false;
  const gapX = Math.max(a[0] - b[2], b[0] - a[2]), gapY = Math.max(a[1] - b[3], b[1] - a[3]);
  return gapX <= 1 && gapY <= 1 && (gapX === 1 || gapY === 1);
}

/** True while the hold has a living colonist at Master or better in `skill`. */
export function hasMaster(s, skill) {
  for (const c of s.col) if (alive(c) && c.sk && level(c, skill) >= MASTER_LVL) return true;
  return false;
}

const memo = new WeakMap();   // s.rt -> { tick, map: bId -> [addon ids] }
/** The add-on ids open for bench building b now (data order). [] for a building that is not a bench of any. */
export function addonsOf(s, b) {
  if (!done(b)) return [];
  let m = s.rt ? memo.get(s.rt) : null;
  if (!m || m.tick !== s.tick) { m = { tick: s.tick, map: new Map() }; if (s.rt) memo.set(s.rt, m); }
  const hit = m.map.get(b.id);
  if (hit) return hit;
  const bench = baseId(b.def), out = [];
  let rb = null;
  for (const a of ALL_ADDONS) {
    if (!a.bench.includes(bench)) continue;
    if (a.form === 'master') { if (hasMaster(s, MASTER_SKILL[a.id] || 'craft')) out.push(a.id); continue; }
    rb = rb || rectOf(b);
    for (const o of s.bld) if (o && o !== b && done(o) && baseId(o.def) === a.id && touches(rb, rectOf(o))) { out.push(a.id); break; }
  }
  m.map.set(b.id, out);
  return out;
}
export const hasAddon = (s, b, id) => addonsOf(s, b).includes(id);
/** True when bench b may work recipe r (a recipe with no add-on is always open here). */
export const addonOpen = (s, b, r) => !r || !r.addon || (!!b && hasAddon(s, b, r.addon));
/** True when bench b has rule `rule` from one of its open add-ons (temper, refit, meltDown, cellarAgeing ...). */
export function benchHasRule(s, b, rule) {
  for (const id of addonsOf(s, b)) { const a = ADDONS[id]; if (a && a.adds.rules && a.adds.rules.includes(rule)) return true; }
  return false;
}
/** Extra quality rolls a bench gets from its add-ons (the ember forge: 1). */
export const extraQualityRolls = (s, b) => (hasAddon(s, b, EMBER_FORGE.id) ? EMBER_FORGE.qualityRolls : 0);
/** True when a bench beside an ember forge works without fuel (its { cat: 'fuel' } ingredients are skipped). */
export const needsNoFuel = (s, b) => hasAddon(s, b, EMBER_FORGE.id) && EMBER_FORGE.noFuel;
/** True for worn item kinds that keep off Sweltering and ember splash. */
export const isEmberproof = (k) => EMBERPROOF.includes(k);
/** The verb an add-on adds (every add-on names one). */
export const verbOf = (id) => VERB_OF[id] || null;

/** An ember pool voxel (fluid ember with depth) on level z touching the rectangle [x0, y0, x1, y1]. */
export function emberBeside(s, x0, y0, x1, y1, z) {
  const fl = s.L && s.L.fluid;
  if (!fl) return false;
  for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) {
    if (!inB(x, y, z)) continue;
    const v = fl[idx(x, y, z)];
    if ((v & EMBER_BIT) && (v & 7)) return true;
  }
  return false;
}

/**
 * Why add-on structure d cannot stand at (x, y) on level z (null when it can): it must touch a finished bench it
 * serves, and the ember forge must touch an ember pool. With z unknown (an older apply.js), any level where both
 * hold is accepted.
 */
export function addonPlaceWhy(s, d, x, y, rot = 0, z = null) {
  const a = d && ADDONS[d.id];
  if (!a || a.form !== 'structure') return null;
  const [w, h] = sizeOf(d, rot);
  const levels = z === null || z === undefined ? null : [z | 0];
  let bench = false, ember = false;
  for (const b of s.bld) {
    if (!done(b) || !a.bench.includes(baseId(b.def))) continue;
    const bz = b.z | 0;
    if (levels && !levels.includes(bz)) continue;
    if (!touches([x, y, x + w - 1, y + h - 1, bz], rectOf(b))) continue;
    bench = true;
    if (a.id !== EMBER_FORGE.id || emberBeside(s, x, y, x + w - 1, y + h - 1, bz)) { ember = true; break; }
  }
  if (!bench) return `build it beside a ${a.bench.map((id) => { const sd = structDef(id); return sd ? sd.name : id; }).join(' or ')}`;
  if (!ember) return 'an ember forge must stand beside an ember pool';
  return null;
}
const placeHook = (s, d, x, y, rot, z) => { const why = addonPlaceWhy(s, d, x, y, rot, z); return why ? { ok: false, reason: why } : null; };
/** Install the placement rule (idempotent). */
export function installAddons() { if (!BUS.canPlace.includes(placeHook)) BUS.canPlace.push(placeHook); }
export function uninstallAddons() { const k = BUS.canPlace.indexOf(placeHook); if (k >= 0) BUS.canPlace.splice(k, 1); }

/** Bench sheet lines (I): [[name, verb, open]] for every add-on of this bench, in data order. */
export function addonLines(s, b) {
  const bench = baseId(b && b.def), open = addonsOf(s, b);
  return ALL_ADDONS.filter((a) => a.bench.includes(bench)).map((a) => [a.name, VERB_OF[a.id] || '', open.includes(a.id)]);
}
/** Ember-pool voxels on level z (tests and the bot's site finder). */
export function emberPoolsOn(s, z) {
  const out = [], fl = s.L && s.L.fluid;
  if (!fl) return out;
  for (let i = z * PLANE, e = i + PLANE; i < e; i++) if ((fl[i] & EMBER_BIT) && (fl[i] & 7)) out.push(i);
  return out;
}

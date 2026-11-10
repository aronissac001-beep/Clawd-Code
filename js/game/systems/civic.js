// Phase 4 civic buildings: Windmill, Fisher's Hut, Mine, Temple, Library, Alchemist,
// Ley Obelisk and the three Wonders (Sunspire, World Forge, Moonwell). Everything
// plugs into the core through BUS (js/game/hooks.js). Deterministic: no Math.random
// in anything that touches state.
//
// Region state (plain JSON): s.ext.civic = {
//   wonder: null | 'sunspire' | 'worldforge' | 'moonwell'   the run's Wonder (copied from run.ext.civic at regionInit)
//   at: night the Wonder was finished in this region (or null)
//   draft: number    exactly what this module added to s.mods.draftExtra (Library)
//   morale: number   exactly what this module added to mood(s).baseMorale (Temple)
// }
// Run state: run.ext.civic = { wonder } (folded in at BUS.runRegionEnd).
// Per-building fields (saved): b.river (Fisher: river tiles in reach), b.brewT (Alchemist timer).
// Per-mover fields (saved): v.mineG (gold owed for the stone a miner carries), e.cxp (hero xp last seen).
// Cache (not saved, rebuilt lazily from the buildings): s.rt.civ.
import { BUS } from '../hooks.js';
import { BAL } from '../../data/balance.js';
import { BUILDINGS, BUILD_ORDER, CATEGORIES, levelStats } from '../../data/buildings.js';
import { CIVIC_BUILDINGS, CIVIC_ORDER, CIVIC_TUNE as CT, WONDER_INFO } from '../../data/buildings-civic.js';
import { BUILDING_ART } from '../../engine/sprites.js';
import { CIVIC_BUILDING_ART, drawCivicOverlay } from '../../engine/civicart.js';
import { T, N, idx, inB } from '../grid.js';
import { emit, flowRes, mood, moodAdd } from './common.js';
import { gainXp, heroStats } from './heroes.js';
import { audio } from '../../engine/audio.js';

export const WONDERS = ['sunspire', 'worldforge', 'moonwell'];
const DEFAULT_BASE_MORALE = 50; // mood.js MOOD.baseMorale (used only if mood.js has not set it yet)
const cxOf = (b) => (b.tx + b.size / 2) * T;
const cyOf = (b) => (b.ty + b.size / 2) * T;
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const isWonder = (type) => !!(BUILDINGS[type] && BUILDINGS[type].wonder);

// ---- State and caches -----------------------------------------------------------------------
/** Region state for this module (plain JSON, created on first use). */
export function civicState(s) {
  const X = s.ext.civic || (s.ext.civic = { wonder: null, at: null, draft: 0, morale: 0 });
  if (typeof X.draft !== 'number') X.draft = 0;
  if (typeof X.morale !== 'number') X.morale = 0;
  if (X.wonder === undefined) X.wonder = null;
  return X;
}
/** The run's Wonder (null when none has been raised). Works for a region `s` or a `run`. */
export function wonderOf(holder) {
  const X = holder && holder.ext && holder.ext.civic;
  return (X && X.wonder) || null;
}

/** Built, standing civic buildings grouped by kind (cached in s.rt, rebuilt lazily). */
function cache(s) {
  let c = s.rt.civ;
  if (c && c.n === s.buildings.length) return c;
  c = s.rt.civ = { n: s.buildings.length, windmill: [], fisher: [], mine: new Map(), temple: [], alchemist: [], obelisk: [], glow: [], library: 0, heroXp: 0, crown: null };
  for (const b of s.buildings) {
    if (!b.built || !b.alive || !CIVIC_BUILDINGS[b.type]) continue;
    const st = levelStats(b.type, b.level);
    switch (b.type) {
      case 'windmill': c.windmill.push(b); break;
      case 'fisher': c.fisher.push(b); break;
      // Gold owed per stone carried: goldShare for every stone the Mine actually yields (stoneMult).
      case 'mine': c.mine.set(b.id, (st.goldShare || 0) * (st.stoneMult || 1)); break;
      case 'temple': c.temple.push(b); break;
      case 'alchemist': c.alchemist.push(b); break;
      case 'obelisk': c.obelisk.push(b); break;
      case 'library':
        c.library = Math.max(c.library, st.draftExtra || 0);
        c.heroXp = Math.max(c.heroXp, st.heroXp || 0);
        break;
      default: break;
    }
    if (st.glow) c.glow.push(b);
    // A level-2 Wonder standing in this region strengthens its blessing here.
    if (BUILDINGS[b.type].wonder && b.level >= 1) c.crown = b.type;
  }
  return c;
}
function dirty(s) { s.rt.civ = null; }

// ---- Registration -----------------------------------------------------------------------------
let done = false;
export function register() {
  if (done) return;
  done = true;
  // Data, art and the build bar's Civic tab.
  Object.assign(BUILDINGS, CIVIC_BUILDINGS);
  Object.assign(BUILDING_ART, CIVIC_BUILDING_ART);
  if (!CATEGORIES.some((c) => c.id === 'civic')) CATEGORIES.push({ id: 'civic', name: 'Civic', icon: 'crown' });
  if (!BUILD_ORDER.civic) BUILD_ORDER.civic = [];
  for (const cat of Object.keys(CIVIC_ORDER)) {
    const list = BUILD_ORDER[cat] || (BUILD_ORDER[cat] = []);
    for (const type of CIVIC_ORDER[cat]) if (!list.includes(type)) list.push(type);
  }

  // Run layer: the Wonder is remembered for the rest of the run.
  BUS.runRegionEnd.push(onRunRegionEnd);
  BUS.regionInit.push(onRegionInit);
  BUS.draftVeto.push(draftVeto);
  // Region.
  BUS.tick.push(onTick);
  BUS.phase.push(onPhase);
  BUS.built.push(onBuilt);
  BUS.removed.push(onRemoved);
  BUS.canPlace.push(canPlaceVeto);
  BUS.farmMult.push(farmMult);
  BUS.gatherMult.push(gatherMult);
  BUS.dmgMult.push(dmgMult);
  BUS.nightMult.push(nightMult);
  BUS.wavePlan.push(wavePlan);
  // UI and drawing.
  BUS.card.push(cardSection);
  BUS.fx.push(onFx);
  BUS.draw.overlay.push((g, s, view, time) => drawCivicOverlay(g, s, view, time));
}

// ---- Run layer ------------------------------------------------------------------------------------
function onRunRegionEnd(run, s) {
  const w = wonderOf(s);
  if (!w) return;
  run.ext = run.ext || {};
  run.ext.civic = { ...(run.ext.civic || {}), wonder: w };
}
function onRegionInit(s, ctx) {
  const X = civicState(s);
  const w = ctx && ctx.run ? wonderOf(ctx.run) : null;
  if (w && !X.wonder) X.wonder = w;
  dirty(s);
}
/** Once the run has a Wonder (raised, or its blueprint learned), no other Wonder is offered. */
function draftVeto(holder, type) {
  if (!isWonder(type)) return false;
  if (wonderOf(holder)) return true;
  const bp = holder && holder.blueprints;
  if (bp) for (let i = 0; i < bp.length; i++) if (bp[i] !== type && isWonder(bp[i])) return true;
  return false;
}

// ---- Placement -------------------------------------------------------------------------------------
/** River tiles whose centre lies within `R` tiles of a footprint's centre. */
export function riverCount(s, tx, ty, size, R) {
  const cx = tx + size / 2, cy = ty + size / 2;
  let n = 0;
  for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
    if (!inB(x, y) || s.terrain[idx(x, y)] !== CT.riverTerrain) continue;
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    if (dx * dx + dy * dy <= R * R) n++;
  }
  return n;
}
function canPlaceVeto(s, type, tx, ty) {
  const def = BUILDINGS[type];
  if (!def) return null;
  if (type === 'fisher') {
    if (!riverCount(s, tx, ty, def.size, levelStats(type, 0).radius)) return { ok: false, reason: "A Fisher's Hut must stand within 2 tiles of a river" };
    return null;
  }
  if (def.wonder) {
    const w = wonderOf(s);
    if (w) return { ok: false, reason: `This run already raised the ${BUILDINGS[w] ? BUILDINGS[w].name : 'Wonder'}: one Wonder per run` };
    for (const b of s.buildings) if (b.alive && isWonder(b.type)) return { ok: false, reason: `The ${BUILDINGS[b.type].name} is already rising: one Wonder per run` };
  }
  return null;
}

// ---- Built / removed --------------------------------------------------------------------------------
function onBuilt(s, b, upgraded) {
  if (!CIVIC_BUILDINGS[b.type]) return;
  dirty(s);
  if (b.type === 'fisher') b.river = riverCount(s, b.tx, b.ty, b.size, levelStats('fisher', b.level).radius);
  if (b.type === 'alchemist' && typeof b.brewT !== 'number') b.brewT = 0;
  if (b.type === 'library') recomputeDraft(s);
  if (b.type === 'temple') {
    const before = civicState(s).morale;
    recomputeMorale(s);
    if (civicState(s).morale > before) moodAdd(s, 3, 0, 'The Temple bells ring for the first vigil');
  }
  if (isWonder(b.type) && !upgraded) completeWonder(s, b);
  else if (isWonder(b.type) && upgraded) emit(s, { t: 'wonder', id: b.type, x: cxOf(b), y: cyOf(b), crown: true });
}
function onRemoved(s, b, destroyed) {
  if (!CIVIC_BUILDINGS[b.type]) return;
  dirty(s);
  // A finished Wonder's blessing belongs to the run, so tearing it down must not also pay back
  // half its price (the demolish command refunded 50% of the base cost just before this).
  if (!destroyed && b.built && isWonder(b.type) && wonderOf(s) === b.type) {
    const base = BUILDINGS[b.type].levels[0].cost || {};
    for (const k in base) s.res[k] = Math.max(0, s.res[k] - Math.floor(base[k] * 0.5));
    emit(s, { t: 'toast', text: `The ${BUILDINGS[b.type].name} is torn down. Its stones are spent, but its blessing stays with the run.`, tone: 'bad', icon: 'info' });
  }
  if (b.type === 'library') recomputeDraft(s);
  if (b.type === 'temple') recomputeMorale(s);
  if (b.type === 'obelisk' || (BUILDINGS[b.type].wonder && levelStats(b.type, b.level).glow)) s.rt.lightDirty = true;
}

function completeWonder(s, b) {
  const X = civicState(s);
  if (X.wonder) return; // one per run (placement already forbids a second)
  X.wonder = b.type; X.at = s.cycle.night;
  moodAdd(s, CT.wonderMorale, 0, `The ${BUILDINGS[b.type].name} is finished`);
  // The UI shows a banner for this event (onFx); the Morale toast comes from mood.
  emit(s, { t: 'wonder', id: b.type, x: cxOf(b), y: cyOf(b) });
}

/** Library: +draftExtra once while any Library stands (several do not stack). */
function recomputeDraft(s) {
  const X = civicState(s);
  const want = cache(s).library;
  const d = want - X.draft;
  if (!d) return;
  s.mods.draftExtra = r6((s.mods.draftExtra || 0) + d);
  X.draft = want;
}
/** Temple: the best standing Temple raises the level Morale settles toward. */
function recomputeMorale(s) {
  const X = civicState(s);
  let best = 0;
  for (const b of cache(s).temple) best = Math.max(best, levelStats(b.type, b.level).morale || 0);
  const d = best - X.morale;
  if (!d) return;
  const m = mood(s);
  if (typeof m.baseMorale !== 'number') m.baseMorale = DEFAULT_BASE_MORALE;
  m.baseMorale = r6(m.baseMorale + d);
  X.morale = best;
}

// ---- Rates (shared by the sim and the info card) ------------------------------------------------------
/** Fisher's Hut food a minute. */
export function fisherRate(s, b) {
  const st = levelStats('fisher', b.level);
  if (typeof b.river !== 'number') b.river = riverCount(s, b.tx, b.ty, b.size, st.radius);
  return Math.min(st.cap, st.perTile * b.river);
}
/** Best Windmill boost covering this farm's centre (0 if none). */
export function windmillBoost(s, farm) {
  const ws = cache(s).windmill;
  if (!ws.length) return 0;
  const fx = cxOf(farm), fy = cyOf(farm);
  let best = 0;
  for (let i = 0; i < ws.length; i++) {
    const b = ws[i], st = levelStats('windmill', b.level);
    const dx = cxOf(b) - fx, dy = cyOf(b) - fy, R = st.radius * T;
    if (dx * dx + dy * dy <= R * R && st.farmBoost > best) best = st.farmBoost;
  }
  return best;
}
/** Extra magic damage share for a Hollow at (x, y) (0 if no Obelisk reaches it). */
export function obeliskBoost(s, x, y) {
  const os = cache(s).obelisk;
  let best = 0;
  for (let i = 0; i < os.length; i++) {
    const b = os[i], st = levelStats('obelisk', b.level);
    const dx = cxOf(b) - x, dy = cyOf(b) - y, R = st.radius * T;
    if (dx * dx + dy * dy <= R * R && st.magic > best) best = st.magic;
  }
  return best;
}
/** Armor the World Forge adds to friendly fighters in this region (0 without it). */
export function forgeArmor(s) {
  if (wonderOf(s) !== 'worldforge') return 0;
  return cache(s).crown === 'worldforge' ? CT.wonderArmorL2 : CT.wonderArmor;
}
/** Night length multiplier from the Sunspire (1 without it). */
export function sunNight(s) {
  if (wonderOf(s) !== 'sunspire') return 1;
  return cache(s).crown === 'sunspire' ? CT.sunNightL2 : CT.sunNight;
}

// ---- Multipliers -------------------------------------------------------------------------------------
function farmMult(s, farm) { const k = windmillBoost(s, farm); return k ? 1 + k : 1; }
function gatherMult(s, b, k) { return b && b.type === 'mine' && k === 'stone' ? levelStats('mine', b.level).stoneMult : 1; }
function nightMult(s) { return sunNight(s); }

function dmgMult(s, a, t, type) {
  if (t.kind === 'enemy') {
    if (type === 'magic') { const k = obeliskBoost(s, t.x, t.y); if (k) return 1 + k; }
    return 1;
  }
  if (t.kind !== 'soldier' && t.kind !== 'hero' && t.kind !== 'sovereign') return 1;
  const add = forgeArmor(s);
  if (!add) return 1;
  const a0 = Math.min(CT.armorCap, t.armor || 0);
  const a1 = Math.min(CT.armorCap, a0 + add);
  // hurt() then multiplies by (1 - armor): the result equals the damage at armor a1.
  return (1 - a1) / (1 - a0);
}

/** Moonwell: a Blood Moon's wave is not doubled (the Warden still walks). */
function wavePlan(s, w) {
  if (!w.blood || wonderOf(s) !== 'moonwell') return;
  const mult = BAL.waves.bloodMoonMult;
  let cut = 0;
  for (const g of w.groups) {
    if (g.rift || g.battlefield) continue; // never doubled by the moon in the first place
    const plain = [], wardens = [];
    for (const u of g.units) (u[1] === 'warden' ? wardens : plain).push(u);
    const keep = plain.length ? Math.max(1, Math.round(plain.length / mult)) : 0;
    cut += plain.length - keep;
    plain.length = keep;
    g.units = plain.concat(wardens);
  }
  if (!w.mods) w.mods = [];
  w.mods.push({ id: 'moonwell', name: 'Moonwell', text: `The Moonwell drinks the Blood Moon: ${cut} fewer foes than a true Blood Moon, and its dawn will be a blessing.` });
}

// ---- Per tick ---------------------------------------------------------------------------------------
const healSeen = new Set();
let healAmt = 0, healKinds = 0, healS = null;
const K_SOLDIER = 1, K_HERO = 2, K_SOV = 4;
function healOne(e) {
  const k = e.kind === 'soldier' ? K_SOLDIER : e.kind === 'hero' ? K_HERO : e.kind === 'sovereign' ? K_SOV : 0;
  if (!(k & healKinds) || !e.alive || e.hp >= e.maxHp || healSeen.has(e.id)) return false;
  healSeen.add(e.id);
  const before = e.hp;
  e.hp = Math.min(e.maxHp, e.hp + healAmt);
  if (e.hp - before > 0.01) emit(healS, { t: 'heal', x: e.x, y: e.y, amt: e.hp - before });
  return false;
}
function healAround(s, b, amt, kinds) {
  healAmt = amt; healKinds = kinds; healS = s;
  s.rt.friendHash.each(cxOf(b), cyOf(b), levelStats(b.type, b.level).radius * T, healOne);
}

/** Stamp the glow of Obelisks and the Sunspire into the combat light map (after the core's recompute). */
function stampGlow(s, c) {
  for (let i = 0; i < c.glow.length; i++) {
    const b = c.glow[i];
    const r = levelStats(b.type, b.level).glow * (s.mods.lightMult || 1);
    const cx = b.tx + b.size / 2, cy = b.ty + b.size / 2;
    for (let ty = Math.floor(cy - r); ty <= Math.ceil(cy + r); ty++) for (let tx = Math.floor(cx - r); tx <= Math.ceil(cx + r); tx++) {
      if (!inB(tx, ty)) continue;
      const dx = tx + 0.5 - cx, dy = ty + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) s.lit[idx(tx, ty)] = 1;
    }
  }
}

function onTick(s, dt) {
  const c = cache(s);
  if (c.glow.length) stampGlow(s, c);
  // Fisher's Huts: steady food.
  for (let i = 0; i < c.fisher.length; i++) flowRes(s, 'food', (fisherRate(s, c.fisher[i]) / 60) * dt);
  // Alchemists: wood into gold once a minute.
  for (let i = 0; i < c.alchemist.length; i++) brew(s, c.alchemist[i], dt);
  // Miners: a vein of gold with every load of stone they bring home.
  if (c.mine.size) mineGold(s, c);
  // Healing pulses (twice a second): Temples heal soldiers and heroes, Alchemists (level 2) the Sovereign and soldiers.
  if (s.tick % CT.healEvery === 0 && (c.temple.length || c.alchemist.length)) {
    const step = dt * CT.healEvery;
    healSeen.clear();
    for (const b of c.temple) healAround(s, b, levelStats('temple', b.level).heal * step, K_SOLDIER | K_HERO);
    healSeen.clear();
    for (const b of c.alchemist) { const st = levelStats('alchemist', b.level); if (st.heal) healAround(s, b, st.heal * step, K_SOLDIER | K_SOV); }
    healSeen.clear(); healS = null;
  }
  // Library (level 2): every bit of experience a hero earns grows by heroXp.
  if (s.tick % 10 === 0 && s.heroes && s.heroes.length) libraryXp(s, c);
}

function brew(s, b, dt) {
  const st = levelStats('alchemist', b.level).brew;
  b.brewT = (b.brewT || 0) + dt;
  if (b.brewT < st.every) return;
  if (s.res.wood <= st.min || s.res.wood < st.wood) { b.brewT = st.every; b.idle = true; return; } // wait for wood
  b.brewT = 0; b.idle = false;
  flowRes(s, 'wood', -st.wood);
  const gold = st.gold * (s.rt.goldMult || 1);
  flowRes(s, 'gold', gold);
  emit(s, { t: 'gain', k: 'gold', a: gold, x: cxOf(b), y: b.ty * T - 6 });
  emit(s, { t: 'sfx', k: 'coin', x: cxOf(b), y: cyOf(b) });
}

function mineGold(s, c) {
  for (let i = 0; i < s.villagers.length; i++) {
    const v = s.villagers[i];
    if (v.carryK === 'stone' && v.job && c.mine.has(v.job)) { v.mineG = v.carryA * c.mine.get(v.job); continue; }
    if (!v.mineG) continue;
    // The load was set down this tick (at the Mine, or in a shelter at dusk).
    if (v.alive && !v.carryK) {
      const g = v.mineG * (s.rt.goldMult || 1);
      flowRes(s, 'gold', g);
      emit(s, { t: 'gain', k: 'gold', a: g, x: v.x + 8, y: v.y - 20 });
    }
    v.mineG = 0;
  }
}

function libraryXp(s, c) {
  const bonus = c.heroXp;
  for (let i = 0; i < s.heroes.length; i++) {
    const e = s.heroes[i];
    if (!e.alive || typeof e.xp !== 'number') continue;
    if (typeof e.cxp !== 'number' || e.cxp > e.xp) { e.cxp = e.xp; continue; }
    const d = e.xp - e.cxp;
    if (d > 0 && bonus > 0) {
      const st = heroStats(s, e);
      const flag = (s.ext.combos && s.ext.combos.flags && s.ext.combos.flags.heroXp) || 1;
      const mult = (st.xpMult || 1) * flag;
      gainXp(s, e, (d * bonus) / mult); // gainXp multiplies back: exactly +bonus of what was earned
    }
    e.cxp = e.xp;
  }
}

// ---- Phases -------------------------------------------------------------------------------------------
function onPhase(s, phase) {
  if (phase !== 'dawn') return;
  const c = cache(s);
  // Temple (level 2): the dawn vigil eases Dread.
  let ease = 0;
  for (const b of c.temple) ease = Math.max(ease, levelStats('temple', b.level).dawnDread || 0);
  if (ease) moodAdd(s, 0, -ease, 'The Temple keeps its dawn vigil');
  const w = wonderOf(s);
  if (w !== 'moonwell') return;
  if (c.crown === 'moonwell') moodAdd(s, CT.moonL2.morale, -CT.moonL2.dread, 'The Moonwell shines at dawn');
  if (s.wave && s.wave.blood) moonBlessing(s);
}

function moonBlessing(s) {
  const B = CT.moonDawn;
  moodAdd(s, B.morale, -B.dread, 'The Moonwell turns the Blood Moon into a blessing');
  flowRes(s, 'gold', B.gold);
  let healed = 0;
  const all = (e) => { if (e && e.alive && e.hp < e.maxHp) { e.hp = e.maxHp; healed++; } };
  for (const u of s.soldiers) all(u);
  for (const h of s.heroes || []) all(h);
  all(s.sovereign);
  const mw = s.buildings.find((b) => b.alive && b.type === 'moonwell');
  const at = mw || s.rt.hearth;
  emit(s, { t: 'wonderBless', id: 'moonwell', x: at ? cxOf(at) : undefined, y: at ? cyOf(at) : undefined });
  emit(s, { t: 'toast', text: `The Moonwell blesses the Blood Moon's dawn: +${B.gold} gold, Morale +${B.morale}, Dread -${B.dread}${healed ? `, ${healed} fighter${healed > 1 ? 's' : ''} healed` : ''}.`, tone: 'good', icon: 'moon' });
}

// ---- UI: info card -------------------------------------------------------------------------------------
const pct = (v) => `${Math.round(v * 100)}%`;
/** One line describing what a civic building does at a level's stats. */
export function effectLine(type, st) {
  switch (type) {
    case 'windmill': return `Farms within ${st.radius} tiles grow +${pct(st.farmBoost)} food.`;
    case 'fisher': return `${st.perTile} food a minute per river tile in reach, up to ${st.cap}.`;
    case 'mine': return `${st.workers} miners. Each load is ${pct(st.stoneMult)} of a Quarry's stone, plus ${st.goldShare} gold for every stone.`;
    case 'temple': return `Morale settles ${st.morale} higher. Soldiers and heroes within ${st.radius} tiles heal ${st.heal} health a second.${st.dawnDread ? ` Dread -${st.dawnDread} every dawn.` : ''}`;
    case 'library': return `+${st.draftExtra} option in blueprint drafts and Dawn Offerings.${st.heroXp ? ` Heroes gain +${pct(st.heroXp)} experience.` : ''}`;
    case 'alchemist': return `Every ${st.brew.every} s: ${st.brew.wood} wood into ${st.brew.gold} gold (while you hold more than ${st.brew.min} wood).${st.heal ? ` The Sovereign and soldiers within ${st.radius} tiles heal ${st.heal} health a second.` : ''}`;
    case 'obelisk': return `Hollow within ${st.radius} tiles take +${pct(st.magic)} magic damage. Lights the ground for ${st.glow} tiles.`;
    default: return '';
  }
}
function para(box, text, strong) {
  const p = document.createElement('p');
  if (strong) { const b = document.createElement('b'); b.textContent = text; p.appendChild(b); } else p.textContent = text;
  box.appendChild(p);
  return p;
}
function cardSection(box, s, b) {
  if (typeof document === 'undefined') return;
  const def = BUILDINGS[b.type];
  if (b.type === 'hearth') {
    const w = wonderOf(s);
    if (w && WONDER_INFO[w]) para(box, `Wonder of this run, the ${BUILDINGS[w].name}: ${WONDER_INFO[w].blessing}`, true);
    return;
  }
  if (!CIVIC_BUILDINGS[b.type]) return;
  const st = levelStats(b.type, b.level);
  if (def.wonder) {
    const info = WONDER_INFO[b.type];
    if (wonderOf(s) === b.type) para(box, `Blessing (for the rest of the run): ${info.blessing}`, true);
    else para(box, `When finished: ${info.blessing}`);
    if (def.levels[b.level + 1]) para(box, `Level 2: ${info.crown}`);
    else para(box, `Crowned. ${info.crown}`);
    if (b.built && wonderOf(s) === b.type) para(box, 'Demolishing it returns nothing; the blessing stays with the run.');
    return;
  }
  para(box, 'Now: ' + effectLine(b.type, st));
  const next = def.levels[b.level + 1];
  if (next) para(box, 'Next level: ' + effectLine(b.type, next));
  if (!b.built) return;
  const c = cache(s);
  switch (b.type) {
    case 'windmill': {
      let n = 0;
      for (const f of s.buildings) {
        if (f.type !== 'farm' || !f.built || !f.alive) continue;
        const dx = cxOf(f) - cxOf(b), dy = cyOf(f) - cyOf(b), R = st.radius * T;
        if (dx * dx + dy * dy <= R * R) n++;
      }
      para(box, n ? `Grinding for ${n} farm${n > 1 ? 's' : ''}.` : 'No farm in range yet: build Farms nearby.', !n);
      break;
    }
    case 'fisher': para(box, `${b.river || 0} river tile${b.river === 1 ? '' : 's'} in reach: ${Math.round(fisherRate(s, b) * 10) / 10} food a minute.`); break;
    case 'library': if (c.library) para(box, 'Drafts and Dawn Offerings now show one more option.'); break;
    case 'alchemist': {
      const bt = st.brew;
      if (b.idle && s.res.wood <= bt.min) para(box, `Waiting for wood: needs more than ${bt.min} in store.`, true);
      else para(box, `Next batch in ${Math.max(0, Math.ceil(bt.every - (b.brewT || 0)))} s.`);
      break;
    }
    default: break;
  }
}

// ---- Feedback (UI layer: particles, banner, sound) -----------------------------------------------------
function onFx(ctl, ev) {
  if (ev.t === 'wonder') {
    const info = WONDER_INFO[ev.id] || {};
    const name = BUILDINGS[ev.id] ? BUILDINGS[ev.id].name : 'Wonder';
    if (ctl.hud && ctl.hud.showBanner) {
      if (ev.crown) ctl.hud.showBanner(`THE ${name.toUpperCase()} IS CROWNED`, info.crown || '', 'dawn', 4200);
      else ctl.hud.showBanner('A WONDER RISES', `The ${name}. ${info.blessing || ''}`, 'dawn', 5200);
    }
    try { audio.play(ev.crown ? 'dawn' : 'victory'); } catch (_) { /* audio may be locked */ }
    if (ctl.shake) ctl.shake(ev.crown ? 4 : 9);
    const P = ctl.renderer && ctl.renderer.particles;
    if (P && ev.x !== undefined) {
      const col = info.color || '#ffe08a';
      P.burst('ember', ev.x, ev.y - 40, ev.crown ? 40 : 90, { speed: 190, color: [col, '#fff2c8', '#ffffff'], life: 1.6, size: 3.2, add: true, drag: 0.86 });
      P.burst('spark', ev.x, ev.y - 70, ev.crown ? 20 : 50, { speed: 120, color: [col, '#fff8e0'], life: 1.3, size: 2.6, add: true });
      for (let i = 0; i < 3; i++) P.spawn('ring', ev.x, ev.y, { life: 0.9 + i * 0.35, size: 150 + i * 70, color: col, add: true, drag: 1 });
      P.burst('puff', ev.x, ev.y, 24, { speed: 70, color: '#d8c8a8', life: 1.2, size: 9 });
    }
  } else if (ev.t === 'wonderBless') {
    try { audio.play('dawn'); } catch (_) { /* audio may be locked */ }
    const P = ctl.renderer && ctl.renderer.particles;
    if (P && ev.x !== undefined) {
      P.burst('spark', ev.x, ev.y - 30, 50, { speed: 110, color: ['#a8c8ff', '#e8f0ff', '#ffffff'], life: 1.4, size: 2.8, add: true });
      P.spawn('ring', ev.x, ev.y, { life: 1.2, size: 180, color: '#a8c8ff', add: true, drag: 1 });
    }
    if (ctl.hud && ctl.hud.showBanner) ctl.hud.showBanner('THE MOONWELL BLESSES THE DAWN', 'The Blood Moon is spent. Gold, Morale and healing for the realm.', 'dawn', 4200);
  }
}

void N;

// The six factions made real: unique units and buildings, passives and drawbacks.
// Everything plugs into the core through BUS (js/game/hooks.js).
// Region state: s.ext.factions (+ souls/grow/fade/low for the Pale Court). Movers may
// carry e.poison = { t, dps } and e.curse (seconds) in Mirefolk regions; Ossuaries
// carry b.raiseN (dawns since the last raising). Caches: s.rt.facB (unique buildings
// by kind), s.rt.facIron (live Ironshields this tick), s.rt.mireWinter (this tick).
// Deterministic: no Math.random outside drawing.
import { BUS, isLocked, first } from '../hooks.js';
import { FACTIONS } from '../../data/factions.js';
import { UNITS } from '../../data/units.js';
import { BUILDINGS, BUILD_ORDER, levelStats } from '../../data/buildings.js';
import { ENEMIES } from '../../data/enemies.js';
import { FACTION_UNITS, FACTION_BUILDINGS, FACTION_TUNING as FT } from '../../data/faction-content.js';
import { UNIT_ART, BUILDING_ART } from '../../engine/sprites.js';
import * as SPR from '../../engine/sprites.js';
import { FACTION_UNIT_ART, FACTION_BUILDING_ART, FACTION_SIGILS, drawSoulIcon } from '../../engine/factionart.js';
import { T, N, idx, inB, tileOf, TER_BUILDABLE, TER_PASSABLE } from '../grid.js';
import { BAL } from '../../data/balance.js';
import { emit, flowRes, mood, moodAdd, getE, hurt, popCap, spawnVillager, spawnSoldier, accessTile } from './common.js';
import { makeBoonChoice } from './cycle.js';
import { solidForFriend } from './pathing.js';
import { squadFor, squadSize } from './buildings.js';

const TURRETS = { tower: 1, ballista: 1, spire: 1 };
const LANCER = FACTION_UNITS.lancer;
const UNIQUE = { cathedral: 'cath', hearttree: 'tree', runeforge: 'forge', wardrum: 'drum', bogshrine: 'bog', ossuary: 'oss' };
const RIVER = 4;
const NODE_ID_BASE = 900000;   // regrown trees take ids far above mapgen's
const DEFAULT_BASE_MORALE = 50; // mood.js MOOD.baseMorale (only used if mood.js has not set it)

// ---- State and caches ------------------------------------------------------------------
/** Region state for this module (plain JSON). */
export function factionState(s) {
  let x = s.ext.factions;
  if (!x) {
    x = s.ext.factions = { woodSeen: (s.stats.produced && s.stats.produced.wood) || 0, nid: 0, regrow: [], rune: {}, morale: 0, plunder: 0 };
  }
  return x;
}

/** Built, standing unique buildings grouped by kind (cached in s.rt, rebuilt lazily). */
function uniq(s) {
  let c = s.rt.facB;
  if (c && c.n === s.buildings.length) return c;
  c = s.rt.facB = { n: s.buildings.length, cath: [], tree: [], forge: [], drum: [], bog: [], oss: [] };
  for (const b of s.buildings) {
    const k = UNIQUE[b.type];
    if (k && b.built && b.alive) c[k].push(b);
  }
  return c;
}

const isFriend = (e) => e.kind === 'soldier' || e.kind === 'hero' || e.kind === 'sovereign';
const cxOf = (b) => (b.tx + b.size / 2) * T;
const cyOf = (b) => (b.ty + b.size / 2) * T;
const r6 = (v) => Math.round(v * 1e6) / 1e6;

/** True when `type` is a faction-unique building that faction `f` may not build. */
export function isForeignUnique(type, f) {
  const def = BUILDINGS[type];
  return !!(def && def.faction && def.faction !== f);
}

// ---- Registration --------------------------------------------------------------------------
let done = false;
export function register() {
  if (done) return;
  done = true;
  // Data and art.
  Object.assign(UNITS, FACTION_UNITS);
  Object.assign(BUILDINGS, FACTION_BUILDINGS);
  Object.assign(UNIT_ART, FACTION_UNIT_ART);
  Object.assign(BUILDING_ART, FACTION_BUILDING_ART);
  // Sigils for the setup screen and banners, once sprites.js offers a SIGIL_EXT table.
  if (SPR.SIGIL_EXT) Object.assign(SPR.SIGIL_EXT, FACTION_SIGILS);
  for (const [type, def] of Object.entries(FACTION_BUILDINGS)) {
    const list = BUILD_ORDER[def.cat] || (BUILD_ORDER[def.cat] = []);
    if (!list.includes(type)) list.push(type);
  }

  // Run layer.
  BUS.runNew.push(onRunNew);
  BUS.runRegion.push(onRunRegion);
  // Region.
  BUS.regionInit.push(onRegionInit);
  BUS.tick.push(onTick);
  BUS.phase.push(onPhase);
  BUS.built.push(onBuiltOrRemoved);
  BUS.removed.push(onBuiltOrRemoved);
  BUS.kill.push(onKill);
  BUS.canPlace.push(vetoForeign);
  BUS.dmgMult.push(dmgMult);
  BUS.costMult.push(costMult);
  BUS.gatherMult.push(gatherMult);
  BUS.upkeepMult.push(upkeepMult);
  BUS.workMult.push(workMult);
  BUS.allowTerrain.push(allowShallows);
  BUS.canPlace.push(vetoShallows);
  const prevClaim = BUS.query.claimRule;
  BUS.query.claimRule = (s, zone) => claimRule(s, zone) || (prevClaim ? prevClaim(s, zone) : null);
  // UI and drawing.
  BUS.card.push(cardSection);
  BUS.draw.ground.push(drawGround);
  BUS.draw.overlay.push(drawOverlay);
  BUS.hud.push(soulWidget);
  BUS.fx.push(onFx);
}

// ---- Run layer --------------------------------------------------------------------------------
function ensureBlueprints(list, faction) {
  const f = FACTIONS[faction];
  for (let i = list.length - 1; i >= 0; i--) if (isForeignUnique(list[i], faction)) list.splice(i, 1);
  if (f && f.building && BUILDINGS[f.building] && !list.includes(f.building)) list.push(f.building);
}
function onRunNew(run) { ensureBlueprints(run.blueprints, run.faction); }
function onRunRegion(run, node, params) {
  ensureBlueprints(run.blueprints, run.faction);
  if (run.faction === 'deepforge') params.mods.buildSpeed = (params.mods.buildSpeed || 0) - FT.buildSlow;
  if (run.faction === 'emberkin') params.start.villagers = (params.start.villagers || 0) - 1;
}

// ---- Region lifecycle ---------------------------------------------------------------------------
function onRegionInit(s, ctx) {
  const x = factionState(s);
  x.woodSeen = (s.stats.produced && s.stats.produced.wood) || 0;
  if (s.blueprints && s.blueprints.length) ensureBlueprints(s.blueprints, s.faction);
  if (s.faction === 'emberkin') mood(s).dropMult = FT.moraleDrop;
  if (s.faction === 'palecourt') initPale(s);
  // Standalone regions (no run) get the run-layer drawbacks here instead.
  if (!ctx || !ctx.run) {
    if (s.faction === 'deepforge') s.mods.buildSpeed -= FT.buildSlow;
    if (s.faction === 'emberkin' && s.villagers.length > 1) {
      const v = s.villagers.pop();
      s.rt.eById.delete(v.id);
    }
  }
}

function onBuiltOrRemoved(s, b, flag) {
  s.rt.facB = null;
  if (b.type === 'ossuary' && s.faction === 'palecourt') clampSouls(s);
  const k = UNIQUE[b.type];
  if (k === 'forge' || TURRETS[b.type]) recomputeRunes(s);
  if (k === 'cath') {
    const before = factionState(s).morale;
    recomputeMorale(s);
    if (factionState(s).morale > before) moodAdd(s, 4, 0, 'The bells of the Cathedral of Dawn ring out');
  }
}

// Cathedral of Dawn: +morale per level to the level mood drifts toward, while standing.
function recomputeMorale(s) {
  const x = factionState(s);
  let total = 0;
  for (const b of uniq(s).cath) total += levelStats(b.type, b.level).morale || 0;
  const d = total - x.morale;
  if (!d) return;
  const m = mood(s);
  if (typeof m.baseMorale !== 'number') m.baseMorale = DEFAULT_BASE_MORALE;
  m.baseMorale += d;
  x.morale = total;
}

// Runeforge: best forge in range gives turrets bonusDmg / bonusRange. We keep a record
// of exactly what we added per building (x.rune[id] = [dmg, range]) so recomputes
// never double-apply and never disturb bonuses other modules add.
function recomputeRunes(s) {
  const x = factionState(s);
  const rec = x.rune;
  const forges = uniq(s).forge;
  const seen = {};
  for (const b of s.buildings) {
    if (!TURRETS[b.type] || !b.alive) continue;
    seen[b.id] = 1;
    let dmg = 0, rng = 0;
    const bx = cxOf(b), by = cyOf(b);
    for (const f of forges) {
      const st = levelStats(f.type, f.level);
      const dx = cxOf(f) - bx, dy = cyOf(f) - by, R = st.radius * T;
      if (dx * dx + dy * dy <= R * R && st.dmgBonus > dmg) { dmg = st.dmgBonus; rng = st.rangeBonus; }
    }
    const prev = rec[b.id] || [0, 0];
    if (prev[0] !== dmg || prev[1] !== rng) {
      b.bonusDmg = r6((b.bonusDmg || 0) - prev[0] + dmg);
      b.bonusRange = r6((b.bonusRange || 0) - prev[1] + rng);
    }
    if (dmg || rng) rec[b.id] = [dmg, rng]; else delete rec[b.id];
  }
  for (const id in rec) if (!seen[id]) delete rec[id];
}

// ---- Per tick ---------------------------------------------------------------------------------------
let healAmt = 0, healAll = false;
function healOne(e) {
  if ((e.kind === 'soldier' || (healAll && (e.kind === 'hero' || e.kind === 'sovereign'))) && e.hp < e.maxHp) {
    e.hp = Math.min(e.maxHp, e.hp + healAmt);
  }
  return false;
}

function ironCount(s) {
  let n = 0;
  for (let i = 0; i < s.soldiers.length; i++) if (s.soldiers[i].alive && s.soldiers[i].type === 'ironshield') n++;
  return n;
}

function onTick(s, dt) {
  const x = factionState(s);
  if (s.faction === 'mirefolk') tickMire(s, dt);
  else if (s.faction === 'palecourt') tickPale(s, dt, x);
  // Soldiers: Lancer charge bookkeeping, Berserker frenzy, Ironshield count.
  let iron = 0;
  const chargeDist = FT.chargeTiles * T;
  for (let i = 0; i < s.soldiers.length; i++) {
    const u = s.soldiers[i];
    if (!u.alive) continue;
    if (u.type === 'lancer') {
      // Only real riding counts: crowd jostle (separation) while locked in melee
      // must not build up a charge, so skip while the target is within reach and
      // ignore steps far shorter than a gallop stride.
      const mv = Math.hypot(u.x - u.px, u.y - u.py);
      const t = u.targetId ? getE(s, u.targetId) : null;
      let engaged = false;
      if (t) {
        const dx = t.x - u.x, dy = t.y - u.y, reach = LANCER.range * T + t.r + u.r * 0.5 + 2;
        engaged = dx * dx + dy * dy <= reach * reach;
      }
      if (!engaged && mv > LANCER.speed * T * dt * 0.35) {
        u.chIdle = 0;
        u.chDist = (u.chDist || 0) + mv;
        if (u.chDist >= chargeDist) u.chargeReady = true;
      } else {
        u.chIdle = (u.chIdle || 0) + dt;
        if (u.chIdle > FT.chargeForget) { u.chDist = 0; u.chargeReady = false; }
      }
    } else if (u.type === 'berserker') {
      // A fresh swing resets the cooldown upward; shorten it while in frenzy.
      const last = u.bzCd === undefined ? u.cd : u.bzCd;
      if (u.cd > last + 1e-6 && u.hp < u.maxHp * FT.frenzyAt) u.cd *= FT.frenzyCd;
      u.bzCd = u.cd;
    } else if (u.type === 'ironshield') iron++;
  }
  s.rt.facIron = iron;

  // Healing auras, twice a second.
  if (s.tick % 10 === 0) {
    const c = uniq(s);
    const step = dt * 10;
    for (const b of c.cath) {
      const st = levelStats(b.type, b.level);
      healAmt = st.heal * step; healAll = false;
      s.rt.friendHash.each(cxOf(b), cyOf(b), st.radius * T, healOne);
    }
    for (const b of c.tree) {
      const st = levelStats(b.type, b.level);
      healAmt = st.heal * step; healAll = true;
      s.rt.friendHash.each(cxOf(b), cyOf(b), st.radius * T, healOne);
    }
  }

  // Sylvari: woodcutters also bring home food; note new stumps for regrowth.
  if (s.faction === 'sylvari') {
    const w = (s.stats.produced && s.stats.produced.wood) || 0;
    if (w > x.woodSeen) {
      const d = w - x.woodSeen;
      x.woodSeen = w;
      flowRes(s, 'food', d * FT.sylvariFoodPerWood);
    } else if (w < x.woodSeen) x.woodSeen = w;
    if (s.tick % 20 === 0) {
      for (const d of s.decals) {
        if (d.k !== 'stump' || d.rg !== undefined) continue;
        d.rg = s.cycle.night;
        x.regrow.push({ tx: tileOf(d.x), ty: tileOf(d.y), v: d.v || 0, n: s.cycle.night });
      }
      if (x.regrow.length > 240) x.regrow.splice(0, x.regrow.length - 240);
    }
  }
}

// ---- Phases -----------------------------------------------------------------------------------------
function onPhase(s, phase) {
  if (s.faction === 'palecourt') lockMorale(s);
  if (phase !== 'dawn') return;
  if (s.faction === 'palecourt') raiseLegion(s);
  // A dawn draft never offers another faction's unique building.
  const p = s.pending;
  if (p && p.kind === 'blueprint' && Array.isArray(p.options)) fixDraft(s, p);
  if (s.faction === 'sylvari') regrowTrees(s);
}

// Swap other factions' unique buildings out of a draft for ones this faction may learn
// (deterministic: region RNG). An empty draft becomes a boon choice.
function fixDraft(s, p) {
  const n = p.options.length;
  p.options = p.options.filter((t) => !isForeignUnique(t, s.faction));
  if (p.options.length < n) {
    const known = s.blueprints || [];
    const pool = Object.keys(BUILDINGS).filter((t) => BUILDINGS[t].cat && !known.includes(t) && !p.options.includes(t) && !isForeignUnique(t, s.faction)
      && !isLocked(s, 'buildings', t) && !(BUS.draftVeto.length && first(BUS.draftVeto, s, t)));
    const r = s.rt.rng;
    while (p.options.length < n && pool.length) p.options.push(pool.splice(r.int(0, pool.length - 1), 1)[0]);
  }
  if (!p.options.length) s.pending = makeBoonChoice(s);
}

let probeHit = false;
function probe() { probeHit = true; return true; }

function regrowTrees(s) {
  const x = factionState(s);
  let grown = 0;
  for (let i = x.regrow.length - 1; i >= 0; i--) {
    const r = x.regrow[i];
    const age = s.cycle.night - r.n;
    if (age < FT.regrowNights) continue;
    if (age > FT.regrowNights + 8) { x.regrow.splice(i, 1); continue; } // long blocked: give up
    if (!inB(r.tx, r.ty)) { x.regrow.splice(i, 1); continue; }
    const ti = idx(r.tx, r.ty);
    if (s.occ[ti] || s.nodeGrid[ti] || !TER_BUILDABLE[s.terrain[ti]]) continue;
    const wx = (r.tx + 0.5) * T, wy = (r.ty + 0.5) * T;
    probeHit = false;
    s.rt.friendHash.each(wx, wy, 14, probe);
    if (!probeHit) s.rt.enemyHash.each(wx, wy, 14, probe);
    if (probeHit) continue; // someone is standing there: try next dawn
    x.nid = (x.nid || 0) + 1;
    const n = { id: NODE_ID_BASE + x.nid, kind: 'tree', tx: r.tx, ty: r.ty, amount: 25, max: 25, v: r.v };
    s.nodes.push(n);
    s.nodeGrid[ti] = n.id;
    s.rt.nById.set(n.id, n);
    for (let k = s.decals.length - 1; k >= 0; k--) {
      const d = s.decals[k];
      if (d.k === 'stump' && tileOf(d.x) === r.tx && tileOf(d.y) === r.ty) { s.decals.splice(k, 1); break; }
    }
    x.regrow.splice(i, 1);
    emit(s, { t: 'regrow', x: wx, y: wy });
    grown++;
  }
  if (grown) {
    s.rt.flowDirty = true; s.rt.terrainDirty = true;
    emit(s, { t: 'toast', text: grown === 1 ? 'A felled tree has grown back.' : `${grown} felled trees have grown back.`, tone: 'good', icon: 'wood' });
  }
}

// ---- Kills (Emberkin plunder) --------------------------------------------------------------------
function onKill(s, e) {
  if (s.faction === 'palecourt') { reapSoul(s, e); return; }
  if (s.faction !== 'emberkin' || e.kind !== 'enemy') return;
  const def = ENEMIES[e.type];
  const P = FT.plunder;
  const amt = e.boss || (def && def.boss) ? P.boss : def && def.tags && def.tags.includes('armored') ? P.armored : P.base;
  flowRes(s, 'gold', amt);
  const x = factionState(s);
  x.plunder += amt;
  if (amt >= P.armored || x.plunder >= 5) {
    emit(s, { t: 'gain', k: 'gold', a: x.plunder, x: e.x, y: e.y - 14 });
    x.plunder = 0;
  }
  // Raided lairs pay their loot a second time.
  if (e.type === 'lair' && e.loot) {
    const parts = [];
    for (const k in e.loot) {
      const a = e.loot[k];
      if (typeof a !== 'number' || !(k in s.res) || a <= 0) continue;
      flowRes(s, k, a);
      parts.push(`+${a} ${k}`);
    }
    if (parts.length) emit(s, { t: 'toast', text: `Emberkin plunder: ${parts.join(', ')}`, tone: 'good', icon: 'gold' });
  }
}

// ---- Placement and multipliers ---------------------------------------------------------------------
function vetoForeign(s, type) {
  const def = BUILDINGS[type];
  if (def && def.faction && def.faction !== s.faction) {
    const f = FACTIONS[def.faction];
    return { ok: false, reason: `Only the ${f ? f.name : def.faction} can raise this` };
  }
  return null;
}

let probeType = '', probeSelf = null;
function isGuard(e) { return e.type === probeType && e !== probeSelf; }

function dmgMult(s, a, t) {
  let m = 1;
  // s.rt.facIron is counted in onTick; right after a load it is missing until then.
  if (s.rt.facIron === undefined) s.rt.facIron = ironCount(s);
  if (s.faction === 'mirefolk') m = mireDmg(s, a, t);
  if (a) {
    // Lancer charge: one big blow, then the run has to be built up again.
    if (a.type === 'lancer' && a.chargeReady && a.kind === 'soldier') {
      a.chargeReady = false; a.chDist = 0;
      m *= FT.chargeMult;
      emit(s, { t: 'charge', x: t.x, y: t.y });
      emit(s, { t: 'sfx', k: 'thud', x: t.x, y: t.y });
    }
    // War Drum at night.
    if (s.cycle.phase === 'night' && isFriend(a)) {
      const drums = uniq(s).drum;
      let best = 0;
      for (let i = 0; i < drums.length; i++) {
        const b = drums[i];
        const st = levelStats(b.type, b.level);
        const dx = cxOf(b) - a.x, dy = cyOf(b) - a.y, R = st.radius * T;
        if (dx * dx + dy * dy <= R * R && st.nightDmg > best) best = st.nightDmg;
      }
      if (best) m *= 1 + best;
    }
  }
  if (isFriend(t)) {
    // Spears beat cavalry: Gloom Hounds tear at the Lancers' horses.
    if (t.type === 'lancer' && a && a.kind === 'enemy') {
      const def = ENEMIES[a.type];
      if (def && def.tags && def.tags.includes('beast')) m *= FT.beastVsLancer;
    }
    // Ironshield guard.
    if (s.rt.facIron && t.type !== 'ironshield') {
      probeType = 'ironshield'; probeSelf = t;
      if (s.rt.friendHash.nearest(t.x, t.y, FT.shieldRadius * T, isGuard)) m *= 1 - FT.shieldCut;
      probeSelf = null;
    }
  }
  return m;
}

function costMult(s, type, k) { return s.faction === 'sylvari' && k === 'stone' ? FT.sylvariStone : 1; }
function gatherMult(s, b, k) { return s.faction === 'deepforge' && b && b.type === 'quarry' && k === 'stone' ? FT.quarryMult : 1; }
function upkeepMult(s) {
  // The dead do not eat (villagers, soldiers and heroes). Not exactly 0: economy.js reads
  // s.rt.upkeepMult || 1, so a 0 would fall back to full upkeep; 1e-9 is under a crumb an hour.
  if (s.faction === 'palecourt') return 1e-9;
  return s.faction === 'deepforge' && BUS.query.season(s) === 'winter' ? FT.winterUpkeep : 1;
}
function workMult(s) { return s.faction === 'mirefolk' && BUS.query.season(s) === 'winter' ? FT.winterWork : 1; }
function claimRule(s, zone) {
  if (s.faction === 'deepforge' && zone && (zone.forest || 0) > FT.forestClaim) {
    return `Dwarves will not claim the deep woods: clear the trees first (${zone.forest} left, at most ${FT.forestClaim})`;
  }
  return null;
}

// ---- Mirefolk: shallows, poison, curses, the Bog Shrine, winter ---------------------------------
/** BUS.allowTerrain: Mirefolk may raise anything on River tiles (the bank rule is vetoShallows). */
function allowShallows(s, ter) { return s.faction === 'mirefolk' && ter === RIVER; }

/** A River footprint must touch at least one walkable land tile, so villagers can reach it. */
function vetoShallows(s, type, tx, ty) {
  if (s.faction !== 'mirefolk') return null;
  const def = BUILDINGS[type];
  if (!def) return null;
  const n = def.size;
  let wet = false;
  for (let y = ty; y < ty + n && !wet; y++) for (let x = tx; x < tx + n; x++) if (inB(x, y) && s.terrain[idx(x, y)] === RIVER) { wet = true; break; }
  if (!wet) return null;
  if (bankTile(s, tx, ty, n) < 0) return { ok: false, reason: 'In the River, it must touch the bank so villagers can reach it' };
  return null;
}
/** First walkable land tile in the ring around a footprint, or -1. */
function bankTile(s, tx, ty, n) {
  for (let y = ty - 1; y <= ty + n; y++) for (let x = tx - 1; x <= tx + n; x++) {
    if (!inB(x, y) || (x >= tx && x < tx + n && y >= ty && y < ty + n)) continue;
    const i = idx(x, y);
    if (TER_PASSABLE[s.terrain[i]] && !s.nodeGrid[i] && !solidForFriend(s, i)) return i;
  }
  return -1;
}

let poisonTick = false; // true while poison itself is dealing damage (no re-poisoning)
function mireDmg(s, a, t) {
  let m = 1;
  // Set in tickMire; after a load the first hits come before it, so fill it in here
  // (same value: the season cannot change between the save and the load).
  if (s.rt.mireWinter === undefined) s.rt.mireWinter = BUS.query.season(s) === 'winter';
  if (a && s.rt.mireWinter && isFriend(a)) m = FT.winterDmg;
  if (t.kind !== 'enemy') return m;
  if (t.curse > 0) m *= FT.curseMult;
  if (poisonTick || (a && !isFriend(a))) return m;
  // Soldiers, heroes, the Sovereign (a) and towers, traps, braziers, the Hearth (no attacker).
  const p = t.poison;
  if (p) { p.t = FT.poisonTime; p.dps = FT.poisonDps; } else t.poison = { t: FT.poisonTime, dps: FT.poisonDps };
  if (a && a.type === 'hexcaster' && a.kind === 'soldier') t.curse = FT.curseTime;
  return m;
}

let slowAmt = 0, slowHold = 0;
function slowOne(e) {
  if (e.boss || e.stationary || !e.alive) return false;
  e.slowAmt = e.slowT > 0 ? Math.max(e.slowAmt || 0, slowAmt) : slowAmt;
  e.slowT = Math.max(e.slowT || 0, slowHold);
  return false;
}

function tickMire(s, dt) {
  s.rt.mireWinter = BUS.query.season(s) === 'winter';
  // Hexcasters loose green hexes, not arrows (drawn as arcane bolts, no chain).
  for (let i = 0; i < s.projectiles.length; i++) {
    const p = s.projectiles[i];
    if (p.t !== 0 || p.kind !== 'arrow' || !p.src) continue;
    const u = s.rt.eById.get(p.src);
    if (u && u.type === 'hexcaster') { p.kind = 'arcane'; p.chain = 0; }
  }
  // Poison and curses run down; poison bites twice a second.
  const pulse = s.tick % 10 === 0;
  for (let i = 0; i < s.enemies.length; i++) {
    const e = s.enemies[i];
    if (!e.alive) continue;
    if (e.curse > 0) { e.curse -= dt; if (e.curse <= 0) e.curse = 0; }
    const p = e.poison;
    if (!p) continue;
    if (pulse && p.t > 0) {
      poisonTick = true;
      hurt(s, e, p.dps * 0.5, 'poison', null);
      poisonTick = false;
    }
    p.t -= dt;
    if (p.t <= 0) e.poison = null;
  }
  // Bog Shrines: clinging mist, refreshed twice a second (several shrines do not stack).
  if (s.tick % 10 === 5) {
    for (const b of uniq(s).bog) {
      const st = levelStats(b.type, b.level);
      slowAmt = st.slow; slowHold = FT.slowHold;
      s.rt.enemyHash.each(cxOf(b), cyOf(b), st.radius * T, slowOne);
    }
  }
  // Anyone left standing in the water (out of a River house, knocked off a bank) wades ashore.
  if (s.tick % 4 === 0) {
    const step = 2 * T * dt * 4;
    for (const v of s.villagers) if (v.alive && v.st !== 'sheltered') wade(s, v, step);
    for (const u of s.soldiers) if (u.alive) wade(s, u, step);
    for (const h of s.heroes) if (h.alive && !h.away) wade(s, h, step);
    if (s.sovereign && s.sovereign.alive) wade(s, s.sovereign, step);
  }
}

function wade(s, e, step) {
  const tx = tileOf(e.x), ty = tileOf(e.y);
  if (!inB(tx, ty) || s.terrain[idx(tx, ty)] !== RIVER) return;
  let best = -1, bd = 1e9;
  for (let r = 1; r <= 4 && best < 0; r++) {
    for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) {
      if (!inB(x, y) || (Math.abs(x - tx) !== r && Math.abs(y - ty) !== r)) continue;
      const i = idx(x, y);
      if (solidForFriend(s, i)) continue;
      const d = Math.hypot((x + 0.5) * T - e.x, (y + 0.5) * T - e.y);
      if (d < bd) { bd = d; best = i; }
    }
  }
  if (best < 0) return;
  const gx = ((best % N) + 0.5) * T, gy = (((best / N) | 0) + 0.5) * T;
  const k = Math.min(1, step / (bd || 1));
  e.x += (gx - e.x) * k; e.y += (gy - e.y) * k;
  e.path = null;
}

// ---- Pale Court: Souls, no food, locked Morale, swift Dread, the Ossuary ------------------------
function initPale(s) {
  const x = factionState(s);
  x.souls = FT.startSouls; x.grow = 0; x.fade = 0; x.low = 0;
  const m = mood(s);
  m.dreadMult = r6((m.dreadMult || 1) * FT.dreadMult);
  lockMorale(s);
}
function soulsOf(s) { const x = s.ext.factions; return (x && x.souls) || 0; }
/** Souls the realm can hold: the base plus every built Ossuary. */
export function soulCap(s) {
  let cap = FT.soulCap;
  for (const b of uniq(s).oss) cap += levelStats(b.type, b.level).soulCap || 0;
  return cap;
}
function clampSouls(s) {
  const x = factionState(s);
  if (typeof x.souls === 'number') x.souls = Math.min(x.souls, soulCap(s));
}
function lockMorale(s) {
  const m = mood(s);
  // dropMult must stay a positive number: moodAdd reads `m.dropMult || 1`, so 0 would
  // mean "normal" and a heavy blow could flash a false "Morale is low" warning mid-tick.
  m.morale = FT.lockedMorale; m.baseMorale = FT.lockedMorale; m.dropMult = FT.lockedDrop;
}

function tickPale(s, dt, x) {
  if (typeof x.souls !== 'number') initPale(s);
  lockMorale(s);
  // The core's food-driven growth and starvation never apply: Souls drive both instead.
  s.timers.growth = 0; s.timers.starve = 0;
  let n = 0;
  for (let i = 0; i < s.villagers.length; i++) if (s.villagers[i].alive) n++;
  x.souls = Math.max(0, x.souls - (n * FT.soulsPerVillagerMin / 60) * dt);
  // Newcomers by day while there is room and a store of Souls.
  if (s.cycle.phase === 'day' && x.souls >= FT.growthMinSouls && n < popCap(s)) {
    x.grow += dt;
    if (x.grow >= BAL.villager.growthInterval) {
      x.grow = 0;
      x.souls -= FT.growthSouls;
      const v = spawnVillager(s);
      emit(s, { t: 'newcomer', x: v.x, y: v.y - 20, n: n + 1, cap: popCap(s) });
    }
  }
  // Out of Souls: the bound dead slip away one by one.
  if (x.souls <= 0 && n > 0) {
    x.fade += dt;
    if (x.fade >= FT.fadeEvery) {
      x.fade = 0;
      for (let i = s.villagers.length - 1; i >= 0; i--) {
        const v = s.villagers[i];
        if (!v.alive) continue;
        v.alive = false;
        emit(s, { t: 'soulfade', x: v.x, y: v.y });
        emit(s, { t: 'toast', text: 'With no Souls to bind them, a villager fades into mist. Slay the Hollow!', tone: 'bad', icon: 'skull' });
        break;
      }
    }
  } else x.fade = 0;
  // One warning as the store runs low (re-armed once it recovers).
  const lowAt = n * FT.soulsPerVillagerMin; // about one minute left
  if (!x.low && n > 0 && x.souls < lowAt) {
    x.low = 1;
    emit(s, { t: 'toast', text: `Souls run low (${Math.floor(x.souls)} left). Villagers fade when they run out.`, tone: 'bad', icon: 'skull' });
  } else if (x.low && x.souls >= lowAt * 2 + 4) x.low = 0;
}

let reapX = 0, reapY = 0;
function inReap(b) {
  const st = levelStats(b.type, b.level), R = st.radius * T;
  const dx = cxOf(b) - reapX, dy = cyOf(b) - reapY;
  return dx * dx + dy * dy <= R * R;
}
function reapSoul(s, e) {
  if (e.kind !== 'enemy') return;
  const x = factionState(s);
  if (typeof x.souls !== 'number') initPale(s);
  const def = ENEMIES[e.type];
  let amt = e.boss || (def && def.boss) ? FT.soulsPerBoss : FT.soulsPerKill;
  reapX = e.x; reapY = e.y;
  let bonus = 0;
  for (const b of uniq(s).oss) if (inReap(b)) bonus = Math.max(bonus, levelStats(b.type, b.level).soulBonus || 0);
  amt += bonus;
  const cap = soulCap(s);
  const before = x.souls;
  x.souls = Math.min(cap, x.souls + amt);
  if (x.souls > before) emit(s, { t: 'souls', a: Math.round(x.souls - before), x: e.x, y: e.y - 14, oss: bonus > 0 });
}

/** Dawn: each Ossuary raises a free Bone Legionary every raiseEvery dawns, up to raiseMax. */
function raiseLegion(s) {
  for (const b of uniq(s).oss) {
    const st = levelStats(b.type, b.level);
    b.raiseN = Math.min(st.raiseEvery, (b.raiseN || 0) + 1);
    if (b.raiseN < st.raiseEvery || squadSize(s, b) >= st.raiseMax) continue;
    b.raiseN = 0;
    const sq = squadFor(s, b);
    const cx = cxOf(b), cy = cyOf(b);
    const at = accessTile(s, b, cx, cy + T * 3) || { tx: b.tx, ty: b.ty + b.size };
    spawnSoldier(s, 'bonelegion', sq, (at.tx + 0.5) * T, (at.ty + 0.5) * T);
    emit(s, { t: 'trained', x: cx, y: cy, unit: 'bonelegion', squad: sq.id });
    emit(s, { t: 'raised', x: (at.tx + 0.5) * T, y: (at.ty + 0.5) * T });
    emit(s, { t: 'toast', text: `The Ossuary raises a Bone Legionary for ${sq.name}.`, icon: 'skull' });
  }
}

// ---- UI: building card section ------------------------------------------------------------------------
function effectLine(type, st) {
  switch (type) {
    case 'cathedral': return `Morale settles ${st.morale} higher. Soldiers within ${st.radius} tiles heal ${st.heal} health a second.`;
    case 'hearttree': return `Soldiers, heroes and the Sovereign within ${st.radius} tiles heal ${st.heal} health a second.`;
    case 'runeforge': return `Towers, Ballistae and Mage Spires within ${st.radius} tiles: +${Math.round(st.dmgBonus * 100)}% damage, +${st.rangeBonus} range.`;
    case 'wardrum': return `At night, fighters within ${st.radius} tiles deal +${Math.round(st.nightDmg * 100)}% damage.`;
    case 'bogshrine': return `The Hollow within ${st.radius} tiles is slowed by ${Math.round(st.slow * 100)}% (bosses excepted).`;
    case 'ossuary': return `Holds ${st.soulCap} more Souls. Hollow slain within ${st.radius} tiles yield +${st.soulBonus} Soul. Raises a Bone Legionary ${st.raiseEvery === 1 ? 'every dawn' : `every ${st.raiseEvery} dawns`} (at most ${st.raiseMax}).`;
    default: return '';
  }
}
function cardSection(box, s, b) {
  if (!UNIQUE[b.type] || typeof document === 'undefined') return;
  const def = BUILDINGS[b.type];
  const p = document.createElement('p');
  p.textContent = 'Now: ' + effectLine(b.type, levelStats(b.type, b.level));
  box.appendChild(p);
  const next = def.levels[b.level + 1];
  if (next) {
    const q = document.createElement('p');
    q.textContent = 'Next level: ' + effectLine(b.type, next);
    box.appendChild(q);
  }
  if (b.type === 'runeforge' && b.built) {
    let n = 0;
    for (const id in factionState(s).rune) if (s.rt.bById.has(+id)) n++;
    const r = document.createElement('p');
    r.textContent = `Empowering ${n} defence${n === 1 ? '' : 's'}.`;
    box.appendChild(r);
  }
  if (b.type === 'ossuary' && b.built) {
    const st = levelStats(b.type, b.level);
    const r = document.createElement('p');
    const left = Math.max(1, st.raiseEvery - (b.raiseN || 0));
    r.textContent = `Bone Legionaries raised: ${squadSize(s, b)}/${st.raiseMax}. Souls: ${Math.floor(soulsOf(s))}/${soulCap(s)}. Next raising: ${squadSize(s, b) >= st.raiseMax ? 'squad full' : left === 1 ? 'next dawn' : `in ${left} dawns`}.`;
    box.appendChild(r);
  }
}

// ---- UI: the Souls counter (Pale Court only) -------------------------------------------------------
function soulText(s) {
  const x = s.ext.factions || {};
  let n = 0;
  for (const v of s.villagers) if (v.alive) n++;
  const use = n * FT.soulsPerVillagerMin;
  const souls = Math.floor(x.souls || 0);
  const lines = [
    `Souls: ${souls} of ${soulCap(s)} (Ossuaries hold more).`,
    `Every Hollow slain yields ${FT.soulsPerKill} Soul (${FT.soulsPerBoss} for an act boss).`,
    `Your ${n} villager${n === 1 ? '' : 's'} spend ${use % 1 ? use.toFixed(1) : use} Soul${use === 1 ? '' : 's'} a minute. Food is never eaten.`,
    `A newcomer costs ${FT.growthSouls} Souls and only comes while ${FT.growthMinSouls} or more are stored. Each region begins with ${FT.startSouls}.`,
    `With no Souls left, a villager fades away every ${FT.fadeEvery} s.`,
  ];
  if (!souls && n) lines.push(`Fading: the next villager leaves in ${Math.max(0, Math.ceil(FT.fadeEvery - (x.fade || 0)))} s.`);
  else if (use > 0) lines.push(`At this rate the store lasts about ${Math.max(0, Math.floor(souls / use))} min without kills.`);
  return lines;
}
// The resbar is full on a phone, so while the counter shows the other entries give up a
// little padding (the bar gets the pc-souls class). Tap area grows to 44 px via ::before.
function injectSoulCss() {
  if (document.getElementById('factions-soul-css')) return;
  const st = document.createElement('style');
  st.id = 'factions-soul-css';
  st.textContent = `
.resbar.pc-souls { gap: 2px; padding-left: 5px; padding-right: 5px; }
.resbar.pc-souls .res { min-width: 0; padding: 2px 0; gap: 2px; flex-shrink: 0; }
.resbar.pc-souls .res .ic { width: 16px; height: 16px; }
.resbar.pc-souls .res .v { font-size: 16px; }
.resbar.pc-souls .moodm { width: 50px; }
@media (max-width: 430px) { .resbar.pc-souls .res .r { display: none; } }
@media (max-width: 400px) { .resbar.pc-souls .moodm { width: 38px; } .resbar.pc-souls .moodm .mm-bar { display: none; } .resbar.pc-souls .res .v { font-size: 15px; letter-spacing: -0.2px; } .resbar.pc-souls .res .ic { width: 14px; height: 14px; } }
.soulres { position: relative; flex: none; cursor: pointer; }
.soulres::before { content: ''; position: absolute; top: -9px; bottom: -9px; left: -3px; right: -3px; }
`;
  document.head.appendChild(st);
}
function soulWidget(hud, ctl) {
  if (typeof document === 'undefined' || !hud.slots || !hud.slots.resbar) return null;
  injectSoulCss();
  const r = document.createElement('div');
  r.className = 'res soulres';
  r.setAttribute('role', 'button');
  r.setAttribute('aria-label', 'Souls');
  r.style.display = 'none';
  const c = document.createElement('canvas');
  c.className = 'ic'; c.width = 44; c.height = 44;
  c.style.cssText = 'width:22px;height:22px;flex:none';
  const col = document.createElement('span'); col.className = 'col';
  const v = document.createElement('span'); v.className = 'v'; v.style.color = '#d8e2ff'; v.textContent = '0';
  col.append(v);
  r.append(c, col);
  hud.slots.resbar.appendChild(r);
  r.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const s = ctl.s;
    if (s && s.faction === 'palecourt' && ctl.openText) ctl.openText('Souls', 'The Pale Court feeds on the slain', soulText(s), 'skull');
  });
  let acc = 1, drawn = false, last = '', shown = false;
  return {
    root: r,
    update(s, dt) {
      acc += dt || 0;
      if (acc < 0.25 || !s) return;
      acc = 0;
      const on = s.faction === 'palecourt';
      if (on !== shown) { shown = on; r.style.display = on ? '' : 'none'; hud.slots.resbar.classList.toggle('pc-souls', on); }
      if (!on) return;
      if (!drawn) { drawn = true; const g = c.getContext('2d'); g.scale(2, 2); drawSoulIcon(g, 11, 11, 10); }
      const x = s.ext.factions || {};
      const souls = Math.floor(x.souls || 0);
      let n = 0;
      for (const q of s.villagers) if (q.alive) n++;
      const key = souls + '|' + n + '|' + soulCap(s);
      if (key === last) return;
      last = key;
      v.textContent = String(souls);
      const use = n * FT.soulsPerVillagerMin; // the spend rate is in the tap-for-details panel
      v.style.color = souls <= 0 ? '#ff8a70' : souls < use ? '#ffd27a' : '#d8e2ff';
    },
  };
}

// ---- UI: cosmetic effects for faction events (sound and particles only) --------------------------
function onFx(ctl, ev) {
  const P = ctl.renderer && ctl.renderer.particles;
  if (!P || !ctl.onScreen) return;
  switch (ev.t) {
    case 'souls':
      if (ctl.onScreen(ev.x, ev.y)) {
        P.burst('spark', ev.x, ev.y, ev.oss ? 6 : 3, { speed: 30, color: ['#c8d4ff', '#eef2ff'], life: 0.8, size: 2.2, add: true });
        P.spawn('text', ev.x, ev.y - 6, { vy: -22, life: 1.1, size: 14, text: `+${ev.a} Soul${ev.a === 1 ? '' : 's'}`, color: '#d8e2ff', drag: 0.9 });
      }
      break;
    case 'soulfade':
      if (ctl.onScreen(ev.x, ev.y)) P.burst('puff', ev.x, ev.y - 8, 12, { speed: 26, color: ['#b8c0d8', '#8a90a8'], life: 1.4, size: 7 });
      break;
    case 'raised':
      if (ctl.onScreen(ev.x, ev.y)) P.burst('spark', ev.x, ev.y - 10, 16, { speed: 50, color: ['#b8ffcf', '#e8fff0'], life: 0.9, size: 2.4, add: true });
      break;
    case 'hit':
      // Poison ticks: a puff of green instead of the usual spark.
      if (ev.dtype === 'poison' && ctl.onScreen(ev.x, ev.y) && Math.random() < 0.5) P.burst('spark', ev.x, ev.y, 2, { speed: 18, color: '#8fe86a', life: 0.5, size: 2, add: true });
      break;
  }
}

// ---- Drawing: poison and curse marks (cosmetic; world space, above the lighting) ---------------------
function drawOverlay(g, s, view, time) {
  if (s.faction !== 'mirefolk') return;
  for (let i = 0; i < s.enemies.length; i++) {
    const e = s.enemies[i];
    if (!e.alive || (!e.poison && !(e.curse > 0))) continue;
    if (e.x < view.x0 || e.x > view.x1 || e.y < view.y0 || e.y > view.y1) continue;
    const sc = e.scale || 1, top = e.y - 24 * sc;
    if (e.poison) {
      g.fillStyle = 'rgba(120,220,80,0.22)';
      g.beginPath(); g.ellipse(e.x, e.y - 1, 10 * sc, 4 * sc, 0, 0, 6.283); g.fill();
      for (let k = 0; k < 3; k++) {
        const ph = (time * 0.9 + k / 3 + (e.id % 7) * 0.13) % 1;
        g.fillStyle = `rgba(150,240,100,${0.85 * (1 - ph)})`;
        g.beginPath(); g.arc(e.x + (k - 1) * 5 * sc, e.y - 6 - ph * 18 * sc, 1.6 + (1 - ph), 0, 6.283); g.fill();
      }
    }
    if (e.curse > 0) {
      g.strokeStyle = 'rgba(190,120,255,0.9)'; g.lineWidth = 1.4;
      const a = time * 3 + e.id;
      g.beginPath(); g.ellipse(e.x, top, 6 * sc, 2.4 * sc, 0, a % 6.283, (a % 6.283) + 4.5); g.stroke();
      g.fillStyle = 'rgba(210,160,255,0.95)';
      g.beginPath(); g.arc(e.x + Math.cos(a) * 6 * sc, top + Math.sin(a) * 2.4 * sc, 1.4, 0, 6.283); g.fill();
    }
  }
}

// Mirefolk ground layer: stilts and ripples under River buildings, mist around Bog Shrines.
function drawMireGround(g, s, view, time) {
  for (const b of s.buildings) {
    if (!b.alive) continue;
    const x0 = b.tx * T, y0 = b.ty * T, w = b.size * T;
    if (x0 > view.x1 || x0 + w < view.x0 || y0 > view.y1 || y0 + w < view.y0) continue;
    if (b.type === 'bogshrine' && b.built) {
      const R = levelStats(b.type, b.level).radius * T, cx = x0 + w / 2, cy = y0 + w / 2;
      const gr = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
      gr.addColorStop(0, 'rgba(120,170,90,0.20)'); gr.addColorStop(0.75, 'rgba(110,160,90,0.12)'); gr.addColorStop(1, 'rgba(110,160,90,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R, 0, 6.283); g.fill();
      g.strokeStyle = 'rgba(170,220,130,0.35)'; g.lineWidth = 1.2; g.setLineDash([5, 6]); g.lineDashOffset = -time * 6;
      g.beginPath(); g.arc(cx, cy, R, 0, 6.283); g.stroke(); g.setLineDash([]);
    }
    let wet = false;
    for (let y = b.ty; y < b.ty + b.size && !wet; y++) for (let x = b.tx; x < b.tx + b.size; x++) if (inB(x, y) && s.terrain[idx(x, y)] === RIVER) { wet = true; break; }
    if (!wet) continue;
    // Ripples and wooden stilts so a River building reads as raised over the water.
    const ph = (time * 0.6 + b.id * 0.37) % 1;
    g.strokeStyle = `rgba(210,235,255,${0.35 * (1 - ph)})`; g.lineWidth = 1;
    g.beginPath(); g.ellipse(x0 + w / 2, y0 + w - 3, w / 2 + 3 + ph * 6, 4 + ph * 2, 0, 0, 6.283); g.stroke();
    g.fillStyle = '#5a4128';
    for (let k = 0; k <= b.size; k++) {
      const px = x0 + 2 + (k * (w - 6)) / b.size;
      g.fillRect(px, y0 + w - 6, 3, 7);
    }
  }
}

// ---- Drawing: frenzy glow and charge glint (cosmetic) ------------------------------------------------
function drawGround(g, s, view, time) {
  if (s.faction === 'mirefolk') { drawMireGround(g, s, view, time); return; }
  if (s.faction !== 'emberkin' && s.faction !== 'dawnhold') return;
  for (let i = 0; i < s.soldiers.length; i++) {
    const u = s.soldiers[i];
    if (!u.alive || u.x < view.x0 || u.x > view.x1 || u.y < view.y0 || u.y > view.y1) continue;
    if (u.type === 'berserker' && u.hp < u.maxHp * FT.frenzyAt) {
      const p = 0.35 + 0.2 * Math.sin(time * 9 + u.id);
      g.fillStyle = `rgba(220,50,30,${p})`;
      g.beginPath(); g.ellipse(u.x, u.y - 1, 10, 4.5, 0, 0, 6.283); g.fill();
    } else if (u.type === 'lancer' && u.chargeReady) {
      g.strokeStyle = 'rgba(255,215,110,0.85)'; g.lineWidth = 1.6;
      g.beginPath(); g.ellipse(u.x, u.y - 1, 11, 4.5, 0, 0, 6.283); g.stroke();
    }
  }
}

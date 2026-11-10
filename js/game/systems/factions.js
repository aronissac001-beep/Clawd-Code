// The four playable factions made real: unique units and buildings, passives and
// drawbacks. Everything plugs into the core through BUS (js/game/hooks.js).
// Region state: s.ext.factions. Caches: s.rt.facB (unique buildings by kind),
// s.rt.facIron (live Ironshields this tick). Deterministic: no Math.random.
import { BUS } from '../hooks.js';
import { FACTIONS } from '../../data/factions.js';
import { UNITS } from '../../data/units.js';
import { BUILDINGS, BUILD_ORDER, levelStats } from '../../data/buildings.js';
import { ENEMIES } from '../../data/enemies.js';
import { FACTION_UNITS, FACTION_BUILDINGS, FACTION_TUNING as FT } from '../../data/faction-content.js';
import { UNIT_ART, BUILDING_ART } from '../../engine/sprites.js';
import { FACTION_UNIT_ART, FACTION_BUILDING_ART } from '../../engine/factionart.js';
import { T, idx, inB, tileOf, TER_BUILDABLE } from '../grid.js';
import { emit, flowRes, mood, moodAdd, getE } from './common.js';
import { makeBoonChoice } from './cycle.js';

const TURRETS = { tower: 1, ballista: 1, spire: 1 };
const LANCER = FACTION_UNITS.lancer;
const UNIQUE = { cathedral: 'cath', hearttree: 'tree', runeforge: 'forge', wardrum: 'drum' };
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
  c = s.rt.facB = { n: s.buildings.length, cath: [], tree: [], forge: [], drum: [] };
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
  const prevClaim = BUS.query.claimRule;
  BUS.query.claimRule = (s, zone) => claimRule(s, zone) || (prevClaim ? prevClaim(s, zone) : null);
  // UI and drawing.
  BUS.card.push(cardSection);
  BUS.draw.ground.push(drawGround);
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
  // Standalone regions (no run) get the run-layer drawbacks here instead.
  if (!ctx || !ctx.run) {
    if (s.faction === 'deepforge') s.mods.buildSpeed -= FT.buildSlow;
    if (s.faction === 'emberkin' && s.villagers.length > 1) {
      const v = s.villagers.pop();
      s.rt.eById.delete(v.id);
    }
  }
}

function onBuiltOrRemoved(s, b) {
  s.rt.facB = null;
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

function onTick(s, dt) {
  const x = factionState(s);
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
  if (phase !== 'dawn') return;
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
    const pool = Object.keys(BUILDINGS).filter((t) => BUILDINGS[t].cat && !known.includes(t) && !p.options.includes(t) && !isForeignUnique(t, s.faction));
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
function upkeepMult(s) { return s.faction === 'deepforge' && BUS.query.season(s) === 'winter' ? FT.winterUpkeep : 1; }
function claimRule(s, zone) {
  if (s.faction === 'deepforge' && zone && (zone.forest || 0) > FT.forestClaim) {
    return `Dwarves will not claim the deep woods: clear the trees first (${zone.forest} left, at most ${FT.forestClaim})`;
  }
  return null;
}

// ---- UI: building card section ------------------------------------------------------------------------
function effectLine(type, st) {
  switch (type) {
    case 'cathedral': return `Morale settles ${st.morale} higher. Soldiers within ${st.radius} tiles heal ${st.heal} health a second.`;
    case 'hearttree': return `Soldiers, heroes and the Sovereign within ${st.radius} tiles heal ${st.heal} health a second.`;
    case 'runeforge': return `Towers, Ballistae and Mage Spires within ${st.radius} tiles: +${Math.round(st.dmgBonus * 100)}% damage, +${st.rangeBonus} range.`;
    case 'wardrum': return `At night, fighters within ${st.radius} tiles deal +${Math.round(st.nightDmg * 100)}% damage.`;
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
}

// ---- Drawing: frenzy glow and charge glint (cosmetic) ------------------------------------------------
function drawGround(g, s, view, time) {
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

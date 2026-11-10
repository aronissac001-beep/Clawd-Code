// Phase 4: 26 new relics, two relic sets and four hero classes (Skald, Druid,
// Duelist, Frostwarden). Data lives in js/data/relics-p4.js and js/data/heroes-p4.js;
// this module merges it into RELICS / RELIC_SETS / HERO_CLASSES and runs every effect
// that region modifiers cannot express, through BUS only.
//
// Region state used (all plain JSON):
//   s.relics[i].rUsed  once-per-region flag (Ward of the Last Door). s.relics is the
//                      region's copy of run.relics, so the flag lasts the region (and its
//                      saves) and resets in the next one.
//   hero movers        e.p4T   ability timer of the new classes
//   enemy movers       e.frzT  seconds left frozen (Frostwarden), e.p4fx 1 rooted / 2 chilled (art)
//   tavern candidates  c.p4d   price already lowered by the Bottomless Keg
// Caches: s.rt.p4r (owned relic flags, keyed by s.relics.length; relics never change mid-region).
import { BUS } from '../hooks.js';
import { RELICS, RELIC_SETS } from '../../data/relics.js';
import { RELICS_P4, RELIC_SETS_P4, RP4 } from '../../data/relics-p4.js';
import { HERO_CLASSES, KILL_XP, HERO_RULES } from '../../data/heroes.js';
import { HERO_CLASSES_P4, HP4 } from '../../data/heroes-p4.js';
import { BUILDINGS, levelStats } from '../../data/buildings.js';
import { T, idx, tileOf, inB } from '../grid.js';
import { emit, flowRes, moodAdd, getE } from './common.js';
import { heroStats, gainXp } from './heroes.js';
import { computeLight } from './fog.js';
import { register as registerArt } from '../../engine/heroart-p4.js';

export { RELICS_P4, RELIC_SETS_P4, RP4, HERO_CLASSES_P4, HP4 };
export const P4_HERO_IDS = Object.keys(HERO_CLASSES_P4);

// ---- Owned-relic flags (cached per region) ---------------------------------------------------
const NONE = [];
/** Flags for the relics this region carries: { has: {id: entry}, xp, regen, killGold, saga, bulwark }. */
export function relicInfo(s) {
  const list = s.relics || NONE;
  const rt = s.rt || (s.rt = {});
  let c = rt.p4r;
  if (c && c.n === list.length) return c;
  c = { n: list.length, has: {}, xp: 0, regen: 0, killGold: 0, saga: false, bulwark: false };
  let heroTags = 0, wardTags = 0;
  for (const r of list) {
    const def = RELICS[r.id];
    if (!def) continue;
    if (RELICS_P4[r.id]) c.has[r.id] = r;
    if (def.tags.includes('hero')) heroTags++;
    if (def.tags.includes('ward')) wardTags++;
  }
  const h = c.has;
  c.saga = heroTags >= setOf('saga').count;
  c.bulwark = wardTags >= setOf('bulwark').count;
  c.xp = (h.r4_sagabook ? RP4.heroXp : 0) + (h.r4_sagacrown ? RP4.crownXp : 0) + (c.saga ? RP4.sagaXp : 0);
  c.regen = (h.r4_sagacrown ? RP4.crownRegen : 0) + (c.saga ? RP4.sagaRegen : 0);
  c.killGold = (h.r4_tallyknife ? RP4.killGold : 0) + (h.r4_gravespade ? RP4.graveGold : 0);
  c.heroDmg = (h.r4_sigil ? 1 + RP4.sigilDmg : 1) * (h.r4_blackpact ? 1 + RP4.pactDmg : 1);
  rt.p4r = c;
  return c;
}
function setOf(id) { return RELIC_SETS_P4.find((x) => x.id === id); }

// ---- Small helpers -------------------------------------------------------------------------------
const FRIEND = { soldier: 1, hero: 1, sovereign: 1 };
function fxRing(s, x, y, k, r) {
  const L = s.rt.heroFx || (s.rt.heroFx = []);
  if (L.length >= 40) L.shift();
  L.push({ x, y, k, r, t: s.time });
}
/** Slow a foe (same rules as traps and Bog Shrines: the stronger slow wins while one holds). */
function slowFoe(t, amt, dur, fx) {
  if (t.boss || t.stationary || !t.alive) return;
  t.slowAmt = t.slowT > 0 ? Math.max(t.slowAmt || 0, amt) : amt;
  t.slowT = Math.max(t.slowT || 0, dur);
  if (!(t.frzT > 0)) t.p4fx = fx;
}
function freezeFoe(t, dur) {
  if (t.boss || t.stationary || !t.alive) return false;
  t.frzT = Math.max(t.frzT || 0, dur);
  t.slowAmt = 1; t.slowT = Math.max(t.slowT || 0, 0.1);
  t.cd = Math.max(t.cd || 0, 0.1);
  return true;
}
function isWinter(s) { return BUS.query.season(s) === 'winter'; }

// No other Hollow within `lone` tiles of t (Duelist).
let loneT = null;
function otherFoe(o) { return o !== loneT && o.alive && o.kind === 'enemy' && !o.stationary; }
function isLone(s, t) {
  loneT = t;
  const f = s.rt.enemyHash.nearest(t.x, t.y, HP4.duelist.lone * T, otherFoe);
  loneT = null;
  return !f;
}

// ---- Damage modifiers (hot path) --------------------------------------------------------------------
function dmgMult(s, a, t, type) {
  const c = relicInfo(s);
  const h = c.has;
  let m = 1;
  const foe = t.kind === 'enemy';
  const ak = a ? a.kind : null;
  if (foe) {
    if (ak === 'hero') {
      m *= c.heroDmg;
      switch (a.cls) {
        case 'duelist': if (isLone(s, t)) m *= 1 + HP4.duelist.crit * (1 + heroStats(s, a).power); break;
        case 'druid': {
          const st = heroStats(s, a), D = HP4.druid, k = st.root || 0;
          slowFoe(t, Math.min(0.9, D.rootSlow + D.rootSlowPerRoot * k), D.rootTime * (1 + k), 1);
          break;
        }
        case 'frostwarden':
          slowFoe(t, HP4.frostwarden.chill, HP4.frostwarden.chillTime, 2);
          if (isWinter(s)) m *= 1 + HP4.frostwarden.winter;
          break;
      }
    }
    if (ak && FRIEND[ak]) {
      // Skald War Song: the strongest song within reach of the attacker.
      const H = s.heroes;
      let song = 0;
      for (let i = 0; i < H.length; i++) {
        const p = H[i];
        if (p.cls !== 'skald' || !p.alive || p.away) continue;
        const st = heroStats(s, p), S = HP4.skald;
        const r = S.radius * (1 + S.radiusPerPower * st.power) * T;
        const dx = p.x - a.x, dy = p.y - a.y;
        if (dx * dx + dy * dy <= r * r) song = Math.max(song, S.aura * (1 + st.power));
      }
      if (song) m *= 1 + song;
      if (h.r4_headsman && t.hp < t.maxHp * RP4.execBelow) m *= 1 + RP4.execDmg;
      if (ak === 'soldier' && h.r4_vanguard) {
        const v = s.sovereign;
        if (v && v.alive) {
          const dx = v.x - a.x, dy = v.y - a.y, r = RP4.vanguardRange * T;
          if (dx * dx + dy * dy <= r * r) m *= 1 + RP4.vanguardDmg;
        }
      }
      if (ak === 'sovereign' && h.r4_signet && a.alive && a.hp < a.maxHp) a.hp = Math.min(a.maxHp, a.hp + RP4.lifesteal);
    }
    if (h.r4_everwatch) {
      const tx = tileOf(t.x), ty = tileOf(t.y);
      if (inB(tx, ty) && s.lit[idx(tx, ty)]) m *= 1 + RP4.everLitDmg;
    }
    return m;
  }
  // Damage to your people.
  if (h.r4_firstward && s.cycle.night === 0 && (s.cycle.phase === 'night' || s.cycle.phase === 'dusk')) m *= 1 - RP4.firstNightCut;
  if (t.kind === 'hero') {
    if (h.r4_sigil) m *= 1 - RP4.sigilCut;
    if (t.cls === 'duelist' && ak === 'enemy') {
      const st = heroStats(s, t);
      const p = Math.min(HP4.duelist.dodgeMax, HP4.duelist.dodge + (st.dodge || 0));
      if (s.rt.rng.chance(p)) { emit(s, { t: 'p4dodge', x: t.x, y: t.y }); return 0; }
    }
  }
  return m;
}

// ---- Per-tick ------------------------------------------------------------------------------------------
function tick(s, dt) {
  const c = relicInfo(s);
  const h = c.has;
  // Drillmaster's Daybook: every training queue runs faster.
  if (h.r4_drillbook) {
    for (const b of s.buildings) {
      if (!b.built || !b.train || !b.train.length) continue;
      b.train[0].t -= dt * RP4.trainFaster * (levelStats(b.type, b.level).trainSpeed || 1);
    }
  }
  // Ward of the Last Door: once per region.
  if (h.r4_threshold && !h.r4_threshold.rUsed) {
    const hb = s.rt.hearth;
    if (hb && hb.alive && hb.built && hb.hp > 0 && hb.hp < hb.maxHp * RP4.hearthLow) wardHearth(s, hb, h.r4_threshold, false);
  }
  // Heroes: relic regeneration and the new classes' abilities.
  let casters = 0;
  for (const e of s.heroes) {
    if (!e.alive || e.away) continue;
    if (c.regen && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + c.regen * dt);
    if (e.cls === 'druid') { casters++; druidTick(s, e, dt); }
    else if (e.cls === 'frostwarden') { casters++; frostTick(s, e, dt); }
  }
  if (casters) restyleBolts(s);
  // Frozen foes neither move nor strike.
  for (const e of s.enemies) {
    if (!(e.frzT > 0)) { if (e.p4fx && !(e.slowT > 0)) e.p4fx = 0; continue; }
    e.frzT -= dt;
    if (e.frzT > 0 && e.alive) {
      e.slowAmt = 1; e.slowT = Math.max(e.slowT || 0, 0.1); e.cd = Math.max(e.cd, 0.1);
      if (e.guard) { e.x = e.px; e.y = e.py; } // lair guards ignore slows: hold them where they stood
    }
    else { e.frzT = 0; e.slowT = 0; e.slowAmt = 0; e.p4fx = 0; }
  }
}

function druidTick(s, e, dt) {
  if (e.p4T == null) e.p4T = 2;
  e.p4T -= dt;
  if (e.p4T > 0) return;
  const st = heroStats(s, e), D = HP4.druid;
  const r = D.radius * T, r2 = r * r, amt = D.heal * (1 + st.power);
  let n = 0;
  const heal = (o) => {
    if (!o || !o.alive || o.away || o.hp >= o.maxHp) return;
    const dx = o.x - e.x, dy = o.y - e.y;
    if (dx * dx + dy * dy > r2) return;
    const before = o.hp;
    o.hp = Math.min(o.maxHp, o.hp + amt);
    emit(s, { t: 'heal', x: o.x, y: o.y, amt: o.hp - before });
    n++;
  };
  for (const o of s.heroes) heal(o);
  for (const o of s.soldiers) heal(o);
  heal(s.sovereign);
  if (!n) { e.p4T = 0.5; return; }
  e.p4T = D.every * (1 + st.abilCd);
  e.castT = 0.4;
  fxRing(s, e.x, e.y, 'heal', r);
}

function frostTick(s, e, dt) {
  if (e.p4T == null) e.p4T = 3;
  e.p4T -= dt;
  if (e.p4T > 0) return;
  const t = getE(s, e.targetId);
  const st = heroStats(s, e);
  if (!t || t.kind !== 'enemy' || t.boss || t.stationary || Math.hypot(t.x - e.x, t.y - e.y) > (st.range + 1) * T) { e.p4T = 0.5; return; }
  const F = HP4.frostwarden;
  const dur = F.freeze * (1 + st.power), rad = F.radius * (1 + st.power) * T;
  let n = 0;
  if (freezeFoe(t, dur)) n++;
  s.rt.enemyHash.each(t.x, t.y, rad, (o) => { if (o !== t && o.kind === 'enemy' && freezeFoe(o, dur)) n++; return false; });
  e.p4T = F.every * (1 + st.abilCd);
  e.castT = 0.4;
  fxRing(s, t.x, t.y, 'rune', rad + 10);
  emit(s, { t: 'p4freeze', x: t.x, y: t.y, n });
}

// Bolts the Druid or Frostwarden loosed this tick get their own look (cosmetic kind only).
function restyleBolts(s) {
  const P = s.projectiles;
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i];
    if (p.t !== 0 || p.kind !== 'arrow' || !p.src) continue;
    const src = getE(s, p.src);
    if (!src || src.kind !== 'hero') continue;
    if (src.cls === 'druid') { p.kind = 'p4thorn'; p.arc = 0.15; }
    else if (src.cls === 'frostwarden') { p.kind = 'p4frost'; p.arc = 0.1; }
  }
}

function wardHearth(s, hb, entry, fell) {
  entry.rUsed = true;
  hb.hp = fell ? Math.ceil(hb.maxHp * RP4.hearthHeal) : Math.min(hb.maxHp, hb.hp + hb.maxHp * RP4.hearthHeal);
  emit(s, { t: 'toast', text: 'The Ward of the Last Door flares. The Hearth mends!', tone: 'good', icon: 'flame' });
  emit(s, { t: 'sfx', k: 'nova', x: (hb.tx + hb.size / 2) * T, y: (hb.ty + hb.size / 2) * T });
  return true;
}

// ---- Watchfire Oil: Watchtowers in the combat light map ------------------------------------------
// Runs from BUS.workMult, which the core calls once at the very start of every tick, so the
// light map holds tower light for the whole tick (and after a load, exactly as before it).
function preTick(s) {
  const c = relicInfo(s);
  if (!c.has.r4_watchfire) return 1;
  if (s.rt.lightDirty) computeLight(s);
  const r = RP4.towerLight;
  for (const b of s.buildings) {
    if (b.type !== 'tower' || !b.built || !b.alive || b.snuffT > 0) continue;
    const cx = b.tx + b.size / 2, cy = b.ty + b.size / 2;
    for (let ty = Math.floor(cy - r); ty <= Math.ceil(cy + r); ty++) for (let tx = Math.floor(cx - r); tx <= Math.ceil(cx + r); tx++) {
      if (!inB(tx, ty)) continue;
      const dx = tx + 0.5 - cx, dy = ty + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) s.lit[idx(tx, ty)] = 1;
    }
  }
  return 1;
}
function towerLights(s, push) {
  if (!s.relics || !relicInfo(s).has.r4_watchfire) return;
  const r = RP4.towerLight * T;
  for (const b of s.buildings) if (b.type === 'tower' && b.built && b.alive && !(b.snuffT > 0)) push((b.tx + b.size / 2) * T, (b.ty + b.size / 2) * T, r, 0.85);
}

// ---- Other hooks --------------------------------------------------------------------------------------
function costMult(s, type, k) {
  if (!s || !s.rt) return 1;
  const h = relicInfo(s).has;
  let m = 1;
  if (h.r4_mortarpail && BUILDINGS[type] && BUILDINGS[type].isWall) m *= RP4.wallCost;
  if (h.r4_dawnforge) m *= RP4.forgeCost;
  return m;
}
function sightMult(s) { return relicInfo(s).has.r4_crowfeather ? RP4.sightMult : 1; }

function onKill(s, v, killer) {
  const c = relicInfo(s);
  if (v.kind === 'enemy') {
    if (c.killGold) { flowRes(s, 'gold', c.killGold); emit(s, { t: 'p4coin', x: v.x, y: v.y, n: c.killGold }); }
    if (killer && killer.kind === 'hero' && killer.cls === 'skald') {
      const st = heroStats(s, killer);
      moodAdd(s, HP4.skald.morale * (1 + (st.morale || 0)), 0);
      killer.castT = Math.max(killer.castT || 0, 0.3);
    }
  }
  // Extra kill experience, shared exactly like the core's (killer all, heroes nearby a share).
  if (c.xp && s.heroes.length && (v.kind === 'enemy' || v.guard || v.lair)) {
    let base = (KILL_XP[v.type] || 6) * c.xp;
    if (v.affix === 'warden') base *= 3;
    const R = HERO_RULES, r2 = (R.shareRadius * T) * (R.shareRadius * T);
    for (const e of s.heroes) {
      if (!e.alive) continue;
      if (killer === e) { gainXp(s, e, base); continue; }
      const dx = e.x - v.x, dy = e.y - v.y;
      if (dx * dx + dy * dy <= r2) gainXp(s, e, base * R.shareFrac);
    }
  }
}

function onPhase(s, phase) {
  const h = relicInfo(s).has;
  if (phase === 'dawn') {
    if (h.r4_salve) for (const u of s.soldiers) if (u.alive) u.hp = u.maxHp;
    if (h.r4_moonhoard) flowRes(s, 'stone', RP4.moonDawnStone);
    if (h.r4_moonhoard && s.wave && s.wave.blood) {
      flowRes(s, 'gold', RP4.moonGold); flowRes(s, 'stone', RP4.moonStone);
      emit(s, { t: 'toast', text: `The Red Moon Reliquary fills: +${RP4.moonGold} gold, +${RP4.moonStone} stone.`, tone: 'good', icon: 'moon' });
    }
  } else if (phase === 'night') {
    if (h.r4_blackpact) moodAdd(s, 0, RP4.pactDread, 'The Black Pact');
  } else if (phase === 'day') {
    if (h.r4_keg) discountTavern(s);
  }
}

function discountTavern(s) {
  const X = s.ext.heroes;
  if (!X || !X.tavern) return;
  for (const k in X.tavern) {
    for (const cand of X.tavern[k].list) {
      if (cand.p4d || cand.hired) continue;
      cand.price = Math.max(1, Math.round(cand.price * (1 - RP4.kegDiscount))); // exactly 30% off (to the coin)
      cand.p4d = 1;
    }
  }
}

function onBuilt(s, b) {
  if (b.type === 'tavern' && relicInfo(s).has.r4_keg) discountTavern(s);
}
function onRemoved(s, b) {
  if (b.type === 'tower' && relicInfo(s).has.r4_watchfire) s.rt.lightDirty = true;
}

// Ward of the Last Door also catches a blow that would fell the Hearth outright.
function thresholdFall(s, ctx) {
  if (ctx.relic.rUsed) return false;
  const hb = (s.rt && s.rt.hearth) || s.buildings.find((b) => b.type === 'hearth' && b.alive);
  if (!hb) return false;
  return wardHearth(s, hb, ctx.relic, true);
}

// ---- Registration ---------------------------------------------------------------------------------------
let done = false;
export function register() {
  if (done) return;
  done = true;
  for (const [id, def] of Object.entries(RELICS_P4)) RELICS[id] = def;
  RELICS.r4_threshold.hooks = { onHearthFall: thresholdFall };
  // A felling blow goes to relic hooks in s.relics order. If the Phoenix (once per run) comes first
  // while the Ward (once per region) is still unspent, let the Ward take it and keep the Phoenix.
  const ph = RELICS.phoenix && RELICS.phoenix.hooks && RELICS.phoenix.hooks.onHearthFall;
  if (ph) {
    RELICS.phoenix.hooks.onHearthFall = function phoenixAfterWard(s, ctx) {
      const w = relicInfo(s).has.r4_threshold;
      if (w && !w.rUsed) return thresholdFall(s, { relic: w, emit: ctx.emit });
      return ph(s, ctx);
    };
  }
  for (const set of RELIC_SETS_P4) if (!RELIC_SETS.some((x) => x.id === set.id)) RELIC_SETS.push(set);
  Object.assign(HERO_CLASSES, HERO_CLASSES_P4);
  BUS.dmgMult.push(dmgMult);
  BUS.tick.push(tick);
  BUS.workMult.push(preTick);
  BUS.costMult.push(costMult);
  BUS.sightMult.push(sightMult);
  BUS.kill.push(onKill);
  BUS.phase.push(onPhase);
  BUS.built.push(onBuilt);
  BUS.removed.push(onRemoved);
  BUS.draw.lights.push(towerLights);
  registerArt();
}

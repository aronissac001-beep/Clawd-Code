// Phase 4 military: seven units (Crossbowman, Knight, Shieldwall, Field Healer, Battlemage,
// Scout, Ballista Cart) and three training buildings (Archery Range, Stable, Siege Workshop).
// Everything plugs into the core through BUS (js/game/hooks.js). Deterministic: no
// Math.random in anything that touches state (only in drawing and particles).
//
// What the core does for free: any building with def.trains gets a training card, a queue
// and a squad (sim 'train' command, systems/buildings.js); soldiers fight through
// systems/units.js (ranged units shoot 'arrow' projectiles, `cleave` sweeps extra foes).
// What this module adds (all through BUS):
//   tick      Shieldwall count, Healer behaviour (keeps its distance, mends the most wounded
//             ally), Scout fog reveal, Ballista Cart targeting (bosses first, never flyers),
//             projectile looks (crossbow bolt, ember orb, ballista bolt).
//   dmgMult   Shieldwall guard (-15% for allies within 1.5 tiles), beasts vs cavalry (+50%),
//             armour vs pierce (-40%), Archery Range and Siege Workshop bonuses, Ballista Cart
//             vs bosses/structures (x1.75) and flyers (x0), Battlemage splash.
//   commands  'milTrain' { id, u }: support troops (Shieldwall, Field Healer) at a Barracks
//             until the core trainsAt() lists BUILDINGS.barracks.trainsExtra itself.
//   card/hud/fx/draw: perks on the building cards, the Barracks support buttons, cavalry
//             portraits, heal and splash effects, the Knight's art (unit id 'cavalier').
//
// Region state (plain JSON): s.ext.military = { healed } (total health mended, for records).
// Per-mover fields (saved, plain numbers): u.milT (Healer/Cart think timer), u.milShot
// (last orb damage, Battlemage), u.milHid / u.milHt (Healer's last patient and when),
// o.milHealT / o.milHealBy (on a patient: when and by which Healer it was last mended).
// Caches (not saved, rebuilt lazily): s.rt.mil (building bonuses), s.rt.milShield (live
// Shieldwalls this tick).
import { BUS } from '../hooks.js';
import { BAL } from '../../data/balance.js';
import { UNITS } from '../../data/units.js';
import { ENEMIES } from '../../data/enemies.js';
import { FACTIONS } from '../../data/factions.js';
import { BUILDINGS, BUILD_ORDER, levelStats, trainsAt } from '../../data/buildings.js';
import { MILITARY_UNITS as MU, MILITARY_BUILDINGS, MILITARY_ORDER, MILITARY_TUNE as MT, BARRACKS_EXTRA } from '../../data/military.js';
import { UNIT_ART, BUILDING_ART, unitSprite } from '../../engine/sprites.js';
import * as ART from '../../engine/militaryart.js';
import { T } from '../grid.js';
import { emit, getE, hurt, canAfford, spend } from './common.js';
import { stepToward } from './movement.js';
import { squadFor, squadSize, trainTime } from './buildings.js';
import { revealAround } from './fog.js';
import { ART_HOOKS } from '../hooks.js';

const DT = 1 / BAL.tickRate;
const C = BAL.combat;
const isFriend = (e) => e.kind === 'soldier' || e.kind === 'hero' || e.kind === 'sovereign';
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const SHOTS = {};       // unit type -> { kind, speed, arc } projectile look
for (const k in MU) if (MU[k].shot) SHOTS[k] = MU[k].shot;

// ---- State and caches ------------------------------------------------------------------------
/** Region state for this module (plain JSON, created on first use). */
export function militaryState(s) {
  const X = s.ext.military || (s.ext.military = { healed: 0 });
  if (typeof X.healed !== 'number') X.healed = 0;
  return X;
}

/** Best Archery Range and Siege Workshop bonuses standing in the region (cached). */
export function bonuses(s) {
  let c = s.rt.mil;
  if (c && c.n === s.buildings.length) return c;
  c = s.rt.mil = { n: s.buildings.length, rangeB: 0, siegeB: 0 };
  for (const b of s.buildings) {
    if (!b.built || !b.alive || !MILITARY_BUILDINGS[b.type]) continue;
    const st = levelStats(b.type, b.level);
    if (st.rangedBonus > c.rangeB) c.rangeB = st.rangedBonus;
    if (st.siegeBonus > c.siegeB) c.siegeB = st.siegeBonus;
  }
  return c;
}
function dirty(s) { s.rt.mil = null; }

function shieldCount(s) {
  let n = s.rt.milShield;
  if (n === undefined) {
    n = 0;
    for (let i = 0; i < s.soldiers.length; i++) if (s.soldiers[i].alive && s.soldiers[i].type === 'shieldwall') n++;
    s.rt.milShield = n;
  }
  return n;
}

/** True when the core Barracks card already lists the support troops (integration applied). */
export function barracksIntegrated() {
  return trainsAt('barracks', null, null).includes(BARRACKS_EXTRA[0]);
}
/** Units the support section offers at this building (empty when not a Barracks or integrated). */
export function supportUnits(b) {
  if (!b || b.type !== 'barracks' || barracksIntegrated()) return [];
  return BARRACKS_EXTRA.filter((u) => UNITS[u]);
}

// ---- Registration ---------------------------------------------------------------------------------
let done = false;
export function register() {
  if (done) return;
  done = true;
  // Data and art.
  Object.assign(UNITS, MU);
  Object.assign(BUILDINGS, MILITARY_BUILDINGS);
  Object.assign(UNIT_ART, ART.MILITARY_UNIT_ART);
  Object.assign(BUILDING_ART, ART.MILITARY_BUILDING_ART);
  for (const cat of Object.keys(MILITARY_ORDER)) {
    const list = BUILD_ORDER[cat] || (BUILD_ORDER[cat] = []);
    for (const type of MILITARY_ORDER[cat]) if (!list.includes(type)) list.push(type);
  }
  // The Barracks raises the support troops (read by trainsAt once the lead wires it in).
  if (BUILDINGS.barracks) {
    const ex = BUILDINGS.barracks.trainsExtra || (BUILDINGS.barracks.trainsExtra = []);
    for (const u of BARRACKS_EXTRA) if (!ex.includes(u)) ex.push(u);
  }
  // Region.
  BUS.tick.push(onTick);
  BUS.built.push(dirty);
  BUS.removed.push(dirty);
  BUS.dmgMult.push(dmgMult);
  BUS.commands.milTrain = cmdTrain;
  // UI and drawing.
  BUS.card.push(cardSection);
  BUS.fx.push(onFx);
  BUS.draw.ground.push(drawGround);
  BUS.draw.world.push(drawWorld);
  BUS.draw.lights.push(drawLights);
  wrapProjectileArt();
}

// ---- Per tick ---------------------------------------------------------------------------------------
// Allocation-free search state for the hash callbacks below.
let qSelf = null, qBest = null, qScore = 0, qDist = 0, qX = 0, qY = 0, qRx = 0, qRy = 0, qLeash = 0, qNow = 0;
const HEAL_GAP = MT.healEvery * DT - 1e-6; // one Healer per patient per pulse
function pickPatient(o) {
  if (o === qSelf || o.hp >= o.maxHp || o.hp <= 0) return false;
  // Another Healer mended this one during the current pulse: share out the wounded.
  if (o.milHealT !== undefined && qNow - o.milHealT < HEAL_GAP && o.milHealBy !== qSelf.id) return false;
  const f = o.hp / o.maxHp;
  if (f < qScore) { qScore = f; qBest = o; }
  return false;
}
function pickSiegeTarget(e) {
  if (e.flying || !e.alive) return false;
  const dxr = e.x - qRx, dyr = e.y - qRy;
  if (dxr * dxr + dyr * dyr > qLeash * qLeash) return false;
  const tags = ENEMIES[e.type] && ENEMIES[e.type].tags;
  const score = e.boss || e.stationary ? 3 : tags && tags.includes('armored') ? 2 : 1;
  const dx = e.x - qX, dy = e.y - qY, d = dx * dx + dy * dy;
  if (score > qScore || (score === qScore && d < qDist)) { qScore = score; qDist = d; qBest = e; }
  return false;
}
const grounded = (e) => !e.flying;
function isFlyer(s, id) { const t = getE(s, id); return !!(t && t.flying); }

function onTick(s, dt) {
  let shields = 0;
  const list = s.soldiers;
  for (let i = 0; i < list.length; i++) {
    const u = list[i];
    if (!u.alive) continue;
    switch (u.type) {
      case 'shieldwall': shields++; break;
      case 'healer': tickHealer(s, u, dt); break;
      case 'scout':
        if ((s.tick + u.id) % MT.revealEvery === 0) revealAround(s, u.x, u.y, MU.scout.reveal * (s.rt.sightMult || 1));
        break;
      case 'ballistacart': tickCart(s, u, dt); break;
      default: break;
    }
  }
  s.rt.milShield = shields;
  // New soldier shots get their own look and flight (fired this tick by systems/units.js).
  const P = s.projectiles;
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    if (p.kind !== 'arrow' || p.t !== 0 || !p.src) continue;
    const a = getE(s, p.src);
    if (!a || a.kind !== 'soldier') continue;
    // A Healer never shoots (the core may loose one empty shot on its first tick), and a
    // Ballista Cart ordered onto a flyer drops the bolt instead of scoring a 0-damage hit.
    if (a.type === 'healer' || (a.type === 'ballistacart' && isFlyer(s, p.tid))) {
      P.splice(i, 1); i--;
      p.alive = false; (s.rt.projPool || (s.rt.projPool = [])).push(p);
      continue;
    }
    const sh = SHOTS[a.type];
    if (!sh) continue;
    p.kind = sh.kind; p.arc = sh.arc;
    p.dur = Math.max(0.12, p.dist / (sh.speed * T));
    if (a.type === 'battlemage') a.milShot = r6(p.dmg);
  }
}

function tickHealer(s, u, dt) {
  const d = MU.healer;
  // Never strikes: the core engage() only holds it at range, the cooldown never runs out.
  u.cd = 1; u.think = 1;
  u.milT = (u.milT || 0) - dt;
  if (u.milT <= 0) {
    u.milT = MT.thinkEvery;
    // Keep the nearest foe at arm's length (range 3.5): engage() stands still within reach.
    const e = s.rt.enemyHash.nearest(u.x, u.y, (d.healRange + 0.5) * T);
    u.targetId = e ? e.id : 0;
  }
  // Back away from anything that gets too close.
  const near = s.rt.enemyHash.nearest(u.x, u.y, MT.healerFlee * T, grounded);
  if (near) {
    const dx = u.x - near.x, dy = u.y - near.y, l = Math.hypot(dx, dy) || 1;
    stepToward(s, u, u.x + (dx / l) * T, u.y + (dy / l) * T, d.speed, dt, 'friend');
  }
  if ((s.tick + u.id) % MT.healEvery !== 0) return;
  qSelf = u; qBest = null; qScore = 1; qNow = s.time;
  s.rt.friendHash.each(u.x, u.y, d.healRange * T, pickPatient);
  const o = qBest;
  qSelf = null; qBest = null;
  if (!o) return;
  const amt = Math.min(o.maxHp - o.hp, d.heal * MT.healEvery * DT);
  o.hp += amt;
  o.milHealT = s.time; o.milHealBy = u.id;
  militaryState(s).healed = r6(militaryState(s).healed + amt);
  u.milHid = o.id; u.milHt = s.time; u.atkT = 0.3;
  if (Math.abs(o.x - u.x) > 1) u.face = o.x < u.x ? -1 : 1;
  if ((s.tick + u.id) % (MT.healEvery * 2) === 0) emit(s, { t: 'milHeal', x: o.x, y: o.y, fx: u.x, fy: u.y });
}

function tickCart(s, u, dt) {
  const d = MU.ballistacart;
  u.think = 1;
  // An order on a flyer is refused: the carriage cannot elevate that far.
  if (u.targetId) { const t = getE(s, u.targetId); if (t && t.flying) u.targetId = 0; }
  u.milT = (u.milT || 0) - dt;
  if (u.milT > 0) return;
  u.milT = MT.thinkEvery;
  const sq = s.rt.sqById ? s.rt.sqById.get(u.squad) : null;
  if (!sq) return;
  const ordered = sq.targetId ? getE(s, sq.targetId) : null;
  if (ordered && !ordered.flying) { u.targetId = ordered.id; return; }
  qX = u.x; qY = u.y; qRx = sq.rx; qRy = sq.ry; qLeash = Math.max(C.leash, d.range + 0.5) * T;
  qBest = null; qScore = 0; qDist = 1e18;
  s.rt.enemyHash.each(u.x, u.y, (d.range + 0.5) * T, pickSiegeTarget);
  u.targetId = qBest ? qBest.id : 0;
  qBest = null;
}

// ---- Damage -------------------------------------------------------------------------------------------
let splashing = false, probeSelf = null;
function isShield(e) { return e.type === 'shieldwall' && e.kind === 'soldier' && e.alive && e !== probeSelf; }
function enemyTagged(a, tag) { const d = ENEMIES[a.type]; return !!(d && d.tags && d.tags.includes(tag)); }

function dmgMult(s, a, t, type) {
  let m = 1;
  if (a && a.kind === 'soldier') {
    switch (a.type) {
      case 'archer': case 'crossbow': { const b = bonuses(s).rangeB; if (b) m *= 1 + b; break; }
      case 'ballistacart': {
        if (t.flying) return 0;
        if (t.boss || t.stationary) m *= MU.ballistacart.vsBoss;
        const b = bonuses(s).siegeB; if (b) m *= 1 + b;
        break;
      }
      case 'battlemage': {
        const b = bonuses(s).siegeB; if (b) m *= 1 + b;
        if (type === 'magic' && !splashing && t.kind === 'enemy') splash(s, a, t);
        break;
      }
      default: break;
    }
  }
  if (isFriend(t)) {
    if (t.kind === 'soldier') {
      const ud = UNITS[t.type];
      const tags = ud && ud.tags;
      if (tags) {
        if (a && a.kind === 'enemy' && !a.boss && tags.includes('cavalry') && enemyTagged(a, 'beast')) m *= MT.cavalryBeastMult;
        if (type === 'pierce' && tags.includes('armored')) m *= MT.armorPierceMult;
      }
    }
    if (shieldCount(s) > 0) {
      probeSelf = t;
      const g = s.rt.friendHash.nearest(t.x, t.y, MU.shieldwall.aura.radius * T, isShield);
      probeSelf = null;
      if (g) m *= 1 - MU.shieldwall.aura.cut;
    }
  }
  return m;
}

// Battlemage orb burst: foes within a tile of the target take `share` of the hit.
let s0 = null, spA = null, spT = null, spAmt = 0, spN = 0;
function splashOne(o) {
  if (o === spT || o.kind !== 'enemy' || (o.flying && !spT.flying)) return false;
  hurt(s0, o, spAmt, 'magic', MU.battlemage.bonus, spT.x, spT.y, spA);
  return ++spN >= MT.splashMax;
}
function splash(s, a, t) {
  const d = MU.battlemage;
  s0 = s; spA = a; spT = t; spN = 0;
  spAmt = (a.milShot || d.dmg) * d.splash.share;
  splashing = true;
  s.rt.enemyHash.each(t.x, t.y, d.splash.radius * T + 2, splashOne);
  splashing = false;
  emit(s, { t: 'milSplash', x: t.x, y: t.y - 6, n: spN });
  s0 = null; spA = null; spT = null;
}

// ---- Commands -------------------------------------------------------------------------------------------
/** 'milTrain' { id, u }: queue a support troop at a Barracks (same rules as the core 'train'). */
function cmdTrain(s, c) {
  const b = s.rt.bById.get(c.id);
  if (!b || !b.alive || !b.built) return { ok: false };
  const allowed = b.type === 'barracks' ? BARRACKS_EXTRA : [];
  if (!allowed.includes(c.u) || !UNITS[c.u]) return { ok: false, msg: 'That unit cannot be trained here.' };
  const d = UNITS[c.u];
  const cap = levelStats(b.type, b.level).squadCap || 6;
  if (squadSize(s, b) + b.train.length >= cap) return { ok: false, msg: `This squad is full. Upgrade the ${BUILDINGS[b.type].name} for more.` };
  if (!canAfford(s.res, d.cost)) return { ok: false, msg: 'Not enough resources.' };
  spend(s, d.cost);
  b.train.push({ u: c.u, t: trainTime(c.u), total: trainTime(c.u) });
  squadFor(s, b);
  return { ok: true };
}

// ---- UI: building cards, portraits, effects ---------------------------------------------------------------
let UI = null; // { el, tapButton, costHtml } loaded on first use in the browser
async function loadUI() {
  if (UI || typeof document === 'undefined') return UI;
  const dom = await import('../../ui/dom.js');
  const snd = await import('../../engine/audio.js');
  UI = { el: dom.el, tapButton: dom.tapButton, costHtml: dom.costHtml, audio: snd.audio };
  return UI;
}
if (typeof document !== 'undefined') loadUI();

function para(box, html, strong) {
  const p = UI.el('p', '', strong ? `<b style="color:#ffd27a">${html}</b>` : `<span style="font-size:14px;color:var(--parch-dim)">${html}</span>`);
  box.appendChild(p);
}
const pct = (v) => Math.round(v * 100) + '%';

/** Perk text for a training building at a level (shared by the card and tests). */
export function perkText(type, level) {
  const st = levelStats(type, level);
  const first = (key) => { const L = BUILDINGS[type].levels; for (let i = 0; i < L.length; i++) if (L[i][key]) return [i + 1, L[i][key]]; return [0, 0]; };
  if (type === 'archery') { const [lv, v] = first('rangedBonus'); return st.rangedBonus ? `Range drills: every Archer and Crossbowman in the region deals +${pct(st.rangedBonus)} damage.` : `Range drills start at level ${lv}: Archers and Crossbowmen deal +${pct(v)} damage.`; }
  if (type === 'siegeworks') { const [lv, v] = first('siegeBonus'); return st.siegeBonus ? `Engine craft: every Ballista Cart and Battlemage in the region deals +${pct(st.siegeBonus)} damage.` : `Engine craft starts at level ${lv}: Ballista Carts and Battlemages deal +${pct(v)} damage.`; }
  if (type === 'stable') return 'Cavalry squads are small: Knights and Scouts are strong one by one.';
  return '';
}

function cardSection(box, s, b, ctl) {
  if (typeof document === 'undefined' || !UI) return;
  if (MILITARY_BUILDINGS[b.type]) {
    const def = BUILDINGS[b.type];
    para(box, perkText(b.type, b.level), b.level > 0 && b.type !== 'stable');
    const next = def.levels[b.level + 1];
    if (next && b.level > 0 && (next.rangedBonus || next.siegeBonus)) para(box, `At level ${b.level + 2}: ${next.rangedBonus ? '+' + pct(next.rangedBonus) + ' Archer and Crossbowman damage' : '+' + pct(next.siegeBonus) + ' Ballista Cart and Battlemage damage'}.`);
  }
  if (b.built) supportSection(box, s, b, ctl);
}

// Shieldwall and Field Healer at a Barracks (until the core card lists them itself).
function supportSection(box, s, b, ctl) {
  const list = supportUnits(b);
  if (!list.length) return;
  const st = levelStats(b.type, b.level);
  const n = squadSize(s, b), q = b.train.length;
  box.appendChild(UI.el('div', 'queue', '<b>Support troops</b> · join this squad'));
  const row = UI.el('div', 'unitrow');
  for (const type of list) {
    const d = UNITS[type];
    const ok = canAfford(s.res, d.cost) && n + q < (st.squadCap || 6);
    const btn = UI.el('button', 'cbtn unitbtn' + (ok ? '' : ' disabled'), `<canvas width="60" height="68"></canvas><span class="meta"><span>${d.name} ${UI.costHtml(d.cost, s.res)}</span><small>Strong vs ${d.strong}</small></span>`);
    btn.setAttribute('aria-label', `Train ${d.name}`);
    drawUnitIcon(btn.querySelector('canvas'), type, s);
    UI.tapButton(btn, () => { if (ctl.cmd({ t: 'milTrain', id: b.id, u: type }).ok && UI.audio) UI.audio.play('coin'); }, { sound: null });
    row.appendChild(btn);
  }
  box.appendChild(row);
}

function drawUnitIcon(canvas, type, s) {
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  const her = s.heraldry || {};
  const sp = unitSprite(ART.artKey(type), 0, false, 2, { field: her.field, charge: her.charge, second: her.second });
  g.drawImage(sp.c, 4, 0, 52, 64);
}

function onFx(ctl, ev) {
  const P = ctl.renderer && ctl.renderer.particles;
  if (!P) return;
  switch (ev.t) {
    case 'milHeal':
      if (ctl.onScreen(ev.x, ev.y)) P.burst('spark', ev.x, ev.y - 12, 3, { speed: 22, color: ['#b8f0a0', '#fff2b0'], life: 0.7, size: 2.2, add: true });
      break;
    case 'milSplash':
      if (ctl.onScreen(ev.x, ev.y)) {
        P.burst('ember', ev.x, ev.y, 10, { speed: 70, color: ['#ffb347', '#ff7a3a', '#ffe08a'], life: 0.45, size: 2.4, add: true });
        P.burst('puff', ev.x, ev.y, 3, { speed: 20, color: '#8a5a40', life: 0.6, size: 6 });
      }
      break;
    case 'impact':
      if (ev.kind === 'qbolt' && ctl.onScreen(ev.x, ev.y)) P.burst('chip', ev.x, ev.y, 3, { speed: 40, color: '#c8ccd2', life: 0.3, size: 1.8, g: 0 });
      break;
    default: break;
  }
}

// ---- Drawing -----------------------------------------------------------------------------------------------
let drawS = null; // the region being drawn this frame (cosmetic only)
function drawGround(g, s, view, time) {
  drawS = s;
  if (!shieldCount(s)) return;
  ART.drawShieldRings(g, s, view, time, MU.shieldwall.aura.radius * T);
}
function drawWorld(g, s, view, time) {
  wrapProjectileArt();
  ART.drawHealBeams(g, s, view, time);
}
function drawLights(s, push) {
  for (let i = 0; i < s.projectiles.length; i++) {
    const p = s.projectiles[i];
    if (p.kind === 'mageorb') push(p.x, p.y - p.z, 26, 0.75);
  }
  for (let i = 0; i < s.soldiers.length; i++) {
    const u = s.soldiers[i];
    if (u.alive && u.type === 'healer') push(u.x, u.y - 14, 1.6 * T, 0.55);
  }
}


// ART_HOOKS.drawProjectileExt is a plain slot several modules wrap. Re-wrap only when a probe
// call shows our drawer is no longer anywhere in the chain (a finite, stable chain whatever
// the registration order; the hero module's wrapper follows the same rule).
let wrapped = null, probeSeen = false;
const PROBE = { kind: 'milprobe', x: 0, y: 0, sx: 0, sy: 0, tx: 0, ty: 0, t: 0, dur: 1, arc: 0, dist: 0, z: 0 };
function mine(g, p, x, y) {
  if (p === PROBE) { probeSeen = true; return false; }
  return ART.drawProjectile(g, p, x, y);
}
function inChain() {
  const cur = ART_HOOKS.drawProjectileExt;
  if (!cur || !wrapped) return false;
  if (cur === wrapped) return true;
  probeSeen = false;
  try { cur(null, PROBE, 0, 0); } catch (err) { /* a drawer choked on the probe: treat as absent */ }
  return probeSeen;
}
function wrapProjectileArt() {
  if (inChain()) return;
  const prev = ART_HOOKS.drawProjectileExt;
  wrapped = (g, p, x, y) => mine(g, p, x, y) || (prev ? prev(g, p, x, y) : false);
  ART_HOOKS.drawProjectileExt = wrapped;
}

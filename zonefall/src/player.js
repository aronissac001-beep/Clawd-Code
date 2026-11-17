// ============================================================================
// ZONEFALL 3 — the player: controls (twin stick / mouse), weapons, tools,
// gathering, consumables, survival stats, interaction targets + actions,
// crafting queue, build mode.
// ============================================================================
import { THREE, M } from './gfx/materials.js';
import { G } from './state.js';
import { Profile } from './profile.js';
import { ITEMS, WEAPONS, MELEE, THROWN, RECIPE, NODES, GATHER_PER_HIT, DEPLOY, DOORS, PIECES, HIGHWALLS, TIER, CONTAINERS, ART_IDS, OVENS } from './data.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { PlayerInv, Inv } from './inventory.js';
import { spawnActor, moveActor, settleY, muzzlePos } from './actors.js';
import { fireWeapon, meleeStrike, throwItem, hurt } from './combat.js';
import { Build, deployInfo } from './build.js';
import { doorNear, toggleDoor, openDoor, canOpen } from './doors.js';
import { Live } from './world/live.js';
import { TREE_KINDS } from './gfx/veg.js';
import { clamp, dist, angDiff, rand, randi, pick, chance } from './util.js';

const PICK_KINDS = new Set(['hemp', 'berry_bush', 'mushroom']);
const tmpV = new THREE.Vector3();

export function makePlayer(x, z, inv) {
  const p = spawnActor('player', x, z, { team: 'player', look: 'survivor' });
  p.inv = inv || new PlayerInv();
  p.sel = 0; p.food = 70; p.water = 70; p.rad = 0; p.hostileT = 0; p.useT = -1; p.useItem = null; p.reloadT = -1; p.swingCd = 0; p.fireCd = 0;
  p.artFx = {}; p.stimT = 0; p.lightOn = false; p.stepT = 0; p.queue = []; p.lastHit = null;
  p.yaw = p.ang; p.pitch = -0.05; p.eye = 1.62; p.airY = 0; p.vy = 0; p.ads = 0; p.kick = 0; p.bloom = 0; p.crouch = false;
  refreshLook(p); refreshHeld(p);
  return p;
}

export function starterKit(inv) {
  inv.belt.add('rock', 1); inv.belt.add('torch', 1); inv.belt.add('bandage', 1);
  if (G.run.perks.includes('kit')) { inv.belt.add('bow', 1); inv.main.add('arrow', 20); }
  if (G.run.perks.includes('stockpile') && !G.run.stockGiven) { inv.main.add('wood', 400); inv.main.add('stone', 300); G.run.stockGiven = true; }
}

// ---------------------------------------------------------------- looks / held
export function refreshLook(p) {
  const e = p.inv.equip; const base = Object.assign({}, (G.models && G.models.LOOKS && G.models.LOOKS.survivor) || {}, Profile.rigLook());
  base.vest = e.armor ? e.armor.id : null; base.helmet = e.helmet ? e.helmet.id : null; base.bag = e.bag ? e.bag.id : null;
  if (e.armor) { base.shirt = '#6a5a44'; base.pants = '#4a4a3e'; }
  try { p.rig.setLook(base); } catch (err) { }
  // first-person arms: bare-armed castaway until you wear armour (then sleeves + gloves)
  if (G.vm && G.vm.setLook) try { G.vm.setLook({ skin: base.skin, sleeve: base.shirt || base.skin, glove: e.armor ? '#3a322a' : null }); } catch (err) { }
  // artifact effects
  const fx = {}; for (const s of p.inv.arts) if (s) { const f = ITEMS[s.id].fx; for (const k in f) fx[k] = (fx[k] || 0) + f[k]; }
  p.artFx = fx; p.maxhp = 100 + (fx.maxhp || 0) + (G.run.perks.includes('tough') ? 20 : 0); p.hp = Math.min(p.hp, p.maxhp);
  const lost = p.inv.fixSize(); for (const s of lost) Live.dropItem(p.x, p.z, s.id, s.n, s.ammo !== undefined ? { ammo: s.ammo } : null);
}
export function heldStack(p) { return p.inv.belt.slots[p.sel] || null; }
export function refreshHeld(p) {
  const s = heldStack(p); const id = G.buildMode ? 'buildplan' : s ? s.id : null;
  const cat = s && ITEMS[s.id] ? ITEMS[s.id].cat : null;
  const show = G.buildMode || (s && ['gun', 'melee', 'throw'].includes(cat)) ? id : null;
  if (p.heldShown !== show) { p.heldShown = show; try { p.rig.setHeld(show); } catch (e) { } }
  p.reloadT = -1; p.st.reload = -1;
}

// ---------------------------------------------------------------- per-frame (first person)
const RECOIL = { bow: 0.006, pipe_pistol: 0.016, revolver: 0.03, boomstick: 0.06, pump: 0.05, smg: 0.009, ar: 0.012, hunting: 0.06, rocket_launcher: 0.08 };
export function updatePlayer(p, dt) {
  if (p.dead) { p.deadT += dt; return; }
  const inv = p.inv; const s = heldStack(p); const def = s ? ITEMS[s.id] : null;
  const S = G.settings || {};
  // ---- status
  const iron = G.run.perks.includes('iron_gut') ? 0.65 : 1;
  p.food = Math.max(0, p.food - dt * 0.065 * iron); p.water = Math.max(0, p.water - dt * 0.085 * iron);
  if (p.food <= 0) hurt(p, dt * 0.5, { kind: 'starve' }); if (p.water <= 0) hurt(p, dt * 0.6, { kind: 'thirst' });
  if (p.food > 40 && p.water > 40 && p.bleed <= 0 && p.rad < 30) p.hp = Math.min(p.maxhp, p.hp + dt * (0.22 + (p.food > 80 && p.water > 80 ? 0.25 : 0)));
  if (p.artFx.regen) p.hp = Math.min(p.maxhp, p.hp + dt * p.artFx.regen);
  const radIn = Live.radAt(p.x, p.z) + (p.artFx.radRate || 0);
  const radRes = Math.min(0.97, inv.radRes() + (p.artFx.radRes || 0));
  if (radIn > 0) { p.rad = Math.min(100, p.rad + radIn * (1 - radRes) * dt); if (chance(dt * radIn * 1.5)) Sfx.geiger(Math.min(1, radIn / 8)); }
  else p.rad = Math.max(0, p.rad - dt * 0.6);
  if (p.rad > 30) hurt(p, dt * (p.rad - 30) / 45, { kind: 'rad' });
  if (p.bleed > 0) { p.bleed -= dt; hurt(p, dt * 1.4, { kind: 'bleed' }); if (chance(dt * 2) && G.fx) G.fx.decal(p.x, p.z, 'blood', 0.2); }
  if (p.stimT > 0) p.stimT -= dt;
  if (p.hostileT > 0) p.hostileT -= dt;
  p.inSafe = !!Live.safeAt(p.x, p.z);
  if (p.dead) return;
  const cat = def ? def.cat : null;
  const isGun = cat === 'gun', isThrow = cat === 'throw', isMelee = !s || cat === 'melee';
  const blocked = G.uiBlock;
  // ---- look
  const adsNow = p.ads || 0;
  const look = Input.takeLook(0.0062 * (S.sens || 1) * (1 - adsNow * 0.45), 0.0023 * (S.sens || 1) * (1 - adsNow * 0.35), !!S.invert);
  if (!blocked) { p.yaw += look.yaw; p.pitch = clamp(p.pitch + look.pitch, -1.42, 1.42); }
  p.lookDX = blocked ? 0 : look.yaw; p.lookDY = blocked ? 0 : look.pitch;
  // recoil recovery (camera drifts back down after kicks)
  if (p.kick > 0) { const r = Math.min(p.kick, dt * 0.9 * (1 + p.kick * 8)); p.pitch -= r * 0.55; p.kick -= r; }
  // driving / flying: the vehicle moves you; you can only look around (and get out)
  if (p.vehicle) { p.ads = 0; p.crouch = false; p.sprinting = false; p.st.aim = false; p.aiming = false; p.lightOn = false; p.fireCd -= dt; p.swingCd -= dt; p.trigWas = false; return; }
  // ---- stance
  const wantCrouch = !!Input.held.crouch;
  p.crouch = wantCrouch;
  if (Input.pressed.jump && !blocked && p.airY <= 0 && !p.crouch) { p.vy = 4.7; p.airY = 0.001; Sfx.noise(0.08, 500, 1, 0.08, 'lowpass'); }
  if (p.airY > 0) { p.airY += p.vy * dt; p.vy -= 13.5 * dt; if (p.airY <= 0) { p.airY = 0; p.vy = 0; p.landT = 1; Sfx.step(stepSurface(p)); Sfx.step(stepSurface(p)); } }
  p.landT = Math.max(0, (p.landT || 0) - dt * 4);
  // ---- ADS
  const wantAds = !blocked && !G.buildMode && (isGun || isThrow) && !!Input.held.ads && p.reloadT < 0;
  p.ads = clamp(adsNow + (wantAds ? dt * 6 : -dt * 7), 0, 1);
  // ---- movement (relative to view)
  const mv = blocked ? { x: 0, y: 0, mag: 0, sprint: false } : Input.moveVec();
  const armorSpd = inv.equip.armor && ITEMS[inv.equip.armor.id].spd ? ITEMS[inv.equip.armor.id].spd : 1;
  p.sprinting = mv.sprint && mv.y > 0.5 && !p.crouch && p.ads < 0.2 && p.reloadT < 0 && p.useT < 0;
  let spd = (p.sprinting ? 6.1 : 4.2) * armorSpd * (1 + (p.artFx.speed || 0)) * (p.stimT > 0 ? 1.15 : 1);
  if (p.crouch) spd *= 0.52; if (p.ads > 0.5) spd *= 0.68; if (mv.y < -0.2) spd *= 0.85;
  if (p.useT >= 0) spd *= 0.55; if (p.slowT > 0) { spd *= 0.5; p.slowT -= dt; }
  if (Build.floorY(p.x, p.z) < -0.05) spd *= 0.55; // wading
  if (p.rad > 60) spd *= 0.85;
  if (mv.mag > 0.04) {
    const fx = Math.cos(p.yaw), fz = Math.sin(p.yaw), rx = -Math.sin(p.yaw), rz = Math.cos(p.yaw);
    const k = Math.min(1, mv.mag * 1.12) / Math.max(mv.mag, 1e-3);
    const ox = p.x, oz = p.z;
    moveActor(p, (fx * mv.y + rx * mv.x) * k * spd * dt, (fz * mv.y + rz * mv.x) * k * spd * dt, dt);
    p.stepT -= Math.hypot(p.x - ox, p.z - oz);
    if (p.stepT <= 0 && p.airY <= 0) { p.stepT = p.sprinting ? 2.1 : p.crouch ? 1.2 : 1.7; Sfx.step(stepSurface(p)); if (!p.crouch && G.onNoise) G.onNoise(p.x, p.z, p.sprinting ? 14 : 7, p); }
  } else p.speedNow = 0;
  p.ang = p.yaw;
  settleY(p, dt);
  p.eye += ((p.crouch ? 1.1 : 1.62) - p.eye) * Math.min(1, dt * 10);
  p.aiming = p.ads > 0.5; p.st.aim = isGun;
  // ---- timers
  p.fireCd -= dt; p.swingCd -= dt; p.vmFire = 0;
  p.bloom = Math.max(0, (p.bloom || 0) - dt * 2.2);
  if (p.st.recoil > 0) p.st.recoil = Math.max(0, p.st.recoil - dt * 7);
  if (p.st.flinch > 0) p.st.flinch = Math.max(0, p.st.flinch - dt * 4);
  if (p.st.throw >= 0) { p.st.throw += dt * 3; if (p.st.throw >= 1) p.st.throw = -1; }
  if (p.reloadT >= 0 && s && WEAPONS[s.id]) {
    const W = WEAPONS[s.id]; p.reloadT += dt; p.st.reload = p.reloadT / W.reload;
    if (p.reloadT >= W.reload) { finishReload(p, s); p.reloadT = -1; p.st.reload = -1; }
  }
  if (p.useT >= 0) {
    const u = ITEMS[p.useItem].use; const tm = u.time * (G.run.perks.includes('medic') && ITEMS[p.useItem].cat === 'med' ? 0.7 : 1);
    p.useT += dt; p.st.use = p.useT / tm;
    if (p.useT >= tm) { applyUse(p, p.useItem); p.useT = -1; p.st.use = -1; p.useItem = null; }
  }
  if (p.st.swing >= 0) {
    const rate = (MELEE[p.swingWith] || MELEE.fists).rate; p.st.swing += dt * rate * 1.35;
    if (p.st.swing >= 0.42 && !p.struck) { p.struck = true; const r = meleeStrike(p, p.swingWith); if (!r) Sfx.swing(); }
    if (p.st.swing >= 1) { p.st.swing = -1; p.struck = false; }
  }
  // light
  p.lightOn = !!(s && s.id === 'torch') && G.night > 0.15;
  // ---- actions
  if (G.buildMode || blocked) { p.trigWas = false; return; }
  const trigger = !!Input.held.fire || !!Input.pressed.fire;
  // gentle touch aim assist: slow the look over targets and pull a little while firing / aiming
  if (Input.touchMode && isGun && S.aimAssist !== false && (trigger || p.ads > 0.3)) assist(p, dt, WEAPONS[s.id].range);
  if (isGun && s) {
    const W = WEAPONS[s.id];
    if (Input.pressed.reload) startReload(p, s);
    if (trigger && p.reloadT < 0 && p.fireCd <= 0 && !p.sprinting) {
      if ((s.ammo || 0) <= 0) { if (!p.trigWas) { Sfx.empty(); startReload(p, s); } }
      else if (W.auto || !p.trigWas) {
        const moveK = clamp(p.speedNow / 4.2, 0, 1.4);
        const spreadMul = (p.ads > 0.6 ? 0.28 : 1.0 + moveK * 0.7) * (p.crouch ? 0.8 : 1) * (p.airY > 0 ? 2 : 1) + p.bloom;
        fireWeapon(p, s.id, p.yaw, { pitch: p.pitch, ammoId: s.ammoId || W.ammo, spreadMul, eye: true });
        s.ammo--; p.fireCd = 1 / W.rof; p.vmFire = 1;
        const rk = (RECOIL[s.id] || 0.015) * (p.ads > 0.6 ? 0.7 : 1) * (p.crouch ? 0.8 : 1);
        p.pitch = clamp(p.pitch + rk, -1.42, 1.42); p.kick = (p.kick || 0) + rk * 0.85; p.yaw += (Math.random() - 0.5) * rk * 0.6;
        p.bloom = Math.min(0.9, p.bloom + (W.auto ? 0.07 : 0.15));
        if (p.inSafe) p.hostileT = 60;
        if (G.rend) G.rend.shake = Math.max(G.rend.shake, W.rocket ? 1.2 : W.pellets ? 0.6 : 0.25);
        if (s.ammo <= 0 && countAmmo(p, s.id) > 0 && W.mag === 1) startReload(p, s);
      }
    }
  } else if (isThrow && s) {
    if (Input.released.fire || (!trigger && p.trigWas)) {
      if (p.fireCd <= 0) {
        const tgt = throwTarget(p);
        const t = throwItem(p, s.id, tgt.x, tgt.z); if (t) { s.n--; if (s.n <= 0) p.inv.belt.slots[p.sel] = null; p.st.throw = 0; p.fireCd = 0.8; refreshHeld(p); if (p.inSafe) p.hostileT = 60; }
      }
    }
    p.throwAim = trigger;
  } else if (isMelee) {
    const id = s ? s.id : 'fists';
    if (trigger && p.st.swing < 0 && p.swingCd <= 0) startSwing(p, id);
  }
  p.trigWas = trigger;
}

/** where a throw from the eyes along the current view would land */
export function throwTarget(p) {
  const sp = 15, pitch = p.pitch + 0.14; let x = p.x, z = p.z, y = p.y + p.eye;
  let vx = Math.cos(p.yaw) * Math.cos(pitch) * sp, vz = Math.sin(p.yaw) * Math.cos(pitch) * sp, vy = Math.sin(pitch) * sp;
  for (let i = 0; i < 120; i++) { const dt = 0.025; x += vx * dt; z += vz * dt; vy -= 18 * dt; y += vy * dt; if (y < Build.floorY(x, z) + 0.05) break; }
  const d = dist(p.x, p.z, x, z); if (d > 24) { const k = 24 / d; x = p.x + (x - p.x) * k; z = p.z + (z - p.z) * k; }
  return { x, z };
}
/** point on the ground / floors where the crosshair meets the world (for building) */
export function lookPoint(p, maxD = 9) {
  const ey = p.y + p.eye, cp = Math.cos(p.pitch), dx = Math.cos(p.yaw) * cp, dz = Math.sin(p.yaw) * cp, dy = Math.sin(p.pitch);
  for (let t = 0.5; t <= maxD; t += 0.12) {
    const x = p.x + dx * t, z = p.z + dz * t, y = ey + dy * t;
    if (y <= Build.floorY(x, z) + 0.02) return { x, z, y, t };
  }
  const t = Math.min(maxD, 4); return { x: p.x + Math.cos(p.yaw) * t, z: p.z + Math.sin(p.yaw) * t, y: Build.floorY(p.x + Math.cos(p.yaw) * t, p.z + Math.sin(p.yaw) * t), t, miss: true };
}

function stepSurface(p) {
  if (Build.found(Math.floor(p.x / 3), Math.floor(p.z / 3))) { const f = Build.found(Math.floor(p.x / 3), Math.floor(p.z / 3)); return f.tier === 'metal' || f.tier === 'armored' ? 'metal' : f.tier === 'stone' ? 'stone' : 'wood'; }
  const b = G.W.biomeAt(p.x, p.z); return b === 5 ? 'snow' : b === 1 || b === 4 ? 'sand' : 'grass';
}
function assist(p, dt, range) {
  let best = null, bd = 0.11;
  const ey = p.y + p.eye;
  for (const a of G.actors) {
    if (a === p || a.dead || a.team === 'haven' || a.def.invuln || (a.bot && G.bots && !G.bots.hostileToPlayer(a.bot))) continue;
    const d = dist(p.x, p.z, a.x, a.z); if (d > range || d < 1) continue;
    const yawTo = Math.atan2(a.z - p.z, a.x - p.x); const h = a.rig && a.rig.height ? a.rig.height : 1.7;
    const pitchTo = Math.atan2(a.y + h * 0.62 - ey, d);
    const da = Math.abs(angDiff(p.yaw, yawTo)) + Math.abs(p.pitch - pitchTo) * 0.6;
    if (da < bd && G.phys.los(p.x, p.z, a.x, a.z, c => c.opaque && !c.off)) { bd = da; best = { yawTo, pitchTo }; }
  }
  if (!best) return;
  const k = Math.min(1, dt * 3.2);
  p.yaw += angDiff(p.yaw, best.yawTo) * k; p.pitch += (best.pitchTo - p.pitch) * k * 0.6;
}
export function startSwing(p, id) {
  p.swingWith = MELEE[id] ? id : 'fists'; p.st.swing = 0; p.struck = false; p.swingCd = 1 / (MELEE[p.swingWith].rate * 1.05);
}

// ---------------------------------------------------------------- guns
export function ammoFor(p, wid) { const W = WEAPONS[wid]; if (p.inv.count(W.ammo) > 0) return W.ammo; if (W.alt && p.inv.count(W.alt) > 0) return W.alt; return W.ammo; }
export function countAmmo(p, wid) { const W = WEAPONS[wid]; return p.inv.count(W.ammo) + (W.alt ? p.inv.count(W.alt) : 0); }
export function startReload(p, s) {
  const W = WEAPONS[s.id]; if (!W || p.reloadT >= 0) return;
  if ((s.ammo || 0) >= W.mag || countAmmo(p, s.id) <= 0) return;
  p.reloadT = 0; Sfx.reload();
}
function finishReload(p, s) {
  const W = WEAPONS[s.id]; const aid = ammoFor(p, s.id);
  if (s.ammoId && s.ammoId !== aid && s.ammo > 0) { p.inv.add(s.ammoId, s.ammo); s.ammo = 0; }
  const need = W.mag - (s.ammo || 0); const got = p.inv.take(aid, need); s.ammo = (s.ammo || 0) + got; s.ammoId = aid;
}

// ---------------------------------------------------------------- consumables
export function useItem(p, slotInv, idx) {
  const s = slotInv.slots[idx]; if (!s) return false; const def = ITEMS[s.id];
  if (!def.use) return false; if (p.useT >= 0) return false;
  if (def.use.food && p.food > 98 && !def.use.hp) { G.ui && G.ui.toast('Not hungry'); return false; }
  if (def.use.water && !def.use.food && p.water > 98) { G.ui && G.ui.toast('Not thirsty'); return false; }
  s.n--; if (s.n <= 0) slotInv.slots[idx] = null;
  p.useT = 0; p.useItem = s.id; p.st.use = 0;
  if (def.cat === 'food') Sfx.eat(); else if (def.cat === 'drink') Sfx.drink(); else Sfx.click();
  refreshHeld(p); return true;
}
function applyUse(p, id) {
  const u = ITEMS[id].use; const med = G.run.perks.includes('medic') && ITEMS[id].cat === 'med' ? 1.2 : 1;
  if (u.hp) { if (u.hp < 0 && G.run.perks.includes('iron_gut')) { } else if (u.hp < 0) hurt(p, -u.hp, { kind: 'poison' }); else p.hp = Math.min(p.maxhp, p.hp + u.hp * med); }
  if (u.food) p.food = clamp(p.food + u.food, 0, 100);
  if (u.water) p.water = clamp(p.water + u.water, 0, 100);
  if (u.bleed) p.bleed = 0;
  if (u.rad) p.rad = Math.max(0, p.rad + u.rad);
  if (u.speed) p.stimT = u.speed;
  if (id === 'raw_meat' && !G.run.perks.includes('iron_gut') && chance(0.4)) { G.ui && G.ui.toast('That meat was bad…'); p.food = Math.max(0, p.food - 5); }
}
/** quick heal button: best med for the situation */
export function quickHeal(p) {
  const order = p.bleed > 0 ? ['bandage', 'medkit'] : p.hp < 45 ? ['medkit', 'stim', 'bandage'] : ['bandage', 'medkit', 'stim'];
  if (p.rad > 25 && p.inv.count('antirad')) order.unshift('antirad');
  for (const id of order) for (const v of [p.inv.belt, p.inv.main]) { const i = v.slots.findIndex(s => s && s.id === id); if (i >= 0) return useItem(p, v, i); }
  G.ui && G.ui.toast('No meds'); return false;
}

// ---------------------------------------------------------------- gathering (called by combat.meleeStrike)
export function meleeWorld(a, wid, hx, hz, Mw) {
  if (a !== G.player) return null;
  const forager = G.run.perks.includes('forager') ? 1.25 : 1;
  // barrels / breakable containers
  for (const c of G.containers) if (!c.gone && c.def.breakable && dist(c.x, c.z, hx, hz) < 1.1) { c.hp -= Mw.dmg; Sfx.clang(c.x, c.z); if (G.fx) G.fx.impact(c.x, c.y + 0.6, c.z, 'metal', 0, 0); if (c.hp <= 0) Live.breakContainer(c, a); return { type: 'container' }; }
  // nodes
  let node = null, nd = 1.6;
  for (const n of G.nodes) { if (n.gone) continue; const d = dist(n.x, n.z, hx, hz) - 0.6 * (n.s || 1); if (d < nd) { nd = d; node = n; } }
  if (node) {
    const def = NODES[node.type]; const amt = GATHER_PER_HIT * Mw.ore * forager;
    const got = {};
    for (const [id, k] of def.yield) { const n = Math.max(1, Math.round(amt * k * rand(0.85, 1.15))); got[id] = n; }
    if (def.bonus) for (const [id, ch] of def.bonus) if (chance(ch * (Mw.ore > 0.9 ? 1.5 : 1))) got[id] = (got[id] || 0) + randi(1, 3);
    for (const id in got) give(a, id, got[id], node.x, node.y + 1, node.z);
    const done = Live.hitNode(node, amt);
    Sfx.mine(node.x, node.z); if (G.fx) G.fx.chips(node.x, node.y + 0.7, node.z, node.type === 'sulfur' ? 'sulfur' : node.type === 'metal' ? 'metal' : 'stone');
    if (done) { give(a, def.yield[0][0], Math.round(amt * 1.5), node.x, node.y + 1.2, node.z); Sfx.thud(node.x, node.z); if (G.onGather) G.onGather('node', node.type); }
    return { type: 'node' };
  }
  // trees
  const v = Live.vegNear(hx, hz, 1.5, TREE_KINDS);
  if (v && v.kind !== 'cactus') {
    const amt = GATHER_PER_HIT * Mw.wood * forager; const n = Math.max(1, Math.round(amt * rand(0.85, 1.15)));
    give(a, 'wood', n, v.x, v.y + 1.4, v.z);
    const felled = Live.hitTree(v, amt);
    Sfx.chop(v.x, v.z); if (G.fx) G.fx.chips(v.x, v.y + 1.1, v.z, 'wood');
    if (felled) { give(a, 'wood', Math.round(amt * 2), v.x, v.y + 1.6, v.z); Sfx.treefall(v.x, v.z); if (G.onGather) G.onGather('tree'); }
    return { type: 'tree' };
  }
  if (v && v.kind === 'cactus') { hurt(a, 2, { kind: 'cactus' }); give(a, 'water_bottle', chance(0.1) ? 1 : 0, v.x, v.y + 1, v.z); return { type: 'tree' }; }
  // boulders
  for (const q of [Live.vegNear(hx, hz, 1.8, new Set(['boulder']))]) if (q) { give(a, 'stone', Math.max(1, Math.round(GATHER_PER_HIT * Mw.ore * 0.3)), q.x, q.y + 1, q.z); Sfx.mine(q.x, q.z); if (G.fx) G.fx.chips(q.x, q.y + 0.8, q.z, 'stone'); return { type: 'node' }; }
  return null;
}
/** give items to the player (overflow drops on the ground) + floating text */
export function give(p, id, n, x, y, z) {
  if (n <= 0) return;
  const left = p.inv.add(id, n);
  if (left > 0) Live.dropItem(p.x, p.z, id, left);
  if (G.ui) G.ui.floatText('+' + n + ' ' + ITEMS[id].name, x ?? p.x, y ?? p.y + 2, z ?? p.z, ITEMS[id].col);
  if (G.onGive) G.onGive(id, n);
}

// ---------------------------------------------------------------- interaction targets
export function findInteract(p) {
  if (p.vehicle) return { s: 0, kind: 'vehicle', o: { act: 'exit' }, label: p.vehicle.kind === 'heli' ? 'Get out of the minicopter' : 'Get out of the buggy', icon: 'hand' };
  const out = []; const fx = Math.cos(p.ang), fz = Math.sin(p.ang);
  const score = (x, z, r) => { const d = dist(p.x, p.z, x, z); if (d > r) return null; const ang = Math.abs(angDiff(p.yaw ?? p.ang, Math.atan2(z - p.z, x - p.x))); if (ang > 0.85 && d > 0.9) return null; return d * 0.6 + ang * 1.6; };
  const push = (o) => { if (o.s !== null && o.s !== undefined) out.push(o); };
  // doors
  for (const d of G.doors) {
    const s = score(d.x, d.z, d.gate ? 2.8 : 2.2); if (s === null) continue;
    if (d.owner === 'player') push({ s, kind: 'door', o: d, label: d.open ? 'Close door' : 'Open door', icon: 'door' });
    else if (d.owner === 'mon') {
      if (d.card && d.locked) push({ s, kind: 'vault', o: d, label: vaultLabel(d), icon: 'lock' });
      else push({ s, kind: 'door', o: d, label: d.open ? 'Close door' : 'Open door', icon: 'door' });
    }
  }
  for (const c of G.containers) { if (c.gone) continue; const s = score(c.x, c.z, 1.9); if (s === null) continue; if (Math.abs((c.y ?? p.y) - p.y) > 2.2) continue;
    if (c.locked) { const left = c.hackEnd ? Math.max(0, Math.ceil(c.hackEnd - G.t)) : 0; push({ s: s - 0.2, kind: 'hack', o: c, label: left ? 'Unlocking… ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') : 'Hack the lock (2 min)', icon: 'lock' }); continue; }
    push({ s: s - 0.2, kind: c.def.breakable ? 'kick' : 'loot', o: c, label: c.def.breakable ? 'Smash ' + c.def.name : 'Open ' + c.def.name, icon: c.def.breakable ? 'hand' : 'stash' }); }
  for (const d of G.drops) { const s = score(d.x, d.z, 1.8); if (s === null) continue; push({ s: s - 0.3, kind: 'drop', o: d, label: d.kind === 'bag' ? 'Open bag' : 'Pick up', icon: 'backpack' }); }
  for (const d of Build.deploys) {
    if (d.owner !== 'player') continue; const s = score(d.x, d.z, (d.r || 0.5) + 1.5); if (s === null) continue;
    const L = deployLabel(d); if (L) push({ s, kind: 'deploy', o: d, label: L[0], icon: L[1] });
  }
  for (const u of G.uses) { const s = score(u.x, u.z, 2.4); if (s === null) continue; const L = useLabel(u); if (L) push({ s, kind: 'use', o: u, label: L[0], icon: L[1] }); }
  for (const a of G.actors) if (a.bot && !a.dead && G.bots && !G.bots.hostileToPlayer(a.bot)) { const s = score(a.x, a.z, 2.8); if (s !== null) push({ s: s - 0.1, kind: 'bot', o: a.bot, label: 'Talk to ' + a.bot.name, icon: 'info' }); }
  for (const a of G.actors) if (a.def.trader && !a.dead) { const s = score(a.x, a.z, 3); if (s !== null) { const u = G.uses.find(q => q.type === 'vendor' && dist(q.x, q.z, a.x, a.z) < 4); if (u) push({ s, kind: 'use', o: u, label: 'Trade', icon: 'vendor' }); } }
  if (G.train) G.train.interacts(p, push);
  if (G.vehicles) G.vehicles.interacts(p, push);
  // pickables
  const v = Live.vegNear(p.x + fx * 0.6, p.z + fz * 0.6, 1.7, PICK_KINDS);
  if (v) push({ s: dist(p.x, p.z, v.x, v.z), kind: 'pick', o: v, label: v.kind === 'hemp' ? 'Pick hemp' : v.kind === 'berry_bush' ? 'Pick berries' : 'Pick mushrooms', icon: 'hand' });
  // gather targets
  const reachX = p.x + fx * 1.4, reachZ = p.z + fz * 1.4;
  for (const n of G.nodes) { if (n.gone) continue; const s = score(n.x, n.z, 2.0 + 0.6 * (n.s || 1)); if (s !== null) push({ s: s + 0.3, kind: 'gather', o: n, label: 'Mine ' + n.type + ' (hold)', icon: 'hammer', hold: true }); }
  const t = Live.vegNear(reachX, reachZ, 1.9, TREE_KINDS);
  if (t && t.kind !== 'cactus') push({ s: dist(p.x, p.z, t.x, t.z) + 0.4, kind: 'gather', o: t, label: 'Chop tree (hold)', icon: 'hammer', hold: true, tree: true });
  // water
  const wx = p.x + fx * 1.4, wz = p.z + fz * 1.4;
  if (G.W.height(wx, wz) < -0.15 || G.W.height(p.x, p.z) < -0.05) push({ s: 1.5, kind: 'water', label: p.inv.count('water_bottle') < 3 && G.W.biomeAt(wx, wz) === 7 ? 'Drink' : 'Drink', icon: 'drop' });
  out.sort((a, b) => a.s - b.s);
  return out[0] || null;
}
function vaultLabel(d) {
  const m = d.mon; const cardId = 'key_' + d.card;
  if (d.fuse && !(m && m.power > G.t)) return 'Needs power — find the fuse box';
  if (d.lever && !(m && m.lever > G.t)) return 'Locked — pull the lever';
  return G.player.inv.count(cardId) > 0 ? 'Swipe ' + d.card + ' card' : 'Needs ' + d.card + ' keycard';
}
function deployLabel(d) {
  switch (d.type) {
    case 'tc': return ['Tool Cupboard', 'tc'];
    case 'box_small': case 'box_large': return ['Open box', 'box'];
    case 'furnace': return ['Furnace', 'furnace'];
    case 'campfire': return ['Campfire', 'campfire'];
    case 'workbench1': case 'workbench2': case 'workbench3': return ['Workbench', 'workbench'];
    case 'research': return ['Research table', 'research'];
    case 'recycler': return ['Recycler', 'recycle'];
    case 'water_barrel': return ['Drink (' + Math.round(d.state.water || 0) + ')', 'drop'];
    case 'planter': return d.state.growth >= 1 ? ['Harvest', 'planter'] : null;
    case 'sleeping_bag': case 'bed': return null;
    default: return null;
  }
}
function useLabel(u) {
  const m = u.mon;
  switch (u.type) {
    case 'recycler': return ['Recycle', 'recycle'];
    case 'vendor': return ['Trade', 'vendor'];
    case 'fusebox': return m && m.power > G.t ? ['Powered', 'check'] : ['Insert fuse', 'info'];
    case 'lever': return m && m.lever > G.t ? ['Lever pulled', 'check'] : ['Pull lever', 'hand'];
    case 'water': return ['Drink', 'drop'];
    case 'blackjack': return ['Play blackjack', 'vendor'];
    case 'duckrace': return ['Bet on the duck race', 'vendor'];
  }
  return null;
}

/** perform the current interaction (tap). `hold` true while held for gather */
export function doInteract(p, it) {
  if (!it) return;
  switch (it.kind) {
    case 'door': { const d = it.o; if (d.owner === 'player' || canOpen(d, p)) toggleDoor(d, p.x, p.z); break; }
    case 'vault': {
      const d = it.o; const m = d.mon; const cardId = 'key_' + d.card;
      if (d.fuse && !(m && m.power > G.t)) { Sfx.deny(); G.ui.toast('No power. Put a fuse in the fuse box.'); break; }
      if (d.lever && !(m && m.lever > G.t)) { Sfx.deny(); G.ui.toast('Locked. A lever somewhere opens the lock.'); break; }
      if (p.inv.take(cardId, 1) <= 0) { Sfx.deny(); G.ui.toast('You need a ' + d.card + ' keycard.'); break; }
      Sfx.card(); d.locked = false; d.unlockT = 240; openDoor(d, p.x, p.z); G.ui.toast('Access granted', 'good'); if (G.onVault) G.onVault(d);
      break;
    }
    case 'loot': { const c = it.o; const open = () => { c.opened = true; G.ui.openLoot(c.inv, c.def.name, () => Live.checkEmpty(c), c.def.search); };
      if (G.net && G.net.role === 'guest') { G.netWorld.openContainer(c, open); break; } // the host rolls the loot
      Live.lootOf(c); open(); break; }
    case 'hack': { const c = it.o; if (!c.locked || c.hackEnd) { Sfx.deny(); break; }
      if (G.net && G.net.role === 'guest') G.net.send({ t: 'hack', cid: c.id }); else if (G.cargo) G.cargo.startHack(c, p);
      Sfx.card(); break; }
    case 'kick': { startSwing(p, heldStack(p) && MELEE[heldStack(p).id] ? heldStack(p).id : 'fists'); p.ang = Math.atan2(it.o.z - p.z, it.o.x - p.x); break; }
    case 'drop': { const d = it.o; if (d.kind === 'bag' || d.inv.items().length > 1) G.ui.openLoot(d.inv, d.kind === 'bag' ? 'Loot bag' : 'Items', null, 0); else { for (const s of d.inv.items()) { const left = p.inv.addStack(s); if (!left) Sfx.pickup(); } d.inv.clear(); Live.removeDrop(d); } break; }
    case 'deploy': deployInteract(p, it.o); break;
    case 'bot': G.bots.talk(it.o); break;
    case 'train': if (G.train) G.train.interact(p, it.o); break;
    case 'vehicle': if (G.vehicles) G.vehicles.interact(p, it.o); break;
    case 'use': useInteract(p, it.o); break;
    case 'pick': {
      const v = it.o; Live.pickVeg(v); Sfx.pickup();
      if (v.kind === 'hemp') give(p, 'cloth', randi(8, 12), v.x, v.y + 1, v.z);
      else if (v.kind === 'berry_bush') give(p, 'berries', randi(2, 4), v.x, v.y + 1, v.z);
      else give(p, 'mushroom', randi(1, 3), v.x, v.y + 0.6, v.z);
      if (G.onGather) G.onGather('pick', v.kind);
      break;
    }
    case 'gather': {
      const o = it.o; p.ang = Math.atan2(o.z - p.z, o.x - p.x);
      if (p.st.swing < 0 && p.swingCd <= 0) { const s = heldStack(p); const tool = s && MELEE[s.id] ? s.id : (p.inv.belt.slots.find(q => q && MELEE[q.id] && (it.tree ? MELEE[q.id].wood >= 1 : MELEE[q.id].ore >= 1)) || {}).id || (s && MELEE[s.id] ? s.id : 'fists'); startSwing(p, tool); }
      break;
    }
    case 'water': {
      if (p.water >= 99) { G.ui.toast('Not thirsty'); break; }
      p.water = Math.min(100, p.water + 22); Sfx.drink(); Sfx.splash(p.x, p.z);
      if (G.W.height(p.x, p.z) < -0.05 && G.W.biomeAt(p.x, p.z) === 0) { p.water -= 10; G.ui.toast('Salt water…'); }
      break;
    }
  }
}
function deployInteract(p, d) {
  switch (d.type) {
    case 'tc': G.ui.openStorage(d, 'Tool Cupboard'); break;
    case 'box_small': case 'box_large': G.ui.openStorage(d, DEPLOY[d.type].name); break;
    case 'furnace': case 'campfire': G.ui.openOven(d); break;
    case 'workbench1': case 'workbench2': case 'workbench3': G.ui.openCraft(); break;
    case 'research': G.ui.openResearch(); break;
    case 'recycler': G.ui.openRecycler(); break;
    case 'water_barrel': if (d.state.water > 1 && p.water < 99) { const k = Math.min(d.state.water, 100 - p.water, 30); d.state.water -= k; p.water += k; Sfx.drink(); } else G.ui.toast(d.state.water <= 1 ? 'Empty — refills at dawn' : 'Not thirsty'); break;
    case 'planter': if (d.state.growth >= 1) { for (const k in DEPLOY.planter.prod) give(p, k, DEPLOY.planter.prod[k], d.x, d.y + 1, d.z); d.state.growth = 0; Sfx.pickup(); } break;
  }
}
function useInteract(p, u) {
  const m = u.mon;
  switch (u.type) {
    case 'recycler': G.ui.openRecycler(); break;
    case 'vendor': G.ui.openShop(u.shop); break;
    case 'fusebox':
      if (m && m.power > G.t) { G.ui.toast('Already powered'); break; }
      if (p.inv.take('fuse', 1) <= 0) { Sfx.deny(); G.ui.toast('You need an Electric Fuse.'); break; }
      m.power = G.t + 480; Sfx.lever(); Sfx.card(); G.ui.toast('Power restored (8 min)', 'good'); break;
    case 'lever': if (m) { m.lever = G.t + 240; Sfx.lever(); G.ui.toast('Something unlocked…', 'good'); } break;
    case 'water': if (p.water < 99) { p.water = Math.min(100, p.water + 25); Sfx.drink(); } else G.ui.toast('Not thirsty'); break;
    case 'blackjack': import('./casino.js').then(C => C.openBlackjack(G.ui)).catch(e => console.warn('casino', e)); break;
    case 'duckrace': import('./casino.js').then(C => { if (C.setDuckTrack) C.setDuckTrack(u.track || null); C.openDuckRace(G.ui); }).catch(e => console.warn('casino', e)); break;
  }
}

// ---------------------------------------------------------------- crafting
export function craftCost(r, n = 1) { const o = {}; for (const k in r.cost) o[k] = r.cost[k] * n; return o; }
export function canCraft(p, r, n = 1) {
  if (r.bp && !G.run.bps.includes(r.id)) return 'Blueprint needed';
  if (r.wb > Build.wbTier(p.x, p.z)) return 'Needs Workbench T' + r.wb;
  const cost = craftCost(r, n); for (const k in cost) if (haveCount(p, k) < cost[k]) return 'Missing ' + ITEMS[k].name;
  return null;
}
/** inventory + base storage (when inside your claim) */
export function haveCount(p, id) { return p.inv.count(id) + (Build.inPrivilege(p.x, p.z) ? Build.storageCount(id) : 0); }
export function spend(p, cost) {
  for (const k in cost) { let need = cost[k]; need -= p.inv.take(k, need); if (need > 0 && Build.inPrivilege(p.x, p.z)) Build.storageTake(k, need); }
}
export function craft(p, r, n = 1) {
  const why = canCraft(p, r, n); if (why) { G.ui.toast(why); Sfx.deny(); return false; }
  spend(p, craftCost(r, n));
  const time = Math.max(1, 1.5 + r.wb * 1.5 + (ITEMS[r.out].cat === 'gun' ? 4 : 0)) * n * 0.6;
  p.queue.push({ r, n, t: 0, time }); Sfx.craft(); return true;
}
export function updateCrafting(p, dt) {
  const q = p.queue[0]; if (!q) return;
  q.t += dt; if (q.t >= q.time) { p.queue.shift(); give(p, q.r.out, q.r.n * q.n); Sfx.pickup(); if (G.onCraft) G.onCraft(q.r.out); }
}

// ---------------------------------------------------------------- building
export function buildCostFor(type, tier) { return Build.costOf(type, tier); }
export function canAfford(p, cost) { for (const k in cost) if (haveCount(p, k) < cost[k]) return false; return true; }
export function tryPlace(p, type, t, tier) {
  const def = PIECES[type] || DOORS[type] || HIGHWALLS[type] || DEPLOY[type];
  if (def.wb && def.wb > Build.wbTier(p.x, p.z) && !DOORS[type]) { G.ui.toast('Needs Workbench T' + def.wb + ' nearby'); return null; }
  if (DOORS[type] && def.wb && def.wb > Build.wbTier(p.x, p.z)) { G.ui.toast('Needs Workbench T' + def.wb + ' nearby'); return null; }
  const chk = Build.check(type, t); if (!chk.ok) { G.ui.toast(chk.why); Sfx.deny(); return null; }
  const cost = Build.costOf(type, tier);
  if (!canAfford(p, cost)) { G.ui.toast('Not enough resources'); Sfx.deny(); return null; }
  // gates: a gate needs a gateway in a high wall; placing a gate on a plain high wall converts it
  spend(p, cost);
  const r = Build.place(type, t, tier, 'player', {});
  if (r) { Sfx.build(); if (G.onBuilt) G.onBuilt(type, r); }
  return r;
}
void THREE; void M; void TIER; void CONTAINERS; void ART_IDS; void OVENS; void RECIPE; void THROWN; void muzzlePos; void Inv; void tmpV; void pick; void doorNear; void deployInfo; void rand;

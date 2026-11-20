// ============================================================================
// ZONEFALL 3 — combat: firing weapons, projectiles (bullets, arrows, rockets),
// thrown explosives (their physics: throwing.js), melee strikes (also
// gathering), damage to actors and structures, explosions (core, falloff,
// cover, shrapnel), turrets.
// ============================================================================
import { THREE, M } from './gfx/materials.js';
import { G } from './state.js';
import { WEAPONS, AMMO_MOD, MELEE, THROWN, TIER, ITEMS, DEPLOY, attFx, rollNpcAtt } from './data.js';
import { Build } from './build.js';
import { damageDoor } from './doors.js';
import { Sfx } from './audio.js';
import { muzzlePos, airborne } from './actors.js';
import { rand, clamp, angDiff, dist } from './util.js';
import { stepThrown, STEP, GRAV, netThrow } from './throwing.js';

const OPAQ = c => c.opaque && !c.off;

// how much each damage type hurts each building tier
const STRUCT_MULT = {
  bullet: { twig: 1, wood: 0.12, stone: 0.02, metal: 0.0, armored: 0 },
  melee: { twig: 6, wood: 1, stone: 0.25, metal: 0.1, armored: 0.05 },
  raider: { twig: 6, wood: 1, stone: 0.6, metal: 0.36, armored: 0.2 },
  explosive: { twig: 3, wood: 1.25, stone: 1, metal: 0.8, armored: 0.6 },
  fire: { twig: 4, wood: 1.5, stone: 0, metal: 0, armored: 0 },
};

export function tierOf(o) { return o.tier || (o.kind && o.kind.includes('wood') ? 'wood' : o.metal ? 'metal' : 'wood'); }

/** damage any structure-like object (piece, door, deployable) */
export function damageStruct(o, amt, type = 'melee') {
  if (!o || o.dead) return 0;
  if (o.owner === 'mon' || o.invuln) return 0;
  let dmg = amt;
  if (o.sk === 'door') {
    const tier = o.kind === 'door_wood' || o.kind === 'gate_wood' ? 'wood' : o.kind === 'door_armored' ? 'armored' : o.kind === 'gate_stone' ? 'stone' : 'metal';
    dmg *= STRUCT_MULT[type][tier] ?? 1;
    if (dmg > 0) { damageDoor(o, dmg); if (G.onStructHit) G.onStructHit(o, dmg, type); }
    return dmg;
  }
  if (o.sk === 'deploy') {
    dmg *= type === 'bullet' ? 0.25 : 1;
    Build.damageDeploy(o, dmg); if (G.onStructHit) G.onStructHit(o, dmg, type); return dmg;
  }
  dmg *= STRUCT_MULT[type][o.tier] ?? 1;
  if (dmg > 0) { Build.damage(o, dmg); if (G.onStructHit) G.onStructHit(o, dmg, type); }
  return dmg;
}

// ---------------------------------------------------------------- actors
/** returns true if killed */
export function hurt(a, dmg, src = {}) {
  if (!a || a.dead || a.def.invuln) return false;
  if (G.player && src.owner && src.owner !== a && (a === G.player || src.owner === G.player) && a.team !== 'haven') G.player.combatT = G.t; // the music knows you're fighting
  if (src.kind === 'melee' && src.owner && !src.owner.heli && airborne(a)) return false; // nothing on the ground can bite or club a pilot in the air
  // other players in co-op: their own game decides damage; my melee hits are sent to them
  if (a.remote !== undefined) {
    if (src.kind === 'melee' && src.owner === G.player && G.net) G.net.melee(a, dmg);
    else if (src.kind === 'melee' && src.owner && G.net && G.net.role === 'host') G.net.npcMelee(a, dmg, src.owner, src.bleed);
    return false;
  }
  // the host's creatures (mirrored on a guest): the host decides the damage
  if (a.mirror !== undefined) {
    if (G.net && G.net.role === 'guest' && src.kind !== 'explosion') {
      G.net.send({ t: 'ahit', aid: a.mirror, dmg: Math.round(dmg * 10) / 10, crit: !!src.crit, pen: src.pen || 0, kind: src.kind || '', bleed: src.bleed || 0 });
      if (src.owner === G.player && G.ui && G.ui.dmgNum) G.ui.dmgNum(a, dmg * (src.crit ? 1.6 : 1) * (1 - (a.armor || 0) * (1 - (src.pen || 0))), !!src.crit, actorHeight(a) * 0.85 + 0.75);
    }
    return false;
  }
  if (G.safeAt && a !== G.player && a.team === 'haven') return false;
  let d = dmg;
  const pen = src.pen || 0;
  // armour
  if (a === G.player) {
    const arm = G.player.inv.armorVal() + (G.player.artFx ? G.player.artFx.armor || 0 : 0);
    d *= 1 - clamp(arm, 0, 0.8) * (1 - pen);
    if (src.crit) { const c = G.player.inv.equip.helmet ? ITEMS[G.player.inv.equip.helmet.id].crit || 0 : 0; d *= 1.5 - c * 0.45; }
  } else {
    d *= 1 - a.armor * (1 - pen);
    if (src.crit) d *= a.helm ? 1.15 : 1.7;
  }
  a.hp -= d; a.flash = 1; a.st.flinch = 1;
  if (src.bleed && Math.random() < src.bleed) a.bleed = Math.max(a.bleed, 6);
  if (G.onHurt) G.onHurt(a, d, src);
  if (a.hp <= 0) { a.hp = 0; if (G.onKill) G.onKill(a, src); return true; }
  return false;
}

// ---------------------------------------------------------------- firing
/** the attachments on whatever gun an actor is firing: opts.att, a bot's / remote player's stack, or an NPC's gun (rolled the first time it fires) */
function shooterAtt(a, wid, opts) {
  if (opts.att !== undefined) return opts.att;
  if (a.gunStack && a.gunStack.id === wid) return a.gunStack.att || null;
  const g = a.gun; if (!g || g.id !== wid) return null;
  if (g.att === undefined) {
    g.att = a.remote !== undefined || a.mirror !== undefined ? null : rollNpcAtt(a.type, wid);
    if (g.att && a.rig && a.rig.setHeld && a.held === wid) try { a.rig.setHeld(wid, g.att); } catch (e) { }
  }
  return g.att;
}
/**
 * Fire a weapon from actor `a` at angle `ang`. Handles pellets, spread,
 * tracers, sound + noise alert. Returns true if a shot happened.
 * opts.att = the gun's attachments (else read from the actor); opts.ads = how far the shooter is aiming (0..1).
 */
export function fireWeapon(a, wid, ang, opts = {}) {
  const W = WEAPONS[wid]; if (!W) return false;
  const ammoId = opts.ammoId || W.ammo; const mod = AMMO_MOD[ammoId] || {};
  const F = attFx(shooterAtt(a, wid, opts));
  // attachments: hip vs aimed spread (NPCs count as half-aimed), noise, range, projectile speed
  const adsK = opts.ads !== undefined ? (opts.ads > 0.6 ? 1 : 0) : a === G.player ? 0 : 0.5;
  const attSpread = (F.hip + (F.ads - F.hip) * adsK) * F.spread;
  const pellets = W.pellets || 1; const spreadMul = (opts.spreadMul ?? 1) * attSpread;
  const kind = W.arrow ? 'arrow' : W.rocket ? 'rocket' : 'bullet';
  if (opts.eye) { // first-person shot: from the eyes along the view, tracer drawn from the weapon's muzzle
    const ex = a.x, ez = a.z, ey = a.y + (a.eye || 1.6) + (a.airY || 0);
    const vm = G.vmMuzzle; // world position of the viewmodel muzzle (set by the game each frame)
    const net = a === G.player && G.net ? [] : null;
    for (let i = 0; i < pellets; i++) {
      const r = Math.sqrt(Math.random()) * W.spread * spreadMul, th = Math.random() * Math.PI * 2;
      if (net) net.push([ang + Math.cos(th) * r, (opts.pitch || 0) + Math.sin(th) * r]);
      spawnProjectile({
        x: ex, z: ez, y: ey, ang: ang + Math.cos(th) * r, pitch: (opts.pitch || 0) + Math.sin(th) * r, v3: true,
        speed: W.speed * F.speed * rand(0.97, 1.03), dmg: W.dmg * (mod.dmg || 1) * (opts.dmgMul || 1), pen: (W.pen || 0) + (mod.pen || 0),
        range: W.range * F.range * (W.pellets ? rand(0.85, 1.05) : 1.15), owner: a, team: a.team, kind, wid,
        off: vm ? { x: vm.x - ex, y: vm.y - ey, z: vm.z - ez } : null,
      });
    }
    if (net) G.net.shot(wid, ex, ey, ez, net);
    // the viewmodel draws its own flash; the world still gets the light pop (a silencer hides both)
    if (G.fx && !W.arrow && vm && F.flash) { if (G.vm && G.vm.flash && !G.vm.hidden) G.fx.light(vm.x, vm.y, vm.z, '#ffc070', W.rocket ? 2.2 : 0.8, 9, 0.06); else G.fx.muzzle(vm.x, vm.y, vm.z, ang, W.rocket ? 0.9 : 0.32); }
  } else {
    const mp = muzzlePos(a);
    // don't spawn inside a wall when hugging it
    let sx = mp.x, sz = mp.z;
    if (!G.phys.los(a.x, a.z, sx, sz, OPAQ)) { sx = a.x; sz = a.z; }
    // shots at a living target are aimed in 3D (at the chest), so cover and crouching matter
    const T = opts.target && !opts.target.dead ? opts.target : null;
    let pitch = 0;
    if (T) { const d = Math.hypot(T.x - sx, T.z - sz) || 1; const ty = T === G.player ? T.y + (T.eye || 1.6) * 0.72 + (T.airY || 0) : T.y + actorHeight(T) * 0.6; pitch = Math.atan2(ty - mp.y, d) + (opts.pitchErr || 0); }
    const npcNet = G.net && G.net.role === 'host' && a.remote === undefined && T ? [] : null;
    for (let i = 0; i < pellets; i++) {
      const s = (Math.random() - 0.5) * 2 * W.spread * spreadMul; const pp = T ? pitch + (Math.random() - 0.5) * W.spread * spreadMul * 0.8 : 0;
      if (npcNet) npcNet.push([ang + s, pp]);
      spawnProjectile({
        x: sx, z: sz, y: mp.y, ang: ang + s, pitch: pp, v3: !!T, speed: W.speed * F.speed * rand(0.95, 1.05), dmg: W.dmg * (mod.dmg || 1) * (opts.dmgMul || 1), pen: (W.pen || 0) + (mod.pen || 0),
        range: W.range * F.range * (W.pellets ? rand(0.8, 1.05) : 1), owner: a, team: a.team, kind, wid,
      });
    }
    if (npcNet && G.netWorld) G.netWorld.npcShot(a, wid, sx, mp.y, sz, npcNet);
    if (G.fx && !W.arrow && F.flash) G.fx.muzzle(mp.x, mp.y, mp.z, ang, W.rocket ? 2 : 1);
  }
  // a silenced shot is a short muffled "thwip" (and much harder to hear from afar)
  Sfx.shot(F.quiet ? 'turret' : W.sfx, a === G.player ? undefined : a.x, a === G.player ? undefined : a.z);
  if (G.onNoise && W.noise) G.onNoise(a.x, a.z, W.noise * F.noise, a);
  a.st.recoil = 1;
  return true;
}

export function spawnProjectile(p) {
  const cp = Math.cos(p.pitch || 0);
  p.vx = Math.cos(p.ang) * p.speed * cp; p.vz = Math.sin(p.ang) * p.speed * cp; p.dist = 0; p.life = 0;
  p.vy = p.v3 ? Math.sin(p.pitch || 0) * p.speed + (p.kind === 'arrow' ? 1.0 : 0) : p.kind === 'arrow' ? 2.2 : 0;
  if (G.fx) p.mesh = G.fx.projectile(p.kind);
  G.projectiles.push(p);
  return p;
}

export function updateProjectiles(dt) {
  const P = G.projectiles;
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i]; p.life += dt;
    const step = Math.hypot(p.vx, p.vz) * dt; let nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
    const y0 = p.y;
    if (p.kind === 'arrow') p.vy -= 9.8 * dt * 0.55;
    if (p.v3 || p.kind === 'arrow') p.y += p.vy * dt;
    const y1 = p.y;
    let hitT = 1, hitObj = null, hitKind = null, hx = nx, hz = nz;
    // world (3D shots fly over anything lower than they are)
    const w = p.v3 ? ray3(p.x, p.z, nx, nz, y0, y1) : G.phys.raycast(p.x, p.z, nx, nz, OPAQ);
    if (w) { hitT = w.t; hitObj = w.c; hitKind = 'world'; hx = w.x; hz = w.z; p.y = y0 + (y1 - y0) * w.t; }
    // floors and ceilings (storeys, decks, roofs) and the ground itself: find where the shot crosses a walking surface
    if (p.v3) {
      const tEnd = w ? w.t : 1, steps = Math.max(1, Math.ceil(step * tEnd / 1.2)); let prevY = y0;
      for (let k = 1; k <= steps; k++) {
        const tt = tEnd * k / steps, sx = p.x + (nx - p.x) * tt, sz = p.z + (nz - p.z) * tt, sy = y0 + (y1 - y0) * tt;
        const below = Build.floorY(sx, sz, prevY - 0.89);            // the surface under where it just was
        const now = Build.floorY(sx, sz, sy - 0.89);                 // the surface under where it is
        if (sy < below - 0.02 || now > prevY + 0.02) {              // went down through a floor, or up through a ceiling
          hitKind = 'ground'; hitT = tt; hx = sx; hz = sz; p.y = sy < below - 0.02 ? below : now; hitObj = null; break;
        }
        prevY = sy;
      }
    }
    // actors (circle test along the segment)
    const dx = nx - p.x, dz = nz - p.z, L2 = dx * dx + dz * dz || 1e-9;
    for (const a of G.actors) {
      if (a.dead || a === p.owner || (a.team === p.team && p.team !== 'hostile') || a.def.invuln) continue;
      if (p.remote && a !== G.player) continue; // another player's shot only matters to me (my NPCs aren't in their world)
      if (p.team === 'hostile' && a.team === 'hostile') continue;
      if (p.team === 'raider' && a.team === 'raider') continue;
      const fx = a.x - p.x, fz = a.z - p.z; const t = clamp((fx * dx + fz * dz) / L2, 0, 1);
      const cx = p.x + dx * t - a.x, cz = p.z + dz * t - a.z; const rr = a.r + (p.kind === 'rocket' ? 0.3 : 0.12);
      if (cx * cx + cz * cz < rr * rr && t < hitT) {
        if (p.v3) { // vertical check against the body; the top of a humanoid is the head
          const yy = y0 + (y1 - y0) * t, H = actorHeight(a);
          if (a.heli ? Math.abs(yy - a.y) > 2.2 : (yy < a.y - 0.15 || yy > a.y + H + 0.12)) continue;
          p.headshot = (a.kind === 'human' || a.kind === 'mutant') && yy > a.y + H * 0.82;
        }
        hitT = t; hitObj = a; hitKind = 'actor'; hx = p.x + dx * t; hz = p.z + dz * t;
      }
    }
    p.dist += step * hitT;
    const out = p.dist > p.range || (p.kind === 'arrow' && p.y < G.W.height(nx, nz) + 0.05);
    if (hitKind || out) {
      onProjectileHit(p, hitKind, hitObj, hx, hz, w);
      if (p.mesh) G.fx.releaseProjectile(p.mesh, p.kind === 'arrow' && hitKind === 'world' ? { x: hx, y: p.y, z: hz, ang: p.ang } : null);
      P.splice(i, 1); continue;
    }
    p.x = nx; p.z = nz;
    if (p.mesh) G.fx.placeProjectile(p.mesh, p);
  }
}

function onProjectileHit(p, kind, obj, x, z, w) {
  const y = p.y;
  if (kind === 'ground') { if (p.kind === 'rocket') { explode(x, z, THROWN.rocket, p.owner, p.team, y + 0.3); return; } if (G.fx) G.fx.impact(x, (p.v3 ? Build.floorY(x, z, y + 0.3) : Build.floorY(x, z)) + 0.05, z, G.W.biomeAt(x, z) === 5 ? 'snow' : 'dust', 0, 0); return; }
  if (p.kind === 'rocket') { explode(x - Math.cos(p.ang) * 0.3, z - Math.sin(p.ang) * 0.3, THROWN.rocket, p.owner, p.team, p.v3 ? y : undefined); return; }
  if (kind === 'actor') {
    const a = obj; const crit = p.v3 ? !!p.headshot : Math.random() < (p.kind === 'arrow' ? 0.12 : 0.09);
    hurt(a, p.dmg, { owner: p.owner, pen: p.pen, crit, dir: p.ang, kind: p.kind, bleed: p.kind === 'arrow' ? 0.4 : 0.15 });
    if (G.fx) G.fx.impact(x, p.v3 ? p.y : a.y + 1.1, z, a.kind === 'animal' || a.kind === 'mutant' || a.kind === 'human' ? 'blood' : 'dust', -Math.cos(p.ang), -Math.sin(p.ang));
    if (a !== G.player) Sfx.hit(x, z);
    if (p.owner === G.player && G.onPlayerHit) G.onPlayerHit(a, crit);
    return;
  }
  if (kind === 'world') {
    const c = obj; const ref = c.ref; let mat = 'dust';
    if (ref) {
      if (c.kind === 'piece' || c.kind === 'door' || c.kind === 'deploy') {
        damageStruct(ref, p.dmg * 0.6, 'bullet');
        mat = ref.tier === 'stone' ? 'stone' : ref.tier === 'metal' || ref.tier === 'armored' || ref.metal ? 'metal' : 'wood';
      } else if (c.kind === 'tree') mat = 'wood';
      else if (c.kind === 'node' || c.kind === 'rock') mat = 'stone';
      else if (c.kind === 'container' && ref.def && ref.def.breakable) { if (G.onBreakContainer) G.onBreakContainer(ref, p.owner); mat = 'metal'; }
    } else if (c.kind === 'mon' || c.kind === 'prop') mat = 'stone';
    else if (c.kind === 'fence') mat = 'metal';
    if (G.fx) G.fx.impact(x, y, z, mat, w ? w.nx : 0, w ? w.nz : 0);
  }
}

// ---------------------------------------------------------------- explosions
// A blast hurts most in its core (a frag kills close up), then falls off quickly to the edge of its radius.
// Walls, closed doors, floors between storeys and cover block it: each victim is checked along three lines
// (feet, chest, head) and takes the share that gets through. Frag grenades also throw shrapnel a bit further.
// The person nearest gets a white flash, ringing ears and a hard camera shake.
/** where a blast happens: given height, else whatever floor is under it */
function blastY(x, z, y) { return Number.isFinite(y) ? y : G.W.height(x, z) + 0.6; }
/** 3D distance from a blast to a structure collider (its height band, or its base..top) */
function blastDist(c, x, y, z) {
  const px = Math.max(c.minx, Math.min(x, c.maxx)), pz = Math.max(c.minz, Math.min(z, c.maxz));
  const lo = c.ylo !== undefined && c.ylo > -1e3 ? c.ylo : (c.y0 !== undefined ? c.y0 : -1e9), hi = c.yhi !== undefined ? c.yhi : colliderTop(c);
  const dy = y < lo ? lo - y : y > hi ? y - hi : 0;
  if (dy > 1.2) return Infinity; // a floor between the blast and that piece (another storey)
  return Math.hypot(px - x, pz - z, dy);
}
/** how much of the blast's damage reaches distance d: the core (def.core, else a quarter of the radius) takes it all
 *  and a bit more (def.coreBonus), then it falls off steeply to 8% at the edge */
export function blastK(d, def) {
  const r = def.r || 3, core = def.core ?? r * 0.25;
  if (d > r) return 0;
  if (d <= core) return 1 + (def.coreBonus ?? 0.15);
  const u = Math.min(1, (d - core) / Math.max(0.01, r - core));
  return 0.08 + 0.92 * Math.pow(1 - u, 1.5);
}
/** the share of actor a (0..1) a blast at (x, y, z) can reach: lines to its feet, chest and head, stopped by walls, doors,
 *  crates, cover and floors between storeys */
export function blastExposure(x, y, z, a) {
  const H = actorHeight(a), base = (a.y ?? 0) + (a === G.player ? a.airY || 0 : 0);
  const close = Math.hypot(a.x - x, a.z - z) < 0.35; let open = 0;
  for (const f of [0.18, 0.55, 0.9]) {
    const ty = base + H * f;
    if (Math.abs(ty - y) > 0.7 && (Build.slabBetween(x, z, y, a.x, a.z, ty) || Build.floorBetween(x, z, y, a.x, a.z, ty))) continue;
    if (!close && ray3(x, z, a.x, a.z, y, ty)) continue;
    open++;
  }
  return open / 3;
}
/** shrapnel: each fragment that flies at a body hits it (the further, the fewer); returns the hits */
function shrapnel(a, d, def, x, y, z, owner) {
  if (!def.frags || d > (def.fragR || 8) || d <= (def.core ?? (def.r || 3) * 0.25) || a.dead) return 0; // inside the core the blast already did it
  const H = actorHeight(a), area = (a.r || 0.35) * 2 * H, p = Math.min(0.3, area / (2 * Math.PI * Math.max(1, d * d)));
  let hits = 0; for (let i = 0; i < def.frags; i++) if (Math.random() < p) hits++;
  if (!hits) return 0;
  if (ray3(x, z, a.x, a.z, y, (a.y ?? 0) + H * 0.6)) return 0; // behind cover
  hurt(a, hits * (def.fragDmg || 6), { owner, pen: 0.25, kind: 'shrapnel', crit: Math.random() < 0.12 * hits, dir: Math.atan2(a.z - z, a.x - x), bleed: 0.5 });
  return hits;
}
/** what the local player feels: flash, shake, ringing ears (no damage) */
function blastFeel(x, y, z, r) {
  const P = G.player; if (!P || P.dead) return;
  const d = Math.hypot(x - P.x, z - P.z, (P.y + 1.5) - y);
  if (G.rend) G.rend.shake = Math.max(G.rend.shake, d < r * 5 ? clamp(2.2 * (1 - d / (r * 5)), 0.3, 2.2) : clamp(0.6 - d / 90, 0, 0.6));
  const k = clamp(1 - d / (r * 2.4), 0, 1); if (k <= 0.05) return;
  const seen = blastExposure(x, y, z, P) > 0 ? 1 : 0.45;
  if (Sfx.deafen) Sfx.deafen(k * seen);
  if (G.ui && G.ui.blastFlash) G.ui.blastFlash(k * seen);
}
/** the look and sound of a blast (everyone sees every blast) */
function blastShow(x, y, z, def, kind) {
  const r = def.r || 3;
  const floor = Build.floorY(x, z, y - 0.3) , T = G.W.height(x, z), water = floor < -0.05 && T < -0.1 && y < 0.4;
  if (G.fx) G.fx.explosion(x, y, z, r, { floor: water ? 0 : floor, frags: !!def.frags, water, dust: floor > T + 0.05 ? 'stone' : G.W.biomeAt(x, z) === 5 ? 'snow' : G.W.biomeAt(x, z) === 1 || G.W.biomeAt(x, z) === 4 ? 'sand' : 'dirt' });
  Sfx.explode(x, z, r / 3, kind || (def.frags ? 'frag' : ''));
  // ghosts of a throw (another player's grenade) go with their blast
  for (let i = G.throwns.length - 1; i >= 0; i--) { const t = G.throwns[i]; if (t.ghost && Math.hypot(t.x - x, t.z - z) < 3 && Math.abs(t.y - y) < 3) { if (t.mesh && G.fx) G.fx.releaseThrown(t.mesh); G.throwns.splice(i, 1); } }
}
function explodeLocal(x, z, def, owner, yIn) {
  const y = blastY(x, z, yIn); const r = def.r || 3;
  blastShow(x, y, z, def);
  const P = G.player;
  if (P && !P.dead) {
    const d = Math.hypot(x - P.x, z - P.z, (P.y + 0.9) - y);
    if (d <= r) { const e = blastExposure(x, y, z, P); if (e > 0) hurt(P, def.dmg * blastK(d, def) * e, { owner, pen: 0.5, kind: 'explosion', dir: Math.atan2(P.z - z, P.x - x) }); }
    shrapnel(P, d, def, x, y, z, owner);
  }
  blastFeel(x, y, z, r);
  // vehicles: the host applies every explosion to them itself (they're shared)
}
/** co-op: route explosions — guests show theirs and ask the host to apply it to the world */
G.explodeNet = (m, fromGuestId) => {
  const T = THROWN[m.k] || {}; // the kind of blast (a frag's core and shrapnel)
  const def = { r: clamp(+m.r || 3, 0.5, 12), dmg: clamp(+m.dmg || 0, 0, 400), struct: clamp(+m.struct || 0, 0, 3000), core: T.core, coreBonus: T.coreBonus, frags: T.frags, fragDmg: T.fragDmg, fragR: T.fragR }, x = +m.x, z = +m.z, y = m.y === undefined ? undefined : +m.y;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  if (G.net && G.net.role === 'host') { const pl = fromGuestId !== null && fromGuestId !== undefined ? G.net.players.get(fromGuestId) : null; G._boomExcept = fromGuestId; explode(x, z, def, pl ? pl.actor : null, pl ? pl.actor.team : 'player', y); G._boomExcept = null; }
  else explodeLocal(x, z, def, null, y);
};
const kindOf = def => { for (const k in THROWN) if (THROWN[k] === def) return k; return def.kind || undefined; };
/** an explosion at (x, z), at height yIn (world) — or on whatever floor is under it */
export function explode(x, z, def, owner, team, yIn) {
  const yB = blastY(x, z, yIn), y2 = Math.round(yB * 100) / 100;
  const m = { t: 'boom', x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, y: y2, r: def.r || 3, dmg: def.dmg || 0, struct: def.struct || 50, k: kindOf(def) };
  if (G.net && G.net.role === 'guest') { explodeLocal(x, z, def, owner, yB); G.net.send(m); return; }
  if (G.net && G.net.role === 'host') { for (const [gid, c] of G.net.conns) if (gid !== G._boomExcept && c.open) G.net.sendConn(c, m); }
  const y = yB; const r = def.r || 3;
  blastShow(x, y, z, def);
  if (G.onNoise) G.onNoise(x, z, 70, owner);
  if (G.vehicles) G.vehicles.blast(x, z, r, def.struct || def.dmg || 50);
  // actors: the core kills, the rest falls off; walls, doors, floors and cover block it
  for (const a of G.actors) {
    if (a.dead || a.def.invuln) continue; const d = Math.hypot(x - a.x, z - a.z, (a.y + 0.9) - y);
    if (d <= r) {
      const e = blastExposure(x, y, z, a);
      if (e > 0) { hurt(a, def.dmg * blastK(d, def) * e, { owner, pen: 0.5, kind: 'explosion', dir: Math.atan2(a.z - z, a.x - x) }); if (a !== G.player && a.st) a.st.flinch = 1; }
    }
    shrapnel(a, d, def, x, y, z, owner);
  }
  blastFeel(x, y, z, r);
  // structures (each one once)
  const seen = new Set();
  G.phys.query(x - r, z - r, x + r, z + r, c => {
    const o = c.ref; if (!o || seen.has(o)) return;
    if (!(c.kind === 'piece' || c.kind === 'door' || c.kind === 'deploy')) {
      if (c.kind === 'container' && o.def && o.def.breakable && G.onBreakContainer) { seen.add(o); G.onBreakContainer(o, owner); }
      return;
    }
    seen.add(o);
    const d = blastDist(c, x, y, z); if (d > r) return; // walls on another storey are out of reach
    damageStruct(o, (def.struct || 50) * (1 - d / r * 0.6), 'explosive');
  });
  // trees: knock a bit of wood off; nodes: some ore
  if (G.onExplosionWorld) G.onExplosionWorld(x, z, r);
}

// ---------------------------------------------------------------- thrown (physics: throwing.js)
/** throw item `id` from actor `a`: toward (tx, tz) with a lob that lands there (NPCs, survivors), or with
 *  opts.v = { x, y, z, vx, vy, vz } (the player's throw along the view). Returns the thrown thing. */
export function throwItem(a, id, tx, tz, opts = {}) {
  const T = THROWN[id]; if (!T) return null;
  let s = opts.v;
  if (!s) {
    const sx = a.x + Math.cos(a.ang) * 0.4, sz = a.z + Math.sin(a.ang) * 0.4, sy = (a.y ?? 0) + 1.6;
    const d = clamp(dist(sx, sz, tx, tz), 1.5, 22), ang = Math.atan2(tz - sz, tx - sx), time = 0.45 + d / 22 * 0.55;
    const gy = Build.floorY(tx, tz, sy + 1.2), k = 0.9; // lands a touch short and rolls on
    s = { x: sx, y: sy, z: sz, vx: Math.cos(ang) * d / time * k, vz: Math.sin(ang) * d / time * k, vy: (gy - sy + 0.5 * GRAV * time * time) / time };
  }
  const t = { id, def: T, x: s.x, z: s.z, y: s.y, vx: s.vx, vy: s.vy, vz: s.vz, fuse: T.fuse || 3, owner: a, team: a.team, stuck: null, rest: false, roll: false, spin: rand(6, 11), bounces: 0, acc: 0 };
  t.dud = T.dud && Math.random() < T.dud;
  if (G.fx) t.mesh = G.fx.thrownMesh(id);
  G.throwns.push(t); Sfx.swing();
  netThrow(t); // the others see it fly (and their NPCs dodge it)
  return t;
}
/** sounds of a thrown thing hitting things */
function onThrownEv(kind, t, k, hard) {
  if (kind === 'splash') { Sfx.splash(t.x, t.z); if (G.fx) G.fx.impact(t.x, 0.05, t.z, 'water'); return; }
  if (kind === 'rest' || !Sfx.nadeHit) return;
  if (kind === 'stick') { Sfx.thud(t.x, t.z); return; }
  if (k > 0.6) Sfx.nadeHit(t.x, t.z, Math.min(1, k / 9), hard, t.id === 'beancan');
}
export function updateThrowns(dt) {
  for (let i = G.throwns.length - 1; i >= 0; i--) {
    const t = G.throwns[i];
    // fixed physics steps (the same steps the aiming arc predicts with)
    t.acc = (t.acc || 0) + dt; let n = 0;
    while (t.acc >= STEP && n < 6) { t.acc -= STEP; n++; stepThrown(t, STEP, onThrownEv); }
    if (n >= 6) t.acc = 0;
    t.fuse -= dt;
    if (t.def.beep && G.t % 1 < dt) Sfx.beep(t.x, t.z);
    if (t.def.smoke && G.fx) G.fx.smoke(t.x, t.y, t.z, '#a070e0', dt);
    if (t.fizz > 0 && G.fx) { t.fizz -= dt; if (Math.random() < dt * 25) G.fx.emit({ x: t.x, y: t.y + 0.05, z: t.z, vx: (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 2, vz: (Math.random() - 0.5) * 2, life: 0.35, size: 0.06, r: 1, g: 0.75, b: 0.3, add: true, grav: 6 }); if (Math.random() < dt * 6) G.fx.emit({ x: t.x, y: t.y + 0.1, z: t.z, vy: 0.6, life: 1.4, size: 0.15, size1: 0.6, r: 0.6, g: 0.6, b: 0.6, a: 0.45, a1: 0 }); }
    if (t.mesh) G.fx.placeThrown(t.mesh, t, dt);
    if (t.fuse <= 0) {
      if (t.def.signal) { if (t.fuse < -0.01 && !t.called && !t.ghost) { t.called = true; if (G.onSupplySignal) G.onSupplySignal(t.x, t.z); } if (t.fuse > -14) continue; }
      else if (t.dud) { t.dud = false; t.fizz = 1.6; if (Sfx.fizz) Sfx.fizz(t.x, t.z); if (G.fx) G.fx.fizzle(t.x, t.y, t.z); t.fuse = t.ghost ? 6 : rand(1.5, 4); if (!t.ghost && Math.random() < 0.4) t.fuse = 999; continue; } // a dud fizzles; now and then it goes off after all
      else if (!t.ghost) explode(t.x, t.z, t.def, t.owner, t.team, t.y + 0.15);
      if (t.mesh) G.fx.releaseThrown(t.mesh);
      G.throwns.splice(i, 1);
    } else if (t.fuse > 900 && t.rest && (t.deadT = (t.deadT || 0) + dt) > 60) { if (t.mesh) G.fx.releaseThrown(t.mesh); G.throwns.splice(i, 1); } // a dead dud lies there a minute
  }
}

// ---------------------------------------------------------------- melee
/**
 * Resolve a melee strike from actor `a` with item `wid` (MELEE key).
 * Hits the best target in a frontal arc. Returns what was hit.
 */
export function meleeStrike(a, wid) {
  const Mw = MELEE[wid] || MELEE.fists; const reach = Mw.reach + a.r;
  const fx = Math.cos(a.ang), fz = Math.sin(a.ang);
  // actors first
  let best = null, bs = 1e9;
  for (const o of G.actors) {
    if (o === a || o.dead || o.def.invuln) continue;
    if (a.team !== 'player' && o.team === a.team) continue;
    const dx = o.x - a.x, dz = o.z - a.z, d = Math.hypot(dx, dz); if (d > reach + o.r) continue;
    const ad = Math.abs(angDiff(a.ang, Math.atan2(dz, dx))); if (ad > 1.0 && d > o.r + 0.5) continue;
    if (!G.phys.los(a.x, a.z, o.x, o.z, OPAQ)) continue;
    const s = d + ad; if (s < bs) { bs = s; best = o; }
  }
  if (best) {
    const killed = hurt(best, Mw.dmg * (a.dmgMul || 1), { owner: a, pen: 0.1, dir: a.ang, kind: 'melee', bleed: Mw.burn ? 0 : 0.25 });
    if (G.fx) G.fx.impact(best.x, best.y + 1.1, best.z, 'blood', -fx, -fz);
    Sfx.hit(best.x, best.z); if (a === G.player && G.onPlayerHit) G.onPlayerHit(best, false);
    return { type: 'actor', target: best, killed };
  }
  // world: trees / nodes / containers / structures in front
  const hx = a.x + fx * (Mw.reach * 0.75 + a.r), hz = a.z + fz * (Mw.reach * 0.75 + a.r);
  if (G.onMeleeWorld) { const r = G.onMeleeWorld(a, wid, hx, hz, Mw); if (r) return r; }
  // structures
  let sHit = null, sd = 9;
  G.phys.query(hx - 0.7, hz - 0.7, hx + 0.7, hz + 0.7, c => {
    if (c.off || !c.ref || !(c.kind === 'piece' || c.kind === 'door' || c.kind === 'deploy')) return;
    const px = Math.max(c.minx, Math.min(hx, c.maxx)), pz = Math.max(c.minz, Math.min(hz, c.maxz)); const d = Math.hypot(px - hx, pz - hz);
    if (d < 0.75 && d < sd) { sd = d; sHit = c.ref; }
  });
  if (sHit) {
    const amt = a.def.melee && a.def.melee.struct ? a.def.melee.struct : (Mw.struct || 2);
    damageStruct(sHit, amt, a.team === 'raider' ? 'raider' : 'melee');
    const t = sHit.tier || (sHit.metal ? 'metal' : 'wood');
    if (G.fx) G.fx.impact(hx, a.y + 1.1, hz, t === 'stone' ? 'stone' : t === 'metal' || t === 'armored' ? 'metal' : 'wood', -fx, -fz);
    if (t === 'metal' || t === 'armored') Sfx.clang(hx, hz); else Sfx.thud(hx, hz);
    return { type: 'struct', target: sHit };
  }
  return null;
}

// ---------------------------------------------------------------- turrets
export function updateTurrets(dt) {
  for (const d of Build.deploys) {
    const T = DEPLOY[d.type].turret && (d.pwTurret || DEPLOY[d.type].turret); if (!T || d.owner !== 'player') continue; // pwTurret: wired to power (power.js)
    d.cd = (d.cd || 0) - dt;
    // pick target
    if (!d.target || d.target.dead || (d.tT = (d.tT || 0) - dt) <= 0) {
      d.tT = 0.4; d.target = null; let bd = T.range * T.range;
      for (const a of G.actors) {
        if (a.dead || a.team === 'player' || a.team === 'haven' || a.def.invuln || a.remote !== undefined) continue;
        if (a.kind === 'animal' && a.def.flee) continue;
        if (a.bot && G.bots && !G.bots.hostileToPlayer(a.bot)) continue;
        const dd = (a.x - d.x) ** 2 + (a.z - d.z) ** 2; if (dd > bd) continue;
        if (!G.phys.los(d.x, d.z, a.x, a.z, c => c.opaque && !c.off && c.ref !== d)) continue;
        bd = dd; d.target = a;
      }
    }
    const head = d.mesh && d.mesh.userData && d.mesh.userData.head;
    if (!d.target) { if (head) head.rotation.y += dt * 0.6; continue; }
    const ang = Math.atan2(d.target.z - d.z, d.target.x - d.x);
    if (head) { const cur = -head.rotation.y + (-d.mesh.rotation.y); const diff = angDiff(cur, ang); head.rotation.y -= clamp(diff, -dt * 6, dt * 6); }
    if (d.cd > 0) continue;
    // ammo from base storage
    if (Build.storageCount(T.ammo) <= 0) { d.noAmmo = true; continue; }
    d.noAmmo = false; Build.storageTake(T.ammo, 1); d.cd = 1 / T.rof;
    const fake = { x: d.x, z: d.z, y: d.y, ang, team: 'player', r: 0.4, st: {}, rig: { root: d.mesh, muzzleWorld: v => v.set(d.x + Math.cos(ang) * 0.7, d.y + (d.type === 'auto_turret' ? 1.0 : 0.55), d.z + Math.sin(ang) * 0.7) } };
    for (let i = 0; i < (T.pellets || 1); i++) {
      spawnProjectile({ x: d.x + Math.cos(ang) * 0.7, z: d.z + Math.sin(ang) * 0.7, y: d.y + 0.9, ang: ang + (Math.random() - 0.5) * T.spread * 2, speed: 120, dmg: T.dmg, pen: 0.2, range: T.range + 2, owner: fake, team: 'player', kind: 'bullet' });
    }
    if (G.fx) G.fx.muzzle(d.x + Math.cos(ang) * 0.7, d.y + 0.9, d.z + Math.sin(ang) * 0.7, ang, 0.8);
    Sfx.shot(d.type === 'auto_turret' ? 'turret' : 'shotgun', d.x, d.z);
  }
}
void THREE; void M; void TIER;

/** 3D ray vs world colliders: skips colliders the ray passes over */
export function ray3(x0, z0, x1, z1, y0, y1) {
  let sx = x0, sz = z0, ignore = null;
  for (let k = 0; k < 5; k++) {
    const h = G.phys.raycast(sx, sz, x1, z1, c => !c.off && (c.opaque || (c.solid && c.kind !== 'fence' && c.kind !== 'door')) && c !== ignore && (!ignore || !ignore.has || !ignore.has(c)));
    if (!h) return null;
    // global t along the original segment
    const L = Math.hypot(x1 - x0, z1 - z0) || 1; const gt = Math.hypot(h.x - x0, h.z - z0) / L;
    const yy = y0 + (y1 - y0) * gt;
    if (yy <= colliderTop(h.c) + 0.02 && (h.c.ylo === undefined || yy >= h.c.ylo - 0.02)) { h.t = gt; return h; }
    ignore = ignore && ignore.add ? ignore : new Set(ignore ? [ignore] : []); ignore.add(h.c);
    sx = h.x + (x1 - x0) / L * 0.02; sz = h.z + (z1 - z0) / L * 0.02;
  }
  return null;
}
export function colliderTop(c) {
  if (c.top === undefined) { const y0 = c.y0 !== undefined ? c.y0 : G.W.height((c.minx + c.maxx) / 2, (c.minz + c.maxz) / 2); c.top = y0 + (c.h || 3); }
  return c.top;
}
export function actorHeight(a) {
  if (a === G.player) return (a.eye || 1.62) + 0.16;
  if (a.heli) return 3.2;
  const h = a.rig && a.rig.height ? a.rig.height : 1.8; const s = a.rig && a.rig.root ? a.rig.root.scale.y : 1;
  return h * s;
}

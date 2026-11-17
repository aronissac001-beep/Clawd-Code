// ============================================================================
// ZONEFALL 3 — combat: firing weapons, projectiles (bullets, arrows, rockets),
// thrown explosives, melee strikes (also gathering), damage to actors and
// structures, explosions, turrets.
// ============================================================================
import { THREE, M } from './gfx/materials.js';
import { G } from './state.js';
import { WEAPONS, AMMO_MOD, MELEE, THROWN, TIER, ITEMS, DEPLOY } from './data.js';
import { Build } from './build.js';
import { damageDoor } from './doors.js';
import { Sfx } from './audio.js';
import { muzzlePos } from './actors.js';
import { rand, clamp, angDiff, dist } from './util.js';

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
/**
 * Fire a weapon from actor `a` at angle `ang`. Handles pellets, spread,
 * tracers, sound + noise alert. Returns true if a shot happened.
 */
export function fireWeapon(a, wid, ang, opts = {}) {
  const W = WEAPONS[wid]; if (!W) return false;
  const ammoId = opts.ammoId || W.ammo; const mod = AMMO_MOD[ammoId] || {};
  const pellets = W.pellets || 1; const spreadMul = opts.spreadMul ?? 1;
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
        speed: W.speed * rand(0.97, 1.03), dmg: W.dmg * (mod.dmg || 1) * (opts.dmgMul || 1), pen: (W.pen || 0) + (mod.pen || 0),
        range: W.range * (W.pellets ? rand(0.85, 1.05) : 1.15), owner: a, team: a.team, kind, wid,
        off: vm ? { x: vm.x - ex, y: vm.y - ey, z: vm.z - ez } : null,
      });
    }
    if (net) G.net.shot(wid, ex, ey, ez, net);
    // the viewmodel draws its own flash; the world still gets the light pop
    if (G.fx && !W.arrow && vm) { if (G.vm && G.vm.flash && !G.vm.hidden) G.fx.light(vm.x, vm.y, vm.z, '#ffc070', W.rocket ? 2.2 : 0.8, 9, 0.06); else G.fx.muzzle(vm.x, vm.y, vm.z, ang, W.rocket ? 0.9 : 0.32); }
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
        x: sx, z: sz, y: mp.y, ang: ang + s, pitch: pp, v3: !!T, speed: W.speed * rand(0.95, 1.05), dmg: W.dmg * (mod.dmg || 1) * (opts.dmgMul || 1), pen: (W.pen || 0) + (mod.pen || 0),
        range: W.range * (W.pellets ? rand(0.8, 1.05) : 1), owner: a, team: a.team, kind, wid,
      });
    }
    if (npcNet && G.netWorld) G.netWorld.npcShot(a, wid, sx, mp.y, sz, npcNet);
    if (G.fx && !W.arrow) G.fx.muzzle(mp.x, mp.y, mp.z, ang, W.rocket ? 2 : 1);
  }
  Sfx.shot(W.sfx, a === G.player ? undefined : a.x, a === G.player ? undefined : a.z);
  if (G.onNoise && W.noise) G.onNoise(a.x, a.z, W.noise, a);
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
    // the ground itself (hills)
    if (p.v3 && !w) { const gy = Build.floorY(nx, nz); if (y1 < gy) { hitKind = 'ground'; hitT = 1; hx = nx; hz = nz; } }
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
  if (kind === 'ground') { if (p.kind === 'rocket') { explode(x, z, THROWN.rocket, p.owner, p.team); return; } if (G.fx) G.fx.impact(x, Build.floorY(x, z) + 0.05, z, G.W.biomeAt(x, z) === 5 ? 'snow' : 'dust', 0, 0); return; }
  if (p.kind === 'rocket') { explode(x - Math.cos(p.ang) * 0.3, z - Math.sin(p.ang) * 0.3, THROWN.rocket, p.owner, p.team); return; }
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
/** an explosion that happened in someone else's game: show it, and hurt only me */
function explodeLocal(x, z, def, owner) {
  const y = G.W.height(x, z) + 0.6; const r = def.r || 3;
  if (G.fx) G.fx.explosion(x, y, z, r); Sfx.explode(x, z, r / 3);
  const P = G.player;
  if (P && !P.dead) {
    const d = dist(x, z, P.x, P.z); if (G.rend) G.rend.shake = Math.max(G.rend.shake, clamp(1.6 - d / 22, 0, 1.6));
    if (d <= r && G.phys.los(x, z, P.x, P.z, c => c.opaque && !c.off && c.kind !== 'door')) hurt(P, def.dmg * (1 - d / r * 0.7), { owner, pen: 0.5, kind: 'explosion', dir: Math.atan2(P.z - z, P.x - x) });
  }
  if (G.vehicles) G.vehicles.blast(x, z, r, def.struct || def.dmg || 50);
}
/** co-op: route explosions — guests show theirs and ask the host to apply it to the world */
G.explodeNet = (m, fromGuestId) => {
  const def = { r: clamp(+m.r || 3, 0.5, 12), dmg: clamp(+m.dmg || 0, 0, 400), struct: clamp(+m.struct || 0, 0, 3000) }, x = +m.x, z = +m.z;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  if (G.net && G.net.role === 'host') { const pl = fromGuestId !== null && fromGuestId !== undefined ? G.net.players.get(fromGuestId) : null; G._boomExcept = fromGuestId; explode(x, z, def, pl ? pl.actor : null, pl ? pl.actor.team : 'player'); G._boomExcept = null; }
  else explodeLocal(x, z, def, null);
};
export function explode(x, z, def, owner, team) {
  if (G.net && G.net.role === 'guest') { explodeLocal(x, z, def, owner); G.net.send({ t: 'boom', x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, r: def.r || 3, dmg: def.dmg || 0, struct: def.struct || 50 }); return; }
  if (G.net && G.net.role === 'host') { const m = { t: 'boom', x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, r: def.r || 3, dmg: def.dmg || 0, struct: def.struct || 50 }; for (const [gid, c] of G.net.conns) if (gid !== G._boomExcept && c.open) G.net.sendConn(c, m); }
  const y = G.W.height(x, z) + 0.6; const r = def.r || 3;
  if (G.fx) G.fx.explosion(x, y, z, r);
  Sfx.explode(x, z, r / 3);
  if (G.onNoise) G.onNoise(x, z, 70, owner);
  if (G.vehicles) G.vehicles.blast(x, z, r, def.struct || def.dmg || 50);
  if (G.rend && G.player) { const d = dist(x, z, G.player.x, G.player.z); G.rend.shake = Math.max(G.rend.shake, clamp(1.6 - d / 22, 0, 1.6)); }
  // actors
  for (const a of G.actors) {
    if (a.dead || a.def.invuln) continue; const d = dist(x, z, a.x, a.z); if (d > r) continue;
    if (!G.phys.los(x, z, a.x, a.z, c => c.opaque && !c.off && c.kind !== 'door')) continue;
    const k = 1 - d / r * 0.7; hurt(a, def.dmg * k, { owner, pen: 0.5, kind: 'explosion', dir: Math.atan2(a.z - z, a.x - x) });
    if (a !== G.player && a.st) a.st.flinch = 1;
  }
  // structures (each one once)
  const seen = new Set();
  G.phys.query(x - r, z - r, x + r, z + r, c => {
    const o = c.ref; if (!o || seen.has(o)) return;
    if (!(c.kind === 'piece' || c.kind === 'door' || c.kind === 'deploy')) {
      if (c.kind === 'container' && o.def && o.def.breakable && G.onBreakContainer) { seen.add(o); G.onBreakContainer(o, owner); }
      return;
    }
    seen.add(o);
    const px = Math.max(c.minx, Math.min(x, c.maxx)), pz = Math.max(c.minz, Math.min(z, c.maxz)); const d = Math.hypot(px - x, pz - z); if (d > r) return;
    damageStruct(o, (def.struct || 50) * (1 - d / r * 0.6), 'explosive');
  });
  // trees: knock a bit of wood off; nodes: some ore
  if (G.onExplosionWorld) G.onExplosionWorld(x, z, r);
}

// ---------------------------------------------------------------- thrown
/** throw item `id` from actor toward (tx, tz) */
export function throwItem(a, id, tx, tz) {
  const T = THROWN[id]; if (!T) return null;
  const sx = a.x + Math.cos(a.ang) * 0.4, sz = a.z + Math.sin(a.ang) * 0.4; const sy = a.y + 1.6;
  const d = clamp(dist(sx, sz, tx, tz), 1.5, 22); const ang = Math.atan2(tz - sz, tx - sx);
  const time = 0.45 + d / 22 * 0.55;
  const t = { id, def: T, x: sx, z: sz, y: sy, vx: Math.cos(ang) * d / time, vz: Math.sin(ang) * d / time, vy: 0, fuse: T.fuse || 3, owner: a, team: a.team, stuck: null, rest: false, spin: rand(4, 9) };
  // vertical speed to land at ground after `time`
  const gy = G.W.height(tx, tz); t.vy = (gy - sy + 0.5 * 18 * time * time) / time;
  t.dud = T.dud && Math.random() < T.dud;
  if (G.fx) t.mesh = G.fx.thrownMesh(id);
  G.throwns.push(t); Sfx.swing();
  return t;
}

export function updateThrowns(dt) {
  for (let i = G.throwns.length - 1; i >= 0; i--) {
    const t = G.throwns[i];
    if (!t.rest && !t.stuck) {
      t.vy -= 18 * dt; const nx = t.x + t.vx * dt, nz = t.z + t.vz * dt;
      const hit = t.y < 3 ? G.phys.raycast(t.x, t.z, nx, nz, c => c.solid && !c.off) : null;
      if (hit) {
        if (t.def.sticky && hit.c.ref && (hit.c.kind === 'piece' || hit.c.kind === 'door' || hit.c.kind === 'deploy')) { t.stuck = hit.c.ref; t.x = hit.x - Math.sign(t.vx) * 0.05; t.z = hit.z - Math.sign(t.vz) * 0.05; t.vx = t.vz = t.vy = 0; }
        else { // bounce
          if (hit.nx) t.vx = -t.vx * 0.4; if (hit.nz) t.vz = -t.vz * 0.4; t.x = hit.x + hit.nx * 0.1; t.z = hit.z + hit.nz * 0.1; Sfx.thud(t.x, t.z);
        }
      } else { t.x = nx; t.z = nz; }
      t.y += t.vy * dt; const gy = Build.floorY(t.x, t.z);
      if (t.y < gy + 0.08) { t.y = gy + 0.08; if (Math.abs(t.vy) > 2.5) { t.vy = -t.vy * 0.3; t.vx *= 0.6; t.vz *= 0.6; } else { t.vy = 0; t.vx *= 0.82; t.vz *= 0.82; if (Math.hypot(t.vx, t.vz) < 0.3) t.rest = true; } }
    }
    t.fuse -= dt;
    if (t.def.beep && G.t % 1 < dt) Sfx.beep(t.x, t.z);
    if (t.def.smoke && G.fx) G.fx.smoke(t.x, t.y, t.z, '#a070e0', dt);
    if (t.mesh) G.fx.placeThrown(t.mesh, t, dt);
    if (t.fuse <= 0) {
      if (t.def.signal) { if (t.fuse < -0.01 && !t.called) { t.called = true; if (G.onSupplySignal) G.onSupplySignal(t.x, t.z); } if (t.fuse > -14) continue; }
      else if (t.dud) { t.dud = false; t.fuse = rand(1.5, 4); if (Math.random() < 0.4) { t.fuse = 999; } continue; }
      else explode(t.x, t.z, t.def, t.owner, t.team);
      if (t.mesh) G.fx.releaseThrown(t.mesh);
      G.throwns.splice(i, 1);
    }
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
    const T = DEPLOY[d.type].turret; if (!T || d.owner !== 'player') continue;
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
function ray3(x0, z0, x1, z1, y0, y1) {
  let sx = x0, sz = z0, ignore = null;
  for (let k = 0; k < 5; k++) {
    const h = G.phys.raycast(sx, sz, x1, z1, c => !c.off && (c.opaque || (c.solid && c.kind !== 'fence' && c.kind !== 'door')) && c !== ignore && (!ignore || !ignore.has || !ignore.has(c)));
    if (!h) return null;
    // global t along the original segment
    const L = Math.hypot(x1 - x0, z1 - z0) || 1; const gt = Math.hypot(h.x - x0, h.z - z0) / L;
    const yy = y0 + (y1 - y0) * gt;
    if (yy <= colliderTop(h.c) + 0.02) { h.t = gt; return h; }
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

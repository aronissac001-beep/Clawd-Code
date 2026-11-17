// ============================================================================
// ZONEFALL 3 — actors (player, humans, animals, mutants): creation, rigs,
// movement with collision + terrain height, animation sync, despawn.
// ============================================================================
import { THREE, M } from './gfx/materials.js';
import { G } from './state.js';
import { ENEMIES, ITEMS } from './data.js';
import { Build } from './build.js';
import { canOpen, openDoor } from './doors.js';
import { SOLID } from './physics.js';
import { rand, pick, clamp } from './util.js';

let Models = null;
export function setActorModels(m) { Models = m; }

let AID = 1;
const tmp = new THREE.Vector3();

export function makeRig(kind, look) {
  try {
    if (Models) {
      if (kind === 'animal') return Models.makeAnimal(look);
      return Models.makeHuman(typeof look === 'string' ? Object.assign({}, Models.LOOKS[look] || Models.LOOKS.survivor) : look);
    }
  } catch (e) { console.warn('rig failed', kind, look, e); }
  return fallbackRig(kind, look);
}
function fallbackRig(kind, look) {
  const root = new THREE.Group(); const body = new THREE.Group(); root.add(body);
  const col = kind === 'animal' ? '#6a5a48' : '#8a7a5a';
  if (kind === 'animal') { M.add(body, M.box(1.0, 0.5, 0.4), M.mat(col), 0, 0.6, 0); M.add(body, M.box(0.35, 0.3, 0.3), M.mat(col), 0.6, 0.75, 0); }
  else { M.add(body, M.box(0.3, 0.9, 0.5), M.mat(col), 0, 1.0, 0); M.add(body, M.box(0.3, 0.3, 0.3), M.mat('#c69472'), 0, 1.65, 0); M.add(body, M.box(0.25, 0.8, 0.45), M.mat('#3a3a40'), 0, 0.4, 0); }
  const hand = new THREE.Group(); hand.position.set(0.35, 1.15, 0.22); body.add(hand);
  let held = null;
  return {
    root, height: kind === 'animal' ? 1 : 1.8,
    setHeld(id) { if (held) hand.remove(held); held = null; if (id) { held = new THREE.Group(); M.add(held, M.box(0.6, 0.08, 0.08), M.mat('#333'), 0.3, 0, 0); hand.add(held); } },
    setLook() { }, update(dt, st) { body.rotation.z = st.dead ? -st.dead * 1.5 : 0; body.position.y = st.speed ? Math.abs(Math.sin(G.t * 10)) * 0.05 : 0; },
    muzzleWorld(v) { root.updateMatrixWorld(); return v.set(0.9, 1.15, 0.22).applyMatrix4(root.matrixWorld); },
    handWorld(v) { root.updateMatrixWorld(); return v.set(0.35, 1.15, 0.22).applyMatrix4(root.matrixWorld); },
    flash() { }, dispose() { },
  };
}

/** create an actor. type = ENEMIES key or 'player' */
export function spawnActor(type, x, z, opts = {}) {
  const def = type === 'player' ? { name: 'You', kind: 'human', hp: 100, speed: 4.6, r: 0.35 } : ENEMIES[type];
  const a = {
    id: AID++, type, def, kind: def.kind, x, z, y: G.W.height(x, z), ang: opts.ang ?? rand(0, 6.28), aimAng: 0, r: def.r || 0.35,
    hp: def.hp, maxhp: def.hp, team: opts.team || teamFor(type, def), vx: 0, vz: 0, speedNow: 0,
    st: { speed: 0, aim: false, swing: -1, recoil: 0, reload: -1, use: -1, throw: -1, flinch: 0, dead: 0, attack: -1, alert: false },
    ai: { state: 'idle', t: rand(0, 2), home: { x, z }, patrol: opts.patrol || null, pi: 0, target: null, lastSeen: null, strafe: Math.random() < 0.5 ? 1 : -1, think: 0 },
    cd: 0, dead: false, deadT: 0, bleed: 0, flash: 0, slowT: 0, mon: opts.mon || null, spawn: opts.spawn || null, armor: 0, helm: 0,
  };
  if (def.armor) a.armor = rand(def.armor[0], def.armor[1]);
  if (def.helm) a.helm = Math.random() < def.helm ? 1 : 0;
  if (def.guns) { const gid = pick(def.guns); a.gun = { id: gid, ammo: 999 }; a.held = gid; }
  else if (def.heldMelee) a.held = def.heldMelee;
  else if (def.rocket) { a.gun = { id: 'rocket_launcher', ammo: 999 }; a.held = 'rocket_launcher'; }
  if (opts.boss || def.boss) { a.boss = true; }
  // rig
  const rigKind = def.kind === 'animal' ? 'animal' : 'human';
  a.rig = makeRig(rigKind, def.kind === 'animal' ? def.model : (opts.look || def.look || 'survivor'));
  const look = Models && Models.LOOKS && Models.LOOKS[def.look];
  if (look && look.scale) a.rig.root.scale.setScalar(look.scale);
  if (a.held) try { a.rig.setHeld(a.held); } catch (e) { }
  a.rig.root.position.set(x, a.y, z);
  G.scene.add(a.rig.root);
  G.actors.push(a);
  return a;
}
function teamFor(type, def) {
  if (type === 'player') return 'player';
  if (def.raider) return 'raider';
  if (def.guard || def.trader) return 'haven';
  if (def.kind === 'animal') return 'wild';
  return 'hostile';
}

export function removeActor(a) {
  if (a.removed) return; a.removed = true;
  G.scene.remove(a.rig.root); try { a.rig.dispose && a.rig.dispose(); } catch (e) { }
  const i = G.actors.indexOf(a); if (i >= 0) G.actors.splice(i, 1);
}

/** move with collision, doors, terrain. Returns collider bumped */
export function moveActor(a, dx, dz, dt) {
  if (!dx && !dz) { a.speedNow = 0; return null; }
  const p = { x: a.x, z: a.z };
  const bumped = G.phys.move(p, dx, dz, a.r, SOLID);
  // separation from other actors (soft)
  for (const o of G.actors) {
    if (o === a || o.dead || o.removed) continue; const ddx = p.x - o.x, ddz = p.z - o.z, rr = a.r + o.r; const d2 = ddx * ddx + ddz * ddz;
    if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2), k = (rr - d) / d * 0.5; p.x += ddx * k; p.z += ddz * k; }
  }
  const moved = Math.hypot(p.x - a.x, p.z - a.z); a.speedNow = dt > 0 ? moved / dt : 0;
  a.x = p.x; a.z = p.z;
  if (bumped && bumped.kind === 'door' && bumped.ref && canOpen(bumped.ref, a)) {
    // push into a door you may open -> it swings open (it still blocks until it has swung far enough)
    a.doorPush = (a.doorPush || 0) + dt;
    if (a.doorPush > (a === G.player ? 0.08 : 0.3)) { openDoor(bumped.ref, a.x, a.z); a.doorPush = 0; }
  } else a.doorPush = 0;
  return bumped;
}

/** ground / floor height under the actor (smoothed) */
export function settleY(a, dt) {
  const fy = Build.floorY(a.x, a.z, a.y);
  a.y += (fy - a.y) * Math.min(1, dt * 14);
  if (Math.abs(fy - a.y) > 1.2) a.y = fy;
}

export function syncRig(a, dt, near) {
  const r = a.rig; if (!r) return;
  r.root.position.set(a.x, a.y, a.z); r.root.rotation.y = -a.ang;
  r.root.visible = near;
  if (!near) return;
  // only characters close to the camera cast shadows (keeps draw calls down on phones)
  const close = G.rend ? (a.x - G.rend.target.x) ** 2 + (a.z - G.rend.target.z) ** 2 < 22 * 22 : true;
  if (a._shadow !== close) { a._shadow = close; r.root.traverse(o => { if (o.isMesh) o.castShadow = close; }); }
  a.st.speed = a.speedNow; a.st.dead = a.dead ? Math.min(1, a.deadT * 2.2) : 0;
  if (a.flash > 0) a.flash = Math.max(0, a.flash - dt * 5);
  try { r.update(dt, a.st); if (r.flash) r.flash(a.flash); } catch (e) { if (!a._rigErr) { console.warn('rig update', e); a._rigErr = true; } }
}

export function muzzlePos(a) {
  try { a.rig.root.updateMatrixWorld(); a.rig.muzzleWorld(tmp); return { x: tmp.x, y: tmp.y, z: tmp.z }; }
  catch (e) { return { x: a.x + Math.cos(a.ang) * 0.8, y: a.y + 1.2, z: a.z + Math.sin(a.ang) * 0.8 }; }
}

export function actorNear(x, z, r, pred) {
  let best = null, bd = r * r;
  for (const a of G.actors) { if (a.dead || (pred && !pred(a))) continue; const d = (a.x - x) ** 2 + (a.z - z) ** 2; if (d < bd) { bd = d; best = a; } }
  return best;
}
export function heldDef(id) { return ITEMS[id] || null; }
void clamp;

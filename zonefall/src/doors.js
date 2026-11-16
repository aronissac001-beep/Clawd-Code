// ============================================================================
// ZONEFALL 3 — doors & gates. Real hinged panels: closed doors block
// movement and bullets; walking into your own door swings it open (away from
// you), it closes again behind you. Raiders and animals must break them.
// Monument steel doors can be opened by anyone; vault doors need a keycard
// (and sometimes power from a fuse box / lever).
// ============================================================================
import { THREE, M } from './gfx/materials.js';
import { G } from './state.js';
import { Sfx } from './audio.js';
import { DOORS } from './data.js';

let Models = null;
export function setDoorModels(m) { Models = m; }

let NID = 1;
const OPEN_SPEED = 3.2;

/**
 * spec: { x, z, y, axis:'x'|'z' (direction the doorway spans), w, kind, owner:'player'|'mon'|'fort',
 *         hp, card, fuse, lever, mon, piece, flip }
 */
export function addDoor(spec) {
  const kind = spec.kind || 'steel';
  const def = DOORS[kind];
  const w = spec.w ?? (def && def.gate ? 3.0 : kind === 'vault' || kind === 'steel' ? 1.4 : 1.2);
  const d = {
    id: NID++, x: spec.x, z: spec.z, y: spec.y || 0, axis: spec.axis || 'x', w, kind, owner: spec.owner || 'mon',
    hp: spec.hp ?? (def ? def.hp : 99999), maxhp: spec.hp ?? (def ? def.hp : 99999), invuln: !def && spec.owner !== 'fort',
    open: false, a: 0, sign: 1, card: spec.card || null, fuse: !!spec.fuse, lever: !!spec.lever, mon: spec.mon || null, piece: spec.piece || null,
    locked: !!spec.card, closeT: 0, metal: kind !== 'door_wood' && kind !== 'gate_wood', gate: !!(def && def.gate), autoClose: spec.owner === 'player' || (spec.owner || '').startsWith('bot:'),
    unlockT: 0, flip: !!spec.flip, sk: 'door',
  };
  // collider spanning the opening
  const t = d.gate ? 0.5 : 0.22;
  if (d.axis === 'x') d.col = G.phys.addBox(d.x - w / 2, d.z - t / 2, d.x + w / 2, d.z + t / 2, { h: 2.2, kind: 'door', ref: d });
  else d.col = G.phys.addBox(d.x - t / 2, d.z - w / 2, d.x + t / 2, d.z + w / 2, { h: 2.2, kind: 'door', ref: d });
  // mesh
  let m = null;
  const mk = kind === 'vault' || kind === 'steel' ? kind : kind;
  try { m = Models && Models.makeDoor ? Models.makeDoor(mk, { color: cardColor(d.card) }) : null; } catch (e) { console.warn('makeDoor failed', kind, e); m = null; }
  if (!m) {
    const root = new THREE.Group(), panel = new THREE.Group(); root.add(panel);
    M.add(panel, M.box(w, 2.1, 0.08), M.surf(d.metal ? 'metal' : 'plank'), w / 2, 1.05, 0); panel.position.x = -w / 2;
    m = { root, panel };
  }
  d.mesh = m; m.root.position.set(d.x, d.y, d.z); m.root.rotation.y = d.axis === 'x' ? 0 : -Math.PI / 2;
  if (spec.flip) { m.root.rotation.y += Math.PI; }
  G.scene.add(m.root);
  G.doors.push(d);
  return d;
}
export function cardColor(c) { return c === 'green' ? '#3cb050' : c === 'blue' ? '#3c78d0' : c === 'red' ? '#d03c3c' : '#8a9099'; }

export function removeDoor(d) {
  if (d.dead) return; d.dead = true; G.phys.remove(d.col); G.scene.remove(d.mesh.root);
  const i = G.doors.indexOf(d); if (i >= 0) G.doors.splice(i, 1);
}

/** can this actor open the door by hand? */
export function canOpen(d, actor) {
  if (d.dead) return false;
  if (d.owner === 'player') return actor === G.player;
  if (d.owner === 'fort') return actor && actor.team === 'outlaw';
  if (d.owner && d.owner.startsWith('bot:')) return !!(actor && actor.bot && 'bot:' + actor.bot.id === d.owner);
  if (d.card) return !d.locked; // unlocked vault doors can be pushed
  return true; // monument steel doors
}

/** open away from (fx, fz) */
export function openDoor(d, fx, fz, silent) {
  if (d.open || d.dead) return;
  // which side is the opener on? swing the panel away
  const side = d.axis === 'x' ? Math.sign(fz - d.z) || 1 : Math.sign(fx - d.x) || 1;
  // panel.rotation.y > 0 swings toward local -Z (world -Z for 'x' doors, world +X for 'z' doors)
  d.sign = d.axis === 'x' ? side : -side;
  if (d.flip) d.sign *= -1;
  d.open = true; d.closeT = 0;
  if (!silent) Sfx.doorOpen(d.x, d.z, d.metal);
}
export function closeDoor(d, silent) {
  if (!d.open || d.dead) return;
  // never close onto someone standing in the doorway
  for (const a of G.actors) if (!a.dead && inDoorway(d, a.x, a.z, a.r)) return false;
  d.open = false; if (!silent) setTimeout(() => Sfx.doorClose(d.x, d.z, d.metal), 180);
  return true;
}
export function toggleDoor(d, fx, fz) { if (d.open) closeDoor(d); else openDoor(d, fx, fz); }

export function inDoorway(d, x, z, r = 0.35) {
  const hw = d.w / 2 + r * 0.5, ht = (d.gate ? 0.9 : 0.75) + r;
  return d.axis === 'x' ? Math.abs(x - d.x) < hw && Math.abs(z - d.z) < ht : Math.abs(z - d.z) < hw && Math.abs(x - d.x) < ht;
}

export function updateDoors(dt) {
  for (const d of G.doors) {
    const target = d.open ? 1 : 0;
    if (d.a !== target) {
      d.a += Math.sign(target - d.a) * Math.min(Math.abs(target - d.a), dt * OPEN_SPEED * (d.gate ? 0.6 : 1));
      const ang = d.a * 1.62 * d.sign;
      d.mesh.panel.rotation.y = ang;
      if (d.mesh.panel2) d.mesh.panel2.rotation.y = -ang;
    }
    // collider: blocks while (mostly) closed
    d.col.off = d.a > 0.45;
    // auto-close player doors once the doorway is clear
    if (d.open && d.autoClose && G.settings && G.settings.autoClose !== false) {
      let near = false;
      for (const a of G.actors) if (!a.dead && (a.x - d.x) ** 2 + (a.z - d.z) ** 2 < 1.9 * 1.9) { near = true; break; }
      if (near) d.closeT = 0; else if ((d.closeT += dt) > 2.5) { closeDoor(d); d.closeT = 0; }
    }
    // vault doors re-lock after a while
    if (d.card && !d.locked && (d.unlockT -= dt) <= 0 && d.a <= 0.01 && !d.open) { d.locked = true; }
    if (d.card && !d.locked && d.unlockT < -1 && d.open) { d.unlockT = 0; closeDoor(d); }
  }
}

/** damage a door; returns true if destroyed */
export function damageDoor(d, amt) {
  if (d.invuln || d.dead) return false;
  d.hp -= amt; d.hitT = 0.15;
  if (d.hp <= 0) { onDoorDestroyed && onDoorDestroyed(d); removeDoor(d); return true; }
  return false;
}
let onDoorDestroyed = null;
export function setOnDoorDestroyed(fn) { onDoorDestroyed = fn; }

/** nearest door to a point within r */
export function doorNear(x, z, r = 2) {
  let best = null, bd = r * r;
  for (const d of G.doors) { const dd = (d.x - x) ** 2 + (d.z - z) ** 2; if (dd < bd) { bd = dd; best = d; } }
  return best;
}

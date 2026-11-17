// ============================================================================
// ZONEFALL 4 — the cargo ship event. Every couple of days a freighter steams
// in from the open sea and ties up at one of the island's harbors for about
// seven minutes. Its crew guards military crates on deck, lockers in the
// crew quarters, elite crates up on the bridge, and a locked cargo crate you
// can hack open (two minutes, and the crew calls for help). A horn warns a
// minute before it casts off; anyone still aboard is put ashore.
//
// Frames: ship-local u = along the hull (bow +u), v = across (port, the side
// that faces the quay, is -v), y = height above the waterline. While docked
// the ship lies along a quarter-turn of the harbor, so its walls are plain
// axis-aligned boxes in the physics grid. Upper floors (bridge deck, ramp,
// gangway) are height-aware like the train decks.
// ============================================================================
import { THREE, M } from './gfx/materials.js';
import { G } from './state.js';
import { Live } from './world/live.js';
import { spawnActor, removeActor } from './actors.js';
import { Sfx } from './audio.js';
import { WATER_Y } from './world/gen.js';
import { rand, lerp, clamp, dist } from './util.js';

let shipMod = null;
import('./gfx/models_ship.js').then(m => { shipMod = m; }).catch(() => { });

export const DECK = 5.0, BRIDGE = 8.4;
const STEP = 0.9;                       // how far below a floor you can be and still step onto it
const R_TURN = 60, L_OUT = 520, V_MAX = 9, ACC = 0.25;
export const DOCK_TIME = 420, WARN_T = 60, HACK_T = 120;
const BERTH_X = 35.5;                   // harbor-local x of the hull centreline (quay edge ~27.5, hull side at 28.5)

// walkable floors: [u0, u1, v0, v1, y]
// the bow narrows to a point: [u0, u1, walkable half-width] (hull outline minus the bulwark)
const BOW = [[26, 28, 6.52], [28, 30, 5.77], [30, 31, 5.27], [31, 32, 4.7], [32, 33, 4.05], [33, 34, 3.34], [34, 35, 2.56], [35, 36, 1.71], [36, 37, 0.81]];
const FLOORS = [[-38, 26, -7.2, 7, DECK], ...BOW.map(([u0, u1, hw]) => [u0, u1, -hw, hw, DECK]), [-36, -26, -6, 6, BRIDGE], [-21.2, -16.2, -2.8, 0.8, DECK + 0.5]];
const RAMP = { u0: -26, u1: -13, v0: 4.4, v1: 6.6 };          // BRIDGE at u0 -> DECK at u1
const GANG = { u0: -14, u1: 0, v0: -9.4, v1: -7.2, top: -2.4 }; // quay at u0 -> DECK at top, landing to u1
// solid walls: [u0, u1, v0, v1, y0, h]
const WALLS = [
  // hull / bulwark (y0 well below the deck so bullets from the quay hit the hull)
  [-38, -2.4, -7.2, -6.85, -4, 10.1], [0, 26, -7.2, -6.85, -4, 10.1], [-38, 26, 6.85, 7.2, -4, 10.1], [-38.2, -37.85, -7.2, 7.2, -4, 10.1],
  // container blocks
  [18, 24.1, -4.8, 4.8, DECK, 5.2], [8, 14.1, -4.8, 4.8, DECK, 7.8], [-2, 4.1, -4.8, 4.8, DECK, 7.8], [-12, -5.9, -4.8, 4.8, DECK, 5.2],
  // superstructure: back, sides, front (door + ramp gap), divider (door)
  [-36.2, -35.85, -6.2, 6.2, DECK, 6.4], [-36, -26, -6.2, -5.85, DECK, 6.4], [-36, -26, 5.85, 6.2, DECK, 6.4],
  [-26.2, -25.85, -6.2, -1.2, DECK, 6.4], [-26.2, -25.85, 1.2, 4.4, DECK, 6.4],
  [-30.15, -29.85, -6, -1, DECK, 6.4], [-30.15, -29.85, 1, 6, DECK, 6.4],
  // ramp inner handrail
  [-26, -13, 4.25, 4.45, DECK, 4.5],
  // bow bulwark, stepping in with the hull
  ...BOW.flatMap(([u0, u1, hw], i) => { const nx = BOW[i + 1] ? BOW[i + 1][2] : 0, prev = i ? BOW[i - 1][2] : 7; return [[u0, u1, hw, hw + 0.45, -4, 10.6], [u0, u1, -hw - 0.45, -hw, -4, 10.6], [u0 - 0.2, u0 + 0.2, hw, prev + 0.45, -4, 10.6], [u0 - 0.2, u0 + 0.2, -prev - 0.45, -hw, -4, 10.6], ...(i === BOW.length - 1 ? [[u1, u1 + 0.45, -hw - 0.45, hw + 0.45, -4, 10.6]] : [])]; }),
];
// model props that don't block anything (floors, thin posts, rails the walls already cover, outside the hull, under the ramp)
const PROP_SKIP = /hatch|gap post|chain pipe|walkway side rail|lifeboat|ramp legs|flagpole|chair/;
const GANG_WALLS = [[-14, 0.2, -9.6, -9.35], [-14, -2.4, -7.3, -7.15], [0, 0.25, -9.6, -7.15]]; // y0 = quay, h ≈ 5
// loot: [type, u, v, y, ry]
const LOOT = [
  ['military', 16, -2, DECK, 0], ['crate', 16, 2.6, DECK, 1.57], ['military', 6, 0.4, DECK, 0], ['ammobox', 6, 3.6, DECK, 0],
  ['crate', -4, -3, DECK, 0], ['military', -4, 2, DECK, 1.57], ['crate', 28, 0, DECK, 0], ['barrel_oil', 27.2, 3.4, DECK, 0], ['barrel', 27.2, -3.4, DECK, 0],
  ['barrel', -14, -6, DECK, 0], ['barrel', 24.8, 5.8, DECK, 0], ['toolbox', -8.6, -5.7, DECK, 0],
  ['food', -27.2, -4.8, DECK, 0], ['medbox', -29, -5.2, DECK, 1.57], ['locker', -35.2, -5, DECK, 1.57], ['locker', -35.2, 5, DECK, 1.57], ['military', -33, 5.1, DECK, 0],
  ['elite', -35.1, -3, BRIDGE, 1.57], ['military', -35.1, 3, BRIDGE, 1.57], ['ammobox', -27.2, -5, BRIDGE, 0],
];
const LOCKED = ['locked_crate', -20, 2.8, DECK, 1.57];
// crew: [u, v, y, patrol?]
const CREW = [
  [-18, -5.9, DECK, [[-20, -5.9], [24, -5.9]]], [-8, 5.9, DECK, [[-10, 5.9], [24, 5.9]]], [31, 0, DECK], [-22, -1, DECK], [-28, 0.5, DECK],
  [-27.6, -3.5, BRIDGE, [[-27.6, -4.5], [-27.6, 3.5]]], [-33, 0, BRIDGE],
];
const HELP = [[-24.5, 0, DECK], [-24.5, -2, DECK], [-27.8, 2.5, BRIDGE]];
const CREW_DEF = 'deckhand';

/** placeholder hull until the detailed model loads (or if it fails) */
function placeholderShip() {
  const root = new THREE.Group(), hullM = M.mat('#2a4a63'), deckM = M.mat('#9c8a6e'), boxM = M.mat('#c8402e'), towerM = M.mat('#e8e0d0');
  M.add(root, M.box(76, 9, 14), hullM, 0, 0.5, 0); M.add(root, M.box(76, 0.2, 14), deckM, 0, DECK, 0);
  for (const [u0, u1, h] of [[18, 24.1, 5.2], [8, 14.1, 7.8], [-2, 4.1, 7.8], [-12, -5.9, 5.2]]) M.add(root, M.box(u1 - u0, h, 9.6), boxM, (u0 + u1) / 2, DECK + h / 2, 0);
  M.add(root, M.box(10, 6.4, 12), towerM, -31, DECK + 3.2, 0);
  const gangway = new THREE.Group(); M.add(gangway, M.box(14, 0.2, 2.2), M.mat('#8a8f96'), -7, 3, -8.3);
  return { root, gangway, lights: [{ x: 0, y: DECK + 6, z: 0, color: '#fff2d8', intensity: 1.4, range: 22 }], update() { } };
}

export class CargoShip {
  /** harbor = a monument of type 'harbor'; role: 'host' (runs the crew and loot) or 'mirror' (co-op guest) */
  constructor(harbor, mirror = false) {
    this.mon = harbor; this.mirror = mirror; this.phase = 'arrive'; this.s = 0; this.v = V_MAX; this.t = 0;
    this.crew = []; this.loot = []; this.cols = []; this.lightRefs = []; this.warned = false; this.locked = null;
    const rot = harbor.rot | 0, cs = Math.cos(rot * Math.PI / 2), sn = Math.sin(rot * Math.PI / 2);
    const W = (x, z) => [harbor.x + x * cs - z * sn, harbor.z + x * sn + z * cs];
    [this.bx, this.bz] = W(BERTH_X, 0);
    // berth frame axes in world: s0 = seaward (harbor +X), b0 = bow (harbor -Z)
    this.s0 = [cs, sn]; this.b0 = [sn, -cs];
    this.quayY = harbor.y ?? 1;
    this.arrivePath = this.makePath(true); this.leavePath = this.makePath(false);
    const mk = (shipMod && shipMod.makeCargoShip) ? shipMod.makeCargoShip : placeholderShip;
    let made; try { made = mk(); } catch (e) { console.warn('ship model', e); made = placeholderShip(); }
    this.model = made; this.root = made.root; this.gangway = made.gangway;
    if (this.gangway) { this.root.add(this.gangway); this.gangway.visible = false; }
    G.scene.add(this.root);
    this.place(this.arrivePath, 0);
  }
  // ---------------------------------------------------------------- paths (berth frame p = seaward, q = bow)
  makePath(arrive) {
    const R = R_TURN, pts = [];
    if (arrive) {
      for (let k = 0; k <= 26; k++) pts.push([R + L_OUT * (1 - k / 26), -R]);
      for (let k = 1; k <= 40; k++) { const th = 1.5 * Math.PI - (Math.PI / 2) * (k / 40); pts.push([R + R * Math.cos(th), R * Math.sin(th)]); }
    } else {
      for (let k = 0; k <= 40; k++) { const th = Math.PI - (Math.PI / 2) * (k / 40); pts.push([R + R * Math.cos(th), R * Math.sin(th)]); }
      for (let k = 1; k <= 26; k++) pts.push([R + L_OUT * (k / 26), R]);
    }
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, cum, len: cum[cum.length - 1] };
  }
  sample(path, s) {
    s = clamp(s, 0, path.len); let i = 1; while (i < path.cum.length - 1 && path.cum[i] < s) i++;
    const a = path.pts[i - 1], b = path.pts[i], t = (s - path.cum[i - 1]) / Math.max(1e-6, path.cum[i] - path.cum[i - 1]);
    return { p: lerp(a[0], b[0], t), q: lerp(a[1], b[1], t), hp: b[0] - a[0], hq: b[1] - a[1] };
  }
  place(path, s) {
    const S = this.sample(path, s), [sx, sz] = this.s0, [bx, bz] = this.b0;
    this.x = this.bx + S.p * sx + S.q * bx; this.z = this.bz + S.p * sz + S.q * bz;
    const hx = S.hp * sx + S.hq * bx, hz = S.hp * sz + S.hq * bz; this.yaw = Math.atan2(hz, hx);
    const bob = this.phase === 'dock' ? 0 : Math.sin(G.t * 0.7) * 0.12;
    this.root.position.set(this.x, WATER_Y + bob, this.z); this.root.rotation.set(0, -this.yaw, this.phase === 'dock' ? 0 : Math.sin(G.t * 0.5) * 0.012);
  }
  dockPose() { this.x = this.bx; this.z = this.bz; this.yaw = Math.atan2(this.b0[1], this.b0[0]); this.root.position.set(this.x, WATER_Y, this.z); this.root.rotation.set(0, -this.yaw, 0); }
  // ---------------------------------------------------------------- frames
  toWorld(u, v) { const c = Math.cos(this.yaw), s = Math.sin(this.yaw); return [this.x + u * c - v * s, this.z + u * s + v * c]; }
  toLocal(x, z) { const dx = x - this.x, dz = z - this.z, c = Math.cos(this.yaw), s = Math.sin(this.yaw); return [dx * c + dz * s, -dx * s + dz * c]; }
  aabb(u0, u1, v0, v1) { const a = this.toWorld(u0, v0), b = this.toWorld(u1, v1); return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; }
  // ---------------------------------------------------------------- queries
  get docked() { return this.phase === 'dock'; }
  /** floor height at (x,z) for someone at height y (undefined = the highest floor), or null */
  floorAt(x, z, y) {
    if (!this.docked || (x - this.x) ** 2 + (z - this.z) ** 2 > 46 * 46) return null;
    const [u, v] = this.toLocal(x, z); let best = null;
    const ok = f => y === undefined || y >= f - STEP;
    for (const [u0, u1, v0, v1, fy] of FLOORS) if (u > u0 && u < u1 && v > v0 && v < v1 && ok(fy)) best = Math.max(best ?? -99, fy);
    if (u > RAMP.u0 && u < RAMP.u1 && v > RAMP.v0 && v < RAMP.v1) { const fy = lerp(BRIDGE, DECK, (u - RAMP.u0) / (RAMP.u1 - RAMP.u0)); if (ok(fy)) best = Math.max(best ?? -99, fy); }
    if (u > GANG.u0 && u < GANG.u1 && v > GANG.v0 && v < GANG.v1) { const fy = u >= GANG.top ? DECK : lerp(this.quayY, DECK, (u - GANG.u0) / (GANG.top - GANG.u0)); if (ok(fy)) best = Math.max(best ?? -99, fy); }
    return best;
  }
  /** deck and gangway count as walkable ground (the hull sits in deep water) */
  walkable(x, z) {
    if (!this.docked || (x - this.x) ** 2 + (z - this.z) ** 2 > 46 * 46) return false;
    const [u, v] = this.toLocal(x, z);
    for (const [u0, u1, v0, v1] of FLOORS) if (u > u0 && u < u1 && v > v0 && v < v1) return true;
    return u > GANG.u0 && u < GANG.u1 && v > GANG.v0 && v < GANG.v1;
  }
  aboard(a) { if (!a || a.dead || !this.docked) return false; const [u, v] = this.toLocal(a.x, a.z); return u > -38.5 && u < 38.5 && v > -7.4 && v < 7.4 && a.y > DECK - 1.5; }
  mapInfo() { return { x: this.x, z: this.z, ang: this.yaw }; }
  // ---------------------------------------------------------------- docking
  dock() {
    this.phase = 'dock'; this.t = 0; this.dockPose();
    if (this.gangway) this.gangway.visible = true;
    // anyone standing where the hull now is gets nudged onto the quay
    for (const a of [G.player, ...G.actors]) { if (!a || a.dead || a.heli) continue; const [u, v] = this.toLocal(a.x, a.z); if (u > -38.5 && u < 38.5 && v > -7.4 && v < 7.4 && a.y < DECK - 1.5) { const [x, z] = this.toWorld(u, -10.5); a.x = x; a.z = z; } }
    for (const [u0, u1, v0, v1, y0, h] of WALLS) { const [x0, z0, x1, z1] = this.aabb(u0, u1, v0, v1); this.cols.push(G.phys.addBox(x0, z0, x1, z1, { h, y0: WATER_Y + y0, kind: 'ship' })); }
    // furniture and deck gear from the model, each blocking only at its own level
    for (const q of this.model.props || []) { if (PROP_SKIP.test(q.name || '')) continue; const [x0, z0, x1, z1] = this.aabb(q.x0, q.x1, q.z0, q.z1); const c = G.phys.addBox(x0, z0, x1, z1, { h: q.y1 - q.y0, y0: WATER_Y + q.y0, kind: 'ship', opaque: false }); c.ylo = WATER_Y + q.y0; c.yhi = WATER_Y + q.y1; this.cols.push(c); }
    for (const [u0, u1, v0, v1] of GANG_WALLS) { const [x0, z0, x1, z1] = this.aabb(u0, u1, v0, v1); this.cols.push(G.phys.addBox(x0, z0, x1, z1, { h: DECK + 1.1 - this.quayY, y0: this.quayY, kind: 'fence', opaque: false })); }
    for (const L of this.model.lights || []) { const [x, z] = this.toWorld(L.x, L.z); const o = { x, y: WATER_Y + L.y, z, color: L.color || '#fff2d8', intensity: L.intensity || 1.2, range: L.range || 14, ship: true }; G.lights.push(o); this.lightRefs.push(o); }
    this.horn(2);
    if (this.mirror) return;
    // crew and loot (host / solo only; co-op guests get them streamed)
    for (const [type, u, v, y, ry] of LOOT) this.addCrate(type, u, v, y, ry);
    this.locked = this.addCrate(...LOCKED); if (this.locked) { this.locked.locked = true; this.locked.hackEnd = 0; }
    for (const [u, v, y, pat] of CREW) this.addCrew(u, v, y, pat);
    const P = G.player; if (P && dist(P.x, P.z, this.x, this.z) < 400) G.ui.toast('The cargo ship has docked at the harbor', 'good');
    if (G.net) G.net.note('The cargo ship has docked at the harbor', 'good');
  }
  addCrate(type, u, v, y, ry = 0) {
    const [x, z] = this.toWorld(u, v);
    const c = Live.addContainer({ type, x, z, ry: -this.yaw + ry }); if (!c) return null;
    c.y = WATER_Y + y; c.mesh.position.y = c.y; if (c.col) { c.col.y0 = c.y; c.col.top = undefined; }
    c.ship = true; this.loot.push(c);
    if (G.net && G.net.role === 'host') G.net.broadcast({ t: 'cadd', c: [c.id, c.type, Math.round(c.x * 100) / 100, Math.round(c.y * 100) / 100, Math.round(c.z * 100) / 100, Math.round(c.ry * 1000) / 1000, c.locked ? 1 : 0] });
    return c;
  }
  addCrew(u, v, y, pat) {
    const [x, z] = this.toWorld(u, v);
    const patrol = pat ? pat.map(([pu, pv]) => this.toWorld(pu, pv)) : null;
    const a = spawnActor(CREW_DEF, x, z, { patrol }); a.y = WATER_Y + y; a.shipCrew = true; a.ai.home = { x, z }; this.crew.push(a);
    return a;
  }
  // ---------------------------------------------------------------- the locked crate
  startHack(c, by) {
    if (!c || !c.locked || c.hackEnd) return;
    c.hackEnd = G.t + HACK_T; Sfx.card && Sfx.card();
    const msg = 'Hacking the locked crate — 2 minutes. The crew is coming!';
    if (G.ui) G.ui.toast(msg, 'bad'); if (G.net) G.net.note(msg, 'bad');
    // the crew converges on the crate; two more come up from below
    for (const [u, v, y] of HELP) this.addCrew(u, v, y);
    for (const a of this.crew) if (!a.dead && by) { a.ai.state = 'alert'; a.ai.lastSeen = { x: c.x, z: c.z, t: G.t }; }
  }
  // ---------------------------------------------------------------- departure
  castOff() {
    this.phase = 'leave'; this.s = 0; this.v = 0.4;
    for (const c of this.cols) G.phys.remove(c); this.cols.length = 0;
    G.lights = G.lights.filter(l => !this.lightRefs.includes(l)); this.lightRefs.length = 0;
    if (this.gangway) this.gangway.visible = false;
    // whoever is still aboard is put ashore
    const [qx, qz] = this.toWorld(-16, -11.5);
    for (const a of [G.player, ...G.actors]) { if (!a || a.dead || a.heli || a.shipCrew) continue; const [u, v] = this.toLocal(a.x, a.z); if (u > -38.5 && u < 38.5 && v > -9.6 && v < 7.4 && a.y > this.quayY + 0.6) { a.x = qx + rand(-1.5, 1.5); a.z = qz + rand(-1.5, 1.5); a.y = Math.max(G.W.height(a.x, a.z), this.quayY); if (a === G.player) G.ui.toast('The crew put you ashore as the ship cast off'); } }
    this.clearAboard();
    this.horn(3);
  }
  clearAboard() {
    for (const a of this.crew) if (!a.removed && !a.dead) removeActor(a); this.crew.length = 0;
    const gone = this.loot.map(c => c.id);
    for (const c of this.loot) { const i = G.containers.indexOf(c); if (i >= 0) G.containers.splice(i, 1); if (c.mesh) c.mesh.removeFromParent(); if (c.col) G.phys.remove(c.col); }
    this.loot.length = 0; this.locked = null;
    if (gone.length && G.net && G.net.role === 'host') G.net.broadcast({ t: 'crem', ids: gone });
  }
  horn(n) { const v = G.player ? Sfx.vol(this.x, this.z, 600) : 0; if (v < 0.02) return; for (let i = 0; i < n; i++) { Sfx.tone(92, 1.4, 0.32 * v, 'sawtooth', i * 1.7, 0.98); Sfx.tone(138, 1.4, 0.2 * v, 'sawtooth', i * 1.7, 0.98); } }
  dispose() {
    if (this.phase === 'dock') this.castOff();
    this.clearAboard();
    for (const c of this.cols) G.phys.remove(c); this.cols.length = 0;
    G.lights = G.lights.filter(l => !this.lightRefs.includes(l));
    this.root.removeFromParent(); // geometry is shared between ships: never dispose it
    this.phase = 'gone';
  }
  // ---------------------------------------------------------------- per frame
  update(dt) {
    this.t += dt;
    if (this.model.update) try { this.model.update(dt); } catch (e) { }
    if (this.phase === 'arrive') {
      const left = this.arrivePath.len - this.s;
      const want = Math.min(V_MAX, Math.sqrt(2 * ACC * Math.max(0, left)) + 0.25);
      this.v += clamp(want - this.v, -ACC * 2 * dt, ACC * 2 * dt); this.s += this.v * dt;
      if (!this.mirror && left < 0.3) this.dock(); else this.place(this.arrivePath, this.s);
      if (!this.hornNear && left < 140) { this.hornNear = true; this.horn(1); }
    } else if (this.phase === 'dock') {
      if (!this.mirror) {
        if (!this.warned && this.t > DOCK_TIME - WARN_T) { this.warned = true; this.horn(2); const msg = 'The cargo ship casts off in 1 minute!'; const P = G.player; if (P && dist(P.x, P.z, this.x, this.z) < 300) G.ui.toast(msg, 'bad'); if (G.net) G.net.note(msg, 'bad'); }
        if (this.t > DOCK_TIME) this.castOff();
        // the locked crate opens when the hack finishes
        const c = this.locked; if (c && c.locked && c.hackEnd && G.t >= c.hackEnd) { c.locked = false; c.hackEnd = 0; Sfx.win(); const msg = 'The locked crate on the cargo ship is open!'; if (G.ui) G.ui.toast(msg, 'good'); if (G.net) G.net.note(msg, 'good'); }
      }
    } else if (this.phase === 'leave') {
      this.v = Math.min(V_MAX, this.v + ACC * dt); this.s += this.v * dt;
      this.place(this.leavePath, this.s);
      if (!this.mirror && this.s >= this.leavePath.len) this.dispose();
    }
  }
}

// ---------------------------------------------------------------- event control (lives on G.cargo)
export const Cargo = {
  /** host / solo: start the event at a random harbor (or the one given) */
  start(harbor) {
    if (G.cargo && G.cargo.phase !== 'gone') return null;
    const harbors = G.monuments.filter(m => m.type === 'harbor'); if (!harbors.length) return null;
    const h = harbor || harbors[Math.floor(Math.random() * harbors.length)];
    G.cargo = new CargoShip(h, false); G.cargo.hIndex = harbors.indexOf(h);
    const P = G.player; G.ui.toast('A cargo ship has been spotted heading for the ' + (P ? dirWord(P, h) + ' ' : '') + 'harbor', 'good');
    if (G.net) G.net.note('A cargo ship is heading for the harbor', 'good');
    Sfx.tone && Sfx.tone(330, 0.2, 0.08, 'triangle');
    return G.cargo;
  },
  update(dt) {
    const S = G.cargo; if (!S) return;
    if (S.phase === 'gone') { G.cargo = null; return; }
    S.update(dt);
    if (S.phase === 'gone') G.cargo = null;
  },
  /** host -> guests state line */
  state() { const S = G.cargo; if (!S || S.phase === 'gone') return { t: 'cargo', end: 1 }; return { t: 'cargo', h: S.hIndex, ph: S.phase, s: Math.round(S.s * 10) / 10, tt: Math.round(S.t * 10) / 10 }; },
  /** guest: follow the host's ship */
  fromHost(m) {
    if (m.end) { if (G.cargo) { G.cargo.dispose(); G.cargo = null; } return; }
    const harbors = G.monuments.filter(q => q.type === 'harbor'); const h = harbors[m.h | 0]; if (!h) return;
    let S = G.cargo;
    if (S && S.mon !== h) { S.dispose(); S = null; }
    if (!S) { S = G.cargo = new CargoShip(h, true); S.hIndex = m.h | 0; }
    if (m.ph === 'dock' && S.phase !== 'dock') { if (S.phase === 'leave') { S.dispose(); S = G.cargo = new CargoShip(h, true); S.hIndex = m.h | 0; } S.dock(); }
    if (m.ph === 'leave' && S.phase !== 'leave') { if (S.phase === 'arrive') S.dock(); S.castOff(); }
    if (Math.abs((S.s || 0) - (+m.s || 0)) > 6) S.s = +m.s || 0;
    if (m.ph === 'dock') S.t = +m.tt || S.t;
  },
  reset() { if (G.cargo) { try { G.cargo.dispose(); } catch (e) { } } G.cargo = null; },
};
function dirWord(p, m) {
  const a = Math.atan2(m.z - p.z, m.x - p.x); const k = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'][k];
}

// ============================================================================
// ZONEFALL 4 — vehicles you can use: dune buggies on the roads, little
// minicopters at the airfield, Haven and in the open country, and boats on the
// sea, the bigger lakes and the lower rivers.
//   buggy:  stick / WASD = throttle + steer (reverse by pulling back). Fast on
//           roads, slower off-road, crawls through shallows, floods in deep water.
//   heli:   the nose follows where you look; stick / WASD = fly forward / sideways;
//           ⤒ / Space = climb, ⤓ / C = descend. Hovers on its own; lands on its skids.
//   rowboat:   stick / WASD = row + steer (one oar pulls, the other backs water),
//              pull back to back-water. Slow, quiet, needs no fuel.
//   motorboat: stick / WASD = throttle + steer, pull back to slow and reverse.
//              Fast rigid inflatable with an outboard; wake, spray, engine noise.
// Buggies, helis and motorboats burn low-grade fuel (topped up from your pockets
// when you climb in). Everything takes damage from crashes and explosions, runs
// people over, and respawns after a while if wrecked (boats sink first).
// Boats float on the sea plane (WATER_Y), bob and roll on the swell, lean into
// turns, and only move where the water is deep enough: they slow and stop in the
// shallows. They bump into other boats, the cargo ship's hull, jetty decks and
// posts, and monument walls. You get in from a shore, a jetty, a dock or wading
// in the shallows, and get out onto the nearest walkable spot within ~5 m.
// Arcade physics; collisions use the world's 2D colliders + heights.
// ============================================================================
import { THREE, M } from './gfx/materials.js';
import { G } from './state.js';
import { Sfx } from './audio.js';
import { hurt, explode } from './combat.js';
import { SOLID } from './physics.js';
import { Build } from './build.js';
import { WATER_Y } from './world/gen.js';
import { buildBoatModel, boatFx, oarSplash, BOAT_COLORS } from './gfx/models_boats.js';
import { clamp, lerp, dist, rand, chance, angDiff, rng, shuffle } from './util.js';
import { Input as INPUT } from './input.js';

const KINDS = {
  buggy: { name: 'Dune Buggy', hp: 420, fuel: 60, burn: 0.14, r: 1.25, eye: 1.0, seat: [-0.25, 0.72, -0.42], respawn: 420, exitLabel: 'Get out of the buggy' },
  heli: { name: 'Minicopter', hp: 300, fuel: 50, burn: 0.22, r: 2.0, eye: 0.95, seat: [0.15, 0.86, 0], respawn: 600, exitLabel: 'Get out of the minicopter' },
  // boats: len/beam = hull size, draft = water depth they need to move, keel = how far the hull reaches below the waterline,
  // reach = how far from the hull's centre line you can climb in from
  rowboat: { name: 'Rowboat', boat: true, hp: 240, fuel: 0, burn: 0, r: 0.7, len: 3.6, beam: 1.4, draft: 0.4, keel: 0.22, eye: 0.92, seat: [-0.55, 0.3, 0], respawn: 360,
    vmax: 5, vrev: 2.6, acc: 2.5, turn: 0.95, grip: 3.6, drag: 0.2, reach: 2.4, noise: 7, exitLabel: 'Get out of the rowboat' },
  motorboat: { name: 'Motorboat', boat: true, hp: 360, fuel: 50, burn: 0.16, r: 1.0, len: 4.8, beam: 2.0, draft: 0.4, keel: 0.3, eye: 1.0, seat: [-0.62, 0.62, 0], respawn: 480,
    vmax: 14.3, vrev: 4, acc: 5.4, turn: 1.15, grip: 2.3, drag: 0.16, reach: 2.7, noise: 32, exitLabel: 'Get out of the motorboat' },
};
const COLORS = ['#ff8a1e', '#2bb3a8', '#d8432f', '#ffc928', '#5a8fd8'];
const BOAT_WANT = { motorboat: 12, rowboat: 10 }; // ~10-14 / 8-12 around the island
const TOO_DEEP = 'Too deep to get out here — get closer to shore, a jetty or a ship';
// hull sample points (fractions of half-length, half-beam) for depth and grounding checks
const HULL_PTS = [[0.92, 0], [0.5, 0], [0, 0], [-0.5, 0], [-0.9, 0], [0.15, 0.85], [0.15, -0.85], [-0.45, 0.85], [-0.45, -0.85]];
/** gentle swell (m) */
const wave = (x, z, t) => 0.045 * Math.sin(t * 0.9 + x * 0.11 + z * 0.06) + 0.03 * Math.sin(t * 1.4 - x * 0.07 + z * 0.13) + 0.014 * Math.sin(t * 2.3 + x * 0.29 - z * 0.21);
/** colliders a boat at height y runs into: things reaching down to the water (not bridge decks or ship furniture) */
const boatFilter = y => c => c.solid && !c.off && (c.y0 ?? -99) < y + 1.4 && (c.ylo === undefined || c.ylo < y + 1.4);
/** colliders that stop you standing at floor height fy */
const standFilter = fy => c => {
  if (!c.solid || c.off) return false;
  const lo = c.ylo ?? c.y0 ?? -99, hi = c.yhi ?? ((c.y0 ?? fy) + (c.h ?? 3));
  return lo < fy + 1.7 && hi > fy + 0.2;
};
function segDist(px, pz, ax, az, bx, bz) { const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1; const t = clamp(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1); return Math.hypot(px - (ax + dx * t), pz - (az + dz * t)); }
/** closest points between two 2D segments: returns [dist, pax, paz, pbx, pbz] */
function segSeg(a0x, a0z, a1x, a1z, b0x, b0z, b1x, b1z) {
  const ux = a1x - a0x, uz = a1z - a0z, vx = b1x - b0x, vz = b1z - b0z, wx = a0x - b0x, wz = a0z - b0z;
  const a = ux * ux + uz * uz, b = ux * vx + uz * vz, c = vx * vx + vz * vz, d = ux * wx + uz * wz, e = vx * wx + vz * wz, D = a * c - b * b;
  let s = D > 1e-8 ? clamp((b * e - c * d) / D, 0, 1) : 0, t = c > 1e-8 ? clamp((b * s + e) / c, 0, 1) : 0;
  s = a > 1e-8 ? clamp((b * t - d) / a, 0, 1) : 0;
  const pax = a0x + ux * s, paz = a0z + uz * s, pbx = b0x + vx * t, pbz = b0z + vz * t;
  return [Math.hypot(pax - pbx, paz - pbz), pax, paz, pbx, pbz];
}

export class Vehicles {
  constructor(scene) {
    this.scene = scene; this.list = []; this.sndT = 0; this.noiseT = 0; this.nid = 0;
    this.spawnAll();
  }
  // ---------------------------------------------------------------- spawning
  spawnAll() {
    const W = G.W, spots = [];
    const free = (x, z, r) => W.walkable(x, z) && !W.isWater(x, z) && !G.phys.overlaps(x, z, r, c => c.solid && !c.off) && !(W.onRail && W.onRail(x, z, 4)) && !G.monuments.some(m => !m.def.safe && dist(m.x, m.z, x, z) < m.size * 0.6);
    // buggies: on the shoulders of the roads, spread out
    const roads = W.roads.filter(p => p.length > 6);
    for (let tries = 0; tries < 400 && spots.filter(s => s.kind === 'buggy').length < 9; tries++) {
      const p = roads[Math.floor(Math.random() * roads.length)]; if (!p) break;
      const i = 1 + Math.floor(Math.random() * (p.length - 2)); const [x0, z0] = p[i], [x1, z1] = p[i + 1]; const L = Math.hypot(x1 - x0, z1 - z0) || 1;
      const nx = -(z1 - z0) / L, nz = (x1 - x0) / L, side = chance(0.5) ? 1 : -1;
      const x = x0 + nx * 5.8 * side, z = z0 + nz * 5.8 * side;
      if (!free(x, z, 2.2) || spots.some(s => dist(s.x, s.z, x, z) < 90)) continue;
      spots.push({ kind: 'buggy', x, z, yaw: Math.atan2(z1 - z0, x1 - x0) + (chance(0.5) ? 0 : Math.PI) + rand(-0.3, 0.3) });
    }
    // minicopters: airfield apron, just outside Haven, and open fields
    const heliAt = (x, z) => { for (let k = 0; k < 40; k++) { const a = rand(0, 6.28), r = k * 1.5; const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (free(px, pz, 3.6) && G.W.height(px, pz) > 0.8) { spots.push({ kind: 'heli', x: px, z: pz, yaw: rand(0, 6.28) }); return true; } } return false; };
    const af = G.monuments.find(m => m.type === 'airfield'); if (af) heliAt(af.x + af.size * 0.75, af.z);
    const hv = G.monuments.find(m => m.type === 'haven'); if (hv) heliAt(hv.x + hv.size + 10, hv.z + 6);
    for (let tries = 0; tries < 200 && spots.filter(s => s.kind === 'heli').length < 4; tries++) {
      const x = rand(150, W.size - 150), z = rand(150, W.size - 150);
      if (W.biomeAt(x, z) !== 2 || spots.some(s => dist(s.x, s.z, x, z) < 200)) continue; heliAt(x, z);
    }
    // boats: deterministic per world seed (co-op friends get the same moorings)
    try { this.spawnBoats(spots); } catch (e) { console.error('boat spawns failed', e); }
    for (const s of spots) this.spawn(s);
  }
  spawn(s) {
    const K = KINDS[s.kind];
    if (K.boat) return this.spawnBoat(s);
    const col = s.col || COLORS[Math.floor(Math.random() * COLORS.length)];
    const v = { nid: s.nid || ++this.nid, col, kind: s.kind, K, home: s, x: s.x, z: s.z, y: G.W.height(s.x, s.z), yaw: s.yaw, pitch: 0, roll: 0, speed: 0, vx: 0, vz: 0, vy: 0, steer: 0, hp: K.hp, fuel: Math.round(K.fuel * rand(0.35, 0.8)), dead: false, driver: null, rpm: 0, hitT: new Map() };
    v.mesh = s.kind === 'buggy' ? buildBuggy(col, v) : buildHeli(col, v);
    this.scene.add(v.mesh.root); this.list.push(v); this.place(v);
    return v;
  }
  spawnBoat(s) {
    const K = KINDS[s.kind];
    const v = { nid: s.nid || ++this.nid, col: s.col, kind: s.kind, K, boat: true, home: s, x: s.x, z: s.z, y: WATER_Y, yaw: s.yaw, pitch: 0, roll: 0, speed: 0, lat: 0, vx: 0, vz: 0, vy: 0, yawRate: 0, steer: 0, thr: 0, eL: 0, eR: 0,
      hp: K.hp, fuel: K.fuel ? Math.round(K.fuel * (s.fuelK ?? rand(0.35, 0.8))) : 0, dead: false, driver: null, rpm: 0, hitT: new Map(), ph: ((s.x * 0.37 + s.z * 0.71) % 20 + 20) % 20, amp: 1, ground: 0, near: 0 };
    v.amp = this.seaAmp(v.x, v.z);
    v.ground = this.grounding(K, v.x, v.z, v.yaw);
    v.mesh = buildBoatModel(s.kind, s.col);
    this.scene.add(v.mesh.root); this.list.push(v); this.floatBoat(v, 0, true);
    return v;
  }
  /** pick the boat moorings: coastal monuments, sea beaches, the bigger lakes, the lower rivers */
  spawnBoats(spots) {
    const W = G.W; if (!W || !W.height) return;
    const R = rng(((W.seed | 0) ^ 0x2b0a7f1d) >>> 0), H = W.height;
    const boats = [], have = { motorboat: 0, rowboat: 0 };
    const add = (kind, x, z, yaw, where, beached = false) => { const cols = BOAT_COLORS[kind]; boats.push({ kind, x, z, yaw, where, beached, col: cols[Math.floor(R() * cols.length)], fuelK: R.range(0.35, 0.8) }); have[kind]++; };
    const spaced = (kind, x, z, gap = 0.8) => boats.every(b => dist(b.x, b.z, x, z) >= (KINDS[b.kind].len + KINDS[kind].len) / 2 + gap);
    // ---- coastal monuments: alongside the jetties / quays
    const coastal = G.monuments.filter(m => m.type === 'harbor' || m.type === 'fishvillage' || m.type === 'lighthouse').sort((a, b) => (a.x - b.x) || (a.z - b.z));
    for (const m of coastal) {
      const plan = m.type === 'harbor' ? ['motorboat', 'motorboat'] : m.type === 'fishvillage' ? ['rowboat', 'motorboat', 'rowboat'] : [R() < 0.5 ? 'rowboat' : 'motorboat'];
      for (const kind of plan) { const c = this.monSpot(m, kind, R, boats); if (c) add(kind, c.x, c.z, c.yaw, m.type); }
    }
    // ---- the bigger lakes (rowboats), near the shore so you can wade to them
    const lakes = (W.lakes || []).filter(l => l.r >= 11).sort((a, b) => b.r - a.r || a.x - b.x).slice(0, 3);
    let nl = 0;
    for (const l of lakes) {
      if (nl >= 2) break; const a0 = R() * Math.PI * 2;
      search: for (let k = 0; k < 16; k++) {
        const a = a0 + k / 16 * Math.PI * 2;
        for (let t = 0.92; t >= 0.4; t -= 0.04) {
          const x = l.x + Math.cos(a) * t * l.r, z = l.z + Math.sin(a) * t * l.r, yaw = a + Math.PI / 2 + R.range(-0.3, 0.3) + (R() < 0.5 ? 0 : Math.PI);
          if (!spaced('rowboat', x, z, 3) || !this.poseOK(KINDS.rowboat, x, z, yaw) || !this.clearRun(KINDS.rowboat, x, z, yaw, 6) || !this.boardSpot(KINDS.rowboat, x, z, yaw)) continue;
          add('rowboat', x, z, yaw, 'lake'); nl++; break search;
        }
      }
    }
    // ---- rivers (if the world has them): rowboats on the wide lower stretches, clear of bridges
    const rivers = (W.rivers || []).filter(rv => rv && rv.pts && rv.pts.length > 12); shuffle(rivers, R);
    let nr = 0;
    for (const rv of rivers) {
      if (nr >= 2) break; const P = rv.pts, n = P.length; const idxs = [];
      for (let i = Math.floor(n * 0.6); i < n - 6; i += 2) idxs.push(i);
      shuffle(idxs, R);
      riv: for (const i of idxs) {
        const w = rv.w ?? lerp(rv.w0 ?? 3, rv.w1 ?? 6, i / (n - 1)); if (w < 4.2) continue;
        const [x0, z0] = P[i - 1], [x1, z1] = P[i + 1], [px, pz] = P[i], ang = Math.atan2(z1 - z0, x1 - x0), nx = -Math.sin(ang), nz = Math.cos(ang);
        if ((W.bridges || []).some(b => segDist(px, pz, b.x0, b.z0, b.x1, b.z1) < 24)) continue;
        if (G.monuments.some(m => dist(m.x, m.z, px, pz) < m.size + 20)) continue;
        for (const side of [1, -1]) for (let off = w - 1.2; off >= 0; off -= 0.4) {
          const x = px + nx * off * side, z = pz + nz * off * side, yaw = ang + (R() < 0.5 ? 0 : Math.PI);
          if (!spaced('rowboat', x, z, 3) || !this.poseOK(KINDS.rowboat, x, z, yaw) || !this.clearRun(KINDS.rowboat, x, z, yaw, 10) || !this.boardSpot(KINDS.rowboat, x, z, yaw)) continue;
          add('rowboat', x, z, yaw, 'river'); nr++; break riv;
        }
      }
    }
    // ---- sea beaches: rowboats pulled half up the sand, motorboats in the shallows
    const cx = W.size / 2, cz = W.size / 2, NB = 140, a0 = R() * Math.PI * 2, beach = [];
    for (let k = 0; k < NB; k++) {
      const a = a0 + (k + R() * 0.7) / NB * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      let r = W.size * 0.5 - 10; if (H(cx + ca * r, cz + sa * r) > -1.2) continue; // must start out at sea
      let hit = -1; for (; r > W.size * 0.15; r -= 2) if (H(cx + ca * r, cz + sa * r) > -0.35) { hit = r; break; }
      if (hit < 0) continue;
      let rw = hit; for (let q = 0; q < 40 && H(cx + ca * rw, cz + sa * rw) < 0.03; q++) rw -= 0.5;
      const wx = cx + ca * rw, wz = cz + sa * rw;
      if (H(wx, wz) < 0.03) continue;
      if (W.riverDist && W.riverDist(wx, wz) < 26) continue;
      if (G.monuments.some(m => dist(m.x, m.z, wx, wz) < m.size + 35)) continue;
      if (W.isRoad(wx, wz) || (W.onRail && W.onRail(wx, wz, 8))) continue;
      beach.push({ a, ca, sa, wx, wz });
    }
    shuffle(beach, R);
    const farFromBoats = (x, z, d) => boats.every(b => dist(b.x, b.z, x, z) >= d);
    for (const bc of beach) {
      const needR = BOAT_WANT.rowboat - have.rowboat, needM = BOAT_WANT.motorboat - have.motorboat;
      if (needR <= 0 && needM <= 0) break;
      if (!farFromBoats(bc.wx, bc.wz, 60)) continue;
      const kind = needR / BOAT_WANT.rowboat >= needM / BOAT_WANT.motorboat ? 'rowboat' : 'motorboat', K = KINDS[kind];
      if (kind === 'rowboat') {
        // pulled up the beach: bow on the sand, stern in the water
        const yaw = bc.a + Math.PI + R.range(-0.4, 0.4);
        let ok = null;
        for (const off of [0.9, 0.5, 1.3, 0.1, 1.7]) {
          const x = bc.wx + bc.ca * off, z = bc.wz + bc.sa * off, c = Math.cos(yaw), s = Math.sin(yaw), hl = K.len / 2;
          const hb = H(x + c * hl * 0.9, z + s * hl * 0.9), hs = H(x - c * hl * 0.9, z - s * hl * 0.9);
          if (hb < -0.02 || hs > -0.06 || hb - hs > 0.9 || this.inShipLane(x, z, hl) || this.blockedAt(K, x, z, yaw, WATER_Y)) continue;
          let deep = false; for (let t = 2; t < 18 && !deep; t += 1) deep = H(x - c * (hl + t), z - s * (hl + t)) < -0.7; // it can be rowed off
          if (deep) { ok = { x, z, yaw }; break; }
        }
        if (ok) add('rowboat', ok.x, ok.z, ok.yaw, 'beach', true);
      } else {
        const yaw0 = R() < 0.4 ? bc.a + Math.PI : bc.a + (R() < 0.5 ? 1 : -1) * Math.PI / 2;
        for (let t = 2; t < 30; t += 0.5) {
          const x = bc.wx + bc.ca * t, z = bc.wz + bc.sa * t, yaw = yaw0 + R.range(-0.25, 0.25);
          if (!this.poseOK(K, x, z, yaw)) continue;
          if (this.clearRun(K, x, z, yaw, 16) && this.boardSpot(K, x, z, yaw)) add('motorboat', x, z, yaw, 'beach');
          break;
        }
      }
    }
    this.boatSpots = boats;
    for (const b of boats) spots.push(b);
  }
  /** a mooring at a coastal monument: alongside its jetty decks first, else along the seaward edge */
  monSpot(m, kind, R, taken) {
    const K = KINDS[kind], rot = m.rot | 0, Q = Math.PI / 2, cs = Math.cos(rot * Q), sn = Math.sin(rot * Q);
    const toW = (lx, lz) => [m.x + lx * cs - lz * sn, m.z + lx * sn + lz * cs];
    const cands = [], gap = K.beam / 2 + 0.35;
    for (const d of G.decks || []) {
      if (d.mon !== m) continue;
      for (let x = d.x0 + 0.5; x <= d.x1 - 0.5; x += 0.8) { cands.push([x, d.z0 - gap, 0, R() * 0.3]); cands.push([x, d.z1 + gap, 0, R() * 0.3]); }
      for (let z = d.z0 + 0.5; z <= d.z1 - 0.5; z += 0.8) { cands.push([d.x0 - gap, z, Q, R() * 0.3]); cands.push([d.x1 + gap, z, Q, R() * 0.3]); }
    }
    for (let lx = m.size * 0.55; lx <= m.size + 14; lx += 1.5) for (let lz = -(m.size + 16); lz <= m.size + 16; lz += 2) for (const ly of [0, Q]) {
      const [x, z] = toW(lx, lz); cands.push([x, z, ly + rot * Q, 2 + Math.hypot(lx, lz) / m.size + R() * 0.3]);
    }
    cands.sort((a, b) => a[3] - b[3]);
    for (const [x, z, y0] of cands) {
      const yaw = y0 + (R() < 0.5 ? 0 : Math.PI);
      if (taken.some(b => dist(b.x, b.z, x, z) < (KINDS[b.kind].len + K.len) / 2 + 0.8)) continue;
      if (this.inShipLane(x, z, K.len / 2 + 2)) continue;
      if (m.type === 'fishvillage') { const [dx, dz] = toW(27, -10.7); if (dist(x, z, dx, dz) < K.len / 2 + 1.8) continue; } // the decorative rowboat by the net loft
      if (!this.poseOK(K, x, z, yaw) || !this.clearRun(K, x, z, yaw, kind === 'motorboat' ? 16 : 7)) continue;
      if (!this.boardSpot(K, x, z, yaw)) continue;
      return { x, z, yaw };
    }
    return null;
  }
  /** the cargo ship's berth and its approach / departure lanes at every harbor */
  inShipLane(x, z, pad = 0) {
    for (const h of G.monuments) {
      if (h.type !== 'harbor') continue;
      const rot = h.rot | 0, cs = Math.cos(rot * Math.PI / 2), sn = Math.sin(rot * Math.PI / 2), dx = x - h.x, dz = z - h.z;
      const lx = dx * cs + dz * sn, lz = -dx * sn + dz * cs;
      if (lx > 26 - pad && lx < 46 + pad && Math.abs(lz) < 41 + pad) return true;
      if (lx >= 46 && lx < 195 && Math.abs(lz) < 72 + pad) return true; // the berth turn and the run offshore
    }
    return false;
  }
  /** a boat of kind K could float here: deep enough under the whole hull and nothing in the way */
  poseOK(K, x, z, yaw, extra = 0.1) {
    const W = G.W, H = W.height, hl = K.len / 2, hb = K.beam / 2, c = Math.cos(yaw), s = Math.sin(yaw);
    if (x < 12 || z < 12 || x > W.size - 12 || z > W.size - 12 || this.inShipLane(x, z, K.len / 2)) return false;
    for (const [a, b] of HULL_PTS) if (H(x + c * a * hl - s * b * hb, z + s * a * hl + c * b * hb) > -(K.draft + extra)) return false;
    return !this.blockedAt(K, x, z, yaw, WATER_Y);
  }
  /** room to get going: a straight run of `len` metres ahead or astern stays afloat and unobstructed */
  clearRun(K, x, z, yaw, len) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const dir of [1, -1]) {
      let ok = true;
      for (let t = 1.5; t <= len && ok; t += 1.5) ok = this.poseOK(K, x + c * t * dir, z + s * t * dir, yaw, 0.02);
      if (ok) return true;
    }
    return false;
  }
  blockedAt(K, x, z, yaw, y) {
    const hb = K.beam / 2, hl = K.len / 2 - hb * 0.9, c = Math.cos(yaw), s = Math.sin(yaw), f = boatFilter(y);
    for (const a of [hl, 0, -hl]) {
      const px = x + c * a, pz = z + s * a;
      if (G.phys.overlaps(px, pz, hb + 0.15, f)) return true;
      for (const d of G.decks || []) if (d.y < y + 1.6 && px > d.x0 - hb - 0.1 && px < d.x1 + hb + 0.1 && pz > d.z0 - hb - 0.1 && pz < d.z1 + hb + 0.1) return true;
    }
    return false;
  }
  /** somewhere to stand within reach of a boat at (x,z,yaw) — on land, a deck, or wading */
  boardSpot(K, x, z, yaw) { return this.landingSpot({ K, x, z, yaw, y: WATER_Y }, K.len / 2 + K.reach, K.reach - 0.3); }
  /**
   * Best spot to step out of a boat: walkable (ground, jetty, docked ship deck), not inside anything, not behind a wall,
   * dry land preferred over wading. maxR from the boat's centre, segMax from its centre line.
   */
  landingSpot(v, maxR = 5.2, segMax = 99) {
    const K = v.K, hb = K.beam / 2, hl = K.len / 2 - hb, c = Math.cos(v.yaw), s = Math.sin(v.yaw), W = G.W, vy = v.y ?? WATER_Y;
    const ax = v.x + c * hl, az = v.z + s * hl, bx = v.x - c * hl, bz = v.z - s * hl;
    let best = null, bs = 1e9;
    for (let r = hb + 0.5; r <= maxR + 1e-6; r += 0.45) {
      const n = Math.max(14, Math.round(r * 5));
      for (let i = 0; i < n; i++) {
        const a = (i + 0.5 * (Math.round(r * 2.2) % 2)) / n * Math.PI * 2, px = v.x + Math.cos(a) * r, pz = v.z + Math.sin(a) * r;
        const sd = segDist(px, pz, ax, az, bx, bz); if (sd < hb + 0.32 || sd > segMax) continue;
        if (!W.walkable(px, pz)) continue;
        const fy = Build.floorY(px, pz, vy + 5);
        if (fy < WATER_Y - 0.82 || fy - vy > 5.6) continue;
        if (G.phys.overlaps(px, pz, 0.38, standFilter(fy))) continue;
        const ship = !!(G.cargo && G.cargo.walkable && G.cargo.walkable(px, pz));
        if (!ship && !G.phys.los(v.x, v.z, px, pz, q => q.solid && !q.off && q.kind !== 'ship' && (q.y0 ?? -99) < vy + 1.4 && (q.y0 ?? 0) + (q.h ?? 3) > vy + 1.0)) continue;
        const wet = fy < WATER_Y - 0.05 ? 1.2 + (WATER_Y - fy) * 3 : 0;
        const sc = r + wet + (ship ? 0.4 : 0);
        if (sc < bs) { bs = sc; best = { x: px, z: pz, y: fy, ship }; }
      }
      if (best && bs <= r + 0.45) break; // nothing further out can beat it
    }
    return best;
  }
  /** washed ashore: the nearest dry walkable ground (wrecks and drownings far out at sea) */
  shoreSpot(v, maxR = 420) {
    const W = G.W;
    for (let r = 4; r <= maxR; r += 3) {
      const n = Math.min(72, Math.max(16, Math.round(r * 0.9))), a0 = r * 0.37;
      for (let i = 0; i < n; i++) {
        const a = a0 + i / n * Math.PI * 2, px = v.x + Math.cos(a) * r, pz = v.z + Math.sin(a) * r;
        if (!W.walkable(px, pz)) continue; const fy = Build.floorY(px, pz);
        if (fy < WATER_Y - 0.2 || G.phys.overlaps(px, pz, 0.4, standFilter(fy))) continue;
        return { x: px, z: pz, y: fy };
      }
    }
    return null;
  }
  // ---------------------------------------------------------------- per frame
  update(dt) {
    const guest = !!(G.net && G.net.role === 'guest');
    const P = G.player, cam = G.rend && G.rend.camera ? G.rend.camera.position : P;
    const fogFar = (G.rend && G.rend.scene && G.rend.scene.fog ? G.rend.scene.fog.far : 250) + 70;
    for (const v of this.list) {
      if (v.dead) { if (v.boat && v.sinkT !== undefined) this.sink(v, dt); if (!guest && G.t > v.respawnAt) this.respawn(v); continue; }
      if (v.driver && v.driver.dead) this.exit(v.driver, false);
      // co-op: a friend is driving it (their phone moves it), or (on a guest) the host's world moves it
      if (v.netDriver != null && !v.driver) {
        const age = performance.now() / 1000 - (v.stT || 0);
        if (age < 0.6) continue;                                   // moved by the driver's own updates
        if (!guest) { if (age > 4) v.netDriver = null; else continue; } // host: they went quiet; free it after a while
      }
      if (guest && v.driver !== P) { this.netRest(v, dt, cam, fogFar); continue; }
      if (v.boat) { this.boatTick(v, dt, cam, fogFar); if (v.driver === P) this.carry(v, P, dt); continue; }
      if (v.driver) { if (v.kind === 'buggy') this.driveBuggy(v, dt); else this.flyHeli(v, dt); }
      else if (v.kind === 'heli' && v.y > G.W.height(v.x, v.z) + 0.1) this.flyHeli(v, dt); // abandoned in the air: it drops
      else if (Math.abs(v.speed) > 0.05) this.driveBuggy(v, dt);
      else v.rpm = Math.max(0, v.rpm - dt * 0.5);
      this.animate(v, dt);
      if (v.driver === P) this.carry(v, P, dt);
    }
    // engine sounds + noise for the AI
    const d = P && P.vehicle;
    if (d) {
      this.sndT -= dt;
      if (d.kind === 'buggy' && this.sndT <= 0) { this.sndT = 0.11; const k = Math.min(1, Math.abs(d.speed) / 18); Sfx.noise(0.14, 90 + k * 220, 2, 0.05 + k * 0.05, 'lowpass'); }
      if (d.kind === 'heli' && this.sndT <= 0) { this.sndT = lerp(0.2, 0.075, d.rpm); Sfx.noise(0.07, 160 + d.rpm * 80, 1.5, 0.07 * d.rpm + 0.02, 'lowpass'); }
      if (d.kind === 'motorboat' && this.sndT <= 0 && d.rpm > 0.05) {
        const k = d.rpm; this.sndT = lerp(0.12, 0.065, k);
        Sfx.noise(0.12, 140 + k * 320, 2.2, 0.03 + k * 0.06, 'bandpass'); Sfx.tone(46 + k * 66, 0.1, 0.018 + k * 0.026, 'sawtooth', 0, 1.04);
        if (Math.abs(d.speed) > 6 && chance(0.3)) Sfx.noise(0.35, 900, 0.6, 0.035, 'lowpass', 0, 0.5); // hull slap
      }
      if (d.boat && (this.lapT = (this.lapT || 0) - dt) <= 0) { this.lapT = rand(1.4, 3.2); Sfx.noise(0.7, 460, 0.7, 0.03, 'lowpass', 0, 0.6); } // water lapping
      if ((this.noiseT -= dt) <= 0) { this.noiseT = 1; const r = d.kind === 'heli' ? 45 : d.kind === 'motorboat' ? 6 + d.K.noise * d.rpm : d.boat ? d.K.noise : 28; if (G.onNoise) G.onNoise(d.x, d.z, r, P); }
    }
  }
  /** keep the player in the seat; turning the vehicle turns your view with it */
  carry(v, P, dt) {
    const s = v.K.seat, cs = Math.cos(v.yaw), sn = Math.sin(v.yaw);
    P.x = v.x + s[0] * cs - s[2] * sn; P.z = v.z + s[0] * sn + s[2] * cs; P.y = v.y + s[1] + (v.boat ? Math.sin(v.pitch) * s[0] : 0);
    if (v.kind !== 'heli') P.yaw += angDiff(v.lastYaw ?? v.yaw, v.yaw); // your view turns with the car / boat (the heli turns with your view)
    v.lastYaw = v.yaw;
    P.eye = v.K.eye; P.airY = 0; P.vy = 0; P.speedNow = Math.hypot(v.vx, v.vz) || Math.abs(v.speed);
    void dt;
  }
  // ---------------------------------------------------------------- buggy
  driveBuggy(v, dt) {
    const P = v.driver; let thr = 0, st = 0;
    if (P && !G.uiBlock) { const mv = Input().moveVec(); thr = mv.y; st = mv.x; }
    if (v.fuel <= 0 && thr !== 0) { thr = 0; if (!v.dryT || G.t > v.dryT) { v.dryT = G.t + 4; G.ui.toast('Out of fuel — carry low-grade fuel and get back in', 'bad'); } }
    const W = G.W, h0 = W.height(v.x, v.z), b = W.biomeAt(v.x, v.z);
    const road = W.isRoad(v.x, v.z) || W.isFlat(v.x, v.z);
    const vmax = h0 < -0.25 ? 4 : road ? 21 : b === 1 ? 10 : b === 5 ? 9 : 14;
    if (thr > 0.05) { v.speed += thr * (v.speed < -0.3 ? 14 : 7.5) * dt; v.fuel -= v.K.burn * dt * thr; }
    else if (thr < -0.05) { if (v.speed > 0.4) v.speed -= 16 * dt * -thr; else v.speed = Math.max(-6, v.speed + thr * 5 * dt); v.fuel -= v.K.burn * dt * 0.5; }
    else v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 3.2 * dt);
    if (Math.abs(v.speed) > vmax) v.speed += (Math.sign(v.speed) * vmax - v.speed) * Math.min(1, dt * 2.5);
    v.speed -= Math.sin(v.pitch) * 7 * dt;                         // hills
    v.fuel = Math.max(0, v.fuel); v.rpm = lerp(v.rpm, P ? 0.35 + Math.min(1, Math.abs(v.speed) / 18) * 0.65 : 0, dt * 3);
    v.steer += (st - v.steer) * Math.min(1, dt * 6);
    const turn = v.steer * clamp(v.speed / 5, -1, 1) * 1.35 * (1 - 0.4 * Math.min(1, Math.abs(v.speed) / 21));
    v.yaw += turn * dt;
    // move with collisions (deep water stops you)
    const dx = Math.cos(v.yaw) * v.speed * dt, dz = Math.sin(v.yaw) * v.speed * dt;
    if (W.height(v.x + dx * 4, v.z + dz * 4) < -0.85) { if (Math.abs(v.speed) > 2 && P === G.player) G.ui.toast('Too deep to drive'); v.speed *= -0.2; }
    else {
      const p = { x: v.x, z: v.z }; const bumped = G.phys.move(p, dx, dz, v.K.r, c => SOLID(c) && (c.top === undefined || (c.y0 ?? -99) < v.y + 1.4));
      const want = Math.hypot(dx, dz), got = Math.hypot(p.x - v.x, p.z - v.z);
      if (bumped && got < want * 0.6) { const hit = Math.abs(v.speed); if (hit > 5) this.damage(v, hit * 3.2, 'crash'); if (hit > 2) Sfx.noise(0.25, 260, 1, Math.min(0.5, hit / 30), 'lowpass'); v.speed *= -0.25; }
      v.x = p.x; v.z = p.z;
    }
    this.place(v);
    this.runOver(v, Math.abs(v.speed), Math.cos(v.yaw), Math.sin(v.yaw));
  }
  // ---------------------------------------------------------------- minicopter
  flyHeli(v, dt) {
    const P = v.driver; let fwd = 0, side = 0, lift = 0;
    const engine = !!P && v.fuel > 0;
    if (P && !G.uiBlock) {
      const I = Input(), mv = I.moveVec(); fwd = mv.y; side = mv.x;
      lift = (I.held.jump || I.held.up ? 1 : 0) - (I.held.crouch || I.held.down ? 1 : 0);
      // the nose follows where you look
      v.yaw += clamp(angDiff(v.yaw, P.yaw), -dt * 1.6, dt * 1.6);
    }
    v.rpm = clamp(v.rpm + (engine ? dt * 0.55 : -dt * 0.35), 0, 1);
    if (engine) v.fuel = Math.max(0, v.fuel - v.K.burn * dt * (0.5 + v.rpm * 0.5));
    if (P && v.fuel <= 0 && (!v.dryT || G.t > v.dryT)) { v.dryT = G.t + 5; G.ui.toast('Out of fuel! You\'re coming down…', 'bad'); }
    const ground = G.W.height(v.x, v.z), gy = Math.max(ground, -0.05), up = v.rpm > 0.8;
    const landed = v.y <= gy + 0.02;
    if (up) {
      const cs = Math.cos(v.yaw), sn = Math.sin(v.yaw);
      v.vx += (cs * fwd * 8 - sn * side * 5.5) * dt; v.vz += (sn * fwd * 8 + cs * side * 5.5) * dt;
      v.vy += (lift * 6.5 - v.vy * 2.2) * dt;
      if (landed && lift <= 0) v.vy = Math.max(0, v.vy);
    } else v.vy -= (P ? 2 : 9) * dt;                                  // spooling / unpowered: settle or fall
    const drag = landed ? 6 : 0.8; v.vx -= v.vx * Math.min(1, drag * dt); v.vz -= v.vz * Math.min(1, drag * dt);
    const hs = Math.hypot(v.vx, v.vz); if (hs > 26) { v.vx *= 26 / hs; v.vz *= 26 / hs; }
    // horizontal move with obstacle checks at our height
    const nx = v.x + v.vx * dt, nz = v.z + v.vz * dt; let blocked = null;
    G.phys.query(nx - v.K.r, nz - v.K.r, nx + v.K.r, nz + v.K.r, c => {
      if (c.off || !c.solid) return; const top = (c.y0 ?? G.W.height(nx, nz)) + (c.h || 3); if (top < v.y + 0.25) return;
      const px = c.t === 'c' ? c.x : clamp(nx, c.x0, c.x1), pz = c.t === 'c' ? c.z : clamp(nz, c.z0, c.z1); const rr = c.t === 'c' ? c.r + v.K.r * 0.8 : v.K.r * 0.8;
      if ((px - nx) ** 2 + (pz - nz) ** 2 < rr * rr) { blocked = c; return false; }
    });
    if (blocked) { const sp = Math.hypot(v.vx, v.vz); if (sp > 6) this.damage(v, sp * 4, 'crash'); if (sp > 2) Sfx.noise(0.3, 300, 1, Math.min(0.5, sp / 30), 'lowpass'); v.vx *= -0.3; v.vz *= -0.3; }
    else { v.x = clamp(nx, 5, G.W.size - 5); v.z = clamp(nz, 5, G.W.size - 5); }
    v.y = Math.min(140, v.y + v.vy * dt);
    const g2 = Math.max(G.W.height(v.x, v.z), -0.05);
    if (v.y < g2) { if (v.vy < -7) this.damage(v, -v.vy * 10, 'crash'); v.y = g2; v.vy = Math.max(0, v.vy); }
    // body attitude: nose down to go forward, bank into sideways motion
    const cs = Math.cos(v.yaw), sn = Math.sin(v.yaw), lf = v.vx * cs + v.vz * sn, ls = -v.vx * sn + v.vz * cs;
    v.pitch += (clamp(-lf * 0.016, -0.32, 0.32) - v.pitch) * Math.min(1, dt * 3);
    v.roll += (clamp(ls * 0.03, -0.35, 0.35) - v.roll) * Math.min(1, dt * 3);
    if (v.y <= g2 + 0.02) { v.pitch *= 0.8; v.roll *= 0.8; }
    v.mesh.root.position.set(v.x, v.y, v.z);
    v.mesh.root.rotation.set(0, -v.yaw, 0); v.mesh.root.rotateZ(v.pitch); v.mesh.root.rotateX(v.roll);
    if (v.y < g2 + 3) this.runOver(v, hs, cs, sn);
  }
  // ---------------------------------------------------------------- boats
  /**
   * How much the hull sits on the bottom at a pose: mean metres of missing depth under it, plus a share of the
   * worst point (so a bow can't climb a steep bank or a monument's edge). 0 = afloat; 0.35+ = high and dry.
   */
  groundRaw(K, x, z, yaw) {
    const H = G.W.height, hl = K.len / 2, hb = K.beam / 2, c = Math.cos(yaw), s = Math.sin(yaw); let g = 0, mx = 0;
    for (const [a, b] of HULL_PTS) { const d = Math.max(0, H(x + c * a * hl - s * b * hb, z + s * a * hl + c * b * hb) + K.draft); g += d; if (d > mx) mx = d; }
    return g / HULL_PTS.length + mx * 0.3;
  }
  /** 0 = afloat, 1 = aground */
  grounding(K, x, z, yaw) { return clamp(this.groundRaw(K, x, z, yaw) / 0.35, 0, 1); }
  /** swell height: open sea rolls more than lakes and rivers */
  seaAmp(x, z) { return G.W.biomeAt(x, z) === 0 ? 1 : 0.3; }
  boatTick(v, dt, cam, fogFar) {
    const d = cam ? Math.hypot(v.x - cam.x, v.z - cam.z) : 0; v.near = d;
    const moving = !!v.driver || Math.hypot(v.vx, v.vz) > 0.04 || Math.abs(v.yawRate) > 0.01;
    // the cargo ship shoves boats out of its way (moving or docked)
    const S = G.cargo; if (S && S.phase !== 'gone' && (v.x - S.x) ** 2 + (v.z - S.z) ** 2 < 52 * 52) this.shipShove(v, dt);
    if (moving) this.driveBoat(v, dt);
    v.mesh.root.visible = d < fogFar || !!v.driver;
    if (!v.driver && !moving && d > 170) return; // far away and at rest: skip the bobbing
    if (moving && (v.ampT = (v.ampT || 0) - dt) <= 0) { v.ampT = 1; v.amp = this.seaAmp(v.x, v.z); }
    this.floatBoat(v, dt, false);
    this.animateBoat(v, dt);
  }
  driveBoat(v, dt) {
    const K = v.K, P = v.driver, motor = v.kind === 'motorboat'; let thr = 0, st = 0;
    if (P && !G.uiBlock) { const mv = Input().moveVec(); thr = mv.y; st = mv.x; }
    if (motor && v.fuel <= 0 && thr !== 0) { thr = 0; if (P === G.player && (!v.dryT || G.t > v.dryT)) { v.dryT = G.t + 4; G.ui.toast('Out of fuel — carry low-grade fuel and get back in', 'bad'); } }
    v.thr = thr; v.steer += (st - v.steer) * Math.min(1, dt * 5);
    let f0 = v.vx * Math.cos(v.yaw) + v.vz * Math.sin(v.yaw), yawT = 0, push = 0;
    const g = v.ground || 0;
    if (motor) {
      const auth = Math.min(1, clamp(Math.abs(f0) / 4, 0, 1) * 0.85 + Math.abs(thr) * 0.35);
      yawT = v.steer * K.turn * auth * (1 - 0.3 * clamp(Math.abs(f0) / K.vmax, 0, 1)) * (f0 < -0.3 ? -1 : 1);
      if (thr > 0.05) { push = thr * K.acc * (f0 < -0.3 ? 2 : 1); v.fuel -= K.burn * dt * thr; }
      else if (thr < -0.05) { push = f0 > 0.4 ? -7 * -thr : thr * 3; v.fuel -= K.burn * dt * 0.4; }
      v.fuel = Math.max(0, v.fuel);
      v.rpm = lerp(v.rpm, P && v.fuel > 0 ? 0.22 + 0.78 * Math.abs(thr) : 0, Math.min(1, dt * 3));
    } else {
      // rowing: each oar has its own effort; differential strokes turn the boat (even on the spot)
      const eL = P ? clamp(thr + st * 0.85, -1, 1) : 0, eR = P ? clamp(thr - st * 0.85, -1, 1) : 0;
      v.eL = Math.abs(eL) > 0.05 ? eL : 0; v.eR = Math.abs(eR) > 0.05 ? eR : 0;
      const pL = v.mesh.pulse(-1), pR = v.mesh.pulse(1);
      push = (v.eL * pL + v.eR * pR) / 2 * K.acc;
      yawT = (v.eL * pL - v.eR * pR) / 2 * K.turn * (1 - 0.3 * clamp(Math.abs(f0) / K.vmax, 0, 1));
      v.rpm = (Math.abs(v.eL) + Math.abs(v.eR)) / 2;
    }
    // turn first: the velocity keeps its direction, so the hull slides a little through turns
    v.yawRate += (yawT - v.yawRate) * Math.min(1, dt * (motor ? 3 : 2.4));
    if (v.yawRate) { // a grounded hull can't swing itself further up the bank
      const y1 = v.yaw + v.yawRate * dt, g0 = this.groundRaw(K, v.x, v.z, v.yaw), g1 = this.groundRaw(K, v.x, v.z, y1);
      if (g1 > 0.2 && g1 > g0 - 0.0001) v.yawRate *= -0.2; else v.yaw = y1;
    }
    const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
    let f = v.vx * c + v.vz * s, l = -v.vx * s + v.vz * c;
    f += push * (1 - (v.deeper ? 0.15 : 0.55) * g) * dt;
    f -= f * K.drag * dt; if (Math.abs(push) < 0.01) f -= Math.sign(f) * Math.min(Math.abs(f), (motor ? 0.6 : 0.45) * dt);
    const vmax = K.vmax * (1 - (v.deeper ? 0.3 : 0.7) * g);
    if (f > vmax) f += (vmax - f) * Math.min(1, dt * 2.5); if (f < -K.vrev) f += (-K.vrev - f) * Math.min(1, dt * 2.5);
    l *= Math.exp(-K.grip * dt);
    if (!P && Math.abs(f) < 0.04 && Math.abs(l) < 0.04) { f = 0; l = 0; }
    v.vx = f * c - l * s; v.vz = f * s + l * c; v.speed = f; v.lat = l;
    if (!P) v.yawRate *= Math.exp(-2 * dt);
    this.moveBoat(v, dt);
    v.speed = v.vx * Math.cos(v.yaw) + v.vz * Math.sin(v.yaw);
    if (Math.abs(v.speed) > 3.5) this.runOver(v, Math.hypot(v.vx, v.vz), Math.cos(v.yaw), Math.sin(v.yaw));
  }
  /** move through the water: shallows slow and stop the hull, colliders push it back */
  moveBoat(v, dt) {
    const K = v.K, W = G.W, dx = v.vx * dt, dz = v.vz * dt, n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.3));
    let g0 = this.groundRaw(K, v.x, v.z, v.yaw), aground = false, impact = 0, hitN = null, deeper = false;
    for (let i = 0; i < n; i++) {
      const nx = clamp(v.x + dx / n, 8, W.size - 8), nz = clamp(v.z + dz / n, 8, W.size - 8);
      const g1 = this.groundRaw(K, nx, nz, v.yaw);
      if (g1 > 0.2 && g1 > g0 - 0.0001) { aground = true; break; } // stuck: it only lets you go where it gets deeper
      if (dx || dz) deeper = g1 < g0 - 0.00005;
      v.x = nx; v.z = nz; g0 = g1;
      const hit = this.collideBoat(v);
      if (hit) { const vn = v.vx * hit.nx + v.vz * hit.nz; if (vn < 0) { if (-vn > impact) { impact = -vn; hitN = hit; } v.vx -= 1.25 * vn * hit.nx; v.vz -= 1.25 * vn * hit.nz; } }
    }
    v.ground = clamp(g0 / 0.35, 0, 1); v.deeper = deeper;
    if (aground) {
      const sp = Math.hypot(v.vx, v.vz);
      if (sp > 8) this.damage(v, (sp - 7) * 3, 'crash');
      if (sp > 2) Sfx.noise(0.35, 380, 0.8, Math.min(0.35, sp / 30), 'lowpass', 0, 0.5);
      v.vx *= 0.08; v.vz *= 0.08;
      if (v.driver === G.player && sp > 0.8 && (!v.agT || G.t > v.agT)) { v.agT = G.t + 5; G.ui.toast('Aground — back off into deeper water'); }
    }
    const k = Math.exp(-dt * (deeper ? 0.7 : 3.2) * v.ground); v.vx *= k; v.vz *= k; // dragging through the shallows (pushing off is easier)
    if (impact > 1.5) {
      Sfx.noise(0.25, 300, 1, Math.min(0.5, impact / 25), 'lowpass');
      if (impact > 5.5) this.damage(v, (impact - 4) * 5, 'crash');
      if (hitN && hitN.boat && impact > 5.5) this.damage(hitN.boat, (impact - 4) * 4, 'crash');
    }
  }
  /** push a boat out of whatever it overlaps; returns the push normal or null */
  collideBoat(v) {
    const K = v.K, hb = K.beam / 2, hl = K.len / 2 - hb * 0.9, c = Math.cos(v.yaw), s = Math.sin(v.yaw), f = boatFilter(v.y);
    let tx = 0, tz = 0, other = null;
    for (const a of [hl, 0, -hl]) {
      const p = { x: v.x + c * a, z: v.z + s * a }, ox = p.x, oz = p.z;
      G.phys.resolve(p, hb, f);
      for (const d of G.decks || []) {
        if (d.y > v.y + 1.6 || d.y < v.y - 0.8 || p.x < d.x0 - hb || p.x > d.x1 + hb || p.z < d.z0 - hb || p.z > d.z1 + hb) continue;
        const qx = clamp(p.x, d.x0, d.x1), qz = clamp(p.z, d.z0, d.z1); let ddx = p.x - qx, ddz = p.z - qz; const d2 = ddx * ddx + ddz * ddz;
        if (d2 >= hb * hb) continue;
        if (d2 > 1e-8) { const L = Math.sqrt(d2), k = (hb - L) / L; p.x += ddx * k; p.z += ddz * k; }
        else { const l = p.x - d.x0, r = d.x1 - p.x, t = p.z - d.z0, b = d.z1 - p.z, m = Math.min(l, r, t, b); if (m === l) p.x = d.x0 - hb; else if (m === r) p.x = d.x1 + hb; else if (m === t) p.z = d.z0 - hb; else p.z = d.z1 + hb; }
      }
      this.shipPush(p, hb);
      const ddx = p.x - ox, ddz = p.z - oz;
      if (ddx || ddz) { v.x += ddx; v.z += ddz; tx += ddx; tz += ddz; }
    }
    // other boats: capsule against capsule; a parked boat gets shoved more than you
    for (const o of this.list) {
      if (o === v || !o.boat || o.dead) continue;
      const R2 = (K.len + o.K.len) / 2 + 0.5; if ((o.x - v.x) ** 2 + (o.z - v.z) ** 2 > R2 * R2) continue;
      const ob = o.K.beam / 2, ol = o.K.len / 2 - ob * 0.9, oc = Math.cos(o.yaw), os = Math.sin(o.yaw);
      const [dd, pax, paz, pbx, pbz] = segSeg(v.x + c * hl, v.z + s * hl, v.x - c * hl, v.z - s * hl, o.x + oc * ol, o.z + os * ol, o.x - oc * ol, o.z - os * ol);
      const need = hb + ob; if (dd >= need) continue;
      let nx = pax - pbx, nz = paz - pbz; const L = Math.hypot(nx, nz); if (L < 1e-5) { nx = v.x - o.x; nz = v.z - o.z; const L2 = Math.hypot(nx, nz) || 1; nx /= L2; nz /= L2; } else { nx /= L; nz /= L; }
      const pen = need - dd, mine = o.driver ? 0.5 : 0.3;
      v.x += nx * pen * mine; v.z += nz * pen * mine; tx += nx * pen * mine; tz += nz * pen * mine;
      o.x -= nx * pen * (1 - mine); o.z -= nz * pen * (1 - mine);
      const rel = (v.vx - o.vx) * nx + (v.vz - o.vz) * nz;
      if (rel < 0) { o.vx += nx * rel * 0.7; o.vz += nz * rel * 0.7; o.yawRate += (Math.random() - 0.5) * Math.min(0.6, -rel * 0.08); }
      other = o;
    }
    if (!tx && !tz) return null;
    const L = Math.hypot(tx, tz); return { nx: tx / L, nz: tz / L, boat: other };
  }
  /** keep a point (with radius r) out of the cargo ship's hull outline */
  shipPush(p, r) {
    const S = G.cargo; if (!S || S.phase === 'gone' || !S.toLocal) return false;
    if ((p.x - S.x) ** 2 + (p.z - S.z) ** 2 > 50 * 50) return false;
    const [u, w] = S.toLocal(p.x, p.z), U0 = -38.4, U1 = 37.4;
    if (u < U0 - r || u > U1 + r) return false;
    const hw = u > 26 ? Math.max(0, 7.25 * (U1 - u) / (U1 - 26)) : 7.25, ew = hw + r;
    if (Math.abs(w) >= ew) return false;
    const side = ew - Math.abs(w), aft = u - (U0 - r), fwd = (U1 + r) - u; let du = 0, dw = 0;
    if (side <= aft && side <= fwd) dw = Math.sign(w || 1) * side; else if (aft < fwd) du = -aft; else du = fwd;
    const c = Math.cos(S.yaw), s = Math.sin(S.yaw); p.x += du * c - dw * s; p.z += du * s + dw * c;
    return true;
  }
  /** a moving (or docking) ship pushes boats aside, even parked ones */
  shipShove(v, dt) {
    const K = v.K, hb = K.beam / 2, hl = K.len / 2 - hb * 0.9, c = Math.cos(v.yaw), s = Math.sin(v.yaw);
    let tx = 0, tz = 0;
    for (const a of [hl, 0, -hl]) { const p = { x: v.x + c * a, z: v.z + s * a }, ox = p.x, oz = p.z; if (this.shipPush(p, hb)) { v.x += p.x - ox; v.z += p.z - oz; tx += p.x - ox; tz += p.z - oz; } }
    if (tx || tz) { const k = Math.min(4, Math.hypot(tx, tz) / Math.max(dt, 1e-3)) / (Math.hypot(tx, tz) || 1) * 0.5; v.vx += tx * k; v.vz += tz * k; v.yawRate += (Math.random() - 0.5) * 0.2; }
  }
  /** sit the boat on the water (or on the bottom where it's beached): bob, pitch with the swell and planing, lean into turns */
  floatBoat(v, dt, snap) {
    const K = v.K, H = G.W.height, c = Math.cos(v.yaw), s = Math.sin(v.yaw), hl = K.len * 0.4, hb = K.beam * 0.42, t = (G.t || 0) + v.ph;
    const amp = v.amp * (1 + (G.weather || 0) * 0.9), wy0 = WATER_Y - 0.03;
    const pt = (a, b) => { const px = v.x + c * a - s * b, pz = v.z + s * a + c * b; return Math.max(wy0 + amp * wave(px, pz, t), H(px, pz) + K.keel); };
    const yb = pt(hl, 0), ys = pt(-hl, 0), yl = pt(0, -hb), yr = pt(0, hb);
    let y = (yb + ys + yl + yr) / 4 - (v.driver ? 0.035 : 0);
    let pitch = Math.atan2(yb - ys, 2 * hl), roll = Math.atan2(yl - yr, 2 * hb); // + roll = starboard side down (rotateX)
    const f = v.speed || 0;
    if (v.kind === 'motorboat') { pitch += 0.075 * clamp(f / 5, 0, 1) * (1 - 0.45 * clamp((f - 9) / 6, 0, 1)) + (v.thr > 0.3 && f < 7 ? 0.025 * v.thr : 0); y += 0.04 * clamp((f - 8) / 6, 0, 1); }
    else if (v.rpm > 0.05) pitch += 0.012 * Math.sin((v.mesh.oars[0].phase || 0));
    roll += clamp(v.yawRate * f * (v.kind === 'motorboat' ? 0.02 : 0.03), -0.22, 0.22);
    if (snap) { v.y = y; v.pitch = pitch; v.roll = roll; }
    else { const k = Math.min(1, dt * 6); v.y += (y - v.y) * Math.min(1, dt * 8); v.pitch += (pitch - v.pitch) * k; v.roll += (roll - v.roll) * k; }
    v.beached = H(v.x, v.z) + K.keel > wy0;
    const r = v.mesh.root; r.position.set(v.x, v.y, v.z); r.rotation.set(0, -v.yaw, 0); r.rotateZ(v.pitch); r.rotateX(v.roll);
  }
  animateBoat(v, dt) {
    const m = v.mesh;
    if (v.kind === 'rowboat') m.animate(dt, { mode: v.driver ? (v.eL || v.eR ? 'row' : 'idle') : 'shipped', eL: v.eL || 0, eR: v.eR || 0, onCatch: side => this.oarCatch(v, side) });
    else m.animate(dt, { rpm: v.rpm, steer: v.steer, rev: v.thr < -0.05 && v.speed < 0.4, beached: !v.driver && v.beached });
    if (v.near < 230) boatFx(m, dt, { x: v.x, z: v.z, yaw: v.yaw, speed: v.speed, rpm: v.rpm, t: G.t, wy: WATER_Y - 0.05, near: v.near });
  }
  oarCatch(v, side) {
    if (v.near > 60) return;
    oarSplash(v.mesh, side, v.x, v.z, v.yaw, WATER_Y - 0.05);
    const vol = Sfx.vol(v.x, v.z, 40); Sfx.noise(0.22, 780, 0.9, 0.07 * vol, 'lowpass', 0, 0.55);
    if (chance(0.25)) Sfx.tone(rand(230, 290), 0.12, 0.025 * vol, 'triangle', 0.05, 0.85); // oarlock creak
  }
  /** a wrecked boat goes down by the stern, bubbling */
  sink(v, dt) {
    v.sinkT += dt; const t = v.sinkT;
    v.y -= dt * (0.12 + t * 0.07); v.pitch += (-0.45 - v.pitch) * Math.min(1, dt * 0.8); v.roll += (0.3 - v.roll) * Math.min(1, dt * 0.6);
    const floor = G.W.height(v.x, v.z) - 0.4; if (v.y < floor) v.y = floor;
    const r = v.mesh.root; r.position.set(v.x, v.y, v.z); r.rotation.set(0, -v.yaw, 0); r.rotateZ(v.pitch); r.rotateX(v.roll);
    if (v.mesh.wake) v.mesh.wake.update(G.t);
    const F = G.fx;
    if (F && v.near < 120) {
      v._bub = (v._bub || 0) + dt * (t < 5 ? 26 : 8);
      while (v._bub >= 1) { v._bub -= 1; const a = Math.random() * 6.28, rr = Math.random() * v.K.beam * 0.6; F.emit({ x: v.x + Math.cos(a) * rr, y: WATER_Y - 0.02, z: v.z + Math.sin(a) * rr, vx: (Math.random() - 0.5) * 0.4, vy: 0.5 + Math.random() * 0.9, vz: (Math.random() - 0.5) * 0.4, life: 0.5 + Math.random() * 0.4, size: 0.1 + Math.random() * 0.1, size1: 0.22, r: 0.88, g: 0.97, b: 1, a: 0.9, a1: 0 }); }
      if (v.kind === 'motorboat' && t < 3) F.fire(v.x - Math.cos(v.yaw) * 2, Math.max(v.y + 0.5, WATER_Y + 0.2), v.z - Math.sin(v.yaw) * 2, 1);
    }
    if (t > 9) { this.scene.remove(v.mesh.root); v.sinkT = undefined; }
  }
  // ---------------------------------------------------------------- shared
  /** sit the buggy on the terrain (pitch from front/back, roll from left/right wheels) */
  place(v) {
    if (v.boat) return this.floatBoat(v, 0, true);
    if (v.kind !== 'buggy') { v.mesh.root.position.set(v.x, v.y, v.z); v.mesh.root.rotation.set(0, -v.yaw, 0); return; }
    const H = (x, z) => Math.max(G.W.height(x, z), -0.6), cs = Math.cos(v.yaw), sn = Math.sin(v.yaw);
    const hf = H(v.x + cs * 1.3, v.z + sn * 1.3), hb = H(v.x - cs * 1.3, v.z - sn * 1.3);
    const hl = H(v.x + sn * 0.95, v.z - cs * 0.95), hr = H(v.x - sn * 0.95, v.z + cs * 0.95);
    v.y = (hf + hb + hl + hr) / 4; v.pitch = Math.atan2(hf - hb, 2.6); v.roll = Math.atan2(hr - hl, 1.9);
    v.mesh.root.position.set(v.x, v.y, v.z);
    v.mesh.root.rotation.set(0, -v.yaw, 0); v.mesh.root.rotateZ(v.pitch); v.mesh.root.rotateX(v.roll);
  }
  animate(v, dt) {
    const m = v.mesh;
    if (v.boat) return this.animateBoat(v, dt);
    if (v.kind === 'buggy') {
      const spin = v.speed * dt / 0.48; for (const w of m.wheels) w.rotation.z -= spin;
      for (const p of m.pivots) p.rotation.y = -v.steer * 0.45;
      if (m.lights) m.lights.visible = (!!v.driver || v.netDriver != null) && G.night > 0.4;
    } else {
      m.rotor.rotation.y += dt * v.rpm * 38; m.tail.rotation.z += dt * v.rpm * 60;
      m.blur.visible = v.rpm > 0.6; m.blades.visible = v.rpm <= 0.6;
    }
  }
  /** run people over */
  runOver(v, sp, cs, sn) {
    if (sp < 3.5) return; const r = v.boat ? v.K.beam / 2 + 0.8 : v.kind === 'buggy' ? 1.9 : 2.4;
    for (const a of G.actors) {
      if (a.dead || a === v.driver || a.heli || (a.x - v.x) ** 2 + (a.z - v.z) ** 2 > (v.boat ? (v.K.len / 2 + 0.6) ** 2 : r * r)) continue;
      if (v.kind === 'heli' && Math.abs(a.y + 1 - v.y) > 2.2) continue;
      if (v.boat) { if (Math.abs((a.y ?? 0) - v.y) > 1.6) continue; const hl = v.K.len / 2 - v.K.beam / 2; if (segDist(a.x, a.z, v.x + cs * hl, v.z + sn * hl, v.x - cs * hl, v.z - sn * hl) > r) continue; }
      if ((v.hitT.get(a) || 0) > G.t) continue; v.hitT.set(a, G.t + 1);
      hurt(a, sp * (v.kind === 'buggy' ? 4.5 : 3), { owner: v.driver, kind: 'vehicle', dir: Math.atan2(a.z - v.z, a.x - v.x) });
      const ang = Math.atan2(a.z - v.z, a.x - v.x); a.x += Math.cos(ang) * 1.6; a.z += Math.sin(ang) * 1.6; if (a.st) a.st.flinch = 1;
      if (v.kind === 'buggy') v.speed *= 0.82; if (v.boat) { v.vx *= 0.85; v.vz *= 0.85; } Sfx.hit(a.x, a.z);
    }
  }
  damage(v, n, why) {
    if (v.dead || !(n > 0)) return;
    if (v.driver === G.player && G.rend) G.rend.shake = Math.max(G.rend.shake, Math.min(1.4, n / 40));
    if (G.net && G.net.role === 'guest') { G.net.send({ t: 'vdmg', nid: v.nid, n: Math.round(n * 10) / 10, why: why || '' }); return; } // the host owns vehicle health
    v.hp -= n;
    if (v.hp <= 0) this.wreck(v, why);
  }
  /** explosions hurt vehicles too */
  blast(x, z, r, dmg) { for (const v of this.list) if (!v.dead && dist(x, z, v.x, v.z) < r + 1.5) this.damage(v, dmg * 1.6 * (1 - dist(x, z, v.x, v.z) / (r + 1.5) * 0.6), 'explosion'); }
  wreck(v) {
    if (v.dead) return;
    const guest = !!(G.net && G.net.role === 'guest'); // a guest only shows it: the host's explosion is sent to everyone
    v.dead = true; v.hp = 0; const P = v.driver;
    if (P) this.exit(P, true);
    v.driver = null; v.netDriver = null; v.respawnAt = G.t + v.K.respawn;
    if (G.net && G.net.role === 'host') G.net.broadcast({ t: 'vwreck', nid: v.nid });
    if (v.boat) {
      // boats sink (the motorboat's fuel goes up first)
      v.sinkT = 0; v.vx = v.vz = 0; v.rpm = 0; v.eL = v.eR = 0; v.mesh.root.visible = true; if (v.mesh.wake) v.mesh.wake.clear();
      if (v.kind === 'motorboat') { if (!guest) explode(v.x, v.z, { r: 3.8, dmg: 45, struct: 30 }, null, 'hostile'); }
      else { Sfx.treefall(v.x, v.z); if (G.fx) G.fx.debris(v.x, v.y + 0.3, v.z, 'wood'); }
      Sfx.splash(v.x, v.z);
      return;
    }
    this.scene.remove(v.mesh.root);
    if (!guest) explode(v.x, v.z, { r: 4.5, dmg: 55, struct: 40 }, null, 'hostile');
    if (G.fx) for (let i = 0; i < 6; i++) G.fx.fire(v.x + rand(-1, 1), v.y + 0.6, v.z + rand(-1, 1), 1.2);
  }
  respawn(v) {
    const i = this.list.indexOf(v); if (i >= 0) this.list.splice(i, 1);
    const s = v.home;
    if (v.boat) { if (v.sinkT !== undefined) { this.scene.remove(v.mesh.root); v.sinkT = undefined; } }
    const busy = v.boat && this.list.some(o => o.boat && !o.dead && dist(o.x, o.z, s.x, s.z) < (o.K.len + v.K.len) / 2 + 0.5);
    const seen = dist(s.x, s.z, G.player.x, G.player.z) < 60 || (G.net && [...G.net.players.values()].some(q => q.actor && dist(s.x, s.z, q.actor.x, q.actor.z) < 60));
    if (seen || busy) { v.respawnAt = G.t + 60; this.list.push(v); return; }
    this.spawn(s);
  }
  // ---------------------------------------------------------------- getting in and out
  interacts(p, push) {
    for (const v of this.list) {
      if (v.dead || v.driver || v.netDriver != null) continue;
      if (v.boat) {
        const K = v.K, hl = K.len / 2 - K.beam / 2, c = Math.cos(v.yaw), s = Math.sin(v.yaw);
        if (Math.abs(p.x - v.x) > K.len || Math.abs(p.z - v.z) > K.len) continue;
        const d = segDist(p.x, p.z, v.x + c * hl, v.z + s * hl, v.x - c * hl, v.z - s * hl);
        if (d > K.reach || Math.abs(p.y - v.y) > 2.6) continue;
        push({ s: d * 0.5 - 0.3, kind: 'vehicle', o: { act: 'enter', v }, label: v.kind === 'rowboat' ? 'Row the rowboat' : 'Drive the motorboat · ' + Math.round(v.fuel) + ' fuel', icon: 'hand' });
        continue;
      }
      const d = dist(p.x, p.z, v.x, v.z); const reach = v.kind === 'heli' ? 3.4 : 3.0;
      if (d > reach || Math.abs(p.y - v.y) > 2.5) continue;
      push({ s: d * 0.5 - 0.3, kind: 'vehicle', o: { act: 'enter', v }, label: (v.kind === 'heli' ? 'Fly ' : 'Drive ') + v.K.name.toLowerCase() + ' · ' + Math.round(v.fuel) + ' fuel', icon: 'hand' });
    }
  }
  interact(p, o) {
    if (o.act === 'exit') return this.exit(p);
    const v = o.v; if (!v || v.dead || v.driver) return;
    if (v.netDriver != null) { G.ui.toast('Someone else is using that', 'bad'); return; }
    // top up from your pockets
    const room = Math.floor(v.K.fuel * 1.6 - v.fuel), have = p.inv.count('low_fuel');
    if (v.K.fuel > 0 && room > 0 && have > 0) { const n = Math.min(room, have); p.inv.take('low_fuel', n); v.fuel += n; G.ui.toast('Refuelled +' + n + ' low-grade fuel', 'good'); }
    v.driver = p; p.vehicle = v; v.lastYaw = v.yaw; v.rpm = Math.max(v.rpm, v.kind === 'buggy' ? 0.3 : v.rpm);
    if (v.boat) { p.yaw = v.yaw; p.pitch = -0.12; v.lastYaw = v.yaw; Sfx.splash(v.x, v.z); }
    if (G.vm) G.vm.hidden = true; document.body.classList.add('driving'); document.body.classList.toggle('flying', v.kind === 'heli');
    Sfx.noise(0.3, 200, 1, 0.15, 'lowpass');
    if (v.K.fuel > 0 && v.fuel <= 0) G.ui.toast('No fuel — find low-grade fuel (oil barrels, crates)', 'bad');
    else G.ui.toast(v.kind === 'heli' ? 'Look to steer · stick/WASD to fly · ▲ climb · ▼ descend (Space / C) · E to get out'
      : v.kind === 'rowboat' ? 'Stick/WASD to row · left/right to turn · pull back to back-water · E to get out'
        : v.kind === 'motorboat' ? 'Stick/WASD to drive · pull back to slow and reverse · E to get out near shore'
          : 'Stick/WASD to drive · pull back to brake and reverse · E to get out');
    if (G.onVehicle) G.onVehicle(v);
    if (G.net && G.net.role === 'guest') G.net.send({ t: 'venter', nid: v.nid }); // the host confirms (or turns us away if a friend got in first)
  }
  exit(p, forced = false) {
    const v = p.vehicle; if (!v) return;
    if (v.boat) { const ok = this.exitBoat(p, v, forced); if (ok) this.netExit(v); return ok; }
    const cs = Math.cos(v.yaw), sn = Math.sin(v.yaw);
    let x = v.x + sn * 2.4, z = v.z - cs * 2.4; if (G.phys.overlaps(x, z, 0.4) || !G.W.walkable(x, z)) { x = v.x - sn * 2.4; z = v.z + cs * 2.4; }
    const fall = v.y - G.W.height(x, z);
    p.x = x; p.z = z; p.y = Build.floorY(x, z); p.eye = 1.62; p.vehicle = null; v.driver = null;
    const sp = Math.hypot(v.vx, v.vz) || Math.abs(v.speed);
    if (!forced && (fall > 4 || sp > 8)) hurt(p, Math.max(0, fall - 4) * 9 + Math.max(0, sp - 8) * 3, { kind: 'fall' });
    if (forced) hurt(p, 25, { kind: 'explosion' });
    if (v.kind === 'buggy') v.speed *= 0.5;
    document.body.classList.remove('driving', 'flying');
    this.netExit(v);
  }
  /** step out onto the nearest walkable spot within ~5 m; refuse in deep water (wrecks and deaths wash you ashore) */
  exitBoat(p, v, forced) {
    const spot = this.landingSpot(v, 5.2);
    if (!spot && !forced && !p.dead) { if (p === G.player) { G.ui.toast(TOO_DEEP, 'bad'); Sfx.deny(); } return false; }
    let s = spot, swam = false;
    if (!s) { s = this.shoreSpot(v); swam = true; }
    if (!s) s = { x: v.x, z: v.z, y: Build.floorY(v.x, v.z) };
    const sp = Math.hypot(v.vx, v.vz);
    p.x = s.x; p.z = s.z; p.y = s.y; p.eye = 1.62; p.airY = 0; p.vy = 0; p.vehicle = null; v.driver = null;
    v.eL = v.eR = 0; v.thr = 0; v.steer = 0;
    if (p.dead && G.deathBag && dist(G.deathBag.x, G.deathBag.z, v.x, v.z) < 5 && !G.W.walkable(G.deathBag.x, G.deathBag.z)) {
      const bag = G.deathBag; bag.x = s.x; bag.z = s.z; bag.y = s.y; // your bag washes up where you would have
      if (bag.mesh) { bag.mesh.position.set(bag.x, bag.y, bag.z); if (G.cull) G.cull.add(bag.mesh, bag.x, bag.z, 'mid'); }
    }
    if (!forced && !p.dead && sp > 8) hurt(p, (sp - 8) * 3, { kind: 'fall' });
    if (forced && !p.dead) hurt(p, v.kind === 'motorboat' ? 25 : 8, { kind: 'explosion' });
    if (swam && !p.dead && p === G.player) G.ui.toast('You swam to the nearest shore', 'bad');
    if (!p.dead) Sfx.splash(p.x, p.z);
    document.body.classList.remove('driving', 'flying');
    return true;
  }
  // ---------------------------------------------------------------- co-op: one shared set of vehicles (the host's)
  byNid(nid) { return this.list.find(v => v.nid === nid) || null; }
  /** [nid, kind, x, y, z, yaw, pitch, roll, hp, fuel, dead, driver, colour] — boats float locally, so no y / tilt for them */
  netRec(v) {
    const N = G.net, me = N ? N.me : 0, r2 = q => Math.round(q * 100) / 100, r3 = q => Math.round(q * 1000) / 1000;
    const drv = v.driver === G.player ? me : v.netDriver != null ? v.netDriver : -1;
    return [v.nid, v.kind, r2(v.x), v.boat ? 0 : r2(v.y), r2(v.z), r3(v.yaw), v.boat ? 0 : r3(v.pitch), v.boat ? 0 : r3(v.roll), Math.ceil(v.hp), Math.round(v.fuel), v.dead ? 1 : 0, drv, v.col || 0];
  }
  netList() { return this.list.filter(v => !v.dead).map(v => this.netRec(v)); }
  /** guest, on joining: drop my own vehicles and take the host's */
  fromNet(list) {
    const P = G.player; if (P && P.vehicle) { P.vehicle.driver = null; P.vehicle = null; P.eye = 1.62; document.body.classList.remove('driving', 'flying'); }
    this.dispose();
    for (const r of Array.isArray(list) ? list : []) this.netApply(r);
  }
  /** guest: one vehicle record from the host */
  netApply(r) {
    if (!Array.isArray(r) || r.length < 12) return;
    const [nid, kind, x, y, z, yaw, pitch, roll, hp, fuel, dead, drv, col] = r;
    if (!KINDS[kind] || ![x, y, z, yaw].every(Number.isFinite)) return;
    let v = this.byNid(nid);
    if (!v) {
      if (dead) return;
      v = this.spawn({ kind, x, z, yaw, col: col || undefined, nid, beached: false });
      if (!v) return; this.nid = Math.max(this.nid, nid);
      if (!v.boat) { v.y = y; v.pitch = pitch; v.roll = roll; }
    }
    v.hp = hp; if (dead) { if (!v.dead) this.wreck(v); return; }
    const P = G.player, me = G.net ? G.net.me : 0;
    if (v.driver === P) { // I'm driving it: only someone else's claim matters
      if (drv !== -1 && drv !== me) { this.exit(P, true); G.ui.toast('Someone else got in first', 'bad'); }
      return;
    }
    v.netDriver = drv === -1 || drv === me ? null : drv;
    if (v.netDriver != null && performance.now() / 1000 - (v.stT || 0) < 0.6) return; // the driver's own updates are smoother
    if (performance.now() / 1000 < (v.exitHold || 0)) return; // I just got out: I know where I left it
    v.fuel = fuel; v.net = { x, y, z, yaw, pitch, roll };
  }
  /** guest: a vehicle nobody here is driving follows the host's copy (boats still bob on the local waves) */
  netRest(v, dt, cam, fogFar) {
    const T = v.net, k = Math.min(1, dt * 6);
    if (T) {
      if (Math.hypot(T.x - v.x, T.z - v.z) > 12) { v.x = T.x; v.z = T.z; v.yaw = T.yaw; }
      const ox = v.x, oz = v.z;
      v.x += (T.x - v.x) * k; v.z += (T.z - v.z) * k; v.yaw += angDiff(v.yaw, T.yaw) * k;
      const sp = Math.hypot(v.x - ox, v.z - oz) / Math.max(dt, 1e-3); v.speed = sp > 0.05 ? sp : 0;
    }
    v.rpm = Math.max(0, v.rpm - dt * 0.4);
    if (v.boat) {
      const d = cam ? Math.hypot(v.x - cam.x, v.z - cam.z) : 0; v.near = d; v.vx = v.vz = 0; v.yawRate = 0; v.thr = 0; v.eL = v.eR = 0;
      v.mesh.root.visible = d < fogFar; if (d > 170 && !(v.speed > 0)) return;
      this.floatBoat(v, dt, false); this.animateBoat(v, dt); return;
    }
    if (v.kind === 'buggy' && (!T || Math.abs(T.y - G.W.height(v.x, v.z)) < 0.6)) this.place(v);
    else if (T) { v.y += (T.y - v.y) * k; v.pitch += (T.pitch - v.pitch) * k; v.roll += (T.roll - v.roll) * k; const R = v.mesh.root; R.position.set(v.x, v.y, v.z); R.rotation.set(0, -v.yaw, 0); R.rotateZ(v.pitch); R.rotateX(v.roll); }
    this.animate(v, dt);
  }
  /** a friend is driving it: their phone sends where it is (already smoothed) */
  netDrive(v, s, dt, who) {
    if (!v || v.dead || v.driver) return false;
    if (v.netDriver != null && v.netDriver !== who && performance.now() / 1000 - (v.stT || 0) < 1) return false; // two got in at once: the first one keeps it
    const ox = v.x, oz = v.z;
    v.netDriver = who; v.stT = performance.now() / 1000;
    v.x = s.x; v.y = s.y; v.z = s.z; v.yaw = s.yaw; v.pitch = s.p || 0; v.roll = s.r || 0; v.rpm = s.rpm || 0; if (Number.isFinite(s.f)) v.fuel = s.f;
    v.speed = Math.hypot(v.x - ox, v.z - oz) / Math.max(dt, 1e-3); if (v.speed > 60) v.speed = 0;
    const R = v.mesh.root; R.visible = true; R.position.set(v.x, v.y, v.z); R.rotation.set(0, -v.yaw, 0); R.rotateZ(v.pitch); R.rotateX(v.roll);
    if (v.boat) { if (v.mesh.tick) try { v.mesh.tick(dt, { k: v.kind, x: v.x, y: v.y, z: v.z, yaw: v.yaw, p: v.pitch, r: v.roll, rpm: v.rpm }); } catch (e) { } }
    else { v.steer = 0; this.animate(v, dt); }
    return true;
  }
  /** a friend got out (or left the game): it stays where they left it */
  netRelease(nid, who, m) {
    const v = this.byNid(nid); if (!v || v.netDriver !== who) return;
    v.netDriver = null; v.speed = 0; v.vx = v.vz = 0; v.vy = 0; v.yawRate = 0; v.thr = 0; v.eL = v.eR = 0; v.rpm = Math.min(v.rpm, 0.3);
    if (m && [m.x, m.y, m.z, m.yaw].every(Number.isFinite)) { v.x = +m.x; v.y = +m.y; v.z = +m.z; v.yaw = +m.yaw; v.pitch = +m.p || 0; v.roll = +m.r || 0; if (Number.isFinite(+m.f)) v.fuel = +m.f; v.net = { x: v.x, y: v.y, z: v.z, yaw: v.yaw, pitch: v.pitch, roll: v.roll }; }
    if (v.boat) v.ground = this.grounding(v.K, v.x, v.z, v.yaw);
  }
  /** guest: the host's vehicle is gone (a wreck cleared away for its respawn) */
  netRemove(nid) {
    const i = this.list.findIndex(v => v.nid === nid); if (i < 0) return; const v = this.list[i];
    if (v.driver === G.player) this.exit(G.player, true);
    this.scene.remove(v.mesh.root); this.list.splice(i, 1);
  }
  netReleaseAll(who) { for (const v of this.list) if (who === undefined || v.netDriver === who) { v.netDriver = null; v.speed = 0; } }
  /** I got out: tell everyone where it is now */
  netExit(v) {
    if (!G.net || !G.net.role || !v) return;
    const r2 = q => Math.round(q * 100) / 100, r3 = q => Math.round(q * 1000) / 1000;
    v.exitHold = performance.now() / 1000 + 1.5; v.net = { x: v.x, y: v.y, z: v.z, yaw: v.yaw, pitch: v.pitch, roll: v.roll }; // stays where I left it
    G.net.send({ t: 'vexit', nid: v.nid, x: r2(v.x), y: r2(v.y), z: r2(v.z), yaw: r3(v.yaw), p: r3(v.pitch), r: r3(v.roll), f: Math.round(v.fuel) });
  }
  /** minimap / map markers */
  markers() { return this.list.filter(v => !v.dead).map(v => ({ x: v.x, z: v.z, kind: v.kind, boat: !!v.boat, yaw: v.yaw, mine: v.driver === G.player })); }
  dispose() { for (const v of this.list) this.scene.remove(v.mesh.root); this.list = []; }
}

function Input() { return INPUT; }

/** a vehicle model on its own (for other players' vehicles in co-op). Boats: root origin = waterline; model.tick(dt, vehState) animates oars / prop / wake */
export function buildVehicleModel(kind) {
  if (KINDS[kind] && KINDS[kind].boat) return buildBoatModel(kind);
  const col = COLORS[Math.floor(Math.random() * COLORS.length)]; return kind === 'heli' ? buildHeli(col) : buildBuggy(col);
}
export const VEHICLE_KINDS = KINDS;

// ---------------------------------------------------------------- models (+X forward, y up)
function buildBuggy(col, v) {
  const root = new THREE.Group(), body = new THREE.Group();
  const paint = M.mat(col, { tex: 'metal' }), dark = M.mat('#2a2624', { tex: 'metal' }), black = M.mat('#1c1a1a'), seat = M.mat('#5a3a2a', { tex: 'cloth' }), steel = M.surf('metal');
  M.add(body, M.box(3.7, 0.3, 1.7), dark, 0, 0.55, 0);                        // floor pan
  M.add(body, M.box(1.1, 0.42, 1.75), paint, 1.35, 0.86, 0);                  // nose
  M.add(body, M.box(0.5, 0.3, 1.9), paint, 1.95, 0.7, 0);                     // bumper
  for (const s of [-1, 1]) M.add(body, M.box(2.4, 0.38, 0.14), paint, 0, 0.88, s * 0.9);   // side panels
  M.add(body, M.box(1.0, 0.62, 1.45), dark, -1.45, 1.0, 0);                    // rear engine
  M.add(body, M.cyl(0.08, 0.08, 0.5, 8), steel, -1.95, 1.2, 0.45, { rz: Math.PI / 2 }); // exhaust
  for (const z of [-0.42, 0.42]) { M.add(body, M.box(0.55, 0.14, 0.55), seat, -0.25, 0.78, z); M.add(body, M.box(0.14, 0.62, 0.55), seat, -0.55, 1.12, z); }
  M.add(body, M.cyl(0.03, 0.03, 0.42, 6), black, 0.25, 1.05, -0.42, { rz: 0.9 });          // steering column
  M.add(body, M.cyl(0.17, 0.17, 0.04, 12), black, 0.12, 1.2, -0.42, { rz: Math.PI / 2 - 0.9 }); // wheel
  // roll cage
  const bar = M.mat('#1f1f22', { tex: 'metal' });
  // roll hoop behind the seats + low windscreen frame (kept out of the driver's eye line)
  for (const z of [-0.82, 0.82]) { M.add(body, M.box(0.08, 1.4, 0.08), bar, -0.8, 1.55, z); M.add(body, M.box(0.05, 0.42, 0.05), bar, 0.72, 1.2, z, { rz: -0.4 }); }
  M.add(body, M.box(0.08, 0.08, 1.72), bar, -0.8, 2.24, 0); M.add(body, M.box(0.05, 0.05, 1.7), bar, 0.62, 1.4, 0);
  const lamp = M.basic('#fff6c8'); for (const z of [-0.6, 0.6]) M.add(body, M.box(0.08, 0.16, 0.24), lamp, 1.92, 0.98, z);
  const baked = M.bake(body); root.add(baked);
  // wheels (front ones in steering pivots)
  const wheels = [], pivots = [], tyre = M.mat('#1a1a1c', { tex: 'rock' }), rim = M.mat('#c8c4b8');
  for (const [x, z] of [[1.25, -1.0], [1.25, 1.0], [-1.25, -1.0], [-1.25, 1.0]]) {
    const pv = new THREE.Group(); pv.position.set(x, 0.48, z); root.add(pv);
    const w = new THREE.Group(); pv.add(w);
    M.add(w, M.cyl(0.48, 0.48, 0.36, 14), tyre, 0, 0, 0, { rx: Math.PI / 2 }); M.add(w, M.cyl(0.24, 0.24, 0.38, 8), rim, 0, 0, 0, { rx: Math.PI / 2 });
    wheels.push(w); if (x > 0) pivots.push(pv);
  }
  const lights = new THREE.Group(); root.add(lights);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(2.4, 12, 12, 1, true).rotateZ(Math.PI / 2).translate(8, 0.9, 0), new THREE.MeshBasicMaterial({ color: '#fff3c0', transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  lights.add(cone); lights.visible = false;
  root.traverse(o => { if (o.isMesh && o !== cone) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, wheels, pivots, lights };
}
function buildHeli(col, v) {
  const root = new THREE.Group(), body = new THREE.Group();
  const paint = M.mat(col, { tex: 'metal' }), dark = M.mat('#2a2624', { tex: 'metal' }), black = M.mat('#1c1a1a'), seat = M.mat('#5a3a2a', { tex: 'cloth' });
  M.add(body, M.box(1.9, 0.14, 1.15), dark, 0, 0.72, 0);                     // floor
  M.add(body, M.box(1.9, 0.5, 0.1), paint, 0, 1.02, -0.6); M.add(body, M.box(1.9, 0.5, 0.1), paint, 0, 1.02, 0.6); // tub sides
  M.add(body, M.box(0.7, 0.62, 1.2), paint, 1.15, 1.0, 0);                   // nose
  M.add(body, M.box(0.5, 0.3, 1.0), paint, 1.45, 0.78, 0);
  M.add(body, M.box(0.35, 0.45, 1.25), paint, -0.95, 1.12, 0);                // back wall
  M.add(body, M.box(0.6, 0.12, 0.6), seat, 0.1, 0.86, 0); M.add(body, M.box(0.12, 0.6, 0.6), seat, -0.22, 1.18, 0);
  M.add(body, M.box(0.05, 0.05, 1.1), black, 0.9, 1.42, 0);                   // low dash rail (below the pilot's eye line)
  M.add(body, M.box(0.6, 0.5, 0.6), dark, -0.45, 1.65, 0);                    // engine
  M.add(body, M.cyl(0.08, 0.08, 0.6, 8), black, -0.3, 2.1, 0);                 // mast
  M.add(body, M.box(2.9, 0.22, 0.22), paint, -2.35, 1.25, 0);                 // tail boom
  M.add(body, M.box(0.55, 0.85, 0.06), paint, -3.65, 1.6, 0);                 // fin
  M.add(body, M.box(0.5, 0.06, 0.8), paint, -3.4, 1.28, 0);                   // stabiliser
  for (const z of [-0.68, 0.68]) { M.add(body, M.box(2.4, 0.08, 0.08), black, 0.1, 0.05, z); for (const x of [-0.5, 0.7]) M.add(body, M.box(0.07, 0.7, 0.07), black, x, 0.4, z * 0.85); }
  const baked = M.bake(body); root.add(baked);
  // main rotor: real blades when slow, a translucent disc when spinning fast
  const rotor = new THREE.Group(); rotor.position.set(-0.3, 2.42, 0); root.add(rotor);
  const blades = new THREE.Group(); rotor.add(blades);
  M.add(blades, M.box(7.2, 0.05, 0.26), black, 0, 0, 0); M.add(blades, M.box(0.26, 0.05, 7.2), black, 0, 0, 0);
  const blur = new THREE.Mesh(new THREE.CircleGeometry(3.6, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#1c1a1a', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  rotor.add(blur); blur.visible = false;
  const tail = new THREE.Group(); tail.position.set(-3.7, 1.62, 0.1); root.add(tail);
  M.add(tail, M.box(0.08, 1.1, 0.06), black, 0, 0, 0); M.add(tail, M.box(1.1, 0.08, 0.06), black, 0, 0, 0);
  root.traverse(o => { if (o.isMesh && o !== blur) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, rotor, blades, blur, tail };
}

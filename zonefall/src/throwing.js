// ============================================================================
// ZONEFALL — thrown things: grenade physics, the throw from your view, the
// aiming arc, and co-op ghosts.
//
//  * Physics (stepThrown, fixed 1/60 s steps): gravity, bounces off walls,
//    doors, crates and tree trunks (the normal of what it hit, with some of the
//    speed kept along it), off the ground and floors (terrain slopes tilt the
//    bounce), and off the side of a foundation, floor slab or deck. It lands on
//    whatever it falls onto: terrain, foundations, upper floors and roofs
//    (Build.floorY with its height), monument floors and decks, the tops of
//    crates and low walls. Then it rolls: down terrain slopes, with friction by
//    surface (sand and snow stop it quickly, roads and floors let it run), off
//    ledges, until it rests. A ceiling overhead knocks it back down. In water it
//    sinks slowly. Sticky charges stop where they touch.
//  * The throw: a long overhand throw, or a short underhand toss while the aim
//    button is on (the eye button on a phone, right click / V on a computer).
//  * The arc: while you hold FIRE with a throwable, a dotted line shows where it
//    will go, bouncing and rolling, and a ring on the ground shows its blast
//    where it will be when the fuse runs out (red when you'd be in it).
//  * Co-op: every throw is sent as 'gthrow'; the others simulate a ghost of it
//    (seen, heard, dodged by NPCs) that never explodes — the owner's blast
//    arrives as a 'boom'.
// ============================================================================
import { G } from './state.js';
import { Build } from './build.js';
import { THROWN, ITEMS } from './data.js';
import { Sfx } from './audio.js';
import { Input } from './input.js';

export const GRAV = 16, STEP = 1 / 60, RAD = 0.08;
/** throw speeds (m/s) and how far above your aim the throw leaves your hand (rad) */
export const THROW = { long: 17, short: 7.5, longUp: 0.12, shortUp: 0.05 };
const E_WALL = 0.5, E_SOFT = 0.3, E_HARD = 0.45;

const topOf = c => { if (c.top === undefined) { const y0 = c.y0 !== undefined ? c.y0 : G.W.height((c.minx + c.maxx) / 2, (c.minz + c.maxz) / 2); c.top = y0 + (c.h || 3); } return c.top; };
const inside = (c, x, z) => c.t === 'b' ? x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1 : (x - c.x) ** 2 + (z - c.z) ** 2 <= c.r * c.r;
/** is a collider solid at height y? (its band, or its base..top) */
function solidAt(c, y) { const top = Math.min(c.yhi ?? Infinity, topOf(c)); const lo = c.ylo !== undefined && c.ylo > -1e3 ? c.ylo : (c.y0 ?? -1e9) - 0.2; return y < top && y > lo; }

let HARD = false;
/** the highest surface at (x, z) whose top is at or just below y: terrain, floors, decks, or the top of a crate / low wall.
 *  Sets HARD when it isn't soft ground. */
export function surfaceY(x, z, y) {
  let s = Build.floorY(x, z, y - 0.85); const T = G.W.height(x, z); HARD = s > T + 0.02 || (G.W.isRoad && G.W.isRoad(x, z));
  G.phys.query(x - 0.01, z - 0.01, x + 0.01, z + 0.01, c => {
    if (c.off || !c.solid || c.kind === 'tree' || !inside(c, x, z)) return;
    const top = Math.min(c.yhi ?? Infinity, topOf(c)); if (top <= y + 0.05 && top > s) { s = top; HARD = true; }
  });
  return s;
}
/** rolling resistance under (x, z): [a constant drag (m/s²), a drag that grows with speed (1/s)] — grass and sand
 *  soak a roll up quickly, roads and floors let it run; a slope steeper than the constant part keeps it rolling */
function rollFric(x, z, onTerrain) {
  if (!onTerrain) return [1.0, 1.0];                           // floors, decks, roofs, crate tops
  if (G.W.isRoad && G.W.isRoad(x, z)) return [0.8, 0.9];
  const b = G.W.biomeAt(x, z); return b === 1 || b === 4 ? [3, 2] : b === 5 ? [2.5, 1.6] : [1.5, 1.2]; // sand, snow, grass and dirt
}

/** one physics step for thrown thing t. ev(kind, t, strength, hard) reports 'wall' / 'floor' / 'ceil' / 'stick' / 'splash' / 'rest' */
export function stepThrown(t, h, ev) {
  if (t.rest || t.stuck) return;
  const W = G.W; t.life = (t.life || 0) + h;
  const wet = t.y < -0.05 && W.height(t.x, t.z) < -0.1;
  if (wet && !t.wet) { t.wet = true; t.roll = false; t.vx *= 0.35; t.vz *= 0.35; t.vy *= 0.2; if (ev) ev('splash', t, 1); }
  if (!t.roll) t.vy -= (wet ? 3.5 : GRAV) * h;
  if (wet) { const k = Math.exp(-3 * h); t.vx *= k; t.vz *= k; t.vy *= Math.exp(-1.5 * h); }
  // ---- sideways: walls, doors, crates, trunks at this height
  const ox = t.x, oz = t.z, oy = t.y;
  let nx = ox + t.vx * h, nz = oz + t.vz * h;
  const hit = (t.vx || t.vz) ? G.phys.raycast(ox, oz, nx, nz, c => c.solid && !c.off && solidAt(c, oy)) : null;
  if (hit) {
    let ux = hit.nx, uz = hit.nz; const L = Math.hypot(ux, uz) || 1; ux /= L; uz /= L;
    const vn = t.vx * ux + t.vz * uz;
    if (t.def.sticky && hit.c.ref && (hit.c.kind === 'piece' || hit.c.kind === 'door' || hit.c.kind === 'deploy')) { t.stuck = hit.c.ref; t.x = hit.x + ux * 0.05; t.z = hit.z + uz * 0.05; t.vx = t.vz = t.vy = 0; if (ev) ev('stick', t, 1, true); return; }
    if (vn < 0) {
      t.vx -= (1 + E_WALL) * vn * ux; t.vz -= (1 + E_WALL) * vn * uz;
      const tn = t.vx * ux + t.vz * uz; t.vx = tn * ux + (t.vx - tn * ux) * 0.8; t.vz = tn * uz + (t.vz - tn * uz) * 0.8;
      t.vy *= 0.85; t.bounces = (t.bounces || 0) + 1; t.spin = -(t.spin || 6);
      if (ev && -vn > 0.8) ev('wall', t, -vn, hit.c.kind !== 'tree');
    }
    nx = hit.x + ux * 0.06; nz = hit.z + uz * 0.06;
  }
  // ---- the edge of a slab (foundation, floor, deck, roof) from the side is a wall too; a low step it climbs
  const T1 = W.height(nx, nz), ahead = surfaceY(nx, nz, oy + 0.7);
  if (ahead > oy + 0.12 && ahead > T1 + 0.05 && surfaceY(ox, oz, oy + 0.7) <= oy + 0.12) {
    const bx = surfaceY(nx, oz, oy + 0.7) > oy + 0.12, bz = surfaceY(ox, nz, oy + 0.7) > oy + 0.12;
    if (bx || !bz) t.vx = -t.vx * E_WALL; if (bz || !bx) t.vz = -t.vz * E_WALL;
    if (ev && Math.hypot(t.vx, t.vz) > 0.8) ev('wall', t, Math.hypot(t.vx, t.vz) / E_WALL, true);
    nx = ox; nz = oz;
  }
  t.x = nx; t.z = nz;
  // ---- up and down
  let ny = oy + (t.roll ? 0 : t.vy * h);
  const T = W.height(t.x, t.z);
  if (!t.roll && t.vy > 0) { // a ceiling or deck overhead knocks it back down
    const c2 = surfaceY(t.x, t.z, ny + RAD + 0.2);
    if (c2 > oy + RAD + 0.02 && c2 > T + 0.05 && surfaceY(t.x, t.z, oy) < c2 - 0.05) { ny = Math.min(ny, c2 - 0.22 - RAD); t.vy = -Math.abs(t.vy) * 0.25; if (ev) ev('ceil', t, 2, true); }
  }
  const sup = surfaceY(t.x, t.z, Math.max(oy, ny) - RAD + (t.roll ? 0.12 : 0.02)), hard = HARD;
  const onTerrain = sup - T < 0.02;
  if (t.roll && oy - RAD > sup + 0.25) t.roll = false; // rolled off a ledge
  if (ny - RAD <= sup || (t.roll && ny - RAD <= sup + 0.25)) { // touching (rolling: it follows the ground down)
    // the surface's normal: terrain slopes tilt it, floors are flat
    let gx = 0, gz = 0; if (onTerrain) { const e = 0.3; gx = (W.height(t.x + e, t.z) - W.height(t.x - e, t.z)) / (2 * e); gz = (W.height(t.x, t.z + e) - W.height(t.x, t.z - e)) / (2 * e); }
    const nl = Math.hypot(gx, 1, gz), Nx = -gx / nl, Ny = 1 / nl, Nz = -gz / nl;
    const vn = t.vx * Nx + t.vy * Ny + t.vz * Nz;
    if (t.def.sticky && !t.roll) { t.vx = t.vy = t.vz = 0; t.y = sup + RAD; t.rest = true; if (ev) ev('stick', t, 1, hard); return; }
    if (!t.roll && vn < -1.8 && !t.wet) {
      const e = hard ? E_HARD : E_SOFT;
      t.vx -= (1 + e) * vn * Nx; t.vy -= (1 + e) * vn * Ny; t.vz -= (1 + e) * vn * Nz;
      const tk = hard ? 0.72 : 0.55; t.vx *= tk; t.vz *= tk; t.bounces = (t.bounces || 0) + 1;
      if (ev) ev('floor', t, -vn, hard);
    } else {
      if (vn < 0) { t.vx -= vn * Nx; t.vz -= vn * Nz; }
      if (!t.roll && ev) ev('land', t, -vn, hard);
      t.roll = true; t.vy = 0;
    }
    ny = sup + RAD;
    if (t.roll) {
      // downhill pull and rolling resistance
      const sl = GRAV * 0.62 / (1 + gx * gx + gz * gz); t.vx -= sl * gx * h; t.vz -= sl * gz * h;
      const [fc, fk] = t.wet ? [5, 3] : rollFric(t.x, t.z, onTerrain), sp = Math.hypot(t.vx, t.vz);
      const ns = Math.max(0, sp - (fc + fk * sp) * h); if (sp > 1e-6) { t.vx *= ns / sp; t.vz *= ns / sp; }
      t.spin = ns / RAD * 0.35;
      if ((ns < 0.15 && sl * Math.hypot(gx, gz) < fc) || t.life > 14) { t.rest = true; t.vx = t.vz = 0; t.spin = 0; if (ev) ev('rest', t, 0, hard); }
    }
  }
  t.y = ny;
}

/** where a throw goes: the path (every few steps), where it is when the fuse runs out, and where it first touches something */
export function predictThrow(s, def, maxT) {
  const t = { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, def, rest: false, roll: false, bounces: 0 };
  const pts = [[t.x, t.y, t.z]]; let first = null; const marks = [];
  const n = Math.ceil(Math.min(maxT, 6) / STEP);
  for (let i = 1; i <= n; i++) {
    stepThrown(t, STEP, k => { if (k === 'wall' || k === 'floor' || k === 'land' || k === 'ceil' || k === 'stick') { if (!first) first = [t.x, t.y, t.z]; if (marks.length < 6) marks.push([t.x, t.y, t.z]); } });
    if (i % 2 === 0 || t.rest || t.stuck) pts.push([t.x, t.y, t.z]);
    if (t.rest || t.stuck) break;
  }
  return { pts, end: [t.x, t.y, t.z], first, marks, rest: t.rest || !!t.stuck };
}

/** the player's throw: from the right hand along the view (long), or a gentle underhand toss (short) */
export function throwStart(p, short) {
  const pitch = Math.max(-1.2, Math.min(1.35, (p.pitch || 0) + (short ? THROW.shortUp : THROW.longUp)));
  const sp = short ? THROW.short : THROW.long, cp = Math.cos(pitch), yaw = p.yaw ?? p.ang;
  const fx = Math.cos(yaw), fz = Math.sin(yaw), ey = p.y + (p.eye || 1.62) + (p.airY || 0);
  let x = p.x + fx * 0.35 - fz * 0.12, z = p.z + fz * 0.35 + fx * 0.12;
  if (!G.phys.los(p.x, p.z, x, z, c => c.solid && !c.off && solidAt(c, ey - 0.15))) { x = p.x; z = p.z; } // hugging a wall: from the body
  return { x, y: ey - (short ? 0.35 : 0.12), z, vx: fx * cp * sp, vy: Math.sin(pitch) * sp, vz: fz * cp * sp };
}

// ---------------------------------------------------------------- the aiming arc (drawn on the HUD overlay)
const pv = {}; let cache = null;
export function drawThrowArc(g, R, p) {
  const s = p && p.inv && p.inv.belt.slots[p.sel], def = s && THROWN[s.id];
  if (!def || p.dead || G.buildMode || G.uiBlock || p.vehicle || p.swim) { cache = null; return; }
  if (p.nadeId !== s.id) { p.nadeId = s.id; p.nadeHintT = G.t; }
  const short = !!p.throwShort;
  if (!p.throwAim) { // a reminder for a few seconds after you take one out
    if (G.t - (p.nadeHintT ?? -99) < 5) chip(g, 'Hold FIRE to aim · let go to throw' + (Input.touchMode ? ' · 👁 = short toss' : ' · right click = short toss'), 0.75);
    return;
  }
  // predict (again only when the aim moved or every few frames)
  const key = [p.x, p.y, p.z, p.yaw, p.pitch, short, s.id].map(v => typeof v === 'number' ? Math.round(v * 200) : v).join('|');
  if (!cache || cache.key !== key || (cache.n = (cache.n || 0) + 1) > 6) cache = { key, pr: predictThrow(throwStart(p, short), def, def.fuse || 3), n: 0 };
  const pr = cache.pr, cam = R.camera.position;
  // the path: a faint line with bold dots on it (not right in front of your face), bigger when near
  g.save();
  const sp = [];
  for (const [x, y, z] of pr.pts) { const dc = Math.hypot(x - cam.x, y - cam.y, z - cam.z); if (dc < 1.1) continue; R.project(x, y, z, pv); if (pv.vis) sp.push([pv.x, pv.y, dc]); }
  if (sp.length > 1) { g.lineJoin = 'round'; g.beginPath(); g.moveTo(sp[0][0], sp[0][1]); for (const q of sp) g.lineTo(q[0], q[1]); g.lineWidth = 4; g.strokeStyle = 'rgba(18,12,16,.35)'; g.stroke(); g.lineWidth = 1.6; g.strokeStyle = 'rgba(255,246,220,.55)'; g.stroke(); }
  sp.forEach(([x, y, dc], k) => {
    if (k % 2) return; const sz = Math.max(2.4, Math.min(5, 16 / dc));
    g.fillStyle = 'rgba(18,12,16,.8)'; g.beginPath(); g.arc(x, y, sz + 1.4, 0, 7); g.fill();
    g.fillStyle = (k >> 1) % 2 ? '#fff6dc' : '#ffd27a'; g.beginPath(); g.arc(x, y, sz, 0, 7); g.fill();
  });
  for (const [x, y, z] of pr.marks) { R.project(x, y, z, pv); if (!pv.vis) continue; g.strokeStyle = '#120c10'; g.lineWidth = 4; g.beginPath(); g.arc(pv.x, pv.y, 5, 0, 7); g.stroke(); g.strokeStyle = '#fff6dc'; g.lineWidth = 2; g.stroke(); }
  // the blast ring where it will be when the fuse runs out
  const [ex, ey, ez] = pr.end, r = def.r || 0;
  const inBlast = r > 0 && Math.hypot(p.x - ex, p.z - ez) < r && Math.abs(p.y - ey) < 2.2;
  if (r > 0) {
    const col = inBlast ? '255,74,58' : '255,201,40';
    g.beginPath(); let on = 0;
    for (let i = 0; i <= 32; i++) { const a = i / 32 * Math.PI * 2, x = ex + Math.cos(a) * r, z = ez + Math.sin(a) * r; R.project(x, ey + 0.05, z, pv); if (!pv.vis) { on = 0; continue; } if (!on) g.moveTo(pv.x, pv.y); else g.lineTo(pv.x, pv.y); on = 1; }
    g.fillStyle = 'rgba(' + col + ',.16)'; g.fill(); g.lineWidth = 4; g.strokeStyle = 'rgba(18,12,16,.6)'; g.stroke(); g.lineWidth = 2; g.strokeStyle = 'rgba(' + col + ',.95)'; g.stroke();
  }
  R.project(ex, ey + 0.1, ez, pv);
  if (pv.vis) { g.strokeStyle = '#120c10'; g.lineWidth = 5; g.beginPath(); g.moveTo(pv.x - 8, pv.y - 8); g.lineTo(pv.x + 8, pv.y + 8); g.moveTo(pv.x + 8, pv.y - 8); g.lineTo(pv.x - 8, pv.y + 8); g.stroke(); g.strokeStyle = inBlast ? '#ff4a3a' : '#ffc928'; g.lineWidth = 2.5; g.stroke(); }
  const dist = Math.round(Math.hypot(ex - p.x, ez - p.z));
  chip(g, (short ? 'SHORT TOSS' : 'LONG THROW') + ' · ' + dist + ' m' + (inBlast ? ' · TOO CLOSE!' : '') + (short ? '' : Input.touchMode ? '  (👁 short)' : '  (right click: short)'), 1, inBlast);
  g.restore();
}
function chip(g, txt, a, bad) {
  g.save(); g.globalAlpha = a; g.font = 'italic 900 13px "Avenir Next Condensed","Arial Black",system-ui'; g.textAlign = 'center';
  const w = g.measureText(txt).width + 18, x = innerWidth / 2, y = 108 + (G.ui && G.ui.safeTop || 0); // under the clock, clear of the arc
  g.fillStyle = bad ? '#ff5a48' : 'rgba(255,246,220,.94)'; g.strokeStyle = '#120c10'; g.lineWidth = 3;
  g.beginPath(); g.rect(x - w / 2, y - 15, w, 22); g.fill(); g.stroke();
  g.fillStyle = bad ? '#fff' : '#120c10'; g.fillText(txt, x, y + 1); g.restore();
}

// ---------------------------------------------------------------- co-op: everyone sees every throw
const r3 = v => Math.round(v * 1000) / 1000;
/** tell the others about a throw (the host relays a guest's to everyone else) */
export function netThrow(t) {
  const N = G.net; if (!N || !N.role || t.ghost) return;
  const m = { t: 'gthrow', it: t.id, s: [t.x, t.y, t.z, t.vx, t.vy, t.vz].map(r3), f: Math.round(t.fuse * 100) / 100, d: t.dud ? 1 : 0 }; // (net.js uses `id` for the sender)
  if (N.role === 'host') N.broadcast(m); else N.send(m);
}
/** somebody else's throw: a ghost that flies, bounces and rolls the same way, and that NPCs run from; its blast comes as a 'boom' */
export function throwGhost(m) {
  const id = m.it; const T = THROWN[id]; if (!T || !Array.isArray(m.s) || m.s.length < 6 || !m.s.every(Number.isFinite) || !ITEMS[id]) return null;
  const [x, y, z, vx, vy, vz] = m.s;
  const t = { id, def: T, x, y, z, vx, vy, vz, fuse: Math.max(0.2, Math.min(20, +m.f || T.fuse || 3)), owner: null, team: 'remote', stuck: null, rest: false, roll: false, spin: 8, bounces: 0, acc: 0, ghost: true, dud: !!m.d };
  if (G.fx) t.mesh = G.fx.thrownMesh(id);
  G.throwns.push(t); if (Sfx.nadeWhoosh) Sfx.nadeWhoosh(x, z);
  return t;
}
G.throwGhost = throwGhost; // net.js

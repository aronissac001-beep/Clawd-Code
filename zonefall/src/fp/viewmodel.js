// ============================================================================
// ZONEFALL 4 — first-person view model  (src/fp/viewmodel.js)
//
//   const vm = new ViewModel({ makeHeld, HELD_INFO });   // models may be null -> box placeholders
//   vm.setItem(id)        held item id (null = fists); plays an equip raise (same id = no-op)
//   vm.setAttach(id, att) weapon attachments ({ sight, muzzle, rail, mag } item ids) for gun `id`: the model gets
//                         them (models.makeHeld(id, att)), sights / scope overlay / muzzle / flash / recoil follow;
//                         changing them on the held gun rebuilds it. vm.laserD = metres to the laser dot (beam length)
//   vm.setLook({ skin, sleeve, glove })                   hex colours (glove optional, fingerless)
//   vm.setLighting({ hemiSky, hemiGround, hemiIntensity, sunDir, sunColor, sunIntensity, extra })
//   vm.update(dt, st)     st (all optional): speed sprint crouch air ads lookDX lookDY fire recoil
//                         reload swing throw use hammer night empty
//                         extras: aimThrow (hold a throwable cocked), draw (bow draw 0..1, default = ads),
//                                 fov (main camera vertical FOV, deg -> muzzleView re-projection)
//   vm.render(renderer, aspect[, mainCamera])  clears depth only, draws over whatever is bound;
//                         autoClear is restored. Pass the main camera (or call vm.setCamera(cam))
//                         so sun / sky light directions and the torch flame use the true world up.
//   vm.muzzleView(out)    muzzle / flame tip / hand in view space (camera at origin looking -Z)
//   vm.scopeK             0..1 hunting-rifle scope overlay (drawn here; item + arms hidden at 1)
//   vm.flash              true -> draws its own muzzle flash (one additive mesh) + a hand-lighting pop
//   vm.camera             the view-model camera (fov 58, near 0.01, far 10)
//   vm.rodCast = 0        fishing rod: play the cast flick;  vm.rodPull 0..1: rod strains / shakes (fishing.js)
//
// Conventions: lookDX > 0 = turning right, lookDY > 0 = looking up (radians this frame).
// Everything lives in VIEW space (camera at the origin looking down -Z, +X right,
// +Y up). One skinned, vertex-coloured mesh draws both arms (forearms, rolled
// sleeves, watch, hands with jointed fingers + thumbs); the held item is the shared
// makeHeld() model (grip at origin, +X forward, +Y up) rotated into the screen.
// Hands are placed by 2-bone IK from off-screen shoulders onto grip "mounts"
// on the item, so recoil, swings and reloads keep both hands locked on.
// Small moving parts of the merged item meshes (magazines, pump, break-action
// barrels, bolt, revolver cylinder, rocket warhead, bow arrow) are animated by
// rewriting just their vertices. Materials come from M.mat / M.basic (toon-ready).
// Draw calls: arms 1 + item 1-3 + flash 1 (<= 5). No per-frame allocation.
// ============================================================================
import { THREE, M } from '../gfx/materials.js';

const PI = Math.PI, TAU = PI * 2, HALF = PI / 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sat = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = t => t * t * (3 - 2 * t);
const kd = (k, dt) => 1 - Math.exp(-k * dt);
/** 0 outside [a,d], smooth ramp a->b, 1 on [b,c], ramp down c->d */
const win = (x, a, b, c, d) => (x <= a || x >= d ? 0 : x < b ? sstep(a, b, x) : x > c ? 1 - sstep(c, d, x) : 1);
const EMPTY = {};

// ---------------------------------------------------------------- tunables
const FOV = 58;
const LA = 0.3, LB = 0.27;                        // upper arm / forearm length (m)
const SHOULDER = [new THREE.Vector3(0.2, -0.28, 0.1), new THREE.Vector3(-0.2, -0.28, 0.1)];
const G_H = new THREE.Vector3(0, -0.026, -0.064); // centre of the closed fist's hole, hand-bone space
const EQUIP_T = 0.42;

// finger poses: [index1, index2, fingers1, fingers2, thumbYaw, thumbPitch, thumb2]
const FP = {
  relax: [0.35, 0.45, 0.45, 0.55, 0.0, -0.1, 0.25],
  fist: [1.5, 1.75, 1.55, 1.75, -0.6, -0.5, 0.95],
  grip: [1.28, 1.4, 1.35, 1.45, -0.45, -0.45, 0.6],
  trigger: [0.55, 0.65, 1.35, 1.45, -0.4, -0.4, 0.45],
  support: [1.0, 1.0, 1.1, 1.1, -0.05, -0.1, 0.25],
  open: [0.12, 0.15, 0.18, 0.2, 0.25, 0.05, 0.08],
  hook: [1.0, 1.35, 1.3, 1.6, -0.35, -0.2, 0.6],
  ball: [0.95, 0.9, 1.05, 1.0, -0.4, -0.3, 0.45],
  flat: [0.3, 0.25, 0.35, 0.3, 0.1, 0.0, 0.15],
  pinch: [0.85, 1.0, 1.25, 1.45, -0.5, -0.3, 0.45],
};

// ---------------------------------------------------------------- scratch (never allocate per frame)
const V = []; for (let i = 0; i < 24; i++) V.push(new THREE.Vector3());
const Qs = []; for (let i = 0; i < 10; i++) Qs.push(new THREE.Quaternion());
const MX = []; for (let i = 0; i < 6; i++) MX.push(new THREE.Matrix4());
const EU = new THREE.Euler();
const ONE = new THREE.Vector3(1, 1, 1), ZERO3 = new THREE.Vector3(0, 0, 0), UP = new THREE.Vector3(0, 1, 0);
const AXX = new THREE.Vector3(1, 0, 0), AXY = new THREE.Vector3(0, 1, 0), AXZ = new THREE.Vector3(0, 0, 1);
const Q_FWD = new THREE.Quaternion().setFromAxisAngle(AXY, HALF);   // item +X -> view -Z
const OFF = new Float32Array(6), OFF2 = new Float32Array(6);
const REC0 = [0.02, 0.03, 0.02, 0];
const G_PIV = new THREE.Vector3(0.08, -0.2, -0.35);   // global sway / bob rotates about this point

/** view-space rotation from pitch (about X), yaw (about Y), roll (about the view axis Z) */
function qView(out, pitch, yaw, roll) { EU.set(pitch, yaw, roll, 'YXZ'); return out.setFromEuler(EU); }

class Xf {
  constructor() { this.p = new THREE.Vector3(); this.q = new THREE.Quaternion(); }
  copy(o) { this.p.copy(o.p); this.q.copy(o.q); return this; }
  identity() { this.p.set(0, 0, 0); this.q.identity(); return this; }
  /** this = a * b (b expressed in a's frame) */
  mul(a, b) {
    const p = V[23].copy(b.p).applyQuaternion(a.q).add(a.p), q = Qs[9].multiplyQuaternions(a.q, b.q);
    this.p.copy(p); this.q.copy(q); return this;
  }
  lerp(b, t) { if (t <= 0) return this; this.p.lerp(b.p, t); this.q.slerp(b.q, t); return this; }
  lerpXf(a, b, t) { this.p.lerpVectors(a.p, b.p, t); this.q.slerpQuaternions(a.q, b.q, t); return this; }
  point(v) { return v.applyQuaternion(this.q).add(this.p); }
  matrix(m) { return m.compose(this.p, this.q, ONE); }
  /** pose = [x, y, z, pitch, yaw, roll] for an item pointing into the screen */
  pose(a) { this.p.set(a[0], a[1], a[2]); qView(this.q, a[3], a[4], a[5]).multiply(Q_FWD); return this; }
}

/** add a keyframed offset [dx,dy,dz,pitch,yaw,roll] (view space, weight k) to an Xf, rotating about its origin (or pivot) */
function addOff(xf, o, k, pivot) {
  if (k === 0) return;
  const q = qView(Qs[8], o[3] * k, o[4] * k, o[5] * k);
  if (pivot) { const d = V[22].copy(xf.p).sub(pivot).applyQuaternion(q); xf.p.copy(pivot).add(d); }
  xf.p.x += o[0] * k; xf.p.y += o[1] * k; xf.p.z += o[2] * k;
  xf.q.premultiply(q);
}

/** Catmull-Rom through keys [[t, dx, dy, dz, rx, ry, rz], ...] -> out[6] */
function track(keys, t, out) {
  const n = keys.length;
  if (t <= keys[0][0]) { for (let j = 0; j < 6; j++) out[j] = keys[0][j + 1]; return out; }
  if (t >= keys[n - 1][0]) { for (let j = 0; j < 6; j++) out[j] = keys[n - 1][j + 1]; return out; }
  let i = 0; while (i < n - 2 && t > keys[i + 1][0]) i++;
  const k0 = keys[i > 0 ? i - 1 : 0], k1 = keys[i], k2 = keys[i + 1], k3 = keys[i + 2 < n ? i + 2 : n - 1];
  const u = (t - k1[0]) / (k2[0] - k1[0]), u2 = u * u, u3 = u2 * u;
  for (let j = 1; j < 7; j++) {
    const p0 = k0[j], p1 = k1[j], p2 = k2[j], p3 = k3[j];
    out[j - 1] = 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (3 * p1 - p0 - 3 * p2 + p3) * u3);
  }
  return out;
}

/**
 * Hand-bone transform (in item space) for a grip: a = handle axis (pinky -> thumb),
 * f = knuckle direction (wrist -> knuckles), p = where the fist hole sits. side 1 = right, -1 = left.
 */
function mountN(out, side, ax, ay, az, fx, fy, fz, px, py, pz, gh = G_H) {
  const A = V[0].set(ax, ay, az).normalize();
  const F = V[1].set(fx, fy, fz); F.addScaledVector(A, -F.dot(A)).normalize();
  const X = V[2].copy(A).multiplyScalar(side > 0 ? -1 : 1), Z = V[3].copy(F).negate(), Y = V[4].crossVectors(Z, X);
  out.q.setFromRotationMatrix(MX[0].makeBasis(X, Y, Z));
  out.p.set(gh.x * side, gh.y, gh.z).applyQuaternion(out.q).negate().add(V[5].set(px, py, pz));
  return out;
}
function mount(out, side, a, f, p, gh = G_H) { return mountN(out, side, a[0], a[1], a[2], f[0], f[1], f[2], p[0], p[1], p[2], gh); }

// constant carrier poses used at runtime
const P_HIDE_L = [-0.22, -0.62, -0.18, -0.6, -0.2, 0.3];
const P_FIST_SPR_L = [-0.16, -0.18, -0.33, 0.1, -0.25, 0.6];
const P_NOCK_REACH = [0.3, -0.42, -0.1, -0.4, -0.5, -0.6];
const P_THROW_L = [-0.17, -0.17, -0.42, 0.25, -0.25, 0.6];
const P_USE_L = [0.07, -0.14, -0.4, 0.05, -1.35, 0.2];
const POLE_LIFT = new THREE.Vector3(-1, 0.15, -0.7);   // left elbow out to the side and forward

// ============================================================================
// ITEM SETUP TABLES
// ============================================================================
// hip / sprint poses: [x, y, z, pitch, yaw, roll] of the item origin in view space
const CLS = {
  fists: { hip: [0.15, -0.125, -0.36, -0.1, 0.2, -0.5], sprint: [0.16, -0.18, -0.33, 0.1, 0.25, -0.6] },
  rifle: { hip: [0.2, -0.2, -0.42, 0.03, 0.12, -0.08], sprint: [0.09, -0.21, -0.37, -0.35, 0.6, 0.42] },
  pistol: { hip: [0.13, -0.13, -0.4, 0.03, 0.14, 0.0], sprint: [0.13, -0.2, -0.34, -0.6, 0.3, 0.35] },
  rocket: { hip: [0.32, -0.3, -0.2, 0.0, 0.08, 0.0], sprint: [0.15, -0.36, -0.12, -0.25, 0.25, 0.25] },
  bow: { hip: [-0.13, -0.165, -0.46, 0.04, 0.12, HALF - 0.42], sprint: [-0.08, -0.3, -0.36, -0.45, 0.35, HALF - 0.9] },
  tool: { hip: [0.21, -0.2, -0.4, 0.75, 0.3, -0.35], sprint: [0.22, -0.3, -0.34, 0.5, 0.4, -0.55] },
  tool2: { hip: [0.22, -0.19, -0.44, 0.6, 0.35, -0.6], sprint: [0.14, -0.28, -0.3, 0.75, 0.6, -0.9] },
  torch: { hip: [0.25, -0.2, -0.42, 0.5, 0.17, -0.25], sprint: [0.22, -0.3, -0.34, 0.45, 0.35, -0.45] },
  spear: { hip: [0.2, -0.2, -0.24, 0.12, 0.13, -0.1], sprint: [0.15, -0.3, -0.1, -0.1, 0.4, -0.2] },
  rod: { hip: [0.2, -0.19, -0.38, 0.46, -0.28, -0.1], sprint: [0.2, -0.27, -0.32, 0.9, -0.05, -0.35] },
  plan: { hip: [-0.15, -0.22, -0.35, 0.0, -HALF, -0.75], sprint: [-0.15, -0.3, -0.3, 0.0, -HALF, -1.25] },
  throw: { hip: [0.2, -0.17, -0.38, 0.25, 0.25, -0.2], sprint: [0.19, -0.3, -0.3, 0.0, 0.35, -0.4] },
  item: { hip: [0.19, -0.16, -0.38, 0.25, 0.35, -0.15], sprint: [0.18, -0.3, -0.3, 0.0, 0.4, -0.3] },
};

// right-hand grips (a, f, point) by mount style, left support grips per item
const GUN_GRIP = (tilt, px, py) => ({ a: [-Math.sin(tilt), Math.cos(tilt), 0], f: [Math.cos(tilt), Math.sin(tilt), 0], p: [px, py, 0] });
/**
 * Per-item data. grip = right hand (gun pistol grip or handle), sup = left support grip,
 * sights = [rear xyz, front xyz] for ADS, relief = eye distance to the rear sight,
 * rec = recoil [back, pitch, roll/yaw jitter, up], parts = movable vertex groups.
 */
const ITEM = {
  ar: {
    grip: GUN_GRIP(0.35, -0.04, -0.028), sup: { a: [1, 0.05, 0], f: [0, 0.35, 1], p: [0.31, 0.062, 0.004] },
    sights: [[-0.06, 0.185, 0], [0.65, 0.134, 0]], relief: 0.28, rec: [0.03, 0.045, 0.02, 0.006], auto: 1, reload: 'mag',
    parts: { mag: { col: ['#3a2e26'] } }, magOut: [0.02, -0.34, 0.06, 0.0, 0.0, -0.6], magPivot: [0.14, 0.02, 0],
  },
  smg: {
    grip: GUN_GRIP(0.25, -0.03, -0.02), sup: { a: [1, 0, 0], f: [0, 0.3, 1], p: [0.3, 0.068, 0.004] },
    sights: [[-0.07, 0.15, 0], [0.44, 0.112, 0]], relief: 0.22, rec: [0.022, 0.035, 0.022, 0.005], auto: 1, reload: 'mag',
    parts: { mag: { col: ['#2f3034'] } }, magOut: [0.0, -0.08, -0.3, 0.0, 0.5, 0.0], magPivot: [0.12, 0.07, -0.03],
  },
  pump: {
    grip: GUN_GRIP(0.35, -0.05, -0.022), sup: { a: [1, 0, 0], f: [0, 0.35, 1], p: [0.43, 0.036, 0.004] },
    sights: [[-0.08, 0.124, 0], [0.77, 0.114, 0]], relief: 0.22, rec: [0.085, 0.19, 0.05, 0.012], reload: 'shells', pumpAct: 1,
    parts: { pump: { col: ['#7a4a2a'], box: [0.33, -0.1, -0.1, 0.6, 0.1, 0.1] } },
  },
  boomstick: {
    grip: { a: [-0.42, 0.91, 0], f: [0.91, 0.42, 0], p: [-0.075, -0.004, 0] }, sup: { a: [1, 0, 0], f: [0, 0.35, 1], p: [0.25, 0.03, 0.004] },
    sights: [[0.0, 0.13, 0], [0.58, 0.117, 0]], relief: 0.27, rec: [0.09, 0.22, 0.05, 0.012], reload: 'break',
    parts: { barrels: { box: [0.105, -0.05, -0.08, 0.7, 0.13, 0.08] } }, hinge: [0.105, 0.028, 0],
  },
  hunting: {
    grip: { a: [-0.42, 0.91, 0], f: [0.91, 0.42, 0], p: [-0.07, 0.006, 0] }, sup: { a: [1, 0, 0], f: [0, 0.35, 1], p: [0.36, 0.035, 0.004] },
    sights: [[-0.105, 0.16, 0], [0.265, 0.16, 0]], relief: 0.07, rec: [0.075, 0.17, 0.03, 0.012], reload: 'bolt', boltAct: 1, scope: 1,
    parts: { bolt: { col: ['#4a4c52'], box: [-0.1, 0.0, 0.035, 0.1, 0.2, 0.2] } }, boltAxis: [0, 0.085, 0],
  },
  rocket_launcher: {
    grip: GUN_GRIP(0.2, 0.0, 0.0), sup: { a: [0.15, 1, 0], f: [1, -0.1, 0.15], p: [0.3, 0.035, 0.0], pose: 'grip' },
    sights: [[0.06, 0.305, -0.06], [0.2, 0.305, -0.06]], relief: 0.24, rec: [0.12, 0.13, 0.03, 0.02], reload: 'rocket',
    parts: { warhead: { col: ['#6a7448', '#7a8452'] } },
  },
  pipe_pistol: {
    grip: GUN_GRIP(0.28, -0.035, -0.022), sights: [[-0.06, 0.152, 0], [0.33, 0.126, 0]], relief: 0.32,
    rec: [0.04, 0.12, 0.04, 0.008], reload: 'pistol',
  },
  revolver: {
    grip: GUN_GRIP(0.35, -0.04, -0.02), sights: [[-0.05, 0.148, 0], [0.27, 0.138, 0]], relief: 0.32,
    rec: [0.05, 0.22, 0.05, 0.012], reload: 'revolver', parts: { cyl: { col: ['#4a4c52'], box: [-0.01, 0.0, -0.06, 0.0795, 0.15, 0.06] } }, cylAxis: [0, 0.028, -0.026],
  },
  bow: { sights: [[-0.43, 0.02, 0], [0.62, 0.02, 0]], relief: 0.14, rec: [0.01, 0.02, 0.01, 0], reload: 'nock', parts: { arrow: { col: ['#cfb488', '#555b63', '#b8402f'] } } },
  // extra guns (data in weapons_extra.js; part colours match the held models in models_chars.js)
  // flashS = muzzle flash scale (0 = none); crank = crossbow string / arrow / ratchet; box = LMG feed cover + ammo box
  crossbow: {
    grip: GUN_GRIP(0.35, -0.04, -0.028), sup: { a: [1, 0, 0], f: [0, 0.35, 1], p: [0.3, 0.045, 0.004] },
    sights: [[-0.004, 0.128, 0], [0.5, 0.127, 0]], relief: 0.22, rec: [0.035, 0.07, 0.02, 0.008], reload: 'crank', flashS: 0,
    parts: { strR: { col: ['#e8e2d0'] }, strL: { col: ['#d9d2bf'] }, quarrel: { col: ['#cdb27c', '#5f656e', '#c23a2a'] }, crank: { col: ['#a7adb5', '#b8402f'] } },
    crankC: [0.16, 0.05, -0.036], crankK: [0.16 + Math.cos(-2.4) * 0.056, 0.05 + Math.sin(-2.4) * 0.056, -0.07], nockX: 0.29, tipZ: 0.343,
  },
  nailgun: {
    grip: GUN_GRIP(0.35, -0.04, -0.02), sights: [[-0.06, 0.134, 0], [0.19, 0.14, 0]], relief: 0.3, hip: [0.15, -0.15, -0.43, 0.04, 0.28, -0.04],
    rec: [0.014, 0.035, 0.018, 0.004], auto: 1, reload: 'mag', flashS: 0,
    parts: { mag: { col: ['#c9ced6', '#c8402e'] } }, magOut: [-0.17, -0.055, 0.0, 0.0, 0.0, 0.0], magPivot: [0.05, 0.018, -0.01], magTilt: 0.45,
  },
  semi_rifle: {
    grip: GUN_GRIP(0.35, -0.04, -0.028), sup: { a: [1, 0.03, 0], f: [0, 0.35, 1], p: [0.33, 0.065, 0.004] },
    sights: [[-0.045, 0.168, 0], [0.75, 0.152, 0]], relief: 0.26, rec: [0.045, 0.09, 0.03, 0.008], reload: 'mag', flashS: 1.7,
    parts: { mag: { col: ['#33363c', '#4a4e56'] } }, magOut: [0.02, -0.34, 0.06, 0.0, 0.0, -0.5], magPivot: [0.11, 0.0, 0],
  },
  sniper: {
    grip: { a: [-0.42, 0.91, 0], f: [0.91, 0.42, 0], p: [-0.07, 0.006, 0] }, sup: { a: [1, 0, 0], f: [0, 0.35, 1], p: [0.36, 0.04, 0.004] },
    sights: [[-0.13, 0.17, 0], [0.3, 0.17, 0]], relief: 0.07, rec: [0.1, 0.22, 0.035, 0.016], reload: 'bolt', boltAct: 1, scope: 2, zoom: 0.38, flashS: 2.3,
    parts: { bolt: { col: ['#4a4c52'], box: [-0.1, 0.0, 0.035, 0.1, 0.2, 0.2] } }, boltAxis: [0, 0.085, 0],
  },
  lmg: {
    grip: GUN_GRIP(0.35, -0.04, -0.028), sup: { a: [1, 0, 0], f: [0, 0.3, 1], p: [0.4, 0.07, 0.004] },
    sights: [[-0.035, 0.172, 0], [0.72, 0.153, 0]], relief: 0.28, rec: [0.04, 0.065, 0.035, 0.01], auto: 1, reload: 'box', flashS: 2.0,
    hip: [0.21, -0.22, -0.45, 0.04, 0.12, -0.06],
    parts: { mag: { col: ['#56603a', '#434b2e', '#e3c35a', '#c49a45'] }, cover: { col: ['#5a6440'] } },
    magOut: [0.02, -0.32, -0.08, 0.0, 0.3, -0.35], magPivot: [0.11, 0.0, -0.03], coverHinge: [-0.05, 0.149, 0],
  },
  minigun: {
    grip: GUN_GRIP(0.35, -0.06, -0.028), sup: { a: [1, 0, 0], f: [0, 0.3, 1], p: [0.26, 0.205, 0.004] },
    sights: [[-0.05, 0.25, 0], [0.86, 0.235, 0]], relief: 0.3, rec: [0.012, 0.02, 0.025, 0.004], auto: 1, reload: 'box', flashS: 2.2,
    hip: [0.21, -0.24, -0.45, 0.04, 0.12, -0.06],
    parts: { mag: { col: ['#4a4f40', '#3b4033', '#e3c35a'] }, spin: { col: ['#8a9099'] } },
    magOut: [0.02, -0.32, -0.08, 0.0, 0.3, -0.35], magPivot: [0.05, -0.02, -0.06], spinAxis: [0, 0.06, 0],
  },
  // second wave (weapons_extra.js)
  waterpipe: {
    grip: GUN_GRIP(0.35, -0.04, -0.028), sup: { a: [1, 0, 0], f: [0, 0.35, 1], p: [0.3, 0.045, 0.004] },
    sights: [[0.0, 0.112, 0], [0.68, 0.118, 0]], relief: 0.26, rec: [0.1, 0.24, 0.05, 0.014], reload: 'break', flashS: 2.1,
    parts: { barrels: { box: [0.1, 0.052, -0.06, 0.75, 0.13, 0.06] } }, hinge: [0.1, 0.05, 0],
  },
  semi_pistol: {
    grip: GUN_GRIP(0.3, -0.03, -0.002), sights: [[0.012, 0.13, 0], [0.19, 0.129, 0]], relief: 0.32,
    rec: [0.035, 0.11, 0.035, 0.008], reload: 'pistol', flashS: 1.1,
  },
  magnum: {
    grip: GUN_GRIP(0.35, -0.04, -0.02), sights: [[-0.02, 0.124, 0], [0.352, 0.134, 0]], relief: 0.32,
    rec: [0.06, 0.26, 0.05, 0.014], reload: 'revolver', flashS: 1.6, parts: { cyl: { col: ['#8d9199'], box: [-0.01, 0.0, -0.06, 0.0805, 0.15, 0.06] } }, cylAxis: [0, 0.028, -0.026],
  },
  tac_smg: {
    grip: GUN_GRIP(0.35, -0.04, -0.028), sup: { a: [1, 0, 0], f: [0, 0.3, 1], p: [0.3, 0.075, 0.004] },
    sights: [[-0.045, 0.15, 0], [0.405, 0.139, 0]], relief: 0.22, rec: [0.02, 0.03, 0.02, 0.004], auto: 1, reload: 'mag', flashS: 1.3,
    parts: { mag: { col: ['#2b2d31'] } }, magOut: [0.02, -0.3, 0.06, 0.0, 0.0, -0.5], magPivot: [0.11, 0.03, 0],
  },
  lancer: {
    grip: GUN_GRIP(0.35, -0.04, -0.028), sup: { a: [1, 0.03, 0], f: [0, 0.35, 1], p: [0.32, 0.08, 0.004] },
    sights: [[-0.04, 0.152, 0], [0.5, 0.155, 0]], relief: 0.27, rec: [0.025, 0.035, 0.018, 0.005], auto: 1, reload: 'mag', flashS: 1.5,
    parts: { mag: { col: ['#26282c', '#3a3c41'] } }, magOut: [0.02, -0.34, 0.06, 0.0, 0.0, -0.5], magPivot: [0.12, 0.03, 0],
  },
  auto_shotgun: {
    grip: GUN_GRIP(0.35, -0.04, -0.028), sup: { a: [1, 0, 0], f: [0, 0.35, 1], p: [0.38, 0.06, 0.004] },
    sights: [[-0.03, 0.14, 0], [0.7, 0.135, 0]], relief: 0.22, rec: [0.075, 0.17, 0.045, 0.012], reload: 'shells', flashS: 2.0,
  },
  // tools / melee (handle along +X, head up = thumb side)
  rock: { tool: { a: [0, 1, 0.3], f: [1, 0, 0], p: [-0.005, -0.01, 0] }, pose: 'ball', hip: [0.21, -0.2, -0.4, 0.3, 0.3, -0.5] },
  torch: { tool: { a: [1, 0, 0], f: [0, -1, 0], p: [-0.03, 0, 0] } },
  hatchet: { tool: { a: [1, 0, 0], f: [0, -1, 0], p: [-0.03, 0, 0] } },
  salv_axe: { tool: { a: [1, 0, 0], f: [0, -1, 0], p: [-0.03, 0, 0] } },
  hammer: { tool: { a: [1, 0, 0], f: [0, -1, 0], p: [-0.04, 0, 0] }, hip: [0.22, -0.21, -0.42, 0.6, 0.3, -0.35] },
  knife: { tool: { a: [1, 0, 0], f: [0, 0, 1], p: [-0.025, 0, 0] }, hip: [0.19, -0.18, -0.38, 0.8, 0.35, -0.6] },
  machete: { tool: { a: [1, 0, 0], f: [0, 0, 1], p: [-0.04, 0, 0] }, hip: [0.2, -0.2, -0.4, 0.85, 0.3, -0.6] },
  pickaxe: { tool: { a: [1, 0, 0], f: [0, -1, 0], p: [0.0, 0, 0] }, sup: { a: [1, 0, 0], f: [0, -1, 0], p: [-0.2, 0, 0] } },
  salv_pick: { tool: { a: [1, 0, 0], f: [0, -1, 0], p: [0.0, 0, 0] }, sup: { a: [1, 0, 0], f: [0, -1, 0], p: [-0.2, 0, 0] } },
  spear_wood: { tool: { a: [1, 0, 0], f: [0, -0.7, -1], p: [0.0, 0, 0] }, sup: { a: [1, 0, 0], f: [0, 0.5, 1], p: [0.38, 0, 0], pose: 'grip' } },
  fishing_rod: { tool: { a: [1, 0, 0], f: [0, -1, 0], p: [-0.02, 0, 0] } },
  buildplan: { tool: { a: [-1, 0, 0], f: [0, -0.3, -1], p: [0.31, 0, 0] }, sup: { a: [1, 0, 0], f: [0, -0.3, -1], p: [-0.01, 0, 0], pose: 'grip' } },
  // throwables / consumables
  grenade: { tool: { a: [0, 1, 0.4], f: [1, 0, 0], p: [0.02, 0.0, 0.0] }, pose: 'ball' },
  beancan: { tool: { a: [0, 1, 0.4], f: [1, 0, 0], p: [0.02, 0.0, 0.0] }, pose: 'ball' },
  satchel: { tool: { a: [0, 1, 0], f: [1, 0, 0], p: [0.04, 0.06, 0.0] }, pose: 'grip' },
  c4: { tool: { a: [0, 1, 0.3], f: [1, 0, 0], p: [0.03, -0.02, 0.0] }, pose: 'ball' },
  supply_signal: { tool: { a: [0, 1, 0], f: [1, 0, 0], p: [0.02, 0.0, 0.0] }, pose: 'grip' },
  bandage: { tool: { a: [0, 0, 1], f: [1, -0.3, 0], p: [0.0, -0.005, 0.0] }, pose: 'ball' },
  medkit: { tool: { a: [0, 0, 1], f: [1, 0, 0], p: [-0.05, 0.0, 0.0] }, pose: 'grip' },
  stim: { tool: { a: [-1, 0, 0], f: [0, -1, 0], p: [0.04, 0, 0] }, pose: 'grip' },
  antirad: { tool: { a: [-1, 0, 0], f: [0, -1, 0], p: [0.04, 0, 0] }, pose: 'grip' },
  food: { tool: { a: [0, 1, 0], f: [1, 0, 0], p: [0.02, 0.01, 0] }, pose: 'ball' },
  cooked_meat: { tool: { a: [1, 0, 0], f: [0, -1, 0.3], p: [-0.04, 0, 0] }, pose: 'grip' },
  water_bottle: { tool: { a: [0, 1, 0], f: [1, 0, 0], p: [0.0, 0.03, 0] }, pose: 'grip' },
  flare: { tool: { a: [1, 0, 0], f: [0, -1, 0], p: [0.02, 0, 0] }, pose: 'grip' },
};

// ---------------------------------------------------------------- keyframed offsets [t, dx, dy, dz, pitch, yaw, roll]
const TR = {
  equip: [[0, 0.03, -0.32, 0.06, -0.85, 0.15, 0.35], [0.5, 0.0, 0.012, 0.0, 0.07, 0.0, -0.02], [0.78, 0, -0.004, 0, -0.015, 0, 0], [1, 0, 0, 0, 0, 0, 0]],
  chop: [[0, 0, 0, 0, 0, 0, 0], [0.16, 0.03, 0.07, 0.08, 0.5, -0.06, -0.12], [0.35, 0.06, 0.15, 0.14, 1.0, -0.12, -0.25],
    [0.44, -0.04, 0.03, -0.12, -0.35, 0.16, 0.12], [0.53, -0.1, -0.13, -0.14, -1.15, 0.28, 0.28], [0.62, -0.09, -0.12, -0.08, -1.05, 0.24, 0.22],
    [0.82, -0.03, -0.04, -0.02, -0.3, 0.06, 0.05], [1, 0, 0, 0, 0, 0, 0]],
  chop2: [[0, 0, 0, 0, 0, 0, 0], [0.16, 0.0, 0.07, 0.1, 0.45, -0.1, 0.15], [0.35, -0.02, 0.16, 0.16, 0.9, -0.2, 0.3],
    [0.45, -0.06, 0.02, -0.14, -0.4, 0.05, 0.1], [0.55, -0.1, -0.15, -0.16, -1.05, 0.15, 0.0], [0.64, -0.09, -0.13, -0.1, -0.95, 0.12, 0.0],
    [0.84, -0.02, -0.03, -0.02, -0.25, 0.03, 0.0], [1, 0, 0, 0, 0, 0, 0]],
  slash: [[0, 0, 0, 0, 0, 0, 0], [0.18, 0.06, 0.04, 0.05, 0.15, -0.55, -0.25], [0.35, 0.12, 0.06, 0.06, 0.25, -1.05, -0.45],
    [0.45, -0.04, 0.0, -0.16, 0.0, 0.35, 0.25], [0.55, -0.26, -0.08, -0.06, -0.25, 1.2, 0.65], [0.64, -0.27, -0.1, -0.03, -0.3, 1.15, 0.6],
    [0.84, -0.06, -0.03, 0, -0.08, 0.25, 0.12], [1, 0, 0, 0, 0, 0, 0]],
  // absolute swing poses [t, x, y, z, pitch, yaw, roll] (blended in/out of the idle pose)
  chopA: [[0.08, 0.23, -0.17, -0.4, 1.0, 0.25, -0.3], [0.2, 0.27, -0.1, -0.38, 1.45, 0.2, -0.3], [0.35, 0.3, -0.01, -0.34, 1.9, 0.12, -0.35],
    [0.45, 0.15, -0.07, -0.44, 0.6, 0.24, -0.16], [0.52, 0.09, -0.15, -0.47, -0.04, 0.3, -0.08], [0.62, 0.09, -0.16, -0.46, -0.1, 0.3, -0.08],
    [0.78, 0.15, -0.21, -0.43, 0.2, 0.3, -0.2]],
  chop2A: [[0.08, 0.2, -0.17, -0.42, 0.8, 0.4, -0.6], [0.2, 0.23, -0.08, -0.38, 1.4, 0.3, -0.45], [0.35, 0.25, 0.0, -0.36, 1.85, 0.2, -0.35],
    [0.45, 0.1, -0.07, -0.44, 0.55, 0.2, -0.15], [0.53, 0.06, -0.15, -0.48, -0.08, 0.18, -0.05], [0.63, 0.06, -0.16, -0.47, -0.14, 0.18, -0.05],
    [0.78, 0.13, -0.2, -0.44, 0.2, 0.3, -0.35]],
  slashA: [[0.08, 0.24, -0.17, -0.38, 0.6, -0.2, 0.0], [0.22, 0.29, -0.12, -0.33, 0.2, -0.95, 0.25], [0.35, 0.31, -0.1, -0.3, 0.2, -1.3, 0.35],
    [0.45, 0.12, -0.13, -0.43, 0.02, 0.45, 0.15], [0.54, -0.13, -0.17, -0.38, -0.1, 1.15, -0.1], [0.64, -0.13, -0.19, -0.36, -0.15, 1.15, -0.1],
    [0.8, 0.08, -0.2, -0.38, 0.3, 0.5, -0.4]],
  thrust: [[0, 0, 0, 0, 0, 0, 0], [0.2, 0.02, 0.0, 0.12, 0.06, -0.03, 0], [0.35, 0.03, 0.01, 0.17, 0.08, -0.04, 0],
    [0.46, -0.05, 0.03, -0.44, -0.04, 0.06, 0], [0.55, -0.055, 0.03, -0.47, -0.05, 0.07, 0], [0.8, -0.01, 0.0, -0.1, -0.01, 0.01, 0], [1, 0, 0, 0, 0, 0, 0]],
  punch: [[0, 0, 0, 0, 0, 0, 0], [0.25, 0.02, -0.015, 0.06, -0.05, 0.0, 0.1], [0.36, 0.02, -0.01, 0.07, -0.05, 0, 0.12],
    [0.47, -0.11, 0.06, -0.3, 0.05, 0.12, -0.9], [0.56, -0.12, 0.065, -0.32, 0.05, 0.12, -0.95], [0.78, -0.03, 0.01, -0.05, 0, 0.03, -0.25], [1, 0, 0, 0, 0, 0, 0]],
  tap: [[0, 0, 0, 0, 0, 0, 0], [0.28, 0.01, 0.05, 0.04, 0.45, 0, 0], [0.42, -0.02, -0.05, -0.06, -0.45, 0.05, 0], [0.55, -0.02, -0.045, -0.05, -0.4, 0.05, 0], [1, 0, 0, 0, 0, 0, 0]],
  planTap: [[0, 0, 0, 0, 0, 0, 0], [0.25, 0, 0.02, 0.025, 0.1, 0, 0], [0.42, 0, -0.012, -0.06, -0.1, 0, 0.02], [0.6, 0, -0.006, -0.03, -0.04, 0, 0], [1, 0, 0, 0, 0, 0, 0]],
  // fishing rod cast: wind back over the shoulder, whip forward, settle
  rodCast: [[0, 0, 0, 0, 0, 0, 0], [0.28, 0.01, 0.06, 0.07, 0.5, -0.06, 0.06], [0.44, -0.01, 0.0, -0.06, -0.42, 0.04, -0.02], [0.58, -0.01, -0.02, -0.05, -0.32, 0.02, 0], [1, 0, 0, 0, 0, 0, 0]],
  // throw: game starts it at the release; cocked pose comes from aimThrow / ads
  cock: [0.02, 0.07, 0.05, 0.6, -0.2, -0.3],
  throw: [[0, 0.02, 0.07, 0.05, 0.6, -0.2, -0.3], [0.1, -0.02, 0.12, -0.25, -0.2, 0.1, 0.1], [0.24, -0.14, -0.14, -0.22, -1.0, 0.3, 0.4],
    [0.45, -0.05, -0.38, -0.05, -0.8, 0.1, 0.2], [0.7, 0.0, -0.3, 0.0, -0.5, 0, 0], [1, 0, 0, 0, 0, 0, 0]],
  mouthA: [[0.1, 0.13, -0.19, -0.3, 0.7, 0.5, -0.1], [0.24, 0.06, -0.235, -0.23, 1.15, 0.85, 0.0], [0.82, 0.055, -0.235, -0.23, 1.2, 0.85, 0.0]],
  drinkA: [[0.1, 0.12, -0.17, -0.3, 0.5, 0.3, 0.0], [0.24, 0.045, -0.17, -0.2, 1.2, 0.2, 0.0], [0.82, 0.045, -0.17, -0.2, 1.35, 0.2, 0.0]],
  recoilDummy: [[0, 0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0, 0]],
};

// ============================================================================
// ARM GEOMETRY (one skinned mesh, both arms)
// ============================================================================
// colour kinds
const K = { SKIN: 0, WARM: 1, NAIL: 2, SLEEVE: 3, CUFF: 4, GLOVE: 5, GLOVEW: 6, BAND: 7, FACE: 8, PALE: 9 };
const NB = 9;   // bones per arm: upper, fore, hand, idx1, idx2, fin1, fin2, th1, th2
const B = { UP: 0, FORE: 1, HAND: 2, I1: 3, I2: 4, F1: 5, F2: 6, T1: 7, T2: 8 };
// knuckle / joint layout (right hand, hand-bone space: wrist at origin, fingers along -Z, back of hand +Y, thumb at -X)
const PALM_L = 0.088, KN_Y = 0.003;
const FING = [ // x, proximal length, distal length, width, height
  [-0.0275, 0.044, 0.046, 0.0195, 0.019],
  [-0.009, 0.047, 0.051, 0.0198, 0.0195],
  [0.0098, 0.045, 0.047, 0.019, 0.0188],
  [0.0272, 0.039, 0.038, 0.0168, 0.0168],
];
const PROX = 0.046;                                 // shared joint for fin2 (middle/ring/pinky)
const TH_BASE = new THREE.Vector3(-0.027, -0.007, -0.02), TH_L1 = 0.05, TH_L2 = 0.034;
const TH_REST = [0.55, -0.25, 0.9];                 // thumb rest yaw (out) / pitch (palmward -) / roll (nail outwards)

class ArmBuilder {
  constructor() { this.P = []; this.N = []; this.K = []; this.S = []; this.B = []; this.mx = 1; this.bone = 0; }
  vtx(v) { this.P.push(v[0] * this.mx, v[1], v[2]); this.N.push(v[3] * this.mx, v[4], v[5]); this.K.push(v[6]); this.S.push(v[7]); this.B.push(this.bone); }
  tri(a, b, c) { if (this.mx < 0) { const t = b; b = c; c = t; } this.vtx(a); this.vtx(b); this.vtx(c); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  /** tapered box from z0 (w0 x h0) to z1 (w1 x h1) centred on (cx, cy), normals rounded by r */
  box(cx, cy, z0, z1, w0, h0, w1, h1, kind, shade = 1, r = 0.55, shadeFn = null) {
    const zc = (z0 + z1) / 2, hz = Math.abs(z1 - z0) / 2 || 1e-4, hw = Math.max(w0, w1) / 2, hh = Math.max(h0, h1) / 2;
    const c = (sx, sy, e) => { const w = e ? w1 : w0, h = e ? h1 : h0; return [cx + sx * w / 2, cy + sy * h / 2, e ? z1 : z0]; };
    const C = [c(-1, -1, 0), c(1, -1, 0), c(1, 1, 0), c(-1, 1, 0), c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)];
    const faces = [[0, 1, 2, 3], [5, 4, 7, 6], [1, 5, 6, 2], [4, 0, 3, 7], [3, 2, 6, 7], [4, 5, 1, 0]];
    const sgn = z1 < z0 ? 1 : -1;
    for (const f of faces) {
      const p = f.map(i => C[i]);
      // face normal from the quad
      const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2], vx = p[3][0] - p[0][0], vy = p[3][1] - p[0][1], vz = p[3][2] - p[0][2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl; nx *= sgn; ny *= sgn; nz *= sgn;
      const vv = p.map(q => {
        let rx = (q[0] - cx) / hw, ry = (q[1] - cy) / hh, rz = (q[2] - zc) / hz; const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
        let ax = nx * (1 - r) + rx * r, ay = ny * (1 - r) + ry * r, az = nz * (1 - r) + rz * r; const al = Math.hypot(ax, ay, az) || 1;
        ax /= al; ay /= al; az /= al;
        const s = shade * (shadeFn ? shadeFn(q[0], q[1], q[2], ax, ay, az) : 1);
        return [q[0], q[1], q[2], ax, ay, az, kind, s];
      });
      if (sgn > 0) this.quad(vv[0], vv[1], vv[2], vv[3]); else this.quad(vv[0], vv[3], vv[2], vv[1]);
    }
  }
  /** elliptical tube along -Z through rings [[z, rx, ry, cy?], ...] with smooth normals (+ end caps) */
  tube(rings, seg, kind, shadeFn, capA = true, capB = true, rot = 0) {
    const pts = rings.map(([z, rx, ry, cy = 0, cx = 0]) => {
      const a = []; for (let i = 0; i <= seg; i++) {
        const t = (i / seg) * TAU + rot, c = Math.cos(t), s = Math.sin(t);
        const nl = Math.hypot(c / rx, s / ry);
        a.push([cx + c * rx, cy + s * ry, z, c / rx / nl, s / ry / nl, 0]);
      }
      return a;
    });
    const sh = (q, k) => [q[0], q[1], q[2], q[3], q[4], q[5], kind, shadeFn ? shadeFn(q[0], q[1], q[2], q[3], q[4], k) : 1];
    for (let r = 0; r < pts.length - 1; r++) for (let i = 0; i < seg; i++) {
      const a = sh(pts[r][i], r), b = sh(pts[r][i + 1], r), c = sh(pts[r + 1][i + 1], r + 1), d = sh(pts[r + 1][i], r + 1);
      // ring r is nearer (+z): wind so the outside faces out
      this.quad(a, d, c, b);
    }
    const cap = (ring, dir) => {
      const z = ring[0][2]; let cx = 0, cy = 0; for (let i = 0; i < seg; i++) { cx += ring[i][0]; cy += ring[i][1]; } cx /= seg; cy /= seg;
      const m = [cx, cy, z, 0, 0, dir, kind, shadeFn ? shadeFn(cx, cy, z, 0, 0, -1) : 1];
      for (let i = 0; i < seg; i++) {
        const a = [ring[i][0], ring[i][1], z, 0, 0, dir, kind, m[7]], b = [ring[i + 1][0], ring[i + 1][1], z, 0, 0, dir, kind, m[7]];
        if (dir > 0) this.tri(m, a, b); else this.tri(m, b, a);
      }
    };
    if (capA) cap(pts[0], 1);
    if (capB) cap(pts[pts.length - 1], -1);
  }
}

function buildArm(g, side) {
  g.mx = side; const off = side > 0 ? 0 : NB;
  // ---- upper arm: sleeve
  g.bone = off + B.UP;
  g.tube([[0.04, 0.06, 0.058], [-0.12, 0.058, 0.056], [-LA + 0.02, 0.054, 0.052], [-LA - 0.04, 0.05, 0.048]], 10, K.SLEEVE,
    (x, y, z, nx, ny) => 0.92 + 0.08 * ny, true, true);
  // ---- forearm: skin, rolled sleeve at the elbow (+ watch on the left wrist)
  g.bone = off + B.FORE;
  const ao = (x, y, z, nx, ny) => (1.0 + 0.07 * Math.max(0, -ny)) * lerp(0.78, 1, sat((-z - 0.03) / 0.09));
  g.tube([[0.02, 0.046, 0.044], [-0.06, 0.048, 0.043], [-0.13, 0.043, 0.036], [-0.21, 0.035, 0.026], [-LB - 0.004, 0.0305, 0.0215], [-LB - 0.016, 0.029, 0.02]], 10, K.SKIN, ao, false, true);
  // rolled cuff: two fat folds
  g.tube([[0.07, 0.055, 0.053], [0.02, 0.059, 0.057], [-0.012, 0.064, 0.061], [-0.03, 0.06, 0.057], [-0.042, 0.063, 0.06], [-0.064, 0.061, 0.058], [-0.076, 0.052, 0.049]], 10, K.CUFF,
    (x, y, z, nx, ny, k) => (k === 3 ? 0.72 : k === 2 || k === 4 ? 1.06 : 0.95) * (0.9 + 0.1 * ny), true, true);
  if (side < 0) {
    const zw = -LB + 0.03;
    g.tube([[zw + 0.011, 0.0345, 0.0255], [zw - 0.011, 0.0335, 0.0245]], 10, K.BAND, null, true, true);
    g.box(0, 0.026, zw + 0.013, zw - 0.013, 0.025, 0.008, 0.025, 0.008, K.FACE, 1, 0.3);
  }
  // ---- hand: palm, thenar pad, knuckle ridge
  g.bone = off + B.HAND;
  const palmSh = (x, y, z, nx, ny) => (ny < -0.3 ? 0.93 : 1.0);
  g.box(0, 0.0, 0.014, -PALM_L + 0.004, 0.06, 0.032, 0.08, 0.027, K.GLOVE, 1, 0.55, palmSh);
  g.box(-0.017, -0.009, -0.004, -0.05, 0.03, 0.022, 0.026, 0.018, K.GLOVE, 0.96, 0.8);
  g.box(0.0, 0.006, -PALM_L + 0.016, -PALM_L - 0.004, 0.078, 0.02, 0.076, 0.018, K.GLOVEW, 1.0, 0.75);
  // ---- fingers
  const finger = (fi, b1, b2, bx, L1) => {
    const [x, , l2, w, h] = FING[fi];
    g.bone = off + b1;
    g.box(x - bx, 0, 0.007, -L1, w, h, w * 0.94, h * 0.92, K.GLOVE, 1, 0.6);
    g.bone = off + b2;
    g.box(x - bx, -0.0005, 0.006, -l2, w * 0.93, h * 0.9, w * 0.78, h * 0.72, K.SKIN, 1, 0.65, (q0, q1, q2, nx, ny) => (ny < -0.4 ? 0.95 : 1));
    g.box(x - bx, h * 0.36, -l2 + 0.017, -l2 + 0.003, w * 0.62, 0.004, w * 0.58, 0.003, K.NAIL, 1, 0.4);
  };
  finger(0, B.I1, B.I2, FING[0][0], FING[0][1]);
  for (let f = 1; f < 4; f++) finger(f, B.F1, B.F2, 0, PROX);
  // ---- thumb
  g.bone = off + B.T1;
  g.box(0, 0, 0.012, -TH_L1, 0.026, 0.022, 0.022, 0.019, K.GLOVE, 1, 0.6);
  g.bone = off + B.T2;
  g.box(0, 0, 0.006, -TH_L2, 0.0215, 0.019, 0.0175, 0.0145, K.SKIN, 1, 0.65);
  g.box(0, 0.0072, -TH_L2 + 0.018, -TH_L2 + 0.003, 0.014, 0.004, 0.013, 0.003, K.NAIL, 1, 0.4);
}

// ============================================================================
// VIEW MODEL
// ============================================================================
export class ViewModel {
  constructor(models) {
    this.models = models && models.makeHeld ? models : null;
    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = true;
    this.camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.01, 10);
    this.mainFov = null;           // main camera vertical FOV (deg) for muzzleView re-projection (st.fov sets it)
    this.flash = true;             // draw our own muzzle flash
    this.hidden = false;
    // ---- lights (driven by setLighting)
    this.hemi = new THREE.HemisphereLight(0xd2e2ff, 0x5f503e, 1.0);
    this.sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
    this.amb = new THREE.AmbientLight(0x000000, 1);
    this.pl = new THREE.PointLight(0xff9a40, 0, 4, 2);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.amb, this.pl);
    this._L = { sky: new THREE.Color(0xd2e2ff), ground: new THREE.Color(0x5f503e), hemiI: 1.0, sunDir: new THREE.Vector3(-0.5, 0.8, 0.35).normalize(), sunCol: new THREE.Color(0xfff2dc), sunI: 2.2, extra: new THREE.Color(0, 0, 0) };
    this._camQ = new THREE.Quaternion(); this._hasCam = false; this._tc = new THREE.Color();
    // ---- item holder
    this.itemG = new THREE.Group(); this.itemG.matrixAutoUpdate = false; this.scene.add(this.itemG);
    this.held = null; this.id = undefined; this.info = null; this.cfg = null;
    this._matClone = new Map();
    this._attId = null; this._att = null; this._attK = ''; this.laserD = 0;
    // ---- arms
    this._buildArms();
    this._buildFlash();
    this._buildScope();
    this._buildAttachFx();
    // ---- runtime state
    this.time = 0; this.phase = 0; this.eq = 1; this.kSprint = 0; this.kCrouch = 0; this.kMove = 0; this.kAir = 0;
    this.sw = new Float32Array(4); this.swV = new Float32Array(4);           // sway springs: yaw, pitch, x, y
    this.jy = 0; this.jv = 0; this.wasAir = false;                            // jump / land spring
    this.rec = new Float32Array(5); this.recV = new Float32Array(5);          // recoil springs: back, pitch, yaw, roll, up
    this.heat = 0; this.shotT = 9; this.flashT = 9; this.punchSide = 0; this.lastSwing = -1; this.lastThrow = -1; this.lastReload = -1;
    this.cocked = 0; this.throwFrom = 0; this.draw = 0; this.bowAim = 0; this.arrowGone = false; this.relT = 9; this.lastD = -1; this.cycT = 9; this.scopeK = 0;
    this.flick = 0; this.nightK = 0;
    this.poseR = new Float32Array(7); this.poseL = new Float32Array(7);
    this.poseR.set(FP.relax); this.poseL.set(FP.relax);
    // pose Xfs
    this.W = new Xf(); this.Wh = new Xf(); this.Wa = new Xf(); this.Ws = new Xf(); this.G = new Xf();
    this.hR = new Xf(); this.hL = new Xf(); this.freeL = new Xf(); this.freeR = new Xf();
    this.xa = new Xf(); this.xb = new Xf(); this.xc = new Xf(); this.xs = new Xf(); this.lmo = new Xf();
    // constant mounts / carriers
    this.mBolt = mount(new Xf(), 1, [0.2, 0.0, 1], [0.6, -1, 0.2], [-0.012, 0.075, 0.1]);
    this.mFistL = mount(new Xf(), -1, [0, 0.55, 0.83], [1, 0, 0], [0, 0, 0]);
    this.mOpenL = mount(new Xf(), -1, [0, 1, 0.2], [1, 0, 0], [0, 0, 0]);
    this.mFlatL = mount(new Xf(), -1, [0, 1, 0], [1, 0, 0], [0, 0, 0]);
    const fh = CLS.fists.hip; this.fistL = new Xf().pose([-fh[0], fh[1] - 0.015, fh[2] - 0.02, fh[3], -fh[4], -fh[5]]);
    // presented left forearm (bandage / injection): wrist, axis towards the elbow, and a ring frame around it
    const pres = new Xf().mul(new Xf().pose(P_USE_L), this.mFlatL);
    this.poleK[1] = 1; this._arm(1, pres); this.poleK[1] = 0;   // solve once to find where the presented forearm lies
    this.wA = this.elbow[1].clone().sub(pres.p).normalize();
    this.wC = pres.p.clone().addScaledVector(this.wA, 0.065);
    this.wU = new THREE.Vector3(0, 1, 0).addScaledVector(this.wA, -this.wA.y).normalize();
    this.wV = new THREE.Vector3().crossVectors(this.wA, this.wU);
    this.gm = new THREE.Matrix4(); this.wm = new THREE.Matrix4();
    this.muzzleLocal = new THREE.Vector3();
    this.flameUp = new THREE.Vector3(0, 1, 0);
    this.setLook({});
    this.setItem(null);
    this.eq = 1;
  }

  // ------------------------------------------------------------------ arms mesh
  _buildArms() {
    const g = new ArmBuilder();
    buildArm(g, 1); buildArm(g, -1);
    const n = g.P.length / 3;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.N, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = g.B[i]; sw[i * 4] = 1; }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    this._kind = Uint8Array.from(g.K); this._shade = Float32Array.from(g.S);
    this.bones = [];
    for (let i = 0; i < NB * 2; i++) { const b = new THREE.Bone(); b.matrixAutoUpdate = false; b.matrixWorldAutoUpdate = false; this.bones.push(b); }
    this.skeleton = new THREE.Skeleton(this.bones);
    // built through M.mat (shared look / toon pipeline); private cache key so no other scene shares its program
    this.armMat = M.mat('#ffffff', { vc: true, viewmodel: 1 });
    this.arms = new THREE.SkinnedMesh(geo, this.armMat);
    this.arms.bind(this.skeleton, new THREE.Matrix4());
    this.arms.frustumCulled = false; this.arms.castShadow = this.arms.receiveShadow = false;
    this.arms.renderOrder = 1;
    this.scene.add(this.arms);
    // per-arm bone matrices in rig space (before the global offset)
    this.bm = []; for (let i = 0; i < NB * 2; i++) this.bm.push(new THREE.Matrix4());
    this.elbow = [new THREE.Vector3(), new THREE.Vector3()];
    this.poleK = new Float32Array(2);
    this.sh = [new THREE.Vector3(), new THREE.Vector3()];
  }

  _buildFlash() {
    // star + two crossed side flames, one additive mesh (radial-gradient canvas texture)
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,250,225,1)'); gr.addColorStop(0.25, 'rgba(255,214,120,0.95)'); gr.addColorStop(0.6, 'rgba(255,140,40,0.35)'); gr.addColorStop(1, 'rgba(255,90,10,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; this._flashTex = tex;
    const P = [], U = [];
    const quad = (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) => { P.push(ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz); U.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1); };
    // facing the shooter (YZ plane at the muzzle), local +X = barrel
    const s = 0.07; quad(0.01, -s, -s, 0.01, -s, s, 0.01, s, s, 0.01, s, -s);
    // side flames along the barrel (XY and XZ planes)
    const L = 0.2, w = 0.045;
    quad(-0.01, -w, 0, L, -w, 0, L, w, 0, -0.01, w, 0);
    quad(-0.01, 0, -w, L, 0, -w, L, 0, w, -0.01, 0, w);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    const fm = M.basic('#ffffff', { additive: true, side: 'double' }).clone();
    fm.map = tex; fm.fog = false;
    this.flashMesh = new THREE.Mesh(geo, fm);
    this.flashMesh.frustumCulled = false; this.flashMesh.visible = false; this.flashMesh.renderOrder = 3;
    this.itemG.add(this.flashMesh);
  }

  /** laser-sight beam (a thin additive line fading out along item +X) and the weapon-flashlight lens glow */
  _buildAttachFx() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 2; const x = c.getContext('2d');
    const gr = x.createLinearGradient(0, 0, 64, 0); gr.addColorStop(0, 'rgba(255,70,50,0.95)'); gr.addColorStop(0.5, 'rgba(255,50,30,0.45)'); gr.addColorStop(1, 'rgba(255,40,20,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 2);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const bg = new THREE.BoxGeometry(1, 0.003, 0.003); bg.translate(0.5, 0, 0);
    const bm = M.basic('#ffffff', { additive: true }).clone(); bm.map = tex; bm.fog = false; bm.depthWrite = false;
    this.beam = new THREE.Mesh(bg, bm); this.beam.frustumCulled = false; this.beam.visible = false; this.beam.renderOrder = 3; this.itemG.add(this.beam);
    const lg = new THREE.PlaneGeometry(0.08, 0.08);   // billboard: turned to face the eye every frame
    const lm = M.basic('#fff2c8', { additive: true, side: 'double' }).clone(); lm.map = this._flashTex; lm.fog = false; lm.depthWrite = false;
    this.lampGlow = new THREE.Mesh(lg, lm); this.lampGlow.frustumCulled = false; this.lampGlow.visible = false; this.lampGlow.renderOrder = 3; this.itemG.add(this.lampGlow);
  }

  _buildScope() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.scopeMat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: 1.7 }, uK: { value: 0 }, uS: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      // uS 0 = hunting scope (duplex cross + red dot); 1 = high-power scope (thin cross with mil dots,
      // a stadia ladder below, a lit red ring at the centre and a faint amber lens tint)
      fragmentShader: `varying vec2 vP; uniform float uA; uniform float uK; uniform float uS;
        void main(){
          vec2 p = vec2(vP.x * uA, vP.y); float r = length(p);
          float R = 0.9;
          float outside = smoothstep(R - 0.012, R + 0.004, r);
          float vig = smoothstep(R * 0.55, R, r) * 0.55;
          float hp = step(0.5, uS);
          float lw = mix(0.0035, 0.0026, hp) + step(0.33, abs(p.x)) * 0.006 + step(0.33, abs(p.y)) * 0.006;
          float gap = mix(0.02, 0.03, hp);
          float cross = (1.0 - smoothstep(lw, lw + 0.002, abs(p.y))) * step(gap, abs(p.x)) + (1.0 - smoothstep(lw, lw + 0.002, abs(p.x))) * step(gap, abs(p.y));
          // mil dots every 0.06 along both lines + short stadia bars under the centre
          float sp = 0.06;
          float dh = length(vec2((fract(p.x / sp + 0.5) - 0.5) * sp, p.y)), dv = length(vec2(p.x, (fract(p.y / sp + 0.5) - 0.5) * sp));
          float dots = (1.0 - smoothstep(0.0085, 0.0105, min(dh, dv))) * step(0.04, r) * step(max(abs(p.x), abs(p.y)), 0.31);
          float stad = 0.0;
          for (int i = 0; i < 4; i++) { float yi = 0.12 + float(i) * 0.05, wi = 0.05 - float(i) * 0.01; stad = max(stad, (1.0 - smoothstep(0.0018, 0.0032, abs(p.y + yi))) * step(abs(p.x), wi)); }
          cross = clamp(cross + max(dots, stad) * hp, 0.0, 1.0) * (1.0 - outside);
          float dotc = mix(1.0 - smoothstep(0.004, 0.007, r), (1.0 - smoothstep(0.003, 0.0048, abs(r - 0.013))), hp);
          float tint = hp * 0.07 * (1.0 - outside);
          float a = max(max(max(outside, vig), max(cross * 0.92, dotc)), tint);
          vec3 col = mix(vec3(0.0), vec3(0.75, 0.06, 0.04), dotc * (1.0 - outside));
          col = mix(col, vec3(0.55, 0.38, 0.12), tint / max(a, 0.001) * (1.0 - max(cross, dotc)) * (1.0 - vig));
          col = mix(col, vec3(1.0, 0.16, 0.08), dotc * hp * (1.0 - outside));
          gl_FragColor = vec4(col, a * uK);
        }`,
      transparent: true, depthTest: false, depthWrite: false,
    });
    this.scopeMesh = new THREE.Mesh(geo, this.scopeMat);
    this.scopeMesh.frustumCulled = false; this.scopeMesh.visible = false; this.scopeMesh.renderOrder = 10;
    this.scene.add(this.scopeMesh);
  }

  // ------------------------------------------------------------------ look
  setLook(look) {
    look = look || EMPTY;
    const C = this._cols || (this._cols = Array.from({ length: 10 }, () => new THREE.Color()));
    const skin = C[K.SKIN].set(look.skin || '#c69472');
    C[K.WARM].setRGB(skin.r * 1.04, skin.g * 0.88, skin.b * 0.84);
    C[K.PALE].setRGB(Math.min(1, skin.r * 1.08), Math.min(1, skin.g * 1.06), Math.min(1, skin.b * 1.04));
    C[K.NAIL].setRGB(lerp(skin.r, 1, 0.4), lerp(skin.g, 0.78, 0.4), lerp(skin.b, 0.74, 0.4));
    C[K.SLEEVE].set(look.sleeve || '#5a7040');
    C[K.CUFF].copy(C[K.SLEEVE]).multiplyScalar(0.86);
    if (look.glove) { C[K.GLOVE].set(look.glove); C[K.GLOVEW].copy(C[K.GLOVE]).multiplyScalar(0.85); }
    else { C[K.GLOVE].copy(skin); C[K.GLOVEW].copy(C[K.WARM]); }
    C[K.BAND].set('#2a2420'); C[K.FACE].set('#8f979e');
    const col = this.arms.geometry.attributes.color, a = col.array, kk = this._kind, ss = this._shade;
    for (let i = 0; i < kk.length; i++) { const c = C[kk[i]], s = ss[i]; a[i * 3] = Math.min(1, c.r * s); a[i * 3 + 1] = Math.min(1, c.g * s); a[i * 3 + 2] = Math.min(1, c.b * s); }
    col.needsUpdate = true;
  }

  // ------------------------------------------------------------------ lighting
  setLighting(o) {
    o = o || EMPTY; const L = this._L;
    if (o.hemiSky != null) L.sky.set(o.hemiSky);
    if (o.hemiGround != null) L.ground.set(o.hemiGround);
    if (o.hemiIntensity != null) L.hemiI = o.hemiIntensity;
    if (o.sunDir) L.sunDir.copy(o.sunDir).normalize();
    if (o.sunColor != null) L.sunCol.set(o.sunColor);
    if (o.sunIntensity != null) L.sunI = o.sunIntensity;
    L.extra.setRGB(0, 0, 0);
    if (o.extra) for (let i = 0; i < o.extra.length; i++) {
      const e = o.extra[i], k = (e.intensity || 0) * 0.35, tc = this._tc;
      tc.set(e.color || '#ffffff'); L.extra.r += tc.r * k; L.extra.g += tc.g * k; L.extra.b += tc.b * k;
    }
  }
  /** optional: the main camera (for true light directions in view space) */
  setCamera(cam) { if (cam) { cam.getWorldQuaternion(this._camQ); this._hasCam = true; if (cam.isPerspectiveCamera) this._mainCam = cam; } }
  _applyLights() {
    const L = this._L;
    this.hemi.color.copy(L.sky); this.hemi.groundColor.copy(L.ground); this.hemi.intensity = L.hemiI;
    this.sun.color.copy(L.sunCol); this.sun.intensity = L.sunI;
    this.amb.color.copy(L.extra);
    const inv = Qs[0];
    if (this._hasCam) {
      inv.copy(this._camQ).invert();
      this.hemi.position.copy(UP).applyQuaternion(inv);
      this.sun.position.copy(L.sunDir).applyQuaternion(inv).multiplyScalar(5);
    } else {
      // camera orientation unknown: keep the real sun elevation, key light from the upper left-front
      const el = clamp(L.sunDir.y, 0.15, 1), h = Math.sqrt(1 - el * el);
      this.hemi.position.set(0, 1, 0);
      this.sun.position.set(-0.55 * h, el, 0.45 * h).normalize().multiplyScalar(5);
    }
    this.sun.target.position.set(0, 0, 0);
  }

  // ------------------------------------------------------------------ item
  _clone(m) {
    let c = this._matClone.get(m);
    // private copy so the view-model scene (own lights, no fog) never swaps programs with the main scene;
    // keep any shader patch of the shared material
    if (!c) { c = m.clone(); c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey; c.fog = false; this._matClone.set(m, c); }
    return c;
  }
  /** attachments for gun `id` (used the next time it is built; rebuilds it now if it is the held gun) */
  setAttach(id, att) {
    id = id || null; att = id && att ? att : null;
    const k = att ? (att.sight || '') + ',' + (att.muzzle || '') + ',' + (att.rail || '') + ',' + (att.mag || '') : '';
    if (id === this._attId && k === this._attK) return;
    this._attId = id; this._attK = k; this._att = att ? { sight: att.sight || null, muzzle: att.muzzle || null, rail: att.rail || null, mag: att.mag || null } : null;
    if (id && id === this.id && this._builtK !== k) { this.id = undefined; this.setItem(id); }
  }
  setItem(id) {
    id = id || null;
    if (id === this.id) return;
    this.id = id;
    const att = id && this._attId === id ? this._att : null;
    this._builtK = att ? this._attK : '';
    // drop the old model
    if (this.held) {
      this.itemG.remove(this.held);
      this.held.traverse(o => { if (o.isMesh && o.userData.own) o.geometry.dispose(); });
      this.held = null;
    }
    const HI = this.models && this.models.HELD_INFO;
    const info = this.info = id ? ((HI && HI[id]) || { kind: 'item', twoHand: false, use: 'mouth' }) : null;
    const cls = !id ? 'fists' : info.hand === 'L' ? 'bow' : info.kind === 'gun' ? (id === 'rocket_launcher' ? 'rocket' : info.twoHand ? 'rifle' : 'pistol')
      : id === 'torch' ? 'torch' : id === 'spear_wood' ? 'spear' : id === 'buildplan' ? 'plan' : id === 'fishing_rod' ? 'rod'
      : (info.kind === 'tool' || info.kind === 'melee' || info.kind === 'build') ? (info.twoHand ? 'tool2' : 'tool')
      : info.kind === 'throw' ? 'throw' : 'item';
    let I = ITEM[id] || EMPTY;
    const c = this.cfg = { cls, I, swing: info ? info.swing || (cls === 'fists' ? 'punch' : 'chop') : 'punch', use: info ? info.use || null : null, parts: {}, partList: [], flame: null, setDraw: null, light: false };
    let ua = null;   // what the fitted attachments changed (sights, muzzle, laser emitter, lamp)
    // model
    if (id) {
      let g = null;
      if (this.models) { try { g = this.models.makeHeld(id, att); } catch (e) { g = null; } }
      ua = g && g.userData.att || null;
      if (ua && ua.sights) c.I = I = Object.assign({}, I, { sights: ua.sights, relief: ua.relief, scope: ua.scope >= 0 ? (ua.scope ? 2 : 1) : 0, zoom: 0 });
      if (!g) g = this._placeholder(cls);
      g.traverse(o => { if (o.isMesh) { o.material = this._clone(o.material); o.frustumCulled = false; o.castShadow = o.receiveShadow = false; o.renderOrder = 2; } });
      this.held = g; this.itemG.add(g);
      c.flame = g.userData.flame || null;
      c.setDraw = g.userData.setDraw || null;
      c.blink = g.userData.blink || null;
      if (I.parts) for (const k in I.parts) { const pt = this._findPart(I.parts[k]); if (pt) { c.parts[k] = pt; c.partList.push(pt); } }
    }
    // muzzle / light
    c.light = !!(info && info.light);
    if (info && info.muzzle) this.muzzleLocal.fromArray((ua && ua.muzzle) || info.muzzle); else this.muzzleLocal.set(0, 0, 0);
    c.hasMuzzle = !!(info && info.muzzle);
    c.laser = ua && ua.laser ? new THREE.Vector3().fromArray(ua.laser) : null;
    c.lamp = ua && ua.lamp ? new THREE.Vector3().fromArray(ua.lamp) : null;
    if (c.laser) this.beam.position.copy(c.laser);
    if (c.lamp) this.lampGlow.position.copy(c.lamp);
    this.beam.visible = this.lampGlow.visible = false;
    c.gun = !!(info && info.kind === 'gun');
    // ---- poses
    const base = CLS[cls];
    c.hip = new Xf().pose(I.hip || base.hip);
    c.spr = new Xf().pose(I.sprint || base.sprint);
    c.ads = null;
    if (I.sights) c.ads = this._adsPose(cls, I);
    // right-hand mount
    c.mR = new Xf(); c.mL = new Xf(); c.leftOn = 0; c.poseR = 'grip'; c.poseL = 'relax';
    if (cls === 'fists') {
      mount(c.mR, 1, [0, 0.55, -0.83], [1, 0, 0], [0, 0, 0]); c.poseR = 'fist';
    } else if (cls === 'bow') {
      // the bow lives in the LEFT hand; the right hand hooks the string (dynamic mount)
      mount(c.mL, -1, [0, 0, 1], [1, -0.5, 0], [0, 0, 0]); c.leftOn = 1; c.poseL = 'grip'; c.poseR = 'hook';
      c.mStr = new Xf(); mount(c.mStr, 1, [0, 0, 1], [1, 0.25, 0], [0, 0, 0], V[12].set(0, -0.02, -0.098));
    } else if (I.grip) {
      mount(c.mR, 1, I.grip.a, I.grip.f, I.grip.p); c.poseR = 'trigger';
    } else if (I.tool) {
      mount(c.mR, 1, I.tool.a, I.tool.f, I.tool.p); c.poseR = I.pose || 'grip';
    } else {
      mount(c.mR, 1, [1, 0, 0], [0, -1, 0], [0, 0, 0]);
    }
    // left hand on the item
    if (cls !== 'bow') {
      if (I.sup) { mount(c.mL, -1, I.sup.a, I.sup.f, I.sup.p); c.leftOn = 1; c.poseL = I.sup.pose || 'support'; }
      else if (cls === 'pistol') {
        // left hand cups the right fist from below-left
        mount(c.mL, -1, [0.45, 0.89, 0.0], [0.15, -0.25, 1], [-0.03, -0.045, -0.034]); c.leftOn = 1; c.poseL = 'support';
      }
    }
    // recoil (a muzzle brake / silencer tames the kick), actions
    const rk = att && att.muzzle === 'att_brake' ? 0.6 : att && att.muzzle === 'att_silencer' ? 0.9 : 1;
    c.rec = I.rec ? (rk === 1 ? I.rec : [I.rec[0] * rk, I.rec[1] * rk, I.rec[2], I.rec[3] * rk]) : null; c.auto = !!I.auto; c.reload = I.reload || null;
    c.scope = !!I.scope; c.scopeHP = I.scope === 2 ? 1 : 0;
    // reset transient state
    this.eq = 0; this.cycT = 9; this.relT = 9; this.flashT = 9; this.shotT = 9; this.heat = 0; this.arrowGone = false; this.lastD = -1;
    for (let i = 0; i < 5; i++) { this.rec[i] = 0; this.recV[i] = 0; }
    this.flashMesh.visible = false;
    if (c.hasMuzzle) { this.flashMesh.position.copy(this.muzzleLocal); this.flashMesh.scale.setScalar(I.flashS ? I.flashS : cls === 'rocket' ? 3.2 : cls === 'pistol' ? 1.25 : id === 'pump' || id === 'boomstick' ? 2.1 : 1.6); }
    c.zoom = I.zoom || 0; c.flash = I.flashS !== 0 && !(att && att.muzzle === 'att_silencer');
  }

  /** ADS pose: sight line (rear -> front) on the view axis, rear sight `relief` metres ahead of the eye */
  _adsPose(cls, I) {
    const xf = new Xf();
    const R = V[6].fromArray(I.sights[0]), F = V[7].fromArray(I.sights[1]);
    const alpha = Math.atan2(F.y - R.y, F.x - R.x);
    const roll = cls === 'bow' ? HALF - 0.32 : 0;
    qView(xf.q, 0, 0, roll).multiply(Q_FWD).multiply(Qs[1].setFromAxisAngle(AXZ, -alpha));
    const rr = V[8].copy(R).applyQuaternion(xf.q);
    const ex = cls === 'bow' ? 0.06 : 0, ey = cls === 'bow' ? -0.08 : 0;
    xf.p.set(ex, ey, -I.relief).sub(rr);
    return xf;
  }

  _placeholder(cls) {
    const g = new THREE.Group();
    const m = M.mat('#55585e');
    const len = cls === 'rifle' ? 0.7 : cls === 'pistol' ? 0.3 : cls === 'tool' || cls === 'tool2' || cls === 'torch' ? 0.5 : 0.12;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.05), m); mesh.position.x = len / 2 - 0.05; mesh.userData.own = true; g.add(mesh);
    g.userData.placeholder = true;
    return g;
  }

  /** collect the vertices of a sub-part of the merged held meshes (by vertex colour and/or triangle-centroid box) */
  _findPart(spec) {
    const cols = spec.col ? spec.col.map(h => new THREE.Color(h)) : null, bx = spec.box || null;
    let best = null;
    this.held.traverse(o => {
      if (best || !o.isMesh || !o.geometry || o.geometry.index) return;
      const ga = o.geometry.attributes, P = ga.position.array, Cc = ga.color ? ga.color.array : null, n = ga.position.count;
      const idx = [];
      for (let t = 0; t < n; t += 3) {
        if (cols) {
          if (!Cc) return;
          let ok = false;
          for (const c of cols) if (Math.abs(Cc[t * 3] - c.r) < 0.004 && Math.abs(Cc[t * 3 + 1] - c.g) < 0.004 && Math.abs(Cc[t * 3 + 2] - c.b) < 0.004) { ok = true; break; }
          if (!ok) continue;
        }
        if (bx) {
          const cx = (P[t * 3] + P[t * 3 + 3] + P[t * 3 + 6]) / 3, cy = (P[t * 3 + 1] + P[t * 3 + 4] + P[t * 3 + 7]) / 3, cz = (P[t * 3 + 2] + P[t * 3 + 5] + P[t * 3 + 8]) / 3;
          if (cx < bx[0] || cy < bx[1] || cz < bx[2] || cx > bx[3] || cy > bx[4] || cz > bx[5]) continue;
        }
        idx.push(t, t + 1, t + 2);
      }
      if (!idx.length) return;
      const N = ga.normal ? ga.normal.array : null;
      const rest = new Float32Array(idx.length * 3), restN = new Float32Array(idx.length * 3);
      for (let i = 0; i < idx.length; i++) for (let j = 0; j < 3; j++) { rest[i * 3 + j] = P[idx[i] * 3 + j]; restN[i * 3 + j] = N ? N[idx[i] * 3 + j] : 0; }
      best = { geo: o.geometry, idx: Uint32Array.from(idx), rest, restN, m: new THREE.Matrix4(), last: new THREE.Matrix4(), hidden: false, wasHidden: false, force: true, n3: new THREE.Matrix3() };
    });
    return best;
  }
  /** write a part's vertices for its current matrix (if it changed) */
  _applyPart(pt) {
    if (!pt) return;
    if (!pt.force && pt.hidden === pt.wasHidden && (pt.hidden || pt.m.equals(pt.last))) return;
    pt.force = false; pt.wasHidden = pt.hidden; pt.last.copy(pt.m);
    const P = pt.geo.attributes.position.array, N = pt.geo.attributes.normal ? pt.geo.attributes.normal.array : null, idx = pt.idx, r = pt.rest, rn = pt.restN;
    const v = V[21], e = pt.m.elements;
    if (pt.hidden) {
      for (let i = 0; i < idx.length; i++) { const k = idx[i] * 3; P[k] = r[0]; P[k + 1] = r[1]; P[k + 2] = r[2]; }
    } else {
      pt.n3.setFromMatrix4(pt.m);
      for (let i = 0; i < idx.length; i++) {
        const k = idx[i] * 3;
        const x = r[i * 3], y = r[i * 3 + 1], z = r[i * 3 + 2];
        P[k] = e[0] * x + e[4] * y + e[8] * z + e[12]; P[k + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; P[k + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        if (N) { v.set(rn[i * 3], rn[i * 3 + 1], rn[i * 3 + 2]).applyMatrix3(pt.n3).normalize(); N[k] = v.x; N[k + 1] = v.y; N[k + 2] = v.z; }
      }
      if (N) pt.geo.attributes.normal.needsUpdate = true;
    }
    pt.geo.attributes.position.needsUpdate = true;
  }

  // ------------------------------------------------------------------ per-frame update
  update(dt, st) {
    st = st || EMPTY;
    dt = dt > 0 ? (dt > 0.1 ? 0.1 : dt) : 0;
    const c = this.cfg, cls = c.cls, I = c.I, parts = c.parts, PL = c.partList;
    this.time += dt; const T = this.time;
    if (st.fov) this.mainFov = st.fov;
    // ---- inputs
    const speed = st.speed || 0, air = !!st.air;
    const ads = sat(st.ads || 0);
    const reload = st.reload != null && st.reload >= 0 ? sat(st.reload) : -1;
    const swing = st.swing != null && st.swing >= 0 ? sat(st.swing) : -1;
    const thr = st.throw != null && st.throw >= 0 ? sat(st.throw) : -1;
    const use = st.use != null && st.use >= 0 ? sat(st.use) : -1;
    const ham = st.hammer != null && st.hammer >= 0 ? sat(st.hammer) : -1;
    const fire = st.fire | 0;
    const busy = reload >= 0 || swing >= 0 || thr >= 0 || use >= 0;
    // ---- smoothed states
    this.eq = Math.min(1, this.eq + dt / EQUIP_T);
    const sprintOn = !!st.sprint && speed > 0.8 && !busy && ads < 0.2;
    this.kSprint += ((sprintOn ? 1 : 0) - this.kSprint) * kd(sprintOn ? 7 : 10, dt);
    this.kCrouch += ((st.crouch ? 1 : 0) - this.kCrouch) * kd(9, dt);
    this.kMove += (Math.min(speed / 4.5, 1.4) * (air ? 0 : 1) - this.kMove) * kd(7, dt);
    this.nightK += ((st.night || 0) - this.nightK) * kd(3, dt);
    if (!air && speed > 0.15) this.phase += dt * PI * (1.55 + 0.26 * speed);
    // ---- bow: ads (or st.draw) pulls the string; no draw until the next arrow is nocked
    let drawV = 0;
    if (cls === 'bow') {
      if (fire > 0) { this.relT = 0; this.arrowGone = true; this.draw = 0; }
      const want = st.draw != null ? sat(st.draw) : ads;
      const canDraw = !this.arrowGone && reload < 0 && !st.empty ? 1 : 0;
      const tgt = 0.12 + 0.88 * want * canDraw;
      this.draw += (tgt - this.draw) * (tgt > this.draw ? Math.min(1, dt * 3.2) : Math.min(1, dt * 9));
      drawV = this.draw;
      if (this.relT < 0.5) drawV -= 0.07 * Math.sin(this.relT * 70) * Math.exp(-this.relT * 11);   // string thrum
      // the aim pose follows the draw up and lingers a moment after the release
      const aim = sat((this.draw - 0.12) / 0.88);
      this.bowAim += (aim - this.bowAim) * (aim > this.bowAim ? 1 : kd(3.5, dt));
    }
    const adsW = !c.ads || cls === 'throw' ? 0 : cls === 'bow' ? ease(this.bowAim) : ease(ads);
    // cocked throw hold (smoothed)
    const wantCock = cls === 'throw' && thr < 0 && (st.aimThrow || ads > 0.5) ? 1 : 0;
    this.cocked += (wantCock - this.cocked) * kd(wantCock ? 10 : 7, dt);

    // ================= base item pose =================
    const W = this.W;
    W.copy(c.hip);
    if (adsW > 0) W.lerp(c.ads, adsW);
    const sprW = this.kSprint * (1 - adsW);
    W.lerp(c.spr, sprW * 0.9);
    if (sprW > 0.01 && cls !== 'fists') {
      const s = Math.sin(this.phase), s2 = Math.sin(this.phase * 2);
      W.p.x += s * 0.012 * sprW; W.p.y += s2 * 0.008 * sprW;
      W.q.premultiply(qView(Qs[2], s2 * 0.04 * sprW, s * 0.08 * sprW, s * 0.06 * sprW));
    }
    // crouch: a touch lower + closer, slight cant
    if (this.kCrouch > 0.001) { const k = this.kCrouch * (1 - adsW * 0.8); W.p.y -= 0.012 * k; W.p.z += 0.015 * k; W.q.premultiply(qView(Qs[2], 0, 0, 0.05 * k)); }
    // throw cock (hold the throwable back, ready)
    if (this.cocked > 0.001) { OFF.set(TR.cock); addOff(W, OFF, this.cocked); }

    // ================= actions =================
    if (this.eq < 1) addOff(W, track(TR.equip, this.eq, OFF), 1);
    // melee swing
    if (swing >= 0) {
      if (this.lastSwing < 0) this.punchSide ^= 1;
      if (cls === 'fists') {
        // alternate: right punch on odd swings; on even ones the right fist pulls back a little
        track(TR.punch, swing, OFF);
        if (!this.punchSide) { const w = win(swing, 0.1, 0.4, 0.6, 0.9); OFF[0] = 0; OFF[1] = -0.008 * w; OFF[2] = 0.04 * w; OFF[3] = OFF[4] = OFF[5] = 0; }
        addOff(W, OFF, 1);
      } else if (c.swing === 'thrust') addOff(W, track(TR.thrust, swing, OFF), 1);
      else if (cls !== 'plan') {
        // chop / slash: absolute poses, eased in from and back out to the idle pose
        track(c.swing === 'slash' ? TR.slashA : cls === 'tool2' ? TR.chop2A : TR.chopA, swing, OFF);
        W.lerp(this.xs.pose(OFF), win(swing, 0.0, 0.13, 0.66, 1.0) * (cls === 'torch' ? 0.9 : 1));
      }
    }
    this.lastSwing = swing;
    // build hammer tap
    if (ham >= 0) { if (cls === 'plan') addOff(W, track(TR.planTap, ham, OFF), 1); else if (cls === 'tool') addOff(W, track(TR.tap, ham, OFF), 1); }
    // fishing rod: cast flick (vm.rodCast 0 -> 1) and strain while a fish pulls (vm.rodPull 0..1), set by fishing.js
    if (cls === 'rod') {
      if (this.rodCast >= 0 && this.rodCast < 1) { this.rodCast = Math.min(1, this.rodCast + dt / 0.6); addOff(W, track(TR.rodCast, this.rodCast, OFF), 1); }
      const rp = this.rodPull > 0 ? Math.min(1, this.rodPull) : 0;
      if (rp > 0) {
        const s1 = Math.sin(T * 29), s2 = Math.sin(T * 21 + 1.7);
        OFF[0] = 0; OFF[1] = -0.012 * rp; OFF[2] = -0.02 * rp; OFF[3] = -0.2 * rp + s1 * 0.014 * rp; OFF[4] = s2 * 0.012 * rp; OFF[5] = s1 * 0.02 * rp;
        addOff(W, OFF, 1);
      }
    }
    // throw (the game starts it at the release)
    let itemVis = true;
    if (thr >= 0) {
      if (this.lastThrow < 0) this.throwFrom = this.cocked;
      track(TR.throw, thr, OFF);
      if (this.throwFrom < 0.5 && thr < 0.1) { const k = thr / 0.1; for (let j = 0; j < 6; j++) OFF[j] *= 0.3 + 0.7 * k; }
      addOff(W, OFF, 1);
      if (thr > 0.06 && thr < 0.72) itemVis = false;
    }
    this.lastThrow = thr;
    // consumables
    if (use >= 0 && c.use) {
      if (c.use === 'mouth') {
        track(this.id === 'water_bottle' ? TR.drinkA : TR.mouthA, use, OFF);
        W.lerp(this.xs.pose(OFF), win(use, 0.0, 0.2, 0.84, 1.0));
        const chew = win(use, 0.25, 0.3, 0.78, 0.84);
        if (chew > 0) { const s = Math.sin(use * 46); W.p.y += s * 0.008 * chew; W.p.z += Math.abs(s) * 0.006 * chew; W.q.premultiply(qView(Qs[2], s * 0.05 * chew, 0, 0)); }
      } else {
        // bandage wrap / injection over the presented left forearm
        // (the forearm frame wC / wA / wU / wV is precomputed from the presented-arm pose)
        const k = win(use, 0.0, 0.18, 0.82, 1.0), tgt = this.xa, wC = this.wC;
        if (c.use === 'arm') {
          // the right hand loops the roll around the forearm three times
          const loop = win(use, 0.2, 0.28, 0.74, 0.82), ang = (use - 0.2) * TAU * 3.6;
          const r = 0.058 * loop + 0.05 * (1 - loop), cA = Math.cos(ang * loop), sA = Math.sin(ang * loop);
          tgt.p.copy(wC).addScaledVector(this.wU, r * cA).addScaledVector(this.wV, r * sA).addScaledVector(this.wA, 0.025 * Math.sin(ang * 0.5) * loop);
          qView(tgt.q, -0.35 + 0.45 * sA * loop, 1.0 + 0.25 * cA * loop, -0.5).multiply(Q_FWD);
        } else {
          // syringe: hover over the forearm, stab, press, pull out
          const stab = win(use, 0.3, 0.4, 0.66, 0.78);
          tgt.p.copy(wC).addScaledVector(this.wU, 0.15 - 0.05 * stab).addScaledVector(this.wV, -0.01);
          qView(tgt.q, -1.25, 0.55, 0.0).multiply(Q_FWD);
        }
        W.lerp(tgt, k);
      }
    }

    // ================= guns: firing, recoil, cycling =================
    const rec = this.rec, recV = this.recV;
    if (fire > 0 && (c.gun || cls === 'bow')) {
      const R = c.rec || REC0;
      for (let i = 0; i < fire; i++) {
        const aK = 1 - adsW * 0.35;
        recV[0] += R[0] * 26 * aK; recV[1] += R[1] * 26 * (0.85 + Math.random() * 0.3) * aK;
        recV[2] += (Math.random() - 0.5) * R[2] * 40; recV[3] += (Math.random() - 0.5) * R[2] * 60; recV[4] += R[3] * 26;
      }
      this.heat = Math.min(1, this.heat + 0.35 * fire);
      this.shotT = 0; this.flashT = 0; this.flick = Math.random() * TAU;
      if (I.pumpAct || I.boltAct) this.cycT = 0;
      if (cls === 'rocket' || c.reload === 'crank') this.arrowGone = true;
    }
    this.shotT += dt; this.flashT += dt; this.cycT += dt; this.relT += dt;
    this.heat = Math.max(0, this.heat - dt * (c.auto ? 2.2 : 4));
    // springs (stiff kick, slower settle)
    for (let i = 0; i < 5; i++) {
      const k = i === 0 ? 260 : 190, d = 2 * Math.sqrt(k) * (i === 0 ? 0.62 : 0.72);
      recV[i] += (-k * rec[i] - d * recV[i]) * dt; rec[i] += recV[i] * dt;
    }
    if (c.gun || cls === 'bow') {
      const rx = st.recoil || 0;
      const pv = V[17].set(-0.15, -0.03, 0).applyQuaternion(W.q).add(W.p);   // kick pivots behind the grip
      OFF[0] = 0; OFF[1] = rec[4]; OFF[2] = rec[0] + rx * 0.02;
      OFF[3] = rec[1] + rx * 0.04; OFF[4] = rec[2]; OFF[5] = rec[3];
      if (c.auto && this.heat > 0.02) {   // continuous shake while an automatic is firing
        const h = this.heat * (1 - adsW * 0.5);
        OFF[0] += (Math.random() - 0.5) * 0.004 * h; OFF[1] += (Math.random() - 0.5) * 0.004 * h; OFF[2] += Math.random() * 0.006 * h;
        OFF[3] += (Math.random() - 0.5) * 0.012 * h; OFF[4] += (Math.random() - 0.5) * 0.01 * h; OFF[5] += (Math.random() - 0.5) * 0.02 * h;
      }
      addOff(W, OFF, 1, pv);
    }

    // ================= reloads (item pose + hand targets + parts) =================
    let wLatt = c.leftOn ? 1 : 0;    // left hand attached weight
    let wRatt = 1;                   // right hand attached weight
    let boltHand = 0;
    const fl = this.freeL, fr = this.freeR;
    fl.pose(cls === 'fists' ? CLS.fists.hip : P_HIDE_L);
    let poseL = c.poseL, poseR = c.poseR;
    if (thr > 0.05 && thr < 0.62) poseR = 'open';   // fingers spread after the release
    for (let i = 0; i < PL.length; i++) { PL[i].m.identity(); PL[i].hidden = false; }
    if (parts.spin && I.spinAxis) { const a = I.spinAxis; parts.spin.m.makeTranslation(a[0], a[1], a[2]).multiply(MX[2].makeRotationX(st.spin || 0)).multiply(MX[3].makeTranslation(-a[0], -a[1], -a[2])); } // the minigun's barrels
    let lmo = null;                  // left-hand mount (item space) used during reloads
    if (reload < 0 && this.lastReload >= 0) this.arrowGone = false;
    this.lastReload = reload;
    if (reload >= 0 && c.reload) {
      const r = reload;
      lmo = this.lmo;
      switch (c.reload) {
        case 'mag': {
          // cant + lift, left hand pulls the mag down/out, fetches a new one, seats it
          const tilt = win(r, 0.0, 0.14, 0.8, 0.97) * (I.magTilt ?? 1), seat = win(r, 0.7, 0.73, 0.75, 0.8);
          OFF[0] = -0.01 * tilt; OFF[1] = 0.025 * tilt + 0.012 * seat; OFF[2] = 0.02 * tilt; OFF[3] = 0.16 * tilt + 0.03 * seat; OFF[4] = 0.22 * tilt; OFF[5] = -0.5 * tilt;
          addOff(W, OFF, 1);
          const pt = parts.mag, mo = I.magOut, mp = I.magPivot;
          const k = sstep(0.15, 0.32, r) * (1 - sstep(0.52, 0.72, r));
          const q = qView(Qs[4], mo[3] * k, mo[4] * k, mo[5] * k);
          const M1 = MX[1].makeTranslation(mp[0] + mo[0] * k, mp[1] + mo[1] * k, mp[2] + mo[2] * k).multiply(MX[2].makeRotationFromQuaternion(q)).multiply(MX[3].makeTranslation(-mp[0], -mp[1], -mp[2]));
          if (pt) pt.m.copy(M1);
          // left hand rides the magazine
          mountN(this.xa, -1, 1, 0, 0, 0, 0.3, 1, mp[0] + 0.005, mp[1] - 0.09, mp[2] + 0.01);
          this.xa.matrix(MX[4]).premultiply(M1).decompose(lmo.p, lmo.q, V[19]);
          wLatt = 1 - win(r, 0.04, 0.15, 0.78, 0.92);
          poseL = r > 0.12 && r < 0.8 ? 'grip' : 'support';
          break;
        }
        case 'shells': {
          const tilt = win(r, 0.0, 0.12, 0.84, 0.97);
          OFF[0] = -0.05 * tilt; OFF[1] = 0.07 * tilt; OFF[2] = 0.02 * tilt; OFF[3] = 0.18 * tilt; OFF[4] = 0.3 * tilt; OFF[5] = -1.05 * tilt;
          addOff(W, OFF, 1);
          // three shells: hand comes up from below to the port and pushes
          const ph = clamp((r - 0.14) / 0.6, 0, 1) * 3, cyc = ph % 1, on = r > 0.14 && r < 0.74 ? 1 : 0;
          const up = on ? Math.sin(cyc * PI) : 0, push = on ? win(cyc, 0.35, 0.5, 0.6, 0.85) : 0;
          mountN(lmo, -1, 1, 0.2, 0, 0, 0.8, 0.6, 0.12 + 0.05 * push, -0.2 + 0.2 * up, -0.02);
          wLatt = 1 - win(r, 0.04, 0.14, 0.76, 0.86);
          poseL = 'pinch';
          if (parts.pump) { const rk = win(r, 0.86, 0.9, 0.92, 0.97); parts.pump.m.makeTranslation(-0.1 * rk, 0, 0); }
          break;
        }
        case 'break': {
          const open = win(r, 0.04, 0.16, 0.74, 0.8), tilt = win(r, 0.0, 0.12, 0.8, 0.95), flick = win(r, 0.74, 0.78, 0.8, 0.88);
          OFF[0] = -0.05 * tilt; OFF[1] = 0.07 * tilt + 0.03 * flick; OFF[2] = 0.0; OFF[3] = -0.12 * tilt + 0.25 * flick; OFF[4] = 0.3 * tilt; OFF[5] = -0.35 * tilt;
          addOff(W, OFF, 1);
          const h = I.hinge;
          if (parts.barrels) parts.barrels.m.makeTranslation(h[0], h[1], h[2]).multiply(MX[2].makeRotationZ(-0.62 * open)).multiply(MX[3].makeTranslation(-h[0], -h[1], -h[2]));
          // left hand: off to the belt, then thumbs shells into the breech
          const ld = win(r, 0.18, 0.3, 0.42, 0.52), br = win(r, 0.42, 0.55, 0.64, 0.72);
          mountN(lmo, -1, 1, 0.3, 0, 0, 0.5, 1, 0.1 + 0.02 * br, 0.08 - 0.35 * ld + 0.02 * br, 0.02 - 0.05 * ld);
          wLatt = 1 - win(r, 0.14, 0.24, 0.72, 0.8);
          poseL = 'pinch';
          break;
        }
        case 'bolt': {
          const tilt = win(r, 0.0, 0.12, 0.85, 0.97);
          OFF[0] = -0.02 * tilt; OFF[1] = 0.02 * tilt; OFF[2] = 0.03 * tilt; OFF[3] = 0.08 * tilt; OFF[4] = 0.18 * tilt; OFF[5] = 0.35 * tilt;
          addOff(W, OFF, 1);
          this._bolt(parts.bolt, win(r, 0.06, 0.14, 0.82, 0.88), win(r, 0.12, 0.2, 0.76, 0.84));
          boltHand = win(r, 0.02, 0.08, 0.88, 0.95);
          const ph = clamp((r - 0.24) / 0.48, 0, 1) * 3, cyc = ph % 1, on = r > 0.24 && r < 0.72 ? 1 : 0, up = on ? Math.sin(cyc * PI) : 0;
          mountN(lmo, -1, 1, 0, 0, 0, -0.3, 1, 0.04, 0.1 + 0.22 * (1 - up), 0.0);
          wLatt = 1 - win(r, 0.16, 0.26, 0.72, 0.82);
          poseL = 'pinch';
          break;
        }
        case 'pistol': {
          const tilt = win(r, 0.0, 0.15, 0.8, 0.96), slap = win(r, 0.62, 0.66, 0.68, 0.74);
          OFF[0] = -0.04 * tilt; OFF[1] = 0.04 * tilt + 0.02 * slap; OFF[2] = 0.05 * tilt; OFF[3] = 0.35 * tilt; OFF[4] = 0.3 * tilt; OFF[5] = 0.5 * tilt;
          addOff(W, OFF, 1);
          const away = win(r, 0.12, 0.25, 0.42, 0.56), ins = win(r, 0.5, 0.62, 0.66, 0.74);
          mountN(lmo, -1, 1, 0.6, 0, 0.2, 0.0, 1, -0.05, -0.15 - 0.3 * away + 0.04 * ins, 0.02);
          wLatt = 1 - win(r, 0.04, 0.14, 0.78, 0.9);
          poseL = 'grip';
          break;
        }
        case 'revolver': {
          const open = win(r, 0.06, 0.18, 0.76, 0.82), tilt = win(r, 0.0, 0.14, 0.8, 0.95), flick = win(r, 0.76, 0.79, 0.81, 0.88);
          OFF[0] = -0.05 * tilt; OFF[1] = 0.04 * tilt; OFF[2] = 0.06 * tilt; OFF[3] = 0.45 * tilt; OFF[4] = 0.35 * tilt; OFF[5] = 0.75 * tilt - 0.35 * flick;
          addOff(W, OFF, 1);
          const a = I.cylAxis;
          if (parts.cyl) parts.cyl.m.makeTranslation(a[0], a[1], a[2]).multiply(MX[2].makeRotationX(-1.35 * open)).multiply(MX[3].makeTranslation(-a[0], -a[1], -a[2]));
          const away = win(r, 0.16, 0.28, 0.34, 0.46);
          const ph = clamp((r - 0.46) / 0.26, 0, 1) * 2, cyc = ph % 1, on = r > 0.46 && r < 0.72 ? 1 : 0, pu = on ? Math.sin(cyc * PI) : 0;
          mountN(lmo, -1, 1, 0.3, 0, 0, 0.4, 1, -0.02 * pu, -0.28 * away - 0.03 * pu, -0.07);
          wLatt = 1 - win(r, 0.06, 0.16, 0.78, 0.9);
          poseL = 'pinch';
          break;
        }
        case 'rocket': {
          const dip = win(r, 0.0, 0.2, 0.78, 0.97);
          OFF[0] = -0.05 * dip; OFF[1] = -0.02 * dip; OFF[2] = -0.12 * dip; OFF[3] = 0.1 * dip; OFF[4] = 0.5 * dip; OFF[5] = 0.3 * dip;
          addOff(W, OFF, 1);
          // warhead travels with the left hand from below up to the muzzle and in
          const away = win(r, 0.08, 0.22, 0.32, 0.5), ins = sstep(0.5, 0.68, r);
          const wx = 0.18 * (1 - ins), wy = -0.32 * away;
          if (parts.warhead) { parts.warhead.hidden = r < 0.3; parts.warhead.m.makeTranslation(wx, wy, 0); }
          mountN(lmo, -1, 1, 0, 0, 0, 0.4, 1, 0.68 + wx, 0.07 + wy, 0.02);
          wLatt = 1 - win(r, 0.04, 0.16, 0.74, 0.88);
          poseL = r > 0.25 && r < 0.72 ? 'grip' : 'support';
          break;
        }
        case 'nock': {
          // right hand reaches back for an arrow, brings it over and nocks it
          const away = win(r, 0.04, 0.3, 0.38, 0.62);
          fr.pose(P_NOCK_REACH);
          wRatt = 1 - win(r, 0.02, 0.2, 0.62, 0.86);
          OFF[0] = 0.02 * away; OFF[1] = -0.02 * away; OFF[2] = 0; OFF[3] = -0.12 * away; OFF[4] = 0.1 * away; OFF[5] = -0.25 * away;
          addOff(W, OFF, 1);
          poseR = r > 0.3 && r < 0.75 ? 'pinch' : 'hook';
          lmo = null;
          if (r > 0.75) this.arrowGone = false;
          break;
        }
        case 'crank': {
          // crossbow: cant it, wind the ratchet crank three turns (the string creeps back to the latch),
          // then bring a fresh arrow up from the quiver and lay it in the groove
          const tilt = win(r, 0.0, 0.1, 0.86, 0.98);
          OFF[0] = -0.03 * tilt; OFF[1] = 0.05 * tilt; OFF[2] = 0.035 * tilt; OFF[3] = 0.14 * tilt; OFF[4] = 0.28 * tilt; OFF[5] = -0.45 * tilt;
          addOff(W, OFF, 1);
          const cc = I.crankC, ck = I.crankK, ang = -sstep(0.18, 0.62, r) * TAU * 3;
          if (parts.crank) parts.crank.m.makeTranslation(cc[0], cc[1], cc[2]).multiply(MX[2].makeRotationZ(ang)).multiply(MX[3].makeTranslation(-cc[0], -cc[1], -cc[2]));
          // knob hold: the hand follows the knob round but keeps its orientation (the knob spins in the fist)
          const ca = Math.cos(ang), sa = Math.sin(ang), kx = ck[0] - cc[0], ky = ck[1] - cc[1];
          mountN(this.xa, -1, 0, 0.25, -1, 0.35, 1, 0, cc[0] + kx * ca - ky * sa, cc[1] + kx * sa + ky * ca, ck[2] - 0.012);
          // the new arrow: below / left in the hand -> above the rail -> seated
          const qa = sstep(0.68, 0.8, r), qs = sstep(0.8, 0.88, r);
          const qx = 0.02 * (1 - qs), qy = lerp(-0.24, 0.05, qa) * (1 - qs), qz = lerp(-0.16, -0.05, qa) * (1 - qs);
          if (parts.quarrel) parts.quarrel.m.makeTranslation(qx, qy, qz).multiply(MX[2].makeRotationX(-0.5 * (1 - qa)));
          mountN(this.xb, -1, 1, 0, 0, 0, 0.6, 1, 0.24 + qx, 0.1 + qy - 0.01, qz - 0.015);
          if (r < 0.66) lmo.copy(this.xa);
          else lmo.copy(this.xb);
          if (r > 0.62 && r < 0.7) lmo.lerpXf(this.xa, this.xb, sstep(0.62, 0.7, r));
          wLatt = 1 - win(r, 0.06, 0.16, 0.86, 0.95);
          poseL = r > 0.12 && r < 0.66 ? 'grip' : r >= 0.66 && r < 0.88 ? 'pinch' : 'support';
          break;
        }
        case 'box': {
          // LMG: cant, flip the feed cover up, drop the ammo box, fetch a new one, lay the belt in, slap the cover shut
          const tilt = win(r, 0.0, 0.1, 0.86, 0.97);
          OFF[0] = -0.02 * tilt; OFF[1] = 0.045 * tilt; OFF[2] = 0.04 * tilt; OFF[3] = 0.12 * tilt; OFF[4] = 0.28 * tilt; OFF[5] = -0.5 * tilt;
          addOff(W, OFF, 1);
          const h = I.coverHinge, open = win(r, 0.12, 0.22, 0.7, 0.77);
          const MC = MX[5].makeTranslation(h[0], h[1], h[2]).multiply(MX[2].makeRotationZ(0.95 * open)).multiply(MX[3].makeTranslation(-h[0], -h[1], -h[2]));
          if (parts.cover) parts.cover.m.copy(MC);
          const mo = I.magOut, mp = I.magPivot, k = sstep(0.28, 0.44, r) * (1 - sstep(0.5, 0.64, r));
          const q = qView(Qs[4], mo[3] * k, mo[4] * k, mo[5] * k);
          const M1 = MX[1].makeTranslation(mp[0] + mo[0] * k, mp[1] + mo[1] * k, mp[2] + mo[2] * k).multiply(MX[2].makeRotationFromQuaternion(q)).multiply(MX[3].makeTranslation(-mp[0], -mp[1], -mp[2]));
          if (parts.mag) { parts.mag.m.copy(M1); parts.mag.hidden = r > 0.45 && r < 0.49; }
          // hand on the cover (flat, rides it up and slaps it down)
          mountN(this.xa, -1, 0, 0.2, 1, 1, -0.1, 0.3, 0.05, 0.155, -0.035);
          this.xa.matrix(MX[4]).premultiply(MC).decompose(this.xa.p, this.xa.q, V[19]);
          // hand under the ammo box (rides it)
          mountN(this.xb, -1, 1, 0, 0, 0, 0.3, 1, mp[0] + 0.01, mp[1] - 0.09, mp[2] - 0.01);
          this.xb.matrix(MX[4]).premultiply(M1).decompose(this.xb.p, this.xb.q, V[19]);
          // cover first, then the box, then back up to the cover
          const toBox = sstep(0.22, 0.3, r) * (1 - sstep(0.62, 0.7, r));
          lmo.lerpXf(this.xa, this.xb, toBox);
          wLatt = 1 - win(r, 0.04, 0.12, 0.8, 0.92);
          poseL = toBox > 0.5 ? 'grip' : 'flat';
          break;
        }
        default: lmo = null;
      }
    }
    // post-shot cycling (pump / bolt)
    if (I.pumpAct && this.cycT < 0.6 && reload < 0) {
      const k = win(this.cycT, 0.1, 0.24, 0.3, 0.46);
      if (parts.pump) parts.pump.m.makeTranslation(-0.1 * k, 0, 0);
      W.q.premultiply(qView(Qs[2], 0.05 * k, 0.03 * k, 0.12 * k)); W.p.z += 0.01 * k;
    }
    if (I.boltAct && reload < 0) {
      const cy = this.cycT - 0.12;
      if (cy > 0 && cy < 0.9) {
        this._bolt(parts.bolt, win(cy, 0.08, 0.2, 0.55, 0.66), win(cy, 0.2, 0.33, 0.42, 0.55));
        boltHand = win(cy, 0.0, 0.1, 0.68, 0.82);
        W.q.premultiply(qView(Qs[2], 0.02 * boltHand, 0.06 * boltHand, 0.2 * boltHand));
      }
    }
    // bow arrow: follows the string; gone after a shot until nocked (reload >= 0.5)
    if (cls === 'bow' && parts.arrow) {
      const pa = parts.arrow;
      pa.hidden = (this.arrowGone && !(reload >= 0.5)) || (!!st.empty && reload < 0);
      pa.m.makeTranslation(-0.36 * Math.max(0, drawV), 0, 0);
    }
    // rocket warhead: gone after a shot until reloaded
    if (cls === 'rocket' && parts.warhead && reload < 0) parts.warhead.hidden = this.arrowGone || !!st.empty;
    // crossbow: string wound back to the latch (cock 1) or loose at the prod (0), sheared along X; arrow on the rail
    if (c.reload === 'crank') {
      const cock = reload >= 0 ? sstep(0.18, 0.62, reload) : this.arrowGone || st.empty ? 0 : 1;
      const dN = I.nockX * (1 - cock), sh = dN / I.tipZ;
      if (parts.strR) parts.strR.m.set(1, 0, -sh, dN, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
      if (parts.strL) parts.strL.m.set(1, 0, sh, dN, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
      if (parts.quarrel) parts.quarrel.hidden = (this.arrowGone && !(reload >= 0.68)) || (!!st.empty && reload < 0);
    }

    // ================= hands =================
    const hR = this.hR, hL = this.hL;
    if (cls === 'bow') {
      // string hand at the nock
      const m = this.xa.copy(c.mStr); m.p.x += -0.07 - 0.36 * Math.max(0, drawV); m.p.y += 0.02;
      hR.mul(W, m);
      // release: the drawing hand flies back past the anchor, then returns to the string
      const rk = win(this.relT, 0, 0.03, 0.16, 0.5);
      if (rk > 0) {
        this.xb.copy(c.mStr); this.xb.p.x += -0.07 - 0.36; this.xb.p.y += 0.02;
        this.xc.mul(W, this.xb); this.xc.p.x += 0.05; this.xc.p.z += 0.05; this.xc.p.y -= 0.01;
        hR.lerp(this.xc, rk); if (rk > 0.3) poseR = 'open';
      }
      if (wRatt < 1) hR.lerp(this._handOf(fr, 1), 1 - wRatt);
    } else {
      if (cls === 'fists' && sprW > 0.01) { const s = Math.sin(this.phase); W.p.z -= s * 0.05 * sprW; W.p.y += s * 0.02 * sprW; }
      hR.mul(W, c.mR);
      if (boltHand > 0 && parts.bolt) {
        // hand onto the bolt knob (follows the bolt part)
        this.mBolt.matrix(MX[4]).premultiply(parts.bolt.m).decompose(this.xb.p, this.xb.q, V[19]);
        this.xc.mul(W, this.xb);
        hR.lerp(this.xc, boltHand); if (boltHand > 0.5) poseR = 'pinch';
      }
    }
    if (cls === 'fists') {
      // mirrored guard + alternating punches
      const lp = this.xb; lp.copy(this.fistL);
      if (sprW > 0.01) { lp.lerp(this.xa.pose(P_FIST_SPR_L), sprW * 0.9); const s = Math.sin(this.phase); lp.p.z += s * 0.05 * sprW; lp.p.y -= s * 0.02 * sprW; }
      if (this.eq < 1) { track(TR.equip, this.eq, OFF2); OFF2[0] = -OFF2[0]; OFF2[4] = -OFF2[4]; OFF2[5] = -OFF2[5]; addOff(lp, OFF2, 1); }
      if (swing >= 0) {
        track(TR.punch, swing, OFF2);
        if (!this.punchSide) { OFF2[0] = -OFF2[0]; OFF2[4] = -OFF2[4]; OFF2[5] = -OFF2[5]; }
        else { const w = win(swing, 0.1, 0.4, 0.6, 0.9); OFF2[0] = 0; OFF2[1] = -0.008 * w; OFF2[2] = 0.04 * w; OFF2[3] = OFF2[4] = OFF2[5] = 0; }
        addOff(lp, OFF2, 1);
      }
      hL.mul(lp, this.mFistL); poseL = 'fist';
    } else if (lmo) {
      this.xa.mul(W, lmo);
      if (c.leftOn) { hL.mul(W, c.mL); hL.lerp(this.xa, 1 - wLatt); } else hL.copy(this.xa);
    } else if (c.leftOn) {
      hL.mul(W, c.mL);
      if (cls === 'pistol' && sprW > 0.01) hL.lerp(this._handOf(fl, -1), sprW);   // drop the pistol support hand when sprinting
    } else {
      hL.copy(this._handOf(fl, -1));
      if (cls === 'throw') {   // left arm points forward for balance while winding up
        const k = Math.max(this.cocked, thr >= 0 ? win(thr, 0, 0.0001, 0.2, 0.5) * this.throwFrom : 0);
        if (k > 0.001) { this.xa.mul(this.xb.pose(P_THROW_L), this.mOpenL); hL.lerp(this.xa, k); poseL = 'open'; }
      }
      if (use >= 0 && (c.use === 'arm' || c.use === 'inject')) {   // present the left forearm
        const k = win(use, 0.0, 0.16, 0.84, 1.0);
        this.poleK[1] = k;
        this.xa.mul(this.xb.pose(P_USE_L), this.mFlatL);
        hL.lerp(this.xa, k); poseL = 'relax';
      }
    }
    // dev hook: vm.dbg = { r: pose6, l: pose6, pose: 'fist' } pins both hands (fist-forward mounts)
    if (this.dbg) { const D = this.dbg; hR.copy(this._handOf(this.xb.pose(D.r), 1)); hL.copy(this._handOf(this.xc.pose(D.l), -1)); poseR = poseL = D.pose || 'fist'; this.held && (this.held.visible = false); }
    if (!(use >= 0 && (c.use === 'arm' || c.use === 'inject'))) this.poleK[1] = 0;
    // finger poses
    this._fingers(this.poseR, FP[poseR] || FP.grip, dt);
    this._fingers(this.poseL, FP[poseL] || FP.relax, dt);

    // ================= global offset (breath, sway, bob, jump) =================
    const G = this.G; G.identity();
    const calm = 1 - adsW * 0.82;
    const br = Math.sin(T * 1.7), br2 = Math.sin(T * 1.7 + 0.9);
    G.p.y += br * 0.0022 * calm; G.p.z += br2 * 0.0012 * calm;
    let gp = br2 * 0.006 * calm, gy = Math.sin(T * 0.83) * 0.004 * calm, gr = Math.sin(T * 0.61) * 0.004 * calm;
    // walk bob (figure 8), bigger when sprinting
    const mv = this.kMove * (1 - adsW * 0.75) * (1 + this.kSprint * 0.6);
    if (mv > 0.001) {
      const s = Math.sin(this.phase), s2 = Math.sin(this.phase * 2);
      G.p.x += s * 0.011 * mv; G.p.y += (s2 * 0.0065 - 0.004) * mv;
      gy += s * 0.012 * mv; gr += s * 0.018 * mv; gp += s2 * 0.008 * mv;
    }
    // look sway: lag behind the turn (spring towards an offset proportional to the turn rate)
    const wx = dt > 0 ? (st.lookDX || 0) / dt : 0, wy = dt > 0 ? (st.lookDY || 0) / dt : 0;
    const sk = 0.022 * (1 - adsW * 0.6);
    const tg0 = clamp(wx * sk, -0.12, 0.12), tg1 = clamp(-wy * sk, -0.09, 0.09);
    const sw = this.sw, sv = this.swV, K1 = 110, D1 = 2 * Math.sqrt(K1) * 0.62;
    sv[0] += (K1 * (tg0 - sw[0]) - D1 * sv[0]) * dt; sw[0] += sv[0] * dt;
    sv[1] += (K1 * (tg1 - sw[1]) - D1 * sv[1]) * dt; sw[1] += sv[1] * dt;
    gy += sw[0]; gr += sw[0] * 0.8; gp += sw[1];
    G.p.x -= sw[0] * 0.09; G.p.y -= sw[1] * 0.08;
    // jump / land (metres)
    if (air && !this.wasAir) this.jv -= 0.3;
    if (!air && this.wasAir) this.jv -= 0.55;
    this.wasAir = air;
    this.jv += (-150 * this.jy - 2 * Math.sqrt(150) * 0.45 * this.jv) * dt; this.jy += this.jv * dt;
    const jk = 1 - adsW * 0.6;
    G.p.y += this.jy * jk; gp += this.jy * 1.4 * jk;
    if (air) { G.p.y += 0.006; gp -= 0.02; }
    qView(G.q, gp, gy, gr);
    // rotate about a point near the hands, not the eye
    G.p.add(V[20].copy(G_PIV)).sub(V[9].copy(G_PIV).applyQuaternion(G.q));
    G.matrix(this.gm);

    // ================= solve arms =================
    this._arm(0, hR);
    this._arm(1, hL);
    for (let i = 0; i < NB * 2; i++) this.bones[i].matrixWorld.multiplyMatrices(this.gm, this.bm[i]);

    // ================= item transform, parts, flame, flash, scope =================
    W.matrix(this.wm); this.itemG.matrix.multiplyMatrices(this.gm, this.wm);
    this.itemG.matrixWorldNeedsUpdate = true;
    this.scopeK = 0;
    if (this.held) {
      let vis = itemVis;
      // scope: bring the eyepiece in, then switch to the overlay
      this.scopeK = c.scope ? sstep(0.84, 0.97, adsW) : 0;
      if (this.scopeK >= 0.999) vis = false;
      this.held.visible = vis;
      if (c.setDraw) {
        const d = Math.max(0, drawV);
        if (Math.abs(d - this.lastD) > 1e-4) { c.setDraw(d); this.lastD = d; if (parts.arrow) parts.arrow.force = true; }
      }
      for (let i = 0; i < PL.length; i++) this._applyPart(PL[i]);
      if (c.blink) c.blink.visible = (T % 0.8) < 0.4;
    }
    this.scopeMesh.visible = this.scopeK > 0.001;
    this.scopeMat.uniforms.uK.value = this.scopeK;
    this.scopeMat.uniforms.uS.value = c.scopeHP || 0;
    // high-power scope (c.zoom): narrow the main camera's FOV while the overlay is up. The game sets the
    // camera's FOV every frame before this update and render() puts it back after drawing, so nothing sticks.
    if (c.zoom && this.scopeK > 0.001 && st.fov && this._mainCam && !this.hidden) {
      const f = st.fov * lerp(1, c.zoom, this.scopeK);
      this._mainCam.fov = f; this._mainCam.updateProjectionMatrix(); this._fovBack = st.fov; this.mainFov = f;
    }
    this.arms.visible = this.scopeK < 0.999;
    // laser beam out to the dot (not while reloading / sprinting) and the flashlight lens glow after dusk
    const shown = !!(this.held && this.held.visible);
    const beamOn = !!c.laser && shown && reload < 0 && this.kSprint < 0.5 && this.laserD > 0;
    this.beam.visible = beamOn;
    if (beamOn) {
      // aim the beam from the emitter at the dot (straight ahead of the eye, laserD metres out), fading out within 2.5 m
      const tgt = V[13].set(0, 0, -this.laserD).applyMatrix4(MX[5].copy(this.itemG.matrix).invert()).sub(c.laser);
      const L = tgt.length(); tgt.multiplyScalar(1 / (L || 1));
      this.beam.quaternion.setFromUnitVectors(AXX, tgt);
      this.beam.scale.set(clamp(L - 0.05, 0.05, 2.5), 1, 1);
    }
    const lampOn = !!c.lamp && shown && this.nightK > 0.2;
    this.lampGlow.visible = lampOn;
    if (lampOn) { this.lampGlow.material.opacity = 0.35 + 0.55 * sat(this.nightK); this.lampGlow.quaternion.setFromRotationMatrix(this.itemG.matrix).invert(); }
    // torch flame: always burns upwards, trails motion, flickers
    let lightI = 0;
    if (c.flame && this.held) {
      const fg = c.flame;
      const f1 = 0.88 + 0.12 * Math.sin(T * 23) * Math.sin(T * 7.3 + 1) + 0.05 * Math.sin(T * 41);
      fg.scale.set(0.95 + 0.06 * Math.sin(T * 17), f1, 0.95 + 0.06 * Math.cos(T * 13));
      const up = V[10];
      if (this._hasCam) up.copy(UP).applyQuaternion(Qs[6].copy(this._camQ).invert()); else up.set(0, 1, 0);
      up.x -= sw[0] * 2.5 + Math.sin(this.phase) * 0.15 * this.kMove; up.z += 0.25 * this.kMove; up.normalize();
      this.flameUp.lerp(up, kd(10, dt)).normalize();
      const iq = Qs[7].setFromRotationMatrix(this.itemG.matrix).invert();
      fg.quaternion.setFromUnitVectors(AXY, V[11].copy(this.flameUp).applyQuaternion(iq).normalize());
      fg.updateMatrix();
      lightI = (0.5 + this.nightK * 1.6) * f1;
      this.pl.color.setRGB(1.0, 0.58, 0.24); this.pl.distance = 3;
    } else if (c.light && this.held) {
      lightI = (0.4 + this.nightK * 1.4) * (0.9 + 0.1 * Math.sin(T * 31));
      this.pl.color.setRGB(1.0, 0.25, 0.18); this.pl.distance = 3;
    }
    // muzzle flash (+ a flash of light on the hands)
    const fT = this.flashT;
    const showFlash = this.flash && c.flash && c.hasMuzzle && cls !== 'bow' && fT < 0.05 && this.held && this.held.visible;
    this.flashMesh.visible = !!showFlash;
    if (showFlash) {
      const k = 1 - fT / 0.05;
      this.flashMesh.rotation.set(this.flick, 0, 0);
      this.flashMesh.material.opacity = 0.65 + 0.35 * k;
      lightI = Math.max(lightI, 3.2 * k * (cls === 'rocket' ? 2 : 1));
      this.pl.color.setRGB(1.0, 0.72, 0.38); this.pl.distance = 4;
    }
    this.pl.intensity = lightI;
    if (lightI > 0) this._muzzleRaw(this.pl.position);
  }

  /** hand-bone Xf for a "free" carrier pose (fist forward) */
  _handOf(carrier, side) {
    const m = side > 0 ? (this._mfR || (this._mfR = mount(new Xf(), 1, [0, 1, 0.3], [1, -0.2, 0], [0, 0, 0]))) : (this._mfL || (this._mfL = mount(new Xf(), -1, [0, 1, -0.3], [1, -0.2, 0], [0, 0, 0])));
    const out = side > 0 ? (this._hfR || (this._hfR = new Xf())) : (this._hfL || (this._hfL = new Xf()));
    return out.mul(carrier, m);
  }

  _bolt(pt, lift, back) {
    if (!pt) return;
    const a = this.cfg.I.boltAxis;
    pt.m.makeTranslation(-0.075 * back, a[1], a[2]).multiply(MX[2].makeRotationX(-1.1 * lift)).multiply(MX[3].makeTranslation(0, -a[1], -a[2]));
  }

  _fingers(cur, tgt, dt) { const k = kd(14, dt); for (let i = 0; i < 7; i++) cur[i] += (tgt[i] - cur[i]) * k; }

  /** IK one arm (0 right, 1 left) onto the hand-bone target h, fill this.bm */
  _arm(i, h) {
    const side = i === 0 ? 1 : -1, o = i * NB, bm = this.bm;
    const S = this.sh[i].copy(SHOULDER[i]);
    // wrist = hand origin
    const Wp = V[12].copy(h.p);
    const d = V[13].subVectors(Wp, S); let dist = d.length();
    const reach = LA + LB - 0.004;
    if (dist > reach) { S.addScaledVector(d, (dist - reach) / dist); dist = reach; d.subVectors(Wp, S); }
    const minD = Math.abs(LA - LB) + 0.02; if (dist < minD) dist = minD;
    const n = d.normalize();
    const cosA = clamp((LA * LA + dist * dist - LB * LB) / (2 * LA * dist), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    // elbow hint: down and outwards (and back), or lifted out to the side when presenting the forearm
    const pole = V[14].set(0.55 * side, -1, 0.25), pk = this.poleK[i];
    if (pk > 0) pole.lerp(POLE_LIFT, pk);
    pole.addScaledVector(n, -pole.dot(n)).normalize();
    const E = this.elbow[i].copy(S).addScaledVector(n, LA * cosA).addScaledVector(pole, LA * sinA);
    // upper arm
    this._seg(bm[o + B.UP], S, E, V[15].set(0, 1, 0));
    // forearm rolls with the hand
    const hy = V[15].set(0, 1, 0).applyQuaternion(h.q);
    this._seg(bm[o + B.FORE], E, Wp, hy);
    // hand + fingers
    const hm = bm[o + B.HAND]; h.matrix(hm);
    const P = side > 0 ? this.poseR : this.poseL;
    // index
    const q = Qs[1], t = V[16];
    t.set(FING[0][0] * side, KN_Y, -PALM_L); q.setFromAxisAngle(AXX, -P[0]);
    bm[o + B.I1].compose(t, q, ONE).premultiply(hm);
    t.set(0, 0, -FING[0][1]); q.setFromAxisAngle(AXX, -P[1]);
    bm[o + B.I2].compose(t, q, ONE).premultiply(bm[o + B.I1]);
    // middle / ring / pinky
    t.set(0, KN_Y, -PALM_L); q.setFromAxisAngle(AXX, -P[2]);
    bm[o + B.F1].compose(t, q, ONE).premultiply(hm);
    t.set(0, 0, -PROX); q.setFromAxisAngle(AXX, -P[3]);
    bm[o + B.F2].compose(t, q, ONE).premultiply(bm[o + B.F1]);
    // thumb
    t.set(TH_BASE.x * side, TH_BASE.y, TH_BASE.z);
    qView(q, TH_REST[1] + P[5], (TH_REST[0] + P[4]) * side, TH_REST[2] * side);
    bm[o + B.T1].compose(t, q, ONE).premultiply(hm);
    t.set(0, 0, -TH_L1); q.setFromAxisAngle(AXX, -P[6]);
    bm[o + B.T2].compose(t, q, ONE).premultiply(bm[o + B.T1]);
  }
  /** bone matrix for a limb segment from A to B (local -Z along the limb, +Y towards `up`) */
  _seg(m, A, Bp, up) {
    const z = V[17].subVectors(A, Bp).normalize();     // local +Z points back up the limb
    const y = V[18].copy(up).addScaledVector(z, -up.dot(z));
    if (y.lengthSq() < 1e-6) y.set(0, 0, 1).addScaledVector(z, -z.z);
    y.normalize();
    const x = V[19].crossVectors(y, z);
    m.makeBasis(x, y, z).setPosition(A);
  }

  // ------------------------------------------------------------------ render
  render(renderer, aspect, camera) {
    if (camera) this.setCamera(camera);
    if (aspect && Math.abs(aspect - this.camera.aspect) > 1e-4) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
    this._applyLights();
    this.scopeMat.uniforms.uA.value = this.camera.aspect;
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = ac;
    if (this._fovBack && this._mainCam) { this._mainCam.fov = this._fovBack; this._mainCam.updateProjectionMatrix(); this._fovBack = 0; }
  }

  /**
   * Muzzle tip (gun), flame tip (torch / flare) or the right hand, in view space of a
   * camera at the origin looking down -Z. If st.fov / vm.mainFov is set, x/y are
   * re-projected so the point lands on the same pixel through the main camera.
   */
  muzzleView(out) {
    this._muzzleRaw(out);
    if (this.mainFov) { const k = Math.tan(this.mainFov * PI / 360) / Math.tan(this.camera.fov * PI / 360); out.x *= k; out.y *= k; }
    return out;
  }
  _muzzleRaw(out) {
    const c = this.cfg;
    if (c && c.flame && this.held) { out.copy(c.flame.userData.tip || ZERO3); c.flame.updateMatrix(); out.applyMatrix4(c.flame.matrix).applyMatrix4(this.itemG.matrix); }
    else if (c && (c.hasMuzzle || c.light) && this.held) out.copy(this.muzzleLocal).applyMatrix4(this.itemG.matrix);
    else out.setFromMatrixPosition(this.bones[B.HAND].matrixWorld).add(V[0].set(0, 0, -0.05));
    return out;
  }

  dispose() {
    if (this.held) this.held.traverse(o => { if (o.isMesh && o.userData.own) o.geometry.dispose(); });
    this.arms.geometry.dispose(); this.skeleton.dispose();
    this.flashMesh.geometry.dispose(); this.flashMesh.material.map.dispose(); this.flashMesh.material.dispose();
    this.scopeMesh.geometry.dispose(); this.scopeMat.dispose();
    this.beam.geometry.dispose(); this.beam.material.map.dispose(); this.beam.material.dispose(); this.lampGlow.geometry.dispose(); this.lampGlow.material.dispose();
    for (const m of this._matClone.values()) m.dispose();
    this._matClone.clear();
  }
}

export default ViewModel;

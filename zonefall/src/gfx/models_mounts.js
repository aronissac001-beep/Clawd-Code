// ============================================================================
// ZONEFALL 4 — rideable mounts (comic / cel style, +X forward, y = 0 on the ground):
//   horse      chunky low-poly horse in saddle, blanket, bridle and reins. Four
//              two-bone legs driven by a procedural gait: four-beat walk, trot,
//              four-beat gallop, with footfalls matched to the ground speed (the
//              hoof in stance stays put on the ground). Head bob, back rock, tail
//              sway; idle grazing, ear flicks and tail swishes; a collapse on death.
//   moto       old boxer-twin motorcycle with a sidecar: sprung saddle, pillion pad,
//              sidecar tub with a seat and a little windscreen. Steering fork,
//              spinning wheels, a body that leans on its springs into turns, and a
//              headlight beam.
//   hitchRail  wooden hitching rail with a water trough (static decoration).
// Static parts are merged per material (M.bake); moving parts stay separate groups.
// Every mount model has animate(dt, state), driven by vehicles.js from the
// vehicle's motion, and tick(dt, netState) for co-op friends' mounts where only
// {x,y,z,yaw,p,r,rpm} is known (speed and turning come from the motion itself).
// Roll convention for mounts: state r / v.roll > 0 = right side UP (matches the
// first-person camera roll), so the root is rolled by -r.
// ============================================================================
import { THREE, M } from './materials.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const frac = x => x - Math.floor(x);
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));

/** bake a moving part: build static boxes into a temp group, merge, hang it on the pivot */
function part(pivot, build) { const g = new THREE.Group(); build(g); const b = M.bake(g); pivot.add(b); return b; }
function grp(parent, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }
function shadows(root, skip) { root.traverse(o => { if (o.isMesh && !(skip && skip.has(o))) { o.castShadow = true; o.receiveShadow = true; } }); }

// ============================================================================
// HORSE
// ============================================================================
export const HORSE_COATS = {
  bay: { coat: '#8b5532', mane: '#1e1714', legs: '#231a16', muzzle: '#3a2a22' },
  chestnut: { coat: '#a85a2a', mane: '#78391a', legs: '#a85a2a', muzzle: '#5e3420', socks: true },
  black: { coat: '#2e2724', mane: '#141010', legs: '#1c1715', muzzle: '#1c1715', blaze: true },
  grey: { coat: '#bdb7ac', mane: '#78736c', legs: '#8e8982', muzzle: '#4e4a46' },
  palomino: { coat: '#d4a95e', mane: '#f1e6c8', legs: '#d4a95e', muzzle: '#8a6a44', blaze: true, socks: true },
  dun: { coat: '#b8925e', mane: '#3e3024', legs: '#3e3024', muzzle: '#5a4632' },
};
export const HORSE_KEYS = Object.keys(HORSE_COATS);
const BLANKETS = ['#b8402f', '#3a6ea8', '#c9a23a', '#4f6e3e', '#7a3f8a'];
/** 'bay:2' -> { coat: 'bay', blanket: 2 } (unknown -> a random look) */
export function horseLook(col) {
  const [c, b] = String(col || '').split(':');
  return { coat: HORSE_COATS[c] ? c : HORSE_KEYS[Math.floor(Math.random() * HORSE_KEYS.length)], blanket: Number.isFinite(+b) && b !== undefined && b !== '' ? (+b % BLANKETS.length + BLANKETS.length) % BLANKETS.length : Math.floor(Math.random() * BLANKETS.length) };
}
export function randomHorseCol(R = Math.random) { return HORSE_KEYS[Math.floor(R() * HORSE_KEYS.length)] + ':' + Math.floor(R() * BLANKETS.length); }

const BODY_Y = 1.2;                 // barrel centre above the ground
export const HORSE_SEAT = [-0.04, 1.57, 0], HORSE_PILLION = [-0.55, 1.63, 0];
// gait footfall offsets (fraction of a stride) for legs [LF, RF, LH, RH]
const G_WALK = [0.25, 0.75, 0, 0.5], G_TROT = [0, 0.5, 0.5, 0], G_GAL = [0.38, 0.5, 0, 0.12];
let reinGeo = null;

export function buildHorse(col) {
  const look = horseLook(col), C = HORSE_COATS[look.coat];
  const root = new THREE.Group(), fall = grp(root), body = grp(fall, 0, BODY_Y, 0);
  const coat = M.mat(C.coat, { tex: 'noise' }), coatP = M.mat(C.coat), mane = M.mat(C.mane), legM = M.mat(C.legs), hoofM = M.mat('#2a221e'), muz = M.mat(C.muzzle), ink = M.mat('#141012');
  const leather = M.mat('#6a4026', { tex: 'cloth' }), strap = M.mat('#3a2418'), blanket = M.mat(BLANKETS[look.blanket], { tex: 'cloth' }), metal = M.mat('#c8c2b2', { tex: 'metal' }), white = M.mat('#efe9dc');
  // ---- barrel, chest, rump, saddle (one baked mesh set)
  part(body, g => {
    M.add(g, M.box(1.24, 0.56, 0.54), coat, 0, 0, 0);                         // barrel
    M.add(g, M.box(0.46, 0.64, 0.5), coat, 0.66, 0.02, 0);                    // chest
    M.add(g, M.box(0.14, 0.5, 0.4), coatP, 0.93, -0.03, 0);                   // breast
    M.add(g, M.box(0.42, 0.12, 0.36), coatP, 0.5, 0.36, 0);                   // withers
    M.add(g, M.box(0.56, 0.6, 0.58), coat, -0.62, 0.04, 0);                   // rump
    M.add(g, M.box(0.46, 0.06, 0.46), coatP, -0.62, 0.36, 0);                 // croup
    M.add(g, M.box(0.2, 0.42, 0.46), coatP, -0.92, 0.02, 0);                  // buttocks
    M.add(g, M.box(0.92, 0.1, 0.46), coatP, 0.02, -0.31, 0);                  // belly
    for (const s of [-1, 1]) {
      M.add(g, M.box(0.5, 0.56, 0.1), coatP, -0.62, -0.06, s * 0.3);          // hindquarter muscles
      M.add(g, M.box(0.34, 0.5, 0.08), coatP, 0.62, -0.06, s * 0.26);         // shoulders
    }
    // tack: girth, blanket, saddle, stirrups, saddlebags, pillion pad
    M.add(g, M.box(0.08, 0.6, 0.565), strap, 0.18, -0.01, 0);
    M.add(g, M.box(0.74, 0.03, 0.6), blanket, 0, 0.295, 0);
    for (const s of [-1, 1]) M.add(g, M.box(0.72, 0.25, 0.02), blanket, 0, 0.175, s * 0.29);
    M.add(g, M.box(0.5, 0.07, 0.4), leather, -0.03, 0.335, 0);               // seat
    M.add(g, M.box(0.12, 0.12, 0.3), leather, 0.2, 0.37, 0);                  // pommel
    M.add(g, M.cyl(0.03, 0.036, 0.1, 6), strap, 0.25, 0.47, 0);              // horn
    M.add(g, M.cyl(0.052, 0.052, 0.025, 8), strap, 0.25, 0.53, 0);
    M.add(g, M.box(0.07, 0.14, 0.36), leather, -0.28, 0.4, 0);               // cantle
    for (const s of [-1, 1]) {
      M.add(g, M.box(0.5, 0.22, 0.02), leather, -0.02, 0.2, s * 0.305);       // skirts
      M.add(g, M.box(0.05, 0.4, 0.02), strap, 0.04, 0.0, s * 0.318);          // stirrup leathers
      M.add(g, M.box(0.13, 0.03, 0.1), metal, 0.04, -0.21, s * 0.34);         // stirrups
      M.add(g, M.box(0.02, 0.11, 0.1), metal, -0.015, -0.16, s * 0.34); M.add(g, M.box(0.02, 0.11, 0.1), metal, 0.095, -0.16, s * 0.34);
      M.add(g, M.box(0.24, 0.22, 0.1), leather, -0.46, 0.17, s * 0.335);      // saddlebags
      M.add(g, M.box(0.25, 0.06, 0.11), strap, -0.46, 0.27, s * 0.336);
    }
    M.add(g, M.box(0.32, 0.04, 0.42), blanket, -0.56, 0.405, 0);             // pillion pad
  });
  // ---- neck + head + ears
  const neck = grp(body, 0.72, 0.26, 0);
  part(neck, g => {
    M.add(g, M.box(0.38, 0.5, 0.32), coatP, 0.12, -0.04, 0);
    M.add(g, M.box(0.8, 0.34, 0.25), coat, 0.42, 0, 0);
    M.add(g, M.box(0.52, 0.12, 0.2), coatP, 0.5, -0.17, 0);                   // throat
    M.add(g, M.box(0.84, 0.08, 0.08), mane, 0.4, 0.2, 0);                     // crest
    M.add(g, M.box(0.78, 0.13, 0.03), mane, 0.42, 0.12, 0.135);               // mane falls to the right
  });
  const head = grp(neck, 0.82, 0, 0); head.scale.setScalar(1.12);
  part(head, g => {
    M.add(g, M.box(0.3, 0.27, 0.23), coatP, 0.08, 0, 0);                      // skull
    M.add(g, M.box(0.2, 0.14, 0.21), coatP, 0.02, -0.14, 0);                  // jowl
    M.add(g, M.box(0.3, 0.2, 0.19), coatP, 0.34, -0.03, 0);                   // muzzle
    M.add(g, M.box(0.08, 0.18, 0.18), muz, 0.52, -0.04, 0);                   // nose
    for (const s of [-1, 1]) { M.add(g, M.box(0.03, 0.04, 0.03), ink, 0.56, -0.01, s * 0.05); M.add(g, M.box(0.05, 0.05, 0.02), ink, 0.1, 0.06, s * 0.117); }
    M.add(g, M.box(0.12, 0.02, 0.192), ink, 0.47, -0.122, 0);                 // mouth line
    M.add(g, M.box(0.12, 0.07, 0.13), mane, -0.03, 0.15, 0);                  // forelock
    if (C.blaze) { M.add(g, M.box(0.22, 0.012, 0.06), white, 0.08, 0.136, 0); M.add(g, M.box(0.28, 0.012, 0.06), white, 0.33, 0.072, 0); }
    // bridle
    M.add(g, M.box(0.03, 0.03, 0.25), strap, -0.03, 0.1, 0);                  // browband
    M.add(g, M.box(0.03, 0.29, 0.245), strap, 0.1, -0.02, 0);                 // headpiece / cheeks
    M.add(g, M.box(0.035, 0.22, 0.205), strap, 0.3, -0.03, 0);                // noseband
    for (const s of [-1, 1]) M.add(g, M.box(0.05, 0.05, 0.02), metal, 0.42, -0.1, s * 0.105); // bit rings
  });
  const ears = [];
  for (const s of [-1, 1]) {
    const e = grp(head, -0.06, 0.13, s * 0.07);
    part(e, g => { M.add(g, M.box(0.05, 0.15, 0.045), coatP, 0, 0.07, 0); M.add(g, M.box(0.02, 0.1, 0.03), ink, 0.018, 0.07, 0); });
    e.userData.s = s; ears.push(e);
  }
  // ---- tail
  const tail = grp(body, -0.94, 0.3, 0);
  part(tail, g => M.add(g, M.box(0.2, 0.13, 0.13), coatP, -0.06, 0, 0));
  const hair = grp(tail, -0.15, 0, 0);
  part(hair, g => { M.add(g, M.box(0.14, 0.7, 0.15), mane, 0, -0.32, 0); M.add(g, M.box(0.18, 0.22, 0.19), mane, -0.01, -0.6, 0); });
  // ---- legs: [LF, RF, LH, RH]; the upper part pivots high (shoulder / hip joint, hidden in the body)
  //      -> knee / hock -> hoof (hoof baked into the lower part)
  const legs = [];
  const sock = C.socks ? white : legM;
  for (const [front, s] of [[true, -1], [true, 1], [false, -1], [false, 1]]) {
    const hx = front ? 0.6 : -0.6, hy = front ? 0.05 : 0.12, l1 = front ? 0.72 : 0.82, l2 = front ? 0.535 : 0.54;
    const hip = grp(body, hx, hy, s * (front ? 0.15 : 0.16)), knee = grp(hip, 0, -l1, 0);
    part(hip, g => {
      if (front) { M.add(g, M.box(0.22, 0.36, 0.17), coatP, 0.02, -0.2, 0); M.add(g, M.box(0.17, 0.5, 0.15), coatP, 0, -0.47, 0); M.add(g, M.box(0.12, 0.1, 0.14), coatP, -0.08, -0.4, 0); }
      else { M.add(g, M.box(0.3, 0.46, 0.18), coatP, 0.02, -0.25, 0); M.add(g, M.box(0.17, 0.42, 0.14), coatP, -0.01, -0.62, 0); }
    });
    part(knee, g => {
      M.add(g, M.box(0.13, 0.11, 0.12), legM, front ? 0 : -0.02, 0, 0);
      M.add(g, M.box(0.1, l2 - 0.2, 0.1), legM, 0, -(l2 - 0.2) / 2 - 0.02, 0);
      M.add(g, M.box(0.13, 0.08, 0.12), sock, 0, -(l2 - 0.15), 0);             // fetlock
      M.add(g, M.box(0.1, 0.05, 0.1), sock, 0.02, -(l2 - 0.1), 0);              // pastern
      M.add(g, M.box(0.16, 0.09, 0.15), hoofM, 0.03, -l2 + 0.045, 0);           // hoof
    });
    legs.push({ hip, knee, front, s, l1, l2, hx, hy, bend: front ? 1 : -1, u: 0, fx: 0, fy: 0, on: true });
  }
  // ---- reins: pommel -> bit, re-aimed every frame (the head moves)
  if (!reinGeo) reinGeo = new THREE.BoxGeometry(1, 0.022, 0.022).translate(0.5, 0, 0);
  const reins = [-1, 1].map(s => { const r = new THREE.Mesh(reinGeo, strap); r.position.set(0.22, 0.42, s * 0.09); body.add(r); r.userData.s = s; return r; });
  shadows(root);

  const H = {
    root, fall, body, neck, head, ears, tail, hair, legs, reins, look,
    ph: Math.random(), t: Math.random() * 20, riderBob: 0, rock: 0,
    neckA: 0.92, headA: -0.95, neckY: 0, mode: 'stand', modeT: 2 + Math.random() * 4, lookY: 0,
    earT: [Math.random() * 3, Math.random() * 3], earK: [0, 0], swishT: 2 + Math.random() * 4, swishK: 0, sway: 0, hairSway: 0, tailLift: 0,
    _v: new THREE.Vector3(), _q: new THREE.Quaternion(), _x: new THREE.Vector3(1, 0, 0),
    /**
     * st: { speed (signed, m/s along the heading), turn (yaw rate, rad/s), ridden, tied, dead (0..1+ collapse), side (fall side ±1),
     *       onStep(legIndex, gaitWeights) }
     */
    animate(dt, st) {
      dt = clamp(dt || 0, 0, 0.1); st = st || {};
      this.t += dt;
      const sp = st.speed || 0, as = Math.abs(sp), turnStep = Math.min(1.3, Math.abs(st.turn || 0) * 0.9);
      const se = Math.max(as, turnStep), dead = st.dead || 0;
      // gait weights
      const wG = sstep(6.0, 7.6, as), wT = sstep(1.6, 2.6, as) * (1 - wG), wW = 1 - wT - wG;
      const freq = se <= 1.6 ? 0.8 + 0.25 * se : se <= 6 ? 1.2 + (se - 1.6) * 0.09 : 1.6 + Math.min(se - 6, 9) * 0.06;
      const amp = sstep(0.03, 0.45, se) * (1 - sstep(0, 0.3, dead));
      if (se > 0.02 && !dead) this.ph = frac(this.ph + freq * dt * (sp < -0.05 ? -1 : 1));
      const stride = se / freq, duty0 = wW * 0.62 + wT * 0.42 + wG * 0.3;
      const stance = Math.min(duty0 * stride, 1.0), duty = stride > 1e-3 ? clamp(stance / stride, 0.12, 0.7) : duty0;
      const lift = wW * 0.13 + wT * 0.24 + wG * 0.34;
      const p2 = this.ph * TAU;
      // body bob / rock
      const bob = amp * (wT * 0.015 * Math.cos(2 * (p2 - 0.21 * TAU) + Math.PI) + wG * 0.06 * Math.cos(p2 - 0.9 * TAU));
      const rock = amp * wG * 0.04 * Math.cos(p2 - 0.05 * TAU);
      // ---- idle behaviour (grazing, looking around, resting when tied)
      const idle = !st.ridden && se < 0.15 && !dead;
      if (idle) {
        this.modeT -= dt;
        if (this.modeT <= 0) {
          if (st.tied) { this.mode = this.mode === 'rest' ? 'stand' : Math.random() < 0.55 ? 'rest' : 'stand'; this.modeT = 4 + Math.random() * 8; }
          else { this.mode = this.mode === 'graze' ? 'stand' : Math.random() < 0.75 ? 'graze' : 'stand'; this.modeT = this.mode === 'graze' ? 7 + Math.random() * 12 : 3 + Math.random() * 6; }
          this.lookY = (Math.random() - 0.5) * 0.9;
        }
      } else if (this.mode !== 'stand') { this.mode = 'stand'; this.modeT = 3 + Math.random() * 4; }
      // ---- neck / head (absolute angles: + = up)
      let nA = 0.92, hA = -0.95, nY = 0;
      if (idle && this.mode === 'graze') { nA = -1.12; hA = -1.42 + 0.05 * Math.sin(this.t * 8.5); nY = 0.12 * Math.sin(this.t * 0.6); }
      else if (idle && this.mode === 'rest') { nA = 0.45; hA = -1.25; nY = this.lookY * 0.3; }
      else if (idle) { nY = this.lookY * (0.6 + 0.4 * Math.sin(this.t * 0.4)); }
      if (!idle) {
        nA = lerp(0.92, 0.62, wG * amp) + (wT * 0.05) * amp;
        hA = lerp(-0.95, -0.68, wG * amp);
        nY = clamp(-(st.turn || 0) * 0.2, -0.35, 0.35);
      }
      nA += amp * (wW * 0.07 * Math.sin(2 * p2 + 1.0) + wT * 0.02 * Math.sin(2 * p2) + wG * 0.14 * Math.cos(p2 - 0.05 * TAU));
      if (dead) { const k = sstep(0, 0.9, dead); nA = lerp(nA, 0.05, k); hA = lerp(hA, -0.15, k); nY = lerp(nY, 0, k); }
      const kH = dead ? 4 : idle ? 2.2 : 6;
      this.neckA = damp(this.neckA, nA, kH, dt); this.headA = damp(this.headA, hA, kH * 1.3, dt); this.neckY = damp(this.neckY, nY, 2.5, dt);
      this.neck.rotation.set(0, this.neckY, this.neckA); this.head.rotation.set(0, 0, this.headA - this.neckA);
      // ---- ears: forward, flick now and then, back a little at the gallop
      for (let i = 0; i < 2; i++) {
        const e = this.ears[i];
        if ((this.earT[i] -= dt) <= 0) { this.earT[i] = (idle ? 1.2 : 2.5) + Math.random() * (idle ? 4 : 6); this.earK[i] = 1; }
        this.earK[i] = Math.max(0, this.earK[i] - dt * 2.6);
        const f = Math.sin(this.earK[i] * Math.PI);
        e.rotation.set(e.userData.s * (0.18 + 0.35 * f), 0, 0.98 + 0.55 * f + 0.3 * wG * amp + (dead ? 0.6 : 0) - (this.headA + 0.95) * 0.4);
      }
      // ---- tail: sway with the stride, lift at the gallop, swish at flies
      if (idle && (this.swishT -= dt) <= 0) { this.swishT = 2 + Math.random() * 5; this.swishK = 1; }
      this.swishK = Math.max(0, this.swishK - dt * 1.2);
      const sw = amp * 0.13 * Math.sin(p2 + 0.4) + 0.5 * Math.sin(this.t * 11) * Math.sin(this.swishK * Math.PI);
      this.sway = damp(this.sway, sw, 10, dt); this.hairSway = damp(this.hairSway, this.sway * 1.3, 6, dt);
      this.tailLift = damp(this.tailLift, -0.32 - 0.6 * wG * amp - 0.12 * wT * amp + (dead ? 0.5 : 0), 4, dt);
      this.tail.rotation.set(this.sway, 0, this.tailLift); this.hair.rotation.set(this.hairSway - this.sway, 0, -0.1 * amp * wG);
      // ---- hoof targets: stance hooves stay planted (they slide back at ground speed), swing hooves arc forward
      for (let i = 0; i < 4; i++) {
        const L = this.legs[i], off = (G_WALK[i] * wW + G_TROT[i] * wT + G_GAL[i] * wG);
        const u = frac(this.ph + off);
        let fx, fy, on = true;
        if (u < duty) { fx = stance * (0.5 - u / duty); fy = 0; }
        else { const w = (u - duty) / (1 - duty); fx = stance * (-0.5 + w * w * (3 - 2 * w)); fy = lift * Math.sin(Math.PI * w) * (L.front ? 1.12 : 1); on = false; }
        if (amp > 0.3 && !dead && ((L.u > 0.75 && u < 0.25 && sp >= 0) || (L.u < 0.25 && u > 0.75 && sp < 0))) { if (st.onStep) st.onStep(i, wG, wT); }
        L.u = u; L.fx = fx * amp; L.fy = fy * amp; L.on = on || amp < 0.5;
      }
      // ---- body: vaults over the planted legs (the hips can't be higher than the legs reach), plus the gallop's suspension
      let dF = 0, dH = 0;
      for (const L of this.legs) {
        if (!L.on) continue;
        const Lm = (L.l1 + L.l2) * 0.985, need = Math.max(0, BODY_Y + L.hy - Math.sqrt(Math.max(0.01, Lm * Lm - L.fx * L.fx)));
        if (L.front) dF = Math.max(dF, need); else dH = Math.max(dH, need);
      }
      this.dF = damp(this.dF || 0, dF, 22, dt); this.dH = damp(this.dH || 0, dH, 22, dt);
      const b = this.body;
      let by = BODY_Y + bob - (this.dF + this.dH) / 2, bRot = rock + (this.dH - this.dF) / 1.2 + (idle && this.mode === 'graze' ? -0.04 : 0);
      if (dead) { const k1 = sstep(0, 0.45, dead); by = lerp(by, 0.46, k1); bRot = lerp(bRot, 0, k1); }
      b.position.y = by; b.rotation.z = bRot;
      this.riderBob = (by - BODY_Y) * 0.65; this.rock = bRot;
      const roll = dead ? sstep(0.35, 1.0, dead) * 1.38 : 0;
      this.fall.rotation.x = roll * (st.side || 1); this.fall.position.y = 0.22 * roll / 1.38;
      // ---- legs: two-bone IK from the hip to the hoof target (front knees fold forward, hocks backward)
      const cr = Math.cos(bRot), sr = Math.sin(bRot);
      for (const L of this.legs) {
        let tx = L.hx + L.fx + (L.front ? 0.02 : -0.03), ty = L.fy;
        if (dead) {
          const k1 = sstep(0, 0.4, dead), k2 = sstep(0.45, 1.0, dead);
          const fold = [L.hx + (L.front ? -0.12 : 0.2), by - 0.42], ext = [L.hx + (L.front ? 0.5 : -0.2), by - 0.9];
          tx = lerp(lerp(tx, fold[0], k1), ext[0], k2); ty = lerp(lerp(ty, fold[1], k1), ext[1], k2);
        }
        const dx = tx, dy = ty - by;                       // relative to the body origin (fall frame)
        const lx = dx * cr + dy * sr - L.hx, ly = -dx * sr + dy * cr - L.hy; // un-rotate by the body pitch, then hip-relative
        const d = clamp(Math.hypot(lx, ly), Math.abs(L.l1 - L.l2) + 0.02, L.l1 + L.l2 - 1e-4);
        const phi = Math.atan2(lx, -ly), al = Math.acos(clamp((L.l1 * L.l1 + d * d - L.l2 * L.l2) / (2 * L.l1 * d), -1, 1));
        const t1 = phi + L.bend * al, kx = L.l1 * Math.sin(t1), ky = -L.l1 * Math.cos(t1);
        const t2 = Math.atan2(lx - kx, -(ly - ky));
        L.hip.rotation.z = t1; L.knee.rotation.z = wrapA(t2 - t1);
      }
      // ---- reins: from the pommel to the bit rings
      this.neck.updateMatrix(); this.head.updateMatrix();
      for (const r of this.reins) {
        const v = this._v.set(0.42, -0.1, r.userData.s * 0.105).applyMatrix4(this.head.matrix).applyMatrix4(this.neck.matrix);
        v.sub(r.position); const len = v.length(); if (len < 1e-3) continue;
        r.quaternion.setFromUnitVectors(this._x, v.divideScalar(len)); r.scale.set(len, 1, 1);
      }
    },
    /** co-op fallback model: pose + gait from the network state alone */
    tick(dt, vs) { netPose(this, dt, vs); this.animate(dt, { speed: this._sp, turn: this._yr, ridden: true }); },
  };
  H.animate(0.016, {});
  return H;
}

/** shared by the fallback models: put the root where the friend's vehicle is, estimate speed and turn rate from the motion */
function netPose(m, dt, vs) {
  const r = m.root; if (!vs) return;
  r.position.set(+vs.x || 0, +vs.y || 0, +vs.z || 0); r.rotation.set(0, -(+vs.yaw || 0), 0); r.rotateZ(+vs.p || 0); r.rotateX(-(+vs.r || 0));
  const yaw = +vs.yaw || 0, k = Math.max(dt, 1e-3);
  if (m._lx === undefined || Math.hypot(vs.x - m._lx, vs.z - m._lz) > 8) { m._lx = vs.x; m._lz = vs.z; m._ly = yaw; m._sp = 0; m._yr = 0; }
  const f = ((vs.x - m._lx) * Math.cos(yaw) + (vs.z - m._lz) * Math.sin(yaw)) / k, yr = wrapA(yaw - m._ly) / k;
  m._sp = damp(m._sp, clamp(f, -20, 30), 6, dt); m._yr = damp(m._yr, clamp(yr, -4, 4), 6, dt);
  m._lx = vs.x; m._lz = vs.z; m._ly = yaw;
}

// ============================================================================
// MOTORCYCLE WITH SIDECAR (origin: middle of the rig; bike on z = -0.4, sidecar to the right)
// ============================================================================
export const MOTO_COLORS = ['#5d6b3c', '#8a7a5a', '#3a3f47', '#8a2f24', '#2a4a6e', '#23232a'];
export const MOTO_BIKE_Z = -0.4;
export const MOTO_SEAT = [-0.16, 0.95, MOTO_BIKE_Z], MOTO_PILLION = [-0.58, 0.94, MOTO_BIKE_Z], MOTO_CHAIR = [-0.42, 0.47, MOTO_BIKE_Z + 0.9];

function wheel(parent, r, w, tyre, rim, x, y, z) {
  const g = grp(parent, x, y, z);
  part(g, q => {
    M.add(q, M.cyl(r, r, w, 14), tyre, 0, 0, 0, { rx: Math.PI / 2 });
    M.add(q, M.cyl(r * 0.62, r * 0.62, w + 0.01, 10), rim, 0, 0, 0, { rx: Math.PI / 2 });
    M.add(q, M.cyl(r * 0.2, r * 0.2, w + 0.04, 8), tyre, 0, 0, 0, { rx: Math.PI / 2 });
    for (let i = 0; i < 3; i++) M.add(q, M.box(r * 1.15, 0.025, w * 0.5), tyre, 0, 0, 0, { rz: i * Math.PI / 3 }); // spokes
  });
  return g;
}

export function buildMoto(col) {
  col = col || MOTO_COLORS[Math.floor(Math.random() * MOTO_COLORS.length)];
  const root = new THREE.Group();
  const paint = M.mat(col, { tex: 'metal' }), dark = M.mat('#2a2624', { tex: 'metal' }), black = M.mat('#1a1818'), steel = M.mat('#a9adb2', { tex: 'metal' });
  const leather = M.mat('#5a3a26', { tex: 'cloth' }), rubber = M.mat('#141313'), tyre = M.mat('#1a1a1c', { tex: 'rock' }), rim = M.mat('#9a978e');
  const lean = grp(root, 0, 0, MOTO_BIKE_Z);   // leans about the bike's contact line
  part(lean, g => {
    // frame
    M.add(g, M.box(1.1, 0.06, 0.16), dark, -0.02, 0.27, 0);
    M.add(g, M.box(0.98, 0.07, 0.07), dark, 0.06, 0.8, 0, { rz: -0.1 });
    M.add(g, M.box(0.07, 0.62, 0.07), dark, 0.46, 0.57, 0, { rz: 0.45 });
    M.add(g, M.box(0.1, 0.2, 0.1), dark, 0.56, 0.86, 0, { rz: 0.32 });            // head tube
    // boxer twin: crankcase, cylinders with fins sticking out each side, gearbox
    M.add(g, M.box(0.36, 0.3, 0.26), steel, 0.06, 0.42, 0);
    for (const s of [-1, 1]) {
      M.add(g, M.box(0.2, 0.17, 0.22), steel, 0.14, 0.46, s * 0.23);
      for (let k = 0; k < 3; k++) M.add(g, M.box(0.24, 0.025, 0.2), steel, 0.14, 0.4 + k * 0.055, s * 0.25);
      M.add(g, M.box(0.15, 0.15, 0.08), dark, 0.14, 0.46, s * 0.37);
      M.add(g, M.cyl(0.035, 0.035, 0.95, 6), steel, -0.25, 0.28, s * 0.2, { rz: Math.PI / 2 + 0.06 });   // exhaust pipes
      M.add(g, M.cyl(0.06, 0.055, 0.34, 8), steel, -0.66, 0.34, s * 0.2, { rz: Math.PI / 2 + 0.12 });    // silencers
      M.add(g, M.box(0.04, 0.03, 0.14), black, 0.02, 0.33, s * 0.26);           // footpegs
      M.add(g, M.box(0.04, 0.32, 0.04), steel, -0.56, 0.54, s * 0.11, { rz: 0.32 }); // rear shocks
      M.add(g, M.box(0.14, 0.1, 0.02), rubber, 0.12, 0.9, s * 0.135);           // tank knee pads
      M.add(g, M.box(0.03, 0.05, 0.12), black, -0.48, 0.86, s * 0.12);          // pillion pegs
    }
    M.add(g, M.box(0.24, 0.24, 0.2), dark, -0.22, 0.45, 0);
    // tank, saddle (on springs), pillion pad on a rack, fenders, tail lamp, pannier
    M.add(g, M.box(0.5, 0.2, 0.26), paint, 0.28, 0.9, 0);
    M.add(g, M.box(0.42, 0.06, 0.2), paint, 0.27, 1.02, 0);
    M.add(g, M.cyl(0.035, 0.035, 0.03, 8), steel, 0.4, 1.06, 0);                // filler cap
    M.add(g, M.box(0.34, 0.07, 0.3), leather, -0.14, 0.93, 0);
    M.add(g, M.box(0.12, 0.05, 0.22), leather, -0.02, 0.95, 0);
    for (const s of [-1, 1]) M.add(g, M.cyl(0.022, 0.022, 0.12, 6), steel, -0.26, 0.84, s * 0.08);
    M.add(g, M.box(0.36, 0.03, 0.2), dark, -0.58, 0.86, 0);
    M.add(g, M.box(0.3, 0.06, 0.26), leather, -0.58, 0.905, 0);
    M.add(g, M.box(0.6, 0.05, 0.2), paint, -0.7, 0.72, 0, { rz: 0.28 });
    M.add(g, M.box(0.08, 0.2, 0.2), paint, -0.98, 0.58, 0, { rz: 0.5 });
    M.add(g, M.box(0.05, 0.06, 0.09), M.basic('#d8301e'), -1.0, 0.7, 0);
    M.add(g, M.box(0.32, 0.26, 0.11), leather, -0.68, 0.56, -0.2);              // left pannier
    // sidecar: chassis + struts to the bike
    M.add(g, M.box(1.1, 0.05, 0.05), dark, -0.12, 0.24, 0.9);
    for (const x of [0.32, -0.46]) M.add(g, M.box(0.05, 0.05, 0.9), dark, x, 0.27, 0.45);
    M.add(g, M.box(0.05, 0.42, 0.05), dark, 0.32, 0.47, 0.12, { rx: 0.5 });
    // sidecar tub: floor, side walls, back, closed nose deck, padded rim, seat, spare wheel
    M.add(g, M.box(1.1, 0.06, 0.6), paint, -0.15, 0.31, 0.9);
    for (const z of [0.62, 1.18]) { M.add(g, M.box(1.12, 0.38, 0.05), paint, -0.15, 0.5, z); M.add(g, M.box(0.64, 0.05, 0.08), leather, -0.39, 0.71, z); }
    M.add(g, M.box(0.06, 0.38, 0.6), paint, -0.72, 0.5, 0.9);
    M.add(g, M.box(0.08, 0.05, 0.64), leather, -0.72, 0.71, 0.9);
    M.add(g, M.box(0.5, 0.38, 0.6), paint, 0.46, 0.5, 0.9);
    M.add(g, M.box(0.24, 0.3, 0.5), paint, 0.8, 0.47, 0.9);
    M.add(g, M.box(0.14, 0.22, 0.4), paint, 0.96, 0.45, 0.9);
    M.add(g, M.box(0.5, 0.02, 0.56), dark, 0.46, 0.7, 0.9);
    M.add(g, M.box(0.04, 0.05, 0.6), leather, 0.2, 0.71, 0.9);
    M.add(g, M.box(0.4, 0.1, 0.5), leather, -0.45, 0.4, 0.9);                   // seat cushion
    M.add(g, M.box(0.08, 0.3, 0.5), leather, -0.66, 0.58, 0.9);                 // seat back
    M.add(g, M.box(0.03, 0.04, 0.3), steel, 0.66, 0.74, 0.9);                   // grab rail
    M.add(g, M.cyl(0.25, 0.25, 0.1, 12), tyre, -0.82, 0.52, 0.9, { rz: Math.PI / 2 });
    M.add(g, M.cyl(0.14, 0.14, 0.11, 8), rim, -0.82, 0.52, 0.9, { rz: Math.PI / 2 });
  });
  // windscreen (see-through, kept out of the bake's vertex colours)
  M.add(lean, M.box(0.03, 0.22, 0.44), M.mat('#9ec4d0', { transparent: true, opacity: 0.32 }), 0.2, 0.83, 0.9, { rz: -0.25, cast: false });
  // steering: fork, headlamp, bars + mirrors, front fender, front wheel
  const fork = grp(lean, 0.56, 0.88, 0);
  part(fork, g => {
    for (const s of [-1, 1]) M.add(g, M.box(0.05, 0.6, 0.05), steel, 0.09, -0.27, s * 0.09, { rz: 0.32 });
    M.add(g, M.box(0.08, 0.05, 0.24), dark, 0.0, -0.02, 0);
    M.add(g, M.cyl(0.11, 0.095, 0.13, 10), dark, 0.13, 0.03, 0, { rz: Math.PI / 2 });
    M.add(g, M.box(0.05, 0.05, 0.78), black, -0.04, 0.2, 0);
    for (const s of [-1, 1]) {
      M.add(g, M.box(0.04, 0.16, 0.04), black, 0.0, 0.1, s * 0.1);
      M.add(g, M.box(0.13, 0.065, 0.065), rubber, -0.08, 0.2, s * 0.37);
      M.add(g, M.box(0.018, 0.2, 0.018), black, -0.04, 0.31, s * 0.34, { rx: s * 0.2 }); // mirror stalks
      M.add(g, M.box(0.025, 0.05, 0.07), steel, -0.04, 0.42, s * 0.365);
    }
    M.add(g, M.cyl(0.05, 0.05, 0.03, 10), M.mat('#e8e0c8'), -0.02, 0.26, 0);    // speedo
    M.add(g, M.box(0.46, 0.05, 0.17), paint, 0.17, -0.17, 0, { rz: -0.12 });     // front fender
  });
  M.add(fork, M.cyl(0.085, 0.085, 0.02, 12), M.basic('#fff3c8'), 0.2, 0.03, 0, { rz: Math.PI / 2 });
  const tyreW = 0.13;
  const wF = wheel(fork, 0.34, tyreW, tyre, rim, 0.18, -0.54, 0);
  const wR = wheel(lean, 0.34, tyreW, tyre, rim, -0.66, 0.34, 0);
  const wS = wheel(root, 0.3, 0.12, tyre, rim, -0.15, 0.3, MOTO_BIKE_Z + 1.32);  // the sidecar wheel stays on the ground
  part(root, g => { M.add(g, M.box(0.5, 0.04, 0.18), paint, -0.15, 0.66, MOTO_BIKE_Z + 1.32); M.add(g, M.box(0.04, 0.3, 0.04), dark, -0.15, 0.5, MOTO_BIKE_Z + 1.25); }); // its fender rides with it
  const lights = grp(fork);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(2.1, 11, 12, 1, true).rotateZ(Math.PI / 2).translate(5.7, 0.03, 0), new THREE.MeshBasicMaterial({ color: '#fff3c0', transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  lights.add(cone); lights.visible = false;
  shadows(root, new Set([cone]));
  const Mo = {
    root, lean, fork, wh: [wF, wR, wS], lights, riderBob: 0, t: 0, leanA: 0,
    /** st: { speed, steer (-1..1), lean (rad, + = right side down), rpm, lights } */
    animate(dt, st) {
      dt = clamp(dt || 0, 0, 0.1); st = st || {}; this.t += dt;
      const sp = st.speed || 0;
      this.wh[0].rotation.z -= sp * dt / 0.34; this.wh[1].rotation.z -= sp * dt / 0.34; this.wh[2].rotation.z -= sp * dt / 0.3;
      this.fork.rotation.y = -(st.steer || 0) * 0.42;
      this.leanA = st.lean || 0;
      this.lean.rotation.x = this.leanA;
      const rpm = st.rpm || 0; this.lean.position.y = rpm > 0.05 ? 0.004 * Math.sin(this.t * 95) * (0.4 + rpm) : 0; // engine shake
      this.riderBob = this.lean.position.y;
      this.lights.visible = !!st.lights;
    },
    tick(dt, vs) {
      netPose(this, dt, vs);
      const ln = clamp(this._yr * this._sp * 0.028, -0.13, 0.13);
      this.animate(dt, { speed: this._sp, steer: clamp(this._yr * 0.8, -1, 1), lean: ln, rpm: +vs.rpm || 0.3 });
    },
  };
  return Mo;
}

// ============================================================================
// HITCHING RAIL (+X along the rail, centred; posts at ±1.25, trough past +X end)
// ============================================================================
export const RAIL_POSTS = [-1.25, 1.25], RAIL_TROUGH = { x: 2.05, w: 1.0, d: 0.5 };
export function buildHitchRail() {
  const g = new THREE.Group();
  const log = M.mat('#7a5534', { tex: 'log' }), plank = M.mat('#6e4c2e', { tex: 'plank' }), strap = M.mat('#3a2418'), water = M.mat('#4a7a8a');
  for (const x of RAIL_POSTS) { M.add(g, M.cyl(0.075, 0.085, 1.2, 7), log, x, 0.6, 0); M.add(g, M.cyl(0.09, 0.09, 0.05, 7), log, x, 1.2, 0); }
  M.add(g, M.cyl(0.055, 0.055, 2.9, 7), log, 0, 1.03, 0, { rz: Math.PI / 2 });
  M.add(g, M.box(0.025, 0.36, 0.025), strap, 0.45, 0.86, 0.06); M.add(g, M.box(0.025, 0.3, 0.025), strap, -0.6, 0.89, -0.06); // lead ropes
  const T = RAIL_TROUGH;
  M.add(g, M.box(T.w, 0.08, T.d), plank, T.x, 0.06, 0);
  for (const s of [-1, 1]) { M.add(g, M.box(T.w, 0.38, 0.06), plank, T.x, 0.27, s * (T.d / 2 - 0.03)); M.add(g, M.box(0.06, 0.38, T.d), plank, T.x + s * (T.w / 2 - 0.03), 0.27, 0); }
  M.add(g, M.box(T.w - 0.1, 0.02, T.d - 0.1), water, T.x, 0.38, 0);
  const b = M.bake(g); shadows(b);
  return b;
}

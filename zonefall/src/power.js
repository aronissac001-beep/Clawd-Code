// ============================================================================
// ZONEFALL — electricity. Every powered deployable (data_homestead.js POWER)
// has input / output sockets. A cable runs from one output to one input and is
// stored on its source: d.state.w = [[outIndex, targetEid], ...], where
// d.state.eid is a stable id that survives saves and co-op sync. Power flows
// down the cables from generators, solar panels, wind turbines and batteries:
//
//   * the wiring graph (who feeds whom, which devices form one network) is
//     rebuilt only when the cables change (a cheap signature check);
//   * once a second the host works out demand bottom-up (what everything after
//     a socket wants) and then hands power out top-down from every source, so
//     each device knows what it got. Consumers only work on their full watts;
//     batteries pass power through, store what is spare and make up shortfalls.
//   * the results live in d.state (pw powered, pin / pout watts in / out, av
//     watts a source could make, ch battery charge, lit ...), so they save and
//     reach co-op guests through networld.js like any other deployable state.
//
// The host simulates (Power.step, from Build.tick). Every peer draws
// (Power.frame): indicator lamps, sagging cables, the cable you are laying.
// ============================================================================
import { THREE, M } from './gfx/materials.js';
import { G } from './state.js';
import { DEPLOY } from './data.js';
import { POWER, WIRE_RANGE, TURRET_BOOST } from './data_homestead.js';
import { Build } from './build.js';
import { openDoor, closeDoor } from './doors.js';
import { clamp } from './util.js';

const r1 = v => Math.round(v * 10) / 10;
const SOURCE = { gen: 1, solar: 1, wind: 1 };
const SMELT = { metal_ore: 'metal', sulfur_ore: 'sulfur', hqm_ore: 'hqm' };
const IN_USE = 'That input already has a cable';
let EID = 0;
/** a stable id for a powered deployable (cables point at it) */
export const newEid = () => 'e' + Date.now().toString(36).slice(-5) + (++EID).toString(36) + Math.random().toString(36).slice(2, 5);
export const specOf = d => (d && POWER[d.type]) || null;
const nameOf = d => (DEPLOY[d.type] && DEPLOY[d.type].name) || d.type;
/** how bright the sun is, 0 (below the horizon) .. 1 (noon) */
export function sunK() { const e = Math.sin(((G.clock ?? 0.5) - 0.25) * Math.PI * 2); return clamp(e * 1.8, 0, 1); }
/** dusk to dawn (a little wider than the raid night, so lights come on before dark) */
export function isNight() { const c = G.clock ?? 0.5; return c > 0.76 || c < 0.24; }
/** does this deployable's light shine? (ovens and the cooking pot when burning, powered lights when powered) */
export function isLit(d) {
  const D = DEPLOY[d.type]; if (!D) return false;
  if (D.oven) return !!d.state.lit;
  if (!D.litState) return true;
  if (d.type === 'floodlight' && (d.owner !== 'player' || d.state.legacy)) return true; // monument / old-save floodlights keep their own power
  return !!d.state.lit;
}
export const holdingWire = p => { const s = p && p.inv && p.inv.belt.slots[p.sel]; return !!(s && s.id === 'wire_tool'); };

/** world position of a socket ('in' / 'out') or the indicator lamp ('ind'); the model is turned by -ry about Y */
export function portPos(d, kind, i = 0, out = new THREE.Vector3()) {
  const P = POWER[d.type] && POWER[d.type].ports; let p = null;
  if (P) p = kind === 'ind' ? P.ind : (kind === 'in' ? P.in : P.out)[i];
  if (!p) p = [0, 0.6, 0];
  const c = Math.cos(d.ry || 0), s = Math.sin(d.ry || 0);
  return out.set(d.x + p[0] * c - p[2] * s, (d.y || 0) + p[1], d.z + p[0] * s + p[2] * c);
}

// ---------------------------------------------------------------- shared meshes
let MAT = null, GEO = null;
function mats() {
  if (MAT) return MAT;
  MAT = { cable: M.mat('#1c1c22'), inS: M.mat('#e8c040'), outS: M.mat('#d84a30'), on: M.basic('#46e05a'), off: M.basic('#e0463a'), idle: M.basic('#3a3a3e'), warn: M.basic('#ffc928'), pend: M.basic('#7ae0ff') };
  GEO = { sock: new THREE.BoxGeometry(0.05, 0.05, 0.05), ind: new THREE.SphereGeometry(0.026, 8, 6) };
  return MAT;
}
// light pools: a soft additive glow on the floor under a lit ceiling light and where a floodlight's beam lands, plus the
// floodlight's faint beam. They only show at night (the point lights in game.js do the real lighting; on a phone with
// three or four pooled lights these make sure a lit room still reads as lit)
let PMAT = null;
function poolMats() {
  if (PMAT) return PMAT;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.7)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const tex = new THREE.CanvasTexture(c);
  const disc = col => new THREE.MeshBasicMaterial({ map: tex, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  PMAT = { warm: disc('#ffc080'), white: disc('#fff0d0'), beam: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }),
    disc: new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2) };
  // the beam: an open cone, apex at the origin pointing down -Y, bright at the lamp and fading out
  const cone = new THREE.ConeGeometry(1, 1, 14, 3, true).translate(0, -0.5, 0), n = cone.attributes.position.count, col = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const a = Math.max(0, 1 + cone.attributes.position.getY(i)); col[i * 4] = 1; col[i * 4 + 1] = 0.95; col[i * 4 + 2] = 0.82; col[i * 4 + 3] = a * a; }
  cone.setAttribute('color', new THREE.BufferAttribute(col, 4)); PMAT.cone = cone;
  return PMAT;
}
const _down = new THREE.Vector3(0, -1, 0), _dir = new THREE.Vector3();
/** set up / show / hide a light's pool (and a floodlight's beam), as children of its model */
function lightPool(d, lit) {
  if (!lit) { if (d._pool) d._pool.visible = false; return; }
  const P = poolMats();
  if (!d._pool) {
    const g = new THREE.Group(); g.name = 'pool';
    if (d.type === 'floodlight') {
      // the lens is at about (0.25, 2.15) in the model's frame, aimed along +X and down: where does the beam meet the floor?
      const c = Math.cos(d.ry || 0), sn = Math.sin(d.ry || 0); let t = 4.2, fy = d.y;
      for (let k = 0; k < 3; k++) { fy = Build.floorY(d.x + c * (0.25 + t), d.z + sn * (0.25 + t), d.y + 1); t = clamp((d.y + 2.15 - fy) / 0.55, 1.5, 9); }
      const ly = fy - d.y + 0.04, ax = 0.25 + t;
      const m = new THREE.Mesh(P.disc, P.white); m.position.set(ax, ly, 0); m.scale.set(3.4, 1, 2.6); m.renderOrder = 2; g.add(m);
      const b = new THREE.Mesh(P.cone, P.beam); b.position.set(0.32, 2.12, 0); _dir.set(ax - 0.32, ly - 2.12, 0); const L = _dir.length(); _dir.normalize();
      b.quaternion.setFromUnitVectors(_down, _dir); b.scale.set(L * 0.42, L, L * 0.42); b.renderOrder = 3; g.add(b);
    } else {
      const m = new THREE.Mesh(P.disc, P.warm); m.position.set(0, 0.04, 0); m.scale.setScalar(2.4); m.renderOrder = 2; g.add(m);
    }
    g.traverse(o => { o.castShadow = o.receiveShadow = false; }); d.mesh.add(g); d._pool = g;
  }
  d._pool.visible = true;
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
/** a cable hanging between two points: a parabola that sags more the longer it is */
function cableGeo(a, b) {
  const L = a.distanceTo(b), sag = Math.min(1.4, 0.1 + L * 0.04), n = Math.round(clamp(L * 1.6, 8, 44));
  const pts = []; for (let i = 0; i <= n; i++) { const t = i / n; pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t), a.z + (b.z - a.z) * t)); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, 0.017, 4, false);
}

export const Power = {
  sig: null, list: [], byEid: new Map(), parent: new Map(), nets: [], netOf: new Map(),
  cables: new Map(), pending: null, preview: null, memo: null, seen: null, visT: 0, cabT: 0,
  reset() {
    for (const m of this.cables.values()) { m.removeFromParent(); m.geometry.dispose(); }
    this.cables.clear(); this.dropPreview(); this.pending = null;
    this.sig = null; this.list = []; this.byEid = new Map(); this.parent = new Map(); this.nets = []; this.netOf = new Map();
  },
  // ---------------------------------------------------------------- lifecycle
  onPlace(d, opts = {}) {
    const S = POWER[d.type]; if (!S) return;
    const st = d.state; st.eid = (opts.state && opts.state.eid) || st.eid || newEid(); if (!Array.isArray(st.w)) st.w = [];
    if (S.kind === 'gen' || S.kind === 'furnace') st.on = 1;   // runs as soon as it has fuel / ore and power
    if (S.kind === 'switch') st.on = 0;
    if (S.kind === 'timer') st.mode = 'night';
    if (S.kind === 'sensor') st.who = 'all';
    if (S.kind === 'battery') st.ch = 0;
    this.decorate(d); this.sig = null;
  },
  onRemove(d) {
    if (this.pending && d.state && this.pending.eid === d.state.eid) this.cancelWire();
    this.sig = null; this.cabT = 0;
  },
  /** old saves: floodlights from before the power grid get an id and keep shining on their own */
  ensure(d) {
    const st = d.state || (d.state = {});
    if (!st.eid) { st.eid = newEid(); if (d.type === 'floodlight') st.legacy = 1; }
    if (!Array.isArray(st.w)) st.w = [];
  },
  /** sockets (yellow in, red out) and an indicator lamp on the model */
  decorate(d) {
    const S = POWER[d.type]; if (!S || !d.mesh || d._pwDeco) return;
    const m = mats(), P = S.ports || {}, g = new THREE.Group(); g.name = 'power';
    for (const p of P.in || []) M.add(g, GEO.sock, m.inS, p[0], p[1], p[2], { cast: false });
    for (const p of P.out || []) M.add(g, GEO.sock, m.outS, p[0], p[1], p[2], { cast: false });
    const ind = P.ind ? M.add(g, GEO.ind, m.idle, P.ind[0], P.ind[1], P.ind[2], { cast: false }) : null;
    d.mesh.add(g); d._pwDeco = { g, ind, look: 'idle' };
  },
  // ---------------------------------------------------------------- wiring graph
  /** rebuild who-feeds-whom when the cables changed (cheap signature check). soft: reuse this frame's check (labels) */
  graph(force, soft) {
    if (soft && !force && this.sig !== null && this._gT === G.t) return;
    this._gT = G.t;
    let sig = ''; const list = [];
    for (const d of Build.deploys) {
      if (d.dead || !POWER[d.type] || d.owner !== 'player') continue;
      this.ensure(d); list.push(d); sig += d.state.eid + (d.state.w.length ? JSON.stringify(d.state.w) : '') + ';';
    }
    if (!force && sig === this.sig) return;
    this.sig = sig; this.list = list; this.cabT = 0;
    this.byEid = new Map(list.map(d => [d.state.eid, d]));
    // the host drops cables to things that are gone (guests get the fixed state from the host)
    if (!G.netGuest) for (const d of list) if (d.state.w.some(w => !this.byEid.has(w[1]))) { d.state.w = d.state.w.filter(w => this.byEid.has(w[1])); }
    this.parent = new Map();
    for (const d of list) for (const [o, eid] of d.state.w) if (!this.parent.has(eid) && this.byEid.get(eid) !== d) this.parent.set(eid, { d, o });
    // networks (connected groups), for the panel's totals
    const up = new Map(list.map(d => [d, d])); const find = d => { while (up.get(d) !== d) { up.set(d, up.get(up.get(d))); d = up.get(d); } return d; };
    for (const d of list) for (const [, eid] of d.state.w) { const t = this.byEid.get(eid); if (t) up.set(find(t), find(d)); }
    const idx = new Map(); this.nets = []; this.netOf = new Map();
    for (const d of list) { const r = find(d); if (!idx.has(r)) { idx.set(r, this.nets.length); this.nets.push([]); } const k = idx.get(r); this.nets[k].push(d); this.netOf.set(d.state.eid, k); }
    this.sig = list.map(d => d.state.eid + (d.state.w.length ? JSON.stringify(d.state.w) : '')).join(';') + ';';
  },
  /** devices fed by d's outputs (cables whose input really is d's) */
  children(d) { const out = []; for (const [o, eid] of d.state.w) { const t = this.byEid.get(eid), par = this.parent.get(eid); if (t && par && par.d === d) out.push({ o, t }); } return out; },
  feeder(d) { return this.parent.get(d.state && d.state.eid) || null; },
  downstream(d) { const seen = new Set(), st = [d]; while (st.length) { const q = st.pop(); if (seen.has(q)) continue; seen.add(q); for (const c of this.children(q)) st.push(c.t); } return seen; },
  freeOut(d) { const S = POWER[d.type]; if (!S) return -1; const used = new Set(d.state.w.map(w => w[0])); for (let o = 0; o < S.outs; o++) if (!used.has(o)) return o; return -1; },
  // ---------------------------------------------------------------- simulation (host, once a second)
  step(dt) {
    this.graph();
    const list = this.list; if (!list.length) return;
    for (const d of list) { d._p = { in: 0, out: 0, pw: 0, flow: 0 }; if (POWER[d.type].kind === 'sensor') this.sense(d, POWER[d.type]); }
    this.memo = new Map(); this.seen = new Set();
    for (const d of list) { const S = POWER[d.type]; if (SOURCE[S.kind]) this.give(d, this.produce(d, S, dt), dt); }
    for (const d of list) if (POWER[d.type].kind === 'battery' && !this.seen.has(d)) this.give(d, 0, dt); // nothing feeding it: it runs on its charge
    for (const d of list) if (!this.seen.has(d)) this.give(d, 0, dt);
    for (const d of list) this.finish(d, POWER[d.type], dt);
  },
  /** what a source can make right now */
  produce(d, S, dt) {
    const st = d.state;
    if (S.kind === 'gen') {
      if (!st.on) { st.run = 0; st.av = 0; return 0; }
      if ((st.fa || 0) <= 0) { if (d.inv && d.inv.take(S.fuel, 1) > 0) st.fa = S.burn; else { st.run = 0; st.av = 0; st.fa = 0; return 0; } }
      const load = Math.min(S.max, this.demOut(d)); // idling burns a quarter as fast
      st.fa = Math.max(0, r1(st.fa - dt * (0.25 + 0.75 * load / S.max)));
      st.run = 1; st.av = S.max; return S.max;
    }
    if (S.kind === 'solar') {
      const k = Build.isInside(d.x, d.z, d.y) ? 0 : sunK() * (1 - 0.65 * clamp(G.weather || 0, 0, 1));
      st.av = Math.round(S.max * k); return st.av;
    }
    if (S.kind === 'wind') {
      if (Build.isInside(d.x, d.z, d.y)) { st.av = 0; return 0; }
      const ph = (d.x * 0.37 + d.z * 0.71) % 6.28, t = G.t || 0;
      const gust = clamp(0.55 + 0.25 * Math.sin(t * 0.05 + ph) + 0.15 * Math.sin(t * 0.31 + ph * 2.1) + (G.weather || 0) * 0.35, 0.15, 1.1);
      const high = clamp(0.25 + (d.y || 0) / 40, 0.25, 1); // the higher it stands the stronger the wind
      st.av = Math.round(Math.min(S.max, S.max * high * gust)); return st.av;
    }
    return 0;
  },
  timerOn(d) { return d.state.mode === 'day' ? !isNight() : isNight(); },
  /** watts everything from this device's input down wants */
  dem(d) {
    const st = d.state, m = this.memo, k = st.eid;
    if (m.has(k)) return m.get(k); m.set(k, 0); // a loop counts for nothing
    const S = POWER[d.type]; let v;
    switch (S.kind) {
      case 'gen': case 'solar': case 'wind': v = 0; break;
      case 'battery': v = Math.min(S.rate, this.demOut(d)) + ((st.ch || 0) < S.cap - 0.05 ? S.rate : 0); break;
      case 'switch': v = S.use + (st.on ? this.demOut(d) : 0); break;
      case 'timer': v = S.use + (this.timerOn(d) ? this.demOut(d) : 0); break;
      case 'sensor': v = S.use + (st.act ? this.demOut(d) : 0); break;
      case 'split': v = this.demOut(d); break;
      case 'furnace': v = st.on ? S.use : 0; break;
      default: v = S.use + this.demOut(d);
    }
    m.set(k, v); return v;
  },
  demOut(d) { let v = 0; for (const c of this.children(d)) v += this.dem(c.t); return v; },
  /** P watts arrive at d's input: it takes what it needs and hands the rest down its cables.
   *  Returns the watts really used here and after it (a device that can't get its full watts uses none). */
  give(d, P, dt) {
    if (this.seen.has(d)) return 0; this.seen.add(d);
    const S = POWER[d.type], st = d.state, q = d._p || (d._p = {}); q.in = P; let left = P, self = 0, inW = 0, outW = 0;
    if (SOURCE[S.kind]) q.pw = P > 0 ? 1 : 0;
    else if (S.kind === 'battery') { // pass through what the far side needs, store the rest, make up a shortfall from the charge
      const down = Math.min(S.rate, this.demOut(d)), pass = Math.min(P, down); let ch = st.ch || 0;
      inW = Math.max(0, Math.min(P - pass, S.rate, (S.cap - ch) * 60 / dt)); ch += inW * dt / 60;
      outW = Math.max(0, Math.min(down - pass, S.rate - pass, ch * 60 / dt));
      st.ch = Math.max(0, Math.min(S.cap, ch)); left = pass + outW; q.pw = left > 0 || inW > 0 ? 1 : 0;
    } else if (S.kind === 'split') q.pw = P > 0 ? 1 : 0;
    else if (S.kind === 'furnace' && !st.on) { q.pw = 0; left = 0; }
    else {
      const pass = S.kind === 'switch' ? !!st.on : S.kind === 'timer' ? this.timerOn(d) : S.kind === 'sensor' ? !!st.act : true;
      if (P > 0 && left >= S.use - 1e-6) { left -= S.use; self = S.use; q.pw = 1; } else { q.pw = 0; left = 0; }
      if (!pass) left = 0;
    }
    let out = 0;
    for (const c of this.children(d)) { const g = Math.min(left, this.dem(c.t)); const u = this.give(c.t, g, dt); left -= u; out += u; }
    if (S.kind === 'battery') { // only what was really drawn comes out of the charge
      const fromCharge = Math.max(0, Math.min(outW, out - Math.min(P, out)));
      st.ch = Math.max(0, st.ch - fromCharge * dt / 60); q.flow = inW - fromCharge;
      q.out = out; return Math.min(P, out) + inW;
    }
    q.out = out;
    return self + out;
  },
  /** write the results into the saved / synced state and run what powered devices do */
  finish(d, S, dt) {
    const st = d.state, q = d._p || {}; const pw = q.pw ? 1 : 0;
    st.pw = pw; st.pin = Math.round(q.in || 0); st.pout = Math.round(q.out || 0);
    if (S.kind === 'battery') { st.ch = r1(st.ch || 0); st.flow = Math.round(q.flow || 0); }
    if (S.kind === 'light') st.lit = pw;
    if (S.kind === 'furnace') st.lit = pw && this.smelt(d, S, dt) ? 1 : 0;
    if (S.kind === 'turret') d.pwTurret = pw ? boosted(DEPLOY[d.type].turret) : null;
    if (S.kind === 'door') this.doorCtl(d, S, pw);
  },
  /** the motion sensor: someone within range (anyone, or only strangers) */
  sense(d, S) {
    const st = d.state, R2 = S.range * S.range; let hit = false;
    for (const a of G.actors) {
      if (a.dead || a.removed || (a.x - d.x) ** 2 + (a.z - d.z) ** 2 > R2 || Math.abs((a.y ?? 0) - (d.y ?? 0)) > 4) continue;
      const friend = a === G.player || a.remote !== undefined || a.team === 'player';
      if (st.who === 'others' && friend) continue;
      hit = true; break;
    }
    if (hit) d._seenT = G.t;
    st.act = d._seenT !== undefined && G.t - d._seenT < S.hold ? 1 : 0;
  },
  /** electric furnace: 5 smelts a second; returns true while it has something to smelt */
  smelt(d, S, dt) {
    if (!d.inv) return false;
    const has = () => Object.keys(SMELT).some(k => d.inv.count(k) > 0 && d.inv.room(SMELT[k]) > 0);
    if (!has()) { d._prog = 0; return false; }
    d._prog = (d._prog || 0) + S.rate * dt;
    while (d._prog >= 1) { d._prog -= 1; let any = false; for (const k in SMELT) if (d.inv.count(k) > 0 && d.inv.room(SMELT[k]) > 0) { d.inv.take(k, 1); d.inv.add(SMELT[k], 1); any = true; } if (!any) { d._prog = 0; break; } }
    return true;
  },
  /** door controller: power opens the nearest of your doors and holds it open; losing power shuts it */
  doorCtl(d, S, pw) {
    let best = null, bd = S.reach * S.reach;
    for (const dr of G.doors) { if (dr.dead || dr.owner !== 'player') continue; const k = (dr.x - d.x) ** 2 + (dr.z - d.z) ** 2; if (k < bd && Math.abs((dr.y ?? 0) - (d.y ?? 0)) < 2) { bd = k; best = dr; } }
    const st = d.state, was = !!st.act; st.door = best ? 1 : 0; st.act = pw && best ? 1 : 0;
    if (!best) return;
    if (pw) { if (!best.open) openDoor(best, d.x, d.z); best.closeT = 0; }
    else if (was && best.open) closeDoor(best);
  },
  // ---------------------------------------------------------------- cables (player actions; host and guests alike)
  connect(src, o, dst) {
    this.graph();
    const S = POWER[dst.type]; if (!S || !S.ins) return nameOf(dst) + ' has no input';
    if (src === dst) return 'Pick another item';
    if (this.feeder(dst)) return IN_USE;
    if (src.state.w.some(w => w[0] === o)) return 'That output already has a cable';
    if (portPos(src, 'out', o, _a).distanceTo(portPos(dst, 'in', 0, _b)) > WIRE_RANGE) return 'Too far: cables reach ' + WIRE_RANGE + ' m';
    if (this.downstream(dst).has(src)) return 'That would make a loop';
    src.state.w = [...src.state.w, [o, dst.state.eid]];
    this.graph(true); return true;
  },
  unplugOut(d, o) { d.state.w = d.state.w.filter(w => w[0] !== o); this.graph(true); },
  unplugIn(d) { const f = this.feeder(d); if (f) { f.d.state.w = f.d.state.w.filter(w => w[1] !== d.state.eid); this.graph(true); } },
  /** what the wire tool would do with d (interact label) */
  wireLabel(d) {
    this.graph(false, true); const S = POWER[d.type], nm = nameOf(d), P = this.pending;
    if (P) {
      if (P.eid === d.state.eid) return ['Cancel the cable', 'close'];
      if (!S.ins) return [nm + ' has no input', 'info'];
      if (this.feeder(d)) return [nm + ': input in use (unplug)', 'info'];
      return ['Plug the cable into ' + nm, 'check'];
    }
    const o = this.freeOut(d);
    if (o >= 0) return ['Run a cable from ' + nm + (S.outs > 1 ? ' (out ' + (o + 1) + ')' : ''), 'hand'];
    return ['Cables: ' + nm, 'info'];
  },
  /** tap with the wire tool: start a cable from a free output, or plug the one you carry into this input */
  wireTap(d) {
    this.graph(); const nm = nameOf(d), P = this.pending;
    if (P) {
      const src = this.byEid.get(P.eid);
      if (!src || src.dead) { this.cancelWire(); return { msg: 'The cable came loose' }; }
      if (src === d) { this.cancelWire(); return { msg: 'Cable cancelled' }; }
      const r = this.connect(src, P.o, d);
      if (r === true) { this.cancelWire(); return { msg: 'Connected ' + nameOf(src) + ' → ' + nm, good: true }; }
      return { msg: r, bad: true, open: r === IN_USE };
    }
    const o = this.freeOut(d);
    if (o >= 0) { this.pending = { eid: d.state.eid, o }; return { msg: 'Cable from ' + nm + ' — now tap the item to power (up to ' + WIRE_RANGE + ' m)' }; }
    return { open: true };
  },
  cancelWire() { this.pending = null; this.dropPreview(); },
  pendingInfo() {
    const P = this.pending; if (!P) return null; const src = this.byEid.get(P.eid); if (!src) return null;
    const p = G.player; const a = portPos(src, 'out', P.o, _a);
    return { src, name: nameOf(src), o: P.o, len: p ? Math.hypot(a.x - p.x, a.z - p.z, a.y - (p.y + 1.2)) : 0 };
  },
  /** network totals for the panel */
  netStats(d) {
    this.graph(false, true); const k = this.netOf.get(d.state.eid); const list = k !== undefined ? this.nets[k] : [d];
    const o = { n: list.length, make: 0, can: 0, use: 0, ch: 0, cap: 0, flow: 0 };
    for (const m of list) {
      const S = POWER[m.type], st = m.state;
      if (SOURCE[S.kind]) { o.make += st.pout || 0; o.can += st.av || 0; }
      else if (S.kind === 'battery') { o.ch += st.ch || 0; o.cap += S.cap; o.flow += st.flow || 0; }
      else if (st.pw) o.use += S.use || 0;
    }
    return o;
  },
  // ---------------------------------------------------------------- drawing (every peer)
  frame(dt) {
    const p = G.player; if (!p) return;
    const nk = clamp(((G.night || 0) - 0.05) / 0.5, 0, 1); // the pools fade in at dusk
    if (PMAT) { PMAT.warm.opacity = 0.75 * nk; PMAT.white.opacity = 0.42 * nk; PMAT.beam.opacity = 0.16 * nk; PMAT.warm.visible = PMAT.white.visible = PMAT.beam.visible = nk > 0.01; }
    if ((this.cabT -= dt) <= 0) { this.cabT = 0.4; this.graph(); this.syncCables(); }
    // the cable you are carrying
    if (this.pending) {
      const src = this.byEid.get(this.pending.eid);
      const a = src ? portPos(src, 'out', this.pending.o, _a) : null;
      const far = a ? Math.hypot(a.x - p.x, a.z - p.z) : 0;
      if (!src || src.dead || p.dead || !holdingWire(p) || far > WIRE_RANGE + 2) {
        if (far > WIRE_RANGE + 2 && G.ui) G.ui.toast('The cable won\'t reach any further', 'bad');
        this.cancelWire();
      } else if ((this.prevT = (this.prevT || 0) - dt) <= 0) {
        this.prevT = 0.05;
        const yaw = p.yaw ?? p.ang; _b.set(p.x + Math.cos(yaw) * 0.55 - Math.sin(yaw) * 0.22, p.y + (p.eye || 1.6) - 0.42, p.z + Math.sin(yaw) * 0.55 + Math.cos(yaw) * 0.22);
        this.dropPreview(); this.preview = new THREE.Mesh(cableGeo(a, _b), mats().cable); this.preview.castShadow = false; G.scene.add(this.preview);
      }
    }
    // indicator lamps, levers, gauges, rotors
    this.visT -= dt; const slow = this.visT <= 0; if (slow) this.visT = 0.25;
    const t = G.t || 0;
    for (const d of this.list) {
      if (!d.mesh || d.dead) continue;
      const near = (d.x - p.x) ** 2 + (d.z - p.z) ** 2 < 90 * 90; if (!near) continue;
      const S = POWER[d.type], st = d.state, U = d.mesh.userData;
      if (U.rotor) U.rotor.rotation.x += dt * (0.4 + 7 * clamp((st.av || 0) / S.max, 0, 1));
      if (d.type === 'generator' && st.run) { // it shakes and puffs exhaust from the muffler
        d.mesh.position.y = (d.y || 0) + Math.sin(t * 55) * 0.004;
        if (G.fx && G.fx.emit && Math.random() < dt * 3) { const c = Math.cos(d.ry || 0), s = Math.sin(d.ry || 0); G.fx.emit({ x: d.x - 0.66 * c + 0.15 * s, y: (d.y || 0) + 0.5, z: d.z - 0.66 * s - 0.15 * c, vx: -c * 0.5, vy: 0.7, vz: -s * 0.5, life: 1.3, size: 0.1, size1: 0.55, r: 0.42, g: 0.42, b: 0.44, a: 0.5, a1: 0, drag: 0.4 }); }
      } else if (d.type === 'generator' && d._wasRun !== false) d.mesh.position.y = d.y || 0;
      if (d.type === 'generator') d._wasRun = !!st.run;
      if (!slow) continue;
      if (!d._pwDeco) this.decorate(d);
      const look = this.look(d, S);
      if (d._pwDeco && d._pwDeco.look !== look) { d._pwDeco.look = look; if (d._pwDeco.ind) d._pwDeco.ind.material = mats()[look]; }
      if (U.setOn && d._onShown !== !!st.on) { U.setOn(!!st.on); d._onShown = !!st.on; }
      if (U.setCharge) { const k = Math.round((st.ch || 0) / S.cap * 20); if (d._chShown !== k) { U.setCharge(k / 20); d._chShown = k; } }
      if (U.setDial) { const n = st.mode !== 'day'; if (d._dialShown !== n) { U.setDial(n); d._dialShown = n; } }
      if (U.setLit && DEPLOY[d.type].litState) { const lit = isLit(d); if (d._litShown !== lit) { U.setLit(lit); d._litShown = lit; } }
      if (S.kind === 'light') lightPool(d, isLit(d) && nk > 0.01);
      if (U.setMount && (d._mountT = (d._mountT || 0) - 0.25) <= 0) { d._mountT = 2; const h = Build.isInside(d.x, d.z, d.y); if (d._mountShown !== h) { U.setMount(h); d._mountShown = h; } }
    }
  },
  /** indicator colour: green working, red needs power, amber waiting (no fuel, sensor idle), grey off */
  look(d, S) {
    const st = d.state;
    if (this.pending && this.pending.eid === st.eid) return Math.floor((G.t || 0) * 4) % 2 ? 'pend' : 'idle';
    switch (S.kind) {
      case 'gen': return !st.on ? 'idle' : st.run ? 'on' : 'warn';
      case 'solar': case 'wind': return (st.av || 0) > 0 ? 'on' : 'idle';
      case 'battery': return (st.pout || 0) > 0 || (st.flow || 0) > 0 ? 'on' : (st.ch || 0) > 0.5 ? 'idle' : 'off';
      case 'switch': return !st.pw ? 'off' : st.on ? 'on' : 'idle';
      case 'timer': return !st.pw ? 'off' : this.timerOn(d) ? 'on' : 'warn';
      case 'sensor': return !st.pw ? 'off' : st.act ? 'on' : 'warn';
      case 'split': return (st.pin || 0) > 0 ? 'on' : 'off';
      case 'turret': return st.pw ? 'on' : 'idle';
      case 'furnace': return !st.on ? 'idle' : st.pw ? 'on' : 'off';
      case 'light': return st.legacy ? 'on' : st.pw ? 'on' : 'off';
      default: return st.pw ? 'on' : 'off';
    }
  },
  syncCables() {
    const want = new Map();
    for (const d of this.list) {
      if (d.dead) continue;
      for (const c of this.children(d)) {
        if (c.t.dead) continue;
        const a = portPos(d, 'out', c.o, new THREE.Vector3()), b = portPos(c.t, 'in', 0, new THREE.Vector3());
        want.set(d.state.eid + ':' + c.o + '>' + c.t.state.eid + '@' + [a.x, a.y, a.z, b.x, b.y, b.z].map(v => Math.round(v * 20)).join(','), [a, b]);
      }
    }
    for (const [k, m] of this.cables) if (!want.has(k)) { m.removeFromParent(); m.geometry.dispose(); this.cables.delete(k); }
    for (const [k, [a, b]] of want) if (!this.cables.has(k)) { const m = new THREE.Mesh(cableGeo(a, b), mats().cable); m.castShadow = false; m.receiveShadow = false; G.scene.add(m); this.cables.set(k, m); }
  },
  dropPreview() { if (this.preview) { this.preview.removeFromParent(); this.preview.geometry.dispose(); this.preview = null; } },
};
// a powered turret's stats (cached per base turret def)
const _boost = new WeakMap();
function boosted(T) { if (!T) return null; let b = _boost.get(T); if (!b) { b = Object.assign({}, T, { range: T.range * TURRET_BOOST.range, spread: T.spread * TURRET_BOOST.spread, rof: T.rof * TURRET_BOOST.rof }); _boost.set(T, b); } return b; }

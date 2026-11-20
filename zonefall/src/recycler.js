// ============================================================================
// ZONEFALL — recyclers that work like Rust's. A recycler is a machine with 6
// input slots, 6 output slots and an on/off switch. While it is on it takes one
// item every 5 s (a stack one item at a time, first slot first) and puts what
// that item breaks down into in the output (RECYCLE, plus RECYCLE_P chances).
// It stops by itself when the input runs out or the output is full, keeps
// running while nobody is near, and anyone can take things out.
//
// The machines are the monument useables (G.uses, type 'recycler') and placed
// 'recycler' deployables. Both keep { state: { on, pg }, inv: Inv(12) } on the
// object (slots 0-5 input, 6-11 output; pg = whole seconds into the current
// item, for the progress bar). A placed one is saved and synced like a box
// (build.js, networld.js); a monument one is saved in G.run.rcy and synced as
// a 'u' record. In co-op the host runs every recycler: a guest's changes go to
// the host as item deltas ('rcop') and the host answers with the machine's
// state ('rcst'), so two people taking the same thing can't duplicate it.
//
//   Recycler.of(o) / view(o, 'in' | 'out') / canRecycle(id) / yieldOf(id)
//   Recycler.toggle(o) / tick(dt) (host + solo) / frame(dt) (everyone: lamp, gears, hum, puffs)
//   Recycler.uiSync(o) (guest: send what the window changed) / keyOf(o) / byKey(k)
//   Recycler.record(o) / applyRecord(o, r) / hostOp(m, guestId) / serialize() / restore(data)
// ============================================================================
import { THREE, M } from './gfx/materials.js';
import { G } from './state.js';
import { ITEMS, RECYCLE, RECYCLE_P } from './data.js';
import { Inv, cloneStack, stackExtra } from './inventory.js';
import { Build } from './build.js';
import { Live } from './world/live.js';
import { Sfx } from './audio.js';

export const RC = { IN: 6, OUT: 6, TIME: 5 };
const N = RC.IN + RC.OUT;
export const canRecycle = id => !!(id && ITEMS[id] && (RECYCLE[id] || RECYCLE_P[id]));

/** a slice of the machine's inventory that behaves like an Inv (the UI's grids, drag and drop, take all...) */
function slice(o, off, n) {
  const idx = k => (typeof k === 'string' && k.length < 4 && /^\d+$/.test(k)) ? +k : -1;
  const slots = new Proxy([], {
    get(t, k, r) { if (k === 'length') return n; const i = idx(k); if (i >= 0) return i < n ? (o.inv.slots[off + i] ?? null) : undefined; return Reflect.get(t, k, r); },
    set(t, k, v) { const i = idx(k); if (i >= 0 && i < n) o.inv.slots[off + i] = v; return true; },
    has(t, k) { const i = idx(k); return i >= 0 ? i < n : Reflect.has(t, k); },
  });
  const v = Object.create(Inv.prototype); v.slots = slots; v.rc = o;
  return v;
}

export const Recycler = {
  RC, canRecycle,
  /** make sure an object has its recycler state and 12 slots */
  of(o) {
    if (!o.inv) o.inv = new Inv(N); else if (o.inv.slots.length < N) o.inv.resize(N);
    if (!o.state) o.state = {};
    if (o.state.on === undefined) o.state.on = 0;
    if (o.state.pg === undefined) o.state.pg = 0;
    return o;
  },
  /** the input or output section as an Inv-like view (input only takes recyclables, output only gives) */
  view(o, which) {
    this.of(o);
    const v = which === 'out' ? slice(o, RC.IN, RC.OUT) : slice(o, 0, RC.IN);
    if (which === 'out') v.takeOnly = true; else v.accept = s => !!s && canRecycle(s.id);
    v.which = which; return v;
  },
  /** what one item gives: [[id, n, chance]] (chance < 1: maybe one more) */
  yieldOf(id) {
    const out = []; const R = RECYCLE[id] || {}, P = RECYCLE_P[id] || {};
    for (const k in R) out.push([k, R[k], 1]);
    for (const k in P) out.push([k, 1, P[k]]);
    return out;
  },
  yieldText(id) { return this.yieldOf(id).map(([k, n, c]) => (c < 1 ? Math.round(c * 100) + '% ' : n + ' ') + (ITEMS[k] ? ITEMS[k].name : k)).join(' · '); },
  /** every recycler in the world: the monument ones, then placed ones */
  all() {
    const out = []; for (const u of G.uses || []) if (u.type === 'recycler') out.push(u);
    for (const d of Build.deploys) if (d.type === 'recycler' && !d.dead) out.push(d);
    return out;
  },
  // ---------------------------------------------------------------- the machine (host and solo)
  firstJob(o) { for (let i = 0; i < RC.IN; i++) { const s = o.inv.slots[i]; if (s && canRecycle(s.id)) return i; } return -1; },
  /** switch on / off; returns the new state or null (nothing to recycle) */
  toggle(o, want, quiet) {
    this.of(o); const on = want === undefined ? !o.state.on : !!want;
    if (on && this.firstJob(o) < 0) { if (G.ui && !quiet) G.ui.toast('Put something to recycle in the input first'); return null; }
    if (!!o.state.on === on) return on;
    o.state.on = on ? 1 : 0; o.state.pg = 0; o.rcT = 0;
    if (on) Sfx.rcStart && Sfx.rcStart(o.x, o.z); else Sfx.rcStop && Sfx.rcStop(o.x, o.z);
    return on;
  },
  stop(o) { o.state.on = 0; o.state.pg = 0; o.rcT = 0; Sfx.rcStop && Sfx.rcStop(o.x, o.z); },
  /** break one item down; false when it can't (input empty / output full: it switches off) */
  processOne(o) {
    const i = this.firstJob(o); if (i < 0) { this.stop(o); return false; }
    const s = o.inv.slots[i];
    const got = []; for (const [k, n, c] of this.yieldOf(s.id)) { const m = c >= 1 ? n : Math.random() < c ? n : 0; if (m > 0 && ITEMS[k]) got.push([k, m]); }
    // does it all fit in the output? (try on a copy first)
    const out = this.view(o, 'out'), test = Inv.from(out.slots.map(q => q && cloneStack(q)), RC.OUT);
    for (const [k, m] of got) if (test.add(k, m) > 0) { this.stop(o); o.full = G.t; return false; }
    for (const [k, m] of got) out.add(k, m);
    s.n -= 1; if (s.n <= 0) o.inv.slots[i] = null;
    o.lastItem = s.id; o.doneT = G.t; o.doneN = (o.doneN || 0) + 1; o.full = 0;
    if (this.firstJob(o) < 0) this.stop(o);
    return true;
  },
  /** host + solo: run every switched-on recycler (all of them, near or far) */
  tick(dt) {
    for (const o of this.all()) {
      if (!o.state || !o.state.on || !o.inv) continue;
      o.rcT = (o.rcT || 0) + dt;
      if (o.rcT >= RC.TIME) { o.rcT -= RC.TIME; if (!this.processOne(o)) continue; this.fxDone(o); }
      const pg = Math.min(RC.TIME - 1, Math.floor(o.rcT)); if (o.state.on && o.state.pg !== pg) o.state.pg = pg;
    }
  },
  /** 0..1 through the current item (a guest guesses between the host's whole seconds) */
  progress(o) { if (!o.state || !o.state.on) return 0; return Math.min(1, (o.rcT || 0) / RC.TIME); },
  // ---------------------------------------------------------------- looks and sound (everyone)
  yOf(o) { return o.y ?? (G.W ? G.W.height(o.x, o.z) : 0); },
  /** the indicator lamp, two spinning flywheels and a night glow, on the machine's model */
  hint(o) {
    if (o.rcFx !== undefined) return o.rcFx;
    const host = o.mesh || o.obj; o.rcFx = null; if (!host) return null;
    const g = new THREE.Group(); g.name = 'rc-hint';
    const lamp = M.add(g, M.sphere(0.075, 8, 6), MAT().off, 0.55, 1.31, 0.55, { cast: false });
    const wheels = [];
    for (const s of [-1, 1]) {
      const w = new THREE.Group(); w.position.set(0.05, 0.62, s * 0.755); g.add(w);
      for (const a of [0, Math.PI / 3, Math.PI * 2 / 3]) { const m = M.add(w, M.box(0.62, 0.07, 0.03), MAT().wheel, 0, 0, 0, { cast: false }); m.rotation.z = a; }
      M.add(w, M.cyl(0.09, 0.09, 0.05, 8).clone().rotateX(Math.PI / 2), MAT().hub, 0, 0, 0, { cast: false });
      wheels.push(w);
    }
    host.add(g);
    const light = { x: o.x, y: this.yOf(o) + 1.5, z: o.z, color: '#5dff6a', intensity: 0, range: 5, rc: o };
    (G.lights || (G.lights = [])).push(light);
    return (o.rcFx = { g, lamp, wheels, light, on: null, spin: 0 });
  },
  /** per frame, on every client: lamp, wheels, hum, puffs; a guest also moves its progress bar along */
  frame(dt) {
    const P = G.player; if (!P) return;
    let hum = 0, hx = 0, hz = 0;
    for (const o of this.all()) {
      const d2 = (o.x - P.x) ** 2 + (o.z - P.z) ** 2;
      const on = !!(o.state && o.state.on);
      if (G.netGuest && on) { const cap = Math.min(RC.TIME - 0.02, (o.state.pg || 0) + 1); o.rcT = Math.min(cap, Math.max(o.state.pg || 0, (o.rcT || 0) + dt)); }
      if (d2 > 70 * 70) continue;
      const F = this.hint(o); if (!F) continue;
      if (F.on !== on) { F.on = on; F.lamp.material = on ? MAT().on : MAT().off; F.light.intensity = on ? 1.1 : 0; }
      F.spin = Math.max(0, Math.min(1, F.spin + (on ? dt * 1.2 : -dt * 0.8)));
      if (F.spin > 0) for (const w of F.wheels) w.rotation.z -= dt * 7 * F.spin;
      if (on) {
        F.lamp.scale.setScalar(1 + Math.sin(G.t * 9) * 0.12);
        const y = this.yOf(o);
        if (G.fx && d2 < 40 * 40 && Math.random() < dt * 2.2) G.fx.emit({ x: o.x + (Math.random() - 0.5) * 0.3, y: y + 1.75, z: o.z + (Math.random() - 0.5) * 0.3, vx: (Math.random() - 0.5) * 0.3, vy: 0.7, vz: (Math.random() - 0.5) * 0.3, life: 1.4, size: 0.18, size1: 0.6, r: 0.55, g: 0.53, b: 0.5, a: 0.4, a1: 0, drag: 0.4 });
        const k = Math.max(0, 1 - Math.sqrt(d2) / 24); if (k > hum) { hum = k; hx = o.x; hz = o.z; }
      }
      // a guest hears and sees each finished item too (the host's output changed)
      if (G.netGuest && o.doneN !== o.fxN) { if (o.fxN !== undefined && on) this.fxDone(o); o.fxN = o.doneN; }
    }
    if (Sfx.rcHum) Sfx.rcHum(hum, hx, hz);
    // a placed recycler that was destroyed takes its glow with it
    if ((this.gcT = (this.gcT || 0) - dt) <= 0) { this.gcT = 2; if (G.lights && G.lights.some(l => l.rc && l.rc.dead)) G.lights = G.lights.filter(l => !(l.rc && l.rc.dead)); }
  },
  fxDone(o) {
    const P = G.player; if (!P || (o.x - P.x) ** 2 + (o.z - P.z) ** 2 > 45 * 45) return;
    const y = this.yOf(o); if (Sfx.rcGrind) Sfx.rcGrind(o.x, o.z);
    if (G.fx) { for (let i = 0; i < 6; i++) G.fx.emit({ x: o.x + 0.75, y: y + 0.5, z: o.z + (Math.random() - 0.5) * 0.4, vx: 0.8 + Math.random(), vy: 1 + Math.random() * 1.5, vz: (Math.random() - 0.5), life: 0.5, size: 0.08, r: 1, g: 0.8, b: 0.4, add: true, grav: 9 }); G.fx.emit({ x: o.x, y: y + 1.8, z: o.z, vy: 1.1, life: 1.6, size: 0.35, size1: 1.1, r: 0.5, g: 0.48, b: 0.45, a: 0.5, a1: 0, drag: 0.5 }); }
  },
  // ---------------------------------------------------------------- co-op
  /** a key both host and guests agree on: monument ones by position, placed ones like any deployable */
  keyOf(o) { if (o.sk === 'deploy') return G.netWorld && G.netWorld.deployKey ? G.netWorld.deployKey(o) : null; return 'u' + Math.round(o.x * 10) + '|' + Math.round(o.z * 10) + '|' + Math.round((o.y || 0) * 2); },
  byKey(k) { if (typeof k !== 'string') return null; if (k[0] === 'u') return (G.uses || []).find(u => u.type === 'recycler' && this.keyOf(u) === k) || null; return Build.deploys.find(d => d.type === 'recycler' && !d.dead && this.keyOf(d) === k) || null; },
  record(o) { this.of(o); return [o.state.on ? 1 : 0, o.state.pg | 0, o.inv.toJSON(), o.doneN | 0]; },
  /** a guest: the host's state of a machine (skipped for a moment after our own change, until the host answers) */
  applyRecord(o, r, force) {
    if (!Array.isArray(r)) return; this.of(o);
    if (!force && o.rcLock && performance.now() < o.rcLock) return;
    o.rcLock = 0;
    const was = !!o.state.on; o.state.on = r[0] ? 1 : 0; const pg = +r[1] || 0;
    if (pg !== o.state.pg || !was) o.rcT = pg; o.state.pg = pg;
    if (Array.isArray(r[2])) { const n = Inv.from(r[2], N); o.inv.slots.length = 0; for (const s of n.slots) o.inv.slots.push(s); }
    if (r[3] !== undefined) o.doneN = r[3] | 0;
    o.rcLast = this.snap(o);
  },
  snap(o) { return o.inv.slots.slice(0, N).map(s => s ? cloneStack(s) : null); },
  /** guest: compare the machine with what the host last said and send the difference (called on every UI change) */
  uiSync(o) {
    if (!G.netGuest || !G.net) { o.rcLast = null; return; }
    this.of(o); const before = o.rcLast || this.snap(o), now = this.snap(o);
    const key = s => s ? s.id + '|' + JSON.stringify(stackExtra(s) || {}) : null;
    const tally = (arr, a, b) => { const m = new Map(); for (let i = a; i < b; i++) { const s = arr[i]; if (!s) continue; const k = key(s); const e = m.get(k) || { s, n: 0 }; e.n += s.n; m.set(k, e); } return m; };
    const add = [], take = [];
    for (const [sec, a, b] of [[0, 0, RC.IN], [1, RC.IN, N]]) {
      const A = tally(before, a, b), B = tally(now, a, b);
      for (const [k, e] of B) { const d = e.n - (A.get(k) ? A.get(k).n : 0); if (d > 0) add.push([sec, Object.assign(cloneStack(e.s), { n: d })]); }
      for (const [k, e] of A) { const d = e.n - (B.get(k) ? B.get(k).n : 0); if (d > 0) take.push([sec, e.s.id, d, stackExtra(e.s) || 0]); }
    }
    const on = o.rcWantOn; o.rcWantOn = undefined;
    o.rcLast = now;
    if (!add.length && !take.length && on === undefined) return;
    const k = this.keyOf(o); if (!k) return;
    o.rcLock = performance.now() + 2500;
    G.net.send({ t: 'rcop', k, add, take, on });
  },
  /** host: a guest changed a machine — take out / put in what they did, then tell them how it stands */
  hostOp(m, gid) {
    const o = this.byKey(m.k); if (!o) return; this.of(o);
    const sec = s => s ? this.view(o, 'out') : this.view(o, 'in');
    for (const t of Array.isArray(m.take) ? m.take.slice(0, 24) : []) {
      const [s, id, n, ex] = t; if (!ITEMS[id]) continue; const v = sec(s); let left = Math.max(0, Math.min(9999, n | 0));
      if (ex && typeof ex === 'object') for (let i = 0; i < v.slots.length && left > 0; i++) { const q = v.slots[i]; if (q && q.id === id && JSON.stringify(stackExtra(q) || {}) === JSON.stringify(ex)) { const k = Math.min(left, q.n); q.n -= k; left -= k; if (q.n <= 0) v.slots[i] = null; } }
      if (left > 0) v.take(id, left);
    }
    for (const a of Array.isArray(m.add) ? m.add.slice(0, 24) : []) {
      const [s, st] = a; if (!st || !ITEMS[st.id] || !(st.n > 0)) continue; const v = sec(s);
      const stack = Inv.from([Object.assign({}, st, { n: Math.min(st.n | 0, ITEMS[st.id].stack || 1) })], 1).slots[0]; if (!stack) continue;
      const left = s === 0 && !canRecycle(stack.id) ? stack : v.addStack(stack);
      if (left) Live.dropItem(o.x + 1, o.z, left.id, left.n, stackExtra(left), this.yOf(o) + 0.5); // no room (the host's machine changed meanwhile): it lands beside it
    }
    if (m.on === 0 || m.on === 1 || m.on === true || m.on === false) this.toggle(o, !!m.on, true);
    if (o.state.on && this.firstJob(o) < 0) this.stop(o);
    if (G.net) G.net.sendTo(gid, { t: 'rcst', k: m.k, r: this.record(o) });
    if (G.netWorld) G.netWorld.diffT = 0; // everyone else hears about it straight away
  },
  /** guest: the host's answer to our change */
  fromHost(m) { const o = this.byKey(m.k); if (o) { this.applyRecord(o, m.r, true); if (G.ui && G.ui.rcOpen === o) G.ui.rebuild(); } },
  // ---------------------------------------------------------------- saving the monument ones (placed ones save with the base)
  serialize() {
    const out = {};
    for (const u of G.uses || []) if (u.type === 'recycler' && u.inv && (!u.inv.empty() || u.state.on)) out[this.keyOf(u)] = [u.state.on ? 1 : 0, u.inv.toJSON()];
    return out;
  },
  restore(data) {
    if (!data || typeof data !== 'object') return;
    for (const k in data) { const u = this.byKey(k); const r = data[k]; if (!u || !Array.isArray(r)) continue; this.of(u); u.inv = Inv.from(r[1], N); u.state.on = r[0] ? 1 : 0; u.rcT = 0; }
  },
};
G.recycler = Recycler; // net.js answers 'rcop' / 'rcst' through this

let MATS = null;
function MAT() {
  if (MATS) return MATS;
  MATS = { on: M.basic('#62ff70'), off: M.basic('#5a2219'), wheel: M.mat('#4d5158'), hub: M.mat('#c9a032') };
  return MATS;
}

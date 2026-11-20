// ============================================================================
// ZONEFALL — the Nuclear Bunker at runtime (its layout: world/monuments_bunker.js).
//
//  * The launch puzzle in launch control: a fuse box (it takes the Launch Circuit
//    Fuse from the red-card armoury), four arming keys A-D on the console and an
//    authorise button. The right key pattern is new each time the bunker resets;
//    four terminals round the bunker each give one key's setting. The right
//    pattern opens the vault (the Nuclear Targeting Controller on its pedestal);
//    a wrong one sounds the alarm, sends in a wave of guards, locks the console
//    for 45 s and says how many keys were right.
//  * The silo: the missile stands in it when it's ready. The controller (one use)
//    opens the map in targeting mode; a launch opens the hatch with klaxons and
//    smoke, the missile climbs out and flies a ballistic arc to the target
//    (20-40 s), then the blast (combat.js explode with NUKE) and a fallout zone
//    that fades over FALLOUT_DAYS. The silo reloads RELOAD_DAYS after a launch,
//    and the puzzle resets RELOAD_DAYS after it was solved (nobody close by).
//  * Days here are game days: absDay() runs on with the clock (a day = DAY_LEN
//    in game.js, nights go twice as fast).
//  * State lives in G.run.bunker (saved with the run). In co-op the host owns it:
//    guests get it as 'znk' lines (networld.js, once a second and on changes) and
//    send what they do as 'bkop' / 'nkreq' requests; the host answers 'bkack'.
// ============================================================================
import { THREE, M } from './gfx/materials.js';
import { G } from './state.js';
import { ITEMS } from './data.js';
import { Sfx } from './audio.js';
import { explode } from './combat.js';
import { spawnActor } from './actors.js';
import { openDoor, closeDoor } from './doors.js';
import { Live } from './world/live.js';
import { WORLD } from './world/gen.js';
import { MAP_GRID } from './gfx/terrain.js';
import { rand, clamp, dist } from './util.js';
import { pull, d0 } from './gfx/fx_nuke.js';

/** the strike: kills inside `core`, falls off to `r`; buildings wrecked inside structR; vehicles inside vehR */
export const NUKE = { r: 115, dmg: 520, core: 45, struct: 9000, structR: 85, vehR: 60, nuke: true, kind: 'nuke' };
export const RELOAD_DAYS = 2.5, FALLOUT_DAYS = 1.25, FALLOUT_R = 95, FALLOUT_P = 9, PRE = 8, MIN_RANGE = 150, LOCK_S = 45, ALARM_S = 32;
const LETTERS = ['A', 'B', 'C', 'D'];
const DAY_REAL = 562; // real seconds a game day takes (DAY_LEN 720, the night 2x faster)

const isGuest = () => !!(G.net && G.net.role === 'guest');
const isHost = () => !!(G.net && G.net.role === 'host');
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
/** game days since the island began, running on smoothly with the clock (a new day starts at dawn, clock 0.25) */
export function absDay() { return (G.day || 1) + (((G.clock || 0) - 0.25 + 1) % 1); }
/** "1 d 4 h" in game time, and roughly how long that is for real */
export function fmtLeft(days) {
  days = Math.max(0, days); const h = Math.ceil(days * 24), d = Math.floor(h / 24), hh = h % 24, real = Math.ceil(days * DAY_REAL / 60);
  return (d ? d + ' d ' : '') + hh + ' h (about ' + real + ' min)';
}
export function gridName(x, z) { const n = MAP_GRID; return 'ABCDEFGHIJKL'[clamp(Math.floor(x / WORLD * n), 0, n - 1)] + (clamp(Math.floor(z / WORLD * n), 0, n - 1) + 1); }
function say(msg, kind) { if (G.ui) G.ui.toast(msg, kind); if (G.net && G.net.note) G.net.note(msg, kind); }
const anchors = () => (isHost() && G.net.anchors) ? G.net.anchors() : (G.player ? [G.player] : []);
const nearest = (x, z) => { let b = 1e9; for (const a of anchors()) if (a && !a.dead) b = Math.min(b, dist(a.x, a.z, x, z)); return b; };
const mmss = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

/** the clue terminals: what each one says (one arming key each; the wording changes with every reset) */
const CLUES = [
  ['GATE 2 SHIFT LOG', ['Relieved 06:00. Perimeter quiet.', 'Duty officer reminder for the drill: ARMING KEY {L} goes {P}.', 'Leave the other keys to launch control.'],
    ['Patrol 3 late again.', 'Note from launch control: key {L} -> {P}. Do NOT write this down. (Too late.)']],
  ['DUTY OFFICER - PERSONAL', ['Forgot the key settings again.', 'Key {L}: {P}. Write it on your hand, Novak.', '- R.'],
    ['Reminder to self:', 'arming key {L} must be {P} before anyone touches the button.', 'Last time the alarm went off for an hour.']],
  ['ARMOURY ISSUE LOG', ['1x launch circuit fuse -> launch control.', 'Checklist step 4: arming key {L} set {P}.', 'Spare fuses in the rack. Sign them out.'],
    ['Fuse rack restocked.', 'Pre-launch check, item 7: key {L} = {P}.', 'Report missing fuses to the quartermaster.']],
  ['SILO 7 MAINTENANCE PANEL', ['PRE-LAUNCH INTERLOCK', 'ARMING KEY {L} ........ {P}', 'HATCH HYDRAULICS ...... OK', 'PROPELLANT ............ NOMINAL'],
    ['INTERLOCK SELF-TEST', 'KEY {L} EXPECTED: {P}', 'GUIDANCE .............. ALIGNED']],
];

export const Bunker = {
  mon: null, B: null, S: null, run: null, obj: null, door: null, pend: new Map(), q: 0, read: new Set(), seenHit: 0, fx: { trail: null, fid: 0 },
  // ---------------------------------------------------------------- set up
  /** a new world was built (game.js setupWorld): find the site and build its moving parts */
  setup() {
    this.reset();
    const m = (G.monuments || []).find(q => q.type === 'bunker' && q.bunker); if (!m) return;
    this.mon = m; this.B = m.bunker;
    this.door = G.doors.find(d => d.puzzle && d.mon === m) || null;
    try { this.obj = this.build(); } catch (e) { console.warn('bunker parts', e); this.obj = null; }
  },
  reset() {
    this.mon = null; this.B = null; this.S = null; this.run = null; this.obj = null; this.door = null; this.pend.clear(); this.read = new Set(); this.seenHit = 0;
    if (this.fx.trail && G.fx) G.fx.nukes.end(this.fx.trail); this.fx = { trail: null, fid: 0 };
    if (G.rads) G.rads = G.rads.filter(r => !r.nuke);
  },
  /** the state: the run's (host / solo) or the host's copy (guests) */
  state() {
    if (!this.mon) return null;
    if (isGuest()) { if (!this.gS) this.gS = this.fresh(); return this.gS; }
    if (this.run !== G.run || !this.S) { // bind to the current run (a new island, a loaded save)
      this.run = G.run; this.gS = null; if (!G.run) return null;
      const s = G.run.bunker && typeof G.run.bunker === 'object' ? G.run.bunker : this.fresh();
      const f = this.fresh(); for (const k in f) if (s[k] === undefined) s[k] = f[k];
      s.hit = null; G.run.bunker = this.S = s; this.syncDoor(true);
    }
    return this.S;
  },
  fresh() {
    const code = [0, 1, 2, 3].map(() => Math.random() < 0.5 ? 1 : 0); let sw;
    do sw = [0, 1, 2, 3].map(() => Math.random() < 0.5 ? 1 : 0); while (sw.every((v, i) => v === code[i]));
    return { code, sw, pw: 0, sv: 0, svAbs: 0, ctl: 1, lock: 0, al: 0, rd: 0, fl: null, fo: [], hit: null, n: Math.floor(Math.random() * 1000), fid: 0 };
  },
  /** world position of a local [x, z, y] spot in the bunker */
  at(p) { const [x, z] = this.B.W(p[0], p[1]); return new THREE.Vector3(x, this.B.baseY + (p[2] || 0), z); },
  /** a world yaw that turns an object's +Z toward the local direction (dx, dz) (mirror-proof) */
  face(lx, lz, dx, dz) { const [ax, az] = this.B.W(lx, lz), [bx, bz] = this.B.W(lx + dx, lz + dz); return Math.atan2(bx - ax, bz - az); },
  silo() { const s = this.B.silo; const [x, z] = this.B.W(s.x, s.z); return { x, z, y: this.B.baseY, top: this.B.baseY + s.top, rin: s.rin }; },
  // ---------------------------------------------------------------- the moving parts
  build() {
    const B = this.B, O = { levers: [], lamps: [], beacons: [], screens: [] }, sc = G.scene;
    const lam = (c, o) => M.mat(c, o), glow = c => new THREE.MeshBasicMaterial({ color: c });
    // the silo hatch: two half-discs hinged at the rim, opening upward
    const S = this.silo(), hatch = new THREE.Group(); hatch.position.set(S.x, S.top + 0.05, S.z); sc.add(hatch);
    O.leaves = [1, -1].map(s => {
      const pivot = new THREE.Group(); pivot.position.set(s * (S.rin + 0.3), 0, 0); hatch.add(pivot);
      const g = new THREE.CylinderGeometry(S.rin + 0.3, S.rin + 0.3, 0.55, 28, 1, false, s > 0 ? 0 : Math.PI, Math.PI);
      const leaf = M.add(pivot, g, lam('#5c636b', { tex: 'metal' }), -s * (S.rin + 0.3), 0.27, 0);
      M.add(leaf, new THREE.CylinderGeometry(S.rin + 0.32, S.rin + 0.32, 0.12, 28, 1, true, s > 0 ? 0 : Math.PI, Math.PI), M.surf('hazard'), 0, 0.22, 0);
      M.add(leaf, M.box(0.5, 0.35, (S.rin + 0.3) * 1.6), lam('#3a3f45', { tex: 'metal' }), s * 0.6, 0.4, 0); // a stiffening beam
      M.add(leaf, M.box(0.25, 0.25, 0.3), M.surf('red_paint'), s * 0.3, 0.55, 0);
      return pivot;
    });
    O.hatch = hatch; O.open = 0;
    // the missile (stands in the silo; the same mesh flies)
    O.missile = this.missileModel(); O.missile.position.set(S.x, S.y + 1.2, S.z); sc.add(O.missile);
    // arming keys, their lamps and letters; the button; the fuse box lamp
    B.levers.forEach((p, i) => {
      const base = new THREE.Group(); base.position.copy(this.at(p)); base.rotation.y = this.face(p[0], p[1], 0, 1); sc.add(base); // +Z = toward the player: handles tilt away (up) or toward you (down)
      M.add(base, M.box(0.36, 0.16, 0.36), lam('#2a2e33', { tex: 'metal' }), 0, 0.08, 0);
      const pv = new THREE.Group(); pv.position.y = 0.16; base.add(pv);
      M.add(pv, M.box(0.08, 0.5, 0.08), lam('#b8bcc2', { tex: 'metal' }), 0, 0.25, 0); M.add(pv, M.box(0.16, 0.14, 0.16), lam('#d03c3c'), 0, 0.52, 0);
      const lamp = M.add(null, M.sphere(0.08, 8, 6), glow('#3a3020'), 0, 0, 0); lamp.position.copy(this.at([p[0], p[1] - 0.37, p[2] + 0.56])); sc.add(lamp);
      O.levers.push(pv); O.lamps.push(lamp);
      const tag = this.textPlane(LETTERS[i], 0.32, 0.16, '#1a1d22', '#ffe08a', 34); tag.position.copy(this.at([p[0], p[1] - 0.255, p[2] + 0.22])); tag.rotation.y = this.face(p[0], p[1], 0, 1); sc.add(tag);
    });
    { const p = B.button, g = new THREE.Group(); g.position.copy(this.at(p)); sc.add(g);
      M.add(g, M.cyl(0.2, 0.22, 0.12, 14), lam('#d8b030'), 0, 0.06, 0); O.button = M.add(g, M.cyl(0.13, 0.15, 0.12, 14), new THREE.MeshLambertMaterial({ color: '#d02a20' }), 0, 0.17, 0);
      O.btnGlow = M.add(g, M.sphere(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff3a2a', transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0.26, 0); }
    O.fuseLamp = M.add(null, M.sphere(0.07, 8, 6), glow('#401010'), 0, 0, 0); O.fuseLamp.position.copy(this.at(B.fuse)); sc.add(O.fuseLamp);
    // the screens (status text drawn into one canvas)
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 160; O.cv = cv; O.tex = new THREE.CanvasTexture(cv); O.tex.colorSpace = THREE.SRGBColorSpace;
    for (const s of B.screens) { const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), new THREE.MeshBasicMaterial({ map: O.tex })); m.position.copy(this.at([s.x, s.z, s.y])); m.rotation.y = this.face(s.x, s.z, 0, s.ry ? -1 : 1); sc.add(m); O.screens.push(m); }
    // the controller on its pedestal, under a glass case
    { const p = B.pedestal, g = new THREE.Group(); g.position.copy(this.at(p)); sc.add(g);
      M.add(g, M.box(0.95, 0.75, 0.95), new THREE.MeshLambertMaterial({ color: '#bfe0ff', transparent: true, opacity: 0.22, depthWrite: false }), 0, 0.42, 0);
      O.ctl = this.controllerModel(); O.ctl.position.y = 0.22; O.ctl.scale.setScalar(1.45); g.add(O.ctl);
      O.ctlGlow = M.add(g, new THREE.RingGeometry(0.3, 0.46, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffb030', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), 0, 0.06, 0); }
    // red rotating beacons
    for (const p of B.beacons) { const g = new THREE.Group(); g.position.copy(this.at(p)); sc.add(g);
      M.add(g, M.cyl(0.14, 0.16, 0.08, 10), lam('#2a2e33'), 0, 0, 0); const dome = M.add(g, M.sphere(0.13, 10, 6), new THREE.MeshBasicMaterial({ color: '#601010' }), 0, 0.1, 0);
      const spin = new THREE.Group(); spin.position.y = 0.1; g.add(spin); M.add(spin, M.box(0.6, 0.02, 0.06), new THREE.MeshBasicMaterial({ color: '#ff3020', transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }), 0.3, 0, 0);
      O.beacons.push({ g, dome, spin, x: g.position.x, y: g.position.y, z: g.position.z }); }
    return O;
  },
  missileModel() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body); // +Y = nose
    const white = M.mat('#e8e6e0', { tex: 'metal' }), dark = M.mat('#24262a', { tex: 'metal' }), red = M.mat('#b83a2a');
    M.add(body, M.cyl(0.72, 0.72, 7.2, 18), white, 0, 3.6 + 0.4, 0);
    for (const y of [1.2, 4.6]) M.add(body, M.cyl(0.735, 0.735, 0.35, 18), dark, 0, y, 0);
    M.add(body, M.cyl(0.735, 0.735, 0.18, 18), red, 0, 6.8, 0);
    M.add(body, M.cone(0.72, 2.3, 18), white, 0, 7.6 + 1.15, 0); M.add(body, M.cone(0.2, 0.6, 10), dark, 0, 9.6, 0);
    M.add(body, M.cyl(0.55, 0.7, 0.4, 14), dark, 0, 0.2, 0); // the nozzle skirt
    for (let k = 0; k < 4; k++) { const f = M.add(body, M.box(0.06, 1.5, 0.9), dark, 0, 1.0, 0); f.rotation.y = k * Math.PI / 2; f.position.x = Math.cos(k * Math.PI / 2) * 0.85; f.position.z = -Math.sin(k * Math.PI / 2) * 0.85; f.rotation.y = k * Math.PI / 2 + Math.PI / 2; }
    M.add(body, M.box(0.02, 0.9, 0.5), M.mat('#2a2c30'), 0.73, 5.6, 0); // a stencil panel
    body.position.y = 0; g.userData.body = body;
    return g;
  },
  controllerModel() {
    const g = new THREE.Group(), case_ = M.mat('#2c3036', { tex: 'metal' }), y = M.mat('#e0a030');
    M.add(g, M.box(0.5, 0.1, 0.34), case_, 0, 0.05, 0); M.add(g, M.box(0.52, 0.03, 0.36), y, 0, 0.0, 0);
    const lid = M.add(g, M.box(0.5, 0.3, 0.04), case_, 0, 0.22, -0.16); lid.rotation.x = -0.35;
    M.add(lid, M.box(0.4, 0.22, 0.01), new THREE.MeshBasicMaterial({ color: '#3cff8a' }), 0, 0, 0.022);
    M.add(g, M.box(0.12, 0.03, 0.08), new THREE.MeshBasicMaterial({ color: '#ff3020' }), 0.14, 0.11, 0.08); // the big red key
    M.add(g, M.cyl(0.012, 0.012, 0.3, 5), case_, -0.2, 0.25, 0.1);
    return g;
  },
  /** a little canvas sign */
  textPlane(text, w, h, bg, fg, px) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 32; const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, 64, 32); g.fillStyle = fg; g.font = '800 ' + px * 0.8 + 'px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 32, 17);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t }));
  },
  // ---------------------------------------------------------------- queries
  ready() { const S = this.state(); return !!S && !S.fl && absDay() >= S.rd; },
  /** why the silo can't launch now (null = it can) */
  whyNot() { const S = this.state(); if (!S) return 'There is no Nuclear Bunker on this island.'; if (S.fl) return 'A missile is already in the air.'; const left = S.rd - absDay(); return left > 0 ? 'The silo is reloading — ready in ' + fmtLeft(left) + '.' : null; },
  statusText() { const S = this.state(); if (!S) return ''; return S.fl ? 'LAUNCH IN PROGRESS' : this.ready() ? 'Silo 7: missile armed and ready.' : 'Silo 7 reloading: ready in ' + fmtLeft(S.rd - absDay()) + '.'; },
  /** the controller's tooltip line */
  ctlInfo() { return this.mon ? (this.ready() ? '☢ Silo ready to launch.' : (this.whyNot() || '')) : 'There is no Nuclear Bunker on this island.'; },
  // ---------------------------------------------------------------- interactions (player.js)
  label(u, p) {
    const S = this.state(); if (!S || !this.mon) return null;
    if (Math.abs(p.y - (u.y ?? p.y)) > 1.6) return null; // on another floor (the hill's top, the catwalk)
    const L = LETTERS[u.i | 0];
    switch (u.type) {
      case 'bk_fuse': return S.pw ? ['Launch console powered', 'check'] : ['Insert the launch fuse', 'info'];
      case 'bk_sw': { if (S.sv) return ['Arming key ' + L + ' — locked in', 'check']; const note = this.read.has(S.n + ':' + u.i) ? ' (log: ' + (S.code[u.i] ? 'UP' : 'DOWN') + ')' : ''; return ['Key ' + L + ' is ' + (S.sw[u.i] ? 'UP' : 'DOWN') + ' — flip it' + note, 'hand']; }
      case 'bk_auth': return S.sv ? ['Launch authorised — the vault is open', 'check'] : S.lock > 0 ? ['Console locked out ' + mmss(S.lock), 'lock'] : !S.pw ? ['Authorise launch (no power)', 'lock'] : ['Authorise launch', 'hand'];
      case 'bk_clue': return ['Read the ' + (u.title || 'terminal').toLowerCase(), 'info'];
      case 'bk_status': return ['Silo status', 'info'];
      case 'bk_ctl': return S.sv && S.ctl ? ['Take the Nuclear Targeting Controller', 'hand'] : null;
    }
    return null;
  },
  use(p, u) {
    const S = this.state(); if (!S) return;
    switch (u.type) {
      case 'bk_fuse':
        if (S.pw) { G.ui.toast('The console already has power.'); break; }
        if (p.inv.count('launch_fuse') <= 0) { Sfx.deny(); G.ui.toast('The launch console needs a Launch Circuit Fuse. The bunker\'s armoury (red keycard) keeps them.'); break; }
        this.op('fuse'); break;
      case 'bk_sw': this.op('sw', u.i | 0); break;
      case 'bk_auth': this.op('auth'); break;
      case 'bk_clue': this.terminal(u.i | 0, u.title); break;
      case 'bk_status': G.ui.toast(this.statusText()); Sfx.beep(); break;
      case 'bk_ctl': this.op('ctl'); break;
    }
  },
  terminal(i, title) {
    const S = this.state(), L = LETTERS[i], P = S.code[i] ? 'UP' : 'DOWN', v = CLUES[i][1 + (S.n % 2)];
    this.read.add(S.n + ':' + i); Sfx.beep();
    G.ui.openSheet(title || 'Terminal', body => {
      const d = document.createElement('div');
      d.style.cssText = 'font:600 14px/1.55 ui-monospace,Menlo,monospace;background:#0e1612;color:#7dffaa;padding:14px 16px;border-radius:10px;border:2px solid #234a32;white-space:pre-wrap;max-width:520px;margin:0 auto;text-shadow:0 0 6px rgba(80,255,150,.35)';
      d.textContent = '> ' + CLUES[i][0] + '\n\n' + v.map(l => l.replace('{L}', L).replace('{P}', P)).join('\n') + '\n\n_';
      body.appendChild(d);
      const h = document.createElement('p'); h.className = 'dim small'; h.style.textAlign = 'center'; h.textContent = 'The arming keys are A, B, C and D, left to right on the launch console.'; body.appendChild(h);
    });
  },
  /** do an action on the puzzle: here (host / solo) or ask the host (guest) */
  op(op, i = 0) {
    if (isGuest()) { const q = ++this.q; this.pend.set(q, { op, i, t: G.t }); G.net.send({ t: 'bkop', q, op, i }); return; }
    const r = this.apply(op, i, G.player);
    this.after(op, r);
  },
  /** what the asking player gets from a result (their item in or out, a message) */
  after(op, r) {
    const p = G.player; if (!r) return;
    if (r.ok && op === 'fuse') p.inv.take('launch_fuse', 1);
    if (r.ok && op === 'ctl') { const left = p.inv.add('nuke_ctl', 1); if (left) Live.dropItem(p.x, p.z, 'nuke_ctl', 1); Sfx.win(); }
    if (r.ok && op === 'nuke') this.consume(p);
    if (r.msg) G.ui.toast(r.msg, r.kind);
    if (!r.ok && op !== 'sw') Sfx.deny();
    if (G.ui) G.ui.refreshAll();
  },
  /** host / solo: apply an action by `by` (an actor); returns { ok, msg, kind } */
  apply(op, i, by) {
    const S = this.state(); if (!S) return null;
    const pos = this.at([-3, -11, 1]);
    switch (op) {
      case 'fuse': if (S.pw) return { ok: false, msg: 'The console already has power.' }; S.pw = 1; Sfx.lever(pos.x, pos.z); Sfx.card(); this.push(); return { ok: true, msg: 'Launch console powered. Set the arming keys and authorise.', kind: 'good' };
      case 'sw':
        if (S.sv) return { ok: false, msg: 'The keys are locked in.' };
        if (S.lock > 0) return { ok: false, msg: 'The console is locked out for ' + mmss(S.lock) + '.' };
        S.sw[i & 3] ^= 1; Sfx.keyThrow(pos.x, pos.z); this.push(); return { ok: true };
      case 'auth': {
        if (S.sv) return { ok: false, msg: 'Already authorised. The vault is open.' };
        if (S.lock > 0) return { ok: false, msg: 'Locked out — ' + mmss(S.lock) + '.' };
        if (!S.pw) return { ok: false, msg: 'No power. The fuse box on the west wall needs the launch fuse.' };
        const n = S.sw.filter((v, k) => v === S.code[k]).length; Sfx.keyThrow(pos.x, pos.z);
        if (n === 4) { this.solve(); return { ok: true, msg: 'LAUNCH AUTHORISED — the vault is open.', kind: 'good' }; }
        this.fail(n, by); return { ok: false, msg: 'AUTHORISATION FAILED — ' + n + ' of 4 arming keys right. Intruder alert!', kind: 'bad' };
      }
      case 'ctl': if (!S.sv) return { ok: false, msg: 'The vault is sealed.' }; if (!S.ctl) return { ok: false, msg: 'The pedestal is empty.' }; S.ctl = 0; this.push(); return { ok: true, msg: 'You took the Nuclear Targeting Controller. Use it from your inventory to pick a target.', kind: 'good' };
    }
    return null;
  },
  solve() {
    const S = this.S; S.sv = 1; S.svAbs = absDay(); S.al = 0; S.lock = 0;
    this.syncDoor(); if (this.door) { openDoor(this.door, this.door.x, this.door.z + 2); }
    Sfx.win(); say('The vault in the Nuclear Bunker is open!', 'good'); this.push();
  },
  fail(n, by) {
    const S = this.S; S.lock = LOCK_S; S.al = ALARM_S; this.push();
    say('INTRUDER ALERT at the Nuclear Bunker — guards are on their way!', 'bad');
    const c = this.at([-3, -11, 0]); if (G.onNoise) G.onNoise(c.x, c.z, 90, by || null);
    // a wave of guards from the barracks, the generator hall and the yard, straight for launch control
    const spots = this.B.wave.slice().sort(() => Math.random() - 0.5), N = 4 + (G.day >= 6 ? 1 : 0);
    for (let k = 0; k < N; k++) {
      const s = spots[k % spots.length], p = this.at([s[0] + rand(-0.8, 0.8), s[1] + rand(-0.8, 0.8), 0]);
      const a = spawnActor(k % 2 ? 'scientist' : 'scientist_heavy', p.x, p.z); a.y = this.B.baseY; a.roamer = true; a.bkWave = true;
      a.ai.home = { x: c.x, z: c.z, y: this.B.baseY }; a.ai.state = 'alert'; a.ai.lastSeen = { x: c.x, z: c.z, y: this.B.baseY, t: G.t }; a.ai.t = 60; a.ai.alertT = 40;
      if (by && !by.dead) { a.ai.target = by; }
    }
  },
  /** the vault door follows the state (locked and shut until solved) */
  syncDoor(snap) {
    const d = this.door, S = this.S || this.gS; if (!d || d.dead || !S) return;
    const L = !S.sv; if (d.locked !== L) { d.locked = L; d.unlockT = 1e9; }
    if (L && d.open) { if (closeDoor(d, !!snap) !== false && snap) { d.a = 0; } }
  },
  /** the puzzle starts over: a new pattern, keys scrambled, no power, the controller back, the vault shut */
  resetPuzzle() {
    const S = this.S, f = this.fresh(); Object.assign(S, { code: f.code, sw: f.sw, pw: 0, sv: 0, svAbs: 0, ctl: 1, lock: 0, al: 0, n: S.n + 1 });
    this.syncDoor(); this.push();
  },
  // ---------------------------------------------------------------- the launch
  /** the local player fires their controller: check, pick a target on the map, ask for a launch */
  useController() {
    const why = this.whyNot(); if (why) { Sfx.deny(); G.ui.toast(why, 'bad'); return; }
    if (!G.ui.openMap) return;
    G.ui.openMap({ target: { from: this.silo(), min: MIN_RANGE, ok: (x, z) => this.request(x, z), check: (x, z) => this.targetWhy(x, z) } });
  },
  targetWhy(x, z) {
    if (!(x > 5 && z > 5 && x < WORLD - 5 && z < WORLD - 5)) return 'Off the map.';
    const s = this.silo(); if (dist(s.x, s.z, x, z) < MIN_RANGE) return 'Too close to the silo (at least ' + MIN_RANGE + ' m).';
    for (const q of G.safes || []) if (dist(q.x, q.z, x, z) < q.r + 60) return 'Safe zones can\'t be targeted.';
    return null;
  },
  request(x, z) {
    const why = this.whyNot() || this.targetWhy(x, z); if (why) { Sfx.deny(); G.ui.toast(why, 'bad'); return; }
    if (isGuest()) { const q = ++this.q; this.pend.set(q, { op: 'nuke', t: G.t }); G.net.send({ t: 'nkreq', q, x: r1(x), z: r1(z) }); G.ui.toast('Sending the launch codes…'); return; }
    this.after('nuke', this.launch(x, z, G.player));
  },
  consume(p) { for (const v of [p.inv.belt, p.inv.main]) { const k = v.slots.findIndex(s => s && s.id === 'nuke_ctl'); if (k >= 0) { v.slots[k] = null; break; } } },
  /** host / solo: launch at (x, z) for `by`; returns { ok, msg } */
  launch(x, z, by, byId) {
    const S = this.state(); if (!S) return { ok: false, msg: 'No silo.' };
    const why = this.whyNot() || this.targetWhy(x, z); if (why) return { ok: false, msg: why };
    const s = this.silo(), d = dist(s.x, s.z, x, z), ty = Math.max(0, G.W.height(x, z));
    S.fid = (S.fid || 0) + 1;
    S.fl = { x0: r2(s.x), y0: r2(s.y + 1.2), z0: r2(s.z), x1: r1(x), y1: r2(ty), z1: r1(z), T: r1(clamp(20 + d / 90, 22, 38)), H: r1(clamp(150 + d * 0.3, 170, 560)), t: 0, id: S.fid, by: byId ?? null };
    S.rd = absDay() + RELOAD_DAYS;
    say('☢ NUCLEAR LAUNCH DETECTED — the Nuclear Bunker\'s missile is heading for grid ' + gridName(x, z) + '. Impact in about ' + Math.round(S.fl.T + PRE) + ' s!', 'bad');
    this.push();
    return { ok: true, msg: 'Launch codes accepted. The silo is opening…', kind: 'good' };
  },
  /** where the missile is at flight time t: { x, y, z, dx, dy, dz } (in the silo until PRE) */
  pose(F, t) {
    if (t < PRE) { const rise = t > PRE - 0.6 ? (t - (PRE - 0.6)) * 2 : 0; return { x: F.x0, y: F.y0 + rise, z: F.z0, dx: 0, dy: 1, dz: 0 }; }
    const u = clamp((t - PRE) / F.T, 0, 1), s = Math.pow(u, 1.45);
    const P0 = [F.x0, F.y0, F.z0], P1 = [F.x0, F.y0 + F.H * 1.25, F.z0], P2 = [F.x1, F.y1 + F.H * 1.05, F.z1], P3 = [F.x1, F.y1, F.z1], m = 1 - s;
    const p = k => m * m * m * P0[k] + 3 * m * m * s * P1[k] + 3 * m * s * s * P2[k] + s * s * s * P3[k];
    const dp = k => 3 * m * m * (P1[k] - P0[k]) + 6 * m * s * (P2[k] - P1[k]) + 3 * s * s * (P3[k] - P2[k]);
    return { x: p(0), y: p(1), z: p(2), dx: dp(0), dy: dp(1), dz: dp(2) };
  },
  impact() {
    const S = this.S, F = S.fl; if (!F) return;
    S.fl = null; S.hit = { id: F.id, x: F.x1, y: F.y1, z: F.z1, t: G.t };
    const by = F.by !== null && F.by !== undefined && G.net && G.net.players ? (G.net.players.get(F.by) || {}).actor : (F.by === null ? G.player : null);
    this.seenHit = F.id;
    this.blast(F.x1, F.y1, F.z1, by || null);
    S.fo.push({ x: F.x1, z: F.z1, a0: absDay(), id: F.id }); this.rads();
    say('The nuclear strike hit grid ' + gridName(F.x1, F.z1) + '. Fallout is spreading — stay out of the green for a day.', 'bad');
    this.push();
  },
  /** the blast, here (host / solo: the world takes it; guests: only their own player, the look and the sound) */
  blast(x, y, z, by) {
    if (this.fx.trail && G.fx) { G.fx.nukes.end(this.fx.trail); this.fx.trail = null; }
    explode(x, z, NUKE, by, by === G.player ? 'player' : 'hostile', y + 1);
    if (!isGuest()) { // trees in the core are flattened (they come back like felled ones)
      const W = G.W, n = Math.ceil(W.size / 64), R = 42;
      for (let cj = Math.floor((z - R) / 64); cj <= Math.floor((z + R) / 64); cj++) for (let ci = Math.floor((x - R) / 64); ci <= Math.floor((x + R) / 64); ci++) {
        if (ci < 0 || cj < 0 || ci >= n || cj >= n) continue;
        for (const v of W.vegChunks[cj * n + ci]) { if (!v.tree || Live.vegHidden.has(v.id) || (v.x - x) ** 2 + (v.z - z) ** 2 > R * R) continue; Live.vegHidden.set(v.id, G.t + 1800); Live.veg.set(v.id, 0); if (v.col) v.col.off = true; }
      }
    }
  },
  /** the fallout zones into the world's radiation (G.rads) */
  rads() {
    const S = this.S || this.gS; if (!G.rads) return;
    G.rads = G.rads.filter(r => !r.nuke);
    if (!S) return; const now = absDay();
    for (const f of S.fo || []) { const age = (now - f.a0) / FALLOUT_DAYS; if (age >= 1) continue; G.rads.push({ x: f.x, z: f.z, r: FALLOUT_R, power: FALLOUT_P * Math.pow(1 - age, 1.3) + 0.4, nuke: true, mon: null }); }
  },
  // ---------------------------------------------------------------- tick
  update(dt) {
    const S = this.state(); if (!S) return;
    const host = !isGuest(), P = G.player;
    if (host) {
      if (S.lock > 0) S.lock = Math.max(0, S.lock - dt);
      if (S.al > 0) S.al = Math.max(0, S.al - dt);
      if (S.fl) { S.fl.t += dt; if (S.fl.t >= PRE + S.fl.T) this.impact(); }
      if ((this.chkT = (this.chkT || 0) - dt) <= 0) {
        this.chkT = 2;
        if (S.sv && absDay() >= S.svAbs + RELOAD_DAYS && nearest(this.mon.x, this.mon.z) > 120) this.resetPuzzle();
        const n0 = S.fo.length; S.fo = S.fo.filter(f => absDay() - f.a0 < FALLOUT_DAYS); if (S.fo.length !== n0) this.push();
        this.rads(); this.syncDoor();
      }
    } else {
      if (S.fl) S.fl.t += dt; if (S.lock > 0) S.lock = Math.max(0, S.lock - dt); if (S.al > 0) S.al = Math.max(0, S.al - dt);
      for (const [q, r] of this.pend) if (G.t - r.t > 12) this.pend.delete(q);
      if ((this.chkT = (this.chkT || 0) - dt) <= 0) { this.chkT = 2; this.rads(); }
    }
    this.frame(dt, S, P);
  },
  /** the look and sound of it all (every client) */
  frame(dt, S, P) {
    const O = this.obj; const near = P ? dist(P.x, P.z, this.mon.x, this.mon.z) : 1e9; const F = S.fl;
    // fallout motes round you while you're in it
    if (P && G.fx && !P.dead) for (const f of S.fo || []) if (dist(P.x, P.z, f.x, f.z) < FALLOUT_R && Math.random() < dt * 14) { G.fx.rad(P.x + rand(-6, 6), P.y + rand(0.2, 2.5), P.z + rand(-6, 6)); if (Math.random() < 0.15) G.fx.emit({ x: P.x + rand(-14, 14), y: P.y + rand(0, 4), z: P.z + rand(-14, 14), vx: rand(-0.4, 0.4), vy: -0.1, vz: rand(-0.4, 0.4), life: 5, size: 2, size1: 5, r: 0.55, g: 0.6, b: 0.32, a: 0.18, a1: 0 }); }
    if (!O) return;
    const s = this.silo();
    // the hatch: open from the launch until the missile is well clear
    const want = F && F.t < PRE + 14 ? 1 : 0; O.open += clamp(want - O.open, -dt * 0.4, dt * 0.45);
    O.leaves[0].rotation.z = -O.open * 1.75; O.leaves[1].rotation.z = O.open * 1.75;
    // the missile: in the silo when ready, flying when launched, gone while the silo reloads
    const ready = !F && absDay() >= S.rd;
    const ms = O.missile; ms.visible = !!F || ready;
    if (F) {
      const q = this.pose(F, F.t); const cam = G.rend.camera.position; const D = d0(G.rend.camera);
      _v.set(q.x, q.y, q.z); const k = pull(_w, _v, cam, D);
      ms.position.copy(_w); ms.scale.setScalar(k);
      _d.set(q.dx, q.dy, q.dz).normalize(); ms.quaternion.setFromUnitVectors(_up, _d);
      // the trail and the flare (from lift-off), smoke out of the silo before it
      if (G.fx) {
        if (F.t >= PRE - 0.2) {
          if (!this.fx.trail || this.fx.fid !== F.id) { if (this.fx.trail) G.fx.nukes.end(this.fx.trail); this.fx.trail = G.fx.nukes.trail(); this.fx.fid = F.id; this.fx.pt = 0; if (P) Sfx.launch(s.x, s.z); }
          const tail = [q.x - _d.x * 0.4, q.y - _d.y * 0.4, q.z - _d.z * 0.4];
          if ((this.fx.pt -= dt) <= 0) { this.fx.pt = 0.1; G.fx.nukes.addPoint(this.fx.trail, ...tail); }
          G.fx.nukes.flare(this.fx.trail, ...tail);
          if (F.t < PRE + 6 && near < 260) for (let k2 = 0; k2 < 3; k2++) { const a = Math.random() * 6.28; G.fx.emit({ x: s.x + Math.cos(a) * 2, y: s.top + rand(-1, 1), z: s.z + Math.sin(a) * 2, vx: Math.cos(a) * rand(3, 9), vy: rand(2, 8), vz: Math.sin(a) * rand(3, 9), life: rand(4, 7), size: 3, size1: rand(10, 16), r: 0.82, g: 0.8, b: 0.77, a: 0.6, a1: 0, drag: 0.5 }); }
          if (F.t < PRE + 2.5 && near < 200) { G.fx.fire(q.x, q.y + 0.2, q.z, 3); G.fx.light(q.x, q.y + 1, q.z, '#ffb060', 14, 60, 0.12); }
          if (P && !this.fx.wh && F.t > PRE + 2) { const d = Math.hypot(q.x - P.x, q.z - P.z); if (d < 220 && q.y - P.y < 260) { this.fx.wh = true; Sfx.whoosh(q.x, q.z); } }
        } else if (F.t > PRE - 3 && near < 260) { // ignition: smoke boils out of the shaft
          const k3 = F.t > PRE - 1.2 ? 5 : 3;
          for (let k2 = 0; k2 < k3; k2++) G.fx.emit({ x: s.x + rand(-3, 3), y: s.top + rand(-1, 0.5), z: s.z + rand(-3, 3), vx: rand(-2, 2), vy: rand(5, 11), vz: rand(-2, 2), life: rand(3.5, 6), size: 3, size1: rand(10, 16), r: 0.88, g: 0.87, b: 0.83, a: 0.7, a1: 0, drag: 0.45 });
          if (Math.random() < 0.5) G.fx.fire(s.x + rand(-1, 1), s.y + 1.4, s.z + rand(-1, 1), 2.5);
        }
      }
    } else { ms.position.set(s.x, s.y + 1.2, s.z); ms.scale.setScalar(1); ms.quaternion.identity(); this.fx.wh = false; if (this.fx.trail && G.fx) { G.fx.nukes.end(this.fx.trail); this.fx.trail = null; } }
    // alarms: the klaxon and the beacons during an alarm or a launch
    const alarm = S.al > 0 || (F && F.t < PRE + 6);
    if (alarm && P && near < 260 && (this.klT = (this.klT || 0) - dt) <= 0) { this.klT = 1.1; const c = this.at([-3, 0, 0]); Sfx.klaxon(c.x, c.z); if (F && F.t < PRE) Sfx.klaxon(s.x, s.z); }
    for (const b of O.beacons) {
      b.spin.rotation.y += dt * (alarm ? 9 : 0); b.spin.children[0].material.opacity = alarm ? 0.9 : 0; b.dome.material.color.set(alarm ? (Math.sin(G.t * 9) > 0 ? '#ff3020' : '#a01810') : '#601010');
      if (alarm && G.fx && P && (b.x - P.x) ** 2 + (b.z - P.z) ** 2 < 40 * 40 && Math.random() < dt * 6) G.fx.light(b.x, b.y, b.z, '#ff2a1a', 3.5, 12, 0.3);
    }
    if (near > 120) return;
    // the console
    for (let i = 0; i < 4; i++) { const up = !!S.sw[i], t = up ? -0.7 : 0.7; O.levers[i].rotation.x += (t - O.levers[i].rotation.x) * Math.min(1, dt * 14); O.lamps[i].material.color.set(up ? '#ffe9a0' : '#3a3020'); }
    O.fuseLamp.material.color.set(S.pw ? '#3cff6a' : (Math.sin(G.t * 3) > 0 ? '#ff2a1a' : '#401010'));
    O.btnGlow.material.opacity = S.pw && !S.sv && !(S.lock > 0) ? 0.35 + 0.3 * Math.sin(G.t * 4) : 0;
    O.ctl.visible = !!S.ctl; O.ctlGlow.visible = !!S.ctl; O.ctl.rotation.y += dt * 0.5; O.ctlGlow.material.opacity = 0.4 + 0.25 * Math.sin(G.t * 3);
    if ((this.scT = (this.scT || 0) - dt) <= 0) { this.scT = 1; this.drawScreen(S); }
  },
  drawScreen(S) {
    const c = this.obj.cv, g = c.getContext('2d'), F = S.fl, ready = !F && absDay() >= S.rd;
    g.fillStyle = '#081008'; g.fillRect(0, 0, c.width, c.height);
    const col = F ? '#ff5040' : ready ? '#5aff8a' : '#ffc040';
    g.strokeStyle = col; g.lineWidth = 4; g.strokeRect(6, 6, c.width - 12, c.height - 12);
    g.fillStyle = col; g.font = '800 34px ui-monospace, Menlo, monospace'; g.textAlign = 'left';
    g.fillText('SILO 7', 22, 52);
    g.font = '800 30px ui-monospace, Menlo, monospace';
    g.fillText(F ? 'LAUNCH IN PROGRESS' : ready ? 'MISSILE ARMED' : 'RELOADING', 22, 98);
    g.font = '600 22px ui-monospace, Menlo, monospace'; g.fillStyle = '#9ad0a8';
    g.fillText(F ? 'TARGET ' + gridName(F.x1, F.z1) + '  T-' + Math.max(0, Math.ceil(PRE + F.T - F.t)) + 's' : ready ? (S.sv ? 'AUTHORISED - VAULT OPEN' : S.lock > 0 ? 'CONSOLE LOCKED ' + mmss(S.lock) : S.pw ? 'CONSOLE POWERED' : 'CONSOLE: NO POWER') : 'READY IN ' + fmtLeft(S.rd - absDay()).replace(/ \(.*/, ''), 22, 136);
    this.obj.tex.needsUpdate = true;
  },
  // ---------------------------------------------------------------- the map (ui.js)
  grid: gridName,
  /** seconds from the launch to the impact for a target at (x, z) */
  flightTime(x, z) { const s = this.silo(); return PRE + clamp(20 + dist(s.x, s.z, x, z) / 90, 22, 38); },
  mapInfo() {
    const S = this.state(); if (!S || !this.mon) return null;
    const o = { x: this.mon.x, z: this.mon.z, ready: this.ready(), fo: (S.fo || []).map(f => ({ x: f.x, z: f.z, r: FALLOUT_R })) };
    if (S.fl) { const q = this.pose(S.fl, S.fl.t); o.missile = { x: q.x, z: q.z, ang: Math.atan2(q.dz, q.dx), x0: S.fl.x0, z0: S.fl.z0, x1: S.fl.x1, z1: S.fl.z1, left: Math.max(0, PRE + S.fl.T - S.fl.t) }; }
    return o;
  },
  // ---------------------------------------------------------------- co-op (net.js / networld.js)
  push() { if (isHost()) { this.pushT = 0; const m = this.netState(); if (m) G.net.broadcast(m); } },
  netState() {
    const S = this.state(); if (!S || !this.mon || isGuest()) return null;
    return { t: 'znk', code: S.code, sw: S.sw, pw: S.pw, sv: S.sv, ctl: S.ctl, lock: r1(S.lock), al: r1(S.al), rd: Math.round(S.rd * 1e4) / 1e4, n: S.n, fl: S.fl ? Object.assign({}, S.fl, { t: r2(S.fl.t) }) : null, fo: S.fo.map(f => [r1(f.x), r1(f.z), Math.round(f.a0 * 1e4) / 1e4, f.id]), hit: S.hit && G.t - S.hit.t < 8 ? { id: S.hit.id, x: S.hit.x, y: S.hit.y, z: S.hit.z } : null };
  },
  /** guest: the host's state */
  fromHost(m) {
    if (!this.mon || !m) return; const S = this.state(); const num = v => typeof v === 'number' && Number.isFinite(v), bits = a => Array.isArray(a) && a.length === 4 ? a.map(v => v ? 1 : 0) : null;
    if (bits(m.code)) S.code = bits(m.code); if (bits(m.sw)) S.sw = bits(m.sw);
    S.pw = m.pw ? 1 : 0; S.sv = m.sv ? 1 : 0; S.ctl = m.ctl ? 1 : 0; if (num(m.lock)) S.lock = m.lock; if (num(m.al)) S.al = m.al; if (num(m.rd)) S.rd = m.rd; if (num(m.n)) S.n = m.n;
    const f = m.fl;
    if (f && ['x0', 'y0', 'z0', 'x1', 'y1', 'z1', 'T', 'H', 't'].every(k => num(f[k]))) { if (!S.fl || S.fl.id !== f.id) S.fl = Object.assign({}, f); else if (Math.abs(S.fl.t - f.t) > 0.6) S.fl.t = f.t; }
    else if (!f) S.fl = null;
    S.fo = Array.isArray(m.fo) ? m.fo.filter(q => Array.isArray(q) && q.slice(0, 3).every(num)).slice(0, 8).map(q => ({ x: q[0], z: q[1], a0: q[2], id: q[3] })) : [];
    const h = m.hit; if (h && num(h.x) && num(h.z) && num(h.y) && h.id !== this.seenHit) { this.seenHit = h.id; S.fl = null; this.blast(h.x, h.y, h.z, null); }
    this.rads(); this.syncDoor();
  },
  /** host: a guest's request ('bkop' / 'nkreq') */
  hostReq(m, pl) {
    if (!this.mon || !pl) return;
    const r = m.t === 'nkreq' ? (Number.isFinite(+m.x) && Number.isFinite(+m.z) ? this.launch(clamp(+m.x, 0, WORLD), clamp(+m.z, 0, WORLD), pl.actor, pl.id) : null) : this.apply(String(m.op || ''), (m.i | 0) & 3, pl.actor);
    if (!r) return;
    G.net.sendTo(pl.id, { t: 'bkack', q: m.q | 0, op: m.t === 'nkreq' ? 'nuke' : String(m.op || ''), ok: !!r.ok, msg: r.msg || '', kind: r.kind || '' });
  },
  /** guest: the host's answer */
  ack(m) {
    const r = this.pend.get(m.q | 0); if (!r) return; this.pend.delete(m.q | 0);
    this.after(r.op, { ok: !!m.ok, msg: String(m.msg || '').slice(0, 160), kind: m.kind === 'good' || m.kind === 'bad' ? m.kind : undefined });
  },
};
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
G.bunker = Bunker;
void ITEMS;

// ---------------------------------------------------------------- inventory icons for the new items (16x16 pixel art)
const ICONS = {
  nuke_ctl: ['................', '..oooooooooooo..', '..okkkkkkkkkko..', '..okggggggggko..', '..okgllgggggko..', '..okgggglgggko..', '..okggggggggko..', '..okkkkkkkkkko..', '.oyyyyyyyyyyyyo.', '.oyNNNNNNNNNNyo.', '.oyNrrNNNmmNNyo.', '.oyNrrNNNmmNNyo.', '.oyNNNNNNNNNNyo.', '.oyyyyyyyyyyyyo.', '..oooooooooooo..', '................'],
  launch_fuse: ['................', '......oooo......', '.....oyyyyo.....', '....oyhyyyyo....', '....ommmmmmo....', '....ouuuuuuo....', '....ouhuuuuo....', '....ouuuuuuo....', '....ouuuuuuo....', '....ouhuuuuo....', '....ouuuuuuo....', '....ommmmmmo....', '....oyyyyyyo....', '.....oyyyyo.....', '......oooo......', '................'],
};
const PAL = { o: '#181425', k: '#262b44', g: '#1e5a32', l: '#63ff8d', y: '#f0b43a', N: '#3a4466', r: '#e43b44', m: '#8b9bb4', u: '#d7552f', h: '#fff4d6' };
let iconCache = null;
function iconCanvas(id) {
  const rows = ICONS[id]; if (!rows || typeof document === 'undefined') return null; iconCache = iconCache || {}; if (iconCache[id]) return iconCache[id];
  const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d');
  rows.forEach((r, j) => { for (let i = 0; i < 16; i++) { const col = PAL[r[i]]; if (col) { g.fillStyle = col; g.fillRect(i, j, 1, 1); } } });
  return (iconCache[id] = c);
}
/** route ART.icon / ART.iconURL for the controller and the launch fuse to the icons above */
export function registerBunkerIcons(A) {
  A = A || (typeof window !== 'undefined' ? window.ART : null);
  if (!A || !A.iconURL || A._bunker) return false;
  const baseURL = A.iconURL, baseIcon = A.icon, urls = {};
  A.icon = id => (ICONS[id] && iconCanvas(id)) || (baseIcon ? baseIcon(id) : null);
  A.iconURL = id => { if (!ICONS[id]) return baseURL(id); if (!urls[id]) { try { urls[id] = iconCanvas(id).toDataURL(); } catch (e) { urls[id] = baseURL(id); } } return urls[id]; };
  A._bunker = true; return true;
}

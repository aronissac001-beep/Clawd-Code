'use strict';
// ============================================================================
// ZONEFALL — core utilities: math, input (touch twin-stick + keyboard/mouse),
// synthesized audio, procedural item icons, save/load.
// ============================================================================

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const dist2 = (ax, ay, bx, by) => (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const chance = p => Math.random() < p;
function weighted(list, wIdx = 1) {
  let tot = 0; for (const e of list) tot += e[wIdx];
  let r = Math.random() * tot;
  for (const e of list) { r -= e[wIdx]; if (r <= 0) return e; }
  return list[list.length - 1];
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const fmtTime = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

// ---------------------------------------------------------------------------
// INPUT
// ---------------------------------------------------------------------------
const Input = {
  move: { x: 0, y: 0, id: null, ox: 0, oy: 0, cx: 0, cy: 0, mag: 0 },
  aim: { x: 0, y: 0, id: null, ox: 0, oy: 0, cx: 0, cy: 0, mag: 0 },
  keys: {}, mouse: { x: 0, y: 0, down: false, used: false },
  held: {},          // virtual buttons currently held
  pressed: {},       // virtual buttons pressed this frame
  drag: null,        // build-mode placement drag {id, sx, sy, cx, cy}
  dragEnds: [],      // finished drags this frame
  touchMode: false,
  STICK_R: 56, FIRE_T: 0.6, AIM_T: 0.2,
  // resting positions of the two sticks (shown as ghosts)
  homes() { const R0 = this.STICK_R; return { mx: R0 + 34 + (innerWidth > 700 ? 20 : 0), my: innerHeight - R0 - 30, ax: innerWidth - 118 - R0, ay: innerHeight - R0 - 30 }; },
  inMoveZone(x, y) { return x < innerWidth * (Game.buildMode ? 0.32 : 0.45) && (!Game.buildMode || y > innerHeight * 0.4); },
  init(canvas) {
    const R0 = () => this.STICK_R;
    const startStick = (s, t) => Object.assign(s, { id: t.identifier, ox: t.clientX, oy: t.clientY, cx: t.clientX, cy: t.clientY, x: 0, y: 0, mag: 0 });
    const onStart = e => {
      this.touchMode = true; Sfx.unlock();
      for (const t of e.changedTouches) {
        const x = t.clientX, y = t.clientY;
        if (this.inMoveZone(x, y)) { if (this.move.id === null) startStick(this.move, t); continue; }
        if (Game.buildMode) { if (!this.drag) this.drag = { id: t.identifier, sx: x, sy: y, cx: x, cy: y }; continue; }
        if (this.aim.id === null) startStick(this.aim, t);
      }
      e.preventDefault();
    };
    const onMove = e => {
      for (const t of e.changedTouches) {
        const x = t.clientX, y = t.clientY;
        if (this.drag && t.identifier === this.drag.id) { this.drag.cx = x; this.drag.cy = y; continue; }
        for (const s of [this.move, this.aim]) {
          if (s.id !== t.identifier) continue;
          let dx = x - s.ox, dy = y - s.oy; const d = Math.hypot(dx, dy);
          if (d > R0()) { const k = (d - R0()) / d; s.ox += dx * k; s.oy += dy * k; dx = x - s.ox; dy = y - s.oy; } // floating base follows
          s.cx = x; s.cy = y; s.x = dx / R0(); s.y = dy / R0(); s.mag = Math.min(1, Math.hypot(s.x, s.y));
        }
      }
      e.preventDefault();
    };
    const onEnd = e => {
      for (const t of e.changedTouches) {
        if (this.drag && t.identifier === this.drag.id) { this.dragEnds.push({ ...this.drag, cx: t.clientX, cy: t.clientY }); this.drag = null; }
        if (this.move.id === t.identifier) Object.assign(this.move, { id: null, x: 0, y: 0, mag: 0 });
        if (this.aim.id === t.identifier) Object.assign(this.aim, { id: null, x: 0, y: 0, mag: 0 });
      }
      e.preventDefault();
    };
    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onEnd, { passive: false });
    canvas.addEventListener('touchcancel', onEnd, { passive: false });
    // mouse / keyboard (desktop)
    canvas.addEventListener('mousemove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.used = true; if (this.drag && this.drag.id === 'm') { this.drag.cx = e.clientX; this.drag.cy = e.clientY; } });
    canvas.addEventListener('mousedown', e => {
      Sfx.unlock(); this.mouse.down = true; this.mouse.used = true; this.touchMode = false;
      if (Game.buildMode) this.drag = { id: 'm', sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY };
    });
    addEventListener('mouseup', e => { this.mouse.down = false; if (this.drag && this.drag.id === 'm') { this.dragEnds.push({ ...this.drag, cx: e.clientX, cy: e.clientY }); this.drag = null; } });
    addEventListener('keydown', e => {
      if (e.target && e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase(); this.keys[k] = true; Sfx.unlock(); this.touchMode = false;
      const map = { e: 'interact', f: 'interact', r: 'reload', q: 'swap', h: 'heal', g: 'grenade', tab: 'bag', i: 'bag', b: 'build', m: 'map', escape: 'esc' };
      if (map[k] && !e.repeat) { this.pressed[map[k]] = true; this.held[map[k]] = true; }
      if (k === 'tab') e.preventDefault();
    });
    addEventListener('keyup', e => { const k = e.key.toLowerCase(); this.keys[k] = false; if (k === 'e' || k === 'f') this.held.interact = false; });
    addEventListener('blur', () => { this.keys = {}; this.held = {}; this.mouse.down = false; });
  },
  bindButton(el, name) {
    const down = e => { e.preventDefault(); e.stopPropagation(); Sfx.unlock(); this.held[name] = true; this.pressed[name] = true; el.classList.add('down'); };
    const up = e => { e.preventDefault(); e.stopPropagation(); this.held[name] = false; el.classList.remove('down'); };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
    el.addEventListener('mousedown', down);
    el.addEventListener('mouseup', up);
    el.addEventListener('mouseleave', e => { if (this.held[name]) up(e); });
  },
  moveVec() {
    let x = this.move.x, y = this.move.y;
    if (this.keys.w || this.keys.arrowup) y -= 1;
    if (this.keys.s || this.keys.arrowdown) y += 1;
    if (this.keys.a || this.keys.arrowleft) x -= 1;
    if (this.keys.d || this.keys.arrowright) x += 1;
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    return { x, y, mag: Math.min(1, m) };
  },
  endFrame() { this.pressed = {}; this.dragEnds.length = 0; },
};

// ---------------------------------------------------------------------------
// AUDIO (all synthesized; iOS requires unlock on a user gesture)
// ---------------------------------------------------------------------------
const Sfx = {
  ctx: null, master: null, noiseBuf: null, enabled: true, ambient: null,
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = 0.55;
      const comp = this.ctx.createDynamicsCompressor(); this.master.connect(comp); comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.2; this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // small generated room reverb for gunshots and explosions
      const rl = this.ctx.sampleRate * 1.8, ir = this.ctx.createBuffer(2, rl, this.ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const dd = ir.getChannelData(ch); for (let i = 0; i < rl; i++) dd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3.2); }
      const conv = this.ctx.createConvolver(); conv.buffer = ir; this.rev = this.ctx.createGain(); this.rev.gain.value = 0.28; this.rev.connect(conv); conv.connect(this.master);
      // silent buffer kick for iOS
      const s = this.ctx.createBufferSource(); s.buffer = this.ctx.createBuffer(1, 1, 22050); s.connect(this.master); s.start(0);
    } catch (e) { this.ctx = null; }
  },
  vol(x, y) { // distance attenuation from player
    if (x === undefined || !Game.player) return 1;
    const d = dist(x, y, Game.player.x, Game.player.y);
    return clamp(1 - d / 900, 0, 1) ** 1.5;
  },
  noise(dur, freq, q, gain, type = 'lowpass', t0 = 0, sweep = 0, rev = false) {
    if (!this.ctx || !this.enabled || gain < 0.01) return;
    const c = this.ctx, t = c.currentTime + t0;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); if (rev && this.rev) g.connect(this.rev); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  },
  tone(freq, dur, gain, type = 'square', t0 = 0, slide = 0, rev = false) {
    if (!this.ctx || !this.enabled || gain < 0.01) return;
    const c = this.ctx, t = c.currentTime + t0;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); if (rev && this.rev) g.connect(this.rev); o.start(t); o.stop(t + dur + 0.05);
  },
  shot(kind, x, y) {
    const v = this.vol(x, y); if (v <= 0) return; const far = x !== undefined ? 1 - v : 0;
    const lp = 1 - far * 0.6; // distant shots are duller
    if (kind === 'shotgun') { this.noise(0.05, 5000 * lp, 0.5, 0.9 * v, 'lowpass', 0, 0, true); this.noise(0.4, 1500 * lp, 0.7, 0.9 * v, 'lowpass', 0, 0.15, true); this.tone(65, 0.22, 0.55 * v, 'sine', 0, 0.45); }
    else if (kind === 'rifle') { this.noise(0.04, 6000 * lp, 0.5, 0.8 * v, 'lowpass', 0, 0, true); this.noise(0.24, 2400 * lp, 0.8, 0.75 * v, 'lowpass', 0, 0.2, true); this.tone(105, 0.12, 0.4 * v, 'square', 0, 0.35); }
    else if (kind === 'sniper') { this.noise(0.05, 7000 * lp, 0.5, 0.9 * v, 'lowpass', 0, 0, true); this.noise(0.6, 2600 * lp, 0.6, 0.95 * v, 'lowpass', 0, 0.1, true); this.tone(75, 0.35, 0.55 * v, 'sine', 0, 0.35); }
    else if (kind === 'smg') { this.noise(0.03, 6000 * lp, 0.5, 0.5 * v, 'lowpass', 0, 0, true); this.noise(0.12, 3000 * lp, 0.9, 0.5 * v, 'lowpass', 0, 0.3, true); }
    else if (kind === 'turret') { this.noise(0.08, 4200, 1.2, 0.35 * v, 'bandpass', 0, 0, true); }
    else { this.noise(0.04, 5000 * lp, 0.5, 0.6 * v, 'lowpass', 0, 0, true); this.noise(0.16, 2200 * lp, 0.9, 0.6 * v, 'lowpass', 0, 0.3, true); this.tone(150, 0.08, 0.25 * v, 'square', 0, 0.5); }
  },
  step(indoor) { this.noise(0.05, indoor ? 900 : 600, 1.2, 0.06 + Math.random() * 0.03, 'bandpass'); },
  chirp() { if (!this.ctx) return; const f = rand(2400, 3800), n = randi(2, 5), v = Math.random() * 0.03 + 0.02; for (let i = 0; i < n; i++) this.tone(f * rand(0.9, 1.1), 0.06, v, 'sine', i * 0.11, rand(0.7, 1.3)); },
  cricket() { if (!this.ctx) return; for (let i = 0; i < 6; i++) this.tone(4200, 0.03, 0.015, 'sine', i * 0.07); },
  explode(x, y) { const v = this.vol(x, y); this.noise(0.08, 4000, 0.5, 1.0 * v, 'lowpass', 0, 0, true); this.noise(1.3, 900, 0.5, 1.2 * v, 'lowpass', 0, 0.08, true); this.tone(48, 0.8, 0.8 * v, 'sine', 0, 0.4); },
  hit(x, y) { const v = this.vol(x, y); this.noise(0.06, 1800, 2, 0.35 * v, 'bandpass'); },
  thud(x, y) { const v = this.vol(x, y); this.noise(0.1, 500, 1, 0.4 * v, 'lowpass'); },
  swing() { this.noise(0.12, 2500, 1, 0.18, 'bandpass', 0, 0.4); },
  chop() { this.noise(0.09, 900, 1.5, 0.45, 'bandpass'); this.tone(180, 0.06, 0.15, 'triangle'); },
  mine() { this.noise(0.06, 3500, 3, 0.4, 'bandpass'); this.tone(900, 0.05, 0.12, 'triangle', 0, 0.7); },
  click() { this.tone(1800, 0.03, 0.12, 'square'); },
  empty() { this.tone(900, 0.04, 0.12, 'square'); },
  reload() { this.tone(500, 0.05, 0.12, 'square'); this.tone(320, 0.06, 0.12, 'square', 0.15); this.noise(0.05, 2000, 2, 0.2, 'bandpass', 0.3); },
  pickup() { this.tone(660, 0.06, 0.12, 'triangle'); this.tone(990, 0.08, 0.1, 'triangle', 0.05); },
  build() { this.noise(0.15, 700, 1, 0.5, 'lowpass'); this.tone(140, 0.12, 0.25, 'triangle'); },
  hurt() { this.tone(220, 0.18, 0.25, 'sawtooth', 0, 0.5); this.noise(0.12, 900, 1, 0.3); },
  growl(x, y) { const v = this.vol(x, y); this.tone(90, 0.45, 0.25 * v, 'sawtooth', 0, 0.7); this.noise(0.4, 400, 2, 0.15 * v, 'bandpass'); },
  bark(x, y) { const v = this.vol(x, y); this.tone(420, 0.1, 0.22 * v, 'sawtooth', 0, 0.6); this.tone(380, 0.1, 0.2 * v, 'sawtooth', 0.14, 0.6); },
  beep() { this.tone(1200, 0.08, 0.15, 'square'); },
  geiger() { this.noise(0.015, 5000, 5, 0.25, 'highpass'); },
  ui() { this.tone(520, 0.04, 0.08, 'triangle'); },
  horn() { this.tone(110, 1.6, 0.35, 'sawtooth', 0, 1.0); this.tone(165, 1.6, 0.2, 'sawtooth', 0, 1.0); },
  siren() { for (let i = 0; i < 3; i++) this.tone(380, 0.9, 0.22, 'sawtooth', i * 1.0, 1.8); },
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, 0.15, 'triangle', i * 0.1)); },
  lose() { [400, 300, 200, 120].forEach((f, i) => this.tone(f, 0.4, 0.2, 'sawtooth', i * 0.18)); },
  // ambient wind drone
  startAmbient(kind) {
    if (!this.ctx) return; this.stopAmbient();
    const c = this.ctx; const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = kind === 'night' ? 260 : 420; f.Q.value = 1.5;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.08; const lg = c.createGain(); lg.gain.value = 140; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    const g = c.createGain(); g.gain.value = kind === 'night' ? 0.1 : 0.07;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
    this.ambient = { src, lfo, g };
  },
  stopAmbient() { if (this.ambient) { try { this.ambient.src.stop(); this.ambient.lfo.stop(); } catch (e) { } this.ambient = null; } },
};

// ---------------------------------------------------------------------------
// PROCEDURAL ITEM ICONS (drawn once to canvas, cached as data URLs)
// ---------------------------------------------------------------------------
const Icons = {
  cache: {},
  url(id) {
    if (this.cache[id]) return this.cache[id];
    const def = ITEMS[id]; const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); g.lineCap = 'round'; g.lineJoin = 'round';
    try { (this.draw[def.icon] || this.draw.box).call(this.draw, g, def.col, def); } catch (e) { }
    return (this.cache[id] = c.toDataURL());
  },
  draw: {
    log(g, c) { g.fillStyle = c; g.save(); g.translate(32, 32); g.rotate(-0.5); g.fillRect(-24, -8, 44, 16); g.fillStyle = '#d8b880'; g.beginPath(); g.ellipse(20, 0, 5, 8, 0, 0, 7); g.fill(); g.strokeStyle = '#8a5a30'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(20, 0, 2.5, 4, 0, 0, 7); g.stroke(); g.restore(); g.save(); g.translate(30, 40); g.rotate(-0.2); g.fillStyle = c; g.fillRect(-20, -6, 36, 12); g.fillStyle = '#d8b880'; g.beginPath(); g.ellipse(16, 0, 4, 6, 0, 0, 7); g.fill(); g.restore(); },
    rock(g, c) { g.fillStyle = c; g.beginPath(); g.moveTo(12, 44); g.lineTo(18, 22); g.lineTo(34, 14); g.lineTo(50, 24); g.lineTo(54, 44); g.lineTo(36, 52); g.closePath(); g.fill(); g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.moveTo(18, 22); g.lineTo(34, 14); g.lineTo(36, 30); g.closePath(); g.fill(); },
    ore(g, c) { this.rock(g, '#7a7f86'); g.fillStyle = c; for (const [x, y] of [[24, 30], [38, 26], [32, 40], [44, 38], [20, 40]]) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); } },
    plate(g, c) { g.fillStyle = c; for (const [x, y, r] of [[14, 30, .2], [30, 22, -.3], [26, 40, .5], [42, 36, -.1]]) { g.save(); g.translate(x, y); g.rotate(r); g.fillRect(-9, -6, 18, 12); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(-9, 3, 18, 3); g.restore(); g.fillStyle = c; } },
    ingot(g, c) { g.fillStyle = c; g.beginPath(); g.moveTo(10, 42); g.lineTo(18, 26); g.lineTo(50, 26); g.lineTo(56, 42); g.closePath(); g.fill(); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(18, 26, 32, 5); },
    powder(g, c) { g.fillStyle = c; g.beginPath(); g.moveTo(8, 50); g.quadraticCurveTo(32, 6, 56, 50); g.closePath(); g.fill(); g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.arc(26, 34, 5, 0, 7); g.fill(); },
    gear(g, c) { g.fillStyle = c; g.save(); g.translate(32, 32); for (let i = 0; i < 8; i++) { g.rotate(Math.PI / 4); g.fillRect(-5, -24, 10, 10); } g.beginPath(); g.arc(0, 0, 17, 0, 7); g.fill(); g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(0, 0, 7, 0, 7); g.fill(); g.restore(); },
    cloth(g, c) { g.fillStyle = c; g.beginPath(); g.moveTo(10, 18); g.quadraticCurveTo(32, 10, 54, 18); g.lineTo(50, 48); g.quadraticCurveTo(32, 56, 14, 48); g.closePath(); g.fill(); g.strokeStyle = 'rgba(0,0,0,.2)'; g.lineWidth = 2; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(16 + i * 9, 18); g.lineTo(18 + i * 9, 48); g.stroke(); } },
    pipe(g, c) { g.strokeStyle = c; g.lineWidth = 11; g.beginPath(); g.moveTo(12, 50); g.lineTo(52, 14); g.stroke(); g.strokeStyle = 'rgba(255,255,255,.3)'; g.lineWidth = 3; g.beginPath(); g.moveTo(14, 45); g.lineTo(48, 14); g.stroke(); },
    spring(g, c) { g.strokeStyle = c; g.lineWidth = 4; g.beginPath(); for (let i = 0; i <= 40; i++) { const t = i / 40; g.lineTo(14 + t * 36 + Math.cos(t * 30) * 2, 32 + Math.sin(t * 30) * 12); } g.stroke(); },
    chip(g, c) { g.fillStyle = c; g.fillRect(10, 14, 44, 36); g.fillStyle = '#222'; g.fillRect(24, 24, 16, 16); g.fillStyle = '#d8b040'; for (let i = 0; i < 5; i++) { g.fillRect(14 + i * 8, 44, 3, 6); g.fillRect(14 + i * 8, 14, 3, 6); } },
    rope(g, c) { g.strokeStyle = c; g.lineWidth = 6; g.beginPath(); g.arc(32, 32, 18, 0, 7); g.stroke(); g.beginPath(); g.arc(32, 32, 10, 0, 7); g.stroke(); },
    tape(g, c) { g.fillStyle = c; g.beginPath(); g.arc(32, 32, 20, 0, 7); g.fill(); g.fillStyle = '#d0c8b0'; g.beginPath(); g.arc(32, 32, 9, 0, 7); g.fill(); },
    box(g, c) { g.fillStyle = c; g.fillRect(14, 16, 36, 34); g.fillStyle = '#c04030'; g.fillRect(14, 16, 36, 9); },
    bottle(g, c) { g.fillStyle = c; g.fillRect(24, 22, 16, 30); g.fillRect(28, 10, 8, 14); g.fillStyle = '#e8e0c8'; g.fillRect(24, 32, 16, 10); },
    watch(g, c) { g.fillStyle = '#5a4a3a'; g.fillRect(26, 6, 12, 52); g.fillStyle = c; g.beginPath(); g.arc(32, 32, 15, 0, 7); g.fill(); g.fillStyle = '#f0ead8'; g.beginPath(); g.arc(32, 32, 11, 0, 7); g.fill(); g.strokeStyle = '#222'; g.lineWidth = 2; g.beginPath(); g.moveTo(32, 32); g.lineTo(32, 24); g.moveTo(32, 32); g.lineTo(38, 34); g.stroke(); },
    chain(g, c) { g.strokeStyle = c; g.lineWidth = 4; for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(14 + i * 9, 20 + i * 6, 7, 4, i % 2 ? 1 : -0.3, 0, 7); g.stroke(); } },
    folder(g, c) { g.fillStyle = c; g.fillRect(10, 18, 44, 32); g.fillRect(10, 13, 18, 8); g.fillStyle = '#c03030'; g.fillRect(18, 30, 28, 6); },
    gpu(g, c) { g.fillStyle = '#2a2a2e'; g.fillRect(6, 18, 52, 26); g.fillStyle = c; g.fillRect(6, 44, 40, 6); g.fillStyle = '#555'; g.beginPath(); g.arc(22, 31, 9, 0, 7); g.arc(44, 31, 9, 0, 7); g.fill(); },
    idol(g, c) { g.fillStyle = c; g.beginPath(); g.arc(32, 18, 9, 0, 7); g.fill(); g.fillRect(24, 26, 16, 22); g.fillRect(18, 48, 28, 6); g.fillStyle = '#ff3a2a'; g.fillRect(28, 15, 3, 3); g.fillRect(34, 15, 3, 3); },
    bandage(g, c) { g.fillStyle = c; g.save(); g.translate(32, 32); g.rotate(-0.7); g.fillRect(-24, -9, 48, 18); g.fillStyle = '#c8b8a0'; g.fillRect(-8, -9, 16, 18); g.restore(); },
    medkit(g, c) { g.fillStyle = c; g.fillRect(10, 18, 44, 32); g.fillRect(24, 12, 16, 8); g.fillStyle = '#fff'; g.fillRect(28, 24, 8, 20); g.fillRect(22, 30, 20, 8); },
    syringe(g, c) { g.save(); g.translate(32, 32); g.rotate(-0.78); g.fillStyle = '#ddd'; g.fillRect(-20, -6, 30, 12); g.fillStyle = c; g.fillRect(-18, -4, 22, 8); g.fillStyle = '#999'; g.fillRect(10, -1.5, 16, 3); g.fillRect(-26, -8, 6, 16); g.restore(); },
    pill(g, c) { g.fillStyle = '#e8e8e0'; g.fillRect(18, 16, 28, 38); g.fillStyle = c; g.fillRect(18, 10, 28, 10); g.fillStyle = '#e0e040'; g.fillRect(22, 28, 20, 12); },
    can(g, c) { g.fillStyle = '#9aa0a6'; g.fillRect(16, 14, 32, 38); g.fillStyle = c; g.fillRect(16, 22, 32, 22); g.fillStyle = '#e8d8b0'; g.fillRect(22, 28, 20, 8); },
    ammo(g, c) { for (let i = 0; i < 3; i++) { const x = 18 + i * 12; g.fillStyle = c; g.fillRect(x, 28, 8, 22); g.fillStyle = '#b07a3a'; g.beginPath(); g.moveTo(x, 28); g.lineTo(x + 4, 16); g.lineTo(x + 8, 28); g.fill(); } },
    ammo2(g, c) { for (let i = 0; i < 3; i++) { const x = 18 + i * 12; g.fillStyle = c; g.fillRect(x, 24, 8, 30); g.fillStyle = '#c08a40'; g.beginPath(); g.moveTo(x, 24); g.lineTo(x + 4, 8); g.lineTo(x + 8, 24); g.fill(); } },
    shell(g, c) { for (let i = 0; i < 3; i++) { const x = 16 + i * 12; g.fillStyle = c; g.fillRect(x, 16, 10, 28); g.fillStyle = '#d0a040'; g.fillRect(x, 42, 10, 10); } },
    grenade(g, c) { g.fillStyle = c; g.beginPath(); g.ellipse(30, 38, 15, 18, 0, 0, 7); g.fill(); g.fillStyle = '#888'; g.fillRect(25, 14, 12, 8); g.strokeStyle = '#aaa'; g.lineWidth = 3; g.beginPath(); g.arc(44, 16, 6, 0, 7); g.stroke(); g.strokeStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.moveTo(16, 38); g.lineTo(44, 38); g.moveTo(30, 22); g.lineTo(30, 56); g.stroke(); },
    gunBase(g, c, barrel, stock, mag, h = 9) {
      g.fillStyle = c; g.fillRect(32 - barrel / 2 + 4, 24, barrel, h); // barrel/receiver
      if (stock) { g.fillStyle = '#6a4a2a'; g.beginPath(); g.moveTo(32 - barrel / 2 + 4, 24); g.lineTo(32 - barrel / 2 + 4 - stock, 30); g.lineTo(32 - barrel / 2 + 4 - stock, 38); g.lineTo(32 - barrel / 2 + 4, 33); g.fill(); }
      g.fillStyle = '#2a2a2a'; g.fillRect(28, 24 + h, 7, 14); // grip
      if (mag) { g.fillStyle = '#333'; g.fillRect(36, 24 + h, 6, mag); }
    },
    pistol(g, c) { this.gunBase(g, c, 28, 0, 0, 10); g.fillStyle = '#555'; g.fillRect(40, 26, 12, 4); },
    revolver(g, c) { this.gunBase(g, c, 30, 0, 0, 8); g.fillStyle = '#666'; g.beginPath(); g.arc(28, 30, 6, 0, 7); g.fill(); },
    shotgun(g, c) { g.save(); g.translate(32, 32); g.rotate(-0.3); g.translate(-32, -32); this.gunBase(g, c, 42, 14, 0, 7); g.fillStyle = '#222'; g.fillRect(16, 26, 40, 3); g.restore(); },
    smg(g, c) { g.save(); g.translate(32, 32); g.rotate(-0.2); g.translate(-32, -32); this.gunBase(g, c, 34, 8, 16, 10); g.restore(); },
    rifle(g, c) { g.save(); g.translate(32, 32); g.rotate(-0.35); g.translate(-32, -32); this.gunBase(g, c, 44, 14, 16, 8); g.fillStyle = '#c07a3a'; g.beginPath(); g.moveTo(36, 32); g.quadraticCurveTo(44, 40, 38, 50); g.lineTo(34, 48); g.quadraticCurveTo(38, 40, 33, 32); g.fill(); g.restore(); },
    sniper(g, c) { g.save(); g.translate(32, 32); g.rotate(-0.35); g.translate(-32, -32); this.gunBase(g, c, 48, 14, 0, 6); g.fillStyle = '#222'; g.fillRect(26, 17, 16, 6); g.restore(); },
    blade(g, c) { g.save(); g.translate(32, 32); g.rotate(-0.78); g.fillStyle = c; g.beginPath(); g.moveTo(-6, -4); g.lineTo(24, -4); g.lineTo(28, 2); g.lineTo(-6, 5); g.fill(); g.fillStyle = '#5a3a20'; g.fillRect(-24, -3, 18, 7); g.fillStyle = '#888'; g.fillRect(-7, -8, 3, 16); g.restore(); },
    axe(g, c) { g.save(); g.translate(32, 32); g.rotate(-0.6); g.fillStyle = '#7a5530'; g.fillRect(-26, -3, 48, 6); g.fillStyle = c; g.beginPath(); g.moveTo(10, -3); g.lineTo(22, -16); g.lineTo(26, 4); g.lineTo(14, 3); g.fill(); g.restore(); },
    pick(g, c) { g.save(); g.translate(32, 32); g.rotate(-0.6); g.fillStyle = '#7a5530'; g.fillRect(-26, -3, 48, 6); g.strokeStyle = c; g.lineWidth = 6; g.beginPath(); g.moveTo(16, -22); g.quadraticCurveTo(26, 0, 16, 22); g.stroke(); g.restore(); },
    vest(g, c) { g.fillStyle = c; g.beginPath(); g.moveTo(16, 10); g.lineTo(26, 10); g.lineTo(32, 18); g.lineTo(38, 10); g.lineTo(48, 10); g.lineTo(52, 54); g.lineTo(12, 54); g.closePath(); g.fill(); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(18, 30, 12, 10); g.fillRect(34, 30, 12, 10); },
    suit(g, c) { this.vest(g, c); g.fillStyle = '#222'; g.fillRect(24, 42, 16, 4); g.fillStyle = '#111'; g.beginPath(); g.arc(32, 10, 7, 0, 7); g.fill(); },
    helmet(g, c) { g.fillStyle = c; g.beginPath(); g.arc(32, 36, 20, Math.PI, 0); g.fill(); g.fillRect(8, 34, 48, 6); g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.arc(26, 28, 6, 0, 7); g.fill(); },
    mask(g, c) { g.fillStyle = c; g.beginPath(); g.ellipse(32, 30, 18, 20, 0, 0, 7); g.fill(); g.fillStyle = '#9ad'; g.beginPath(); g.arc(24, 26, 6, 0, 7); g.arc(40, 26, 6, 0, 7); g.fill(); g.fillStyle = '#333'; g.beginPath(); g.arc(32, 46, 8, 0, 7); g.fill(); },
    bag(g, c) { g.fillStyle = c; g.beginPath(); g.moveTo(14, 20); g.quadraticCurveTo(32, 8, 50, 20); g.lineTo(52, 54); g.lineTo(12, 54); g.closePath(); g.fill(); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(20, 34, 24, 14); g.strokeStyle = '#3a2a1a'; g.lineWidth = 3; g.beginPath(); g.arc(32, 16, 8, Math.PI, 0); g.stroke(); },
    card(g, c) { g.fillStyle = c; g.fillRect(10, 16, 44, 30); g.fillStyle = '#e8e0a0'; g.fillRect(14, 22, 10, 8); g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(14, 36, 34, 3); g.fillRect(28, 22, 20, 3); },
    art(g, c) { const gr = g.createRadialGradient(32, 32, 2, 32, 32, 26); gr.addColorStop(0, '#fff'); gr.addColorStop(0.3, c); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); g.fillStyle = c; g.beginPath(); for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2, r = i % 2 ? 9 : 16; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); } g.fill(); },
    bp(g, c) { g.fillStyle = c; g.fillRect(10, 10, 44, 44); g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2; g.strokeRect(16, 16, 32, 32); g.beginPath(); g.moveTo(16, 32); g.lineTo(48, 32); g.moveTo(32, 16); g.lineTo(32, 48); g.stroke(); },
  },
};

// ---------------------------------------------------------------------------
// SAVE
// ---------------------------------------------------------------------------
const Save = {
  KEY: 'zonefall_run_v2', META: 'zonefall_meta_v1',
  load() { try { return JSON.parse(localStorage.getItem(this.KEY)); } catch (e) { return null; } },
  write(data) { try { localStorage.setItem(this.KEY, JSON.stringify(data)); } catch (e) { } },
  clear() { try { localStorage.removeItem(this.KEY); } catch (e) { } },
  loadMeta() {
    let m = null; try { m = JSON.parse(localStorage.getItem(this.META)); } catch (e) { }
    return Object.assign({ points: 0, perks: [], best: 0, runs: 0, kills: 0, sound: true, tutDone: false }, m || {});
  },
  writeMeta(m) { try { localStorage.setItem(this.META, JSON.stringify(m)); } catch (e) { } },
};

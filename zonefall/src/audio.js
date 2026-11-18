// ============================================================================
// ZONEFALL — synthesized audio (WebAudio, no sound files). iOS needs unlock() on
// a gesture. Positional volume + stereo use Sfx.listener {x, z, yaw}.
//
//  Mix: sounds -> sfx bus (+ reverb send) ┐
//       ambience beds -> amb bus          ├-> master -> compressor -> out
//       music (music.js) -> music bus     ┘
//  The ambience is a living bed, not a loop: wind (stronger high up and in
//  storms), rain, surf near the sea, crickets at night, a hollow hum in caves.
// ============================================================================
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export const Sfx = {
  ctx: null, master: null, noiseBuf: null, enabled: true, volume: 0.8, ambient: null, listener: null, bed: null,
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.gain.value = 0.6 * this.volume;
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
      this.muffle = c.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000; this.muffle.Q.value = 0.5;
      this.master.connect(this.muffle); this.muffle.connect(comp); comp.connect(c.destination);
      this.sfx = c.createGain(); this.sfx.connect(this.master);
      this.amb = c.createGain(); this.amb.gain.value = 0.9; this.amb.connect(this.master);
      this.musicOut = c.createGain(); this.musicOut.gain.value = 2.4; this.musicOut.connect(this.master);
      const len = c.sampleRate * 2; this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // brown-ish noise for rumbles, surf and wind (smoother than white)
      this.brownBuf = c.createBuffer(1, len, c.sampleRate); const bd = this.brownBuf.getChannelData(0); let last = 0;
      for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
      // reverb: a stereo impulse with an early-reflection bump
      const rl = c.sampleRate * 2.2, ir = c.createBuffer(2, rl, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const dd = ir.getChannelData(ch); for (let i = 0; i < rl; i++) { const k = i / rl; dd[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, 3.4) * (i < c.sampleRate * 0.03 ? 1.6 : 1); } }
      const conv = c.createConvolver(); conv.buffer = ir; this.rev = c.createGain(); this.rev.gain.value = 0.32; this.rev.connect(conv); conv.connect(this.master);
      const s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, 22050); s.connect(this.master); s.start(0);
    } catch (e) { this.ctx = null; }
  },
  /** under water: everything goes dull and distant */
  setMuffle(on) { if (!this.muffle || this._muf === !!on) return; this._muf = !!on; this.muffle.frequency.setTargetAtTime(on ? 650 : 20000, this.ctx.currentTime, 0.12); },
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = 0.6 * v; },
  vol(x, z, range = 60) {
    if (x === undefined || !this.listener) { this._pan = 0; return 1; }
    const L = this.listener; const dx = x - L.x, dz = z - L.z; const d = Math.hypot(dx, dz);
    const yaw = L.yaw ?? L.ang ?? 0; const rel = Math.atan2(dz, dx) - yaw;
    this._pan = d > 0.8 ? clamp(Math.sin(rel) * 0.85, -0.85, 0.85) : 0; this._panT = this.ctx ? this.ctx.currentTime : 0;
    this._dist = d;
    return clamp(1 - d / range, 0, 1) ** 1.6;
  },
  _out(node) { // to the sfx bus, through a stereo panner for positional sounds triggered in this same tick
    const c = this.ctx, bus = this.sfx || this.master;
    if (this._pan && c.createStereoPanner && this._panT === c.currentTime) { const p = c.createStereoPanner(); p.pan.value = this._pan; node.connect(p); p.connect(bus); return p; }
    node.connect(bus); return node;
  },
  noise(dur, freq, q, gain, type = 'lowpass', t0 = 0, sweep = 0, rev = false, buf = null, att = 0) {
    if (!this.ctx || !this.enabled || gain < 0.008) return;
    const c = this.ctx, t = c.currentTime + t0;
    const src = c.createBufferSource(); src.buffer = buf || this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    const g = c.createGain();
    if (att) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + att); } else g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + att + dur);
    src.connect(f); f.connect(g); this._out(g); if (rev && this.rev) g.connect(this.rev); src.start(t, Math.random() * 1.2); src.stop(t + att + dur + 0.05);
  },
  tone(freq, dur, gain, type = 'square', t0 = 0, slide = 0, rev = false) {
    if (!this.ctx || !this.enabled || gain < 0.008) return;
    const c = this.ctx, t = c.currentTime + t0;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); this._out(g); if (rev && this.rev) g.connect(this.rev); o.start(t); o.stop(t + dur + 0.05);
  },
  // ---------------------------------------------------------------- weapons
  /** gunshots: a sharp crack, a body, a low thump up close, and an echo off the land when it's far */
  shot(kind, x, z) {
    const v = this.vol(x, z, 150); if (v <= 0) return; const pan = this._pan, panT = this._panT;
    const far = x !== undefined ? clamp(1 - v, 0, 1) : 0, lp = 1 - far * 0.7, near = 1 - far;
    const P = {
      shotgun: [1.0, 1400, 0.45, 62, 0.6, 0.55], rifle: [0.85, 2300, 0.26, 95, 0.45, 0.4], sniper: [1.0, 2500, 0.6, 72, 0.6, 0.65],
      smg: [0.55, 2900, 0.12, 120, 0.25, 0.25], pistol: [0.65, 2100, 0.17, 140, 0.3, 0.3],
    }[kind] || [0.65, 2100, 0.17, 140, 0.3, 0.3];
    if (kind === 'turret') { this.noise(0.07, 4200, 1.2, 0.35 * v, 'bandpass', 0, 0, true); this.noise(0.1, 900, 0.8, 0.25 * v, 'lowpass'); return; }
    if (kind === 'bow') { this.tone(190, 0.14, 0.22 * v, 'triangle', 0, 0.55); this.noise(0.14, 1900, 2, 0.22 * v, 'bandpass', 0, 0.45); this.noise(0.05, 600, 1, 0.15 * v, 'lowpass'); return; }
    if (kind === 'rocket') { this.noise(0.12, 2600, 0.6, 0.6 * v, 'lowpass', 0, 0, true); this.noise(1.1, 700, 0.7, 0.75 * v, 'lowpass', 0.03, 2.8, true); this.tone(120, 0.5, 0.28 * v, 'sawtooth', 0, 0.45); return; }
    const [loud, body, tail, thump, thumpG, echo] = P;
    this.noise(0.018, 7500 * lp, 0.4, 0.75 * loud * v * (0.4 + near * 0.6), 'highpass');                 // crack
    this.noise(tail, body * lp, 0.7, 0.85 * loud * v, 'lowpass', 0, 0.18, true);                         // body
    this.noise(0.05, 5200 * lp, 0.6, 0.5 * loud * v, 'lowpass', 0.004);
    if (near > 0.35) this.tone(thump, 0.16 + tail * 0.3, thumpG * v * near, 'sine', 0, 0.42);           // thump in the chest
    if (near > 0.6) this.noise(0.03, 3400, 3, 0.1 * v, 'bandpass', 0.06);                              // the action cycling
    if (far > 0.25 || echo > 0.5) { this._pan = pan * -0.6; this._panT = panT; this.noise(0.5 + tail, 700, 0.6, echo * 0.28 * Math.max(v, 0.2) * (0.5 + far), 'lowpass', 0.12 + far * 0.35, 0.5, true, this.brownBuf); }
  },
  explode(x, z, big = 1) {
    const v = this.vol(x, z, 220); if (v <= 0) return; const near = v;
    this.noise(0.1, 4500, 0.5, 1.0 * v, 'lowpass', 0, 0, true);
    this.noise(1.6 * big, 1000, 0.5, 1.15 * v, 'lowpass', 0, 0.07, true);
    this.noise(2.4 * big, 180, 0.7, 0.9 * v, 'lowpass', 0.05, 0.6, false, this.brownBuf, 0.02);           // rolling rumble
    this.tone(46, 1.0, 0.85 * v * (0.3 + near * 0.7), 'sine', 0, 0.42);
    for (let i = 0; i < 7; i++) this.noise(0.05, rand(1800, 4200), 2, rand(0.06, 0.16) * v, 'bandpass', rand(0.15, 1.1)); // debris pattering down
  },
  hit(x, z) { const v = this.vol(x, z); this.noise(0.05, 2200, 1.6, 0.3 * v, 'bandpass'); this.noise(0.08, 500, 1, 0.25 * v, 'lowpass'); },
  hitmark(crit) { this.tone(crit ? 1650 : 1180, 0.035, 0.06, 'square'); this.noise(0.03, 5000, 2, 0.06, 'bandpass'); if (crit) this.tone(2400, 0.06, 0.04, 'triangle', 0.03); },
  thud(x, z) { const v = this.vol(x, z); this.noise(0.12, 450, 1, 0.42 * v, 'lowpass'); this.tone(85, 0.1, 0.18 * v, 'sine', 0, 0.6); },
  clang(x, z) { const v = this.vol(x, z); this.tone(rand(700, 900), 0.22, 0.16 * v, 'triangle', 0, 0.9); this.tone(rand(1900, 2300), 0.12, 0.05 * v, 'sine'); this.noise(0.05, 4000, 3, 0.25 * v, 'bandpass'); },
  swing() { this.noise(0.14, 2400, 1, 0.15, 'bandpass', 0, 0.35, false, null, 0.03); },
  chop(x, z) { const v = this.vol(x, z); this.noise(0.09, 900, 1.5, 0.45 * v, 'bandpass'); this.tone(170, 0.08, 0.16 * v, 'triangle', 0, 0.8); this.noise(0.15, 2600, 3, 0.05 * v, 'bandpass', 0.04); },
  mine(x, z) { const v = this.vol(x, z); this.noise(0.06, 3500, 3, 0.4 * v, 'bandpass'); this.tone(900, 0.06, 0.12 * v, 'triangle', 0, 0.7); this.noise(0.25, 1200, 1, 0.07 * v, 'lowpass', 0.05); },
  treefall(x, z) { const v = this.vol(x, z, 80); this.noise(0.5, 1500, 2, 0.12 * v, 'bandpass', 0, 0.5); this.noise(1.1, 400, 0.8, 0.5 * v, 'lowpass', 0.2, 0.3); this.noise(0.4, 160, 1, 0.7 * v, 'lowpass', 1.1, 0, false, this.brownBuf); this.tone(55, 0.4, 0.3 * v, 'sine', 1.1, 0.6); },
  click() { this.tone(1800, 0.03, 0.1, 'square'); },
  empty() { this.tone(900, 0.04, 0.12, 'square'); this.noise(0.02, 3000, 3, 0.08, 'bandpass', 0.02); },
  reload() { // mag out, mag in, the bolt
    this.noise(0.05, 1800, 3, 0.18, 'bandpass'); this.tone(420, 0.04, 0.08, 'square');
    this.noise(0.06, 900, 2, 0.22, 'bandpass', 0.32); this.tone(260, 0.05, 0.1, 'square', 0.33);
    this.noise(0.08, 2600, 2.5, 0.2, 'bandpass', 0.55, 0.6); this.tone(700, 0.04, 0.07, 'square', 0.62);
  },
  // ---------------------------------------------------------------- body + world
  /** footsteps: heel then toe, by surface */
  step(surface) {
    this._pan = 0; const k = 0.8 + Math.random() * 0.4;
    const S = { grass: [1600, 0.6, 0.045, 'bandpass'], sand: [900, 0.7, 0.05, 'lowpass'], snow: [1300, 0.8, 0.06, 'bandpass'], wood: [700, 1.4, 0.06, 'bandpass'], metal: [1900, 2.2, 0.05, 'bandpass'], stone: [2400, 1.2, 0.045, 'bandpass'], water: [1100, 0.7, 0.07, 'lowpass'] }[surface] || [600, 1.2, 0.05, 'bandpass'];
    this.noise(0.05, S[0] * k, S[1], S[2] * k, S[3]); this.noise(0.04, S[0] * 1.3 * k, S[1], S[2] * 0.6 * k, S[3], 0.055);
    if (surface === 'wood') this.tone(150 * k, 0.06, 0.04, 'triangle');
    if (surface === 'metal') this.tone(rand(380, 520), 0.08, 0.025, 'triangle');
    if (surface === 'water') this.noise(0.18, 1500, 0.8, 0.05, 'lowpass', 0.02, 0.5);
    if (surface === 'snow' || surface === 'sand') this.noise(0.07, 3500, 1, 0.02, 'highpass', 0.01);
  },
  stepAt(x, z, surface) { const v = this.vol(x, z, 28); if (v < 0.03) return; const f = surface === 'wood' ? 700 : surface === 'metal' ? 1600 : 650; this.noise(0.05, f, 1.2, (0.05 + Math.random() * 0.03) * v * 1.4, 'bandpass'); this.noise(0.04, f * 1.3, 1.2, 0.03 * v, 'bandpass', 0.06); },
  /** bird song: a few warbling, sliding whistles */
  chirp() {
    if (!this.ctx) return; const kind = randi(0, 2), f = rand(2200, 3800), n = randi(2, 6), v = rand(0.018, 0.04);
    this._pan = rand(-0.7, 0.7); this._panT = this.ctx.currentTime;
    for (let i = 0; i < n; i++) {
      const t0 = i * (kind === 0 ? 0.11 : kind === 1 ? 0.18 : 0.07) + rand(0, 0.02);
      if (kind === 1) this.tone(f * rand(0.85, 1.05), 0.14, v, 'sine', t0, rand(1.2, 1.5)); else this.tone(f * rand(0.92, 1.08), 0.06, v, 'sine', t0, rand(0.6, 1.35));
    }
  },
  cricket() { if (!this.ctx) return; this._pan = rand(-0.8, 0.8); this._panT = this.ctx.currentTime; const f = rand(3900, 4600); for (let i = 0; i < 6; i++) this.tone(f, 0.03, 0.013, 'sine', i * 0.07); },
  owl() { if (!this.ctx) return; this._pan = rand(-0.8, 0.8); this._panT = this.ctx.currentTime; this.tone(420, 0.35, 0.035, 'sine', 0, 0.92); this.tone(400, 0.55, 0.03, 'sine', 0.55, 0.9); },
  wave() { this.noise(2.4, 520, 0.6, 0.05, 'lowpass', 0, 0.4, false, null, 0.6); },
  drip() { if (!this.ctx) return; this._pan = rand(-0.6, 0.6); this._panT = this.ctx.currentTime; const f = rand(900, 1800); this.tone(f, 0.08, 0.05, 'sine', 0, 1.6, true); },
  heart(k = 1) { this._pan = 0; this.tone(58, 0.12, 0.22 * k, 'sine', 0, 0.7); this.tone(52, 0.14, 0.16 * k, 'sine', 0.2, 0.7); },
  hurt() { this.tone(210, 0.2, 0.2, 'sawtooth', 0, 0.55); this.noise(0.12, 900, 1, 0.26); this.noise(0.15, 650, 4, 0.08, 'bandpass', 0.02); },
  pickup() { this.tone(660, 0.06, 0.1, 'triangle'); this.tone(990, 0.09, 0.09, 'triangle', 0.05); this.tone(1320, 0.07, 0.03, 'sine', 0.1); },
  build() { this.noise(0.15, 700, 1, 0.5, 'lowpass'); this.tone(140, 0.12, 0.25, 'triangle'); this.noise(0.06, 2600, 3, 0.1, 'bandpass', 0.05); },
  upgrade() { this.noise(0.2, 1200, 1, 0.45, 'bandpass'); this.tone(220, 0.1, 0.2, 'triangle'); this.tone(330, 0.12, 0.2, 'triangle', 0.1); this.tone(440, 0.14, 0.12, 'triangle', 0.2); },
  eat() { for (let i = 0; i < 3; i++) this.noise(0.06, 1200, 2, 0.2, 'bandpass', i * 0.16); },
  drink() { for (let i = 0; i < 3; i++) this.tone(420 + i * 60, 0.08, 0.1, 'sine', i * 0.15, 0.7); },
  splash(x, z) { const v = this.vol(x, z); this.noise(0.35, 1400, 0.8, 0.3 * v, 'lowpass', 0, 0.45); this.noise(0.25, 3200, 1.2, 0.08 * v, 'bandpass', 0.05, 0.6); },
  doorOpen(x, z, metal) { const v = this.vol(x, z, 40); if (metal) { this.noise(0.4, 1100, 4, 0.25 * v, 'bandpass', 0, 0.6); this.tone(90, 0.3, 0.12 * v, 'sawtooth', 0, 1.3); } else { this.tone(rand(380, 460), 0.35, 0.08 * v, 'sawtooth', 0, 1.35); this.noise(0.08, 900, 2, 0.2 * v, 'bandpass'); } },
  doorClose(x, z, metal) { const v = this.vol(x, z, 40); this.noise(0.12, metal ? 900 : 500, 1, 0.45 * v, 'lowpass', 0, 0, true); this.tone(metal ? 160 : 110, 0.1, 0.2 * v, 'triangle'); this.noise(0.04, 3000, 3, 0.2 * v, 'bandpass', 0.06); },
  locked(x, z) { const v = this.vol(x, z, 30); for (let i = 0; i < 2; i++) this.noise(0.05, 2400, 3, 0.25 * v, 'bandpass', i * 0.09); },
  card() { this.tone(880, 0.08, 0.1, 'square'); this.tone(1320, 0.12, 0.1, 'square', 0.1); },
  deny() { this.tone(200, 0.16, 0.12, 'square'); this.tone(150, 0.18, 0.1, 'square', 0.08); },
  lever() { this.noise(0.1, 600, 2, 0.4, 'bandpass'); this.tone(120, 0.15, 0.2, 'square', 0.05); this.noise(0.05, 2200, 3, 0.15, 'bandpass', 0.18); },
  growl(x, z) { const v = this.vol(x, z); this.tone(90, 0.5, 0.22 * v, 'sawtooth', 0, 0.7); this.noise(0.45, 380, 2.5, 0.16 * v, 'bandpass', 0, 0.8); },
  howl(x, z) { const v = this.vol(x, z, 140); this.tone(360, 1.8, 0.11 * v, 'sine', 0, 1.55, true); this.tone(540, 1.3, 0.04 * v, 'sine', 0.25, 1.3, true); },
  roar(x, z) { const v = this.vol(x, z, 80); this.tone(70, 0.9, 0.32 * v, 'sawtooth', 0, 0.6); this.noise(0.9, 300, 1, 0.3 * v, 'lowpass'); this.noise(0.7, 900, 3, 0.08 * v, 'bandpass', 0.05, 0.5); },
  grunt(x, z) { const v = this.vol(x, z); this.tone(110, 0.2, 0.18 * v, 'sawtooth', 0, 0.7); this.noise(0.15, 700, 4, 0.06 * v, 'bandpass'); },
  cluck(x, z) { const v = this.vol(x, z, 25); this.tone(900, 0.06, 0.08 * v, 'square', 0, 0.7); this.tone(800, 0.06, 0.08 * v, 'square', 0.1, 0.7); },
  voice(x, z) { const v = this.vol(x, z, 45); const f = rand(140, 220); this.tone(f, 0.18, 0.07 * v, 'sawtooth', 0, 1.2); this.tone(f * 0.9, 0.2, 0.05 * v, 'sawtooth', 0.2, 0.8); this.noise(0.3, f * 4, 5, 0.03 * v, 'bandpass'); },
  beep(x, z) { const v = x === undefined ? 1 : this.vol(x, z, 30); this.tone(1200, 0.08, 0.15 * v, 'square'); },
  geiger(k = 1) { this.noise(0.012, 5200, 5, 0.25 * k, 'highpass'); },
  ui() { this.tone(560, 0.035, 0.06, 'triangle'); this.tone(840, 0.03, 0.03, 'sine', 0.02); },
  horn() { this.tone(110, 1.6, 0.32, 'sawtooth', 0, 1.0, true); this.tone(165, 1.6, 0.18, 'sawtooth', 0, 1.0, true); },
  siren() { for (let i = 0; i < 3; i++) this.tone(380, 0.9, 0.2, 'sawtooth', i * 1.0, 1.8, true); },
  plane() { this.noise(6, 180, 1, 0.18, 'lowpass', 0, 1.2, false, this.brownBuf, 1.2); this.tone(70, 6, 0.07, 'sawtooth', 0, 1.05); },
  win() { [523, 659, 784, 1046].forEach((f, i) => { this.tone(f, 0.3, 0.13, 'triangle', i * 0.1); this.tone(f * 2, 0.2, 0.03, 'sine', i * 0.1); }); },
  lose() { [400, 300, 200, 120].forEach((f, i) => this.tone(f, 0.4, 0.18, 'sawtooth', i * 0.18)); },
  craft() { this.noise(0.08, 1500, 2, 0.2, 'bandpass'); this.tone(600, 0.08, 0.1, 'triangle', 0.08); this.noise(0.05, 2800, 3, 0.08, 'bandpass', 0.16); },
  // ---------------------------------------------------------------- the ambience bed
  startAmbient(kind) { this.ambKind = kind; }, // kept for old callers: the bed follows the world by itself
  stopAmbient() { this.ambKind = null; },
  /** per frame from the game: st = { night, rain, snow, wind, coast, cave, alt, indoor, on } (0..1 each) */
  ambience(dt, st) {
    const c = this.ctx; if (!c || !this.amb) return;
    if (!this.bed) {
      const mk = (buf, type, f, q, lfoHz, lfoAmt) => {
        const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = 0; s.loopEnd = buf.duration;
        const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
        const g = c.createGain(); g.gain.value = 0.0001; s.connect(fl); fl.connect(g); g.connect(this.amb); s.start(0, Math.random() * buf.duration);
        if (lfoHz) { const l = c.createOscillator(); l.frequency.value = lfoHz; const lg = c.createGain(); lg.gain.value = lfoAmt; l.connect(lg); lg.connect(fl.frequency); l.start(); }
        return { s, fl, g };
      };
      this.bed = {
        wind: mk(this.brownBuf, 'bandpass', 420, 0.7, 0.07, 220),
        gust: mk(this.noiseBuf, 'bandpass', 900, 1.6, 0.13, 500),
        rain: mk(this.noiseBuf, 'highpass', 2600, 0.4, 0, 0),
        rainLow: mk(this.brownBuf, 'lowpass', 900, 0.5, 0, 0),
        surf: mk(this.brownBuf, 'lowpass', 600, 0.6, 0.09, 260),
        night: mk(this.noiseBuf, 'bandpass', 4300, 6, 0.6, 400),
        cave: mk(this.brownBuf, 'lowpass', 160, 1.2, 0.05, 40),
      };
      // the surf swells in and out
      const sw = c.createOscillator(); sw.frequency.value = 0.11; const sg = c.createGain(); sg.gain.value = 0.5; sw.connect(sg); this.bed.surfSwell = c.createGain(); this.bed.surf.g.disconnect(); this.bed.surf.g.connect(this.bed.surfSwell); this.bed.surfSwell.connect(this.amb); sg.connect(this.bed.surfSwell.gain); sw.start();
    }
    const on = this.enabled && st.on !== false ? 1 : 0, B = this.bed, now = c.currentTime, T = 0.8;
    const set = (L, v) => L.g.gain.setTargetAtTime(Math.max(0.0001, v * on), now, T);
    const windK = clamp(0.25 + (st.alt || 0) * 0.6 + (st.wind || 0) * 0.7, 0, 1.4) * (1 - (st.cave || 0) * 0.85) * (1 - (st.indoor || 0) * 0.6);
    set(B.wind, 0.11 * windK); set(B.gust, 0.025 * windK * windK);
    const rain = (st.rain || 0) * (1 - (st.snow || 0)) * (1 - (st.cave || 0));
    set(B.rain, 0.05 * rain); set(B.rainLow, 0.06 * rain);
    set(B.surf, 0.14 * (st.coast || 0) * (1 - (st.cave || 0)));
    set(B.night, 0.006 * (st.night || 0) * (1 - (st.rain || 0)) * (1 - (st.cave || 0)) * (1 - (st.snow || 0)));
    set(B.cave, 0.16 * (st.cave || 0));
    // spot sounds
    this.spotT = (this.spotT || 0) - dt;
    if (this.spotT <= 0 && on) {
      this.spotT = rand(2.5, 7);
      if (st.cave > 0.5) { this.drip(); if (Math.random() < 0.5) setTimeout(() => this.drip(), rand(200, 900)); }
      else if (st.rain > 0.4) { /* the rain covers the birds */ }
      else if (st.night > 0.6) { this.cricket(); if (Math.random() < 0.12) this.owl(); }
      else if (st.birds) this.chirp();
      if (st.coast > 0.5 && Math.random() < 0.4) this.wave();
    }
  },
};

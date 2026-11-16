// ============================================================================
// ZONEFALL 3 — synthesized audio (WebAudio). iOS needs unlock() on a gesture.
// Positional volume uses Sfx.listener {x, z}.
// ============================================================================
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export const Sfx = {
  ctx: null, master: null, noiseBuf: null, enabled: true, volume: 0.8, ambient: null, listener: null,
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = 0.6 * this.volume;
      const comp = this.ctx.createDynamicsCompressor(); this.master.connect(comp); comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.2; this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const rl = this.ctx.sampleRate * 1.8, ir = this.ctx.createBuffer(2, rl, this.ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const dd = ir.getChannelData(ch); for (let i = 0; i < rl; i++) dd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3.2); }
      const conv = this.ctx.createConvolver(); conv.buffer = ir; this.rev = this.ctx.createGain(); this.rev.gain.value = 0.3; this.rev.connect(conv); conv.connect(this.master);
      const s = this.ctx.createBufferSource(); s.buffer = this.ctx.createBuffer(1, 1, 22050); s.connect(this.master); s.start(0);
    } catch (e) { this.ctx = null; }
  },
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = 0.6 * v; },
  vol(x, z, range = 60) {
    if (x === undefined || !this.listener) return 1;
    const d = Math.hypot(x - this.listener.x, z - this.listener.z);
    return clamp(1 - d / range, 0, 1) ** 1.6;
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
  shot(kind, x, z) {
    const v = this.vol(x, z, 110); if (v <= 0) return; const far = x !== undefined ? 1 - v : 0; const lp = 1 - far * 0.6;
    if (kind === 'shotgun') { this.noise(0.05, 5000 * lp, 0.5, 0.9 * v, 'lowpass', 0, 0, true); this.noise(0.4, 1500 * lp, 0.7, 0.9 * v, 'lowpass', 0, 0.15, true); this.tone(65, 0.22, 0.55 * v, 'sine', 0, 0.45); }
    else if (kind === 'rifle') { this.noise(0.04, 6000 * lp, 0.5, 0.8 * v, 'lowpass', 0, 0, true); this.noise(0.24, 2400 * lp, 0.8, 0.75 * v, 'lowpass', 0, 0.2, true); this.tone(105, 0.12, 0.4 * v, 'square', 0, 0.35); }
    else if (kind === 'sniper') { this.noise(0.05, 7000 * lp, 0.5, 0.9 * v, 'lowpass', 0, 0, true); this.noise(0.6, 2600 * lp, 0.6, 0.95 * v, 'lowpass', 0, 0.1, true); this.tone(75, 0.35, 0.55 * v, 'sine', 0, 0.35); }
    else if (kind === 'smg') { this.noise(0.03, 6000 * lp, 0.5, 0.5 * v, 'lowpass', 0, 0, true); this.noise(0.12, 3000 * lp, 0.9, 0.5 * v, 'lowpass', 0, 0.3, true); }
    else if (kind === 'turret') { this.noise(0.08, 4200, 1.2, 0.35 * v, 'bandpass', 0, 0, true); }
    else if (kind === 'bow') { this.tone(180, 0.12, 0.25 * v, 'triangle', 0, 0.6); this.noise(0.12, 1800, 2, 0.25 * v, 'bandpass', 0, 0.5); }
    else if (kind === 'rocket') { this.noise(0.9, 900, 0.7, 0.8 * v, 'lowpass', 0, 2.5, true); this.tone(140, 0.4, 0.3 * v, 'sawtooth', 0, 0.5); }
    else { this.noise(0.04, 5000 * lp, 0.5, 0.6 * v, 'lowpass', 0, 0, true); this.noise(0.16, 2200 * lp, 0.9, 0.6 * v, 'lowpass', 0, 0.3, true); this.tone(150, 0.08, 0.25 * v, 'square', 0, 0.5); }
  },
  step(surface) { const f = surface === 'wood' ? 700 : surface === 'metal' ? 1600 : surface === 'snow' ? 450 : surface === 'sand' ? 380 : 600; this.noise(0.05, f, 1.2, 0.05 + Math.random() * 0.03, 'bandpass'); },
  chirp() { if (!this.ctx) return; const f = rand(2400, 3800), n = randi(2, 5), v = Math.random() * 0.03 + 0.02; for (let i = 0; i < n; i++) this.tone(f * rand(0.9, 1.1), 0.06, v, 'sine', i * 0.11, rand(0.7, 1.3)); },
  cricket() { if (!this.ctx) return; for (let i = 0; i < 6; i++) this.tone(4200, 0.03, 0.015, 'sine', i * 0.07); },
  wave() { this.noise(2.2, 500, 0.6, 0.05, 'lowpass', 0, 0.4); },
  explode(x, z, big = 1) { const v = this.vol(x, z, 160); this.noise(0.08, 4000, 0.5, 1.0 * v, 'lowpass', 0, 0, true); this.noise(1.3 * big, 900, 0.5, 1.2 * v, 'lowpass', 0, 0.08, true); this.tone(48, 0.8, 0.8 * v, 'sine', 0, 0.4); },
  hit(x, z) { const v = this.vol(x, z); this.noise(0.06, 1800, 2, 0.35 * v, 'bandpass'); },
  thud(x, z) { const v = this.vol(x, z); this.noise(0.1, 500, 1, 0.4 * v, 'lowpass'); },
  clang(x, z) { const v = this.vol(x, z); this.tone(rand(700, 900), 0.18, 0.18 * v, 'triangle', 0, 0.9); this.noise(0.05, 4000, 3, 0.25 * v, 'bandpass'); },
  swing() { this.noise(0.12, 2500, 1, 0.16, 'bandpass', 0, 0.4); },
  chop(x, z) { const v = this.vol(x, z); this.noise(0.09, 900, 1.5, 0.45 * v, 'bandpass'); this.tone(180, 0.06, 0.15 * v, 'triangle'); },
  mine(x, z) { const v = this.vol(x, z); this.noise(0.06, 3500, 3, 0.4 * v, 'bandpass'); this.tone(900, 0.05, 0.12 * v, 'triangle', 0, 0.7); },
  treefall(x, z) { const v = this.vol(x, z); this.noise(1.1, 400, 0.8, 0.5 * v, 'lowpass', 0, 0.3); this.noise(0.3, 200, 1, 0.6 * v, 'lowpass', 0.9); },
  click() { this.tone(1800, 0.03, 0.12, 'square'); },
  empty() { this.tone(900, 0.04, 0.12, 'square'); },
  reload() { this.tone(500, 0.05, 0.12, 'square'); this.tone(320, 0.06, 0.12, 'square', 0.15); this.noise(0.05, 2000, 2, 0.2, 'bandpass', 0.3); },
  pickup() { this.tone(660, 0.06, 0.12, 'triangle'); this.tone(990, 0.08, 0.1, 'triangle', 0.05); },
  build() { this.noise(0.15, 700, 1, 0.5, 'lowpass'); this.tone(140, 0.12, 0.25, 'triangle'); },
  upgrade() { this.noise(0.2, 1200, 1, 0.45, 'bandpass'); this.tone(220, 0.1, 0.2, 'triangle'); this.tone(330, 0.12, 0.2, 'triangle', 0.1); },
  hurt() { this.tone(220, 0.18, 0.25, 'sawtooth', 0, 0.5); this.noise(0.12, 900, 1, 0.3); },
  eat() { for (let i = 0; i < 3; i++) this.noise(0.06, 1200, 2, 0.2, 'bandpass', i * 0.16); },
  drink() { for (let i = 0; i < 3; i++) this.tone(420 + i * 60, 0.08, 0.1, 'sine', i * 0.15, 0.7); },
  splash(x, z) { const v = this.vol(x, z); this.noise(0.3, 1400, 0.8, 0.3 * v, 'lowpass', 0, 0.5); },
  doorOpen(x, z, metal) { const v = this.vol(x, z, 40); if (metal) { this.noise(0.4, 1100, 4, 0.25 * v, 'bandpass', 0, 0.6); this.tone(90, 0.3, 0.12 * v, 'sawtooth', 0, 1.3); } else { this.tone(rand(380, 460), 0.35, 0.08 * v, 'sawtooth', 0, 1.35); this.noise(0.08, 900, 2, 0.2 * v, 'bandpass'); } },
  doorClose(x, z, metal) { const v = this.vol(x, z, 40); this.noise(0.12, metal ? 900 : 500, 1, 0.45 * v, 'lowpass'); this.tone(metal ? 160 : 110, 0.1, 0.2 * v, 'triangle'); this.noise(0.04, 3000, 3, 0.2 * v, 'bandpass', 0.06); },
  locked(x, z) { const v = this.vol(x, z, 30); for (let i = 0; i < 2; i++) this.noise(0.05, 2400, 3, 0.25 * v, 'bandpass', i * 0.09); },
  card() { this.tone(880, 0.08, 0.12, 'square'); this.tone(1320, 0.12, 0.12, 'square', 0.1); },
  deny() { this.tone(200, 0.2, 0.15, 'square'); },
  lever() { this.noise(0.1, 600, 2, 0.4, 'bandpass'); this.tone(120, 0.15, 0.2, 'square', 0.05); },
  growl(x, z) { const v = this.vol(x, z); this.tone(90, 0.45, 0.25 * v, 'sawtooth', 0, 0.7); this.noise(0.4, 400, 2, 0.15 * v, 'bandpass'); },
  howl(x, z) { const v = this.vol(x, z, 120); this.tone(380, 1.6, 0.12 * v, 'sine', 0, 1.5); this.tone(570, 1.2, 0.05 * v, 'sine', 0.2, 1.3); },
  roar(x, z) { const v = this.vol(x, z, 80); this.tone(70, 0.9, 0.35 * v, 'sawtooth', 0, 0.6); this.noise(0.9, 300, 1, 0.3 * v, 'lowpass'); },
  grunt(x, z) { const v = this.vol(x, z); this.tone(110, 0.2, 0.2 * v, 'sawtooth', 0, 0.7); },
  cluck(x, z) { const v = this.vol(x, z, 25); this.tone(900, 0.06, 0.08 * v, 'square', 0, 0.7); this.tone(800, 0.06, 0.08 * v, 'square', 0.1, 0.7); },
  voice(x, z) { const v = this.vol(x, z, 45); const f = rand(140, 220); this.tone(f, 0.18, 0.08 * v, 'sawtooth', 0, 1.2); this.tone(f * 0.9, 0.2, 0.06 * v, 'sawtooth', 0.2, 0.8); },
  beep(x, z) { const v = x === undefined ? 1 : this.vol(x, z, 30); this.tone(1200, 0.08, 0.15 * v, 'square'); },
  geiger(k = 1) { this.noise(0.015, 5000, 5, 0.25 * k, 'highpass'); },
  ui() { this.tone(520, 0.04, 0.08, 'triangle'); },
  horn() { this.tone(110, 1.6, 0.35, 'sawtooth', 0, 1.0); this.tone(165, 1.6, 0.2, 'sawtooth', 0, 1.0); },
  siren() { for (let i = 0; i < 3; i++) this.tone(380, 0.9, 0.22, 'sawtooth', i * 1.0, 1.8); },
  plane() { this.noise(6, 180, 1, 0.18, 'lowpass', 0, 1.2); this.tone(70, 6, 0.08, 'sawtooth', 0, 1.05); },
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, 0.15, 'triangle', i * 0.1)); },
  lose() { [400, 300, 200, 120].forEach((f, i) => this.tone(f, 0.4, 0.2, 'sawtooth', i * 0.18)); },
  craft() { this.noise(0.08, 1500, 2, 0.2, 'bandpass'); this.tone(600, 0.08, 0.1, 'triangle', 0.08); },
  startAmbient(kind) {
    if (!this.ctx) return; this.stopAmbient();
    const c = this.ctx; const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = kind === 'night' ? 260 : 420; f.Q.value = 1.5;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.08; const lg = c.createGain(); lg.gain.value = 140; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    const g = c.createGain(); g.gain.value = kind === 'night' ? 0.09 : 0.06;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
    this.ambient = { src, lfo, g, kind };
  },
  stopAmbient() { if (this.ambient) { try { this.ambient.src.stop(); this.ambient.lfo.stop(); } catch (e) { } this.ambient = null; } },
};

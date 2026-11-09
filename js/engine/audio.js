// Web Audio synthesis: every sound and all music are generated at runtime.
// iOS rule: the AudioContext must be created/resumed synchronously inside a
// user gesture, so unlock() is called directly from the first tap handler.

const SFX_GAP = { hammer: 0.09, chop: 0.1, pick: 0.1, clash: 0.05, bow: 0.06, bite: 0.07, gain: 0.15, thud: 0.08, impact: 0.05, death: 0.05, bolt: 0.08, spawn: 0.12, hit: 0.06 };
const PRIORITY = { click: 3, ok: 3, error: 3, horn: 4, blood: 4, nova: 4, banner: 4, dawn: 4, victory: 5, defeat: 5, build: 3, place: 3, coin: 3, hearth: 4, trained: 3 };

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.vol = { music: 0.55, sfx: 0.8 };
    this.muted = false;
    this.last = Object.create(null);
    this.voiceEnds = [];
    this.maxVoices = 14;
    this.mode = 'menu';
    this.step = 0; this.nextT = 0;
    this.layers = {};
    this.chord = 0;
  }

  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.build();
      }
      if (this.ctx.state !== 'running') this.ctx.resume();
      // A silent buffer played inside the gesture fully unlocks older iOS.
      const b = this.ctx.createBuffer(1, 1, 22050);
      const src = this.ctx.createBufferSource();
      src.buffer = b; src.connect(this.ctx.destination); src.start(0);
    } catch (_) { this.ctx = null; }
  }

  build() {
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 1;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 4;
    this.master.connect(this.comp); this.comp.connect(c.destination);
    this.sfxBus = c.createGain(); this.sfxBus.gain.value = this.vol.sfx; this.sfxBus.connect(this.master);
    this.musicBus = c.createGain(); this.musicBus.gain.value = this.vol.music * 0.5; this.musicBus.connect(this.master);
    for (const k of ['day', 'night', 'blood', 'tense']) {
      const gn = c.createGain(); gn.gain.value = 0; gn.connect(this.musicBus); this.layers[k] = gn;
    }
    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.nextT = c.currentTime + 0.1;
    this.setMode(this.mode, true);
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }
  setVolumes(music, sfx) {
    this.vol.music = music; this.vol.sfx = sfx;
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(music * 0.5, this.ctx.currentTime, 0.05);
    this.sfxBus.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
  }
  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.03);
  }

  // ---- Effects ---------------------------------------------------------------------
  /** opts: { vol (0-1), pan (-1..1) } */
  play(name, opts = {}) {
    if (!this.ready || this.muted) return;
    const c = this.ctx, now = c.currentTime;
    const gap = SFX_GAP[name] || 0.03;
    if (this.last[name] && now - this.last[name] < gap) return;
    const pr = PRIORITY[name] || 1;
    this.voiceEnds = this.voiceEnds.filter((t) => t > now);
    if (this.voiceEnds.length >= this.maxVoices && pr < 3) return;
    if (this.voiceEnds.length >= this.maxVoices + 4) return;
    this.last[name] = now;
    const out = c.createGain();
    out.gain.value = opts.vol ?? 1;
    let node = out;
    if (opts.pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, opts.pan)); out.connect(p); node = p; }
    node.connect(this.sfxBus);
    const dur = this.voice(name, out, now) || 0.3;
    this.voiceEnds.push(now + dur);
    setTimeout(() => { try { node.disconnect(); if (node !== out) out.disconnect(); } catch (_) { /* gone */ } }, (dur + 0.2) * 1000);
  }

  osc(type, f0, f1, t, dur, out, peak = 0.3, attack = 0.005) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(peak, t + attack);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn); gn.connect(out);
    o.start(t); o.stop(t + dur + 0.02);
    return o;
  }
  noiseBurst(t, dur, out, peak, ftype, f0, f1, q = 1) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = ftype; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(gn); gn.connect(out);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }

  voice(name, out, t) {
    const r = () => 0.94 + Math.random() * 0.12;
    switch (name) {
      case 'click': this.osc('sine', 900 * r(), 620, t, 0.06, out, 0.18); return 0.08;
      case 'ok': this.osc('triangle', 660, 660, t, 0.08, out, 0.16); this.osc('triangle', 990, 990, t + 0.06, 0.12, out, 0.14); return 0.2;
      case 'error': this.osc('square', 220, 170, t, 0.16, out, 0.06); return 0.18;
      case 'hammer': this.noiseBurst(t, 0.06, out, 0.22, 'bandpass', 2200 * r(), 0, 1.2); this.osc('sine', 190 * r(), 90, t, 0.08, out, 0.25); return 0.1;
      case 'chop': this.noiseBurst(t, 0.09, out, 0.25, 'bandpass', 900 * r(), 500, 2); this.osc('triangle', 150 * r(), 90, t, 0.07, out, 0.2); return 0.11;
      case 'pick': this.osc('square', 1900 * r(), 1700, t, 0.05, out, 0.05); this.noiseBurst(t, 0.05, out, 0.15, 'highpass', 3000, 0, 1); return 0.07;
      case 'coin': this.osc('sine', 1320, 1320, t, 0.12, out, 0.16); this.osc('sine', 1760, 1760, t + 0.07, 0.22, out, 0.14); return 0.3;
      case 'gain': this.osc('sine', 1250 * r(), 1500, t, 0.05, out, 0.05); return 0.06;
      case 'bow': this.osc('triangle', 330 * r(), 180, t, 0.06, out, 0.15); this.noiseBurst(t + 0.01, 0.12, out, 0.08, 'highpass', 2500, 6000, 0.7); return 0.14;
      case 'bolt': this.osc('sine', 500 * r(), 1100, t, 0.18, out, 0.1); this.noiseBurst(t, 0.2, out, 0.1, 'lowpass', 1800, 500, 0.8); return 0.22;
      case 'clash': for (const f of [1250, 1830, 2610]) this.osc('square', f * r(), f * 0.9, t, 0.12, out, 0.025); this.noiseBurst(t, 0.07, out, 0.18, 'bandpass', 3200, 0, 2); return 0.14;
      case 'bite': this.noiseBurst(t, 0.07, out, 0.2, 'lowpass', 900, 300, 1); this.osc('sine', 130 * r(), 70, t, 0.08, out, 0.18); return 0.09;
      case 'thud': this.osc('sine', 95 * r(), 48, t, 0.16, out, 0.35); this.noiseBurst(t, 0.1, out, 0.2, 'lowpass', 500, 150, 1); return 0.18;
      case 'impact': this.noiseBurst(t, 0.04, out, 0.08, 'bandpass', 1500, 0, 1); return 0.05;
      case 'death': this.noiseBurst(t, 0.32, out, 0.16, 'lowpass', 1400, 180, 1.5); this.osc('sine', 260 * r(), 70, t, 0.3, out, 0.1); return 0.34;
      case 'fall': this.osc('sine', 300, 120, t, 0.35, out, 0.18); this.osc('triangle', 220, 90, t + 0.05, 0.4, out, 0.1); return 0.45;
      case 'spawn': this.noiseBurst(t, 0.5, out, 0.08, 'bandpass', 300, 900, 3); this.osc('sine', 80, 60, t, 0.5, out, 0.08, 0.15); return 0.52;
      case 'place': this.osc('triangle', 240, 120, t, 0.1, out, 0.25); this.noiseBurst(t, 0.06, out, 0.12, 'lowpass', 1200, 0, 1); return 0.12;
      case 'demolish': this.noiseBurst(t, 0.5, out, 0.3, 'lowpass', 1200, 120, 1); this.osc('sine', 110, 40, t, 0.45, out, 0.3); return 0.5;
      case 'build': [523, 659, 784].forEach((f, i) => this.osc('triangle', f, f, t + i * 0.07, 0.25, out, 0.13)); return 0.45;
      case 'trained': this.osc('triangle', 392, 392, t, 0.12, out, 0.14); this.osc('triangle', 587, 587, t + 0.1, 0.22, out, 0.14); return 0.35;
      case 'nova': {
        const c = this.ctx;
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.4);
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(5000, t + 0.25); f.frequency.exponentialRampToValueAtTime(300, t + 0.8);
        const gn = c.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(0.22, t + 0.05); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
        o.connect(f); f.connect(gn); gn.connect(out); o.start(t); o.stop(t + 0.9);
        this.noiseBurst(t, 0.7, out, 0.25, 'bandpass', 600, 3000, 0.8);
        this.osc('sine', 70, 40, t, 0.7, out, 0.4);
        return 0.9;
      }
      case 'banner': [392, 523, 659].forEach((f, i) => this.osc('sawtooth', f, f, t + i * 0.09, 0.45, out, 0.05, 0.03)); return 0.7;
      case 'horn': {
        const c = this.ctx;
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
        f.frequency.setValueAtTime(300, t); f.frequency.linearRampToValueAtTime(1100, t + 0.6); f.frequency.linearRampToValueAtTime(500, t + 2.4);
        const gn = c.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(0.25, t + 0.35); gn.gain.setValueAtTime(0.25, t + 1.6); gn.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
        f.connect(gn); gn.connect(out);
        const lfo = c.createOscillator(); lfo.frequency.value = 5; const lg = c.createGain(); lg.gain.value = 2.5; lfo.connect(lg);
        for (const fr of [110, 110.7, 165]) {
          const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(fr * 0.94, t); o.frequency.linearRampToValueAtTime(fr, t + 0.3);
          lg.connect(o.frequency); o.connect(f); o.start(t); o.stop(t + 2.7);
        }
        lfo.start(t); lfo.stop(t + 2.7);
        return 2.7;
      }
      case 'blood': {
        for (const fr of [55, 55.6, 82.4]) this.osc('sawtooth', fr, fr * 0.98, t, 3.8, out, 0.07, 0.8);
        this.noiseBurst(t, 3, out, 0.05, 'lowpass', 200, 120, 2);
        return 3.9;
      }
      case 'dawn': [523, 659, 784, 1046].forEach((f, i) => this.osc('sine', f, f, t + i * 0.12, 1.6, out, 0.09, 0.08)); return 2.1;
      case 'hearth': this.osc('sine', 70, 40, t, 0.4, out, 0.4); this.noiseBurst(t, 0.3, out, 0.2, 'lowpass', 400, 100, 1); return 0.4;
      case 'victory': [392, 523, 659, 784, 1046].forEach((f, i) => { this.osc('triangle', f, f, t + i * 0.16, 0.9, out, 0.14, 0.02); this.osc('sine', f / 2, f / 2, t + i * 0.16, 0.9, out, 0.08); }); return 1.9;
      case 'defeat': [392, 349, 311, 233].forEach((f, i) => this.osc('triangle', f, f * 0.99, t + i * 0.35, 1.1, out, 0.13, 0.03)); return 2.5;
      default: this.osc('sine', 600, 500, t, 0.05, out, 0.08); return 0.06;
    }
  }

  // ---- Music ---------------------------------------------------------------------------
  // Modes: menu, day, night, blood. Layers crossfade over a couple of seconds.
  setMode(mode, instant = false) {
    this.mode = mode;
    if (!this.ctx) return;
    const t = this.ctx.currentTime, tc = instant ? 0.01 : 1.4;
    const target = {
      menu: { day: 0.7, night: 0, blood: 0, tense: 0 },
      day: { day: 1, night: 0, blood: 0, tense: 0 },
      dusk: { day: 0.3, night: 0.6, blood: 0, tense: 0.4 },
      night: { day: 0, night: 1, blood: 0, tense: 0.5 },
      blood: { day: 0, night: 1, blood: 1, tense: 0.9 },
      silent: { day: 0, night: 0, blood: 0, tense: 0 },
    }[mode] || {};
    for (const k in this.layers) this.layers[k].gain.setTargetAtTime(target[k] || 0, t, tc);
  }

  update() {
    if (!this.ready) return;
    const c = this.ctx;
    const bpm = 80;
    const stepDur = 60 / bpm / 2; // eighth notes
    if (this.nextT < c.currentTime - 0.5) this.nextT = c.currentTime + 0.05;
    while (this.nextT < c.currentTime + 0.3) {
      this.scheduleStep(this.step, this.nextT, stepDur);
      this.nextT += stepDur;
      this.step++;
    }
  }

  scheduleStep(step, t, sd) {
    // D dorian. Chords cycle every 2 bars: Dm, C, Bb, C.
    const bar = Math.floor(step / 8);
    const chords = [[62, 65, 69, 74], [60, 64, 67, 72], [58, 62, 65, 70], [60, 64, 67, 72]];
    const roots = [38, 36, 34, 36];
    const ci = Math.floor(bar / 2) % 4;
    const ch = chords[ci];
    const s8 = step % 8;
    const L = this.layers;
    const on = (k) => L[k] && L[k].gain.value > 0.01;
    if (on('day')) {
      // Plucked arpeggio with gentle variation.
      const pattern = [0, 2, 1, 3, 2, 1, 3, 2];
      let note = ch[pattern[s8]] + (s8 === 7 && Math.random() < 0.3 ? 12 : 0);
      if (Math.random() < 0.12) note += 2;
      this.pluck(midi(note), t, sd * 2.2, L.day, 0.09);
      if (s8 === 0) this.pluck(midi(roots[ci] + 12), t, sd * 6, L.day, 0.08, 'sine');
      if (s8 === 4 && bar % 2 === 1 && Math.random() < 0.5) this.pluck(midi(ch[3] + 12), t, sd * 3, L.day, 0.04, 'sine');
    }
    if (on('night')) {
      if (s8 === 0 || s8 === 4) this.drum(t, 62, L.night, 0.5);
      if (s8 === 7 || (s8 === 3 && bar % 2)) this.drum(t, 110, L.night, 0.22);
      if (s8 === 0 && bar % 2 === 0) this.drone(midi(roots[ci]), t, sd * 16, L.night, 0.05);
      if (s8 === 2 && Math.random() < 0.35) this.pluck(midi(ch[(Math.random() * 4) | 0] - 12), t, sd * 4, L.night, 0.06, 'sine');
    }
    if (on('tense') && (s8 % 2 === 1)) this.tick(t, L.tense, 0.03);
    if (on('blood')) {
      if (s8 % 2 === 0) this.tick(t, L.blood, 0.05);
      if (s8 === 0 && bar % 4 === 0) this.drone(midi(roots[ci] + 1), t, sd * 30, L.blood, 0.035);
    }
  }
  pluck(f, t, dur, out, peak, type = 'triangle') {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type; o.frequency.value = f;
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(f * 6, t); fl.frequency.exponentialRampToValueAtTime(f * 1.5, t + dur);
    const gn = c.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(peak, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(fl); fl.connect(gn); gn.connect(out); o.start(t); o.stop(t + dur + 0.05);
  }
  drum(t, f, out, peak) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f * 1.8, t); o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.25);
    const gn = c.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(peak, t + 0.005); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(gn); gn.connect(out); o.start(t); o.stop(t + 0.4);
  }
  drone(f, t, dur, out, peak) {
    const c = this.ctx;
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 380;
    const gn = c.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(peak, t + dur * 0.3); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    fl.connect(gn); gn.connect(out);
    for (const d of [1, 1.006, 1.5]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * d; o.connect(fl); o.start(t); o.stop(t + dur + 0.05); }
  }
  tick(t, out, peak) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const gn = c.createGain(); gn.gain.setValueAtTime(peak, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    src.connect(f); f.connect(gn); gn.connect(out); src.start(t, Math.random()); src.stop(t + 0.05);
  }
}

function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }

export const audio = new AudioEngine();

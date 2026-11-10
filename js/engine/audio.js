// Web Audio synthesis: every sound and all music are generated at runtime.
// iOS rule: the AudioContext must be created/resumed synchronously inside a
// user gesture, so unlock() is called directly from the first tap handler.
//
// Music is layered. Each mode (menu, day, dusk, night, blood, and one theme per act
// boss) is a short original composition in a church mode, played by a "deck" with
// three layers: a drone/pad (4 persistent oscillators retuned on chord changes), a
// pulse (drums and bass) and a melody (phrases plus an optional arpeggio). Changing
// mode crossfades the old deck out while a new one fades in on its own clock.
// setIntensity(0..1) opens the pad filter, thickens the drum patterns and lifts the
// pulse layer; boss phases raise its floor, the tempo and (phase 3) the key.
// Notes are one-shot buffers rendered once at start (one source + one gain per
// note, released on 'ended') and scheduled ahead on the audio clock.

const SFX_GAP = { hammer: 0.09, chop: 0.1, pick: 0.1, clash: 0.05, bow: 0.06, bite: 0.07, gain: 0.15, thud: 0.08, impact: 0.05, death: 0.05, bolt: 0.08, spawn: 0.12, hit: 0.06 };
const PRIORITY = { click: 3, ok: 3, error: 3, horn: 4, blood: 4, nova: 4, banner: 4, dawn: 4, victory: 5, defeat: 5, build: 3, place: 3, coin: 3, hearth: 4, trained: 3 };
const LOOKAHEAD = 0.45;   // seconds of music scheduled ahead of the audio clock
const FADE = 2.6;         // crossfade length between modes

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.vol = { music: 0.55, sfx: 0.8 };
    this.muted = false;
    this.last = Object.create(null);
    this.voiceEnds = [];
    this.maxVoices = 14;
    this.mode = 'menu';
    this.decks = [];          // the live deck is last; earlier ones are fading out
    this.inst = null;         // pre-rendered instrument buffers
    this.iTarget = 0;         // intensity asked for by the game (0..1)
    this.intensity = 0;       // smoothed intensity
    this.bossPhase = 1;
    this.solo = null;         // test hook: 'pad' | 'pulse' | 'mel' plays one layer only
    this.live = 0;            // music note nodes currently alive (sources + their gains)
    this.made = 0;            // music note nodes created in total
    this.lastT = 0;
  }

  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.build();
        // Rendering the instruments takes a few ms: do it after the gesture returns.
        setTimeout(() => { try { this.makeInstruments(); } catch (_) { /* music stays silent */ } }, 0);
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
    this.musicBus = c.createGain(); this.musicBus.gain.value = this.vol.music * 0.42; this.musicBus.connect(this.master);
    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const m = this.mode; this.mode = null;
    this.setMode(m, true);
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() {
    if (!this.ctx || this.ctx.state === 'running') return;
    // Decks keep their own clocks; update() re-anchors any that fell behind.
    const p = this.ctx.resume();
    if (p && p.catch) p.catch(() => { /* needs a gesture: dom.js unlocks on the next tap */ });
  }
  setVolumes(music, sfx) {
    this.vol.music = music; this.vol.sfx = sfx;
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(music * 0.42, this.ctx.currentTime, 0.05);
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
  /** menu | day | dusk | night | blood | boss-gloomwyrm | boss-colossus | boss-hollowking | silent */
  setMode(mode, instant = false) {
    if (mode === this.mode) return;
    const wasBoss = !!(this.mode && THEMES[this.mode] && THEMES[this.mode].boss);
    this.mode = mode;
    const theme = mode === 'silent' ? null : (THEMES[mode] || THEMES.night);
    if (theme && theme.boss && !wasBoss) this.bossPhase = 1;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const d of this.decks) if (!d.endT) d.fadeOut(t, instant ? 0.05 : FADE * 0.8);
    while (this.decks.length > 2) this.decks.shift().destroy();
    if (theme) this.decks.push(new Deck(this, theme, t + 0.06, instant ? 0.05 : FADE));
  }
  /** Danger from the game (enemies near the Hearth, its damage): 0 calm .. 1 desperate. */
  setIntensity(v) { this.iTarget = Math.max(0, Math.min(1, +v || 0)); }
  /** Boss fight phase 1-3: raises the intensity floor and the tempo; phase 3 lifts the key. */
  setBossPhase(p) { this.bossPhase = Math.max(1, Math.min(3, p | 0)); }
  /** Debug/test counters for the music system. */
  stats() { return { mode: this.mode, decks: this.decks.length, live: this.live, made: this.made, intensity: +this.intensity.toFixed(3), phase: this.bossPhase, state: this.ctx ? this.ctx.state : 'none' }; }

  makeInstruments() { if (this.ctx && !this.inst) this.inst = renderInstruments(this.ctx); }

  /** Called every frame. Cheap: it only schedules what falls inside the lookahead. */
  update() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const dt = Math.min(1, Math.max(0, now - this.lastT)); this.lastT = now;
    this.intensity += (this.iTarget - this.intensity) * Math.min(1, dt * 0.6);
    if (!this.ready) return;
    this.pump(now + LOOKAHEAD);
  }

  pump(until) {
    const now = this.ctx.currentTime;
    for (let i = this.decks.length - 1; i >= 0; i--) {
      const d = this.decks[i];
      if (d.endT && now >= d.endT) { d.destroy(); this.decks.splice(i, 1); }
    }
    for (const d of this.decks) d.run(until, now);
  }

  /** One music note: a buffer source and its gain, both released when it ends. */
  note(ins, rate, t, vel, out, end = 0, rel = 0.1) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = ins.buf; src.playbackRate.value = rate;
    const g = c.createGain(); g.gain.value = vel;
    src.connect(g); g.connect(out);
    src.start(t);
    if (end) {
      g.gain.setValueAtTime(vel, end); g.gain.linearRampToValueAtTime(0, end + rel);
      src.stop(end + rel + 0.01);
    }
    this.live += 2; this.made += 2;
    src.onended = () => { this.live -= 2; try { src.disconnect(); g.disconnect(); } catch (_) { /* gone */ } };
  }
}

// ---- Decks: one playing theme with its three layers ----------------------------------------
const VEL = { x: 1, o: 0.62, '-': 0.32 };
const CHORD_TONE = [0, 2, 4, 7];
const BOSS_FLOOR = [0.45, 0.7, 0.92];

class Deck {
  constructor(eng, theme, t0, fade) {
    this.eng = eng; this.th = theme;
    const c = eng.ctx;
    this.out = c.createGain();
    this.out.gain.setValueAtTime(0, t0); this.out.gain.linearRampToValueAtTime(1, t0 + fade);
    this.out.connect(eng.musicBus);
    this.g = {};
    for (const k of ['pad', 'pulse', 'mel']) { const g = c.createGain(); g.gain.value = 0; g.connect(this.out); this.g[k] = g; }
    // Drone/pad: four persistent voices through one breathing low-pass filter.
    const P = theme.pad;
    this.filter = c.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.Q.value = P.q || 0.9;
    this.filter.frequency.value = P.lo; this.filter.connect(this.g.pad);
    this.lfo = c.createOscillator(); this.lfo.frequency.value = P.lfo || 0.1;
    this.lfoG = c.createGain(); this.lfoG.gain.value = P.lo * 0.25;
    this.lfo.connect(this.lfoG); this.lfoG.connect(this.filter.frequency);
    this.voices = [];
    const waves = P.w || ['sine', 'sawtooth', 'sawtooth', 'triangle'], mix = P.mix || [0.5, 0.24, 0.2, 0.14];
    for (let i = 0; i < 4; i++) {
      const o = c.createOscillator(); o.type = waves[i];
      if (i === 1) o.detune.value = -6; else if (i === 2) o.detune.value = 7;
      const g = c.createGain(); g.gain.value = mix[i];
      o.connect(g); g.connect(this.filter);
      o.start(t0); this.voices.push({ o, g });
    }
    this.lfo.start(t0);
    this.n = 0; this.nextT = t0; this.endT = 0; this.applied = -1; this.firstChord = true;
    this.setChord(theme.prog[0], t0);
    this.applyLevel(t0, true);
  }

  level() {
    const th = this.th, e = this.eng;
    if (th.fixedI !== undefined) return th.fixedI;
    let I = Math.max(e.intensity, th.minI || 0);
    if (th.boss) I = Math.max(I, BOSS_FLOOR[e.bossPhase - 1]);
    return Math.min(1, I);
  }
  shift() { return this.th.boss && this.eng.bossPhase >= 3 ? (this.th.p3 ?? 1) : 0; }
  stepDur() { const th = this.th; return 60 / (th.bpm * (th.boss ? 1 + 0.05 * (this.eng.bossPhase - 1) : 1)) / th.spb; }

  applyLevel(t, force) {
    const I = this.level();
    if (!force && Math.abs(I - this.applied) < 0.03) return;
    this.applied = I;
    const th = this.th, solo = this.eng.solo, tc = force ? 0.01 : 0.7;
    const lv = (k, v) => (solo && solo !== k ? 0 : v);
    this.g.pad.gain.setTargetAtTime(lv('pad', th.lv.pad * (1 - 0.15 * I)), t, tc);
    this.g.pulse.gain.setTargetAtTime(lv('pulse', th.lv.pulse * (0.55 + 0.45 * I)), t, tc);
    this.g.mel.gain.setTargetAtTime(lv('mel', th.lv.mel * (0.85 + 0.2 * I)), t, tc);
    const cut = th.pad.lo * Math.pow(th.pad.hi / th.pad.lo, I);
    this.filter.frequency.setTargetAtTime(cut, t, tc);
    this.lfoG.gain.setTargetAtTime(cut * 0.25, t, tc);
  }

  setChord(deg, t) {
    const th = this.th, tr = this.shift(), P = th.pad;
    const oct = 12 * (P.oct ?? 1);
    const root = degMidi(th, deg) + oct + tr;
    const fifth = P.power ? root + 7 : degMidi(th, deg + 4) + oct + tr;
    const top = P.power ? root + 12 : P.cluster ? root + 13 : degMidi(th, deg + 2) + oct + 12 + tr;
    const notes = [root - 12, root, fifth, top];
    for (let i = 0; i < 4; i++) {
      const f = this.voices[i].o.frequency, hz = midiHz(notes[i]);
      if (this.firstChord) f.setValueAtTime(hz, t); else f.setTargetAtTime(hz, t, 0.09);
    }
    this.firstChord = false;
  }

  fadeOut(t, dur) {
    const g = this.out.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + dur);
    this.endT = t + dur + 0.05;
  }

  destroy() {
    for (const v of this.voices) { try { v.o.stop(); } catch (_) { /* not started */ } v.o.disconnect(); v.g.disconnect(); }
    try { this.lfo.stop(); } catch (_) { /* not started */ }
    this.lfo.disconnect(); this.lfoG.disconnect(); this.filter.disconnect();
    for (const k in this.g) this.g[k].disconnect();
    this.out.disconnect();
    this.voices = [];
  }

  run(until, now) {
    if (!this.eng.inst) { if (this.nextT < now + 0.05) this.nextT = now + 0.05; return; }
    if (this.nextT < now - 0.25) this.nextT = now + 0.05; // fell behind (stall, tab switch): skip ahead
    this.applyLevel(now, false);
    const lim = this.endT ? Math.min(until, this.endT) : until;
    const e = this.eng, silent = e.muted || e.vol.music <= 0.001;
    while (this.nextT < lim) {
      this.step(this.n, this.nextT, silent);
      this.nextT += this.stepDur();
      this.n++;
    }
  }

  step(n, t, silent) {
    const th = this.th, e = this.eng, B = th.bar, s = n % B, bar = Math.floor(n / B);
    const ci = Math.floor(bar / th.bpc) % th.prog.length, deg = th.prog[ci];
    if (s === 0 && bar % th.bpc === 0) this.setChord(deg, t);
    if (silent) return;
    const I = this.level(), tr = this.shift(), sd = this.stepDur(), ins = e.inst, solo = e.solo;
    // Pulse: drums (patterns thicken as intensity rises) and the bass.
    if (!solo || solo === 'pulse') {
      const fillBar = bar % 4 === 3 && I > 0.55;
      for (const d of th.drums) {
        if (I < (d.min || 0)) continue;
        const pat = fillBar && d.fill ? d.fill : d.p;
        const v = VEL[pat[s % pat.length]];
        if (!v) continue;
        const hum = d.i === 'hat' || d.i === 'shaker' ? 1 + (Math.random() - 0.5) * 0.06 : 1;
        e.note(ins[d.i], (d.rate || 1) * hum, t, v * d.lv * (s === 0 ? 1.1 : 1), this.g.pulse);
      }
      const bc = th.bass.p[s % th.bass.p.length];
      if (bc !== '.') {
        const off = bc === '1' ? 0 : bc === '3' ? 2 : bc === '5' ? 4 : bc === '7' ? 6 : 7;
        const m = degMidi(th, deg + off) + (th.bass.oct || 0) + tr;
        e.note(ins.bass, midiHz(m) / ins.bass.base, t, th.bass.lv * (s === 0 ? 1.1 : 0.9), this.g.pulse, t + sd * 3.5, 0.12);
      }
    }
    if (solo && solo !== 'mel') return;
    // Melody: hand-written modal phrases, plus an optional arpeggio.
    const A = th.arp;
    if (A && I >= (A.min || 0)) {
      const ch = A.p[s % A.p.length];
      if (ch !== '.') {
        const m = degMidi(th, deg + CHORD_TONE[+ch]) + A.oct + tr, a = ins[A.inst];
        e.note(a, midiHz(m) / a.base, t, A.lv * (0.8 + Math.random() * 0.25), this.g.mel, t + sd * 4, 0.25);
      }
    }
    const M = th.mel;
    const key = M.order[Math.floor(bar / M.bars) % M.order.length];
    const ph = M.ph[key];
    if (!ph) return;
    const nt = ph[(bar % M.bars) * B + s];
    if (!nt) return;
    let [dg, len, acc] = nt;
    if (!acc && I < 0.3 && Math.random() < 0.12) return;            // breathe when calm
    if (!acc && len <= 2 && Math.random() < 0.08) dg += Math.random() < 0.5 ? 1 : -1; // small ornament
    const a = ins[M.inst], m = degMidi(th, dg) + M.oct + tr;
    const sus = a.sus ? t + len * sd * 0.94 : t + len * sd + 0.9;
    const vel = M.lv * (acc ? 1.15 : 1);
    e.note(a, midiHz(m) / a.base, t, vel, this.g.mel, sus, a.sus ? 0.14 : 0.5);
    if (M.double && I >= M.double) e.note(a, midiHz(m - 12) / a.base, t, vel * 0.5, this.g.mel, sus, a.sus ? 0.14 : 0.5);
  }
}

// ---- Compositions (all original) -------------------------------------------------------------
// root: the tonic in the bass octave (MIDI). prog: chord scale degrees, bpc bars each.
// Drum patterns: one char per step: x accent, o normal, - ghost, . rest; min = intensity it enters at.
// Bass pattern: 1/3/5/7 chord tones, 8 the octave. Phrases: "degree/steps" tokens, '-' rest, '!' accent.
const SC = {
  dorian: [0, 2, 3, 5, 7, 9, 10], mixo: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10],
  harm: [0, 2, 3, 5, 7, 8, 11], phrygian: [0, 1, 3, 5, 7, 8, 10], phrydom: [0, 1, 4, 5, 7, 8, 10], locrian: [0, 1, 3, 5, 6, 8, 10],
};
export const THEMES = {
  // "Ember Hall": slow D dorian bells over a warm pad.
  menu: {
    bpm: 60, spb: 2, bar: 8, root: 38, scale: SC.dorian, prog: [0, 3, 0, 6], bpc: 2, fixedI: 0.2,
    pad: { lo: 380, hi: 760, lfo: 0.07, mix: [0.5, 0.22, 0.18, 0.16] },
    lv: { pad: 0.24, pulse: 1.30, mel: 1.57 },
    drums: [{ i: 'tom', p: 'x.......', lv: 0.35, rate: 0.8 }, { i: 'shaker', p: '....-...', lv: 0.25 }],
    bass: { p: '1.......', lv: 0.35 },
    mel: { inst: 'bell', oct: 24, bars: 2, order: 'ABDC', lv: 0.32, ph: { A: '4/2! 7/2 6/1 4/1 2/2 4/4 -/4', B: '3/2! 5/2 6/2 7/2 5/4 -/4', D: '4/2! 7/2 9/2 8/2 7/4 -/4', C: '6/2! 4/2 2/2 1/2 0/6 -/2' } },
  },
  // "Hearthward Morning": G mixolydian, plucked arpeggio, a light frame drum, a flute song.
  day: {
    bpm: 88, spb: 4, bar: 16, root: 43, scale: SC.mixo, prog: [0, 6, 3, 0], bpc: 2,
    pad: { lo: 600, hi: 1400, lfo: 0.09, mix: [0.45, 0.2, 0.18, 0.14] },
    lv: { pad: 0.25, pulse: 1.30, mel: 0.74 },
    drums: [
      { i: 'kick', p: 'x.......o.......', lv: 0.55 },
      { i: 'shaker', p: '..-...-...-...o.', lv: 0.3 },
      { i: 'snare', p: '....o.......o...', lv: 0.22, min: 0.3 },
      { i: 'tom', p: '..............o-', lv: 0.3, min: 0.5, rate: 1.3 },
    ],
    bass: { p: '1.....5.1.......', lv: 0.42 },
    arp: { inst: 'pluck', p: '0.1.2.1.3.2.1.2.', oct: 24, lv: 0.22 },
    mel: { inst: 'lead', oct: 12, bars: 2, order: 'ABCD----', lv: 0.3, ph: { A: '7/4! 9/4 11/6 9/2 7/8 -/8', B: '6/4! 8/4 10/6 8/2 6/4 5/4 -/8', C: '3/4! 5/4 7/4 8/4 9/8 -/8', D: '9/2 8/2 7/4! 4/4 5/4 7/12 -/4' } },
  },
  // "Lengthening Shadows": A aeolian, a heartbeat kick and falling bells.
  dusk: {
    bpm: 72, spb: 4, bar: 16, root: 45, scale: SC.aeolian, prog: [0, 5, 3, 4], bpc: 2, minI: 0.15,
    pad: { lo: 350, hi: 900, lfo: 0.12, mix: [0.5, 0.24, 0.2, 0.12] },
    lv: { pad: 0.26, pulse: 1.47, mel: 1.06 },
    drums: [
      { i: 'kick', p: 'x..o............', lv: 0.6 },
      { i: 'hat', p: '..-...-...-...-.', lv: 0.18, min: 0.3 },
      { i: 'tom', p: '........o.......', lv: 0.3, min: 0.45, rate: 0.9 },
    ],
    bass: { p: '1...............', lv: 0.4 },
    mel: { inst: 'bell', oct: 12, bars: 2, order: 'ABCD', lv: 0.3, ph: { A: '7/6! 6/2 4/8 -/16', B: '5/6! 4/2 2/8 -/16', C: '3/6! 5/2 7/8 -/16', D: '4/6! 6/2 8/4 7/4 -/16' } },
  },
  // "The Hollow Watch": D harmonic minor, toms that build into a march.
  night: {
    bpm: 96, spb: 4, bar: 16, root: 38, scale: SC.harm, prog: [0, 5, 3, 4], bpc: 2,
    pad: { lo: 300, hi: 1500, lfo: 0.15 },
    lv: { pad: 0.24, pulse: 0.92, mel: 0.57 },
    drums: [
      { i: 'kick', p: 'x.....x...x.....', lv: 0.6 },
      { i: 'tom', p: '....o.......o.-.', fill: '....o...o.o.oooo', lv: 0.4, min: 0.15 },
      { i: 'hat', p: '-.-.-.-.-.-.-.-.', lv: 0.2, min: 0.4 },
      { i: 'hat', p: '.-.-.-.-.-.-.-.-', lv: 0.14, min: 0.75 },
      { i: 'snare', p: '....x.......x...', lv: 0.32, min: 0.65 },
    ],
    bass: { p: '1.1...1.5...1.8.', lv: 0.42 },
    mel: { inst: 'lead', oct: 12, bars: 2, order: 'ABCD-BCD', lv: 0.28, double: 0.85, ph: { A: '7/4! 8/2 9/2 8/4 7/4 6/4 7/12', B: '5/4! 7/4 9/8 8/4 7/4 5/8', C: '3/4! 5/4 7/4 9/4 10/8 9/4 7/4', D: '6/4! 4/4 6/4 8/4 7/8 -/8' } },
  },
  // "Red Moon Rising": E phrygian dominant, a clustered pad and pounding toms.
  blood: {
    bpm: 108, spb: 4, bar: 16, root: 40, scale: SC.phrydom, prog: [0, 1, 0, 6], bpc: 2, minI: 0.5,
    pad: { cluster: true, lo: 260, hi: 1100, lfo: 0.22, mix: [0.5, 0.24, 0.2, 0.1] },
    lv: { pad: 0.25, pulse: 0.63, mel: 1.09 },
    drums: [
      { i: 'kick', p: 'x..x..x...x..x..', lv: 0.62 },
      { i: 'tom', p: 'o...o...o...o.o.', fill: 'o.o.o.o.oooooooo', lv: 0.4, rate: 0.85 },
      { i: 'snare', p: '....x.......x..x', lv: 0.32, min: 0.3 },
      { i: 'hat', p: '-o-o-o-o-o-o-o-o', lv: 0.18, min: 0.5 },
      { i: 'bone', p: '.x.....x..x.....', lv: 0.22, min: 0.6 },
    ],
    bass: { p: '1..1..1...1..1..', lv: 0.45 },
    mel: { inst: 'brass', oct: 12, bars: 2, order: 'ABCD', lv: 0.3, double: 0.8, ph: { A: '7/4! 8/4 9/8 8/4 7/12', B: '8/4! 9/4 10/8 9/4 8/4 7/8', C: '4/2! 5/2 4/2 3/2 2/8 1/4 0/12', D: '6/4! 5/4 3/4 1/4 2/16' } },
  },
  // "Grey Wings" (the Gloomwyrm): E phrygian in a galloping 12/8, horn calls.
  'boss-gloomwyrm': {
    bpm: 96, spb: 3, bar: 12, root: 40, scale: SC.phrygian, prog: [0, 1, 0, 1, 5, 6, 1, 0], bpc: 1, boss: true,
    pad: { lo: 300, hi: 1800, lfo: 0.18 },
    lv: { pad: 0.25, pulse: 0.84, mel: 1.07 },
    drums: [
      { i: 'kick', p: 'x.....x..x..', lv: 0.62 },
      { i: 'tom', p: 'o..o..o..o.o', fill: 'o.oo.oo.oooo', lv: 0.42, min: 0.3, rate: 0.9 },
      { i: 'snare', p: '......x.....', lv: 0.34, min: 0.4 },
      { i: 'hat', p: '-.--.--.--.-', lv: 0.16, min: 0.55 },
      { i: 'bone', p: '..x.....x..x', lv: 0.2, min: 0.75 },
    ],
    bass: { p: '1.....1..5..', lv: 0.45 },
    mel: { inst: 'brass', oct: 12, bars: 2, order: 'ABCD', lv: 0.32, double: 0.7, ph: { A: '7/3! 8/3 7/3 4/3 7/6 8/6', B: '7/3! 9/3 10/3 9/3 8/6 7/6', C: '5/3! 7/3 9/3 7/3 6/6 5/6', D: '8/6! 7/3 6/3 7/12' } },
  },
  // "The Walking Ossuary" (the Bone Colossus): B locrian over power-chord organ, half-time slams.
  'boss-colossus': {
    bpm: 68, spb: 4, bar: 16, root: 35, scale: SC.locrian, prog: [0, 1, 6, 1], bpc: 2, boss: true,
    pad: { power: true, w: ['sine', 'square', 'sawtooth', 'square'], mix: [0.55, 0.14, 0.2, 0.1], lo: 220, hi: 900, lfo: 0.06 },
    lv: { pad: 0.23, pulse: 0.74, mel: 1.68 },
    drums: [
      { i: 'kick', p: 'x.......x.x.....', lv: 0.7 },
      { i: 'tom', p: 'x...........o.o.', fill: 'x.......o.o.oooo', lv: 0.5, rate: 0.7 },
      { i: 'snare', p: '........x.......', lv: 0.36, min: 0.2 },
      { i: 'bone', p: '..x...x...x...x.', lv: 0.24, min: 0.45 },
      { i: 'hat', p: '-.-.-.-.-.-.-.-.', lv: 0.14, min: 0.7 },
    ],
    bass: { p: '1.......1.1.....', lv: 0.5 },
    mel: { inst: 'brass', oct: 24, bars: 2, order: 'ABCD', lv: 0.3, double: 0.75, ph: { A: '7/8! 8/8 7/4 6/4 4/8', B: '7/8! 8/8 9/4 8/4 7/8', C: '6/8! 7/4 8/4 9/8 8/8', D: '11/8! 10/8 8/8 7/8' } },
  },
  // "Crown of Ash" (the Hollow King): F# harmonic minor, driving, bells over a choir pad.
  'boss-hollowking': {
    bpm: 124, spb: 4, bar: 16, root: 42, scale: SC.harm, prog: [0, 5, 3, 4], bpc: 2, boss: true,
    pad: { w: ['sine', 'triangle', 'triangle', 'sawtooth'], mix: [0.5, 0.26, 0.22, 0.1], lo: 400, hi: 2000, lfo: 0.25 },
    lv: { pad: 0.24, pulse: 0.64, mel: 0.54 },
    drums: [
      { i: 'kick', p: 'x..x..x.x..x..x.', lv: 0.6 },
      { i: 'hat', p: '-o-o-o-o-o-o-o-o', lv: 0.16, min: 0.3 },
      { i: 'snare', p: '....x.......x...', fill: '....x.......x.xx', lv: 0.34, min: 0.4 },
      { i: 'tom', p: '.......o......oo', lv: 0.36, min: 0.6, rate: 1.1 },
      { i: 'bone', p: 'x..x..x...x..x..', lv: 0.18, min: 0.8 },
    ],
    bass: { p: '1.8.1.8.1.8.1.8.', lv: 0.4 },
    arp: { inst: 'bell', p: '0.1.2.3.2.1.2.3.', oct: 24, lv: 0.14, min: 0.6 },
    mel: { inst: 'lead', oct: 24, bars: 2, order: 'ABCD', lv: 0.28, double: 0.8, ph: { A: '4/2! 5/2 4/2 3/2 2/4 1/4 0/4 1/2 2/2 4/8', B: '5/4! 7/4 9/4 7/4 5/8 4/8', C: '3/2! 4/2 5/4 7/4 8/4 9/8 7/8', D: '6/4! 4/4 6/4 8/4 6/8 -/8' } },
  },
};
// Parse phrases into per-step lookups: index = step within the phrase -> [degree, steps, accent].
for (const k in THEMES) {
  const M = THEMES[k].mel, size = M.bars * THEMES[k].bar;
  for (const p in M.ph) {
    const arr = new Array(size).fill(null);
    let at = 0;
    for (const tok of M.ph[p].trim().split(/\s+/)) {
      const [d, l] = tok.replace('!', '').split('/');
      const len = +l || 1;
      if (d !== '-' && at < size) arr[at] = [+d, len, tok.includes('!')];
      at += len;
    }
    M.ph[p] = arr; M.ph[p].steps = at;
  }
}

function degMidi(th, d) { const sc = th.scale, o = Math.floor(d / 7); return th.root + 12 * o + sc[((d % 7) + 7) % 7]; }
function midiHz(n) { return 440 * Math.pow(2, (n - 69) / 12); }

// ---- Instruments: rendered once into short buffers (pitched ones are transposed by playbackRate) --
function renderInstruments(c) {
  const sr = c.sampleRate, TAU = Math.PI * 2;
  let seed = 0x2f6b1d;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  const mk = (secs, fn) => {
    const n = Math.ceil(secs * sr), b = c.createBuffer(1, n, sr), d = b.getChannelData(0);
    fn(d, n);
    let pk = 0; for (let i = 0; i < n; i++) { const a = Math.abs(d[i]); if (a > pk) pk = a; }
    const k = pk > 0 ? 0.85 / pk : 1, tail = Math.min(n, Math.ceil(0.03 * sr));
    for (let i = 0; i < n; i++) d[i] *= k;
    for (let i = 0; i < tail; i++) d[n - 1 - i] *= i / tail;
    return b;
  };
  const TN = 2048;
  const table = (amps) => { const t = new Float32Array(TN + 1); for (let i = 0; i <= TN; i++) { let v = 0; for (let h = 0; h < amps.length; h++) v += amps[h] * Math.sin(TAU * (h + 1) * i / TN); t[i] = v; } return t; };
  const look = (t, ph) => { const x = ph * TN, i = x | 0, f = x - i; return t[i] + (t[i + 1] - t[i]) * f; };
  const tone = (secs, base, amps, envFn, extra) => {
    const tb = table(amps);
    return mk(secs, (d, n) => { let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr; ph += (extra ? extra(t) : 1) * base / sr; ph -= Math.floor(ph); d[i] = look(tb, ph) * envFn(t); } });
  };
  const I = {};
  I.kick = { base: 1, buf: mk(0.42, (d, n) => { let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr; ph += (46 + 120 * Math.exp(-t * 30)) / sr; d[i] = Math.sin(TAU * ph) * Math.min(1, t / 0.002) * Math.exp(-t * 8) + (t < 0.006 ? rnd() * 0.3 * (1 - t / 0.006) : 0); } }) };
  I.snare = { base: 1, buf: mk(0.26, (d, n) => { let lp = 0; for (let i = 0; i < n; i++) { const t = i / sr, z = rnd(); lp += (z - lp) * 0.35; d[i] = (z - lp) * Math.exp(-t * 18) * 0.8 + Math.sin(TAU * 190 * t) * Math.exp(-t * 25) * 0.5; } }) };
  I.hat = { base: 1, buf: mk(0.07, (d, n) => { let p1 = 0, p2 = 0; for (let i = 0; i < n; i++) { const t = i / sr, z = rnd(), h1 = z - p1; p1 = z; const h2 = h1 - p2; p2 = h1; d[i] = h2 * Math.exp(-t * 70); } }) };
  I.shaker = { base: 1, buf: mk(0.14, (d, n) => { let p1 = 0; for (let i = 0; i < n; i++) { const t = i / sr, z = rnd(); d[i] = (z - p1) * Math.min(1, t / 0.025) * Math.exp(-t * 30); p1 = z; } }) };
  I.tom = { base: 1, buf: mk(0.6, (d, n) => { let ph = 0, lp = 0; for (let i = 0; i < n; i++) { const t = i / sr; ph += (82 + 50 * Math.exp(-t * 14)) / sr; lp += (rnd() - lp) * 0.08; d[i] = Math.sin(TAU * ph) * Math.min(1, t / 0.003) * Math.exp(-t * 6) + lp * Math.exp(-t * 20) * 0.6; } }) };
  I.bone = { base: 1, buf: mk(0.09, (d, n) => { for (let i = 0; i < n; i++) { const t = i / sr; d[i] = (Math.sin(TAU * 1150 * t) * 0.7 + Math.sin(TAU * 1730 * t) * 0.4 + Math.sin(TAU * 2900 * t) * 0.2) * Math.exp(-t * 55); } }) };
  // Plucked string (Karplus-Strong).
  const KN = Math.round(sr / 261.63);
  I.pluck = { base: sr / KN, buf: mk(1.6, (d, n) => {
    let lp = 0, mean = 0;
    for (let i = 0; i < KN; i++) { lp += (rnd() - lp) * 0.5; d[i] = lp; mean += lp; }
    mean /= KN; for (let i = 0; i < KN; i++) d[i] -= mean;
    for (let i = KN; i < n; i++) d[i] = 0.498 * (d[i - KN] + (i - KN - 1 >= 0 ? d[i - KN - 1] : 0));
  }) };
  I.bell = { base: 523.25, buf: mk(2.4, (d, n) => {
    const P = [1, 2, 2.76, 4.07, 5.43], A = [1, 0.45, 0.3, 0.16, 0.08], D = [1.6, 2.6, 3.6, 5.5, 8];
    for (let i = 0; i < n; i++) { const t = i / sr; let v = 0; for (let k = 0; k < 5; k++) v += A[k] * Math.exp(-t * D[k]) * Math.sin(TAU * 523.25 * P[k] * t); d[i] = v * Math.min(1, t / 0.002); }
  }) };
  // Soft flute-like lead with delayed vibrato and a breath.
  I.lead = { base: 440, sus: true, buf: (() => {
    const tb = table([1, 0.35, 0.18, 0.1, 0.05, 0.03]);
    return mk(2.2, (d, n) => { let ph = 0, lp = 0; for (let i = 0; i < n; i++) { const t = i / sr; const vib = 1 + 0.006 * Math.min(1, Math.max(0, (t - 0.18) / 0.3)) * Math.sin(TAU * 5.2 * t); ph += 440 * vib / sr; ph -= Math.floor(ph); lp += (rnd() - lp) * 0.2; d[i] = look(tb, ph) * Math.min(1, t / 0.05) * Math.exp(-t * 0.7) + lp * 0.05 * Math.exp(-t * 8); } });
  })() };
  // Horn: brightens as it swells, with a small pitch scoop.
  I.brass = { base: 220, sus: true, buf: (() => {
    const dk = table([1, 0.45, 0.2, 0.08]), br = table([1, 0.85, 0.7, 0.55, 0.42, 0.32, 0.24, 0.18, 0.12, 0.08]);
    return mk(1.8, (d, n) => { let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr; ph += 220 * (1 - 0.025 * Math.exp(-t * 25)) / sr; ph -= Math.floor(ph); const b = Math.min(1, t / 0.07) * (0.35 + 0.65 * Math.exp(-t * 2.2)); d[i] = (look(dk, ph) * (1 - b) + look(br, ph) * b) * Math.min(1, t / 0.04) * Math.exp(-t * 0.8); } });
  })() };
  I.bass = { base: 55, buf: tone(1.4, 55, [1, 0.6, 0.35, 0.2, 0.1, 0.05], (t) => Math.min(1, t / 0.006) * Math.exp(-t * 2.2)) };
  return I;
}

export const audio = new AudioEngine();

/**
 * Test helper: render a music mode (or one layer of it) offline and measure it.
 * opts: { seconds, layer: 'pad'|'pulse'|'mel'|null, intensity, phase, sampleRate }
 * Resolves to { rms, peak, notes } (notes = note nodes created).
 */
export async function renderMusicOffline(mode, opts = {}) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const secs = opts.seconds || 8, sr = opts.sampleRate || 22050;
  const eng = new AudioEngine();
  eng.ctx = new OAC(2, Math.ceil(secs * sr), sr);
  eng.solo = opts.layer || null;
  eng.iTarget = eng.intensity = opts.intensity ?? 0.5;
  eng.mode = null; eng.build(); eng.makeInstruments();
  eng.setMode(mode, true);
  eng.setBossPhase(opts.phase || 1);
  eng.decks.forEach((d) => d.applyLevel(0, true));
  eng.pump(secs);
  const buf = await eng.ctx.startRendering();
  const ch = buf.getChannelData(0), skip = Math.floor(sr * 0.5);
  let sum = 0, pk = 0;
  for (let i = skip; i < ch.length; i++) { const v = ch[i]; sum += v * v; if (Math.abs(v) > pk) pk = Math.abs(v); }
  return { rms: Math.sqrt(sum / Math.max(1, ch.length - skip)), peak: pk, notes: eng.made / 2 };
}

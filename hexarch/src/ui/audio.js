// ===== audio.js : synthesized sound effects and generative music (Web Audio, no files) =====
const Sound = (() => {
  let ctx = null, master = null, sfxBus = null, musicBus = null, verb = null, noiseBuf = null;
  let musicOn = false, musicTimer = null, nextBar = 0, bar = 0, era = 0, mood = 'peace';
  const set = () => Settings.get('sound') || { sfx: true, music: true, vol: 0.8 };
  // iOS only lets audio start inside a user gesture; call unlock() from the first tap.
  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch (e) { /* older iOS */ }
    ctx = new AC();
    master = ctx.createGain(); master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.connect(master);
    sfxBus = ctx.createGain(); sfxBus.connect(comp);
    musicBus = ctx.createGain(); musicBus.connect(comp);
    verb = makeReverb(2.6); const vg = ctx.createGain(); vg.gain.value = 0.32; verb.connect(vg); vg.connect(comp);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    applySettings();
    document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend(); else ctx.resume(); });
  }
  function makeReverb(sec) {
    const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); }
    const c = ctx.createConvolver(); c.buffer = b; return c;
  }
  function applySettings() {
    if (!ctx) return; const s = set();
    master.gain.value = s.vol === undefined ? 0.8 : s.vol;
    sfxBus.gain.value = s.sfx ? 0.9 : 0;
    musicBus.gain.setTargetAtTime(s.music ? 0.22 : 0, ctx.currentTime, 0.4);
    if (s.music && !musicOn) startMusic(); if (!s.music && musicOn) stopMusic();
  }
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  // one voice: oscillator(s) through a filter and an envelope
  function tone({ f, t = 0, dur = 0.3, type = 'sine', vol = 0.3, a = 0.005, rel = 0.25, cut = 6000, q = 0.7, bus = sfxBus, wet = 0.25, glide = 0, det = 0 }) {
    const t0 = ctx.currentTime + t, o = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
    o.type = type; o.frequency.setValueAtTime(f, t0); if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * glide), t0 + dur);
    o.detune.value = det;
    fl.type = 'lowpass'; fl.frequency.value = cut; fl.Q.value = q;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + a); g.gain.setTargetAtTime(0, t0 + dur, rel / 3);
    o.connect(fl); fl.connect(g); g.connect(bus); if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(verb); }
    o.start(t0); o.stop(t0 + dur + rel * 2 + 0.05);
  }
  function noise({ t = 0, dur = 0.2, vol = 0.3, f = 1200, q = 1, type = 'bandpass', sweep = 0, wet = 0.1, bus = sfxBus }) {
    const t0 = ctx.currentTime + t, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; fl.type = type; fl.frequency.setValueAtTime(f, t0); fl.Q.value = q; if (sweep) fl.frequency.exponentialRampToValueAtTime(f * sweep, t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(fl); fl.connect(g); g.connect(bus); if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(verb); }
    s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.05);
  }
  const bell = (m, t, vol = 0.18, dur = 1.2) => { tone({ f: mtof(m), t, dur: 0.02, rel: dur, vol, type: 'sine', wet: 0.5 }); tone({ f: mtof(m) * 2.76, t, dur: 0.01, rel: dur * 0.4, vol: vol * 0.3, wet: 0.5 }); };
  const pluck = (m, t, vol = 0.16, cut = 2600) => tone({ f: mtof(m), t, dur: 0.04, rel: 0.6, vol, type: 'triangle', cut, wet: 0.35 });
  const brass = (m, t, dur, vol = 0.12) => { tone({ f: mtof(m), t, dur, a: 0.06, rel: 0.4, vol, type: 'sawtooth', cut: 1600, q: 2, wet: 0.3 }); tone({ f: mtof(m), t, dur, a: 0.06, rel: 0.4, vol: vol * 0.6, type: 'sawtooth', cut: 1600, det: 9, wet: 0.3 }); };
  const drum = (t, vol = 0.5, f = 90) => { tone({ f: f * 1.6, t, dur: 0.02, rel: 0.35, vol, type: 'sine', glide: 0.4, wet: 0.2 }); noise({ t, dur: 0.12, vol: vol * 0.4, f: 900, q: 0.6 }); };
  const SFX = {
    tap: () => tone({ f: 1250, dur: 0.012, rel: 0.05, vol: 0.06, type: 'triangle', wet: 0 }),
    select: () => { tone({ f: 660, dur: 0.02, rel: 0.09, vol: 0.09, type: 'triangle', wet: 0.1 }); tone({ f: 990, t: 0.045, dur: 0.02, rel: 0.12, vol: 0.07, type: 'triangle', wet: 0.1 }); },
    move: () => { for (let i = 0; i < 3; i++) noise({ t: i * 0.11, dur: 0.07, vol: 0.12, f: 500 + i * 60, q: 1.4, wet: 0 }); },
    sail: () => noise({ dur: 0.7, vol: 0.12, f: 400, q: 0.5, sweep: 2.5, wet: 0.3 }),
    melee: () => { noise({ dur: 0.18, vol: 0.4, f: 2600, q: 0.8, sweep: 0.4 }); tone({ f: 140, dur: 0.05, rel: 0.25, vol: 0.35, type: 'square', cut: 600, glide: 0.5 }); noise({ t: 0.09, dur: 0.12, vol: 0.25, f: 4200, q: 4 }); },
    ranged: () => { noise({ dur: 0.35, vol: 0.18, f: 3000, q: 6, sweep: 0.35, wet: 0.15 }); tone({ f: 110, t: 0.32, dur: 0.04, rel: 0.2, vol: 0.3, type: 'sine', glide: 0.5 }); },
    boom: () => { noise({ dur: 0.6, vol: 0.5, f: 300, q: 0.4, type: 'lowpass', sweep: 0.3, wet: 0.35 }); tone({ f: 70, dur: 0.1, rel: 0.5, vol: 0.45, glide: 0.5 }); },
    kill: () => { tone({ f: 330, dur: 0.08, rel: 0.3, vol: 0.12, type: 'sawtooth', cut: 900, glide: 0.5 }); },
    found: () => { [60, 64, 67, 72].forEach((m, i) => pluck(m, i * 0.09, 0.15)); bell(84, 0.38, 0.1); },
    build: () => { bell(76, 0, 0.14); bell(83, 0.12, 0.1); },
    tech: () => { [67, 71, 74, 79].forEach((m, i) => tone({ f: mtof(m), t: i * 0.07, dur: 0.05, rel: 0.5, vol: 0.1, type: 'sine', wet: 0.5 })); },
    policy: () => { [62, 66, 69, 74, 78].forEach((m, i) => pluck(m, i * 0.06, 0.12, 3500)); },
    faith: () => { [64, 71, 76].forEach(m => tone({ f: mtof(m), dur: 1.0, a: 0.3, rel: 1.2, vol: 0.06, type: 'sine', wet: 0.7 })); },
    wonder: () => { [48, 55, 60, 64, 67].forEach((m, i) => brass(m, i * 0.04, 1.2, 0.07)); bell(84, 0.5, 0.12, 2); },
    war: () => { drum(0, 0.6, 70); drum(0.32, 0.5, 70); brass(43, 0.05, 0.9, 0.12); brass(46, 0.05, 0.9, 0.08); },
    peace: () => { [60, 64, 67, 72].forEach(m => tone({ f: mtof(m), dur: 0.9, a: 0.15, rel: 0.9, vol: 0.06, type: 'triangle', wet: 0.6 })); },
    deal: () => { pluck(72, 0, 0.12); pluck(79, 0.1, 0.12); },
    turn: () => { tone({ f: mtof(45), dur: 0.05, rel: 1.6, vol: 0.12, type: 'sine', wet: 0.6 }); tone({ f: mtof(57), dur: 0.05, rel: 1.2, vol: 0.05, type: 'sine', wet: 0.6 }); },
    error: () => { tone({ f: 180, dur: 0.12, rel: 0.08, vol: 0.12, type: 'square', cut: 800 }); tone({ f: 150, t: 0.13, dur: 0.12, rel: 0.08, vol: 0.12, type: 'square', cut: 800 }); },
    grow: () => pluck(76, 0, 0.08, 4000),
    victory: () => { [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => brass(m, i * 0.12, 0.6 + (i === 6 ? 1.2 : 0), 0.08)); drum(0, 0.5); drum(0.72, 0.6); },
    defeat: () => { [57, 53, 50, 45].forEach((m, i) => brass(m, i * 0.35, 0.7, 0.08)); },
  };
  function play(name) { if (!ctx || !set().sfx) return; const f = SFX[name]; if (f) try { f(); } catch (e) { /* audio is optional */ } }
  // ---- generative music: a slow modal drone with plucked phrases; the mode follows the era and peace or war ----
  const MODES = [[0, 2, 3, 5, 7, 9, 10], [0, 2, 4, 7, 9, 12, 14], [0, 2, 3, 5, 7, 8, 10], [0, 2, 4, 5, 7, 9, 11], [0, 2, 4, 6, 7, 9, 11]];
  const ROOTS = [50, 52, 48, 53, 55];
  function startMusic() { if (!ctx) return; musicOn = true; nextBar = ctx.currentTime + 0.3; schedule(); }
  function stopMusic() { musicOn = false; clearTimeout(musicTimer); }
  function schedule() {
    if (!musicOn) return;
    while (nextBar < ctx.currentTime + 2.5) { playBar(nextBar - ctx.currentTime); nextBar += barLen(); bar++; }
    musicTimer = setTimeout(schedule, 700);
  }
  const barLen = () => mood === 'war' ? 3.2 : 4.4;
  function playBar(t) {
    if (t < 0) t = 0;
    const mode = mood === 'war' ? MODES[2] : MODES[Math.min(4, era)], root = ROOTS[Math.min(4, era)] + (mood === 'war' ? -2 : 0), L = barLen();
    const chordDeg = [0, 3, 4, 0, 5, 3, 1, 4][bar % 8];
    const deg = k => { const n = mode.length, o = Math.floor(k / n); return root + mode[((k % n) + n) % n] + 12 * o; };
    // pad
    for (const k of [chordDeg, chordDeg + 2, chordDeg + 4]) tone({ f: mtof(deg(k) - 12), t, dur: L * 0.9, a: 1.2, rel: 1.6, vol: 0.05, type: 'triangle', cut: 900, bus: musicBus, wet: 0.6, det: (k % 2 ? 6 : -6) });
    tone({ f: mtof(deg(chordDeg) - 24), t, dur: L * 0.95, a: 0.8, rel: 1.2, vol: 0.07, type: 'sine', bus: musicBus, wet: 0.3 });
    // phrase: a few plucks on scale tones, sparser in peace
    const notes = mood === 'war' ? 6 : 3 + (bar % 3 === 0 ? 2 : 0);
    let k = chordDeg + 7;
    for (let i = 0; i < notes; i++) {
      if (Math.random() < 0.25) continue;
      k += [-2, -1, 1, 2, 0][Math.floor(Math.random() * 5)];
      const when = t + (i / notes) * L + (Math.random() * 0.06);
      tone({ f: mtof(deg(k)), t: when, dur: 0.04, rel: era >= 3 ? 0.9 : 0.6, vol: 0.06, type: era >= 3 ? 'sine' : 'triangle', cut: 2400, bus: musicBus, wet: 0.5 });
    }
    if (mood === 'war') for (let i = 0; i < 4; i++) { const tt = t + i * L / 4; tone({ f: 110, t: tt, dur: 0.02, rel: 0.3, vol: i % 2 ? 0.05 : 0.09, glide: 0.4, bus: musicBus, wet: 0.15 }); }
  }
  function setMood(newEra, war) { era = newEra; mood = war ? 'war' : 'peace'; }
  return { unlock, play, applySettings, setMood, get ready() { return !!ctx; } };
})();

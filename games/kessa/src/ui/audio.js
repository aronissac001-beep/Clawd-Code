// ===== audio.js : synthesized effects and generative ambient music (Web Audio, no files) =====
const Sound = (() => {
  let ctx = null, master = null, sfxBus = null, musBus = null, verb = null, noise = null, musicOn = false, timer = 0, windSrc = null, windGain = null, mood = 0;
  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { ctx = new AC(); } catch (e) { return; }
    master = ctx.createGain(); master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4; comp.connect(master);
    sfxBus = ctx.createGain(); sfxBus.connect(comp); musBus = ctx.createGain(); musBus.connect(comp);
    const n = Math.floor(ctx.sampleRate * 3), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6); }
    verb = ctx.createConvolver(); verb.buffer = b; const vg = ctx.createGain(); vg.gain.value = 0.45; verb.connect(vg); vg.connect(comp);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const nd = noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    apply();
    document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend(); else ctx.resume(); });
  }
  function apply() {
    if (!ctx) return;
    master.gain.value = Settings.get('vol');
    sfxBus.gain.value = Settings.get('sfx') ? 0.8 : 0;
    musBus.gain.setTargetAtTime(Settings.get('music') ? 0.28 : 0, ctx.currentTime, 0.5);
    if (Settings.get('music') && !musicOn) startMusic();
    if (!Settings.get('music') && musicOn) stopMusic();
  }
  function tone(f, { t = 0, dur = 0.2, type = 'sine', vol = 0.25, a = 0.005, rel = 0.2, cut = 5000, bus, wet = 0.2, glide = 0 } = {}) {
    if (!ctx) return;
    const t0 = ctx.currentTime + t, o = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
    o.type = type; o.frequency.setValueAtTime(f, t0); if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * glide), t0 + dur);
    fl.type = 'lowpass'; fl.frequency.value = cut;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + a); g.gain.setTargetAtTime(0, t0 + dur, rel / 3);
    o.connect(fl); fl.connect(g); g.connect(bus || sfxBus);
    if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(verb); }
    o.start(t0); o.stop(t0 + dur + rel * 2);
  }
  function hiss({ t = 0, dur = 0.4, vol = 0.2, f = 800, q = 1, type = 'bandpass', f2 } = {}) {
    if (!ctx) return;
    const t0 = ctx.currentTime + t, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; s.loop = true; fl.type = type; fl.frequency.setValueAtTime(f, t0); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + dur); fl.Q.value = q;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.02); g.gain.setTargetAtTime(0, t0 + dur, dur / 3);
    s.connect(fl); fl.connect(g); g.connect(sfxBus); s.start(t0); s.stop(t0 + dur * 2.5);
  }
  const fx = {
    tap: () => tone(880, { dur: 0.04, type: 'triangle', vol: 0.12, wet: 0 }),
    open: () => { tone(520, { dur: 0.06, type: 'triangle', vol: 0.12 }); tone(780, { t: 0.05, dur: 0.06, type: 'triangle', vol: 0.1 }); },
    place: () => { tone(220, { dur: 0.08, type: 'square', vol: 0.12, cut: 1200 }); tone(330, { t: 0.06, dur: 0.12, type: 'triangle', vol: 0.15 }); },
    built: () => { [523, 659, 784].forEach((f, i) => tone(f, { t: i * 0.07, dur: 0.18, type: 'triangle', vol: 0.14, wet: 0.35 })); },
    warn: () => { tone(440, { dur: 0.18, type: 'sawtooth', vol: 0.1, cut: 1500 }); tone(440, { t: 0.28, dur: 0.18, type: 'sawtooth', vol: 0.1, cut: 1500 }); },
    bad: () => { tone(196, { dur: 0.35, type: 'sawtooth', vol: 0.14, cut: 900, glide: 0.7 }); },
    good: () => { [392, 523, 659, 784, 1046].forEach((f, i) => tone(f, { t: i * 0.09, dur: 0.3, type: 'sine', vol: 0.12, wet: 0.5 })); },
    tech: () => { [659, 880, 1318].forEach((f, i) => tone(f, { t: i * 0.1, dur: 0.4, type: 'sine', vol: 0.11, wet: 0.6 })); },
    rocket: () => { hiss({ dur: 2.2, vol: 0.25, f: 300, f2: 90, type: 'lowpass' }); tone(55, { dur: 2, type: 'sawtooth', vol: 0.08, cut: 200 }); },
    meteor: () => { hiss({ dur: 0.5, vol: 0.2, f: 3000, f2: 200 }); tone(60, { t: 0.35, dur: 0.5, type: 'sine', vol: 0.3, glide: 0.5 }); },
    birth: () => { tone(784, { dur: 0.15, vol: 0.1, wet: 0.5 }); tone(1046, { t: 0.12, dur: 0.25, vol: 0.1, wet: 0.5 }); },
    error: () => tone(160, { dur: 0.12, type: 'square', vol: 0.1, cut: 800 }),
  };
  function play(name) { if (!ctx || !Settings.get('sfx')) return; try { fx[name] && fx[name](); } catch (e) { /* audio glitch */ } }
  // ambient: slow pad chords plus sparse bell notes over a wind bed
  const SCALE = [0, 2, 3, 7, 9, 10];
  function startMusic() {
    if (!ctx) return; musicOn = true;
    windSrc = ctx.createBufferSource(); windSrc.buffer = noise; windSrc.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 400; wf.Q.value = 0.6;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 180; lfo.connect(lg); lg.connect(wf.frequency); lfo.start();
    windGain = ctx.createGain(); windGain.gain.value = 0.05; windSrc.connect(wf); wf.connect(windGain); windGain.connect(musBus); windSrc.start();
    let bar = 0;
    const root = 45;
    const step = () => {
      if (!musicOn) return;
      const chordRoot = root + [0, -4, 3, -2][bar % 4] + (mood > 0 ? 0 : 0);
      for (const iv of [0, 7, 12, 15]) tone(440 * Math.pow(2, (chordRoot + iv - 69) / 12), { dur: 6, a: 2.5, rel: 4, type: 'sine', vol: 0.05, bus: musBus, wet: 0.7, cut: 1200 });
      for (let k = 0; k < 3; k++) if (Math.random() < 0.6) { const n = chordRoot + 24 + SCALE[Math.floor(Math.random() * SCALE.length)] + (Math.random() < 0.3 ? 12 : 0); tone(440 * Math.pow(2, (n - 69) / 12), { t: 1 + k * 2 + Math.random(), dur: 0.6, a: 0.01, rel: 2.5, type: 'triangle', vol: 0.035, bus: musBus, wet: 0.8, cut: 3000 }); }
      bar++;
      timer = setTimeout(step, 8000);
    };
    step();
  }
  function stopMusic() { musicOn = false; clearTimeout(timer); try { windSrc && windSrc.stop(); } catch (e) { /* already stopped */ } windSrc = null; }
  function setStorm(on) { if (windGain && ctx) windGain.gain.setTargetAtTime(on ? 0.22 : 0.05, ctx.currentTime, 2); }
  return { unlock, apply, play, setStorm };
})();

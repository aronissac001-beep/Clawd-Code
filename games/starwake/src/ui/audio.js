// ===== audio.js : synthesized effects and generative ambient music (Web Audio, no files) =====
const Sound = (() => {
  let ctx = null, master = null, sfxBus = null, musicBus = null, verb = null, noiseBuf = null, timer = null, nextT = 0, step = 0, mood = 'calm';
  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch (e) { /* older iOS */ }
    try { ctx = new AC(); } catch (e) { ctx = null; return; }
    master = ctx.createGain(); master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4; comp.connect(master);
    sfxBus = ctx.createGain(); sfxBus.connect(comp); musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(comp);
    const n = Math.floor(ctx.sampleRate * 3.2), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6); }
    verb = ctx.createConvolver(); verb.buffer = b; const vg = ctx.createGain(); vg.gain.value = 0.42; verb.connect(vg); vg.connect(comp);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    apply();
    document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend(); else ctx.resume(); });
  }
  function apply() {
    if (!ctx) return;
    master.gain.value = Settings.get('vol');
    sfxBus.gain.value = Settings.get('sfx') ? 0.9 : 0;
    musicBus.gain.setTargetAtTime(Settings.get('music') ? 0.28 : 0, ctx.currentTime, 0.5);
    if (Settings.get('music') && !timer) { nextT = ctx.currentTime + 0.2; timer = setInterval(schedule, 250); }
    if (!Settings.get('music') && timer) { clearInterval(timer); timer = null; }
  }
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  function tone({ f, t = 0, dur = 0.3, type = 'sine', vol = 0.2, a = 0.005, rel = 0.3, cut = 5000, q = 0.7, bus = sfxBus, wet = 0.25, glide = 0, det = 0, at = null }) {
    const t0 = at != null ? at : ctx.currentTime + t, o = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
    o.type = type; o.frequency.setValueAtTime(f, t0); if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * glide), t0 + dur);
    o.detune.value = det; fl.type = 'lowpass'; fl.frequency.value = cut; fl.Q.value = q;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + a); g.gain.setTargetAtTime(0, t0 + dur, rel / 3);
    o.connect(fl); fl.connect(g); g.connect(bus); if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(verb); }
    o.start(t0); o.stop(t0 + dur + rel * 2 + 0.05);
  }
  function noise({ t = 0, dur = 0.2, vol = 0.3, f = 1200, q = 1, type = 'bandpass', sweep = 0, wet = 0.15 }) {
    const t0 = ctx.currentTime + t, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; fl.type = type; fl.frequency.setValueAtTime(f, t0); fl.Q.value = q; if (sweep) fl.frequency.exponentialRampToValueAtTime(Math.max(30, f * sweep), t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(fl); fl.connect(g); g.connect(sfxBus); if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(verb); }
    s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.05);
  }
  const chime = (ms, gap = 0.08, vol = 0.12) => ms.forEach((m, i) => { tone({ f: mtof(m), t: i * gap, dur: 0.02, rel: 1.1, vol, wet: 0.5 }); tone({ f: mtof(m + 12) * 1.003, t: i * gap, dur: 0.01, rel: 0.5, vol: vol * 0.3, wet: 0.5 }); });
  const SFX = {
    tap: () => tone({ f: 1400, dur: 0.01, rel: 0.05, vol: 0.05, type: 'triangle', wet: 0 }),
    select: () => { tone({ f: 740, dur: 0.02, rel: 0.1, vol: 0.08, type: 'triangle', wet: 0.15 }); tone({ f: 1110, t: 0.05, dur: 0.02, rel: 0.14, vol: 0.06, type: 'triangle', wet: 0.15 }); },
    order: () => { tone({ f: 520, dur: 0.05, rel: 0.2, vol: 0.09, type: 'sine', glide: 1.6, wet: 0.3 }); },
    build: () => chime([72, 76, 79], 0.07, 0.09),
    tech: () => chime([74, 78, 81, 86], 0.09, 0.1),
    trad: () => chime([69, 73, 76, 81], 0.12, 0.1),
    alert: () => { tone({ f: 660, dur: 0.12, rel: 0.1, vol: 0.12, type: 'square', cut: 1800 }); tone({ f: 494, t: 0.16, dur: 0.12, rel: 0.1, vol: 0.12, type: 'square', cut: 1800 }); },
    war: () => { for (let i = 0; i < 3; i++) tone({ f: 110, t: i * 0.22, dur: 0.18, rel: 0.4, vol: 0.18, type: 'sawtooth', cut: 900, q: 3, wet: 0.4 }); noise({ dur: 0.9, vol: 0.12, f: 300, sweep: 0.4 }); },
    peace: () => chime([67, 71, 74, 79, 83], 0.14, 0.09),
    boom: () => { noise({ dur: 0.7, vol: 0.32, f: 600, q: 0.6, type: 'lowpass', sweep: 0.2, wet: 0.3 }); tone({ f: 70, dur: 0.1, rel: 0.6, vol: 0.25, glide: 0.4, wet: 0.2 }); },
    laser: () => tone({ f: 1800, dur: 0.08, rel: 0.08, vol: 0.04, type: 'sawtooth', glide: 0.3, cut: 4000, wet: 0.2 }),
    event: () => { tone({ f: mtof(57), dur: 1.2, a: 0.3, rel: 1.5, vol: 0.1, type: 'triangle', cut: 1200, wet: 0.6 }); chime([69, 76, 81], 0.25, 0.07); },
    contact: () => chime([62, 69, 74, 78, 81], 0.18, 0.09),
    colony: () => chime([72, 79, 84, 88], 0.1, 0.1),
    victory: () => { chime([60, 64, 67, 72, 76, 79, 84], 0.13, 0.12); },
    defeat: () => { for (let i = 0; i < 4; i++) tone({ f: mtof(57 - i * 3), t: i * 0.35, dur: 0.3, rel: 0.8, vol: 0.12, type: 'triangle', cut: 1500, wet: 0.5 }); },
  };
  function play(name) { if (!ctx || !Settings.get('sfx')) return; try { SFX[name] && SFX[name](); } catch (e) { /* audio errors are not fatal */ } }
  // ---- music: slow pads over a drifting modal progression with sparse bell arpeggios ----
  const PROG = [[50, 57, 62, 65, 69], [46, 53, 58, 62, 65], [48, 55, 60, 64, 67], [45, 52, 57, 60, 64], [43, 50, 55, 58, 62], [46, 53, 58, 62, 69]];
  function schedule() {
    if (!ctx || !Settings.get('music')) return;
    while (nextT < ctx.currentTime + 1.2) {
      const bar = Math.floor(step / 8), chord = PROG[bar % PROG.length], beat = step % 8, t = nextT;
      if (beat === 0) {
        for (let i = 0; i < 4; i++) tone({ f: mtof(chord[i] + (i === 0 ? -12 : 0)), at: t, dur: 5.2, a: 2.2, rel: 3, vol: i === 0 ? 0.08 : 0.05, type: i === 0 ? 'sine' : 'triangle', cut: mood === 'war' ? 900 : 1500, bus: musicBus, wet: 0.7, det: (i - 1.5) * 6 });
      }
      if (Math.random() < (mood === 'war' ? 0.5 : 0.32) && beat % 2 === 0) { const m = chord[1 + Math.floor(Math.random() * 4)] + 12 + (Math.random() < 0.3 ? 12 : 0); tone({ f: mtof(m), at: t, dur: 0.02, rel: 1.6, vol: 0.05, bus: musicBus, wet: 0.8 }); }
      if (mood === 'war' && beat % 4 === 0) tone({ f: mtof(chord[0] - 12), at: t, dur: 0.15, rel: 0.4, vol: 0.09, type: 'sine', glide: 0.6, bus: musicBus, wet: 0.3 });
      nextT += 0.75; step++;
    }
  }
  return { unlock, apply, play, setMood(m) { mood = m; } };
})();

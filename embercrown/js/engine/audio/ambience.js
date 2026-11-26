// Depth and season ambience (owner D; EMBERCROWN-FORTRESS.md 8.6, Stage Z4). A quiet Web Audio bed under the
// colony that follows the VIEWED level band and the season:
//   surface  wind (band-passed noise), birdsong in Thaw and Highsun, a colder, louder wind in Deepcold
//   soil     a muffled low hush and rare soft trickles of earth
//   stone    a deep hum of the rock and far, slow drips
//   caverns  an open teal hum, frequent drips with a long echo
//   ember    a low growling drone and the crackle of molten rock
// Every scene is one bed (a noise source through a filter, plus a two-oscillator drone) and sparse one-shot
// events; changing scene crossfades beds over 2.5 s. It lives on its own gain under the engine's master,
// so Mute and Volume apply; the shell turns it off with the Music setting and in Battery saver.
//   ambienceBand(rel, band)        -> 'surface' | 'soil' | 'stone' | 'caverns' | 'ember' (pure; band: the level row)
//   ambienceParams(kind, season)   -> the scene's numbers (pure, tests)
//   new Ambience(engine)           .setEnabled(on), .setLevel(v 0..1), .tick(kind, season), .stop()
// Render-time only: nothing here reads or writes sim state; the event timing uses its own LCG, never the sim RNG.

export const AMBIENCE_KINDS = Object.freeze(['surface', 'soil', 'stone', 'caverns', 'ember']);
const FADE = 2.5;

/** The ambience kind of a relative level (z - zS) and its band row (js/data/levels.js). */
export function ambienceBand(rel, band) {
  if (rel >= 0) return 'surface';
  if (band && band.id === 'ember') return 'ember';
  if (band && band.cavern) return 'caverns';
  if (band && band.soil) return 'soil';
  return 'stone';
}

const BASE = {
  surface: { nType: 'bandpass', nF: 520, nQ: 0.6, nGain: 0.32, drone: 0, dGain: 0, ev: 'bird', evPerMin: 7 },
  soil: { nType: 'lowpass', nF: 260, nQ: 0.7, nGain: 0.2, drone: 55, dGain: 0.05, ev: 'trickle', evPerMin: 3 },
  stone: { nType: 'lowpass', nF: 140, nQ: 0.8, nGain: 0.14, drone: 41, dGain: 0.09, ev: 'drip', evPerMin: 4 },
  caverns: { nType: 'bandpass', nF: 330, nQ: 1.4, nGain: 0.12, drone: 49, dGain: 0.08, ev: 'drip', evPerMin: 11 },
  ember: { nType: 'lowpass', nF: 180, nQ: 1.1, nGain: 0.18, drone: 36.7, dGain: 0.14, ev: 'crackle', evPerMin: 16 },
};
/** The scene numbers of an ambience kind in a season (0 Thaw, 1 Highsun, 2 Ashfall, 3 Deepcold). */
export function ambienceParams(kind, season = 0) {
  const p = { ...(BASE[kind] || BASE.stone) }, se = ((season | 0) % 4 + 4) % 4;
  if (kind === 'surface') {
    if (se === 2) { p.nF = 420; p.evPerMin = 2; }                               // Ashfall: lower, fewer birds
    if (se === 3) { p.nF = 760; p.nQ = 0.9; p.nGain = 0.42; p.ev = 'gust'; p.evPerMin = 3; }   // Deepcold: a cold wind
    if (se === 1) p.evPerMin = 10;                                               // Highsun: the busiest song
  } else if (kind === 'soil' || kind === 'stone') {
    if (se === 0) p.evPerMin += 2;                                               // Thaw: the melt seeps down
    if (se === 3) p.evPerMin = Math.max(1, p.evPerMin - 2);                      // Deepcold: the drips freeze
  }
  p.season = se; p.kind = kind in BASE ? kind : 'stone';
  return p;
}

export class Ambience {
  constructor(engine) {
    this.eng = engine; this.on = false; this.level = 1; this.key = ''; this.bed = null; this.old = [];
    this.out = null; this.nextEv = 0; this.p = null; this.lastTick = 0; this.seed = 0x2f6e2b1;
  }
  rnd() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
  get ctx() { return this.eng && this.eng.ctx; }
  bus() {
    const c = this.ctx;
    if (!c || !this.eng.master) return null;
    if (!this.out) { this.out = c.createGain(); this.out.gain.value = 0; this.out.connect(this.eng.master); }
    return this.out;
  }
  setEnabled(on) {
    this.on = !!on;
    const o = this.bus();
    if (o) o.gain.setTargetAtTime(this.on ? 0.22 * this.level : 0, this.ctx.currentTime, 0.4);
    if (!this.on) { this.drop(); this.key = ''; }
  }
  /** v: the music volume (0..1). */
  setLevel(v) { this.level = Math.max(0, Math.min(1, +v || 0)); this.setEnabled(this.on); }
  /** Call every frame (cheap: it works at most 4 times a second). */
  tick(kind, season) {
    const c = this.ctx;
    if (!this.on || !c || c.state !== 'running') return;
    const now = c.currentTime;
    if (now - this.lastTick < 0.25) return;
    this.lastTick = now;
    const key = `${kind}|${season | 0}`;
    if (key !== this.key) { this.key = key; this.p = ambienceParams(kind, season); this.swap(now); }
    this.old = this.old.filter((b) => { if (now > b.end) { b.stop(); return false; } return true; });
    if (this.p && now >= this.nextEv) {
      if (this.nextEv) this.event(this.p.ev, now + 0.05);
      const gap = 60 / Math.max(0.5, this.p.evPerMin);
      this.nextEv = now + gap * (0.4 + this.rnd() * 1.2);
    }
  }
  swap(now) {
    const o = this.bus(), c = this.ctx, p = this.p;
    if (!o) return;
    if (this.bed) { this.bed.fade(now, FADE); this.old.push(this.bed); }
    this.bed = makeBed(c, o, this.eng.noise, p, now);
    this.nextEv = now + 1 + this.rnd() * 3;
  }
  drop() {
    const c = this.ctx, now = c ? c.currentTime : 0;
    if (this.bed) { this.bed.fade(now, 0.4); this.old.push(this.bed); this.bed = null; }
  }
  stop() { this.setEnabled(false); for (const b of this.old) b.stop(); this.old = []; }
  /** One sparse event of the scene. */
  event(kind, t) {
    const c = this.ctx, o = this.bus();
    if (!o) return;
    const g = c.createGain(); g.connect(o);
    const r = this.rnd();
    if (kind === 'bird') {
      const n = 2 + ((r * 3) | 0), f = 2200 + r * 1400;
      for (let k = 0; k < n; k++) blip(c, g, 'sine', f * (1 + 0.12 * k), f * (1.25 + 0.1 * k), t + k * 0.11, 0.08, 0.05);
    } else if (kind === 'drip') {
      const f = 900 + r * 900;
      blip(c, g, 'sine', f, f * 0.55, t, 0.09, 0.09);
      if (this.p && this.p.kind === 'caverns') { blip(c, g, 'sine', f * 0.98, f * 0.55, t + 0.23, 0.09, 0.035); blip(c, g, 'sine', f * 0.97, f * 0.55, t + 0.47, 0.09, 0.015); }
    } else if (kind === 'trickle' || kind === 'crackle' || kind === 'gust') {
      const src = c.createBufferSource(); src.buffer = this.eng.noise;
      const f = c.createBiquadFilter();
      f.type = kind === 'gust' ? 'bandpass' : 'highpass'; f.frequency.value = kind === 'crackle' ? 2600 : kind === 'gust' ? 900 : 1400; f.Q.value = 0.8;
      const a = c.createGain(), dur = kind === 'crackle' ? 0.04 + r * 0.05 : kind === 'gust' ? 2.2 : 0.6, pk = kind === 'crackle' ? 0.12 : kind === 'gust' ? 0.12 : 0.04;
      a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(pk, t + Math.min(0.6, dur * 0.3)); a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(a); a.connect(g);
      src.start(t, r * 0.5); src.stop(t + dur + 0.05);
      src.onended = () => { try { g.disconnect(); } catch (_) { /* gone */ } };
      return;
    }
    setTimeout(() => { try { g.disconnect(); } catch (_) { /* gone */ } }, 2000);
  }
}

function blip(c, out, type, f0, f1, t, dur, peak) {
  const o = c.createOscillator(), a = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(peak, t + 0.008); a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(a); a.connect(out); o.start(t); o.stop(t + dur + 0.02);
}

function makeBed(c, out, noise, p, now) {
  const g = c.createGain(); g.gain.value = 0.0001; g.connect(out);
  const nodes = [];
  if (noise) {
    const src = c.createBufferSource(); src.buffer = noise; src.loop = true;
    const f = c.createBiquadFilter(); f.type = p.nType; f.frequency.value = p.nF; f.Q.value = p.nQ;
    const a = c.createGain(); a.gain.value = p.nGain;
    // a slow swell on the filter (wind, the breath of a cavern)
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.07; lg.gain.value = p.nF * 0.35;
    lfo.connect(lg); lg.connect(f.frequency); lfo.start(now);
    src.connect(f); f.connect(a); a.connect(g); src.start(now);
    nodes.push(src, lfo);
  }
  if (p.drone) {
    for (const [mul, gn] of [[1, 1], [1.5, 0.35]]) {
      const o = c.createOscillator(); o.type = p.kind === 'ember' ? 'sawtooth' : 'sine'; o.frequency.value = p.drone * mul;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = p.kind === 'ember' ? 220 : 400;
      const a = c.createGain(); a.gain.value = p.dGain * gn;
      o.connect(f); f.connect(a); a.connect(g); o.start(now); nodes.push(o);
    }
  }
  g.gain.setTargetAtTime(1, now, FADE / 3);
  return {
    end: Infinity,
    fade(t, dur) { this.end = t + dur + 0.2; g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0.0001, t, dur / 3); },
    stop() { for (const n of nodes) { try { n.stop(); } catch (_) { /* stopped */ } } try { g.disconnect(); } catch (_) { /* gone */ } },
  };
}

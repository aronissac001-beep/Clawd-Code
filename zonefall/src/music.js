// ============================================================================
// ZONEFALL — adaptive music, synthesized live with WebAudio (no audio files).
//
//  Moods: menu (the main theme), day (warm acoustic exploring), night (sparse,
//  music box + dark pads), danger (near the big monuments), safe (Haven / the
//  casino: a lazy lounge groove), combat and raid (drums, bass ostinato, brass).
//  Each mood is a little song: a chord loop, a few instrument parts and phrases
//  that come and go so it never sits on one loop for long. Moods crossfade at
//  bar lines. The exploring moods breathe: a few loops of music, then a rest.
// ============================================================================
import { Sfx } from './audio.js';

const hz = m => 440 * Math.pow(2, (m - 69) / 12);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];

// ---------------------------------------------------------------- instruments
// every instrument plays into `out` (the mood's gain) at time t; `v` = 0..1 velocity
function env(c, g, t, a, peak, d, sus = 0.0001) {
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sus), t + a + d);
}
function osc(c, type, f, t, stop, out, detune = 0) { const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune; o.connect(out); o.start(t); o.stop(stop); return o; }
function filt(c, type, f, q, out) { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; n.connect(out); return n; }
function gain(c, out, v = 1) { const g = c.createGain(); g.gain.value = v; g.connect(out); return g; }

const I = {
  /** soft analogue pad: detuned saws through a lowpass, slow swell */
  pad(c, out, t, notes, dur, v = 0.5, bright = 900) {
    const g = gain(c, out, 0); const f = filt(c, 'lowpass', bright, 0.6, g);
    const a = Math.min(1.2, dur * 0.35), r = Math.min(1.6, dur * 0.5);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05 * v, t + a); g.gain.setValueAtTime(0.05 * v, t + dur - 0.05); g.gain.linearRampToValueAtTime(0.0001, t + dur + r);
    for (const m of notes) { osc(c, 'sawtooth', hz(m), t, t + dur + r + 0.05, f, -7); osc(c, 'sawtooth', hz(m), t, t + dur + r + 0.05, f, 8); }
  },
  /** plucked string (guitar / harp-ish): triangle + a touch of saw, filter closes as it rings */
  pluck(c, out, t, m, v = 0.5, len = 1.1) {
    const g = gain(c, out, 0); const f = filt(c, 'lowpass', 3200, 0.8, g);
    f.frequency.setValueAtTime(3600, t); f.frequency.exponentialRampToValueAtTime(700, t + len * 0.6);
    env(c, g, t, 0.004, 0.16 * v, len);
    osc(c, 'triangle', hz(m), t, t + len + 0.1, f); osc(c, 'sawtooth', hz(m), t, t + len + 0.1, gain(c, f, 0.25));
  },
  /** marimba: sine with a quick 4th-partial knock */
  marimba(c, out, t, m, v = 0.5) {
    const g = gain(c, out, 0); env(c, g, t, 0.003, 0.2 * v, 0.7); osc(c, 'sine', hz(m), t, t + 0.8, g);
    const k = gain(c, out, 0); env(c, k, t, 0.002, 0.06 * v, 0.08); osc(c, 'sine', hz(m) * 3.99, t, t + 0.12, k);
  },
  /** music box / bell: inharmonic partials, long ring */
  bell(c, out, t, m, v = 0.5, len = 2.2) {
    for (const [r, a, d] of [[1, 0.12, len], [2.76, 0.05, len * 0.45], [5.4, 0.025, len * 0.2]]) { const g = gain(c, out, 0); env(c, g, t, 0.003, a * v, d); osc(c, 'sine', hz(m) * r, t, t + d + 0.1, g); }
  },
  /** electric piano: warm sine + a bright tine that fades fast, gentle tremolo */
  epiano(c, out, t, notes, v = 0.5, len = 1.6) {
    const trem = c.createGain(); trem.gain.value = 1; trem.connect(out);
    const lfo = c.createOscillator(); lfo.frequency.value = 4.2; const lg = c.createGain(); lg.gain.value = 0.18; lfo.connect(lg); lg.connect(trem.gain); lfo.start(t); lfo.stop(t + len + 0.2);
    for (const m of notes) {
      const g = gain(c, trem, 0); env(c, g, t, 0.006, 0.07 * v, len); osc(c, 'sine', hz(m), t, t + len + 0.1, g);
      const h = gain(c, trem, 0); env(c, h, t, 0.002, 0.02 * v, 0.25); osc(c, 'sine', hz(m) * 7.02, t, t + 0.3, h);
    }
  },
  /** bass: triangle + sine sub, plucky */
  bass(c, out, t, m, v = 0.5, len = 0.45) {
    const g = gain(c, out, 0); const f = filt(c, 'lowpass', 900, 0.9, g); env(c, g, t, 0.006, 0.26 * v, len);
    osc(c, 'triangle', hz(m), t, t + len + 0.1, f); osc(c, 'sine', hz(m) / 2, t, t + len + 0.1, gain(c, f, 0.6));
  },
  /** low drone: two sines a fifth apart, swelling */
  drone(c, out, t, m, dur, v = 0.5) {
    const g = gain(c, out, 0); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.07 * v, t + dur * 0.4); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.8);
    osc(c, 'sine', hz(m), t, t + dur + 0.9, g); osc(c, 'sine', hz(m + 7), t, t + dur + 0.9, gain(c, g, 0.5)); osc(c, 'triangle', hz(m - 12), t, t + dur + 0.9, gain(c, g, 0.4));
  },
  /** singing lead with vibrato (the menu theme) */
  lead(c, out, t, m, dur, v = 0.5) {
    const g = gain(c, out, 0); const f = filt(c, 'lowpass', 2400, 0.7, g);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.085 * v, t + 0.06); g.gain.setValueAtTime(0.085 * v, t + Math.max(0.07, dur - 0.08)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
    const o = osc(c, 'triangle', hz(m), t, t + dur + 0.4, f); const o2 = osc(c, 'sawtooth', hz(m), t, t + dur + 0.4, gain(c, f, 0.12), 4);
    const lfo = c.createOscillator(); lfo.frequency.value = 5.3; const lg = c.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(hz(m) * 0.012, t + Math.min(0.5, dur)); lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency); lfo.start(t); lfo.stop(t + dur + 0.4);
  },
  /** brass stab: three saws, bright filter snapping shut */
  brass(c, out, t, notes, v = 0.5, len = 0.32) {
    const g = gain(c, out, 0); const f = filt(c, 'lowpass', 2600, 1.2, g);
    f.frequency.setValueAtTime(2800, t); f.frequency.exponentialRampToValueAtTime(500, t + len); env(c, g, t, 0.012, 0.05 * v, len);
    for (const m of notes) { osc(c, 'sawtooth', hz(m), t, t + len + 0.1, f, -6); osc(c, 'sawtooth', hz(m), t, t + len + 0.1, f, 6); }
  },
  /** staccato strings for ostinatos */
  string(c, out, t, m, v = 0.5, len = 0.18) {
    const g = gain(c, out, 0); const f = filt(c, 'bandpass', hz(m) * 2.2, 0.7, g); env(c, g, t, 0.01, 0.12 * v, len);
    osc(c, 'sawtooth', hz(m), t, t + len + 0.1, f, -5); osc(c, 'sawtooth', hz(m), t, t + len + 0.1, f, 5);
  },
  // ---- drums
  kick(c, out, t, v = 0.6) { const g = gain(c, out, 0); env(c, g, t, 0.002, 0.55 * v, 0.32); const o = osc(c, 'sine', 150, t, t + 0.4, g); o.frequency.exponentialRampToValueAtTime(42, t + 0.22); },
  snare(c, out, t, v = 0.5) { noise(c, out, t, 0.16, 'bandpass', 1900, 0.8, 0.22 * v); const g = gain(c, out, 0); env(c, g, t, 0.002, 0.12 * v, 0.1); osc(c, 'triangle', 190, t, t + 0.14, g); },
  hat(c, out, t, v = 0.4, open = false) { noise(c, out, t, open ? 0.22 : 0.045, 'highpass', 7200, 0.7, 0.09 * v); },
  shaker(c, out, t, v = 0.4) { noise(c, out, t, 0.07, 'bandpass', 5200, 1.4, 0.06 * v); },
  brush(c, out, t, v = 0.4) { noise(c, out, t, 0.18, 'bandpass', 3000, 0.9, 0.05 * v, 0.004); },
  tom(c, out, t, v = 0.5, f0 = 120) { const g = gain(c, out, 0); env(c, g, t, 0.003, 0.32 * v, 0.38); const o = osc(c, 'sine', f0, t, t + 0.45, g); o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + 0.35); noise(c, out, t, 0.06, 'lowpass', 900, 0.8, 0.08 * v); },
  timpani(c, out, t, m, v = 0.5) { const g = gain(c, out, 0); env(c, g, t, 0.004, 0.32 * v, 1.4); const o = osc(c, 'sine', hz(m), t, t + 1.5, g); o.frequency.exponentialRampToValueAtTime(hz(m) * 0.97, t + 1.2); noise(c, out, t, 0.25, 'lowpass', 300, 0.7, 0.12 * v); },
};
function noise(c, out, t, dur, type, f, q, v, att = 0.002) {
  if (!Sfx.noiseBuf) return;
  const s = c.createBufferSource(); s.buffer = Sfx.noiseBuf;
  const g = c.createGain(); g.connect(out); const n = filt(c, type, f, q, g); env(c, g, t, att, v, dur);
  s.connect(n); s.start(t, Math.random() * 0.8); s.stop(t + dur + 0.05);
}

// ---------------------------------------------------------------- songs
// a chord is [root midi offset from the key, intervals...]; `bar(ctx)` schedules one bar
const CH = (r, ...iv) => [r, ...iv];
const tones = (key, ch, oct = 0) => ch.slice(1).map(i => key + ch[0] + i + oct * 12);

/** a short phrase generator: same seed -> same phrase, so motifs repeat and develop */
function motif(seed, scale, len = 4) {
  let s = seed >>> 0; const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cells = [[1, 1, 2], [0.5, 0.5, 1, 2], [1.5, 0.5, 2], [1, 0.5, 0.5, 1, 1], [2, 1, 1], [0.5, 0.5, 0.5, 0.5, 2], [3, 1]];
  const out = []; let pos = 0, deg = Math.floor(R() * 3) + 2;
  while (pos < len) {
    const cell = cells[Math.floor(R() * cells.length)];
    for (const d of cell) { if (pos >= len) break; const step = [-2, -1, -1, 0, 1, 1, 2, 3][Math.floor(R() * 8)]; deg = Math.max(0, Math.min(scale.length * 2 - 1, deg + step)); out.push([pos, deg, Math.min(d, len - pos), R() < 0.12]); pos += d; }
  }
  return out.map(([p, d, l, rest]) => ({ p, m: scale[d % scale.length] + 12 * Math.floor(d / scale.length), l, rest }));
}

const SONGS = {
  // ---- main theme: D minor, a singing lead over pads, harp and timpani
  menu: {
    bpm: 74, key: 50,
    prog: [CH(0, 0, 3, 7), CH(-4, 0, 4, 7), CH(3, 0, 4, 7), CH(-2, 0, 4, 7)],
    theme: [
      [[0, 69, 1.5], [1.5, 67, 0.5], [2, 65, 1], [3, 62, 1]], [[0, 65, 1], [1, 67, 1], [2, 69, 2]],
      [[0, 72, 1.5], [1.5, 70, 0.5], [2, 69, 1], [3, 65, 1]], [[0, 67, 3], [3, 64, 1]],
      [[0, 69, 1.5], [1.5, 67, 0.5], [2, 65, 1], [3, 69, 1]], [[0, 74, 2], [2, 72, 1], [3, 70, 1]],
      [[0, 69, 1], [1, 72, 1], [2, 67, 1.5], [3.5, 65, 0.5]], [[0, 64, 2], [2, 62, 2]],
    ],
    bar(S, c, out, t, b, n, cyc) {
      const ch = this.prog[n % 4], beat = 60 / this.bpm, key = this.key;
      I.pad(c, out, t, tones(key, ch, 1), beat * 4, 0.8, 1100);
      I.bass(c, out, t, key + ch[0] - 12, 0.7, beat * 1.8); I.bass(c, out, t + beat * 2, key + ch[0] - 12 + 7, 0.5, beat * 1.4);
      if (n % 2 === 0) I.timpani(c, out, t, key + ch[0] - 24, 0.7);
      const arp = tones(key, ch, 1).concat(tones(key, ch, 2)[0]);
      for (let i = 0; i < 8; i++) if (cyc > 0 || i % 2 === 0) I.pluck(c, out, t + i * beat / 2, arp[[0, 1, 2, 3, 2, 1, 0, 1][i]], 0.35, 1.2);
      if (cyc % 3 !== 2) for (const [p, m, l] of this.theme[n % 8]) I.lead(c, out, t + p * beat, m, l * beat, cyc % 3 === 1 ? 0.8 : 1);
      else for (const [p, m] of this.theme[n % 8]) I.bell(c, out, t + p * beat, m + 12, 0.5);
    },
  },
  // ---- exploring by day: G major, plucked guitar arpeggios, marimba melody, soft shaker
  day: {
    bpm: 88, key: 55, scale: [0, 2, 4, 7, 9],
    progs: [[CH(0, 0, 4, 7), CH(-3, 0, 3, 7), CH(-7, 0, 4, 7), CH(2, 0, 4, 7)], [CH(0, 0, 4, 7), CH(7, 0, 4, 7), CH(4, 0, 3, 7), CH(5, 0, 4, 7)], [CH(5, 0, 4, 7), CH(0, 0, 4, 7), CH(-3, 0, 3, 7), CH(2, 0, 4, 7)]],
    bar(S, c, out, t, b, n, cyc) {
      const P = this.progs[S.var % this.progs.length], ch = P[n % 4], beat = 60 / this.bpm, key = this.key, sec = S.section;
      I.pad(c, out, t, tones(key, ch, 0), beat * 4, sec === 'rest' ? 0.35 : 0.5, 800);
      if (sec === 'rest') return;
      I.bass(c, out, t, key + ch[0] - 12, 0.6, beat * 1.5); if (n % 2) I.bass(c, out, t + beat * 2.5, key + ch[0] - 5, 0.45, beat);
      const tn = tones(key, ch, 1), pat = S.arp;
      for (let i = 0; i < 8; i++) { const k = pat[i]; if (k < 0) continue; I.pluck(c, out, t + i * beat / 2 + (i % 2 ? beat * 0.03 : 0), tn[k % 3] + (k > 2 ? 12 : 0), i % 2 ? 0.32 : 0.42, 1.0); }
      if (sec === 'full' || sec === 'groove') for (let i = 0; i < 8; i++) if (i % 2) I.shaker(c, out, t + i * beat / 2, sec === 'groove' ? 0.8 : 0.5);
      if (sec !== 'intro') { const ph = motif(S.seed + (n % 4 === 3 ? 7 : n % 2), this.scale.map(x => x + key + 12)); for (const q of ph) if (!q.rest) I.marimba(c, out, t + q.p * beat, q.m, 0.55); }
    },
  },
  // ---- night: A minor, a slow music box over dark pads and a low drone
  night: {
    bpm: 62, key: 57, scale: [0, 3, 5, 7, 10],
    prog: [CH(0, 0, 3, 7), CH(-4, 0, 4, 7, 11), CH(-7, 0, 3, 7), CH(-5, 0, 3, 7)],
    bar(S, c, out, t, b, n) {
      const ch = this.prog[n % 4], beat = 60 / this.bpm, key = this.key;
      I.pad(c, out, t, tones(key, ch, -1), beat * 4, 0.55, 600);
      if (n % 4 === 0) I.drone(c, out, t, key - 24, beat * 16, 0.6);
      if (S.section === 'rest') return;
      const sc = this.scale.map(x => x + key + 12);
      for (let i = 0; i < 4; i++) if (Math.random() < (S.section === 'full' ? 0.7 : 0.4)) I.bell(c, out, t + i * beat + (Math.random() < 0.3 ? beat / 2 : 0), pick(sc) + (Math.random() < 0.25 ? 12 : 0), 0.55, 2.6);
      if (S.section === 'full' && n % 2 === 0) I.pluck(c, out, t + beat * 2, tones(key, ch, 0)[0], 0.25, 1.8);
    },
  },
  // ---- danger: E phrygian, a nervous pulse and a creeping ostinato near the big monuments
  danger: {
    bpm: 72, key: 52,
    prog: [CH(0, 0, 3, 7), CH(1, 0, 4, 7), CH(0, 0, 3, 7), CH(-2, 0, 3, 7)],
    bar(S, c, out, t, b, n) {
      const ch = this.prog[n % 4], beat = 60 / this.bpm, key = this.key;
      I.drone(c, out, t, key - 24 + ch[0], beat * 4, 0.7); I.pad(c, out, t, tones(key, ch, -1), beat * 4, 0.35, 450);
      for (let i = 0; i < 8; i++) if (i !== 3 && i !== 7) I.string(c, out, t + i * beat / 2, key + ch[0] + [0, 0, 7, 0, 1, 0, 3, 0][i], 0.45, 0.14);
      if (n % 2 === 1) I.bell(c, out, t + beat * 3, key + 24 + pick([0, 1, 7]), 0.35, 3);
      I.tom(c, out, t, 0.35, 70);
    },
  },
  // ---- safe zones (Haven, the casino): F major lounge — electric piano, walking bass, brushes
  safe: {
    bpm: 92, key: 53,
    prog: [CH(0, 0, 4, 7, 11), CH(-3, 0, 3, 7, 10), CH(2, 0, 3, 7, 10), CH(-5, 0, 4, 7, 10)],
    bar(S, c, out, t, b, n) {
      const ch = this.prog[n % 4], beat = 60 / this.bpm, key = this.key, sw = beat * 0.16;
      I.epiano(c, out, t, tones(key, ch, 0), 0.75, beat * 1.4); I.epiano(c, out, t + beat * 1.5 + sw, tones(key, ch, 0).slice(1), 0.5, beat * 1.2);
      const r = key + ch[0] - 12, next = key + this.prog[(n + 1) % 4][0] - 12;
      [r, r + ch[2], r + 7, next + (next > r ? -1 : 1)].forEach((m, i) => I.bass(c, out, t + i * beat, m, 0.55, beat * 0.85));
      for (let i = 0; i < 4; i++) { I.brush(c, out, t + i * beat, 0.7); I.hat(c, out, t + i * beat + beat / 2 + sw, 0.35); }
      if (S.section === 'full' && n % 2) { const ph = motif(S.seed + n, [0, 2, 4, 7, 9].map(x => x + key + 12), 4); for (const q of ph) if (!q.rest) I.bell(c, out, t + q.p * beat, q.m, 0.3, 1.2); }
    },
  },
  // ---- combat: E minor, driving drums, a 16th-note bass ostinato, brass stabs and strings
  combat: {
    bpm: 132, key: 52,
    prog: [CH(0, 0, 3, 7), CH(0, 0, 3, 7), CH(-4, 0, 4, 7), CH(-2, 0, 4, 7), CH(0, 0, 3, 7), CH(-5, 0, 3, 7), CH(-4, 0, 4, 7), CH(-1, 0, 4, 7)],
    bar(S, c, out, t, b, n) {
      const ch = this.prog[n % 8], beat = 60 / this.bpm, s16 = beat / 4, key = this.key, hot = S.intensity;
      const r = key + ch[0] - 12;
      [0, 0, 12, 0, 7, 0, 12, 10, 0, 0, 12, 0, 7, 3, 5, 7].forEach((o, i) => I.bass(c, out, t + i * s16, r + o, i % 4 === 0 ? 0.7 : 0.45, s16 * 0.9));
      for (const k of [0, 1.5, 2, 3.5]) I.kick(c, out, t + k * beat, 0.8);
      I.snare(c, out, t + beat, 0.8); I.snare(c, out, t + beat * 3, 0.8); if (hot > 1) I.snare(c, out, t + beat * 3.75, 0.4);
      for (let i = 0; i < (hot > 1 ? 16 : 8); i++) I.hat(c, out, t + i * (hot > 1 ? s16 : beat / 2), i % 2 ? 0.4 : 0.6);
      I.brass(c, out, t, tones(key, ch, 0), 0.9); I.brass(c, out, t + beat * 1.5, tones(key, ch, 0), 0.6, 0.2);
      I.pad(c, out, t, tones(key, ch, 1), beat * 4, 0.5, 1600);
      for (let i = 0; i < 8; i++) I.string(c, out, t + i * beat / 2, key + ch[0] + 12 + [0, 7, 12, 7, 3, 7, 12, 15][i], 0.5, 0.12);
      if (n % 4 === 3) [3, 3.25, 3.5, 3.75].forEach((k, i) => I.tom(c, out, t + k * beat, 0.7, 150 - i * 22));
    },
  },
};
SONGS.raid = Object.assign({}, SONGS.combat);

// ---------------------------------------------------------------- the conductor
export const Music = {
  bus: null, moods: {}, want: 'none', on: true, level: 0.55, timer: null,
  ensure() {
    const c = Sfx.ctx; if (!c || this.bus) return !!this.bus;
    this.bus = c.createGain(); this.bus.gain.value = this.level; this.bus.connect(Sfx.musicOut || Sfx.master);
    this.timer = setInterval(() => this.tick(), 90);
    return true;
  },
  setLevel(v) { this.level = v; if (this.bus) this.bus.gain.setTargetAtTime(v, Sfx.ctx.currentTime, 0.2); },
  /** called by the game every frame (cheap): which mood should be playing */
  set(mood, intensity = 1) {
    if (mood === 'raid') { intensity = 2; mood = 'combat'; }
    this.want = mood; this.intensity = intensity;
  },
  tick() {
    const c = Sfx.ctx; if (!c || !this.bus || c.state !== 'running') return;
    const now = c.currentTime, want = Sfx.enabled && this.on ? this.want : 'none';
    // start / fade moods
    if (want !== 'none' && SONGS[want] && !this.moods[want]) {
      const g = c.createGain(); g.gain.value = 0.0001; g.connect(this.bus);
      const fast = want === 'combat';
      const prev = Object.values(this.moods).find(m => !m.dying);
      const S = this.moods[want] = { name: want, g, next: prev ? prev.next : now + 0.15, bar: 0, cyc: 0, var: Math.floor(Math.random() * 3), seed: Math.floor(Math.random() * 1e6), arp: this.arp(), section: 'intro', secLeft: 1, intensity: 1, fade: fast ? 1.2 : 3.5 };
      if (fast && prev) S.next = now + 0.1; // combat comes in right away
      g.gain.setValueAtTime(0.0001, S.next); g.gain.exponentialRampToValueAtTime(1, S.next + S.fade);
    }
    for (const S of Object.values(this.moods)) {
      if (S.name !== want && !S.dying) { S.dying = true; S.g.gain.cancelScheduledValues(now); S.g.gain.setValueAtTime(Math.max(0.0001, S.g.gain.value), now); S.g.gain.exponentialRampToValueAtTime(0.0001, now + (want === 'combat' ? 1.2 : 3.2)); S.end = now + (want === 'combat' ? 1.3 : 3.4); }
      if (S.dying) { if (now > S.end) { try { S.g.disconnect(); } catch (e) { } delete this.moods[S.name]; } continue; }
      S.intensity = this.intensity || 1;
      // schedule a bar ahead
      while (S.next < now + 0.35) {
        const song = SONGS[S.name], beat = 60 / song.bpm, n = S.bar % 8;
        if (n === 0 && S.bar > 0) this.newCycle(S);
        try { song.bar(S, c, S.g, S.next, S.bar, n, S.cyc); } catch (e) { console.warn('music', e); }
        S.next += beat * 4; S.bar++;
      }
    }
  },
  /** every 8 bars: develop — new arpeggio, new phrase seed, sometimes a rest so it breathes */
  newCycle(S) {
    S.cyc++; S.secLeft--;
    if (S.secLeft <= 0) {
      const order = S.name === 'day' ? ['intro', 'full', 'groove', 'full', 'rest'] : S.name === 'night' ? ['intro', 'full', 'rest', 'full', 'rest'] : ['full'];
      S.si = ((S.si || 0) + 1) % order.length; S.section = order[S.si]; S.secLeft = S.section === 'rest' ? 1 : 1 + Math.floor(Math.random() * 2);
    }
    if (S.cyc % 2 === 0) S.seed = Math.floor(Math.random() * 1e6);
    if (S.cyc % 3 === 0) { S.arp = this.arp(); S.var++; }
  },
  arp() { return pick([[0, 1, 2, 3, 2, 1, 0, 1], [0, 2, 1, 2, 3, 2, 1, 2], [0, -1, 1, 2, 3, -1, 2, 1], [0, 1, 2, 1, 3, 1, 2, 1], [0, 2, 3, 2, 0, 2, 3, 5]]); },
  stopAll() { const c = Sfx.ctx; if (!c) return; for (const S of Object.values(this.moods)) { try { S.g.gain.setTargetAtTime(0.0001, c.currentTime, 0.3); } catch (e) { } S.dying = true; S.end = c.currentTime + 1.5; } },
};
void rnd;

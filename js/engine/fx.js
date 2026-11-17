// Event juice (rework stream G): every simulation event's particles, sounds, screen shake,
// hit-stop and flying pickups. The controller drains s.rt.fx each tick and hands every event
// to handleEvent(ctl, ev); messages, banners, music and saving stay in the controller.
//
// Contract (EMBERCROWN-REWORK.md section 3.0): handleEvent(ctl, ev), where ctl provides
//   renderer (particles, settings, time), cam (zoom, worldToScreen), app (loop, canvas),
//   s (state), hud (res[k].node: the resource chips), onScreen(x, y), sfxAt(name, x, y, vol),
//   shake(amount).
// Everything here is cosmetic and runs at render time: Math.random is fine, and nothing
// writes simulation state. Hit-stop freezes the picture only (js/engine/loop.js keeps the
// owed ticks and runs them afterwards), so the simulation is untouched.
import { audio } from './audio.js';
import { BUS } from '../game/hooks.js';
import { markSpawn } from './sprites.js';

const RES_COLOR = { food: '#f0d060', wood: '#e0a868', stone: '#d8d4ce', gold: '#ffd84a' };
const RES_FILL = { food: '#9ad06a', wood: '#c08850', stone: '#c8c4bc', gold: '#f0c040' };
const FONT_PX = 15;          // damage numbers on screen, in CSS px (larger for heavy blows)
const NUM_MIN_ZOOM = 0.45;   // damage numbers are kept down to the farthest zoom
const STREAK_GAP = 2.6;      // seconds between Sovereign kills that keep a streak alive
const HITSTOP_MS = 45;       // frozen picture after a kill by the Sovereign (blade or Nova)

const streak = { n: 0, t: -99 };

/** Text size in world units for a number that should read `px` CSS pixels on screen. */
function worldPx(ctl, px) { return px / Math.max(0.3, ctl.cam.zoom); }

/** Floating text above something in the world. */
function floater(ctl, x, y, text, color, px, o = {}) {
  ctl.renderer.particles.spawn('text', x, y, { vy: o.vy ?? -26, life: o.life ?? 0.9, size: Math.round(worldPx(ctl, px)), text, color, drag: o.drag ?? 0.86 });
}

export function handleEvent(ctl, e) {
  const P = ctl.renderer.particles;
  switch (e.t) {
    case 'sfx':
      ctl.sfxAt(e.k, e.x, e.y, e.k === 'hammer' || e.k === 'chop' || e.k === 'pick' ? 0.55 : 0.8);
      if (e.k === 'chop' && ctl.onScreen(e.x, e.y)) P.burst('chip', e.x, e.y - 8, 2, { speed: 40, color: '#d8b07a', life: 0.4, size: 2, g: 0 });
      break;
    case 'hit': {
      if (!ctl.onScreen(e.x, e.y)) break;
      const fire = e.dtype === 'fire';
      P.burst('spark', e.x, e.y, e.amt >= 20 ? 6 : 3, { speed: 60, color: e.foe ? (fire ? '#ffb347' : '#f4eeff') : '#ff8a70', life: 0.25, size: 2.2 });
      if (e.amt >= 0.5 && ctl.renderer.settings.damageNumbers && ctl.cam.zoom > NUM_MIN_ZOOM) {
        const heavy = e.amt >= 20;
        floater(ctl, e.x + (Math.random() - 0.5) * 10, e.y - 6, String(Math.max(1, Math.round(e.amt))), e.foe ? (heavy ? '#ffe08a' : '#fff2c8') : '#ff8070', heavy ? FONT_PX + 4 : FONT_PX, { vy: -34, life: 0.75 });
      }
      break;
    }
    case 'death': death(ctl, e, P); break;
    case 'built':
      ctl.sfxAt('build', e.x, e.y);
      P.burst('puff', e.x, e.y, 10, { speed: 40, color: '#d8c8a8', life: 0.7, size: 5 });
      break;
    case 'destroyed':
      ctl.sfxAt('demolish', e.x, e.y);
      P.burst('puff', e.x, e.y, 18, { speed: 50, color: '#7a6a5a', life: 1.1, size: 8 });
      P.burst('chip', e.x, e.y - 10, 10, { speed: 70, color: ['#8a6a4a', '#a8a29a'], life: 0.8, size: 2.5, g: 120, vz: 60 });
      ctl.shake(e.size * 2.5);
      break;
    case 'dusk': audio.play('horn'); break;
    case 'night': if (e.long || e.blood) audio.play('blood'); break;
    case 'dawn': audio.play('dawn'); streak.n = 0; break;
    case 'gain': gain(ctl, e, P); break;
    case 'incomeLump': incomeLump(ctl, e); break;
    case 'felled':
      if (ctl.onScreen(e.x, e.y)) {
        if (e.kind === 'tree') P.burst('leaf', e.x, e.y - 20, 10, { speed: 50, color: ['#4b7d33', '#679a43', '#3f6f2c'], life: 1.2, size: 3 });
        else P.burst('chip', e.x, e.y - 6, 8, { speed: 50, color: '#b4b0aa', life: 0.6, size: 2.5 });
      }
      break;
    case 'spawn':
      // The Hollow claw up out of the ground (the sprite rises, sprites.js riseOf): dark soil
      // flung up, a violet ring, a wisp.
      markSpawn(e.x, e.y, ctl.renderer.time);
      if (ctl.onScreen(e.x, e.y)) {
        P.spawn('ring', e.x, e.y, { life: 0.45, size: 34, color: '#a890ff', add: true });
        P.burst('chip', e.x, e.y - 2, 7, { speed: 46, color: ['#3a2e28', '#54443a'], life: 0.7, size: 2.6, g: 160, vz: 70 });
        P.burst('puff', e.x, e.y, 5, { speed: 26, color: '#5a4a80', life: 0.8, size: 6 });
        P.burst('ember', e.x, e.y - 6, 4, { speed: 20, color: '#c9b8ff', life: 0.8, size: 2, add: true });
      }
      ctl.sfxAt('spawn', e.x, e.y, 0.6);
      break;
    case 'burn':
      if (ctl.onScreen(e.x, e.y)) { P.burst('ember', e.x, e.y - 8, 8, { speed: 30, color: ['#ffb347', '#ffd27a'], life: 1, size: 2.4, add: true }); P.burst('puff', e.x, e.y - 6, 4, { speed: 16, color: '#c0b0a0', life: 0.9, size: 5 }); }
      break;
    case 'impact': if (e.kind === 'bolt' && ctl.onScreen(e.x, e.y)) P.burst('ember', e.x, e.y, 5, { speed: 40, color: '#ffb347', life: 0.4, size: 2, add: true }); break;
    case 'nova':
      audio.play('nova');
      P.spawn('ring', e.x, e.y, { life: 0.6, size: e.r * 2.2, color: '#ffd27a', add: true });
      P.spawn('ring', e.x, e.y, { life: 0.35, size: e.r * 1.2, color: '#fff2c8', add: true });
      P.burst('ember', e.x, e.y - 6, 40, { speed: 160, color: ['#ffd27a', '#ff9a3a', '#fff2c8'], life: 0.7, size: 3, add: true, drag: 0.8 });
      ctl.shake(8);
      break;
    case 'banner':
      audio.play('banner');
      P.burst('spark', e.x, e.y - 30, 14, { speed: 50, color: '#ffe08a', life: 0.8, size: 2.5, add: true });
      break;
    case 'trained': ctl.sfxAt('trained', e.x, e.y, 0.8); break;
    case 'cache':
      audio.play('coin');
      P.burst('spark', e.x, e.y - 6, 16, { speed: 60, color: '#ffe680', life: 0.8, size: 2.5, add: true });
      break;
    case 'hearthHit': if (Math.random() < 0.15) { audio.play('hearth'); ctl.shake(3); } break;
    case 'bossRoar': audio.play('horn'); ctl.shake(10); break;
    case 'bossWarn': audio.play('error', { vol: 0.6 }); break;
    case 'bossStrafe':
      if (e.impact) { audio.play('hearth'); ctl.shake(12); } else if (Math.random() < 0.3) { audio.play('nova', { vol: 0.5 }); ctl.shake(4); }
      if (e.x !== undefined && ctl.onScreen(e.x, e.y)) P.burst('puff', e.x, e.y, 3, { speed: 30, color: '#8a8498', life: 0.9, size: 7 });
      break;
    case 'bossLand': audio.play('thud'); ctl.shake(7); break;
    case 'bossTakeoff': ctl.sfxAt('chop', e.x, e.y, 0.5); if (ctl.onScreen(e.x, e.y)) P.burst('puff', e.x, e.y, 8, { speed: 60, color: '#9a90b0', life: 0.8, size: 8 }); break;
    case 'riftFallen':
      audio.play('victory'); ctl.shake(10);
      if (e.x !== undefined) { P.burst('ember', e.x, e.y - 10, 40, { speed: 140, color: ['#c9b8ff', '#fff2c8'], life: 1.2, size: 3, add: true, drag: 0.85 }); P.burst('puff', e.x, e.y, 20, { speed: 50, color: '#7a6a90', life: 1.4, size: 9 }); }
      break;
    case 'bossPhase': audio.play('horn'); ctl.shake(8); break;
    case 'bossDarkWarn': if (e.first) audio.play('horn'); break;
    case 'bossDark': if (e.on) { audio.play('blood'); ctl.shake(6); } break;
    case 'kingSummon': if (e.x !== undefined && ctl.onScreen(e.x, e.y)) P.burst('puff', e.x, e.y, 14, { speed: 50, color: '#7a5ab0', life: 1, size: 8 }); ctl.sfxAt('spawn', e.x, e.y); break;
    case 'kingSnuff': if (e.x !== undefined && ctl.onScreen(e.x, e.y)) P.burst('puff', e.x, e.y - 20, 10, { speed: 30, color: '#8a8498', life: 1, size: 6 }); ctl.sfxAt('death', e.x, e.y); break;
    case 'kingBlink': for (const [bx, by] of [[e.fx, e.fy], [e.x, e.y]]) if (bx !== undefined && ctl.onScreen(bx, by)) P.burst('puff', bx, by, 12, { speed: 60, color: '#5a4a80', life: 0.8, size: 8 }); audio.play('spawn'); break;
    case 'kingRekindle': if (e.x !== undefined) P.burst('ember', e.x, e.y - 20, 12, { speed: 40, color: '#ffb347', life: 0.8, size: 2, add: true }); break;
    case 'charge': if (ctl.onScreen(e.x, e.y)) P.burst('puff', e.x, e.y, 8, { speed: 50, color: '#d8c8a0', life: 0.6, size: 5 }); break;
    case 'regrow': if (ctl.onScreen(e.x, e.y)) P.burst('leaf', e.x, e.y - 14, 8, { speed: 30, color: ['#4b7d33', '#679a43'], life: 1, size: 3 }); break;
    case 'heroLevel': audio.play('ok'); if (e.x !== undefined) P.burst('spark', e.x, e.y - 16, 30, { speed: 90, color: ['#ffd27a', '#fff2c8'], life: 1, size: 3, add: true }); break;
    case 'heroHired': audio.play('trained'); if (e.x !== undefined) P.burst('puff', e.x, e.y, 10, { speed: 40, color: '#e8d8a0', life: 0.8, size: 6 }); break;
    case 'heal': if (e.x !== undefined && ctl.onScreen(e.x, e.y) && Math.random() < 0.3) P.burst('spark', e.x, e.y - 12, 3, { speed: 20, color: '#8fe86a', life: 0.6, size: 2, add: true }); break;
    case 'bossSlain':
      audio.play('victory'); ctl.shake(14); hitStop(ctl, 90);
      if (e.x !== undefined) { P.burst('ember', e.x, e.y - 30, 60, { speed: 180, color: ['#ffd27a', '#c9b8ff', '#fff2c8'], life: 1.4, size: 3, add: true, drag: 0.85 }); P.burst('puff', e.x, e.y, 30, { speed: 70, color: '#8a8498', life: 1.6, size: 10 }); }
      break;
    case 'arcane':
      if (ctl.onScreen(e.x1, e.y1)) for (let k = 0; k <= 6; k++) P.spawn('spark', e.x1 + (e.x2 - e.x1) * k / 6, e.y1 + (e.y2 - e.y1) * k / 6 - 8, { life: 0.3, size: 2.5, color: '#7ff0e8', add: true });
      break;
    case 'newcomer':
      if (ctl.onScreen(e.x, e.y)) floater(ctl, e.x, e.y, `+1 villager (${e.n}/${e.cap})`, '#fff2c8', 14, { vy: -18, life: 1.8, drag: 0.92 });
      audio.play('ok', { vol: 0.4 });
      break;
  }
}

// ---- Kills: burst, shake, hit-stop, Sovereign streak -------------------------------------------------
function death(ctl, e, P) {
  const on = ctl.onScreen(e.x, e.y);
  const bySov = e.foe && e.by === 'sovereign';
  if (on) {
    if (e.foe) {
      // The Hollow come apart: a pale burst, violet embers, a soul wisp rising.
      P.burst('puff', e.x, e.y - 8, e.big ? 16 : 8, { speed: 30, color: '#9a90b8', life: 0.8, size: e.big ? 9 : 5.5 });
      P.burst('ember', e.x, e.y - 8, e.big ? 14 : 7, { speed: 44, color: ['#c9b8ff', '#f4eeff'], life: 0.9, size: 2.2, add: true });
      P.spawn('ember', e.x, e.y - 14, { vy: -34, life: 1.1, size: 3.2, color: '#e8dcff', add: true, drag: 0.97 });
      if (bySov || e.big) P.spawn('ring', e.x, e.y, { life: 0.4, size: e.big ? 60 : 38, color: '#fff2c8', add: true });
      ctl.shake(e.big ? 6 : bySov ? 2.5 : 1);
    } else {
      P.burst('puff', e.x, e.y - 8, e.big ? 16 : 7, { speed: 26, color: '#8a7a68', life: 0.8, size: e.big ? 9 : 5 });
      if (e.big) ctl.shake(6);
    }
  }
  ctl.sfxAt(e.foe ? 'death' : 'fall', e.x, e.y, 0.8);
  if (!bySov) return;
  // A kill by the Sovereign's own hand (blade or Heartflame Nova) lands with a beat of hit-stop.
  if (on) { hitStop(ctl, HITSTOP_MS); ctl.sfxAt('slay', e.x, e.y, 0.9); }
  const now = ctl.renderer.time;
  streak.n = now - streak.t <= STREAK_GAP ? streak.n + 1 : 1;
  streak.t = now;
  const v = ctl.s && ctl.s.sovereign;
  if (streak.n >= 2 && v && v.alive && ctl.onScreen(v.x, v.y)) {
    const n = streak.n;
    floater(ctl, v.x, v.y - 44, `×${n}`, n >= 5 ? '#ffb347' : '#ffe08a', Math.min(30, 17 + n * 1.6), { vy: -30, life: 0.9, drag: 0.82 });
    if (n === 3 || n === 5 || n % 10 === 0) {
      P.spawn('ring', v.x, v.y, { life: 0.5, size: 54 + n * 2, color: '#ffd27a', add: true });
      P.burst('spark', v.x, v.y - 20, 12 + n, { speed: 80, color: ['#ffd27a', '#fff2c8'], life: 0.7, size: 2.5, add: true });
      audio.play('streak');
    }
  }
}

function hitStop(ctl, ms) {
  const loop = ctl.app && ctl.app.loop;
  if (loop && loop.hitStop) loop.hitStop(ms);
}

// ---- Resource gains and the dawn income lump ----------------------------------------------------------
function gain(ctl, e, P) {
  if (e.lump) return; // the dawn lump is drawn by incomeLump (flying icons)
  const on = ctl.onScreen(e.x, e.y);
  if (on && ctl.cam.zoom > NUM_MIN_ZOOM) floater(ctl, e.x, e.y, `+${Math.round(e.a)}`, RES_COLOR[e.k] || '#fff2c8', 14, { vy: -22, life: 1.1, drag: 0.9 });
  ctl.sfxAt('gain', e.x, e.y, 0.4);
  // Gold from the field (Emberkin plunder, caches, taxes paid in person) flies to the gold chip.
  if (e.k === 'gold' && on) {
    P.burst('spark', e.x, e.y, 5, { speed: 40, color: '#ffe680', life: 0.5, size: 2, add: true });
    fly(ctl, e.x, e.y, 'gold', 0, 1);
  }
}

function incomeLump(ctl, e) {
  const items = Array.isArray(e.items) ? e.items : [];
  let n = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!(it.a > 0) || !RES_FILL[it.k]) continue;
    if (ctl.onScreen(it.x, it.y)) floater(ctl, it.x, it.y, `+${it.a}`, RES_COLOR[it.k], 16, { vy: -20, life: 1.6, drag: 0.92 });
    const icons = Math.min(3, 1 + Math.floor(it.a / 25));
    for (let k = 0; k < icons && n < MAX_FLY; k++, n++) fly(ctl, it.x, it.y, it.k, 0.1 + i * 0.07 + k * 0.08, 1 / icons);
  }
  if (items.length) audio.play('lump');
}

// Flying icons, in screen space: from a point in the world to the resource chip in the HUD.
const MAX_FLY = 48;
const flyers = [];
function chipTarget(ctl, k) {
  const node = ctl.hud && ctl.hud.res && ctl.hud.res[k] && ctl.hud.res[k].node;
  const cv = ctl.app && ctl.app.canvas;
  if (!node || !cv || !node.getBoundingClientRect) return null;
  const r = node.getBoundingClientRect(), c = cv.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  // The chip's icon sits at its left edge.
  return { x: r.left - c.left + Math.min(16, r.width / 2), y: r.top - c.top + r.height / 2, node };
}
function fly(ctl, wx, wy, k, delay, share) {
  if (flyers.length >= MAX_FLY) return;
  const tgt = chipTarget(ctl, k);
  if (!tgt) return;
  const p = ctl.cam.worldToScreen(wx, wy);
  const W = ctl.app.vw || 400, H = ctl.app.vh || 800;
  const x0 = Math.max(12, Math.min(W - 12, p.x)), y0 = Math.max(12, Math.min(H - 12, p.y));
  const side = Math.random() < 0.5 ? -1 : 1;
  flyers.push({ k, x0, y0, x1: tgt.x, y1: tgt.y, cx: (x0 + tgt.x) / 2 + side * (40 + Math.random() * 50), cy: Math.min(y0, tgt.y) - 30 - Math.random() * 40, t: -delay, dur: 0.75 + Math.random() * 0.2, node: tgt.node, share, last: -1 });
}
let lastTime = -1;
const bumped = new WeakMap();
function drawFlyers(g, s, w, h, time) {
  const dt = lastTime < 0 ? 0 : Math.max(0, Math.min(0.1, time - lastTime));
  lastTime = time;
  if (!flyers.length) return;
  let j = 0;
  for (let i = 0; i < flyers.length; i++) {
    const f = flyers[i];
    f.t += dt;
    if (f.t >= f.dur) { arrive(f); continue; }
    flyers[j++] = f;
    if (f.t < 0) continue;
    const u = f.t / f.dur, e = u * u * (3 - 2 * u), a = 1 - e;
    const x = a * a * f.x0 + 2 * a * e * f.cx + e * e * f.x1, y = a * a * f.y0 + 2 * a * e * f.cy + e * e * f.y1;
    const r = 9 - 3 * e;
    g.globalAlpha = Math.min(1, u * 6);
    g.fillStyle = 'rgba(20,14,10,0.85)';
    g.beginPath(); g.arc(x, y, r + 1.5, 0, 6.283); g.fill();
    g.fillStyle = RES_FILL[f.k];
    g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, 6.283); g.fill();
  }
  flyers.length = j;
  g.globalAlpha = 1;
}
function arrive(f) {
  const n = f.node;
  if (!n || !n.animate) return;
  const now = performance.now();
  if (now - (bumped.get(n) || 0) < 140) return;
  bumped.set(n, now);
  try { n.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' }); } catch (_) { /* old WebKit */ }
  audio.play('gain', { vol: 0.35 });
}

/** Test/debug view of the juice state (flying icons, streak). */
export function fxState() { return { flyers: flyers.length, streak: streak.n }; }
/** Drop pending flying icons (a new region starts). */
export function resetFx() { flyers.length = 0; streak.n = 0; streak.t = -99; lastTime = -1; }

let registered = false;
export function registerFx() {
  if (registered) return;
  registered = true;
  BUS.draw.screen.push(drawFlyers);
}
registerFx();

// ---- Colony sounds (Stage 1a; doc 14.6 row D). The colony controller (I) wires these: ----------
//   installColonySfx(on, play, opts)  subscribes to the C8 events (js/game/core/events.js on()) and calls
//                                    play(name, x, y) with world coordinates; returns an unsubscribe function
//   workSfx(jobType, benchDef)        the sound a working colonist makes on each tool stroke, and its period
//                                    in seconds ({ name, every } or null): dig, chop, hammer, saw, chisel
//   doorSfx                           'door': play it when a door's open state changes on screen
// Cosmetic only: nothing here touches sim state.
export const EVENT_SFX = Object.freeze({
  mined: (d) => (d && d.ore ? 'ore' : 'rockfall'),
  oreFound: () => 'ore',
  built: (d) => (d && d.def === 'door' ? 'door' : 'build'),
  crafted: () => 'place',
  rankUp: () => 'trained',
});
const WORK_SFX = { mine: ['dig', 0.55], chop: ['chop', 0.6], build: ['hammer', 0.45], construct: ['hammer', 0.45], deconstruct: ['hammer', 0.5] };
export function workSfx(jobType, benchDef) {
  if (jobType === 'craft' || jobType === 'bill') return benchDef === 'mason' ? { name: 'chisel', every: 0.5 } : { name: 'saw', every: 0.7 };
  const w = WORK_SFX[jobType];
  return w ? { name: w[0], every: w[1] } : null;
}
export const doorSfx = 'door';
export function installColonySfx(on, play, opts = {}) {
  const tile = opts.tile || 32, w = opts.width || 128;
  const at = (i) => [((i % w) + 0.5) * tile, (((i / w) | 0) + 0.5) * tile];
  const offs = [];
  for (const [name, pick] of Object.entries(EVENT_SFX)) {
    offs.push(on(name, (e) => {
      const d = e.data || {}, k = pick(d);
      if (!k) return;
      if (typeof d.i === 'number') { const [x, y] = at(d.i); play(k, x, y); } else play(k, null, null);
    }));
  }
  return () => { for (const f of offs) f(); };
}

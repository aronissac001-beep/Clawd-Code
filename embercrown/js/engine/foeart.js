// Art for the Phase 4 foes (js/data/enemies-p4.js): Goblin Raider, Riftspawner, Ash Wyvern,
// Bog Witch, Frost Wraith and Ash Imp. Same tabletop-miniature style as sprites.js; every
// frame is drawn once into a cached sprite (sprite()/unitSprite()), so a frame costs a few
// drawImage calls. Small foes use the 26 x 32 unit box (UNIT_ART, also used by the dusk
// telegraph and the Codex); the Riftspawner and the Wyvern have bigger boxes of their own
// and a scaled-down UNIT_ART icon.
// Cosmetic only: Math.random is allowed here, nothing in this file touches game state.
import { BUS } from '../game/hooks.js';
import { ART, sprite, unitSprite, flashOf, glowSprite, UNIT_ART } from './sprites.js';
import { FOES, FOE_RULES } from '../data/enemies-p4.js';
import { T, N, idx } from '../game/grid.js';

const { INK, shadow, poly, rect, rrect, circle, line, shade } = ART;
const UAX = 13, UAY = 28;
const RES_COL = { gold: '#f0c040', food: '#9ad06a', wood: '#c08850', stone: '#c8c4bc' };

function legs(g, frame, color, y = 22, h = 6, x0 = 10, gap = 3.4, w = 2.6) {
  const a = frame === 1 ? 2 : frame === 2 ? -2 : 0;
  rect(g, x0 + a * 0.5, y, w, h - Math.max(0, a), color, 'rgba(25,18,12,0.7)', 0.6);
  rect(g, x0 + gap - a * 0.5, y, w, h - Math.max(0, -a), color, 'rgba(25,18,12,0.7)', 0.6);
}

// ---- Small foes (26 x 32 unit frames: 0 idle, 1/2 walk, 3 attack) ---------------------------------
export const FOE_UNIT_ART = {
  // Goblin Raider: small, green, big ears, a patched hood, a knife and a sack (full when opt.tool = 'sack').
  goblin(frame, opt) {
    return (g) => {
      const full = opt && opt.tool === 'sack';
      shadow(g, UAX, UAY - 1, 6, 2.3);
      legs(g, frame, '#4a5a2a', 22, 6, 10.2, 3.2, 2.4);
      // the sack rides on its back (drawn first: behind the body)
      if (full) {
        g.fillStyle = '#9a7a4a'; g.beginPath(); g.ellipse(7.5, 14, 6.2, 6.8, -0.25, 0, Math.PI * 2); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.8; g.stroke();
        line(g, 5, 9, 9, 8, '#6b5030', 1.2);
        circle(g, 6, 12.5, 1.3, '#f0c040', 'rgba(90,60,10,0.8)', 0.5); circle(g, 8.4, 11, 1.1, '#f6d870', null);
        line(g, 4.5, 17, 9.5, 16, 'rgba(70,50,30,0.6)', 0.7);
      } else {
        g.fillStyle = '#8a6a40'; g.beginPath(); g.ellipse(8.5, 15.5, 3, 3.6, -0.3, 0, Math.PI * 2); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.7; g.stroke();
      }
      // body: a ragged brown tunic
      poly(g, [9, 23, 17.5, 23, 17, 15, 13.5, 13, 10, 14.5], '#6e5a3a', INK, 0.8);
      line(g, 9.5, 21.5, 17, 21.5, '#4e3e26', 1);
      // arm with a knife
      const atk = frame === 3;
      line(g, 16, 16, atk ? 21.5 : 19, atk ? 13 : 19.5, '#7f9a3e', 1.8);
      line(g, atk ? 21.5 : 19, atk ? 13 : 19.5, atk ? 24.5 : 21, atk ? 10 : 22.5, '#d8dde4', 1.2);
      // head, ears, hood
      circle(g, 13.6, 10.5, 3.6, '#8aa848');
      poly(g, [10.5, 9.5, 4.5, 6.5, 10.6, 11.8], '#7f9a3e', INK, 0.6);
      poly(g, [16.7, 9.5, 22.5, 6.5, 16.6, 11.8], '#7f9a3e', INK, 0.6);
      g.fillStyle = '#5a4a32'; g.beginPath(); g.arc(13.6, 10, 3.9, Math.PI * 1.05, Math.PI * 1.95); g.lineTo(15.5, 6.5); g.closePath(); g.fill();
      circle(g, 12.4, 11, 0.85, '#ffe45a', null); circle(g, 15, 11, 0.85, '#ffe45a', null);
      poly(g, [13.7, 11.6, 16.6, 12.8, 13.9, 13.2], '#6f8a32', null); // long nose
    };
  },
  // Bog Witch: hunched under a moss shawl, long nose, a crooked staff hung with a marsh-light lantern.
  bogwitch(frame) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 7, 2.5);
      const atk = frame === 3;
      const sway = frame === 1 ? 0.6 : frame === 2 ? -0.6 : 0;
      // staff and lantern (behind the body on the far side)
      const sx = atk ? 21 : 19.5, top = atk ? 2.5 : 5;
      line(g, 18 + sway, 27.5, sx, top, '#4e3a24', 1.5);
      line(g, sx, top, sx + 2.5, top + 1.5, '#4e3a24', 1.2);
      line(g, sx + 2.5, top + 1.5, sx + 2.5, top + 4, '#2e2418', 0.6);
      rrect(g, sx + 1, top + 4, 3, 3.6, 0.8, '#c8f070', 'rgba(30,40,20,0.9)', 0.6);
      // skirt and shawl
      poly(g, [6.5 + sway, 27.5, 18.5 + sway, 27.5, 16.5, 17, 9, 17], '#3e4a32', INK, 0.8);
      line(g, 8 + sway, 25, 17.5 + sway, 25, '#2e3826', 0.8);
      poly(g, [7, 18.5, 18, 18.5, 16.5, 11.5, 13, 9.5, 8, 12], '#5f7a4a', INK, 0.8);
      for (let i = 0; i < 4; i++) line(g, 8.5 + i * 2.6, 18.5, 8 + i * 2.6, 20.5, '#4b6238', 1);
      // hunched head, hood, hooked nose, chin
      circle(g, 11, 11.5, 3.4, '#a7b98a');
      g.fillStyle = '#4a5a3a'; g.beginPath(); g.arc(11, 11, 4, Math.PI * 0.95, Math.PI * 2.05); g.lineTo(13, 9); g.closePath(); g.fill();
      poly(g, [8.4, 11.5, 5.4, 13.8, 8.6, 13], '#93a878', INK, 0.5);
      circle(g, 9.6, 11.4, 0.8, '#d8ff6a', null); circle(g, 12, 11.4, 0.8, '#d8ff6a', null);
      // gnarled hand on the staff
      line(g, 14, 15, sx - 0.5 + sway * 0.3, atk ? 12 : 14, '#a7b98a', 1.6);
      if (atk) { circle(g, sx + 2.5, top + 5.8, 3, 'rgba(200,255,110,0.35)', null); }
    };
  },
  // Frost Wraith: a pale-blue, half-transparent ghost with a crown of ice and a trailing tail.
  frostwraith(frame) {
    return (g) => {
      const b = frame === 1 ? 1 : frame === 2 ? -1 : 0;
      const gr = g.createLinearGradient(0, 3, 0, 31);
      gr.addColorStop(0, '#eaf7ff'); gr.addColorStop(0.45, '#a8d4ee'); gr.addColorStop(1, 'rgba(120,170,220,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(13, 4 + b);
      g.bezierCurveTo(21, 5 + b, 21.5, 15, 18.5, 21);
      g.bezierCurveTo(16.5, 26, 15 - b * 2, 29, 17 - b, 31);
      g.bezierCurveTo(12, 29, 8, 26, 7, 20);
      g.bezierCurveTo(5, 13, 6.5, 5 + b, 13, 4 + b);
      g.fill();
      g.strokeStyle = 'rgba(230,248,255,0.6)'; g.lineWidth = 0.7; g.stroke();
      // crown of ice
      for (const [x, h] of [[9.5, 4], [12, 6], [14.5, 5.2], [17, 3.6]]) poly(g, [x - 1.2, 6 + b, x, 6 + b - h, x + 1.2, 6 + b], '#f4fcff', 'rgba(120,170,220,0.8)', 0.5);
      // reaching arms
      const atk = frame === 3;
      line(g, 8, 14 + b, atk ? 2.5 : 4.5, atk ? 11 : 18, 'rgba(220,242,255,0.85)', 1.6);
      line(g, 18, 14 + b, atk ? 24 : 22, atk ? 11 : 18, 'rgba(220,242,255,0.85)', 1.6);
      // hollow eyes and mouth
      circle(g, 11, 10.5 + b, 1.3, '#1e3a5a', null); circle(g, 15, 10.5 + b, 1.3, '#1e3a5a', null);
      circle(g, 11, 10.5 + b, 0.5, '#e8fbff', null); circle(g, 15, 10.5 + b, 0.5, '#e8fbff', null);
      g.fillStyle = 'rgba(30,58,90,0.7)'; g.beginPath(); g.ellipse(13, 14 + b, 1.2, 1.8, 0, 0, Math.PI * 2); g.fill();
    };
  },
  // Ash Imp: a small, horned imp of glowing cinders with ember cracks and a flame-tipped tail.
  ashimp(frame) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 5.5, 2.1);
      const a = frame === 1 ? 2 : frame === 2 ? -2 : 0;
      line(g, 11 + a * 0.5, 22, 10.5 + a, 27.5, '#5a2418', 2);
      line(g, 15 - a * 0.5, 22, 15.5 - a, 27.5, '#5a2418', 2);
      // tail with a flame tip
      g.strokeStyle = '#7a2a18'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(9, 21); g.quadraticCurveTo(3, 21 + a * 0.5, 3.5, 15); g.stroke();
      poly(g, [3.5, 12, 5.5, 15.5, 3.5, 17, 1.5, 15.5], '#ffb347', null);
      // pot-bellied cinder body with cracks
      g.fillStyle = '#b8401f'; g.beginPath(); g.ellipse(13, 18.5, 5.2, 5, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.8; g.stroke();
      g.strokeStyle = '#ffd27a'; g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(10.5, 16); g.lineTo(12.5, 18.5); g.lineTo(11.5, 21); g.moveTo(14.5, 15.5); g.lineTo(15.5, 18); g.lineTo(14, 20.5); g.stroke();
      // claws
      const atk = frame === 3;
      line(g, 17, 17, atk ? 22 : 19.5, atk ? 13.5 : 20.5, '#9a3418', 1.6);
      line(g, 9, 17, atk ? 5 : 7, atk ? 14 : 20.5, '#9a3418', 1.6);
      // head with horns and burning eyes
      circle(g, 13, 11, 3.8, '#d0502a');
      poly(g, [10, 9, 8.2, 4, 11.5, 7.6], '#3a1a10', INK, 0.5);
      poly(g, [16, 9, 17.8, 4, 14.5, 7.6], '#3a1a10', INK, 0.5);
      circle(g, 11.6, 11, 0.95, '#fff2a0', null); circle(g, 14.4, 11, 0.95, '#fff2a0', null);
      if (atk) poly(g, [11.5, 13, 14.5, 13, 13, 14.8], '#ffd27a', null);
    };
  },
};

// ---- Riftspawner (44 x 44 box, feet at 22, 40) -------------------------------------------------------
const RW = 44, RH = 44, RAX = 22, RAY = 40;
function drawRiftspawner(g, frame) {
  const a = frame === 1 ? 2 : frame === 2 ? -2 : 0;
  const atk = frame === 3;
  shadow(g, RAX, RAY - 1, 15, 4, 0.36);
  // stumpy legs
  rect(g, 15 + a * 0.5, 31, 5, 9, '#4a4058', INK, 0.8); rect(g, 24 - a * 0.5, 31, 5, 9, '#4a4058', INK, 0.8);
  // the rift it hauls: a torn violet slit in a frame of bone, strapped to its back
  poly(g, [7, 28, 9, 6, 15, 3, 18, 8, 16, 30], '#cfc4b0', INK, 0.9);
  g.fillStyle = '#2a1840'; g.beginPath(); g.ellipse(12.4, 17, 3.6, 10, -0.08, 0, Math.PI * 2); g.fill();
  const gr = g.createRadialGradient(12.4, 17, 0.5, 12.4, 17, 9);
  gr.addColorStop(0, '#f4e8ff'); gr.addColorStop(0.35, '#b890ff'); gr.addColorStop(1, 'rgba(90,50,160,0)');
  g.fillStyle = gr; g.beginPath(); g.ellipse(12.4, 17, 2.6, 8.6, -0.08, 0, Math.PI * 2); g.fill();
  line(g, 9, 9, 21, 13, '#5a4630', 1.6); line(g, 8.5, 25, 22, 26, '#5a4630', 1.6);
  // bloated, hunched body
  g.fillStyle = '#6a5f7e'; g.beginPath(); g.ellipse(23, 24, 10.5, 9.5, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = INK; g.lineWidth = 1; g.stroke();
  g.fillStyle = '#7d7392'; g.beginPath(); g.ellipse(25, 26.5, 6.5, 5.5, 0, 0, Math.PI * 2); g.fill();
  // violet veins
  g.strokeStyle = 'rgba(190,150,255,0.8)'; g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(16, 20); g.quadraticCurveTo(20, 23, 18, 28); g.moveTo(28, 19); g.quadraticCurveTo(26, 23, 29, 27); g.stroke();
  // heavy arms
  line(g, 30, 20, atk ? 38 : 34, atk ? 15 : 31, '#5a5070', 3.6);
  circle(g, atk ? 38 : 34, atk ? 15 : 31.5, 2.6, '#4e4560', INK, 0.8);
  line(g, 16, 21, 14, 31, '#5a5070', 3.2);
  // small head sunk between the shoulders
  circle(g, 29, 14.5, 4.4, '#857a99', INK, 0.9);
  circle(g, 28, 14, 1, '#e8d8ff', null); circle(g, 30.6, 14, 1, '#e8d8ff', null);
  line(g, 27.5, 16.8, 31, 16.8, '#3e3450', 0.9);
}

// ---- Ash Wyvern (64 x 44 box, body anchor 32, 30; the ground shadow is drawn separately) -------------
const WW = 64, WH = 44, WAX = 32, WAY = 30;
// frame: 0 glide, 1 wings up, 2 wings down, 3 talons forward (strike)
function drawWyvern(g, frame) {
  const up = frame === 1 ? 1 : frame === 2 ? -1 : frame === 3 ? 0.6 : 0.2;
  const SK = '#8a5a48', SKD = '#5e3a2e', MEM = 'rgba(150,96,78,0.92)';
  // far wing
  const fy = 18 - up * (up > 0 ? 12 : 7);
  poly(g, [30, 20, 40, fy - 2, 52, fy + 1, 46, 21, 38, 22], shade('#8a5a48', -0.3), INK, 0.8);
  // tail
  g.strokeStyle = SKD; g.lineWidth = 2.4; g.beginPath(); g.moveTo(22, 25); g.quadraticCurveTo(12, 28, 4, 24 - up); g.stroke();
  poly(g, [2, 22 - up, 6, 23.5 - up, 3, 27 - up], SKD, INK, 0.6);
  // body
  g.fillStyle = SK; g.beginPath(); g.ellipse(30, 24, 10, 4.6, -0.1, 0, Math.PI * 2); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.9; g.stroke();
  g.fillStyle = '#c9a080'; g.beginPath(); g.ellipse(30, 26.5, 7, 1.7, -0.1, 0, Math.PI * 2); g.fill();
  // legs / talons
  if (frame === 3) {
    line(g, 32, 27, 38, 33, SKD, 2); line(g, 27, 27, 33, 34, SKD, 2);
    for (const [x, y] of [[38, 33], [33, 34]]) { line(g, x, y, x + 2.5, y + 1.5, '#e8e0d0', 0.9); line(g, x, y, x + 1, y + 2.6, '#e8e0d0', 0.9); }
  } else { line(g, 32, 27, 30, 31, SKD, 1.8); line(g, 27, 27, 25, 31, SKD, 1.8); }
  // neck and horned head
  poly(g, [36, 21, 44, 15, 49, 15.5, 52, 18, 47, 20, 41, 23], SK, INK, 0.9);
  poly(g, [45, 15.5, 47, 10.5, 48, 15.5], '#3a2820', null);
  circle(g, 48.5, 17, 0.9, '#ffb347', null);
  if (frame === 3) poly(g, [50, 19, 54, 21, 50, 21], '#f0e6d0', null);
  // near wing: a bat-like membrane on finger bones
  const ny = 20 - up * (up > 0 ? 16 : 9);
  poly(g, [26, 22, 34, ny - 3, 50, ny - 1, 58, ny + 6, 48, ny + 8, 40, 23], MEM, INK, 0.9);
  g.strokeStyle = SKD; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(34, ny - 3); g.lineTo(48, ny + 8); g.moveTo(34, ny - 3); g.lineTo(42, 22.5); g.moveTo(50, ny - 1); g.lineTo(48, ny + 8); g.stroke();
  line(g, 26, 22, 34, ny - 3, SK, 2);
}

// ---- Sprites -----------------------------------------------------------------------------------------
function bigSprite(type, frame, flip, scale) {
  const big = type === 'wyvern' ? [WW, WH, WAX, WAY, drawWyvern] : [RW, RH, RAX, RAY, drawRiftspawner];
  const [w, h, ax, ay, fn] = big;
  return sprite(`foe:${type}:${frame}:${flip ? 1 : 0}`, scale, w, h, ax, ay, (g) => {
    if (flip) { g.translate(w, 0); g.scale(-1, 1); }
    fn(g, frame);
  });
}
const bigKey = (type, frame, flip) => `foe:${type}:${frame}:${flip ? 1 : 0}`;

// UNIT_ART icons for the two big foes (dusk telegraph, Codex fallbacks): the big art shrunk into 26 x 32.
const ICONS = {
  riftspawner(frame) { return (g) => { g.save(); g.translate(13 - RAX * 0.62, 30 - RAY * 0.62); g.scale(0.62, 0.62); drawRiftspawner(g, frame); g.restore(); }; },
  wyvern(frame) { return (g) => { shadow(g, 13, 29, 7, 1.8, 0.3); g.save(); g.translate(13 - WAX * 0.42, 20 - WAY * 0.42); g.scale(0.42, 0.42); drawWyvern(g, frame === 0 ? 1 : frame); g.restore(); }; },
};

function frameOf(e) {
  const moving = Math.abs(e.x - e.px) + Math.abs(e.y - e.py) > 0.04;
  return e.atkT > 0 ? 3 : moving ? ((e.anim / 2.4) | 0) % 2 ? 1 : 2 : 0;
}
function flash(g, sp, key, scale, e, dx, dy, w, h) {
  if (!(e.hitT > 0)) return;
  const f = flashOf(sp, key, scale);
  g.globalAlpha = Math.min(1, e.hitT / 0.14) * (g.globalAlpha || 1); g.drawImage(f.c, dx, dy, w, h); g.globalAlpha = 1;
}
function wardenGlow(g, e, x, y, k) {
  if (e.affix !== 'warden') return;
  g.globalCompositeOperation = 'lighter';
  const gl = glowSprite('rgba(170,140,255,0.5)');
  g.drawImage(gl.c, x - 30 * k, y - 40 * k, 60 * k, 60 * k);
  g.globalCompositeOperation = 'source-over';
}
// Additive glow. `color` must be one of a few constant strings (glowSprite caches one canvas per
// colour); vary the strength with `a` instead.
function glow(g, color, x, y, r, a = 1) {
  g.globalCompositeOperation = 'lighter';
  const ga = g.globalAlpha;
  g.globalAlpha = ga * a;
  const gl = glowSprite(color);
  g.drawImage(gl.c, x - r, y - r, r * 2, r * 2);
  g.globalAlpha = ga;
  g.globalCompositeOperation = 'source-over';
}

const OPT_SACK = { tool: 'sack' }, OPT_NONE = {};
function drawSmall(g, e, x, y, time, scale) {
  const type = e.type;
  const frame = frameOf(e);
  const flip = e.face < 0;
  const opt = type === 'goblin' && e.loot ? OPT_SACK : OPT_NONE;
  const sp = unitSprite(type, frame, flip, scale, opt);
  const k = e.scale || 1;
  let bob = 0;
  if (type === 'frostwraith') bob = Math.sin(time * 3.4 + e.id) * 2 - 3;
  const w = sp.w * k, h = sp.h * k, dx = x - sp.ax * k, dy = y + bob - sp.ay * k;
  wardenGlow(g, e, x, y, k);
  if (type === 'ashimp') glow(g, 'rgba(255,120,40,0.55)', x, y - 12 * k, (12 + Math.sin(time * 9 + e.id) * 1.5) * k);
  if (type === 'frostwraith') {
    glow(g, 'rgba(150,210,255,0.35)', x, y - 14 + bob, 15 * k);
    g.globalAlpha = 0.8;
  }
  g.drawImage(sp.c, dx, dy, w, h);
  flash(g, sp, `u:${type}:${frame}:${flip ? 1 : 0}:${opt.tool || ''}:0:`, scale, e, dx, dy, w, h);
  g.globalAlpha = 1;
  if (type === 'bogwitch') {
    // the lantern's marsh-light flickers
    const lx = x + (flip ? -1 : 1) * ((frame === 3 ? 22.5 : 21) - UAX) * k, ly = y + ((frame === 3 ? 8 : 10.8) - UAY) * k;
    glow(g, 'rgba(190,255,110,0.6)', lx, ly, (5 + Math.sin(time * 13 + e.id) * 0.8) * k);
  }
}

// Wyverns on the wing are drawn after every sorted sprite (BUS.draw.world) so they pass over roofs.
let afterWorld = true;
const wing = [];
function drawWyvernAt(g, e, x, y, time, scale) {
  const z = e.z || 0;
  const k = (e.scale || 1) / (FOES.wyvern.drawScale || 1);
  const flip = e.face < 0;
  let frame;
  if (e.fz === 'strike' || e.atkT > 0) frame = 3;
  else if (e.fz === 'dive') frame = 0;
  else frame = 1 + (((time * 4.2 + e.id * 0.37) | 0) % 2);
  const sp = bigSprite('wyvern', frame, flip, scale);
  const bob = e.fz === 'fly' ? Math.sin(time * 4.2 * Math.PI + e.id) * 1.2 : 0;
  const w = sp.w * k, h = sp.h * k, dx = x - sp.ax * k, dy = y - z - bob - sp.ay * k + 6;
  wardenGlow(g, e, x, y - z, k);
  g.drawImage(sp.c, dx, dy, w, h);
  flash(g, sp, bigKey('wyvern', frame, flip), scale, e, dx, dy, w, h);
}
function wyvernShadow(g, e, x, y) {
  const z = e.z || 0;
  const f = Math.max(0.35, 1 - z / 40);
  const k = (e.scale || 1) / (FOES.wyvern.drawScale || 1);
  g.fillStyle = `rgba(15,10,25,${0.32 * f})`;
  g.beginPath(); g.ellipse(x, y, 16 * k * (0.7 + 0.3 * f), 4.5 * k, 0, 0, Math.PI * 2); g.fill();
}

/** BUS.draw.entity[type] for every Phase 4 foe. */
export function drawFoe(g, e, x, y, time, scale) {
  const type = e.type;
  if (type === 'wyvern') {
    wyvernShadow(g, e, x, y);
    if (!afterWorld && (e.z || 0) > 4) { if (wing.length < 128) wing.push(e, x, y, scale); return; }
    drawWyvernAt(g, e, x, y, time, scale);
    return;
  }
  if (type === 'riftspawner') {
    const frame = frameOf(e);
    const flip = e.face < 0;
    const k = (e.scale || 1) / (FOES.riftspawner.drawScale || 1);
    const sp = bigSprite('riftspawner', frame, flip, scale);
    const w = sp.w * k, h = sp.h * k, dx = x - sp.ax * k, dy = y - sp.ay * k;
    wardenGlow(g, e, x, y, k);
    g.drawImage(sp.c, dx, dy, w, h);
    flash(g, sp, bigKey('riftspawner', frame, flip), scale, e, dx, dy, w, h);
    // the rift pulses
    const pulse = 0.5 + 0.5 * Math.sin(time * 3 + e.id);
    const rx = x + (flip ? 1 : -1) * (RAX - 12.4) * k, ry = y + (17 - RAY) * k;
    glow(g, 'rgba(180,130,255,0.6)', rx, ry, (11 + pulse * 3) * k, 0.58 + 0.42 * pulse);
    return;
  }
  drawSmall(g, e, x, y, time, scale);
}

// ---- World overlays ------------------------------------------------------------------------------------
function eAt(s, id) { const e = s.rt.eById.get(id); return e && e.alive ? e : null; }
function inView(view, x, y, pad = 40) { return x > view.x0 - pad && x < view.x1 + pad && y > view.y0 - pad && y < view.y1 + pad; }

function onGround(g, s, view, time) {
  afterWorld = false;
  wing.length = 0;
  // Bog Witch curse: a slow green ring where her hex saps your soldiers.
  const r = FOE_RULES.bogwitch.radius * T;
  for (const e of s.enemies) {
    if (!e.alive || e.type !== 'bogwitch' || !inView(view, e.x, e.y, r)) continue;
    if (!s.fog[idx(Math.min(N - 1, Math.max(0, (e.x / T) | 0)), Math.min(N - 1, Math.max(0, (e.y / T) | 0)))]) continue;
    const p = 0.5 + 0.5 * Math.sin(time * 2 + e.id);
    g.save();
    g.translate(e.x, e.y); g.scale(1, 0.6);
    g.fillStyle = `rgba(90,140,40,${0.1 + 0.05 * p})`;
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(30,45,15,0.45)'; g.lineWidth = 4.5;
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
    g.setLineDash([9, 7]); g.lineDashOffset = -time * 8;
    g.strokeStyle = `rgba(200,250,100,${0.65 + 0.25 * p})`; g.lineWidth = 2.6;
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    g.restore();
  }
}

function onWorld(g, s, view, time) {
  afterWorld = true;
  for (let i = 0; i < wing.length; i += 4) drawWyvernAt(g, wing[i], wing[i + 1], wing[i + 2], time, wing[i + 3]);
  wing.length = 0;
  // Frost on chilled friendlies.
  const X = s.ext && s.ext.foes;
  if (X && X.chill.length) {
    for (const id of X.chill) {
      const u = eAt(s, id);
      if (!u || !(u.chillT > s.time) || !inView(view, u.x, u.y)) continue;
      g.strokeStyle = 'rgba(180,225,255,0.85)'; g.lineWidth = 1.4;
      g.beginPath(); g.ellipse(u.x, u.y - 1, 8, 3.4, 0, 0, Math.PI * 2); g.stroke();
      for (let k = 0; k < 3; k++) {
        const a = time * 1.5 + k * 2.1 + u.id;
        const cx = u.x + Math.cos(a) * 7, cy = u.y - 12 + Math.sin(a * 1.3) * 5;
        g.strokeStyle = 'rgba(230,248,255,0.9)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(cx - 2.2, cy); g.lineTo(cx + 2.2, cy); g.moveTo(cx, cy - 2.2); g.lineTo(cx, cy + 2.2); g.stroke();
      }
    }
  }
}

// Hex bolts (from 'foeHex' events), drawn above the night.
const beams = [];
function onOverlay(g, s, view, time) {
  // Loot sacks and the Riftspawner's priority mark stay readable in the dark.
  for (const e of s.enemies) {
    if (!e.alive || !inView(view, e.x, e.y)) continue;
    if (e.type === 'goblin' && e.loot) {
      const c = RES_COL[e.loot.k] || '#f0c040';
      // above the health bar (drawn at y - 30 * scale)
      const bob = Math.sin(time * 6 + e.id) * 1.2, cy = e.y - 30 * (e.scale || 1) - 9 + bob;
      circle(g, e.x, cy, 4, c, 'rgba(30,20,10,0.9)', 1.2);
      g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.arc(e.x - 1.2, cy - 1.2, 1.2, 0, Math.PI * 2); g.fill();
    } else if (e.type === 'riftspawner') {
      const k = e.scale || 1;
      const yy = e.y - 50 * k / 1.4 - 6 + Math.sin(time * 4 + e.id) * 1.5;
      g.fillStyle = 'rgba(200,160,255,0.9)'; g.strokeStyle = 'rgba(30,15,50,0.9)'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(e.x - 5, yy - 5); g.lineTo(e.x + 5, yy - 5); g.lineTo(e.x, yy + 1); g.closePath(); g.fill(); g.stroke();
    }
  }
  if (!beams.length) return;
  g.globalCompositeOperation = 'lighter';
  for (let i = beams.length - 1; i >= 0; i--) {
    const b = beams[i];
    const u = (time - b.t) / 0.35;
    if (u >= 1 || u < 0) { beams.splice(i, 1); continue; }
    const a = 1 - u;
    const mx = (b.x + b.tx) / 2, my = Math.min(b.y, b.ty) - 14;
    g.strokeStyle = `rgba(190,255,110,${0.8 * a})`; g.lineWidth = 3 * a + 1;
    g.beginPath(); g.moveTo(b.x, b.y); g.quadraticCurveTo(mx, my, b.tx, b.ty); g.stroke();
    g.strokeStyle = `rgba(250,255,220,${0.9 * a})`; g.lineWidth = 1;
    g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
}

function onLights(s, push) {
  for (const e of s.enemies) {
    if (!e.alive) continue;
    const t = e.type;
    if (!FOES[t]) continue;
    const k = e.scale || 1;
    if (t === 'ashimp') push(e.x, e.y - 12, 1.3 * T, 0.6);
    else if (t === 'bogwitch') push(e.x, e.y - 18, 1.6 * T, 0.55);
    else if (t === 'riftspawner') push(e.x, e.y - 22, 1.8 * T, 0.6);
    else if (t === 'frostwraith') push(e.x, e.y - 14, 1.1 * T, 0.4);
    else if (t === 'wyvern') push(e.x, e.y - (e.z || 0) - 10, 12 * k, 0.3);
    else push(e.x, e.y - 10, 10 * k, 0.25);
  }
}

// ---- Events -----------------------------------------------------------------------------------------------
function onFx(ctl, ev) {
  const t = ev.t;
  if (t !== 'foeSteal' && t !== 'foeEscape' && t !== 'foeBirth' && t !== 'foeHex' && t !== 'foeChill' && t !== 'foeBlast') return;
  const P = ctl.renderer && ctl.renderer.particles;
  if (!P) return;
  const on = ctl.onScreen ? ctl.onScreen(ev.x, ev.y) : true;
  if (t === 'foeHex') {
    beams.push({ x: ev.x, y: ev.y, tx: ev.tx, ty: ev.ty, t: ctl.renderer.time });
    if (beams.length > 40) beams.shift();
    if (on) P.burst('spark', ev.tx, ev.ty, 6, { speed: 40, color: ['#c8ff70', '#eaffb0'], life: 0.4, size: 2.2, add: true });
    return;
  }
  if (!on) return;
  switch (t) {
    case 'foeSteal':
      P.spawn('text', ev.x, ev.y - 6, { vy: -24, life: 1.2, size: 14, text: `-${ev.a} ${ev.k}`, color: '#ff9a7a', drag: 0.9 });
      P.burst('spark', ev.x, ev.y, 8, { speed: 50, color: RES_COL[ev.k] || '#f0c040', life: 0.5, size: 2.2, add: true });
      break;
    case 'foeEscape':
      P.burst('puff', ev.x, ev.y - 6, 8, { speed: 30, color: '#8a7a68', life: 0.7, size: 5 });
      break;
    case 'foeBirth':
      P.spawn('ring', ev.x, ev.y, { life: 0.5, size: 40, color: '#c8a8ff', add: true });
      P.burst('ember', ev.x, ev.y, 14, { speed: 60, color: ['#b890ff', '#f4e8ff', '#7a50c8'], life: 0.8, size: 2.4, add: true });
      break;
    case 'foeChill':
      P.burst('spark', ev.x, ev.y, 8, { speed: 40, color: ['#d8f2ff', '#a8d4ee', '#ffffff'], life: 0.6, size: 2.2, add: true });
      break;
    case 'foeBlast':
      P.spawn('ring', ev.x, ev.y, { life: 0.45, size: ev.r * 2, color: '#ff9a3a', add: true });
      P.burst('ember', ev.x, ev.y, 22, { speed: 110, color: ['#ffd27a', '#ff8a3a', '#e0502a'], life: 0.6, size: 2.8, add: true, drag: 0.85 });
      P.burst('puff', ev.x, ev.y - 4, 6, { speed: 30, color: '#5a4a44', life: 0.9, size: 6 });
      if (ctl.shake) ctl.shake(2);
      break;
  }
}

// ---- Registration ------------------------------------------------------------------------------------------
let done = false;
export function register() {
  if (done) return;
  done = true;
  for (const [id, fn] of Object.entries(FOE_UNIT_ART)) UNIT_ART[id] = fn;
  for (const [id, fn] of Object.entries(ICONS)) UNIT_ART[id] = fn;
  for (const id of Object.keys(FOES)) BUS.draw.entity[id] = drawFoe;
  BUS.draw.ground.push(onGround);
  BUS.draw.world.push(onWorld);
  BUS.draw.overlay.push(onOverlay);
  BUS.draw.lights.push(onLights);
  BUS.fx.push(onFx);
}

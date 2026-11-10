// Hero art (Phase 3): eight class miniatures with a coloured class cape and a
// small gold circlet so heroes read as heroes, plus the Tavern building, a
// portrait drawer for the HUD, and cosmetic ability effects. Same tabletop style
// and helpers as sprites.js; every sprite is cached per scale.
import { ART, BUILDING_ART, sprite, flashOf } from './sprites.js';
import { HERO_CLASSES } from '../data/heroes.js';
import { BUS } from '../game/hooks.js';

const { INK, shadow, poly, rect, rrect, circle, line, shade, roof, windowLit, banner } = ART;
const T = 32;
const W = 28, H = 34, AX = 14, AY = 30; // a touch larger than soldiers (26x32)
export const HERO_FRAMES = { idle: 0, walkA: 1, walkB: 2, attack: 3 };

// ---- Shared body parts (centre x = 14) --------------------------------------------------
function legs(g, f, color, y = 23) {
  const a = f === 1 ? 2 : f === 2 ? -2 : 0;
  rect(g, 11 + a * 0.5, y, 2.8, 6 - Math.max(0, a), color, 'rgba(25,18,12,0.7)', 0.6);
  rect(g, 14.4 - a * 0.5, y, 2.8, 6 - Math.max(0, -a), color, 'rgba(25,18,12,0.7)', 0.6);
}
function torso(g, color, trim, y = 13, w = 12, h = 11) {
  rrect(g, 14 - w / 2, y, w, h, 3, color);
  if (trim) rect(g, 14 - 1.5, y + 1, 3, h - 2, trim, null);
  rect(g, 14 - w / 2 + 0.5, y + h - 3, w - 1, 1.6, 'rgba(60,40,20,0.85)', null);
}
function cape(g, color, f) {
  const sway = f === 1 ? 1 : f === 2 ? -1 : 0;
  poly(g, [8, 13, 20, 13, 22 + sway, 27, 6 + sway, 27], color, INK, 0.8);
  poly(g, [9, 13, 19, 13, 18, 16, 10, 16], shade(color, 0.18), null);
}
function head(g, skin = '#e8c49a', y = 9, r = 3.9) { circle(g, 14, y, r, skin); }
// The gold circlet that marks every hero.
function circlet(g, y = 7.4, w = 4.4) {
  g.strokeStyle = '#f6d15a'; g.lineWidth = 1.3;
  g.beginPath(); g.ellipse(14, y, w, 1.5, 0, Math.PI * 0.05, Math.PI * 0.95, true); g.stroke();
  circle(g, 14, y - 1.2, 1.1, '#fff0a0', 'rgba(120,80,10,0.8)', 0.5);
}

// ---- Class miniatures -----------------------------------------------------------------------
export const HERO_ART = {
  paladin(f, c) {
    return (g) => {
      shadow(g, AX, AY - 1, 7.5, 2.8, 0.32);
      cape(g, c.cape, f);
      legs(g, f, '#8a8e98');
      torso(g, '#c9ced8', '#e8c25a', 13, 13, 11);
      rrect(g, 7, 12, 4, 4, 1.5, '#dfe3ea'); rrect(g, 17, 12, 4, 4, 1.5, '#dfe3ea');
      head(g, '#ebc79f', 9, 4);
      circlet(g);
      // kite shield with a sun
      poly(g, [4, 15, 10, 15, 10, 21, 7, 25, 4, 21], '#3e6fb0', INK, 0.8);
      circle(g, 7, 19, 1.8, '#f0c040', null);
      const a = f === 3;
      line(g, 19, 19, a ? 27 : 21, a ? 12 : 3, '#eef2f8', 2.1);
      line(g, a ? 18 : 18, a ? 20 : 17, a ? 21 : 24, a ? 17 : 17, '#c8902e', 1.6);
    };
  },
  ranger(f, c) {
    return (g) => {
      shadow(g, AX, AY - 1, 7, 2.6);
      cape(g, c.cape, f);
      legs(g, f, '#4a4030');
      torso(g, '#5f7f3e', '#3e5a2c', 13, 11, 11);
      head(g, '#e0b88e', 9);
      // hood pushed back, circlet on the brow
      g.fillStyle = '#3e5a2c'; g.beginPath(); g.arc(14, 9.5, 4.8, Math.PI * 0.9, Math.PI * 0.1); g.lineTo(17, 13); g.lineTo(11, 13); g.closePath(); g.fill();
      circlet(g, 7.6);
      rect(g, 8, 12, 3, 9, '#6b4a2d', null);
      line(g, 8.5, 12, 7.5, 9, '#e8dcc0', 0.8); line(g, 10, 12, 10, 9, '#e8dcc0', 0.8);
      // longbow
      const a = f === 3;
      g.strokeStyle = '#7a5a3a'; g.lineWidth = 1.7; g.beginPath(); g.arc(a ? 17 : 18, 16, 8.5, -1.25, 1.25); g.stroke();
      const bx = a ? 17 : 18;
      line(g, bx + Math.cos(-1.25) * 8.5, 16 + Math.sin(-1.25) * 8.5, a ? bx - 1 : bx + Math.cos(1.25) * 8.5, a ? 16 : 16 + Math.sin(1.25) * 8.5, '#f0ead8', 0.6);
      if (a) line(g, bx - 1, 16, bx + Math.cos(1.25) * 8.5, 16 + Math.sin(1.25) * 8.5, '#f0ead8', 0.6);
    };
  },
  rogue(f, c) {
    return (g) => {
      shadow(g, AX, AY - 1, 6.5, 2.4);
      cape(g, c.cape, f);
      legs(g, f, '#2e2a36');
      torso(g, '#4a4058', '#8a7ab8', 14, 10, 10);
      head(g, '#d8b08a', 9.5, 3.7);
      // cowl and mask
      g.fillStyle = '#2e2838'; g.beginPath(); g.arc(14, 9.5, 4.6, Math.PI, 0); g.lineTo(18.6, 12); g.lineTo(9.4, 12); g.closePath(); g.fill();
      rect(g, 10.4, 10, 7.2, 2, '#1e1a26', null);
      circle(g, 12.6, 9, 0.7, '#f0e6ff', null); circle(g, 15.4, 9, 0.7, '#f0e6ff', null);
      circlet(g, 6.6, 3.8);
      const a = f === 3;
      line(g, 19, 18, a ? 26 : 21, a ? 15 : 22, '#dfe4ea', 1.4);
      line(g, 9, 18, a ? 4 : 7, a ? 21 : 23, '#dfe4ea', 1.4);
    };
  },
  pyromancer(f, c) {
    return (g) => {
      shadow(g, AX, AY - 1, 7, 2.6);
      cape(g, c.cape, f);
      // long robe instead of legs
      const a = f === 1 ? 1 : f === 2 ? -1 : 0;
      poly(g, [9, 15, 19, 15, 21 + a, 29, 7 + a, 29], '#b8442c', INK, 0.8);
      line(g, 14, 16, 14 + a * 0.5, 29, '#f0a050', 1.2);
      torso(g, '#c8503a', '#f0a050', 12, 11, 7);
      head(g, '#ebc79f', 8.5, 3.8);
      // wild hair and circlet
      g.fillStyle = '#e06a2a'; g.beginPath(); g.arc(14, 7.5, 4.2, Math.PI * 1.05, Math.PI * -0.05); g.fill();
      circlet(g, 7.2);
      // staff with a flame
      const at = f === 3;
      const sx = at ? 23 : 21, sy = at ? 4 : 2;
      line(g, 19, 26, sx, sy + 3, '#6b4a2d', 1.6);
      circle(g, sx, sy, 2.8, '#ffb347', '#a8441c', 0.7);
      circle(g, sx, sy - 0.6, 1.4, '#fff2b0', null);
      if (at) { circle(g, sx + 3, sy - 2, 1.5, '#ffcf6a', null); circle(g, sx + 1, sy - 4, 1, '#ffe8a0', null); }
    };
  },
  cleric(f, c) {
    return (g) => {
      shadow(g, AX, AY - 1, 7, 2.6);
      cape(g, c.cape, f);
      const a = f === 1 ? 1 : f === 2 ? -1 : 0;
      poly(g, [9, 15, 19, 15, 20 + a, 29, 8 + a, 29], '#efe6cc', INK, 0.8);
      rect(g, 13, 16, 2, 12, '#c8a040', null);
      torso(g, '#f6eed8', '#c8a040', 12, 11, 7);
      head(g, '#e8c49a', 8.5, 3.8);
      g.fillStyle = '#a07a4a'; g.beginPath(); g.arc(14, 7.6, 4, Math.PI, 0); g.fill();
      circlet(g, 7.2);
      // mace and a glowing holy symbol
      const at = f === 3;
      line(g, 19, 19, at ? 25 : 21, at ? 11 : 9, '#6b4a2d', 1.6);
      circle(g, at ? 25.5 : 21.2, at ? 10 : 7.5, 2.4, '#d8dde4', INK, 0.7);
      circle(g, 8.5, 18, 2.3, '#fff2b0', 'rgba(160,120,40,0.9)', 0.7);
      line(g, 8.5, 16.6, 8.5, 19.4, '#c8a040', 0.8); line(g, 7.1, 18, 9.9, 18, '#c8a040', 0.8);
    };
  },
  warlord(f, c) {
    return (g) => {
      shadow(g, AX, AY - 1, 8.5, 3, 0.34);
      cape(g, c.cape, f);
      legs(g, f, '#4a3428');
      torso(g, '#8a4a34', '#c8503e', 12, 14, 12);
      // fur mantle
      for (let i = 0; i < 5; i++) circle(g, 8.5 + i * 2.8, 12.5, 2, '#6a5a48', null);
      head(g, '#c99a6e', 8.4, 4.2);
      // topknot and circlet
      circle(g, 14, 3.4, 1.6, '#3a2a20', null);
      circlet(g, 6.9, 4.6);
      // great axe
      const a = f === 3;
      const hx = a ? 26 : 22, hy = a ? 9 : 1;
      line(g, a ? 17 : 20, a ? 23 : 25, hx, hy, '#6b4a2d', 1.9);
      poly(g, a ? [hx - 1, hy - 4, hx + 4, hy - 1, hx + 2, hy + 4, hx - 2, hy + 1] : [hx - 4, hy + 1, hx + 1, hy - 1, hx + 4, hy + 3, hx - 1, hy + 6], '#c8ccd2', INK, 0.7);
    };
  },
  beastmaster(f, c) {
    return (g) => {
      shadow(g, AX, AY - 1, 7.5, 2.7);
      cape(g, c.cape, f);
      legs(g, f, '#4a3a2a');
      torso(g, '#7a6040', '#a8844a', 13, 12, 11);
      head(g, '#d8a878', 9, 3.9);
      // wolf-pelt hood with ears
      g.fillStyle = '#8a8070'; g.beginPath(); g.arc(14, 8.8, 4.8, Math.PI * 0.95, Math.PI * 0.05); g.lineTo(18.6, 11); g.lineTo(9.4, 11); g.closePath(); g.fill();
      poly(g, [9.6, 6, 10.6, 2, 12.4, 5], '#8a8070', INK, 0.5); poly(g, [15.6, 5, 17.4, 2, 18.4, 6], '#8a8070', INK, 0.5);
      circlet(g, 7.4);
      // hunting spear
      const a = f === 3;
      line(g, a ? 9 : 19, a ? 21 : 26, a ? 27 : 20, a ? 13 : -1, '#7a5a3a', 1.5);
      poly(g, a ? [26, 11.5, 30, 12.5, 26.6, 15] : [19, -1, 21, -1, 20, -6], '#d8dde4', INK, 0.6);
      // feather of the hawk
      line(g, 9.5, 6, 7, 2.5, '#d8c8a0', 1.1);
    };
  },
  runesmith(f, c) {
    return (g) => {
      shadow(g, AX, AY - 1, 8, 2.9, 0.33);
      cape(g, c.cape, f);
      // short and broad
      const a = f === 1 ? 2 : f === 2 ? -2 : 0;
      rect(g, 10.5 + a * 0.4, 24, 3.4, 5 - Math.max(0, a * 0.5), '#3a3a44', INK, 0.6);
      rect(g, 14.6 - a * 0.4, 24, 3.4, 5 - Math.max(0, -a * 0.5), '#3a3a44', INK, 0.6);
      torso(g, '#6a7480', '#7ab8d8', 14, 15, 11);
      head(g, '#e0b08a', 11, 4.1);
      // great beard
      poly(g, [10, 11.5, 18, 11.5, 17, 18, 14, 20, 11, 18], '#c8743a', INK, 0.6);
      line(g, 14, 13, 14, 19, '#a85a2a', 0.8);
      // helm and circlet
      g.fillStyle = '#8a929c'; g.beginPath(); g.arc(14, 10, 4.3, Math.PI, 0); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.6; g.stroke();
      circlet(g, 9.4, 4.4);
      // rune hammer
      const at = f === 3;
      const hx = at ? 23 : 21, hy = at ? 9 : 5;
      line(g, 19, 22, hx, hy + 2, '#6b4a2d', 1.7);
      rect(g, hx - 3.5, hy - 2, 7, 5, '#7d838c');
      rect(g, hx - 1, hy - 1, 2, 3, '#9ae8ff', null);
    };
  },
};

function classOf(cls) { return HERO_CLASSES[cls] || HERO_CLASSES.paladin; }

/** Cached hero sprite: frame 0 idle, 1/2 walk, 3 attack. */
export function heroSprite(cls, frame, flip, scale) {
  const key = `hero:${cls}:${frame}:${flip ? 1 : 0}`;
  return sprite(key, scale, W, H, AX, AY, (g) => {
    if (flip) { g.translate(W, 0); g.scale(-1, 1); }
    (HERO_ART[cls] || HERO_ART.paladin)(frame, classOf(cls))(g);
  });
}

// ---- Selection (set by the UI; cosmetic only) ------------------------------------------------
let selectedId = 0;
export function setSelectedHero(id) { selectedId = id || 0; }

// ---- Hawk (Beastmaster) ----------------------------------------------------------------------
function drawHawk(g, x, y, time) {
  const flap = Math.sin(time * 14) * 3;
  g.fillStyle = '#5a4030'; g.strokeStyle = 'rgba(20,14,10,0.7)'; g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(x - 9, y - flap); g.quadraticCurveTo(x - 3, y - 3, x, y); g.quadraticCurveTo(x + 3, y - 3, x + 9, y - flap);
  g.quadraticCurveTo(x + 3, y + 1, x, y + 3); g.quadraticCurveTo(x - 3, y + 1, x - 9, y - flap);
  g.fill(); g.stroke();
  g.fillStyle = '#f0e0b0'; g.beginPath(); g.arc(x, y - 1, 1.3, 0, 6.283); g.fill();
}

/** BUS.draw.entity.hero */
export function drawHero(g, e, x, y, time, scale) {
  const c = classOf(e.cls);
  const moving = Math.abs(e.x - e.px) + Math.abs(e.y - e.py) > 0.04;
  const frame = e.atkT > 0 ? 3 : moving ? (((e.anim / 2.4) | 0) % 2 ? 1 : 2) : 0;
  const flip = e.face < 0;
  const k = 1.12;
  // Ground ring in the class colour; brighter when selected.
  const sel = selectedId === e.id;
  g.strokeStyle = sel ? 'rgba(255,236,150,0.95)' : hexA(c.color, 0.55);
  g.lineWidth = sel ? 2 : 1.2;
  g.beginPath(); g.ellipse(x, y - 1, sel ? 11 : 9, sel ? 4.6 : 3.6, 0, 0, Math.PI * 2); g.stroke();
  if (sel) { g.fillStyle = 'rgba(255,230,140,0.16)'; g.fill(); }
  // Ability glow (heal, rune burst, war cry).
  if (e.castT > 0) {
    g.globalAlpha = Math.min(1, e.castT / 0.4) * 0.5;
    g.fillStyle = c.color; g.beginPath(); g.arc(x, y - 14, 14, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
  }
  const sp = heroSprite(e.cls, frame, flip, scale);
  const w = sp.w * k, h = sp.h * k;
  const dx = x - sp.ax * k, dy = y - sp.ay * k;
  g.drawImage(sp.c, dx, dy, w, h);
  if (e.hitT > 0) {
    const fl = flashOf(sp, `hero:${e.cls}:${frame}:${flip ? 1 : 0}`, scale);
    g.globalAlpha = Math.min(1, e.hitT / 0.14); g.drawImage(fl.c, dx, dy, w, h); g.globalAlpha = 1;
  }
  // Order marker while rallied.
  if (e.rallyT > 0) {
    line(g, x + 9, y - 30, x + 9, y - 42, '#5a4330', 1.2);
    poly(g, [x + 9, y - 42, x + 17, y - 40, x + 9, y - 37], '#f0c040', 'rgba(30,20,10,0.6)', 0.6);
  } else if (e.retreat) {
    g.fillStyle = 'rgba(240,120,100,0.95)'; g.font = 'bold 14px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillText('!', x, y - 34);
  }
  if (e.hawkT > 0) {
    const a = time * 2.4 + e.id;
    drawHawk(g, e.hawkX + Math.cos(a) * 18, e.hawkY + Math.sin(a) * 8 - 26, time);
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Portrait for HUD buttons and cards: draws the idle hero filling w x h. */
export function drawHeroPortrait(g, cls, w, h) {
  const c = classOf(cls);
  g.clearRect(0, 0, w, h);
  const gr = g.createRadialGradient(w / 2, h * 0.45, 2, w / 2, h * 0.45, w * 0.7);
  gr.addColorStop(0, hexA(c.color, 0.45)); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  const sp = heroSprite(cls, 0, false, 3);
  // Crop to the upper body so the face reads at small sizes.
  const sw = sp.c.width, sh = sp.c.height;
  g.drawImage(sp.c, 0, 0, sw, sh * 0.9, w * 0.02, -h * 0.02, w * 0.96, h * 1.06);
}

/** Cosmetic ability effects queued by the sim in s.rt.heroFx (draw.world). */
export function drawHeroFx(g, s) {
  const L = s.rt && s.rt.heroFx;
  if (!L || !L.length) return;
  let w = 0;
  for (let i = 0; i < L.length; i++) {
    const f = L[i];
    const age = s.time - f.t;
    if (age > 0.6 || age < 0) continue;
    L[w++] = f;
    const u = age / 0.6;
    const color = f.k === 'heal' ? '120,240,140' : f.k === 'fire' ? '255,150,60' : f.k === 'rune' ? '140,220,255' : '255,110,80';
    g.strokeStyle = `rgba(${color},${(1 - u) * 0.85})`; g.lineWidth = 2.2;
    g.beginPath(); g.ellipse(f.x, f.y - 4, f.r * (0.4 + u * 0.6), f.r * (0.4 + u * 0.6) * 0.5, 0, 0, Math.PI * 2); g.stroke();
    if (f.k === 'heal') {
      g.fillStyle = `rgba(${color},${1 - u})`;
      g.fillRect(f.x - 1.5, f.y - 24 - u * 10, 3, 9); g.fillRect(f.x - 4.5, f.y - 21 - u * 10, 9, 3);
    }
  }
  L.length = w;
}

// ---- Tavern ------------------------------------------------------------------------------------
export const TAVERN_ART = {
  tavern(level, her) {
    const S = 2 * T, top = 40 + level * 8;
    return {
      w: S + 12, h: S + top + 4, ax: 6, ay: top,
      draw(g) {
        const ox = 6, oy = top;
        shadow(g, ox + S / 2, oy + S - 4, S / 2, 7, 0.26);
        // yard and porch
        rrect(g, ox + 2, oy + S - 18, S - 4, 14, 3, '#8a6e4a', 'rgba(30,22,16,0.4)', 0.6);
        // main hall
        const wy = oy + 6 - level * 8;
        rect(g, ox + 6, wy, S - 12, oy + S - 16 - wy, '#d9c49a');
        // timber frame
        for (const xx of [ox + 6, ox + 22, ox + S - 22, ox + S - 6]) line(g, xx, wy, xx, oy + S - 16, '#6b4a2d', 1.4);
        line(g, ox + 6, wy + 10, ox + S - 6, wy + 10, '#6b4a2d', 1.2);
        if (level >= 1) line(g, ox + 6, wy + 22, ox + S - 6, wy + 22, '#6b4a2d', 1.2);
        // door and warm windows
        g.fillStyle = '#4a3020'; g.beginPath(); g.moveTo(ox + S / 2 - 6, oy + S - 16); g.lineTo(ox + S / 2 - 6, oy + S - 28); g.arc(ox + S / 2, oy + S - 28, 6, Math.PI, 0); g.lineTo(ox + S / 2 + 6, oy + S - 16); g.closePath(); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.8; g.stroke();
        windowLit(g, ox + 10, oy + S - 30, 8, 7); windowLit(g, ox + S - 18, oy + S - 30, 8, 7);
        windowLit(g, ox + 12, wy + 2, 6, 6); windowLit(g, ox + S - 18, wy + 2, 6, 6);
        if (level >= 1) { windowLit(g, ox + 12, wy + 13, 6, 6); windowLit(g, ox + S - 18, wy + 13, 6, 6); }
        // roof and chimney
        roof(g, ox + 3, ox + S - 3, wy + 1, wy - 16, wy - 22, level >= 1 ? '#6f3f2a' : '#8e5a34', 3);
        rect(g, ox + S - 20, wy - 26, 6, 12, '#8a7f72');
        // hanging sign with a tankard
        line(g, ox + S - 6, oy + S - 34, ox + S + 4, oy + S - 34, '#5a4330', 1.4);
        rrect(g, ox + S - 3, oy + S - 33, 9, 9, 2, '#a8784a', INK, 0.7);
        rect(g, ox + S - 1, oy + S - 31, 4, 5, '#f0c040', 'rgba(60,35,15,0.8)', 0.5);
        g.strokeStyle = '#f0c040'; g.lineWidth = 0.9; g.beginPath(); g.arc(ox + S + 3.4, oy + S - 28.5, 1.4, -1.4, 1.4); g.stroke();
        // barrels on the porch
        for (const bx of [ox + 8, ox + 15]) { rrect(g, bx, oy + S - 22, 6, 8, 2, '#8a5a34', INK, 0.6); line(g, bx, oy + S - 19, bx + 6, oy + S - 19, '#5a3a20', 0.7); }
        if (level >= 1 && her) banner(g, ox + 24, wy - 10, 7, 14, her);
      },
    };
  },
};

let done = false;
export function register() {
  if (done) return;
  done = true;
  Object.assign(BUILDING_ART, TAVERN_ART);
  BUS.draw.entity.hero = drawHero;
  BUS.draw.world.push((g, s) => drawHeroFx(g, s));
}

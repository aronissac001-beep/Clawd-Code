// Art for the faction-unique units and buildings (Phase 3). Same signatures and
// tabletop-miniature style as UNIT_ART / BUILDING_ART in sprites.js.
// Dawnhold: gold and royal blue. Sylvari: greens and leaves. Deepforge: steel and
// bronze. Emberkin: red and black with bone.
import { ART } from './sprites.js';

const { INK, shadow, poly, rect, rrect, circle, line, shade, roof, windowLit, banner } = ART;
const T = 32;
// Unit sprite box (matches sprites.js): 26 x 32, feet at (13, 28).
const UAX = 13, UAY = 28;

const DAWN_GOLD = '#c8902e', DAWN_GOLD_L = '#f0c050', DAWN_BLUE = '#2f4d7a', DAWN_BLUE_L = '#4a6fa5';
const SYL_GREEN = '#5f9a4a', SYL_DARK = '#2c4a3a', SYL_LEAF = '#8fd16a';
const STEEL = '#9aa0a8', STEEL_D = '#6c727c', BRONZE = '#b07a3a', BRONZE_L = '#d9a45a';
const EMB_RED = '#b8503e', EMB_BLACK = '#2a201c', BONE = '#e8dcc0';
const RUNE = '#8fe6ff';

function legs(g, frame, color, y = 22, h = 6) {
  const a = frame === 1 ? 2 : frame === 2 ? -2 : 0;
  rect(g, 10 + a * 0.5, y, 2.6, h - Math.max(0, a), color, 'rgba(25,18,12,0.7)', 0.6);
  rect(g, 13.4 - a * 0.5, y, 2.6, h - Math.max(0, -a), color, 'rgba(25,18,12,0.7)', 0.6);
}
function body(g, color, trim, y = 13, w = 11, h = 10) {
  rrect(g, 13 - w / 2, y, w, h, 3, color);
  if (trim) rect(g, 13 - 1.5, y + 1, 3, h - 2, trim, null);
  rect(g, 13 - w / 2 + 0.5, y + h - 3, w - 1, 1.6, 'rgba(60,40,20,0.8)', null);
}
function leaf(g, x, y, r, ang, color) {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.fillStyle = color; g.beginPath(); g.ellipse(0, 0, r, r * 0.45, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(30,40,20,0.6)'; g.lineWidth = 0.5; g.stroke();
  g.restore();
}
function sunburst(g, cx, cy, r, color) {
  g.fillStyle = color; g.beginPath();
  for (let i = 0; i < 16; i++) { const a = (i * Math.PI) / 8, rr = i % 2 ? r * 0.55 : r; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
  g.closePath(); g.fill(); g.strokeStyle = 'rgba(60,40,10,0.6)'; g.lineWidth = 0.5; g.stroke();
}
function skull(g, x, y, r) {
  circle(g, x, y, r, BONE, INK, 0.6);
  rect(g, x - r * 0.55, y + r * 0.5, r * 1.1, r * 0.6, BONE, INK, 0.5);
  circle(g, x - r * 0.38, y - r * 0.05, r * 0.28, EMB_BLACK, null);
  circle(g, x + r * 0.38, y - r * 0.05, r * 0.28, EMB_BLACK, null);
}
function rune(g, x, y, s, color) {
  g.strokeStyle = color; g.lineWidth = Math.max(0.7, s * 0.22);
  g.beginPath(); g.moveTo(x, y - s); g.lineTo(x, y + s); g.moveTo(x, y - s * 0.4); g.lineTo(x + s * 0.6, y - s); g.moveTo(x, y); g.lineTo(x - s * 0.6, y + s * 0.5); g.stroke();
}

// ---- Units ------------------------------------------------------------------------------------
export const FACTION_UNIT_ART = {
  // Dawnhold knight on a white charger with a blue-and-gold caparison.
  lancer(frame, opt) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 11, 2.8, 0.32);
      const a = frame === 1 ? 2 : frame === 2 ? -2 : 0;
      // horse legs (far pair darker)
      for (const [x, k, c] of [[7, -1, '#bfb6a2'], [18, 1, '#bfb6a2'], [5, 1, '#d8d0be'], [16, -1, '#d8d0be']]) {
        line(g, x, 21, x + a * k * 0.9, 27.2, c, 2);
        rect(g, x + a * k * 0.9 - 1, 26.6, 2.2, 1.4, '#4a3a2a', null);
      }
      // tail
      g.strokeStyle = '#b8ab90'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(3.2, 17); g.quadraticCurveTo(0.6, 19, 1.2 + a * 0.3, 24); g.stroke();
      // body
      g.fillStyle = '#eee6d6'; g.beginPath(); g.ellipse(12, 19, 9, 4.6, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.8; g.stroke();
      // neck and head
      poly(g, [17, 17.5, 20.5, 10.5, 23.5, 9.8, 25.6, 13, 24.6, 14.2, 22, 13.4, 21, 19], '#eee6d6', INK, 0.8);
      line(g, 18.2, 15.5, 21, 10.2, '#b8ab90', 1.6); // mane
      poly(g, [21, 10.5, 21.6, 7.8, 22.6, 10], '#e0d8c6', INK, 0.5); // ear
      circle(g, 23.2, 11.6, 0.6, '#2a2020', null);
      // caparison: blue cloth, gold hem, sun on the flank
      poly(g, [5, 15.5, 18.5, 15.5, 19.5, 22.5, 16, 21.4, 12.5, 23, 9, 21.4, 5.5, 22.8, 3.8, 18], DAWN_BLUE, INK, 0.7);
      line(g, 5.6, 22.2, 18.8, 22, DAWN_GOLD_L, 0.9);
      sunburst(g, 9, 18.6, 2.4, DAWN_GOLD_L);
      // rider: gold surcoat over mail, blue sash
      rrect(g, 9.6, 8.5, 6.8, 8, 2.5, DAWN_GOLD);
      line(g, 10, 9.5, 16, 15.5, DAWN_BLUE_L, 1.2);
      line(g, 11.5, 16, 10.5, 19.5, '#8a8f99', 1.6); // leg over the flank
      circle(g, 13, 6, 2.9, '#e8c49a', INK, 0.7);
      // great helm with gold plume
      g.fillStyle = '#c9ced6'; g.beginPath(); g.arc(13, 6, 3.2, Math.PI, 0); g.lineTo(16.2, 7.4); g.lineTo(9.8, 7.4); g.closePath(); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.6; g.stroke();
      line(g, 13.4, 5.4, 16, 5.4, '#2a2a30', 0.7);
      g.strokeStyle = DAWN_GOLD_L; g.lineWidth = 1.6; g.beginPath(); g.moveTo(12.6, 2.8); g.quadraticCurveTo(10, 0.6, 7.6, 2.6); g.stroke();
      // kite shield with the realm field
      poly(g, [8.4, 10, 11.4, 10, 11, 14.2, 9.9, 15.6, 8.8, 14.2], opt.field || DAWN_BLUE, INK, 0.6);
      circle(g, 9.9, 12.2, 0.9, opt.charge || DAWN_GOLD_L, null);
      // lance: raised on the march, couched on the charge
      const atk = frame === 3;
      const [x1, y1, x2, y2] = atk ? [9, 13, 26, 12.4] : frame === 0 ? [14, 16, 20.5, 0.6] : [13.5, 15.5, 24.5, 2.2];
      line(g, x1, y1, x2, y2, '#7a5a3a', 1.5);
      circle(g, x1 + (x2 - x1) * 0.2, y1 + (y2 - y1) * 0.2, 1.3, '#c9ced6', INK, 0.5); // gauntlet
      const px = x1 + (x2 - x1) * 0.8, py = y1 + (y2 - y1) * 0.8;
      if (atk) poly(g, [px, py, px - 3.2, py + 3, px - 4.4, py + 0.6], DAWN_BLUE_L, 'rgba(30,20,10,0.5)', 0.5);
      else poly(g, [px, py, px - 4.6, py + 0.6, px - 2.4, py + 2.6], DAWN_BLUE_L, 'rgba(30,20,10,0.5)', 0.5);
      circle(g, x2, y2, 0.8, '#e6eaf0', null);
    };
  },
  // Sylvari warden: pale elf in a leaf cloak with a tall thornwood longbow.
  thornwarden(frame, opt) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 6, 2.4);
      // cloak behind
      poly(g, [8.2, 11.5, 17.8, 11.5, 19.4, 27, 13, 25.6, 6.6, 27], SYL_DARK, INK, 0.7);
      for (let i = 0; i < 4; i++) leaf(g, 8 + i * 3.4, 26 - (i % 2), 1.8, 0.6 * (i % 2 ? 1 : -1), SYL_GREEN);
      legs(g, frame, '#34503e');
      body(g, SYL_GREEN, opt.field || '#c8b060', 13, 8.5, 10);
      // quiver with leaf fletching
      rect(g, 7.2, 10.5, 2.8, 8.5, '#6b4a2d', null);
      leaf(g, 8, 9.6, 1.5, -0.6, SYL_LEAF); leaf(g, 9.6, 9.2, 1.4, 0.5, SYL_LEAF);
      // head, long hair, pointed ears
      poly(g, [9.6, 7, 13, 5.4, 15.6, 7.6, 12.4, 9, 11.4, 14.6, 8.6, 15.4, 9.2, 11], '#d8c890', 'rgba(60,50,20,0.5)', 0.5);
      circle(g, 13, 8.8, 3.3, '#f0d8b8', INK, 0.7);
      poly(g, [9.9, 8.6, 6.6, 6.2, 10.2, 7.4], '#f0d8b8', INK, 0.5);
      poly(g, [16.1, 8.6, 19.4, 6.2, 15.8, 7.4], '#f0d8b8', INK, 0.5);
      // leaf circlet
      for (let i = 0; i < 5; i++) leaf(g, 10.4 + i * 1.3, 6.1 - Math.sin((i / 4) * Math.PI) * 0.9, 1.1, -0.4 + i * 0.2, SYL_LEAF);
      circle(g, 14.2, 8.8, 0.45, '#2c4a3a', null);
      // tall longbow, vine-wrapped
      const atk = frame === 3;
      const bx = atk ? 19.5 : 18.4;
      g.strokeStyle = '#6b4a2d'; g.lineWidth = 1.7; g.beginPath(); g.arc(bx - 2, 15.2, 11, -1.28, 1.28); g.stroke();
      g.strokeStyle = SYL_LEAF; g.lineWidth = 0.6; g.beginPath(); g.arc(bx - 2, 15.2, 11, -0.5, 0.5); g.stroke();
      const tx = bx - 2 + Math.cos(-1.28) * 11, ty1 = 15.2 + Math.sin(-1.28) * 11, ty2 = 15.2 + Math.sin(1.28) * 11;
      leaf(g, tx, ty1, 1.5, 0.8, SYL_LEAF); leaf(g, tx, ty2, 1.5, -0.8, SYL_LEAF);
      if (atk) {
        g.strokeStyle = '#eee'; g.lineWidth = 0.5; g.beginPath(); g.moveTo(tx, ty1); g.lineTo(13.5, 15.2); g.lineTo(tx, ty2); g.stroke();
        line(g, 13.5, 15.2, 24.5, 15.2, '#8a6a46', 0.9);
        poly(g, [24.5, 14, 26, 15.2, 24.5, 16.4], '#d8dde4', null);
      } else line(g, tx, ty1, tx, ty2, '#ccc', 0.5);
      // bow hand
      circle(g, bx + 8.4, 15.2, 1.2, '#f0d8b8', null);
    };
  },
  // Deepforge dwarf: broad, short, steel and bronze behind a tower shield.
  ironshield(frame, opt) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 8, 2.8, 0.32);
      legs(g, frame, '#5a3a24', 23.5, 4.5);
      rect(g, 9.4, 26.6, 3.6, 1.6, '#3a2a1a', null); rect(g, 13, 26.6, 3.6, 1.6, '#3a2a1a', null);
      // wide steel body with bronze belt
      rrect(g, 6, 13.5, 13, 10.5, 3, STEEL);
      g.strokeStyle = STEEL_D; g.lineWidth = 0.6;
      for (let yy = 16; yy < 22; yy += 2) { g.beginPath(); g.moveTo(7, yy); g.lineTo(18, yy); g.stroke(); }
      rect(g, 6.4, 20.4, 12.2, 2.2, BRONZE, 'rgba(40,25,10,0.7)', 0.5);
      // hammer (behind the shield, raised on attack)
      const atk = frame === 3;
      if (atk) { line(g, 10, 16, 18.5, 4.5, '#5a3a24', 1.8); rrect(g, 15.5, 1.2, 7, 4.8, 1, STEEL_D); rect(g, 15.5, 2.8, 7, 1.4, BRONZE, null); }
      else { line(g, 7.5, 21, 4.5, 9.5, '#5a3a24', 1.8); rrect(g, 1.2, 6.8, 6.6, 4.6, 1, STEEL_D); rect(g, 1.2, 8.4, 6.6, 1.3, BRONZE, null); }
      // head, braided beard
      circle(g, 12.4, 10.6, 3.6, '#e0b088', INK, 0.7);
      poly(g, [8.8, 10.6, 16, 10.6, 15.4, 15.5, 13.6, 19, 12.4, 17, 11.2, 19, 9.4, 15.5], '#a8683a', INK, 0.6);
      rect(g, 11.6, 16, 1.6, 1.4, BRONZE_L, null);
      // steel helm with bronze rim and nasal
      g.fillStyle = STEEL; g.beginPath(); g.arc(12.4, 9.8, 4.1, Math.PI, 0); g.closePath(); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.6; g.stroke();
      line(g, 8.2, 9.8, 16.6, 9.8, BRONZE, 1.4);
      line(g, 12.4, 9.8, 12.4, 12.4, STEEL_D, 1.1);
      poly(g, [11.4, 5.8, 12.4, 3.2, 13.4, 5.8], BRONZE, INK, 0.5);
      // tower shield in front: steel with a bronze rim, boss in the realm colour and a rune
      rrect(g, 14.2, 9.6, 9.6, 17.2, 2.2, BRONZE, INK, 0.8);
      rrect(g, 15.3, 10.7, 7.4, 15, 1.6, STEEL, null);
      for (let i = 0; i < 3; i++) line(g, 15.6, 13 + i * 5, 22.4, 13 + i * 5, STEEL_D, 0.5);
      circle(g, 19, 18.2, 2.1, opt.field || BRONZE, INK, 0.6);
      rune(g, 19, 13, 1.8, BRONZE_L);
      for (const [x, y] of [[15.6, 10.9], [22.4, 10.9], [15.6, 25.4], [22.4, 25.4]]) circle(g, x, y, 0.55, BRONZE_L, null);
    };
  },
  // Emberkin orc: olive skin, red war-paint, black fur, bone, twin axes.
  berserker(frame, opt) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 7, 2.6);
      legs(g, frame, '#3a2a24');
      // fur kilt
      poly(g, [7.5, 20, 18.5, 20, 19.5, 24.5, 16, 23.6, 13, 25, 10, 23.6, 6.5, 24.5], EMB_BLACK, INK, 0.6);
      // bare torso with war-paint
      rrect(g, 7.2, 12.5, 11.6, 9, 3.2, '#7f9550');
      line(g, 9, 14.5, 12, 18.5, EMB_RED, 1.3); line(g, 17, 14.5, 14, 18.5, EMB_RED, 1.3);
      rect(g, 7.6, 19.4, 10.8, 1.6, '#5a3a24', null);
      // bone pauldron and armband
      g.fillStyle = BONE; g.beginPath(); g.ellipse(7.8, 13.4, 3, 2.2, -0.3, 0, Math.PI * 2); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.6; g.stroke();
      for (let i = 0; i < 3; i++) poly(g, [6 + i * 1.6, 12, 6.8 + i * 1.6, 9.6, 7.6 + i * 1.6, 12], BONE, INK, 0.4);
      rect(g, 17.6, 15.8, 2.4, 1.4, opt.field || EMB_RED, null);
      // head: tusks, black eye-band, red crest
      circle(g, 13, 9, 4, '#7f9550', INK, 0.7);
      rect(g, 9.4, 7.8, 7.2, 1.2, EMB_RED, null);
      circle(g, 11.4, 8.4, 0.5, '#ffb040', null); circle(g, 14.6, 8.4, 0.5, '#ffb040', null);
      poly(g, [10.6, 11.2, 11.4, 9.4, 12, 11.2], BONE, null); poly(g, [14, 11.2, 14.6, 9.4, 15.4, 11.2], BONE, null);
      poly(g, [10.8, 5.6, 12, 1, 13, 4.2, 14.2, 0.6, 15, 5.6], EMB_RED, INK, 0.5);
      // twin axes, bone hafts
      const atk = frame === 3;
      // arms
      const atkArm = frame === 3;
      line(g, 8.4, 14, atkArm ? 8.5 : 6.6, atkArm ? 16 : 19.4, '#7f9550', 2.6);
      line(g, 17.6, 14, atkArm ? 18.4 : 19.4, atkArm ? 16 : 19.4, '#7f9550', 2.6);
      const axe = (hx, hy, tx, ty, flip) => {
        line(g, hx, hy, tx, ty, '#4a3428', 1.5);
        circle(g, hx, hy, 1.1, BONE, null);
        const dx = tx - hx, dy = ty - hy, l = Math.hypot(dx, dy) || 1, nx = -dy / l * flip, ny = dx / l * flip;
        const ax = tx - (dx / l) * 1.5, ay = ty - (dy / l) * 1.5;
        poly(g, [ax, ay, ax + nx * 4 + (dx / l) * 2, ay + ny * 4 + (dy / l) * 2, ax + nx * 4.4 - (dx / l) * 2.6, ay + ny * 4.4 - (dy / l) * 2.6, ax - (dx / l) * 1.6, ay - (dy / l) * 1.6], '#5a5560', INK, 0.6);
        line(g, ax + nx * 4 + (dx / l) * 2, ay + ny * 4 + (dy / l) * 2, ax + nx * 4.4 - (dx / l) * 2.6, ay + ny * 4.4 - (dy / l) * 2.6, EMB_RED, 0.9);
      };
      if (atk) { axe(18, 16, 24.5, 6.5, 1); axe(8, 16, 13.5, 3.5, -1); }
      else { axe(19, 19, 21.5, 9.5, 1); axe(7, 19, 4.5, 9.5, -1); }
    };
  },
};

// ---- Buildings ----------------------------------------------------------------------------------
export const FACTION_BUILDING_ART = {
  // Cathedral of Dawn: pale stone nave, blue slate, a gold sun on the bell tower.
  cathedral(level, her) {
    const S = 2 * T, top = 60 + level * 8;
    return {
      w: S + 10, h: S + top + 4, ax: 5, ay: top,
      draw(g) {
        const ox = 5, oy = top;
        shadow(g, ox + S / 2, oy + S - 4, S / 2, 8, 0.28);
        rrect(g, ox + 1, oy + 30, S - 2, S - 32, 3, '#a39a8d', null);
        // steps
        for (let i = 0; i < 3; i++) rect(g, ox + 14 + i * 2, oy + S - 8 - i * 3, 20 - i * 4, 3, shade('#c9bfae', -i * 0.06), 'rgba(30,22,16,0.4)', 0.6);
        // buttresses (level 2)
        if (level >= 1) {
          for (const bx of [ox + 3, ox + 11]) poly(g, [bx, oy + 38, bx + 5, oy + 38, bx + 5, oy + 8, bx + 3, oy + 6], '#cfc3ad');
          line(g, ox + 8, oy + 10, ox + 14, oy + 4, '#bfb39d', 2);
        }
        // nave
        const nx = ox + 6, nw = 36, ny = oy + 2;
        rect(g, nx, ny, nw, 36, '#e6dcc6');
        g.strokeStyle = 'rgba(120,100,80,0.35)'; g.lineWidth = 0.7;
        for (let yy = ny + 6; yy < ny + 36; yy += 6) { g.beginPath(); g.moveTo(nx, yy); g.lineTo(nx + nw, yy); g.stroke(); }
        // lancet windows
        for (const wx of [nx + 4, nx + nw - 8]) {
          g.fillStyle = '#f5c25a'; g.beginPath(); g.moveTo(wx, ny + 22); g.lineTo(wx, ny + 14); g.arc(wx + 2, ny + 14, 2, Math.PI, 0); g.lineTo(wx + 4, ny + 22); g.closePath(); g.fill();
          g.strokeStyle = 'rgba(40,25,10,0.9)'; g.lineWidth = 0.7; g.stroke();
        }
        // rose window and great door
        circle(g, nx + nw / 2, ny + 11, 5, '#f5c25a', 'rgba(40,25,10,0.9)', 0.8);
        for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; line(g, nx + nw / 2, ny + 11, nx + nw / 2 + Math.cos(a) * 5, ny + 11 + Math.sin(a) * 5, 'rgba(120,70,20,0.8)', 0.6); }
        circle(g, nx + nw / 2, ny + 11, 1.6, DAWN_BLUE_L, null);
        g.fillStyle = '#4a3020'; g.beginPath(); g.moveTo(nx + nw / 2 - 6, ny + 36); g.lineTo(nx + nw / 2 - 6, ny + 26); g.arc(nx + nw / 2, ny + 26, 6, Math.PI, 0); g.lineTo(nx + nw / 2 + 6, ny + 36); g.closePath(); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.9; g.stroke();
        g.fillStyle = 'rgba(255,200,90,0.5)'; g.fillRect(nx + nw / 2 - 4, ny + 27, 8, 9);
        line(g, nx + nw / 2, ny + 22, nx + nw / 2, ny + 36, 'rgba(60,35,15,0.8)', 0.8);
        // slate roof
        roof(g, nx, nx + nw, ny + 1, ny - 14, ny - 18, DAWN_BLUE, 2.5);
        line(g, nx - 1, ny + 1, nx + nw + 1, ny + 1, DAWN_GOLD, 1.2);
        // bell tower
        const tx = ox + 42, tw = 17, ty = oy - 22 - level * 6;
        rect(g, tx, ty, tw, oy + 38 - ty, '#ddd2bb');
        g.strokeStyle = 'rgba(120,100,80,0.35)'; g.lineWidth = 0.7;
        for (let yy = ty + 6; yy < oy + 38; yy += 6) { g.beginPath(); g.moveTo(tx, yy); g.lineTo(tx + tw, yy); g.stroke(); }
        // belfry with a gold bell
        g.fillStyle = '#3a2a22'; g.beginPath(); g.moveTo(tx + 4, ty + 16); g.lineTo(tx + 4, ty + 8); g.arc(tx + tw / 2, ty + 8, tw / 2 - 4, Math.PI, 0); g.lineTo(tx + tw - 4, ty + 16); g.closePath(); g.fill();
        g.fillStyle = DAWN_GOLD_L; g.beginPath(); g.moveTo(tx + tw / 2 - 3, ty + 14); g.quadraticCurveTo(tx + tw / 2, ty + 4, tx + tw / 2 + 3, ty + 14); g.closePath(); g.fill();
        windowLit(g, tx + tw / 2 - 2, ty + 26, 4, 6);
        // spire and sun finial
        poly(g, [tx - 2, ty, tx + tw + 2, ty, tx + tw / 2, ty - 24], DAWN_BLUE, INK, 0.9);
        poly(g, [tx + tw / 2, ty - 24, tx + tw + 2, ty, tx + tw / 2 + 3, ty], shade(DAWN_BLUE, -0.25), null);
        line(g, tx - 2, ty, tx + tw + 2, ty, DAWN_GOLD, 1.4);
        line(g, tx + tw / 2, ty - 24, tx + tw / 2, ty - 28, DAWN_GOLD, 1.2);
        sunburst(g, tx + tw / 2, ty - 31, 4, DAWN_GOLD_L);
        circle(g, tx + tw / 2, ty - 31, 1.8, '#fff0b0', null);
        // banners
        banner(g, nx + 1, ny + 3, 6, 14, her);
        if (level >= 1) banner(g, tx + 2, ty + 32, 6, 14, her);
      },
    };
  },
  // Heart Tree: an elder tree with a glowing golden heart and spreading roots.
  hearttree(level) {
    const S = 2 * T, top = 58 + level * 6, grow = level * 4;
    return {
      w: S + 12, h: S + top + 4, ax: 6, ay: top,
      draw(g) {
        const ox = 6, oy = top, cx = ox + S / 2;
        shadow(g, cx, oy + S - 6, S / 2, 9, 0.28);
        // mossy ground with flowers
        g.fillStyle = '#4f7a3a'; g.beginPath(); g.ellipse(cx, oy + S - 14, S / 2 - 2, 14, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = 'rgba(30,40,20,0.5)'; g.lineWidth = 0.8; g.stroke();
        for (let i = 0; i < 12; i++) circle(g, ox + 8 + ((i * 41) % (S - 14)), oy + S - 22 + ((i * 17) % 16), 1.1, i % 3 ? '#f0e8a0' : '#f4b8c8', null);
        // roots
        g.strokeStyle = '#6b4a2d'; g.lineWidth = 3;
        for (const [ex, ey] of [[ox + 6, oy + S - 12], [ox + 18, oy + S - 4], [ox + S - 16, oy + S - 4], [ox + S - 4, oy + S - 14]]) {
          g.beginPath(); g.moveTo(cx + (ex < cx ? -8 : 8), oy + S - 22); g.quadraticCurveTo((cx + ex) / 2, ey - 10, ex, ey); g.stroke();
        }
        // trunk
        poly(g, [cx - 13, oy + S - 18, cx + 13, oy + S - 18, cx + 8, oy + 10, cx + 4, oy - 2, cx - 4, oy - 2, cx - 8, oy + 10], '#7a5a3a', INK, 1);
        g.strokeStyle = 'rgba(50,32,18,0.6)'; g.lineWidth = 0.9;
        for (const dx of [-7, -2, 3, 8]) { g.beginPath(); g.moveTo(cx + dx, oy + S - 20); g.quadraticCurveTo(cx + dx * 0.4, oy + 22, cx + dx * 0.5, oy + 2); g.stroke(); }
        // glowing heart
        const hy = oy + 26;
        const gr = g.createRadialGradient(cx, hy, 0, cx, hy, 12);
        gr.addColorStop(0, 'rgba(255,248,190,1)'); gr.addColorStop(0.45, 'rgba(240,215,100,0.85)'); gr.addColorStop(1, 'rgba(160,220,90,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(cx, hy, 12, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff3b0'; g.beginPath();
        g.moveTo(cx, hy + 5); g.bezierCurveTo(cx - 7, hy, cx - 4, hy - 6, cx, hy - 2.5); g.bezierCurveTo(cx + 4, hy - 6, cx + 7, hy, cx, hy + 5); g.fill();
        g.strokeStyle = 'rgba(150,110,30,0.8)'; g.lineWidth = 0.7; g.stroke();
        // canopy
        const blobs = [[0, -12, 22], [-19, -2, 13], [19, -2, 13], [-10, -26, 14], [10, -26, 14], [0, -34, 12]];
        for (const [dx, dy, r] of blobs) circle(g, cx + dx * (1 + grow / 40), oy + dy - grow, r + grow * 0.5, shade(SYL_GREEN, -0.18), INK, 0.9);
        for (const [dx, dy, r] of blobs) circle(g, cx + dx * (1 + grow / 40) - 2, oy + dy - grow - 2, (r + grow * 0.5) * 0.72, SYL_GREEN, null);
        for (const [dx, dy, r] of blobs.slice(0, 5)) circle(g, cx + dx * (1 + grow / 40) - 4, oy + dy - grow - 5, r * 0.32, SYL_LEAF, null);
        // hanging golden seed-lanterns
        for (const [dx, dy] of [[-16, 6], [15, 7], [-4, 2]]) {
          line(g, cx + dx, oy + dy - grow - 4, cx + dx, oy + dy - grow + 2, '#5a4a2a', 0.6);
          circle(g, cx + dx, oy + dy - grow + 4, 2, '#f5d870', 'rgba(120,90,20,0.8)', 0.6);
        }
        if (level >= 1) for (let i = 0; i < 10; i++) circle(g, cx - 24 + ((i * 29) % 48), oy - 34 + ((i * 23) % 36) - grow, 1.4, i % 2 ? '#fbe0ea' : '#ffffff', null);
      },
    };
  },
  // Runeforge: a squat stone forge with bronze doors, a rune-lit chimney and an anvil.
  runeforge(level) {
    const S = 2 * T, top = 40 + level * 6;
    return {
      w: S + 10, h: S + top + 4, ax: 5, ay: top,
      draw(g) {
        const ox = 5, oy = top;
        shadow(g, ox + S / 2, oy + S - 4, S / 2, 8, 0.32);
        rrect(g, ox + 1, oy + 28, S - 2, S - 30, 2, '#7d7a76', null);
        for (let i = 0; i < 6; i++) rect(g, ox + 4 + i * 10, oy + S - 7, 9, 4, '#8f8b86', 'rgba(30,22,16,0.35)', 0.5);
        // hall of big dressed stones
        const hx = ox + 3, hw = 40, hy = oy + 4;
        rect(g, hx, hy, hw, 30, '#8a8e94');
        g.strokeStyle = 'rgba(40,40,48,0.45)'; g.lineWidth = 0.8;
        for (let r = 0; r < 4; r++) {
          const yy = hy + 7 + r * 7.5;
          g.beginPath(); g.moveTo(hx, yy); g.lineTo(hx + hw, yy); g.stroke();
          for (let x = hx + (r % 2 ? 6 : 11); x < hx + hw; x += 11) { g.beginPath(); g.moveTo(x, yy - 7.5); g.lineTo(x, yy); g.stroke(); }
        }
        // heavy stone roof with bronze edge
        poly(g, [hx - 3, hy + 2, hx + hw + 3, hy + 2, hx + hw - 2, hy - 10, hx + 2, hy - 10], '#5a5e66', INK, 0.9);
        line(g, hx - 3, hy + 2, hx + hw + 3, hy + 2, BRONZE, 1.6);
        if (level >= 1) { g.fillStyle = BRONZE; g.beginPath(); g.arc(hx + 12, hy - 10, 6, Math.PI, 0); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.8; g.stroke(); }
        // bronze doors with a forge-glow gap and a rune lintel
        const dx = hx + 12, dy = hy + 13;
        rect(g, dx - 1.5, dy - 3.5, 19, 3, '#5a5e66', INK, 0.6);
        for (let i = 0; i < 4 + level; i++) rune(g, dx + 2 + i * (15 / (3 + level)), dy - 2, 1.1, RUNE);
        rect(g, dx, dy, 16, 17, BRONZE, INK, 0.8);
        rect(g, dx + 7.2, dy, 1.6, 17, '#ff8a2a', null);
        g.fillStyle = 'rgba(255,140,40,0.35)'; g.fillRect(dx + 5, dy + 4, 6, 13);
        for (const [x, y] of [[dx + 2.5, dy + 3], [dx + 13.5, dy + 3], [dx + 2.5, dy + 14], [dx + 13.5, dy + 14]]) circle(g, x, y, 0.8, BRONZE_L, null);
        // chimney stack with a glowing rune
        const cxs = ox + 45, cw = 14, cty = oy - 28 - level * 4;
        rect(g, cxs, cty, cw, oy + 34 - cty, '#7a7e86');
        g.strokeStyle = 'rgba(40,40,48,0.45)'; g.lineWidth = 0.7;
        for (let yy = cty + 7; yy < oy + 34; yy += 7) { g.beginPath(); g.moveTo(cxs, yy); g.lineTo(cxs + cw, yy); g.stroke(); }
        rect(g, cxs - 2, cty - 3, cw + 4, 4, BRONZE, INK, 0.7);
        rect(g, cxs + 2, cty - 6, cw - 4, 3, '#2a2a30', null);
        const rg = g.createRadialGradient(cxs + cw / 2, cty + 18, 0, cxs + cw / 2, cty + 18, 9);
        rg.addColorStop(0, 'rgba(160,240,255,0.9)'); rg.addColorStop(1, 'rgba(160,240,255,0)');
        g.fillStyle = rg; g.fillRect(cxs - 3, cty + 9, cw + 6, 18);
        rune(g, cxs + cw / 2, cty + 18, 4, '#e8fbff');
        // anvil
        const ax = ox + 49, ay = oy + 46;
        poly(g, [ax - 8, ay - 6, ax + 8, ay - 6, ax + 10, ay - 8, ax - 12, ay - 8], '#4a4e56', INK, 0.8);
        rect(g, ax - 4, ay - 6, 8, 6, '#3e4249', INK, 0.6);
        rect(g, ax - 7, ay, 14, 3, '#3e4249', INK, 0.6);
        line(g, ax + 2, ay - 9, ax + 8, ay - 15, '#5a3a24', 1.4);
        rect(g, ax + 6, ay - 18, 5, 3.5, STEEL_D, INK, 0.5);
        // glowing ingot
        rect(g, ax - 6, ay - 10, 6, 2, '#ffb050', null);
      },
    };
  },
  // War Drum: a great red hide drum on a black frame, bone sticks, skull and banner.
  wardrum(level) {
    const top = 30 + level * 6, k = 1 + level * 0.15;
    return {
      w: T + 10, h: T + top + 4, ax: 5, ay: top,
      draw(g) {
        const ox = 5, oy = top, cx = ox + 16;
        shadow(g, cx, oy + 27, 14, 4.5, 0.3);
        // banner pole with a tattered red-and-black banner
        line(g, ox + 3, oy + 28, ox + 3, oy - 22 - level * 4, '#3a2a24', 1.8);
        poly(g, [ox + 3, oy - 20 - level * 4, ox + 13, oy - 18 - level * 4, ox + 11, oy - 12 - level * 4, ox + 14, oy - 8 - level * 4, ox + 3, oy - 7 - level * 4], EMB_RED, 'rgba(30,20,10,0.7)', 0.6);
        rect(g, ox + 3, oy - 15 - level * 4, 9, 2, EMB_BLACK, null);
        skull(g, ox + 3, oy - 24 - level * 4, 2.4);
        // frame legs
        line(g, cx - 12 * k, oy + 28, cx - 9 * k, oy + 4, EMB_BLACK, 2.2);
        line(g, cx + 12 * k, oy + 28, cx + 9 * k, oy + 4, EMB_BLACK, 2.2);
        // drum body
        const rx = 11 * k, ry = 4 * k, yt = oy + 2 - level * 2, yb = oy + 20;
        g.fillStyle = EMB_RED;
        g.beginPath(); g.moveTo(cx - rx, yt); g.lineTo(cx - rx, yb); g.ellipse(cx, yb, rx, ry, 0, Math.PI, 0, true); g.lineTo(cx + rx, yt); g.closePath(); g.fill();
        g.fillStyle = 'rgba(30,10,10,0.25)'; g.fillRect(cx + rx * 0.35, yt, rx * 0.65, yb - yt + ry * 0.6);
        g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); g.moveTo(cx - rx, yt); g.lineTo(cx - rx, yb); g.ellipse(cx, yb, rx, ry, 0, Math.PI, 0, true); g.lineTo(cx + rx, yt); g.stroke();
        // black bands and lacing
        for (const yy of [yt + 2, yb - 1]) { g.strokeStyle = EMB_BLACK; g.lineWidth = 1.8; g.beginPath(); g.ellipse(cx, yy, rx, ry, 0, 0, Math.PI); g.stroke(); }
        g.strokeStyle = BONE; g.lineWidth = 0.7; g.beginPath();
        for (let i = 0; i <= 8; i++) { const x = cx - rx + (i / 8) * rx * 2; g.lineTo(x, i % 2 ? yb - 2 : yt + 4); }
        g.stroke();
        // hide head with a flame mark
        g.fillStyle = '#d8c49a'; g.beginPath(); g.ellipse(cx, yt, rx, ry, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.8; g.stroke();
        g.fillStyle = EMB_RED; g.beginPath(); g.moveTo(cx, yt - ry * 0.7); g.quadraticCurveTo(cx + 3, yt, cx, yt + ry * 0.7); g.quadraticCurveTo(cx - 3, yt, cx, yt - ry * 0.7); g.fill();
        // bone drumsticks crossed on the head
        line(g, cx - 9, yt - 6, cx + 2, yt + 1, BONE, 1.6); circle(g, cx - 9, yt - 6, 1.4, BONE, INK, 0.4);
        line(g, cx + 9, yt - 6, cx - 2, yt + 1, BONE, 1.6); circle(g, cx + 9, yt - 6, 1.4, BONE, INK, 0.4);
        // skull on the front
        skull(g, cx, yb - 7, 2.8);
        // tusks for the great drum
        if (level >= 1) {
          for (const s of [-1, 1]) { g.strokeStyle = BONE; g.lineWidth = 2; g.beginPath(); g.moveTo(cx + s * rx, yb - 2); g.quadraticCurveTo(cx + s * (rx + 6), yb - 6, cx + s * (rx + 4), yt - 4); g.stroke(); }
        }
      },
    };
  },
};

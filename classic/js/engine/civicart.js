// Art for the Phase 4 civic buildings and the three Wonders. Same tabletop-
// miniature style and helpers as sprites.js. Every level reads differently at a
// glance: new storeys, materials, banners and props. Wonders are 3x3 and tower
// over the realm. drawCivicOverlay adds a little animated glow above the night.
import { ART } from './sprites.js';

const { INK, shadow, poly, rect, rrect, circle, line, shade, roof, windowLit, flag, banner } = ART;
const T = 32;
const GOLD = '#f0c860', GOLD_D = '#a87a2a', GOLD_L = '#fff0b8';
const LEY = '#b08cff', LEY_D = '#6a48b8', LEY_L = '#efe2ff';
const MOON = '#cfe0ff', MOON_D = '#7f98c8';

// ---- Small props ---------------------------------------------------------------------------
function sack(g, x, y, c = '#e6d6aa') {
  g.fillStyle = c; g.strokeStyle = INK; g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(x - 4, y); g.quadraticCurveTo(x - 5, y - 7, x - 1.5, y - 8); g.lineTo(x + 1.5, y - 8); g.quadraticCurveTo(x + 5, y - 7, x + 4, y); g.closePath(); g.fill(); g.stroke();
  line(g, x - 1.5, y - 7, x + 1.5, y - 7, '#8a6a46', 1);
}
function barrel(g, x, y, c = '#9a6a3a') {
  rrect(g, x - 4, y - 9, 8, 9, 2.5, c);
  line(g, x - 4, y - 6.5, x + 4, y - 6.5, '#5a3a22', 0.8); line(g, x - 4, y - 2.5, x + 4, y - 2.5, '#5a3a22', 0.8);
}
function fish(g, x, y, c = '#b8c8d0') {
  g.fillStyle = c; g.strokeStyle = 'rgba(30,22,16,0.6)'; g.lineWidth = 0.6;
  g.beginPath(); g.ellipse(x, y, 1.6, 4, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  poly(g, [x, y + 3.5, x - 1.8, y + 6, x + 1.8, y + 6], c, 'rgba(30,22,16,0.6)', 0.5);
}
function smoke(g, x, y, c = 'rgba(200,200,210,0.45)', n = 3) {
  for (let i = 0; i < n; i++) circle(g, x + i * 2.5, y - i * 5, 2.6 + i * 1.2, c, null);
}
function columns(g, x0, x1, y0, y1, n, c) {
  const step = (x1 - x0) / (n - 1);
  for (let i = 0; i < n; i++) {
    const x = x0 + i * step;
    rect(g, x - 2, y0, 4, y1 - y0, c, 'rgba(30,22,16,0.55)', 0.7);
    rect(g, x - 3, y0 - 1.5, 6, 2, shade(c, 0.2), null);
    rect(g, x - 3, y1 - 1, 6, 2, shade(c, -0.1), null);
  }
}
function flame(g, x, y, r) {
  g.fillStyle = '#ff9a3a';
  g.beginPath(); g.moveTo(x, y - r * 1.8); g.quadraticCurveTo(x + r, y - r * 0.4, x, y); g.quadraticCurveTo(x - r, y - r * 0.4, x, y - r * 1.8); g.fill();
  g.fillStyle = '#ffe08a';
  g.beginPath(); g.moveTo(x, y - r * 1.1); g.quadraticCurveTo(x + r * 0.5, y - r * 0.3, x, y); g.quadraticCurveTo(x - r * 0.5, y - r * 0.3, x, y - r * 1.1); g.fill();
}
function glowDisc(g, x, y, r, inner, outer) {
  const gr = g.createRadialGradient(x, y, 0.5, x, y, r);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}
function sail(g, hx, hy, ang, len, wid, cloth, lattice) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const px = -s, py = c;
  line(g, hx, hy, hx + c * len, hy + s * len, '#5a4330', 1.8);
  const a = 6, b = len;
  const p = [hx + c * a, hy + s * a, hx + c * b, hy + s * b, hx + c * b + px * wid, hy + s * b + py * wid, hx + c * a + px * wid, hy + s * a + py * wid];
  poly(g, p, cloth, 'rgba(40,28,16,0.75)', 0.8);
  if (lattice) {
    g.strokeStyle = 'rgba(70,50,30,0.6)'; g.lineWidth = 0.6;
    for (let k = 1; k < 4; k++) { const d = a + (b - a) * (k / 4); g.beginPath(); g.moveTo(hx + c * d, hy + s * d); g.lineTo(hx + c * d + px * wid, hy + s * d + py * wid); g.stroke(); }
    g.beginPath(); g.moveTo(hx + c * a + px * wid / 2, hy + s * a + py * wid / 2); g.lineTo(hx + c * b + px * wid / 2, hy + s * b + py * wid / 2); g.stroke();
  }
}

// ---- Geometry shared with the overlay ---------------------------------------------------------
// Anchor points (relative to the footprint's top-left corner, world units) for animated glows.
export function glowAnchor(type, level) {
  switch (type) {
    case 'obelisk': return { x: 16, y: -30 - level * 8, r: 10 + level * 3 };
    case 'sunspire': return { x: 48, y: -128 - level * 22, r: 26 + level * 6 };
    case 'worldforge': return { x: 48, y: 30, r: 22 + level * 4 };
    case 'moonwell': return { x: 48, y: 4 - level * 18, r: 26 + level * 6 };
    default: return null;
  }
}

export const CIVIC_BUILDING_ART = {
  // ---- Windmill (2x2) ----------------------------------------------------------------------
  windmill(level, her) {
    const S = 2 * T, top = 60 + level * 8;
    return {
      w: S + 12, h: S + top + 4, ax: 6, ay: top,
      draw(g) {
        const ox = 6, oy = top, cx = ox + S / 2;
        shadow(g, cx, oy + S - 6, S / 2 - 2, 8, 0.24);
        // Yard
        rrect(g, ox + 3, oy + 26, S - 6, S - 30, 6, level ? '#b5a27e' : '#a8915f', null);
        // Tower body
        const baseY = oy + S - 10, bw = 30 + level * 2, topY = oy - 4 - level * 8, tw = 18;
        if (level === 0) {
          // Post mill: a timber box on a trestle.
          line(g, cx - 12, baseY, cx - 2, topY + 30, '#6b4a2d', 2.6); line(g, cx + 12, baseY, cx + 2, topY + 30, '#6b4a2d', 2.6);
          line(g, cx - 9, baseY - 8, cx + 9, baseY - 8, '#7a5a3a', 1.6);
          rect(g, cx - 11, topY + 4, 22, 28, '#b48b5c');
          for (let x = cx - 7; x < cx + 11; x += 5) line(g, x, topY + 4, x, topY + 32, '#8a6a46', 0.8);
          rect(g, cx - 3, topY + 20, 6, 10, '#5a3a22');
          poly(g, [cx - 13, topY + 5, cx + 13, topY + 5, cx + 8, topY - 6, cx - 8, topY - 6], '#9a5b34');
        } else {
          const c = level === 1 ? '#c8bca6' : '#ece2cc';
          poly(g, [cx - bw / 2, baseY, cx + bw / 2, baseY, cx + tw / 2, topY + 2, cx - tw / 2, topY + 2], c);
          g.fillStyle = 'rgba(40,25,20,0.18)';
          g.beginPath(); g.moveTo(cx + 3, baseY); g.lineTo(cx + bw / 2, baseY); g.lineTo(cx + tw / 2, topY + 2); g.lineTo(cx + 2, topY + 2); g.closePath(); g.fill();
          if (level === 1) {
            g.strokeStyle = 'rgba(80,65,50,0.4)'; g.lineWidth = 0.8;
            for (let yy = topY + 10; yy < baseY; yy += 7) { const f = (yy - topY) / (baseY - topY), hw = tw / 2 + (bw - tw) / 2 * f; g.beginPath(); g.moveTo(cx - hw, yy); g.lineTo(cx + hw, yy); g.stroke(); }
          } else {
            // Gallery ring
            rect(g, cx - bw / 2 + 1, topY + 30, bw - 2, 3, '#7a5a3a');
            for (let x = cx - bw / 2 + 3; x < cx + bw / 2 - 1; x += 4) line(g, x, topY + 30, x, topY + 25, '#7a5a3a', 0.8);
            line(g, cx - bw / 2 + 2, topY + 25, cx + bw / 2 - 2, topY + 25, '#7a5a3a', 1);
          }
          g.fillStyle = '#4a3020'; g.beginPath(); g.moveTo(cx - 4, baseY); g.lineTo(cx - 4, baseY - 9); g.arc(cx, baseY - 9, 4, Math.PI, 0); g.lineTo(cx + 4, baseY); g.closePath(); g.fill();
          windowLit(g, cx - 2, topY + 14, 4, 5);
          if (level === 2) windowLit(g, cx - 2, topY + 38, 4, 5);
          // Cap
          const capC = level === 1 ? '#8e4a34' : '#3f5f8a';
          g.fillStyle = capC; g.strokeStyle = INK; g.lineWidth = 1;
          g.beginPath(); g.moveTo(cx - tw / 2 - 3, topY + 3); g.quadraticCurveTo(cx, topY - 16, cx + tw / 2 + 3, topY + 3); g.closePath(); g.fill(); g.stroke();
          if (level === 2) flag(g, cx, topY - 9, her ? her.field : '#d8a03a', 9);
        }
        // Sails (an X with a slight tilt), hub just below the cap
        const hy = topY + 8, hx = cx;
        const cloth = level === 0 ? '#e2d6b8' : level === 1 ? '#efe6cf' : '#fbf5e6';
        const len = 24 + level * 3;
        for (let i = 0; i < 4; i++) sail(g, hx, hy, -0.5 + i * Math.PI / 2, len, 6 + level, cloth, level >= 1);
        circle(g, hx, hy, 2.8, '#5a4330');
        // Flour sacks
        sack(g, ox + 10, oy + S - 6); if (level >= 1) { sack(g, ox + 17, oy + S - 4); sack(g, ox + S - 10, oy + S - 6, '#efe2c0'); }
        if (level >= 2) { sack(g, ox + S - 17, oy + S - 4); rect(g, ox + 6, oy + 34, 9, 8, '#b48b5c'); }
      },
    };
  },

  // ---- Fisher's Hut (2x2) ------------------------------------------------------------------
  fisher(level, her) {
    const S = 2 * T, top = 30 + level * 6;
    return {
      w: S + 10, h: S + top + 4, ax: 5, ay: top,
      draw(g) {
        const ox = 5, oy = top;
        shadow(g, ox + S / 2, oy + S - 4, S / 2 - 2, 7, 0.22);
        // Plank deck running down to the water
        rrect(g, ox + 2, oy + 22, S - 4, S - 26, 3, '#9a7a52', null);
        for (let x = ox + 5; x < ox + S - 3; x += 5) line(g, x, oy + 23, x, oy + S - 5, '#7a5a3a', 0.8);
        // Jetty posts
        for (const px of [ox + 4, ox + S - 6]) { rect(g, px, oy + S - 8, 3, 8, '#5a4330', null); }
        // Hut on stilts
        const hx = ox + 6, hw = 28 + level * 4, wy = oy + 4 - level * 3;
        line(g, hx + 3, oy + 30, hx + 3, wy + 20, '#5a4330', 2); line(g, hx + hw - 3, oy + 30, hx + hw - 3, wy + 20, '#5a4330', 2);
        rect(g, hx, wy + 2, hw, 20, level === 2 ? '#a5865c' : '#b48b5c');
        for (let x = hx + 4; x < hx + hw; x += 4) line(g, x, wy + 2, x, wy + 22, '#8a6a46', 0.7);
        rect(g, hx + hw / 2 - 3, wy + 10, 6, 12, '#4a3020');
        windowLit(g, hx + 4, wy + 7, 4, 4);
        roof(g, hx, hx + hw, wy + 3, wy - 9, wy - 13, level === 0 ? '#7a8a5a' : level === 1 ? '#6a7f8a' : '#4f6f8a', 2);
        // Net rack with fish
        const nx = ox + 40 + level, ny = oy + 26;
        line(g, nx, ny + 16, nx, ny - 4, '#6b4a2d', 1.6); line(g, nx + 18, ny + 16, nx + 18, ny - 4, '#6b4a2d', 1.6);
        line(g, nx - 1, ny - 3, nx + 19, ny - 3, '#6b4a2d', 1.4);
        g.strokeStyle = 'rgba(220,210,180,0.85)'; g.lineWidth = 0.6;
        for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(nx + k * 3.6, ny - 3); g.lineTo(nx + k * 3.6 + 1.5, ny + 12); g.stroke(); }
        for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(nx, ny + k * 4); g.lineTo(nx + 18, ny + k * 4 + 1); g.stroke(); }
        // Catch
        fish(g, ox + 14, oy + S - 14); fish(g, ox + 18, oy + S - 13, '#c8b8a0');
        if (level >= 1) {
          // Rowboat and barrels
          g.fillStyle = '#7a5a3a'; g.strokeStyle = INK; g.lineWidth = 1;
          g.beginPath(); g.moveTo(ox + 26, oy + S - 10); g.quadraticCurveTo(ox + 38, oy + S - 2, ox + 50, oy + S - 10); g.lineTo(ox + 47, oy + S - 13); g.lineTo(ox + 29, oy + S - 13); g.closePath(); g.fill(); g.stroke();
          line(g, ox + 32, oy + S - 12, ox + 44, oy + S - 12, '#5a3a22', 0.8);
          barrel(g, ox + 10, oy + S - 20); barrel(g, ox + 17, oy + S - 22, '#8a5e34');
        }
        if (level >= 2) {
          // Smokehouse with a drying line
          rect(g, ox + 44, oy + 6, 14, 16, '#8a7f72');
          poly(g, [ox + 42, oy + 7, ox + 60, oy + 7, ox + 51, oy - 2], '#6a5a4a');
          smoke(g, ox + 52, oy - 5);
          line(g, ox + 6, wy - 13, ox + 6, wy - 22, '#5a4330', 1);
          banner(g, ox + 7, wy - 22, 7, 11, her);
          for (let k = 0; k < 4; k++) fish(g, nx + 2 + k * 4.5, ny + 2, k % 2 ? '#d8a070' : '#c89060');
        }
      },
    };
  },

  // ---- Mine (2x2) ----------------------------------------------------------------------------
  mine(level) {
    const S = 2 * T, top = 34 + level * 8;
    return {
      w: S + 8, h: S + top + 4, ax: 4, ay: top,
      draw(g) {
        const ox = 4, oy = top;
        shadow(g, ox + S / 2, oy + S - 4, S / 2 - 2, 7, 0.24);
        // Rocky hill
        poly(g, [ox + 2, oy + S - 8, ox + 6, oy + 14, ox + 18, oy + 2 - level * 2, ox + 34, oy - 2 - level * 3, ox + 50, oy + 6, ox + S - 2, oy + 22, ox + S - 2, oy + S - 8], '#8f8a82');
        poly(g, [ox + 34, oy - 2 - level * 3, ox + 50, oy + 6, ox + S - 2, oy + 22, ox + S - 2, oy + S - 8, ox + 40, oy + S - 8], '#77726b', null);
        for (const [x, y] of [[12, 20], [44, 14], [52, 32], [8, 36]]) circle(g, ox + x, oy + y, 2.2, '#a39e95', 'rgba(30,22,16,0.4)', 0.6);
        // Tunnel mouth
        const mx = ox + 26, my = oy + 38;
        g.fillStyle = '#1e1a1a'; g.beginPath(); g.moveTo(mx - 9, my + 10); g.lineTo(mx - 9, my - 4); g.arc(mx, my - 4, 9, Math.PI, 0); g.lineTo(mx + 9, my + 10); g.closePath(); g.fill();
        if (level < 2) {
          rect(g, mx - 12, my - 8, 3.5, 18, '#7a5a3a'); rect(g, mx + 8.5, my - 8, 3.5, 18, '#7a5a3a');
          rect(g, mx - 13, my - 12, 26, 4, '#8b6a44');
        } else {
          // Dressed stone portal with a keystone
          g.strokeStyle = '#bdb6aa'; g.lineWidth = 4;
          g.beginPath(); g.moveTo(mx - 11, my + 10); g.lineTo(mx - 11, my - 4); g.arc(mx, my - 4, 11, Math.PI, 0); g.lineTo(mx + 11, my + 10); g.stroke();
          g.strokeStyle = INK; g.lineWidth = 0.8; g.stroke();
          rect(g, mx - 3, my - 18, 6, 6, '#d6d0c6');
          circle(g, mx + 15, my - 6, 2.6, '#ffd27a', 'rgba(60,35,15,0.9)', 0.8);
        }
        // Rails and a cart
        line(g, mx - 6, my + 10, mx - 12, oy + S - 3, '#5a4a40', 1.2); line(g, mx + 6, my + 10, mx + 12, oy + S - 3, '#5a4a40', 1.2);
        for (let k = 0; k < 3; k++) { const y = my + 13 + k * 4; line(g, mx - 8 - k, y, mx + 8 + k, y, '#6b4a2d', 1); }
        const cart = (x, y, gold) => {
          poly(g, [x - 7, y - 7, x + 7, y - 7, x + 5, y, x - 5, y], '#6a6670');
          circle(g, x - 4, y + 1, 1.8, '#3a3438'); circle(g, x + 4, y + 1, 1.8, '#3a3438');
          for (let i = -1; i <= 1; i++) circle(g, x + i * 3.5, y - 8, 2.4, gold && i === 0 ? GOLD : '#a8a29a', 'rgba(30,22,16,0.5)', 0.6);
        };
        cart(ox + 46, oy + S - 6, level >= 1);
        if (level >= 2) cart(ox + 12, oy + S - 8, true);
        // Gold glints in the rock
        const glints = [[16, 26], [46, 22]];
        if (level >= 1) glints.push([54, 40], [10, 44]);
        for (const [x, y] of glints) poly(g, [ox + x, oy + y - 2.5, ox + x + 1.5, oy + y, ox + x, oy + y + 2.5, ox + x - 1.5, oy + y], GOLD, GOLD_D, 0.5);
        if (level >= 1) {
          // Headframe winch over the shaft
          const fx = ox + 46, fy = oy + 6;
          line(g, fx - 8, fy + 18, fx, fy - 16 - level * 4, '#6b4a2d', 2.2); line(g, fx + 8, fy + 18, fx, fy - 16 - level * 4, '#6b4a2d', 2.2);
          line(g, fx - 5, fy + 6, fx + 5, fy + 6, '#7a5a3a', 1.4);
          circle(g, fx, fy - 14 - level * 4, 4, '#8b6a44');
          line(g, fx, fy - 10 - level * 4, fx, fy + 14, '#d9c9a0', 0.7);
        }
        // Pick and shovel
        line(g, ox + 8, oy + 30, ox + 16, oy + 22, '#6b4a2d', 1.4);
        poly(g, [ox + 12, oy + 20, ox + 20, oy + 24, ox + 17, oy + 21], '#c8ccd2');
      },
    };
  },

  // ---- Temple (2x2) -----------------------------------------------------------------------------
  temple(level, her) {
    const S = 2 * T, top = 40 + level * 14;
    return {
      w: S + 10, h: S + top + 4, ax: 5, ay: top,
      draw(g) {
        const ox = 5, oy = top, cx = ox + S / 2;
        shadow(g, cx, oy + S - 4, S / 2, 8, 0.26);
        // Stepped platform
        rect(g, ox + 2, oy + S - 14, S - 4, 10, '#a39a8d');
        rect(g, ox + 5, oy + S - 18, S - 10, 5, '#b9b0a2');
        rect(g, ox + 8, oy + S - 21, S - 16, 4, '#cbc2b3');
        const stone = level ? '#e6dcc8' : '#d8ccb0';
        // Cella
        const wy = oy + 2 - level * 6;
        rect(g, ox + 12, wy + 8, S - 24, oy + S - 21 - wy - 8, shade(stone, -0.12));
        g.fillStyle = '#4a3020'; g.beginPath(); g.moveTo(cx - 6, oy + S - 21); g.lineTo(cx - 6, oy + S - 33); g.arc(cx, oy + S - 33, 6, Math.PI, 0); g.lineTo(cx + 6, oy + S - 21); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,190,80,0.55)'; g.fillRect(cx - 4, oy + S - 32, 8, 11);
        // Columns
        columns(g, ox + 10, ox + S - 10, wy + 10, oy + S - 21, level ? 6 : 4, stone);
        // Entablature and pediment
        rect(g, ox + 6, wy + 4, S - 12, 6, stone);
        if (level) { line(g, ox + 6, wy + 7, ox + S - 6, wy + 7, GOLD_D, 1); }
        poly(g, [ox + 4, wy + 4, ox + S - 4, wy + 4, cx, wy - 12], level ? '#c86a3a' : '#b0583a');
        circle(g, cx, wy - 2, 3, level ? GOLD : '#e8c060', 'rgba(60,35,15,0.8)', 0.8);
        if (level === 0) {
          // Fire bowl on the roof
          poly(g, [cx - 6, wy - 12, cx + 6, wy - 12, cx + 4, wy - 8, cx - 4, wy - 8], '#4d4038');
          flame(g, cx, wy - 12, 3.5);
        } else {
          // Bell tower with a golden dome and a great flame
          rect(g, cx - 7, wy - 30, 14, 20, stone);
          g.fillStyle = '#4a3a30'; g.beginPath(); g.moveTo(cx - 4, wy - 12); g.lineTo(cx - 4, wy - 22); g.arc(cx, wy - 22, 4, Math.PI, 0); g.lineTo(cx + 4, wy - 12); g.closePath(); g.fill();
          circle(g, cx, wy - 18, 2.6, GOLD, GOLD_D, 0.6);
          g.fillStyle = GOLD; g.strokeStyle = INK; g.lineWidth = 1;
          g.beginPath(); g.moveTo(cx - 9, wy - 30); g.quadraticCurveTo(cx, wy - 46, cx + 9, wy - 30); g.closePath(); g.fill(); g.stroke();
          flame(g, cx, wy - 42, 4);
          banner(g, ox + 7, wy + 12, 7, 15, her); banner(g, ox + S - 14, wy + 12, 7, 15, her);
        }
        // Candles on the steps
        for (const x of [ox + 10, ox + S - 10]) { rect(g, x - 1, oy + S - 26, 2, 5, '#f2e8d0', null); circle(g, x, oy + S - 27, 1.2, '#ffd27a', null); }
      },
    };
  },

  // ---- Library (2x2) ---------------------------------------------------------------------------
  library(level, her) {
    const S = 2 * T, top = 40 + level * 16;
    return {
      w: S + 10, h: S + top + 4, ax: 5, ay: top,
      draw(g) {
        const ox = 5, oy = top, cx = ox + S / 2;
        shadow(g, cx, oy + S - 4, S / 2, 8, 0.26);
        rrect(g, ox + 2, oy + 34, S - 4, S - 37, 3, '#a8a090', null);
        const wy = oy - 4 - level * 6;
        const wall = level ? '#c9bfae' : '#e7d7b4';
        rect(g, ox + 5, wy, S - 10, oy + S - 8 - wy, wall);
        if (!level) {
          // Timber frame, two storeys
          line(g, ox + 5, wy + 20, ox + S - 5, wy + 20, '#6b4a2d', 1.4);
          for (const x of [ox + 14, ox + 32, ox + 50]) line(g, x, wy, x, oy + S - 8, '#6b4a2d', 1.1);
        } else {
          g.strokeStyle = 'rgba(80,65,50,0.4)'; g.lineWidth = 0.8;
          for (let yy = wy + 6; yy < oy + S - 8; yy += 7) { g.beginPath(); g.moveTo(ox + 5, yy); g.lineTo(ox + S - 5, yy); g.stroke(); }
          rect(g, ox + 4, wy + 20, S - 8, 3, shade(wall, 0.15));
        }
        // Rows of lit windows (reading rooms)
        const rows = level ? 3 : 2;
        for (let r = 0; r < rows; r++) for (let i = 0; i < 4; i++) {
          if (r === rows - 1 && (i === 1 || i === 2)) continue;
          windowLit(g, ox + 9 + i * 13, wy + 6 + r * 16, 5, 8);
        }
        // Door with a scroll sign
        rect(g, cx - 6, oy + S - 22, 12, 14, '#4a3020');
        rrect(g, cx - 8, oy + S - 28, 16, 5, 2, '#efe2c0');
        line(g, cx - 5, oy + S - 25.5, cx + 5, oy + S - 25.5, '#8a6a46', 0.8);
        roof(g, ox + 5, ox + S - 5, wy + 1, wy - 14, wy - 19, level ? '#4f5f7a' : '#8e4a34', 3);
        if (level) {
          // Observatory dome with a telescope
          rect(g, cx - 9, wy - 26, 18, 12, '#d8cebe');
          g.fillStyle = '#5a7aa0'; g.strokeStyle = INK; g.lineWidth = 1;
          g.beginPath(); g.moveTo(cx - 11, wy - 26); g.quadraticCurveTo(cx, wy - 44, cx + 11, wy - 26); g.closePath(); g.fill(); g.stroke();
          line(g, cx + 2, wy - 34, cx + 14, wy - 42, '#c8a050', 2);
          for (let k = 0; k < 5; k++) circle(g, cx - 6 + k * 3, wy - 31 - (k % 2) * 3, 0.7, '#fff6d0', null);
          banner(g, ox + S - 12, wy + 2, 6, 13, her);
        } else {
          rect(g, ox + 40, wy - 22, 5, 10, '#8a7f72');
        }
        // Book cart
        rect(g, ox + 8, oy + S - 12, 12, 5, '#8b6a44');
        for (let k = 0; k < 4; k++) rect(g, ox + 9 + k * 2.6, oy + S - 18, 2.2, 6, ['#a83a3a', '#2f5fa8', '#3f8a4a', '#c8902e'][k], null);
      },
    };
  },

  // ---- Alchemist (2x2) -------------------------------------------------------------------------
  alchemist(level, her) {
    const S = 2 * T, top = 40 + level * 8;
    return {
      w: S + 10, h: S + top + 4, ax: 5, ay: top,
      draw(g) {
        const ox = 5, oy = top;
        shadow(g, ox + S / 2, oy + S - 4, S / 2, 7, 0.24);
        rrect(g, ox + 2, oy + 30, S - 4, S - 33, 3, '#8f8478', null);
        // Crooked workshop
        const wy = oy + 2 - level * 4;
        poly(g, [ox + 6, oy + S - 10, ox + 38, oy + S - 10, ox + 38, wy + 2, ox + 7, wy + 4], level ? '#9a8a7a' : '#b9a68a');
        for (let yy = wy + 10; yy < oy + S - 10; yy += 7) line(g, ox + 7, yy, ox + 38, yy, 'rgba(70,55,45,0.35)', 0.8);
        rect(g, ox + 17, oy + S - 26, 9, 16, '#3a2a3a');
        windowLit(g, ox + 10, wy + 14, 5, 6);
        g.fillStyle = 'rgba(120,255,150,0.6)'; g.fillRect(ox + 29, wy + 14, 5, 6);
        rect(g, ox + 29, wy + 14, 5, 6, null, 'rgba(40,25,10,0.9)', 0.8);
        roof(g, ox + 6, ox + 38, wy + 4, wy - 10, wy - 14, level ? '#5a3a6a' : '#6a4a3a', 2);
        // Chimney with coloured smoke
        rect(g, ox + 30, wy - 22, 6, 14, '#6f675e');
        smoke(g, ox + 33, wy - 26, level ? 'rgba(180,140,255,0.55)' : 'rgba(140,230,160,0.5)', 3 + level);
        // Bench of glassware
        rect(g, ox + 40, oy + 26, 20, 4, '#7a5a3a');
        line(g, ox + 42, oy + 30, ox + 42, oy + 40, '#6b4a2d', 1.4); line(g, ox + 58, oy + 30, ox + 58, oy + 40, '#6b4a2d', 1.4);
        const flask = (x, y, c, r = 3.2) => {
          circle(g, x, y, r, c, 'rgba(30,22,16,0.7)', 0.7);
          rect(g, x - 1, y - r - 4, 2, 4, 'rgba(220,240,255,0.8)', 'rgba(30,22,16,0.6)', 0.5);
          circle(g, x - r * 0.35, y - r * 0.35, r * 0.3, 'rgba(255,255,255,0.7)', null);
        };
        flask(ox + 45, oy + 22, '#7fe0a0'); flask(ox + 52, oy + 21, '#ffb36a', 2.6); flask(ox + 57, oy + 22, '#a88cff', 2.4);
        // Gold ingots: the wood-to-gold trade
        for (let k = 0; k < 2 + level; k++) poly(g, [ox + 42 + k * 6, oy + 48, ox + 47 + k * 6, oy + 48, ox + 46 + k * 6, oy + 45, ox + 43 + k * 6, oy + 45], GOLD, GOLD_D, 0.6);
        // Log pile waiting to be rendered down
        for (let i = 0; i < 3; i++) { circle(g, ox + 10 + i * 6, oy + S - 6, 2.8, '#b88a55'); circle(g, ox + 10 + i * 6, oy + S - 6, 1.3, '#d8b07a', null); }
        if (level) {
          // Copper still and a bubbling cauldron of salve
          circle(g, ox + 50, oy + 8, 7, '#c87a4a');
          line(g, ox + 56, oy + 4, ox + 62, oy - 6, '#a85a3a', 1.6);
          rect(g, ox + 47, oy + 13, 6, 6, '#6a4a3a');
          g.fillStyle = '#3a3034'; g.strokeStyle = INK; g.lineWidth = 1;
          g.beginPath(); g.ellipse(ox + 52, oy + 40, 7, 3, 0, 0, Math.PI); g.lineTo(ox + 45, oy + 36); g.ellipse(ox + 52, oy + 36, 7, 3, 0, Math.PI, 0, true); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#7fe8a0'; g.beginPath(); g.ellipse(ox + 52, oy + 36, 6, 2.4, 0, 0, Math.PI * 2); g.fill();
          for (let k = 0; k < 3; k++) circle(g, ox + 49 + k * 3, oy + 32 - k, 1.1, '#c8ffd8', null);
          banner(g, ox + 8, wy + 4, 6, 12, her);
        }
      },
    };
  },

  // ---- Ley Obelisk (1x1) -----------------------------------------------------------------------
  obelisk(level) {
    const top = 40 + level * 10;
    return {
      w: T + 12, h: T + top + 4, ax: 6, ay: top,
      draw(g) {
        const ox = 6, oy = top, cx = ox + 16;
        shadow(g, cx, oy + 27, 13, 5, 0.3);
        // Ring of small standing stones
        const ring = level >= 1 ? 6 : 3;
        for (let i = 0; i < ring; i++) {
          const a = Math.PI * (0.15 + 0.7 * (i / Math.max(1, ring - 1)));
          const x = cx + Math.cos(a + Math.PI) * 14, y = oy + 24 - Math.sin(a) * 4;
          poly(g, [x - 2, y + 3, x + 2, y + 3, x + 1.5, y - 4, x - 1.5, y - 5], '#8f8a92', 'rgba(30,22,16,0.6)', 0.6);
        }
        // Plinth
        poly(g, [ox + 7, oy + 27, ox + 25, oy + 27, ox + 23, oy + 20, ox + 9, oy + 20], '#7a7480');
        // Shaft
        const topY = oy - 22 - level * 8;
        const c = level === 0 ? '#6f6878' : level === 1 ? '#5f5870' : '#4f4868';
        poly(g, [cx - 6, oy + 21, cx + 6, oy + 21, cx + 3.5, topY + 6, cx, topY, cx - 3.5, topY + 6], c);
        g.fillStyle = 'rgba(20,10,30,0.25)'; g.beginPath(); g.moveTo(cx + 0.5, oy + 21); g.lineTo(cx + 6, oy + 21); g.lineTo(cx + 3.5, topY + 6); g.lineTo(cx, topY); g.closePath(); g.fill();
        // Glowing runes
        const runes = 3 + level * 2;
        for (let i = 0; i < runes; i++) {
          const y = oy + 16 - i * ((oy + 16 - topY - 10) / runes);
          const w = 1.5 + (i % 2);
          rect(g, cx - w / 2 - 0.5, y - 3, w, 3, LEY_L, null);
          rect(g, cx - w / 2 - 1.5, y - 2, w + 2, 1, LEY, null);
        }
        glowDisc(g, cx, topY + 4, 8 + level * 2, 'rgba(200,170,255,0.6)', 'rgba(160,120,255,0)');
        if (level >= 1) {
          // Carved band and a ley line in the ground
          rect(g, cx - 5, oy + 6, 10, 2, LEY_D, null);
          g.strokeStyle = 'rgba(190,160,255,0.75)'; g.lineWidth = 1.2;
          g.beginPath(); g.moveTo(ox - 4, oy + 30); g.quadraticCurveTo(cx, oy + 22, ox + 36, oy + 30); g.stroke();
        }
        if (level >= 2) {
          // Floating capstone crystal
          const y = topY - 10;
          glowDisc(g, cx, y, 10, 'rgba(230,210,255,0.8)', 'rgba(170,130,255,0)');
          poly(g, [cx, y - 7, cx + 4, y, cx, y + 6, cx - 4, y], LEY, LEY_D, 0.8);
          poly(g, [cx, y - 7, cx + 4, y, cx, y], LEY_L, null);
        }
      },
    };
  },

  // ---- Wonder: Sunspire (3x3) ----------------------------------------------------------------
  sunspire(level, her) {
    const S = 3 * T, top = 150 + level * 22;
    return {
      w: S + 20, h: S + top + 6, ax: 10, ay: top,
      draw(g) {
        const ox = 10, oy = top, cx = ox + S / 2;
        shadow(g, cx, oy + S - 8, S / 2 + 2, 16, 0.32);
        // Gilded terrace
        poly(g, [ox + 4, oy + S - 10, ox + S - 4, oy + S - 10, ox + S, oy + S - 30, ox + S - 8, oy + 34, ox + 8, oy + 34, ox, oy + S - 30], '#d8c8a0');
        poly(g, [ox + 4, oy + S - 10, ox + S - 4, oy + S - 10, ox + S - 2, oy + S - 20, ox + 2, oy + S - 20], '#b8a47a');
        for (let i = 0; i < 4; i++) rect(g, cx - 18 + i * 3, oy + S - 20 - i * 4, 36 - i * 6, 4, shade('#e8dcb8', -i * 0.05), 'rgba(30,22,16,0.4)', 0.6);
        // Four corner pylons with sun discs
        for (const [px, py] of [[ox + 12, oy + 40], [ox + S - 12, oy + 40], [ox + 10, oy + S - 26], [ox + S - 10, oy + S - 26]]) {
          poly(g, [px - 4, py + 8, px + 4, py + 8, px + 2.5, py - 14, px - 2.5, py - 14], '#e0cfa0');
          circle(g, px, py - 17, 3.4, GOLD, GOLD_D, 0.8);
        }
        // The needle: three tiers of gold glass
        const baseY = oy + S - 34, topY = oy - 120 - level * 22;
        const tiers = level ? 4 : 3;
        let y0 = baseY, w0 = 34;
        for (let i = 0; i < tiers; i++) {
          const y1 = baseY - (baseY - topY) * ((i + 1) / tiers) * 0.92, w1 = w0 * 0.68;
          poly(g, [cx - w0 / 2, y0, cx + w0 / 2, y0, cx + w1 / 2, y1, cx - w1 / 2, y1], shade(GOLD, 0.15 - i * 0.05), GOLD_D, 1);
          // Facets
          g.fillStyle = 'rgba(255,250,220,0.35)';
          g.beginPath(); g.moveTo(cx - w0 / 2 + 2, y0); g.lineTo(cx - 2, y0); g.lineTo(cx - 1, y1); g.lineTo(cx - w1 / 2 + 1, y1); g.closePath(); g.fill();
          g.fillStyle = 'rgba(120,70,10,0.22)';
          g.beginPath(); g.moveTo(cx + 3, y0); g.lineTo(cx + w0 / 2, y0); g.lineTo(cx + w1 / 2, y1); g.lineTo(cx + 2, y1); g.closePath(); g.fill();
          rect(g, cx - w1 / 2 - 2, y1 - 2, w1 + 4, 3, '#fff0c0', GOLD_D, 0.7);
          // Lit slit windows
          for (let k = -1; k <= 1; k += 2) rect(g, cx + k * w1 * 0.22 - 1, (y0 + y1) / 2 - 4, 2, 7, '#fff8d8', 'rgba(120,70,10,0.6)', 0.5);
          y0 = y1; w0 = w1;
        }
        poly(g, [cx - w0 / 2, y0, cx + w0 / 2, y0, cx, topY - 6], GOLD_L, GOLD_D, 1);
        // Great door
        g.fillStyle = '#5a3a1a'; g.beginPath(); g.moveTo(cx - 7, baseY); g.lineTo(cx - 7, baseY - 12); g.arc(cx, baseY - 12, 7, Math.PI, 0); g.lineTo(cx + 7, baseY); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,220,120,0.7)'; g.fillRect(cx - 5, baseY - 11, 10, 11);
        // Sun disc crowning the needle
        const sy = topY - 8;
        glowDisc(g, cx, sy, 26 + level * 6, 'rgba(255,240,170,0.9)', 'rgba(255,200,80,0)');
        const rays = 12;
        g.fillStyle = GOLD;
        for (let i = 0; i < rays; i++) {
          const a = (i / rays) * Math.PI * 2, r0 = 8, r1 = i % 2 ? 13 : 17 + level * 3;
          g.beginPath(); g.moveTo(cx + Math.cos(a - 0.12) * r0, sy + Math.sin(a - 0.12) * r0); g.lineTo(cx + Math.cos(a) * r1, sy + Math.sin(a) * r1); g.lineTo(cx + Math.cos(a + 0.12) * r0, sy + Math.sin(a + 0.12) * r0); g.closePath(); g.fill();
        }
        circle(g, cx, sy, 8, '#fff4c0', GOLD_D, 1.2);
        if (level) {
          // Flying buttresses and a halo ring
          for (const d of [-1, 1]) {
            g.strokeStyle = '#e0cfa0'; g.lineWidth = 3.2;
            g.beginPath(); g.moveTo(cx + d * 40, oy + S - 30); g.quadraticCurveTo(cx + d * 34, baseY - 60, cx + d * 9, baseY - 70); g.stroke();
            g.strokeStyle = INK; g.lineWidth = 0.8; g.stroke();
          }
          g.strokeStyle = 'rgba(255,230,140,0.9)'; g.lineWidth = 1.6;
          g.beginPath(); g.ellipse(cx, sy, 24, 7, 0, 0, Math.PI * 2); g.stroke();
        }
        banner(g, ox + 14, oy + S - 46, 8, 18, her); banner(g, ox + S - 22, oy + S - 46, 8, 18, her);
      },
    };
  },

  // ---- Wonder: World Forge (3x3) -------------------------------------------------------------
  worldforge(level, her) {
    const S = 3 * T, top = 86 + level * 16;
    return {
      w: S + 20, h: S + top + 6, ax: 10, ay: top,
      draw(g) {
        const ox = 10, oy = top, cx = ox + S / 2;
        shadow(g, cx, oy + S - 8, S / 2 + 2, 16, 0.34);
        // Basalt yard with a molten channel
        rrect(g, ox + 2, oy + 30, S - 4, S - 36, 6, '#5a5250', null);
        g.fillStyle = '#ff7a2a'; g.beginPath(); g.moveTo(ox + 8, oy + S - 14); g.quadraticCurveTo(cx, oy + S - 26, ox + S - 8, oy + S - 14); g.lineTo(ox + S - 8, oy + S - 10); g.quadraticCurveTo(cx, oy + S - 22, ox + 8, oy + S - 10); g.closePath(); g.fill();
        g.fillStyle = '#ffd27a'; g.beginPath(); g.moveTo(ox + 14, oy + S - 13); g.quadraticCurveTo(cx, oy + S - 23, ox + S - 14, oy + S - 13); g.lineTo(ox + S - 14, oy + S - 12); g.quadraticCurveTo(cx, oy + S - 22, ox + 14, oy + S - 12); g.closePath(); g.fill();
        // Forge hall
        const wy = oy - 6 - level * 6;
        rect(g, ox + 8, wy + 14, S - 16, oy + 40 - wy - 14, '#6f675e');
        g.strokeStyle = 'rgba(30,25,25,0.45)'; g.lineWidth = 1;
        for (let yy = wy + 22; yy < oy + 40; yy += 8) { g.beginPath(); g.moveTo(ox + 8, yy); g.lineTo(ox + S - 8, yy); g.stroke(); }
        // Glowing hearth mouth
        g.fillStyle = '#2a1a14'; g.beginPath(); g.moveTo(cx - 16, oy + 40); g.lineTo(cx - 16, oy + 24); g.arc(cx, oy + 24, 16, Math.PI, 0); g.lineTo(cx + 16, oy + 40); g.closePath(); g.fill();
        glowDisc(g, cx, oy + 32, 18, 'rgba(255,190,90,0.95)', 'rgba(255,90,30,0.2)');
        roof(g, ox + 8, ox + S - 8, wy + 15, wy - 4, wy - 10, '#4a3a36', 4);
        // Chimneys
        const chim = level ? [ox + 20, cx, ox + S - 20] : [ox + 22, ox + S - 22];
        chim.forEach((x, i) => {
          const h = 26 + (i % 2 ? 12 : 0) + level * 4;
          rect(g, x - 5, wy - 6 - h, 10, h + 2, '#5a5250');
          rect(g, x - 6.5, wy - 9 - h, 13, 4, '#7a706a');
          circle(g, x, wy - 11 - h, 3.5, 'rgba(255,170,80,0.85)', null);
          smoke(g, x + 1, wy - 16 - h, 'rgba(90,85,90,0.55)', 3);
        });
        // The great anvil in the yard
        const ay = oy + S - 30;
        poly(g, [cx - 8, ay + 8, cx + 8, ay + 8, cx + 5, ay - 2, cx - 5, ay - 2], '#3a3438');
        poly(g, [cx - 22, ay - 2, cx + 14, ay - 2, cx + 18, ay - 9, cx + 26, ay - 10, cx + 16, ay - 13, cx - 18, ay - 13], '#55505a');
        line(g, cx - 18, ay - 12, cx + 16, ay - 12, '#8a8494', 1.2);
        // Glowing ingot on the anvil
        rect(g, cx - 6, ay - 17, 12, 4, '#ffb347', 'rgba(120,40,10,0.8)', 0.8);
        if (level) {
          // A colossal hammer raised over it and a ring of runestones
          line(g, cx + 34, ay + 4, cx + 12, ay - 62, '#6b4a2d', 4);
          rect(g, cx - 2, ay - 78, 28, 15, '#7a7480');
          rect(g, cx - 2, ay - 78, 28, 3, '#a09aa8', null);
          line(g, cx - 2, ay - 66, cx + 26, ay - 66, '#ffb36a', 1.2);
          for (let i = 0; i < 5; i++) {
            const x = ox + 12 + i * ((S - 24) / 4);
            poly(g, [x - 3, oy + S - 6, x + 3, oy + S - 6, x + 2, oy + S - 16, x - 2, oy + S - 16], '#6f6878');
            rect(g, x - 0.8, oy + S - 14, 1.6, 4, '#ffb36a', null);
          }
        }
        banner(g, ox + 12, wy + 22, 9, 20, her); banner(g, ox + S - 21, wy + 22, 9, 20, her);
      },
    };
  },

  // ---- Wonder: Moonwell (3x3) -----------------------------------------------------------------
  moonwell(level, her) {
    const S = 3 * T, top = 34 + level * 22;
    return {
      w: S + 20, h: S + top + 6, ax: 10, ay: top,
      draw(g) {
        const ox = 10, oy = top, cx = ox + S / 2, cy = oy + 56;
        shadow(g, cx, oy + S - 8, S / 2 + 2, 16, 0.3);
        // Pale stone court
        g.fillStyle = '#d6d8e0'; g.strokeStyle = INK; g.lineWidth = 1;
        g.beginPath(); g.ellipse(cx, cy + 4, S / 2 - 2, 34, 0, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = '#b8bcc8'; g.beginPath(); g.ellipse(cx, cy + 8, S / 2 - 2, 30, 0, 0, Math.PI); g.fill();
        // Rim and pool
        g.fillStyle = '#eef0f6'; g.beginPath(); g.ellipse(cx, cy, 34, 20, 0, 0, Math.PI * 2); g.fill(); g.stroke();
        const pool = g.createRadialGradient(cx - 6, cy - 4, 2, cx, cy, 30);
        pool.addColorStop(0, '#f4f8ff'); pool.addColorStop(0.4, MOON); pool.addColorStop(1, '#4a6a9a');
        g.fillStyle = pool; g.beginPath(); g.ellipse(cx, cy, 28, 15, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 0.8;
        for (const r of [8, 15, 22]) { g.beginPath(); g.ellipse(cx, cy, r, r * 0.52, 0, 0, Math.PI * 2); g.stroke(); }
        // Reflected crescent
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx + 2, cy - 1, 6, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#9ab4e0'; g.beginPath(); g.arc(cx + 5, cy - 3, 5.2, 0, Math.PI * 2); g.fill();
        // Ring of white arches behind the pool
        const arches = level ? 7 : 5;
        for (let i = 0; i < arches; i++) {
          const a = Math.PI + (i + 0.5) * (Math.PI / arches);
          const x = cx + Math.cos(a) * 40, y = cy + Math.sin(a) * 26 - 2;
          const h = 30 + level * 6;
          rect(g, x - 3, y - h, 6, h, '#e8eaf2', 'rgba(40,40,60,0.6)', 0.7);
          circle(g, x, y - h - 2, 3, MOON, MOON_D, 0.7);
        }
        g.strokeStyle = '#e8eaf2'; g.lineWidth = 3;
        g.beginPath(); g.ellipse(cx, cy - 2 - 30 - level * 6, 40, 26, 0, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
        g.strokeStyle = 'rgba(40,40,60,0.6)'; g.lineWidth = 0.7; g.stroke();
        // Crescent statue rising from the far rim
        const my = cy - 52 - level * 18;
        rect(g, cx - 4, my + 6, 8, cy - 18 - my - 6, '#e0e2ea', 'rgba(40,40,60,0.6)', 0.7);
        glowDisc(g, cx, my, 22 + level * 6, 'rgba(220,235,255,0.85)', 'rgba(150,180,255,0)');
        g.fillStyle = '#f6f8ff'; g.strokeStyle = MOON_D; g.lineWidth = 1;
        g.beginPath(); g.arc(cx, my, 15, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = '#b8c8e8'; g.beginPath(); g.arc(cx + 7.5, my - 5, 12.5, 0, Math.PI * 2); g.fill();
        if (level) {
          // Floating moonstones and silver lanterns at the front
          for (const [dx, dy] of [[-30, -22], [30, -26], [-18, -40], [20, -44]]) {
            glowDisc(g, cx + dx, my + dy + 30, 6, 'rgba(230,240,255,0.9)', 'rgba(160,190,255,0)');
            poly(g, [cx + dx, my + dy + 25, cx + dx + 3, my + dy + 30, cx + dx, my + dy + 35, cx + dx - 3, my + dy + 30], MOON, MOON_D, 0.6);
          }
        }
        for (const x of [ox + 14, ox + S - 14]) {
          line(g, x, oy + S - 10, x, oy + S - 40, '#9aa0b0', 1.6);
          circle(g, x, oy + S - 42, 3, '#e8f0ff', MOON_D, 0.8);
          banner(g, x + 1, oy + S - 36, 7, 14, her);
        }
      },
    };
  },
};

// ---- Animated glow drawn above the night (cosmetic only) ------------------------------------------
const GLOWING = { obelisk: 1, sunspire: 1, worldforge: 1, moonwell: 1 };
const GLOW_COL = { obelisk: [190, 150, 255], sunspire: [255, 220, 120], worldforge: [255, 150, 60], moonwell: [190, 215, 255] };
export function drawCivicOverlay(g, s, view, time) {
  for (let i = 0; i < s.buildings.length; i++) {
    const b = s.buildings[i];
    if (!GLOWING[b.type] || !b.built || !b.alive) continue;
    const x0 = b.tx * T, y0 = b.ty * T;
    if (x0 + b.size * T < view.x0 || x0 > view.x1 || y0 + b.size * T < view.y0 - 200 || y0 > view.y1) continue;
    const a = glowAnchor(b.type, b.level);
    if (!a) continue;
    const [r, gg, bb] = GLOW_COL[b.type];
    const pulse = 0.55 + 0.25 * Math.sin(time * (b.type === 'worldforge' ? 6.3 : 2.1) + b.id);
    const x = x0 + a.x, y = y0 + a.y;
    g.globalCompositeOperation = 'lighter';
    const gr = g.createRadialGradient(x, y, 1, x, y, a.r);
    gr.addColorStop(0, `rgba(${r},${gg},${bb},${0.32 * pulse})`);
    gr.addColorStop(1, `rgba(${r},${gg},${bb},0)`);
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, a.r, 0, Math.PI * 2); g.fill();
    if (b.type === 'sunspire') {
      // Slowly turning rays
      g.strokeStyle = `rgba(255,230,150,${0.22 * pulse})`; g.lineWidth = 2;
      for (let k = 0; k < 6; k++) {
        const ang = time * 0.35 + (k * Math.PI) / 3;
        g.beginPath(); g.moveTo(x + Math.cos(ang) * 12, y + Math.sin(ang) * 12); g.lineTo(x + Math.cos(ang) * a.r * 1.5, y + Math.sin(ang) * a.r * 1.5); g.stroke();
      }
    } else if (b.type === 'moonwell') {
      const u = (time * 0.5 + b.id * 0.1) % 1;
      g.strokeStyle = `rgba(220,235,255,${0.5 * (1 - u)})`; g.lineWidth = 1.4;
      g.beginPath(); g.ellipse(x0 + 48, y0 + 56, 6 + u * 22, (6 + u * 22) * 0.52, 0, 0, Math.PI * 2); g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
  }
}


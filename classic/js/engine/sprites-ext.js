// Art for the Phase 2 structures (Market, Granary, Spike Trap, Ballista, Mage
// Spire) and their projectiles. Same tabletop-miniature style and helpers as
// sprites.js; teal marks magic.
import { ART } from './sprites.js';

const { INK, shadow, poly, rect, rrect, circle, line, shade, roof, windowLit, flag, banner } = ART;
const T = 32;
const TEAL = '#5fe0d0', TEAL_D = '#2a8f8a', TEAL_L = '#c8fff6';

// Striped market awning: a slanted canopy with a scalloped front valance.
function awning(g, x, y, w, depth, c1, c2) {
  const n = Math.max(3, Math.round(w / 5));
  const sw = w / n;
  for (let i = 0; i < n; i++) {
    poly(g, [x + i * sw + 2, y - depth, x + (i + 1) * sw + 2, y - depth, x + (i + 1) * sw, y, x + i * sw, y], i % 2 ? c2 : c1, null);
  }
  g.strokeStyle = INK; g.lineWidth = 0.9;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + 2, y - depth); g.lineTo(x + w + 2, y - depth); g.lineTo(x + w, y); g.stroke();
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 2 ? c2 : c1;
    g.beginPath(); g.moveTo(x + i * sw, y); g.arc(x + i * sw + sw / 2, y, sw / 2, Math.PI, 0, true); g.closePath(); g.fill();
    g.stroke();
  }
}

// One stall: posts, counter, goods and an awning.
function stall(g, x, y, w, c1, c2, goods) {
  line(g, x + 1, y + 14, x + 1, y - 6, '#6b4a2d', 1.6);
  line(g, x + w - 1, y + 14, x + w - 1, y - 6, '#6b4a2d', 1.6);
  rect(g, x, y + 6, w, 8, '#a77f50');
  line(g, x, y + 9, x + w, y + 9, '#7a5a3a', 0.8);
  rect(g, x - 1, y + 4, w + 2, 3, '#c49a64');
  for (let i = 0; i < goods.length; i++) circle(g, x + 4 + i * ((w - 8) / Math.max(1, goods.length - 1)), y + 3, 2.3, goods[i], 'rgba(30,22,16,0.5)', 0.6);
  awning(g, x - 2, y - 4, w + 4, 6, c1, c2);
}

function crate(g, x, y, s = 7) {
  rect(g, x, y, s, s, '#b48b5c');
  line(g, x, y, x + s, y + s, '#7a5a3a', 0.8); line(g, x + s, y, x, y + s, '#7a5a3a', 0.8);
}
function sack(g, x, y, c = '#d8c49a') {
  g.fillStyle = c; g.strokeStyle = INK; g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(x - 4, y); g.quadraticCurveTo(x - 5, y - 7, x - 1.5, y - 8); g.lineTo(x + 1.5, y - 8); g.quadraticCurveTo(x + 5, y - 7, x + 4, y); g.closePath(); g.fill(); g.stroke();
  line(g, x - 1.5, y - 7, x + 1.5, y - 7, '#8a6a46', 1);
}

// Cylinder with flat-shaded sides (silo body).
function cylinder(g, cx, yTop, yBot, rx, ry, color, bands) {
  g.fillStyle = color;
  g.beginPath(); g.moveTo(cx - rx, yTop); g.lineTo(cx - rx, yBot); g.ellipse(cx, yBot, rx, ry, 0, Math.PI, 0, true); g.lineTo(cx + rx, yTop); g.closePath(); g.fill();
  // side shading
  g.fillStyle = 'rgba(30,20,20,0.22)';
  g.beginPath(); g.moveTo(cx + rx * 0.35, yTop); g.lineTo(cx + rx * 0.35, yBot + ry * 0.94); g.ellipse(cx, yBot, rx, ry, 0, Math.PI * 0.39, 0, true); g.lineTo(cx + rx, yTop); g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,250,230,0.18)'; g.fillRect(cx - rx * 0.7, yTop, rx * 0.3, yBot - yTop);
  g.strokeStyle = bands; g.lineWidth = 0.8;
  for (let yy = yTop + 6; yy < yBot; yy += 6) { g.beginPath(); g.ellipse(cx, yy, rx, ry, 0, 0, Math.PI); g.stroke(); }
  g.strokeStyle = INK; g.lineWidth = 1;
  g.beginPath(); g.moveTo(cx - rx, yTop); g.lineTo(cx - rx, yBot); g.ellipse(cx, yBot, rx, ry, 0, Math.PI, 0, true); g.lineTo(cx + rx, yTop); g.stroke();
}
// Conical roof sitting on an ellipse at y.
function cone(g, cx, y, rx, ry, h, color) {
  g.fillStyle = color; g.strokeStyle = INK; g.lineWidth = 1;
  g.beginPath(); g.moveTo(cx - rx - 2, y); g.lineTo(cx, y - h); g.lineTo(cx + rx + 2, y); g.ellipse(cx, y, rx + 2, ry, 0, 0, Math.PI); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = 'rgba(20,10,10,0.25)';
  g.beginPath(); g.moveTo(cx, y - h); g.lineTo(cx + rx + 2, y); g.ellipse(cx, y, rx + 2, ry, 0, 0, Math.PI * 0.45); g.closePath(); g.fill();
  g.strokeStyle = shade(color, -0.3); g.lineWidth = 0.7;
  for (let k = 1; k < 4; k++) { const f = k / 4; g.beginPath(); g.moveTo(cx - (rx + 2) * f, y - h * (1 - f)); g.lineTo(cx + (rx + 2) * f, y - h * (1 - f)); g.stroke(); }
}

export const EXTRA_BUILDING_ART = {
  market(level, her) {
    const S = 2 * T, top = 26 + level * 4;
    return {
      w: S + 10, h: S + top + 4, ax: 5, ay: top,
      draw(g) {
        const ox = 5, oy = top;
        shadow(g, ox + S / 2, oy + S - 3, S / 2, 7, 0.22);
        // Cobbled square
        rrect(g, ox + 2, oy + 6, S - 4, S - 9, 5, level ? '#b7aa92' : '#a98f68', null);
        if (level) for (let i = 0; i < 18; i++) circle(g, ox + 7 + ((i * 29) % (S - 14)), oy + 12 + ((i * 17) % (S - 22)), 1.6, 'rgba(90,75,60,0.35)', null);
        const her1 = her ? her.field : '#b8443a', her2 = '#f1e6cf';
        if (level >= 2) {
          // Stone trade hall at the back with a banner
          rect(g, ox + 10, oy - 6, S - 20, 22, '#c9bca4');
          g.strokeStyle = 'rgba(80,65,50,0.45)'; g.lineWidth = 0.8;
          for (let yy = oy; yy < oy + 16; yy += 6) { g.beginPath(); g.moveTo(ox + 10, yy); g.lineTo(ox + S - 10, yy); g.stroke(); }
          rect(g, ox + S / 2 - 5, oy + 4, 10, 12, '#4a3020');
          windowLit(g, ox + 15, oy + 2, 5, 5); windowLit(g, ox + S - 20, oy + 2, 5, 5);
          roof(g, ox + 10, ox + S - 10, oy - 5, oy - 18, oy - 22, '#6f3f5a', 3);
          banner(g, ox + S - 16, oy - 4, 7, 14, her);
        }
        // Stalls
        const back = level >= 2 ? oy + 24 : oy + 12;
        stall(g, ox + 5, back, 22, '#c8463a', her2, ['#d8503a', '#e8b040', '#8fbf4a']);
        stall(g, ox + S - 27, back, 22, level >= 2 ? her1 : '#3f6fa0', her2, ['#e8d070', '#b06ad0', '#d8503a']);
        if (level >= 1) stall(g, ox + S / 2 - 11, back + 22, 22, '#d89a3a', her2, ['#8fbf4a', '#e8e0c0', '#c88050']);
        // Crates, sacks and a sign
        crate(g, ox + 4, oy + S - 14); crate(g, ox + 10, oy + S - 11, 6);
        sack(g, ox + S - 8, oy + S - 4); sack(g, ox + S - 15, oy + S - 3, '#cdb486');
        if (level === 0) { crate(g, ox + S / 2 - 4, oy + 38, 8); sack(g, ox + S / 2 + 10, oy + 46); }
        // Coin sign on a post
        const sx = ox + (level >= 1 ? 6 : S / 2), sy = oy + (level >= 1 ? 30 : 30);
        if (level >= 1) {
          line(g, sx, sy + 14, sx, sy - 6, '#6b4a2d', 1.6);
          circle(g, sx, sy - 8, 4.5, '#f0c040'); circle(g, sx, sy - 8, 2.4, null, '#a07818', 0.9);
        }
        if (level >= 2) flag(g, ox + 12, oy - 6, her1, 12);
      },
    };
  },

  granary(level, her) {
    const S = 2 * T, top = 62 + level * 10;
    return {
      w: S + 10, h: S + top + 4, ax: 5, ay: top,
      draw(g) {
        const ox = 5, oy = top;
        shadow(g, ox + S / 2, oy + S - 4, S / 2, 7, 0.24);
        rrect(g, ox + 3, oy + 8, S - 6, S - 12, 5, '#9a7f58', null);
        // Second, smaller silo behind the storehouse (level 2)
        if (level >= 2) {
          const c2x = ox + 15, t2 = oy - 4;
          cylinder(g, c2x, t2, oy + 18, 8, 3, '#b9ab94', 'rgba(80,65,50,0.4)');
          cone(g, c2x, t2, 8, 3, 13, '#6f3f3a');
        }
        // Small storehouse beside the silo (level 1+)
        if (level >= 1) {
          rect(g, ox + 4, oy + 20, 24, 20, '#c9b48e');
          for (let x = ox + 9; x < ox + 28; x += 6) line(g, x, oy + 20, x, oy + 40, '#8a6a46', 0.8);
          rect(g, ox + 11, oy + 30, 8, 10, '#5a3a22');
          roof(g, ox + 4, ox + 28, oy + 21, oy + 10, oy + 6, '#8e4a34', 2);
        }
        // Main silo
        const cx = ox + S - 22, rx = 13, ry = 4.5;
        const yTop = oy - 22 - level * 8, yBot = oy + 38;
        const body = level === 0 ? '#b48b5c' : '#c9bca4';
        const bands = level === 0 ? 'rgba(90,60,30,0.55)' : 'rgba(80,65,50,0.45)';
        cylinder(g, cx, yTop, yBot, rx, ry, body, bands);
        if (level === 0) for (let x = cx - rx + 4; x < cx + rx; x += 4.5) line(g, x, yTop + 2, x, yBot + 2, 'rgba(90,60,30,0.35)', 0.7);
        else { line(g, cx - rx, yTop + 10, cx + rx, yTop + 10, '#6f675e', 2); line(g, cx - rx, yBot - 8, cx + rx, yBot - 8, '#6f675e', 2); }
        // Hatch and loading door
        rect(g, cx - 3, yTop + 6, 6, 6, '#4a3020');
        g.fillStyle = '#5a3a22'; g.strokeStyle = INK; g.lineWidth = 0.9;
        g.beginPath(); g.moveTo(cx - 5, yBot + 3); g.lineTo(cx - 5, yBot - 8); g.arc(cx, yBot - 8, 5, Math.PI, 0); g.lineTo(cx + 5, yBot + 3); g.closePath(); g.fill(); g.stroke();
        cone(g, cx, yTop, rx, ry, 18 + level * 2, level === 2 ? '#3f5f8a' : '#9a5b34');
        // Wheat sheaf finial / weather vane
        if (level >= 1) flag(g, cx, yTop - 18 - level * 2, her ? her.field : '#d8a03a', 8);
        else circle(g, cx, yTop - 19, 2, '#e2c160');
        // Sacks and bales out front
        sack(g, ox + 8, oy + S - 4); sack(g, ox + 15, oy + S - 3, '#cdb486');
        if (level === 0) { circle(g, ox + 14, oy + 32, 6, '#e2c160'); circle(g, ox + 14, oy + 32, 2.6, '#c9a64a', null); sack(g, ox + 22, oy + 44); }
        if (level >= 1) sack(g, ox + 22, oy + S - 4);
        if (level >= 2) { circle(g, ox + S - 6, oy + S - 10, 5, '#e2c160'); circle(g, ox + S - 6, oy + S - 10, 2.2, '#c9a64a', null); }
      },
    };
  },

  trap(level) {
    const top = 6 + level;
    return {
      w: T + 2, h: T + top + 2, ax: 1, ay: top,
      draw(g) {
        const ox = 1, oy = top;
        shadow(g, ox + 16, oy + 22, 15, 6, 0.18);
        const frame = level === 2 ? '#5d5a66' : '#8a6a46';
        const inner = level === 2 ? '#3c3a44' : '#5e4226';
        // Frame (slightly raised board with a front lip)
        rrect(g, ox + 2, oy + 5, 28, 21, 2, frame);
        rect(g, ox + 2, oy + 24, 28, 3, shade(level === 2 ? '#5d5a66' : '#8a6a46', -0.3));
        rect(g, ox + 5, oy + 8, 22, 15, inner, 'rgba(20,14,10,0.6)', 0.8);
        if (level === 1) { line(g, ox + 2, oy + 12, ox + 30, oy + 12, '#4d4a55', 1.6); line(g, ox + 2, oy + 19, ox + 30, oy + 19, '#4d4a55', 1.6); }
        if (level === 2) for (const [x, y] of [[4, 7], [28, 7], [4, 24], [28, 24]]) circle(g, ox + x, oy + y, 1.2, '#b8bcc6', null);
        // Spikes: rows of steel triangles, back to front
        const n = level === 0 ? 3 : 4;
        const sh = level === 2 ? 9 : 7;
        for (let r = 0; r < n; r++) {
          const yy = oy + 11 + r * (12 / (n - 1)) + 1;
          for (let c = 0; c < n; c++) {
            const xx = ox + 8 + c * (16 / (n - 1)) + (r % 2 ? 1.5 : -1.5) * (level ? 1 : 0);
            poly(g, [xx - 2.2, yy, xx + 2.2, yy, xx, yy - sh], '#c8ccd2', 'rgba(30,22,16,0.85)', 0.7);
            line(g, xx - 0.6, yy - 0.8, xx, yy - sh + 1.5, '#f4f6fa', 0.6);
            if (level === 2) line(g, xx, yy - sh, xx, yy - sh + 2, '#8a2a2a', 0.9);
          }
        }
      },
    };
  },

  ballista(level, her) {
    const top = 40 + level * 4;
    return {
      w: T + 16, h: T + top + 2, ax: 8, ay: top,
      draw(g) {
        const ox = 8, oy = top;
        shadow(g, ox + 16, oy + 27, 16, 5, 0.3);
        // Plinth: timber deck at level 0, cut stone after
        const pt = oy + 6 - level * 4;
        if (level === 0) {
          poly(g, [ox + 3, oy + 28, ox + 29, oy + 28, ox + 27, pt + 4, ox + 5, pt + 4], '#9a7448');
          for (let x = ox + 8; x < ox + 28; x += 6) line(g, x, pt + 5, x, oy + 28, '#6b4a2d', 0.9);
          line(g, ox + 4, oy + 18, ox + 28, oy + 18, '#6b4a2d', 1.2);
          rect(g, ox + 2, pt, 28, 5, '#b58a58');
        } else {
          const c = level === 1 ? '#a59d90' : '#8d8a96';
          poly(g, [ox + 2, oy + 28, ox + 30, oy + 28, ox + 28, pt + 4, ox + 4, pt + 4], c);
          g.strokeStyle = 'rgba(50,40,35,0.45)'; g.lineWidth = 0.8;
          for (let yy = pt + 10; yy < oy + 28; yy += 6) { g.beginPath(); g.moveTo(ox + 3, yy); g.lineTo(ox + 29, yy); g.stroke(); }
          for (let yy = pt + 10, k = 0; yy < oy + 28; yy += 6, k++) for (let x = ox + 7 + (k % 2) * 5; x < ox + 29; x += 10) { g.beginPath(); g.moveTo(x, yy - 6); g.lineTo(x, yy); g.stroke(); }
          rect(g, ox + 1, pt, 30, 5, shade(c, 0.2));
        }
        // Turntable post
        rect(g, ox + 13, pt - 9, 6, 10, '#6b4a2d');
        circle(g, ox + 16, pt - 9, 4, '#7a5a3a');
        // Stock: a heavy beam aimed up and to the right
        const sx0 = ox + 3, sy0 = pt - 4, sx1 = ox + 30, sy1 = pt - 20;
        line(g, sx0, sy0, sx1, sy1, INK, 5.5);
        line(g, sx0, sy0, sx1, sy1, '#8a6038', 4);
        line(g, sx0 + 1, sy0 - 1.2, sx1, sy1 - 1.2, '#b0804c', 1);
        // Bow arms across the front of the stock
        const bx = ox + 25, by = pt - 17;
        const arm = level === 2 ? '#4d4a55' : '#6b4a2d';
        g.strokeStyle = INK; g.lineWidth = 3.6;
        g.beginPath(); g.moveTo(bx - 9, by - 12); g.quadraticCurveTo(bx + 3, by - 4, bx + 9, by + 11); g.stroke();
        g.strokeStyle = arm; g.lineWidth = 2.4;
        g.beginPath(); g.moveTo(bx - 9, by - 12); g.quadraticCurveTo(bx + 3, by - 4, bx + 9, by + 11); g.stroke();
        if (level >= 1) { circle(g, bx - 9, by - 12, 1.6, '#c8ccd2'); circle(g, bx + 9, by + 11, 1.6, '#c8ccd2'); }
        // Drawn string back to the trigger
        line(g, bx - 9, by - 12, ox + 12, sy0 - 6, '#e8dcc0', 0.8);
        line(g, bx + 9, by + 11, ox + 12, sy0 - 6, '#e8dcc0', 0.8);
        // Loaded bolt
        line(g, ox + 11, sy0 - 6.5, sx1 + 3, sy1 - 3, '#2b2230', 2);
        poly(g, [sx1 + 6, sy1 - 4.5, sx1 + 1, sy1 - 5, sx1 + 3, sy1 - 0.8], '#c8ccd2', INK, 0.6);
        // Windlass crank
        circle(g, ox + 7, sy0 - 1, 3, '#7a5a3a'); line(g, ox + 7, sy0 - 1, ox + 3, sy0 - 5, '#5a4330', 1.2);
        if (level >= 2 && her) banner(g, ox + 2, pt + 6, 7, 13, her);
        // Iron-shod stock and spare bolts on the upgraded engine
        if (level >= 1) { line(g, ox + 18, pt - 13, ox + 22, pt - 15.5, '#c8ccd2', 1.2); rect(g, ox + 22, pt - 2, 8, 3, '#5a4330', INK, 0.6); }
        if (level >= 2) { line(g, ox + 21, pt - 3, ox + 31, pt - 3, '#2b2230', 1.4); poly(g, [ox + 31, pt - 4.5, ox + 34, pt - 3, ox + 31, pt - 1.5], '#c8ccd2', null); }
      },
    };
  },

  spire(level, her) {
    // The orb sits 44 + 4*level above the tile centre (structures.js fires from there).
    const top = 50 + level * 6;
    return {
      w: T + 10, h: T + top + 2, ax: 5, ay: top,
      draw(g) {
        const ox = 5, oy = top;
        const cx = ox + 16, orbY = oy + 16 - 44 - level * 4;
        shadow(g, cx, oy + 27, 13, 5, 0.3);
        // Stepped stone base
        poly(g, [ox + 5, oy + 28, ox + 27, oy + 28, ox + 25, oy + 18, ox + 7, oy + 18], '#8b8277');
        rect(g, ox + 8, oy + 14, 16, 5, '#a39a8d');
        // Slender tapering shaft
        const st = orbY + 12;
        const c = level === 0 ? '#b9b2c4' : level === 1 ? '#a6a0b8' : '#8e88a6';
        poly(g, [ox + 10, oy + 15, ox + 22, oy + 15, ox + 19, st, ox + 13, st], c);
        g.fillStyle = 'rgba(30,20,40,0.2)'; g.beginPath(); g.moveTo(cx + 1.5, oy + 15); g.lineTo(ox + 22, oy + 15); g.lineTo(ox + 19, st); g.lineTo(cx + 1, st); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(60,50,70,0.45)'; g.lineWidth = 0.7;
        for (let yy = st + 8; yy < oy + 15; yy += 8) { g.beginPath(); g.moveTo(ox + 11, yy); g.lineTo(ox + 21, yy); g.stroke(); }
        // Teal rune slits down the shaft
        const runes = 2 + level;
        for (let i = 0; i < runes; i++) {
          const yy = oy + 8 - i * ((oy + 8 - st - 6) / runes);
          rect(g, cx - 1, yy - 4, 2, 4, TEAL, null);
        }
        // Door
        g.fillStyle = '#3a2a3a'; g.beginPath(); g.moveTo(cx - 3, oy + 15); g.lineTo(cx - 3, oy + 9); g.arc(cx, oy + 9, 3, Math.PI, 0); g.lineTo(cx + 3, oy + 15); g.closePath(); g.fill();
        // Crown: claws that cradle the orb
        poly(g, [ox + 11, st + 2, ox + 21, st + 2, ox + 23, st - 2, ox + 9, st - 2], shade(c, 0.15));
        for (const d of [-1, 1]) {
          g.strokeStyle = INK; g.lineWidth = 2.6;
          g.beginPath(); g.moveTo(cx + d * 6, st - 1); g.quadraticCurveTo(cx + d * 9, orbY + 2, cx + d * 4, orbY - 6); g.stroke();
          g.strokeStyle = shade(c, 0.1); g.lineWidth = 1.6;
          g.beginPath(); g.moveTo(cx + d * 6, st - 1); g.quadraticCurveTo(cx + d * 9, orbY + 2, cx + d * 4, orbY - 6); g.stroke();
        }
        // Glowing orb
        const gr = g.createRadialGradient(cx, orbY, 1, cx, orbY, 14 + level * 2);
        gr.addColorStop(0, 'rgba(160,255,240,0.75)'); gr.addColorStop(1, 'rgba(80,220,200,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(cx, orbY, 14 + level * 2, 0, Math.PI * 2); g.fill();
        circle(g, cx, orbY, 5 + level * 0.6, TEAL, TEAL_D, 1);
        circle(g, cx - 1.5, orbY - 1.5, 2, TEAL_L, null);
        if (level >= 1) {
          // Floating shards
          poly(g, [cx - 11, orbY + 2, cx - 9, orbY - 3, cx - 7, orbY + 2, cx - 9, orbY + 5], TEAL, TEAL_D, 0.6);
          poly(g, [cx + 11, orbY - 2, cx + 9, orbY - 7, cx + 7, orbY - 2, cx + 9, orbY + 1], TEAL, TEAL_D, 0.6);
        }
        if (level >= 2) {
          g.strokeStyle = 'rgba(140,255,236,0.8)'; g.lineWidth = 1;
          g.beginPath(); g.ellipse(cx, orbY + 1, 13, 4, -0.15, 0, Math.PI * 2); g.stroke();
          if (her) banner(g, ox + 21, oy - 6, 6, 12, her);
        }
      },
    };
  },
};

// Projectiles for the new towers. Returns true when it drew p.
export function drawProjectileExt(g, p, x, y) {
  if (p.kind === 'ballista') {
    const u = Math.min(1, p.t / p.dur);
    const ang = Math.atan2(p.ty - p.sy - p.arc * p.dist * 0.7 * Math.cos(Math.PI * u), p.tx - p.sx);
    const c = Math.cos(ang), s = Math.sin(ang);
    // Pale rim first so the dark shaft reads on grass and in the night alike.
    g.strokeStyle = 'rgba(240,228,200,0.55)'; g.lineWidth = 4.2;
    g.beginPath(); g.moveTo(x - c * 13, y - s * 13); g.lineTo(x, y); g.stroke();
    g.strokeStyle = '#2b2230'; g.lineWidth = 2.6;
    g.stroke();
    g.fillStyle = '#c8ccd2';
    g.beginPath(); g.moveTo(x + c * 4, y + s * 4); g.lineTo(x - s * 2.6, y + c * 2.6); g.lineTo(x + s * 2.6, y - c * 2.6); g.closePath(); g.fill();
    g.fillStyle = '#a7774a';
    g.beginPath(); g.moveTo(x - c * 13, y - s * 13); g.lineTo(x - c * 9 - s * 3, y - s * 9 + c * 3); g.lineTo(x - c * 9 + s * 3, y - s * 9 - c * 3); g.closePath(); g.fill();
    return true;
  }
  if (p.kind === 'arcane') {
    const dx = p.tx - p.sx, dy = p.ty - p.sy, l = Math.hypot(dx, dy) || 1;
    const ux = dx / l, uy = dy / l;
    g.globalCompositeOperation = 'lighter';
    for (let k = 4; k >= 1; k--) {
      g.fillStyle = `rgba(90,230,210,${0.12 * (5 - k)})`;
      g.beginPath(); g.arc(x - ux * k * 4, y - uy * k * 4, 3.6 - k * 0.5, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(120,255,235,0.35)'; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = TEAL; g.beginPath(); g.arc(x, y, 3.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = TEAL_L; g.beginPath(); g.arc(x - 0.8, y - 0.8, 1.6, 0, Math.PI * 2); g.fill();
    return true;
  }
  return false;
}

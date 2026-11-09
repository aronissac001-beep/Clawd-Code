// Procedural sprite art. Every image in the game is drawn here with Canvas 2D
// and cached on offscreen canvases per detail scale, so the per-frame cost is
// a drawImage. Style: chunky tabletop miniatures under warm lantern light.

const cache = new Map();
let bytes = 0;
export function spriteMemory() { return bytes; }
export function clearSprites() { cache.clear(); bytes = 0; }

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** Get or build a cached sprite. w,h,ax,ay are in world units. */
export function sprite(key, scale, w, h, ax, ay, draw) {
  const k = key + '@' + scale;
  let sp = cache.get(k);
  if (sp) return sp;
  const c = makeCanvas(w * scale, h * scale);
  const g = c.getContext('2d');
  g.scale(scale, scale);
  g.lineJoin = 'round'; g.lineCap = 'round';
  draw(g, w, h);
  sp = { c, w, h, ax, ay };
  cache.set(k, sp);
  bytes += c.width * c.height * 4;
  return sp;
}

/** White silhouette of another sprite (hit flash). */
export function flashOf(sp, key, scale) {
  return sprite(key + ':flash', scale, sp.w, sp.h, sp.ax, sp.ay, (g, w, h) => {
    g.drawImage(sp.c, 0, 0, w, h);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = '#fff6e0';
    g.fillRect(0, 0, w, h);
  });
}

export function scaleBucket(z) {
  if (z <= 1.05) return 1;
  if (z <= 2.1) return 2;
  if (z <= 3.1) return 3;
  return 4;
}

// ---- Drawing helpers ----------------------------------------------------------
const INK = 'rgba(30,22,16,0.75)';
function shadow(g, x, y, rx, ry, a = 0.28) {
  g.fillStyle = `rgba(20,15,30,${a})`;
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
}
function poly(g, pts, fill, stroke = INK, lw = 1) {
  g.beginPath(); g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
function rect(g, x, y, w, h, fill, stroke = INK, lw = 1) {
  g.fillStyle = fill; g.fillRect(x, y, w, h);
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.strokeRect(x + 0.5 * lw * 0, y, w, h); }
}
function rrect(g, x, y, w, h, r, fill, stroke = INK, lw = 1) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
function circle(g, x, y, r, fill, stroke = INK, lw = 1) {
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
function line(g, x1, y1, x2, y2, color, lw) {
  g.strokeStyle = color; g.lineWidth = lw; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  if (f >= 0) { r += (255 - r) * f; gg += (255 - gg) * f; b += (255 - b) * f; }
  else { r *= 1 + f; gg *= 1 + f; b *= 1 + f; }
  return `rgb(${r | 0},${gg | 0},${b | 0})`;
}
export { shade };

// Gable roof: eave line at y0 (front), ridge at yr, back edge at yb.
function roof(g, x0, x1, y0, yr, yb, color, overhang = 2) {
  poly(g, [x0 - overhang, yb + 1, x1 + overhang, yb + 1, x1 + overhang - 1, yr, x0 - overhang + 1, yr], shade(color, -0.3));
  poly(g, [x0 - overhang, y0, x1 + overhang, y0, x1 + overhang - 2, yr, x0 - overhang + 2, yr], color);
  // shingle lines
  g.strokeStyle = shade(color, -0.25); g.lineWidth = 0.8;
  for (let yy = yr + 3; yy < y0 - 1; yy += 3) { g.beginPath(); g.moveTo(x0 - overhang + 1, yy); g.lineTo(x1 + overhang - 1, yy); g.stroke(); }
  line(g, x0 - overhang + 2, yr, x1 + overhang - 2, yr, shade(color, 0.25), 1.4);
}
function windowLit(g, x, y, w, h) {
  rect(g, x, y, w, h, '#f5c25a', 'rgba(40,25,10,0.9)', 0.8);
  line(g, x + w / 2, y, x + w / 2, y + h, 'rgba(60,35,15,0.8)', 0.7);
}
function flag(g, x, y, color, h = 10) {
  line(g, x, y, x, y - h, '#5a4330', 1.2);
  poly(g, [x, y - h, x + 7, y - h + 2, x, y - h + 5], color, 'rgba(30,20,10,0.6)', 0.6);
}

// ---- Buildings --------------------------------------------------------------------
// Each returns { w, h, ax, ay, draw } in world units for a footprint of size*32.
const T = 32;
export const BUILDING_ART = {
  hearth(level, her) {
    const S = 3 * T, top = 66;
    return {
      w: S + 16, h: S + top + 6, ax: 8, ay: top,
      draw(g) {
        const ox = 8, oy = top;
        shadow(g, ox + S / 2, oy + S - 6, S * 0.5, 16, 0.32);
        // Stone dais
        poly(g, [ox + 10, oy + S - 8, ox + S - 10, oy + S - 8, ox + S - 2, oy + S - 24, ox + S - 10, oy + 30, ox + 10, oy + 30, ox + 2, oy + S - 24], '#8b8277');
        poly(g, [ox + 10, oy + S - 8, ox + S - 10, oy + S - 8, ox + S - 6, oy + S - 16, ox + 6, oy + S - 16], '#6f675e');
        // Steps
        for (let i = 0; i < 3; i++) rect(g, ox + S / 2 - 14 + i * 2, oy + S - 16 - i * 4, 28 - i * 4, 4, shade('#a39a8d', -i * 0.06), 'rgba(30,22,16,0.4)', 0.6);
        // Keep body
        const kx = ox + 18, kw = S - 36, ky = oy - 10, kb = oy + S - 26;
        rect(g, kx, ky + 22, kw, kb - ky - 22, '#b9ab94');
        // Stone courses
        g.strokeStyle = 'rgba(80,65,50,0.45)'; g.lineWidth = 0.8;
        for (let yy = ky + 28; yy < kb; yy += 7) { g.beginPath(); g.moveTo(kx, yy); g.lineTo(kx + kw, yy); g.stroke(); }
        // Top platform with crenels
        rect(g, kx - 4, ky + 12, kw + 8, 12, '#cfc2aa');
        for (let i = 0; i < 6; i++) rect(g, kx - 4 + i * ((kw + 8) / 6), ky + 6, (kw + 8) / 6 - 3, 7, '#d9cdb6', INK, 0.8);
        // Great door
        g.fillStyle = '#4a3020';
        g.beginPath(); g.moveTo(kx + kw / 2 - 9, kb); g.lineTo(kx + kw / 2 - 9, kb - 16); g.arc(kx + kw / 2, kb - 16, 9, Math.PI, 0); g.lineTo(kx + kw / 2 + 9, kb); g.closePath(); g.fill();
        g.strokeStyle = INK; g.stroke();
        g.fillStyle = 'rgba(255,190,80,0.55)'; g.fillRect(kx + kw / 2 - 6, kb - 14, 12, 14);
        windowLit(g, kx + 7, ky + 34, 6, 8); windowLit(g, kx + kw - 13, ky + 34, 6, 8);
        // Fire bowl on top (the flame itself is animated by the renderer)
        rect(g, kx + kw / 2 - 5, ky - 2, 10, 14, '#7a6b5c');
        poly(g, [kx + kw / 2 - 15, ky - 4, kx + kw / 2 + 15, ky - 4, kx + kw / 2 + 9, ky + 4, kx + kw / 2 - 9, ky + 4], '#4d4038');
        // Banners
        banner(g, kx - 1, ky + 26, 9, 22, her);
        banner(g, kx + kw - 8, ky + 26, 9, 22, her);
        if (level >= 1) {
          // Corner turrets on the upgraded keep
          for (const tx of [ox + 6, ox + S - 18]) {
            rect(g, tx, oy + 14, 12, 34, '#a99a82');
            for (let i = 0; i < 3; i++) rect(g, tx - 1 + i * 5, oy + 9, 4, 6, '#cfc2aa', INK, 0.6);
          }
        }
      },
    };
  },
  house(level) {
    const top = 16 + level * 6;
    return {
      w: T + 8, h: T + top + 4, ax: 4, ay: top,
      draw(g) {
        const ox = 4, oy = top;
        shadow(g, ox + 16, oy + 29, 15, 5);
        const wallC = level === 0 ? '#e7d7b4' : level === 1 ? '#dcd2c0' : '#e9dfca';
        const roofC = level === 0 ? '#a8653a' : level === 1 ? '#8e4a34' : '#6f3f5a';
        if (level >= 1) rect(g, ox + 3, oy + 22, 26, 7, '#9c9284');
        const wy = oy + 10 - level * 4;
        rect(g, ox + 5, wy, 22, oy + 28 - wy - (level >= 1 ? 6 : 0), wallC);
        if (level === 0) {
          // timber frame
          line(g, ox + 5, wy + 6, ox + 27, wy + 6, '#6b4a2d', 1.2);
          line(g, ox + 10, wy, ox + 10, oy + 28, '#6b4a2d', 1); line(g, ox + 22, wy, ox + 22, oy + 28, '#6b4a2d', 1);
        }
        if (level === 2) { windowLit(g, ox + 8, wy + 3, 4, 4); windowLit(g, ox + 20, wy + 3, 4, 4); }
        // door + window
        rect(g, ox + 13, oy + 19, 6, 9, '#5a3a22');
        windowLit(g, ox + 7, oy + 16, 4, 4); windowLit(g, ox + 21, oy + 16, 4, 4);
        roof(g, ox + 4, ox + 28, wy + 1, wy - 12, wy - 16, roofC);
        // chimney
        rect(g, ox + 21, wy - 18, 4, 8, '#8a7f72');
      },
    };
  },
  farm(level) {
    const S = 2 * T, top = 18;
    return {
      w: S + 8, h: S + top + 4, ax: 4, ay: top,
      draw(g) {
        const ox = 4, oy = top;
        shadow(g, ox + S / 2, oy + S - 2, S / 2, 6, 0.18);
        rrect(g, ox + 1, oy + 3, S - 2, S - 5, 4, '#7b5a35');
        // crop rows
        const crop = level === 2 ? '#d9b84a' : '#8fbf4a';
        for (let r = 0; r < 6; r++) {
          const yy = oy + 10 + r * 8;
          line(g, ox + 22, yy, ox + S - 5, yy, '#5e4226', 3);
          for (let x = ox + 24; x < ox + S - 6; x += 5) { circle(g, x, yy - 2, 2.2, crop, null); line(g, x, yy - 1, x, yy - 4, shade(crop, -0.3), 0.8); }
        }
        // shed
        rect(g, ox + 3, oy + 8, 16, 14, '#b48b5c');
        roof(g, ox + 3, ox + 19, oy + 9, oy - 2, oy - 6, '#9a5b34', 1.5);
        rect(g, ox + 8, oy + 14, 6, 8, '#5a3a22');
        // hay bale
        circle(g, ox + 11, oy + 34, 5.5, '#e2c160'); circle(g, ox + 11, oy + 34, 2.5, '#c9a64a', null);
        if (level >= 1) circle(g, ox + 11, oy + 47, 5, '#e2c160');
        // fence posts
        for (let x = ox + 2; x <= ox + S - 2; x += 8) rect(g, x, oy + S - 6, 2, 6, '#7a5a3a', null);
        line(g, ox + 2, oy + S - 4, ox + S - 2, oy + S - 4, '#8a6a46', 1.2);
      },
    };
  },
  lumber(level) {
    const S = 2 * T, top = 20;
    return {
      w: S + 8, h: S + top + 4, ax: 4, ay: top,
      draw(g) {
        const ox = 4, oy = top;
        shadow(g, ox + S / 2, oy + S - 4, S / 2 - 2, 7, 0.22);
        rrect(g, ox + 3, oy + 6, S - 6, S - 10, 6, '#9a7a52', null);
        for (let i = 0; i < 14; i++) circle(g, ox + 8 + ((i * 37) % (S - 14)), oy + 12 + ((i * 23) % (S - 20)), 1.2, '#c8a46e', null);
        // lean-to shed
        rect(g, ox + 6, oy + 6, 24, 18, '#7f5d3b');
        poly(g, [ox + 3, oy + 8, ox + 33, oy + 8, ox + 31, oy - 6, ox + 5, oy - 2], '#6d8a48');
        // log pile
        for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) {
          const lx = ox + 34 + i * 7 + r * 3.5, ly = oy + 40 - r * 6;
          circle(g, lx, ly, 3.6, '#b88a55'); circle(g, lx, ly, 1.8, '#d8b07a', null);
        }
        if (level >= 1) for (let i = 0; i < 3; i++) { circle(g, ox + 12 + i * 7, oy + 44, 3.4, '#b88a55'); circle(g, ox + 12 + i * 7, oy + 44, 1.6, '#d8b07a', null); }
        // chopping block + axe
        rect(g, ox + 44, oy + 18, 9, 8, '#8b6a44');
        line(g, ox + 47, oy + 19, ox + 53, oy + 10, '#6b4a2d', 1.6);
        poly(g, [ox + 51, oy + 9, ox + 57, oy + 8, ox + 55, oy + 13], '#c8ccd2');
        if (level >= 2) flag(g, ox + 8, oy + 4, '#d8a03a', 14);
      },
    };
  },
  quarry(level) {
    const S = 2 * T, top = 30;
    return {
      w: S + 8, h: S + top + 4, ax: 4, ay: top,
      draw(g) {
        const ox = 4, oy = top;
        shadow(g, ox + S / 2, oy + S - 4, S / 2 - 2, 7, 0.22);
        rrect(g, ox + 3, oy + 6, S - 6, S - 10, 5, '#8f8a82', null);
        // cut blocks
        const blocks = [[8, 30], [18, 30], [13, 22], [36, 40], [46, 40], [41, 32]];
        if (level >= 1) blocks.push([28, 44], [18, 40]);
        for (const [bx, by] of blocks) { rect(g, ox + bx, oy + by, 10, 8, '#bdb6aa'); rect(g, ox + bx, oy + by, 10, 2.5, '#d6d0c6', null); }
        // wooden crane
        line(g, ox + 30, oy + 30, ox + 38, oy - 22, '#6b4a2d', 2.4);
        line(g, ox + 46, oy + 30, ox + 38, oy - 22, '#6b4a2d', 2.4);
        line(g, ox + 38, oy - 22, ox + 56, oy - 16, '#7a5a3a', 2);
        line(g, ox + 55, oy - 16, ox + 55, oy + 8, '#d9c9a0', 0.8);
        rect(g, ox + 51, oy + 8, 8, 6, '#bdb6aa');
        // pick
        line(g, ox + 10, oy + 48, ox + 18, oy + 40, '#6b4a2d', 1.4);
        poly(g, [ox + 14, oy + 38, ox + 22, oy + 42, ox + 19, oy + 39], '#c8ccd2');
        if (level >= 2) flag(g, ox + 38, oy - 22, '#9aa0a8', 8);
      },
    };
  },
  wall(level) {
    const top = level === 0 ? 18 : level === 1 ? 16 : 20;
    return {
      w: T + 2, h: T + top + 2, ax: 1, ay: top,
      draw(g) {
        const ox = 1, oy = top;
        shadow(g, ox + 16, oy + 28, 16, 4, 0.22);
        if (level === 0) {
          for (let i = 0; i < 5; i++) {
            const x = ox + 1 + i * 6.2, h2 = 22 + (i % 2) * 3;
            poly(g, [x, oy + 28, x + 6, oy + 28, x + 6, oy + 28 - h2, x + 3, oy + 24 - h2, x, oy + 28 - h2], i % 2 ? '#9a7448' : '#a77f50', 'rgba(40,25,10,0.7)', 0.8);
          }
          line(g, ox, oy + 14, ox + 32, oy + 14, '#6b4a2d', 1.6);
        } else {
          const c = level === 1 ? '#a59d90' : '#8d8a96';
          rect(g, ox, oy + 2, 32, 26, c);
          rect(g, ox, oy - 6, 32, 9, shade(c, 0.18));
          for (let i = 0; i < 4; i++) rect(g, ox + 1 + i * 8, oy - 12, 6, 7, shade(c, 0.25), INK, 0.7);
          g.strokeStyle = 'rgba(50,40,35,0.45)'; g.lineWidth = 0.8;
          for (let yy = oy + 8; yy < oy + 28; yy += 6) { g.beginPath(); g.moveTo(ox, yy); g.lineTo(ox + 32, yy); g.stroke(); }
          for (let yy = oy + 8, k = 0; yy < oy + 28; yy += 6, k++) for (let x = ox + (k % 2) * 5 + 5; x < ox + 32; x += 10) { g.beginPath(); g.moveTo(x, yy - 6); g.lineTo(x, yy); g.stroke(); }
          if (level === 2) { line(g, ox, oy + 10, ox + 32, oy + 10, '#4d4a55', 2); line(g, ox, oy + 22, ox + 32, oy + 22, '#4d4a55', 2); }
        }
      },
    };
  },
  gate(level) {
    const top = 22;
    return {
      w: T + 2, h: T + top + 2, ax: 1, ay: top,
      draw(g) {
        const ox = 1, oy = top;
        shadow(g, ox + 16, oy + 28, 16, 4, 0.22);
        const c = level === 0 ? '#9a7448' : level === 1 ? '#a59d90' : '#8d8a96';
        rect(g, ox, oy - 8, 7, 36, c); rect(g, ox + 25, oy - 8, 7, 36, c);
        rect(g, ox - 1, oy - 14, 9, 7, shade(c, 0.2)); rect(g, ox + 24, oy - 14, 9, 7, shade(c, 0.2));
        rect(g, ox + 7, oy - 4, 18, 6, shade(c, 0.1));
        rect(g, ox + 7, oy + 2, 18, 26, '#7a4f2c');
        line(g, ox + 16, oy + 2, ox + 16, oy + 28, '#4a2f1a', 1);
        for (let yy = oy + 8; yy < oy + 28; yy += 7) line(g, ox + 7, yy, ox + 25, yy, '#5a3a22', 1.4);
        circle(g, ox + 13, oy + 16, 1, '#d8c070', null); circle(g, ox + 19, oy + 16, 1, '#d8c070', null);
      },
    };
  },
  tower(level, her) {
    const top = 58 + level * 8;
    return {
      w: T + 12, h: T + top + 2, ax: 6, ay: top,
      draw(g) {
        const ox = 6, oy = top;
        shadow(g, ox + 16, oy + 28, 15, 5, 0.3);
        const base = level === 0 ? '#9a7448' : '#a59d90';
        const bodyTop = oy - 30 - level * 8;
        // Legs / body
        if (level === 0) {
          line(g, ox + 6, oy + 28, ox + 9, bodyTop + 6, '#6b4a2d', 3);
          line(g, ox + 26, oy + 28, ox + 23, bodyTop + 6, '#6b4a2d', 3);
          line(g, ox + 7, oy + 16, ox + 25, oy + 4, '#7a5a3a', 1.6); line(g, ox + 25, oy + 16, ox + 7, oy + 4, '#7a5a3a', 1.6);
          line(g, ox + 8, oy - 10, ox + 24, oy - 20, '#7a5a3a', 1.6); line(g, ox + 24, oy - 10, ox + 8, oy - 20, '#7a5a3a', 1.6);
        } else {
          poly(g, [ox + 5, oy + 28, ox + 27, oy + 28, ox + 25, bodyTop + 8, ox + 7, bodyTop + 8], base);
          g.strokeStyle = 'rgba(50,40,35,0.4)'; g.lineWidth = 0.8;
          for (let yy = bodyTop + 14; yy < oy + 28; yy += 7) { g.beginPath(); g.moveTo(ox + 6, yy); g.lineTo(ox + 26, yy); g.stroke(); }
          rect(g, ox + 13, oy + 16, 6, 12, '#5a3a22');
          rect(g, ox + 14, bodyTop + 22, 4, 6, '#2b2230');
        }
        // Platform
        rect(g, ox + 1, bodyTop, 30, 10, level === 0 ? '#a77f50' : shade(base, 0.15));
        for (let i = 0; i < 5; i++) rect(g, ox + 1 + i * 6.2, bodyTop - 5, 4.6, 6, level === 0 ? '#b58a58' : shade(base, 0.25), INK, 0.6);
        // Roof
        const rc = level === 2 ? '#3f5f8a' : '#8e4a34';
        poly(g, [ox - 2, bodyTop - 6, ox + 34, bodyTop - 6, ox + 16, bodyTop - 24 - level * 3], rc);
        line(g, ox + 16, bodyTop - 24 - level * 3, ox + 16, bodyTop - 32 - level * 3, '#5a4330', 1.2);
        poly(g, [ox + 16, bodyTop - 32 - level * 3, ox + 25, bodyTop - 30 - level * 3, ox + 16, bodyTop - 27 - level * 3], her ? her.field : '#c8902e', 'rgba(30,20,10,0.6)', 0.6);
      },
    };
  },
  brazier(level) {
    const top = 20 + level * 4;
    return {
      w: T + 4, h: T + top + 2, ax: 2, ay: top,
      draw(g) {
        const ox = 2, oy = top;
        shadow(g, ox + 16, oy + 26, 11, 4, 0.3);
        poly(g, [ox + 9, oy + 27, ox + 23, oy + 27, ox + 20, oy + 18, ox + 12, oy + 18], '#8b8277');
        rect(g, ox + 13, oy + 2 - level * 3, 6, 17 + level * 3, '#6f675e');
        const by = oy + 2 - level * 3;
        const bw = 10 + level * 3;
        poly(g, [ox + 16 - bw, by - 2, ox + 16 + bw, by - 2, ox + 16 + bw * 0.6, by + 6, ox + 16 - bw * 0.6, by + 6], '#4a3c34');
        line(g, ox + 16 - bw, by - 2, ox + 16 + bw, by - 2, '#8a6a46', 1.4);
        if (level === 2) { circle(g, ox + 16, by + 12, 3, '#c8902e'); }
        // coals
        for (let i = -2; i <= 2; i++) circle(g, ox + 16 + i * (bw / 3), by - 2, 2, '#e86a2a', null);
      },
    };
  },
  barracks(level, her) {
    const S = 2 * T, top = 30 + level * 6;
    return {
      w: S + 10, h: S + top + 4, ax: 5, ay: top,
      draw(g) {
        const ox = 5, oy = top;
        shadow(g, ox + S / 2, oy + S - 3, S / 2, 7, 0.28);
        rrect(g, ox + 2, oy + 30, S - 4, S - 33, 3, '#a08a68', null);
        // Hall
        const wy = oy + 2 - level * 4;
        rect(g, ox + 4, wy, S - 8, 30 + level * 4, level ? '#b9ab94' : '#c9b48e');
        if (!level) for (let x = ox + 10; x < ox + S - 6; x += 10) line(g, x, wy, x, wy + 30, '#6b4a2d', 1);
        else { g.strokeStyle = 'rgba(80,65,50,0.45)'; g.lineWidth = 0.8; for (let yy = wy + 6; yy < wy + 34; yy += 7) { g.beginPath(); g.moveTo(ox + 4, yy); g.lineTo(ox + S - 4, yy); g.stroke(); } }
        rect(g, ox + S / 2 - 6, wy + 16 + level * 4, 12, 14, '#4a3020');
        windowLit(g, ox + 10, wy + 12, 5, 6); windowLit(g, ox + S - 15, wy + 12, 5, 6);
        roof(g, ox + 4, ox + S - 4, wy + 1, wy - 16, wy - 22, level ? '#6f3f3a' : '#8e4a34', 3);
        // Training dummy and weapon rack in the yard
        line(g, ox + 12, oy + S - 4, ox + 12, oy + 38, '#6b4a2d', 2);
        line(g, ox + 6, oy + 44, ox + 18, oy + 44, '#6b4a2d', 2);
        circle(g, ox + 12, oy + 36, 4, '#d8c49a');
        for (let i = 0; i < 3; i++) line(g, ox + 44 + i * 5, oy + S - 4, ox + 46 + i * 5, oy + 40, '#8a8f99', 1.4);
        line(g, ox + 41, oy + 48, ox + 60, oy + 48, '#6b4a2d', 1.6);
        banner(g, ox + S - 12, wy - 2, 8, 18, her);
      },
    };
  },
};

// Heraldic hanging banner with swallowtail.
export function banner(g, x, y, w, h, her) {
  if (!her) return;
  g.save();
  g.beginPath();
  g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w, y + h); g.lineTo(x + w / 2, y + h - h * 0.22); g.lineTo(x, y + h); g.closePath();
  g.clip();
  g.fillStyle = her.field; g.fillRect(x, y, w, h);
  g.fillStyle = her.second;
  drawDivision(g, her.division, x, y, w, h);
  drawSigil(g, her.sigil, x + w / 2, y + h * 0.42, Math.min(w, h) * 0.42, her.charge);
  g.restore();
  g.strokeStyle = INK; g.lineWidth = 0.7;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w, y + h); g.lineTo(x + w / 2, y + h - h * 0.22); g.lineTo(x, y + h); g.closePath(); g.stroke();
  line(g, x - 1, y, x + w + 1, y, '#6b4a2d', 1.4);
}

export function drawDivision(g, div, x, y, w, h) {
  switch (div) {
    case 'pale': g.fillRect(x + w / 2, y, w / 2, h); break;
    case 'fess': g.fillRect(x, y + h / 2, w, h / 2); break;
    case 'quarterly': g.fillRect(x + w / 2, y, w / 2, h / 2); g.fillRect(x, y + h / 2, w / 2, h / 2); break;
    case 'bend': g.beginPath(); g.moveTo(x, y); g.lineTo(x + w * 0.35, y); g.lineTo(x + w, y + h * 0.65); g.lineTo(x + w, y + h); g.lineTo(x + w * 0.65, y + h); g.lineTo(x, y + h * 0.35); g.closePath(); g.fill(); break;
    case 'chevron': g.beginPath(); g.moveTo(x, y + h * 0.75); g.lineTo(x + w / 2, y + h * 0.35); g.lineTo(x + w, y + h * 0.75); g.lineTo(x + w, y + h); g.lineTo(x + w / 2, y + h * 0.6); g.lineTo(x, y + h); g.closePath(); g.fill(); break;
    default: break;
  }
}

// Sigils drawn as vector paths centred on (cx, cy) with radius r.
export function drawSigil(g, sig, cx, cy, r, color) {
  g.fillStyle = color; g.strokeStyle = 'rgba(30,20,10,0.55)'; g.lineWidth = Math.max(0.5, r * 0.08);
  g.beginPath();
  switch (sig) {
    case 'flame':
      g.moveTo(cx, cy - r);
      g.bezierCurveTo(cx + r * 0.9, cy - r * 0.2, cx + r * 0.8, cy + r * 0.9, cx, cy + r);
      g.bezierCurveTo(cx - r * 0.8, cy + r * 0.9, cx - r * 0.9, cy - r * 0.1, cx - r * 0.25, cy - r * 0.35);
      g.bezierCurveTo(cx - r * 0.2, cy, cx + r * 0.1, cy - r * 0.4, cx, cy - r);
      break;
    case 'crown':
      g.moveTo(cx - r, cy + r * 0.6); g.lineTo(cx - r, cy - r * 0.4); g.lineTo(cx - r * 0.5, cy + r * 0.05);
      g.lineTo(cx, cy - r * 0.8); g.lineTo(cx + r * 0.5, cy + r * 0.05); g.lineTo(cx + r, cy - r * 0.4); g.lineTo(cx + r, cy + r * 0.6);
      break;
    case 'star':
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.42 : r; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      break;
    case 'tower':
      g.moveTo(cx - r * 0.6, cy + r); g.lineTo(cx - r * 0.6, cy - r * 0.5); g.lineTo(cx - r * 0.8, cy - r * 0.5); g.lineTo(cx - r * 0.8, cy - r);
      g.lineTo(cx - r * 0.35, cy - r); g.lineTo(cx - r * 0.35, cy - r * 0.75); g.lineTo(cx + r * 0.35, cy - r * 0.75); g.lineTo(cx + r * 0.35, cy - r);
      g.lineTo(cx + r * 0.8, cy - r); g.lineTo(cx + r * 0.8, cy - r * 0.5); g.lineTo(cx + r * 0.6, cy - r * 0.5); g.lineTo(cx + r * 0.6, cy + r);
      break;
    case 'sun':
      for (let i = 0; i < 16; i++) { const a = (i * Math.PI) / 8, rr = i % 2 ? r * 0.62 : r; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      break;
    case 'key':
      g.arc(cx, cy - r * 0.45, r * 0.45, 0, Math.PI * 2); g.moveTo(cx - r * 0.12, cy); g.lineTo(cx + r * 0.12, cy); g.lineTo(cx + r * 0.12, cy + r);
      g.lineTo(cx + r * 0.5, cy + r); g.lineTo(cx + r * 0.5, cy + r * 0.75); g.lineTo(cx + r * 0.12, cy + r * 0.75); g.lineTo(cx + r * 0.12, cy + r * 0.5);
      g.lineTo(cx + r * 0.4, cy + r * 0.5); g.lineTo(cx + r * 0.4, cy + r * 0.28); g.lineTo(cx + r * 0.12, cy + r * 0.28); g.lineTo(cx - r * 0.12, cy + r);
      break;
    case 'antler':
    default:
      g.moveTo(cx - r * 0.15, cy + r); g.lineTo(cx - r * 0.15, cy); g.lineTo(cx - r * 0.8, cy - r * 0.5); g.lineTo(cx - r * 0.65, cy - r * 0.65);
      g.lineTo(cx - r * 0.15, cy - r * 0.3); g.lineTo(cx - r * 0.3, cy - r); g.lineTo(cx, cy - r * 0.45); g.lineTo(cx + r * 0.3, cy - r);
      g.lineTo(cx + r * 0.15, cy - r * 0.3); g.lineTo(cx + r * 0.65, cy - r * 0.65); g.lineTo(cx + r * 0.8, cy - r * 0.5); g.lineTo(cx + r * 0.15, cy); g.lineTo(cx + r * 0.15, cy + r);
      break;
  }
  g.closePath(); g.fill(); g.stroke();
}

export function buildingSprite(type, level, scale, her) {
  const art = BUILDING_ART[type](level, her);
  return sprite(`b:${type}:${level}`, scale, art.w, art.h, art.ax, art.ay, art.draw);
}

// Scaffolding overlay for construction sites.
export function scaffoldSprite(size, scale) {
  const S = size * T, top = 26;
  return sprite(`scaffold:${size}`, scale, S + 8, S + top + 4, 4, top, (g) => {
    const ox = 4, oy = top;
    rrect(g, ox + 2, oy + 4, S - 4, S - 6, 3, 'rgba(120,95,60,0.55)', 'rgba(60,40,20,0.6)');
    for (let x = ox + 3; x <= ox + S - 3; x += Math.max(10, S / 3)) line(g, x, oy + S - 2, x, oy - 16, '#8a6a3e', 1.8);
    for (let yy = oy + S - 8; yy > oy - 14; yy -= 12) line(g, ox + 2, yy, ox + S - 2, yy, '#9a7848', 1.5);
    line(g, ox + 3, oy + S - 4, ox + S - 3, oy - 12, '#7a5a34', 1.1);
    for (let i = 0; i < size * 2; i++) rect(g, ox + 6 + i * 9, oy + S - 9, 7, 5, '#bdb6aa');
  });
}

// ---- Units ---------------------------------------------------------------------
// frame: 0 idle, 1 walk-a, 2 walk-b, 3 attack/work-a, 4 work-b
const UNIT_W = 26, UNIT_H = 32, UAX = 13, UAY = 28;

function legs(g, frame, color, y = 22) {
  const a = frame === 1 ? 2 : frame === 2 ? -2 : 0;
  rect(g, 10 + a * 0.5, y, 2.6, 6 - Math.max(0, a), color, 'rgba(25,18,12,0.7)', 0.6);
  rect(g, 13.4 - a * 0.5, y, 2.6, 6 - Math.max(0, -a), color, 'rgba(25,18,12,0.7)', 0.6);
}
function body(g, color, trim, y = 13, w = 11, h = 10) {
  rrect(g, 13 - w / 2, y, w, h, 3, color);
  if (trim) rect(g, 13 - 1.5, y + 1, 3, h - 2, trim, null);
  rect(g, 13 - w / 2 + 0.5, y + h - 3, w - 1, 1.6, 'rgba(60,40,20,0.8)', null);
}
function head(g, skin = '#e8c49a', y = 9, r = 3.8) { circle(g, 13, y, r, skin); }

const UNIT_ART = {
  villager(frame, opt) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 6, 2.4);
      legs(g, frame, '#5a4630');
      const tunics = ['#a8884e', '#7a8f5a', '#9a6a4a'];
      body(g, tunics[opt.hue % 3], null, 14, 10, 9);
      head(g, ['#e8c49a', '#c99a6e', '#a8754e'][opt.hue % 3], 10, 3.6);
      // straw hat
      g.fillStyle = '#d9bf6a'; g.beginPath(); g.ellipse(13, 8, 6, 2, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.6; g.stroke();
      rrect(g, 10.5, 4.5, 5, 3.5, 1.5, '#d9bf6a', INK, 0.6);
      // tool when working
      const up = frame === 3;
      if (opt.tool === 'hammer') { line(g, 17, 17, up ? 21 : 22, up ? 9 : 19, '#6b4a2d', 1.4); rect(g, up ? 19 : 20.5, up ? 7 : 17.5, 4, 3, '#9aa0a8'); }
      if (opt.tool === 'axe') { line(g, 17, 17, up ? 20 : 23, up ? 7 : 19, '#6b4a2d', 1.4); poly(g, up ? [19, 6, 24, 5, 22, 10] : [22, 17, 26, 20, 22, 22], '#c8ccd2', INK, 0.6); }
      if (opt.tool === 'pick') { line(g, 17, 17, up ? 20 : 23, up ? 7 : 19, '#6b4a2d', 1.4); poly(g, up ? [16, 7, 24, 6, 20, 8.5] : [21, 16, 25, 23, 22.5, 19], '#c8ccd2', INK, 0.6); }
      if (opt.tool === 'hoe') { line(g, 16, 16, up ? 19 : 22, up ? 8 : 24, '#6b4a2d', 1.4); rect(g, up ? 18 : 21, up ? 7 : 23, 4, 2, '#9aa0a8', null); }
    };
  },
  militia(frame, opt) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 6.5, 2.6);
      legs(g, frame, '#4a3a2a');
      body(g, '#8a6a44', opt.field, 13, 12, 10);
      head(g, '#e0b88e', 9);
      // leather cap
      g.fillStyle = '#6b4a2d'; g.beginPath(); g.arc(13, 8.2, 4, Math.PI, 0); g.fill();
      // round shield
      circle(g, 7.5, 18, 4.4, opt.field); circle(g, 7.5, 18, 1.6, opt.charge, null);
      // maul
      const a = frame === 3;
      line(g, 18, 18, a ? 23 : 20, a ? 6 : 8, '#6b4a2d', 1.6);
      rect(g, a ? 20.5 : 17.5, a ? 3 : 5, 6, 4.5, '#7d7f86');
    };
  },
  spearman(frame, opt) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 6.5, 2.6);
      legs(g, frame, '#3f3a40');
      body(g, opt.field, opt.charge, 13, 11, 10);
      head(g, '#e0b88e', 9);
      // conical helm
      poly(g, [8.8, 9, 17.2, 9, 13, 3], '#a9adb6', INK, 0.7);
      // spear
      const a = frame === 3;
      line(g, a ? 10 : 17, a ? 20 : 24, a ? 25 : 19, a ? 12 : -2, '#7a5a3a', 1.4);
      poly(g, a ? [24, 10.5, 28, 11, 25, 14] : [18, -2, 20, -2, 19, -7], '#d8dde4', INK, 0.6);
    };
  },
  archer(frame, opt) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 6, 2.4);
      legs(g, frame, '#3e4a2e');
      body(g, '#4f6b3a', opt.field, 13, 10, 10);
      head(g, '#e0b88e', 9);
      // hood
      g.fillStyle = '#3e5a2c'; g.beginPath(); g.arc(13, 9, 4.6, Math.PI * 0.95, Math.PI * 0.05); g.lineTo(16, 12); g.lineTo(10, 12); g.closePath(); g.fill();
      // bow
      g.strokeStyle = '#7a5a3a'; g.lineWidth = 1.5; g.beginPath(); g.arc(17, 16, 7, -1.2, 1.2); g.stroke();
      line(g, 17 + Math.cos(-1.2) * 7, 16 + Math.sin(-1.2) * 7, 17 + Math.cos(1.2) * 7, 16 + Math.sin(1.2) * 7, frame === 3 ? '#eee' : '#ccc', 0.5);
      // quiver
      rect(g, 8, 12, 3, 8, '#6b4a2d', null);
    };
  },
  sovereign(frame, opt) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 7.5, 2.8, 0.35);
      // cape
      poly(g, [7, 13, 19, 13, 21, 26, 5, 26], opt.field, INK, 0.8);
      legs(g, frame, '#3a3036');
      body(g, '#d9c9a0', opt.second, 12, 12, 11);
      head(g, '#ebc79f', 8, 4);
      // crown
      poly(g, [8.6, 6, 8.6, 1.5, 10.8, 4, 13, 0.5, 15.2, 4, 17.4, 1.5, 17.4, 6], '#f0c040', INK, 0.7);
      // sword
      const a = frame === 3;
      line(g, 18, 18, a ? 26 : 20, a ? 12 : 3, '#e6eaf0', 2);
      line(g, a ? 17 : 17, a ? 19 : 16, a ? 20 : 23, a ? 16 : 16, '#c8902e', 1.6);
    };
  },
  husk(frame) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 6, 2.4);
      legs(g, frame, '#5c5870', 21);
      // hunched ragged body
      poly(g, [7, 22, 19, 22, 18, 13, 14, 10, 9, 12], '#8d8aa3', INK, 0.8);
      line(g, 9, 14, 6, 22 + (frame === 3 ? -4 : 0), '#77738c', 2);
      line(g, 17, 14, 20, 22 + (frame === 3 ? -6 : 0), '#77738c', 2);
      circle(g, 12, 9, 3.8, '#a29fb6');
      circle(g, 10.8, 8.8, 0.9, '#e8dcff', null); circle(g, 13.4, 8.8, 0.9, '#e8dcff', null);
      line(g, 8, 19, 18, 18, '#6c6882', 0.8);
    };
  },
  hound(frame) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 9, 2.6);
      const a = frame === 1 ? 2 : frame === 2 ? -2 : 0;
      for (const [x, k] of [[6, 1], [9, -1], [17, 1], [20, -1]]) line(g, x, 21, x + a * k * 0.8, 27, '#4e4a66', 1.8);
      g.fillStyle = '#6d6890';
      g.beginPath(); g.ellipse(13, 19, 9, 4.8, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.8; g.stroke();
      // tail
      line(g, 4.5, 18, 0.5, 14 + a, '#5c5878', 1.8);
      // head
      poly(g, [19, 15, 26, 16, 25.5, 20, 19, 21], '#7a75a0', INK, 0.8);
      poly(g, [19.5, 15.5, 21, 11, 22.5, 15.5], '#5c5878', INK, 0.6);
      circle(g, 23, 16.8, 1, '#f0e6ff', null);
      if (frame === 3) poly(g, [24, 19, 27, 21, 24, 21], '#e8e2f0', null);
      // spine bristles
      for (let i = 0; i < 4; i++) line(g, 8 + i * 3, 15, 9 + i * 3, 12.5, '#4e4a66', 1);
    };
  },
  shade(frame) {
    return (g) => {
      const b = frame === 1 ? 1 : frame === 2 ? -1 : 0;
      g.globalAlpha = 0.85;
      const gr = g.createLinearGradient(0, 2, 0, 30);
      gr.addColorStop(0, '#c9bff0'); gr.addColorStop(1, 'rgba(120,100,180,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(13, 2 + b);
      g.bezierCurveTo(22, 4 + b, 21, 16, 18, 22);
      g.bezierCurveTo(16, 27, 12 + b * 2, 30, 9, 31);
      g.bezierCurveTo(10, 26, 6, 22, 6, 16);
      g.bezierCurveTo(5, 8, 8, 3 + b, 13, 2 + b);
      g.fill();
      g.globalAlpha = 1;
      // claws
      line(g, 7, 15, 3 + (frame === 3 ? -2 : 0), 19, 'rgba(200,190,240,0.8)', 1.2);
      line(g, 19, 15, 23 + (frame === 3 ? 2 : 0), 19, 'rgba(200,190,240,0.8)', 1.2);
      circle(g, 11, 9 + b, 1.3, '#ffffff', null); circle(g, 15, 9 + b, 1.3, '#ffffff', null);
    };
  },
  knight(frame) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 8.5, 3, 0.35);
      const a = frame === 1 ? 2 : frame === 2 ? -2 : 0;
      rect(g, 9 + a * 0.5, 21, 3.4, 7, '#3e3b4c', INK, 0.6); rect(g, 13.6 - a * 0.5, 21, 3.4, 7, '#3e3b4c', INK, 0.6);
      rrect(g, 6, 10, 14, 13, 3, '#57536b');
      rrect(g, 3.5, 9.5, 6, 5, 2, '#6a6680'); rrect(g, 16.5, 9.5, 6, 5, 2, '#6a6680');
      line(g, 13, 11, 13, 22, '#46435a', 1);
      // helm
      rrect(g, 8.5, 1.5, 9, 9, 2.5, '#6a6680');
      line(g, 10, 6, 16, 6, '#d9c8ff', 1.4);
      // greatsword
      const atk = frame === 3;
      line(g, atk ? 19 : 21, atk ? 19 : 22, atk ? 27 : 23, atk ? 8 : 1, '#9b97ad', 2.6);
      line(g, atk ? 17 : 19, atk ? 18 : 19, atk ? 22 : 24, atk ? 21 : 19, '#4e4a5e', 1.6);
    };
  },
};

export const UNIT_FRAMES = { idle: 0, walkA: 1, walkB: 2, act: 3, actB: 4 };

export function unitSprite(type, frame, flip, scale, opt = {}) {
  const key = `u:${type}:${frame}:${flip ? 1 : 0}:${opt.tool || ''}:${opt.hue || 0}:${opt.field || ''}`;
  return sprite(key, scale, UNIT_W, UNIT_H, UAX, UAY, (g) => {
    if (flip) { g.translate(UNIT_W, 0); g.scale(-1, 1); }
    UNIT_ART[type](frame === 4 ? 0 : frame, opt)(g);
  });
}

// ---- Nature --------------------------------------------------------------------
export function treeSprite(v, scale, pal) {
  return sprite(`tree:${v}`, scale, 44, 56, 22, 48, (g) => {
    shadow(g, 22, 47, 13, 4.5, 0.3);
    if (v < 3) {
      rect(g, 19.5, 30, 5, 17, '#6b4a2d');
      const leaf = pal.treeLeaf[v % pal.treeLeaf.length];
      const blobs = [[22, 22, 13], [13, 28, 9], [31, 28, 9], [22, 12, 9], [16, 17, 7], [29, 18, 7]];
      for (const [x, y, r] of blobs) circle(g, x, y + (v === 1 ? 2 : 0), r, shade(leaf, -0.15), INK, 0.9);
      for (const [x, y, r] of blobs) circle(g, x - 1.5, y - 2 + (v === 1 ? 2 : 0), r * 0.72, leaf, null);
      for (const [x, y, r] of blobs.slice(0, 4)) circle(g, x - 3, y - 4 + (v === 1 ? 2 : 0), r * 0.35, shade(leaf, 0.2), null);
      if (v === 2) for (let i = 0; i < 5; i++) circle(g, 14 + i * 4, 20 + (i % 2) * 6, 1.3, '#d8574a', null);
    } else {
      rect(g, 20, 36, 4, 11, '#5e4026');
      const leaf = pal.pine[v % 2];
      for (let i = 0; i < 4; i++) {
        const yy = 40 - i * 9, w2 = 15 - i * 3;
        poly(g, [22 - w2, yy, 22 + w2, yy, 22, yy - 14], shade(leaf, -0.1), INK, 0.9);
        poly(g, [22 - w2 + 3, yy - 1, 22, yy - 1, 22, yy - 13], shade(leaf, 0.12), null);
      }
    }
  });
}
export function rockSprite(v, big, scale) {
  return sprite(`rock:${v % 3}:${big ? 1 : 0}`, scale, 40, 34, 20, 28, (g) => {
    shadow(g, 20, 27, 15, 4.5, 0.3);
    const k = big ? 1 : 0.7;
    const parts = [[14, 20, 9], [26, 21, 8], [20, 13, 9]];
    for (const [x, y, r] of parts) {
      poly(g, [x - r * k, y + 5 * k, x - r * 0.8 * k, y - r * 0.6 * k, x, y - r * k, x + r * 0.8 * k, y - r * 0.5 * k, x + r * k, y + 5 * k], '#8f8c88', INK, 0.9);
      poly(g, [x - r * 0.75 * k, y - r * 0.4 * k, x, y - r * 0.9 * k, x + r * 0.6 * k, y - r * 0.4 * k, x, y - r * 0.1 * k], '#b4b0aa', null);
    }
    if (v % 3 === 1) { circle(g, 17, 15, 1.4, '#e8d36a', null); circle(g, 25, 19, 1.1, '#e8d36a', null); }
    line(g, 20, 8, 22, 16, 'rgba(50,45,40,0.5)', 0.8);
  });
}
export function stumpSprite(scale) {
  return sprite('stump', scale, 20, 14, 10, 8, (g) => {
    g.fillStyle = 'rgba(20,15,30,0.2)'; g.beginPath(); g.ellipse(10, 9, 7, 3, 0, 0, Math.PI * 2); g.fill();
    rrect(g, 5, 4, 10, 6, 2, '#6b4a2d'); g.fillStyle = '#b88a55'; g.beginPath(); g.ellipse(10, 4.5, 5, 2, 0, 0, Math.PI * 2); g.fill();
  });
}
export function rubbleSprite(size, scale) {
  const S = size * T;
  return sprite('rubble:' + size, scale, S, S, S / 2, S / 2, (g) => {
    for (let i = 0; i < 8 * size; i++) {
      const x = ((i * 53) % (S - 8)) + 4, y = ((i * 31) % (S - 8)) + 4;
      poly(g, [x - 3, y + 2, x - 1, y - 3, x + 3, y - 2, x + 2, y + 3], i % 3 ? '#77706a' : '#5a4a3a', 'rgba(20,15,10,0.5)', 0.6);
    }
    g.fillStyle = 'rgba(30,25,25,0.25)'; g.beginPath(); g.ellipse(S / 2, S / 2, S * 0.42, S * 0.35, 0, 0, Math.PI * 2); g.fill();
  });
}
export function chestSprite(scale) {
  return sprite('chest', scale, 24, 22, 12, 17, (g) => {
    shadow(g, 12, 17, 9, 3);
    rrect(g, 4, 7, 16, 10, 2, '#8a5a2e');
    rrect(g, 4, 4, 16, 5, 2.5, '#a06a36');
    rect(g, 4, 8, 16, 1.6, '#d8b04a', null); rect(g, 11, 8, 2.5, 4, '#f0d070', null);
  });
}

// A soft radial gradient used for every light pool (white core -> transparent).
export function lightSprite() {
  return sprite('light', 1, 128, 128, 64, 64, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
}
export function glowSprite(color) {
  return sprite('glow:' + color, 1, 128, 128, 64, 64, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
}

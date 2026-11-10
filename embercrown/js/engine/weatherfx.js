// Weather and season visuals (Phase 3). Cosmetic only: reads s.ext.weather and the
// season queries, never writes simulation state, and may use Math.random.
//  - screen space (BUS.draw.screen): rain streaks, snowflakes, drifting fog veil,
//    storm gloom and lightning flash, heat shimmer, winter frost vignette and a
//    cool winter tint by day.
//  - world space (BUS.draw.overlay): the 2 s lightning warning circle and the bolt.
// Particles live in fixed typed-array pools (<= 150) and honour the
// 'reduce-motion' body class (fewer particles, no flashes, static fog).
import { BUS } from '../game/hooks.js';
import { T } from '../game/grid.js';
import { WEATHER } from '../game/systems/weather.js';

const POOL = 150;
const COUNT = { rain: 110, storm: 150, snow: 120 };
const COUNT_RM = { rain: 30, storm: 36, snow: 30 };
const px = new Float32Array(POOL), py = new Float32Array(POOL), pv = new Float32Array(POOL), pz = new Float32Array(POOL);
let pN = 0, pKind = '', pW = 0, pH = 0, lastTime = -1;
let flashAt = -10, flashSeen = -1;
let fogC = null, vigC = null, vigKey = '';

function reduced() { return typeof document !== 'undefined' && !!document.body && document.body.classList.contains('reduce-motion'); }

/** Reset the particle pool for a kind of precipitation at screen size w x h. */
function seed(kind, n, w, h) {
  pKind = kind; pN = Math.min(POOL, n); pW = w; pH = h;
  for (let i = 0; i < pN; i++) {
    px[i] = Math.random() * (w + 80) - 40; py[i] = Math.random() * h;
    pz[i] = 0.5 + Math.random() * 0.5; // depth: speed, size and alpha
    pv[i] = Math.random() * 6.283;
  }
}

function drawRain(g, w, h, dt, storm) {
  const wind = storm ? 0.38 : 0.2;
  const speed = storm ? 820 : 640;
  g.lineCap = 'round';
  for (let pass = 0; pass < 2; pass++) {
    g.beginPath();
    for (let i = pass; i < pN; i += 2) {
      const v = speed * pz[i];
      py[i] += v * dt; px[i] += v * wind * dt;
      if (py[i] > h + 20) { py[i] = -20 - Math.random() * 40; px[i] = Math.random() * (w + 120) - 120; }
      if (px[i] > w + 40) px[i] -= w + 80;
      const len = 10 + 12 * pz[i];
      g.moveTo(px[i], py[i]); g.lineTo(px[i] - len * wind, py[i] - len);
    }
    g.strokeStyle = pass ? 'rgba(215,228,252,0.62)' : 'rgba(175,195,230,0.45)';
    g.lineWidth = pass ? 1.4 : 1;
    g.stroke();
  }
}

function drawSnow(g, w, h, dt, time) {
  g.beginPath();
  for (let i = 0; i < pN; i++) {
    const z = pz[i];
    py[i] += (26 + 38 * z) * dt;
    px[i] += (Math.sin(time * 0.9 + pv[i]) * 14 + 6) * z * dt;
    if (py[i] > h + 6) { py[i] = -6; px[i] = Math.random() * (w + 40) - 20; }
    if (px[i] > w + 10) px[i] -= w + 20;
    const r = 0.9 + 1.8 * z;
    g.moveTo(px[i] + r, py[i]); g.arc(px[i], py[i], r, 0, 6.283);
  }
  g.fillStyle = 'rgba(248,252,255,0.88)';
  g.fill();
}

function fogTexture() {
  if (fogC || typeof document === 'undefined') return fogC;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const x = c.getContext('2d');
  // Soft blobs kept clear of the top and bottom edges, wrapped left/right, so tiles never show seams.
  for (let i = 0; i < 30; i++) {
    const r = 26 + Math.random() * 34;
    const cx = Math.random() * S, cy = r + Math.random() * (S - 2 * r);
    for (const ox of [-S, 0, S]) {
      const gr = x.createRadialGradient(cx + ox, cy, 0, cx + ox, cy, r);
      gr.addColorStop(0, 'rgba(226,230,238,0.5)'); gr.addColorStop(1, 'rgba(226,230,238,0)');
      x.fillStyle = gr; x.fillRect(cx + ox - r, cy - r, r * 2, r * 2);
    }
  }
  fogC = c;
  return c;
}

function drawFog(g, w, h, time, rm, night) {
  g.fillStyle = night ? 'rgba(150,158,175,0.14)' : 'rgba(205,210,220,0.16)';
  g.fillRect(0, 0, w, h);
  const c = fogTexture();
  if (!c) return;
  const tw = Math.max(w, h) * 0.75;
  g.globalAlpha = night ? 0.4 : 0.55;
  for (let layer = 0; layer < 2; layer++) {
    const sp = rm ? 0 : layer ? 11 : 6;
    const off = ((time * sp + layer * 97) % tw + tw) % tw;
    for (let y = -tw * 0.5 + layer * tw * 0.33; y < h; y += tw * 0.66) {
      for (let x = -off; x < w; x += tw) g.drawImage(c, x, y, tw, tw);
    }
  }
  g.globalAlpha = 1;
}

function drawHeat(g, w, h, time, rm) {
  g.fillStyle = 'rgba(255,150,60,0.09)';
  g.fillRect(0, 0, w, h);
  if (rm) return;
  // Rising shimmer bands.
  const bh = 46;
  for (let i = 0; i < 6; i++) {
    const y = h - (((time * 18 + i * (h / 6)) % (h + bh)));
    const a = 0.035 + 0.03 * Math.sin(time * 2.3 + i * 1.7);
    g.fillStyle = `rgba(255,225,170,${a.toFixed(3)})`;
    g.fillRect(0, y, w, bh * (0.6 + 0.4 * Math.sin(time + i)));
  }
}

function vignette(w, h) {
  const key = w + 'x' + h;
  if (vigC && vigKey === key) return vigC;
  if (typeof document === 'undefined') return null;
  const c = vigC || document.createElement('canvas');
  // Render at reduced resolution; it is a soft gradient.
  c.width = Math.max(2, Math.ceil(w / 4)); c.height = Math.max(2, Math.ceil(h / 4));
  const x = c.getContext('2d');
  const cw = c.width, ch = c.height, R = Math.hypot(cw, ch) / 2;
  x.clearRect(0, 0, cw, ch);
  const gr = x.createRadialGradient(cw / 2, ch / 2, R * 0.55, cw / 2, ch / 2, R);
  gr.addColorStop(0, 'rgba(220,238,255,0)');
  gr.addColorStop(0.65, 'rgba(220,238,255,0.3)');
  gr.addColorStop(1, 'rgba(238,247,255,0.7)');
  x.fillStyle = gr; x.fillRect(0, 0, cw, ch);
  vigC = c; vigKey = key;
  return c;
}

/** BUS.draw.screen */
export function drawWeatherScreen(g, s, w, h, time) {
  if (!s || !s.cycle) return;
  const dt = lastTime < 0 ? 0 : Math.max(0, Math.min(0.1, time - lastTime));
  lastTime = time;
  const rm = reduced();
  const kind = BUS.query.weather(s);
  const winter = BUS.query.season(s) === 'winter';
  const ph = s.cycle.phase;
  const night = ph === 'night' || ph === 'dusk';
  g.save();
  // Season grade first, weather on top.
  if (winter) {
    if (!night) { g.fillStyle = 'rgba(120,165,225,0.11)'; g.fillRect(0, 0, w, h); }
    const v = vignette(w, h);
    if (v) { g.globalAlpha = night ? 0.6 : 1; g.drawImage(v, 0, 0, w, h); g.globalAlpha = 1; }
  }
  if (kind === 'rain') { g.fillStyle = 'rgba(40,58,90,0.12)'; g.fillRect(0, 0, w, h); }
  if (kind === 'storm') { g.fillStyle = night ? 'rgba(10,12,24,0.16)' : 'rgba(25,30,48,0.26)'; g.fillRect(0, 0, w, h); }
  if (kind === 'fog') drawFog(g, w, h, time, rm, night);
  else if (kind === 'heat') drawHeat(g, w, h, time, rm);
  const precip = kind === 'rain' || kind === 'storm' || kind === 'snow' ? kind : '';
  if (precip) {
    const n = (rm ? COUNT_RM : COUNT)[precip];
    if (pKind !== precip || pN !== n || Math.abs(pW - w) > 2 || Math.abs(pH - h) > 2) seed(precip, n, w, h);
    if (precip === 'snow') drawSnow(g, w, h, dt, time);
    else drawRain(g, w, h, dt, precip === 'storm');
  } else pKind = '';
  // Lightning flash (never with reduce motion).
  const st = s.ext && s.ext.weather && s.ext.weather.strike;
  if (st && st.t !== flashSeen) {
    const fresh = flashSeen !== -1 || s.time - st.t < 0.3;
    flashSeen = st.t;
    if (fresh && s.time - st.t < 0.3) flashAt = time;
  }
  const fa = time - flashAt;
  if (!rm && fa >= 0 && fa < 0.24) {
    g.fillStyle = `rgba(240,246,255,${(0.6 * (1 - fa / 0.24)).toFixed(3)})`;
    g.fillRect(0, 0, w, h);
  }
  g.restore();
}

/** BUS.draw.overlay (world space): lightning warning circles and the bolt itself. */
export function drawWeatherOverlay(g, s, view, time) {
  const w = s.ext && s.ext.weather;
  if (!w) return;
  const rm = reduced();
  const R = WEATHER.storm.radius * T;
  const b = w.bolt;
  if (b && b.x > view.x0 - R && b.x < view.x1 + R && b.y > view.y0 - R && b.y < view.y1 + R) {
    const f = Math.max(0, Math.min(1, b.t / (b.warn || 2)));
    const pulse = rm ? 0.5 : 0.5 + 0.5 * Math.sin(time * (10 + 14 * (1 - f)));
    g.save();
    g.fillStyle = `rgba(255,214,60,${(0.2 + 0.2 * pulse).toFixed(3)})`;
    g.beginPath(); g.arc(b.x, b.y, R, 0, 6.283); g.fill();
    g.strokeStyle = 'rgba(40,28,0,0.6)'; g.lineWidth = 5.5; g.stroke();
    g.strokeStyle = '#ffe45a'; g.lineWidth = 3;
    g.setLineDash([7, 5]); g.lineDashOffset = rm ? 0 : -time * 30;
    g.stroke();
    g.setLineDash([]);
    // Countdown arc: shrinks to the strike.
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.arc(b.x, b.y, R + 6, -Math.PI / 2, -Math.PI / 2 + 6.283 * f); g.stroke();
    // Bolt glyph.
    boltGlyph(g, b.x, b.y, 14, '#fff6b0', 'rgba(60,40,0,0.85)');
    g.restore();
  }
  const st = w.strike;
  if (st) {
    const age = s.time - st.t;
    if (age >= 0 && age < 1.6) {
      g.save();
      // Scorch ring.
      g.fillStyle = `rgba(30,24,20,${(0.35 * (1 - age / 1.6)).toFixed(3)})`;
      g.beginPath(); g.ellipse(st.x, st.y, R * 0.8, R * 0.5, 0, 0, 6.283); g.fill();
      if (age < 0.32) {
        const a = 1 - age / 0.32;
        let seedV = Math.floor(st.t * 1000) % 9973;
        const rnd = () => ((seedV = (seedV * 16807) % 2147483647) / 2147483647);
        const pts = [];
        let x = st.x + (rnd() - 0.5) * 60, y = st.y - 320;
        for (let i = 0; i <= 8; i++) { pts.push(x, y); const k = (i + 1) / 9; x = st.x + (x - st.x) * (1 - k) + (rnd() - 0.5) * 26 * (1 - k); y = st.y - 320 * (1 - k); }
        pts.push(st.x, st.y);
        g.lineJoin = 'round'; g.lineCap = 'round';
        for (const [lw, col] of [[10, `rgba(170,200,255,${(0.35 * a).toFixed(3)})`], [3.2, `rgba(255,255,255,${a.toFixed(3)})`]]) {
          g.strokeStyle = col; g.lineWidth = lw;
          g.beginPath(); g.moveTo(pts[0], pts[1]);
          for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
          g.stroke();
        }
        if (!rm) { // no bright burst with reduce motion
          g.fillStyle = `rgba(255,250,220,${(0.5 * a).toFixed(3)})`;
          g.beginPath(); g.arc(st.x, st.y, R * 0.9, 0, 6.283); g.fill();
        }
      }
      g.restore();
    }
  }
}

function boltGlyph(g, x, y, s, fill, line) {
  g.beginPath();
  g.moveTo(x + s * 0.15, y - s); g.lineTo(x - s * 0.55, y + s * 0.12); g.lineTo(x - s * 0.02, y + s * 0.12);
  g.lineTo(x - s * 0.2, y + s); g.lineTo(x + s * 0.6, y - s * 0.2); g.lineTo(x + s * 0.05, y - s * 0.2); g.closePath();
  g.fillStyle = fill; g.fill();
  if (line) { g.strokeStyle = line; g.lineWidth = Math.max(1, s * 0.12); g.lineJoin = 'round'; g.stroke(); }
}

// ---- Vector weather icons (HUD) ---------------------------------------------------------------
function cloud(g, cx, cy, s, fill, line) {
  g.beginPath();
  g.arc(cx - s * 0.2, cy + s * 0.02, s * 0.2, Math.PI * 0.5, Math.PI * 1.5);
  g.arc(cx - s * 0.02, cy - s * 0.1, s * 0.24, Math.PI * 1.05, Math.PI * 1.85);
  g.arc(cx + s * 0.22, cy + s * 0.02, s * 0.18, Math.PI * 1.4, Math.PI * 0.5);
  g.closePath();
  g.fillStyle = fill; g.fill();
  if (line) { g.strokeStyle = line; g.lineWidth = Math.max(1, s * 0.06); g.stroke(); }
}
function sun(g, cx, cy, s, core, ray) {
  g.strokeStyle = ray; g.lineWidth = Math.max(1.2, s * 0.08); g.lineCap = 'round';
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 6.283;
    g.moveTo(cx + Math.cos(a) * s * 0.3, cy + Math.sin(a) * s * 0.3);
    g.lineTo(cx + Math.cos(a) * s * 0.44, cy + Math.sin(a) * s * 0.44);
  }
  g.stroke();
  g.fillStyle = core; g.beginPath(); g.arc(cx, cy, s * 0.21, 0, 6.283); g.fill();
}

/** Draw a weather icon centred at (cx, cy) in a box of size s. */
export function drawWeatherIcon(g, kind, cx, cy, s, night = false) {
  g.save();
  g.lineCap = 'round'; g.lineJoin = 'round';
  switch (kind) {
    case 'rain':
      cloud(g, cx, cy - s * 0.1, s, '#c9d4e4', 'rgba(20,24,34,0.6)');
      g.strokeStyle = '#7fb6ff'; g.lineWidth = Math.max(1.4, s * 0.08);
      g.beginPath();
      for (let i = -1; i <= 1; i++) { const x = cx + i * s * 0.2; g.moveTo(x + s * 0.05, cy + s * 0.14); g.lineTo(x - s * 0.04, cy + s * 0.38); }
      g.stroke();
      break;
    case 'fog':
      g.strokeStyle = '#d6dbe4'; g.lineWidth = Math.max(1.8, s * 0.1);
      g.beginPath();
      g.moveTo(cx - s * 0.36, cy - s * 0.2); g.lineTo(cx + s * 0.22, cy - s * 0.2);
      g.moveTo(cx - s * 0.24, cy); g.lineTo(cx + s * 0.36, cy);
      g.moveTo(cx - s * 0.36, cy + s * 0.2); g.lineTo(cx + s * 0.16, cy + s * 0.2);
      g.stroke();
      break;
    case 'storm':
      cloud(g, cx, cy - s * 0.12, s, '#7d8598', 'rgba(10,12,20,0.7)');
      boltGlyph(g, cx + s * 0.02, cy + s * 0.2, s * 0.24, '#ffe04a', 'rgba(60,40,0,0.8)');
      break;
    case 'heat':
      sun(g, cx, cy - s * 0.08, s * 0.85, '#ff8a3a', '#ffc04a');
      g.strokeStyle = '#ff6a3a'; g.lineWidth = Math.max(1.3, s * 0.07);
      g.beginPath();
      for (let j = 0; j < 2; j++) {
        const y = cy + s * (0.28 + j * 0.13);
        g.moveTo(cx - s * 0.32, y);
        for (let k = 1; k <= 4; k++) g.quadraticCurveTo(cx - s * 0.32 + (k - 0.5) * s * 0.16, y + (k % 2 ? -1 : 1) * s * 0.06, cx - s * 0.32 + k * s * 0.16, y);
      }
      g.stroke();
      break;
    case 'snow': {
      g.strokeStyle = 'rgba(20,30,50,0.55)'; g.lineWidth = Math.max(2.8, s * 0.16);
      const arms = () => {
        g.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI + Math.PI / 2, c = Math.cos(a), d = Math.sin(a);
          g.moveTo(cx - c * s * 0.4, cy - d * s * 0.4); g.lineTo(cx + c * s * 0.4, cy + d * s * 0.4);
          for (const sg of [-1, 1]) {
            const bx = cx + sg * c * s * 0.25, by = cy + sg * d * s * 0.25;
            const pa = a + Math.PI / 2;
            g.moveTo(bx, by); g.lineTo(bx + sg * c * s * 0.1 + Math.cos(pa) * s * 0.1, by + sg * d * s * 0.1 + Math.sin(pa) * s * 0.1);
            g.moveTo(bx, by); g.lineTo(bx + sg * c * s * 0.1 - Math.cos(pa) * s * 0.1, by + sg * d * s * 0.1 - Math.sin(pa) * s * 0.1);
          }
        }
        g.stroke();
      };
      arms();
      g.strokeStyle = '#eaf5ff'; g.lineWidth = Math.max(1.3, s * 0.07);
      arms();
      break;
    }
    default: // clear
      if (night) {
        g.fillStyle = '#e6e2c8';
        g.beginPath(); g.arc(cx, cy, s * 0.3, 0, 6.283); g.fill();
        g.globalCompositeOperation = 'destination-out';
        g.beginPath(); g.arc(cx + s * 0.14, cy - s * 0.1, s * 0.26, 0, 6.283); g.fill();
      } else sun(g, cx, cy, s, '#f6c945', '#f6d36a');
  }
  g.restore();
}

// ---- Registration --------------------------------------------------------------------------
let done = false;
export function register() {
  if (done) return;
  done = true;
  BUS.draw.screen.push(drawWeatherScreen);
  BUS.draw.overlay.push(drawWeatherOverlay);
}

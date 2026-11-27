// The title illustration (owner D; docs/ART-STYLE.md): a mountain at dusk with the hold carved into its
// flank, the Hearth glowing in its gate, lit windows up the cliff and pines in the foreground. Drawn in
// code as pixel art at a small native size and shown at a whole-number scale with smoothing off; the
// native canvas is sized to the box it fills, so the scene widens on landscape screens instead of
// stretching. Colours come from palette.js only. Browser only (nothing runs at import).
//   mountTitleArt(host, { season })   fill `host` (the title's .ec-title-bg) with the canvas; redraws on
//                         resize and flickers the gate fire twice a second (not under Reduce motion, the
//                         OS setting or the game's, nor Battery saver). Returns { canvas, setSeason(s), destroy() }.
//   paintTitle(p, w, h, frame, { season })   paint the scene into a Px painter of w x h native px (contact
//                         sheet, icons)
// season (W1.6, EMBERCROWN-WORLD.md 8.3: the title shows the last save's season): 0 Thaw, 1 Highsun, 2 Ashfall,
// 3 Deepcold, as js/game/core/time.js SEASON_NAMES; null or absent is the plain dusk scene (first run). Seasons
// change the snow line, the turf, the pines and a few static motes (blossom, ash, flakes); no gradients, no arcs.

import { PAL, dith } from './palette.js';
import { Px } from './pixel.js';

/** A small integer hash (render only; stable across frames so the scene never shimmers). */
const hash = (x, y = 0) => { let n = (x * 374761393 + y * 668265263) | 0; n = (n ^ (n >>> 13)) * 1274126177; return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };

/** Per-season knobs; DUSK is the scene as it was before seasons (so the first run is unchanged). */
const DUSK = Object.freeze({ cap: 0.16, shoulder: 0.05, depth: 4, turf: PAL.moss0, pineLit: PAL.moss1, pineTop: null, speck: null, sky: null });
const LOOKS = Object.freeze([
  Object.freeze({ ...DUSK, cap: 0.13, shoulder: 0.03, turf: PAL.moss1, speck: PAL.peach }),                        // Thaw: blossom in the turf
  Object.freeze({ ...DUSK, cap: 0.08, shoulder: 0, turf: PAL.moss2, pineLit: PAL.moss2 }),                         // Highsun: the snow is gone
  Object.freeze({ ...DUSK, cap: 0.12, shoulder: 0.03, turf: PAL.umber1, pineLit: PAL.umber3, speck: PAL.gold, sky: PAL.stone1 }), // Ashfall: ember-gold, ash
  Object.freeze({ ...DUSK, cap: 0.26, shoulder: 0.13, depth: 7, turf: PAL.mist, pineTop: PAL.bone, sky: PAL.bone }), // Deepcold: snow everywhere
]);
/** The look of a season index (anything else: DUSK). */
export const titleLook = (season) => (Number.isInteger(season) && season >= 0 && season < 4 ? LOOKS[season] : DUSK);

/** Ridge height (native y of the mountain's top edge) at column x: three peaks with a jagged edge. */
function ridge(x, w, h) {
  const cx = w / 2;
  const peaks = [[cx - 2, h * 0.2, 1.0], [cx - h * 0.95, h * 0.44, 0.8], [cx + h * 0.9, h * 0.4, 0.85], [cx - h * 1.9, h * 0.62, 0.7], [cx + h * 1.85, h * 0.6, 0.75]];
  let y = h, pk = 0;
  for (let k = 0; k < peaks.length; k++) {
    const [px, py, sl] = peaks[k];
    const v = py + Math.abs(x - px) * sl;
    if (v < y) { y = v; pk = k; }
  }
  const j = Math.floor(hash(x >> 1, 7) * 3) - 1; // a 1 px jag every 2 columns
  return { y: Math.round(y + j), left: x < peaks[pk][0], peak: pk, px: peaks[pk][0], py: peaks[pk][1] };
}

/**
 * Paint the scene: w x h native px, light from the top-left, 2-3 tones per surface with Bayer dither.
 * frame (0, 1) flickers the gate fire.
 */
export function paintTitle(p, w, h, frame = 0, opts = {}) {
  const look = titleLook(opts && opts.season);
  const cx = Math.round(w / 2);
  const groundY = h - Math.max(8, Math.round(h * 0.1));
  // 1. the massif: lit (left) and shadowed (right) faces, darker toward the base, snow on the high peak
  for (let x = 0; x < w; x++) {
    const r = ridge(x, w, h);
    for (let y = Math.max(0, r.y); y < groundY + 2; y++) {
      const depth = (y - r.y) / Math.max(1, groundY - r.y); // 0 at the ridge, 1 at the base
      const fromTop = y - r.py;
      let c;
      if (r.left) c = depth < 0.12 ? PAL.slate3 : depth < 0.5 ? PAL.slate2 : PAL.slate1;
      else c = depth < 0.12 ? PAL.slate2 : depth < 0.5 ? PAL.slate1 : PAL.slate0;
      // dithered band edges
      if (r.left && depth >= 0.42 && depth < 0.58 && dith(x, y, Math.round((depth - 0.42) * 100))) c = PAL.slate1;
      if (!r.left && depth >= 0.42 && depth < 0.58 && dith(x, y, Math.round((depth - 0.42) * 100))) c = PAL.slate0;
      if (depth > 0.7 && dith(x, y, Math.round((depth - 0.7) * 40))) c = PAL.night;
      // snow on the main peak and the shoulders' tops
      if (fromTop < h * (r.peak === 0 ? look.cap : look.shoulder) && y - r.y < look.depth) c = r.left ? PAL.bone : PAL.mist;
      if (r.peak === 0 && fromTop < h * (look.cap + 0.04) && y - r.y < look.depth + 2 && dith(x, y, 6)) c = r.left ? PAL.mist : PAL.slate3;
      p.px(x, y, c);
    }
    // the ridge outline
    if (r.y >= 0 && r.y < groundY) p.px(x, r.y - 1, PAL.ink);
  }
  // strata: dark diagonal cracks down the faces
  for (let k = 0; k < Math.round(w / 9); k++) {
    const x0 = Math.floor(hash(k, 3) * w), r = ridge(x0, w, h), y0 = r.y + 3 + Math.floor(hash(k, 5) * 10);
    const len = 4 + Math.floor(hash(k, 9) * 8), dir = r.left ? 1 : -1;
    for (let t = 0; t < len; t++) { const x = x0 + Math.round(t * 0.5) * dir, y = y0 + t; if (y < groundY - 6 && y > ridge(x, w, h).y + 2) p.px(x, y, r.left ? PAL.slate1 : PAL.night); }
  }
  // 2. the hold: a stair of lit windows up the cliff and the great gate with the Hearth inside
  const gateW = Math.max(10, Math.round(h * 0.11)) | 1, gateH = Math.round(gateW * 1.3), gx = cx - (gateW >> 1), gy = groundY - gateH;
  // warm glow on the rock around the gate (dithered rings)
  for (let y = gy - gateH; y < groundY + 2; y++) for (let x = gx - gateW * 2; x < gx + gateW * 3; x++) {
    const dx = (x - cx) / (gateW * 1.7), dy = (y - (groundY - gateH * 0.45)) / (gateH * 1.25), d = dx * dx + dy * dy;
    if (d > 1 || y < ridge(x, w, h).y + 1) continue;
    if (d < 0.4 ? dith(x, y, 10) : d < 0.7 ? dith(x, y, 6) : dith(x, y, 2)) p.px(x, y, d < 0.4 ? PAL.ember1 : d < 0.7 ? PAL.umber2 : PAL.umber1);
  }
  // the gate: a stone frame, an arched opening, the fire inside
  p.rect(gx - 2, gy - 2, gateW + 4, gateH + 2, PAL.stone0);
  p.hl(gx - 2, gy - 2, gateW + 4, PAL.stone1); p.vl(gx - 2, gy - 2, gateH + 2, PAL.stone1);
  p.rect(gx - 3, gy - 4, gateW + 6, 2, PAL.stone1); p.hl(gx - 3, gy - 4, gateW + 6, PAL.mist);
  p.rect(gx, gy, gateW, gateH, PAL.ember0);
  p.px(gx, gy, PAL.stone0); p.px(gx + gateW - 1, gy, PAL.stone0); // the arch's corners
  for (let y = gy + 1; y < gy + gateH; y++) for (let x = gx + 1; x < gx + gateW - 1; x++) {
    const u = (y - gy) / gateH;
    if (u > 0.35 && dith(x, y, Math.round((u - 0.35) * 26))) p.px(x, y, PAL.ember1);
  }
  // the Hearth fire: a 2-frame flame on a stone ring at the back of the gate
  const fx = cx, fb = groundY - 2, fh = Math.max(5, Math.round(gateH * 0.55));
  for (let y = 0; y < fh; y++) {
    const half = Math.max(0, Math.round((1 - y / fh) * (gateW * 0.32)) - (y > fh * 0.6 && (frame + y) & 1 ? 1 : 0));
    const sway = y > fh * 0.5 ? (frame ? 1 : 0) : 0;
    for (let x = -half; x <= half; x++) {
      const core = Math.abs(x) < half * 0.5 && y < fh * 0.7;
      p.px(fx + x + sway, fb - y, core ? (y < fh * 0.35 ? PAL.bone : PAL.flame) : Math.abs(x) === half ? PAL.orange : PAL.gold);
    }
  }
  p.rect(cx - (gateW >> 1) + 1, fb + 1, gateW - 2, 1, PAL.stone1);
  // a stone path from the gate down to the foreground
  for (let y = groundY; y < h; y++) { const half = 2 + Math.round((y - groundY) * 0.6); for (let x = cx - half; x <= cx + half; x++) if (dith(x, y, 9)) p.px(x, y, PAL.stone0); }
  // windows up the cliff (2 x 3, a few flicker)
  const wins = [[-0.9, 0.62], [0.95, 0.66], [-0.45, 0.42], [0.5, 0.46], [0.05, 0.3], [-1.4, 0.74], [1.45, 0.76]];
  for (let k = 0; k < wins.length; k++) {
    const x = Math.round(cx + wins[k][0] * gateW * 1.6), y = Math.round(h * wins[k][1]);
    if (y < ridge(x, w, h).y + 4 || y > gy - 4) continue;
    p.rect(x - 1, y - 1, 4, 5, PAL.ink);
    p.rect(x, y, 2, 3, (k + frame) % 3 === 0 ? PAL.orange : PAL.gold);
    p.px(x, y, PAL.flame);
  }
  // 3. the foreground: a dark ridge of ground and pine silhouettes on both sides
  for (let x = 0; x < w; x++) {
    const top = groundY + Math.round(Math.sin(x * 0.13) * 1.5 + hash(x >> 2, 11) * 1.5) - (Math.abs(x - cx) < gateW ? 0 : 1);
    for (let y = top; y < h; y++) p.px(x, y, y === top ? look.turf : look.pineTop && y === top + 1 && dith(x, y, 8) ? PAL.slate3 : PAL.night);
    // blossom (Thaw) or fallen embers (Ashfall) in the turf, fixed by column so they never shimmer
    if (look.speck && Math.abs(x - cx) > 3 && hash(x, 41) < 0.12) p.px(x, top + 1, look.speck);
  }
  const pine = (bx, by, s) => {
    for (let y = 0; y < s * 3; y++) {
      const tier = y % s, half = Math.round(1 + tier * 0.7 + (y / s) * 1.2);
      for (let x = -half; x <= half; x++) {
        let c = x < 0 && tier < s - 1 ? look.pineLit : PAL.moss0;
        if (look.pineTop && tier === 0 && x <= 0) c = PAL.bone;            // snow along each tier's top, lit side
        else if (look.pineTop && tier === 1 && x < 0 && dith(bx + x, y, 8)) c = PAL.mist;
        p.px(bx + x, by - s * 3 + y, c);
      }
    }
    p.rect(bx, by - 1, 1, 2, PAL.umber0);
  };
  for (let k = 0; k < Math.ceil(w / 14); k++) {
    const x = Math.round((k + 0.5) * 14 + (hash(k, 2) - 0.5) * 8);
    if (Math.abs(x - cx) < gateW * 2.2) continue;
    pine(x, groundY + 3 + Math.floor(hash(k, 4) * 3), 4 + Math.floor(hash(k, 6) * 3));
  }
  // the sky's motes (Ashfall ash, Deepcold flakes): placed by hash, stepping down one pixel with the frame
  if (look.sky) {
    for (let k = 0; k < Math.round(w * h / 90); k++) {
      const x = Math.floor(hash(k, 51) * w), y = Math.floor(hash(k, 53) * (groundY - 2)) + (frame & (k & 1));
      if (y < ridge(x, w, h).y - 1 || (look.pineTop && hash(k, 57) < 0.5)) p.px(x, y, look.sky);
    }
  }
  // embers drifting up out of the gate
  for (let k = 0; k < 5; k++) { const ex = cx + Math.round((hash(k, 21 + frame) - 0.5) * gateW * 1.4), ey = gy - 3 - Math.floor(hash(k, 31) * gateH); if (ey > ridge(ex, w, h).y) p.px(ex, ey, k & 1 ? PAL.orange : PAL.gold); }
}

/** The native pixel size for a box of css w x h at dpr: one art pixel = k device px (k a whole number, about 3 css px). */
function nativeOf(cw, ch, dpr) {
  const k = Math.max(2, Math.round(3 * dpr));
  return { k, w: Math.max(32, Math.ceil((cw * dpr) / k)), h: Math.max(24, Math.ceil((ch * dpr) / k)) };
}

/** Fill host with the title canvas (see the header). */
export function mountTitleArt(host, opts = {}) {
  const c = document.createElement('canvas');
  c.className = 'ec-title-art';
  c.setAttribute('aria-hidden', 'true');
  c.style.cssText = 'position:absolute;left:50%;bottom:0;image-rendering:pixelated;image-rendering:crisp-edges;';
  host.appendChild(c);
  let frame = 0, size = null, timer = 0, ro = null, season = opts && Number.isInteger(opts.season) ? opts.season : null;
  const reduce = () => {
    const d = document.documentElement && document.documentElement.dataset;
    if (d && (d.ecMotion === 'reduce' || d.ecBattery === 'saver')) return true;
    try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
  };
  const draw = () => {
    const cw = host.clientWidth, ch = host.clientHeight;
    if (!cw || !ch) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1), n = nativeOf(cw, ch, dpr);
    if (!size || size.w !== n.w || size.h !== n.h || size.k !== n.k) {
      size = n;
      c.width = n.w; c.height = n.h;
      c.style.width = `${(n.w * n.k) / dpr}px`; c.style.height = `${(n.h * n.k) / dpr}px`;
      c.style.transform = 'translateX(-50%)';
    }
    const g = c.getContext('2d');
    g.clearRect(0, 0, n.w, n.h);
    paintTitle(new Px(g), n.w, n.h, reduce() ? 0 : frame, { season });
  };
  draw();
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => draw()); ro.observe(host); }
  if (!reduce()) {
    timer = setInterval(() => {
      if (!c.isConnected) { if (size) { clearInterval(timer); if (ro) ro.disconnect(); } return; }
      if (document.hidden || reduce()) return;
      frame ^= 1; draw();
    }, 480);
  }
  const setSeason = (x) => { const v = Number.isInteger(x) && x >= 0 && x < 4 ? x : null; if (v !== season) { season = v; draw(); } };
  return { canvas: c, setSeason, destroy() { clearInterval(timer); if (ro) ro.disconnect(); c.remove(); } };
}

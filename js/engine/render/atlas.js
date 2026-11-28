// The world map atlas (owner C; EMBERCROWN-WORLD.md 7.2 item 3, 8.3, section 10 rows "World map frame" and
// "World map memory"). Bakes a realm's fields into one pixel-art canvas, once, and draws it for the world map
// component (I, js/ui/worldmap.js): pan and zoom are a single drawImage of the baked canvas, with smoothing off.
// The art (colours, glyphs, icons, layer ramps) is D's js/engine/art/atlas.js; this file never writes state.
//
//   const at = createAtlas(realm)          bake (about 20 ms on an A15 at 64 x 64): at.canvas, at.ppr, at.size, at.ms
//   setLayer(at, id)                       'atlas' | 'elev' | 'temp' | 'rain' | 'drain' | 'ember' | 'hollow' | 'wild'
//                                          | 'peoples' | 'rock': bakes the one layer canvas (< 30 ms), returns ms
//   drawAtlas(g, at, view, opt)            view { ox, oy, scale, w, h, dpr }: the map's top-left on screen (CSS px),
//                                          CSS px per region, the viewport size (CSS px) and the device pixel ratio;
//                                          g draws in device px (identity transform). opt { clouds: 'drift' |
//                                          'static' | 'off', t (s), sites: true }. Returns the draw time in ms.
//   drawFrame(g, at, view, rx, ry, t)      the selection frame (a 2-step pulse: whole pixels, no alpha)
//   drawLoupe(g, at, view, rx, ry, cx, cy, k)   a k-times loupe of the 5 x 5 regions around (rx, ry), centred at (cx, cy) CSS px
//   regionAt(at, view, x, y) / regionRect(at, rx, ry)   picking (CSS px -> region) and a region's source rect (thumbnails)
//   atlasBytes(at) / releaseAtlas(at)      held canvas bytes (atlas + layer: 2 MB at 64 x 64); release when the screen closes
//
// Baking rules (docs/ART-STYLE.md 12): every pixel is a palette colour; the hillshade is lit from the top left
// and walks the biome's 4-step ramp with a Bayer dither between steps; region edges are ragged (a 2 px hashed
// warp) so biomes and coasts read as land, not squares; coasts get a dithered shallow band and a foam line;
// rivers are 1-3 px lines by class from region centre to the downstream centre with a hashed bend; glyphs
// are 8 x 8; civ borders are dotted tinctures; site icons are drawn per frame at a whole-pixel scale.
import { PAL, BAYER4, rgbOf } from '../art/palette.js';
import { ATLAS_BIOME, GLYPHS, TINCTURES, ATLAS_LAYERS, layerDef, siteIcon, cloudTile, CLOUD_ALPHA } from '../art/atlas.js';
import { REALM_BIOMES } from '../../data/realm/biomes.js';

const FLOW_DIR = 7, FLOW_CLS = 0x18, FLOW_LAKE = 0x20;
const DX = [0, 1, 1, 1, 0, -1, -1, -1], DY = [-1, -1, 0, 1, 1, 1, 0, -1];
const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);
/** A palette colour as a little-endian RGBA u32 (ImageData order). */
const U32 = new Map();
function u32(hex) {
  let v = U32.get(hex);
  if (v === undefined) { const [r, g, b] = rgbOf(hex); v = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; U32.set(hex, v); }
  return v;
}
const ih = (a, b, k) => { let h = (Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(k, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };
const dith = (x, y, lv) => BAYER4[((y & 3) << 2) | (x & 3)] < lv;
/** The dither level (0-16) of a fraction between two ramp steps, steep around 0.5: most pixels are solid and only
 * a narrow band is dithered, so no large area turns into a checker (docs/ART-STYLE.md 4). */
const stp = (f) => { const v = ((f - 0.5) * 3 + 0.5) * 16; return v < 0 ? 0 : v > 16 ? 16 : v | 0; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Pixels per region: 8 up to 64 x 64 (a 512 x 512 atlas), 5 at 96 x 96 (480 x 480): always under 1 MB. */
export const pprOf = (n) => (n <= 64 ? 8 : Math.floor(512 / n));

function canvasOf(w, h) {
  if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

/** Shared bake geometry: per-region hillshade and the per-column / per-row bilinear taps. */
function geometry(realm) {
  const n = realm.n, ppr = pprOf(n), W = n * ppr, f = realm.fields, e = f.elev;
  const shade = new Float32Array(n * n);
  const E = (x, y) => e[clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1)];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = E(x + 1, y) - E(x - 1, y), dy = E(x, y + 1) - E(x, y - 1);
    shade[y * n + x] = clamp((dx + dy) / 40, -1, 1);
  }
  const g0 = new Int16Array(W), g1 = new Int16Array(W), gt = new Float32Array(W);
  for (let p = 0; p < W; p++) { const fx = (p + 0.5) / ppr - 0.5, gx = Math.floor(fx); g0[p] = clamp(gx, 0, n - 1); g1[p] = clamp(gx + 1, 0, n - 1); gt[p] = fx - gx; }
  return { n, ppr, W, f, shade, g0, g1, gt, sea: realm.seaLevel };
}

/** The colour picker of a layer: (region index, x, y, lightness 0..3 from the hillshade) -> u32. */
function landColour(realm, def) {
  const f = realm.fields;
  if (def.kind === 'atlas') {
    const ramps = REALM_BIOMES.map((b) => (ATLAS_BIOME[b.id] || ATLAS_BIOME.greenvale).r.map(u32));
    return (i, x, y, lv) => { const r = ramps[f.biome[i]] || ramps[2]; let k = lv | 0; if (dith(x, y, stp(lv - k))) k++; return r[k > 3 ? 3 : k]; };
  }
  const stops = def.stops.map((s) => u32(PAL[s])), m = stops.length, a = f[def.field], ink = u32(PAL.ink);
  if (def.kind === 'cat') {
    const none = u32(PAL[def.none || def.stops[0]]);
    return (i, x, y, lv) => { const v = a[i]; const c = def.none ? (v ? stops[(v - 1) % m] : none) : stops[v % m]; return lv < 0.9 && dith(x, y, 4) ? ink : c; };
  }
  const lo = def.land ? realm.seaLevel : def.range[0], span = Math.max(1, def.range[1] - lo);
  return (i, x, y, lv) => {
    const t = clamp((a[i] - lo) / span, 0, 1) * (m - 1);
    let k = t | 0; if (dith(x, y, stp(t - k))) k++;
    return lv < 0.9 && dith(x, y, 3) ? ink : stops[k >= m ? m - 1 : k];
  };
}

/** Paint the map of one layer into a u32 pixel buffer (W x W). glyphs: draw the biome glyphs. */
function paint(realm, G, px, def, glyphs) {
  const { n, ppr, W, f, shade, g0, g1, gt, sea } = G, e = f.elev, flow = f.flow;
  const land = landColour(realm, def), kind = new Uint8Array(W * W); // 0 land, 1 sea, 2 lake
  const water = [u32(PAL.deep), u32(PAL.water), u32(PAL.shallow)], foam = u32(PAL.mist), seed = realm.seed | 0;
  for (let y = 0; y < W; y++) {
    const ya = g0[y], yb = g1[y], ty = gt[y];
    for (let x = 0; x < W; x++) {
      // the ragged warp: +-2 px, hashed per 2 x 2 px cell
      const hh = ih(x >> 1, y >> 1, seed);
      const wx = clamp(x + (hh & 3) - 1.5, 0, W - 1), wy = clamp(y + ((hh >>> 2) & 3) - 1.5, 0, W - 1);
      const i = ((wy / ppr) | 0) * n + ((wx / ppr) | 0), o = y * W + x;
      const xa = g0[x], xb = g1[x], tx = gt[x];
      // bilinear elevation (sea depth) and shade (land) between region centres
      const ia = ya * n, ib = yb * n;
      if (e[i] < sea) {
        const el = (e[ia + xa] * (1 - tx) + e[ia + xb] * tx) * (1 - ty) + (e[ib + xa] * (1 - tx) + e[ib + xb] * tx) * ty;
        kind[o] = 1;
        const lv = clamp(2.2 - (sea - el) / 14, 0, 2);
        let k = lv | 0; if (dith(x, y, stp(lv - k))) k++;
        px[o] = water[k > 2 ? 2 : k];
      } else if (flow[i] & FLOW_LAKE) {
        kind[o] = 2; px[o] = dith(x, y, 2) ? water[2] : water[1];
      } else {
        const sh = (shade[ia + xa] * (1 - tx) + shade[ia + xb] * tx) * (1 - ty) + (shade[ib + xa] * (1 - tx) + shade[ib + xb] * tx) * ty;
        px[o] = land(i, x, y, clamp(2 + sh * 1.5, 0, 3)); // flat land is solid ramp step 2 (the body colour)
      }
    }
  }
  // coasts: a foam line on water next to land, a dithered shallow pixel one further out
  for (let y = 1; y < W - 1; y++) for (let x = 1; x < W - 1; x++) {
    const o = y * W + x;
    if (!kind[o]) continue;
    const nb = (kind[o - 1] === 0) + (kind[o + 1] === 0) + (kind[o - W] === 0) + (kind[o + W] === 0);
    if (nb) { px[o] = dith(x, y, 10) ? foam : water[2]; continue; }
    if (kind[o] === 1 && (kind[o - 2 >= 0 ? o - 2 : o] === 0 || kind[o + 2] === 0 || kind[o - 2 * W] === 0 || kind[o + 2 * W] === 0) && dith(x, y, 8)) px[o] = water[2];
  }
  // glyphs (8 x 8), by the biome's density, on land regions that are not lakes
  if (glyphs) {
    const G8 = {};
    for (const k of Object.keys(GLYPHS)) { const gl = GLYPHS[k], a = new Uint32Array(64); for (let j = 0; j < 64; j++) { const ch = gl.rows[j >> 3][j & 7], c = ch && gl.c[ch]; a[j] = c ? u32(c) : 0; } G8[k] = a; }
    const step = ppr >= 8 ? 1 : 2, off = (ppr - 8) >> 1;
    for (let ry = 0; ry < n; ry++) for (let rx = 0; rx < n; rx++) {
      if (step > 1 && ((rx + ry) & 1)) continue;
      const i = ry * n + rx, b = REALM_BIOMES[f.biome[i]], art = b && ATLAS_BIOME[b.id];
      if (!art || (flow[i] & FLOW_LAKE) || (e[i] < sea && b.id !== 'sea')) continue;
      const h = ih(rx, ry, seed ^ 0x51ed);
      if ((h & 15) >= art.dens) continue;
      const gl = G8[art.glyphs[(h >>> 4) % art.glyphs.length]], x0 = rx * ppr + off, y0 = ry * ppr + off;
      for (let j = 0; j < 64; j++) {
        const c = gl[j]; if (!c) continue;
        const x = x0 + (j & 7), y = y0 + (j >> 3);
        if (x < 0 || y < 0 || x >= W || y >= W) continue;
        const o = y * W + x; if (kind[o] && b.id !== 'sea') continue;
        if (b.id === 'sea' && !kind[o]) continue;
        px[o] = c;
      }
    }
  }
  // roads (W3 fills the layer): dotted umber between region centres, east and south links
  const road = f.road, umber = u32(PAL.umber3), c0 = ppr >> 1;
  for (let i = 0; i < n * n; i++) {
    if (!road[i]) continue;
    const x0 = (i % n) * ppr + c0, y0 = ((i / n) | 0) * ppr + c0;
    if (road[i] & 2) for (let k = 0; k <= ppr; k += 2) if (x0 + k < W) px[y0 * W + x0 + k] = umber;
    if (road[i] & 4) for (let k = 0; k <= ppr; k += 2) if (y0 + k < W) px[(y0 + k) * W + x0] = umber;
  }
  // rivers: class 1-3 -> 1-3 px, centre to a hashed bend to the downstream centre
  const shallow = water[2], mid = water[1];
  const dot = (x, y, w) => {
    for (let a = 0; a < w; a++) for (let b = 0; b < w; b++) {
      const X = x + a - (w >> 1), Y = y + b - (w >> 1);
      if (X < 0 || Y < 0 || X >= W || Y >= W) continue;
      px[Y * W + X] = w === 3 && (a === 1 && b === 1) ? mid : w >= 2 && (a === 0 || b === 0) ? mid : shallow;
    }
  };
  const seg = (x0, y0, x1, y1, w) => {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let k = 0; k < 4 * W; k++) {
      dot(x0, y0, w);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  const wid = ppr >= 8 ? [0, 1, 2, 3] : [0, 1, 2, 2];
  for (let i = 0; i < n * n; i++) {
    const cls = (flow[i] & FLOW_CLS) >> 3;
    if (!cls || e[i] < sea) continue;
    const x = i % n, y = (i - x) / n, d = flow[i] & FLOW_DIR, X = x + DX[d], Y = y + DY[d];
    if (X < 0 || Y < 0 || X >= n || Y >= n) continue;
    const h = ih(x, y, seed ^ 0x2b), j = (ppr >> 2) || 1;
    const ax = x * ppr + c0, ay = y * ppr + c0, bx = X * ppr + c0, by = Y * ppr + c0;
    const mx = ((ax + bx) >> 1) + ((h & 3) - 1.5 > 0 ? j : -j) * (DY[d] !== 0 ? 1 : 0), my = ((ay + by) >> 1) + (((h >>> 2) & 3) - 1.5 > 0 ? j : -j) * (DX[d] !== 0 ? 1 : 0);
    seg(ax, ay, mx | 0, my | 0, wid[cls]); seg(mx | 0, my | 0, bx, by, wid[cls]);
  }
  // civ borders (W3): dotted tinctures just inside the owner's edge where the neighbour is someone else
  const own = f.owner;
  for (let i = 0; i < n * n; i++) {
    const o = own[i]; if (!o) continue;
    const x = i % n, y = (i - x) / n, c = u32(TINCTURES[(o - 1) % TINCTURES.length]);
    const other = (X, Y) => X < 0 || Y < 0 || X >= n || Y >= n || own[Y * n + X] !== o;
    const X0 = x * ppr, Y0 = y * ppr;
    for (let k = 0; k < ppr; k++) {
      if (!((k + x + y) & 1)) continue;
      if (other(x, y - 1)) px[Y0 * W + X0 + k] = c;
      if (other(x, y + 1)) px[(Y0 + ppr - 1) * W + X0 + k] = c;
      if (other(x - 1, y)) px[(Y0 + k) * W + X0] = c;
      if (other(x + 1, y)) px[(Y0 + k) * W + X0 + ppr - 1] = c;
    }
  }
}

function bakeCanvas(realm, G, def, glyphs) {
  const c = canvasOf(G.W, G.W), g = c.getContext('2d');
  const img = g.createImageData(G.W, G.W), px = new Uint32Array(img.data.buffer);
  paint(realm, G, px, def, glyphs);
  g.putImageData(img, 0, 0);
  return c;
}

/** Bake the atlas of a realm (fields only; history tables are read per frame for the site icons). */
export function createAtlas(realm) {
  const t0 = now(), G = geometry(realm);
  const canvas = bakeCanvas(realm, G, ATLAS_LAYERS[0], true);
  const at = { realm, n: G.n, ppr: G.ppr, size: G.W, canvas, G, layer: 'atlas', layerCanvas: null, ms: { bake: 0, layer: 0 } };
  at.ms.bake = +(now() - t0).toFixed(2);
  return at;
}

/** Switch the shown layer; bakes the one layer canvas (the previous one is released). Returns the bake ms. */
export function setLayer(at, id) {
  const def = layerDef(id);
  if (def.id === at.layer) return 0;
  if (at.layerCanvas) { at.layerCanvas.width = at.layerCanvas.height = 0; at.layerCanvas = null; }
  at.layer = def.id;
  if (def.kind === 'atlas') return 0;
  const t0 = now();
  at.layerCanvas = bakeCanvas(at.realm, at.G, def, false);
  at.ms.layer = +(now() - t0).toFixed(2);
  return at.ms.layer;
}

/** The canvas the map shows now (the atlas or the layer). */
export const shownCanvas = (at) => at.layerCanvas || at.canvas;

/**
 * Draw the map. view: { ox, oy, scale, w, h, dpr } (CSS px; scale = CSS px per region). Only the visible part
 * of the source is drawn, with smoothing off. Returns the draw time in ms (the frame budget of section 10).
 */
export function drawAtlas(g, at, view, opt = {}) {
  const t0 = now(), { ox, oy, scale, w, h } = view, d = view.dpr || 1, ppr = at.ppr, src = shownCanvas(at);
  const k = scale / ppr; // CSS px per atlas px
  g.imageSmoothingEnabled = false;
  g.fillStyle = PAL.deep; g.fillRect(0, 0, w * d, h * d);
  const sx0 = clamp(Math.floor(-ox / k), 0, at.size), sy0 = clamp(Math.floor(-oy / k), 0, at.size);
  const sx1 = clamp(Math.ceil((w - ox) / k), 0, at.size), sy1 = clamp(Math.ceil((h - oy) / k), 0, at.size);
  if (sx1 > sx0 && sy1 > sy0) {
    g.drawImage(src, sx0, sy0, sx1 - sx0, sy1 - sy0, Math.round((ox + sx0 * k) * d), Math.round((oy + sy0 * k) * d), Math.round((sx1 - sx0) * k * d), Math.round((sy1 - sy0) * k * d));
    // cloud shadows: a 64 px blob tile at 2 atlas px a cloud px and one low alpha, drifting east (the west wind)
    // by whole cloud px; 'static' under Reduce motion, 'off' under Battery saver (6.7)
    const mode = opt.clouds || 'off';
    if (mode !== 'off') {
      const tile = cloudTile(), T = 128 * k * d, drift = mode === 'drift' ? Math.floor((opt.t || 0) * 1.5) % 64 : 0;
      const x0 = (ox + sx0 * k) * d, y0 = (oy + sy0 * k) * d, x1 = (ox + sx1 * k) * d, y1 = (oy + sy1 * k) * d;
      g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip(); g.globalAlpha = CLOUD_ALPHA;
      const bx = Math.round(ox * d) + (drift - 64) * 2 * k * d, by = Math.round(oy * d);
      for (let ty = by + Math.floor((y0 - by) / T) * T; ty < y1; ty += T) for (let tx = bx + Math.floor((x0 - bx) / T) * T; tx < x1; tx += T) g.drawImage(tile, Math.round(tx), Math.round(ty), Math.round(T), Math.round(T));
      g.restore();
    }
  }
  if (opt.sites !== false) drawSites(g, at, view);
  return now() - t0;
}

/** Site icons at a whole-pixel scale: 1 icon px per CSS px (rounded to device px) at fit zoom, up to 2 zoomed in. */
function drawSites(g, at, view) {
  const sites = at.realm.tables && at.realm.tables.sites;
  if (!sites || !sites.length) return;
  const d = view.dpr || 1, s = Math.max(1, Math.min(2 * Math.round(d), Math.round(d * Math.max(1, view.scale / 12)))), civs = at.realm.tables.civs || [];
  for (const st of sites) {
    if (!st || st.x === undefined) continue;
    const cx = (view.ox + (st.x + 0.5) * view.scale) * d, cy = (view.oy + (st.y + 0.5) * view.scale) * d;
    if (cx < -40 || cy < -40 || cx > view.w * d + 40 || cy > view.h * d + 40) continue;
    const civ = st.civ !== undefined && st.civ !== null ? civs[st.civ] : null;
    const tint = st.razed ? PAL.slate2 : civ ? TINCTURES[(civ.id !== undefined ? civ.id : st.civ) % TINCTURES.length] : PAL.bone;
    const ic = siteIcon(st.razed ? 'ruin' : st.kind || 'hamlet', tint);
    g.drawImage(ic, Math.round(cx - 9 * s), Math.round(cy - 9 * s), 18 * s, 18 * s);
  }
}

/** The selection frame around region (rx, ry): bone and ink corners, a 2-step pulse (t in s). */
export function drawFrame(g, at, view, rx, ry, t = 0) {
  const d = view.dpr || 1, u = Math.max(1, Math.round(d)), pulse = Math.floor(t * 2) & 1;
  const x = Math.round((view.ox + rx * view.scale) * d) - u * (1 + pulse), y = Math.round((view.oy + ry * view.scale) * d) - u * (1 + pulse);
  const S = Math.round(view.scale * d) + 2 * u * (1 + pulse), L = Math.max(3 * u, Math.round(S / 3));
  const box = (c, o) => {
    g.fillStyle = c;
    g.fillRect(x - o, y - o, L, u); g.fillRect(x - o, y - o, u, L);
    g.fillRect(x + S - L + o, y - o, L, u); g.fillRect(x + S - u + o, y - o, u, L);
    g.fillRect(x - o, y + S - u + o, L, u); g.fillRect(x - o, y + S - L + o, u, L);
    g.fillRect(x + S - L + o, y + S - u + o, L, u); g.fillRect(x + S - u + o, y + S - L + o, u, L);
  };
  box(PAL.ink, u); box(pulse ? PAL.flame : PAL.bone, 0);
}

/** A loupe: the 5 x 5 regions around (rx, ry) at k CSS px per atlas px, centred at (cx, cy) CSS px, in a pixel frame. */
export function drawLoupe(g, at, view, rx, ry, cx, cy, k = 4) {
  const d = view.dpr || 1, ppr = at.ppr, R = 2, span = (2 * R + 1) * ppr, size = Math.round(span * k * d);
  const sx = clamp((rx - R) * ppr, 0, at.size - span), sy = clamp((ry - R) * ppr, 0, at.size - span);
  const x = Math.round(cx * d - size / 2), y = Math.round(cy * d - size / 2), u = Math.max(1, Math.round(d));
  g.imageSmoothingEnabled = false;
  g.fillStyle = PAL.ink; g.fillRect(x - 3 * u, y - 3 * u, size + 6 * u, size + 6 * u);
  g.fillStyle = PAL.stone1; g.fillRect(x - 2 * u, y - 2 * u, size + 4 * u, size + 4 * u);
  g.fillStyle = PAL.ink; g.fillRect(x - u, y - u, size + 2 * u, size + 2 * u);
  g.drawImage(shownCanvas(at), sx, sy, span, span, x, y, size, size);
  const lv = { ox: (x / d) - (sx / ppr) * ppr * k, oy: (y / d) - (sy / ppr) * ppr * k, scale: ppr * k, w: view.w, h: view.h, dpr: d };
  drawFrame(g, at, lv, rx, ry, 0);
}

/** The region under CSS point (x, y), or null. */
export function regionAt(at, view, x, y) {
  const rx = Math.floor((x - view.ox) / view.scale), ry = Math.floor((y - view.oy) / view.scale);
  return rx >= 0 && ry >= 0 && rx < at.n && ry < at.n ? { rx, ry } : null;
}
/** The source rect of region (rx, ry) in the shown canvas (for thumbnails: drawImage(shownCanvas(at), ...rect)). */
export const regionRect = (at, rx, ry) => ({ sx: rx * at.ppr, sy: ry * at.ppr, sw: at.ppr, sh: at.ppr });

/** Bytes held by the atlas canvases (the atlas, the layer canvas, and the shared cloud tile and glyph art are small). */
export function atlasBytes(at) {
  const c = (cv) => (cv ? cv.width * cv.height * 4 : 0);
  return c(at.canvas) + c(at.layerCanvas);
}
/** Release the canvases (the world map screen closed). */
export function releaseAtlas(at) {
  if (at.canvas) { at.canvas.width = at.canvas.height = 0; at.canvas = null; }
  if (at.layerCanvas) { at.layerCanvas.width = at.layerCanvas.height = 0; at.layerCanvas = null; }
  at.G = null; at.realm = null;
}

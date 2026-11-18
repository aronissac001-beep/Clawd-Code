// Render tuning (owner C; doc 12.4, 12.5). These are the Stage 0 defaults the device spike
// (tools/spike/results.json S1, S2) settled on. They belong in js/data/balance.js RENDER (owner G):
// once BAL.RENDER exists, its fields override these one by one (see renderConfig()).
// Nothing here allocates or touches the DOM at import.

export const RENDER_DEFAULTS = Object.freeze({
  // Terrain chunk bands (12.4). Ordered near -> far; `minZoom` is the band's lower zoom edge.
  // chunk = tiles per side, tscale = chunk canvas px per world unit, lru = canvases held at most.
  // Pixel style (docs/ART-STYLE.md): every band bakes at the art's native 16 px per tile (tscale 0.5)
  // and is drawn at an integer scale with smoothing off; the bands differ only in chunk size and LRU.
  // A near chunk is 128 px (64 KB) instead of 512 px (1 MB).
  bands: Object.freeze([
    Object.freeze({ name: 'near', minZoom: 0.75, chunk: 8, tscale: 0.5, lru: 36 }),
    Object.freeze({ name: 'mid', minZoom: 0.45, chunk: 16, tscale: 0.5, lru: 27 }),
    Object.freeze({ name: 'far', minZoom: 0, chunk: 16, tscale: 0.5, lru: 48 }),
  ]),
  hysteresis: 0.03,       // band edges have +-0.03 zoom hysteresis
  bakesPerFrame: 1,       // at most one full chunk bake per frame, nearest the camera first
  patchesPerFrame: 8,     // 3 x 3 tile patch redraws per frame (markDirty)
  releasePerFrame: 6,     // canvases of a released band freed per frame
  // Light texture (12.4, spike S2): px per tile and bilinear smoothing.
  lightPxPerTile: 2,
  lightSmoothing: true,
  // Pixel style: the light texture is 8 px per tile (one light px per 2 x 2 art px), posterised to 5
  // bands with dithered edges and drawn with smoothing off. These win over lightPxPerTile and
  // lightSmoothing (balance.js RENDER still holds the S2 spike values; see light.js).
  pixelLight: true,
  lightPixelPpt: 8,
  // Native px per tile of the art and the zoom steps (camera.js): at or above pixelZoomMin the zoom
  // snaps so one art pixel is a whole number of device pixels.
  artPx: 16,
  pixelZoomMin: 0.5,
  flickerFlames: 64,      // flames nearest the camera centre that flicker (12.1)
  flickerHz: 15,
  // Camera and level of detail (12.4).
  zoomMin: 0.3, zoomMax: 2.0,
  strategicZoom: 0.5,     // below: pips, raid blobs, item dots
  calmZoom: 0.35,         // below: plants stop swaying, particles stop
  pipPt: 20, pipHitPt: 44,
  // Sprite cache cap (MB; the spike rule: 40 if the device canvas ceiling is under 160 MB).
  spriteCacheMB: 48,
  dprCap: 2,             // device pixel ratio cap (12)
  // Battery (12.4): frame-rate targets for loop.js.
  fps: Object.freeze({ active: 60, idle: 30, paused: 10, saver: 30, fast: 30 }),
});

let merged = null;
/**
 * The live render config: RENDER_DEFAULTS overridden by the RENDER section of js/data/balance.js
 * (owner G). Pass the balance module namespace (or any object with RENDER, or BAL.RENDER). G's keys:
 * dprCap, chunksNear, chunksMid, chunksFar (band LRU sizes), stillFps, pausedFps, lightPxPerTile,
 * lightSmoothing (0/1); any RENDER_DEFAULTS key may also be given directly.
 */
export function renderConfig(balance) {
  if (merged && !balance) return merged;
  const R = (balance && (balance.RENDER || (balance.BAL && balance.BAL.RENDER))) || null;
  if (!R) { merged = RENDER_DEFAULTS; return merged; }
  const c = { ...RENDER_DEFAULTS };
  for (const k of Object.keys(R)) if (k in RENDER_DEFAULTS) c[k] = R[k];
  const lru = [R.chunksNear, R.chunksMid, R.chunksFar];
  if (lru.some((v) => v > 0)) c.bands = Object.freeze(c.bands.map((b, k) => (lru[k] > 0 ? Object.freeze({ ...b, lru: lru[k] }) : b)));
  if (R.stillFps > 0 || R.pausedFps > 0) c.fps = Object.freeze({ ...c.fps, idle: R.stillFps || c.fps.idle, paused: R.pausedFps || c.fps.paused });
  if (R.lightSmoothing !== undefined) c.lightSmoothing = !!R.lightSmoothing;
  if (R.dprCap > 0) c.dprCap = R.dprCap;
  merged = Object.freeze(c);
  return merged;
}
/** Override fields for this session (debug scenes and the spike): renderConfig() then returns the patched config. */
export function patchRenderConfig(patch) {
  merged = Object.freeze({ ...renderConfig(), ...patch });
  return merged;
}

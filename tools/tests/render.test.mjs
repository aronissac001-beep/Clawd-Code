// Renderer logic without a browser (owner C; doc 12.4, 14.6 row C). Canvas calls go to a no-op
// stub; what is checked is the bookkeeping: band choice and hysteresis, the frame-rate rule and the
// loop throttle (sim ticks never depend on draws), patches instead of bakes (and skipped when nothing
// baked changed), at most two adjacent bands held, and the light texture never showing light
// through a 1-tile rock wall. Pixel checks run in the browser (render-check).
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- a minimal canvas stub (no DOM in Node) ----
function fakeCtx(c) {
  const noop = () => {};
  return new Proxy({ canvas: c, imageSmoothingEnabled: true, globalAlpha: 1 }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createImageData') return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (k === 'getImageData') return (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
globalThis.document = globalThis.document || { createElement: () => { const c = { width: 300, height: 150 }; c.getContext = () => fakeCtx(c); return c; } };

const { RENDER_DEFAULTS } = await import('../../js/engine/render/config.js');
const { bandFor, TerrainLayer } = await import('../../js/engine/render/terrain.js');
const { LightLayer, DARK_ALPHA } = await import('../../js/engine/render/light.js');
const { Loop, fpsTarget } = await import('../../js/engine/loop.js');
const { lodOf } = await import('../../js/engine/render/index.js');
const { createColony, initRuntime } = await import('../../js/game/core/state.js');
const G = await import('../../js/game/core/grid.js'); // live W (a destructured copy would keep 128)
const { TER, ROOF, setBit } = G;
const { BIOMES } = await import('../../js/data/biomes.js');

const cfg = RENDER_DEFAULTS;

test('bands: near >= 0.75, mid 0.45-0.75, far below; +-0.03 hysteresis at each edge', () => {
  const B = cfg.bands, h = cfg.hysteresis;
  assert.equal(bandFor(B, 1.0, -1, h), 0);
  assert.equal(bandFor(B, 0.6, -1, h), 1);
  assert.equal(bandFor(B, 0.33, -1, h), 2);
  assert.equal(bandFor(B, 0.74, 0, h), 0, 'near holds just under its edge');
  assert.equal(bandFor(B, 0.71, 0, h), 1, 'near leaves past the hysteresis');
  assert.equal(bandFor(B, 0.77, 1, h), 1, 'mid holds just over the near edge');
  assert.equal(bandFor(B, 0.79, 1, h), 0);
  assert.equal(bandFor(B, 0.3, 0, h), 2, 'a jump crosses two bands at once');
  const l = lodOf(0.4, cfg, -1);
  assert.equal(l.bandName, 'far'); assert.equal(l.strategic, true); assert.equal(l.calm, false);
  assert.equal(lodOf(0.33, cfg, -1).calm, true);
});

test('fpsTarget: 60 moving or in combat, 30 still, 10 paused, 0 covered; saver and 5x cap at 30', () => {
  const f = cfg.fps;
  assert.equal(fpsTarget({}, f), 30);
  assert.equal(fpsTarget({ moving: true }, f), 60);
  assert.equal(fpsTarget({ combat: true }, f), 60);
  assert.equal(fpsTarget({ paused: true }, f), 10);
  assert.equal(fpsTarget({ paused: true, moving: true }, f), 60);
  assert.equal(fpsTarget({ covered: true, moving: true }, f), 0);
  assert.equal(fpsTarget({ moving: true, saver: true }, f), 30);
  assert.equal(fpsTarget({ combat: true, fast: true }, f), 30);
});

test('Loop throttle: draws per second follow the target at 60 and 120 Hz; sim ticks never depend on draws', () => {
  globalThis.requestAnimationFrame = () => 0;
  for (const hz of [60, 120]) {
    for (const [target, want] of [[60, 60], [30, 30], [10, 10], [0, 0]]) {
      let ticks = 0, draws = 0;
      const loop = new Loop({ step: 1 / 20, update: () => { ticks++; }, render: () => { draws++; }, fpsFor: () => target });
      loop.running = true; loop.last = 0; loop.poked = false;
      for (let k = 1; k <= hz * 4; k++) loop._frame((k * 1000) / hz);
      const dps = draws / 4, tps = ticks / 4;
      assert.ok(Math.abs(dps - want) <= 1, `${hz} Hz target ${target}: ${dps} draws/s`);
      assert.ok(Math.abs(tps - 20) <= 1, `${hz} Hz target ${target}: ${tps} ticks/s`);
    }
  }
  delete globalThis.requestAnimationFrame;
});

function tunnelColony() {
  const s = createColony('render-test', { w: 32, h: 24 });
  const L = s.L;
  L.terrain.fill(TER.ROCK); L.roof.fill(ROOF.MOUNTAIN); L.mat.fill(3);
  const open = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) L.terrain[y * G.W + x] = TER.ROUGH; };
  open(2, 8, 28, 8);   // lit tunnel
  open(2, 10, 28, 10); // dark tunnel under a 1-tile rock wall (row 9)
  initRuntime(s);
  for (let i = 0; i < G.W * 24; i++) { setBit(L.fog, i, 1); setBit(L.known, i, 1); }
  s.rt.light.fill(0);
  for (let x = 2; x <= 28; x++) s.rt.light[8 * G.W + x] = 3;
  return s;
}

test('light texture: a 1-tile rock wall is lit on its lit face only; light never shows through', () => {
  const s = tunnelColony();
  const L = new LightLayer(cfg);
  L.setState(s, { ppt: 2 });
  L.update(s);
  const a = (px, py) => L.img.data[((py * G.W * 2) + px) * 4 + 3];
  for (let x = 4; x < 26; x++) {
    assert.equal(a(x * 2, 8 * 2), 0, 'lit tunnel is clear');
    assert.equal(a(x * 2, 9 * 2), 0, 'the wall face toward the lit tunnel (top half) is lit');
    assert.equal(a(x * 2, 9 * 2 + 1), DARK_ALPHA[0], 'the wall face toward the dark tunnel (bottom half) is dark');
    assert.equal(a(x * 2, 10 * 2 + 1), DARK_ALPHA[0], 'the dark tunnel stays dark');
  }
  // a change: the dark tunnel gets a light; only dirty tiles are rewritten (no full rebuild)
  const full0 = L.st.full;
  s.tick++; s.rt.light[10 * G.W + 14] = 3;
  L.update(s);
  assert.equal(L.st.full, full0);
  assert.ok(L.st.tiles >= 1);
  assert.ok(a(14 * 2, 10 * 2) < DARK_ALPHA[0]);
});

test('terrain: mining queues a 3 x 3 patch (not a bake); unchanged tiles are skipped; two adjacent bands at most', () => {
  const s = tunnelColony();
  const T = new TerrainLayer(cfg);
  T.setState(s, BIOMES.greenvale);
  const g = fakeCtx({});
  const view = { x0: 0, y0: 0, x1: 32 * 32, y1: 24 * 32, z: 1 };
  for (let k = 0; k < 40; k++) T.draw(g, view, 1, 512, 384); // bake everything visible, 1 per frame
  const bakes = T.st.bakes;
  assert.ok(bakes > 0 && T.held[0].size === bakes);
  T.markDirty(5, 5);                       // nothing baked changed: skipped
  assert.equal(T.patchQ.length, 0); assert.equal(T.st.patchSkips, 1);
  s.L.terrain[9 * G.W + 5] = TER.ROUGH;      // mined (the terrain API calls markDirty)
  T.markDirty(5, 9);
  assert.equal(T.patchQ.length, 1);
  T.draw(g, view, 1, 512, 384);
  assert.equal(T.st.patches, 1); assert.equal(T.st.bakes, bakes, 'a patch, not a bake');
  // band walk near -> mid -> far: near is freed at once when the band is two steps away
  for (let k = 0; k < 4; k++) T.draw(g, view, 0.6, 512, 384);
  assert.ok(T.held[0].size > 0 && T.held[1].size > 0, 'near and mid while in mid');
  for (let k = 0; k < 4; k++) T.draw(g, view, 0.33, 512, 384);
  assert.equal(T.held[0].size, 0, 'near released in far');
  T.draw(g, view, 1.2, 512, 384);          // a jump far -> near
  assert.equal(T.held[2].size, 0, 'far is freed at once on a jump to near (never near + far)');
  assert.equal(T.st.blankRects, 0);
});

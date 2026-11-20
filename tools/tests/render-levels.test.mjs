// Stage Z1 E6 (owner C, with D for art): rendering one level of a D > 1 world without a browser (doc 4.2,
// 4.5, 6.3, 6.4). Canvas calls go to a no-op stub; the bookkeeping is checked: chunk keys carry z, level views
// slice the layers, mining at z patches the held chunks of z and z + 1, uniform chunks hold no canvas, the
// idle pre-bake fills z - 1 and z + 1 so a one-step switch has every visible chunk held, scrubbing bakes
// nothing until the 150 ms dwell, Battery saver and a paused still frame stop the pre-bake, the LRU caps, the
// band tints keep 3:1 against chevrons and lips, and a D = 1 colony draws exactly as before (no level view).
// Pixel checks and the frame counts run in the browser: node tools/render-check.mjs --fortress.
import { test } from 'node:test';
import assert from 'node:assert/strict';

function fakeCtx(c) {
  const noop = () => {};
  return new Proxy({ canvas: c, imageSmoothingEnabled: true, globalAlpha: 1 }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createImageData') return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (k === 'getImageData') return (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (k === 'createPattern') return () => ({});
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
globalThis.document = globalThis.document || { createElement: () => { const c = { width: 300, height: 150 }; c.getContext = () => fakeCtx(c); return c; } };

const G = await import('../../js/game/core/grid.js');
const { TER, idx } = G;
const { Renderer, RENDER_DEFAULTS } = await import('../../js/engine/render/index.js');
const { Camera } = await import('../../js/engine/camera.js');
const { BANDS, MARKS, luminance, bandOfLevel } = await import('../../js/engine/art/vertical.js');
const { stubFortress, digFortress } = await import('./fortress-stub.mjs');
const { initRuntime, createColony } = await import('../../js/game/core/state.js');
const { resetBus } = await import('../../js/game/core/bus.js');
const { installWorld, mineTile, setTerrain } = await import('../../js/game/world/terrain.js');

function fortress() {
  resetBus(); installWorld();
  // the stub's runtime is createColony's (initRuntime needs the 3D work index of E5): enough to draw
  return digFortress(stubFortress(7));
}
const dwell = () => new Promise((res) => setTimeout(res, 170));   // the 150 ms scrub dwell (real time)
function rig(s, vw = 390, vh = 664) {
  const canvas = document.createElement('canvas');
  const r = new Renderer(canvas, { kit: false });
  r.resize(vw, vh, 2);
  r.setState(s, { sounds: false });
  const cam = new Camera(); cam.resize(vw, vh, 2); cam.zoom = 1.25;
  cam.centerOn(64 * 32, 60 * 32, false);
  let t = 0;
  const frame = (ui = {}) => { t += 1 / 30; r.draw(s, cam, 1, 1 / 30, ui); return r.stats(); };
  return { r, cam, frame, tick: () => { s.tick++; } };
}

test('level views slice every layer; a D > 1 map draws the surface first; chunk keys carry z', () => {
  const s = fortress();
  const { r, frame } = rig(s);
  assert.equal(r.viewZ, s.zS);
  const v = r.levels.get(5);
  assert.equal(v.L.terrain.length, G.PLANE);
  assert.equal(v.L.terrain[60 * 128 + 60], s.L.terrain[idx(60, 60, 5)]);
  assert.equal(v.L.fog.length, G.PLANE / 8);
  assert.equal(v.rt.light.length, G.PLANE);
  assert.equal(v.col, s.col, 'entities inherited (filtered by the entity layer)');
  for (let k = 0; k < 40; k++) frame();
  const st = r.stats();
  assert.ok(st.level.byLevel[s.zS] > 0, 'the surface baked');
  assert.equal(st.blankRects, 0);
  for (const m of r.terrain.held) for (const [key, e] of m) assert.equal(Math.floor(key / 1048576), e.z, 'key holds z');
});

test('pre-bake: z - 1 and z + 1 fill while still, so a one-step switch has every visible chunk held', async () => {
  const s = fortress();
  const { r, cam, frame, tick } = rig(s);
  cam.setLevel(s.zS - 3); frame();
  await dwell();
  for (let k = 0; k < 120; k++) { tick(); frame(); }
  const st = r.stats();
  assert.ok(st.level.prebakes > 0, 'pre-baked');
  assert.ok(r.terrain.readyAt(s.zS - 3, r.view) && r.terrain.readyAt(s.zS - 4, r.view) && r.terrain.readyAt(s.zS - 2, r.view), 'z and z +- 1 complete');
  // the switch: the very next frame draws no placeholder rect
  const ph0 = r.terrain.st.placeholderRects;
  cam.setLevel(s.zS - 4); tick(); frame();
  assert.equal(r.terrain.st.placeholderRects, ph0, 'switch complete in one frame');
  assert.ok(st.heldMB <= 72);
});

test('without pre-bake (Battery saver) a switch is never blank: the placeholder covers, then bakes follow', async () => {
  const s = fortress();
  const { r, cam, frame, tick } = rig(s);
  r.settings.batterySaver = true;
  for (let k = 0; k < 60; k++) { tick(); frame(); }
  assert.equal(r.stats().level.prebakes, 0, 'Battery saver: no pre-bake');
  cam.setLevel(s.zS - 3); tick(); const a = frame();
  assert.ok(a.level.missing > 0, 'not complete at once');
  assert.equal(a.blankRects, 0);
  await new Promise((res) => setTimeout(res, 170));   // the 150 ms dwell before bakes
  let n = 1;
  while (r.stats().level.missing > 0 && n < 40) { tick(); frame(); n++; }
  assert.ok(n < 40, `complete after ${n} frames`);
  // paused and still: no pre-bake either
  r.settings.batterySaver = false;
  const p0 = r.stats().level.prebakes;
  for (let k = 0; k < 30; k++) frame({ paused: true });
  assert.equal(r.stats().level.prebakes, p0, 'paused and still: no pre-bake');
});

test('scrubbing faster than one level per 150 ms bakes nothing; bakes start after the dwell', async () => {
  const s = fortress();
  const { r, cam, frame, tick } = rig(s);
  r.settings.batterySaver = true;
  for (let k = 0; k < 30; k++) { tick(); frame(); }
  const b0 = r.stats().bakes;
  for (let z = s.zS - 1; z >= s.zS - 10; z--) { cam.setLevel(z); tick(); frame(); }
  const st = r.stats();
  assert.equal(st.bakes, b0, 'no bake while scrubbing');
  assert.ok(st.level.scrubFrames >= 8);
  assert.equal(st.blankRects, 0);
  await new Promise((res) => setTimeout(res, 170));
  tick(); frame();
  assert.ok(r.stats().bakes > b0, 'bakes after the 150 ms dwell');
});

test('mining at z patches the held chunks of z and z + 1 (no bake); uniform chunks hold no canvas', async () => {
  const s = fortress();
  const { r, cam, frame, tick } = rig(s);
  const z = s.zS - 6;
  cam.setLevel(z); frame();
  await dwell();
  for (let k = 0; k < 120; k++) { tick(); frame(); }
  assert.ok(r.stats().level.uniformRects > 0, 'deep unknown rock is a pattern fill');
  for (const m of r.terrain.held) for (const e of m.values()) assert.ok(e.c, 'every held entry has a canvas');
  const b0 = r.terrain.st.bakes, p0 = r.terrain.st.patches;
  // channel a voxel open in the hall at z + 1 above: here mine one at z (the hall floor's neighbour rock)
  const i = idx(70, 66, z);
  assert.equal(s.L.terrain[i], TER.ROCK);
  mineTile(s, i);
  frame();
  const keys = [...r.terrain.patchSet];
  assert.equal(keys.length, 0, 'queue drained');
  assert.ok(r.terrain.st.patches - p0 >= 2, `patched z and z + 1 (${r.terrain.st.patches - p0})`);
  assert.equal(r.terrain.st.bakes, b0, 'a patch, not a bake');
  // open air at z + 1 over the mined voxel shows it below: AIR there, patch forced
  setTerrain(s, i + G.PLANE, TER.AIR);
  frame();
  assert.equal(r.terrain.st.bakes, b0);
});

test('LRU caps on D > 1: 3 x visible chunks, at most near 48, mid 36, far 64', () => {
  const s = fortress();
  const { r, cam, frame, tick } = rig(s, 844, 335);
  for (const zoom of [1.25, 0.6, 0.33]) {
    cam.zoom = zoom;
    for (let k = 0; k < 150; k++) { tick(); frame(); }
    const t = r.terrain, b = t.band;
    assert.ok(t.held[b].size <= t.capOf(b), `${zoom}: ${t.held[b].size} <= ${t.capOf(b)}`);
    assert.ok(t.capOf(b) <= [48, 36, 64][b]);
  }
});

test('band tints: dark, distinct, and >= 3:1 against the chevrons and the lip', () => {
  const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  for (const b of BANDS) {
    assert.ok(b.name.length <= 10, b.name);
    for (const m of [MARKS.chevron, MARKS.chevron2, MARKS.lip]) assert.ok(ratio(b.tint, m) >= 3, `${b.id} vs ${m}: ${ratio(b.tint, m).toFixed(2)}`);
  }
  assert.equal(bandOfLevel(0).id, 'surface'); assert.equal(bandOfLevel(-6).id, 'cavern1'); assert.equal(bandOfLevel(-14).id, 'hollow'); assert.equal(bandOfLevel(3).id, 'heights');
  assert.equal(new Set(BANDS.map((b) => b.tint)).size, BANDS.length);
});

test('a D = 1 colony draws with no level view and the old chunk keys', () => {
  resetBus(); installWorld();
  const s = createColony('R1', { w: 64 });
  initRuntime(s);
  const { r, frame } = rig(s);
  for (let k = 0; k < 20; k++) frame();
  assert.equal(r.d3, false); assert.equal(r.stats().level, null);
  for (const m of r.terrain.held) for (const key of m.keys()) assert.ok(key < 1048576);
  assert.equal(r.levels.builds, 0);
  assert.equal(RENDER_DEFAULTS.bands[0].lru, r.terrain.capOf(0));
});

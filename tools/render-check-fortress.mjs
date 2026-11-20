// Stage Z1 E6 render check on a D = 20 world (EMBERCROWN-FORTRESS.md 6.3, 6.4, 8.3 E6 Oracle). Owner J; written
// by C, who owns what it measures. `node tools/render-check.mjs --fortress` runs this file.
//   node tools/render-check-fortress.mjs [--browser=chromium|webkit] [--vp=390x664,844x335] [--quick]
// On the game page (index.html?debug=1) the stub fortress of tools/tests/fortress-stub.mjs (128 x 128 x 20, a
// stair shaft to z 0 with a hall every third level), plus a room with an open-air hole over the hall below and a
// ramp, is drawn by the real Renderer, Camera and Loop (the sim stands in as a 20 Hz tick counter: this checks
// the renderer, not the 3D sim). At each viewport, touch emulation, DPR 2:
//   1. six one-step level switches with the idle pre-bake on: each complete within 1 frame (no placeholder rect
//      on the first frame of the new level) and its frame time;
//   2. the same six with the pre-bake off (Battery saver): never blank (no blank rect, no void pixel), frames
//      until complete;
//   3. held canvases <= 72 MB over the whole run; a 10-level scrub bakes nothing;
//   4. mining at z patches the held chunks of z and z + 1 (no bake);
//   5. still camera at 1x: 30 +- 2 draws/s; Battery saver stops the pre-bake;
//   6. bake, placeholder and switch costs (desktop), next to the S9.1 device numbers (6.0).
// Exit 0 pass, 1 fail, 2 browser unavailable. Screenshots and JSON go to tools/out/render/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve, ROOT } from './lib/static-server.mjs';
import { launch, browserArg, UNAVAILABLE } from './lib/browsers.mjs';

const OUT = join(ROOT, 'tools', 'out', 'render');
mkdirSync(OUT, { recursive: true });
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const quick = process.argv.includes('--quick');
const vps = arg('vp', '390x664,844x335').split(',').map((v) => v.split('x').map(Number));
const which = browserArg('chromium');
const browser = await launch(which);
if (!browser) { console.log(`render-check --fortress [${which}]: UNAVAILABLE - Playwright ${which} is not installed`); process.exit(UNAVAILABLE); }
const srv = await serve(0);
const checks = [];
const add = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); };
const reports = [];
const DEVICE = { switchPrebake: '1 frame, worst 3 ms', switchNoPrebake: '6-9 frames', placeholderMs: 1.95, note: 'S9.1 bench on the owner\'s iPhone, 2026-11-19 (doc 6.0)' };

for (const [vw, vh] of vps) {
  const tag = `${vw}x${vh}`;
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.goto(srv.url + '?debug=1');
  await page.waitForTimeout(300);

  const setup = await page.evaluate(async () => {
    document.body.innerHTML = '';
    document.body.style.margin = '0'; document.body.style.background = '#000';
    const G = await import('/js/game/core/grid.js');
    const { stubFortress, digFortress } = await import('/tools/tests/fortress-stub.mjs');
    const { resetBus } = await import('/js/game/core/bus.js');
    const { installWorld } = await import('/js/game/world/terrain.js');
    resetBus(); installWorld();
    const s = digFortress(stubFortress(7));
    const { TER, idx, setBit, PLANE } = G, L = s.L, zS = s.zS;
    // a room on zS - 2 with an open-air hole over the hall on zS - 3, a ramp up from the hall, colonists below
    for (let y = 55; y <= 62; y++) for (let x = 61; x <= 69; x++) { const i = idx(x, y, zS - 2); L.terrain[i] = TER.ROUGH; L.ore[i] = 0; setBit(L.known, i, 1); setBit(L.fog, i, 1); }
    for (let y = 57; y <= 59; y++) for (let x = 64; x <= 66; x++) L.terrain[idx(x, y, zS - 2)] = TER.AIR;
    L.terrain[idx(60, 60, zS - 2)] = TER.STAIR_UD;
    L.terrain[idx(68, 63, zS - 3)] = TER.RAMP; L.terrain[idx(68, 63, zS - 2)] = TER.RAMP_TOP;
    // the surface and the heights are seen; the shaft column too
    for (let z = zS; z < s.d; z++) for (let p = 0; p < PLANE; p++) setBit(L.fog, z * PLANE + p, 1);
    for (let z = 0; z < zS; z++) setBit(L.fog, idx(60, 60, z), 1);
    for (let k = 0; k < 3; k++) { s.col[k].z = zS - 3; s.col[k].x = (63 + k) * 32 + 16; s.col[k].y = 61 * 32 + 16; }
    const { Renderer, artKitReady } = await import('/js/engine/render/index.js');
    const { Camera } = await import('/js/engine/camera.js');
    const { Loop, fpsTarget } = await import('/js/engine/loop.js');
    await artKitReady();
    const cv = document.createElement('canvas');
    cv.style.cssText = `display:block;width:${innerWidth}px;height:${innerHeight}px;touch-action:none`;
    document.body.append(cv);
    const dpr = Math.min(2, devicePixelRatio || 1);
    const r = new Renderer(cv);
    r.resize(innerWidth, innerHeight, dpr);
    r.setState(s, { sounds: false });
    const cam = new Camera(); cam.resize(innerWidth, innerHeight, dpr); cam.zoom = 1.25;
    cam.centerOn(64 * 32, 60 * 32, false);
    const P = window.__fc = { s, r, cam, G, frames: 0, maxHeldMB: 0, blankPx: 0, samples: 0, sample: false, paused: false, log: null };
    // the void-pixel probe right after the terrain layer (as tools/render-check.mjs)
    const tdraw0 = r.terrain.draw.bind(r.terrain);
    r.terrain.draw = (g, view, z, cx, cy) => {
      const n = tdraw0(g, view, z, cx, cy);
      if (P.sample) {
        const img = g.getImageData(0, 0, cv.width, cv.height).data;
        for (let sy = 8; sy < r.h; sy += 24) for (let sx = 8; sx < r.w; sx += 24) {
          const wx = view.x0 + sx / view.z, wy = view.y0 + sy / view.z;
          if (wx < 4 || wy < 4 || wx > s.w * 32 - 4 || wy > s.h * 32 - 4) continue;
          const o = (Math.round(sy * dpr) * cv.width + Math.round(sx * dpr)) * 4;
          P.samples++;
          if (img[o] === 23 && img[o + 1] === 21 && img[o + 2] === 31) P.blankPx++;
        }
      }
      return n;
    };
    // per-phase time of each frame (the switch frame's breakdown)
    P.ph = {};
    for (const [o, k, name] of [[r.terrain, 'draw', 'terrain'], [r.light, 'update', 'light'], [r.light, 'draw', 'lightDraw'], [r.entities, 'draw', 'entities'], [r.weather, 'update', 'weather'], [r.overlays, 'draw', 'overlays'], [r, 'setViewLevel', 'switch'], [r.levels, 'get', 'views']]) {
      const f = o[k].bind(o);
      o[k] = (...a) => { const t = performance.now(); const v = f(...a); P.ph[name] = (P.ph[name] || 0) + performance.now() - t; return v; };
    }
    const loop = new Loop({
      step: 1 / 20, maxTicksPerFrame: 10,
      update: () => { s.tick++; },
      render: (alpha, dt) => {
        cam.update(dt);
        const t0 = performance.now();
        r.draw(s, cam, alpha, dt, { paused: P.paused });
        const ms = performance.now() - t0, st = r.stats();
        P.frames++;
        const held = st.heldMB + (st.level ? st.level.light.MB : 0);   // chunk canvases plus the held light textures
        if (held > P.maxHeldMB) P.maxHeldMB = +held.toFixed(1);
        const phase = P.ph; P.ph = {};
        if (P.log) P.log.push({ phase, ms, missing: st.level.missing, ph: r.terrain.st.placeholderRects, blank: st.blankRects, z: r.viewZ, bakes: st.bakes });
      },
      fpsFor: () => fpsTarget({ moving: cam.takeMoving(), paused: P.paused }, r.cfg.fps),
    });
    P.loop = loop;
    loop.timeScale = 1;
    loop.start();
    return { d: s.d, zS, w: s.w, kit: !!(await import('/js/engine/render/index.js')).artKit() };
  });

  const frames = (n) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const wait = (ms) => page.waitForTimeout(ms);
  // one run of six one-step switches; prebake: whether the idle pre-bake may run
  const run = (prebake) => page.evaluate(async ({ prebake, quick }) => {
    const P = window.__fc, { r, cam, s } = P, zS = s.zS;
    const raf = () => new Promise(requestAnimationFrame);
    r.settings.batterySaver = !prebake;
    const seq = [zS - 1, zS - 2, zS - 3, zS - 2, zS - 1, zS];
    const out = [];
    P.sample = true;
    for (const z of seq) {
      // stillness: let the pre-bake finish (or 2 s)
      const t0 = performance.now();
      while (performance.now() - t0 < (prebake ? 2600 : 900)) { await raf(); if (prebake && r.terrain.readyAt(z, r.view) && performance.now() - t0 > 400) break; }
      const ready = r.terrain.readyAt(z, r.view);
      P.log = [];
      cam.setLevel(z); P.loop.poke();
      const t1 = performance.now();
      while (performance.now() - t1 < 1500) { await raf(); if (P.log.length && P.log[P.log.length - 1].missing === 0 && P.log[P.log.length - 1].z === z) break; }
      const L = P.log; P.log = null;
      const first = L.find((e) => e.z === z);
      const framesToFull = L.findIndex((e) => e.z === z && e.missing === 0) + 1;
      out.push({ z, rel: z - zS, readyBefore: ready, framesToFull, firstFrameMs: first ? +first.ms.toFixed(2) : null, phases: first ? Object.fromEntries(Object.entries(first.phase).map(([k, v]) => [k, +v.toFixed(2)])) : null, maxFrameMs: +Math.max(...L.map((e) => e.ms)).toFixed(2), blank: L.length ? L[L.length - 1].blank : 0 });
      if (quick && out.length >= 3) break;
    }
    P.sample = false;
    return out;
  }, { prebake, quick });

  await wait(1200);
  await page.screenshot({ path: join(OUT, `fortress-${tag}-surface.png`) });
  const withPB = await run(true);
  await page.evaluate(() => { const P = window.__fc; P.r.terrain.rebakeAll(); });   // nothing held: the switches start cold
  const noPB = await run(false);
  // a scrub through 10 levels: no bake
  const scrub = await page.evaluate(async () => {
    const P = window.__fc, { r, cam, s } = P, raf = () => new Promise(requestAnimationFrame);
    r.settings.batterySaver = false;
    const b0 = r.terrain.st.bakes, ph0 = r.terrain.st.phBuilds;
    for (let z = s.zS - 1; z >= s.zS - 10; z--) { cam.setLevel(z); P.loop.poke(); await raf(); await raf(); }
    const b1 = r.terrain.st.bakes;
    await new Promise((res) => setTimeout(res, 400));
    return { bakes: b1 - b0, placeholderBuilds: r.terrain.st.phBuilds - ph0, bakesAfterDwell: r.terrain.st.bakes - b1, blank: r.stats().blankRects };
  });
  await page.screenshot({ path: join(OUT, `fortress-${tag}-deep.png`) });
  // mining at z patches z and z + 1
  const mine = await page.evaluate(async () => {
    const P = window.__fc, { r, cam, s, G } = P, raf = () => new Promise(requestAnimationFrame);
    const { mineTile } = await import('/js/game/world/terrain.js');
    const z = s.zS - 3;
    cam.setLevel(z); P.loop.poke();
    for (let k = 0; k < 150; k++) await raf();
    const i = G.idx(70, 62, z);
    const t = r.terrain, b0 = t.st.bakes, p0 = t.st.patches;
    mineTile(s, i, null);
    const queued = [...t.patchQ].map((q) => Math.floor((q < 0 ? -1 - q : q) / G.PLANE));
    for (let k = 0; k < 6; k++) await raf();
    return { z, rock: true, queuedLevels: [...new Set(queued)].sort((a, b) => a - b), patches: t.st.patches - p0, bakes: t.st.bakes - b0 };
  });
  await page.screenshot({ path: join(OUT, `fortress-${tag}-hall.png`) });
  await page.evaluate(() => { const P = window.__fc; P.cam.setLevel(P.s.zS - 2); P.loop.poke(); });
  await wait(900);
  await page.screenshot({ path: join(OUT, `fortress-${tag}-airhole.png`) });
  // throttle and Battery saver
  const rate = await page.evaluate(async () => {
    const P = window.__fc, { r } = P;
    r.settings.batterySaver = false;
    await new Promise((res) => setTimeout(res, 900));
    const f0 = r.frames, t0 = performance.now();
    await new Promise((res) => setTimeout(res, 3000));
    const still = (r.frames - f0) / ((performance.now() - t0) / 1000);
    // Battery saver: a level change, then 2 s still: no pre-bake
    r.settings.batterySaver = true;
    r.terrain.rebakeAll();
    P.cam.setLevel(P.s.zS - 3); P.loop.poke();
    const pb0 = r.terrain.st.prebakes;
    await new Promise((res) => setTimeout(res, 2000));
    const saverPrebakes = r.terrain.st.prebakes - pb0;
    r.settings.batterySaver = false;
    const pb1 = r.terrain.st.prebakes;
    await new Promise((res) => setTimeout(res, 2000));
    const st = r.stats();
    return { still: +still.toFixed(1), saverPrebakes, prebakesAfter: r.terrain.st.prebakes - pb1, maxHeldMB: P.maxHeldMB, blankPx: P.blankPx, samples: P.samples,
      switchMs: st.level.switchMs, lightFullMs: st.level.light.fullMs, bakeAvgMs: st.bakeAvgMs, bakeMaxMs: st.bakeMaxMs, phAvgMs: st.level.phAvgMs, phBuilds: st.level.phBuilds, uniformRects: st.level.uniformRects, light: st.level.light, byLevel: st.level.byLevel, frameMs: st.frameMs };
  });
  // the per-level minimap and its z-strip (4.5), drawn into two canvases over the corner
  const strip = await page.evaluate(async () => {
    const P = window.__fc, { r, cam, s } = P;
    cam.setLevel(s.zS - 3); P.loop.poke();
    await new Promise((res) => setTimeout(res, 400));
    const mk = (w, h, left) => { const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2; c.style.cssText = `position:fixed;top:8px;left:${left}px;width:${w}px;height:${h}px;border:1px solid #888`; document.body.append(c); return c; };
    const m = mk(120, 120, 8), z = mk(16, 120, 134);
    const a = r.drawMinimap(m, { force: true }), b = r.drawZStrip(z);
    return { minimap: a, zstrip: b, level: r.levelInfo() };
  });
  await page.screenshot({ path: join(OUT, `fortress-${tag}-minimap.png`) });
  add(`${tag}: per-level minimap and z-strip draw`, strip.minimap && strip.zstrip && strip.level.rel === -3, JSON.stringify({ minimap: strip.minimap, zstrip: strip.zstrip, rel: strip.level.rel, band: strip.level.band && strip.level.band.name }));
  await page.evaluate(() => window.__fc.loop.stop());

  const pbOk = withPB.every((e) => e.framesToFull === 1);
  add(`${tag}: one-step switch complete within 1 frame with pre-bake`, pbOk, withPB.map((e) => `${e.rel}: ${e.framesToFull}f ${e.firstFrameMs}ms`).join(', '));
  add(`${tag}: never blank without pre-bake`, noPB.every((e) => e.blank === 0 && e.framesToFull > 0) && rate.blankPx === 0, noPB.map((e) => `${e.rel}: ${e.framesToFull}f`).join(', ') + `; void px ${rate.blankPx}/${rate.samples}`);
  add(`${tag}: held canvases <= 72 MB`, rate.maxHeldMB <= 72, `max ${rate.maxHeldMB} MB (chunks + light textures ${JSON.stringify(rate.light)}); held by level ${JSON.stringify(rate.byLevel)}`);
  add(`${tag}: a 10-level scrub bakes nothing (bakes after the 150 ms dwell)`, scrub.bakes === 0 && scrub.blank === 0 && scrub.bakesAfterDwell > 0, JSON.stringify(scrub));
  add(`${tag}: mining at z patches z and z + 1, no bake`, mine.queuedLevels.includes(mine.z) && mine.queuedLevels.includes(mine.z + 1) && mine.bakes === 0 && mine.patches >= 2, JSON.stringify(mine));
  add(`${tag}: still camera 30 +- 2 draws/s`, Math.abs(rate.still - 30) <= 2, `${rate.still} draws/s`);
  add(`${tag}: Battery saver stops pre-bake`, rate.saverPrebakes === 0 && rate.prebakesAfter > 0, `saver ${rate.saverPrebakes}, after ${rate.prebakesAfter}`);
  add(`${tag}: no console errors`, errs.length === 0, errs.slice(0, 4).join(' | '));
  reports.push({ viewport: tag, setup, withPrebake: withPB, withoutPrebake: noPB, scrub, mine, rate, device: DEVICE });
  await ctx.close();
}
const ok = checks.every((c) => c.ok);
writeFileSync(join(OUT, `render-check-fortress-${which}.json`), JSON.stringify({ engine: which, reports, checks }, null, 1));
for (const r of reports) console.log(`info  ${r.viewport}: bake avg ${r.rate.bakeAvgMs} ms (max ${r.rate.bakeMaxMs}), placeholder ${r.rate.phAvgMs} ms x ${r.rate.phBuilds}, frame ${r.rate.frameMs} ms; device (6.0): switch ${DEVICE.switchPrebake} with pre-bake, ${DEVICE.switchNoPrebake} without, placeholder ${DEVICE.placeholderMs} ms`);
for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}: ${c.detail}`);
console.log(`render-check --fortress [${which}${which === 'chromium' ? ', stand-in for WebKit' : ''}]: ${ok ? 'PASS' : 'FAIL'} (${checks.filter((c) => c.ok).length}/${checks.length})`);
await browser.close(); await srv.close();
process.exit(ok ? 0 : 1);

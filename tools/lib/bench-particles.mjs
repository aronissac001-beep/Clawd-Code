// `node tools/bench.mjs --scene=particles` (EMBERCROWN-WORLD.md 12.3 W1.8; written by C, who owns what it
// measures). The pixel FX particles against the W0 engine (tools/lib/particles-w0.js):
//   1. source: no `arc(` or `fillText` in js/engine/particles.js;
//   2. the FX sheet: every frame inside the sheet, every level 0-4, every tint three palette colours;
//   3. allocations (node, a counting stub canvas): 900 live particles of every kind, update + both draw
//      passes, 2,000 frames after warm-up: 0 bytes of heap growth per frame and no GC while they run
//      (steady pool; net of the empty loop, under 4 bytes = no object), and with burst() respawns (reported);
//   4. draw time (Chromium, a real 1170 x 1992 canvas at 390 x 664 x 3, zoom 1): the same 900-particle
//      mix drawn by both engines, interleaved, 240 frames each with a pixel read-back per frame:
//      median and p95 of the new engine <= W0's.
// Returns { r, fails, warns }.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import { PerformanceObserver } from 'node:perf_hooks';
import { ROOT, serve } from './static-server.mjs';

const KINDS = ['puff', 'puff', 'puff', 'ember', 'ember', 'spark', 'chip', 'leaf', 'petal', 'flake', 'mote', 'drop', 'splash', 'ring', 'puddle', 'foot', 'text'];
const COLOURS = ['fire', 'pale', 'water', 'grass', 'ember', '#c9cbd4', '#e8762e', 'bone'];
const TEXTS = ['+12', '-3', '7', '+100', 'x2'];
// W0 drew only puff, ember, chip, spark, leaf, ring and text: the newer kinds are timed on W0 as the W0 kind
// a caller would have used for that effect (so both engines draw 900 particles)
const W0_KIND = { petal: 'leaf', flake: 'spark', mote: 'ember', drop: 'chip', splash: 'spark', puddle: 'ring', foot: 'chip' };

/** Spawn one particle of the mix into an engine (same calls for both engines; random from Math.random). */
function spawnOne(P, i, W, H, opt, map) {
  const kind0 = KINDS[i % KINDS.length], kind = (map && map[kind0]) || kind0;
  opt.vx = (Math.random() - 0.5) * 30; opt.vy = (Math.random() - 0.5) * 30; opt.vz = kind0 === 'drop' || kind0 === 'chip' ? 40 : 0;
  opt.g = kind0 === 'drop' || kind0 === 'chip' ? 120 : 0; opt.life = 1 + Math.random() * 2;
  opt.size = kind0 === 'text' ? 14 : kind0 === 'ring' ? 20 : kind0 === 'puddle' ? 12 : 2 + Math.random() * 5;
  opt.color = COLOURS[i % COLOURS.length]; opt.add = kind0 === 'ember' || kind0 === 'spark'; opt.spin = kind0 === 'leaf' || kind0 === 'petal' ? 3 : 0;
  opt.text = kind0 === 'text' ? TEXTS[i % TEXTS.length] : '';
  const p = P.spawn(kind, 20 + Math.random() * (W - 40), 20 + Math.random() * (H - 40), opt);
  p.life = Math.random() * p.max * 0.9;
  return p;
}

function stubCanvas(w, h) {
  const ctx = { calls: 0, globalAlpha: 1, fillStyle: '', imageSmoothingEnabled: false, globalCompositeOperation: 'source-over',
    fillRect() { this.calls++; }, drawImage() { this.calls++; }, beginPath() { this.calls++; }, arc() { this.calls++; }, fill() { this.calls++; },
    ellipse() { this.calls++; }, stroke() { this.calls++; }, save() {}, restore() {}, translate() {}, rotate() {}, strokeText() { this.calls++; }, fillText() { this.calls++; } };
  return { width: w, height: h, getContext: () => ctx };
}

export async function runParticles({ browserName = 'chromium', frames = 240 } = {}) {
  const fails = [], warns = [], r = {};
  // 1. source
  const src = readFileSync(join(ROOT, 'js/engine/particles.js'), 'utf8');
  const bad = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /arc\(|fillText/.test(l));
  r.sourceCalls = bad.length;
  if (bad.length) fails.push(`particles: particles.js still calls arc( or fillText on line(s) ${bad.map((b) => b[0]).join(', ')}`);

  // 2. the FX sheet
  const FX = await import('../../js/engine/art/fx.js');
  const { PAL } = await import('../../js/engine/art/palette.js');
  const lay = FX.fxLayout(), pal = new Set(Object.values(PAL)), sheetBad = [];
  lay.frames.forEach((f, i) => {
    const [sx, sy, w, h] = lay.rects.subarray(i * 6, i * 6 + 4);
    if (sx + w > lay.sw || sy + h > lay.sh || w !== f.w || h !== f.h) sheetBad.push(`${f.name} outside the sheet`);
    if (!f.px.some((v) => v)) sheetBad.push(`${f.name} empty`);
    for (const v of f.px) if (v > 4) { sheetBad.push(`${f.name} level ${v}`); break; }
  });
  for (const c of [...COLOURS, '#123456', '#ff00ff', 'nonsense', 'gold', 'teal']) {
    const t = FX.tintColours(FX.fxTint(c));
    if (!t || t.length !== 3 || t.some((x) => !pal.has(x))) sheetBad.push(`tint ${c}: ${t}`);
  }
  r.sheet = { frames: lay.frames.length, w: lay.sw, h: lay.sh, glyphs: FX.GLYPH_CHARS.length };
  if (sheetBad.length) fails.push(`particles: FX sheet: ${sheetBad.slice(0, 6).join('; ')}`);

  // 3. allocations (node)
  FX.setFxCanvasFactory(stubCanvas);
  const { Particles } = await import('../../js/engine/particles.js');
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc');
  const g = stubCanvas(1, 1).getContext('2d'); g.canvas = { width: 1170, height: 1992 };
  const view = { x0: 0, y0: 0, x1: 390, y1: 664 };
  let gcs = 0;
  const obs = new PerformanceObserver((list) => { gcs += list.getEntries().length; });
  const alloc = (respawn) => {
    const P = new Particles(), opt = {};
    for (let i = 0; i < 900; i++) spawnOne(P, i, 390, 664, opt);
    if (!respawn) for (const p of P.pool) p.max = 1e9; // steady: nothing dies
    const burstOpt = { speed: 30, life: 1.5, size: 4, color: 'fire', add: false };
    const frame = () => {
      P.update(1 / 60);
      if (respawn && P.n < 900) P.burst('puff', 200, 300, 900 - P.n, burstOpt);
      P.draw(g, false, view); P.draw(g, true, view);
    };
    const empty = () => { if (respawn && P.n < 0) P.update(0); };
    const measure = (fn, N) => {
      gc(); gc();
      const h0 = process.memoryUsage().heapUsed;
      for (let i = 0; i < N; i++) fn();
      return (process.memoryUsage().heapUsed - h0) / N;
    };
    for (let i = 0; i < 600; i++) { frame(); empty(); }
    const N = 4000, base = measure(empty, N);
    obs.observe({ entryTypes: ['gc'] }); gcs = 0;
    const calls0 = g.calls, b = measure(frame, N);
    obs.disconnect();
    // net of the empty loop's own noise (under 1 byte per iteration); one heap object is >= 12 bytes,
    // so a net under 4 bytes per frame means no allocation per frame
    const net = +(b - base).toFixed(2);
    return { frames: N, bytesPerFrame: net, harnessBytes: +base.toFixed(2), gcs, drawsPerFrame: Math.round((g.calls - calls0) / N), live: P.n };
  };
  r.alloc = alloc(false);
  r.allocRespawn = alloc(true);
  if (r.alloc.bytesPerFrame >= 4 || r.alloc.gcs > 0) fails.push(`particles: ${r.alloc.bytesPerFrame} bytes per frame allocated by update + draw (${r.alloc.gcs} GCs over ${r.alloc.frames} frames); must be 0 (under 4 net)`);
  if (r.allocRespawn.bytesPerFrame >= 4 || r.allocRespawn.gcs > 0) warns.push(`particles: ${r.allocRespawn.bytesPerFrame} bytes per frame with burst() respawns (${r.allocRespawn.gcs} GCs)`);
  FX.setFxCanvasFactory(null);

  // 4. draw time (Chromium)
  let launch = null;
  try { launch = (await import('./browsers.mjs')).launch; } catch (e) { warns.push(`particles: playwright unavailable (${e.message}); draw time not measured`); }
  const browser = launch && await launch(browserName);
  if (launch && !browser) warns.push(`particles: ${browserName} is not installed; draw time not measured`);
  if (browser) {
    const srv = await serve(0);
    try {
      const page = await (await browser.newContext({ viewport: { width: 390, height: 664 }, deviceScaleFactor: 3 })).newPage();
      const errs = []; page.on('pageerror', (e) => errs.push(e.message));
      await page.route('**/__particles-bench.html', (rt) => rt.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas id=c></canvas>' }));
      await page.goto(srv.url + '__particles-bench.html');
      const res = await page.evaluate(async ({ KINDS, COLOURS, TEXTS, W0_KIND, frames, spawnSrc }) => {
        const spawnOne = new Function(`return ${spawnSrc}`)();
        const NEW = await import('/js/engine/particles.js'), OLD = await import('/tools/lib/particles-w0.js');
        Object.assign(globalThis, { KINDS, COLOURS, TEXTS });
        const W = 390, H = 664, dpr = 3, c = document.getElementById('c');
        c.width = W * dpr; c.height = H * dpr;
        const g = c.getContext('2d', { alpha: false });
        let seed = 7; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
        const mr = Math.random;
        const make = (E, map) => { seed = 7; Math.random = rnd; const P = new E.Particles(), opt = {}; for (let i = 0; i < 900; i++) spawnOne(P, i, W, H, opt, map); Math.random = mr; return { P, opt, map, next: 900 }; };
        const engines = { w0: make(OLD, W0_KIND), w1: make(NEW, null) }, t = { w0: [], w1: [] }, view = { x0: 0, y0: 0, x1: W, y1: H };
        const step = (name) => {
          const e = engines[name], P = e.P;
          P.update(1 / 60);
          while (P.n < 900) spawnOne(P, e.next++, W, H, e.opt, e.map);
          g.setTransform(dpr, 0, 0, dpr, 0, 0); g.imageSmoothingEnabled = false;
          g.fillStyle = '#22202e'; g.fillRect(0, 0, W, H);
          g.getImageData(0, 0, 1, 1);
          const t0 = performance.now();
          P.draw(g, false, view);
          g.globalCompositeOperation = 'lighter'; P.draw(g, true, view); g.globalCompositeOperation = 'source-over';
          g.getImageData(0, 0, 1, 1);
          t[name].push(performance.now() - t0);
        };
        for (let i = 0; i < 30; i++) { step('w0'); step('w1'); }
        t.w0.length = 0; t.w1.length = 0;
        for (let i = 0; i < frames; i++) { if (i & 1) { step('w1'); step('w0'); } else { step('w0'); step('w1'); } }
        const q = (a, f) => { const b = a.slice().sort((x, y) => x - y); return +b[Math.min(b.length - 1, Math.floor(b.length * f))].toFixed(3); };
        const stats = { w0: { median: q(t.w0, 0.5), p95: q(t.w0, 0.95) }, w1: { median: q(t.w1, 0.5), p95: q(t.w1, 0.95) }, live: [engines.w0.P.n, engines.w1.P.n] };
        step('w1'); // the picture is the new engine's
        return { ...stats, shot: c.toDataURL('image/png') };
      }, { KINDS, COLOURS, TEXTS, W0_KIND, frames, spawnSrc: spawnOne.toString() });
      if (errs.length) fails.push(`particles: page errors: ${errs.join('; ')}`);
      const { shot, ...draw } = res;
      r.draw = { browser: browserName, particles: 900, frames, ...draw };
      try {
        const { mkdirSync, writeFileSync } = await import('node:fs');
        mkdirSync(join(ROOT, 'tools', 'out', 'render'), { recursive: true });
        writeFileSync(join(ROOT, 'tools', 'out', 'render', 'particles-w1.png'), Buffer.from(shot.split(',')[1], 'base64'));
      } catch (_) { /* the picture is a convenience */ }
      if (draw.w1.median > draw.w0.median || draw.w1.p95 > draw.w0.p95) fails.push(`particles: draw time median ${draw.w1.median} / p95 ${draw.w1.p95} ms > W0 ${draw.w0.median} / ${draw.w0.p95} ms at 900 particles`);
    } catch (e) {
      fails.push(`particles: browser bench failed: ${e.message}`);
    } finally { await browser.close(); await srv.close(); }
  }
  return { r, fails, warns };
}

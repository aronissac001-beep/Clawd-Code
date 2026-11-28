// W2.5 world map atlas and biome ground sets (EMBERCROWN-WORLD.md 12.4 W2.5 Test and Oracle). Owner J; written
// by C and D, who own what it measures. `node tools/render-check.mjs --scene=atlas,biomes` runs this file
// (either scene alone with --scene=atlas or --scene=biomes).
//   node tools/render-check-atlas.mjs [--browser=chromium|webkit] [--scene=atlas,biomes] [--vp=390x664@3,844x335@3]
// atlas (the world map rows of section 10, desktop gates):
//   1. bake: the atlas of each fixture world (seeds 1-3 Standard, 1 Small, 1 Large) bakes in < 30 ms (median of 3);
//   2. the 10 layers (Atlas ... Rock): each layer switch rebakes in < 30 ms;
//   3. frame: a pan and pinch sweep from fit to 8x at each viewport draws in < 1.5 ms p95 (drawAtlas time);
//   4. memory: atlas + one layer canvas <= 2 MB (the 6 MB row: atlas 1 MB, one layer 1 MB); 0 after release;
//   5. every pixel of the atlas and of every layer is a palette colour; the same seed bakes the same pixels;
//   6. borders, roads, site icons, the selection frame and the loupe draw without error (a synthetic settled world).
// biomes:
//   7. the contact sheet `?debug=1&scene=art` reports 0 errors, and the atlas art samples (every biome ground
//      set, the glyphs, the site icons, the layer ramps, the cloud tile) mount on it without error;
//   8. each of the 8 new ground sets repaints its terrains (every repainted tile differs from the default),
//      every pixel is a palette colour, and holds with no world (or a biome of today) keep the default set.
// Exit 0 pass, 1 fail, 2 browser unavailable. Screenshots and JSON go to tools/out/render/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve, ROOT } from './lib/static-server.mjs';
import { launch, browserArg, UNAVAILABLE } from './lib/browsers.mjs';

const OUT = join(ROOT, 'tools', 'out', 'render');
mkdirSync(OUT, { recursive: true });
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const scenes = new Set(arg('scene', 'atlas,biomes').split(','));
const vps = arg('vp', '390x664@3,844x335@3').split(',').map((v) => { const [wh, d] = v.split('@'); const [w, h] = wh.split('x').map(Number); return { w, h, dpr: +(d || 3) }; });
const which = browserArg('chromium');
const checks = [];
const add = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}: ${detail}`); };

const browser = await launch(which);
if (!browser) { console.log(`render-check --scene=atlas [${which}]: UNAVAILABLE - Playwright ${which} is not installed; try --browser=chromium`); process.exit(UNAVAILABLE); }
const srv = await serve(0);
const report = { engine: which, atlas: {}, biomes: {} };

async function pageAt(vp, path = 'js/engine/render/atlas.js') { // any same-origin document: the checks import modules into it
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.goto(srv.url + path);
  if (path.endsWith('.js')) await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#15131c"></body>');
  return { ctx, page, errs };
}

// ---- atlas ---------------------------------------------------------------------------------------------
if (scenes.has('atlas')) {
  const { ctx, page, errs } = await pageAt(vps[0]);
  const res = await page.evaluate(async () => {
    const A = await import('/js/engine/render/atlas.js'), Art = await import('/js/engine/art/atlas.js'), P = await import('/js/engine/art/palette.js');
    const { buildRealm } = await import('/js/game/realm/gen.js');
    const pal = new Set(Object.values(P.PAL).map((h) => { const [r, g, b] = P.rgbOf(h); return (r << 16) | (g << 8) | b; }));
    const scan = (cv) => {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let bad = 0, h = 0x811c9dc5, first = null;
      for (let o = 0; o < d.length; o += 4) {
        const v = (d[o] << 16) | (d[o + 1] << 8) | d[o + 2];
        if (d[o + 3] !== 255 || !pal.has(v)) { bad++; if (!first) first = `${(o / 4) % cv.width},${Math.floor(o / 4 / cv.width)}=${d[o]},${d[o + 1]},${d[o + 2]},${d[o + 3]}`; }
        h = Math.imul(h ^ v, 0x01000193);
      }
      return { bad, first, hash: (h >>> 0).toString(16) };
    };
    const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
    const worlds = [{ seed: 1 }, { seed: 2 }, { seed: 3 }, { seed: 4, size: 'small' }, { seed: 5, size: 'large' }];
    const out = { worlds: [], layers: {}, layerBad: [], bytes: [], released: null, same: null, cold: null };
    // the cold first bake (JIT warm-up) is reported, not gated: world creation has run the realm code just before
    { const r0 = buildRealm({ seed: 9, size: 'small' }), t = A.createAtlas(r0); out.cold = { bake: t.ms.bake, layer: A.setLayer(t, 'elev') }; A.releaseAtlas(t); }
    // timing first (no pixel reads in between: a getImageData readback disturbs the next bakes), then the scans
    const realms = worlds.map((p) => buildRealm(p));
    realms.forEach((realm, w) => {
      const p = worlds[w], times = [];
      for (let k = 0; k < 5; k++) { const at = A.createAtlas(realm); times.push(at.ms.bake); A.releaseAtlas(at); }
      const at = A.createAtlas(realm), row = { seed: p.seed, size: p.size || 'standard', n: at.n, px: at.size, bakeMs: med(times), layers: {} };
      for (const L of Art.ATLAS_LAYERS) {
        if (L.id === 'atlas') { row.layers.atlas = 0; continue; }
        const ms = []; for (let k = 0; k < 3; k++) { A.setLayer(at, 'atlas'); ms.push(A.setLayer(at, L.id)); }
        row.layers[L.id] = +med(ms).toFixed(2);
        out.layers[L.id] = Math.max(out.layers[L.id] || 0, row.layers[L.id]);
      }
      A.releaseAtlas(at);
      out.worlds.push(row);
    });
    realms.forEach((realm, w) => {
      const p = worlds[w], row = out.worlds[w], at = A.createAtlas(realm), sc = scan(at.canvas);
      Object.assign(row, { bad: sc.bad, first: sc.first, hash: sc.hash });
      for (const L of Art.ATLAS_LAYERS) {
        if (L.id === 'atlas') continue;
        A.setLayer(at, L.id);
        const s2 = scan(at.layerCanvas); if (s2.bad) out.layerBad.push(`${p.seed}/${L.id}: ${s2.bad} (${s2.first})`);
      }
      out.bytes.push(A.atlasBytes(at));
      if (p.seed === 1) { const b = A.createAtlas(realm); out.same = scan(b.canvas).hash === sc.hash; A.releaseAtlas(b); }
      A.releaseAtlas(at); out.released = Math.max(out.released || 0, A.atlasBytes(at));
    });
    out.layers.atlas = 0;
    return out;
  });
  report.atlas.bake = res;
  const worst = Math.max(...res.worlds.map((w) => w.bakeMs));
  add('atlas bake < 30 ms (seeds 1-3 Standard, Small, Large; median of 5)', worst < 30, res.worlds.map((w) => `${w.size} ${w.seed}: ${w.bakeMs} ms (${w.px} px)`).join('; ') + `; cold first bake (Small, info) ${res.cold.bake} ms, layer ${res.cold.layer} ms`);
  for (const [id, ms] of Object.entries(res.layers)) add(`layer ${id}: switch rebake < 30 ms`, ms < 30, `${ms} ms (worst world)`);
  add('every atlas and layer pixel is a palette colour', res.worlds.every((w) => w.bad === 0) && res.layerBad.length === 0, `atlas bad ${res.worlds.map((w) => w.bad).join('/')}${res.worlds.find((w) => w.first) ? ' first ' + res.worlds.find((w) => w.first).first : ''}; layers ${res.layerBad.slice(0, 3).join('; ') || 'none'}`);
  add('same seed bakes the same atlas', res.same === true, `seed 1 hash ${res.worlds[0].hash}`);
  const mb = Math.max(...res.bytes) / 1048576;
  add('memory: atlas + one layer <= 2 MB; 0 after release', mb <= 2 && res.released === 0, `${mb.toFixed(2)} MB held at most; ${res.released} B after release`);
  await ctx.close();

  // frame time and screenshots at each viewport
  for (const vp of vps) {
    const { ctx: c2, page: pg, errs: e2 } = await pageAt(vp);
    const fr = await pg.evaluate(async (vp) => {
      const A = await import('/js/engine/render/atlas.js');
      const { buildRealm } = await import('/js/game/realm/gen.js');
      document.body.style.margin = '0'; document.body.style.background = '#15131c';
      const cv = document.createElement('canvas'); cv.width = vp.w * vp.dpr; cv.height = vp.h * vp.dpr; cv.style.width = vp.w + 'px'; cv.style.height = vp.h + 'px'; cv.style.display = 'block';
      document.body.replaceChildren(cv);
      const g = cv.getContext('2d');
      const realm = buildRealm({ seed: 3 }), at = A.createAtlas(realm);
      const fit = Math.min(vp.w, vp.h) / at.n; // CSS px per region at fit
      const frame = () => new Promise(requestAnimationFrame);
      const times = [];
      // pinch from fit to 8x around the centre, pan across at 4x and 8x, back to fit; clouds drifting
      const steps = [];
      for (let k = 0; k <= 60; k++) steps.push({ z: fit * (1 + 7 * k / 60), cx: 0.5, cy: 0.5 });
      for (let k = 0; k <= 90; k++) steps.push({ z: fit * 8, cx: 0.1 + 0.8 * k / 90, cy: 0.3 + 0.4 * k / 90 });
      for (let k = 0; k <= 60; k++) steps.push({ z: fit * 4, cx: 0.9 - 0.8 * k / 60, cy: 0.7 });
      for (let k = 0; k <= 30; k++) steps.push({ z: fit * (4 - 3 * k / 30), cx: 0.5, cy: 0.5 });
      let n = 0;
      for (const st of steps) {
        const scale = st.z, mw = at.n * scale;
        const view = { ox: vp.w / 2 - st.cx * mw, oy: vp.h / 2 - st.cy * mw, scale, w: vp.w, h: vp.h, dpr: vp.dpr };
        if (n === 100) A.setLayer(at, 'temp'); if (n === 160) A.setLayer(at, 'atlas');
        times.push(A.drawAtlas(g, at, view, { clouds: 'drift', t: n / 30 }));
        A.drawFrame(g, at, view, 31, 20, n / 30);
        n++; await frame();
      }
      times.sort((a, b) => a - b);
      const p95 = times[Math.floor(times.length * 0.95)], max = times[times.length - 1];
      // the screenshots: fit with the frame, then 8x, then a synthetic settled world with a loupe
      const shots = {};
      const fitView = { ox: (vp.w - at.n * fit) / 2, oy: (vp.h - at.n * fit) / 2, scale: fit, w: vp.w, h: vp.h, dpr: vp.dpr };
      A.drawAtlas(g, at, fitView, { clouds: 'static' }); A.drawFrame(g, at, fitView, 31, 20, 0);
      window.__shot = 'fit';
      return { p95: +p95.toFixed(3), max: +max.toFixed(3), frames: times.length, fit: +fit.toFixed(2), bake: at.ms.bake };
    }, vp);
    const tag = `${vp.w}x${vp.h}@${vp.dpr}`;
    await pg.screenshot({ path: join(OUT, `atlas-fit-${tag}.png`) });
    await pg.evaluate(async (vp) => {
      const A = await import('/js/engine/render/atlas.js');
      const { buildRealm } = await import('/js/game/realm/gen.js');
      const cv = document.querySelector('canvas'), g = cv.getContext('2d');
      const realm = buildRealm({ seed: 3 }), at = A.createAtlas(realm), scale = Math.min(vp.w, vp.h) / at.n * 8;
      const view = { ox: vp.w / 2 - 31.5 * scale, oy: vp.h / 2 - 20.5 * scale, scale, w: vp.w, h: vp.h, dpr: vp.dpr };
      A.drawAtlas(g, at, view, { clouds: 'static' }); A.drawFrame(g, at, view, 31, 20, 0);
    }, vp);
    await pg.screenshot({ path: join(OUT, `atlas-8x-${tag}.png`) });
    const syn = await pg.evaluate(async (vp) => {
      const A = await import('/js/engine/render/atlas.js');
      const { buildRealm } = await import('/js/game/realm/gen.js');
      const cv = document.querySelector('canvas'), g = cv.getContext('2d');
      const realm = buildRealm({ seed: 2 }), n = realm.n, f = realm.fields;
      // a synthetic settled world: three civs owning discs of land, roads between their towns, sites of every kind
      const kinds = ['camp', 'hamlet', 'village', 'town', 'city', 'hold', 'tower', 'ruin', 'lair', 'pin'];
      realm.tables.civs = [{ id: 0 }, { id: 1 }, { id: 2 }];
      const land = []; for (let i = 0; i < n * n; i++) if (f.elev[i] >= realm.seaLevel) land.push(i);
      const sites = [];
      for (let k = 0; k < 10; k++) { const i = land[Math.floor((k + 0.5) * land.length / 10)]; sites.push({ x: i % n, y: Math.floor(i / n), kind: kinds[k], civ: k % 3, razed: k === 7 }); }
      for (let i = 0; i < n * n; i++) {
        if (f.elev[i] < realm.seaLevel) continue;
        const x = i % n, y = Math.floor(i / n);
        for (let c = 0; c < 3; c++) { const s = sites[c * 3]; if ((x - s.x) ** 2 + (y - s.y) ** 2 < 49) { f.owner[i] = c + 1; break; } }
      }
      for (const s of sites.slice(0, 6)) { for (let x = s.x; x < Math.min(n - 1, s.x + 4); x++) f.road[s.y * n + x] |= 2; for (let y = s.y; y < Math.min(n - 1, s.y + 3); y++) f.road[y * n + s.x + 4] |= 4; }
      realm.tables.sites = sites;
      const at = A.createAtlas(realm), fit = Math.min(vp.w, vp.h) / n, scale = fit * 2, s0 = sites[3];
      const view = { ox: vp.w / 2 - (s0.x + 0.5) * scale, oy: vp.h / 2 - (s0.y + 0.5) * scale, scale, w: vp.w, h: vp.h, dpr: vp.dpr };
      A.setLayer(at, 'peoples'); A.setLayer(at, 'atlas');
      A.drawAtlas(g, at, view, { clouds: 'off' });
      A.drawLoupe(g, at, view, s0.x, s0.y, vp.w * 0.22, vp.h * 0.25, 3);
      const hit = A.regionAt(at, view, vp.w / 2, vp.h / 2);
      return { hit, want: { rx: s0.x, ry: s0.y }, bytes: A.atlasBytes(at) };
    }, vp);
    await pg.screenshot({ path: join(OUT, `atlas-settled-${tag}.png`) });
    report.atlas[tag] = { ...fr, syn };
    add(`frame p95 < 1.5 ms at ${tag} (fit ${fr.fit} px/region to 8x, ${fr.frames} frames)`, fr.p95 < 1.5, `p95 ${fr.p95} ms, max ${fr.max} ms`);
    add(`borders, roads, sites, frame and loupe draw at ${tag}; picking is exact`, e2.length === 0 && syn.hit && syn.hit.rx === syn.want.rx && syn.hit.ry === syn.want.ry, `${e2.slice(0, 2).join(' | ') || 'no errors'}; hit ${JSON.stringify(syn.hit)} want ${JSON.stringify(syn.want)}`);
    await c2.close();
  }
  add('no console errors (atlas)', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');
}

// ---- biomes --------------------------------------------------------------------------------------------
if (scenes.has('biomes')) {
  for (const vp of vps) {
    const { ctx, page, errs } = await pageAt(vp, '?debug=1&scene=art');
    await page.waitForFunction(() => window.__ecArt && window.__ecArt.ready, null, { timeout: 30000 }).catch(() => {});
    const res = await page.evaluate(async () => {
      const r = window.__ecArt || {};
      const art = { ready: !!r.ready, errors: (r.errors || ['no report']).slice(0, 5), drawn: r.drawn, keys: r.keys };
      const Art = await import('/js/engine/art/atlas.js'), Gd = await import('/js/engine/art/ground.js'), P = await import('/js/engine/art/palette.js');
      const pal = new Set(Object.values(P.PAL).map((h) => { const [a, b, c] = P.rgbOf(h); return (a << 16) | (b << 8) | c; }));
      // mount the atlas art samples on the sheet (the section D adds to sheet.js; mounted here if absent)
      let mounted = 0, mountErr = null, onSheet = !!document.querySelector('[data-atlas-art]');
      if (!onSheet) {
        try {
          const sec = document.createElement('section'); sec.dataset.atlasArt = '1'; sec.style.cssText = 'background:#22202e;color:#f1ead8;font:14px sans-serif;padding:8px';
          const h = document.createElement('h2'); h.textContent = 'World map art and biome ground sets (atlas.js, ground.js)'; sec.appendChild(h);
          const s = Art.atlasArtSamples(document); s.figures.forEach((f) => sec.appendChild(f)); mounted = s.figures.length;
          document.body.prepend(sec); document.body.style.display = 'block'; window.scrollTo(0, 0);
        } catch (e) { mountErr = String(e && e.message); }
      }
      // every ground set: palette only, repainted tiles differ from the default tiles
      const tile = (set, t, v) => {
        const fake = { L: { terrain: new Uint8Array(4096 * 4) }, realm: set === 'default' ? null : { embark: { biome: set } } };
        fake.L.terrain.fill(t);
        const c2 = document.createElement('canvas'); c2.width = 16; c2.height = 16; const g2 = c2.getContext('2d'); g2.scale(0.5, 0.5); g2.translate(-32 * (1 + v), -32);
        Gd.paintSurfaceTile(g2, fake, 1 + v, 1, false);
        return g2.getImageData(0, 0, 16, 16).data;
      };
      const sets = {}, badPal = [];
      for (const set of Gd.GROUND_SET_IDS) {
        const ts = set === 'default' ? [1, 2, 3, 4, 5, 6, 12] : Gd.groundSetTerrains(set);
        let differ = 0;
        for (const t of ts) for (let v = 0; v < 4; v++) {
          const a = tile(set, t, v), b = tile('default', t, v);
          let same = true;
          for (let o = 0; o < a.length; o += 4) { if (a[o] !== b[o] || a[o + 1] !== b[o + 1] || a[o + 2] !== b[o + 2]) same = false; if (a[o + 3] && !pal.has((a[o] << 16) | (a[o + 1] << 8) | a[o + 2])) badPal.push(`${set}/${t}`); }
          if (!same) differ++;
        }
        sets[set] = { terrains: ts.length, differ, tiles: ts.length * 4 };
      }
      const legacy = [Gd.groundSetOf({}), Gd.groundSetOf({ realm: null }), Gd.groundSetOf({ realm: { embark: { biome: 'greenvale' } } }), Gd.groundSetOf({ realm: { embark: { biome: 'ashlands' } } })];
      const byIndex = Gd.groundSetOf({ realm: { embark: { biome: 6 } } });
      return { art, mounted, mountErr, onSheet, sets, badPal: [...new Set(badPal)].slice(0, 6), legacy, byIndex };
    });
    const tag = `${vp.w}x${vp.h}@${vp.dpr}`;
    // the screenshot: the samples alone on a plain page (the sheet's own layout covers the body)
    await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:8px;background:#22202e;color:#f1ead8;font:14px sans-serif"></body>');
    await page.evaluate(async () => { const Art = await import('/js/engine/art/atlas.js'); for (const f of Art.atlasArtSamples(document).figures) { f.style.margin = '0 0 8px'; document.body.appendChild(f); } });
    await page.screenshot({ path: join(OUT, `biomes-sheet-${tag}.png`), fullPage: true });
    report.biomes[tag] = res;
    add(`contact sheet at ${tag}: 0 errors`, res.art.ready && res.art.errors.length === 0, `${res.art.drawn}/${res.art.keys} keys drawn; errors ${res.art.errors.join('; ') || 'none'}`);
    add(`atlas art samples on the sheet at ${tag}`, !res.mountErr && (res.onSheet || res.mounted >= 9 + 3), res.onSheet ? 'in sheet.js' : `mounted ${res.mounted} figures (sheet.js section pending)${res.mountErr ? ' error ' + res.mountErr : ''}`);
    const newSets = Object.entries(res.sets).filter(([k]) => k !== 'default');
    add(`8 new ground sets repaint their terrains at ${tag}`, newSets.length === 8 && newSets.every(([, s]) => s.terrains >= 3 && s.differ === s.tiles), newSets.map(([k, s]) => `${k} ${s.differ}/${s.tiles}`).join(', '));
    add(`ground set pixels are palette colours at ${tag}`, res.badPal.length === 0, res.badPal.join(', ') || 'all');
    add(`holds with no world or a biome of today keep the default set at ${tag}`, res.legacy.every((x) => x === 'default') && res.byIndex === 'fen', `${res.legacy.join(', ')}; biome index 6 -> ${res.byIndex}`);
    add(`no console errors (biomes ${tag})`, errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');
    await ctx.close();
  }
}

const ok = checks.every((c) => c.ok);
report.checks = checks;
writeFileSync(join(OUT, `render-check-atlas-${which}.json`), JSON.stringify(report, null, 1));
console.log(`render-check --scene=${[...scenes].join(',')} [${which}${which === 'chromium' ? ', stand-in for WebKit' : ''}]: ${ok ? 'PASS' : 'FAIL'} (${checks.filter((c) => c.ok).length}/${checks.length})`);
await browser.close(); await srv.close();
process.exit(ok ? 0 : 1);

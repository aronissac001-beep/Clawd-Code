// Device spike harness (doc 14.5, S1-S6). On a real iPhone the same pages run in Safari and as a
// Home Screen app (serve the repo, open tools/spike/pages/*.html). Here they run emulated in
// Playwright at the gate viewports, and the results go to tools/spike/results.json.
//   node tools/spike/run.mjs [--browser=webkit|chromium] [S1 S2 ...]
//   node tools/spike/run.mjs --page=z [--browser=chromium] [--probe=MB] [--strict]
//     The fortress depth bench (EMBERCROWN-FORTRESS.md 8.2 S9.1): opens spike/z.html at 390 x 664 (DPR 2, touch),
//     also through a /embercrown/ prefix (the deployed path), taps Run and Copy report, checks the page's
//     layout budgets, prints the report beside PROTO's Chromium numbers (the oracle: within +-30%) and writes
//     tools/out/spike/z-report.json plus screenshots. --runs=N (default 3) repeats the timed sections and
//     judges each row's median; --strict exits 1 when a median is outside +-30%.
// WebKit is preferred (JavaScriptCore, the iPhone engine); without it the harness uses Chromium
// with iPhone emulation and says so in the results.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serve } from '../lib/static-server.mjs';
import { launch, installed, browserArg } from '../lib/browsers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'out', 'spike');
mkdirSync(OUT, { recursive: true });
const want = process.argv.slice(2).filter((a) => /^S\d$/.test(a));
const run = (id) => !want.length || want.includes(id);

export const GATE_VIEWPORTS = [
  { name: 'p375x635-safari', width: 375, height: 635 }, { name: 'p390x664-safari', width: 390, height: 664 },
  { name: 'p430x740-safari', width: 430, height: 740 }, { name: 'p390x763-app', width: 390, height: 763 },
  { name: 'l844x335-safari', width: 844, height: 335 }, { name: 'l932x380-safari', width: 932, height: 380 },
];
let name = browserArg(installed('webkit') ? 'webkit' : 'chromium');
const browser = await launch(name);
if (!browser) { console.error(`spike: ${name} is not installed`); process.exit(2); }
const srv = await serve(0);
const ctxOpts = (vp) => ({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, isMobile: name !== 'webkit' ? true : undefined, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
const errors = [];
async function page(vp, path, waitFor = 'window.RESULT', timeout = 120000) {
  const ctx = await browser.newContext(ctxOpts(vp));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${path}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${path}: ${m.text()}`); });
  await p.goto(srv.url + 'tools/spike/pages/' + path);
  await p.waitForFunction(waitFor, null, { timeout });
  return { ctx, p };
}
const results = {
  generated: 'tools/spike/run.mjs', engine: name, emulated: true,
  note: name === 'webkit' ? 'Playwright WebKit (JavaScriptCore) on Linux with iPhone viewports; not an iPhone.'
    : 'Playwright WebKit was NOT installed here (download host blocked), so these ran in Chromium (V8/Blink) with iPhone viewports and touch. Engine-specific numbers (canvas memory, IndexedDB, eviction, persist) must be re-measured on a real iPhone 13.',
  viewports: GATE_VIEWPORTS,
};
const VP = GATE_VIEWPORTS[1];

// ---- --page=z: the fortress depth bench (spike/z.html) ---------------------------------------------------
const PAGE = (process.argv.find((a) => a.startsWith('--page=')) || '').slice(7);
if (PAGE && PAGE !== 'z') { console.error(`spike: unknown --page=${PAGE} (z)`); process.exit(2); }
if (PAGE === 'z') {
  const probe = +((process.argv.find((a) => a.startsWith('--probe=')) || '').slice(8) || 512);
  const strict = process.argv.includes('--strict');
  const runs = Math.max(1, +((process.argv.find((a) => a.startsWith('--runs=')) || '').slice(7) || 3));
  const ctx = await browser.newContext(ctxOpts(VP));
  if (name === 'chromium') await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: srv.url.replace(/\/$/, '') });
  // the deployed site serves the repo root at /embercrown/: map that prefix onto the root, so the page is
  // loaded exactly as it is there (every path in spike/z.html and z.mjs must be relative)
  await ctx.route(/\/embercrown\//, async (route) => { const resp = await route.fetch({ url: route.request().url().replace('/embercrown/', '/') }); await route.fulfill({ response: resp }); });
  const p = await ctx.newPage();
  const zerr = [];
  const failed = [];
  p.on('pageerror', (e) => zerr.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') zerr.push(m.text()); });
  p.on('requestfailed', (r) => failed.push(r.url()));
  p.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  // 1. reachable at both paths
  const reach = {};
  for (const path of ['spike/z.html', 'embercrown/spike/z.html']) {
    await p.goto(srv.url + path);
    reach[path] = await p.waitForFunction('window.READY === true', null, { timeout: 30000 }).then(() => true, () => false);
  }
  await p.evaluate(() => { try { localStorage.removeItem('ec-spike-z'); } catch (_) { /* none */ } });
  await p.goto(srv.url + `embercrown/spike/z.html?probeMax=${probe}`);
  await p.waitForFunction('window.READY === true', null, { timeout: 30000 });
  await p.screenshot({ path: join(OUT, 'z-ready.png') });
  // 2. layout budgets at 390 x 664: no sideways scroll, text >= 14 px, controls >= 44 pt
  const layout = await p.evaluate(() => {
    const small = [], tiny = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!el.offsetParent && el.tagName !== 'BODY') continue;
      const txt = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (txt && parseFloat(getComputedStyle(el).fontSize) < 14) small.push(el.tagName + ':' + getComputedStyle(el).fontSize);
      if (el.matches('button, label, input:not(label input)')) { const r = el.getBoundingClientRect(); if (r.height < 44) tiny.push(`${el.tagName}#${el.id}:${Math.round(r.width)}x${Math.round(r.height)}`); }
    }
    return { scrollWidth: document.scrollingElement.scrollWidth, innerWidth, smallText: small, smallTargets: tiny };
  });
  // 3. run it by touch, screenshot the level switches while they draw
  const t0 = Date.now();
  await p.tap('#run');
  const renderShot = p.waitForFunction(() => document.getElementById('stage').classList.contains('on'), null, { timeout: 300000 })
    .then(() => p.waitForTimeout(1500)).then(() => p.screenshot({ path: join(OUT, 'z-render.png') })).catch(() => null);
  await p.waitForFunction('window.RESULT', null, { timeout: 900000 });
  await renderShot;
  const rep = await p.evaluate(() => window.RESULT);
  await p.tap('#copy');
  await p.waitForFunction('window.COPIED !== undefined', null, { timeout: 10000 }).catch(() => null);
  const copied = await p.evaluate(() => window.COPIED || 0);
  let clip = null;
  if (name === 'chromium') clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  const copyOk = copied > 0 && (clip === null || clip === JSON.stringify(rep));
  await p.screenshot({ path: join(OUT, 'z-done.png'), fullPage: true });
  // 3b. timings on a shared machine scatter by +-50% from run to run: repeat the timed sections (no canvas
  //     probe) and judge the per-row median over the runs; the counts (expansions, switch frames, hashes) must
  //     be identical in every run
  const extra = [];
  for (let k = 1; k < runs; k++) {
    await p.evaluate(() => { try { localStorage.removeItem('ec-spike-z'); } catch (_) { /* none */ } });
    await p.goto(srv.url + 'embercrown/spike/z.html?auto=1&probeMax=0');
    await p.waitForFunction('window.RESULT', null, { timeout: 900000 });
    extra.push(await p.evaluate(() => window.RESULT));
  }
  await ctx.close();
  await browser.close(); await srv.close();
  const all = [rep, ...extra];
  const med = (a) => { const b = a.filter((x) => typeof x === 'number').sort((x, y) => x - y); return b.length ? b[(b.length - 1) >> 1] : null; };
  const stable = all.every((r) => r.world && r.world.worldHash === rep.world.worldHash && r.path && r.path.link.expMax === rep.path.link.expMax && r.path.link.expP95 === rep.path.link.expP95
    && JSON.stringify(Object.values(r.render || {}).map((v) => [v.noPrebake_z1_25.switchFramesToFull, v.prebake_z1_25.switchFramesToFull])) === JSON.stringify(Object.values(rep.render || {}).map((v) => [v.noPrebake_z1_25.switchFramesToFull, v.prebake_z1_25.switchFramesToFull])));
  const medRows = (rep.compare || []).map((c) => {
    const ms = all.map((r) => ((r.compare || []).find((x) => x.metric === c.metric) || {}).measured);
    const m = med(ms);
    return { ...c, runs: ms, measured: m, vsProto: c.proto ? +(m / c.proto).toFixed(2) : null, vsA15: c.a15 ? +(m / c.a15).toFixed(2) : null };
  });
  // 4. the same world in Node: mapgen must give the same hash in both engines (a first look at E10's
  //    Node/WebKit equality; Chromium here when WebKit is missing), and Node's own mapgen time
  const Z = await import(new URL('../../spike/z.mjs', import.meta.url).href);
  const nodeMs = [];
  let nw = null;
  for (let k = 0; k < 4; k++) { const a = performance.now(); nw = Z.generate(128, 128, 20, 99); nodeMs.push(performance.now() - a); }
  const nodePristine = Z.fnv(nw.ter, nw.mat, nw.ore); Z.digFortress(nw, 99);
  const node = { pristineHash: nodePristine, worldHash: Z.fnv(nw.ter, nw.mat, nw.ore), mapgenMs: +nodeMs.slice(1).sort((a, b) => a - b)[1].toFixed(2) };
  const sameWorld = !!rep.world && rep.world.worldHash === node.worldHash && rep.world.pristineHash === node.pristineHash;
  // 5. the report beside the oracle: PROTO's Chromium rows within +-30% (or within two clock ticks, as
  //    PROTO's own figures are rounded to Chromium's 0.1 ms clock); rows whose PROTO figure is from Node are shown, not judged
  const tol = 2 * ((rep.env && rep.env.timerResMs) || 0.1);
  const within = (c) => (c.protoIsNode ? null : c.budget ? c.measured <= c.a15 : c.exact ? c.measured === c.proto : Math.abs(c.vsProto - 1) <= 0.3 || (c.unit === 'ms' && Math.abs(c.measured - c.proto) <= tol));
  const rows = medRows.filter((c) => c.proto !== undefined && c.proto !== null);
  const out = { generated: 'tools/spike/run.mjs --page=z', engine: name, emulated: true, wallS: Math.round((Date.now() - t0) / 1000), reach, layout, copyOk, copiedChars: copied,
    runs, stableAcrossRuns: stable, extraRuns: extra.map((r) => r.compare), node, sameWorld, oracle: rows.map((c) => ({ ...c, within30: within(c) })), report: rep, pageErrors: zerr, failedRequests: failed,
    note: name === 'webkit' ? 'Playwright WebKit on Linux, iPhone viewport; not an iPhone.' : 'Chromium stand-in (Playwright WebKit could not be installed: its download host is blocked here). The owner runs spike/z.html on the iPhone for the real numbers.' };
  writeFileSync(join(OUT, 'z-report.json'), JSON.stringify(out, null, 1) + '\n');
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`depth bench (spike/z.html) in ${name}${name === 'webkit' ? '' : ' (stand-in for WebKit)'}, ${out.wallS} s; world ${rep.world && rep.world.worldHash}, timer ${rep.env && rep.env.timerResMs} ms`);
  console.log(`${runs} run(s); the oracle uses each row's median; counts identical in every run: ${stable ? 'yes' : 'NO'}`);
  console.log(pad('metric', 20) + pad('unit', 7) + pad('median', 10) + pad('PROTO', 9) + pad('ratio', 7) + 'within 30%');
  for (const c of out.oracle) console.log(pad(c.metric, 20) + pad(c.unit, 7) + pad(c.measured, 10) + pad(c.proto, 9) + pad(c.exact ? '=' : c.vsProto, 7) + (within(c) === null ? 'n/a' : within(c) ? (c.budget ? `yes (<= ${c.a15})` : 'yes') : 'NO') + (c.protoFrom && !c.protoFrom.startsWith('PROTO Chromium') ? `  (${c.protoFrom})` : ''));
  if (rep.render) for (const [vp, r] of Object.entries(rep.render)) console.log(`render ${vp}: switch frames no pre-bake ${r.noPrebake_z1_25.switchFramesToFull.join(',')}; pre-bake ${r.prebake_z1_25.switchFramesToFull.join(',')} (z 0.6: ${r.prebake_z0_6.switchFramesToFull.join(',')}); switch max ${r.prebake_z1_25.switchMaxMs} ms; frame p95 ${r.prebake_z1_25.frameP95Ms} ms; canvases ${r.prebake_z0_6.canvasMB} MB`);
  if (rep.inflate) console.log(`inflate: ${rep.inflate.rawKB} KB raw, ${rep.inflate.deflatedKB} KB deflated, inflate median ${rep.inflate.inflateMedianMs} ms, round trip ${rep.inflate.roundTrip}`);
  if (rep.canvasCeiling) console.log(`canvas ceiling: ${rep.canvasCeiling.reachedMB} MB of ${rep.canvasCeiling.maxMB} (${rep.canvasCeiling.stoppedBecause})`);
  console.log(`mapgen in Node: ${node.mapgenMs} ms; world hash Node ${node.worldHash} vs ${name} ${rep.world && rep.world.worldHash}: ${sameWorld ? 'equal' : 'DIFFERENT'}`);
  console.log(`reachable: ${Object.entries(reach).map(([k, v]) => `/${k} ${v ? 'yes' : 'NO'}`).join(', ')}; copy report: ${copyOk ? 'yes' : 'NO'} (${copied} chars); layout: scrollWidth ${layout.scrollWidth}/${layout.innerWidth}, small text ${layout.smallText.length}, small targets ${layout.smallTargets.length}`);
  for (const e of zerr) console.log('page error: ' + e);
  for (const f of failed) console.log('failed request: ' + f);
  console.log('spike: wrote tools/out/spike/z-report.json, z-ready.png, z-render.png, z-done.png');
  const hardOk = !rep.error && !extra.some((r) => r.error) && stable && sameWorld && Object.values(reach).every(Boolean) && copyOk && !zerr.length && !failed.length && layout.scrollWidth <= layout.innerWidth && !layout.smallText.length && !layout.smallTargets.length;
  const outside = out.oracle.filter((c) => within(c) === false).length;
  if (outside) console.log(`${outside} row(s) outside +-30% of PROTO${strict ? '' : ' (reported; --strict fails on them)'}`);
  process.exit(!hardOk ? 1 : strict && outside ? 1 : 0);
}

if (run('S1')) {
  const { ctx, p } = await page(VP, 's1-chunks.html');
  const r = await p.evaluate(() => window.RESULT); await ctx.close();
  results.S1 = { question: 'Chunk memory and band switches at zoom 0.3-2.0', method: 'scripted pan through near/mid/far bands with the 12.4 LRU sizes (36/27/48) and width=height=0 eviction', measured: r,
    decision: { nearLRU: 36, midLRU: 27, farLRU: 48, spriteCacheMB: 48, rule: 'keep the 12.4 sizes; if the iPhone 13 canvas-memory ceiling is under 160 MB, near LRU 30 and sprite cache 40 MB (12.5)' },
    confirmOnDevice: ['iOS canvas-memory ceiling (blank chunk = getContext null) over a 5-minute pan', 'no tab reload during band switches', 'bake ms on the A15'] };
}

if (run('S2')) {
  const variants = [['2px-smooth', 'ppt=2&smooth=1'], ['2px-nosmooth', 'ppt=2&smooth=0'], ['4px-smooth', 'ppt=4&smooth=1']];
  const out = {};
  for (const [k, qs] of variants) {
    const { ctx, p } = await page({ width: 760, height: 520 }, 's2-light.html?' + qs);
    out[k] = await p.evaluate(() => window.RESULT);
    await p.screenshot({ path: join(OUT, `s2-${k}.png`) });
    await ctx.close();
  }
  results.S2 = { question: 'The look of darkness and light in tunnels', method: 'tunnel map with sconces, sim flood-fill light blocked by rock, wall pixels lit from their own side; 3 texture variants', measured: out,
    screenshots: variants.map(([k]) => `tools/out/spike/s2-${k}.png`),
    decision: { lightTexturePxPerTile: 2, smoothing: true, rule: 'default 2 px per tile with smoothing (bilinear over half a tile); no leak through a 1-tile wall in any variant' },
    confirmOnDevice: ['owner picks the look on the phone at zoom 0.75', '1-tile tunnels readable at zoom 0.75'] };
}

if (run('S3')) {
  const { ctx, p } = await page(VP, 's3-save.html', 'window.RESULT', 180000);
  const r = await p.evaluate(() => window.RESULT); await ctx.close();
  results.S3 = { question: 'Save time and size', method: 'synthetic day-200 state (30 colonists, 4,000 stacks, 1,500 buildings, mined map, live raid with 3 flow fields): snapshot + CompressionStream deflate-raw + IndexedDB put', measured: r,
    decision: { autosaveIntervalS: 60, quickSave: 'RLE + base64 into ec2.quick on pagehide', rule: 'targets: main thread < 8 ms, blob < 100 KB, put < 50 ms. If missed on the device: positional item rows (fields.js) and per-layer deltas before Stage 1b' },
    confirmOnDevice: ['snapshot main-thread ms on the A15 (desktop numbers are 2-4x faster)', 'IndexedDB put ms in Safari and in the Home Screen app'] };
}

if (run('S4')) {
  const r = {};
  { const { ctx, p } = await page(VP, 's4-storage.html?step=write'); r.write = await p.evaluate(() => window.RESULT);
    // swipe-kill during a save: the page is closed while the async IndexedDB save is in flight
    await p.goto(srv.url + 'tools/spike/pages/s4-storage.html?step=killsave');
    await p.waitForFunction('window.KILL_READY', null, { timeout: 60000 });
    await p.close({ runBeforeUnload: false });
    const p2 = await ctx.newPage(); await p2.goto(srv.url + 'tools/spike/pages/s4-storage.html?step=check'); await p2.waitForFunction('window.RESULT');
    r.afterKill = await p2.evaluate(() => window.RESULT);
    // eviction: IndexedDB deleted, localStorage index kept
    await p2.evaluate(() => new Promise((res) => { const q = indexedDB.deleteDatabase('ec2'); q.onsuccess = q.onerror = q.onblocked = () => res(); }));
    await p2.goto(srv.url + 'tools/spike/pages/s4-storage.html?step=evicted'); await p2.waitForFunction('window.RESULT');
    r.evicted = await p2.evaluate(() => window.RESULT);
    await ctx.close(); }
  results.S4 = { question: 'Storage eviction and containers', method: 'write a slot; start a big save then close the page mid-transaction (swipe-kill); reopen and promote the quick-save; delete IndexedDB and reopen', measured: r,
    decision: { quickSavePath: r.afterKill && r.afterKill.after >= 9000 ? (r.afterKill.before >= 9000 ? 'kept (in emulation the async save finished before the page closed, so a true mid-transaction kill was not reproduced)' : 'survives a kill mid-save (promoted on next launch)') : 'NOT proven here', missingColony: r.evicted && r.evicted.missingDetected ? 'detected: index present, blob gone -> offer Import' : 'NOT detected' },
    confirmOnDevice: ['real swipe-kill in Safari and in the Home Screen app', 'Clear Website Data', 'navigator.storage.persist() answer in Safari and standalone', 'separate container for the Home Screen app (Move colony to the app)', '7-day eviction is not testable here'] };
}

if (run('S5')) {
  const r = {};
  for (const vp of GATE_VIEWPORTS) { const { ctx, p } = await page(vp, 's5-viewport.html'); r[vp.name] = await p.evaluate(() => window.RESULT); await ctx.close(); }
  results.S5 = { question: 'Real viewport heights', method: 'visualViewport, inner size, dvh/svh/lvh and safe-area insets at each gate viewport (emulation echoes the configured size)', measured: r,
    decision: { gateViewports: GATE_VIEWPORTS.map((v) => `${v.width}x${v.height}`), layout: 'keep the 10.1 budgets for 664 pt (Safari) and 763 pt (app); landscape 335 pt' },
    confirmOnDevice: ['visualViewport in Safari portrait and landscape with the toolbar shown and collapsed', 'standalone height', 'safe-area insets (emulation reports 0)', 'smallest (SE/mini) and largest (Pro Max) iPhones'] };
}

if (run('S6')) {
  const { ctx, p } = await page(VP, 's6-touch.html', 'window.READY');
  const targets = await p.evaluate(() => window.TARGETS);
  // seeded Gaussian finger error (Box-Muller over an LCG); sd 4 pt and 6 pt
  let seed = 12345; const u = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const gauss = () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
  const out = {};
  for (const sd of [4, 6]) {
    const tally = {};
    for (const t of targets) {
      const cls = t.t.replace(/\d+$/, ''); tally[cls] = tally[cls] || { taps: 0, hits: 0 };
      for (let k = 0; k < 10; k++) {
        await p.evaluate(() => { window.HITS.length = 0; });
        // the bench is aimed at a point 30+ pt from the colonist (inside the 22 pt radius the colonist wins, by design)
        const ax = t.t === 'bench' ? t.x - 20 : t.x, ay = t.t === 'bench' ? t.y + 20 : t.y;
        await p.touchscreen.tap(ax + gauss() * sd, ay + gauss() * sd);
        const hit = await p.evaluate(() => window.HITS[0]);
        tally[cls].taps++; if (hit === t.t) tally[cls].hits++;
      }
    }
    out['sd' + sd + 'pt'] = Object.fromEntries(Object.entries(tally).map(([k, v]) => [k, { ...v, rate: +(v.hits / v.taps).toFixed(2) }]));
  }
  await p.screenshot({ path: join(OUT, 's6-touch.png') }); await ctx.close();
  const ok = Object.values(out.sd4pt).every((v) => v.rate >= 0.9);
  results.S6 = { question: 'Touch', method: 'synthetic taps with seeded Gaussian finger error at the centres of 44 pt cells (4 pt gaps), 20 pt pips with 44 pt hit areas, and a 16 pt colonist over a 64 pt bench (colonist-first within 22 pt)', measured: out,
    decision: { minTargetPt: 44, pipHitPt: 44, colonistFirstPt: 22, meets9of10AtSd4: ok, rule: ok ? 'keep the sizes' : 'grow targets or gaps' },
    confirmOnDevice: ['real thumbs: 9 of 10 taps on the intended target', 'loupe aiming', "the speed button's hold fan"] };
}

results.errors = errors;
await browser.close(); await srv.close();
const file = join(HERE, 'results.json');
let prev = {};
try { prev = JSON.parse((await import('node:fs')).readFileSync(file, 'utf8')); } catch (_) { /* first run */ }
const merged = { ...prev, ...results };
writeFileSync(file, JSON.stringify(merged, null, 1) + '\n');
for (const k of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']) if (results[k]) console.log(k, JSON.stringify(results[k].measured).slice(0, 400));
console.log(`spike: wrote tools/spike/results.json (${name}${errors.length ? ', ' + errors.length + ' page error(s)' : ''})`);
for (const e of errors) console.log('page error: ' + e);

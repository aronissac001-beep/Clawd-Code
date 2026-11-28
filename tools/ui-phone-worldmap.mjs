// ui-phone --flows=worldmap (EMBERCROWN-WORLD.md 12.4 W2.6 Test and Oracle; owner J, written by I with the component).
//   node tools/ui-phone.mjs --flows=worldmap [--browser=chromium|webkit] [--vp=name,...]
// The world map component (js/ui/worldmap.js) mounted under a 44 pt top bar on a Standard world (seed 3), at the six
// gate viewports, with touch emulation (hasTouch, deviceScaleFactor 2). Flows:
//   M1 an 8x region cell is >= 44 pt: [+] [+] from fit reaches 8x, for Small, Standard and Large worlds
//   M2 a tap at fit zoom shows the loupe (every loupe cell >= 44 pt, inside the map); a tap on a loupe cell selects it
//   M3 a 4x tap selects directly (no loupe), the region under the finger
//   M4 pinch with snapping: a spread of 3x from fit snaps to 4x; from 4x a pinch of 0.7x leaves the level (snaps to fit)
//   M5 a one-finger drag pans (by the drag, within the clamp) and never selects
//   M6 the 10 layer chips: each is >= 44 pt, shows its layer and a 14 px legend strip; the switches rebake in < 30 ms (median)
//   M7 frame time within budget: a pan and pinch sweep, fit to 8x, draws in < 1.5 ms p95 (desktop gate of section 10)
//   M8 read-only (the World tab): a tap peeks and the frame stays on the hold's region
//   M9 battery: still with clouds, about 10 fps; under Battery saver no frames when still; destroy releases the atlas
// Plus the 14.4 probe (no overflow, targets >= 44 pt, text >= 14 px, no console errors) on each screen.
// Screenshots: tools/out/ui-phone/worldmap-<vp>-<screen>.png. Exit 0 pass, 1 fail, 2 browser unavailable.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve, ROOT } from './lib/static-server.mjs';
import { launch, UNAVAILABLE } from './lib/browsers.mjs';

const OUT = join(ROOT, 'tools', 'out', 'ui-phone');

const PROBE = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  const hiddenUp = (el) => { for (let e = el; e; e = e.parentElement) if (e.hidden) return true; return false; };
  const small = [], tiny = [];
  for (const el of document.querySelectorAll('button, a[href], input, select, [role=button], [role=tab], [data-act]')) {
    if (!vis(el) || hiddenUp(el)) continue;
    // a chip scrolled partly out of its strip is clipped, not small: measure the element itself
    const r = el.getBoundingClientRect();
    if (r.width < 43.5 || r.height < 43.5) small.push(`${el.dataset.act || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let nd = w.nextNode(); nd; nd = w.nextNode()) {
    if (!nd.textContent.trim() || !nd.parentElement || !vis(nd.parentElement) || hiddenUp(nd.parentElement)) continue;
    const fs = parseFloat(getComputedStyle(nd.parentElement).fontSize);
    if (fs < 13.99) tiny.push(`"${nd.textContent.trim().slice(0, 20)}" ${fs}px`);
  }
  return { overflowX: document.documentElement.scrollWidth > innerWidth + 0.5, small, tiny };
};

/** Touch pointer events on the map canvas: a list of [type, id, x, y] (CSS px in the page). */
async function touch(page, evs, gap = 0) {
  for (const [type, id, x, y] of evs) {
    await page.evaluate(([type, id, x, y]) => {
      const cv = document.querySelector('.ec-wmap-cv');
      cv.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
    }, [type, id, x, y]);
    if (gap) await page.waitForTimeout(gap);
  }
}
const tapAt = (page, x, y) => touch(page, [['pointerdown', 1, x, y], ['pointerup', 1, x, y]]);
async function tapSel(page, sel) {
  const p = await page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
  if (!p) return false;
  await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y); if (!el) return;
    const o = { pointerId: 21, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
  }, [p.x, p.y]);
  await page.waitForTimeout(220);
  return true;
}

async function runVp(browser, srv, which, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
  const problems = [], flows = [], screens = [];
  const flow = (id, name, ok, detail) => flows.push({ id, name, ok: !!ok, detail });
  const screen = async (name) => {
    await page.waitForTimeout(200);
    const p = await page.evaluate(PROBE);
    const list = [...(p.overflowX ? ['horizontal overflow'] : []), ...p.small.map((x) => 'target < 44 pt: ' + x), ...p.tiny.map((x) => 'text < 14 px: ' + x)];
    for (const x of list) problems.push(`[${name}] ${x}`);
    screens.push({ name, ok: !list.length, n: list.length });
    await page.screenshot({ path: join(OUT, `worldmap-${vp.name}-${name}.png`) });
  };
  await page.goto(srv.url + 'js/ui/worldmap.js');
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/style.css"></head>'
    + '<body style="margin:0;background:#16131b;overflow:hidden"><div id="bar" style="height:44px;display:flex;align-items:center;gap:8px;padding:0 0 0 12px;color:#f6ead2;font-size:16px"><span style="flex:none">World map</span></div>'
    + '<div id="host" style="position:absolute;left:0;right:0;top:44px;bottom:0"></div></body></html>');
  await page.evaluate(async () => {
    const { buildRealm } = await import('/js/game/realm/gen.js');
    const WM = await import('/js/ui/worldmap.js');
    window.__WM = WM;
    window.__realm = buildRealm({ seed: 3 });
    window.__sel = []; window.__peek = [];
    window.__set = { reduceMotion: false, batterySaver: false };
    // in landscape the chips sit in the top bar (8.3 WORLD MAP landscape)
    window.__chips = innerWidth > innerHeight ? document.getElementById('bar') : null;
    window.__wm = WM.createWorldMap(document.getElementById('host'), window.__realm, { onSelect: (x, y) => window.__sel.push([x, y]), settings: () => window.__set, chipsInto: window.__chips });
  });
  await page.waitForTimeout(300);
  const st = () => page.evaluate(() => window.__wm.state());
  const stageBox = await page.evaluate(() => { const r = document.querySelector('.ec-wmap-stage').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const toPage = (x, y) => [stageBox.x + x, stageBox.y + y];
  await screen('fit');

  // M1: [+] [+] reaches 8x; the 8x cell >= 44 pt at every world size
  {
    await tapSel(page, '[data-act=wm-in]'); const a = await st();
    await tapSel(page, '[data-act=wm-in]'); const b = await st();
    await page.waitForTimeout(150);
    await screen('8x');
    const sizes = await page.evaluate(() => [['small', 48], ['standard', 64], ['large', 96]].map(([size, n]) => {
      const box = document.querySelector('.ec-wmap-stage').getBoundingClientRect();
      return { size, cell: +window.__WM.levelScales(box.width, box.height, n)[2].toFixed(1) };
    }));
    const ok = a.level === 1 && b.level === 2 && b.view.scale >= 44 && sizes.every((s) => s.cell >= 44);
    flow('M1', 'an 8x region cell is >= 44 pt', ok, `[+] -> level ${a.level} (${a.view.scale.toFixed(1)} pt), [+] -> level ${b.level} (${b.view.scale.toFixed(1)} pt); 8x cell by size ${sizes.map((s) => s.size + ' ' + s.cell).join(', ')}`);
  }
  // M2: at fit a tap shows the loupe; a tap on a loupe cell selects it
  {
    await tapSel(page, '[data-act=wm-fit]'); await page.waitForTimeout(250);
    const s0 = await st();
    const cx = s0.view.ox + 30.5 * s0.view.scale, cy = s0.view.oy + 30.5 * s0.view.scale;
    await tapAt(page, ...toPage(cx, cy)); await page.waitForTimeout(150);
    const s1 = await st();
    const L = s1.loupe;
    const inside = L && L.x >= -0.5 && L.y >= -0.5 && L.x + L.size <= stageBox.w + 0.5 && L.y + L.size <= stageBox.h + 0.5;
    const hintOn = await page.evaluate(() => !document.querySelector('.ec-wmap-hint').hidden);
    await screen('loupe');
    let pick = null, s2 = null;
    if (L) {
      // the cell one right and one down of the loupe's first cell
      pick = { rx: L.rx0 + 3, ry: L.ry0 + 1 };
      await tapAt(page, ...toPage(L.x + 3.5 * L.cell, L.y + 1.5 * L.cell)); await page.waitForTimeout(150);
      s2 = await st();
    }
    const ok = s0.level === 0 && L && L.rx === 30 && L.ry === 30 && L.cell >= 44 && inside && hintOn && !s1.selected && s2 && !s2.loupe && s2.selected && s2.selected.rx === pick.rx && s2.selected.ry === pick.ry;
    flow('M2', 'a tap at fit zoom shows the loupe; a loupe cell selects', ok, L ? `loupe on (${L.rx}, ${L.ry}), cell ${L.cell} pt, ${L.size} pt ${inside ? 'inside' : 'OUTSIDE'} the map, hint ${hintOn}; tap cell -> selected ${s2 && s2.selected ? s2.selected.rx + ',' + s2.selected.ry : 'none'} (want ${pick.rx},${pick.ry}), loupe ${s2 && s2.loupe ? 'still open' : 'closed'}` : 'no loupe');
    await screen('selected');
  }
  // M3: at 4x a tap selects directly
  {
    await page.evaluate(() => window.__wm.zoomTo(1)); await page.waitForTimeout(300);
    const s0 = await st();
    const x = stageBox.w * 0.6, y = stageBox.h * 0.55;
    const want = { rx: Math.floor((x - s0.view.ox) / s0.view.scale), ry: Math.floor((y - s0.view.oy) / s0.view.scale) };
    const nsel = await page.evaluate(() => window.__sel.length);
    await tapAt(page, ...toPage(x, y)); await page.waitForTimeout(150);
    const s1 = await st(), cb = await page.evaluate(() => window.__sel.slice(-1)[0]);
    const nsel2 = await page.evaluate(() => window.__sel.length);
    await screen('4x');
    const ok = s0.level === 1 && !s1.loupe && s1.selected && s1.selected.rx === want.rx && s1.selected.ry === want.ry && nsel2 === nsel + 1 && cb[0] === want.rx;
    flow('M3', 'a 4x tap selects directly', ok, `4x = ${s0.view.scale.toFixed(1)} pt; tap -> ${s1.selected ? s1.selected.rx + ',' + s1.selected.ry : 'none'} (want ${want.rx},${want.ry}), loupe ${s1.loupe ? 'OPEN' : 'none'}, onSelect ${nsel2 - nsel}`);
  }
  // M4: pinch with snapping
  {
    await page.evaluate(() => window.__wm.zoomTo(0)); await page.waitForTimeout(300);
    const s0 = await st(), mx = stageBox.w / 2, my = stageBox.h / 2, d0 = 40;
    const pinch = async (k) => {
      const ev = [['pointerdown', 1, ...toPage(mx - d0 / 2, my)], ['pointerdown', 2, ...toPage(mx + d0 / 2, my)]];
      for (let i = 1; i <= 8; i++) { const dd = d0 * (1 + (k - 1) * i / 8) / 2; ev.push(['pointermove', 1, ...toPage(mx - dd, my)], ['pointermove', 2, ...toPage(mx + dd, my)]); }
      const dd = d0 * k / 2; ev.push(['pointerup', 1, ...toPage(mx - dd, my)], ['pointerup', 2, ...toPage(mx + dd, my)]);
      await touch(page, ev, 16); await page.waitForTimeout(350);
      return st();
    };
    const sOut = await pinch(3.0);
    const sIn = await pinch(0.7);
    const ok = s0.level === 0 && sOut.level === 1 && Math.abs(sOut.view.scale - sOut.levels[1]) < 1e-6 && sIn.level === 0 && Math.abs(sIn.view.scale - sIn.levels[0]) < 1e-6 && !sOut.snapping;
    flow('M4', 'pinch with snapping', ok, `fit ${s0.view.scale.toFixed(2)} pt, spread 3x -> level ${sOut.level} (${sOut.view.scale.toFixed(2)} pt = ${sOut.levels[1].toFixed(2)}), pinch 0.7x -> level ${sIn.level} (${sIn.view.scale.toFixed(2)} pt)`);
  }
  // M5: a drag pans and never selects
  {
    await page.evaluate(() => window.__wm.zoomTo(2)); await page.waitForTimeout(300);
    const s0 = await st(), nsel = await page.evaluate(() => window.__sel.length);
    const x0 = stageBox.w * 0.7, y0 = stageBox.h * 0.6, dx = -80, dy = -50;
    const ev = [['pointerdown', 1, ...toPage(x0, y0)]];
    for (let i = 1; i <= 6; i++) ev.push(['pointermove', 1, ...toPage(x0 + dx * i / 6, y0 + dy * i / 6)]);
    ev.push(['pointerup', 1, ...toPage(x0 + dx, y0 + dy)]);
    await touch(page, ev, 16); await page.waitForTimeout(150);
    const s1 = await st(), nsel2 = await page.evaluate(() => window.__sel.length);
    const mx = s1.view.ox - s0.view.ox, my = s1.view.oy - s0.view.oy;
    const ok = Math.abs(mx - dx) < 0.5 && Math.abs(my - dy) < 0.5 && nsel2 === nsel && !s1.loupe;
    flow('M5', 'a drag pans and never selects', ok, `drag (${dx}, ${dy}) -> map moved (${mx.toFixed(1)}, ${my.toFixed(1)}); selections ${nsel2 - nsel}`);
  }
  // M6: the 10 layer chips and legends
  {
    const ids = await page.evaluate(() => window.__WM.LAYER_IDS);
    const rows = [];
    for (const id of ids) {
      await tapSel(page, `[data-act=wm-layer-${id}]`);
      const r = await page.evaluate((id) => {
        const s = window.__wm.state(), b = document.querySelector(`[data-act=wm-layer-${id}]`).getBoundingClientRect();
        const lg = document.querySelector('.ec-wmap-legend'), strip = lg.querySelector('.ec-wmap-strip, .ec-wmap-cat span');
        return { id, layer: s.layer, pressed: document.querySelector(`[data-act=wm-layer-${id}]`).getAttribute('aria-pressed'), w: b.width, h: b.height, lg: lg.dataset.layer, strip: strip ? strip.getBoundingClientRect().height : 0, text: lg.textContent.trim().slice(0, 40), ms: window.__wm.stats().layer };
      }, id);
      rows.push(r);
      if (id === 'temp' || id === 'rock') await screen('layer-' + id);
    }
    // the rebake row is C's (render-check --scene=atlas, median of 3); here the median of the 10 switches < 30 ms
    const bad = rows.filter((r) => r.layer !== r.id || r.pressed !== 'true' || r.w < 44 || r.h < 44 || r.lg !== r.id || Math.abs(r.strip - 14) > 0.5 || !r.text);
    const sorted = rows.map((r) => r.ms).sort((x, y) => x - y), maxMs = sorted[sorted.length - 1], medMs = sorted[Math.floor(sorted.length / 2)];
    flow('M6', 'the 10 layer chips with 14 px legends', rows.length === 10 && !bad.length && medMs < 30, `${rows.length} chips, ${rows.length - bad.length} ok; rebake median ${medMs.toFixed(1)} ms, slowest ${maxMs.toFixed(1)} ms${bad.length ? '; bad: ' + bad.map((r) => `${r.id}(${r.layer},${Math.round(r.w)}x${Math.round(r.h)},strip ${r.strip},${r.ms}ms)`).join(' ') : ''}`);
    await tapSel(page, '[data-act=wm-layer-atlas]');
  }
  // M7: frame time over a pan and pinch sweep, fit to 8x
  {
    const r = await page.evaluate(() => {
      const wm = window.__wm, s = wm.state(), lv = s.levels, W = s.view.w, H = s.view.h, n = window.__realm.n, times = [];
      wm.select(20, 24, { reveal: false });
      for (let i = 0; i < 240; i++) { // pinch-like scales (fit -> 8x -> fit) while the centre wanders: a pan and zoom sweep
        const f = i / 239, k = f < 0.5 ? f * 2 : 2 - f * 2, sc = Math.exp(Math.log(lv[0]) + (Math.log(lv[2]) - Math.log(lv[0])) * k);
        const cx = n * (0.2 + 0.6 * f), cy = n * (0.5 + 0.3 * Math.sin(f * 6.28));
        wm.setView({ ox: W / 2 - cx * sc, oy: H / 2 - cy * sc, scale: sc });
        times.push(wm.drawNow(i / 30));
      }
      times.sort((a, b) => a - b);
      return { frames: times.length, p95: times[Math.floor(times.length * 0.95)], max: times[times.length - 1] };
    });
    flow('M7', 'frame time within budget (desktop gate < 1.5 ms p95)', r.p95 < 1.5, `${r.frames} frames fit..8x pan and zoom: p95 ${r.p95.toFixed(3)} ms, max ${r.max.toFixed(3)} ms`);
  }
  // M8: read-only (the World tab)
  {
    const r = await page.evaluate(async () => {
      window.__wm.destroy();
      const peeks = [];
      const wm = window.__WM.createWorldMap(document.getElementById('host'), window.__realm, { readOnly: true, home: { rx: 33, ry: 28 }, onPeek: (x, y) => peeks.push([x, y]), onSelect: () => peeks.push('SELECT'), settings: () => window.__set, chipsInto: window.__chips });
      window.__wm = wm; window.__peeks = peeks;
      wm.zoomTo(1);
      await new Promise((res) => setTimeout(res, 300));
      return wm.state();
    });
    const x = stageBox.w * 0.3, y = stageBox.h * 0.4;
    await tapAt(page, ...toPage(x, y)); await page.waitForTimeout(150);
    const s1 = await st(), peeks = await page.evaluate(() => window.__peeks);
    await screen('readonly');
    const ok = r.readOnly && s1.selected && s1.selected.rx === 33 && s1.selected.ry === 28 && peeks.length === 1 && Array.isArray(peeks[0]);
    flow('M8', 'read-only: a tap peeks, the frame stays home', ok, `peeks ${JSON.stringify(peeks)}, frame at ${s1.selected ? s1.selected.rx + ',' + s1.selected.ry : 'none'} (home 33,28)`);
  }
  // M9: battery: ~10 fps when still; none under Battery saver; destroy releases
  {
    const r = await page.evaluate(async () => {
      const wm = window.__wm, wait = (ms) => new Promise((res) => setTimeout(res, ms));
      await wait(300); const a = wm.stats().draws; await wait(1000); const still = wm.stats().draws - a;
      window.__set.batterySaver = true; await wait(300); const b = wm.stats().draws; await wait(1000); const saver = wm.stats().draws - b;
      window.__set.batterySaver = false;
      const at = wm.atlas; wm.destroy();
      return { still, saver, released: !at.canvas && !at.layerCanvas, gone: !document.querySelector('.ec-wmap') };
    });
    const ok = r.still >= 6 && r.still <= 13 && r.saver === 0 && r.released && r.gone;
    flow('M9', 'battery: 10 fps still, 0 under Battery saver; release on close', ok, `still ${r.still} frames/s, Battery saver ${r.saver} frames/s, atlas released ${r.released}, removed ${r.gone}`);
  }
  await ctx.close();
  return { vp: vp.name, flows, screens, problems: [...errs, ...problems] };
}

/** Run the worldmap flows at the viewports; returns the exit code. */
export async function runWorldmapFlows({ which = 'webkit', only = null, viewports }) {
  const browser = await launch(which);
  if (!browser) { console.log(`ui-phone --flows=worldmap [${which}]: UNAVAILABLE - Playwright ${which} is not installed; try --browser=chromium`); return UNAVAILABLE; }
  const srv = await serve(0);
  const rep = [];
  let nbad = 0;
  for (const vp of viewports) {
    if (only && !only.split(',').includes(vp.name)) continue;
    let r;
    try { r = await runVp(browser, srv, which, vp); } catch (e) { r = { vp: vp.name, flows: [], screens: [], problems: ['harness: ' + String(e && e.stack || e).slice(0, 400)] }; }
    r.ok = !r.problems.length && r.flows.length === 9 && r.flows.every((f) => f.ok);
    if (!r.ok) nbad++;
    rep.push(r);
  }
  await browser.close(); await srv.close();
  writeFileSync(join(OUT, `ui-worldmap-${which}.json`), JSON.stringify(rep, null, 1));
  for (const r of rep) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.vp}  screens: ${r.screens.map((x) => x.name + (x.ok ? '' : `(${x.n})`)).join(' ')}`);
    for (const f of r.flows) console.log(`      ${f.ok ? 'ok  ' : 'FAIL'} ${f.id} ${f.name}: ${f.detail}`);
    for (const p of r.problems.slice(0, 14)) console.log('      ' + p);
    if (r.problems.length > 14) console.log(`      ... ${r.problems.length - 14} more`);
  }
  console.log(`ui-phone --flows=worldmap [${which}${which === 'chromium' ? ', stand-in for WebKit' : ''}]: ${nbad ? nbad + ' viewport(s) with problems' : 'all viewports clean'} (screenshots tools/out/ui-phone/worldmap-*.png)`);
  return nbad ? 1 : 0;
}

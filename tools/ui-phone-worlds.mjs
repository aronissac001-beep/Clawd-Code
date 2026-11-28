// ui-phone --flows=worlds (EMBERCROWN-WORLD.md 12.4 W2.7a Test and Oracle; owner J, written by I with js/ui/embark.js).
//   node tools/ui-phone.mjs --flows=worlds [--browser=chromium|webkit] [--vp=name,...]
// The real app with ?debug=1&realm=1 (REALM on), fresh storage per viewport, touch emulation. Flows:
//   W1 Quick start reaches the map of a new hold in 2 taps (New hold, Quick start); the world and the hold are in the index
//   W2 the Worlds list (from the world index, 9.2): name, size, year or "unsettled", holds
//   W3 Create world: the 1.5 fields, Generate, the animated generation (phase line, progress) reaches the map; the
//      record is stored and listed; no generation frame is longer than 50 ms (embark.js frame log)
//   W4 the map: Settle here is off with a reason on the sea; on land it opens the band's Start segment (fit words);
//      Found now founds in the region (the hold seed of G2) and the hold is noted in the world index
//   W5 Cancel during generation leaves no stored record and no world row
// Plus the 14.4 probe (no horizontal overflow, targets >= 44 pt, text >= 14 px, no console errors) on each screen.
// Screenshots: tools/out/ui-phone/worlds-<vp>-<screen>.png. Exit 0 pass, 1 fail, 2 browser unavailable.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve, ROOT } from './lib/static-server.mjs';
import { launch, UNAVAILABLE } from './lib/browsers.mjs';

const OUT = join(ROOT, 'tools', 'out', 'ui-phone');
const FRAME_MS = 50;

const PROBE = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  const hiddenUp = (el) => { for (let e = el; e; e = e.parentElement) if (e.hidden) return true; return false; };
  const small = [], tiny = [];
  for (const el of document.querySelectorAll('button, a[href], input, select, [role=button], [role=tab], [role=radio], [data-act]')) {
    if (!vis(el) || hiddenUp(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 43.5 || r.height < 43.5) small.push(`${el.dataset.act || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let nd = w.nextNode(); nd; nd = w.nextNode()) {
    if (!nd.textContent.trim() || !nd.parentElement || !vis(nd.parentElement) || hiddenUp(nd.parentElement)) continue;
    const fs = parseFloat(getComputedStyle(nd.parentElement).fontSize);
    if (fs < 13.99) tiny.push(`"${nd.textContent.trim().slice(0, 20)}" ${fs}px`);
  }
  return { overflowX: document.documentElement.scrollWidth > innerWidth + 0.5, small: [...new Set(small)], tiny: [...new Set(tiny)] };
};

async function tapSel(page, sel) {
  const p = await page.evaluate((sel) => {
    const e = [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().height > 0);
    if (!e) return null;
    e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
  if (!p) return false;
  await tapXY(page, p.x, p.y);
  return true;
}
async function tapXY(page, x, y) {
  await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y); if (!el) return;
    const o = { pointerId: 31, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
  }, [x, y]);
  await page.waitForTimeout(150);
}
const STORE = async () => {
  const R = await import('/js/game/save/realmstore.js');
  const I = await import('/js/game/save/idb.js');
  const rows = await R.listWorlds();
  let keys = [];
  try { keys = await I.idbKeys('realm'); } catch (_) { keys = Object.keys(localStorage).filter((k) => k.startsWith('ec2.r.')); }
  return { rows, keys: keys.map(Number) };
};

async function runVp(browser, srv, which, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
  const problems = [], flows = [], screens = [];
  const flow = (id, name, ok, detail) => flows.push({ id, name, ok: !!ok, detail });
  const screen = async (name) => {
    await page.waitForTimeout(180);
    const p = await page.evaluate(PROBE);
    const list = [...(p.overflowX ? ['horizontal overflow'] : []), ...p.small.map((x) => 'target < 44 pt: ' + x), ...p.tiny.map((x) => 'text < 14 px: ' + x)];
    for (const x of list) problems.push(`[${name}] ${x}`);
    screens.push({ name, ok: !list.length, n: list.length });
    await page.screenshot({ path: join(OUT, `worlds-${vp.name}-${name}.png`) });
  };
  const acts = () => page.evaluate(() => [...document.querySelectorAll('[data-act]')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.dataset.act));
  const inGame = (ms = 20000) => page.waitForFunction(() => window.__ecUI && window.__ecUI.shell && window.__ecUI.shell.renderer && window.__ecUI.shell.renderer.frames > 1, null, { timeout: ms }).then(() => true, () => false);
  const onScreen = (kind, ms = 15000) => page.waitForFunction((k) => { const e = document.querySelector('.ec-embark'); return e && e.dataset.screen === k; }, kind, { timeout: ms }).then(() => true, () => false);
  const stats = () => page.evaluate(async () => (await import('/js/ui/embark.js')).embarkStats());
  const url = srv.url + '?debug=1&realm=1';
  await page.goto(url);
  await page.waitForTimeout(800);

  // W1: Quick start in 2 taps
  {
    let taps = 0;
    if (await tapSel(page, '[data-act=new]')) taps++;
    const a = await acts();
    await screen('world-step');
    const first = await page.evaluate(() => { const b = [...document.querySelectorAll('.ec-title-actions [data-act]')].find((e) => e.getBoundingClientRect().height > 0 && e.tagName === 'BUTTON'); return b ? b.dataset.act : null; });
    const t0 = Date.now();
    if (await tapSel(page, '[data-act=quick]')) taps++;
    await page.waitForTimeout(60);
    if (await page.evaluate(() => !!document.querySelector('.ec-embark[data-screen=gen]'))) await screen('quick-gen');
    const entered = await inGame();
    const ms = Date.now() - t0;
    const st = await stats();
    const s = entered ? await page.evaluate(() => ({ id: window.__ec.state.id, realm: !!window.__ec.state.realm, seed: window.__ec.state.seed })) : null;
    const db = await page.evaluate(STORE);
    const row = db.rows[0];
    const noted = !!(row && s && row.holds.some((x) => x[0] === s.id));
    flow('W1', 'Quick start reaches the map of a new hold in 2 taps', entered && taps === 2 && first === 'quick' && a.includes('create-world') && noted && st.maxMs < FRAME_MS,
      `taps ${taps}, first card ${first}, ${entered ? `in the hold after ${ms} ms` : 'never entered'}; world rows ${db.rows.length}, records ${db.keys.length}, hold noted ${noted}, s.realm ${s && s.realm}; frames ${st.frames.length}, max ${st.maxMs} ms`);
    if (entered) await screen('quick-hold');
  }
  // W2: the Worlds list
  await page.goto(url); await page.waitForTimeout(800);
  {
    const shown = await tapSel(page, '[data-act=worlds]');
    await page.waitForTimeout(400);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.ec-world-row')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
    await screen('worlds');
    flow('W2', 'the Worlds list shows name, size, year and holds', shown && rows.length === 1 && /Standard/.test(rows[0]) && /unsettled|Year/.test(rows[0]) && /1 hold/.test(rows[0]), `${rows.length} row(s): "${(rows[0] || '').slice(0, 80)}"`);
  }
  // W3: Create world > Generate > the map
  let made = null;
  {
    const before = await page.evaluate(STORE);
    await tapSel(page, '[data-act=create-world]');
    const a = await acts();
    const fields = ['cw-name', 'cw-seed', 'cw-size-small', 'cw-history-250', 'cw-peoples-normal', 'cw-wildness-high', 'cw-hollowing-low', 'cw-sea-random', 'cw-generate'];
    const missing = fields.filter((f) => !a.includes(f));
    await screen('create');
    await tapSel(page, '[data-act=cw-size-small]');
    await page.evaluate(() => { const e = document.querySelector('[data-act=cw-seed]'); e.value = 'w27a'; e.dispatchEvent(new Event('input')); });
    await tapSel(page, '[data-act=cw-generate]');
    await page.waitForTimeout(40);
    const gen = await page.evaluate(() => { const e = document.querySelector('.ec-embark'); return e ? { screen: e.dataset.screen, phase: (e.querySelector('.ec-gen-phase') || {}).textContent || '', bar: !!e.querySelector('[role=progressbar]'), cancel: !!e.querySelector('[data-act=gen-cancel]') } : null; });
    if (gen && gen.screen === 'gen') await screen('gen');
    const onMap = await onScreen('map');
    const st = await stats();
    const after = await page.evaluate(STORE);
    made = after.rows.find((r) => !before.rows.some((b) => b.wid === r.wid)) || null;
    const stored = !!made && after.keys.includes(made.wid);
    flow('W3', 'Create world generates with progress and Cancel, stores the record, opens the map; frames < 50 ms',
      !missing.length && gen && gen.screen === 'gen' && gen.bar && gen.cancel && onMap && stored && made.size === 48 && st.maxMs < FRAME_MS && st.maxGap < FRAME_MS && st.phases.length >= 9,
      `fields missing [${missing.join(' ')}]; generation screen ${gen ? gen.screen : 'none'} "${gen ? gen.phase : ''}"; map ${onMap}; new row ${made ? made.name + ' n' + made.size : 'none'}, record stored ${stored}; frames ${st.frames.length} (phases ${st.phases.length}), max work ${st.maxMs} ms, max gap ${st.maxGap} ms`);
    if (onMap) await screen('map');
  }
  // W4: Settle here off on sea, Start segment, Found now
  {
    let detail = 'no map';
    let ok = false;
    if (made && await onScreen('map', 100)) {
      await tapSel(page, '[data-act=wm-in]'); await page.waitForTimeout(350);
      const pts = await page.evaluate(async () => {
        const E = await import('/js/ui/embark.js'); const Q = await import('/js/game/realm/query.js');
        const d = E.embarkDebug(); const st = d.map.state(); const v = st.view, R = d.realm;
        const box = document.querySelector('.ec-wmap-stage').getBoundingClientRect();
        const at = (want) => {
          let best = null, bd = Infinity;
          for (let ry = 0; ry < R.n; ry++) for (let rx = 0; rx < R.n; rx++) {
            const i = Q.idx(R, rx, ry);
            if (want === 'land' ? !Q.isEmbarkable(R, i) : !Q.isSea(R, i)) continue;
            const x = v.ox + (rx + 0.5) * v.scale, y = v.oy + (ry + 0.5) * v.scale;
            if (x < 30 || y < 30 || x > box.width - 30 || y > box.height - 70) continue;
            const dd = Math.hypot(x - box.width / 2, y - box.height / 2);
            if (dd < bd) { bd = dd; best = { rx, ry, x: box.left + x, y: box.top + y }; }
          }
          return best;
        };
        return { level: st.level, land: at('land'), sea: at('sea') };
      });
      // the pure rule as well, on the world's first sea region and a peak
      const rule = await page.evaluate(async () => {
        const E = await import('/js/ui/embark.js'); const Q = await import('/js/game/realm/query.js'); const R = E.embarkDebug().realm;
        let sea = null; for (let i = 0; i < R.n * R.n && !sea; i++) if (Q.isSea(R, i)) sea = [i % R.n, Math.floor(i / R.n)];
        return sea ? E.settleBlock(R, sea[0], sea[1]) : null;
      });
      let seaOff = 'no sea in view';
      if (pts.sea) {
        await tapXY(page, pts.sea.x, pts.sea.y);
        seaOff = await page.evaluate(() => { const b = document.querySelector('[data-act=settle]'); return b ? (b.disabled ? 'off: ' + document.querySelector('.ec-embark-panel').innerText.split('\n').slice(-2, -1)[0] : 'ON') : 'no button'; });
        await screen('map-sea');
      }
      let band = null, entered = false, noted = false, seedOk = false;
      if (pts.land) {
        await tapXY(page, pts.land.x, pts.land.y);
        const sel = await page.evaluate(async () => (await import('/js/ui/embark.js')).embarkDebug().map.state().selected);
        await screen('map-land');
        await tapSel(page, '[data-act=settle]');
        band = await page.evaluate(() => [...document.querySelectorAll('.ec-start-row')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()));
        await screen('band');
        const want = await page.evaluate(async ([rx, ry]) => { const E = await import('/js/ui/embark.js'); const G = await import('/js/game/realm/region.js'); return String(G.holdSeed(E.embarkDebug().realm, rx, ry)); }, [sel.rx, sel.ry]);
        await tapSel(page, '[data-act=found-now]');
        entered = await inGame();
        if (entered) {
          const s = await page.evaluate(() => ({ id: window.__ec.state.id, seed: String(window.__ec.state.seed) }));
          seedOk = await page.evaluate(async ([a, b]) => { const R = await import('/js/game/core/rand.js'); return String(R.seedOf(a)) === b || a === b; }, [want, s.seed]);
          const db = await page.evaluate(STORE);
          const row = db.rows.find((r) => r.wid === made.wid);
          noted = !!(row && row.holds.some((x) => x[0] === s.id && x[1] === sel.rx && x[2] === sel.ry));
          await screen('found-hold');
        }
        detail = `4x level ${pts.level}; sea tap: Settle ${seaOff}; rule on sea: ${rule}; land (${sel && sel.rx}, ${sel && sel.ry}); starts [${(band || []).join(' | ').slice(0, 160)}]; ${entered ? 'founded' : 'NOT founded'}, hold seed ${seedOk ? 'is' : 'is NOT'} the region's, noted ${noted}`;
      }
      ok = !!rule && pts.land && (!pts.sea || seaOff.startsWith('off')) && band && band.length >= 3 && band.some((x) => /Fits anywhere|Good fit/.test(x)) && entered && seedOk && noted;
    }
    flow('W4', 'Settle here (off on sea), the Start segment with fit words, Found now in the region', ok, detail);
  }
  // W5: Cancel leaves no stored record
  await page.goto(url); await page.waitForTimeout(800);
  {
    const before = await page.evaluate(STORE);
    await tapSel(page, '[data-act=worlds]'); await page.waitForTimeout(300);
    await tapSel(page, '[data-act=create-world]');
    await tapSel(page, '[data-act=cw-size-large]');
    // Generate, then Cancel two frames later (one phase a frame: a round trip per tap would miss the generation)
    const mid = await page.evaluate(async () => {
      const E = await import('/js/ui/embark.js');
      const tapEl = (el) => { const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; const o = { pointerId: 32, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 }; el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })); };
      tapEl(document.querySelector('[data-act=cw-generate]'));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const k = E.embarkStats().phases.length;
      tapEl(document.querySelector('[data-act=gen-cancel]'));
      return k;
    });
    await page.waitForTimeout(1500);
    const gone = await page.evaluate(() => !document.querySelector('.ec-embark'));
    const st = await stats();
    const after = await page.evaluate(STORE);
    const status = await page.evaluate(() => (document.querySelector('.ec-title-status') || {}).textContent || '');
    await screen('cancelled');
    flow('W5', 'Cancel leaves no stored record', gone && after.keys.length === before.keys.length && after.rows.length === before.rows.length && st.phases.length < 9,
      `cancel at phase ${mid}, stopped after ${st.phases.length} phases; records ${before.keys.length} -> ${after.keys.length}, rows ${before.rows.length} -> ${after.rows.length}; overlay ${gone ? 'closed' : 'OPEN'}; "${status}"`);
  }
  await ctx.close();
  return { vp: vp.name, flows, screens, problems: [...errs, ...problems] };
}

export async function runWorldsFlows({ which = 'webkit', only = null, viewports }) {
  mkdirSync(OUT, { recursive: true });
  const browser = await launch(which);
  if (!browser) { console.log(`ui-phone --flows=worlds [${which}]: UNAVAILABLE - Playwright ${which} is not installed; try --browser=chromium`); return UNAVAILABLE; }
  const srv = await serve(0);
  const rep = [];
  let nbad = 0;
  for (const vp of viewports) {
    if (only && !only.split(',').includes(vp.name)) continue;
    let r;
    try { r = await runVp(browser, srv, which, vp); } catch (e) { r = { vp: vp.name, flows: [], screens: [], problems: ['harness: ' + String(e && e.stack || e).slice(0, 400)] }; }
    r.ok = !r.problems.length && r.flows.length === 5 && r.flows.every((f) => f.ok);
    if (!r.ok) nbad++;
    rep.push(r);
  }
  await browser.close(); await srv.close();
  writeFileSync(join(OUT, `ui-worlds-${which}.json`), JSON.stringify(rep, null, 1));
  for (const r of rep) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.vp}  screens: ${r.screens.map((x) => x.name + (x.ok ? '' : `(${x.n})`)).join(' ')}`);
    for (const f of r.flows) console.log(`      ${f.ok ? 'ok  ' : 'FAIL'} ${f.id} ${f.name}: ${f.detail}`);
    for (const p of r.problems.slice(0, 14)) console.log('      ' + p);
    if (r.problems.length > 14) console.log(`      ... ${r.problems.length - 14} more`);
  }
  console.log(`ui-phone --flows=worlds [${which}${which === 'chromium' ? ', stand-in for WebKit' : ''}]: ${nbad ? nbad + ' viewport(s) with problems' : 'all viewports clean'} (screenshots tools/out/ui-phone/worlds-*.png)`);
  return nbad ? 1 : 0;
}

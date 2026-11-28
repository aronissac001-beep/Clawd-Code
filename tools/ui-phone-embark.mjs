// ui-phone --flows=embark (EMBERCROWN-WORLD.md 12.4 W2.7b Test and Oracle; owner J, written by I with js/ui/regioncard.js,
// js/ui/finderui.js and js/game/realm/finder.js).
//   node tools/ui-phone.mjs --flows=embark [--browser=chromium|webkit] [--vp=name,...] [--overlay=<dir>]
// The real app with ?debug=1&realm=1 (REALM on), fresh storage per viewport, touch emulation. Flows:
//   E1 the full flow in at most 9 taps: New hold, Create a world, Generate, Find a site, River: Need, Next match
//      (the map selects the best match and shows its region card), Settle here, Found now; the hold is founded in
//      the matched region (its hold seed, G2) and the region has a river
//   E2 the card's facts match regionFacts() on 20 regions (data-* and the visible words and numbers)
//   E3 the card: the 3 x 3 local area (72 pt cells; the centre is the real surface, previewSurface, LRU of 4; a tap
//      shows it at 2 px); a neighbour tap moves the selection; Settle here is off with a reason on the sea
//   E4 the finder: the count equals findSites, every match is pinned on the map, Next match walks the score order,
//      the filters are remembered for the world (localStorage) after a reload
// Plus the 14.4 probe (no horizontal overflow, targets >= 44 pt, text >= 14 px, no console errors) on each screen.
// --overlay=<dir> serves files from <dir> first (to try requested edits to files this step does not own).
// Screenshots: tools/out/ui-phone/embark-<vp>-<screen>.png. Exit 0 pass, 1 fail, 2 browser unavailable.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, resolve } from 'node:path';
import { serve, ROOT } from './lib/static-server.mjs';
import { launch, UNAVAILABLE } from './lib/browsers.mjs';

const OUT = join(ROOT, 'tools', 'out', 'ui-phone');
const MAX_TAPS = 9;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
/** A static server over the overlay dir, then the repo root. */
function serveOverlay(dir) {
  const roots = [resolve(dir), ROOT];
  const srv = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    for (const r of roots) {
      const f = normalize(join(r, p));
      if (!f.startsWith(r)) continue;
      const st = await stat(f).catch(() => null);
      if (st && st.isFile()) { res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(await readFile(f)); return; }
    }
    res.writeHead(404); res.end('not found');
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${srv.address().port}/`, close: () => new Promise((r) => srv.close(() => r())) })));
}

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
  const keys = [...document.querySelectorAll('.ec-embark *')].filter((e) => !e.children.length && /^(card|finder|embark)\.[a-z]/.test((e.textContent || '').trim())).map((e) => e.textContent.trim());
  return { overflowX: document.documentElement.scrollWidth > innerWidth + 0.5, small: [...new Set(small)], tiny: [...new Set(tiny)], keys: [...new Set(keys)] };
};
async function tapXY(page, x, y) {
  await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y); if (!el) return;
    const o = { pointerId: 41, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
  }, [x, y]);
  await page.waitForTimeout(150);
}
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
    const list = [...(p.overflowX ? ['horizontal overflow'] : []), ...p.small.map((x) => 'target < 44 pt: ' + x), ...p.tiny.map((x) => 'text < 14 px: ' + x), ...p.keys.map((x) => 'missing string: ' + x)];
    for (const x of list) problems.push(`[${name}] ${x}`);
    screens.push({ name, ok: !list.length, n: list.length });
    await page.screenshot({ path: join(OUT, `embark-${vp.name}-${name}.png`) });
  };
  const onScreen = (kind, ms = 20000) => page.waitForFunction((k) => { const e = document.querySelector('.ec-embark'); return e && e.dataset.screen === k; }, kind, { timeout: ms }).then(() => true, () => false);
  const inGame = (ms = 20000) => page.waitForFunction(() => window.__ecUI && window.__ecUI.shell && window.__ecUI.shell.renderer && window.__ecUI.shell.renderer.frames > 1, null, { timeout: ms }).then(() => true, () => false);
  const dbg = (fn, arg) => page.evaluate(async ([src, arg]) => { const E = await import('/js/ui/embark.js'); const d = E.embarkDebug(); return (0, eval)(src)(d, arg); }, [String(fn), arg]);
  const url = srv.url + '?debug=1&realm=1';
  await page.goto(url);
  await page.waitForTimeout(800);

  // E1: the full flow, counting taps
  let taps = 0, match = null, wid = null;
  const tap = async (sel) => { const ok = await tapSel(page, sel); if (ok) taps++; return ok; };
  {
    const steps = [];
    steps.push(await tap('[data-act=new]'));
    steps.push(await tap('[data-act=create-world]'));
    steps.push(await tap('[data-act=cw-generate]'));
    const onMap = await onScreen('map');
    await page.waitForTimeout(300);
    const wired = await dbg((d) => !!(d && d.panel));
    if (onMap) await screen('hint');
    steps.push(await tap('[data-act=find-site]'));
    if (wired) await screen('finder');
    steps.push(await tap('[data-act=fd-river-need]'));
    const fsState = wired ? await dbg((d) => d.panel.state()) : null;
    if (wired) await screen('finder-river');
    steps.push(await tap('[data-act=fd-next]'));
    await page.waitForTimeout(250);
    const sel = onMap ? await dbg((d) => d.map.state().selected) : null;
    const card = await page.evaluate(() => { const c = document.querySelector('.ec-rcard'); return c ? { ...c.dataset } : null; });
    const want = wired ? await dbg(async (d) => { const F = await import('/js/game/realm/finder.js'); const r = F.findSites(d.realm, { ...F.defaultFilters(), river: 'need' }); return { first: r.list[0], count: r.count, wid: d.realm.wid }; }) : null;
    match = want && want.first; wid = want && want.wid;
    if (card) await screen('card');
    steps.push(await tap('[data-act=settle]'));
    const band = await page.evaluate(() => document.querySelectorAll('.ec-start-row').length);
    const seed = match ? await dbg(async (d, m) => String((await import('/js/game/realm/region.js')).holdSeed(d.realm, m.rx, m.ry)), match) : null;
    steps.push(await tap('[data-act=found-now]'));
    const entered = await inGame();
    let seedOk = false;
    if (entered) {
      const s = await page.evaluate(() => String(window.__ec.state.seed));
      seedOk = await page.evaluate(async ([a, b]) => { const R = await import('/js/game/core/rand.js'); return String(R.seedOf ? R.seedOf(a) : a) === b || a === b; }, [seed, s]);
      await screen('hold');
    }
    const sameSel = !!(sel && match && sel.rx === match.rx && sel.ry === match.ry);
    flow('E1', `the full flow in at most ${MAX_TAPS} taps (New hold, Create, Generate, Find, River Need, Next match, Settle here, Found now)`,
      wired && steps.every(Boolean) && taps <= MAX_TAPS && sameSel && card && +card.river > 0 && band >= 3 && entered && seedOk,
      `${wired ? '' : 'embark.js does not mount the region panel (request R1); '}taps ${taps} [${steps.map((x) => (x ? 1 : 0)).join('')}]; finder ${fsState ? `${fsState.matches} matches in ${fsState.ms} ms` : 'none'} (want ${want ? want.count : '-'}); selected (${sel && sel.rx}, ${sel && sel.ry}) = best match ${sameSel}; card river ${card && card.river}; starts ${band}; ${entered ? 'founded' : 'NOT founded'}, hold seed ${seedOk ? 'is' : 'is NOT'} the region's`);
  }
  // reopen the world: Title > Worlds > the world
  await page.goto(url); await page.waitForTimeout(800);
  await tapSel(page, '[data-act=worlds]'); await page.waitForTimeout(300);
  await tapSel(page, `[data-act=world-open][data-wid="${wid}"]`);
  const back = await onScreen('map');
  await page.waitForTimeout(300);
  // E2: the card's facts against regionFacts on 20 regions
  {
    let detail = 'no map', ok = false;
    if (back && await dbg((d) => !!d.panel)) {
      const res = await dbg(async (d) => {
        const G = await import('/js/game/realm/region.js'), F = await import('/js/game/realm/finder.js');
        const R = d.realm, L = F.findSites(R, F.defaultFilters()).list, bad = [];
        const seaI = [...Array(R.n * R.n).keys()].find((i) => R.fields.elev[i] < R.seaLevel);
        const picks = L.filter((_, k) => k % Math.max(1, Math.floor(L.length / 19)) === 0).slice(0, 19).map((m) => [m.rx, m.ry]);
        picks.push([seaI % R.n, Math.floor(seaI / R.n)]);
        for (const [rx, ry] of picks) {
          d.panel.show(rx, ry);
          const c = document.querySelector('.ec-rcard'), fx = G.regionFacts(R, rx, ry), text = document.querySelector('.ec-embark-panel').textContent;
          const ds = c.dataset;
          const same = +ds.rx === rx && +ds.ry === ry && ds.biome === fx.biome && +ds.temp === fx.temp && +ds.amp === fx.amp && +ds.rain === fx.rain && +ds.river === fx.river
            && (ds.lake === '1') === fx.lake && ds.geo === fx.geo && +ds.taint === fx.taint && +ds.wild === fx.wild && (ds.sea === '1') === fx.sea;
          const need = [fx.name, `(${rx}, ${ry})`, fx.desc, ...(fx.sea ? [] : [`Taint ${fx.taint} of 255`, `Wildness ${fx.wild} of 255`, `Rainfall ${fx.rain} of 255`, ...(fx.lean ? [fx.lean] : [])])];
          const lost = need.filter((x) => !text.includes(x));
          if (!same || lost.length) bad.push(`(${rx}, ${ry}) data ${same}, words missing [${lost.join(' | ')}]`);
        }
        return { n: picks.length, bad };
      });
      ok = res.n === 20 && !res.bad.length;
      detail = `${res.n} regions (one sea), mismatches ${res.bad.length}${res.bad.length ? ': ' + res.bad.slice(0, 3).join('; ') : ''}`;
    }
    flow('E2', "the card's facts match regionFacts() on 20 regions", ok, detail);
  }
  // E3: the 3 x 3, the preview, a neighbour tap, Settle off on the sea
  {
    let detail = 'no map', ok = false;
    if (back && match && await dbg((d) => !!d.panel)) {
      await dbg((d, m) => { d.map.select(m.rx, m.ry, { reveal: true }); d.panel.show(m.rx, m.ry); }, match);
      await page.waitForFunction(() => { const c = document.querySelector('[data-act=rc-preview] canvas'); return c && c.dataset.preview === 'ok'; }, null, { timeout: 5000 }).catch(() => null);
      const g = await page.evaluate(() => {
        const cells = [...document.querySelectorAll('.ec-rc-cell')].map((b) => b.getBoundingClientRect());
        const c = document.querySelector('[data-act=rc-preview] canvas');
        let lit = 0; if (c) { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4 * 37) seen.add(d[i] * 65536 + d[i + 1] * 256 + d[i + 2]); lit = seen.size; }
        return { n: cells.length, min: Math.min(...cells.map((r) => Math.min(r.width, r.height))), preview: c && c.dataset.preview, ms: c && +c.dataset.ms, w: c && c.width, colours: lit };
      });
      const pv = await page.evaluate(async ([m]) => { const RC = await import('/js/ui/regioncard.js'); const E = await import('/js/ui/embark.js'); const M = await import('/js/game/world/mapgen3.js'); const G = await import('/js/game/realm/region.js');
        const GR = await import('/js/game/core/grid.js'); const R = E.embarkDebug().realm, o = G.regionOpts(R, m.rx, m.ry), a = RC.previewPlane(R, m.rx, m.ry).colour, was = [GR.W, GR.H, GR.D, GR.zS];
        GR.setMapSize(128, 128, 20, 14); let b; try { b = M.previewSurface(o.seed, { region: o }).colour; } finally { GR.setMapSize(...was); }
        let same = a.length === b.length; for (let i = 0; same && i < a.length; i++) if (a[i] !== b[i]) same = false; return { same, lru: RC.previewCacheKeys().length };
      }, [match]);
      await tapSel(page, '[data-act=rc-preview]');
      const big = await page.evaluate(() => { const b = document.querySelector('.ec-rc-big canvas'); return b ? Math.round(b.getBoundingClientRect().width) : 0; });
      await screen('card-big');
      // a neighbour: the first in-map land neighbour
      const nb = await page.evaluate(() => { const b = [...document.querySelectorAll('.ec-rc-cell')].find((x) => x.dataset.act.startsWith('rc-nb-') && !x.disabled); return b ? b.dataset.act : null; });
      let moved = false;
      if (nb) {
        const [, dx, dy] = nb.match(/^rc-nb-(-?\d)-(-?\d)$/).map(Number);
        await tapSel(page, `[data-act="${nb}"]`);
        const now = await page.evaluate(() => { const c = document.querySelector('.ec-rcard'); return c && { rx: +c.dataset.rx, ry: +c.dataset.ry }; });
        const ms = await dbg((d) => d.map.state().selected);
        const want = { rx: match.rx + dx, ry: match.ry + dy };
        moved = !!(now && ms && now.rx === want.rx && now.ry === want.ry && ms.rx === want.rx && ms.ry === want.ry);
      }
      // the sea: Settle off with a reason
      const sea = await dbg((d) => { const R = d.realm; const i = [...Array(R.n * R.n).keys()].find((k) => R.fields.elev[k] < R.seaLevel); d.panel.show(i % R.n, Math.floor(i / R.n)); const b = document.querySelector('[data-act=settle]'); const f = document.querySelector('.ec-rc-foot'); return { off: !!(b && b.disabled), why: f ? f.innerText.split('\n')[0] : '' }; });
      await screen('card-sea');
      ok = g.n === 9 && g.min >= 71.5 && g.preview === 'ok' && g.w === 128 && g.colours >= 3 && pv.same && pv.lru <= 4 && big >= 200 && moved && sea.off && /water/i.test(sea.why);
      detail = `cells ${g.n} at ${g.min.toFixed(1)} pt; preview ${g.preview} ${g.w} px in ${g.ms} ms, ${g.colours} colours, equals previewSurface ${pv.same}, LRU ${pv.lru}; big ${big} pt; neighbour ${nb} moved ${moved}; sea Settle ${sea.off ? 'off' : 'ON'}: "${sea.why}"`;
    }
    flow('E3', 'the 3 x 3 local area with the real surface, neighbour taps, Settle off with a reason', ok, detail);
  }
  // E4: the finder: count, pins, Next match order, remembered filters
  {
    let detail = 'no map', ok = false;
    if (back && await dbg((d) => !!d.panel)) {
      await tapSel(page, '[data-act=find-site]');
      const remembered = await page.evaluate(() => { const b = document.querySelector('[data-act=fd-river-need]'); return !!(b && b.classList.contains('on')); });
      await tapSel(page, '[data-act=fd-hollow-low]');
      await tapSel(page, '[data-act=fd-ores-coal]');
      const st = await dbg(async (d) => { const F = await import('/js/game/realm/finder.js'); const RS = await import('/js/game/save/realmstore.js'); const row = (await RS.listWorlds()).find((w) => w.wid === d.realm.wid);
        const r = F.findSites(d.realm, { ...F.defaultFilters(), river: 'need', hollow: 'low', ores: ['coal'] }, { used: (row && row.holds) || [] }); return { want: r.count, list: r.list.slice(0, 3).map((m) => [m.rx, m.ry]), got: d.panel.state().matches, pins: d.map.state().matches, text: document.querySelector('.ec-fd-count').textContent }; });
      await screen('finder-3');
      const walked = [];
      if (st.want) {
        await tapSel(page, '[data-act=fd-next]');
        for (let k = 0; k < Math.min(3, st.want); k++) {
          const c = await page.evaluate(() => { const c = document.querySelector('.ec-rcard'); return c && [+c.dataset.rx, +c.dataset.ry]; });
          walked.push(c);
          if (k < 2) await tapSel(page, '[data-act=next-match]');
        }
      }
      const order = JSON.stringify(walked) === JSON.stringify(st.list.slice(0, walked.length));
      ok = remembered && st.got === st.want && st.pins === st.want && order && /match/.test(st.text);
      detail = `river filter remembered ${remembered}; count ${st.got} (findSites ${st.want}), pins ${st.pins}, "${st.text}"; Next match walk ${JSON.stringify(walked)} in score order ${order}`;
    }
    flow('E4', 'the finder: count, pins, Next match in score order, filters remembered per world', ok, detail);
  }
  await ctx.close();
  return { vp: vp.name, flows, screens, problems: [...errs, ...problems], taps };
}

export async function runEmbarkFlows({ which = 'webkit', only = null, viewports, overlay = null }) {
  mkdirSync(OUT, { recursive: true });
  const browser = await launch(which);
  if (!browser) { console.log(`ui-phone --flows=embark [${which}]: UNAVAILABLE - Playwright ${which} is not installed; try --browser=chromium`); return UNAVAILABLE; }
  const srv = overlay ? await serveOverlay(overlay) : await serve(0);
  const rep = [];
  let nbad = 0;
  for (const vp of viewports) {
    if (only && !only.split(',').includes(vp.name)) continue;
    let r;
    try { r = await runVp(browser, srv, which, vp); } catch (e) { r = { vp: vp.name, flows: [], screens: [], problems: ['harness: ' + String(e && e.stack || e).slice(0, 400)] }; }
    r.ok = !r.problems.length && r.flows.length === 4 && r.flows.every((f) => f.ok);
    if (!r.ok) nbad++;
    rep.push(r);
  }
  await browser.close(); await srv.close();
  writeFileSync(join(OUT, `ui-embark-${which}.json`), JSON.stringify(rep, null, 1));
  for (const r of rep) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.vp}  screens: ${r.screens.map((x) => x.name + (x.ok ? '' : `(${x.n})`)).join(' ')}`);
    for (const f of r.flows) console.log(`      ${f.ok ? 'ok  ' : 'FAIL'} ${f.id} ${f.name}: ${f.detail}`);
    for (const p of r.problems.slice(0, 14)) console.log('      ' + p);
    if (r.problems.length > 14) console.log(`      ... ${r.problems.length - 14} more`);
  }
  console.log(`ui-phone --flows=embark [${which}${which === 'chromium' ? ', stand-in for WebKit' : ''}${overlay ? ', overlay ' + overlay : ''}]: ${nbad ? nbad + ' viewport(s) with problems' : 'all viewports clean'} (screenshots tools/out/ui-phone/embark-*.png)`);
  return nbad ? 1 : 0;
}

// ui-phone --flows=world (EMBERCROWN-WORLD.md 12.5 W3.9 Test and Oracle; owner J, written by I with js/ui/worldui.js,
// js/ui/worldmap.js and js/ui/peoplesui.js).
//   node tools/ui-phone.mjs --flows=world [--browser=chromium|webkit] [--vp=name,...]
// The real app with ?debug=1, fresh storage per viewport, touch emulation. A world with 250 years of history is
// built in the page, stored (realmstore.js writeRealm) and a hold is founded in one of its regions. Flows:
//   W1 one tap (World on the bar) opens the Map tab with the hold's pin on screen and the Neighbours list: the
//      liege first, then 6 neighbours
//   W2 the oracle: the liege and each of the 6 neighbours is reached in 2 taps from the play screen (World, the row):
//      the pushed page is that civ's card, titled with its name
//   W3 Peoples: one card per living civ (crest, standing meter, ethics, oath, demands, caravans), the liege first,
//      every line filled; the fallen civs follow
//   W4 the map's marks: the hold's pin, the liege and neighbour pins, one route per caravan source, a war mark per
//      front; a frame with the marks drawn within budget (8 ms)
//   W5 "Show on map" on a civ's card opens Map with that civ's nearest site selected
// Plus the 14.4 probe (no horizontal overflow, targets >= 44 pt, text >= 14 px, no console errors) on each screen.
// Screenshots: tools/out/ui-phone/world-<vp>-<screen>.png. Exit 0 pass, 1 fail, 2 browser unavailable.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve, ROOT } from './lib/static-server.mjs';
import { launch, UNAVAILABLE } from './lib/browsers.mjs';

const OUT = join(ROOT, 'tools', 'out', 'ui-phone');
const NFLOWS = 5;
const FRAME_MS = 8;

const PROBE = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  const hiddenUp = (el) => { for (let e = el; e; e = e.parentElement) if (e.hidden) return true; return false; };
  const small = [], tiny = [];
  const root = document.querySelector('.ec-sheet:not([hidden])') || document.body;
  for (const el of root.querySelectorAll('button, a[href], input, select, [role=button], [role=tab], [role=radio], [data-act]')) {
    if (!vis(el) || hiddenUp(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 43.5 || r.height < 43.5) small.push(`${el.dataset.act || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let nd = w.nextNode(); nd; nd = w.nextNode()) {
    if (!nd.textContent.trim() || !nd.parentElement || !vis(nd.parentElement) || hiddenUp(nd.parentElement)) continue;
    const fs = parseFloat(getComputedStyle(nd.parentElement).fontSize);
    if (fs < 13.99) tiny.push(`"${nd.textContent.trim().slice(0, 20)}" ${fs}px`);
  }
  return { overflowX: document.documentElement.scrollWidth > innerWidth + 0.5, small: [...new Set(small)], tiny: [...new Set(tiny)] };
};

/** A real touch tap on the nth visible match (scrolled into view first; scrolling is not a tap). */
async function tapSel(page, sel, nth = 0) {
  const p = await page.evaluate(([sel, nth]) => {
    const e = [...document.querySelectorAll(sel)].filter((x) => x.getBoundingClientRect().height > 0)[nth];
    if (!e) return null;
    e.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, civ: e.dataset.civ || null, site: e.dataset.site || null, role: e.dataset.role || null, rx: e.dataset.rx, ry: e.dataset.ry, text: e.textContent.trim().slice(0, 80) };
  }, [sel, nth]);
  if (!p) return null;
  await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y); if (!el) return;
    const o = { pointerId: 37, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
  }, [p.x, p.y]);
  await page.waitForTimeout(240);
  return p;
}
const PAGE = () => {
  const sh = document.querySelector('.ec-sheet:not([hidden])');
  if (!sh) return null;
  const t = sh.querySelector('.ec-crumbs h2'), card = sh.querySelector('.ec-world-box[data-world=civ] .ec-civ-card');
  return { title: t ? t.textContent : null, tab: (sh.querySelector('[data-act=sheet-tab].on') || {}).textContent || null, civ: card ? card.dataset.civ : null, crumbs: (sh.querySelector('.ec-crumbs') || {}).textContent || '' };
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
    await page.waitForTimeout(200);
    const p = await page.evaluate(PROBE);
    const list = [...(p.overflowX ? ['horizontal overflow'] : []), ...p.small.map((x) => 'target < 44 pt: ' + x), ...p.tiny.map((x) => 'text < 14 px: ' + x)];
    for (const x of list) problems.push(`[${name}] ${x}`);
    screens.push({ name, ok: !list.length, n: list.length });
    await page.screenshot({ path: join(OUT, `world-${vp.name}-${name}.png`) });
  };
  const pageNow = () => page.evaluate(PAGE);
  const closeSheet = () => page.evaluate(() => { const sh = window.__ecUI && window.__ecUI.shell; if (sh && sh.ctx) sh.ctx.closeSheet(); });
  await page.goto(srv.url + '?debug=1');
  await page.waitForTimeout(700);
  const made = await page.evaluate(async () => {
    const G = await import('/js/game/realm/gen.js'), Rec = await import('/js/game/realm/record.js'), RS = await import('/js/game/save/realmstore.js');
    const Q = await import('/js/game/realm/query.js'), App = await import('/js/ui/app.js');
    const realm = G.buildRealm({ seed: 1 }, { history: true });
    await RS.writeRealm(await Rec.encodeRecord(realm));
    let at = -1;
    const n = realm.n, c = (n >> 1) * n + (n >> 1);
    const order = [...Array(n * n).keys()].sort((a, b) => Math.abs(a - c) - Math.abs(b - c));
    for (const i of order) if (Q.isEmbarkable(realm, i) && !realm.fields.site[i]) { at = i; break; }
    const s = App.foundNew('world-1', { realm, rx: at % n, ry: Math.floor(at / n) });
    await App.enter(s);
    const T = realm.tables;
    return { rx: at % n, ry: Math.floor(at / n), civs: T.civs.length, living: T.civs.filter((x) => x.fell === null).length, sites: T.sites.length, wars: T.wars.filter((w) => w.ended === null).length };
  });
  await page.waitForTimeout(900);
  // the expected model (peoplesui.js realmView on the page's own state and record)
  const model = async () => page.evaluate(async () => {
    const A = await import('/js/ui/annals.js'), P = await import('/js/ui/peoplesui.js'), RT = await import('/js/data/text/realm.js');
    const s = window.__ec.state, R = A.holdRealm(s);
    if (R.status !== 'ready') return { status: R.status };
    const V = P.realmView(s, R.realm);
    return { status: 'ready', liege: V.liege, rows: V.rows.map((r) => ({ civ: r.civ, site: r.site, role: r.role, name: RT.civName(R.realm.tables.civs[r.civ]) })), routes: V.routes.length, sources: V.sources.length, fronts: V.wars.filter((w) => w.front).length, wars: V.wars.length, order: P.civOrder(s, R.realm) };
  });
  const stateOfMap = () => page.evaluate(async () => { const U = await import('/js/ui/worldui.js'); const m = U.worldMapHandle(); if (!m) return null; const st = m.state(); const r = m.canvas.getBoundingClientRect(); return { st, marks: m.marks(), w: r.width, h: r.height }; });

  // W1: one tap opens Map with the hold's pin and the Neighbours
  await tapSel(page, '[data-act=tab][data-tab=world]');
  await page.waitForTimeout(400);
  let M = await model();
  for (let i = 0; i < 20 && M.status !== 'ready'; i++) { await page.waitForTimeout(200); M = await model(); }
  await page.waitForTimeout(300);
  const p1 = await pageNow(), m1 = await stateOfMap();
  const rows1 = await page.evaluate(() => [...document.querySelectorAll('[data-act=world-nb]')].map((e) => ({ civ: e.dataset.civ, role: e.dataset.role, text: e.textContent })));
  const homePin = m1 && m1.marks.pins.find((p) => p.kind === 'home');
  const v = m1 && m1.st.view, hx = homePin && v ? v.ox + (homePin.rx + 0.5) * v.scale : -1, hy = homePin && v ? v.oy + (homePin.ry + 0.5) * v.scale : -1;
  const pinOn = !!(homePin && homePin.rx === made.rx && homePin.ry === made.ry && hx >= 0 && hy >= 0 && hx <= m1.w && hy <= m1.h);
  await screen('map');
  flow('W1', 'World (1 tap) opens Map: the hold\'s pin on screen, the liege and 6 neighbours listed', p1 && p1.tab === 'Map' && pinOn && rows1.length === 7 && rows1[0].role === 'liege' && rows1.slice(1).every((r) => r.role === 'near'),
    `tab ${p1 && p1.tab}; home pin ${homePin ? `${homePin.rx}, ${homePin.ry}` : 'none'} at ${Math.round(hx)}, ${Math.round(hy)} in ${m1 && Math.round(m1.w)} x ${m1 && Math.round(m1.h)}; rows ${rows1.length}: ${rows1.map((r) => r.text.split(',')[0]).join(' | ')}`);

  // W2: the liege and each neighbour in 2 taps from the play screen
  const reached = [];
  for (let k = 0; k < rows1.length; k++) {
    await closeSheet();
    await page.waitForTimeout(200);
    let taps = 0;
    if (await tapSel(page, '[data-act=tab][data-tab=world]')) taps++;
    await page.waitForTimeout(300);
    const r = await tapSel(page, '[data-act=world-nb]', k);
    if (r) taps++;
    await page.waitForTimeout(200);
    const pg = await pageNow(), want = M.rows[k];
    reached.push({ k, taps, ok: !!(r && pg && want && pg.civ === String(want.civ) && r.civ === String(want.civ) && pg.title === want.name), detail: `${want && want.role} ${want && want.name}: ${taps} taps -> ${pg && pg.title} (civ ${pg && pg.civ})` });
    if (k === 0) await screen('liege');
    if (k === 1) await screen('neighbour');
  }
  flow('W2', 'the liege and 6 neighbours are each reached in 2 taps', reached.length === 7 && reached.every((x) => x.ok && x.taps === 2), reached.map((x) => `${x.ok ? 'ok' : 'WRONG'} ${x.detail}`).join('; '));

  // W3: Peoples
  await closeSheet();
  await tapSel(page, '[data-act=tab][data-tab=world]');
  await tapSel(page, '[data-act=sheet-tab][data-tab=Peoples]');
  await page.waitForTimeout(300);
  const cards = await page.evaluate(() => [...document.querySelectorAll('.ec-peoples > .ec-civ-card')].map((c) => ({ civ: c.dataset.civ, role: c.dataset.role, crest: !!c.querySelector('canvas.ec-crest'), meter: !!c.querySelector('[role=meter]'), oath: /oath/.test(c.textContent), ethic: !!c.querySelector('.ec-civ-ethic p'), demands: !!c.querySelector('.ec-civ-demands p'), caravans: !!c.querySelector('.ec-civ-caravans p'), bad: /[{}]|undefined|NaN|null|\[object/.test(c.textContent), text: c.textContent })));
  const fallen = await page.evaluate(() => document.querySelectorAll('[data-act=civ-fallen]').length);
  const want3 = M.order.live.map(String);
  await screen('peoples');
  const okCards = cards.length === made.living && cards.map((c) => c.civ).join() === want3.join() && cards[0].role === 'liege' && cards.every((c) => c.crest && c.meter && c.oath && c.ethic && c.demands && c.caravans && !c.bad);
  flow('W3', 'Peoples: one card per living civ, the liege first, every part filled; the fallen follow', okCards && fallen === made.civs - made.living,
    `${cards.length} cards of ${made.living} living (order ${cards.map((c) => c.civ).join(',')} want ${want3.join(',')}), ${fallen} fallen; first: ${cards[0] ? cards[0].text.slice(0, 150) : '-'}${cards.find((c) => c.bad) ? '; UNFILLED: ' + cards.find((c) => c.bad).text.slice(0, 120) : ''}`);

  // W4: the map's marks
  await tapSel(page, '[data-act=sheet-tab][data-tab=Map]');
  await page.waitForTimeout(400);
  const m4 = await stateOfMap();
  const ms = await page.evaluate(async () => { const U = await import('/js/ui/worldui.js'); const m = U.worldMapHandle(); const t = []; for (let i = 0; i < 12; i++) t.push(m.drawNow()); t.sort((a, b) => a - b); return t[Math.floor(t.length * 0.9)]; });
  const mk = m4 && m4.marks;
  const okMarks = !!(mk && mk.pins.length === 1 + M.rows.length && mk.pins.filter((p) => p.kind === 'liege').length === (M.liege !== null ? 1 : 0) && mk.routes.length === M.sources && mk.wars.length === M.fronts && ms < FRAME_MS);
  await page.evaluate(async ([rx, ry]) => { const U = await import('/js/ui/worldui.js'); const m = U.worldMapHandle(); m.setView({ scale: m.state().levels[1] }); m.reveal(rx, ry); }, [made.rx, made.ry]);
  await page.waitForTimeout(300);
  await screen('marks');
  flow('W4', 'the map shows the pins, the caravan routes and the war fronts', okMarks, `pins ${mk && mk.pins.length} (want ${1 + M.rows.length}), routes ${mk && mk.routes.length} (sources ${M.sources}), war marks ${mk && mk.wars.length} (fronts ${M.fronts} of ${M.wars} wars); frame p90 ${ms && ms.toFixed(2)} ms`);

  // W5: Show on map from a civ's card
  await tapSel(page, '[data-act=world-nb]', 1);
  const b5 = await tapSel(page, '[data-act=civ-map]');
  await page.waitForTimeout(500);
  const m5 = await stateOfMap(), p5 = await pageNow();
  const sel = m5 && m5.st.selected;
  await screen('show-on-map');
  flow('W5', '"Show on map" on a card opens Map with the civ\'s site selected', !!(b5 && sel && String(sel.rx) === b5.rx && String(sel.ry) === b5.ry && p5 && p5.tab === 'Map'), `button (${b5 && b5.rx}, ${b5 && b5.ry}) -> tab ${p5 && p5.tab}, selected ${sel && `${sel.rx}, ${sel.ry}`}`);

  await ctx.close();
  return { vp: vp.name, flows, screens, problems: [...errs, ...problems] };
}

export async function runWorldFlows({ which = 'webkit', only = null, viewports }) {
  mkdirSync(OUT, { recursive: true });
  const browser = await launch(which);
  if (!browser) { console.log(`ui-phone --flows=world [${which}]: UNAVAILABLE - Playwright ${which} is not installed; try --browser=chromium`); return UNAVAILABLE; }
  const srv = await serve(0);
  const rep = [];
  let nbad = 0;
  for (const vp of viewports) {
    if (only && !only.split(',').includes(vp.name)) continue;
    let r;
    try { r = await runVp(browser, srv, which, vp); } catch (e) { r = { vp: vp.name, flows: [], screens: [], problems: ['harness: ' + String(e && e.stack || e).slice(0, 400)] }; }
    r.ok = !r.problems.length && r.flows.length === NFLOWS && r.flows.every((f) => f.ok);
    if (!r.ok) nbad++;
    rep.push(r);
  }
  await browser.close(); await srv.close();
  writeFileSync(join(OUT, `ui-world-${which}.json`), JSON.stringify(rep, null, 1));
  for (const r of rep) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.vp}  screens: ${r.screens.map((x) => x.name + (x.ok ? '' : `(${x.n})`)).join(' ')}`);
    for (const f of r.flows) console.log(`      ${f.ok ? 'ok  ' : 'FAIL'} ${f.id} ${f.name}: ${f.detail}`);
    for (const p of r.problems.slice(0, 14)) console.log('      ' + p);
    if (r.problems.length > 14) console.log(`      ... ${r.problems.length - 14} more`);
  }
  console.log(`ui-phone --flows=world [${which}${which === 'chromium' ? ', stand-in for WebKit' : ''}]: ${nbad ? nbad + ' viewport(s) with problems' : 'all viewports clean'} (screenshots tools/out/ui-phone/world-*.png)`);
  return nbad ? 1 : 0;
}

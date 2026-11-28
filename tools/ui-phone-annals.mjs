// ui-phone --flows=annals (EMBERCROWN-WORLD.md 12.5 W3.2 Test and Oracle; owner J, written by I with js/ui/annals.js,
// js/ui/worldui.js and js/data/text/realm.js).
//   node tools/ui-phone.mjs --flows=annals [--browser=chromium|webkit] [--vp=name,...]
// The real app with ?debug=1, fresh storage per viewport, touch emulation. A world with 250 years of history is
// built in the page (createRealm with history, the HISTORY flag stays off), stored (realmstore.js writeRealm) and a
// hold is founded in one of its regions; the World sheet then reads the record from the store. Flows:
//   A1 World > Annals > World: the 7 sections (Eras, Civilizations, Peoples, Sites, Figures, Artifacts, Beasts)
//   A2 every event of the world renders in the page with no unfilled slot and no line over 160 characters
//   A3 links open the right record: a civ row, an event line and a Related chip each push the record they name
//      (the pushed page's world key and title match the link)
//   A4 "Show on map" on a site opens the World sheet's Map tab with that site selected (map state and peek)
//   A5 the Wars chip lists every war; a war row opens its record
// Plus the 14.4 probe (no horizontal overflow, targets >= 44 pt, text >= 14 px, no console errors) on each screen.
// Screenshots: tools/out/ui-phone/annals-<vp>-<screen>.png. Exit 0 pass, 1 fail, 2 browser unavailable.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve, ROOT } from './lib/static-server.mjs';
import { launch, UNAVAILABLE } from './lib/browsers.mjs';

const OUT = join(ROOT, 'tools', 'out', 'ui-phone');
const NFLOWS = 5;

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

async function tapSel(page, sel, nth = 0) {
  const p = await page.evaluate(([sel, nth]) => {
    const e = [...document.querySelectorAll(sel)].filter((x) => x.getBoundingClientRect().height > 0)[nth];
    if (!e) return null;
    e.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, key: e.dataset.key || null, text: e.textContent.trim().slice(0, 60) };
  }, [sel, nth]);
  if (!p) return null;
  await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y); if (!el) return;
    const o = { pointerId: 31, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
  }, [p.x, p.y]);
  await page.waitForTimeout(220);
  return p;
}
/** The open sheet's page: its title and the world key of the record shown (or null). */
const PAGE = () => {
  const sh = document.querySelector('.ec-sheet:not([hidden])');
  if (!sh) return null;
  const t = sh.querySelector('.ec-crumbs h2'), boxes = [...sh.querySelectorAll('[data-wkey]')];
  return { title: t ? t.textContent : null, key: boxes.length ? boxes[boxes.length - 1].dataset.wkey : null, tab: (sh.querySelector('[data-act=sheet-tab].on') || {}).textContent || null };
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
    await page.screenshot({ path: join(OUT, `annals-${vp.name}-${name}.png`) });
  };
  const pageNow = () => page.evaluate(PAGE);
  await page.goto(srv.url + '?debug=1');
  await page.waitForTimeout(700);
  // a world with history, stored; a hold founded in it
  const made = await page.evaluate(async () => {
    const G = await import('/js/game/realm/gen.js'), Rec = await import('/js/game/realm/record.js'), RS = await import('/js/game/save/realmstore.js');
    const Q = await import('/js/game/realm/query.js'), App = await import('/js/ui/app.js');
    const realm = G.buildRealm({ seed: 'Annals', size: 'small' }, { history: true });
    await RS.writeRealm(await Rec.encodeRecord(realm));
    let at = -1;
    const n = realm.n, c = (n >> 1) * n + (n >> 1);
    const order = [...Array(n * n).keys()].sort((a, b) => Math.abs(a - c) - Math.abs(b - c));
    for (const i of order) if (Q.isEmbarkable(realm, i) && !realm.fields.site[i]) { at = i; break; }
    const s = App.foundNew('annals-1', { realm, rx: at % n, ry: Math.floor(at / n) });
    await App.enter(s);
    const T = realm.tables;
    return { wid: realm.wid, rx: at % n, ry: Math.floor(at / n), civs: T.civs.length, sites: T.sites.length, figures: T.figures.length, wars: T.wars.length, events: realm.events.length / 12 };
  });
  await page.waitForTimeout(900);

  // A1: World > Annals > World
  await tapSel(page, '[data-act=tab][data-tab=world]');
  await page.waitForTimeout(300);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.ec-sheet:not([hidden]) [data-act=sheet-tab]')].map((e) => e.textContent));
  await screen('map');
  await tapSel(page, '[data-act=sheet-tab][data-tab=Annals]');
  await tapSel(page, '[data-act=annals-world]');
  await page.waitForFunction(() => document.querySelectorAll('[data-act=world-section]').length >= 7, null, { timeout: 8000 }).catch(() => null);
  const secs = await page.evaluate(() => [...document.querySelectorAll('[data-act=world-section]')].map((e) => e.querySelector('.ec-ruler-t').textContent));
  await screen('world');
  flow('A1', 'World > Annals > World: the 7 sections', secs.length === 7 && tabs[0] === 'Map', `tabs [${tabs.join(', ')}]; sections ${secs.join(' | ')}; world ${made.civs} civs, ${made.sites} sites, ${made.figures} figures, ${made.wars} wars, ${made.events} events`);

  // A2: every event renders in the page
  const a2 = await page.evaluate(async () => {
    const A = await import('/js/ui/annals.js'), RT = await import('/js/data/text/realm.js');
    const R = A.holdRealm(window.__ec.state);
    if (R.status !== 'ready') return { status: R.status };
    const r = R.realm, n = RT.eventCount(r);
    let bad = 0, long = 0, max = 0, sample = null;
    const t0 = performance.now();
    for (let k = 0; k < n; k++) { const e = RT.eventText(r, k); if (/[{}]|undefined|null|NaN/.test(e.text)) { bad++; sample = sample || e.text; } if (e.text.length > RT.MAX_LINE) long++; if (e.text.length > max) max = e.text.length; }
    return { status: R.status, n, bad, long, max, ms: +(performance.now() - t0).toFixed(1), sample, cached: RT.cachedLines(r) };
  });
  flow('A2', 'every event renders filled and <= 160 characters', a2.status === 'ready' && a2.n === made.events && !a2.bad && !a2.long && a2.cached <= 200,
    `${a2.n} events, ${a2.bad} unfilled, ${a2.long} long, longest ${a2.max}, ${a2.ms} ms, cache ${a2.cached}${a2.sample ? ': ' + a2.sample : ''}`);

  // A3: links open the right record
  const checks = [];
  await tapSel(page, '[data-act=world-section]', 1);                       // Civilizations
  await screen('civs');
  const c0 = await tapSel(page, '[data-act=world-entry]');
  let pg = await pageNow();
  checks.push({ what: 'civ row', ok: !!(pg && pg.key && pg.key.startsWith('wc') && c0 && c0.text.startsWith(pg.title)), detail: `${c0 && c0.text} -> ${pg && pg.key} "${pg && pg.title}"` });
  await screen('civ');
  const ev = await tapSel(page, '[data-act=world-ev]');
  pg = await pageNow();
  checks.push({ what: 'event line', ok: !!(ev && pg && pg.key === ev.key), detail: `${ev && ev.key} -> ${pg && pg.key} "${pg && pg.title}"` });
  await screen('entry');
  // a Related chip: on this page, else on the pages before it (a figure whose names are all rows has none)
  let ch = null;
  for (let back = 0; back < 3 && !ch; back++) {
    if (back) await tapSel(page, '[data-act=sheet-back]');
    ch = await tapSel(page, '.ec-rchip[data-act=world-link]');
  }
  pg = await pageNow();
  checks.push({ what: 'Related chip', ok: !!(ch && pg && pg.key === ch.key && ch.text === pg.title), detail: `${ch && ch.key} "${ch && ch.text}" -> ${pg && pg.key} "${pg && pg.title}"` });
  const names = await page.evaluate(async (keys) => { const A = await import('/js/ui/annals.js'), RT = await import('/js/data/text/realm.js'); const r = A.holdRealm(window.__ec.state).realm; return keys.map((k) => (k ? RT.recordName(r, k) : null)); }, checks.map((c) => (c.detail.match(/-> (w[a-z]\d+)/) || [])[1] || null));
  const titlesOk = checks.every((c, i) => names[i] && c.detail.includes(`"${names[i]}"`));
  flow('A3', 'links open the right record (civ row, event line, Related chip)', checks.every((c) => c.ok) && titlesOk, checks.map((c) => `${c.what} ${c.ok ? 'ok' : 'WRONG'}: ${c.detail}`).join('; '));

  // A4: Show on map selects the site
  for (let i = 0; i < 6 && await page.evaluate(() => !document.querySelector('[data-act=world-section]')); i++) await tapSel(page, '[data-act=sheet-back]');
  await tapSel(page, '[data-act=world-section]', 3);                       // Sites
  await screen('sites');
  const s0 = await tapSel(page, '[data-act=world-entry]');
  const want = await page.evaluate(() => { const b = document.querySelector('[data-act=world-map]'); return b ? { rx: +b.dataset.rx, ry: +b.dataset.ry } : null; });
  const site = await pageNow();
  await tapSel(page, '[data-act=world-map]');
  await page.waitForTimeout(500);
  const got = await page.evaluate(async () => { const U = await import('/js/ui/worldui.js'); const m = U.worldMapHandle(); const pk = document.querySelector('.ec-world-peek'); return { st: m ? m.state() : null, peek: pk ? { rx: +pk.dataset.rx, ry: +pk.dataset.ry, text: pk.textContent } : null }; });
  const tabNow = (await pageNow() || {}).tab;
  await screen('show-on-map');
  const sel = got.st && got.st.selected;
  flow('A4', '"Show on map" opens Map with the site selected', !!(want && sel && sel.rx === want.rx && sel.ry === want.ry && got.peek && got.peek.rx === want.rx && got.peek.ry === want.ry && tabNow === 'Map' && got.st.matches === 1 && site && got.peek.text.includes(site.title)),
    `${s0 && s0.text} (${want && want.rx}, ${want && want.ry}) -> tab ${tabNow}, selected ${sel && `${sel.rx}, ${sel.ry}`}, level ${got.st && got.st.level}, peek "${got.peek && got.peek.text}"`);

  // A5: Wars
  await tapSel(page, '[data-act=sheet-tab][data-tab=Annals]');
  await tapSel(page, '[data-act=annals-wars]');
  const nw = await page.evaluate(() => document.querySelectorAll('[data-act=world-entry]').length);
  const more = await page.evaluate(() => document.querySelectorAll('[data-act=world-more]').length);
  await screen('wars');
  const w0 = await tapSel(page, '[data-act=world-entry]');
  pg = await pageNow();
  flow('A5', 'the Wars chip lists every war; a war opens its record', (nw === made.wars || (more && nw >= 40)) && (made.wars === 0 || (pg && pg.key && pg.key.startsWith('ww'))), `${nw} war rows of ${made.wars}; ${w0 && w0.text} -> ${pg && pg.key}`);
  if (made.wars) await screen('war');

  await ctx.close();
  return { vp: vp.name, flows, screens, problems: [...errs, ...problems] };
}

export async function runAnnalsFlows({ which = 'webkit', only = null, viewports }) {
  mkdirSync(OUT, { recursive: true });
  const browser = await launch(which);
  if (!browser) { console.log(`ui-phone --flows=annals [${which}]: UNAVAILABLE - Playwright ${which} is not installed; try --browser=chromium`); return UNAVAILABLE; }
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
  writeFileSync(join(OUT, `ui-annals-${which}.json`), JSON.stringify(rep, null, 1));
  for (const r of rep) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.vp}  screens: ${r.screens.map((x) => x.name + (x.ok ? '' : `(${x.n})`)).join(' ')}`);
    for (const f of r.flows) console.log(`      ${f.ok ? 'ok  ' : 'FAIL'} ${f.id} ${f.name}: ${f.detail}`);
    for (const p of r.problems.slice(0, 14)) console.log('      ' + p);
    if (r.problems.length > 14) console.log(`      ... ${r.problems.length - 14} more`);
  }
  console.log(`ui-phone --flows=annals [${which}${which === 'chromium' ? ', stand-in for WebKit' : ''}]: ${nbad ? nbad + ' viewport(s) with problems' : 'all viewports clean'} (screenshots tools/out/ui-phone/annals-*.png)`);
  return nbad ? 1 : 0;
}

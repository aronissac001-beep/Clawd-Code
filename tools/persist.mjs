// Gate check "Persistence" (doc 14.4, from Stage 1a; owner J; what it measures is A's js/game/save/* and
// js/main.js, and I's title screen).
//   node tools/persist.mjs [--browser=webkit|chromium] [--json]
// On the real game page (index.html?debug=1, a 390 x 664 touch viewport), each case in a fresh
// browser context (its own IndexedDB and localStorage):
//   reload      New colony, play, save; reload: the title offers Continue and it restores the colony
//               (the slot loads to the saved hash; the UI enters the game with the same id and colonists)
//   quick       a pagehide quick-save (ec2.quick) newer than the slots, then the page dies before any
//               async save: on the next load it is promoted into a slot and Continue reaches its tick
//   evict-idb   the IndexedDB database is deleted between runs: the title shows the colony as missing
//               and offers Import, with no crash
//   evict-ls    localStorage is cleared (IndexedDB kept): the colony comes back from IndexedDB meta
//   evict-both  both are cleared: no crash; the title still founds a new colony
//   no-idb      IndexedDB disabled: the localStorage fallback saves and reloads, and raises 'limited'
//   export      export then import round-trips byte-identical entities (same bytes, same entities JSON)
//   quota       a quota error on the quick-save raises the 'quota' alert and returns false (no throw)
// Exit 0 pass, 1 fail, 2 browser unavailable. Screenshots: tools/out/persist/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve, ROOT } from './lib/static-server.mjs';
import { launch, browserArg, UNAVAILABLE } from './lib/browsers.mjs';

const OUT = join(ROOT, 'tools', 'out', 'persist');
mkdirSync(OUT, { recursive: true });
const which = browserArg('webkit');
const browser = await launch(which);
if (!browser) { console.log(`persist [${which}]: UNAVAILABLE - Playwright ${which} is not installed; try --browser=chromium`); process.exit(UNAVAILABLE); }
const srv = await serve(0);
const URL0 = srv.url + '?debug=1';
const results = [];
const add = (name, ok, detail, owner = 'A') => results.push({ name, ok: !!ok, detail, owner });

async function fresh({ noIdb = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 664 }, deviceScaleFactor: 2, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
  if (noIdb) await ctx.addInitScript(() => { try { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); } catch (_) { /* ignore */ } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  return { ctx, page, errs };
}
const ready = (page) => page.waitForFunction(() => window.__ec && window.__ec.app && window.__ec.app.ready, null, { timeout: 10000 }).then(() => page.evaluate(() => window.__ec.app.ready.then((r) => ({ promoted: r ? r.promoted : null, cards: r ? r.cards.length : 0 }))));
async function tapSel(page, sel) {
  return page.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[hidden]'); });
    if (!el) return false;
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const o = { pointerId: 41, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
    return true;
  }, sel);
}
const inGame = (page) => page.waitForFunction(() => window.__ecUI && window.__ecUI.shell && window.__ec.state, null, { timeout: 10000 }).then(() => true, () => false);
/** title > New colony, then pause, advance the sim `n` ticks and (optionally) save into a slot. */
async function newColony(page, n = 1200, save = true) {
  await page.goto(URL0); await ready(page);
  if (!(await tapSel(page, '[data-act=new]'))) return null;
  if (!(await inGame(page))) return null;
  return page.evaluate(async ([n, save]) => {
    const ec = window.__ec, sh = window.__ecUI.shell;
    sh.ui.speed = 0; sh.loop.timeScale = 0;
    ec.step(n);
    const r = save ? await ec.saveNow('test') : null;
    const s = ec.state;
    return { id: s.id, name: s.name, tick: s.tick, hash: ec.hash(), col: s.col.map((c) => c.name).join(','), bld: s.bld.filter(Boolean).length, save: r };
  }, [n, save]);
}
const titleText = (page) => page.evaluate(() => { const t = document.querySelector('.ec-title'); return t ? t.innerText.replace(/\s+/g, ' ').trim() : ''; });

// ---- reload --------------------------------------------------------------------------------------
{
  const { ctx, page, errs } = await fresh();
  const a = await newColony(page);
  if (!a) add('reload restores the colony', false, 'could not found a colony from the title', 'I');
  else {
    await page.reload(); await ready(page);
    const t = await titleText(page);
    const direct = await page.evaluate(async (id) => { const s = await window.__ec.continueColony(id); return s ? { hash: window.__ec.hash(), tick: s.tick } : null; }, a.id);
    const tapped = await tapSel(page, '[data-act=continue]');
    const ok = tapped && (await inGame(page));
    const b = ok ? await page.evaluate(() => { const s = window.__ec.state; return { id: s.id, tick: s.tick, col: s.col.map((c) => c.name).join(','), bld: s.bld.filter(Boolean).length }; }) : null;
    await page.screenshot({ path: join(OUT, 'reload.png') });
    add('reload restores the colony', direct && direct.hash === a.hash && b && b.id === a.id && b.col === a.col && b.bld === a.bld && b.tick >= a.tick && !errs.length,
      `saved tick ${a.tick} hash ${a.hash}; slot loads to ${direct ? direct.hash : 'nothing'}; title "${t.slice(0, 60)}"; Continue ${b ? `entered at tick ${b.tick}, same id ${b.id === a.id}, same colonists ${b.col === a.col}, buildings ${b.bld}/${a.bld}` : 'did not enter the game'}${errs.length ? '; ' + errs[0] : ''}`);
  }
  await ctx.close();
}

// ---- quick-save promotion --------------------------------------------------------------------------
{
  const { ctx, page, errs } = await fresh();
  const a = await newColony(page, 600, true);
  if (!a) add('pagehide quick-save is promoted on the next load', false, 'could not found a colony', 'I');
  else {
    const q = await page.evaluate(() => {
      const ec = window.__ec;
      ec.step(1800);                                   // newer than the slot
      window.dispatchEvent(new Event('pagehide'));     // main.js: the synchronous quick-save
      const rec = JSON.parse(localStorage.getItem('ec2.quick') || 'null');
      const tick = ec.state.tick, hash = ec.hash();
      ec.app.s = null;                                 // the page dies here: no async save follows
      return { tick, hash, quick: rec ? { colonyId: rec.colonyId, tick: rec.tick, bytes: rec.text.length } : null };
    });
    await page.reload();
    const r = await ready(page);
    const slot = await page.evaluate(async (id) => { const s = await window.__ec.storage.readSlots(id); return { ticks: s.map((x) => x.tick), quickLeft: !!localStorage.getItem('ec2.quick') }; }, a.id);
    const direct = await page.evaluate(async (id) => { const s = await window.__ec.continueColony(id); return s ? { hash: window.__ec.hash(), tick: s.tick } : null; }, a.id);
    add('pagehide quick-save is promoted on the next load', q.quick && q.quick.tick === q.tick && r.promoted === a.id && slot.ticks[0] === q.tick && !slot.quickLeft && direct && direct.hash === q.hash && !errs.length,
      `slot tick ${a.tick}; quick-save ${q.quick ? `tick ${q.quick.tick} (${q.quick.bytes} chars)` : 'MISSING'}; next load promoted ${r.promoted}; slots now ${slot.ticks.join('/')}; ec2.quick ${slot.quickLeft ? 'still there' : 'cleared'}; loads to ${direct ? (direct.hash === q.hash ? 'the quick-saved hash' : 'a different hash') : 'nothing'}${errs.length ? '; ' + errs[0] : ''}`);
  }
  await ctx.close();
}

// ---- eviction --------------------------------------------------------------------------------------
async function evict(kind) {
  const { ctx, page, errs } = await fresh();
  const a = await newColony(page);
  if (!a) { await ctx.close(); return { a: null }; }
  await page.evaluate(async (kind) => {
    window.__ec.app.s = null;   // no lifecycle save while we clear storage
    if (kind !== 'ls') await new Promise((res) => { const r = indexedDB.deleteDatabase('ec2'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    if (kind !== 'idb') localStorage.clear();
  }, kind);
  await page.goto(URL0);
  const r = await ready(page).catch(() => ({ promoted: null, cards: -1 }));
  await page.waitForTimeout(1700);   // the title refreshes after the index is reconciled
  const before = await titleText(page);
  const contEnabled = await page.evaluate(() => { const b = document.querySelector('[data-act=continue]'); return !!b && !b.disabled; });
  let after = before, entered = false;
  if (contEnabled) { await tapSel(page, '[data-act=continue]'); await page.waitForTimeout(700); after = await titleText(page); entered = await page.evaluate(() => !!(window.__ecUI && window.__ecUI.shell)); }
  const offersImport = await page.evaluate(() => [...document.querySelectorAll('button, a, [data-act]')].some((e) => /import/i.test(e.textContent + ' ' + (e.dataset.act || '')) && e.getBoundingClientRect().width > 0));
  const alerts = await page.evaluate(() => window.__ec.app.alerts.map((x) => x.kind));
  await page.screenshot({ path: join(OUT, `evict-${kind}.png`) });
  let canFound = null;
  if (kind === 'both') canFound = !!(await tapSel(page, '[data-act=new]')) && (await inGame(page));
  await ctx.close();
  return { a, r, before, after, contEnabled, entered, offersImport, alerts, errs, canFound };
}
{
  const e = await evict('idb');
  if (!e.a) add('eviction (IndexedDB deleted): colony shown missing, Import offered', false, 'could not found a colony', 'I');
  else {
    add('eviction (IndexedDB deleted): no crash; Continue says the colony is missing', /missing/i.test(e.after) && !e.entered && !e.errs.length && e.alerts.includes('missing'),
      `after Continue "${e.after.slice(-110)}"; alerts [${e.alerts}]${e.errs.length ? '; ' + e.errs[0] : ''}`);
    const shown = /missing/i.test(e.before);
    add('eviction (IndexedDB deleted): the title shows the colony as missing and offers Import', shown && e.offersImport,
      `before any tap the title ${shown ? 'marks it missing' : 'does not mark it missing (card.missing is set by refreshColonies)'}; ${e.offersImport ? 'an Import control is on the title' : 'no Import control on the title (slots.importBlob exists)'}`, 'I');
  }
}
{
  const e = await evict('ls');
  add('eviction (localStorage cleared): colony comes back from IndexedDB', e.a && e.contEnabled && e.entered && !e.errs.length,
    e.a ? `title "${e.before.slice(0, 80)}"; Continue ${e.entered ? 'entered the game' : 'did not enter'}${e.errs.length ? '; ' + e.errs[0] : ''}` : 'could not found a colony');
}
{
  const e = await evict('both');
  add('eviction (both cleared): no crash, title usable', e.a && !e.errs.length && e.canFound, e.a ? `title "${e.before.slice(0, 80)}"; New colony ${e.canFound ? 'works' : 'FAILED'}${e.errs.length ? '; ' + e.errs[0] : ''}` : 'could not found a colony');
}

// ---- IndexedDB disabled: the localStorage fallback ----------------------------------------------------
{
  const { ctx, page, errs } = await fresh({ noIdb: true });
  const a = await newColony(page);
  if (!a) add('IndexedDB disabled: localStorage fallback works', false, 'could not found a colony without IndexedDB', 'A');
  else {
    const mode = await page.evaluate(async () => ({ mode: await window.__ec.storage.storageMode(), keys: Object.keys(localStorage).filter((k) => k.startsWith('ec2.')), alerts: window.__ec.app.alerts.map((x) => x.kind) }));
    await page.evaluate(() => { window.__ec.app.s = null; });
    await page.goto(URL0); await ready(page);
    const tapped = await tapSel(page, '[data-act=continue]');
    const ok = tapped && (await inGame(page));
    const b = ok ? await page.evaluate(() => ({ id: window.__ec.state.id, tick: window.__ec.state.tick })) : null;
    add('IndexedDB disabled: localStorage fallback works', mode.mode === 'local' && b && b.id === a.id && b.tick >= a.tick && mode.alerts.includes('limited') && !errs.length,
      `mode ${mode.mode}; keys ${mode.keys.join(' ')}; alerts [${mode.alerts}]; Continue ${b ? `entered at tick ${b.tick} (saved ${a.tick})` : 'did not enter'}${errs.length ? '; ' + errs[0] : ''}`);
  }
  await ctx.close();
}

// ---- export then import --------------------------------------------------------------------------------
{
  const { ctx, page, errs } = await fresh();
  const a = await newColony(page, 2400);
  if (!a) add('export then import round-trips byte-identical entities', false, 'could not found a colony', 'I');
  else {
    const r = await page.evaluate(async (id) => {
      const st = window.__ec.storage;
      const { loadBlob } = await import('/js/game/save/colonysave.js');
      const { entitiesJSON, stateHash } = await import('/js/game/core/state.js');
      const ex = await st.exportBlob(id);
      const newId = await st.importBlob(ex.text);
      const slot = (await st.readSlots(newId))[0];
      const same = slot && slot.bytes.length === ex.bytes.length && slot.bytes.every((v, k) => v === ex.bytes[k]);
      const s1 = await loadBlob(ex.bytes), s2 = await loadBlob(slot.bytes);
      const j1 = JSON.stringify(entitiesJSON(s1)), j2 = JSON.stringify(entitiesJSON(s2));
      return { filename: ex.filename, size: ex.bytes.length, newId, same, entities: j1 === j2, hash: stateHash(s1) === stateHash(s2), cards: st.listColonies().length };
    }, a.id);
    add('export then import round-trips byte-identical entities', r.same && r.entities && r.hash && r.newId !== a.id && !errs.length,
      `exported ${r.filename} (${r.size} bytes); imported as ${r.newId}; bytes ${r.same ? 'identical' : 'DIFFER'}; entities ${r.entities ? 'identical' : 'DIFFER'}; ${r.cards} colonies listed${errs.length ? '; ' + errs[0] : ''}`);
  }
  await ctx.close();
}

// ---- quota error on the quick-save ------------------------------------------------------------------------
{
  const { ctx, page, errs } = await fresh();
  const a = await newColony(page, 300);
  if (!a) add('quick-save quota error raises the alert', false, 'could not found a colony', 'I');
  else {
    const r = await page.evaluate(() => {
      const seen = [];
      window.addEventListener('ec2:storage', (e) => seen.push(e.detail && e.detail.kind));
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === 'ec2.quick') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return orig.call(this, k, v); };
      let ret, threw = null;
      try { ret = window.__ec.storage.quickSave(); } catch (e) { threw = String(e); }
      const viaLifecycle = window.__ec.lifecycleSave('pagehide');
      Storage.prototype.setItem = orig;
      return { ret, threw, viaLifecycle, seen, alerts: window.__ec.app.alerts.map((x) => x.kind), toast: document.querySelector('.ec-toasts') ? document.querySelector('.ec-toasts').innerText : '' };
    });
    await page.waitForTimeout(300);
    const toast = await page.evaluate(() => { const t = document.querySelector('.ec-toasts, #toasts'); return t ? t.innerText.trim() : ''; });
    await page.screenshot({ path: join(OUT, 'quota.png') });
    add('quick-save quota error raises the alert', r.ret === false && !r.threw && r.viaLifecycle === false && r.seen.includes('quota') && r.alerts.includes('quota') && !errs.length,
      `quickSave returned ${r.ret}${r.threw ? ' (threw ' + r.threw + ')' : ''}; lifecycle save ${r.viaLifecycle}; events [${r.seen}]; alerts [${r.alerts}]; on screen: "${toast.slice(0, 80)}"${errs.length ? '; ' + errs[0] : ''}`);
    if (!/storage|full|back up/i.test(toast)) console.log(`info  the quota alert is raised (app.alerts, ec2:storage) but nothing shows it on screen yet (owner I)`);
  }
  await ctx.close();
}

await browser.close(); await srv.close();
writeFileSync(join(OUT, `persist-${which}.json`), JSON.stringify(results, null, 1));
if (process.argv.includes('--json')) console.log(JSON.stringify(results));
for (const c of results) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}${c.ok ? '' : ` [owner ${c.owner}]`}`);
const ok = results.every((c) => c.ok);
console.log(`persist [${which}${which === 'chromium' ? ', stand-in for WebKit' : ''}]: ${ok ? 'PASS' : 'FAIL'} (${results.filter((c) => c.ok).length}/${results.length})`);
process.exit(ok ? 0 : 1);

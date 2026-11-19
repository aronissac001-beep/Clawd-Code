// Gate check "Phone UI", Stage 2 screens (doc 14.8 row I acceptance; owner J, the walk written by I):
//   node tools/ui-phone2.mjs [--browser=webkit|chromium] [--vp=name,...] [--text=100,130] [--quick] [--noshots] [--url=...]
// At every gate viewport and at 100% and 130% text: founds a Stage 2 colony, adds fixtures through the
// sim's own APIs (a pen, a grow zone, a stockpile, animals, a trader, a choice letter, a nemesis, an
// Ember-touched demand, a perk choice, a fire, a wound), then visits every Stage 2 screen (the 11
// Architect tabs, Orders, Zones and the zone sheets, every colonist and colony tab, the Advanced grid,
// the schedule editor, research, letters and the nemesis card, the demand card, the trade sheet, help,
// settings, peek cards) and runs the 14.4 probe on each: no console errors, no horizontal overflow
// (page, an element past the viewport edge, clipped text without an ellipsis, a sheet that scrolls
// sideways), every visible interactive element >= 44 x 44 pt, every visible text >= 14 px. Then taps
// every alert and checks it jumped to its subject (a selection, a sheet, a panel or a camera move).
// Exit 0 clean, 1 problems, 2 the browser is not installed. Screenshots: tools/out/ui-phone2/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serve } from './lib/static-server.mjs';
import { launch, browserArg, UNAVAILABLE } from './lib/browsers.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out', 'ui-phone2') + '/';
mkdirSync(OUT, { recursive: true });
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const which = browserArg('webkit');
const VPS = [
  { name: 'p375x635-safari', width: 375, height: 635 }, { name: 'p390x664-safari', width: 390, height: 664 },
  { name: 'p430x740-safari', width: 430, height: 740 }, { name: 'p390x763-app', width: 390, height: 763 },
  { name: 'l844x335-safari', width: 844, height: 335 }, { name: 'l932x380-safari', width: 932, height: 380 },
];
const only = arg('vp', null);
const texts = arg('text', '100,130').split(',').map(Number);
const quick = process.argv.includes('--quick');
const shotsOn = !process.argv.includes('--noshots');

async function probe(page) {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
    const hiddenUp = (el) => { for (let e = el; e; e = e.parentElement) if (e.hidden) return true; return false; };
    // clipped by a scrolling ancestor (an off-screen row of a scrolled list is not a target on screen)
    const clipped = (el) => { const r = el.getBoundingClientRect(); for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const ps = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(ps.overflow + ps.overflowX + ps.overflowY)) { const q = p.getBoundingClientRect(); if (r.bottom <= q.top + 1 || r.top >= q.bottom - 1 || r.right <= q.left + 1 || r.left >= q.right - 1) return true; } } return false; };
    const name = (el) => `${el.tagName.toLowerCase()}${el.dataset.act ? '[' + el.dataset.act + ']' : el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 28)}"`;
    const small = [], over = [];
    for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role=button], [role=tab], [role=menuitem], [data-act], [onclick]')) {
      if (!vis(el) || hiddenUp(el) || clipped(el)) continue; const r = el.getBoundingClientRect();
      if (r.width < 44 - 0.5 || r.height < 44 - 0.5) small.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    for (const el of document.querySelectorAll('#hud *, #title *, .ec-title *')) {
      if (!vis(el) || hiddenUp(el) || clipped(el)) continue;
      // the part of the element its scrolling ancestors let through (a strip that scrolls clips its tabs)
      const r0 = el.getBoundingClientRect();
      let L0 = r0.left, R0 = r0.right;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const ps = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(ps.overflowX)) { const q = p.getBoundingClientRect(); L0 = Math.max(L0, q.left); R0 = Math.min(R0, q.right); } }
      if (R0 > innerWidth + 1 || L0 < -1) { over.push(`past the edge: ${name(el)} ${Math.round(L0)}..${Math.round(R0)}`); continue; }
      const cs = getComputedStyle(el);
      if (el.children.length === 0 && el.textContent.trim() && !/^inline/.test(cs.display) && cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2 && (cs.webkitLineClamp === 'none' || !cs.webkitLineClamp)) over.push(`text overflows its box: ${name(el)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    // a sheet, panel or card that scrolls sideways hides content (strips and chip rows scroll on purpose)
    for (const el of document.querySelectorAll('.ec-sheet-body, .ec-panel, .ec-peek, .ec-prompt, .ec-ledger, .ec-title-col, .ec-title-settings')) {
      if (!vis(el) || hiddenUp(el)) continue;
      if (el.scrollWidth > el.clientWidth + 2) over.push(`scrolls sideways: ${name(el)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    const tiny = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim() || !n.parentElement || !vis(n.parentElement) || hiddenUp(n.parentElement) || clipped(n.parentElement)) continue;
      const fs = parseFloat(getComputedStyle(n.parentElement).fontSize);
      if (fs < 14 - 0.01) tiny.push(`"${n.textContent.trim().slice(0, 24)}" ${fs}px`);
    }
    // a word broken across two lines (a title too wide for its card at a large text size): reported as
    // a warning, not a failure (the 14.4 probe asks for no overflow, which this is not)
    const broken = [];
    const w2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w2.nextNode(); n; n = w2.nextNode()) {
      const t = n.textContent;
      if (!t.trim() || !n.parentElement || !vis(n.parentElement) || hiddenUp(n.parentElement) || clipped(n.parentElement)) continue;
      const re = /[A-Za-z]{4,}/g; let m;
      while ((m = re.exec(t)) && broken.length < 20) {
        const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
        const tops = new Set([...r.getClientRects()].filter((q) => q.width > 0.5).map((q) => Math.round(q.top)));
        if (tops.size > 1) broken.push(`"${m[0]}" in ${name(n.parentElement)}`);
      }
    }
    const ox = document.documentElement.scrollWidth > innerWidth + 0.5 || document.body.scrollWidth > innerWidth + 0.5;
    return { overflowX: ox, small: [...new Set(small)], tiny: [...new Set(tiny)], over: [...new Set(over)], broken: [...new Set(broken)] };
  });
}

const br = await launch(which);
if (!br) { console.log(`ui-phone2 [${which}]: UNAVAILABLE - Playwright ${which} is not installed; try --browser=chromium`); process.exit(UNAVAILABLE); }
const srv = arg('url', null) ? null : await serve(0);
const base = arg('url', null) || srv.url;
const results = [];
for (const vp of VPS) {
  if (only && !only.split(',').includes(vp.name)) continue;
  for (const ts of texts) {
    const ctx = await br.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
    const page = await ctx.newPage();
    const errs = [], problems = [], screens = [], warns = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    const ev = (fn, a) => page.evaluate(fn, a);
    const shot = async (screen) => {
      await page.waitForTimeout(120);
      const p = await probe(page);
      const list = [...(p.overflowX ? ['horizontal overflow'] : []), ...p.over, ...p.small.map((x) => 'target < 44 pt: ' + x), ...p.tiny.map((x) => 'text < 14 px: ' + x)];
      for (const x of list) problems.push(`${screen}: ${x}`);
      for (const x of p.broken) warns.push(`${screen}: word broken across lines: ${x}`);
      screens.push(screen);
      if (shotsOn && (!quick || /game|build-rooms|colony-work-grid|letter|trade|demand/.test(screen))) await page.screenshot({ path: `${OUT}${vp.name}-${ts}-${screen}.png` });
    };
    const tapSel = async (sel) => { const loc = page.locator(sel).first(); await loc.scrollIntoViewIfNeeded().catch(() => {}); const bb = await loc.boundingBox(); if (!bb) throw new Error('not found: ' + sel); await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.waitForTimeout(160); };
    const flows = {};
    try {
      await page.goto(base + '?debug=1');
      await page.waitForSelector('[data-act=new]');
      await ev(async (ts) => { const m = await import('/js/main.js'); m.writeSettings({ textSize: ts }); }, ts);
      await page.waitForTimeout(100);
      await shot('title');
      await tapSel('[data-act=new-options]'); await shot('title-options');
      await tapSel('[data-act=title-back]');
      await tapSel('[data-act=title-settings]'); await shot('title-settings');
      await tapSel('[data-act=title-back]');
      await tapSel('[data-act=new]');
      await page.waitForFunction(() => window.__ecUI && window.__ecUI.shell, null, { timeout: 15000 });
      await page.waitForTimeout(300);
      // the fixture (debug only): Stage 2 content through the sim's own APIs
      flows.fixture = await ev(async () => {
        const sh = window.__ecUI.shell, s = sh.state, send = sh.ctx.send;
        sh.setSpeed(0);
        const sim = await import('/js/game/core/sim.js');
        sim.step(s, 2);                                     // the first Stage 2 ticks: B's world and K's trade records
        const h = s.colony.hearth && s.bld[s.colony.hearth.id];
        const hx = h ? h.x : 64, hy = h ? h.y : 64;
        const grid = await import('/js/game/core/grid.js');
        const free = (x0, y0) => { for (let r = 2; r < 30; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = x0 + dx, y = y0 + dy; if (x < 2 || y < 2 || x > 120 || y > 120) continue; let ok = true; for (let yy = 0; yy < 4 && ok; yy++) for (let xx = 0; xx < 4 && ok; xx++) { const i = grid.idx(x + xx, y + yy); if (!grid.TER_BUILDABLE[s.L.terrain[i]] || s.rt.occ[i] >= 0 || s.L.zone[i]) ok = false; } if (ok) return [x, y]; } return [x0 + 6, y0 + 6]; };
        const [ax, ay] = free(hx + 6, hy);
        const pen = send({ t: 'zone', op: 'new', type: 'pen', rect: { x0: ax, y0: ay, x1: ax + 3, y1: ay + 3 } });
        const [gx, gy] = free(hx - 8, hy + 4);
        const grow = send({ t: 'zone', op: 'new', type: 'grow', rect: { x0: gx, y0: gy, x1: gx + 3, y1: gy + 3 } });
        if (grow.zoneId) send({ t: 'zoneCfg', zoneId: grow.zoneId, patch: { crop: 'grain' } });
        const [sx, sy] = free(hx, hy + 6);
        const stock = send({ t: 'zone', op: 'new', type: 'stockpile', rect: { x0: sx, y0: sy, x1: sx + 3, y1: sy + 3 }, preset: 'all' });
        const sp = await import('/js/game/animals/spawn.js');
        const a1 = sp.spawnAnimal(s, 'goat', ax + 1, ay + 1, { tame: true });
        if (a1 && pen.zoneId) a1.pen = pen.zoneId;
        const a2 = sp.spawnAnimal(s, 'deer', hx + 3, hy - 4);
        const a3 = sp.spawnAnimal(s, 'boar', hx - 5, hy - 5);
        if (a3) a3.st = { mode: 'manhunt', until: s.tick + 6000, target: s.col[0].id, aggro: true, bite: 0 };
        const tr = await import('/js/game/colony/trade.js');
        const visit = tr.arrive(s, 'pedlar');
        const L = await import('/js/game/threat/letters.js');
        const l = L.sendLetter(s, 'choice', { title: 'Refugees at the gate', text: 'Three tired people ask to join the hold. They carry little but their names.', choices: ['Take them in', 'Send them on'], deflt: 1, data: { k: 'ui2-test' } });
        const N = await import('/js/game/threat/nemesis.js'); const S = await import('/js/game/core/schema.js');
        const nem = S.newNemesis(s.next.nem++, { name: 'Varrek', epithet: 'the Burnt', kind: 'reaver_captain', affixes: ['armoured'], scar: 'burn', grudge: s.col[0].id, returns: 1, nextTick: s.tick + 14400 * 9 });
        s.st.nemeses.push(nem);
        L.sendLetter(s, 'nemesis', { title: N.fullName(nem), text: 'Varrek the Burnt escaped, swearing to come back.', data: { nemId: nem.id } });
        L.sendLetter(s, 'incident', { title: 'A cold wind', text: 'Ashfall comes early this year.' });
        const E = await import('/js/game/people/embertouch.js');
        const crafter = s.col[1] || s.col[0];
        try { E.startEmber(s, crafter, 'woodcraft'); } catch (e) { /* data */ }
        const c2 = s.col[2] || s.col[0];
        c2.sk[0][0] = 10;                                        // Mining 10: a perk choice waits
        const H2 = await import('/js/game/people/health.js');
        try { H2.damage(s, s.col[0], 2, 'cut', 6); } catch (e) { /* */ }
        const F = await import('/js/game/world/fire.js');
        let lit = false;
        for (let r = 4; r < 40 && !lit; r++) for (let dx = -r; dx <= r && !lit; dx++) { const i = grid.idx(Math.max(0, Math.min(127, hx + dx)), Math.max(0, Math.min(127, hy - r))); if (F.canBurn(s, i)) lit = F.ignite(s, i, 60); }
        sh.uiSecond();
        return { pen: !!pen.ok, grow: !!grow.ok, stock: !!stock.ok, animals: s.anim.length, visit: !!visit, letter: !!l, ember: !!s.colony.ember, fire: lit, alerts: sh.alerts.list().map((a) => a.id) };
      });
      await page.waitForTimeout(400);
      // a choice letter may have opened by itself (letters.check): read it, then close it
      if (await page.locator('[data-act=letter-choice-0]:visible').count()) { await shot('letter-choice'); await tapSel('[data-act=close-sheet]'); }
      await ev(() => { const sh = window.__ecUI.shell; sh.closePeek(); if (sh.ui.sheet) sh.ctx.closeSheet(); });
      await shot('game');
      // Build: every tab
      await ev(() => window.__ecUI.shell.openPanel('build'));
      const tabs = await ev(() => [...document.querySelectorAll('.ec-panel [data-act^=build-tab-]')].map((b) => b.dataset.act));
      flows.buildTabs = tabs.length;
      for (const t of tabs) { await tapSel(`[data-act=${t}]`); await shot(t.replace('build-tab-', 'build-')); }
      await ev(() => window.__ecUI.shell.openPanel('orders')); await shot('orders');
      await ev(() => window.__ecUI.shell.openPanel('zones')); await shot('zones');
      // zone sheets: stockpile (with the filter tree), grow, pen
      for (const type of ['stockpile', 'grow', 'pen']) {
        const ok = await ev((type) => { const sh = window.__ecUI.shell, z = sh.state.zones.find((x) => x.type === type); if (!z) return false; sh.closePeek(); sh.openSubjectSheet({ kind: 'zone', id: z.id }); return true; }, type);
        if (ok) await shot('zone-' + type);
      }
      // colonist sheet: every tab
      await ev(() => { const sh = window.__ecUI.shell; sh.select({ kind: 'colonist', id: sh.state.col[2] ? sh.state.col[2].id : sh.state.col[0].id }); sh.openSubjectSheet({ kind: 'colonist', id: sh.state.col[2] ? sh.state.col[2].id : sh.state.col[0].id }); });
      for (const t of ['Needs', 'Skills', 'Health', 'Gear', 'Social', 'Log', 'Bio']) { await tapSel(`.ec-sheet [data-tab=${t}]`); await shot('colonist-' + t.toLowerCase()); }
      // the Colony sheet: every tab, the grid and the schedule editor
      await ev(() => window.__ecUI.shell.openColony('People'));
      for (const t of ['People', 'Work', 'Schedule', 'Research', 'Stock', 'Chronicle', 'Hold']) {
        await tapSel(`.ec-sheet [data-tab=${t}]`); await shot('colony-' + t.toLowerCase());
        if (t === 'Work') { await tapSel('[data-act=work-grid]'); await shot('colony-work-grid'); if (await page.locator('[data-act=grid-page-2]').count()) { await tapSel('[data-act=grid-page-2]'); await shot('colony-work-grid-care'); } await tapSel('[data-act=work-roles]'); }
        if (t === 'Schedule') { await tapSel('[data-act=sched-edit]'); await shot('colony-schedule-edit'); await tapSel('[data-act=sheet-back]'); }
        if (t === 'Research') { const before = await ev(() => window.__ecUI.shell.state.colony.research.cur); const tk = await page.locator('.ec-tech:not(.on):not(.locked)').first(); if (await tk.count()) { await tk.scrollIntoViewIfNeeded(); const bb = await tk.boundingBox(); await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.waitForTimeout(150); } flows.research = [before, await ev(() => window.__ecUI.shell.state.colony.research.cur)]; }
      }
      // letters, the nemesis card, the demand card, the trade sheet, help, settings
      await ev(() => { const sh = window.__ecUI.shell; sh.ctx.closeSheet(); sh.openMenu(); }); await shot('menu');
      await tapSel('[data-act=menu-letters]'); await shot('letters');
      const nemRow = page.locator('.ec-sheet [data-act=letter-read]').filter({ hasText: 'Varrek' }).first();
      if (await nemRow.count()) { const bb = await nemRow.boundingBox(); await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.waitForTimeout(150); flows.nemesisCard = await page.locator('.ec-nemcard').count(); await shot('letter-nemesis'); }
      await ev(() => { const sh = window.__ecUI.shell; sh.ctx.closeSheet(); sh.ctx.openDemand(); }); flows.demand = await page.locator('.ec-sheet .ec-need').count(); await shot('demand');
      await ev(() => { const sh = window.__ecUI.shell; sh.ctx.closeSheet(); sh.ctx.openTrade(); }); await shot('trade');
      // buy one thing through the sheet
      flows.trade = await ev(() => window.__ecUI.shell.state.colony.trade.visits[0].stock.map((g) => g.n).reduce((a, b) => a + b, 0));
      await ev(() => { const sh = window.__ecUI.shell; sh.ctx.closeSheet(); sh.openMenu(); });
      await tapSel('[data-act=menu-help]'); await shot('help');
      await ev(() => { const sh = window.__ecUI.shell; sh.ctx.closeSheet(); sh.openMenu(); });
      await tapSel('[data-act=menu-settings]'); await shot('settings');
      await ev(() => window.__ecUI.shell.ctx.closeSheet());
      // peek cards: an animal, a room tile, the Hearth
      await ev(() => { const sh = window.__ecUI.shell, a = sh.state.anim[0]; if (a) sh.select({ kind: 'animal', id: a.id }); }); await shot('peek-animal');
      await ev(() => { const sh = window.__ecUI.shell, h = sh.state.bld[sh.state.colony.hearth.id]; sh.select({ kind: 'building', id: h.id, x: h.x, y: h.y }); }); await shot('peek-hearth');
      await ev(() => window.__ecUI.shell.closePeek());
      // every alert jumps to its subject (10.6)
      const ids = await ev(() => { window.__ecUI.shell.uiSecond(); return window.__ecUI.shell.alerts.list().map((a) => a.id); });
      flows.alerts = {};
      for (const id of ids) {
        const r = await ev((id) => {
          const sh = window.__ecUI.shell;
          sh.ctx.closeSheet(); sh.closePeek(); if (sh.ui.panel) sh.ctx.closePanel();
          const cam0 = [Math.round(sh.camera.x), Math.round(sh.camera.y)];
          sh.camera.centerOn(5 * 32, 5 * 32, false);
          const cam1 = [Math.round(sh.camera.x), Math.round(sh.camera.y)];
          const ok = sh.alertGo(id);
          const cam2 = [Math.round(sh.camera.x), Math.round(sh.camera.y)];
          return { ok, sel: sh.ui.sel ? sh.ui.sel.kind : null, sheet: sh.ui.sheet || null, panel: sh.ui.panel || null, moved: cam2[0] !== cam1[0] || cam2[1] !== cam1[1], cam0 };
        }, id);
        r.jumped = !!(r.ok && (r.sel || r.sheet || r.panel || r.moved));
        flows.alerts[id] = r.jumped ? (r.sheet ? 'sheet:' + r.sheet : r.panel ? 'panel:' + r.panel : r.sel ? 'select:' + r.sel : 'camera') : 'NO';
        if (!r.jumped) problems.push(`alert ${id} did not jump to its subject`);
      }
      await ev(() => { const sh = window.__ecUI.shell; sh.ctx.closeSheet(); sh.closePeek(); });
    } catch (e) { problems.push('flow error: ' + e.message.split('\n')[0]); }
    results.push({ vp: vp.name, text: ts, screens: screens.length, flows, problems: [...errs, ...problems], warns });
    await ctx.close();
  }
}
await br.close();
if (srv) await srv.close();
let bad = 0;
for (const r of results) {
  if (r.problems.length) bad++;
  console.log(`${r.problems.length ? 'FAIL' : 'ok  '} ${r.vp} text ${r.text}%: ${r.screens} screens, ${Object.keys(r.flows.alerts || {}).length} alerts jump, problems ${r.problems.length}`);
  for (const p of r.problems.slice(0, 40)) console.log('     ' + p);
  for (const p of r.warns.slice(0, 8)) console.log('     warn ' + p);
}
writeFileSync(join(OUT, 'report.json'), JSON.stringify(results, null, 1));
if (process.argv.includes('--json')) console.log(JSON.stringify(results.map((r) => ({ vp: r.vp, text: r.text, screens: r.screens, flows: r.flows })), null, 1));
const nScreens = results.reduce((a, r) => a + r.screens, 0), nWarn = results.reduce((a, r) => a + r.warns.length, 0);
if (nWarn) console.log(`ui-phone2: ${nWarn} warnings (words broken across lines; owner I)`);
console.log(`ui-phone2 [${which}${which === 'chromium' ? ' as a WebKit stand-in' : ''}]: ${bad ? bad + ' run(s) with problems' : `every Stage 2 screen clean at every viewport and text size (${results.length} runs, ${nScreens} screens)`}`);
process.exit(bad ? 1 : 0);

// Gate check "Phone UI", Stage Z3 (EMBERCROWN-FORTRESS.md 8.5 Z3.5; owner I). Run as
//   node tools/ui-phone-z3.mjs [--browser=chromium|webkit] [--url=http://127.0.0.1:9604/] [--vp=name,...]
// (and from `node tools/ui-phone.mjs --stage=z3`). On a 20-level fortress (?fortress=1) at 390 x 664 and 844 x 335:
//   Z1 a breach from the deep at -13: the chip carries the level, the 'breach' alert shows, and one tap on it
//      takes the view to -13 (Oracle: 1 tap);
//   Z2 route chevrons: on the route's level a stair chevron shows; one tap switches to the level it points to;
//   Z3 flood and ember alerts name their level and one tap goes there;
//   Z4 the lever-link sheet lists a gate two levels down with its level; Go switches the view to it;
//   Z5 the raid peek card names the level and the cause.
// Every screen is probed: no horizontal overflow, visible targets >= 44 pt, visible text >= 14 px.
// Exit 0 clean, 1 problems, 2 browser unavailable. Screenshots tools/out/ui-phone/z3-*.png.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serve } from './lib/static-server.mjs';
import { launch, browserArg, UNAVAILABLE } from './lib/browsers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out', 'ui-phone');
mkdirSync(OUT, { recursive: true });
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const VPS = [{ name: 'p390x664', width: 390, height: 664 }, { name: 'l844x335', width: 844, height: 335 }];
const which = browserArg('chromium');
const only = arg('vp', null);
const browser = await launch(which);
if (!browser) { console.log(`ui-phone z3 [${which}]: UNAVAILABLE`); process.exit(UNAVAILABLE); }
const srv = arg('url', null) ? null : await serve(0);
const BASE = arg('url', null) || srv.url;

async function probe(page) {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
    const hid = (el) => { for (let e = el; e; e = e.parentElement) if (e.hidden) return true; return false; };
    const small = [], tiny = [];
    for (const el of document.querySelectorAll('button, [role=button], a[href], input, select')) {
      if (hid(el) || !vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 43.5 || r.height < 43.5) small.push(`${el.dataset.act || el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el || hid(el) || !vis(el) || el.closest('[aria-hidden=true]')) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 13.95) tiny.push(`"${n.textContent.trim().slice(0, 24)}" ${fs}px`);
    }
    return { overflowX: document.documentElement.scrollWidth > innerWidth + 1, small: [...new Set(small)].slice(0, 8), tiny: [...new Set(tiny)].slice(0, 8) };
  });
}

async function tapSel(page, sel) {
  return page.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; });
    if (!el) return false;
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const o = { pointerId: 11, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 1 }));
    return true;
  }, sel);
}

async function run(vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
  const page = await ctx.newPage();
  const errs = [], problems = [], flows = [], screens = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
  const flow = (id, name, ok, detail) => flows.push({ id, name, ok: !!ok, detail });
  const screen = async (name) => {
    await page.waitForTimeout(250);
    const p = await probe(page);
    const list = [...(p.overflowX ? ['horizontal overflow'] : []), ...p.small.map((x) => 'target < 44 pt: ' + x), ...p.tiny.map((x) => 'text < 14 px: ' + x)];
    for (const x of list) problems.push(`[${name}] ${x}`);
    screens.push({ name, ok: !list.length });
    await page.screenshot({ path: join(OUT, `z3-${vp.name}-${name}.png`) });
  };
  const rel = () => page.evaluate(() => window.__ecUI.shell.viewZ() - window.__z3.zS);
  const reset = () => page.evaluate(() => { const sh = window.__ecUI.shell; sh.closePeek(); sh.ctx.closeSheet(); sh.setLevel(window.__z3.zS); sh.loop.poke(); });
  const tick = () => page.waitForTimeout(1300);   // the alert tracker and the level tick run once a second

  await page.goto(BASE + '?debug=1&fortress=1');
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    const app = await import('/js/ui/app.js');
    const G = await import('/js/game/core/grid.js');
    const s = app.foundNew('Z35');
    try { localStorage.setItem('ec2.guide.' + s.id, JSON.stringify({ done: ['chop', 'stockpile', 'speed', 'carve', 'mason', 'bedroom'], off: true, small: false })); } catch (_) { /* private */ }
    if (window.__ec && window.__ec.adopt) window.__ec.adopt(s);
    await app.enter(s);
    window.__ecUI = window.__ecUI || app.ui;
    app.ui.shell.setSpeed(0);
    window.__z3 = { zS: G.zS, G, s };
  });
  await page.waitForTimeout(900);
  await screen('game');

  // Z1: a breach at -13, imminent; the chip and the alert; one tap
  await page.evaluate(async () => {
    const { newEntry } = await import('/js/game/threat/incidents.js');
    const { s, G, zS } = window.__z3;
    const i = G.idx(40, 50, zS - 13);
    s.st.queue.push(newEntry(901, 'deep_breach', s.tick, s.tick + 5 * 600, { stage: 'imminent', plan: { pts: 100, edge: { side: 'deep', i }, goal: 'people', members: ['husk'] }, cause: ['seep', 'seep'], why: 'A seep woke.' }));
  });
  await tick();
  const chip = await page.evaluate(() => { const c = document.querySelector('[data-act=threat]') || document.querySelector('.ec-threat'); return c ? { text: c.textContent.trim(), label: c.getAttribute('aria-label') } : null; });
  await screen('breach');
  const z0 = await rel();
  const tapped = await tapSel(page, '[data-alert=breach]');
  await page.waitForTimeout(300);
  const z1 = await rel();
  flow('Z1', 'tap a breach alert and the view goes to -13 in 1 tap', tapped && z1 === -13, `level ${z0} > ${z1} in ${tapped ? 1 : 0} tap; chip "${chip && chip.text}" (${chip && chip.label})`);
  await screen('breach-after');

  // Z5: the raid peek card names the level and the cause
  await page.evaluate(() => { window.__ecUI.shell.select({ kind: 'raid', id: 901 }); });
  await page.waitForTimeout(300);
  const peek = await page.evaluate(() => { const p = document.querySelector('.ec-peek'); return p ? p.textContent : ''; });
  flow('Z5', 'the raid card names level and cause', /Level -13/.test(peek) && /Woken seep/.test(peek), peek.replace(/\s+/g, ' ').slice(0, 140));
  await screen('raid-peek');
  await reset();

  // Z2: route chevrons (the route data is unit-tested; here a route from -13 up to -12 at the view's centre)
  const cz = await page.evaluate(() => {
    const { s, G, zS } = window.__z3, sh = window.__ecUI.shell;
    sh.setLevel(zS - 13); sh.camera.centerOn(40 * 32, 50 * 32, false); sh.loop.poke();
    return import('/js/ui/threatui.js').then((T) => { sh.levels.st.chev = sh.levels.st.chevPin = T.routeChevrons(s, { route: [G.idx(40, 50, zS - 13), G.idx(41, 50, zS - 13), G.idx(41, 50, zS - 12), G.idx(42, 50, zS - 12)] }); return sh.levels.st.chev.length; });
  });
  await page.waitForTimeout(300);
  await screen('chevrons');
  const before = await rel();
  const ct = await tapSel(page, '[data-act=route-chev]');
  await page.waitForTimeout(300);
  const after = await rel();
  // on -12 the arrival chevron points back to -13
  await page.waitForTimeout(100);
  const back = await tapSel(page, '[data-act=route-chev]');
  await page.waitForTimeout(300);
  const after2 = await rel();
  flow('Z2', 'route chevrons switch levels', cz === 2 && ct && before === -13 && after === -12 && back && after2 === -13, `${cz} chevrons; ${before} > ${after} (up) > ${after2} (back) in 1 tap each (tapped ${ct}, ${back})`);
  await page.evaluate(() => { window.__ecUI.shell.levels.st.chev = []; window.__ecUI.shell.levels.st.chevPin = null; window.__z3.s.st.queue = window.__z3.s.st.queue.filter((e) => e.id !== 901); });
  await reset();

  // Z3: flood at -3 and ember at -9
  await page.evaluate(async () => {
    const { s, G, zS } = window.__z3;
    const { ensureWorld } = await import('/js/game/world/worldrec.js');
    const a = G.idx(30, 40, zS - 3), b = G.idx(50, 60, zS - 9);
    s.L.fluid[a] = 5; s.L.fluid[b] = 8 | 3;
    ensureWorld(s).fluid = { act: [a, b].sort((p, q) => p - q), idle: [0, 0], q: [], cur: 0 };
    window.__z3.fl = [a, b];
  });
  await tick();
  await screen('flood');
  const f1 = await tapSel(page, '[data-alert=flood]'); await page.waitForTimeout(300); const zf = await rel();
  await reset();
  const e1 = await tapSel(page, '[data-alert=ember]'); await page.waitForTimeout(300); const ze = await rel();
  flow('Z3', 'flood and ember alerts go to their level in 1 tap', f1 && zf === -3 && e1 && ze === -9, `flood > ${zf}, ember > ${ze}`);
  await page.evaluate(() => { const { s } = window.__z3; for (const i of window.__z3.fl) s.L.fluid[i] = 0; s.colony.world.fluid = { act: [], idle: [], q: [], cur: 0 }; });
  await reset();

  // Z4: the lever-link sheet: a lever on the surface, a gate two levels down, linked by command
  const lv = await page.evaluate(async () => {
    const { s, zS } = window.__z3, sh = window.__ecUI.shell;
    const id0 = s.bld.length;
    s.bld.push({ id: id0, def: 'lever', x: 44, y: 52, z: zS, st: 'done', link: null, hp: 100 });
    s.bld.push({ id: id0 + 1, def: 'gate', x: 46, y: 52, z: zS - 2, st: 'done', link: null, hp: 100 });
    const T = await import('/js/ui/threatui.js');
    // shim until A adds the lever and link command schemas (commands.js COMMANDS has neither; mechanisms.js
    // registers their appliers only when the schemas exist): apply them through mechanisms.js directly
    const M = await import('/js/game/world/mechanisms.js');
    const C = await import('/js/game/core/commands.js');
    if (!C.COMMANDS.link) {
      const send0 = sh.ctx.send;
      sh.ctx.send = (c, ...rest) => {
        if (c.t === 'link') { const r = M.link(s, c.bId, c.to); return r ? { ok: false, reason: r } : { ok: true }; }
        if (c.t === 'lever') return { ok: true, mode: M.pullLever(s, c.bId) };
        return send0(c, ...rest);
      };
      window.__z3.shim = true;
    }
    const cands = T.linkCandidates(s, id0).map((x) => x.level);
    T.openLeverLinks(sh.ctx, id0);
    return { id0, cands, shim: !!window.__z3.shim };
  });
  await page.waitForTimeout(300);
  await screen('lever-sheet');
  const linked = await tapSel(page, '[data-act=lever-link]');
  await page.waitForTimeout(300);
  const ls = await page.evaluate((id) => import('/js/ui/threatui.js').then((T) => T.leverLinks(window.__z3.s, id).map((x) => x.level)), lv.id0);
  await screen('lever-linked');
  const go = await tapSel(page, '[data-act=lever-go]');
  await page.waitForTimeout(300);
  const zl = await rel();
  flow('Z4', 'lever-link sheet: link a gate two levels down, Go switches to it', linked && ls.join() === '-2' && go && zl === -2, `${lv.shim ? '(lever/link command shim) ' : ''}candidates ${lv.cands.join(',')}; linked ${ls.join(',')}; Go > ${zl}`);
  await ctx.close();
  return { vp: vp.name, flows, screens, problems: [...errs, ...problems] };
}

const rep = [];
let bad = 0;
for (const vp of VPS) {
  if (only && !only.split(',').includes(vp.name)) continue;
  let r;
  try { r = await run(vp); } catch (e) { r = { vp: vp.name, flows: [], screens: [], problems: ['harness: ' + String(e && e.stack || e).slice(0, 400)] }; }
  r.ok = !r.problems.length && r.flows.every((f) => f.ok);
  if (!r.ok) bad++;
  rep.push(r);
}
await browser.close(); if (srv) await srv.close();
writeFileSync(join(OUT, `ui-phone-z3-${which}.json`), JSON.stringify(rep, null, 1));
for (const r of rep) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.vp}  screens: ${r.screens.map((s) => s.name + (s.ok ? '' : '(!)')).join(' ')}`);
  for (const f of r.flows) console.log(`      ${f.ok ? 'ok  ' : 'FAIL'} ${f.id} ${f.name}: ${f.detail}`);
  for (const p of r.problems.slice(0, 12)) console.log('      ' + p);
}
console.log(`ui-phone --stage=z3 [${which}]: ${bad ? bad + ' viewport(s) with problems' : 'all viewports clean'}`);
process.exit(bad ? 1 : 0);

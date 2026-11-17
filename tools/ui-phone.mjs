// Gate check "Phone UI" (doc 14.4, enforced from Stage 1a; owner J; the flows are I's 14.6 acceptance).
//   node tools/ui-phone.mjs [--browser=webkit|chromium] [--vp=name,...] [--flows=title|all] [--json]
// Playwright with touch emulation (hasTouch, deviceScaleFactor 2), at every gate viewport:
//   portrait 375 x 635, 390 x 664, 430 x 740 (Safari), 390 x 763 (Home Screen app);
//   landscape 844 x 335, 932 x 380 (Safari).
// Every screen visited (title, game, peek card, Build, Orders, Zones, Colony and Menu sheets) is checked
// for: no console errors or failed requests; no horizontal overflow; every visible interactive element
// >= 44 x 44 pt; every visible text node >= 14 px computed. Screenshots: tools/out/ui-phone/<vp>-<screen>.png.
// The Stage 1a flows (14.6 row I), state read through window.__ec (?debug=1):
//   1 title > New colony > game in < 3 s
//   2 Carve hall 9 x 9 (Orders > Carve hall, one drag) creates mine designations and a pillar plan
//   3 Bedroom stamp 5 x 4 (Build > Bedroom, one drag) creates blueprints for walls, door, floor and bed
//     in <= 5 taps (a drag counts as one)
//   4 speed: a tap pauses; a hold opens the fan and sliding to 3x selects 3x
//   5 reload > Continue restores the colony (same id, buildings and colonists; tick not older than the save)
//   6 world height at 390 x 664: >= 480 pt with nothing selected, >= 400 pt with a peek card
// --flows=title runs the Stage 0 title check only. Exit 0 pass, 1 fail, 2 browser unavailable.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serve } from './lib/static-server.mjs';
import { launch, browserArg, UNAVAILABLE } from './lib/browsers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out', 'ui-phone');
mkdirSync(OUT, { recursive: true });
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
export const VIEWPORTS = [
  { name: 'p375x635-safari', width: 375, height: 635 }, { name: 'p390x664-safari', width: 390, height: 664 },
  { name: 'p430x740-safari', width: 430, height: 740 }, { name: 'p390x763-app', width: 390, height: 763 },
  { name: 'l844x335-safari', width: 844, height: 335 }, { name: 'l932x380-safari', width: 932, height: 380 },
];
const WORLD_MIN = { vp: 'p390x664-safari', none: 480, peek: 400 };

const which = browserArg('webkit');
const flowsArg = arg('flows', 'all');
const only = arg('vp', null);
const browser = await launch(which);
if (!browser) { console.log(`ui-phone [${which}]: UNAVAILABLE - Playwright ${which} is not installed; try --browser=chromium`); process.exit(UNAVAILABLE); }
const srv = await serve(0);

// ---- page helpers ----------------------------------------------------------------------------------
/** The generic checks of 14.4 on whatever is on screen now. */
async function probe(page) {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
    const hiddenUp = (el) => { for (let e = el; e; e = e.parentElement) if (e.hidden) return true; return false; };
    const small = [];
    for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role=button], [role=tab], [role=menuitem], [data-act], [onclick]')) {
      if (!vis(el) || hiddenUp(el)) continue; const r = el.getBoundingClientRect();
      if (r.width < 44 - 0.5 || r.height < 44 - 0.5) small.push(`${el.tagName.toLowerCase()}${el.dataset.act ? '[' + el.dataset.act + ']' : ''} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    const tiny = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim() || !n.parentElement || !vis(n.parentElement) || hiddenUp(n.parentElement)) continue;
      const fs = parseFloat(getComputedStyle(n.parentElement).fontSize);
      if (fs < 14 - 0.01) tiny.push(`"${n.textContent.trim().slice(0, 24)}" ${fs}px`);
    }
    return { overflowX: document.documentElement.scrollWidth > innerWidth + 0.5 || document.body.scrollWidth > innerWidth + 0.5, small: [...new Set(small)], tiny: [...new Set(tiny)] };
  });
}
/** Centre of the first visible element matching `sel` (optionally whose text matches `text`). */
async function find(page, sel, text = null) {
  return page.evaluate(([sel, text]) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const hiddenUp = (el) => { for (let e = el; e; e = e.parentElement) if (e.hidden) return true; return false; };
    const re = text ? new RegExp(text, 'i') : null;
    for (const el of document.querySelectorAll(sel)) {
      if (!vis(el) || hiddenUp(el)) continue;
      if (re && !re.test((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || ''))) continue;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, locked: el.getAttribute('aria-disabled') === 'true' || el.disabled || el.classList.contains('locked'), text: (el.textContent || '').trim().slice(0, 40), act: el.dataset.act || null };
    }
    return null;
  }, [sel, text]);
}
/** One touch tap at (x, y): pointer events of type touch through the page (works in WebKit and Chromium). */
async function tapAt(page, x, y) {
  await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return;
    const o = { pointerId: 11, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 1 }));
  }, [x, y]);
  await page.waitForTimeout(120);
}
async function tap(page, sel, text = null) { const p = await find(page, sel, text); if (!p) return null; await tapAt(page, p.x, p.y); return p; }
/** A one-finger drag on the world canvas between two screen points, in `steps` frames. */
async function dragWorld(page, a, b, steps = 12) {
  await page.evaluate(async ([a, b, steps]) => {
    const cv = document.getElementById('view');
    const ev = (type, p, buttons) => cv.dispatchEvent(new PointerEvent(type, { pointerId: 21, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, buttons }));
    const frame = () => new Promise(requestAnimationFrame);
    ev('pointerdown', a, 1); await frame(); await frame();
    for (let k = 1; k <= steps; k++) { ev('pointermove', { x: a.x + (b.x - a.x) * k / steps, y: a.y + (b.y - a.y) * k / steps }, 1); await frame(); }
    await frame();
    ev('pointerup', b, 0); await frame(); await frame();
  }, [a, b, steps]);
  await page.waitForTimeout(150);
}
/** Screen point of a tile centre (centres the camera on `focus` first when given). */
async function tileScreen(page, x, y) {
  return page.evaluate(([x, y]) => { const sh = window.__ecUI.shell; return sh.worldToScreen((x + 0.5) * 32, (y + 0.5) * 32); }, [x, y]);
}
async function focusTiles(page, r, zoom = 1) {
  await page.evaluate(([r, zoom]) => { const sh = window.__ecUI.shell; sh.camera.setZoom(zoom); sh.camera.centerOn(((r.x0 + r.x1 + 1) / 2) * 32, ((r.y0 + r.y1 + 1) / 2) * 32, false); sh.loop.poke(); }, [r, zoom]);
  await page.waitForTimeout(200);
}
/** After a drag: tap a confirm-like button if one is showing (counts as a tap). */
async function confirmIfAsked(page) {
  const p = await find(page, '.ec-toolbar button, .ec-sheet button, .ec-panel button, [data-act]', '^\\s*(place|build|confirm|apply|ok|stamp|carve|done)\\b');
  if (!p || p.locked) return 0;
  await tapAt(page, p.x, p.y); return 1;
}
const stateOf = (page, fn) => page.evaluate(fn);

// ---- one viewport ------------------------------------------------------------------------------------
async function runViewport(vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('requestfailed', (r) => errs.push('failed: ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()}: ${r.url()}`); });
  const problems = [], flows = [], screens = [];
  const screen = async (name) => {
    await page.waitForTimeout(250);
    const p = await probe(page);
    const list = [...(p.overflowX ? ['horizontal overflow'] : []), ...p.small.map((x) => 'target < 44 pt: ' + x), ...p.tiny.map((x) => 'text < 14 px: ' + x)];
    for (const x of list) problems.push(`[${name}] ${x}`);
    screens.push({ name, ok: !list.length, n: list.length });
    await page.screenshot({ path: join(OUT, `${vp.name}-${name}.png`) });
  };
  const flow = (id, name, ok, detail, owner = 'I') => flows.push({ id, name, ok: !!ok, detail, owner });

  await page.goto(srv.url + '?debug=1');
  await page.waitForTimeout(900);
  await screen('title');
  if (flowsArg === 'title') { await ctx.close(); return { vp: vp.name, flows, screens, problems: [...errs, ...problems] }; }

  // 1: title > New colony > game in < 3 s
  const t0 = Date.now();
  const newBtn = await tap(page, '[data-act=new]');
  let inGame = false;
  if (newBtn) {
    try { await page.waitForFunction(() => window.__ecUI && window.__ecUI.shell && window.__ecUI.shell.renderer && window.__ecUI.shell.renderer.frames > 1, null, { timeout: 8000 }); inGame = true; } catch (_) { /* timed out */ }
  }
  const tNew = Date.now() - t0;
  flow(1, 'title > New colony > game < 3 s', inGame && tNew < 3000, newBtn ? `${inGame ? 'in game' : 'no game'} after ${tNew} ms` : 'no New colony button');
  if (!inGame) { await ctx.close(); return { vp: vp.name, flows, screens, problems: [...errs, ...problems] }; }
  // pause the sim for the checks (the flows read state; speed is UI state)
  await page.evaluate(() => { const sh = window.__ecUI.shell; sh.ui.speed = 1; });
  await screen('game');

  // 6a: world height, nothing selected
  const worldH = async () => page.evaluate(() => { const m = window.__ecUI.shell.metrics(); return m.world ? Math.round(m.world.height) : 0; });
  const hNone = await worldH();

  // 4: speed: tap pauses; hold > slide to 3x
  const sp0 = await stateOf(page, () => window.__ecUI.shell.ui.speed);
  const spBtn = await tap(page, '[data-act=speed]');
  const sp1 = await stateOf(page, () => window.__ecUI.shell.ui.speed);
  let sp3 = null;
  if (spBtn) {
    sp3 = await page.evaluate(async () => {
      const b = document.querySelector('[data-act=speed]'), r = b.getBoundingClientRect();
      const o = (x, y, buttons) => ({ pointerId: 31, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons });
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      b.dispatchEvent(new PointerEvent('pointerdown', o(cx, cy, 1)));
      await new Promise((res) => setTimeout(res, 900));
      const t = document.querySelector('.ec-fan-btn[data-speed="3"]');
      if (!t || t.closest('[hidden]')) { b.dispatchEvent(new PointerEvent('pointerup', o(cx, cy, 0))); return { fan: false, speed: window.__ecUI.shell.ui.speed }; }
      const q = t.getBoundingClientRect(), tx = q.left + q.width / 2, ty = q.top + q.height / 2;
      for (let k = 1; k <= 6; k++) { b.dispatchEvent(new PointerEvent('pointermove', o(cx + (tx - cx) * k / 6, cy + (ty - cy) * k / 6, 1))); await new Promise(requestAnimationFrame); }
      b.dispatchEvent(new PointerEvent('pointerup', o(tx, ty, 0)));
      await new Promise((res) => setTimeout(res, 100));
      return { fan: true, speed: window.__ecUI.shell.ui.speed };
    });
  }
  flow(4, 'speed: tap pauses, hold fan selects 3x', spBtn && sp0 > 0 && sp1 === 0 && sp3 && sp3.fan && sp3.speed === 3, spBtn ? `speed ${sp0} > tap > ${sp1}; hold: fan ${sp3 && sp3.fan ? 'opened' : 'did not open'}, speed ${sp3 && sp3.speed}` : 'no speed button');
  // keep the sim paused from here: the flows compare state
  await page.evaluate(() => { const sh = window.__ecUI.shell; sh.ui.speed = 0; sh.loop.timeScale = 0; });

  // peek card: tap the first colonist on the rail
  const rail = await tap(page, '[data-act=colonist]');
  await page.waitForTimeout(250);
  const peekOpen = await page.evaluate(() => { const p = document.querySelector('.ec-peek'); return !!p && !p.hidden; });
  const hPeek = peekOpen ? await worldH() : null;
  if (peekOpen) await screen('peek');
  if (vp.name === WORLD_MIN.vp) flow(6, 'world height at 390 x 664', hNone >= WORLD_MIN.none && peekOpen && hPeek >= WORLD_MIN.peek, `nothing selected ${hNone} pt (>= ${WORLD_MIN.none}); with a peek card ${peekOpen ? hPeek + ' pt' : 'no peek card opened'} (>= ${WORLD_MIN.peek})${rail ? '' : '; no colonist on the rail'}`);
  await page.evaluate(() => { const sh = window.__ecUI.shell; if (sh.closePeek) sh.closePeek(); });

  // the menus: Build, Orders, Zones panels, the Colony sheet and the Menu sheet
  for (const tab of ['build', 'orders', 'zones', 'colony']) {
    const t = await tap(page, `[data-act=tab][data-tab=${tab}]`);
    if (!t) { problems.push(`[${tab}] no ${tab} tab`); continue; }
    await screen(tab);
    await tap(page, '[data-act=close], [data-act=close-sheet]');
    await page.evaluate(() => { const sh = window.__ecUI.shell; if (sh.togglePanel && sh.ui.panel) sh.togglePanel(sh.ui.panel); });
  }
  if (await tap(page, '[data-act=menu]')) { await screen('menu'); await tap(page, '[data-act=close-sheet], [data-act=close]'); }

  // 2: Carve hall 9 x 9 over rock near the Hearth
  const rock = await page.evaluate(() => {
    const s = window.__ec.state, W = s.w, H = s.h, ROCK = 9;
    const hb = s.bld[s.colony.hearth.id], hx = hb.x + 1, hy = hb.y + 1;
    let best = null, bd = 1e9;
    for (let y = 2; y < H - 11; y++) for (let x = 2; x < W - 11; x++) {
      const d = Math.abs(x + 4 - hx) + Math.abs(y + 4 - hy); if (d >= bd) continue;
      let ok = true; for (let yy = y; yy < y + 9 && ok; yy++) for (let xx = x; xx < x + 9 && ok; xx++) if (s.L.terrain[yy * W + xx] !== ROCK || s.L.desig[yy * W + xx] & 1) ok = false;
      if (ok) { bd = d; best = { x0: x, y0: y, x1: x + 8, y1: y + 8 }; }
    }
    return best;
  });
  {
    let taps = 0, detail = '';
    const before = await stateOf(page, () => { const s = window.__ec.state; let m = 0; for (const v of s.L.desig) if (v & 1) m++; return { plans: s.colony.plans.length, mine: m }; });
    const o = await tap(page, '[data-act=tab][data-tab=orders]'); if (o) taps++;
    const c = await find(page, '[data-act=order-carve], .ec-card', 'carve');
    if (!rock) detail = 'no 9 x 9 rock area found';
    else if (!c) detail = 'no Carve hall card in Orders';
    else if (c.locked) detail = `Carve hall card is locked ("${c.text}")`;
    else {
      await tapAt(page, c.x, c.y); taps++;
      await focusTiles(page, rock, 0.9);
      await dragWorld(page, await tileScreen(page, rock.x0, rock.y0), await tileScreen(page, rock.x1, rock.y1)); taps++;
      taps += await confirmIfAsked(page);
      const after = await stateOf(page, () => { const s = window.__ec.state; let m = 0; for (const v of s.L.desig) if (v & 1) m++; const p = s.colony.plans[s.colony.plans.length - 1]; return { plans: s.colony.plans.length, mine: m, last: p ? { kind: p.kind, rect: p.rect, pillars: p.pillars.length } : null }; });
      const okc = after.plans > before.plans && after.mine > before.mine && after.last && after.last.kind === 'carve';
      detail = `${taps} taps; mine designations ${before.mine} > ${after.mine}; plans ${before.plans} > ${after.plans}${after.last ? ` (last: ${after.last.kind} ${JSON.stringify(after.last.rect)}, ${after.last.pillars} pillars)` : ''}`;
      await screen('carve');
      flow(2, 'Carve hall 9 x 9: mine designations and a pillar plan', okc, detail);
    }
    if (!flows.some((f) => f.id === 2)) flow(2, 'Carve hall 9 x 9: mine designations and a pillar plan', false, detail);
    await page.evaluate(() => { const sh = window.__ecUI.shell; if (sh.endTool) sh.endTool(); if (sh.ui.panel && sh.togglePanel) sh.togglePanel(sh.ui.panel); });
  }

  // 3: Bedroom stamp 5 x 4 on open ground near the Hearth, in <= 5 taps
  const site = await page.evaluate(() => {
    const s = window.__ec.state, W = s.w, H = s.h;
    const BUILD = [0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0];
    const hb = s.bld[s.colony.hearth.id], hx = hb.x + 1, hy = hb.y + 1;
    let best = null, bd = 1e9;
    for (let y = 3; y < H - 8; y++) for (let x = 3; x < W - 9; x++) {
      const d = Math.abs(x + 2 - hx) + Math.abs(y + 2 - hy); if (d >= bd || d < 6) continue;
      let ok = true;
      for (let yy = y - 1; yy < y + 5 && ok; yy++) for (let xx = x - 1; xx < x + 6 && ok; xx++) { const i = yy * W + xx; if (!BUILD[s.L.terrain[i]] || s.rt.occ[i] >= 0 || s.L.plant[i] || s.L.zone[i] || !(s.L.fog[i >> 3] & (1 << (i & 7)))) ok = false; }
      if (ok) { bd = d; best = { x0: x, y0: y, x1: x + 4, y1: y + 3 }; }
    }
    return best;
  });
  {
    let taps = 0, detail = '';
    const before = await stateOf(page, () => window.__ec.state.bld.filter(Boolean).length);
    const b = await tap(page, '[data-act=tab][data-tab=build]'); if (b) taps++;
    let card = await find(page, '.ec-panel [data-act], .ec-panel button', '^\\s*bedroom');
    if (!card) { const rooms = await find(page, '.ec-panel [role=tab], .ec-panel .ec-strip-tab', '^\\s*rooms'); if (rooms) { await tapAt(page, rooms.x, rooms.y); taps++; card = await find(page, '.ec-panel [data-act], .ec-panel button', '^\\s*bedroom'); } }
    if (!site) detail = 'no open 5 x 4 site found';
    else if (!card) detail = 'no Bedroom card in Build';
    else if (card.locked) detail = `Bedroom card is locked ("${card.text}")`;
    else {
      await tapAt(page, card.x, card.y); taps++;
      await focusTiles(page, site, 1);
      await dragWorld(page, await tileScreen(page, site.x0, site.y0), await tileScreen(page, site.x1, site.y1)); taps++;
      taps += await confirmIfAsked(page);
      const after = await stateOf(page, () => {
        const s = window.__ec.state, defs = {};
        for (const b of s.bld) if (b && b.st !== 'done') defs[b.def] = (defs[b.def] || 0) + 1;
        return { n: s.bld.filter(Boolean).length, defs };
      });
      const has = (k) => Object.keys(after.defs).some((d) => d === k || d.startsWith(k));
      const floor = Object.keys(after.defs).some((d) => /^f_|floor/.test(d));
      const okb = has('wall') && has('door') && has('bed') && floor && taps <= 5;
      detail = `${taps} taps (<= 5); blueprints ${before} > ${after.n}: ${JSON.stringify(after.defs)}`;
      await screen('stamp');
      flow(3, 'Bedroom stamp 5 x 4: walls, door, floor and bed in <= 5 taps', okb, detail);
    }
    if (!flows.some((f) => f.id === 3)) flow(3, 'Bedroom stamp 5 x 4: walls, door, floor and bed in <= 5 taps', false, detail);
    await page.evaluate(() => { const sh = window.__ecUI.shell; if (sh.endTool) sh.endTool(); if (sh.ui.panel && sh.togglePanel) sh.togglePanel(sh.ui.panel); });
  }

  // 5: reload > Continue restores the colony
  {
    const saved = await page.evaluate(async () => { const ec = window.__ec; await ec.saveNow('test'); const s = ec.state; return { id: s.id, tick: s.tick, col: s.col.map((c) => c.name).join(','), bld: s.bld.filter(Boolean).length, hash: ec.hash() }; });
    await page.reload();
    await page.waitForTimeout(900);
    const cont = await tap(page, '[data-act=continue]');
    let back = null;
    try { await page.waitForFunction(() => window.__ecUI && window.__ecUI.shell && window.__ec && window.__ec.state, null, { timeout: 8000 }); back = await page.evaluate(() => { const s = window.__ec.state; return { id: s.id, tick: s.tick, col: s.col.map((c) => c.name).join(','), bld: s.bld.filter(Boolean).length }; }); } catch (_) { /* timed out */ }
    const okr = back && back.id === saved.id && back.col === saved.col && back.bld === saved.bld && back.tick >= saved.tick;
    flow(5, 'reload > Continue restores the colony', okr, !cont ? 'no Continue button after reload' : back ? `saved tick ${saved.tick}, ${saved.bld} buildings; restored tick ${back.tick}, ${back.bld} buildings, same id ${back.id === saved.id}, same colonists ${back.col === saved.col}` : 'Continue did not enter the game');
    if (back) await screen('continued');
  }
  await ctx.close();
  return { vp: vp.name, flows, screens, problems: [...errs, ...problems] };
}

const report = [];
let bad = 0;
for (const vp of VIEWPORTS) {
  if (only && !only.split(',').includes(vp.name)) continue;
  let r;
  try { r = await runViewport(vp); } catch (e) { r = { vp: vp.name, flows: [], screens: [], problems: ['harness: ' + String(e && e.message || e).slice(0, 300)] }; }
  r.ok = !r.problems.length && r.flows.every((f) => f.ok);
  if (!r.ok) bad++;
  report.push(r);
}
await browser.close(); await srv.close();
writeFileSync(join(OUT, `ui-phone-${which}.json`), JSON.stringify(report, null, 1));
if (process.argv.includes('--json')) console.log(JSON.stringify(report));
for (const r of report) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.vp}  screens: ${r.screens.map((s) => s.name + (s.ok ? '' : `(${s.n})`)).join(' ')}`);
  for (const f of r.flows) console.log(`      ${f.ok ? 'ok  ' : 'FAIL'} flow ${f.id} ${f.name}: ${f.detail}${f.ok ? '' : ` [owner ${f.owner}]`}`);
  for (const p of r.problems.slice(0, 14)) console.log('      ' + p);
  if (r.problems.length > 14) console.log(`      ... ${r.problems.length - 14} more`);
}
console.log(`ui-phone [${which}${which === 'chromium' ? ', stand-in for WebKit' : ''}]: ${bad ? bad + ' viewport(s) with problems' : 'all viewports clean'} (screenshots in tools/out/ui-phone/)`);
process.exit(bad ? 1 : 0);

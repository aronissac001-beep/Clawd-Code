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
// The Stage 1b flows (14.7 row I):
//   7 the omen shows the chip: the sim stepped to the first omen (day 2, 18:00) shows the threat chip
//     with its hours and the omen letter (the game paused under it)
//   8 draft > move order: tap a portrait, Draft on the peek card, then tap the ground: the colonist
//     holds a Move order to that tile
//   9 the Dawn Ledger appears on resume and the game is paused: after reload > Continue, and after
//     the page comes back from the background (visibilitychange) at 3x
//  10 scripted 3x play reaches the first omen in <= 15 minutes (one viewport, 390 x 664, with
//     Playwright's fake clock: the coach's opening is played through the UI, the speed fan picks 3x,
//     then time runs until the chip appears; real minutes are the fake clock's)
// Screens added in 1b: settings (Menu > Settings), omen (the letter), drafted (peek), a2hs and backup (prompt cards), raid (peek), needs (colonist sheet), ledger.
// --flows=title runs the Stage 0 title check only; --flows=1a skips 7-10. Exit 0 pass, 1 fail, 2 browser unavailable.
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
  if (await tap(page, '[data-act=menu]')) {
    await screen('menu');
    // Menu > Settings (1b: auto-pause at Imminent, backup reminders, storage)
    if (await tap(page, '[data-act=menu-settings]')) { await page.waitForTimeout(300); await screen('settings'); }
    else problems.push('[menu] no Settings row');
    await page.evaluate(() => { const sh = window.__ecUI.shell; if (sh.ctx && sh.ctx.closeSheet) sh.ctx.closeSheet(); });
  }

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

  // 7: the omen shows the chip (and the letter, with the game paused)
  const stage1b = flowsArg !== '1a';
  if (stage1b) {
    const r7 = await page.evaluate(() => {
      const sh = window.__ecUI.shell, s = window.__ec.state;
      sh.setSpeed(0);
      const omen = 25200;   // day 2, 18:00 (Steady Flame's first omen, js/data/starts.js)
      if (s.tick < omen + 2) window.__ec.step(omen + 2 - s.tick);
      sh.uiSecond();
      const chip = document.querySelector('.ec-threat');
      const v = { chip: chip && !chip.hidden ? chip.getAttribute('aria-label') : null, chipText: chip ? chip.textContent : '', sheet: sh.ui.sheet, speed: sh.ui.speed, queue: s.st.queue.map((e) => e.stage) };
      return v;
    });
    await screen('omen');
    flow(7, 'the omen shows the chip', r7.chip && /\d+ hours/.test(r7.chip) && /^Omen/.test(r7.sheet || '') && r7.speed === 0,
      `chip "${r7.chip}" (${r7.chipText.trim()}); letter "${r7.sheet}"; speed ${r7.speed}; queue ${r7.queue.join(',')}`);
    const okb = await tap(page, '[data-act=letter-ok]');
    if (!okb) problems.push('[omen] the letter has no visible "Got it" button');
    await page.evaluate(() => { const sh = window.__ecUI.shell; sh.ctx.closeSheet(); sh.setSpeed(0); if (sh.ledger) sh.ledger.hide(); if (sh.prompts) sh.prompts.hide(); });

    // 8: draft > move order (tap a portrait, Draft, tap the ground)
    let d8 = '';
    const col = await page.evaluate(() => window.__ec.state.col.find((c) => !c.hp.dead && !c.hp.down).id);
    await page.evaluate(() => { const sh = window.__ecUI.shell; sh.closePeek(); });
    const rb = await tap(page, `[data-act=colonist][data-col="${col}"]`);
    const db = rb ? await tap(page, '.ec-peek [data-act=draft]') : null;
    const drafted = await stateOf(page, () => window.__ec.state.col.filter((c) => c.drafted).map((c) => c.id));
    const peekScreen = drafted.length ? await screen('drafted') : null; void peekScreen;
    // a passable tile 3-6 tiles from the colonist, free of buildings and colonists
    const tgt = await page.evaluate((id) => {
      const s = window.__ec.state, c = s.col.find((x) => x.id === id), W = s.w;
      const cx = Math.floor(c.x / 32), cy = Math.floor(c.y / 32);
      for (let r = 3; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy, i = y * W + x;
        if (x < 1 || y < 1 || x >= W - 1 || y >= s.h - 1) continue;
        if (s.rt.walkCost[i] === 0 || s.rt.walkCost[i] >= 250 || s.rt.occ[i] >= 0) continue;
        if (s.col.some((o) => Math.floor(o.x / 32) === x && Math.floor(o.y / 32) === y)) continue;
        return { x, y };
      }
      return null;
    }, col);
    let order = null;
    if (tgt && drafted.includes(col)) {
      await focusTiles(page, { x0: tgt.x, y0: tgt.y, x1: tgt.x, y1: tgt.y }, 1);
      const p = await tileScreen(page, tgt.x, tgt.y);
      await tapAt(page, p.x, p.y);
      order = await page.evaluate(([id, t]) => { const c = window.__ec.state.col.find((x) => x.id === id); const j = c.job; return j ? { type: j.type, order: j.order, tile: j.order === 'move' ? [Math.floor(j.hx / 32), Math.floor(j.hy / 32)] : null } : null; }, [col, tgt]);
    }
    d8 = `${rb ? 'portrait' : 'no portrait'} > ${db ? 'Draft' : 'no Draft button'} > drafted [${drafted}] > tap ${tgt ? tgt.x + ',' + tgt.y : 'no tile'}: job ${JSON.stringify(order)}`;
    flow(8, 'draft > move order', drafted.includes(col) && order && order.type === 'order' && order.order === 'move' && order.tile && order.tile[0] === tgt.x && order.tile[1] === tgt.y, d8);
    await page.evaluate((id) => { window.__ec.send({ t: 'draft', colIds: [id], on: false }); const sh = window.__ecUI.shell; sh.closePeek(); }, col);
    // the prompt cards (1b): Add to Home Screen and Back up your hold, then the raid peek card
    await page.evaluate(() => window.__ecUI.shell.prompts.showA2HS());
    await screen('a2hs');
    await page.evaluate(() => { window.__ecUI.shell.prompts.hide(); window.dispatchEvent(new CustomEvent('ec2:backup', { detail: { id: window.__ec.state.id, reason: 'stale' } })); });
    await screen('backup');
    await page.evaluate(() => { const sh = window.__ecUI.shell; sh.prompts.hide(); sh.select({ kind: 'raid', id: null }); });
    await screen('raid');
    await page.evaluate(() => window.__ecUI.shell.closePeek());
    // the colonist sheet's Needs tab (1b)
    await page.evaluate((id) => { const sh = window.__ecUI.shell; sh.openSubjectSheet({ kind: 'colonist', id }, 'Needs'); }, col);
    await screen('needs');
    await page.evaluate(() => { const sh = window.__ecUI.shell; sh.ctx.closeSheet(); });
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
    if (stage1b && back) {
      // 9: the Dawn Ledger on resume, paused: after Continue, and after a return from the background at 3x
      await page.waitForTimeout(300);
      const a = await page.evaluate(() => { const sh = window.__ecUI.shell, l = document.querySelector('.ec-ledger'); return { ledger: !!l && !l.hidden && !l.classList.contains('small'), speed: sh.ui.speed }; });
      await screen('ledger');
      const b = await page.evaluate(async () => {
        const sh = window.__ecUI.shell;
        sh.ledger.hide(); sh.setSpeed(3);
        document.dispatchEvent(new Event('visibilitychange'));   // main.js: visible again > 'ec2:resume'
        await new Promise((r) => setTimeout(r, 150));
        const l = document.querySelector('.ec-ledger');
        return { ledger: !!l && !l.hidden, speed: sh.ui.speed, text: l ? l.innerText.split('\n')[0] : '' };
      });
      flow(9, 'the Dawn Ledger appears on resume and the game is paused', a.ledger && a.speed === 0 && b.ledger && b.speed === 0,
        `after Continue: ledger ${a.ledger ? 'shown' : 'NOT shown'}, speed ${a.speed}; after visibilitychange at 3x: ledger ${b.ledger ? 'shown' : 'NOT shown'} ("${b.text}"), speed ${b.speed}`);
    }
    flow(5, 'reload > Continue restores the colony', okr, !cont ? 'no Continue button after reload' : back ? `saved tick ${saved.tick}, ${saved.bld} buildings; restored tick ${back.tick}, ${back.bld} buildings, same id ${back.id === saved.id}, same colonists ${back.col === saved.col}` : 'Continue did not enter the game');
    if (back) await screen('continued');
  }
  await ctx.close();
  return { vp: vp.name, flows, screens, problems: [...errs, ...problems] };
}

// ---- flow 10: scripted 3x play to the first omen, on Playwright's fake clock ----------------------
async function runOmenClock(vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  await page.clock.install({ time: new Date('2026-01-01T09:00:00Z') });
  await page.goto(srv.url + '?debug=1');
  const run = (ms) => page.clock.runFor(ms);
  await run(1200);
  // synchronous touch helpers (no real waits: the page's timers and frames run only on the fake clock)
  const tapSync = async (sel, text = null) => { const p = await find(page, sel, text); if (!p) return null; await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); if (!el) return; const o = { pointerId: 41, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 }; el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })); }, [p.x, p.y]); await run(100); return p; };
  const dragSync = async (a, b) => {
    for (let k = 0; k <= 10; k++) {
      await page.evaluate(([a, b, k]) => {
        const cv = document.getElementById('view');
        const p = { x: a.x + ((b.x - a.x) * k) / 10, y: a.y + ((b.y - a.y) * k) / 10 };
        const o = (buttons) => ({ pointerId: 42, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, buttons });
        cv.dispatchEvent(new PointerEvent(k === 0 ? 'pointerdown' : 'pointermove', o(1)));
      }, [a, b, k]);
      await run(34);
    }
    await page.evaluate(([b]) => { document.getElementById('view').dispatchEvent(new PointerEvent('pointerup', { pointerId: 42, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: b.x, clientY: b.y, button: 0, buttons: 0 })); }, [b]);
    await run(100);
  };
  const tileAtScreen = (x, y) => page.evaluate(([x, y]) => window.__ecUI.shell.tileToScreen(x, y), [x, y]);
  const focus = (r, z = 0.8) => page.evaluate(([r, z]) => { const sh = window.__ecUI.shell; sh.camera.setZoom(z); sh.camera.centerOn(((r.x0 + r.x1 + 1) / 2) * 32, ((r.y0 + r.y1 + 1) / 2) * 32, false); sh.loop.poke(); }, [r, z]);
  const rectDrag = async (r) => { await focus(r); await run(100); await dragSync(await tileAtScreen(r.x0, r.y0), await tileAtScreen(r.x1, r.y1)); };
  const steps = [];
  await tapSync('[data-act=new]');
  let t = 0;
  while (t < 10000 && !(await page.evaluate(() => !!(window.__ecUI && window.__ecUI.shell)))) { await run(100); t += 100; }
  const t0 = await page.evaluate(() => Date.now());
  // the coach's opening through its "Show me" buttons: chop, stockpile, 3x, carve, then a bedroom
  const plan = await page.evaluate(() => {
    const s = window.__ec.state, W = s.w, H = s.h;
    const hb = s.bld[s.colony.hearth.id], hx = hb.x + 1, hy = hb.y + 1;
    const open = (w, h, d0) => { for (let r = d0; r < 40; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; const x = hx + dx, y = hy + dy; let ok = x > 1 && y > 1 && x + w < W - 1 && y + h < H - 1; for (let yy = y - 1; yy <= y + h && ok; yy++) for (let xx = x - 1; xx <= x + w && ok; xx++) { const i = yy * W + xx; if (![1, 2, 3].includes(s.L.terrain[i]) || s.rt.occ[i] >= 0 || s.L.plant[i] || s.L.zone[i] || s.rt.itemAt[i] >= 0) ok = false; } if (ok) return { x0: x, y0: y, x1: x + w - 1, y1: y + h - 1 }; } return null; };
    let rock = null, bd = 1e9;
    for (let y = 2; y < H - 11; y++) for (let x = 2; x < W - 11; x++) { const d = Math.abs(x + 4 - hx) + Math.abs(y + 4 - hy); if (d >= bd) continue; let ok = true; for (let yy = y; yy < y + 9 && ok; yy++) for (let xx = x; xx < x + 9 && ok; xx++) if (s.L.terrain[yy * W + xx] !== 9) ok = false; if (ok) { bd = d; rock = { x0: x, y0: y, x1: x + 8, y1: y + 8 }; } }
    const chop = { x0: hx - 5, y0: hy - 5, x1: hx + 5, y1: hy + 5 };
    const pile = open(6, 4, 4);
    return { chop, pile, rock, room: null };
  });
  const coach = async () => {
    await run(1100);   // the coach card refreshes once a second
    const step = await page.evaluate(() => { const t = document.querySelector('.ec-guide-t'); return t ? t.textContent : null; });
    const go = await tapSync('[data-act=guide-go]');
    const tool = await page.evaluate(() => { const t = window.__ecUI.shell.ui.tool; return t ? t.kind + (t.id ? ':' + t.id : '') : null; });
    return { step, go: !!go, tool };
  };
  const marks = () => page.evaluate(() => { const s = window.__ec.state; let m = 0, c = 0; for (const v of s.L.desig) { if (v & 1) m++; if (v & 2) c++; } return `mine ${m}, chop ${c}, zones ${s.zones.length}, plans ${s.colony.plans.length}`; });
  // chop
  let c = await coach(); await rectDrag(plan.chop); await tapSync('[data-act=done]'); steps.push(`${c.step} (${c.tool}; ${await marks()})`);
  c = await coach(); if (plan.pile) await rectDrag(plan.pile); await tapSync('[data-act=done]'); steps.push(`${c.step} (${c.tool}; ${await marks()})`);
  // 3x: hold the speed button, slide onto 3x in the fan
  const sp = await find(page, '[data-act=speed]');
  if (sp) {
    await page.evaluate(([x, y]) => { document.querySelector('[data-act=speed]').dispatchEvent(new PointerEvent('pointerdown', { pointerId: 43, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 })); }, [sp.x, sp.y]);
    await run(600);
    await page.evaluate(([x, y]) => {
      const b = document.querySelector('[data-act=speed]'), t = document.querySelector('.ec-fan-btn[data-speed="3"]');
      if (!t) return;
      const q = t.getBoundingClientRect(), tx = q.left + q.width / 2, ty = q.top + q.height / 2;
      const o = (x, y, buttons) => ({ pointerId: 43, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons });
      b.dispatchEvent(new PointerEvent('pointermove', o(tx, ty, 1)));
      b.dispatchEvent(new PointerEvent('pointerup', o(tx, ty, 0)));
    }, [sp.x, sp.y]);
    await run(200);
  }
  const speed = await page.evaluate(() => window.__ecUI.shell.ui.speed);
  steps.push(`speed ${speed}x`);
  await run(1100);
  c = await coach(); if (plan.rock) await rectDrag(plan.rock); await tapSync('[data-act=done]'); steps.push(`${c.step} (${c.tool}; ${await marks()})`);
  // then time runs at 3x until the threat chip shows
  let chip = null, waited = 0;
  const LIMIT = 15 * 60 * 1000;
  while (waited < LIMIT) {
    await run(5000); waited += 5000;
    chip = await page.evaluate(() => { const el = document.querySelector('.ec-threat'); return el && !el.hidden ? el.getAttribute('aria-label') : null; });
    if (chip) break;
    // keep 3x if anything (a letter) paused it
    await page.evaluate(() => { const sh = window.__ecUI.shell; if (sh.ui.speed !== 3 && !sh.ui.sheet) sh.setSpeed(3); });
  }
  const res = await page.evaluate((t0) => { const s = window.__ec.state; return { tick: s.tick, day: Math.floor(s.tick / 14400) + 1, hour: Math.floor((s.tick % 14400) / 600), minutes: (Date.now() - t0) / 60000, mined: s.L.desig.reduce((n, v) => n + (v & 1 ? 1 : 0), 0), zones: s.zones.length, plans: s.colony.plans.length, chops: s.L.desig.reduce((n, v) => n + (v & 2 ? 1 : 0), 0) }; }, t0);
  await page.screenshot({ path: join(OUT, `${vp.name}-omen-3x.png`) });
  await ctx.close();
  const ok = !!chip && res.minutes <= 15 && speed === 3 && !errs.length;
  return { id: 10, name: 'scripted 3x play reaches the first omen in <= 15 minutes', ok, owner: 'I',
    detail: `${chip ? `chip "${chip}"` : 'no chip'} after ${res.minutes.toFixed(1)} min of play (fake clock; game day ${res.day} ${res.hour}:00); coach: ${steps.join(' > ')}${errs.length ? '; errors: ' + errs.slice(0, 2).join(' | ') : ''}` };
}

const report = [];
let bad = 0;
for (const vp of VIEWPORTS) {
  if (only && !only.split(',').includes(vp.name)) continue;
  let r;
  if (flowsArg === 'omen') { r = { vp: vp.name, flows: [], screens: [], problems: [] }; if (vp.name === 'p390x664-safari') r.flows.push(await runOmenClock(vp)); else continue; r.ok = r.flows.every((f) => f.ok); if (!r.ok) bad++; report.push(r); continue; }
  try { r = await runViewport(vp); } catch (e) { r = { vp: vp.name, flows: [], screens: [], problems: ['harness: ' + String(e && e.message || e).slice(0, 300)] }; }
  if (vp.name === 'p390x664-safari' && flowsArg === 'all') {
    try { r.flows.push(await runOmenClock(vp)); } catch (e) { r.flows.push({ id: 10, name: 'scripted 3x play reaches the first omen in <= 15 minutes', ok: false, owner: 'I', detail: 'harness: ' + String(e && e.message || e).slice(0, 300) }); }
  }
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

// Stage 1a phone UI flows (workstream I's acceptance, doc 14.6 row I; for J's ui-phone gate check).
//   node tools/ui-flows.mjs [--browser=webkit|chromium] [--vp=p390x664-safari] [--url=http://localhost:8967/]
// At every gate viewport (tools/ui-phone.mjs VIEWPORTS), with touch emulation:
//   (1) title > New colony > game in < 3 s
//   (2) Carve hall 9 x 9 creates mine designations and a pillar plan (read via window.__ec)
//   (3) a Bedroom stamp 5 x 4 creates blueprints for walls, door, floor and bed in <= 5 taps
//   (4) speed: a tap pauses, the hold fan selects 3x
//   (5) reload > Continue restores the colony
//   (6) world height: nothing selected >= 480 pt at 390 x 664, >= 400 pt with a peek card; every
//       viewport within 1 pt of the doc 10.1 plan (layout.js plannedWorld)
// and on every screen it opens (game, Build, Orders, Zones, presets, peek cards, colonist sheet tabs,
// role picker, bills, stockpile sheet, tool bars, long-press menu, Menu): no console errors, no
// horizontal overflow, every visible interactive element >= 44 x 44 pt, every visible text >= 14 px.
// Drags use pointer events (mouse pointers: the gesture layer reads any pointer type); taps use the
// touch screen. Screenshots: tools/out/ui-flows/<viewport>-<screen>.png (look at them).
// W1.10: in the new shell (SHELL2) the taps on Orders, Zones and Colony go to Mark's segments and to People.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serve } from './lib/static-server.mjs';
import { launch, browserArg, UNAVAILABLE } from './lib/browsers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out', 'ui-flows');
mkdirSync(OUT, { recursive: true });
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
export const VIEWPORTS = [
  { name: 'p375x635-safari', width: 375, height: 635 }, { name: 'p390x664-safari', width: 390, height: 664 },
  { name: 'p430x740-safari', width: 430, height: 740 }, { name: 'p390x763-app', width: 390, height: 763 },
  { name: 'l844x335-safari', width: 844, height: 335 }, { name: 'l932x380-safari', width: 932, height: 380 },
];
const which = browserArg('webkit');
const browser = await launch(which);
if (!browser) { console.log(`ui-flows [${which}]: UNAVAILABLE - Playwright ${which} is not installed; try --browser=chromium`); process.exit(UNAVAILABLE); }
const ext = arg('url', null);
const srv = ext ? null : await serve(0);
const BASE = ext || srv.url;
const only = arg('vp', null);

/** The 14.4 probe: overflow, small targets, small text (visible elements only). */
async function probe(page) {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); if (!(r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth)) return false;
      // clipped away by a scrolling ancestor: not visible
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const ps = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(ps.overflow + ps.overflowX + ps.overflowY)) { const q = p.getBoundingClientRect(); if (r.bottom <= q.top + 1 || r.top >= q.bottom - 1 || r.right <= q.left + 1 || r.left >= q.right - 1) return false; } }
      return true; };
    const small = [];
    for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role=button], [data-act], [onclick]')) {
      if (!vis(el)) continue; const r = el.getBoundingClientRect();
      if (r.width < 44 - 0.5 || r.height < 44 - 0.5) small.push(`${el.tagName.toLowerCase()}[${el.dataset.act || ''}] "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    const tiny = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim() || !n.parentElement || !vis(n.parentElement)) continue;
      const fs = parseFloat(getComputedStyle(n.parentElement).fontSize);
      if (fs < 14 - 0.01) tiny.push(`"${n.textContent.trim().slice(0, 24)}" ${fs}px`);
    }
    return { overflowX: document.documentElement.scrollWidth > innerWidth + 0.5 || document.body.scrollWidth > innerWidth + 0.5, small, tiny };
  });
}

async function runViewport(vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
  const page = await ctx.newPage();
  const errs = [], problems = [], flows = {}, screens = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => { if (!/favicon/.test(r.url())) errs.push('failed: ' + r.url()); });
  page.on('response', (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()}: ${r.url()}`); });
  let taps = 0;
  const tap0 = async (sel) => { taps++; await page.locator(sel).first().tap(); await page.waitForTimeout(120); };
  // the new shell (flags.js SHELL2, on since W1.10): Orders and Zones are the two segments of Mark, and the Colony
  // sheet's people and work grid live in People (its Grid view)
  const NEW_SHELL = { orders: ['mark', 'mark-orders'], zones: ['mark', 'mark-zones'], colony: ['people', null] };
  const tap = async (sel) => {
    const m = /^\[data-act=tab\]\[data-tab=(orders|zones|colony)\]$/.exec(sel);
    if (m && await page.locator('[data-act=tab][data-tab=mark]').count()) { const [tab, seg] = NEW_SHELL[m[1]]; if (!(seg && await ev(() => window.__ecUI.shell.ui.panel === 'mark'))) await tap0(`[data-act=tab][data-tab=${tab}]`); if (seg) await tap0(`[data-act=${seg}]`); return; }
    if (sel === '[data-act=sheet-tab][data-tab=Work]' && await page.locator('[data-act=sheet-tab][data-tab=Grid]').count()) return tap0('[data-act=sheet-tab][data-tab=Grid]');
    return tap0(sel);
  };
  const screen = async (name) => {
    await page.waitForTimeout(150);
    const p = await probe(page);
    await page.screenshot({ path: join(OUT, `${vp.name}-${name}.png`) });
    const list = [...(p.overflowX ? ['horizontal overflow'] : []), ...p.small.map((x) => 'target < 44 pt: ' + x), ...p.tiny.map((x) => 'text < 14 px: ' + x)];
    screens.push(name);
    for (const x of list) problems.push(`${name}: ${x}`);
  };
  const ev = (fn, a) => page.evaluate(fn, a);
  /** Drag with pointer events between two page points (steps like a finger). */
  const drag = async (a, b, { hold = 0, steps = 12 } = {}) => {
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    if (hold) await page.waitForTimeout(hold);
    for (let k = 1; k <= steps; k++) { await page.mouse.move(a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps); await page.waitForTimeout(16); }
    await page.waitForTimeout(60);
    await page.mouse.up(); await page.waitForTimeout(150);
  };
  const tileXY = (x, y) => ev(([x, y]) => window.__ecUI.shell.tileToScreen(x, y), [x, y]);
  const focus = (x, y, zoom) => ev(([x, y, z]) => { const sh = window.__ecUI.shell; sh.ui.follow = null; sh.camera.focus = null; sh.camera.vx = sh.camera.vy = 0; sh.camera.setZoom(z); sh.camera.centerOn((x + 0.5) * 32, (y + 0.5) * 32, false); sh.loop.poke(); }, [x, y, zoom]);
  const zoomFor = vp.height < 500 ? 0.55 : 0.7;
  try {
    await page.goto(BASE + '?debug=1');
    await page.waitForSelector('[data-act=new]');
    await screen('title');
    // ---- (1) title > New colony > game in < 3 s
    const t0 = Date.now();
    await page.locator('[data-act=new]').tap();
    await page.waitForTimeout(150); if (await page.locator('[data-act=quick]').count()) await page.locator('[data-act=quick]').first().tap();   // W2: New hold > Quick start
    await page.waitForFunction(() => window.__ecUI && window.__ecUI.shell && window.__ec && window.__ec.state);
    await page.waitForSelector('.ec-bottom');
    flows.newColonyMs = Date.now() - t0;
    flows.f1 = flows.newColonyMs < 3000;
    await page.waitForTimeout(400);
    // pause so the sim does not move under the flows (speed is UI state)
    await ev(() => { const sh = window.__ecUI.shell; sh.speed.toggle(); });
    await screen('game');
    // ---- (6) world height, nothing selected
    const m0 = await ev(() => window.__ecUI.shell.metrics());
    flows.world = Math.round(m0.world.height); flows.plan = m0.plan.height;
    // ---- menus
    await tap('[data-act=tab][data-tab=build]'); await screen('build');
    await tap('[data-act=build-tab-structure]'); await screen('build-structure');
    await tap('[data-act=build-tab-workshops]'); await screen('build-workshops');
    await tap('[data-act=tab][data-tab=orders]'); await screen('orders');
    await tap('[data-act=tab][data-tab=zones]'); await screen('zones');
    await tap('[data-act=zone-stockpile]'); await screen('zones-presets');
    await tap('[data-act=preset-all]'); await screen('tool-stockpile');
    // a stockpile beside the Hearth
    // open, explored, buildable ground near the Hearth: a 12 x 6 area, else two smaller ones
    const findOpen = (w, h, avoid) => ev(async ([w, h, avoid]) => {
      const { isTreeCode } = await import('./js/game/world/defs.js');
      const s = window.__ec.state, W = s.w, hb = s.bld[s.colony.hearth.id];
      const open = (x, y) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { if (xx < 1 || yy < 1 || xx >= W - 1 || yy >= s.h - 1) return false; if (avoid && xx >= avoid.x - 1 && xx <= avoid.x + avoid.w && yy >= avoid.y - 1 && yy <= avoid.y + avoid.h) return false; const i = yy * W + xx; if (s.rt.occ[i] >= 0 || s.rt.itemAt[i] >= 0 || isTreeCode(s.L.plant[i]) || ![1, 2, 3, 5].includes(s.L.terrain[i]) || s.L.zone[i] || !((s.L.fog[i >> 3] >> (i & 7)) & 1)) return false; } return true; };
      for (let r = 3; r < 60; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; const x = hb.x + dx, y = hb.y + dy; if (open(x, y)) return { x, y, w, h }; }
      return null;
    }, [w, h, avoid || null]);
    let spot = await findOpen(5, 4, null);
    if (!spot) throw new Error('no open 5 x 4 area near the Hearth');
    const pile = await findOpen(4, 3, spot);
    if (!pile) throw new Error('no open 4 x 3 area near the Hearth');
    await focus(pile.x + 2, pile.y + 1, zoomFor);
    await drag(await tileXY(pile.x, pile.y), await tileXY(pile.x + 3, pile.y + 2));
    flows.stockpile = await ev(() => window.__ec.state.zones.length);
    await tap('[data-act=done]');
    // ---- (3) Bedroom stamp 5 x 4 in <= 5 taps: Build, Rooms, Bedroom, drag, Done
    await focus(spot.x + 3, spot.y + 2, zoomFor);
    const before3 = await ev(() => window.__ec.state.bld.filter(Boolean).length);
    taps = 0;
    await tap('[data-act=tab][data-tab=build]');
    await tap('[data-act=build-tab-rooms]');
    await tap('[data-act=stamp-bedroom]');
    await screen('tool-stamp');
    taps++; await drag(await tileXY(spot.x, spot.y), await tileXY(spot.x + 4, spot.y + 3));
    await screen('stamp-plan');
    // the door marker drags along the wall
    const plan = await ev(() => { const t = window.__ecUI.shell.ui.tool; return t && t.pending ? { door: t.pending.plan.door, ok: t.pending.plan.ok } : null; });
    if (plan && plan.door) {
      const d0 = plan.door;
      const tgt = d0.y === spot.y + 3 || d0.y === spot.y ? { x: d0.x === spot.x + 1 ? spot.x + 3 : spot.x + 1, y: d0.y } : { x: d0.x, y: d0.y === spot.y + 1 ? spot.y + 2 : spot.y + 1 };
      await drag(await tileXY(d0.x, d0.y), await tileXY(tgt.x, tgt.y), { steps: 8 });
      flows.doorMoved = await ev(() => { const t = window.__ecUI.shell.ui.tool; return t.pending && t.pending.door ? `${t.pending.door.x},${t.pending.door.y}` : null; });
    }
    await tap('[data-act=done]');
    flows.stampTaps = taps;
    const made = await ev((n) => { const b = window.__ec.state.bld.filter(Boolean).slice(n); const c = (d) => b.filter((x) => x.def === d && x.st !== 'done').length; return { wall: c('wall'), door: c('door'), floor: c('f_planks') + c('f_flag'), bed: c('bed') }; }, before3);
    flows.stamp = made;
    flows.f3 = made.wall > 0 && made.door === 1 && made.floor > 0 && made.bed === 1 && taps <= 5 && !!flows.doorMoved;
    // ---- peek cards: a blueprint, a colonist; the colonist sheet; the role picker
    const bedId = await ev(() => { const s = window.__ec.state; const b = s.bld.filter(Boolean).find((x) => x.def === 'bed'); return b ? b.id : null; });
    if (bedId !== null) { await ev((id) => { const s = window.__ec.state, b = s.bld[id]; window.__ecUI.shell.select({ kind: 'building', id, tile: b.y * s.w + b.x, x: b.x, y: b.y }); }, bedId); await screen('peek-blueprint'); }
    const m1 = await ev(() => window.__ecUI.shell.metrics());
    flows.worldPeek = Math.round(m1.world.height); flows.planPeek = m1.plan.heightPeek;
    await ev(() => window.__ecUI.shell.closePeek());
    await tap('[data-act=colonist]');
    await screen('peek-colonist');
    const m2 = await ev(() => window.__ecUI.shell.metrics());
    flows.worldPeekCol = Math.round(m2.world.height);
    await tap('.ec-peek .ec-peek-txt'); await screen('sheet-skills');
    await tap('[data-act=sheet-tab][data-tab=Bio]'); await screen('sheet-bio');
    await tap('[data-act=role-primary]'); await screen('role-picker');
    await tap('[data-act=pick-role-miner]');
    flows.role = await ev(() => window.__ec.state.col[0].role[0]);
    await tap('[data-act=close-sheet]');
    await ev(() => window.__ecUI.shell.closePeek());
    // ---- Colony sheet
    await tap('[data-act=tab][data-tab=colony]'); await screen('colony-people');
    await tap('[data-act=sheet-tab][data-tab=Work]'); await screen('colony-work');
    await tap('[data-act=close-sheet]');
    // ---- a mason's bench and its bills (smart default: blocks until 100)
    await tap('[data-act=tab][data-tab=build]');
    await tap('[data-act=build-tab-workshops]');
    await tap('[data-act=build-mason]');
    await screen('tool-place');
    await tap('#view'); // the tap places at the screen centre (the Hearth area may be taken: then try the spot)
    let mason = await ev(() => { const b = window.__ec.state.bld.filter(Boolean).find((x) => x.def === 'mason'); return b ? b.id : null; });
    if (mason === null) { const p = await tileXY(pile.x + 1, pile.y + 1); await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(150); mason = await ev(() => { const b = window.__ec.state.bld.filter(Boolean).find((x) => x.def === 'mason'); return b ? b.id : null; }); }
    await tap('[data-act=done]');
    flows.masonBills = await ev((id) => (id === null ? null : window.__ec.state.bld[id].bills.map((b) => `${b.recipe}:${b.mode}:${b.n}`).join(',')), mason);
    if (mason !== null) {
      await ev((id) => { const s = window.__ec.state, b = s.bld[id]; window.__ecUI.shell.select({ kind: 'building', id, tile: b.y * s.w + b.x, x: b.x, y: b.y }); }, mason);
      await screen('peek-bench');
      await tap('.ec-peek [data-act=bills]'); await screen('sheet-bills');
      await tap('[data-act=bill-add-make_pillar]');
      await tap('[data-act=bill-more] >> nth=1'); await screen('sheet-bills-more');
      flows.billsAfter = await ev((id) => window.__ec.state.bld[id].bills.map((b) => `${b.recipe}:${b.mode}:${b.n}`).join(','), mason);
      await tap('[data-act=close-sheet]');
      await ev(() => window.__ecUI.shell.closePeek());
    }
    // ---- the stockpile sheet (presets)
    const zid = await ev(() => (window.__ec.state.zones[0] ? window.__ec.state.zones[0].id : null));
    if (zid) {
      await ev((id) => window.__ecUI.shell.openSubjectSheet({ kind: 'zone', id }), zid);
      await screen('sheet-stockpile');
      await tap('[data-act=set-preset-raw]');
      flows.preset = await ev((id) => window.__ec.state.zones.find((z) => z.id === id).filter.cats.join(','), zid);
      await tap('[data-act=close-sheet]');
    }
    // ---- (2) Carve hall 9 x 9: mine designations and a pillar plan
    const rock = await ev(() => {
      const s = window.__ec.state, W = s.w, hb = s.bld[s.colony.hearth.id];
      const all = (x, y, n) => { for (let yy = y; yy < y + n; yy++) for (let xx = x; xx < x + n; xx++) if (s.L.terrain[yy * W + xx] !== 9) return false; return true; };
      let best = null, bd = Infinity;
      for (let y = 2; y < s.h - 12; y++) for (let x = 2; x < W - 12; x++) { if (!all(x, y, 9)) continue; const d = (x - hb.x) ** 2 + (y - hb.y) ** 2; if (d < bd) { bd = d; best = { x, y }; } }
      return best;
    });
    if (!rock) throw new Error('no 9 x 9 rock block');
    await focus(rock.x + 4, rock.y + 4, zoomFor);
    await tap('[data-act=tab][data-tab=orders]');
    await tap('[data-act=order-carve]');
    const ca = await tileXY(rock.x, rock.y), cb = await tileXY(rock.x + 8, rock.y + 8);
    await drag(ca, cb);
    flows.carvePending = await ev(() => { const t = window.__ecUI.shell.ui.tool; return t && t.pending ? { ok: t.pending.plan.ok, why: t.pending.plan.why, q: t.pending.plan.q } : 'none'; });
    await screen('carve-plan');
    await tap('[data-act=chip-pattern]'); await tap('[data-act=chip-pattern]'); await tap('[data-act=chip-pattern]'); // back to natural
    await tap('[data-act=done]');
    flows.carve = await ev((r) => {
      const s = window.__ec.state, W = s.w; let mine = 0;
      for (let y = r.y; y < r.y + 9; y++) for (let x = r.x; x < r.x + 9; x++) if (s.L.desig[y * W + x] & 1) mine++;
      const p = s.colony.plans[s.colony.plans.length - 1];
      return { mine, plan: p ? { kind: p.kind, pillars: p.pillars.length, natural: p.natural.length, rect: p.rect } : null };
    }, rock);
    flows.f2 = flows.carve.mine > 0 && !!flows.carve.plan && flows.carve.plan.kind === 'carve' && flows.carve.plan.rect.x0 === rock.x && flows.carve.plan.rect.x1 === rock.x + 8 && flows.carve.mine + flows.carve.plan.natural === 81;
    // ---- a wall line, Mine with the support stripes, the long-press menu
    await tap('[data-act=tab][data-tab=orders]');
    await tap('[data-act=order-mine]'); await screen('tool-mine');
    await tap('[data-act=done]');
    await ev(() => { const sh = window.__ecUI.shell; sh.select({ kind: 'colonist', id: window.__ec.state.col[0].id }); });
    const rp = await tileXY(rock.x - 1 >= 0 ? rock.x : rock.x, rock.y);
    await page.mouse.move(rp.x, rp.y); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up(); await page.waitForTimeout(150);
    flows.ctxMenu = await ev(() => [...document.querySelectorAll('.ec-ctxmenu:not([hidden]) .ec-ctx-i')].map((b) => b.textContent));
    await screen('longpress');
    await ev(() => { const m = document.querySelector('.ec-ctx-scrim'); if (m && !m.hidden) m.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); window.__ecUI.shell.closePeek(); });
    // ---- Menu
    await tap('[data-act=menu]'); await screen('menu');
    await tap('[data-act=close-sheet]');
    // ---- (4) speed: tap pauses (the game is paused now: resume, then pause), hold > fan > 3x
    await tap('[data-act=speed]');
    const sp1 = await ev(() => window.__ecUI.shell.ui.speed);
    await tap('[data-act=speed]');
    const sp2 = await ev(() => window.__ecUI.shell.ui.speed);
    const sb = await page.locator('[data-act=speed]').boundingBox();
    const c = { x: sb.x + sb.width / 2, y: sb.y + sb.height / 2 };
    await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.waitForTimeout(400);
    await screen('speed-fan');
    const f3 = await page.locator('.ec-fan-btn[data-speed="3"]').boundingBox();
    for (let k = 1; k <= 8; k++) { await page.mouse.move(c.x + ((f3.x + f3.width / 2 - c.x) * k) / 8, c.y + ((f3.y + f3.height / 2 - c.y) * k) / 8); await page.waitForTimeout(16); }
    await page.mouse.up(); await page.waitForTimeout(150);
    const sp3 = await ev(() => window.__ecUI.shell.ui.speed);
    flows.speed = [sp1, sp2, sp3];
    flows.f4 = sp1 > 0 && sp2 === 0 && sp3 === 3;
    // ---- (5) save, reload, Continue
    await tap('[data-act=speed]');   // pause
    await tap('[data-act=menu]');
    await tap('[data-act=menu-save-now]');
    await page.waitForTimeout(500);
    const saved = await ev(() => { const s = window.__ec.state; return { id: s.id, tick: s.tick, bld: s.bld.filter(Boolean).length, zones: s.zones.length, plans: s.colony.plans.length, last: window.__ec.app.lastSave && window.__ec.app.lastSave.tick }; });
    await page.reload();
    await page.waitForSelector('[data-act=continue]:not([disabled])', { timeout: 5000 });
    await page.waitForTimeout(300);
    await page.locator('[data-act=continue]').tap();
    await page.waitForFunction(() => window.__ecUI && window.__ecUI.shell && window.__ec.state, null, { timeout: 5000 });
    const back = await ev(() => { const s = window.__ec.state; return { id: s.id, tick: s.tick, bld: s.bld.filter(Boolean).length, zones: s.zones.length, plans: s.colony.plans.length }; });
    flows.saved = saved; flows.restored = back;
    flows.f5 = back.id === saved.id && back.bld === saved.bld && back.zones === saved.zones && back.plans === saved.plans && back.tick >= saved.last;
    // ---- (6)
    const land = vp.width > vp.height;
    flows.f6 = Math.abs(flows.world - flows.plan) <= 1 && (land || Math.abs(flows.worldPeek - flows.planPeek) <= 1)
      && (vp.name !== 'p390x664-safari' || (flows.world >= 480 && flows.worldPeek >= 400));
  } catch (e) {
    problems.push('flow error: ' + e.message.split('\n')[0]);
    await page.screenshot({ path: join(OUT, `${vp.name}-error.png`) }).catch(() => null);
  }
  await ctx.close();
  return { vp: vp.name, flows, problems: [...errs, ...problems], screens };
}

const report = [];
for (const vp of VIEWPORTS) {
  if (only && vp.name !== only) continue;
  report.push(await runViewport(vp));
}
await browser.close(); if (srv) await srv.close();
let bad = 0;
for (const r of report) {
  const f = r.flows;
  const okFlows = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].every((k) => f[k] === true);
  const ok = okFlows && !r.problems.length;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.vp}  flows ${['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((k) => `${k.slice(1)}:${f[k] === true ? 'ok' : 'NO'}`).join(' ')}  new colony ${f.newColonyMs} ms, stamp ${f.stampTaps} taps, world ${f.world}/${f.plan} pt, peek ${f.worldPeek}/${f.planPeek} pt, ${r.screens.length} screens`);
  for (const p of r.problems.slice(0, 16)) console.log('      ' + p);
}
writeFileSync(join(OUT, `report-${which}.json`), JSON.stringify(report, null, 1));
console.log(`ui-flows [${which}]: ${bad ? bad + ' viewport(s) failed' : 'all flows pass at every viewport'} (screenshots and report in tools/out/ui-flows/)`);
process.exit(bad ? 1 : 0);

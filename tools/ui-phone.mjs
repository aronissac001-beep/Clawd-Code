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
// --fortress (Stage Z1 E7): the level UI on a 20-level stub fortress at the six viewports plus landscape-left and
// landscape-right, with the 4.4 tap budgets (see runFortress below).
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

// ---- Stage Z1 E7: --fortress (EMBERCROWN-FORTRESS.md 4.1-4.6, 8.3 E7) ---------------------------------------
// A 128 x 128 x 20 stub fortress (tools/tests/fortress-stub.mjs: a stair shaft at (60, 60) to z 0 with a hall every
// third level) is opened in the real shell (?debug=1&fortress=1) at the six viewports plus landscape-left and
// landscape-right (the notch on either side: emulated safe-area insets). Checked: the generic probe on the level
// screens (game, tool row, ruler, peek, 130% text), the capsule and alert spacing, and the 4.4 tap budgets:
//   F1 Stairs down 3, then view the bottom (6)      F2 a second stair at the same depth (3)
//   F3 jump to an endangered colonist on another level (1)   F4 go down one level and back (2)
//   F5 find the deepest dig (2)                      F6 mine a 5 x 5 room on this level and the one below (6)
//   F7 (landscape) drag the chip across 4 levels within the 291 pt world
//   F8 a tool drag crossing the capsule does not change level
// Until A's C3 v3 lands (the vertical designate kinds in the command spec; designate and cancelRect honouring
// rect.z, levels and dir) the harness installs a test shim with that behaviour (shim: true in the report).
const FORT_VPS = [...VIEWPORTS,
  { name: 'l844x335-left', width: 844, height: 335, safe: '0,0,21,47' }, { name: 'l844x335-right', width: 844, height: 335, safe: '0,47,21,0' }];
const BUDGET = { F1: 6, F2: 3, F3: 1, F4: 2, F5: 2, F6: 6 };
async function fortressSetup(page) {
  return page.evaluate(async () => {
    const { stubFortress, digFortress } = await import('/tools/tests/fortress-stub.mjs');
    const G = await import('/js/game/core/grid.js');
    const { initRuntime } = await import('/js/game/core/state.js');
    const app = await import('/js/ui/app.js');
    app.useStage();
    const s = digFortress(stubFortress(7)); s.id = 'fortress-ui';
    const zS = s.zS;
    for (let y = 30; y < 100; y++) for (let x = 20; x < 100; x++) { G.setBit(s.L.fog, G.idx(x, y, zS), 1); G.setBit(s.L.known, G.idx(x, y, zS), 1); }
    for (let z = 0; z < zS; z++) { G.setBit(s.L.known, G.idx(60, 60, z), 1); G.setBit(s.L.fog, G.idx(60, 60, z), 1); }
    s.tick = 6 * 60 * 20;
    // the coach at its first level step (the six opening steps done)
    try { localStorage.setItem('ec2.guide.' + s.id, JSON.stringify({ done: ['chop', 'stockpile', 'speed', 'carve', 'mason', 'bedroom'], off: false, small: false })); } catch (_) { /* private */ }
    // ---- the C3 v3 shim (A's request): vertical kinds and z-aware designate / cancelRect ----
    const C = await import('/js/game/core/commands.js');
    const V = await import('/js/game/work/vdig.js');
    const A = await import('/js/game/core/apply.js');
    const WX = await import('/js/game/work/windex.js');
    const vert = Object.keys(V.VD_NAMES);
    const live = vert.every((k) => C.DESIG_NAMES.includes(k));
    if (!live) {
      const kinds = [...C.DESIG_NAMES, ...vert], ck = [...C.CANCEL_KINDS, ...vert];
      C.COMMANDS.designate.fields.kind = (v) => (kinds.includes(v) ? null : 'unknown kind');
      C.COMMANDS.cancelRect.fields.kinds = (v) => (Array.isArray(v) && v.length && v.every((k) => ck.includes(k)) ? null : 'bad kinds');
    }
    const forRect = (c, fn) => { const r = c.rect; for (let y = Math.min(r.y0, r.y1); y <= Math.max(r.y0, r.y1); y++) for (let x = Math.min(r.x0, r.x1); x <= Math.max(r.x0, r.x1); x++) fn(x, y); };
    C.registerApplier('designate', (st, c) => {
      if (c.kind in V.VD_NAMES) return V.designateVertical(st, c);
      const z0 = c.rect.z | 0;
      if (!z0 && !c.levels) return A.SLICE_APPLIERS.designate(st, c);
      const bit = G.DESIG_KINDS[c.kind];
      let n = 0;
      for (let k = 0; k < (c.levels || 1); k++) {
        const z = c.dir === 'up' ? z0 + k : z0 - k;
        if (z < 0 || z >= G.D) break;
        forRect(c, (x, y) => {
          const i = G.idx(x, y, z), v = st.L.desig[i];
          if (c.add) { if (!(v & bit) && (bit !== G.DESIG.MINE || G.TER_MINEABLE[st.L.terrain[i]])) { WX.setDesig(st, i, v | bit); n++; } }
          else if (v & bit) { WX.setDesig(st, i, v & ~bit); n++; }
        });
      }
      return n ? { ok: true, n } : { ok: false, reason: c.add ? `nothing to ${c.kind} there` : 'nothing to remove' };
    });
    C.registerApplier('cancelRect', (st, c) => {
      const vk = c.kinds.filter((k) => k in V.VD_NAMES), rest = c.kinds.filter((k) => !(k in V.VD_NAMES));
      let n = vk.length ? V.cancelVertical(st, c.rect, vk) : 0;
      const z = c.rect.z | 0;
      if (rest.length && !z) { const r = A.SLICE_APPLIERS.cancelRect(st, { ...c, kinds: rest }); if (r && r.ok) n += r.n | 0; }
      else if (rest.length) for (const k of rest) { const bit = G.DESIG_KINDS[k]; if (bit) forRect(c, (x, y) => { const i = G.idx(x, y, z); if (st.L.desig[i] & bit) { WX.setDesig(st, i, st.L.desig[i] & ~bit); n++; } }); }
      return n ? { ok: true, n } : { ok: false, reason: 'nothing to cancel there' };
    });
    initRuntime(s);
    window.__ec.adopt(s);
    await app.enter(s);
    const sh = app.ui.shell;
    sh.setSpeed(0);
    sh.camera.setZoom ? sh.camera.setZoom(1) : (sh.camera.zoom = 1);
    sh.camera.centerOn(58 * 32, 60 * 32, false);
    sh.loop.poke();
    return { shim: !live, d: s.d, zS };
  });
}
/** A touch press held for ms, then released (long-press). */
async function holdAt(page, x, y, ms = 560) {
  await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); window.__holdEl = el; el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 12, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 })); }, [x, y]);
  await page.waitForTimeout(ms);
  await page.evaluate(([x, y]) => { const el = window.__holdEl; el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 12, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 0 })); }, [x, y]);
  await page.waitForTimeout(150);
}
async function runFortress(vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
  const problems = [], flows = [], screens = [];
  const screen = async (name) => {
    await page.waitForTimeout(250);
    const p = await probe(page);
    const list = [...(p.overflowX ? ['horizontal overflow'] : []), ...p.small.map((x) => 'target < 44 pt: ' + x), ...p.tiny.map((x) => 'text < 14 px: ' + x)];
    for (const x of list) problems.push(`[${name}] ${x}`);
    screens.push({ name, ok: !list.length, n: list.length });
    await page.screenshot({ path: join(OUT, `fortress-${vp.name}-${name}.png`) });
  };
  const flow = (id, name, ok, detail) => flows.push({ id, name, ok: !!ok, detail, owner: 'I' });
  const Z = () => page.evaluate(() => window.__ecUI.shell.viewZ());
  const setZ = (z) => page.evaluate((z) => { window.__ecUI.shell.setLevel(z); window.__ecUI.shell.loop.poke(); }, z);
  const reset = async () => { await page.evaluate(() => { const sh = window.__ecUI.shell; sh.endTool(); sh.closePeek(); sh.ctx.closeSheet(); sh.ctx.closePanel(); if (sh.levels) sh.levels.closeRuler(); document.querySelector('.ec-ctx-scrim') && (document.querySelector('.ec-ctx-scrim').hidden = true, document.querySelector('.ec-ctxmenu').hidden = true); }); await page.waitForTimeout(150); };
  const land = vp.width > vp.height;
  await page.goto(srv.url + '?debug=1&fortress=1' + (vp.safe ? '&safe=' + vp.safe : ''));
  await page.waitForTimeout(700);
  const info = await fortressSetup(page);
  await page.waitForTimeout(900);
  const zS = info.zS;
  await screen('game');
  // the capsule and the alert stack (portrait: >= 12 pt apart; every control 44 x 44, the chip 44 x 52)
  const geo = await page.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const q = e.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height, b: q.bottom, r: q.right }; };
    return { cap: r('.ec-lv-capsule'), up: r('.ec-lv-up'), chip: r('.ec-lv-chip'), dn: r('.ec-lv-down'), alerts: r('.ec-alerts'), plate: r('.ec-lv-plate'), world: window.__ecUI.shell.metrics().world };
  });
  // F4: go down one level and back (2)
  {
    const z0 = await Z();
    await tap(page, '[data-act=level-down]'); const z1 = await Z();
    await tap(page, '[data-act=level-up]'); const z2 = await Z();
    flow('F4', 'go down one level and back', z1 === z0 - 1 && z2 === z0, `${z0} > ${z1} > ${z2} in 2 taps (budget ${BUDGET.F4})`);
  }
  // F1: Stairs down 3, then view the bottom (6): Orders, Stairs, tap a tile, Down 3, Done, the -3 tick
  {
    let taps = 0; const tile = { x: 40, y: 58 };
    await focusTiles(page, { x0: 36, y0: 54, x1: 44, y1: 62 }, 1);
    if (await tap(page, '[data-act=tab][data-tab=orders]')) taps++;
    if (await tap(page, '[data-act=order-stairs]')) taps++;
    const p = await tileScreen(page, tile.x, tile.y); await tapAt(page, p.x, p.y); taps++;
    if (await tap(page, '[data-act=lv-depth-down-3]')) taps++;
    await screen('stairs-tool');
    if (await tap(page, '[data-act=done]')) taps++;
    await page.waitForTimeout(150);
    const tick = await find(page, `[data-act=ghost-tick][data-z="${zS - 3}"]`);
    if (tick) { await tapAt(page, tick.x, tick.y); taps++; }
    const z = await Z();
    const n = await page.evaluate(([x, y]) => { const s = window.__ecUI.shell.state, G = window.__G; return (s.colony.work && s.colony.work.vdig || []).filter((e) => e[0] % (s.w * s.h) === y * s.w + x).length; }, [tile.x, tile.y]);
    flow('F1', 'Stairs down 3, then view the bottom', z === zS - 3 && n === 4 && taps <= BUDGET.F1, `${taps} taps (budget ${BUDGET.F1}); ${n} stair voxels in the column; view ${z - zS}`);
  }
  await reset(); await setZ(zS);
  // F2: a second stair at the same depth (3): Recent (long-press Orders), tap, Done
  {
    let taps = 0; const tile = { x: 42, y: 61 };
    await focusTiles(page, { x0: 40, y0: 59, x1: 44, y1: 63 }, 1);
    const ob = await find(page, '[data-act=tab][data-tab=orders]');
    if (ob) { await holdAt(page, ob.x, ob.y); taps++; }
    const open = await page.evaluate(() => { const t = window.__ecUI.shell.ui.tool; return t ? `${t.kind} ${t.id}` : 'none'; });
    const p = await tileScreen(page, tile.x, tile.y); await tapAt(page, p.x, p.y); taps++;
    if (await tap(page, '[data-act=done]')) taps++;
    const n = await page.evaluate(([x, y]) => { const s = window.__ecUI.shell.state; return (s.colony.work && s.colony.work.vdig || []).filter((e) => e[0] % (s.w * s.h) === y * s.w + x).length; }, [tile.x, tile.y]);
    const last = await page.evaluate(() => { const sh = window.__ecUI.shell; return JSON.stringify([sh.ui.lastCmd, sh.ui.lastRes]).slice(0, 200); });
    flow('F2', 'a second stair at the same depth', n === 4 && taps <= BUDGET.F2, `${taps} taps (budget ${BUDGET.F2}); Recent opened ${open}; ${n} stair voxels (depth remembered)${n === 4 ? '' : '; last ' + last}`);
  }
  await page.waitForTimeout(3200);   // the ghost column leaves 3 s after Done
  await reset(); await setZ(zS);
  // F3: jump to an endangered colonist on another level (1)
  {
    await page.evaluate((zS) => {
      const sh = window.__ecUI.shell, s = sh.state, c = s.col[3];
      c.z = zS - 3; c.x = 66 * 32 + 16; c.y = 60 * 32 + 16;
      const al = [{ id: 'bleed-3', icon: 'heart', tone: 'bad', text: `${c.name} is bleeding`, why: 'Someone with Care should tend them.', target: { colonist: c.id } }];
      sh.alerts.list = () => al; sh.alerts.update = () => {};
      sh.uiSecond();
    }, zS);
    await page.waitForTimeout(200);
    await screen('alert');
    const g2 = await page.evaluate(() => { const a = document.querySelector('.ec-alerts .ec-alert'), c = document.querySelector('.ec-lv-capsule'); if (!a || !c) return null; const ra = a.getBoundingClientRect(), rc = c.getBoundingClientRect(); return { gap: rc.top - ra.bottom, badge: !!a.querySelector('.ec-lvbadge') }; });
    geo.alertGap = g2 ? Math.round(g2.gap) : null; geo.alertBadge = g2 ? g2.badge : false;
    let taps = 0;
    if (await tap(page, '[data-act=alert]')) taps++;
    const r = await page.evaluate(() => { const sh = window.__ecUI.shell; return { z: sh.viewZ(), sel: sh.ui.sel }; });
    flow('F3', 'jump to an endangered colonist on another level', r.z === zS - 3 && r.sel && r.sel.kind === 'colonist' && taps <= BUDGET.F3, `${taps} tap (budget ${BUDGET.F3}); view ${r.z - zS}; selected ${r.sel ? r.sel.kind + ' ' + r.sel.id : 'nothing'}; alert badge ${geo.alertBadge}`);
    await screen('peek');
  }
  await reset(); await setZ(zS);
  // F9: Follow keeps the camera on a colonist across levels (4.3); the minimap shows the z-strip (4.5)
  {
    const r = await page.evaluate(async (zS) => {
      const sh = window.__ecUI.shell, c = sh.state.col[3];
      sh.ctx.follow(c.id);
      const frame = () => new Promise(requestAnimationFrame);
      c.z = zS - 6; sh.loop.poke(); for (let k = 0; k < 4; k++) await frame();
      const a = sh.viewZ();
      c.z = zS - 5; sh.loop.poke(); for (let k = 0; k < 4; k++) await frame();
      const b = sh.viewZ();
      sh.ctx.follow(null);
      return { a, b };
    }, zS);
    const mb = await tap(page, '[data-act=map]');
    await page.waitForTimeout(400);
    const strip = await page.evaluate(() => { const c = document.querySelector('.ec-zstrip-cv'); if (!c) return null; const r = c.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), px: c.width }; });
    await screen('minimap');
    if (mb) await tap(page, '[data-act=map]');
    flow('F9', 'Follow across levels; the minimap z-strip', r.a === zS - 6 && r.b === zS - 5 && strip && strip.h >= 60 && strip.px > 0, `view followed to ${r.a - zS} then ${r.b - zS}; z-strip ${strip ? strip.w + 'x' + strip.h : 'missing'}`);
  }
  await reset(); await setZ(zS);
  // F5: find the deepest dig (2): long-press the chip, Go to deepest dig
  {
    let taps = 0;
    const ch = await find(page, '[data-act=level-chip]');
    if (ch) { await holdAt(page, ch.x, ch.y); taps++; }
    if (await tap(page, '[data-act=level-deepest]')) taps++;
    const z = await Z();
    flow('F5', 'find the deepest dig', z === 0 && taps <= BUDGET.F5, `${taps} taps (budget ${BUDGET.F5}); view ${z - zS} (the shaft's foot is ${0 - zS})`);
  }
  await reset(); await setZ(zS - 1);
  // F6: mine a 5 x 5 room on this level and the one below (6): Orders, Mine, drag, Levels, 2, Done
  {
    let taps = 0; const q = { x0: 30, y0: 66, x1: 34, y1: 70 };
    await focusTiles(page, q, 1);
    if (await tap(page, '[data-act=tab][data-tab=orders]')) taps++;
    if (await tap(page, '[data-act=order-mine]')) taps++;
    const a = await tileScreen(page, q.x0, q.y0), b = await tileScreen(page, q.x1, q.y1);
    await dragWorld(page, a, b); taps++;
    if (await tap(page, '[data-act=chip-levels]')) taps++;
    if (await tap(page, '[data-act=lv-lv-2]')) taps++;
    await screen('mine-levels');
    if (await tap(page, '[data-act=done]')) taps++;
    const n = await page.evaluate(([q, zS]) => { const s = window.__ecUI.shell.state, out = []; for (const z of [zS - 1, zS - 2, zS - 3]) { let k = 0; for (let y = q.y0; y <= q.y1; y++) for (let x = q.x0; x <= q.x1; x++) if (s.L.desig[(z * s.h + y) * s.w + x] & 1) k++; out.push(k); } return out; }, [q, zS]);
    flow('F6', 'mine a 5 x 5 room on this level and the one below', n[0] === 25 && n[1] === 25 && n[2] === 0 && taps <= BUDGET.F6, `${taps} taps (budget ${BUDGET.F6}); Mine marks on -1, -2, -3: ${n.join(', ')}`);
  }
  await reset(); await setZ(zS);
  // F8: a tool drag crossing the capsule does not change level (and a second finger on the capsule is ignored)
  {
    await page.evaluate(() => window.__ecUI.shell.startTool({ kind: 'rect', id: 'mine' }));
    await page.waitForTimeout(150);
    const r = await page.evaluate(async () => {
      const sh = window.__ecUI.shell, cv = document.getElementById('view'), cap = document.querySelector('.ec-lv-capsule').getBoundingClientRect();
      const z0 = sh.viewZ();
      const ev = (el, type, p, buttons, id = 31) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 31, bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, buttons }));
      const frame = () => new Promise(requestAnimationFrame);
      const a = { x: cap.left - 120, y: cap.top + 30 }, b = { x: cap.left + cap.width / 2, y: cap.top + cap.height - 20 };
      ev(cv, 'pointerdown', a, 1); await frame(); await frame();
      for (let k = 1; k <= 10; k++) { ev(cv, 'pointermove', { x: a.x + (b.x - a.x) * k / 10, y: a.y + (b.y - a.y) * k / 10 }, 1); await frame(); }
      // a second finger lands on the down arrow while the drag owns the world
      const dn = document.querySelector('.ec-lv-down'), dr = dn.getBoundingClientRect(), hit = document.elementFromPoint(dr.left + 22, dr.top + 22);
      const under = hit && hit.closest ? !!hit.closest('.ec-levels') : false;
      ev(dn, 'pointerdown', { x: dr.left + 22, y: dr.top + 22 }, 1, 32); ev(dn, 'pointerup', { x: dr.left + 22, y: dr.top + 22 }, 0, 32);
      const mid = sh.viewZ(), drawing = !!sh.ui.stroke;
      ev(cv, 'pointerup', b, 0); await frame(); await frame();
      return { z0, mid, z1: sh.viewZ(), drawing, capsuleTakesPointer: under };
    });
    flow('F8', 'a tool drag crossing the capsule does not change level', r.z0 === r.mid && r.z0 === r.z1 && r.drawing && !r.capsuleTakesPointer, `level ${r.z0 - zS} > ${r.mid - zS} > ${r.z1 - zS}; stroke alive over the capsule: ${r.drawing}; capsule hit-testable mid-drag: ${r.capsuleTakesPointer}`);
  }
  await reset(); await setZ(zS);
  // F7 (landscape): drag the chip across 4 levels within the 291 pt world
  if (land) {
    const r = await page.evaluate(async () => {
      const sh = window.__ecUI.shell, chip = document.querySelector('.ec-lv-chip'), rc = chip.getBoundingClientRect(), w = sh.metrics().world;
      const z0 = sh.viewZ();
      const ev = (type, y, buttons) => chip.dispatchEvent(new PointerEvent(type, { pointerId: 41, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: rc.left + 22, clientY: y, button: 0, buttons }));
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      let y = rc.top + rc.height / 2, minY = y, maxY = y;
      ev('pointerdown', y, 1);
      // a quick flick down (above 300 pt/s: 8 pt a level, plus the 12 pt holds at detents) until 4 levels are passed
      for (let k = 0; k < 60 && sh.viewZ() > z0 - 4; k++) { await wait(16); y += 8; maxY = Math.max(maxY, y); ev('pointermove', y, 1); }
      ev('pointerup', y, 0);
      return { z0, z1: sh.viewZ(), travel: Math.round(maxY - minY), top: Math.round(minY), bottom: Math.round(maxY), wTop: Math.round(w.y), wBottom: Math.round(w.y + w.height), wh: Math.round(w.height) };
    });
    const inside = r.bottom <= r.wBottom + 1 && r.top >= r.wTop - 1;
    flow('F7', 'drag the chip across 4 levels in landscape within the 291 pt world', r.z1 === r.z0 - 4 && inside, `${r.z0 - zS} > ${r.z1 - zS} over ${r.travel} pt (finger ${r.top}-${r.bottom}, world ${r.wTop}-${r.wBottom}, ${r.wh} pt high)`);
    await reset(); await setZ(zS);
  }
  // the depth ruler, the coach step, 130% text
  await tap(page, '[data-act=level-chip]');
  await screen('ruler');
  const rows = await page.evaluate(() => [...document.querySelectorAll('.ec-ruler-row, .ec-ruler-fold')].map((e) => e.textContent.trim().slice(0, 30)));
  await reset();
  const coach = await page.evaluate(() => { const g = document.querySelector('.ec-guide'); return g && !g.hidden ? g.textContent.trim().slice(0, 80) : null; });
  await page.evaluate(() => { document.documentElement.dataset.ecText = '130'; window.dispatchEvent(new Event('resize')); });
  await setZ(zS - 6);
  await screen('text130');
  const plate = await page.evaluate(() => { const p = document.querySelector('.ec-lv-plate'); return p ? { w: Math.round(p.getBoundingClientRect().width), sw: p.scrollWidth, cw: p.clientWidth, t: p.textContent } : null; });
  if (plate && plate.sw > plate.cw + 1) problems.push(`[text130] band plate overflows: "${plate.t}" ${plate.sw} > ${plate.cw}`);
  await page.evaluate(() => { delete document.documentElement.dataset.ecText; });
  // geometry checks
  const sz = (r, w, h) => r && r.w >= w - 0.5 && r.h >= h - 0.5;
  if (!sz(geo.up, 44, 44) || !sz(geo.dn, 44, 44) || !sz(geo.chip, 44, 52)) problems.push(`[game] capsule controls under size: up ${geo.up && geo.up.w}x${geo.up && geo.up.h}, chip ${geo.chip && geo.chip.w}x${geo.chip && geo.chip.h}, down ${geo.dn && geo.dn.w}x${geo.dn && geo.dn.h}`);
  if (!land && geo.alertGap !== null && geo.alertGap < 12 - 0.5) problems.push(`[alert] the capsule is ${geo.alertGap} pt below the first alert (needs >= 12)`);
  if (geo.world && geo.cap && (geo.cap.b > geo.world.y + geo.world.height + 0.5 || geo.cap.y < geo.world.y - 0.5)) problems.push(`[game] the capsule leaves the world rect`);
  await ctx.close();
  return { vp: vp.name, shim: info.shim, flows, screens, problems: [...errs, ...problems], geo: { cap: geo.cap, alertGap: geo.alertGap, plate: geo.plate && Math.round(geo.plate.w), plate130: plate && plate.w }, rows, coach };
}
if (process.argv.includes('--fortress')) {
  const rep = [];
  let nbad = 0;
  for (const vp of FORT_VPS) {
    if (only && !only.split(',').includes(vp.name)) continue;
    let r;
    try { r = await runFortress(vp); } catch (e) { r = { vp: vp.name, flows: [], screens: [], problems: ['harness: ' + String(e && e.stack || e).slice(0, 400)] }; }
    r.ok = !r.problems.length && r.flows.every((f) => f.ok);
    if (!r.ok) nbad++;
    rep.push(r);
  }
  await browser.close(); await srv.close();
  writeFileSync(join(OUT, `ui-phone-fortress-${which}.json`), JSON.stringify(rep, null, 1));
  for (const r of rep) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.vp}${r.shim ? ' (C3 v3 shim)' : ''}  screens: ${r.screens.map((s) => s.name + (s.ok ? '' : `(${s.n})`)).join(' ')}`);
    for (const f of r.flows) console.log(`      ${f.ok ? 'ok  ' : 'FAIL'} ${f.id} ${f.name}: ${f.detail}`);
    for (const p of r.problems.slice(0, 14)) console.log('      ' + p);
    if (r.problems.length > 14) console.log(`      ... ${r.problems.length - 14} more`);
  }
  console.log(`ui-phone --fortress [${which}${which === 'chromium' ? ', stand-in for WebKit' : ''}]: ${nbad ? nbad + ' viewport(s) with problems' : 'all viewports clean'} (screenshots tools/out/ui-phone/fortress-*)`);
  process.exit(nbad ? 1 : 0);
}

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
    // a passable tile 3-6 tiles from the colonist, free of buildings and colonists, and reachable from it
    // (Stage 2 maps have caverns and ruins: passable pockets the colonist cannot walk to)
    const cands = await page.evaluate(async (id) => {
      const { reachable } = await import(new URL('js/game/world/regions.js', document.baseURI).href);
      const s = window.__ec.state, c = s.col.find((x) => x.id === id), W = s.w, out = [];
      const cx = Math.floor(c.x / 32), cy = Math.floor(c.y / 32);
      for (let r = 3; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy, i = y * W + x;
        if (x < 1 || y < 1 || x >= W - 1 || y >= s.h - 1) continue;
        if (s.rt.walkCost[i] === 0 || s.rt.walkCost[i] >= 250 || s.rt.occ[i] >= 0) continue;
        if (s.col.some((o) => Math.floor(o.x / 32) === x && Math.floor(o.y / 32) === y)) continue;
        if (!reachable(s, cy * W + cx, i)) continue;
        out.push({ x, y });
        if (out.length >= 24) return out;
      }
      return out;
    }, col);
    let order = null, tgt = null;
    // near a map edge the camera clamps, so a tile can sit under the peek card (landscape: the right-hand
    // panel): tap the first candidate whose point is on the map canvas, as a player would
    for (const t of drafted.includes(col) ? cands : []) {
      await focusTiles(page, { x0: t.x, y0: t.y, x1: t.x, y1: t.y }, 1);
      const q = await tileScreen(page, t.x, t.y);
      if (await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return !!el && el.tagName === 'CANVAS'; }, [q.x, q.y])) { tgt = t; break; }
    }
    if (tgt) {
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

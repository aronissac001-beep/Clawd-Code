// Gate check "Phone UI" (doc 14.4, enforced from Stage 1a; owner J; the flows are I's 14.6 acceptance).
//   node tools/ui-phone.mjs [--browser=webkit|chromium] [--vp=name,...] [--flows=title|sheets|ia-people|front|coach|all] [--a11y] [--json]
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
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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
    const s = window.__ec.state, W = s.w, H = s.h, ROCK = 9, o = (s.zS | 0) * W * H;   // the surface level (E13: a new colony has depth)
    const hb = s.bld[s.colony.hearth.id], hx = hb.x + 1, hy = hb.y + 1;
    let best = null, bd = 1e9;
    for (let y = 2; y < H - 11; y++) for (let x = 2; x < W - 11; x++) {
      const d = Math.abs(x + 4 - hx) + Math.abs(y + 4 - hy); if (d >= bd) continue;
      let ok = true; for (let yy = y; yy < y + 9 && ok; yy++) for (let xx = x; xx < x + 9 && ok; xx++) if (s.L.terrain[o + yy * W + xx] !== ROCK || s.L.desig[o + yy * W + xx] & 1) ok = false;
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
    const s = window.__ec.state, W = s.w, H = s.h, o = (s.zS | 0) * W * H;
    const BUILD = [0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0];
    const hb = s.bld[s.colony.hearth.id], hx = hb.x + 1, hy = hb.y + 1;
    let best = null, bd = 1e9;
    for (let y = 3; y < H - 8; y++) for (let x = 3; x < W - 9; x++) {
      const d = Math.abs(x + 2 - hx) + Math.abs(y + 2 - hy); if (d >= bd || d < 6) continue;
      let ok = true;
      for (let yy = y - 1; yy < y + 5 && ok; yy++) for (let xx = x - 1; xx < x + 6 && ok; xx++) { const i = o + yy * W + xx; if (!BUILD[s.L.terrain[i]] || s.rt.occ[i] >= 0 || s.L.plant[i] || s.L.zone[i] || !(s.L.fog[i >> 3] & (1 << (i & 7)))) ok = false; }
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
      const s = window.__ec.state, c = s.col.find((x) => x.id === id), W = s.w, out = [], o = (s.zS | 0) * W * s.h;
      const cx = Math.floor(c.x / 32), cy = Math.floor(c.y / 32);
      for (let r = 3; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy, i = o + y * W + x;
        if (x < 1 || y < 1 || x >= W - 1 || y >= s.h - 1) continue;
        if (s.rt.walkCost[i] === 0 || s.rt.walkCost[i] >= 250 || s.rt.occ[i] >= 0) continue;
        if (s.col.some((o) => Math.floor(o.x / 32) === x && Math.floor(o.y / 32) === y)) continue;
        if (!reachable(s, o + cy * W + cx, i)) continue;
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
    const s = window.__ec.state, W = s.w, H = s.h, o = (s.zS | 0) * W * H;
    const hb = s.bld[s.colony.hearth.id], hx = hb.x + 1, hy = hb.y + 1;
    const open = (w, h, d0) => { for (let r = d0; r < 40; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; const x = hx + dx, y = hy + dy; let ok = x > 1 && y > 1 && x + w < W - 1 && y + h < H - 1; for (let yy = y - 1; yy <= y + h && ok; yy++) for (let xx = x - 1; xx <= x + w && ok; xx++) { const i = o + yy * W + xx; if (![1, 2, 3].includes(s.L.terrain[i]) || s.rt.occ[i] >= 0 || s.L.plant[i] || s.L.zone[i] || s.rt.itemAt[i] >= 0) ok = false; } if (ok) return { x0: x, y0: y, x1: x + w - 1, y1: y + h - 1 }; } return null; };
    let rock = null, bd = 1e9;
    for (let y = 2; y < H - 11; y++) for (let x = 2; x < W - 11; x++) { const d = Math.abs(x + 4 - hx) + Math.abs(y + 4 - hy); if (d >= bd) continue; let ok = true; for (let yy = y; yy < y + 9 && ok; yy++) for (let xx = x; xx < x + 9 && ok; xx++) if (s.L.terrain[o + yy * W + xx] !== 9) ok = false; if (ok) { bd = d; rock = { x0: x, y0: y, x1: x + 8, y1: y + 8 }; } }
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

// ---- W1.4 --flows=cards,settings (EMBERCROWN-WORLD.md 8.1, 8.4, 8.6, 8.7; 11 items 9, 10, 12, 26; 12.3 W1.4) -----------
// Build cards, the peek card, the level pill and list, the Menu and Settings at the six viewports:
//   C1 (portrait) the Build panel at the medium detent (50 % of the height) shows min(8, n) whole cards on every
//      tab after its first visit (W0: 6, three of them cut); the oracle "8 build cards visible"
//   C2 no wrapped card name at 130 % text on any tab (one line each; ellipses are counted, not failed)
//   C3 "More later (N)": the locked cards fold into one row that names the reasons; a tap lists N cards
//   P1 the peek card's chevron (44 pt) opens the full sheet; P2 (landscape) the peek card is compact: <= 280 x 120
//   L1 the level pill names the band (no floating plate); a tap opens the level list sheet (44 pt rows, its two
//      buttons above the list); a row tap goes to that level and closes it
//   M1 the Menu: Save now, Back up to a file, Holds and ruins, Settings, Help, Quit to title, each with its icon
//   S1 Settings: the five groups and the jump strip; every switch toggles in one tap (aria-checked and the stored value)
// and the 14.4 probe (44 pt targets, 14 px text, no horizontal overflow) on each screen at 100 % and 130 % text.
async function runCards(vp, want) {
  const bctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
  const page = await bctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
  const problems = [], flows = [], screens = [];
  const screen = async (name) => {
    await page.waitForTimeout(200);
    const p = await probe(page);
    const list = [...(p.overflowX ? ['horizontal overflow'] : []), ...p.small.map((x) => 'target < 44 pt: ' + x), ...p.tiny.map((x) => 'text < 14 px: ' + x)];
    for (const x of list) problems.push(`[${name}] ${x}`);
    screens.push({ name, ok: !list.length, n: list.length });
    await page.screenshot({ path: join(OUT, `cards-${vp.name}-${name}.png`) });
  };
  const flow = (id, name, ok, detail) => flows.push({ id, name, ok: !!ok, detail, owner: 'I' });
  const tapIn = async (sel, block = 'nearest') => { await page.evaluate(([sel, block]) => { const e = [...document.querySelectorAll(sel)].find((x) => !x.closest('[hidden]')); if (e && e.scrollIntoView) e.scrollIntoView({ block, inline: 'nearest' }); }, [sel, block]); await page.waitForTimeout(80); return tap(page, sel); };
  const text = async (pct) => { await page.evaluate((pct) => { if (pct === 100) delete document.documentElement.dataset.ecText; else document.documentElement.dataset.ecText = String(pct); window.dispatchEvent(new Event('resize')); }, pct); await page.waitForTimeout(150); };
  const done = async () => { await bctx.close(); return { vp: vp.name, flows, screens, problems: [...errs, ...problems] }; };
  await page.goto(srv.url + '?debug=1');
  await page.waitForTimeout(700);
  await page.evaluate(() => { try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith('ec2.seen.')) localStorage.removeItem(k); } } catch (_) { /* none */ } });
  if (!(await tap(page, '[data-act=new]'))) { problems.push('no New colony button'); return done(); }
  try { await page.waitForFunction(() => window.__ecUI && window.__ecUI.shell && window.__ecUI.shell.renderer && window.__ecUI.shell.renderer.frames > 1, null, { timeout: 8000 }); } catch (_) { problems.push('no game'); return done(); }
  await page.evaluate(() => { const sh = window.__ecUI.shell; sh.setSpeed(0); sh.loop.timeScale = 0; if (sh.guide && sh.guide.el) sh.guide.el.hidden = true; });
  const land = vp.width > vp.height;
  const sheetNow = () => page.evaluate(() => {
    const e = document.querySelector('.ec-sheet'), vis = [...document.querySelectorAll('.ec-sheet')].filter((x) => !x.hidden && x.getBoundingClientRect().height > 0);
    if (!e || e.hidden) return { open: false, count: vis.length };
    const eng = window.__ecUI.shell.ctx.sheets;
    return { open: true, count: vis.length, title: eng ? eng.title() : null, detent: e.dataset.detent, crumb: [...e.querySelectorAll('.ec-crumbs .ec-crumb, .ec-crumbs h2')].map((x) => x.textContent.trim()).join(' / ') };
  });
  const closeAll = () => page.evaluate(() => { const sh = window.__ecUI.shell; sh.ctx.closeSheet(); sh.closePeek(); if (sh.ui.panel) sh.togglePanel(sh.ui.panel); });

  if (want.has('cards')) {
    // C1/C2/C3: the Build panel, every tab
    await tap(page, '[data-act=tab][data-tab=build]');
    await page.waitForTimeout(200);
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.ec-panel [data-act^=build-tab-]')].map((b) => b.dataset.tab));
    const measure = () => page.evaluate(() => {
      const pn = document.querySelector('.ec-panel'), r = pn.getBoundingClientRect(), cards = [...pn.querySelectorAll('.ec-grid > .ec-card')];
      const whole = cards.filter((c) => { const q = c.getBoundingClientRect(); return q.top >= r.top - 0.5 && q.bottom <= r.bottom + 0.5; }).length;
      const names = [...pn.querySelectorAll('.ec-bc .ec-card-n')].map((n) => { const lh = parseFloat(getComputedStyle(n).lineHeight) || parseFloat(getComputedStyle(n).fontSize) * 1.3; return { t: n.textContent, lines: Math.round(n.getBoundingClientRect().height / lh), cut: n.scrollWidth > n.clientWidth + 0.5 }; });
      const later = pn.querySelector('[data-act=build-later]');
      return { h: r.height, ih: innerHeight, n: cards.length, whole, names, note: !!pn.querySelector('.ec-help-line'), later: later ? later.textContent.trim() : null };
    });
    const firstNote = [], per = [];
    for (const id of tabs) { await tapIn(`[data-act=build-tab-${id}]`); await page.waitForTimeout(60); firstNote.push((await measure()).note); }
    for (const id of tabs) { await tapIn(`[data-act=build-tab-${id}]`); await page.waitForTimeout(60); per.push({ id, ...(await measure()) }); }
    await tapIn('[data-act=build-tab-structure]');
    await screen('build');
    if (!land) {
      const m = per[0], detentOk = Math.abs(m.h - 0.5 * m.ih) <= 2;
      const bad = per.filter((x) => x.whole < Math.min(8, x.n));
      const best = Math.max(...per.map((x) => x.whole));
      flow('C1', '8 build cards visible in the portrait medium detent', detentOk && !bad.length && best >= 8,
        `panel ${Math.round(m.h)} of ${m.ih} pt; whole cards per tab: ${per.map((x) => `${x.id} ${x.whole}/${x.n}`).join(', ')}; paragraph on first visit ${firstNote.filter(Boolean).length}/${tabs.length}, after ${per.filter((x) => x.note).length}`);
    }
    // C3: More later
    const lt = per.find((x) => x.later);
    if (lt) {
      await tapIn(`[data-act=build-tab-${lt.id}]`);
      await tapIn('[data-act=build-later]');
      const opened = await page.evaluate(() => ({ locked: document.querySelectorAll('.ec-panel .ec-bc.locked').length, exp: document.querySelector('[data-act=build-later]').getAttribute('aria-expanded') }));
      await screen('build-later');
      const n = +(/\((\d+)\)/.exec(lt.later) || [0, -1])[1];
      flow('C3', '"More later (N)" folds the locked cards and names why', opened.exp === 'true' && opened.locked === n && /Needs/.test(lt.later), `${lt.id}: "${lt.later.slice(0, 70)}"; a tap lists ${opened.locked} locked cards`);
      await tapIn('[data-act=build-later]');
    }
    // C2: 130 % text, every tab
    await text(130);
    const wrapped = [], cut = [];
    for (const id of tabs) {
      await tapIn(`[data-act=build-tab-${id}]`); await page.waitForTimeout(60);
      const m = await measure();
      for (const x of m.names) { if (x.lines > 1) wrapped.push(`${id}: ${x.t}`); if (x.cut) cut.push(x.t); }
    }
    await tapIn('[data-act=build-tab-workshops]');
    await screen('build-130');
    await text(100);
    flow('C2', 'no wrapped card name at 130 %', !wrapped.length, `${wrapped.length} wrapped${wrapped.length ? ': ' + wrapped.slice(0, 4).join('; ') : ''}; ${cut.length} shown with an ellipsis${cut.length ? ' (' + cut.slice(0, 3).join(', ') + ')' : ''}`);
    await closeAll();

    // P1/P2: the peek card
    await page.evaluate(() => { const sh = window.__ecUI.shell, c = sh.state.col[0]; sh.select({ kind: 'colonist', id: c.id }); });
    await page.waitForTimeout(250);
    const pk = await page.evaluate(() => { const p = document.querySelector('.ec-peek'), r = p.getBoundingClientRect(), o = p.querySelector('[data-act=peek-open]'), q = o && o.getBoundingClientRect();
      return { w: r.width, h: r.height, right: r.right, bottom: r.bottom, iw: innerWidth, ih: innerHeight, open: q ? { w: q.width, h: q.height, t: o.textContent.trim() } : null }; });
    await screen('peek');
    if (land) {
      await text(130); await screen('peek-130'); await text(100);
      flow('P2', 'landscape peek card is compact (<= 280 x 120)', pk.w <= 280.5 && pk.h <= 120.5 && pk.right <= pk.iw && pk.bottom <= pk.ih, `${Math.round(pk.w)} x ${Math.round(pk.h)} at right ${Math.round(pk.right)}, bottom ${Math.round(pk.bottom)} of ${pk.iw} x ${pk.ih}`);
    }
    await tap(page, '[data-act=peek-open]');
    await page.waitForTimeout(200);
    const ps = await sheetNow();
    flow('P1', 'the peek chevron opens the full sheet', pk.open && pk.open.w >= 44 && pk.open.h >= 44 && ps.open && ps.count === 1, `chevron ${pk.open ? `"${pk.open.t}" ${Math.round(pk.open.w)} x ${Math.round(pk.open.h)}` : 'missing'}; ${ps.open ? `sheet "${ps.title}"` : 'no sheet'}`);
    await closeAll();

    // L1: the level pill and the level list
    const pill = await page.evaluate(() => { const c = document.querySelector('[data-act=level-chip]'); return c ? { t: c.textContent.trim(), plate: !!document.querySelector('.ec-lv-plate'), w: c.getBoundingClientRect().width, h: c.getBoundingClientRect().height } : null; });
    if (pill) {
      await page.evaluate(() => { const sh = window.__ecUI.shell; sh.setLevel(sh.viewZ() - 2); });
      await page.waitForTimeout(150);
      const pill2 = await page.evaluate(() => document.querySelector('[data-act=level-chip]').textContent.trim());
      await screen('pill');
      await tap(page, '[data-act=level-chip]');
      await page.waitForTimeout(250);
      const ls = await sheetNow();
      const geo = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.ec-sheet [data-act=ruler-row]')], b = document.querySelector('.ec-sheet [data-act=ruler-stairs]');
        return { rows: rows.map((r) => ({ z: +r.dataset.z, h: r.getBoundingClientRect().height, top: r.getBoundingClientRect().top, on: r.classList.contains('on'), t: r.textContent.trim().slice(0, 40) })), btn: b ? b.getBoundingClientRect().bottom : null, italic: [...document.querySelectorAll('.ec-sheet .ec-lvlist *')].some((e) => getComputedStyle(e).fontStyle === 'italic') };
      });
      await screen('levels');
      const target = geo.rows.find((r) => !r.on);
      if (target) { await tapIn(`.ec-sheet [data-act=ruler-row][data-z="${target.z}"]`); await page.waitForTimeout(200); }
      const after = await sheetNow();
      const nowZ = await page.evaluate(() => window.__ecUI.shell.viewZ());
      flow('L1', 'level pill with the band name; the level list is a sheet of 44 pt rows', !pill.plate && /[A-Za-z]/.test(pill.t) && /^-2\s*\S+/.test(pill2) && pill.h >= 44 && ls.open && ls.title === 'Levels' && geo.rows.length > 0 && geo.rows.every((r) => r.h >= 44) && geo.btn !== null && geo.btn <= geo.rows[0].top + 0.5 && !geo.italic && (!target || (!after.open && nowZ === target.z)),
        `pill "${pill.t}" then "${pill2}" (${Math.round(pill.w)} x ${Math.round(pill.h)}), plate ${pill.plate ? 'shown' : 'gone'}; list "${ls.title}" ${geo.rows.length} rows (min ${Math.round(Math.min(...geo.rows.map((r) => r.h)))} pt), buttons above ${geo.btn <= (geo.rows[0] || { top: 0 }).top + 0.5}; row tap -> level ${nowZ}${target ? ` (want ${target.z})` : ''}, sheet ${after.open ? 'open' : 'closed'}`);
      await page.evaluate(() => { const sh = window.__ecUI.shell; sh.ctx.closeSheet(); sh.setLevel(sh.levels ? sh.viewZ() : sh.viewZ()); });
    }
  }

  if (want.has('settings')) {
    await closeAll();
    // M1: the Menu
    await tap(page, '[data-act=menu]');
    await page.waitForTimeout(200);
    const menu = await page.evaluate(() => [...document.querySelectorAll('.ec-sheet .ec-menu-row')].map((r) => ({ act: r.dataset.act, ic: !!r.querySelector('.ec-menu-ic .ic, .ec-menu-ic svg, .ec-menu-ic img, .ec-menu-ic canvas'), t: r.querySelector('.ec-row-n').textContent })));
    await screen('menu');
    const wantM = ['menu-save-now', 'menu-back-up', 'menu-holds', 'menu-settings', 'menu-help', 'menu-quit-to-title'];
    const got = menu.map((m) => m.act).filter((a) => a !== 'menu-letters');
    flow('M1', 'the Menu holds storage and app only, grouped, with icons', JSON.stringify(got) === JSON.stringify(wantM) && menu.every((m) => m.ic), menu.map((m) => m.t + (m.ic ? '' : ' (no icon)')).join(', '));
    // S1: Settings
    await tapIn('[data-act=menu-settings]');
    await page.waitForTimeout(250);
    const ss = await sheetNow();
    const groups = await page.evaluate(() => [...document.querySelectorAll('.ec-sheet [data-group]')].map((g) => g.dataset.group));
    await screen('settings');
    await tapIn('[data-act=set-jump-sound]');
    await page.waitForTimeout(150);
    const jump = await page.evaluate(() => { const b = document.querySelector('.ec-sheet .ec-sheet-body') || document.querySelector('.ec-sheet'), g = document.querySelector('.ec-sheet [data-group=sound]'); return Math.round(g.getBoundingClientRect().top - b.getBoundingClientRect().top); });
    await screen('settings-sound');
    const keys = await page.evaluate(() => [...document.querySelectorAll('.ec-sheet [role=switch]')].map((b) => ({ key: b.dataset.act.slice(4), off: b.getAttribute('aria-disabled') === 'true' })));
    let ok1 = 0; const bad = [], skipped = [];
    for (const k of keys) {
      if (k.off) { skipped.push(k.key); continue; }
      const read = () => page.evaluate((key) => ({ v: window.__ec.storage.readSettings()[key], a: document.querySelector(`.ec-sheet [data-act=set-${key}]`).getAttribute('aria-checked') }), k.key);
      const a = await read();
      await tapIn(`.ec-sheet [data-act=set-${k.key}]`, 'center');
      const b = await read();
      if (b.v === !a.v && b.a === String(!a.v)) ok1++; else bad.push(`${k.key} ${a.v}->${b.v} (${b.a})`);
      await tapIn(`.ec-sheet [data-act=set-${k.key}]`, 'center');   // put it back
    }
    await text(130); await screen('settings-130'); await text(100);
    flow('S1', 'Settings: five groups, a jump strip, every switch toggles in one tap',
      ss.open && ss.crumb === 'Menu / Settings' && JSON.stringify(groups) === JSON.stringify(['display', 'play', 'sound', 'storage', 'access']) && jump >= 0 && jump <= 120 && ok1 === keys.length - skipped.length && ok1 > 0,
      `"${ss.crumb}" at ${ss.detent}; groups ${groups.join(', ')}; jump to Sound puts it ${jump} pt under the sheet top; ${ok1}/${keys.length - skipped.length} switches toggle in one tap${skipped.length ? ` (${skipped.join(', ')}: Home Screen app only, explained on tap)` : ''}${bad.length ? '; failed: ' + bad.join(', ') : ''}`);
  }
  return done();
}
if (flowsArg.split(',').some((f) => f === 'cards' || f === 'settings')) {
  const want = new Set(flowsArg.split(','));
  const rep = [];
  let nbad = 0;
  for (const vp of VIEWPORTS) {
    if (only && !only.split(',').includes(vp.name)) continue;
    let r;
    try { r = await runCards(vp, want); } catch (e) { r = { vp: vp.name, flows: [], screens: [], problems: ['harness: ' + String(e && e.stack || e).slice(0, 400)] }; }
    r.ok = !r.problems.length && r.flows.length > 0 && r.flows.every((f) => f.ok);
    if (!r.ok) nbad++;
    rep.push(r);
  }
  await browser.close(); await srv.close();
  writeFileSync(join(OUT, `ui-cards-${which}.json`), JSON.stringify(rep, null, 1));
  for (const r of rep) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.vp}  screens: ${r.screens.map((x) => x.name + (x.ok ? '' : `(${x.n})`)).join(' ')}`);
    for (const f of r.flows) console.log(`      ${f.ok ? 'ok  ' : 'FAIL'} ${f.id} ${f.name}: ${f.detail}`);
    for (const p of r.problems.slice(0, 14)) console.log('      ' + p);
    if (r.problems.length > 14) console.log(`      ... ${r.problems.length - 14} more`);
  }
  console.log(`ui-phone --flows=${flowsArg} [${which}${which === 'chromium' ? ', stand-in for WebKit' : ''}]: ${nbad ? nbad + ' viewport(s) with problems' : 'all viewports clean'} (screenshots tools/out/ui-phone/cards-*.png)`);
  process.exit(nbad ? 1 : 0);
}

// ---- W1.2 --flows=sheets (EMBERCROWN-WORLD.md 8.1 G21, 8.4 G22, 12.3 W1.2) ---------------------------------------
// The sheet engine (js/ui/sheet.js createSheets) at the six viewports plus landscape-left and -right:
//   S1 "medium detent shows the selected colonist" (portrait): the colonist sits low on the map, its sheet opens
//      at the medium detent (45-55 % of the height) and the colonist is inside the uncovered world; the grabber
//      tap cycles to large (top at the top bar) and back; a swipe down from medium closes it
//   S2 "Hold / Offices / back without a second sheet": Colony > Hold > Offices pushes inside the one sheet with
//      a breadcrumb ending "/ Offices", back returns to the Hold tab, never two sheets
//   S3 "landscape sheet keeps the selection visible": 45-50 % of the width at full height, inside the safe area,
//      the colonist left of it inside the world
//   S4 "? paragraphs": the colonist sheet's paragraph shows on the first visit only, then behind "?"
// and the 14.4 probe (44 pt targets, 14 px text, no horizontal overflow) on every sheet screen at 100 % and 130 % text.
const SHEET_VPS = [...VIEWPORTS,
  { name: 'l844x335-left', width: 844, height: 335, safe: '0,0,21,47' }, { name: 'l844x335-right', width: 844, height: 335, safe: '0,47,21,0' }];
async function runSheets(vp) {
  const bctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
  const page = await bctx.newPage();
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
    await page.screenshot({ path: join(OUT, `sheets-${vp.name}-${name}.png`) });
  };
  const flow = (id, name, ok, detail) => flows.push({ id, name, ok: !!ok, detail, owner: 'I' });
  /** Tap the first visible match after scrolling it into view (tab strips scroll sideways). */
  const tapIn = async (sel) => { await page.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => !x.closest('[hidden]')); if (e && e.scrollIntoView) e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, sel); await page.waitForTimeout(80); return tap(page, sel); };
  const done = async () => { await bctx.close(); return { vp: vp.name, flows, screens, problems: [...errs, ...problems] }; };
  await page.goto(srv.url + '?debug=1' + (vp.safe ? '&safe=' + vp.safe : ''));
  await page.waitForTimeout(700);
  if (!(await tap(page, '[data-act=new]'))) { problems.push('no New colony button'); return done(); }
  try { await page.waitForFunction(() => window.__ecUI && window.__ecUI.shell && window.__ecUI.shell.renderer && window.__ecUI.shell.renderer.frames > 1, null, { timeout: 8000 }); } catch (_) { problems.push('no game'); return done(); }
  await page.evaluate(() => { const sh = window.__ecUI.shell; sh.setSpeed(0); sh.loop.timeScale = 0; if (sh.guide && sh.guide.el) sh.guide.el.hidden = true; });
  const land = vp.width > vp.height;
  // the sheet as the engine and the DOM see it
  const sheetNow = () => page.evaluate(() => {
    const sh = window.__ecUI.shell, e = document.querySelector('.ec-sheet'), all = [...document.querySelectorAll('.ec-sheet, [role=dialog].ec-sheet')];
    const vis = all.filter((x) => !x.hidden && x.getBoundingClientRect().height > 0);
    if (!e || e.hidden) return { open: false, count: vis.length };
    const r = e.getBoundingClientRect(), eng = sh.ctx.sheets;
    const crumb = [...e.querySelectorAll('.ec-crumbs .ec-crumb, .ec-crumbs h2')].map((x) => x.textContent.trim()).join(' / ');
    return { open: true, count: vis.length, top: r.top, left: r.left, right: r.right, bottom: r.bottom, w: r.width, h: r.height, iw: innerWidth, ih: innerHeight,
      detent: e.dataset.detent, crumb, title: eng ? eng.title() : null, tab: eng ? eng.tab() : null, depth: eng ? eng.depth() : null,
      intro: !!e.querySelector('.ec-sheet-intro'), ins: sh.metrics().insets };
  });
  // where the selected colonist is drawn, against the world rect the chrome leaves (after the camera settles)
  const colonistSeen = async () => {
    await page.waitForTimeout(1400);
    return page.evaluate(() => {
      const sh = window.__ecUI.shell, s = sh.state, sel = sh.ui.sel, c = sel && s.col.find((x) => x.id === sel.id);
      if (!c) return { ok: false, why: 'nothing selected' };
      const p = sh.worldToScreen(c.x, c.y), w = sh.metrics().world;
      const ok = !!w && p.x >= w.x + 8 && p.x <= w.x + w.width - 8 && p.y >= w.y + 8 && p.y <= w.y + w.height - 8;
      return { ok, p: { x: Math.round(p.x), y: Math.round(p.y) }, world: w && { x: Math.round(w.x), y: Math.round(w.y), w: Math.round(w.width), h: Math.round(w.height) } };
    });
  };
  // put the first colonist low (portrait) or right (landscape) on the map, then select it and open its sheet from the rail
  await page.evaluate((land) => {
    const sh = window.__ecUI.shell, cam = sh.camera, c = sh.state.col[0];
    cam.setZoom(1);
    if (land) cam.centerOn(c.x - cam.vw * 0.32 / cam.zoom, c.y, false); else cam.centerOn(c.x, c.y - cam.vh * 0.32 / cam.zoom, false);
    sh.loop.poke();
  }, land);
  await page.waitForTimeout(200);
  const r1 = await tap(page, '[data-act=colonist]');
  await page.waitForTimeout(250);
  // the second tap: the rail again (landscape) or the peek card's name plate (portrait: the card covers the rail)
  const r2 = land ? await tap(page, '[data-act=colonist]') : await tap(page, '.ec-peek > :nth-child(2)');
  const a = await sheetNow();
  const seen = await colonistSeen();
  await screen('colonist-medium');
  if (!land) {
    const midOk = a.open && a.detent === 'medium' && a.h >= 0.45 * a.ih - 1 && a.h <= 0.55 * a.ih + 1 + a.ins.b;
    flow('S1', 'medium detent shows the selected colonist', r1 && r2 && midOk && seen.ok,
      a.open ? `detent ${a.detent}, ${Math.round(a.h)} of ${a.ih} pt (${Math.round(100 * a.h / a.ih)} %); colonist at ${JSON.stringify(seen.p)} in world ${JSON.stringify(seen.world)}` : 'no sheet');
    // the grabber: a tap to large, a tap back to medium, a swipe down closes
    await tap(page, '[data-act=sheet-detent]');
    const b = await sheetNow();
    await screen('colonist-large');
    await page.evaluate(() => { document.documentElement.dataset.ecText = '130'; });
    await screen('colonist-large-130');
    await page.evaluate(() => { delete document.documentElement.dataset.ecText; });
    await tap(page, '[data-act=sheet-detent]');
    const c = await sheetNow();
    await page.evaluate(() => {
      const g = document.querySelector('[data-act=sheet-detent]'), r = g.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + 20;
      const o = (y, buttons) => ({ pointerId: 41, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons });
      g.dispatchEvent(new PointerEvent('pointerdown', o(y, 1))); g.dispatchEvent(new PointerEvent('pointermove', o(y + 60, 1))); g.dispatchEvent(new PointerEvent('pointerup', o(y + 80, 0)));
    });
    await page.waitForTimeout(150);
    const d = await sheetNow();
    const largeTop = (b.ins ? b.ins.t : 0) + 44;
    flow('S1b', 'grabber: tap cycles medium and large, swipe down closes', b.open && b.detent === 'large' && Math.abs(b.top - largeTop) <= 1 && c.detent === 'medium' && !d.open,
      `tap: ${b.detent} (top ${Math.round(b.top)}, want ${largeTop}); tap: ${c.detent}; swipe down: ${d.open ? 'still open' : 'closed'}`);
  } else {
    const sa = a.ins || { t: 0, r: 0, b: 0, l: 0 };
    const share = a.open ? (a.w - sa.r) / a.iw : 0;
    const full = a.open && a.top <= 0.5 && a.bottom >= a.ih - 0.5 && a.right >= a.iw - 0.5;
    flow('S3', 'landscape sheet keeps the selection visible', r1 && r2 && full && share >= 0.45 && share <= 0.5 + 0.005 && seen.ok,
      a.open ? `${Math.round(100 * share)} % of the width (+${sa.r} pt inset), top ${Math.round(a.top)} bottom ${Math.round(a.bottom)} of ${a.ih}; colonist at ${JSON.stringify(seen.p)} in world ${JSON.stringify(seen.world)}` : 'no sheet');
    await page.evaluate(() => { document.documentElement.dataset.ecText = '130'; });
    await screen('colonist-side-130');
    await page.evaluate(() => { delete document.documentElement.dataset.ecText; });
  }
  // S4: the paragraph on the first visit, then behind "?"
  const introFirst = a.intro;
  await page.evaluate(() => { const sh = window.__ecUI.shell; sh.ctx.closeSheet(); sh.openSubjectSheet({ kind: 'colonist', id: sh.state.col[0].id }); });
  await page.waitForTimeout(150);
  const again = await sheetNow();
  await tap(page, '[data-act=sheet-intro]');
  const asked = await sheetNow();
  await screen('colonist-intro');
  flow('S4', '"?" paragraphs: first visit only, then behind "?"', introFirst && !again.intro && asked.intro, `first visit ${introFirst ? 'shown' : 'not shown'}; second ${again.intro ? 'shown' : 'hidden'}; after "?" ${asked.intro ? 'shown' : 'hidden'}`);
  await page.evaluate(() => window.__ecUI.shell.ctx.closeSheet());

  // S2: Colony > Hold > Offices > back, one sheet throughout
  const counts = [];
  const tabB = await tap(page, '[data-act=tab][data-tab=colony]');
  await page.waitForTimeout(150);
  const holdB = await tapIn('.ec-sheet [data-act=sheet-tab][data-tab=Hold]');
  await page.waitForTimeout(150);
  const h0 = await sheetNow(); counts.push(h0.count);
  const offB = await tapIn('[data-act=hold-offices]');
  await page.waitForTimeout(200);
  const o = await sheetNow(); counts.push(o.count);
  await screen('hold-offices');
  await page.evaluate(() => { document.documentElement.dataset.ecText = '130'; });
  await screen('hold-offices-130');
  await page.evaluate(() => { delete document.documentElement.dataset.ecText; });
  const backB = await tap(page, '[data-act=sheet-back]');
  await page.waitForTimeout(150);
  const k = await sheetNow(); counts.push(k.count);
  const crumbOk = /^(Hold|Colony) \/ Offices$/.test(o.crumb || '');
  flow('S2', 'Hold / Offices / back without a second sheet', tabB && holdB && offB && backB && crumbOk && o.depth === 1 && k.open && k.tab === 'Hold' && k.depth === 0 && counts.every((n) => n === 1),
    `${h0.open ? `${h0.title}/${h0.tab}` : 'no Colony sheet'} > "${o.crumb}" (depth ${o.depth}) > back: ${k.open ? `${k.title}/${k.tab} depth ${k.depth}` : 'closed'}; sheets visible ${counts.join(', ')}`);
  // Menu > Settings: a push at the large detent (portrait)
  await page.evaluate(() => window.__ecUI.shell.ctx.closeSheet());
  await tap(page, '[data-act=menu]');
  await page.waitForTimeout(150);
  await screen('menu');
  const setB = await tapIn('[data-act=menu-settings]');
  await page.waitForTimeout(200);
  const st = await sheetNow();
  await screen('menu-settings');
  if (!land) flow('S5', 'Menu > Settings pushes at the large detent', setB && st.open && st.crumb === 'Menu / Settings' && st.detent === 'large' && st.count === 1, `${st.open ? `"${st.crumb}" at ${st.detent}` : 'no sheet'}; sheets visible ${st.count}`);
  return done();
}
if (flowsArg === 'sheets') {
  const rep = [];
  let nbad = 0;
  for (const vp of SHEET_VPS) {
    if (only && !only.split(',').includes(vp.name)) continue;
    let r;
    try { r = await runSheets(vp); } catch (e) { r = { vp: vp.name, flows: [], screens: [], problems: ['harness: ' + String(e && e.stack || e).slice(0, 400)] }; }
    r.ok = !r.problems.length && r.flows.length > 0 && r.flows.every((f) => f.ok);
    if (!r.ok) nbad++;
    rep.push(r);
  }
  await browser.close(); await srv.close();
  writeFileSync(join(OUT, `ui-sheets-${which}.json`), JSON.stringify(rep, null, 1));
  for (const r of rep) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.vp}  screens: ${r.screens.map((x) => x.name + (x.ok ? '' : `(${x.n})`)).join(' ')}`);
    for (const f of r.flows) console.log(`      ${f.ok ? 'ok  ' : 'FAIL'} ${f.id} ${f.name}: ${f.detail}`);
    for (const p of r.problems.slice(0, 14)) console.log('      ' + p);
    if (r.problems.length > 14) console.log(`      ... ${r.problems.length - 14} more`);
  }
  console.log(`ui-phone --flows=sheets [${which}${which === 'chromium' ? ', stand-in for WebKit' : ''}]: ${nbad ? nbad + ' viewport(s) with problems' : 'all viewports clean'} (screenshots tools/out/ui-phone/sheets-*.png)`);
  process.exit(nbad ? 1 : 0);
}

// ---- W1.3a --flows=ia-people (EMBERCROWN-WORLD.md 8.1, 8.5, 11 item 27, 12.3 W1.3a) -------------------------------
// The new shell (?shell=2 until A's flags.js SHELL2 is on) at the six viewports plus landscape-left and -right:
//   B1 "the 5-slot bar": Build | Mark | People | Hold | World beside the speed button, each slot >= 44 pt
//   P1 "the work grid <= 2 taps from the map": People, Grid
//   P2 "a colonist's skills <= 2 taps from the map": People, ">" on a row (pushed on Skills, "People / <name>")
//   P3 "the Military alert <= 2 taps from the map": People, Muster (the switch is pinned on the List)
//   P4 "the old long-press shortcuts still work": Mark re-arms the last tool, the stock chip opens Stock, a
//      portrait opens its context menu
//   P5 "Mark = Orders + Zones": one panel, two segments; "People / Military" pushes without a second sheet
//   R1 "the colonist rail collapses to +N": a narrowed rail shows fit - 1 portraits and "+N" (opens People), and
//      the rail never scrolls sideways at any viewport
// and the 14.4 probe on every new screen at 100 % (and the People list at 130 %) text.
async function runIaPeople(vp) {
  const bctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
  const page = await bctx.newPage();
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
    await page.screenshot({ path: join(OUT, `ia-${vp.name}-${name}.png`) });
  };
  const flow = (id, name, ok, detail) => flows.push({ id, name, ok: !!ok, detail, owner: 'I' });
  const done = async () => { await bctx.close(); return { vp: vp.name, flows, screens, problems: [...errs, ...problems] }; };
  const ev = (fn, a) => page.evaluate(fn, a);
  const toMap = async () => { await ev(() => { const sh = window.__ecUI.shell; if (sh.ctx.ui.tool) sh.ctx.endTool(); sh.ctx.closeSheet(); sh.ctx.closePanel(); sh.ctx.closePeek(); }); await page.waitForTimeout(120); };
  const sheetNow = () => ev(() => {
    const e = document.querySelector('.ec-sheet'), eng = window.__ecUI.shell.ctx.sheets;
    const vis = [...document.querySelectorAll('.ec-sheet')].filter((x) => !x.hidden && x.getBoundingClientRect().height > 0).length;
    if (!e || e.hidden) return { open: false, count: vis };
    const crumb = [...e.querySelectorAll('.ec-crumbs .ec-crumb, .ec-crumbs h2')].map((x) => x.textContent.trim()).join(' / ');
    return { open: true, count: vis, crumb, title: eng.title(), tab: eng.tab(), depth: eng.depth(), detent: e.dataset.detent };
  });
  const inView = (sel) => ev((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => !x.closest('[hidden]')); if (!e) return false; const r = e.getBoundingClientRect(), b = document.querySelector('.ec-sheet').getBoundingClientRect(); return r.height > 0 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1 && r.top < innerHeight; }, sel);
  const press = async (sel) => { const p = await find(page, sel); if (!p) return null; await holdAt(page, p.x, p.y, 620); return p; };
  await page.goto(srv.url + '?debug=1&shell=2' + (vp.safe ? '&safe=' + vp.safe : ''));
  await page.waitForTimeout(700);
  if (!(await tap(page, '[data-act=new]'))) { problems.push('no New colony button'); return done(); }
  try { await page.waitForFunction(() => window.__ecUI && window.__ecUI.shell && window.__ecUI.shell.renderer && window.__ecUI.shell.renderer.frames > 1, null, { timeout: 8000 }); } catch (_) { problems.push('no game'); return done(); }
  await ev(() => { const sh = window.__ecUI.shell; sh.setSpeed(0); sh.loop.timeScale = 0; if (sh.guide && sh.guide.el) sh.guide.el.hidden = true; });
  await page.waitForTimeout(300);
  // B1: the bar
  const bar = await ev(() => [...document.querySelectorAll('.ec-tabs [data-act=tab]')].map((b) => { const r = b.getBoundingClientRect(); return { id: b.dataset.tab, w: Math.round(r.width), h: Math.round(r.height), l: (b.querySelector('.ec-tab-l') || {}).textContent, fs: parseFloat(getComputedStyle(b.querySelector('.ec-tab-l')).fontSize) }; }));
  const speedOk = await ev(() => { const e = document.querySelector('.ec-speed-host .ec-speed, .ec-speed'); return !!e && e.getBoundingClientRect().width >= 44; });
  flow('B1', 'the 5-slot bar with the speed button', bar.map((b) => b.l).join(',') === 'Build,Mark,People,Hold,World' && bar.every((b) => b.w >= 44 && b.h >= 44 && b.fs >= 14) && speedOk,
    bar.map((b) => `${b.l} ${b.w}x${b.h}`).join(', ') + (speedOk ? '; speed' : '; no speed button'));
  await screen('map');
  // P1: the work grid
  let taps = 0;
  if (await tap(page, '[data-act=tab][data-tab=people]')) taps++;
  await page.waitForTimeout(200);
  const p0 = await sheetNow();
  await screen('people-list');
  const milSeen = await inView('[data-act=alert-muster]');
  await ev(() => { document.documentElement.dataset.ecText = '130'; });
  await screen('people-list-130');
  await ev(() => { delete document.documentElement.dataset.ecText; });
  if (await tap(page, '[data-act=sheet-tab][data-tab=Grid]')) taps++;
  await page.waitForTimeout(200);
  const g = await ev(() => { const e = document.querySelector('.ec-sheet .ec-wgrid'); return e ? e.querySelectorAll('[data-act^=prio-]').length : 0; });
  await screen('people-grid');
  flow('P1', 'the work grid <= 2 taps from the map', taps <= 2 && g > 0 && p0.open && p0.title === 'People', `${taps} taps; ${g} cells; sheet ${p0.open ? p0.title + '/' + p0.tab + ' at ' + p0.detent : 'closed'}`);
  if (await tap(page, '[data-act=sheet-tab][data-tab=Schedule]')) await screen('people-schedule');
  await tap(page, '[data-act=sheet-tab][data-tab=List]');
  // P2: a colonist's skills
  await toMap(); taps = 0;
  if (await tap(page, '[data-act=tab][data-tab=people]')) taps++;
  await page.waitForTimeout(150);
  if (await tap(page, '[data-act=person-open]')) taps++;
  await page.waitForTimeout(250);
  const p2 = await sheetNow();
  const skills = await ev(() => document.querySelectorAll('.ec-sheet .ec-skill').length);
  await screen('people-colonist');
  const bk = await tap(page, '[data-act=sheet-back]');
  await page.waitForTimeout(150);
  const p2b = await sheetNow();
  flow('P2', "a colonist's skills <= 2 taps from the map", taps <= 2 && p2.open && p2.tab === 'Skills' && p2.depth === 1 && /^People \/ /.test(p2.crumb) && skills > 0 && p2.count === 1 && bk && p2b.title === 'People' && p2b.depth === 0,
    `${taps} taps; "${p2.crumb}" tab ${p2.tab}, ${skills} skill rows, sheets ${p2.count}; back: ${p2b.title} depth ${p2b.depth}`);
  // P3: the Military alert
  await toMap(); taps = 0;
  if (await tap(page, '[data-act=tab][data-tab=people]')) taps++;
  await page.waitForTimeout(150);
  if (await tap(page, '[data-act=alert-muster]')) taps++;
  await page.waitForTimeout(150);
  const lv = await ev(() => { const m = window.__ecUI.shell.state.colony.mil; return m ? m.alert : 'peace'; });
  const on = await ev(() => { const b = document.querySelector('.ec-sheet [data-act=alert-muster]'); return b ? b.getAttribute('aria-checked') : null; });
  flow('P3', 'the Military alert <= 2 taps from the map', taps <= 2 && lv === 'muster' && on === 'true' && milSeen, `${taps} taps; alert ${lv}; switch on ${on}; pinned in view at open ${milSeen}`);
  await tap(page, '[data-act=alert-peace]');
  // P5: People / Military, then Mark with its two segments
  await tap(page, '[data-act=people-squads]');
  await page.waitForTimeout(200);
  const pm = await sheetNow();
  await screen('people-military');
  await toMap();
  const mk = await tap(page, '[data-act=tab][data-tab=mark]');
  await page.waitForTimeout(150);
  const m0 = await ev(() => ({ panel: window.__ecUI.shell.ctx.ui.panel, title: (document.querySelector('.ec-panel .ec-panel-head h2') || {}).textContent, orders: !!document.querySelector('.ec-panel [data-act=order-mine]') }));
  await screen('mark-orders');
  await tap(page, '[data-act=mark-zones]');
  await page.waitForTimeout(150);
  const m1 = await ev(() => ({ zones: !!document.querySelector('.ec-panel [data-act=zone-stockpile]'), seg: window.__ecUI.shell.ctx.ui.markSeg }));
  await screen('mark-zones');
  flow('P5', 'Mark = Orders + Zones; People / Military in one sheet', mk && m0.panel === 'mark' && m0.orders && m1.zones && m1.seg === 'zones' && pm.crumb === 'People / Military' && pm.count === 1,
    `panel ${m0.panel} "${m0.title}", orders ${m0.orders}, zones ${m1.zones}; "${pm.crumb}" sheets ${pm.count}`);
  // P4: the long-press shortcuts
  await tap(page, '[data-act=mark-orders]');
  await page.waitForTimeout(100);
  await tap(page, '[data-act=order-mine]');
  await page.waitForTimeout(150);
  const t0 = await ev(() => { const t = window.__ecUI.shell.ctx.ui.tool; return t ? `${t.kind}:${t.id}` : null; });
  await toMap();
  await press('[data-act=tab][data-tab=mark]');
  const t1 = await ev(() => { const t = window.__ecUI.shell.ctx.ui.tool; return t ? `${t.kind}:${t.id}` : null; });
  await toMap();
  await press('[data-act=stock]');
  await page.waitForTimeout(150);
  const st = await sheetNow();
  await screen('hold-stock');
  await toMap();
  await press('[data-act=colonist]');
  const cm = await ev(() => { const m = document.querySelector('.ec-ctxmenu'); return m && !m.hidden ? m.querySelectorAll('[role=menuitem]').length : 0; });
  await ev(() => { const s = document.querySelector('.ec-ctx-scrim'); if (s) s.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); });
  flow('P4', 'the old long-press shortcuts still work', t0 === 'rect:mine' && t1 === t0 && st.open && st.title === 'Hold' && st.tab === 'Stock' && cm > 0,
    `Mark re-arms ${t1} (was ${t0}); stock chip: ${st.open ? st.title + '/' + st.tab : 'nothing'}; portrait menu items ${cm}`);
  // Hold and World slots
  await toMap();
  await tap(page, '[data-act=tab][data-tab=hold]'); await page.waitForTimeout(150); const hs = await sheetNow(); await screen('hold');
  await toMap(); await tap(page, '[data-act=tab][data-tab=world]'); await page.waitForTimeout(150); const ws = await sheetNow(); await screen('world');
  const lit = await ev(() => (document.querySelector('.ec-tabs .ec-tab.on') || {}).dataset);
  if (!(hs.open && hs.title === 'Hold' && ws.open && ws.title === 'World' && ws.count === 1 && lit && lit.tab === 'world')) problems.push(`[slots] Hold ${hs.title}, World ${ws.title} (sheets ${ws.count}), lit ${lit && lit.tab}`);
  // R1: the rail
  await toMap();
  const natural = await ev(() => { const r = document.querySelector('.ec-rail'); return { sw: r.scrollWidth, cw: r.clientWidth, more: !!r.querySelector('[data-act=rail-more]') }; });
  const narrow = await ev(async () => {
    const r = document.querySelector('.ec-rail'), sh = window.__ecUI.shell, n = sh.state.col.length;
    const width = 44 * 2 + 4 * 2 + 16 + 4;   // room for 2 portraits and a third slot squeezed out
    r.style.maxWidth = width + 'px'; r.style.flex = '0 0 ' + width + 'px';
    window.dispatchEvent(new Event('resize'));
    await new Promise((f) => setTimeout(f, 400));
    const ports = r.querySelectorAll('[data-act=colonist]').length, more = r.querySelector('[data-act=rail-more]');
    return { n, ports, more: more ? more.textContent : null, sw: r.scrollWidth, cw: r.clientWidth };
  });
  const rm = await tap(page, '[data-act=rail-more]');
  await page.waitForTimeout(150);
  const rs = await sheetNow();
  await ev(() => { const r = document.querySelector('.ec-rail'); r.style.maxWidth = ''; r.style.flex = ''; window.dispatchEvent(new Event('resize')); });
  const want = narrow.n > narrow.ports + 0 ? `+${narrow.n - narrow.ports}` : null;
  flow('R1', 'the colonist rail collapses to +N', natural.sw <= natural.cw + 1 && narrow.more === want && narrow.sw <= narrow.cw + 1 && rm && rs.open && rs.title === 'People',
    `natural ${natural.sw}/${natural.cw}${natural.more ? ' (+N)' : ''}; narrowed: ${narrow.ports} of ${narrow.n} and ${narrow.more}, ${narrow.sw}/${narrow.cw}; +N opens ${rs.open ? rs.title : 'nothing'}`);
  return done();
}
if (flowsArg === 'ia-people') {
  const rep = [];
  let nbad = 0;
  for (const vp of SHEET_VPS) {
    if (only && !only.split(',').includes(vp.name)) continue;
    let r;
    try { r = await runIaPeople(vp); } catch (e) { r = { vp: vp.name, flows: [], screens: [], problems: ['harness: ' + String(e && e.stack || e).slice(0, 400)] }; }
    r.ok = !r.problems.length && r.flows.length > 0 && r.flows.every((f) => f.ok);
    if (!r.ok) nbad++;
    rep.push(r);
  }
  await browser.close(); await srv.close();
  writeFileSync(join(OUT, `ui-ia-people-${which}.json`), JSON.stringify(rep, null, 1));
  for (const r of rep) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.vp}  screens: ${r.screens.map((x) => x.name + (x.ok ? '' : `(${x.n})`)).join(' ')}`);
    for (const f of r.flows) console.log(`      ${f.ok ? 'ok  ' : 'FAIL'} ${f.id} ${f.name}: ${f.detail}`);
    for (const p of r.problems.slice(0, 14)) console.log('      ' + p);
    if (r.problems.length > 14) console.log(`      ... ${r.problems.length - 14} more`);
  }
  console.log(`ui-phone --flows=ia-people [${which}${which === 'chromium' ? ', stand-in for WebKit' : ''}]: ${nbad ? nbad + ' viewport(s) with problems' : 'all viewports clean'} (screenshots tools/out/ui-phone/ia-*.png)`);
  process.exit(nbad ? 1 : 0);
}

// ---- W1.6 --flows=front (EMBERCROWN-WORLD.md 8.3, 3.1, 12.3 W1.6; js/ui/front.js) -----------------------------
// The title and Holds and ruins, from an empty browser (a fresh context per viewport):
//   F1 "cold start to the map in 2 taps": no Continue, no Holds and ruins and no Worlds (REALM off) on the first
//      run; New hold reaches the map (renderer frames) in <= 2 taps
//   F2 "Continue names the hold": after a reload the title leads with "Continue: <name>" and enters in 1 tap
//   F3 "Holds and ruins": lists the hold with Continue and Delete, has Import a file, Back returns to the title
//   F4 "Options, Settings and Help": each opens in 1 tap and Back returns; Options founds from its own button
//   F5 "Worlds only with REALM": hidden by default, shown with the debug URL ?realm=1
// and the 14.4 probe (44 pt targets, 14 px text, no horizontal overflow) on each title screen at 100 % and 130 %.
async function runFront(vp) {
  const bctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
  const page = await bctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
  const problems = [], flows = [], screens = [];
  const screen = async (name, pcts = [100, 130]) => {
    for (const pct of pcts) {
      await page.evaluate((pct) => { if (pct === 100) delete document.documentElement.dataset.ecText; else document.documentElement.dataset.ecText = String(pct); window.dispatchEvent(new Event('resize')); }, pct);
      await page.waitForTimeout(220);
      // the title column scrolls: probe it scrolled to the top and to the bottom
      const list = [];
      for (const end of [0, 1]) {
        await page.evaluate((end) => { const t = document.querySelector('.ec-title'); if (t) t.scrollTop = end ? t.scrollHeight : 0; }, end);
        await page.waitForTimeout(60);
        const p = await probe(page);
        list.push(...(p.overflowX ? ['horizontal overflow'] : []), ...p.small.map((x) => 'target < 44 pt: ' + x), ...p.tiny.map((x) => 'text < 14 px: ' + x));
      }
      const uniq = [...new Set(list)];
      for (const x of uniq) problems.push(`[${name}@${pct}] ${x}`);
      screens.push({ name: `${name}@${pct}`, ok: !uniq.length, n: uniq.length });
      await page.evaluate(() => { const t = document.querySelector('.ec-title'); if (t) t.scrollTop = 0; });
      await page.screenshot({ path: join(OUT, `front-${vp.name}-${name}-${pct}.png`) });
    }
    await page.evaluate(() => { delete document.documentElement.dataset.ecText; });
  };
  const flow = (id, name, ok, detail) => flows.push({ id, name, ok: !!ok, detail, owner: 'I' });
  const done = async () => { await bctx.close(); return { vp: vp.name, flows, screens, problems: [...errs, ...problems] }; };
  const acts = () => page.evaluate(() => [...document.querySelectorAll('.ec-title [data-act]')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.dataset.act));
  const inGame = () => page.waitForFunction(() => window.__ecUI && window.__ecUI.shell && window.__ecUI.shell.renderer && window.__ecUI.shell.renderer.frames > 1, null, { timeout: 8000 }).then(() => true, () => false);
  /** Tap a title control after scrolling it into view (the column scrolls on short screens). */
  const tapT = async (sel) => { await page.evaluate((sel) => { const e = document.querySelector(sel); if (e && e.scrollIntoView) e.scrollIntoView({ block: 'nearest' }); }, sel); await page.waitForTimeout(60); return tap(page, sel); };
  await page.goto(srv.url + '?debug=1');
  await page.waitForTimeout(700);
  // F1: the first run
  const a0 = await acts();
  await screen('first');
  const firstOk = !a0.includes('continue') && !a0.includes('holds') && !a0.includes('worlds') && a0.includes('new') && a0.includes('import');
  let taps = 0, entered = false;
  const t0 = Date.now();
  if (await tapT('[data-act=new]')) { taps++; entered = await inGame(); }
  if (!entered && (await tapT('[data-act=quick]'))) { taps++; entered = await inGame(); }   // W2: New hold > Quick start
  flow('F1', 'cold start to the map in 2 taps', firstOk && entered && taps <= 2, `first run shows [${a0.join(' ')}]; ${entered ? `on the map after ${taps} tap(s), ${Date.now() - t0} ms` : 'never reached the map'}`);
  if (!entered) return done();
  const held = await page.evaluate(() => ({ id: window.__ec.state.id, name: window.__ec.state.name }));
  await page.evaluate(() => window.__ec.saveNow && window.__ec.saveNow('test')).catch(() => null);
  await page.waitForTimeout(400);
  // F2: reload; Continue leads
  await page.reload(); await page.waitForTimeout(900);
  await page.evaluate(() => window.__ecUI && window.__ecUI.title && window.__ecUI.title.refresh());
  await page.waitForTimeout(150);
  const a1 = await acts();
  const contText = await page.evaluate(() => { const b = document.querySelector('[data-act=continue]'); return b ? b.innerText.replace(/\s+/g, ' ').trim() : ''; });
  await screen('saved');
  // F3: Holds and ruins
  let f3 = 'no Holds and ruins button';
  let f3ok = false;
  if (await tapT('[data-act=holds]')) {
    const ah = await acts();
    const row = await page.evaluate(() => [...document.querySelectorAll('.ec-colony-row')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
    await screen('holds');
    const backOk = !!(await tapT('[data-act=title-back]')) && (await acts()).includes('continue');
    f3ok = row.length === 1 && ah.includes('colony-open') && ah.includes('colony-delete') && ah.includes('import') && backOk;
    f3 = `${row.length} row(s) "${(row[0] || '').slice(0, 50)}"; [${ah.join(' ')}]; back ${backOk ? 'to the title' : 'FAILED'}`;
  }
  flow('F3', 'Holds and ruins lists the hold, Import, Back', f3ok, f3);
  // F4: Options, Settings, Help
  const opened = {};
  for (const [act, want, name] of [['new-options', 'opt-found', 'options'], ['title-settings', 'title-back', 'settings'], ['title-help', 'title-back', 'help']]) {
    if (!(await tapT(`[data-act=${act}]`))) { opened[name] = 'missing'; continue; }
    const ok = (await acts()).includes(want) && (await page.evaluate(() => !!document.querySelector('.ec-title-h')));
    await screen(name, name === 'options' ? [100, 130] : [100]);
    const back = !!(await tapT('[data-act=title-back]')) && (await acts()).includes('new');
    opened[name] = ok && back ? 'ok' : `${ok ? 'opened' : 'did not open'}, ${back ? 'back' : 'no way back'}`;
  }
  flow('F4', 'Options, Settings and Help open in 1 tap and come back', Object.values(opened).every((x) => x === 'ok'), JSON.stringify(opened));
  // F2 (last: it leaves the title)
  let cont = false;
  if (await tapT('[data-act=continue]')) cont = await inGame();
  const same = cont ? await page.evaluate((id) => window.__ec.state.id === id, held.id) : false;
  flow('F2', 'Continue names the hold and enters in 1 tap', a1.includes('holds') && contText.includes(held.name) && cont && same, `[${a1.join(' ')}]; "${contText.slice(0, 60)}"; ${cont ? (same ? 'entered the same hold' : 'entered ANOTHER hold') : 'did not enter'}`);
  // F5: Worlds behind REALM (debug URL)
  await page.goto(srv.url + '?debug=1&realm=1'); await page.waitForTimeout(700);
  const a2 = await acts();
  flow('F5', 'Worlds only with REALM', !a1.includes('worlds') && !a0.includes('worlds') && a2.includes('worlds'), `default [${a1.includes('worlds') ? 'shown' : 'hidden'}], ?realm=1 [${a2.includes('worlds') ? 'shown' : 'hidden'}]`);
  return done();
}
if (flowsArg === 'front') {
  const rep = [];
  let nbad = 0;
  for (const vp of VIEWPORTS) {
    if (only && !only.split(',').includes(vp.name)) continue;
    let r;
    try { r = await runFront(vp); } catch (e) { r = { vp: vp.name, flows: [], screens: [], problems: ['harness: ' + String(e && e.stack || e).slice(0, 400)] }; }
    r.ok = !r.problems.length && r.flows.length > 0 && r.flows.every((f) => f.ok);
    if (!r.ok) nbad++;
    rep.push(r);
  }
  await browser.close(); await srv.close();
  writeFileSync(join(OUT, `ui-front-${which}.json`), JSON.stringify(rep, null, 1));
  for (const r of rep) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.vp}  screens: ${r.screens.map((x) => x.name + (x.ok ? '' : `(${x.n})`)).join(' ')}`);
    for (const f of r.flows) console.log(`      ${f.ok ? 'ok  ' : 'FAIL'} ${f.id} ${f.name}: ${f.detail}`);
    for (const p of r.problems.slice(0, 14)) console.log('      ' + p);
    if (r.problems.length > 14) console.log(`      ... ${r.problems.length - 14} more`);
  }
  console.log(`ui-phone --flows=front [${which}${which === 'chromium' ? ', stand-in for WebKit' : ''}]: ${nbad ? nbad + ' viewport(s) with problems' : 'all viewports clean'} (screenshots tools/out/ui-phone/front-*.png)`);
  process.exit(nbad ? 1 : 0);
}

// ---- W1.3b --flows=ia (EMBERCROWN-WORLD.md 8.1, 8.5, G21, 11 item 28, 12.3 W1.3b) -----------------------------------
// The Hold and World sheets in the new shell (?shell=2 until A's flags.js SHELL2 is on), at the six viewports plus
// landscape-left and -right:
//   I1-I4 "Annals, Offices, Stock and Letters each <= 2 taps from the map" (taps counted from the map)
//   I5 "Research and Stock cards above the fold": the first tech card and the first stock row lie wholly inside
//      the sheet body when the tab opens, on the first visit (the paragraph shows on Overview, then goes behind
//      "?" at the tab change) and after it; "?" shows the paragraph of the tab on show
//   I6 "the 31 screens of today checked reachable": the list below (the in-play screens at aebe07c), each reached
//      from the map by taps in the new shell and identified by what it shows
//   I7 "no stacked sheet": at most one sheet on screen after every step, and every sub-screen pushed inside the
//      sheet (depth 1, a breadcrumb under its slot, the back arrow returns to it)
// and the 14.4 probe on every Hold and World screen at 100 % (and Hold / Overview at 130 %) text.
const TODAY_SCREENS = Object.freeze([
  'build', 'orders', 'zones', 'people', 'work-roles', 'work-grid', 'schedule', 'schedule-editor', 'military', 'colonist',
  'research', 'stock', 'hold', 'chronicle', 'offices', 'justice', 'halls', 'annals', 'annals-entry', 'letters', 'factions',
  'dead', 'menu', 'settings', 'help', 'holds-and-ruins', 'peek', 'building', 'levels', 'minimap', 'stock-strip',
]);
async function runIa(vp) {
  const bctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
  const page = await bctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
  const problems = [], flows = [], screens = [], reach = [], stacked = [];
  const ev = (fn, a) => page.evaluate(fn, a);
  const screen = async (name) => {
    await page.waitForTimeout(200);
    const p = await probe(page);
    const list = [...(p.overflowX ? ['horizontal overflow'] : []), ...p.small.map((x) => 'target < 44 pt: ' + x), ...p.tiny.map((x) => 'text < 14 px: ' + x)];
    for (const x of list) problems.push(`[${name}] ${x}`);
    screens.push({ name, ok: !list.length, n: list.length });
    await page.screenshot({ path: join(OUT, `iab-${vp.name}-${name}.png`) });
  };
  const flow = (id, name, ok, detail) => flows.push({ id, name, ok: !!ok, detail, owner: 'I' });
  const done = async () => { await bctx.close(); return { vp: vp.name, flows, screens, reach, problems: [...errs, ...problems] }; };
  const toMap = async () => { await ev(() => { const sh = window.__ecUI.shell; if (sh.ctx.ui.tool) sh.ctx.endTool(); sh.ctx.closeSheet(); sh.ctx.closePanel(); sh.ctx.closePeek(); const m = document.querySelector('.ec-ctx-scrim'); if (m) m.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); }); await page.waitForTimeout(120); };
  const sheetNow = () => ev(() => {
    const e = document.querySelector('.ec-sheet'), eng = window.__ecUI.shell.ctx.sheets;
    const vis = [...document.querySelectorAll('.ec-sheet')].filter((x) => !x.hidden && x.getBoundingClientRect().height > 0).length;
    if (!e || e.hidden) return { open: false, count: vis, crumbs: [] };
    return { open: true, count: vis, crumbs: eng.crumbs(), title: eng.title(), tab: eng.tab(), depth: eng.depth(), detent: e.dataset.detent };
  });
  const has = (sel) => ev((sel) => [...document.querySelectorAll(sel)].some((x) => { if (x.closest('[hidden]')) return false; const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0; }), sel);
  /** Wholly inside the sheet body's visible box (the fold) right now. */
  const aboveFold = (sel) => ev((sel) => {
    const b = document.querySelector('.ec-sheet .ec-sheet-body'), e = b && b.querySelector(sel);
    if (!e) return { ok: false, why: 'none' };
    const r = e.getBoundingClientRect(), br = b.getBoundingClientRect(), bottom = Math.min(br.bottom, innerHeight);
    return { ok: r.top >= br.top - 1 && r.bottom <= bottom + 1, why: `${Math.round(r.top - br.top)}..${Math.round(r.bottom - br.top)} of ${Math.round(bottom - br.top)}` };
  }, sel);
  const watch = async (step) => { const n = await sheetNow(); if (n.count > 1) stacked.push(`${step}: ${n.count} sheets`); return n; };
  /** Tap through `path` (selectors, or functions run in the page) from the map; count the taps. */
  const go = async (path) => {
    let taps = 0;
    for (const p of path) {
      if (typeof p === 'function') { await ev(p); await page.waitForTimeout(150); continue; }
      const already = /data-act=sheet-tab/.test(p) && (await ev((sel) => { const e = document.querySelector('.ec-sheet ' + sel); return !!e && e.classList.contains('on'); }, p));
      if (already) continue;
      await ev((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => !x.closest('[hidden]')); if (e && e.closest('.ec-sheet-body') && e.scrollIntoView) e.scrollIntoView({ block: 'center' }); }, p);
      if (!(await tap(page, p))) return { taps, missing: p };
      taps++;
      await page.waitForTimeout(160);
      await watch(p);
    }
    return { taps, missing: null };
  };
  await page.goto(srv.url + '?debug=1&shell=2' + (vp.safe ? '&safe=' + vp.safe : ''));
  await page.waitForTimeout(700);
  if (!(await tap(page, '[data-act=new]'))) { problems.push('no New colony button'); return done(); }
  try { await page.waitForFunction(() => window.__ecUI && window.__ecUI.shell && window.__ecUI.shell.renderer && window.__ecUI.shell.renderer.frames > 1, null, { timeout: 8000 }); } catch (_) { problems.push('no game'); return done(); }
  await ev(() => { const sh = window.__ecUI.shell; sh.setSpeed(0); sh.loop.timeScale = 0; if (sh.guide && sh.guide.el) sh.guide.el.hidden = true; });
  await page.waitForTimeout(300);
  const HOLD = '[data-act=tab][data-tab=hold]', WORLD = '[data-act=tab][data-tab=world]', PEOPLE = '[data-act=tab][data-tab=people]';
  const tab = (n) => `[data-act=sheet-tab][data-tab="${n}"]`;
  // I5 first: the first visit of Research and Stock (the paragraph shows), then again behind "?"
  const fold = {};
  await go([HOLD]); const intro0 = await has('.ec-sheet .ec-sheet-intro');
  await go([tab('Research')]); fold.r1 = await aboveFold('.ec-tech'); const intro1 = await has('.ec-sheet .ec-sheet-intro');
  await screen('hold-research');
  await go([tab('Stock')]); fold.s1 = await aboveFold('[data-act^=stock-]');
  await screen('hold-stock');
  await toMap(); await go([HOLD, tab('Research')]); fold.r2 = await aboveFold('.ec-tech'); const intro2 = await has('.ec-sheet .ec-sheet-intro');
  await go([tab('Stock')]); fold.s2 = await aboveFold('[data-act^=stock-]');
  await tap(page, '[data-act=sheet-intro]'); await page.waitForTimeout(120);
  const q = await ev(() => { const p = document.querySelector('.ec-sheet .ec-sheet-intro'); return p ? p.textContent : null; });
  flow('I5', 'Research and Stock cards above the fold', fold.r1.ok && fold.s1.ok && fold.r2.ok && fold.s2.ok && intro0 && !intro1 && !intro2 && /stack/.test(q || ''),
    `first visit (paragraph ${intro0 ? 'shown' : 'not shown'} on Overview, ${intro1 ? 'still shown' : 'behind ?'} on Research): research ${fold.r1.why}, stock ${fold.s1.why}; later (${intro2 ? 'shown' : 'behind ?'}): research ${fold.r2.why}, stock ${fold.s2.why}; "?" shows "${(q || '').slice(0, 30)}"`);
  // I1-I4: the four screens and their taps from the map
  const four = [
    ['I1', 'Annals', [WORLD, tab('Annals')], '.ec-sheet .ec-annals [data-act^=annals-]', 'World'],
    ['I2', 'Offices', [HOLD, tab('Offices')], '.ec-sheet .ec-office', 'Hold'],
    ['I3', 'Stock', [HOLD, tab('Stock')], '.ec-sheet [data-act^=stock-]', 'Hold'],
    ['I4', 'Letters', [WORLD, tab('Letters')], '.ec-sheet [data-world=letters] .ec-sub', 'World'],
  ];
  for (const [id, name, path, sel, title] of four) {
    await toMap();
    const r = await go(path);
    const n = await sheetNow(), ok = !r.missing && (await has(sel));
    flow(id, `${name} <= 2 taps from the map`, ok && r.taps <= 2 && n.title === title && n.count === 1, `${r.taps} taps${r.missing ? ', missing ' + r.missing : ''}; ${n.open ? n.crumbs.join(' / ') + ' on ' + n.tab : 'no sheet'}; content ${ok}`);
    if (id === 'I1') await screen('world-annals');
    if (id === 'I2') await screen('hold-offices');
    if (id === 'I4') await screen('world-letters');
  }
  // I6 and I7: the 31 screens of today
  const pushed = [];
  const subIs = (slot) => async () => { const n = await sheetNow(); const ok = n.open && n.depth === 1 && n.crumbs[0] === slot && n.count === 1; pushed.push({ slot, crumbs: n.crumbs.join(' / '), ok }); return ok; };
  const sheetIs = (title, sel = null) => async () => { const n = await sheetNow(); return n.open && n.title === title && n.count === 1 && (!sel || (await has(sel))); };
  const panelIs = (id, sel) => async () => (await ev(() => window.__ecUI.shell.ctx.ui.panel)) === id && (await has(sel));
  const firstHearth = () => { const sh = window.__ecUI.shell, s = sh.state, hr = s.colony.hearth, b = hr && hr.id !== null ? s.bld[hr.id] : s.bld.find((x) => x && x.st === 'done'); if (b) sh.ctx.select({ kind: 'building', id: b.id }); };
  const ROUTES = {
    build: [['[data-act=tab][data-tab=build]'], panelIs('build', '.ec-panel .ec-card')],
    orders: [['[data-act=tab][data-tab=mark]', '[data-act=mark-orders]'], panelIs('mark', '[data-act=order-mine]')],
    zones: [['[data-act=tab][data-tab=mark]', '[data-act=mark-zones]'], panelIs('mark', '[data-act=zone-stockpile]')],
    people: [[PEOPLE, tab('List')], sheetIs('People', '.ec-sheet .ec-prow')],
    'work-roles': [[PEOPLE, tab('List')], sheetIs('People', '.ec-sheet [data-act=role-primary]')],
    'work-grid': [[PEOPLE, tab('Grid')], sheetIs('People', '.ec-sheet .ec-wgrid')],
    schedule: [[PEOPLE, tab('Schedule')], sheetIs('People', '.ec-sheet [data-act=sched-edit]')],
    'schedule-editor': [[PEOPLE, tab('Schedule'), '[data-act=sched-edit]'], subIs('People')],
    military: [[PEOPLE, tab('List'), '[data-act=people-squads]'], subIs('People')],
    colonist: [[PEOPLE, tab('List'), '[data-act=person-open]'], subIs('People')],
    research: [[HOLD, tab('Research')], sheetIs('Hold', '.ec-sheet .ec-tech')],
    stock: [[HOLD, tab('Stock')], sheetIs('Hold', '.ec-sheet [data-act^=stock-]')],
    hold: [[HOLD, tab('Overview')], sheetIs('Hold', '.ec-sheet [data-act=hold-chronicle]')],
    chronicle: [[HOLD, tab('Overview'), '[data-act=hold-chronicle]'], subIs('Hold')],
    offices: [[HOLD, tab('Offices'), '[data-act=hold-seg-offices]'], sheetIs('Hold', '.ec-sheet .ec-office')],
    justice: [[HOLD, tab('Offices'), '[data-act=hold-seg-justice]'], sheetIs('Hold', '.ec-sheet .ec-justice')],
    halls: [[HOLD, tab('Overview'), '[data-act=hold-halls]'], subIs('Hold')],
    annals: [[WORLD, tab('Annals')], sheetIs('World', '.ec-sheet .ec-annals')],
    'annals-entry': [[WORLD, tab('Annals'), '[data-act=annals-figures]', '[data-act=annals-entry]'], subIs('World')],
    letters: [[WORLD, tab('Letters')], sheetIs('World', '.ec-sheet [data-world=letters]')],
    factions: [[WORLD, tab('Factions')], sheetIs('World', '.ec-sheet .ec-thought')],
    dead: [[WORLD, tab('The dead')], sheetIs('World', '.ec-sheet [data-world=dead] p')],
    menu: [['[data-act=menu]'], sheetIs('Menu', '.ec-sheet [data-act=menu-settings]')],
    settings: [['[data-act=menu]', '[data-act=menu-settings]'], async () => (await sheetNow()).count === 1 && (await has('.ec-sheet .ec-swrow, .ec-sheet [role=switch]'))],
    help: [['[data-act=menu]', '[data-act=menu-help]'], async () => (await sheetNow()).count === 1 && (await has('.ec-sheet .ec-helpcard'))],
    'holds-and-ruins': [['[data-act=menu]'], async () => has('.ec-sheet [data-act=menu-holds]')],
    peek: [['[data-act=colonist]'], async () => has('.ec-peek [data-act=peek-open]')],
    building: [[firstHearth, '[data-act=peek-open]'], async () => { const n = await sheetNow(); return n.open && n.count === 1 && (await ev(() => { const sh = window.__ecUI.shell; return !!(sh.ctx.ui.sel && sh.ctx.ui.sel.kind === 'building'); })); }],
    levels: [['[data-act=level-chip]'], async () => (await sheetNow()).open || (await has('.ec-lvlist, [data-act=ruler-row]'))],
    minimap: [['[data-act=map]'], async () => ev(() => !!window.__ecUI.shell.ctx.ui.map || !!document.querySelector('.ec-minimap:not([hidden])'))],
    'stock-strip': [['[data-act=stock]'], async () => ev(() => !!window.__ecUI.shell.ctx.ui.stockOpen)],
  };
  for (const name of TODAY_SCREENS) {
    await toMap();
    const rt = ROUTES[name];
    if (!rt) { reach.push({ name, ok: false, detail: 'no route' }); continue; }
    const r = await go(rt[0]);
    let ok = false;
    try { ok = !r.missing && (await rt[1]()); } catch (e) { ok = false; }
    const n = await watch(name);
    if (name === 'minimap' || name === 'stock-strip') await tap(page, name === 'minimap' ? '[data-act=map]' : '[data-act=stock]');
    reach.push({ name, ok, taps: r.taps, detail: r.missing ? 'missing ' + r.missing : n.open ? n.crumbs.join(' / ') + (n.tab ? ' on ' + n.tab : '') : 'map' });
    if (['chronicle', 'justice', 'halls', 'factions', 'dead', 'annals-entry'].includes(name)) await screen((name.startsWith('annals') ? 'world-' : ['factions', 'dead'].includes(name) ? 'world-' : 'hold-') + name);
    // the back arrow of a pushed screen returns to its slot's sheet
    if (n.open && n.depth === 1) { await tap(page, '[data-act=sheet-back]'); await page.waitForTimeout(150); const b = await sheetNow(); if (!(b.open && b.depth === 0 && b.crumbs[0] === n.crumbs[0])) stacked.push(`${name}: back went to ${b.open ? b.crumbs.join(' / ') : 'the map'}`); }
  }
  await toMap(); await go([HOLD, tab('Overview')]);
  await screen('hold-overview');
  await ev(() => { document.documentElement.dataset.ecText = '130'; window.__ecUI.shell.ctx.refreshSheet(); });
  await screen('hold-overview-130');
  await ev(() => { delete document.documentElement.dataset.ecText; });
  const bad = reach.filter((x) => !x.ok);
  flow('I6', `the ${TODAY_SCREENS.length} screens of today reachable`, TODAY_SCREENS.length === 31 && !bad.length, `${reach.length - bad.length} of ${TODAY_SCREENS.length}${bad.length ? '; not reached: ' + bad.map((x) => `${x.name} (${x.detail})`).join(', ') : ''}; max ${Math.max(...reach.map((x) => x.taps || 0))} taps`);
  flow('I7', 'no stacked sheet', !stacked.length && pushed.length >= 5 && pushed.every((p) => p.ok), stacked.length ? stacked.join('; ') : `${pushed.length} sub-screens pushed: ${pushed.map((p) => p.crumbs).join(', ')}`);
  return done();
}
if (flowsArg === 'ia') {
  const rep = [];
  let nbad = 0;
  for (const vp of SHEET_VPS) {
    if (only && !only.split(',').includes(vp.name)) continue;
    let r;
    try { r = await runIa(vp); } catch (e) { r = { vp: vp.name, flows: [], screens: [], reach: [], problems: ['harness: ' + String(e && e.stack || e).slice(0, 400)] }; }
    r.ok = !r.problems.length && r.flows.length > 0 && r.flows.every((f) => f.ok);
    if (!r.ok) nbad++;
    rep.push(r);
  }
  await browser.close(); await srv.close();
  writeFileSync(join(OUT, `ui-ia-${which}.json`), JSON.stringify(rep, null, 1));
  for (const r of rep) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.vp}  screens: ${r.screens.map((x) => x.name + (x.ok ? '' : `(${x.n})`)).join(' ')}`);
    for (const f of r.flows) console.log(`      ${f.ok ? 'ok  ' : 'FAIL'} ${f.id} ${f.name}: ${f.detail}`);
    for (const p of r.problems.slice(0, 14)) console.log('      ' + p);
    if (r.problems.length > 14) console.log(`      ... ${r.problems.length - 14} more`);
  }
  console.log(`ui-phone --flows=ia [${which}${which === 'chromium' ? ', stand-in for WebKit' : ''}]: ${nbad ? nbad + ' viewport(s) with problems' : 'all viewports clean'} (screenshots tools/out/ui-phone/iab-*.png)`);
  process.exit(nbad ? 1 : 0);
}


// ---- W1.9 --a11y (EMBERCROWN-WORLD.md 8.10, 11 items 14 and 27, 12.3 W1.9; js/ui/a11y.js) ---------------------------
// In the new shell (?shell=2 until A's flags.js SHELL2 is on), at the six viewports plus landscape-left and -right:
//   A1 "every sheet role=dialog with a focus trap": Hold, World, People, Menu, Settings, Letters, a colonist and the
//      omen letter each show as role="dialog" aria-modal="true" with a name; focus is inside on open; Tab (the
//      controls + 2 times) and Shift+Tab (3 times) never leave it; Escape closes it (focus inside, and from outside
//      the sheet), and no focus is left inside a closed sheet
//   A2 "toasts live": the toast stack and the alert stack are aria-live="polite"; a toast lands inside the stack;
//      the hidden live region (a11y.js announce) reads the omen letter out
//   A3 "every text token >= 4.5:1 (computed)": a11y.js tokenContrast (every text token on every panel token,
//      from the live :root) and sweepContrast (every visible text node on its composited panel, on every screen)
//   A4 11 item 27: the omen letter opens at the medium detent (portrait; the side sheet in landscape) with the
//      camera turned toward the threat's edge: the edge marker is on the map left uncovered by the sheet; the
//      same for the omen re-read from World > Letters
// and the 14.4 probe on every screen.
async function runA11y(vp) {
  const bctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
  const page = await bctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
  const problems = [], flows = [], screens = [], dialogs = [], lowc = [];
  const ev = (fn, a) => page.evaluate(fn, a);
  const flow = (id, name, ok, detail) => flows.push({ id, name, ok: !!ok, detail, owner: 'I' });
  const done = async () => { await bctx.close(); return { vp: vp.name, flows, screens, problems: [...errs, ...problems] }; };
  const sweep = async (name) => {
    const r = await ev(async () => { const m = await import('./js/ui/a11y.js'); return m.sweepContrast(document.body); });
    for (const f of r.fails) lowc.push(`[${name}] "${f.text}" .${f.cls} ${f.fg} on ${f.bg} ${f.ratio}:1`);
    return r;
  };
  const screen = async (name) => {
    await page.waitForTimeout(200);
    const p = await probe(page);
    const list = [...(p.overflowX ? ['horizontal overflow'] : []), ...p.small.map((x) => 'target < 44 pt: ' + x), ...p.tiny.map((x) => 'text < 14 px: ' + x)];
    for (const x of list) problems.push(`[${name}] ${x}`);
    const c = await sweep(name);
    screens.push({ name, ok: !list.length && !c.fails.length, n: list.length + c.fails.length, checked: c.checked });
    await page.screenshot({ path: join(OUT, `a11y-${vp.name}-${name}.png`) });
  };
  const toMap = async () => { await ev(() => { const sh = window.__ecUI.shell; if (sh.ctx.ui.tool) sh.ctx.endTool(); sh.ctx.closeSheet(); sh.ctx.closePanel(); sh.ctx.closePeek(); }); await page.waitForTimeout(120); };
  /** The open sheet as a dialog: role, aria-modal, name, focus inside; then the Tab trap and Escape. */
  const dialogCheck = async (name, escFrom = 'inside') => {
    const d0 = await ev(() => {
      const e = [...document.querySelectorAll('.ec-sheet, .ec-section')].find((x) => !x.hidden && x.getClientRects().length);
      if (!e) return null;
      const n = e.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])').length;
      return { role: e.getAttribute('role'), modal: e.getAttribute('aria-modal'), label: e.getAttribute('aria-label') || '', focusIn: e.contains(document.activeElement), n };
    });
    if (!d0) { dialogs.push({ name, ok: false, why: 'no sheet' }); return; }
    let out = 0;
    const inside = () => ev(() => { const e = document.querySelector('.ec-sheet:not([hidden])') || document.querySelector('.ec-section:not([hidden])'); return !!e && e.contains(document.activeElement); });
    for (let k = 0; k < Math.min(d0.n + 2, 40); k++) { await page.keyboard.press('Tab'); if (!(await inside())) out++; }
    for (let k = 0; k < 3; k++) { await page.keyboard.press('Shift+Tab'); if (!(await inside())) out++; }
    if (escFrom === 'outside') await ev(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
    // Escape walks back the breadcrumb, then closes: press until the sheet is gone (at most 4)
    let closed = false;
    for (let k = 0; k < 4 && !closed; k++) { await page.keyboard.press('Escape'); await page.waitForTimeout(80); closed = await ev(() => !window.__ecUI.shell.ctx.sheets.isOpen()); }
    const stray = await ev(() => { const e = document.querySelector('.ec-sheet'); return !!e && e.hidden && e.contains(document.activeElement); });
    const ok = d0.role === 'dialog' && d0.modal === 'true' && !!d0.label && d0.focusIn && out === 0 && closed && !stray;
    dialogs.push({ name, ok, why: `role ${d0.role}, aria-modal ${d0.modal}, "${d0.label}", focus ${d0.focusIn ? 'in' : 'OUT'}, ${d0.n} controls, ${out} Tab escapes, Escape (${escFrom}) ${closed ? 'closed' : 'DID NOT CLOSE'}${stray ? ', focus left in the closed sheet' : ''}` });
  };
  /** Is the threat's edge marker on the uncovered map (inside the canvas, outside the open sheet)? */
  const edgeSeen = () => ev(async () => {
    const sh = window.__ecUI.shell, s = sh.state, w = await import('./js/game/threat/warnings.js'), L = await import('./js/ui/letters.js');
    const v = w.threatViews(s).find((x) => x.stage === 'omen' || x.stage === 'sighted');
    const p = L.threatPoint(v);
    if (!p) return { ok: false, why: 'no edge' };
    const q = sh.worldToScreen(p.x, p.y), cv = document.getElementById('view').getBoundingClientRect();
    const se = document.querySelector('.ec-sheet'), sr = se && !se.hidden ? se.getBoundingClientRect() : null;
    const top = (document.querySelector('.ec-top') || { getBoundingClientRect: () => ({ bottom: 0 }) }).getBoundingClientRect().bottom;
    const inCanvas = q.x >= cv.left && q.x <= cv.right && q.y >= Math.max(cv.top, top) && q.y <= cv.bottom;
    const underSheet = !!sr && q.x >= sr.left && q.x <= sr.right && q.y >= sr.top && q.y <= sr.bottom;
    return { ok: inCanvas && !underSheet, why: `edge ${v.edge ? v.edge.word : '?'} at ${Math.round(q.x)},${Math.round(q.y)}; sheet ${sr ? Math.round(sr.left) + ',' + Math.round(sr.top) : 'none'}; detent ${sh.ctx.sheets.detent()}`, detent: sh.ctx.sheets.detent() };
  });
  await page.goto(srv.url + '?debug=1&shell=2' + (vp.safe ? '&safe=' + vp.safe : ''));
  await page.waitForTimeout(700);
  if (!(await tap(page, '[data-act=new]'))) { problems.push('no New colony button'); return done(); }
  try { await page.waitForFunction(() => window.__ecUI && window.__ecUI.shell && window.__ecUI.shell.renderer && window.__ecUI.shell.renderer.frames > 1, null, { timeout: 8000 }); } catch (_) { problems.push('no game'); return done(); }
  await ev(() => { const sh = window.__ecUI.shell; sh.setSpeed(0); sh.loop.timeScale = 0; if (sh.guide && sh.guide.el) sh.guide.el.hidden = true; if (sh.prompts) sh.prompts.hide(); });
  await page.waitForTimeout(300);
  // A3, the token matrix from the live :root
  const tok = await ev(async () => { const m = await import('./js/ui/a11y.js'); return m.tokenContrast(document); });
  const tokBad = tok.filter((x) => !x.ok);
  await screen('map');
  // A1 and A3 on the sheets
  const HOLD = '[data-act=tab][data-tab=hold]', WORLD = '[data-act=tab][data-tab=world]', PEOPLE = '[data-act=tab][data-tab=people]';
  const viaTap = [['hold', [HOLD]], ['world', [WORLD]], ['people', [PEOPLE]], ['menu', ['[data-act=menu]']], ['settings', ['[data-act=menu]', '[data-act=menu-settings]']], ['letters', [WORLD, '[data-act=sheet-tab][data-tab="Letters"]']]];
  for (const [name, path] of viaTap) {
    await toMap();
    let miss = null;
    for (const p of path) { if (!(await tap(page, p))) { miss = p; break; } await page.waitForTimeout(160); }
    if (miss) { dialogs.push({ name, ok: false, why: 'no ' + miss }); continue; }
    await screen(name);
    await dialogCheck(name, name === 'world' ? 'outside' : 'inside');
  }
  await toMap();
  await ev(() => { const sh = window.__ecUI.shell, c = sh.state.col.find((x) => !x.hp.dead); if (c) sh.ctx.openColonist(c.id); });
  await page.waitForTimeout(200);
  await screen('colonist');
  await dialogCheck('colonist');
  // A2: the toast and alert stacks, a toast inside its stack
  const live = await ev(() => {
    const sh = window.__ecUI.shell, t = document.querySelector('.ec-toasts'), a = document.querySelector('.ec-alerts'), r = document.querySelector('.ec-sr-live');
    sh.ctx.toast('A test of the toast stack.');
    const inStack = !!t && [...t.querySelectorAll('.ec-toast')].some((x) => /test of the toast/.test(x.textContent));
    return { toasts: t && t.getAttribute('aria-live'), alerts: a ? a.getAttribute('aria-live') : 'none', region: r ? r.getAttribute('aria-live') + '/' + r.getAttribute('role') : null, inStack };
  });
  // A4: the omen (day 2, 18:00, Steady Flame), the camera first on the colonists
  await toMap();
  const before = await ev(() => {
    const sh = window.__ecUI.shell, s = sh.state;
    const omen = 25200;
    if (s.tick < omen + 2) window.__ec.step(omen + 2 - s.tick);
    sh.uiSecond();
    return { sheet: sh.ui.sheet };
  });
  await page.waitForTimeout(900);
  const e1 = await edgeSeen();
  const said = await ev(async () => (await import('./js/ui/a11y.js')).announced());
  await screen('omen');
  await dialogCheck('omen');
  await ev(() => { const sh = window.__ecUI.shell; sh.setSpeed(0); const cam = sh.camera, c = sh.state.col[0]; if (c) cam.centerOn(c.x, c.y, false); });
  // the omen again from World > Letters (a pushed sub-screen keeps the sheet; it turns medium and faces the edge)
  await toMap();
  await ev(() => { const sh = window.__ecUI.shell, c = sh.state.col[0]; if (c) sh.camera.centerOn(c.x, c.y, false); });
  let e2 = { ok: false, why: 'no omen row in Letters' };
  // a scripted first omen sends no 'letter' event (the storyteller's omens do: H sendLetter 'omen'); add the record
  // the storyteller would have sent, so the re-read path (letters.js openLetter) is exercised either way
  await ev(async () => {
    const sh = window.__ecUI.shell, w = await import('./js/game/threat/warnings.js'), list = sh.letters.list();
    const v = w.threatViews(sh.state).find((x) => x.stage === 'omen' || x.stage === 'sighted');
    if (v && !list.some((x) => x.kind === 'omen')) list.unshift({ id: -1, kind: 'omen', title: v.name, text: '', tick: sh.state.tick, read: true, data: { kind: 'omen', inc: v.inc } });
  });
  if ((await tap(page, WORLD)) && (await tap(page, '[data-act=sheet-tab][data-tab="Letters"]'), true)) {
    await ev(() => { const sh = window.__ecUI.shell; if (sh.ctx.sheets.setDetent) sh.ctx.sheets.setDetent('large'); });
    const where = await ev(() => { const sh = window.__ecUI.shell; return `sheet ${sh.ui.sheet} / ${sh.ctx.sheets.tab()}, ${sh.letters ? sh.letters.list().map((x) => x.kind + ':' + x.title).join('|') : 'no letters api'}`; });
    e2.why = 'no omen row in Letters (' + where + ')';
    const row = await ev(() => { const b = [...document.querySelectorAll('.ec-sheet [data-act=letter-read]')].find((x) => /omen|horde|hollow|raid/i.test(x.textContent)) || document.querySelector('.ec-sheet [data-act=letter-read]'); if (!b) return null; b.dataset.a11yPick = '1'; return b.textContent; });
    if (row && (await tap(page, '[data-a11y-pick="1"]'))) { await page.waitForTimeout(900); e2 = await edgeSeen(); e2.why = `"${row.trim().slice(0, 30)}": ${e2.why}`; await screen('omen-reread'); }
  }
  await toMap();
  const land = vp.width > vp.height;
  flow('A1', 'every sheet role=dialog with a focus trap', dialogs.length >= 8 && dialogs.every((d) => d.ok), dialogs.map((d) => `${d.name}: ${d.why}`).join('; '));
  flow('A2', 'toasts live', live.toasts === 'polite' && live.alerts === 'polite' && live.inStack && /polite/.test(live.region || '') && /Omen/.test(said), `toasts ${live.toasts}, alerts ${live.alerts}, toast in stack ${live.inStack}, live region ${live.region} said "${said.slice(0, 50)}"`);
  flow('A3', 'every text token >= 4.5:1 (computed)', !tokBad.length && !lowc.length,
    `tokens ${tok.length - tokBad.length}/${tok.length} (min ${Math.min(...tok.map((x) => x.ratio))}:1)${tokBad.length ? '; low: ' + tokBad.map((x) => `${x.fg} on ${x.bg} ${x.ratio}`).join(', ') : ''}; text nodes ${screens.reduce((a, x) => a + (x.checked || 0), 0)} checked on ${screens.length} screens${lowc.length ? '; low: ' + [...new Set(lowc)].slice(0, 8).join('; ') : ''}`);
  const det = (d) => (land ? d === 'side' : d === 'medium');
  flow('A4', 'omen letters at the medium detent facing the edge', /^Omen/.test(before.sheet || '') && e1.ok && det(e1.detent) && e2.ok && det(e2.detent), `letter "${before.sheet}": ${e1.why}; from Letters ${e2.why}`);
  return done();
}
if (process.argv.includes('--a11y') || flowsArg === 'a11y') {
  const rep = [];
  let nbad = 0;
  for (const vp of SHEET_VPS) {
    if (only && !only.split(',').includes(vp.name)) continue;
    let r;
    try { r = await runA11y(vp); } catch (e) { r = { vp: vp.name, flows: [], screens: [], problems: ['harness: ' + String(e && e.stack || e).slice(0, 400)] }; }
    r.ok = !r.problems.length && r.flows.length > 0 && r.flows.every((f) => f.ok);
    if (!r.ok) nbad++;
    rep.push(r);
  }
  await browser.close(); await srv.close();
  writeFileSync(join(OUT, `ui-a11y-${which}.json`), JSON.stringify(rep, null, 1));
  for (const r of rep) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.vp}  screens: ${r.screens.map((x) => x.name + (x.ok ? '' : `(${x.n})`)).join(' ')}`);
    for (const f of r.flows) console.log(`      ${f.ok ? 'ok  ' : 'FAIL'} ${f.id} ${f.name}: ${f.detail}`);
    for (const p of r.problems.slice(0, 14)) console.log('      ' + p);
    if (r.problems.length > 14) console.log(`      ... ${r.problems.length - 14} more`);
  }
  console.log(`ui-phone --a11y [${which}${which === 'chromium' ? ', stand-in for WebKit' : ''}]: ${nbad ? nbad + ' viewport(s) with problems' : 'all viewports clean'} (screenshots tools/out/ui-phone/a11y-*.png)`);
  process.exit(nbad ? 1 : 0);
}
// ---- W1.7 --flows=coach (EMBERCROWN-WORLD.md 8.8, G23, 12.3 W1.7; js/ui/guide.js, intros.js) ------------------------
// The new shell's onboarding (?shell=2 until A's flags.js SHELL2 is on), at the six viewports plus landscape-left and -right:
//   C1 "coach card <= 20 % of portrait height": the 6-step card measured at every step it shows (portrait viewports;
//      landscape reports its share for the record)
//   C2 "completable with Show me only": each of the 6 steps (chop, stockpile, bed, food, dig down, defend) reached
//      and finished from its "Show me" alone (no bar, panel or menu tap): the button arms the step's tool (the
//      bed and food steps arm their second part after the first), the gesture on the map and the tool's Done, and
//      the card moves on; the closing card shows after the sixth (at p390x664-safari and l844x335-safari)
//   C3 "folds to a 2/6 chip": the fold button turns the card into a chip reading "<done>/6", and the chip opens it
//   C4 hints by need (p390x664-safari): the sim stepped to the first night shows the one-line hint with "Show me",
//      which selects the Hearth; it is recorded once for this hold and does not show again
//   C5 the "What is new" deck (p390x664-safari): the W0 fixture v4-z3-day120 (a hold played before the new shell)
//      shows its deck after the Dawn Ledger closes, Next through its cards, Got it, and not again after a reload;
//      a hold founded under the new shell shows none
// and the 14.4 probe (44 pt, 14 px, no overflow) on the card, the chip, the hint and the deck.
async function runCoach(vp) {
  const bctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
  const page = await bctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
  const problems = [], flows = [], screens = [];
  const ev = (fn, a) => page.evaluate(fn, a);
  const portrait = vp.height > vp.width, full = vp.name === 'p390x664-safari' || vp.name === 'l844x335-safari', extra = vp.name === 'p390x664-safari';
  const screen = async (name) => {
    await page.waitForTimeout(150);
    const p = await probe(page);
    const list = [...(p.overflowX ? ['horizontal overflow'] : []), ...p.small.map((x) => 'target < 44 pt: ' + x), ...p.tiny.map((x) => 'text < 14 px: ' + x)];
    for (const x of list) problems.push(`[${name}] ${x}`);
    screens.push({ name, ok: !list.length, n: list.length });
    await page.screenshot({ path: join(OUT, `coach-${vp.name}-${name}.png`) });
  };
  const flow = (id, name, ok, detail) => flows.push({ id, name, ok: !!ok, detail, owner: 'I' });
  const done = async () => { await bctx.close(); return { vp: vp.name, flows, screens, problems: [...errs, ...problems] }; };
  const ready = async () => { try { await page.waitForFunction(() => window.__ecUI && window.__ecUI.shell && window.__ecUI.shell.renderer && window.__ecUI.shell.renderer.frames > 1, null, { timeout: 10000 }); return true; } catch (_) { return false; } };
  const card = () => ev(() => {
    const e = document.querySelector('.ec-guide:not(.ec-intro)');
    if (!e || e.hidden || getComputedStyle(e).display === 'none') return null;
    const r = e.getBoundingClientRect(), t = e.querySelector('.ec-guide-t'), n = e.querySelector('.ec-guide-n');
    return { h: Math.round(r.height), top: Math.round(r.top), share: r.height / innerHeight, title: t ? (t.lastChild && t.lastChild.nodeType === 3 ? t.lastChild.textContent : t.textContent) : '', n: n ? n.textContent.trim() : '', small: e.classList.contains('small'), chip: (e.querySelector('.ec-guide-chip') || {}).textContent || '', go: !!e.querySelector('[data-act=guide-go]') };
  });
  const tool = () => ev(() => { const t = window.__ecUI.shell.ctx.ui.tool; return t ? t.kind + ':' + (t.id || t.def || t.stamp || t.type || t.preset || '') : null; });
  const endTool = async () => { if (await find(page, '[data-act=done]')) await tap(page, '[data-act=done]'); if (await tool()) await ev(() => window.__ecUI.shell.ctx.endTool()); await page.waitForTimeout(80); };
  await page.goto(srv.url + '?debug=1&shell=2' + (vp.safe ? '&safe=' + vp.safe : ''));
  await page.waitForTimeout(700);
  if (!(await tap(page, '[data-act=new]'))) { problems.push('no New colony button'); return done(); }
  if (!(await ready())) { problems.push('no game'); return done(); }
  await ev(() => { const sh = window.__ecUI.shell; sh.setSpeed(0); sh.loop.timeScale = 0; });
  await page.waitForTimeout(1200);
  const shares = [];
  const c0 = await card();
  if (c0) shares.push(c0.share);
  await screen('card');
  // C3: fold and open
  await tap(page, '[data-act=guide-hide]'); await page.waitForTimeout(150);
  const folded = await card();
  await screen('chip');
  await tap(page, '[data-act=guide-open]'); await page.waitForTimeout(150);
  const opened = await card();
  flow('C3', 'folds to an n/6 chip and opens again', c0 && /^1\/6/.test(c0.n) && folded && folded.small && /^0\/6$/.test(folded.chip.trim()) && opened && !opened.small && opened.go,
    `card "${c0 ? c0.n + ' ' + c0.title : '-'}"; folded ${folded ? `"${folded.chip.trim()}"` : 'gone'}; opened ${opened ? opened.title : 'no'}`);
  if (!full) {
    flow('C1', 'coach card <= 20 % of the height', !portrait || (c0 && c0.share <= 0.2), c0 ? `${c0.h} of ${vp.height} pt (${(c0.share * 100).toFixed(1)} %)` : 'no card');
    return done();
  }
  // C2: the six steps from "Show me" alone
  const spots = [];
  const openRect = (w, h) => ev(([w, h, used]) => {
    const s = window.__ec.state, W = s.w, H = s.h, o = (s.zS | 0) * W * H;
    const hb = s.bld[s.colony.hearth.id], hx = hb.x + 1, hy = hb.y + 1;
    const clash = (x, y) => used.some((u) => x + w + 1 > u.x0 && x - 1 <= u.x1 && y + h + 1 > u.y0 && y - 1 <= u.y1);
    for (let r = 4; r < 40; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = hx + dx, y = hy + dy;
      let ok = x > 2 && y > 2 && x + w < W - 2 && y + h < H - 2 && !clash(x, y);
      for (let yy = y - 1; yy <= y + h && ok; yy++) for (let xx = x - 1; xx <= x + w && ok; xx++) { const i = o + yy * W + xx; if (![1, 2, 3].includes(s.L.terrain[i]) || s.rt.occ[i] >= 0 || s.L.plant[i] || s.L.zone[i] || s.rt.itemAt[i] >= 0) ok = false; }
      if (ok) return { x0: x, y0: y, x1: x + w - 1, y1: y + h - 1 };
    }
    return null;
  }, [w, h, spots]);
  const treesRect = () => ev(() => { const s = window.__ec.state, hb = s.bld[s.colony.hearth.id]; return { x0: hb.x - 7, y0: hb.y - 7, x1: hb.x + 9, y1: hb.y + 9 }; });
  const tapTile = async (x, y) => { await focusTiles(page, { x0: x, y0: y, x1: x, y1: y }); const p = await tileScreen(page, x, y); await tapAt(page, p.x, p.y); };
  const dragRect = async (r) => { await focusTiles(page, r, 0.8); await dragWorld(page, await tileScreen(page, r.x0, r.y0), await tileScreen(page, r.x1, r.y1)); };
  /** The gesture for the armed tool. */
  const gesture = async (t) => {
    if (t === 'rect:chop') { await dragRect(await treesRect()); await endTool(); return; }
    if (t.startsWith('zone:')) { const r = await openRect(t === 'zone:grow' ? 4 : 5, 4); if (!r) return; spots.push(r); await dragRect(r); await endTool(); return; }
    if (t === 'stamp:bedroom') { const r = await openRect(5, 4); if (!r) return; spots.push(r); await dragRect(r); await confirmIfAsked(page); await endTool(); return; }
    if (t === 'vert:stairs') { const r = await openRect(1, 1); if (!r) return; spots.push(r); await tapTile(r.x0, r.y0); await tap(page, '[data-act=done]'); await endTool(); return; }
    if (t.startsWith('place:')) {
      const n = t === 'place:brazier' ? 2 : 1;
      for (let k = 0; k < n; k++) { const r = await openRect(t === 'place:carpenter' ? 2 : 1, 1); if (!r) return; spots.push(r); await tapTile(r.x0, r.y0); }
      await endTool();
    }
  };
  const EXPECT = { 'Chop some trees': ['rect:chop'], 'Make a stockpile': ['zone:stockpile'], 'Give everyone a bed': ['place:carpenter', 'stamp:bedroom'], 'Feed the hold': ['place:campfire', 'zone:grow'], 'Dig down': ['vert:stairs'], 'Light the Hearth': ['place:brazier'] };
  const log = [];
  let navTaps = 0, wrong = 0;
  for (let k = 0; k < 6; k++) {
    const c = await card();
    if (!c || !c.go) { log.push(`step ${k + 1}: no card`); break; }
    shares.push(c.share);
    const want = EXPECT[c.title] || [];
    const armed = [];
    for (let part = 0; part < 3; part++) {
      if (!(await tap(page, '[data-act=guide-go]'))) break;
      navTaps++;
      const t = await tool();
      armed.push(t || 'none');
      if (!t) break;
      if (t !== want[part]) wrong++;
      await gesture(t);
      await page.waitForTimeout(1150);   // the coach checks once a second
      const after = await card();
      if (!after || after.title !== c.title) break;
    }
    const after = await card();
    log.push(`${c.n} ${c.title} [${armed.join(', ')}] -> ${after ? (after.go ? after.n + ' ' + after.title : after.title) : 'gone'}`);
    if (k === 2) await screen('card-step3');
  }
  const last = await card();
  if (last) shares.push(last.share);
  await screen('card-end');
  const doneIds = await ev(() => { const s = window.__ec.state; try { return (JSON.parse(localStorage.getItem('ec2.guide.' + s.id + '.c6')) || {}).done || []; } catch (_) { return []; } });
  flow('C2', 'completable with Show me only', doneIds.length === 6 && last && /begun/.test(last.title) && !wrong,
    `${doneIds.length}/6 done (${doneIds.join(', ')}) with ${navTaps} Show me taps and no other menu tap${wrong ? `; ${wrong} armed the wrong tool` : ''}: ${log.join(' | ')}; end card "${last ? last.title : '-'}"`);
  const maxShare = Math.max(...shares);
  flow('C1', 'coach card <= 20 % of the height', !portrait || maxShare <= 0.2, `max ${(maxShare * 100).toFixed(1)} % over ${shares.length} cards (${Math.round(maxShare * vp.height)} of ${vp.height} pt)${portrait ? '' : ' (landscape: for the record)'}`);
  if (!extra) return done();
  // C4: the first night's hint
  const hid = await ev(() => window.__ec.state.id);
  await tap(page, '[data-act=guide-hide]');
  await ev(() => { const s = window.__ec.state; const want = 21 * 600 + 30; if (s.tick < want) window.__ec.step(want - s.tick); });
  let hint = null;
  for (let w = 0; w < 30 && !hint; w++) { await page.waitForTimeout(250); hint = await ev(() => { const e = document.querySelector('.ec-intro.ec-needhint'); return e && !e.hidden ? { text: e.textContent, h: Math.round(e.getBoundingClientRect().height), go: !!e.querySelector('[data-act=hint-go]') } : null; }); }
  if (hint) await screen('hint');
  if (hint && hint.go) await tap(page, '[data-act=hint-go]');
  await page.waitForTimeout(200);
  const sel = await ev(() => { const sh = window.__ecUI.shell, s = sh.state, u = sh.ctx.ui.sel; return u && u.kind === 'building' && s.bld[u.id] ? s.bld[u.id].def : null; });
  const rec = await ev((id) => { try { return JSON.parse(localStorage.getItem('ec2.hints.' + id)) || []; } catch (_) { return []; } }, hid);
  await ev(() => { const sh = window.__ecUI.shell; sh.ctx.closePeek(); sh.ctx.select(null); });
  await page.waitForTimeout(1300);
  const again = await ev(() => { const e = document.querySelector('.ec-intro.ec-needhint'); return !!(e && !e.hidden); });
  flow('C4', 'the first night shows its hint once, with Show me', hint && /Hearth fed/.test(hint.text) && hint.go && sel === 'hearth' && rec.includes('night') && !again,
    hint ? `"${hint.text.slice(0, 60)}" (${hint.h} pt); Show me selected ${sel || 'nothing'}; recorded ${rec.join(', ')}; shown again ${again}` : 'no hint by 21:00 on day 1');
  // C5: the "What is new" deck on an older hold, none on a new one
  const newDeck = await ev((id) => { try { return JSON.parse(localStorage.getItem('ec2.whatsnew.' + id)); } catch (_) { return null; } }, hid);
  // a fresh device holding only the fixture: import it, then Continue from the title
  const bytes = [...readFileSync(join(HERE, 'fixtures', 'v4-z3-day120.ecsave'))];
  const dctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
  const dp = await dctx.newPage();
  dp.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
  const dev = (fn, a) => dp.evaluate(fn, a);
  const toGame = async () => {
    await dp.goto(srv.url + '?debug=1&shell=2'); await dp.waitForTimeout(800);
    if (!(await tap(dp, '[data-act=continue]'))) return false;
    try { await dp.waitForFunction(() => window.__ecUI && window.__ecUI.shell && window.__ecUI.shell.renderer && window.__ecUI.shell.renderer.frames > 1, null, { timeout: 15000 }); } catch (_) { return false; }
    await dev(() => { window.__ecUI.shell.setSpeed(0); });
    await dp.waitForTimeout(1300);
    if (await find(dp, '[data-act=ledger-close]')) await tap(dp, '[data-act=ledger-close]');
    return true;
  };
  const deckNow = () => dev(() => { const e = document.querySelector('.ec-intro.ec-deck'); return e && !e.hidden ? { n: (e.querySelector('.ec-guide-n') || {}).textContent, t: e.querySelector('.ec-guide-t').textContent } : null; });
  await dp.goto(srv.url + '?debug=1&shell=2'); await dp.waitForTimeout(600);
  const fid = await dev(async (arr) => window.__ec.storage.importBlob(new Uint8Array(arr)), bytes);
  const in1 = await toGame();
  let deck = null;
  for (let w = 0; w < 12 && !deck; w++) { await dp.waitForTimeout(250); deck = await deckNow(); }
  const seenCards = [];
  if (deck) {
    const p0 = await probe(dp), l0 = [...(p0.overflowX ? ['horizontal overflow'] : []), ...p0.small.map((x) => 'target < 44 pt: ' + x), ...p0.tiny.map((x) => 'text < 14 px: ' + x)];
    for (const x of l0) problems.push('[deck] ' + x);
    screens.push({ name: 'deck', ok: !l0.length, n: l0.length });
    await dp.screenshot({ path: join(OUT, `coach-${vp.name}-deck.png`) });
    for (let k = 0; k < 4; k++) {
      const d = await deckNow();
      if (!d) break;
      seenCards.push(d.t);
      if (!(await tap(dp, '[data-act=deck-next]'))) { await tap(dp, '[data-act=deck-ok]'); break; }
    }
  }
  const drec = await dev((id) => { try { return JSON.parse(localStorage.getItem('ec2.whatsnew.' + id)) || []; } catch (_) { return []; } }, fid);
  const in2 = await toGame();
  await dp.waitForTimeout(1500);
  const deck2 = !!(await deckNow());
  await dctx.close();
  flow('C5', 'the What is new deck on an older hold, once', in1 && in2 && deck && seenCards.length >= 1 && seenCards.length <= 3 && drec.includes('menus') && !deck2 && Array.isArray(newDeck) && newDeck.length === 3,
    `fixture day-120 hold${in1 ? '' : ' (not continued)'}: ${deck ? `"${deck.n}": ${seenCards.join(' > ')}` : 'no deck'}; recorded ${drec.join(', ')}; after a reload ${deck2 ? 'shown again' : 'none'}; new hold starts with ${Array.isArray(newDeck) ? newDeck.join(', ') : 'no record'} seen`);
  return done();
}
if (flowsArg === 'coach') {
  const rep = [];
  let nbad = 0;
  for (const vp of SHEET_VPS) {
    if (only && !only.split(',').includes(vp.name)) continue;
    let r;
    try { r = await runCoach(vp); } catch (e) { r = { vp: vp.name, flows: [], screens: [], problems: ['harness: ' + String(e && e.stack || e).slice(0, 400)] }; }
    r.ok = !r.problems.length && r.flows.length > 0 && r.flows.every((f) => f.ok);
    if (!r.ok) nbad++;
    rep.push(r);
  }
  await browser.close(); await srv.close();
  writeFileSync(join(OUT, `ui-coach-${which}.json`), JSON.stringify(rep, null, 1));
  for (const r of rep) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.vp}  screens: ${r.screens.map((x) => x.name + (x.ok ? '' : `(${x.n})`)).join(' ')}`);
    for (const f of r.flows) console.log(`      ${f.ok ? 'ok  ' : 'FAIL'} ${f.id} ${f.name}: ${f.detail}`);
    for (const p of r.problems.slice(0, 14)) console.log('      ' + p);
    if (r.problems.length > 14) console.log(`      ... ${r.problems.length - 14} more`);
  }
  console.log(`ui-phone --flows=coach [${which}${which === 'chromium' ? ', stand-in for WebKit' : ''}]: ${nbad ? nbad + ' viewport(s) with problems' : 'all viewports clean'} (screenshots tools/out/ui-phone/coach-*.png)`);
  process.exit(nbad ? 1 : 0);
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

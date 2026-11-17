// Device spike S5 and S6 against the real layout shell (owner I with J's harness; doc 14.5).
//   node tools/spike/ui-shell.mjs [--browser=webkit|chromium] [--url=http://127.0.0.1:8967/]
// Emulated: Playwright at the gate viewports (WebKit preferred; Chromium with iPhone emulation as a
// stand-in when the WebKit build is missing, recorded as such). Writes S5 and S6 into
// tools/spike/results.json (other keys are kept) and screenshots into tools/out/spike/ui-*.png.
//
// S5 (real viewport heights): at each gate viewport and with emulated safe-area insets
//   (?debug=1&safe=t,r,b,l), the visualViewport probe page, then the shell's measured world rect with
//   nothing selected and with a peek card, against the 10.1 plan; the top bar fit at 375 pt; and the
//   phone-UI audit (overflow, >= 44 pt targets, >= 14 px text) on the title, game, peek, panel, sheet
//   and tool screens.
// S6 (touch): synthetic taps with seeded Gaussian finger error (sd 4 and 6 pt) through the real input
//   path: colonist-first selection at zoom 1 and as pips at zoom 0.4, taps 30 pt off a colonist fall
//   to the tile; the speed button's hold fan (hold 300 ms, slide, release) for 1x/2x/3x/5x; the loupe
//   during a Mine drag (placement, size, label, the rectangle sent equals the aimed tiles).
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serve } from '../lib/static-server.mjs';
import { launch, installed, browserArg } from '../lib/browsers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'out', 'spike');
mkdirSync(OUT, { recursive: true });
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };

const GATE = [
  { name: 'p375x635-safari', width: 375, height: 635 }, { name: 'p390x664-safari', width: 390, height: 664 },
  { name: 'p430x740-safari', width: 430, height: 740 }, { name: 'p390x763-app', width: 390, height: 763 },
  { name: 'l844x335-safari', width: 844, height: 335 }, { name: 'l932x380-safari', width: 932, height: 380 },
];
// Emulated insets (Playwright cannot report env(safe-area-inset-*)): the Home Screen app at full height
// with the iPhone 13 status bar and home indicator, and Safari landscape with the notch sides.
const INSET = [
  { name: 'p390x844-app-insets', width: 390, height: 844, safe: '47,0,34,0', note: 'iPhone 13 standalone: 844 tall, 47 top, 34 bottom (= the 390 x 763 budget)' },
  { name: 'l844x335-safari-insets', width: 844, height: 335, safe: '0,47,0,47', note: 'iPhone 13 Safari landscape: 47 pt notch sides' },
  { name: 'l844x390-app-insets', width: 844, height: 390, safe: '0,47,21,47', note: 'iPhone 13 standalone landscape' },
];

const want = browserArg(installed('webkit') ? 'webkit' : 'chromium');
const engine = installed(want) ? want : 'chromium';
const browser = await launch(engine);
if (!browser) { console.error('ui-shell spike: no browser installed'); process.exit(2); }
const srv = arg('url') ? null : await serve(0);
const BASE = arg('url', srv && srv.url);
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ctxOpts = (vp) => ({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: engine === 'chromium' ? true : undefined, userAgent: UA });
const errors = [];
function watch(p, tag) {
  p.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`); });
  p.on('response', (r) => { if (r.status() >= 400) errors.push(`${tag}: HTTP ${r.status()} ${r.url()}`); });
}
// seeded Gaussian finger error (Box-Muller over an LCG), like tools/spike/run.mjs
let seed = 20261117;
const u = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());

/** The phone-UI audit of tools/ui-phone.mjs, run on the screen as it is now. */
const AUDIT = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  const small = [], tiny = [];
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role=button], [data-act], [onclick]')) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.width < 43.5 || r.height < 43.5) small.push(`${el.tagName.toLowerCase()}[${el.dataset.act || ''}] ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (!n.textContent.trim() || !n.parentElement || !vis(n.parentElement)) continue;
    const fs = parseFloat(getComputedStyle(n.parentElement).fontSize);
    if (fs < 13.99) tiny.push(`"${n.textContent.trim().slice(0, 20)}" ${fs}px`);
  }
  const overflowX = document.documentElement.scrollWidth > innerWidth + 0.5 || document.body.scrollWidth > innerWidth + 0.5;
  return { overflowX, small, tiny };
};
const auditOk = (a) => !a.overflowX && !a.small.length && !a.tiny.length;

async function openGame(vp, extra = '') {
  const ctx = await browser.newContext(ctxOpts(vp));
  const p = await ctx.newPage();
  watch(p, vp.name);
  await p.goto(`${BASE}?debug=1&demo=1${extra}`);
  await p.waitForSelector('[data-act=new]');
  const title = await p.evaluate(AUDIT);
  await p.tap('[data-act=new]');
  await p.waitForFunction(() => window.__ecUI && window.__ecUI.shell);
  await p.waitForTimeout(300);
  return { ctx, p, title };
}
const shellEval = (p, fn, a) => p.evaluate(fn, a);

// ---------------------------------------------------------------------------------------------------
const S5 = {};
for (const vp of [...GATE, ...INSET]) {
  const r = { viewport: [vp.width, vp.height], safe: vp.safe || '0,0,0,0' };
  if (vp.note) r.note = vp.note;
  { // the visualViewport probe page (J's harness)
    const ctx = await browser.newContext(ctxOpts(vp)); const p = await ctx.newPage(); watch(p, 's5-viewport');
    await p.goto(BASE + 'tools/spike/pages/s5-viewport.html'); await p.waitForFunction('window.RESULT');
    r.probe = await p.evaluate(() => window.RESULT); await ctx.close();
  }
  const { ctx, p, title } = await openGame(vp, vp.safe ? `&safe=${vp.safe}` : '');
  r.audit = { title };
  const m0 = await shellEval(p, () => window.__ecUI.shell.metrics());
  r.plan = m0.plan; r.insets = m0.insets; r.landscape = m0.landscape;
  r.world = m0.world;
  r.audit.game = await p.evaluate(AUDIT);
  await p.screenshot({ path: join(OUT, `ui-${vp.name}-game.png`) });
  // top bar fit: children in order, no overlap, inside the bar's content box
  r.topBar = await p.evaluate(() => {
    const top = document.querySelector('.ec-top'), cs = getComputedStyle(top), tr = top.getBoundingClientRect();
    const x0 = tr.left + parseFloat(cs.paddingLeft), x1 = tr.right - parseFloat(cs.paddingRight);
    const kids = [...top.querySelectorAll('.ec-menu, .ec-clock, .ec-threat, .ec-stock')].filter((e) => !e.hidden).map((e) => { const b = e.getBoundingClientRect(); return { k: e.className.split(' ').pop(), l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) }; });
    let ok = kids.every((k) => k.l >= x0 - 0.5 && k.r <= x1 + 0.5);
    for (let i = 1; i < kids.length; i++) if (kids[i].l < kids[i - 1].r) ok = false;
    return { content: Math.round(x1 - x0), used: kids.length ? kids[kids.length - 1].r - kids[0].l : 0, kids, ok };
  });
  // with a peek card: tap the first demo colonist
  await shellEval(p, () => { const sh = window.__ecUI.shell; sh.select({ kind: 'colonist', id: sh.state.col[0].id }); });
  await p.waitForTimeout(120);
  r.worldPeek = (await shellEval(p, () => window.__ecUI.shell.metrics())).world;
  r.audit.peek = await p.evaluate(AUDIT);
  await p.screenshot({ path: join(OUT, `ui-${vp.name}-peek.png`) });
  await shellEval(p, () => window.__ecUI.shell.togglePanel('orders')); await p.waitForTimeout(80);
  r.audit.panel = await p.evaluate(AUDIT);
  await p.screenshot({ path: join(OUT, `ui-${vp.name}-orders.png`) });
  await shellEval(p, () => window.__ecUI.shell.openColony('People')); await p.waitForTimeout(80);
  r.audit.sheet = await p.evaluate(AUDIT);
  await shellEval(p, () => window.__ecUI.shell.openMenu()); await p.waitForTimeout(80);
  r.audit.menu = await p.evaluate(AUDIT);
  await shellEval(p, () => { window.__ecUI.shell.startTool('mine'); }); await p.waitForTimeout(80);
  r.audit.tool = await p.evaluate(AUDIT);
  await p.screenshot({ path: join(OUT, `ui-${vp.name}-tool.png`) });
  await ctx.close();
  const pl = r.plan;
  r.check = {
    worldMatchesPlan: Math.abs(r.world.height - pl.height) <= 1 && Math.abs(r.worldPeek.height - pl.heightPeek) <= 1,
    gateWorld: vp.name === 'p390x664-safari' ? r.world.height >= 480 && r.worldPeek.height >= 400 : null,
    audits: Object.fromEntries(Object.entries(r.audit).map(([k, a]) => [k, auditOk(a) ? 'ok' : a])),
  };
  S5[vp.name] = r;
  console.log(`S5 ${vp.name}: world ${r.world.width}x${r.world.height} (plan ${pl.height}), peek ${r.worldPeek.width}x${r.worldPeek.height} (plan ${pl.heightPeek}${pl.landscape ? `, width ${pl.widthPeek}` : ''}), top bar ${r.topBar.used}/${r.topBar.content} ${r.topBar.ok ? 'fits' : 'OVERLAP'}, audits ${Object.values(r.check.audits).every((x) => x === 'ok') ? 'clean' : JSON.stringify(r.check.audits)}`);
}

// ---------------------------------------------------------------------------------------------------
const S6 = { colonist: {}, speedFan: {}, loupe: {} };
{
  const vp = GATE[1];
  const { ctx, p } = await openGame(vp);
  // (a) colonist-first taps, zoom 1 and pips at zoom 0.4
  for (const zoom of [1, 0.4]) {
    for (const sd of [4, 6]) {
      const tally = { colonist: { taps: 0, hits: 0 }, offBy30: { taps: 0, hits: 0 } };
      for (let k = 0; k < 20; k++) {
        const tgt = await shellEval(p, ({ zoom, k }) => {
          const sh = window.__ecUI.shell, s = sh.state, c = s.col[k % s.col.length];
          sh.closePeek(); sh.camera.zoom = zoom; sh.camera.centerOn(c.x, c.y, false); sh.loop.poke();
          const by = zoom < 0.5 ? 0 : 32 * 0.35;  // pick.js: the body centre sits 0.35 tile above the feet
          const at = sh.worldToScreen(c.x, c.y - by);
          // a point 30 pt from this colonist, on the side away from the others (and >= 30 pt from all)
          let off = null;
          for (const [dx, dy] of [[0, 30], [30, 0], [-30, 0], [0, -30], [21, 21], [-21, 21]]) {
            const q = { x: at.x + dx, y: at.y + dy };
            const near = s.col.some((o) => { const op = sh.worldToScreen(o.x, o.y - by); return Math.hypot(op.x - q.x, op.y - q.y) < 30; });
            if (!near) { off = q; break; }
          }
          return { id: c.id, at, off };
        }, { zoom, k });
        await p.waitForTimeout(40);
        await p.touchscreen.tap(tgt.at.x + gauss() * sd, tgt.at.y + gauss() * sd);
        await p.waitForTimeout(60);
        const sel = await shellEval(p, () => window.__ecUI.shell.ui.sel);
        tally.colonist.taps++; if (sel && sel.kind === 'colonist' && sel.id === tgt.id) tally.colonist.hits++;
        if (tgt.off) {
          await shellEval(p, () => window.__ecUI.shell.closePeek());
          // aimed 30 pt away: within 22 pt (zoom 1) the colonist would win; here the tile should
          await p.touchscreen.tap(tgt.off.x + gauss() * sd, tgt.off.y + gauss() * sd);
          await p.waitForTimeout(60);
          const s2 = await shellEval(p, () => window.__ecUI.shell.ui.sel);
          tally.offBy30.taps++; if (s2 && s2.kind !== 'colonist') tally.offBy30.hits++;
        }
      }
      for (const v of Object.values(tally)) v.rate = v.taps ? +(v.hits / v.taps).toFixed(2) : null;
      S6.colonist[`zoom${zoom}-sd${sd}pt`] = tally;
    }
  }
  await shellEval(p, () => { const sh = window.__ecUI.shell; sh.closePeek(); sh.camera.zoom = 1; });
  // (b) the speed fan: hold, slide to the button (with finger error), release
  const fanOf = async () => shellEval(p, () => [...document.querySelectorAll('.ec-fan-btn')].map((b) => { const r = b.getBoundingClientRect(); return { v: +b.dataset.speed, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }));
  const sb = await shellEval(p, () => { const r = document.querySelector('.ec-speed').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  // tap pauses and resumes
  await p.touchscreen.tap(sb.x, sb.y); await p.waitForTimeout(60);
  const pausedAfterTap = await shellEval(p, () => window.__ecUI.shell.ui.speed === 0);
  await p.touchscreen.tap(sb.x, sb.y); await p.waitForTimeout(60);
  const resumedAfterTap = await shellEval(p, () => window.__ecUI.shell.ui.speed > 0);
  S6.speedFan.tap = { pausedAfterTap, resumedAfterTap };
  for (const sd of [4, 6]) {
    const t = {};
    for (const v of [1, 2, 3, 5]) {
      t[v + 'x'] = { tries: 0, hits: 0 };
      for (let k = 0; k < 10; k++) {
        await shellEval(p, () => { const sh = window.__ecUI.shell; sh.speed.close(); });
        await p.mouse.move(sb.x, sb.y); await p.mouse.down();
        await p.waitForTimeout(320);
        const fan = await fanOf();
        const f = fan.find((b) => b.v === v);
        const tx = f.x + gauss() * sd, ty = f.y + gauss() * sd;
        await p.mouse.move((sb.x + tx) / 2, (sb.y + ty) / 2); await p.mouse.move(tx, ty);
        await p.mouse.up(); await p.waitForTimeout(40);
        const got = await shellEval(p, () => window.__ecUI.shell.ui.speed);
        t[v + 'x'].tries++; if (got === v) t[v + 'x'].hits++;
      }
      t[v + 'x'].rate = +(t[v + 'x'].hits / t[v + 'x'].tries).toFixed(2);
    }
    S6.speedFan['sd' + sd + 'pt'] = t;
  }
  // fan geometry at every gate viewport is checked below; here the hold-release-on-button keeps it open
  await p.mouse.move(sb.x, sb.y); await p.mouse.down(); await p.waitForTimeout(320); await p.mouse.up(); await p.waitForTimeout(40);
  S6.speedFan.staysOpenOnRelease = await shellEval(p, () => window.__ecUI.shell.speed.isOpen);
  await p.screenshot({ path: join(OUT, 'ui-s6-fan.png') });
  const fanTap = (await fanOf()).find((b) => b.v === 2);
  await p.touchscreen.tap(fanTap.x, fanTap.y); await p.waitForTimeout(60);
  S6.speedFan.tapInOpenFan = await shellEval(p, () => window.__ecUI.shell.ui.speed === 2 && !window.__ecUI.shell.speed.isOpen);
  // (c) the loupe during a Mine drag: aim at tile centres (with finger error) of a 6 x 4 rectangle
  await shellEval(p, () => { const sh = window.__ecUI.shell; sh.speed.close(); sh.startTool('mine'); });
  const trials = [];
  for (const sd of [0, 4]) {
    for (let k = 0; k < 6; k++) {
      const plan = await shellEval(p, (k) => {
        const sh = window.__ecUI.shell, T = 32, w = sh.metrics().world;
        const cxw = sh.camera.x, cyw = sh.camera.y;
        const tx0 = Math.floor(cxw / T) - 3 + (k % 2), ty0 = Math.floor(cyw / T) - 1 + (k % 3) - 1;
        const a = sh.worldToScreen((tx0 + 0.5) * T, (ty0 + 0.5) * T), b = sh.worldToScreen((tx0 + 5 + 0.5) * T, (ty0 + 3 + 0.5) * T);
        return { a, b, rect: { x0: tx0, y0: ty0, x1: tx0 + 5, y1: ty0 + 3 }, world: w };
      }, k);
      const ax = plan.a.x + gauss() * sd, ay = plan.a.y + gauss() * sd, bx = plan.b.x + gauss() * sd, by = plan.b.y + gauss() * sd;
      await p.mouse.move(ax, ay); await p.mouse.down();
      for (let j = 1; j <= 8; j++) { await p.mouse.move(ax + ((bx - ax) * j) / 8, ay + ((by - ay) * j) / 8); await p.waitForTimeout(16); }
      await p.waitForTimeout(80);
      const mid = await shellEval(p, () => { const l = document.querySelector('.ec-loupe'); const r = l.getBoundingClientRect(); return { shown: !l.hidden, x: r.left, y: r.top, w: r.width, h: r.height, label: document.querySelector('.ec-loupe-label').textContent, pos: window.__ecUI.shell.loupe.pos }; });
      if (k === 0 && sd === 0) await p.screenshot({ path: join(OUT, 'ui-s6-loupe.png') });
      await p.mouse.up(); await p.waitForTimeout(60);
      const cmd = await shellEval(p, () => window.__ecUI.shell.ui.lastCmd || null);
      const fingerUnder = mid.shown && bx >= mid.x && bx <= mid.x + mid.w && by >= mid.y && by <= mid.y + mid.h;
      const inWorld = mid.shown && mid.x >= plan.world.x - 0.5 && mid.y >= plan.world.y - 0.5 && mid.x + mid.w <= plan.world.x + plan.world.width + 0.5 && mid.y + mid.h <= plan.world.y + plan.world.height + 0.5;
      const lift = mid.pos ? Math.round(mid.pos.fy - mid.pos.y) : null;
      trials.push({ sd, shown: mid.shown, size: [Math.round(mid.w), Math.round(mid.h)], centreAboveFinger: lift, fingerUnderLoupe: fingerUnder, inWorld, label: mid.label,
        aimed: plan.rect, sent: cmd && cmd.rect, exact: !!(cmd && cmd.rect && cmd.rect.x0 === plan.rect.x0 && cmd.rect.y0 === plan.rect.y0 && cmd.rect.x1 === plan.rect.x1 && cmd.rect.y1 === plan.rect.y1) });
    }
  }
  // near the top of the world: the loupe must go beside the finger, not under it
  {
    const wtop = await shellEval(p, () => window.__ecUI.shell.metrics().world);
    const x0 = wtop.x + wtop.width / 2, y0 = wtop.y + 120, y1 = wtop.y + 30;
    await p.mouse.move(x0, y0); await p.mouse.down();
    for (let j = 1; j <= 6; j++) { await p.mouse.move(x0 - 40 * (j / 6), y0 + (y1 - y0) * (j / 6)); await p.waitForTimeout(16); }
    await p.waitForTimeout(60);
    const mid = await shellEval(p, () => { const l = document.querySelector('.ec-loupe'); const r = l.getBoundingClientRect(); return { shown: !l.hidden, x: r.left, y: r.top, w: r.width, h: r.height }; });
    const fx = x0 - 40, fy = y1;
    S6.loupe.nearTop = { shown: mid.shown, fingerUnderLoupe: fx >= mid.x && fx <= mid.x + mid.w && fy >= mid.y && fy <= mid.y + mid.h, inWorld: mid.y >= wtop.y - 0.5 };
    await p.screenshot({ path: join(OUT, 'ui-s6-loupe-top.png') });
    await p.mouse.up(); await p.waitForTimeout(40);
  }
  S6.loupe.trials = trials;
  S6.loupe.exactRate = { sd0: +(trials.filter((t) => t.sd === 0 && t.exact).length / trials.filter((t) => t.sd === 0).length).toFixed(2), sd4pt: +(trials.filter((t) => t.sd === 4 && t.exact).length / trials.filter((t) => t.sd === 4).length).toFixed(2) };
  S6.loupe.allShown = trials.every((t) => t.shown && t.size[0] === 120 && !t.fingerUnderLoupe && t.inWorld);
  await ctx.close();
}
// fan geometry at every gate viewport: on screen, 48 pt, no overlaps, clear of the finger's start
S6.fanGeometry = {};
for (const vp of GATE) {
  const { ctx, p } = await openGame(vp);
  const sb = await shellEval(p, () => { const r = document.querySelector('.ec-speed').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.mouse.move(sb.x, sb.y); await p.mouse.down(); await p.waitForTimeout(320);
  const g = await shellEval(p, () => [...document.querySelectorAll('.ec-fan-btn')].map((b) => { const r = b.getBoundingClientRect(); return { v: +b.dataset.speed, l: r.left, t: r.top, r: r.right, b: r.bottom }; }));
  await p.screenshot({ path: join(OUT, `ui-fan-${vp.name}.png`) });
  await p.mouse.up();
  const onScreen = g.every((b) => b.l >= 0 && b.t >= 0 && b.r <= vp.width && b.b <= vp.height);
  let minGap = 1e9;
  for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
    const a = g[i], c = g[j];
    minGap = Math.min(minGap, Math.hypot((a.l + a.r) / 2 - (c.l + c.r) / 2, (a.t + a.b) / 2 - (c.t + c.b) / 2) - 48);
  }
  S6.fanGeometry[vp.name] = { onScreen, size: Math.round(g[0].r - g[0].l), minGapPt: Math.round(minGap) };
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------------
const okS5 = Object.values(S5).every((r) => r.check.worldMatchesPlan && r.check.gateWorld !== false && Object.values(r.check.audits).every((x) => x === 'ok'));
const fanRates = ['sd4pt', 'sd6pt'].map((k) => Object.values(S6.speedFan[k]).map((v) => v.rate));
const okS6 = Object.values(S6.colonist).every((t) => t.colonist.rate >= 0.9) && fanRates[0].every((r) => r >= 0.9) && S6.loupe.allShown && S6.loupe.exactRate.sd0 === 1;
const file = join(HERE, 'results.json');
let prev = {};
try { prev = JSON.parse(readFileSync(file, 'utf8')); } catch (_) { /* first run */ }
const stamp = { harness: 'tools/spike/ui-shell.mjs (owner I)', engine, emulated: true,
  engineNote: engine === 'webkit' ? 'Playwright WebKit on Linux with iPhone viewports; not an iPhone.' : 'Playwright WebKit is not installed here (download blocked), so this ran in Chromium with iPhone emulation (isMobile, touch, iPhone UA). Re-run with --browser=webkit where WebKit exists, and on a real iPhone.' };
prev.S5 = {
  question: 'Real viewport heights', ...stamp,
  method: 'per gate viewport (and three with emulated safe-area insets): J\'s visualViewport probe page, then the real shell (?debug=1&demo=1, New colony): the measured world rect (canvas minus rail, peek card, panel) with nothing selected and with a peek card, against the 10.1 plan (js/ui/layout.js plannedWorld); the top bar fit; and the ui-phone audit on the title, game, peek, Orders panel, Colony sheet, Menu and Mine tool screens',
  measured: S5,
  decision: {
    gateViewports: GATE.map((v) => `${v.width}x${v.height}`),
    LAYOUT: { topBar: 44, rail: 52, bottomBar: 56, peek: 120, minTarget: 44, minTextPx: 14, worldMin: 480, worldMinPeek: 400, landscapePanel: 320 },
    rule: okS5 ? 'keep the 10.1 table and balance.js LAYOUT as planned: every measured world rect equals the plan and the gate floors hold' : 'see the failing viewports',
    safeAreas: 'the shell pads with env(safe-area-inset-*) through --sa-*; ?debug=1&safe=t,r,b,l emulates them; the standalone 390 x 844 with 47/34 insets gives the same 611 pt world as the 390 x 763 gate viewport',
  },
  ok: okS5,
  confirmOnDevice: ['visualViewport in Safari portrait and landscape with the toolbar shown and collapsed (Playwright echoes the configured size)', 'the real env(safe-area-inset-*) values in Safari and standalone (emulated here)', 'standalone height on iPhone 13 and on SE/mini and Pro Max', 'that the bottom bar clears the Safari toolbar and the home indicator', 'the 375 pt top bar with real fonts (SF Pro) at text size 100/115/130%'],
};
prev.S6 = {
  question: 'Touch', ...stamp,
  method: 'through the real shell and input path: seeded Gaussian finger error (sd 4 and 6 pt). Colonist-first: 20 taps per case at a demo colonist\'s body centre at zoom 1 and as 20 pt pips at zoom 0.4 (44 pt hit area), and 20 taps aimed 30 pt off a colonist (must fall to the tile). Speed fan: hold 320 ms, slide onto 1x/2x/3x/5x, release (10 each); tap pause/resume; release on the button keeps the fan open; a tap in the open fan. Loupe: Mine drags of a 6 x 4 rectangle aimed at tile centres (exact and with 4 pt error), loupe placement and label, and a drag near the top of the world',
  measured: S6,
  decision: {
    minTargetPt: 44, colonistFirstPt: 22, pipHitPt: 44, fanButtonPt: 48, fanRadiusPt: 118, holdMs: 250, loupePt: 120, loupeLiftPt: 80, loupeZoom: 2,
    meets9of10AtSd4: okS6,
    rule: okS6 ? 'keep the sizes' : 'grow targets or gaps (see measured)',
  },
  ok: okS6,
  confirmOnDevice: ['real thumbs: 9 of 10 taps on the intended target (colonists among others, pips, fan buttons)', 'loupe aiming with a real thumb, at zoom 0.75 and 1, in sunlight', 'the hold fan with one thumb in both orientations and left-handed (mirrored, not built yet)', 'long-press timing 450 ms vs iOS text-selection and the system edge swipes', 'two-finger pinch starting inside a tool drag'],
};
prev.errors = [...(prev.errors || []).filter((e) => !String(e).startsWith('ui-shell')), ...errors.map((e) => 'ui-shell ' + e)];
writeFileSync(file, JSON.stringify(prev, null, 1) + '\n');
if (srv) await srv.close();
await browser.close();
console.log('S6 colonist', JSON.stringify(S6.colonist));
console.log('S6 fan', JSON.stringify({ sd4: S6.speedFan.sd4pt, sd6: S6.speedFan.sd6pt, tap: S6.speedFan.tap, stays: S6.speedFan.staysOpenOnRelease, tapInFan: S6.speedFan.tapInOpenFan }));
console.log('S6 fan geometry', JSON.stringify(S6.fanGeometry));
console.log('S6 loupe', JSON.stringify({ exact: S6.loupe.exactRate, allShown: S6.loupe.allShown, nearTop: S6.loupe.nearTop, sample: S6.loupe.trials[0] }));
console.log(`ui-shell spike [${engine}]: S5 ${okS5 ? 'ok' : 'PROBLEMS'}, S6 ${okS6 ? 'ok' : 'PROBLEMS'}, ${errors.length} page error(s)`);
for (const e of errors.slice(0, 10)) console.log('  ' + e);
process.exit(okS5 && okS6 && !errors.length ? 0 : 1);

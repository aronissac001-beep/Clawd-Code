// The realm check (EMBERCROWN-WORLD.md W2.1, 1.4, section 10; owner J).
//   node tools/check-realm.mjs [--seeds=1-200] [--browser=webkit|chromium|none] [--json]
// 1. Guarantees: every seed of the range builds a Standard realm with 0 accepted warnings (1.4), rivers downhill.
// 2. Timing: the fields (steps 1-8 and 11) of a Standard realm, median of 15 builds after warm-up, < 60 ms.
// 3. Engines: the realm hash of the 3 fixture seeds is equal in Node and in the browser (WebKit is the iPhone
//    engine; when its Playwright build is not installed this says UNAVAILABLE and --browser=chromium stands in).
// Exit 0 when every part passes; 2 when the browser is unavailable (and the Node parts passed).
import { buildRealm, realmHash, checkRealm } from '../js/game/realm/gen.js';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const json = process.argv.includes('--json');
export const FIXTURES = Object.freeze([{ seed: 1, size: 'standard' }, { seed: 'Ashmark', size: 'small', sea: 2 }, { seed: 90210, size: 'large', hollowing: 'high', wildness: 'low' }]);
const out = { ok: true, checks: [] };
const check = (name, ok, detail) => { out.checks.push({ name, ok, detail }); if (!ok) out.ok = false; };

// 1. guarantees over the seed range
const [s0, s1] = arg('seeds', '1-200').split('-').map(Number);
let warned = 0, failed = 0, rerolls = 0;
const bad = [];
for (let s = s0; s <= (s1 || s0); s++) {
  const r = buildRealm({ seed: s });
  rerolls += r.rerolls;
  if (r.warnings.length) { warned++; bad.push(`${s}: ${r.warnings.map((w) => w.detail).join('; ')}`); }
  if (checkRealm(r).length) failed++;
}
check(`guarantees, seeds ${s0}-${s1 || s0}`, !warned && !failed, `${warned} accepted warnings, ${failed} failing, ${rerolls} re-rolls${bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''}`);

// 2. timing (desktop gate: fields < 60 ms at 64 x 64)
const ms = [];
for (let k = 0; k < 20; k++) { const t0 = performance.now(); buildRealm({ seed: 500 + k }); ms.push(performance.now() - t0); }
const med = ms.slice(5).sort((a, b) => a - b)[7];
check('fields, Standard, median ms', med < 60, `${med.toFixed(1)} ms (budget 60)`);

// 3. fixture hashes, Node and browser
const node = FIXTURES.map((p) => realmHash(buildRealm(p)));
out.node = node;
const which = arg('browser', 'webkit');
let exit = 0;
if (which !== 'none') {
  const { launch, UNAVAILABLE } = await import('./lib/browsers.mjs');
  const { serve } = await import('./lib/static-server.mjs');
  const browser = await launch(which);
  if (!browser) {
    out.browser = 'UNAVAILABLE';
    if (!json) console.log(`check-realm [${which}]: UNAVAILABLE - the Playwright ${which} build is not installed; run with --browser=chromium as a stand-in`);
    exit = UNAVAILABLE;
  } else {
    const srv = await serve(Number(arg('port', 0)));
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    try {
      await page.goto(srv.url + 'tools/check-realm.mjs');   // any same-origin document; the modules load by import()
      const res = await page.evaluate(async (fx) => {
        const m = await import('/js/game/realm/gen.js');
        const t0 = performance.now(), hashes = fx.map((p) => m.realmHash(m.buildRealm(p)));
        return { hashes, ms: performance.now() - t0, ua: navigator.userAgent };
      }, FIXTURES);
      out.browser = { which, ...res };
      for (let k = 0; k < FIXTURES.length; k++) check(`hash ${JSON.stringify(FIXTURES[k].seed)} ${FIXTURES[k].size}: Node = ${which}`, res.hashes[k] === node[k], `${node[k]} / ${res.hashes[k]}`);
    } catch (e) { check(`${which} run`, false, String(e)); }
    if (errors.length) check(`${which} page errors`, false, errors.join('; '));
    await browser.close(); await srv.close();
  }
}

if (json) console.log(JSON.stringify(out));
else {
  for (const c of out.checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? '  (' + c.detail + ')' : ''}`);
  console.log(`check-realm: ${out.ok ? (exit ? 'NODE OK, BROWSER UNAVAILABLE' : 'PASS') : 'FAIL'}  hashes ${node.join(' ')}`);
}
process.exit(out.ok ? exit : 1);

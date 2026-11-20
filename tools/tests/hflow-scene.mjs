// The hflow bench scene (Stage Z1 E11; owner H, for J's `node tools/bench.mjs --scene=hflow`): the 128 x 128 x 20
// stub fortress (fortress-stub.mjs: a stair shaft at (60, 60) to z 0, a 9 x 9 hall every third level) with the
// Hearth in the hall on z 2 and a horde's goal set 'core'. Measures (desktop, performance.now):
//   regionLevelP95Ms  a fresh region level settled whole (the worst case; the sim settles lazily)
//   localP95Us        one local field (batched: 20 builds per sample), over the regions on the route from the edge to the Hearth
//   worst60Ms         one uncapped tick: a fresh level, then a step for 60 foes in 60 distinct regions
//                     (60 local fields built that tick; median of 9 runs, worst60MaxMs the max)
import { installSim } from '../../js/game/core/setup.js';
import { initRuntime } from '../../js/game/core/state.js';
import { addBuilding } from '../../js/game/core/apply.js';
import { PLANE } from '../../js/game/core/grid.js';
import * as flow from '../../js/game/threat/flow.js';
import * as HF from '../../js/game/threat/hflow.js';
import { createColony } from '../../js/game/core/state.js';
import { generateWorld3 } from '../../js/game/world/mapgen3.js';
import { stubFortress, digFortress } from './fortress-stub.mjs';

const pct = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
const r3 = (x) => Math.round(x * 1000) / 1000;

export function hflowScene(seed = 7, kind = 'stub') {
  installSim({ stage: '2', reset: true });
  if (kind === 'mapgen3') {   // a native 128 x 128 x 20 world: the Hearth on the surface, ruins' walls to smash
    const s = createColony(seed, { w: 128, d: 20, zS: 14 });
    generateWorld3(s);
    return s;
  }
  const s = stubFortress(seed);
  digFortress(s);
  s.bld.length = 0; s.next.bld = 0;
  initRuntime(s);
  const hb = addBuilding(s, 'hearth', 64, 58, 0, null, { st: 'done', z: 2 });
  s.colony.hearth = { id: hb.id, lvl: 1, fuel: 5000 };
  initRuntime(s);
  return s;
}

/** Run the measures twice on one scene (the first pass warms the JIT) and report the second. */
export function hflowBench({ seed = 7, scene = 'stub', now = () => performance.now() } = {}) {
  const s = hflowScene(seed, scene);
  measure(s, now, 'warm');
  return measure(s, now, 'run');
}
function measure(s, now, tag) {
  const goals = flow.goalTiles(s, 'core');
  const smash = HF.smashList(s, flow.smashable, () => 80);
  const keys = (k) => ({ g: tag + k, x: HF.pairsHash(smash) });
  // region level, settled whole
  const reg = [];
  let lvl = null;
  for (let k = 0; k < 40; k++) {
    const t = now();
    lvl = HF.settleAll(HF.levelFor(s, 'core', goals, smash, keys(k)));
    if (k >= 10) reg.push(now() - t);
  }
  const lab = s.rt.regionH;
  // the route from the west edge (surface) to the Hearth: its regions
  const entry = flow.edgeVoxels(s).find((v) => HF.hValue(s, lvl, v) < HF.INF) ?? -1;
  const used = [];
  let i = entry, reachHearth = false;
  for (let n = 0; n < 3000 && i >= 0; n++) {
    if (lab[i] && !used.includes(lab[i])) used.push(lab[i]);
    const j = HF.hStep(s, lvl, i);
    if (j >= 0 && !lab[j]) { reachHearth = goals.includes(j); break; }
    i = j;
  }
  const loc = [];
  // batched timer (6.0): 20 builds of one region per sample, 3 samples per region
  for (let k = 0; k < 3; k++) for (const r of used) { const t = now(); for (let m = 0; m < 20; m++) { lvl.local.delete(r); HF.localField(s, lvl, r); } loc.push(((now() - t) * 1000) / 20); }
  // 60 foes in 60 distinct regions, one uncapped tick
  const regs = [];
  const seen = new Set();
  for (let v = 0; v < lab.length; v++) { const r = lab[v]; if (r && !seen.has(r) && lvl.done[r] && lvl.dist[r] < HF.INF) { seen.add(r); regs.push(v); } }
  const step = Math.max(1, Math.floor(regs.length / 60)), foes = [];
  for (let k = 0; k < regs.length && foes.length < 60; k += step) foes.push(regs[k]);
  const w60 = [];
  for (let k = 0; k < 9; k++) {
    const t = now();
    const lv = HF.levelFor(s, 'core', goals, smash, keys('w' + k));
    for (const v of foes) HF.hStep(s, lv, v);
    w60.push(now() - t);
  }
  return { scene: tag === 'run' ? s.d + ' levels' : tag, regions: seen.size, routeRegions: used.length, foes: foes.length, reachHearth,
    regionLevelP95Ms: r3(pct(reg, 0.95)), localP95Us: r3(pct(loc, 0.95)), localP50Us: r3(pct(loc, 0.5)),
    worst60Ms: r3(pct(w60, 0.5)), worst60MaxMs: r3(Math.max(...w60)) };
}

/** The 6.2 desktop thresholds (E11 oracle). */
export const HFLOW_LIMITS = Object.freeze({ regionLevelP95Ms: 0.6, localP95Us: 40, worst60Ms: 2 });
/** Both scenes against the limits: { ok, rows }. */
export function hflowCheck() {
  const rows = [hflowBench({ scene: 'stub', seed: 7 }), hflowBench({ scene: 'mapgen3', seed: 3 })];
  const ok = rows.every((R) => R.reachHearth && Object.entries(HFLOW_LIMITS).every(([k, v]) => R[k] < v));
  return { ok, rows };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const { ok, rows } = hflowCheck();
  for (const R of rows) console.log('hflow', JSON.stringify(R));
  console.log(`hflow: ${ok ? 'PASS' : 'FAIL'} (region level < ${HFLOW_LIMITS.regionLevelP95Ms} ms, local p95 < ${HFLOW_LIMITS.localP95Us} us, 60 foes < ${HFLOW_LIMITS.worst60Ms} ms)`);
  process.exitCode = ok ? 0 : 1;
}

// Migration v3 to v4 (EMBERCROWN-FORTRESS.md 5.4; Stage Z1 step E9, owner A). Every fixture in tools/fixtures/
// (the Stage 1b save and the three Stage 2 saves of 078cb71) is loaded through the state migrations to v3, then
// migrated to a 128 x 128 x 20 world, and must pass the five checks of 5.4:
//   1. every old tunnel voxel at zS has rock directly above (cover >= 1);
//   2. no entity stands on AIR or inside a solid voxel, every colonist's voxel is walkable;
//   3. no colonist's mood moves more than 5 points from the migration alone: mood 1 game hour after the
//      migration against the same hour on the old build (the sidecar's `continue.hour.moods`, from 078cb71; the
//      Stage 1b fixture has none, so its baseline is the same hour on this build at D = 1, unmigrated);
//   4. every saved voxel index is inside the map at z = zS;
//   5. the pristine record round-trips with matching CRCs;
// and "migrate, continue 2 game days, save, reload and continue identically". The migration itself is a pure
// function of the save and the seed: migrating twice gives the same state hash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { installSim } from '../../js/game/core/setup.js';
import { tick } from '../../js/game/core/sim.js';
import { stateHash, checkState } from '../../js/game/core/state.js';
import { PLANE, TER, idx, tileOfW } from '../../js/game/core/grid.js';
import { tempAt, lightAt } from '../../js/game/world/terrain.js';
import { loadBlob, saveBlob } from '../../js/game/save/colonysave.js';
import { encodePristine, decodePristine, pristineOf, layerCrcs } from '../../js/game/save/pristine.js';
import { readAnyHeader, WORLD_KIND } from '../../js/game/save/codec.js';
import { coverRebuild, skyZRebuild } from '../../js/game/world/vertical.js';
import { migrateWorld, preMigration, checkMigrated, v3to4, MIG4 } from '../../js/game/core/migrate4.js';

const HOUR = 600, DAY = 14400, FIX5 = 5 * 100;   // mood is fixed-point x100
const FIX = new URL('../fixtures/', import.meta.url);
const NAMES = readdirSync(FIX).filter((f) => /\.ecsave$/.test(f)).sort();
installSim({ stage: '2' });

// rt.cover and rt.skyZ are not rows of the C13 contract yet (rtcontract.js, A): without them every coverAt read
// rescans the whole world (about 25 ms a tick at D = 20). The cache is exactly coverRebuild, patched by the terrain
// API (vertical.refreshColumn), so installing it changes no decision; it only makes 2 game days testable.
const cached = (s) => { if (!s.rt.cover) { s.rt.cover = coverRebuild(s); s.rt.skyZ = skyZRebuild(s); } return s; };
const run = (s, n) => { const t = s.tick + n; while (s.tick < t && s.colony.fallen !== true) tick(s); return s; };
/** Run n ticks; every colonist's job sequence (type and target, tile targets by plane position). */
function runJobs(s, n) {
  const seq = new Map(s.col.map((c) => [c.id, []]));
  const t = s.tick + n;
  while (s.tick < t && s.colony.fallen !== true) {
    tick(s);
    for (const c of s.col) {
      const a = seq.get(c.id), j = c.job ? `${c.job.type}:${c.job.target >= 0 && c.job.target < 1e6 ? c.job.target % PLANE : c.job.target}` : '-';
      if (a[a.length - 1] !== j) a.push(j);
    }
  }
  return seq;
}
const moods = (s) => s.col.map((c) => ({ id: c.id, name: c.name, mood: c.mood, dead: !!(c.hp && c.hp.dead) }));

test('the four fixtures are present', () => {
  for (const n of ['v1-1b-midraid.ecsave', 'v2-s2-day60.ecsave', 'v2-s2-midraid.ecsave', 'v2-s2-iron.ecsave']) assert.ok(NAMES.includes(n), n);
});

test('v3to4 marks the ENTITIES for the world step', () => {
  const ent = v3to4({ meta: { v: 3 } });
  assert.equal(ent.meta.world4, true);
  assert.equal(ent.meta.migratedFrom, 3);
});

for (const name of NAMES) {
  const bytes = new Uint8Array(readFileSync(new URL(name, FIX)));
  const side = JSON.parse(readFileSync(new URL(name.replace(/\.ecsave$/, '.json'), FIX), 'utf8'));

  test(`${name}: migrates to 128 x 128 x 20, passes the 5.4 checks and continues identically after a save`, async () => {
    // this build at D = 1, unmigrated: 1 game hour with every colonist's job sequence, place and surroundings
    const d1 = await loadBlob(bytes);
    const d1Jobs = runJobs(d1, HOUR);
    const d1Moods = moods(d1);
    const d1Env = d1.col.map((c) => { const i = idx(tileOfW(c.x), tileOfW(c.y), 0); return { id: c.id, x: tileOfW(c.x), y: tileOfW(c.y), t: tempAt(d1, i), l: lightAt(d1, i) }; });
    // the mood baseline: 078cb71's hour (sidecar), else this build's hour at D = 1
    const base = (side.continue && side.continue.hour && side.continue.hour.moods) || d1Moods;

    const s = await loadBlob(bytes);
    const t0 = s.tick, pre = preMigration(s), was = { col: s.col.length, items: s.items.filter(Boolean).length };
    const t = performance.now();
    const { info, pristine } = migrateWorld(s);
    const ms = performance.now() - t;
    assert.equal(s.d, MIG4.d); assert.equal(s.zS, MIG4.zS);
    assert.equal(pristine.worldKind, WORLD_KIND.MIGRATED);
    assert.equal(s.tick, t0, 'the migration takes no game time');
    assert.equal(s.col.length, was.col, 'every colonist kept');
    assert.ok(s.items.filter(Boolean).length >= was.items, 'every stack kept');
    assert.deepEqual(checkState(s), [], 'a valid v4 state');
    // checks 1, 2, 4 and the pristine CRCs
    assert.deepEqual(checkMigrated(s, info, pre), []);
    assert.ok(pre.tunnels.length > 0, 'the fixture has tunnels to check');
    // the plane is the save's: below zS is the generated ground, above the risen massif or air
    assert.ok(info.risen > 0 && info.dormant > 0, 'massif risen, dormant rows generated');
    let airAbove = 0;
    for (let c = 0; c < PLANE; c++) if (s.L.terrain[(MIG4.zS + 1) * PLANE + c] === TER.AIR) airAbove++;
    assert.ok(airAbove > 0 && airAbove < PLANE);
    // a live raid: flow dropped and morale from its losses
    for (const r of s.raids) if (r && r.stage !== 'warned' && r.stage !== 'ended') {
      const live = s.st.live && s.st.live[r.id];
      assert.equal(r.morale, Math.max(0, 100 - 3 * ((live && live.lost) | 0)));
    }
    // 5. the pristine record round-trips with matching CRCs
    const rec = await encodePristine(pristine);
    const back = await decodePristine(rec);
    assert.equal(back.id, pristine.id);
    assert.deepEqual(Array.from(back.crc), Array.from(pristine.crc));
    assert.deepEqual(Array.from(layerCrcs(back.layers, back.w * back.h * back.d)), Array.from(pristine.crc));
    assert.ok(typeof back.meta.baseMask === 'string' && back.meta.baseMask.length > 0, 'baseMask kept in the pristine meta');

    // pure: migrating the same save again gives the same state
    const again = await loadBlob(bytes);
    migrateWorld(again);
    const h0 = stateHash(s);
    assert.equal(stateHash(again), h0, 'the migration is a pure function of the save');
    assert.equal(pristineOf(again).id, pristine.id);

    // 3. mood after 1 game hour within 5 points of the old build's, for every colonist whose hour went the same
    //    way (the same job sequence as this build at D = 1). A colonist whose work choice differs (Z1 work ranks
    //    targets by region distance, E5) stands somewhere else after the hour; for them the check is that the
    //    world itself did not change: temperature and light at the voxel they stood on at D = 1 are the same.
    cached(s);
    const jobs = runJobs(s, HOUR);
    let worst = 0, who = '', worstAll = 0, whoAll = '', diverged = 0, dT = 0, dL = 0;
    for (const m of moods(s)) {
      const b = base.find((x) => x.id === m.id);
      if (!b || b.dead || m.dead) continue;
      const dm = Math.abs(m.mood - b.mood);
      if (dm > worstAll) { worstAll = dm; whoAll = m.name; }
      if (jobs.get(m.id).join() !== d1Jobs.get(m.id).join()) { diverged++; continue; }
      if (dm > worst) { worst = dm; who = m.name; }
    }
    for (const e of d1Env) {
      const i = idx(e.x, e.y, MIG4.zS);
      dT = Math.max(dT, Math.abs(tempAt(s, i) - e.t)); dL = Math.max(dL, Math.abs(lightAt(s, i) - e.l));
    }
    console.log(`# ${name}: migrate ${ms.toFixed(0)} ms; ${pre.tunnels.length} tunnel voxels, ${info.refs} voxel refs, ${info.risen} risen voxels, ${info.dormant} dormant rows; mood after 1 h vs ${side.continue ? side.commit : 'this build at D = 1'}: worst ${(worst / 100).toFixed(2)} (${who || '-'}) over the same-hour colonists, ${(worstAll / 100).toFixed(2)} (${whoAll || '-'}) over all, ${diverged} of ${s.col.length} chose other work; at the D = 1 places: max temperature change ${dT} C, max light change ${dL}`);
    assert.ok(worst <= FIX5, `mood change ${(worst / 100).toFixed(2)} > 5 (${who})`);
    assert.ok(dT <= 1, `temperature at a colonist's place changed by ${dT} C`);
    assert.ok(dL <= 4, `light at a colonist's place changed by ${dL}`);

    // continue to 2 game days, save (EC3), reload; both continue 1 more hour to the same hash
    run(s, 2 * DAY - HOUR);
    assert.deepEqual(checkState(s), [], 'valid after 2 days');
    const blob = await saveBlob(s);
    assert.equal(readAnyHeader(blob).header.format, 3, 'saved as EC3');
    const hSave = stateHash(s);
    const r = await loadBlob(blob, { pristine: pristineOf(s) });
    assert.equal(stateHash(r), hSave, 'reload hashes as saved');
    run(s, HOUR);
    run(cached(r), HOUR);
    assert.equal(stateHash(r), stateHash(s), 'save and reload continue identically');
    console.log(`# ${name}: day 2 + 1 h hash ${stateHash(s)}, ${s.col.filter((c) => !(c.hp && c.hp.dead)).length} alive, save ${blob.length} B`);
  });
}

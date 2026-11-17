// Workstream E, Stage 0 acceptance (14.5 row E): a fake job goto > work(10) > drop completes in a
// stub world, and interrupting it at each toil (and at every tick) leaves no reservation.
// Also: atomic claims, split stacks, target gone, save mid-job, and the think skeleton.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createColony, stateHash } from '../../js/game/core/state.js';
import { tick } from '../../js/game/core/sim.js';
import { resetBus, BUS } from '../../js/game/core/bus.js';
import { newColonist, WORK_IDS } from '../../js/game/core/schema.js';
import { idx, ctrW } from '../../js/game/core/grid.js';
import { saveBlobSync, loadBlobSync } from '../../js/game/save/colonysave.js';
import { installWork } from '../../js/game/work/index.js';
import { T, END, makeJob, keyItem, keyTile, keyBld, isUnreachable, setMover, giversFor, checkGiver, registerJobType, registerEffect, registerToil, toilHandler } from '../../js/game/work/jobs.js';
import * as I from '../../js/game/work/items.js';
import { beginJob, endJob, endJobsOn, claim, canClaim, rebuildFromJobs, checkReservations } from '../../js/game/work/reserve.js';
import { straightMover } from '../../js/game/work/toils.js';

let offChecks = () => {};
beforeEach(() => { offChecks(); resetBus(); offChecks = installWork({ think: false, stubMove: true, checks: true }); });

function world(seed = 'E-JOBS') {
  const s = createColony(seed, { w: 32 });
  s.col.push(newColonist(1, { name: 'Ash', x: ctrW(2), y: ctrW(2) }));
  s.col.push(newColonist(2, { name: 'Brin', x: ctrW(2), y: ctrW(4) }));
  s.col.push(newColonist(3, { name: 'Cor', x: ctrW(2), y: ctrW(6) }));
  s.next.col = 4;
  return s;
}
const woodUnits = (s) => s.items.filter(Boolean).filter((it) => it.k === 'wood').reduce((a, it) => a + it.n, 0)
  + s.col.reduce((a, c) => a + ((c.job && c.job.carry && c.job.carry.k === 'wood') ? c.job.carry.n : 0), 0);
const DEST = () => idx(12, 2);

/** The literal acceptance job: goto > work(10) > drop, carrying 5 wood, holding the destination tile. */
function literalJob(s) {
  return makeJob('fake', keyTile(DEST()), [T.goto(DEST()), T.work(10, { key: keyTile(DEST()) }), T.drop()], { carry: I.makeBundle('wood', 'pine', 0, 5) });
}
/** A fuller fake haul: reserve-at-start the stack and the destination, goto, pickup, goto, work(10), drop. */
function haulJob(s, stackId, n = 10) {
  const it = s.items[stackId], at = idx(it.x, it.y);
  return { job: makeJob('fake', keyItem(stackId), [T.goto(at), T.pickup(stackId, n), T.carry(DEST()), T.work(10, { key: keyTile(DEST()) }), T.drop()]),
    claims: [[keyItem(stackId), n], [keyTile(DEST()), 0]] };
}
function runUntilIdle(s, col, max = 500) { let n = 0; while (col.job && n < max) { tick(s); n++; } return n; }

test('the fake job goto > work(10) > drop completes in a stub world', () => {
  const s = world(); const c = s.col[0];
  assert.ok(beginJob(s, c, literalJob(s), [[keyTile(DEST()), 0]]));
  assert.equal(s.rt.res.size, 1);
  const ticks = runUntilIdle(s, c);
  assert.equal(c.job, null, 'job finished');
  assert.equal(ticks, 10 /* walk 10 tiles */ + 10 /* work(10) */, `took ${ticks} ticks`);
  const it = I.stackAt(s, DEST());
  assert.ok(it && it.k === 'wood' && it.n === 5, 'dropped at the destination');
  assert.equal(s.rt.res.size, 0, 'no reservation left');
  assert.deepEqual(s.rt.thinkQ, [1], 'a finished job queues a think');
});

test('the fuller fake haul completes and conserves items', () => {
  const s = world(); const c = s.col[0];
  const id = I.spawn(s, 'wood', 'pine', 0, 10, 6, 6);
  assert.ok(beginJob(s, c, haulJob(s, id)));
  runUntilIdle(s, c);
  assert.equal(c.job, null);
  assert.equal(I.stackAt(s, DEST()).n, 10);
  assert.equal(s.items[id] && s.items[id].k === 'wood' && idx(s.items[id].x, s.items[id].y) === DEST() ? 1 : 0, 1, 'slot 0 freed then reused at the destination');
  assert.equal(woodUnits(s), 10); assert.equal(s.rt.res.size, 0);
});

test('interrupting at each toil, and at every tick, leaves no reservation and loses no item', () => {
  const reasons = [END.INTERRUPT, END.DRAFT, END.DEATH, END.DOWNED, END.BREAK, END.CANCEL];
  for (const make of ['literal', 'haul']) {
    // a reference run gives the job length in ticks
    const ref = world(); const rc = ref.col[0];
    const rid = I.spawn(ref, 'wood', 'pine', 0, 10, 6, 6);
    beginJob(ref, rc, make === 'literal' ? literalJob(ref) : haulJob(ref, rid), make === 'literal' ? [[keyTile(DEST()), 0]] : undefined);
    const len = runUntilIdle(ref, rc);
    const toilsSeen = new Set();
    for (let at = 0; at < len; at++) {
      const s = world(); const c = s.col[0];
      const id = I.spawn(s, 'wood', 'pine', 0, 10, 6, 6);
      const before = woodUnits(s) + (make === 'literal' ? 5 : 0);
      beginJob(s, c, make === 'literal' ? literalJob(s) : haulJob(s, id), make === 'literal' ? [[keyTile(DEST()), 0]] : undefined);
      for (let k = 0; k < at; k++) tick(s);
      assert.ok(c.job, `${make}: job still running at tick ${at}`);
      toilsSeen.add(c.job.toils[c.job.i].t);
      const reason = reasons[at % reasons.length];
      assert.ok(endJob(s, c, reason));
      assert.equal(c.job, null);
      assert.equal(s.rt.res.size, 0, `${make}: reservation left after '${reason}' at tick ${at}`);
      assert.equal(checkReservations(s), null);
      assert.equal(woodUnits(s), before, `${make}: items conserved at tick ${at}`);
      assert.equal(c.path, null, 'path dropped');
      assert.equal(s.rt.thinkQ.includes(1), reason !== END.DEATH && reason !== END.DOWNED);
      for (let k = 0; k < 5; k++) tick(s);       // tick checks (res == rebuild, item caches) keep passing
      assert.equal(endJob(s, c, END.INTERRUPT), false, 'endJob without a job is a no-op');
    }
    const want = make === 'literal' ? ['goto', 'work'] : ['goto', 'carry', 'work']; // pickup and drop are instant: next test
    for (const t of want) assert.ok(toilsSeen.has(t), `${make}: interrupted during ${t}`);
  }
});

test('interrupting exactly at each toil index (instant toils included) leaves no reservation', () => {
  // Wrap every core toil so the job is interrupted the moment toil k is about to run.
  const names = ['goto', 'pickup', 'carry', 'work', 'drop'];
  const orig = Object.fromEntries(names.map((n) => [n, toilHandler(n)]));
  try {
    for (let k = 0; k < 5; k++) {
      for (const reason of [END.INTERRUPT, END.DRAFT, END.DEATH]) {
        const s = world(); const c = s.col[0];
        const id = I.spawn(s, 'wood', 'pine', 0, 10, 6, 6);
        let hit = null;
        for (const n of names) registerToil(n, (s2, col, job, toil) => {
          if (job.i === k && !hit) { hit = { toil: toil.t, claims: job.claims.length, carry: !!job.carry }; endJob(s2, col, reason); return 0; }
          return orig[n](s2, col, job, toil);
        });
        beginJob(s, c, haulJob(s, id));
        for (let n = 0; n < 200 && c.job; n++) tick(s);
        assert.ok(hit, `reached toil ${k}`);
        assert.equal(hit.toil, names[k]);
        assert.equal(c.job, null);
        assert.equal(s.rt.res.size, 0, `reservation left when interrupted at toil ${k} (${hit.toil}, ${hit.claims} claims, carry ${hit.carry})`);
        assert.equal(woodUnits(s), 10, `items conserved at toil ${k}`);
      }
    }
  } finally { for (const n of names) registerToil(n, orig[n]); }
});

test('claims are atomic; exclusive and counted claims; two haulers split a stack', () => {
  const s = world(); const [a, b, c] = s.col;
  const id = I.spawn(s, 'wood', 'pine', 0, 10, 6, 6);
  assert.ok(beginJob(s, a, makeJob('x', -1, [T.wait(50)]), [[keyTile(5), 0]]));
  // b wants tile 5 (taken) and tile 6: nothing is claimed
  assert.equal(beginJob(s, b, makeJob('x', -1, [T.wait(50)]), [[keyTile(6), 0], [keyTile(5), 0]]), false);
  assert.equal(b.job, null); assert.equal(s.rt.res.has(keyTile(6)), false);
  endJob(s, a);
  // split: 6 + 4 of 10, a third hauler cannot claim even 1
  assert.ok(beginJob(s, a, haulJob(s, id, 6)));
  const hb = haulJob(s, id, 4); hb.claims[1] = [keyTile(idx(12, 4)), 0]; hb.job.toils[2] = T.carry(idx(12, 4)); hb.job.toils[3] = T.work(10, { key: keyTile(idx(12, 4)) }); hb.job.toils[4] = T.drop();
  assert.ok(beginJob(s, b, hb));
  assert.equal(canClaim(s, c, keyItem(id), 1), false);
  assert.equal(I.freeCount(s, id, c.id), 0);
  assert.deepEqual(s.rt.res.get(keyItem(id)), [[1, 6], [2, 4]]);
  for (let n = 0; n < 200 && (a.job || b.job); n++) tick(s);
  assert.equal(I.stackAt(s, DEST()).n, 6); assert.equal(I.stackAt(s, idx(12, 4)).n, 4);
  assert.equal(s.rt.res.size, 0); assert.equal(woodUnits(s), 10);
});

test('a stack destroyed under a job ends it with targetGone; endJobsOn covers buildings and tiles', () => {
  const s = world(); const [a, b] = s.col;
  const id = I.spawn(s, 'wood', 'pine', 0, 10, 6, 6);
  const ended = [];
  registerJobType('fake', { onEnd: (s2, col, job, reason) => ended.push([col.id, reason]) });
  beginJob(s, a, haulJob(s, id));
  tick(s); tick(s);
  I.destroy(s, id);
  assert.equal(a.job, null); assert.deepEqual(ended, [[1, END.TARGET_GONE]]);
  assert.equal(s.rt.res.size, 0);
  beginJob(s, b, makeJob('x', keyBld(3), [T.wait(99)]), [[keyBld(3), 0]]);
  assert.equal(endJobsOn(s, keyBld(3)), 1); assert.equal(b.job, null);
  registerJobType('fake', {});
});

test('save and load at every tick of a job continues identically (job, carry, claims and path are saved)', () => {
  const run = (saveAt) => {
    let s = world('E-SAVE');
    const id = I.spawn(s, 'wood', 'pine', 0, 10, 6, 6);
    beginJob(s, s.col[0], haulJob(s, id, 7));
    beginJob(s, s.col[1], literalJob(s), [[keyTile(DEST()), 0]]);
    for (let t = 0; t < 40; t++) {
      if (t === saveAt) {
        const res = rebuildFromJobs(s);
        s = loadBlobSync(saveBlobSync(s));
        assert.deepEqual([...s.rt.res.entries()].sort((x, y) => x[0] - y[0]), [...res.entries()].sort((x, y) => x[0] - y[0]), 'res rebuilt from saved jobs at load');
      }
      tick(s);
    }
    return stateHash(s);
  };
  const h = run(-1);
  for (let t = 0; t < 40; t += 3) assert.equal(run(t), h, `save at tick ${t}`);
});

test('a work(n) toil runs n ticks at speed 1.0 and calls its effect; unknown toils fail cleanly', () => {
  const s = world(); const c = s.col[0];
  let fired = 0;
  registerEffect('test-fx', () => { fired++; });
  c.x = ctrW(5); c.y = ctrW(5);
  beginJob(s, c, makeJob('w', -1, [T.work(25, { fx: 'test-fx' })]));
  assert.equal(runUntilIdle(s, c), 25); assert.equal(fired, 1);
  beginJob(s, c, makeJob('w', -1, [{ t: 'nope' }]), [[keyTile(9), 0]]);
  tick(s);
  assert.equal(c.job, null); assert.equal(s.rt.res.size, 0);
});

test('think skeleton: a fake haul giver empties a pile with exact reservations; unreachable targets are remembered', () => {
  resetBus(); offChecks(); offChecks = installWork({ think: true, stubMove: true, checks: true });
  const s = world('E-THINK');
  for (const c of s.col) { c.prio.fill(0); c.prio[WORK_IDS.indexOf('haul')] = 1; }
  I.spawn(s, 'wood', 'pine', 0, 30, 6, 8);
  const stone = I.spawn(s, 'stone', 'granite', 0, 5, 20, 20);   // the mover rejects its tile (as region labels would)
  let destN = 0;
  const giver = {
    id: 'fakehaul', work: 'haul',
    candidates: (s2, c, k) => I.candidates(s2, { cat: 'wood', holder: c.id }, idx(2, 2), null, k).concat(I.candidates(s2, { k: 'stone', holder: c.id }, idx(2, 2), null, k)),
    keyOf: (it) => keyItem(it.id),
    valid: (s2, c, it) => I.freeCount(s2, it.id, c.id) > 0 && it.x !== 12,
    make: (s2, c, it) => {
      const n = Math.min(4, I.freeCount(s2, it.id, c.id)), to = idx(12, (destN++ % 16) + 1);
      return { job: makeJob('fakehaul', keyItem(it.id), [T.goto(idx(it.x, it.y)), T.pickup(it.id, n), T.carry(to), T.drop(to)]), claims: [[keyItem(it.id), n], [keyTile(to), 0]] };
    },
  };
  assert.deepEqual(checkGiver(giver), []);
  BUS.workGivers.push(giver);
  assert.deepEqual(giversFor(BUS.workGivers, 'haul').map((g) => g.id), ['fakehaul']);
  let requests = 0;
  setMover({ ...straightMover, request: (s2, c, goal, adj) => { if (goal === idx(20, 20)) { requests++; return false; } return straightMover.request(s2, c, goal, adj); } });
  for (let t = 0; t < 600; t++) tick(s);
  const left = s.items.filter(Boolean).filter((it) => it.k === 'wood' && it.x !== 12);
  assert.equal(left.length, 0, 'all wood hauled');
  assert.equal(woodUnits(s), 30);
  assert.ok(s.col.every((c) => isUnreachable(s, c, keyItem(stone))), 'unreachable target remembered by every colonist');
  assert.equal(requests, 3, `one rejected request per colonist in 600 ticks (got ${requests})`);
  for (let t = 0; t < 600; t++) tick(s);
  assert.equal(requests, 6, 'retried once each after the 600-tick memory expired');
  assert.equal(checkReservations(s), null);
  setMover(straightMover);
});

test('claim() needs a job, and a claim on a stack cannot exceed its count', () => {
  const s = world(); const c = s.col[0];
  const id = I.spawn(s, 'wood', 'pine', 0, 3, 6, 6);
  assert.equal(claim(s, c, keyItem(id), 1), false);
  beginJob(s, c, makeJob('x', -1, [T.wait(5)]));
  assert.equal(claim(s, c, keyItem(id), 4), false);
  assert.ok(claim(s, c, keyItem(id), 2)); assert.ok(claim(s, c, keyItem(id), 1));
  assert.equal(claim(s, c, keyItem(id), 1), false);
  assert.deepEqual(c.job.claims, [[keyItem(id), 3]]);
  endJob(s, c); assert.equal(s.rt.res.size, 0);
});

test('a leak is caught at the tick end and names the job (gate check (d))', () => {
  const s = world(); const c = s.col[0];
  beginJob(s, c, makeJob('leaky', -1, [T.wait(50)]), [[keyTile(9), 0]]);
  c.job.claims.length = 0;                       // a buggy writer forgets the table
  assert.throws(() => tick(s), /reservation leak on tile 9 .*colonist 1 job 'leaky' at toil 0 \(wait\)/);
});

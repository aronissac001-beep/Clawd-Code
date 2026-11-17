// Stage 1a command appliers (owner A; js/game/core/apply.js; doc 13.3, 10.11, 14.6) on a real
// founded colony (B's mapgen, the Hearth, the band). Content ids are looked up by flag so the
// tests follow G's data as it grows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { applyCommand } from '../../js/game/core/commands.js';
import { tick } from '../../js/game/core/sim.js';
import { checkState, stateHash } from '../../js/game/core/state.js';
import { verifyCaches, dirtyClear } from '../../js/game/core/rtcontract.js';
import { W, H, idx, inB, tx, ty, TER, TER_MINEABLE, TER_BUILDABLE, DESIG, getBit } from '../../js/game/core/grid.js';
import { all, hasFlag, structDef, sizeOf } from '../../js/game/core/content.js';
import { pillarPlan, checkPlace } from '../../js/game/core/apply.js';

installSim({ stage: '1a', checks: true });
const fresh = (seed = 'APPLY-1') => foundColony({ seed });
const live = (s) => s.bld.filter(Boolean);
const C = (s, cmd) => applyCommand(s, cmd);

/** Top-left of the first w x h rect (scan from (x0, y0) outward) where pred(i) holds for every tile. */
function findRect(s, w, h, pred, near = null) {
  const hb = s.bld[s.colony.hearth.id];
  const [cx, cy] = near || [hb.x, hb.y];
  for (let r = 0; r < Math.max(W, H); r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x0 = cx + dx, y0 = cy + dy;
      if (!inB(x0, y0) || !inB(x0 + w - 1, y0 + h - 1)) continue;
      let ok = true;
      for (let y = y0; y < y0 + h && ok; y++) for (let x = x0; x < x0 + w && ok; x++) ok = pred(idx(x, y));
      if (ok) return { x0, y0, x1: x0 + w - 1, y1: y0 + h - 1 };
    }
  }
  return null;
}
const openGround = (s) => (i) => TER_BUILDABLE[s.L.terrain[i]] === 1 && s.rt.occ[i] < 0 && getBit(s.L.fog, i) === 1 && !s.L.plant[i];
const solidRock = (s) => (i) => s.L.terrain[i] === TER.ROCK;
function settle(s) { tick(s); assert.deepEqual(verifyCaches(s), [], 'caches equal a rebuild after the tick'); assert.ok(dirtyClear(s.rt.dirty)); assert.deepEqual(checkState(s), []); }

test('the new-colony flow: Hearth done, 3 colonists, start stock, valid state, explored start', () => {
  const s = fresh();
  assert.deepEqual(checkState(s), []);
  const hb = s.bld[s.colony.hearth.id];
  assert.equal(hb.def, 'hearth'); assert.equal(hb.st, 'done');
  assert.equal(s.col.length, 3);
  assert.ok(s.items.filter(Boolean).length > 0, 'start stock');
  assert.equal(getBit(s.L.fog, idx(hb.x + 1, hb.y + 1)), 1, 'the Hearth is explored');
  assert.equal(stateHash(fresh()), stateHash(s), 'founding is deterministic');
  assert.notEqual(stateHash(fresh('APPLY-2')), stateHash(s));
  settle(s);
});

test('designate: mine only on rock, chop only on trees; remove; empty rects are refused with a reason', () => {
  const s = fresh();
  const rock = findRect(s, 4, 3, solidRock(s));
  const r = C(s, { t: 'designate', kind: 'mine', rect: rock, add: true });
  assert.ok(r.ok); assert.equal(r.n, 12);
  assert.equal(s.L.desig[idx(rock.x0, rock.y0)] & DESIG.MINE, DESIG.MINE);
  const grass = findRect(s, 3, 3, openGround(s));
  const bad = C(s, { t: 'designate', kind: 'mine', rect: grass, add: true });
  assert.equal(bad.ok, false); assert.match(bad.reason, /nothing to mine/);
  const off = C(s, { t: 'designate', kind: 'mine', rect: { ...rock, x1: rock.x0 }, add: false });
  assert.ok(off.ok); assert.equal(off.n, 3);
  const unknown = C(s, { t: 'designate', kind: 'dig', rect: rock, add: true });
  assert.equal(unknown.ok, false);
  const trees = []; for (let i = 0; i < s.L.plant.length; i++) if (s.L.plant[i]) trees.push(i);
  if (trees.length) {
    const t0 = trees[0];
    const ch = C(s, { t: 'designate', kind: 'chop', rect: { x0: tx(t0), y0: ty(t0), x1: tx(t0), y1: ty(t0) }, add: true });
    assert.ok(ch.ok || /nothing/.test(ch.reason));
  }
  settle(s);
});

test('stamp: a 5 x 4 bedroom plans walls, a door on a side, floors and a bed in one command', () => {
  const s = fresh();
  if (!all('stamp').some((d) => d.id === 'bedroom')) return;
  const q = findRect(s, 5, 4, openGround(s));
  const before = live(s).length;
  const r = C(s, { t: 'stamp', kind: 'bedroom', rect: q, furnish: true });
  assert.ok(r.ok, r.reason);
  const made = live(s).slice(before);
  const defs = made.map((b) => structDef(b.def));
  assert.ok(defs.some((d) => hasFlag(d, 'wall') && !hasFlag(d, 'door')), 'walls');
  assert.ok(defs.some((d) => hasFlag(d, 'door')), 'a door');
  assert.ok(defs.some((d) => hasFlag(d, 'floor')), 'floors');
  assert.ok(defs.some((d) => hasFlag(d, 'bed')), 'a bed');
  const [dx, dy] = r.door;
  assert.ok((dx === q.x0 || dx === q.x1 || dy === q.y0 || dy === q.y1) && !((dx === q.x0 || dx === q.x1) && (dy === q.y0 || dy === q.y1)), 'door on a side, not a corner');
  assert.ok(made.every((b) => b.st === 'bp'), 'all blueprints');
  // every border tile holds a wall or the door
  for (let x = q.x0; x <= q.x1; x++) for (const y of [q.y0, q.y1]) assert.ok(s.rt.occ[idx(x, y)] >= 0, `border ${x},${y}`);
  const small = C(s, { t: 'stamp', kind: 'bedroom', rect: { x0: q.x0, y0: q.y0, x1: q.x0 + 1, y1: q.y0 + 1 }, furnish: true });
  assert.equal(small.ok, false); assert.match(small.reason, /at least/);
  settle(s);
});

test('carve hall 9 x 9: mine designations everywhere but the pillar plan; every tile within 4 of a support', () => {
  const s = fresh();
  const q = findRect(s, 11, 11, solidRock(s));
  const hall = { x0: q.x0 + 1, y0: q.y0 + 1, x1: q.x0 + 9, y1: q.y0 + 9 };
  const r = C(s, { t: 'carve', rect: hall, pattern: 'natural', smooth: false });
  assert.ok(r.ok, r.reason);
  assert.ok(r.pillars.length >= 1);
  const plan = s.colony.plans[s.colony.plans.length - 1];
  assert.equal(plan.kind, 'carve'); assert.deepEqual(plan.pillars, r.pillars);
  let marked = 0;
  for (let y = hall.y0; y <= hall.y1; y++) for (let x = hall.x0; x <= hall.x1; x++) {
    const i = idx(x, y);
    if (r.natural.includes(i)) assert.equal(s.L.desig[i] & DESIG.MINE, 0, 'natural pillars stay'); else { assert.equal(s.L.desig[i] & DESIG.MINE, DESIG.MINE); marked++; }
  }
  assert.equal(marked, 81 - r.natural.length);
  // the plan's coverage: with the rock outside the hall staying, no tile is more than 4 from a support
  const sup = new Set(r.pillars);
  for (let y = hall.y0; y <= hall.y1; y++) for (let x = hall.x0; x <= hall.x1; x++) {
    let ok = false;
    for (let dy = -4; dy <= 4 && !ok; dy++) for (let dx = -4; dx <= 4 && !ok; dx++) {
      const xx = x + dx, yy = y + dy; if (!inB(xx, yy)) { ok = true; break; }
      const inHall = xx >= hall.x0 && xx <= hall.x1 && yy >= hall.y0 && yy <= hall.y1;
      ok = inHall ? sup.has(idx(xx, yy)) : TER_MINEABLE[s.L.terrain[idx(xx, yy)]] === 1 && !(s.L.desig[idx(xx, yy)] & DESIG.MINE);
    }
    assert.ok(ok, `tile ${x},${y} unsupported`);
  }
  // a big hall needs more than one pillar, and the plan is deterministic
  const big = findRect(s, 21, 21, solidRock(s), [q.x0, q.y0 + 20]);
  if (big) { const p = pillarPlan(s, big); assert.ok(p.length >= 4); assert.deepEqual(pillarPlan(s, big), p); }
  const air = findRect(s, 4, 4, openGround(s));
  assert.equal(C(s, { t: 'carve', rect: air, pattern: 'natural', smooth: false }).ok, false);
  settle(s);
});

test('zones: new, expand, shrink, delete; ids are the lowest free; zone fields rebuilt at the end of the tick', () => {
  const s = fresh();
  const q = findRect(s, 6, 4, openGround(s));
  const a = C(s, { t: 'zone', op: 'new', type: 'stockpile', rect: { ...q, x1: q.x0 + 2, y1: q.y1 - 1 } });
  assert.ok(a.ok, a.reason); assert.equal(a.zoneId, 1); assert.equal(a.n, 9);
  assert.equal(s.rt.dirty.zoneFields, true);
  const b = C(s, { t: 'zone', op: 'new', type: 'stockpile', rect: { ...q, x0: q.x0 + 3 } });
  assert.equal(b.zoneId, 2);
  const e = C(s, { t: 'zone', op: 'expand', zoneId: 1, rect: { x0: q.x0, y0: q.y1, x1: q.x0 + 4, y1: q.y1 } });
  assert.ok(e.ok); assert.equal(e.n, 3, 'tiles of another zone are skipped');
  assert.equal(s.L.zone[idx(q.x0 + 3, q.y1)], 2, 'a zoned tile keeps its zone');
  assert.equal(C(s, { t: 'zone', op: 'expand', zoneId: 1, rect: { x0: q.x0, y0: q.y0, x1: q.x0, y1: q.y0 } }).ok, false);
  const sh = C(s, { t: 'zone', op: 'shrink', zoneId: 1, rect: { x0: q.x0, y0: q.y0, x1: q.x0, y1: q.y1 } });
  assert.ok(sh.ok); assert.equal(sh.n, 4);
  const cfg = C(s, { t: 'zoneCfg', zoneId: 2, patch: { pri: 3, name: 'Main store' } });
  assert.ok(cfg.ok); assert.equal(s.zones.find((z) => z.id === 2).name, 'Main store');
  settle(s);
  const d = C(s, { t: 'zone', op: 'delete', zoneId: 1 });
  assert.ok(d.ok);
  assert.equal(s.zones.length, 1);
  const c = C(s, { t: 'zone', op: 'new', type: 'stockpile', rect: { x0: q.x0, y0: q.y0, x1: q.x0, y1: q.y0 } });
  assert.equal(c.zoneId, 1, 'id 1 is reused');
  settle(s);
});

test('place, placeLine, cancel and deconstruct: lowest free building index, occupancy exact, reasons on refusal', () => {
  const s = fresh();
  const wall = all('structure').find((d) => hasFlag(d, 'wall') && !hasFlag(d, 'door'));
  const q = findRect(s, 6, 3, openGround(s));
  const line = C(s, { t: 'placeLine', def: wall.id, path: [0, 1, 2, 3, 4, 5].map((k) => [q.x0 + k, q.y0]) });
  assert.ok(line.ok); assert.equal(line.n, 6);
  const ids = line.ids.slice();
  const again = C(s, { t: 'place', def: wall.id, x: q.x0, y: q.y0, rot: 0 });
  assert.equal(again.ok, false); assert.match(again.reason, /already/);
  const rockAt = findRect(s, 1, 1, solidRock(s));
  const onRock = C(s, { t: 'place', def: wall.id, x: rockAt.x0, y: rockAt.y0, rot: 0 });
  assert.equal(onRock.ok, false); assert.match(onRock.reason, /rock/);
  // cancel two blueprints in the middle: their slots are reused lowest first
  const can = C(s, { t: 'cancelRect', rect: { x0: q.x0 + 1, y0: q.y0, x1: q.x0 + 2, y1: q.y0 }, kinds: ['bp'] });
  assert.ok(can.ok); assert.equal(can.n, 2);
  assert.equal(s.rt.occ[idx(q.x0 + 1, q.y0)], -1);
  const p = C(s, { t: 'place', def: wall.id, x: q.x0 + 2, y: q.y0 + 2, rot: 0 });
  assert.equal(p.id, Math.min(ids[1], ids[2]));
  const dc = C(s, { t: 'deconstruct', ids: [ids[0]] });
  assert.ok(dc.ok); assert.equal(s.bld[ids[0]], null, 'a blueprint is removed at once');
  const hb = s.colony.hearth.id;
  const keep = C(s, { t: 'deconstruct', ids: [hb] });
  assert.equal(keep.ok, false); assert.ok(s.bld[hb], 'the Hearth stays');
  settle(s);
});

test('bills on a workbench: add (recipe must belong to the bench), edit, move, remove; colonist settings', () => {
  const s = fresh();
  const bench = all('structure').find((d) => d.workbench);
  if (!bench) return;
  const [bw, bh] = sizeOf(bench, 0);
  const q = findRect(s, bw, bh, openGround(s));
  assert.equal(checkPlace(s, bench.id, q.x0, q.y0, 0), null);
  const pl = C(s, { t: 'place', def: bench.id, x: q.x0, y: q.y0, rot: 0 });
  assert.ok(pl.ok, pl.reason);
  const b = s.bld[pl.id];
  const auto = b.bills.length;
  const recipes = all('recipe').filter((r) => !r.bench || r.bench.includes(bench.id));
  const other = all('recipe').find((r) => r.bench && !r.bench.includes(bench.id));
  if (recipes.length) {
    assert.ok(C(s, { t: 'bill', op: 'add', bId: b.id, bill: { recipe: recipes[0].id, mode: 'count', n: 4 } }).ok);
    assert.equal(b.bills.length, auto + 1);
    assert.ok(C(s, { t: 'bill', op: 'edit', bId: b.id, bill: { i: auto, n: 7 } }).ok);
    assert.equal(b.bills[auto].n, 7);
    assert.equal(C(s, { t: 'bill', op: 'edit', bId: b.id, bill: { i: auto, minSkill: 9, maxSkill: 3 } }).ok, false);
    if (b.bills.length > 1) { assert.ok(C(s, { t: 'bill', op: 'move', bId: b.id, bill: { i: auto, to: 0 } }).ok); assert.equal(b.bills[0].n, 7); }
    assert.ok(C(s, { t: 'bill', op: 'remove', bId: b.id, bill: { i: 0 } }).ok);
  }
  if (other) assert.equal(C(s, { t: 'bill', op: 'add', bId: b.id, bill: { recipe: other.id } }).ok, false);
  const col = s.col[0];
  assert.ok(C(s, { t: 'prio', colId: col.id, work: 'mine', p: 1 }).ok);
  assert.equal(col.prio[5], 1); assert.equal(col.custom, true);
  assert.ok(C(s, { t: 'sched', colId: col.id, hours: Array(24).fill(1) }).ok);
  assert.ok(col.sched instanceof Uint8Array && col.sched.every((v) => v === 1));
  settle(s);
});

test('a bed is assigned to one colonist; reassigning moves it; removing the bed clears the owner', () => {
  const s = fresh();
  const bedDef = all('structure').find((d) => hasFlag(d, 'bed'));
  if (!bedDef) return;
  const [bw, bh] = sizeOf(bedDef, 0);
  const q = findRect(s, bw * 2 + 1, bh, openGround(s));
  const b1 = C(s, { t: 'place', def: bedDef.id, x: q.x0, y: q.y0, rot: 0 }).id;
  const b2 = C(s, { t: 'place', def: bedDef.id, x: q.x0 + bw + 1, y: q.y0, rot: 0 }).id;
  const [c1, c2] = s.col;
  assert.ok(C(s, { t: 'assign', bId: b1, colId: c1.id }).ok);
  assert.equal(c1.bed, b1); assert.equal(s.bld[b1].owner, c1.id);
  assert.ok(C(s, { t: 'assign', bId: b2, colId: c1.id }).ok);
  assert.equal(c1.bed, b2); assert.equal(s.bld[b1].owner, null);
  assert.ok(C(s, { t: 'assign', bId: b2, colId: c2.id }).ok);
  assert.equal(c1.bed, null); assert.equal(c2.bed, b2);
  assert.ok(C(s, { t: 'cancelRect', rect: { x0: q.x0, y0: q.y0, x1: q.x1, y1: q.y1 }, kinds: ['bp'] }).ok);
  assert.equal(c2.bed, null);
  settle(s);
});

test('paste rotates a template a quarter turn', () => {
  const s = fresh();
  const wall = all('structure').find((d) => hasFlag(d, 'wall') && !hasFlag(d, 'door'));
  const q = findRect(s, 4, 4, openGround(s));
  s.colony.templates.push({ id: 99, name: 'L', w: 3, h: 2, cells: [[0, 0, wall.id, 0, null], [2, 1, wall.id, 0, null]], floors: [] });
  const r = C(s, { t: 'paste', templateId: 99, x: q.x0, y: q.y0, rot: 1 });
  assert.ok(r.ok, r.reason); assert.equal(r.n, 2);
  // rot 1 of a 3 x 2 template: (0,0) -> (1,0), (2,1) -> (0,2)
  assert.ok(s.rt.occ[idx(q.x0 + 1, q.y0)] >= 0); assert.ok(s.rt.occ[idx(q.x0, q.y0 + 2)] >= 0);
  assert.equal(C(s, { t: 'paste', templateId: 98, x: q.x0, y: q.y0, rot: 0 }).ok, false);
  settle(s);
});

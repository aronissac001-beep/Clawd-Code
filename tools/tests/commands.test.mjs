// Contract C3 (13.3): a validator for every command; invalid commands are dropped with a reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColony } from '../../js/game/core/state.js';
import { newColonist, newBuilding, newZone, newBill } from '../../js/game/core/schema.js';
import { COMMANDS, COMMAND_NAMES, validateCommand, applyCommand, registerApplier, resetAppliers, setContentLookup } from '../../js/game/core/commands.js';

// The command list of doc 13.3, typed out independently so a missing command fails here.
const DOC = ['designate', 'cancelRect', 'place', 'placeLine', 'stamp', 'carve', 'copyRoom', 'paste', 'deconstruct', 'zone', 'zoneCfg',
  'bill', 'role', 'prio', 'sched', 'soldier', 'draft', 'order', 'prioritise', 'forbid', 'upgrade', 'spec', 'assign', 'outfit', 'research',
  'charter', 'letter', 'trade', 'caravan', 'garrison', 'vigil', 'feast', 'perk', 'challenge'];

function world() {
  const s = createColony('CMD');
  s.col.push(newColonist(1, { name: 'A' }), newColonist(2, { name: 'B' }));
  s.bld[0] = newBuilding(0, 'carpenter_bench', 10, 10, 0, 'pine', { st: 'done', bills: [newBill('chair'), newBill('table')] });
  s.zones.push(newZone(1, 'stockpile'));
  return s;
}
const R = { x0: 2, y0: 3, x1: 8, y1: 9 };
const VALID = {
  designate: { kind: 'mine', rect: R, add: true },
  cancelRect: { rect: R, kinds: ['mine', 'bp'] },
  place: { def: 'wall', x: 5, y: 5, rot: 0, mat: 'granite' },
  placeLine: { def: 'wall', path: [[1, 1], [2, 1], [3, 2]], mat: null },
  stamp: { kind: 'bedroom', rect: R, wallMat: 'granite', floorMat: null, door: { x: 2, y: 5 }, furnish: true },
  carve: { rect: R, pattern: 'natural', smooth: false },
  copyRoom: { roomId: 3 },
  paste: { templateId: 0, x: 20, y: 20, rot: 2 },
  deconstruct: { ids: [0] },
  zone: { op: 'new', type: 'stockpile', rect: R, preset: 'all' },
  zoneCfg: { zoneId: 1, patch: { name: 'Food', pri: 2 } },
  bill: { op: 'add', bId: 0, bill: { recipe: 'stool', mode: 'count', n: 4 } },
  role: { colId: 1, primary: 'miner', secondary: 'hauler' },
  prio: { colId: 1, work: 'mine', p: 1 },
  sched: { colId: 1, hours: Array(24).fill(3) },
  soldier: { colId: 2, on: true },
  draft: { colIds: [1, 2], on: true },
  order: { colIds: [1], kind: 'move', target: { x: 30, y: 30 } },
  prioritise: { colId: 1, target: { x: 4, y: 4 }, work: 'build' },
  forbid: { rect: R, on: true },
  upgrade: { bId: 0 },
  spec: { bId: 0, spec: 'joiner' },
  assign: { bId: 0, colId: 2 },
  outfit: { colId: 1, outfit: 'worker' },
  research: { tech: 'masonry' },
  charter: { id: 'forgeborn' },
  letter: { id: 3, choice: 1 },
  trade: { visitId: 1, buy: [{ k: 'iron_ingot', n: 5 }], sell: [{ k: 'chair', m: 'pine', q: 2, n: 1 }] },
  caravan: { colIds: [1], goods: [{ k: 'meal', n: 10 }], town: 'brindle' },
  garrison: { colId: 1, bId: 0 },
  vigil: { colId: 1, bId: 0 },
  feast: { roomId: 2 },
  perk: { colId: 1, perk: 'cave_sense' },
  challenge: { lord: 'gloomwyrm' },
};
const INVALID = {
  designate: [{ kind: 'dig', rect: R, add: true }, { kind: 'mine', rect: { x0: 0, y0: 0, x1: 500, y1: 1 }, add: true }, { kind: 'mine', rect: R }],
  cancelRect: [{ rect: R, kinds: [] }, { rect: R, kinds: ['laser'] }],
  place: [{ def: 'wall', x: 999, y: 5, rot: 0, mat: null }, { def: 'Wall!', x: 5, y: 5, rot: 0 }, { def: 'wall', x: 5, y: 5, rot: 4 }],
  placeLine: [{ def: 'wall', path: [[1, 1], [5, 5]] }, { def: 'wall', path: [] }],
  stamp: [{ kind: 'bedroom', rect: R, furnish: 'yes' }],
  carve: [{ rect: R, pattern: 'spiral', smooth: false }],
  copyRoom: [{ roomId: 0 }],
  paste: [{ templateId: -1, x: 1, y: 1, rot: 0 }],
  deconstruct: [{}, { ids: [0], rect: R }],
  zone: [{ op: 'new', type: 'stockpile' }, { op: 'delete', zoneId: 99 }, { op: 'expand', zoneId: 1 }, { op: 'paint', zoneId: 1 }],
  zoneCfg: [{ zoneId: 1, patch: { colour: 'red' } }, { zoneId: 1, patch: { pri: 9 } }],
  bill: [{ op: 'remove', bId: 0, bill: { i: 7 } }, { op: 'add', bId: 5, bill: { recipe: 'stool' } }, { op: 'move', bId: 0, bill: { i: 0, to: 9 } }],
  role: [{ colId: 99, primary: 'miner' }, { colId: 1, primary: 'miner', secondary: 'miner' }],
  prio: [{ colId: 1, work: 'dance', p: 1 }, { colId: 1, work: 'mine', p: 5 }],
  sched: [{ colId: 1, hours: [1, 2, 3] }],
  soldier: [{ colId: 1, on: 1 }],
  draft: [{ colIds: [], on: true }, { colIds: [1, 1], on: true }],
  order: [{ colIds: [1], kind: 'move' }, { colIds: [1], kind: 'dance', target: { x: 1, y: 1 } }],
  prioritise: [{ colId: 1, target: { x: -1, y: 4 }, work: 'build' }],
  forbid: [{ on: true }],
  upgrade: [{ bId: 3 }],
  spec: [{ bId: 0, spec: '' }],
  assign: [{ bId: 0, colId: 77 }],
  outfit: [{ colId: 1 }],
  research: [{ tech: 5 }],
  charter: [{ id: null }],
  letter: [{ id: 1, choice: 12 }],
  trade: [{ visitId: 1, buy: [{ k: 'iron', n: 0 }], sell: [] }],
  caravan: [{ colIds: [1], goods: 'all', town: 'brindle' }],
  garrison: [{ colId: 1, bId: 44 }],
  vigil: [{ colId: 5, bId: 0 }],
  feast: [{ roomId: 'hall' }],
  perk: [{ colId: 1 }],
  challenge: [{}],
};

test('every 13.3 command has a spec, and nothing else is a command', () => {
  assert.deepEqual([...COMMAND_NAMES].sort(), [...DOC].sort());
  assert.ok(!('speed' in COMMANDS), 'speed is not a command');
});

test('a valid payload passes every validator', () => {
  const s = world();
  for (const name of DOC) assert.equal(validateCommand(s, { t: name, ...VALID[name] }), null, name);
});

test('invalid payloads are rejected with a reason', () => {
  const s = world();
  for (const name of DOC) {
    assert.ok(INVALID[name] && INVALID[name].length, `${name} has invalid samples`);
    for (const bad of INVALID[name]) {
      const r = validateCommand(s, { t: name, ...bad });
      assert.equal(typeof r, 'string', `${name} ${JSON.stringify(bad)} should be invalid`);
      assert.ok(r.length > 3);
    }
  }
  assert.match(validateCommand(s, { t: 'warp' }), /unknown command/);
  assert.match(validateCommand(s, { t: 'upgrade', bId: 0, extra: 1 }), /unexpected field/);
  assert.equal(typeof validateCommand(s, null), 'string');
});

test('appliers are stubbed until an owner registers one; the log records accepted commands', () => {
  resetAppliers();
  const s = world();
  const log = [];
  assert.deepEqual(applyCommand(s, { t: 'designate', ...VALID.designate }, log), { ok: true, stub: true });
  assert.equal(applyCommand(s, { t: 'designate', kind: 'x', rect: R, add: true }, log).ok, false);
  assert.equal(log.length, 1); assert.equal(log[0][0], 0);
  let seen = null;
  registerApplier('designate', (st, c) => { seen = c.kind; return { ok: true }; });
  assert.deepEqual(applyCommand(s, { t: 'designate', ...VALID.designate }), { ok: true });
  assert.equal(seen, 'mine');
  assert.throws(() => registerApplier('teleport', () => null));
  resetAppliers();
});

test('content lookup plugs in (unknown ids are refused once data exists)', () => {
  const s = world();
  setContentLookup((kind, id) => !(kind === 'structure' && id === 'moonbase'));
  assert.match(validateCommand(s, { t: 'place', def: 'moonbase', x: 1, y: 1, rot: 0 }), /unknown structure/);
  assert.equal(validateCommand(s, { t: 'place', def: 'wall', x: 1, y: 1, rot: 0 }), null);
  setContentLookup(null);
});

// Unit tests for the pure tool helpers of workstream I (js/game/tools/rect.js, pick.js) and the
// layout plan (js/ui/layout.js plannedWorld against the doc 10.1 table).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColony } from '../../js/game/core/state.js';
import { newColonist } from '../../js/game/core/schema.js';
import { TILE, TER } from '../../js/game/core/grid.js';
import { validateCommand } from '../../js/game/core/commands.js';
import { tileAt, rectOf, rectLabel, strokeCommand, undoCommand, RECT_TOOLS } from '../../js/game/tools/rect.js';
import { pickAt, pickColonist, PICK } from '../../js/game/tools/pick.js';
import { plannedWorld, isLandscape } from '../../js/ui/layout.js';

test('rect: drag in any direction gives the same clipped rectangle and label', () => {
  const s = createColony('ui-rect', { w: 32 });
  assert.deepEqual(rectOf({ x: 5, y: 9 }, { x: 2, y: 4 }), { x0: 2, y0: 4, x1: 5, y1: 9 });
  assert.equal(rectLabel({ x0: 2, y0: 4, x1: 7, y1: 7 }), '6 x 4, 24 tiles');
  assert.equal(rectLabel({ x0: 1, y0: 1, x1: 1, y1: 1 }), '1 x 1, 1 tile');
  assert.deepEqual(tileAt(-50, 99999), { x: 0, y: s.h - 1 });
});

test('rect: every rectangle tool makes a valid command, and undo inverts a designation', () => {
  const s = createColony('ui-rect2', { w: 32 });
  const r = { x0: 1, y0: 2, x1: 4, y1: 3 };
  for (const id of Object.keys(RECT_TOOLS)) {
    for (const mode of ['add', 'remove']) {
      const c = strokeCommand(id, r, mode);
      assert.equal(validateCommand(s, c), null, `${id} ${mode}: ${validateCommand(s, c)}`);
    }
  }
  const c = strokeCommand('mine', r, 'add');
  assert.deepEqual(undoCommand(c), { ...c, add: false });
  assert.equal(undoCommand(strokeCommand('cancel', r)), null);
  assert.equal(strokeCommand('nope', r), null);
});

test('pick: colonists win within 22 pt; pips have a 44 pt hit area at any zoom', () => {
  const s = createColony('ui-pick', { w: 32 });
  s.col.push(newColonist(1, { name: 'A', x: 10.5 * TILE, y: 10.5 * TILE }), newColonist(2, { name: 'B', x: 11.5 * TILE, y: 10.5 * TILE }));
  const bodyY = 10.5 * TILE - TILE * 0.35;
  // zoom 1: 20 pt off the body centre still selects; 23 pt does not
  assert.equal(pickColonist(s.col, 10.5 * TILE - 20, bodyY, 1).id, 1);
  assert.equal(pickColonist(s.col, 10.5 * TILE - 23, bodyY, 1), null);
  // nearest wins
  assert.equal(pickColonist(s.col, 11.1 * TILE, bodyY, 1).id, 2);
  // zoom 0.4 (pips): 21 pt on screen = 52.5 world units still hits
  assert.equal(pickColonist(s.col, 10.5 * TILE - 21 / 0.4, 10.5 * TILE, 0.4).id, 1);
  assert.ok(PICK.pipHitPt === 44 && PICK.colonistPt === 22);
});

test('pick: a tap away from colonists selects the tile, and a second tap cycles back to it', () => {
  const s = createColony('ui-pick2', { w: 32, terrain: TER.GRASS });
  const a = pickAt(s, 3.5 * TILE, 4.5 * TILE, 1, null);
  assert.equal(a.kind, 'tile'); assert.equal(a.x, 3); assert.equal(a.y, 4);
  const b = pickAt(s, 3.5 * TILE, 4.5 * TILE, 1, a);
  assert.equal(b.kind, 'tile');
  assert.equal(pickAt(s, -5, 4, 1, null), null);
});

test('layout: the 10.1 table (world height, nothing selected and with a peek card)', () => {
  const rows = [[375, 635, 483, 415], [390, 664, 512, 444], [430, 740, 588, 520], [390, 763, 611, 543]];
  for (const [w, h, world, peek] of rows) {
    const p = plannedWorld(w, h);
    assert.equal(p.height, world, `${w}x${h}`); assert.equal(p.heightPeek, peek, `${w}x${h} peek`);
  }
  // iPhone 13 standalone with insets equals the 390 x 763 gate viewport
  assert.equal(plannedWorld(390, 844, { t: 47, r: 0, b: 34, l: 0 }).height, 611);
  const l = plannedWorld(844, 335, { t: 0, r: 47, b: 0, l: 47 });
  assert.ok(l.landscape && isLandscape(844, 335) && !isLandscape(430, 740));
  assert.equal(l.height, 291); assert.equal(l.widthPeek, 844 - 47 - 47 - 56 - 320);
});

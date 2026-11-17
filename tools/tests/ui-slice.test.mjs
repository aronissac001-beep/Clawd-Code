// Unit tests for workstream I's Stage 1a tool planners (js/game/tools/stamp.js, carve.js, copy.js,
// line.js, place.js): each preview must match what the command (A's appliers) then does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { applyCommand, validateCommand } from '../../js/game/core/commands.js';
import { W, H, idx, inB, TER, DESIG } from '../../js/game/core/grid.js';
import { structDef } from '../../js/game/core/content.js';
import { mineTile } from '../../js/game/world/terrain.js';
import { tick } from '../../js/game/core/sim.js';
import { stampPlan, stampCommand, stampLabel, snapDoor, doorSpotOk } from '../../js/game/tools/stamp.js';
import { carvePlan, carveCommand, carveLabel } from '../../js/game/tools/carve.js';
import { roomAt, pastePlan, pasteCommand, pasteAnchor, templateSize } from '../../js/game/tools/copy.js';
import { linePath, rectPath, MAX_LINE } from '../../js/game/tools/line.js';
import { ghost, placeShape, anchorFor, nextRot, matChoices, costText } from '../../js/game/tools/place.js';
import { strokeCommand, RECT_TOOLS } from '../../js/game/tools/rect.js';

function colony(seed = 'UI-SLICE') {
  installSim({ stage: '1a' });
  return foundColony({ seed, name: 'UI Hold' });
}
/** An open w x h area (all buildable, no buildings) near the Hearth: its top-left tile, or null. */
function openSpot(s, w, h) {
  const hb = s.bld[s.colony.hearth.id];
  for (let r = 4; r < 60; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = hb.x + dx, y = hb.y + dy;
    if (!inB(x, y) || !inB(x + w - 1, y + h - 1)) continue;
    let ok = true;
    for (let yy = y; yy < y + h && ok; yy++) for (let xx = x; xx < x + w && ok; xx++) {
      const i = idx(xx, yy);
      if (s.rt.occ[i] >= 0 || s.rt.itemAt[i] >= 0 || s.L.plant[i] || ![TER.GRASS, TER.MEADOW, TER.DIRT].includes(s.L.terrain[i])) ok = false;
    }
    if (ok) return { x, y };
  }
  return null;
}
/** A w x h block that is all rock: top-left, or null. */
function rockSpot(s, w, h) {
  for (let y = 2; y < H - h - 2; y++) for (let x = 2; x < W - w - 2; x++) {
    let ok = true;
    for (let yy = y; yy < y + h && ok; yy++) for (let xx = x; xx < x + w && ok; xx++) if (s.L.terrain[idx(xx, yy)] !== TER.ROCK) ok = false;
    if (ok) return { x, y };
  }
  return null;
}

test('line: axis-locked wall lines and serpentine floor paths are valid placeLine paths', () => {
  const s = colony();
  assert.deepEqual(linePath({ x: 2, y: 2 }, { x: 6, y: 4 }), [[2, 2], [3, 2], [4, 2], [5, 2], [6, 2]]);
  assert.deepEqual(linePath({ x: 5, y: 9 }, { x: 4, y: 6 }), [[5, 9], [5, 8], [5, 7], [5, 6]]);
  const p = rectPath({ x0: 3, y0: 3, x1: 6, y1: 5 });
  assert.equal(p.length, 12);
  assert.equal(validateCommand(s, { t: 'placeLine', def: 'f_planks', path: p }), null);
  assert.equal(rectPath({ x0: 0, y0: 0, x1: 99, y1: 99 }).length, MAX_LINE);
});

test('place: shapes, anchors, rotation, materials and cost lines', () => {
  const s = colony();
  assert.equal(placeShape(structDef('wall')), 'line');
  assert.equal(placeShape(structDef('door')), 'single');
  assert.equal(placeShape(structDef('f_planks')), 'rect');
  assert.equal(placeShape(structDef('bed')), 'single');
  assert.equal(nextRot(structDef('bed'), 0), 1);
  assert.equal(nextRot(structDef('wall'), 0), 0);
  const a = anchorFor(structDef('hearth'), { x: 10, y: 10 }, 0);
  assert.deepEqual(a, { x: 9, y: 9 });
  const m = matChoices(s, structDef('wall')).map((c) => c.id);
  assert.ok(m.includes('wood') && m.includes(null));
  assert.equal(costText(structDef('carpenter')), 'Wood 40');
  assert.match(costText(structDef('wall')), /Blocks 5 or Wood 8 per tile/);
  assert.match(costText(structDef('bed')), /Made at a carpenter or mason/);
  // the ghost agrees with the command
  const sp = openSpot(s, 2, 2);
  const g = ghost(s, 'bed', sp.x, sp.y, 0);
  assert.ok(g.ok, g.why);
  assert.ok(applyCommand(s, { t: 'place', def: 'bed', x: sp.x, y: sp.y, rot: 0 }).ok);
  assert.equal(ghost(s, 'bed', sp.x, sp.y, 0).ok, false);
});

test('stamp: a 5 x 4 bedroom plan matches the stamp command (walls, door, floor, bed)', () => {
  const s = colony();
  const sp = openSpot(s, 5, 4);
  assert.ok(sp, 'an open 5 x 4 spot');
  const o = { kind: 'bedroom', rect: { x0: sp.x, y0: sp.y, x1: sp.x + 4, y1: sp.y + 3 }, furnish: true, wallMat: 'wood' };
  const plan = stampPlan(s, o);
  assert.ok(plan.ok, plan.why);
  assert.equal(plan.counts.walls, 13);          // 14 border tiles less the door
  assert.ok(plan.door && plan.door.ok);
  assert.equal(plan.furniture.length, 1); assert.equal(plan.furniture[0].def, 'bed');
  assert.equal(plan.counts.floors, 6 - 2);       // 3 x 2 inside, less the bed (1 x 2)
  assert.match(stampLabel(o, plan), /Bedroom 5 x 4: 13 walls, a door, 4 floor, bed/);
  const before = s.bld.filter(Boolean).length;
  const cmd = stampCommand(o, plan);
  assert.equal(validateCommand(s, cmd), null);
  const r = applyCommand(s, cmd);
  assert.ok(r.ok, r.reason);
  const made = s.bld.filter(Boolean).slice(before);
  const count = (d) => made.filter((b) => b.def === d).length;
  assert.equal(count('wall'), plan.counts.walls);
  assert.equal(count('door'), 1);
  assert.equal(count('bed'), 1);
  assert.equal(count('f_planks'), plan.counts.floors);
  const door = made.find((b) => b.def === 'door');
  assert.deepEqual([door.x, door.y], [plan.door.x, plan.door.y]);
});

test('stamp: a moved door, min size and the door rules', () => {
  const s = colony('UI-SLICE-2');
  const sp = openSpot(s, 6, 5);
  const q = { x0: sp.x, y0: sp.y, x1: sp.x + 5, y1: sp.y + 4 };
  const d = snapDoor(q, sp.x - 3, sp.y + 2);
  assert.deepEqual(d, { x: sp.x, y: sp.y + 2 });
  assert.ok(doorSpotOk(q, d.x, d.y) && !doorSpotOk(q, q.x0, q.y0));
  const o = { kind: 'plain', rect: q, furnish: true, door: d };
  const plan = stampPlan(s, o);
  assert.ok(plan.ok);
  assert.deepEqual([plan.door.x, plan.door.y], [d.x, d.y]);
  assert.equal(stampPlan(s, { kind: 'bedroom', rect: { x0: 4, y0: 4, x1: 5, y1: 8 }, furnish: true }).ok, false);
  assert.equal(stampPlan(s, { kind: 'plain', rect: q, furnish: true, door: { x: q.x0, y: q.y0 } }).why, 'the door must be on a side of the room');
});

test('carve: the 9 x 9 hall plan matches the carve command (mine marks and the pillar plan)', () => {
  const s = colony('UI-CARVE');
  const sp = rockSpot(s, 13, 13);
  assert.ok(sp, 'a 13 x 13 rock block');
  const o = { rect: { x0: sp.x + 2, y0: sp.y + 2, x1: sp.x + 10, y1: sp.y + 10 }, pattern: 'natural', smooth: false };
  const plan = carvePlan(s, o);
  assert.ok(plan.ok);
  assert.equal(plan.mine.length + plan.keep.length, 81);
  const r = applyCommand(s, carveCommand(o));
  assert.ok(r.ok, r.reason);
  assert.deepEqual(r.natural, plan.keep);
  let marked = 0;
  for (const i of plan.mine) if (s.L.desig[i] & DESIG.MINE) marked++;
  assert.equal(marked, plan.mine.length);
  for (const i of plan.keep) assert.equal(s.L.desig[i] & DESIG.MINE, 0);
  assert.match(carveLabel(o, plan), /^Hall 9 x 9: /);
  // a 20 x 20 hall needs pillars; built pillars mine every tile
  const big = rockSpot(s, 22, 22);
  if (big) {
    const o2 = { rect: { x0: big.x + 1, y0: big.y + 1, x1: big.x + 20, y1: big.y + 20 }, pattern: 'pillar', smooth: true };
    const p2 = carvePlan(s, o2);
    assert.equal(p2.keep.length, 0);
    assert.ok(p2.built.length >= 4);
    assert.ok(p2.smooth.length > 0);
  }
  assert.equal(carvePlan(s, { rect: { x0: 0, y0: 0, x1: 0, y1: 0 }, pattern: 'natural' }).ok, s.L.terrain[0] === TER.ROCK || s.L.terrain[0] === TER.RUBBLE);
});

test('copy: copyRoom a stamped room, then the paste plan matches the paste command', () => {
  const s = colony('UI-COPY');
  const sp = openSpot(s, 12, 5);
  const o = { kind: 'bedroom', rect: { x0: sp.x, y0: sp.y, x1: sp.x + 4, y1: sp.y + 3 }, furnish: true };
  assert.ok(applyCommand(s, stampCommand(o, stampPlan(s, o))).ok);
  // build it at once so the room exists (blueprints do not wall a room)
  for (const b of s.bld) if (b && b.st === 'bp') { b.st = 'done'; }
  s.rt.dirty.rooms = true;
  for (const b of s.bld) if (b) { /* occ already set */ }
  tick(s);
  const inside = idx(sp.x + 2, sp.y + 2);
  const rid = roomAt(s, inside);
  assert.ok(rid > 0, 'the stamped room is a room');
  assert.equal(roomAt(s, idx(sp.x, sp.y + 1)), rid, 'a wall tile finds its room');
  const r = applyCommand(s, { t: 'copyRoom', roomId: rid });
  assert.ok(r.ok, r.reason);
  const tm = s.colony.templates.find((t) => t.id === r.templateId);
  assert.deepEqual(templateSize(tm, 1), [tm.h, tm.w]);
  const at = pasteAnchor(tm, { x: sp.x + 9, y: sp.y + 2 }, 1);
  const plan = pastePlan(s, tm, at.x, at.y, 1);
  const before = s.bld.filter(Boolean).length;
  const res = applyCommand(s, pasteCommand(tm, at.x, at.y, 1));
  if (plan.ok) {
    assert.ok(res.ok, res.reason);
    assert.equal(s.bld.filter(Boolean).length - before, plan.n);
  } else assert.equal(res.ok, false);
});

test('rect: every Orders rectangle tool makes a valid command', () => {
  const s = colony();
  const r = { x0: 3, y0: 3, x1: 6, y1: 5 };
  for (const id of Object.keys(RECT_TOOLS)) for (const mode of ['add', 'remove']) {
    const c = strokeCommand(id, r, mode);
    assert.equal(validateCommand(s, c), null, `${id} ${mode}`);
  }
});

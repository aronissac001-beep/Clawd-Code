// C2 v3 voxel indexes (EMBERCROWN-FORTRESS.md 7.2, Stage Z1 step E1): the `tile` field type, u32 paths, and
// VOXEL_REFS / mapVoxelRefs, the one list of every saved place a voxel index lives in (the codec and the v3 -> v4
// world migration use it). On a real bot state: every listed place is visited, a shift by one level and back
// restores the hash exactly, and no tile-like number in the saved JSON is missed by the list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../js/game/core/schema.js';
import { stateHash, entitiesJSON, checkState } from '../../js/game/core/state.js';
import { N, PLANE, INDEX_SPAN, setMapSize } from '../../js/game/core/grid.js';
import { runBot2 } from '../lib/bot2.mjs';

test('the tile type: an integer voxel index 0..N-1; paths are Uint32Array of indexes < N', () => {
  setMapSize(128);
  assert.ok(S.fieldTypeOk('tile', 0) && S.fieldTypeOk('tile', N - 1));
  for (const v of [-1, N, 1.5, '3', null]) assert.ok(!S.fieldTypeOk('tile', v), String(v));
  const p = S.newPath([1, 2, 70000 % N]);
  assert.ok(p.tiles instanceof Uint32Array);
  assert.ok(S.fieldTypeOk('path', p));
  assert.ok(!S.fieldTypeOk('path', { tiles: Uint16Array.from([1]), i: 0 }), 'a u16 path is not a C2 v3 path');
  assert.ok(!S.fieldTypeOk('path', { tiles: Uint32Array.from([N]), i: 0 }), 'an index past N is refused');
  assert.equal(S.newPath(new Uint32Array(3)).tiles.length, 3);
  for (const kind of Object.keys(S.FIELDS)) for (const name of S.tileFields(kind)) assert.equal(S.FIELDS[kind].find((f) => f.name === name).type, 'tile');
  assert.deepEqual(S.pathFields('col'), ['path']);
  assert.ok(INDEX_SPAN >= 1e6);
});

// Names under which a saved number may be a voxel index, and the paths where such a name is NOT one.
const SUSPECT = /(^|\.)(i|tiles|target|key|goal|pillars|natural|claims|unreach|edge)(\.|\[|$)/;
const NOT_VOXEL = [/\.path\.i$/, /\.job\.i$/, /^\.rt\.flow\[\]/, /\.toils\[\]\.(n|a|b|bi|c|g)$/, /\.(claims|unreach)\[\]\[1\]$/];
function leaves(v, p, out) {
  // a short all-number array inside an array is a tuple ([key, n]): its positions are named
  if (Array.isArray(v) && p.endsWith('[]') && v.length <= 3 && v.every((x) => typeof x === 'number')) { v.forEach((x, k) => leaves(x, `${p}[${k}]`, out)); return out; }
  if (Array.isArray(v)) { v.forEach((x) => leaves(x, p + '[]', out)); return out; }
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) leaves(v[k], p + '.' + (/^\d+$/.test(k) ? '#' : k), out); return out; }
  if (typeof v === 'number') out.push([p, v]);
  return out;
}

test('mapVoxelRefs on a 9-day bot colony: visits every listed place; one level up and back keeps the hash; nothing missed', async () => {
  const { s } = await runBot2({ seed: 1, days: 9 });
  assert.deepEqual(checkState(s), []);
  const h0 = stateHash(s);
  const kinds = { tile: 0, key: 0 };
  const visited = S.mapVoxelRefs(s, (i, k) => { kinds[k]++; assert.ok(i >= 0 && i < N, `index ${i} in range`); return i; });
  assert.equal(stateHash(s), h0, 'the identity map changes nothing');
  assert.ok(visited > 50 && kinds.tile > 0 && kinds.key > 0, `${visited} visited (${JSON.stringify(kinds)})`);
  // on a copy, shift every voxel index by a marker: every tile-like saved number must have moved (or be an entity key)
  const MARK = 10 * INDEX_SPAN;
  const { rt, ...rest } = s;
  const m = { ...structuredClone(rest), rt: { pathQ: structuredClone(rt.pathQ) } };
  S.mapVoxelRefs(m, (i) => i + MARK);
  const plain = { col: m.col.map((c) => c && { job: c.job, unreach: c.unreach }), anim: m.anim.map((a) => a && { job: a.job }),
    foes: m.foes.map((f) => f && { job: f.job }), raids: m.raids, colony: m.colony, st: m.st };
  const sus = leaves(plain, '', []).filter(([p]) => SUSPECT.test(p) && !NOT_VOXEL.some((re) => re.test(p)));
  assert.ok(sus.length > 10 && sus.some(([p]) => /plans/.test(p)) && sus.some(([p]) => /edge/.test(p)), `${sus.length} tile-like numbers scanned`);
  const missed = sus.filter(([, v]) => v >= 0 && v < INDEX_SPAN);
  assert.deepEqual(missed.slice(0, 8), [], 'tile-like numbers not in VOXEL_REFS');
  assert.ok(m.rt.pathQ.every((r, k) => r[2] === rt.pathQ[k][2] + MARK), 'path queue goals moved');
  assert.ok(m.col.every((c, k) => !c.path || c.path.tiles.every((t, j) => t === s.col[k].path.tiles[j] + MARK)), 'paths moved');
  // one level up (as the world migration does with zS), then back
  S.mapVoxelRefs(s, (i) => i + PLANE);
  assert.notEqual(stateHash(s), h0);
  S.mapVoxelRefs(s, (i) => i - PLANE);
  assert.equal(stateHash(s), h0);
});

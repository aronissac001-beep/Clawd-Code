// Z2b (EMBERCROWN-FORTRESS.md 3.9): theft and assault as crimes. Owner F (the acts, people/needjobs.js) and K (the
// cases, colony/justice.js).   node --test tools/tests/crimes.test.mjs
// Oracle: a Greedy colonist in a break carries a named item to their bedroom and a theft case opens (worse for an
// artifact); a Quick to anger colonist on an insult spree strikes the one they confront and an assault case opens with
// the victim; with the laws off the acts still happen, without cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { tick } from '../../js/game/core/sim.js';
import { installContent } from '../../js/game/core/content.js';
import { addBuilding } from '../../js/game/core/apply.js';
import { idx, inB, TER_BUILDABLE, TER_WATER } from '../../js/game/core/grid.js';
import { TICKS_PER_HOUR } from '../../js/game/core/time.js';
import { completeBuilding } from '../../js/game/work/construct.js';
import { spawnAt } from '../../js/game/work/items.js';
import { startBreakOf } from '../../js/game/people/breaks.js';
import { setPsy, psyOf } from '../../js/game/people/personality.js';
import { opinion } from '../../js/game/people/social.js';
import { buildRegistry } from '../../js/data/schema.js';
import { ENTRIES } from '../../js/data/index.js';
import * as DLAWS from '../../js/data/laws.js';
import * as DOFF from '../../js/data/offices.js';
import * as J from '../../js/game/colony/justice.js';

const extra = ENTRIES.some((e) => e.path === 'laws.js') ? [] : [{ path: 'laws.js', owner: 'K', mod: DLAWS }];
if (!ENTRIES.some((e) => e.path === 'offices.js')) extra.push({ path: 'offices.js', owner: 'K', mod: DOFF });
const REG = buildRegistry([...ENTRIES, ...extra]);
function colony(seed) {
  installSim({ stage: '2', reset: true });
  installContent({ reg: REG });
  J.installJustice();
  return foundColony({ seed, name: 'Crime Hold', d: 1 });
}
const hearth = (s) => s.bld[s.colony.hearth.id];
function site(s, x, y, w, h, z) {
  const ok = (x0, y0) => { for (let yy = y0 - 1; yy < y0 + h + 1; yy++) for (let xx = x0 - 1; xx < x0 + w + 1; xx++) { if (!inB(xx, yy, z)) return false; const i = idx(xx, yy, z), t = s.L.terrain[i]; if (!TER_BUILDABLE[t] || TER_WATER[t] || s.rt.occ[i] >= 0 || s.rt.itemAt[i] >= 0) return false; } return true; };
  for (let r = 0; r < 64; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && ok(x + dx, y + dy)) return [x + dx, y + dy];
  return null;
}
const place = (c, x, y, z) => { c.x = x * 32 + 16; c.y = y * 32 + 16; c.z = z; };

function theftScene(seed, lawsOn) {
  const s = colony(seed);
  if (!lawsOn) s.colony.laws = false;
  const hb = hearth(s), z = hb.z | 0;
  const at = site(s, hb.x + 6, hb.y + 4, 1, 2, z);
  const bed = addBuilding(s, 'bed', at[0], at[1], 0, null, { z });
  completeBuilding(s, bed);
  const a = s.col[0];
  a.traits = a.traits.filter((t) => t !== 'ascetic');
  if (!a.traits.includes('greedy')) a.traits.push('greedy');
  a.bed = bed.id;
  const it0 = site(s, hb.x - 6, hb.y - 4, 1, 1, z);
  const id = spawnAt(s, 'figurine', null, 5, 1, idx(it0[0], it0[1], z), { name: 'The Ember Hart' });
  assert.ok(id >= 0, 'the artifact lies in the hold');
  startBreakOf(s, a, 'sulk', 'minor');
  let k = null, moved = false;
  for (let i = 0; i < 3 * TICKS_PER_HOUR; i++) {
    tick(s);
    const it = s.items.find((x) => x && x.name === 'The Ember Hart');
    if (it && Math.max(Math.abs(it.x - bed.x), Math.abs(it.y - bed.y)) <= 2) moved = true;
    k = J.casesOf(s).find((x) => x.kind === 'theft') || null;
    if (moved && (k || !lawsOn)) break;
  }
  return { s, a, k, moved };
}

test('Z2b theft: a Greedy colonist in a break carries a named artifact to their bedroom; a theft case opens (worse: an artifact)', () => {
  const { a, k, moved } = theftScene('F-theft', true);
  assert.ok(moved, 'the artifact lies by their bed');
  assert.ok(k, 'a theft case');
  assert.equal(k.off, a.id);
  assert.match(k.what, /Ember Hart/);
  assert.equal(k.sev, DLAWS.CRIMES.theft.sev + 1, 'an artifact makes it worse');
  assert.equal(a.breakState ? a.breakState.stole : 1, 1, 'one theft per break');
});

test('Z2b theft with the laws off: the act still happens, without a case', () => {
  const { k, moved } = theftScene('F-theft-off', false);
  assert.ok(moved);
  assert.equal(k, null);
});

test('Z2b assault: a Quick to anger colonist on an insult spree strikes the one they confront; an assault case names the victim', () => {
  const s = colony('F-assault');
  const hb = hearth(s), z = hb.z | 0;
  const [a, b] = [s.col[0], s.col[1]];
  for (const o of s.col.slice(2)) { o.hp.dead = true; }
  a.traits = a.traits.filter((t) => t !== 'greedy');
  const f = psyOf(s, a).f.slice(); f[1] = 3; setPsy(s, a, { f });
  place(b, hb.x + 3, hb.y + 2, z);
  const before = opinion(s, b.id, a.id);
  const hp0 = JSON.stringify(b.hp.wounds);
  startBreakOf(s, a, 'insult_spree', 'major');
  assert.equal(a.breakState.id, 'insult_spree');
  let k = null;
  for (let i = 0; i < 2 * TICKS_PER_HOUR && !k; i++) { place(b, hb.x + 3, hb.y + 2, z); b.job = null; tick(s); k = J.casesOf(s).find((x) => x.kind === 'assault') || null; }
  assert.ok(k, 'an assault case');
  assert.equal(k.off, a.id);
  assert.equal(k.vic, b.id);
  assert.notEqual(JSON.stringify(b.hp.wounds), hp0, 'the victim is hurt');
  assert.ok(!b.hp.dead, 'a blow, not a killing');
  assert.ok(opinion(s, b.id, a.id) < before);
});

test('Z2b assault: an even-tempered colonist only insults', () => {
  const s = colony('F-assault-calm');
  const hb = hearth(s), z = hb.z | 0;
  const [a, b] = [s.col[0], s.col[1]];
  for (const o of s.col.slice(2)) { o.hp.dead = true; }
  a.traits = a.traits.filter((t) => t !== 'greedy');
  const f = psyOf(s, a).f.slice(); f[1] = 0; setPsy(s, a, { f });
  startBreakOf(s, a, 'insult_spree', 'major');
  for (let i = 0; i < 2 * TICKS_PER_HOUR; i++) { place(b, hb.x + 3, hb.y + 2, z); b.job = null; tick(s); }
  assert.ok(!J.casesOf(s).some((x) => x.kind === 'assault'));
});

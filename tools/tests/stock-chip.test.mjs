// W0.2 (EMBERCROWN-WORLD.md 12.2, 11 item 3; owner I): the stock chip and its strip read stock by item category,
// as Colony > Stock counts it. The old chip read stale kind ids ('wood', 'stone', 'block', 'ingot', 'meal') from
// s.rt.stock and showed 0 for stocked materials. On the three W0 fixtures every category row of stockRowsOf()
// equals the Hold / Stock total of that category, counted here independently the way colonyui.js stockTab does
// (every stack that is not forbidden, grouped by its item's category; unknown kinds count as 'goods').
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadBlob } from '../../js/game/save/colonysave.js';
import { installSim } from '../../js/game/core/setup.js';
import { def, all } from '../../js/game/core/content.js';
import { stockRowsOf, stockCats } from '../../js/ui/shell.js';

const FIX = new URL('../fixtures/', import.meta.url);
const NAMES = ['v4-z3-day120', 'v4-z3-flood', 'v4-z3-beast'];

/** Colony > Stock, as stockTab draws it: per kind totals, then per leaf category and per heading (top category). */
function holdStock(s) {
  const tot = new Map();
  for (const it of s.items) if (it && !it.f) tot.set(it.k, (tot.get(it.k) || 0) + it.n);
  const cats = all('itemCat');
  const topOf = (cat) => { const c = cats.find((x) => x.id === cat); return c && c.parent ? c.parent : cat; };
  const leaf = new Map(), head = new Map();
  for (const [k, n] of tot) {
    const d = def('item', k) || { cat: 'goods' };
    const c = d.cat || 'goods';
    leaf.set(c, (leaf.get(c) || 0) + n);
    head.set(topOf(c), (head.get(topOf(c)) || 0) + n);
  }
  return { leaf, head };
}

for (const name of NAMES) {
  test(`${name}: every stock chip category row equals Hold / Stock`, async () => {
    installSim({ stage: '2' });
    const s = await loadBlob(new Uint8Array(readFileSync(new URL(`${name}.ecsave`, FIX))));
    const { leaf, head } = holdStock(s);
    const rows = stockRowsOf(s, '2');
    const catRows = rows.filter((r) => r[3]);
    assert.deepEqual(catRows.map((r) => r[1]), ['Wood', 'Stone', 'Blocks', 'Ingots', 'Meals', 'Coins'], 'the category rows');
    const detail = [];
    for (const [, label, v, cs] of catRows) {
      const want = cs.split('+').reduce((a, c) => a + (leaf.get(c) || 0), 0);
      detail.push(`${label} ${v}`);
      assert.equal(Number(v), want, `${name}: ${label} shows ${v}, Hold / Stock has ${want}`);
    }
    // the helper's totals are the Hold / Stock totals, category by category, and add up to the headings
    const cats = stockCats(s);
    assert.deepEqual([...cats].sort(), [...leaf].sort(), 'every category');
    const sum = [...head.values()].reduce((a, n) => a + n, 0);
    assert.equal([...cats.values()].reduce((a, n) => a + n, 0), sum, 'the headings add up');
    // the bug: stocked materials read 0. A day-120 hold has wood, stone and blocks in stock
    if (name === 'v4-z3-day120') for (const l of ['Wood', 'Stone']) assert.ok(Number(catRows.find((r) => r[1] === l)[2]) > 0, `${l} is not 0 (${detail.join(', ')})`);
    // the weather cell reads "Clear, 10 C" (11 item 4)
    const wx = rows[rows.length - 1];
    if (!wx[3] && /C$/.test(wx[2])) assert.match(`${wx[1]} ${wx[2]}`, /^[A-Z][a-z ]+, -?\d+ C$/);
    console.log(`# ${name}: ${detail.join(', ')}; ${rows[0][1]} ${rows[0][2]}; ${wx[1]} ${wx[2]}`);
  });
}

test('the Stage 1a chip reads categories too (wood leads; Ore is ore and fuel)', async () => {
  installSim({ stage: '2' });
  const s = await loadBlob(new Uint8Array(readFileSync(new URL('v4-z3-day120.ecsave', FIX))));
  const { leaf } = holdStock(s);
  const rows = stockRowsOf(s, '1a');
  assert.deepEqual(rows.map((r) => r[1]), ['Wood', 'Stone', 'Blocks', 'Ore']);
  assert.equal(Number(rows[3][2]), (leaf.get('ore') || 0) + (leaf.get('fuel') || 0));
});

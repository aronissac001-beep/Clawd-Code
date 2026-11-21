// tools/tests/data-2.test.mjs (owner J; written by G for Stage 2, doc 14.8 row G). Headless checks of
// the Camp, Hamlet and Village content: counts, eras and tiers, the Hearth levels, the food chain,
// stage and tech consistency, deeds, and the 30 advice rules (pure, silent in a 1b build).
import { test } from 'node:test';
import assert from 'node:assert/strict';
const ROOT = new URL('../../', import.meta.url).href;
const { CONTENT, validateContent } = await import(ROOT + 'js/data/index.js');
const S = await import(ROOT + 'js/data/schema.js');
const { EVENT_NAMES } = await import(ROOT + 'js/game/core/events.js');
const { installSim, foundColony } = await import(ROOT + 'js/game/core/setup.js');
const { stateHash } = await import(ROOT + 'js/game/core/state.js');

const all = (k) => CONTENT.all(k);
const upTo2 = (d) => S.availableIn(d, '2');
const CHV = ['camp', 'hamlet', 'village'];

test('Stage 2 content: about 90 Camp to Village structures, 60+ recipes, items of 6.2, 20 deeds, 30 advice rules', () => {
  const st = all('structure').filter((d) => upTo2(d) && CHV.includes(d.band || d.tier));
  assert.ok(st.length >= 90, `structures ${st.length}`);
  for (const t of CHV) assert.ok(st.some((d) => (d.band || d.tier) === t), t);
  assert.ok(all('recipe').filter(upTo2).length >= 60);
  assert.ok(all('item').length >= 95);
  assert.equal(all('deed').length, 20);
  assert.equal(all('advice').length, 30);
  assert.equal(new Set(all('deed').map((d) => d.id)).size, 20);
  for (const d of all('deed')) assert.ok(EVENT_NAMES.includes(d.goal.event), d.id);
});

test('research: Kindling, Hearth and Hold eras with Mechanisms; the first techs keep their bit positions', () => {
  const techs = all('tech');
  assert.deepEqual(techs.slice(0, 3).map((t) => t.id), ['masonry', 'carpentry', 'smelting']);
  for (const e of ['kindling', 'hearth', 'hold']) assert.ok(techs.filter((t) => t.era === e).length >= (e === 'hearth' ? 9 : 10), e);
  const mech = CONTENT.get('tech', 'mechanisms');
  assert.equal(mech.era, 'hold');
  for (const id of ['lever', 'plate']) assert.equal(CONTENT.get('structure', id).tech, 'mechanisms');
  // every structure and recipe tech is a Stage 2 era tech
  for (const d of [...all('structure'), ...all('recipe')].filter(upTo2)) if (d.tech) assert.ok(['kindling', 'hearth', 'hold'].includes(CONTENT.get('tech', d.tech).era), d.id);
  for (const t of techs) if (t.discover) assert.ok(EVENT_NAMES.includes(t.discover.event), t.id);
});

test('tiers to Village and Hearth levels 1-3; the Hearth upgrade path is the hearthLevel table', () => {
  const tiers = all('tier').map((t) => t.id);
  assert.deepEqual(tiers.slice(0, 3), CHV);
  const hl = all('hearthLevel');
  assert.deepEqual(hl.map((h) => h.lvl), [1, 2, 3]);
  const hearth = CONTENT.get('structure', 'hearth');
  assert.equal(hearth.levels.length, 2);
  hearth.levels.forEach((l, i) => assert.deepEqual(l.cost, hl[i + 1].cost));
  // Hamlet needs Hearth 2, whose cost is Camp-reachable (blocks and iron: the 1b mason and bloomery)
  assert.equal(CONTENT.get('tier', 'hamlet').hearth, 2);
  for (const k of Object.keys(hl[1].cost)) assert.ok(['block', 'ingot:iron'].includes(k), k);
  for (let i = 1; i < all('tier').length; i++) assert.ok(all('tier')[i].wealth > all('tier')[i - 1].wealth);
});

test('quality has the six 5.8 levels in order', () => {
  assert.deepEqual(all('quality').map((q) => q.id), ['crude', 'plain', 'fine', 'superior', 'masterwork', 'legendary']);
});

test('the food chain closes: farming, cooking, brewing and preserving reach their goods by Stage 2', () => {
  const makes = (k) => all('recipe').filter((r) => upTo2(r) && r.out.some((o) => o.k === k));
  const uses = (k) => all('recipe').filter((r) => upTo2(r) && r.in.some((x) => x.k === k));
  for (const [from, to] of [['grain', 'flour'], ['flour', 'bread'], ['grain', 'alewort'], ['alewort', 'ale'], ['honey', 'meadwort'], ['meadwort', 'mead'],
    ['berries', 'winewort'], ['winewort', 'wine'], ['meat', 'smokedmeat'], ['fish', 'smokedfish'], ['milk', 'cheese'], ['greens', 'pickles'], ['clay', 'jar'],
    ['jar', 'pickles'], ['meat', 'ration'], ['grain', 'ration'], ['herbs', 'poultice'], ['hide', 'leather'], ['flax', 'cloth'], ['wool', 'cloth'], ['carcass', 'meat']]) {
    assert.ok(uses(from).some((r) => r.out.some((o) => o.k === to)), `${from} -> ${to}`);
  }
  for (const k of ['meal', 'finemeal', 'feast', 'bread', 'ration', 'smokedmeat', 'pickles', 'cheese', 'ale', 'mead', 'wine']) {
    assert.ok(makes(k).length, k);
    assert.ok(CONTENT.get('item', k).food, `${k} is food`);
  }
  // made food is in the food tree; cask and smokehouse batches wait unattended
  for (const r of ['ferment_ale', 'smoke_meat', 'tan_leather', 'make_charcoal']) assert.ok(CONTENT.get('recipe', r).waitH > 0, r);
});

test('every Stage 2 recipe has a bench of its stage, and every bench with bills makes something', () => {
  for (const r of all('recipe').filter((x) => x.stage === '2')) {
    const benches = r.bench.map((b) => CONTENT.get('structure', b));
    assert.ok(benches.every((b) => b && b.workbench), r.id);
    assert.ok(benches.some(upTo2), r.id);
  }
  for (const s of all('structure').filter((d) => upTo2(d) && d.workbench && !d.workbench.workplace)) assert.ok(all('recipe').some((r) => r.bench.includes(s.id)), s.id);
  // the shipped data validates with no warnings (stage 2 obtainability included)
  const v = validateContent();
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
});

test('advice rules are pure, never throw, and the Stage 2 ones stay silent in a 1b build', () => {
  installSim({ stage: '1b' });
  const s = foundColony({ seed: 'advice-2', name: 'Advice Hold' });
  const h0 = stateHash(s);
  const run = () => all('advice').map((r) => { const w = !!r.when(s); return [r.id, w, w ? r.score(s) : null]; });
  const a = run(), b = run();
  assert.deepEqual(a, b);
  assert.equal(stateHash(s), h0, 'rules must not write state');
  const stage2 = all('advice').filter((r) => r.stage === '2').map((r) => r.id);
  assert.equal(stage2.length, 19);
  for (const [id, w] of a) if (stage2.includes(id)) assert.equal(w, false, `${id} fires in 1b`);
  // with the Stage 2 sim's free techs granted, the Camp rules can fire (a study desk after day 3)
  s.colony.techs[0] = 1; s.tick += 3 * 14400;
  const c = Object.fromEntries(all('advice').map((r) => [r.id, !!r.when(s)]));
  assert.equal(c.study_desk, true);
  for (const r of all('advice')) if (r.go.def) assert.ok(CONTENT.get('structure', r.go.def), r.id);
});

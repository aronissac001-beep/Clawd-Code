// Deed sources wired at the Stage 2.9 release (EMBERCROWN-FORTRESS.md 3.1; S9.7): the counters that perks are
// earned by, counted where the deed happens. Field Surgeon (wounds first tended), Ember Hands (a downed
// colonist's bleeding stopped), Taintbreaker (a tainted patient tended), Fever Watch (an infected wound cured
// by its doctor), Fire Arrows (a ranged hit) and Deep Reader (the scholar who finishes a research).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { tend } from '../../js/game/people/health.js';
import { deedCount } from '../../js/game/people/coldeeds.js';
import { studyYield } from '../../js/game/work/givers/lore.js';
import { canResearch, hasTech } from '../../js/game/colony/research.js';
import { all } from '../../js/game/people/defs.js';

function colony(seed) {
  installSim({ stage: '2', reset: true });
  const s = foundColony({ seed, name: 'Deed Hold' });
  s.st.queue.length = 0;
  return s;
}
const wound = (init = {}) => ({ part: 1, kind: 'cut', dmg: 5, bleed: 300, tended: 0, infected: 0, age: 0, ...init });

test('tend: the doctor counts wounds first tended and a downed patient whose bleeding stopped; a tainted patient counts once a visit', () => {
  const s = colony('deeds-tend');
  const [doc, pat] = s.col;
  pat.hp.wounds.push(wound(), wound({ part: 2 }));
  pat.hp.down = true;
  tend(s, doc, pat, null, 50);
  assert.equal(deedCount(doc, 'wounds_tended'), 2);
  assert.equal(deedCount(doc, 'bleeds_stopped'), 1);
  tend(s, doc, pat, null, 50);
  assert.equal(deedCount(doc, 'wounds_tended'), 2, 're-tending does not count again');
  assert.equal(deedCount(doc, 'bleeds_stopped'), 1);
  pat.hp.taint = 500;
  tend(s, doc, pat, null, 50);
  assert.equal(deedCount(doc, 'taint_tended'), 1);
  tend(s, pat, pat, null, 50);
  assert.equal(deedCount(pat, 'wounds_tended'), 0, 'bed rest (no doctor) counts nothing');
});

test('an infected wound tended by a doctor credits the cure to that doctor', () => {
  const s = colony('deeds-cure');
  const [doc, pat] = s.col;
  const w = wound({ tended: 40, bleed: 0, infected: 5, rolled: 1, infx: 1 });
  pat.hp.wounds.push(w);
  tend(s, doc, pat, null, 60);
  assert.equal(w.doc, doc.id);
  // the cure itself is the health step's (stage2Health): drive it the way the game does, by ticking
  return import('../../js/game/core/sim.js').then(({ step }) => {
    for (let k = 0; k < 40 && pat.hp.wounds.includes(w) && w.infected > 0; k++) { tend(s, doc, pat, null, 60); step(s, 600); }
    assert.equal(w.infected, 0, 'cured');
    assert.equal(deedCount(doc, 'infections_cured'), 1);
  });
});

test('the scholar whose study finishes a research counts it', () => {
  const s = colony('deeds-lore');
  const t = all('tech').find((x) => !hasTech(s, x.id) && canResearch(s, x.id));
  assert.ok(t, 'a tech to research');
  s.colony.research = { cur: t.id, pts: 0 };   // as the research command sets it
  const col = s.col[0];
  for (let k = 0; k < 2000 && s.colony.research.cur; k++) studyYield(s, col, null, 5);
  assert.equal(s.colony.research.cur, null, 'the research finished');
  assert.equal(deedCount(col, 'researched'), 1);
});

// Loot and capture (doc 9.5, 9.10). Owner H. Stage 2.
//
// Loot: a reaver or delver that falls drops its gear (stats.js `gear`: club, spear, bow, crossbow,
// sword, pick) where it fell, forbidden until the raid ends (raiders.js dropGoods; endRaid frees it);
// a thief drops what it carried. Capture: a reaver brought to 0 hp is downed COMBAT.captureDownPct of
// the time instead of killed (raiders.downFoe): it lies where it fell, out of its raid. When the raid
// ends each captive becomes a letter with a backstory card (a deserter, a conscript, or 15% of the
// time a spy) and three answers:
//   Recruit  they join the hold (F's generateColonist, at the Hearth); a spy joins too, but the letter
//            said what they are (a spy steals and slips away in Stage 3)
//   Ransom   coins from the Ashfang (30-80) at the Hearth
//   Release  goodwill with the Hearthwatch +3 (K's factions)
// The default (no answer in 24 h) is Release. The downed foe leaves the map when the letter goes out.

import { nextU32 } from '../core/rand.js';
import { W } from '../core/grid.js';
import { generateColonist, spawnColonist } from '../people/colonists.js';
import { addGoodwill } from '../colony/factions.js';
import { spawn as spawnItem } from '../work/items.js';
import { sendLetter, textOf, onChoice } from './letters.js';
import { def } from './defs.js';

export const STORIES = Object.freeze(['deserter', 'conscript', 'spy']);
const foeById = (s, id) => s.foes.find((f) => f.id === id) || null;
const hearthSpot = (s) => { const hb = s.colony.hearth.id !== null ? s.bld[s.colony.hearth.id] : null; return hb ? [hb.x + 1, hb.y + 3] : [W >> 1, W >> 1]; };

/** Turn a raid's downed captives into letters and take them off the map. Returns the letters. */
export function captivesOf(s, raid, live) {
  const out = [];
  for (const id of (live && live.captives) || []) {
    const f = foeById(s, id);
    if (!f) continue;
    const r = nextU32(s, 'story') % 100;
    const story = r < 15 ? 'spy' : r < 55 ? 'deserter' : 'conscript';
    const name = `${(def('raider', f.kind) || { name: 'Reaver' }).name}`;
    out.push(sendLetter(s, 'choice', {
      inc: raid.inc, title: 'A captive', text: textOf('inc_captive', { name, story }),
      choices: ['Recruit', 'Ransom', 'Release'], deflt: 2, data: { k: 'captive', story, kind: f.kind, seed: nextU32(s, 'story') & 0xffff },
    }));
    const i = s.foes.indexOf(f);
    if (i >= 0) s.foes.splice(i, 1);
  }
  return out;
}

onChoice('captive', (s, l, choice) => {
  const [x, y] = hearthSpot(s);
  if (choice === 0) {
    const col = generateColonist(s, {});
    spawnColonist(s, col, x, y);
    if (l.data.story === 'spy') { const t = s.st.spies || (s.st.spies = []); t.push(col.id); }
  } else if (choice === 1) {
    const n = 30 + (nextU32(s, 'story') % 51);
    if (def('item', 'coins')) spawnItem(s, 'coins', null, 0, n, x, y);
  } else addGoodwill(s, 'hearthwatch', 3);
});

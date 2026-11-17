// The Chronicle (doc 9.9, 13.2): the hold's history. Owner K. Provisional API.
//
// s.chron (C2) = [[tick, kind, templateId, args]], capped at CHRON_CAP (600). When full, the
// oldest plain entry folds into its year's summary [tick, 'year', 'chron_year', { year, n }],
// which stays at the front. Templates live in js/data/text/chronicle.js; args are plain JSON.
// installChronicle() writes death lines through BUS.kill (F's kill() and H's killFoe run it).

import { yearOf } from '../core/time.js';
import { BUS } from '../core/bus.js';

export const CHRON_CAP = 600;

export function addChron(s, kind, templateId, args = {}) {
  s.chron.push([s.tick, kind, templateId, args]);
  while (s.chron.length > CHRON_CAP) fold(s);
}
function fold(s) {
  const c = s.chron;
  let k = 0;
  while (k < c.length && c[k][1] === 'year') k++;          // summaries sit at the front, by year
  if (k >= c.length) { c.shift(); return; }
  const old = c.splice(k, 1)[0];
  const y = yearOf(old[0]);
  let j = 0;
  while (j < k && c[j][3].year < y) j++;
  if (j < k && c[j][3].year === y) { c[j][3].n++; return; }
  c.splice(j, 0, [old[0], 'year', 'chron_year', { year: y, n: 1 }]); // same length: the caller folds again
}
/** Entries of a kind, oldest first. */
export const entriesOf = (s, kind) => s.chron.filter((e) => e[1] === kind);

const onKill = (s, victim, killer) => {
  if (!victim || !('sk' in victim)) return;
  addChron(s, 'death', 'chron_death', { id: victim.id, name: victim.name, killer: killer && killer.id !== undefined ? killer.id : null });
};
export function installChronicle() { if (!BUS.kill.includes(onKill)) BUS.kill.push(onKill); }

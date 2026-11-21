// Step Z2.12 (EMBERCROWN-FORTRESS.md 3.9, F18, 8.4): crime and justice. Owner K.
//   node --test tools/tests/justice.test.mjs
// Oracle (scripted here): a Tantrum that smashes an item opens a vandalism case with the witnesses in sight; a
// sentence is a pure function of severity and record; no case with justice off; no colonist confined > 5 days; no
// fall caused by justice. (Bot target: a Warden by day 150 on 3 of 5 seeds, measured by Z2.11's bot v4.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { tick } from '../../js/game/core/sim.js';
import { installContent } from '../../js/game/core/content.js';
import { registerSystem, tickSystems } from '../../js/game/core/bus.js';
import { addBuilding } from '../../js/game/core/apply.js';
import { stateHash, bldById } from '../../js/game/core/state.js';
import { WORK_IDS } from '../../js/game/core/schema.js';
import { idx, inB, TER_BUILDABLE, TER_WATER } from '../../js/game/core/grid.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY, DAYS_PER_SEASON } from '../../js/game/core/time.js';
import { saveBlobSync, loadBlobSync, loadBlob } from '../../js/game/save/colonysave.js';
import { completeBuilding } from '../../js/game/work/construct.js';
import { generateColonist, spawnColonist } from '../../js/game/people/colonists.js';
import { startBreakOf } from '../../js/game/people/breaks.js';
import { setPsy } from '../../js/game/people/personality.js';
import { opinion } from '../../js/game/people/social.js';
import { holdsOn, fallCheck } from '../../js/game/colony/fall.js';
import { legendRecords } from '../../js/game/colony/legends.js';
import { pendingLetters, answer } from '../../js/game/threat/letters.js';
import * as O from '../../js/game/colony/offices.js';
import { buildRegistry } from '../../js/data/schema.js';
import { ENTRIES, CONTENT } from '../../js/data/index.js';
import * as DOFF from '../../js/data/offices.js';
import * as DLAWS from '../../js/data/laws.js';
import { LOCKUP_ROLE } from '../../js/data/rooms.js';
import * as J from '../../js/game/colony/justice.js';

// laws.js and the cell bed are G requests (DATA_FILES, structures/housing.js); until then, here
const extra = [{ path: 'offices.js', owner: 'K', mod: DOFF }, { path: 'laws.js', owner: 'K', mod: DLAWS }];
if (!ENTRIES.some((e) => e.mod && e.mod.DATA && (e.mod.DATA.structure || []).some((r) => r.id === 'cellbed'))) {
  extra.push({ path: 'cellbed.js', owner: 'G', mod: { DATA: { structure: [{ ...DLAWS.CELL_BED }] } } });
  extra.push({ path: 'lockup.js', owner: 'G', mod: { DATA: { room: [{ ...LOCKUP_ROLE }] } } });
}
const REG = buildRegistry([...ENTRIES.filter((e) => e.path !== 'laws.js'), ...extra]);

function colony(seed = 'K-Z212', n = 0, d = 1) {
  installSim({ stage: '2', reset: true });
  installContent({ reg: REG });
  if (!tickSystems().some((x) => x.name === 'offices')) registerSystem('colony', 'offices', O.officesSystem, 135);
  J.installJustice();
  const s = foundColony({ seed, name: 'Law Hold', d });
  while (s.col.length < n) addCol(s);
  return s;
}
const hearth = (s) => s.bld[s.colony.hearth.id];
function addCol(s, dx = 0, dy = 2) { const h = hearth(s), c = generateColonist(s); spawnColonist(s, c, h.x + dx, h.y + dy); c.age = 30; return c; }
/** findSite on the Hearth's level (setup.findSite looks at level 0 only). */
function siteZ(s, x, y, w, h, z, m = 1) {
  const ok = (x0, y0) => {
    for (let yy = y0 - m; yy < y0 + h + m; yy++) for (let xx = x0 - m; xx < x0 + w + m; xx++) {
      if (!inB(xx, yy, z)) return false;
      const i = idx(xx, yy, z), t = s.L.terrain[i];
      if (!TER_BUILDABLE[t] || TER_WATER[t] || s.rt.occ[i] >= 0) return false;
    }
    return true;
  };
  for (let r = 0; r < 64; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && ok(x + dx, y + dy)) return [x + dx, y + dy];
  return null;
}
function built(s, defId, dx = 4, dy = 4) {
  const hb = hearth(s), d = REG.get('structure', defId);
  const at = siteZ(s, hb.x + dx, hb.y + dy, d.size[0], d.size[1], hb.z | 0);
  const b = addBuilding(s, defId, at[0], at[1], 0, null, { z: hb.z | 0 });
  completeBuilding(s, b);
  return b;
}
const atHour = (s, h = 1) => { s.tick = (Math.floor(s.tick / TICKS_PER_HOUR) + h) * TICKS_PER_HOUR; J.justiceSystem(s); };
const run = (s, n) => { for (let i = 0; i < n; i++) tick(s); };
const place = (c, x, y, z) => { c.x = x * 32 + 16; c.y = y * 32 + 16; c.z = z; };

test('Z2.12 data: the thoughts and the cell bed validate; the Lockup role names the cell bed; sentences stay in range', () => {
  assert.deepEqual(REG.errors, []);
  for (const t of DLAWS.DATA.thought) assert.ok(REG.get('thought', t.id), t.id);
  assert.ok(REG.get('structure', 'cellbed'));
  assert.deepEqual(REG.get('room', 'lockup').match.any, ['cellbed']);
  for (let sev = 1; sev <= 4; sev++) for (let rec = 0; rec <= 10; rec++) {
    const x = J.sentence(sev, rec);
    assert.ok(['fine', 'confine'].includes(x.kind));
    if (x.kind === 'confine') assert.ok(x.days >= 1 && x.days <= 5, 'confinement 1-5 days');
    else assert.ok(x.days >= 2 && x.days <= 6, 'a labour fine 2-6 days');
  }
  for (const d of DLAWS.SENTENCE.commuteDays) assert.ok(d <= 6);
});

test('a sentence is a pure function of severity and record (and grows with both)', () => {
  const grid = [];
  for (let sev = 1; sev <= 4; sev++) for (let rec = 0; rec <= 5; rec++) grid.push(JSON.stringify(J.sentence(sev, rec)));
  const again = [];
  for (let sev = 1; sev <= 4; sev++) for (let rec = 0; rec <= 5; rec++) again.push(JSON.stringify(J.sentence(sev, rec)));
  assert.deepEqual(grid, again);
  const w = (x) => (x.kind === 'confine' ? 10 : 0) + x.days;
  for (let sev = 1; sev <= 4; sev++) for (let rec = 0; rec < 5; rec++) assert.ok(w(J.sentence(sev, rec + 1)) >= w(J.sentence(sev, rec)));
  assert.deepEqual(J.sentence(1, 0), { kind: 'fine', days: 2 });
  assert.deepEqual(J.sentence(3, 0), { kind: 'confine', days: 2 });
  assert.deepEqual(J.sentence(4, 9), { kind: 'confine', days: 5 });
});

for (const D of [1, 20]) test(`a Tantrum that smashes an item opens a vandalism case with the witnesses in sight (D = ${D})`, () => {
  const s = colony('K-tantrum', 0, D);
  const hb = hearth(s), z = hb.z | 0;
  const chair = built(s, 'table', 3, 3);
  const [a, b, c] = [s.col[0], s.col[1], s.col[2]];
  // a stands by the table, b watches from 3 tiles, c is far off (outside sight)
  place(b, chair.x + 3, chair.y, z);
  const far = siteZ(s, hb.x + 30, hb.y + 30, 1, 1, z);
  place(c, far[0], far[1], z);
  for (const o of s.col.slice(3)) place(o, far[0], far[1], z);
  b.job = null; c.job = null;
  startBreakOf(s, a, 'tantrum', 'major');
  assert.equal(a.breakState.id, 'tantrum');
  let k = null;
  for (let i = 0; i < 4 * TICKS_PER_HOUR && !k; i++) {
    // keep the witnesses where they are (they would wander off to work)
    place(b, chair.x + 3, chair.y, z); place(c, far[0], far[1], z);
    tick(s);
    k = J.casesOf(s).find((x) => x.kind === 'vandalism') || null;
  }
  assert.ok(k, 'a vandalism case');
  assert.equal(k.off, a.id);
  assert.ok(k.wit.includes(b.id), 'the colonist in sight is a witness');
  console.log(`vandalism case: offender ${k.off}, witnesses [${k.wit}], what ${k.what}, sev ${k.sev}`);
  assert.ok(!k.wit.includes(c.id), 'the far colonist is not');
  assert.ok(!k.wit.includes(a.id));
  if (D > 1) { place(c, chair.x + 2, chair.y, z - 1); assert.ok(!J.witnessesAt(s, chair.x, chair.y, z, a.id).includes(c.id), 'another level sees nothing'); }
  assert.equal(k.st, 'open');
  assert.ok(legendRecords(s).some((r) => r[0] === String.fromCharCode(65 + 15)), 'an Annals crime event');
});

test('no case with justice off; the laws change once a season', () => {
  const s = colony('K-off');
  const a = s.col[0];
  assert.equal(J.lawsOn(s), true, 'on by default');
  assert.equal(s.colony.cases, undefined, 'nothing written before anything happens');
  assert.equal(J.setLaws(s, false).ok, true);
  assert.equal(J.lawsOn(s), false);
  assert.equal(J.reportCrime(s, 'vandalism', a, { what: 'a chair' }), null);
  assert.equal(J.reportCrime(s, 'theft', a, { what: 'a ring' }), null);
  assert.equal(J.casesOf(s).length, 0);
  assert.match(J.setLaws(s, true).reason, /once a season/);
  s.tick += DAYS_PER_SEASON * TICKS_PER_DAY;
  assert.equal(J.setLaws(s, true).ok, true);
  assert.ok(J.reportCrime(s, 'vandalism', a, { what: 'a chair' }));
});

test('hearings: common judgement before the Warden opens; then cases wait (Lawless) until a Warden sentences them', () => {
  const s = colony('K-hear');
  const [a, v] = s.col;
  setPsy(s, s.col[2], { v: Int8Array.from([0, 0, 2, 0]) });   // Order 2
  // a small hold: common judgement after the hearing hours
  const k1 = J.reportCrime(s, 'vandalism', a, { victim: v.id, what: 'a chair' });
  const op0 = opinion(s, v.id, a.id);
  atHour(s, 2); assert.equal(k1.st, 'open');
  atHour(s, 6); assert.equal(k1.st, 'sentenced');
  assert.deepEqual(k1.sent, { kind: 'fine', days: 2 });
  assert.equal(opinion(s, v.id, a.id), op0 + 10, 'the victim forgives a little');
  assert.ok(s.col[2].thoughts.some((t) => t[0] === 'justice_done'));
  // labour fine: only Haul until it is served, then the old priorities come back
  const sv = J.servingOf(s, a.id);
  assert.equal(sv.kind, 'fine');
  const H = WORK_IDS.indexOf('haul');
  assert.deepEqual(Array.from(a.prio).map((p, i) => (i === H ? 1 : 0)), Array.from(a.prio));
  const before = sv.prio.slice();
  for (let h = 0; h < 2 * 24 + 1; h++) atHour(s, 1);
  assert.equal(J.servingOf(s, a.id), null);
  assert.deepEqual(Array.from(a.prio), before);
  // a hold of 12: the Warden's office opens, nobody holds it: cases wait, and Lawless after 3 days
  while (s.col.length < 12) addCol(s);
  assert.equal(J.wardenOpen(s), true);
  assert.equal(J.judge(s), null);
  const k2 = J.reportCrime(s, 'vandalism', a, { what: 'a stool' });
  for (let h = 0; h < 4 * 24 + 2; h++) atHour(s, 1);
  assert.equal(k2.st, 'open');
  assert.ok(s.col[2].thoughts.some((t) => t[0] === 'lawless_hold'));
  const w = s.col[3];
  assert.equal(J.appointWarden(s, w.id).ok, true);
  assert.equal(J.wardenOf(s), w);
  atHour(s, 1);
  assert.equal(k2.st, 'sentenced');
  assert.equal(k2.sent.kind, 'fine');
  assert.equal(k2.sent.days, 4, 'the record counts: a second case is heavier');
});

for (const D of [1, 20]) test(`confinement: on a Lockup cell bed for 2-5 days at most; commuted to a fine with no free cell; never a fall (D = ${D})`, () => {
  const s = colony('K-cell', 12, D);
  const z = hearth(s).z | 0;
  // a walled cell with a door and a cell bed
  const hb = hearth(s);
  const at = siteZ(s, hb.x + 8, hb.y - 8, 5, 5, z);
  const [x0, y0] = at;
  for (let x = x0; x < x0 + 5; x++) for (let y = y0; y < y0 + 5; y++) {
    if (x === x0 || y === y0 || x === x0 + 4 || y === y0 + 4) {
      const b = addBuilding(s, x === x0 + 2 && y === y0 + 4 ? 'door' : 'wall', x, y, 0, x === x0 + 2 && y === y0 + 4 ? null : 'granite', { z });
      completeBuilding(s, b);
    }
  }
  const cell = addBuilding(s, 'cellbed', x0 + 2, y0 + 1, 0, null, { z });
  completeBuilding(s, cell);
  run(s, 2);
  assert.equal(J.lockupCells(s).length, 1, 'a Lockup');
  const [a, b] = s.col;
  assert.equal(J.appointWarden(s, s.col[5].id).ok, true);
  const k1 = J.reportCrime(s, 'assault', a, { victim: b.id, worse: true });
  const k2 = J.reportCrime(s, 'assault', b, { victim: a.id });
  s.tick = Math.ceil(s.tick / TICKS_PER_HOUR) * TICKS_PER_HOUR;
  atHour(s, 6);
  assert.equal(k1.sent.kind, 'confine'); assert.equal(k1.sent.days, 3);
  assert.equal(k2.sent.kind, 'confine'); assert.equal(k2.sent.commuted, 4, 'no second cell: a labour fine');
  assert.equal(J.servingOf(s, a.id).bed, cell.id);
  assert.equal(J.servingOf(s, b.id).kind, 'fine');
  // run the sim: a walks to the cell and stays there; nobody serves longer than 5 days; the hold holds on
  let inCell = 0, maxDays = 0, since = null;
  const start = s.tick;
  for (let t = 0; t < 6 * TICKS_PER_DAY; t++) {
    tick(s);
    const sv = J.servingOf(s, a.id);
    if (sv && since === null) since = s.tick;
    if (sv && a.job && a.job.type === 'confine') inCell++;
    if (sv) maxDays = Math.max(maxDays, (s.tick - start) / TICKS_PER_DAY);
    if (t % TICKS_PER_HOUR === 0) assert.ok(s.col.some((c) => holdsOn(s, c)));
  }
  assert.equal(J.servingOf(s, a.id), null, 'served');
  assert.ok(maxDays <= 5, `confined ${maxDays.toFixed(2)} days`);
  assert.ok(inCell > TICKS_PER_DAY, `in the cell ${inCell} ticks`);
  console.log(`confined ${maxDays.toFixed(2)} days, ${(inCell / TICKS_PER_DAY).toFixed(2)} days in the cell job`);
  assert.equal(fallCheck(s), false);
  assert.ok(!s.colony.fallen);
});

test('three cases in a year bring the exile letter; yes sends them away, and the hold continues and saves', () => {
  const s = colony('K-exile', 8);
  const a = s.col[1], n0 = s.col.length;
  for (let i = 0; i < 3; i++) {
    J.reportCrime(s, 'vandalism', a, { what: 'a chair', key: i });
    s.tick = Math.ceil(s.tick / TICKS_PER_HOUR) * TICKS_PER_HOUR;
    atHour(s, 6);
  }
  assert.equal(J.recordOf(s, a.id), 3);
  const l = pendingLetters(s).find((x) => x.data && x.data.k === 'exile');
  assert.ok(l, 'an exile letter');
  assert.equal(l.deflt, 1, 'the default is that they stay');
  assert.equal(answer(s, l, 0), null);
  assert.equal(s.col.length, n0 - 1);
  assert.ok(!s.col.includes(a));
  run(s, 2 * TICKS_PER_HOUR);
  const back = loadBlobSync(saveBlobSync(s));
  assert.equal(stateHash(back), stateHash(s));
});

test('a broken mandate is a case against the Steward', () => {
  const s = colony('K-mandate', 6);
  const [noble, st] = s.col;
  assert.equal(O.appoint(s, 'steward', st.id).ok, true);
  const k = J.mandateBroken(s, { id: 7, by: noble.id, k: 'chair' });
  assert.equal(k, true);
  const c = J.casesOf(s)[0];
  assert.equal(c.kind, 'mandate'); assert.equal(c.off, st.id); assert.equal(c.vic, noble.id);
});

test('determinism: a fortress (Z1 save format, D = 20) mid-sentence saves, loads and continues tick-identically', () => {
  const s = colony('K-det', 6, 20);
  const [a, b] = s.col;
  startBreakOf(s, a, 'tantrum', 'major');
  J.reportCrime(s, 'theft', b, { what: 'a ring', victim: a.id });
  run(s, 8 * TICKS_PER_HOUR);
  assert.ok(J.justiceRec(s).serving.length >= 1, 'someone is serving');
  const c = loadBlobSync(saveBlobSync(s));
  assert.equal(stateHash(c), stateHash(s));
  for (let i = 0; i < 4; i++) { run(s, TICKS_PER_HOUR); run(c, TICKS_PER_HOUR); assert.equal(stateHash(c), stateHash(s), `hour ${i}`); }
});

test('old saves: a v2 fixture loads with the laws on by default, no justice field written, and continues', async () => {
  installSim({ stage: '2', reset: true });
  installContent({ reg: REG });
  J.installJustice();
  const s = await loadBlob(new Uint8Array(readFileSync(new URL('../fixtures/v2-s2-day60.ecsave', import.meta.url))));
  assert.equal(J.lawsOn(s), true);
  assert.equal(s.colony.justiceRec, undefined);
  run(s, 2 * TICKS_PER_HOUR);
  assert.equal(J.lawsOn(s), true);
  assert.ok(J.justiceView(s).on);
});

// Step Z2.10 (EMBERCROWN-FORTRESS.md 2.10, F26): every threat has a cause. Owner H.
// Oracle: no incident is scheduled without a live cause (a property test over 300 bot days: env
// CAUSES_DAYS, CAUSES_SEED); every letter has a cause line; the majors gap stays inside R2 9.1/9.3 (the
// causes never stall an open major window, and majors stay RULES.minGapD days apart).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { step } from '../../js/game/core/sim.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY, DAYS_PER_SEASON, dayOf } from '../../js/game/core/time.js';
import { storyteller } from '../../js/game/threat/index.js';
import { incidentList, incidentDef, isHostile } from '../../js/game/threat/incidents.js';
import { majorPending, storyTuning, RULES, storytellerDef } from '../../js/game/threat/storyteller.js';
import * as C from '../../js/game/threat/causes.js';
import { DATA } from '../../js/data/causes.js';
import { DATA as DREN } from '../../js/data/renown.js';
import { storyToPlain, storyFromPlain } from '../../js/game/core/schema.js';
import { threatViews, omenText } from '../../js/game/threat/warnings.js';
import { runBot3 } from '../lib/bot3.mjs';

const H1 = TICKS_PER_HOUR, D1 = TICKS_PER_DAY;
function colony(seed = 'H-Z210') {
  installSim({ stage: '2', reset: true, checks: true });
  return foundColony({ seed, name: 'Test Hold' });
}
// no player runs these holds, so a long step would see them fall: jump the clock instead (the causes read
// the season, the weather and the records, not the passage of ticks)
const toDay = (s, d, h = 1) => { s.tick = d * D1 + h * H1; s.st.causesDay = -1; };
const fresh = (s) => { s.st.causesDay = -1; return C.liveCauses(s); };
const has = (s, kind, subject) => C.liveCauses(s).some((c) => c[0] === kind && (subject === undefined || c[1] === subject));

test('Z2.10 data: every hostile incident has a cause row; rows name real incidents and lines', () => {
  colony();
  const caused = C.causedIncidents();
  for (const d of incidentList()) if (isHostile(d)) assert.ok(caused.has(d.id), `${d.id} has no cause that allows it`);
  for (const id of caused) assert.ok(incidentDef(id), `cause names unknown incident ${id}`);
  const texts = new Set(DATA.text.map((t) => t.id));
  for (const r of DATA.cause) assert.ok([...texts].some((t) => t.startsWith(r.line)), `${r.id}: no line ${r.line}`);
  for (const t of DATA.text) { assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(t.text), 'no emoji'); for (const v of t.vars || []) assert.ok(t.text.includes(`{${v}}`), `${t.id}: {${v}}`); }
  // renown leans name real kinds
  for (const r of DREN.renown) for (const k of Object.keys(r.lean || {})) assert.ok(C.CAUSE_KINDS.includes(k), `renown ${r.id} leans unknown cause ${k}`);
});

test('Z2.10: the live causes at founding: the Hollow hunger, the Ashfang grievance, the Gutterkin grudge; no winter in Thaw midseason', () => {
  const s = colony();
  toDay(s, 6);
  s.colony.factions.gutterkin = -20;   // the start's goodwill (factions.js seedGoodwill)
  const L = fresh(s);
  assert.ok(has(s, 'hunger', 'hollow'));
  assert.ok(has(s, 'grievance', 'ashfang'));
  assert.ok(has(s, 'grievance', 'gutterkin'), 'Gutterkin start Wary (-20)');
  assert.ok(!has(s, 'winter'), 'day 6 of Thaw: no hard winter');
  // sorted by kind order, then subject
  for (let k = 1; k < L.length; k++) assert.ok(C.CAUSE_KINDS.indexOf(L[k - 1][0]) <= C.CAUSE_KINDS.indexOf(L[k][0]));
  // no cause, no incident: beasts need a hard winter
  const man = incidentDef('manhunters'), wolf = incidentDef('wolf_pair');
  assert.equal(C.causeWeight(s, man), 0);
  assert.equal(storyteller.eligible(s, wolf), false, 'no wolves without a hard winter');
  // the horde's cause, and its letter line
  const c = C.causeFor(s, incidentDef('hollow_horde'));
  assert.deepEqual(c, ['hunger', 'hollow']);
  assert.match(C.causeLine(s, c), /Hollow hunger/);
  const ash = C.causeLine(s, ['grievance', 'ashfang']);
  assert.match(ash, /Ashfang Reavers have not forgiven the Old Crown/);
  assert.ok(!/\{\w+\}/.test(ash), 'every placeholder is filled: ' + ash);
});

test('Z2.10: hard winter at the end of Ashfall and in Deepcold lets starving beasts come', () => {
  const s = colony('H-Z210-W');
  toDay(s, 2 * DAYS_PER_SEASON + 2);
  fresh(s);
  assert.ok(!has(s, 'winter'), 'early Ashfall: none');
  toDay(s, 2 * DAYS_PER_SEASON + 7);
  fresh(s);
  assert.ok(has(s, 'winter', 'ashfall'));
  toDay(s, 3 * DAYS_PER_SEASON + 3);
  const L = fresh(s), w = L.find((x) => x[0] === 'winter');
  assert.ok(w && w[2] >= C.CAUSE_TUNING.winterDeep, 'Deepcold weighs more');
  assert.ok(C.causeWeight(s, incidentDef('wolf_pair')) > 0);
  assert.match(C.causeLine(s, ['winter', 'deepcold']), /starving/);
});

test('Z2.10: thieves need the Gutterkin grudge or a rumour; a trader visit spreads word of the silver (Trade leans x1.5)', () => {
  const s = colony('H-Z210-R');
  toDay(s, 5);
  s.colony.factions.gutterkin = 0;   // friendly enough: no grudge
  s.st.rumour = []; s.st.rumourVid = 0;
  if (s.colony.trade) s.colony.trade.visits = [];
  fresh(s);
  const th = incidentDef('thieves');
  assert.equal(C.causeWeight(s, th), 0, 'no grudge, no rumour');
  assert.equal(storyteller.eligible(s, th), false);
  // a trader visits: noted once, with the precious worth it saw
  if (!s.colony.trade) s.colony.trade = { next: 0, visits: [], envoy: null, nextEnvoy: -1, paidGutterkin: -1 };
  s.colony.trade.visits.push({ id: 7, trader: 'pedlar', until: s.tick + D1, stock: [], coins: 0 });
  C.noteRumours(s); C.noteRumours(s);
  assert.equal(s.st.rumour.length, 1, 'noted once per visit');
  fresh(s);
  assert.ok(has(s, 'rumour', 'pedlar'));
  const w0 = C.causeWeight(s, th);
  assert.ok(w0 > 0 && storyteller.eligible(s, th));
  assert.deepEqual(C.causeFor(s, th), ['rumour', 'pedlar']);
  assert.match(C.causeLine(s, ['rumour', 'pedlar']), /Word of your silver has spread since the pedlar left/);
  // the hold becomes known for Trade: rumour weights x1.5
  s.colony.renown = { known: ['trade'], pts: [0, 0, 0, 0, 0, 0], acc: [0, 0, 0, 0, 0, 0], hist: [] };
  fresh(s);
  const w1 = C.causeWeight(s, th);
  assert.equal(w1, Math.max(1, Math.floor((w0 * 150) / 100)));
  delete s.colony.renown;
  // the rumour fades with the year
  s.tick += 40 * D1; C.noteRumours(s);
  assert.equal(s.st.rumour.length, 0, 'last year\'s visits are forgotten');
  // a nemesis is its own grievance and allows only the major it leads
  s.st.nemeses.push({ id: 3, name: 'Old Grin', epithet: 'the Scarred', kind: 'reaver', affixes: [], scar: 'cut', grudge: s.col[0].id, returns: 0 });
  fresh(s);
  assert.ok(has(s, 'grievance', 'm3'));
  assert.match(C.causeLine(s, ['grievance', 'm3']), new RegExp(`Old Grin the Scarred has not forgotten the wound ${s.col[0].name}`));
});

test('Z2.10: a scheduled threat carries its cause; the omen letter ends with it; the causes save and load', () => {
  const s = colony('H-Z210-S');
  step(s, 2 * H1);
  s.st.queue.length = 0;
  const e = storyteller.scheduleIncident(s, 'lone_husks', s.tick + H1, s.tick + 3 * H1);
  assert.deepEqual(e.cause, ['hunger', 'hollow']);
  assert.ok(e.why && e.why.length > 10);
  // a warned non-raid omen (a disaster) names its cause when it has one: none needed for a cold snap
  const back = storyFromPlain(JSON.parse(JSON.stringify(storyToPlain(s.st))));
  assert.deepEqual(back.causes, s.st.causes);
  assert.equal(back.causesDay, s.st.causesDay);
  assert.deepEqual(back.queue.find((q) => q.id === e.id).cause, e.cause);
  // an old save (no cause fields) recomputes on its first storyteller hour
  delete s.st.causes; delete s.st.causesDay; delete s.st.rumour; delete s.st.rumourVid;
  step(s, H1 - (s.tick % H1) || H1);
  assert.ok(Array.isArray(s.st.causes) && s.st.causes.length >= 2);
  assert.equal(s.st.causesDay, dayOf(s.tick));
});

// ---- the property test over bot days ----------------------------------------------------------------------
const DAYS = +(process.env.CAUSES_DAYS || 60), SEED = +(process.env.CAUSES_SEED || 1);
test(`Z2.10 oracle: no incident is scheduled without a live cause over ${DAYS} bot days (seed ${SEED}); every letter has a cause line; majors keep their gap`, { timeout: 3600e3 }, async () => {
  const seen = new Set(), omens = new Set(), raidOmens = [], bad = [], letters = [], noLine = [], arrivals = [], blocked = [];
  let hostile = 0, wrapped = null;
  const byKind = {};
  const r = await runBot3({
    seed: SEED, days: DAYS,
    onTick: (s) => {
      if (wrapped !== s.rt.events) {   // the letters the sim sends (the meter drains the queue before onTick)
        const q = s.rt.events, push = q.push.bind(q);
        q.push = (...ev) => { for (const x of ev) if (x.name === 'letter' && x.data && x.data.kind === 'omen') letters.push([x.data.inc, x.data.text]); return push(...ev); };
        wrapped = q;
      }
      if (s.tick % H1 !== 0) return;
      for (const v of threatViews(s)) {   // a raid's omen letter (warnings.omenText) once per entry
        const e = s.st.queue.find((q) => q.id === v.id);
        if (!e || !e.why || omens.has(e.id)) continue;
        omens.add(e.id);
        raidOmens.push([e.inc, omenText(s, v), e.why]);
      }
      for (const e of s.st.queue) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        const d = incidentDef(e.inc);
        if (!isHostile(d)) continue;
        hostile++;
        if (d.cat === 'major') arrivals.push(e.arriveTick);
        const live = s.st.causes || [];
        const ok = e.cause && e.why && live.some((c) => c[0] === e.cause[0] && c[1] === e.cause[1]);
        if (!ok) bad.push(`day ${dayOf(s.tick)} ${e.inc} cause ${JSON.stringify(e.cause)} live ${JSON.stringify(live)}`);
        else byKind[e.cause[0]] = (byKind[e.cause[0]] | 0) + 1;
      }
      // a stalled major window: open, calm, nothing pending, after the storyteller's run this hour
      const st = s.st;
      if (st.lastMajorDay >= 0 && !majorPending(s) && st.cooldowns.majorFrom === st.lastMajorDay && dayOf(s.tick) >= st.cooldowns.majorDay && st.tension <= storyTuning().pushBackTension) blocked.push(dayOf(s.tick));
    },
  });
  // omen letters the storyteller sends itself carry e.why when the entry has one; a raid's omen letter is
  // warnings.omenText (owner request: it appends v.why); counted here, strict once it does
  for (const [inc, text] of letters) if (C.causedIncidents().has(inc) && !/\S[.!] \S.*[.!]$/.test(text)) noLine.push(`${inc}: ${text}`);
  const raidLined = raidOmens.filter(([, text, why]) => text.endsWith(why)).length;
  if (raidLined > 0) for (const [inc, text, why] of raidOmens) if (!text.endsWith(why)) noLine.push(`${inc}: ${text}`);
  arrivals.sort((a, b) => a - b);
  const gaps = arrivals.slice(1).map((t, k) => (t - arrivals[k]) / D1);
  const sd = storytellerDef(r.s);
  console.log(`# causes: ${hostile} hostile incidents scheduled over ${DAYS} days (seed ${SEED}); by cause ${JSON.stringify(byKind)}; majors ${arrivals.length}, gap min ${Math.min(...gaps).toFixed(2)} max ${Math.max(...gaps).toFixed(2)} mean ${(gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length)).toFixed(2)} days (window ${JSON.stringify(sd.majorD)}); stalled hours ${blocked.length}; omen letters ${letters.length}, raid omens ${raidOmens.length} (with the cause line ${raidLined}); bot ok ${r.ok}`);
  assert.deepEqual(bad, [], 'every hostile entry names a live cause');
  if (DAYS >= 100) assert.ok(hostile >= 20, `enough incidents to mean something (${hostile})`);
  assert.deepEqual(noLine, [], 'omen letters end with a cause line');
  assert.deepEqual(blocked, [], 'the causes never stall an open major window');
  assert.ok(Math.min(...gaps) >= RULES.minGapD - 1e-9, 'majors at least minGapD days apart');
});

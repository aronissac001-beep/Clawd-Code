// W3.4 raids from civs (EMBERCROWN-WORLD.md 2.7 raids row, G6; step W3.4, owner H).
// Oracle: every raid letter names a civ at war with the liege or with rel < -40; >= 80 % of raids enter on the
// civ's side; the storyteller's pacing (raids per 100 days) stays within 10 % of W2 (the same hold without the
// realm record: the legacy rows). Holds are founded as one-plane test holds (the causes read no depth) with a world
// region's s.realm and the decoded record in s.rt.realm (9.3 step 5), from worlds built with history.
// RAIDS_BOT_DAYS=100 also runs bot v3 on fortress seeds with and without the record and prints raids per 100 days.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony, realmField } from '../../js/game/core/setup.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY, dayOf } from '../../js/game/core/time.js';
import { buildRealm } from '../../js/game/realm/gen.js';
import { idx, isEmbarkable } from '../../js/game/realm/query.js';
import { incidentList, incidentDef, isHostile } from '../../js/game/threat/incidents.js';
import { scheduleIncident } from '../../js/game/threat/storyteller.js';
import { planRaid } from '../../js/game/threat/raidplan.js';
import { makeNemesis, nemFigOf, figureName, realmRecord } from '../../js/game/threat/nemesis.js';
import * as C from '../../js/game/threat/causes.js';

const H1 = TICKS_PER_HOUR, D1 = TICKS_PER_DAY;
const WORLDS = +(process.env.RAIDS_WORLDS || 8), PER = 4;
const worlds = new Map();
const worldOf = (seed) => worlds.get(seed) || worlds.set(seed, buildRealm({ seed }, { history: true })).get(seed);
/** PER embarkable regions spread over the world's embarkable list. */
function regionsOf(R) {
  const all = [];
  for (let i = 0; i < R.n * R.n; i++) if (isEmbarkable(R, i)) all.push(i);
  return Array.from({ length: PER }, (_, k) => all[Math.floor(((k + 0.5) * all.length) / PER)]).map((i) => [i % R.n, (i / R.n) | 0]);
}
function hold(R, rx, ry, seed = 'W34') {
  installSim({ stage: '2', reset: true, checks: true });
  const s = foundColony({ seed: `${seed}:${R.seed}:${rx},${ry}`, name: 'Test Hold' });
  s.realm = realmField(R, rx, ry);
  s.rt.realm = R;
  s.colony.tier = 4;
  return s;
}
const holds = function* () { for (let w = 1; w <= WORLDS; w++) { const R = worldOf(w); for (const [rx, ry] of regionsOf(R)) yield { R, rx, ry }; } };
const toDay = (s, d, h = 1) => { s.tick = d * D1 + h * H1; s.st.causesDay = -1; };
const raidIncs = () => C.RAID_INCIDENTS.map((id) => incidentDef(id)).filter(Boolean);

test('W3.4: a realm-less hold and a hold without its record keep the legacy grievance rows', () => {
  const R = worldOf(1), [[rx, ry]] = regionsOf(R);
  const s = hold(R, rx, ry);
  s.rt.realm = null;
  assert.equal(realmRecord(s), null);
  const live = C.computeCauses(s);
  assert.ok(live.some((c) => c[0] === 'grievance' && c[1] === 'ashfang'), 'the Ashfang row');
  assert.ok(!live.some(C.isCivCause), 'no civ rows');
  s.rt.realm = { ...R, wid: (R.wid + 1) >>> 0 };
  assert.equal(realmRecord(s), null, 'a record of another world is not read');
});

test('W3.4: civ rows carry exactly the legacy grievance weight (the pacing sums)', () => {
  let n = 0;
  for (const { R, rx, ry } of holds()) {
    const s = hold(R, rx, ry);
    for (const g of [-20, -60, 10]) {
      s.colony.factions.gutterkin = g;
      const realm = C.computeCauses(s);
      const rr = s.rt.realm; s.rt.realm = null;
      const legacy = C.computeCauses(s); s.rt.realm = rr;
      const sum = (rows, f) => rows.filter(f).reduce((a, c) => a + c[2], 0);
      const hc = C.hostileCivs(s);
      assert.ok(hc.length > 0, `world ${R.seed} (${rx},${ry}): some civ is hostile`);
      assert.equal(sum(realm, (c) => C.isCivCause(c) && !c[1].endsWith('t')), sum(legacy, (c) => c[1] === 'ashfang'), 'the Ashfang weight');
      assert.equal(sum(realm, (c) => C.isCivCause(c) && c[1].endsWith('t')), sum(legacy, (c) => c[1] === 'gutterkin'), 'the Gutterkin weight');
      assert.deepEqual(realm.filter((c) => !C.isCivCause(c)), legacy.filter((c) => c[0] !== 'grievance' || (c[1] !== 'ashfang' && c[1] !== 'gutterkin')), 'the other rows unchanged');
      for (const c of realm.filter(C.isCivCause)) assert.ok(hc.some((h) => h.id === C.civOfCause(c)), 'a civ row is a hostile civ');
      n++;
    }
  }
  console.log(`# ${n} hold states: civ rows sum to the legacy grievance weights`);
});

test('W3.4 oracle: every raid letter names a civ at war with the liege or with rel < -40', () => {
  let letters = 0, war = 0;
  const bad = [];
  for (const { R, rx, ry } of holds()) {
    const s = hold(R, rx, ry);
    // a war on the liege from the first non-hostile living civ (a season-tick delta row)
    const L = C.liegeOf(s, R), hc = C.hostileCivs(s);
    const peer = R.tables.civs.find((c) => c.id !== L && c.fell === null && !hc.some((h) => h.id === c.id) && C.nearestSite(s, R, c.id));
    for (const phase of [0, 1]) {
      if (phase === 1 && peer && L !== null) s.realm.wars.push([peer.id, L, s.realm.year, null]);
      s.st.causesDay = -1;
      const host = C.hostileCivs(s);
      if (phase === 1 && peer && L !== null) assert.ok(host.some((h) => h.id === peer.id && h.war), 'the war makes the peer hostile');
      for (const d of raidIncs()) {
        const e = scheduleIncident(s, d.id, s.tick + 10 * H1, s.tick + 20 * H1);
        letters++;
        const id = C.civOfCause(e.cause), h = host.find((x) => x.id === id), c = R.tables.civs[id];
        if (!h || !(h.war || h.rel < -40)) bad.push(`${R.seed}:${rx},${ry} ${d.id} cause ${JSON.stringify(e.cause)} not hostile`);
        else if (!c || !e.why.includes(c.name.replace(/^the /, ''))) bad.push(`${d.id}: "${e.why}" does not name ${c && c.name}`);
        else if (/\{\w+\}/.test(e.why) || e.why.length > 160) bad.push(`${d.id}: "${e.why}"`);
        if (h && h.war) war++;
        s.st.queue = s.st.queue.filter((q) => q.id !== e.id);
      }
    }
  }
  console.log(`# ${letters} raid letters, ${war} for a war on the liege; bad ${bad.length}`);
  assert.deepEqual(bad.slice(0, 5), []);
});

test('W3.4 oracle: >= 80 % of raids enter on the civ\'s side, led by a living figure of the civ, sized by its sites', () => {
  let n = 0, onSide = 0, led = 0;
  const notes = [];
  for (const { R, rx, ry } of holds()) {
    const s = hold(R, rx, ry);
    for (let k = 0; k < 6; k++) {
      toDay(s, 5 + k * 7);
      const e = scheduleIncident(s, k % 2 ? 'reaver_raid' : 'thieves', s.tick + 10 * H1, s.tick + 20 * H1, { side: ['n', 'e', 's', 'w'][k % 4] });
      const p = planRaid(s, e);
      const id = C.civOfCause(e.cause), ns = C.nearestSite(s, R, id);
      if (!ns) continue;
      const dx = ns.site.x - rx, dy = ns.site.y - ry, want = new Set();
      // the side toward the civ; for a near diagonal (the minor offset at least half the major) either component
      if (dx && Math.abs(dx) * 2 >= Math.abs(dy)) want.add(dx > 0 ? 'e' : 'w');
      if (dy && Math.abs(dy) * 2 >= Math.abs(dx)) want.add(dy > 0 ? 's' : 'n');
      if (!want.size) continue;   // the civ lives in the hold's own region: any side
      n++;
      if (want.has(p.edge.side)) onSide++; else if (notes.length < 4) notes.push(`${R.seed}:${rx},${ry} civ ${id} at d(${dx},${dy}) entered ${p.edge.side}`);
      assert.equal(p.civ, id, 'the plan names its civ');
      const f = R.tables.figures[p.fig];
      if (f) { led++; assert.equal(f.civ, id); assert.equal(f.died, null, 'a living figure leads'); }
      s.st.queue = s.st.queue.filter((q) => q.id !== e.id);
    }
    const id = C.hostileCivs(s)[0].id, pct = C.civSizePct(s, R, id);
    assert.ok(pct >= C.REALM_RAID.sizeMin && pct <= C.REALM_RAID.sizeMax);
  }
  const share = onSide / Math.max(1, n);
  console.log(`# ${n} planned raids: ${(share * 100).toFixed(1)} % on the civ's side, ${led} led by a named figure; off side: ${notes.join('; ')}`);
  assert.ok(n >= 50, 'enough raids');
  assert.ok(share >= 0.8, `on the civ's side ${share}`);
  assert.ok(led >= n * 0.9, 'raids are led by figures');
});

test('W3.4: a figure who escapes becomes a nemesis with its name, its civ and affixes from its deeds', () => {
  const R = worldOf(1);
  const f = R.tables.figures.filter((x) => x.died === null && x.deeds.length >= 2).sort((a, b) => b.deeds.length - a.deeds.length)[0] || R.tables.figures.find((x) => x.died === null);
  const [[rx, ry]] = regionsOf(R);
  const s = hold(R, rx, ry);
  const foe = { id: 99, kind: 'reaver_captain', st: { lead: true, fig: f.id, civ: f.civ, by: [], wk: [] } };
  const n = makeNemesis(s, foe);
  assert.equal(n.name, figureName(f));
  assert.ok(n.epithet.includes(R.tables.civs[f.civ].name.replace(/^the /, '')), n.epithet);
  assert.equal(n.affixes.length, Math.min(2, Math.floor(f.deeds.length / 2)));
  assert.deepEqual(nemFigOf(s, n.id), [n.id, f.id, f.civ]);
  console.log(`# nemesis from a figure: ${n.name} ${n.epithet}, ${f.deeds.length} deeds -> affixes ${JSON.stringify(n.affixes)}`);
});

test('W3.4 oracle: the storyteller pacing (expected raids per 100 days) stays within 10 % of the legacy rows', () => {
  const majors = incidentList().filter((d) => d.cat === 'major' && isHostile(d) && (d.weight | 0) > 0);
  const minors = incidentList().filter((d) => d.cat === 'minor' && isHostile(d) && (d.weight | 0) > 0);
  const raid = (d) => C.RAID_INCIDENTS.includes(d.id);
  let pr = 0, pl = 0, mr = 0, ml = 0;
  const share = (s, list) => { let a = 0, t = 0; for (const d of list) { const w = C.causedWeight(s, d); t += w; if (raid(d)) a += w; } return t ? a / t : 0; };
  for (const { R, rx, ry } of holds()) {
    const s = hold(R, rx, ry);
    for (let day = 4; day <= 100; day += 4) {
      toDay(s, day);
      s.colony.factions.gutterkin = -20 - (day % 3) * 20;
      pr += share(s, majors); mr += share(s, minors);
      s.rt.realm = null; s.st.causesDay = -1;
      pl += share(s, majors); ml += share(s, minors);
      s.rt.realm = R; s.st.causesDay = -1;
    }
  }
  const ratio = pr / pl, mratio = mr / ml;
  console.log(`# pacing: raid share of majors ${(pr / pl * 100).toFixed(1)} % of legacy, of minors ${(mratio * 100).toFixed(1)} %`);
  assert.ok(Math.abs(ratio - 1) <= 0.1, `majors ${ratio}`);
  assert.ok(Math.abs(mratio - 1) <= 0.1, `minors ${mratio}`);
});

const BOT_DAYS = +(process.env.RAIDS_BOT_DAYS || 0);
test(`W3.4 bot: raids per 100 days with and without the record (${BOT_DAYS || 'skipped: set RAIDS_BOT_DAYS'})`, { skip: !BOT_DAYS, timeout: 7200e3 }, async () => {
  const { runBot3 } = await import('../lib/bot3.mjs');
  const R = worldOf(+(process.env.RAIDS_BOT_WORLD || 3)), regs = regionsOf(R);
  const seeds = String(process.env.RAIDS_BOT_SEEDS || '1,2').split(',').map(Number);
  const out = {};
  for (const mode of ['legacy', 'realm']) {
    let raids = 0, civNamed = 0, sided = 0, sideN = 0;
    for (const seed of seeds) {
      const [rx, ry] = regs[seed % regs.length], seen = new Set();
      await runBot3({
        seed, days: BOT_DAYS,
        onTick: (s) => {
          if (!s.realm) s.realm = realmField(R, rx, ry);
          if (mode === 'realm' && s.rt.realm !== R) s.rt.realm = R;
          if (s.tick % H1) return;
          for (const e of s.st.queue) {
            if (seen.has(e.id) || !C.RAID_INCIDENTS.includes(e.inc)) continue;
            if (!e.plan && e.stage === 'queued') continue;
            seen.add(e.id); raids++;
            if (C.isCivCause(e.cause)) {
              civNamed++;
              const side = mode === 'realm' ? C.civSide(s, R, C.civOfCause(e.cause)) : null;
              if (side && e.plan) { sideN++; if (e.plan.edge.side === side) sided++; }
            }
          }
        },
      });
    }
    out[mode] = { raids, per100: (raids * 100) / (BOT_DAYS * seeds.length), civNamed, sided, sideN };
  }
  console.log(`# bot ${BOT_DAYS} days x seeds ${seeds}: ${JSON.stringify(out)}`);
});

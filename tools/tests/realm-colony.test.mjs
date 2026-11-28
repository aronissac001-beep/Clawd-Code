// W3.3a roles bound to civs, caravans and trade (EMBERCROWN-WORLD.md G7, 2.7 factions and caravans rows; owner K).
// Oracle: realm-less holds (and holds whose record is lost) run the legacy rows draw for draw; caravan arrivals match
// travel days +-1 (the first after max(4, travel days), then every cadence = travel x 2 + 5, at least a season); the
// bound roles' goodwill takes the same deltas for the same acts as the legacy rows. Holds are one-plane test holds with
// a world region's s.realm and the decoded record in s.rt.realm (9.3 step 5), from worlds built with history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony, realmField } from '../../js/game/core/setup.js';
import { checkRealmField } from '../../js/game/core/schema.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY, DAYS_PER_SEASON } from '../../js/game/core/time.js';
import { buildRealm } from '../../js/game/realm/gen.js';
import { idx, isEmbarkable, travelDays } from '../../js/game/realm/query.js';
import * as F from '../../js/game/colony/factions.js';
import * as CV from '../../js/game/colony/caravans.js';
import * as T from '../../js/game/colony/trade.js';

const H1 = TICKS_PER_HOUR, D1 = TICKS_PER_DAY;
const WORLDS = +(process.env.COLONY_WORLDS || 6), PER = 4;
const worlds = new Map();
const worldOf = (seed) => worlds.get(seed) || worlds.set(seed, buildRealm({ seed }, { history: true })).get(seed);
function regionsOf(R) {
  const all = [];
  for (let i = 0; i < R.n * R.n; i++) if (isEmbarkable(R, i)) all.push(i);
  return Array.from({ length: PER }, (_, k) => all[Math.floor(((k + 0.5) * all.length) / PER)]).map((i) => [i % R.n, (i / R.n) | 0]);
}
function hold(R, rx, ry, { realm = true, record = true, seed = 'W33a' } = {}) {
  installSim({ stage: '2', reset: true, checks: true });
  const s = foundColony({ seed: `${seed}:${R ? R.seed : 0}:${rx},${ry}`, name: 'Test Hold' });
  if (realm) { s.realm = realmField(R, rx, ry); s.rt.realm = record ? R : null; }
  s.colony.tier = 1;   // Hamlet: the caravan types of 9.8
  return s;
}
const holds = function* () { for (let w = 1; w <= WORLDS; w++) { const R = worldOf(w); for (const [rx, ry] of regionsOf(R)) yield { R, rx, ry }; } };
/** Run the trade system alone, hour by hour, for `days`; returns the arrivals [{ day, tick, site, fac, trader }]. */
const SEEN = new WeakMap();
function runTrade(s, days) {
  const out = [], seen = SEEN.get(s) || SEEN.set(s, new Set()).get(s);
  const end = s.tick + days * D1;
  for (s.tick = Math.ceil(s.tick / H1) * H1; s.tick < end; s.tick += H1) {
    T.tradeSystem(s);
    for (const v of s.colony.trade.visits) if (!seen.has(v.id)) { seen.add(v.id); out.push({ tick: s.tick, site: v.site, fac: v.fac, trader: v.trader, barge: v.barge }); }
  }
  return out;
}

test('roles bind to civs of their kind by the 9.4 step 4 rules; c<n> goodwill starts from rel to the liege', () => {
  let n = 0, full = 0;
  for (const { R, rx, ry } of holds()) {
    const s = hold(R, rx, ry);
    const b = F.bindRoles(s);
    assert.deepEqual(Object.keys(b).sort(), [...F.ROLE_IDS].sort());
    const ids = Object.values(b).filter((x) => x !== null);
    assert.equal(new Set(ids).size, ids.length, 'one civ fills at most one role');
    for (const r of F.ROLE_IDS) {
      if (b[r] === null) continue;
      const c = R.tables.civs[b[r]], live = (k) => R.tables.civs.some((x) => x.kind === k && x.fell === null && F.sitesNow(s, R).some((y) => y.civ === x.id));
      if (live(F.ROLE_KIND[r]) && (r !== 'hearthwatch' || !Number.isInteger(s.realm.civ))) assert.equal(c.kind, F.ROLE_KIND[r], `${r} bound to a ${c.kind}`);
      assert.equal(c.fell, null);
      assert.equal(F.factionOfCiv(s, b[r]), r);
      assert.equal(F.civOfFaction(s, r), b[r]);
    }
    if (b.hearthwatch !== null && R.tables.civs.some((c) => c.kind === 'realm' && c.people === 'human' && c.fell === null && F.sitesNow(s, R).some((x) => x.civ === c.id))) assert.equal(R.tables.civs[b.hearthwatch].people, 'human');
    if (b.ashfang !== null && R.tables.civs.some((c) => c.kind === 'clans' && c.fell === null && F.relStatic(R, c.id, b.hearthwatch) < 0 && F.sitesNow(s, R).some((x) => x.civ === c.id))) assert.ok(F.relStatic(R, b.ashfang, b.hearthwatch) < 0);
    // goodwill of the roles is the legacy record, untouched
    assert.deepEqual(s.colony.factions, { league: 0, hearthwatch: 0, gutterkin: 0 });
    // a civ filling no role is 'c<n>' and starts from its rel to the liege
    const other = R.tables.civs.find((c) => !ids.includes(c.id));
    if (other) {
      const f = F.factionOfCiv(s, other.id);
      assert.equal(f, 'c' + other.id);
      assert.equal(F.goodwill(s, f), b.hearthwatch === null ? 0 : F.relStatic(R, other.id, b.hearthwatch));
      assert.equal(s.realm.stand.length, 0, 'no stand row before the goodwill moves');
      const g0 = F.goodwill(s, f), g1 = F.addGoodwill(s, f, 7);
      assert.equal(g1, Math.max(-100, Math.min(100, g0 + 7)));
      assert.deepEqual(s.realm.stand, [[other.id, g1, 0]]);
      assert.equal(F.standingOf(s, f), F.standingOf({ colony: { factions: {} }, realm: s.realm, rt: s.rt }, f));
    }
    assert.deepEqual(checkRealmField(s.realm), []);
    n++; if (ids.length === 5) full++;
  }
  assert.ok(n >= WORLDS * PER - 2);
  assert.ok(full >= n * 0.8, `all five roles bound in ${full}/${n} holds`);
  console.log(`  roles: ${n} holds, all five roles bound in ${full}`);
});

test('travelField equals query.js travelDays', () => {
  const R = worldOf(1), [rx, ry] = regionsOf(R)[1], tf = CV.travelField(R, rx, ry, 12);
  let k = 0;
  for (const x of R.tables.sites) {
    const d = travelDays(R, rx, ry, x.x, x.y, 12), f = tf[x.y * R.n + x.x];
    assert.equal(f, d, `site ${x.id}`);
    k++;
  }
  assert.ok(k > 50);
});

test('realm-less holds and holds whose record is lost run the legacy trade rows draw for draw', () => {
  const R = worldOf(2), [rx, ry] = regionsOf(R)[0];
  const a = hold(R, rx, ry, { realm: false }), b = hold(R, rx, ry, { record: false });
  const ra = runTrade(a, 60), rb = runTrade(b, 60);
  assert.ok(ra.length >= 5);
  assert.deepEqual(rb, ra);
  assert.deepEqual(JSON.parse(JSON.stringify(b.colony.trade)), JSON.parse(JSON.stringify(a.colony.trade)));
  assert.deepEqual(b.colony.factions, a.colony.factions);
  assert.ok(!a.realm);
  assert.deepEqual(b.realm.bind, {}, 'nothing binds without the record');
  assert.ok(!('sites' in a.colony.trade) && !('sites' in b.colony.trade));
});

test('caravans come from friendly towns within 12 travel days, on their cadence +-1 day', () => {
  let holdsWith = 0, arrivals = 0, barges = 0, worst = 0;
  for (const { R, rx, ry } of holds()) {
    const s = hold(R, rx, ry), t0 = s.tick;
    F.ensureBound(s); T.tradeRec(s);   // the record seeds the legacy goodwill starts (gutterkin -20)
    const src = new Map(CV.caravanSources(s).map((c) => [c.site, c]));
    for (const c of src.values()) {
      assert.ok(c.days <= 12 && R.tables.sites[c.site].civ !== null);
      assert.equal(c.cadence, Math.max(DAYS_PER_SEASON, c.days * 2 + 5));
      assert.equal(c.days, travelDays(R, rx, ry, R.tables.sites[c.site].x, R.tables.sites[c.site].y, 12));
      assert.ok(F.goodwill(s, c.fac) > -15);
    }
    const got = runTrade(s, 120);
    if (!src.size) { assert.equal(got.length, 0); continue; }
    holdsWith++;
    const by = new Map();
    for (const v of got) {
      assert.ok(src.has(v.site), `arrival from a source site (${v.site})`);
      assert.equal(v.fac, src.get(v.site).fac);
      assert.equal(v.barge, src.get(v.site).barge);
      if (v.barge) barges++;
      (by.get(v.site) || by.set(v.site, []).get(v.site)).push(v.tick);
      arrivals++;
    }
    for (const [site, ticks] of by) {
      const c = src.get(site), first = Math.max(4, Math.ceil(c.days));
      const e0 = Math.abs((ticks[0] - t0) / D1 - first);
      assert.ok(e0 <= 1, `site ${site}: first arrival day ${((ticks[0] - t0) / D1).toFixed(2)} vs ${first}`);
      worst = Math.max(worst, e0);
      for (let k = 1; k < ticks.length; k++) {
        const e = Math.abs((ticks[k] - ticks[k - 1]) / D1 - c.cadence);
        assert.ok(e <= 1, `site ${site}: gap ${((ticks[k] - ticks[k - 1]) / D1).toFixed(2)} days vs cadence ${c.cadence}`);
        worst = Math.max(worst, e);
      }
    }
    // every source has come at least once in 120 days (each cadence <= 29 days)
    for (const site of src.keys()) assert.ok(by.has(site), `site ${site} never sent a caravan`);
    assert.ok(s.colony.trade.sites.length >= src.size);
    assert.deepEqual(checkRealmField(s.realm), []);
  }
  assert.ok(holdsWith >= 10, `${holdsWith} holds have caravan sources`);
  console.log(`  caravans: ${holdsWith} holds with sources, ${arrivals} arrivals (${barges} by barge), worst error ${worst.toFixed(2)} days`);
});

test('the bound roles take the same goodwill deltas for the same acts as the legacy rows', () => {
  const R = worldOf(3), [rx, ry] = regionsOf(R)[2];
  const L = hold(R, rx, ry, { realm: false }), M = hold(R, rx, ry);
  F.ensureBound(M);
  T.tradeRec(L); T.tradeRec(M);
  assert.deepEqual(M.colony.factions, L.colony.factions);
  const acts = [['league', 1], ['hearthwatch', 10], ['hearthwatch', -5], ['gutterkin', 10], ['league', -150], ['ashfang', 5], ['pilgrims', -3]];
  for (const [f, d] of acts) assert.equal(F.addGoodwill(M, f, d), F.addGoodwill(L, f, d), `${f} ${d}`);
  assert.deepEqual(M.colony.factions, L.colony.factions);
  for (const f of F.ROLE_IDS) { assert.equal(F.goodwill(M, f), F.goodwill(L, f)); assert.equal(F.goodwillPricePct(M, f), F.goodwillPricePct(L, f)); }
  assert.equal(M.realm.stand.length, 0, 'role goodwill never lands in stand');
  // a trade with a caravan of a bound role moves that role's goodwill by 1; one with a c<n> civ's moves its stand row
  const srcs = CV.caravanSources(M);
  const role = srcs.find((c) => F.ROLE_IDS.includes(c.fac) && F.GOODWILL_IDS.includes(c.fac)), civ = srcs.find((c) => c.fac[0] === 'c');
  if (role) {
    const v = T.arrive(M, T.tradersFrom(M, role)[0].id, role), g = F.goodwill(M, role.fac);
    assert.equal(T.visitFaction(M, v), role.fac);
    assert.equal(T.tradeCmd(M, { visitId: v.id, buy: [], sell: [] }).ok, true);
    assert.equal(F.goodwill(M, role.fac), g + 1);
    assert.ok(T.visitFrom(M, v).name.length > 0);
  }
  if (civ) {
    const v = T.arrive(M, T.tradersFrom(M, civ)[0].id, civ), g = F.goodwill(M, civ.fac), before = { ...M.colony.factions };
    assert.equal(T.tradeCmd(M, { visitId: v.id, buy: [], sell: [] }).ok, true);
    assert.equal(F.goodwill(M, civ.fac), g + 1);
    assert.deepEqual(M.colony.factions, before);
    assert.equal(F.goodwillPricePct(M, civ.fac), 100 - Math.trunc((g + 1) / 10));
  }
  assert.ok(role || civ, 'the hold has a caravan source');
  // the legacy envoy: same rows in both holds
  const pay = (s) => { s.colony.trade.paidGutterkin = -1; return F.addGoodwill(s, 'gutterkin', 10); };
  assert.equal(pay(M), pay(L));
});

test('a realm hold trades deterministically and its state survives a JSON round trip', () => {
  const R = worldOf(4), [rx, ry] = regionsOf(R)[3];
  const a = hold(R, rx, ry), b = hold(R, rx, ry);
  const ra = runTrade(a, 50);
  const rb1 = runTrade(b, 25);
  const copy = JSON.parse(JSON.stringify({ realm: b.realm, trade: b.colony.trade, factions: b.colony.factions }));
  b.realm = copy.realm; b.colony.trade = copy.trade; b.colony.factions = copy.factions;
  const rb2 = runTrade(b, 25);
  assert.deepEqual(rb1.concat(rb2), ra);
  assert.deepEqual(JSON.parse(JSON.stringify(b.colony.trade)), JSON.parse(JSON.stringify(a.colony.trade)));
  assert.deepEqual(b.realm, a.realm);
});

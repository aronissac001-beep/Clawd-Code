// W2.4 (EMBERCROWN-WORLD.md 6.2, 12.4): regional climate. Oracle:
//   - the greenvale row gives today's outdoor temperature for every hour of a year, exactly (legacy hashes);
//   - a tundra region's growing season is 15 days +-1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TICKS_PER_HOUR, DAYS_PER_YEAR, DAYS_PER_SEASON, seasonOf, phaseOf } from '../../js/game/core/time.js';
import { WORLD } from '../../js/data/worldgen.js';
import { TEMP as BAL } from '../../js/data/balance.js';
import { outdoorTemp, TEMP } from '../../js/game/world/temperature.js';
import { climateTable, climateOf, seasonBase, rollWeather, weatherOffset } from '../../js/game/world/weather.js';
import { growingSeason, inGrowingSeason } from '../../js/game/world/plants.js';
import { buildRealm } from '../../js/game/realm/gen.js';
import { regionOpts } from '../../js/game/realm/region.js';
import { isEmbarkable, biomeOf } from '../../js/game/realm/query.js';

const CL = WORLD.weather.climate;
const HOURS = DAYS_PER_YEAR * 24;
// today's formula (aebe07c temperature.js): the season constant, -4 at night
const legacy = (tick) => [10, 22, 8, -6][seasonOf(tick)] + (phaseOf(tick) === 'night' ? -4 : 0);

test('greenvale row: today\'s outdoor temperature for every hour of a year, exactly', () => {
  assert.deepEqual(BAL.season, [10, 22, 8, -6]);
  assert.deepEqual(TEMP.SEASON, BAL.season);
  assert.deepEqual(climateTable(null).points, BAL.season);
  const s = { tick: 0 };   // a realm-less hold
  assert.equal(climateOf(s), null);
  for (let h = 0; h < 2 * HOURS; h++) {
    for (const off of [0, 1, 299, 599]) {
      const tick = h * TICKS_PER_HOUR + off;
      s.tick = tick;
      assert.equal(outdoorTemp(tick), legacy(tick), `hour ${h}`);
      assert.equal(outdoorTemp(tick, s), legacy(tick) + weatherOffset(s, tick));
    }
  }
  // realm: null and realm.embark without climate are realm-less too
  assert.equal(climateOf({ realm: null }), null);
  assert.equal(climateOf({ realm: { embark: {} } }), null);
  assert.equal(growingSeason(s).days, 3 * DAYS_PER_SEASON);
});

test('legacy weather rolls are unchanged without a climate', () => {
  for (let d = 0; d < 400; d++) assert.deepEqual(rollWeather(7, d, null), rollWeather(7, d));
  // a climate at rainRef keeps the rain chances of today, and its snow follows the day's base
  const c = { mean: 8, amp: 14, rain: CL.rainRef, winter: null, season: 0 };
  let same = 0;
  for (let d = 0; d < 400; d++) { const a = rollWeather(7, d), b = rollWeather(7, d, c); if (a.hours === b.hours && (a.kind === b.kind || (a.kind === 'rain' || a.kind === 'snow'))) same++; }
  assert.equal(same, 400);
});

// real regions of Standard realms
const REALMS = [1, 2, 3].map((seed) => buildRealm({ seed }));
function regions(biome) {
  const out = [];
  for (const r of REALMS) for (let i = 0; i < r.n * r.n; i++) if (isEmbarkable(r, i) && biomeOf(r, i).id === biome) out.push(regionOpts(r, i % r.n, (i / r.n) | 0));
  return out;
}

test('tundra: the growing season is 15 days +-1 on every tundra region', () => {
  const rows = regions('tundra');
  assert.ok(rows.length >= 20, `tundra regions ${rows.length}`);
  for (const o of rows) {
    const s = { tick: 0, realm: { embark: o } }, g = growingSeason(s);
    assert.ok(Math.abs(g.days - 15) <= 1, `tundra ${o.rx},${o.ry}: ${g.days} days`);
    let n = 0;
    for (let d = 0; d < DAYS_PER_YEAR; d++) if (inGrowingSeason(s, d * 24 * TICKS_PER_HOUR + 12 * TICKS_PER_HOUR)) n++;
    assert.equal(n, g.days);
    // the window sits in Highsun and the winter is cold
    assert.ok(g.first >= DAYS_PER_SEASON - 3 && g.last <= 2 * DAYS_PER_SEASON + 3, `${g.first}-${g.last}`);
    assert.ok(climateTable(o.climate).points[3] < 0);
  }
});

test('realm climates: eased by day, clamped, deterministic; highcrag shorter, taiga winter capped', () => {
  for (const o of regions('greenvale').slice(0, 50)) {
    const t = climateTable(o.climate), t2 = climateTable(JSON.parse(JSON.stringify(o.climate)));
    assert.deepEqual([...t.day], [...t2.day]);
    for (let d = 0; d < DAYS_PER_YEAR; d++) {
      const v = t.day[d], u = t.day[(d + 1) % DAYS_PER_YEAR];
      assert.ok(v >= CL.limits[0] && v <= CL.limits[1]);
      assert.ok(Math.abs(u - v) <= Math.ceil((2 * o.climate.amp) / DAYS_PER_SEASON) + 1, `step ${d}: ${v} -> ${u}`);
    }
    const s = { tick: 15 * 24 * TICKS_PER_HOUR + 12 * TICKS_PER_HOUR, realm: { embark: o } };
    assert.equal(seasonBase(s), t.day[15]);
    assert.equal(outdoorTemp(s.tick, s), t.day[15] + weatherOffset(s));
  }
  for (const o of regions('highcrag').slice(0, 40)) {
    const nat = climateTable({ ...o.climate, season: 0 }).grow.days, g = climateTable(o.climate).grow.days;
    assert.equal(g, nat - Math.round(nat * 0.2), `highcrag ${nat} -> ${g}`);
  }
  for (const o of regions('taiga').slice(0, 40)) assert.ok(climateTable(o.climate).points[3] <= o.climate.winter);
});

test('a realm hold in the sim: water freezes and thaws by its climate; the base turns at midnight', async () => {
  const { createColony, initRuntime } = await import('../../js/game/core/state.js');
  const { resetBus } = await import('../../js/game/core/bus.js');
  const { idx, TER } = await import('../../js/game/core/grid.js');
  const { TICKS_PER_DAY } = await import('../../js/game/core/time.js');
  const { installWorld } = await import('../../js/game/world/terrain.js');
  const { freezeWater } = await import('../../js/game/world/weather.js');
  const { tempBaseSystem } = await import('../../js/game/world/temperature.js');
  resetBus(); installWorld({ fuel: true, stage: '2' });
  const o = regions('tundra')[0];
  const s = createColony('W24', { w: 24 });
  for (let x = 2; x < 10; x++) s.L.terrain[idx(x, 5)] = TER.SHALLOW;
  initRuntime(s);
  s.realm = { embark: o };
  const T = climateTable(o.climate), g = T.grow;
  s.tick = 0;                                              // Thaw day 0: under freezeMax in the tundra
  assert.ok(T.day[0] <= CL.freezeMax);
  assert.equal(freezeWater(s), 8);
  assert.equal(freezeWater(s), 0, 'once');
  s.tick = g.first * TICKS_PER_DAY;                        // the first day of the growing season is above freezing
  assert.equal(freezeWater(s), 8);
  assert.equal(s.L.terrain[idx(4, 5)], TER.SHALLOW);
  // the base changes at midnight: tempBaseSystem sets the flag
  s.tick = (g.first + 1) * TICKS_PER_DAY; s.rt.dirty.temperature = false;
  tempBaseSystem(s);
  assert.equal(s.rt.dirty.temperature, T.day[g.first] !== T.day[g.first + 1] || outdoorTemp(s.tick, s) !== outdoorTemp(s.tick - 1, s));
});

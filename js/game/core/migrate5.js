// Migration v4 to v5 (owner A with L; review B and K; EMBERCROWN-WORLD.md 9.4). Part 1 (W2.8): shape only.
//
//   v4to5(ent)          `migrations[3]` (state.js): the ENTITIES of a stateVersion 4 save -> stateVersion 5, in place.
//                       A pure function of that object; it never sees the layers or the runtime.
//   weatherToV2(w)      the 6.2 weather record step v1 -> v2 (the current kind kept, calm scalars, no front): a pure
//                       function of the record, for the step that brings the v2 record (W5.1)
//   isWeatherV2(w)      true when a weather record is v2
//
// Part 1, step by step:
//   1. `realm = null`: the hold has no world yet (part 2, W3.6, gives it one: "Charting the wider world").
//   2. The weather record stays v1 here while CLIMATE2 is off. The v2 record (fronts, wind, cloud, fog, wet, snow)
//      arrives with W5.1, which is a declared re-baseline (12.1); converting it now would move every legacy hash and
//      the v1 weather code would ignore the new fields anyway. A v5 save made before W5.1 still holds a v1 record, so
//      weatherToV2 is keyed on the record's own `v` (missing = 1), not on the state version: W5.1 runs it on load for
//      every record that is not yet v2 (and v4to5 runs it here once CLIMATE2 is on).
//   3. `air` is RUNTIME (6.3), and there is no `air` runtime key until W5.9 (its re-baseline). The runtime decoder
//      gives a saved key a v4 save lacks its allocated default, which for `air` will be all zeros, so nothing is
//      written here.
// Local state is untouched: no layer, pristine CRC, entity, stock or RNG stream changes, so a v4 hold continues
// exactly as it did (the legacy-hash rule of 12.1; tools/tests/migrate5.test.mjs).

import * as FLAGS from './flags.js';

export const WEATHER_V = 2;
/** The calm v2 scalars (6.2 migration: calm, wet 0, snow 0, no front). */
const CALM = Object.freeze({ wind: [0, 0], cloud: 0, fog: 0, wet: 0, snow: 0 });

export const isWeatherV2 = (w) => !!w && typeof w === 'object' && w.v === WEATHER_V;

/** A weather record v1 -> v2 (a new object; a v2 record is returned as it is). hourAt starts at `since`. */
export function weatherToV2(w) {
  if (isWeatherV2(w)) return w;
  const o = w && typeof w === 'object' ? w : {};
  const int = (v, d) => (Number.isInteger(v) ? v : d);
  return {
    v: WEATHER_V, kind: typeof o.kind === 'string' ? o.kind : 'clear', since: int(o.since, 0), until: int(o.until, 0), day: int(o.day, -1),
    front: null, wind: CALM.wind.slice(), cloud: CALM.cloud, fog: CALM.fog, wet: CALM.wet, snow: CALM.snow, hourAt: int(o.since, 0),
  };
}

/** migrations[3]: ENTITIES v4 -> v5 (9.4 part 1). */
export function v4to5(ent) {
  // 1. no world yet (a malformed value is dropped: a hold never fails to load over its realm field, 9.2)
  const r = ent.realm;
  if (!r || typeof r !== 'object' || Array.isArray(r) || !Number.isInteger(r.wid)) ent.realm = null;
  // 2. weather v2 only once the climate front record exists (W5.1 turns CLIMATE2 on with its re-baseline)
  if (FLAGS.CLIMATE2 === true) {
    const w = ent.colony && ent.colony.world;
    if (w && w.weather && !isWeatherV2(w.weather)) w.weather = weatherToV2(w.weather);
  }
  // 3. air: nothing to write (see the header)
  if (ent.meta) ent.meta.migratedFrom = ent.meta.migratedFrom || 4;
  return ent;
}

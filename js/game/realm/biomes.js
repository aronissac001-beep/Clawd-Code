// Realm biomes, step 8 of EMBERCROWN-WORLD.md 1.2 (owner L): the 1.3 table lookup, plus the elevation bands
// and the embarkable flag (1.1). The biome ids and their order live in js/data/realm/biomes.js (append-only).
import { GEN } from '../../data/realm/params.js';
import { BIOME_INDEX as B } from '../../data/realm/biomes.js';
import { FLOW } from './rivers.js';
import { DX, DY } from './fields.js';

/** Elevation bands (1.3). */
export const BAND = Object.freeze({ SEA: 0, LOW: 1, UP: 2, HIGH: 3, PEAK: 4 });
export const BAND_NAMES = Object.freeze(['sea', 'lowland', 'upland', 'highland', 'peak']);

/** Band cut levels from the land's elevation percentiles: [seaLevel, upland, highland, peak]. */
export function bandsOf(f, n, seaLevel, lake) {
  const hist = new Uint32Array(256);
  let land = 0;
  for (let i = 0; i < n * n; i++) if (f.elev[i] >= seaLevel && !lake[i]) { hist[f.elev[i]]++; land++; }
  const at = (permille) => {
    const want = Math.floor((land * permille) / 1000);
    let v = 255, cum = 0;
    while (v > seaLevel && cum + hist[v] <= want) { cum += hist[v]; v--; }
    return v + 1;
  };
  const Bn = GEN.bands, peak = at(Bn.peak), high = at(Bn.highland), up = at(Bn.upland);
  return [seaLevel, Math.min(up, high), Math.min(high, peak), peak];
}
/** Band of one elevation given the cut levels. */
export const bandOf = (e, cuts) => (e < cuts[0] ? BAND.SEA : e >= cuts[3] ? BAND.PEAK : e >= cuts[2] ? BAND.HIGH : e >= cuts[1] ? BAND.UP : BAND.LOW);

/** The biome index of one land region (1.3 order: ruins, ashlands, shore, then band x temperature x rain x drainage). */
export function classify(band, temp, rain, drain, volc, taint, coast) {
  const C = GEN.classify;
  if (band === BAND.SEA) return B.sea;
  if (band === BAND.PEAK) return B.peak;
  if (taint > C.ruinsTaint) return B.ruins;
  if (volc > C.ashVolc && rain < C.ashRain) return B.ashlands;
  if (coast) return B.shore;
  if (temp < C.frigid) return B.tundra;
  if (band === BAND.HIGH) return B.highcrag;
  const wet = rain >= C.moist, arid = rain < C.arid, dry = rain < C.dry;
  if (band === BAND.LOW && !dry && drain < C.lowDrain) return B.fen;
  if (temp < C.cold) return dry ? B.moor : B.taiga;
  if (temp < C.temperate) {
    if (band === BAND.UP && dry) return B.moor;
    if (wet) return drain >= C.lowDrain ? B.elderwood : B.fen;
    return B.greenvale;
  }
  // warm and hot
  if (arid) return band === BAND.UP ? B.redscar : B.saltflat;
  if (dry) return band === BAND.UP ? B.redscar : temp >= C.warm ? B.saltflat : B.greenvale;
  if (wet) return drain >= C.lowDrain ? B.elderwood : B.fen;
  return B.greenvale;
}

/** Step 8: the biome layer, the bands and the embarkable bit of `flow`. */
export function biomesStep(rx) {
  const { n } = rx, N = n * n, f = rx.f, cuts = bandsOf(f, n, rx.seaLevel, rx.lake);
  rx.bands = cuts;
  for (let i = 0; i < N; i++) {
    const band = rx.sea[i] ? BAND.SEA : bandOf(f.elev[i], cuts);
    const b = classify(band, f.temp[i], f.rain[i], f.drain[i], f.volc[i], f.taint[i], f.flow[i] & FLOW.COAST);
    f.biome[i] = b;
    // embarkable: land, not a peak, not an island under 6 regions, no site (1.1)
    if (!rx.sea[i] && band !== BAND.PEAK && !rx.island[i] && !f.site[i]) f.flow[i] |= FLOW.EMBARK;
    else f.flow[i] &= ~FLOW.EMBARK;
  }
}

/** True when region i is next to (8-neighbourhood) a region of band >= `band`. */
export function nextToBand(f, n, cuts, i, band) {
  const x = i % n, y = (i - x) / n;
  for (let d = 0; d < 8; d++) {
    const xx = x + DX[d], yy = y + DY[d];
    if (xx >= 0 && yy >= 0 && xx < n && yy < n && bandOf(f.elev[yy * n + xx], cuts) >= band) return true;
  }
  return false;
}

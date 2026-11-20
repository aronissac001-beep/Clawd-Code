// ===== terra.js : Reshaping Kessa. Four planet gauges, what raises them, the stages they unlock and their side effects =====
// Veil: how thick the air is. Warmth: how far the long cold has lifted. Water: open water and vapour. Verdure: living cover.
const TERRA = {
  veil: { name: 'Veil', color: '#9fc8e8', desc: 'Thickness of the air. Holds heat in, burns up meteors, carries clouds.' },
  warm: { name: 'Warmth', color: '#ff9a5a', desc: 'How far the long cold has lifted. Melts the frost, shortens cold waves.' },
  water: { name: 'Water', color: '#5ab4ff', desc: 'Open water and vapour. Fills crater lakes and brings rain.' },
  life: { name: 'Verdure', color: '#8fdc6a', desc: 'Living cover: lichen first, then moss, then shrubs.' }
};
// stages, in the order they usually arrive; each is reached once and stays
const TERRA_STAGES = [
  { k: 'thaw', name: 'The Thaw', need: { warm: 20 }, text: 'Frost flats soften and creep back. Cold waves come less often and bite less. Shallow ice sublimes: every ice deposit loses 15%.' },
  { k: 'lakes', name: 'Meltwater Lakes', need: { warm: 30, water: 25 }, text: 'Crater floors flood. Ice drills on flooded deposits pump meltwater (+50%), condensers gain 20%, and spore beds take root on the shores. Nothing new can be built on open water.' },
  { k: 'lichen', name: 'Lichen Crust', need: { life: 8 }, text: 'Rust-gold lichen crusts the plains. +2 comfort: the view outside is alive.' },
  { k: 'rain', name: 'First Rain', need: { veil: 35, water: 40, warm: 30 }, text: 'Clouds form and rain falls. Dust storms come less often and condensers gain 30% more, but cloud cover costs solar 10%.' },
  { k: 'moss', name: 'Moss Carpets', need: { life: 28, water: 30 }, text: 'Green moss spreads from the lakes. Farms +10%, +3 comfort.' },
  { k: 'shrubs', name: 'Shrublands', need: { life: 50, warm: 45, water: 30 }, text: 'Low shrubs take hold. Oxygen makers +15% as plants add to the air, +3 comfort.' },
  { k: 'openair', name: 'Open Sky', need: { veil: 60, warm: 55, life: 50, water: 40 }, text: 'People can step outside with only a breather. Field Farms grow food in the open, domes need 25% less air, morale +5.' }
];
const TERRA_MODS = { lakes: { condense: 0.2 }, lichen: { comfort: 2 }, rain: { condense: 0.3, solar: -0.1 }, moss: { farm: 0.1, comfort: 3 }, shrubs: { oxygen: 0.15, comfort: 3 }, openair: { domeAir: -0.25, morale: 5 } };
// per sol, from each working building of a type
const TERRA_SRC = { hazeforge: { warm: 0.35, veil: 0.25 }, lichen: { life: 0.35 }, seedvault: { life: 0.15 }, lodestone: { veil: 0.1 }, mirror: { warm: 0.3 } };
const COMET = { fuel: 15, price: 1600, sols: 4, give: { water: 6, veil: 2.5, warm: 0.8 } };

function terraOf(G) { if (!G.terra) G.terra = { veil: 0, warm: 0, water: 0, life: 0, st: {}, comets: [], n: 0, rate: {} }; return G.terra; }
function terraStage(G, k) { return !!(G.terra && G.terra.st[k]); }
function terraMods(G) { const out = {}, T = G.terra; if (!T) return out; for (const k in T.st) for (const [m, v] of Object.entries(TERRA_MODS[k] || {})) out[m] = (out[m] || 0) + v; return out; }
// what each gauge gains per sol right now, by source (for the panel and the hourly update)
function terraRates(G) {
  const T = terraOf(G), r = { veil: 0, warm: 0, water: 0, life: 0 }, by = [];
  const cnt = {}; for (const b of G.buildings) if (TERRA_SRC[b.t] && b.built && b.on && !b.broken && (b._pf === undefined || b._pf > 0.4)) cnt[b.t] = (cnt[b.t] || 0) + (b._pf === undefined ? 1 : Math.min(1, b._pf));
  const lifeOk = T.warm >= 15 && T.water >= 10, vault = cnt.seedvault ? 1.6 : 1;
  for (const t in cnt) { const add = {}; for (const [k, v] of Object.entries(TERRA_SRC[t])) { let x = v * cnt[t]; if (k === 'life') x *= (lifeOk ? 1 : 0.2) * vault; r[k] += x; add[k] = x; } by.push({ t, n: Math.round(cnt[t] * 10) / 10, add }); }
  // warmth melts the frost flats and buried ice into open water, fast at first and slower once the basins are full
  const melt = 0.3 * clamp((T.warm - 20) / 40, 0, 1) * (T.water < 50 ? 1 : 0.3);
  if (melt > 0) { r.water += melt; by.push({ t: 'melt', name: 'Melting frost', n: 1, add: { water: melt } }); }
  // losses: thin air leaks away without the Lodestone Ring, heat escapes thin air, life dies back in the cold and dry
  const loss = { veil: cnt.lodestone ? 0 : T.veil * 0.006, warm: T.veil < 30 ? T.warm * 0.003 : 0, water: 0, life: lifeOk ? 0 : T.life * 0.01 };
  for (const k in r) r[k] -= loss[k];
  return { r, by, loss };
}
function terraHour(G) {
  const T = terraOf(G);
  if (G.tick % 24 === 3) {
    const { r } = terraRates(G); T.rate = {};
    for (const k in r) { T[k] = clamp(T[k] + r[k], 0, 100); T.rate[k] = Math.round(r[k] * 100) / 100; }
    terraCheck(G); terraLevees(G);
  }
  for (let i = T.comets.length - 1; i >= 0; i--) if (G.tick >= T.comets[i].at) { cometImpact(G, T.comets[i]); T.comets.splice(i, 1); }
}
function terraCheck(G) {
  const T = terraOf(G);
  for (const S of TERRA_STAGES) {
    if (T.st[S.k] || !Object.entries(S.need).every(([k, v]) => T[k] >= v)) continue;
    T.st[S.k] = solOf(G.tick);
    log(G, 'Reshaping Kessa: ' + S.name + '. ' + S.text, 'good'); fx(G, { k: 'milestone' }); fx(G, { k: 'terra', stage: S.k });
    if (S.k === 'thaw') for (const d of G.deposits) if (d.type === 'ice') d.amount = Math.round(d.amount * 0.85 * 10) / 10;
    if (S.k === 'lakes') { terraShores(G); terraLevees(G); }
    computeMods(G);
  }
}
// lakes fill crater floors from the middle out: tiles nearer the centre than this fraction of the radius are open water
function lakeFrac(G) { const T = G.terra; return T && T.st.lakes ? clamp(0.25 + (T.water - 25) / 90, 0.25, 0.8) : 0; }
function isLake(G, x, y) {
  const f = lakeFrac(G); if (!f) return false;
  for (const c of G._T.craters) { if (c.r < 3) continue; if (Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) < c.r * f) return true; }
  return false;
}
// buildings that stood on a crater floor before it flooded keep their feet dry: drones raise an earth levee around each,
// and the map draws it as a dry island in the lake (the island stays even if the building is later taken down)
function lakeTouch(G, x0, y0, s) { for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) if (isLake(G, x, y)) return true; return false; }
function terraLevees(G) {
  const T = G.terra; if (!T || !T.st.lakes) return;
  const f = lakeFrac(G); if (T.lf === f) return; const first = T.lf === undefined; T.lf = f; T.levees = T.levees || [];
  let n = 0;
  for (const b of G.buildings) { if (b.mod || T.levees.some(l => l[0] === b.x && l[1] === b.y && l[2] === b.s) || !lakeTouch(G, b.x, b.y, b.s)) continue; T.levees.push([b.x, b.y, b.s]); n++; }
  if (n) log(G, (first ? 'The crater floors flooded around ' : 'The lakes rose around ') + n + ' building' + (n > 1 ? 's' : '') + ': drones raised earth levees to keep them dry.', 'info');
}
// spore beds take root on the new shores (placed from the map seed, so they never disturb the game's random stream)
function terraShores(G) {
  const r = RNG.fromSeed(G.seed + '/shores'), f = lakeFrac(G); let n = 0;
  for (const c of G._T.craters.filter(c => c.r >= 3).slice(0, 4)) {
    const a = r.next() * 6.283, d = c.r * f + 1.6, x = Math.round(c.x + Math.cos(a) * d), y = Math.round(c.y + Math.sin(a) * d);
    if (x < 2 || y < 2 || x >= MAP_N - 2 || y >= MAP_N - 2 || G._dep[y * MAP_N + x] >= 0 || G._occ[y * MAP_N + x]) continue;
    G.deposits.push({ id: G.deposits.length, type: 'bloom', x, y, r: 0, amount: 60, max: 60, deep: false }); n++;
  }
  if (n) { G._dep = depositGrid(G); log(G, n + ' spore bed' + (n > 1 ? 's' : '') + ' took root on the new lake shores.', 'good'); }
}
function cometPrice(G) { return Math.round(COMET.price * priceInflation(G)); }
function cometCheck(G) {
  const T = terraOf(G);
  if (!techDone(G, 'comets')) return { ok: false, why: 'Needs Comet Herding research.' };
  if (T.comets.length) return { ok: false, why: 'A comet is already on its way.' };
  if (G.funds < cometPrice(G)) return { ok: false, why: 'Needs ' + cometPrice(G) + ' funding.' };
  if ((G.res.fuel || 0) < COMET.fuel) return { ok: false, why: 'Needs ' + COMET.fuel + ' fuel for the tug.' };
  return { ok: true };
}
// a tug nudges a small ice comet onto Kessa, well away from the colony
function orderComet(G) {
  const c = cometCheck(G); if (!c.ok) return { err: c.why };
  const T = terraOf(G); G.funds -= cometPrice(G); G.res.fuel -= COMET.fuel; noteUse(G, 'fuel', COMET.fuel); T.n++;
  const r = RNG.fromSeed(G.seed + '/comet' + T.n), L = G.land; let x = 0, y = 0;
  for (let k = 0; k < 40; k++) { x = 4 + r.int(MAP_N - 8); y = 4 + r.int(MAP_N - 8); if (Math.hypot(x - L.x, y - L.y) > 16 && !G._occ[y * MAP_N + x]) break; }
  T.comets.push({ at: G.tick + COMET.sols * HOURS_PER_SOL, x, y });
  log(G, 'A tug has nudged an ice comet towards Kessa. Impact in ' + COMET.sols + ' sols, far from the colony.', 'info', { x, y });
  return { ok: true };
}
function cometImpact(G, cm) {
  const T = terraOf(G); for (const [k, v] of Object.entries(COMET.give)) T[k] = clamp(T[k] + v, 0, 100);
  // the blast cracks nearby grid lines like a meteor would
  for (let yy = cm.y - 2; yy <= cm.y + 2; yy++) for (let xx = cm.x - 2; xx <= cm.x + 2; xx++) { if (xx < 0 || yy < 0 || xx >= MAP_N || yy >= MAP_N) continue; const i = yy * MAP_N + xx; for (const k of ['cable', 'pipe']) if (G[k][i] === 1) { G[k][i] = 2; G._netDirty = true; } }
  fx(G, { k: 'comet', x: cm.x, y: cm.y });
  log(G, 'The comet struck Kessa. Water +' + COMET.give.water + ', Veil +' + COMET.give.veil + ', Warmth +' + COMET.give.warm + '.', 'good', { x: cm.x, y: cm.y });
  terraCheck(G);
}
// hazards in a reshaped world: frequency multipliers (below 1 = rarer) and severity multipliers
function terraHazard(G, kind) {
  const T = G.terra; if (!T) return 1;
  if (kind === 'cold') return Math.max(0.35, 1 - T.warm / 140);
  if (kind === 'dust') return Math.max(0.4, 1 - T.veil / 250 - T.water / 250);
  if (kind === 'meteor') return Math.max(0.4, 1 - T.veil / 130);
  return 1;
}
function terraSev(G, kind) { const T = G.terra; if (!T) return 1; return kind === 'cold' ? Math.max(0.5, 1 - T.warm / 200) : 1; }
// overall progress 0..1 for goals and the score
function terraProgress(G) { const T = G.terra; if (!T) return 0; return (Math.min(T.veil, 60) / 60 + Math.min(T.warm, 55) / 55 + Math.min(T.water, 40) / 40 + Math.min(T.life, 50) / 50) / 4; }
Object.assign(KC, { TERRA, TERRA_STAGES, TERRA_MODS, TERRA_SRC, COMET, terraOf, terraStage, terraMods, terraRates, terraHour, terraCheck, lakeFrac, isLake, cometPrice, cometCheck, orderComet, terraHazard, terraSev, terraProgress });

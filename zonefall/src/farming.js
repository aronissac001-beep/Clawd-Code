// ============================================================================
// ZONEFALL — farming. A planter (data_homestead.js PLOTS) holds one plant per
// plot: d.state.pl = [[crop, growth 0..100] | 0, ...] and d.state.wat = soil
// water 0..100. Once a second (host) every plant grows with water and light:
// the sun when the planter is in the open, or a powered ceiling light /
// floodlight nearby, so crops also grow at night and indoors. A water barrel
// next to the planter tops it up by itself, rain waters planters in the open
// and a water bottle waters one by hand. Ripe plants give produce and a chance
// of seeds back. Visible stages: seed, sprout, young, flowering, ripe.
// Old saves: the old free-growing planter box becomes a Large Planter with
// hemp, berries and hemp already planted (ripe if it was ready to harvest).
// ============================================================================
import { G } from './state.js';
import { ITEMS } from './data.js';
import { CROPS, CROP_IDS, PLOTS, FARM, POWER, SEED_IDS, stageOf } from './data_homestead.js';
import { Build } from './build.js';
import { Live } from './world/live.js';
import { isLit, sunK } from './power.js';
import { Sfx } from './audio.js';
import { clamp, randi, chance } from './util.js';

const r1 = v => Math.round(v * 10) / 10, r3 = v => Math.round(v * 1000) / 1000;
export const isPlanter = d => !!(d && PLOTS[d.type]);
export const SEED_CROP = Object.fromEntries(CROP_IDS.map(c => [CROPS[c].seed, c]));

/** give items to a player (overflow drops at their feet) with a floating +n */
export function giveItem(p, id, n, x, y, z) {
  if (n <= 0 || !ITEMS[id] || !p) return;
  const left = p.inv.add(id, n);
  if (left > 0) Live.dropItem(p.x, p.z, id, left);
  if (G.ui) G.ui.floatText('+' + n + ' ' + ITEMS[id].name, x ?? p.x, y ?? p.y + 2, z ?? p.z, ITEMS[id].col);
  if (G.onGive) G.onGive(id, n);
}

export const Farming = {
  visT: 0,
  /** plots of a planter without changing anything (guests, labels, drawing) */
  plots(d) {
    const n = PLOTS[d.type].length, pl = d.state && d.state.pl;
    if (Array.isArray(pl)) return pl;
    const old = d.state && typeof d.state.growth === 'number';
    return Array.from({ length: n }, (_, i) => old ? [i === 1 ? 'berry' : 'hemp', d.state.growth >= 1 ? 100 : 30] : 0);
  },
  /** make sure a planter has plots (and turn an old planter box into the new kind) */
  ensure(d) {
    const st = d.state || (d.state = {}), n = PLOTS[d.type].length;
    if (!Array.isArray(st.pl)) { const old = typeof st.growth === 'number'; st.pl = this.plots(d).map(p => p ? [...p] : 0); st.wat = old ? 60 : (typeof st.wat === 'number' ? st.wat : 30); delete st.growth; }
    while (st.pl.length < n) st.pl.push(0);
    if (st.pl.length > n) st.pl.length = n;
    if (typeof st.wat !== 'number') st.wat = 0;
    return st.pl;
  },
  onPlace(d) { if (isPlanter(d)) this.ensure(d); },
  ripe(d) { return this.plots(d).filter(p => p && p[1] >= 100).length; },
  free(d) { return this.plots(d).filter(p => !p).length; },
  seedsHeld(p) { return SEED_IDS.filter(id => p.inv.count(id) > 0); },
  // ---------------------------------------------------------------- growth (host, once a second)
  step(dt) {
    let barrels = null, lights = null;
    const rain = clamp(((G.weather || 0) - 0.3) / 0.5, 0, 1);
    for (const d of Build.deploys) {
      if (d.dead || d.owner !== 'player') continue;
      if (d.type === 'water_barrel') { if (rain > 0 && !Build.isInside(d.x, d.z, d.y)) d.state.water = r1(Math.min(100, (d.state.water || 0) + 0.25 * rain * dt)); continue; } // barrels catch rain
      if (!isPlanter(d)) continue;
      if (!barrels) { barrels = Build.deploys.filter(b => b.type === 'water_barrel' && !b.dead && b.owner === 'player'); lights = Build.deploys.filter(l => POWER[l.type] && POWER[l.type].kind === 'light' && !l.dead && isLit(l)); }
      const pl = this.ensure(d), st = d.state, open = !Build.isInside(d.x, d.z, d.y);
      if (rain > 0 && open) st.wat = Math.min(100, st.wat + FARM.rain * rain * dt);
      if (st.wat < 85) for (const b of barrels) {
        if ((b.state.water || 0) <= 0.5 || (b.x - d.x) ** 2 + (b.z - d.z) ** 2 > FARM.barrelR ** 2 || Math.abs((b.y || 0) - (d.y || 0)) > 2) continue;
        const k = Math.min(2 * dt, 85 - st.wat, b.state.water); st.wat += k; b.state.water = r1(b.state.water - k); break;
      }
      const L = this.light(d, open, lights); st.lk = r1(L.k); st.ls = L.src;
      let growing = 0;
      for (const p of pl) {
        if (!p || p[1] >= 100 || !CROPS[p[0]]) continue; growing++;
        if (st.wat <= 0 || L.k <= 0) continue;
        p[1] = Math.min(100, r3(p[1] + dt * 100 / CROPS[p[0]].grow * L.k));
      }
      if (growing) st.wat = Math.max(0, st.wat - FARM.waterUse * growing * dt);
      st.wat = r1(st.wat);
    }
  },
  /** light on a planter: the sun in the open, or a powered light close enough (k 0..1, src sun | lamp | dark) */
  light(d, open, lights) {
    let k = 0, src = 'dark';
    if (open) { const s = sunK() * (1 - 0.3 * clamp(G.weather || 0, 0, 1)); if (s > 0.02) { k = s; src = 'sun'; } }
    for (const l of lights || []) {
      const S = POWER[l.type], dy = (l.y || 0) - (d.y || 0);
      if (dy < -0.5 || dy > 3.5 || (l.x - d.x) ** 2 + (l.z - d.z) ** 2 > S.grow * S.grow) continue;
      if (S.growK > k) { k = S.growK; src = 'lamp'; }
    }
    return { k, src };
  },
  // ---------------------------------------------------------------- player actions (host and guests alike)
  plant(p, d, seedId) {
    const crop = SEED_CROP[seedId]; if (!crop) return 'Not a seed';
    const pl = this.ensure(d); const i = pl.findIndex(x => !x);
    if (i < 0) return 'No free plot';
    if (p.inv.take(seedId, 1) < 1) return 'You have no ' + ITEMS[seedId].name;
    pl[i] = [crop, 0]; d.state.pl = [...pl]; Sfx.pickup();
    return true;
  },
  harvest(p, d) {
    const pl = this.ensure(d); let n = 0;
    pl.forEach((q, i) => {
      if (!q || q[1] < 100) return; const C = CROPS[q[0]]; if (!C) return;
      const [id, a, b] = C.yield; giveItem(p, id, randi(a, b), d.x, (d.y || 0) + 1, d.z);
      const seeds = (chance(FARM.seedChance) ? 1 : 0) + (chance(0.2) ? 1 : 0);
      if (seeds) giveItem(p, C.seed, seeds, d.x, (d.y || 0) + 1.3, d.z);
      pl[i] = 0; n++;
    });
    if (n) { d.state.pl = [...pl]; Sfx.pickup(); if (G.onGather) G.onGather('harvest', d.type); }
    return n;
  },
  water(p, d) {
    this.ensure(d);
    if (d.state.wat >= 99) return 'The soil is already wet';
    if (p.inv.take('water_bottle', 1) < 1) return 'You need a water bottle (or a water barrel next to the planter)';
    d.state.wat = Math.min(100, (d.state.wat || 0) + FARM.bottle); Sfx.splash(d.x, d.z);
    return true;
  },
  /** picking wild hemp or berries sometimes gives seeds */
  wildSeed(p, kind) {
    const id = kind === 'hemp' ? 'seed_hemp' : kind === 'berry_bush' ? 'seed_berry' : null;
    if (id && chance(FARM.wildSeed)) giveItem(p, id, 1);
  },
  /** a short status line for the interact label / panel */
  status(d) {
    const pl = this.plots(d), st = d.state || {};
    const grow = pl.filter(q => q && q[1] < 100);
    if (!pl.some(Boolean)) return 'empty';
    if (grow.length && (st.wat || 0) <= 0) return 'needs water';
    if (grow.length && st.lk === 0) return 'needs light';
    if (grow.length) return 'growing ' + Math.floor(Math.min(...grow.map(q => q[1]))) + '%';
    return 'ripe';
  },
  // ---------------------------------------------------------------- drawing (every peer)
  frame(dt) {
    if ((this.visT -= dt) > 0) return; this.visT = 0.5;
    const p = G.player, mk = G.models && G.models.makeCrop; if (!p || !mk) return;
    for (const d of Build.deploys) {
      if (!isPlanter(d) || !d.mesh || d.dead || (d.x - p.x) ** 2 + (d.z - p.z) ** 2 > 110 * 110) continue;
      const pl = this.plots(d), at = PLOTS[d.type], shown = d._crops || (d._crops = []);
      for (let i = 0; i < at.length; i++) {
        const q = pl[i], key = q && CROPS[q[0]] ? q[0] + stageOf(q[1]) : '';
        if ((shown[i] && shown[i].key) === key) continue;
        if (shown[i]) shown[i].obj.removeFromParent();
        shown[i] = null; if (!key) continue;
        let obj = null; try { obj = mk(q[0], stageOf(q[1])); } catch (e) { obj = null; }
        if (!obj) continue;
        obj.position.set(at[i][0], at[i][1], at[i][2]); obj.rotation.y = i * 2.1 + (d.x * 7 % 3);
        d.mesh.add(obj); shown[i] = { key, obj };
      }
    }
  },
};

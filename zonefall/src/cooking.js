// ============================================================================
// ZONEFALL — cooking and food buffs.
//
// The cooking pot (a pot on a tripod over its own fire) burns wood like a
// campfire. Recipes (data_homestead.js COOK) take their ingredients from your
// pockets and join the pot's queue: d.state.q = [[recipeId, secondsLeft], ...].
// While the fire burns (host, once a second) the first dish cooks and lands in
// the pot's inventory. The campfire also roasts corn and bakes potatoes.
//
// Some foods give a short buff (ITEMS[id].use.buff = { k, v, t }): health
// regen, radiation resistance, slower hunger, or more wood / ore per hit. Buffs
// belong to each player (p.buffs, not saved), tick in updatePlayer and show
// as HUD chips.
// ============================================================================
import { G } from './state.js';
import { ITEMS } from './data.js';
import { COOK, POT, BUFFS } from './data_homestead.js';
import { Build } from './build.js';
import { Sfx } from './audio.js';
import { fmtTime } from './util.js';

const r1 = v => Math.round(v * 10) / 10;
export const COOK_BY = Object.fromEntries(COOK.map(r => [r.id, r]));

export const Cooking = {
  onPlace(d) { if (d.type === 'cook_pot') { d.state.lit = 0; d.state.q = []; d.state.fa = 0; } },
  /** host: burn wood, cook the first dish in each lit pot */
  step(dt) {
    for (const d of Build.deploys) {
      if (d.type !== 'cook_pot' || d.dead) continue;
      const st = d.state; if (!Array.isArray(st.q)) st.q = [];
      if (!st.lit) continue;
      if ((st.fa || 0) <= 0) { if (d.inv && d.inv.take(POT.fuel, 1) > 0) st.fa = POT.burn; else { st.lit = 0; st.fa = 0; continue; } }
      st.fa = Math.max(0, r1(st.fa - dt));
      const job = st.q[0]; if (!job) continue;
      const R = COOK_BY[job[0]]; if (!R) { st.q = st.q.slice(1); continue; }
      job[1] = Math.max(0, r1(job[1] - dt));
      if (job[1] <= 0 && d.inv.room(R.out) >= R.n) { d.inv.add(R.out, R.n); st.q = st.q.slice(1); }
    }
  },
  /** why a recipe can't be cooked right now (null = it can) */
  cantCook(p, d, R) {
    if (!d || !Array.isArray(d.state.q)) return 'Not a pot';
    if (d.state.q.length >= POT.queue) return 'The pot is full';
    for (const k in R.cost) if (p.inv.count(k) < R.cost[k]) return 'Missing ' + ITEMS[k].name;
    return null;
  },
  /** take the ingredients from your pockets and put the dish in the pot's queue */
  cook(p, d, rid) {
    const R = COOK_BY[rid]; if (!R) return 'Unknown recipe';
    const why = this.cantCook(p, d, R); if (why) return why;
    for (const k in R.cost) p.inv.take(k, R.cost[k]);
    d.state.q = [...d.state.q, [rid, R.time]]; Sfx.craft();
    return true;
  },
  /** steam over a pot that is cooking */
  frame(dt) {
    const p = G.player; if (!p || !G.fx || !G.fx.emit) return;
    for (const d of Build.deploys) {
      if (d.type !== 'cook_pot' || !d.state.lit || !d.mesh || (d.x - p.x) ** 2 + (d.z - p.z) ** 2 > 50 * 50) continue;
      const U = d.mesh.userData; if (U.tick) U.tick(G.t || 0);
      if (Math.random() < dt * 9) G.fx.fire(d.x, (d.y || 0) + 0.1, d.z, 0.5);
      if (d.state.q && d.state.q.length && Math.random() < dt * 4) G.fx.emit({ x: d.x + (Math.random() - 0.5) * 0.2, y: (d.y || 0) + 0.82, z: d.z + (Math.random() - 0.5) * 0.2, vx: 0.1, vy: 0.6, vz: 0, life: 1.6, size: 0.14, size1: 0.6, r: 0.95, g: 0.95, b: 0.95, a: 0.45, a1: 0, drag: 0.3 });
    }
  },
};

export const Buffs = {
  /** a food buff: the stronger value wins, the longer time wins */
  add(p, b) {
    if (!p || !b || !BUFFS[b.k]) return;
    const B = p.buffs || (p.buffs = {}), cur = B[b.k];
    B[b.k] = { v: Math.max(b.v, cur ? cur.v : 0), t: Math.max(b.t, cur ? cur.t : 0) };
    if (p === G.player && G.ui) G.ui.toast(BUFFS[b.k].name + ': ' + BUFFS[b.k].fmt(B[b.k].v) + ' for ' + fmtTime(B[b.k].t), 'good');
  },
  val(p, k) { const b = p && p.buffs && p.buffs[k]; return b && b.t > 0 ? b.v : 0; },
  tick(p, dt) {
    const B = p.buffs; if (!B) return;
    for (const k in B) {
      const b = B[k]; b.t -= dt;
      if (b.t <= 0 || p.dead) { delete B[k]; continue; }
      if (k === 'regen') p.hp = Math.min(p.maxhp, p.hp + b.v * dt);
    }
  },
  /** HUD chips, e.g. "REGEN 1:52" */
  chips(p) {
    const out = [], B = p && p.buffs; if (!B) return out;
    for (const k in B) { const b = B[k], D = BUFFS[k]; if (D && b.t > 0) out.push('<span class="st ' + D.cls + '" title="' + D.fmt(b.v) + '">' + D.name + ' ' + fmtTime(b.t) + '</span>'); }
    return out;
  },
};

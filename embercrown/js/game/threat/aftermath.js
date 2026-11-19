// Aftermath (doc 9.10): what a major leaves behind. Owner H. Stage 2.
//
// When a raid ends, its captives always become captive letters (a downed reaver: recruit, ransom or
// release; capture.js), and stolen goods that left the map are noted. Then the raid rolls 0-2 entries
// from its incident's `after` list (stream 'story'); a handler applies one only when it has
// something to leave (it returns null otherwise, and the id is not recorded):
//   blight_scar      hordes and Rifts: 3-8 tiles of blight where the Hollow fell (B's setBlight)
//   captive          reavers and sappers: (handled always, above; the roll only names it in history)
//   stolen_heirloom  thieves: the most valuable named item they got away with; a letter says where
//                    their camp is: buy it back (coins) or let it go (a squad off-map is Stage 3)
//   wreckage         reavers: the gear they dropped (loot is unforbidden at the raid end, raiders.js)
//   heros_memory     the death of a Master (any cause; BUS.kill): raise a statue in 10 days for a
//                    lasting +3, else "forgotten" (the goal letter; the statue check is Stage 3)
//   siege_camp       Stage 3
// Handlers: fn(s, raid, live) -> a short id string for s.st.history, or null.

import { nextU32 } from '../core/rand.js';
import { W } from '../core/grid.js';
import { BUS } from '../core/bus.js';
import { setBlight } from '../world/terrain.js';
import { stage2 } from '../people/defs.js';
import { level } from '../people/skills.js';
import { SKILL_IDS } from '../core/schema.js';
import { sendLetter, textOf, onChoice } from './letters.js';
import { def } from './defs.js';
import { captivesOf } from './capture.js';
import { spawn as spawnItem, consume, totals } from '../work/items.js';

/** Pay coins from the colony's stacks (lowest index first). false (nothing paid) when short. */
export function payCoins(s, n) {
  if (totals(s, 'coins') < n) return false;
  let need = n;
  for (const it of s.items.slice()) { if (!it || it.k !== 'coins' || need <= 0) continue; need -= consume(s, it.id, Math.min(need, it.n)); }
  return need <= 0;
}

export const AFTERMATH_IDS = Object.freeze(['siege_camp', 'captive', 'blight_scar', 'stolen_heirloom', 'wreckage', 'heros_memory']);
const HANDLERS = new Map();
export function registerAftermath(id, fn) { HANDLERS.set(id, fn); }
export const aftermathHandler = (id) => HANDLERS.get(id) || null;

/** Roll and apply 0-2 aftermath entries for a raid that ended. @returns {string[]} applied ids */
export function rollAftermath(s, raid, inc, live = {}) {
  if (stage2()) captivesOf(s, raid, live);
  const list = (inc && inc.after) || [];
  if (!list.length) return [];
  const n = nextU32(s, 'story') % 3;
  const out = [];
  for (let k = 0; k < n && k < list.length; k++) {
    const id = list[(nextU32(s, 'story') % list.length)];
    if (out.includes(id)) continue;
    const h = HANDLERS.get(id);
    if (h && stage2()) { if (h(s, raid, live) === null) continue; }
    else if (h) h(s, raid, live);
    out.push(id);
  }
  return out;
}

// ---- Handlers ------------------------------------------------------------------------------------
registerAftermath('blight_scar', (s, raid, live) => {
  const fell = (live && live.fell) || [];
  if (!fell.length) return null;
  const n = 3 + (nextU32(s, 'story') % 6);
  const out = [];
  for (let k = 0; k < fell.length && out.length < n; k++) {
    const i = fell[(k * 7) % fell.length];
    for (const j of [i, i + 1, i - 1, i + W, i - W]) {
      if (out.length >= n || j < 0 || j >= s.L.blight.length || out.includes(j)) continue;
      if (s.L.terrain && s.L.roof[j] >= 2) continue;   // blight scars open land
      setBlight(s, j, Math.max(s.L.blight[j], 160));
      out.push(j);
    }
  }
  return out.length ? 'blight_scar' : null;
});
registerAftermath('captive', (s, raid, live) => (live && live.captives && live.captives.length ? 'captive' : null));
registerAftermath('wreckage', (s, raid, live) => (live && live.loot && live.loot.length ? 'wreckage' : null));
registerAftermath('stolen_heirloom', (s, raid, live) => {
  const st = (live && live.stolen) || [];
  if (!st.length) return null;
  let best = null, bv = -1;
  for (const b of st) { const d = def('item', b.k); const v = ((d && d.value) || 1) * b.n * (b.name ? 10 : 1); if (v > bv) { bv = v; best = b; } }
  const what = best.name || `${best.n} ${(def('item', best.k) || { name: best.k }).name}`;
  const price = Math.max(20, Math.min(400, Math.floor(bv / 2)));
  sendLetter(s, 'choice', {
    inc: raid.inc, title: 'Stolen goods', text: textOf('inc_heirloom', { item: what, edge: ({ n: 'north', e: 'east', s: 'south', w: 'west' })[raid.edge && raid.edge.side] || 'far' }),
    choices: [`Buy it back (${price} coins)`, 'Let it go'], data: { k: 'heirloom', bundle: best, price }, hours: 72,
  });
  return 'stolen_heirloom';
});
onChoice('heirloom', (s, l, choice) => {
  if (choice !== 0) return;
  const { bundle, price } = l.data;
  // pay from the coin stacks, then the goods come back at the Hearth
  if (!payCoins(s, price)) return;   // could not pay: nothing comes back
  const hb = s.colony.hearth.id !== null ? s.bld[s.colony.hearth.id] : null;
  if (hb) spawnItem(s, bundle.k, bundle.m, bundle.q, bundle.n, hb.x - 1, hb.y + 1, { name: bundle.name });
});

// A Master's death (any cause) leaves a hero's memory (Stage 2).
const masterSkill = (c) => { for (let k = 0; k < SKILL_IDS.length; k++) if (level(c, SKILL_IDS[k]) >= 16) return SKILL_IDS[k]; return null; };
function onKill(s, victim) {
  if (!stage2() || !victim || !Array.isArray(victim.sk) || !masterSkill(victim)) return;
  sendLetter(s, 'incident', { title: 'A hero\'s memory', text: textOf('inc_heros_memory', { name: victim.name }), data: { colId: victim.id } });
  const g = s.st.goals || (s.st.goals = []);
  g.push({ k: 'statue', name: victim.name, until: s.tick + 10 * 14400 });
}
registerAftermath('heros_memory', () => null);
export function installAftermath() { if (!BUS.kill.includes(onKill)) BUS.kill.push(onKill); }

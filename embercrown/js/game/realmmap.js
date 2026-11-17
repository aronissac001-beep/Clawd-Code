// The Realm Map: one act is a left-to-right graph of steps ending in a boss.
// Pure and deterministic: every choice draws from the RNG passed in, and the
// result is plain JSON (saved inside the run).

export const NODE_TYPES = {
  region:   { id: 'region',   name: 'Region',         icon: 'region',   color: '#7cbf5a', blurb: 'Untamed land. Kindle a Hearth and hold it.', offer: 'The Beacon grants a relic or a lasting bonus' },
  cursed:   { id: 'cursed',   name: 'Cursed Region',  icon: 'skull',    color: '#a46ad0', blurb: 'Hollow-blighted land. The night bites harder here.', offer: 'Stronger Hollow; the Beacon offers rarer relics' },
  mystery:  { id: 'mystery',  name: 'Mystery',        icon: 'mystery',  color: '#5fd0c8', blurb: 'Something waits on the road. Choose your risk.', offer: 'An event: chance and choice' },
  merchant: { id: 'merchant', name: 'Merchant Caravan', icon: 'merchant', color: '#f0c040', blurb: 'A wagon of wares that braved the dark roads.', offer: 'Buy relics, blueprints, healing and supplies' },
  // Retired in the rework (kept so older saved maps still load and show).
  shrine:   { id: 'shrine',   name: 'Shrine',         icon: 'shrine',   color: '#8fc8f0', blurb: 'A quiet spring where old powers still listen.', offer: 'Heal, take a blessing or spin the Wheel' },
  ruin:     { id: 'ruin',     name: 'Ruin',           icon: 'ruin',     color: '#c8a880', blurb: 'A fallen hold. Raid it before the Hollow gather.', offer: 'A short stand and a relic' },
  boss:     { id: 'boss',     name: 'The Gloomwyrm',  icon: 'wyrm',     color: '#e0503a', blurb: 'The wyrm that drinks the light. End it, or fall.', offer: 'The Gloomwyrm awaits' },
};

/** Each act ends with its own boss: the boss node takes that boss's name and words. */
export const BOSS_BY_ACT = { 1: 'gloomwyrm', 2: 'colossus', 3: 'hollowking' };
export const BOSS_NODES = {
  gloomwyrm: { name: 'The Gloomwyrm', blurb: 'The wyrm that drinks the light. End it, or fall.', offer: 'The Gloomwyrm awaits', objective: 'Slay the Gloomwyrm' },
  colossus: { name: 'The Bone Colossus', blurb: 'A giant of fused bone that cracks the earth with every step. Strike its weak spot after each slam.', offer: 'The Bone Colossus awaits', objective: 'Fell the Bone Colossus' },
  hollowking: { name: 'The Hollow King', blurb: 'The crowned dark itself. Keep your fires lit and face him.', offer: 'The Hollow King awaits', objective: 'Face the Hollow King' },
};
/** NODE_TYPES entry for a node, with the boss node dressed as this act's boss (act 1..3 or a boss id). */
export function nodeTypeFor(type, actOrBoss) {
  const T = NODE_TYPES[type] || NODE_TYPES.region;
  if (type !== 'boss') return T;
  const B = BOSS_NODES[actOrBoss] || BOSS_NODES[BOSS_BY_ACT[actOrBoss]] || BOSS_NODES.gloomwyrm;
  return { ...T, name: B.name, blurb: B.blurb, offer: B.offer };
}
export function bossObjective(actOrBoss) { return (BOSS_NODES[actOrBoss] || BOSS_NODES[BOSS_BY_ACT[actOrBoss]] || BOSS_NODES.gloomwyrm).objective; }

/** Player-facing words for each region objective. */
export const OBJECTIVES = {
  survive: 'Hold for 3 nights',
  rift: 'Destroy the Hollow Rift',
  prosperity: 'Hold for 3 nights (side goal: grow prosperous)',
  edict: "Hold for 3 nights (side goal: the Crown's Edict)",
  boss: 'Slay the Gloomwyrm',
};

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export function actName(act) { return 'Act ' + (ROMAN[act] || String(act)); }

const nid = (act, step, lane) => `a${act}-s${step}-n${lane}`;
const COMBAT = new Set(['region', 'cursed', 'ruin']);
/** Node types a new map is made of (Shrine and Ruin are kept only so older saved maps still load). */
export const MAP_TYPES = ['region', 'cursed', 'mystery', 'merchant', 'boss'];

// Main objective: Hold for 3 nights, or Destroy the Rift. The old Prosperity and Edict
// objectives come back as side goals of a Hold (js/game/systems/objectives.js).
function objectiveFor(rng, type, step) {
  if (type === 'ruin') return 'survive';
  if (type === 'boss') return 'boss';
  if (!COMBAT.has(type)) return null;
  const w = type === 'cursed'
    ? { rift: 5, survive: 2, prosperity: 1, edict: 2 }
    : step === 0 ? { survive: 5, prosperity: 2, rift: 1, edict: 1 } : { survive: 3, rift: 2, prosperity: 2, edict: 2 };
  return rng.weighted(Object.keys(w), (k) => w[k]);
}

/**
 * The shape of an act (rework, stream H2): combat columns of 2-3 regions, one crossroads
 * column of a Mystery and a Merchant Caravan (the road between fights), then the boss.
 * With the default 4 steps: region, region, crossroads, region, boss. Every route therefore
 * fights exactly (steps - 1) regions and makes one stop on the road.
 */
export function roadStep(steps) { return Math.max(1, steps - 2); }

/**
 * Connect column A (a nodes) to column B (b nodes) without crossings: walk a
 * monotone staircase from (0,0) to (a-1,b-1). Each A node gets 1-2 edges and
 * every B node gets at least one.
 */
function linkColumns(rng, a, b) {
  const edges = [[0, 0]];
  let i = 0, j = 0, out = 1;
  const fits = (ni, nj, nOut) => (b - 1 - nj) <= (2 - nOut) + 2 * (a - 1 - ni);
  while (i < a - 1 || j < b - 1) {
    const moves = [];
    if (i < a - 1 && j < b - 1 && fits(i + 1, j + 1, 1)) moves.push(['both', 4]);
    if (j < b - 1 && out < 2 && fits(i, j + 1, out + 1)) moves.push(['j', 3]);
    if (i < a - 1 && fits(i + 1, j, 1)) moves.push(['i', 2]);
    const m = rng.weighted(moves, (x) => x[1])[0];
    if (m === 'both') { i++; j++; out = 1; } else if (m === 'j') { j++; out++; } else { i++; out = 1; }
    edges.push([i, j]);
  }
  return edges;
}

function tryGenerate(rng, act, steps) {
  const road = roadStep(steps);
  const sizes = [];
  for (let s = 0; s < steps; s++) sizes.push(s === road ? 2 : rng.weighted([2, 3], (n) => (n === 3 ? 3 : 2)));
  sizes.push(1);
  const types = sizes.map((n) => new Array(n).fill('region'));
  types[steps][0] = 'boss';
  // The crossroads: a Mystery and a Merchant, in either order.
  types[road] = rng.chance(0.5) ? ['mystery', 'merchant'] : ['merchant', 'mystery'];
  // One Cursed Region after the first step, in a column that keeps a plain region.
  const cand = [];
  for (let s = 1; s < steps; s++) if (s !== road && sizes[s] >= 2) types[s].forEach((t, l) => cand.push([s, l]));
  if (!cand.length) return null;
  const [cs, cl] = rng.pick(cand);
  types[cs][cl] = 'cursed';

  const map = { act, steps: [], nodes: {} };
  for (let s = 0; s <= steps; s++) {
    const n = sizes[s];
    const col = [];
    for (let l = 0; l < n; l++) {
      const id = nid(act, s, l);
      const type = types[s][l];
      // x is the node's place across its column, kept in lane order.
      const x = n === 1 ? 0.5 : (l + 0.5 + rng.float(-0.12, 0.12)) / n;
      map.nodes[id] = {
        id, step: s, lane: l, x: Math.round(x * 1000) / 1000, type, next: [],
        biome: type === 'cursed' || type === 'ruin' || type === 'boss' ? 'ruins' : 'greenvale',
        objectiveType: objectiveFor(rng, type, s),
      };
      col.push(id);
    }
    map.steps.push(col);
  }
  for (let s = 0; s < steps; s++) {
    for (const [i, j] of linkColumns(rng, sizes[s], sizes[s + 1])) map.nodes[map.steps[s][i]].next.push(map.steps[s + 1][j]);
  }
  return map;
}

/**
 * Build one act's map. Retries (deterministically) in the rare case a layout
 * cannot hold every rule. At least 3 steps (two fights and the crossroads).
 * Never throws: after many tries it keeps the candidate with the fewest problems
 * (routes are always valid by construction; only the type mix can fall short).
 */
export function generateActMap(rng, act = 1, steps = 4) {
  steps = Math.max(3, steps | 0);
  let best = null, bestN = Infinity;
  for (let k = 0; k < 200; k++) {
    const m = tryGenerate(rng, act, steps);
    if (!m) continue;
    const n = validateActMap(m).length;
    if (!n) return m;
    if (n < bestN) { best = m; bestN = n; }
  }
  return best || tryGenerate(rng, act, steps) || fallbackMap(act, steps);
}

// Last resort (never seen in testing): a plain ladder of two regions per fighting step, the
// crossroads, a curse in the last fighting step and the boss, so a run can always start.
function fallbackMap(act, steps) {
  const map = { act, steps: [], nodes: {} };
  const road = roadStep(steps);
  for (let s = 0; s <= steps; s++) {
    const n = s === steps ? 1 : 2;
    const col = [];
    for (let l = 0; l < n; l++) {
      const type = s === steps ? 'boss' : s === road ? (l ? 'merchant' : 'mystery') : s === steps - 1 && l === 1 ? 'cursed' : 'region';
      const id = nid(act, s, l);
      map.nodes[id] = {
        id, step: s, lane: l, x: n === 1 ? 0.5 : (l + 0.5) / n, type, next: [],
        biome: type === 'cursed' || type === 'ruin' || type === 'boss' ? 'ruins' : 'greenvale',
        objectiveType: type === 'boss' ? 'boss' : type === 'cursed' ? 'rift' : type === 'region' ? 'survive' : null,
      };
      col.push(id);
    }
    map.steps.push(col);
  }
  for (let s = 0; s < steps; s++) {
    const a = map.steps[s], b = map.steps[s + 1];
    a.forEach((id, l) => {
      const nx = map.nodes[id].next;
      nx.push(b[Math.min(l, b.length - 1)]);
      if (l === a.length - 1 && b.length - 1 > l) nx.push(b[b.length - 1]);
    });
  }
  return map;
}

/** Nodes the player may travel to next. */
export function reachable(map, pos) {
  if (!pos) return map.steps[0].slice();
  const n = map.nodes[pos];
  return n ? n.next.slice() : [];
}

/** True when the Hollowing has swallowed this node (behind the front and never visited). */
export function isSwallowed(map, nodeId, front, visited) {
  const n = map.nodes[nodeId];
  return !!n && n.step < front && !(visited || []).includes(nodeId);
}

/** Check every map rule. Returns a list of problems (empty = valid). */
export function validateActMap(map) {
  const p = [];
  const S = map.steps.length - 1;
  const road = roadStep(S);
  const count = (t, f = () => true) => Object.values(map.nodes).filter((n) => n.type === t && f(n)).length;
  if (S < 1) p.push('too few steps');
  if (map.steps[S].length !== 1 || map.nodes[map.steps[S][0]].type !== 'boss') p.push('boss column must hold the boss alone');
  if (count('boss') !== 1) p.push('exactly one boss');
  map.steps.forEach((col, s) => {
    if (s < S) {
      const lo = 2, hi = s === road ? 2 : 3;
      if (col.length < lo || col.length > hi) p.push(`step ${s} has ${col.length} nodes`);
    }
    if (s === 0 && col.some((id) => map.nodes[id].type !== 'region')) p.push('step 0 must be all regions');
    col.forEach((id, l) => {
      const n = map.nodes[id];
      if (!n || n.step !== s || n.lane !== l) p.push(`bad node record ${id}`);
      if (l > 0 && map.nodes[col[l - 1]].x >= n.x) p.push(`x out of lane order at ${id}`);
      if (n.x < 0 || n.x > 1) p.push(`x out of range at ${id}`);
      const wantBiome = ['cursed', 'ruin', 'boss'].includes(n.type) ? 'ruins' : 'greenvale';
      if (n.biome !== wantBiome) p.push(`biome wrong at ${id}`);
      if (n.type === 'region' || n.type === 'cursed') { if (!['survive', 'rift', 'prosperity', 'edict'].includes(n.objectiveType)) p.push(`objective missing at ${id}`); }
      else if (n.type === 'ruin') { if (n.objectiveType !== 'survive') p.push(`ruin objective at ${id}`); }
      else if (n.type === 'boss') { if (n.objectiveType !== 'boss' || n.biome !== 'ruins') p.push('boss objective/biome'); }
      else if (n.objectiveType !== null) p.push(`non-region with objective at ${id}`);
      if (s < S) {
        if (n.next.length < 1 || n.next.length > 2) p.push(`${id} has ${n.next.length} exits`);
        for (const t of n.next) if (!map.nodes[t] || map.nodes[t].step !== s + 1) p.push(`${id} links to a non-adjacent step`);
      } else if (n.next.length) p.push('boss has exits');
      if (s > 0 && !map.steps[s - 1].some((q) => map.nodes[q].next.includes(id))) p.push(`${id} is unreachable`);
    });
    // No crossings: for lanes a < b, every target of a must be <= every target of b.
    if (s < S) {
      for (let a = 0; a < col.length; a++) for (let b = a + 1; b < col.length; b++) {
        const ta = map.nodes[col[a]].next.map((t) => map.nodes[t].lane), tb = map.nodes[col[b]].next.map((t) => map.nodes[t].lane);
        if (Math.max(...ta) > Math.min(...tb)) p.push(`edges cross between ${col[a]} and ${col[b]}`);
      }
    }
  });
  for (const n of Object.values(map.nodes)) if (!MAP_TYPES.includes(n.type)) p.push(`retired node type ${n.type} at ${n.id}`);
  const roadTypes = (map.steps[road] || []).map((id) => map.nodes[id].type).sort().join();
  if (roadTypes !== 'merchant,mystery') p.push(`crossroads at step ${road} holds ${roadTypes}`);
  if (count('mystery') !== 1 || count('merchant') !== 1) p.push('one Mystery and one Merchant per act');
  const cursed = count('cursed');
  if (cursed !== 1) p.push(`cursed count ${cursed}`);
  if (count('cursed', (n) => n.step < 1)) p.push('cursed on the first step');
  for (let s = 0; s < S; s++) if (s !== road && !map.steps[s].some((id) => map.nodes[id].type === 'region')) p.push(`step ${s} has no plain region`);
  // Every route fights the same number of regions: all columns but the crossroads.
  for (let s = 0; s < S; s++) if (s !== road && map.steps[s].some((id) => !COMBAT.has(map.nodes[id].type))) p.push(`step ${s} mixes a stop into a fighting column`);
  return p;
}

// Self-test: `node js/game/realmmap.js [count]` generates many maps and checks
// every rule, determinism and the travel helpers. Never runs in the browser.
if (typeof process !== 'undefined' && /realmmap\.js$/.test((process.argv || [])[1] || '') && import.meta.url.startsWith('file:')) {
  import('../engine/rng.js').then(({ RNG, hashString }) => {
    const N = +process.argv[2] || 500;
    let fails = 0;
    const fail = (msg) => { if (++fails <= 10) console.log('FAIL', msg); };
    for (const steps of [4, 3, 5, 6]) {
      for (let i = 0; i < (steps === 4 ? N : N / 5); i++) {
        const seed = hashString(`SELFTEST-${steps}-${i}`);
        const m = generateActMap(new RNG(seed), 1, steps);
        if (JSON.stringify(m) !== JSON.stringify(generateActMap(new RNG(seed), 1, steps))) fail(`not deterministic: ${steps}/${i}`);
        const probs = validateActMap(m);
        if (probs.length) fail(`${steps}/${i}: ${probs.join('; ')}`);
        if (m.steps.length !== steps + 1) fail(`${steps}/${i}: column count`);
        const seen = new Set(m.steps[0]), q = [...m.steps[0]];
        while (q.length) for (const t of m.nodes[q.shift()].next) if (!seen.has(t)) { seen.add(t); q.push(t); }
        if (seen.size !== Object.keys(m.nodes).length) fail(`${steps}/${i}: a node is unreachable from the start`);
        if (reachable(m, null).join() !== m.steps[0].join()) fail('reachable(null)');
        const a = m.steps[1][0];
        if (reachable(m, a).join() !== m.nodes[a].next.join()) fail('reachable(pos)');
        if (!isSwallowed(m, m.steps[0][0], 1, []) || isSwallowed(m, m.steps[0][0], 1, [m.steps[0][0]]) || isSwallowed(m, a, 1, [])) fail('isSwallowed');
      }
    }
    const fp = [3, 4, 6].flatMap((st) => validateActMap(fallbackMap(1, st)));
    if (fp.length) fail('fallback map: ' + fp.join('; '));
    if (generateActMap(new RNG(7), 1, 2).steps.length !== 4) fail('steps clamp');
    console.log(fails ? `realmmap self-test: ${fails} failure(s)` : `realmmap self-test: OK (${N * 1.6} maps)`);
    if (fails) process.exitCode = 1;
  });
}

// The Realm Map: one act is a left-to-right graph of steps ending in a boss.
// Pure and deterministic: every choice draws from the RNG passed in, and the
// result is plain JSON (saved inside the run).

export const NODE_TYPES = {
  region:   { id: 'region',   name: 'Region',         icon: 'region',   color: '#7cbf5a', blurb: 'Untamed land. Kindle a Hearth and hold it.', offer: 'Embers, gold and a blueprint draft' },
  cursed:   { id: 'cursed',   name: 'Cursed Region',  icon: 'skull',    color: '#a46ad0', blurb: 'Hollow-blighted land. The night bites harder here.', offer: 'Harder, richer loot' },
  mystery:  { id: 'mystery',  name: 'Mystery',        icon: 'mystery',  color: '#5fd0c8', blurb: 'Something waits on the road. Choose your risk.', offer: 'An event: chance and choice' },
  merchant: { id: 'merchant', name: 'Merchant Caravan', icon: 'merchant', color: '#f0c040', blurb: 'A wagon of wares that braved the dark roads.', offer: 'Buy relics, blueprints and supplies' },
  shrine:   { id: 'shrine',   name: 'Shrine',         icon: 'shrine',   color: '#8fc8f0', blurb: 'A quiet spring where old powers still listen.', offer: 'Heal, take a blessing or spin the Wheel' },
  ruin:     { id: 'ruin',     name: 'Ruin',           icon: 'ruin',     color: '#c8a880', blurb: 'A fallen hold. Raid it before the Hollow gather.', offer: 'A short stand and a relic' },
  boss:     { id: 'boss',     name: 'The Gloomwyrm',  icon: 'wyrm',     color: '#e0503a', blurb: 'The wyrm that drinks the light. End it, or fall.', offer: 'The Gloomwyrm awaits' },
};

/** Player-facing words for each region objective. */
export const OBJECTIVES = {
  survive: 'Survive the nights',
  rift: 'Destroy the Hollow Rift',
  prosperity: 'Grow prosperous',
  edict: "Fulfil the Crown's Edict",
  boss: 'Slay the Gloomwyrm',
};

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export function actName(act) { return 'Act ' + (ROMAN[act] || String(act)); }

const nid = (act, step, lane) => `a${act}-s${step}-n${lane}`;
const COMBAT = new Set(['region', 'cursed', 'ruin']);

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
  const sizes = [];
  for (let s = 0; s < steps; s++) sizes.push(s === 0 ? rng.int(2, 3) : rng.weighted([2, 3, 4], (n) => (n === 3 ? 5 : n === 4 ? 3 : 2)));
  sizes.push(1);
  const types = sizes.map((n) => new Array(n).fill('region'));
  types[steps][0] = 'boss';
  // At least one region stays in every column, so a fight is always on offer.
  const free = (s) => types[s].filter((t) => t === 'region').length > 1;
  const place = (type, stepsAllowed) => {
    const cand = [];
    for (const s of stepsAllowed) if (s >= 1 && s < steps && free(s)) types[s].forEach((t, l) => { if (t === 'region') cand.push([s, l]); });
    if (!cand.length) return false;
    const [s, l] = rng.pick(cand);
    types[s][l] = type;
    return true;
  };
  const range = (a, b) => { const r = []; for (let s = a; s <= b; s++) r.push(s); return r; };
  const pre = steps - 1;
  const preType = rng.chance(0.5) ? 'shrine' : 'merchant';
  let ok = place(preType, [pre]);
  ok = ok && place('merchant', [2, 3].filter((s) => s !== pre || preType !== 'merchant'));
  ok = ok && place('cursed', range(2, steps - 1));
  if (preType !== 'shrine') ok = ok && place('shrine', range(1, steps - 2));
  ok = ok && place('ruin', range(2, steps - 1)) || (ok && place('ruin', range(1, steps - 1)));
  if (!ok) return null;
  // Optional extras: a second curse late in the act, a mystery in most steps.
  if (steps >= 5 && rng.chance(0.4)) place('cursed', range(Math.max(3, steps - 3), steps - 1));
  let mysteries = 0;
  for (let s = 1; s < steps; s++) if (rng.chance(0.75) && place('mystery', [s])) mysteries++;
  for (let tries = 0; mysteries < 2 && tries < 4; tries++) if (place('mystery', range(1, steps - 1))) mysteries++;

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
 * cannot hold every rule. At least 4 steps: fewer cannot fit the required mix.
 * Never throws: after many tries it keeps the candidate with the fewest problems
 * (routes are always valid by construction; only the type mix can fall short).
 */
export function generateActMap(rng, act = 1, steps = 6) {
  steps = Math.max(4, steps | 0);
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

// Last resort (never seen in testing): a plain ladder of regions with a merchant,
// shrine, ruin and curse dropped in, so a run can always start.
function fallbackMap(act, steps) {
  const map = { act, steps: [], nodes: {} };
  const special = { [`1/1`]: 'ruin', [`2/1`]: 'merchant', [`${Math.max(2, steps - 2)}/2`]: 'cursed', [`${steps - 1}/1`]: 'shrine' };
  for (let s = 0; s <= steps; s++) {
    const n = s === steps ? 1 : s === 0 ? 2 : 3;
    const col = [];
    for (let l = 0; l < n; l++) {
      const type = s === steps ? 'boss' : special[`${s}/${l}`] || 'region';
      const id = nid(act, s, l);
      map.nodes[id] = {
        id, step: s, lane: l, x: n === 1 ? 0.5 : (l + 0.5) / n, type, next: [],
        biome: type === 'cursed' || type === 'ruin' || type === 'boss' ? 'ruins' : 'greenvale',
        objectiveType: type === 'boss' ? 'boss' : type === 'cursed' ? 'rift' : type === 'region' || type === 'ruin' ? 'survive' : null,
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
  const count = (t, f = () => true) => Object.values(map.nodes).filter((n) => n.type === t && f(n)).length;
  if (S < 1) p.push('too few steps');
  if (map.steps[S].length !== 1 || map.nodes[map.steps[S][0]].type !== 'boss') p.push('boss column must hold the boss alone');
  if (count('boss') !== 1) p.push('exactly one boss');
  map.steps.forEach((col, s) => {
    if (s < S) {
      const lo = 2, hi = s === 0 ? 3 : 4;
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
  if (!count('merchant', (n) => n.step === 2 || n.step === 3)) p.push('no merchant at step 2 or 3');
  if (!count('shrine')) p.push('no shrine');
  if (!count('ruin')) p.push('no ruin');
  const cursed = count('cursed');
  if (cursed < 1 || cursed > 2) p.push(`cursed count ${cursed}`);
  if (count('cursed', (n) => n.step < 2)) p.push('cursed before step 2');
  if (!map.steps[S - 1].some((id) => ['shrine', 'merchant'].includes(map.nodes[id].type))) p.push('no shrine or merchant before the boss');
  for (let s = 1; s < S; s++) if (!map.steps[s].some((id) => map.nodes[id].type === 'region')) p.push(`step ${s} has no plain region`);
  const total = Object.keys(map.nodes).length - 1;
  if (count('region') * 2 < total) p.push('regions are not the majority');
  return p;
}

// Self-test: `node js/game/realmmap.js [count]` generates many maps and checks
// every rule, determinism and the travel helpers. Never runs in the browser.
if (typeof process !== 'undefined' && /realmmap\.js$/.test((process.argv || [])[1] || '') && import.meta.url.startsWith('file:')) {
  import('../engine/rng.js').then(({ RNG, hashString }) => {
    const N = +process.argv[2] || 500;
    let fails = 0;
    const fail = (msg) => { if (++fails <= 10) console.log('FAIL', msg); };
    for (const steps of [6, 4, 5, 7, 8]) {
      for (let i = 0; i < (steps === 6 ? N : N / 5); i++) {
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
    const fp = [4, 6, 8].flatMap((st) => validateActMap(fallbackMap(1, st)));
    if (fp.length) fail('fallback map: ' + fp.join('; '));
    if (generateActMap(new RNG(7), 1, 2).steps.length !== 5) fail('steps clamp');
    console.log(fails ? `realmmap self-test: ${fails} failure(s)` : `realmmap self-test: OK (${N * 1.8} maps)`);
    if (fails) process.exitCode = 1;
  });
}

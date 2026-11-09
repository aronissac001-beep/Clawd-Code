// The run layer: one journey across the Realm Map. Owns everything carried
// between regions (Sovereign health, gold, relics, blueprints, Beacon bonuses,
// event flags) and turns map nodes into regions, events, shops and shrines.
// Like the simulation, it draws every random choice from a saved seeded RNG.
import { RNG, hashString } from '../engine/rng.js';
import { BAL, RUN, DEFAULT_MODS } from '../data/balance.js';
import { BUILDINGS } from '../data/buildings.js';
import { UNITS } from '../data/units.js';
import { RELICS, RELIC_SETS, RARITIES, relicPool } from '../data/relics.js';
import { BEACONS } from '../data/beacons.js';
import { EVENTS, pickEvent } from '../data/events.js';
import { generateActMap, reachable } from './realmmap.js';
import { makeHeraldry, createRegion } from './state.js';
import { makeObjective } from './systems/objectives.js';

export const RUN_VERSION = 2;
export const BASE_BLUEPRINTS = ['house', 'farm', 'lumber', 'quarry', 'wall', 'gate', 'tower'];

// ---- RNG -----------------------------------------------------------------------
// The run RNG lives as a plain number in run.rng; borrow it, then store it back.
export function withRng(run, fn) {
  const r = new RNG(run.rng);
  const out = fn(r);
  run.rng = r.getState();
  return out;
}

// ---- Creation ----------------------------------------------------------------------
export function createNewRun({ seedText, difficulty = 'standard' }) {
  const text = seedText.trim().toUpperCase();
  const seed = hashString(text);
  const r = new RNG(seed ^ 0x2545f491);
  const heraldry = makeHeraldry(new RNG(seed ^ 0x5bd1e995));
  const map = generateActMap(r.fork('map1'), 1, RUN.stepsPerAct);
  const sovMax = UNITS.sovereign.hp;
  return {
    v: RUN_VERSION, seedText: text, seed, difficulty, faction: 'dawnhold', heraldry,
    rng: r.getState(),
    act: 1, map, pos: null, visited: [], front: 0,
    sov: { hp: sovMax, maxHp: sovMax },
    gold: RUN.startGold,
    relics: [], blueprints: BASE_BLUEPRINTS.slice(), beacons: [],
    next: {}, flags: { seenEvents: [] },
    regionsCleared: 0, embers: 0,
    stats: { kills: 0, regions: 0, nights: 0, relicsFound: 0, built: 0, villagersLost: 0 },
    region: null, outcome: null,
  };
}

export function currentNode(run) { return run.pos ? run.map.nodes[run.pos] : null; }
export function travelOptions(run) { return reachable(run.map, run.pos); }

// ---- Relics, sets and Beacon bonuses -------------------------------------------------
export function ownedSets(run) {
  return RELIC_SETS.map((set) => {
    const n = run.relics.filter((r) => (RELICS[r.id]?.tags || []).includes(set.tag)).length;
    return { ...set, have: n, active: n >= set.count };
  });
}

/** Region modifiers from everything the run owns, plus one-shot event aftermath. */
export function regionMods(run, node) {
  const m = { ...DEFAULT_MODS };
  const add = (mods) => {
    for (const k in mods || {}) {
      if (!(k in m)) continue;
      if (k === 'lightMult') m[k] *= mods[k]; else m[k] += mods[k];
    }
  };
  for (const r of run.relics) add(RELICS[r.id]?.mods);
  for (const set of ownedSets(run)) if (set.active) add(set.mods);
  for (const id of run.beacons) add(BEACONS[id]?.mods);
  add(run.next.mods);
  if (node && node.type === 'cursed') add(RUN.cursed);
  return m;
}

/** One-shot start bonuses for the next region. */
export function regionStart(run) {
  const st = { food: 0, wood: 0, stone: 0, gold: 0, villagers: 0, caches: 0, extraNights: 0 };
  const add = (o) => { for (const k in o || {}) if (k in st && typeof o[k] === 'number') st[k] += o[k]; };
  for (const r of run.relics) add(RELICS[r.id]?.start);
  for (const id of run.beacons) add(BEACONS[id]?.start);
  add(run.next);
  return st;
}

export function grantRelic(run, spec, r) {
  const owned = new Set(run.relics.map((x) => x.id));
  let id = null;
  if (RELICS[spec]) id = owned.has(spec) ? null : spec;
  else {
    const order = { common: ['common', 'rare'], rare: ['rare', 'common', 'legendary'], legendary: ['legendary', 'rare'], cursed: ['cursed'] }[spec] || ['common', 'rare'];
    for (const rar of order) {
      const pool = relicPool(rar).filter((x) => !owned.has(x));
      if (pool.length) { id = r.pick(pool); break; }
    }
  }
  if (!id) return null;
  run.relics.push({ id, used: false });
  run.stats.relicsFound++;
  return id;
}

// ---- Effect language (events, shrines, merchant) ----------------------------------------
const RES_WORD = { food: 'food', wood: 'wood', stone: 'stone', gold: 'gold' };
const MOD_TEXT = {
  farmYield: (v) => `farms ${pct(v)}`, buildSpeed: (v) => `builders ${pct(v)} speed`, chopSpeed: (v) => `gathering ${pct(v)} speed`,
  towerRange: (v) => `towers ${sign(v)} range`, towerDmg: (v) => `tower damage ${pct(v)}`, rangedDmg: (v) => `arrow damage ${pct(v)}`,
  soldierDmg: (v) => `soldier damage ${pct(v)}`, sovDmg: (v) => `Sovereign damage ${pct(v)}`, lightRadius: (v) => `Brazier light ${sign(v)} tiles`,
  lightMult: (v) => `light radius x${v}`, hearthHp: (v) => `Hearth health ${pct(v)}`, hearthDmg: (v) => `Hearth bolts ${sign(v)} damage`,
  wallHp: (v) => `wall health ${pct(v)}`, popPerHouse: (v) => `${sign(v)} pop per House`, goldMult: (v) => `taxes ${pct(v)}`,
  dawnGold: (v) => `${sign(v)} gold each dawn`, interest: (v) => `${Math.round(v * 100)}% gold interest each dawn`, upkeep: (v) => `food upkeep ${pct(v)}`,
  novaDmg: (v) => `Nova damage ${pct(v)}`, novaCd: (v) => `Nova cooldown -${v}s`, bannerDur: (v) => `Banner +${v}s`, bannerCd: (v) => `Banner cooldown -${v}s`,
  enemyHp: (v) => `Hollow health ${pct(v)}`, enemyDmg: (v) => `Hollow damage ${pct(v)}`, enemySpeed: (v) => `Hollow speed ${pct(v)}`,
  waveMult: (v) => `waves ${pct(v)} larger`, draftExtra: (v) => `${sign(v)} draft option`, lootMult: (v) => `loot ${pct(v)}`,
};
function pct(v) { return `${v >= 0 ? '+' : '-'}${Math.round(Math.abs(v) * 100)}%`; }
function sign(v) { return v >= 0 ? `+${v}` : `${v}`; }
export function describeMods(mods) { return Object.entries(mods || {}).map(([k, v]) => (MOD_TEXT[k] ? MOD_TEXT[k](v) : `${k} ${sign(v)}`)); }

export function describeEffects(eff) {
  if (!eff) return 'Nothing happens.';
  const p = [];
  if (eff.gold) p.push(`${sign(eff.gold)} gold`);
  if (eff.sovHeal) p.push('Sovereign fully healed');
  if (eff.sovHp) p.push(`Sovereign ${sign(eff.sovHp)} health`);
  if (eff.sovMaxHp) p.push(`Sovereign ${sign(eff.sovMaxHp)} max health`);
  if (eff.relic) p.push(RELICS[eff.relic] ? `gain ${RELICS[eff.relic].name}` : eff.relic === 'cursed' ? 'gain a CURSED relic' : `gain a ${eff.relic} relic`);
  if (eff.loseRelic) p.push('lose a random relic');
  if (eff.removeCurse) p.push('lift a curse');
  if (eff.embers) p.push(`${sign(eff.embers)} Embers`);
  if (eff.blueprint) p.push(eff.blueprint === 'random' ? 'a new blueprint' : `the ${BUILDINGS[eff.blueprint]?.name || eff.blueprint} blueprint`);
  const n = eff.next;
  if (n) {
    const q = [];
    for (const k of ['food', 'wood', 'stone', 'gold']) if (n[k]) q.push(`${sign(n[k])} ${RES_WORD[k]}`);
    if (n.villagers) q.push(`${sign(n.villagers)} villager${Math.abs(n.villagers) > 1 ? 's' : ''}`);
    if (n.caches) q.push(`${sign(n.caches)} hidden cache${n.caches > 1 ? 's' : ''}`);
    if (n.extraNights) q.push(`${sign(n.extraNights)} night to survive`);
    if (n.raiders) q.push('raiders join the first night');
    q.push(...describeMods(n.mods));
    if (q.length) p.push('next region: ' + q.join(', '));
  }
  if (!p.length) return eff.text || 'Nothing happens.';
  const s = p.join('; ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

/** Apply an effect object to the run. Returns result lines for the player. */
export function applyEffects(run, eff, r) {
  const out = [];
  if (!eff) return out;
  if (eff.gold) { run.gold = Math.max(0, run.gold + eff.gold); out.push(`${sign(eff.gold)} gold`); }
  if (eff.sovMaxHp) { run.sov.maxHp = Math.max(60, run.sov.maxHp + eff.sovMaxHp); if (eff.sovMaxHp > 0) run.sov.hp += eff.sovMaxHp; out.push(`Sovereign ${sign(eff.sovMaxHp)} max health`); }
  if (eff.sovHeal) { run.sov.hp = run.sov.maxHp; out.push('The Sovereign is fully healed'); }
  if (eff.sovHp) { run.sov.hp = Math.max(1, Math.min(run.sov.maxHp, run.sov.hp + eff.sovHp)); out.push(`Sovereign ${sign(eff.sovHp)} health`); }
  run.sov.hp = Math.min(run.sov.hp, run.sov.maxHp);
  if (eff.relic) { const id = grantRelic(run, eff.relic, r); out.push(id ? `Found: ${RELICS[id].name} — ${RELICS[id].text}` : 'You already own every relic of that kind.'); }
  if (eff.loseRelic) {
    const pool = run.relics.filter((x) => RELICS[x.id]?.rarity !== 'cursed');
    if (pool.length) { const lost = r.pick(pool); run.relics.splice(run.relics.indexOf(lost), 1); out.push(`Lost: ${RELICS[lost.id].name}`); }
  }
  if (eff.removeCurse) {
    const c = run.relics.find((x) => RELICS[x.id]?.rarity === 'cursed');
    if (c) { run.relics.splice(run.relics.indexOf(c), 1); out.push(`The curse of ${RELICS[c.id].name} is lifted`); } else out.push('There was no curse to lift');
  }
  if (eff.embers) { run.embers = Math.max(0, run.embers + eff.embers); out.push(`${sign(eff.embers)} Embers`); }
  if (eff.blueprint) {
    const pool = draftPool(run.blueprints);
    const t = eff.blueprint === 'random' ? (pool.length ? r.pick(pool) : null) : eff.blueprint;
    if (t && !run.blueprints.includes(t)) { run.blueprints.push(t); out.push(`New blueprint: ${BUILDINGS[t].name}`); } else out.push('No new blueprints to learn');
  }
  if (eff.next) {
    const n = run.next;
    for (const k of ['food', 'wood', 'stone', 'gold', 'villagers', 'caches', 'extraNights']) if (eff.next[k]) n[k] = (n[k] || 0) + eff.next[k];
    if (eff.next.raiders) n.raiders = true;
    if (eff.next.mods) { n.mods = n.mods || {}; for (const k in eff.next.mods) n.mods[k] = (n.mods[k] || 0) + eff.next.mods[k]; }
    const d = describeEffects({ next: eff.next });
    if (d) out.push(d.replace(/\.$/, ''));
  }
  if (eff.flag) for (const k in eff.flag) { run.flags[k] = eff.flag[k]; run.flags[k + 'At'] = run.regionsCleared; }
  if (eff.text) out.push(eff.text);
  return out;
}

// ---- Blueprints ---------------------------------------------------------------------------
export function draftPool(known) {
  return Object.keys(BUILDINGS).filter((t) => BUILDINGS[t].cat && !known.includes(t));
}

/** Options for a blueprint draft: 3 + faction passive (+1) + mods.draftExtra. */
export function draftOptions(known, r, extra = 0, first = false) {
  const pool = draftPool(known);
  const n = Math.min(pool.length, 3 + 1 + extra);
  const picks = [];
  // The very first draft always offers a way to raise soldiers and to light the night.
  if (first) for (const t of ['barracks', 'brazier']) if (pool.includes(t)) picks.push(t);
  const rest = r.shuffle(pool.filter((t) => !picks.includes(t)));
  while (picks.length < n && rest.length) picks.push(rest.shift());
  return picks;
}

// ---- Node entry ------------------------------------------------------------------------------
/** Move to a node. Returns what the node holds for the UI to present. */
export function enterNode(run, nodeId) {
  const node = run.map.nodes[nodeId];
  if (!node || !travelOptions(run).includes(nodeId)) return null;
  run.pos = nodeId;
  run.visited.push(nodeId);
  run.front = node.step; // the Hollowing swallows everything behind you
  switch (node.type) {
    case 'region': case 'cursed': case 'ruin': case 'boss':
      return { kind: 'region', region: startRegion(run, node) };
    case 'mystery': {
      const ev = withRng(run, (r) => pickEvent(run, r, 'mystery'));
      return ev ? { kind: 'event', event: ev } : { kind: 'event', event: EVENTS.ember_wisp || Object.values(EVENTS)[0] };
    }
    case 'merchant': return { kind: 'merchant', shop: makeShop(run) };
    case 'shrine': return { kind: 'shrine', options: shrineOptions(run) };
    default: return null;
  }
}

/** A chain event waiting to fire now (checked when arriving back on the map). */
export function pendingChainEvent(run) {
  return withRng(run, (r) => pickEvent(run, r, 'chain'));
}

export function resolveEvent(run, ev, i) {
  const c = ev.choices[i];
  if (!c) return null;
  return withRng(run, (r) => {
    run.flags.seenEvents = run.flags.seenEvents || [];
    if (!run.flags.seenEvents.includes(ev.id)) run.flags.seenEvents.push(ev.id);
    const win = c.chance == null || r.chance(c.chance);
    const eff = win ? c.win : c.lose;
    const lines = applyEffects(run, eff, r);
    return { win, lines: lines.length ? lines : ['Nothing more comes of it.'], note: c.note };
  });
}

export function eventView(ev) {
  return {
    title: ev.title, text: ev.text, icon: ev.icon,
    choices: ev.choices.map((c) => ({
      label: c.label, chance: c.chance,
      desc: c.chance != null ? `${Math.round(c.chance * 100)}%: ${describeEffects(c.win)} Otherwise: ${describeEffects(c.lose)}` : describeEffects(c.win),
    })),
  };
}

// ---- Merchant Caravan ----------------------------------------------------------------------------
export function makeShop(run) {
  return withRng(run, (r) => {
    const P = RUN.shopPrice;
    const owned = new Set(run.relics.map((x) => x.id));
    const items = [];
    const rarities = ['common', 'common', 'rare', r.chance(0.35) ? 'legendary' : 'rare'];
    for (const rar of rarities) {
      const pool = relicPool(rar).filter((x) => !owned.has(x) && !items.some((it) => it.id === x));
      if (!pool.length) continue;
      const id = r.pick(pool);
      const R = RELICS[id];
      items.push({ kind: 'relic', id, name: R.name, desc: R.text, icon: R.icon, rarity: rar, price: Math.round(P[rar] * r.float(0.9, 1.1)), sold: false });
    }
    const bp = draftPool(run.blueprints);
    for (const t of r.shuffle(bp.slice()).slice(0, 2)) items.push({ kind: 'blueprint', id: t, name: `${BUILDINGS[t].name} blueprint`, desc: BUILDINGS[t].desc, icon: 'book', price: P.blueprint, sold: false });
    items.push({ kind: 'heal', name: 'Hearthroot Draught', desc: 'Restore the Sovereign to full health.', icon: 'crown', price: P.heal, sold: false });
    items.push({ kind: 'supplies', name: 'Supply Wagon', desc: 'Next region: +60 wood, +40 stone, +40 food.', icon: 'wood', price: P.supplies, sold: false });
    if (run.relics.some((x) => RELICS[x.id]?.rarity === 'cursed')) items.push({ kind: 'uncurse', name: 'Hedge-witch Ritual', desc: 'Lift one curse (remove a cursed relic).', icon: 'flame', price: P.uncurse, sold: false });
    return { items };
  });
}

export function buyItem(run, shop, i) {
  const it = shop.items[i];
  if (!it || it.sold) return { ok: false, msg: 'Sold out.' };
  if (run.gold < it.price) return { ok: false, msg: 'Not enough gold.' };
  if (it.kind === 'heal' && run.sov.hp >= run.sov.maxHp) return { ok: false, msg: 'The Sovereign is already at full health.' };
  run.gold -= it.price;
  it.sold = true;
  switch (it.kind) {
    case 'relic': run.relics.push({ id: it.id, used: false }); run.stats.relicsFound++; break;
    case 'blueprint': if (!run.blueprints.includes(it.id)) run.blueprints.push(it.id); break;
    case 'heal': run.sov.hp = run.sov.maxHp; break;
    case 'supplies': withRng(run, (r) => applyEffects(run, { next: { wood: 60, stone: 40, food: 40 } }, r)); break;
    case 'uncurse': withRng(run, (r) => applyEffects(run, { removeCurse: true }, r)); break;
  }
  return { ok: true, msg: `Bought ${it.name}.` };
}

// ---- Shrine -------------------------------------------------------------------------------------
export const WHEEL = [
  { label: 'A rare relic', p: 0.4, color: '#e0a23a', eff: { relic: 'rare' } },
  { label: '+45 gold', p: 0.35, color: '#8fd16a', eff: { gold: 45 } },
  { label: 'A cursed relic', p: 0.25, color: '#8a5ab8', eff: { relic: 'cursed' } },
];
export function shrineOptions(run) {
  return [
    { id: 'heal', title: 'Rest at the Spring', text: `Restore the Sovereign to full health (now ${Math.ceil(run.sov.hp)}/${run.sov.maxHp}).`, icon: 'crown' },
    { id: 'bless', title: 'Kneel for a Blessing', text: 'The next region: Hearth +30% health and builders +20% speed.', icon: 'flame' },
    { id: 'gamble', title: 'Turn the Wheel', text: 'Spin the Wheel of Fortune.', icon: 'dice', odds: WHEEL.map((w) => ({ label: w.label, p: w.p })) },
  ];
}
/** Returns { lines, wheelIndex? }. */
export function resolveShrine(run, id) {
  return withRng(run, (r) => {
    if (id === 'heal') return { lines: applyEffects(run, { sovHeal: true }, r) };
    if (id === 'bless') return { lines: applyEffects(run, { next: { mods: { hearthHp: 0.3, buildSpeed: 0.2 } } }, r) };
    const w = r.weighted(WHEEL, (x) => x.p);
    const wheelIndex = WHEEL.indexOf(w);
    return { lines: applyEffects(run, w.eff, r), wheelIndex };
  });
}

// ---- Regions ---------------------------------------------------------------------------------------
export function startRegion(run, node) {
  const mods = regionMods(run, node);
  const st = regionStart(run);
  const objective = withRng(run, (r) => makeObjective(r, node.objectiveType || (node.type === 'boss' ? 'boss' : 'survive'), node.step, node.type));
  if (objective.type === 'survive' && st.extraNights) objective.nights += st.extraNights;
  const sovHeal = Math.round(run.sov.maxHp * 0.3); // a short rest on the road
  const s = createRegion({
    seedText: `${run.seedText}/${node.id}`, difficulty: run.difficulty, heraldry: run.heraldry,
    biome: node.biome || 'greenvale', nodeType: node.type, step: node.step, act: run.act,
    mods, start: st, gold: run.gold, raiders: !!run.next.raiders,
    sov: { hp: Math.min(run.sov.maxHp, run.sov.hp + sovHeal), maxHp: run.sov.maxHp },
    relics: run.relics.map((x) => ({ ...x })), blueprints: run.blueprints.slice(),
    objective, firstDraft: run.regionsCleared === 0,
  });
  run.next = {}; // one-shot bonuses are spent
  run.region = s;
  return s;
}

export function regionEmbers(s, result) {
  const E = RUN.embers;
  const lootMult = 1 + (s.mods.lootMult || 0);
  if (result !== 'victory') return Math.round(s.cycle.night * E.perNight * E.lossShare);
  let e = (E[s.nodeType] || E.region) + s.cycle.night * E.perNight;
  for (let i = 0; i < (s.bonusNights || 0); i++) e += Math.round(E.perBonusNight * Math.pow(E.bonusGrowth, i));
  return Math.round(e * lootMult);
}

/** Fold a finished region back into the run. Returns a summary for the UI. */
export function finishRegion(run, s) {
  const result = s.outcome ? s.outcome.result : 'defeat';
  const embers = regionEmbers(s, result);
  run.embers += embers;
  run.gold = Math.max(0, Math.floor(s.res.gold));
  if (s.sovereign) { run.sov.hp = Math.max(1, Math.ceil(s.sovereign.hp)); run.sov.maxHp = s.sovereign.maxHp; }
  for (const r of s.relics || []) { const o = run.relics.find((x) => x.id === r.id); if (o) o.used = r.used; }
  run.blueprints = (s.blueprints || run.blueprints).slice();
  run.stats.kills += s.stats.kills; run.stats.nights += s.cycle.night;
  run.stats.built += s.stats.built; run.stats.villagersLost += s.stats.villagersLost;
  run.region = null;
  let loot = [];
  if (result === 'victory') {
    run.regionsCleared++; run.stats.regions++;
    // Ruins and cursed regions pay out a relic.
    if (s.nodeType === 'ruin' || s.nodeType === 'cursed') {
      loot = withRng(run, (r) => applyEffects(run, { relic: s.nodeType === 'cursed' ? (r.chance(0.35) ? 'legendary' : 'rare') : 'common' }, r));
    }
    if (s.nodeType === 'boss') run.outcome = { result: 'victory', reason: s.outcome.reason };
  } else run.outcome = { result: 'defeat', reason: s.outcome ? s.outcome.reason : 'The realm is lost.' };
  return { result, embers, loot, nodeType: s.nodeType, nights: s.cycle.night, kills: s.stats.kills };
}

export function beaconOptions(run) {
  return withRng(run, (r) => {
    const pool = Object.values(BEACONS).filter((b) => b.stackable || !run.beacons.includes(b.id));
    return r.shuffle(pool.slice()).slice(0, 3).map((b) => b.id);
  });
}
export function takeBeacon(run, id) { if (BEACONS[id]) run.beacons.push(id); }

// ---- Summaries -------------------------------------------------------------------------------------
/** Embers banked at the end of the run (difficulty-scaled). */
export function bankedEmbers(run) {
  return Math.round(run.embers * BAL.difficulty[run.difficulty].emberMult);
}

export function relicViews(run) {
  return run.relics.map((x) => {
    const R = RELICS[x.id] || { name: x.id, rarity: 'common', text: '', icon: 'info' };
    return { id: x.id, name: R.name, rarity: R.rarity, rarityLabel: RARITIES[R.rarity]?.label || R.rarity, color: RARITIES[R.rarity]?.color || '#ccc', text: R.text, icon: R.icon, used: x.used };
  });
}

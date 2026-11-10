// The Book of Decrees: one-way laws signed at every 3rd dawn and kept for the rest
// of the run. js/game/systems/mood.js implements every effect listed here.
//
// Shape: { id, name, branch: 'flame'|'iron'|'neutral', tier: 1|2|3, text,
//   mods?:   additive DEFAULT_MODS keys (applied to the region at once and to every later region),
//   mood?:   { baseMorale (+level Morale settles toward), dreadPerDawn (extra Dread lost each dawn),
//              dropMult (x Morale losses), dreadMult (x Dread gains) },
//   oneShot?:{ morale, dread, gold, food } applied once, when signed,
//   fx?:     effects mood.js runs through BUS (see FX_KEYS below),
//   requires?: [ids] (all must be signed), excludes?: [ids] (none may be signed) }
// `text` lists the non-mood effects; moodLines(def) spells out the Morale/Dread ones,
// so what the Book shows always matches the data.
//
// fx keys: workMult (x work speed), goldMult (x taxes and market income), costMult {res: x},
//   moraleFloor (Morale never below), heroDmg (x hero damage), heroLoss (x Morale/Dread from a
//   hero's death), nightGuard (x damage villagers take at dusk/night), deathDread / deathMorale
//   (x Dread / Morale from deaths), pilgrims, conscript, festChance (x festival chance),
//   festDread (Dread lost per festival), duskMorale / duskDread (each dusk).

export const BRANCHES = {
  flame: { id: 'flame', name: 'Path of the Flame', sub: 'Hope and faith', color: '#f0b050', icon: 'flame' },
  iron: { id: 'iron', name: 'Path of the Iron Crown', sub: 'Order and control', color: '#a8b0c0', icon: 'shield' },
  neutral: { id: 'neutral', name: 'Laws of the Realm', sub: 'Either path', color: '#cdbb98', icon: 'book' },
};

export const DECREES = {
  // ---- Path of the Flame ------------------------------------------------------------------
  lantern: {
    id: 'lantern', name: 'Lantern Vigils', branch: 'flame', tier: 1,
    text: 'Braziers shine 1 tile farther.',
    mods: { lightRadius: 1 }, mood: { dreadPerDawn: 1 },
  },
  pilgrims: {
    id: 'pilgrims', name: 'Welcome the Pilgrims', branch: 'flame', tier: 1,
    text: 'Each dawn while Morale is 50 or more, a pilgrim settles if a House has room. Food upkeep +10%.',
    mods: { upkeep: 0.1 }, fx: { pilgrims: true },
  },
  hymns: {
    id: 'hymns', name: 'Hymns at Dusk', branch: 'flame', tier: 1,
    text: 'The realm sings as the light fails.',
    fx: { duskMorale: 2, duskDread: -2 },
  },
  hearth: {
    id: 'hearth', name: 'Sacred Hearth', branch: 'flame', tier: 2, requires: ['lantern'],
    text: 'Hearth health +25% and its ember-bolts deal +4 damage.',
    mods: { hearthHp: 0.25, hearthDmg: 4 }, mood: { baseMorale: 5 },
  },
  saints: {
    id: 'saints', name: "Saints' Day", branch: 'flame', tier: 2, requires: ['hymns'],
    text: 'Festivals are 50% more likely, and each festival lowers Dread by 5.',
    oneShot: { morale: 12 }, fx: { festChance: 1.5, festDread: 5 },
  },
  undying: {
    id: 'undying', name: 'The Undying Flame', branch: 'flame', tier: 3, requires: ['hearth'],
    text: 'Heartflame Nova deals +25% damage.',
    mods: { novaDmg: 0.25 }, mood: { dreadMult: 0.75 }, oneShot: { dread: -15 },
  },
  covenant: {
    id: 'covenant', name: 'Dawnsong Covenant', branch: 'flame', tier: 3, requires: ['saints'],
    text: 'The faithful bear hardship together.',
    mood: { baseMorale: 10, dropMult: 0.8 }, oneShot: { dread: -10 },
  },

  // ---- Path of the Iron Crown ---------------------------------------------------------------
  curfew: {
    id: 'curfew', name: 'Night Curfew', branch: 'iron', tier: 1,
    text: 'Villagers take 50% less damage at dusk and at night.',
    mood: { baseMorale: -5, dreadPerDawn: 1 }, fx: { nightGuard: 0.5 },
  },
  conscription: {
    id: 'conscription', name: 'Conscription', branch: 'iron', tier: 1,
    text: 'Each dawn, one free Militia joins a Barracks squad that has room.',
    mood: { baseMorale: -3 }, oneShot: { morale: -5 }, fx: { conscript: true },
  },
  rationing: {
    id: 'rationing', name: 'Strict Rationing', branch: 'iron', tier: 1, excludes: ['rations'],
    text: 'Food upkeep -20%. Cannot stand beside Double Rations.',
    mods: { upkeep: -0.2 }, mood: { baseMorale: -5 }, oneShot: { morale: -5 },
  },
  forced: {
    id: 'forced', name: 'Forced Labor', branch: 'iron', tier: 2, requires: ['curfew'],
    text: 'Work +20%: building, repairs, farming, felling and quarrying.',
    mood: { baseMorale: -10 }, oneShot: { morale: -15 }, fx: { workMult: 1.2 },
  },
  watch: {
    id: 'watch', name: "Watchmen's Oath", branch: 'iron', tier: 2, requires: ['conscription'],
    text: 'Watchtowers and Ballistae +1 range; Watchtowers, Ballistae and Mage Spires +10% damage. House taxes and Market income -10%.',
    mods: { towerRange: 1, towerDmg: 0.1 }, fx: { goldMult: 0.9 },
  },
  martial: {
    id: 'martial', name: 'Martial Law', branch: 'iron', tier: 3, requires: ['forced'],
    text: 'Morale can never fall below 35, so no one deserts or riots. Soldiers deal +15% damage.',
    mods: { soldierDmg: 0.15 }, mood: { baseMorale: -10 }, oneShot: { dread: 10 }, fx: { moraleFloor: 35 },
  },
  stone: {
    id: 'stone', name: 'Edict of Stone', branch: 'iron', tier: 3, requires: ['watch'],
    text: 'Walls and Gates +40% health. Buildings cost 15% less wood.',
    mods: { wallHp: 0.4 }, oneShot: { dread: 8 }, fx: { costMult: { wood: 0.85 } },
  },

  // ---- Neutral ---------------------------------------------------------------------------------
  rations: {
    id: 'rations', name: 'Double Rations', branch: 'neutral', tier: 1, excludes: ['rationing'],
    text: 'Food upkeep +40%. Cannot stand beside Strict Rationing.',
    mods: { upkeep: 0.4 }, mood: { baseMorale: 8 }, oneShot: { morale: 10 },
  },
  tithe: {
    id: 'tithe', name: 'Tithe of Gold', branch: 'neutral', tier: 1,
    text: '+60 gold now. House taxes and Market income +25%.',
    mods: { goldMult: 0.25 }, mood: { baseMorale: -6 }, oneShot: { gold: 60, morale: -5 },
  },
  charter: {
    id: 'charter', name: "Heroes' Charter", branch: 'neutral', tier: 2,
    text: 'Heroes deal +15% damage. A hero’s death costs half the usual Morale and Dread.',
    oneShot: { morale: 5 }, fx: { heroDmg: 1.15, heroLoss: 0.5 },
  },
  burn: {
    id: 'burn', name: 'Burn the Dead', branch: 'neutral', tier: 1, excludes: ['graves'],
    text: 'Deaths raise 50% less Dread. Forbids Hallowed Graves.',
    oneShot: { morale: -8 }, fx: { deathDread: 0.5 },
  },
  graves: {
    id: 'graves', name: 'Hallowed Graves', branch: 'neutral', tier: 1, excludes: ['burn'],
    text: 'Deaths cost 50% less Morale. Forbids Burn the Dead.',
    mood: { baseMorale: 4 }, oneShot: { dread: 5 }, fx: { deathMorale: 0.5 },
  },
};

export const DECREE_ORDER = Object.keys(DECREES);
export const TIER_LABEL = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III' };

const sign = (v) => (v > 0 ? '+' : '') + v;
const pct = (m) => Math.round(Math.abs(1 - m) * 100);

/** The Morale/Dread effects of a decree, as exact readable lines. */
export function moodLines(def) {
  const out = [];
  const o = def.oneShot || {}, m = def.mood || {}, f = def.fx || {};
  if (o.morale) out.push({ k: 'morale', good: o.morale > 0, text: `Morale ${sign(o.morale)} now` });
  if (o.dread) out.push({ k: 'dread', good: o.dread < 0, text: `Dread ${sign(o.dread)} now` });
  if (m.baseMorale) out.push({ k: 'morale', good: m.baseMorale > 0, text: `Morale settles ${Math.abs(m.baseMorale)} ${m.baseMorale > 0 ? 'higher' : 'lower'}` });
  if (m.dropMult) out.push({ k: 'morale', good: m.dropMult < 1, text: `Morale falls ${pct(m.dropMult)}% ${m.dropMult < 1 ? 'slower' : 'faster'}` });
  if (m.dreadMult) out.push({ k: 'dread', good: m.dreadMult < 1, text: `Dread rises ${pct(m.dreadMult)}% ${m.dreadMult < 1 ? 'slower' : 'faster'}` });
  if (m.dreadPerDawn) out.push({ k: 'dread', good: m.dreadPerDawn > 0, text: `Dread falls ${m.dreadPerDawn} more each dawn` });
  if (f.duskMorale) out.push({ k: 'morale', good: f.duskMorale > 0, text: `Morale ${sign(f.duskMorale)} each dusk` });
  if (f.duskDread) out.push({ k: 'dread', good: f.duskDread < 0, text: `Dread ${sign(f.duskDread)} each dusk` });
  return out;
}

/** Full readable effect text (non-mood text plus the Morale/Dread lines). */
export function decreeText(def) {
  const lines = moodLines(def).map((l) => l.text);
  if (def.oneShot && def.oneShot.food) lines.unshift(`+${def.oneShot.food} food now`);
  return [String(def.text || '').replace(/\.$/, ''), ...lines].filter(Boolean).join('. ') + '.';
}

/**
 * Whether `id` can be signed given the signed list.
 * Returns { state: 'signed'|'available'|'locked', reason }.
 * Rules: excludes (both directions); taking a tier-3 decree in Flame or Iron locks the other
 * branch's remaining decrees; every id in `requires` must be signed.
 */
export function decreeStatus(signed, id) {
  const def = DECREES[id];
  if (!def) return { state: 'locked', reason: 'Unknown decree' };
  if (signed.includes(id)) return { state: 'signed', reason: 'Signed' };
  for (const o of signed) {
    const od = DECREES[o];
    if (!od) continue;
    if ((def.excludes && def.excludes.includes(o)) || (od.excludes && od.excludes.includes(id))) return { state: 'locked', reason: `Forbidden by ${od.name}` };
  }
  if (def.branch !== 'neutral') {
    const other = def.branch === 'flame' ? 'iron' : 'flame';
    const t3 = signed.find((o) => DECREES[o] && DECREES[o].branch === other && DECREES[o].tier === 3);
    if (t3) return { state: 'locked', reason: `${BRANCHES[other].name} was chosen (${DECREES[t3].name})` };
  }
  for (const r of def.requires || []) if (!signed.includes(r)) return { state: 'locked', reason: `Requires ${DECREES[r] ? DECREES[r].name : r}` };
  return { state: 'available', reason: '' };
}

/** Ids that may be signed now, in Book order. */
export function availableDecrees(signed) {
  return DECREE_ORDER.filter((id) => decreeStatus(signed, id).state === 'available');
}

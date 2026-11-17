// ============================================================================
// ZONEFALL — extra guns: Ratchet Crossbow, Longreach Sniper, Ridgeback Carbine,
// Thresher LMG and the Nailgun (+ its Nails ammo). Data, recipes, blueprints,
// loot, NPC loadouts and 16x16 inventory icons. The first-person models,
// grips, sights and reload animations live in fp/viewmodel.js (ITEM table) and
// the shared held models in gfx/models_chars.js (HELD / HELD_INFO).
//
//   registerWeaponsData({ ITEMS, WEAPONS, RECIPES, RECIPE, LOOT, ENEMIES,
//                         BP_BY_TIER?, RECYCLE?, SHOPS? })   once, at the end of data.js (idempotent)
//   registerWeaponsIcons(ART?)   pixel icons for the new ids (wraps ART.icon / ART.iconURL)
//
// Imports nothing, so data.js can import it without a cycle. BP_BY_TIER is
// optional but needed for the new blueprints to show up in random
// "bp_t2" / "bp_t3" loot rolls; RECYCLE and SHOPS are optional extras.
//
// WEAPONS fields beyond the usual ones (read by nothing in the core yet):
//   kick   camera kick per shot in radians (player.js RECOIL has no entry for
//          these ids, so it uses its 0.015 default until it reads W.kick)
//   scope  2 = high-power scope (the viewmodel draws it and narrows the FOV itself)
// ============================================================================

export const WEAPON_IDS = ['crossbow', 'nailgun', 'semi_rifle', 'sniper', 'lmg'];

export const WX_ITEMS = {
  nails: { name: 'Nails', cat: 'ammo', col: '#a9b0b8', stack: 128, val: 0.4, desc: 'Nailgun ammo. Quick to make from metal fragments.' },
  crossbow: { name: 'Ratchet Crossbow', cat: 'gun', col: '#8a5a32', stack: 1, val: 70, rar: 'uncommon', desc: 'Fires wooden arrows harder and flatter than a bow. Cranking the string back takes a while, so make the shot count.' },
  nailgun: { name: 'Nailgun', cat: 'gun', col: '#e0a43a', stack: 1, val: 55, desc: 'A rewired construction nailer. Quiet and quick, but nails lose their bite after a few metres.' },
  semi_rifle: { name: 'Ridgeback Carbine', cat: 'gun', col: '#9a5a2e', stack: 1, val: 280, rar: 'rare', desc: 'Semi-automatic rifle: one shot per tap from a 16-round magazine. Accurate with a moderate kick.' },
  sniper: { name: 'Longreach Sniper', cat: 'gun', col: '#8f8458', stack: 1, val: 540, rar: 'epic', desc: 'Heavy bolt-action rifle with a high-power scope. Work the bolt after every shot.' },
  lmg: { name: 'Thresher LMG', cat: 'gun', col: '#4f5638', stack: 1, val: 580, rar: 'epic', desc: 'Box-fed machine gun with a 60-round belt. Kicks hard and takes an age to reload.' },
};

// ranges in metres, projectile speed m/s, noise = alert radius m (see WEAPONS in data.js)
export const WX_WEAPONS = {
  crossbow: { dmg: 62, rof: 1.0, mag: 1, reload: 2.3, spread: 0.02, speed: 64, range: 40, ammo: 'arrow', pen: 0.2, noise: 8, sfx: 'bow', arrow: true, kick: 0.02 },
  nailgun: { dmg: 10, rof: 6.5, mag: 32, reload: 2.1, spread: 0.065, speed: 80, range: 16, ammo: 'nails', pen: 0.05, noise: 12, sfx: 'turret', auto: true, kick: 0.006 },
  semi_rifle: { dmg: 38, rof: 3.6, mag: 16, reload: 2.6, spread: 0.028, speed: 195, range: 46, ammo: 'rifle_ammo', alt: 'ap_ammo', pen: 0.5, noise: 56, sfx: 'rifle', kick: 0.022 },
  sniper: { dmg: 125, rof: 0.6, mag: 5, reload: 3.8, spread: 0.004, speed: 320, range: 90, ammo: 'rifle_ammo', alt: 'ap_ammo', pen: 0.75, noise: 75, sfx: 'sniper', scope: 2, kick: 0.075 },
  lmg: { dmg: 24, rof: 10, mag: 60, reload: 5.2, spread: 0.075, speed: 175, range: 42, ammo: 'rifle_ammo', alt: 'ap_ammo', pen: 0.45, noise: 64, sfx: 'rifle', auto: true, kick: 0.016 },
};

// wb = workbench tier, bp = needs a blueprint (inserted after the last recipe of the same tier)
export const WX_RECIPES = [
  { id: 'nails', out: 'nails', n: 20, cost: { metal: 15 }, wb: 1 },
  { id: 'nailgun', out: 'nailgun', n: 1, cost: { metal: 100, gears: 1, pipe: 1, tape: 1 }, wb: 1 },
  { id: 'crossbow', out: 'crossbow', n: 1, cost: { wood: 120, metal: 60, rope: 2, gears: 1 }, wb: 1 },
  { id: 'semi_rifle', out: 'semi_rifle', n: 1, cost: { metal: 220, hqm: 6, spring: 1, pipe: 1 }, wb: 2, bp: true },
  { id: 'sniper', out: 'sniper', n: 1, cost: { hqm: 25, metal: 180, pipe: 2, spring: 2 }, wb: 3, bp: true },
  { id: 'lmg', out: 'lmg', n: 1, cost: { hqm: 40, metal: 300, spring: 2, gears: 3 }, wb: 3, bp: true },
];

// [table, id, weight, min, max]
const WX_LOOT = [
  ['barrel', 'nails', 2, 6, 14], ['crate', 'nails', 2.5, 8, 20], ['toolbox', 'nails', 3, 10, 24], ['raider', 'nails', 2, 6, 14], ['human1', 'nails', 1.5, 5, 12],
  ['crate', 'nailgun', 0.7, 1, 1], ['toolbox', 'nailgun', 1.0, 1, 1],
  ['crate', 'crossbow', 0.45, 1, 1], ['ammobox', 'crossbow', 0.5, 1, 1], ['cache', 'crossbow', 0.5, 1, 1],
  ['military', 'semi_rifle', 0.8, 1, 1], ['airdrop', 'semi_rifle', 1.5, 1, 1], ['cargo', 'semi_rifle', 1.2, 1, 1],
  ['military', 'bp_semi_rifle', 0.5, 1, 1], ['elite', 'bp_semi_rifle', 0.4, 1, 1],
  ['elite', 'sniper', 0.5, 1, 1], ['airdrop', 'sniper', 0.8, 1, 1], ['cargo', 'sniper', 1.0, 1, 1],
  ['elite', 'bp_sniper', 0.45, 1, 1], ['cargo', 'bp_sniper', 0.6, 1, 1],
  ['elite', 'lmg', 0.45, 1, 1], ['military', 'lmg', 0.12, 1, 1],   // the LMG itself only comes from these crates (or crafting)
  ['elite', 'bp_lmg', 0.4, 1, 1], ['cargo', 'bp_lmg', 0.5, 1, 1],
];

// extra guns in NPC loadouts (one entry each, so they stay the odd one out)
const WX_ENEMY_GUNS = { scav: ['nailgun'], gunner: ['nailgun'], bandit: ['crossbow'], soldier: ['semi_rifle'], deckhand: ['semi_rifle'], hazguard: ['lmg'] };

const WX_RECYCLE = {
  crossbow: { wood: 30, metal: 20, rope: 1 }, nailgun: { metal: 30, gears: 1 }, semi_rifle: { metal: 70, hqm: 2, spring: 1 },
  sniper: { metal: 60, hqm: 8, spring: 1 }, lmg: { metal: 100, hqm: 12, spring: 1, gears: 1 },
};
// [shop, id, n, price]
const WX_SHOP = [['arms', 'nails', 30, 12], ['arms', 'crossbow', 1, 160]];

function bpItem(ITEMS, r) {
  const out = ITEMS[r.out];
  return { name: 'Blueprint: ' + (out ? out.name : r.out), cat: 'bp', col: '#4a8ad8', stack: 1, val: 30 + r.wb * 60, rar: r.wb >= 3 ? 'epic' : r.wb === 2 ? 'rare' : 'uncommon', teach: r.id };
}

/** Adds the new guns, ammo, recipes, blueprints, loot and NPC loadouts to the game's data tables. Safe to call twice. */
export function registerWeaponsData({ ITEMS, WEAPONS, RECIPES, RECIPE, LOOT, ENEMIES, BP_BY_TIER, RECYCLE, SHOPS } = {}) {
  const out = { items: 0, weapons: 0, recipes: 0, bps: 0, loot: 0, npc: 0 };
  if (ITEMS) for (const id in WX_ITEMS) if (!ITEMS[id]) { ITEMS[id] = Object.assign({}, WX_ITEMS[id]); out.items++; }
  if (WEAPONS) for (const id in WX_WEAPONS) if (!WEAPONS[id]) { WEAPONS[id] = Object.assign({}, WX_WEAPONS[id]); out.weapons++; }
  if (Array.isArray(RECIPE) && !RECIPES) { RECIPES = RECIPE; RECIPE = null; }   // tolerate the list passed as RECIPE
  for (const r of WX_RECIPES) {
    let rec = (RECIPES && RECIPES.find(q => q.id === r.id)) || (RECIPE && RECIPE[r.id]) || null;
    if (!rec) rec = Object.assign({}, r, { cost: Object.assign({}, r.cost) });
    if (RECIPES && !RECIPES.includes(rec)) {
      // keep the crafting list ordered by workbench tier: after the last recipe of the same tier
      let at = -1; for (let i = 0; i < RECIPES.length; i++) if ((RECIPES[i].wb || 0) === r.wb) at = i;
      if (at < 0) RECIPES.push(rec); else RECIPES.splice(at + 1, 0, rec);
      out.recipes++;
    }
    if (RECIPE && !RECIPE[r.id]) RECIPE[r.id] = rec;
    if (rec.bp) {
      const bid = 'bp_' + rec.id;
      if (ITEMS && !ITEMS[bid]) { ITEMS[bid] = bpItem(ITEMS, rec); out.bps++; }
      if (BP_BY_TIER && BP_BY_TIER[rec.wb] && !BP_BY_TIER[rec.wb].includes(bid)) BP_BY_TIER[rec.wb].push(bid);
    }
  }
  if (LOOT) for (const [t, id, w, a, b] of WX_LOOT) { const T = LOOT[t]; if (T && T.items && !T.items.some(e => e[0] === id)) { T.items.push([id, w, a, b]); out.loot++; } }
  if (ENEMIES) for (const k in WX_ENEMY_GUNS) { const E = ENEMIES[k]; if (!E || !Array.isArray(E.guns)) continue; for (const g of WX_ENEMY_GUNS[k]) if (!E.guns.includes(g)) { E.guns.push(g); out.npc++; } }
  if (RECYCLE) for (const id in WX_RECYCLE) if (!RECYCLE[id]) RECYCLE[id] = Object.assign({}, WX_RECYCLE[id]);
  if (SHOPS) for (const [s, id, n, price] of WX_SHOP) { const S = SHOPS[s]; if (S && S.stock && !S.stock.some(e => e[0] === id)) S.stock.push([id, n, price]); }
  return out;
}

// ============================================================================
// ICONS — 16x16 pixel art in the style of js/art_icons.js (side views pointing
// right, light from the top-left, 1px dark outline). Digits 1-5 are a ramp of the
// item colour; letters are fixed palette colours.
// ============================================================================
const OUTC = '#181425', HI = '#fff4d6', LO = '#1a1530';
const FIXP = {
  o: OUTC, k: '#262b44', h: '#ffffff', s: '#c0cbdc', m: '#8b9bb4', n: '#5a6988', N: '#3a4466',
  w: '#e4a672', W: '#b86f50', v: '#733e39', V: '#3e2731', p: '#ead4aa', q: '#d2a684',
  y: '#fee761', g: '#feae34', u: '#d77643', t: '#be4a2f', r: '#e43b44', R: '#a22633',
  l: '#63c74d', L: '#3e8948', D: '#265c42', b: '#0099db', c: '#2ce8f5',
  a: '#c9ccd1', A: '#9ea3a9', X: '#6c7178', Z: '#45484f',
  Y: '#f0cf7a', H: '#d0a84a', I: '#97702e', U: '#5e4220',
};
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function mixHex(a, b, t) { const A = hexRgb(a), B = hexRgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
function rampOf(col) { return { 1: mixHex(col, HI, 0.55), 2: mixHex(col, HI, 0.25), 3: col, 4: mixHex(col, LO, 0.36), 5: mixHex(col, LO, 0.6) }; }

const ICONS = {
  // top-down: wooden stock and rail, steel prod across the front, string drawn back to the latch, an arrow on the rail
  crossbow: {
    col: '#a06a3a', extra: { M: '#3a4466' }, rows: [
      '..........kN..',
      '.........hmN..',
      '........h..mn.',
      '.......h...mn.',
      'VW....h....mn.',
      'v322222222tMNk',
      'v4pppppppppMsh',
      'v433333333tMNk',
      'VW....h....mn.',
      '.......h...mn.',
      '........h..mn.',
      '.........hmN..',
      '..........kN..',
    ],
  },
  // battery construction nailer: yellow housing, black grip and battery, nail magazine angled under the nose
  nailgun: {
    col: '#e8a832', rows: [
      '.22222222222..',
      '.21111111122k.',
      '.23333333333kN',
      '..44kkkk3344kN',
      '....kkk.3444Ns',
      '....kko..44Nsm',
      '....kk...nmmn.',
      '...kkk.nmmn...',
      '.XXXAXXmn.....',
      '.ZZZZZZ.......',
    ],
  },
  // full wooden stock, blued receiver, short box magazine, peep rear sight and hooded front post
  semi_rifle: {
    col: '#a8642e', rows: [
      '.....n......N.',
      '....NmmN....N.',
      '2...NnnNssssss',
      '3222NnnN2222nN',
      '33334NNk3334..',
      '334.oNk.......',
      '345..Nk.......',
      '.45...........',
    ],
  },
  // khaki stock, big scope with a wide objective bell, long barrel with a muzzle brake, folded bipod
  sniper: {
    col: '#9a8e5e', rows: [
      '..kN......kNNk',
      '..NmssssssmmmN',
      '..kNnnnnnnNNNk',
      '22...N..N.....',
      '3222NNmsssssNN',
      '3333NnnnnnnnNk',
      '344.oNN.mmmm..',
      '345..NN.......',
      '.45...........',
    ],
  },
  // olive receiver with a carry handle, perforated barrel shroud, ammo box with a brass belt, bipod legs
  lmg: {
    col: '#5e6842', rows: [
      '......kNNk....',
      '......N..N....',
      'XX.222222NNNNk',
      'XXZ311113sNsNN',
      'XXZ344444NNNNk',
      'ZZ.ko2222.n.n.',
      '...kY3113.n.n.',
      '....H4444.n.n.',
      '.....5555.....',
    ],
  },
  // a strip of collated nails with a red paper band
  nails: {
    col: '#a9b0b8', rows: [
      'hss.hss.hss',
      'mmn.mmn.mmn',
      '.m...m...m.',
      'rrrrrrrrrrr',
      'RRRRRRRRRRR',
      '.m...m...m.',
      '.m...m...m.',
      '.n...n...n.',
      '.n...n...n.',
      '.N...N...N.',
    ],
  },
};

let iconCache = null;
/** 16x16 canvas for one of the new ids (null for other ids) */
export function weaponIcon(id) {
  const spec = ICONS[id]; if (!spec || typeof document === 'undefined') return null;
  iconCache = iconCache || {};
  if (iconCache[id]) return iconCache[id];
  const pal = Object.assign({}, FIXP, rampOf(spec.col), spec.extra || {});
  const rows = spec.rows, h = Math.min(14, rows.length), w = Math.min(14, Math.max(...rows.map(r => r.length)));
  const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  const ox = Math.floor((16 - w) / 2), oy = Math.floor((16 - h + 1) / 2);
  for (let j = 0; j < h; j++) for (let i = 0; i < w && i < rows[j].length; i++) {
    const ch = rows[j][i]; if (ch === '.' || ch === ' ') continue; const col = pal[ch]; if (!col) continue;
    g.fillStyle = col; g.fillRect(ox + i, oy + j, 1, 1);
  }
  // 1px dark outline around the opaque pixels
  const d = g.getImageData(0, 0, 16, 16).data, on = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && d[(y * 16 + x) * 4 + 3] > 0;
  g.fillStyle = OUTC;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (!on(x, y) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1))) g.fillRect(x, y, 1, 1);
  return (iconCache[id] = c);
}

/** Route ART.icon / ART.iconURL for the new gun and ammo ids to the icons above. Returns true if installed. */
export function registerWeaponsIcons(A) {
  A = A || (typeof window !== 'undefined' ? window.ART : null);
  if (!A || !A.iconURL || A._weaponsExtra) return false;
  const baseURL = A.iconURL, baseIcon = A.icon, urls = {};
  A.icon = id => (ICONS[id] && weaponIcon(id)) || (baseIcon ? baseIcon(id) : null);
  A.iconURL = id => {
    if (!ICONS[id]) return baseURL(id);
    if (!urls[id]) { try { const c = weaponIcon(id); urls[id] = c ? c.toDataURL() : baseURL(id); } catch (e) { urls[id] = baseURL(id); } }
    return urls[id];
  };
  A._weaponsExtra = true;
  return true;
}

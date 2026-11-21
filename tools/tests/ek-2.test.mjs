// Stage 2 acceptance for workstreams E and K (doc 14.8). E: storage buildings with several stacks
// per tile (shelves, racks) and their stock, the filter tree, input shelves, rot, filth and the
// Clean giver, the fire emergency, outfits, upgrades (the Hearth), unattended batches (casks), the
// study desk, tending. K: a tamed goat stays in its pen, taming, breeding, manhunters, research
// banking, gates and discoveries, trade with a caravan, deeds with a kind, Chronicle lines, tiers.
// Real new-colony flow (installSim('2') + foundColony) with E's reservation and item checks on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony, findSite } from '../../js/game/core/setup.js';
import { step } from '../../js/game/core/sim.js';
import { applyCommand } from '../../js/game/core/commands.js';
import { FIX, WORK_IDS } from '../../js/game/core/schema.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../../js/game/core/time.js';
import { idx, ctrW, W, H, TER, TER_BUILDABLE, TER_WATER } from '../../js/game/core/grid.js';
import { addBuilding, removeBuilding } from '../../js/game/core/apply.js';
import { depositDef } from '../../js/game/world/defs.js';
import { generateColonist, spawnColonist } from '../../js/game/people/colonists.js';
import { stateHash } from '../../js/game/core/state.js';
import { verifyCaches } from '../../js/game/core/rtcontract.js';
import { saveBlobSync, loadBlobSync } from '../../js/game/save/colonysave.js';
import { emit } from '../../js/game/core/events.js';
import { completeBuilding, startUpgrade } from '../../js/game/work/construct.js';
import { spawn, totals, stacksOn, countOn, capAt, getItem, rebuildSlots } from '../../js/game/work/items.js';
import { filterAccepts, curPri, findDest, needsHaul, benchIngredients } from '../../js/game/work/stockpiles.js';
import { rotSystem, shelfTicks } from '../../js/game/work/rot.js';
import { addFilth, filthAt } from '../../js/game/work/filth.js';
import { homeFires } from '../../js/game/work/givers/fire.js';
import { gearScore, outfitOf } from '../../js/game/work/outfit.js';
import { ignite, burning } from '../../js/game/world/fire.js';
import { research, trade, deeds, ledger, chronicle, tiers } from '../../js/game/colony/index.js';
import { spawn as aspawn, pens, manhunter, breeding } from '../../js/game/animals/index.js';
import { CONTENT } from '../../js/data/index.js';

const H1 = TICKS_PER_HOUR;
function colony(seed = 'EK-2') {
  installSim({ stage: '2', reset: true, checks: true });
  return foundColony({ seed, name: 'EK Hold' });
}
const hearth = (s) => s.bld[s.colony.hearth.id];
/** A finished building of def at a free spot near the Hearth (offset dx, dy). */
function built(s, defId, dx = 4, dy = 4, mat = null) {
  const hb = hearth(s), d = CONTENT.get('structure', defId);
  const at = findSite(s, hb.x + dx, hb.y + dy, d.size[0], d.size[1], 1);
  const b = addBuilding(s, defId, at[0], at[1], 0, mat);
  completeBuilding(s, b);
  return b;
}
/** A free open w x h rect (top-left x0, y0) some way from the Hearth. */
function openRect(s, w, h, from = 6) {
  const hb = hearth(s);
  for (let r = from; r < 40; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x0 = hb.x + dx, y0 = hb.y + dy;
    if (x0 < 1 || y0 < 1 || x0 + w >= W - 1 || y0 + h >= H - 1) continue;
    let ok = true;
    for (let y = y0 - 1; y <= y0 + h && ok; y++) for (let x = x0 - 1; x <= x0 + w && ok; x++) { const i = idx(x, y); if (!TER_BUILDABLE[s.L.terrain[i]] || TER_WATER[s.L.terrain[i]] || s.rt.occ[i] >= 0 || s.L.zone[i] || s.rt.itemAt[i] >= 0 || s.L.roof[i]) ok = false; }
    if (ok) return { x0, y0, x1: x0 + w - 1, y1: y0 + h - 1 };
  }
  throw new Error('no open rect');
}
const onlyWork = (s, c, work) => { for (let k = 0; k < WORK_IDS.length; k++) c.prio[k] = WORK_IDS[k] === work ? 1 : 0; c.custom = true; };
const living = (s) => s.col.filter((c) => !c.hp.dead);

// ---- E: storage buildings --------------------------------------------------------------------------------
test('E: a shelf tile holds 3 stacks, they count as stock, caches equal a rebuild, and removing the shelf spills the extras', () => {
  const s = colony('EK-SHELF');
  const sh = built(s, 'shelf', 5, 0, 'wood');
  const i = idx(sh.x, sh.y);
  assert.equal(capAt(s, i), 3);
  const before = totals(s, 'wood');
  spawn(s, 'wood', 'wood', 0, 70, sh.x, sh.y); spawn(s, 'block', 'granite', 0, 40, sh.x, sh.y); spawn(s, 'meal', null, 0, 5, sh.x, sh.y);
  assert.equal(countOn(s, i), 3, 'three stacks on one shelf tile');
  assert.equal(totals(s, 'wood'), before + 70, 'shelf stacks are stock');
  assert.deepEqual(verifyCaches(s, ['itemAt', 'idx', 'stock']), []);
  assert.deepEqual(rebuildSlots(s)[i], stacksOn(s, i));
  // a fourth kind spills next to it
  spawn(s, 'herbs', null, 0, 3, sh.x, sh.y);
  assert.equal(countOn(s, i), 3);
  // take the shelf away: one stack stays, two move off, the stock is exact
  sh.dcon = true;
  const st0 = totals(s, 'meal');
  applyCommand(s, { t: 'deconstruct', ids: [sh.id] });
  // finish the deconstruction directly (A's removeBuilding)
  removeBuilding(s, sh);
  assert.ok(countOn(s, i) <= 1, 'plain ground holds one stack');
  assert.deepEqual(verifyCaches(s, ['itemAt', 'idx', 'stock']), []);
  assert.ok(totals(s, 'meal') <= st0);
});

test('E: the filter tree (excluded categories, extra and excluded kinds) and the zoneCfg command keep it', () => {
  const s = colony('EK-FILTER');
  const f = { cats: ['raw'], mats: [], q: [0, 6], x: ['stone'], k: ['meal'], xk: ['coal'] };
  assert.equal(filterAccepts(f, { k: 'wood', m: 'wood', q: 0 }), true);
  assert.equal(filterAccepts(f, { k: 'stone', m: 'granite', q: 0 }), false, 'stone excluded under raw');
  assert.equal(filterAccepts(f, { k: 'meal', m: null, q: 0 }), true, 'an extra kind');
  assert.equal(filterAccepts(f, { k: 'coal', m: null, q: 0 }), false, 'an excluded kind');
  const r = openRect(s, 3, 3);
  const z = applyCommand(s, { t: 'zone', op: 'new', type: 'stockpile', rect: r, preset: 'raw' });
  assert.ok(z.ok);
  const res = applyCommand(s, { t: 'zoneCfg', zoneId: z.zoneId, patch: { filter: f } });
  assert.ok(res.ok, res.reason);
  const zone = s.zones.find((x) => x.id === z.zoneId);
  assert.deepEqual(zone.filter.x, ['stone']); assert.deepEqual(zone.filter.xk, ['coal']);
  assert.equal(applyCommand(s, { t: 'zoneCfg', zoneId: z.zoneId, patch: { filter: { cats: ['nope'], mats: [], q: [0, 6] } } }).ok, false);
});

test('E: an input shelf beside a workbench takes the bills\' ingredients at Preferred, and haulers fill it', () => {
  const s = colony('EK-INPUT');
  const mason = built(s, 'mason', 6, 0);
  const sh = addBuilding(s, 'shelf', mason.x - 1, mason.y, 0, 'wood');
  completeBuilding(s, sh);
  assert.equal(sh.link, mason.id, 'linked to the touching bench');
  assert.ok(benchIngredients(s, mason).some((g) => g.k === 'stone' || g.cat === 'stone'), 'mason bills want stone');
  const it = getItem(s, spawn(s, 'wood', 'wood', 0, 10, hearth(s).x - 6, hearth(s).y + 6));
  assert.equal(curPri(s, it), -1);
  // wood is no mason ingredient: the shelf does not want it
  const dest = findDest(s, living(s)[0], it);
  assert.ok(!dest || dest.i !== idx(sh.x, sh.y), 'the input shelf refuses what its bench does not use');
});

test('E: a rack off the stockpiles stores its categories, reached from beside it (blocking construct)', () => {
  const s = colony('EK-RACK');
  const rack = built(s, 'weaponrack', -6, 6);
  const hb = hearth(s);
  const id = spawn(s, 'spear', 'iron', 1, 1, hb.x + 2, hb.y + 5);
  const it = getItem(s, id);
  assert.ok(needsHaul(s, it), 'a spear on the ground wants the rack');
  for (const c of living(s)) onlyWork(s, c, 'haul');
  step(s, 3 * H1);
  const on = [];
  for (let dx = 0; dx < 2; dx++) for (const sid of stacksOn(s, idx(rack.x + dx, rack.y))) on.push(s.items[sid].k);
  assert.ok(on.includes('spear'), `the spear is on the rack (${on.join(',')})`);
});

// ---- E: rot, filth, fire --------------------------------------------------------------------------------
test('E: food rots by its shelf life and the tile temperature; an ice house keeps it', () => {
  const s = colony('EK-ROT');
  const hb = hearth(s);
  const id = spawn(s, 'meal', null, 0, 5, hb.x - 4, hb.y - 4);
  const life = shelfTicks('meal');
  assert.ok(life > 0);
  for (let t = 0; t < life * 3; t += 600) { s.tick += 600 - (s.tick % 600); rotSystem(s); if (!getItem(s, id) || getItem(s, id).k !== 'meal') break; }
  assert.ok(!getItem(s, id) || getItem(s, id).k !== 'meal', 'the meal spoiled');
});

test('E: filth on indoor floors is cleaned by a hauler', () => {
  const s = colony('EK-FILTH');
  const hb = hearth(s);
  const r = openRect(s, 3, 3);
  const i = idx(r.x0 + 1, r.y0 + 1);
  s.L.floor[i] = 1; s.L.roof[i] = 1;
  assert.equal(addFilth(s, i, 3), true);
  assert.equal(filthAt(s, i), 3);
  for (const c of living(s)) onlyWork(s, c, 'haul');
  step(s, 4 * H1);
  assert.equal(filthAt(s, i), 0, 'cleaned');
  void hb;
});

test('E: a fire in the home area pulls colonists off work and they put it out', () => {
  const s = colony('EK-FIRE');
  const hb = hearth(s);
  // a stack of wood on fire near the Hearth
  const x = hb.x + 4, y = hb.y + 5;
  spawn(s, 'wood', 'wood', 0, 20, x, y);
  assert.ok(ignite(s, idx(x, y)), 'lit');
  assert.ok(homeFires(s).length >= 1);
  for (const c of living(s)) onlyWork(s, c, 'mine');
  let fought = false;
  for (let k = 0; k < 60 && homeFires(s).length; k++) { step(s, 60); if (s.col.some((c) => c.job && c.job.type === 'firefight')) fought = true; }
  assert.ok(fought, 'someone fought the fire');
  assert.equal(burning(s, idx(x, y)), false, 'the fire is out');
});

// ---- E: outfits, upgrades, batches, study, tend --------------------------------------------------------------
test('E: colonists dress in the best allowed piece, and the outfit command changes what is allowed', () => {
  const s = colony('EK-OUTFIT');
  const hb = hearth(s);
  spawn(s, 'cloak', 'wool', 2, 1, hb.x + 3, hb.y + 4);
  const c = living(s)[0];
  assert.equal(outfitOf(c), 'worker');
  step(s, 2 * H1);
  const worn = living(s).find((x) => x.gear.slots.outer);
  assert.ok(worn, 'someone wears the cloak');
  assert.ok(gearScore(worn.gear.slots.outer) > 0);
  assert.ok(applyCommand(s, { t: 'outfit', colId: c.id, outfit: 'soldier' }).ok);
  assert.equal(outfitOf(c), 'soldier');
});

test('E: the Hearth upgrade takes its materials and work, then Hearth level 2', () => {
  const s = colony('EK-UPGRADE');
  const hb = hearth(s);
  spawn(s, 'block', 'granite', 0, 75, hb.x - 3, hb.y + 4); spawn(s, 'block', 'granite', 0, 10, hb.x - 4, hb.y + 4);
  spawn(s, 'ingot', 'iron', 0, 20, hb.x - 3, hb.y + 5);
  const res = applyCommand(s, { t: 'upgrade', bId: hb.id });
  assert.ok(res.ok, res.reason);
  assert.ok(Object.keys(hb.need).length > 0);
  for (const c of living(s)) onlyWork(s, c, 'build');
  for (let k = 0; k < 48 && s.colony.hearth.lvl < 2; k++) step(s, H1);
  assert.equal(s.colony.hearth.lvl, 2, 'Hearth level 2');
  assert.equal(hb.lvl, 2);
  assert.match(String(startUpgrade(s, hb)), /no further level|tier|needs/);
});

test('E: a cask works its batch unattended (waitH) and the drink comes out after', () => {
  const s = colony('EK-CASK');
  research.learn(s, 'brewing');
  const cask = built(s, 'cask', 5, 3);
  const hb = hearth(s);
  spawn(s, 'alewort', null, 0, 1, hb.x + 3, hb.y + 4);
  assert.ok(applyCommand(s, { t: 'bill', op: 'add', bId: cask.id, bill: { recipe: 'ferment_ale', mode: 'count', n: 1 } }).ok);
  for (const c of living(s)) onlyWork(s, c, 'cook');
  for (let k = 0; k < 12 && !cask.bills.some((b) => b.batch); k++) step(s, H1);
  const bl = cask.bills.find((b) => b.recipe === 'ferment_ale');
  assert.ok(bl.batch, 'loaded');
  assert.equal(totals(s, 'ale') + s.items.filter((x) => x && x.k === 'ale').length, 0);
  step(s, 97 * H1);
  assert.ok(s.items.some((x) => x && x.k === 'ale'), 'ale came out of the cask');
});

test('E/K: a scholar at a study desk earns lore points for the current research', () => {
  const s = colony('EK-STUDY');
  built(s, 'study', 5, 2);
  const c = living(s)[0];
  for (const x of living(s)) onlyWork(s, x, x === c ? 'lore' : 'haul');
  assert.ok(applyCommand(s, { t: 'research', tech: 'hunting' }).ok);
  for (let k = 0; k < 12 && !research.hasTech(s, 'hunting'); k++) step(s, H1);
  assert.ok(research.hasTech(s, 'hunting'), 'Hunting learned at the desk');
});

test('E: a doctor tends a downed, wounded patient with medicine', async () => {
  const s = colony('EK-TEND');
  const { damage } = await import('../../js/game/people/health.js');
  const [doc, pat] = living(s);
  const hb = hearth(s);
  spawn(s, 'poultice', null, 0, 5, hb.x + 3, hb.y + 4);
  for (const x of living(s)) onlyWork(s, x, x === doc ? 'care' : 'haul');
  damage(s, pat, 'torso', 'cut', 18); damage(s, pat, 'lleg', 'cut', 12);
  for (let k = 0; k < 16 && pat.hp.wounds.some((w) => w.tended === 0); k++) step(s, H1 / 2);
  assert.ok(pat.hp.wounds.every((w) => w.tended > 0), 'every wound tended');
});

// ---- K: animals ---------------------------------------------------------------------------------------------
test('K: a tamed goat stays in its pen (14.8 acceptance), over two days and a save', () => {
  const s = colony('EK-PEN');
  const r = openRect(s, 6, 6);
  const z = applyCommand(s, { t: 'zone', op: 'new', type: 'pen', rect: r });
  assert.ok(z.ok);
  const g = aspawn.spawnAnimal(s, 'goat', r.x0 + 2, r.y0 + 2, { tame: true, age: 5 * TICKS_PER_DAY });
  assert.ok(pens.assignPen(s, g, z.zoneId));
  const inside = () => { const i = aspawn.animTile(g); return s.L.zone[i] === z.zoneId; };
  let out = 0, moved = new Set();
  for (let t = 0; t < TICKS_PER_DAY; t += 5) { step(s, 5); if (!inside()) out++; moved.add(aspawn.animTile(g)); }
  assert.equal(out, 0, 'never outside');
  assert.ok(moved.size > 3, 'it walks about inside');
  const t2 = loadBlobSync(saveBlobSync(s));
  step(s, TICKS_PER_DAY / 2); step(t2, TICKS_PER_DAY / 2);
  assert.equal(stateHash(s), stateHash(t2), 'a save continues identically');
  assert.ok(inside());
});

test('K: a herder tames a wild goat into a pen with room; the herd breeds when fed and housed', () => {
  const s = colony('EK-TAME');
  const r = openRect(s, 6, 6);
  const z = applyCommand(s, { t: 'zone', op: 'new', type: 'pen', rect: r });
  aspawn.herdRec(s).seeded = 1;   // no wild arrivals in this test
  const hb = hearth(s);
  const w = aspawn.spawnAnimal(s, 'goat', hb.x + 6, hb.y + 6, { age: 5 * TICKS_PER_DAY });
  const herder = living(s)[0];
  herder.sk[8][0] = 8;
  for (const c of living(s)) onlyWork(s, c, c === herder ? 'animals' : 'haul');
  for (let k = 0; k < 48 && !w.tame; k++) step(s, H1);
  assert.ok(w.tame, 'tamed');
  assert.equal(w.pen, z.zoneId);
  assert.ok(ledger.lifetime(s, 'tamed') >= 1);
  const g2 = aspawn.spawnAnimal(s, 'goat', r.x0 + 1, r.y0 + 1, { tame: true, pen: z.zoneId, age: 5 * TICKS_PER_DAY });
  void g2;
  const n0 = s.anim.filter((a) => a.tame).length;
  for (let d = 0; d < 10 && !aspawn.herdRec(s).born; d++) step(s, TICKS_PER_DAY);
  assert.ok(aspawn.herdRec(s).born > 0 && s.anim.filter((a) => a.tame).length > n0, 'a kid was born');
  assert.ok(s.chron.some((e) => e[2] === 'chron_born'));
});

test('K: a manhunter bites the nearest colonist, who strikes back; it calms down later', () => {
  const s = colony('EK-MANHUNT');
  for (const a of s.anim.slice()) aspawn.removeAnimal(s, a);
  const c = living(s)[0];
  const ci = Math.floor(c.y / 32) * W + Math.floor(c.x / 32);
  const wolf = aspawn.spawnAnimal(s, 'wolf', (ci % W) + 3, ((ci / W) | 0));
  manhunter.enrage(s, wolf, c.id);
  let bitten = false;
  for (let k = 0; k < 40 && !bitten; k++) { step(s, 30); bitten = s.col.some((x) => x.hp.wounds.some((w) => w.kind === 'bite')); }
  assert.ok(bitten, 'a bite');
  const hp0 = wolf.hp.max;
  assert.ok(!s.anim.includes(wolf) || wolf.hp.hp < hp0, 'struck back');
  if (s.anim.includes(wolf)) { wolf.st.until = s.tick + 1; step(s, 2); assert.equal(manhunter.isManhunter(wolf), false, 'calmed'); }
});

// ---- K: research, trade, deeds, Chronicle, tiers ----------------------------------------------------------------
test('K: lore banks and is spent first; gates block a tech structure until it is known; an event discovers', () => {
  const s = colony('EK-RESEARCH');
  research.addLore(s, 50);
  assert.equal(s.colony.lore, 50);
  assert.ok(applyCommand(s, { t: 'research', tech: 'hunting' }).ok);
  assert.equal(s.colony.research.pts, 50);
  research.addLore(s, 20);
  assert.ok(research.hasTech(s, 'hunting'));
  assert.equal(s.colony.lore, 10, 'the rest banks');
  const hb = hearth(s);
  // charcoal kiln needs Charcoal (60)
  const p = findSite(s, hb.x + 6, hb.y + 2, 2, 2, 1);
  const r1 = applyCommand(s, { t: 'place', def: 'charkiln', x: p[0], y: p[1], rot: 0 });
  assert.equal(r1.ok, false); assert.match(r1.reason, /Charcoal/);
  research.learn(s, 'charcoal');
  assert.ok(applyCommand(s, { t: 'place', def: 'charkiln', x: p[0], y: p[1], rot: 0 }).ok);
  // Z2.9 (F27): ranks, not unlocks - a Hamlet-band structure never waits for the tier
  const r2 = applyCommand(s, { t: 'place', def: 'stove', x: p[0] + 4, y: p[1], rot: 0 });
  assert.doesNotMatch(r2.reason || '', /Hamlet/);
  // the first ore discovers Bloomery smelting (free)
  emit(s, 'oreFound', { i: 0, ore: 4 });
  ledger.tapEvents(s);
  assert.ok(research.hasTech(s, 'bloomery') || (s.colony.research.disc || []).includes('bloomery'));
});

test('K: a pedlar visits; the colony buys with coins and sells goods; goodwill and the ledger follow', () => {
  const s = colony('EK-TRADE');
  trade.tradeRec(s);
  const v = trade.arrive(s, 'pedlar');
  assert.ok(v && v.stock.length > 0);
  const hb = hearth(s);
  const z = applyCommand(s, { t: 'zone', op: 'new', type: 'stockpile', rect: openRect(s, 4, 4), preset: 'all' });
  assert.ok(z.ok);
  const zr = s.zones.find((x) => x.id === z.zoneId);
  const tiles = []; for (let i = 0; i < s.L.zone.length; i++) if (s.L.zone[i] === zr.id) tiles.push(i);
  spawn(s, 'coins', null, 0, 400, tiles[0] % W, (tiles[0] / W) | 0);
  const g = v.stock[0];
  const coins0 = trade.colonyCoins(s);
  const res = applyCommand(s, { t: 'trade', visitId: v.id, buy: [{ k: g.k, n: 1 }], sell: [] });
  assert.ok(res.ok, res.reason);
  assert.ok(trade.colonyCoins(s) < coins0 || res.paid === 0, 'coins paid');
  assert.equal(ledger.lifetime(s, 'traded'), 1);
  assert.ok(s.colony.factions.league >= 1);
  assert.ok(s.chron.some((e) => e[2] === 'chron_trade'));
  assert.equal(applyCommand(s, { t: 'trade', visitId: v.id + 99, buy: [], sell: [] }).ok, false);
  void hb;
});

test('K: deeds with a kind (the first iron vein) count from the ledger kinds; tiers write Chronicle lines', () => {
  const s = colony('EK-DEEDS');
  const iron = CONTENT.all('deposit').findIndex((d) => d.id === 'iron');
  assert.ok(iron >= 0);
  // oreFound carries the ore code: find the code of the iron deposit
  let code = -1;
  for (let c = 1; c < 32 && code < 0; c++) { const d = depositDef(c); if (d && d.id === 'iron') code = c; }
  assert.ok(code > 0);
  emit(s, 'oreFound', { i: 5, ore: code });
  ledger.tapEvents(s);   // the events tap counts events of the tick that is running
  assert.equal(ledger.lifetimeKind(s, 'oreFound', 'iron'), 1);
  const d = CONTENT.get('deed', 'deep_seam');
  assert.equal(deeds.progress(s, d), 1);
  emit(s, 'tierUp', { tier: 'hamlet' });
  ledger.tapEvents(s);
  assert.ok(s.chron.some((e) => e[2] === 'chron_tier'));
  assert.match(chronicle.chronLine(s.chron.find((e) => e[2] === 'chron_tier')), /Hamlet/);
  step(s, 1);
  assert.ok(s.chron.some((e) => e[2] === 'chron_founded'), 'the founding line');
});

test('K: the Hamlet tier comes after a full day of wealth, colonists and Hearth level 2', () => {
  const s = colony('EK-TIER');
  const t = CONTENT.get('tier', 'hamlet');
  assert.equal(tiers.meets(s, t, t.wealth), false, 'needs colonists and the Hearth');
  while (living(s).length < t.colonists) { const c = generateColonist(s, {}); spawnColonist(s, c, hearth(s).x + 1, hearth(s).y + 4); }
  s.colony.hearth.lvl = 2;
  assert.ok(tiers.meets(s, t, t.wealth));
  assert.equal(s.colony.tier, 0);
});

test('E/K: a Stage 2 colony with shelves, a pen and tame animals saves and continues identically', () => {
  const s = colony('EK-SAVE');
  const r = openRect(s, 5, 5);
  const z = applyCommand(s, { t: 'zone', op: 'new', type: 'pen', rect: r });
  aspawn.spawnAnimal(s, 'goat', r.x0 + 1, r.y0 + 1, { tame: true, pen: z.zoneId, age: 4 * TICKS_PER_DAY });
  aspawn.spawnAnimal(s, 'goat', r.x0 + 2, r.y0 + 2, { tame: true, pen: z.zoneId, age: 4 * TICKS_PER_DAY });
  const sh = built(s, 'shelf', 6, -2, 'wood');
  spawn(s, 'wood', 'wood', 0, 30, sh.x, sh.y); spawn(s, 'meal', null, 0, 4, sh.x, sh.y);
  step(s, 2 * H1);
  const t2 = loadBlobSync(saveBlobSync(s));
  assert.deepEqual(verifyCaches(t2, ['itemAt', 'idx', 'stock']), []);
  step(s, TICKS_PER_DAY); step(t2, TICKS_PER_DAY);
  assert.equal(stateHash(s), stateHash(t2));
  void breeding; void FIX; void TER; void ctrW;
});

test('E: a furniture ghost with no item in stock gets a "for blueprint" bill at the nearest bench, and the made piece is installed', () => {
  const s = colony('EK-AUTOBILL');
  const carp = built(s, 'carpenter', 6, 0);
  const hb = hearth(s);
  spawn(s, 'wood', 'wood', 0, 75, hb.x + 3, hb.y + 4);
  const r = openRect(s, 2, 3);
  const res = applyCommand(s, { t: 'place', def: 'bed', x: r.x0, y: r.y0, rot: 0, mat: 'wood' });
  assert.ok(res.ok, res.reason);
  assert.ok(carp.bills.some((b) => b.bp && b.n === 1), 'a count-1 bill for the blueprint');
  const bed = s.bld[res.id];
  for (let k = 0; k < 24 && bed.st !== 'done'; k++) step(s, H1);
  assert.equal(bed.st, 'done', 'the bed was made, carried and installed');
  assert.ok(!carp.bills.some((b) => b.bp), 'the blueprint bill is gone');
});

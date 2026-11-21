// Bills and crafting (doc 5.7, D8; owner E).
//
// A workbench holds up to 10 bills (schema newBill): { recipe, mode: 'count' | 'until' | 'forever',
// n, paused, ingredients ({ mats } subset or null), minSkill, maxSkill, radius, store, quality,
// perCol? (until n per colonist), bp? (made for a furniture blueprint, D8) }. Bills run top to
// bottom: the first bill the colonist may work, whose ingredients are in reach, is worked.
//   'count' n: make n more (n counts down; a bp bill is removed at 0).
//   'until' n: while colony stock (5.5: non-forbidden, in stockpiles) of the product is below n
//              (n x colonists for perCol bills).
//   'forever': always.
// Smart defaults (autoBills on the bench def) are added by A's addBuilding when the bench is planned:
// Stage 1b's Campfire "Simple meal, until 2 per living colonist" and Bloomery "Smelt iron while ore is
// stocked (the bill waits for ingredients), until 60 iron ingots" (untilProduct counts the material).
// Auto-bills for furniture (D8): a furniture blueprint whose item is not in stock gets a 'count'
// bill at the nearest capable finished bench, ahead of its standing bills; the bills follow demand (blueprints placed, removed,
// benches finished) and are trimmed when the stock covers it.
//
// The craft job: claim the bench and the ingredient units, fetch each ingredient stack (the crafter
// carries a bill's ingredients regardless of mass; bundles of another kind are stowed in job.held),
// walk to the bench, work, then the products appear at the crafter's tile (quality rolled when the
// recipe has quality; the material copied from ingredient matFrom).

import { addonOpen, needsNoFuel, extraQualityRolls } from './addons.js';
import { idx, tx, ty } from '../core/grid.js';
import { BUS } from '../core/bus.js';
import { emit } from '../core/events.js';
import { bldById } from '../core/state.js';
import { newBill } from '../core/schema.js';
import { def, all, structDef } from '../core/content.js';
import { TICKS_PER_MIN, TICKS_PER_HOUR } from '../core/time.js';
import { RUN, NEXT, END, T, makeJob, registerToil, keyBld, keyItem, myClaim, workHooks } from './jobs.js';
import { categoryOf, stackLimit, freeCount, spawn, totalsMat, forEachItem } from './items.js';
import { colTile } from './reserve.js';
import { footprint } from '../world/pass.js';
import { standSpot, reachableFrom } from './windex.js';
import { rollQuality, skillLevel } from './quality.js';
import { benchMess, FILTH } from './filth.js';
import { didDeed } from '../people/coldeeds.js';

export const MAX_BILLS = 10;

/** The recipe def of a bill, or null. */
export const recipeOf = (bill) => def('recipe', bill.recipe);
const living = (s) => { let n = 0; for (const c of s.col) if (!c.hp.dead) n++; return n; };
/** Target count of an 'until' bill (perCol: n per living colonist). */
export const untilTarget = (s, bill) => (bill.perCol ? bill.n * Math.max(1, living(s)) : bill.n);
/**
 * The product an 'until' bill counts: { k, m }. m is the product's material when the recipe fixes it
 * (an ingredient with a set material copied by matFrom: "Smelt iron until 60" counts iron ingots only).
 */
export function untilProduct(r) {
  const o = r && r.out && r.out[0];
  if (!o) return null;
  const src = o.matFrom !== undefined && r.in ? r.in[o.matFrom] : null;
  return { k: o.k, m: (src && src.mat) || o.mat || null };
}
/** Colony stock an 'until' bill compares with its target. */
export function untilStock(s, bill) {
  const p = untilProduct(recipeOf(bill));
  return p ? totalsMat(s, p.k, p.m) : 0;
}

let recipeGate = null;
/** K plugs in the research gate (Stage 2): fn(s, recipe) -> true when the recipe may be worked; null clears it. */
export function setRecipeGate(fn) { recipeGate = fn || null; }
/** Is the bill wanted now (mode and pause), ignoring who works it and ingredients? */
export function billWanted(s, bill) {
  const r = recipeOf(bill);
  if (!r || bill.paused || bill.batch) return false;
  if (recipeGate && !recipeGate(s, r)) return false;
  if (bill.mode === 'count') return bill.n > 0;
  if (bill.mode === 'until') return !!untilProduct(r) && untilStock(s, bill) < untilTarget(s, bill);
  return true;
}
/** May colonist col work this bill (skill range)? */
export function billSkillOk(col, bill) {
  const r = recipeOf(bill);
  if (!r) return false;
  const lvl = r.skill ? skillLevel(col, r.skill) : 0;
  return lvl >= Math.max(bill.minSkill | 0, r.minSkill | 0) && lvl <= (bill.maxSkill ?? 20);
}

/**
 * Ingredient stacks for one run of a recipe, nearest to the bench first, within the bill radius,
 * free for col and in col's component: [[stackId, n] per stack] per ingredient, or null.
 */
export function gatherIngredients(s, col, bench, bill) {
  const r = recipeOf(bill);
  if (!r) return null;
  // (new bills fetch from anywhere, radius 999; X 2.7: at the old default of 30 the ore mined 32 tiles
  // from the bloomery was never smelted and a hold went 100 days without an ingot)
  const R = bill.radius | 0 || 999;
  const bx = bench.x, by = bench.y;
  const mats = bill.ingredients && bill.ingredients.mats && bill.ingredients.mats.length ? bill.ingredients.mats : null;
  const used = new Map();
  const out = [];
  const noFuel = needsNoFuel(s, bench);   // Z2: a bench beside an ember forge burns no fuel
  for (const ing of r.in || []) {
    if (noFuel && ing.cat === 'fuel') { out.push([]); continue; }
    const bucket = ing.k ? s.rt.idx.items[ing.k] : s.rt.idx.items['@' + ing.cat];
    if (!bucket) return null;
    const cands = [];
    for (const id of bucket) {
      const it = s.items[id];
      if (it.f) continue;
      if (ing.mat && it.m !== ing.mat) continue;
      if (mats && !mats.includes(it.m)) continue;
      const dx = it.x - bx, dy = it.y - by, d = dx * dx + dy * dy;
      if (d > R * R) continue;
      const free = freeCount(s, id, col.id) - (used.get(id) || 0);
      if (free <= 0 || !reachableFrom(s, col, idx(it.x, it.y, it.z | 0))) continue;
      cands.push([d, id, free]);
    }
    cands.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    let need = ing.n | 0;
    const picks = [];
    for (const [, id, free] of cands) {
      if (need <= 0) break;
      const n = Math.min(need, free);
      picks.push([id, n]); need -= n;
      used.set(id, (used.get(id) || 0) + n);
    }
    if (need > 0) return null;
    out.push(picks);
  }
  return out;
}

/** The first bill of bench b colonist col can work now, with its ingredients: { bi, picks } or null. */
export function workableBill(s, col, b) {
  for (let bi = 0; bi < b.bills.length; bi++) {
    const bill = b.bills[bi];
    if (!billWanted(s, bill) || !billSkillOk(col, bill) || !addonOpen(s, b, recipeOf(bill))) continue;   // Z2: add-on recipes
    const picks = gatherIngredients(s, col, b, bill);
    if (picks) return { bi, picks };
  }
  return null;
}

/** The craft job for bench b, bill bi, with ingredient picks. */
export function craftJob(s, col, b, bi, picks) {
  const bill = b.bills[bi], r = recipeOf(bill);
  const st = standSpot(s, col, footprint(s, b));
  if (st.i < 0) return null;
  const toils = [], claims = [[keyBld(b.id), 0]];
  let first = true;
  for (const list of picks) {
    for (const [id, n] of list) {
      const it = s.items[id];
      if (!first) toils.push({ t: 'stow' });
      first = false;
      toils.push(T.goto(idx(it.x, it.y, it.z | 0)), T.pickup(id, n));
      claims.push([keyItem(id), n]);
    }
  }
  const work = Math.max(1, (r.work | 0)) * TICKS_PER_MIN;
  toils.push(T.goto(st.i), { t: 'craft', b: b.id, n: work, sk: r.skill || null, rec: r.id, bi });
  // merge claims on the same stack (beginJob needs distinct keys)
  const merged = [];
  for (const c of claims) { const m = merged.find((x) => x[0] === c[0]); if (m) m[1] += c[1]; else merged.push(c.slice()); }
  return { job: makeJob('craft', keyBld(b.id), toils), claims: merged };
}

// ---- Toils ---------------------------------------------------------------------------------------------
registerToil('stow', (s, col, job) => {
  if (job.carry) { (job.held || (job.held = [])).push(job.carry); job.carry = null; }
  return NEXT;
});

/** Bundles a craft job holds, matched to recipe ingredients: per ingredient, the material of the first bundle. */
function ingredientMats(r, bundles) {
  return (r.in || []).map((ing) => {
    const b = bundles.find((x) => (ing.k ? x.k === ing.k : categoryOf(x.k) === ing.cat));
    return b ? b.m : null;
  });
}

registerToil('craft', (s, col, job, toil) => {
  const b = bldById(s, toil.b);
  if (!b || b.st !== 'done') return END.TARGET_GONE;
  if (myClaim(s, keyBld(b.id), col.id) < 0) return 'lostClaim';
  const h = workHooks();
  const sp = h.speed(s, col, toil) | 0;
  if (sp > 0) job.work += sp;
  if (toil.sk && h.xp) h.xp(s, col, toil.sk, 1);
  if (job.work < toil.n * 100) return RUN;
  const r = def('recipe', toil.rec);
  if (!r) return 'noRecipe';
  const bundles = [...(job.held || []), ...(job.carry ? [job.carry] : [])];
  // check the ingredients are all here
  for (const ing of r.in || []) {
    let have = 0;
    for (const x of bundles) if (ing.k ? x.k === ing.k : categoryOf(x.k) === ing.cat) have += x.n;
    if (have < (ing.n | 0)) return 'missingIngredients';
  }
  const mats = ingredientMats(r, bundles);
  job.carry = null; job.held = null;   // consumed
  const ci = colTile(col), x = tx(ci), y = ty(ci);
  if (r.waitH) {
    // an unattended batch (cask, smokehouse, tannery, charcoal kiln): it sits on its bill until ready
    let bill = b.bills[toil.bi];
    if (!bill || bill.recipe !== r.id) bill = b.bills.find((x) => x.recipe === r.id) || null;
    if (!bill) return 'billGone';
    bill.batch = { until: s.tick + r.waitH * TICKS_PER_HOUR, mats, maker: col.id };
    if (bill.mode === 'count') bill.n = Math.max(0, (bill.n | 0) - 1);
    for (const fn of BUS.billsChanged) fn(s, b);
    return NEXT;
  }
  spawnProducts(s, r, mats, col, b, x, y);
  // a piece of masonwork or of art (3.1 Stone Carver, Chronicler): one per finished bill, whatever it made
  if (col && r.skill === 'masonry') didDeed(s, col, 'masonwork');
  else if (col && r.skill === 'art') didDeed(s, col, 'artworks');
  // bill bookkeeping: the bill at its index if it is still that recipe, else the first bill of it
  let bill = b.bills[toil.bi];
  if (!bill || bill.recipe !== r.id) bill = b.bills.find((x) => x.recipe === r.id) || null;
  if (bill && bill.mode === 'count') {
    bill.n = Math.max(0, (bill.n | 0) - 1);
    if (bill.n === 0 && bill.bp) b.bills.splice(b.bills.indexOf(bill), 1);
    for (const fn of BUS.billsChanged) fn(s, b);
  }
  return NEXT;
});

/** A recipe's products at (x, y): unique items one by one with a quality roll, the rest as one stack each. */
function spawnProducts(s, r, mats, col, b, x, y) {
  // cooks spill and butchers bleed (filth.js; Stage 2 only)
  const wt = ((structDef(b.def) || {}).workbench || {}).workType;
  if (r.id === 'butcher') benchMess(s, b, 2, 100, 11); else if (wt === 'cook') benchMess(s, b, 1, FILTH.cookPct, 7);
  for (const o of r.out || []) {
    const m = o.matFrom !== undefined ? mats[o.matFrom] ?? null : o.mat || null;
    const unique = stackLimit(o.k) === 1;
    if (unique) {
      for (let k = 0; k < (o.n | 0); k++) {
        let q = r.quality && col ? rollQuality(s, r.skill ? skillLevel(col, r.skill) : 0, b.lvl | 0 || 1) : 1;
        if (r.quality && col) for (let e = extraQualityRolls(s, b); e > 0; e--) q = Math.max(q, rollQuality(s, r.skill ? skillLevel(col, r.skill) : 0, b.lvl | 0 || 1));   // Z2: the ember forge
        const id = spawn(s, o.k, m, q, 1, x, y, { maker: col ? col.id : null, z: b.z | 0 });
        emit(s, 'crafted', { itemId: id, k: o.k, q, colId: col ? col.id : null });
        if (q >= 4 && col) emit(s, 'masterwork', { itemId: id, colId: col.id });
      }
    } else {
      const id = spawn(s, o.k, m, 0, o.n | 0, x, y, { z: b.z | 0 });
      emit(s, 'crafted', { itemId: id, k: o.k, q: 0, colId: col ? col.id : null });
      if (r.id === 'butcher' && col) emit(s, 'butchered', { colId: col.id, k: o.k });
    }
  }
}

// ---- Unattended batches (recipe waitH; Stage 2) -------------------------------------------------------
/** Does a bench hold a loaded batch (it cannot be worked until the batch comes out)? */
export const batchLoaded = (b) => !!b.bills && b.bills.some((bl) => !!bl.batch);
/** The 'batches' system (slot 'jobs', every 60 ticks): ready batches come out beside their bench. */
export function batchSystem(s) {
  if (s.tick % 60 !== 0) return;
  for (const id of s.rt.idx.bills) {
    const b = bldById(s, id);
    if (!b || !b.bills) continue;
    for (const bl of b.bills) {
      if (!bl.batch || s.tick < bl.batch.until) continue;
      const r = recipeOf(bl), mats = bl.batch.mats || [];
      const maker = bl.batch.maker;
      bl.batch = null;
      if (!r) continue;
      let c = null;
      for (const x of s.col) if (x.id === maker) { c = x; break; }
      spawnProducts(s, r, mats, c, b, b.x, b.y);
    }
  }
}

// ---- Auto-bills for furniture blueprints (D8) ---------------------------------------------------------
const recipesFor = (k) => all('recipe').filter((r) => r.out && r.out[0] && r.out[0].k === k);
/** Furniture item kind a building def needs (its `item`, or its id when an item of that id exists). */
const furnitureItem = (d) => (d && d.kind === 'furniture' ? (def('item', d.item || d.id) ? d.item || d.id : null) : null);

/**
 * Make the 'bp' bills match the furniture blueprints that have no item in stock: per item kind,
 * open blueprints minus non-forbidden units on the map = what the bp bills should still make.
 */
export function syncFurnitureBills(s) {
  const demand = new Map(), first = new Map();
  for (const b of s.bld) {
    if (!b || b.st === 'done') continue;
    const k = furnitureItem(structDef(b.def));
    if (!k || (b.got && b.got[k] > 0)) continue;
    demand.set(k, (demand.get(k) || 0) + 1);
    if (!first.has(k)) first.set(k, b);
  }
  const stock = new Map();
  forEachItem(s, (it) => { if (!it.f && demand.has(it.k)) stock.set(it.k, (stock.get(it.k) || 0) + it.n); });
  // every kind that has bp bills or demand, in sorted order
  const kinds = new Set(demand.keys());
  for (const b of s.bld) if (b && b.bills) for (const bl of b.bills) if (bl.bp) { const r = recipeOf(bl); if (r && r.out[0]) kinds.add(r.out[0].k); }
  for (const k of [...kinds].sort()) {
    const want = Math.max(0, (demand.get(k) || 0) - (stock.get(k) || 0));
    const rs = recipesFor(k);
    const bills = [];
    for (const b of s.bld) if (b && b.st === 'done' && b.bills) for (const bl of b.bills) if (bl.bp && rs.some((r) => r.id === bl.recipe)) bills.push([b, bl]);
    let have = bills.reduce((a, [, bl]) => a + (bl.n | 0), 0);
    // too many: trim from the last
    for (let j = bills.length - 1; j >= 0 && have > want; j--) {
      const [b, bl] = bills[j];
      const cut = Math.min(bl.n | 0, have - want);
      bl.n -= cut; have -= cut;
      if (bl.n <= 0) b.bills.splice(b.bills.indexOf(bl), 1);
      for (const fn of BUS.billsChanged) fn(s, b);
    }
    if (have >= want) continue;
    // too few: the nearest finished bench that makes it (to the first blueprint), ties by id
    const ref = first.get(k);
    let best = null, bd = Infinity, brec = null;
    for (const b of s.bld) {
      if (!b || b.st !== 'done') continue;
      const d = structDef(b.def);
      if (!d || !d.workbench) continue;
      const r = rs.find((x) => !x.bench || x.bench.includes(b.def));
      if (!r) continue;
      const dd = ref ? (b.x - ref.x) * (b.x - ref.x) + (b.y - ref.y) * (b.y - ref.y) : b.id;
      if (dd < bd) { bd = dd; best = b; brec = r; }
    }
    if (!best) continue;
    const ex = best.bills.find((bl) => bl.bp && bl.recipe === brec.id);
    if (ex) ex.n += want - have;
    else if (best.bills.length < MAX_BILLS) {
      // a blueprint waits on it: ahead of the bench's standing bills (after earlier blueprint bills),
      // so a stamped bedroom's bed is not stuck behind 'Cut blocks until 100'
      let at = 0;
      while (at < best.bills.length && best.bills[at].bp) at++;
      best.bills.splice(at, 0, newBill(brec.id, { mode: 'count', n: want - have, bp: true }));
    }
    else continue;
    for (const fn of BUS.billsChanged) fn(s, best);
  }
}
function onPlaced(s, b) { if (b.st !== 'done' && furnitureItem(structDef(b.def))) syncFurnitureBills(s); }
function onRemoved(s, b) { if (b.st !== 'done' && furnitureItem(structDef(b.def))) syncFurnitureBills(s); }
function onBuilt(s, b) { const d = structDef(b.def); if (d && (d.workbench || furnitureItem(d))) syncFurnitureBills(s); }

/** Register the D8 hooks (idempotent; after resetBus). */
export function installBills() {
  const add = (list, fn) => { if (!list.includes(fn)) list.push(fn); };
  add(BUS.placed, onPlaced);
  add(BUS.removed, onRemoved);
  add(BUS.built, onBuilt);
}

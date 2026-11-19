// ============================================================================
// ZONEFALL 3 — slot inventories (player belt/main, boxes, ovens, loot)
// A stack is { id, n, ammo?, ammoId?, att? } — weapons keep their loaded rounds
// in `ammo` (of type `ammoId`) and their attachments in `att` ({ slot: itemId },
// see ATTACH in weapons_extra.js). Every move / save / co-op transfer keeps all
// of a stack's extra fields (copied, never shared between two stacks).
// ============================================================================
import { ITEMS, WEAPONS, ATTACH, attAllowed } from './data.js';

/** the extra fields of a stack (everything but id / n), deep enough that two stacks never share an `att` */
export function stackExtra(s) {
  if (!s) return null; let o = null;
  for (const k in s) { if (k === 'id' || k === 'n') continue; (o || (o = {}))[k] = k === 'att' && s.att ? { ...s.att } : s[k]; }
  return o;
}
/** a copy of a stack (attachments included) */
export function cloneStack(s) { return s ? Object.assign({ id: s.id, n: s.n }, stackExtra(s)) : null; }

export class Inv {
  constructor(size) { this.slots = new Array(size).fill(null); }
  get size() { return this.slots.length; }
  resize(n) { if (n > this.slots.length) while (this.slots.length < n) this.slots.push(null); else { const extra = this.slots.splice(n); return extra.filter(Boolean); } return []; }
  count(id) { let c = 0; for (const s of this.slots) if (s && s.id === id) c += s.n; return c; }
  /** add n of id; returns leftover count */
  add(id, n = 1, extra) {
    const def = ITEMS[id]; if (!def) return 0; const st = def.stack || 1;
    if (st > 1) for (const s of this.slots) { if (n <= 0) break; if (s && s.id === id && s.n < st) { const k = Math.min(n, st - s.n); s.n += k; n -= k; } }
    for (let i = 0; i < this.slots.length && n > 0; i++) {
      if (this.slots[i]) continue; const k = Math.min(n, st);
      this.slots[i] = Object.assign({ id, n: k }, extra ? stackExtra(extra) : null); if (WEAPONS[id] && this.slots[i].ammo === undefined) this.slots[i].ammo = 0; n -= k;
    }
    return n;
  }
  /** add a whole stack object (keeps ammo etc). returns leftover stack or null */
  addStack(s) { if (!s) return null; const left = this.add(s.id, s.n, stackExtra(s)); return left > 0 ? Object.assign(cloneStack(s), { n: left }) : null; }
  take(id, n) { let got = 0; for (let i = this.slots.length - 1; i >= 0 && got < n; i--) { const s = this.slots[i]; if (!s || s.id !== id) continue; const k = Math.min(n - got, s.n); s.n -= k; got += k; if (s.n <= 0) this.slots[i] = null; } return got; }
  room(id) { const def = ITEMS[id]; const st = def ? def.stack || 1 : 1; let r = 0; for (const s of this.slots) { if (!s) r += st; else if (s.id === id) r += st - s.n; } return r; }
  empty() { return this.slots.every(s => !s); }
  items() { return this.slots.filter(Boolean); }
  clear() { this.slots.fill(null); }
  toJSON() { return this.slots.map(s => cloneStack(s)); }
  static from(arr, size) { const v = new Inv(Math.max(size || 0, arr ? arr.length : 0)); if (arr) arr.forEach((s, i) => { v.slots[i] = s ? cleanStack(cloneStack(s)) : null; }); return v; }
}

/** Player inventory: belt (6) + main (24 + bag) + equipment + artifact belt */
export class PlayerInv {
  constructor() { this.belt = new Inv(6); this.main = new Inv(24); this.equip = { helmet: null, armor: null, bag: null }; this.arts = [null, null]; }
  bagSlots() { const b = this.equip.bag && ITEMS[this.equip.bag.id]; return b ? b.slots || 0 : 0; }
  fixSize() { return this.main.resize(24 + this.bagSlots()); }
  count(id) { return this.belt.count(id) + this.main.count(id); }
  has(cost, extra) { for (const k in cost) if (this.count(k) + (extra ? extra.count(k) : 0) < cost[k]) return false; return true; }
  take(id, n) { let got = this.main.take(id, n); if (got < n) got += this.belt.take(id, n - got); return got; }
  takeCost(cost) { for (const k in cost) this.take(k, cost[k]); }
  /** smart add: tools/weapons/consumables prefer the belt. returns leftover */
  add(id, n = 1, extra) {
    const def = ITEMS[id]; if (!def) return 0;
    const beltFirst = ['gun', 'melee', 'throw'].includes(def.cat) || (['med', 'food', 'drink'].includes(def.cat) && this.belt.count(id) > 0);
    if (beltFirst) { n = this.belt.add(id, n, extra); if (n > 0) n = this.main.add(id, n, extra); }
    else { n = this.main.add(id, n, extra); if (n > 0) n = this.belt.add(id, n, extra); }
    return n;
  }
  addStack(s) { if (!s) return null; const left = this.add(s.id, s.n, stackExtra(s)); return left > 0 ? Object.assign(cloneStack(s), { n: left }) : null; }
  all() { return [...this.belt.items(), ...this.main.items()]; }
  armorVal() { let a = 0; for (const k of ['helmet', 'armor']) { const s = this.equip[k]; if (s) a += ITEMS[s.id].armor || 0; } return a; }
  radRes() { let r = 0; for (const k of ['helmet', 'armor']) { const s = this.equip[k]; if (s) r += ITEMS[s.id].rad || 0; } return Math.min(0.95, r); }
  toJSON() { const eq = {}; for (const k in this.equip) eq[k] = cloneStack(this.equip[k]); return { belt: this.belt.toJSON(), main: this.main.toJSON(), equip: eq, arts: this.arts.map(cloneStack) }; }
  static from(o) { const p = new PlayerInv(); if (!o) return p; if (o.equip) for (const k in p.equip) p.equip[k] = cloneStack(o.equip[k]) || null; if (Array.isArray(o.arts)) p.arts = [cloneStack(o.arts[0]), cloneStack(o.arts[1])]; p.belt = Inv.from(o.belt, 6); p.main = Inv.from(o.main, 24 + p.bagSlots()); return p; }
}

/** drop attachments a stack can't carry (unknown ids, wrong gun or slot) — saves / co-op data are not trusted */
function cleanStack(s) {
  if (!s || !s.att) return s;
  if (typeof s.att !== 'object' || !WEAPONS[s.id]) { delete s.att; return s; }
  const ok = attAllowed(s.id), att = {};
  for (const k in s.att) { const a = s.att[k]; if (ATTACH[a] && ATTACH[a].slot === k && ok.includes(a)) att[k] = a; }
  if (Object.keys(att).length) s.att = att; else delete s.att;
  return s;
}

// ---------------------------------------------------------------- weapon attachments
/** put attachment item `aid` on gun stack `g`; returns the attachment it replaced (item id) or null. Throws nothing: check canAttach first. */
export function attachTo(g, aid) {
  const A = ATTACH[aid]; if (!g || !A) return null;
  const old = g.att && g.att[A.slot] || null;
  g.att = Object.assign({}, g.att || null, { [A.slot]: aid });
  return old;
}
/** take the attachment in `slot` off gun stack `g`; returns its item id (or null) */
export function detachFrom(g, slot) {
  if (!g || !g.att || !g.att[slot]) return null;
  const id = g.att[slot]; const att = Object.assign({}, g.att); delete att[slot];
  if (Object.keys(att).length) g.att = att; else delete g.att;
  return id;
}
/** can attachment item `aid` go on gun `gid`? */
export function canAttach(gid, aid) { return !!(ATTACH[aid] && attAllowed(gid).includes(aid)); }

export function itemName(id) { return ITEMS[id] ? ITEMS[id].name : id; }
export function costText(cost, mult = 1) { return Object.entries(cost).map(([k, v]) => Math.ceil(v * mult) + ' ' + itemName(k)).join(', '); }
export function scaleCost(cost, m) { const o = {}; for (const k in cost) o[k] = Math.max(1, Math.ceil(cost[k] * m)); return o; }

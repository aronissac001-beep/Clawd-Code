// Entity field lists for the EC2 ENTITIES section (owner A; doc 11.3, contract C10).
//
// Entities travel as positional rows in schema field order (schema.js FIELDS, C2), with the field
// names written once per kind in the blob (`fl`), so a later build that appends fields (or a
// migration that renames one) still reads an older save by name. Movers' paths are NOT in the rows:
// they go to the binary RUNTIME section as u16 tile lists (save/rtsave.js).
//
// Item stacks are one flat int array (the bulk of a late save):
//   per slot: -1 for a free slot, else  k, m, q, n, x, y, hp, f, age   (k and m index `strs`; m -1 = null)
//   plus a side table `xs` of [id, { field: value }] for every other field that is not at its default
//   (name, maker, and any field added to the Stack schema later).

import { FIELDS, toRow, fromRow, fromPlain, make } from '../core/schema.js';

/** Entity kinds whose rows carry a path field that the RUNTIME section holds instead. */
export const PATH_KINDS = Object.freeze({ col: 'col', anim: 'anim', foes: 'foes' });
export const ITEM_FLAT = Object.freeze(['k', 'm', 'q', 'n', 'x', 'y', 'hp', 'f', 'age']);
const ITEM_W = ITEM_FLAT.length;

/** Field names per kind, as written in the blob. */
export function fieldLists() {
  const o = {};
  for (const k of Object.keys(FIELDS)) o[k] = FIELDS[k].map((f) => f.name);
  return o;
}

// Trailing fields at their default are left off a row (fromRow and entitiesOf fill them back in),
// which roughly halves a late save's building rows (finished walls carry no need, bills or owner).
const DEFAULTS = {};
function defaultsOf(kind) {
  if (!DEFAULTS[kind]) DEFAULTS[kind] = toRow(kind, make(kind)).map((v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
  return DEFAULTS[kind];
}
const emptyLike = (v, d) => (Array.isArray(v) ? v.length === 0 && d === '[]' : v.constructor === Object && d === '{}' && Object.keys(v).length === 0);
function isDefault(v, d) {
  if (v === null || typeof v !== 'object') return v === d;
  return typeof d === 'string' && emptyLike(v, d);
}

/**
 * A row for JSON.stringify straight away (snapshot): json fields are referenced, not cloned, since
 * the row is serialised before the sim runs again. Typed arrays become plain arrays; paths are
 * written by RUNTIME. Values are the same as schema.toRow's.
 */
function fastRow(spec, e) {
  const r = new Array(spec.length);
  for (let i = 0; i < spec.length; i++) {
    const f = spec[i], v = e[f.name];
    if (v === null || v === undefined) r[i] = null;
    else if (f.type === 'path') r[i] = { tiles: Array.from(v.tiles), i: v.i };
    else if (ArrayBuffer.isView(v)) r[i] = Array.from(v);
    else r[i] = v;
  }
  return r;
}

/** Rows of one collection (paths blanked for PATH_KINDS: RUNTIME carries them; trailing defaults trimmed). */
export function rowsOf(kind, list) {
  const pi = PATH_KINDS[kind] ? FIELDS[kind].findIndex((f) => f.name === 'path') : -1;
  const dflt = defaultsOf(kind), spec = FIELDS[kind];
  return list.map((e) => {
    if (e === null) return null;
    const r = fastRow(spec, e);
    if (pi >= 0) r[pi] = null;
    let n = r.length;
    while (n > 1 && (n - 1 === pi || isDefault(r[n - 1], dflt[n - 1]))) n--;
    if (n < r.length) r.length = n;
    return r;
  });
}

/**
 * Rows back to entities. `names` is the field list the blob was written with (null: the current one).
 * Fields the blob lacks take their defaults; fields the current schema lacks are dropped.
 */
export function entitiesOf(kind, rows, names = null) {
  if (!names) return rows.map((r) => fromRow(kind, r));
  const cur = FIELDS[kind].map((f) => f.name);
  const same = names.length <= cur.length && names.every((n, i) => n === cur[i]);
  if (same) return rows.map((r) => fromRow(kind, r));
  return rows.map((r) => {
    if (r === null) return null;
    const o = {};
    for (let i = 0; i < names.length && i < r.length; i++) o[names[i]] = r[i];
    return fromPlain(kind, o);
  });
}

// ---- Item stacks -----------------------------------------------------------------------------
const ITEM_DEFAULTS = () => make('items');
const SIDE_FIELDS = () => FIELDS.items.map((f) => f.name).filter((n) => n !== 'id' && !ITEM_FLAT.includes(n));

/** s.items -> { strs, a, xs } (deterministic: the string table is in first-use order). */
export function packItems(items) {
  const strs = [], at = new Map();
  const sid = (v) => { if (v === null || v === undefined) return -1; let k = at.get(v); if (k === undefined) { k = strs.length; strs.push(v); at.set(v, k); } return k; };
  const a = [], xs = [];
  const side = SIDE_FIELDS(), d = ITEM_DEFAULTS();
  for (let id = 0; id < items.length; id++) {
    const it = items[id];
    if (it === null) { a.push(-1); continue; }
    a.push(sid(it.k), sid(it.m), it.q, it.n, it.x, it.y, it.hp, it.f ? 1 : 0, it.age);
    let extra = null;
    for (const n of side) {
      const v = it[n];
      if (v !== d[n] && !(v === undefined)) { (extra || (extra = {}))[n] = v; }
    }
    if (extra) xs.push([id, extra]);
  }
  return { strs, a, xs };
}
/** { strs, a, xs } -> s.items (Stack objects with ids = index). */
export function unpackItems(p) {
  const out = [], { strs, a } = p;
  let o = 0;
  while (o < a.length) {
    if (a[o] === -1) { out.push(null); o++; continue; }
    const id = out.length;
    const e = make('items', { id, k: strs[a[o]], m: a[o + 1] < 0 ? null : strs[a[o + 1]], q: a[o + 2], n: a[o + 3], x: a[o + 4], y: a[o + 5], hp: a[o + 6], f: a[o + 7] === 1, age: a[o + 8] });
    out.push(e);
    o += ITEM_W;
  }
  for (const [id, extra] of p.xs || []) {
    const e = out[id];
    if (!e) continue;
    for (const n of Object.keys(extra)) if (n in e) e[n] = extra[n];
  }
  return out;
}

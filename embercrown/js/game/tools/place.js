// Placement helpers (owner I; doc 10.2, 10.3, 13.1 `js/game/tools/place.js`): the ghost that follows
// the finger when a Build card is picked. Read-only: the green/red footprint, the material chip's
// choices and the cost line come from here; the `place` / `placeLine` commands (C3) do the work.
// Rules come from A's appliers (core/apply.js checkPlace, needOf), so the ghost and the command agree.
import { W, H, clamp } from '../core/grid.js';
import { def, all, structDef, sizeOf, tilesOf, hasFlag } from '../core/content.js';
import { checkPlace, needOf } from '../core/apply.js';

/** How a def is placed by the finger: 'line' (walls, palisades and fences along a drag), 'rect' (floors, roads), 'single'. */
export function placeShape(d) {
  if (!d) return 'single';
  if (hasFlag(d, 'floor')) return 'rect';
  if ((hasFlag(d, 'wall') || hasFlag(d, 'fence')) && !hasFlag(d, 'door')) return 'line';
  return 'single';
}

/** Top-left tile so the footprint is centred under the finger tile. */
export function anchorFor(d, tile, rot = 0) {
  const [w, h] = sizeOf(d, rot);
  return { x: clamp(tile.x - ((w - 1) >> 1), 0, W - w), y: clamp(tile.y - ((h - 1) >> 1), 0, H - h) };
}

/** Next rotation: 1x1 and square defs do not rotate (0 stays 0); others turn a quarter. */
export function nextRot(d, rot) {
  const [w, h] = sizeOf(d, 0);
  return w === h ? 0 : (rot + 1) & 3;
}

/** The ghost of `defId` at top-left (x, y): { ok, why, tiles: [i] }. */
export function ghost(s, defId, x, y, rot = 0) {
  const d = structDef(defId);
  const why = d ? checkPlace(s, defId, x, y, rot) : 'unknown structure';
  return { ok: !why, why: why || null, tiles: d ? tilesOf(d, x, y, rot) : [] };
}

/** Distinct stone materials the colony has as blocks or rough stone (sorted by id), for the chip. */
export function stoneMats(s) {
  const set = new Set();
  for (const it of s.items) if (it && (it.k === 'block' || it.k === 'stone') && it.m) { const m = def('material', it.m); if (m && m.group === 'stone') set.add(it.m); }
  return [...set].sort();
}

/**
 * Material chip choices for a def: [{ id: matId | null, name }]. A def priced by material (walls,
 * flagstone) offers wood (when it takes wood), "Any stone" (null: the first blocks delivered set it)
 * and each stone the colony holds. Defs with a fixed cost, furniture and zones have no chip ([]).
 */
export function matChoices(s, d) {
  if (!d || !d.costByMat || !d.costByMat.length) return [];
  const out = [];
  const cats = d.costByMat.map((e) => e.cat);
  if (cats.includes('wood')) out.push({ id: 'wood', name: 'Wood' });
  if (cats.includes('blocks')) {
    out.push({ id: null, name: 'Any stone' });
    for (const m of stoneMats(s)) out.push({ id: m, name: def('material', m).name });
  }
  return out;
}

/** Floor choices for a room stamp: [{ id: floorMat | null, name }] (wood planks; flagstone per stone held). */
export function floorChoices(s) {
  const out = [{ id: 'wood', name: 'Planks' }];
  for (const m of stoneMats(s)) out.push({ id: m, name: def('material', m).name + ' flags' });
  return out;
}

const ITEM_NAME = (k) => { const it = def('item', k); if (it) return it.name; const c = all('itemCat').find((x) => x.id === k); return c ? c.name : k; };
/**
 * Cost line for a card or the tool hint: "Wood 40", "Blocks 5 or Wood 8 per tile", "Made at a
 * carpenter or mason" for furniture. mat narrows a costByMat def to the chosen material.
 */
export function costText(d, mat = undefined) {
  if (!d) return '';
  if (d.kind === 'zone') return 'Paint an area';
  if (d.kind === 'furniture') {
    const benches = all('recipe').filter((r) => r.out.some((o) => o.k === (d.item || d.id))).map((r) => r.bench).flat();
    const names = [...new Set(benches)].map((b) => { const bd = structDef(b); return bd ? bd.name.replace(/'s bench$/, '').toLowerCase() : b; });
    return names.length ? `Made at a ${names.join(' or ')}` : 'Installed from stock';
  }
  const per = d.size && d.size[0] * d.size[1] === 1 && (hasFlag(d, 'wall') || hasFlag(d, 'floor')) ? ' per tile' : '';
  if (d.costByMat && mat === undefined) return d.costByMat.map((e) => `${cap(ITEM_NAME(e.cat))} ${e.n}`).join(' or ') + per;
  const need = needOf(d, mat === undefined ? null : mat);
  const keys = Object.keys(need).sort();
  if (!keys.length) return 'Free';
  return keys.map((k) => `${cap(ITEM_NAME(k.split(':')[0]))} ${need[k]}`).join(', ') + per;
}
const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** Sum of needs over a list of [defId, mat] pairs: { key: n } (stamp and paste cost lines). */
export function sumNeeds(list) {
  const out = {};
  for (const [defId, mat] of list) {
    const d = structDef(defId);
    const n = needOf(d, mat);
    for (const k of Object.keys(n)) out[k] = (out[k] || 0) + n[k];
  }
  return out;
}
/** "Wood 96, bed 1" from a needs map (sorted keys). */
export function needsText(need) {
  const keys = Object.keys(need).sort();
  return keys.map((k) => `${cap(ITEM_NAME(k.split(':')[0]))} ${need[k]}`).join(', ');
}

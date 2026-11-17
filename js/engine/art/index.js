// Art kit API (owner D; doc 14.2 row D, 14.3 C9 "art key lookup"). Turns an art key (keys.js) and
// the thing being drawn (a building, a stack, a colonist, a tile) into pixels, with every sprite
// cached through sprites.js (its LRU and memory budget). Render only: js/game/ never imports this.
//
// For C's renderer (js/engine/render/*):
//   installKit(registerArt, { state })   register an entry for every structure def whose art key is in
//                                        the kit (C9 registerArt(def, entry)); state() -> the bound colony
//                                        (walls and doors join their neighbours through it)
//   entry = { key, size, w, h, draw(g, b, ctx, s?) }  draw places the building itself (b.x, b.y, b.rot,
//                                        b.mat, b.st 'frame' | 'done', b.open, b.got.work / work)
//   paintRockTile / paintMinedFloor / paintOreGlint / paintFloorTile / paintPileMark (ground.js, chunk bakes)
//   floorKeyOf(id)                       floor layer id -> art key ('struct.f_planks', ...), from the data order
//   drawItem(g, it, z, scale)            an item stack at its tile (zoom z < 0.5: a 4 px dot)
//   itemColour(it)                       the stack's dot colour (strategic view and minimap)
//   colonistSprite(c, frame, flip, scale, tool, prof) / toolOfJob(type, benchDef)   (people.js)
//   drawDesigMark / drawZoneTile / zoneTint / drawPip / drawRaidBlob   (marks.js)
// General:
//   drawArt(g, key, x, y, o)             any key with its footprint's top-left at world (x, y); o as in kit.js
//   missingParts()                       KIT_PARTS with no drawer (must be empty; the contact sheet checks it)
//   flame(g, x, y, r, t)                 the live flame

import { TILE, TER, W, H } from '../../game/core/grid.js';
import { CONTENT } from '../../data/index.js';
import { buildWork } from '../../game/work/construct.js';
import { BIOMES } from '../../data/biomes.js';
import * as SP from '../sprites.js';
import { ART, KIT_PARTS, artMeta, tintOf, familyOf, STONE_IDS, STONE_LOOK, ORE_LOOK } from './keys.js';
import { PARTS, TOP, WH, FLAME_AT, flame, bucketOf } from './kit.js';
import { PEOPLE_PARTS, colonistSprite, drawColonist, toolOfJob, CW, CH, CAX, CAY } from './people.js';
import { MARK_PARTS, drawDesigMark, drawZoneTile, zoneTint, drawPip, drawRaidBlob, DESIG_MARKS } from './marks.js';
import { paintGround, paintRockTile, paintMinedFloor, paintOreGlint, paintFloorTile, paintPileMark, rockColour, floorColour } from './ground.js';

export { paintGround, paintRockTile, paintMinedFloor, paintOreGlint, paintFloorTile, paintPileMark, rockColour, floorColour };
export { colonistSprite, drawColonist, toolOfJob, drawDesigMark, drawZoneTile, zoneTint, drawPip, drawRaidBlob, DESIG_MARKS, flame, bucketOf };

const T = TILE;
const M = 4; // sprite margin around the footprint (shadows, outlines)

// Ground and placeholder parts: drawn by other modules, listed here so every KIT_PART has a drawer.
const GROUND_PARTS = {
  rockface: (g, o) => paintGround(g, o.key || 'rock.granite', 0, 0, o), roughfloor: (g, o) => paintGround(g, 'floor.mined', 0, 0, o),
  rubblefloor: (g, o) => paintGround(g, 'floor.rubble', 0, 0, o), smoothfloor: (g, o) => paintGround(g, 'floor.smooth', 0, 0, o),
  pilemark: (g, o) => paintGround(g, 'ground.pile', 0, 0, o), oreglint: (g, o) => paintGround(g, o.key || 'ore.iron', 0, 0, o),
  planks: (g, o) => paintGround(g, 'struct.f_planks', 0, 0, o), flagstone: (g, o) => paintGround(g, 'struct.f_flag', 0, 0, o),
};
const UNIT = { 'unit.hound': 'hound', 'unit.husk': 'husk', 'unit.knight': 'knight', 'unit.shade': 'shade' };
const PLACE_PARTS = {};
for (const [p, u] of Object.entries(UNIT)) PLACE_PARTS[p] = (g) => { const sp = SP.unitSprite(u, 0, false, 2); g.drawImage(sp.c, 16 - sp.ax, 30 - sp.ay, sp.w, sp.h); };
for (const p of ['plant.oak', 'plant.pine', 'plant.hearthroot']) {
  PLACE_PARTS[p] = (g) => {
    if (p === 'plant.hearthroot') { PARTS.roots(g, { n: 1 }); return; }
    const sp = SP.treeSprite(p === 'plant.pine' ? 3 : 0, 2, BIOMES.greenvale), k = 0.62;
    g.drawImage(sp.c, 16 - sp.ax * k, 30 - sp.ay * k, sp.w * k, sp.h * k);
  };
}
/** Every part drawer by name. */
export const ALL_PARTS = Object.freeze({ ...PARTS, ...PEOPLE_PARTS, ...MARK_PARTS, ...GROUND_PARTS, ...PLACE_PARTS });
export function missingParts() { return KIT_PARTS.filter((p) => typeof ALL_PARTS[p] !== 'function'); }

// ---- Tints -----------------------------------------------------------------------------------------
/** Resolve a meta tint against a material: 'mat' (the material's tint), a stone or ore name, 'wood' / 'stone', or a colour. */
export function resolveTint(meta, mat) {
  const t = meta.tint;
  if (t === 'mat') { const fam = familyOf(mat, meta.kind === 'item' ? 'stone' : 'wood'); return tintOf(mat, fam); }
  if (t === 'wood' || t === 'stone') return tintOf(mat && familyOf(mat, t) === t ? mat : null, t);
  if (t && STONE_LOOK[t]) return STONE_LOOK[t].base;
  if (t && ORE_LOOK[t]) return ORE_LOOK[t].c;
  return t || '#9a6b3f';
}
function famFor(meta, mat) {
  if (meta.tint === 'wood') return 'wood';
  if (meta.tint === 'stone') return 'stone';
  return familyOf(mat, meta.kind === 'item' ? 'stone' : 'wood');
}

// ---- Structure sprites ------------------------------------------------------------------------------
/** Footprint [w, h] in tiles of a key at rotation rot (odd rotations swap). */
export function footOf(key, rot = 0) { const m = ART[key]; const s = (m && m.size) || [1, 1]; return rot & 1 ? [s[1], s[0]] : [s[0], s[1]]; }
const KEYS = new Map(); // key -> mat -> variant number -> sprite key string (no string building per frame)
function spriteKey(key, mat, vn) {
  let a = KEYS.get(key); if (!a) KEYS.set(key, (a = new Map()));
  const mk = mat || '';
  let b = a.get(mk); if (!b) a.set(mk, (b = new Map()));
  let s = b.get(vn); if (!s) b.set(vn, (s = `kit:${key}:${mk}:${vn}`));
  return s;
}
/**
 * Cached sprite of a structure, furniture or item key. o: { mat, rot, mask, open, v, n }.
 * Returns the sprites.js record { c, w, h, ax, ay }: draw at (footprint x - ax, footprint y - ay).
 */
export function kitSprite(key, scale, o = {}) {
  const meta = ART[key];
  if (!meta) return null;
  const rot = (o.rot | 0) & 3, mask = (o.mask | 0) & 15, open = o.open ? 1 : 0, v = (o.v | 0) & 7, n = (o.n | 0) & 3;
  const vn = rot | (mask << 2) | (open << 6) | (v << 7) | (n << 10);
  const [fw, fh] = meta.kind === 'item' ? [1, 1] : footOf(key, rot);
  const Wd = fw * T, Hd = fh * T, top = TOP[meta.base] ?? 16;
  const sk = spriteKey(key, o.mat, vn);
  const sp = SP.sprite(sk, scale, Wd + M * 2, Hd + top + M, M, top, (g) => {
    g.translate(M, top);
    const po = { W: Wd, H: Hd, rot, mask, open, v, n, mat: o.mat || null, fam: famFor(meta, o.mat), tint: resolveTint(meta, o.mat), key };
    ALL_PARTS[meta.base](g, po);
    for (const p of meta.props) if (p !== 'flame') ALL_PARTS[p](g, po);
  });
  sp.k = sk;
  return sp;
}

const WALLISH = new Set(['wall', 'door']);
/** Neighbour mask of a wall or door: N 1, E 2, S 4, W 8 when that side is a wall, a door or natural rock. */
export function wallMask(s, b) {
  if (!s || !s.rt || !s.rt.occ) return 0;
  const occ = s.rt.occ, L = s.L, x = b.x, y = b.y;
  const join = (nx, ny) => {
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) return false;
    const i = ny * W + nx;
    if (L.terrain[i] === TER.ROCK) return true;
    const id = occ[i];
    const o = id >= 0 ? s.bld[id] : null;
    return !!o && o.st !== 'bp' && WALLISH.has(o.def);
  };
  return (join(x, y - 1) ? 1 : 0) | (join(x + 1, y) ? 2 : 0) | (join(x, y + 1) ? 4 : 0) | (join(x - 1, y) ? 8 : 0);
}
/** A door stands open while a colonist (or anything that walks) is on its tile. */
function doorOpen(s, b) {
  if (b.open) return true;
  if (!s) return false;
  for (const c of s.col) if (Math.floor(c.x / T) === b.x && Math.floor(c.y / T) === b.y) return true;
  for (const f of s.foes) if (Math.floor(f.x / T) === b.x && Math.floor(f.y / T) === b.y) return true;
  return false;
}
/** Bed blanket colour (by building id) and the stone joint pattern of walls (by tile). */
const variantOf = (b) => (b.def === 'bed' ? b.id & 3 : (b.x * 7 + b.y * 3) & 1);

/** A renderer entry for one structure def (C9). */
export function entryFor(defId, key, getState) {
  const meta = ART[key];
  const d = CONTENT.get('structure', defId);
  const size = (d && d.size) || meta.size;
  const isFloor = meta.kind === 'floor';
  const flameAt = FLAME_AT[key];
  const o = { mat: null, rot: 0, mask: 0, open: false, v: 0, n: 0 };
  return {
    key, size: Math.max(size[0], size[1]), w: size[0], h: size[1],
    sprite: null,
    draw(g, b, ctx, s) {
      const st = s || ctx.state || (getState && getState()) || null;
      const x = b.x * T, y = b.y * T;
      if (isFloor) { // a floor still being laid (done floors live in the floor layer)
        g.save(); g.globalAlpha = 0.75; g.translate(x - b.x * T, y - b.y * T);
        paintFloorTile(g, key, b.x, b.y, b.mat, true); g.restore();
        if (b.st === 'frame') progressBar(g, x + T / 2, y + 4, progressOf(b));
        return;
      }
      o.mat = b.mat; o.rot = b.rot | 0; o.open = b.def === 'door' && doorOpen(st, b); o.v = variantOf(b);
      o.mask = WALLISH.has(b.def) ? wallMask(st, b) : 0;
      const sp = kitSprite(key, ctx.scale, o);
      if (!sp) return;
      const dx = x - sp.ax, dy = y - sp.ay;
      if (b.st === 'frame') {
        const p = progressOf(b), sh = Math.max(2, sp.h * p);
        g.globalAlpha = 0.45; g.drawImage(sp.c, dx, dy, sp.w, sp.h); g.globalAlpha = 1; // the ghost of the finished piece
        const sy = (sp.h - sh) * (sp.c.height / sp.h);
        g.drawImage(sp.c, 0, sy, sp.c.width, sp.c.height - sy, dx, dy + sp.h - sh, sp.w, sh);
        const [fw] = footOf(key, o.rot);
        const sc = SP.scaffoldSprite(Math.max(1, fw), ctx.scale);
        g.drawImage(sc.c, x - sc.ax, y - sc.ay, sc.w, sc.h);
        progressBar(g, x + (fw * T) / 2, dy - 4, p);
        return;
      }
      g.drawImage(sp.c, dx, dy, sp.w, sp.h);
      if (b.hitT > 0) { const f = sp.flash || SP.flashOf(sp, sp.k, ctx.scale); g.globalAlpha = Math.min(1, b.hitT / 0.14) * 0.7; g.drawImage(f.c, dx, dy, sp.w, sp.h); g.globalAlpha = 1; }
      if (flameAt) { const [fx, fy, fr] = flameAt({ W: footOf(key, o.rot)[0] * T, H: footOf(key, o.rot)[1] * T }); flame(g, x + fx, y + fy, fr, ctx.time || 0, !!ctx.reduceMotion); }
    },
  };
}
function progressOf(b) {
  let need = 1;
  try { need = Math.max(1, buildWork(b)); } catch (_) { need = 1; }
  return Math.max(0.06, Math.min(1, (b.work || 0) / need));
}
function progressBar(g, x, y, p) {
  g.fillStyle = 'rgba(20,14,10,0.75)'; g.fillRect(x - 15, y - 2, 30, 5);
  g.fillStyle = '#f0c040'; g.fillRect(x - 14, y - 1, 28 * Math.max(0, Math.min(1, p)), 3);
}

/**
 * Register the kit with the renderer (C9). registerArt(key, entry) for every structure art key the kit
 * draws (placeholders included, so later defs never fall back to a blank box); registerTileArt(kind,
 * fn) for the baked tile painters 'rock', 'rough' and 'floor' (render/terrain.js hooks). opts.state:
 * () => the bound colony (wall and door joins, doors open under a colonist) when ctx has no `state`.
 * Returns the art keys registered.
 */
export function installKit(registerArt, registerTileArt = null, opts = {}) {
  const done = [];
  for (const d of CONTENT.all('structure')) {
    const meta = d.art && artMeta(d.art);
    if (!meta || (meta.kind !== 'struct' && meta.kind !== 'floor') || done.includes(d.art)) continue;
    registerArt(d.art, entryFor(d.id, d.art, opts.state));
    done.push(d.art);
  }
  if (registerTileArt) {
    registerTileArt('rock', (g, x, y, t) => { paintRockTile(g, x, y, t.mask, t.mat, t.known, t.detail); if (t.known && t.ore) paintOreGlint(g, x, y, t.ore, t.detail); return true; });
    registerTileArt('rough', (g, x, y, t) => { paintMinedFloor(g, x, y, t.mat, t.detail, !!t.rubble); return true; });
    registerTileArt('floor', (g, x, y, t) => {
      const d = t.id ? CONTENT.get('structure', t.id) : null;
      if (!d || !d.art || !artMeta(d.art) || artMeta(d.art).kind !== 'floor') return false;
      paintFloorTile(g, d.art, x, y, t.mat || null, t.detail); return true;
    });
  }
  return done;
}

// ---- Floors from the floor layer --------------------------------------------------------------------
let FLOOR_KEYS = null;
/** Floor layer id (1-based, the data order of 'floor' structures, core/apply.js floorIdOf) -> art key. */
export function floorKeyOf(id) {
  if (!FLOOR_KEYS) FLOOR_KEYS = CONTENT.all('structure').filter((d) => d.flags && d.flags.includes('floor')).map((d) => d.art || null);
  return id > 0 ? FLOOR_KEYS[id - 1] || null : null;
}

// ---- Items ------------------------------------------------------------------------------------------
const ITEM_DOT = { wood: '#a7774a', stone: '#9a958e', ore: '#b0603c', coal: '#2a2a30', block: '#b8b2a8', ingot: '#9aa0a8' };
/** Dot colour of a stack (strategic view, minimap). */
export function itemColour(it) {
  if (it.k === 'stone' || it.k === 'block') return tintOf(it.m, 'stone');
  if (it.k === 'ore') return tintOf(it.m, 'stone');
  return ITEM_DOT[it.k] || '#d8a64a';
}
/** An item stack at its tile (g in world units). z < 0.5: a 4 px colour dot. */
export function drawItem(g, it, z = 1, scale = 2) {
  const x = it.x * T, y = it.y * T;
  if (z < 0.5) { const s2 = 2 / z; g.fillStyle = itemColour(it); g.fillRect(x + T / 2 - s2, y + T / 2 - s2, s2 * 2, s2 * 2); return; }
  const d = CONTENT.get('item', it.k);
  const key = (d && d.art) || 'item.stone';
  const sp = kitSprite(ART[key] ? key : 'item.stone', scale, { mat: it.m, n: bucketOf(it.n | 0, d ? d.stack : 75) });
  if (sp) g.drawImage(sp.c, x - sp.ax, y - sp.ay, sp.w, sp.h);
  if (it.f) { g.strokeStyle = 'rgba(255,90,90,0.9)'; g.lineWidth = 1.5; g.beginPath(); g.arc(x + T - 6, y + 6, 4, 0, 6.283); g.moveTo(x + T - 9, y + 9); g.lineTo(x + T - 3, y + 3); g.stroke(); }
}

// ---- Any key ---------------------------------------------------------------------------------------
/**
 * Draw any key with its footprint's top-left at world (x, y). o: { mat, rot, mask, open, v, n, t,
 * look, tool, prof, frame, mood, role, z, scale }. Ground keys use (o.tx, o.ty) for their hash.
 * Returns false for an unknown key (or an icon: those are SVG, see js/ui/icons.js).
 */
export function drawArt(g, key, x, y, o = {}) {
  const meta = artMeta(key);
  if (!meta || meta.kind === 'icon') return false;
  const scale = o.scale || 2;
  switch (meta.kind) {
    case 'ground': case 'floor': {
      const tx = o.tx | 0, ty = o.ty | 0;
      g.save(); g.translate(x - tx * T, y - ty * T);
      paintGround(g, key, tx, ty, { ...o, mat: o.mat ?? (meta.tint === 'mat' ? 'granite' : undefined) });
      g.restore();
      return true;
    }
    case 'struct': case 'item': {
      const sp = kitSprite(key, scale, o);
      g.drawImage(sp.c, x - sp.ax, y - sp.ay, sp.w, sp.h);
      const fa = FLAME_AT[key];
      if (fa) { const [fw, fh] = footOf(key, o.rot | 0); const [fx, fy, fr] = fa({ W: fw * T, H: fh * T }); flame(g, x + fx, y + fy, fr, o.t || 0); }
      return true;
    }
    case 'mark': {
      if (meta.base === 'ghost') { g.save(); g.translate(x, y); MARK_PARTS.ghost(g, { W: T, H: T }); g.restore(); return true; }
      g.save(); g.translate(x, y); drawDesigMark(g, key.slice(5), 0, 0, 1); g.restore();
      return true;
    }
    case 'zone': { g.save(); g.translate(x, y); drawZoneTile(g, key.slice(8), 0, 0, 15, 1, o.v | 0); g.restore(); return true; }
    case 'pip': {
      if (meta.base === 'raidblob') { g.save(); g.translate(x, y); MARK_PARTS.raidblob(g); g.restore(); return true; }
      drawPip(g, x + T / 2, y + T / 2, o.z || 1, { kind: key === 'pip.foe' ? 'foe' : 'colonist', role: o.role || 'miner', mood: o.mood ?? 72, drafted: key === 'pip.drafted' });
      return true;
    }
    case 'colonist': {
      const anc = key.slice(9);
      const sp = colonistSprite({ anc, look: o.look || { skin: 1, hair: 0, hairC: 1, beard: 2, cloth: 0 } }, o.frame | 0, !!o.flip, scale, o.tool || '', o.prof || '');
      g.drawImage(sp.c, x + T / 2 - sp.ax, y + T - 2 - sp.ay, sp.w, sp.h);
      return true;
    }
    default: { // look, hair, beard, cloth, tool, plant, animal, foe: their part draws in a 32 x 32 cell
      g.save(); g.translate(x, y);
      ALL_PARTS[meta.base](g, { W: T, H: T, v: o.v | 0, tint: meta.tint, look: o.look, key });
      g.restore();
      return true;
    }
  }
}
export { CW, CH, CAX, CAY, WH, STONE_IDS };

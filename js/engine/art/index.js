// Art kit API (owner D; doc 14.2 row D, 14.3 C9 "art key lookup", docs/ART-STYLE.md). Turns an art
// key (keys.js) and the thing being drawn (a building, a stack, a colonist, a tile) into pixel-art
// sprites baked at their native size (16 px per tile, pixel.js) and cached through sprites.js. The
// renderer draws them at an integer scale with image smoothing off. Render only: js/game/ never
// imports this.
//
// For C's renderer (js/engine/render/*):
//   installKit(registerArt, registerTileArt, { state })   register an entry for every structure def whose art
//                                        key is in the kit (C9 registerArt(def, entry)) and the tile painters
//                                        'rock', 'rough' and 'floor'; state() -> the bound colony
//   GROUND_ART                           the surface painters terrain.js uses (surface, shadowN, blight, shimmer)
//   entry = { key, size, w, h, draw(g, b, ctx, s?) }  draw places the building itself (b.x, b.y, b.rot,
//                                        b.mat, b.st 'frame' | 'done', b.open, b.work)
//   paintRockTile / paintMinedFloor / paintOreGlint / paintFloorTile / paintPileMark (ground.js, chunk bakes)
//   floorKeyOf(id)                       floor layer id -> art key ('struct.f_planks', ...), from the data order
//   drawItem(g, it, z, scale)            an item stack at its tile (zoom z < 0.5: a 4 px dot)
//   itemColour(it)                       the stack's dot colour (strategic view and minimap)
//   colonistSprite / toolOfJob / carryOf / selectRing (people.js); foeSprite / animalSprite / treeSprite /
//   bushSprite / cropSprite / stageOf (beings.js); markSprite / zoneSprite / ghostSprite / pipSprite /
//   drawDesigMark / drawZoneTile / zoneTint / drawPip / drawRaidBlob (marks.js); flame / flameSprite (kit.js);
//   scaffoldSprite(w), drawProgress(g, x, y, p), pixelRim(sp, ci)
// General:
//   drawArt(g, key, x, y, o)             any key with its footprint's top-left at world (x, y); o as in kit.js
//   missingParts()                       KIT_PARTS with no drawer (must be empty; the contact sheet checks it)

import { TILE, TER, W, H } from '../../game/core/grid.js';
import { CONTENT } from '../../data/index.js';
import { buildWork } from '../../game/work/construct.js';
import * as SP from '../sprites.js';
import { PAL, RAMP, rampOf } from './palette.js';
import { bake, Px, NPX, pixelRim } from './pixel.js';
import { ART, KIT_PARTS, artMeta, tintOf, familyOf, STONE_IDS, STONE_LOOK, ORE_LOOK } from './keys.js';
import { PARTS, TOP, WH, WHP, FLAME_AT, flame, flameSprite, bucketOf } from './kit.js';
import { PEOPLE_PARTS, colonistSprite, drawColonist, toolOfJob, carryOf, selectRing, CW, CH, CAX, CAY } from './people.js';
import { foeSprite, animalSprite, treeSprite, bushSprite, cropSprite, stageOf } from './beings.js';
import { MARK_PARTS, markSprite, zoneSprite, ghostSprite, pipSprite, stripeSprite, previewSprite, pixelPath, drawDesigMark, drawZoneTile, zoneTint, drawPip, drawRaidBlob, DESIG_MARKS } from './marks.js';
import { paintGround, paintRockTile, paintMinedFloor, paintOreGlint, paintFloorTile, paintPileMark, paintSurfaceTile, paintShadowN, paintBlight, paintShimmer, rockColour, floorColour, terrainColour } from './ground.js';

export { paintGround, paintRockTile, paintMinedFloor, paintOreGlint, paintFloorTile, paintPileMark, paintSurfaceTile, rockColour, floorColour, terrainColour };
export { colonistSprite, drawColonist, toolOfJob, carryOf, selectRing, foeSprite, animalSprite, treeSprite, bushSprite, cropSprite, stageOf };
export { markSprite, zoneSprite, ghostSprite, pipSprite, stripeSprite, previewSprite, pixelPath, drawDesigMark, drawZoneTile, zoneTint, drawPip, drawRaidBlob, DESIG_MARKS, flame, flameSprite, bucketOf, pixelRim };

const T = TILE;
const M = 2; // sprite margin (px) around the footprint (outlines, shadows)
/** Terrain painters for render/terrain.js (installed by useArtKit; not tile-art hooks). */
export const GROUND_ART = Object.freeze({ surface: paintSurfaceTile, shadowN: paintShadowN, blight: paintBlight, shimmer: paintShimmer, colour: terrainColour });

// Ground and creature parts drawn by the other modules, listed here so every KIT_PART has a drawer.
const groundIn = (p, key, o) => { const g = p.g; g.save(); g.translate(p.ox, p.oy); g.scale(1 / NPX, 1 / NPX); paintGround(g, key, 0, 0, o); g.restore(); p.fs = null; };
const GROUND_PARTS = {
  rockface: (p, o) => groundIn(p, o.key && o.key.startsWith('rock.') ? o.key : 'rock.granite', o), roughfloor: (p, o) => groundIn(p, 'floor.mined', o),
  rubblefloor: (p, o) => groundIn(p, 'floor.rubble', o), smoothfloor: (p, o) => groundIn(p, 'floor.smooth', o),
  pilemark: (p, o) => groundIn(p, 'ground.pile', o), oreglint: (p, o) => groundIn(p, o.key && o.key.startsWith('ore.') ? o.key : 'ore.iron', o),
  planks: (p, o) => groundIn(p, 'struct.f_planks', o), flagstone: (p, o) => groundIn(p, 'struct.f_flag', o),
};
const stamp = (p, sp, cx, by) => p.g.drawImage(sp.c, p.ox + Math.round(cx - sp.ax / NPX), p.oy + Math.round(by - sp.ay / NPX));
const PLACE_PARTS = {
  'unit.hound': (p) => stamp(p, foeSprite('hound', 0), 8, 15), 'unit.husk': (p) => stamp(p, foeSprite('husk', 0), 8, 15),
  'unit.delver': (p) => stamp(p, foeSprite('delver', 0), 8, 15), 'unit.shade': (p) => stamp(p, foeSprite('gloomwyrm', 0), 8, 15),
  'unit.knight': (p) => stamp(p, foeSprite('colossus', 0), 8, 15),
  'beast.hen': (p) => stamp(p, animalSprite('hen', 0), 8, 15), 'beast.goat': (p) => stamp(p, animalSprite('goat', 0), 8, 15), 'beast.wolf': (p) => stamp(p, animalSprite('wolf', 0), 8, 15),
  'plant.oak': (p, o) => stamp(p, treeSprite('oak', o.v | 0, 2), 8, 15), 'plant.pine': (p, o) => stamp(p, treeSprite('pine', o.v | 0, 2), 8, 15),
  'plant.hearthroot': (p) => stamp(p, cropSprite('hearthroot', 2), 8, 13), 'plant.berry': (p, o) => stamp(p, bushSprite(o.v | 0, true), 8, 14),
};
/** Every part drawer by name: drawer(p, o) in native px (pixel.js Px). */
export const ALL_PARTS = Object.freeze({ ...PARTS, ...PEOPLE_PARTS, ...MARK_PARTS, ...GROUND_PARTS, ...PLACE_PARTS });
export function missingParts() { return KIT_PARTS.filter((p) => typeof ALL_PARTS[p] !== 'function'); }

// ---- Tints -----------------------------------------------------------------------------------------
/** Resolve a meta tint against a material to a palette colour (dot colours, legends). */
export function resolveTint(meta, mat) {
  const t = meta.tint;
  if (t === 'mat') { const fam = familyOf(mat, meta.kind === 'item' ? 'stone' : 'wood'); return tintOf(mat, fam); }
  if (t === 'wood' || t === 'stone') return tintOf(mat && familyOf(mat, t) === t ? mat : null, t);
  if (t && STONE_LOOK[t]) return STONE_LOOK[t].base;
  if (t && ORE_LOOK[t]) return ORE_LOOK[t].c;
  return t || PAL.umber3;
}
function famFor(meta, mat) {
  if (meta.tint === 'wood') return mat && familyOf(mat, 'wood') !== 'wood' ? familyOf(mat, 'wood') : 'wood';
  if (meta.tint === 'stone') return mat && familyOf(mat, 'stone') === 'metal' ? 'metal' : 'stone';
  return familyOf(mat, meta.kind === 'item' ? 'stone' : 'wood');
}
/** The palette ramp a key draws with for material mat. */
function rampFor(meta, mat) {
  const fam = famFor(meta, mat);
  if (meta.tint === 'mat' || ((meta.tint === 'wood' || meta.tint === 'stone') && mat)) return rampOf(mat, fam);
  return fam === 'stone' ? RAMP.granite : fam === 'metal' ? RAMP.iron : RAMP.wood;
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
const PO = { W: 16, H: 16, rot: 0, mask: 0, open: 0, v: 0, n: 0, mat: null, fam: 'wood', r: RAMP.wood, tint: '', key: '' };
/**
 * Cached pixel sprite of a structure, furniture or item key. o: { mat, rot, mask, open, v, n }.
 * Returns the sprites.js record { c, w, h, ax, ay } (world units): draw at (footprint x - ax, y - ay).
 */
export function kitSprite(key, scale, o = {}) {
  const meta = ART[key];
  if (!meta) return null;
  const rot = (o.rot | 0) & 3, mask = (o.mask | 0) & 15, open = o.open ? 1 : 0, v = (o.v | 0) & 7, n = (o.n | 0) & 3;
  const vn = rot | (mask << 2) | (open << 6) | (v << 7) | (n << 10);
  const [fw, fh] = meta.kind === 'item' ? [1, 1] : footOf(key, rot);
  const Wd = fw * 16, Hd = fh * 16, top = TOP[meta.base] ?? 8;
  const sk = spriteKey(key, o.mat, vn);
  const wall = meta.base === 'wallblock';
  const skip = wall ? (x, y) => ((mask & 2) && x >= M + Wd) || ((mask & 8) && x < M) || ((mask & 1) && y < M + top - WHP) || ((mask & 4) && y >= M + top + Hd) : null;
  const sp = bake(sk, Wd + M * 2, Hd + top + M * 2, M, M + top, (p) => {
    const q = new Px(p.g, M, M + top);
    const po = PO;
    po.W = Wd; po.H = Hd; po.rot = rot; po.mask = mask; po.open = open; po.v = v; po.n = n; po.mat = o.mat || null;
    po.fam = famFor(meta, o.mat); po.r = rampFor(meta, o.mat); po.tint = resolveTint(meta, o.mat); po.key = key;
    ALL_PARTS[meta.base](q, po);
    for (const pp of meta.props) if (pp !== 'flame') { q.fs = null; ALL_PARTS[pp](q, po); }
  }, wall ? { skip, after: (p) => { if (!(mask & 4)) { p.dither(M, M + top + Hd + 1, Wd, 1, PAL.ink, 8); } } } : null);
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

/** Pixel scaffold over a frame being built (w tiles wide): poles, a cross brace and a plank. */
export function scaffoldSprite(w = 1) {
  const Wd = w * 16;
  return bake(`scaffold:${w}`, Wd + 2, 28, 1, 10, (p) => {
    const r = RAMP.wood;
    for (let x = 1; x <= Wd; x += Math.max(8, Wd / Math.max(1, w * 2))) p.rect(Math.min(Wd - 1, x), 0, 1, 26, r[1]);
    p.rect(1, 0, 1, 26, r[1]); p.rect(Wd, 0, 1, 26, r[1]);
    p.line(1, 24, Wd, 4, r[0]);
    p.rect(1, 12, Wd, 2, r[2]); p.hl(1, 12, Wd, r[3]);
    p.rect(1, 1, Wd, 1, r[2]);
  });
}
/** A pixel progress bar (14 x 3 px) centred at world (x, y). */
export function drawProgress(g, x, y, f) {
  const x0 = Math.round(x / NPX) * NPX - 16, y0 = Math.round(y / NPX) * NPX - 4;
  g.fillStyle = PAL.ink; g.fillRect(x0, y0, 32, 8);
  g.fillStyle = PAL.umber1; g.fillRect(x0 + 2, y0 + 2, 28, 4);
  g.fillStyle = PAL.gold; g.fillRect(x0 + 2, y0 + 2, Math.round(14 * Math.max(0, Math.min(1, f))) * NPX, 4);
}

/** A renderer entry for one structure def (C9). */
export function entryFor(defId, key, getState) {
  const meta = ART[key];
  const d = CONTENT.get('structure', defId);
  const size = (d && d.size) || meta.size;
  const isFloor = meta.kind === 'floor';
  const flameAt = FLAME_AT[key];
  const o = { mat: null, rot: 0, mask: 0, open: false, v: 0, n: 0 };
  const fo = { W: 0, H: 0 };
  return {
    key, size: Math.max(size[0], size[1]), w: size[0], h: size[1],
    sprite: null,
    draw(g, b, ctx, s) {
      const st = s || ctx.state || (getState && getState()) || null;
      const x = b.x * T, y = b.y * T;
      if (isFloor) { // a floor still being laid (done floors live in the floor layer)
        g.save(); g.globalAlpha = 0.75; paintFloorTile(g, key, b.x, b.y, b.mat, true); g.restore();
        if (b.st === 'frame') drawProgress(g, x + T / 2, y + 6, progressOf(b));
        return;
      }
      o.mat = b.mat; o.rot = b.rot | 0; o.open = b.def === 'door' && doorOpen(st, b); o.v = variantOf(b);
      o.mask = WALLISH.has(b.def) ? wallMask(st, b) : 0;
      const sp = kitSprite(key, ctx.scale, o);
      if (!sp) return;
      const dx = x - sp.ax, dy = y - sp.ay;
      if (b.st === 'frame') {
        const pr = progressOf(b), hpx = sp.c.height, shp = Math.max(1, Math.round(hpx * pr));
        g.globalAlpha = 0.4; g.drawImage(sp.c, dx, dy, sp.w, sp.h); g.globalAlpha = 1; // the ghost of the finished piece
        g.drawImage(sp.c, 0, hpx - shp, sp.c.width, shp, dx, dy + (hpx - shp) * NPX, sp.w, shp * NPX);
        const [fw] = footOf(key, o.rot);
        const sc = scaffoldSprite(Math.max(1, fw));
        g.drawImage(sc.c, x - sc.ax, y - sc.ay, sc.w, sc.h);
        drawProgress(g, x + (fw * T) / 2, dy - 6, pr);
        return;
      }
      g.drawImage(sp.c, dx, dy, sp.w, sp.h);
      if (b.hitT > 0) { const f = sp.flash || SP.flashOf(sp, sp.k, 0.5); g.globalAlpha = Math.min(1, b.hitT / 0.14) * 0.7; g.drawImage(f.c, dx, dy, sp.w, sp.h); g.globalAlpha = 1; }
      if (flameAt) { const [fw, fh] = footOf(key, o.rot); fo.W = fw * T; fo.H = fh * T; const [fx, fy, fr] = flameAt(fo); flame(g, x + fx, y + fy, fr, ctx.time || 0, !!ctx.reduceMotion); }
    },
  };
}
function progressOf(b) {
  let need = 1;
  try { need = Math.max(1, buildWork(b)); } catch (_) { need = 1; }
  return Math.max(0.06, Math.min(1, (b.work || 0) / need));
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
    registerTileArt('rock', (g, x, y, t) => { paintRockTile(g, x, y, t.mask, t.mat, t.known, t.detail); if (t.known && t.ore) paintOreGlint(g, x, y, t.ore, t.detail, t.mask); return true; });
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
const ITEM_DOT = { wood: RAMP.wood[2], stone: PAL.stone1, ore: PAL.ember1, coal: PAL.night, block: PAL.mist, ingot: PAL.slate3 };
/** Dot colour of a stack (strategic view, minimap). */
export function itemColour(it) {
  if (it.k === 'stone' || it.k === 'block' || it.k === 'ore') return tintOf(it.m, 'stone');
  return ITEM_DOT[it.k] || PAL.gold;
}
const IO = { mat: null, n: 0 };
/** An item stack at its tile (g in world units). z < 0.5: a 4 px colour dot. */
export function drawItem(g, it, z = 1, scale = 2) {
  const x = it.x * T, y = it.y * T;
  if (z < 0.5) { const s2 = 2 / z; g.fillStyle = itemColour(it); g.fillRect(x + T / 2 - s2, y + T / 2 - s2, s2 * 2, s2 * 2); return; }
  const d = CONTENT.get('item', it.k);
  const key = (d && d.art) || 'item.stone';
  IO.mat = it.m; IO.n = bucketOf(it.n | 0, d ? d.stack : 75);
  const sp = kitSprite(ART[key] ? key : 'item.stone', scale, IO);
  if (sp) g.drawImage(sp.c, x - sp.ax, y - sp.ay, sp.w, sp.h);
  if (it.f) { // forbidden: a small red slashed ring
    const f = bake('forbid-badge', 7, 7, 0, 0, (p) => { p.ring(3, 3, 3, PAL.danger); p.line(1, 5, 5, 1, PAL.danger); }, { outline: false });
    g.drawImage(f.c, x + T - 14, y, f.w, f.h);
  }
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
      if (meta.base === 'ghost') { const sp = ghostSprite(1, 1); g.drawImage(sp.c, x, y, sp.w, sp.h); return true; }
      const sp = markSprite(key.slice(5)); g.drawImage(sp.c, x, y, sp.w, sp.h);
      return true;
    }
    case 'zone': { const sp = zoneSprite(key.slice(8), 15, o.v | 0); g.drawImage(sp.c, x, y, sp.w, sp.h); return true; }
    case 'pip': {
      if (meta.base === 'raidblob') { drawRaidBlob(g, [x + 8, y + 10, x + 22, y + 12, x + 14, y + 22], o.z || 1.6, 3); return true; }
      drawPip(g, x + T / 2, y + T / 2, o.z || 1, { kind: key === 'pip.foe' ? 'foe' : 'colonist', role: o.role || 'miner', mood: o.mood ?? 72, drafted: key === 'pip.drafted' });
      return true;
    }
    case 'colonist': {
      const anc = key.slice(9);
      const sp = colonistSprite({ anc, look: o.look || { skin: 1, hair: 0, hairC: 1, beard: 2, cloth: 0 }, role: o.role }, o.frame | 0, !!o.flip, scale, o.tool || '', o.prof || '');
      g.drawImage(sp.c, x + T / 2 - sp.ax, y + T - 4 - sp.ay, sp.w, sp.h);
      return true;
    }
    case 'plant': case 'animal': case 'foe': {
      const sp = creatureOf(key, o);
      g.drawImage(sp.c, x + T / 2 - sp.ax, y + T - 4 - sp.ay, sp.w, sp.h);
      return true;
    }
    default: { // look, hair, beard, cloth, tool: their part draws in a 16 x 16 px cell
      const sp = bake(`part:${key}:${o.v | 0}`, 20, 22, 2, 4, (p) => { const q = new Px(p.g, 2, 4); ALL_PARTS[meta.base](q, { W: 16, H: 16, v: o.v | 0, tint: meta.tint, look: o.look, key }); });
      g.drawImage(sp.c, x - sp.ax, y - sp.ay, sp.w, sp.h);
      return true;
    }
  }
}
/** The sprite of a plant, animal or foe key. */
export function creatureOf(key, o = {}) {
  switch (key) {
    case 'plant.oak': return treeSprite('oak', o.v | 0, o.stage ?? 2);
    case 'plant.pine': return treeSprite('pine', o.v | 0, o.stage ?? 2);
    case 'plant.berry': return bushSprite(o.v | 0, o.ripe !== false);
    case 'plant.hearthroot': return cropSprite('hearthroot', o.stage ?? 2);
    case 'animal.hen': return animalSprite('hen', o.frame | 0, !!o.flip);
    case 'animal.goat': return animalSprite('goat', o.frame | 0, !!o.flip);
    case 'animal.wolf': return animalSprite('wolf', o.frame | 0, !!o.flip);
    case 'foe.hound': return foeSprite('hound', o.frame | 0, !!o.flip);
    case 'foe.delver': return foeSprite('delver', o.frame | 0, !!o.flip);
    case 'boss.gloomwyrm': return foeSprite('gloomwyrm', o.frame | 0, !!o.flip);
    case 'boss.colossus': return foeSprite('colossus', o.frame | 0, !!o.flip);
    default: return foeSprite('husk', o.frame | 0, !!o.flip);
  }
}
export { CW, CH, CAX, CAY, WH, STONE_IDS };

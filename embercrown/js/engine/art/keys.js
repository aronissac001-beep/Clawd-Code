// Art key registry (owner D; doc 14.2 row D, 14.6 row D). Every `art`, `icon` and `look` string in
// the content data (js/data/*) names a key here. A key is a kit recipe: a base part, optional prop
// parts and a material tint (doc 14.2: "kit = base + props + material tint"), plus its footprint
// and the stage that first needs it. The drawing lives in the sibling modules:
//   ground.js  rock faces (16 autotile masks per stone), mined floor, ore glints, built floors, pile marks
//   kit.js     structures and furniture (wood and stone families), benches and tool props, items
//   people.js  colonists (body, skin, 4 hair styles x 6 palettes, beards, 6 clothes palettes, looks, tools)
//   marks.js   designation marks, zone tints, strategic pips
//   index.js   drawArt / artSprite / installKit (registers the structure kit with the renderer, C9)
//   sheet.js   the contact sheet (?debug=1&scene=art)
//
// Pure: no DOM, no canvas and no side effects at import (validate-data and check-imports load it
// in Node). API:
//   ART                 key -> meta { kind, base, props, tint, size, stage, label, placeholder? }
//   ART_KEYS            every registered key (sorted), icons included
//   hasArtKey(k)        true when k resolves (validate-data art check, 13.4)
//   artMeta(k)          the meta, or null (icons: { kind: 'icon' })
//   keysOfKind(kind)    the keys of one kind, in registry order
//   KIT_PARTS           every base and prop part name the kit must implement (kit.js tests it)
//   STONE_IDS, ORE_IDS  the stone and deposit names in L.mat / L.ore order (worldgen.js STONES, DEPOSITS)
//   STONE_LOOK, ORE_LOOK, MAT_TINT, tintOf(mat)   the palettes the painters share
//   SFX                 the sound effect names audio.js plays for the slice and the first night (C8 consumers use them)

import { ICON_NAMES } from '../../ui/icons.js';
import { STONES, DEPOSITS } from '../../data/worldgen.js';
import { DATA as MATERIALS } from '../../data/materials.js';
import { PAL, STONE_RAMP, ORE_PX, rampOf } from './palette.js';

/** L.mat order (index = layer value); '' is no stone. */
export const STONE_IDS = STONES;
/** L.ore order (index = layer value); '' is no deposit. */
export const ORE_IDS = DEPOSITS;

/**
 * Stone looks (kept for older callers; the pixel painters use palette.js STONE_RAMP): base, lit
 * edge, dark face, motif and fleck, all palette colours.
 */
export const STONE_LOOK = Object.freeze(Object.fromEntries(Object.entries(STONE_RAMP).map(([k, v]) => [k, Object.freeze({ base: v.r[1], lit: v.r[3], dark: v.r[0], motif: v.motif, fleck: v.fleck })])));
/** Ore glints (kept for older callers): body colour, highlight and the dark rim (palette.js ORE_PX). */
export const ORE_LOOK = Object.freeze({
  coal: { c: ORE_PX.coal[1], hi: ORE_PX.coal[2], rim: ORE_PX.coal[0], shape: 'lump' },
  copper: { c: ORE_PX.copper[1], hi: ORE_PX.copper[2], rim: ORE_PX.copper[0], shape: 'nugget' },
  tin: { c: ORE_PX.tin[1], hi: ORE_PX.tin[2], rim: ORE_PX.tin[0], shape: 'crystal' },
  iron: { c: ORE_PX.iron[1], hi: ORE_PX.iron[2], rim: ORE_PX.iron[0], shape: 'band' },
});
/** Material tints (materials.js `tint`, keyed by material id), with the wood default. */
export const MAT_TINT = Object.freeze(Object.fromEntries(MATERIALS.material.map((m) => [m.id, rampOf(m.id, m.group)[m.group === 'wood' ? 2 : 1]])));
/** Tint of a material id; unknown or null: wood for the wood family, granite grey otherwise. */
export function tintOf(mat, family = 'wood') {
  if (mat && MAT_TINT[mat]) return MAT_TINT[mat];
  return family === 'stone' ? MAT_TINT.granite || PAL.stone1 : MAT_TINT.wood || PAL.umber3;
}
/** Material family of a material id: 'wood', 'stone' or 'metal' (null -> fallback). */
export function familyOf(mat, fallback = 'wood') {
  if (!mat) return fallback;
  const m = MATERIALS.material.find((x) => x.id === mat);
  return m ? m.group : fallback;
}

// ---- The registry -------------------------------------------------------------------------------
// meta fields: kind, base (kit part), props (kit parts drawn over the base), tint ('mat' = the
// building's or stack's material, 'wood' / 'stone' = fixed family, or a colour), size [w, h] tiles
// at rotation 0, stage ('1a' slice art; 'later' = a placeholder until its stage), label (sheet).
const A = {};
const add = (key, meta) => { A[key] = Object.freeze({ props: [], tint: null, size: [1, 1], stage: '1a', ...meta }); };

// Ground (baked into terrain chunks by C's painter through ground.js).
for (const st of STONE_IDS.slice(1)) add(`rock.${st}`, { kind: 'ground', base: 'rockface', tint: st, label: `${st[0].toUpperCase()}${st.slice(1)} rock` });
add('rock.unknown', { kind: 'ground', base: 'rockface', tint: 'unknown', label: 'Unknown rock' });
add('floor.mined', { kind: 'ground', base: 'roughfloor', tint: 'mat', label: 'Mined floor' });
add('floor.rubble', { kind: 'ground', base: 'rubblefloor', tint: 'mat', label: 'Rubble' });
add('floor.smooth', { kind: 'ground', base: 'smoothfloor', tint: 'mat', label: 'Smoothed stone', stage: '2' });
add('ground.pile', { kind: 'ground', base: 'pilemark', tint: 'mat', label: 'Stone pile mark' });
for (const o of ['coal', 'copper', 'tin', 'iron']) add(`ore.${o}`, { kind: 'ground', base: 'oreglint', tint: o, label: `${o[0].toUpperCase()}${o.slice(1)} glint` });
// Built floors (the floor layer; G's art keys).
add('struct.f_planks', { kind: 'floor', base: 'planks', tint: 'wood', label: 'Plank floor' });
add('struct.f_flag', { kind: 'floor', base: 'flagstone', tint: 'mat', label: 'Flagstone' });

// Structures and furniture (drawn per frame by the entity layer through installKit).
add('struct.wall', { kind: 'struct', base: 'wallblock', tint: 'mat', label: 'Wall' });
add('struct.door', { kind: 'struct', base: 'doorframe', props: ['doorleaf'], tint: 'wood', label: 'Door' });
add('struct.bed', { kind: 'struct', base: 'frame.bed', props: ['pillow', 'blanket'], tint: 'mat', size: [1, 2], label: 'Bed' });
add('struct.table', { kind: 'struct', base: 'frame.table', props: ['cloth'], tint: 'mat', size: [2, 1], label: 'Table' });
add('struct.chair', { kind: 'struct', base: 'frame.chair', tint: 'mat', label: 'Chair' });
add('struct.carpenter', { kind: 'struct', base: 'bench', props: ['tool.saw', 'tool.plane', 'planks.offcut'], tint: 'wood', size: [2, 1], label: "Carpenter's bench" });
add('struct.mason', { kind: 'struct', base: 'bench', props: ['tool.mallet', 'tool.chisel', 'block.offcut'], tint: 'stone', size: [2, 1], label: "Mason's bench" });
add('struct.sconce', { kind: 'struct', base: 'bracket', props: ['flame'], tint: 'wood', label: 'Torch sconce' });
add('struct.prop', { kind: 'struct', base: 'post.wood', props: ['beam'], tint: 'wood', label: 'Wooden prop' });
add('struct.pillar', { kind: 'struct', base: 'post.stone', props: ['capital'], tint: 'stone', label: 'Stone pillar' });
add('struct.hearth', { kind: 'struct', base: 'hearthring', props: ['flame', 'kettle'], tint: 'stone', size: [3, 3], label: 'The Hearth' });
// Later structures: placeholders until their stage (generic kit frame with a sign).
add('struct.campfire', { kind: 'struct', base: 'campfire', props: ['flame'], tint: 'stone', label: 'Campfire', stage: '1b' });
add('struct.brazier', { kind: 'struct', base: 'brazier', props: ['flame'], tint: 'stone', label: 'Brazier', stage: '1b' });
add('struct.bloomery', { kind: 'struct', base: 'bloomery', props: ['flame'], tint: 'stone', size: [2, 2], label: 'Bloomery', stage: '1b' });
add('struct.forge', { kind: 'struct', base: 'forgebed', props: ['flame'], tint: 'stone', size: [2, 2], label: 'Forge and anvil', stage: '1b' });
const LATER = { bastion: [5, 5], cathedral: [5, 5], farm: [4, 4], greatanvil: [2, 2], hut: [3, 3],
  keep: [5, 5], shrine: [1, 1], spiketrap: [1, 1], well: [1, 1], worldforge: [4, 4] };
for (const [id, size] of Object.entries(LATER)) add(`struct.${id}`, { kind: 'struct', base: 'placeholder', tint: 'stone', size, stage: 'later', placeholder: true, label: id });

// Items (stacks on the ground; drawn by the entity layer).
add('item.wood', { kind: 'item', base: 'logs', tint: 'wood', label: 'Wood' });
add('item.stone', { kind: 'item', base: 'stonepile', tint: 'mat', label: 'Rough stone' });
add('item.block', { kind: 'item', base: 'blocks', tint: 'mat', label: 'Stone blocks' });
add('item.ore', { kind: 'item', base: 'orepile', tint: 'mat', label: 'Ore' });
add('item.coal', { kind: 'item', base: 'coalpile', tint: PAL.night, label: 'Coal' });
add('item.ingot', { kind: 'item', base: 'ingots', tint: 'mat', label: 'Ingots' });
add('item.bed', { kind: 'item', base: 'crate', props: ['tag.bed'], tint: 'mat', label: 'Bed (packed)' });
add('item.table', { kind: 'item', base: 'crate', props: ['tag.table'], tint: 'mat', label: 'Table (packed)' });
add('item.chair', { kind: 'item', base: 'crate', props: ['tag.chair'], tint: 'mat', label: 'Chair (packed)' });
add('item.prop', { kind: 'item', base: 'timber', tint: 'wood', label: 'Wooden prop' });
add('item.pillar', { kind: 'item', base: 'drum', tint: 'mat', label: 'Stone pillar' });
add('item.hearthroot', { kind: 'item', base: 'roots', tint: PAL.orange, label: 'Hearthroot' });
add('item.meat', { kind: 'item', base: 'meat', tint: PAL.ember1, label: 'Meat', stage: '1b' });
add('item.egg', { kind: 'item', base: 'eggs', tint: PAL.bone, label: 'Eggs', stage: '1b' });
add('item.meal', { kind: 'item', base: 'meal', tint: PAL.gold, label: 'Simple meal', stage: '1b' });
add('item.berries', { kind: 'item', base: 'berries', tint: PAL.danger, label: 'Berries', stage: '1b' });
add('item.pick', { kind: 'item', base: 'pickhead', tint: 'mat', label: 'Pick', stage: '1b' });
add('item.spear', { kind: 'item', base: 'spearshaft', tint: 'mat', label: 'Spear', stage: '1b' });

// Zones and designations (overlays, drawn above the darkness).
add('overlay.stockpile', { kind: 'zone', base: 'zonetint', tint: PAL.gold, label: 'Stockpile' });
add('overlay.growzone', { kind: 'zone', base: 'zonetint', tint: PAL.moss3, label: 'Growing zone', stage: '1b' });
add('overlay.dump', { kind: 'zone', base: 'zonetint', tint: PAL.orange, label: 'Dump' });
for (const [k, c] of [['mine', PAL.flame], ['chop', PAL.moss3], ['harvest', PAL.gold], ['smooth', PAL.mist], ['engrave', PAL.violet],
  ['prospect', PAL.orange], ['risky', PAL.ember1], ['forbid', PAL.danger], ['cancel', PAL.bone]]) {
  add(`mark.${k}`, { kind: 'mark', base: 'desig', props: [`glyph.${k}`], tint: c, label: k[0].toUpperCase() + k.slice(1) });
}
add('mark.blueprint', { kind: 'mark', base: 'ghost', tint: PAL.shallow, label: 'Blueprint' });

// People (the band of 1a is Human; the other ancestries are variants of the same rig).
add('colonist.human', { kind: 'colonist', base: 'body.human', props: ['hair', 'beard', 'clothes'], tint: 'look', size: [1, 1], label: 'Human' });
add('colonist.sylvari', { kind: 'colonist', base: 'body.sylvari', props: ['hair', 'clothes'], tint: 'look', label: 'Sylvari', stage: '2' });
add('colonist.deepforge', { kind: 'colonist', base: 'body.deepforge', props: ['hair', 'beard', 'clothes'], tint: 'look', label: 'Deepforge', stage: '2' });
add('colonist.emberkin', { kind: 'colonist', base: 'body.emberkin', props: ['hair', 'beard', 'clothes'], tint: 'look', label: 'Emberkin', stage: '2' });
for (const [k, l] of [['miner', 'Miner'], ['cleric', 'Cleric'], ['runesmith', 'Runesmith']]) add(`look.${k}`, { kind: 'look', base: `outfit.${k}`, tint: 'look', label: `${l} look`, stage: '2' });
/** Hair styles (look.hair 0-3) and their keys; beards (look.beard 0-4); clothes palettes (look.cloth 0-5). */
export const HAIR_STYLES = Object.freeze(['cropped', 'braid', 'mane', 'topknot']);
export const BEARDS = Object.freeze(['none', 'stubble', 'short', 'full', 'forked']);
export const CLOTH_PALETTES = Object.freeze(['russet', 'moss', 'slate', 'ochre', 'plum', 'teal']);
for (const h of HAIR_STYLES) add(`hair.${h}`, { kind: 'hair', base: `hair.${h}`, tint: 'look', label: `Hair: ${h}` });
for (const b of BEARDS.slice(1)) add(`beard.${b}`, { kind: 'beard', base: `beard.${b}`, tint: 'look', label: `Beard: ${b}` });
for (const c of CLOTH_PALETTES) add(`cloth.${c}`, { kind: 'cloth', base: 'clothes', tint: c, label: `Clothes: ${c}` });
add('tool.pick', { kind: 'tool', base: 'held.pick', label: 'Pick' });
add('tool.axe', { kind: 'tool', base: 'held.axe', label: 'Axe' });
add('tool.hammer', { kind: 'tool', base: 'held.hammer', label: 'Hammer' });
add('tool.saw', { kind: 'tool', base: 'held.saw', label: 'Saw' });
add('tool.mallet', { kind: 'tool', base: 'held.mallet', label: 'Mallet' });
add('tool.hoe', { kind: 'tool', base: 'held.hoe', label: 'Hoe', stage: '1b' });
add('tool.spear', { kind: 'tool', base: 'held.spear', label: 'Spear (drafted)', stage: '1b' });

// Strategic pips (zoom < 0.5: constant screen size, 44 pt hit area).
add('pip.colonist', { kind: 'pip', base: 'pip', props: ['moodring', 'roleglyph'], tint: PAL.gold, label: 'Colonist pip' });
add('pip.drafted', { kind: 'pip', base: 'pip', props: ['moodring', 'roleglyph', 'badge.draft'], tint: PAL.orange, label: 'Drafted pip', stage: '1b' });
add('pip.foe', { kind: 'pip', base: 'pip', props: ['foeglyph'], tint: PAL.danger, label: 'Foe pip', stage: '1b' });
add('pip.raid', { kind: 'pip', base: 'raidblob', props: ['count'], tint: PAL.danger, label: 'Raid blob', stage: '1b' });

// Plants, animals and foes (pixel sprites in beings.js; the bosses stay placeholders until Stage 3).
for (const [k, l] of [['plant.oak', 'Oak'], ['plant.pine', 'Pine'], ['plant.hearthroot', 'Hearthroot']]) add(k, { kind: 'plant', base: k, label: l, stage: k === 'plant.hearthroot' ? '1b' : '1a' });
add('plant.berry', { kind: 'plant', base: 'plant.berry', label: 'Berry bush', stage: '1b' });
for (const [k, l] of [['animal.goat', 'Goat'], ['animal.hen', 'Hen'], ['animal.wolf', 'Wolf']]) add(k, { kind: 'animal', base: `beast.${k.slice(7)}`, stage: 'later', label: l });
for (const [k, b, l, st] of [['foe.husk', 'unit.husk', 'Husk', '1b'], ['foe.hound', 'unit.hound', 'Gloom hound', '1b'], ['foe.delver', 'unit.delver', 'Delver', 'later'],
  ['boss.gloomwyrm', 'unit.shade', 'Gloomwyrm', 'later'], ['boss.colossus', 'unit.knight', 'Bone Colossus', 'later']]) add(k, { kind: 'foe', base: b, stage: st, placeholder: k.startsWith('boss.'), label: l });

/** Registry (frozen). */
export const ART = Object.freeze(A);
const ICONS = new Set(ICON_NAMES);
/** Every registered key, sorted (structure, item, ... keys and the UI icon names). */
export const ART_KEYS = Object.freeze([...Object.keys(ART), ...ICON_NAMES].sort());
export function hasArtKey(k) { return typeof k === 'string' && (Object.prototype.hasOwnProperty.call(ART, k) || ICONS.has(k)); }
export function artMeta(k) { return Object.prototype.hasOwnProperty.call(ART, k) ? ART[k] : ICONS.has(k) ? ICON_META : null; }
const ICON_META = Object.freeze({ kind: 'icon', base: 'icon', props: [], tint: null, size: [1, 1], stage: '1a', label: 'Icon' });
export function keysOfKind(kind) { return kind === 'icon' ? ICON_NAMES.slice() : Object.keys(ART).filter((k) => ART[k].kind === kind); }
/** The kinds in sheet order. */
export const KINDS = Object.freeze(['ground', 'floor', 'struct', 'item', 'zone', 'mark', 'colonist', 'look', 'hair', 'beard', 'cloth', 'tool', 'pip', 'plant', 'animal', 'foe', 'icon']);
/** Every kit part name a key uses (base and props); kit.js / ground.js / people.js / marks.js implement them all. */
export const KIT_PARTS = Object.freeze([...new Set(Object.values(ART).flatMap((m) => [m.base, ...m.props]))].sort());

/** Sound effects of the slice (audio.js voices) and the events or work that play them (fx.js). */
export const SFX = Object.freeze({ dig: 'a pick biting rock', ore: 'a ringing strike on an ore vein', saw: 'a saw stroke at the carpenter',
  hammer: 'a hammer blow while building', door: 'a door swinging on its hinges', chisel: 'a mallet on a chisel at the mason', rockfall: 'a mined tile breaking free',
  // Stage 1b: the first night (fx.js plays them on the raid events, C8)
  warhorn: 'the Hollow horn from the threat\'s edge (the omen, and again when the horde arrives)', drums: 'the Hollow drums, close (Imminent and the arrival)',
  clash: 'a blow landing in melee', bite: 'a hound\'s bite', thud: 'a colonist going down', bellows: 'the bloomery bellows and a hiss of the quench' });

// Region biomes of the realm (EMBERCROWN-WORLD.md 1.3, G10; OWNER G). Read by js/game/realm/biomes.js.
//
// The index of a row is the value written in the realm's `biome` layer, which is saved in the realm record
// (9.2): the list is APPEND-ONLY. Rows 0 and 1 (sea, peak) are never embarkable. The 12 region biomes follow
// in the order of the 1.3 table. `palette` names the ground palette (the 4 existing ones are reused; the 8 new
// ones are drawn by D in W2.5). `desc` is the region card's one-line header (3.3); `lean` is the threat lean in
// words. The `mapgen3` knob rows of each biome live in js/data/worldgen.js (B, W2.3), keyed by `id`.

export const REALM_BIOMES = Object.freeze([
  { id: 'sea', name: 'Open sea', palette: 'sea', embark: false, desc: 'Grey water to the edge of sight.', lean: '' },
  { id: 'peak', name: 'High peaks', palette: 'peak', embark: false, desc: 'Bare stone and snow above the clouds; nothing lives here for long.', lean: '' },
  { id: 'greenvale', name: 'Greenvale', palette: 'greenvale', embark: true, desc: 'Mild green country of meadow, copse and slow streams.', lean: 'Nothing out of the common way' },
  { id: 'elderwood', name: 'Elderwood', palette: 'elderwood', embark: true, desc: 'Old close-grown wood on well-drained ground; mist hangs in the hollows.', lean: 'Beasts, and the wardens of the trees if they are felled' },
  { id: 'ruins', name: 'Hollowed Reach', palette: 'ruins', embark: true, desc: 'Grey ground where the Old Crown fell; broken walls and a wrongness in the soil.', lean: 'The Hollow stirs more often' },
  { id: 'ashlands', name: 'Ashlands', palette: 'ashlands', embark: true, desc: 'Dry cinder plains over a waking fire; the ground is warm to the hand.', lean: 'Fire' },
  { id: 'fen', name: 'Fenmere', palette: 'fen', embark: true, desc: 'Low wet ground under alder and reed; the water spreads into pools.', lean: 'Fevers and foul air' },
  { id: 'moor', name: 'Windmoor', palette: 'moor', embark: true, desc: 'Open heather upland under a wide sky; the wind never quite stops.', lean: 'Raiders see you from far off' },
  { id: 'taiga', name: 'Frostpine', palette: 'taiga', embark: true, desc: 'Dark pine forest and deep snow through a long winter.', lean: 'Wolves' },
  { id: 'tundra', name: 'Rimefell', palette: 'tundra', embark: true, desc: 'Frozen flats of lichen and slate; summer is a short thaw.', lean: 'Cold' },
  { id: 'saltflat', name: 'Saltflat', palette: 'saltflat', embark: true, desc: 'Cracked ochre ground crusted with salt; water is the whole question.', lean: 'Drought' },
  { id: 'redscar', name: 'Redscar', palette: 'redscar', embark: true, desc: 'Rust-banded upland cut by dry ravines and thin scrub.', lean: 'Rockfall' },
  { id: 'shore', name: 'Shorehold', palette: 'shore', embark: true, desc: 'Sand, salt marsh and sea glass along a working coast.', lean: 'Raiders from the sea' },
  { id: 'highcrag', name: 'Highcrag', palette: 'highcrag', embark: true, desc: 'Grey stone and alpine meadow under the peaks; the seasons come late and leave early.', lean: 'Beasts come down from the peaks' },
]);

/** Biome index by id (append-only, see above). */
export const BIOME_INDEX = Object.freeze(Object.fromEntries(REALM_BIOMES.map((b, i) => [b.id, i])));

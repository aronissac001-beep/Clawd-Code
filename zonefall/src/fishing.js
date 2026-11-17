// ============================================================================
// ZONEFALL — fishing: rod, bait and fish data, the cast -> wait -> bite -> reel
// state machine, the bobber + line in the world, splashes, ripples and sounds.
//
//   registerFishingData({ ITEMS, RECIPES, RECIPE, LOOT, OVENS })  once, at boot (idempotent)
//   registerFishingIcons(ART?)          optional: pixel icons for the new ids (wraps ART.icon / iconURL)
//   Fishing.canFish(p)                  holding the rod in the selected belt slot
//   Fishing.onFire(p)                   on the FIRE press edge while holding the rod
//   Fishing.update(dt, p)               every frame (moves bobber / line, cancels when needed)
//   Fishing.hud()                       null | { state, label, tension, progress, bar }
//   Fishing.reset()                     on death / new run
//   rollFish(water, bait, rnd)          pure: water 'sea' | 'fresh' -> fish id
//
// The module only imports leaf modules (no data.js / player.js at load time), so it
// is safe to import from data.js. give() is pulled in lazily from player.js.
// Water: the sea / lake surface mesh sits at y = -0.05 (game.js); terrain below it is
// water (world/gen.js W.isWater). Sea vs lake comes from W.biomeAt (0 ocean, 7 lake).
// ============================================================================
import { THREE, M } from './gfx/materials.js';
import { G } from './state.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';

export const ROD = 'fishing_rod';
const WATER_SURF = -0.05;            // water mesh height
const MIN_CAST = 3, MAX_CAST = 16;   // horizontal metres
const MIN_DEPTH = 0.22;              // shallower than this = "too shallow"
const LEASH = 20;                    // walk further than this from the bobber and the line goes
const BITE_WIN = 1.1;                // seconds to tap after a bite
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ============================================================================
// DATA
// ============================================================================
const RAW = 'Raw fish: cook it on a campfire first.';
export const FISHING_ITEMS = {
  fishing_rod: {
    name: 'Fishing Rod', cat: 'melee', col: '#9a7448', stack: 1, val: 8,
    desc: 'Hold it and tap FIRE while looking at a lake or the sea to cast (up to 16 m). When the bobber dips, tap FIRE quickly to hook the fish, then HOLD FIRE to reel it in. Let go when the line strains or it snaps. Bait in your bag brings faster bites and bigger fish.',
  },
  bait: { name: 'Fish Bait', cat: 'ammo', col: '#b0705a', stack: 50, val: 0.5, desc: 'Keep it in your bag while fishing: bites come faster and bigger fish bite. A fish takes one each bite.' },
  fish_perch: { name: 'Perch', cat: 'food', col: '#8f9a3e', stack: 10, val: 2, use: { food: 5, hp: -3, time: 1.1 }, cook: 'cooked_fish', desc: 'A lake fish. ' + RAW },
  fish_trout: { name: 'Rainbow Trout', cat: 'food', col: '#8aa29a', stack: 10, val: 3, use: { food: 6, hp: -3, time: 1.1 }, cook: 'cooked_fish', desc: 'A lake fish. ' + RAW },
  fish_mackerel: { name: 'Mackerel', cat: 'food', col: '#4f7f9a', stack: 10, val: 3, use: { food: 6, hp: -3, time: 1.1 }, cook: 'cooked_fish', desc: 'A sea fish. ' + RAW },
  fish_salmon: { name: 'Salmon', cat: 'food', col: '#c8786a', stack: 10, val: 8, rar: 'uncommon', use: { food: 8, hp: -4, time: 1.2 }, cook: 'cooked_fish', desc: 'Found in lakes and the sea, but not often. ' + RAW },
  fish_tuna: { name: 'Bluefin Tuna', cat: 'food', col: '#34507a', stack: 5, val: 16, rar: 'rare', use: { food: 10, hp: -4, time: 1.3 }, cook: 'cooked_fish', desc: 'A big sea fish. It fights hard. ' + RAW },
  fish_golden: { name: 'Golden Fish', cat: 'food', col: '#e8b030', stack: 5, val: 180, rar: 'legendary', use: { food: 6, hp: -3, time: 1.1 }, cook: 'cooked_fish', desc: 'Extremely rare. Traders pay a fortune for it, so it is a waste to eat.' },
  cooked_fish: { name: 'Cooked Fish', cat: 'food', col: '#b0703a', stack: 20, val: 4, use: { food: 28, water: 2, hp: 9, time: 1.3 } },
};
export const FISH_IDS = ['fish_perch', 'fish_trout', 'fish_mackerel', 'fish_salmon', 'fish_tuna', 'fish_golden'];

export const FISHING_RECIPES = [
  { id: 'fishing_rod', out: 'fishing_rod', n: 1, cost: { wood: 80, cloth: 12 }, wb: 0 },
  { id: 'bait', out: 'bait', n: 4, cost: { raw_meat: 1 }, wb: 0 },
  { id: 'bait_berries', out: 'bait', n: 3, cost: { berries: 3 }, wb: 0 },
  { id: 'bait_mushroom', out: 'bait', n: 3, cost: { mushroom: 2 }, wb: 0 },
];
// [table, id, weight, min, max]
const FISHING_LOOT = [
  ['crate', 'fishing_rod', 0.7, 1, 1], ['crate', 'bait', 1.2, 3, 8],
  ['toolbox', 'fishing_rod', 0.5, 1, 1],
  ['food', 'bait', 2, 3, 8], ['food', 'cooked_fish', 1.5, 1, 2],
];

/** Adds the fishing items, recipes, loot and campfire cooking to the game's data objects. Safe to call twice. */
export function registerFishingData({ ITEMS, RECIPES, RECIPE, LOOT, OVENS } = {}) {
  const out = { items: 0, recipes: 0, loot: 0, cooks: 0 };
  if (ITEMS) for (const id in FISHING_ITEMS) if (!ITEMS[id]) { ITEMS[id] = Object.assign({}, FISHING_ITEMS[id], FISHING_ITEMS[id].use ? { use: Object.assign({}, FISHING_ITEMS[id].use) } : null); out.items++; }
  if (Array.isArray(RECIPE) && !RECIPES) { RECIPES = RECIPE; RECIPE = null; }   // tolerate the list passed as RECIPE
  for (const r of FISHING_RECIPES) {
    const rec = (RECIPES && RECIPES.find(q => q.id === r.id)) || (RECIPE && RECIPE[r.id]) || Object.assign({}, r, { cost: Object.assign({}, r.cost) });
    if (RECIPES && !RECIPES.includes(rec)) { RECIPES.push(rec); out.recipes++; }
    if (RECIPE && !RECIPE[r.id]) RECIPE[r.id] = rec;
  }
  if (LOOT) for (const [t, id, w, a, b] of FISHING_LOOT) { const T = LOOT[t]; if (T && T.items && !T.items.some(e => e[0] === id)) { T.items.push([id, w, a, b]); out.loot++; } }
  if (OVENS && OVENS.campfire && OVENS.campfire.cooks) for (const id of FISH_IDS) if (!OVENS.campfire.cooks[id]) { OVENS.campfire.cooks[id] = 'cooked_fish'; out.cooks++; }
  return out;
}

// ---------------------------------------------------------------- fish table
// w = weight per water type, bait = weight multiplier with bait, fight 0..1 (reel difficulty), kg = size range
export const FISH = {
  fish_perch: { w: { fresh: 50 }, bait: 0.55, fight: 0.22, kg: [0.2, 0.9] },
  fish_trout: { w: { fresh: 30 }, bait: 1.15, fight: 0.4, kg: [0.5, 2.6] },
  fish_mackerel: { w: { sea: 55 }, bait: 0.6, fight: 0.33, kg: [0.3, 1.4] },
  fish_salmon: { w: { fresh: 7, sea: 7 }, bait: 2.0, fight: 0.6, kg: [2, 8] },
  fish_tuna: { w: { sea: 10 }, bait: 2.2, fight: 0.74, kg: [8, 42] },
  fish_golden: { w: { fresh: 0.5, sea: 0.5 }, bait: 1.8, fight: 0.62, kg: [1, 3.5] },
};

/** chance of each fish for a water type ('sea' | 'fresh') and bait flag -> [[id, p], ...] */
export function fishOdds(water, bait = false) {
  const wt = water === 'sea' ? 'sea' : 'fresh'; const list = []; let tot = 0;
  for (const id of FISH_IDS) { const f = FISH[id]; let w = f.w[wt] || 0; if (!w) continue; if (bait) w *= f.bait; list.push([id, w]); tot += w; }
  return list.map(([id, w]) => [id, w / tot]);
}
/** pure fish roll: water 'sea' | 'fresh', bait boolean, rnd () => [0,1) */
export function rollFish(water, bait = false, rnd = Math.random) {
  const odds = fishOdds(water, bait); let r = rnd();
  for (const [id, p] of odds) { r -= p; if (r < 0) return id; }
  return odds[odds.length - 1][0];
}
/** seconds until a bite: 6-14 s, 4-9 s with bait */
export function biteDelay(bait = false, rnd = Math.random) { return bait ? 4 + rnd() * 5 : 6 + rnd() * 8; }
/** fish size: bait skews towards the top of the range */
export function rollKg(id, bait = false, rnd = Math.random) { const k = FISH[id].kg; return k[0] + (k[1] - k[0]) * Math.pow(rnd(), bait ? 0.65 : 1.35); }

// ---------------------------------------------------------------- reeling (pure; tested in Node)
/** reel state for a hooked fish; size01 = how big it is within its range */
export function reelInit(id, size01 = 0.5) { const f = FISH[id] || FISH.fish_perch; return { fight: clamp(f.fight + 0.14 * (size01 - 0.5), 0.05, 0.95), tension: 0.3, progress: 0, pull: 0, pullTgt: 0, pullT: 0.5, slack: 0, t: 0, done: null }; }
/**
 * One step of the reeling minigame. Holding FIRE reels in and raises the tension, letting go
 * lowers it; the fish lunges at random (more tension, less progress). Returns null, 'caught',
 * 'snap' (tension maxed) or 'escaped' (line slack for too long).
 */
export function reelStep(R, dt, holding, rnd = Math.random) {
  if (R.done) return R.done;
  R.t += dt; const f = R.fight;
  R.pullT -= dt;
  if (R.pullT <= 0) {
    const lunge = rnd() < 0.3 + f * 0.45;
    R.pullTgt = lunge ? 0.45 + rnd() * 0.55 : rnd() * 0.18;
    R.pullT = lunge ? 0.35 + rnd() * 0.55 : 0.35 + rnd() * 0.75;
  }
  R.pull += (R.pullTgt - R.pull) * Math.min(1, dt * 9);
  const pull = R.pull * (0.5 + f * 0.7);
  if (holding) {
    R.progress += dt / (1.3 + f * 1.35) * (1 - 0.45 * R.pull);
    R.tension += dt * (0.26 + f * 0.26 + pull * 0.62);
  } else {
    R.tension -= dt * (1.0 - pull * 0.4);
    R.progress -= dt * pull * 0.08;
  }
  R.tension = clamp(R.tension, 0, 1); R.progress = clamp(R.progress, 0, 1);
  R.slack = R.tension < 0.06 ? R.slack + dt : 0;
  if (R.tension >= 1) R.done = 'snap';
  else if (R.progress >= 1) R.done = 'caught';
  else if (R.slack > 2.2) R.done = 'escaped';
  return R.done;
}

// ============================================================================
// WORLD QUERIES
// ============================================================================
function groundAt(x, z) { const b = G.build; return b && b.floorY ? b.floorY(x, z) : G.W.height(x, z); }
/** 'sea' | 'fresh' for a water point */
export function waterType(x, z) {
  const W = G.W; if (!W) return 'sea';
  const b = W.biomeAt ? W.biomeAt(x, z) : -1;
  if (b === 7) return 'fresh';
  if (b === 0) return 'sea';
  if (W.lakes) for (const l of W.lakes) if (Math.hypot(l.x - x, l.z - z) < l.r + 6) return 'fresh';
  return 'sea';
}
/** where a cast along the view lands: { x, z, kind: 'water' | 'shallow' | 'land', water } */
function castTarget(p) {
  const ey = p.y + p.eye, cp = Math.cos(p.pitch), dx = Math.cos(p.yaw) * cp, dz = Math.sin(p.yaw) * cp, dy = Math.sin(p.pitch);
  let x = p.x + Math.cos(p.yaw) * MAX_CAST, z = p.z + Math.sin(p.yaw) * MAX_CAST;
  const tmax = MAX_CAST / Math.max(cp, 0.05);
  for (let t = 0.5; t <= tmax; t += 0.2) {
    const px = p.x + dx * t, pz = p.z + dz * t, py = ey + dy * t;
    if (py <= Math.max(groundAt(px, pz), WATER_SURF)) { x = px; z = pz; break; }
  }
  let hd = Math.hypot(x - p.x, z - p.z);
  if (hd < MIN_CAST) { x = p.x + Math.cos(p.yaw) * MIN_CAST; z = p.z + Math.sin(p.yaw) * MIN_CAST; hd = MIN_CAST; }
  const g = groundAt(x, z), h = G.W.height(x, z);
  const kind = g > h + 0.05 || h >= WATER_SURF ? 'land' : WATER_SURF - h < MIN_DEPTH ? 'shallow' : 'water';
  return { x, z, d: hd, kind, y: kind === 'water' || kind === 'shallow' ? WATER_SURF : g, water: kind === 'land' ? null : waterType(x, z) };
}

// ============================================================================
// 3D: bobber, line, ripples
// ============================================================================
const V3 = () => new THREE.Vector3();
const TIP = V3(), END = V3(), _a = V3(), _b = V3(), _c = V3();
let OBJ = null;
const LINE_SEG = 24;
function makeObjects() {
  const bob = new THREE.Group(); bob.name = 'fishing:bobber';
  const r = 0.075;
  const top = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 6, 0, TAU, 0, Math.PI / 2), M.mat('#d8302a'));
  const bot = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 6, 0, TAU, Math.PI / 2, Math.PI / 2), M.mat('#f2efe6'));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.012, 12), M.mat('#1c1a22'));
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.012, 0.09, 6), M.mat('#f2efe6')); stick.position.y = r + 0.035;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 4), M.mat('#d8302a')); cap.position.y = r + 0.08;
  for (const m of [top, bot, band, stick, cap]) { m.castShadow = false; m.receiveShadow = false; bob.add(m); }
  // fishing line: a fixed unit curve (t, -4t(1-t), 0); its world matrix maps it from the rod tip to the bobber (+ sag)
  const pos = new Float32Array((LINE_SEG + 1) * 3);
  for (let i = 0; i <= LINE_SEG; i++) { const t = i / LINE_SEG; pos[i * 3] = t; pos[i * 3 + 1] = -4 * t * (1 - t); pos[i * 3 + 2] = 0; }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const lm = new THREE.LineBasicMaterial({ color: 0xf2efe6, fog: true });
  const line = new THREE.Line(lg, lm); line.name = 'fishing:line';
  line.frustumCulled = false; line.matrixAutoUpdate = false; line.matrixWorldAutoUpdate = false; line.renderOrder = 3;
  line.onBeforeRender = () => placeLine(line);
  // ripples
  const rg = new THREE.RingGeometry(0.84, 1, 28).rotateX(-Math.PI / 2);
  const ripples = [];
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false; m.renderOrder = 2; m.castShadow = m.receiveShadow = false; m.name = 'fishing:ripple';
    ripples.push({ m, t: 9, life: 1, s: 1 });
  }
  return { bob, line, lm, ripples, lineCol: new THREE.Color(0xf2efe6), red: new THREE.Color(0xff4a3a), white: new THREE.Color(0xf2efe6) };
}
function ensureInScene() {
  if (!G.scene) return false;
  if (!OBJ) OBJ = makeObjects();
  for (const o of [OBJ.bob, OBJ.line]) if (o.parent !== G.scene) G.scene.add(o);
  return true;
}
/** take the bobber + line out of the scene (all = ripples too) */
function removeObjects(all) {
  if (!OBJ) return;
  for (const o of [OBJ.bob, OBJ.line]) if (o.parent) o.parent.remove(o);
  if (all) for (const r of OBJ.ripples) { r.t = 9; r.m.visible = false; if (r.m.parent) r.m.parent.remove(r.m); }
}
function ripple(x, z, s = 1) {
  if (!OBJ) return;
  let r = OBJ.ripples[0]; for (const q of OBJ.ripples) if (q.t / q.life > r.t / r.life) r = q;
  r.t = 0; r.life = 0.9 + 0.5 * s; r.s = 0.35 + 0.55 * s; r.m.position.set(x, WATER_SURF + 0.012, z); r.m.visible = true;
}
function tickRipples(dt) {
  if (!OBJ) return false;
  let any = false;
  for (const r of OBJ.ripples) {
    if (r.t >= r.life) { if (r.m.visible) { r.m.visible = false; if (r.m.parent) r.m.parent.remove(r.m); } continue; }
    any = true; if (r.m.parent !== G.scene && G.scene) G.scene.add(r.m);
    r.t += dt; const k = r.t / r.life;
    r.m.scale.setScalar(0.08 + r.s * Math.sqrt(k)); r.m.material.opacity = 0.55 * (1 - k) * (1 - k);
  }
  return any;
}

/** rod tip in world space: the first-person viewmodel's tip (re-projected), else an estimate from the eye */
export function rodTip(p, out = TIP) {
  const vm = G.vm, cam = G.rend && G.rend.camera;
  if (vm && !vm.hidden && vm.id === ROD && vm.muzzleView && cam) { vm.muzzleView(out); return out.applyMatrix4(cam.matrixWorld); }
  const cp = Math.cos(p.pitch), fx = Math.cos(p.yaw) * cp, fy = Math.sin(p.pitch), fz = Math.sin(p.yaw) * cp, rx = -Math.sin(p.yaw), rz = Math.cos(p.yaw);
  return out.set(p.x + fx * 1.3 + rx * 0.22, p.y + p.eye + fy * 1.3 + 0.5, p.z + fz * 1.3 + rz * 0.22);
}
function placeLine(line) {
  const p = G.player; if (!p || S.st === 'idle') return;
  rodTip(p, TIP);
  END.set(S.bx, S.by + S.endY, S.bz);
  const D = _a.subVectors(END, TIP), len = D.length() || 1e-3;
  const sag = Math.max(0.002, Math.min(S.sag * len, Math.max(0, -D.y) / 4));   // never droops below the bobber
  const Z = _b.set(-D.z, 0, D.x); if (Z.lengthSq() < 1e-8) Z.set(1, 0, 0); Z.normalize();
  line.matrixWorld.set(D.x, 0, Z.x, TIP.x, D.y, sag, Z.y, TIP.y, D.z, 0, Z.z, TIP.z, 0, 0, 0, 1);
}

// ---------------------------------------------------------------- fx + sound
function splash(x, z, k = 1) {
  if (G.fx && G.fx.emit) {
    const n = Math.round(5 + 9 * k);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = (0.4 + Math.random() * 1.2) * k;
      G.fx.emit({ x, y: WATER_SURF + 0.03, z, vx: Math.cos(a) * s, vy: 1.4 + Math.random() * 2.2 * k, vz: Math.sin(a) * s, life: 0.45 + Math.random() * 0.3, size: 0.07 + 0.05 * k, size1: 0.025, r: 0.88, g: 0.95, b: 1, a: 0.95, a1: 0.35, grav: 9 });
    }
    G.fx.emit({ x, y: WATER_SURF + 0.06, z, vy: 0.25, life: 0.55, size: 0.22 * k, size1: 0.65 * k, r: 0.92, g: 0.97, b: 1, a: 0.45, a1: 0 });
  }
  ripple(x, z, k);
}
const snd = {
  cast() { Sfx.swing(); Sfx.noise(0.45, 3400, 2.5, 0.07, 'bandpass', 0.05, 0.45); },
  land(x, z) { Sfx.splash(x, z); },
  thud(x, z) { Sfx.thud(x, z); },
  nibble() { Sfx.tone(700, 0.04, 0.05, 'sine', 0, 0.8); },
  bite(x, z) { Sfx.splash(x, z); Sfx.tone(880, 0.09, 0.15, 'triangle'); Sfx.tone(1175, 0.14, 0.13, 'triangle', 0.09); },
  hook() { Sfx.tone(260, 0.1, 0.16, 'square', 0, 1.7); Sfx.noise(0.12, 2600, 2, 0.12, 'bandpass'); },
  click(k) { Sfx.tone(2300 + 400 * k, 0.012, 0.035, 'square'); },
  strain(k) { Sfx.noise(0.07, 500 + 900 * k, 7, 0.05 + 0.06 * k, 'bandpass'); },
  snap() { Sfx.tone(1500, 0.1, 0.18, 'sawtooth', 0, 0.35); Sfx.noise(0.12, 3200, 1, 0.18, 'highpass'); },
  lost() { Sfx.tone(330, 0.22, 0.1, 'triangle', 0, 0.6); },
  reelBack() { Sfx.noise(0.3, 3000, 3, 0.05, 'bandpass', 0, 0.6); },
};

// ============================================================================
// STATE MACHINE
// ============================================================================
// st: idle | cast (bobber in flight) | wait | bite | reel | back (bobber returning to the rod)
const S = { st: 'idle', t: 0, bx: 0, by: 0, bz: 0, endY: 0.15, endY0: 0.15, sag: 0.05, from: V3(), to: V3(), dur: 1, arc: 1, land: null, water: 'sea', bait: false, biteAt: 8, nibbles: [], dip: 0, fish: null, kg: 0, R: null, d0: 0, swim: 0, swimT: 0, clickT: 0, strainT: 0, splashT: 0, size01: 0.5, back: null, ax: 0, az: 0 };
let PL = null;   // player.js, loaded lazily (give)
const loadPL = () => { if (!PL) import('./player.js').then(m => { PL = m; }).catch(() => { }); };

const toast = (m, k) => { if (G.ui && G.ui.toast) G.ui.toast(m, k); };
const holdsRod = p => { const s = p && p.inv && p.inv.belt && p.inv.belt.slots[p.sel]; return !!s && s.id === ROD; };
const hasBait = p => !!(p && p.inv && p.inv.count && p.inv.count('bait') > 0);
const vmFx = (cast, pull) => { const vm = G.vm; if (!vm) return; if (cast) vm.rodCast = 0; vm.rodPull = pull; };

function setBob(x, y, z) {
  S.bx = x; S.by = y; S.bz = z;
  if (!OBJ) return;
  OBJ.bob.position.set(x, y, z);
  // keep the bobber readable on a phone: never smaller than it looks from ~8 m
  const c = G.rend && G.rend.camera ? G.rend.camera.position : null, d = c ? Math.hypot(x - c.x, y - c.y, z - c.z) : 8;
  const k = clamp(d / 8, 1, 2.4); OBJ.bob.scale.setScalar(k); S.endY = S.endY0 * k;
}
function goIdle() { S.st = 'idle'; S.t = 0; S.R = null; S.fish = null; removeObjects(); vmFx(false, 0); }
/** bobber flies back to the rod, then idle */
function reelBack(silent) { S.st = 'back'; S.t = 0; S.back = { x: S.bx, y: S.by, z: S.bz }; S.sag = 0.03; S.endY0 = 0.15; if (!silent) snd.reelBack(); }

function startCast(p) {
  if (!ensureInScene()) return;
  loadPL();
  const tgt = castTarget(p);
  rodTip(p, S.from);
  S.to.set(tgt.x, tgt.y + (tgt.kind === 'land' ? 0.05 : 0.02), tgt.z);
  S.land = tgt; S.water = tgt.water || 'sea';
  S.dur = 0.45 + tgt.d * 0.032; S.arc = 0.9 + tgt.d * 0.13;
  S.st = 'cast'; S.t = 0; S.sag = 0.02; S.endY0 = 0.15; S.dip = 0;
  setBob(S.from.x, S.from.y, S.from.z);
  OBJ.bob.rotation.set(0, 0, 0);
  snd.cast(); vmFx(true, 0);
}
function landBobber(p) {
  const L = S.land;
  setBob(S.to.x, S.to.y, S.to.z);
  if (L.kind !== 'water') {
    if (L.kind === 'shallow') { splash(L.x, L.z, 0.4); snd.land(L.x, L.z); toast('Too shallow here — cast further out'); }
    else { snd.thud(L.x, L.z); toast('No water there'); }
    S.st = 'miss'; S.t = 0; return;
  }
  splash(L.x, L.z, 0.75); snd.land(L.x, L.z);
  S.bait = hasBait(p);
  S.st = 'wait'; S.t = 0; S.biteAt = biteDelay(S.bait);
  // a couple of nibbles (fake-outs) before the real bite: tapping on one reels the line in
  S.nibbles = []; const nn = Math.random() < 0.25 ? 0 : Math.random() < 0.6 ? 1 : 2;
  for (let i = 0; i < nn; i++) { const t = 1.5 + Math.random() * Math.max(0.1, S.biteAt - 2.6); S.nibbles.push(t); }
  S.nibbles.sort((a, b) => a - b);
  S.sag = 0.07; S.endY0 = 0.15;
}
function startBite(p) {
  S.st = 'bite'; S.t = 0; S.ax = S.bx; S.az = S.bz;
  // the fish takes the bait (if you still carry some) — it decides what bites
  const bait = hasBait(p);
  if (bait) p.inv.take('bait', 1);
  S.fish = rollFish(S.water, bait); S.kg = rollKg(S.fish, bait);
  const kr = FISH[S.fish].kg; S.size01 = (S.kg - kr[0]) / (kr[1] - kr[0]);
  splash(S.bx, S.bz, 0.9 + 0.3 * FISH[S.fish].fight); snd.bite(S.bx, S.bz);
  toast('Bite! Tap to reel in');
}
function startReel(p) {
  S.st = 'reel'; S.t = 0;
  S.R = reelInit(S.fish, S.size01);
  S.d0 = Math.hypot(S.bx - p.x, S.bz - p.z);
  S.swim = 0; S.swimT = 0; S.clickT = 0; S.strainT = 0; S.splashT = 0;
  snd.hook(); splash(S.bx, S.bz, 0.6);
  toast('Hooked! Hold FIRE to reel — ease off when the line strains');
}
function finishReel(p, res) {
  const id = S.fish;
  if (res === 'caught') {
    splash(S.bx, S.bz, 0.9);
    if (PL && PL.give) PL.give(p, id, 1);
    else if (p.inv) { const left = p.inv.add(id, 1); if (left && G.ui) toast('Inventory full'); }
    const def = FISHING_ITEMS[id], kg = S.kg < 10 ? S.kg.toFixed(1) : Math.round(S.kg);
    if (id === 'fish_golden') { toast('★ A GOLDEN FISH! ★ (' + kg + ' kg) — traders pay a fortune for it', 'good'); Sfx.win(); }
    else if (def.rar === 'rare' || def.rar === 'uncommon') { toast('Nice catch! ' + def.name + ' (' + kg + ' kg)', 'good'); Sfx.win(); }
    else { toast('Caught a ' + def.name + ' (' + kg + ' kg)'); Sfx.pickup(); }
    if (G.onGather) try { G.onGather('fish', id); } catch (e) { }
    goIdle();
  } else if (res === 'snap') {
    snd.snap(); toast('The line snapped! The fish got away', 'bad'); splash(S.bx, S.bz, 0.5);
    if (G.rend) G.rend.shake = Math.max(G.rend.shake || 0, 0.25);
    goIdle();
  } else {
    snd.lost(); toast('It shook off the hook…'); reelBack(true);
  }
}

export const Fishing = {
  ROD,
  get state() { return S.st; },
  /** internal state, for tests / debugging only */
  get debug() { return S; },
  canFish(p) { return holdsRod(p); },

  onFire(p) {
    if (!p || p.dead || p.vehicle || !holdsRod(p) || !G.W) return;
    switch (S.st) {
      case 'idle': startCast(p); break;
      case 'wait': reelBack(); break;                              // too early: reel the line in
      case 'bite': if (S.t <= BITE_WIN) startReel(p); break;
      default: break;                                              // cast / reel / back: ignore
    }
  },

  update(dt, p) {
    dt = clamp(dt || 0, 0, 0.1);
    if (S.st === 'idle') { if (OBJ) tickRipples(dt); return; }
    if (!p || p.dead || p.vehicle || G.buildMode || !holdsRod(p) || !G.W) { this.reset(); return; }
    if (!ensureInScene()) return;
    S.t += dt;
    const T = G.t || performance.now() / 1000;
    // walked away from the line
    if (S.st !== 'cast' && S.st !== 'back' && Math.hypot(S.bx - p.x, S.bz - p.z) > LEASH) { snd.snap(); toast('Your line snapped — you walked too far away', 'bad'); goIdle(); return; }
    const holding = !!Input.held.fire && !G.uiBlock;
    let pull = 0;
    switch (S.st) {
      case 'cast': {
        const u = Math.min(1, S.t / S.dur);
        const x = lerp(S.from.x, S.to.x, u), z = lerp(S.from.z, S.to.z, u), y = lerp(S.from.y, S.to.y, u) + 4 * S.arc * u * (1 - u);
        setBob(x, y, z); OBJ.bob.rotation.z = -u * 3;
        S.sag = 0.015 + 0.05 * u;
        if (u >= 1) { OBJ.bob.rotation.set(0, 0, 0); landBobber(p); }
        break;
      }
      case 'miss': {   // landed on the ground: a short pause, then reel back
        if (S.t > 0.35) reelBack();
        break;
      }
      case 'wait': {
        // nibbles: small dips
        if (S.nibbles.length && S.t >= S.nibbles[0]) { S.nibbles.shift(); S.dip = 0.045; snd.nibble(); ripple(S.bx, S.bz, 0.25); }
        S.dip = Math.max(0, S.dip - dt * 0.18);
        const bobY = WATER_SURF + 0.01 + Math.sin(T * 2.2) * 0.008 + Math.sin(T * 3.7 + 1) * 0.004 - S.dip;
        setBob(S.bx, bobY, S.bz);
        OBJ.bob.rotation.set(Math.sin(T * 1.7) * 0.08, 0, Math.sin(T * 2.3) * 0.08);
        if (Math.random() < dt * 0.25) ripple(S.bx, S.bz, 0.15);
        if (S.t >= S.biteAt) startBite(p);
        break;
      }
      case 'bite': {
        const k = S.t;
        // yanked under, then bobbing hard
        const d = k < 0.12 ? sstep(0, 0.12, k) * 0.16 : 0.07 + 0.08 * Math.abs(Math.sin(k * 13)) * Math.exp(-k * 0.8);
        setBob(S.ax + Math.sin(k * 17) * 0.025, WATER_SURF + 0.01 - d, S.az + Math.cos(k * 15) * 0.025);
        OBJ.bob.rotation.set(Math.sin(k * 19) * 0.3, 0, Math.cos(k * 16) * 0.3);
        if (Math.random() < dt * 6) splash(S.bx, S.bz, 0.3);
        S.sag = 0.03; pull = 0.25;
        if (S.t > BITE_WIN) { snd.lost(); toast('It got away…'); reelBack(true); }
        break;
      }
      case 'reel': {
        const R = S.R;
        const res = reelStep(R, dt, holding);
        // bobber: dragged towards you along the line, the fish swims side to side
        S.swimT -= dt; if (S.swimT <= 0) { S.swimT = 0.4 + Math.random() * 0.8; S.swimTgt = (Math.random() * 2 - 1) * (0.4 + R.pull); }
        S.swim += ((S.swimTgt || 0) - S.swim) * Math.min(1, dt * 2.5);
        let dx = S.bx - p.x, dz = S.bz - p.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        const want = 1.4 + (S.d0 - 1.4) * (1 - R.progress);
        const nx = p.x + dx * want - dz * S.swim * dt * 1.6, nz = p.z + dz * want + dx * S.swim * dt * 1.6;
        const under = 0.05 + 0.06 * R.pull;
        setBob(nx, Math.max(WATER_SURF - under, groundAt(nx, nz) + 0.04), nz);
        OBJ.bob.rotation.set(0.5 * S.swim, 0, 0.4);
        S.splashT -= dt; if (S.splashT <= 0) { S.splashT = 0.12 + Math.random() * (0.5 - 0.35 * R.pull); if (G.W.height(nx, nz) < WATER_SURF) splash(nx, nz, 0.25 + 0.55 * R.pull); }
        // line: straightens with tension, reddens when it is about to go
        S.sag = 0.035 * (1 - R.tension); S.endY0 = 0.02;
        if (OBJ) OBJ.lm.color.copy(OBJ.white).lerp(OBJ.red, sstep(0.6, 0.95, R.tension));
        // sounds
        if (holding) { S.clickT -= dt; if (S.clickT <= 0) { S.clickT = 0.075; snd.click(R.tension); } }
        if (R.tension > 0.72) { S.strainT -= dt; if (S.strainT <= 0) { S.strainT = 0.16; snd.strain(R.tension); } }
        pull = 0.25 + 0.75 * R.tension;
        if (res) finishReel(p, res);
        break;
      }
      case 'back': {
        const u = Math.min(1, S.t / 0.4), tip = rodTip(p, _c), b = S.back;
        const e = u * u;
        setBob(lerp(b.x, tip.x, e), lerp(b.y, tip.y, e) + Math.sin(u * Math.PI) * 0.6, lerp(b.z, tip.z, e));
        S.sag = 0.02 * (1 - u);
        if (u >= 1) goIdle();
        break;
      }
    }
    if (S.st !== 'reel' && OBJ) OBJ.lm.color.copy(OBJ.white);
    if (S.st !== 'idle') vmFx(false, pull);
    tickRipples(dt);
  },

  /** null when idle, else { state, label, tension 0..1, progress 0..1, bar } (bar = show the tension/progress bar) */
  hud() {
    switch (S.st) {
      case 'idle': return null;
      case 'cast': return { state: 'cast', label: 'Casting…', tension: 0, progress: 0, bar: false };
      case 'miss': case 'back': return { state: 'back', label: 'Reeling in…', tension: 0, progress: 0, bar: false };
      case 'wait': return { state: 'wait', label: 'Wait for a bite… (tap to reel in)', tension: 0, progress: 0, bar: false };
      case 'bite': return { state: 'bite', label: 'BITE! Tap now!', tension: 0, progress: 0, bar: false };
      case 'reel': { const R = S.R; return { state: 'reel', label: R.tension > 0.78 ? 'Line straining — let go!' : 'Hold FIRE to reel in', tension: R.tension, progress: R.progress, bar: true, fish: S.fish }; }
    }
    return null;
  },

  reset() { goIdle(); removeObjects(true); S.nibbles = []; S.dip = 0; },
};

// ============================================================================
// ICONS (optional) — 16x16 pixel icons for the new ids, drawn here so art_icons.js stays
// untouched. registerFishingIcons() wraps ART.icon / ART.iconURL for these ids only.
// ============================================================================
const ICON_OUT = '#181425';
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) { const A = hexRgb(a), B = hexRgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
// species: back, body, belly, fin, mark colour + pattern
const FISH_LOOK = {
  fish_perch: { back: '#4f5a22', body: '#9aa242', belly: '#e6dfa8', fin: '#d86a2a', mark: '#3a4018', pat: 'bars' },
  fish_trout: { back: '#56705a', body: '#a8bca8', belly: '#eef0e2', fin: '#8aa08a', mark: '#d86a8a', pat: 'stripe' },
  fish_mackerel: { back: '#244a6a', body: '#5a90b0', belly: '#e8eef2', fin: '#3a6080', mark: '#16304a', pat: 'waves' },
  fish_salmon: { back: '#5a6a7a', body: '#d08a7a', belly: '#f4e0d4', fin: '#a86a5a', mark: '#3a3a4a', pat: 'spots' },
  fish_tuna: { back: '#1c2c52', body: '#3c5a8a', belly: '#d8e0e8', fin: '#e8c040', mark: '#e8c040', pat: 'finlets' },
  fish_golden: { back: '#b87818', body: '#f2c040', belly: '#fff0a8', fin: '#ffd860', mark: '#fff8d8', pat: 'shine' },
  cooked_fish: { back: '#5a2e14', body: '#a8642e', belly: '#d8a060', fin: '#7a4220', mark: '#3a1c0c', pat: 'grill' },
};
function iconCanvas() { const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return [c, g]; }
function outline(c) {
  const g = c.getContext('2d'), d = g.getImageData(0, 0, 16, 16).data;
  const a = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && d[(y * 16 + x) * 4 + 3] > 0;
  g.fillStyle = ICON_OUT;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (!a(x, y) && (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1))) g.fillRect(x, y, 1, 1);
  return c;
}
function drawFish(g, L) {
  const px = (x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
  const cx = 6.6, cy = 8, rx = 5.9, ry = 3.3;
  const inBody = (x, y) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
  const inTail = (x, y) => { const dy = Math.abs(y + 0.5 - cy); return x >= 12 && x <= 14 && dy <= (x - 11) * 1.15 + 0.2 && !(x === 14 && dy < 1.2); };
  // fins (behind the body)
  for (const [x, y] of [[5, 4], [6, 4], [7, 4], [8, 4], [6, 3], [7, 3], [9, 5]]) px(x, y, L.fin);
  for (const [x, y] of [[6, 12], [7, 12], [8, 11]]) px(x, y, L.fin);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (inTail(x, y)) { px(x, y, Math.abs(y + 0.5 - cy) > 1.6 ? L.fin : mix(L.fin, L.back, 0.35)); continue; }
    if (!inBody(x, y)) continue;
    const v = (y + 0.5 - (cy - ry)) / (2 * ry);
    px(x, y, v < 0.28 ? L.back : v < 0.58 ? L.body : v < 0.74 ? mix(L.body, L.belly, 0.5) : L.belly);
  }
  // highlight along the back, gill, eye, mouth
  for (const [x, y] of [[4, 6], [5, 5], [6, 5]]) if (inBody(x, y)) px(x, y, mix(L.body, '#ffffff', 0.45));
  for (const y of [6, 7, 8, 9]) px(4, y, mix(L.back, '#000000', 0.25));
  px(2, 7, '#f6f2e6'); px(2, 8, '#181425'); px(1, 9, mix(L.back, '#000000', 0.4));
  // species marks
  const M2 = (x, y) => { if (inBody(x, y)) px(x, y, L.mark); };
  if (L.pat === 'bars') for (const x of [6, 8, 10]) for (const y of [5, 6, 7, 8]) M2(x, y);
  if (L.pat === 'stripe') for (let x = 5; x <= 11; x++) M2(x, 8);
  if (L.pat === 'waves') for (const [x, y] of [[6, 5], [7, 6], [8, 5], [9, 6], [10, 5], [11, 6], [6, 7], [8, 7], [10, 7]]) M2(x, y);
  if (L.pat === 'spots') for (const [x, y] of [[6, 6], [8, 5], [9, 7], [11, 6], [7, 8]]) M2(x, y);
  if (L.pat === 'finlets') { for (const x of [9, 10, 11]) { px(x, 4 + (x - 9 > 0 ? 1 : 0), L.mark); px(x, 11 - (x - 9 > 0 ? 1 : 0), L.mark); } for (let x = 5; x <= 10; x++) M2(x, 7); }
  if (L.pat === 'shine') { for (const [x, y] of [[0, 2], [1, 1], [1, 2], [1, 3], [2, 2], [14, 3], [13, 13], [15, 12], [14, 12], [14, 11]]) px(x, y, '#fff6c8'); for (const [x, y] of [[7, 6], [9, 6], [8, 9]]) M2(x, y); }
  if (L.pat === 'grill') { for (const [x0, y0] of [[5, 5], [8, 5], [11, 6]]) for (let i = 0; i < 5; i++) M2(x0 - i, y0 + i); px(2, 7, mix(L.body, '#000000', 0.3)); }
}
function drawRod(g) {
  const px = (x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
  // blank from the handle (bottom-left) to the tip (top-right)
  for (let i = 0; i <= 10; i++) { px(4 + i, 11 - i, i < 6 ? '#7a5434' : '#9a7448'); if (i < 4) px(5 + i, 11 - i, '#5e3d24'); }
  // cork handle + butt
  for (const [x, y] of [[1, 14], [2, 13], [3, 12], [2, 14], [3, 13], [4, 12]]) px(x, y, '#d8b07a');
  px(0, 15, '#2a2828'); px(1, 15, '#2a2828');
  // reel
  for (const [x, y] of [[5, 13], [6, 13], [5, 14], [6, 14], [7, 13]]) px(x, y, '#8a9099'); px(6, 12, '#5a6068'); px(7, 14, '#c49a45');
  // line hanging from the tip + bobber
  for (let y = 2; y <= 9; y++) px(14, y, '#e8eef2');
  px(14, 10, '#e03a2a'); px(13, 10, '#e03a2a'); px(15, 10, '#e03a2a'); px(14, 11, '#f2efe6'); px(13, 11, '#f2efe6'); px(15, 11, '#f2efe6'); px(14, 12, '#f2efe6');
}
function drawBait(g) {
  const px = (x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
  // tin can
  for (let y = 8; y <= 14; y++) for (let x = 3; x <= 12; x++) px(x, y, x < 5 ? '#c8ced6' : x > 10 ? '#6a7078' : '#9aa2ac');
  for (let x = 3; x <= 12; x++) { px(x, 7, '#5a6068'); px(x, 11, '#b0705a'); px(x, 12, '#b0705a'); }
  for (let x = 4; x <= 11; x++) px(x, 6, '#3a3030');
  // worms curling out of the top
  const W1 = '#e88a8a', W2 = '#c05a6a';
  for (const [x, y, c] of [[5, 5, W1], [5, 4, W1], [6, 3, W1], [7, 3, W2], [8, 4, W1], [8, 5, W2], [9, 5, W1], [10, 4, W1], [11, 3, W1], [11, 2, W2], [6, 5, W2], [3, 5, W1], [2, 4, W2]]) px(x, y, c);
}
const iconCache = {};
export function fishingIcon(id) {
  if (iconCache[id]) return iconCache[id];
  const [c, g] = iconCanvas();
  if (FISH_LOOK[id]) drawFish(g, FISH_LOOK[id]); else if (id === ROD) drawRod(g); else if (id === 'bait') drawBait(g); else return null;
  return (iconCache[id] = outline(c));
}
/** Optional: route ART.icon / ART.iconURL for the fishing ids to the icons above. Returns true if installed. */
export function registerFishingIcons(A) {
  A = A || (typeof window !== 'undefined' ? window.ART : null);
  if (!A || !A.iconURL || A._fishing) return false;
  const baseURL = A.iconURL, baseIcon = A.icon, urls = {};
  A.icon = id => (FISHING_ITEMS[id] && fishingIcon(id)) || (baseIcon ? baseIcon(id) : null);
  A.iconURL = id => {
    if (!FISHING_ITEMS[id]) return baseURL(id);
    if (!urls[id]) { try { const c = fishingIcon(id); urls[id] = c ? c.toDataURL() : baseURL(id); } catch (e) { urls[id] = baseURL(id); } }
    return urls[id];
  };
  A._fishing = true;
  return true;
}

export default Fishing;

// ============================================================================
// ZONEFALL 3 — game orchestration: runs (new / load / end), world setup,
// day-night cycle, night raids, airdrops, death + respawn, hooks between
// systems, per-frame update, lights + roofs, autosave.
// ============================================================================
import { THREE, M } from './gfx/materials.js';
import { G } from './state.js';
import { ITEMS, ENEMIES, LOOT, DEPLOY, PERKS, VERSION, MONUMENTS } from './data.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Physics } from './physics.js';
import { generateWorld, WORLD } from './world/gen.js';
import { buildTerrain, buildMapCanvas } from './gfx/terrain.js';
import { Renderer } from './gfx/renderer.js';
import { FX } from './gfx/fx.js';
import { CullGrid } from './gfx/cullgrid.js';
import { Build } from './build.js';
import { updateDoors } from './doors.js';
import { spawnActor, removeActor, syncRig } from './actors.js';
import { updateAI, alertTo } from './ai.js';
import { updateProjectiles, updateThrowns, updateTurrets, hurt, explode } from './combat.js';
import { WEAPONS } from './data.js';
import { Live, rollInto } from './world/live.js';
import { PlayerInv, Inv } from './inventory.js';
import { makePlayer, starterKit, updatePlayer, refreshLook, refreshHeld, findInteract, doInteract, updateCrafting, meleeWorld } from './player.js';
import { Save } from './save.js';
import { Bots } from './bots.js';
import { spawnHeli, updateHeli } from './events.js';
import { clamp, dist, rand, randi, pick, chance, fmtTime } from './util.js';

export const DAY_LEN = 720; // seconds per full day (dawn 0.25, dusk 0.77)
const NIGHT_START = 0.78, NIGHT_END = 0.22;

export const Game = {
  init(canvas) {
    G.meta = Save.loadMeta(); G.settings = Save.loadSettings();
    G.rend = new Renderer(canvas, G.settings.gfx); G.scene = G.rend.scene;
    G.fx = new FX(G.scene); G.fx.models = G.models;
    Sfx.enabled = G.settings.sound; Sfx.setVolume(G.settings.volume); G.rend.setFov(G.settings.fov || 72);
    Input.init(canvas); Input.buildMode = () => !!G.buildMode;
    this.hooks();
    G.mode = 'menu';
    this.last = performance.now();
    requestAnimationFrame(t => this.frame(t));
  },
  // ---------------------------------------------------------------- runs
  newRun(seed) {
    seed = seed || (G.W && !G.worldUsed ? G.W.seed : ((Math.random() * 1e9) | 0));
    G.run = { seed, day: 1, clock: 0.3, t: 0, perks: [...G.meta.perks], bps: [], kills: 0, deaths: 0, looted: 0, gathered: 0, raidsBeaten: 0, built: 0, tut: G.meta.tutDone ? -1 : 0, stats: {}, airdropAt: 0.55, version: VERSION };
    if (G.run.perks.includes('scholar')) G.run.bps.push('revolver', 'antirad', 'grenade');
    if (!(G.W && G.W.seed === seed && !G.worldUsed)) this.setupWorld(seed);
    G.worldUsed = true; G.mode = 'play';
    const sp = pick(G.W.spawns);
    const inv = new PlayerInv(); starterKit(inv);
    G.player = makePlayer(sp.x, sp.z, inv); G.player.ang = G.player.yaw = sp.a;
    G.clock = G.run.clock; G.day = 1;
    Bots.init(null);
    this.afterSpawn(true);
    G.ui.toast('Day 1 — gather wood and stone, then build a shelter', 'good');
    this.save();
  },
  continueRun() {
    const s = Save.load(); if (!s) return this.newRun();
    G.run = s.run; if (!(G.W && G.W.seed === s.run.seed && !G.worldUsed)) this.setupWorld(s.run.seed); G.worldUsed = true; G.mode = 'play';
    Build.restore(s.base);
    Bots.init(s.bots);
    const inv = PlayerInv.from(s.player.inv);
    G.player = makePlayer(s.player.x, s.player.z, inv);
    Object.assign(G.player, { hp: s.player.hp, food: s.player.food, water: s.player.water, rad: s.player.rad || 0, sel: s.player.sel || 0 });
    refreshLook(G.player); refreshHeld(G.player);
    G.clock = s.run.clock; G.day = s.run.day; G.t = s.run.t || 0;
    for (const d of s.drops || []) Live.dropInv(d.x, d.z, Inv.from(d.inv, 30), d.kind, 900);
    this.afterSpawn(true);
    G.ui.toast('Day ' + G.day + ' — welcome back', 'good');
  },
  setupWorld(seed) {
    // tear down anything from a previous run
    if (G.worldGroup) { G.scene.remove(G.worldGroup); }
    Bots.reset();
    for (const a of [...G.actors]) removeActor(a);
    Build.reset();
    for (const k of ['actors', 'projectiles', 'throwns', 'drops', 'containers', 'nodes', 'doors', 'rooms', 'rads', 'lights', 'uses', 'anomalies', 'safes', 'labels', 'spawns', 'monuments', 'events']) G[k] = [];
    // scene: clear everything except lights / fx clouds
    const keep = new Set([G.rend.hemi, G.rend.sun, G.rend.sun.target, G.rend.spot, G.rend.spot.target, ...G.rend.pool, ...G.fx.clouds.map(c => c.pts), ...(G.keepObjs || [])]);
    for (const o of [...G.scene.children]) if (!keep.has(o)) G.scene.remove(o);
    G.W = generateWorld(seed);
    G.cull = new CullGrid(G.scene);
    G.phys = new Physics(WORLD, 4); G.decks = [];
    const baseWalk = G.W.walkable; G.W.walkable = (x, z) => baseWalk(x, z) || G.decks.some(d => x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1); G.phys.walkable = G.W.walkable;
    const T = buildTerrain(G.W); G.scene.add(T.group); G.terrain = T;
    // eye-level sea + grass (optional modules)
    G.water = null; G.grass = null;
    if (G.fpMods && G.fpMods.makeWater) { try { const w = G.fpMods.makeWater(WORLD * 4); w.mesh.position.set(WORLD / 2, -0.05, WORLD / 2); G.scene.add(w.mesh); T.sea.visible = false; G.water = w; } catch (e) { console.warn('water failed', e); } }
    if (G.fpMods && G.fpMods.Grass) { try { G.grass = new G.fpMods.Grass(G.scene, G.W); } catch (e) { console.warn('grass failed', e); } }
    Live.vegHidden.clear(); Live.treeHp.clear();
    Live.init();
    G.mapCanvas = buildMapCanvas(G.W, 512);
    G.raid = null; G.t = 0; G.mode = 'play'; G.buildMode = null;
    G.airdrop = null; G.worldUsed = false;
  },
  afterSpawn(snap) {
    const p = G.player; G.rend.setFP(p.x, p.y + 1.62, p.z, p.yaw ?? p.ang, 0, 0, 0);
    Sfx.listener = p; Sfx.startAmbient(G.night > 0.5 ? 'night' : 'day');
    if (G.tut) G.tut.start(G.run.tut);
    G.ui.showHud(true); G.ui.refreshAll();
  },
  endRun(reason) {
    if (G.mode === 'over') return;
    G.mode = 'over';
    const r = G.run; const score = Math.round(r.day * 10 + r.kills * 2 + r.raidsBeaten * 15 + r.looted * 0.5 + r.built * 0.2);
    const pts = Math.max(1, Math.floor(score / 25));
    G.meta.points += pts; G.meta.runs++; G.meta.best = Math.max(G.meta.best, r.day); G.meta.kills += r.kills; Save.writeMeta(G.meta);
    Save.clear(); Sfx.lose();
    G.ui.gameOver({ reason, day: r.day, kills: r.kills, raids: r.raidsBeaten, looted: r.looted, deaths: r.deaths, score, pts });
  },
  save() {
    if (!G.run || G.mode !== 'play' || !G.player) return;
    const p = G.player; G.run.clock = G.clock; G.run.day = G.day; G.run.t = G.t;
    const pd = p.dead ? null : { x: p.x, z: p.z, hp: p.hp, food: p.food, water: p.water, rad: p.rad, sel: p.sel, inv: p.inv.toJSON() };
    const drops = G.drops.filter(d => d.kind === 'bag' && !d.inv.empty()).slice(0, 6).map(d => ({ x: d.x, z: d.z, kind: d.kind, inv: d.inv.toJSON() }));
    const data = { v: VERSION, run: G.run, base: Build.serialize(), player: pd || (G.lastPlayerSave || null), drops, bots: Bots.serialize() };
    if (pd) G.lastPlayerSave = pd;
    if (data.player) { Save.write(data); G.meta.saved = Date.now(); Save.writeMeta(G.meta); }
  },
  // ---------------------------------------------------------------- death / respawn
  playerDied(src) {
    const p = G.player; if (p.deathHandled) return; p.deathHandled = true;
    G.run.deaths++; Sfx.lose();
    // everything goes into a loot bag
    const inv = new Inv(40);
    for (const v of [p.inv.belt, p.inv.main]) for (const s of v.items()) inv.addStack(s);
    for (const k of ['helmet', 'armor', 'bag']) if (p.inv.equip[k]) inv.addStack(p.inv.equip[k]);
    for (const s of p.inv.arts) if (s) inv.addStack(s);
    if (!inv.empty()) { const bag = Live.dropInv(p.x, p.z, inv, 'bag', 1500); bag.death = true; G.deathBag = bag; }
    G.buildMode = null; document.body.classList.remove('building');
    const by = src && src.owner && src.owner.def ? src.owner.def.name : src && src.kind === 'rad' ? 'radiation' : src && src.kind === 'bleed' ? 'bleeding out' : src && (src.kind === 'starve' || src.kind === 'thirst') ? (src.kind === 'starve' ? 'starvation' : 'thirst') : src && src.kind === 'explosion' ? 'an explosion' : 'the island';
    setTimeout(() => G.ui.deathScreen(by), 1400);
    this.save();
  },
  respawnOptions() {
    const out = [];
    for (const d of Build.deploys) if (d.owner === 'player' && (d.type === 'sleeping_bag' || d.type === 'bed')) { const cd = Math.max(0, (d.lastSpawn || -999) + DEPLOY[d.type].spawn - G.t); out.push({ d, label: DEPLOY[d.type].name, cd }); }
    return out;
  },
  respawn(bag) {
    const old = G.player; let x, z, ang = 0;
    if (bag) { x = bag.x + 0.6; z = bag.z; bag.lastSpawn = G.t; }
    else { const sp = pick(G.W.spawns); x = sp.x; z = sp.z; ang = sp.a; }
    if (old) removeActor(old);
    const inv = new PlayerInv(); inv.belt.add('rock', 1); inv.belt.add('torch', 1);
    G.player = makePlayer(x, z, inv); G.player.ang = G.player.yaw = ang; G.player.food = 60; G.player.water = 60; G.player.hp = 60;
    G.player.queue = old ? old.queue : [];
    this.afterSpawn(true); G.ui.refreshAll(); this.save();
  },
  // ---------------------------------------------------------------- hooks between systems
  hooks() {
    G.onMeleeWorld = meleeWorld;
    G.onBreakContainer = (c, by) => Live.breakContainer(c, by);
    G.onNoise = (x, z, r, src) => { for (const a of G.actors) if (a !== src && !a.dead && a.team !== 'player' && (a.x - x) ** 2 + (a.z - z) ** 2 < r * r) alertTo(a, x, z, src); };
    G.onHurt = (a, d, src) => {
      if (a.bot) Bots.onHurt(a, src);
      if (a === G.player && src && src.owner && src.owner !== a) { a.lastAttacker = src.owner; a.lastAttackT = G.t; }
      if (a === G.player) {
        Sfx.hurt(); G.ui.hurtFlash(d, src && src.dir !== undefined ? src.dir : null); if (G.rend) G.rend.shake = Math.max(G.rend.shake, Math.min(0.6, d / 30));
      } else if (src && src.owner === G.player) { alertTo(a, G.player.x, G.player.z, G.player); if (a.team === 'haven') G.player.hostileT = 90; }
    };
    G.onKill = (a, src) => {
      a.dead = true; a.deadT = 0; a.st.aim = false;
      if (a.heli) { if (src && src.owner === G.player) { G.run.kills++; G.ui.killFeed('Patrol Gunship'); } return; }
      if (a === G.player) { this.playerDied(src); return; }
      if (a.bot) { if (src && src.owner === G.player) G.run.kills++; Bots.onKill(a, src); return; }
      if (src && src.owner === G.player) { G.run.kills++; G.ui.killFeed(a.def.name); }
      if (a.spawn) a.spawn.deadAt = G.t;
      // loot: animals give an always-drop "corpse" bag (gather with a tool = instant here)
      const tbl = a.def.drop ? LOOT[a.def.drop] : null;
      const inv = new Inv(16);
      if (tbl) rollInto(inv, tbl, 0);
      if (a.gun && a.kind === 'human' && chance(a.boss ? 1 : 0.22)) inv.add(a.gun.id, 1, { ammo: 0 });
      if (a.gun && a.kind === 'human' && chance(0.5)) { const W = { pipe_pistol: 'pistol_ammo', revolver: 'pistol_ammo', smg: 'pistol_ammo', ar: 'rifle_ammo', hunting: 'rifle_ammo', boomstick: 'shell', pump: 'shell', bow: 'arrow' }[a.gun.id]; if (W) inv.add(W, randi(4, 12)); }
      if (!inv.empty()) setTimeout(() => { const b = Live.dropInv(a.x, a.z, inv, a.kind === 'animal' ? 'item' : 'bag', 400); b.corpse = a.def.name; }, 600);
      setTimeout(() => removeActor(a), 25000);
      if (a.def.boss && G.ui) G.ui.toast(a.def.name + ' is dead!', 'good');
    };
    G.onPieceDestroyed = p => { if (p.owner === 'player' && G.raid) G.raid.lost++; };
    G.onDeployDestroyed = d => {
      if (d.type === 'tc' && d.owner === 'player') { G.ui.toast('Your Tool Cupboard was destroyed!', 'bad'); setTimeout(() => this.endRun('Raiders destroyed your Tool Cupboard.'), 2500); }
      if (d.inv && !d.inv.empty()) Live.dropInv(d.x, d.z, d.inv, 'bag', 900);
    };
    G.onSupplySignal = (x, z) => this.callAirdrop(x, z);
    G.onContainerLooted = (c, by) => { if (by === G.player) { G.run.looted++; if (c.def.breakable && G.tut) G.tut.event('barrel'); } };
    G.onGive = (id, n) => { if (['wood', 'stone', 'metal_ore', 'sulfur_ore'].includes(id)) G.run.gathered += n; if (G.tut) G.tut.event('give', id, n); };
    G.onBuilt = (type, r) => { G.run.built++; if (G.tut) G.tut.event('build', type); if (type === 'tc') G.ui.toast('Land claimed. Raiders will come at night — defend your cupboard!', 'good'); };
    G.onCraft = id => { if (G.tut) G.tut.event('craft', id); };
    G.onGather = (k, t) => { if (G.tut) G.tut.event('gather', k, t); };
    G.onPlayerHit = (a, crit) => G.ui.hitMarker(crit);
    G.onVault = () => { if (G.tut) G.tut.event('vault'); };
    G.onExplosionWorld = () => { };
  },
  // ---------------------------------------------------------------- time, raids, events
  updateTime(dt) {
    const prev = G.clock;
    const nightNow = G.clock > NIGHT_START + 0.01 || G.clock < NIGHT_END - 0.01;
    G.clock += dt / DAY_LEN * (nightNow ? 2 : 1);
    if (G.clock >= 1) { G.clock -= 1; }
    const crossed = (a) => (prev < a && G.clock >= a) || (prev > G.clock && (prev < a || G.clock >= a) && a < G.clock + 1 && (prev < a || G.clock >= a) && false);
    // dawn
    if (prev < 0.25 && G.clock >= 0.25) this.dawn();
    // dusk -> raid
    if (prev < NIGHT_START - 0.03 && G.clock >= NIGHT_START - 0.03) { if (Build.tc) { Sfx.horn(); G.ui.toast('Night is coming. Raiders are gathering…', 'bad'); } }
    if (prev < NIGHT_START && G.clock >= NIGHT_START) this.startRaid();
    // midnight: day counter for raids is per night; new day at dawn
    if (prev > G.clock) { /* wrapped past midnight */ }
    // airdrop roughly once per day
    if (prev < G.run.airdropAt && G.clock >= G.run.airdropAt && G.day >= 2) this.callAirdrop();
    if (G.run.heliAt && prev < G.run.heliAt && G.clock >= G.run.heliAt && G.day >= 3) spawnHeli();
    void crossed;
  },
  dawn() {
    G.day++; G.run.day = G.day; G.run.airdropAt = rand(0.32, 0.68); G.run.heliAt = G.day >= 3 && chance(0.65) ? rand(0.3, 0.72) : 0;
    Build.dawn();
    if (G.raid) this.endRaid();
    Sfx.startAmbient('day');
    G.ui.toast('Day ' + G.day, 'good');
    this.save();
  },
  startRaid() {
    Sfx.startAmbient('night');
    if (!Build.tc) return;
    const day = G.day;
    const pieces = Build.edges.size + Build.cells.size;
    const power = clamp(0.55 + day * 0.09, 0.6, 1.6);
    const waves = day <= 1 ? 1 : day <= 3 ? 2 : 3;
    G.raid = { day, power, wave: 0, waves, nextT: 6, lost: 0, actors: [], speedMul: 1, size: 2 + Math.floor(day * 1.15 + pieces / 40) };
    Sfx.siren(); G.ui.toast('RAID! Defend your Tool Cupboard', 'bad'); G.ui.banner('RAID INCOMING', 'Night ' + day);
  },
  updateRaid(dt) {
    const R = G.raid; if (!R) return;
    if (!Build.tc) { this.endRaid(true); return; }
    R.nextT -= dt;
    if (R.wave < R.waves && R.nextT <= 0) {
      R.wave++; R.nextT = 45;
      const day = R.day; const n = R.size + (R.wave - 1);
      const table = [['thug', 5]];
      if (day >= 2) table.push(['gunner', 4]); if (day >= 3) table.push(['breacher', 2.5]); if (day >= 4) table.push(['brute', 2]); if (day >= 5) table.push(['rocketeer', 1.6]);
      const ang = rand(0, 6.28);
      for (let i = 0; i < n; i++) {
        let x, z, ok = false;
        for (let k = 0; k < 20 && !ok; k++) { const a = ang + rand(-0.6, 0.6), r = rand(52, 68); x = Build.tc.x + Math.cos(a) * r; z = Build.tc.z + Math.sin(a) * r; ok = G.W.walkable(x, z) && !G.W.isWater(x, z) && !G.phys.overlaps(x, z, 0.5); }
        if (!ok) continue;
        let kind = pickW(table); if (R.wave === R.waves && day >= 7 && i === 0 && day % 7 === 0) kind = 'ironjack';
        const a = spawnActor(kind, x, z, { team: 'raider' }); a.hp = a.maxhp = Math.round(a.maxhp * (0.85 + R.power * 0.25)); R.actors.push(a);
      }
      const dirs = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east']; const di = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
      G.ui.toast('Raiders approaching from the ' + dirs[di] + '!', 'bad'); Sfx.horn();
    }
    // wave cleared?
    if (R.wave >= R.waves && R.actors.every(a => a.dead || a.removed)) { this.endRaid(); }
  },
  endRaid(failed) {
    const R = G.raid; if (!R) return; G.raid = null;
    for (const a of R.actors) if (!a.dead && !a.removed) { a.ai.state = 'flee'; setTimeout(() => removeActor(a), 8000); a.def = Object.assign({}, a.def, { raider: false }); a.team = 'hostile'; a.ai.state = 'return'; a.ai.home = { x: a.x + (a.x - (Build.tc ? Build.tc.x : a.x)) * 3, z: a.z + (a.z - (Build.tc ? Build.tc.z : a.z)) * 3 }; }
    if (!failed && Build.tc) { G.run.raidsBeaten++; Sfx.win(); G.ui.banner('RAID REPELLED', R.lost ? R.lost + ' pieces lost' : 'Base intact'); if (G.tut) G.tut.event('raid'); }
  },
  callAirdrop(x, z) {
    if (x === undefined) { // random spot on land away from the base
      for (let k = 0; k < 40; k++) { const tx = rand(120, WORLD - 120), tz = rand(120, WORLD - 120); if (G.W.walkable(tx, tz) && !G.W.isWater(tx, tz) && G.W.height(tx, tz) > 0.5 && !G.phys.overlaps(tx, tz, 2)) { x = tx; z = tz; break; } }
      if (x === undefined) return;
    }
    const ang = rand(0, 6.28); const sx = x - Math.cos(ang) * 600, sz = z - Math.sin(ang) * 600;
    let plane = null; try { plane = G.models && G.models.makePlane ? G.models.makePlane() : null; } catch (e) { plane = null; }
    if (!plane) { plane = new THREE.Group(); M.add(plane, M.box(14, 2, 2), M.mat('#6a7068'), 0, 0, 0); M.add(plane, M.box(3, 0.4, 20), M.mat('#6a7068'), 0, 0, 0); }
    plane.position.set(sx, 70, sz); plane.rotation.y = -ang; G.scene.add(plane);
    G.airdrop = { x, z, ang, plane, px: sx, pz: sz, phase: 'fly', crate: null, t: 0 };
    Sfx.plane(); G.ui.toast('A cargo plane is inbound — airdrop incoming!', 'good');
  },
  updateAirdrop(dt) {
    const A = G.airdrop; if (!A) return;
    A.t += dt;
    if (A.plane) {
      A.px += Math.cos(A.ang) * 55 * dt; A.pz += Math.sin(A.ang) * 55 * dt; A.plane.position.set(A.px, 70, A.pz);
      if (A.phase === 'fly' && dist(A.px, A.pz, A.x, A.z) < 4) {
        A.phase = 'drop'; A.cy = 66;
        let crate = null, chute = null; try { crate = G.models.makeAirdrop(); chute = G.models.makeParachute(); } catch (e) { }
        if (!crate) { crate = new THREE.Group(); M.add(crate, M.box(1.4, 1.2, 1.4), M.surf('blue_paint'), 0, 0.6, 0); }
        if (!chute) { chute = new THREE.Group(); M.add(chute, M.sphere(3, 10, 6), M.mat('#c8c0a0', { side: 'double' }), 0, 6, 0).scale.y = 0.4; }
        A.crate = crate; A.chute = chute; G.scene.add(crate, chute);
      }
      if (dist(A.px, A.pz, A.x, A.z) > 700) { G.scene.remove(A.plane); A.plane = null; }
    }
    if (A.phase === 'drop') {
      const gy = G.W.height(A.x, A.z); A.cy = Math.max(gy, A.cy - dt * 7);
      A.crate.position.set(A.x, A.cy, A.z); A.chute.position.set(A.x, A.cy + 1.2, A.z); A.chute.rotation.y += dt * 0.3;
      if (A.cy <= gy + 0.01) {
        A.phase = 'landed'; G.scene.remove(A.crate, A.chute);
        const c = Live.addContainer({ type: 'airdrop', x: A.x, z: A.z, ry: 0 }); A.container = c;
        G.lights.push({ x: A.x, y: gy + 1.5, z: A.z, color: '#ff4040', intensity: 1.6, range: 8, airdrop: true });
        G.ui.toast('The airdrop has landed!', 'good');
        // scavengers go for it too
        for (let i = 0; i < randi(2, 3); i++) { const a = rand(0, 6.28); const b = spawnActor(G.day > 4 ? 'bandit' : 'scav', A.x + Math.cos(a) * 45, A.z + Math.sin(a) * 45); b.roamer = true; b.ai.state = 'alert'; b.ai.lastSeen = { x: A.x, z: A.z, t: G.t }; b.ai.t = 60; }
      }
    }
    if (A.phase === 'landed') {
      if (G.fx && A.container && !A.container.gone && (!A.container.inv || !A.container.inv.empty())) G.fx.smoke(A.x, G.W.height(A.x, A.z) + 1, A.z, '#d04040', dt);
      if (A.t > 900 || (A.container && A.container.inv && A.container.inv.empty())) { G.airdrop = null; G.lights = G.lights.filter(l => !l.airdrop); }
    }
  },
  // ---------------------------------------------------------------- frame
  frame(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000 || 0.016); this.last = t;
    try {
      if (G.mode === 'play' && !G.paused) this.update(dt);
      else if (G.mode === 'menu') this.menuScene(dt);
      if (G.ui) G.ui.tick(dt);
      this.renderFrame(dt);
    } catch (e) { console.error(e); if (!this._errShown) { this._errShown = true; G.ui && G.ui.toast('Error: ' + e.message, 'bad'); } }
    Input.endFrame();
    requestAnimationFrame(tt => this.frame(tt));
  },
  update(dt) {
    G.t += dt; const p = G.player;
    this.updateTime(dt);
    this.updateWeather(dt);
    const env = G.rend.setTime(G.clock, G.weather || 0); G.night = env.night;
    // player
    if (!p.dead) updatePlayer(p, dt); else p.deadT += dt;
    updateCrafting(p, dt);
    // interaction
    G.interact = p.dead || G.buildMode ? null : findInteract(p);
    if (!p.dead && !G.uiBlock) {
      if (Input.pressed.interact && G.interact) doInteract(p, G.interact);
      else if (Input.held.interact && G.interact && G.interact.hold) doInteract(p, G.interact);
    }
    // actors
    Bots.update(dt);
    for (const a of G.actors) {
      if (a.heli) { updateHeli(a, dt); continue; }
      if (a === p || a.bot) { if (a.dead) a.deadT += dt; continue; }
      if (a.dead) { a.deadT += dt; continue; }
      const d2 = (a.x - p.x) ** 2 + (a.z - p.z) ** 2;
      if (d2 > 160 * 160 && !a.def.raider) continue; // frozen when far
      updateAI(a, dt);
      if (d2 < 30 * 30 && a.speedNow > 0.6 && a.kind !== 'vehicle') { a.stepAcc = (a.stepAcc || 0) + a.speedNow * dt; if (a.stepAcc > (a.kind === 'animal' ? 1.1 : 1.6)) { a.stepAcc = 0; Sfx.stepAt(a.x, a.z, 'grass'); } }
    }
    updateProjectiles(dt); updateThrowns(dt); updateDoors(dt);
    Build.tick(dt); updateTurrets(dt); this.updateTraps(dt);
    Live.update(dt);
    this.updateRaid(dt); this.updateAirdrop(dt);
    // anomalies hurt + give artifacts
    for (const an of G.anomalies) {
      const d = dist(p.x, p.z, an.x, an.z);
      if (d < 1.6 && an.cd <= 0 && !p.dead) { an.cd = 1.2; hurt(p, an.kind === 'burner' ? 14 : an.kind === 'electro' ? 18 : 10, { kind: 'anomaly' }); if (G.fx) G.fx.explosion(an.x, G.W.height(an.x, an.z) + 0.5, an.z, 1.4); }
      if (an.art && d < 2.2 && !p.dead) { const left = p.inv.add(an.art, 1); if (!left) { G.ui.toast('Found ' + ITEMS[an.art].name + '!', 'good'); Sfx.win(); an.art = null; } }
    }
    // autosave
    this.saveT = (this.saveT || 0) + dt; if (this.saveT > 25) { this.saveT = 0; this.save(); }
    // tutorial
    if (G.tut) G.tut.tick(dt);
  },
  updateWeather(dt) {
    const W = this.wx || (this.wx = { target: 0, t: rand(200, 400) });
    W.t -= dt; if (W.t <= 0) { const raining = W.target > 0; W.target = raining ? 0 : rand(0.5, 1); W.t = raining ? rand(300, 600) : rand(90, 200); if (!raining) G.ui.toast('It starts to rain…'); }
    G.weather = (G.weather || 0) + Math.sign(W.target - (G.weather || 0)) * Math.min(Math.abs(W.target - (G.weather || 0)), dt * 0.05);
    if (G.weather > 0.05 && G.fx && G.player) G.fx.rain(G.rend.target.x, G.rend.target.y, G.rend.target.z, G.weather, dt);
    if (G.weather > 0.2) { this.rainSnd = (this.rainSnd || 0) - dt; if (this.rainSnd <= 0) { this.rainSnd = 0.9; Sfx.noise(1.1, 2600, 0.4, 0.05 * G.weather, 'highpass'); } }
  },
  updateTraps(dt) {
    for (const d of Build.deploys) {
      const T = DEPLOY[d.type].trap; if (!T || d.owner !== 'player') continue;
      for (const a of G.actors) {
        if (a.dead || a.team === 'player' || a.team === 'haven' || (a.kind === 'animal' && a.def.flee)) continue;
        const dd = dist(a.x, a.z, d.x, d.z);
        if (T === 'mine' && dd < 0.9) { explode(d.x, d.z, { r: 3.2, dmg: 90, struct: 20 }, G.player, 'player'); Build.removeDeploy(d); break; }
        if (T === 'spikes' && dd < 1.7) { a.slowT = 0.6; if ((d.cd = (d.cd || 0) - dt) <= 0) { d.cd = 0.8; hurt(a, 9, { kind: 'spikes', bleed: 0.3 }); Build.damageDeploy(d, 5); } }
      }
    }
  },
  menuScene(dt) {
    if (!G.W) return;
    this.menuT = (this.menuT || 0) + dt;
    // a slow, low flyover around the island
    const a = this.menuT * 0.022 + 0.6, R0 = 210 + Math.sin(this.menuT * 0.05) * 50;
    const cx = 400 + Math.cos(a) * R0, cz = 400 + Math.sin(a) * R0;
    const y = Math.max(G.W.height(cx, cz), 0) + 16 + Math.sin(this.menuT * 0.1) * 4;
    G.rend.setTime(0.33 + Math.sin(this.menuT * 0.015) * 0.08, 0); G.night = 0;
    G.rend.setFP(cx, y, cz, a + Math.PI / 2 + 0.35, -0.2, 0, dt);
    if (G.vm) G.vm.hidden = true;
    this.updateEnv(dt);
  },
  /** sky, grass, water, vegetation LOD around the camera */
  updateEnv(dt) {
    const cam = G.rend.camera.position;
    this.envT = (this.envT || 0) + dt;
    if (G.grass) G.grass.update(cam.x, cam.z, this.envT);
    if (G.water) G.water.update(this.envT, G.rend.sunDir, G.rend.scene.fog.color, G.night || 0);
    else if (G.terrain && G.terrain.seaTex) { G.terrain.seaTex.offset.x += dt * 0.01; G.terrain.seaTex.offset.y += dt * 0.006; }
    this.lodT = (this.lodT || 0) - dt;
    if (this.lodT <= 0) {
      this.lodT = 0.3; const fogFar = G.rend.scene.fog.far, k = G.rend.level === 'low' ? 0.75 : G.rend.level === 'high' ? 1.2 : 1;
      if (Live.veg && Live.veg.updateLOD) Live.veg.updateLOD(cam.x, cam.z, fogFar, k);
      if (G.cull) G.cull.update(cam.x, cam.z, k);
    }
  },
  // ---------------------------------------------------------------- render (first person)
  renderFrame(dt) {
    const p = G.player; const R = G.rend;
    if (G.mode === 'play' && p) {
      // ---- camera at the eyes
      let eye = p.eye + (p.airY || 0) - (p.landT || 0) * 0.07, roll = 0;
      this.bobT = (this.bobT || 0) + dt * (p.speedNow > 0.3 && !(p.airY > 0) ? p.speedNow * 1.9 : 0);
      const bobA = Math.min(1, p.speedNow / 4.5) * (p.ads > 0.5 ? 0.25 : 1);
      eye += Math.abs(Math.sin(this.bobT)) * 0.045 * bobA; roll = Math.sin(this.bobT) * 0.006 * bobA;
      if (p.dead) { const k = Math.min(1, p.deadT * 1.6); eye = 1.6 - k * 1.35; roll = k * 0.7; }
      if (p.st.flinch > 0) roll += Math.sin(G.t * 40) * p.st.flinch * 0.01;
      const s = p.inv && p.inv.belt.slots[p.sel];
      const scoped = s && s.id === 'hunting';
      R.fovK += ((1 - p.ads * (scoped ? 0.58 : 0.22) + (p.sprinting ? 0.07 : 0)) - R.fovK) * Math.min(1, dt * (p.ads > 0 ? 12 : 6)); R.applyFov();
      R.setFP(p.x, p.y + eye, p.z, p.yaw, p.pitch, roll, dt);
      R.camera.updateMatrixWorld();
      // ---- actors (our own body is never drawn in first person)
      const cx = p.x, cz = p.z;
      for (const a of G.actors) syncRig(a, dt, a !== p && (a.x - cx) ** 2 + (a.z - cz) ** 2 < 115 * 115);
      if (p.rig) p.rig.root.visible = false;
      // ---- lights
      const src = []; const night = G.night;
      if (night > 0.05) {
        for (const l of G.lights) if (!l.night || night > 0.3) src.push({ x: l.x, y: l.y, z: l.z, color: l.color, intensity: l.intensity * night * 1.4, range: l.range });
        for (const d of Build.deploys) { const L = DEPLOY[d.type].light; if (!L) continue; const lit = DEPLOY[d.type].oven ? d.state.lit : true; if (lit) src.push({ x: d.x, y: d.y + 1.2, z: d.z, color: d.type === 'floodlight' ? '#fff2d0' : '#ffa050', intensity: (d.type === 'floodlight' ? 3 : 2.2) * (0.9 + Math.random() * 0.1) * Math.max(0.35, night), range: L * 1.2 }); }
      } else for (const d of Build.deploys) { if (DEPLOY[d.type].oven && d.state.lit) src.push({ x: d.x, y: d.y + 0.8, z: d.z, color: '#ffa050', intensity: 1.2, range: 5 }); }
      for (const d of Build.deploys) if (DEPLOY[d.type].oven && d.state.lit && G.fx && (d.x - cx) ** 2 + (d.z - cz) ** 2 < 2500) G.fx.fire(d.x, d.y + (d.type === 'furnace' ? 1.4 : 0.25), d.z, d.type === 'furnace' ? 0.5 : 1);
      if (G.fx) for (const l of G.fx.lights) src.push(l);
      if (night > 0.3) for (const a of G.actors) if (a !== p && !a.dead && a.held === 'torch' && (a.x - cx) ** 2 + (a.z - cz) ** 2 < 60 * 60) { src.push({ x: a.x + Math.cos(a.ang) * 0.4, y: a.y + 1.9, z: a.z + Math.sin(a.ang) * 0.4, color: '#ffa850', intensity: 2.6 * (0.9 + Math.random() * 0.1), range: 11 }); if (G.fx && Math.random() < 0.3) G.fx.fire(a.x + Math.cos(a.ang) * 0.4, a.y + 1.9, a.z + Math.sin(a.ang) * 0.4, 0.3); }
      const cam = R.camera.position;
      if (!p.dead) {
        if (p.lightOn) src.unshift({ x: cam.x + Math.cos(p.yaw) * 0.5 - Math.sin(p.yaw) * 0.3, y: cam.y - 0.1, z: cam.z + Math.sin(p.yaw) * 0.5 + Math.cos(p.yaw) * 0.3, color: '#ffb060', intensity: 3.2 * (0.9 + Math.random() * 0.1), range: 14 });
        else if (night > 0.4) src.unshift({ x: cam.x, y: cam.y + 1, z: cam.z, color: '#9ab0e0', intensity: 1.2 * night, range: 9 });
      }
      G.lightSources = src; R.assignLights(src);
      // gun flashlight from the eyes at night
      if (!p.dead && night > 0.45 && s && ITEMS[s.id] && ITEMS[s.id].cat === 'gun' && G.settings.flashlight !== false) {
        const f = R.forward(_fwd); R.spot.intensity = 14 * night; R.spot.position.set(cam.x + f.x * 0.3, cam.y - 0.15, cam.z + f.z * 0.3);
        R.spot.target.position.set(cam.x + f.x * 12, cam.y + f.y * 12, cam.z + f.z * 12);
      } else R.spot.intensity = 0;
      // ---- first-person viewmodel
      if (G.vm) {
        G.vm.hidden = p.dead || G.uiBlock && G.ui && G.ui.sheetOpen;
        const want = G.buildMode ? (G.buildMode.hammer ? 'hammer' : 'buildplan') : s && ITEMS[s.id] && ['gun', 'melee', 'throw', 'med', 'food', 'drink'].includes(ITEMS[s.id].cat) ? s.id : null;
        const useId = p.useT >= 0 ? p.useItem : null;
        const show = useId || want;
        if (this.vmItem !== show) { this.vmItem = show; try { G.vm.setItem(show); } catch (e) { } }
        try {
          G.vm.setLighting({ hemiSky: R.hemi.color, hemiGround: R.hemi.groundColor, hemiIntensity: R.hemi.intensity, sunDir: R.sunDir, sunColor: R.sun.color, sunIntensity: R.sun.intensity, extra: p.lightOn ? [{ color: '#ffb060', intensity: 2.2 }] : night > 0.45 && R.spot.intensity > 0 ? [{ color: '#fff4dc', intensity: 0.8 }] : [] });
          G.vm.update(dt, { speed: p.speedNow, sprint: p.sprinting, crouch: p.crouch, air: p.airY > 0, ads: p.ads, lookDX: p.lookDX || 0, lookDY: p.lookDY || 0, fire: p.vmFire || 0, recoil: p.st.recoil || 0, reload: p.st.reload ?? -1, swing: p.st.swing ?? -1, throw: p.st.throw ?? -1, use: p.st.use ?? -1, hammer: G.buildMode && this.hammerT > 0 ? 1 - this.hammerT : -1, night, empty: s && WEAPONS[s.id] ? (s.ammo || 0) <= 0 : false, aimThrow: !!p.throwAim });
          G.vm.muzzleView(_mz); _mz.applyMatrix4(R.camera.matrixWorld); G.vmMuzzle = G.vmMuzzle || { x: 0, y: 0, z: 0 }; G.vmMuzzle.x = _mz.x; G.vmMuzzle.y = _mz.y; G.vmMuzzle.z = _mz.z;
        } catch (e) { if (!this._vmErr) { this._vmErr = true; console.warn('viewmodel', e); } }
        if (this.hammerT > 0) this.hammerT -= dt * 3;
      }
      // ambience
      this.ambT = (this.ambT || 0) - dt; if (this.ambT <= 0) { this.ambT = rand(3, 8); if (night > 0.6) Sfx.cricket(); else if (G.W.biomeAt(p.x, p.z) === 3 || G.W.biomeAt(p.x, p.z) === 2) Sfx.chirp(); if (G.W.biomeAt(p.x, p.z) === 1) Sfx.wave(); }
      Sfx.listener = p;
      this.updateEnv(dt);
    }
    if (G.fx) G.fx.update(dt, R.camera);
    if (G.ui) G.ui.preRender(dt);
    R.render();
  },
};
const _fwd = new THREE.Vector3(), _mz = new THREE.Vector3();
function pickW(table) { let t = 0; for (const e of table) t += e[1]; let r = Math.random() * t; for (const e of table) { r -= e[1]; if (r <= 0) return e[0]; } return table[0][0]; }
void ENEMIES; void PERKS; void MONUMENTS; void fmtTime; void syncRig;

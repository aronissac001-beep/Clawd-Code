'use strict';
// ============================================================================
// ZONEFALL — game controller: run state, modes (base day / zone expedition /
// night raid), player logic, inventory, base building, rendering.
// ============================================================================

const Game = {
  mode: 'menu', map: null, player: null, enemies: [], bullets: [], throwables: [], particles: [], texts: [], lights: [],
  turrets: [], flow: null, cam: { x: 0, y: 0, zoom: 1, sx: 0, sy: 0, free: false }, shakeT: 0, shakeA: 0,
  run: null, meta: null, stats: { kills: 0 }, buildMode: false, buildSel: 'wall_wood', paused: false,
  zs: null, rs: null, t: 0, lastT: 0, visT: 0, seenT: 0, noiseT: 0, uiT: 0, geigerT: 0, roamT: 0,

  // -------------------------------------------------------------------------
  init() {
    this.canvas = $('#view'); this.ctx = this.canvas.getContext('2d');
    this.lightC = document.createElement('canvas'); this.lctx = this.lightC.getContext('2d');
    this.meta = Save.loadMeta(); Sfx.enabled = this.meta.sound !== false;
    Input.init(this.canvas);
    addEventListener('resize', () => this.resize()); this.resize();
    UI.init();
    UI.showMenu();
    requestAnimationFrame(t => this.frame(t));
  },
  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = innerWidth; this.H = innerHeight;
    this.canvas.width = Math.floor(this.W * this.dpr); this.canvas.height = Math.floor(this.H * this.dpr);
    this.lightC.width = Math.ceil(this.W / 2); this.lightC.height = Math.ceil(this.H / 2);
    this.cam.zoom = clamp(Math.min(this.W, this.H) / 430, 0.75, 1.6);
    Input.STICK_R = clamp(Math.min(this.W, this.H) * 0.14, 44, 70);
  },
  hasPerk(id) { return this.meta && this.meta.perks.includes(id); },

  // -------------------------------------------------------------------------
  // RUN LIFECYCLE
  // -------------------------------------------------------------------------
  newRun() {
    const stash = { wood: 400, stone: 200, metal: 80, cloth: 40, pipe: 1, scrap: 20 };
    if (this.hasPerk('stockpile')) { stash.wood += 300; stash.stone += 300; stash.metal += 100; }
    const known = RECIPES.filter(r => !r.bp).map(r => r.id);
    if (this.hasPerk('scholar')) known.push('revolver', 'antirad');
    const c = BASE_SIZE / 2;
    const structs = [{ type: 'core', tx: c, ty: c, hp: CORE_LEVELS[0].hp }];
    if (this.hasPerk('engineer')) structs.push({ type: 'workbench1', tx: c + 2, ty: c - 1, hp: STRUCTS.workbench1.hp * 1.25 });
    const gear = {
      equip: { primary: { id: 'pipe_pistol', n: 1, m: 8 }, secondary: null, melee: { id: 'knife', n: 1 }, armor: null, helmet: null, bag: { id: 'bag_small', n: 1 }, art1: null, art2: null },
      bag: [{ id: 'pistol_ammo', n: 24 }, { id: 'bandage', n: 3 }], pouch: [],
    };
    if (this.hasPerk('kit')) { gear.equip.secondary = { id: 'boomstick', n: 1, m: 2 }; gear.bag.push({ id: 'shell', n: 12 }); }
    this.run = { day: 1, stash, known, structs, coreLvl: 0, gear, hp: null, stats: { kills: 0, raids: 0, exps: 0, extracts: 0, deaths: 0 }, trader: null, tutorial: 0, phase: 'day' };
    this.meta.runs++; Save.writeMeta(this.meta);
    this.rollTrader();
    this.enterBase(true);
    UI.toastBig('DAY 1', 'Build defenses before nightfall');
    UI.showGuide();
  },
  continueRun() {
    this.run = Save.load(); if (!this.run) return this.newRun();
    this.enterBase(true);
    UI.toastBig('DAY ' + this.run.day, this.run.phase === 'dusk' ? 'Raiders are coming' : 'Morning');
    if (this.run.phase === 'dusk') setTimeout(() => this.startRaid(), 1200);
  },
  save() {
    if (!this.run) return;
    this.run.gear = this.snapshotGear(); this.run.hp = this.player ? this.player.hp : null;
    if (this.map && this.map.kind === 'base') this.run.structs = this.collectStructs();
    this.run.stats.kills = this.stats.kills;
    Save.write(this.run);
  },
  snapshotGear() {
    const p = this.player; if (!p) return this.run.gear;
    return { equip: JSON.parse(JSON.stringify(p.equip)), bag: p.bag.filter(Boolean).map(i => ({ ...i })), pouch: p.pouch.filter(Boolean).map(i => ({ ...i })) };
  },
  collectStructs() {
    const out = []; const m = this.map;
    for (const s of m.struct) if (s && !s.dead && s.root !== false) out.push({ type: s.type, tx: s.tx, ty: s.ty, hp: Math.round(s.hp) });
    return out;
  },

  // -------------------------------------------------------------------------
  // PLAYER
  // -------------------------------------------------------------------------
  makePlayer(x, y) {
    const g = this.run.gear;
    const p = {
      x, y, r: 10, hp: 100, maxhp: 100, rad: 0, bleed: false, stamina: 100, ang: 0, moving: false,
      equip: JSON.parse(JSON.stringify(g.equip)), bag: [], pouch: [], active: g.equip.primary ? 'primary' : 'melee',
      fireCd: 0, reloadT: 0, useT: 0, useItem: null, gatherT: 0, swingT: 0, stimT: 0, regenT: 0, hurtT: 0, invuln: 0, dead: false, step: 0, recoil: 0,
    };
    const slots = this.bagSize(p); p.bag = new Array(slots).fill(null);
    g.bag.forEach((it, i) => { if (i < slots) p.bag[i] = { ...it }; });
    p.pouch = new Array(this.pouchSize()).fill(null); g.pouch.forEach((it, i) => { if (i < p.pouch.length) p.pouch[i] = { ...it }; });
    this.player = p; this.recalc();
    p.hp = this.run.hp != null ? Math.min(this.run.hp, p.maxhp) : p.maxhp;
    if (p.hp <= 0) p.hp = p.maxhp * 0.5;
    return p;
  },
  pouchSize() { return this.hasPerk('pockets') ? 5 : 3; },
  bagSize(p) { p = p || this.player; return p.equip.bag ? ITEMS[p.equip.bag.id].slots : 8; },
  recalc() {
    const p = this.player, e = p.equip;
    let armor = 0, crit = 0, rad = 0, spd = 1, maxhp = 100 + (this.hasPerk('tough') ? 20 : 0), regen = 0, radRate = 0, radRes = 0;
    for (const k of ['armor', 'helmet']) if (e[k]) { const d = ITEMS[e[k].id]; armor += d.armor || 0; rad += d.rad || 0; if (d.spd) spd *= d.spd; if (d.crit) crit = Math.max(crit, d.crit); }
    for (const k of ['art1', 'art2']) if (e[k]) { const fx = ITEMS[e[k].id].fx; armor += fx.armor || 0; spd += fx.speed || 0; maxhp += fx.maxhp || 0; regen += fx.regen || 0; radRate += fx.radRate || 0; radRes += fx.radRes || 0; }
    p.armorVal = Math.min(0.8, armor); p.critProt = crit; p.radProt = clamp(rad + radRes, 0, 0.95); p.speedMul = spd; p.maxhp = maxhp; p.artRegen = regen; p.artRad = radRate;
    p.hp = Math.min(p.hp, p.maxhp);
    // bag resize
    const want = this.bagSize(p);
    if (p.bag.length !== want) {
      const items = p.bag.filter(Boolean); p.bag = new Array(want).fill(null);
      items.forEach((it, i) => { if (i < want) p.bag[i] = it; else this.dropOverflow(it); });
    }
  },
  dropOverflow(it) {
    if (this.map && this.map.kind === 'base') { this.stashAdd(it.id, it.n); this.toast(ITEMS[it.id].name + ' moved to stash'); }
    else this.dropItems([it]);
  },
  dropItems(items) {
    const p = this.player; const m = this.map;
    let c = m.containers.find(c => c.type === 'corpse' && c.dropBag && dist(c.x, c.y, p.x, p.y) < 30);
    if (!c) { c = m.addContainer('corpse', p.x + rand(-8, 8), p.y + rand(-8, 8)); c.items = []; c.name = 'Dropped Items'; c.dropBag = true; c.searched = 99; }
    for (const it of items) c.items.push(it);
  },
  activeItem() { const p = this.player; return p.equip[p.active]; },
  // ---- inventory helpers (bag + pouch)
  countItem(id) { const p = this.player; let n = 0; for (const s of [p.bag, p.pouch]) for (const it of s) if (it && it.id === id) n += it.n; return n; },
  takeItem(id, n) {
    const p = this.player; let left = n;
    for (const s of [p.bag, p.pouch]) for (let i = s.length - 1; i >= 0 && left > 0; i--) {
      const it = s[i]; if (!it || it.id !== id) continue;
      const k = Math.min(left, it.n); it.n -= k; left -= k; if (it.n <= 0) s[i] = null;
    }
    return n - left;
  },
  addToBag(item, target) {
    const p = this.player; const s = target || p.bag; const def = ITEMS[item.id];
    if (def.stack > 1) for (const it of s) { if (it && it.id === item.id && it.n < def.stack) { const k = Math.min(def.stack - it.n, item.n); it.n += k; item.n -= k; if (item.n <= 0) return 0; } }
    while (item.n > 0) {
      const i = s.indexOf(null); if (i < 0) return item.n;
      const k = Math.min(def.stack, item.n); s[i] = { ...item, n: k }; item.n -= k;
    }
    return 0;
  },
  // ---- stash helpers
  stashCount(id) { return this.run.stash[id] || 0; },
  stashAdd(id, n) { this.run.stash[id] = (this.run.stash[id] || 0) + n; },
  stashTake(id, n) { const h = this.stashCount(id); const k = Math.min(h, n); this.run.stash[id] = h - k; if (this.run.stash[id] <= 0) delete this.run.stash[id]; return k; },
  canAfford(cost) { for (const k in cost) if (this.stashCount(k) < cost[k]) return false; return true; },
  pay(cost) { for (const k in cost) this.stashTake(k, cost[k]); },
  wbTier() {
    if (!this.run) return 0; const s = this.run.structs; const live = this.map && this.map.kind === 'base' ? this.collectStructs() : s;
    let t = 0; for (const x of live) { if (x.type === 'workbench3') t = Math.max(t, 3); else if (x.type === 'workbench2') t = Math.max(t, 2); else if (x.type === 'workbench1') t = Math.max(t, 1); }
    return t;
  },
  hasStruct(type) { const live = this.map && this.map.kind === 'base' ? this.collectStructs() : this.run.structs; return live.some(s => s.type === type); },

  // -------------------------------------------------------------------------
  // BASE
  // -------------------------------------------------------------------------
  enterBase(fresh) {
    this.mode = 'base'; this.run.phase = this.run.phase === 'dusk' ? 'dusk' : 'day';
    this.map = genBase(); const m = this.map;
    for (const s of this.run.structs) this.placeStruct(s.type, s.tx, s.ty, s.hp, true);
    this.rebuildBase();
    this.enemies = []; this.bullets = []; this.throwables = []; this.particles = []; this.texts = [];
    this.makePlayer(m.spawn.x, m.spawn.y);
    this.prerender();
    this.cam.x = this.player.x; this.cam.y = this.player.y;
    UI.setMode('base');
    Sfx.startAmbient('day');
  },
  placeStruct(type, tx, ty, hp, loading) {
    const m = this.map; const d = STRUCTS[type];
    let maxhp = type === 'core' ? CORE_LEVELS[this.run.coreLvl].hp : d.hp; if (this.hasPerk('engineer')) maxhp = Math.round(maxhp * 1.25);
    const s = { type, tx, ty, hp: hp != null ? Math.min(hp, maxhp) : maxhp, maxhp, x: tx * TILE + 16, y: ty * TILE + 16, cd: 0, ang: -Math.PI / 2, hitT: 0 };
    m.struct[m.idx(tx, ty)] = s;
    if (type === 'core') m.coreTile = { tx, ty };
    if (!loading) this.rebuildBase();
    return s;
  },
  rebuildBase() {
    const m = this.map; this.turrets = [];
    for (const s of m.struct) if (s && STRUCTS[s.type].turret) this.turrets.push({ x: s.x, y: s.y, s });
    this.flow = buildFlowField(m);
    this.coreRadius = CORE_LEVELS[this.run.coreLvl].r;
  },
  destroyStruct(s, silent) {
    const m = this.map; if (s.dead) return; s.dead = true;
    m.struct[m.idx(s.tx, s.ty)] = null;
    if (!silent) { Sfx.explode(s.x, s.y); for (let i = 0; i < 14; i++) this.particles.push({ x: s.x, y: s.y, vx: rand(-120, 120), vy: rand(-120, 120), life: rand(0.4, 0.9), max: 0.9, col: pick(['#7a5a3a', '#888', '#555']), size: rand(3, 6), drag: 3 }); }
    if (s.type === 'core') { this.gameOver(); return; }
    if (this.rs) this.rs.lost.push(STRUCTS[s.type].name);
    this.rebuildBase(); this.groundDirty = true;
  },
  onCoreHit(dmg, melee) {
    if (!this.rs) return;
    this.rs.coreHitT = 2;
    if (!melee) return;
    // raiders loot the stash while hitting the cupboard
    if (chance(0.35)) {
      const keys = Object.keys(this.run.stash).filter(k => this.run.stash[k] > 0 && k !== 'scrap' || (k === 'scrap' && this.run.stash[k] > 20));
      if (keys.length) { const k = pick(keys); const n = Math.max(1, Math.floor(this.run.stash[k] * 0.04)); this.stashTake(k, n); this.rs.stolen[k] = (this.rs.stolen[k] || 0) + n; }
    }
  },
  tryBuildAt(tx, ty) {
    const m = this.map, sel = this.buildSel; const s = m.st(tx, ty);
    const core = m.coreTile; const r = CORE_LEVELS[this.run.coreLvl].r;
    if (sel === 'remove') {
      if (!s || s.type === 'core') return this.toast('Nothing to remove');
      const d = STRUCTS[s.type]; for (const k in d.cost) this.stashAdd(k, Math.floor(d.cost[k] * 0.5));
      this.destroyStruct(s, true); Sfx.build(); this.toast('Removed ' + d.name + ' (50% refund)'); return;
    }
    if (sel === 'upgrade') {
      if (!s) return this.toast('Tap a wall or door to upgrade');
      const d = STRUCTS[s.type]; if (!d.upg) return this.toast('Cannot upgrade ' + d.name);
      const nd = STRUCTS[d.upg]; if ((nd.wb || 0) > this.wbTier()) return this.toast('Needs Workbench T' + nd.wb, 'bad');
      if (!this.canAfford(nd.cost)) return this.toast('Need ' + UI.costStr(nd.cost), 'bad');
      this.pay(nd.cost); m.struct[m.idx(tx, ty)] = null; this.placeStruct(d.upg, tx, ty); Sfx.build(); this.groundDirty = true;
      this.toast('Upgraded to ' + nd.name, 'good'); return;
    }
    if (sel === 'repair') {
      if (!s) return; const d = STRUCTS[s.type]; if (s.hp >= s.maxhp) return this.toast('Already at full health');
      const frac = 1 - s.hp / s.maxhp; const cost = {}; for (const k in d.cost) cost[k] = Math.ceil(d.cost[k] * frac * 0.5);
      if (s.type === 'core') { cost.wood = Math.ceil(200 * frac); cost.stone = Math.ceil(200 * frac); }
      if (!this.canAfford(cost)) return this.toast('Need ' + UI.costStr(cost), 'bad');
      this.pay(cost); s.hp = s.maxhp; Sfx.build(); this.toast('Repaired ' + d.name, 'good'); this.flow = buildFlowField(m); return;
    }
    const d = STRUCTS[sel]; if (!d) return;
    if (s) return this.toast('Tile occupied');
    if (Math.hypot(tx - core.tx, ty - core.ty) > r) return this.toast('Outside your claim radius. Upgrade the Cupboard to expand.', 'bad');
    const t = m.t(tx, ty); if (t !== T.GROUND) return this.toast('Cannot build there');
    if ((m.ogrid[m.idx(tx, ty)] || []).some(o => o.solid)) return this.toast('Clear the tree/rock first');
    if ((d.wb || 0) > this.wbTier()) return this.toast('Needs Workbench T' + d.wb, 'bad');
    if (d.unique && this.hasStruct(sel)) return this.toast('You can only have one ' + d.name);
    if (!this.canAfford(d.cost)) return this.toast('Need ' + UI.costStr(d.cost), 'bad');
    if (d.block) { const p = this.player; const px = Math.floor(p.x / TILE), py = Math.floor(p.y / TILE); if (Math.abs(px - tx) <= 0 && Math.abs(py - ty) <= 0 && !d.door) return this.toast('You are standing there'); }
    if (d.block && this.enemies.some(e => !e.dead && Math.floor(e.x / TILE) === tx && Math.floor(e.y / TILE) === ty)) return this.toast('Raider in the way');
    this.pay(d.cost); this.placeStruct(sel, tx, ty); Sfx.build(); this.groundDirty = true;
    for (let i = 0; i < 6; i++) this.particles.push({ x: tx * TILE + 16, y: ty * TILE + 16, vx: rand(-60, 60), vy: rand(-60, 60), life: 0.4, max: 0.4, col: '#a89070', size: 4, drag: 4 });
    this.run.tutorialFlags = this.run.tutorialFlags || {}; this.run.tutorialFlags['b_' + sel] = 1;
  },
  upgradeCore() {
    const n = this.run.coreLvl + 1; if (n >= CORE_LEVELS.length) return;
    const L = CORE_LEVELS[n]; if (!this.canAfford(L.cost)) return this.toast('Need ' + UI.costStr(L.cost), 'bad');
    this.pay(L.cost); this.run.coreLvl = n;
    const s = this.map.struct.find(s => s && s.type === 'core'); if (s) { const f = s.hp / s.maxhp; s.maxhp = L.hp * (this.hasPerk('engineer') ? 1.25 : 1); s.hp = s.maxhp * Math.max(f, 0.5); }
    this.rebuildBase(); this.groundDirty = true; Sfx.win(); this.toast('Claim expanded to radius ' + L.r, 'good');
  },
  repairAll() {
    const cost = {}; let any = false;
    for (const s of this.map.struct) {
      if (!s || s.hp >= s.maxhp) continue; any = true;
      const frac = 1 - s.hp / s.maxhp; const d = STRUCTS[s.type];
      const c = s.type === 'core' ? { wood: 200, stone: 200 } : d.cost;
      for (const k in c) cost[k] = (cost[k] || 0) + Math.ceil(c[k] * frac * 0.5);
    }
    if (!any) return this.toast('Everything is at full health');
    if (!this.canAfford(cost)) return this.toast('Need ' + UI.costStr(cost), 'bad');
    this.pay(cost); for (const s of this.map.struct) if (s) s.hp = s.maxhp;
    this.flow = buildFlowField(this.map); Sfx.build(); this.toast('All structures repaired', 'good');
  },
  autoStash() {
    const p = this.player; let n = 0; const keep = new Set(['ammo', 'med', 'throw', 'key']);
    for (let i = 0; i < p.bag.length; i++) { const it = p.bag[i]; if (!it || keep.has(ITEMS[it.id].cat)) continue; this.stashAdd(it.id, it.n); n += it.n; p.bag[i] = null; }
    return n;
  },

  // -------------------------------------------------------------------------
  // EXPEDITION (ZONE)
  // -------------------------------------------------------------------------
  deploy(zoneId) {
    const zone = ZONES.find(z => z.id === zoneId);
    this.save(); this.run.phase = 'day'; Save.write(this.run); // safety save: quitting mid-raid restores this
    this.mode = 'zone'; this.buildMode = false;
    this.map = genZone(zone); const m = this.map;
    this.enemies = []; this.bullets = []; this.throwables = []; this.particles = []; this.texts = [];
    this.turrets = []; this.flow = null;
    const g = this.snapshotGear(); const hp = this.player.hp;
    this.run.gear = g; this.makePlayer(m.spawn.x, m.spawn.y); this.player.hp = hp;
    const dayScale = 1 + Math.min(0.6, (this.run.day - 1) * 0.03);
    for (const gr of m.groups) for (let i = 0; i < gr.n; i++) {
      const e = makeEnemy(gr.type, gr.x + rand(-30, 30), gr.y + rand(-30, 30), dayScale);
      if (m.blocked(Math.floor(e.x / TILE), Math.floor(e.y / TILE), 'enemy')) { e.x = gr.x; e.y = gr.y; }
      this.enemies.push(e);
    }
    this.zs = { zone, time: zone.time, emission: false, emT: 0, exT: 0, ex: null, loot: 0, startKills: this.stats.kills };
    this.roamT = 70;
    this.prerender();
    this.cam.x = this.player.x; this.cam.y = this.player.y;
    this.run.stats.exps++;
    UI.setMode('zone');
    Sfx.startAmbient('day');
    UI.toastBig(zone.name.toUpperCase(), 'Find loot. Reach an extraction before the Emission.');
  },
  endExpedition(survived) {
    const z = this.zs; const p = this.player;
    let summary;
    if (survived) {
      this.run.stats.extracts++;
      summary = { title: 'EXTRACTED', sub: 'You made it out of ' + z.zone.name, ok: true };
    } else {
      // lose everything except the secure pouch
      this.run.stats.deaths++;
      const lost = [...p.bag.filter(Boolean), ...Object.values(p.equip).filter(Boolean)];
      p.bag = p.bag.map(() => null); for (const k in p.equip) p.equip[k] = null;
      p.equip.melee = { id: 'knife', n: 1 }; p.equip.bag = null; p.active = 'melee';
      this.recalc(); p.hp = p.maxhp * 0.6; p.bleed = false; p.rad = 0;
      summary = { title: 'K.I.A.', sub: 'Killed by ' + (p.killedBy || 'the Zone') + '. Your gear is gone. The pouch survived.', ok: false, lost: lost.length };
    }
    summary.kills = this.stats.kills - z.startKills;
    this.run.hp = Math.max(p.hp, survived ? p.hp : p.maxhp * 0.6);
    this.zs = null;
    this.run.gear = this.snapshotGear();
    this.run.phase = 'dusk';
    this.enterBase();
    this.player.hp = this.run.hp;
    const stashed = this.autoStash(); summary.stashed = stashed;
    this.save();
    UI.showSummary(summary, () => this.startRaid());
  },

  // -------------------------------------------------------------------------
  // NIGHT RAID
  // -------------------------------------------------------------------------
  skipToNight() { this.run.phase = 'dusk'; this.save(); this.startRaid(); },
  startRaid() {
    if (this.mode !== 'base') return;
    const day = this.run.day;
    this.mode = 'raid'; this.run.phase = 'dusk';
    const waves = []; const nW = Math.min(4, 1 + Math.floor((day + 1) / 3));
    let budget = day === 1 ? 3 : 3 + day * 2.4;
    const pool = [['thug', 1, 1], ['gunner', 1.5, 1], ['breacher', 2.5, 2], ['brute', 4, 4], ['rocketeer', 5, 6]];
    const avail = pool.filter(p => day >= p[2]);
    const dirs = shuffle([0, 1, 2, 3]);
    for (let w = 0; w < nW; w++) {
      let b = budget / nW; const list = [];
      while (b > 0.9) { const [t, c] = weighted(avail.map(a => [a, a[0] === 'thug' ? 4 : a[0] === 'gunner' ? 3 : 1.6]))[0]; if (c > b + 0.5 && list.length) break; list.push(t); b -= c; }
      if (!list.length) list.push('thug');
      waves.push({ t: w * 28, dir: dirs[w % 4], list });
    }
    if (day % 7 === 0) waves[waves.length - 1].list.push('ironjack');
    this.rs = { waves, idx: 0, t: -20, total: waves.reduce((a, w) => a + w.list.length, 0), killed: 0, lost: [], stolen: {}, startKills: this.stats.kills, coreHitT: 0, endT: 0, maxT: 150 + nW * 30 };
    Sfx.horn(); Sfx.startAmbient('night');
    UI.setMode('raid');
    UI.toastBig('NIGHT ' + day, 'Raiders approach from ' + waves.map(w => ['the north', 'the east', 'the south', 'the west'][w.dir]).filter((v, i, a) => a.indexOf(v) === i).join(', '));
    this.save();
  },
  updateRaid(dt) {
    const rs = this.rs; rs.t += dt; rs.coreHitT -= dt;
    while (rs.idx < rs.waves.length && rs.t >= rs.waves[rs.idx].t) { this.spawnWave(rs.waves[rs.idx]); rs.idx++; }
    const alive = this.enemies.filter(e => !e.dead).length;
    if (rs.idx >= rs.waves.length && (alive === 0 || rs.t > rs.maxT)) {
      rs.endT += dt;
      if (rs.endT > 2) { this.enemies = []; this.dawn(); }
    }
  },
  spawnWave(w) {
    const m = this.map, S = m.w;
    const day = this.run.day; const scale = 1 + Math.min(1.2, (day - 1) * 0.06);
    w.list.forEach((type, i) => {
      let tx, ty; const a = randi(10, S - 11);
      for (let k = 0; k < 20; k++) {
        const off = randi(-6, 6);
        if (w.dir === 0) { tx = clamp(a + off, 2, S - 3); ty = 2; } else if (w.dir === 1) { tx = S - 3; ty = clamp(a + off, 2, S - 3); }
        else if (w.dir === 2) { tx = clamp(a + off, 2, S - 3); ty = S - 3; } else { tx = 2; ty = clamp(a + off, 2, S - 3); }
        if (!m.blocked(tx, ty, 'enemy') && !(m.ogrid[m.idx(tx, ty)] || []).some(o => o.solid)) break;
      }
      const e = makeEnemy(type, tx * TILE + 16, ty * TILE + 16, scale); e.state = 'raid';
      this.enemies.push(e);
    });
    Sfx.horn();
    this.toast('Raiders incoming from the ' + ['north', 'east', 'south', 'west'][w.dir] + '!', 'bad');
  },
  dawn() {
    const rs = this.rs; this.rs = null; const run = this.run;
    run.stats.raids++;
    const prod = {};
    for (const s of this.map.struct) {
      if (!s) continue; const d = STRUCTS[s.type];
      if (d.prod) for (const k in d.prod) if (k !== 'heal') { this.stashAdd(k, d.prod[k]); prod[k] = (prod[k] || 0) + d.prod[k]; }
    }
    if (this.hasStruct('water')) this.player.hp = this.player.maxhp; else this.player.hp = Math.min(this.player.maxhp, this.player.hp + 35);
    this.player.bleed = false; this.player.rad = Math.max(0, this.player.rad - 50);
    regrowBase(this.map, false);
    const sum = { day: run.day, kills: this.stats.kills - rs.startKills, lost: rs.lost, stolen: rs.stolen, prod };
    run.day++; run.phase = 'day';
    this.rollTrader();
    this.mode = 'base'; UI.setMode('base'); Sfx.startAmbient('day'); Sfx.win();
    this.meta.best = Math.max(this.meta.best, run.day - 1); Save.writeMeta(this.meta);
    this.save();
    UI.showDawn(sum);
  },
  gameOver() {
    const run = this.run; this.mode = 'over'; Sfx.lose(); Sfx.stopAmbient();
    const pts = Math.max(1, run.day - 1 + Math.floor(this.stats.kills / 25) + run.stats.extracts);
    this.meta.points += pts; this.meta.best = Math.max(this.meta.best, run.day - 1); this.meta.kills += this.stats.kills; Save.writeMeta(this.meta);
    Save.clear();
    UI.showGameOver({ day: run.day, kills: this.stats.kills, extracts: run.stats.extracts, raids: run.stats.raids, pts });
  },

  // -------------------------------------------------------------------------
  // TRADER
  // -------------------------------------------------------------------------
  rollTrader() {
    const d = this.run.day;
    const pool = [
      ['pistol_ammo', 30, 30], ['shell', 12, 30], ['rifle_ammo', 30, 75], ['bandage', 3, 18], ['medkit', 1, 55], ['antirad', 2, 55], ['grenade', 1, 45],
      ['pipe', 1, 24], ['spring', 1, 36], ['gears', 1, 24], ['circuit', 1, 45], ['rope', 1, 16], ['tape', 1, 16], ['hqm', 5, 50], ['key_green', 1, 90],
      ['gunpowder', 50, 60], ['cloth', 50, 30], ['metal', 150, 60],
    ];
    if (d >= 3) pool.push(['revolver', 1, 140], ['vest_sign', 1, 120], ['bag_ruck', 1, 110], ['helm_gas', 1, 100], ['key_blue', 1, 260]);
    if (d >= 6) pool.push(['smg', 1, 320], ['pump', 1, 300], ['vest_plate', 1, 360], ['ap_ammo', 20, 120]);
    const stock = shuffle(pool.slice()).slice(0, 7).map(([id, n, price]) => ({ id, n, price, sold: false }));
    const bps = [...BP_BY_TIER[1], ...(d >= 3 ? BP_BY_TIER[2] : [])].filter(b => !this.run.known.includes(ITEMS[b].teach));
    if (bps.length) { const b = pick(bps); stock.push({ id: b, n: 1, price: Math.round(ITEMS[b].val * 2.2), sold: false }); }
    this.run.trader = stock;
  },

  // -------------------------------------------------------------------------
  // MAIN LOOP
  // -------------------------------------------------------------------------
  frame(t) {
    const dt = Math.min(0.05, (t - this.lastT) / 1000 || 0.016); this.lastT = t;
    if ((this.mode === 'base' || this.mode === 'zone' || this.mode === 'raid') && !this.paused) {
      this.t += dt;
      this.update(dt);
    }
    if (this.map && this.mode !== 'menu') this.render(dt);
    Input.endFrame();
    requestAnimationFrame(t2 => this.frame(t2));
  },
  update(dt) {
    const p = this.player, m = this.map;
    if (Input.pressed.esc) UI.closeAll();
    if (UI.modalOpen && !UI.liveModal) { this.updateCamera(dt); return; }
    this.updatePlayer(dt);
    for (const e of this.enemies) if (!e.dead) updateEnemy(e, dt);
    this.enemies = this.enemies.filter(e => !e.dead);
    updateBullets(dt); updateThrowables(dt);
    if (this.mode === 'raid') { this.updateRaid(dt); this.updateTurrets(dt); }
    if (this.mode === 'zone') this.updateZone(dt);
    // particles
    for (const q of this.particles) { q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; const k = Math.exp(-(q.drag || 0) * dt); q.vx *= k; q.vy *= k; }
    this.particles = this.particles.filter(q => q.life > 0);
    if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500);
    for (const x of this.texts) { x.life -= dt; x.y -= 22 * dt; }
    this.texts = this.texts.filter(x => x.life > 0);
    for (const l of this.lights) l.life -= dt; this.lights = this.lights.filter(l => l.life > 0);
    if (m.decals.length > 160) m.decals.splice(0, m.decals.length - 160);
    for (const s of this.turrets) s.s.hitT -= dt;
    // visibility
    this.visT -= dt;
    if (this.visT <= 0) {
      this.visT = 0.1;
      for (const e of this.enemies) {
        const d = dist(e.x, e.y, p.x, p.y);
        let vis = d < 760 && m.los(p.x, p.y, e.x, e.y);
        if (vis && e.def.stealth && d > 110 && e.hurtT <= 0 && e.state !== 'combat') vis = false;
        e.visible = vis; if (vis) e.seenT = 0.6;
      }
    }
    for (const e of this.enemies) e.seenT = (e.seenT || 0) - dt;
    this.seenT -= dt;
    if (this.seenT <= 0 && m.kind === 'zone') {
      this.seenT = 0.3; const R = 9, ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE);
      for (let y = pty - R; y <= pty + R; y++) for (let x = ptx - R; x <= ptx + R; x++) if (m.inb(x, y) && (x - ptx) ** 2 + (y - pty) ** 2 <= R * R) m.seen[m.idx(x, y)] = 1;
    }
    this.updateCamera(dt);
    this.uiT -= dt; if (this.uiT <= 0) { this.uiT = 0.1; UI.updateHUD(); }
  },

  // -------------------------------------------------------------------------
  // PLAYER UPDATE
  // -------------------------------------------------------------------------
  updatePlayer(dt) {
    const p = this.player, m = this.map;
    if (p.dead) {
      p.respawnT -= dt;
      if (p.respawnT <= 0 && this.mode === 'raid') this.respawnAtBase();
      return;
    }
    p.fireCd -= dt; p.swingT -= dt; p.hurtT -= dt; p.invuln -= dt; p.stimT -= dt; p.recoil = Math.max(0, p.recoil - dt * 3);
    // ---- statuses
    if (p.bleed) { p.hp -= 1.4 * dt; if (chance(dt * 3)) this.spawnBlood(p.x, p.y, 1); }
    if (p.regenT > 0) { p.regenT -= dt; p.hp = Math.min(p.maxhp, p.hp + 1.2 * dt); }
    if (p.artRegen) p.hp = Math.min(p.maxhp, p.hp + p.artRegen * dt);
    if (m.kind === 'base' && this.mode === 'base' && !p.bleed) p.hp = Math.min(p.maxhp, p.hp + (this.hasStruct('water') ? 1.2 : 0.6) * dt);
    // radiation intake
    let radIn = p.artRad || 0;
    for (const z of m.radZones) { const d = dist(p.x, p.y, z.x, z.y); if (d < z.r) radIn += z.pow * (1 - d / z.r * 0.7); }
    radIn *= (1 - p.radProt);
    p.rad = clamp(p.rad + radIn * dt - (radIn <= 0 ? 0.4 * dt : 0), 0, 200);
    if (radIn > 0.5) { this.geigerT -= dt * (1 + radIn); if (this.geigerT <= 0) { this.geigerT = rand(0.05, 0.5); Sfx.geiger(); } }
    if (p.rad > 50) p.hp -= (p.rad - 50) / 50 * 1.5 * dt;
    // anomalies
    for (const a of m.anoms) {
      const d = dist(p.x, p.y, a.x, a.y); a.cd -= dt;
      if (d < a.r) {
        if (a.kind === 'gravity') { const k = (1 - d / a.r) * 90 * dt; moveEntity(p, (a.x - p.x) / (d || 1) * k, (a.y - p.y) / (d || 1) * k, 'player'); }
        if (d < a.r * 0.55 && a.cd <= 0) {
          a.cd = 1.1; a.flash = 0.3; damagePlayer(a.kind === 'electro' ? 16 : 12, 0, { explosive: true, by: 'an anomaly' });
          if (a.kind === 'electro') { Sfx.noise(0.2, 6000, 2, 0.4, 'highpass'); this.addLight(a.x, a.y, 200, 0.2, '#9ad8ff'); } else if (a.kind === 'burner') { Sfx.noise(0.4, 600, 1, 0.5); this.addLight(a.x, a.y, 200, 0.3, '#ff8a3a'); } else Sfx.thud(a.x, a.y);
        }
      }
    }
    // emission
    if (this.zs && this.zs.emission && !m.isIndoor(p.x, p.y)) { p.hp -= (3 + this.zs.emT / 15) * dt; p.rad = Math.min(200, p.rad + 3 * dt); }
    if (p.hp <= 0) { this.playerDied(p.bleed ? 'blood loss' : p.rad > 50 ? 'radiation' : this.zs && this.zs.emission ? 'the Emission' : 'the Zone'); return; }

    // ---- using item
    if (p.useT > 0) {
      p.useT -= dt;
      if (p.useT <= 0) this.finishUse();
    }
    // ---- reload
    const it = this.activeItem(); const w = it && WEAPONS[it.id];
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0 && w) { const need = w.mag - (it.m || 0); const ammoId = this.ammoFor(it); const got = this.takeItem(ammoId, need); it.m = (it.m || 0) + got; it.ammo = ammoId; Sfx.click(); }
    }
    // ---- movement
    if (this.buildMode) { p.moving = false; return; }
    const mv = Input.moveVec();
    let spd = 118 * p.speedMul * (p.stimT > 0 ? 1.25 : 1);
    if (p.useT > 0) spd *= 0.45; if (p.reloadT > 0) spd *= 0.85;
    const firing = this.aimInput().fire;
    if (mv.mag > 0.92 && !firing && p.stamina > 5 && p.useT <= 0) { spd *= 1.45; p.stamina -= 16 * dt; p.sprint = true; } else { p.stamina = Math.min(100, p.stamina + 12 * dt); p.sprint = false; }
    if (p.rad > 100) spd *= 0.85;
    if (mv.mag > 0.1) {
      moveEntity(p, mv.x * spd * dt, mv.y * spd * dt, 'player'); p.moving = true; p.step += dt * spd / 20;
      if (Math.floor(p.step) % 2 === 0 && p.step % 1 < dt * spd / 20) this.makeNoise(p.x, p.y, p.sprint ? 220 : 90);
    } else p.moving = false;
    // ---- aim / fire
    const aim = this.aimInput();
    if (aim.active) p.ang = aim.ang; else if (mv.mag > 0.2) p.ang = Math.atan2(mv.y, mv.x);
    if (aim.fire && p.useT <= 0) this.playerAttack();
    // ---- buttons
    if (Input.pressed.reload) this.startReload();
    if (Input.pressed.swap) this.swapWeapon();
    if (Input.pressed.heal) this.quickHeal();
    if (Input.pressed.grenade) this.throwGrenade();
    if (Input.pressed.bag) UI.openInventory();
    if (Input.pressed.map && this.mode === 'zone') UI.toggleMap();
    if (Input.pressed.build && m.kind === 'base') UI.toggleBuild();
    // ---- interaction
    this.updateInteract(dt);
  },
  aimInput() {
    const p = this.player; const a = Input.aim;
    if (a.id !== null && a.mag > 0.25) {
      let ang = Math.atan2(a.y, a.x);
      // aim assist toward visible enemies close to the aim line
      let best = null, bd = 0.38;
      for (const e of this.enemies) {
        if (e.dead || !e.visible) continue; const d = dist(p.x, p.y, e.x, e.y); if (d > 560) continue;
        const da = Math.abs(angDiff(ang, Math.atan2(e.y - p.y, e.x - p.x))); if (da < bd) { bd = da; best = e; }
      }
      if (best) ang += angDiff(ang, Math.atan2(best.y - p.y, best.x - p.x)) * 0.7;
      return { active: true, ang, fire: a.mag > 0.55 };
    }
    if (Input.mouse.used && !Input.touchMode) {
      const s = this.worldToScreen(p.x, p.y);
      return { active: true, ang: Math.atan2(Input.mouse.y - s.y, Input.mouse.x - s.x), fire: Input.mouse.down && !UI.modalOpen && !this.buildMode };
    }
    return { active: false, fire: false };
  },
  ammoFor(it) {
    const w = WEAPONS[it.id];
    if (w.alt && this.countItem(w.alt) > 0 && (it.ammo === w.alt || this.countItem(w.ammo) === 0)) return w.alt;
    if (this.countItem(w.ammo) > 0) return w.ammo;
    return w.alt && this.countItem(w.alt) > 0 ? w.alt : w.ammo;
  },
  startReload() {
    const p = this.player, it = this.activeItem(); if (!it || !WEAPONS[it.id] || p.reloadT > 0) return;
    const w = WEAPONS[it.id]; if ((it.m || 0) >= w.mag) return;
    const ammo = this.ammoFor(it); if (this.countItem(ammo) <= 0) { this.toast('No ' + ITEMS[w.ammo].name, 'bad'); Sfx.empty(); return; }
    p.reloadT = w.reload; Sfx.reload();
  },
  swapWeapon() {
    const p = this.player; const order = ['primary', 'secondary', 'melee'];
    let i = order.indexOf(p.active);
    for (let k = 1; k <= 3; k++) { const n = order[(i + k) % 3]; if (p.equip[n] || n === 'melee') { p.active = n; break; } }
    p.reloadT = 0; p.fireCd = 0.25; Sfx.click();
  },
  playerAttack() {
    const p = this.player; const it = this.activeItem();
    if (it && WEAPONS[it.id]) {
      const w = WEAPONS[it.id];
      if (p.reloadT > 0 || p.fireCd > 0) return;
      if ((it.m || 0) <= 0) {
        if (this.countItem(this.ammoFor(it)) > 0) this.startReload();
        else { p.fireCd = 0.4; Sfx.empty(); this.toast('Out of ammo — swap weapon (melee)'); }
        return;
      }
      it.m--; p.fireCd = 1 / w.rof;
      const am = AMMO_MOD[it.ammo] || null; const pen = w.pen + (am ? am.pen : 0); const dmg = w.dmg * (am ? am.dmg : 1);
      const n = w.pellets || 1; const spr = w.spread * (p.moving ? 1.35 : 1) + p.recoil * 0.05;
      for (let i = 0; i < n; i++) {
        const a = p.ang + rand(-spr, spr);
        this.bullets.push({ x: p.x + Math.cos(p.ang) * (p.r + w.len), y: p.y + Math.sin(p.ang) * (p.r + w.len), vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, dmg, pen, owner: 'player', life: w.range / w.speed });
      }
      p.recoil = Math.min(1, p.recoil + 0.25);
      Sfx.shot(w.sfx); this.muzzle(p.x, p.y, p.ang, p.r + w.len - 6); this.shake(w.pellets ? 4 : w.dmg > 50 ? 5 : 1.5);
      this.makeNoise(p.x, p.y, w.noise);
      // shell casing
      this.particles.push({ x: p.x, y: p.y, vx: Math.cos(p.ang + 1.6) * 80, vy: Math.sin(p.ang + 1.6) * 80, life: 0.4, max: 0.4, col: '#d8b048', size: 2, drag: 6 });
      if ((it.m || 0) === 0 && this.countItem(this.ammoFor(it)) > 0) setTimeout(() => { if (this.activeItem() === it) this.startReload(); }, 250);
      return;
    }
    // melee
    if (p.swingT > 0) return;
    const md = MELEE[it ? it.id : 'fists'] || MELEE.fists;
    p.swingT = 1 / md.rate; p.swingAnim = 0.18; Sfx.swing();
    for (const e of this.enemies) {
      if (e.dead) continue; const d = dist(p.x, p.y, e.x, e.y);
      if (d < md.reach + e.r + p.r && Math.abs(angDiff(p.ang, Math.atan2(e.y - p.y, e.x - p.x))) < 1.1) { damageEnemy(e, md.dmg, 0.1, p.ang, { melee: true, fromPlayer: true }); Sfx.hit(e.x, e.y); }
    }
    // breaking barrels with melee
    for (const c of this.map.containers) {
      if (c.type === 'barrel' && !c.broken && dist(p.x, p.y, c.x, c.y) < md.reach + 14) this.breakBarrel(c);
    }
    this.makeNoise(p.x, p.y, 120);
  },
  throwGrenade() {
    const p = this.player; if (this.countItem('grenade') <= 0) return this.toast('No grenades');
    this.takeItem('grenade', 1);
    const spd = 330; this.throwables.push({ kind: 'grenade', x: p.x, y: p.y, vx: Math.cos(p.ang) * spd, vy: Math.sin(p.ang) * spd, fuse: 1.7, owner: 'player' });
    Sfx.swing();
  },
  quickHeal() {
    const p = this.player; if (p.useT > 0) return;
    let id = null;
    if (p.bleed && this.countItem('bandage')) id = 'bandage';
    else if (p.rad > 60 && this.countItem('antirad')) id = 'antirad';
    else if (p.maxhp - p.hp > 40 && this.countItem('medkit')) id = 'medkit';
    else if (p.maxhp - p.hp > 20 && this.countItem('stim')) id = 'stim';
    else if (p.maxhp - p.hp > 5) id = ['bandage', 'canned', 'medkit', 'stim'].find(x => this.countItem(x));
    if (!id) return this.toast(p.hp >= p.maxhp ? 'Health is full' : 'No medical items');
    this.useItem(id);
  },
  useItem(id) {
    const p = this.player; const d = ITEMS[id]; if (!d.use || p.useT > 0) return;
    p.useItem = id; p.useT = d.use.time * (this.hasPerk('medic') ? 0.7 : 1); p.useMax = p.useT; Sfx.ui();
  },
  finishUse() {
    const p = this.player, id = p.useItem; p.useItem = null; if (!id) return;
    if (this.takeItem(id, 1) < 1) return;
    const u = ITEMS[id].use; const mult = this.hasPerk('medic') ? 1.2 : 1;
    if (u.heal) p.hp = Math.min(p.maxhp, p.hp + u.heal * mult);
    if (u.bleed) p.bleed = false;
    if (u.rad) p.rad = Math.max(0, p.rad + u.rad);
    if (u.speed) p.stimT = u.speed;
    if (u.regen) p.regenT = u.regen;
    this.floatText(p.x, p.y - 16, '+' + ITEMS[id].name, '#7f7');
    Sfx.pickup();
  },
  playerDied(by) {
    const p = this.player; if (p.dead) return;
    p.dead = true; p.hp = 0; p.killedBy = by; Sfx.lose(); this.shake(10);
    this.spawnBlood(p.x, p.y, 12);
    if (this.mode === 'zone') { setTimeout(() => this.endExpedition(false), 1800); UI.flash('#600'); }
    else {
      p.respawnT = this.hasStruct('bed') ? 3 : 9;
      this.toast('You are down! Respawning in ' + Math.ceil(p.respawnT) + 's', 'bad');
    }
  },
  respawnAtBase() {
    const p = this.player; const m = this.map;
    const bed = m.struct.find(s => s && s.type === 'bed'); const core = m.coreTile;
    p.x = bed ? bed.x : core.tx * TILE + 16; p.y = bed ? bed.y + 2 : (core.ty + 1) * TILE + 16;
    if (m.blocked(Math.floor(p.x / TILE), Math.floor(p.y / TILE), 'player')) { p.y += TILE; }
    p.dead = false; p.hp = p.maxhp * 0.6; p.bleed = false; p.invuln = 2;
  },

  // -------------------------------------------------------------------------
  // INTERACTION
  // -------------------------------------------------------------------------
  findInteract() {
    const p = this.player, m = this.map; let best = null, bd = 1e9;
    const consider = (o, d, label, kind) => { if (d < bd) { bd = d; best = { o, label, kind }; } };
    for (const c of m.containers) {
      if (c.broken) continue; const d = dist(p.x, p.y, c.x, c.y);
      if (d < 40) consider(c, d, c.type === 'barrel' ? 'Smash Barrel' : (c.type === 'corpse' ? 'Loot ' + (c.name || 'Body') : 'Search ' + (c.name || CONTAINERS[c.type].name)), 'container');
    }
    for (const o of m.objsNear(p.x, p.y).concat(m.objsNear(p.x + Math.cos(p.ang) * 24, p.y + Math.sin(p.ang) * 24))) {
      if (!o.res) continue; const d = dist(p.x, p.y, o.x, o.y) - o.r;
      if (d < 26) consider(o, d + 5, o.type === 'tree' ? 'Chop Tree' : 'Mine ' + (o.type === 'rock' ? 'Stone' : o.type === 'ore_metal' ? 'Metal Ore' : 'Sulfur Ore'), 'gather');
    }
    for (const a of m.anoms) if (a.art) { const d = dist(p.x, p.y, a.x, a.y); if (d < 30) consider(a, d, 'Take ' + ITEMS[a.art].name, 'art'); }
    for (const k of m.keydoors) {
      if (k.open) continue; const d = dist(p.x, p.y, k.tx * TILE + 16, k.ty * TILE + 16);
      if (d < 46) consider(k, d, (this.countItem(k.key) ? 'Swipe ' : 'Needs ') + ITEMS[k.key].name, 'keydoor');
    }
    if (m.struct && this.mode === 'base') {
      const ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE);
      for (let y = pty - 1; y <= pty + 1; y++) for (let x = ptx - 1; x <= ptx + 1; x++) {
        const s = m.st(x, y); if (!s) continue; const d = dist(p.x, p.y, s.x, s.y); if (d > 44) continue;
        const lab = { core: 'Base Menu', workbench1: 'Craft', workbench2: 'Craft', workbench3: 'Craft', furnace: 'Smelt', research: 'Research', recycler: 'Recycle', bed: 'Sleep' }[s.type];
        if (lab) consider(s, d + 4, lab, 'struct');
      }
    }
    return best;
  },
  updateInteract(dt) {
    const p = this.player; const it = this.findInteract(); this.interact = it;
    if (!it) { p.gatherT = 0; return; }
    if (it.kind === 'gather') {
      if (Input.held.interact) {
        p.gatherT -= dt;
        if (p.gatherT <= 0) { p.gatherT = 0.55; this.gather(it.o); }
      } else p.gatherT = 0;
      return;
    }
    if (!Input.pressed.interact) return;
    if (it.kind === 'container') { if (it.o.type === 'barrel') this.breakBarrel(it.o); else UI.openLoot(it.o); }
    else if (it.kind === 'art') {
      const left = this.addToBag(makeItem(it.o.art)); if (left) return this.toast('Bag is full', 'bad');
      this.toast('Found ' + ITEMS[it.o.art].name + '!', 'good'); it.o.art = null; Sfx.win();
    } else if (it.kind === 'keydoor') {
      if (!this.countItem(it.o.key)) return this.toast('You need a ' + ITEMS[it.o.key].name, 'bad');
      this.takeItem(it.o.key, 1); it.o.open = true; this.map.set(it.o.tx, it.o.ty, T.FLOOR); this.groundDirty = true;
      Sfx.beep(); Sfx.win(); this.toast('Access granted', 'good'); this.makeNoise(p.x, p.y, 500);
    } else if (it.kind === 'struct') {
      const t = it.o.type;
      if (t === 'core') UI.openBaseMenu('base');
      else if (t.startsWith('workbench')) UI.openBaseMenu('craft');
      else if (t === 'furnace') UI.openBaseMenu('smelt');
      else if (t === 'research') UI.openBaseMenu('research');
      else if (t === 'recycler') UI.openBaseMenu('recycle');
      else if (t === 'bed') { if (this.mode === 'base') UI.openDeploy(); }
    }
  },
  gather(o) {
    const p = this.player; const m = this.map;
    // best tool from equipped melee or anything carried
    let wood = MELEE.fists.wood, ore = MELEE.fists.ore;
    const tools = [p.equip.melee, ...p.bag].filter(x => x && MELEE[x.id]);
    for (const t of tools) { wood = Math.max(wood, MELEE[t.id].wood); ore = Math.max(ore, MELEE[t.id].ore); }
    const mult = o.type === 'tree' ? wood : ore;
    const gains = [];
    if (o.type === 'tree') gains.push(['wood', Math.ceil(10 * mult)]);
    else if (o.type === 'rock') gains.push(['stone', Math.ceil(11 * mult)]);
    else if (o.type === 'ore_metal') { gains.push(['metal_ore', Math.ceil(6 * mult)], ['stone', Math.ceil(3 * mult)]); if (chance(0.12 * mult)) gains.push(['hqm_ore', 1]); }
    else if (o.type === 'ore_sulfur') gains.push(['sulfur_ore', Math.ceil(6 * mult)], ['stone', Math.ceil(2 * mult)]);
    o.amt -= gains[0][1]; o.shake = 0.15;
    if (o.type === 'tree') Sfx.chop(); else Sfx.mine();
    for (let i = 0; i < 3; i++) this.particles.push({ x: o.x + rand(-6, 6), y: o.y + rand(-6, 6), vx: rand(-60, 60), vy: rand(-60, 60), life: 0.35, max: 0.35, col: o.type === 'tree' ? '#8a6a3a' : '#aaa', size: 3, drag: 4 });
    for (const [id, n] of gains) {
      if (m.kind === 'base') this.stashAdd(id, n);
      else { const left = this.addToBag({ id, n }); if (left) { this.toast('Bag is full', 'bad'); break; } }
      this.floatText(o.x, o.y - 20, '+' + n + ' ' + ITEMS[id].name, '#e8d8a8');
    }
    this.makeNoise(p.x, p.y, 200);
    if (o.amt <= 0) { m.removeObj(o); if (o.type === 'tree') Sfx.thud(o.x, o.y); this.groundDirty = true; }
  },
  breakBarrel(c) {
    c.broken = true; Sfx.thud(c.x, c.y); Sfx.hit(c.x, c.y);
    for (let i = 0; i < 8; i++) this.particles.push({ x: c.x, y: c.y, vx: rand(-100, 100), vy: rand(-100, 100), life: 0.5, max: 0.5, col: '#4a5a6a', size: 4, drag: 4 });
    const items = rollLoot('barrel');
    if (items.length) { const d = this.map.addContainer('corpse', c.x, c.y); d.items = items; d.name = 'Barrel Loot'; d.searched = 99; d.dropBag = true; }
    this.makeNoise(c.x, c.y, 220);
  },

  // -------------------------------------------------------------------------
  // ZONE UPDATE
  // -------------------------------------------------------------------------
  updateZone(dt) {
    const z = this.zs, p = this.player;
    if (!z) return;
    z.time -= dt;
    if (z.time <= 0 && !z.emission) { z.emission = true; Sfx.siren(); UI.toastBig('EMISSION', 'Get indoors or extract NOW'); }
    if (z.emission) z.emT += dt;
    if (z.time > 0 && z.time < 60 && !z.warned) { z.warned = true; Sfx.siren(); this.toast('Emission in 60 seconds!', 'bad'); }
    // extraction
    let inEx = null; for (const e of this.map.extracts) if (dist(p.x, p.y, e.x, e.y) < e.r) inEx = e;
    if (inEx && !p.dead) {
      if (z.ex !== inEx) { z.ex = inEx; z.exT = 0; }
      z.exT += dt; if (Math.floor(z.exT * 2) !== Math.floor((z.exT - dt) * 2)) Sfx.beep();
      if (z.exT >= 6) { this.endExpedition(true); return; }
    } else { z.ex = null; z.exT = 0; }
    // roaming scav waves
    this.roamT -= dt;
    if (this.roamT <= 0) {
      this.roamT = rand(55, 85);
      if (this.enemies.length < 28) {
        const types = z.zone.spawns.map(s => s[0]).filter(t => t !== 'warlord');
        const type = pick(types); const m = this.map;
        for (let k = 0; k < 20; k++) {
          const q = freeSpot(m, 0, true); if (!q || dist(q.x, q.y, p.x, p.y) < 650) continue;
          const n = randi(1, 3); for (let i = 0; i < n; i++) { const e = makeEnemy(type, q.x + rand(-20, 20), q.y + rand(-20, 20)); e.state = 'alert'; e.lastSeen = { x: p.x + rand(-200, 200), y: p.y + rand(-200, 200) }; e.alertT = 30; this.enemies.push(e); }
          break;
        }
      }
    }
  },
  makeNoise(x, y, r, src) {
    for (const e of this.enemies) {
      if (e === src || e.dead || e.def.raider) continue;
      if (e.state === 'combat') continue;
      if (dist2(x, y, e.x, e.y) < r * r) { e.state = 'alert'; e.lastSeen = { x: x + rand(-40, 40), y: y + rand(-40, 40) }; e.alertT = 12; }
    }
  },
  visionMul() {
    if (this.mode === 'raid') return 0.75;
    if (this.zs && this.zs.time < 90) return 0.85;
    return 1;
  },

  // -------------------------------------------------------------------------
  // TURRETS
  // -------------------------------------------------------------------------
  updateTurrets(dt) {
    const m = this.map;
    for (const T_ of this.turrets) {
      const s = T_.s; if (s.dead) continue; const d = STRUCTS[s.type].turret;
      s.cd -= dt;
      let best = null, bd = d.range;
      for (const e of this.enemies) { if (e.dead) continue; const dd = dist(s.x, s.y, e.x, e.y); if (dd < bd && m.los(s.x, s.y, e.x, e.y)) { bd = dd; best = e; } }
      if (!best) continue;
      const a = Math.atan2(best.y - s.y, best.x - s.x); s.ang += clamp(angDiff(s.ang, a), -7 * dt, 7 * dt);
      if (s.cd > 0 || Math.abs(angDiff(s.ang, a)) > 0.2) continue;
      if (this.stashCount(d.ammo) < d.use) { s.noAmmo = true; continue; }
      s.noAmmo = false; this.stashTake(d.ammo, d.use); s.cd = 1 / d.rof;
      for (let i = 0; i < d.pellets; i++) {
        const aa = s.ang + rand(-d.spread, d.spread);
        this.bullets.push({ x: s.x + Math.cos(s.ang) * 18, y: s.y + Math.sin(s.ang) * 18, vx: Math.cos(aa) * 1000, vy: Math.sin(aa) * 1000, dmg: d.dmg, pen: 0.2, owner: 'turret', life: d.range / 1000 + 0.05 });
      }
      Sfx.shot(d.pellets > 1 ? 'shotgun' : 'turret', s.x, s.y); this.muzzle(s.x, s.y, s.ang, 16);
    }
  },

  // -------------------------------------------------------------------------
  // EFFECTS
  // -------------------------------------------------------------------------
  toast(msg, cls) { UI.toast(msg, cls); },
  shake(n) { this.shakeA = Math.max(this.shakeA, n); },
  spawnBlood(x, y, n, col = '#8a1a1a') {
    for (let i = 0; i < n; i++) this.particles.push({ x, y, vx: rand(-90, 90), vy: rand(-90, 90), life: rand(0.2, 0.5), max: 0.5, col, size: rand(2, 4), drag: 5 });
    if (chance(0.5)) this.map.decals.push({ type: 'blood', x: x + rand(-8, 8), y: y + rand(-8, 8), r: rand(3, 8), col: col === '#8a1a1a' ? '#5a1010' : col });
  },
  spark(x, y, col = '#ffe0a0') { for (let i = 0; i < 4; i++) this.particles.push({ x, y, vx: rand(-120, 120), vy: rand(-120, 120), life: 0.18, max: 0.18, col, size: 2, drag: 4 }); },
  muzzle(x, y, ang, r) {
    const mx = x + Math.cos(ang) * (r + 6), my = y + Math.sin(ang) * (r + 6);
    this.particles.push({ x: mx, y: my, vx: 0, vy: 0, life: 0.05, max: 0.05, col: '#fff2a0', size: 9, flash: true });
    this.addLight(mx, my, 150, 0.06, '#ffd080');
  },
  addLight(x, y, r, life, col) { this.lights.push({ x, y, r, life, max: life, col }); },
  floatText(x, y, txt, col = '#fff') { if (this.texts.length < 40) this.texts.push({ x, y, txt, col, life: 0.9 }); },
  panCamera(dx, dy) { this.cam.x += dx / this.cam.zoom; this.cam.y += dy / this.cam.zoom; this.cam.free = true; },
  worldToScreen(x, y) { return { x: (x - this.cam.x) * this.cam.zoom + this.W / 2, y: (y - this.cam.y) * this.cam.zoom + this.H / 2 }; },
  screenToWorld(x, y) { return { x: (x - this.W / 2) / this.cam.zoom + this.cam.x, y: (y - this.H / 2) / this.cam.zoom + this.cam.y }; },
  updateCamera(dt) {
    const p = this.player; if (!p) return;
    if (this.buildMode) {
      for (const t of Input.taps) { const w = this.screenToWorld(t.x, t.y); this.tryBuildAt(Math.floor(w.x / TILE), Math.floor(w.y / TILE)); }
      if (!this.cam.free) { this.cam.x = lerp(this.cam.x, p.x, 1 - Math.exp(-6 * dt)); this.cam.y = lerp(this.cam.y, p.y, 1 - Math.exp(-6 * dt)); }
      // keyboard pan
      const mv = Input.moveVec(); if (mv.mag) { this.cam.x += mv.x * 400 * dt; this.cam.y += mv.y * 400 * dt; this.cam.free = true; }
    } else {
      this.cam.free = false;
      const look = this.aimInput().active ? 70 : 0;
      const tx = p.x + Math.cos(p.ang) * look, ty = p.y + Math.sin(p.ang) * look;
      const k = 1 - Math.exp(-7 * dt); this.cam.x = lerp(this.cam.x, tx, k); this.cam.y = lerp(this.cam.y, ty, k);
    }
    // keep the camera inside the map
    const m = this.map, hw = this.W / 2 / this.cam.zoom, hh = this.H / 2 / this.cam.zoom, MW = m.w * TILE, MH = m.h * TILE;
    this.cam.x = MW > hw * 2 ? clamp(this.cam.x, hw, MW - hw) : MW / 2; this.cam.y = MH > hh * 2 ? clamp(this.cam.y, hh, MH - hh) : MH / 2;
    this.shakeA = Math.max(0, this.shakeA - dt * 30);
  },

  // -------------------------------------------------------------------------
  // RENDERING
  // -------------------------------------------------------------------------
  prerender() {
    const m = this.map; const c = document.createElement('canvas'); c.width = m.w * TILE; c.height = m.h * TILE;
    const g = c.getContext('2d'); m.ground = c; m.groundG = g;
    this.drawGround(); this.groundDirty = false;
  },
  drawGround() {
    const m = this.map, g = m.groundG; const pal = m.zone ? m.zone.ground : ['#3c4c30', '#384a2d', '#40512f'];
    const rnd = mulberry(m.w * 7 + (m.zone ? m.zone.tier : 0));
    for (let ty = 0; ty < m.h; ty++) for (let tx = 0; tx < m.w; tx++) {
      const t = m.tiles[m.idx(tx, ty)], x = tx * TILE, y = ty * TILE;
      if (t === T.GROUND) {
        g.fillStyle = pal[0]; g.fillRect(x, y, TILE, TILE);
        g.globalAlpha = 0.35 + 0.2 * Math.sin(tx * 0.31 + ty * 0.17); g.fillStyle = pal[1 + ((Math.sin(tx * 0.5) + Math.cos(ty * 0.43) > 0) ? 1 : 0)]; g.fillRect(x, y, TILE, TILE); g.globalAlpha = 1;
        if (rnd() < 0.12) { g.fillStyle = 'rgba(90,110,60,.25)'; for (let k = 0; k < 5; k++) g.fillRect(x + rnd() * 30, y + rnd() * 26, 1, 4 + rnd() * 4); }
        for (let k = 0; k < 4; k++) { g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,.08)' : 'rgba(255,255,220,.05)'; g.fillRect(x + rnd() * 30, y + rnd() * 30, 2 + rnd() * 3, 2 + rnd() * 3); }
      } else if (t === T.ROAD) {
        g.fillStyle = rnd() < 0.5 ? '#4a4a48' : '#474745'; g.fillRect(x, y, TILE, TILE);
        if (rnd() < 0.2) { g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.arc(x + rnd() * 32, y + rnd() * 32, 2 + rnd() * 5, 0, 7); g.fill(); }
      } else if (t === T.WATER) {
        g.fillStyle = '#1e3a44'; g.fillRect(x, y, TILE, TILE);
        g.fillStyle = 'rgba(120,180,200,.12)'; g.fillRect(x + rnd() * 20, y + rnd() * 28, 10, 2);
      } else if (t === T.FLOOR) {
        g.fillStyle = (tx + ty) % 2 ? '#5a4a38' : '#564634'; g.fillRect(x, y, TILE, TILE);
        g.fillStyle = 'rgba(0,0,0,.2)'; for (let k = 0; k < 4; k++) g.fillRect(x, y + k * 8, TILE, 1);
      } else if (t === T.CONCRETE) {
        g.fillStyle = (tx + ty) % 2 ? '#5c5c58' : '#585854'; g.fillRect(x, y, TILE, TILE);
        g.strokeStyle = 'rgba(0,0,0,.18)'; g.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        if (rnd() < 0.15) { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x + rnd() * 20, y + rnd() * 20, 8, 3); }
      } else if (t === T.WALL) {
        g.fillStyle = '#2a2826'; g.fillRect(x, y, TILE, TILE);
        g.fillStyle = '#4a4440'; g.fillRect(x + 2, y + 2, TILE - 4, TILE - 8);
        g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(x + 2, y + 2, TILE - 4, 3);
      } else if (t === T.FENCE) {
        g.fillStyle = pal[0]; g.fillRect(x, y, TILE, TILE);
        g.strokeStyle = '#8a8a86'; g.lineWidth = 1;
        for (let k = -32; k < 32; k += 6) { g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + k + 32, y + 32); g.moveTo(x + k + 32, y); g.lineTo(x + k, y + 32); g.stroke(); }
        g.fillStyle = '#5a5a58'; g.fillRect(x + 13, y + 13, 6, 6);
      } else if (t === T.KEYDOOR) {
        g.fillStyle = '#2a2826'; g.fillRect(x, y, TILE, TILE);
      }
      // wall edge shading on ground next to walls
      if (t !== T.WALL && m.t(tx, ty - 1) === T.WALL) { g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x, y, TILE, 6); }
    }
    // claim radius ring on base
    if (m.kind === 'base' && m.coreTile) {
      const r = CORE_LEVELS[this.run.coreLvl].r;
      g.strokeStyle = 'rgba(230,200,120,.18)'; g.setLineDash([8, 8]); g.lineWidth = 2;
      g.beginPath(); g.arc(m.coreTile.tx * TILE + 16, m.coreTile.ty * TILE + 16, (r + 0.5) * TILE, 0, 7); g.stroke(); g.setLineDash([]);
    }
  },
  render(dt) {
    const g = this.ctx, m = this.map, p = this.player, cam = this.cam;
    if (this.groundDirty) { this.drawGround(); this.groundDirty = false; }
    const dpr = this.dpr, z = cam.zoom, S = dpr * z;
    const sx = this.shakeA ? rand(-this.shakeA, this.shakeA) : 0, sy = this.shakeA ? rand(-this.shakeA, this.shakeA) : 0;
    const cx = cam.x + sx / z, cy = cam.y + sy / z;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#0c0d0f'; g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(S, 0, 0, S, this.canvas.width / 2 - cx * S, this.canvas.height / 2 - cy * S);
    const vw = this.W / z, vh = this.H / z; const vx0 = cx - vw / 2 - 40, vy0 = cy - vh / 2 - 40, vx1 = cx + vw / 2 + 40, vy1 = cy + vh / 2 + 40;
    const inView = (x, y, r = 40) => x > vx0 - r && x < vx1 + r && y > vy0 - r && y < vy1 + r;
    // ground (visible sub-rect)
    const gx0 = clamp(Math.floor(vx0), 0, m.w * TILE), gy0 = clamp(Math.floor(vy0), 0, m.h * TILE);
    const gx1 = clamp(Math.ceil(vx1), 0, m.w * TILE), gy1 = clamp(Math.ceil(vy1), 0, m.h * TILE);
    if (gx1 > gx0 && gy1 > gy0) g.drawImage(m.ground, gx0, gy0, gx1 - gx0, gy1 - gy0, gx0, gy0, gx1 - gx0, gy1 - gy0);
    // water shimmer
    // decals
    for (const d of m.decals) {
      if (!inView(d.x, d.y)) continue;
      if (d.type === 'blood') { g.fillStyle = d.col; g.globalAlpha = 0.7; g.beginPath(); g.arc(d.x, d.y, d.r, 0, 7); g.fill(); g.globalAlpha = 1; }
      else { g.fillStyle = 'rgba(10,8,6,.55)'; g.beginPath(); g.arc(d.x, d.y, d.r, 0, 7); g.fill(); }
    }
    // keydoors
    for (const k of m.keydoors) {
      if (k.open) continue; const x = k.tx * TILE, y = k.ty * TILE;
      g.fillStyle = '#3a3a40'; g.fillRect(x, y + 4, TILE, TILE - 8); g.fillStyle = ITEMS[k.key].col; g.fillRect(x + 4, y + 12, TILE - 8, 8);
      g.fillStyle = (this.t * 2 % 1) < 0.5 ? '#ff4040' : '#600'; g.fillRect(x + 24, y + 6, 4, 4);
    }
    // radiation zones (faint)
    for (const r of m.radZones) {
      if (!inView(r.x, r.y, r.r)) continue;
      const gr = g.createRadialGradient(r.x, r.y, 0, r.x, r.y, r.r); gr.addColorStop(0, 'rgba(140,200,40,.16)'); gr.addColorStop(1, 'rgba(140,200,40,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(r.x, r.y, r.r, 0, 7); g.fill();
    }
    // extracts
    for (const e of m.extracts) {
      if (!inView(e.x, e.y, 60)) continue;
      g.strokeStyle = 'rgba(90,230,120,.7)'; g.lineWidth = 3; g.setLineDash([10, 8]); g.lineDashOffset = -this.t * 20;
      g.beginPath(); g.arc(e.x, e.y, e.r, 0, 7); g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(90,230,120,.1)'; g.beginPath(); g.arc(e.x, e.y, e.r, 0, 7); g.fill();
      g.fillStyle = '#9f9'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.fillText('EXFIL: ' + e.name, e.x, e.y - e.r - 6);
    }
    // containers
    for (const c of m.containers) { if (!c.broken && inView(c.x, c.y)) this.drawContainer(g, c); }
    // low objects
    for (const o of m.objs) { if (o.type !== 'tree' && inView(o.x, o.y, o.r + 40)) this.drawObj(g, o, dt); }
    // structures
    if (m.struct) this.drawStructs(g, vx0, vy0, vx1, vy1);
    // anomalies
    for (const a of m.anoms) { if (inView(a.x, a.y, a.r)) this.drawAnom(g, a, dt); }
    // throwables
    for (const t of this.throwables) {
      if (t.kind === 'rocket') { g.fillStyle = '#ccc'; g.beginPath(); g.arc(t.x, t.y, 4, 0, 7); g.fill(); }
      else { g.fillStyle = t.kind === 'satchel' ? '#8a5a2a' : '#4a5a2a'; g.beginPath(); g.arc(t.x, t.y, 5, 0, 7); g.fill(); if (t.kind === 'satchel' && t.blink < 0.1) { g.fillStyle = '#f33'; g.beginPath(); g.arc(t.x, t.y, 3, 0, 7); g.fill(); } }
    }
    // enemies
    for (const e of this.enemies) { if (!e.dead && (e.visible || e.seenT > 0) && inView(e.x, e.y)) this.drawActor(g, e, false); }
    // player
    if (p && !p.dead) this.drawActor(g, p, true);
    // bullets (tracers)
    g.lineCap = 'round';
    for (const b of this.bullets) {
      g.strokeStyle = b.owner === 'enemy' ? 'rgba(255,140,90,.9)' : 'rgba(255,240,170,.9)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(b.px ?? b.x, b.py ?? b.y); g.lineTo(b.x, b.y); g.stroke();
    }
    // tree canopies over actors
    for (const o of m.objs) { if (o.type === 'tree' && inView(o.x, o.y, 50)) this.drawTree(g, o, dt); }
    // roofs: hide house interiors unless the player is inside
    // particles
    for (const q of this.particles) {
      if (!inView(q.x, q.y)) continue; const a = clamp(q.life / q.max, 0, 1);
      if (q.smoke) { g.globalAlpha = a * 0.45; g.fillStyle = q.col; g.beginPath(); g.arc(q.x, q.y, q.size * (1.6 - a), 0, 7); g.fill(); }
      else if (q.flash) { g.globalAlpha = 1; g.fillStyle = q.col; g.beginPath(); g.arc(q.x, q.y, q.size, 0, 7); g.fill(); }
      else { g.globalAlpha = a; g.fillStyle = q.col; g.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size); }
    }
    g.globalAlpha = 1;
    // build-mode overlay
    if (this.buildMode) this.drawBuildOverlay(g, vx0, vy0, vx1, vy1);
    // floating texts
    g.textAlign = 'center'; g.font = 'bold 12px sans-serif';
    for (const x of this.texts) { g.globalAlpha = clamp(x.life * 1.5, 0, 1); g.fillStyle = '#000'; g.fillText(x.txt, x.x + 1, x.y + 1); g.fillStyle = x.col; g.fillText(x.txt, x.x, x.y); }
    g.globalAlpha = 1;
    // ---- lighting / darkness (screen space)
    g.setTransform(1, 0, 0, 1, 0, 0);
    const dark = this.darkness();
    if (dark > 0.02) this.drawDarkness(g, dark, cx, cy);
    if (this.zs && this.zs.emission) { g.fillStyle = `rgba(180,20,20,${0.16 + Math.sin(this.t * 3) * 0.08})`; g.fillRect(0, 0, this.canvas.width, this.canvas.height); }
    if (p && p.hurtT > 0) { g.fillStyle = `rgba(160,0,0,${p.hurtT * 0.6})`; g.fillRect(0, 0, this.canvas.width, this.canvas.height); }
    // vignette
    if (!this.vign || this.vign.w !== this.canvas.width) {
      const v = document.createElement('canvas'); v.width = this.canvas.width; v.height = this.canvas.height; const vg = v.getContext('2d');
      const gr = vg.createRadialGradient(v.width / 2, v.height / 2, Math.min(v.width, v.height) * 0.35, v.width / 2, v.height / 2, Math.max(v.width, v.height) * 0.7);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.55)'); vg.fillStyle = gr; vg.fillRect(0, 0, v.width, v.height);
      this.vign = { c: v, w: v.width };
    }
    g.drawImage(this.vign.c, 0, 0);
    // screen-space UI on canvas: sticks, off-screen markers
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawScreenUI(g);
  },
  darkness() {
    if (this.mode === 'raid') return 0.86;
    if (this.mode === 'base') return 0.0;
    if (this.zs) { const t = this.zs.time; if (t < 100) return clamp((100 - t) / 100 * 0.55, 0, 0.55) + (this.zs.emission ? 0.1 : 0); }
    return 0;
  },
  drawDarkness(g, dark, cx, cy) {
    const L = this.lctx, w = this.lightC.width, h = this.lightC.height, z = this.cam.zoom / 2;
    const toS = (x, y) => [(x - cx) * z + w / 2, (y - cy) * z + h / 2];
    L.globalCompositeOperation = 'source-over'; L.fillStyle = `rgba(6,8,16,${dark})`; L.fillRect(0, 0, w, h);
    L.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, a = 1) => {
      const [sx, sy] = toS(x, y); const rr = r * z; if (sx < -rr || sy < -rr || sx > w + rr || sy > h + rr) return;
      const gr = L.createRadialGradient(sx, sy, 0, sx, sy, rr); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      L.fillStyle = gr; L.beginPath(); L.arc(sx, sy, rr, 0, 7); L.fill();
    };
    const p = this.player;
    if (p && !p.dead) {
      hole(p.x, p.y, 120, 0.9);
      // flashlight cone
      const [sx, sy] = toS(p.x, p.y); const R = 340 * z;
      const gr = L.createRadialGradient(sx, sy, 0, sx, sy, R); gr.addColorStop(0, 'rgba(0,0,0,.95)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      L.fillStyle = gr; L.beginPath(); L.moveTo(sx, sy); L.arc(sx, sy, R, p.ang - 0.42, p.ang + 0.42); L.closePath(); L.fill();
    }
    if (this.map.struct) for (const s of this.map.struct) { if (!s) continue; const d = STRUCTS[s.type]; if (d.light) hole(s.x, s.y, d.light * TILE * (0.95 + Math.sin(this.t * 9 + s.tx) * 0.04)); }
    for (const l of this.lights) hole(l.x, l.y, l.r, clamp(l.life / l.max, 0, 1));
    for (const a of this.map.anoms) hole(a.x, a.y, 60, 0.4);
    // raiders carry torches (faint)
    if (this.mode === 'raid') for (const e of this.enemies) if (!e.dead) hole(e.x, e.y, 55, 0.5);
    L.globalCompositeOperation = 'source-over';
    g.drawImage(this.lightC, 0, 0, this.canvas.width, this.canvas.height);
    // warm glow additive for lights
    g.globalCompositeOperation = 'lighter';
    const S = this.dpr * this.cam.zoom;
    if (this.map.struct) for (const s of this.map.struct) {
      if (!s) continue; const d = STRUCTS[s.type]; if (!d.light) continue;
      const x = (s.x - cx) * S + this.canvas.width / 2, y = (s.y - cy) * S + this.canvas.height / 2, r = d.light * TILE * S * 0.7;
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, s.type === 'floodlight' ? 'rgba(120,130,150,.18)' : 'rgba(255,140,50,.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = 'source-over';
  },
  drawContainer(g, c) {
    const d = CONTAINERS[c.type]; const x = c.x, y = c.y;
    g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x - 10, y - 6, 22, 16);
    if (c.type === 'corpse') {
      if (c.corpse) { g.save(); g.translate(x, y); g.rotate(c.corpse.ang + 1.57); g.fillStyle = c.corpse.col; g.globalAlpha = 0.85; g.beginPath(); g.ellipse(0, 0, c.corpse.r, c.corpse.r * 1.4, 0, 0, 7); g.fill(); g.restore(); g.globalAlpha = 1; }
      else { g.fillStyle = '#5a4a32'; g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill(); g.strokeStyle = '#3a2a1a'; g.lineWidth = 2; g.stroke(); }
      if (c.items && c.items.length && (!c.searched || c.searched < 99 || c.dropBag)) { g.fillStyle = 'rgba(255,220,120,.85)'; g.beginPath(); g.arc(x, y - 14, 2.5 + Math.sin(this.t * 4) * 0.6, 0, 7); g.fill(); }
      return;
    }
    if (c.type === 'barrel') {
      g.fillStyle = d.col; g.beginPath(); g.arc(x, y, 10, 0, 7); g.fill(); g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 6, 0, 7); g.stroke();
      return;
    }
    const w = c.type === 'military' || c.type === 'elite' ? 24 : c.type === 'cache' ? 14 : 20, h = c.type === 'cache' ? 12 : 16;
    g.fillStyle = d.col; g.fillRect(x - w / 2, y - h / 2, w, h);
    g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x - w / 2, y - h / 2, w, 3);
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1.5; g.strokeRect(x - w / 2, y - h / 2, w, h);
    if (c.type === 'medbox') { g.fillStyle = '#d33'; g.fillRect(x - 2, y - 6, 4, 12); g.fillRect(x - 6, y - 2, 12, 4); }
    if (c.type === 'elite') { g.fillStyle = '#4af'; g.fillRect(x - 3, y - 2, 6, 4); }
    if (c.type === 'military') { g.fillStyle = '#8a9a5a'; g.fillRect(x - 9, y - 1, 18, 2); }
    if (c.searched >= (c.items ? c.items.length : 1) && c.items && !c.items.length) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x - w / 2, y - h / 2, w, h); }
  },
  drawObj(g, o, dt) {
    const x = o.x + (o.shake > 0 ? rand(-1.5, 1.5) : 0), y = o.y; if (o.shake > 0) o.shake -= dt;
    if (o.type === 'rock' || o.type.startsWith('ore')) {
      g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(x + 3, y + 5, o.r + 2, o.r * 0.8, 0, 0, 7); g.fill();
      g.fillStyle = '#7d8086'; g.beginPath();
      for (let i = 0; i < 7; i++) { const a = i / 7 * 6.283, r = o.r * (0.8 + ((Math.sin(o.seed + i * 2.3) + 1) / 2) * 0.35); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
      g.closePath(); g.fill(); g.fillStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.arc(x - 4, y - 4, o.r * 0.45, 0, 7); g.fill();
      if (o.type !== 'rock') { g.fillStyle = o.type === 'ore_metal' ? '#c08a6a' : '#e6d040'; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(x + Math.cos(o.seed + i * 1.9) * o.r * 0.55, y + Math.sin(o.seed + i * 1.9) * o.r * 0.55, 2.6, 0, 7); g.fill(); } }
    } else if (o.type === 'bush') {
      g.fillStyle = o.shade > 0.5 ? '#2e4424' : '#34482a'; g.beginPath(); g.arc(x, y, o.r, 0, 7); g.arc(x + 6, y - 3, o.r * 0.7, 0, 7); g.fill();
    } else if (o.type === 'car') {
      g.save(); g.translate(x, y); g.rotate(o.rot); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(-26, -12, 54, 28);
      g.fillStyle = o.col; g.fillRect(-28, -14, 56, 28); g.fillStyle = 'rgba(20,30,40,.8)'; g.fillRect(-6, -12, 16, 24); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(-28, -14, 56, 4); g.restore();
    } else if (o.type === 'sandbag') {
      g.fillStyle = '#8a7a58'; g.beginPath(); g.ellipse(x, y, 16, 9, 0, 0, 7); g.fill(); g.strokeStyle = 'rgba(0,0,0,.3)'; g.stroke();
    } else if (o.type === 'dish') {
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(x + 6, y + 8, o.r, 0, 7); g.fill();
      g.fillStyle = '#c8c8c0'; g.beginPath(); g.arc(x, y, o.r, 0, 7); g.fill(); g.fillStyle = '#a8a8a0'; g.beginPath(); g.arc(x, y, o.r * 0.6, 0, 7); g.fill(); g.fillStyle = '#555'; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill();
    } else if (o.type === 'tower') {
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(x + 10, y + 12, o.r, 0, 7); g.fill();
      g.fillStyle = '#6a6862'; g.beginPath(); g.arc(x, y, o.r, 0, 7); g.fill(); g.fillStyle = '#2a2826'; g.beginPath(); g.arc(x, y, o.r * 0.75, 0, 7); g.fill();
      g.fillStyle = 'rgba(200,220,180,.08)'; g.beginPath(); g.arc(x, y, o.r * 0.7 + Math.sin(this.t) * 3, 0, 7); g.fill();
    }
  },
  drawTree(g, o, dt) {
    const p = this.player; const near = p && dist2(p.x, p.y, o.x, o.y) < (o.canopy + 4) ** 2;
    const sh = o.shake > 0 ? rand(-2, 2) : 0; if (o.shake > 0) o.shake -= dt;
    g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.arc(o.x + 8, o.y + 10, o.canopy, 0, 7); g.fill();
    g.fillStyle = '#4a3420'; g.beginPath(); g.arc(o.x, o.y, 6, 0, 7); g.fill();
    g.globalAlpha = near ? 0.4 : 0.95;
    const c1 = o.shade > 0.5 ? '#24391e' : '#2a4022', c2 = o.shade > 0.5 ? '#30492a' : '#38522c';
    g.fillStyle = c1; g.beginPath(); g.arc(o.x + sh, o.y, o.canopy, 0, 7); g.fill();
    g.fillStyle = c2; g.beginPath(); g.arc(o.x - o.canopy * 0.25 + sh, o.y - o.canopy * 0.25, o.canopy * 0.62, 0, 7); g.fill();
    g.globalAlpha = 1;
  },
  drawAnom(g, a, dt) {
    a.ph += dt; if (a.flash > 0) a.flash -= dt;
    const col = a.kind === 'burner' ? '255,120,40' : a.kind === 'electro' ? '120,200,255' : '200,180,255';
    for (let i = 0; i < 3; i++) {
      const r = a.r * (0.3 + ((a.ph * 0.4 + i / 3) % 1) * 0.7);
      g.strokeStyle = `rgba(${col},${0.35 * (1 - r / a.r) + (a.flash > 0 ? 0.4 : 0)})`; g.lineWidth = 2; g.beginPath(); g.arc(a.x, a.y, r, 0, 7); g.stroke();
    }
    const gr = g.createRadialGradient(a.x, a.y, 0, a.x, a.y, a.r * 0.6); gr.addColorStop(0, `rgba(${col},.28)`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.beginPath(); g.arc(a.x, a.y, a.r * 0.6, 0, 7); g.fill();
    if (a.kind === 'electro' && chance(0.08)) { g.strokeStyle = 'rgba(200,240,255,.8)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(a.x, a.y); for (let k = 0; k < 4; k++) g.lineTo(a.x + rand(-a.r, a.r) * 0.5, a.y + rand(-a.r, a.r) * 0.5); g.stroke(); }
    if (a.art) { const c = ITEMS[a.art].col; g.fillStyle = c; g.globalAlpha = 0.6 + Math.sin(a.ph * 4) * 0.3; g.beginPath(); g.arc(a.x, a.y, 5, 0, 7); g.fill(); g.globalAlpha = 1; }
  },
  drawActor(g, e, isPlayer) {
    const def = isPlayer ? null : e.def; const x = e.x, y = e.y, r = e.r;
    let alpha = 1;
    if (def && def.stealth && e.state !== 'combat' && e.hurtT <= 0) alpha = 0.25;
    else if (def && def.stealth) alpha = 0.55 + Math.sin(this.t * 10) * 0.2;
    g.globalAlpha = alpha;
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(x + 3, y + 4, r + 1, r * 0.85, 0, 0, 7); g.fill();
    g.save(); g.translate(x, y); g.rotate(e.ang);
    const hurt = e.hurtT > 0;
    if (def && def.kind === 'beast') {
      g.fillStyle = hurt ? '#fff' : def.col; g.beginPath(); g.ellipse(-2, 0, r * 1.35, r * 0.75, 0, 0, 7); g.fill();
      g.fillStyle = hurt ? '#fff' : shade(def.col, -20); g.beginPath(); g.ellipse(r * 1.1, 0, r * 0.6, r * 0.5, 0, 0, 7); g.fill();
      if (e.type === 'boar') { g.fillStyle = '#e8e0c8'; g.fillRect(r * 1.4, -4, 5, 2); g.fillRect(r * 1.4, 2, 5, 2); }
      g.fillStyle = '#f33'; g.fillRect(r * 1.3, -3, 2, 2); g.fillRect(r * 1.3, 1, 2, 2);
    } else {
      // weapon
      const it = isPlayer ? this.activeItem() : (e.gun ? { id: e.gun } : null);
      const w = it && WEAPONS[it.id];
      if (w) { g.fillStyle = '#1e1e1e'; g.fillRect(r * 0.3, 2, w.len + 6, 4); g.fillStyle = '#3a3a3a'; g.fillRect(r * 0.3, 2, 6, 5); }
      else if (isPlayer || (def && (def.melee || def.breach))) {
        const sw = isPlayer && e.swingAnim > 0 ? (e.swingAnim -= 1 / 60, Math.sin(e.swingAnim * 17) * 0.9) : 0;
        g.save(); g.rotate(sw); g.fillStyle = '#aaa'; g.fillRect(r * 0.4, 4, 14, 3); g.restore();
      }
      if (def && def.rocket) { g.fillStyle = '#3a4a2a'; g.fillRect(-4, -9, 26, 6); }
      // body
      const bodyCol = isPlayer ? (e.equip.armor ? ITEMS[e.equip.armor.id].col : '#7a6a48') : def.col;
      g.fillStyle = hurt ? '#fff' : bodyCol; g.beginPath(); g.ellipse(0, 0, r * 0.8, r * 1.05, 0, 0, 7); g.fill();
      // backpack
      if (isPlayer && e.equip.bag) { g.fillStyle = ITEMS[e.equip.bag.id].col; g.fillRect(-r * 0.95, -r * 0.55, r * 0.5, r * 1.1); }
      if (def && def.breach) { g.fillStyle = '#8a5a2a'; g.fillRect(-r * 0.95, -r * 0.5, r * 0.5, r); }
      // head
      const helm = isPlayer ? e.equip.helmet : (def.helm ? { id: def.helm >= 1 ? 'helm_mil' : 'helm_bucket' } : null);
      g.fillStyle = hurt ? '#fff' : (helm ? ITEMS[helm.id].col : (isPlayer ? '#d8b890' : '#c8a080')); g.beginPath(); g.arc(1, 0, r * 0.55, 0, 7); g.fill();
      if (isPlayer) { g.strokeStyle = 'rgba(255,240,200,.65)'; g.lineWidth = 1.5; g.beginPath(); g.arc(0, 0, r + 3, -0.5, 0.5); g.stroke(); }
    }
    g.restore(); g.globalAlpha = 1;
    // health bar
    if (!isPlayer && e.hp < e.maxhp) { g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x - 14, y - r - 10, 28, 4); g.fillStyle = def.boss ? '#e0a030' : '#d44'; g.fillRect(x - 14, y - r - 10, 28 * clamp(e.hp / e.maxhp, 0, 1), 4); }
    if (!isPlayer && def.boss) { g.fillStyle = '#e0a030'; g.font = 'bold 10px sans-serif'; g.textAlign = 'center'; g.fillText(def.name, x, y - r - 14); }
  },
  drawStructs(g, vx0, vy0, vx1, vy1) {
    const m = this.map; const tx0 = Math.max(0, Math.floor(vx0 / TILE)), ty0 = Math.max(0, Math.floor(vy0 / TILE)), tx1 = Math.min(m.w - 1, Math.ceil(vx1 / TILE)), ty1 = Math.min(m.h - 1, Math.ceil(vy1 / TILE));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const s = m.struct[ty * m.w + tx]; if (!s) continue; const x = tx * TILE, y = ty * TILE; const t = s.type;
      const flash = s.hitT > 0;
      if (t.startsWith('wall') || t.startsWith('door') || t === 'embrasure') {
        const col = { wall_wood: '#7a5530', wall_stone: '#7a7a76', wall_metal: '#6a7078', wall_armor: '#3e4650', door_wood: '#8a6038', door_metal: '#5a6068', embrasure: '#6e6e6a' }[t];
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + 3, y + 5, TILE, TILE);
        g.fillStyle = flash ? '#fff' : col; g.fillRect(x, y, TILE, TILE);
        g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x, y, TILE, 4);
        g.fillStyle = 'rgba(0,0,0,.22)';
        if (t === 'wall_wood' || t === 'door_wood') for (let k = 1; k < 4; k++) g.fillRect(x, y + k * 8, TILE, 1.5);
        if (t === 'wall_stone') { g.fillRect(x, y + 15, TILE, 2); g.fillRect(x + 15, y, 2, 15); g.fillRect(x + 7, y + 17, 2, 15); g.fillRect(x + 24, y + 17, 2, 15); }
        if (t === 'wall_metal' || t === 'wall_armor') { g.fillRect(x + 3, y + 3, TILE - 6, TILE - 6); g.fillStyle = 'rgba(255,255,255,.2)'; for (const [a, b] of [[5, 5], [25, 5], [5, 25], [25, 25]]) g.fillRect(x + a, y + b, 2, 2); }
        if (t.startsWith('door')) { g.fillStyle = '#d8c070'; g.fillRect(x + 22, y + 14, 4, 4); g.strokeStyle = 'rgba(0,0,0,.5)'; g.strokeRect(x + 4, y + 2, TILE - 8, TILE - 4); }
        if (t === 'embrasure') { g.fillStyle = '#1a1a1a'; g.fillRect(x + 4, y + 13, TILE - 8, 6); g.fillRect(x + 13, y + 4, 6, TILE - 8); }
      } else if (t === 'core') {
        g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x + 3, y + 5, TILE, TILE);
        g.fillStyle = flash ? '#fff' : '#6a4a2a'; g.fillRect(x + 2, y, TILE - 4, TILE);
        g.fillStyle = '#8a6a3a'; g.fillRect(x + 5, y + 3, TILE - 10, TILE - 6); g.fillStyle = '#e0b040'; g.fillRect(x + 14, y + 12, 4, 6);
        g.strokeStyle = `rgba(230,190,90,${0.4 + Math.sin(this.t * 3) * 0.2})`; g.lineWidth = 2; g.strokeRect(x - 2, y - 2, TILE + 4, TILE + 4);
      } else if (t === 'spikes') {
        g.fillStyle = '#5a4020'; for (let k = 0; k < 9; k++) { const a = x + 4 + (k % 3) * 11, b = y + 4 + Math.floor(k / 3) * 11; g.beginPath(); g.moveTo(a, b + 6); g.lineTo(a + 3, b - 2); g.lineTo(a + 6, b + 6); g.fill(); }
      } else if (t === 'landmine') {
        g.fillStyle = '#3a4030'; g.beginPath(); g.arc(x + 16, y + 16, 7, 0, 7); g.fill(); g.fillStyle = '#c33'; g.beginPath(); g.arc(x + 16, y + 16, 2, 0, 7); g.fill();
      } else if (STRUCTS[t].turret) {
        g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(x + 19, y + 20, 13, 0, 7); g.fill();
        g.fillStyle = flash ? '#fff' : (t === 'auto_turret' ? '#4a5058' : '#6a5030'); g.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
        g.save(); g.translate(x + 16, y + 16); g.rotate(s.ang); g.fillStyle = '#2a2a2e'; g.fillRect(0, -3, t === 'auto_turret' ? 18 : 12, 6); g.fillStyle = '#8a9098'; g.beginPath(); g.arc(0, 0, 7, 0, 7); g.fill(); g.restore();
        if (s.noAmmo && this.mode === 'raid') { g.fillStyle = '#f44'; g.font = 'bold 12px sans-serif'; g.textAlign = 'center'; g.fillText('NO AMMO', x + 16, y - 4); }
      } else {
        const col = { campfire: '#3a2a1a', floodlight: '#5a6068', workbench1: '#7a5a3a', workbench2: '#5a6a7a', workbench3: '#4a3a6a', furnace: '#5a5a56', research: '#3a5a7a', recycler: '#4a6a4a', planter: '#5a4020', water: '#3a5a7a', bed: '#7a3a3a', quarry: '#5a5048' }[t] || '#666';
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + 4, y + 6, TILE - 4, TILE - 4);
        g.fillStyle = flash ? '#fff' : col; g.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
        g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(x + 2, y + 2, TILE - 4, 3);
        if (t === 'campfire') { g.fillStyle = `rgba(255,${120 + Math.random() * 80},30,.9)`; g.beginPath(); g.arc(x + 16, y + 16, 6 + Math.random() * 2, 0, 7); g.fill(); }
        if (t === 'furnace') { g.fillStyle = `rgba(255,${100 + Math.random() * 60},20,.9)`; g.fillRect(x + 10, y + 16, 12, 6); }
        if (t === 'planter') { g.fillStyle = '#4a7a2a'; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(x + 9 + (k % 2) * 14, y + 9 + Math.floor(k / 2) * 14, 5, 0, 7); g.fill(); } }
        if (t === 'bed') { g.fillStyle = '#d8d0c0'; g.fillRect(x + 6, y + 4, 20, 8); }
        if (t === 'floodlight') { g.fillStyle = '#ffe8a0'; g.beginPath(); g.arc(x + 16, y + 16, 6, 0, 7); g.fill(); }
        if (t.startsWith('workbench')) { g.fillStyle = '#ccc'; g.font = 'bold 10px sans-serif'; g.textAlign = 'center'; g.fillText('T' + t.slice(-1), x + 16, y + 20); }
        if (t === 'research') { g.fillStyle = '#9cf'; g.fillRect(x + 8, y + 8, 16, 10); }
        if (t === 'recycler') { g.fillStyle = '#2a2a2a'; g.beginPath(); g.arc(x + 16, y + 16, 8, 0, 7); g.fill(); g.strokeStyle = '#8c8'; g.beginPath(); g.arc(x + 16, y + 16, 5, this.t * 3, this.t * 3 + 4); g.stroke(); }
        if (t === 'water') { g.fillStyle = '#5aa0d0'; g.beginPath(); g.arc(x + 16, y + 16, 9, 0, 7); g.fill(); }
        if (t === 'quarry') { g.save(); g.translate(x + 16, y + 16); g.rotate(this.t * 2); g.fillStyle = '#b8a070'; g.fillRect(-11, -2, 22, 4); g.restore(); }
      }
      if (s.hp < s.maxhp && (this.buildMode || this.mode === 'raid')) {
        g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x + 2, y - 5, TILE - 4, 3);
        g.fillStyle = s.hp / s.maxhp > 0.5 ? '#6c6' : s.hp / s.maxhp > 0.25 ? '#dc4' : '#d44'; g.fillRect(x + 2, y - 5, (TILE - 4) * clamp(s.hp / s.maxhp, 0, 1), 3);
      }
    }
  },
  drawBuildOverlay(g, vx0, vy0, vx1, vy1) {
    const m = this.map, core = m.coreTile; const r = CORE_LEVELS[this.run.coreLvl].r;
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1;
    for (let ty = core.ty - r; ty <= core.ty + r; ty++) for (let tx = core.tx - r; tx <= core.tx + r; tx++) {
      if (Math.hypot(tx - core.tx, ty - core.ty) > r) continue; g.strokeRect(tx * TILE + 0.5, ty * TILE + 0.5, TILE - 1, TILE - 1);
    }
    // ghost under the screen center
    const c = this.screenToWorld(this.W / 2, this.H / 2);
    const tx = Math.floor(c.x / TILE), ty = Math.floor(c.y / TILE);
    g.strokeStyle = 'rgba(255,220,120,.9)'; g.lineWidth = 2; g.strokeRect(tx * TILE + 1, ty * TILE + 1, TILE - 2, TILE - 2);
  },
  drawScreenUI(g) {
    // joysticks
    for (const s of [Input.move, Input.aim]) {
      if (s.id === null) continue;
      g.globalAlpha = 0.35; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(s.ox, s.oy, Input.STICK_R, 0, 7); g.stroke();
      g.globalAlpha = 0.5; g.fillStyle = s === Input.aim ? '#f8c060' : '#fff';
      const kx = s.ox + clamp(s.x, -1, 1) * Input.STICK_R * Math.min(1, 1 / Math.max(1, Math.hypot(s.x, s.y))), ky = s.oy + clamp(s.y, -1, 1) * Input.STICK_R * Math.min(1, 1 / Math.max(1, Math.hypot(s.x, s.y)));
      g.beginPath(); g.arc(kx, ky, Input.STICK_R * 0.42, 0, 7); g.fill(); g.globalAlpha = 1;
    }
    if (!Input.touchMode && !this.buildMode && Input.mouse.used && this.mode !== 'menu') {
      g.strokeStyle = 'rgba(255,230,160,.8)'; g.lineWidth = 1.5; g.beginPath(); g.arc(Input.mouse.x, Input.mouse.y, 8, 0, 7); g.moveTo(Input.mouse.x - 12, Input.mouse.y); g.lineTo(Input.mouse.x - 4, Input.mouse.y); g.moveTo(Input.mouse.x + 4, Input.mouse.y); g.lineTo(Input.mouse.x + 12, Input.mouse.y); g.stroke();
    }
    const p = this.player; if (!p) return;
    // off-screen markers: extracts (zone) and raid directions
    const marker = (wx, wy, col, label) => {
      const s = this.worldToScreen(wx, wy); const m = 30;
      if (s.x > m && s.y > m && s.x < this.W - m && s.y < this.H - m) return;
      const cx = this.W / 2, cy = this.H / 2; const a = Math.atan2(s.y - cy, s.x - cx);
      const k = Math.min((this.W / 2 - m) / Math.abs(Math.cos(a) || 1e-6), (this.H / 2 - m) / Math.abs(Math.sin(a) || 1e-6));
      const x = cx + Math.cos(a) * k, y = cy + Math.sin(a) * k;
      g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = col; g.beginPath(); g.moveTo(12, 0); g.lineTo(-6, -8); g.lineTo(-6, 8); g.fill(); g.restore();
      if (label) { g.fillStyle = col; g.font = 'bold 10px sans-serif'; g.textAlign = 'center'; g.fillText(label, x - Math.cos(a) * 20, y - Math.sin(a) * 20 + 3); }
    };
    if (this.mode === 'zone') for (const e of this.map.extracts) marker(e.x, e.y, 'rgba(110,240,140,.85)', Math.round(dist(p.x, p.y, e.x, e.y) / TILE) + 'm');
    if (this.mode === 'raid') {
      for (const e of this.enemies) if (!e.dead) marker(e.x, e.y, 'rgba(255,80,60,.75)');
      const core = this.map.coreTile; if (this.rs && this.rs.coreHitT > 0) marker(core.tx * TILE + 16, core.ty * TILE + 16, '#fc4', 'CUPBOARD!');
    }
  },
};

function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16); const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

'use strict';
// ============================================================================
// ZONEFALL — game controller: run state, modes (base day / zone expedition /
// night raid), player logic, inventory, base building, rendering.
// ============================================================================

const Game = {
  mode: 'menu', map: null, player: null, enemies: [], bullets: [], throwables: [], particles: [], texts: [], lights: [],
  turrets: [], flow: null, cam: { x: 0, y: 0, kx: 0, ky: 0 }, shakeT: 0, shakeA: 0,
  run: null, meta: null, stats: { kills: 0 }, buildMode: false, buildSel: 'wall_wood', paused: false,
  zs: null, rs: null, t: 0, lastT: 0, visT: 0, seenT: 0, noiseT: 0, uiT: 0, geigerT: 0, roamT: 0,

  // -------------------------------------------------------------------------
  init() {
    this.canvas = $('#view');
    ART.init(); R.init(this.canvas);
    this.meta = Save.loadMeta(); Sfx.enabled = this.meta.sound !== false;
    Input.init(this.canvas);
    addEventListener('resize', () => this.resize()); this.resize();
    UI.init();
    UI.showMenu();
    requestAnimationFrame(t => this.frame(t));
  },
  resize() {
    this.W = innerWidth; this.H = innerHeight;
    R.resize();
    Input.STICK_R = clamp(Math.min(this.W, this.H) * 0.14, 44, 70);
  },
  hasPerk(id) { return this.meta && this.meta.perks.includes(id); },

  // -------------------------------------------------------------------------
  // RUN LIFECYCLE
  // -------------------------------------------------------------------------
  newRun() {
    const stash = { wood: 260, stone: 140, metal: 80, cloth: 40, pipe: 1, scrap: 20 };
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
    this.run = { day: 1, stash, known, structs, coreLvl: 0, gear, hp: null, stats: { kills: 0, raids: 0, exps: 0, extracts: 0, deaths: 0 }, trader: null, tut: this.meta.tutDone ? -1 : 0, gathered: { wood: 0, stone: 0 }, looted: 0, phase: 'day' };
    this.meta.runs++; Save.writeMeta(this.meta);
    this.rollTrader();
    this.enterBase(true);
    UI.toastBig('DAY 1', 'Build defenses before nightfall');
    UI.showGuide();
  },
  menuScene() {
    this.mode = 'menu'; this.zs = null; this.rs = null; this.player = null; this.interact = null; this.tutTarget = null; this.buildMode = false;
    this.enemies = []; this.bullets = []; this.throwables = []; this.particles = []; this.texts = []; this.lights = []; this.turrets = []; this.flow = null;
    this.map = genZone(ZONES[(Math.random() * 2) | 0]); R.buildGround(this.map);
    this.cam.x = 500; this.cam.y = this.map.h * TILE / 2; this.cam.kx = this.cam.ky = 0;
  },
  continueRun() {
    this.run = Save.load(); if (!this.run) return this.newRun();
    this.run.gathered = this.run.gathered || { wood: 0, stone: 0 }; this.run.looted = this.run.looted || 0; if (this.run.tut === undefined) this.run.tut = -1;
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
  playerLook() {
    const e = this.player.equip; const L = Object.assign({}, (ART.LOOKS && ART.LOOKS.player) || {});
    L.vest = e.armor ? e.armor.id : null; L.helmet = e.helmet ? e.helmet.id : null; L.bag = e.bag ? e.bag.id : null;
    return L;
  },
  recalc() {
    const p = this.player, e = p.equip; this.playerArt = null;
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
  // dry-run validation for ghost previews; returns null when placeable
  checkBuild(tx, ty, sel, extra = 1) {
    const m = this.map; const s = m.st(tx, ty); const core = m.coreTile; const r = CORE_LEVELS[this.run.coreLvl].r;
    if (!m.inb(tx, ty)) return 'out';
    if (sel === 'remove') return s && s.type !== 'core' ? null : 'Nothing to remove';
    if (sel === 'repair') return s && s.hp < s.maxhp ? null : 'Nothing to repair';
    if (sel === 'upgrade') { if (!s || !STRUCTS[s.type].upg) return 'Cannot upgrade'; const nd = STRUCTS[STRUCTS[s.type].upg]; if ((nd.wb || 0) > this.wbTier()) return 'Needs Workbench T' + nd.wb; return this.canAffordN(nd.cost, extra) ? null : 'Need ' + UI.costStr(nd.cost); }
    const d = STRUCTS[sel]; if (!d) return 'none';
    if (s) return 'Tile occupied';
    if (Math.hypot(tx - core.tx, ty - core.ty) > r) return 'Outside your claim — upgrade the Cupboard';
    if (m.t(tx, ty) !== T.GROUND) return 'Cannot build there';
    if ((m.ogrid[m.idx(tx, ty)] || []).some(o => o.solid)) return 'Clear the tree/rock first';
    if ((d.wb || 0) > this.wbTier()) return 'Needs Workbench T' + d.wb;
    if (d.unique && this.hasStruct(sel)) return 'Only one ' + d.name + ' allowed';
    if (!this.canAffordN(d.cost, extra)) return 'Need ' + UI.costStr(d.cost);
    return null;
  },
  canAffordN(cost, n) { for (const k in cost) if (this.stashCount(k) < cost[k] * n) return false; return true; },
  buildLine(a, b, sel) {
    const line = ['wall_wood', 'wall_stone', 'wall_metal', 'wall_armor', 'embrasure', 'spikes', 'upgrade', 'repair', 'remove'].includes(sel);
    if (!line) return [b];
    const out = []; const dx = b.tx - a.tx, dy = b.ty - a.ty;
    if (Math.abs(dx) >= Math.abs(dy)) { const st = Math.sign(dx) || 1; for (let x = a.tx; x !== b.tx + st; x += st) out.push({ tx: x, ty: a.ty }); }
    else { const st = Math.sign(dy) || 1; for (let y = a.ty; y !== b.ty + st; y += st) out.push({ tx: a.tx, ty: y }); }
    return out.slice(0, 24);
  },
  updateBuild() {
    const dr = Input.drag; this.buildGhosts = [];
    const tileAt = (x, y) => { const w = this.screenToWorld(x, y); return { tx: Math.floor(w.x / TILE), ty: Math.floor(w.y / TILE) }; };
    if (dr) {
      const a = tileAt(dr.sx, dr.sy), b = tileAt(dr.cx, dr.cy);
      this.buildGhosts = this.buildLine(a, b, this.buildSel).map((t, i) => ({ ...t, ok: !this.checkBuild(t.tx, t.ty, this.buildSel, i + 1) }));
    } else if (!Input.touchMode && Input.mouse.used) {
      const t = tileAt(Input.mouse.x, Input.mouse.y); this.buildGhosts = [{ ...t, ok: !this.checkBuild(t.tx, t.ty, this.buildSel) }];
    }
    for (const e of Input.dragEnds) {
      const tiles = this.buildLine(tileAt(e.sx, e.sy), tileAt(e.cx, e.cy), this.buildSel);
      let placed = 0, err = null;
      for (const t of tiles) { const r = this.checkBuild(t.tx, t.ty, this.buildSel); if (r) { err = err || r; continue; } this.tryBuildAt(t.tx, t.ty, true); placed++; }
      if (!placed && err) this.toast(err, 'bad'); else if (placed > 1) this.toast((this.buildSel === 'remove' ? 'Removed ' : this.buildSel === 'upgrade' ? 'Upgraded ' : this.buildSel === 'repair' ? 'Repaired ' : 'Placed ') + placed);
      UI.renderBuild();
    }
  },
  tryBuildAt(tx, ty, quiet) {
    const m = this.map, sel = this.buildSel; const s = m.st(tx, ty);
    const _toast = this.toast; if (quiet) this.toast = () => { };
    try { return this._tryBuildAt(tx, ty, m, sel, s); } finally { this.toast = _toast; }
  },
  _tryBuildAt(tx, ty, m, sel, s) {
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
      if (this.hitstop > 0) this.hitstop -= dt; else this.update(dt);
    } else if (this.mode === 'menu' && this.map) { this.cam.x += dt * 14; this.cam.y += Math.sin(this.t * 0.1) * dt * 6; this.t += dt; if (this.cam.x > this.map.w * TILE - 400) this.cam.x = 400; R.clampCamera(); }
    if (this.map && this.mode !== 'over') this.render(dt);
    Input.endFrame();
    requestAnimationFrame(t2 => this.frame(t2));
  },
  update(dt) {
    const p = this.player, m = this.map;
    if (Input.pressed.esc) UI.closeAll();
    if (UI.modalOpen && !UI.liveModal) { this.updateCamera(dt); return; }
    this.updatePlayer(dt);
    if (this.buildMode) this.updateBuild();
    Tut.update(dt);
    this.ambientT = (this.ambientT || 3) - dt;
    if (this.ambientT <= 0) { this.ambientT = rand(2.5, 7); if (this.mode === 'raid') Sfx.cricket(); else if (!this.zs || this.zs.time > 100) Sfx.chirp(); }
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
    const mv = Input.moveVec();
    let spd = 118 * p.speedMul * (p.stimT > 0 ? 1.25 : 1);
    if (p.useT > 0) spd *= 0.45; if (p.reloadT > 0) spd *= 0.85;
    const firing = this.aimInput().fire;
    if (mv.mag > 0.92 && !firing && p.stamina > 5 && p.useT <= 0) { spd *= 1.45; p.stamina -= 16 * dt; p.sprint = true; } else { p.stamina = Math.min(100, p.stamina + 12 * dt); p.sprint = false; }
    if (p.rad > 100) spd *= 0.85;
    if (mv.mag > 0.1) {
      moveEntity(p, mv.x * spd * dt, mv.y * spd * dt, 'player'); p.moving = true;
      p.stepT = (p.stepT || 0) - dt * (spd / 118);
      if (p.stepT <= 0) {
        p.stepT = 0.34; Sfx.step(this.map.isIndoor(p.x, p.y)); this.makeNoise(p.x, p.y, p.sprint ? 220 : 90);
        if (p.sprint) this.particles.push({ x: p.x + rand(-4, 4), y: p.y, vx: -mv.x * 20, vy: -8, life: 0.35, max: 0.35, col: '#c8b898', size: 2, drag: 4 });
      }
    } else p.moving = false;
    if (this.buildMode) { if (mv.mag > 0.2) p.ang = Math.atan2(mv.y, mv.x); this.interact = null; return; }
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
    if (a.id !== null && a.mag > Input.AIM_T) {
      let ang = Math.atan2(a.y, a.x);
      // aim assist toward visible enemies close to the aim line
      let best = null, bd = 0.38;
      for (const e of this.enemies) {
        if (e.dead || !e.visible) continue; const d = dist(p.x, p.y, e.x, e.y); if (d > 560) continue;
        const da = Math.abs(angDiff(ang, Math.atan2(e.y - p.y, e.x - p.x))); if (da < bd) { bd = da; best = e; }
      }
      if (best) ang += angDiff(ang, Math.atan2(best.y - p.y, best.x - p.x)) * 0.75;
      return { active: true, ang, fire: a.mag > Input.FIRE_T };
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
      const o = R.shotOrigin(p, true); const bh = Math.round((o.y - o.vy) / R.AP);
      // don't let the muzzle poke through a wall: start inside the body if blocked
      const ox = this.map.opaqueAt(Math.floor(o.x / TILE), Math.floor(o.y / TILE)) ? p.x : o.x, oy = this.map.opaqueAt(Math.floor(o.x / TILE), Math.floor(o.y / TILE)) ? p.y : o.y;
      for (let i = 0; i < n; i++) {
        const a = p.ang + rand(-spr, spr);
        this.bullets.push({ x: ox, y: oy, h: bh, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, dmg, pen, owner: 'player', life: w.range / w.speed });
      }
      p.recoil = Math.min(1, p.recoil + 0.25);
      Sfx.shot(w.sfx); R.flash(o.vx, o.vy, p.ang); this.addLight(o.vx, o.vy, 150, 0.06, '#ffd080'); this.kick(p.ang, w.pellets ? 7 : w.dmg > 50 ? 9 : 3);
      this.shake(w.pellets ? 3 : w.dmg > 50 ? 4 : 0.8);
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
    const spd = 420; this.throwables.push({ kind: 'grenade', x: p.x, y: p.y, vx: Math.cos(p.ang) * spd, vy: Math.sin(p.ang) * spd, fuse: 1.7, owner: 'player' });
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
    for (const gi of m.groundItems) { const d = dist(p.x, p.y, gi.x, gi.y); if (d < 34) consider(gi, d - 4, 'Pick up ' + ITEMS[gi.item.id].name + (gi.item.n > 1 ? ' ×' + gi.item.n : ''), 'ground'); }
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
        if (p.gatherT <= 0) { p.gatherT = 0.45; this.gather(it.o); }
      } else p.gatherT = 0;
      return;
    }
    if (!Input.pressed.interact) return;
    if (it.kind === 'ground') {
      const m = this.map, gi = it.o; const left = m.kind === 'base' ? (this.stashAdd(gi.item.id, gi.item.n), 0) : this.addToBag({ ...gi.item });
      if (left === gi.item.n) return this.toast('Bag is full', 'bad');
      if (left) gi.item.n = left; else m.groundItems.splice(m.groundItems.indexOf(gi), 1);
      Sfx.pickup(); this.floatText(gi.x, gi.y - 24, '+' + ITEMS[gi.item.id].name, '#fee761'); this.run.looted++; return;
    }
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
    if (o.type === 'tree') gains.push(['wood', Math.ceil(12 * mult)]);
    else if (o.type === 'rock') gains.push(['stone', Math.ceil(12 * mult)]);
    else if (o.type === 'ore_metal') { gains.push(['metal_ore', Math.ceil(6 * mult)], ['stone', Math.ceil(3 * mult)]); if (chance(0.12 * mult)) gains.push(['hqm_ore', 1]); }
    else if (o.type === 'ore_sulfur') gains.push(['sulfur_ore', Math.ceil(6 * mult)], ['stone', Math.ceil(2 * mult)]);
    o.amt -= gains[0][1]; o.shake = 0.15;
    if (o.type === 'tree') Sfx.chop(); else Sfx.mine();
    for (let i = 0; i < 3; i++) this.particles.push({ x: o.x + rand(-6, 6), y: o.y + rand(-6, 6), vx: rand(-60, 60), vy: rand(-60, 60), life: 0.35, max: 0.35, col: o.type === 'tree' ? '#8a6a3a' : '#aaa', size: 3, drag: 4 });
    for (const [id, n] of gains) {
      if (this.run.gathered[id] !== undefined) this.run.gathered[id] += n;
      if (m.kind === 'base') this.stashAdd(id, n);
      else { const left = this.addToBag({ id, n }); if (left) { this.toast('Bag is full', 'bad'); break; } }
      this.floatText(o.x, o.y - 20, '+' + n + ' ' + ITEMS[id].name, '#e8d8a8');
    }
    this.makeNoise(p.x, p.y, 200);
    if (o.amt <= 0) { m.removeObj(o); if (o.type === 'tree') { Sfx.thud(o.x, o.y); R.decal('stump', o.x, o.y, true); } else R.decal('debris', o.x, o.y); }
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
      Sfx.shot(d.pellets > 1 ? 'shotgun' : 'turret', s.x, s.y); this.muzzle(s.x, s.y - 14, s.ang, 14);
    }
  },

  // -------------------------------------------------------------------------
  // EFFECTS
  // -------------------------------------------------------------------------
  toast(msg, cls) { UI.toast(msg, cls); },
  shake(n) { this.shakeA = Math.max(this.shakeA, n); },
  spawnBlood(x, y, n, col = '#8a1a1a') {
    for (let i = 0; i < n; i++) this.particles.push({ x, y: y - 14, vx: rand(-90, 90), vy: rand(-90, 90), life: rand(0.2, 0.5), max: 0.5, col, size: rand(2, 4), drag: 5 });
    if (chance(0.45)) R.decal(col === '#8a1a1a' ? 'blood' : 'goo', x + rand(-8, 8), y + rand(-6, 6));
  },
  spark(x, y, col = '#ffe0a0') { for (let i = 0; i < 4; i++) this.particles.push({ x, y, vx: rand(-120, 120), vy: rand(-120, 120), life: 0.18, max: 0.18, col, size: 2, drag: 4 }); },
  muzzle(x, y, ang, r) {
    const mx = x + Math.cos(ang) * r, my = y + Math.sin(ang) * r;
    R.flash(mx, my, ang); this.addLight(mx, my, 150, 0.06, '#ffd080');
  },
  addLight(x, y, r, life, col) { this.lights.push({ x, y, r, life, max: life, col }); },
  floatText(x, y, txt, col = '#fff') { if (this.texts.length < 40) this.texts.push({ x, y, txt, col, life: 0.9 }); },
  // camera follows the player with a look-ahead toward the aim; R (render.js) handles projection
  updateCamera(dt) {
    const p = this.player; if (!p) return;
    const aim = this.aimInput();
    const look = aim.active ? 56 : (p.moving ? 18 : 0);
    const tx = p.x + Math.cos(p.ang) * look, ty = p.y + Math.sin(p.ang) * look;
    const k = 1 - Math.exp(-6 * dt); this.cam.x = lerp(this.cam.x, tx, k); this.cam.y = lerp(this.cam.y, ty, k);
    this.cam.kx *= Math.exp(-14 * dt); this.cam.ky *= Math.exp(-14 * dt);
    R.clampCamera();
    this.shakeA = Math.max(0, this.shakeA - dt * 30);
  },
  kick(ang, amt) { this.cam.kx -= Math.cos(ang) * amt; this.cam.ky -= Math.sin(ang) * amt; },
  render(dt) { R.render(dt); },
  prerender() { R.buildGround(this.map); },
  worldToScreen(x, y) { return R.worldToScreen(x, y); },
  screenToWorld(x, y) { return R.screenToWorld(x, y); },
};

function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16); const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

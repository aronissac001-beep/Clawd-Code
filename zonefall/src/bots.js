// ============================================================================
// ZONEFALL 3 — AI survivors: bots that play the game like other players.
// Each one has a name, a personality (friendly / neutral / hostile), a real
// inventory, and goals: gather wood + stone, craft tools and weapons, pick a
// spot and build a base (foundations, walls, a door, cupboard, box, bed,
// roof, upgrades), loot barrels and monuments, hunt, eat, heal, fight, flee,
// go home at night, respawn at their sleeping bag, chat, hold grudges, team
// up with you, and — the hostile ones — raid your base with satchels.
// Near the player they run the full simulation; far away a cheap abstract
// one keeps them progressing.
//
// Progression over the days, like a player: better tools, guns, armour and
// ammo as they find blueprints and build workbenches; scavenging crates,
// roadside barrels and monuments (tougher ones as their gear improves);
// components and valuables taken to a monument recycler; ore smelted in their
// furnace; a base that grows in stages (house -> second floor up the stairs ->
// stone -> an annex with a big box -> sheet metal), rebuilt when pieces are
// lost, its cupboard kept stocked for upkeep and loot stored in its boxes.
// Raids are rare and announced: a raider only comes once it has stockpiled
// enough satchels to blow the cheapest way into your base (Build.raidCost +1),
// at most one survivor raid every three days and per raider every five.
// ============================================================================
import { G } from './state.js';
import { ITEMS, RECIPES, RECIPE, RECYCLE, WEAPONS, MELEE, NODES, GATHER_PER_HIT, LOOT, CELL, TIERS, PIECES, DOORS, DEPLOY, UPKEEP } from './data.js';
import { removeDoor } from './doors.js';
import { PlayerInv, Inv } from './inventory.js';
import { spawnActor, removeActor, moveActor, settleY, airborne } from './actors.js';
import { steer, canSee, aimError, trackAim, findCover } from './ai.js';
import { Nav } from './nav.js';
import { fireWeapon, hurt, throwItem, damageStruct } from './combat.js';
import { Build } from './build.js';
import { Live, rollInto } from './world/live.js';
import { TREE_KINDS } from './gfx/veg.js';
import { Sfx } from './audio.js';
import { rand, randi, pick, chance, dist, clamp, angDiff, weighted } from './util.js';

const NAMES = ['Rustbucket', 'quietfox', 'Grandma_Joy', 'TacticalTim', 'nakedbob', 'Moonshine', 'SgtPickles', 'BaconPaladin', 'Hemp_Lord', 'Doorcamper', 'Kev', 'BeachRat',
  'NoScope_Noah', 'RockSolid', 'Twigboi', 'Sulfur_Sam', 'lilmaxx', 'Captain_Rad', 'PapaBear', 'Wobbles', 'xX_Shadow_Xx', 'Dr_Splinter', 'Tinfoil', 'Mira', 'Big_Lenny', 'Yuki', 'Sven', 'ZeroCool'];
const LOOKS = ['survivor_a', 'survivor_b', 'survivor_c', 'survivor_d'];
const LINES = {
  greet: { friendly: ['hey! friendly :)', 'hello neighbour', 'yo, you good?', 'friendly here', 'hi!! dont shoot'], neutral: ['...', 'sup', 'keep your distance', 'just farming'], hostile: ['nice gear', 'you lost?', 'heh'] },
  threat: ['dont shoot!', 'chill bro', 'friendly!!', 'put it down man', 'we cool?'],
  angry: ['you\'re dead', 'big mistake', 'get off my land', 'KOS now', 'run.'],
  kill: ['ez', 'gg', 'sit', 'nice loot', 'should have run'],
  die: ['wtf', 'nooo my stuff', 'lag!!', 'ugh', 'gg'],
  loot: ['barrel!', 'scrap scrap scrap', 'ooh a crate', 'mine'],
  build: ['building a lil base', 'need more stone', 'door is up', 'upgrading to stone'],
  night: ['getting dark, heading home', 'night night', 'raiders out, careful'],
  team: ['lets go!', 'got your back', 'on my way', 'nice base'],
  gift: ['thanks!!', 'appreciate it', 'you\'re a legend', 'cheers'],
  raid: ['door is wood lol', 'raid time', 'satchel out!', 'knock knock'],
  flee: ['im out', 'help!!', 'nope nope', 'retreating'],
};
const RAID_FIRST_DAY = 5;   // no survivor raids before this day
const RAID_MIN_BOOM = 2;    // and never with fewer than this many satchels
const say = (b, cat, persona) => { const L = LINES[cat]; const arr = Array.isArray(L) ? L : (L[persona] || L.neutral); if (b.actor && G.ui && G.ui.say) G.ui.say(b.actor, b.name, pick(arr)); b.sayT = rand(8, 18); };

let BID = 1;
export const Bots = {
  list: [],
  reset() { for (const b of this.list) if (b.actor) removeActor(b.actor); this.list = []; BID = 1; },
  init(saved) {
    this.reset();
    if (saved && saved.length) { for (const s of saved) this.list.push(this.restore(s)); return; }
    const used = new Set(); const n = Math.min(NAMES.length - 1, 11); // a bigger island holds more survivors
    for (let i = 0; i < n; i++) {
      let name = pick(NAMES); while (used.has(name)) name = pick(NAMES); used.add(name);
      const persona = weighted([['friendly', 3.5], ['neutral', 4], ['hostile', 2.5]])[0];
      const sp = pick(G.W.spawns);
      const b = { id: BID++, name, persona, look: pick(LOOKS), rel: persona === 'friendly' ? 0.45 : persona === 'neutral' ? 0 : -0.6, inv: new PlayerInv(), x: sp.x, z: sp.z, hp: 100, food: 80, water: 80, home: null, plan: null, planI: 0, dead: false, respawnAt: 0, team: false, kills: 0, skill: rand(0.45, 0.95), goal: null, sayT: rand(3, 10), spawnDay: G.day };
      b.inv.belt.add('rock', 1); b.inv.belt.add('torch', 1);
      // they wash up at different times, with a head start for some
      if (i % 3 === 0) { b.inv.main.add('wood', randi(100, 400)); b.inv.main.add('stone', randi(50, 200)); b.inv.belt.add('hatchet', 1); }
      if (i % 4 === 1) { b.inv.belt.add('bow', 1); b.inv.main.add('arrow', randi(8, 20)); }
      this.list.push(b);
    }
  },
  restore(s) {
    const b = Object.assign({}, s); b.inv = PlayerInv.from(s.inv); b.actor = null; b.goal = null;
    // re-link base deployables
    b.tc = Build.deploys.find(d => d.owner === 'bot:' + b.id && d.type === 'tc') || null;
    b.bag = Build.deploys.find(d => d.owner === 'bot:' + b.id && d.type === 'sleeping_bag') || null;
    b.box = Build.deploys.find(d => d.owner === 'bot:' + b.id && d.type === 'box_small') || null;
    b.box2 = Build.deploys.find(d => d.owner === 'bot:' + b.id && d.type === 'box_large') || null;
    b.furnace = Build.deploys.find(d => d.owner === 'bot:' + b.id && d.type === 'furnace') || null;
    if (b.lastRaidDay === null) delete b.lastRaidDay; if (b.raidNight === null) delete b.raidNight; if (b.rumourDay === null) delete b.rumourDay;
    BID = Math.max(BID, b.id + 1); return b;
  },
  serialize() { return this.list.map(b => ({ id: b.id, name: b.name, persona: b.persona, look: b.look, rel: b.rel, inv: b.inv.toJSON(), x: b.actor ? b.actor.x : b.x, z: b.actor ? b.actor.z : b.z, hp: b.actor ? b.actor.hp : b.hp, food: b.food, water: b.water, home: b.home, plan: b.plan, planI: b.planI, dead: b.dead, respawnAt: b.respawnAt, team: b.team, kills: b.kills, skill: b.skill, spawnDay: b.spawnDay, bps: b.bps || [], lastRaidDay: b.lastRaidDay ?? null, raidNight: b.raidNight ?? null, rumourDay: b.rumourDay ?? null, robbed: b.robbed || 0, crafted: b.crafted || 0, recycled: b.recycled || 0, looted: b.looted || 0 })); },
  ownerOf(b) { return 'bot:' + b.id; },
  byOwner(o) { return this.list.find(b => 'bot:' + b.id === o) || null; },
  // ---------------------------------------------------------------- relations
  hostileToPlayer(b) { if (b.team) return false; if (G.t < 240 && !b.hitByPlayer) return false; return b.persona === 'hostile' ? b.rel < 0.5 : b.rel < -0.25; },
  hostileTo(b, other) {
    if (!other || other.dead) return false;
    if (other === G.player) return this.hostileToPlayer(b);
    if (other.bot) { const o = other.bot; if (b.team && o.team) return false; if (b.team) return this.hostileToPlayer(o); if (o.team) return this.hostileToPlayer(b); return (b.persona === 'hostile' || o.persona === 'hostile') && (b.grudges && b.grudges[o.id] || b.persona === 'hostile'); }
    if (other.team === 'hostile' || other.team === 'raider') return true;
    if (other.kind === 'animal' && !other.def.flee) return true;
    return false;
  },
  onHurt(a, src) {
    const b = a.bot; const by = src && src.owner; if (!by || by === a) return;
    if (by === G.player) {
      b.rel -= b.team ? 0.25 : 0.7; b.hitByPlayer = G.t;
      if (b.team && b.rel < 0.3) { b.team = false; a.team = 'bot:' + b.id; say(b, 'angry'); }
      else if (!b.angryT || G.t - b.angryT > 10) { b.angryT = G.t; say(b, this.hostileToPlayer(b) ? 'angry' : 'threat'); }
    } else if (by.bot) { b.grudges = b.grudges || {}; b.grudges[by.bot.id] = true; }
    b.threat = by; b.threatT = G.t;
  },
  onKill(a, src) {
    const b = a.bot; const by = src && src.owner;
    b.dead = true; b.respawnAt = G.t + rand(60, 140); say(b, 'die');
    // everything goes in a bag, like a real player
    const inv = new Inv(40);
    for (const v of [b.inv.belt, b.inv.main]) for (const s of v.items()) inv.addStack(s);
    for (const k of ['helmet', 'armor', 'bag']) if (b.inv.equip[k]) inv.addStack(b.inv.equip[k]);
    if (!inv.empty()) { const bag = Live.dropInv(a.x, a.z, inv, 'bag', 900, a.y + 0.5); bag.corpse = b.name; }
    b.inv = new PlayerInv(); b.inv.belt.add('rock', 1); b.inv.belt.add('torch', 1);
    if (by && by.bot) { by.bot.kills++; say(by.bot, 'kill'); }
    if (G.ui) G.ui.killFeed((by === G.player ? 'You' : by && by.bot ? by.bot.name : by && by.def ? by.def.name : 'The island') + ' ✕ ' + b.name);
    if (by === G.player && b.team) { b.team = false; b.rel = -1; }
    setTimeout(() => { if (b.actor === a) { removeActor(a); b.actor = null; } }, 20000);
  },
  // ---------------------------------------------------------------- per frame
  update(dt) {
    const P = G.player;
    if ((this.planT = (this.planT || 0) - dt) <= 0) { this.planT = 3; this.raidPlans(); }
    for (const b of this.list) {
      if (b.dead) {
        if (G.t >= b.respawnAt) this.respawn(b);
        continue;
      }
      const bx = b.actor ? b.actor.x : b.x, bz = b.actor ? b.actor.z : b.z;
      const near = (G.net ? G.net.anchors() : P ? [P] : []).some(q => dist(q.x, q.z, bx, bz) < 140);
      if (near && !b.actor && (G.spawnBudget ?? 1) > 0) { G.spawnBudget = (G.spawnBudget ?? 1) - 1; this.materialize(b); } // one character a frame
      if (!near && b.actor && !b.actor.dead && !b.team) this.dematerialize(b);
      if (b.actor) { if (!b.actor.dead) this.think(b, b.actor, dt); }
      else this.abstract(b, dt);
    }
  },
  materialize(b) {
    const a = spawnActor('survivor', b.x, b.z, { team: b.team ? 'player' : 'bot:' + b.id, look: b.look });
    a.bot = b; a.hp = b.hp || 100; b.actor = a; a.name = b.name;
    this.dress(b); this.equipBest(b);
  },
  dematerialize(b) { const a = b.actor; b.x = a.x; b.z = a.z; b.hp = a.hp; removeActor(a); b.actor = null; },
  respawn(b) {
    b.dead = false; b.hp = 100; b.food = 70; b.water = 70; b.goal = null;
    const bag = b.bag && !b.bag.dead ? b.bag : null;
    if (bag) { b.x = bag.x + 0.8; b.z = bag.z; } else { const sp = pick(G.W.spawns); b.x = sp.x; b.z = sp.z; }
    b.actor = null;
  },
  dress(b) {
    const a = b.actor; if (!a) return; const L = Object.assign({}, (G.models && G.models.LOOKS && (G.models.LOOKS[b.look] || G.models.LOOKS.survivor)) || {});
    if (b.inv.equip.armor) L.vest = b.inv.equip.armor.id; if (b.inv.equip.helmet) L.helmet = b.inv.equip.helmet.id; if (b.inv.equip.bag) L.bag = b.inv.equip.bag.id;
    try { a.rig.setLook(L); } catch (e) { }
  },
  equipBest(b) {
    let changed = false;
    for (const [slot, cat] of [['armor', 'armor'], ['helmet', 'helmet'], ['bag', 'bag']]) {
      const cur = b.inv.equip[slot]; let best = cur, bv = cur ? (ITEMS[cur.id].armor || ITEMS[cur.id].slots || 0) : -1;
      for (const v of [b.inv.belt, b.inv.main]) v.slots.forEach((s, i) => { if (s && ITEMS[s.id].cat === cat) { const val = ITEMS[s.id].armor || ITEMS[s.id].slots || 0; if (val > bv) { bv = val; best = { s, v, i }; } } });
      if (best && best !== cur && best.s) { best.v.slots[best.i] = cur || null; b.inv.equip[slot] = best.s; changed = true; }
    }
    if (changed) { b.inv.fixSize(); this.dress(b); }
    this.pickWeapon(b);
  },
  /** choose what to hold: best gun with ammo, else best melee for the job */
  pickWeapon(b, job) {
    const a = b.actor; if (!a) return; const inv = b.inv;
    let id = null;
    if (job === 'wood' || job === 'ore') {
      let best = 0; for (const s of inv.all()) { const m = MELEE[s.id]; if (m && m[job] > best) { best = m[job]; id = s.id; } }
    } else {
      let best = -1; for (const s of inv.all()) { const W = WEAPONS[s.id]; if (!W) continue; const ammo = (s.ammo || 0) + inv.count(W.ammo); if (ammo <= 0) continue; const v = W.dmg * (W.pellets || 1) * W.rof; if (v > best) { best = v; id = s.id; } }
      if (!id) { let bm = 0; for (const s of inv.all()) { const m = MELEE[s.id]; if (m && m.dmg > bm) { bm = m.dmg; id = s.id; } } }
    }
    if (G.night > 0.5 && !WEAPONS[id] && inv.count('torch') && job !== 'wood' && job !== 'ore') id = 'torch';
    if (a.held !== id) { a.held = id; try { a.rig.setHeld(id); } catch (e) { } }
    a.gunStack = id && WEAPONS[id] ? inv.all().find(s => s.id === id) : null;
  },
  // ---------------------------------------------------------------- brain (full sim)
  think(b, a, dt) {
    const P = G.player;
    a.cd -= dt; b.sayT -= dt; b.thinkT = (b.thinkT || 0) - dt;
    if (a.st.swing >= 0) { a.st.swing += dt * 1.6; if (a.st.swing >= 0.45 && !a.struck) { a.struck = true; a.onStrike && a.onStrike(); } if (a.st.swing >= 1) { a.st.swing = -1; a.struck = false; } }
    if (a.st.reload >= 0) { a.st.reload += dt / (a.reloadTime || 2); if (a.st.reload >= 1) { a.st.reload = -1; this.finishReload(b); } }
    if (a.st.use >= 0) { a.st.use += dt / 1.4; if (a.st.use >= 1) { a.st.use = -1; a.onUse && a.onUse(); a.onUse = null; } }
    if (a.st.recoil > 0) a.st.recoil = Math.max(0, a.st.recoil - dt * 6);
    if (a.st.flinch > 0) a.st.flinch = Math.max(0, a.st.flinch - dt * 4);
    if (a.st.throw >= 0) { a.st.throw += dt * 2.5; if (a.st.throw >= 1) a.st.throw = -1; }
    if (a.bleed > 0) { a.bleed -= dt; if (chance(dt * 1.2)) hurt(a, 1.2, { kind: 'bleed' }); }
    b.food = Math.max(0, b.food - dt * 0.05); b.water = Math.max(0, b.water - dt * 0.06);
    if (a.hp < a.maxhp && b.food > 30 && b.water > 30) a.hp = Math.min(a.maxhp, a.hp + dt * 0.25);
    // ---- perception: threats
    if ((b.ptT = (b.ptT || 0) - dt) <= 0) { b.ptT = 0.3; b.threatC = this.findThreat(b, a); }
    const threat = b.threatC && !b.threatC.dead ? b.threatC : null;
    if (threat) { const ty = a.hp < 30 && !b.team ? 'flee' : 'fight'; if (!b.goal || b.goal.type !== ty || b.goal.target !== threat) b.goal = { type: ty, target: threat, t: 0 }; }
    else if (b.goal && (b.goal.type === 'fight' || b.goal.type === 'flee') && (G.t - (b.lastSeenT || 0) > 6)) b.goal = null;
    // ---- social: greet the player
    if (P && !P.dead && b.sayT <= 0 && !threat && dist(a.x, a.z, P.x, P.z) < 9 && canSee(a, P)) {
      if (b.team) say(b, 'team'); else if (P.aiming && !this.hostileToPlayer(b) && Math.abs(angDiff(P.ang, Math.atan2(a.z - P.z, a.x - P.x))) < 0.25) { say(b, 'threat'); b.aimedAt = (b.aimedAt || 0) + 1; if (b.persona !== 'friendly' && b.aimedAt > 3) { b.rel -= 0.3; } }
      else say(b, 'greet', b.persona);
      b.faceP = 2.2; // look at whoever we're talking to
    }
    // ---- choose a goal (now and then just stand a moment and look around between jobs)
    if (!b.pace) b.pace = rand(0.9, 1.08);
    if (!b.goal && !threat && !b.team && !b.paused && chance(0.35)) { b.goal = { type: 'pause', t: rand(1.2, 3.5), base: a.ang }; b.paused = true; }
    if (!b.goal || b.thinkT <= 0 && !['fight', 'flee', 'pause'].includes(b.goal.type)) { b.thinkT = rand(1.2, 2.5); const g = this.chooseGoal(b, a); if (!b.goal || g.type !== b.goal.type || g.force) b.goal = g; b.paused = false; }
    if ((b.wT = (b.wT || 0) - dt) <= 0) { b.wT = 4; const gt = b.goal && b.goal.type; if (!['gather', 'fight', 'hunt', 'loot', 'raid'].includes(gt)) this.pickWeapon(b); }
    if (a.climb) Nav.climbStep(a, dt); else this.act(b, a, dt);
    if (b.faceP > 0 && P && !threat) { b.faceP -= dt; if (a.speedNow < 1) a.ang += clamp(angDiff(a.ang, Math.atan2(P.z - a.z, P.x - a.x)), -dt * 4, dt * 4); }
    settleY(a, dt);
    a.st.aim = b.goal && b.goal.type === 'fight' && !!a.gunStack;
  },
  findThreat(b, a) {
    let best = null, bd = 26 * 26;
    const consider = o => { if (!o || o.dead || o === a || airborne(o)) return; const d2 = (o.x - a.x) ** 2 + (o.z - a.z) ** 2; if (d2 > bd) return; if (!this.hostileTo(b, o)) return; if (!canSee(a, o)) return; bd = d2; best = o; };
    if (G.player && !(G.player.inSafe)) consider(G.player);
    for (const o of G.actors) { if (o === G.player || o === a) continue;
      if (o.remote !== undefined) { if (!o.dead && !airborne(o) && this.hostileTo(b, G.player) && (o.x - a.x) ** 2 + (o.z - a.z) ** 2 < bd && canSee(a, o)) { bd = (o.x - a.x) ** 2 + (o.z - a.z) ** 2; best = o; } continue; } /* other players count as players */
      if (o.kind === 'animal' && o.def.flee) continue; if ((o.x - a.x) ** 2 + (o.z - a.z) ** 2 > bd) continue; consider(o); }
    // recent attacker even if not visible
    if (!best && b.threat && !b.threat.dead && G.t - b.threatT < 8 && dist(a.x, a.z, b.threat.x, b.threat.z) < 40) best = b.threat;
    // teammates defend the player
    if (b.team && !best && G.player && G.player.lastAttacker && !G.player.lastAttacker.dead && G.t - G.player.lastAttackT < 6) best = G.player.lastAttacker;
    if (best) b.lastSeenT = G.t;
    return best;
  },
  chooseGoal(b, a) {
    const inv = b.inv, P = G.player;
    // needs
    if (a.hp < 65 && (inv.count('bandage') || inv.count('medkit'))) return { type: 'heal' };
    if (b.food < 35) { const f = ['cooked_meat', 'canned', 'berries', 'mushroom', 'raw_meat'].find(id => inv.count(id)); if (f) return { type: 'eat', item: f }; }
    if (b.water < 30) { if (inv.count('water_bottle')) return { type: 'eat', item: 'water_bottle' }; const w = findWater(a.x, a.z); if (w) return { type: 'drink', x: w.x, z: w.z }; }
    if (!inv.count('bandage') && inv.count('cloth') >= 8) return { type: 'craft', id: 'bandage', n: 2 };
    // teammates follow
    if (b.team && P && !P.dead) {
      if (dist(a.x, a.z, P.x, P.z) > 9) return { type: 'follow' };
      const t = nearestGather(a.x, a.z, 10, 'wood'); if (t && chance(0.5)) return { type: 'gather', target: t, res: 'wood' };
      return { type: 'follow' };
    }
    // night: the one armed for a raid goes (announced at dusk), everyone else goes home
    const night = G.night > 0.55;
    if (night && b.raidNight === G.day && Build.tc && this.boom(b) > 0) return { type: 'raid', force: true };
    if (night && b.home) return { type: 'home' };
    // gear progression
    const craftable = this.nextCraft(b);
    if (craftable) return { type: 'craft', id: craftable.id, n: 1 };
    // the base: build the current stage, then grow it (second floor, stone, an annex, sheet metal)
    if (!b.plan && inv.count('wood') >= 500 && G.day >= (b.spawnDay || 1)) { const site = this.findSite(b, a); if (site) { b.plan = site; b.planI = 0; b.home = { x: site.cx, z: site.cz }; say(b, 'build'); } }
    if (b.plan) {
      if ((b.recheckT = (b.recheckT || 0) - 1) <= 0) { b.recheckT = 12; this.recheck(b); }
      if (b.planI >= b.plan.steps.length) this.nextStage(b);
      if (b.planI < b.plan.steps.length) {
        const st = b.plan.steps[b.planI]; const need = this.stepCost(b, st);
        const missing = Object.keys(need).find(k => this.have(b, k) < need[k]);
        if (!missing) return { type: 'build' };
        const job = this.jobFor(b, a, missing); if (job) return job;
        (b.skipped = b.skipped || []).push(b.planI); b.planI++; // can't get it now: skip the step (a recheck comes back to it once affordable)
      }
    }
    // keep the cupboard stocked so the base doesn't decay
    if (b.tc && !b.tc.dead && this.tcShort(b)) return { type: 'stock' };
    // components and junk -> a recycler
    if (this.recyclables(b).length >= 3) { const u = recyclerNear(a.x, a.z); if (u) return { type: 'recycle', u }; }
    // ore -> furnace, loot -> boxes
    if (this.boxFor(b) && (inv.count('wood') > 900 || inv.count('stone') > 700 || inv.count('metal_ore') + inv.count('sulfur_ore') > 150 || inv.main.slots.filter(Boolean).length > 18)) return { type: 'deposit' };
    // the raiders stock up on sulfur for gunpowder
    if (this.wantsBoom(b) && inv.count('sulfur') + inv.count('sulfur_ore') < 60 && chance(0.4)) return { type: 'gather', res: 'sulfur' };
    // otherwise: farm, loot (monuments by gear, roadside barrels), hunt, explore — with some personality
    const gear = this.gearLevel(b);
    const w = [['gather', 3.2], ['loot', b.persona === 'hostile' ? 3 : 2.2], ['roam', 0.6], ['pick', 0.7], ['scavenge', 1.2 + gear * 0.4]];
    if (inv.all().some(s => WEAPONS[s.id] && (s.ammo || inv.count(WEAPONS[s.id].ammo)))) w.push(['hunt', 1.0], ['explore', 1.0 + gear * 0.5]);
    const k = weighted(w)[0];
    if (k === 'gather') return { type: 'gather', res: inv.count('stone') < inv.count('wood') * 0.6 ? 'ore' : 'wood' };
    if (k === 'roam') { const ang = rand(0, 6.28), r = rand(20, 50); return { type: 'move', x: a.x + Math.cos(ang) * r, z: a.z + Math.sin(ang) * r, t: 0 }; }
    if (k === 'explore') { const m = nearestMon(a.x, a.z, Math.min(3, 1 + gear)); if (m) return { type: 'move', x: m.x + rand(-8, 8), z: m.z + rand(-8, 8), explore: true }; }
    if (k === 'scavenge') { const c = roadsideBarrel(a.x, a.z); if (c) return { type: 'move', x: c.x, z: c.z, explore: true }; }
    return { type: k === 'scavenge' || k === 'explore' ? 'loot' : k };
  },
  /** how to get more of a missing building material */
  jobFor(b, a, res) {
    if (res === 'wood') return { type: 'gather', res: 'wood' };
    if (res === 'stone' || res === 'metal_ore') return { type: 'gather', res: 'ore' };
    if (res === 'metal' || res === 'sulfur') { if (b.furnace && !b.furnace.dead) return b.inv.count(res === 'metal' ? 'metal_ore' : 'sulfur_ore') > 40 ? { type: 'deposit' } : { type: 'gather', res: res === 'metal' ? 'ore' : 'sulfur' }; return { type: 'loot' }; }
    if (res === 'cloth') return { type: 'pick' };
    if (['scrap', 'rope', 'pipe', 'gears', 'low_fuel', 'tape', 'spring'].includes(res)) return chance(0.5) && this.recyclables(b).length ? { type: 'recycle', u: recyclerNear(a.x, a.z) } : { type: 'loot' };
    return null;
  },
  // ---------------------------------------------------------------- gear progression
  wbTier(b) { let t = 0; for (const d of Build.deploys) if (d.owner === this.ownerOf(b) && !d.dead && DEPLOY[d.type].wbTier) t = Math.max(t, DEPLOY[d.type].wbTier); return t; },
  /** 0 = rock and a shirt ... 3 = rifles and plate */
  gearLevel(b) {
    const inv = b.inv; const ar = inv.equip.armor ? ITEMS[inv.equip.armor.id].armor || 0 : 0;
    let gun = 0; for (const s of inv.all()) { const W = WEAPONS[s.id]; if (W) gun = Math.max(gun, W.dmg * (W.pellets || 1) * W.rof); }
    return (gun > 150 ? 1.5 : gun > 60 ? 1 : gun > 0 ? 0.5 : 0) + (ar >= 0.4 ? 1.5 : ar >= 0.3 ? 1 : ar >= 0.16 ? 0.5 : 0);
  },
  nextCraft(b) {
    const inv = b.inv; const cnt = id => inv.count(id), eq = id => Object.values(inv.equip).some(s => s && s.id === id);
    const has = (...ids) => ids.some(id => cnt(id) > 0 || eq(id));
    const wb = this.wbTier(b), bps = b.bps || [];
    const armor = inv.equip.armor ? ITEMS[inv.equip.armor.id].armor || 0 : 0, helm = inv.equip.helmet ? ITEMS[inv.equip.helmet.id].armor || 0 : 0;
    let gun = 0; for (const s of inv.all()) { const W = WEAPONS[s.id]; if (W) gun = Math.max(gun, W.dmg * (W.pellets || 1) * W.rof); }
    const gs = id => { const W = WEAPONS[id]; return W ? W.dmg * (W.pellets || 1) * W.rof : 0; };
    const uses = am => inv.all().some(s => WEAPONS[s.id] && WEAPONS[s.id].ammo === am);
    const boom = this.wantsBoom(b);
    const order = [
      ['hatchet', !has('hatchet', 'salv_axe')], ['pickaxe', !has('pickaxe', 'salv_pick')],
      ['burlap', armor < 0.08], ['helm_wood', helm < 0.05], ['bow', gun <= 0], ['arrow', has('bow') && cnt('arrow') < 12],
      ['spear_wood', !has('spear_wood', 'machete')], ['bag_small', !inv.equip.bag && cnt('leather') >= 5],
      ['wood_armor', armor < 0.16], ['pipe_pistol', gun < gs('pipe_pistol')], ['vest_scrap', armor < 0.22], ['helm_bucket', helm < 0.08],
      ['salv_axe', !has('salv_axe')], ['salv_pick', !has('salv_pick')], ['machete', !has('machete')],
      ['revolver', gun < gs('revolver')], ['boomstick', gun < gs('boomstick')], ['vest_sign', armor < 0.32],
      ['pistol_ammo', uses('pistol_ammo') && cnt('pistol_ammo') < 40], ['shell', uses('shell') && cnt('shell') < 16],
      ['smg', gun < gs('smg')], ['pump', gun < gs('pump')], ['vest_plate', armor < 0.46], ['helm_riot', helm < 0.14], ['rifle_ammo', uses('rifle_ammo') && cnt('rifle_ammo') < 40],
      ['ar', gun < gs('ar')], ['helm_mil', helm < 0.2],
      // the raiders build their stockpile: gunpowder -> beancans -> satchels
      ['gunpowder', boom && cnt('gunpowder') < 80], ['beancan', boom && cnt('beancan') < 2], ['satchel', boom],
    ];
    for (const [id, want] of order) {
      if (!want) continue; const r = RECIPE[id]; if (!r || r.wb > wb) continue; if (r.bp && !bps.includes(r.id)) continue;
      if (Object.entries(r.cost).every(([k, v]) => this.have(b, k) >= v)) return r;
    }
    return null;
  },
  /** pay a recipe from pockets then boxes and make it */
  craftNow(b, r, n = 1) { for (const [k, v] of Object.entries(r.cost)) this.pay(b, k, v * n); b.inv.add(r.out, r.n * n); b.crafted = (b.crafted || 0) + 1; this.equipBest(b); },
  /** blueprints found in loot are learned on the spot */
  learn(b) {
    b.bps = b.bps || [];
    for (const v of [b.inv.belt, b.inv.main]) for (let i = 0; i < v.slots.length; i++) { const s = v.slots[i]; if (s && ITEMS[s.id] && ITEMS[s.id].teach) { if (!b.bps.includes(ITEMS[s.id].teach)) b.bps.push(ITEMS[s.id].teach); v.slots[i] = null; } }
  },
  // ---------------------------------------------------------------- storage, recycling, upkeep
  boxes(b) { return [b.box, b.box2].filter(d => d && !d.dead && d.inv); },
  boxFor(b) { return this.boxes(b).find(d => d.inv.slots.some(s => !s)) || this.boxes(b)[0] || null; },
  have(b, k) { let n = b.inv.count(k); for (const d of this.boxes(b)) n += d.inv.count(k); return n; },
  pay(b, k, v) { let n = v - b.inv.take(k, v); for (const d of this.boxes(b)) { if (n <= 0) break; n -= d.inv.take(k, n); } },
  /** put loot in the boxes, ore in the furnace (lit), and pick up what it smelted */
  depositAll(b) {
    const f = b.furnace && !b.furnace.dead ? b.furnace : null;
    if (f) {
      for (const k of ['metal', 'sulfur', 'hqm', 'charcoal']) { const n = f.inv.count(k); if (n) { f.inv.take(k, n); const left = b.inv.add(k, n); if (left) f.inv.add(k, left); } }
      for (const k of ['metal_ore', 'sulfur_ore', 'hqm_ore']) { const n = Math.min(b.inv.count(k), f.inv.room(k)); if (n > 0) { b.inv.take(k, n); f.inv.add(k, n); } }
      const fuel = Math.min(Math.max(0, 200 - f.inv.count('wood')), Math.max(0, b.inv.count('wood') - 300), f.inv.room('wood')); if (fuel > 0) { b.inv.take('wood', fuel); f.inv.add('wood', fuel); }
      if (f.inv.count('wood') > 0 && (f.inv.count('metal_ore') + f.inv.count('sulfur_ore') + f.inv.count('hqm_ore')) > 0) f.state.lit = true;
    }
    for (const v of [b.inv.main]) for (let i = 0; i < v.slots.length; i++) {
      const s = v.slots[i]; if (!s || ['gun', 'melee', 'med', 'ammo', 'throw', 'armor', 'helmet', 'bag', 'food', 'drink'].includes(ITEMS[s.id].cat)) continue;
      if (['wood', 'stone', 'metal'].includes(s.id) && s.n <= 600) continue; // keep some for building
      let left = s; for (const d of this.boxes(b)) { left = d.inv.addStack(left); if (!left) break; } v.slots[i] = left;
    }
  },
  /** valuables and spare components (what the recycler turns into scrap, metal, cloth, HQM) */
  recyclables(b) {
    const keep = { pipe: 3, spring: 2, gears: 3, rope: 3, tape: 2, circuit: 2, fuse: 1 }; const out = [];
    for (const id of new Set(b.inv.main.items().map(s => s.id))) { if (!RECYCLE[id]) continue; const c = ITEMS[id].cat; const n = b.inv.count(id) - (c === 'val' ? 0 : keep[id] ?? 99); if (n > 0) out.push([id, n]); }
    return out;
  },
  recycleAll(b) {
    let n = 0; for (const [id, k] of this.recyclables(b)) { const got = b.inv.take(id, k); for (const [o, v] of Object.entries(RECYCLE[id])) b.inv.add(o, v * got); n += got; }
    b.recycled = (b.recycled || 0) + n; return n;
  },
  /** the cupboard has less than two days of upkeep and the bot can top it up */
  tcShort(b) {
    const u = Build.upkeep(b.tc);
    for (const k in u.perDay) if (b.tc.inv.count(k) < u.perDay[k] * 2 && this.have(b, k) >= Math.min(u.perDay[k], 30)) return true;
    return false;
  },
  /** top the cupboard up to ~5 days of upkeep */
  stockTc(b) {
    if (!b.tc || b.tc.dead) return 0; const u = Build.upkeep(b.tc); let moved = 0;
    for (const k in u.perDay) {
      let want = Math.ceil(u.perDay[k] * 5) - b.tc.inv.count(k); want = Math.min(want, b.tc.inv.room(k)); if (want <= 0) continue;
      let got = b.inv.take(k, want); for (const d of this.boxes(b)) if (got < want) got += d.inv.take(k, want - got);
      b.tc.inv.add(k, got); moved += got;
    }
    return moved;
  },
  // ---------------------------------------------------------------- raiding: rare, telegraphed, only with enough explosives
  raider(b) { return !b.team && ((b.persona === 'hostile' && b.rel < 0.5) || b.rel < -0.5); },
  /** satchel-equivalents a bot holds (pockets + boxes) */
  boom(b) { return this.have(b, 'satchel') + this.have(b, 'c4') * 4 + Math.floor(this.have(b, 'beancan') / 4); },
  /** satchels needed to blow a way to your cupboard (the cheapest way in), plus one spare; recomputed once a day */
  raidNeed() {
    if (!Build.tc) return Infinity;
    if (!this._need || this._need.day !== G.day || this._need.tc !== Build.tc.id || G.t - this._need.t > 240) this._need = { day: G.day, tc: Build.tc.id, t: G.t, n: Build.raidCost(Build.tc) + 1 };
    return Math.max(RAID_MIN_BOOM, this._need.n);
  },
  wantsBoom(b) { return this.raider(b) && G.day >= RAID_FIRST_DAY - 2 && !!Build.tc && this.boom(b) < this.raidNeed(); },
  /** every few seconds on the host: rumours while a raider stocks up, an announcement at dusk when one is armed */
  raidPlans() {
    if (!Build.tc || G.netGuest) return;
    const need = this.raidNeed(); if (!Number.isFinite(need)) return;
    for (const b of this.list) {
      if (b.dead || !this.raider(b)) continue; const have = this.boom(b);
      if (have >= Math.ceil(need * 0.5) && b.rumourDay !== G.day && G.day - (b.rumourDay || -99) >= 2 && have < need) {
        b.rumourDay = G.day; if (G.ui) { G.ui.chatLine && G.ui.chatLine(b.name, pick(['been crafting satchels all day', 'need a bit more sulfur', 'saving up boom for someone'])); G.ui.toast(b.name + ' is stockpiling explosives (' + have + ' satchels)…', 'bad'); }
      }
      const dusk = G.clock > 0.66 && G.clock < 0.78;
      if (have >= need && dusk && b.raidNight !== G.day && G.day >= RAID_FIRST_DAY && G.day - (b.lastRaidDay ?? -99) >= 5 && G.day - (G.run.botRaidDay ?? -99) >= 3) {
        b.raidNight = G.day; b.lastRaidDay = G.day; G.run.botRaidDay = G.day; b.raidSaid = false;
        if (G.ui) { G.ui.toast(b.name + ' has ' + have + ' satchels and is coming for your base tonight!', 'bad'); if (G.ui.banner) G.ui.banner('RAID WARNING', b.name + ' is gearing up to blow your doors tonight'); }
        if (b.actor) say(b, 'raid');
        else { const ang = rand(0, 6.28); b.x = Build.tc.x + Math.cos(ang) * 150; b.z = Build.tc.z + Math.sin(ang) * 150; if (!G.W.walkable(b.x, b.z)) { b.x = Build.tc.x + 60; b.z = Build.tc.z; } } // on the way over
      }
    }
  },
  // ---------------------------------------------------------------- acting
  act(b, a, dt) {
    const g = b.goal; if (!g) { a.speedNow = 0; return; }
    const spd = a.def.speed;
    switch (g.type) {
      case 'fight': return this.fight(b, a, g.target, dt);
      case 'pause': {
        a.speedNow = 0; g.t -= dt;
        const P = G.player; const near = P && !P.dead && dist(a.x, a.z, P.x, P.z) < 12;
        const want = near ? Math.atan2(P.z - a.z, P.x - a.x) : g.base + Math.sin(G.t * 0.8 + b.id) * 1.1;
        a.ang += clamp(angDiff(a.ang, want), -dt * 2.2, dt * 2.2);
        if (g.t <= 0) b.goal = null;
        return;
      }
      case 'flee': {
        const t = g.target; if (!t || t.dead) { b.goal = null; return; }
        const ang = Math.atan2(a.z - t.z, a.x - t.x) + Math.sin(G.t * 0.7 + b.id) * 0.5;
        steer(a, a.x + Math.cos(ang) * 8, a.z + Math.sin(ang) * 8, spd * 1.15, dt);
        if (!g.said) { g.said = true; say(b, 'flee'); }
        if (dist(a.x, a.z, t.x, t.z) > 35) { b.goal = { type: 'heal' }; }
        return;
      }
      case 'heal': { const id = b.inv.count('medkit') && a.hp < 45 ? 'medkit' : 'bandage'; if (!b.inv.count(id)) { b.goal = null; return; } if (a.st.use < 0) { a.st.use = 0; a.speedNow = 0; a.onUse = () => { b.inv.take(id, 1); a.hp = Math.min(a.maxhp, a.hp + (id === 'medkit' ? 50 : 14)); a.bleed = 0; b.goal = null; }; } a.speedNow = 0; return; }
      case 'eat': { if (!b.inv.count(g.item)) { b.goal = null; return; } if (a.st.use < 0) { a.st.use = 0; Sfx.eat(); a.onUse = () => { b.inv.take(g.item, 1); const u = ITEMS[g.item].use; b.food = Math.min(100, b.food + (u.food || 0)); b.water = Math.min(100, b.water + (u.water || 0)); b.goal = null; }; } a.speedNow = 0; return; }
      case 'drink': { if (this.walkTo(b, a, g.x, g.z, dt, 1.5)) { b.water = 100; a.st.use = 0; a.onUse = () => { b.goal = null; }; } return; }
      case 'craft': {
        const r = RECIPES.find(q => q.id === g.id); if (!r) { b.goal = null; return; }
        a.speedNow = 0;
        const ok = () => Object.entries(r.cost).every(([k, v]) => this.have(b, k) >= v * g.n);
        if (a.st.use < 0) { if (!ok()) { b.goal = null; return; } a.st.use = 0; a.onUse = () => { if (ok()) this.craftNow(b, r, g.n); b.goal = null; }; }
        return;
      }
      case 'gather': return this.gather(b, a, g, dt);
      case 'pick': {
        if (!g.target || Live.vegHidden.has(g.target.id)) { g.target = Live.vegNear(a.x, a.z, 45, new Set(['hemp', 'berry_bush', 'mushroom'])); if (!g.target) { b.goal = null; return; } }
        const v = g.target;
        if (this.walkTo(b, a, v.x, v.z, dt, 1.3)) { Live.pickVeg(v); if (v.kind === 'hemp') b.inv.add('cloth', randi(8, 12)); else if (v.kind === 'berry_bush') b.inv.add('berries', randi(2, 4)); else b.inv.add('mushroom', 2); a.st.use = 0; b.goal = null; }
        return;
      }
      case 'loot': return this.loot(b, a, g, dt);
      case 'hunt': {
        if (!g.target || g.target.dead) { g.target = null; let bd = 50 * 50; for (const o of G.actors) if (o.kind === 'animal' && !o.dead && o.def.flee !== undefined) { const d = (o.x - a.x) ** 2 + (o.z - a.z) ** 2; if (d < bd) { bd = d; g.target = o; } } if (!g.target) { b.goal = null; return; } }
        return this.fight(b, a, g.target, dt);
      }
      case 'build': return this.buildStep(b, a, dt);
      case 'deposit': {
        const box = this.boxFor(b) || (b.furnace && !b.furnace.dead ? b.furnace : null); if (!box) { b.goal = null; return; }
        if (this.walkTo(b, a, box.x, box.z, dt, 1.7, box.y)) { this.depositAll(b); a.st.use = 0; b.goal = null; }
        return;
      }
      case 'stock': { // top the cupboard up for upkeep
        const tc = b.tc; if (!tc || tc.dead) { b.goal = null; return; }
        if (this.walkTo(b, a, tc.x, tc.z, dt, 1.7, tc.y)) { this.stockTc(b); a.st.use = 0; b.goal = null; }
        return;
      }
      case 'recycle': { // take components and valuables to a monument recycler
        const u = g.u || (g.u = recyclerNear(a.x, a.z)); if (!u) { b.goal = null; return; }
        if (!this.walkTo(b, a, u.x, u.z, dt, 2.1, u.y)) return;
        a.speedNow = 0; g.t = (g.t || 0) + dt; a.st.use = g.t < 2.5 ? 0.5 : -1;
        if (g.t > 2.5) { this.recycleAll(b); this.equipBest(b); b.goal = null; }
        return;
      }
      case 'home': {
        if (!b.home) { b.goal = null; return; }
        if (!g.said && G.night > 0.6 && chance(0.3)) { g.said = true; say(b, 'night'); }
        if (this.walkTo(b, a, b.home.x, b.home.z, dt, 1.2)) {
          a.speedNow = 0; if (chance(dt * 0.3)) a.ang += rand(-1, 1);
          if (!g.fire) { g.fire = true; const cf = Build.deploys.find(d => d.owner === 'bot:' + b.id && d.type === 'campfire'); if (cf) { if (cf.inv.count('wood') < 10) cf.inv.add('wood', 30); cf.state.lit = true; } }
        }
        if (G.night < 0.4) { b.goal = null; const cf = Build.deploys.find(d => d.owner === 'bot:' + b.id && d.type === 'campfire'); if (cf) cf.state.lit = false; }
        return;
      }
      case 'follow': {
        const P = G.player; if (!P || P.dead) { b.goal = null; return; }
        const d = dist(a.x, a.z, P.x, P.z);
        if (d > 4) { const ang = Math.atan2(a.z - P.z, a.x - P.x); steer(a, P.x + Math.cos(ang) * 2.5, P.z + Math.sin(ang) * 2.5, d > 12 ? spd * 1.15 : spd * 0.8, dt); }
        else { a.speedNow = 0; a.ang += clamp(angDiff(a.ang, P.ang), -dt * 2, dt * 2); }
        if (d > 90) { a.x = P.x - Math.cos(P.ang) * 3; a.z = P.z - Math.sin(P.ang) * 3; }
        return;
      }
      case 'raid': return this.raid(b, a, dt);
      case 'move': default: {
        if (g.x === undefined) { b.goal = null; return; }
        if (!G.W.walkable(g.x, g.z)) { b.goal = null; return; }
        if (this.walkTo(b, a, g.x, g.z, dt, 2)) { if (g.explore) b.goal = { type: 'loot' }; else b.goal = null; }
        return;
      }
    }
  },
  /** walk toward a point (y: its floor height, e.g. upstairs in a base); returns true when within r. Steering paths round walls, up stairs and ladders. */
  walkTo(b, a, x, z, dt, r = 1.2, y) {
    const d = dist(a.x, a.z, x, z); if (d <= r && (y === undefined || Math.abs(y - a.y) < 1.3)) { a.speedNow = 0; b.stuck = 0; return true; }
    const ox = a.x, oz = a.z; const run = d > 14 && G.night < 0.6;
    steer(a, x, z, (run ? a.def.speed * 1.1 : a.def.speed * 0.72) * (b.pace || 1), dt, true, y);
    // hopelessly stuck (nav keeps failing): give up on this job
    const moved = Math.hypot(a.x - ox, a.z - oz);
    b.stuck = moved < dt * 0.4 && !a.climb ? (b.stuck || 0) + dt : Math.max(0, (b.stuck || 0) - dt);
    if (b.stuck > 8) { b.stuck = 0; b.goal = null; }
    return false;
  },
  gather(b, a, g, dt) {
    if (!g.target || g.target.gone || (g.target.kind && Live.vegHidden.has(g.target.id))) { g.target = nearestGather(a.x, a.z, 60, g.res); if (!g.target) { b.goal = { type: 'move', x: a.x + rand(-40, 40), z: a.z + rand(-40, 40) }; return; } this.pickWeapon(b, g.res); }
    const t = g.target; const reach = (t.type ? 0.7 * (t.s || 1) : 0.4) + 1.1;
    if (!this.walkTo(b, a, t.x, t.z, dt, reach)) return;
    a.ang += clamp(angDiff(a.ang, Math.atan2(t.z - a.z, t.x - a.x)), -dt * 8, dt * 8);
    if (a.st.swing < 0 && a.cd <= 0) {
      const tool = MELEE[a.held] || MELEE.rock; a.cd = 1 / tool.rate; a.st.swing = 0;
      a.onStrike = () => {
        const amt = GATHER_PER_HIT * (g.res === 'wood' ? tool.wood : tool.ore);
        if (t.type) { // node
          if (t.gone) return; const def = NODES[t.type]; for (const [id, k] of def.yield) b.inv.add(id, Math.max(1, Math.round(amt * k))); Live.hitNode(t, amt); Sfx.mine(t.x, t.z); if (G.fx) G.fx.chips(t.x, t.y + 0.7, t.z, t.type === 'sulfur' ? 'sulfur' : 'stone');
        } else { if (Live.vegHidden.has(t.id)) return; b.inv.add('wood', Math.max(1, Math.round(amt))); const felled = Live.hitTree(t, amt); Sfx.chop(t.x, t.z); if (G.fx) G.fx.chips(t.x, t.y + 1.1, t.z, 'wood'); if (felled) { b.inv.add('wood', Math.round(amt * 2)); Sfx.treefall(t.x, t.z); } }
      };
    }
    // enough for now?
    const want = b.plan ? 2000 : 700;
    if ((g.res === 'wood' && b.inv.count('wood') > want) || (g.res === 'ore' && b.inv.count('stone') > want * 0.8)) b.goal = null;
  },
  loot(b, a, g, dt) {
    if (!g.target || g.target.gone || (g.target.inv && g.target.inv.empty())) {
      g.target = null; let bd = 70 * 70;
      for (const c of G.containers) { if (c.gone || (c.inv && c.inv.empty()) || c.def.loot === 'airdrop' && false) continue; if (c.botLooted && G.t - c.botLooted < 300) continue; const d = (c.x - a.x) ** 2 + (c.z - a.z) ** 2; if (d < bd && !(c.mon && c.mon.def && c.mon.def.tier >= 3 && b.persona !== 'hostile')) { bd = d; g.target = c; } }
      if (!g.target) { // loot bags of the dead
        for (const d0 of G.drops) { const d = (d0.x - a.x) ** 2 + (d0.z - a.z) ** 2; if (d < 40 * 40 && !d0.inv.empty()) { g.target = { drop: d0, x: d0.x, z: d0.z }; break; } }
      }
      if (!g.target) { b.goal = null; return; }
    }
    const c = g.target;
    if (!this.walkTo(b, a, c.x, c.z, dt, 1.5)) return;
    if (c.drop) { for (let i = 0; i < c.drop.inv.slots.length; i++) { const s = c.drop.inv.slots[i]; if (s) c.drop.inv.slots[i] = b.inv.addStack(s); } this.learn(b); this.equipBest(b); b.goal = null; return; }
    if (c.def.breakable) {
      a.ang = Math.atan2(c.z - a.z, c.x - a.x);
      if (a.st.swing < 0 && a.cd <= 0) { a.cd = 0.7; a.st.swing = 0; a.onStrike = () => { c.hp -= 12; Sfx.clang(c.x, c.z); if (c.hp <= 0) { Live.breakContainer(c, a); if (chance(0.3)) say(b, 'loot'); g.target = null; g.pickup = true; } }; }
      return;
    }
    // search the crate for a moment, then take what's useful
    g.search = (g.search || 0) + dt; a.speedNow = 0; a.st.use = g.search < 1.2 ? 0.5 : -1;
    if (g.search > 1.2) {
      const inv = Live.lootOf(c); c.botLooted = G.t;
      for (let i = 0; i < inv.slots.length; i++) { const s = inv.slots[i]; if (!s) continue; if (ITEMS[s.id].cat === 'val' && chance(0.5)) continue; inv.slots[i] = b.inv.addStack(s); }
      Live.checkEmpty(c); this.learn(b); this.equipBest(b); b.looted = (b.looted || 0) + 1; g.target = null; g.search = 0;
      if (chance(0.5)) b.goal = null;
    }
    // pick up items from broken barrels nearby
    if (g.pickup) for (const d0 of G.drops) if (dist(d0.x, d0.z, a.x, a.z) < 2.5 && d0.kind === 'item') { for (let i = 0; i < d0.inv.slots.length; i++) { const s = d0.inv.slots[i]; if (s) d0.inv.slots[i] = b.inv.addStack(s); } }
  },
  fight(b, a, t, dt) {
    if (!t || t.dead) { b.goal = null; return; }
    const d = dist(a.x, a.z, t.x, t.z); const ang = Math.atan2(t.z - a.z, t.x - a.x);
    if (!a.gunStack && !MELEE[a.held]) this.pickWeapon(b);
    if (a.held === undefined || a.held === null || (!a.gunStack && b.goal.type === 'fight')) this.pickWeapon(b);
    const sees = canSee(a, t); const g = b.goal;
    // a human beat before the first shot at a new target (slower for less skilled survivors)
    if (g.react === undefined) { g.react = rand(0.35, 0.9) * (1.3 - b.skill * 0.5); a.aimK = Math.min(a.aimK || 0, 0.15); }
    g.react -= dt; trackAim(a, t, sees, dt);
    if (a.gunStack) {
      const W = WEAPONS[a.gunStack.id]; const [near, far] = W.pellets ? [3, 8] : W.range > 35 ? [12, 26] : W.arrow ? [7, 18] : [6, 15];
      // reloading: duck behind something if there is anything close
      if (a.st.reload >= 0 && !g.cover && (g.coverT = (g.coverT || 0) - dt) <= 0) { g.coverT = 2; g.cover = findCover(a, t, 9); }
      if (g.cover) {
        const cd = steer(a, g.cover.x, g.cover.z, a.def.speed * (b.pace || 1), dt, false);
        a.ang += clamp(angDiff(a.ang, ang), -dt * 5, dt * 5);
        if (cd < 0.7) a.speedNow = 0;
        if ((a.st.reload < 0 && cd < 0.7) || G.t - g.cover.t > 7) g.cover = null;
      } else {
        // reposition for a moment, then plant and shoot
        if ((b.strafeT = (b.strafeT || 0) - dt) <= 0) { b.moving = !b.moving; b.strafeT = b.moving ? rand(0.7, 1.8) : rand(0.9, 2.4); b.strafe = chance(0.5) ? 1 : -1; }
        let mx = 0, mz = 0;
        const upDown = Math.abs((t.y ?? a.y) - a.y) > 1.5;
        if (!sees || upDown) { steer(a, t.x, t.z, a.def.speed * 0.95 * (b.pace || 1), dt, !sees, t.y); a.ang += clamp(angDiff(a.ang, ang), -dt * 6, dt * 6); return this.fireAt(b, a, t, W, d, sees, ang, far); }
        if (d > far) { mx = Math.cos(ang); mz = Math.sin(ang); } else if (d < near) { mx = -Math.cos(ang); mz = -Math.sin(ang); }
        if (sees && b.moving) { mx += Math.cos(ang + Math.PI / 2) * b.strafe * 0.8; mz += Math.sin(ang + Math.PI / 2) * b.strafe * 0.8; }
        const sp = d > far || !sees ? 0.85 : b.moving ? 0.7 : 0.3;
        const ml = Math.hypot(mx, mz); if (ml > 0.01) moveActor(a, mx / ml * a.def.speed * sp * dt, mz / ml * a.def.speed * sp * dt, dt); else a.speedNow = 0;
        a.ang += clamp(angDiff(a.ang, ang), -dt * 6, dt * 6);
      }
      return this.fireAt(b, a, t, W, d, sees, ang, far);
    }
    // melee
    const M0 = MELEE[a.held] || MELEE.rock; const reach = M0.reach + t.r + 0.1; const level = Math.abs((t.y ?? a.y) - a.y) < 1.5;
    if (d > reach * 0.85 || !level) steer(a, t.x, t.z, a.def.speed * 1.08, dt, true, t.y); else { a.speedNow = 0; a.ang += clamp(angDiff(a.ang, ang), -dt * 10, dt * 10); }
    if (level && d < reach + 0.2 && a.cd <= 0 && a.st.swing < 0) {
      a.cd = 1 / M0.rate; a.st.swing = 0;
      a.onStrike = () => { if (!t.dead && dist(a.x, a.z, t.x, t.z) < reach + 0.5) { hurt(t, M0.dmg, { owner: a, dir: Math.atan2(t.z - a.z, t.x - a.x), kind: 'melee', bleed: 0.2 }); Sfx.hit(t.x, t.z); } };
    }
  },
  /** pull the trigger when it makes sense (reload, run dry, settle the aim) */
  fireAt(b, a, t, W, d, sees, ang, far) {
    const g = b.goal;
    if (a.st.reload >= 0) return;
    if ((a.gunStack.ammo || 0) <= 0) { if (b.inv.count(W.ammo) > 0) { a.st.reload = 0; a.reloadTime = W.reload; Sfx.reload(); } else { a.gunStack = null; this.pickWeapon(b, 'melee'); } return; }
    if (sees && g && g.react <= 0 && a.cd <= 0 && Math.abs(angDiff(a.ang, ang)) < 0.15 && d < W.range) {
      if (b.moving && d < far && chance(0.4)) { a.cd = rand(0.15, 0.35); return; } // hard to shoot well on the move
      // survivors shoot like people: a bit worse than they used to, best when planted and settled
      const e = aimError(a, t, (1.1 - b.skill * 0.85) * 0.48);
      fireWeapon(a, a.gunStack.id, a.ang + e.yaw, { target: t, pitchErr: e.pitch }); a.gunStack.ammo--; a.cd = 1 / (W.rof * (W.auto ? 0.8 : 0.65)) + (W.auto ? 0 : rand(0.05, 0.35));
      if (W.auto && chance(0.22)) a.cd += rand(0.35, 0.8);
    }
  },
  finishReload(b) { const s = b.actor && b.actor.gunStack; if (!s) return; const W = WEAPONS[s.id]; const got = b.inv.take(W.ammo, W.mag - (s.ammo || 0)); s.ammo = (s.ammo || 0) + got; },
  raid(b, a, dt) {
    const tc = Build.tc; if (!tc || G.night < 0.4) { b.goal = null; return; }
    if (!b.raidSaid) { b.raidSaid = true; say(b, 'raid'); }
    const step = Build.ffStep(a.x, a.z);
    if (!step) { this.walkTo(b, a, tc.x, tc.z, dt, 2, tc.y); return; }
    if (step.block) {
      const tx = step.tx, tz = step.tz; if (dist(a.x, a.z, tx, tz) > 4) { steer(a, tx, tz, a.def.speed, dt); return; }
      const ex = ['c4', 'satchel', 'beancan'].find(id => b.inv.count(id)) || ['c4', 'satchel', 'beancan'].find(id => this.have(b, id) && (this.pay(b, id, 1), b.inv.add(id, 1), true));
      if (ex && a.cd <= 0) { b.inv.take(ex, 1); a.st.throw = 0; a.ang = Math.atan2(tz - a.z, tx - a.x); const t = throwItem(a, ex, tx, tz); if (t) t.dud = false; a.cd = 6; b.retreat = 2.5; b.thrown = (b.thrown || 0) + 1; if (chance(0.5)) say(b, 'raid'); }
      else if (!ex) { b.raidNight = -1; b.goal = { type: 'home' }; return; }
      if (b.retreat > 0) { b.retreat -= dt; steer(a, a.x - (tx - a.x), a.z - (tz - a.z), a.def.speed, dt, false); } else a.speedNow = 0;
      return;
    }
    if (Math.abs(tc.y - a.y) > 1.2 && dist(a.x, a.z, tc.x, tc.z) < 9) steer(a, tc.x, tc.z, a.def.speed, dt, true, tc.y);
    else { const ah = Build.ffAhead(a.x, a.z, 7); if (ah) steer(a, ah.x, ah.z, a.def.speed, dt); else steer(a, a.x + step.dx * 2, a.z + step.dz * 2, a.def.speed, dt); }
    if (dist(a.x, a.z, tc.x, tc.z) < 2 && Math.abs(tc.y - a.y) < 1.2 && a.cd <= 0) { a.cd = 0.8; a.st.swing = 0; a.onStrike = () => damageStruct(tc, 20, 'raider'); }
  },
  // ---------------------------------------------------------------- base building
  // A 2x2 house that grows: A B / C D (door on C's south side). Stage 1: the house, cupboard, box, bag,
  // floors over A B C (D is left open for the stairs); 2: stairs in D, a second storey with a workbench,
  // a furnace; 3: stone; 4: an annex east of B / D with a big box, joined through a doorway; 5: sheet metal
  // and a metal door. Steps are idempotent (pieces already there are skipped) and lost pieces get rebuilt.
  findSite(b, a) {
    for (let k = 0; k < 40; k++) {
      const ang = rand(0, 6.28), r = rand(10, 70); const x = a.x + Math.cos(ang) * r, z = a.z + Math.sin(ang) * r;
      const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
      if (!G.W.walkable(x, z) || G.W.isWater(x, z) || G.W.isRoad(x, z)) continue;
      if (G.monuments.some(m => dist(m.x, m.z, x, z) < m.size + 30)) continue;
      if (Build.tc && dist(Build.tc.x, Build.tc.z, x, z) < 70) continue;
      if (this.list.some(o => o !== b && o.home && dist(o.home.x, o.home.z, x, z) < 50)) continue;
      // 2x2 must be valid foundations (and the annex cells should be free ground)
      let ok = true; for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const c = Build.check('foundation', { ci: ci + di, cj: cj + dj }, 'bot'); if (!c.ok) { ok = false; break; } }
      if (!ok) continue;
      const P = (t, ci2, cj2, o = {}) => Object.assign({ t, ci: ci + ci2, cj: cj + cj2 }, o), E = (t, e, di, dj, st = 0) => ({ t, edge: e, ci: ci + di, cj: cj + dj, st });
      const steps = [];
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) steps.push(P('foundation', di, dj));
      steps.push({ t: 'tc', x: (ci + 1) * CELL + 2.2, z: cj * CELL + 0.9 });
      const walls = [E('wall', 'h', 0, 0), E('wall', 'h', 1, 0), E('doorway', 'h', 0, 2), E('wall', 'h', 1, 2), E(chance(0.5) ? 'window' : 'wall', 'v', 0, 0), E('wall', 'v', 0, 1), E('wall', 'v', 2, 0), E('wall', 'v', 2, 1)];
      steps.push(...walls, { t: 'door_wood', edge: 'h', ci, cj: cj + 2 });
      steps.push({ t: 'box_small', x: ci * CELL + 1.0, z: cj * CELL + 0.8 }, { t: 'sleeping_bag', x: ci * CELL + 0.8, z: (cj + 1) * CELL + 1.4, ry: Math.PI / 2 });
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1]]) steps.push(P('ceiling', di, dj));
      const cx = (ci + 1) * CELL, cz = (cj + 1) * CELL;
      steps.push({ t: 'campfire', x: cx + 2, z: cz + 4.6 }, { t: 'upgrade', tier: 'wood' });
      return { ci, cj, cx, cz, stage: 1, steps };
    }
    return null;
  },
  /** grow the base when it's time (and the bot can afford it) */
  nextStage(b) {
    const P0 = b.plan, ci = P0.ci, cj = P0.cj, d0 = G.day - (b.spawnDay || 1), add = (...s) => { P0.steps.push(...s); P0.stage++; };
    const E = (t, e, di, dj, st = 0) => ({ t, edge: e, ci: ci + di, cj: cj + dj, st }), C = (t, di, dj, st = 0, o = {}) => Object.assign({ t, ci: ci + di, cj: cj + dj, st }, o);
    if (P0.stage === 1 && d0 >= 1 && this.have(b, 'wood') >= 800) {
      const up = Build.floorBase(ci, cj, 1);
      add(C('stairs', 1, 1, 0, { dir: 3 }), E('wall', 'h', 0, 0, 1), E('wall', 'h', 1, 0, 1), E('window', 'h', 0, 2, 1), E('wall', 'h', 1, 2, 1), E('wall', 'v', 0, 0, 1), E('wall', 'v', 0, 1, 1), E('window', 'v', 2, 0, 1), E('wall', 'v', 2, 1, 1),
        C('ceiling', 0, 0, 1), C('ceiling', 1, 0, 1), C('ceiling', 0, 1, 1), C('ceiling', 1, 1, 1),
        { t: 'furnace', x: ci * CELL + 1.5, z: cj * CELL - 1.6 }, { t: 'workbench1', x: ci * CELL + 1.5, z: (cj + 1) * CELL + 1.4, y: up != null ? up + 0.1 : undefined }, { t: 'upgrade', tier: 'wood' });
    } else if (P0.stage === 2 && d0 >= 2) add({ t: 'upgrade', tier: 'stone' });
    else if (P0.stage === 3 && d0 >= 3) {
      if (!Build.check('foundation', { ci: ci + 2, cj }, 'bot').ok || !Build.check('foundation', { ci: ci + 2, cj: cj + 1 }, 'bot').ok) { P0.stage = 4; return; } // no room for an annex
      add(C('foundation', 2, 0), C('foundation', 2, 1), { t: 'replace', edge: 'v', ci: ci + 2, cj: cj + 1, st: 0, to: 'doorway' }, E('wall', 'h', 2, 0), E('wall', 'h', 2, 2), E('wall', 'v', 3, 0), E('window', 'v', 3, 1),
        C('ceiling', 2, 0), C('ceiling', 2, 1), { t: 'box_large', x: (ci + 2) * CELL + 1.5, z: cj * CELL + 0.9 }, { t: 'upgrade', tier: 'stone' });
    } else if (P0.stage === 4 && d0 >= 5 && this.have(b, 'metal') >= 600) add({ t: 'upgrade', tier: 'metal' }, { t: 'door_metal', edge: 'h', ci, cj: cj + 2 });
    else if (P0.stage === 5 && this.have(b, 'hqm') >= 20 && this.have(b, 'metal') >= 500 && this.have(b, 'scrap') >= 300) add({ t: 'workbench2', x: (ci + 2) * CELL + 1.5, z: (cj + 1) * CELL + 1.5 });
  },
  stepCost(b, st) {
    if (st.t === 'upgrade') { const o = {}; for (const p of this.myPieces(b)) if (PIECES[p.type] && TIERS.indexOf(p.tier) < TIERS.indexOf(st.tier)) for (const [k, v] of Object.entries(Build.costOf(p.type, st.tier))) o[k] = (o[k] || 0) + v; return o; }
    if (st.t === 'replace') return Build.costOf(st.to, 'twig');
    return Build.costOf(st.t, 'twig');
  },
  myPieces(b) { const o = this.ownerOf(b); return Build.allPieces().filter(p => p.owner === o && !p.dead); },
  /** the thing a step makes, if it's there: a piece / deployable / door, or null */
  stepThing(b, st) {
    const owner = this.ownerOf(b), s = st.st || 0;
    if (st.t === 'foundation') return Build.found(st.ci, st.cj);
    if (st.t === 'ceiling') return Build.ceilAt(st.ci, st.cj, s);
    if (st.t === 'stairs') return Build.stairAt(st.ci, st.cj, s);
    if (st.t === 'replace') { const p = Build.edge(st.edge, st.ci, st.cj, s); return p && p.type === st.to ? p : null; }
    if (DOORS[st.t]) { const p = Build.edge(st.edge, st.ci, st.cj, s); return p && p.door && !p.door.dead && (p.door.kind === st.t || (st.t === 'door_wood' && p.door.kind !== 'door_wood')) ? p.door : null; }
    if (PIECES[st.t]) return Build.edge(st.edge, st.ci, st.cj, s) || null;
    if (DEPLOY[st.t]) return Build.deploys.find(d => d.owner === owner && d.type === st.t && !d.dead && (d.x - st.x) ** 2 + (d.z - st.z) ** 2 < 1.5) || null;
    return null;
  },
  /** lost pieces (decay, raids) get rebuilt: wind the plan back to the first thing that's missing */
  recheck(b) {
    const P0 = b.plan; if (!P0) return; const owner = this.ownerOf(b);
    for (let k = 0; k < Math.min(b.planI, P0.steps.length); k++) {
      const st = P0.steps[k]; if (st.t === 'upgrade' || this.stepThing(b, st)) continue;
      if (b.skipped && b.skipped.includes(k) && !Object.entries(this.stepCost(b, st)).every(([r, v]) => this.have(b, r) >= v)) continue; // still can't afford what we gave up on
      if (DOORS[st.t]) { const p = Build.edge(st.edge, st.ci, st.cj, st.st || 0); if (!p || p.type !== 'doorway') continue; }
      else if (st.t !== 'replace' && !Build.check(st.t, this.stepTarget(st), owner).ok) continue;
      b.planI = k; b.rebuilt = (b.rebuilt || 0) + 1; return;
    }
  },
  stepTarget(st) { return st.ci !== undefined ? (DOORS[st.t] ? { piece: Build.edge(st.edge, st.ci, st.cj, st.st || 0) } : { ci: st.ci, cj: st.cj, edge: st.edge, st: st.st || 0, dir: st.dir }) : { x: st.x, z: st.z, ry: st.ry || 0, y: st.y }; },
  buildStep(b, a, dt) {
    const P = b.plan; const st = P.steps[b.planI]; if (!st) { b.goal = null; return; }
    const tx = st.x ?? (st.ci !== undefined ? st.ci * CELL + 1.5 : P.cx), tz = st.z ?? (st.cj !== undefined ? st.cj * CELL + 1.5 : P.cz);
    if (!this.walkTo(b, a, P.cx + (tx - P.cx) * 0.3 + 2.5, P.cz + (tz - P.cz) * 0.3 + 3.8, dt, 2.4) && dist(a.x, a.z, tx, tz) > 6) return;
    a.ang += clamp(angDiff(a.ang, Math.atan2(tz - a.z, tx - a.x)), -dt * 6, dt * 6); a.speedNow = 0;
    if (a.cd > 0 || a.st.swing >= 0) return;
    a.cd = 1.1; a.st.swing = 0;
    a.onStrike = () => {
      const ok = this.placeStep(b, st);
      if (ok !== null) { b.planI++; if (ok && chance(0.15)) say(b, 'build'); }
    };
  },
  /** returns true placed (or already there), false skipped (invalid), null = wait (missing resources) */
  placeStep(b, st) {
    const owner = this.ownerOf(b);
    const cost = this.stepCost(b, st);
    const afford = () => Object.entries(cost).every(([k, v]) => this.have(b, k) >= v);
    const payAll = () => { for (const [k, v] of Object.entries(cost)) this.pay(b, k, v); };
    if (st.t === 'upgrade') {
      const mine = this.myPieces(b).filter(p => PIECES[p.type] && TIERS.indexOf(p.tier) < TIERS.indexOf(st.tier));
      if (!mine.length) return true; if (!afford()) return null; payAll(); for (const p of mine) Build.upgrade(p, st.tier, true); b.upgraded = st.tier; Sfx.upgrade(); return true;
    }
    const th = this.stepThing(b, st); if (th) { this.link(b, st.t, th); return th.owner === undefined || th.owner === owner || th.sk === 'door'; }
    if (st.t === 'replace') {
      const p = Build.edge(st.edge, st.ci, st.cj, st.st || 0); if (p && p.owner !== owner) return false;
      if (!afford()) return null; if (p) Build.destroy(p, true);
      const r = Build.place(st.to, { edge: st.edge, ci: st.ci, cj: st.cj, st: st.st || 0 }, 'twig', owner); if (!r) return false; payAll(); return true;
    }
    if (DOORS[st.t]) {
      const p = Build.edge(st.edge, st.ci, st.cj, st.st || 0); if (!p || p.type !== 'doorway' || p.owner !== owner) return false;
      if (!afford()) return null; payAll(); if (p.door && !p.door.dead) { removeDoor(p.door); p.door = null; }
      Build.placeDoor(st.t, p, owner); Sfx.build(); return true;
    }
    const t = this.stepTarget(st);
    const chk = Build.check(st.t, t, owner); if (!chk.ok) return false;
    if (!afford()) return null;
    payAll(); const r = Build.place(st.t, t, 'twig', owner, {}); if (!r) return false;
    this.link(b, st.t, r); if (st.t === 'campfire') r.inv.add('wood', 40);
    Sfx.build(); return true;
  },
  link(b, t, r) { if (t === 'tc') b.tc = r; if (t === 'box_small') b.box = r; if (t === 'box_large') b.box2 = r; if (t === 'sleeping_bag') b.bag = r; if (t === 'furnace') b.furnace = r; },
  // ---------------------------------------------------------------- far away: cheap progress
  abstract(b, dt) {
    b.at = (b.at || 0) + dt; if (b.at < 2) return; const step = b.at; b.at = 0;
    this.abstractStep(b, step);
  },
  abstractStep(b, step) {
    const night = G.night > 0.55, raidNow = night && b.raidNight === G.day && Build.tc && this.boom(b) > 0;
    const goHome = night && b.home && !raidNow;
    // move toward a work spot / home (raiders: toward your base)
    const tgt = raidNow ? { x: Build.tc.x, z: Build.tc.z } : goHome ? b.home : b.plan ? { x: b.plan.cx, z: b.plan.cz } : b.wander || (b.wander = { x: b.x + rand(-60, 60), z: b.z + rand(-60, 60) });
    const d = dist(b.x, b.z, tgt.x, tgt.z);
    if (d > 3) { const k = Math.min(1, 3.4 * step / d); const nx = b.x + (tgt.x - b.x) * k, nz = b.z + (tgt.z - b.z) * k; if (G.W.walkable(nx, nz) && !G.W.isWater(nx, nz)) { b.x = nx; b.z = nz; } else b.wander = null; }
    else if (!b.plan) b.wander = null;
    b.food = Math.max(20, b.food - step * 0.05); b.water = Math.max(20, b.water - step * 0.06);
    if (goHome || raidNow) return;
    const inv = b.inv, atHome = !!b.plan && d < 10;
    // gather (better tools gather more), scavenge crates / roadside barrels / monuments by gear
    const axe = inv.count('salv_axe') ? 1.6 : inv.count('hatchet') ? 1 : 0.45, pk = inv.count('salv_pick') ? 1.6 : inv.count('pickaxe') ? 1 : 0.45;
    if (this.have(b, 'wood') < 4000) inv.add('wood', Math.round(9 * axe * step));
    if (this.have(b, 'stone') < 4000 && chance(0.5)) inv.add('stone', Math.round(7 * pk * step));
    if (chance(0.35)) inv.add('metal_ore', Math.round(2.4 * pk * step));
    if (this.wantsBoom(b) && chance(0.45)) inv.add('sulfur_ore', Math.round(2.2 * pk * step));
    if (chance(0.06 * step)) inv.add('cloth', randi(6, 12));
    if (chance(0.025 * step)) inv.add('leather', randi(3, 6));
    if (chance(0.03 * step)) { const g = this.gearLevel(b); const tbl = g >= 2 && chance(0.4) ? 'military' : chance(0.45) ? 'barrel' : chance(0.35) ? 'toolbox' : 'crate'; rollInto(inv.main, LOOT[tbl], 0); this.learn(b); b.looted = (b.looted || 0) + 1; this.equipBest(b); }
    // smelting at home (or charcoal from a campfire)
    if (b.furnace && !b.furnace.dead) { for (const [o, out] of [['metal_ore', 'metal'], ['sulfur_ore', 'sulfur'], ['hqm_ore', 'hqm']]) { const k = Math.min(inv.count(o), Math.round(3 * step)); if (k > 0 && inv.count('wood') > 50) { inv.take(o, k); inv.add(out, k); inv.take('wood', Math.ceil(k / 4)); inv.add('charcoal', Math.ceil(k / 2)); } } }
    else if (this.wantsBoom(b) && chance(0.3)) inv.add('charcoal', Math.round(step));
    // a trip to a recycler now and then
    if (this.recyclables(b).length >= 3 && chance(0.02 * step)) this.recycleAll(b);
    // gear
    const cr = this.nextCraft(b); if (cr) this.craftNow(b, cr);
    // the base
    if (!b.plan && inv.count('wood') >= 500 && G.day >= (b.spawnDay || 1)) { const site = this.findSite(b, { x: b.x, z: b.z }); if (site) { b.plan = site; b.planI = 0; b.home = { x: site.cx, z: site.cz }; } }
    if (b.plan) {
      if ((b.recheckT = (b.recheckT || 0) - step) <= 0) { b.recheckT = 30; this.recheck(b); }
      if (b.planI >= b.plan.steps.length) this.nextStage(b);
      if (atHome && b.planI < b.plan.steps.length) { const r = this.placeStep(b, b.plan.steps[b.planI]); if (r !== null) { b.planI++; b.waitT = 0; } else if ((b.waitT = (b.waitT || 0) + step) > 300) { (b.skipped = b.skipped || []).push(b.planI); b.planI++; b.waitT = 0; } } // stuck on a rare material: move on, a recheck comes back to it
    }
    if (atHome) { if (b.tc && !b.tc.dead && this.tcShort(b)) this.stockTc(b); if ((b.depT = (b.depT || 0) - step) <= 0 || inv.main.slots.filter(Boolean).length > 18) { b.depT = 60; this.depositAll(b); } }
  },
  /** test / debug hook: run every survivor's far-away life for `days` in-game days at once */
  fastForward(days, step = 10) {
    for (const b of this.list) if (b.actor && !b.team) this.dematerialize(b);
    const total = days * UPKEEP.daySecs; let t = 0;
    while (t < total) {
      t += step; G.t += step;
      const prev = G.clock, nightNow = G.clock > 0.79 || G.clock < 0.21; G.clock += step / 720 * (nightNow ? 2 : 1); if (G.clock >= 1) G.clock -= 1; // as Game.updateTime (720 s days, nights twice as fast)
      if (prev < 0.25 && G.clock >= 0.25) { G.day++; if (G.run) G.run.day = G.day; Build.dawn(); }
      G.night = G.clock > 0.78 || G.clock < 0.22 ? 1 : 0;
      for (const b of this.list) { if (b.dead) { if (G.t >= b.respawnAt) this.respawn(b); continue; } if (!b.actor) this.abstractStep(b, step); }
      if ((this._ffT = (this._ffT || 0) + step) >= 30) { this._ffT = 0; Build.tickUpkeep(30); this.raidPlans(); }
    }
  },
  /** someone opened a survivor's box or cupboard: they don't like that */
  onBaseLooted(b, d, by) {
    if (by !== G.player) return;
    b.rel = Math.max(-1, b.rel - 0.35); b.robbed = (b.robbed || 0) + 1; b.robbedT = G.t;
    if (b.actor && !b.actor.dead && dist(b.actor.x, b.actor.z, d.x, d.z) < 60) { b.threat = G.player; b.threatT = G.t; b.hitByPlayer = G.t; say(b, 'angry'); }
  },
  // ---------------------------------------------------------------- talking to the player
  talk(b) {
    const a = b.actor; if (!a) return;
    a.ang = Math.atan2(G.player.z - a.z, G.player.x - a.x);
    G.ui.botDialog(b);
  },
  gift(b, id, n) { b.inv.add(id, n); b.rel = Math.min(1, b.rel + 0.25); say(b, 'gift'); this.equipBest(b); },
  askTeam(b) {
    if (b.team) { b.team = false; if (b.actor) b.actor.team = 'bot:' + b.id; G.ui.say(b.actor, b.name, 'ok, see ya'); return false; }
    const teamSize = this.list.filter(o => o.team).length;
    if (b.rel >= 0.6 && b.persona !== 'hostile' && teamSize < 2) { b.team = true; if (b.actor) b.actor.team = 'player'; say(b, 'team'); return true; }
    G.ui.say(b.actor, b.name, b.persona === 'hostile' ? 'lol no' : b.rel < 0.2 ? 'i dont even know you' : 'maybe later'); return false;
  },
};

// ---------------------------------------------------------------- helpers
function nearestGather(x, z, r, res) {
  if (res === 'sulfur') { let best = null, bd = r * 2 * r * 2; for (const n of G.nodes) { if (n.gone || n.type !== 'sulfur') continue; const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; } } if (best) return best; res = 'ore'; }
  if (res === 'ore') { let best = null, bd = r * r; for (const n of G.nodes) { if (n.gone) continue; const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; } } return best; }
  const v = Live.vegNear(x, z, r, TREE_KINDS); return v && v.kind !== 'cactus' ? v : null;
}
function findWater(x, z) { let best = null, bd = 120 * 120; for (const l of G.W.lakes) { const d = (l.x - x) ** 2 + (l.z - z) ** 2; if (d < bd) { bd = d; const ang = Math.atan2(z - l.z, x - l.x); best = { x: l.x + Math.cos(ang) * (l.r + 0.5), z: l.z + Math.sin(ang) * (l.r + 0.5) }; } } return best; }
function recyclerNear(x, z) { let best = null, bd = 380 * 380; for (const u of G.uses) { if (u.type !== 'recycler') continue; const d = (u.x - x) ** 2 + (u.z - z) ** 2; if (d < bd) { bd = d; best = u; } } return best; }
/** a barrel along a road (they line the roads) not looted lately */
function roadsideBarrel(x, z) { let best = null, bd = 180 * 180; for (const c of G.containers) { if (c.gone || !c.def.breakable || c.mon || (c.botLooted && G.t - c.botLooted < 300)) continue; const d = (c.x - x) ** 2 + (c.z - z) ** 2; if (d < bd && G.W.isRoad && G.W.isRoad(c.x, c.z, 6)) { bd = d; best = c; } } return best; }
function nearestMon(x, z, maxTier) { let best = null, bd = 260 * 260; for (const m of G.monuments) { if (m.def.tier > maxTier || m.def.safe) continue; const d = (m.x - x) ** 2 + (m.z - z) ** 2; if (d < bd) { bd = d; best = m; } } return best; }

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
import { ITEMS, RECIPES, RECIPE, RECYCLE, WEAPONS, MELEE, NODES, GATHER_PER_HIT, LOOT, CELL, TIERS, PIECES, DOORS, DEPLOY, UPKEEP, THROWN } from './data.js';
import { removeDoor } from './doors.js';
import { PlayerInv, Inv } from './inventory.js';
import { spawnActor, removeActor, moveActor, settleY, airborne } from './actors.js';
import { steer, canSee, aimError, trackAim, findCover } from './ai.js';
import { Nav } from './nav.js';
import { fireWeapon, hurt, throwItem, damageStruct } from './combat.js';
import { Build } from './build.js';
import { Live, rollInto } from './world/live.js';
import { WORLD, WATER_Y } from './world/gen.js';
import { DECK, DOCK_TIME, HACK_T } from './cargo.js';
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
  crafted: ['finally made a {g}', 'new toy: {g}', 'crafted a {g} :)', 'who wants to meet my {g}'],
  boom: ['cooking some boom', 'beancans ready', 'sulfur well spent', 'got some explosives in the box'],
  nade: ['nade out!', 'grenade!', 'catch', 'fire in the hole'],
  stash: ['bag is full, heading home', 'stashing my loot', 'gotta empty my pockets', 'base run, brb'],
  baseHit: { friendly: ['my BASE?? i thought we were friends', 'you blew up my house?!', 'seriously?? we were cool', 'ok thats it. war'], neutral: ['who is blowing up my base', 'my walls!!', 'you just made an enemy', 'oh its ON now'], hostile: ['ur dead for that', 'nice try raider', 'big mistake, coming home'] },
  defend: ['raid!! heading home', 'get off my base', 'defend the base!', 'im coming for you'],
  help: ['on my way, hold on', 'who hit our base?', 'coming to help!', 'nobody raids my crew'],
  grudge: ['you blew up my base. remember?', 'i havent forgotten', 'you owe me a wall', 'raider. get lost'],
  mon: ['heading to the {m}, wish me luck', 'gonna run the {m}', 'anyone at the {m}? going in', 'kitted up, doing the {m}'],
  monOk: ['made it out of the {m} :)', 'good loot at the {m}', 'cleared the {m}', 'the {m} was worth it'],
  monBad: ['got wrecked at the {m}', 'too hot at the {m}, im out', 'nope, the {m} is cursed', 'out of ammo at the {m} lol'],
  event: { airdrop: ['drop!! mine', 'going for the airdrop', 'that drop is mine'], drop: ['locked crate is down, going for it', 'who wants the locked crate? me'], cargo: ['cargo ship is in, boarding', 'cargo run, wish me luck'], rig: ['taking a boat out to the rig', 'doing the oil rig'], wreck: ['the apc is dead? looting it', 'wreck loot!'], apc: ['rockets ready, going for the apc', 'that apc is going down'] },
  eventOk: ['got the {e} :)', 'ez {e}', 'thanks for the loot', '{e} done'],
  eventBad: ['lost the {e}', 'nope, too many of them', 'im out, too hot'],
  hack: ['hacking the crate, cover me', 'hack started', 'two minutes, here we go'],
};
const RAID_FIRST_DAY = 5;   // no survivor raids before this day
const RAID_MIN_BOOM = 2;    // and never with fewer than this many satchels
const STOCK_CAP = { wood: 1500, stone: 1500 }; // least wood / stone a bot stockpiles before it stops farming it (Bots.cap)
const METAL_PLENTY = 4000;  // metal it's happy to sit on (ore keeps its own logic below that: what crafting and the base want)
const BASE_R = 11;          // a bot base's footprint around its centre (the house and its annex)
const DEFEND_R = 420;       // a survivor this close to home comes back when someone blows up its base
const DEFEND_T = 150;       // ...and keeps defending it this long after the last blast
const GRUDGE_DAYS = 2;      // days it stays hostile to the players after that, whatever its mood
const TRIP_MAX = 4;         // survivors out on monument runs / events at once
const DANGER = { airdrop: 1.2, drop: 2.6, cargo: 2.4, rig: 3.6, wreck: 1, apc: 3 }; // events, on the gear scale (monuments: their tier)
const EV_NAME = { airdrop: 'airdrop', drop: 'locked crate', cargo: 'cargo ship', rig: 'oil rig', wreck: 'APC wreck', apc: 'APC' };
const CRATE_VAL = { locked_crate: 7, airdrop: 7, elite: 6, military: 5, ammobox: 3.5, cache: 3, toolbox: 2.5, medbox: 2, crate: 2, locker: 2, food: 1 };
const KEEP = { bandage: 5, medkit: 3, stim: 2, antirad: 2, water_bottle: 2, beancan: 3, grenade: 2, c4: 1, supply_signal: 1 }; // kit it keeps in its pockets
/** a line from LINES[cat] (persona / kind sub-list, {x} filled from vars) */
function line(cat, sub, vars) {
  const L = LINES[cat]; const arr = Array.isArray(L) ? L : (L[sub] || L.neutral || Object.values(L)[0]);
  let s = pick(arr); if (vars) s = s.replace(/\{(\w)\}/g, (_, k) => vars[k] ?? ''); return s;
}
const say = (b, cat, persona, vars) => { if (b.actor && G.ui && G.ui.say) G.ui.say(b.actor, b.name, line(cat, persona, vars)); b.sayT = rand(8, 18); };
/** how good a gun is in a real fight: sustained damage (magazines and reloads) weighted by its range. Rockets: 0. */
const GSC = new Map();
function gunScore(id) {
  let s = GSC.get(id); if (s !== undefined) return s;
  const W = WEAPONS[id]; s = 0;
  if (W && !W.rocket) s = W.dmg * (W.pellets || 1) * W.mag / (W.mag / W.rof + W.reload) * clamp(0.55 + W.range / 60, 0.7, 1.4);
  GSC.set(id, s); return s;
}
let GUN_R = null, AMMO_U = null;
const gunRecipes = () => GUN_R || (GUN_R = RECIPES.filter(r => WEAPONS[r.out] && !WEAPONS[r.out].rocket));
const ammoUsed = () => AMMO_U || (AMMO_U = new Set(Object.values(WEAPONS).flatMap(W => [W.ammo, W.alt]).filter(Boolean)));

let BID = 1;
export const Bots = {
  list: [],
  reset() { for (const b of this.list) if (b.actor) removeActor(b.actor); this.list = []; BID = 1; this._ev = null; this.chatT = -99; },
  init(saved) {
    this.reset();
    if (saved && saved.length) { for (const s of saved) this.list.push(this.restore(s)); if (this.list.every(b => b.crew === undefined)) this.assignCrews(); return; }
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
    this.assignCrews();
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
    if (b.grudge === null) delete b.grudge; if (b.crew === null) delete b.crew;
    BID = Math.max(BID, b.id + 1); return b;
  },
  serialize() { return this.list.map(b => ({ id: b.id, name: b.name, persona: b.persona, look: b.look, rel: b.rel, inv: b.inv.toJSON(), x: b.actor ? b.actor.x : b.x, z: b.actor ? b.actor.z : b.z, hp: b.actor ? b.actor.hp : b.hp, food: b.food, water: b.water, home: b.home, plan: b.plan, planI: b.planI, dead: b.dead, respawnAt: b.respawnAt, team: b.team, kills: b.kills, skill: b.skill, spawnDay: b.spawnDay, bps: b.bps || [], lastRaidDay: b.lastRaidDay ?? null, raidNight: b.raidNight ?? null, rumourDay: b.rumourDay ?? null, robbed: b.robbed || 0, crafted: b.crafted || 0, recycled: b.recycled || 0, looted: b.looted || 0,
    crew: b.crew ?? null, grudge: b.grudge ? { day: b.grudge.day, n: b.grudge.n } : null, raided: b.raided || 0, trips: b.trips || 0, monRuns: b.monRuns || 0, evRuns: b.evRuns || 0 })); },
  ownerOf(b) { return 'bot:' + b.id; },
  byOwner(o) { return this.list.find(b => 'bot:' + b.id === o) || null; },
  /** a line out loud (speech bubble) when it's near, else now and then in the chat log like a far-away player (p = chance) */
  speak(b, cat, sub, vars, p = 1) {
    if (b.actor) { say(b, cat, sub, vars); return; }
    if (!chance(p) || !G.ui || !G.ui.chatLine || G.netGuest) return;
    if (G.t - (this.chatT ?? -99) < 35 && G.t >= (this.chatT ?? -99)) return; // one far-away line at a time
    this.chatT = G.t; G.ui.chatLine(b.name, line(cat, sub, vars));
  },
  // ---------------------------------------------------------------- relations
  /** a fresh grudge: you blew up its base (or its crew's) in the last couple of days */
  grudging(b) { return !!(b.grudge && G.day - b.grudge.day <= GRUDGE_DAYS); },
  hostileToPlayer(b) { if (b.team) return false; if (G.t < 240 && !b.hitByPlayer) return false; if (this.grudging(b)) return true; return b.persona === 'hostile' ? b.rel < 0.5 : b.rel < -0.25; },
  /** the player or a co-op friend (they all count as "the players" to a survivor) */
  isPlayer(o) { return !!o && (o === G.player || o.remote !== undefined); },
  hostileTo(b, other) {
    if (!other || other.dead) return false;
    if (other === G.player) return this.hostileToPlayer(b);
    if (other.bot) { const o = other.bot; if (b.crew && b.crew === o.crew) return false; if (b.team && o.team) return false; if (b.team) return this.hostileToPlayer(o); if (o.team) return this.hostileToPlayer(b); return (b.persona === 'hostile' || o.persona === 'hostile') && (b.grudges && b.grudges[o.id] || b.persona === 'hostile'); }
    if (other.team === 'hostile' || other.team === 'raider') return true;
    if (other.kind === 'animal' && !other.def.flee) return true;
    return false;
  },
  /** pair some survivors up into crews of two (same personality): they never fight each other and help each other out */
  assignCrews() {
    for (const b of this.list) b.crew = 0;
    for (const p of ['friendly', 'neutral', 'hostile']) {
      const l = this.list.filter(b => b.persona === p); for (let i = l.length - 1; i > 0; i--) { const j = randi(0, i); [l[i], l[j]] = [l[j], l[i]]; }
      for (let i = 0; i + 1 < l.length; i += 2) if (chance(0.6)) l[i].crew = l[i + 1].crew = Math.min(l[i].id, l[i + 1].id);
    }
  },
  crewOf(b) { return b.crew ? this.list.filter(o => o !== b && o.crew === b.crew && !o.dead) : []; },
  onHurt(a, src) {
    const b = a.bot; const by = src && src.owner; if (!by || by === a) return;
    if (by === G.player) {
      b.rel -= b.team ? 0.25 : 0.7; b.hitByPlayer = G.t;
      if (b.team && b.rel < 0.3) { b.team = false; a.team = 'bot:' + b.id; say(b, 'angry'); }
      else if (!b.angryT || G.t - b.angryT > 10) { b.angryT = G.t; say(b, this.hostileToPlayer(b) ? 'angry' : 'threat'); }
    } else if (by.bot) { if (by.bot.crew && by.bot.crew === b.crew) return; b.grudges = b.grudges || {}; b.grudges[by.bot.id] = true; }
    b.threat = by; b.threatT = G.t;
    // its crew-mate close by comes to help (and doesn't like you much for it)
    for (const o of this.crewOf(b)) {
      if (!o.actor || o.team || dist(o.actor.x, o.actor.z, a.x, a.z) > 50) continue;
      if (this.isPlayer(by)) { if (by === G.player || o.persona !== 'friendly') { o.rel = Math.max(-1, o.rel - 0.12); o.hitByPlayer = G.t; } }
      else if (by.bot) { o.grudges = o.grudges || {}; o.grudges[by.bot.id] = true; }
      if (this.hostileTo(o, by) || by.bot || by.kind === 'animal' || by.team === 'hostile') { o.threat = by; o.threatT = G.t; }
    }
  },
  onKill(a, src) {
    const b = a.bot; const by = src && src.owner;
    b.dead = true; b.respawnAt = G.t + rand(60, 140); say(b, 'die'); b.trip = null;
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
  // ---------------------------------------------------------------- your explosives on their base: they come home, fight and remember
  /** an explosion (combat.js explode, via G.onBoom): if a player set it off on a survivor's base, that survivor is told */
  onBoom(x, z, def, owner) {
    if (G.netGuest || !this.isPlayer(owner) || !def || !(def.struct > 0)) return;
    const r = def.r || 3;
    for (const b of this.list) if (!b.dead && this.touchesBase(b, x, z, r)) this.baseAttacked(b, owner, x, z, 'boom');
  },
  /** explosives a player threw / stuck that came to rest in a survivor's base (checked a couple of times a second, before they go off) */
  scanThrowns() {
    if (G.netGuest || !G.throwns || !G.throwns.length) return;
    for (const t of G.throwns) {
      if (t.botSeen || !(t.rest || t.stuck)) continue; t.botSeen = true;
      const T = THROWN[t.id]; if (!T || !(T.struct > 0) || T.signal || !this.isPlayer(t.owner)) continue;
      for (const b of this.list) {
        if (b.dead) continue;
        if ((t.stuck && t.stuck.owner === this.ownerOf(b)) || this.touchesBase(b, t.x, t.z, 1.5)) this.baseAttacked(b, t.owner, t.x, t.z, 'charge');
      }
    }
  },
  /** does a blast of radius r at (x, z) reach any of b's walls, floors or deployables (or land inside the house)? */
  touchesBase(b, x, z, r) {
    if (!b.plan || dist(b.plan.cx, b.plan.cz, x, z) > BASE_R + r + 4) return false;
    if (dist(b.plan.cx, b.plan.cz, x, z) < 5) return true;
    const o = this.ownerOf(b), r2 = (r + 1.6) ** 2;
    for (const d of Build.deploys) if (d.owner === o && !d.dead && (d.x - x) ** 2 + (d.z - z) ** 2 < r2) return true;
    for (const p of this.myPieces(b)) { const [px, pz] = Build.pieceXZ(p); if ((px - x) ** 2 + (pz - z) ** 2 < r2) return true; }
    return false;
  },
  /**
   * a player is raiding b's base: b turns on them (a friendly survivor is furious), comes home to defend if it's within
   * DEFEND_R, fights, and holds a grudge for a couple of days (gifts won't fix it). Its crew comes to help.
   */
  baseAttacked(b, by, x, z, how) {
    const now = G.t, cx = b.plan ? b.plan.cx : x, cz = b.plan ? b.plan.cz : z;
    const fresh = !b.defend || now - (b.boomT ?? -99) > 25 || now < (b.boomT ?? -99);
    b.defend = { x: cx, z: cz, bx: x, bz: z, until: now + DEFEND_T, by }; b.hitByPlayer = now; b.boomT = now;
    if (b.actor && !b.actor.dead && dist(b.actor.x, b.actor.z, x, z) < 70) { b.threat = by; b.threatT = now; }
    if (!fresh) return;
    b.raided = (b.raided || 0) + 1;
    if (b.team) { b.team = false; if (b.actor) b.actor.team = 'bot:' + b.id; }
    const drop = b.persona === 'friendly' ? 1.5 : b.persona === 'neutral' ? 1.1 : 0.6;
    b.rel = Math.max(-1, Math.min(b.rel - drop, b.persona === 'friendly' ? -0.85 : -0.6));
    b.grudge = { day: G.day, n: ((b.grudge && b.grudge.n) || 0) + 1 };
    if (b.trip && b.trip.ph !== 'leave' && dist(b.actor ? b.actor.x : b.x, b.actor ? b.actor.z : b.z, cx, cz) < DEFEND_R) this.endTrip(b); // drops everything and runs home
    this.speak(b, 'baseHit', b.persona, null, 1);
    if (G.ui && b.persona === 'friendly' && b.toldDay !== G.day) { b.toldDay = G.day; G.ui.toast(b.name + ' saw you blow up their base — they\'re furious', 'bad'); }
    // the crew comes too
    for (const o of this.crewOf(b)) {
      if (o.team) continue;
      o.rel = Math.max(-1, Math.min(o.rel - 0.6, -0.45)); o.hitByPlayer = now; o.grudge = { day: G.day, n: ((o.grudge && o.grudge.n) || 0) + 1 };
      o.defend = { x: cx, z: cz, bx: x, bz: z, until: now + DEFEND_T, by, help: b.id };
      if (o.actor && !o.actor.dead && dist(o.actor.x, o.actor.z, x, z) < 70) { o.threat = by; o.threatT = now; }
      if (o.trip && o.trip.ph !== 'leave') this.endTrip(o);
      if (o.actor) say(o, 'help'); else this.speak(o, 'help', null, null, 0.6);
    }
  },
  /** close enough to its (or its crew-mate's) base to come back and defend it */
  defending(b, x, z) { const D = b.defend; if (!D) return false; if (G.t > D.until || G.t < D.until - DEFEND_T - 1 || b.team) { b.defend = null; return false; } return dist(x, z, D.x, D.z) < DEFEND_R; },
  // ---------------------------------------------------------------- per frame
  update(dt) {
    const P = G.player;
    if ((this.planT = (this.planT || 0) - dt) <= 0) { this.planT = 3; this.raidPlans(); }
    if ((this.thrT = (this.thrT || 0) - dt) <= 0) { this.thrT = 0.4; this.scanThrowns(); }
    for (const b of this.list) {
      if (b.dead) {
        if (G.t >= b.respawnAt) this.respawn(b);
        continue;
      }
      const bx = b.actor ? b.actor.x : b.x, bz = b.actor ? b.actor.z : b.z;
      const near = (G.net ? G.net.anchors() : P ? [P] : []).some(q => dist(q.x, q.z, bx, bz) < 140);
      if (near && !b.actor && (G.spawnBudget ?? 1) > 0 && G.W.walkable(bx, bz) && !G.W.isWater(bx, bz)) { G.spawnBudget = (G.spawnBudget ?? 1) - 1; this.materialize(b); } // one character a frame
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
    a.armor = Math.min(0.7, b.inv.armorVal()); a.helm = b.inv.equip.helmet ? 1 : 0; // what it wears protects it (combat.js hurt), like a player's
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
    let id = null; if (job === 'metal' || job === 'sulfur') job = 'ore';
    if (job === 'wood' || job === 'ore') {
      let best = 0; for (const s of inv.all()) { const m = MELEE[s.id]; if (m && m[job] > best) { best = m[job]; id = s.id; } }
    } else {
      // the best gun it has ammo for (the rocket launcher only for the armoured patrol)
      if (job === 'apc' && this.rockets(b) > 0) id = 'rocket_launcher';
      else { const g = this.bestGun(b, 1); if (g) id = g.id; }
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
    if (threat) {
      // out on a trip it doesn't fight to the death: badly hurt or out of ammo, it pulls out and heads home
      const T = b.trip; if (T && T.ph !== 'leave' && (b.tabT = (b.tabT || 0) - dt) <= 0) { b.tabT = 0.5; const why = a.hp < (this.medsOf(b) >= 2 ? 30 : 45) ? 'hurt' : T.k !== 'apc' && !this.bestGun(b, 1) ? 'ammo' : null; if (why) this.tripDone(b, T, why); }
      // the armoured patrol shrugs off bullets: keep away from it unless it came with rockets / C4 for it
      const ty = (a.hp < (T && this.medsOf(b) < 2 ? 45 : 30) && !b.team) || (T && T.ph === 'leave' && (T.why === 'hurt' || T.why === 'ammo')) || (threat.apc && !(T && T.k === 'apc' && this.rockets(b) + b.inv.count('c4') > 0)) ? 'flee' : 'fight';
      if (!b.goal || b.goal.type !== ty || b.goal.target !== threat) b.goal = { type: ty, target: threat, t: 0 };
    }
    else if (b.goal && (b.goal.type === 'fight' || b.goal.type === 'flee') && (G.t - (b.lastSeenT || 0) > 6)) b.goal = null;
    // ---- social: greet the player
    if (P && !P.dead && b.sayT <= 0 && !threat && dist(a.x, a.z, P.x, P.z) < 9 && canSee(a, P)) {
      if (b.team) say(b, 'team'); else if (P.aiming && !this.hostileToPlayer(b) && Math.abs(angDiff(P.ang, Math.atan2(a.z - P.z, a.x - P.x))) < 0.25) { say(b, 'threat'); b.aimedAt = (b.aimedAt || 0) + 1; if (b.persona !== 'friendly' && b.aimedAt > 3) { b.rel -= 0.3; } }
      else say(b, this.grudging(b) ? 'grudge' : 'greet', b.persona);
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
    // defending its base: it knows roughly where the raider is (the blasts give them away)
    const D = b.defend; if (!best && D && D.by && !D.by.dead && G.t < D.until && this.hostileToPlayer(b) && !airborne(D.by) && dist(D.by.x, D.by.z, D.x, D.z) < 55 && dist(a.x, a.z, D.by.x, D.by.z) < 70) best = D.by;
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
      const t = nearestGather(a.x, a.z, 10, 'wood'); if (t && chance(0.5) && !this.capped(b, 'wood')) return { type: 'gather', target: t, res: 'wood' };
      return { type: 'follow' };
    }
    // someone is blowing up its base (or its crew's): back home to defend it
    if (b.defend && this.defending(b, a.x, a.z)) return { type: 'defend' };
    // night: the one armed for a raid goes (announced at dusk), everyone else goes home
    const night = G.night > 0.55;
    if (night && b.raidNight === G.day && Build.tc && this.boom(b) > 0) return { type: 'raid', force: true };
    // out on a monument run or after an event: carry on (or call it off: hurt, out of ammo, a full pack, nightfall)
    if (b.trip) { const why = this.tripAbort(b, a); if (why) this.tripDone(b, b.trip, why); return { type: 'trip' }; }
    if (night && b.home) return { type: 'home' };
    // gear progression
    const craftable = this.nextCraft(b);
    if (craftable) return { type: 'craft', id: craftable.r.id, n: craftable.n };
    // carrying a lot (a mostly full pack or a good haul): home to stash it before anything else; ore -> the furnace
    if (this.wantsDeposit(b)) return { type: 'deposit' };
    // components and junk -> a recycler
    if (this.recyclables(b).length >= 3) { const u = recyclerNear(a.x, a.z); if (u) return { type: 'recycle', u }; }
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
    // the raiders stock up on sulfur for gunpowder
    if (this.wantsBoom(b) && inv.count('sulfur') + inv.count('sulfur_ore') < 60 && chance(0.4)) return { type: 'gather', res: 'sulfur' };
    // the ingredients for what it's saving up for (a better gun, ammo, explosives), on purpose
    const want = this.craftWant(b);
    if (want && chance(0.45)) { const job = this.jobFor(b, a, want.miss); if (job && !(job.type === 'gather' && ((job.res === 'wood' && this.capped(b, 'wood')) || (job.res === 'ore' && this.capped(b, 'stone'))))) return job; }
    // now and then: an event (airdrop, locked crate, cargo ship, the patrol's wreck), or kitted out, a monument run
    if (this.tripCheck(b, a)) return { type: 'trip' };
    // otherwise: farm, loot (monuments by gear, roadside barrels), hunt, explore — with some personality
    const gear = this.gearLevel(b);
    // enough wood and stone for what it plans: stop farming them and do something else (ore still pays)
    const wC = this.capped(b, 'wood'), sC = this.capped(b, 'stone');
    const w = [['gather', wC && sC ? (this.metalRich(b) ? 0.25 : 1.1) : 3.2], ['loot', b.persona === 'hostile' ? 3 : 2.2], ['roam', 0.6], ['pick', 0.7], ['scavenge', 1.2 + gear * 0.4 + (wC && sC ? 0.8 : 0)]];
    if (inv.all().some(s => WEAPONS[s.id] && (s.ammo || inv.count(WEAPONS[s.id].ammo)))) w.push(['hunt', 1.0], ['explore', 1.0 + gear * 0.5 + (wC && sC ? 0.6 : 0)]);
    const k = weighted(w)[0];
    if (k === 'gather') {
      let res = inv.count('stone') < inv.count('wood') * 0.6 ? 'ore' : 'wood';
      if (res === 'wood' && wC) res = sC ? 'metal' : 'ore'; else if (res === 'ore' && sC) res = wC ? 'metal' : 'wood';
      if (res === 'metal' && this.wantsBoom(b) && chance(0.5)) res = 'sulfur';
      return { type: 'gather', res };
    }
    if (k === 'roam') { const ang = rand(0, 6.28), r = rand(20, 50); return { type: 'move', x: a.x + Math.cos(ang) * r, z: a.z + Math.sin(ang) * r, t: 0 }; }
    if (k === 'explore') { const m = nearestMon(a.x, a.z, Math.min(3, 1 + gear)); if (m) return { type: 'move', x: m.x + rand(-8, 8), z: m.z + rand(-8, 8), explore: true }; }
    if (k === 'scavenge') { const c = roadsideBarrel(a.x, a.z); if (c) return { type: 'move', x: c.x, z: c.z, explore: true }; }
    return { type: k === 'scavenge' || k === 'explore' ? 'loot' : k };
  },
  /** how to get more of a missing building material */
  jobFor(b, a, res) {
    if (res === 'wood') return { type: 'gather', res: 'wood' };
    if (res === 'stone') return { type: 'gather', res: 'ore' };
    if (res === 'metal_ore') return { type: 'gather', res: 'metal' };
    if (res === 'metal' || res === 'sulfur') { if (b.furnace && !b.furnace.dead) return b.inv.count(res === 'metal' ? 'metal_ore' : 'sulfur_ore') > 40 ? { type: 'deposit' } : { type: 'gather', res }; return res === 'sulfur' && b.inv.count('sulfur_ore') < 300 ? { type: 'gather', res } : { type: 'loot' }; } // no furnace yet: sulfur ore keeps for later, metal turns up in crates
    if (res === 'cloth') return { type: 'pick' };
    // gun parts, gunpowder and the like: ingredients it goes after on purpose
    if (res === 'sulfur_ore') return { type: 'gather', res: 'sulfur' };
    if (res === 'charcoal') return b.furnace && !b.furnace.dead && this.have(b, 'wood') >= 150 ? { type: 'deposit', burn: true } : { type: 'loot' };
    if (res === 'hqm' || res === 'hqm_ore') return chance(0.35) ? { type: 'gather', res: 'metal' } : { type: 'loot' };
    if (res === 'leather' || res === 'animal_fat' || res === 'bone') return { type: 'hunt' };
    if (res === 'low_fuel' && this.canPay(b, RECIPE.low_fuel.cost)) return { type: 'craft', id: 'low_fuel', n: 2 };
    if (res === 'bandage' && this.canPay(b, RECIPE.bandage.cost)) return { type: 'craft', id: 'bandage', n: 1 };
    if (['scrap', 'rope', 'pipe', 'gears', 'low_fuel', 'tape', 'spring', 'circuit'].includes(res)) return chance(0.5) && this.recyclables(b).length ? { type: 'recycle', u: recyclerNear(a.x, a.z) } : { type: 'loot' };
    if (['gunpowder', 'explosives', 'bandage'].includes(res)) return { type: 'loot' };
    return null;
  },
  // ---------------------------------------------------------------- gear progression
  wbTier(b) { const C = b.wbC; if (C && G.t - C.t < 6 && G.t >= C.t) return C.v; let t = 0; for (const d of Build.deploys) if (d.owner === this.ownerOf(b) && !d.dead && DEPLOY[d.type].wbTier) t = Math.max(t, DEPLOY[d.type].wbTier); b.wbC = { t: G.t, v: t }; return t; },
  /** the best gun it carries with at least minR rounds for it (loaded + pockets): { s, id, W, score, rounds } */
  bestGun(b, minR = 1) {
    let best = null;
    for (const s of b.inv.all()) { const W = WEAPONS[s.id]; if (!W || W.rocket) continue; const r = (s.ammo || 0) + b.inv.count(W.ammo); if (r < minR) continue; const sc = gunScore(s.id); if (!best || sc > best.score) best = { s, id: s.id, W, score: sc, rounds: r }; }
    return best;
  },
  /** kitted out for a fight away from home: a real gun with a couple of magazines for it */
  armedFor(b) { const g = this.bestGun(b, 1); if (!g || g.score < 30) return null; return g.rounds >= (g.W.arrow ? 12 : Math.max(g.W.mag * 2, 20)) ? g : null; },
  medsOf(b) { return b.inv.count('bandage') + b.inv.count('medkit') * 2 + b.inv.count('stim'); },
  /** rockets for a launcher it carries (loaded + spare) */
  rockets(b) { let n = 0, has = false; for (const s of b.inv.all()) if (s.id === 'rocket_launcher') { has = true; n += s.ammo || 0; } return has ? n + b.inv.count('rocket') : 0; },
  /** 0 = rock and a shirt ... 3 = rifles and plate (a gun only counts with ammo for it) */
  gearLevel(b) {
    const inv = b.inv; const ar = inv.equip.armor ? ITEMS[inv.equip.armor.id].armor || 0 : 0;
    const g = this.bestGun(b, 6), gun = g ? g.score : 0;
    return (gun >= 100 ? 1.5 : gun >= 55 ? 1 : gun > 0 ? 0.5 : 0) + (ar >= 0.4 ? 1.5 : ar >= 0.3 ? 1 : ar >= 0.16 ? 0.5 : 0);
  },
  /** can it make (or does it hold a good stock of) this ammo? */
  ammoOk(b, am, wb) { const r = RECIPE[am]; return (r && !r.bp && r.wb <= wb) || this.have(b, am) >= 30; },
  /** the best gun it knows how to make (workbench + blueprints, like a player) that beats what it has; affordable = only one it can pay for now */
  gunUpgrade(b, wb, bps, cur, affordable) {
    let best = null, bs = cur * 1.12 + 1;
    for (const r of gunRecipes()) {
      if (r.wb > wb || (r.bp && !bps.includes(r.id))) continue; const sc = gunScore(r.out); if (sc <= bs) continue;
      if (!this.ammoOk(b, WEAPONS[r.out].ammo, wb)) continue;
      if (affordable && !this.canPay(b, r.cost)) continue;
      best = r; bs = sc;
    }
    return best;
  },
  canPay(b, cost, n = 1) { for (const k in cost) if (this.have(b, k) < cost[k] * n) return false; return true; },
  /** explosives a survivor likes to keep (the raiders stockpile far more: wantsBoom) */
  kit(b, wb, bps) {
    const day = G.day - (b.spawnDay || 1) + 1;
    return { beancan: wb >= 1 && day >= 3 ? 2 : 0, grenade: bps.includes('grenade') ? 2 : 0, satchel: wb >= 1 && day >= 5 ? 1 : 0, c4: wb >= 3 && bps.includes('c4') ? 1 : 0, rocket: bps.includes('rocket') && b.inv.all().some(s => s.id === 'rocket_launcher') ? 4 : 0 };
  },
  /**
   * the next thing worth making, like a player would: tools, armour, a better gun (any it has the workbench and
   * blueprint for, the weapons_extra.js ones too), ammo for its gun, meds, and explosives (a small kit; the raiders
   * a stockpile). Returns { r, n } (n = batches) for one it can pay for now, or null. With want = true: the first
   * one it can't afford yet instead (what it is saving up for, see craftWant).
   */
  nextCraft(b, want = false) {
    const inv = b.inv; const cnt = id => inv.count(id), own = id => this.have(b, id), eq = id => Object.values(inv.equip).some(s => s && s.id === id);
    const has = (...ids) => ids.some(id => cnt(id) > 0 || eq(id));
    const wb = this.wbTier(b), bps = b.bps || [];
    const armor = inv.equip.armor ? ITEMS[inv.equip.armor.id].armor || 0 : 0, helm = inv.equip.helmet ? ITEMS[inv.equip.helmet.id].armor || 0 : 0;
    const main = this.bestGun(b, 1), gun = main ? main.score : 0;
    const uses = am => inv.all().some(s => WEAPONS[s.id] && WEAPONS[s.id].ammo === am);
    const boom = this.wantsBoom(b), kit = this.kit(b, wb, bps), bag = inv.equip.bag ? ITEMS[inv.equip.bag.id].slots || 0 : 0;
    const up = this.gunUpgrade(b, wb, bps, gun, !want);
    // ammo for the guns it carries: a few magazines' worth
    const ammoGoal = am => main && main.W.ammo === am ? Math.max(main.W.mag * 3, 40) : am === 'arrow' ? 24 : 30;
    const ammo = am => uses(am) && own(am) < ammoGoal(am); // pockets + boxes (it restocks its pockets at home)
    const sat = boom || own('satchel') < kit.satchel, beans = (boom ? 2 : kit.beancan) + (sat && own('beancan') < 2 ? 2 : 0);
    const gp = boom ? 160 : (own('beancan') < beans || own('grenade') < kit.grenade) ? 80 : uses('pistol_ammo') || uses('shell') || uses('rifle_ammo') ? 40 : 0;
    const order = [
      ['hatchet', !has('hatchet', 'salv_axe')], ['pickaxe', !has('pickaxe', 'salv_pick')],
      ['burlap', armor < 0.08], ['helm_wood', helm < 0.05], ['bow', gun <= 0], ['arrow', ammo('arrow')],
      ['spear_wood', !has('spear_wood', 'machete')], ['bag_small', !inv.equip.bag && cnt('leather') >= 5],
      ['wood_armor', armor < 0.16], [up && up.id, !!up], ['vest_scrap', armor < 0.22], ['helm_bucket', helm < 0.08],
      ['salv_axe', !has('salv_axe')], ['salv_pick', !has('salv_pick')], ['machete', !has('machete')], ['vest_sign', armor < 0.32],
      ['pistol_ammo', ammo('pistol_ammo')], ['shell', ammo('shell')], ['nails', ammo('nails')], ['rifle_ammo', ammo('rifle_ammo')],
      ['medkit', own('medkit') < 2 && this.have(b, 'scrap') >= 30], ['bag_ruck', bag < 12], ['vest_plate', armor < 0.46], ['helm_riot', helm < 0.14],
      ['helm_mil', helm < 0.2], ['vest_heavy', armor < 0.6 && this.have(b, 'hqm') >= 60], ['bag_mil', bag < 18 && this.have(b, 'leather') >= 30],
      // explosives: gunpowder (sulfur + charcoal) -> beancans -> satchels; grenades, C4 and rockets with the blueprint
      ['gunpowder', gp > 0 && own('gunpowder') < gp], ['beancan', own('beancan') < beans], ['grenade', own('grenade') < kit.grenade], ['satchel', sat],
      ['explosives', kit.c4 > own('c4') && this.have(b, 'explosives') < 20 && this.have(b, 'gunpowder') >= 100], ['c4', own('c4') < kit.c4], ['rocket', this.rockets(b) < kit.rocket],
    ];
    for (const [id, ok] of order) {
      if (!ok || !id) continue; const r = RECIPE[id]; if (!r || r.wb > wb) continue; if (r.bp && !bps.includes(r.id)) continue;
      if (!this.canPay(b, r.cost)) { if (want) return { r, n: 1 }; continue; }
      if (want) continue;
      // ammo and gunpowder come in a few batches at once
      let n = 1;
      if (r.id === 'gunpowder' || ITEMS[r.out].cat === 'ammo') { const goal = r.id === 'gunpowder' ? gp : ammoGoal(r.out); n = clamp(Math.ceil((goal - own(r.out)) / r.n), 1, 5); while (n > 1 && !this.canPay(b, r.cost, n)) n--; }
      return { r, n };
    }
    return null;
  },
  /** what it's saving up for and the first thing that recipe is missing, e.g. { r: smg, miss: 'hqm' } (recomputed every 12 s) */
  craftWant(b) {
    const C = b.wantC; if (C && G.t - C.t < 12 && G.t >= C.t) return C.v;
    let v = null; const w = this.nextCraft(b, true);
    if (w) {
      // a level or two down: beancans -> gunpowder -> sulfur / charcoal
      let miss = Object.keys(w.r.cost).find(k => this.have(b, k) < w.r.cost[k]);
      for (let d = 0; d < 2 && miss && RECIPE[miss] && !RECIPE[miss].bp && RECIPE[miss].wb <= this.wbTier(b) && ITEMS[miss].cat !== 'comp'; d++) { const r2 = RECIPE[miss]; const m2 = Object.keys(r2.cost).find(k => this.have(b, k) < r2.cost[k]); if (!m2) break; miss = m2; }
      if (miss) v = { r: w.r, miss };
    }
    b.wantC = { t: G.t, v }; return v;
  },
  /** pay a recipe from pockets then boxes and make it */
  craftNow(b, r, n = 1) {
    for (const [k, v] of Object.entries(r.cost)) this.pay(b, k, v * n); b.inv.add(r.out, r.n * n); b.crafted = (b.crafted || 0) + 1; b.wantC = null;
    const cat = ITEMS[r.out].cat;
    if (cat === 'gun') { b.gunsMade = (b.gunsMade || 0) + 1; this.speak(b, 'crafted', null, { g: ITEMS[r.out].name }, 0.5); }
    else if (cat === 'throw' && r.out !== 'supply_signal') { b.boomMade = (b.boomMade || 0) + r.n * n; if (chance(0.35)) this.speak(b, 'boom', null, null, 0.3); }
    this.equipBest(b);
  },
  /** blueprints found in loot are learned on the spot */
  learn(b) {
    b.bps = b.bps || [];
    for (const v of [b.inv.belt, b.inv.main]) for (let i = 0; i < v.slots.length; i++) { const s = v.slots[i]; if (s && ITEMS[s.id] && ITEMS[s.id].teach) { if (!b.bps.includes(ITEMS[s.id].teach)) b.bps.push(ITEMS[s.id].teach); v.slots[i] = null; } }
  },
  // ---------------------------------------------------------------- storage, recycling, upkeep
  /** its storage: every small / large box it owns (the house's, the annex's and any it added), cached a few seconds */
  boxes(b) {
    const C = b.boxC, n = Build.deploys.length;
    if (C && C.n === n && G.t - C.t < 5 && G.t >= C.t && !C.l.some(d => d.dead)) return C.l;
    const o = this.ownerOf(b), l = Build.deploys.filter(d => d.owner === o && !d.dead && d.inv && (d.type === 'box_small' || d.type === 'box_large'));
    b.boxC = { t: G.t, n, l }; return l;
  },
  boxFor(b) { return this.boxes(b).find(d => d.inv.slots.some(s => !s)) || this.boxes(b)[0] || null; },
  have(b, k) { let n = b.inv.count(k); for (const d of this.boxes(b)) n += d.inv.count(k); return n; },
  /** everything a bot owns of k: pockets, boxes and the cupboard's upkeep stock */
  held(b, k) { let n = this.have(b, k); if (b.tc && !b.tc.dead && b.tc.inv) n += b.tc.inv.count(k); return n; },
  /**
   * enough wood / stone: what the base still has to build, the next stage it is saving for and four days of
   * upkeep, and never less than ~1500 (more for a bigger base). Above it the bot stops farming that resource.
   * Recomputed every 15 s.
   */
  cap(b, k) {
    const C = b.capC; if (C && G.t - C.t < 15 && G.t >= C.t) return C[k] ?? Infinity;
    const need = { wood: 0, stone: 0 }; let pieces = 0;
    if (b.plan) {
      pieces = this.myPieces(b).length;
      for (let i = b.planI; i < b.plan.steps.length; i++) { const c = this.stepCost(b, b.plan.steps[i]); for (const r in need) need[r] += c[r] || 0; }
      const st = b.plan.stage; if (st === 2) need.stone += pieces * 70; else if (st === 3) { need.stone += 900; need.wood += 600; } // saving up for the next stage
    } else need.wood += 900; // the first house
    if (b.tc && !b.tc.dead) { const u = Build.upkeep(b.tc); for (const r in need) need[r] += (u.perDay[r] || 0) * 4; }
    const size = clamp(1 + pieces / 50, 1, 2.2), o = { t: G.t, step: b.plan && b.plan.steps[b.planI] ? this.stepCost(b, b.plan.steps[b.planI]) : {} };
    for (const r in need) o[r] = Math.round(Math.max(STOCK_CAP[r] * size, need[r] + 300));
    b.capC = o; return o[k];
  },
  /** plenty of metal (fragments + ore waiting to be smelted): mining more of it can wait */
  metalRich(b) { return this.held(b, 'metal') + this.have(b, 'metal_ore') >= METAL_PLENTY; },
  /** holding more than the cap (unless what it's building right now still needs more in its pockets and boxes) */
  capped(b, k) {
    if (STOCK_CAP[k] === undefined || this.held(b, k) < this.cap(b, k)) return false;
    const now = b.capC.step[k]; return !(now && this.have(b, k) < now);
  },
  pay(b, k, v) { let n = v - b.inv.take(k, v); for (const d of this.boxes(b)) { if (n <= 0) break; n -= d.inv.take(k, n); } },
  /** what it keeps on it: its best gun (and the best it has ammo for), the launcher if it has rockets, its best axe, pick and blade, a torch and a rock */
  keptGear(b) {
    const out = new Set(), inv = b.inv, all = inv.all();
    const g1 = this.bestGun(b, 1), g0 = this.bestGun(b, 0); if (g1) out.add(g1.s); if (g0) out.add(g0.s);
    if (this.rockets(b)) { const l = all.find(s => s.id === 'rocket_launcher'); if (l) out.add(l); }
    for (const job of ['wood', 'ore', 'dmg']) { let best = null, bv = 0; for (const s of all) { const m = MELEE[s.id]; if (m && m[job] > bv) { bv = m[job]; best = s; } } if (best) out.add(best); }
    for (const id of ['torch', 'rock']) { const s = all.find(q => q.id === id); if (s) out.add(s); }
    return out;
  },
  /** spare guns, tools, armour and attachments (bots don't fit them), and valuables: recycler fodder */
  isJunk(b, s, kept) {
    const D = ITEMS[s.id]; if (!D) return false;
    if (D.cat === 'gun' || D.cat === 'melee') return !kept.has(s);
    if (D.cat === 'armor' || D.cat === 'helmet' || D.cat === 'bag') { const e = b.inv.equip[D.cat === 'armor' ? 'armor' : D.cat === 'helmet' ? 'helmet' : 'bag']; const v = q => q ? ITEMS[q.id].armor || ITEMS[q.id].slots || 0 : -1; return v(s) <= v(e); }
    if (D.cat === 'ammo') return !ammoUsed().has(s.id); // bait and the like
    return D.cat === 'att' || D.cat === 'val' || D.cat === 'seed';
  },
  /** junk nothing turns back into resources (wooden tools, spare shirts, seeds): it just gets left behind */
  binIt(s) { return !RECYCLE[s.id]; },
  /**
   * how many of each kit item it keeps in its pockets (ammo for the guns it carries, a few meds, some food, a couple of
   * grenades); everything else in the pack is loot to stash at home
   */
  pocketKeep(b, kept) {
    const k = Object.assign({}, KEEP);
    for (const s of kept) { const W = WEAPONS[s.id]; if (W) k[W.ammo] = Math.max(k[W.ammo] || 0, W.rocket ? 6 : 150); }
    for (const s of b.inv.all()) if (ITEMS[s.id] && (ITEMS[s.id].cat === 'food') && k[s.id] === undefined) k[s.id] = 8;
    return k;
  },
  /** the stacks in its pack it would stash at home: [slot index, count] (junk stays on it when a recycler is close, unless the pack is nearly full) */
  stashList(b, recycler) {
    const inv = b.inv, kept = this.keptGear(b), keep = this.pocketKeep(b, kept), out = [];
    const used = inv.main.slots.filter(Boolean).length, tight = used >= inv.main.slots.length * 0.85;
    const left = Object.assign({}, keep);
    for (const v of [inv.belt, inv.main]) for (let i = 0; i < v.slots.length; i++) {
      const s = v.slots[i]; if (!s || !ITEMS[s.id]) continue;
      if (this.isJunk(b, s, kept)) { if (this.binIt(s)) out.push([v, i, s.n, true]); else if (!recycler || tight) out.push([v, i, s.n]); continue; }
      if (v === inv.belt) continue; // the belt is its kit
      if (kept.has(s)) continue;
      // kit: keep so many on it; food beyond that is eaten / left (no pantry)
      const k = left[s.id]; if (k !== undefined) { const n = Math.max(0, s.n - k); left[s.id] = Math.max(0, k - s.n); if (n > 0) out.push([v, i, n, ITEMS[s.id].cat === 'food']); continue; }
      out.push([v, i, s.n]);
    }
    return out;
  },
  /** free slots across its boxes */
  boxRoom(b) { let n = 0; for (const d of this.boxes(b)) for (const s of d.inv.slots) if (!s) n++; return n; },
  /** carrying a lot (a mostly full pack, or a good haul) and there's room at home: time to take it back */
  wantsDeposit(b) {
    if (!b.plan || G.t < (b.depCd || 0)) return false;
    const inv = b.inv, ore = inv.count('metal_ore') + inv.count('sulfur_ore') + inv.count('hqm_ore');
    if (ore > 150 && b.furnace && !b.furnace.dead) return true;
    if (!this.boxRoom(b)) return false;
    const L = this.stashList(b, !!(b.actor && recyclerNear(b.actor.x, b.actor.z)));
    let n = 0, val = 0; for (const [v, i, k] of L) { const s = v.slots[i]; n++; val += (ITEMS[s.id].val || 0) * k; }
    const used = inv.main.slots.filter(Boolean).length;
    return (used >= inv.main.slots.length * 0.7 && n >= 3) || val >= 300 || inv.count('wood') > 1200 || inv.count('stone') > 900;
  },
  /** put loot in the boxes (a spare box gets built when they fill up), ore in the furnace (lit), and pick up what it smelted */
  depositAll(b, burn) {
    const f = b.furnace && !b.furnace.dead ? b.furnace : null;
    if (f) {
      for (const k of ['metal', 'sulfur', 'hqm', 'charcoal']) { const n = f.inv.count(k); if (n) { f.inv.take(k, n); const left = b.inv.add(k, n); if (left) f.inv.add(k, left); } }
      // fuel first (burning wood is also how it makes charcoal for gunpowder: burn = light it up for that alone), then ore (pockets, then what's waiting in the boxes)
      const want = burn ? 400 : 200; let fuel = Math.min(Math.max(0, want - f.inv.count('wood')), f.inv.room('wood'));
      if (fuel > 0) { let got = b.inv.take('wood', Math.min(fuel, b.inv.count('wood'))); for (const d of this.boxes(b)) if (got < fuel) got += d.inv.take('wood', fuel - got); if (got) f.inv.add('wood', got); }
      for (const k of ['metal_ore', 'sulfur_ore', 'hqm_ore']) { const n = Math.min(this.have(b, k), f.inv.room(k)); if (n > 0) { this.pay(b, k, n); f.inv.add(k, n); } }
      if (f.inv.count('wood') > 0 && (burn || (f.inv.count('metal_ore') + f.inv.count('sulfur_ore') + f.inv.count('hqm_ore')) > 0)) f.state.lit = true;
    }
    const near = b.actor ? recyclerNear(b.actor.x, b.actor.z) : null; let moved = 0;
    for (const [v, i, n, bin] of this.stashList(b, near)) {
      const s = v.slots[i]; if (!s) continue;
      if (bin) { if (n >= s.n) v.slots[i] = null; else s.n -= n; b.binned = (b.binned || 0) + n; continue; }
      const part = n >= s.n ? s : Object.assign({}, s, { n }); let left = part;
      for (const d of this.boxes(b)) { left = d.inv.addStack(left); if (!left) break; }
      const put = n - (left ? left.n : 0); if (put <= 0) continue; moved += put;
      if (put >= s.n) v.slots[i] = null; else s.n -= put;
    }
    b.stashed = (b.stashed || 0) + moved; b.depCd = G.t + 40;
    // re-arms from the boxes (after a death): a better gun it has ammo for, better armour, tools
    let re = false;
    for (const d of this.boxes(b)) for (let i = 0; i < d.inv.slots.length; i++) {
      const s = d.inv.slots[i]; if (!s) continue; const D = ITEMS[s.id]; if (!D) continue; let take = false;
      if (D.cat === 'gun' && !WEAPONS[s.id].rocket) { const g = this.bestGun(b, 0); take = gunScore(s.id) > (g ? g.score : 0) && this.have(b, WEAPONS[s.id].ammo) + (s.ammo || 0) > 0; }
      else if (D.cat === 'melee' && MELEE[s.id]) { const M = MELEE[s.id]; take = ['wood', 'ore', 'dmg'].some(j => !b.inv.all().some(q => MELEE[q.id] && MELEE[q.id][j] >= M[j])); }
      else if (D.cat === 'armor' || D.cat === 'helmet' || D.cat === 'bag') { const e = b.inv.equip[D.cat]; const v = q => q ? ITEMS[q.id].armor || ITEMS[q.id].slots || 0 : -1; take = v(s) > v(e); }
      if (take) { const left = b.inv.addStack(s); d.inv.slots[i] = left; if (!left) re = true; }
    }
    if (re) this.equipBest(b);
    // and it restocks its kit from the boxes: ammo for its guns, meds, a couple of grenades
    const keep = this.pocketKeep(b, this.keptGear(b));
    for (const id in keep) { const want = Math.min(keep[id], id === 'beancan' || id === 'grenade' ? 2 : keep[id]) - b.inv.count(id); if (want <= 0) continue; let got = 0; for (const d of this.boxes(b)) if (got < want) got += d.inv.take(id, want - got); if (got) { const left = b.inv.add(id, got); if (left) this.boxFor(b) && this.boxFor(b).inv.add(id, left); } }
    // junk nothing recycles goes; and with a recycler run coming up it takes the rest of the junk out of the boxes
    { const kept = this.keptGear(b); let k = 0; for (const d of this.boxes(b)) for (let i = 0; i < d.inv.slots.length; i++) { const s = d.inv.slots[i]; if (!s || !this.isJunk(b, s, kept)) continue; if (this.binIt(s)) { d.inv.slots[i] = null; continue; } if (near && k < 4) { const left = b.inv.main.addStack(s); d.inv.slots[i] = left; if (!left) k++; } } }
    if (this.boxRoom(b) <= 2) this.addBox(b);
    return moved;
  },
  /** room for one more box in the house, upstairs or in the annex (as a step of its plan, so it's rebuilt if lost) */
  addBox(b) {
    const P0 = b.plan; if (!P0 || P0.stage < 2 || this.boxes(b).length >= 4) return;
    if (P0.steps.slice(b.planI).some(st => st.t === 'box_small' || st.t === 'box_large')) return; // one already on the way
    const ci = P0.ci, cj = P0.cj, up = Build.floorBase(ci, cj, 1), big = this.have(b, 'metal') >= 50 && this.have(b, 'wood') >= 250;
    const spots = [[(ci + 1) * CELL + 0.8, cj * CELL + 0.8], [ci * CELL + 2.3, (cj + 1) * CELL + 0.7], [(ci + 2) * CELL + 2.2, (cj + 1) * CELL + 2.2],
      ...(up != null ? [[ci * CELL + 0.8, cj * CELL + 0.8, up + 0.1], [(ci + 1) * CELL + 2.2, cj * CELL + 0.8, up + 0.1]] : [])];
    for (const [x, z, y] of spots) {
      if (P0.steps.some(st => st.x !== undefined && (st.x - x) ** 2 + (st.z - z) ** 2 < 1)) continue;
      const t = big ? 'box_large' : 'box_small', st = { t, x, z, y };
      if (!Build.check(t, this.stepTarget(st), this.ownerOf(b)).ok) continue;
      P0.steps.push(st); return st;
    }
  },
  /** valuables, spare components and junk it has better of (what the recycler turns into scrap, metal, cloth, HQM) */
  recyclables(b) {
    const keep = { pipe: 3, spring: 2, gears: 3, rope: 3, tape: 2, circuit: 2, fuse: 1 }; const out = [], kept = this.keptGear(b), seen = new Set();
    for (const s of b.inv.all()) {
      const id = s.id; if (seen.has(id) || !RECYCLE[id]) continue; seen.add(id); const c = ITEMS[id].cat;
      let n; if (c === 'comp' || c === 'res') n = b.inv.count(id) - (keep[id] ?? 99); else if (c === 'val') n = b.inv.count(id); else n = b.inv.all().filter(q => q.id === id && this.isJunk(b, q, kept)).reduce((m, q) => m + q.n, 0);
      if (n > 0) out.push([id, n]);
    }
    return out;
  },
  /** the recycler: everything in recyclables(); far away (fromBoxes) the junk in its boxes goes too */
  recycleAll(b, fromBoxes) {
    if (fromBoxes) { const kept = this.keptGear(b); for (const d of this.boxes(b)) for (let i = 0; i < d.inv.slots.length; i++) { const s = d.inv.slots[i]; if (s && this.isJunk(b, s, kept)) { d.inv.slots[i] = null; if (!RECYCLE[s.id]) continue; for (const [o, v] of Object.entries(RECYCLE[s.id])) { const left = d.inv.add(o, v * s.n); if (left) b.inv.add(o, left); } b.recycled = (b.recycled || 0) + s.n; } } }
    let n = 0; for (const [id, k] of this.recyclables(b)) { const got = b.inv.take(id, k); for (const [o, v] of Object.entries(RECYCLE[id])) b.inv.add(o, v * got); n += got; }
    b.recycled = (b.recycled || 0) + n; return n;
  },
  /** the cupboard has less than two days of upkeep and the bot can top it up */
  tcShort(b) {
    const u = Build.upkeep(b.tc);
    for (const k in u.perDay) if (b.tc.inv.count(k) < u.perDay[k] * 2 && this.have(b, k) >= Math.min(u.perDay[k], 30)) return true;
    return false;
  },
  /** the cupboard could take a top-up (under four days of something it has spare) */
  tcLow(b) {
    if (!b.tc || b.tc.dead) return false; const u = Build.upkeep(b.tc);
    for (const k in u.perDay) if (b.tc.inv.count(k) < u.perDay[k] * 4 && b.tc.inv.room(k) > 0 && this.have(b, k) >= Math.min(u.perDay[k], 20)) return true;
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
      case 'deposit': { // home with the loot: the box (ore and fuel in the furnace on the way), then upkeep into the cupboard
        if (!g.said && this.stashList(b, false).length >= 6) { g.said = true; if (chance(0.5)) say(b, 'stash'); }
        if (g.step === 1) { const tc = b.tc; if (!tc || tc.dead) { b.goal = null; return; } if (this.walkTo(b, a, tc.x, tc.z, dt, 1.7, tc.y)) { this.stockTc(b); a.st.use = 0; b.goal = null; } return; }
        const fur = b.furnace && !b.furnace.dead ? b.furnace : null;
        const box = (g.burn && fur) || this.boxFor(b) || fur; if (!box) { b.goal = null; return; }
        if (this.walkTo(b, a, box.x, box.z, dt, 1.7, box.y)) { this.depositAll(b, g.burn); a.st.use = 0; if (this.tcLow(b)) g.step = 1; else b.goal = null; }
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
      case 'trip': return this.tripAct(b, a, g, dt);
      case 'defend': { // run home and sweep round the base toward the blasts (the threat logic takes over once it spots the raider)
        const D = b.defend; if (!D) { b.goal = null; return; }
        if (!g.said) { g.said = true; say(b, D.help ? 'help' : 'defend'); }
        const by = D.by; if (by && !by.dead && dist(by.x, by.z, D.x, D.z) < 55 && dist(a.x, a.z, D.x, D.z) < 60) { b.threat = by; b.threatT = G.t; }
        if (g.ang === undefined) g.ang = Math.atan2((D.bz ?? D.z) - D.z, (D.bx ?? D.x) - D.x) + rand(-0.6, 0.6);
        const near = dist(a.x, a.z, D.x, D.z) < 14; if (near) g.ang += dt * 0.15;
        const R = near ? 6 + Math.sin(G.t * 0.3 + b.id) * 2.5 : 4;
        this.walkTo(b, a, D.x + Math.cos(g.ang) * R, D.z + Math.sin(g.ang) * R, dt, 2, undefined, true);
        return;
      }
      case 'move': default: {
        if (g.x === undefined) { b.goal = null; return; }
        if (!G.W.walkable(g.x, g.z)) { b.goal = null; return; }
        if (this.walkTo(b, a, g.x, g.z, dt, 2)) { if (g.explore) b.goal = { type: 'loot' }; else b.goal = null; }
        return;
      }
    }
  },
  /** walk toward a point (y: its floor height, e.g. upstairs in a base); returns true when within r. Steering paths round walls, up stairs and ladders. */
  walkTo(b, a, x, z, dt, r = 1.2, y, hurry) {
    const d = dist(a.x, a.z, x, z); if (d <= r && (y === undefined || Math.abs(y - a.y) < 1.3)) { a.speedNow = 0; b.stuck = 0; return true; }
    const ox = a.x, oz = a.z; const run = hurry ? d > 3 : d > 14 && G.night < 0.6;
    steer(a, x, z, (run ? a.def.speed * (hurry ? 1.15 : 1.1) : a.def.speed * 0.72) * (b.pace || 1), dt, true, y);
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
        // enough for now? (a full pocket, or as much as the base needs: then it's off to do something else)
        if (b.goal !== g) return; const inv = b.inv;
        if (g.res === 'wood' ? inv.count('wood') > 1500 || this.capped(b, 'wood') : g.res === 'ore' ? inv.count('stone') > 1200 || this.capped(b, 'stone') : inv.count(g.res === 'sulfur' ? 'sulfur_ore' : 'metal_ore') > 400) b.goal = null;
      };
    }
  },
  loot(b, a, g, dt) {
    if (!g.target || g.target.gone || (g.target.inv && g.target.inv.empty())) {
      g.target = null; let bd = 70 * 70;
      for (const c of G.containers) { if (c.gone || c.locked || (c.inv && c.inv.empty())) continue; if (c.botLooted && G.t - c.botLooted < 300) continue; const d = (c.x - a.x) ** 2 + (c.z - a.z) ** 2; if (d < bd && !(c.mon && c.mon.def && c.mon.def.tier >= 3 && b.persona !== 'hostile')) { bd = d; g.target = c; } }
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
    if (t.apc && a.held !== 'rocket_launcher' && this.rockets(b) > 0) this.pickWeapon(b, 'apc');
    if (!a.gunStack && !MELEE[a.held]) this.pickWeapon(b);
    if (a.held === undefined || a.held === null || (!a.gunStack && b.goal.type === 'fight')) this.pickWeapon(b);
    const g = b.goal; let sees = canSee(a, t);
    // and no hill in the way (sight checks walls, not the terrain): otherwise move up instead of emptying the gun into the slope
    if (sees && d > 6) { if ((g.csT = (g.csT || 0) - dt) <= 0) { g.csT = 0.3; g.cs = clearShot(a, t); } sees = g.cs; }
    this.maybeThrow(b, a, t, d, sees, dt);
    // hurt: patch up while it can't be shot at or is reloading anyway (a medkit if it's bad)
    if (a.hp < 55 && a.st.use < 0 && a.st.throw < 0 && (!sees || a.st.reload >= 0 || d > 20) && (g.healT = (g.healT || 0) - dt) <= 0) {
      const id = b.inv.count('medkit') && a.hp < 40 ? 'medkit' : b.inv.count('bandage') ? 'bandage' : b.inv.count('medkit') ? 'medkit' : null;
      if (id) { g.healT = 4; a.st.use = 0; a.onUse = () => { if (b.inv.take(id, 1)) { a.hp = Math.min(a.maxhp, a.hp + (id === 'medkit' ? 50 : 14)); a.bleed = 0; } }; }
    }
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
        if ((b.strafeT = (b.strafeT || 0) - dt) <= 0) { b.moving = !b.moving; b.strafeT = b.moving ? rand(0.7, 1.8) : b.trip ? rand(1.6, 3.4) : rand(0.9, 2.4); b.strafe = chance(0.5) ? 1 : -1; }
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
  /**
   * now and then a grenade or beancan at someone hiding behind cover (C4 at the armoured patrol when it stops) —
   * never where the blast would catch a friend, inside its own base, or at your base outside a raid
   */
  maybeThrow(b, a, t, d, sees, dt) {
    const g = b.goal; if (!g) return;
    g.unseen = sees ? 0 : (g.unseen || 0) + dt;
    if ((g.nadeT = (g.nadeT ?? rand(1.5, 4)) - dt) > 0) return;
    g.nadeT = rand(2.5, 5);
    if (t.kind === 'animal' || t.heli || a.st.throw >= 0 || a.st.reload >= 0 || a.st.use >= 0) return;
    let id = null;
    if (t.apc) { if (b.inv.count('c4') && d < 9 && (t.speedNow || 0) < 0.6) id = 'c4'; }
    else if (d > 5 && d < 18 && (g.unseen > 1.2 ? chance(0.55) : chance(0.12))) id = ['grenade', 'beancan'].find(k => b.inv.count(k)) || null;
    if (!id) return;
    if (!t.apc) {
      const r = (THROWN[id].r || 3) + 2.5, near = o => o && !o.dead && (o.x - t.x) ** 2 + (o.z - t.z) ** 2 < r * r;
      if (d < r || (G.player && !this.hostileToPlayer(b) && near(G.player))) return;
      for (const o of G.actors) if (o !== t && o !== a && near(o) && (o.bot ? !this.hostileTo(b, o) : o.remote !== undefined && !this.hostileToPlayer(b))) return;
      if (b.plan && dist(t.x, t.z, b.plan.cx, b.plan.cz) < BASE_R + r) return;
      if (Build.inPrivilege(t.x, t.z) && b.goal.type !== 'raid') return;
    }
    b.inv.take(id, 1); a.st.throw = 0; a.ang = Math.atan2(t.z - a.z, t.x - a.x);
    const th = throwItem(a, id, t.x + rand(-0.8, 0.8), t.z + rand(-0.8, 0.8)); if (th && id === 'c4') th.dud = false;
    g.nadeT = rand(8, 15); b.thrownN = (b.thrownN || 0) + 1; if (chance(0.45)) say(b, 'nade');
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
  // ---------------------------------------------------------------- trips: monument runs and live events
  // b.trip = { k: 'mon' | 'airdrop' | 'drop' | 'cargo' | 'rig' | 'wreck' | 'apc', key, mi (monument index), x, z,
  //            ph: 'go' | 'board' | 'site' | 'leave', t0, ts (got there), n (crates looted), why }
  // Near you it's played out for real (walk, fight the garrison, loot crate by crate, hack and hold); far away the
  // trip takes travel time and then a roll against the site's danger and its gear: loot (the site's real crates),
  // spent ammo and meds, a retreat, or now and then a death there. Not saved: a reload just ends it.
  /** the live events a survivor could go for right now (cached a few seconds) */
  events() {
    const C = this._ev; if (C && G.t - C.t < 4 && G.t >= C.t) return C.l;
    const l = [], E = G.events || {}, r = v => Math.round(v);
    const A = G.airdrop; if (A) { const c = A.container; if (!c || (!c.gone && !(c.inv && c.inv.empty()))) l.push({ k: 'airdrop', x: A.x, z: A.z, key: 'ad' + r(A.x) + ':' + r(A.z) }); }
    const L = E.lockedCrate; if (L && L.phase) l.push({ k: 'drop', x: L.x, z: L.z, key: 'lc' + r(L.x) + ':' + r(L.z) });
    const S = G.cargo; if (S && S.docked && S.t < DOCK_TIME - 150) { const [x, z] = S.toWorld(-16, -11.5); l.push({ k: 'cargo', x, z, key: 'cg' + r(S.x) + ':' + r(S.z) + ':' + G.day }); }
    const R = E.rig; if (R && R.phase === 'locked') l.push({ k: 'rig', x: R.x, z: R.z, key: 'rig' + G.day });
    const V = E.convoy; if (V) l.push(V.phase === 'wreck' ? { k: 'wreck', x: V.x, z: V.z, key: 'wr' + r(V.x) + ':' + r(V.z) } : { k: 'apc', x: V.x, z: V.z, key: 'apc' + G.day });
    this._ev = { t: G.t, l }; return l;
  },
  /** where a trip is headed, and what's there (null: the event is over / the site is gone). Cached for a second. */
  tripTarget(T) {
    if (T._tgT !== undefined && G.t - T._tgT < 1 && G.t >= T._tgT) return T._tg;
    let o = null; const E = G.events || {};
    switch (T.k) {
      case 'mon': { const m = G.monuments[T.mi]; if (m) o = { x: m.x, z: m.z, r: Math.min(14, m.size * 0.5), m }; break; }
      case 'airdrop': { const A = G.airdrop; if (!A) break; const c = A.container || null; if (c && (c.gone || (c.inv && c.inv.empty()))) break; o = { x: A.x, z: A.z, r: 3, c }; break; }
      case 'drop': { const L = E.lockedCrate; if (!L) break; const c = G.containers.find(q => q.evDrop && (q.x - L.x) ** 2 + (q.z - L.z) ** 2 < 16) || null; if (c && !c.locked && c.inv && c.inv.empty()) break; o = { x: L.x, z: L.z, r: 3, c }; break; }
      case 'cargo': { const S = G.cargo; if (!S || !S.docked || S.t > DOCK_TIME - 25) break; const [x, z] = S.toWorld(-16, -11.5); o = { x, z, r: 2.5, S }; break; }
      case 'rig': { const m = G.monuments.find(q => q.type === 'oilrig'); if (!m) break; const c = G.containers.find(q => q.type === 'locked_crate' && (q.x - m.x) ** 2 + (q.z - m.z) ** 2 < 400); if (!c || (!c.locked && c.inv && c.inv.empty())) break; o = { x: c.x, z: c.z, r: 4, c, m }; break; }
      case 'wreck': { const V = E.convoy; if (!V || V.phase !== 'wreck') break; const cs = G.containers.filter(q => !q.gone && (q.type === 'elite' || q.type === 'military') && q.def.respawn === 0 && (q.x - V.x) ** 2 + (q.z - V.z) ** 2 < 81 && !(q.inv && q.inv.empty())); if (cs.length) o = { x: V.x, z: V.z, r: 5, cs }; break; }
      case 'apc': { const a = G.actors.find(q => q.apc && !q.dead && !q.removed); if (a) o = { x: a.x, z: a.z, r: 28, apc: a }; break; }
    }
    T._tg = o; T._tgT = G.t; return o;
  },
  monDanger(m) { return m.type === 'fort' ? 2.5 : m.type === 'oilrig' ? 3.6 : m.def.tier || 1; },
  /** a monument whose tier suits its gear (the tougher ones as it improves), not too far, nobody else running it */
  pickMon(b, x, z, gear, far) {
    const maxT = gear >= 2.75 ? 3 : gear >= 1.5 ? 2 : 1, rad = ['hazmat'].includes(b.inv.equip.armor && b.inv.equip.armor.id) || (b.inv.equip.helmet && b.inv.equip.helmet.id === 'helm_gas');
    const spare = this.boom(b) - (this.raider(b) ? this.raidNeed() : 0);
    let best = null, tot = 0;
    G.monuments.forEach((m, i) => {
      const D = m.def; if (!D || D.safe || !(D.tier >= 1) || D.offshore || m.offshore) return;
      if (m.type === 'fort' && !(far && spare >= 2)) return; // blowing the fort doors: far away only, with satchels to spare
      const t = this.monDanger(m); if (t > maxT + (t >= 4 && rad && gear >= 2.75 ? 1 : 0)) return;
      const d = dist(x, z, m.x, m.z); if (d > 700) return;
      if (this.list.some(o => o !== b && o.trip && o.trip.k === 'mon' && o.trip.mi === i)) return;
      const w = (t >= maxT ? 3 : t >= maxT - 1 ? 1 : 0.06) / (1 + d / 220); // the toughest it's kitted for, now and then one a step down
      tot += w; if (Math.random() * tot < w) best = m;
    });
    return best;
  },
  /** a live event worth a go (one roll per event per survivor: occasionally, and never more than two at one) */
  pickEvent(b, x, z, gear) {
    const seen = b.evSeen || (b.evSeen = {});
    for (const k in seen) if (G.t - seen[k] > 2400 || G.t < seen[k]) delete seen[k];
    const anchors = G.net && G.net.anchors ? G.net.anchors() : G.player ? [G.player] : [];
    for (const ev of this.events()) {
      if (seen[ev.key] !== undefined) continue; seen[ev.key] = G.t;
      if (gear + 0.8 < (DANGER[ev.k] || 1)) continue;
      if (ev.k === 'rig' && (b.actor || anchors.some(q => dist(q.x, q.z, ev.x, ev.z) < 260))) continue; // it takes a boat: only while nobody's watching
      if (ev.k === 'apc' && !(this.rockets(b) >= 3 || b.inv.count('c4') >= 2)) continue;
      const d = dist(x, z, ev.x, ev.z); if (d > (ev.k === 'cargo' || ev.k === 'rig' ? 900 : 700)) continue;
      if (this.list.filter(o => o.trip && o.trip.key === ev.key).length >= 2) continue;
      if (chance((b.persona === 'hostile' ? 0.5 : b.persona === 'neutral' ? 0.38 : 0.3) * (d < 300 ? 1.3 : 1))) return ev;
    }
    return null;
  },
  /** now and then (checked every half minute or so): go for an event, or, kitted out, do a monument */
  tripCheck(b, a) {
    if (G.t < (b.tripNext || 0)) return null; b.tripNext = G.t + rand(18, 35);
    if (b.team || b.trip || b.dead || b.defend || b.raidNight === G.day || G.night > 0.4 || G.day < 2) return null;
    if ((a ? a.hp : b.hp ?? 100) < 70 || b.food < 35 || b.water < 35) return null;
    if (this.list.filter(o => o.trip).length >= TRIP_MAX || !this.armedFor(b)) return null;
    const x = a ? a.x : b.x, z = a ? a.z : b.z, gear = this.gearLevel(b);
    if (G.t >= (b.evCd || 0)) { const ev = this.pickEvent(b, x, z, gear); if (ev) return this.startTrip(b, ev); }
    if (b.monCd === undefined) b.monCd = G.t + rand(60, 500);
    if (G.t < b.monCd || this.medsOf(b) < 2 || !chance(b.persona === 'hostile' ? 0.3 : 0.22)) return null;
    const m = this.pickMon(b, x, z, gear, !a); if (!m) return null;
    const mi = G.monuments.indexOf(m); return this.startTrip(b, { k: 'mon', mi, x: m.x, z: m.z, key: 'mon' + mi });
  },
  startTrip(b, ev) {
    const T = { k: ev.k, key: ev.key, mi: ev.mi, x: ev.x, z: ev.z, ph: 'go', t0: G.t, n: 0 };
    b.trip = T; b.trips = (b.trips || 0) + 1;
    const m = T.k === 'mon' ? G.monuments[T.mi] : null;
    if (m) { b.monRuns = (b.monRuns || 0) + 1; T.max = randi(2, 3) + (m.def.tier || 1); this.speak(b, 'mon', null, { m: m.name }, 0.35); }
    else { b.evRuns = (b.evRuns || 0) + 1; this.speak(b, 'event', T.k, null, 0.7); }
    return T;
  },
  /** why it should call it off (hurt, out of ammo, a full pack, it's taking too long, nightfall), or null */
  tripAbort(b, a) {
    const T = b.trip; if (T.ph === 'leave') return null;
    if (!this.tripTarget(T)) return 'gone';
    if (a.hp < 35 || (a.hp < 55 && !this.medsOf(b))) return 'hurt';
    if (T.k === 'apc' ? !(this.rockets(b) + b.inv.count('c4')) : !this.bestGun(b, 3)) return 'ammo';
    if (b.inv.main.slots.filter(Boolean).length >= b.inv.main.slots.length - 1) return 'full';
    if (G.t - T.t0 > (T.k === 'mon' ? 720 : 900)) return 'time';
    if (T.k === 'mon' && G.night > 0.6) return 'done';
    if (T.ph === 'site' && G.t - T.ts > (T.k === 'mon' ? 300 : T.k === 'drop' || T.k === 'rig' || T.hackC ? HACK_T + 150 : 150)) return 'done'; // long enough there
    return null;
  },
  /** it's over one way or another: home it goes (with a word about how it went) */
  tripDone(b, T, why) {
    if (T.ph === 'leave') return; T.ph = 'leave'; T.tl = G.t; T.why = why;
    const m = T.k === 'mon' ? G.monuments[T.mi] : null, v = { m: m ? m.name : '', e: EV_NAME[T.k] || 'event' };
    if (why === 'ok' || (why === 'full' && T.n) || (why === 'done' && T.n)) this.speak(b, m ? 'monOk' : 'eventOk', null, v, 0.4);
    else if (why === 'hurt' || why === 'ammo' || why === 'bad') { this.speak(b, m ? 'monBad' : 'eventBad', null, v, 0.4); if (b.actor && why === 'hurt') say(b, 'flee'); }
  },
  endTrip(b) {
    const T = b.trip; b.trip = null; if (!T) return;
    if (T.k === 'mon') b.monCd = G.t + rand(520, 1000); else b.evCd = G.t + rand(240, 480);
    b.tripNext = G.t + rand(40, 80);
  },
  // ---- near the player: the real thing
  tripAct(b, a, g, dt) {
    const T = b.trip; if (!T) { b.goal = null; return; }
    if (T.ph === 'leave') return this.tripLeave(b, a, T, dt);
    const tg = this.tripTarget(T); if (!tg) { this.tripDone(b, T, 'gone'); return; }
    if (T.ph === 'go') { if (this.walkTo(b, a, tg.x, tg.z, dt, tg.r + (T.k === 'mon' ? 6 : 0))) { T.ph = T.k === 'cargo' ? 'board' : 'site'; T.ts = G.t; } return; }
    if (T.ph === 'board') { // straight up the gangway (a plain walk: the ramp is the floor), then a step onto the deck
      const S = tg.S, [fx, fz] = S.toWorld(-15, -8.8), [rx, rz] = S.toWorld(-12.5, -8.8), [x, z] = S.toWorld(-1.2, -8.3), [dx, dz] = S.toWorld(-1.2, -5.5);
      if (!T.foot) { if (this.walkTo(b, a, fx, fz, dt, 0.6)) T.foot = true; return; } // to the foot of the ramp (it overlaps the quay there), then up its middle
      if (a.y < S.quayY - 0.6 && (T.wet = (T.wet || 0) + dt) > 2.5) { this.tripDone(b, T, 'gone'); return; } // stepped off into the water: no way up here
      if (!T.ramp) { if (this.walkTo(b, a, rx, rz, dt, 0.8)) T.ramp = true; return; }
      if (!T.up) { if (this.walkTo(b, a, x, z, dt, 1.4) || a.y > WATER_Y + DECK - 0.5) T.up = true; return; }
      if (this.walkTo(b, a, dx, dz, dt, 1.4) || S.aboard(a)) { T.ph = 'site'; T.ts = G.t; }
      return;
    }
    if (T.k === 'apc') {
      const A = tg.apc; b.threat = A; b.threatT = G.t;
      if (dist(a.x, a.z, A.x, A.z) > 30) this.walkTo(b, a, A.x, A.z, dt, 28, undefined, true); else a.speedNow = 0;
      if (A.dead) { T.k = 'wreck'; T.key = 'wr'; T._tgT = undefined; }
      return;
    }
    if (T.k === 'cargo' && !(tg.S.aboard(a) && a.y > WATER_Y + DECK - 1.5)) { this.tripDone(b, T, 'gone'); return; } // not on deck after all
    if (T.k === 'drop' || T.k === 'rig' || T.hackC) return this.tripHack(b, a, g, T, T.hackC ? { c: T.hackC } : tg, dt);
    return this.tripLoot(b, a, g, T, tg, dt);
  },
  /** the crates at the site, best first */
  siteCrates(b, T, tg) {
    const ok = c => !c.gone && !c.locked && !(c.inv && c.inv.empty()) && !(c.botLooted && G.t - c.botLooted < 300 && G.t >= c.botLooted);
    if (T.k === 'mon') return G.containers.filter(c => c.mon === tg.m && !c.def.breakable && ok(c));
    if (T.k === 'airdrop') return tg.c && ok(tg.c) ? [tg.c] : [];
    if (T.k === 'wreck') return tg.cs.filter(ok);
    if (T.k === 'cargo') return G.containers.filter(c => c.ship && !c.def.breakable && ok(c));
    return tg.c && ok(tg.c) ? [tg.c] : [];
  },
  pickCrate(b, a, T, tg) {
    let best = null, bs = 0;
    for (const c of this.siteCrates(b, T, tg)) {
      if (c.botTry && G.t - c.botTry < 60 && G.t >= c.botTry) continue; // couldn't get to it a moment ago
      if ((T.tried && T.tried[c.id] || 0) >= 2) continue;               // ...nor the time before: it's out of reach for this trip
      const s = (CRATE_VAL[c.type] || 1) / (1 + dist(a.x, a.z, c.x, c.z) / 12 + Math.abs((c.y ?? a.y) - a.y) / 2.5);
      if (s > bs) { bs = s; best = c; }
    }
    return best;
  },
  /** everything in a crate that fits */
  takeAll(b, c) {
    const inv = Live.lootOf(c); c.opened = true; if (!c.openedAt) c.openedAt = G.t; c.botLooted = G.t;
    for (let i = 0; i < inv.slots.length; i++) { const s = inv.slots[i]; if (s) inv.slots[i] = b.inv.addStack(s); }
    Live.checkEmpty(c); this.learn(b); this.equipBest(b); b.looted = (b.looted || 0) + 1;
  },
  /** at the site: crate by crate, the best first (the threat logic fights whoever turns up) */
  tripLoot(b, a, g, T, tg, dt) {
    let c = g.c;
    if (!c || c.gone || c.locked || (c.inv && c.inv.empty())) {
      c = g.c = this.pickCrate(b, a, T, tg); g.search = 0;
      if (!c) {
        if (T.k === 'airdrop' && !tg.c) { this.lookAround(b, a, dt); if (G.t - T.ts > 240) this.tripDone(b, T, 'gone'); return; } // waiting for it to come down
        // the cargo ship's locked crate, for the well armed with time to spare
        const S = G.cargo; if (T.k === 'cargo' && !T.triedHack && S && S.locked && S.locked.locked && !S.locked.hackEnd && S.t < DOCK_TIME - HACK_T - 40 && this.gearLevel(b) >= 2) { T.triedHack = true; T.hackC = S.locked; return; }
        this.tripDone(b, T, T.n ? 'ok' : 'gone'); return;
      }
      c.botTry = G.t; (T.tried || (T.tried = {}))[c.id] = (T.tried[c.id] || 0) + 1; g.cT = 0;
    }
    if (!this.walkTo(b, a, c.x, c.z, dt, 1.5, c.y)) { if ((g.cT = (g.cT || 0) + dt) > 25) { T.tried[c.id] = 2; g.c = null; } return; } // can't find a way to it: forget it
    a.ang += clamp(angDiff(a.ang, Math.atan2(c.z - a.z, c.x - a.x)), -dt * 8, dt * 8);
    g.search = (g.search || 0) + dt; a.speedNow = 0; const need = 1.2 + (c.def.search || 0) * 2;
    a.st.use = g.search < need ? 0.5 : -1;
    if (g.search >= need) { this.takeAll(b, c); T.n = (T.n || 0) + 1; g.c = null; if (chance(0.3)) say(b, 'loot'); if (T.k === 'mon' && T.n >= (T.max || 3)) this.tripDone(b, T, 'ok'); }
  },
  /** a locked crate: start the hack (G.onHack, like a player), hold it for two minutes, then loot it */
  tripHack(b, a, g, T, tg, dt) {
    const c = tg.c;
    if (!c) { this.lookAround(b, a, dt); if (G.t - T.ts > 240) this.tripDone(b, T, 'gone'); return; } // it hasn't come down yet
    if (!c.locked && c.inv && c.inv.empty()) { T.hackC = null; if (T.k === 'cargo') { g.c = null; return; } this.tripDone(b, T, T.n ? 'ok' : 'gone'); return; }
    if (!this.walkTo(b, a, c.x, c.z, dt, 1.8, c.y)) return;
    a.speedNow = 0; a.ang += clamp(angDiff(a.ang, Math.atan2(c.z - a.z, c.x - a.x)), -dt * 6, dt * 6);
    if (c.locked && !c.hackEnd) { // start the hack
      if (a.st.use < 0) { a.st.use = 0; a.onUse = () => { if (c.locked && !c.hackEnd && G.onHack) { G.onHack(c, a); T.hacked = true; b.hacks = (b.hacks || 0) + 1; say(b, 'hack'); } }; }
      return;
    }
    if (c.locked) { this.lookAround(b, a, dt); return; } // hold it while the hack runs (anyone who comes for it gets fought)
    g.search = (g.search || 0) + dt; const need = 1.2 + (c.def.search || 0) * 2; a.st.use = g.search < need ? 0.5 : -1;
    if (g.search >= need) { this.takeAll(b, c); T.n = (T.n || 0) + 1; g.search = 0; if (T.hackC) { T.hackC = null; g.c = null; } else this.tripDone(b, T, 'ok'); }
  },
  lookAround(b, a, dt) { a.speedNow = 0; a.ang += Math.sin(G.t * 0.5 + b.id) * dt * 1.2; },
  tripLeave(b, a, T, dt) {
    if (T.tl === undefined) T.tl = G.t;
    // off the cargo ship: along the deck to the gap in the rail, out onto the landing, down the gangway
    const S = G.cargo;
    if (T.k === 'cargo' && S && S.docked) { const [u, v] = S.toLocal(a.x, a.z); if (u > -38.5 && u < 38.5 && v > -7.4 && v < 7.4 && a.y < WATER_Y + DECK - 1.5) { const [x, z] = S.toWorld(u, -10.5); a.x = x; a.z = z; a.y = Math.max(G.W.height(x, z), S.quayY); } } // slipped off into the water by the hull: onto the quay (as the ship's dock() does)
    if (T.k === 'cargo' && S && S.docked && (S.aboard(a) || (T.out && !T.ashore))) {
      if (G.t - T.tl > 60 && S.aboard(a)) { this.lookAround(b, a, dt); return; } // can't find the way off: the crew puts everyone ashore when it casts off
      const [gx, gz] = S.toWorld(-1.2, -6.0), [x, z] = S.toWorld(-1.2, -8.3), [rx, rz] = S.toWorld(-12.5, -8.8), [fx, fz] = S.toWorld(-15, -8.8), [qx, qz] = S.toWorld(-16, -11.5);
      if (!T.wps) T.wps = shipExit(S, a);
      if (!T.out && T.wps.length) { const [wu, wv] = T.wps[0], [wx, wz] = S.toWorld(wu, wv); if (this.walkTo(b, a, wx, wz, dt, 1.1)) T.wps.shift(); }
      else if (!T.out) { if (this.walkTo(b, a, gx, gz, dt, 1.2)) T.out = true; }
      else if (!T.down) { if (this.walkTo(b, a, x, z, dt, 1.2)) T.down = true; }
      else if (!T.rampD) { if (this.walkTo(b, a, rx, rz, dt, 0.8)) T.rampD = true; }
      else if (!T.footD) { if (this.walkTo(b, a, fx, fz, dt, 0.8)) T.footD = true; }
      else if (this.walkTo(b, a, qx, qz, dt, 1.5)) T.ashore = true;
      return;
    }
    const h = b.home, tx = h ? h.x : a.x + (a.x - T.x), tz = h ? h.z : a.z + (a.z - T.z);
    this.walkTo(b, a, tx, tz, dt, 4, undefined, T.why === 'hurt');
    if (dist(a.x, a.z, T.x, T.z) > 70 || G.t - T.tl > 100 || (h && dist(a.x, a.z, h.x, h.z) < 8)) this.endTrip(b);
  },
  // ---- far away: travel time, then a roll against the danger
  tripAbstract(b, step) {
    const T = b.trip;
    if (T.ph === 'leave') { if (T.tl === undefined) T.tl = G.t; const h = b.home; if (!h || this.travel(b, h.x, h.z, step, 4) < 12 || G.t - T.tl > 400) { this.endTrip(b); b.depT = 0; } return; }
    const tg = this.tripTarget(T); if (!tg) { this.tripDone(b, T, 'gone'); return; }
    if ((b.hp ?? 100) < 35) { this.tripDone(b, T, 'hurt'); return; }
    if (T.ph === 'go' || T.ph === 'board') {
      if (G.t - T.t0 > 900) { this.tripDone(b, T, 'time'); return; }
      if (this.travel(b, tg.x, tg.z, step, T.k === 'mon' ? 3.8 : 4.6) < Math.max(6, tg.r + 3)) { T.ph = 'site'; T.ts = G.t; T.wait = rand(35, 90); }
      return;
    }
    if (G.t - T.ts < T.wait) return;
    if (T.k === 'drop' || T.k === 'rig') {
      const c = tg.c; if (!c) { if (G.t - T.ts > 240) this.tripDone(b, T, 'gone'); return; } // not down yet
      if (c.locked) {
        if (!c.hackEnd && !T.hacked) { if (G.onHack) G.onHack(c, null); T.hacked = true; T.hs = G.t; b.hacks = (b.hacks || 0) + 1; this.speak(b, 'hack', null, null, 0.8); }
        else if (G.t - (T.hs ?? T.ts) > HACK_T + 240) this.tripDone(b, T, 'bad'); // someone else's hack, or it never opens
        return;
      }
    }
    if (T.k === 'airdrop' && !tg.c) { if (G.t - T.ts > 240) this.tripDone(b, T, 'gone'); return; }
    this.tripResolve(b, T, tg);
  },
  tripResolve(b, T, tg) {
    const m = tg.m || null, danger = m ? this.monDanger(m) : DANGER[T.k] || 1, label = m ? m.name : 'The ' + (EV_NAME[T.k] || 'event');
    const meds = this.medsOf(b), gear = this.gearLevel(b) + (meds >= 3 ? 0.3 : meds ? 0.1 : 0) + ((b.skill || 0.7) - 0.7) * 0.6;
    const gap = danger - gear, pDie = clamp(0.03 + gap * 0.1, 0.01, 0.3), pBad = clamp(0.14 + gap * 0.15, 0.04, 0.55);
    const g = this.bestGun(b, 1); if (g) this.spendAmmo(b, g, Math.round(rand(5, 14) * danger));
    if (m && m.type === 'fort') { let need = 2; for (const [id, v] of [['satchel', 1], ['c4', 4], ['beancan', 0.25]]) while (need > 0 && this.have(b, id) > 0) { this.pay(b, id, 1); need -= v; } }
    if (T.k === 'apc') { // rockets and C4 at the armoured patrol
      const A = tg.apc; let shots = 0;
      while (shots < 6 && !A.dead) { if (this.useRocket(b)) hurt(A, 130, { kind: 'explosion', pen: 0.5 }); else if (b.inv.take('c4', 1)) hurt(A, 150, { kind: 'explosion', pen: 0.5 }); else break; shots++; }
      if (Math.random() < pDie) { this.dieAbstract(b, tg.x, tg.z, 'Armoured Patrol'); return; }
      b.hp = Math.max(15, (b.hp ?? 100) - rand(10, 35)); this.useMeds(b);
      if (A.dead) { this.speak(b, 'eventOk', null, { e: 'APC' }, 0.8); T.k = 'wreck'; T.key = 'wr'; T._tgT = undefined; T.ph = 'site'; T.ts = G.t; T.wait = 20; return; }
      this.tripDone(b, T, 'bad'); return;
    }
    const roll = Math.random();
    if (roll < pDie) { this.dieAbstract(b, tg.x, tg.z, label); return; }
    b.hp = Math.max(15, (b.hp ?? 100) - rand(8, 26) * Math.max(0.5, 1 + gap * 0.5)); this.useMeds(b);
    const cs = this.siteCrates(b, T, tg).sort((p, q) => (CRATE_VAL[q.type] || 1) - (CRATE_VAL[p.type] || 1));
    if (roll < pDie + pBad) { if (cs.length && chance(0.5)) { this.takeAll(b, cs[cs.length - 1]); T.n = 1; } this.tripDone(b, T, 'bad'); return; }
    // made it: the site's crates (its real ones; rolled where they've all been taken lately)
    const max = m ? T.max || 3 : T.k === 'cargo' ? randi(3, 5) : 3; let n = 0;
    for (const c of cs) { if (n >= max) break; this.takeAll(b, c); n++; }
    if (m && n < 2) { const t = m.def.tier || 1; for (; n < 2; n++) rollInto(b.inv.main, LOOT[t >= 3 ? (chance(0.4) ? 'elite' : 'military') : t === 2 ? (chance(0.5) ? 'military' : 'ammobox') : pick(['crate', 'toolbox', 'ammobox'])], 0); this.learn(b); this.equipBest(b); b.looted = (b.looted || 0) + 1; }
    // the squad flown in to take the crate back: dealt with (they'd only stand there frozen, far from everyone)
    if ((T.k === 'drop' || T.k === 'rig') && tg.c) { const anchors = G.net && G.net.anchors ? G.net.anchors() : G.player ? [G.player] : []; for (const o of [...G.actors]) if (o.evTroop && !o.dead && (o.x - tg.c.x) ** 2 + (o.z - tg.c.z) ** 2 < 80 * 80 && !anchors.some(q => dist(q.x, q.z, o.x, o.z) < 220)) removeActor(o); }
    T.n = n; this.tripDone(b, T, 'ok');
  },
  spendAmmo(b, g, n) { let k = b.inv.take(g.W.ammo, n); if (k < n && g.s.ammo) g.s.ammo = Math.max(0, g.s.ammo - (n - k)); },
  useRocket(b) { if (b.inv.take('rocket', 1)) return true; const l = b.inv.all().find(s => s.id === 'rocket_launcher' && s.ammo > 0); if (l) { l.ammo--; return true; } return false; },
  useMeds(b) { let hp = b.hp ?? 100; while (hp < 65) { if (b.inv.take('medkit', 1)) hp += 50; else if (b.inv.take('bandage', 1)) hp += 14; else break; } b.hp = Math.min(100, hp); },
  /** far away it died out there: its stuff is in a bag at the site, it wakes up at its sleeping bag later */
  dieAbstract(b, x, z, by) {
    const inv = new Inv(40);
    for (const v of [b.inv.belt, b.inv.main]) for (const s of v.items()) inv.addStack(s);
    for (const k of ['helmet', 'armor', 'bag']) if (b.inv.equip[k]) inv.addStack(b.inv.equip[k]);
    if (!inv.empty() && G.W.walkable(x, z) && !G.W.isWater(x, z)) { const bag = Live.dropInv(x + rand(-3, 3), z + rand(-3, 3), inv, 'bag', 900); bag.corpse = b.name; }
    b.inv = new PlayerInv(); b.inv.belt.add('rock', 1); b.inv.belt.add('torch', 1);
    const T = b.trip; this.endTrip(b); if (T && T.k === 'mon') b.monCd = G.t + rand(900, 1500);
    b.dead = true; b.respawnAt = G.t + rand(60, 140); b.hp = 0; b.deaths = (b.deaths || 0) + 1;
    if (G.ui && G.ui.killFeed) G.ui.killFeed(by + ' ✕ ' + b.name);
  },
  // ---------------------------------------------------------------- far away: cheap progress
  abstract(b, dt) {
    b.at = (b.at || 0) + dt; if (b.at < 2) return; const step = b.at; b.at = 0;
    this.abstractStep(b, step);
  },
  /** far away: walk (b.x, b.z) toward a point at spd m/s (water too: it swims, but only shows up again on dry land); returns the distance left */
  travel(b, x, z, step, spd) {
    const d = dist(b.x, b.z, x, z); if (d < 0.5) return d;
    const k = Math.min(1, spd * step / d); b.x = clamp(b.x + (x - b.x) * k, 4, WORLD - 4); b.z = clamp(b.z + (z - b.z) * k, 4, WORLD - 4); return d * (1 - k);
  },
  abstractStep(b, step) {
    b.food = Math.max(20, b.food - step * 0.05); b.water = Math.max(20, b.water - step * 0.06);
    if ((b.hp ?? 100) < 100 && b.food > 30 && b.water > 30) b.hp = Math.min(100, (b.hp ?? 100) + step * 0.25);
    // its base is being raided: back home at a run (it shows up once it's near you, and fights)
    if (b.defend && this.defending(b, b.x, b.z)) { this.travel(b, b.defend.x + rand(-3, 3), b.defend.z + rand(-3, 3), step, 5.5); return; }
    const night = G.night > 0.55, raidNow = night && b.raidNight === G.day && Build.tc && this.boom(b) > 0;
    if (b.trip && !raidNow) { this.tripAbstract(b, step); return; } // out on a monument run / after an event
    const goHome = night && b.home && !raidNow;
    // move toward a work spot / home (raiders: toward your base)
    const tgt = raidNow ? { x: Build.tc.x, z: Build.tc.z } : goHome ? b.home : b.plan ? { x: b.plan.cx, z: b.plan.cz } : b.wander || (b.wander = { x: b.x + rand(-60, 60), z: b.z + rand(-60, 60) });
    const d = dist(b.x, b.z, tgt.x, tgt.z);
    if (d > 3) { const k = Math.min(1, 3.4 * step / d); const nx = b.x + (tgt.x - b.x) * k, nz = b.z + (tgt.z - b.z) * k; if (G.W.walkable(nx, nz) && !G.W.isWater(nx, nz)) { b.x = nx; b.z = nz; } else b.wander = null; }
    else if (!b.plan) b.wander = null;
    if (goHome || raidNow) return;
    const inv = b.inv, atHome = !!b.plan && d < 10;
    // gather (better tools gather more), scavenge crates / roadside barrels / monuments by gear. Wood and stone
    // stop once there's enough for the base (Bots.cap): that time goes into ore and scavenging instead.
    const axe = inv.count('salv_axe') ? 1.6 : inv.count('hatchet') ? 1 : 0.45, pk = inv.count('salv_pick') ? 1.6 : inv.count('pickaxe') ? 1 : 0.45;
    const wC = this.capped(b, 'wood'), sC = this.capped(b, 'stone'), free = (wC ? 0.5 : 0) + (sC ? 0.5 : 0);
    // ...and it goes after what the gun / ammo / explosives it's saving up for are missing
    const wm = (this.craftWant(b) || {}).miss, boom = this.wantsBoom(b);
    const wantS = boom || wm === 'sulfur' || wm === 'sulfur_ore' || wm === 'gunpowder', wantM = wm === 'metal' || wm === 'metal_ore', wantH = wm === 'hqm' || wm === 'hqm_ore';
    const wantL = !!wm && ['scrap', 'rope', 'pipe', 'gears', 'tape', 'spring', 'circuit', 'explosives', 'gunpowder', 'low_fuel'].includes(wm);
    if (!wC) inv.add('wood', Math.round(9 * axe * step));
    if (!sC && chance(0.5)) inv.add('stone', Math.round(7 * pk * step));
    if ((wantM || !this.metalRich(b)) && chance(0.35 + free * 0.15 + (wantM ? 0.3 : 0))) inv.add('metal_ore', Math.round(2.4 * pk * step));
    if (wantS && chance(0.45 + free * 0.2)) inv.add('sulfur_ore', Math.round(2.2 * pk * step));
    if (wantH && chance(0.04 * step)) inv.add('hqm_ore', randi(2, 5));
    if (chance((wm === 'cloth' ? 0.12 : 0.06) * step) && this.have(b, 'cloth') < 600) inv.add('cloth', randi(6, 12));
    if (chance((wm === 'leather' || wm === 'animal_fat' ? 0.06 : 0.025) * step) && this.have(b, 'leather') < 250) { inv.add('leather', randi(3, 6)); inv.add('animal_fat', randi(2, 5)); }
    if (chance(0.03 * step * (1 + free * 0.6 + (wantL || wantH ? 0.4 : 0)))) { const g = this.gearLevel(b); const tbl = g >= 2 && chance(0.4) ? 'military' : chance(0.45) ? 'barrel' : chance(0.35) ? 'toolbox' : 'crate'; rollInto(inv.main, LOOT[tbl], 0); this.learn(b); b.looted = (b.looted || 0) + 1; this.equipBest(b); }
    // smelting at home (or charcoal from a campfire); burning wood on its own when it wants charcoal for gunpowder
    if (b.furnace && !b.furnace.dead) {
      for (const [o, out] of [['metal_ore', 'metal'], ['sulfur_ore', 'sulfur'], ['hqm_ore', 'hqm']]) { const k = Math.min(this.have(b, o), Math.round(3 * step)); if (k > 0 && this.have(b, 'wood') > 50) { this.pay(b, o, k); inv.add(out, k); this.pay(b, 'wood', Math.ceil(k / 4)); if (this.have(b, 'charcoal') < 1500) inv.add('charcoal', Math.ceil(k / 2)); } }
      if (wm === 'charcoal' || (boom && this.have(b, 'charcoal') < 120)) { const k = Math.min(Math.round(2 * step), this.have(b, 'wood') - 400); if (k > 0) { this.pay(b, 'wood', k); inv.add('charcoal', Math.ceil(k / 2)); } }
    } else if ((boom || wm === 'charcoal') && chance(0.3)) inv.add('charcoal', Math.round(step));
    // a trip to a recycler now and then (with the junk from its boxes)
    if (chance(0.02 * step) && this.recyclables(b).length + (atHome ? 2 : 0) >= 3) this.recycleAll(b, true);
    // gear
    const cr = this.nextCraft(b); if (cr) this.craftNow(b, cr.r, cr.n);
    // the base
    if (!b.plan && inv.count('wood') >= 500 && G.day >= (b.spawnDay || 1)) { const site = this.findSite(b, { x: b.x, z: b.z }); if (site) { b.plan = site; b.planI = 0; b.home = { x: site.cx, z: site.cz }; } }
    if (b.plan) {
      if ((b.recheckT = (b.recheckT || 0) - step) <= 0) { b.recheckT = 30; this.recheck(b); }
      if (b.planI >= b.plan.steps.length) this.nextStage(b);
      if (atHome && b.planI < b.plan.steps.length) { const r = this.placeStep(b, b.plan.steps[b.planI]); if (r !== null) { b.planI++; b.waitT = 0; } else if ((b.waitT = (b.waitT || 0) + step) > 300) { (b.skipped = b.skipped || []).push(b.planI); b.planI++; b.waitT = 0; } } // stuck on a rare material: move on, a recheck comes back to it
    }
    if (atHome) { if ((b.depT = (b.depT || 0) - step) <= 0 || this.wantsDeposit(b)) { b.depT = 60; this.depositAll(b); } if (this.tcLow(b)) this.stockTc(b); }
    // now and then: a monument run or an event (it travels there, and the trip plays out far away)
    this.tripCheck(b, null);
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
  gift(b, id, n) { const g = this.grudging(b); b.inv.add(id, n); b.rel = Math.min(1, b.rel + (g ? 0.05 : 0.25)); say(b, g ? 'grudge' : 'gift'); this.equipBest(b); }, // a grudge isn't bought off that easily
  askTeam(b) {
    if (b.team) { b.team = false; if (b.actor) b.actor.team = 'bot:' + b.id; G.ui.say(b.actor, b.name, 'ok, see ya'); return false; }
    if (this.grudging(b)) { G.ui.say(b.actor, b.name, 'after you blew up my base? no'); return false; }
    const teamSize = this.list.filter(o => o.team).length;
    if (b.rel >= 0.6 && b.persona !== 'hostile' && teamSize < 2) { b.team = true; if (b.actor) b.actor.team = 'player'; say(b, 'team'); return true; }
    G.ui.say(b.actor, b.name, b.persona === 'hostile' ? 'lol no' : b.rel < 0.2 ? 'i dont even know you' : 'maybe later'); return false;
  },
};

// explosions (combat.js explode): a player blowing up a survivor's base
G.onBoom = (x, z, def, owner) => Bots.onBoom(x, z, def, owner);

// ---------------------------------------------------------------- helpers
function nearestGather(x, z, r, res) {
  // metal / sulfur: those nodes only (searched further out); no sulfur node near -> any rock
  if (res === 'sulfur' || res === 'metal') { let best = null, bd = r * 2 * r * 2; for (const n of G.nodes) { if (n.gone || (res === 'metal' ? n.type !== 'metal' && n.type !== 'hqm' : n.type !== 'sulfur')) continue; const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; } } if (best || res === 'metal') return best; res = 'ore'; }
  if (res === 'ore') { let best = null, bd = r * r; for (const n of G.nodes) { if (n.gone) continue; const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; } } return best; }
  const v = Live.vegNear(x, z, r, TREE_KINDS); return v && v.kind !== 'cactus' ? v : null;
}
/**
 * the cargo ship (cargo.js frame: u along the hull, v across, port = the quay side): deck waypoints from where a is to the
 * gap in the rail by the gangway. Aft, the port walkway is cluttered (a barrel and a toolbox), so: down the ramp off the
 * bridge / out of the superstructure's door, round the starboard side and across in the gap between the container blocks.
 */
function shipExit(S, a) {
  const [u] = S.toLocal(a.x, a.z), out = [];
  if (u > -5.9) return out; // forward of the aft container block: the port walkway is clear
  if (a.y > WATER_Y + DECK + 1.5) out.push([-24, 5.5], [-13.6, 5.5]);              // the bridge: down the ramp
  else { if (u < -25.6) out.push([-24.8, 0]); out.push([-12.8, 3.4]); }             // the superstructure door, then past the ramp's handrail
  out.push([-12.2, 5.8], [-4, 5.8], [-4, -6.1]);                                       // the starboard walkway and across through the gap
  return out;
}
/** the ground doesn't rise into the line from a's gun to t's chest (four samples along it) */
function clearShot(a, t) {
  const y0 = (a.y ?? 0) + 1.45, y1 = (t.y ?? 0) + 1.0;
  for (let k = 1; k <= 4; k++) { const f = k / 5, x = a.x + (t.x - a.x) * f, z = a.z + (t.z - a.z) * f; if (G.W.height(x, z) > y0 + (y1 - y0) * f - 0.15) return false; }
  return true;
}
function findWater(x, z) { let best = null, bd = 120 * 120; for (const l of G.W.lakes) { const d = (l.x - x) ** 2 + (l.z - z) ** 2; if (d < bd) { bd = d; const ang = Math.atan2(z - l.z, x - l.x); best = { x: l.x + Math.cos(ang) * (l.r + 0.5), z: l.z + Math.sin(ang) * (l.r + 0.5) }; } } return best; }
function recyclerNear(x, z) { let best = null, bd = 380 * 380; for (const u of G.uses) { if (u.type !== 'recycler') continue; const d = (u.x - x) ** 2 + (u.z - z) ** 2; if (d < bd) { bd = d; best = u; } } return best; }
/** a barrel along a road (they line the roads) not looted lately */
function roadsideBarrel(x, z) { let best = null, bd = 180 * 180; for (const c of G.containers) { if (c.gone || !c.def.breakable || c.mon || (c.botLooted && G.t - c.botLooted < 300)) continue; const d = (c.x - x) ** 2 + (c.z - z) ** 2; if (d < bd && G.W.isRoad && G.W.isRoad(c.x, c.z, 6)) { bd = d; best = c; } } return best; }
function nearestMon(x, z, maxTier) { let best = null, bd = 260 * 260; for (const m of G.monuments) { if (m.def.tier > maxTier || m.def.safe) continue; const d = (m.x - x) ** 2 + (m.z - z) ** 2; if (d < bd) { bd = d; best = m; } } return best; }

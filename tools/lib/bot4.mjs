// The colony bot v4 (Stage Z2, EMBERCROWN-FORTRESS.md 8.4 step Z2.11; owner J). Pure ESM with relative imports and
// no Node built-ins (runs in Node and in a browser page, like bots v2 and v3).
//
// v4 plays bot v3 (v2's policy on the surface of a 128 x 128 x 20 fortress plus v3's deep plan: the stair shaft to
// -6, bedrooms on -2, the workshop hall on -3, the store on -6) and adds a player's answers to every Z2 system:
//   halls     a hall level on -4 off the shaft: a corridor, a tavern (a dice table, a table and stools), a temple
//             (a shrine), a Lockup (a cell bed behind a door) and an office (a table and a chair), each with a door
//   offices   each player office as it opens goes to the best free colonist for it (Steward: Social; Reckoner:
//             Lore; Chief Healer: Medicine; Keeper of Records: Lore; Marshal: Melee), the Warden of Law likewise;
//             the Steward keeps 30 meals as a stock target
//   squads    every soldier joins squad 1 (squad 2 past 8); the alert goes to Muster while a raid is Sighted or on and
//             back to Peace when it ends
//   burial    a memorial slab once a colonist's body is lost (the mason engraves the name)
//   add-ons   a cutting yard beside the first mason bench once Masonry is known
//   winch     a channel column beside the shaft from -1 to -5 (mined, then channelled twice), and a winch over it on
//             the surface whose foot is the store level on -6
//   petitions a petition letter is answered yes while the hold has room (POP_CAP4) and two days of food
//   drink     the tavern needs drink: Brewing is researched, a brewery and a fermenting cask go in a brewhouse on -4, and
//             'until' bills keep a little wort and a dozen drinks (traders' drink is bought too: v2's Q.drinkWant)
//   seizures  a seizure's demand gets its bills (smelt, cut) and a vein of the ore it needs dug, once per demand
//   v2 knobs  joiners up to POP_CAP4 (Q.popCap) and fields x1.6 (Q.growMul: a fortress winters on its stores)
// The run plays Warden (DIFFICULTY4), as the soak does.
// Meters (read only): renown known, artifacts (seizures), noble satisfaction (the Thane's and Lord's needs met),
// births, cases and sentences, petitions, halls, soldiers, winch uses, Unrested days, mood at day 100.
// The same seed gives the same command log and the same final hash.
import { TICKS_PER_DAY, TICKS_PER_HOUR, START_TICK } from '../../js/game/core/time.js';
import { idx, TER, TER_MINEABLE, TER_UP, TER_DOWN, TER_BUILDABLE, inB } from '../../js/game/core/grid.js';
import { structDef, sizeOf, def, all } from '../../js/game/core/content.js';
import { SKILL_IDS, FIX } from '../../js/game/core/schema.js';
import { runBot2 } from './bot2.mjs';
import { foundFortress, makeDeep, makeMeter3, evaluate3, TARGETS_Z1 } from './bot3.mjs';
import { setBotLevel, oreRect } from './bot.mjs';
import { totals, totalsMat } from '../../js/game/work/items.js';
import { depositId } from '../../js/game/world/defs.js';
import { pendingLetters } from '../../js/game/threat/letters.js';
import { officesView } from '../../js/game/colony/offices.js';
import { justiceView, casesOf } from '../../js/game/colony/justice.js';
import { renownLines } from '../../js/game/colony/renown.js';
import { hallsOf } from '../../js/game/colony/visitors.js';
import { restingList, unrestedDays, slabNames } from '../../js/game/people/death.js';
import { hasTech, eraOpen } from '../../js/game/colony/research.js';
import { winchUses } from '../../js/game/colony/verbs/winch.js';
import { lifeStage } from '../../js/game/people/family.js';
import { foodDays } from '../../js/game/work/givers/animals.js';
import { legendRecords } from '../../js/game/colony/legends.js';

export const POP_CAP4 = 20;          // v2 keeps 16; v4 makes room for petitioners and children (Thane at 15, Lord at 20)
// The 200-day run plays Warden, as the soak does (the difficulty a careful player should never lose on): at Steadfast
// the v2 policy's line by the Hearth loses a colonist a week to raids and wounds over 200 days and two of five holds fell
export const DIFFICULTY4 = 'warden';
export const HALL_DAY = 20;          // the hall level is dug from day 20 (the first rooms and the shaft first)
export const TARGETS_Z2 = Object.freeze({
  days: 200, artifacts: [2, 4], moodAt100: 45, thaneBy: 120, lordBy: 250, knownBy: 150, winchBy100: 50, soldiersBy120: 10,
  hallsBy150: 2, petitionsBy150: 2, wardenBy: 150, unrestedMax: 10, confinedMax: 5, saveKB: 110, tickP95: 1.0,
});

const OFFICE_SKILL = { steward: 'social', reckoner: 'lore', marshal: 'melee', healer: 'medicine', keeper: 'lore' };
const live = (s) => s.col.filter((c) => c && !c.hp.dead);
const rect = (x0, y0, x1, y1, z) => ({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), z });

/** v3's deep player with the Z2 answers layered on (see the header). */
export function makeZ2(s, deep, base = null, opts = {}) {
  const zS = s.zS, T = s.L.terrain;
  const Z = { notes: [], planned: false, rooms: [], furnished: new Set(), winch: { st: 'wait', x: 0, y: 0 }, held: new Map(), alert: 'peace', slabs: 0, addon: false, stock: false, petitions: [0, 0] };
  const day = () => Math.floor((s.tick - START_TICK) / TICKS_PER_DAY) + 1;
  if (base) { base.Q.popCap = POP_CAP4; base.Q.growMul = 1.6; }   // v2's letters take joiners up to v4's cap; larger fields for the winter
  const note = (t) => { Z.notes.push(`d${day()} ${t}`); deep.notes.notes.push(`[v4] ${t}`); };
  const allRock = (r, m = 1) => { for (let y = r.y0 - m; y <= r.y1 + m; y++) for (let x = r.x0 - m; x <= r.x1 + m; x++) { if (!inB(x, y)) return false; const i = idx(x, y, r.z); if (!TER_MINEABLE[T[i]] || (s.L.fluid && s.L.fluid[i])) return false; } return true; };

  // the hall level on -4 (pushed into v3's room plan: v3 digs it once the stairs reach it and doors the necks)
  function planHalls() {
    const sh = deep.D3.shaft, x0 = sh.x0, y0 = sh.y0, z = zS - 4;
    const want = [
      { use: 'corridor4', rect: rect(x0 + 1, y0 + 1, x0 + 1, y0 + 13, z) },
      { use: 'tavern', rect: rect(x0 + 3, y0 + 2, x0 + 8, y0 + 6, z), neck: { x: x0 + 2, y: y0 + 4 } },
      { use: 'temple', rect: rect(x0 - 4, y0 + 2, x0 - 1, y0 + 5, z), neck: { x: x0, y: y0 + 3 } },
      { use: 'lockup', rect: rect(x0 - 3, y0 + 7, x0 - 1, y0 + 9, z), neck: { x: x0, y: y0 + 8 } },
      { use: 'office', rect: rect(x0 + 3, y0 + 8, x0 + 5, y0 + 10, z), neck: { x: x0 + 2, y: y0 + 9 } },
      { use: 'brewhouse', rect: rect(x0 - 4, y0 + 11, x0 - 1, y0 + 14, z), neck: { x: x0, y: y0 + 12 } },
    ];
    for (const q of want) {
      if (!allRock(q.rect, q.use === 'corridor4' ? 0 : 1)) { note(`hall level: no rock for the ${q.use}`); continue; }
      const room = { z, use: q.use, rect: q.rect, neck: q.neck };
      deep.D3.rooms.push(room); Z.rooms.push(room);
    }
    deep.D3.done = 0;   // v3's digger goes on to the new rooms
    note(`hall level on -4: ${Z.rooms.map((q) => q.use).join(', ')}`);
  }
  // furnish a dug hall room once (v3 has placed its door)
  const FURNISH = {
    tavern: (r) => [['dicetable', r.x0 + 1, r.y0 + 1], ['table', r.x0 + 3, r.y0 + 2], ['stool', r.x0 + 3, r.y0 + 1], ['stool', r.x0 + 4, r.y0 + 3], ['sconce', r.x1, r.y1]],
    temple: (r) => [['shrine', r.x0 + 1, r.y0 + 1], ['sconce', r.x1, r.y1]],
    lockup: (r) => [['cellbed', r.x0 + 1, r.y0]],
    office: (r) => [['table', r.x0 + 1, r.y0], ['chair', r.x0 + 1, r.y0 + 1], ['sconce', r.x1, r.y1]],
  };
  function furnish() {
    const cmds = [];
    for (const q of Z.rooms) {
      if (!q.dug || Z.furnished.has(q) || !FURNISH[q.use]) continue;
      Z.furnished.add(q);
      for (const [d, x, y] of FURNISH[q.use](q.rect)) if (structDef(d)) cmds.push({ t: 'place', def: d, x, y, z: q.z, rot: 0 });
      note(`${q.use} on -4 furnished`);
    }
    return cmds;
  }

  // the winch column: (x0 + 3, y0) beside the shaft, from -1 down to -5, the winch on the surface over it
  function winchStep() {
    const w = Z.winch, sh = deep.D3.shaft;
    if (!sh || w.st === 'done' || w.st === 'none') return [];
    if (w.st === 'wait') {
      // the shaft reaches -6 first; the column must be rock (no fluid) from -1 to -6, beside the shaft, with free
      // surface ground over it and for its landing (the first of a few columns east and west of the shaft that fits)
      if (!(TER_UP[T[idx(sh.x0 + 1, sh.y0, zS - 6)]] === 1)) return [];
      if (!structDef('winch')) { w.st = 'none'; return []; }
      const fits = (x, y) => {
        if (!inB(x, y) || !inB(x + 1, y)) return false;
        for (let z = zS - 6; z <= zS - 1; z++) { const i = idx(x, y, z); if (!TER_MINEABLE[T[i]] || (s.L.fluid && s.L.fluid[i]) || s.L.desig[i]) return false; }
        for (const xx of [x, x + 1]) { const i = idx(xx, y, zS); if (s.rt.occ[i] >= 0 || s.L.zone[i] || TER_MINEABLE[T[i]] || TER_UP[T[i]] || TER_DOWN[T[i]]) return false; }
        return true;
      };
      const cand = [[sh.x0 + 3, sh.y0], [sh.x0 - 2, sh.y0], [sh.x0 + 4, sh.y0], [sh.x0 - 3, sh.y0], [sh.x0 + 5, sh.y0], [sh.x0 - 4, sh.y0]];
      const at = cand.find(([x, y]) => fits(x, y));
      if (!at) { w.st = 'none'; note('winch: no rock column beside the shaft'); return []; }
      w.st = 'mine'; w.x = at[0]; w.y = at[1];
      note(`winch column at ${w.x},${w.y} from -1 to -5`);
      // a 1-tile neck from the shaft's stair on -1 to the column (the miner reaches it from the stairs)
      const nx = w.x > sh.x1 ? [sh.x1 + 1, w.x] : [w.x, sh.x0 - 1];
      return [{ t: 'designate', kind: 'mine', rect: rect(nx[0], w.y, nx[1], w.y, zS - 1), add: true }];
    }
    const x = w.x, y = w.y, col = (z) => T[idx(x, y, z)];
    if (w.st === 'mine') {
      if (TER_MINEABLE[col(zS - 1)]) return [];
      w.st = 'ch1';
      return [{ t: 'designate', kind: 'channel', rect: rect(x, y, x, y, zS - 1), levels: 5, add: true }];
    }
    if (w.st === 'ch1') {
      if (col(zS - 5) === TER.RAMP_TOP || col(zS - 5) === TER.AIR) { w.st = 'ch2'; return [{ t: 'designate', kind: 'channel', rect: rect(x, y, x, y, zS - 1), levels: 5, add: true }]; }
      return [];
    }
    if (w.st === 'ch2') {
      for (let z = zS - 5; z <= zS - 1; z++) if (col(z) !== TER.AIR) return [];
      w.st = 'place';
      note('winch column open: the winch goes over it');
    }
    if (w.st === 'place') {
      // (the winch needs Support pillars: retried every 6 hours until it is planned)
      if (s.bld.some((b) => b && b.def === 'winch')) { w.st = 'done'; note('winch planned'); return []; }
      if (s.tick % (6 * TICKS_PER_HOUR) !== 0) return [];
      // the winch needs Support pillars: research it first (a player would)
      if (!hasTech(s, 'supports')) { if (s.colony.research.cur !== 'supports' && eraOpen(s, (def('tech', 'supports') || {}).era)) { note('research Support pillars for the winch'); return [{ t: 'research', tech: 'supports' }]; } return []; }
      return [{ t: 'place', def: 'winch', x, y, z: zS, rot: 3 }];
    }
    return [];
  }

  // the tavern's drink (Z2.8: a tavern needs drink in store): research Brewing, a brewery and a fermenting cask in the
  // brewhouse on -4, and bills that keep a little wort and a dozen drinks (berry wine, ale or glowcap spirit)
  const BREW = { st: 'wait' };
  function brew() {
    const room = Z.rooms.find((q) => q.use === 'brewhouse' && q.dug);
    if (!room) return [];
    if (!hasTech(s, 'brewing')) {
      // (Support pillars first while the winch waits for it)
      if (Z.winch.st === 'place' && !hasTech(s, 'supports')) return [];
      const era = (def('tech', 'brewing') || {}).era;
      if (s.colony.research.cur !== 'brewing' && era && eraOpen(s, era) && s.tick % (6 * TICKS_PER_HOUR) === 0) { note('research Brewing for the tavern'); return [{ t: 'research', tech: 'brewing' }]; }
      return [];
    }
    const r = room.rect, cmds = [];
    const has = (d) => s.bld.find((b) => b && b.def === d && (b.z | 0) === room.z && b.x >= r.x0 && b.x <= r.x1 && b.y >= r.y0 && b.y <= r.y1);
    if (BREW.st === 'wait') { BREW.st = 'placed'; note('brewery and cask in the brewhouse'); return [{ t: 'place', def: 'brewery', x: r.x0, y: r.y0, z: room.z, rot: 0 }, { t: 'place', def: 'cask', x: r.x1, y: r.y1, z: room.z, rot: 0 }]; }
    const br = has('brewery'), ck = has('cask');
    if (BREW.st === 'placed' && br && br.st === 'done' && ck && ck.st === 'done') {
      BREW.st = 'billed';
      for (const rec of ['wine_wort', 'ale_wort', 'glowcap_spirit']) if (def('recipe', rec)) cmds.push({ t: 'bill', op: 'add', bId: br.id, bill: { recipe: rec, mode: 'until', n: rec === 'glowcap_spirit' ? 8 : 2 } });
      for (const rec of ['ferment_wine', 'ferment_ale']) if (def('recipe', rec)) cmds.push({ t: 'bill', op: 'add', bId: ck.id, bill: { recipe: rec, mode: 'until', n: 12 } });
      note('brew bills set');
    }
    return cmds;
  }

  // offices and the Warden: each open, empty player office to the best free colonist for its skill
  function offices() {
    const cmds = [];
    const v = officesView(s);
    const holding = new Set(v.filter((o) => o.holder).map((o) => o.holder.id));
    const jv = justiceView(s);
    if (jv.warden) holding.add(jv.warden.id);
    const free = live(s).filter((c) => !holding.has(c.id) && lifeStage(c) === 'adult' && !c.hp.down);
    const best = (sk) => { const k = SKILL_IDS.indexOf(sk); return free.slice().sort((a, b) => b.sk[k][0] - a.sk[k][0] || a.id - b.id)[0] || null; };
    for (const o of v) {
      if (o.by !== 'player' || !o.open || o.holder) continue;
      const c = best(OFFICE_SKILL[o.id] || 'social');
      if (!c) break;
      cmds.push({ t: 'office', id: o.id, colId: c.id });
      free.splice(free.indexOf(c), 1);
      note(`office ${o.id}: ${c.name}`);
    }
    if (jv.on && jv.open && !jv.warden) {
      const c = best('social');
      if (c) { cmds.push({ t: 'warden', colId: c.id }); note(`Warden of Law: ${c.name}`); }
    }
    if (!Z.stock && v.some((o) => o.id === 'steward' && o.holder)) { Z.stock = true; cmds.push({ t: 'stockTarget', k: 'meal', n: 30 }); note('the Steward keeps 30 meals'); }
    return cmds;
  }

  // squads: soldiers into squad 1 (2 past eight); the alert follows the raids
  function squads() {
    const cmds = [];
    // from 10 colonists every grown colonist is a soldier too (they work at Peace and stand to at Muster)
    if (live(s).length >= 10) for (const c of live(s)) if (!c.soldier && lifeStage(c) === 'adult' && !c.hp.down) cmds.push({ t: 'soldier', colId: c.id, on: true });
    const sol = live(s).filter((c) => c.soldier && lifeStage(c) === 'adult');
    const add1 = sol.filter((c) => c.squad === null || c.squad === undefined).map((c) => c.id);
    if (add1.length) {
      const in1 = sol.filter((c) => c.squad === 1).length;
      const n1 = add1.slice(0, Math.max(0, 8 - in1)), n2 = add1.slice(n1.length);
      if (n1.length) cmds.push({ t: 'squad', id: 1, add: n1 });
      if (n2.length) cmds.push({ t: 'squad', id: 2, add: n2 });
    }
    const raid = s.raids.some((r) => r.stage === 'sighted' || r.stage === 'imminent' || r.stage === 'active');
    const want = raid ? 'muster' : 'peace';
    if (sol.length && want !== Z.alert) { Z.alert = want; cmds.push({ t: 'alert', level: want }); }
    return cmds;
  }

  // burial: a memorial slab for the lost (one slab names six)
  function slabs() {
    const lost = restingList(s).filter((r) => r.lost && r.days >= 1).length;
    const slabs = s.bld.filter((b) => b && b.def === 'memorial_slab'), have = slabs.length;
    // room left on the slabs (six names each; a slab not yet built has all six)
    const room = slabs.reduce((n, b) => n + 6 - (b.st === 'done' ? slabNames(s, b.id).length : 0), 0);
    if (!lost || room >= lost || Z.slabs > have || !structDef('memorial_slab') || s.tick % (6 * TICKS_PER_HOUR) !== 0) return [];
    const h = s.bld[s.colony.hearth.id];
    if (!h) return [];
    // a free, explored tile of open ground a few tiles from the Hearth (ring by ring)
    for (let r = 4; r < 14; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = h.x + dx, y = h.y + dy;
      if (!inB(x, y)) continue;
      const i = idx(x, y, zS);
      if (s.rt.occ[i] >= 0 || s.L.zone[i] || s.L.plant[i] || s.L.desig[i] || !TER_BUILDABLE[T[i]] || TER_UP[T[i]] || TER_DOWN[T[i]]) continue;
      Z.slabs++;
      note(`memorial slab for ${lost} lost at ${x},${y}`);
      return [{ t: 'place', def: 'memorial_slab', x, y, z: zS, rot: 0 }];
    }
    return [];
  }

  // a seizure's demand (3.3): a player sets bills for what is short (an ingot is smelted, blocks are cut) and digs a
  // vein of the ore it needs, once per demand
  function demandHand() {
    const em = s.colony.ember;
    if (!em || em.met >= 0 || em.kind === 'whispered' || Z.demand === em.start || !base) return [];
    Z.demand = em.start;
    const cmds = [], bits = [];
    for (const d of em.demand || []) {
      if (!Array.isArray(d)) continue;
      const [k, m, n] = d;
      const have = m ? totalsMat(s, k, m) : totals(s, k);
      if (have >= n) continue;
      const r = all('recipe').find((x) => (x.out || []).some((o) => o.k === k) && (!m || (x.in || []).some((i) => i.mat === m) || x.id.endsWith('_' + m)) && (!x.tech || hasTech(s, x.tech)) && s.bld.some((b) => b && b.st === 'done' && x.bench.includes(b.def)));
      if (r) {
        const b = s.bld.find((q) => q && q.st === 'done' && r.bench.includes(q.def) && q.bills && q.bills.length < 10);
        const per = Math.max(1, (r.out.find((o) => o.k === k) || { n: 1 }).n | 0);
        if (b) { cmds.push({ t: 'bill', op: 'add', bId: b.id, bill: { recipe: r.id, mode: 'count', n: Math.ceil((n - have) / per) } }); bits.push(`${r.id} x${Math.ceil((n - have) / per)}`); }
        const oreIn = (r.in || []).find((i) => i.k === 'ore' && i.mat);
        if (oreIn && totalsMat(s, 'ore', oreIn.mat) < oreIn.n * Math.ceil((n - have) / per)) {
          const v = base.api.oreDig(depositId(oreIn.mat));
          if (v && v.length) { for (const i of v) cmds.push({ t: 'designate', kind: 'mine', rect: oreRect(s, i), add: true }); bits.push(`dig ${oreIn.mat} (${v.length})`); }
        }
      }
    }
    if (bits.length) note(`seizure demand: ${bits.join(', ')}`);
    return cmds;
  }

  // add-ons: a cutting yard beside the first finished mason bench (Masonry)
  function addons() {
    if (Z.addon || !structDef('cutting_yard') || !hasTech(s, 'masonry')) return [];
    const m = s.bld.find((b) => b && b.def === 'mason' && b.st === 'done');
    if (!m) return [];
    const [w, h] = sizeOf(structDef(m.def), m.rot | 0);
    for (const [x, y] of [[m.x + w, m.y], [m.x - 1, m.y], [m.x, m.y + h], [m.x, m.y - 1]]) {
      const i = idx(x, y, m.z | 0);
      if (!inB(x, y) || s.rt.occ[i] >= 0 || s.L.zone[i] || TER_MINEABLE[T[i]] || TER_UP[T[i]] || TER_DOWN[T[i]]) continue;
      Z.addon = true;
      note(`cutting yard beside the mason at ${m.x},${m.y} (${(m.z | 0) - zS})`);
      return [{ t: 'place', def: 'cutting_yard', x, y, z: m.z | 0, rot: 0 }];
    }
    return [];
  }

  // petitions: yes while there is room and food
  function petitions() {
    const cmds = [];
    for (const l of pendingLetters(s)) {
      if (!l.data || l.data.k !== 'petition' || Z.held.has(l.id)) continue;
      const ok = live(s).length < POP_CAP4 && foodDays(s) >= 6;
      Z.held.set(l.id, ok);
      Z.petitions[ok ? 0 : 1]++;
      cmds.push({ t: 'petition', visitorId: l.data.visitorId, accept: ok });
      note(`petition ${l.id}: ${ok ? 'yes' : 'no'}`);
    }
    return cmds;
  }

  return {
    notes: deep.notes,
    D3: deep.D3, Z,
    step() {
      const cmds = deep.step();
      if (s.tick % TICKS_PER_HOUR !== 0) return cmds.concat(petitions());
      // joiners only while the larder holds (a fortress winters on its stores: seed 1 took 8 joiners in autumn and
      // starved 5 in the winter)
      if (base) base.Q.popCap = foodDays(s) >= 12 ? POP_CAP4 : Math.min(POP_CAP4, live(s).length);
      if (deep.D3.shaft && !Z.planned && day() >= HALL_DAY) { Z.planned = true; planHalls(); }
      if (base && Z.furnished.size && !base.Q.drinkWant) { base.Q.drinkWant = 15; note('the tavern wants drink: buy it from traders'); }
      cmds.push(...demandHand(), ...brew(), ...furnish(), ...winchStep(), ...offices(), ...(opts.squads === false ? [] : squads()), ...slabs(), ...addons(), ...petitions());
      return cmds;
    },
  };
}

// ---- measuring (read only) -------------------------------------------------------------------------------------
/** Per-day Z2 meters: the days things first happened and the mood at day 100. */
export function makeMeter4() {
  const X = { first: {}, mood100: null, maxConfinedDays: 0, maxUnrested: 0, soldiersMax: 0, series: [] };
  const firstAt = (k, d, ok) => { if (ok && X.first[k] === undefined) X.first[k] = d; };
  return {
    X,
    onDay(s, d) {
      const L = live(s);
      const v = officesView(s), jv = justiceView(s);
      firstAt('thane', d, v.some((o) => o.id === 'thane' && o.holder));
      firstAt('lord', d, v.some((o) => o.id === 'lord' && o.holder));
      firstAt('warden', d, !!jv.warden);
      firstAt('known', d, renownLines(s).some((r) => r[4]));
      let halls = []; try { halls = hallsOf(s); } catch (_) { halls = []; }
      const kinds = new Set(halls.map((x) => x.id));
      firstAt('tavern', d, kinds.has('tavern'));
      firstAt('hall2', d, kinds.has('tavern') && kinds.size >= 2);
      firstAt('winch50', d, winchUses(s) >= 50);
      const soldiers = L.filter((c) => c.squad !== null && c.squad !== undefined).length;
      X.soldiersMax = Math.max(X.soldiersMax, soldiers);
      firstAt('soldiers10', d, soldiers >= 10);
      if (d === 100) X.mood100 = L.length ? +(L.reduce((a, c) => a + c.mood, 0) / L.length / FIX).toFixed(1) : null;
      X.maxUnrested = Math.max(X.maxUnrested, unrestedDays(s));
      if (d % 25 === 0) X.series.push({ day: d, pop: L.length, kids: L.filter((c) => lifeStage(c) !== 'adult').length, winch: winchUses(s), soldiers, cases: casesOf(s).length });
    },
  };
}

/** The Z2 rows of one finished run (the gate reads `checks`; `info` rows are reported only). */
export function evaluate4(s, r, X4, z2, days) {
  const T = TARGETS_Z2, X = X4.X, f = X.first, out = {};
  const ppl = s.colony.people || {};
  const fam = s.colony.family || {};
  const v = officesView(s), jv = justiceView(s);
  const noble = v.filter((o) => (o.id === 'thane' || o.id === 'lord') && o.holder).map((o) => `${o.id} ${o.needs.filter((n) => n.met).length}/${o.needs.length} needs met`);
  const cases = casesOf(s);
  const sentenced = cases.filter((k) => k.sent);
  const known = renownLines(s).filter((x) => x[4]).map((x) => x[1]);
  let annals = 0; try { annals = legendRecords(s).length; } catch (_) { annals = 0; }
  const births = (fam.kids || []).length;
  // the confinement meter: a sentence's days (a sentence is pure; the table caps the Lockup at 5)
  const confined = sentenced.filter((k) => k.sent.kind !== 'fine' && !k.sent.commuted).map((k) => k.sent.days | 0);
  out.report = {
    renown: known, artifacts: ppl.seizeN | 0, nobles: noble, births, cases: cases.length, sentences: sentenced.length,
    petitions: { asked: z2.Z.petitions[0] + z2.Z.petitions[1], yes: z2.Z.petitions[0] }, winchUses: winchUses(s), soldiersMax: X.soldiersMax,
    annals, first: f, mood100: X.mood100, maxUnrested: +X.maxUnrested.toFixed(1), series: X.series,
  };
  const by = (k, dd) => f[k] !== undefined && f[k] <= dd;
  const rows = [
    // Z2.1 people
    ['2-4 artifacts by day 200 (Z2.1, 4 of 5)', (ppl.seizeN | 0) >= T.artifacts[0] && (ppl.seizeN | 0) <= T.artifacts[1], `${ppl.seizeN | 0} artifacts`, 'share'],
    [`average mood > ${T.moodAt100} at day 100 (Z2.1)`, X.mood100 === null || X.mood100 > T.moodAt100, `${X.mood100}`, days >= 100 ? null : 'na'],
    // Z2.2 offices
    [`a Thane by day ${T.thaneBy} (Z2.2, 3 of 5)`, by('thane', T.thaneBy), `Thane ${f.thane === undefined ? 'never' : 'day ' + f.thane}`, 'share'],
    [`a Lord by day ${T.lordBy} (Z2.2, 3 of 5)`, by('lord', T.lordBy), `Lord ${f.lord === undefined ? 'not yet' : 'day ' + f.lord} in ${days} days`, days >= T.lordBy ? 'share' : 'info'],
    // Z2.4 renown and the winch
    [`Known for something by day ${T.knownBy} (Z2.4, 4 of 5)`, by('known', T.knownBy), `${known.join(', ') || 'nothing'}${f.known !== undefined ? ` from day ${f.known}` : ''}`, 'share'],
    [`the winch used >= ${T.winchBy100} times by day 100 (Z2.4)`, by('winch50', 100), `${winchUses(s)} uses${f.winch50 !== undefined ? `, 50 on day ${f.winch50}` : ''}; column ${z2.Z.winch.st}`, days >= 100 ? 'share' : 'na'],
    // Z2.5 military
    [`soldiers reach ${T.soldiersBy120} by day 120 (Z2.5, 3 of 5)`, by('soldiers10', 120), `most in squads ${X.soldiersMax}`, days >= 120 ? 'share' : 'na'],
    // Z2.6 burial
    [`no colonist Unrested > ${T.unrestedMax} days (Z2.6)`, X.maxUnrested <= T.unrestedMax, `worst ${X.maxUnrested.toFixed(1)} days`, null],
    // Z2.8 families and halls
    [`a tavern and one other hall by day 150 (Z2.8, 4 of 5)`, by('hall2', 150), `tavern ${f.tavern === undefined ? 'never' : 'day ' + f.tavern}, two halls ${f.hall2 === undefined ? 'never' : 'day ' + f.hall2}`, days >= 150 ? 'share' : 'na'],
    [`>= ${T.petitionsBy150} petitioners accepted (Z2.8)`, z2.Z.petitions[0] >= T.petitionsBy150, `${z2.Z.petitions[0]} yes, ${z2.Z.petitions[1]} no`, days >= 150 ? 'share' : 'na'],
    ['population under the hard cap (Z2.8)', live(s).length < 40, `${live(s).length} living, ${births} born`, null],
    // Z2.12 justice
    [`a Warden by day ${T.wardenBy} (Z2.12, 3 of 5)`, by('warden', T.wardenBy), `Warden ${f.warden === undefined ? 'never' : 'day ' + f.warden}`, days >= T.wardenBy ? 'share' : 'na'],
    [`no colonist confined > ${T.confinedMax} days (Z2.12)`, confined.every((n) => n <= T.confinedMax), `${confined.length} confined, longest ${Math.max(0, ...confined)} days`, null],
    // Z2.3 the Annals
    ['the Annals hold records (Z2.3)', annals > 0, `${annals} records`, null],
  ];
  out.checks = rows.map(([name, ok, detail, kind]) => ({ name, ok: !!ok, detail, share: kind === 'share', info: kind === 'info', na: kind === 'na' }));
  return out;
}

/**
 * Run bot v4 on one seed: runBot2 with bot v3's fortress and deep plan and v4's Z2 answers. Returns runBot2's result
 * plus `z1` (v3's rows), `z2` (evaluate4) and the notes.
 */
export async function runBot4({ seed = 1, days = TARGETS_Z2.days, ticks = null, storyteller = null, difficulty = DIFFICULTY4, blobFn = null, blobEvery = 0, onDay = null, onTick = null, z2opts = {} } = {}) {
  let deep = null, X3 = null, z2 = null;
  const X4 = makeMeter4();
  const r = await runBot2({
    seed, days, ticks, storyteller, difficulty, blobFn, blobEvery,
    onDay: (s, d, row) => { X4.onDay(s, d); if (onDay) onDay(s, d, row); },
    found: (sd, o) => foundFortress(sd, o),
    wrap: (s, base) => { deep = makeDeep(s, base); X3 = makeMeter3(s); z2 = makeZ2(s, deep, base, z2opts); return z2; },
    onTick: (s, p) => { X3.onTick(s); if (onTick) onTick(s, p); },
  });
  const d = ticks !== null ? Math.floor(ticks / TICKS_PER_DAY) : days;
  r.z1 = evaluate3(r.s, r, X3.X, deep, d);
  r.z2 = evaluate4(r.s, r, X4, z2, d);
  r.deepNotes = deep.D3.notes.concat(z2.Z.notes);
  r.bot = 'v4';
  setBotLevel(0);
  return r;
}
export { TARGETS_Z1 };

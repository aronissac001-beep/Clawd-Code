// Great beasts (EMBERCROWN-FORTRESS.md 3.12, F13; step Z3.3). Owner H.
// A great beast is never summoned and never gates anything: it is an incident ('great_beast', cat major, tag
// beast) that only this module schedules, once a day, and only while the beast's cause holds in the world (2.10):
//   generated beast   Opened cavern (the cavern of its lair) or Near lair (its lair row)
//   Gloomwyrm         Rumour of wealth summed >= wyrmRumour (a hoarder); it comes from the sky (a surface edge)
//   Bone Colossus     Near lair (its lair) or the Mere opened
//   Hollow King       the Seal-stone mined (the UI raises one confirmation letter first: js/ui/letters.js
//                     sealAgreed, owner decision 3), a found voxel within kingR planar and kingDz levels of the
//                     Sleep, or (unless the Ember Seal is complete) year >= kingYear with the Hollow's hunger high
// No command reaches this scheduler; the storyteller never picks great_beast itself (weight 0). One great beast on
// the map (or warned) at a time; at least gapD days between arrivals. Warned as a major: Omen 24-48 h, then the
// storyteller's Sighted and Imminent stages. On the Hearthkeeper difficulty beasts come only from Stronghold rank
// (and fight.js already makes their blows down rather than kill).
// The fight uses the colonists' wound model: the beast walks and strikes with its body plan's base stats row;
// its material's armour comes off every blow (BUS.dmgMult), glass and bone shatter under blunt blows (x2 / x1.5),
// its soft zone takes double. Its other attacks run here, each an existing sim effect (ATTACK_FX).
// Below fleePct of its hp a beast flees to its lair (morale rule); it heals healPctSeason a season and may come
// again once at returnPct while its cause holds: a nemesis beast, not a timer. A slain beast leaves its body
// (items by material), a trophy record, the thought slew_beast, a legend record and an Annals page.
// Saved state (s.st.gb, all fields with defaults, so older saves load unchanged):
//   { b: { [key]: { hp (pct), met, fled, slain (day, -1), scars: [text] } }, on: { raid, key } | null, last (day),
//     web: [[colId, untilTick, x, y]], tro: [key] }

import { BUS, registerSystem, tickSystems } from '../../core/bus.js';
import { TER, W, H, PLANE, D } from '../../core/grid.js';
import { hashString } from '../../core/rand.js';
import { dayOf, yearOf, TICKS_PER_HOUR, TICKS_PER_DAY, DAYS_PER_SEASON } from '../../core/time.js';
import { LIT_MIN } from '../../world/light.js';
import { ignite, canBurn } from '../../world/fire.js';
import { addThought, addThoughtAll } from '../../people/mood.js';
import { damage, infect } from '../../people/health.js';
import { spawn as spawnItem } from '../../work/items.js';
import { addLegend, legendEvent } from '../../colony/legends.js';
import { registerIncidentLogic, incidentDef } from '../incidents.js';
import { liveCauses, cavernAtZ, nearFound, dormantRows, causeLine } from '../causes.js';
import { scheduleIncident, onStoryHour, majorPending, RULES } from '../storyteller.js';
import { spawnRaid, addMember, setStage, foeById } from '../raiders.js';
import { edgeTile } from '../raidplan.js';
import { sendLetter, fillText } from '../letters.js';
import { def } from '../defs.js';
import { DATA } from '../../../data/beasts.js';
import { holdBeasts, beastByKey, genBeast, keyOf, ATTACK, MAT, TUNE as K, zoneFor } from './gen.js';
import { BEAST as gloomwyrm } from './gloomwyrm.js';
import { BEAST as colossus } from './colossus.js';
import { BEAST as hollowking } from './hollowking.js';

export { holdBeasts, beastByKey, genBeast, keyOf } from './gen.js';
export const LEGENDS = Object.freeze({ gloomwyrm, colossus, hollowking });
export const LEGEND_IDS = Object.freeze(['gloomwyrm', 'colossus', 'hollowking']);
export const beastOf = (id) => LEGENDS[id] || null;
export const BEAST_INC = 'great_beast';
const TEXT = Object.freeze(Object.fromEntries(DATA.text.map((t) => [t.id, t.text])));
export const beastText = (id, vars = {}) => fillText(TEXT[id] || '', vars);

// The incident row (BUS.incidents, C12): weight 0, so the storyteller's own pick never draws it.
export const BEAST_INCIDENT = Object.freeze({ id: BEAST_INC, cat: 'major', minTier: 'camp', weight: 0, cooldownD: 0, pts: Object.freeze({ min: 1, mult: 0 }),
  warnH: Object.freeze(K.warnH.slice()), arrive: 'any', tags: Object.freeze(['beast', 'great']), letter: 'beast_omen' });

// ---- saved state ---------------------------------------------------------------------------------------------
export function gbOf(s) {
  const st = s.st || (s.st = {});
  const g = st.gb || (st.gb = {});
  if (!g.b) g.b = {};
  if (g.on === undefined) g.on = null;
  if (g.last === undefined) g.last = -1e9;
  if (!g.web) g.web = [];
  if (!g.tro) g.tro = [];
  return g;
}
export function recOf(s, key) {
  const b = gbOf(s).b;
  return b[key] || (b[key] = { hp: 100, met: 0, fled: 0, slain: -1, scars: [] });
}

// ---- causes (pure in s) --------------------------------------------------------------------------------------
const hasCause = (cs, kind, sub) => { for (const c of cs) if (c[0] === kind && (sub === undefined || c[1] === sub)) return c; return null; };
/** Is the Seal-stone mined (any voxel of its 3 x 3 no longer rock)? */
export function sealMined(s, beasts = holdBeasts(s)) {
  const hk = beasts.find((b) => b.legend === 'hollowking');
  if (!hk || !s.L) return false;
  const r = dormantRows(s, 'seal')[0];
  if (!r) return false;
  const v = r[1];
  const z = (v / PLANE) | 0, x0 = v % W, y0 = ((v % PLANE) / W) | 0;
  for (let y = y0 - 1; y <= y0 + 1; y++) for (let x = x0 - 1; x <= x0 + 1; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    if (s.L.terrain[z * PLANE + y * W + x] !== TER.ROCK) return true;
  }
  return false;
}
/** The Ember Seal is complete and the Hearth burns (3.11): the Hollow King cannot wake from time alone. */
export const emberSealHolds = (s) => !!(s.bld && s.bld.some((b) => b && b.def === 'ember_seal' && b.st === 'done')) && ((s.colony && s.colony.hearth && s.colony.hearth.fuel) || 0) > 0;
/** The cause that wakes beast b now: [kind, subject, weight] or null. */
export function beastCause(s, b, cs = liveCauses(s)) {
  const rec = recOf(s, b.key);
  if (rec.slain >= 0 || rec.hp < K.returnPct) return null;
  if (s.colony && s.colony.difficulty === 'hearthkeeper' && (s.colony.tier | 0) < K.keeperTier) return null;
  const L = b.legend ? LEGENDS[b.legend] : null;
  if (L && L.cause) return L.cause(s, b, cs, { hasCause, sealMined, emberSealHolds, nearFound, K, yearOf, dayOf });
  const lair = hasCause(cs, 'near_lair', 'lair:' + b.lair);
  if (lair) return lair;
  const cav = cavernAtZ(b.z);
  return cav ? hasCause(cs, 'opened_cavern', cav) : null;
}
/** The woken beasts now: [[beast, cause]] in row order. */
export const wokenBeasts = (s) => { const cs = liveCauses(s); const out = []; for (const b of holdBeasts(s)) { const c = beastCause(s, b, cs); if (c) out.push([b, c]); } return out; };

// ---- the scheduler (daily; never a command) ------------------------------------------------------------------
const h32 = (s, tag) => hashString(`gb:${(s.seed >>> 0) || 0}:${tag}`);
export const beastPending = (s) => (s.st.queue || []).some((e) => e.inc === BEAST_INC) || !!gbOf(s).on;
/** The daily check (story hour 0): may schedule one warned beast. Returns the queue entry or null. */
export function beastDay(s) {
  if (D <= 1 || !incidentDef(BEAST_INC)) return null;
  const g = gbOf(s), day = dayOf(s.tick);
  if (day % DAYS_PER_SEASON === 0) for (const k of Object.keys(g.b)) { const r = g.b[k]; if (r.slain < 0 && r.hp < 100) r.hp = Math.min(100, r.hp + K.healPctSeason); }
  // (Z3.6) a beast is a major: never beside another, and its arrival keeps RULES.minGapD days from the last (9.1)
  if (beastPending(s) || day - g.last < K.gapD || day < (K.firstDay | 0) || majorPending(s)) return null;
  const woken = wokenBeasts(s);
  if (!woken.length) return null;
  if (h32(s, 'd' + day) % 100 >= K.dayPct) return null;
  let tot = 0; for (const [, c] of woken) tot += Math.max(1, c[2]);
  let r = h32(s, 'p' + day) % tot, pick = woken[0];
  for (const w of woken) { r -= Math.max(1, w[1][2]); if (r < 0) { pick = w; break; } }
  return scheduleBeast(s, pick[0], pick[1]);
}
function entryVoxel(s, b) {
  if (b.legend === 'gloomwyrm') { const i = edgeTile(s, 'n'); return { side: 'n', i: i === null ? 0 : i }; }
  return { side: 'deep', i: b.lair };
}
function scheduleBeast(s, b, cause) {
  const [lo, hi] = K.warnH, hrs = lo + (h32(s, 'w' + s.tick) % (hi - lo + 1));
  const members = [b.base];
  if (b.knights) { const [a, z] = b.knights, n = a + (h32(s, 'k' + s.tick) % (z - a + 1)); for (let k = 0; k < n; k++) members.push('hollow_knight'); }
  const plan = { pts: Math.floor(b.hp / 4), edge: entryVoxel(s, b), goal: (DATA.behaviour.find((x) => x.id === b.beh) || { goal: 'core' }).goal, members, nem: null, lead: 0 };
  const arrive = s.tick + hrs * TICKS_PER_HOUR, last = s.st.lastMajorArrive === undefined ? -Infinity : s.st.lastMajorArrive;
  if (arrive < last + RULES.minGapD * TICKS_PER_DAY) return null;
  s.st.lastMajorArrive = arrive;
  const why = causeText(s, b, cause);
  const e = scheduleIncident(s, BEAST_INC, s.tick, s.tick + hrs * TICKS_PER_HOUR, { plan, gb: b.key, cause: [cause[0], cause[1]], why });
  sendLetter(s, 'incident', { inc: BEAST_INC, text: `${beastText(b.legend === 'gloomwyrm' ? 'beast_omen_sky' : 'beast_omen', { beast: b.name, hours: hrs })} ${why}`.trim() });
  return e;
}
function causeText(s, b, c) {
  if (c[0] === 'seal') return beastText('cause_seal');
  if (c[0] === 'near_lair' && b.legend === 'hollowking') return beastText('cause_sleep');
  if (c[0] === 'hunger' && b.legend === 'hollowking') return beastText('cause_kinghunger');
  // (Z3.6) every other beast's letter names its cause the way every threat's does (2.10)
  return causeLine(s, c) || '';
}

// ---- the incident's logic ------------------------------------------------------------------------------------
const beastFoe = (s, r) => { for (const id of r.members) { const f = foeById(s, id); if (f && f.st && f.st.gb) return f; } return null; };
function start(s, e) {
  const b = beastByKey(s, e.gb);
  if (!b) return null;
  const r = spawnRaid(s, e);
  const f = foeById(s, r.members[0]);
  const rec = recOf(s, b.key), g = gbOf(s);
  if (f) {
    f.st.gb = b.key; f.st.sz = b.size;
    if (b.attacks.includes('darkness')) f.st.dark = K.darkR;
    const hp = Math.max(1, Math.floor((b.hp * rec.hp) / 100));
    f.hp = { hp, max: b.hp };
  }
  rec.met++; g.on = { raid: r.id, key: b.key }; g.last = dayOf(s.tick);
  addLegend(s, 'b', b.lair, { text: b.name });
  legendEvent(s, 'beast', [keyOf(b.lair)], `${b.name} came up into the hold.`);
  return r.id;
}
/** Per tick while on the map: the flee rule and the non-wound attacks. */
function tick(s, r) {
  const f = beastFoe(s, r);
  if (!f) return;
  const b = beastByKey(s, f.st.gb);
  if (!b) return;
  recOf(s, b.key).hp = Math.max(1, Math.floor((f.hp.hp * 100) / b.hp));
  if (f.hp.hp * 100 < f.hp.max * K.fleePct && !f.st.flee) { f.st.flee = true; setStage(s, r, 'retreat'); }
  if (f.st.flee) return;
  const off = hashString(b.key) % 600;
  for (const a of b.attacks) { const A = ATTACK[a]; if (A && A.every > 0 && (s.tick + off) % A.every === 0 && A.fx !== 'wound') ATTACK_FX[A.fx](s, f, b, A); }
  if (b.mat === 'ember' && (s.tick + off) % 200 === 0) { const i = foeVoxel(f); if (canBurn(s, i)) ignite(s, i); }
  if (b.legend === 'hollowking' && (s.tick + off) % 40 === 0) darkStep(s, f);
}
function end(s, raid, result) {
  const g = gbOf(s);
  if (!g.on || g.on.raid !== raid.id) return;
  const b = beastByKey(s, g.on.key), rec = recOf(s, g.on.key);
  g.on = null;
  if (!b || rec.slain >= 0) return;
  rec.fled++;
  if (rec.scars.length < 3) rec.scars.push(beastText('beast_scar', { place: 'the hold' }));
  sendLetter(s, 'incident', { inc: BEAST_INC, text: beastText('beast_fled', { beast: b.name }) });
  legendEvent(s, 'beast', [keyOf(b.lair)], `${b.name} fled, wounded, to its lair.`);
}

// ---- the attacks: each an existing sim effect -----------------------------------------------------------------
const foeVoxel = (f) => (f.z | 0) * PLANE + Math.max(0, Math.min(H - 1, Math.floor(f.y / 32))) * W + Math.max(0, Math.min(W - 1, Math.floor(f.x / 32)));
const colVoxel = (c) => (c.z | 0) * PLANE + Math.max(0, Math.min(H - 1, Math.floor(c.y / 32))) * W + Math.max(0, Math.min(W - 1, Math.floor(c.x / 32)));
/** The colonists on the beast's level within r tiles (Chebyshev), in id order. */
function near(s, f, r) {
  const out = [], fx = Math.floor(f.x / 32), fy = Math.floor(f.y / 32), z = f.z | 0;
  for (const c of s.col) {
    if (!c || !c.hp || c.hp.dead || (c.z | 0) !== z) continue;
    if (Math.max(Math.abs(Math.floor(c.x / 32) - fx), Math.abs(Math.floor(c.y / 32) - fy)) <= r) out.push(c);
  }
  return out;
}
export const ATTACK_FX = Object.freeze({
  // blows (bite, crush) are the base stats row's, struck by fight.js; listed so every attack maps to an effect
  wound: (s, f, b, A) => { const c = near(s, f, b.size)[0]; if (c) damage(s, c, 1, A.kind, A.dmg, f); },
  sick: (s, f, b, A) => { const c = near(s, f, b.size)[0]; if (c) { damage(s, c, 1, A.kind, A.dmg, f); infect(s, c, A.illness); } },
  fire: (s, f, b) => {
    const c = near(s, f, 4)[0]; if (!c) return;
    const i = colVoxel(c);
    for (const j of [i, i + 1, i - 1, i + W, i - W]) if (j >= 0 && canBurn(s, j)) { ignite(s, j); break; }
  },
  web: (s, f) => { const c = near(s, f, 5)[0]; if (!c) return; const g = gbOf(s); if (!g.web.some((w) => w[0] === c.id)) g.web.push([c.id, s.tick + K.webS * 20, c.x, c.y]); },
  dread: (s, f) => { for (const c of near(s, f, K.dreadR)) addThought(s, c, 'dread'); },
  dark: () => {},   // the aura is f.st.dark (darkR); the light pass reads it (request: B, world/light.js)
});
/** The Hollow King steps between dark voxels within darkStepR tiles of each other toward its prey; light stops it. */
function darkStep(s, f) {
  const light = s.rt && s.rt.light;
  if (!light) return;
  const here = foeVoxel(f);
  if (light[here] >= LIT_MIN) return;
  const c = near(s, f, K.darkStepR).find((x) => light[colVoxel(x)] < LIT_MIN);
  if (!c) return;
  const j = colVoxel(c);
  for (const k of [j - 1, j + 1, j - W, j + W]) {
    if (k >= 0 && light[k] < LIT_MIN && s.rt.walkCost[k] !== 0 && ((k / PLANE) | 0) === (f.z | 0)) { f.x = (k % W) * 32 + 16; f.y = (((k % PLANE) / W) | 0) * 32 + 16; return; }
  }
}

// ---- hooks: armour and shatter, the kill, webs ---------------------------------------------------------------
function dmgMult(s, src, target, kind) {
  if (!target || !target.st || !target.st.gb || target.hp === undefined || target.kind === undefined) return 1;
  const b = beastByKey(s, target.st.gb);
  if (!b) return 1;
  let m = (100 - b.armour) / 100;
  if (kind === 'blunt' && (b.mat === 'glass' || b.mat === 'bone')) m = b.mat === 'glass' ? 2 : 1.5;
  // where to hit it is a fact of its body: its soft zone takes double (a pure roll from the tick and its id)
  if (zoneFor(b, hashString(`${target.id}:${s.tick}`))[0] === b.soft) m *= 2;
  return m;
}
function onKill(s, victim, killer) {
  if (!victim || !victim.st || !victim.st.gb || victim.kind === undefined) return;
  const b = beastByKey(s, victim.st.gb);
  if (!b) return;
  const rec = recOf(s, b.key), g = gbOf(s);
  rec.slain = dayOf(s.tick); rec.hp = 0;
  if (!g.tro.includes(b.key)) g.tro.push(b.key);
  const k = b.drop.find((id) => def('item', id)) || null;
  if (k) spawnItem(s, k, null, 0, b.n, Math.floor(victim.x / 32), Math.floor(victim.y / 32), { z: victim.z | 0 });
  addThoughtAll(s, 'slew_beast', killer && killer.id !== undefined ? killer.id : -1);
  if (killer && killer.hp && killer.name !== undefined) addThought(s, killer, 'slew_beast_blow');
  sendLetter(s, 'incident', { inc: BEAST_INC, text: beastText('beast_slain', { beast: b.name }) });
  legendEvent(s, 'slain', [keyOf(b.lair)], `${b.name} was slain.`);
}
/** Tick system (slot 'engage', after movement): webbed colonists cannot move until their web lapses. */
export function beastSystem(s) {
  const g = s.st && s.st.gb;
  if (!g || !g.web || !g.web.length) return;
  const keep = [];
  for (const w of g.web) {
    if (s.tick >= w[1]) continue;
    const c = s.col.find((x) => x && x.id === w[0]);
    if (!c || (c.hp && c.hp.dead)) continue;
    c.x = w[2]; c.y = w[3];
    keep.push(w);
  }
  g.web = keep;
}

const LOGIC = Object.freeze({ start, tick, end });
/** Register the beasts (idempotent): the incident row, its logic, the daily scheduler and the hooks. */
export function installBeasts() {
  if (!BUS.incidents.some((d) => d.id === BEAST_INC)) BUS.incidents.push(BEAST_INCIDENT);
  registerIncidentLogic(BEAST_INC, LOGIC);
  onStoryHour(storyHour);
  if (!BUS.dmgMult.includes(dmgMult)) BUS.dmgMult.push(dmgMult);
  if (!BUS.kill.includes(onKill)) BUS.kill.push(onKill);
  if (!tickSystems().some((x) => x.slot === 'engage' && x.name === 'beasts')) registerSystem('engage', 'beasts', beastSystem, 50);
}
function storyHour(s) { if (s.tick % TICKS_PER_DAY === 0) beastDay(s); }
export const BEAST_TUNING = K;
export { MAT as BEAST_MATERIALS };

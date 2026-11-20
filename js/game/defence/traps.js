// Traps (doc 7.7, 9.5): spike traps, ember pits and tunnel deadfalls. Owner H. Stage 2.
//
// State in Building.fuel (saved; traps burn no fuel): 0 armed, 1 spent (waits for a rearm), >= 2 an
// ember pit burning (ticks left + 1).
//   spiketrap  the first hostile on its tile takes TRAP.spike (35) stab once; then it is spent until a
//              hauler rearms it (the 'rearm' Haul giver below: walk beside it, TRAP.rearmTicks of work).
//   emberpit   a hostile on it lights it: for TRAP.pitTicks (10 s) every hostile on it takes
//              TRAP.pitDmg fire each second and the tile may catch (B's ignite); then it is spent until
//              rearmed (Stage 2: rearming needs no tallow).
//   deadfall   an unlinked deadfall drops when a hostile steps under it: B's springDeadfall hits its
//              tile and the 8 around it for WORLD.mech.deadfall (60) blunt through our onTrapFire
//              listener (raiders.damageFoe) and the deadfall is gone (single use; rebuild it). A
//              deadfall linked to a pressure plate drops when the plate fires (B's mechanisms).
// Foes are checked in s.foes order on their tile (rt.occ); downed foes and the Rift trigger nothing.

import { W, H, idx } from '../core/grid.js';
import { TPS } from '../core/time.js';
import { bldById } from '../core/state.js';
import { springDeadfall, onTrapFire } from '../world/mechanisms.js';
import { ignite } from '../world/fire.js';
import { BUS } from '../core/bus.js';
import { T, makeJob, keyBld, registerToil, NEXT } from '../work/jobs.js';
import { openTarget, standSpot } from '../work/windex.js';
import { footprint } from '../world/pass.js';
import { damageFoe, foeTile } from '../threat/raiders.js';
import { stage2 } from '../people/defs.js';

export const TRAP_DEFS = Object.freeze(['spiketrap', 'emberpit', 'deadfall']);
export const TRAP = Object.freeze({ spike: 35, pitDmg: 8, pitTicks: 10 * TPS, rearmTicks: 60 });
export const isTrap = (b) => !!b && b.st === 'done' && TRAP_DEFS.includes(b.def);
export const armed = (b) => isTrap(b) && (b.fuel | 0) === 0;
export const spent = (b) => isTrap(b) && b.def !== 'deadfall' && (b.fuel | 0) === 1;

/** Tick system (slot 'defence'). */
export function trapsSystem(s) {
  if (!stage2()) return;
  // burning pits count down and burn what stands on them
  for (const b of s.bld) {
    if (!b || b.def !== 'emberpit' || b.st !== 'done' || (b.fuel | 0) < 2) continue;
    b.fuel--;
    if (b.fuel < 2) { b.fuel = 1; continue; }
    if (s.tick % TPS !== 0) continue;
    const i = idx(b.x, b.y, b.z | 0);
    for (const f of s.foes.slice()) { const j = foeTile(f); if (!(f.st && f.st.down) && Math.max(Math.abs((j % W) - b.x), Math.abs(((j / W) | 0) - b.y)) <= (s.rt.walkCost[i] === 0 ? 1 : 0)) damageFoe(s, f, TRAP.pitDmg, 'fire', { kind: 'trap', id: b.id }); }
    if (s.tick % (3 * TPS) === 0) ignite(s, i);
  }
  if (!s.foes.length) return;
  const traps = [];
  for (const b of s.bld) if (armed(b)) traps.push(b);
  if (!traps.length) return;
  for (const f of s.foes.slice()) {
    if (f.st && f.st.down) continue;
    const i = foeTile(f), fx = i % W, fy = (i / W) | 0;
    for (const b of traps) {
      if (!armed(b)) continue;
      // on the trap's tile; or beside it while the trap blocks the way (B's pass.js has traps as
      // blocking constructs until they are walkable furniture: then only the tile itself counts)
      const ti = idx(b.x, b.y, b.z | 0), d = Math.max(Math.abs(fx - b.x), Math.abs(fy - b.y));
      if (!(ti === i || (d <= 1 && s.rt.walkCost[ti] === 0))) continue;
      if (b.def === 'spiketrap') { b.fuel = 1; damageFoe(s, f, TRAP.spike, 'stab', { kind: 'trap', id: b.id }); }
      else if (b.def === 'emberpit') b.fuel = TRAP.pitTicks + 1;
      else if (b.def === 'deadfall' && (b.link === null || b.link === undefined)) springDeadfall(s, b);
      break;
    }
  }
}

/** B's deadfall hits through raiders.damageFoe (light and affixes apply). */
function onFire(s, b, ids, dmg) {
  for (const id of ids) { const f = s.foes.find((x) => x.id === id); if (f) damageFoe(s, f, dmg, 'blunt', { kind: 'trap', id: b.id }); }
  return true;
}

// ---- The rearm giver (Haul) ---------------------------------------------------------------------
const target = (s, col, b) => {
  if (!spent(b) || !openTarget(s, col, keyBld(b.id))) return null;
  const st = standSpot(s, col, footprint(s, b));
  return st.i < 0 ? null : { key: keyBld(b.id), id: b.id, stand: st.i, d: st.d };
};
export const REARM_GIVER = Object.freeze({
  id: 'rearm', work: 'haul', order: 6,
  candidates(s, col, k) {
    const out = [];
    if (!stage2()) return out;
    for (const b of s.bld) { const t = b && spent(b) ? target(s, col, b) : null; if (t && t.d !== Infinity) out.push(t); }
    out.sort((p, q) => p.d - q.d || p.key - q.key);
    return out.slice(0, k);
  },
  valid(s, col, t) { return !!target(s, col, bldById(s, t.id)) && !s.foes.length; },
  make(s, col, t) { return { job: makeJob('rearm', t.key, [T.goto(t.stand), T.work(TRAP.rearmTicks, { sk: 'construction', key: t.key }), { t: 'rearm', b: t.id }]), claims: [[t.key, 0]] }; },
  keyOf: (t) => t.key,
});
let on = false;
export function installTraps() {
  if (on) return;
  on = true;
  onTrapFire(onFire);
  registerToil('rearm', (s, col, job, toil) => { const b = bldById(s, toil.b); if (b && spent(b)) b.fuel = 0; return NEXT; });
  if (!BUS.workGivers.includes(REARM_GIVER)) BUS.workGivers.push(REARM_GIVER);
}
export { W, H };

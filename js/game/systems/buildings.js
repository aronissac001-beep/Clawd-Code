// Building behaviours: towers and the Hearth shoot, Braziers burn, Barracks
// train soldiers into their squad.
import { BAL } from '../../data/balance.js';
import { BUILDINGS, levelStats } from '../../data/buildings.js';
import { UNITS } from '../../data/units.js';
import { SQUAD_NAMES, SQUAD_COLORS } from '../../data/heraldry.js';
import { T } from '../grid.js';
import { hurt, emit, newId, spawnSoldier, accessTile } from './common.js';
import { spawnProjectile } from './combat.js';

export function updateBuildings(s, dt) {
  for (const b of s.buildings) {
    b.hitT = Math.max(0, b.hitT - dt);
    if (!b.built) continue;
    const st = levelStats(b.type, b.level);
    const cx = (b.tx + b.size / 2) * T, cy = (b.ty + b.size / 2) * T;
    if (st.attack && !BUILDINGS[b.type].selfFire) {
      b.cd -= dt;
      if (b.cd <= 0) {
        const a = st.attack;
        const range = (a.range + (b.type === 'tower' ? s.mods.towerRange : 0)) * T;
        const t = s.rt.enemyHash.nearest(cx, cy, range);
        if (t) {
          b.cd = a.rate;
          const top = b.type === 'hearth' ? cy - 40 : cy - 34;
          const kind = a.type === 'fire' ? 'bolt' : 'arrow';
          const dmg = b.type === 'hearth' ? a.dmg + (s.mods.hearthDmg || 0) : a.dmg * (1 + (s.mods.towerDmg || 0) + (s.mods.rangedDmg || 0));
          spawnProjectile(s, kind, cx, top, t, dmg, a.type, null, kind === 'bolt' ? 9 : 14, kind === 'bolt' ? 0.3 : 0.8);
          if ((a.shots || 1) > 1) {
            let second = null;
            s.rt.enemyHash.each(cx, cy, range, (e) => { if (e !== t) { second = e; return true; } return false; });
            spawnProjectile(s, kind, cx + 4, top, second || t, dmg, a.type, null, 14, 0.8);
          }
          emit(s, { t: 'sfx', k: kind === 'bolt' ? 'bolt' : 'bow', x: cx, y: cy });
        } else b.cd = 0.25;
      }
    }
    if (st.burn) {
      b.cd -= dt;
      if (b.cd <= 0) {
        b.cd = 0.5;
        s.rt.enemyHash.each(cx, cy, st.burn.radius * T, (e) => { hurt(s, e, st.burn.dps * 0.5, 'fire', null); return false; });
      }
    }
    if (b.type === 'barracks' && b.train.length) {
      const job = b.train[0];
      job.t -= dt * (st.trainSpeed || 1);
      if (job.t <= 0) {
        b.train.shift();
        const sq = squadFor(s, b);
        const at = accessTile(s, b, cx, cy + T * 3) || { tx: b.tx, ty: b.ty + b.size };
        spawnSoldier(s, job.u, sq, (at.tx + 0.5) * T, (at.ty + 0.5) * T);
        emit(s, { t: 'trained', x: cx, y: cy, unit: job.u, squad: sq.id });
      }
    }
  }
}

export function squadFor(s, b) {
  let sq = s.squads.find((q) => q.id === b.squad);
  if (!sq) {
    const n = s.squads.length + (s.squadSerial || 0);
    s.squadSerial = (s.squadSerial || 0) + 1;
    const h = s.rt.hearth;
    const cx = (b.tx + b.size / 2) * T, cy = (b.ty + b.size / 2) * T;
    // Default rally: between the barracks and the Hearth.
    const hx = h ? (h.tx + 1.5) * T : cx, hy = h ? (h.ty + 1.5) * T : cy;
    const at = accessTile(s, b, hx, hy) || { tx: b.tx, ty: b.ty + b.size };
    sq = { id: newId(s), bId: b.id, name: SQUAD_NAMES[n % SQUAD_NAMES.length], color: SQUAD_COLORS[n % SQUAD_COLORS.length], rx: (at.tx + 0.5) * T, ry: (at.ty + 0.5) * T, targetId: 0 };
    s.squads.push(sq);
    b.squad = sq.id;
  }
  return sq;
}

export function squadSize(s, b) {
  let n = 0;
  for (const u of s.soldiers) if (u.alive && u.squad === b.squad) n++;
  return n;
}

export function trainTime(type) { return UNITS[type].train; }
void BAL;

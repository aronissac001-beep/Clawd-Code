'use strict';
// ============================================================================
// ZONEFALL — entities: player, enemies + AI, projectiles, explosives,
// particles, damage model and pathfinding.
// ============================================================================

// ---------------------------------------------------------------------------
// MOVEMENT & COLLISION
// ---------------------------------------------------------------------------
function moveEntity(e, dx, dy, who) {
  const m = Game.map; const r = e.r;
  // x axis
  if (dx) { e.x += dx; resolveTiles(m, e, r, who, true); }
  if (dy) { e.y += dy; resolveTiles(m, e, r, who, false); }
  // solid objects (circles)
  const near = m.objsNear(e.x, e.y);
  for (const o of near) {
    if (!o.solid) continue;
    const d = dist(e.x, e.y, o.x, o.y), min = r + o.r * 0.8;
    if (d < min && d > 0.01) { const k = (min - d) / d; e.x += (e.x - o.x) * k; e.y += (e.y - o.y) * k; }
  }
  e.x = clamp(e.x, r, m.w * TILE - r); e.y = clamp(e.y, r, m.h * TILE - r);
}
function resolveTiles(m, e, r, who, xAxis) {
  const x0 = Math.floor((e.x - r) / TILE), x1 = Math.floor((e.x + r) / TILE);
  const y0 = Math.floor((e.y - r) / TILE), y1 = Math.floor((e.y + r) / TILE);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!m.blocked(tx, ty, who)) continue;
    // circle vs AABB
    const bx = tx * TILE, by = ty * TILE;
    const cx = clamp(e.x, bx, bx + TILE), cy = clamp(e.y, by, by + TILE);
    const ddx = e.x - cx, ddy = e.y - cy, d2 = ddx * ddx + ddy * ddy;
    if (d2 >= r * r) continue;
    if (xAxis) { e.x = (e.x < bx + TILE / 2) ? bx - r - 0.01 : bx + TILE + r + 0.01; }
    else { e.y = (e.y < by + TILE / 2) ? by - r - 0.01 : by + TILE + r + 0.01; }
  }
}

// A* on the tile grid; returns array of world waypoints
function findPath(m, sx, sy, gx, gy, who, maxNodes = 1600) {
  const W = m.w; const s = Math.floor(sy / TILE) * W + Math.floor(sx / TILE);
  const gtx = Math.floor(gx / TILE), gty = Math.floor(gy / TILE); const g = gty * W + gtx;
  if (s === g) return [];
  const open = [[0, s]]; const came = new Map(); const gs = new Map([[s, 0]]);
  let n = 0;
  while (open.length && n++ < maxNodes) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [, cur] = open.splice(bi, 1)[0];
    if (cur === g) {
      const path = []; let c = cur;
      while (c !== s) { path.push({ x: (c % W) * TILE + 16, y: Math.floor(c / W) * TILE + 16 }); c = came.get(c); }
      return path.reverse();
    }
    const cx = cur % W, cy = (cur / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (m.blocked(nx, ny, who)) continue;
      if (dx && dy && (m.blocked(cx + dx, cy, who) || m.blocked(cx, cy + dy, who))) continue;
      const ni = ny * W + nx; const og = m.ogrid[ni]; const pen = og && og.some(o => o.solid) ? 3 : 0;
      const ng = gs.get(cur) + (dx && dy ? 1.414 : 1) + pen;
      if (ng < (gs.get(ni) ?? 1e9)) { gs.set(ni, ng); came.set(ni, cur); open.push([ng + Math.hypot(gtx - nx, gty - ny), ni]); }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// DAMAGE MODEL
// ---------------------------------------------------------------------------
function armorReduce(armor, pen) { return clamp(armor * (1 - pen * 0.6), 0, 0.85); }

function damagePlayer(dmg, pen = 0, opts = {}) {
  const p = Game.player; if (p.dead || p.invuln > 0) return;
  let a = p.armorVal; let mult = 1;
  if (!opts.explosive && chance(0.12)) mult = 1 + 0.8 * (1 - p.critProt); // headshot
  const red = opts.explosive ? a * 0.5 : armorReduce(a, pen);
  const d = dmg * mult * (1 - red);
  p.hp -= d; p.hurtT = 0.35; Game.shake(Math.min(6, 1.5 + d * 0.15));
  if (opts.from) (p.hitDirs || (p.hitDirs = [])).push({ ang: Math.atan2(opts.from.y - p.y, opts.from.x - p.x), t: 1 });
  if (opts.bleed !== undefined ? chance(opts.bleed) : (d > 8 && chance(0.12))) { if (!p.bleed) Game.toast('You are bleeding!', 'bad'); p.bleed = true; }
  Sfx.hurt();
  Game.spawnBlood(p.x, p.y, 4);
  if (p.hp <= 0) Game.playerDied(opts.by || 'unknown');
}

function damageEnemy(e, dmg, pen = 0, ang = 0, opts = {}) {
  if (e.dead) return;
  let mult = 1; let crit = false;
  if (!opts.explosive && !opts.melee && chance(0.12)) { mult = 1 + 0.8 * (1 - (e.helm || 0)); crit = mult > 1.2; }
  const red = opts.explosive ? e.armor * 0.5 : armorReduce(e.armor, pen);
  const d = dmg * mult * (1 - red);
  e.hp -= d; e.hurtT = 0.15;
  e.x += Math.cos(ang) * Math.min(6, d * 0.15); e.y += Math.sin(ang) * Math.min(6, d * 0.15);
  Game.spawnBlood(e.x, e.y, 3, e.def.kind === 'mutant' ? '#5a7a3a' : undefined);
  Game.floatText(e.x, e.y - 34, Math.round(d) + (crit ? '!' : ''), crit ? '#fee761' : '#fff');
  if (opts.fromPlayer) { Game.hitMark = 0.12; Game.killMark = false; e.lastSeen = { x: Game.player.x, y: Game.player.y }; if (e.state !== 'combat') e.alertFlash = 1.2; e.state = 'combat'; e.alertT = 10; }
  if (e.hp <= 0) killEnemy(e, opts);
}

function killEnemy(e, opts) {
  e.dead = true;
  if (opts && opts.fromPlayer) { Game.killMark = true; Game.hitMark = 0.25; Game.hitstop = 0.045; }
  const m = Game.map;
  Game.stats.kills++;
  if (e.def.kind === 'beast' || e.def.kind === 'mutant') Sfx.growl(e.x, e.y);
  R.decal(e.def.kind === 'mutant' ? 'goo' : 'blood', e.x, e.y + 4); R.decal(e.def.kind === 'mutant' ? 'goo' : 'blood', e.x + rand(-8, 8), e.y + rand(-4, 8));
  // corpse container with its loot + gear
  const items = rollLoot(e.def.drop);
  if (e.gun && !e.def.raider && chance(e.def.boss ? 1 : 0.4)) items.push({ id: e.gun, n: 1, m: randi(0, Math.floor(WEAPONS[e.gun].mag / 2)) });
  if (e.def.kind === 'human' && e.gun && chance(0.6)) items.push({ id: WEAPONS[e.gun].ammo, n: randi(4, 14) });
  if (e.def.boss) Game.toast(e.def.name + ' is dead!', 'good');
  if (items.length || e.def.kind === 'human') {
    const c = m.addContainer('corpse', e.x, e.y); c.items = items; c.name = e.def.name; c.corpse = { art: R.actorArt(e, false), right: Math.cos(e.ang) >= 0 };
  }
  if (e.satchel) e.satchel = null;
}

// structures (base)
function damageStruct(s, dmg, melee) {
  if (!s || s.dead) return;
  s.hp -= dmg; s.hitT = 0.2;
  if (s.type === 'core') { Game.onCoreHit(dmg, melee); }
  if (s.hp <= 0) Game.destroyStruct(s);
}

function explode(x, y, radius, dmg, structDmg, owner) {
  const m = Game.map;
  Sfx.explode(x, y); Game.shake(Math.max(3, 14 - dist(x, y, Game.player.x, Game.player.y) / 40));
  Game.addLight(x, y, radius * 3, 0.35, '#ffb050');
  R.anim('fx_explode', x, y, 7, 16);
  for (let i = 0; i < 18; i++) { const a = Math.random() * 6.28, s = rand(60, 260); Game.particles.push({ x, y: y - 8, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.7), max: 0.7, col: pick(['#feae34', '#f77622', '#e43b44', '#fee761']), size: rand(2, 5), drag: 3 }); }
  for (let i = 0; i < 12; i++) { const a = Math.random() * 6.28, s = rand(20, 80); Game.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.8, 1.6), max: 1.6, col: '#3a3a3a', size: rand(10, 18), drag: 2, smoke: true }); }
  R.decal('scorch', x, y);
  Game.makeNoise(x, y, 900);
  const p = Game.player;
  const dp = dist(x, y, p.x, p.y); if (dp < radius && !p.dead) damagePlayer(dmg * (1 - dp / radius * 0.6), 0, { explosive: true, by: 'an explosion' });
  for (const e of Game.enemies) { if (e.dead) continue; const d = dist(x, y, e.x, e.y); if (d < radius + e.r) damageEnemy(e, dmg * (1 - d / (radius + e.r) * 0.6), 0, Math.atan2(e.y - y, e.x - x), { explosive: true, fromPlayer: owner === 'player' }); }
  if (m.struct && structDmg) {
    const tr = Math.ceil(radius / TILE) + 1, ctx = Math.floor(x / TILE), cty = Math.floor(y / TILE);
    for (let ty = cty - tr; ty <= cty + tr; ty++) for (let tx = ctx - tr; tx <= ctx + tr; tx++) {
      const s = m.st(tx, ty); if (!s) continue;
      const d = dist(x, y, tx * TILE + 16, ty * TILE + 16); if (d > radius + 16) continue;
      let k = 1 - d / (radius + 16) * 0.5; if (s.type === 'wall_metal' || s.type === 'door_metal') k *= 0.75; if (s.type === 'wall_armor') k *= 0.55;
      damageStruct(s, structDmg * k);
    }
  }
}

// ---------------------------------------------------------------------------
// ENEMIES
// ---------------------------------------------------------------------------
function makeEnemy(type, x, y, dayScale = 1) {
  const def = ENEMIES[type];
  const e = {
    type, def, x, y, r: def.r, hp: def.hp * dayScale, maxhp: def.hp * dayScale, ang: Math.random() * 6.28,
    armor: def.armor ? rand(def.armor[0], def.armor[1]) : 0, helm: def.helm || 0,
    gun: def.guns ? pick(def.guns) : null, state: 'idle', home: { x, y }, wanderT: rand(1, 4), alertT: 0,
    fireCd: rand(0.3, 1), meleeCd: 0, reloadT: 0, path: null, pathT: 0, strafe: chance(0.5) ? 1 : -1, strafeT: 0,
    hurtT: 0, lastSeen: null, visible: false, chargeT: 0, chargeCd: 0, bark: rand(2, 8), id: Math.random(),
  };
  if (e.gun) e.mag = WEAPONS[e.gun].mag;
  return e;
}

function enemyCanSeePlayer(e) {
  const p = Game.player; if (p.dead) return false;
  let sight = e.def.sight * Game.visionMul();
  if (Game.map.kind === 'base' && Game.mode === 'raid') sight = Math.max(sight, 380);
  const d = dist(e.x, e.y, p.x, p.y); if (d > sight) return false;
  return Game.map.los(e.x, e.y, p.x, p.y);
}

function updateEnemy(e, dt) {
  const m = Game.map, p = Game.player, def = e.def;
  e.hurtT -= dt; e.fireCd -= dt; if (e.alertFlash > 0) e.alertFlash -= dt; e.meleeCd -= dt; e.pathT -= dt; e.strafeT -= dt; e.chargeCd -= dt;
  if (e.reloadT > 0) { e.reloadT -= dt; if (e.reloadT <= 0) e.mag = WEAPONS[e.gun].mag; }
  // environmental damage
  for (const a of m.anoms) { if (dist2(e.x, e.y, a.x, a.y) < (a.r * 0.6) ** 2 && chance(dt * 2)) damageEnemy(e, 6, 0, 0, { explosive: true }); }
  if (def.raider) return updateRaider(e, dt);
  const sees = enemyCanSeePlayer(e);
  if (sees) {
    if (e.state !== 'combat') { e.state = 'combat'; e.alertFlash = 1.2; if (def.kind === 'beast') Sfx.bark(e.x, e.y); else if (def.kind === 'mutant') Sfx.growl(e.x, e.y); Game.makeNoise(e.x, e.y, 260, e); }
    e.lastSeen = { x: p.x, y: p.y }; e.alertT = 9;
  }
  const spd = def.speed * (e.slowT > 0 ? 0.5 : 1);
  if (e.state === 'idle' || e.state === 'wander') {
    e.wanderT -= dt;
    if (e.wanderT <= 0) {
      e.wanderT = rand(2, 6);
      if (chance(0.6)) { const a = Math.random() * 6.28, r = rand(40, 160); e.goal = { x: e.home.x + Math.cos(a) * r, y: e.home.y + Math.sin(a) * r }; e.state = 'wander'; } else { e.goal = null; e.state = 'idle'; }
    }
    if (e.goal) { if (steerTo(e, e.goal.x, e.goal.y, spd * 0.4, dt)) e.goal = null; }
    return;
  }
  if (e.state === 'alert') { // heard something
    e.alertT -= dt;
    if (!e.lastSeen || e.alertT <= 0) { e.state = 'wander'; return; }
    if (navTo(e, e.lastSeen.x, e.lastSeen.y, spd * 0.75, dt)) { e.state = 'search'; e.alertT = 4; }
    return;
  }
  if (e.state === 'search') { e.alertT -= dt; e.ang += dt * 1.6; if (e.alertT <= 0) { e.state = 'wander'; e.home = { x: e.x, y: e.y }; } return; }
  // combat
  e.alertT -= dt;
  if (!sees && e.alertT <= 0) { e.state = 'search'; e.alertT = 4; return; }
  const tx = e.lastSeen.x, ty = e.lastSeen.y; const d = dist(e.x, e.y, tx, ty);
  const aimA = Math.atan2(ty - e.y, tx - e.x);
  if (def.melee) {
    // boar charge
    if (def.charge && sees && d < 180 && d > 50 && e.chargeCd <= 0) { e.chargeT = 0.7; e.chargeCd = 3; e.chargeA = aimA; }
    if (e.chargeT > 0) { e.chargeT -= dt; const ox = e.x, oy = e.y; moveEntity(e, Math.cos(e.chargeA) * def.charge * dt, Math.sin(e.chargeA) * def.charge * dt, 'enemy'); e.ang = e.chargeA; if (dist(ox, oy, e.x, e.y) < 1) e.chargeT = 0; }
    else if (sees && d < 300) steerTo(e, tx, ty, spd, dt); else navTo(e, tx, ty, spd, dt);
    if (sees && dist(e.x, e.y, p.x, p.y) < def.melee.reach + p.r + e.r && e.meleeCd <= 0) {
      e.meleeCd = 1 / def.melee.rate; damagePlayer(def.melee.dmg, 0, { bleed: def.melee.bleed, by: 'a ' + def.name, from: e });
      if (e.chargeT > 0) e.chargeT = 0;
    }
    return;
  }
  // gun-user
  const w = WEAPONS[e.gun];
  const pref = Math.min(w.range * 0.55, 260);
  if (sees) {
    e.ang += clamp(angDiff(e.ang, aimA), -6 * dt, 6 * dt);
    // keep distance & strafe
    if (e.strafeT <= 0) { e.strafeT = rand(0.8, 2.2); if (chance(0.5)) e.strafe *= -1; }
    let mx = 0, my = 0;
    if (d > pref + 40) { mx += Math.cos(aimA); my += Math.sin(aimA); } else if (d < pref - 60) { mx -= Math.cos(aimA); my -= Math.sin(aimA); }
    mx += Math.cos(aimA + Math.PI / 2) * e.strafe * 0.7; my += Math.sin(aimA + Math.PI / 2) * e.strafe * 0.7;
    const ml = Math.hypot(mx, my) || 1; moveEntity(e, mx / ml * spd * 0.7 * dt, my / ml * spd * 0.7 * dt, 'enemy');
    if (Math.abs(angDiff(e.ang, aimA)) < 0.25 && d < w.range * 0.95) enemyFire(e, w);
    // low health: back off
    if (e.hp < e.maxhp * 0.25 && def.kind === 'human' && !def.boss && chance(dt * 0.5)) { e.state = 'search'; e.alertT = 3; e.goal = null; }
  } else {
    // flush the player out of cover with a grenade
    e.nadeCd = (e.nadeCd ?? rand(3, 8)) - dt;
    const dl = dist(e.x, e.y, tx, ty);
    if ((e.type === 'soldier' || e.type === 'bandit' || def.boss) && e.nadeCd <= 0 && dl > 110 && dl < 330 && e.alertT > 4) {
      e.nadeCd = rand(9, 15); const a = Math.atan2(ty - e.y, tx - e.x), sp = dl * 2.1;
      Game.throwables.push({ kind: 'grenade', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, fuse: 1.9, owner: 'enemy' });
      Sfx.swing(); e.alertFlash = 1;
    }
    navTo(e, tx, ty, spd * 0.85, dt);
  }
}

function enemyFire(e, w) {
  if (e.reloadT > 0 || e.fireCd > 0) return;
  if (e.mag <= 0) { e.reloadT = w.reload * 1.2; return; }
  e.mag--; e.fireCd = 1 / w.rof * (w.auto ? 1.25 : 1.6) + (w.auto && chance(0.15) ? 0.5 : 0);
  const acc = e.def.acc || 0.6; const sp = w.spread + (1 - acc) * 0.2;
  const n = w.pellets || 1;
  const o = R.shotOrigin(e, false); const bh = Math.round((o.y - o.vy) / R.AP);
  const blocked = Game.map.opaqueAt(Math.floor(o.x / TILE), Math.floor(o.y / TILE));
  for (let i = 0; i < n; i++) {
    const a = e.ang + rand(-sp, sp);
    Game.bullets.push({ x: blocked ? e.x : o.x, y: blocked ? e.y : o.y, h: bh, vx: Math.cos(a) * w.speed * 0.85, vy: Math.sin(a) * w.speed * 0.85, dmg: w.dmg * (e.def.raider ? 0.8 : 0.9), pen: w.pen, owner: 'enemy', life: w.range / (w.speed * 0.85), by: 'a ' + e.def.name });
  }
  Sfx.shot(w.sfx, e.x, e.y); R.flash(o.vx, o.vy, e.ang); Game.addLight(o.vx, o.vy, 150, 0.06, '#ffd080');
  Game.makeNoise(e.x, e.y, w.noise * 0.6, e);
}

// steer straight toward a point, returns true when arrived
function steerTo(e, x, y, spd, dt) {
  const d = dist(e.x, e.y, x, y); if (d < 6) return true;
  const a = Math.atan2(y - e.y, x - e.x);
  e.ang += clamp(angDiff(e.ang, a), -8 * dt, 8 * dt);
  const ox = e.x, oy = e.y;
  moveEntity(e, Math.cos(a) * spd * dt, Math.sin(a) * spd * dt, 'enemy');
  e.stuck = (dist(ox, oy, e.x, e.y) < spd * dt * 0.3) ? (e.stuck || 0) + dt : 0;
  return false;
}
// pathfind when direct line is blocked
function navTo(e, x, y, spd, dt) {
  const m = Game.map;
  const direct = m.los(e.x, e.y, x, y) && !(e.stuck > 0.4);
  if (direct) { e.path = null; return steerTo(e, x, y, spd, dt); }
  if (!e.path || e.pathT <= 0) { e.path = findPath(m, e.x, e.y, x, y, 'enemy', 900) || []; e.pathT = 1.2; e.stuck = 0; }
  if (!e.path.length) return steerTo(e, x, y, spd, dt);
  const wp = e.path[0];
  if (dist(e.x, e.y, wp.x, wp.y) < 10) { e.path.shift(); if (!e.path.length) return true; }
  steerTo(e, wp.x, wp.y, spd, dt);
  return false;
}

// ---------------------------------------------------------------------------
// RAIDERS (night defense AI using the flow field)
// ---------------------------------------------------------------------------
function updateRaider(e, dt) {
  const m = Game.map, p = Game.player, def = e.def;
  const W = m.w; const tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
  const spd = def.speed * (e.slowT > 0 ? 0.45 : 1); e.slowT -= dt;
  // unstick: if we have barely moved for a while, wander sideways briefly
  e.chkT = (e.chkT || 0) - dt;
  if (e.chkT <= 0) { e.chkT = 1.2; const moved = e.lastPos ? dist(e.x, e.y, e.lastPos.x, e.lastPos.y) : 99; e.lastPos = { x: e.x, y: e.y }; if (moved < 6 && !e.attacking) e.jitT = 0.6, e.jitA = Math.random() * 6.28; }
  e.attacking = false;
  if (e.jitT > 0) { e.jitT -= dt; moveEntity(e, Math.cos(e.jitA) * spd * dt, Math.sin(e.jitA) * spd * dt, 'enemy'); return; }
  // traps under foot
  const under = m.st(tx, ty);
  if (under && under.type === 'spikes') { e.slowT = 0.3; if (chance(dt * 2.5)) { damageEnemy(e, 9, 0, 0, { melee: true }); damageStruct(under, 6); } }
  if (under && under.type === 'landmine') { Game.destroyStruct(under, true); explode(under.tx * TILE + 16, under.ty * TILE + 16, 80, 140, 60, 'player'); if (e.dead) return; }
  // targets: player or turrets in sight
  const sees = enemyCanSeePlayer(e);
  let tgt = null;
  if (sees) tgt = { x: p.x, y: p.y, player: true };
  else if (def.guns || def.rocket) {
    for (const t of Game.turrets) { if (dist2(e.x, e.y, t.x, t.y) < 300 * 300 && m.los(e.x, e.y, t.x, t.y)) { tgt = { x: t.x, y: t.y, struct: t.s }; break; } }
  }
  const dp = dist(e.x, e.y, p.x, p.y);
  // melee raiders attack the player if close
  if (def.melee && sees && dp < 140) {
    e.attacking = true; steerTo(e, p.x, p.y, spd, dt);
    if (dp < def.melee.reach + p.r + e.r && e.meleeCd <= 0) { e.meleeCd = 1 / def.melee.rate; damagePlayer(def.melee.dmg, 0, { bleed: 0.15, by: 'a raider', from: e }); Sfx.swing(); }
    return;
  }
  // ranged: stand and shoot sometimes
  if (tgt && def.guns) {
    const w = WEAPONS[e.gun]; const d = dist(e.x, e.y, tgt.x, tgt.y);
    const a = Math.atan2(tgt.y - e.y, tgt.x - e.x); e.ang += clamp(angDiff(e.ang, a), -6 * dt, 6 * dt);
    if (d < w.range * 0.85) {
      e.attacking = true;
      if (Math.abs(angDiff(e.ang, a)) < 0.25) enemyFire(e, w);
      if (e.strafeT <= 0) { e.strafeT = rand(0.8, 2); e.strafe *= -1; }
      if (!def.breachBoss || d < 200) { moveEntity(e, Math.cos(a + 1.57) * e.strafe * spd * 0.35 * dt, Math.sin(a + 1.57) * e.strafe * spd * 0.35 * dt, 'enemy'); return; }
    }
  }
  if (def.rocket) {
    e.fireCd -= 0;
    const blockT = tgt ? null : nextBlockOnFlow(m, tx, ty, 7);
    const aimAt = tgt || (blockT ? { x: blockT.tx * TILE + 16, y: blockT.ty * TILE + 16 } : null);
    if (aimAt && e.fireCd <= 0 && dist(e.x, e.y, aimAt.x, aimAt.y) < 330) {
      const a = Math.atan2(aimAt.y - e.y, aimAt.x - e.x); e.ang = a; e.fireCd = 4.5;
      Game.throwables.push({ kind: 'rocket', x: e.x, y: e.y, vx: Math.cos(a) * 380, vy: Math.sin(a) * 380, life: 1.4, owner: 'enemy' });
      Sfx.noise(0.5, 1200, 1, 0.5 * Sfx.vol(e.x, e.y), 'bandpass', 0, 0.3); Game.muzzle(e.x, e.y - 14, a, 14);
      return;
    }
  }
  // follow flow field toward core
  const F = Game.flow; if (!F) return;
  let best = -1, bd = F[ty * W + tx];
  const nb = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const [dx, dy] of nb) {
    const nx = tx + dx, ny = ty + dy; if (!m.inb(nx, ny)) continue;
    if (dx && dy && (m.blocked(tx + dx, ty, 'enemy') || m.blocked(tx, ty + dy, 'enemy'))) continue;
    const v = F[ny * W + nx] + (dx && dy ? 0.4 : 0);
    if (v < bd) { bd = v; best = ny * W + nx; }
  }
  if (best < 0) { // at local min (maybe next to core) -> hit core
    e.attacking = true; attackNear(e, dt); return;
  }
  const bx = best % W, by = (best / W) | 0;
  const s = m.st(bx, by);
  if (s && STRUCTS[s.type].block) {
    // blocked: attack the structure
    const a = Math.atan2(by * TILE + 16 - e.y, bx * TILE + 16 - e.x); e.ang = a;
    const dd = dist(e.x, e.y, bx * TILE + 16, by * TILE + 16);
    if (dd > TILE * 0.5 + e.r + 6) { steerTo(e, bx * TILE + 16, by * TILE + 16, spd, dt); return; }
    e.attacking = true;
    if (def.breach || def.breachBoss) {
      if (!e.planted || e.planted <= 0) {
        e.planted = def.breachBoss ? 9 : 99;
        Game.throwables.push({ kind: 'satchel', x: e.x + Math.cos(a) * 14, y: e.y + Math.sin(a) * 14, vx: 0, vy: 0, fuse: 3.5, owner: 'enemy' });
        Game.toast('Satchel charge planted!', 'bad'); Sfx.beep();
        // breacher backs off
        e.backT = 2;
      }
      e.planted -= dt;
    }
    if (e.backT > 0) { e.backT -= dt; moveEntity(e, -Math.cos(a) * spd * dt, -Math.sin(a) * spd * dt, 'enemy'); return; }
    if (e.meleeCd <= 0) {
      e.meleeCd = def.melee ? 1 / def.melee.rate : 1.0;
      damageStruct(s, def.melee ? def.melee.struct : (def.boss ? 40 : 10), true);
      Sfx.thud(e.x, e.y); Game.spark(bx * TILE + 16 - Math.cos(a) * 14, by * TILE + 16 - Math.sin(a) * 14, '#d0a060');
    }
    return;
  }
  steerTo(e, bx * TILE + 16, by * TILE + 16, spd, dt);
}
function attackNear(e, dt) {
  const m = Game.map; const tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const s = m.st(tx + dx, ty + dy);
    if (s && STRUCTS[s.type].block && e.meleeCd <= 0) {
      e.meleeCd = e.def.melee ? 1 / e.def.melee.rate : 1; damageStruct(s, e.def.melee ? e.def.melee.struct : 12, true); Sfx.thud(e.x, e.y);
      e.ang = Math.atan2(s.ty * TILE + 16 - e.y, s.tx * TILE + 16 - e.x); return;
    }
  }
}
function nextBlockOnFlow(m, tx, ty, steps) {
  const F = Game.flow; if (!F) return null; const W = m.w;
  for (let k = 0; k < steps; k++) {
    let best = -1, bd = F[ty * W + tx];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = tx + dx, ny = ty + dy; if (!m.inb(nx, ny)) continue; if (F[ny * W + nx] < bd) { bd = F[ny * W + nx]; best = ny * W + nx; } }
    if (best < 0) return null;
    tx = best % W; ty = (best / W) | 0;
    const s = m.st(tx, ty); if (s && STRUCTS[s.type].block) return s;
  }
  return null;
}

// ---------------------------------------------------------------------------
// PROJECTILES
// ---------------------------------------------------------------------------
function updateBullets(dt) {
  const m = Game.map, p = Game.player;
  for (const b of Game.bullets) {
    if (b.dead) continue;
    const sp = Math.hypot(b.vx, b.vy); const steps = Math.max(1, Math.ceil(sp * dt / 10));
    const sx = b.vx * dt / steps, sy = b.vy * dt / steps;
    b.px = b.x; b.py = b.y;
    for (let i = 0; i < steps && !b.dead; i++) {
      b.x += sx; b.y += sy;
      const tx = Math.floor(b.x / TILE), ty = Math.floor(b.y / TILE);
      if (!m.inb(tx, ty)) { b.dead = true; break; }
      if (m.bulletBlock(tx, ty)) {
        b.dead = true; Game.spark(b.x - sx, b.y - sy - (b.h ?? 8) * 2);
        const s = m.st(tx, ty);
        if (s && b.owner === 'enemy') damageStruct(s, b.dmg * 0.25);
        break;
      }
      for (const o of m.objsNear(b.x, b.y)) {
        if (o.cover && dist2(b.x, b.y, o.x, o.y) < o.cover * o.cover) { b.dead = true; Game.spark(b.x - sx, b.y - sy - (b.h ?? 8) * 2, o.type === 'tree' ? '#8a6a40' : '#ccc'); break; }
      }
      if (b.dead) break;
      if (b.owner === 'enemy') {
        if (!p.dead && dist2(b.x, b.y, p.x, p.y) < (p.r + 2) ** 2) { b.dead = true; damagePlayer(b.dmg, b.pen, { by: b.by, from: { x: b.x - b.vx, y: b.y - b.vy } }); }
      } else {
        for (const e of Game.enemies) {
          if (e.dead) continue;
          if (dist2(b.x, b.y, e.x, e.y) < (e.r + 2) ** 2) { b.dead = true; damageEnemy(e, b.dmg, b.pen, Math.atan2(b.vy, b.vx), { fromPlayer: true }); Sfx.hit(e.x, e.y); break; }
        }
      }
    }
    b.life -= dt; if (b.life <= 0) b.dead = true;
  }
  Game.bullets = Game.bullets.filter(b => !b.dead);
}

function updateThrowables(dt) {
  const m = Game.map;
  for (const t of Game.throwables) {
    if (t.dead) continue;
    if (t.kind === 'grenade') {
      t.fuse -= dt;
      const nx = t.x + t.vx * dt, ny = t.y + t.vy * dt;
      if (m.blocked(Math.floor(nx / TILE), Math.floor(t.y / TILE), 'bullet')) t.vx *= -0.5; else t.x = nx;
      if (m.blocked(Math.floor(t.x / TILE), Math.floor(ny / TILE), 'bullet')) t.vy *= -0.5; else t.y = ny;
      t.vx *= Math.pow(0.12, dt); t.vy *= Math.pow(0.12, dt);
      if (t.fuse <= 0) { t.dead = true; explode(t.x, t.y, 100, 95, 120, t.owner); }
    } else if (t.kind === 'satchel') {
      t.fuse -= dt; t.blink = (t.blink || 0) + dt;
      if (t.blink > 0.5) { t.blink = 0; Sfx.beep(); }
      if (t.fuse <= 0) { t.dead = true; explode(t.x, t.y, 70, 55, 420, 'enemy'); }
    } else if (t.kind === 'rocket') {
      t.life -= dt; t.x += t.vx * dt; t.y += t.vy * dt;
      Game.particles.push({ x: t.x, y: t.y, vx: rand(-20, 20), vy: rand(-20, 20), life: 0.5, max: 0.5, col: '#888', size: 6, drag: 1, smoke: true });
      const tx = Math.floor(t.x / TILE), ty = Math.floor(t.y / TILE);
      const hitP = dist2(t.x, t.y, Game.player.x, Game.player.y) < 18 * 18;
      if (t.life <= 0 || m.opaqueAt(tx, ty) || hitP) { t.dead = true; explode(t.x - t.vx * 0.02, t.y - t.vy * 0.02, 75, 70, 300, 'enemy'); }
    }
  }
  Game.throwables = Game.throwables.filter(t => !t.dead);
}

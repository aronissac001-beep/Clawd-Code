// ============================================================================
// ZONEFALL 3 — the living world: monuments (via the kit), loot containers,
// trees / nodes / pickups with respawn, ground drops + loot bags, radiation,
// anomalies, useables (recyclers, vendors, fuse boxes, levers, water),
// NPC spawn points + wildlife / roamer population around the player.
// ============================================================================
import { THREE, M } from '../gfx/materials.js';
import { G } from '../state.js';
import { CONTAINERS, LOOT, ITEMS, BP_BY_TIER, ART_IDS, NODES, MONUMENTS, ENEMIES } from '../data.js';
import { Inv } from '../inventory.js';
import { Sfx } from '../audio.js';
import { buildMonument, setModels as setKitModels } from './kit.js';
import { addDoor } from '../doors.js';
import { Build } from '../build.js';
import { spawnActor, removeActor } from '../actors.js';
import { VegLayer, vegRadius, TREE_KINDS, vegOneGeo } from '../gfx/veg.js';
import { B } from './gen.js';
import { rand, randi, pick, weighted, dist, chance, clamp } from '../util.js';

let Models = null, LAYOUTS = {};
export function setLiveModels(m, layouts) { Models = m; setKitModels(m); if (layouts) LAYOUTS = layouts; }

let OID = 1;

// ---- loot beams: a coloured light pillar over weapons, rare+ loot and your death bag
const RAR = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
const BEAM_COL = ['#fff2d0', '#86e64a', '#36b8ff', '#c86bff', '#ffa21e'];
let beamGeo = null; const beamMats = [];
function beamMat(i) {
  if (beamMats[i]) return beamMats[i];
  const c = document.createElement('canvas'); c.width = 4; c.height = 64; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 64, 0, 0); gr.addColorStop(0, '#fff'); gr.addColorStop(0.25, '#bbb'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  return (beamMats[i] = new THREE.MeshBasicMaterial({ color: BEAM_COL[i], map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }));
}
function lootBeam(inv, kind) {
  let best = -1, gun = false;
  for (const s of inv.slots) { if (!s) continue; const def = ITEMS[s.id]; if (!def) continue; best = Math.max(best, RAR[def.rar] || 0); if (def.cat === 'gun') gun = true; }
  if (kind !== 'bag' && !gun && best < 2) return null;
  if (!beamGeo) beamGeo = new THREE.CylinderGeometry(0.16, 0.22, 7, 8, 1, true).translate(0, 3.5, 0);
  const m = new THREE.Mesh(beamGeo, beamMat(kind === 'bag' ? 0 : Math.max(0, best)));
  m.renderOrder = 4; m.castShadow = false; m.receiveShadow = false; m.userData.beam = true;
  return m;
}
export const Live = {
  veg: null, treeHp: new Map(), vegHidden: new Map(), // id -> respawn time
  spawnT: 0,
  init() {
    const W = G.W;
    // vegetation (instanced) + colliders
    this.veg = new VegLayer(W, { noTufts: !!G.grass }); G.scene.add(this.veg.group);
    this.vegById = new Map();
    for (const v of W.veg) {
      this.vegById.set(v.id, v);
      const r = vegRadius(v.kind) * v.s;
      if (r > 0.05) v.col = G.phys.addCircle(v.x, v.z, r, { h: v.kind === 'boulder' ? 2 : v.kind === 'stump' ? 0.6 : 7, kind: TREE_KINDS.has(v.kind) ? 'tree' : 'rock', ref: v, opaque: v.kind !== 'stump', y0: v.y });
      if (TREE_KINDS.has(v.kind)) v.tree = true;
    }
    // nodes
    for (const n of W.nodes) this.addNode(n);
    // monuments
    for (const m of W.monuments) {
      m.def = MONUMENTS[m.type]; m.power = 0; m.lever = 0; m.spawns = [];
      G.monuments.push(m);
      const layout = LAYOUTS[m.type] || fallbackLayout;
      try { const grp = buildMonument(this.ctx(), m, layout); G.scene.add(grp); m.group = grp; for (const c of G.containers) if (c.mon === m) { c.y = Math.max(Build.floorY(c.x, c.z, c.y), c.y); c.mesh.position.y = c.y; } }
      catch (e) { console.error('monument failed', m.type, e); }
    }
    // roadside
    for (const r of W.roadside) {
      if (r.kind === 'car') {
        let obj = null; try { obj = Models && Models.makeProp ? Models.makeProp('car', {}) : null; } catch (e) { obj = null; }
        if (obj) { obj.position.set(r.x, W.height(r.x, r.z), r.z); obj.rotation.y = -r.ry; G.cull.add(obj, r.x, r.z, 'mid'); }
        G.phys.addCircle(r.x, r.z, 1.4, { h: 1.4, kind: 'prop', opaque: true });
        if (chance(0.5)) this.addContainer({ type: 'barrel', x: r.x + Math.cos(r.ry + 1.6) * 2, z: r.z + Math.sin(r.ry + 1.6) * 2, ry: rand(0, 6) });
      } else for (let i = 0; i < r.n; i++) this.addContainer({ type: r.kind, x: r.x + rand(-1.2, 1.2), z: r.z + rand(-1.2, 1.2), ry: rand(0, 6) });
    }
    // scattered small caches + crates in the wild
    const R = Math.random;
    for (let i = 0; i < 70; i++) {
      const v = pick(W.veg.filter(q => q.kind === 'pine' || q.kind === 'oak')); if (!v) break;
      const x = v.x + 1.2, z = v.z + 0.6; if (G.phys.overlaps(x, z, 0.4)) continue;
      this.addContainer({ type: R() < 0.35 ? 'cache' : 'crate', x, z, ry: R() * 6 });
    }
  },
  /** context object handed to the monument kit */
  ctx() {
    const self = this;
    return {
      phys: G.phys, heightAt: (x, z) => G.W.height(x, z),
      addContainer: o => self.addContainer(o),
      addNpcSpawn: o => { const s = { kind: o.kind, x: o.x, z: o.z, y: o.y, mon: o.mon, opts: o.opts || {}, actor: null, deadAt: -9999 }; G.spawns.push(s); if (o.mon) o.mon.spawns.push(s); return s; },
      addRad: o => { G.rads.push(o); return o; },
      addLight: o => { G.lights.push({ x: o.x, y: o.y, z: o.z, color: o.color, intensity: o.intensity, range: o.range, night: o.night, mon: o.mon }); return o; },
      addDoor: o => { const d = addDoor(Object.assign({ owner: 'mon' }, o)); if (d) d.nid = 'w' + (G.doorN = (G.doorN || 0) + 1); return d; },
      addRoom: o => { G.rooms.push(o); return o; },
      addUse: o => { o.id = o.id || OID++; G.uses.push(o); return o; },
      makeObject: kind => (G.objectKit && G.objectKit[kind]) ? G.objectKit[kind]() : null,
      addFloor: o => { const F = G.floors || (G.floors = new Map()); const cs = 16; for (let i = Math.floor(o.x0 / cs); i <= Math.floor(o.x1 / cs); i++) for (let j = Math.floor(o.z0 / cs); j <= Math.floor(o.z1 / cs); j++) { const key = i * 4096 + j; let l = F.get(key); if (!l) F.set(key, l = []); l.push(o); } return o; },
      addTick: o => { (G.objTicks || (G.objTicks = [])).push(o); return o; },
      addNode: o => self.addNode({ id: 'm' + OID++, type: o.type, x: o.x, z: o.z, s: rand(0.9, 1.1), ry: rand(0, 6), y: G.W.height(o.x, o.z) }),
      vegGeo: kind => { try { return vegOneGeo(kind); } catch (e) { return null; } },
      addVeg: o => { // monument decoration: a lone mesh (not instanced) unless the kit merged it
        if (!o.noMesh) try { const g = Models.vegGeometry(o.kind); const grp = new THREE.Group(); if (g.solid) M.add(grp, g.solid, M.mat('#ffffff', { vc: true })); if (g.cut) M.add(grp, g.cut, M.mat('#ffffff', { vc: true, cut: true })); grp.position.set(o.x, G.W.height(o.x, o.z), o.z); grp.scale.setScalar(o.s || 1); G.cull.add(grp, o.x, o.z, 'big'); } catch (e) { }
        const r = vegRadius(o.kind) * (o.s || 1); if (r > 0.05) G.phys.addCircle(o.x, o.z, r, { h: 5, kind: 'rock' });
      },
      addAnomaly: o => { o.cd = 0; o.art = chance(0.6) ? pick(ART_IDS) : null; G.anomalies.push(o); return o; },
      addSafe: o => { G.safes.push(o); return o; },
      addDeck: o => { (G.decks || (G.decks = [])).push(o); return o; },
      addLabel: o => { G.labels.push(o); return o; },
      addPiece: o => {
        const ai = Math.floor(o.mon.x / 3), aj = Math.floor(o.mon.z / 3);
        const t = { ci: ai + o.ci, cj: aj + o.cj, edge: o.edge };
        const p = Build.place(o.type, t, o.tier || 'stone', 'fort', { force: true, mon: o.mon, level: o.mon.y });
        if (p && o.door) Build.placeDoor(o.door, p, 'fort');
        return p;
      },
      addDeploy: o => Build.placeDeploy(o.type, o.x, o.z, o.ry || 0, 'fort', { mon: o.mon }),
    };
  },
  // ---------------------------------------------------------------- containers
  addContainer(o) {
    const def = CONTAINERS[o.type]; if (!def) return null;
    const c = { id: OID++, type: o.type, def, x: o.x, z: o.z, y: G.W.height(o.x, o.z), ry: o.ry || 0, inv: null, mon: o.mon || null, hp: def.hp || 0, gone: false, respawnAt: 0, opened: false };
    // monument loot sits on the floor it was placed on (ground unless given a height)
    const yb = Build.floorY(o.x, o.z, o.exactY || o.mon ? o.y : undefined); c.y = o.exactY ? o.y : Math.max(c.y, o.y !== undefined && o.mon ? (o.y ?? c.y) : c.y, yb);
    let obj = null; try { obj = Models && Models.makeContainer ? Models.makeContainer(def.model) : null; } catch (e) { obj = null; }
    const info = (Models && Models.CONTAINER_INFO && Models.CONTAINER_INFO[def.model]) || { w: 0.8, d: 0.6, h: 0.7 };
    if (!obj) { obj = new THREE.Group(); M.add(obj, M.box(info.w || 0.8, info.h || 0.7, info.d || 0.6), M.surf(o.type.startsWith('barrel') ? 'blue_paint' : 'plank'), 0, (info.h || 0.7) / 2, 0); }
    obj.position.set(c.x, c.y, c.z); obj.rotation.y = c.ry; G.cull.add(obj, c.x, c.z, 'small'); c.mesh = obj;
    const r = info.r || Math.max(info.w || 0.8, info.d || 0.6) / 2;
    c.col = G.phys.addCircle(c.x, c.z, Math.min(r, 0.75), { h: info.h || 0.8, kind: 'container', ref: c, opaque: !!c.def.breakable, y0: c.y });
    G.containers.push(c);
    return c;
  },
  /** roll loot on first open */
  lootOf(c) {
    if (c.inv) return c.inv;
    const inv = new Inv(12);
    if (c.def.give) for (const [id, a, b] of c.def.give) inv.add(id, randi(a, b));
    const T = LOOT[c.def.loot];
    if (T) rollInto(inv, T, G.run && G.run.perks.includes('scavenger') ? 1 : 0);
    c.inv = inv; return inv;
  },
  breakContainer(c, by, opt = {}) {
    if (c.gone) return;
    // co-op guest: the host rolls the loot and breaks it for everyone (and hands the loot straight to us)
    if (G.net && G.net.role === 'guest' && !(G.netWorld && G.netWorld.applying)) { G.net.send({ t: 'cbreak', cid: c.id, al: by === G.player && G.settings.autoLoot !== false ? 1 : 0 }); c.gone = true; c.mesh.visible = false; c.col.off = true; if (G.fx) G.fx.debris(c.x, c.y + 0.4, c.z, 'metal'); return; }
    const inv = this.lootOf(c);
    c.gone = true; c.mesh.visible = false; c.col.off = true; c.respawnAt = G.t + c.def.respawn;
    if (!inv.empty()) {
      const P = G.player, near = a => a && (a.x - c.x) ** 2 + (a.z - c.z) ** 2 < 40 * 40;
      // quality of life: smashing a barrel puts its loot straight in your pockets (what doesn't fit drops)
      if (by && by === P && !P.dead && G.settings.autoLoot !== false && near(P)) { const left = this.autoLoot(inv, c.x, c.y + 1.1, c.z); if (!left.empty()) this.dropInv(c.x, c.z, left, 'item', 600, c.y + 0.5); }
      else if (by && by.remote !== undefined && opt.auto && G.net && G.net.role === 'host') G.net.sendTo(by.remote, { t: 'loot', x: c.x, y: c.y + 1.1, z: c.z, items: inv.toJSON() });
      else this.dropInv(c.x, c.z, inv, 'item', 600, c.y + 0.5);
    }
    c.inv = null;
    if (G.fx) G.fx.debris(c.x, c.y + 0.4, c.z, 'metal');
    if (G.onContainerLooted) G.onContainerLooted(c, by);
  },
  /** height of a monument floor / stair at (x,z) for someone at height y (undefined = the highest), or null */
  floorAt(x, z, y) {
    const F = G.floors; if (!F) return null; const l = F.get(Math.floor(x / 16) * 4096 + Math.floor(z / 16)); if (!l) return null;
    let best = null;
    for (const f of l) {
      if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
      let fy = f.y;
      if (f.ramp) { const r = f.ramp, dx = r.ax1 - r.ax0, dz = r.az1 - r.az0, L2 = dx * dx + dz * dz || 1; const t = clamp(((x - r.ax0) * dx + (z - r.az0) * dz) / L2, 0, 1); fy = r.y0 + (r.y1 - r.y0) * t; }
      if (y !== undefined && y < fy - 0.9) continue;
      if (best === null || fy > best) best = fy;
    }
    return best;
  },
  /** add an inventory's items to the player with floating text; returns what didn't fit */
  autoLoot(inv, x, y, z) {
    const P = G.player, left = new Inv(Math.max(4, inv.slots.length)); let got = false;
    for (const s of inv.items()) {
      if (!ITEMS[s.id] || !(s.n > 0)) continue;
      const rest = P.inv.addStack(s); const n = s.n - (rest ? rest.n : 0);
      if (n > 0) { got = true; if (G.ui) G.ui.floatText('+' + n + ' ' + ITEMS[s.id].name, x + rand(-0.3, 0.3), y + rand(0, 0.4), z + rand(-0.3, 0.3), ITEMS[s.id].col); if (G.onGive) G.onGive(s.id, n); }
      if (rest) left.addStack(rest);
    }
    if (got) { Sfx.pickup(); if (G.ui) G.ui.refreshAll(); }
    if (!left.empty() && G.ui) G.ui.toast('Inventory full — the rest dropped');
    return left;
  },
  despawnContainer(c) {
    c.gone = true; c.mesh.visible = false; c.col.off = true; c.respawnAt = G.t + c.def.respawn * (0.85 + Math.random() * 0.3); c.inv = null; c.emptyAt = 0; c.openedAt = 0; c.opened = false;
    const P = G.player; if (G.fx && P && dist(P.x, P.z, c.x, c.z) < 60) { G.fx.debris(c.x, c.y + 0.4, c.z, c.type === 'locker' || c.type === 'military' || c.type === 'elite' || c.type === 'ammobox' ? 'metal' : 'wood'); }
  },
  /** container emptied by the player -> despawn shortly after */
  checkEmpty(c) { if (c.inv && c.inv.empty() && !c.gone && c.def.respawn) { c.emptyAt = G.t; } },
  // ---------------------------------------------------------------- nodes
  addNode(n) {
    const def = NODES[n.type]; n.hp = n.maxhp = def.hp * (n.s || 1); n.gone = false;
    let obj = null; try { obj = Models && Models.makeNode ? Models.makeNode(n.type) : null; } catch (e) { obj = null; }
    if (!obj) { obj = new THREE.Group(); M.add(obj, M.ico(0.8, 0), M.mat(n.type === 'sulfur' ? '#b8a840' : n.type === 'metal' ? '#8a6a5a' : '#8a8a86', { flat: true }), 0, 0.5, 0); }
    n.y = n.y ?? G.W.height(n.x, n.z);
    obj.position.set(n.x, n.y, n.z); obj.rotation.y = n.ry || 0; obj.scale.setScalar(n.s || 1); G.cull.add(obj, n.x, n.z, 'mid'); n.mesh = obj;
    n.col = G.phys.addCircle(n.x, n.z, 0.7 * (n.s || 1), { h: 1.2 * (n.s || 1), kind: 'node', ref: n, y0: n.y });
    G.nodes.push(n); return n;
  },
  // ---------------------------------------------------------------- drops
  dropInv(x, z, inv, kind = 'item', life = 600, atY) {
    const d = { id: OID++, x: x + rand(-0.3, 0.3), z: z + rand(-0.3, 0.3), inv, kind, t: G.t + life };
    if (G.net && G.net.role === 'guest' && G.netWorld && !G.netWorld.applying) d.id = G.netWorld.newDropId(); // the host learns about it from the next diff
    d.y = Build.floorY(d.x, d.z, atY); // atY: the height it falls from (a ship's crew room is under its bridge)
    let obj = null; try { obj = Models && Models.makePickup ? Models.makePickup(kind) : null; } catch (e) { obj = null; }
    if (!obj) { obj = new THREE.Group(); M.add(obj, M.box(0.5, 0.35, 0.4), M.surf(kind === 'bag' ? 'tarp_green' : 'cloth'), 0, 0.18, 0); }
    obj.position.set(d.x, d.y, d.z); obj.rotation.y = rand(0, 6);
    const beam = lootBeam(inv, kind); if (beam) obj.add(beam);
    G.cull.add(obj, d.x, d.z, beam ? 'mid' : 'small'); d.mesh = obj;
    G.drops.push(d); return d;
  },
  dropItem(x, z, id, n, extra, atY) { const inv = new Inv(4); inv.add(id, n, extra); return this.dropInv(x, z, inv, ITEMS[id] && ITEMS[id].cat === 'gun' ? 'weapon' : 'item', 300, atY ?? (G.player ? G.player.y + 0.5 : undefined)); },
  removeDrop(d) { d.mesh.removeFromParent(); const i = G.drops.indexOf(d); if (i >= 0) G.drops.splice(i, 1); },
  // ---------------------------------------------------------------- tick
  update(dt) {
    const P = G.player; const now = G.t;
    // co-op guest: the host owns respawns, despawns and spawning — only cosmetic bits here
    if (G.net && G.net.role === 'guest') { for (const a of G.anomalies) { a.cd -= dt; if (G.fx && P && dist(P.x, P.z, a.x, a.z) < 40) G.fx.anomaly(a.x, G.W.height(a.x, a.z), a.z, a.kind); } return; }
    // containers: respawn / despawn emptied ones
    for (const c of G.containers) {
      if (c.gone) {
        if (c.def.respawn && now > c.respawnAt && (!P || dist(P.x, P.z, c.x, c.z) > 40)) { c.gone = false; c.mesh.visible = true; c.col.off = false; c.inv = null; c.hp = c.def.hp || 0; c.opened = false; }
      } else if (c.inv && c.def.respawn && !c.def.breakable && !c.ship) {
        // looted crates vanish: emptied ones as soon as nobody has them open, picked-over ones a couple of minutes
        // after they were first opened (whatever was left goes with them). They come back later with fresh loot.
        const showing = G.ui && G.ui.sheetOpen && G.ui.curSide && G.ui.curSide.inv === c.inv;
        if (c.inv.empty()) { if (!c.emptyAt) c.emptyAt = now; if (now - c.emptyAt > 1.2 && !showing) this.despawnContainer(c); }
        else if (c.openedAt && now - c.openedAt > 150 && !showing) this.despawnContainer(c);
      }
    }
    // nodes / trees respawn
    for (const n of G.nodes) if (n.gone && now > n.respawnAt && (!P || dist(P.x, P.z, n.x, n.z) > 40)) { n.gone = false; n.hp = n.maxhp; n.mesh.visible = true; n.mesh.scale.setScalar(n.s || 1); n.col.off = false; }
    for (const [id, at] of this.vegHidden) {
      if (now < at) continue; const v = this.vegById.get(id); if (P && dist(P.x, P.z, v.x, v.z) < 40) continue;
      this.vegHidden.delete(id); this.veg.set(id, 1); if (v.col) v.col.off = false; this.treeHp.delete(id);
    }
    // drops expire
    for (let i = G.drops.length - 1; i >= 0; i--) { const d = G.drops[i]; if (now > d.t || (d.inv.empty() && d.kind !== 'bag')) this.removeDrop(d); else if (d.inv.empty()) this.removeDrop(d); }
    // anomalies
    for (const a of G.anomalies) { a.cd -= dt; if (G.fx && P && dist(P.x, P.z, a.x, a.z) < 40) G.fx.anomaly(a.x, G.W.height(a.x, a.z), a.z, a.kind); }
    // spawn points + population
    this.spawnT -= dt;
    if (this.spawnT <= 0 && P) { this.spawnT = 1.5; this.population(); }
  },
  population() {
    const W = G.W; const A = G.net && G.net.role === 'host' ? G.net.anchors() : [G.player];
    const P = A[Math.floor(Math.random() * A.length)] || G.player; // wildlife/roamers grow around a random player each tick
    const near = (x, z) => { let m = 1e9; for (const q of A) m = Math.min(m, dist(q.x, q.z, x, z)); return m; };
    // monument spawns
    for (const s of G.spawns) {
      const d = near(s.x, s.z);
      if (s.actor) {
        if (s.actor.removed) { s.actor = null; continue; }
        if (s.actor.dead) { s.deadAt = G.t; s.actor = null; continue; }
        if (d > 180 && !s.actor.ai.alertT) { removeActor(s.actor); s.actor = null; }
      } else if (d < 120 && d > 25 && G.t - s.deadAt > (s.opts.respawn || 900)) {
        if (s.mon && s.mon.def && s.mon.def.safe === undefined && G.t < 2 && d < 60) continue;
        const a = spawnActor(s.kind, s.x, s.z, { patrol: s.opts.patrol, mon: s.mon, spawn: s });
        if (s.opts.guard) a.ai.guard = true;
        if (s.opts.y) a.y = s.y; // spawns on an upper storey
        s.actor = a;
      }
    }
    // wildlife + roamers around the player
    let wild = 0, roam = 0;
    for (const a of G.actors) {
      if (a.dead || a.spawn || a.team === 'raider' || a === G.player || a.heli || a.bot || a.remote !== undefined || a.shipCrew) continue;
      const d = near(a.x, a.z);
      if (d > 130 && !a.ai.alertT) { removeActor(a); continue; }
      if (a.kind === 'animal') wild++; else if (a.roamer) roam++;
    }
    const night = G.night > 0.5;
    const maxWild = (night ? 9 : 7) * A.length;
    if (wild < maxWild && chance(0.6)) {
      const ang = rand(0, 6.28), r = rand(48, 85); const x = P.x + Math.cos(ang) * r, z = P.z + Math.sin(ang) * r;
      if (W.walkable(x, z) && !W.isWater(x, z) && !G.phys.overlaps(x, z, 0.6) && !Build.inPrivilege(x, z) && !nearMon(x, z, 8)) {
        const b = W.biomeAt(x, z);
        let table;
        if (b === B.SNOW) table = [['wolf', 1.6], ['bear', 1.2], ['deer', 3], ['boar', 1]];
        else if (b === B.FOREST) table = [['deer', 4], ['boar', 3], ['wolf', night ? 1.2 : 0.4], ['bear', 0.6], ['chicken', 1]];
        else if (b === B.ARID) table = [['boar', 2], ['chicken', 3], ['wolf', 0.3]];
        else if (b === B.BEACH) table = [['chicken', 2], ['boar', 1]];
        else table = [['chicken', 3], ['deer', 3], ['boar', 2.5], ['wolf', night ? 0.8 : 0.2], ['bear', 0.3]];
        const kind = weighted(table)[0];
        const n = kind === 'wolf' ? (chance(0.6) ? 1 : 2) : kind === 'chicken' ? randi(1, 3) : 1;
        for (let i = 0; i < n; i++) spawnActor(kind, x + rand(-2, 2), z + rand(-2, 2));
      }
    }
    // roaming scav pairs along roads by day
    if (!night && roam < 2 && chance(0.05)) {
      const road = pick(W.roads); const q = pick(road); if (q && dist(P.x, P.z, q[0], q[1]) > 55 && dist(P.x, P.z, q[0], q[1]) < 110 && !nearMon(q[0], q[1], 10) && !Build.inPrivilege(q[0], q[1])) {
        const kind = G.day >= 3 && chance(0.4) ? 'bandit' : 'scav';
        for (let i = 0; i < randi(1, 2); i++) { const a = spawnActor(kind, q[0] + rand(-2, 2), q[1] + rand(-2, 2)); a.roamer = true; a.ai.patrol = [[q[0], q[1]], [P.x + rand(-30, 30), P.z + rand(-30, 30)]]; }
      }
    }
  },
  // ---------------------------------------------------------------- queries
  radAt(x, z) {
    let r = 0;
    for (const z0 of G.rads) { const d = dist(x, z, z0.x, z0.z); if (d < z0.r) r += z0.power * (1 - d / z0.r * 0.6); }
    return r;
  },
  safeAt(x, z) { for (const s of G.safes) if ((s.x - x) ** 2 + (s.z - z) ** 2 < s.r * s.r) return s; return null; },
  /** felled tree / mined node bookkeeping */
  hitTree(v, amount) {
    const hp = (this.treeHp.get(v.id) ?? NODES.tree.hp * v.s) - amount;
    this.treeHp.set(v.id, hp);
    this.veg.set(v.id, 1, 0.06); setTimeout(() => this.veg.set(v.id, this.vegHidden.has(v.id) ? 0 : 1, 0), 90);
    if (hp <= 0) {
      this.vegHidden.set(v.id, G.t + 600); this.veg.set(v.id, 0); if (v.col) v.col.off = true;
      // falling tree mesh
      try {
        const g = Models.vegGeometry(v.kind); const grp = new THREE.Group();
        if (g.solid) M.add(grp, g.solid, M.mat('#ffffff', { vc: true })); if (g.cut) M.add(grp, g.cut, M.mat('#ffffff', { vc: true }));
        grp.position.set(v.x, v.y, v.z); grp.scale.setScalar(v.s); grp.rotation.y = v.ry; if (G.fx) G.fx.fall(grp, Math.atan2(v.z - G.player.z, v.x - G.player.x));
      } catch (e) { }
      return true;
    }
    return false;
  },
  hitNode(n, amount) {
    n.hp -= amount; const k = clamp(n.hp / n.maxhp, 0, 1);
    n.mesh.scale.setScalar((n.s || 1) * (0.45 + 0.55 * k));
    if (n.hp <= 0) { n.gone = true; n.mesh.visible = false; n.col.off = true; n.respawnAt = G.t + 720; return true; }
    return false;
  },
  pickVeg(v) { this.vegHidden.set(v.id, G.t + 480); this.veg.set(v.id, 0); },
  /** nearest vegetation of given kinds within r */
  vegNear(x, z, r, kinds) {
    let best = null, bd = r * r;
    const ci0 = Math.floor((x - r) / 64), ci1 = Math.floor((x + r) / 64), cj0 = Math.floor((z - r) / 64), cj1 = Math.floor((z + r) / 64);
    const W = G.W; const nch = Math.ceil(W.size / 64);
    for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) {
      if (ci < 0 || cj < 0 || ci >= nch || cj >= nch) continue;
      for (const v of W.vegChunks[cj * nch + ci]) {
        if (!kinds.has(v.kind) || this.vegHidden.has(v.id)) continue;
        const d = (v.x - x) ** 2 + (v.z - z) ** 2; if (d < bd) { bd = d; best = v; }
      }
    }
    return best;
  },
};

function nearMon(x, z, pad) { for (const m of G.monuments) if ((m.x - x) ** 2 + (m.z - z) ** 2 < (m.size + pad) ** 2) return m; return null; }

export function rollInto(inv, T, extra = 0) {
  const n = randi(T.rolls[0], T.rolls[1]) + (T.rolls[1] > 0 ? extra : 0);
  for (let i = 0; i < n; i++) {
    const e = weighted(T.items); let id = e[0];
    if (id === 'bp_t1' || id === 'bp_t2' || id === 'bp_t3') id = pick(BP_BY_TIER[+id[4]]);
    if (id === 'art_any') id = pick(ART_IDS);
    if (!ITEMS[id]) continue;
    inv.add(id, randi(e[2], e[3]));
  }
  if (T.always) for (const [id, a, b] of T.always) inv.add(id, randi(a, b));
  return inv;
}

function fallbackLayout(K) {
  const s = K.mon.size;
  K.ground(0, 0, s, s, 'concrete');
  K.room({ x: 0, z: 0, w: 8, d: 6, doors: [{ side: 's', at: 0, w: 1.6 }] });
  K.container('crate', 1, 0); K.container('crate', -2, 1);
  for (let i = 0; i < 4; i++) K.container('barrel', rand(-s / 2, s / 2), rand(-s / 2, s / 2));
}
void ENEMIES;

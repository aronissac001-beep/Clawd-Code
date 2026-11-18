// ============================================================================
// ZONEFALL 4 — co-op stage 2: one shared world. The host's phone owns it.
//
//  * World state (base pieces + doors, deployables incl. box/furnace contents,
//    loot containers, ground drops, mined nodes, felled trees/picked plants) is
//    synced with a two-way diff: every 0.4 s the host compares the world to what
//    it last broadcast and sends only changes; each guest compares its world to
//    what the host last told it and sends its own changes (building, looting,
//    chopping...) up to the host, which applies them and re-broadcasts.
//  * Enemies, animals, AI survivors and the gunship run only on the host; each
//    guest gets the ones near them streamed 10x a second and draws them. A guest's
//    hits on them are sent to the host; their shots and explosions are replayed
//    on the guest, whose own game decides if it was hit.
//  * Guests stop simulating anything world-changing themselves (spawns, respawns,
//    raids, airdrops, turrets, smelting) — they mirror the host.
// ============================================================================
import { G } from './state.js';
import { Build } from './build.js';
import { Live } from './world/live.js';
import { Inv } from './inventory.js';
import { spawnActor, removeActor } from './actors.js';
import { spawnProjectile } from './combat.js';
import { removeDoor } from './doors.js';
import { WEAPONS, CONTAINERS, ENEMIES } from './data.js';
import { Sfx } from './audio.js';
import { clamp, lerp } from './util.js';
import { Cargo } from './cargo.js';

const r2 = v => Math.round(v * 100) / 100, r1 = v => Math.round(v * 10) / 10;
const hp5 = v => Math.ceil(v / 5) * 5;
const ACT_R = 230, ACT_DROP = 270;

// ---------------------------------------------------------------- keys + records
// pieces upstairs carry their storey in the key ("e<edge>,i,j,st", "c<i>,<j>,st"); stairs are "s<i>,<j>,st"
// triangles are "T<f|c><cx*20>,<cz*20>[,st]"; walls on a triangle's slanted edge are "ed,<mx*20>,<mz*20>[,st]"
function pieceKey(p) { const st = p.st ? ',' + p.st : ''; if (p.tk) return 'T' + (p.type === 'tri_foundation' ? 'f' : 'c') + p.tk.slice(1) + st; return p.edge ? 'e' + Build.edgeKeyOf(p) : (p.type === 'foundation' ? 'f' : p.type === 'stairs' ? 's' : 'c') + p.ci + ',' + p.cj + (p.type === 'stairs' ? ',' + (p.st || 0) : st); }
const geoRec = p => p.tk ? [...p.verts.flat().map(v => Math.round(v * 1000) / 1000), p.level] : p.edge === 'd' ? p.seg : 0;
// deployables on an upper floor also key on their height (a box upstairs can sit right above one downstairs)
function deployKey(d) { const up = d.y !== undefined && G.W && d.y - G.W.height(d.x, d.z) > 2.2 ? '|' + Math.round(d.y * 2) : ''; return 'd' + d.type + '|' + Math.round(d.x * 10) + '|' + Math.round(d.z * 10) + up; }
function pieceRec(p) { const dr = p.door; return [p.type, p.tier, p.ci, p.cj, p.edge || '', p.level ?? null, hp5(p.hp), p.owner, p.hw || '', dr && !dr.dead ? [dr.kind, hp5(dr.hp), dr.flip ? 1 : 0] : 0, p.st || 0, p.dir || 0, geoRec(p)]; }
function stateRec(s) { if (!s) return 0; const o = {}; for (const k in s) { const v = s[k]; o[k] = typeof v === 'number' ? r1(v) : v; } return o; }
function deployRec(d) { return [d.type, r2(d.x), r2(d.z), r2(d.ry || 0), d.owner, hp5(d.hp), stateRec(d.state), d.inv ? d.inv.toJSON() : 0, r2(d.y ?? 0)]; }
function dropRec(d) { return [r2(d.x), r2(d.y), r2(d.z), d.kind, d.inv.toJSON(), d.inv.size, d.corpse || 0]; }

/** base doors are keyed by their wall piece, monument doors by build order (same seed, same order) */
function doorKey(d) { return d.piece ? 'p' + pieceKey(d.piece) : d.nid || null; }
function setInv(inv, json, size) { const n = Inv.from(json, size || inv.size); inv.slots.length = 0; for (const s of n.slots) inv.slots.push(s); }

export const NW = {
  applying: false,
  known: null,            // last world state agreed with the host (both roles)
  diffT: 0, actT: 0, trainT: 0,
  sent: new Map(),        // host: guestId -> Set(actor ids) that guest is mirroring
  mirrors: new Map(),     // guest: host actor id -> mirrored actor
  pendingOpen: new Map(), // guest: container id -> callback once its contents arrive
  gid: 0,                 // guest-made drop ids
  boomExcept: null,
  get host() { return G.net && G.net.role === 'host'; },
  get guest() { return G.net && G.net.role === 'guest'; },
  reset() { this.known = null; this.vknown = new Map(); this.sent.clear(); for (const a of this.mirrors.values()) removeActor(a); this.mirrors.clear(); this.pendingOpen.clear(); this.dropCrate = null; },
  // ---------------------------------------------------------------- world state
  collect() {
    const s = { p: new Map(), d: new Map(), c: new Map(), r: new Map(), o: new Map(), n: new Set(), v: new Set() };
    for (const p of Build.allPieces()) if (!p.dead) s.p.set(pieceKey(p), JSON.stringify(pieceRec(p)));
    for (const d of Build.deploys) if (!d.dead) s.d.set(deployKey(d), JSON.stringify(deployRec(d)));
    for (const c of G.containers) if (c.gone || c.inv || c.locked !== undefined) s.c.set(String(c.id), JSON.stringify([c.gone ? 1 : 0, c.inv ? c.inv.toJSON() : 0, c.locked ? (c.hackEnd ? Math.max(1, Math.ceil((c.hackEnd - G.t) / 5) * 5) : -1) : 0]));
    for (const d of G.drops) s.r.set(String(d.id), JSON.stringify(dropRec(d)));
    for (const n of G.nodes) if (n.gone && n.id !== undefined) s.n.add(String(n.id));
    for (const id of Live.vegHidden.keys()) s.v.add(String(id));
    for (const d of G.doors) if (!d.dead) { const k = doorKey(d); if (k) s.o.set(k, JSON.stringify([d.open ? d.sign || 1 : 0, d.locked ? 1 : 0])); }
    return s;
  },
  diff(a, b) {
    const out = {}; let any = false;
    for (const k of ['p', 'd', 'c', 'r', 'o']) {
      const L = []; const A = a ? a[k] : new Map(), B = b[k];
      for (const [key, v] of B) if (A.get(key) !== v) L.push([key, JSON.parse(v)]);
      for (const key of A.keys()) if (!B.has(key)) L.push([key, 0]);
      if (L.length) { out[k] = L; any = true; }
    }
    for (const k of ['n', 'v']) {
      const L = []; const A = a ? a[k] : new Set(), B = b[k];
      for (const id of B) if (!A.has(id)) L.push([id, 1]);
      for (const id of A) if (!B.has(id)) L.push([id, 0]);
      if (L.length) { out[k] = L; any = true; }
    }
    return any ? out : null;
  },
  apply(m) {
    this.applying = true;
    try {
      for (const [k, r] of m.p || []) this.applyPiece(k, r);
      for (const [k, r] of m.d || []) this.applyDeploy(k, r);
      for (const [k, r] of m.c || []) this.applyContainer(k, r);
      for (const [k, r] of m.r || []) this.applyDrop(k, r);
      for (const [k, on] of m.n || []) this.applyNode(k, on);
      for (const [k, on] of m.v || []) this.applyVeg(k, on);
      for (const [k, r] of m.o || []) this.applyDoor(k, r);
      Build.dirty = true;
    } catch (e) { console.warn('world apply', e); }
    this.applying = false;
  },
  findPiece(k) {
    if (k[0] === 'e') return Build.edges.get(k.slice(1)) || null;
    if (k[0] === 'T') { const [a, b, st] = k.slice(2).split(','); return Build.triPiece('t' + a + ',' + b, k[1], +st || 0); }
    const [i, j, st] = k.slice(1).split(',').map(Number);
    if (k[0] === 'f') return Build.found(i, j);
    return k[0] === 's' ? Build.stairAt(i, j, st || 0) : Build.ceilAt(i, j, st || 0);
  },
  applyPiece(k, r) {
    let cur = this.findPiece(k);
    if (!r) { if (cur && !cur.dead) Build.destroy(cur, true); return; }
    const [type, tier, ci, cj, edge, level, hp, owner, hw, door, st, dir, geo] = r;
    if (cur && (cur.type !== type || (cur.hw || '') !== hw || (level !== null && cur.level !== level) || (type === 'stairs' && (cur.dir || 0) !== (dir || 0)))) { Build.destroy(cur, true); cur = null; }
    if (!cur) {
      const t = Array.isArray(geo) && geo.length >= 7 ? { tri: [[geo[0], geo[1]], [geo[2], geo[3]], [geo[4], geo[5]]], level: geo[6], st: st || 0 }
        : edge === 'd' && Array.isArray(geo) ? { edge: 'd', seg: geo, st: st || 0 } : edge ? { edge, ci, cj, st: st || 0 } : { ci, cj, st: st || 0, dir: dir || 0 };
      if (type === 'highgate') { cur = Build.place(hw || 'highwall_wood', t, 'wood', owner, { force: true }); if (cur) { cur.type = 'highgate'; Build._rebuild(cur); } }
      else cur = Build.place(hw || type, t, tier, owner, { force: true, level: level ?? undefined });
      if (!cur) return;
      if (type === 'foundation' && level !== null) { cur.level = level; Build.makeMesh(cur); }
      cur.placedAt = -999;
    } else if (cur.tier !== tier && type !== 'highgate') Build.upgrade(cur, tier, true);
    cur.hp = hp;
    if (door && !(cur.door && !cur.door.dead)) { const d = Build.placeDoor(door[0], cur, owner, { flip: !!door[2] }); if (d) d.hp = door[1]; }
    else if (door && cur.door) { cur.door.hp = door[1]; if (!!cur.door.flip !== !!door[2]) { cur.door.flip = !!door[2]; if (cur.door.mesh) cur.door.mesh.root.rotation.y += Math.PI; } }
    else if (!door && cur.door) { removeDoor(cur.door); cur.door = null; }
  },
  applyDoor(k, r) {
    if (!Array.isArray(r)) return;
    const d = G.doors.find(q => !q.dead && doorKey(q) === k); if (!d) return;
    const sg = Math.sign(+r[0] || 0);
    if (sg && !d.open) { d.open = true; d.sign = sg; d.closeT = 0; Sfx.doorOpen(d.x, d.z, d.metal); }
    else if (!sg && d.open) { d.open = false; setTimeout(() => Sfx.doorClose(d.x, d.z, d.metal), 180); }
    if (d.card) { const L = !!r[1]; if (d.locked !== L) { d.locked = L; if (!L) d.unlockT = 240; } }
  },
  applyDeploy(k, r) {
    let cur = Build.deploys.find(d => !d.dead && deployKey(d) === k);
    if (!r) { if (cur) Build.removeDeploy(cur, true); return; }
    const [type, x, z, ry, owner, hp, state, inv, y] = r;
    if (!cur) { cur = Build.placeDeploy(type, x, z, ry, owner, { y: typeof y === 'number' ? y + 0.05 : undefined, state: state || undefined }); if (!cur) return; }
    else if (typeof y === 'number' && Math.abs((cur.y ?? y) - y) > 0.3 && type !== 'ladder') Build.dropDeploy(cur);
    cur.hp = hp; if ((cur.ry || 0) !== ry) { cur.ry = ry; if (cur.mesh) cur.mesh.rotation.y = -ry; }
    if (state && cur.state) Object.assign(cur.state, state);
    if (inv && cur.inv) setInv(cur.inv, inv);
  },
  applyContainer(k, r) {
    const c = G.containers.find(q => String(q.id) === k); if (!c) return;
    const gone = r ? !!r[0] : false, inv = r ? r[1] : 0;
    if (c.gone !== gone) { c.gone = gone; c.mesh.visible = !gone; c.col.off = gone; }
    if (inv) { if (c.inv) setInv(c.inv, inv); else c.inv = Inv.from(inv, 12); } else c.inv = null;
    if (r && r.length > 2) { const lk = +r[2] || 0; c.locked = lk !== 0; if (lk > 0) { const end = G.t + lk; if (!c.hackEnd || Math.abs(c.hackEnd - end) > 6) c.hackEnd = end; } else c.hackEnd = 0; }
    const cb = this.pendingOpen.get(k); if (cb && c.inv) { this.pendingOpen.delete(k); setTimeout(cb, 0); } // after the sync baseline is updated, so what we take goes back to the host
  },
  applyDrop(k, r) {
    const cur = G.drops.find(d => String(d.id) === k);
    if (!r) { if (cur) Live.removeDrop(cur); return; }
    const [x, y, z, kind, inv, size, corpse] = r;
    if (!cur) { const d = Live.dropInv(x, z, Inv.from(inv, size || 12), kind, 900); d.id = isNaN(+k) ? k : +k; d.x = x; d.z = z; d.y = y; d.mesh.position.set(x, y, z); if (corpse) d.corpse = corpse; return; }
    setInv(cur.inv, inv, size);
  },
  applyNode(k, on) {
    const n = G.nodes.find(q => String(q.id) === k); if (!n) return;
    if (on && !n.gone) { n.gone = true; n.hp = 0; n.mesh.visible = false; n.col.off = true; n.respawnAt = G.t + 720; }
    else if (!on && n.gone) { n.gone = false; n.hp = n.maxhp; n.mesh.visible = true; n.mesh.scale.setScalar(n.s || 1); n.col.off = false; }
  },
  applyVeg(k, on) {
    const id = isNaN(+k) ? k : +k; const v = Live.vegById.get(id); if (!v) return;
    if (on) { if (!Live.vegHidden.has(id)) { Live.vegHidden.set(id, this.guest ? Infinity : G.t + 600); Live.veg.set(id, 0); if (v.col) v.col.off = true; } }
    else if (Live.vegHidden.has(id)) { Live.vegHidden.delete(id); Live.veg.set(id, 1); if (v.col) v.col.off = false; Live.treeHp.delete(id); }
  },
  // ---------------------------------------------------------------- joining: a full copy of the host's world
  snapshot() {
    const cont = G.containers.map(c => [c.id, c.type, r2(c.x), r2(c.y), r2(c.z), r2(c.ry || 0)]);
    return { t: 'wsnap', cont, w: this.diff(null, this.collect()) || {}, veh: G.vehicles ? G.vehicles.netList() : [] };
  },
  applySnapshot(m) {
    this.applying = true;
    try {
      // everything that lives in the world now comes from the host
      for (const a of [...G.actors]) if (a !== G.player && a.remote === undefined) removeActor(a);
      if (G.bots) G.bots.reset();
      if (G.cargo) { try { G.cargo.dispose(); } catch (e) { } G.cargo = null; }
      for (const c of G.containers) { c.mesh.removeFromParent(); if (c.col) G.phys.remove(c.col); }
      G.containers.length = 0;
      for (const [id, type, x, y, z, ry] of m.cont || []) { if (!CONTAINERS[type]) continue; const c = Live.addContainer({ type, x, z, ry }); if (!c) continue; c.id = id; c.y = y; c.mesh.position.y = y; }
      for (const d of [...G.drops]) Live.removeDrop(d);
      Build.reset();
      for (const n of G.nodes) if (n.gone) this.applyNode(String(n.id), 0);
      for (const id of [...Live.vegHidden.keys()]) this.applyVeg(String(id), 0);
    } catch (e) { console.warn('snapshot', e); }
    this.applying = false;
    this.apply(m.w || {});
    this.known = this.collect();
    if (G.vehicles && Array.isArray(m.veh)) { try { G.vehicles.fromNet(m.veh); } catch (e) { console.warn('vehicles', e); } } // the same cars, copters and boats as the host
    if (G.ui) G.ui.toast('Synced with the host\'s world', 'good');
  },
  /** guest: a container the host made mid-game (the airdrop crate) */
  addContainer(r) {
    if (!Array.isArray(r)) return; const [id, type, x, y, z, ry, lk] = r;
    if (!CONTAINERS[type] || ![x, y, z].every(Number.isFinite) || G.containers.some(q => q.id === id)) return;
    const c = Live.addContainer({ type, x, z, ry: +ry || 0 }); if (!c) return; c.id = id; c.y = y; c.mesh.position.y = y; if (c.col) { c.col.y0 = y; c.col.top = undefined; }
    if (lk) { c.locked = true; c.hackEnd = 0; }
    if (G.cargo && G.cargo.mirror && type !== 'airdrop') { c.ship = true; G.cargo.loot.push(c); }
    if (type === 'airdrop') { if (G.airdrop && G.airdrop.phase === 'landed' && !G.airdrop.container) G.airdrop.container = c; else this.dropCrate = c; }
  },
  removeContainers(ids) { for (const id of ids) { const i = G.containers.findIndex(q => q.id === id); if (i < 0) continue; const c = G.containers[i]; G.containers.splice(i, 1); if (c.mesh) c.mesh.removeFromParent(); if (c.col) G.phys.remove(c.col); if (G.cargo) { const k = G.cargo.loot.indexOf(c); if (k >= 0) G.cargo.loot.splice(k, 1); } } },
  takeCrate() { const c = this.dropCrate || null; this.dropCrate = null; return c; },
  // ---------------------------------------------------------------- per frame
  tick() {
    if (!G.net || !G.net.role || !G.player) return;
    const now = performance.now(), dt = Math.min(1, (now - (this.lastT || now)) / 1000); this.lastT = now;
    if ((this.diffT -= dt) <= 0) {
      this.diffT = 0.4;
      const cur = this.collect(); const d = this.diff(this.known, cur);
      if (d) { if (this.host) G.net.broadcast(Object.assign({ t: 'wd' }, d)); else G.net.send(Object.assign({ t: 'wset' }, d)); }
      this.known = cur;
    }
    if (this.host && (this.vehT = (this.vehT || 0) - dt) <= 0) { this.vehT = 0.25; this.streamVehicles(); }
    if (this.host) { if ((this.actT -= dt) <= 0) { this.actT = 0.1; this.streamActors(); } if ((this.cargoT = (this.cargoT || 0) - dt) <= 0) { this.cargoT = 2; if (G.cargo || this.cargoWas) { G.net.broadcast(Cargo.state()); this.cargoWas = !!G.cargo; } } if ((this.trainT -= dt) <= 0 && G.train) { this.trainT = 2; G.net.broadcast({ t: 'train', s: r2(G.train.s), v: r2(G.train.v), st: G.train.state, tt: r2(G.train.t), nx: G.train.next }); } }
    else this.moveMirrors(dt);
  },
  /** host: a guest changed the world — apply, then it goes out to everyone with the next diff */
  fromGuest(m) { this.apply(m); },
  /** guest: the host's changes */
  fromHost(m) { this.apply(m); this.known = this.collect(); },
  // ---------------------------------------------------------------- vehicles (host -> guests): only the ones that changed
  streamVehicles() {
    if (!G.vehicles) return; if (!this.vknown) this.vknown = new Map();
    const cur = new Map(); for (const r of G.vehicles.netList()) cur.set(r[0], JSON.stringify(r));
    const ch = [], rm = [];
    for (const [nid, s] of cur) if (this.vknown.get(nid) !== s) ch.push(JSON.parse(s));
    for (const nid of this.vknown.keys()) if (!cur.has(nid)) rm.push(nid);
    this.vknown = cur;
    if (ch.length || rm.length) G.net.broadcast({ t: 'vst', v: ch, rm });
  },
  // ---------------------------------------------------------------- actors (host -> guests)
  streamActors() {
    const N = G.net;
    for (const [gid, c] of N.conns) {
      if (!c.open) continue; const pl = N.players.get(gid); if (!pl || !pl.actor) continue;
      const me = pl.actor; let sent = this.sent.get(gid); if (!sent) { sent = new Set(); this.sent.set(gid, sent); }
      const st = [], seen = new Set();
      for (const a of G.actors) {
        if (a === G.player || a.remote !== undefined || a.removed) continue;
        const d2 = (a.x - me.x) ** 2 + (a.z - me.z) ** 2;
        if (!sent.has(a.id)) { if (d2 > ACT_R * ACT_R) continue; G.net.sendConn(c, this.addMsg(a)); sent.add(a.id); }
        else if (d2 > ACT_DROP * ACT_DROP) continue;
        seen.add(a.id);
        const f = (a.st.aim ? 1 : 0) | (a.dead ? 2 : 0) | (a.st.swing >= 0 ? 4 : 0) | (a.st.attack >= 0 ? 8 : 0) | (a.st.reload >= 0 ? 16 : 0);
        st.push([a.id, r2(a.x), r2(a.y), r2(a.z), r2(a.ang), f, Math.round(a.hp)]);
      }
      for (const id of [...sent]) if (!seen.has(id)) { sent.delete(id); G.net.sendConn(c, { t: 'arem', aid: id }); }
      if (st.length) G.net.sendConn(c, { t: 'ast', a: st });
    }
  },
  addMsg(a) {
    const look = typeof a.lookSpec === 'string' || (a.lookSpec && typeof a.lookSpec === 'object') ? a.lookSpec : null;
    return { t: 'aadd', aid: a.id, type: a.type, x: r2(a.x), y: r2(a.y), z: r2(a.z), ang: r2(a.ang), team: a.team, look, held: a.gun ? a.gun.id : a.held || null, name: a.bot ? a.bot.name : a.name || null, hp: Math.round(a.hp), maxhp: a.maxhp, heli: !!a.heli, boss: !!a.boss };
  },
  /** host: an NPC fired — replay it on guests who can see that NPC */
  npcShot(a, wid, x, y, z, pellets) {
    if (!this.host) return; const m = { t: 'nshot', aid: a.id, w: wid, o: [r2(x), r2(y), r2(z)], p: pellets.map(q => [Math.round(q[0] * 1e4) / 1e4, Math.round(q[1] * 1e4) / 1e4]) };
    for (const [gid, c] of G.net.conns) { const s = this.sent.get(gid); if (s && s.has(a.id) && c.open) G.net.sendConn(c, m); }
  },
  // ---------------------------------------------------------------- actors (guest side)
  addMirror(m) {
    if (this.mirrors.has(m.aid)) return;
    let a;
    if (m.heli && G.makeHeliMirror) a = G.makeHeliMirror(m.x, m.z, m.y);
    else { if (!ENEMIES[m.type] && m.type !== 'player') return; a = spawnActor(m.type, m.x, m.z, { team: m.team, look: m.look || undefined }); }
    if (!a) return;
    a.mirror = m.aid; a.y = m.y; a.ang = m.ang; a.hp = m.hp; a.maxhp = m.maxhp || a.maxhp; a.boss = m.boss; a.buf = [];
    if (m.name) { a.name = m.name; a.def = Object.assign({}, a.def, { name: m.name }); }
    if (m.held) { try { a.rig.setHeld(m.held); } catch (e) { } a.held = m.held; if (WEAPONS[m.held]) a.gunStack = { id: m.held }; }
    this.mirrors.set(m.aid, a);
  },
  removeMirror(aid) { const a = this.mirrors.get(aid); if (a) { removeActor(a); this.mirrors.delete(aid); } },
  mirrorStates(list) {
    const t = performance.now() / 1000;
    for (const [aid, x, y, z, ang, f, hp] of list) {
      const a = this.mirrors.get(aid); if (!a) continue;
      a.buf.push({ t, x, y, z, ang }); if (a.buf.length > 12) a.buf.shift();
      a.st.aim = !!(f & 1); a.hp = hp;
      if ((f & 2) && !a.dead) { a.dead = true; a.deadT = 0; } else if (!(f & 2) && a.dead) { a.dead = false; }
      if ((f & 4) && a.st.swing < 0) a.st.swing = 0;
      if ((f & 8) && a.st.attack < 0) a.st.attack = 0;
      a.st.reload = (f & 16) ? Math.max(0, a.st.reload) : -1;
    }
  },
  moveMirrors(dt) {
    const now = performance.now() / 1000 - 0.12;
    for (const a of this.mirrors.values()) {
      const B = a.buf; if (!B || !B.length) continue;
      let s0, s1, k; const last = B[B.length - 1];
      if (now >= last.t) { s0 = s1 = last; k = 1; }
      else if (now <= B[0].t) { s0 = s1 = B[0]; k = 1; }
      else { s0 = B[0]; s1 = last; for (let i = 0; i < B.length - 1; i++) if (B[i].t <= now && B[i + 1].t >= now) { s0 = B[i]; s1 = B[i + 1]; break; } k = s1.t > s0.t ? (now - s0.t) / (s1.t - s0.t) : 1; }
      if (Math.hypot(s1.x - s0.x, s1.z - s0.z) > 20) { s0 = s1; k = 1; }
      const ox = a.x, oz = a.z;
      a.x = lerp(s0.x, s1.x, k); a.z = lerp(s0.z, s1.z, k); a.y = lerp(s0.y, s1.y, k);
      let da = s1.ang - s0.ang; da = Math.atan2(Math.sin(da), Math.cos(da)); a.ang = s0.ang + da * k;
      a.speedNow = a.dead ? 0 : Math.min(9, Math.hypot(a.x - ox, a.z - oz) / Math.max(dt, 1e-3));
      if (a.st.swing >= 0) { a.st.swing += dt * 1.6; if (a.st.swing >= 1) a.st.swing = -1; }
      if (a.st.attack >= 0) { a.st.attack += dt * 2.2; if (a.st.attack >= 1) a.st.attack = -1; }
      if (a.heli && a.rig && a.rig.root) { a.rig.root.position.set(a.x, a.y, a.z); a.rig.root.rotation.y = -a.ang; }
    }
  },
  mirrorShot(m) {
    const a = this.mirrors.get(m.aid); const W = WEAPONS[m.w]; if (!a || !W || !Array.isArray(m.p) || !Array.isArray(m.o)) return;
    const [x, y, z] = m.o.map(Number); if (![x, y, z].every(Number.isFinite)) return;
    const kind = W.arrow ? 'arrow' : W.rocket ? 'rocket' : 'bullet';
    for (const q of m.p.slice(0, 12)) { const ang = +q[0], pitch = +q[1]; if (!Number.isFinite(ang) || !Number.isFinite(pitch)) continue; spawnProjectile({ x, z, y, ang, pitch, v3: true, speed: W.speed, dmg: W.dmg * (G.diff ? G.diff.npcDmg : 1), pen: W.pen || 0, range: W.range, owner: a, team: a.team, kind, wid: m.w, remote: true }); }
    a.st.recoil = 1; if (G.fx && !W.arrow) G.fx.muzzle(x, y, z, +m.p[0][0], W.rocket ? 2 : 1); Sfx.shot(W.sfx, x, z);
  },
  // ---------------------------------------------------------------- guest: loot through the host
  openContainer(c, cb) {
    if (c.inv) return cb();
    const k = String(c.id); this.pendingOpen.set(k, cb); G.net.send({ t: 'copen', cid: c.id });
    setTimeout(() => { if (this.pendingOpen.get(k) === cb) { this.pendingOpen.delete(k); G.ui.toast('The host didn\'t answer — try again', 'bad'); } }, 6000);
  },
  newDropId() { return 'g' + (G.net ? G.net.me : 0) + '-' + (++this.gid); },
};
void clamp;

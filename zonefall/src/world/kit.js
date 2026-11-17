// ============================================================================
// ZONEFALL 3 — monument builder kit. A monument layout is a function
// `layout(K)` that calls K.* with LOCAL coordinates (metres, origin = monument
// centre, +X east / +Z south before rotation). The kit rotates everything by
// the monument's quarter-turn, registers colliders with physics, builds the
// meshes (merged per material at the end) and registers gameplay objects
// (loot, NPC spawns, radiation, doors, rooms with hideable roofs, lights...).
// ============================================================================
import { THREE, M } from '../gfx/materials.js';
import { rng } from '../util.js';

let Models = null;
export function setModels(m) { Models = m; }

const Q = Math.PI / 2;

/**
 * ctx (provided by the game, or a stub in dev):
 *  phys                      Physics instance
 *  heightAt(x,z)             terrain height
 *  addContainer({type,x,z,y,ry,mon})
 *  addNpcSpawn({kind,x,z,y,mon,opts})
 *  addRad({x,z,r,power,mon})
 *  addLight({x,y,z,color,intensity,range,mon,night})
 *  addDoor({x,z,y,axis,w,kind,card,fuse,lever,mon,group}) -> door
 *  addRoom({x0,z0,x1,z1,roof:Group,mon})
 *  addUse({type:'recycler'|'vendor'|'fusebox'|'lever'|'water'|'bench', x,z,y, shop, mon, id, link})
 *  addNode({type,x,z,mon}), addVeg({kind,x,z,s,mon}), addAnomaly({kind,x,z,mon})
 *  addSafe({x,z,r,mon}), addLabel({text,x,z,mon})
 *  addPiece({type,tier,ci,cj,edge,mon}) / addDeploy({type,x,z,ry,mon,owner})  (outlaw forts)
 */
export function buildMonument(ctx, mon, layout) {
  const group = new THREE.Group(); group.name = 'mon:' + mon.type;
  const statics = new THREE.Group(); // merged at the end
  const keep = new THREE.Group();     // not merged (roofs, animated, lights)
  group.add(statics, keep);
  const rot = mon.rot | 0, cs = Math.cos(rot * Q), sn = Math.sin(rot * Q);
  const baseY = mon.y ?? ctx.heightAt(mon.x, mon.z);
  const R = rng((mon.x * 73856093) ^ (mon.z * 19349663) ^ 0x5bd1e995);
  // local -> world
  const W = (x, z) => [mon.x + x * cs - z * sn, mon.z + x * sn + z * cs];
  const Wsize = (w, d) => (rot & 1) ? [d, w] : [w, d];
  const Wry = ry => -(rot * Q + (ry || 0)); // three.js rotation.y for a local yaw (radians, +X->+Z positive = clockwise from above)

  const K = {
    R, mon, rot, baseY, group,
    toWorld: W,
    yAt(x, z) { const [wx, wz] = W(x, z); return ctx.heightAt(wx, wz); },
    /** flat slab (visual only) */
    ground(x, z, w, d, surf = 'concrete', o = {}) {
      const [wx, wz] = W(x, z), [ww, wd] = Wsize(w, d);
      // layered floor slabs used to sit 1-15 mm apart and shimmered (z-fighting) at a distance: space the layers out
      const y = 0.04 + ((o.y ?? 0.03) - 0.02) * 2 + baseY;
      const m = M.add(statics, M.box(ww, o.t ?? 0.1, wd, o.tex ?? 3), M.surf(surf), wx - mon.x, y - (o.t ?? 0.1) / 2 - baseY, wz - mon.z, { cast: false });
      m.receiveShadow = true; return m;
    },
    /** solid box (mesh + collider). opts: y, solid, opaque, cut, collide, keep, tex */
    box(x, z, w, d, h, surf = 'concrete', o = {}) {
      const [wx, wz] = W(x, z), [ww, wd] = Wsize(w, d); const y0 = o.y ?? 0;
      const cut = o.cut ?? (h + y0 > 1.3);
      const mat = typeof surf === 'string' ? M.surf(surf, cut ? { cut: true } : {}) : surf;
      const m = M.add(o.keep ? keep : statics, M.box(ww, h, wd, o.tex ?? 2), mat, wx - mon.x, y0 + h / 2, wz - mon.z, { cast: o.cast !== false });
      const solid = o.solid !== false && y0 < 1.0, opaque = o.opaque !== false && y0 < 1.4 && y0 + h > 1.15;
      if (o.collide !== false && (solid || opaque)) ctx.phys.addBox(wx - ww / 2, wz - wd / 2, wx + ww / 2, wz + wd / 2, { h, solid, opaque, kind: 'mon', y0: baseY + y0 });
      return m;
    },
    /** cylinder (mesh + circle collider) */
    cyl(x, z, r, h, surf = 'metal', o = {}) {
      const [wx, wz] = W(x, z); const y0 = o.y ?? 0; const cut = o.cut ?? (h + y0 > 1.3);
      const m = M.add(o.keep ? keep : statics, M.cyl(o.rTop ?? r, r, h, o.seg ?? 14), M.surf(surf, cut ? { cut: true } : {}), wx - mon.x, y0 + h / 2, wz - mon.z);
      if (o.collide !== false) ctx.phys.addCircle(wx, wz, r, { h, solid: y0 < 1.0, opaque: o.opaque !== false, kind: 'mon', y0: baseY + y0 });
      return m;
    },
    /** axis-aligned wall segment from (x0,z0) to (x1,z1) */
    wall(x0, z0, x1, z1, h = 3, surf = 'concrete', o = {}) {
      const t = o.thick ?? 0.3;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const w = Math.abs(x1 - x0) || t, d = Math.abs(z1 - z0) || t;
      return K.box(cx, cz, Math.abs(x1 - x0) > 0.01 ? w + (o.cap ? t : 0) : t, Math.abs(z1 - z0) > 0.01 ? d + (o.cap ? t : 0) : t, h, surf, o);
    },
    /** chain-link / wire fence line (solid, see-through) */
    fence(x0, z0, x1, z1, h = 2.2, o = {}) {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, len = Math.hypot(x1 - x0, z1 - z0);
      const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
      const [wx, wz] = W(cx, cz); const [ww, wd] = Wsize(alongX ? len : 0.12, alongX ? 0.12 : len);
      // posts + mesh panel (transparent wire look)
      const n = Math.max(1, Math.round(len / 3));
      for (let i = 0; i <= n; i++) { const t = i / n; const [px, pz] = W(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t); M.add(statics, M.cyl(0.05, 0.05, h, 6), M.surf('metal_dark', { cut: true }), px - mon.x, h / 2, pz - mon.z); }
      const panel = M.add(keep, M.box(ww, h * 0.92, wd), M.mat('#9aa3a8', { tex: 'metal', transparent: true, opacity: 0.32, side: 'double' }), wx - mon.x, h / 2, wz - mon.z, { cast: false });
      panel.renderOrder = 2;
      ctx.phys.addBox(wx - ww / 2, wz - wd / 2, wx + ww / 2, wz + wd / 2, { h, solid: true, opaque: false, kind: 'fence', y0: baseY });
      if (o.wire !== false) M.add(statics, M.box(ww > 0.2 ? ww : 0.04, 0.04, wd > 0.2 ? wd : 0.04), M.mat('#6a6e72'), wx - mon.x, h + 0.05, wz - mon.z);
      return panel;
    },
    /**
     * A building room: thin walls with door/window gaps, floor, hideable roof.
     * doors: [{ side:'n'|'s'|'e'|'w', at: offset along side (0 = middle), w: 1.4, type: 'open'|'steel'|'vault', card, fuse, lever }]
     */
    room(o) {
      const { x, z, w, d } = o; const h = o.h ?? 3.2, t = o.thick ?? 0.3; const wallS = o.wall ?? 'concrete';
      const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
      if (o.floor !== false) K.ground(x, z, w, d, o.floor ?? 'tile', { y: 0.06, t: 0.12 });
      const gaps = { n: [], s: [], e: [], w: [] };
      for (const dr of (o.doors || [])) gaps[dr.side].push({ a: dr.at ?? 0, w: dr.w ?? 1.4, door: dr, top: 2.3 });
      for (const wn of (o.windows || [])) gaps[wn.side].push({ a: wn.at ?? 0, w: wn.w ?? 1.4, win: true });
      const side = (s, ax0, az0, ax1, az1, along) => {
        // along: 'x' or 'z'; build segments between gaps
        const L = along === 'x' ? ax1 - ax0 : az1 - az0; const mid = along === 'x' ? (ax0 + ax1) / 2 : (az0 + az1) / 2;
        const gs = gaps[s].map(g => ({ ...g, lo: mid + g.a - g.w / 2, hi: mid + g.a + g.w / 2 })).sort((p, q) => p.lo - q.lo);
        let cur = along === 'x' ? ax0 - t / 2 : az0 - t / 2; const end = (along === 'x' ? ax1 : az1) + t / 2;
        const seg = (a, b, y0, hh, opaque = true) => { if (b - a < 0.02) return; if (along === 'x') K.box((a + b) / 2, az0, b - a, t, hh, wallS, { y: y0, opaque }); else K.box(ax0, (a + b) / 2, t, b - a, hh, wallS, { y: y0, opaque }); };
        for (const g of gs) {
          seg(cur, g.lo, 0, h);
          if (g.win) { seg(g.lo, g.hi, 0, 1.0); seg(g.lo, g.hi, 2.1, h - 2.1); glass(g, along, ax0, az0); }
          else seg(g.lo, g.hi, g.top, h - g.top);
          if (g.door && g.door.type && g.door.type !== 'open') {
            const c = (g.lo + g.hi) / 2; const [dx, dz] = along === 'x' ? W(c, az0) : W(ax0, c);
            const axis = ((along === 'x') !== !!(rot & 1)) ? 'x' : 'z';
            ctx.addDoor({ x: dx, z: dz, y: baseY + 0.06, axis, w: g.w, kind: g.door.type, card: g.door.card, fuse: g.door.fuse, lever: g.door.lever, mon, flip: g.door.flip });
          }
          cur = g.hi;
        }
        seg(cur, end, 0, h);
        void L;
      };
      const glass = (g, along, ax0, az0) => {
        const c = (g.lo + g.hi) / 2; const [gx, gz] = along === 'x' ? W(c, az0) : W(ax0, c);
        const [gw, gd] = Wsize(along === 'x' ? g.w : 0.06, along === 'x' ? 0.06 : g.w);
        M.add(keep, M.box(gw, 1.1, gd), M.mat('#9cc4d4', { transparent: true, opacity: 0.25 }), gx - mon.x, 1.55, gz - mon.z, { cast: false });
      };
      side('n', x0, z0, x1, z0, 'x'); side('s', x0, z1, x1, z1, 'x'); side('w', x0, z0, x0, z1, 'z'); side('e', x1, z0, x1, z1, 'z');
      let roof = null;
      if (!o.noRoof) {
        roof = new THREE.Group(); keep.add(roof);
        const [wx, wz] = W(x, z), [ww, wd] = Wsize(w + t + 0.3, d + t + 0.3);
        M.add(roof, M.box(ww, 0.3, wd, 3), M.surf(o.roof ?? 'concrete_dark', { cut: true }), wx - mon.x, h + 0.15, wz - mon.z);
        // parapet trim so roofs read from above
        const tr = M.surf(o.trim ?? o.roof ?? 'concrete_dark', { cut: true });
        M.add(roof, M.box(ww, 0.35, 0.25), tr, wx - mon.x, h + 0.45, wz - mon.z - wd / 2 + 0.12);
        M.add(roof, M.box(ww, 0.35, 0.25), tr, wx - mon.x, h + 0.45, wz - mon.z + wd / 2 - 0.12);
        M.add(roof, M.box(0.25, 0.35, wd), tr, wx - mon.x - ww / 2 + 0.12, h + 0.45, wz - mon.z);
        M.add(roof, M.box(0.25, 0.35, wd), tr, wx - mon.x + ww / 2 - 0.12, h + 0.45, wz - mon.z);
        if (o.roofProps !== false && w * d > 30) { // a vent or AC unit on bigger roofs
          M.add(roof, M.box(1.2, 0.7, 0.9), M.surf('metal', { cut: true }), wx - mon.x + (R() - 0.5) * ww * 0.5, h + 0.65, wz - mon.z + (R() - 0.5) * wd * 0.5);
        }
      }
      const [ax, az] = W(x0, z0), [bx, bz] = W(x1, z1);
      const roomRec = ctx.addRoom({ x0: Math.min(ax, bx), z0: Math.min(az, bz), x1: Math.max(ax, bx), z1: Math.max(az, bz), roof, mon, h });
      return { x, z, w, d, x0, x1, z0, z1, h, roof, rec: roomRec, inside: (px, pz) => px > x0 && px < x1 && pz > z0 && pz < z1 };
    },
    /** monument prop from models_world (rq = local yaw in radians; colliders exact for quarter turns) */
    prop(type, x, z, rq = 0, o = {}) {
      const [wx, wz] = W(x, z);
      let obj = null;
      try { obj = Models && Models.makeProp ? Models.makeProp(type, o) : null; } catch (e) { obj = null; }
      const info = (Models && Models.PROP_INFO && Models.PROP_INFO[type]) || { w: 2, d: 2, h: 2, colliders: [[0, 0, 2, 2, 2]] };
      if (!obj) { obj = new THREE.Group(); M.add(obj, M.box(info.w, info.h, info.d), M.surf('metal', { cut: info.h > 1.3 }), 0, info.h / 2, 0); }
      obj.position.set(wx - mon.x, (o.y ?? 0), wz - mon.z); obj.rotation.y = Wry(rq);
      if (type === 'boat' && ctx.heightAt(wx, wz) < -0.2) obj.position.y = -baseY + 0.05 + (o.y ?? 0);
      if ((type === 'dock' || type === 'deck') && ctx.addDeck) {
        const info0 = (Models && Models.PROP_INFO && Models.PROP_INFO[type]) || { w: 6, d: 6 };
        const yaw = rot * Q + rq, ac = Math.abs(Math.cos(yaw)), as = Math.abs(Math.sin(yaw)); const hw = (info0.w * ac + info0.d * as) / 2, hd = (info0.w * as + info0.d * ac) / 2;
        ctx.addDeck({ x0: wx - hw, z0: wz - hd, x1: wx + hw, z1: wz + hd, y: baseY + (o.y ?? 0) + 0.08, mon });
      }
      (o.keep ? keep : statics).add(obj);
      if (o.collide !== false) {
        const yaw = rot * Q + rq; const c = Math.cos(yaw), s = Math.sin(yaw);
        for (const col of (info.colliders || [])) {
          const [ccx, ccz, cw, cd, ch, op] = col;
          const px = wx + ccx * c - ccz * s, pz = wz + ccx * s + ccz * c;
          // AABB of rotated box
          const ac = Math.abs(c), as = Math.abs(s); const hw = (cw * ac + cd * as) / 2, hd = (cw * as + cd * ac) / 2;
          ctx.phys.addBox(px - hw, pz - hd, px + hw, pz + hd, { h: ch ?? info.h, solid: (o.y ?? 0) < 1, opaque: op !== false && (ch ?? info.h) > 1.0, kind: 'prop', y0: baseY + (o.y ?? 0) });
        }
      }
      if (obj.userData && obj.userData.light && o.light !== false) {
        const lv = obj.userData.light.clone(); obj.updateMatrixWorld(true); const p = lv.applyMatrix4(obj.matrix);
        ctx.addLight({ x: p.x + mon.x, y: p.y + baseY, z: p.z + mon.z, color: o.lightColor || '#ffd9a0', intensity: o.lightI ?? 1.2, range: o.lightR ?? 12, mon, night: true });
      }
      return obj;
    },
    container(type, x, z, ry = 0) { const [wx, wz] = W(x, z); return ctx.addContainer({ type, x: wx, z: wz, y: baseY, ry: Wry(ry), mon }); },
    /** NPC spawn. opts: { patrol: [[x,z],...] local, guard, radius, count } */
    npc(kind, x, z, opts = {}) {
      const [wx, wz] = W(x, z);
      const o = Object.assign({}, opts); if (opts.patrol) o.patrol = opts.patrol.map(p => W(p[0], p[1]));
      return ctx.addNpcSpawn({ kind, x: wx, z: wz, y: baseY, mon, opts: o });
    },
    rad(x, z, r, power) { const [wx, wz] = W(x, z); return ctx.addRad({ x: wx, z: wz, r, power, mon }); },
    light(x, z, y = 3, color = '#ffd9a0', intensity = 1.2, range = 12) { const [wx, wz] = W(x, z); return ctx.addLight({ x: wx, y: baseY + y, z: wz, color, intensity, range, mon, night: true }); },
    recycler(x, z, ry = 0) { const o = K.deployModel('recycler', x, z, ry); const [wx, wz] = W(x, z); ctx.phys.addBox(wx - 0.8, wz - 0.8, wx + 0.8, wz + 0.8, { h: 1.8, kind: 'prop' }); return ctx.addUse({ type: 'recycler', x: wx, z: wz, y: baseY, mon, obj: o }); },
    vendor(shop, x, z, ry = 0) { const [wx, wz] = W(x, z); K.prop('counter', x, z, ry); return ctx.addUse({ type: 'vendor', shop, x: wx, z: wz, y: baseY, mon, ry: Wry(ry) }); },
    fusebox(x, z, ry, id) { K.prop('fusebox', x, z, ry, { collide: false, y: 1.0 }); const [wx, wz] = W(x, z); return ctx.addUse({ type: 'fusebox', x: wx, z: wz, y: baseY, mon, id }); },
    lever(x, z, ry, id) { K.prop('lever', x, z, ry, { collide: false }); const [wx, wz] = W(x, z); return ctx.addUse({ type: 'lever', x: wx, z: wz, y: baseY, mon, id }); },
    water(x, z) { const [wx, wz] = W(x, z); return ctx.addUse({ type: 'water', x: wx, z: wz, y: baseY, mon }); },
    node(type, x, z) { const [wx, wz] = W(x, z); return ctx.addNode({ type, x: wx, z: wz, mon }); },
    veg(kind, x, z, s = 1) {
      const [wx, wz] = W(x, z); const geo = ctx.vegGeo ? ctx.vegGeo(kind) : null;
      if (geo) { const m = M.add(statics, geo, M.mat('#ffffff', { vc: true }), wx - mon.x, ctx.heightAt(wx, wz) - baseY, wz - mon.z); m.scale.setScalar(s); m.rotation.y = R() * 6.28; }
      return ctx.addVeg({ kind, x: wx, z: wz, s, mon, noMesh: !!geo });
    },
    anomaly(kind, x, z) { const [wx, wz] = W(x, z); return ctx.addAnomaly({ kind, x: wx, z: wz, mon }); },
    safe(r) { return ctx.addSafe({ x: mon.x, z: mon.z, r, mon }); },
    label(text) { return ctx.addLabel({ text, x: mon.x, z: mon.z, mon }); },
    /** decorative deployable model (furnace, workbench...) with no gameplay */
    deployModel(type, x, z, ry = 0) {
      const [wx, wz] = W(x, z); let obj = null;
      try { obj = Models && Models.makeDeployable ? Models.makeDeployable(type) : null; } catch (e) { obj = null; }
      if (!obj) { obj = new THREE.Group(); M.add(obj, M.box(1, 1, 1), M.surf('metal'), 0, 0.5, 0); }
      obj.position.set(wx - mon.x, 0, wz - mon.z); obj.rotation.y = Wry(ry); keep.add(obj); return obj;
    },
    /** a ready-made game object (casino tables, duck track…) from ctx.makeObject(kind) -> Group or { root }. o: w,d,h collider box, y */
    object(kind, x, z, ry = 0, o = {}) {
      const [wx, wz] = W(x, z); let made = null; try { made = ctx.makeObject ? ctx.makeObject(kind) : null; } catch (e) { made = null; }
      let obj = made && made.root ? made.root : made;
      if (!obj) { obj = new THREE.Group(); M.add(obj, M.box(o.w || 1, o.h || 1, o.d || 1), M.surf('plank_dark'), 0, (o.h || 1) / 2, 0); }
      obj.position.set(wx - mon.x, o.y || 0, wz - mon.z); obj.rotation.y = Wry(ry); keep.add(obj);
      const tick = (made && made.tick) || (obj.userData && obj.userData.tick); if (tick && ctx.addTick) ctx.addTick({ x: wx, z: wz, fn: tick });
      // extra colliders in the object's own frame: [cx, cz, w, d, h]
      for (const [cx, cz, w, d, h] of o.cols || []) { const c = Math.cos(ry), s = Math.sin(ry); const lx = x + cx * c - cz * s, lz = z + cx * s + cz * c; const [px, pz] = W(lx, lz); const odd = Math.round(ry / Q) & 1; const [cw, cd] = Wsize(odd ? d : w, odd ? w : d); ctx.phys.addBox(px - cw / 2, pz - cd / 2, px + cw / 2, pz + cd / 2, { h, y0: baseY, opaque: false }); }
      if (o.w && o.collide !== false) { const odd = Math.round(ry / Q) & 1; const [cw, cd] = Wsize(odd ? o.d : o.w, odd ? o.w : o.d); ctx.phys.addBox(wx - cw / 2, wz - cd / 2, wx + cw / 2, wz + cd / 2, { h: o.h || 1, y0: baseY, opaque: false }); }
      return made || obj;
    },
    /** a generic interaction point (casino games etc.) */
    use(type, x, z, extra = {}) { const [wx, wz] = W(x, z); return ctx.addUse(Object.assign({ type, x: wx, z: wz, y: baseY, mon }, extra)); },
    /** outlaw forts: real destructible building pieces on the global 3 m grid (ci,cj local cell offsets) */
    /**
     * Outlaw forts only (forts are never rotated): a real destructible building piece on the global 3 m grid.
     * ci, cj = cell offsets from the monument's anchor cell (the cell containing the monument centre).
     * type: foundation | wall | doorway | window | lowwall | ceiling | highwall_wood | highwall_stone ; edge: 'h' (top edge of the cell) | 'v' (left edge) for edge pieces.
     * door: optional door kind for doorways ('door_wood' | 'door_metal' | 'door_armored').
     */
    piece(type, tier, ci, cj, edge, door) { return ctx.addPiece({ type, tier, ci, cj, edge, door, mon }); },
    /** anchor cell origin in LOCAL coordinates (forts): local x of cell ci = K.cellX(ci) .. +3 */
    cellX(ci) { return Math.floor(mon.x / 3) * 3 + ci * 3 - mon.x; },
    cellZ(cj) { return Math.floor(mon.z / 3) * 3 + cj * 3 - mon.z; },
    deploy(type, x, z, ry = 0) { const [wx, wz] = W(x, z); return ctx.addDeploy({ type, x: wx, z: wz, ry: Wry(ry), mon }); },
  };
  layout(K);
  // merge statics
  // meshes flagged keep (animated parts of props) must survive the merge
  const keepers = []; statics.traverse(o => { if (o.isMesh && o.userData.keep) keepers.push(o); });
  for (const o of keepers) keep.attach(o);
  // first person: roofs never hide and props never animate, so props, roofs and
  // deco models merge with the shell too — one mesh per material per monument
  const merged = []; keep.traverse(o => { if (o.isMesh && !o.userData.keep) merged.push(o); });
  for (const o of merged) statics.attach(o);
  const baked = M.bake(statics);
  group.remove(statics); group.add(baked);
  group.position.set(mon.x, baseY, mon.z);
  return group;
}

/** Stub context for dev pages (no game). Collects everything into arrays. */
export function makeStubCtx(phys, heightAt = () => 0) {
  const out = { containers: [], npcs: [], rads: [], lights: [], doors: [], rooms: [], uses: [], nodes: [], veg: [], anomalies: [], safes: [], labels: [], pieces: [], deploys: [] };
  return {
    out, phys, heightAt,
    addContainer: o => (out.containers.push(o), o), addNpcSpawn: o => (out.npcs.push(o), o), addRad: o => (out.rads.push(o), o), addLight: o => (out.lights.push(o), o),
    addDoor: o => (out.doors.push(o), o), addRoom: o => (out.rooms.push(o), o), addUse: o => (out.uses.push(o), o), addNode: o => (out.nodes.push(o), o),
    addVeg: o => (out.veg.push(o), o), addAnomaly: o => (out.anomalies.push(o), o), addSafe: o => (out.safes.push(o), o), addLabel: o => (out.labels.push(o), o),
    addPiece: o => (out.pieces.push(o), o), addDeploy: o => (out.deploys.push(o), o),
  };
}

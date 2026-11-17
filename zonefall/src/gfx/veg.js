// ============================================================================
// ZONEFALL 3 — chunked instanced vegetation. One InstancedMesh per
// (chunk, kind, part). Individual plants can be hidden / shrunk / shaken.
// ============================================================================
import { THREE, M } from './materials.js';
import { NCH, CHUNK } from '../world/gen.js';

let Models = null;
export function setVegModels(m) { Models = m; }

const geoCache = {};
function geoms(kind) {
  if (geoCache[kind]) return geoCache[kind];
  let g = null;
  try { g = Models && Models.vegGeometry ? Models.vegGeometry(kind) : null; } catch (e) { console.warn('vegGeometry failed', kind, e); g = null; }
  if (!g || (!g.solid && !g.cut)) g = fallback(kind);
  return (geoCache[kind] = g);
}
function colored(geo, hex) { const g = geo.toNonIndexed ? (geo.index ? geo.toNonIndexed() : geo.clone()) : geo; const c = new THREE.Color(hex); const n = g.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g; }
function fallback(kind) {
  const trunk = h => colored(new THREE.CylinderGeometry(0.18, 0.28, h, 6).translate(0, h / 2, 0), '#5a4030');
  switch (kind) {
    case 'pine': case 'pine_snow': return { solid: trunk(2.5), cut: colored(new THREE.ConeGeometry(1.8, 6.5, 7).translate(0, 5, 0), kind === 'pine' ? '#2f5a3a' : '#cfd8dc') };
    case 'oak': case 'birch': case 'palm': return { solid: trunk(3), cut: colored(new THREE.IcosahedronGeometry(2.4, 0).translate(0, 4.6, 0), '#4f7a34') };
    case 'dead': return { solid: trunk(4), cut: null };
    case 'cactus': return { solid: colored(new THREE.CylinderGeometry(0.3, 0.35, 2.4, 6).translate(0, 1.2, 0), '#5a7a3a'), cut: null };
    case 'boulder': return { solid: colored(new THREE.IcosahedronGeometry(1.6, 0).scale(1, 0.7, 1).translate(0, 0.6, 0), '#8a877f'), cut: null };
    case 'rock_small': return { solid: colored(new THREE.IcosahedronGeometry(0.4, 0).translate(0, 0.15, 0), '#8a877f'), cut: null };
    case 'grass': return { solid: colored(new THREE.ConeGeometry(0.25, 0.5, 4).translate(0, 0.25, 0), '#6b8a3e'), cut: null };
    case 'hemp': return { solid: colored(new THREE.ConeGeometry(0.35, 1.1, 5).translate(0, 0.55, 0), '#7a9a3a'), cut: null };
    case 'berry_bush': return { solid: colored(new THREE.IcosahedronGeometry(0.6, 0).translate(0, 0.5, 0), '#4a6a2a'), cut: null };
    case 'mushroom': return { solid: colored(new THREE.ConeGeometry(0.18, 0.25, 6).translate(0, 0.2, 0), '#c8a070'), cut: null };
    case 'stump': return { solid: trunk(0.5), cut: null };
    case 'log_fallen': return { solid: colored(new THREE.CylinderGeometry(0.3, 0.3, 3.5, 6).rotateZ(Math.PI / 2).translate(0, 0.3, 0), '#6a4a30'), cut: null };
    default: return { solid: colored(new THREE.IcosahedronGeometry(0.7, 0).translate(0, 0.5, 0), '#4f6a2e'), cut: null };
  }
}
export function vegOneGeo(kind) { return oneGeo(kind, geoms(kind)); }
const oneCache = {};
function oneGeo(kind, g) {
  if (oneCache[kind]) return oneCache[kind];
  const list = [g.solid, g.cut].filter(Boolean).map(x => {
    let q = x.index ? x.toNonIndexed() : x.clone();
    for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'color'].includes(k)) q.deleteAttribute(k);
    if (!q.attributes.normal) q.computeVertexNormals();
    if (!q.attributes.color) q.setAttribute('color', new THREE.BufferAttribute(new Float32Array(q.attributes.position.count * 3).fill(1), 3));
    // comic palette: brighter, juicier foliage
    const c = q.attributes.color;
    for (let i = 0; i < c.count; i++) {
      let r = c.getX(i), g = c.getY(i), b = c.getZ(i); const l = r * 0.3 + g * 0.55 + b * 0.15;
      r = l + (r - l) * 1.3; g = l + (g - l) * 1.3; b = l + (b - l) * 1.3;
      c.setXYZ(i, Math.min(1, r * 1.3 + 0.015), Math.min(1, g * 1.3 + 0.015), Math.min(1, b * 1.22 + 0.015));
    }
    return q;
  });
  let out = list.length === 1 ? list[0] : null;
  if (!out) { try { out = M.mergeGeometries(list, false); } catch (e) { out = null; } }
  return (oneCache[kind] = out || list[0]);
}
export const VEG_R = { pine: 0.35, pine_snow: 0.35, oak: 0.42, birch: 0.3, dead: 0.3, palm: 0.3, cactus: 0.35, boulder: 1.5, log_fallen: 0, stump: 0.3 };
export function vegRadius(kind) { const info = Models && Models.VEG_INFO && Models.VEG_INFO[kind]; return info ? info.r : (VEG_R[kind] || 0); }
export const TREE_KINDS = new Set(['pine', 'pine_snow', 'oak', 'birch', 'dead', 'palm', 'cactus']);
const BIG = new Set(['pine', 'pine_snow', 'oak', 'birch', 'dead', 'palm', 'boulder', 'cactus']);
const SMALL = new Set(['grass', 'mushroom', 'rock_small', 'fern']);

const dummy = new THREE.Object3D();

export class VegLayer {
  constructor(W, opts = {}) {
    this.W = W; this.noTufts = !!opts.noTufts; this.group = new THREE.Group(); this.group.name = 'veg';
    this.slots = new Map(); // veg id -> {mesh(es), index}
    this.lod = [];
    this.matS = M.mat('#ffffff', { vc: true });
    this.matC = M.mat('#ffffff', { vc: true, cut: true });
    // bucket plants: big trees/boulders in 2x2-chunk blocks (fewer draw calls,
    // they are seen from far), everything else per chunk
    const buckets = new Map();
    for (let c = 0; c < NCH * NCH; c++) {
      const ci = c % NCH, cj = Math.floor(c / NCH);
      for (const v of this.W.vegChunks[c]) {
        if (this.noTufts && (v.kind === 'grass' || v.kind === 'fern')) continue; // the eye-level grass field replaces the old tufts
        const cls = BIG.has(v.kind) ? 2 : SMALL.has(v.kind) ? 0 : 1;
        const key = cls === 2 ? `2:${ci >> 1},${cj >> 1}:${v.kind}` : `${cls}:${ci},${cj}:${v.kind}`;
        let b = buckets.get(key);
        if (!b) {
          const sz = cls === 2 ? CHUNK * 2 : CHUNK, bi = cls === 2 ? ci >> 1 : ci, bj = cls === 2 ? cj >> 1 : cj;
          b = { kind: v.kind, cls, list: [], cx: (bi + 0.5) * sz, cz: (bj + 0.5) * sz, half: sz * 0.71 }; buckets.set(key, b);
        }
        b.list.push(v);
      }
    }
    for (const b of buckets.values()) this.buildBucket(b);
  }
  buildBucket(b) {
    const { kind, list: arr, cls } = b; const g = geoms(kind);
    // trunk + crown share one (vertex-coloured) material: one instanced mesh per plant kind
    const parts = [new THREE.InstancedMesh(oneGeo(kind, g), this.matS, arr.length)];
    arr.forEach((v, i) => {
      this.setMatrix(v, 1);
      for (const p of parts) p.setMatrixAt(i, dummy.matrix);
      this.slots.set(v.id, { parts, i, v });
    });
    for (const p of parts) { p.castShadow = cls > 0; p.receiveShadow = true; p.instanceMatrix.needsUpdate = true; p.computeBoundingSphere(); this.group.add(p); this.lod.push({ m: p, cx: b.cx, cz: b.cz, half: b.half, cls }); }
  }
  setMatrix(v, s) {
    dummy.position.set(v.x, v.y - 0.05, v.z); dummy.rotation.set(v.tilt || 0, v.ry, 0);
    const sc = v.s * s; dummy.scale.set(sc, sc, sc); dummy.updateMatrix();
  }
  /** show only chunks near the camera: trees far, bushes mid, grass tufts close */
  updateLOD(x, z, fogFar = 230, k = 1) {
    // chunk centre -> corner is ~45 m; trees fade into the fog, bushes and tufts only close up
    const R = [36 * k, 75 * k, Math.min(fogFar + 15, 210 * k)];
    for (const L of this.lod) { const r = R[L.cls] + L.half; L.m.visible = (L.cx - x) ** 2 + (L.cz - z) ** 2 < r * r; }
  }
  /** scale 0 = hidden. shake = small lean */
  set(id, s = 1, lean = 0) {
    const slot = this.slots.get(id); if (!slot) return;
    slot.v.tilt = lean; this.setMatrix(slot.v, s);
    for (const p of slot.parts) { p.setMatrixAt(slot.i, dummy.matrix); p.instanceMatrix.needsUpdate = true; }
  }
}

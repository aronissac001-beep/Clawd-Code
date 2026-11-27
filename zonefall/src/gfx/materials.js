// ============================================================================
// ZONEFALL 3 — shared materials, procedural textures and geometry helpers.
// Every model module builds from these so the whole game shares one look,
// one set of GPU materials and one "see-through-near-the-player" shader patch.
// Units are metres. Y is up. Models face +X at rotation.y = 0.
// ============================================================================
import * as THREE from '../../lib/three.module.min.js';
import { mergeGeometries } from '../../lib/BufferGeometryUtils.js';

export { THREE };

// ---------------------------------------------------------------- toon lighting
// Cel-shaded comic look: every Lambert material lights in hard bands (lit /
// half-lit / shadow) instead of a smooth falloff. Patched into the shared
// shader chunk, so models, characters and terrain all pick it up.
THREE.ShaderChunk.lights_lambert_pars_fragment = THREE.ShaderChunk.lights_lambert_pars_fragment.replace(
  'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
  `float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	dotNL = 0.42 * smoothstep( 0.0, 0.05, dotNL ) + 0.58 * smoothstep( 0.32, 0.38, dotNL );`);

// ---------------------------------------------------------------- colours
// Muted, slightly warm survival palette. Prefer these names in models.
export const PAL = {
  ink: '#1c1a22', black: '#121014', white: '#f2efe6', bone: '#e2d8c0',
  // woods
  plank: '#a27748', plankDark: '#6e4c2e', log: '#7a5534', bark: '#4f3a28', twig: '#b08a58',
  // stone / concrete
  stone: '#8d8c88', stoneDark: '#5e5d5a', concrete: '#a9a69e', concreteDark: '#76736c', asphalt: '#3b3b3e',
  // metals
  steel: '#8a9099', steelDark: '#555b63', rust: '#9a5634', rustDark: '#5e3423', armor: '#3d4148', brass: '#c49a45', gun: '#2f3034', gunLight: '#4a4c52',
  // cloth / colours
  cloth: '#c9b48f', leather: '#7a5233', olive: '#5d6b3c', oliveDark: '#3f4a2a', khaki: '#9c8d62', navy: '#2f3d5a', denim: '#4a5f82',
  red: '#b8402f', orange: '#d27a35', yellow: '#e0b83a', hazard: '#e2b33a', green: '#4f8a43', blue: '#3a6ea8', teal: '#3f8f8a',
  // nature
  grass: '#6b8a3e', grassDark: '#4d6a2d', leaf: '#4f7a34', leafDark: '#355a26', pine: '#2f5a3a', pineDark: '#22442c', sand: '#d8c38f', dirt: '#7d6446', snow: '#e8eef2',
  // skin tones
  skin1: '#e6bc98', skin2: '#c69472', skin3: '#9c6b4c', skin4: '#6e4a34',
};

// ---------------------------------------------------------------- textures
const texCache = {};
function canvas(n) { const c = document.createElement('canvas'); c.width = c.height = n; return [c, c.getContext('2d', { willReadFrequently: true })]; } // painted on the CPU: inkify reads it back
function rng(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function speckle(g, n, R, count, a0, a1, light) {
  for (let i = 0; i < count; i++) {
    const x = R() * n, y = R() * n, s = 1 + R() * 2.2;
    g.fillStyle = light ? `rgba(255,255,255,${a0 + R() * (a1 - a0)})` : `rgba(0,0,0,${a0 + R() * (a1 - a0)})`;
    g.fillRect(x, y, s, s);
  }
}
function blotches(g, n, R, count, rgba) {
  for (let i = 0; i < count; i++) {
    const x = R() * n, y = R() * n, r = 6 + R() * n * 0.18;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, rgba); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    // wrap for tiling
    for (const [ox, oy] of [[n, 0], [-n, 0], [0, n], [0, -n]]) { g.save(); g.translate(ox, oy); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); g.restore(); }
  }
}

// Texture painters: all draw light-grey-ish detail meant to be MULTIPLIED by
// the material colour, so one texture serves many tints.
const PAINT = {
  noise(g, n, R) { g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, n, n); speckle(g, n, R, 900, 0.03, 0.09); speckle(g, n, R, 300, 0.03, 0.08, true); blotches(g, n, R, 8, 'rgba(0,0,0,0.06)'); },
  concrete(g, n, R) {
    g.fillStyle = '#dadada'; g.fillRect(0, 0, n, n); blotches(g, n, R, 14, 'rgba(0,0,0,0.07)'); blotches(g, n, R, 6, 'rgba(255,255,255,0.08)');
    speckle(g, n, R, 1400, 0.04, 0.12); g.strokeStyle = 'rgba(0,0,0,0.10)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, n / 2); g.lineTo(n, n / 2); g.moveTo(n / 2, 0); g.lineTo(n / 2, n); g.stroke();
    // stains running down
    for (let i = 0; i < 5; i++) { const x = R() * n; const gr = g.createLinearGradient(0, 0, 0, n * 0.6); gr.addColorStop(0, 'rgba(60,50,40,0.12)'); gr.addColorStop(1, 'rgba(60,50,40,0)'); g.fillStyle = gr; g.fillRect(x, 0, 2 + R() * 5, n * 0.6); }
  },
  asphalt(g, n, R) { g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, n, n); speckle(g, n, R, 2600, 0.05, 0.16); speckle(g, n, R, 700, 0.06, 0.14, true); blotches(g, n, R, 6, 'rgba(0,0,0,0.08)'); g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 1; for (let i = 0; i < 3; i++) { g.beginPath(); let x = R() * n, y = R() * n; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (R() - 0.5) * 30; y += (R() - 0.5) * 30; g.lineTo(x, y); } g.stroke(); } },
  plank(g, n, R) {
    g.fillStyle = '#e2e2e2'; g.fillRect(0, 0, n, n); const rows = 8, h = n / rows;
    for (let r = 0; r < rows; r++) {
      const v = 0.85 + R() * 0.25; g.fillStyle = `rgba(${200 * v | 0},${200 * v | 0},${200 * v | 0},0.35)`; g.fillRect(0, r * h, n, h);
      for (let k = 0; k < 18; k++) { g.fillStyle = `rgba(0,0,0,${0.03 + R() * 0.05})`; g.fillRect(0, r * h + R() * h, n, 1); }
      g.fillStyle = 'rgba(0,0,0,0.38)'; g.fillRect(0, r * h + h - 2, n, 2); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, r * h, n, 1);
      const cut = R() * n; g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(cut, r * h, 2, h);
      g.fillStyle = 'rgba(30,30,30,0.6)'; g.fillRect((cut + 5) % n, r * h + h * 0.3, 2, 2); g.fillRect((cut + 5) % n, r * h + h * 0.65, 2, 2);
      if (R() < 0.4) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.ellipse(R() * n, r * h + h / 2, 3, 2, 0, 0, 7); g.fill(); }
    }
  },
  log(g, n, R) { g.fillStyle = '#dcdcdc'; g.fillRect(0, 0, n, n); const cols = 6, w = n / cols; for (let c = 0; c < cols; c++) { const gr = g.createLinearGradient(c * w, 0, c * w + w, 0); gr.addColorStop(0, 'rgba(0,0,0,0.35)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.10)'); gr.addColorStop(1, 'rgba(0,0,0,0.35)'); g.fillStyle = gr; g.fillRect(c * w, 0, w, n); for (let k = 0; k < 30; k++) { g.fillStyle = `rgba(0,0,0,${0.05 + R() * 0.08})`; g.fillRect(c * w + R() * w, R() * n, 1, 4 + R() * 14); } } },
  bark(g, n, R) { g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, n, n); for (let k = 0; k < 160; k++) { g.fillStyle = `rgba(0,0,0,${0.08 + R() * 0.16})`; g.fillRect(R() * n, R() * n, 1 + R() * 2, 6 + R() * 24); } speckle(g, n, R, 300, 0.05, 0.1, true); },
  stoneblock(g, n, R) {
    g.fillStyle = '#d4d4d4'; g.fillRect(0, 0, n, n); const rows = 4, h = n / rows;
    for (let r = 0; r < rows; r++) {
      let x = r % 2 ? -n / 6 : 0;
      while (x < n) {
        const w = n / 3 * (0.7 + R() * 0.6), v = 0.82 + R() * 0.3;
        g.fillStyle = `rgba(${215 * v | 0},${215 * v | 0},${210 * v | 0},1)`; g.fillRect(x + 2, r * h + 2, w - 4, h - 4);
        g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(x + 2, r * h + 2, w - 4, 2); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x + 2, r * h + h - 4, w - 4, 2);
        x += w;
      }
    }
    g.globalCompositeOperation = 'multiply'; speckle(g, n, R, 900, 0.04, 0.1); g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgba(40,40,40,0.0)';
  },
  brick(g, n, R) { g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, n, n); const rows = 10, h = n / rows; for (let r = 0; r < rows; r++) { const off = r % 2 ? n / 8 : 0; for (let x = -off; x < n; x += n / 4) { const v = 0.85 + R() * 0.25; g.fillStyle = `rgb(${225 * v | 0},${215 * v | 0},${205 * v | 0})`; g.fillRect(x + 1.5, r * h + 1.5, n / 4 - 3, h - 3); } } speckle(g, n, R, 600, 0.04, 0.1); },
  metal(g, n, R) {
    g.fillStyle = '#d6d6d6'; g.fillRect(0, 0, n, n); blotches(g, n, R, 10, 'rgba(120,60,20,0.16)'); speckle(g, n, R, 700, 0.03, 0.08);
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 2; g.strokeRect(1, 1, n - 2, n - 2); g.beginPath(); g.moveTo(0, n / 2); g.lineTo(n, n / 2); g.stroke();
    g.fillStyle = 'rgba(40,40,40,0.55)'; for (let i = 6; i < n; i += 16) { g.fillRect(i, 5, 3, 3); g.fillRect(i, n - 8, 3, 3); g.fillRect(i, n / 2 - 5, 3, 3); g.fillRect(i, n / 2 + 3, 3, 3); }
    for (let i = 0; i < 4; i++) { const x = R() * n, gr = g.createLinearGradient(0, 0, 0, n * 0.4); gr.addColorStop(0, 'rgba(130,60,20,0.35)'); gr.addColorStop(1, 'rgba(130,60,20,0)'); g.fillStyle = gr; g.fillRect(x, n / 2, 3 + R() * 4, n * 0.4); }
  },
  corrugated(g, n, R) { g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, n, n); const k = 16; for (let i = 0; i < k; i++) { const gr = g.createLinearGradient(i * n / k, 0, (i + 1) * n / k, 0); gr.addColorStop(0, 'rgba(0,0,0,0.28)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0.28)'); g.fillStyle = gr; g.fillRect(i * n / k, 0, n / k, n); } blotches(g, n, R, 9, 'rgba(120,55,20,0.22)'); speckle(g, n, R, 500, 0.03, 0.08); },
  armor(g, n, R) { g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, n, n); for (const [x, y, w, h] of [[0, 0, n / 2, n / 2], [n / 2, 0, n / 2, n / 2], [0, n / 2, n / 2, n / 2], [n / 2, n / 2, n / 2, n / 2]]) { g.fillStyle = `rgba(255,255,255,${0.05 + R() * 0.08})`; g.fillRect(x + 3, y + 3, w - 6, h - 6); g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3); g.fillStyle = 'rgba(20,20,20,0.6)'; for (const [a, b] of [[8, 8], [w - 12, 8], [8, h - 12], [w - 12, h - 12]]) g.fillRect(x + a, y + b, 4, 4); } speckle(g, n, R, 500, 0.04, 0.1); },
  tile(g, n, R) { g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, n, n); const k = 4; for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) { const v = 0.9 + R() * 0.12; g.fillStyle = `rgb(${235 * v | 0},${235 * v | 0},${230 * v | 0})`; g.fillRect(i * n / k + 1, j * n / k + 1, n / k - 2, n / k - 2); } blotches(g, n, R, 6, 'rgba(0,0,0,0.08)'); },
  hazard(g, n) { g.fillStyle = '#e8c040'; g.fillRect(0, 0, n, n); g.fillStyle = '#222'; for (let i = -n; i < n * 2; i += n / 4) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + n / 8, 0); g.lineTo(i + n / 8 - n, n); g.lineTo(i - n, n); g.closePath(); g.fill(); } },
  grass(g, n, R) { g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, n, n); blotches(g, n, R, 18, 'rgba(0,0,0,0.07)'); blotches(g, n, R, 10, 'rgba(255,255,230,0.08)'); for (let i = 0; i < 1600; i++) { const x = R() * n, y = R() * n; g.fillStyle = R() < 0.5 ? `rgba(0,0,0,${0.05 + R() * 0.12})` : `rgba(255,255,220,${0.04 + R() * 0.1})`; g.fillRect(x, y, 1, 2 + R() * 3); } },
  dirt(g, n, R) { g.fillStyle = '#d6d6d6'; g.fillRect(0, 0, n, n); blotches(g, n, R, 16, 'rgba(0,0,0,0.09)'); speckle(g, n, R, 1600, 0.05, 0.14); speckle(g, n, R, 300, 0.06, 0.14, true); for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${0.12 + R() * 0.1})`; g.beginPath(); g.ellipse(R() * n, R() * n, 1 + R() * 3, 1 + R() * 2, R() * 3, 0, 7); g.fill(); } },
  sand(g, n, R) { g.fillStyle = '#dedede'; g.fillRect(0, 0, n, n); speckle(g, n, R, 2400, 0.03, 0.08); speckle(g, n, R, 900, 0.04, 0.1, true); for (let y = 0; y < n; y += 9) { g.strokeStyle = 'rgba(0,0,0,0.05)'; g.beginPath(); for (let x = 0; x <= n; x += 8) g.lineTo(x, y + Math.sin(x * 0.12 + y) * 2.5); g.stroke(); } },
  gravel(g, n, R) { g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, n, n); for (let i = 0; i < 900; i++) { const v = 150 + R() * 100 | 0; g.fillStyle = `rgb(${v},${v},${v - 6})`; g.beginPath(); g.ellipse(R() * n, R() * n, 1 + R() * 2.5, 1 + R() * 2, R() * 3, 0, 7); g.fill(); } },
  snow(g, n, R) { g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, n, n); blotches(g, n, R, 12, 'rgba(120,140,170,0.07)'); speckle(g, n, R, 600, 0.02, 0.05); speckle(g, n, R, 400, 0.08, 0.2, true); },
  rock(g, n, R) { g.fillStyle = '#d2d2d2'; g.fillRect(0, 0, n, n); blotches(g, n, R, 14, 'rgba(0,0,0,0.12)'); speckle(g, n, R, 1400, 0.04, 0.12); g.strokeStyle = 'rgba(0,0,0,0.2)'; for (let i = 0; i < 8; i++) { g.beginPath(); let x = R() * n, y = R() * n; g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (R() - 0.5) * 40; y += R() * 20; g.lineTo(x, y); } g.stroke(); } },
  cloth(g, n, R) { g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, n, n); for (let i = 0; i < n; i += 2) { g.fillStyle = `rgba(0,0,0,${0.03 + R() * 0.04})`; g.fillRect(i, 0, 1, n); g.fillRect(0, i, n, 1); } blotches(g, n, R, 6, 'rgba(0,0,0,0.08)'); },
  terrain(g, n, R) { g.fillStyle = '#e2e2e2'; g.fillRect(0, 0, n, n); blotches(g, n, R, 16, 'rgba(0,0,0,0.06)'); blotches(g, n, R, 8, 'rgba(255,255,240,0.07)'); speckle(g, n, R, 500, 0.02, 0.06); },
  water(g, n, R) { g.fillStyle = '#cfd8dc'; g.fillRect(0, 0, n, n); for (let i = 0; i < 90; i++) { g.strokeStyle = `rgba(255,255,255,${0.08 + R() * 0.16})`; g.lineWidth = 1; const x = R() * n, y = R() * n, w = 6 + R() * 16; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + w / 2, y - 2, x + w, y); g.stroke(); } },
};

// Comic finish for every painted texture: flatten the fine noise into a few
// painted tones, then add hand-drawn ink hatching and the odd scratch line.
function inkify(g, n, R, name) {
  const img = g.getImageData(0, 0, n, n), d = img.data;
  const steps = 6;
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) { const v = d[i + k] / 255; d[i + k] = Math.round(Math.round(v * steps) / steps * 255); }
  g.putImageData(img, 0, 0);
  const soft = name === 'grass' || name === 'snow' || name === 'sand' || name === 'terrain';
  g.lineCap = 'round';
  const clusters = Math.round(n / (soft ? 40 : 22));
  for (let c = 0; c < clusters; c++) {
    const x = 6 + R() * (n - 12), y = 6 + R() * (n - 12), len = n * (0.05 + R() * 0.06), k = 3 + (R() * 4 | 0);
    const a = R() < 0.5 ? 0.785 : 2.356, dx = Math.cos(a) * len, dy = Math.sin(a) * len, px = -Math.sin(a) * 2.6, py = Math.cos(a) * 2.6;
    g.strokeStyle = `rgba(20,14,16,${soft ? 0.16 : 0.28})`; g.lineWidth = soft ? 1 : 1.3;
    g.beginPath();
    for (let i = 0; i < k; i++) { const ox = px * i, oy = py * i, s = 0.6 + R() * 0.4; g.moveTo(x + ox, y + oy); g.lineTo(x + ox + dx * s, y + oy + dy * s); }
    g.stroke();
  }
  if (!soft) {
    g.strokeStyle = 'rgba(20,14,16,0.35)'; g.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) { g.beginPath(); let x = 8 + R() * (n - 16), y = 8 + R() * (n - 16); g.moveTo(x, y); for (let s = 0; s < 3; s++) { x += (R() - 0.5) * n * 0.12; y += (R() - 0.5) * n * 0.12; g.lineTo(x, y); } g.stroke(); }
  }
}
export function texture(name, size = 128, seed = 7) {
  const key = name + size;
  if (texCache[key]) return texCache[key];
  const [c, g] = canvas(size);
  const R = rng(seed + name.length * 131);
  (PAINT[name] || PAINT.noise)(g, size, R);
  if (name !== 'hazard' && name !== 'water') inkify(g, size, R, name);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  return (texCache[key] = t);
}

// ---------------------------------------------------------------- see-through patch
// Fragments that sit between the camera and the player (inside a cylinder
// around that line) are dithered away, so walls, roofs, foliage and props
// never hide the player. Applied to any material created with { cut: true }.
export const CUT = {
  uPlayer: { value: new THREE.Vector3(0, -999, 0) },
  uCam: { value: new THREE.Vector3(0, 30, 20) },
  uCutR: { value: 1.9 },
};
function patchCut(mat) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uPlayer = CUT.uPlayer; sh.uniforms.uCam = CUT.uCam; sh.uniforms.uCutR = CUT.uCutR;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n{ vec4 cw = vec4( transformed, 1.0 );\n#ifdef USE_INSTANCING\ncw = instanceMatrix * cw;\n#endif\nvCutW = (modelMatrix * cw).xyz; }');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutW; uniform vec3 uPlayer; uniform vec3 uCam; uniform float uCutR;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      {
        vec3 d = uPlayer - uCam; float dd = dot(d, d);
        float t = dot(vCutW - uCam, d) / dd;
        if (uCutR > 0.05 && t > 0.0 && t < 0.985 && vCutW.y > 0.35) {
          vec3 cp = uCam + d * t; float r = length(vCutW - cp);
          float k = smoothstep(uCutR, uCutR * 0.55, r);
          vec2 q = floor(gl_FragCoord.xy * 0.5);
          float dith = fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453);
          if (k * 0.92 > dith) discard;
        }
      }`);
  };
  mat.customProgramCacheKey = () => 'cut';
}

// ---------------------------------------------------------------- materials
const matCache = {};
/**
 * Lambert material, cached.
 *   M.mat(colorHex, { tex: 'plank', rough, emissive: '#hex', emissiveIntensity, cut: true,
 *                     transparent, opacity, side: 'double', flat: true, vc: true })
 */
function mat(col = '#ffffff', o = {}) {
  if (o.cut) { o = Object.assign({}, o); delete o.cut; } // first person: no see-through cut-outs, so share the plain material
  const key = col + '|' + JSON.stringify(o);
  if (matCache[key]) return matCache[key];
  const m = new THREE.MeshLambertMaterial({ color: new THREE.Color(col) });
  if (o.tex) m.map = texture(o.tex, o.texSize || 128);
  if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.emissiveIntensity ?? 1; }
  if (o.transparent) { m.transparent = true; m.opacity = o.opacity ?? 0.6; m.depthWrite = o.depthWrite ?? false; }
  if (o.side === 'double') m.side = THREE.DoubleSide;
  if (o.flat) m.flatShading = true;
  if (o.vc) m.vertexColors = true;
  if (o.cut) patchCut(m);
  return (matCache[key] = m);
}
/** Unlit material (glows, flames, screens, lamps). */
function basic(col, o = {}) {
  const key = 'B' + col + '|' + JSON.stringify(o);
  if (matCache[key]) return matCache[key];
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(col) });
  if (o.transparent) { m.transparent = true; m.opacity = o.opacity ?? 0.7; m.depthWrite = false; }
  if (o.additive) { m.blending = THREE.AdditiveBlending; m.transparent = true; m.depthWrite = false; }
  if (o.side === 'double') m.side = THREE.DoubleSide;
  if (o.vc) m.vertexColors = true;
  return (matCache[key] = m);
}

// Named surface materials used by building pieces, monuments and props.
// `cut` variants are used for anything tall enough to hide the player.
const SURF = {
  concrete: [PAL.concrete, 'concrete'], concrete_dark: [PAL.concreteDark, 'concrete'], asphalt: [PAL.asphalt, 'asphalt'],
  plank: [PAL.plank, 'plank'], plank_dark: [PAL.plankDark, 'plank'], log: [PAL.log, 'log'], bark: [PAL.bark, 'bark'], twig: [PAL.twig, 'log'],
  stone: [PAL.stone, 'stoneblock'], stone_dark: [PAL.stoneDark, 'stoneblock'], brick: ['#a0523c', 'brick'], rock: ['#8a877f', 'rock'],
  metal: [PAL.steel, 'metal'], metal_dark: [PAL.steelDark, 'metal'], rust: [PAL.rust, 'metal'], armor: [PAL.armor, 'armor'],
  corrugated: ['#8e959b', 'corrugated'], corrugated_red: ['#9a4a36', 'corrugated'], corrugated_blue: ['#4a6a8e', 'corrugated'], corrugated_green: ['#5a7048', 'corrugated'], corrugated_rust: ['#8a5838', 'corrugated'],
  tile: ['#c8c4b8', 'tile'], tile_dark: ['#7a7a74', 'tile'], hazard: ['#ffffff', 'hazard'], cloth: [PAL.cloth, 'cloth'], tarp_green: ['#56683e', 'cloth'], tarp_blue: ['#3e5a7a', 'cloth'],
  dirt: [PAL.dirt, 'dirt'], sand: [PAL.sand, 'sand'], gravel: ['#8e8a80', 'gravel'], grass: [PAL.grass, 'grass'], snow: [PAL.snow, 'snow'],
  glass: ['#7aa6b8', null], glass_dark: ['#2e3e48', null], white_paint: ['#d8d4c8', 'concrete'], yellow_paint: ['#d0a838', 'metal'], red_paint: ['#a8402e', 'metal'], blue_paint: ['#3a5f8f', 'metal'], green_paint: ['#4f6e3e', 'metal'],
};
/** Named surface material: M.surf('concrete', { cut: true }) */
function surf(name, o = {}) {
  const s = SURF[name] || [name.startsWith('#') ? name : '#ff00ff', null];
  return mat(s[0], Object.assign(s[1] ? { tex: s[1] } : {}, o));
}

// ---------------------------------------------------------------- geometry
const geoCache = {};
/**
 * Box geometry whose UVs are in world metres / texScale, so textures keep the
 * same scale regardless of box size. Origin at the box centre.
 */
function box(w, h, d, texScale = 2) {
  const key = `b${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)},${texScale}`;
  if (geoCache[key]) return geoCache[key];
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    let su, sv;
    if (nx > 0.5) { su = d; sv = h; } else if (ny > 0.5) { su = w; sv = d; } else { su = w; sv = h; }
    uv.setXY(i, uv.getX(i) * su / texScale, uv.getY(i) * sv / texScale);
  }
  return (geoCache[key] = g);
}
function cyl(rt, rb, h, seg = 10, texScale = 2) {
  const key = `c${rt},${rb},${h},${seg},${texScale}`;
  if (geoCache[key]) return geoCache[key];
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  const uv = g.attributes.uv; const circ = Math.PI * 2 * Math.max(rt, rb);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ / texScale, uv.getY(i) * h / texScale);
  return (geoCache[key] = g);
}
function sphere(r, ws = 10, hs = 8) { const key = `s${r},${ws},${hs}`; return geoCache[key] || (geoCache[key] = new THREE.SphereGeometry(r, ws, hs)); }
function cone(r, h, seg = 8) { const key = `k${r},${h},${seg}`; return geoCache[key] || (geoCache[key] = new THREE.ConeGeometry(r, h, seg)); }
function ico(r, detail = 0) { const key = `i${r},${detail}`; return geoCache[key] || (geoCache[key] = new THREE.IcosahedronGeometry(r, detail)); }

/**
 * Convenience: create a mesh and add it to a parent.
 *   M.add(parent, geometry, material, x, y, z, { rx, ry, rz, sx, sy, sz, cast=true, recv=true, name })
 */
function add(parent, geo, material, x = 0, y = 0, z = 0, o = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  if (o.rx || o.ry || o.rz) m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
  if (o.sx || o.sy || o.sz) m.scale.set(o.sx || 1, o.sy || 1, o.sz || 1);
  m.castShadow = o.cast !== false; m.receiveShadow = o.recv !== false;
  if (o.name) m.name = o.name;
  if (parent) parent.add(m);
  return m;
}

/**
 * Merge every Mesh under `root` into as few meshes as possible (static props
 * only — kills draw calls). Plain opaque Lambert materials are folded into
 * vertex colours and share one material per texture, so a whole monument or
 * prop becomes roughly one mesh per texture. Returns a new Group.
 */
const foldCache = new Map();
function foldMat(m) {
  const key = (m.map ? m.map.uuid : '-') + '|' + m.side + '|' + (m.flatShading ? 1 : 0);
  let f = foldCache.get(key);
  if (!f) { f = new THREE.MeshLambertMaterial({ color: 0xffffff, map: m.map || null, vertexColors: true, side: m.side, flatShading: !!m.flatShading }); f.userData.folded = true; foldCache.set(key, f); }
  return f;
}
function foldable(m) {
  if (!m || Array.isArray(m) || !m.isMeshLambertMaterial || m.transparent || m.alphaTest > 0) return false;
  if (m.userData.folded) return true;
  return !(m.emissive && m.emissiveIntensity > 0 && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.001);
}
/** static geometry: once it's on the GPU, drop the JavaScript copy (it can be hundreds of MB across the island).
 *  Bounds are worked out first (culling needs them). After a lost graphics context the game reloads instead. */
function dropArray() { this.array = null; }
function gpuOnly(root) {
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.keepCpu) return; const g = o.geometry; if (!g || g.userData.gpuOnly) return;
    g.computeBoundingSphere(); g.computeBoundingBox(); g.userData.gpuOnly = true;
    for (const k in g.attributes) g.attributes[k].onUpload(dropArray); if (g.index) g.index.onUpload(dropArray);
  });
  return root;
}
const UV_MAPS = ['map', 'alphaMap', 'aoMap', 'bumpMap', 'emissiveMap', 'lightMap', 'normalMap', 'specularMap', 'displacementMap'];
function usesUv(m) { return !m || Array.isArray(m) || !(m.isMeshLambertMaterial || m.isMeshBasicMaterial) || UV_MAPS.some(k => m[k]); }
/** merge geometries into one indexed geometry (non-indexed parts get a plain 0..n-1 index); the index goes straight
 *  into a typed array (16-bit when it fits) */
function mergeIndexed(list) {
  let nv = 0, ni = 0; for (const g of list) { const c = g.attributes.position.count; nv += c; ni += g.index ? g.index.count : c; }
  const idx = nv <= 65535 ? new Uint16Array(ni) : new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    if (g.index) { const a = g.index.array, n = g.index.count; for (let j = 0; j < n; j++) idx[io + j] = a[j] + vo; io += n; g.setIndex(null); }
    else { for (let j = 0; j < c; j++) idx[io + j] = j + vo; io += c; }
    vo += c;
  }
  const merged = mergeGeometries(list, false); if (!merged) return null;
  merged.setIndex(new THREE.BufferAttribute(idx, 1)); return merged;
}
function bake(root) {
  root.updateMatrixWorld(true);
  // pass 1: group the meshes by the material they end up with, and count
  const byMat = new Map();
  root.traverse(o => {
    if (!o.isMesh || o.userData.keep) return;
    const g = o.geometry, P = g.attributes.position; if (!P || !P.count) return;
    let m = o.material, fold = null;
    if (foldable(m)) { fold = m.color; m = foldMat(m); }
    let L = byMat.get(m); if (!L) { L = { parts: [], nv: 0, ni: 0 }; byMat.set(m, L); }
    // no normals: flat-shade each triangle, so the triangles can't share corners
    const flat = !g.attributes.normal, n = flat && g.index ? g.index.count : P.count;
    L.parts.push({ o, g, fold, src: o.material, flat, n }); L.nv += n; L.ni += g.index ? g.index.count : P.count;
  });
  // pass 2: write every part, moved into place, straight into one indexed geometry per material
  // (shared corners stay shared: a box is 24 corners, not 36; no texture means no uv buffer)
  const out = new THREE.Group(), v = new THREE.Vector3(), nm = new THREE.Matrix3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const [m, L] of byMat) {
    const nv = L.nv, wantUv = usesUv(m), wantCol = !!m.vertexColors;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = wantUv ? new Float32Array(nv * 2) : null, col = wantCol ? new Float32Array(nv * 3) : null;
    const idx = nv <= 65535 ? new Uint16Array(L.ni) : new Uint32Array(L.ni);
    let vo = 0, io = 0;
    for (const q of L.parts) {
      const g = q.g, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, C = g.attributes.color, I = g.index;
      const mw = q.o.matrixWorld; nm.getNormalMatrix(mw);
      const vc = (q.fold ? q.src.vertexColors : wantCol) && C ? C : null, fc = q.fold;
      const expand = q.flat && I; // vertex k of this part reads source vertex I[k]
      for (let k = 0; k < q.n; k++) {
        const s = expand ? I.getX(k) : k, o3 = (vo + k) * 3;
        v.fromBufferAttribute(P, s).applyMatrix4(mw); pos[o3] = v.x; pos[o3 + 1] = v.y; pos[o3 + 2] = v.z;
        if (N) { v.fromBufferAttribute(N, s).applyMatrix3(nm).normalize(); nor[o3] = v.x; nor[o3 + 1] = v.y; nor[o3 + 2] = v.z; }
        if (uv && U) { uv[(vo + k) * 2] = U.getX(s); uv[(vo + k) * 2 + 1] = U.getY(s); }
        if (col) {
          const r = vc ? vc.getX(s) : 1, gg = vc ? vc.getY(s) : 1, bb = vc ? vc.getZ(s) : 1;
          if (fc) { col[o3] = fc.r * r; col[o3 + 1] = fc.g * gg; col[o3 + 2] = fc.b * bb; } else { col[o3] = r; col[o3 + 1] = gg; col[o3 + 2] = bb; }
        }
      }
      if (q.flat) { // face normals, as three's computeVertexNormals gives a plain triangle list
        for (let k = 0; k + 2 < q.n; k += 3) {
          const o3 = (vo + k) * 3;
          a.fromArray(pos, o3); b.fromArray(pos, o3 + 3); c.fromArray(pos, o3 + 6);
          c.sub(b); a.sub(b); c.cross(a).normalize();
          for (let t = 0; t < 3; t++) { nor[o3 + t * 3] = c.x; nor[o3 + t * 3 + 1] = c.y; nor[o3 + t * 3 + 2] = c.z; }
        }
      }
      if (I && !q.flat) { const ia = I.array, n = I.count; for (let k = 0; k < n; k++) idx[io + k] = ia[k] + vo; io += n; }
      else { for (let k = 0; k < q.n; k++) idx[io + k] = vo + k; io += q.n; }
      vo += q.n;
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3)); merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (uv) merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
    merged.setIndex(new THREE.BufferAttribute(idx, 1));
    const mesh = new THREE.Mesh(merged, m); mesh.castShadow = true; mesh.receiveShadow = true; out.add(mesh);
  }
  return out;
}

export const M = { PAL, mat, basic, surf, box, cyl, sphere, cone, ico, add, bake, gpuOnly, mergeIndexed, usesUv, texture, CUT, mergeGeometries, SURF };
export default M;

// ============================================================================
// ZONEFALL 4 — comic ink pass. The scene (and the first-person viewmodel) is
// drawn into an offscreen target; one fullscreen pass then
//   * finds silhouettes and creases from the depth buffer (Laplacian of 1/z,
//     which is zero across any flat surface) and inks them black,
//   * boosts saturation and adds a gentle warm grade,
//   * applies tone mapping + sRGB output.
// Cost: one extra fullscreen pass with five depth taps.
// ============================================================================
import { THREE } from './materials.js';

export class InkPass {
  constructor(renderer) {
    this.r = renderer;
    const ext = renderer.extensions;
    const half = renderer.capabilities.isWebGL2 && (ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float'));
    this.rt = new THREE.WebGLRenderTarget(4, 4, {
      type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: true, stencilBuffer: false, samples: 0,
    });
    this.rt.texture.minFilter = this.rt.texture.magFilter = THREE.LinearFilter; this.rt.texture.generateMipmaps = false;
    // no half-float targets on this device: store sRGB-encoded 8-bit so dark gradients don't band
    if (!half) this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.half = half;
    this.rt.depthTexture = new THREE.DepthTexture(4, 4); this.rt.depthTexture.type = THREE.UnsignedIntType;
    this.rt.depthTexture.minFilter = this.rt.depthTexture.magFilter = THREE.NearestFilter;
    // first-person arms + weapon get their own layer (their pass clears depth, which would wipe the world's)
    this.rtVm = this.rt.clone(); this.rtVm.depthTexture = new THREE.DepthTexture(4, 4); this.rtVm.depthTexture.type = THREE.UnsignedIntType;
    this.rtVm.depthTexture.minFilter = this.rtVm.depthTexture.magFilter = THREE.NearestFilter;
    this._cc = new THREE.Color();
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture },
        uTexel: { value: new THREE.Vector2(1 / 4, 1 / 4) }, uNear: { value: 0.06 }, uFar: { value: 300 },
        uInk: { value: 1 }, uInkCol: { value: new THREE.Color('#120c10') }, uSat: { value: 1.28 },
        uFade: { value: new THREE.Vector2(55, 150) }, uLo: { value: 0.03 }, uHi: { value: 0.09 }, uWarm: { value: 0.035 },
        tVm: { value: this.rtVm.texture }, tVmDepth: { value: this.rtVm.depthTexture }, uVm: { value: 0 }, uVmNear: { value: 0.01 }, uVmFar: { value: 10 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uTexel; uniform float uNear; uniform float uFar;
        uniform float uInk; uniform vec3 uInkCol; uniform float uSat; uniform vec2 uFade; uniform float uLo; uniform float uHi; uniform float uWarm;
        uniform sampler2D tVm; uniform sampler2D tVmDepth; uniform float uVm; uniform float uVmNear; uniform float uVmFar;
        varying vec2 vUv;
        float izv(vec2 uv) { float d = texture2D(tVmDepth, uv).x; return 1.0 / uVmNear + d * (1.0 / uVmFar - 1.0 / uVmNear); }
        // depth-buffer value is affine in 1/z for a perspective camera, so 1/z is cheap and exact
        float iz(vec2 uv) { float d = texture2D(tDepth, uv).x; return 1.0 / uNear + d * (1.0 / uFar - 1.0 / uNear); }
        void main() {
          vec3 col = texture2D(tColor, vUv).rgb;
          float c = iz(vUv);
          float l = iz(vUv - vec2(uTexel.x, 0.0)), r = iz(vUv + vec2(uTexel.x, 0.0));
          float d = iz(vUv - vec2(0.0, uTexel.y)), u = iz(vUv + vec2(0.0, uTexel.y));
          float zMax = max(max(l, r), max(max(d, u), c));            // nearest of the five
          float lap = abs(l + r - 2.0 * c) + abs(u + d - 2.0 * c);
          float e = lap / zMax;                                        // relative: same weight near and far
          float ink = smoothstep(uLo, uHi, e);
          ink *= 1.0 - smoothstep(uFade.x, uFade.y, 1.0 / zMax);       // far lines melt into the haze
          if (uVm > 0.5) {
            // viewmodel layer (premultiplied): silhouette from alpha steps, creases from its own depth
            vec2 tx = vec2(uTexel.x, 0.0), ty = vec2(0.0, uTexel.y);
            vec4 v = texture2D(tVm, vUv);
            float al = texture2D(tVm, vUv - tx).a, ar = texture2D(tVm, vUv + tx).a, ad = texture2D(tVm, vUv - ty).a, au = texture2D(tVm, vUv + ty).a;
            float sil = max(max(abs(al - v.a), abs(ar - v.a)), max(abs(ad - v.a), abs(au - v.a)));
            float vInk = smoothstep(0.3, 0.75, sil) * step(0.02, max(max(al, ar), max(max(ad, au), v.a)));
            if (v.a > 0.9) {
              float vc = izv(vUv), vl = izv(vUv - tx), vr = izv(vUv + tx), vd = izv(vUv - ty), vu = izv(vUv + ty);
              float vz = max(max(vl, vr), max(max(vd, vu), vc));
              vInk = max(vInk, smoothstep(uLo, uHi, (abs(vl + vr - 2.0 * vc) + abs(vu + vd - 2.0 * vc)) / vz));
            }
            col = col * (1.0 - v.a) + v.rgb;
            ink = max(ink * (1.0 - v.a), vInk);
          }
          float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = max(mix(vec3(lum), col, uSat), 0.0);
          col *= vec3(1.0 + uWarm, 1.0 + uWarm * 0.4, 1.0 - uWarm * 0.6);
          col = mix(col, uInkCol, ink * uInk);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });
    this.mat.toneMapped = true;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(g, this.mat); this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.w = 0; this.h = 0;
  }
  setSize(w, h) {
    w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h; this.rt.setSize(w, h); this.rtVm.setSize(w, h);
    // ~1.2 px lines on a 390 pt-tall phone at 2x, never thinner than one pixel
    const k = Math.min(2.2, Math.max(1, h / 560));
    this.mat.uniforms.uTexel.value.set(k / w, k / h);
  }
  /** draw() renders the world offscreen, drawVm() (optional) the viewmodel layer; then the ink pass goes to the screen */
  render(camera, draw, drawVm = null, vmCam = null) {
    const r = this.r; const u = this.mat.uniforms;
    u.uNear.value = camera.near; u.uFar.value = camera.far;
    r.setRenderTarget(this.rt); r.clear(true, true, false);
    draw();
    u.uVm.value = 0;
    if (drawVm) {
      r.getClearColor(this._cc); const ca = r.getClearAlpha();
      r.setRenderTarget(this.rtVm); r.setClearColor(0x000000, 0); r.clear(true, true, false);
      drawVm(); r.setClearColor(this._cc, ca);
      u.uVm.value = 1; if (vmCam) { u.uVmNear.value = vmCam.near; u.uVmFar.value = vmCam.far; }
    }
    r.setRenderTarget(null);
    r.render(this.scene, this.cam);
  }
}

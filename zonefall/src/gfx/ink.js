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
    this.rt.depthTexture = new THREE.DepthTexture(4, 4); this.rt.depthTexture.type = THREE.UnsignedIntType;
    this.rt.depthTexture.minFilter = this.rt.depthTexture.magFilter = THREE.NearestFilter;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture },
        uTexel: { value: new THREE.Vector2(1 / 4, 1 / 4) }, uNear: { value: 0.06 }, uFar: { value: 300 },
        uInk: { value: 1 }, uInkCol: { value: new THREE.Color('#120c10') }, uSat: { value: 1.28 },
        uFade: { value: new THREE.Vector2(55, 150) }, uLo: { value: 0.03 }, uHi: { value: 0.09 }, uWarm: { value: 0.035 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uTexel; uniform float uNear; uniform float uFar;
        uniform float uInk; uniform vec3 uInkCol; uniform float uSat; uniform vec2 uFade; uniform float uLo; uniform float uHi; uniform float uWarm;
        varying vec2 vUv;
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
    this.w = w; this.h = h; this.rt.setSize(w, h);
    // ~1.2 px lines on a 390 pt-tall phone at 2x, never thinner than one pixel
    const k = Math.min(2.2, Math.max(1, h / 560));
    this.mat.uniforms.uTexel.value.set(k / w, k / h);
  }
  /** draw(fn) renders into the offscreen target; then the ink pass goes to the screen */
  render(camera, draw) {
    const r = this.r; const u = this.mat.uniforms;
    u.uNear.value = camera.near; u.uFar.value = camera.far;
    r.setRenderTarget(this.rt); r.clear(true, true, false);
    draw();
    r.setRenderTarget(null);
    r.render(this.scene, this.cam);
  }
}

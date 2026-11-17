// ============================================================================
// ZONEFALL 4 — your profile: a name and a look (skin, hair, beard, shirt,
// trousers, hat). It dresses your arms in first person, your body as other
// players see it in co-op, and shows on the menu. Edited in the character
// creator, which has a small live 3D preview of your survivor.
// ============================================================================
import { THREE } from './gfx/materials.js';
import { G } from './state.js';
import { $, el } from './util.js';

const KEY = 'zonefall_profile_v1';
export const SKINS = ['#f1d0b0', '#e6bc98', '#c69472', '#9c6b4c', '#6e4a34', '#4a3022'];
export const HAIRS = ['#1a1614', '#4a3324', '#8a5a2e', '#c8a050', '#a8482a', '#9a9590', '#3a6ea8', '#c84a8a'];
export const STYLES = [['short', 'Short'], ['long', 'Long'], ['buzz', 'Buzz'], ['bald', 'Bald']];
export const SHIRTS = [null, '#7a2b26', '#2f3d5a', '#56683e', '#c49a45', '#e8e0d0', '#3a3a40', '#d8432f', '#2bb3a8'];
export const PANTS = ['#7d8ba0', '#4a5f82', '#34302c', '#8a7a50', '#5a4a3a', '#56683e'];
export const HATS = [['none', 'None'], ['cap', 'Cap'], ['beanie', 'Beanie'], ['brim', 'Brim']];
export const ACCENTS = ['#d8432f', '#ffc928', '#2bb3a8', '#3a6ea8', '#86e64a', '#c86bff'];

const DEFAULT_LOOK = { skin: '#e6bc98', hairStyle: 'short', hair: '#4a3324', beard: false, shirt: null, pants: '#7d8ba0', shorts: true, hat: 'none', hatCol: '#d8432f', accent: '#d8432f' };

export const Profile = {
  data: null,
  load() {
    let d = null; try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) { d = null; }
    this.data = Object.assign({ name: '', look: Object.assign({}, DEFAULT_LOOK), created: false }, d || {});
    this.data.look = Object.assign({}, DEFAULT_LOOK, this.data.look || {});
    if (!this.data.name) this.data.name = 'Survivor' + (100 + Math.floor(Math.random() * 900));
    return this.data;
  },
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { } },
  get name() { return (this.data || this.load()).name; },
  /** the look handed to character rigs (merged over the castaway defaults) */
  rigLook() {
    const L = (this.data || this.load()).look;
    const out = { skin: L.skin, hairStyle: L.hairStyle, hair: L.hair, beard: !!L.beard, shirt: L.shirt || null, pants: L.pants, shorts: !!L.shorts, accent: L.accent };
    if (L.hat && L.hat !== 'none') { out.hat = L.hat; out.hatCol = L.hatCol || L.accent; }
    return out;
  },
  /** safe for the wire: short, plain text */
  public() { const d = this.data || this.load(); return { name: cleanName(d.name), look: this.rigLook() }; },
};
export function cleanName(s) { return String(s || '').replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Survivor'; }
/** sanitise a look that arrived over the network (only known keys, only colour strings / known enums) */
export function cleanLook(L) {
  const col = c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null;
  const out = { skin: col(L && L.skin) || DEFAULT_LOOK.skin, hair: col(L && L.hair) || DEFAULT_LOOK.hair, pants: col(L && L.pants) || DEFAULT_LOOK.pants, accent: col(L && L.accent) || DEFAULT_LOOK.accent };
  out.hairStyle = STYLES.some(s => s[0] === (L && L.hairStyle)) ? L.hairStyle : 'short';
  out.shirt = col(L && L.shirt); out.beard = !!(L && L.beard); out.shorts = !!(L && L.shorts);
  if (L && HATS.some(h => h[0] === L.hat && h[0] !== 'none')) { out.hat = L.hat; out.hatCol = col(L.hatCol) || out.accent; }
  return out;
}

// ---------------------------------------------------------------- character creator
let prev = null; // { renderer, scene, camera, rig, raf }
export function openCreator(ui, { first = false, onDone } = {}) {
  const P = Profile.data || Profile.load();
  const draft = JSON.parse(JSON.stringify(P));
  const host = G.mode === 'play' ? ui.openSheet('Your survivor', b => b, { cls: 'wide' }) : null;
  const box = host || $('#menu');
  box.innerHTML = (host ? '' : '<h2>' + (first ? 'Create your survivor' : 'Your survivor') + '</h2>') + `
    <div class="creator">
      <div class="cr-prev"><canvas id="cr-cv" width="360" height="440"></canvas><small>drag to turn</small></div>
      <div class="cr-opts">
        <label class="cr-row"><span>Name</span><input id="cr-name" maxlength="16" autocomplete="off" spellcheck="false"></label>
        <div class="cr-row"><span>Skin</span><div class="sw" id="cr-skin"></div></div>
        <div class="cr-row"><span>Hair</span><div class="seg" id="cr-style"></div></div>
        <div class="cr-row"><span></span><div class="sw" id="cr-hair"></div></div>
        <div class="cr-row"><span>Beard</span><div class="seg" id="cr-beard"></div></div>
        <div class="cr-row"><span>Shirt</span><div class="sw" id="cr-shirt"></div></div>
        <div class="cr-row"><span>Trousers</span><div class="sw" id="cr-pants"></div></div>
        <div class="cr-row"><span></span><div class="seg" id="cr-shorts"></div></div>
        <div class="cr-row"><span>Hat</span><div class="seg" id="cr-hat"></div></div>
        <div class="cr-row"><span>Colour</span><div class="sw" id="cr-acc"></div></div>
        <p class="dim small" id="cr-stats"></p>
        <div class="cr-btns"><button id="cr-rand">🎲 Random</button><button class="primary" id="cr-ok">${first ? 'Let\'s go' : 'Save'}</button>${host || first ? '' : '<button id="cr-back">Back</button>'}</div>
      </div>
    </div>`;
  const q = s => box.querySelector(s);
  const L = draft.look;
  const swatches = (id, list, key, after) => {
    const w = q(id); w.innerHTML = '';
    for (const c of list) { const b = el('button', 'swc' + (L[key] === c ? ' on' : '')); b.style.background = c || 'repeating-linear-gradient(45deg,#e6bc98 0 4px,#c69472 4px 8px)'; b.title = c ? c : 'none'; b.onclick = () => { L[key] = c; if (key === 'accent') L.hatCol = c; render(); }; w.appendChild(b); }
    if (after) after(w);
  };
  const segs = (id, list, key) => { const w = q(id); w.innerHTML = ''; for (const [v, t] of list) { const b = el('button', 'sg' + (String(L[key]) === String(v) ? ' on' : ''), t); b.onclick = () => { L[key] = v; render(); }; w.appendChild(b); } };
  const render = () => {
    swatches('#cr-skin', SKINS, 'skin'); segs('#cr-style', STYLES, 'hairStyle'); swatches('#cr-hair', HAIRS, 'hair');
    segs('#cr-beard', [[false, 'None'], [true, 'Beard']], 'beard'); swatches('#cr-shirt', SHIRTS, 'shirt'); swatches('#cr-pants', PANTS, 'pants');
    segs('#cr-shorts', [[true, 'Shorts'], [false, 'Long']], 'shorts'); segs('#cr-hat', HATS, 'hat'); swatches('#cr-acc', ACCENTS, 'accent');
    if (prev && prev.rig) prev.rig.setLook(lookOf(L));
  };
  q('#cr-name').value = draft.name;
  q('#cr-name').oninput = e => { draft.name = e.target.value; };
  q('#cr-stats').textContent = G.meta ? `Runs ${G.meta.runs} · best day ${G.meta.best} · ${G.meta.kills || 0} kills` : '';
  q('#cr-rand').onclick = () => {
    const r = a => a[Math.floor(Math.random() * a.length)];
    Object.assign(L, { skin: r(SKINS), hairStyle: r(STYLES)[0], hair: r(HAIRS), beard: Math.random() < 0.35, shirt: r(SHIRTS), pants: r(PANTS), shorts: Math.random() < 0.4, hat: r(HATS)[0], accent: r(ACCENTS) }); L.hatCol = L.accent; render();
  };
  const close = () => { stopPreview(); if (host) ui.closeSheet(); };
  q('#cr-ok').onclick = () => {
    P.name = cleanName(draft.name); P.look = L; P.created = true; Profile.save();
    if (G.player && G.onProfile) G.onProfile();
    close(); if (onDone) onDone();
  };
  if (q('#cr-back')) q('#cr-back').onclick = () => { close(); if (onDone) onDone(); };
  if (host) ui.onClose = () => stopPreview();
  startPreview(q('#cr-cv'), lookOf(L));
  render();
}
function lookOf(L) { const out = { skin: L.skin, hairStyle: L.hairStyle, hair: L.hair, beard: !!L.beard, shirt: L.shirt || null, pants: L.pants, shorts: !!L.shorts, accent: L.accent }; if (L.hat && L.hat !== 'none') { out.hat = L.hat; out.hatCol = L.hatCol || L.accent; } return out; }

function startPreview(cv, look) {
  stopPreview();
  if (!G.models || !G.models.makeHuman) return;
  let renderer; try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); } catch (e) { return; }
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.setSize(cv.clientWidth || 180, cv.clientHeight || 220, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#dcecff', '#8a7458', 1.6));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.4); sun.position.set(2, 4, 3); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 360 / 440, 0.1, 50); camera.position.set(0, 1.15, 4.4); camera.lookAt(0, 0.95, 0);
  const rig = G.models.makeHuman(look); scene.add(rig.root);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.75, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#120c10', transparent: true, opacity: 0.25 })); scene.add(disc);
  const st = { speed: 0, aim: false, swing: -1, recoil: 0, reload: -1, use: -1, throw: -1, flinch: 0, dead: 0, attack: -1 };
  let ang = 0.5, drag = null, last = performance.now();
  cv.onpointerdown = e => { drag = e.clientX; cv.setPointerCapture(e.pointerId); };
  cv.onpointermove = e => { if (drag !== null) { ang += (e.clientX - drag) * 0.012; drag = e.clientX; } };
  cv.onpointerup = () => { drag = null; };
  const loop = () => {
    if (!prev) return; const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (drag === null) ang += dt * 0.4; rig.root.rotation.y = ang;
    try { rig.update(dt, st); } catch (e) { }
    renderer.render(scene, camera); prev.raf = requestAnimationFrame(loop);
  };
  prev = { renderer, scene, camera, rig, raf: 0 }; prev.raf = requestAnimationFrame(loop);
}
function stopPreview() {
  if (!prev) return; cancelAnimationFrame(prev.raf);
  try { prev.renderer.dispose(); prev.renderer.forceContextLoss(); } catch (e) { }
  prev = null;
}

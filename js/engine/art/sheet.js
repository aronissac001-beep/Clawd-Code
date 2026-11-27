// The art contact sheet (owner D; doc 14.6 row D acceptance): `?debug=1&scene=art` draws every
// registered art key (ground, floors, structures in both material families and every rotation,
// items at every stack size, zones, designations, colonists with every hair style and palette,
// looks, pips, placeholders and the UI icons) and lets you play the slice sound effects.
// Each key is drawn inside try/catch; window.__ecArt reports what was drawn and any errors:
//   { ready, keys, drawn, missing (registered keys never drawn), errors, missingParts, data: { total, resolved, unresolved }, sfx }
// Booted by the debug scene dispatcher: bootArtSheet(new URLSearchParams(location.search)).
// Options: &z=<css px per world unit, default 2: 4 css px per native pixel> &bg=light|dark &kind=<one kind only>.
// Every cell draws at an integer device-pixel scale with image smoothing off (docs/ART-STYLE.md).

import { TILE } from '../../game/core/grid.js';
import { CONTENT } from '../../data/index.js';
import * as SP from '../sprites.js';
import { icon } from '../../ui/icons.js';
import { TER, W as MW, H as MH } from '../../game/core/grid.js';
import { ART_KEYS, KINDS, keysOfKind, hasArtKey, artMeta, STONE_IDS, HAIR_STYLES, BEARDS, CLOTH_PALETTES, SFX } from './keys.js';
import { drawArt, entryFor, missingParts, paintRockTile, paintMinedFloor, paintOreGlint, paintFloorTile, paintSurfaceTile, drawDesigMark, drawZoneTile, drawPip, flame, selectRing } from './index.js';
import { PAL, PAL_LIST } from './palette.js';
import { Px } from './pixel.js';
import { paintTitle } from './title.js';
import { drawAppIcon } from './appicon.js';
import { buildWork } from '../../game/work/construct.js';
import { colonistSprite, downedSprite, ROLE_LIST } from './people.js';
import { cropSprite } from './beings.js';
/** A crop sprite at its stage, its base on the cell's tile at x (world units). */
function drawCrop(g, kind, stage, x) { const sp = cropSprite(kind, stage); g.drawImage(sp.c, x + T / 2 - sp.ax, T - 4 - sp.ay, sp.w, sp.h); }
import { pixelPath, PATH_ROUTE, edgeMarker } from './marks.js';
import { uiArtSamples } from './ui.js';

const T = TILE;
const TITLES = { ground: 'Ground: rock faces, mined floor, ore glints', floor: 'Built floors', struct: 'Structures and furniture', item: 'Items (stack sizes 1, few, half, full)',
  zone: 'Zone tints', mark: 'Designation marks', colonist: 'Colonists (idle, walk, walk, work, work)', look: 'Profession looks', hair: 'Hair styles (x 6 palettes)',
  beard: 'Beards', cloth: 'Clothes palettes', tool: 'Tools in hand', pip: 'Strategic pips', plant: 'Plants: trees (sapling, young, grown) and crops (sown, young, grown, ripe)', animal: 'Animals', foe: 'Foes (bosses are placeholders until Stage 3)', icon: 'Icons' };

export function bootArtSheet(params = new URLSearchParams(location.search)) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  // css px per world unit, snapped so that one native pixel (2 world units) is a whole number of device px
  const z = Math.max(1, Math.round(Math.max(0.5, Math.min(4, +(params.get('z') || 2))) * 2 * dpr) / (2 * dpr));
  const scale = SP.scaleBucket(z * dpr);
  const only = params.get('kind');
  for (const id of ['root', 'screens', 'hud', 'toasts', 'title', 'modal']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
  const report = { ready: false, keys: ART_KEYS.length, drawn: 0, missing: [], errors: [], missingParts: missingParts(), data: null, sfx: [], cells: 0 };
  window.__ecArt = report;
  const drawn = new Set();
  const root = document.createElement('div');
  root.id = 'artsheet';
  root.innerHTML = `<style>
    #artsheet{position:absolute;inset:0;overflow:auto;-webkit-overflow-scrolling:touch;background:#22202e;color:#f1ead8;font:15px/1.35 system-ui,-apple-system,sans-serif;padding:12px max(12px,env(safe-area-inset-right)) 40px max(12px,env(safe-area-inset-left));box-sizing:border-box}
    #artsheet.light{background:#d9d2c2;color:#231c1a}
    #artsheet h1{font-size:20px;margin:4px 0 6px}#artsheet h2{font-size:17px;margin:22px 0 8px;border-bottom:1px solid rgba(243,230,200,.25);padding-bottom:4px}
    #artsheet .sum{font-size:15px;opacity:.9;white-space:pre-wrap}#artsheet .grid{display:flex;flex-wrap:wrap;gap:10px}
    #artsheet figure{margin:0;padding:6px;background:rgba(255,255,255,.05);border-radius:8px;max-width:100%;box-sizing:border-box}
    #artsheet.light figure{background:rgba(0,0,0,.06)}
    #artsheet canvas{display:block;max-width:100%;height:auto;image-rendering:pixelated}#artsheet .sw{display:inline-block;width:44px;height:44px;margin:0 6px 6px 0;border:1px solid rgba(241,234,216,.3);vertical-align:top;font-size:14px}#artsheet figcaption{font-size:14px;margin-top:4px;word-break:break-all}
    #artsheet figcaption b{font-weight:600}#artsheet .err{color:#ff8a80}#artsheet .ic{width:40px;height:40px;display:block;margin:2px auto}
    #artsheet button{min-width:44px;min-height:44px;font:15px system-ui,sans-serif;border-radius:8px;border:1px solid rgba(243,230,200,.4);background:#2a2433;color:#f3e6c8;padding:0 12px;margin:4px 6px 4px 0}
    #artsheet .bar{display:flex;flex-wrap:wrap;align-items:center}</style>
    <h1>Embercrown art kit: pixel style</h1><div class="sum"></div>
    <div class="bar"><button data-act="bg">Light / dark</button></div>`;
  document.body.appendChild(root);
  if (params.get('bg') === 'light') root.classList.add('light');
  root.querySelector('[data-act="bg"]').addEventListener('click', () => root.classList.toggle('light'));
  const sum = root.querySelector('.sum');

  // ---- cells -------------------------------------------------------------------------------------
  let grid = null;
  const section = (title) => { const h = document.createElement('h2'); h.textContent = title; root.appendChild(h); grid = document.createElement('div'); grid.className = 'grid'; root.appendChild(grid); };
  /** A cell of w x h world units (plus a top margin); draw(g) draws in world units with the origin at (0, top). */
  const cell = (keys, caption, w, h, top, draw) => {
    report.cells++;
    const fig = document.createElement('figure');
    const c = document.createElement('canvas');
    c.width = Math.ceil((w + 8) * z * dpr); c.height = Math.ceil((h + top + 8) * z * dpr);
    c.style.width = `${Math.ceil((w + 8) * z)}px`;
    const cap = document.createElement('figcaption');
    cap.innerHTML = caption;
    fig.appendChild(c); fig.appendChild(cap); grid.appendChild(fig);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.setTransform(z * dpr, 0, 0, z * dpr, Math.round(4 * z * dpr), Math.round((4 + top) * z * dpr));
    try { draw(g); for (const k of [].concat(keys)) drawn.add(k); }
    catch (err) {
      report.errors.push(`${[].concat(keys).join(', ')}: ${err && err.message}`);
      console.error('art sheet:', keys, err);
      cap.innerHTML += ' <span class="err">error</span>';
    }
  };
  const label = (key, extra = '') => `<b>${key}</b>${extra ? ` ${extra}` : ''}${artMeta(key) && artMeta(key).placeholder ? ' (placeholder)' : ''}`;

  // ground helpers: a little map of [kind, ...] rows painted with the kit painters
  const ROCK = 1, OPEN = 0;
  const paintMap = (g, rows, fn) => {
    const H = rows.length, W = rows[0].length;
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? ROCK : rows[y][x]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = rows[y][x];
      const mask = v === ROCK ? (at(x, y - 1) === ROCK ? 0 : 1) | (at(x + 1, y) === ROCK ? 0 : 2) | (at(x, y + 1) === ROCK ? 0 : 4) | (at(x - 1, y) === ROCK ? 0 : 8) : 0;
      fn(g, x, y, v, mask);
    }
  };
  const groundFloor = (g, W, H, mat = 3) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) paintMinedFloor(g, x, y, mat, true, false); };
  const plankFloor = (g, W, H) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) paintFloorTile(g, 'struct.f_planks', x, y, null, true); };
  const ROCKMAP = [[1, 1, 1, 1, 1], [1, 1, 0, 1, 1], [0, 0, 0, 0, 1], [0, 1, 0, 0, 0]];
  // a surface patch: a fake terrain layer (the map's own size) painted through the ground kit
  const fake = { L: { terrain: new Uint8Array(MW * MH) } };
  const surface = (g, rows) => {
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) fake.L.terrain[y * MW + x] = rows[y][x];
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) paintSurfaceTile(g, fake, x, y, true);
  };
  const grassFloor = (g, W, H) => surface(g, Array.from({ length: H }, () => Array(W).fill(TER.GRASS)));

  // ---- the palette ---------------------------------------------------------------------------------
  section('Palette (33 colours, js/engine/art/palette.js)');
  for (const n of PAL_LIST) {
    const f = document.createElement('figure'), sw = document.createElement('div'), cap = document.createElement('figcaption');
    sw.className = 'sw'; sw.style.background = PAL[n]; sw.title = n; cap.textContent = n; f.style.width = '72px';
    f.append(sw, cap); grid.appendChild(f);
  }
  section('Title illustration and app icons (title.js, appicon.js)');
  try {
    for (const [w, h] of [[130, 115], [281, 112]]) { // the native sizes of the 390 x 664 and 844 x 335 titles
      const f = document.createElement('figure'), c = document.createElement('canvas'), cap = document.createElement('figcaption');
      c.width = w; c.height = h; c.style.width = `${w * 2}px`;
      paintTitle(new Px(c.getContext('2d')), w, h, 0);
      cap.innerHTML = `<b>title</b> ${w} x ${h} native, 2x`; f.append(c, cap); grid.appendChild(f);
    }
    for (const [s, m, label] of [[192, false, '192'], [180, false, '180 (apple-touch)'], [512, true, '512 maskable']]) {
      const f = document.createElement('figure'), c = drawAppIcon(s, m), cap = document.createElement('figcaption');
      c.style.width = `${Math.min(192, s)}px`; cap.innerHTML = `<b>app icon</b> ${label}`; f.append(c, cap); grid.appendChild(f);
    }
  } catch (e) { report.errors.push(`title/app icon: ${e && e.message}`); }
  section('Surface: grass, meadow, soil, sand, marsh, moss, tilled, water (fringes and shore foam)');
  { const G = TER.GRASS, M = TER.MEADOW, D = TER.DIRT, S = TER.SAND, A = TER.SHALLOW, P = TER.DEEP, R = TER.RICH, Q = TER.MARSH, O = TER.MOSS, L = TER.TILLED;
    const rows = [[G, G, M, M, D, D, S, A], [G, G, M, D, D, S, A, P], [O, G, G, R, D, S, A, P], [O, Q, Q, R, L, L, S, A]];
    cell([], '<b>surface</b> fringes', 8 * T, 4 * T, 0, (g) => surface(g, rows)); }


  const kinds = only ? [only] : KINDS;
  for (const kind of kinds) {
    if (!TITLES[kind]) continue;
    section(TITLES[kind]);
    const keys = keysOfKind(kind);
    for (const key of keys) {
      const meta = artMeta(key);
      switch (kind) {
        case 'ground': {
          if (key.startsWith('rock.') || key.startsWith('ore.')) {
            const st = key.startsWith('rock.') ? key.slice(5) : 'granite';
            const mat = st === 'unknown' ? 0 : STONE_IDS.indexOf(st), ore = key.startsWith('ore.') ? ['', 'coal', 'copper', 'tin', 'iron'].indexOf(key.slice(4)) : 0;
            cell(key, label(key), 5 * T, 4 * T, 0, (g) => paintMap(g, ROCKMAP, (gg, x, y, v, mask) => {
              if (v === ROCK) { paintRockTile(gg, x, y, mask, mat, st !== 'unknown', true); if (ore && (x + y) % 2) paintOreGlint(gg, x, y, ore, true); }
              else paintMinedFloor(gg, x, y, mat || 3, true, false);
            }));
          } else cell(key, label(key), 2 * T, 2 * T, 0, (g) => { for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) drawArt(g, key, x * T, y * T, { tx: x, ty: y, mat: 'granite' }); });
          break;
        }
        case 'floor':
          for (const mat of key === 'struct.f_flag' ? ['granite', 'sandstone', 'marble'] : [null]) {
            cell(key, label(key, mat || ''), 3 * T, 2 * T, 0, (g) => { for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) paintFloorTile(g, key, x, y, mat, true); });
          }
          break;
        case 'struct': structCells(key, meta); break;
        case 'item': {
          const mats = key === 'item.stone' || key === 'item.block' || key === 'item.pillar' ? ['granite', 'sandstone', 'basalt', 'marble'] : key === 'item.ore' || key === 'item.ingot' ? ['copper', 'tin', 'iron'] : ['item.bed', 'item.table', 'item.chair'].includes(key) ? ['wood', 'granite'] : [null];
          for (const mat of mats) cell(key, label(key, mat || ''), 4 * T, T, 6, (g) => { groundFloor(g, 4, 1); for (let n = 0; n < 4; n++) drawArt(g, key, n * T, 0, { mat, n, scale }); });
          break;
        }
        case 'zone': cell(key, label(key), 3 * T, 2 * T, 0, (g) => {
          groundFloor(g, 3, 2);
          const type = key.slice(8);
          for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) drawZoneTile(g, type, x, y, (y === 0 ? 1 : 4) | (x === 0 ? 8 : 0) | (x === 2 ? 2 : 0), 1, 0);
        }); break;
        case 'mark': cell(key, label(key), T * 2, T, 0, (g) => {
          paintMap(g, [[1, 0]], (gg, x, y, v, mask) => (v ? paintRockTile(gg, x, y, mask | 4, 3, true, true) : paintMinedFloor(gg, x, y, 3, true)));
          if (key === 'mark.blueprint') { drawArt(g, key, 0, 0); drawArt(g, key, T, 0); return; }
          g.globalAlpha = 0.5; drawDesigMark(g, key.slice(5), 0, 0, 1); g.globalAlpha = 1; drawDesigMark(g, key.slice(5), 1, 0, 1);
        }); break;
        case 'colonist': {
          const anc = key.slice(9);
          if (anc === 'human') {
            cell([], '<b>roles</b> tunic colour per role', 6 * T, T, 12, (g) => { groundFloor(g, 6, 1); ROLE_LIST.forEach((role, i) => { const sp = colonistSprite({ anc, role: [role], look: { skin: i % 6, hair: i % 4, hairC: (i * 5) % 6, beard: i % 5, cloth: i } }, 0, false, scale); g.drawImage(sp.c, i * T + T / 2 - sp.ax, T - 4 - sp.ay, sp.w, sp.h); }); });
            cell([], '<b>walk cycle</b> 1, 0, 2, 0 and carry 5, 6, 7', 7 * T, T, 12, (g) => { groundFloor(g, 7, 1); [1, 0, 2, 0, 5, 6, 7].forEach((f, i) => { const sp = colonistSprite({ anc, role: ['hauler'], look: { skin: 2, hair: 1, hairC: 3, beard: 0, cloth: 1 }, job: { carry: { k: i === 5 ? 'wood' : i === 6 ? 'stone' : 'meal' } } }, f, false, scale); g.drawImage(sp.c, i * T + T / 2 - sp.ax, T - 4 - sp.ay, sp.w, sp.h); }); });
            cell([], '<b>drafted</b> spear: idle, wind-up, thrust; <b>downed</b>', 5 * T, T, 12, (g) => {
              groundFloor(g, 5, 1);
              const c = { anc, role: ['miner'], drafted: true, look: { skin: 1, hair: 3, hairC: 2, beard: 1, cloth: 0 } };
              [[0, 'spear'], [3, 'spear'], [4, 'spear']].forEach(([f, t], i) => { const sp = colonistSprite(c, f, false, scale, t); g.drawImage(sp.c, i * T + T / 2 - sp.ax, T - 4 - sp.ay, sp.w, sp.h); });
              for (let i = 0; i < 2; i++) { const sp = downedSprite({ anc, role: ['hauler'], look: { skin: 3 + i, hair: i, hairC: 4, beard: 2, cloth: 3 } }, i === 1); g.drawImage(sp.c, (3 + i) * T + T / 2 - sp.ax, T - 4 - sp.ay, sp.w, sp.h); }
            });
            cell([], '<b>selection ring</b> and live flames', 4 * T, T, 16, (g) => { groundFloor(g, 4, 1); for (const [i, d] of [[0, false], [1, true]]) { const r = selectRing(d); g.drawImage(r.c, i * T + T / 2 - r.ax, T - 8 - r.ay, r.w, r.h); const sp = colonistSprite({ anc, role: ['miner'], look: { skin: 3, hair: 2, hairC: 1, beard: 3, cloth: 2 } }, 0, i === 1, scale); g.drawImage(sp.c, i * T + T / 2 - sp.ax, T - 4 - sp.ay, sp.w, sp.h); } flame(g, 2.5 * T, T - 6, 4, 0); flame(g, 3.5 * T, T - 6, 8, 0.3); });
          }
          const tools = ['', '', '', 'pick', 'hammer'];
          cell(key, label(key, 'frames 0-4'), 5 * T, T, 12, (g) => {
            groundFloor(g, 5, 1);
            for (let f = 0; f < 5; f++) { const sp = colonistSprite({ anc, look: { skin: f, hair: f % 4, hairC: (f * 2) % 6, beard: (f + 2) % 5, cloth: f } }, f, f === 2, scale, tools[f]); g.drawImage(sp.c, f * T + T / 2 - sp.ax, T - 4 - sp.ay, sp.w, sp.h); }
          });
          break;
        }
        case 'hair': {
          const h = HAIR_STYLES.indexOf(key.slice(5));
          cell(key, label(key, 'x 6 colours'), 6 * T, T, 12, (g) => {
            groundFloor(g, 6, 1);
            for (let c = 0; c < 6; c++) { const sp = colonistSprite({ anc: 'human', look: { skin: c, hair: h, hairC: c, beard: 0, cloth: (c + h) % 6 } }, 0, false, scale); g.drawImage(sp.c, c * T + T / 2 - sp.ax, T - 4 - sp.ay, sp.w, sp.h); }
          });
          break;
        }
        case 'beard': {
          const b = BEARDS.indexOf(key.slice(6));
          cell(key, label(key), 3 * T, T, 12, (g) => { groundFloor(g, 3, 1); for (let c = 0; c < 3; c++) { const sp = colonistSprite({ anc: c === 2 ? 'deepforge' : 'human', look: { skin: c * 2, hair: c, hairC: c + 1, beard: b, cloth: c } }, 0, c === 1, scale); g.drawImage(sp.c, c * T + T / 2 - sp.ax, T - 4 - sp.ay, sp.w, sp.h); } });
          break;
        }
        case 'cloth': {
          const ci = CLOTH_PALETTES.indexOf(key.slice(6));
          cell(key, label(key), 3 * T, T, 12, (g) => { groundFloor(g, 3, 1); for (let f = 0; f < 3; f++) { const sp = colonistSprite({ anc: 'human', look: { skin: f + 1, hair: f, hairC: f, beard: f, cloth: ci } }, f, false, scale); g.drawImage(sp.c, f * T + T / 2 - sp.ax, T - 4 - sp.ay, sp.w, sp.h); } });
          break;
        }
        case 'tool': {
          const t = key.slice(5);
          cell(key, label(key, 'in hand, swing'), 3 * T, T, 12, (g) => {
            groundFloor(g, 3, 1);
            drawArt(g, key, 0, 0, { scale });
            for (let f = 3; f < 5; f++) { const sp = colonistSprite({ anc: 'human', look: { skin: 2, hair: 1, hairC: 2, beard: 2, cloth: f } }, f, false, scale, t); g.drawImage(sp.c, (f - 2) * T + T / 2 - sp.ax, T - 4 - sp.ay, sp.w, sp.h); }
          });
          break;
        }
        case 'pip': {
          if (key === 'pip.colonist') {
            cell(key, label(key, 'roles; mood 90, 50, 20'), 5 * T, 2 * T, 0, (g) => {
              groundFloor(g, 5, 2);
              ['miner', 'builder', 'crafter', 'hauler', 'generalist'].forEach((role, i) => drawPip(g, i * T + T / 2, T / 2, 0.42 * 2, { role, mood: 72 }));
              [90, 50, 20].forEach((mood, i) => drawPip(g, i * T + T / 2, T * 1.5, 0.42 * 2, { role: 'miner', mood, job: i === 0, alert: i === 2 }));
            });
          } else cell(key, label(key), 2 * T, 2 * T, 0, (g) => { groundFloor(g, 2, 2); drawArt(g, key, T / 2, T / 2, { z: 0.84 }); });
          if (key === 'pip.raid') {
            cell([], '<b>raid warning</b> edge markers (n, e, s, w; bright pulse) and the route preview', 8 * T, 3 * T, 0, (g) => {
              groundFloor(g, 8, 3);
              const path = []; for (let x = 0; x < 5; x++) path.push(1 * 64 + x); for (let y = 1; y < 3; y++) path.push(y * 64 + 4);
              pixelPath(g, path, 64, 0.2, PATH_ROUTE);
              ['n', 'e', 's', 'w'].forEach((sd, i) => { const sp = edgeMarker(sd, i === 1); g.drawImage(sp.c, (5 + (i & 1) * 1.5) * T + T / 2 - sp.ax, (0.2 + (i >> 1) * 1.4) * T + T / 2 - sp.ay, sp.w, sp.h); });
            });
          }
          break;
        }
        case 'icon': {
          report.cells++;
          const fig = document.createElement('figure');
          fig.innerHTML = `${icon(key)}<figcaption><b>${key}</b></figcaption>`;
          fig.style.minWidth = '72px'; fig.style.textAlign = 'center';
          grid.appendChild(fig); drawn.add(key);
          break;
        }
        case 'plant': {
          // trees: sapling, young, grown; crops (Stage 2: 8 kinds x 4 stages: sown, young, grown, ripe); the berry bush bare and ripe
          const crop = artMeta(key).base === 'crop' || key === 'plant.hearthroot', n = key === 'plant.berry' ? 2 : crop ? 4 : 3;
          cell(key, label(key, key === 'plant.berry' ? 'bare, ripe' : crop ? 'sown, young, grown, ripe' : 'stages 0-2'), n * T, T, 40, (g) => {
            grassFloor(g, n, 1);
            for (let k = 0; k < n; k++) drawArt(g, key, k * T, 0, { stage: k, ripe: k === 1, v: k, scale });
          });
          if (key === 'plant.berry') cell('plant.berry', label('plant.berry', 'as a crop: sown, young, grown, ripe'), 4 * T, T, 40, (g) => { grassFloor(g, 4, 1); for (let k = 0; k < 4; k++) drawCrop(g, 'berry', k, k * T); });
        } break;
        case 'animal': case 'foe': cell(key, label(key, 'idle, walk, walk, strike'), 4 * T, T, key.startsWith('boss.') ? 36 : 16, (g) => {
          groundFloor(g, 4, 1);
          for (let f = 0; f < 4; f++) drawArt(g, key, f * T, 0, { frame: f, flip: f === 2, scale });
        }); break;
        default: cell(key, label(key), T * 1.5, T, 8, (g) => { groundFloor(g, 1, 1); drawArt(g, key, 0, 0, { scale }); });
      }
    }
    if (kind === 'ground') { // the full autotile set: 16 masks of one stone, and the natural pillar
      for (const st of ['granite', 'sandstone', 'duskstone']) {
        const mat = STONE_IDS.indexOf(st);
        cell([], `<b>autotile</b> ${st}: masks 0-15`, 8 * T, 2 * T, 0, (g) => { for (let m = 0; m < 16; m++) paintRockTile(g, m % 8, (m / 8) | 0, m, mat, true, true); });
      }
    }
  }
  if (!only || only === 'ui') {
    section('UI art: panel frames, rune rule, icon sheet (ui.js)');
    try { uiArtSamples(document).figures.forEach((f) => grid.appendChild(f)); } catch (e) { report.errors.push(`ui art: ${e && e.message}`); }
  }
  if (!only || only === 'sfx') sfxSection();

  // ---- structures ----------------------------------------------------------------------------------
  function structCells(key, meta) {
    const [w, h] = meta.size;
    const def = CONTENT.all('structure').find((d) => d.art === key);
    if (key === 'struct.wall') {
      // an L of walls plus a free post, in wood and three stones
      const WALLS = [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [0, 2], [2, 2]];
      const has = (x, y) => WALLS.some(([a, b]) => a === x && b === y);
      for (const mat of ['wood', 'granite', 'sandstone', 'marble', 'duskstone']) {
        cell(key, label(key, mat), 4 * T, 3 * T, 18, (g) => {
          groundFloor(g, 4, 3);
          for (const [x, y] of [...WALLS].sort((a, b) => a[1] - b[1])) {
            const mask = (has(x, y - 1) ? 1 : 0) | (has(x + 1, y) ? 2 : 0) | (has(x, y + 1) ? 4 : 0) | (has(x - 1, y) ? 8 : 0);
            drawArt(g, key, x * T, y * T, { mat, mask, v: (x * 7 + y * 3) & 1, scale });
          }
        });
      }
      return;
    }
    if (key === 'struct.door') {
      for (const open of [false, true]) {
        cell(key, label(key, open ? 'open' : 'closed'), 3 * T, 3 * T, 18, (g) => {
          groundFloor(g, 3, 3);
          // an east-west run: wall, door, wall (row 1), with a wall stub north of the door
          drawArt(g, 'struct.wall', 1 * T, 0, { mat: 'granite', mask: 4 });
          drawArt(g, 'struct.wall', 0, T, { mat: 'granite', mask: 2 });
          drawArt(g, key, T, T, { mat: 'wood', mask: 10, open, scale });
          drawArt(g, 'struct.wall', 2 * T, T, { mat: 'granite', mask: 8 });
        });
      }
      cell(key, label(key, 'in a north-south wall'), 2 * T, 3 * T, 18, (g) => {
        groundFloor(g, 2, 3);
        drawArt(g, 'struct.wall', 0, 0, { mat: 'wood', mask: 4 });
        drawArt(g, key, 0, T, { mat: 'wood', mask: 5, scale });
        drawArt(g, 'struct.wall', 0, 2 * T, { mat: 'wood', mask: 1 });
      });
      return;
    }
    const fams = meta.tint === 'mat' ? ['wood', 'granite', 'marble'] : key === 'struct.pillar' ? ['granite', 'marble', 'duskstone'] : [null];
    const rots = key === 'struct.bed' || key === 'struct.table' || key === 'struct.carpenter' || key === 'struct.mason' ? [0, 1] : key === 'struct.chair' ? [0, 1, 2, 3] : [0];
    for (const mat of fams) {
      for (const rot of rots) {
        const fw = rot & 1 ? h : w, fh = rot & 1 ? w : h;
        const top = 34;
        cell(key, label(key, `${mat || ''}${rots.length > 1 ? ` rot ${rot}` : ''}`), (fw + 1) * T, (fh + 1) * T, top, (g) => {
          if (key === 'struct.hearth' || key === 'struct.campfire' || key === 'struct.brazier' || meta.placeholder) grassFloor(g, fw + 1, fh + 1);
          else if (key === 'struct.sconce' || key === 'struct.prop' || key === 'struct.pillar' || key === 'struct.bloomery' || key === 'struct.forge') groundFloor(g, fw + 1, fh + 1);
          else plankFloor(g, fw + 1, fh + 1);
          drawArt(g, key, T / 2, T / 2, { mat, rot, v: rot, scale, t: performance.now() / 1000 });
        });
      }
    }
    // a frame half built (the entity layer's construction look)
    if (def && (key === 'struct.bed' || key === 'struct.carpenter' || key === 'struct.wall')) {
      cell(key, label(key, 'frame, half built'), (w + 1) * T, (h + 1) * T, 34, (g) => {
        plankFloor(g, w + 1, h + 1);
        const e = entryFor(def.id, key, null);
        const b = { id: 1, def: def.id, x: 0, y: 0, rot: 0, mat: 'wood', st: 'frame', work: 0, got: {}, need: {} };
        b.work = Math.floor(buildWork(b) / 2);
        g.save(); g.translate(T / 2, T / 2); e.draw(g, b, { scale, time: 0 }, null); g.restore();
      });
    }
  }

  // ---- sound effects ------------------------------------------------------------------------------
  function sfxSection() {
    section('Sound effects (tap to play)');
    const names = ['dig', 'ore', 'saw', 'hammer', 'chisel', 'door', 'rockfall', 'warhorn', 'drums', 'clash', 'bite', 'thud', 'bellows'];
    const bar = document.createElement('div'); bar.className = 'bar'; grid.appendChild(bar);
    const out = document.createElement('div'); out.className = 'sum'; grid.appendChild(out);
    import('../audio.js').then(({ audio, renderSfxOffline }) => {
      for (const n of names) {
        const b = document.createElement('button'); b.textContent = n; b.title = SFX[n] || n;
        b.addEventListener('click', () => { audio.unlock(); setTimeout(() => audio.play(n), 30); });
        bar.appendChild(b);
      }
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OAC) { out.textContent = 'OfflineAudioContext unavailable: SFX not measured'; return; }
      return Promise.all(names.map((n) => renderSfxOffline(n).catch((e) => ({ name: n, error: String(e && e.message) })))).then((rs) => {
        report.sfx = rs;
        out.textContent = rs.map((r) => (r.error ? `${r.name}: error ${r.error}` : `${r.name}: ${r.dur.toFixed(2)} s, rms ${r.rms}, peak ${r.peak}`)).join('\n');
      });
    }).catch((e) => { report.errors.push(`sfx: ${e && e.message}`); }).finally(finish);
  }

  // ---- data check and summary ----------------------------------------------------------------------
  const refs = [];
  for (const k of CONTENT.kinds()) for (const d of CONTENT.all(k)) for (const f of ['art', 'icon', 'look']) if (typeof d[f] === 'string') refs.push(d[f]);
  const unresolved = [...new Set(refs.filter((k) => !hasArtKey(k)))];
  const slice = [];
  for (const k of CONTENT.kinds()) for (const d of CONTENT.all(k)) if (d.stage === '1a' && typeof d.art === 'string') slice.push(d.art);
  report.data = { total: new Set(refs).size, resolved: new Set(refs).size - unresolved.length, unresolved, sliceKeys: [...new Set(slice)].length, sliceUnresolved: [...new Set(slice)].filter((k) => !hasArtKey(k)) };
  function finish() {
    report.drawn = drawn.size;
    report.missing = only ? [] : ART_KEYS.filter((k) => !drawn.has(k));
    sum.textContent = `${report.keys} keys registered, ${report.drawn} drawn in ${report.cells} cells, ${report.missing.length} not drawn, ${report.errors.length} errors\n`
      + `data: ${report.data.resolved} of ${report.data.total} art / icon / look keys resolve (slice: ${report.data.sliceKeys - report.data.sliceUnresolved.length} of ${report.data.sliceKeys})`
      + `${report.missingParts.length ? `\nkit parts with no drawer: ${report.missingParts.join(', ')}` : ''}${report.errors.length ? `\nerrors: ${report.errors.join('; ')}` : ''}`;
    report.ready = true;
  }
  if (only && only !== 'sfx') finish();
  return report;
}

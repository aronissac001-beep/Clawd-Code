// Fluid render (Stage Z3.4; EMBERCROWN-FORTRESS.md 2.8 Z3): water and ember voxels of the view level drawn over
// the terrain from the `fluid` layer (bits 0-2 depth, bit 3 ember). Render-only: reads s.L.fluid, writes
// nothing the sim reads. Pixel art: whole-tile fills in four water bands by depth plus a 2 px rim line on the
// deep ones, ember in two bands with a slow flicker (still under reduce-motion). No allocation per frame.
//   installFluidRender(renderer)  adds the draw hook to BUS.draw.world (idempotent); the hook reads
//                                 renderer.viewZ, so it draws the level the player is looking at.

import { TILE, W, H, D, PLANE } from '../../game/core/grid.js';
import { BUS } from '../../game/core/bus.js';

// original palette: river slate blues and ember reds
const WATER = ['rgba(0,0,0,0)', 'rgba(70,120,170,0.35)', 'rgba(62,110,164,0.45)', 'rgba(54,98,156,0.55)', 'rgba(40,78,138,0.68)',
  'rgba(34,68,126,0.74)', 'rgba(28,58,114,0.80)', 'rgba(22,48,100,0.86)'];
const RIM = 'rgba(150,190,220,0.55)';
const EMBER = ['rgba(196,72,24,0.85)', 'rgba(232,120,40,0.90)'];

export class FluidLayer {
  constructor() { this.calm = false; this.drawn = 0; }
  /** Draw level z's fluid inside view (world px). */
  draw(g, s, view, z, time = 0) {
    this.drawn = 0;
    const fl = s && s.L && s.L.fluid;
    if (!fl || D <= 1 || z < 0 || z >= D) return 0;
    const x0 = Math.max(0, Math.floor(view.x0 / TILE)), x1 = Math.min(W - 1, Math.floor(view.x1 / TILE));
    const y0 = Math.max(0, Math.floor(view.y0 / TILE)), y1 = Math.min(H - 1, Math.floor(view.y1 / TILE));
    const base = z * PLANE, flick = this.calm ? 0 : ((time * 2) | 0) & 1;
    let n = 0;
    for (let y = y0; y <= y1; y++) {
      const row = base + y * W;
      for (let x = x0; x <= x1; x++) {
        const v = fl[row + x], d = v & 7;
        if (!d) continue;
        if (v & 8) { g.fillStyle = EMBER[((x + y) & 1) ^ flick]; g.fillRect(x * TILE, y * TILE, TILE, TILE); }
        else {
          g.fillStyle = WATER[d]; g.fillRect(x * TILE, y * TILE, TILE, TILE);
          if (d >= 4) { g.fillStyle = RIM; g.fillRect(x * TILE + 4, y * TILE + ((x * 7 + y * 3) & 15) + 6, TILE - 8, 2); }
        }
        n++;
      }
    }
    this.drawn = n;
    return n;
  }
}

/** Add the fluid draw hook for renderer r (once per renderer). */
export function installFluidRender(r) {
  if (!r || r.fluidLayer) return r && r.fluidLayer;
  const layer = new FluidLayer();
  r.fluidLayer = layer;
  const hook = (g, s, view, time) => { layer.calm = !!(r.settings && r.settings.reduceMotion); layer.draw(g, s, view, r.d3 ? r.viewZ : 0, time); };
  BUS.draw.world.push(hook);
  layer.unhook = () => { const k = BUS.draw.world.indexOf(hook); if (k >= 0) BUS.draw.world.splice(k, 1); r.fluidLayer = null; };
  return layer;
}

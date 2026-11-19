// ============================================================================
// ZONEFALL — homestead hub: electricity (power.js), farming (farming.js) and
// cooking (cooking.js), wired into the rest of the game in one place.
//
//   Home.onPlace(d, opts) / onRemove(d) / reset()   from build.js (placeDeploy / removeDeploy / Build.reset)
//   Home.tick(dt)        host only, from Build.tick: the simulation, once a second
//   Home.frame(dt)       every peer, every frame (game.js): indicators, cables, crops, steam, wiring bar
//   Home.label(d) / interact(p, d)   the interact prompt and tap for homestead deployables (player.js)
//   Home.chips(p)        food-buff HUD chips (ui.js);  Home.onPick(p, veg)  wild seeds
//   Buffs                food buffs (player.js reads Buffs.val for regen / rad / hunger / gather)
// ============================================================================
import { G } from './state.js';
import { DEPLOY } from './data.js';
import { POWER, registerHomesteadIcons } from './data_homestead.js';
import { Power, isLit, holdingWire } from './power.js';
import { Farming, isPlanter } from './farming.js';
import { Cooking, Buffs } from './cooking.js';
import { HomeUI } from './ui_homestead.js';
import { Sfx } from './audio.js';

export { Buffs, isLit, Power, Farming, Cooking };

export const Home = {
  acc: 0,
  onPlace(d, opts) { try { Power.onPlace(d, opts); Farming.onPlace(d); Cooking.onPlace(d); } catch (e) { console.warn('homestead place', d.type, e); } },
  onRemove(d) { try { Power.onRemove(d); } catch (e) { console.warn('homestead remove', e); } },
  reset() { Power.reset(); this.acc = 0; },
  /** host: the grid, the crops and the pots move on once a second */
  tick(dt) { this.acc += dt; if (this.acc < 1) return; const s = Math.min(this.acc, 5); this.acc = 0; this.step(s); },
  step(s) { Power.step(s); Farming.step(s); Cooking.step(s); },
  frame(dt) {
    if (!this.icons) { this.icons = true; try { registerHomesteadIcons(typeof window !== 'undefined' ? window.ART : null); } catch (e) { console.warn('homestead icons', e); } }
    if (G.mode !== 'play' || !G.player) return;
    try { Power.frame(dt); Farming.frame(dt); Cooking.frame(dt); HomeUI.frame(dt); } catch (e) { if (!this.err) { this.err = true; console.warn('homestead frame', e); } }
  },
  /** [label, ui icon] for the interact button, or null */
  label(d) {
    const p = G.player, S = POWER[d.type];
    if (S && holdingWire(p)) return Power.wireLabel(d);
    if (S) {
      const st = d.state, nm = DEPLOY[d.type].name;
      if (S.kind === 'switch') return ['Switch: ' + (st.on ? 'ON' : 'OFF') + ' (tap)', 'hand'];
      const short = S.kind === 'gen' ? (st.run ? S.max + ' W' : st.on ? 'no fuel' : 'off') : S.kind === 'solar' || S.kind === 'wind' ? (st.av || 0) + ' W'
        : S.kind === 'battery' ? Math.round((st.ch || 0) / S.cap * 100) + '%' : st.legacy ? 'on' : st.pw ? 'powered' : S.kind === 'turret' ? 'unpowered' : 'no power';
      return [nm + ' · ' + short, S.kind === 'furnace' ? 'smelt' : 'light'];
    }
    if (isPlanter(d)) { const r = Farming.ripe(d); if (r) return ['Harvest (' + r + ' ripe)', 'planter']; return [DEPLOY[d.type].name + ' · ' + Farming.status(d), 'planter']; }
    if (d.type === 'cook_pot') return ['Cooking pot' + (d.state.lit ? ' (burning)' : ''), 'cook'];
    return null;
  },
  /** a tap on a homestead deployable; returns true if it was one */
  interact(p, d) {
    const S = POWER[d.type], U = G.ui;
    if (S && holdingWire(p)) {
      const r = Power.wireTap(d); Sfx.click();
      if (r.msg && U) U.toast(r.msg, r.good ? 'good' : r.bad ? 'bad' : '');
      if (r.bad) Sfx.deny();
      if (r.open) HomeUI.openPower(d);
      return true;
    }
    if (S && S.kind === 'switch') { d.state.on = d.state.on ? 0 : 1; Sfx.lever(); return true; }
    if (S) { HomeUI.openPower(d); return true; }
    if (isPlanter(d)) { if (Farming.ripe(d)) { const n = Farming.harvest(p, d); if (U && n) U.toast('Harvested ' + n + ' plant' + (n > 1 ? 's' : ''), 'good'); } else HomeUI.openPlanter(d); return true; }
    if (d.type === 'cook_pot') { HomeUI.openPot(d); return true; }
    return false;
  },
  chips(p) { return Buffs.chips(p); },
  onPick(p, v) { Farming.wildSeed(p, v.kind); },
};
G.home = Home; // tests / debugging

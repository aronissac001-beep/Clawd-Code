// Debug overlay, enabled with ?debug=1: FPS, entities, tick/draw time and cheats.
import { el } from './dom.js';
import { spriteMemory } from '../engine/sprites.js';

export class DebugOverlay {
  constructor(root, ctl) {
    this.ctl = ctl;
    this.node = el('div', 'debug panel', '<div class="txt"></div><div class="btns"></div>');
    this.txt = this.node.querySelector('.txt');
    const btns = this.node.querySelector('.btns');
    const add = (label, fn) => { const b = el('button', '', label); b.addEventListener('pointerup', fn); btns.appendChild(b); };
    add('+500 res', () => ctl.cmd({ t: 'debug', what: 'res' }));
    add('Skip phase', () => ctl.cmd({ t: 'debug', what: 'night' }));
    add('Spawn boss', () => ctl.cmd({ t: 'debug', what: 'boss' }));
    add('Reveal map', () => ctl.cmd({ t: 'debug', what: 'reveal' }));
    add('Stress 220', () => ctl.cmd({ t: 'debug', what: 'stress' }));
    add('Blood Moon', () => ctl.cmd({ t: 'debug', what: 'blood' }));
    add('Win nights', () => ctl.cmd({ t: 'debug', what: 'win' }));
    // Tap the stats to fold the cheat buttons away.
    this.txt.addEventListener('pointerup', () => btns.classList.toggle('hidden'));
    root.appendChild(this.node);
    this.t = 0;
  }
  update(dt, loop, s) {
    this.t += dt;
    if (this.t < 0.33) return;
    this.t = 0;
    const ents = s.villagers.length + s.soldiers.length + s.enemies.length + (s.sovereign ? 1 : 0);
    const mem = performance.memory ? ` heap ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)}MB` : '';
    this.txt.textContent = `FPS ${loop.fps.toFixed(0)} | ents ${ents} (foe ${s.enemies.length}) | proj ${s.projectiles.length}\ntick ${loop.tickMs.toFixed(2)}ms draw ${loop.frameMs.toFixed(1)}ms\nsprites ${(spriteMemory() / 1048576).toFixed(1)}MB${mem} | t${s.tick}`;
    this.txt.style.whiteSpace = 'pre';
  }
  remove() { this.node.remove(); }
}

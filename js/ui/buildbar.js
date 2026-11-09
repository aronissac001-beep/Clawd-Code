// Build bar: category tabs + building buttons. Drag a button onto the map to
// place a ghost (or tap it to drop the ghost mid-screen). Long-press explains.
import { el, tapButton, fmt } from './dom.js';
import { icon } from './icons.js';
import { BUILDINGS, BUILD_ORDER, CATEGORIES } from '../data/buildings.js';
import { canAfford } from '../game/systems/common.js';
import { buildingSprite } from '../engine/sprites.js';
import { audio } from '../engine/audio.js';

export class BuildBar {
  constructor(ctl) {
    this.ctl = ctl;
    this.root = el('div', 'build panel');
    this.tabs = el('div', 'tabs');
    this.items = el('div', 'items');
    this.root.append(this.tabs, this.items);
    this.cat = 'economy';
    this.known = null; // null = everything (standalone regions)
    this.thumbs = {};
    this.buttons = [];
    for (const c of CATEGORIES) {
      const b = el('button', 'tab', icon(c.icon));
      b.setAttribute('aria-label', c.name);
      b.dataset.cat = c.id;
      tapButton(b, () => this.setCat(c.id), { longpress: () => ctl.toast(`${c.name} buildings`, '', c.icon) });
      this.tabs.appendChild(b);
    }
  }

  makeThumbs(her) {
    for (const type of Object.keys(BUILDINGS)) {
      if (!BUILDINGS[type].cat) continue;
      const sp = buildingSprite(type, 0, 2, her);
      const c = document.createElement('canvas');
      c.width = sp.c.width; c.height = sp.c.height;
      c.getContext('2d').drawImage(sp.c, 0, 0);
      try { this.thumbs[type] = c.toDataURL(); } catch (_) { this.thumbs[type] = ''; }
    }
    this.setCat(this.cat);
  }

  /** Restrict the bar to learned blueprints (null = all). */
  setKnown(list) {
    this.known = list && list.length ? list.slice() : null;
    this.setCat(this.cat);
  }

  setCat(cat) {
    this.cat = cat;
    for (const t of this.tabs.children) {
      t.classList.toggle('on', t.dataset.cat === cat);
      const n = BUILD_ORDER[t.dataset.cat].filter((x) => !this.known || this.known.includes(x)).length;
      t.classList.toggle('empty', n === 0);
    }
    this.items.innerHTML = '';
    this.buttons = [];
    const types = BUILD_ORDER[cat].filter((x) => !this.known || this.known.includes(x));
    if (!types.length) {
      const hint = el('div', 'bar-hint', 'No blueprints yet. Learn them from drafts and merchants.');
      this.items.appendChild(hint);
    }
    for (const type of types) {
      const def = BUILDINGS[type];
      const cost = def.levels[0].cost;
      const [k, v] = Object.entries(cost)[0];
      const b = el('button', 'item', `<img alt="" src="${this.thumbs[type] || ''}"><span class="cost"><span style="color:var(--c-${k})">${icon(k)}</span>${v}${Object.keys(cost).length > 1 ? '+' : ''}</span>`);
      b.setAttribute('aria-label', def.name);
      b.dataset.type = type;
      this.wire(b, type);
      this.items.appendChild(b);
      this.buttons.push(b);
    }
    this.lastRes = null;
  }

  // Pointer logic: drag out = place ghost under finger; tap = ghost at centre; hold = info.
  wire(b, type) {
    let st = null;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      audio.play('click');
      b.classList.add('active');
      st = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), mode: 'press' };
      st.lp = setTimeout(() => { if (st && st.mode === 'press') { st.mode = 'info'; this.ctl.openBuildInfo(type); } }, 480);
    });
    b.addEventListener('pointermove', (e) => {
      if (!st || st.id !== e.pointerId) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      // Sideways swipes scroll the bar; pulling up and out drags a ghost onto the map.
      if (st.mode === 'press' && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { clearTimeout(st.lp); st.mode = 'scroll'; }
      if (st.mode === 'press' && Math.hypot(dx, dy) > 12) {
        clearTimeout(st.lp);
        st.mode = 'drag';
        this.ctl.beginPlacement(type, e.clientX, e.clientY);
      }
      if (st.mode === 'drag') this.ctl.dragPlacement(e.clientX, e.clientY);
    });
    const end = (e, cancel) => {
      if (!st || st.id !== e.pointerId) return;
      clearTimeout(st.lp);
      b.classList.remove('active');
      try { b.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      if (st.mode === 'press' && !cancel) this.ctl.beginPlacement(type, null, null);
      else if (st.mode === 'drag') this.ctl.dropPlacement();
      st = null;
    };
    b.addEventListener('pointerup', (e) => end(e, false));
    b.addEventListener('pointercancel', (e) => end(e, true));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  update(res) {
    const key = `${res.food | 0}|${res.wood | 0}|${res.stone | 0}|${res.gold | 0}`;
    if (key === this.lastRes) return;
    this.lastRes = key;
    for (const b of this.buttons) {
      const def = BUILDINGS[b.dataset.type];
      b.classList.toggle('cant', !canAfford(res, def.levels[0].cost));
    }
  }
}
void fmt;

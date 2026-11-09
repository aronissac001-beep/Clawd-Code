// Info card: explains and controls whatever the player tapped or long-pressed.
import { el, tapButton, costHtml } from './dom.js';
import { icon } from './icons.js';
import { BUILDINGS, levelStats } from '../data/buildings.js';
import { UNITS } from '../data/units.js';
import { ENEMIES, AFFIXES } from '../data/enemies.js';
import { TER_NAMES, idx } from '../game/grid.js';
import { canAfford } from '../game/systems/common.js';
import { squadSize } from '../game/systems/buildings.js';
import { unitSprite } from '../engine/sprites.js';

const B_ICON = { house: 'house', farm: 'farm', lumber: 'axe', quarry: 'pick', wall: 'wall', gate: 'gate', tower: 'tower', brazier: 'brazier', barracks: 'barracks', hearth: 'flame' };

export class InfoCard {
  constructor(box, ctl) { this.box = box; this.ctl = ctl; this.kind = null; this.sig = ''; this.confirmDemolish = false; }
  get isOpen() { return !!this.kind; }
  open(kind, ref) { this.kind = kind; this.ref = ref; this.sig = ''; this.confirmDemolish = false; this.box.classList.remove('hidden'); this.update(this.ctl.s, true); }
  close() { this.kind = null; this.box.classList.add('hidden'); this.box.innerHTML = ''; }

  update(s, force) {
    if (!this.kind) return;
    let sig;
    if (this.kind === 'building') {
      const b = s.rt.bById.get(this.ref);
      if (!b) { this.close(); return; }
      sig = [b.level, b.built, b.upg, Math.round(b.hp / 5), Math.round((b.progress / b.need) * 20), b.wantW, b.train.length, b.train[0] ? Math.ceil(b.train[0].t) : 0, squadSize(s, b), this.workers(s, b), b.noRes, this.confirmDemolish, affordKey(s, b)].join('|');
    } else if (this.kind === 'unit' || this.kind === 'enemy') {
      const e = s.rt.eById.get(this.ref);
      if (!e || !e.alive) { this.close(); return; }
      sig = Math.round(e.hp);
    } else sig = 'static';
    if (!force && sig === this.sig) return;
    this.sig = sig;
    this.render(s);
  }

  workers(s, b) { let n = 0; for (const v of s.villagers) if (v.job === b.id) n++; return n; }

  render(s) {
    const box = this.box;
    box.innerHTML = '';
    const close = el('button', 'close', icon('x'));
    close.setAttribute('aria-label', 'Close');
    tapButton(close, () => this.ctl.closeCard());
    box.appendChild(close);
    switch (this.kind) {
      case 'building': this.renderBuilding(s, s.rt.bById.get(this.ref)); break;
      case 'buildtype': this.renderBuildType(s, this.ref); break;
      case 'unit': case 'enemy': this.renderEntity(s, s.rt.eById.get(this.ref)); break;
      case 'text': this.renderText(this.ref); break;
    }
  }

  renderText({ title, sub, text, ic }) {
    this.box.appendChild(el('h3', '', `${icon(ic || 'info')}<span></span>`)).querySelector('span').textContent = title;
    if (sub) this.box.appendChild(el('div', 'sub')).textContent = sub;
    for (const para of [].concat(text)) this.box.appendChild(el('p')).textContent = para;
  }

  renderBuildType(s, type) {
    const def = BUILDINGS[type];
    const st = def.levels[0];
    this.renderText({ title: def.name, sub: `${def.size}×${def.size} tiles · ${def.levels.length} levels`, text: def.desc, ic: B_ICON[type] });
    const stats = el('div', 'stats', statLines(type, st, s).map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join(''));
    this.box.appendChild(stats);
    this.box.appendChild(el('div', 'row', `<span>Cost:</span> ${costHtml(st.cost, s.res)}`));
    this.box.appendChild(el('p', '', 'Drag it from the bar onto the map, then tap the check mark.'));
  }

  renderBuilding(s, b) {
    const def = BUILDINGS[b.type];
    const st = levelStats(b.type, b.level);
    const box = this.box;
    const h = el('h3', '', `${icon(B_ICON[b.type])}<span></span>`);
    h.querySelector('span').textContent = `${def.name}${def.levels.length > 1 ? ' · Lv ' + (b.level + 1) : ''}`;
    box.appendChild(h);
    let status = 'Standing';
    if (!b.built) status = `Under construction · ${Math.floor((b.progress / b.need) * 100)}%`;
    else if (b.upg) status = `Upgrading · ${Math.floor((b.progress / b.need) * 100)}%`;
    else if (b.hp < b.maxHp) status = 'Damaged · builders repair by day';
    box.appendChild(el('div', 'sub')).textContent = status;
    box.appendChild(el('div', 'hpbar', `<i style="width:${Math.round((b.hp / b.maxHp) * 100)}%"></i>`));
    box.appendChild(el('p')).textContent = def.desc;
    if (b.noRes) box.appendChild(el('p', '', `<b style="color:var(--bad)">Nothing left to harvest in range. Build a new camp closer to ${def.needs === 'tree' ? 'trees' : 'rock'}, or explore.</b>`));
    box.appendChild(el('div', 'stats', [['Health', `${Math.ceil(b.hp)}/${b.maxHp}`], ...statLines(b.type, st, s)].map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')));
    if (st.workers && b.built) {
      const row = el('div', 'row');
      const minus = el('button', 'cbtn', icon('minus')); minus.setAttribute('aria-label', 'Fewer workers');
      const plus = el('button', 'cbtn', icon('plus')); plus.setAttribute('aria-label', 'More workers');
      tapButton(minus, () => this.ctl.cmd({ t: 'workers', id: b.id, d: -1 }));
      tapButton(plus, () => this.ctl.cmd({ t: 'workers', id: b.id, d: 1 }));
      const lbl = el('span', '', `<b>Workers ${this.workers(s, b)}</b> (want ${b.wantW}/${st.workers})`);
      row.append(minus, lbl, plus);
      box.appendChild(row);
    }
    if (b.type === 'barracks' && b.built) this.renderBarracks(s, b, st);
    const acts = el('div', 'row');
    const next = def.levels[b.level + 1];
    if (next && b.built && !b.upg) {
      const ok = canAfford(s.res, next.cost);
      const up = el('button', 'cbtn gold' + (ok ? '' : ' disabled'), `${icon('up')}<span>Upgrade</span> ${costHtml(next.cost, s.res)}`);
      tapButton(up, () => this.ctl.cmd({ t: 'upgrade', id: b.id }), { sound: null });
      acts.appendChild(up);
      const diff = levelDiff(b.type, st, next);
      if (diff) box.appendChild(el('p', '', `<small>Next level: ${diff}</small>`));
    }
    if (b.type !== 'hearth') {
      const dem = el('button', 'cbtn red', `${icon('trash')}<span>${this.confirmDemolish ? 'Tap again to demolish' : 'Demolish'}</span>`);
      tapButton(dem, () => {
        if (!this.confirmDemolish) { this.confirmDemolish = true; this.update(s, true); return; }
        this.ctl.cmd({ t: 'demolish', id: b.id }); this.ctl.closeCard();
      });
      acts.appendChild(dem);
    }
    box.appendChild(acts);
  }

  renderBarracks(s, b, st) {
    const n = squadSize(s, b);
    const q = b.train.length;
    this.box.appendChild(el('div', 'queue', `Squad: <b>${n}/${st.squadCap}</b>${q ? ` · training ${q} (next in ${Math.ceil(b.train[0].t)}s)` : ''}`));
    const list = el('div', 'unitrow');
    for (const type of ['militia', 'spearman', 'archer']) {
      const d = UNITS[type];
      const ok = canAfford(s.res, d.cost) && n + q < st.squadCap;
      const btn = el('button', 'cbtn unitbtn' + (ok ? '' : ' disabled'), `<canvas width="60" height="68"></canvas><span class="meta"><span>${d.name} ${costHtml(d.cost, s.res)}</span><small>Strong vs ${d.strong}</small></span>`);
      const g = btn.querySelector('canvas').getContext('2d');
      const sp = unitSprite(type, 0, false, 2, { field: s.heraldry.field, charge: s.heraldry.charge, second: s.heraldry.second });
      g.drawImage(sp.c, 4, 0, 52, 64);
      tapButton(btn, () => this.ctl.cmd({ t: 'train', id: b.id, u: type }), { sound: null });
      list.appendChild(btn);
    }
    this.box.appendChild(list);
  }

  renderEntity(s, e) {
    if (e.kind === 'enemy') {
      const d = ENEMIES[e.type];
      const a = e.affix ? AFFIXES[e.affix] : null;
      this.renderText({ title: (a ? a.name + ' ' : '') + d.name, sub: `The Hollow · ${d.tags.filter((t) => t !== 'hollow').join(', ')}`, text: [d.desc, a ? a.desc : null].filter(Boolean), ic: 'skull' });
      this.box.appendChild(el('div', 'hpbar', `<i style="width:${Math.round((e.hp / e.maxHp) * 100)}%;background:#c8506a"></i>`));
      this.box.appendChild(el('div', 'stats', [['Health', `${Math.ceil(e.hp)}/${e.maxHp}`], ['Damage', `${Math.round(d.dmg * e.dmgMult)} ${d.dmgType}`], ['Speed', d.speed * e.speedMult > 1.6 ? 'Fast' : d.speed < 1 ? 'Slow' : 'Steady'], ['Weak to', d.weak]].map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')));
      if (e.lit) this.box.appendChild(el('p', '', '<b style="color:#ffd27a">In the light: takes 25% more damage.</b>'));
    } else {
      const d = UNITS[e.type];
      this.renderText({ title: d.name, sub: d.role, text: d.desc, ic: e.kind === 'sovereign' ? 'crown' : e.kind === 'villager' ? 'pop' : 'sword' });
      this.box.appendChild(el('div', 'hpbar', `<i style="width:${Math.round((e.hp / e.maxHp) * 100)}%"></i>`));
      const rows = [['Health', `${Math.ceil(e.hp)}/${e.maxHp}`]];
      if (d.dmg) rows.push(['Damage', `${d.dmg} ${d.dmgType}`], ['Strong vs', d.strong], ['Weak vs', d.weak]);
      if (e.kind === 'villager') rows.push(['Doing', villagerDoing(s, e)]);
      this.box.appendChild(el('div', 'stats', rows.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')));
      if (e.kind !== 'villager') this.box.appendChild(el('p', '', 'Tap to select, then tap the ground to move or a foe to attack. Time slows while you give orders.'));
    }
  }
}

function villagerDoing(s, v) {
  const job = v.job ? s.rt.bById.get(v.job) : null;
  switch (v.st) {
    case 'toBuild': case 'building': return 'Building';
    case 'working': return 'Farming';
    case 'gather': return v.act === 'chop' ? 'Felling a tree' : 'Cutting stone';
    case 'return': return 'Hauling ' + (v.carryK || 'goods');
    case 'toWork': return job ? 'Heading to work' : 'Looking for work';
    case 'toShelter': return 'Seeking shelter';
    case 'wander': return 'Idle (build more workplaces)';
    default: return 'Idle';
  }
}

function affordKey(s, b) {
  const next = BUILDINGS[b.type].levels[b.level + 1];
  let k = next ? (canAfford(s.res, next.cost) ? 'u1' : 'u0') : '';
  if (b.type === 'barracks') for (const t of ['militia', 'spearman', 'archer']) k += canAfford(s.res, UNITS[t].cost) ? '1' : '0';
  return k;
}

function statLines(type, st, s) {
  const out = [];
  if (st.pop) out.push(['Population', '+' + st.pop]);
  if (st.gold) out.push(['Taxes', st.gold + ' gold/min']);
  if (st.shelter && type !== 'hearth') out.push(['Shelters', st.shelter + ' at night']);
  if (st.workers) out.push(['Workers', 'up to ' + st.workers]);
  if (type === 'farm') out.push(['Yield', Math.round(12 * st.yieldMult * (1 + s.mods.farmYield)) + ' food/min each']);
  if (st.radius) out.push(['Work range', st.radius + ' tiles']);
  if (st.attack) out.push(['Range', (st.attack.range + (type === 'tower' ? s.mods.towerRange : 0)) + ' tiles'], ['Damage', `${st.attack.dmg} ${st.attack.type}${st.attack.shots > 1 ? ' ×2' : ''}`]);
  if (type === 'brazier') out.push(['Light', (st.light + s.mods.lightRadius) + ' tiles']);
  if (st.burn) out.push(['Burns', `${st.burn.dps}/s near it`]);
  if (st.squadCap) out.push(['Squad size', st.squadCap]);
  return out;
}

function levelDiff(type, a, b) {
  const parts = [];
  const cmp = (label, x, y) => { if (x !== undefined && y !== undefined && x !== y) parts.push(`${label} ${x} → ${y}`); };
  cmp('health', a.hp, b.hp); cmp('pop', a.pop, b.pop); cmp('taxes', a.gold, b.gold); cmp('workers', a.workers, b.workers);
  cmp('range', a.radius, b.radius); cmp('light', a.light, b.light); cmp('squad', a.squadCap, b.squadCap);
  if (a.attack && b.attack) { cmp('range', a.attack.range, b.attack.range); cmp('damage', a.attack.dmg, b.attack.dmg); if ((b.attack.shots || 1) > (a.attack.shots || 1)) parts.push('fires twice'); }
  if (b.burn && !a.burn) parts.push('scorches nearby Hollow');
  if (b.trainSpeed) parts.push('trains faster');
  return parts.join(', ');
}
export { TER_NAMES, idx };

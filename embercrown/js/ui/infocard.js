// Info card: explains and controls whatever the player tapped or long-pressed. Building cards
// put actions first (one row of 56 px buttons under the title) with the description behind an
// "i"; landscape shows the card as a full-height left side sheet, portrait as a half-height
// bottom sheet (css/style.css).
import { el, tapButton, costHtml } from './dom.js';
import { icon } from './icons.js';
import { BUILDINGS, levelStats, trainsAt } from '../data/buildings.js';
import { UNITS } from '../data/units.js';
import { ENEMIES, AFFIXES } from '../data/enemies.js';
import { TER_NAMES, idx } from '../game/grid.js';
import { canAfford, costOf } from '../game/systems/common.js';
import { BUS, each } from '../game/hooks.js';
import { FACTIONS } from '../data/factions.js';
import { squadSize } from '../game/systems/buildings.js';
import { tradePrice } from '../game/sim.js';
import { BAL } from '../data/balance.js';
import { unitSprite } from '../engine/sprites.js';

const B_ICON = { house: 'house', farm: 'farm', lumber: 'axe', quarry: 'pick', wall: 'wall', gate: 'gate', tower: 'tower', brazier: 'brazier', barracks: 'barracks', hearth: 'flame', market: 'gold', granary: 'food', trap: 'wall', ballista: 'tower', spire: 'tower', cathedral: 'sun', hearttree: 'heart', runeforge: 'hammer', wardrum: 'sword', tavern: 'barracks',
  windmill: 'farm', fisher: 'food', mine: 'pick', temple: 'flame', library: 'book', alchemist: 'gold', obelisk: 'eye', sunspire: 'sun', worldforge: 'hammer', moonwell: 'moon',
  archery: 'tower', stable: 'barracks', siegeworks: 'hammer', bogshrine: 'moon', ossuary: 'skull' };

export class InfoCard {
  constructor(box, ctl) {
    this.box = box; this.ctl = ctl; this.kind = null; this.sig = ''; this.confirmDemolish = false; this.details = false;
    // Never rebuild the card under a finger: a button swapped between pointerdown and pointerup
    // would swallow the tap. A refresh that comes due meanwhile waits for the finger to lift.
    this.held = 0;
    box.addEventListener('pointerdown', () => { this.held++; }, true);
    const lift = () => { if (!this.held) return; this.held = 0; if (this.owed && this.kind) { this.owed = false; this.sig = ''; this.update(this.ctl.s, true); } };
    box.addEventListener('pointerup', () => setTimeout(lift, 0), true);
    box.addEventListener('pointercancel', () => setTimeout(lift, 0), true);
  }
  get isOpen() { return !!this.kind; }
  open(kind, ref) {
    if (this.kind !== kind || this.ref !== ref) this.details = false;
    this.kind = kind; this.ref = ref; this.sig = ''; this.confirmDemolish = false; this.held = 0;
    this.box.classList.remove('hidden'); this.box.classList.toggle('bcard', kind === 'building'); this.box.scrollTop = 0;
    this.update(this.ctl.s, true);
  }
  close() { this.kind = null; this.box.classList.add('hidden'); this.box.innerHTML = ''; this.held = 0; this.owed = false; }

  update(s, force) {
    if (!this.kind) return;
    let sig;
    if (this.kind === 'building') {
      const b = s.rt.bById.get(this.ref);
      if (!b) { this.close(); return; }
      // Plug-in sections refresh on a new day or a change in gold (never mid-tap on a timer).
      sig = [BUS.card.length ? `${s.cycle.night}|${s.cycle.phase}|${s.res.gold | 0}` : 0, b.type === 'hearth' ? JSON.stringify(s.trades || {}) + (s.res.gold | 0) : '', b.level, b.built, b.upg, Math.round(b.hp / 5), Math.round((b.progress / b.need) * 20), b.wantW, b.train.length, b.train[0] ? Math.ceil(b.train[0].t) : 0, squadSize(s, b), this.workers(s, b), b.noRes, this.confirmDemolish, this.details, affordKey(s, b)].join('|');
    } else if (this.kind === 'unit' || this.kind === 'enemy') {
      const e = s.rt.eById.get(this.ref);
      if (!e || !e.alive) { this.close(); return; }
      sig = Math.round(e.hp) + '|' + this.details;
    } else sig = 'static|' + this.details;
    if (!force && sig === this.sig) return;
    if (this.held) { this.owed = true; return; }
    this.sig = sig;
    const st = this.box.scrollTop;
    this.render(s);
    this.box.scrollTop = st;
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
    this.box.appendChild(el('div', 'row', `<span>Cost:</span> ${costHtml(costOf(s, type, 0), s.res)}`));
    this.box.appendChild(el('p', '', 'Drag it from the bar onto the map and let go to build.'));
  }

  /** The "i" button beside the title: description and numbers live behind it. */
  infoToggle() {
    const b = el('button', 'info-t' + (this.details ? ' on' : ''), icon('info'));
    b.setAttribute('aria-label', this.details ? 'Hide details' : 'Show details');
    tapButton(b, () => { this.details = !this.details; this.update(this.ctl.s, true); });
    return b;
  }

  // Actions first: the title, its state, then one row of big buttons (train, workers, upgrade,
  // trade). The description, numbers and demolish sit behind the "i".
  renderBuilding(s, b) {
    const def = BUILDINGS[b.type];
    const st = levelStats(b.type, b.level);
    const box = this.box;
    const h = el('h3', '', `${icon(B_ICON[b.type])}<span></span>`);
    h.querySelector('span').textContent = `${def.name}${def.levels.length > 1 ? ' · Lv ' + (b.level + 1) : ''}`;
    h.appendChild(this.infoToggle());
    box.appendChild(h);
    let status = `${Math.ceil(b.hp)}/${b.maxHp} health`;
    if (!b.built) status = `Under construction · ${Math.floor((b.progress / b.need) * 100)}%`;
    else if (b.upg) status = `Upgrading · ${Math.floor((b.progress / b.need) * 100)}%`;
    else if (b.hp < b.maxHp) status = `Damaged · ${Math.ceil(b.hp)}/${b.maxHp} · builders repair by day`;
    box.appendChild(el('div', 'sub')).textContent = status;
    box.appendChild(el('div', 'hpbar', `<i style="width:${Math.round((b.hp / b.maxHp) * 100)}%"></i>`));
    if (b.noRes) box.appendChild(el('p', 'warn', `Nothing left to harvest in range. Build a new camp closer to ${def.needs === 'tree' ? 'trees' : 'rock'}, or explore.`));
    const acts = el('div', 'acts');
    if (b.built && barracksUnits(s, b).length) this.trainButtons(s, b, st, acts);
    if (st.workers && b.built) {
      const grp = el('div', 'agrp workers');
      const minus = el('button', 'abtn sq', icon('minus')); minus.setAttribute('aria-label', 'Fewer workers');
      const plus = el('button', 'abtn sq', icon('plus')); plus.setAttribute('aria-label', 'More workers');
      tapButton(minus, () => this.ctl.cmd({ t: 'workers', id: b.id, d: -1 }));
      tapButton(plus, () => this.ctl.cmd({ t: 'workers', id: b.id, d: 1 }));
      const lbl = el('span', 'wlbl', `<b>${this.workers(s, b)}</b><small>of ${b.wantW}/${st.workers}</small>`);
      lbl.title = 'Workers: working / wanted / most';
      grp.append(minus, lbl, plus);
      acts.appendChild(grp);
    }
    const next = def.levels[b.level + 1];
    if (next && b.built && !b.upg) {
      const ncost = costOf(s, b.type, b.level + 1);
      const ok = canAfford(s.res, ncost);
      const up = el('button', 'abtn gold' + (ok ? '' : ' disabled'), `${icon('up')}<span class="am"><span>Upgrade</span><span class="costs">${costHtml(ncost, s.res)}</span></span>`);
      up.setAttribute('aria-label', 'Upgrade');
      tapButton(up, () => this.ctl.cmd({ t: 'upgrade', id: b.id }), { sound: null });
      acts.appendChild(up);
    }
    if (b.type === 'hearth') this.tradeButtons(s, acts);
    if (acts.children.length) box.appendChild(acts);
    if (b.built && barracksUnits(s, b).length) {
      const n = squadSize(s, b), q = b.train.length;
      box.appendChild(el('div', 'queue', `Squad <b>${n}/${st.squadCap || 6}</b>${q ? ` · training ${q}, next in ${Math.ceil(b.train[0].t)}s` : ''}`));
    }
    // Plug-in sections (faction, civic, military: support troops) stay in view.
    each(BUS.card, box, s, b, this.ctl);
    if (!this.details) return;
    const det = el('div', 'details');
    det.appendChild(el('p')).textContent = def.desc;
    det.appendChild(el('div', 'stats', [['Health', `${Math.ceil(b.hp)}/${b.maxHp}`], ...statLines(b.type, st, s)].map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')));
    if (next && b.built && !b.upg) {
      const diff = levelDiff(b.type, st, next);
      if (diff) det.appendChild(el('p', 'dim', `Next level: ${diff}`));
    }
    if (b.type !== 'hearth') {
      const dem = el('button', 'cbtn red', `${icon('trash')}<span>${this.confirmDemolish ? 'Tap again to demolish' : 'Demolish'}</span>`);
      tapButton(dem, () => {
        if (!this.confirmDemolish) { this.confirmDemolish = true; this.update(s, true); return; }
        this.ctl.cmd({ t: 'demolish', id: b.id }); this.ctl.closeCard();
      });
      det.appendChild(el('div', 'row')).appendChild(dem);
    }
    box.appendChild(det);
  }

  // Gold carried between regions buys raw materials here.
  tradeButtons(s, acts) {
    for (const k of ['wood', 'stone', 'food']) {
      const price = tradePrice(s, k);
      const b = el('button', 'abtn' + (s.res.gold >= price ? '' : ' disabled'), `<span style="color:var(--c-${k})">${icon(k)}</span><span class="am"><span>+${BAL.trade[k].amount} ${k}</span><span class="costline"><span style="color:var(--c-gold)">${icon('gold')}</span><span class="${s.res.gold >= price ? '' : 'miss'}">${price}</span></span></span>`);
      b.setAttribute('aria-label', `Buy ${BAL.trade[k].amount} ${k} for ${price} gold`);
      tapButton(b, () => this.ctl.cmd({ t: 'trade', k }), { sound: null });
      acts.appendChild(b);
    }
  }

  trainButtons(s, b, st, acts) {
    const n = squadSize(s, b);
    const q = b.train.length;
    for (const type of barracksUnits(s, b)) {
      const d = UNITS[type];
      const ok = canAfford(s.res, d.cost) && n + q < (st.squadCap || 6);
      const btn = el('button', 'abtn unitbtn' + (ok ? '' : ' disabled'), `<canvas width="60" height="68"></canvas><span class="am"><span>${d.name}</span><span class="costs">${costHtml(d.cost, s.res)}</span></span>`);
      btn.setAttribute('aria-label', `Train ${d.name}`);
      btn.title = `${d.name}: strong vs ${d.strong}`;
      const g = btn.querySelector('canvas').getContext('2d');
      const sp = unitSprite(type, 0, false, 2, { field: s.heraldry.field, charge: s.heraldry.charge, second: s.heraldry.second });
      g.drawImage(sp.c, 4, 0, 52, 64);
      tapButton(btn, () => this.ctl.cmd({ t: 'train', id: b.id, u: type }), { sound: null });
      acts.appendChild(btn);
    }
  }

  renderEntity(s, e) {
    if (e.kind === 'enemy') {
      const d = ENEMIES[e.type];
      const a = e.affix ? AFFIXES[e.affix] : null;
      this.renderText({ title: (a ? a.name + ' ' : '') + d.name, sub: `${d.tags.includes('hollow') ? 'The Hollow' : 'Wild beast'} · ${d.tags.filter((t) => t !== 'hollow').join(', ')}`, text: [d.desc, a ? a.desc : null].filter(Boolean), ic: 'skull' });
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
      if (e.kind !== 'villager') this.box.appendChild(el('p', '', 'Tap its portrait to select it. Then a tap on the ground moves it and a tap on a foe attacks; it stays selected.'));
    }
  }
}

// Base recruits plus the faction's unique unit, when its data is loaded.
export function barracksUnits(s, b) {
  const f = FACTIONS[s.faction];
  return trainsAt(b ? b.type : 'barracks', s.faction, f && f.unit && UNITS[f.unit] ? f.unit : null).filter((u) => UNITS[u]);
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
  for (const t of barracksUnits(s, b)) k += canAfford(s.res, UNITS[t].cost) ? '1' : '0';
  return k;
}

function statLines(type, st, s) {
  const out = [];
  if (st.pop) out.push(['Population', '+' + st.pop]);
  if (st.gold) out.push(['Taxes', st.gold + ' gold/min']);
  if (st.shelter && type !== 'hearth') out.push(['Shelters', st.shelter + ' at night']);
  if (st.workers) out.push(['Workers', 'up to ' + st.workers]);
  if (type === 'farm') out.push(['Yield', Math.round(12 * st.yieldMult * (1 + s.mods.farmYield)) + ' food/min each']);
  if (st.radius) out.push([BUILDINGS[type] && BUILDINGS[type].needs ? 'Work range' : 'Range', st.radius + ' tiles']);
  if (st.attack) out.push(['Range', (st.attack.range + (type === 'tower' || type === 'ballista' ? s.mods.towerRange : 0)) + ' tiles'], ['Damage', `${st.attack.dmg} ${st.attack.type}${st.attack.shots > 1 ? ' ×2' : ''}`]);
  if (st.attack && st.attack.chain) out.push(['Chains', `${st.attack.chain} foes`]);
  if (st.attack && st.attack.bonus && st.attack.bonus.armored) out.push(['Vs armor', `×${st.attack.bonus.armored}`]);
  if (type === 'market') out.push(['Income', `${st.goldBase} + ${st.goldPerHouse}/House per min`]);
  if (type === 'granary') out.push(['Farm bonus', `+${Math.round(st.farmBonus * 100)}%`], ['Upkeep', `-${Math.round(st.upkeepCut * 100)}%`]);
  if (type === 'trap') out.push(['Spikes', `${st.dps}/s`], ['Slows', `${Math.round(st.slow * 100)}%`]);
  if (type === 'brazier') out.push(['Light', Math.round((st.light + s.mods.lightRadius) * (s.mods.lightMult || 1) * 10) / 10 + ' tiles']);
  if (st.burn) out.push(['Burns', `${st.burn.dps}/s near it`]);
  if (st.squadCap) out.push(['Squad size', st.squadCap]);
  return out;
}

function levelDiff(type, a, b) {
  const parts = [];
  const cmp = (label, x, y) => { if (x !== undefined && y !== undefined && x !== y) parts.push(`${label} ${x} → ${y}`); };
  cmp('health', a.hp, b.hp); cmp('pop', a.pop, b.pop); cmp('taxes', a.gold, b.gold); cmp('workers', a.workers, b.workers);
  cmp('range', a.radius, b.radius); cmp('light', a.light, b.light); cmp('squad', a.squadCap, b.squadCap);
  cmp('per House', a.goldPerHouse, b.goldPerHouse); cmp('farm bonus', a.farmBonus, b.farmBonus); cmp('spikes', a.dps, b.dps);
  if (a.attack && b.attack) cmp('chains', a.attack.chain, b.attack.chain);
  if (a.attack && b.attack) { cmp('range', a.attack.range, b.attack.range); cmp('damage', a.attack.dmg, b.attack.dmg); if ((b.attack.shots || 1) > (a.attack.shots || 1)) parts.push('fires twice'); }
  if (b.burn && !a.burn) parts.push('scorches nearby Hollow');
  if (b.trainSpeed) parts.push('trains faster');
  return parts.join(', ');
}
export { TER_NAMES, idx };

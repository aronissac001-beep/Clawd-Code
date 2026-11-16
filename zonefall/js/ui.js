'use strict';
// ============================================================================
// ZONEFALL — DOM user interface: HUD, inventory/loot/stash, base menus,
// crafting, trader, deploy, build bar, summaries and main menu.
// ============================================================================

const UI = {
  modalOpen: false, liveModal: false, sel: null, other: null, stashFilter: 'all', baseTab: 'base',
  _ic: {},
  // pixel icon data-URLs (cached)
  ic(id) {
    if (this._ic[id]) return this._ic[id];
    let c = null; try { c = ART.icon ? ART.icon(id) : null; } catch (e) { }
    return (this._ic[id] = c ? c.toDataURL() : Icons.url(id));
  },
  ui(name) {
    const k = 'ui:' + name; if (this._ic[k]) return this._ic[k];
    let c = null; try { c = ART.uiIcon ? ART.uiIcon(name) : null; } catch (e) { }
    return (this._ic[k] = c ? c.toDataURL() : '');
  },
  spriteURL(name) {
    const k = 's:' + name; if (this._ic[k] !== undefined) return this._ic[k];
    const s = ART.get(name) || ART.get(name + '0'); return (this._ic[k] = s ? s.c.toDataURL() : '');
  },
  init() {
    const hud = $('#hud'); const I = n => `<img class="ic" src="${this.ui(n)}" alt="">`;
    hud.innerHTML = `
      <div id="h-status">
        <div class="bar hp">${I('heart')}<div class="tr"><i></i><b></b></div></div>
        <div class="bar rad">${I('rad')}<div class="tr"><i></i><b></b></div></div>
        <div class="bar sta"><div class="tr"><i></i></div></div>
        <div id="h-icons"></div>
      </div>
      <div id="h-center"><div id="h-phase"></div><div id="h-sub"></div><div id="h-tut"></div></div>
      <div id="h-top">
        <button class="hb" id="b-pause">${I('pause')}MENU</button>
        <button class="hb" id="b-map">${I('map')}MAP</button>
        <button class="hb" id="b-base">${I('base')}BASE</button>
        <button class="hb" id="b-buildt">${I('build')}BUILD</button>
        <button class="hb" id="b-deploy">${I('deploy')}DEPLOY</button>
        <button class="hb" id="b-bag">${I('bag')}BAG</button>
      </div>
      <div id="h-weapon"><img id="h-wicon" class="px" alt=""><div><div id="h-wname"></div><div id="h-ammo"></div></div></div>
      <div id="h-actions">
        <button class="ab" id="b-swap">${I('swap')}</button>
        <button class="ab" id="b-reload">${I('reload')}</button>
        <button class="ab" id="b-heal">${I('heal')}<span class="cnt" id="c-heal"></span></button>
        <button class="ab" id="b-interact">${I('hand')}<span class="lab"></span></button>
      </div>
      <button class="ab" id="b-nade" style="position:absolute;right:calc(76px + var(--sar));bottom:calc(72px + var(--sab));pointer-events:auto">${I('grenade')}<span class="cnt" id="c-nade"></span></button>
      <div id="h-prog"><i></i><b></b></div>`;
    Input.bindButton($('#b-interact'), 'interact');
    Input.bindButton($('#b-reload'), 'reload');
    Input.bindButton($('#b-swap'), 'swap');
    Input.bindButton($('#b-heal'), 'heal');
    Input.bindButton($('#b-nade'), 'grenade');
    const tapBtn = (id, fn) => { const el = $(id); const h = e => { e.preventDefault(); e.stopPropagation(); Sfx.unlock(); Sfx.ui(); fn(); }; el.addEventListener('touchend', h, { passive: false }); el.addEventListener('click', h); el.addEventListener('touchstart', e => { e.stopPropagation(); }, { passive: true }); };
    tapBtn('#b-bag', () => this.openInventory());
    tapBtn('#b-map', () => this.toggleMap());
    tapBtn('#b-base', () => this.openBaseMenu('base'));
    tapBtn('#b-buildt', () => this.toggleBuild());
    tapBtn('#b-deploy', () => this.openDeploy());
    tapBtn('#b-pause', () => this.openPause());
    $('#h-tut').addEventListener('click', e => { if (e.target.classList.contains('sk') && confirm('Skip the tutorial?')) Tut.finish(); });
    $('#h-tut').addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
    $('#modal').addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
  },
  updateTut() {
    const el = $('#h-tut'); if (!el) return; const txt = Tut.text();
    const key = txt + Game.mode; if (this._tutKey === key) return; this._tutKey = key;
    el.innerHTML = txt ? `<span class="n">${Tut.idx + 1}/${Tut.steps.length}</span><span>${txt}</span><span class="sk">skip</span>` : '';
  },
  costStr(cost) { return Object.entries(cost).map(([k, v]) => v + ' ' + ITEMS[k].name).join(', '); },
  fmtN(n) { return n >= 10000 ? (n / 1000).toFixed(0) + 'k' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); },

  // ---------------------------------------------------------------------------
  // TOASTS
  // ---------------------------------------------------------------------------
  toast(msg, cls = '') {
    const box = $('#toasts'); if (box.lastChild && box.lastChild.textContent === msg) return;
    const d = document.createElement('div'); d.className = 'toast ' + cls; d.textContent = msg; box.appendChild(d);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => d.classList.add('out'), 2200); setTimeout(() => d.remove(), 2700);
  },
  toastBig(title, sub) {
    const b = $('#bigtoast'); b.innerHTML = `<h1>${title}</h1><p>${sub || ''}</p>`; b.className = 'show';
    clearTimeout(this._bt); this._bt = setTimeout(() => b.className = '', 2300);
  },
  flash(col) { const f = $('#flash'); f.style.background = col; f.style.opacity = 0.7; setTimeout(() => f.style.opacity = 0, 80); },

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  setMode(mode) {
    $('#menu').classList.add('hidden'); $('#hud').classList.remove('hidden'); $('#toasts').innerHTML = '';
    const show = (id, v) => $(id).style.display = v ? '' : 'none';
    show('#b-map', mode === 'zone'); show('#b-base', mode !== 'zone'); show('#b-buildt', mode !== 'zone'); show('#b-deploy', mode === 'base');
    if (Game.buildMode && mode === 'zone') this.toggleBuild(false);
    document.body.dataset.mode = mode; document.body.classList.add('ingame'); this._tutKey = null;
  },
  updateHUD() {
    const p = Game.player; if (!p) return;
    const hp = $('.bar.hp .tr'), rad = $('.bar.rad'), sta = $('.bar.sta .tr');
    hp.firstElementChild.style.width = clamp(p.hp / p.maxhp * 100, 0, 100) + '%'; hp.lastElementChild.textContent = Math.ceil(Math.max(0, p.hp)) + ' / ' + p.maxhp;
    rad.style.display = p.rad > 1 ? '' : 'none'; const rt = rad.querySelector('.tr'); rt.firstElementChild.style.width = clamp(p.rad / 200 * 100, 0, 100) + '%'; rt.lastElementChild.textContent = 'RAD ' + Math.round(p.rad);
    sta.firstElementChild.style.width = p.stamina + '%';
    let icons = '';
    if (p.bleed) icons += '<span class="st bad">BLEEDING</span>';
    if (p.rad > 50) icons += '<span class="st rad">IRRADIATED</span>';
    if (p.stimT > 0) icons += '<span class="st good">STIM ' + Math.ceil(p.stimT) + '</span>';
    if (Game.zs && Game.zs.emission && Game.map.isIndoor(p.x, p.y)) icons += '<span class="st good">SHELTERED</span>';
    const hi = $('#h-icons'); if (hi._v !== icons) { hi.innerHTML = icons; hi._v = icons; }
    let phase = '', sub = '';
    if (Game.mode === 'base') { phase = 'DAY ' + Game.run.day; sub = 'Build · craft · deploy when ready'; }
    else if (Game.mode === 'zone') {
      const z = Game.zs; if (z) { phase = z.emission ? 'EMISSION' : fmtTime(z.time); sub = z.zone.name + (z.emission ? ' — get indoors or extract!' : ' · until the Emission'); $('#h-phase').classList.toggle('danger', z.emission || z.time < 60); }
    } else if (Game.mode === 'raid') {
      const rs = Game.rs; if (rs) {
        phase = 'NIGHT ' + Game.run.day; $('#h-phase').classList.remove('danger');
        const alive = Game.enemies.filter(e => !e.dead).length;
        sub = rs.t < 0 ? 'Raid in ' + Math.ceil(-rs.t) + 's — get ready!' : (rs.idx < rs.waves.length ? 'Next wave ' + Math.ceil(rs.waves[rs.idx].t - rs.t) + 's · ' : '') + alive + ' raiders';
      }
    }
    if (Game.mode !== 'zone') $('#h-phase').classList.remove('danger');
    $('#h-phase').textContent = phase; $('#h-sub').textContent = sub;
    this.updateTut();
    // weapon panel
    const it = Game.activeItem(); const wid = it ? it.id : null;
    if (this._wid !== wid) { this._wid = wid; $('#h-wicon').src = wid ? this.ic(wid) : this.ui('hand'); $('#h-wname').textContent = wid ? ITEMS[wid].name : 'Fists'; }
    let ammo;
    if (it && WEAPONS[it.id]) { const w = WEAPONS[it.id]; ammo = p.reloadT > 0 ? 'RELOADING' : `${it.m || 0}<small> / ${w.mag} · ${Game.countItem(Game.ammoFor(it))}${it.ammo === 'ap_ammo' ? ' AP' : ''}</small>`; }
    else ammo = '<small>melee</small>';
    const am = $('#h-ammo'); if (am._v !== ammo) { am.innerHTML = ammo; am._v = ammo; }
    // interact
    const ib = $('#b-interact'); const ia = Game.interact;
    if (ia && !Game.buildMode) { ib.style.display = ''; ib.querySelector('.lab').textContent = ia.label; ib.classList.toggle('hold', ia.kind === 'gather'); }
    else ib.style.display = 'none';
    const nades = Game.countItem('grenade'); $('#b-nade').style.display = nades && !Game.buildMode ? '' : 'none'; $('#c-nade').textContent = nades;
    const meds = ['bandage', 'medkit', 'stim', 'canned', 'antirad'].reduce((a, id) => a + Game.countItem(id), 0); $('#c-heal').textContent = meds; $('#c-heal').style.display = meds ? '' : 'none';
    $('#b-reload').style.display = it && WEAPONS[it.id] ? '' : 'none';
    // progress
    const pr = $('#h-prog'); let prog = null, lab = '';
    if (p.useT > 0) { prog = 1 - p.useT / p.useMax; lab = 'Using ' + ITEMS[p.useItem].name; }
    else if (p.reloadT > 0 && it && WEAPONS[it.id]) { prog = 1 - p.reloadT / WEAPONS[it.id].reload; lab = 'Reloading'; }
    else if (Game.zs && Game.zs.ex) { prog = Game.zs.exT / 6; lab = 'Extracting — ' + Game.zs.ex.name; }
    else if (p.dead && Game.mode === 'raid') { prog = 1 - p.respawnT / 9; lab = 'Respawning...'; }
    if (prog !== null) { pr.style.display = ''; pr.firstElementChild.style.width = clamp(prog * 100, 0, 100) + '%'; pr.lastElementChild.textContent = lab; } else pr.style.display = 'none';
  },
  guideText() {
    const run = Game.run; const live = Game.collectStructs();
    const has = t => live.some(s => s.type === t); const walls = live.filter(s => s.type.startsWith('wall') || s.type.startsWith('door')).length;
    const carry = id => Game.countItem(id) || Game.stashCount(id) || (Game.player.equip.melee && Game.player.equip.melee.id === id);
    if (walls < 6) return '▶ Tap BUILD and wall in your Cupboard (raiders come tonight)';
    if (!carry('hatchet') && !carry('salv_axe') && !carry('pickaxe')) return '▶ BASE → Craft a Stone Hatchet / Pickaxe for faster gathering';
    if (!has('furnace')) return '▶ Build a Furnace — smelt ore into metal';
    if (!has('workbench1')) return '▶ Build a Workbench T1 to unlock better gear';
    if (!has('campfire') && !has('floodlight')) return '▶ Build a Campfire — nights are dark';
    if (!live.some(s => STRUCTS[s.type].turret)) return '▶ A Shotgun Trap guards your door (needs Workbench T1)';
    return '▶ DEPLOY into the Zone for loot, or upgrade your walls';
  },

  // ---------------------------------------------------------------------------
  // MODAL FRAMEWORK
  // ---------------------------------------------------------------------------
  openModal(html, opts = {}) {
    const m = $('#modal'); m.innerHTML = `<div class="panel ${opts.cls || ''}">${html}</div>`; m.classList.remove('hidden');
    this.modalOpen = true; this.liveModal = Game.mode === 'zone' || Game.mode === 'raid';
    m.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => this.closeAll()));
    Input.move.id = null; Input.move.x = Input.move.y = 0; Input.aim.id = null; Input.aim.x = Input.aim.y = 0; Input.aim.mag = 0;
    return m;
  },
  closeAll() {
    $('#modal').classList.add('hidden'); $('#modal').innerHTML = ''; this.modalOpen = false; this.other = null; this.sel = null; this.onTick = null;
    $('#mapov').classList.add('hidden');
  },
  tick(dt) { if (this.onTick) this.onTick(dt); },
  slotHTML(it, key, extra = '') {
    if (!it) return `<div class="slot empty" data-k="${key}">${extra}</div>`;
    const d = ITEMS[it.id]; const n = it.n > 1 ? `<span class="n">${this.fmtN(it.n)}</span>` : '';
    const mag = WEAPONS[it.id] ? `<span class="n mag">${it.m || 0}</span>` : '';
    return `<div class="slot r-${d.rar || 'common'} ${this.selKey === key ? 'sel' : ''}" data-k="${key}"><img src="${this.ic(it.id)}" alt="">${n}${mag}</div>`;
  },

  // ---------------------------------------------------------------------------
  // INVENTORY  (with optional other panel: loot container or stash)
  // ---------------------------------------------------------------------------
  openInventory(other) {
    if (Game.buildMode) this.toggleBuild(false);
    this.other = other || null; this.selKey = null; this.renderInv();
    if (other && other.kind === 'loot') {
      const c = other.c; const def = CONTAINERS[c.type];
      this.onTick = dt => {
        if (!c.items) return;
        if (c.searched < c.items.length) {
          c.searchT = (c.searchT || 0) + dt;
          const per = def.search || 0.01;
          if (c.searchT >= per) { c.searchT = 0; c.searched++; Sfx.click(); this.renderInv(); }
        }
        if (dist(Game.player.x, Game.player.y, c.x, c.y) > 70 || Game.player.dead) this.closeAll();
      };
    } else this.onTick = () => { if (Game.player.dead) this.closeAll(); };
  },
  openLoot(c) {
    if (!c.items) c.items = rollLoot(c.loot);
    if (!CONTAINERS[c.type].search) c.searched = 99;
    Sfx.ui(); Game.makeNoise(c.x, c.y, 100);
    this.openInventory({ kind: 'loot', c });
  },
  renderInv() {
    const p = Game.player; const e = p.equip; const o = this.other;
    const eq = [['primary', 'Primary'], ['secondary', 'Sidearm'], ['melee', 'Melee/Tool'], ['armor', 'Body'], ['helmet', 'Head'], ['bag', 'Bag'], ['art1', 'Artifact'], ['art2', 'Artifact']];
    const eqHTML = eq.map(([k, l]) => `<div class="eqs"><label>${l}</label>${this.slotHTML(e[k], 'e:' + k)}</div>`).join('');
    const bagHTML = p.bag.map((it, i) => this.slotHTML(it, 'b:' + i)).join('');
    const pouchHTML = p.pouch.map((it, i) => this.slotHTML(it, 'p:' + i)).join('');
    let otherHTML = '';
    if (o && o.kind === 'loot') {
      const c = o.c; const items = c.items || [];
      const cells = items.map((it, i) => i < c.searched ? this.slotHTML(it, 'c:' + i) : `<div class="slot searching"><span class="spin"></span></div>`).join('');
      const empty = items.length === 0 ? '<p class="dim">Empty.</p>' : '';
      otherHTML = `<div class="col other"><h3>${c.name || CONTAINERS[c.type].name}<button class="mini" id="takeall">TAKE ALL</button></h3><div class="grid">${cells}</div>${empty}</div>`;
    } else if (o && o.kind === 'stash') {
      const filt = this.stashFilter; const cats = { all: null, res: ['res', 'comp'], gear: ['gun', 'melee', 'armor', 'helmet', 'bag', 'art'], use: ['ammo', 'med', 'throw'], other: ['val', 'key', 'bp'] };
      const ids = Object.keys(Game.run.stash).filter(id => Game.run.stash[id] > 0 && (!cats[filt] || cats[filt].includes(ITEMS[id].cat)));
      ids.sort((a, b) => ITEMS[a].cat.localeCompare(ITEMS[b].cat) || ITEMS[a].name.localeCompare(ITEMS[b].name));
      const tabs = Object.keys(cats).map(k => `<button class="tab ${filt === k ? 'on' : ''}" data-f="${k}">${{ all: 'All', res: 'Materials', gear: 'Gear', use: 'Ammo/Meds', other: 'Other' }[k]}</button>`).join('');
      otherHTML = `<div class="col other"><h3>Stash <button class="mini" id="stashall">STASH LOOT</button></h3><div class="tabs">${tabs}</div><div class="grid">${ids.map(id => this.slotHTML({ id, n: Game.run.stash[id] }, 's:' + id)).join('') || '<p class="dim">Nothing here.</p>'}</div></div>`;
    }
    const det = this.detailHTML();
    const title = o && o.kind === 'stash' ? 'LOADOUT & STASH' : o ? 'LOOTING' : 'INVENTORY';
    const html = `<div class="ph"><h2>${title}</h2><span class="stat">Armor ${Math.round(p.armorVal * 100)}% · Rad res ${Math.round(p.radProt * 100)}%</span><button class="x" data-close>✕</button></div>
      <div class="inv">
        <div class="col"><h3>Equipment</h3><div class="eqgrid">${eqHTML}</div><h3>Secure Pouch <small>(kept on death)</small></h3><div class="grid pouch">${pouchHTML}</div></div>
        <div class="col"><h3>Bag <small>${p.bag.filter(Boolean).length}/${p.bag.length}</small></h3><div class="grid">${bagHTML}</div><div id="det">${det}</div></div>
        ${otherHTML}
      </div>`;
    const keepScroll = $('#modal .panel') ? [...$('#modal').querySelectorAll('.grid')].map(g => g.scrollTop) : null;
    const m = this.modalOpen && $('#modal .panel.inv-panel') ? $('#modal') : this.openModal('', { cls: 'inv-panel' });
    m.querySelector('.panel').innerHTML = html;
    if (keepScroll) [...m.querySelectorAll('.grid')].forEach((g, i) => { if (keepScroll[i]) g.scrollTop = keepScroll[i]; });
    m.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => this.closeAll()));
    m.querySelectorAll('.slot[data-k]').forEach(s => s.addEventListener('click', () => this.onSlot(s.dataset.k)));
    m.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => this.doAct(b.dataset.act)));
    m.querySelectorAll('.tab[data-f]').forEach(b => b.addEventListener('click', () => { this.stashFilter = b.dataset.f; this.renderInv(); }));
    const ta = m.querySelector('#takeall'); if (ta) ta.addEventListener('click', () => this.takeAll());
    const sa = m.querySelector('#stashall'); if (sa) sa.addEventListener('click', () => { const n = Game.autoStash(); this.toast(n ? 'Stashed ' + n + ' items' : 'Nothing to stash'); this.renderInv(); });
  },
  getSel(key) {
    if (!key) return null; const p = Game.player; const [t, k] = key.split(':');
    if (t === 'e') return p.equip[k]; if (t === 'b') return p.bag[+k]; if (t === 'p') return p.pouch[+k];
    if (t === 'c') return this.other && this.other.c.items[+k]; if (t === 's') return Game.stashCount(k) ? { id: k, n: Game.stashCount(k) } : null;
  },
  onSlot(key) {
    const it = this.getSel(key); if (!it) { this.selKey = null; this.renderInv(); return; }
    // fast-path: tapping container items takes them
    if (key.startsWith('c:')) { this.takeFromContainer(+key.slice(2)); return; }
    this.selKey = this.selKey === key ? null : key; Sfx.ui(); this.renderInv();
  },
  detailHTML() {
    const it = this.getSel(this.selKey); if (!it) return '<p class="dim">Tap an item to see actions.</p>';
    const d = ITEMS[it.id]; const t = this.selKey[0]; const atBase = Game.map.kind === 'base';
    let info = '';
    if (WEAPONS[it.id]) { const w = WEAPONS[it.id]; info = `DMG ${w.dmg}${w.pellets ? '×' + w.pellets : ''} · ROF ${w.rof}/s · MAG ${w.mag} · PEN ${Math.round(w.pen * 100)} · ${ITEMS[w.ammo].name}`; }
    else if (MELEE[it.id]) { const w = MELEE[it.id]; info = `Melee DMG ${w.dmg} · Wood ×${w.wood} · Ore ×${w.ore}`; }
    else if (d.armor !== undefined || d.rad) info = `Armor ${Math.round((d.armor || 0) * 100)}%` + (d.rad ? ` · Rad protection ${Math.round(d.rad * 100)}%` : '') + (d.spd ? ` · Speed ×${d.spd}` : '');
    else if (d.slots) info = d.slots + ' slots';
    else if (d.use) info = [d.use.heal && 'Heals ' + d.use.heal, d.use.bleed && 'stops bleeding', d.use.rad && 'Radiation ' + d.use.rad, d.use.speed && 'Speed boost', d.use.regen && 'Regenerates'].filter(Boolean).join(' · ');
    else if (d.fx) info = d.desc;
    else if (d.teach) info = Game.run.known.includes(d.teach) ? 'Already known' : 'Learn to craft ' + ITEMS[RECIPE[d.teach].out].name;
    else if (d.cat === 'val') info = 'Valuable — sell to the Trader for ' + Math.round(d.val) + ' scrap';
    else if (d.cat === 'key') info = 'Opens a vault door of the same color';
    const acts = [];
    const gearSlot = this.gearSlotFor(it.id);
    if (t === 'b' || t === 'p') {
      if (d.use) acts.push(['use', 'Use']);
      if (gearSlot) acts.push(['equip', 'Equip']);
      if (d.teach && !Game.run.known.includes(d.teach)) acts.push(['learn', 'Learn']);
      if (this.other && this.other.kind === 'loot') acts.push(['put', 'Put in container']);
      if (atBase) acts.push(['store', 'Store in stash']);
      if (t === 'b') acts.push(['topouch', 'To pouch']); else acts.push(['tobag', 'To bag']);
      if (!atBase) acts.push(['drop', 'Drop']);
    } else if (t === 'e') {
      acts.push(['unequip', 'Unequip']); if (atBase) acts.push(['store', 'Store in stash']);
    } else if (t === 's') {
      if (gearSlot) acts.push(['sequip', 'Equip']);
      acts.push(['take1', 'Take 1']); if (it.n > 1) acts.push(['take10', 'Take 10'], ['takestack', 'Take stack']);
      if (d.teach && !Game.run.known.includes(d.teach)) acts.push(['slearn', 'Learn']);
    }
    return `<div class="detail"><div class="dh"><img class="px" src="${this.ic(it.id)}"><div><b class="c-${d.rar || 'common'}">${d.name}</b>${it.n > 1 ? ' ×' + it.n : ''}</div></div><p>${info}</p><div class="acts">${acts.map(([a, l]) => `<button data-act="${a}">${l}</button>`).join('')}</div></div>`;
  },
  gearSlotFor(id) {
    const c = ITEMS[id].cat; const p = Game.player;
    if (c === 'gun') return p.equip.primary && !p.equip.secondary ? 'secondary' : 'primary';
    if (c === 'melee') return 'melee'; if (c === 'armor') return 'armor'; if (c === 'helmet') return 'helmet'; if (c === 'bag') return 'bag';
    if (c === 'art') return !p.equip.art1 ? 'art1' : !p.equip.art2 ? 'art2' : 'art1';
    return null;
  },
  doAct(act) {
    const p = Game.player; const key = this.selKey; const it = this.getSel(key); if (!it) return;
    const [t, k] = key.split(':'); const src = t === 'b' ? p.bag : t === 'p' ? p.pouch : null; const idx = +k;
    const removeSrc = () => { if (src) src[idx] = null; else if (t === 'e') p.equip[k] = null; };
    const toBag = (item) => Game.addToBag({ ...item });
    switch (act) {
      case 'use': this.closeAll(); Game.useItem(it.id); return;
      case 'equip': {
        const slot = this.gearSlotFor(it.id); const old = p.equip[slot];
        p.equip[slot] = { ...it, n: 1 }; it.n -= 1; if (it.n <= 0) removeSrc();
        if (old) { if (Game.addToBag(old)) Game.dropOverflow(old); }
        if (ITEMS[it.id].cat === 'gun' && !p.equip[p.active]) p.active = slot;
        if (slot === 'primary' || slot === 'secondary') p.active = slot;
        Game.recalc(); Sfx.click(); break;
      }
      case 'unequip': {
        if (k === 'bag') { // move bag contents check
          const items = p.bag.filter(Boolean); if (items.length > 8) { this.toast('Empty your bag first (only 8 slots without a bag)', 'bad'); return; }
        }
        const left = toBag(it); if (left) { this.toast('No room in bag', 'bad'); return; }
        p.equip[k] = null; if (p.active === k) p.active = 'melee'; Game.recalc(); break;
      }
      case 'learn': case 'slearn': {
        const r = ITEMS[it.id].teach; Game.run.known.push(r);
        if (act === 'learn') { it.n--; if (it.n <= 0) removeSrc(); } else Game.stashTake(it.id, 1);
        this.toast('Learned: ' + ITEMS[RECIPE[r].out].name, 'good'); Sfx.win(); break;
      }
      case 'put': { const c = this.other.c; c.items.push({ ...it }); c.searched = Math.max(c.searched, c.items.length); removeSrc(); break; }
      case 'store': Game.stashAdd(it.id, it.n); removeSrc(); if (t === 'e') { if (p.active === k) p.active = 'melee'; Game.recalc(); } break;
      case 'topouch': { const left = Game.addToBag({ ...it }, p.pouch); if (left === it.n) { this.toast('Pouch is full', 'bad'); return; } if (left) it.n = left; else removeSrc(); break; }
      case 'tobag': { const left = Game.addToBag({ ...it }); if (left === it.n) { this.toast('Bag is full', 'bad'); return; } if (left) it.n = left; else removeSrc(); break; }
      case 'drop': Game.dropItems([{ ...it }]); removeSrc(); break;
      case 'take1': case 'take10': case 'takestack': {
        const n = act === 'take1' ? 1 : act === 'take10' ? 10 : Math.min(it.n, ITEMS[it.id].stack);
        const want = Math.min(n, it.n); const left = Game.addToBag({ id: it.id, n: want });
        if (left === want) { this.toast('Bag is full', 'bad'); return; }
        Game.stashTake(it.id, want - left); break;
      }
      case 'sequip': {
        const slot = this.gearSlotFor(it.id); const old = p.equip[slot];
        Game.stashTake(it.id, 1); p.equip[slot] = makeItem(it.id); if (WEAPONS[it.id]) p.equip[slot].m = 0;
        if (old) Game.stashAdd(old.id, 1);
        if (slot === 'primary' || slot === 'secondary') p.active = slot;
        Game.recalc(); Sfx.click(); break;
      }
    }
    if (!this.getSel(key)) this.selKey = null;
    this.renderInv();
  },
  takeFromContainer(i) {
    if (!this.other || !this.other.c) return;
    const c = this.other.c; const it = c.items[i]; if (!it) return;
    const left = Game.addToBag({ ...it });
    if (left === it.n) { this.toast('Bag is full', 'bad'); return; }
    Sfx.pickup();
    if (left) it.n = left; else { c.items.splice(i, 1); c.searched = Math.max(0, c.searched - 1); }
    this.renderInv();
  },
  takeAll() {
    if (!this.other || !this.other.c) return;
    const c = this.other.c; let full = false;
    for (let i = 0; i < Math.min(c.searched, c.items.length); i++) {
      const it = c.items[i]; const left = Game.addToBag({ ...it });
      if (left) { it.n = left; full = true; } else { c.items.splice(i, 1); c.searched--; i--; }
    }
    if (full) this.toast('Bag is full', 'bad'); else Sfx.pickup();
    this.renderInv();
  },

  // ---------------------------------------------------------------------------
  // BASE MENU
  // ---------------------------------------------------------------------------
  openBaseMenu(tab) {
    if (Game.map.kind !== 'base') return;
    if (Game.buildMode) this.toggleBuild(false);
    this.baseTab = tab || this.baseTab; this.renderBase();
  },
  renderBase() {
    const tabs = [['base', 'Base', null, 'base'], ['craft', 'Craft', null, 'craft'], ['smelt', 'Furnace', 'furnace', 'smelt'], ['research', 'Research', 'research', 'research'], ['recycle', 'Recycler', 'recycler', 'recycle'], ['trader', 'Trader', null, 'trade'], ['stash', 'Stash', null, 'stash']];
    const vis = tabs.filter(t => !t[2] || Game.hasStruct(t[2]));
    if (!vis.find(t => t[0] === this.baseTab)) this.baseTab = 'base';
    if (this.baseTab === 'stash') { this.openInventory({ kind: 'stash' }); return; }
    const body = this['tab_' + this.baseTab]();
    const res = ['wood', 'stone', 'metal', 'hqm', 'scrap', 'cloth', 'gunpowder'].map(id => `<span class="res"><img src="${this.ic(id)}">${this.fmtN(Game.stashCount(id))}</span>`).join('');
    const html = `<div class="ph"><h2>BASE · DAY ${Game.run.day}</h2><div class="resbar">${res}</div><button class="x" data-close>✕</button></div>
      <div class="tabs big">${vis.map(t => `<button class="tab ${this.baseTab === t[0] ? 'on' : ''}" data-t="${t[0]}"><img class="px" src="${this.ui(t[3])}" alt="">${t[1]}</button>`).join('')}</div>
      <div class="tabbody">${body}</div>`;
    const m = this.openModal(html, { cls: 'base-panel' });
    m.querySelectorAll('.tab[data-t]').forEach(b => b.addEventListener('click', () => { this.baseTab = b.dataset.t; Sfx.ui(); this.renderBase(); }));
    m.querySelectorAll('[data-do]').forEach(b => b.addEventListener('click', () => { this.baseAction(b.dataset.do, b.dataset.arg); }));
    const sc = this._scroll; if (sc) { const tb = m.querySelector('.tabbody'); tb.scrollTop = sc; this._scroll = 0; }
  },
  rerenderBase() { const tb = $('#modal .tabbody'); this._scroll = tb ? tb.scrollTop : 0; this.renderBase(); },
  tab_base() {
    const run = Game.run; const L = CORE_LEVELS[run.coreLvl], N = CORE_LEVELS[run.coreLvl + 1];
    const core = Game.map.struct.find(s => s && s.type === 'core');
    const st = run.stats;
    const dmg = Game.map.struct.filter(s => s && s.hp < s.maxhp).length;
    return `<div class="cards">
      <div class="card"><h4>Claim Cupboard · Level ${run.coreLvl + 1}</h4><p>HP ${Math.round(core.hp)} / ${Math.round(core.maxhp)} · Build radius ${L.r} tiles</p>
        ${N ? `<p class="dim">Next: radius ${N.r}, HP ${N.hp}<br>Cost: ${this.costStr(N.cost)}</p><button data-do="corelvl" ${Game.canAfford(N.cost) ? '' : 'disabled'}>Upgrade Cupboard</button>` : '<p class="good">Max level</p>'}</div>
      <div class="card"><h4>Repairs</h4><p>${dmg} damaged structures.</p><button data-do="repair" ${dmg ? '' : 'disabled'}>Repair All</button><button data-do="build">Build Mode</button></div>
      <div class="card"><h4>Expedition</h4><p>Head into the Zone for loot. You return at dusk — and the raiders come.</p><button class="primary" data-do="deploy">Deploy</button><button data-do="night">Stay & wait for night</button></div>
      <div class="card"><h4>Run stats</h4><p>Raids survived: ${st.raids}<br>Expeditions: ${st.exps} (${st.extracts} extracted, ${st.deaths} KIA)<br>Kills: ${Game.stats.kills}</p></div>
    </div>`;
  },
  tab_craft() {
    const wb = Game.wbTier(); let html = `<p class="dim">Workbench tier: <b>${wb}</b>. Crafted items go to your stash.</p>`;
    for (let tier = 0; tier <= 3; tier++) {
      const rs = RECIPES.filter(r => r.wb === tier);
      html += `<h4 class="tier">${tier === 0 ? 'Hand craft' : 'Workbench T' + tier}${tier > wb ? ' <span class="bad">(locked)</span>' : ''}</h4><div class="rlist">`;
      for (const r of rs) {
        const known = Game.run.known.includes(r.id); const ok = known && tier <= wb && Game.canAfford(r.cost);
        const d = ITEMS[r.out];
        html += `<div class="recipe ${known ? '' : 'unknown'}"><img src="${this.ic(r.out)}"><div class="rinfo"><b class="c-${d.rar || 'common'}">${d.name}${r.n > 1 ? ' ×' + r.n : ''}</b><small>${known ? this.costHTML(r.cost) : '<i>Blueprint required — find or research it</i>'}</small></div>
          ${known ? `<button data-do="craft" data-arg="${r.id}" ${ok ? '' : 'disabled'}>Craft</button><button class="x5" data-do="craft5" data-arg="${r.id}" ${ok && Game.canAfford(Object.fromEntries(Object.entries(r.cost).map(([k, v]) => [k, v * 5]))) ? '' : 'disabled'}>×5</button>` : ''}</div>`;
      }
      html += '</div>';
    }
    return html;
  },
  costHTML(cost) { return Object.entries(cost).map(([k, v]) => `<span class="${Game.stashCount(k) >= v ? '' : 'bad'}">${v} ${ITEMS[k].name}</span>`).join(' · '); },
  tab_smelt() {
    const ores = ['metal_ore', 'sulfur_ore', 'hqm_ore'].map(k => [k, Game.stashCount(k)]);
    const tot = ores.reduce((a, [, n]) => a + n, 0); const wood = Math.ceil(tot / 4);
    return `<div class="cards"><div class="card"><h4>Smelt ore</h4><p>${ores.map(([k, n]) => `${n} ${ITEMS[k].name}`).join('<br>')}</p><p class="dim">Uses ${wood} wood · produces charcoal</p>
      <button data-do="smelt" ${tot && Game.stashCount('wood') >= wood ? '' : 'disabled'}>Smelt All</button></div>
      <div class="card"><h4>Burn wood</h4><p>100 Wood → 75 Charcoal</p><button data-do="charcoal" ${Game.stashCount('wood') >= 100 ? '' : 'disabled'}>Burn 100</button><button data-do="charcoal5" ${Game.stashCount('wood') >= 500 ? '' : 'disabled'}>Burn 500</button></div>
      <div class="card"><h4>Tip</h4><p>Gunpowder = 30 Charcoal + 20 Sulfur (Craft tab). Ammo, grenades and landmines all need it.</p></div></div>`;
  },
  tab_research() {
    const ids = Object.keys(Game.run.stash).filter(id => RECIPE[id] && RECIPE[id].bp && !Game.run.known.includes(id) && Game.stashCount(id) > 0);
    const bps = Object.keys(Game.run.stash).filter(id => ITEMS[id].teach && !Game.run.known.includes(ITEMS[id].teach));
    let html = '<p class="dim">Research consumes one item and scrap to permanently learn its blueprint.</p><div class="rlist">';
    for (const id of ids) { const r = RECIPE[id]; const c = RESEARCH_COST[r.wb]; html += `<div class="recipe"><img src="${this.ic(id)}"><div class="rinfo"><b>${ITEMS[id].name}</b><small>${c} Scrap</small></div><button data-do="research" data-arg="${id}" ${Game.stashCount('scrap') >= c ? '' : 'disabled'}>Research</button></div>`; }
    for (const id of bps) html += `<div class="recipe"><img src="${this.ic(id)}"><div class="rinfo"><b>${ITEMS[id].name}</b><small>Blueprint in stash</small></div><button data-do="learn" data-arg="${id}">Learn</button></div>`;
    if (!ids.length && !bps.length) html += '<p class="dim">Nothing to research. Bring back weapons, armor or blueprints from the Zone.</p>';
    return html + '</div>';
  },
  tab_recycle() {
    const ids = Object.keys(Game.run.stash).filter(id => RECYCLE[id] && Game.stashCount(id) > 0);
    let html = '<p class="dim">Break items down into raw resources.</p><div class="rlist">';
    for (const id of ids) html += `<div class="recipe"><img src="${this.ic(id)}"><div class="rinfo"><b>${ITEMS[id].name} ×${Game.stashCount(id)}</b><small>→ ${this.costStr(RECYCLE[id])}</small></div><button data-do="recycle" data-arg="${id}">1</button><button data-do="recycleall" data-arg="${id}">All</button></div>`;
    if (!ids.length) html += '<p class="dim">Nothing recyclable in your stash.</p>';
    return html + '</div>';
  },
  tab_trader() {
    const stock = Game.run.trader || [];
    let html = `<p class="dim">"Scrap talks, stalker." Stock refreshes every dawn. You have <b>${Game.stashCount('scrap')}</b> scrap.</p><h4 class="tier">Buy</h4><div class="rlist">`;
    stock.forEach((s, i) => { html += `<div class="recipe ${s.sold ? 'unknown' : ''}"><img src="${this.ic(s.id)}"><div class="rinfo"><b class="c-${ITEMS[s.id].rar || 'common'}">${ITEMS[s.id].name}${s.n > 1 ? ' ×' + s.n : ''}</b><small>${s.price} Scrap</small></div><button data-do="buy" data-arg="${i}" ${!s.sold && Game.stashCount('scrap') >= s.price ? '' : 'disabled'}>${s.sold ? 'Sold' : 'Buy'}</button></div>`; });
    html += '</div><h4 class="tier">Sell</h4><div class="rlist">';
    const sell = Object.keys(Game.run.stash).filter(id => id !== 'scrap' && Game.stashCount(id) > 0 && this.sellPrice(id) >= 1 && ITEMS[id].cat !== 'res');
    sell.sort((a, b) => this.sellPrice(b) - this.sellPrice(a));
    for (const id of sell) html += `<div class="recipe"><img src="${this.ic(id)}"><div class="rinfo"><b class="c-${ITEMS[id].rar || 'common'}">${ITEMS[id].name} ×${Game.stashCount(id)}</b><small>${this.sellPrice(id)} Scrap each</small></div><button data-do="sell" data-arg="${id}">Sell 1</button><button data-do="sellall" data-arg="${id}">All</button></div>`;
    if (!sell.length) html += '<p class="dim">Nothing worth selling.</p>';
    return html + '</div>';
  },
  sellPrice(id) { const d = ITEMS[id]; return Math.floor(d.val * (d.cat === 'val' || d.cat === 'art' ? 1 : 0.5)); },
  baseAction(a, arg) {
    const G = Game;
    switch (a) {
      case 'corelvl': G.upgradeCore(); break;
      case 'repair': G.repairAll(); break;
      case 'build': this.closeAll(); this.toggleBuild(true); return;
      case 'deploy': this.openDeploy(); return;
      case 'night': this.closeAll(); G.skipToNight(); return;
      case 'craft': case 'craft5': {
        const r = RECIPE[arg]; const times = a === 'craft5' ? 5 : 1;
        for (let i = 0; i < times; i++) { if (!G.canAfford(r.cost)) break; G.pay(r.cost); G.stashAdd(r.out, r.n); }
        Sfx.build(); this.toast('Crafted ' + ITEMS[r.out].name + (times > 1 ? ' ×' + times : ''), 'good'); break;
      }
      case 'smelt': {
        let tot = 0; for (const [o, out] of [['metal_ore', 'metal'], ['sulfur_ore', 'sulfur'], ['hqm_ore', 'hqm']]) { const n = G.stashTake(o, 1e9); tot += n; if (n) G.stashAdd(out, n); }
        const w = G.stashTake('wood', Math.ceil(tot / 4)); G.stashAdd('charcoal', w); Sfx.build(); this.toast('Smelted ' + tot + ' ore', 'good'); break;
      }
      case 'charcoal': case 'charcoal5': { const n = a === 'charcoal' ? 100 : 500; G.stashTake('wood', n); G.stashAdd('charcoal', Math.floor(n * 0.75)); Sfx.build(); break; }
      case 'research': { const c = RESEARCH_COST[RECIPE[arg].wb]; G.stashTake('scrap', c); G.stashTake(arg, 1); G.run.known.push(arg); Sfx.win(); this.toast('Learned ' + ITEMS[arg].name, 'good'); break; }
      case 'learn': { G.stashTake(arg, 1); G.run.known.push(ITEMS[arg].teach); Sfx.win(); this.toast('Learned ' + ITEMS[RECIPE[ITEMS[arg].teach].out].name, 'good'); break; }
      case 'recycle': case 'recycleall': {
        const n = a === 'recycle' ? 1 : G.stashCount(arg); G.stashTake(arg, n);
        for (const k in RECYCLE[arg]) G.stashAdd(k, RECYCLE[arg][k] * n); Sfx.build(); break;
      }
      case 'buy': { const s = G.run.trader[+arg]; if (s.sold || G.stashCount('scrap') < s.price) return; G.stashTake('scrap', s.price); G.stashAdd(s.id, s.n); s.sold = true; Sfx.pickup(); this.toast('Bought ' + ITEMS[s.id].name, 'good'); break; }
      case 'sell': case 'sellall': { const n = a === 'sell' ? 1 : G.stashCount(arg); const pr = this.sellPrice(arg); G.stashTake(arg, n); G.stashAdd('scrap', pr * n); Sfx.pickup(); break; }
    }
    G.save(); this.rerenderBase();
  },

  // ---------------------------------------------------------------------------
  // DEPLOY
  // ---------------------------------------------------------------------------
  openDeploy() {
    if (Game.mode !== 'base') return;
    if (Game.buildMode) this.toggleBuild(false);
    const p = Game.player; const gun = p.equip.primary || p.equip.secondary;
    const warn = !gun ? '<p class="bad">You have no gun equipped! Open LOADOUT to grab gear from your stash.</p>' : '';
    const cards = ZONES.map(z => `<div class="zone t${z.tier}"><div class="zh"><b>${z.name}</b><span class="skulls">${'☠'.repeat(z.danger)}</span></div><p>${z.desc}</p><small>${fmtTime(z.time)} until Emission${z.vault ? ' · Vault: ' + ITEMS[z.vault.key].name : ''}${z.boss ? ' · Boss' : ''}</small><button class="primary" data-z="${z.id}">Deploy</button></div>`).join('');
    const html = `<div class="ph"><h2>CHOOSE A DESTINATION</h2><button class="x" data-close>✕</button></div>
      <p class="dim">Only what you carry goes with you. Die out there and you lose it all — except your secure pouch.</p>${warn}
      <div class="deploy-actions"><button data-do="loadout">Loadout & Stash</button><button data-do="night">Skip — wait for night here</button></div>
      <div class="zones">${cards}</div>`;
    const m = this.openModal(html, { cls: 'deploy-panel' });
    m.querySelectorAll('[data-z]').forEach(b => b.addEventListener('click', () => { this.closeAll(); Game.deploy(b.dataset.z); }));
    m.querySelector('[data-do="loadout"]').addEventListener('click', () => this.openInventory({ kind: 'stash' }));
    m.querySelector('[data-do="night"]').addEventListener('click', () => { this.closeAll(); Game.skipToNight(); });
  },

  // ---------------------------------------------------------------------------
  // BUILD BAR
  // ---------------------------------------------------------------------------
  toggleBuild(force) {
    const on = force !== undefined ? force : !Game.buildMode;
    if (on && Game.map.kind !== 'base') return;
    Game.buildMode = on; if (on) this.closeAll();
    $('#buildbar').classList.toggle('hidden', !on); document.body.classList.toggle('building', on);
    Input.move.id = Input.aim.id = null; Input.move.x = Input.move.y = Input.aim.x = Input.aim.y = 0; Input.pan = null;
    if (on) this.renderBuild();
    const h = $('#bb-hint'); h.classList.toggle('hidden', !on); h.textContent = Input.touchMode || !Input.mouse.used ? 'Drag on the ground to place · bottom-left thumb walks' : 'Click / drag to place · WASD walks';
  },
  renderBuild() {
    const wb = Game.wbTier();
    const tools = [['upgrade', 'Upgrade'], ['repair', 'Repair'], ['remove', 'Remove']];
    let html = `<div class="bb-head"><span id="bb-info"></span><button id="bb-exit">DONE</button></div><div class="bb-list">`;
    for (const [id, l] of tools) html += `<button class="bb ${Game.buildSel === id ? 'on' : ''}" data-b="${id}"><span class="bbic tool"><img src="${this.ui(id)}" alt=""></span><span class="bbn">${l}</span></button>`;
    for (const id of BUILD_ORDER) {
      const d = STRUCTS[id]; const locked = (d.wb || 0) > wb; const afford = Game.canAfford(d.cost);
      html += `<button class="bb ${Game.buildSel === id ? 'on' : ''} ${locked ? 'locked' : ''} ${afford ? '' : 'poor'}" data-b="${id}"><span class="bbic">${this.spriteURL('b_' + id) ? `<img src="${this.spriteURL('b_' + id)}" alt="">` : `<span style="width:24px;height:24px;background:${this.structCol(id)};display:block"></span>`}</span><span class="bbn">${d.name}</span><span class="bbc">${locked ? 'T' + d.wb : this.shortCost(d.cost)}</span></button>`;
    }
    html += '</div>';
    const bar = $('#buildbar'); bar.innerHTML = html;
    bar.querySelectorAll('[data-b]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); Game.buildSel = b.dataset.b; Sfx.ui(); this.renderBuild(); }));
    $('#bb-exit').addEventListener('click', e => { e.stopPropagation(); this.toggleBuild(false); });
    bar.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
    const sel = Game.buildSel; const d = STRUCTS[sel];
    $('#bb-info').innerHTML = d ? `<b>${d.name}</b> — ${d.desc} <i>${this.costStr(d.cost)}${d.wb ? ' · Workbench T' + d.wb : ''}</i>` : sel === 'upgrade' ? '<b>Upgrade</b> — tap a wall/door: wood → stone → metal → armored' : sel === 'repair' ? '<b>Repair</b> — tap a damaged structure' : '<b>Remove</b> — tap to demolish (50% refund)';
  },
  shortCost(c) { return Object.entries(c).map(([k, v]) => v + ({ wood: 'W', stone: 'S', metal: 'M', hqm: 'HQ', scrap: 'Sc', cloth: 'C', gunpowder: 'GP' }[k] || ITEMS[k].name.slice(0, 3))).join(' '); },
  structCol(id) { return { wall_wood: '#7a5530', wall_stone: '#7a7a76', wall_metal: '#6a7078', wall_armor: '#3e4650', door_wood: '#8a6038', door_metal: '#5a6068', embrasure: '#6e6e6a', spikes: '#5a4020', landmine: '#3a4030', shotgun_trap: '#6a5030', auto_turret: '#4a5058', campfire: '#d0702a', floodlight: '#e8d890', workbench1: '#7a5a3a', workbench2: '#5a6a7a', workbench3: '#4a3a6a', furnace: '#5a5a56', research: '#3a5a7a', recycler: '#4a6a4a', planter: '#4a7a2a', water: '#3a5a7a', bed: '#7a3a3a', quarry: '#5a5048' }[id] || '#666'; },

  // ---------------------------------------------------------------------------
  // MAP OVERLAY (zone)
  // ---------------------------------------------------------------------------
  toggleMap() {
    const ov = $('#mapov'); if (!ov.classList.contains('hidden')) { ov.classList.add('hidden'); return; }
    const m = Game.map; if (m.kind !== 'zone') return;
    const c = $('#mapc'); const S = Math.min(innerWidth, innerHeight) * 0.86; c.width = c.height = m.w * 4; c.style.width = c.style.height = S + 'px';
    const g = c.getContext('2d'); g.fillStyle = '#0c0d0f'; g.fillRect(0, 0, c.width, c.height);
    const col = { [T.GROUND]: '#3a4630', [T.WALL]: '#aaa', [T.WATER]: '#1e3a54', [T.FLOOR]: '#6a5a44', [T.FENCE]: '#888', [T.KEYDOOR]: '#f44', [T.ROAD]: '#555', [T.CONCRETE]: '#5a5a56' };
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) { if (!m.seen[m.idx(x, y)]) continue; g.fillStyle = col[m.tiles[m.idx(x, y)]]; g.fillRect(x * 4, y * 4, 4, 4); }
    for (const r of m.radZones) { g.fillStyle = 'rgba(160,220,40,.18)'; g.beginPath(); g.arc(r.x / 8, r.y / 8, r.r / 8, 0, 7); g.fill(); }
    for (const e of m.extracts) { g.fillStyle = '#5f5'; g.beginPath(); g.arc(e.x / 8, e.y / 8, 7, 0, 7); g.fill(); g.font = 'bold 11px sans-serif'; g.fillText(e.name, e.x / 8 + 9, e.y / 8 + 4); }
    const p = Game.player; g.fillStyle = '#fc4'; g.beginPath(); g.arc(p.x / 8, p.y / 8, 5, 0, 7); g.fill();
    g.strokeStyle = '#fc4'; g.beginPath(); g.moveTo(p.x / 8, p.y / 8); g.lineTo(p.x / 8 + Math.cos(p.ang) * 14, p.y / 8 + Math.sin(p.ang) * 14); g.stroke();
    ov.classList.remove('hidden');
  },

  // ---------------------------------------------------------------------------
  // SUMMARIES
  // ---------------------------------------------------------------------------
  showSummary(s, cb) {
    const html = `<div class="summary ${s.ok ? 'ok' : 'bad'}"><h1>${s.title}</h1><p>${s.sub}</p>
      <ul><li>Kills: ${s.kills}</li>${s.stashed ? `<li>${s.stashed} items moved to your stash</li>` : ''}${s.lost ? `<li class="bad">${s.lost} item stacks lost</li>` : ''}</ul>
      <p class="dim">Dusk is falling. Raiders have been spotted near your base. You have a moment to prepare.</p>
      <button class="primary" id="sumgo">Prepare for the raid</button></div>`;
    const m = this.openModal(html, { cls: 'sum-panel' });
    m.querySelector('#sumgo').addEventListener('click', () => { this.closeAll(); cb(); });
  },
  showDawn(s) {
    const lost = s.lost.length ? `<li class="bad">Lost: ${[...new Set(s.lost)].map(n => n + ' ×' + s.lost.filter(x => x === n).length).join(', ')}</li>` : '<li class="good">No structures lost</li>';
    const stolen = Object.keys(s.stolen).length ? `<li class="bad">Stolen: ${this.costStr(s.stolen)}</li>` : '';
    const prod = Object.keys(s.prod).length ? `<li class="good">Produced: ${this.costStr(s.prod)}</li>` : '';
    const html = `<div class="summary ok"><h1>DAWN</h1><p>You survived night ${s.day}.</p><ul><li>Raiders killed: ${s.kills}</li>${lost}${stolen}${prod}</ul>
      <p class="dim">${pick(TIPS)}</p><button class="primary" data-close>Day ${s.day + 1}</button></div>`;
    this.openModal(html, { cls: 'sum-panel' });
  },
  showGameOver(o) {
    $('#hud').classList.add('hidden'); this.toggleBuild(false);
    const html = `<div class="summary bad"><h1>BASE OVERRUN</h1><p>Your Claim Cupboard was destroyed on night ${o.day}.</p>
      <ul><li>Days survived: ${o.day - 1}</li><li>Raids repelled: ${o.raids}</li><li>Successful extractions: ${o.extracts}</li><li>Kills: ${o.kills}</li></ul>
      <p class="good">+${o.pts} Legacy points earned</p><button class="primary" id="goback">Main Menu</button></div>`;
    const m = this.openModal(html, { cls: 'sum-panel' });
    m.querySelector('#goback').addEventListener('click', () => { this.closeAll(); this.showMenu(); });
  },
  openPause() {
    const html = `<div class="ph"><h2>PAUSED</h2><button class="x" data-close>✕</button></div>
      <div class="menu-btns"><button class="primary" data-close>Resume</button><button id="p-snd">Sound: ${Sfx.enabled ? 'ON' : 'OFF'}</button><button id="p-help">How to play</button><button id="p-quit">Save & quit to menu</button><button id="p-abandon" class="danger">Abandon run</button></div>`;
    const prev = Game.paused; Game.paused = true;
    const m = this.openModal(html, { cls: 'pause-panel' });
    const close = () => { Game.paused = false; };
    m.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    m.querySelector('#p-snd').addEventListener('click', () => { Sfx.enabled = !Sfx.enabled; Game.meta.sound = Sfx.enabled; Save.writeMeta(Game.meta); m.querySelector('#p-snd').textContent = 'Sound: ' + (Sfx.enabled ? 'ON' : 'OFF'); if (!Sfx.enabled) Sfx.stopAmbient(); });
    m.querySelector('#p-help').addEventListener('click', () => { Game.paused = false; this.showHelp(() => this.openPause()); });
    m.querySelector('#p-quit').addEventListener('click', () => {
      Game.paused = false;
      if (Game.mode === 'zone') { if (!confirm('Quitting during an expedition loses the loot you found this trip (your loadout is kept). Quit?')) return; }
      else Game.save();
      this.closeAll(); this.showMenu();
    });
    m.querySelector('#p-abandon').addEventListener('click', () => { if (confirm('Abandon this run? Your base will be lost.')) { Game.paused = false; this.closeAll(); Game.gameOver(); } });
  },

  // ---------------------------------------------------------------------------
  // MAIN MENU / PERKS / HELP
  // ---------------------------------------------------------------------------
  showMenu() {
    Game.mode = 'menu'; Game.buildMode = false; Sfx.stopAmbient(); $('#buildbar').classList.add('hidden');
    $('#hud').classList.add('hidden'); const menu = $('#menu'); menu.classList.remove('hidden'); document.body.classList.remove('ingame');
    Game.menuScene(); $('#bb-hint').classList.add('hidden');
    const has = !!Save.load(); const meta = Game.meta;
    menu.innerHTML = `<div class="title"><h1>ZONE<span>FALL</span></h1><p>Loot the Zone. Build your base. Survive the night.</p></div>
      <div class="menu-btns">
        ${has ? '<button class="primary" id="m-cont">Continue</button>' : ''}
        <button class="${has ? '' : 'primary'}" id="m-new">New Run</button>
        <button id="m-perks">Legacy Perks <small>(${meta.points} pts)</small></button>
        <button id="m-help">How to Play</button>
      </div>
      <div class="menu-foot">Best: ${meta.best} days · Runs: ${meta.runs} · v${VERSION}<br><span id="m-install"></span></div>`;
    const go = (fn, hide) => () => { Sfx.unlock(); Sfx.ui(); if (hide) menu.classList.add('hidden'); fn(); };
    if (has) $('#m-cont').addEventListener('click', go(() => Game.continueRun(), true));
    $('#m-new').addEventListener('click', go(() => { if (has && !confirm('Start a new run? Your current base will be lost.')) { menu.classList.remove('hidden'); return; } Save.clear(); Game.stats.kills = 0; Game.newRun(); }, true));
    $('#m-perks').addEventListener('click', go(() => this.showPerks()));
    $('#m-help').addEventListener('click', go(() => this.showHelp(() => this.closeAll())));
    const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    if (!standalone && /iPhone|iPad|iPod/.test(navigator.userAgent)) $('#m-install').textContent = 'Tip: tap Share → Add to Home Screen to install as an app';
    else if (!standalone) $('#m-install').textContent = 'Play in landscape. Works offline once installed.';
    if (Game.run) Game.stats.kills = 0;
  },
  showPerks() {
    const meta = Game.meta;
    const html = `<div class="ph"><h2>LEGACY PERKS</h2><span class="stat">${meta.points} points</span><button class="x" data-close>✕</button></div>
      <p class="dim">Earn Legacy points when a run ends (days survived, extractions, kills). Perks apply to every future run.</p>
      <div class="rlist">${PERKS.map(p => { const own = meta.perks.includes(p.id); return `<div class="recipe ${own ? 'owned' : ''}"><div class="rinfo"><b>${p.name}</b><small>${p.desc}</small></div><button data-p="${p.id}" ${own || meta.points < p.cost ? 'disabled' : ''}>${own ? 'Owned' : p.cost + ' pts'}</button></div>`; }).join('')}</div>`;
    const m = this.openModal(html, { cls: 'perk-panel' });
    m.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => {
      const p = PERKS.find(x => x.id === b.dataset.p); if (meta.points < p.cost) return;
      meta.points -= p.cost; meta.perks.push(p.id); Save.writeMeta(meta); Sfx.win(); this.showPerks(); this.showMenu(); this.showPerks();
    }));
  },
  showHelp(back) {
    const html = `<div class="ph"><h2>HOW TO PLAY</h2><button class="x" id="h-back">✕</button></div><div class="help">
      <h4>The loop</h4><p><b>Day:</b> build and craft at your base, then <b>DEPLOY</b> into the Zone to loot. <b>Extract</b> (stand in a green exfil zone for 6s) before the <b>Emission</b> hits. <b>Night:</b> raiders attack your base. If your <b>Claim Cupboard</b> falls, the run ends.</p>
      <h4>Controls (touch)</h4><p><b>Left side:</b> drag to move (push to the edge to sprint).<br><b>Right side:</b> drag to aim — push further to fire. Light aim assist helps you.<br><b>Interact</b> button appears near loot, trees, rocks and doors. Hold it to gather.<br><b>R</b> reload · <b>⇄</b> swap weapon · <b>+</b> quick heal · <b>●</b> grenade.</p>
      <h4>Controls (keyboard)</h4><p>WASD move · mouse aim/fire · E interact (hold to gather) · R reload · Q swap · H heal · G grenade · I/Tab bag · B build · M map.</p>
      <h4>Building</h4><p>Tap BUILD, pick a piece, tap tiles inside your claim ring. Raiders path toward the Cupboard through the <b>weakest</b> route and chew through walls. Doors let you through but not them. Upgrade walls (wood → stone → metal → armored). Turrets use ammo from your stash.</p>
      <h4>The Zone</h4><p>Everything you carry is at risk. Die and you lose it all except your <b>secure pouch</b>. Watch for <b>radiation</b> (green haze, Geiger clicks), <b>anomalies</b> (shimmering distortions that hold artifacts), bleeding, and gunfire attracting enemies. Monuments hold keycard vaults — Green → Blue → Red.</p>
      <h4>Progress</h4><p>Smelt ore at a Furnace, craft at Workbenches, research blueprints, sell valuables to the Trader, and expand your Cupboard's claim radius.</p></div>`;
    const m = this.openModal(html, { cls: 'help-panel' });
    m.querySelector('#h-back').addEventListener('click', () => { this.closeAll(); if (back) back(); });
  },
  showGuide() {
    if (Game.run.tut !== 0) return;
    const html = `<div class="summary ok"><h1>WELCOME, STALKER</h1>
      <p>This clearing is yours. The glowing cabinet is your <b>Claim Cupboard</b> — the heart of your base. If raiders destroy it, the run is over.</p>
      <ul><li>☀ <b>Day:</b> gather, build and craft — then head into the Zone for loot.</li>
      <li>☢ <b>Zone:</b> loot fast, extract before the Emission. Die and you lose your gear.</li>
      <li>☾ <b>Night:</b> raiders attack your base. Hold the line.</li></ul>
      <p class="dim">Left thumb moves · right thumb aims (push further to fire). Follow the yellow hints at the top.</p>
      <button class="primary" data-close>Let's go</button></div>`;
    this.openModal(html, { cls: 'sum-panel' });
  },
};

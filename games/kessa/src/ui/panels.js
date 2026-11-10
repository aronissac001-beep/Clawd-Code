// ===== panels.js : bottom-sheet panels for building, info and colony management =====
const STATUS = { ok: ['Working', ''], site: ['Under construction', 'warn'], materials: ['Waiting for materials', 'warn'], broken: ['Broken down', 'bad'], off: ['Turned off', 'warn'], nopower: ['No power', 'bad'],
  nowater: ['No water', 'bad'], noair: ['Short of oxygen', 'bad'], leaking: ['Leaking air: needs upkeep', 'bad'], shiftoff: ['Off shift', 'warn'], noworkers: ['No workers', 'warn'], upkeep: ['Needs upkeep', 'warn'],
  depleted: ['Deposit exhausted', 'bad'], inputs: ['Missing inputs', 'warn'], full: ['Storage full', 'warn'] };
const SHIFTS = ['A 06–14', 'B 14–22', 'C 22–06 (night)'];
const kv = (k, v, cls) => h('div', { class: 'kv' }, h('span', null, k), h('span', { class: cls || '' }, v));
const barEl = (f, cls) => h('div', { class: 'bar ' + (cls || '') }, h('i', { style: 'width:' + Math.round(clamp(f, 0, 1) * 100) + '%' }));
const sec = t => h('div', { class: 'sec' }, t);
function statusChip(st) { const s = STATUS[st] || [st, 'warn']; return h('span', { class: 'st ' + s[1] }, s[0]); }
function dronesInRange(G, x, y) { let n = 0; for (const hb of KC.hubsOf(G)) if (KC.cheb(hb.x, hb.y, x, y) <= hb.r + 0.5) n += hb.n; return n; }

const Panels = {
  // ---------- build menu ----------
  build(cat) {
    const G = UI.G;
    Sheet.show({ tab: 'build', title: 'Build', tabs: ['infra', 'power', 'life', 'industry', 'science', 'domes', 'lines'].map(k => [k, CATS[k].icon + ' ' + CATS[k].name]), tabK: cat || this._buildCat || 'power',
      body: k => {
        this._buildCat = k;
        const grid = h('div', { class: 'grid2' });
        for (const [id, d] of Object.entries(BUILDINGS)) {
          if (d.cat !== k || d.unbuildable) continue;
          const lock = d.tech && !KC.techDone(G, d.tech), cost = d.line ? d.cost : KC.costOf(G, id), pre = G.prefabs[id] || 0;
          const card = h('button', { class: 'card btn' + (lock ? ' lock' : ''), 'data-build': id, onclick: () => { if (lock) { Sound.play('error'); HUD.toast('Needs research: ' + KC.TECHS[d.tech].name, 'warn'); return; } Sound.play('open'); UI.beginBuild(id); } },
            h('span', { class: 'art' }, iconCanvas(id, 44)), h('h5', null, d.name), pre ? h('span', { class: 'chip good' }, 'prefab ×' + pre) : null,
            lock ? h('p', null, '🔒 ' + KC.TECHS[d.tech].name) : d.line ? h('p', null, RES.metals.icon + ' ' + d.cost.metals + ' per tile') : costEl(G, cost),
            h('p', null, d.desc));
          grid.appendChild(card);
        }
        if (k === 'domes') return [grid, h('p', { class: 'small mut' }, 'Domes hold modules (homes, services, farms, labs). Select a finished dome to add modules.')];
        if (k === 'lines') return [grid, h('p', { class: 'small mut' }, 'Buildings that touch each other share power and life support. Use lines to reach buildings further away. To remove a line, tap its tile.')];
        return grid;
      } });
  },
  // ---------- one building ----------
  building(b) {
    const G = UI.G;
    if (b.mod) return this.module(b);
    Sheet.show({ title: () => BUILDINGS[b.t].name, live: true, body: () => this.buildingBody(b) });
  },
  buildingBody(b) {
    const G = UI.G, d = BUILDINGS[b.t], out = [];
    if (!KC.bById(G, b.id)) { Sheet.close(); return []; }
    const st = b._st || (b.built ? 'ok' : 'site');
    out.push(h('div', { class: 'row' }, statusChip(st), b.prefab && !b.built ? h('span', { class: 'chip good' }, 'prefab') : null, h('span', { class: 'grow' }), h('span', { class: 'small mut' }, '#' + b.id + ' at ' + b.x + ',' + b.y)));
    out.push(h('p', { class: 'small mut' }, d.desc));
    const c = KC.center(b);
    if (!b.built) {
      out.push(kv('Construction', Math.round(100 * b.prog / d.work) + '%')); out.push(barEl(b.prog / d.work, 'warn'));
      out.push(kv('Materials', b.paid ? 'delivered' : 'needs ' + costText(KC.costOf(G, b.t))));
      const dr = dronesInRange(G, c.x, c.y);
      out.push(kv('Drones in range', dr ? String(dr) : 'none: build a hub nearby or park a crawler', dr ? '' : 'bad'));
      out.push(this.prioRow(b));
      out.push(h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'danger grow', onclick: () => Modal.confirm('Cancel construction?', 'Materials already delivered are refunded.', () => { KC.demolish(G, b.id); Sheet.close(); R.sel = null; }) }, 'Cancel construction')));
      return out;
    }
    // production and use
    if (d.gen) out.push(kv('Power output', fmt(b._out || 0) + ' / h' + (d.gen.kind === 'solar' ? ' (sun and dust dependent)' : '')));
    if (d.make && d.make.power && !d.gen) out.push(kv('Power output', fmt(d.make.power) + ' / h'));
    if (d.use && d.use.power) out.push(kv('Power use', fmt(b._pd || d.use.power) + ' / h' + (b._idle ? ' (idle)' : b._pf < 0.99 ? ' · ' + Math.round(b._pf * 100) + '% supplied' : ''), b._pf < 0.99 && !b._idle ? 'bad' : ''));
    if (d.make && d.make.water) out.push(kv('Water output', fmt(b._out || 0) + ' / h'));
    if (d.make && d.make.oxygen) out.push(kv('Oxygen output', fmt(b._out || 0) + ' / h'));
    if (d.reclaim) out.push(kv('Water reclaimed', fmt(b._out || 0) + ' / h'));
    if (d.use && d.use.water && !d.dome) out.push(kv('Water use', fmt(d.use.water) + ' / h' + (b._wf < 0.99 ? ' · short' : ''), b._wf < 0.99 ? 'bad' : ''));
    if (d.prod) {
      const ins = d.prod.in ? Object.entries(d.prod.in).map(([k, v]) => RES[k].icon + ' ' + fmt(v)).join(' ') + ' → ' : '';
      out.push(kv('Recipe (full crew)', ins + Object.entries(d.prod.out).map(([k, v]) => RES[k].icon + ' ' + fmt(v * KC.prodMult(G, b))).join(' ') + ' / h'));
      out.push(kv('Output now', fmt(b._out || 0) + ' / h · efficiency ' + Math.round(100 * (b._act || 0)) + '%'));
    }
    if (d.research) out.push(kv('Research', fmt(b._out || 0) + ' / h'));
    if (d.assemble) { out.push(kv('Next drone', Math.round(100 * (b.asm || 0) / 24) + '% (needs 2 parts, 1 electronics)')); }
    if (d.deposit) { const dp = G.deposits[b.dep]; if (dp) out.push(kv(DEPOSITS[dp.type].name + ' left', fmt(dp.amount) + ' / ' + fmt(dp.max))); }
    if (d.battery) { out.push(kv('Charge', fmt(b.charge || 0) + ' / ' + fmt(b._cap || d.battery))); out.push(barEl((b.charge || 0) / (b._cap || d.battery))); }
    if (d.tank) { const k = d.tank.water ? 'water' : 'oxygen'; out.push(kv(RES[k].name + ' stored', fmt(b[k]) + ' / ' + d.tank[k])); out.push(barEl(b[k] / d.tank[k])); }
    if (d.storage) out.push(kv('Storage added', '+' + d.storage + ' of each material (total ' + KC.storageCap(G) + ')'));
    if (d.hub) {
      const cap = KC.hubCap(G, b);
      out.push(kv('Drones', b.drones + ' / ' + cap)); out.push(kv('Range', (d.hub.radius + KC.M(G, 'hubRange')) + ' tiles'));
      out.push(kv('Busy now', (b._dt || []).length + ' working'));
      const others = G.buildings.filter(x => x !== b && x.built && !x.mod && BUILDINGS[x.t].hub);
      if (others.length) {
        const rich = others.slice().sort((a, b2) => b2.drones - a.drones)[0], poor = others.slice().sort((a, b2) => a.drones - b2.drones)[0];
        out.push(h('div', { class: 'row', style: 'margin-top:6px' },
          h('button', { class: 'grow', disabled: !rich || rich.drones < 1 || b.drones >= cap, onclick: () => { KC.moveDrones(G, rich.id, b.id, 1); Sound.play('tap'); Sheet.render(); } }, '+1 drone from ' + BUILDINGS[rich.t].name),
          h('button', { class: 'grow', disabled: b.drones < 1, onclick: () => { KC.moveDrones(G, b.id, poor.id, 1); Sound.play('tap'); Sheet.render(); } }, 'Send 1 away')));
      }
    }
    if (d.dome) out.push(...this.domeBody(b));
    if (d.jobs) out.push(...this.jobsBody(b));
    if (d.maint) {
      const wc = b.wear >= 100 ? 'bad' : b.wear >= 65 ? 'warn' : '';
      out.push(sec('Upkeep'));
      out.push(kv('Wear', Math.round(b.wear) + ' / 150' + (b.wear >= 100 ? ' · efficiency 60%' : ''), wc)); out.push(barEl(b.wear / 150, wc || ''));
      out.push(kv('Drones service it with', '1 ' + RES[d.maint].name.toLowerCase() + ' (repairs take 2)'));
      if (b._need) out.push(h('p', { class: 'small bad' }, 'Waiting for ' + RES[b._need].name.toLowerCase() + ' to do upkeep.'));
      if (!dronesInRange(G, c.x, c.y) && b.t !== 'lander') out.push(h('p', { class: 'small bad' }, 'No drones in range: nobody can service this building.'));
    }
    if (b.t !== 'lander') {
      out.push(sec('Controls'));
      out.push(this.prioRow(b));
      out.push(h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'grow ' + (b.on ? 'on' : ''), onclick: () => { KC.setOn(G, b.id, !b.on); Sound.play('tap'); Sheet.render(); } }, b.on ? 'Turn off' : 'Turn on'),
        h('button', { class: 'danger grow', onclick: () => Modal.confirm('Demolish ' + d.name + '?', 'Drones salvage half of its materials.' + (d.dome ? ' Its modules are demolished too and residents move out.' : ''), () => { KC.demolish(G, b.id); Sheet.close(); R.sel = null; }, 'Demolish') }, 'Demolish')));
    }
    return out;
  },
  prioRow(b) {
    const G = UI.G;
    return h('div', { class: 'row' }, h('span', { class: 'mut small', style: 'width:64px' }, 'Priority'), h('div', { class: 'seg grow' }, ...['Low', 'Normal', 'High'].map((n, i) => h('button', { class: b.prio === i ? 'on' : '', onclick: () => { KC.setPrio(G, b.id, i); Sound.play('tap'); Sheet.render(); } }, n))));
  },
  jobsBody(b) {
    const G = UI.G, d = KC.def(b), out = [sec('Workers')];
    const slots = KC.staffSlots(G, d);
    if (d.spec) out.push(h('p', { class: 'small mut' }, SPECS[d.spec].icon + ' ' + SPECS[d.spec].name + 's work 25% better here.' + (d.auto ? ' Runs without a crew; a crew adds 50%.' : '')));
    if (!G.colonists.length) out.push(h('p', { class: 'small warnc' }, 'No colonists yet. Workers come from domes within walking range.'));
    for (let s = 0; s < 3; s++) {
      const ids = b.jobs[s] || [];
      out.push(h('div', { class: 'row', style: 'margin:6px 0' },
        h('button', { class: (b.shifts[s] ? 'on' : ''), style: 'min-width:120px', onclick: () => { KC.setShift(G, b.id, s, !b.shifts[s]); Sound.play('tap'); Sheet.render(); } }, (b.shifts[s] ? '● ' : '○ ') + SHIFTS[s]),
        h('span', { class: 'grow small' }, b.shifts[s] ? ids.length + ' / ' + slots + ' ' + ids.map(id => { const c = KC.cById(G, id); return c ? SPECS[c.spec].icon : ''; }).join('') : 'closed')));
    }
    out.push(h('p', { class: 'small mut' }, 'Night shift (C) costs workers sanity. Workers are reassigned every sol and when buildings change.'));
    return out;
  },
  domeBody(b) {
    const G = UI.G, out = [], I = (G._domes || KC.domeInfo(G)).get(b.id);
    const mods = KC.domeModules(G, b), slots = KC.domeSlots(G, b);
    out.push(kv('Residents', (I ? I.res.length : 0) + ' / ' + (I ? I.cap : 0) + ' homes'));
    out.push(kv('Life support', 'power ' + Math.round(100 * (b._pf || 0)) + '% · water ' + Math.round(100 * (b._wf === undefined ? 1 : b._wf)) + '% · oxygen ' + Math.round(100 * (b._of === undefined ? 1 : b._of)) + '%', (b._pf < 0.99 || b._wf < 0.99 || b._of < 0.99) ? 'bad' : 'good'));
    if (I && I.res.length) {
      const avg = k => Math.round(I.res.reduce((s, c) => s + c[k], 0) / I.res.length);
      out.push(kv('Average comfort / morale', avg('comfort') + ' / ' + avg('morale')));
      const sv = Object.keys(I.want).map(w => SERVICES[w].icon + ' ' + Math.round(100 * (I.sat[w] || 0)) + '%').join('  ');
      out.push(kv('Services wanted', sv || '-'));
    }
    out.push(sec('Modules (' + (slots - KC.domeFree(G, b)) + ' / ' + slots + ' slots)'));
    const grid = h('div', { class: 'slots' });
    for (const m of mods) {
      const md = MODULES[m.t];
      grid.appendChild(h('button', { class: 'slot full' + (m.built ? '' : ' wip'), style: md.slots > 1 ? 'grid-column: span 2' : '', onclick: () => { Sound.play('open'); Panels.module(m); } }, h('b', null, modIcon(m.t)), md.name, m.built ? null : h('span', { class: 'warnc' }, Math.round(100 * m.prog / md.work) + '%')));
    }
    for (let i = 0; i < KC.domeFree(G, b); i++) grid.appendChild(h('button', { class: 'slot', onclick: () => { Sound.play('open'); Panels.addModule(b); } }, h('b', null, '+'), 'Empty'));
    out.push(grid);
    if (!b.built) out.push(h('p', { class: 'small mut' }, 'Modules can be added once the dome is finished.'));
    out.push(h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'pri grow', disabled: !KC.domeFree(G, b), onclick: () => Panels.addModule(b) }, '+ Add module'), h('button', { class: 'grow', onclick: () => Panels.people('list', b.id) }, 'Residents')));
    return out;
  },
  addModule(dome) {
    const G = UI.G;
    Sheet.show({ title: 'Add module · ' + BUILDINGS[dome.t].name, live: false, body: () => {
      const list = h('div', { class: 'grid2' });
      for (const [id, d] of Object.entries(MODULES)) {
        const lock = d.tech && !KC.techDone(G, d.tech), ok = KC.canAddModule(G, dome.id, id), cost = KC.costOf(G, id, true);
        list.appendChild(h('button', { class: 'card btn' + (lock || !ok.ok ? ' lock' : ''), 'data-mod': id, onclick: () => {
          const r = KC.addModule(G, dome.id, id);
          if (r.err) { HUD.toast(r.err, 'warn'); Sound.play('error'); return; }
          Sound.play('place'); Panels.building(dome); Tips.check();
        } }, h('h5', null, modIcon(id) + ' ' + d.name), h('span', { class: 'chip' }, d.slots + ' slot' + (d.slots > 1 ? 's' : '')), lock ? h('p', null, '🔒 ' + KC.TECHS[d.tech].name) : costEl(G, cost), h('p', null, d.desc)));
      }
      return [h('p', { class: 'small mut' }, KC.domeFree(G, dome) + ' free slot(s). Drones in range build modules with materials from storage.'), list];
    }, head: () => [h('button', { onclick: () => Panels.building(dome) }, '◂ Dome')] });
  },
  module(m) {
    const G = UI.G, d = MODULES[m.t], dome = KC.bById(G, m.dome);
    Sheet.show({ title: () => modIcon(m.t) + ' ' + d.name, live: true, head: () => [h('button', { onclick: () => Panels.building(dome) }, '◂ Dome')], body: () => {
      if (!KC.bById(G, m.id)) { Panels.building(dome); return []; }
      const out = [h('div', { class: 'row' }, statusChip(m._st || (m.built ? 'ok' : 'site'))), h('p', { class: 'small mut' }, d.desc)];
      if (!m.built) { out.push(kv('Construction', Math.round(100 * m.prog / d.work) + '%')); out.push(barEl(m.prog / d.work, 'warn')); out.push(kv('Materials', m.paid ? 'delivered' : 'needs ' + costText(KC.costOf(G, m.t, true)))); }
      if (d.housing) out.push(kv('Homes', d.housing + ' · comfort ' + d.comfort));
      if (d.service) out.push(kv('Service', SERVICES[d.service.cat].icon + ' ' + SERVICES[d.service.cat].name + ' for ' + d.service.cap));
      if (d.prod) out.push(kv('Output now', fmt(m._out || 0) + ' / h (' + Object.entries(d.prod.out).map(([k, v]) => RES[k].icon + ' ' + v).join(' ') + ' at full crew)'));
      if (d.research) out.push(kv('Research now', fmt(m._out || 0) + ' / h'));
      if (d.use) out.push(kv('Uses', Object.entries(d.use).map(([k, v]) => RES[k].icon + ' ' + v + '/h').join('  ')));
      if (d.jobs && m.built) out.push(...this.jobsBody(m));
      out.push(sec('Controls')); out.push(this.prioRow(m));
      out.push(h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'grow ' + (m.on ? 'on' : ''), onclick: () => { KC.setOn(G, m.id, !m.on); Sheet.render(); } }, m.on ? 'Turn off' : 'Turn on'),
        h('button', { class: 'danger grow', onclick: () => Modal.confirm('Remove ' + d.name + '?', 'Half of its materials are salvaged.', () => { KC.demolish(G, m.id); Panels.building(dome); }, 'Remove') }, 'Remove')));
      return out;
    } });
  },
  // ---------- vehicles, anomalies, tiles, sectors ----------
  vehicle(id) {
    const G = UI.G;
    Sheet.show({ title: () => { const v = G.vehicles.find(x => x.id === id); return v ? VEHICLES[v.t].name : 'Vehicle'; }, live: true, body: () => {
      const v = G.vehicles.find(x => x.id === id); if (!v) return [];
      const V = VEHICLES[v.t], out = [h('p', { class: 'small mut' }, V.desc)];
      out.push(kv('Status', v.path.length ? 'Driving (' + v.path.length + ' tiles to go)' : v.task ? 'Investigating ' + Math.round(100 * v.prog / 6) + '%' : 'Parked'));
      if (v.t === 'crawler') {
        out.push(kv('Drones', v.drones + ' / ' + KC.hubCap(G, v))); out.push(kv('Works within', V.hub.radius + ' tiles while parked'));
        const L = G.buildings.find(b => b.t === 'lander'), near = KC.cheb(v.x, v.y, L.x + 1, L.y + 1) <= 6;
        out.push(h('div', { class: 'row' }, h('button', { class: 'grow', disabled: !near || L.drones < 1, onclick: () => { KC.moveDrones(G, L.id, v.id, 1); Sheet.render(); } }, '+1 drone from lander'), h('button', { class: 'grow', disabled: !near || v.drones < 1, onclick: () => { KC.moveDrones(G, v.id, L.id, 1); Sheet.render(); } }, 'Unload 1')));
        if (!near) out.push(h('p', { class: 'small mut' }, 'Drive within 6 tiles of the lander to load or unload drones.'));
      } else {
        const s = KC.sectorOf(Math.round(v.x), Math.round(v.y)), si = KC.sectorIndex(s.sx, s.sy);
        if (si >= 0 && !G.sectors[si].st && !v.path.length) out.push(kv('Surveying sector ' + KC.sectorName(si), Math.round(100 * G.sectors[si].p / KC.surveyCost(G, si)) + '%'));
        const an = G.anomalies.filter(a => !a.done && KC.scannedAt(G, a.x, a.y)).sort((a, b) => Math.hypot(a.x - v.x, a.y - v.y) - Math.hypot(b.x - v.x, b.y - v.y));
        out.push(sec('Known anomalies'));
        if (!an.length) out.push(h('p', { class: 'small mut' }, 'None. Survey more sectors (Layers → Survey) or park the Pathfinder in an unsurveyed sector.'));
        for (const a of an.slice(0, 6)) out.push(h('div', { class: 'list' }, h('div', { class: 'it' }, h('div', { class: 'grow' }, h('div', null, ANOMALIES[a.kind].name), h('div', { class: 'sub' }, Math.round(Math.hypot(a.x - v.x, a.y - v.y)) + ' tiles away')), h('button', { onclick: () => { const r = KC.sendToAnomaly(G, v.id, a.id); if (r.err) HUD.toast(r.err, 'warn'); else { Sound.play('place'); HUD.toast('Pathfinder on its way.', 'good'); } } }, 'Investigate'))));
      }
      out.push(h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'pri grow', onclick: () => { UI.mode = { k: 'move', vid: v.id }; Sheet.close(); R.sel = { k: 'v', id: v.id }; Place.render(); } }, 'Move…'), h('button', { class: 'grow', onclick: () => R.centerOn(v.x + 0.5, v.y + 0.5) }, 'Center')));
      return out;
    } });
  },
  anomaly(id) {
    const G = UI.G, a = G.anomalies.find(x => x.id === id); if (!a) return;
    Sheet.show({ title: ANOMALIES[a.kind].name, body: () => {
      const pf = G.vehicles.find(v => v.t === 'pathfinder');
      return [h('p', null, ANOMALIES[a.kind].desc), h('p', { class: 'small mut' }, 'A Pathfinder must drive here and spend 6 hours to investigate. Rewards range from research and supplies to breakthrough technologies.'),
        h('div', { class: 'row' }, h('button', { class: 'pri grow', disabled: !pf, onclick: () => { const r = KC.sendToAnomaly(G, pf.id, a.id); if (r.err) HUD.toast(r.err, 'warn'); else { HUD.toast('Pathfinder dispatched.', 'good'); Sound.play('place'); Sheet.close(); } } }, pf ? 'Send Pathfinder' : 'No Pathfinder (order one by rocket)'))];
    } });
  },
  tile(x, y) {
    const G = UI.G, T = G._T, i = y * MAP_N + x;
    Sheet.show({ title: 'Ground ' + x + ', ' + y, body: () => {
      const out = [];
      out.push(kv('Terrain', TERR[T.terr[i]])); out.push(kv('Slope', T.slope[i] > SLOPE_BUILD ? (T.slope[i] > SLOPE_LINE ? 'too steep for anything' : 'too steep to build, lines ok') : 'buildable', T.slope[i] > SLOPE_BUILD ? 'warnc' : 'good'));
      out.push(kv('Elevation', Math.round(T.h[i] * 1000) + ' m'));
      const s = KC.sectorOf(x, y), si = KC.sectorIndex(s.sx, s.sy);
      out.push(kv('Sector ' + KC.sectorName(si), G.sectors[si].st ? 'surveyed' : 'not surveyed', G.sectors[si].st ? '' : 'warnc'));
      const dp = KC.depAt(G, x, y);
      if (dp && KC.depKnown(G, dp)) { out.push(kv('Deposit', DEPOSITS[dp.type].name + ' · ' + fmt(dp.amount) + ' left')); out.push(h('p', { class: 'small mut' }, depositHint(dp.type))); }
      if (!G.sectors[si].st) out.push(h('button', { class: 'pri', onclick: () => Panels.sector(si) }, 'Survey this sector…'));
      for (const k of ['cable', 'pipe']) if (G[k][i]) out.push(h('div', { class: 'row', style: 'margin-top:8px' }, h('span', { class: 'grow' }, BUILDINGS[k].name + (G[k][i] === 2 ? (k === 'pipe' ? ' (leaking)' : ' (broken)') : G[k][i] === 3 ? ' (planned)' : '')), h('button', { class: 'danger', onclick: () => { KC.removeLine(G, k, x, y); Sound.play('tap'); Sheet.render(); } }, 'Remove')));
      const dr = dronesInRange(G, x + 0.5, y + 0.5); out.push(kv('Drones in range', String(dr), dr ? '' : 'mut'));
      return out;
    } });
  },
  sector(si) {
    const G = UI.G, s = G.sectors[si];
    Sheet.show({ title: 'Sector ' + KC.sectorName(si), live: true, body: () => {
      const out = [];
      if (s.st) { out.push(h('p', null, 'Surveyed.')); const k = MAP_N / SECTOR, x0 = (si % k) * SECTOR, y0 = ((si / k) | 0) * SECTOR; const deps = G.deposits.filter(d => d.x >= x0 && d.x < x0 + SECTOR && d.y >= y0 && d.y < y0 + SECTOR && KC.depKnown(G, d) && d.amount > 0); for (const d of deps) out.push(kv(DEPOSITS[d.type].name, fmt(d.amount))); if (!deps.length) out.push(h('p', { class: 'small mut' }, 'No deposits found.')); return out; }
      const q = G.survey.indexOf(si);
      out.push(kv('Survey work', Math.round(s.p) + ' / ' + KC.surveyCost(G, si)));
      out.push(kv('Queue', q < 0 ? 'not queued' : q === 0 ? 'surveying now' : 'position ' + (q + 1)));
      out.push(h('p', { class: 'small mut' }, 'Surveys reveal deposits and anomalies. Survey Masts and a parked Pathfinder speed them up; an orbital probe finishes one instantly.'));
      out.push(h('div', { class: 'row' }, q < 0 ? h('button', { class: 'pri grow', onclick: () => { KC.queueSurvey(G, si); Sound.play('place'); Sheet.render(); } }, 'Queue survey') : h('button', { class: 'grow', onclick: () => { G.survey.splice(G.survey.indexOf(si), 1); Sheet.render(); } }, 'Dequeue'),
        h('button', { class: 'grow', disabled: G.probes < 1, onclick: () => { KC.useProbe(G, si); Sound.play('good'); Sheet.render(); } }, 'Use probe (' + G.probes + ')')));
      return out;
    } });
  },
  resource(k) {
    const G = UI.G;
    const title = k === 'pop' ? 'Colonists' : RES[k].name;
    Sheet.show({ title, live: true, body: () => {
      const out = [], rate = (G.rate[k] || []).reduce((a, b) => a + b, 0), S = G.sol;
      if (k === 'pop') {
        const info = G._domes || KC.domeInfo(G), cap = [...info.values()].reduce((s, I) => s + I.cap, 0);
        out.push(kv('Colonists', G.colonists.length)); out.push(kv('Homes', cap)); out.push(kv('Working / adults', G.colonists.filter(c => c.job).length + ' / ' + G.colonists.filter(KC.canWork).length));
        out.push(kv('Births / deaths / left', G.st.births + ' / ' + G.st.deaths + ' / ' + G.st.left));
        out.push(h('button', { class: 'pri', onclick: () => Panels.people('list') }, 'Open colonist list'));
        return out;
      }
      if (RES[k].desc) out.push(h('p', { class: 'small mut' }, RES[k].desc));
      if (k === 'funds') { out.push(kv('Funding', fmt(G.funds))); out.push(kv('Sponsor stipend', Math.round((SPONSORS[G.cfg.sponsor].stipend + 1.5 * G.colonists.length) * DIFFICULTY[G.cfg.difficulty].funds * (1 + KC.M(G, 'funding'))) + ' per sol (includes 1.5 per colonist)')); out.push(kv('Earned from exports', fmt(G.st.exportFunds))); out.push(h('p', { class: 'small mut' }, 'Spend funding on rocket cargo and colonist arks. Rockets returning home sell rare metals and Kessite.')); return out; }
      if (k === 'rp') { out.push(kv('Research rate', fmt(G._rp || 0) + ' / h')); out.push(kv('Current', G.research.cur ? KC.TECHS[G.research.cur].name : 'nothing')); out.push(h('button', { class: 'pri', onclick: () => Panels.research() }, 'Open research')); return out; }
      if (k === 'power' || k === 'water' || k === 'oxygen') {
        const T = HUD.totals();
        if (k === 'power') { out.push(kv('Production now', fmt(T.power.prod) + ' / h')); out.push(kv('Demand now', fmt(T.power.dem) + ' / h')); out.push(kv('Battery', fmt(T.power.sto) + ' / ' + fmt(T.power.cap))); out.push(kv('Networks', String(G._pnets ? G._pnets.size : 0))); }
        else { out.push(kv('Stored in tanks', fmt(T[k].sto) + ' / ' + fmt(T[k].cap))); out.push(kv('Net, last 24h', fmtSigned(rate))); out.push(kv('Pipe networks', String(G._wnets ? G._wnets.size : 0))); }
        out.push(kv('Hours short this sol', String(S.short[k] || 0), S.short[k] ? 'bad' : ''));
        out.push(h('button', { onclick: () => { R.overlay = k === 'power' ? 'power' : 'life'; Sheet.close(); } }, 'Show ' + (k === 'power' ? 'power' : 'life support') + ' layer'));
        return out;
      }
      out.push(kv('In storage', fmt(G.res[k]) + ' / ' + KC.storageCap(G)));
      out.push(kv('Net, last 24h', fmtSigned(rate), rate < 0 ? 'bad' : 'good'));
      out.push(kv('Made this sol', fmt(S.prod[k] || 0))); out.push(kv('Used this sol', fmt(S.use[k] || 0)));
      out.push(kv('Construction reserve', String(G.reserve[k] || 0)));
      out.push(h('p', { class: 'small mut' }, 'Construction will not spend below the reserve, keeping it for upkeep. High-priority sites ignore it.'));
      if (G.reserve[k] !== undefined) out.push(h('div', { class: 'row' }, h('button', { class: 'grow', onclick: () => { G.reserve[k] = Math.max(0, G.reserve[k] - 5); Sheet.render(); } }, 'Reserve −5'), h('button', { class: 'grow', onclick: () => { G.reserve[k] += 5; Sheet.render(); } }, 'Reserve +5')));
      return out;
    } });
  },
  layers() {
    const G = UI.G;
    const L = [['none', 'Normal view', 'Just the colony.'], ['power', 'Power grid', 'Each power network in its own colour.'], ['life', 'Life support', 'Pipe networks carrying water and oxygen.'], ['drones', 'Drone coverage', 'Where hubs and parked crawlers can work.'], ['deposits', 'Deposits', 'Labels for every known deposit and what is left.'], ['survey', 'Survey sectors', 'Tap a sector on the map to queue a survey or use a probe.']];
    Sheet.show({ tab: 'layers', title: 'Layers', body: () => {
      const out = [h('div', { class: 'pick' }, ...L.map(([k, n, d]) => h('button', { class: R.overlay === k ? 'on' : '', 'data-layer': k, onclick: () => { R.overlay = k; Sound.play('tap'); Sheet.close(); HUD.toast(k === 'none' ? 'Normal view.' : n + ' layer on. Layers → Normal view to turn it off.', 'info'); } }, n, h('p', null, d))))];
      out.push(sec('Surveys'));
      out.push(kv('Orbital probes', String(G.probes)));
      out.push(kv('Queue', G.survey.length ? G.survey.map(KC.sectorName).join(', ') : 'empty'));
      out.push(kv('Sectors surveyed', G.sectors.filter(s => s.st).length + ' / ' + G.sectors.length));
      return out;
    } });
  },
};
function modIcon(t) { return { quarters: '⌂', apartments: '▥', suites: '❦', nursery: '✿', canteen: '🍲', lounge: '🍸', gym: '🏋', arboretum: '🌳', market: '🛍', arcade: '🎲', clinic: '✚', medcenter: '✚', school: '✎', security: '⛨', spa: '♨', hydro: '❀', vfarm: '❀', labmod: '⚛', workshop: '⚙' }[t] || '▣'; }
function depositHint(t) { return { metal: 'Build an Ore Extractor (or Auto-Extractor) on it.', ice: 'Build an Ice Drill on it.', rare: 'Build a Rare Ore Extractor on it.', crystal: 'Build a Kessite Harvester on it (research Kessite Resonance).', regolith: 'Build a Regolith Sinterer on it.', scrap: 'Drones in range collect it automatically.', bloom: 'Build a Bloom Garden on it (research Pale Bloom Domestication).' }[t] || ''; }

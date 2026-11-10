// ===== panels2.js : people, research, rockets, log, goals, game menu =====
Object.assign(Panels, {
  people(tab, domeId) {
    const G = UI.G;
    this._pf = this._pf || 'all';
    Sheet.show({ tab: 'people', title: 'People', tall: true, live: true, tabs: [['list', 'Colonists'], ['domes', 'Domes'], ['apply', 'Applicants']], tabK: tab || 'list', body: k => {
      if (k === 'domes') {
        const info = G._domes || KC.domeInfo(G), list = h('div', { class: 'list' });
        if (!info.size) return h('p', { class: 'mut' }, 'No domes yet. Build one from Build → Domes.');
        for (const I of info.values()) {
          const b = I.b, n = I.res.length, avg = k2 => n ? Math.round(I.res.reduce((s, c) => s + c[k2], 0) / n) : 0;
          list.appendChild(h('div', { class: 'it tap', onclick: () => { R.centerOn(b.x + b.s / 2, b.y + b.s / 2); R.sel = { k: 'b', id: b.id }; Panels.building(b); } },
            h('div', { class: 'grow' }, h('div', null, BUILDINGS[b.t].name + ' #' + b.id + (b.built ? '' : ' (building)')), h('div', { class: 'sub' }, n + '/' + I.cap + ' residents · comfort ' + avg('comfort') + ' · morale ' + avg('morale') + ' · ' + KC.domeModules(G, b).length + '/' + KC.domeSlots(G, b) + ' modules')),
            statusChip(b._st || 'ok')));
        }
        return list;
      }
      if (k === 'apply') return this.applicantsBody(false);
      const filters = [['all', 'All'], ['idle', 'Unemployed'], ['homeless', 'Homeless'], ['unhappy', 'Unhappy'], ['leaving', 'Leaving'], ['young', 'Children']];
      const pass = { all: () => true, idle: c => KC.canWork(c) && !c.job, homeless: c => c.homeless || !c.home, unhappy: c => c.morale < 40, leaving: c => c.leaving, young: c => KC.stage(c) === 'child' || KC.stage(c) === 'youth' };
      const out = [h('div', { class: 'tabs', style: 'padding:0 0 8px' }, ...filters.map(([f, n]) => h('button', { class: this._pf === f ? 'on' : '', onclick: () => { this._pf = f; Sheet.render(); } }, n + ' ' + G.colonists.filter(pass[f]).length)))];
      let cs = G.colonists.filter(pass[this._pf]); if (domeId) cs = cs.filter(c => c.home === domeId);
      if (!G.colonists.length) out.push(h('p', { class: 'mut' }, 'No colonists yet. Finish a dome with Living Quarters, power, water and oxygen, then order a colonist ark from Rockets.'));
      const list = h('div', { class: 'list' });
      for (const c of cs.slice(0, 150)) {
        const job = c.job ? KC.bById(G, c.job) : null;
        list.appendChild(h('div', { class: 'it tap', onclick: () => Panels.colonist(c.id) },
          h('div', { style: 'font-size:20px;width:26px;text-align:center;color:' + SPECS[c.spec].color }, SPECS[c.spec].icon),
          h('div', { class: 'grow' }, h('div', { class: 'ell' }, c.name + ' · ' + Math.floor(c.age)), h('div', { class: 'sub ell' }, (c.leaving ? 'leaving · ' : '') + (job ? KC.def(job).name + ' (' + 'ABC'[c.shift] + ')' : KC.canWork(c) ? 'unemployed' : KC.stage(c)) + (c.homeless ? ' · homeless' : ''))),
          h('div', { style: 'width:70px' }, barEl(c.morale / 100, c.morale < 35 ? 'bad' : c.morale < 55 ? 'warn' : ''), h('div', { class: 'sub', style: 'text-align:right' }, 'morale ' + Math.round(c.morale)))));
      }
      if (cs.length > 150) list.appendChild(h('p', { class: 'small mut' }, '…and ' + (cs.length - 150) + ' more'));
      out.push(list);
      return out;
    } });
  },
  colonist(id) {
    const G = UI.G, c = KC.cById(G, id); if (!c) return;
    const home = c.home ? KC.bById(G, c.home) : null, job = c.job ? KC.bById(G, c.job) : null;
    const need = (n, v) => h('div', null, h('div', { class: 'row small' }, h('span', { class: 'grow mut' }, n), h('span', null, Math.round(v))), barEl(v / 100, v < 30 ? 'bad' : v < 55 ? 'warn' : ''));
    Modal.show(c.name, [
      h('p', { class: 'small mut' }, (c.sex === 'f' ? 'She' : 'He') + ' is ' + Math.floor(c.age) + ' (' + KC.stage(c) + ')' + (c.born !== undefined ? ', born on Kessa on sol ' + KC.solOf(c.born) : ', arrived sol ' + KC.solOf(c.arrived || 0)) + '.'),
      kv('Specialization', SPECS[c.spec].icon + ' ' + SPECS[c.spec].name),
      kv('Home', home ? BUILDINGS[home.t].name + ' #' + home.id + (c.homeless ? ' (no bed)' : '') : 'none'),
      kv('Job', job ? KC.def(job).name + ', shift ' + 'ABC'[c.shift] : KC.canWork(c) ? 'unemployed' : '—'),
      kv('Wants', c.wants.map(w => SERVICES[w].icon + ' ' + SERVICES[w].name).join(', ')),
      h('div', { style: 'margin:8px 0' }, ...c.traits.map(t => h('span', { class: 'chip ' + (TRAITS[t].good ? 'good' : 'bad'), title: TRAITS[t].desc }, TRAITS[t].name))),
      ...c.traits.map(t => h('div', { class: 'small mut' }, TRAITS[t].name + ': ' + TRAITS[t].desc)),
      need('Health', c.health), need('Sanity', c.sanity), need('Comfort', c.comfort), need('Morale', c.morale),
      c.leaving ? h('p', { class: 'bad small' }, 'Homesick: will board the next rocket home unless morale recovers above 60.') : null,
      c.rest ? h('p', { class: 'warnc small' }, 'Recovering from a breakdown (' + c.rest + 'h).') : null,
    ], [['Close'], ['Show home', () => { if (home) { R.centerOn(home.x + home.s / 2, home.y + home.s / 2); R.sel = { k: 'b', id: home.id }; Panels.building(home); } }]]);
  },
  applicantsBody(pick) {
    const G = UI.G, o = UI.order, out = [];
    if (pick) out.push(h('div', { class: 'row', style: 'margin-bottom:6px' }, h('span', { class: 'grow small' }, o.ark.size + ' / ' + KC.arkSize(G) + ' selected · ark ' + KC.arkPrice(G) + ' ¤'), h('button', { onclick: () => { o.ark = new Set(bestApplicants(G).map(a => a.aid)); Sheet.render(); } }, 'Pick best'), h('button', { onclick: () => { o.ark.clear(); Sheet.render(); } }, 'Clear')));
    else out.push(h('p', { class: 'small mut' }, 'People at home waiting for a seat. Choose them in Rockets → Colonists. The pool changes every 5 sols.'));
    const list = h('div', { class: 'list' });
    for (const a of G.applicants) {
      const on = o && o.ark.has(a.aid);
      list.appendChild(h('div', { class: 'it' + (pick ? ' tap' : ''), onclick: pick ? () => { if (on) o.ark.delete(a.aid); else if (o.ark.size < KC.arkSize(G)) o.ark.add(a.aid); else { HUD.toast('The ark is full.', 'warn'); return; } Sound.play('tap'); Sheet.render(); } : null },
        pick ? h('div', { style: 'font-size:20px;width:24px' }, on ? '☑' : '☐') : null,
        h('div', { style: 'font-size:18px;width:22px;color:' + SPECS[a.spec].color }, SPECS[a.spec].icon),
        h('div', { class: 'grow' }, h('div', { class: 'ell' }, a.name + ' · ' + Math.floor(a.age) + ' · ' + SPECS[a.spec].name), h('div', null, ...a.traits.map(t => h('span', { class: 'chip ' + (TRAITS[t].good ? 'good' : 'bad') }, TRAITS[t].name))))));
    }
    out.push(list);
    return out;
  },
  research(field) {
    const G = UI.G;
    UI.techPip = false;
    const tabs = Object.keys(FIELDS).filter(f => f !== 'bt' || G.research.found.length).map(f => [f, FIELDS[f].icon + ' ' + FIELDS[f].name]);
    Sheet.show({ tab: 'research', title: 'Research', tall: true, live: true, tabs, tabK: field || this._rf || 'eng', head: () => [], body: k => {
      this._rf = k;
      const R2 = G.research, out = [];
      const cur = R2.cur ? KC.TECHS[R2.cur] : null;
      out.push(h('div', { class: 'card' }, h('h5', null, cur ? '⚛ ' + cur.name : 'Nothing being researched'), cur ? barEl((R2.prog[R2.cur] || 0) / KC.techCost(G, R2.cur)) : null,
        h('p', null, fmt(G._rp || 0) + ' research per hour' + (cur ? ' · ' + Math.ceil((KC.techCost(G, R2.cur) - (R2.prog[R2.cur] || 0)) / Math.max(0.1, G._rp || 1)) + ' h left' : '') + (R2.pool > 1 ? ' · ' + fmt(R2.pool) + ' banked' : '')),
        R2.queue.length ? h('p', null, 'Queue: ' + R2.queue.map(q => KC.TECHS[q].name).join(' → ')) : null,
        R2.queue.length ? h('button', { style: 'margin-top:6px', onclick: () => { R2.queue = []; Sheet.render(); } }, 'Clear queue') : null));
      out.push(h('div', { class: 'row', style: 'margin:6px 0' }, h('span', { class: 'grow small mut' }, 'Labs and scientists make research. Tap a tech to research it now; locked techs are queued with what they need. When idle, labs pick the cheapest tech.'), h('button', { class: G.autoResearch !== false ? 'on' : '', onclick: () => { G.autoResearch = G.autoResearch === false; Sheet.render(); } }, 'Auto ' + (G.autoResearch !== false ? 'on' : 'off'))));
      const list = Object.values(KC.TECHS).filter(t => t.field === k && !t.hidden && (!t.breakthrough || G.research.found.includes(t.id) || KC.techDone(G, t.id)));
      for (const t of list) {
        const done = KC.techDone(G, t.id), avail = KC.techAvailable(G, t.id), isCur = R2.cur === t.id, q = R2.queue.includes(t.id);
        const cls = 'tech' + (done ? ' done' : isCur ? ' cur' : q ? ' q' : !avail ? ' na' : '');
        const pr = R2.prog[t.id] || 0;
        out.push(h('button', { class: cls, 'data-tech': t.id, onclick: () => {
          if (done) return;
          if (avail) { KC.setResearch(G, t.id); Sound.play('tech'); } else if (KC.queueResearch(G, t.id)) { Sound.play('tap'); HUD.toast('Queued with prerequisites.', 'good'); }
          Sheet.render();
        } }, h('div', { class: 'row' }, h('b', { class: 'grow' }, (t.tier ? 'T' + t.tier + ' · ' : '') + t.name), h('span', { class: 'small' }, done ? '✓' : isCur ? Math.round(100 * pr / t.cost) + '%' : fmt(t.cost) + ' ⚛')),
          h('div', { class: 'small mut' }, t.desc + (!done && t.req.length && !avail ? ' · needs ' + t.req.filter(r => !KC.techDone(G, r)).map(r => KC.TECHS[r].name).join(', ') : '')),
          pr > 0 && !done && !isCur ? barEl(pr / t.cost) : null));
      }
      return out;
    } });
  },
  rockets(tab) {
    const G = UI.G;
    UI.order = UI.order || { cargo: {}, ark: new Set() };
    Sheet.show({ tab: 'rockets', title: 'Rockets', tall: true, live: true, tabs: [['fleet', 'Fleet'], ['cargo', 'Cargo'], ['ark', 'Colonists'], ['sponsor', 'Sponsor' + (G.contracts.offer ? ' •' : '')]], tabK: tab || this._rt || 'fleet', body: k => {
      this._rt = k;
      if (k === 'sponsor') return this.sponsorBody();
      const o = UI.order, out = [];
      const s = KC.orderSummary(G, o.cargo, [...o.ark]);
      const free = G.rockets.find(r => r.st === 'home');
      const summary = h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Order: ' + fmt(s.w || 0) + ' / ' + s.cap + ' cargo' + (o.ark.size ? ' + ' + o.ark.size + ' colonists' : '')), h('b', { class: (s.price > G.funds ? 'bad' : '') }, fmt(s.price || 0) + ' ¤')),
        barEl((s.w || 0) / s.cap, s.w > s.cap ? 'bad' : ''),
        h('p', null, 'Funding ' + fmt(G.funds) + ' · travel ' + KC.travelTime(G) + ' h · ' + (free ? 'rocket ' + free.id + ' ready' : 'no rocket free')),
        h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { class: 'grow', onclick: () => { o.cargo = {}; o.ark.clear(); Sheet.render(); } }, 'Clear'),
          h('button', { class: 'pri grow', 'data-launch': '1', disabled: !free, onclick: () => {
            const probs = o.ark.size ? KC.arkCheck(G, o.ark.size, (o.cargo.food || 0) * 20) : [];
            if (probs.length && !o.force) { Modal.show('Ready for ' + o.ark.size + ' more people?', [h('p', null, 'The colony may not support them yet:'), ...probs.map(p => h('p', { class: 'warnc' }, '• ' + p)), h('p', { class: 'small mut' }, 'They arrive in about ' + KC.travelTime(G) + ' hours. You can still fix things before then.')], [['Wait'], ['Launch anyway', () => { o.force = true; $('[data-launch]').click(); }, 'danger']]); return; }
            o.force = false;
            const r = KC.orderRocket(G, o.cargo, [...o.ark]);
            if (r.err) { HUD.toast(r.err, 'bad'); Sound.play('error'); return; }
            Sound.play('rocket'); HUD.toast('Rocket ' + r.rocket.id + ' launched. Arrival in ' + r.rocket.t + ' hours.', 'good'); o.cargo = {}; o.ark.clear(); this._rt = 'fleet'; Sheet.render(true);
          } }, 'Launch')));
      if (k === 'fleet') {
        const list = h('div', { class: 'list' });
        for (const r of G.rockets) {
          const txt = r.st === 'home' ? 'At home, ready to load' : r.st === 'out' ? 'Inbound to Kessa · ' + r.t + ' h' + (r.ark.length ? ' · ' + r.ark.length + ' colonists' : '') : r.st === 'landed' ? 'Landed, unloading · departs in ' + r.t + ' h' : 'Returning home · ' + r.t + ' h' + (r.exp ? ' · exports ' + r.exp.rare + ' rare, ' + r.exp.crystals + ' Kessite' : '');
          list.appendChild(h('div', { class: 'it' }, h('div', { style: 'font-size:22px' }, '🚀'), h('div', { class: 'grow' }, h('div', null, 'Rocket ' + r.id), h('div', { class: 'sub' }, txt))));
        }
        out.push(list);
        out.push(h('div', { class: 'row', style: 'margin-top:10px' }, h('span', { class: 'grow small' }, 'Export rare metals and Kessite on return trips (5 local fuel per trip, or the sponsor refuels and keeps 25%)'), h('button', { class: G.exportOn ? 'on' : '', onclick: () => { G.exportOn = !G.exportOn; Sheet.render(); } }, G.exportOn ? 'On' : 'Off')));
        out.push(kv('Sponsor', SPONSORS[G.cfg.sponsor].name)); out.push(kv('Rare metals / Kessite in stock', fmt(G.res.rare) + ' / ' + fmt(G.res.crystals)));
        out.push(h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'pri grow', onclick: () => { this._rt = 'cargo'; Sheet.render(true); } }, 'Order cargo'), h('button', { class: 'grow', onclick: () => { this._rt = 'ark'; Sheet.render(true); } }, 'Send colonists')));
        return out;
      }
      out.push(summary);
      if (k === 'cargo') {
        const list = h('div', { class: 'list' });
        for (const [id, c] of Object.entries(CARGO)) {
          if (!KC.cargoUnlocked(G, id)) continue;
          const n = o.cargo[id] || 0;
          list.appendChild(h('div', { class: 'it' }, h('div', { class: 'grow' }, h('div', null, c.name), h('div', { class: 'sub' }, KC.cargoPrice(G, id) + ' ¤ · weight ' + c.w + (c.give ? ' · have ' + fmt(G.res[Object.keys(c.give)[0]]) : ''))),
            h('button', { class: 'icon', disabled: !n, onclick: () => { o.cargo[id] = n - 1; Sheet.render(); } }, '−'), h('b', { style: 'width:26px;text-align:center' }, n), h('button', { class: 'icon', 'data-add': id, onclick: () => { o.cargo[id] = n + 1; Sound.play('tap'); Sheet.render(); } }, '+')));
        }
        out.push(list);
      } else {
        const why = KC.arkBlock(G); if (why) out.push(h('p', { class: 'warnc small' }, 'Not ready for colonists: ' + why));
        out.push(...this.applicantsBody(true));
      }
      return out;
    } });
  },
  log() {
    const G = UI.G;
    UI.logSeen = G.log.length;
    this._lf = this._lf || 'all';
    Sheet.show({ tab: 'log', title: 'Colony log', tall: true, live: true, tabs: [['all', 'All'], ['alerts', 'Alerts'], ['good', 'Good news']], tabK: this._lf, body: k => {
      this._lf = k; UI.logSeen = G.log.length;
      const list = h('div', { class: 'list' });
      const items = G.log.slice().reverse().filter(l => k === 'all' || (k === 'alerts' ? l.k === 'bad' || l.k === 'warn' : l.k === 'good'));
      for (const l of items.slice(0, 120)) list.appendChild(h('div', { class: 'it' + (l.x !== undefined ? ' tap' : ''), onclick: l.x !== undefined ? () => { R.centerOn(l.x + 0.5, l.y + 0.5); R.addAnim({ k: 'ping', x: l.x, y: l.y, dur: 1.6 }); Sheet.close(); } : null },
        h('div', { style: 'width:10px;height:10px;border-radius:50%;flex:0 0 10px;background:' + ({ bad: 'var(--bad)', warn: 'var(--warn)', good: 'var(--good)' }[l.k] || 'var(--acc2)') }),
        h('div', { class: 'grow' }, h('div', { class: 'small' }, l.m), h('div', { class: 'sub' }, KC.fmtTime(l.t) + (l.x !== undefined ? ' · tap to view' : '')))));
      if (!items.length) list.appendChild(h('p', { class: 'mut' }, 'Nothing yet.'));
      return list;
    } });
  },
  goals() {
    const G = UI.G;
    Sheet.show({ tab: 'goals', title: 'Goals', tall: true, live: true, body: () => {
      const out = [];
      out.push(h('div', { class: 'card' }, h('h5', null, '★ Independence'), h('p', null, 'Become a self-governing world: meet all four at once.'), ...KC.independence(G).map(c => h('div', null, h('div', { class: 'row small' }, h('span', { class: 'grow' }, (c.ok ? '✓ ' : '○ ') + c.name), h('span', null, Math.floor(c.have) + ' / ' + c.need)), barEl(c.have / c.need, c.ok ? '' : 'warn')))));
      out.push(kv('Score', String(KC.score(G))));
      const st = G.myst ? G.myst.stage : 0;
      out.push(h('div', { class: 'card', style: 'margin-top:8px' }, h('h5', null, '✸ The Choir of the Wardens' + (st >= 4 ? ' · solved' : '')), h('p', null, st === 0 ? 'Something about the basalt Wardens is odd. Investigate Wardens and repeating signals with the Pathfinder.' : KC.MYSTERY[Math.min(3, st - 1)]), h('p', null, ['', 'Next: research Warden Harmonics (Breakthroughs).', 'Next: send the Pathfinder to The Choir.', 'Next: build the Resonance Array (Science).', ''][st])));
      const DF = DIFFICULTY[G.cfg.difficulty];
      if (!G.st.everColonists) out.push(kv('Sponsor patience', 'colonists needed by sol ' + DF.patience, KC.solOf(G.tick) > DF.patience - 12 ? 'bad' : 'warnc'));
      out.push(sec('History'));
      const cv = h('canvas', { width: 700, height: 220, style: 'width:100%;height:110px;background:#1b1411;border-radius:10px' });
      drawHistory(cv, G); out.push(cv);
      out.push(h('div', { class: 'small mut' }, h('span', { style: 'color:#8fdc8a' }, '— colonists  '), h('span', { style: 'color:#b48cff' }, '— research per sol  '), h('span', { style: 'color:#f6e27a' }, '— funding'), ' (each scaled to its peak)'));
      out.push(sec('Milestones'));
      const list = h('div', { class: 'list' });
      for (const [k, m] of Object.entries(KC.MILESTONES)) list.appendChild(h('div', { class: 'it' }, h('div', { style: 'font-size:18px;width:22px' }, G.ms[k] ? '✓' : '○'), h('div', { class: 'grow' }, h('div', { class: G.ms[k] ? 'good' : '' }, m.name), h('div', { class: 'sub' }, m.desc + (m.grant ? ' · grant ' + m.grant : ''))), h('span', { class: 'small mut' }, G.ms[k] ? 'sol ' + G.ms[k] : '')));
      out.push(list);
      out.push(sec('Statistics'));
      out.push(kv('Births / deaths', G.st.births + ' / ' + G.st.deaths)); out.push(kv('Arrived / left', G.st.arrived + ' / ' + G.st.left)); out.push(kv('Anomalies investigated', String(G.st.anomalies)));
      out.push(kv('Disasters weathered', String(G.hz.n))); out.push(kv('Export income', fmt(G.st.exportFunds)));
      out.push(kv('Colony', SPONSORS[G.cfg.sponsor].name + ' · ' + COMMANDERS[G.cfg.commander].name + ' · ' + DF.name));
      return out;
    } });
  },
  advice() {
    const G = UI.G;
    Sheet.show({ title: '💡 Advisor', live: true, body: () => {
      const items = KC.advice(G), out = [h('p', { class: 'small mut' }, 'What needs attention now, worst first, with a shortcut for each.')];
      const col = { bad: 'var(--bad)', warn: 'var(--warn)', info: 'var(--acc2)' };
      for (const a of items) {
        const acts = [];
        if (a.at) acts.push(h('button', { onclick: () => { R.centerOn(a.at.x, a.at.y); R.addAnim({ k: 'ping', x: Math.floor(a.at.x), y: Math.floor(a.at.y), dur: 1.6 }); Sheet.close(); } }, 'Show'));
        const act = a.act;
        if (act && act.k === 'build' && BUILDINGS[act.type] && KC.unlocked(G, act.type)) acts.push(h('button', { class: 'pri', 'data-advbuild': act.type, onclick: () => { Sound.play('open'); UI.beginBuild(act.type); } }, 'Build ' + BUILDINGS[act.type].name));
        if (act && act.k === 'crawler') acts.push(h('button', { class: 'pri', onclick: () => { const r = KC.sendCrawler(G, act.id); if (r.err) HUD.toast(r.err, 'warn'); else { HUD.toast('The Drone Crawler is on its way (' + r.len + ' tiles).', 'good'); Sound.play('place'); } Sheet.render(); } }, 'Send Crawler'));
        if (act && act.k === 'module') acts.push(h('button', { class: 'pri', onclick: () => { const r = KC.addModule(G, act.dome, act.type); if (r.err) HUD.toast(r.err, 'warn'); else { Sound.play('place'); HUD.toast(MODULES[act.type].name + ' added to the dome.', 'good'); } Sheet.render(); } }, 'Add ' + MODULES[act.type].name));
        if (act && act.k === 'connect') acts.push(h('button', { class: 'pri', onclick: () => { const r = KC.autoConnect(G, act.id); if (r.err) HUD.toast(r.err, 'warn'); else { HUD.toast('Lines planned: ' + r.tiles + ' tiles. Drones will build them.', 'good'); Sound.play('place'); } Sheet.render(); } }, 'Connect to grid'));
        if (act && act.k === 'tab') acts.push(h('button', { onclick: () => ({ rockets: () => Panels.rockets(act.tab === 'rockets' && (G.contracts.offer || G.contracts.active) ? 'sponsor' : undefined), people: () => Panels.people(), research: () => Panels.research(), goals: () => Panels.goals() })[act.tab]() }, 'Open ' + act.tab));
        if (act && act.k === 'event') acts.push(h('button', { class: 'pri', onclick: () => Screens.event() }, 'Decide'));
        if (act && act.k === 'show' && act.what === 'reserve') acts.push(h('button', { onclick: () => Panels.resource('parts') }, 'Reserve'));
        out.push(h('div', { class: 'advi' }, h('div', { class: 'dot', style: 'background:' + col[a.sev] }), h('div', { class: 'grow' }, a.text, acts.length ? h('div', { class: 'acts' }, ...acts) : null)));
      }
      return out;
    } });
  },
  sponsorBody() {
    const G = UI.G, out = [], C = G.contracts;
    out.push(h('div', { class: 'card' }, h('h5', null, SPONSORS[G.cfg.sponsor].name), h('div', { class: 'row small' }, h('span', { class: 'grow' }, 'Sponsor confidence'), h('b', null, Math.round(G.conf))), barEl(G.conf / 100, G.conf < 35 ? 'bad' : G.conf < 55 ? 'warn' : ''),
      h('p', null, 'Stipend ' + KC.stipendNow(G) + ' a sol (falls as the colony matures; confidence scales it) · Earth payroll ' + KC.payrollNow(G) + ' a sol for colonists born at home.')));
    if (C.active) { const c = C.active, p = KC.contractProgress(G, c); out.push(h('div', { class: 'card', style: 'margin-top:8px' }, h('h5', null, '📜 ' + c.name), h('p', null, c.text + ' Reward ' + c.reward + '.'), barEl(p / c.need), h('p', null, Math.floor(p) + ' / ' + c.need + ' · due sol ' + KC.solOf(c.due) + ' (' + Math.max(0, Math.ceil((c.due - G.tick) / 24)) + ' sols)'))); }
    if (C.offer) { const o = C.offer; out.push(h('div', { class: 'card sel', style: 'margin-top:8px' }, h('h5', null, 'Offer: ' + o.name), h('p', null, o.text + ' Within ' + o.sols + ' sols. Reward ' + o.reward + ' funding; missing it costs sponsor confidence.'),
      h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { class: 'grow', onclick: () => { KC.declineContract(G); Sheet.render(); } }, 'Decline'), h('button', { class: 'pri grow', 'data-accept': '1', disabled: !!C.active, onclick: () => { KC.acceptContract(G); Sound.play('good'); Sheet.render(); } }, C.active ? 'Finish the current one first' : 'Accept')))); }
    if (!C.offer && !C.active) out.push(h('p', { class: 'small mut' }, 'No contract on offer. The sponsor proposes a new one every 10 to 16 sols.'));
    out.push(sec('Buy from the sponsor'));
    out.push(h('div', { class: 'card' }, h('h5', null, '⚛ Research grant · ' + KC.grantPrice(G) + ' ¤'), h('p', null, 'Universities at home add ' + KC.grantAmount(G) + ' research. Each grant costs more than the last.'),
      h('button', { class: 'pri', style: 'margin-top:6px', disabled: G.funds < KC.grantPrice(G), onclick: () => { const r = KC.buyGrant(G); if (r.err) HUD.toast(r.err, 'warn'); else Sound.play('tech'); Sheet.render(); } }, 'Buy grant')));
    this._rs = this._rs || 'engineer';
    out.push(h('div', { class: 'card', style: 'margin-top:8px' }, h('h5', null, '☺ Recruiting drive · ' + KC.recruitPrice(G) + ' ¤'), h('p', null, 'Adds six applicants with the specialization you need.'),
      h('div', { class: 'tabs', style: 'padding:6px 0' }, ...Object.keys(SPECS).filter(k => k !== 'none').map(k => h('button', { class: this._rs === k ? 'on' : '', onclick: () => { this._rs = k; Sheet.render(); } }, SPECS[k].icon + ' ' + SPECS[k].name))),
      h('button', { class: 'pri', disabled: G.funds < KC.recruitPrice(G), onclick: () => { const r = KC.recruit(G, this._rs); if (r.err) HUD.toast(r.err, 'warn'); else Sound.play('good'); Sheet.render(); } }, 'Recruit ' + SPECS[this._rs].name.toLowerCase() + 's')));
    out.push(h('div', { class: 'card', style: 'margin-top:8px' }, h('h5', null, '★ Independence buyout · ' + KC.buyoutCost(G) + ' ¤'), h('p', null, 'Declaring independence means buying out the sponsor\'s stake. Keep this much funding when every other goal is met.')));
    return out;
  },
  gameMenu() {
    Sheet.show({ title: 'Kessa Colony', body: () => h('div', { class: 'pick' },
      h('button', { onclick: () => { Sheet.close(); } }, 'Resume', h('p', null, 'Back to the colony.')),
      h('button', { 'data-menu': 'save', onclick: () => Screens.saves('save') }, 'Save game', h('p', null, 'Five manual slots plus the autosave.')),
      h('button', { onclick: () => Screens.saves('load') }, 'Load game', h('p', null, 'Continue another colony.')),
      h('button', { onclick: () => Screens.exportSave() }, 'Export / import', h('p', null, 'Copy the colony as text, or paste one in.')),
      h('button', { onclick: () => Screens.settings() }, 'Settings', h('p', null, 'Sound, music, tips, graphics.')),
      h('button', { onclick: () => Screens.help() }, 'Help', h('p', null, 'How Kessa works.')),
      h('button', { class: 'danger', onclick: () => Modal.confirm('Leave this colony?', 'The colony is autosaved. You can continue it from the main menu.', () => { Saves.write('auto', UI.G); UI.G = null; $('#hud').hidden = true; Sheet.close(); Screens.main(); }) }, 'Main menu', h('p', null, 'Autosaves first.'))) });
  },
});
function bestApplicants(G) {
  const want = { engineer: 3, scientist: 2.6, botanist: 3, geologist: 2.2, medic: 1.2, security: 1.2, none: 1.5 }, have = {};
  for (const c of G.colonists) have[c.spec] = (have[c.spec] || 0) + 1;
  const sc = a => a.traits.reduce((s, t) => s + (TRAITS[t].good ? 2 : -3), 0) + want[a.spec] / (1 + (have[a.spec] || 0) / 6) - (a.age > 50 ? 1.5 : 0);
  return G.applicants.slice().sort((a, b) => sc(b) - sc(a)).slice(0, KC.arkSize(G));
}
function drawHistory(cv, G) {
  const c = cv.getContext('2d'), W = cv.width, H = cv.height, hs = G.hist;
  c.fillStyle = '#1b1411'; c.fillRect(0, 0, W, H);
  c.strokeStyle = '#3a2d25'; c.lineWidth = 1; for (let k = 1; k < 4; k++) { c.beginPath(); c.moveTo(0, H * k / 4); c.lineTo(W, H * k / 4); c.stroke(); }
  if (hs.length < 2) { c.fillStyle = '#b8a597'; c.font = '24px sans-serif'; c.fillText('History appears after the first sols.', 20, H / 2); return; }
  const series = [[h2 => h2.pop, '#8fdc8a'], [h2 => h2.rp, '#b48cff'], [h2 => h2.funds, '#f6e27a']];
  for (const [f, col] of series) {
    const mx = Math.max(1, ...hs.map(f));
    c.strokeStyle = col; c.lineWidth = 3; c.beginPath();
    hs.forEach((x, i) => { const px = i / (hs.length - 1) * (W - 10) + 5, py = H - 8 - f(x) / mx * (H - 20); if (i) c.lineTo(px, py); else c.moveTo(px, py); });
    c.stroke();
  }
  c.fillStyle = '#8fdc8a'; c.font = 'bold 22px sans-serif'; c.fillText('peak ' + Math.max(...hs.map(x => x.pop)) + ' colonists', 12, 26);
}

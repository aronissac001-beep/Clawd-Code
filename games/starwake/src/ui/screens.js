// ===== screens.js : outliner, planets, starbases, research, empire, diplomacy, military, log =====
function openScreen(k, tab, arg) {
  $('pop').hidden = true;
  UI.screen = { k, tab: tab || null, arg };
  for (const b of document.querySelectorAll('#nav button')) b.classList.toggle('on', b.id === 'n_' + k);
  if (k === 'log') UI.logSeen = UI.G.log.length;
  rerender();
}
function closeScreen() { UI.screen = null; $('screens').replaceChildren(); for (const b of document.querySelectorAll('#nav button')) b.classList.remove('on'); renderSel(); updateHUD(); renderer && renderer.request(); }
function rerender() {
  const S = UI.screen; if (!S) return;
  const fn = SCREENS[S.k]; if (!fn) return;
  const old = document.querySelector('.screen .body'), st = old ? old.scrollTop : 0, same = old && old.dataset.k === S.k + ':' + S.tab + ':' + S.arg;
  const el = fn(S);
  $('screens').replaceChildren(el);
  const nb = el.querySelector('.body'); if (nb) { nb.dataset.k = S.k + ':' + S.tab + ':' + S.arg; if (same) nb.scrollTop = st; }
  updateHUD();
}
function frame(title, tabs, body, opts) {
  const S = UI.screen;
  const head = h('div', { class: 'head' }, opts && opts.back ? h('button', { class: 'icon ghost', onclick: opts.back, 'aria-label': 'Back' }, icon('back')) : null, h('h2', null, title), opts && opts.extra, h('button', { class: 'icon', onclick: closeScreen, 'aria-label': 'Close' }, icon('close')));
  const tb = tabs ? h('div', { class: 'tabs' }, tabs.map(([k, lb]) => h('button', { class: (S.tab || tabs[0][0]) === k ? 'on' : '', onclick: () => { S.tab = k; Sound.play('tap'); rerender(); } }, lb))) : null;
  return h('div', { class: 'screen' }, head, tb, h('div', { class: 'body' }, body));
}
const act = (fn) => () => { const err = fn(); if (typeof err === 'string') { toast(err, 'bad'); Sound.play('alert'); } else Sound.play('select'); rerender(); };
function kvs(pairs) { return h('div', { class: 'kv' }, pairs.flat().map(x => x && x.nodeType ? x : h('span', null, x))); }
function bar(frac, cls) { return h('div', { class: 'bar ' + (cls || '') }, h('i', { style: `width:${clamp(frac, 0, 1) * 100}%` })); }
function portraitEl(e, size) { const G = UI.G, c = Art.portrait(G.species[e.species].portrait, size * 2, e.color); c.className = 'portrait'; c.style.width = size + 'px'; c.style.height = size + 'px'; return c; }

const SCREENS = {};
// ---------- outliner ----------
SCREENS.outliner = (S) => {
  const G = UI.G, e = P_();
  const cols = SW.colonies(G, e).slice().sort((a, b) => b.col.pops - a.col.pops);
  const mine = G.fleets.filter(f => f.owner === UI.pid);
  const war = mine.filter(f => f.kind === 'war'), civ = mine.filter(f => f.kind === 'survey' || f.kind === 'builder' || f.kind === 'colony'), arm = mine.filter(f => f.kind === 'army');
  const sbs = SW.ownedSystems(G, e).filter(sid => G.systems[sid].sb && G.systems[sid].sb.lvl > 0);
  return frame('Outliner', null, [
    h('div', { class: 'sub' }, `Colonies (${cols.length})`),
    cols.map(p => { const rep = SW.planetReport(G, p); const q = p.col.queue[0];
      return h('div', { class: 'item', onclick: () => openPlanet(p.id) }, planetThumb(p, 34), h('div', { class: 'grow' }, h('div', { class: 'nm' }, p.name, p.id === e.capital ? h('span', { class: 'chip gold', style: 'margin-left:6px' }, 'Capital') : null),
        h('div', { class: 'ds' }, `${p.col.pops} pops · stability ${rep.stab}` + (rep.unemployed ? ` · ${rep.unemployed} jobless` : '') + (q ? ' · building' : p.col.auto ? ' · automated' : ' · idle'))),
        h('span', { class: 'chip ' + (rep.stab >= 50 ? 'good' : rep.stab < 30 ? 'bad' : '') }, icon('stab'), rep.stab)); }),
    h('div', { class: 'sub' }, `Fleets (${war.length}) · naval ${fmt(SW.navalUsed(G, e))}/${SW.navalCap(G, e)}`),
    war.length ? war.map(f => fleetRow(f)) : h('div', { class: 'mut' }, 'No warships. Build some at a shipyard.'),
    arm.length ? [h('div', { class: 'sub' }, 'Armies'), arm.map(f => fleetRow(f))] : null,
    h('div', { class: 'sub' }, `Civilian ships (${civ.length})`), civ.map(f => fleetRow(f)),
    h('div', { class: 'sub' }, `Starbases (${SW.sbUsed(G, e)}/${SW.sbCap(G, e)} upgraded)`),
    sbs.map(sid => { const s = G.systems[sid]; return h('div', { class: 'item', onclick: () => openStarbase(sid) }, icon('gear'), h('div', { class: 'grow' }, h('div', { class: 'nm' }, s.name), h('div', { class: 'ds' }, SB_LEVELS[s.sb.lvl].name + ' · ' + (s.sb.mods.map(m => SB_MODULES[m].name).join(', ') || 'no modules') + (s.sb.queue.length ? ' · building' : '')))); }),
  ]);
};
// ---------- planet ----------
function openPlanet(pid) { UI.selPlanet = pid; openScreen('planet', null, pid); }
SCREENS.planet = (S) => {
  const G = UI.G, e = P_(), p = G.planets[S.arg];
  if (!p.col || p.col.owner !== UI.pid) return frame(p.name, null, h('p', null, 'This world is no longer yours.'));
  const c = p.col, rep = SW.planetReport(G, p), caps = SW.distCaps(p), sp = G.species[c.sp];
  const used = Object.values(c.dist).reduce((a, b) => a + b, 0) + c.queue.filter(q => q.k === 'd').length;
  const head = h('div', { class: 'card' }, h('div', { class: 'row' }, planetThumb(p, 64), h('div', { class: 'grow' },
    h('div', { style: 'font-weight:700;font-size:18px' }, p.name), h('div', { class: 'mut', style: 'font-size:13px' }, `${PLANET_TYPES[p.type].name} · size ${p.size} · ${sp.name} · ${Math.round(rep.hab * 100)}% habitable`),
    h('div', { class: 'row wrap', style: 'margin-top:6px' }, h('span', { class: 'chip' }, icon('pops'), `${c.pops}/${rep.housing} housing`), h('span', { class: 'chip ' + (rep.stab >= 50 ? 'good' : rep.stab < 30 ? 'bad' : '') }, icon('stab'), 'Stability ' + rep.stab), h('span', { class: 'chip ' + (rep.amen >= rep.demand ? '' : 'bad') }, `Amenities ${rep.amen}/${rep.demand}`)))),
    h('div', { style: 'margin-top:8px;font-size:12px' }, rep.gRate > 0 ? `Growth ${fmt(c.grow)}/${rep.gNeed} (+${rep.gRate.toFixed(1)}/month)` : rep.free <= 0 ? 'Growth halted: no free housing' : 'Growth halted'),
    bar(c.grow / rep.gNeed, 'green'),
    h('div', { class: 'row', style: 'margin-top:10px' }, h('select', { onchange: ev => { SW.setDesignation(G, e, p, ev.target.value); rerender(); } }, Object.keys(DESIGNATIONS).map(k => h('option', { value: k, selected: c.desig === k }, DESIGNATIONS[k].name + ' — ' + DESIGNATIONS[k].desc))),
      h('button', { class: c.auto ? 'on' : '', onclick: () => { c.auto = !c.auto; if (c.auto) SW.autoPlanet(G, e, p); rerender(); } }, c.auto ? 'Automated' : 'Automate')));
  const dists = h('div', { class: 'grid3' }, DISTRICT_KEYS.map(k => {
    const D = DISTRICTS[k], n = c.dist[k] || 0, q = c.queue.filter(x => x.k === 'd' && x.key === k).length, err = SW.canQueue(G, e, p, 'd', k);
    return h('div', { class: 'dist' }, h('div', { class: 'n' }, n, q ? h('span', { class: 'mut', style: 'font-size:12px' }, ' +' + q) : null), h('div', { class: 'lb' }, D.name, h('br'), k === 'habitat' || k === 'industrial' ? '' : 'max ' + caps[k]),
      h('div', { class: 'row' }, h('button', { disabled: !n, 'aria-label': 'Remove', onclick: () => confirmDlg('Demolish a ' + D.name + ' district?', 'No refund is given.', 'Demolish', act(() => SW.demolish(G, e, p, 'd', k)), true) }, icon('minus')), h('button', { class: err ? '' : 'pri', disabled: !!err, 'aria-label': 'Build', onclick: act(() => SW.queueBuild(G, e, p, 'd', k)) }, icon('plus'))));
  }), h('div', { class: 'dist', style: 'display:flex;flex-direction:column;justify-content:center' }, h('div', { class: 'n' }, used + '/' + p.size), h('div', { class: 'lb' }, 'districts used')));
  const slots = SW.bldSlots(p), bused = SW.bldUsed(c);
  const blds = c.bld.map(b => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'nm' }, BUILDINGS[b].name), h('div', { class: 'ds' }, BUILDINGS[b].desc)), b === 'seat' || b === 'hub' ? null : h('button', { class: 'icon danger', 'aria-label': 'Demolish', onclick: () => confirmDlg('Demolish ' + BUILDINGS[b].name + '?', 'No refund is given.', 'Demolish', act(() => SW.demolish(G, e, p, 'b', b)), true) }, icon('close'))));
  const avail = Object.keys(BUILDINGS).filter(k => SW.bldAvailable(G, e, p, k));
  const queue = c.queue.map((q, i) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'nm' }, q.k === 'd' ? DISTRICTS[q.key].name + ' district' : q.k === 'b' ? BUILDINGS[q.key].name : ARMIES[q.key].name), h('div', { class: 'ds' }, i === 0 ? `${q.prog}/${q.total} days` : 'Queued'), i === 0 ? bar(q.prog / q.total) : null), h('button', { class: 'icon', 'aria-label': 'Cancel', onclick: act(() => SW.cancelBuild(G, e, p, i)) }, icon('close'))));
  const jobs = Object.keys(rep.slots).map(j => [JOBS[j].name, `${rep.filled[j] || 0}/${rep.slots[j]}`]);
  if (rep.unemployed) jobs.push(['Unemployed', h('span', { class: 'neg' }, String(rep.unemployed))]);
  const prod = [];
  for (const r of RES) { const v = (rep.out[r] || 0) - (rep.cons[r] || 0); if (Math.abs(v) >= 0.05) prod.push([h('span', { class: 'row', style: 'gap:4px' }, icon(r), RES_INFO[r].name), h('span', { class: v >= 0 ? 'pos' : 'neg' }, fmtS(v))]); }
  const armies = Object.keys(ARMIES).map(k => { const err = SW.canQueue(G, e, p, 'a', k); const A = ARMIES[k]; if (A.tech && !e.techs[A.tech]) return null; return h('button', { class: 'small', disabled: !!err, onclick: act(() => SW.queueBuild(G, e, p, 'a', k)) }, `${A.name} (${costText(A.cost)})`); });
  return frame(p.name, null, [head,
    h('div', { class: 'sub' }, 'Districts'), dists,
    h('div', { class: 'sub' }, `Buildings (${bused}/${slots} slots · more slots every 5 pops)`), blds,
    bused < slots ? h('button', { class: 'pri', style: 'width:100%;margin-bottom:6px', onclick: () => chooseBuilding(p) }, icon('plus'), 'Construct a building') : null,
    c.queue.length ? [h('div', { class: 'sub' }, 'Construction queue'), queue] : null,
    h('div', { class: 'sub' }, 'Jobs'), h('div', { class: 'card' }, kvs(jobs)),
    h('div', { class: 'sub' }, 'Monthly output'), h('div', { class: 'card' }, kvs(prod)),
    h('div', { class: 'sub' }, 'Stability'), h('div', { class: 'card' }, kvs(rep.stabBreak.map(([k, v]) => [k, h('span', { class: v >= 0 ? 'pos' : 'neg' }, fmtS(v))]))),
    h('div', { class: 'sub' }, `Defense: ${Math.round(c.def)}/${rep.defMax} · fortification ${Math.round(c.fort)}%`),
    h('div', { class: 'row wrap' }, armies),
    h('p', { class: 'mut', style: 'font-size:12.5px' }, 'Assault armies gather into a Legion Group in orbit. Send them to an enemy world where your fleet holds orbit, then order an invasion.'),
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { onclick: () => { closeScreen(); enterSystem(p.sys); UI.selPlanet = p.id; renderSel(); } }, icon('system'), 'Show in system')),
  ]);
};
function chooseBuilding(p) {
  const G = UI.G, e = P_();
  const keys = Object.keys(BUILDINGS).filter(k => !BUILDINGS[k].capital && !BUILDINGS[k].colony);
  modal(h('div', null, h('h3', null, 'Construct on ' + p.name), keys.map(k => {
    const B = BUILDINGS[k], avail = SW.bldAvailable(G, e, p, k), err = avail ? SW.canQueue(G, e, p, 'b', k) : (B.tech && !e.techs[B.tech] ? 'Requires ' + TECHS[B.tech].name : B.unique ? 'Only one per planet' : 'Not available');
    return h('div', { class: 'item' + (err ? ' dis' : ''), onclick: () => { if (err) { toast(err, 'bad'); return; } SW.queueBuild(G, e, p, 'b', k); Sound.play('select'); closeModal(); rerender(); } },
      h('div', { class: 'grow' }, h('div', { class: 'nm' }, B.name), h('div', { class: 'ds' }, B.desc), h('div', { class: 'row wrap', style: 'margin-top:3px' }, costEls(SW.scaleCost(G, e, B.cost)), B.upkeep ? h('span', { class: 'chip' }, 'upkeep ' + costText(B.upkeep)) : null, h('span', { class: 'chip' }, B.days + ' days')), err ? h('div', { class: 'ds warnc' }, err) : null));
  }), h('div', { class: 'opts' }, h('button', { onclick: closeModal }, 'Cancel'))));
}
// ---------- starbase ----------
function openStarbase(sid) { openScreen('starbase', null, sid); }
SCREENS.starbase = (S) => {
  const G = UI.G, e = P_(), s = G.systems[S.arg], sb = s.sb;
  if (!sb || sb.owner !== UI.pid) return frame(s.name, null, h('p', null, 'This starbase is no longer yours.'));
  const st = SW.sbStats(G, s), L = SB_LEVELS[sb.lvl];
  const upErr = SW.canSbUpgrade(G, e, s.id);
  const next = SB_LEVELS[sb.lvl + 1];
  const yard = sb.mods.includes('shipyard');
  const designs = e.designs.filter(d => !d.obsolete && SW.hullAvailable(e, d.hull)).sort((a, b) => (HULLS[a.hull].civ ? 0 : 1) - (HULLS[b.hull].civ ? 0 : 1) || HULLS[a.hull].size - HULLS[b.hull].size);
  return frame(s.name + ' ' + L.name, null, [
    h('div', { class: 'card' }, kvs([['Level', L.name + (sb.dis ? ' (disabled)' : '')], ['Hull', `${fmt(sb.hp)}/${fmt(st.hull)}`], ['Shields', `${fmt(sb.sh)}/${fmt(st.shield)}`], ['Damage', fmt(st.dmg) + '/day'], ['Module slots', `${sb.mods.length}/${L.slots}`], ['Upkeep', L.upkeep + ' energy']]),
      next ? h('button', { class: upErr ? '' : 'pri', disabled: !!upErr, style: 'width:100%;margin-top:10px;flex-direction:column', onclick: act(() => SW.sbQueue(G, e, s.id, 'up')) }, `Upgrade to ${next.name} (${costText(SW.scaleCost(G, e, next.cost))})`, upErr ? h('span', { style: 'font-size:12px;opacity:.8' }, upErr) : null) : null),
    h('div', { class: 'sub' }, 'Modules'),
    sb.mods.length ? sb.mods.map(m => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'nm' }, SB_MODULES[m].name), h('div', { class: 'ds' }, SB_MODULES[m].desc)))) : h('div', { class: 'mut' }, L.slots ? 'No modules yet.' : 'Upgrade to a Keep to add modules.'),
    L.slots > sb.mods.length ? h('div', { class: 'row wrap' }, Object.keys(SB_MODULES).map(k => { const err = SW.canSbModule(G, e, s.id, k); return h('button', { class: 'small', disabled: !!err, onclick: act(() => SW.sbQueue(G, e, s.id, 'mod', k)) }, `+ ${SB_MODULES[k].name} (${costText(SB_MODULES[k].cost)})`); })) : null,
    sb.queue.length ? [h('div', { class: 'sub' }, 'Queue'), sb.queue.map((q, i) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'nm' }, q.k === 'up' ? 'Upgrade to ' + SB_LEVELS[sb.lvl + 1].name : q.k === 'mod' ? SB_MODULES[q.key].name : (SW.designById(e, q.key) || { name: 'Ship' }).name), h('div', { class: 'ds' }, `${q.prog}/${q.total} days`), bar(q.prog / q.total)), h('button', { class: 'icon', 'aria-label': 'Cancel', onclick: act(() => SW.sbCancel(G, e, s.id, i)) }, icon('close'))))] : null,
    h('div', { class: 'sub' }, yard ? 'Build ships' : 'Build ships (needs a Shipyard module)'),
    yard ? designs.map(d => { const ds = SW.designStats(G, e, d), err = SW.canBuildShip(G, e, s.id, d.id); return h('div', { class: 'item' + (err ? ' dis' : ''), onclick: act(() => SW.sbQueue(G, e, s.id, 'ship', d.id)) }, h('div', { class: 'grow' }, h('div', { class: 'nm' }, d.name), h('div', { class: 'ds' }, HULLS[d.hull].civ ? HULLS[d.hull].desc : `Power ${ds.power} · hull ${ds.hull} · armor ${ds.armor} · shield ${ds.shield}`), h('div', { class: 'row wrap', style: 'margin-top:3px' }, costEls(ds.cost), h('span', { class: 'chip' }, ds.days + ' days')), err && err !== 'Queue is full' ? h('div', { class: 'ds warnc' }, err) : null), h('button', { class: 'icon pri', disabled: !!err, 'aria-label': 'Build' }, icon('plus'))); }) : null,
  ]);
};
// ---------- research ----------
SCREENS.research = (S) => {
  const G = UI.G, e = P_(), net = SW.empireEcon(G, e).net;
  const tab = S.tab || 'choose';
  if (tab === 'known') {
    const list = Object.keys(e.techs).map(id => TECHS[id]).filter(t => t && !t.hidden).sort((a, b) => a.stream.localeCompare(b.stream) || a.tier - b.tier);
    return frame('Research', [['choose', 'Current'], ['known', `Known (${list.length})`]], [
      RESEARCH.map(k => [h('div', { class: 'sub' }, STREAM_NAMES[k] + (e.rep[k] ? ` · Refinements ${e.rep[k]}` : '')), list.filter(t => t.stream === k).map(t => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'nm' }, t.name, h('span', { class: 'mut', style: 'font-size:11px' }, '  tier ' + t.tier)), h('div', { class: 'ds' }, techDesc(t)))))])]);
  }
  return frame('Research', [['choose', 'Current'], ['known', 'Known']], [h('div', { class: 'card row sp' }, h('div', { class: 'grow' }, h('b', null, 'Advisors choose research'), h('div', { class: 'mut', style: 'font-size:12.5px' }, 'When a project finishes, your scientists pick the next card for you.')), h('button', { class: e.autoResearch ? 'on' : '', onclick: () => { e.autoResearch = !e.autoResearch; if (e.autoResearch) for (const k of RESEARCH) if (!e.research[k].cur) e.research[k].cur = SW.aiPickTech(G, e, k); rerender(); } }, e.autoResearch ? 'On' : 'Off'))].concat(RESEARCH.map(k => {
    const r = e.research[k];
    const cur = r.cur ? SW.techInfo(r.cur) : null, cost = r.cur ? SW.techCost(G, e, r.cur) : 0, m = SW.researchMonths(G, e, k);
    return h('div', { class: 'card' },
      h('div', { class: 'row sp' }, h('div', { class: 'row' }, icon(k), h('h3', { style: 'margin:0' }, STREAM_NAMES[k])), h('span', { class: 'pos' }, '+' + fmt(net[k] || 0) + '/month')),
      h('div', { class: 'mut', style: 'font-size:12.5px;margin:4px 0 8px' }, RES_INFO[k].desc),
      cur ? h('div', { style: 'margin-bottom:8px' }, h('div', { class: 'row sp', style: 'font-size:13px' }, h('span', null, 'Researching ', h('b', null, cur.name)), h('span', { class: 'mut' }, `${fmt(r.prog)}/${fmt(cost)} · ${m === Infinity ? '∞' : m + ' mo'}`)), bar(r.prog / cost)) : h('div', { class: 'warnc', style: 'font-size:13px;margin-bottom:8px' }, `Choose a ${STREAM_NAMES[k]} project. Stored progress: ${fmt(r.prog)}`),
      r.opts.map(id => { const t = SW.techInfo(id); return h('div', { class: 'tech' + (r.cur === id ? ' cur' : ''), onclick: () => { SW.chooseTech(G, e, k, id); Sound.play('select'); rerender(); } },
        h('span', { class: 'tier' }, t.rep ? 'repeatable' : 'tier ' + t.tier + ' · ' + fmt(SW.techCost(G, e, id))), h('div', { class: 'tn' }, t.name), h('div', { class: 'td' }, t.rep ? modsText(t.un.mods) : techDesc(t))); }));
  })));
};
// ---------- empire ----------
SCREENS.empire = (S) => {
  const G = UI.G, e = P_(), tab = S.tab || 'overview', sp = G.species[e.species];
  const tabs = [['overview', 'Overview'], ['traditions', 'Traditions'], ['edicts', 'Edicts'], ['market', 'Market'], ['victory', 'Victory']];
  let body;
  if (tab === 'overview') {
    const m = SW.empMods(G, e), sprawl = SW.sprawlInfo(G, e), sc = SW.scoreOf(G, e);
    body = [h('div', { class: 'card empcard' }, portraitEl(e, 96), h('div', { class: 'grow' }, h('div', { style: `font-weight:700;font-size:17px;color:${e.color}` }, e.name), h('div', { class: 'mut', style: 'font-size:13px' }, `${sp.name} · ${sp.body} · prefers ${PLANET_TYPES[sp.pref].name.toLowerCase()}s`),
        h('div', { class: 'row wrap', style: 'margin-top:6px' }, sp.traits.map(t => h('span', { class: 'chip ' + (TRAITS[t].cost > 0 ? 'good' : 'bad') }, TRAITS[t].name))))),
      h('div', { class: 'card' }, h('h3', null, 'Ethos and government'), e.ethos.map(x => h('div', { style: 'margin:4px 0' }, h('b', null, ETHOS[x].name), h('div', { class: 'mut', style: 'font-size:13px' }, ETHOS[x].desc))), h('div', { style: 'margin:6px 0 0' }, h('b', null, GOVS[e.gov].name), h('div', { class: 'mut', style: 'font-size:13px' }, GOVS[e.gov].desc))),
      h('div', { class: 'card' }, h('h3', null, 'State of the empire'), kvs([['Systems', String(SW.ownedSystems(G, e).length)], ['Colonies', String(SW.colonies(G, e).length)], ['Pops', String(SW.totalPops(G, e))], ['Technologies', String(e.stats.techs)],
        ['Administrative capacity', `${sprawl.used}/${sprawl.cap}` + (sprawl.over ? ` (costs +${Math.round(sprawl.over * 0.6)}%)` : '')], ['Naval capacity', `${fmt(SW.navalUsed(G, e))}/${SW.navalCap(G, e)}`], ['Fleet command limit', String(SW.cmdLimit(G, e))], ['Fleet power', fmt(SW.empirePower(G, e))],
        ['Starbases', `${SW.sbUsed(G, e)}/${SW.sbCap(G, e)}`], ['Score', String(sc.total)]])),
      h('div', { class: 'card' }, h('h3', null, 'Active modifiers'), Object.keys(m).filter(k => !k.startsWith('_') && k !== 'aiBonus' && m[k]).map(k => h('span', { class: 'chip', style: 'margin:2px' }, modsText({ [k]: Math.round(m[k] * 10) / 10 }))),
        e.timed.filter(t => t.until > G.day).map(t => h('div', { class: 'mut', style: 'font-size:12.5px;margin-top:6px' }, `${t.name}: ${modsText(t.mods)} (until ${SW.dateStr(t.until)})`)))];
  } else if (tab === 'traditions') {
    const cost = SW.tradCost(G, e);
    body = [h('div', { class: 'card row sp' }, h('div', null, 'Unity ', h('b', null, fmt(e.res.unity)), h('span', { class: 'pos' }, ' ' + fmtS(SW.empireEcon(G, e).net.unity || 0))), h('div', null, 'Next tradition ', h('b', null, fmt(cost)))),
      TRADITION_KEYS.map(k => { const T = TRADITIONS[k], n = e.trads[k] || 0, err = SW.canTradition(G, e, k);
        return h('div', { class: 'trad', style: `border-color:${n ? T.color : '#262b5a'}` }, h('div', { class: 'row sp' }, h('b', { style: `color:${T.color}` }, T.name), h('span', { class: 'mut', style: 'font-size:12px' }, T.desc)),
          h('div', { class: 'mut', style: 'font-size:12.5px;margin-top:4px' }, 'Adopt: ' + modsText(T.adopt) + ' · Finish: ' + modsText(T.finish)),
          h('div', { class: 'nodes' }, T.nodes.map((nd, i) => h('div', { class: 'node' + (n > i + 1 ? ' done' : ''), style: n > i + 1 ? `color:${T.color}` : '' }, nd.name))),
          n <= T.nodes.length ? h('button', { class: err ? '' : 'pri', disabled: !!err, style: 'width:100%', onclick: act(() => SW.takeTradition(G, e, k)) }, n === 0 ? `Adopt ${T.name} (${fmt(cost)} unity)` : `${T.nodes[n - 1].name}: ${T.nodes[n - 1].desc} (${fmt(cost)})`) : h('div', { class: 'pos', style: 'text-align:center' }, 'Completed'));
      }),
      h('div', { class: 'trad' }, h('b', null, 'Legacy Works' + (e.legacy ? ' · ' + e.legacy : '')), h('div', { class: 'mut', style: 'font-size:12.5px;margin:4px 0 8px' }, 'Each work: +2% energy, minerals, alloys and research, +1 stability (up to 10). Unlocks after three completed traditions.'),
        h('button', { disabled: !SW.legacyOpen(e) || e.res.unity < SW.legacyCost(G, e), style: 'width:100%', onclick: act(() => SW.takeLegacy(G, e)) }, `Build a Legacy Work (${fmt(SW.legacyCost(G, e))} unity)`))];
  } else if (tab === 'edicts') {
    const act2 = SW.activeEdicts(G, e);
    body = [h('div', { class: 'card row sp' }, h('div', null, 'Influence ', h('b', null, fmt(e.res.influence))), h('div', null, `Slots ${act2.length}/${SW.edictSlots(G, e)}`)),
      Object.keys(EDICTS).map(k => { const E = EDICTS[k], on = e.edicts[k] > G.day, err = SW.canEdict(G, e, k);
        return h('div', { class: 'item' + (on ? ' sel' : '') }, h('div', { class: 'grow' }, h('div', { class: 'nm' }, E.name), h('div', { class: 'ds' }, E.desc), on ? h('div', { class: 'ds pos' }, 'Active until ' + SW.dateStr(e.edicts[k])) : null),
          on ? h('button', { class: 'small', onclick: act(() => SW.cancelEdict(G, e, k)) }, 'End') : h('button', { class: 'small ' + (err ? '' : 'pri'), disabled: !!err, onclick: act(() => SW.enactEdict(G, e, k)) }, fmt(SW.edictCost(G, e, k)) + ' influence')); })];
  } else if (tab === 'market') {
    body = [h('div', { class: 'card' }, h('div', null, 'Energy ', h('b', null, fmt(e.res.energy))), h('p', { class: 'mut', style: 'font-size:13px' }, 'Trade surplus for what you lack. Energy is the currency of the galactic market.' + (e.ethos.includes('mercantile') ? ' Your Mercantile ethos gets better prices.' : ''))),
      Object.keys(MARKET).map(r => h('div', { class: 'card' }, h('div', { class: 'row sp' }, h('div', { class: 'row' }, icon(r), h('b', null, RES_INFO[r].name), h('span', { class: 'mut' }, fmt(e.res[r]))), h('span', { class: 'mut', style: 'font-size:12px' }, `buy ${SW.marketPrice(G, e, r, true).toFixed(2)} · sell ${SW.marketPrice(G, e, r, false).toFixed(2)}`)),
        h('div', { class: 'row', style: 'margin-top:8px' }, [10, 100].map(n => h('button', { class: 'small grow', onclick: act(() => SW.marketTrade(G, e, r, n, true)) }, `Buy ${n}`)), [10, 100].map(n => h('button', { class: 'small grow', onclick: act(() => SW.marketTrade(G, e, r, n, false)) }, `Sell ${n}`)))))];
  } else {
    const all = SW.alive(G).map(x => ({ x, s: SW.scoreOf(G, x).total })).sort((a, b) => b.s - a.s);
    const need = SW.homeworldsNeeded(G), held = SW.homeworldsHeld(G, e);
    body = [h('div', { class: 'card' }, h('h3', null, 'Conquest'), h('div', { class: 'mut', style: 'font-size:13px' }, VICTORY_TYPES.conquest.desc), h('div', { style: 'margin-top:6px' }, `You hold ${held} of the ${need} homeworlds needed · ${SW.alive(G).length - 1} rivals remain`), bar(held / need, 'red'),
      SW.alive(G).filter(x => x.id !== UI.pid && SW.homeworldsHeld(G, x) >= 2).map(x => h('div', { class: 'warnc', style: 'font-size:13px;margin-top:4px' }, `${SW.hasContact(G, UI.pid, x.id) ? x.name : 'An unknown empire'} holds ${SW.homeworldsHeld(G, x)} homeworlds` + (x.domDays ? ` · dominion in ${Math.ceil((1800 - x.domDays) / 360)} years` : ''))), e.domDays ? h('div', { class: 'pos', style: 'font-size:13px' }, `Your dominion completes in ${Math.ceil((1800 - e.domDays) / 360)} years`) : null),
      h('div', { class: 'card' }, h('h3', null, 'Wake Beacons'), h('div', { class: 'mut', style: 'font-size:13px' }, VICTORY_TYPES.beacon.desc),
        G.beacons.map(sid => { const s = G.systems[sid]; return h('div', { class: 'item', onclick: () => { closeScreen(); renderer.centerOn(sid, true); selectSystem(sid); } }, h('span', { class: 'dot', style: `color:${s.owner >= 0 ? G.empires[s.owner].color : '#9ee9ff'};background:${s.owner >= 0 ? G.empires[s.owner].color : 'transparent'}` }), h('div', { class: 'grow' }, h('div', { class: 'nm' }, e.known[sid] ? s.name : 'Unknown location'), h('div', { class: 'ds' }, !e.known[sid] ? 'Somewhere beyond your charts' : s.owner >= 0 ? (s.owner === UI.pid || SW.hasContact(G, UI.pid, s.owner) ? G.empires[s.owner].name : 'Unknown empire') + (s.sb && s.sb.lvl >= 1 ? ' · attuned' : ' · needs a Keep') : 'Unclaimed'))); }),
        SW.alive(G).filter(x => x.beaconDays > 0).map(x => h('div', { class: 'warnc' }, `${x.name}: ${Math.ceil((BEACON_DAYS - x.beaconDays) / 360)} years to victory`)),
        h('div', { class: 'mut', style: 'font-size:12.5px;margin-top:6px' }, e.techs.wakefield ? 'You know Wakefield Theory.' : 'Requires Wakefield Theory (Lumen, tier 5).')),
      h('div', { class: 'card' }, h('h3', null, 'Score'), h('div', { class: 'mut', style: 'font-size:13px' }, `Highest score in ${dateOf(G.endDay).y} wins. ${Math.max(0, Math.ceil((G.endDay - G.day) / 360))} years left.`),
        all.map(({ x, s }) => h('div', { class: 'row sp', style: 'margin-top:4px' }, h('span', { style: `color:${x.color}` }, (SW.hasContact(G, UI.pid, x.id) || x.id === UI.pid ? x.name : 'Unknown empire')), h('b', null, s)))),
      h('div', { class: 'card' }, h('h3', null, 'Your score'), kvs(SW.scoreOf(G, e).parts.map(([k, v]) => [k, String(Math.round(v))])))];
  }
  return frame('Empire', tabs, body);
};
// ---------- diplomacy ----------
SCREENS.diplomacy = (S) => {
  const G = UI.G, e = P_();
  if (S.arg != null) return diploDetail(G.empires[S.arg]);
  const known = SW.alive(G).filter(x => x.id !== UI.pid && SW.hasContact(G, UI.pid, x.id));
  const wars = SW.warsOf(G, UI.pid);
  return frame('Diplomacy', null, [
    wars.length ? [h('div', { class: 'sub' }, 'Wars'), wars.map(w => warCard(w))] : null,
    h('div', { class: 'sub' }, `Known empires (${known.length} of ${SW.alive(G).length - 1})`),
    known.length ? known.map(x => { const op = SW.opinion(G, x.id, UI.pid).total, r = SW.rel(G, UI.pid, x.id);
      return h('div', { class: 'item', onclick: () => { S.arg = x.id; rerender(); } }, portraitEl(x, 48), h('div', { class: 'grow' }, h('div', { class: 'nm', style: `color:${x.color}` }, x.name),
        h('div', { class: 'ds' }, `${SW.attitude(op)} (${op >= 0 ? '+' : ''}${op})` + (SW.atWar(G, UI.pid, x.id) ? ' · AT WAR' : '')),
        h('div', { class: 'row wrap', style: 'margin-top:3px' }, Object.keys(r.treaties).filter(k => r.treaties[k]).map(k => h('span', { class: 'chip good' }, TREATIES[k].name)))), icon('back', 'flip')); }) : h('p', { class: 'mut' }, 'You have not met anyone yet. Keep exploring.'),
    h('div', { class: 'sub' }, 'Galactic wars'),
    G.wars.filter(w => !wars.includes(w)).map(w => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'nm' }, w.name), h('div', { class: 'ds' }, `${w.att.map(x => G.empires[x].name).join(', ')} vs ${w.def.map(x => G.empires[x].name).join(', ')}`)))),
    !G.wars.length ? h('div', { class: 'mut' }, 'The galaxy is at peace.') : null,
  ]);
};
function warCard(w) {
  const G = UI.G, side = w.att.includes(UI.pid) ? 'att' : 'def', them = side === 'att' ? 'def' : 'att';
  const lead = side === 'att' ? w.lead[0] === UI.pid : w.lead[1] === UI.pid;
  const opts = [['status', 'White peace'], ['surrender', 'Demand they yield'], ['concede', 'Yield to them']];
  return h('div', { class: 'card' }, h('h3', null, w.name), h('div', { class: 'mut', style: 'font-size:12.5px' }, `Goal: ${WAR_GOALS[w.goal].name} · since ${SW.dateStr(w.start)}`),
    h('div', { style: 'font-size:13px;margin-top:6px' }, 'Your side exhaustion ' + Math.round(w.exh[side]) + '%'), bar(w.exh[side] / 100, 'red'),
    h('div', { style: 'font-size:13px;margin-top:6px' }, 'Enemy exhaustion ' + Math.round(w.exh[them]) + '%'), bar(w.exh[them] / 100, 'gold'),
    h('div', { class: 'mut', style: 'font-size:12px;margin-top:4px' }, 'A side at 100% exhaustion must yield.'),
    lead ? h('div', { class: 'col', style: 'margin-top:8px' }, opts.map(([k, lb]) => { const ev = SW.evalPeace(G, UI.pid, w, k);
      return h('button', { class: ev.ok ? 'pri' : '', style: 'flex-direction:column;align-items:flex-start', onclick: () => { const r = SW.proposePeace(G, UI.pid, w, k); toast(r.ok ? 'Peace!' : r.err, r.ok ? 'good' : 'bad'); flushLog(); rerender(); } }, lb, h('span', { style: 'font-size:11.5px;opacity:.85;font-weight:400' }, (ev.ok ? 'They would accept: ' : 'They would refuse: ') + ev.parts.map(([a, b]) => `${a} ${b >= 0 ? '+' : ''}${b}`).join(', '))); })) : h('div', { class: 'mut', style: 'font-size:12.5px;margin-top:6px' }, 'Your ally leads this war and decides on peace.'));
}
function diploDetail(x) {
  const G = UI.G, e = P_(), op = SW.opinion(G, x.id, UI.pid), r = SW.rel(G, UI.pid, x.id), sp = G.species[x.species];
  const war = SW.atWar(G, UI.pid, x.id);
  const treat = Object.keys(TREATIES).map(k => {
    if (r.treaties[k]) return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'nm pos' }, TREATIES[k].name), h('div', { class: 'ds' }, TREATIES[k].desc)), h('button', { class: 'small danger', onclick: () => confirmDlg('Cancel the ' + TREATIES[k].name + '?', 'They will think less of you.', 'Cancel treaty', act(() => SW.cancelTreaty(G, UI.pid, x.id, k)), true) }, 'Cancel'));
    const err = SW.canPropose(G, UI.pid, x.id, k), ev = war ? null : SW.evalTreaty(G, UI.pid, x.id, k);
    return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'nm' }, TREATIES[k].name), h('div', { class: 'ds' }, TREATIES[k].desc), ev ? h('div', { class: 'ds ' + (ev.ok ? 'pos' : 'neg') }, (ev.ok ? 'Likely to accept: ' : 'Will refuse: ') + ev.parts.filter(p => p[1]).map(([a, b]) => `${a} ${b >= 0 ? '+' : ''}${b}`).join(', ')) : null),
      h('button', { class: 'small ' + (ev && ev.ok && !err ? 'pri' : ''), disabled: !!err, onclick: () => { const res = SW.propose(G, UI.pid, x.id, k); toast(res.ok ? `${TREATIES[k].name} signed!` : res.err, res.ok ? 'good' : 'bad'); Sound.play(res.ok ? 'peace' : 'alert'); flushLog(); rerender(); } }, err ? err.slice(0, 18) : `Propose (${SW.treatyCost(k)})`));
  });
  const declare = () => modal(h('div', null, h('h3', null, 'Declare war on the ' + x.name), h('p', null, 'Choose a war goal. It decides what you gain if they yield. War costs ' + WAR_INFLUENCE + ' influence' + (r.treaties.nap ? ' and breaking your pact angers everyone.' : '.')),
    h('div', { class: 'opts' }, Object.keys(WAR_GOALS).map(g => h('button', { class: 'danger', onclick: () => { const err = SW.declareWar(G, UI.pid, x.id, g); closeModal(); if (err) toast(err, 'bad'); else Sound.play('war'); flushLog(); rerender(); } }, h('div', null, h('b', null, WAR_GOALS[g].name), h('div', { style: 'font-size:12px;opacity:.8' }, WAR_GOALS[g].desc)))), h('button', { onclick: closeModal }, 'Cancel'))));
  const dErr = SW.canDeclare(G, UI.pid, x.id);
  return frame(x.name, null, [
    h('div', { class: 'card empcard' }, portraitEl(x, 110), h('div', { class: 'grow' }, h('div', { style: `font-weight:700;color:${x.color}` }, x.name), h('div', { class: 'mut', style: 'font-size:13px' }, `${sp.name} · ${sp.body}`), h('div', { class: 'mut', style: 'font-size:13px' }, x.ethos.map(k => ETHOS[k].name).join(' · ') + ' · ' + GOVS[x.gov].name),
      h('div', { class: 'mut', style: 'font-size:13px' }, 'Temperament: ' + PERSONAS[x.persona].name + ' — ' + PERSONAS[x.persona].desc),
      h('div', { style: 'margin-top:4px' }, h('b', null, SW.attitude(op.total) + ` (${op.total >= 0 ? '+' : ''}${op.total})`)))),
    h('div', { class: 'card' }, h('h3', null, 'Their opinion of you'), op.parts.length ? kvs(op.parts.map(([k, v]) => [k, h('span', { class: v >= 0 ? 'pos' : 'neg' }, (v >= 0 ? '+' : '') + v)])) : h('div', { class: 'mut' }, 'No strong feelings.')),
    h('div', { class: 'card' }, kvs([['Systems', String(SW.ownedSystems(G, x).length)], ['Colonies', String(SW.colonies(G, x).length)], ['Fleet power', SW.empirePower(G, x) > SW.empirePower(G, e) * 1.5 ? 'Superior' : SW.empirePower(G, x) < SW.empirePower(G, e) * 0.67 ? 'Inferior' : 'Equivalent'], ['Technologies', String(x.stats.techs)], ['Truce', r.truce > G.day ? 'until ' + SW.dateStr(r.truce) : 'none']])),
    h('div', { class: 'sub' }, 'Treaties'), war ? h('p', { class: 'mut' }, 'No treaties while at war.') : treat,
    h('div', { class: 'sub' }, 'Actions'),
    h('div', { class: 'row wrap' }, h('button', { disabled: war || e.res.energy < 100, onclick: act(() => SW.sendGift(G, UI.pid, x.id)) }, 'Send gift (100 energy)'), h('button', { disabled: war, onclick: act(() => SW.insult(G, UI.pid, x.id)) }, 'Insult'),
      war ? null : h('button', { class: 'danger', disabled: !!dErr, onclick: declare }, dErr ? dErr : 'Declare war…')),
    war ? warCard(SW.warBetween(G, UI.pid, x.id)) : null,
  ], { back: () => { UI.screen.arg = null; rerender(); } });
}
// ---------- military ----------
SCREENS.military = (S) => {
  const G = UI.G, e = P_(), tab = S.tab || 'fleets';
  const tabs = [['fleets', 'Fleets'], ['yards', 'Shipyards'], ['designs', 'Designs']];
  let body;
  if (tab === 'fleets') {
    const fl = G.fleets.filter(f => f.owner === UI.pid);
    body = [h('div', { class: 'card' }, kvs([['Naval capacity', `${fmt(SW.navalUsed(G, e))}/${SW.navalCap(G, e)}` + (SW.navalUsed(G, e) > SW.navalCap(G, e) ? ' (over: higher upkeep)' : '')], ['Fleet command limit', String(SW.cmdLimit(G, e))], ['Total power', fmt(SW.empirePower(G, e))]])),
      ['war', 'army', 'survey', 'builder', 'colony'].map(k => { const list = fl.filter(f => f.kind === k); if (!list.length) return null; return [h('div', { class: 'sub' }, { war: 'Warfleets', army: 'Armies', survey: 'Surveyors', builder: 'Constructors', colony: 'Colony arks' }[k]), list.map(f => h('div', { class: 'item', onclick: () => selectFleet(f.id, true) }, h('div', { class: 'grow' }, h('div', { class: 'nm' }, f.name), h('div', { class: 'ds' }, shipSummary(G, f) + ' · ' + orderLabel(f) + ' · at ' + G.systems[f.sys].name)), f.kind === 'war' ? h('span', { class: 'chip' }, fmt(SW.fleetPower(G, f))) : null))]; })];
  } else if (tab === 'yards') {
    const yards = SW.shipyards(G, e);
    body = [yards.length ? yards.map(sid => { const s = G.systems[sid]; return h('div', { class: 'item', onclick: () => openStarbase(sid) }, icon('gear'), h('div', { class: 'grow' }, h('div', { class: 'nm' }, s.name), h('div', { class: 'ds' }, s.sb.queue.filter(q => q.k === 'ship').length + ' ships queued · tap to build'))); }) : h('p', { class: 'mut' }, 'No shipyards. Add a Shipyard module to an upgraded starbase.'),
      h('p', { class: 'mut', style: 'font-size:13px' }, 'Warships cost alloys; civilian ships cost minerals. Each Shipyard module builds one ship at a time.')];
  } else {
    body = [h('div', { class: 'card row sp' }, h('div', null, h('b', null, 'Auto-design'), h('div', { class: 'mut', style: 'font-size:12.5px' }, 'New designs are made when you research components, and old ones are marked obsolete.')), h('button', { class: e.autoDesign ? 'on' : '', onclick: () => { e.autoDesign = !e.autoDesign; rerender(); } }, e.autoDesign ? 'On' : 'Off')),
      HULL_KEYS.filter(hk => SW.hullAvailable(e, hk)).map(hk => [h('div', { class: 'sub' }, HULLS[hk].name + ' · size ' + HULLS[hk].size + ' · ' + HULLS[hk].desc), e.designs.filter(d => d.hull === hk && !d.obsolete).map(d => designRow(d)), h('button', { class: 'small', onclick: () => openDesigner(hk, null) }, icon('plus'), 'New ' + HULLS[hk].name + ' design')]),
      e.designs.some(d => d.obsolete && !HULLS[d.hull].civ) ? [h('div', { class: 'sub' }, 'Obsolete'), e.designs.filter(d => d.obsolete && !HULLS[d.hull].civ).slice(-6).map(d => designRow(d))] : null];
  }
  return frame('Military', tabs, body);
};
function designRow(d) {
  const G = UI.G, e = P_(), st = SW.designStats(G, e, d);
  return h('div', { class: 'item' + (d.obsolete ? ' dis' : ''), onclick: () => openDesigner(d.hull, d.id) }, h('div', { class: 'grow' }, h('div', { class: 'nm' }, d.name + (d.auto ? '' : ' ✎')), h('div', { class: 'ds' }, `Power ${st.power} · hull ${st.hull} · armor ${st.armor} · shield ${st.shield} · ${st.cost.alloys} alloys`), h('div', { class: 'ds' }, d.comps.map(c => COMPS[c].name).join(', '))));
}
function openDesigner(hull, did) {
  const G = UI.G, e = P_(), H = HULLS[hull], base = did ? SW.designById(e, did) : null;
  const need = [].concat(Array(H.slots.w).fill('w'), Array(H.slots.d).fill('d'), Array(H.slots.u).fill('u'));
  const comps = base ? base.comps.slice() : autoDesignComps(e, hull);
  let name = base ? (base.auto ? H.name + ' Custom' : base.name) : H.name + ' Custom';
  const render = () => {
    const tmp = { id: -1, hull, comps, name };
    if (e._ds) delete e._ds[-1];
    const st = SW.designStats(G, e, tmp); delete e._ds[-1];
    const dps = sum(st.weapons, w => w.dmg);
    const types = {}; for (const w of st.weapons) types[w.type] = (types[w.type] || 0) + 1;
    modal(h('div', null, h('h3', null, (base ? 'Edit ' : 'New ') + H.name + ' design'),
      h('input', { type: 'text', value: name, maxlength: 28, oninput: ev => { name = ev.target.value; } }),
      h('div', { class: 'sub' }, 'Slots'),
      need.map((sl, i) => h('div', { class: 'slotrow' }, h('span', { class: 'sl ' + sl }, sl.toUpperCase()), h('select', { onchange: ev => { comps[i] = ev.target.value; render(); } }, SW.availableComps(e, sl).map(c => h('option', { value: c, selected: comps[i] === c }, COMPS[c].name + (COMPS[c].dmg ? ` (${COMPS[c].type} ${COMPS[c].dmg})` : COMPS[c].armor ? ` (armor ${COMPS[c].armor})` : COMPS[c].shield ? ` (shield ${COMPS[c].shield})` : ''))))))
      , h('div', { class: 'card', style: 'margin-top:8px' }, kvs([['Power', String(st.power)], ['Hull', String(st.hull)], ['Armor', String(st.armor)], ['Shields', String(st.shield)], ['Damage per day', fmt(dps)], ['Weapons', Object.keys(types).map(k => types[k] + ' ' + { kin: 'kinetic', beam: 'beam', mis: 'missile' }[k]).join(', ')], ['Evasion', String(st.evasion)], ['Cost', st.cost.alloys + ' alloys']])),
      h('p', { class: 'mut', style: 'font-size:12.5px' }, 'Kinetic weapons are strong against shields, beams against armor. Missiles ignore evasion but can be shot down by Intercept Lattices.'),
      h('div', { class: 'opts' }, h('button', { class: 'pri', onclick: () => { const d = SW.saveDesign(G, e, hull, comps, name, base && !base.obsolete ? base.id : null); if (typeof d === 'string') toast(d, 'bad'); else { toast('Design saved: ' + d.name, 'good'); closeModal(); rerender(); } } }, base && !base.obsolete ? 'Save as new (replaces this one)' : 'Save design'),
        base && !base.obsolete ? h('button', { onclick: () => { base.obsolete = 1; closeModal(); rerender(); } }, 'Mark obsolete') : null,
        base && base.obsolete ? h('button', { onclick: () => { base.obsolete = 0; closeModal(); rerender(); } }, 'Restore design') : null,
        h('button', { onclick: closeModal }, 'Cancel'))));
  };
  render();
}
// ---------- log ----------
SCREENS.log = (S) => {
  const G = UI.G, items = G.log.filter(l => l.e === UI.pid || l.e === -1).slice(-150).reverse();
  const filter = S.tab || 'all';
  const show = items.filter(l => filter === 'all' || (filter === 'galaxy' ? l.e === -1 : l.e === UI.pid));
  return frame('Situation Log', [['all', 'All'], ['empire', 'Empire'], ['galaxy', 'Galaxy']], show.length ? show.map(l => h('div', { class: 'item', onclick: () => { if (l.s >= 0) { closeScreen(); renderer.centerOn(l.s, true); selectSystem(l.s); } } },
    h('span', { class: 'dot', style: `color:${{ good: '#73e8a0', bad: '#ff6b7d', war: '#ff6b7d', major: '#ffcf6a', peace: '#73e8a0', event: '#b98cff', tech: '#6fd6ff' }[l.k] || '#5d6396'};background:currentColor` }),
    h('div', { class: 'grow' }, h('div', { class: 'ds' }, SW.dateStr(l.d)), h('div', { style: 'font-size:14px' }, l.m)))) : h('p', { class: 'mut' }, 'Nothing yet.'));
};

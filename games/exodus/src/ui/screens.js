// ===== screens.js : city, research and empire screens =====
function backToMap() { closeScreens(); refreshAll(); }
function itemGlyph(it) {
  if (it.k === 'u') return UNITS[it.key].glyph;
  const B0 = BUILDINGS[BLDI[it.key]]; return (B0 && B0.glyph) || '🏛';
}
function itemDesc(it) {
  if (it.k === 'b') { const B = BUILDINGS[BLDI[it.key]]; return B.desc + (B.upkeep ? ` Upkeep ${B.upkeep}💠.` : ''); }
  const U = UNITS[it.key];
  if (U.orbital) { const S = HX.SATS[it.key]; return `Satellite. ${S.text} Launched from a colony; orbits for ${S.life} turns.`; }
  if (U.military && U.cls !== 'recon') {
    const kind = { melee: 'Infantry', ranged: 'Ranged', mounted: 'Mobile', siege: 'Siege, +100% vs colonies', naval_melee: 'Naval melee', naval_ranged: 'Naval ranged' }[U.cls];
    const A = U.aff ? HX.AFFINITIES.find(a => a.key === U.aff) : null;
    return (A ? `${A.glyph} ${A.name} tier ${U.tier}. ` : '') + `${kind}. Strength ${U.str}` + (U.rstr ? `, ranged ${U.rstr} at ${U.range} tiles` : '') + `, ${U.moves} moves.` + (U.res ? ` Uses ${RES[RESI[U.res]].name}.` : '') + (U.note ? ' ' + U.note : '') + (U.civ ? ' Unique unit.' : '');
  }
  return { settler: 'Founds a new colony. Costs 1 population; the colony must be size 2.', builder: 'Builds farms, drill rigs, roads and more, and scours the Veil. 3 charges.',
    scout: 'Fast explorer that ignores terrain. Excavates crash sites, ruins and Echo Vaults (2 kits) and studies nests.', wayfinder: 'Pathfinder explorer: 4 moves, 3 expedition kits.', militia: 'Basic colonial infantry.',
    caravan: 'Opens a permanent convoy route to a colony or an outpost.', spy: 'Crosses any border. Next to a rival colony: steal a technology they know, or sabotage their production.' }[it.key] || '';
}

// ---------- city ----------
function showCity(c) {
  const G = UI.G; if (!G || !c) return;
  const render = () => {
    const sc = $('screens').firstChild, top = sc ? sc.scrollTop : 0;
    HX.assignWorkers(G, c);
    const r = HX.cityReport(G, c), need = HX.growthNeed(G, c.pop);
    const grow = r.foodNet > 0 ? Math.ceil((need - c.food) / r.foodNet) : null;
    const bcost = HX.borderCost(G, c.claims), bturns = r.cul > 0 ? Math.ceil((bcost - c.culture) / r.cul) : null;
    const items = HX.availableItems(G, c);
    const advice = c.owner === UI.pid ? HX.aiRankProduction(G, c, false).filter(x => x.v > 0).slice(0, 2).map(x => x.it) : [];
    const advised = it => advice.some(a => a.k === it.k && a.key === it.key);
    const units = items.filter(i => i.k === 'u'), great = items.filter(i => i.k === 'b' && (HX.isWonder(i.key) || HX.isProject(i.key))), blds = items.filter(i => i.k === 'b' && !great.includes(i));
    const rate = it => HX.itemRate(r, it);
    const turnsFor = it => { const n = Math.max(1, Math.ceil(Math.max(0, HX.itemCost(G, it, c.owner) - c.prod) / Math.max(0.01, rate(it)))); return rate(it) > 0 ? `${n} turn${n > 1 ? 's' : ''}` : '–'; };
    const pick = (it, queue) => { HX.setBuild(G, c, it, queue); render(); };
    const itemRow = it => h('div', { class: 'rowbtns' },
      h('button', { class: 'item' + (HX.isWonder(it.key) || HX.isProject(it.key) ? ' great' : ''), onclick: () => pick(it, false) }, h('div', { class: 'ic' }, it.k === 'u' ? unitPortrait(it.key) : itemGlyph(it)),
        h('div', { class: 'tx' }, h('div', { class: 'a' }, HX.itemName(it), advised(it) ? h('span', { class: 'advice' }, '⭐ Advisor') : null), h('div', { class: 'b' }, itemDesc(it))),
        h('div', { class: 'tn' }, turnsFor(it), h('div', { style: 'color:#7b8796;font-size:11px' }, `${HX.itemCost(G, it, c.owner)}⚙️`))),
      c.build ? h('button', { class: 'q', 'aria-label': 'Add to queue', onclick: () => pick(it, true) }, '+') : null);
    const buy = HX.canBuy(G, c);
    const cur = c.build;
    const pct = cur ? Math.min(100, c.prod / HX.itemCost(G, cur, c.owner) * 100) : 0;
    const routes = G.routes.filter(x => x.from === c.id || x.to === c.id);
    const el = screen(
      h('h2', null, backBtn(backToMap), h('span', { onclick: () => renameDlg(c, render), style: 'cursor:pointer' }, (c.capital ? '★ ' : '') + c.name + ' ✎'), h('span', { class: 'badge', style: 'font-size:13px' }, `Size ${c.pop}`)),
      h('div', { class: 'grid2' },
        h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Food'), h('div', { class: 'v' }, h('span', { class: r.foodNet >= 0 ? 'pos' : 'neg' }, `🌾 ${fmtSigned(r.foodNet)}`)),
          h('div', { class: 'prog food' }, h('i', { style: `width:${Math.min(100, Math.max(0, c.food / need * 100))}%` })),
          h('div', { class: 's' }, grow ? `Grows in ${grow} turn${grow > 1 ? 's' : ''} (${fmtN(c.food)}/${need})` : r.foodNet < 0 ? 'Starving' : 'Not growing'), r.growthNote ? h('div', { class: 's neg' }, r.growthNote) : null),
        h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Production'), h('div', { class: 'v' }, `⚙️ ${fmtN(r.prod)}`), h('div', { class: 's' }, r.prodBld !== r.prod ? `${fmtN(r.prodBld)} toward buildings` : 'per turn')),
        h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Credits'), h('div', { class: 'v' }, `💠 ${fmtSigned(r.gold - r.upkeep)}`), h('div', { class: 's' }, `${fmtN(r.gold)} earned, ${r.upkeep} upkeep` + (r.connG ? `, ${r.connG} from road link` : ''))),
        h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Science'), h('div', { class: 'v' }, `🔬 ${fmtN(r.sci)}`), h('div', { class: 's' }, 'per turn')),
        h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Culture'), h('div', { class: 'v' }, `🎭 ${fmtN(r.cul)}`),
          h('div', { class: 's' }, bturns ? `New tile in ${bturns} turn${bturns > 1 ? 's' : ''}` : 'Borders are not growing')),
        h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Citizens'), h('div', { class: 'v' }, `👥 ${c.pop}`), h('div', { class: 's' }, `${c.worked.length} working ${c.worked.length === 1 ? 'tile' : 'tiles'}` + (r.spec ? `, ${r.spec} scholar${r.spec > 1 ? 's' : ''}` : ''))),
        h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Veil'), h('div', { class: 'v' }, `🌫️ ${c.tiles.filter(t => G.map.veil[t]).length}`), h('div', { class: 's' }, 'Veil tiles in this colony\'s land'))),
      h('h3', null, 'Producing'),
      h('div', { class: 'card' },
        cur ? [h('div', { class: 'row' }, h('div', { class: 'ic', style: 'font-size:22px' }, itemGlyph(cur)), h('div', { class: 'grow' }, h('b', null, HX.itemName(cur)), h('div', { class: 'note', style: 'margin:0' }, `${fmtN(c.prod)}/${HX.itemCost(G, cur, c.owner)} · ${prodTurns(c, r)} turns`))),
          h('div', { class: 'prog' }, h('i', { style: `width:${pct}%` })),
          h('div', { class: 'row' }, h('button', { class: 'grow', disabled: !buy.ok || UI.busy, onclick: () => { HX.buyItem(G, c); flushLog(); render(); } }, buy.cost !== undefined ? `Buy now for ${buy.cost}💠` : 'Buy'),
            h('button', { onclick: () => { c.build = c.queue.shift() || null; render(); } }, 'Remove'))]
          : h('div', null, h('b', { class: 'neg' }, 'Nothing in production.'), h('div', { class: 'note' }, 'Pick something below. Stored production carries over between items.'))),
      buy.ok || !cur ? null : h('div', { class: 'note' }, buy.why),
      c.queue.length ? [h('h3', null, 'Queue'), h('div', { class: 'col' }, c.queue.map((q, i) => h('div', { class: 'slot' }, h('div', { class: 'meta' }, h('div', { class: 'a' }, `${i + 1}. ${HX.itemName(q)}`)),
        h('button', { class: 'icon', 'aria-label': 'Remove', onclick: () => { HX.removeQueued(G, c, i); render(); } }, '✕'))))] : null,
      toggleRow('Auto production', 'When this colony finishes something and its queue is empty, it picks the next item itself.', !!c.auto, v => { c.auto = v; if (v && !c.build) { HX.aiChooseProduction(G, c); } render(); updateHUD(); }),
      h('h3', null, cur ? 'Change production (tap) or queue (+)' : 'Choose production'),
      advice.length ? [h('div', { class: 'k', style: 'margin-top:4px' }, 'Advisor suggests'), h('div', { class: 'col' }, advice.map(itemRow))] : null,
      h('div', { class: 'k', style: 'margin-top:10px' }, 'Units'),
      h('div', { class: 'col' }, units.filter(i => (!UNITS[i.key].military || UNITS[i.key].cls === 'recon') && !UNITS[i.key].orbital).map(itemRow)),
      (mil => mil.length ? h('details', { class: 'hgroup', open: mil.length <= 4 || HX.majorPlayers(G).some(Q => Q.id !== c.owner && HX.atWar(G, c.owner, Q.id)) ? true : null }, h('summary', null, `Military units (${mil.length})`), h('div', { class: 'col', style: 'padding-bottom:10px' }, mil.map(itemRow))) : null)(units.filter(i => UNITS[i.key].military && UNITS[i.key].cls !== 'recon')),
      (sat => sat.length ? [h('div', { class: 'k', style: 'margin-top:10px' }, 'Satellites'), h('div', { class: 'col' }, sat.map(itemRow))] : null)(units.filter(i => UNITS[i.key].orbital)),
      h('h3', null, 'Buildings'),
      blds.length ? h('div', { class: 'col' }, blds.map(itemRow)) : h('p', null, 'No new buildings available. Research unlocks more.'),
      great.length ? [h('h3', null, 'Wonders and victory projects'), h('div', { class: 'note' }, 'A planetary wonder can be built only once on Veyra. If a rival finishes it first, your production carries over. A victory project starts a countdown: hold the colony until it ends. Neither can be bought.'), h('div', { class: 'col' }, great.map(itemRow))] : null,
      h('h3', null, 'Citizens'),
      seg([['balanced', 'Balanced'], ['food', 'Food'], ['production', 'Prod.'], ['gold', 'Credits']], c.focus, v => { c.focus = v; render(); }),
      h('div', { class: 'note' }, (c.locked.length || c.forcedSpec ? `${c.locked.length} tile${c.locked.length === 1 ? '' : 's'} pinned, ${c.forcedSpec} forced scholar${c.forcedSpec === 1 ? '' : 's'}. ` : '') +
        'The focus picks the remaining tiles while keeping the colony fed. Citizens without a tile become scholars: +1🔬 +1💠 each.'),
      h('button', { style: 'width:100%;margin-top:8px', onclick: () => startManage(c) }, '📌 Manage tiles on the map'),
      h('h3', null, 'Built'),
      h('div', { class: 'chips' }, c.buildings.filter(k => !BUILDINGS[BLDI[k]].hidden).map(k => h('span', { class: 'chip' + (HX.isWonder(k) || HX.isProject(k) ? ' gold' : '') }, itemGlyph({ k: 'b', key: k }) + ' ' + BUILDINGS[BLDI[k]].name)),
        c.buildings.includes('palace') ? h('span', { class: 'chip' }, '🛰️ Command Hub') : null, c.buildings.length <= (c.capital ? 1 : 0) ? h('span', { class: 'note' }, 'Nothing yet.') : null),
      routes.length ? [h('h3', null, 'Convoy routes'), h('div', { class: 'chips' }, routes.map(x => { const a = HX.cityById(G, x.from), b = HX.cityById(G, x.to); return h('span', { class: 'chip' }, `🚚 ${a ? a.name : '?'} → ${b ? b.name : '?'}`); }))] : null,
      h('div', { class: 'bar' }, h('button', { class: 'pri', onclick: backToMap }, 'Back to map')));
    showScreen(el); el.scrollTop = top;
  };
  render();
}

// ---------- research: see webui.js for the technology web ----------
function techUnlocks(t) {
  const out = [];
  for (const B of BUILDINGS) if (B.tech === t.key && !B.hidden) out.push([itemGlyph({ k: 'b', key: B.key }) + ' ' + B.name + (B.aff ? ` (${HX.AFFINITIES.find(a => a.key === B.aff[0]).glyph}${B.aff[1]})` : ''), false, B.wonder || B.project]);
  for (let i = 1; i < IMPROV.length; i++) if (IMPROV[i].tech === t.key) out.push(['🛠️ ' + IMPROV[i].name, false]);
  const units = BUILDABLE_UNITS.filter(k => UNITS[k].tech === t.key);
  const plain = units.filter(k => !UNITS[k].aff), aff = units.filter(k => UNITS[k].aff);
  for (const k of plain) out.push([UNITS[k].glyph + ' ' + UNITS[k].name, false]);
  if (aff.length) out.push([`⬆️ Tier ${UNITS[aff[0]].tier} units: ` + aff.map(k => UNITS[k].name).join(', '), false]);
  for (const R0 of RES) if (R0.reveal === t.key) out.push([R0.glyph + ' Reveals ' + R0.name, false]);
  if (t.key === 'maglev') out.push(['🚄 Maglev roads', false]);
  const fx = t.fx || {};
  if (fx.routes) out.push(['🚚 +1 convoy route', false]);
  if (fx.irrigation) out.push(['🌾 Farms by fresh water +1 food', false]);
  if (fx.millP) out.push(['🍄 Spore Mills +1 production', false]);
  if (fx.policyCost) out.push(['🎴 Virtues 10% cheaper', false]);
  if (fx.builderCharges) out.push(['🛠️ Riggers +1 charge', false]);
  if (fx.healAll) out.push([`❤️ Units heal ${fx.healAll} more`, false]);
  if (fx.sciPct) out.push([`🔬 +${fx.sciPct}% science`, false]);
  if (fx.combatPct) out.push([`⚔️ +${fx.combatPct}% combat`, false]);
  if (fx.digPct) out.push([`⛏ Excavations +${fx.digPct}%`, false]);
  if (fx.satLife) out.push([`🛰️ Satellites +${fx.satLife} turns`, false]);
  for (const k in HX.SATS) if (HX.SATS[k].tech === t.key) out.push([HX.SATS[k].glyph + ' ' + HX.SATS[k].name + (HX.SATS[k].aff ? ` (${HX.AFFINITIES.find(a => a.key === HX.SATS[k].aff[0]).glyph}${HX.SATS[k].aff[1]})` : ''), false]);
  for (const l of t.later || []) out.push(['✨ ' + l, false]);
  return out;
}

// ---------- empire ----------
function showEmpire() {
  const G = UI.G; if (!G) return;
  const P = G.players[UI.pid], rep = HX.civReport(G, UI.pid), hp = rep.hap;
  const nUnits = G.units.filter(u => u.owner === UI.pid).length, free = nUnits - rep.unitUpkeep;
  const strat = HX.strategicCounts(G, UI.pid);
  const cap = HX.routeCapacity(G, UI.pid), used = G.routes.filter(r => r.owner === UI.pid).length;
  const row = (k, v, cls) => h('tr', null, h('td', null, k), h('td', { class: 'n ' + (cls || '') }, v));
  const effect = hp.net >= 0 ? 'Steady. Colonies grow normally.' : hp.net > -10 ? 'Low morale. Colony growth is halved.' : 'Morale has collapsed. Growth stops; production and credits drop 20%.';
  showScreen(screen(
    h('h2', null, backBtn(backToMap), CIVS[P.civ].name),
    h('div', { class: 'note' }, `${CIVS[P.civ].leader}. ${CIVS[P.civ].bonus}: ${CIVS[P.civ].bonusText}` + (P.loadout ? ` Landed with ${['colonists', 'cargo', 'ships'].map((g, i) => (HX.LOADOUT[g].find(x => x.key === [P.loadout.col, P.loadout.cargo, P.loadout.ship][i]) || {}).name).join(', ')}.` : '')),
    h('h3', null, 'Credits'),
    h('table', { class: 'tbl' },
      row('Treasury', `💠 ${fmtN(P.gold)}`),
      row('Earned by colonies', fmtSigned(rep.gold), 'pos'),
      row('Building upkeep', fmtSigned(-rep.upkeep), 'neg'),
      row(`Unit upkeep (${nUnits} units, ${Math.max(0, free)} free)`, fmtSigned(-rep.unitUpkeep), rep.unitUpkeep ? 'neg' : ''),
      row('Net per turn', fmtSigned(rep.goldNet), rep.goldNet >= 0 ? 'pos' : 'neg')),
    h('h3', null, 'Morale'),
    h('table', { class: 'tbl' },
      row('Base', '+' + hp.base),
      row(`Luxuries (${hp.lux.length ? hp.lux.join(', ') : 'none improved'})`, '+' + hp.lux.length * ECON.luxHappy),
      row('Buildings', '+' + hp.bld),
      row(`Colonies (${hp.cities})`, '−' + hp.cities * ECON.perCityUnhappy),
      row(`Population (${hp.pop})`, '−' + Math.floor(hp.pop * ECON.perPopUnhappy)),
      hp.veil ? row('Veil inside your borders', '−' + hp.veil, 'neg') : null,
      row('Net', String(hp.net), hp.net >= 0 ? 'pos' : 'neg')),
    h('p', null, effect + ' Each improved luxury type adds ' + ECON.luxHappy + '. Every 4 Veil tiles inside your borders cost 1 morale until you reach Communion 2.'),
    P.golden > G.turn ? h('div', { class: 'card gold' }, h('b', null, '✨ Flourishing'), h('div', { class: 's' }, `+20% production and credits in every colony until turn ${P.golden}.`))
      : h('div', { class: 'kv' }, h('div', { class: 'k' }, '✨ Toward Flourishing'), h('div', { class: 'prog' }, h('i', { style: `width:${Math.min(100, (P.goldenPts || 0) / HX.goldenNeed(G, P) * 100)}%` })),
        h('div', { class: 's' }, `${Math.floor(P.goldenPts || 0)}/${HX.goldenNeed(G, P)}. Each turn adds your net morale (up to 15). Flourishing gives +20% production and credits for 10 turns.`)),
    h('h3', null, 'The wild'),
    h('div', { class: 'kv' }, h('div', { class: 'k' }, '🦗 Fauna anger toward you'), h('div', { class: 'prog' }, h('i', { style: `width:${Math.min(100, P.rage || 0)}%;background:#e07ab8` })),
      h('div', { class: 's' }, `${Math.round(P.rage || 0)}/100. ${HX.faunaHostile(G, UI.pid) ? 'The fauna are hunting your units.' : 'The fauna leave you alone except near their nests.'} Attacking beasts and nests raises it; it fades when you leave them be.`)),
    h('h3', null, 'Output'),
    h('table', { class: 'tbl' },
      row('Science per turn', `🔬 ${fmtN(rep.sci)}`),
      row('Culture per turn', `🎭 ${fmtN(rep.cul)}`),
      row('Convoy routes', `🚚 ${used}/${cap}`),
      row('Virtues', `🎴 ${P.policies.length} adopted, ${P.treesDone.length} synergies`),
      row('Satellites in orbit', `🛰️ ${G.sats.filter(x => x.owner === UI.pid).length}`),
      row('Excavations', `⛏ ${P.stats.digs || 0} · Echo Vaults decoded ${P.vaults.length}`),
      row('Strategic resources', `🐚${strat.chitin} ⚙️${strat.ferrite} 🔷${strat.lumenite}`)),
    relicSection(G, UI.pid),
    h('h3', null, 'Visionaries'),
    h('div', { class: 'col' }, Object.keys(HX.GREAT).map(k => { const P0 = G.players[UI.pid], pts = Math.floor((P0.gp || {})[k] || 0), need = HX.greatThreshold(G, P0, k), rate = HX.greatRates(G, UI.pid)[k];
      return h('div', { class: 'kv' }, h('div', { class: 'k' }, `${HX.GREAT[k].glyph} ${HX.GREAT[k].name}` + ((P0.gpBorn || {})[k] ? ` · ${(P0.gpBorn || {})[k]} so far` : '')),
        h('div', { class: 'prog' }, h('i', { style: `width:${Math.min(100, pts / need * 100)}%` })),
        h('div', { class: 's' }, `${pts}/${need}` + (k === 'general' ? ' · earned in battle' : rate > 0 ? ` · +${fmtN(rate)} per turn, about ${Math.ceil((need - pts) / rate)} turns` : ' · build ' + { scientist: 'Field Labs and Xeno Institutes', engineer: 'Fab Foundries and Drill Rigs', merchant: 'Credit Exchanges and convoy routes', artist: 'Commons Domes and Concord Forums' }[k]))); })),
    h('h3', null, 'Colonies'),
    rep.cities.map(({ c, r }) => h('button', { class: 'cityrow', onclick: () => showCity(c) },
      h('div', { class: 'tx' }, h('b', null, (c.capital ? '★ ' : '') + c.name + ` · ${c.pop}`),
        h('div', { class: 'b' }, `🌾${fmtSigned(r.foodNet)} ⚙️${fmtN(r.prod)} 💠${fmtSigned(r.gold - r.upkeep)} 🔬${fmtN(r.sci)} 🎭${fmtN(r.cul)}`),
        h('div', { class: 'b' }, c.build ? `${HX.itemName(c.build)} · ${prodTurns(c, r)} turns` + (rep.conn.road.has(c.id) ? ' · 🛣️ linked' : '') : 'Nothing in production')),
      h('span', null, '›'))),
    h('div', { class: 'bar' }, h('button', { class: 'pri', onclick: backToMap }, 'Back to map'))));
}

function renameDlg(c, after) {
  const inp = h('input', { type: 'text', value: c.name, maxlength: '24', autocapitalize: 'words' });
  $('modal').replaceChildren(h('div', { class: 'dlg' }, h('h4', null, 'Rename colony'), inp,
    h('div', { class: 'bar' }, h('button', { onclick: closeModal }, 'Cancel'),
      h('button', { class: 'pri', onclick: () => { const v = inp.value.trim().slice(0, 24); if (v) { c.name = v; for (const Q of UI.G.players) if (Q.seen[c.tile]) Q.seen[c.tile].n = v; } closeModal(); after(); } }, 'Rename'))));
  setTimeout(() => { inp.focus(); inp.select(); }, 50);
}

// ---------- world map ----------
function showWorld() {
  const G = UI.G; if (!G) return;
  const w = Math.min(window.innerWidth - 32, 520), hgt = Math.round(w * (G.map.H * 1.5) / (G.map.W * SQ3 + 0.5 * SQ3));
  const cv = h('canvas', { 'aria-label': 'World map' });
  const wrap = h('div', { class: 'worldwrap' }, cv);
  const scale = renderer.drawWorld(cv, w, hgt);
  cv.addEventListener('pointerup', e => {
    const b = cv.getBoundingClientRect(), px = e.clientX - b.left, py = e.clientY - b.top;
    const r = Math.max(0, Math.min(G.map.H - 1, Math.floor(py / scale.th))), c = Math.floor(px / scale.tw - 0.5 * (r & 1));
    const t = G._grid.idx(c, r);
    closeModal(); if (t >= 0) renderer.centerOn(t, true);
  });
  $('modal').replaceChildren(h('div', { class: 'dlg', style: 'max-width:560px' }, h('h4', null, 'Veyra'), h('p', null, 'Tap anywhere to jump there. White squares are colonies you know, yellow dots your units, pink the wild Veil.'), wrap,
    h('div', { class: 'bar' }, h('button', { onclick: closeModal }, 'Close'))));
}

// ---------- log ----------
function showLog(back) {
  const G = UI.G; if (!G) return;
  const rows = G.log.filter(e => e.pid === UI.pid || e.pid === -1).slice(-120).reverse();
  showScreen(screen(
    h('h2', null, backBtn(back || backToMap), 'Event log'),
    rows.length ? rows.map(e => h('button', { class: 'logrow', onclick: () => { if (e.tile >= 0) { closeScreens(); refreshAll(); renderer.centerOn(e.tile, true); } } },
      h('span', { class: 't' }, 'T' + e.turn), h('span', null, e.msg), e.tile >= 0 ? h('span', { style: 'margin-left:auto;color:var(--mut)' }, '›') : null)) : h('p', null, 'Nothing has happened yet.'),
    h('div', { class: 'bar' }, h('button', { class: 'pri', onclick: back || backToMap }, 'Back'))));
}

function showRivals(back) { showDiplomacy(back); }
function civName(G, pid) { return CIVS[G.players[pid].civ].name; }
function armyCompare(G, me, them) {
  const ratio = HX.militaryPower(G, them) / Math.max(1, HX.militaryPower(G, me));
  return ratio > 1.3 ? 'Much stronger army' : ratio > 1.08 ? 'Stronger army' : ratio < 0.75 ? 'Much weaker army' : ratio < 0.93 ? 'Weaker army' : 'Similar army';
}
function offerCard(G, o, render) {
  const from = civName(G, o.from);
  let title, text, yes = 'Accept', no = 'Decline';
  if (o.kind === 'peace') { title = `The ${from} offer peace`; text = 'A treaty holds for 10 turns.'; yes = 'Make peace'; }
  else if (o.kind === 'deal') { title = `The ${from} propose a deal`; text = o.items.map(it => (it.by === -1 ? '🤝 ' : it.by === UI.pid ? 'You give: ' : 'You get: ') + HX.itemLabel(G, it)).join('\n'); }
  else if (o.kind === 'tribute') { title = `The ${from} demand tribute`; text = `They want ${o.amount} credits. Refusing angers them and they may attack.`; yes = `Pay ${o.amount}`; no = 'Refuse'; }
  else if (o.kind === 'joinwar') { title = `The ${from} ask for help`; text = `They want you to declare war on the ${civName(G, o.target)}. Joining pleases them; refusing does not anger them.`; yes = 'Declare war'; }
  else if (o.kind === 'ally') { title = `The ${from} propose an alliance`; text = `Allies share vision and are called into each other's wars for ${HX.DIP.allyTurns} turns.`; }
  return h('div', { class: 'card relcard offer', style: `border-left:4px solid ${CIVS[G.players[o.from].civ].color}` },
    h('div', { class: 't' }, title), h('div', { class: 's pre' }, text), h('div', { class: 's' }, `Expires after turn ${o.turn + HX.DIP.offerTurns}.`),
    h('div', { class: 'bar' }, h('button', { onclick: () => { HX.answerOffer(G, o.id, false); flushLog(); render(); updateHUD(); } }, no),
      h('button', { class: o.kind === 'joinwar' ? 'danger' : 'pri', onclick: () => { if (!HX.answerOffer(G, o.id, true)) toast('That deal is no longer possible.'); flushLog(); render(); updateHUD(); refreshAll(); } }, yes)));
}
function attitudeBlock(G, Q) {
  const a = HX.attitude(G, Q.id, UI.pid);
  const open = h('div', { class: 'why', hidden: true }, a.reasons.length ? a.reasons.map(([t, v]) => h('div', { class: 'reason' }, h('span', null, t), h('b', { class: v > 0 ? 'pos' : 'neg' }, fmtSigned(v)))) : h('div', { class: 's' }, 'No strong feelings either way.'));
  const quote = leaderLine(G, Q.id, a.name), ag = HX.AGENDAS[CIVS[Q.civ].agenda], qa = HX.primaryAff(Q);
  return [quote ? h('div', { class: 'quote' }, `“${quote}”`, h('span', null, ` — ${CIVS[Q.civ].leader}`)) : null,
    ag ? h('div', { class: 's' }, `Agenda: ${ag.name}. ${ag.text}` + (qa ? ` Follows ${HX.AFFINITIES.find(x => x.key === qa).glyph} ${HX.AFFINITIES.find(x => x.key === qa).name} ${HX.affLevel(Q, qa)}.` : '')) : null,
    h('button', { class: 'att lv' + a.name.toLowerCase(), onclick: () => { open.hidden = !open.hidden; } }, h('span', { class: 'face' }, a.face), h('span', null, `${a.name} toward you`), h('small', null, 'Why? ›')), open];
}
// Outposts you have met: influence, bonus, gifts, absorption, war and peace.
function freeCitySection(G, P, render) {
  const mins = G.players.filter(M => M.minor && P.met.includes(M.id));
  if (!mins.length) return null;
  return [h('h3', null, 'Outposts'), mins.map(M => {
    const civ = CIVS[M.civ], type = HX.MINOR_TYPES[civ.minor], st = M.alive ? HX.minorStatus(G, M.id, UI.pid) : 'gone', inf = Math.round(HX.influence(G, M.id, UI.pid)), ally = M.alive ? HX.minorAlly(G, M.id) : -1;
    const label = { war: '⚔️ At war', ally: '🤝 Your ally', friend: '🙂 Friends', neutral: '😐 Neutral', gone: 'Gone' }[st];
    const gift = amt => h('button', { disabled: !M.alive || st === 'war' || P.gold < amt, onclick: () => { if (HX.giftGold(G, UI.pid, M.id, amt)) { Sound.play('deal'); flushLog(); updateHUD(); render(); } } }, `Gift ${amt}💠 (+${HX.giftInfluence(G, UI.pid, amt)})`);
    const ab = M.alive ? HX.absorbStatus(G, UI.pid, M.id) : null;
    const war = HX.atWar(G, UI.pid, M.id), ws = HX.warStatus(G, UI.pid, M.id);
    return h('div', { class: 'card relcard', style: `border-left:4px solid ${civ.color}` },
      h('div', { class: 'row' }, civEmblem(civ, 40), h('div', { class: 't' }, civ.name)),
      h('div', { class: 's' }, `${type.glyph} ${type.name}. Friends receive ${type.what} every turn; the ally receives twice as much. Convoy routes here raise your influence.`),
      M.alive ? h('div', { class: 'vrow' }, h('span', null, label), h('div', { class: 'prog' }, h('i', { style: `width:${Math.max(0, Math.min(100, inf / HX.MINOR.ally * 100))}%;background:${civ.color}` })), h('span', null, String(inf))) : null,
      M.alive ? h('div', { class: 's' }, `Influence ${inf}: friends at ${HX.MINOR.friend}, ally at ${HX.MINOR.ally} if nobody has more, absorb at ${HX.MINOR.absorb}. Falls by 1 each turn.` + (ally >= 0 && ally !== UI.pid ? ` Currently allied with ${P.met.includes(ally) ? 'the ' + CIVS[G.players[ally].civ].name : 'someone you have not met'}.` : '')) : null,
      M.alive ? h('button', { class: ab.ok ? 'pri' : '', style: 'width:100%;margin-top:6px', disabled: !ab.ok, onclick: () => confirmDlg(`Absorb ${civ.name}?`, `The outpost joins your faction peacefully for ${ab.cost} credits, with its colony and its garrison.`, 'Absorb', () => { if (HX.absorbOutpost(G, UI.pid, M.id)) { Sound.play('wonder'); flushLog(); updateHUD(); refreshAll(); render(); } }) }, ab.ok ? `Absorb for ${ab.cost}💠` : `Absorb: ${ab.why}`) : null,
      M.alive ? h('div', { class: 'rowbtns' }, gift(Math.round(50 * paceOf0(G))), gift(Math.round(150 * paceOf0(G))),
        war ? h('button', { onclick: () => { const r2 = HX.offerPeace(G, UI.pid, M.id); toast(r2.ok ? `${civ.name} accepts peace.` : r2.why); flushLog(); render(); updateHUD(); } }, 'Offer peace')
          : h('button', { class: 'danger', disabled: !ws.ok, onclick: () => confirmDlg(`Attack ${civ.name}?`, 'Every faction will remember that you attacked an outpost. Its friends lose its bonus.', 'Declare war', () => { HX.declareWar(G, UI.pid, M.id); flushLog(); render(); updateHUD(); refreshAll(); }, true) }, 'Declare war')) : null);
  })];
}
function paceOf0(G) { return (G.cfg.turnLimit || 350) / 350; }
function showDiplomacy(back) {
  const G = UI.G; if (!G) return;
  const P = G.players[UI.pid];
  const render = () => {
    const rows = HX.majorPlayers(G).filter(Q => Q.id !== UI.pid && P.met.includes(Q.id));
    const offers = G.offers.filter(o => o.to === UI.pid);
    const el = screen(
      h('h2', null, backBtn(back || backToMap), 'Diplomacy'),
      offers.length ? [h('h3', null, `Waiting for your answer (${offers.length})`), offers.map(o => offerCard(G, o, render))] : null,
      h('h3', null, 'Factions you know'),
      rows.length ? rows.map(Q => {
        const civ = CIVS[Q.civ], war = HX.atWar(G, UI.pid, Q.id), ws = HX.warStatus(G, UI.pid, Q.id), rec = HX.warRecord(G, UI.pid, Q.id);
        const r = G.dip[HX.warKey(UI.pid, Q.id)] || {}, chips = [];
        if (!Q.alive) chips.push(h('span', { class: 'chip' }, 'Destroyed'));
        else if (war) chips.push(h('span', { class: 'chip war' }, `⚔️ War since turn ${rec.since}`));
        else chips.push(h('span', { class: 'chip' }, ws.ok ? '🕊️ Peace' : '🕊️ ' + ws.why.replace('A peace treaty holds until', 'Treaty to')));
        if (HX.allied(G, UI.pid, Q.id)) chips.push(h('span', { class: 'chip ally' }, `🤝 Allied to turn ${r.ally}`));
        else if (HX.hasOB(G, UI.pid, Q.id)) chips.push(h('span', { class: 'chip' }, `🚪 Open borders to turn ${r.ob}`));
        const deals = G.deals.filter(d => (d.from === UI.pid && d.to === Q.id) || (d.from === Q.id && d.to === UI.pid));
        for (const d of deals) chips.push(h('span', { class: 'chip' }, (d.from === UI.pid ? '↗ ' : '↙ ') + (d.kind === 'gpt' ? `${d.amount} credits/turn` : RES[RESI[d.key]].glyph + ' ' + RES[RESI[d.key]].name) + ` to t${d.until}`));
        if (HX.denounced(G, Q.id, UI.pid)) chips.push(h('span', { class: 'chip war' }, 'Denounced you'));
        if (HX.denounced(G, UI.pid, Q.id)) chips.push(h('span', { class: 'chip later' }, 'You denounced them'));
        for (const a of HX.alliesOf(G, Q.id)) if (a !== UI.pid) chips.push(h('span', { class: 'chip later' }, `Allied with the ${civName(G, a)}`));
        const ncity = G.cities.filter(c => c.owner === Q.id).length;
        return h('div', { class: 'card relcard', style: `border-left:4px solid ${civ.color}` },
          h('div', { class: 'row' }, civEmblem(civ, 40), h('div', { class: 't' }, civ.name)), h('div', { class: 's' }, `${civ.leader} · ${ncity} ${ncity === 1 ? 'colony' : 'colonies'} · ${armyCompare(G, UI.pid, Q.id)}`),
          Q.alive && !Q.human ? attitudeBlock(G, Q) : Q.human ? h('div', { class: 's', style: 'margin-top:6px' }, '👤 Another player on this phone. Offers wait for their turn.') : null,
          h('div', { class: 'chips', style: 'margin-top:6px' }, chips),
          war && Q.alive ? h('div', { class: 's', style: 'margin-top:4px' }, `You lost ${rec.lost[UI.pid] || 0} units, they lost ${rec.lost[Q.id] || 0}.`) : null,
          !Q.alive ? null : h('div', { class: 'rowbtns' },
            h('button', { class: 'pri', onclick: () => showTrade(Q.id, render) }, war ? 'Negotiate' : 'Trade'),
            war && Q.human ? h('button', { disabled: G.offers.some(o => o.from === UI.pid && o.to === Q.id && o.kind === 'peace'), onclick: () => { G.offers.push({ id: G.nextId++, kind: 'peace', from: UI.pid, to: Q.id, turn: G.turn }); toast('Peace offer sent. They answer on their turn.'); render(); } }, 'Offer peace') :
            war ? h('button', { onclick: () => { const r2 = HX.offerPeace(G, UI.pid, Q.id); toast(r2.ok ? `The ${civ.name} accept peace.` : r2.why); flushLog(); render(); updateHUD(); } }, 'Offer peace')
              : h('button', { class: 'danger', disabled: !ws.ok, onclick: () => confirmDlg(`Declare war on the ${civ.name}?`, (HX.hasOB(G, UI.pid, Q.id) ? 'This breaks your open-borders treaty, and every civilization will remember it. ' : '') + 'Their units and colonies become targets until peace is made.' + (HX.alliesOf(G, Q.id).length ? ` Their allies (${HX.alliesOf(G, Q.id).map(a => civName(G, a)).join(', ')}) may join them.` : ''), 'Declare war', () => { HX.declareWar(G, UI.pid, Q.id); flushLog(); render(); updateHUD(); refreshAll(); }, true) }, 'Declare war'),
            war ? null : h('button', { disabled: HX.denounced(G, UI.pid, Q.id), onclick: () => confirmDlg(`Denounce the ${civ.name}?`, 'They will dislike you for 30 turns. Their enemies will like you a little more.', 'Denounce', () => { HX.denounce(G, UI.pid, Q.id); flushLog(); render(); }, true) }, 'Denounce'),
            war ? null : h('button', { onclick: () => { const st = HX.tributeAcceptable(G, UI.pid, Q.id); confirmDlg(`Demand tribute from the ${civ.name}?`, (Q.human ? `They decide on their turn whether to pay ${HX.tributeAmount(G, UI.pid, Q.id)} gold.` : st.ok ? `They look frightened enough to pay about ${st.amount} gold.` : `They will probably refuse: ${st.why}`) + ' Either way they will resent it, and a refusal may lead to war.', 'Demand', () => { const res = HX.demandTribute(G, UI.pid, Q.id); if (!res.ok) toast(`The ${civ.name} refuse.`); flushLog(); render(); updateHUD(); }); } }, 'Demand tribute'),
            HX.allied(G, UI.pid, Q.id) ? h('button', { class: 'danger', onclick: () => confirmDlg('End the alliance?', 'Breaking an alliance early is remembered as a broken treaty.', 'End alliance', () => { HX.cancelAlliance(G, UI.pid, Q.id); refreshAll(); render(); }, true) }, 'End alliance') : null));
      }) : h('p', null, 'You have not met anyone yet. Explore with Explorers and ships.'),
      freeCitySection(G, P, render),
      h('div', { class: 'note' }, 'Attitude comes from shared history: wars, broken treaties, trade, crowded borders, common enemies, each leader\'s agenda, and whether your affinities agree. Open borders let military units pass through each other\'s land. Allies share vision and join each other\'s wars. The fauna never negotiate.'),
      h('div', { class: 'bar' }, h('button', { class: 'pri', onclick: back || backToMap }, 'Done')));
    showScreen(el);
  };
  render();
}
// ---- trade builder ----
function showTrade(them, back) {
  const G = UI.G, me = UI.pid, items = [];
  const render = () => {
    const war = HX.atWar(G, me, them), civ = CIVS[G.players[them].civ];
    const has = (it) => items.some(x => x.kind === it.kind && x.by === it.by && x.key === it.key && x.target === it.target);
    const add = (it) => { if (it.kind === 'gold' || it.kind === 'gpt') { const old = items.find(x => x.kind === it.kind && x.by === it.by); if (old) { old.amount = it.amount; render(); return; } } if (!has(it)) items.push(it); render(); };
    const options = (giver) => {
      const other = giver === me ? them : me, P = G.players[giver], out = [];
      if (war) return giver === me ? [] : [];
      const g = Math.floor(P.gold);
      for (const amt of [25, 50, 100, 200, 400]) if (g >= amt) out.push([`💠 ${amt}`, { by: giver, kind: 'gold', amount: amt }]);
      if (g >= 10 && ![25, 50, 100, 200, 400].includes(g) && g < 400 && giver === me) out.push([`💠 all ${g}`, { by: giver, kind: 'gold', amount: g }]);
      const inc = Math.floor(P.lastGold || 0);
      for (const amt of [1, 2, 3, 5, 8]) if (inc >= amt) out.push([`💠 ${amt}/turn`, { by: giver, kind: 'gpt', amount: amt }]);
      const theirLux = HX.luxuriesOfSet(G, other);
      for (const k of HX.anyLuxToGive(G, giver)) out.push([`${RES[RESI[k]].glyph} ${RES[RESI[k]].name}${theirLux.has(k) ? ' (they have it)' : ''}`, { by: giver, kind: 'lux', key: k }]);
      for (const k of HX.stratToGive(G, giver)) out.push([`${RES[RESI[k]].glyph} ${RES[RESI[k]].name}`, { by: giver, kind: 'strat', key: k }]);
      for (const Q of HX.majorPlayers(G)) if (Q.alive && Q.id !== me && Q.id !== them && G.players[me].met.includes(Q.id) && G.players[them].met.includes(Q.id) && HX.warStatus(G, giver, Q.id).ok && !HX.allied(G, giver, Q.id))
        out.push([`⚔️ War on the ${civName(G, Q.id)}`, { by: giver, kind: 'war', target: Q.id }]);
      return out.filter(([, it]) => !has(it) && HX.itemStatus(G, me, them, it).ok);
    };
    const both = [];
    if (war) both.push(['🕊️ Peace treaty', { by: -1, kind: 'peace' }]);
    else { both.push(['🚪 Open borders', { by: -1, kind: 'ob' }]); both.push(['🤝 Alliance', { by: -1, kind: 'ally' }]); }
    const bothOpts = both.filter(([, it]) => !has(it) && HX.itemStatus(G, me, them, it).ok);
    const human = G.players[them].human;
    const v = !items.length ? null : human ? (items.every(it => HX.itemStatus(G, me, them, it).ok) ? { ok: true, human: true } : { ok: false, why: 'Something in this deal is no longer possible.' }) : HX.dealVerdict(G, them, me, items);
    const side = (title, list) => h('div', { class: 'tside' }, h('div', { class: 'k' }, title),
      list.length ? list.map(it => h('button', { class: 'titem', onclick: () => { items.splice(items.indexOf(it), 1); render(); } }, h('span', null, HX.itemLabel(G, it)), h('b', null, '×'))) : h('div', { class: 's' }, 'Nothing'));
    const pick = (title, opts) => opts.length ? [h('div', { class: 'k', style: 'margin-top:10px' }, title), h('div', { class: 'chips' }, opts.map(([label, it]) => h('button', { class: 'chip add', onclick: () => add(it) }, '+ ' + label)))] : null;
    const verdict = !v ? h('div', { class: 'verdict' }, 'Add items to build a deal. Their response updates as you go.')
      : v.ok && v.human ? h('div', { class: 'verdict' }, `👤 The ${civ.name} decide on their turn.`)
      : v.ok ? h('div', { class: 'verdict ok' }, `${HX.attitude(G, them, me).face} The ${civ.name} would accept this.`)
      : h('div', { class: 'verdict no' }, `${HX.attitude(G, them, me).face} ${v.why}`);
    const canFix = v && !v.ok && v.need && v.need <= 400;
    const el = screen(
      h('h2', null, backBtn(() => (back ? back() : backToMap())), (war ? 'Negotiate with the ' : 'Trade with the ') + civ.name),
      h('div', { class: 'tgrid' }, side('You give', items.filter(it => it.by === me)), side('They give', items.filter(it => it.by === them))),
      items.some(it => it.by === -1) ? side('Both sides', items.filter(it => it.by === -1)) : null,
      verdict,
      pick('Add from you', options(me)), pick('Ask from them', options(them)), pick('Treaties', bothOpts),
      war ? h('p', { class: 'note' }, 'While at war, only a peace treaty can be discussed here.') : null,
      h('div', { class: 'bar' },
        canFix && G.players[me].gold >= v.need ? h('button', { onclick: () => add({ by: me, kind: 'gold', amount: v.need + ((items.find(x => x.kind === 'gold' && x.by === me) || {}).amount || 0) }) }, `Add ${v.need} credits`) : null,
        human ? h('button', { class: 'pri', disabled: !v || !v.ok, onclick: () => { G.offers.push({ id: G.nextId++, kind: 'deal', from: me, to: them, items: items.slice(), turn: G.turn }); toast(`Offer sent to the ${civ.name}.`); back ? back() : backToMap(); } }, 'Send offer') :
        h('button', { class: 'pri', disabled: !v || !v.ok, onclick: () => { HX.executeDeal(G, me, them, items.slice()); flushLog(); toast(`Deal agreed with the ${civ.name}.`); updateHUD(); refreshAll(); back ? back() : backToMap(); } }, 'Propose deal')));
    showScreen(el);
  };
  render();
}

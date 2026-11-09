// ===== screens.js : city, research and empire screens =====
function backToMap() { closeScreens(); refreshAll(); }
function itemGlyph(it) {
  if (it.k === 'u') return UNITS[it.key].glyph;
  return { monument: '🗿', granary: '🌾', library: '📚', market: '🏪', temple: '⛩️', amphitheater: '🎭', arena: '🏟️', harbor: '⚓', courthouse: '⚖️',
    aqueduct: '🚰', workshop: '🔧', university: '🎓', lighthouse: '🗼', bank: '🏦', printing: '📰', observatory: '🔭', opera: '🎼', museum: '🖼️',
    factory: '🏭', laboratory: '⚗️', hospital: '🏥', stock_exchange: '📈' }[it.key] || '🏛';
}
function itemDesc(it) {
  if (it.k === 'b') { const B = BUILDINGS[BLDI[it.key]]; return B.desc + (B.upkeep ? ` Upkeep ${B.upkeep}💰.` : ''); }
  return { settler: 'Founds a new city. Costs 1 population; the city must be size 2.', builder: 'Builds farms, mines, roads and more. 3 charges.',
    scout: 'Fast explorer. Ignores terrain movement costs.', militia: 'Basic defender. Combat arrives in a later build.',
    caravan: 'Opens a permanent trade route.' }[it.key] || '';
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
    const units = items.filter(i => i.k === 'u'), blds = items.filter(i => i.k === 'b');
    const rate = it => HX.itemRate(r, it);
    const turnsFor = it => { const n = Math.max(1, Math.ceil(Math.max(0, HX.itemCost(G, it, c.owner) - c.prod) / Math.max(0.01, rate(it)))); return rate(it) > 0 ? `${n} turn${n > 1 ? 's' : ''}` : '–'; };
    const pick = (it, queue) => { HX.setBuild(G, c, it, queue); render(); };
    const itemRow = it => h('div', { class: 'rowbtns' },
      h('button', { class: 'item', onclick: () => pick(it, false) }, h('div', { class: 'ic' }, itemGlyph(it)),
        h('div', { class: 'tx' }, h('div', { class: 'a' }, HX.itemName(it)), h('div', { class: 'b' }, itemDesc(it))),
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
        h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Gold'), h('div', { class: 'v' }, `💰 ${fmtSigned(r.gold - r.upkeep)}`), h('div', { class: 's' }, `${fmtN(r.gold)} earned, ${r.upkeep} upkeep` + (r.connG ? `, ${r.connG} from road link` : ''))),
        h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Science'), h('div', { class: 'v' }, `🔬 ${fmtN(r.sci)}`), h('div', { class: 's' }, 'per turn')),
        h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Culture'), h('div', { class: 'v' }, `🎭 ${fmtN(r.cul)}`),
          h('div', { class: 's' }, bturns ? `New tile in ${bturns} turn${bturns > 1 ? 's' : ''}` : 'Borders are not growing')),
        h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Citizens'), h('div', { class: 'v' }, `👥 ${c.pop}`), h('div', { class: 's' }, `${c.worked.length} working ${c.worked.length === 1 ? 'tile' : 'tiles'}` + (r.spec ? `, ${r.spec} scholar${r.spec > 1 ? 's' : ''}` : '')))),
      h('h3', null, 'Producing'),
      h('div', { class: 'card' },
        cur ? [h('div', { class: 'row' }, h('div', { class: 'ic', style: 'font-size:22px' }, itemGlyph(cur)), h('div', { class: 'grow' }, h('b', null, HX.itemName(cur)), h('div', { class: 'note', style: 'margin:0' }, `${fmtN(c.prod)}/${HX.itemCost(G, cur, c.owner)} · ${prodTurns(c, r)} turns`))),
          h('div', { class: 'prog' }, h('i', { style: `width:${pct}%` })),
          h('div', { class: 'row' }, h('button', { class: 'grow', disabled: !buy.ok || UI.busy, onclick: () => { HX.buyItem(G, c); flushLog(); render(); } }, buy.cost !== undefined ? `Buy now for ${buy.cost}💰` : 'Buy'),
            h('button', { onclick: () => { c.build = c.queue.shift() || null; render(); } }, 'Remove'))]
          : h('div', null, h('b', { class: 'neg' }, 'Nothing in production.'), h('div', { class: 'note' }, 'Pick something below. Stored production carries over between items.'))),
      buy.ok || !cur ? null : h('div', { class: 'note' }, buy.why),
      c.queue.length ? [h('h3', null, 'Queue'), h('div', { class: 'col' }, c.queue.map((q, i) => h('div', { class: 'slot' }, h('div', { class: 'meta' }, h('div', { class: 'a' }, `${i + 1}. ${HX.itemName(q)}`)),
        h('button', { class: 'icon', 'aria-label': 'Remove', onclick: () => { HX.removeQueued(G, c, i); render(); } }, '✕'))))] : null,
      h('h3', null, cur ? 'Change production (tap) or queue (+)' : 'Choose production'),
      h('div', { class: 'col' }, units.map(itemRow)),
      h('h3', null, 'Buildings'),
      blds.length ? h('div', { class: 'col' }, blds.map(itemRow)) : h('p', null, 'No new buildings available. Research unlocks more.'),
      h('h3', null, 'Citizens'),
      seg([['balanced', 'Balanced'], ['food', 'Food'], ['production', 'Prod.'], ['gold', 'Gold']], c.focus, v => { c.focus = v; render(); }),
      h('div', { class: 'note' }, (c.locked.length || c.forcedSpec ? `${c.locked.length} tile${c.locked.length === 1 ? '' : 's'} pinned, ${c.forcedSpec} forced scholar${c.forcedSpec === 1 ? '' : 's'}. ` : '') +
        'The focus picks the remaining tiles while keeping the city fed. Citizens without a tile become scholars: +1🔬 +1💰 each.'),
      h('button', { style: 'width:100%;margin-top:8px', onclick: () => startManage(c) }, '📌 Manage tiles on the map'),
      h('h3', null, 'Built'),
      h('div', { class: 'chips' }, c.buildings.filter(k => !BUILDINGS[BLDI[k]].hidden).map(k => h('span', { class: 'chip' }, itemGlyph({ k: 'b', key: k }) + ' ' + BUILDINGS[BLDI[k]].name)),
        c.buildings.includes('palace') ? h('span', { class: 'chip' }, '👑 Palace') : null, c.buildings.length <= (c.capital ? 1 : 0) ? h('span', { class: 'note' }, 'Nothing yet.') : null),
      routes.length ? [h('h3', null, 'Trade routes'), h('div', { class: 'chips' }, routes.map(x => { const a = HX.cityById(G, x.from), b = HX.cityById(G, x.to); return h('span', { class: 'chip' }, `🐪 ${a ? a.name : '?'} → ${b ? b.name : '?'}`); }))] : null,
      h('div', { class: 'bar' }, h('button', { class: 'pri', onclick: backToMap }, 'Back to map')));
    showScreen(el); el.scrollTop = top;
  };
  render();
}

// ---------- research ----------
function techUnlocks(t) {
  const out = [];
  for (const B of BUILDINGS) if (B.tech === t.key && !B.hidden) out.push([itemGlyph({ k: 'b', key: B.key }) + ' ' + B.name, false]);
  for (let i = 1; i < IMPROV.length; i++) if (IMPROV[i].tech === t.key) out.push(['🛠️ ' + IMPROV[i].name, false]);
  for (const k of BUILDABLE_UNITS) if (UNITS[k].tech === t.key) out.push([UNITS[k].glyph + ' ' + UNITS[k].name, false]);
  for (const R0 of RES) if (R0.reveal === t.key) out.push([R0.glyph + ' Reveals ' + R0.name, false]);
  if (t.key === 'railroad') out.push(['🛤️ Railroad', false]);
  const fx = t.fx || {};
  if (fx.routes) out.push(['🐪 +1 trade route', false]);
  if (fx.templeH) out.push(['⛩️ Temples +1 happiness', false]);
  if (fx.irrigation) out.push(['🌾 Farms by fresh water +1 food', false]);
  if (fx.millP) out.push(['🪵 Lumber Mills +1 production', false]);
  for (const l of t.later || []) out.push([l, true]);
  return out;
}
function showTech(back) {
  const G = UI.G; if (!G) return;
  const P = G.players[UI.pid];
  const render = () => {
    const sc = $('screens').firstChild, top = sc ? sc.scrollTop : 0;
    const sci = HX.civReport(G, UI.pid).sci;
    const queue = [P.research].concat(P.rqueue).filter(Boolean);
    const card = t => {
      const known = P.techs.includes(t.key), avail = HX.techAvailable(P, t.key), qi = queue.indexOf(t.key);
      const cost = HX.techCost(G, t.key), prog = P.progress[t.key] || 0;
      const n = HX.researchTurns(G, UI.pid, t.key, sci);
      const cls = 'tech ' + (known ? 'known' : qi === 0 ? 'cur' : qi > 0 ? 'queued' : avail ? 'avail' : 'locked');
      const pre = t.pre.filter(k => !P.techs.includes(k)).map(k => TECHS[TECHI[k]].name);
      return h('button', { class: cls, disabled: known, onclick: () => { HX.setResearch(G, UI.pid, t.key); render(); updateHUD(); } },
        h('div', { class: 'top' }, h('span', { class: 'nm' }, (known ? '✓ ' : qi >= 0 ? `${qi + 1}. ` : '') + t.name),
          h('span', { class: 'cs' }, known ? 'Known' : `${cost}🔬 · ${n === Infinity ? '∞' : n} turn${n === 1 ? '' : 's'}`)),
        !known && prog > 0 ? h('div', { class: 'prog sci' }, h('i', { style: `width:${Math.min(100, prog / cost * 100)}%` })) : null,
        !known && pre.length ? h('div', { class: 'pre' }, 'Needs ' + pre.join(', ')) : null,
        h('div', { class: 'chips' }, techUnlocks(t).map(([txt, later]) => h('span', { class: 'chip' + (later ? ' later' : '') }, txt + (later ? ' (later build)' : '')))),
        t.ins && !known ? h('div', { class: 'ins' + (P.insights.includes(t.key) ? ' got' : '') }, (P.insights.includes(t.key) ? '✓ Insight earned: ' : '💡 Insight: ') + t.ins.text) : null);
    };
    const el = screen(
      h('h2', null, backBtn(back || backToMap), 'Research'),
      h('p', null, `🔬 ${fmtN(sci)} science per turn. Tap any tech to research it; locked techs queue their prerequisites. An Insight cuts a tech's cost by a third.`),
      ERAS.map((e, ei) => [h('h3', null, e + ' era'), TECHS.filter(t => t.era === ei).map(card)]),
      h('div', { class: 'bar' }, h('button', { class: 'pri', onclick: back || backToMap }, 'Done')));
    showScreen(el); el.scrollTop = top;
  };
  render();
}

// ---------- empire ----------
function showEmpire() {
  const G = UI.G; if (!G) return;
  const P = G.players[UI.pid], rep = HX.civReport(G, UI.pid), hp = rep.hap;
  const nUnits = G.units.filter(u => u.owner === UI.pid).length, free = nUnits - rep.unitUpkeep;
  const strat = HX.strategicCounts(G, UI.pid);
  const cap = HX.routeCapacity(G, UI.pid), used = G.routes.filter(r => r.owner === UI.pid).length;
  const row = (k, v, cls) => h('tr', null, h('td', null, k), h('td', { class: 'n ' + (cls || '') }, v));
  const effect = hp.net >= 0 ? 'Content. Cities grow normally.' : hp.net > -10 ? 'Unhappy. City growth is halved.' : 'Very unhappy. Growth stops; production and gold drop 20%.';
  showScreen(screen(
    h('h2', null, backBtn(backToMap), CIVS[P.civ].name),
    h('h3', null, 'Gold'),
    h('table', { class: 'tbl' },
      row('Treasury', `💰 ${fmtN(P.gold)}`),
      row('Earned by cities', fmtSigned(rep.gold), 'pos'),
      row('Building upkeep', fmtSigned(-rep.upkeep), 'neg'),
      row(`Unit upkeep (${nUnits} units, ${Math.max(0, free)} free)`, fmtSigned(-rep.unitUpkeep), rep.unitUpkeep ? 'neg' : ''),
      row('Net per turn', fmtSigned(rep.goldNet), rep.goldNet >= 0 ? 'pos' : 'neg')),
    h('h3', null, 'Happiness'),
    h('table', { class: 'tbl' },
      row('Base', '+' + hp.base),
      row(`Luxuries (${hp.lux.length ? hp.lux.join(', ') : 'none improved'})`, '+' + hp.lux.length * ECON.luxHappy),
      row('Buildings', '+' + hp.bld),
      row(`Cities (${hp.cities})`, '−' + hp.cities * ECON.perCityUnhappy),
      row(`Population (${hp.pop})`, '−' + Math.floor(hp.pop * ECON.perPopUnhappy)),
      row('Net', String(hp.net), hp.net >= 0 ? 'pos' : 'neg')),
    h('p', null, effect + ' Each improved luxury type adds ' + ECON.luxHappy + '.'),
    h('h3', null, 'Output'),
    h('table', { class: 'tbl' },
      row('Science per turn', `🔬 ${fmtN(rep.sci)}`),
      row('Culture per turn', `🎭 ${fmtN(rep.cul)}`),
      row('Trade routes', `🐪 ${used}/${cap}`),
      row('Policies', `🎭 ${P.policies.length} adopted, ${P.treesDone.length} trees done`),
      row('Strategic resources', `🐎${strat.horses} ⚒️${strat.iron} 🧂${strat.saltpeter}`)),
    h('h3', null, 'Cities'),
    rep.cities.map(({ c, r }) => h('button', { class: 'cityrow', onclick: () => showCity(c) },
      h('div', { class: 'tx' }, h('b', null, (c.capital ? '★ ' : '') + c.name + ` · ${c.pop}`),
        h('div', { class: 'b' }, `🌾${fmtSigned(r.foodNet)} ⚙️${fmtN(r.prod)} 💰${fmtSigned(r.gold - r.upkeep)} 🔬${fmtN(r.sci)} 🎭${fmtN(r.cul)}`),
        h('div', { class: 'b' }, c.build ? `${HX.itemName(c.build)} · ${prodTurns(c, r)} turns` + (rep.conn.road.has(c.id) ? ' · 🛣️ linked' : '') : 'Nothing in production')),
      h('span', null, '›'))),
    h('div', { class: 'bar' }, h('button', { class: 'pri', onclick: backToMap }, 'Back to map'))));
}

function renameDlg(c, after) {
  const inp = h('input', { type: 'text', value: c.name, maxlength: '24', autocapitalize: 'words' });
  $('modal').replaceChildren(h('div', { class: 'dlg' }, h('h4', null, 'Rename city'), inp,
    h('div', { class: 'bar' }, h('button', { onclick: closeModal }, 'Cancel'),
      h('button', { class: 'pri', onclick: () => { const v = inp.value.trim().slice(0, 24); if (v) { c.name = v; for (const Q of UI.G.players) if (Q.seen[c.tile]) Q.seen[c.tile].n = v; } closeModal(); after(); } }, 'Rename'))));
  setTimeout(() => { inp.focus(); inp.select(); }, 50);
}

// ---------- policies ----------
function showPolicies(back) {
  const G = UI.G; if (!G) return;
  const P = G.players[UI.pid];
  const render = () => {
    const sc = $('screens').firstChild, top = sc ? sc.scrollTop : 0;
    const cul = HX.civReport(G, UI.pid).cul, cost = HX.policyCost(G, UI.pid);
    const turns = P.culturePool >= cost ? 0 : cul > 0 ? Math.ceil((cost - P.culturePool) / cul) : Infinity;
    const era = HX.playerEra(P);
    const tree = tr => {
      const done = tr.policies.filter(p => P.policies.includes(p.key)).length, fin = P.treesDone.includes(tr.key);
      return h('div', { class: 'card tree' },
        h('div', { class: 'hdr' }, h('span', { class: 'g' }, tr.glyph), h('div', null, h('div', { class: 'n' }, tr.name), h('div', { class: 'note', style: 'margin:0' }, tr.desc)), h('span', { class: 'c' }, `${done}/5`)),
        era < tr.era ? h('div', { class: 'note' }, `Opens in the ${ERAS[tr.era]} era.`) : null,
        tr.policies.map(p => {
          const st = HX.policyStatus(G, UI.pid, p.key), adopted = P.policies.includes(p.key);
          const cls = 'pol ' + (adopted ? 'done' : st.ok ? 'ready' : 'locked');
          return h('button', { class: cls, disabled: adopted, onclick: () => {
            if (st.ok) confirmDlg(`Adopt ${p.name}?`, `${p.text} Costs ${st.cost} culture.`, 'Adopt', () => { HX.adoptPolicy(G, UI.pid, p.key); flushLog(); render(); updateHUD(); });
            else toast(st.why);
          } }, h('div', { class: 'tx' }, h('div', { class: 'a' }, p.name), h('div', { class: 'b' }, p.text)), !adopted && st.ok ? h('span', { class: 'tn' }, 'Adopt') : null);
        }),
        h('div', { class: 'fin' + (fin ? ' got' : '') }, (fin ? '✓ Completed: ' : 'Complete all five: ') + tr.finisher.text),
        tr.later ? h('div', { class: 'note' }, tr.later) : null);
    };
    const el = screen(
      h('h2', null, backBtn(back || backToMap), 'Policies'),
      h('div', { class: 'grid2' },
        h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Culture stored'), h('div', { class: 'v' }, `🎭 ${fmtN(P.culturePool)}`), h('div', { class: 's' }, `+${fmtN(cul)} per turn`)),
        h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Next policy'), h('div', { class: 'v' }, `${cost}`), h('div', { class: 's' }, turns === 0 ? 'Ready to adopt' : turns === Infinity ? 'No culture income' : `In ${turns} turn${turns > 1 ? 's' : ''}`))),
      h('p', null, `Each policy raises the cost of the next; more cities raise it too. Trees completed: ${P.treesDone.length}. A Culture victory will need four, plus a great project (victory build).`),
      POLICY_TREES.map(tree),
      h('div', { class: 'bar' }, h('button', { class: 'pri', onclick: back || backToMap }, 'Done')));
    showScreen(el); el.scrollTop = top;
  };
  render();
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
  $('modal').replaceChildren(h('div', { class: 'dlg', style: 'max-width:560px' }, h('h4', null, 'World'), h('p', null, 'Tap anywhere to jump there. White squares are cities you know; yellow dots are your units.'), wrap,
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

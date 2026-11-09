// ===== screens.js : city, research and empire screens =====
function backToMap() { closeScreens(); refreshAll(); }
function itemGlyph(it) {
  if (it.k === 'u') return UNITS[it.key].glyph;
  const B0 = BUILDINGS[BLDI[it.key]]; if (B0 && B0.glyph) return B0.glyph;
  return { walls: '🧱', castle: '🏰', bastion: '🛡️', barracks: '⛺', armory: '🗡️', shrine: '🛐', grand_temple: '🕍', monument: '🗿', granary: '🌾', library: '📚', market: '🏪', temple: '⛩️', amphitheater: '🎭', arena: '🏟️', harbor: '⚓', courthouse: '⚖️',
    aqueduct: '🚰', workshop: '🔧', university: '🎓', lighthouse: '🗼', bank: '🏦', printing: '📰', observatory: '🔭', opera: '🎼', museum: '🖼️',
    factory: '🏭', laboratory: '⚗️', hospital: '🏥', stock_exchange: '📈' }[it.key] || '🏛';
}
function itemDesc(it) {
  if (it.k === 'b') { const B = BUILDINGS[BLDI[it.key]]; return B.desc + (B.upkeep ? ` Upkeep ${B.upkeep}💰.` : ''); }
  const U = UNITS[it.key];
  if (U.military && U.cls !== 'recon') {
    const kind = { melee: 'Melee', ranged: 'Ranged', mounted: 'Mounted', siege: 'Siege, +100% vs cities', naval_melee: 'Naval melee', naval_ranged: 'Naval ranged' }[U.cls];
    return `${kind}. Strength ${U.str}` + (U.rstr ? `, ranged ${U.rstr} at ${U.range} tiles` : '') + `, ${U.moves} moves.` + (U.vsMounted ? ' +50% vs mounted.' : '') + (U.res ? ` Uses ${RES[RESI[U.res]].name}.` : '') + (U.civ ? ' Unique unit.' : '');
  }
  return { settler: 'Founds a new city. Costs 1 population; the city must be size 2.', builder: 'Builds farms, mines, roads and more. 3 charges.',
    scout: 'Fast explorer. Ignores terrain movement costs.', militia: 'Basic defender. Combat arrives in a later build.',
    caravan: 'Opens a permanent trade route.', missionary: 'Spreads your religion twice to nearby cities.',
    inquisitor: 'Removes other religions from one of your cities.' }[it.key] || '';
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
    const units = items.filter(i => i.k === 'u'), great = items.filter(i => i.k === 'b' && (HX.isWonder(i.key) || HX.isProject(i.key))), blds = items.filter(i => i.k === 'b' && !great.includes(i));
    const rate = it => HX.itemRate(r, it);
    const turnsFor = it => { const n = Math.max(1, Math.ceil(Math.max(0, HX.itemCost(G, it, c.owner) - c.prod) / Math.max(0.01, rate(it)))); return rate(it) > 0 ? `${n} turn${n > 1 ? 's' : ''}` : '–'; };
    const pick = (it, queue) => { HX.setBuild(G, c, it, queue); render(); };
    const itemRow = it => h('div', { class: 'rowbtns' },
      h('button', { class: 'item' + (HX.isWonder(it.key) || HX.isProject(it.key) ? ' great' : ''), onclick: () => pick(it, false) }, h('div', { class: 'ic' }, itemGlyph(it)),
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
        h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Citizens'), h('div', { class: 'v' }, `👥 ${c.pop}`), h('div', { class: 's' }, `${c.worked.length} working ${c.worked.length === 1 ? 'tile' : 'tiles'}` + (r.spec ? `, ${r.spec} scholar${r.spec > 1 ? 's' : ''}` : ''))),
        h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Faith'), h('div', { class: 'v' }, `🙏 ${fmtN(r.faith)}`), h('div', { class: 's' }, `${fmtN(G.players[c.owner].faith)} stored empire-wide`)),
        religionKv(G, c)),
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
      great.length ? [h('h3', null, 'Wonders and great projects'), h('div', { class: 'note' }, 'A world wonder can be built only once in the whole world. If a rival finishes it first, your production carries over to the next item. Wonders cannot be bought.'), h('div', { class: 'col' }, great.map(itemRow))] : null,
      faithBuySection(G, c, render),
      h('h3', null, 'Citizens'),
      seg([['balanced', 'Balanced'], ['food', 'Food'], ['production', 'Prod.'], ['gold', 'Gold']], c.focus, v => { c.focus = v; render(); }),
      h('div', { class: 'note' }, (c.locked.length || c.forcedSpec ? `${c.locked.length} tile${c.locked.length === 1 ? '' : 's'} pinned, ${c.forcedSpec} forced scholar${c.forcedSpec === 1 ? '' : 's'}. ` : '') +
        'The focus picks the remaining tiles while keeping the city fed. Citizens without a tile become scholars: +1🔬 +1💰 each.'),
      h('button', { style: 'width:100%;margin-top:8px', onclick: () => startManage(c) }, '📌 Manage tiles on the map'),
      h('h3', null, 'Built'),
      h('div', { class: 'chips' }, c.buildings.filter(k => !BUILDINGS[BLDI[k]].hidden).map(k => h('span', { class: 'chip' + (HX.isWonder(k) || HX.isProject(k) ? ' gold' : '') }, itemGlyph({ k: 'b', key: k }) + ' ' + BUILDINGS[BLDI[k]].name)),
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
  if (fx.pantheon) out.push(['🙏 Pantheons', false]);
  if (fx.religion) out.push(['🕊️ Prophets can found a religion', false]);
  if (fx.enhance) out.push(['🕊️ Enhance a religion', false], ['🕯️ Inquisitor', false]);
  if (fx.policyCost) out.push(['🎭 Policies 10% cheaper', false]);
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
      row('Faith per turn', `🙏 ${fmtN(rep.faith)} (${fmtN(P.faith)} stored)`),
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
      h('p', null, `Each policy raises the cost of the next; more cities raise it too. Trees completed: ${P.treesDone.length}. A Culture victory needs five completed trees, then the Grand Exhibition.`),
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

// ---------- religion ----------
const REL_COLORS = ['#ff8a4c', '#4cb6ff', '#6ad16a', '#ffd34c', '#c99bff', '#ff6f9a', '#9ee8ff', '#c8b28a'];
function relColor(rel) { return REL_COLORS[rel.nameIdx % REL_COLORS.length]; }
function religionKv(G, c) {
  const cr = HX.cityReligion(G, c), maj = cr.major !== null ? HX.relById(G, cr.major) : null;
  const segs = [];
  let n = 0;
  for (const k in cr.followers) { const rel = HX.relById(G, +k); if (!rel) continue; segs.push(h('i', { style: `width:${cr.followers[k] / c.pop * 100}%;background:${relColor(rel)}` })); n += cr.followers[k]; }
  return h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Religion'), h('div', { class: 'v', style: 'font-size:15px' }, maj ? `${maj.glyph} ${maj.name}` : 'No majority'),
    h('div', { class: 'relbar' }, segs), h('div', { class: 's' }, n ? Object.keys(cr.followers).map(k => { const rel = HX.relById(G, +k); return rel ? `${rel.glyph}${cr.followers[k]}` : ''; }).join(' ') + ` of ${c.pop}` : 'Nobody follows a religion yet'));
}
function faithBuySection(G, c, render) {
  const opts = HX.faithBuyOptions(G, c); if (!opts.length) return null;
  return [h('h3', null, `Buy with faith · 🙏 ${fmtN(G.players[c.owner].faith)}`),
    h('div', { class: 'col' }, opts.map(o => h('button', { class: 'item', disabled: !o.ok || UI.busy, onclick: () => { if (HX.buyWithFaith(G, c, o)) { flushLog(); render(); } } },
      h('div', { class: 'ic' }, itemGlyph(o)), h('div', { class: 'tx' }, h('div', { class: 'a' }, HX.itemName(o)), h('div', { class: 'b' }, o.k === 'u' ? itemDesc(o) : BUILDINGS[BLDI[o.key]].desc), o.why ? h('div', { class: 'b', style: 'color:#f0b37a' }, o.why) : null),
      h('div', { class: 'tn' }, `${o.cost}🙏`))))];
}
function beliefList(keys, chosen, onPick, all) {
  return all.map(b => h('button', { class: 'belief' + (chosen === b.key ? ' on' : ''), disabled: !keys.includes(b.key), onclick: () => onPick(b.key) },
    h('div', { class: 'a' }, b.name), h('div', { class: 'b' }, b.text)));
}
function foundDlg(u) {
  const G = UI.G, names = HX.freeReligionNames(G);
  const st = { name: names[0], founder: null, follower: null };
  const render = () => {
    const ok = st.founder && st.follower && st.name !== undefined;
    showScreen(screen(
      h('h2', null, backBtn(backToMap), 'Found a religion'),
      h('p', null, `Your Prophet founds the religion in ${HX.foundStatus(G, u).city.name}, which becomes its holy city. Each belief can be taken by only one religion in the world.`),
      h('h3', null, 'Name'),
      h('div', { class: 'names' }, names.map(i => h('button', { class: st.name === i ? 'on' : '', onclick: () => { st.name = i; render(); } }, `${RELIGION_NAMES[i].glyph} ${RELIGION_NAMES[i].name}`))),
      h('h3', null, 'Founder belief · helps only you'),
      beliefList(HX.freeBeliefs(G, 'founder'), st.founder, k => { st.founder = k; render(); }, FOUNDER_BELIEFS),
      h('h3', null, 'Follower belief · helps every city that follows'),
      beliefList(HX.freeBeliefs(G, 'follower'), st.follower, k => { st.follower = k; render(); }, FOLLOWER_BELIEFS),
      h('div', { class: 'bar' }, h('button', { onclick: backToMap }, 'Later'), h('button', { class: 'pri', disabled: !ok, onclick: () => { if (HX.foundReligion(G, u, st.name, st.founder, st.follower)) { flushLog(); backToMap(); setSel(null); } } }, 'Found religion'))));
  };
  render();
}
function enhanceDlg(u) {
  const G = UI.G, rel = HX.enhanceStatus(G, u).rel;
  const st = { follower2: null, enhancer: null };
  const render = () => showScreen(screen(
    h('h2', null, backBtn(backToMap), `Enhance ${rel.name}`),
    h('p', null, 'Add a second follower belief and an enhancer belief that changes how your religion spreads.'),
    h('h3', null, 'Second follower belief'),
    beliefList(HX.freeBeliefs(G, 'follower'), st.follower2, k => { st.follower2 = k; render(); }, FOLLOWER_BELIEFS),
    h('h3', null, 'Enhancer belief'),
    beliefList(HX.freeBeliefs(G, 'enhancer'), st.enhancer, k => { st.enhancer = k; render(); }, ENHANCER_BELIEFS),
    h('div', { class: 'bar' }, h('button', { onclick: backToMap }, 'Later'), h('button', { class: 'pri', disabled: !(st.follower2 && st.enhancer), onclick: () => { if (HX.enhanceReligion(G, u, st.follower2, st.enhancer)) { flushLog(); backToMap(); setSel(null); } } }, 'Enhance'))));
  render();
}
function showReligion(back) {
  const G = UI.G; if (!G) return;
  const P = G.players[UI.pid];
  const render = () => {
    const sc = $('screens').firstChild, top = sc ? sc.scrollTop : 0;
    const rep = HX.civReport(G, UI.pid), faith = rep.faith;
    const ps = HX.pantheonStatus(G, UI.pid), pcost = HX.pantheonCost(G, UI.pid), prcost = HX.prophetCost(G, UI.pid);
    const myRel = HX.relById(G, P.religion), stats = HX.religionStats(G);
    let next;
    if (!P.pantheon) next = h('div', { class: 's' }, P.techs.includes('mysticism') ? (ps.ok ? 'Pantheon ready: pick one below' : `Pantheon at ${pcost}`) : 'Pantheons need Mysticism');
    else if (P.religion === null && G.religions.length >= HX.maxReligions(G)) next = h('div', { class: 's' }, 'All religion slots are taken. Spend faith on buildings.');
    else if (P.religion === null) next = h('div', { class: 's' }, P.techs.includes('philosophy') ? `Prophet at ${prcost}` : 'Prophets need Philosophy');
    else if (!myRel.enhancer) next = h('div', { class: 's' }, P.techs.includes('theology') ? `Prophet to enhance at ${prcost}` : 'Enhancing needs Theology');
    else next = h('div', { class: 's' }, 'Spend faith on Missionaries, Inquisitors and temples.');
    const beliefLine = k => k ? h('div', { class: 'b' }, h('b', null, BELIEF[k].name + ': '), BELIEF[k].text) : null;
    const el = screen(
      h('h2', null, backBtn(back || backToMap), 'Religion'),
      h('div', { class: 'grid2' },
        h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Faith stored'), h('div', { class: 'v' }, `🙏 ${fmtN(P.faith)}`), h('div', { class: 's' }, `+${fmtN(faith)} per turn`)),
        h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Next'), next)),
      h('h3', null, 'Pantheon'),
      P.pantheon ? h('div', { class: 'card' }, h('b', null, BELIEF[P.pantheon].name), h('div', { class: 'note' }, BELIEF[P.pantheon].text))
        : [h('p', null, ps.ok ? 'Choose the pantheon your people worship. Each can belong to only one civilization.' : ps.why),
          PANTHEONS.map(pt => {
            const owner = G.players.find(Q => Q.pantheon === pt.key);
            return h('button', { class: 'belief', disabled: !!owner || !ps.ok, onclick: () => confirmDlg(`Worship ${pt.name}?`, pt.text, 'Choose', () => { HX.pickPantheon(G, UI.pid, pt.key); flushLog(); render(); updateHUD(); }) },
              h('div', { class: 'a' }, pt.name + (owner ? ` · ${owner.id === UI.pid ? 'yours' : P.met.includes(owner.id) ? CIVS[owner.civ].adj : 'taken'}` : '')), h('div', { class: 'b' }, pt.text));
          })],
      h('h3', null, `Religions of the world · ${G.religions.length} of ${HX.maxReligions(G)} founded`),
      stats.length ? stats.map(({ rel, cities, followers }) => {
        const holy = HX.cityById(G, rel.holy), known = rel.owner === UI.pid || P.met.includes(rel.owner);
        return h('div', { class: 'card relcard', style: `border-left:4px solid ${relColor(rel)}` },
          h('div', { class: 't' }, `${rel.glyph} ${rel.name}`),
          h('div', { class: 's' }, (known ? `Founded by the ${CIVS[G.players[rel.owner].civ].name}` : 'Founded by an unknown civilization') + (holy && P.explored[holy.tile] ? ` in ${holy.name}` : '') + ` · ${cities} cities · ${followers} followers`),
          beliefLine(rel.founder), beliefLine(rel.follower), beliefLine(rel.follower2), beliefLine(rel.enhancer));
      }) : h('p', null, 'No religion has been founded yet. Earn faith from Shrines and Temples; with Philosophy, a Prophet appears and can found one.'),
      myRel ? [h('h3', null, 'Your faith in numbers'), h('table', { class: 'tbl' },
        h('tr', null, h('td', null, 'Cities following'), h('td', { class: 'n' }, String(rep.rfx.followerCities))),
        h('tr', null, h('td', null, 'Foreign cities following'), h('td', { class: 'n' }, String(rep.rfx.foreignCities))),
        h('tr', null, h('td', null, 'Founder belief income'), h('td', { class: 'n' }, [rep.rfx.g ? `💰${rep.rfx.g}` : '', rep.rfx.s ? `🔬${rep.rfx.s}` : '', rep.rfx.fa ? `🙏${rep.rfx.fa}` : '', rep.rfx.c ? `🎭${rep.rfx.c}` : '', rep.rfx.h ? `🙂${rep.rfx.h}` : ''].join(' ') || '–')))] : null,
      h('p', null, 'Religions spread on their own to cities within 10 tiles and along trade routes. A civilization with its own religion resists others, and holy cities resist most. Missionaries push hard; Inquisitors clear rival faiths from your cities.'),
      h('div', { class: 'bar' }, h('button', { class: 'pri', onclick: back || backToMap }, 'Done')));
    showScreen(el); el.scrollTop = top;
  };
  render();
}

// ---------- rivals: war and peace ----------
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
  else if (o.kind === 'tribute') { title = `The ${from} demand tribute`; text = `They want ${o.amount} gold. Refusing angers them and they may attack.`; yes = `Pay ${o.amount}`; no = 'Refuse'; }
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
  return [h('button', { class: 'att lv' + a.name.toLowerCase(), onclick: () => { open.hidden = !open.hidden; } }, h('span', { class: 'face' }, a.face), h('span', null, `${a.name} toward you`), h('small', null, 'Why? ›')), open];
}
function showDiplomacy(back) {
  const G = UI.G; if (!G) return;
  const P = G.players[UI.pid];
  const render = () => {
    const rows = HX.majorPlayers(G).filter(Q => Q.id !== UI.pid && P.met.includes(Q.id));
    const offers = G.offers.filter(o => o.to === UI.pid);
    const el = screen(
      h('h2', null, backBtn(back || backToMap), 'Diplomacy'),
      offers.length ? [h('h3', null, `Waiting for your answer (${offers.length})`), offers.map(o => offerCard(G, o, render))] : null,
      h('h3', null, 'Civilizations you know'),
      rows.length ? rows.map(Q => {
        const civ = CIVS[Q.civ], war = HX.atWar(G, UI.pid, Q.id), ws = HX.warStatus(G, UI.pid, Q.id), rec = HX.warRecord(G, UI.pid, Q.id);
        const r = G.dip[HX.warKey(UI.pid, Q.id)] || {}, chips = [];
        if (!Q.alive) chips.push(h('span', { class: 'chip' }, 'Destroyed'));
        else if (war) chips.push(h('span', { class: 'chip war' }, `⚔️ War since turn ${rec.since}`));
        else chips.push(h('span', { class: 'chip' }, ws.ok ? '🕊️ Peace' : '🕊️ ' + ws.why.replace('A peace treaty holds until', 'Treaty to')));
        if (HX.allied(G, UI.pid, Q.id)) chips.push(h('span', { class: 'chip ally' }, `🤝 Allied to turn ${r.ally}`));
        else if (HX.hasOB(G, UI.pid, Q.id)) chips.push(h('span', { class: 'chip' }, `🚪 Open borders to turn ${r.ob}`));
        const deals = G.deals.filter(d => (d.from === UI.pid && d.to === Q.id) || (d.from === Q.id && d.to === UI.pid));
        for (const d of deals) chips.push(h('span', { class: 'chip' }, (d.from === UI.pid ? '↗ ' : '↙ ') + (d.kind === 'gpt' ? `${d.amount} gold/turn` : RES[RESI[d.key]].glyph + ' ' + RES[RESI[d.key]].name) + ` to t${d.until}`));
        if (HX.denounced(G, Q.id, UI.pid)) chips.push(h('span', { class: 'chip war' }, 'Denounced you'));
        if (HX.denounced(G, UI.pid, Q.id)) chips.push(h('span', { class: 'chip later' }, 'You denounced them'));
        for (const a of HX.alliesOf(G, Q.id)) if (a !== UI.pid) chips.push(h('span', { class: 'chip later' }, `Allied with the ${civName(G, a)}`));
        const ncity = G.cities.filter(c => c.owner === Q.id).length;
        return h('div', { class: 'card relcard', style: `border-left:4px solid ${civ.color}` },
          h('div', { class: 't' }, civ.name), h('div', { class: 's' }, `${civ.leader} · ${ncity} ${ncity === 1 ? 'city' : 'cities'} · ${armyCompare(G, UI.pid, Q.id)}${Q.religion !== null && HX.relById(G, Q.religion) ? ' · ' + HX.relById(G, Q.religion).name : ''}`),
          Q.alive && !Q.human ? attitudeBlock(G, Q) : Q.human ? h('div', { class: 's', style: 'margin-top:6px' }, '👤 Another player on this phone. Offers wait for their turn.') : null,
          h('div', { class: 'chips', style: 'margin-top:6px' }, chips),
          war && Q.alive ? h('div', { class: 's', style: 'margin-top:4px' }, `You lost ${rec.lost[UI.pid] || 0} units, they lost ${rec.lost[Q.id] || 0}.`) : null,
          !Q.alive ? null : h('div', { class: 'rowbtns' },
            h('button', { class: 'pri', onclick: () => showTrade(Q.id, render) }, war ? 'Negotiate' : 'Trade'),
            war && Q.human ? h('button', { disabled: G.offers.some(o => o.from === UI.pid && o.to === Q.id && o.kind === 'peace'), onclick: () => { G.offers.push({ id: G.nextId++, kind: 'peace', from: UI.pid, to: Q.id, turn: G.turn }); toast('Peace offer sent. They answer on their turn.'); render(); } }, 'Offer peace') :
            war ? h('button', { onclick: () => { const r2 = HX.offerPeace(G, UI.pid, Q.id); toast(r2.ok ? `The ${civ.name} accept peace.` : r2.why); flushLog(); render(); updateHUD(); } }, 'Offer peace')
              : h('button', { class: 'danger', disabled: !ws.ok, onclick: () => confirmDlg(`Declare war on the ${civ.name}?`, (HX.hasOB(G, UI.pid, Q.id) ? 'This breaks your open-borders treaty, and every civilization will remember it. ' : '') + 'Their units and cities become targets until peace is made.' + (HX.alliesOf(G, Q.id).length ? ` Their allies (${HX.alliesOf(G, Q.id).map(a => civName(G, a)).join(', ')}) may join them.` : ''), 'Declare war', () => { HX.declareWar(G, UI.pid, Q.id); flushLog(); render(); updateHUD(); refreshAll(); }, true) }, 'Declare war'),
            war ? null : h('button', { disabled: HX.denounced(G, UI.pid, Q.id), onclick: () => confirmDlg(`Denounce the ${civ.name}?`, 'They will dislike you for 30 turns. Their enemies will like you a little more.', 'Denounce', () => { HX.denounce(G, UI.pid, Q.id); flushLog(); render(); }, true) }, 'Denounce'),
            war ? null : h('button', { onclick: () => { const st = HX.tributeAcceptable(G, UI.pid, Q.id); confirmDlg(`Demand tribute from the ${civ.name}?`, (Q.human ? `They decide on their turn whether to pay ${HX.tributeAmount(G, UI.pid, Q.id)} gold.` : st.ok ? `They look frightened enough to pay about ${st.amount} gold.` : `They will probably refuse: ${st.why}`) + ' Either way they will resent it, and a refusal may lead to war.', 'Demand', () => { const res = HX.demandTribute(G, UI.pid, Q.id); if (!res.ok) toast(`The ${civ.name} refuse.`); flushLog(); render(); updateHUD(); }); } }, 'Demand tribute'),
            HX.allied(G, UI.pid, Q.id) ? h('button', { class: 'danger', onclick: () => confirmDlg('End the alliance?', 'Breaking an alliance early is remembered as a broken treaty.', 'End alliance', () => { HX.cancelAlliance(G, UI.pid, Q.id); refreshAll(); render(); }, true) }, 'End alliance') : null));
      }) : h('p', null, 'You have not met anyone yet. Explore with scouts and ships.'),
      h('div', { class: 'note' }, 'Attitude comes from shared history: wars, broken treaties, trade, faith, crowded borders and common enemies. Open borders let military units pass through each other\'s land; without them, armies stop at the border. Allies share vision and join each other\'s wars. Barbarians never negotiate.'),
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
      for (const amt of [25, 50, 100, 200, 400]) if (g >= amt) out.push([`💰 ${amt}`, { by: giver, kind: 'gold', amount: amt }]);
      if (g >= 10 && ![25, 50, 100, 200, 400].includes(g) && g < 400 && giver === me) out.push([`💰 all ${g}`, { by: giver, kind: 'gold', amount: g }]);
      const inc = Math.floor(P.lastGold || 0);
      for (const amt of [1, 2, 3, 5, 8]) if (inc >= amt) out.push([`💰 ${amt}/turn`, { by: giver, kind: 'gpt', amount: amt }]);
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
        canFix && G.players[me].gold >= v.need ? h('button', { onclick: () => add({ by: me, kind: 'gold', amount: v.need + ((items.find(x => x.kind === 'gold' && x.by === me) || {}).amount || 0) }) }, `Add ${v.need} gold`) : null,
        human ? h('button', { class: 'pri', disabled: !v || !v.ok, onclick: () => { G.offers.push({ id: G.nextId++, kind: 'deal', from: me, to: them, items: items.slice(), turn: G.turn }); toast(`Offer sent to the ${civ.name}.`); back ? back() : backToMap(); } }, 'Send offer') :
        h('button', { class: 'pri', disabled: !v || !v.ok, onclick: () => { HX.executeDeal(G, me, them, items.slice()); flushLog(); toast(`Deal agreed with the ${civ.name}.`); updateHUD(); refreshAll(); back ? back() : backToMap(); } }, 'Propose deal')));
    showScreen(el);
  };
  render();
}

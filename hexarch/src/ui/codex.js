// ===== codex.js : an in-game encyclopedia of units, buildings, wonders and civilizations =====
const CODEX_TABS = [['units', 'Units'], ['buildings', 'Buildings'], ['wonders', 'Wonders'], ['civs', 'Civilizations'], ['world', 'World']];
function techName(k) { return k && TECHI[k] !== undefined ? TECHS[TECHI[k]].name : 'no tech needed'; }
function showCodex(back, tab) {
  tab = tab || 'units';
  const card = (icon, title, sub, body, cls) => h('div', { class: 'card codex' + (cls ? ' ' + cls : '') }, h('div', { class: 'row' }, h('div', { class: 'cx-ic' }, icon), h('div', { class: 'grow' }, h('b', null, title), sub ? h('div', { class: 's' }, sub) : null)), body ? h('div', { class: 'b' }, body) : null);
  let list = [];
  if (tab === 'units') {
    const base = BUILDABLE_UNITS.slice().sort((a, b) => ((UNITS[a].tech && TECHS[TECHI[UNITS[a].tech]].era) || 0) - ((UNITS[b].tech && TECHS[TECHI[UNITS[b].tech]].era) || 0));
    const uniques = Object.keys(UNITS).filter(k => UNITS[k].civ);
    list = base.concat(uniques).map(k => { const U = UNITS[k];
      const stats = U.military && U.cls !== 'recon' ? `Strength ${U.str}` + (U.rstr ? ` · Ranged ${U.rstr} (range ${U.range})` : '') + ` · Moves ${U.moves}` : `Moves ${U.moves}`;
      return card(unitPortrait(k), U.name, `${stats} · ${U.cost ? U.cost + '⚙️' : 'not built'} · ${techName(U.tech)}` + (U.res ? ` · needs ${RES[RESI[U.res]].name}` : ''), itemDesc({ k: 'u', key: k }) + (U.civ ? ` Unique to the ${CIVS[CIVI[U.civ]].name}.` : '') + (U.upg ? ` Upgrades to ${UNITS[U.upg].name}.` : ''), U.civ ? 'uu' : ''); });
  } else if (tab === 'buildings') {
    list = BUILDINGS.filter(B => !B.hidden && !B.wonder && !B.project).sort((a, b) => ((a.tech && TECHS[TECHI[a.tech]].era) || 0) - ((b.tech && TECHS[TECHI[b.tech]].era) || 0))
      .map(B => card(itemGlyph({ k: 'b', key: B.key }), B.name, `${B.cost}⚙️ · ${techName(B.tech)}` + (B.upkeep ? ` · upkeep ${B.upkeep}💰` : ''), B.desc));
  } else if (tab === 'wonders') {
    list = [h('div', { class: 'k' }, 'World wonders'), HX.WONDERS.map(W => card(W.glyph, W.name, `${W.cost}⚙️ · ${techName(W.tech)}` + (W.coastal ? ' · coastal' : ''), W.desc, 'gold')),
      h('div', { class: 'k', style: 'margin-top:10px' }, 'Great projects'), HX.PROJECTS.map(W => card(W.glyph, W.name, `${W.cost}⚙️ · ${techName(W.tech)}`, W.desc, 'gold'))];
  } else if (tab === 'civs') {
    list = [CIVS.filter(c => !c.barb && !c.minor).map(c => card(civEmblem(c, 40), c.name, c.leader, [h('div', null, h('b', null, c.bonus + ': '), c.bonusText), h('div', null, h('b', null, c.uu + ': '), c.uuText)])),
      h('div', { class: 'k', style: 'margin-top:10px' }, 'Free cities'),
      Object.entries(HX.MINOR_TYPES).map(([k, T]) => card(civEmblem({ minor: k, color: '#9aa7b6', dark: '#2a323d' }, 40), `${T.name} free cities`, '', `Friends receive ${T.what} every turn; the ally receives twice as much.`))];
  } else if (tab === 'world') {
    list = [h('div', { class: 'k' }, 'Natural wonders'), HX.NATURAL.map(N => card(N.glyph, N.name, 'Natural wonder', N.desc + ' The first to discover it earns a reward.')),
      h('div', { class: 'k', style: 'margin-top:10px' }, 'Great People'), Object.values(HX.GREAT).map(g => card(unitPortrait(g.unit), g.name, g.act || 'Passive', g.desc)),
      h('div', { class: 'k', style: 'margin-top:10px' }, 'Terrain'), TERRAIN.map(T => card(h('div', { class: 'sw', style: `background:${T.color};width:36px;height:36px;border-radius:8px` }), T.name, T.land ? (T.impassable ? 'Impassable' : `Move cost ${T.move}`) + (T.def ? ` · ${T.def > 0 ? '+' : ''}${T.def}% defense` : '') : 'Water', `Yields 🌾${T.food} ⚙️${T.prod} 💰${T.gold}.`))];
  }
  showScreen(screen(
    h('h2', null, backBtn(back || backToMap), 'Codex'),
    h('div', { class: 'seg codextabs' }, CODEX_TABS.map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: () => showCodex(back, k) }, l))),
    h('div', { class: 'col' }, list),
    h('div', { class: 'bar' }, h('button', { class: 'pri', onclick: back || backToMap }, 'Done'))));
}

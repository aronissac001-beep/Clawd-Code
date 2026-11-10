// ===== codex.js : an in-game encyclopedia of Veyra: units, buildings, wonders, factions, the planet =====
const CODEX_TABS = [['units', 'Units'], ['buildings', 'Buildings'], ['wonders', 'Wonders'], ['civs', 'Factions'], ['world', 'Veyra']];
function techName(k) { return k && TECHI[k] !== undefined ? TECHS[TECHI[k]].name : 'no tech needed'; }
function showCodex(back, tab) {
  tab = tab || 'units';
  const card = (icon, title, sub, body, cls) => h('div', { class: 'card codex' + (cls ? ' ' + cls : '') }, h('div', { class: 'row' }, h('div', { class: 'cx-ic' }, icon), h('div', { class: 'grow' }, h('b', null, title), sub ? h('div', { class: 's' }, sub) : null)), body ? h('div', { class: 'b' }, body) : null);
  let list = [];
  if (tab === 'units') {
    const base = BUILDABLE_UNITS.slice().sort((a, b) => (UNITS[a].tier || 0) - (UNITS[b].tier || 0) || ((UNITS[a].tech && TECHS[TECHI[UNITS[a].tech]].lv) || 0) - ((UNITS[b].tech && TECHS[TECHI[UNITS[b].tech]].lv) || 0));
    const uniques = Object.keys(UNITS).filter(k => UNITS[k].civ || UNITS[k].fauna);
    list = base.concat(uniques).map(k => { const U = UNITS[k];
      const stats = U.military && U.cls !== 'recon' ? `Strength ${U.str}` + (U.rstr ? ` · Ranged ${U.rstr} (range ${U.range})` : '') + ` · Moves ${U.moves}` : `Moves ${U.moves}`;
      return card(unitPortrait(k), U.name, `${stats} · ${U.cost ? U.cost + '⚙️' : 'not built'} · ${techName(U.tech)}` + (U.res ? ` · needs ${RES[RESI[U.res]].name}` : ''), (U.fauna ? `Native fauna. ${U.desc}` : itemDesc({ k: 'u', key: k })) + (U.civ ? ` Unique to the ${CIVS[CIVI[U.civ]].name}.` : '') + (U.aff ? ` Needs ${HX.AFFINITIES.find(a => a.key === U.aff).name} ${U.affLvl}.` : ''), U.civ ? 'uu' : ''); });
  } else if (tab === 'buildings') {
    list = BUILDINGS.filter(B => !B.hidden && !B.wonder && !B.project).sort((a, b) => ((a.tech && TECHS[TECHI[a.tech]].era) || 0) - ((b.tech && TECHS[TECHI[b.tech]].era) || 0))
      .map(B => card(itemGlyph({ k: 'b', key: B.key }), B.name, `${B.cost}⚙️ · ${techName(B.tech)}` + (B.upkeep ? ` · upkeep ${B.upkeep}💠` : ''), B.desc));
  } else if (tab === 'wonders') {
    list = [h('div', { class: 'k' }, 'Planetary wonders'), HX.WONDERS.map(W => card(W.glyph, W.name, `${W.cost}⚙️ · ${techName(W.tech)}` + (W.coastal ? ' · coastal' : ''), W.desc, 'gold')),
      h('div', { class: 'k', style: 'margin-top:10px' }, 'Victory projects'), HX.PROJECTS.map(W => card(W.glyph, W.name, `${W.cost}⚙️ · ${techName(W.tech)}`, W.desc, 'gold')),
      h('div', { class: 'k', style: 'margin-top:10px' }, 'Satellites'), Object.keys(HX.SATS).map(k => card(unitPortrait(k), HX.SATS[k].name, `${HX.SATS[k].cost}⚙️ · ${techName(HX.SATS[k].tech)} · ${HX.SATS[k].life} turns`, HX.SATS[k].text))];
  } else if (tab === 'civs') {
    list = [CIVS.filter(c => !c.barb && !c.minor).map(c => card(civEmblem(c, 40), c.name, c.leader, [h('div', { class: 's' }, c.lore), h('div', null, h('b', null, c.bonus + ': '), c.bonusText), h('div', null, h('b', null, c.uu + ': '), c.uuText), h('div', null, h('b', null, 'Agenda: '), HX.AGENDAS[c.agenda].name + '. ' + HX.AGENDAS[c.agenda].text)])),
      h('div', { class: 'k', style: 'margin-top:10px' }, 'Affinities'), HX.AFFINITIES.map(A => card(A.glyph, A.name, A.motto, A.desc)),
      h('div', { class: 'k', style: 'margin-top:10px' }, 'Outposts'),
      Object.entries(HX.MINOR_TYPES).map(([k, T]) => card(civEmblem({ minor: k, color: '#8f86b8', dark: '#241c40' }, 40), T.name, '', `Friends receive ${T.what} every turn; the ally receives twice as much. An ally with 90 influence can absorb it.`)),
      h('div', { class: 'k', style: 'margin-top:10px' }, 'Ark loadouts'), ['colonists', 'cargo', 'ships'].map(g => HX.LOADOUT[g].map(L => card(L.glyph, L.name, g, L.text)))];
  } else if (tab === 'world') {
    list = [card('🌫️', 'The Spore Veil', 'Planetary hazard', 'A creeping pink haze of spores. Units starting a turn in it lose 10 health unless adapted. It spreads from nests and old growth; Riggers scour it and Veil Scrubbers burn it away. Communion learns to live in it and profit from it.'),
      Object.values(HX.SITE_KINDS).map(K => card(K.glyph, K.name, 'Site', K.desc)),
      relicCodex(card), h('div', { class: 'k', style: 'margin-top:10px' }, 'Natural wonders'), HX.NATURAL.map(N => card(N.glyph, N.name, 'Natural wonder', N.desc + ' The first to discover it earns a reward.')),
      h('div', { class: 'k', style: 'margin-top:10px' }, 'Resources'), RES.map(R0 => card(R0.glyph, R0.name, R0.kind + (R0.reveal ? ` · revealed by ${techName(R0.reveal)}` : ''), R0.desc)),
      h('div', { class: 'k', style: 'margin-top:10px' }, 'Visionaries'), Object.values(HX.GREAT).map(g => card(unitPortrait(g.unit), g.name, g.act || 'Passive', g.desc)),
      h('div', { class: 'k', style: 'margin-top:10px' }, 'Terrain'), TERRAIN.map(T => card(h('div', { class: 'sw', style: `background:${T.color};width:36px;height:36px;border-radius:8px` }), T.name, T.land ? (T.impassable ? 'Impassable' : `Move cost ${T.move}`) + (T.def ? ` · ${T.def > 0 ? '+' : ''}${T.def}% defense` : '') : 'Water', `${T.desc} Yields 🌾${T.food} ⚙️${T.prod} 💠${T.gold}.`))];
  }
  showScreen(screen(
    h('h2', null, backBtn(back || backToMap), 'Codex'),
    h('div', { class: 'seg codextabs' }, CODEX_TABS.map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: () => showCodex(back, k) }, l))),
    h('div', { class: 'col' }, list),
    h('div', { class: 'bar' }, h('button', { class: 'pri', onclick: back || backToMap }, 'Done'))));
}

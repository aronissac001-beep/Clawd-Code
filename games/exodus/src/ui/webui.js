// ===== webui.js : the technology web, virtues, affinities, landfall and story dialogs =====
const WEB = { size: 1440, ring: { root: 0, b1: 150, l1: 245, b2: 335, l2: 445, b3: 550, l3: 665 }, spread: { l1: 16, l2: 14, l3: 12 } };
function techPos(t) {
  const c = WEB.size / 2; if (t.s < 0) return [c, c];
  const deg = -90 + t.s * 45 + (t.slot || 0) * (WEB.spread[t.r] || 0), r = WEB.ring[t.r], a = deg * Math.PI / 180;
  return [c + Math.cos(a) * r, c + Math.sin(a) * r];
}
function affChips(t) {
  const a = HX.techAffinity(t.key);
  return HX.AFFINITIES.filter(A => a[A.key]).map(A => h('span', { style: `background:${A.color}` }, `${A.glyph}${a[A.key]}`));
}
function showTech(back) {
  const G = UI.G; if (!G) return;
  const P = G.players[UI.pid];
  let selKey = P.research || HX.aiBestResearch(G, UI.pid, false) || 'landfall';
  const render = (keepScroll) => {
    const wrapOld = document.querySelector('.webwrap'), sx = wrapOld ? wrapOld.scrollLeft : null, sy = wrapOld ? wrapOld.scrollTop : null;
    const sci = HX.civReport(G, UI.pid).sci, queue = [P.research].concat(P.rqueue).filter(Boolean), tip = HX.aiBestResearch(G, UI.pid, false);
    const cv = h('canvas'), dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = WEB.size * dpr; cv.height = WEB.size * dpr; cv.style.width = cv.style.height = WEB.size + 'px';
    const x = cv.getContext('2d'); x.scale(dpr, dpr);
    // sector wedges and labels
    for (let s = 0; s < 8; s++) {
      const S = SECTORS[s], a0 = (-90 + s * 45 - 22.5) * Math.PI / 180, a1 = a0 + Math.PI / 4, c = WEB.size / 2;
      const g = x.createRadialGradient(c, c, 60, c, c, 720); g.addColorStop(0, S.color + '22'); g.addColorStop(1, S.color + '06');
      x.fillStyle = g; x.beginPath(); x.moveTo(c, c); x.arc(c, c, 715, a0, a1); x.closePath(); x.fill();
      x.strokeStyle = 'rgba(180,160,255,.08)'; x.lineWidth = 1; x.beginPath(); x.moveTo(c, c); x.lineTo(c + Math.cos(a0) * 715, c + Math.sin(a0) * 715); x.stroke();
      const am = (a0 + a1) / 2; x.font = '700 15px -apple-system, system-ui, sans-serif'; x.textAlign = 'center'; x.fillStyle = S.color;
      x.fillText(`${S.glyph} ${S.name}`, c + Math.cos(am) * 708 * 0.97, c + Math.sin(am) * 690 + 5);
    }
    for (const r of [150, 335, 550]) { x.strokeStyle = 'rgba(180,160,255,.08)'; x.beginPath(); x.arc(WEB.size / 2, WEB.size / 2, r, 0, 6.283); x.stroke(); }
    // links
    for (const t of TECHS) {
      const [ax, ay] = techPos(t), known = P.techs.includes(t.key);
      for (const k of t.pre.concat(t.any)) {
        const [bx, by] = techPos(TECHS[TECHI[k]]), kk = P.techs.includes(k);
        x.strokeStyle = known && kk ? 'rgba(79,227,193,.75)' : kk ? 'rgba(177,140,255,.65)' : 'rgba(120,110,160,.28)';
        x.lineWidth = known && kk ? 3 : 2; if (t.any.includes(k)) x.setLineDash([6, 5]); else x.setLineDash([]);
        x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.stroke();
      }
    }
    x.setLineDash([]);
    const nodes = TECHS.map(t => {
      const [px, py] = techPos(t), known = P.techs.includes(t.key), avail = HX.techAvailable(P, t.key), qi = queue.indexOf(t.key);
      const cls = 'tnode ' + (known ? 'known' : qi === 0 ? 'cur' : qi > 0 ? 'queued' : avail ? 'avail' : 'locked') + (t.key === selKey ? ' sel' : '');
      const n = known ? 0 : HX.researchTurns(G, UI.pid, t.key, sci);
      return h('button', { class: cls, style: `left:${px - 50}px;top:${py - 26}px`, onclick: () => { selKey = t.key; render(true); } },
        h('span', { class: 'tn' }, (qi >= 0 ? `${qi + 1}. ` : known ? '✓ ' : '') + t.name + (t.key === tip ? ' ⭐' : '')),
        h('span', { class: 'tc' }, known ? 'Known' : `${n === Infinity ? '∞' : n}t`), h('span', { class: 'affd' }, affChips(t)));
    });
    const web = h('div', { class: 'web', style: `width:${WEB.size}px;height:${WEB.size}px` }, cv, nodes);
    const wrap = h('div', { class: 'webwrap' }, web);
    const T0 = TECHS[TECHI[selKey]], known = P.techs.includes(selKey), path = known ? [] : HX.techPath(P, selKey), cost = HX.techCost(G, selKey, UI.pid), prog = P.progress[selKey] || 0;
    const ins = T0.ins && !known ? h('div', { class: 'ins' + (P.insights.includes(T0.key) ? ' got' : '') }, (P.insights.includes(T0.key) ? '✓ Breakthrough earned: ' : '💡 Breakthrough: ') + T0.ins.text + ' (cuts the cost by a third)') : null;
    const sec = T0.s >= 0 ? SECTORS[T0.s] : null;
    const detail = h('div', { class: 'card tdetail' },
      h('div', { class: 'row' }, h('b', { class: 'grow' }, T0.name), h('span', { class: 'note', style: 'margin:0' }, sec ? `${sec.glyph} ${sec.name}` : 'The beginning')),
      h('div', { class: 'note', style: 'margin:2px 0 6px' }, T0.desc || ''),
      known ? h('div', { class: 'pos' }, 'Researched.') : h('div', null, `${cost}🔬 · ${HX.researchTurns(G, UI.pid, selKey, sci)} turns at ${fmtN(sci)} science`, prog ? h('div', { class: 'prog sci' }, h('i', { style: `width:${Math.min(100, prog / cost * 100)}%` })) : null),
      Object.keys(HX.techAffinity(selKey)).length ? h('div', { class: 'affd', style: 'display:flex;gap:4px;margin:6px 0' }, HX.AFFINITIES.filter(A => HX.techAffinity(selKey)[A.key]).map(A => h('span', { class: 'chip', style: `border-color:${A.color};color:${A.color}` }, `${A.glyph} +${HX.techAffinity(selKey)[A.key]} ${A.name}`))) : null,
      h('div', { class: 'chips' }, techUnlocks(T0).map(([txt, later, great]) => h('span', { class: 'chip' + (great ? ' gold' : '') }, txt))),
      ins,
      known ? null : h('div', { class: 'bar' }, h('button', { class: 'pri', onclick: () => { HX.setResearch(G, UI.pid, selKey); Sound.play('select'); render(true); updateHUD(); } },
        path.length > 1 ? `Research path (${path.length} techs)` : P.research === selKey ? 'Researching' : 'Research this')));
    // quick picks: on a phone the web is big, so the best few open techs are one tap away
    const pa = HX.primaryAff(P), avail = HX.availableTechs(P);
    const rank = k => (k === tip ? -1000 : 0) - (pa ? (HX.techAffinity(k)[pa] || 0) * 2 : 0) + HX.researchTurns(G, UI.pid, k, sci);
    const picks = avail.slice().sort((a, b) => rank(a) - rank(b)).slice(0, 4);
    const quick = picks.length ? h('div', { class: 'qpicks' }, picks.map(k => { const t = TECHS[TECHI[k]], n = HX.researchTurns(G, UI.pid, k, sci);
      return h('button', { class: 'qpick' + (P.research === k ? ' on' : ''), onclick: () => { HX.setResearch(G, UI.pid, k); selKey = k; Sound.play('select'); render(false); updateHUD(); } },
        h('span', { class: 'tn' }, (k === tip ? '⭐ ' : '') + t.name), h('span', { class: 'tc' }, `${n === Infinity ? '∞' : n} turns`), h('span', { class: 'affd' }, affChips(t))); })) : null;
    const el = screen(
      h('h2', null, backBtn(back || backToMap), 'Technology web', h('span', { class: 'badge', style: 'font-size:12px' }, `${P.techs.length - 1}/${TECHS.length - 1}`)),
      h('p', { class: 'note', style: 'margin:0 0 6px' }, `🔬 ${fmtN(sci)} per turn. Each tech known makes later ones dearer. Drag the web; tap a tech to read it. Dashed links mean either neighbor opens the branch.`),
      quick ? h('div', { class: 'k', style: 'margin:2px 0 4px' }, pa ? `Quick picks · leaning toward ${HX.AFFINITIES.find(A => A.key === pa).glyph} ${HX.AFFINITIES.find(A => A.key === pa).name}` : 'Quick picks') : null, quick,
      wrap, detail,
      h('div', { class: 'bar' }, h('button', { onclick: () => { const t = TECHS[TECHI[P.research || selKey]]; const [px, py] = techPos(t); wrap.scrollLeft = px - wrap.clientWidth / 2; wrap.scrollTop = py - wrap.clientHeight / 2; } }, '◎ Current'), h('button', { class: 'pri', onclick: back || backToMap }, 'Done')));
    showScreen(el);
    if (keepScroll && sx !== null) { wrap.scrollLeft = sx; wrap.scrollTop = sy; }
    else { const [px, py] = techPos(TECHS[TECHI[selKey]]); wrap.scrollLeft = px - wrap.clientWidth / 2; wrap.scrollTop = py - wrap.clientHeight / 2; }
  };
  render(false);
}

// ---------- virtues ----------
function showPolicies(back) {
  const G = UI.G; if (!G) return;
  const P = G.players[UI.pid];
  const render = () => {
    const sc = $('screens').firstChild, top = sc ? sc.scrollTop : 0;
    const cul = HX.civReport(G, UI.pid).cul, cost = HX.policyCost(G, UI.pid);
    const turns = P.culturePool >= cost ? 0 : cul > 0 ? Math.ceil((cost - P.culturePool) / cul) : Infinity;
    const hl = HX.harmonyLevel(P);
    const tree = tr => {
      const n = HX.treeCount(P, tr);
      const cards = [];
      for (let tier = 1; tier <= 4; tier++) {
        cards.push(h('div', { class: 'tier' }, `Tier ${tier}` + (tier >= 3 ? ` · opens in the ${ERAS[[0, 0, 0, 1, 2][tier]]} phase` : '')));
        for (const p of tr.virtues.filter(v => v.tier === tier)) {
          const st = HX.policyStatus(G, UI.pid, p.key), adopted = P.policies.includes(p.key);
          cards.push(h('button', { class: 'virt ' + (adopted ? 'done' : st.ok ? 'ready' : 'locked'), onclick: () => {
            if (adopted) return;
            if (st.ok) confirmDlg(`Adopt ${p.name}?`, `${p.text} Costs ${st.cost} culture.`, 'Adopt', () => { HX.adoptPolicy(G, UI.pid, p.key); Sound.play('policy'); flushLog(); render(); updateHUD(); });
            else toast(st.why);
          } }, h('div', { class: 'a' }, (adopted ? '✓ ' : '') + p.name), h('div', { class: 'b' }, p.text)));
        }
      }
      return h('div', { class: 'vtree', style: `border-left:4px solid ${tr.color}` },
        h('div', { class: 'row' }, h('span', { style: 'font-size:22px' }, tr.glyph), h('div', { class: 'grow' }, h('b', null, tr.name), h('div', { class: 'note', style: 'margin:0' }, tr.desc)), h('b', null, `${n}/8`)),
        h('div', { class: 'vgrid' }, cards),
        h('div', { style: 'margin-top:6px' }, tr.depth.map(d => h('div', { class: 'syn' + (n >= d.n ? ' got' : '') }, `${n >= d.n ? '✓' : '◇'} Depth ${d.n}: ${d.text}`))));
    };
    const el = screen(
      h('h2', null, backBtn(back || backToMap), 'Virtues'),
      h('div', { class: 'grid2' },
        h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Culture stored'), h('div', { class: 'v' }, `🎭 ${fmtN(P.culturePool)}`), h('div', { class: 's' }, `+${fmtN(cul)} per turn`)),
        h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Next virtue'), h('div', { class: 'v' }, `${cost}`), h('div', { class: 's' }, turns === 0 ? 'Ready to adopt' : turns === Infinity ? 'No culture income' : `In ${turns} turn${turns > 1 ? 's' : ''}`))),
      h('div', { class: 'card' }, h('b', null, `☯️ Balance ${hl}`), h('div', { class: 'note', style: 'margin:2px 0' }, 'Breadth synergy: bonuses for holding at least N virtues in every tree.'),
        HX.HARMONY.map(hm => h('div', { class: 'syn' + (hl >= hm.n ? ' got' : '') }, `${hl >= hm.n ? '✓' : '◇'} ${hm.n} in every tree: ${hm.text}`))),
      h('p', { class: 'note' }, 'Each virtue raises the cost of the next; more colonies raise it too. Tier 2 needs a tier 1 virtue in the same tree, and so on. Depth synergies reward going deep in one tree.'),
      VIRTUE_TREES.map(tree),
      h('div', { class: 'bar' }, h('button', { class: 'pri', onclick: back || backToMap }, 'Done')));
    showScreen(el); el.scrollTop = top;
  };
  render();
}

// ---------- affinities ----------
function showAffinity(back) {
  const G = UI.G; if (!G) return;
  const P = G.players[UI.pid], pa = HX.primaryAff(P);
  const card = A => {
    const lv = HX.affLevel(P, A.key), xp = HX.affXp(P, A.key), next = HX.nextLevelAt(P, A.key), prev = lv ? HX.AFF_LEVELS[lv - 1] : 0;
    const V = VICTORIES.find(v => v.aff === A.key), proj = HX.PROJECT_OF[V.key];
    const lineUnits = Object.keys(LINES).map(lk => UNITS[LINES[lk].t2[A.key]].name).join(', ');
    return h('div', { class: 'affcard', style: `border-left:4px solid ${A.color}` },
      h('div', { class: 'hdr' }, h('div', { class: 'g', style: `background:${A.dark}` }, A.glyph), h('div', null, h('div', { class: 'n', style: `color:${A.color}` }, A.name + (pa === A.key ? ' · your path' : '')), h('div', { class: 'note', style: 'margin:0' }, `“${A.motto}”`)), h('div', { class: 'lv', style: `color:${A.color}` }, lv)),
      h('div', { class: 'affbar' }, h('i', { style: `width:${next ? Math.min(100, (xp - prev) / (next - prev) * 100) : 100}%;background:${A.color}` })),
      h('div', { class: 'note', style: 'margin:0' }, next ? `${xp} experience · level ${lv + 1} at ${next}` : `${xp} experience · maximum level`),
      next ? h('div', { class: 'nextperk', style: `border-color:${A.color}` }, h('b', null, `Next, level ${lv + 1}: `), HX.AFF_PERKS[A.key][lv].text) : null,
      h('p', { class: 'note' }, A.desc),
      h('details', { class: 'hgroup' }, h('summary', null, 'Perks by level'), HX.AFF_PERKS[A.key].map((pk, i) => h('div', { class: 'perk' + (i < lv ? ' got' : '') }, h('b', null, `${i + 1}`), h('span', null, (i < lv ? '✓ ' : '') + pk.text)))),
      h('div', { class: 'note' }, `Tier 2 units at level 3 (${lineUnits}). Tier 3 at level 7, fed by ${RES[RESI[AFF_RES[A.key]]].name}.`),
      h('div', { class: 'note' }, `${V.name} victory: ${V.desc}` + (proj ? ` Project: ${proj.glyph} ${proj.name}.` : '')));
  };
  const others = HX.majorPlayers(G).filter(Q => Q.id !== UI.pid && Q.alive && P.met.includes(Q.id));
  showScreen(screen(
    h('h2', null, backBtn(back || backToMap), 'Affinity'),
    h('p', null, 'Three philosophies divide the colonists. Levels unlock perks, buildings, unit upgrades and victories, and change how other leaders see you.'),
    h('div', { class: 'card', style: 'margin-bottom:10px' }, h('b', null, 'Where experience comes from'),
      h('div', { class: 'note', style: 'margin:4px 0 0' }, '🔬 Technologies: the colored badges on each tech in the web (Quick picks favor your path). 📜 Story answers: the colored edge shows which way each answer leans. ⛏ Excavations of ruins and vaults. 🔍 Studying nests, 🌱 seeding the Veil and 🐾 taming beasts feed Communion; 🧹 scouring the Veil feeds Lineage. Colony events offer some too.')),
    HX.pendingStory(G, UI.pid) ? h('button', { class: 'pri', style: 'width:100%;margin-bottom:10px', onclick: () => showPendingStory() }, '📜 The council awaits your answer') : null,
    HX.AFFINITIES.map(card),
    others.length ? [h('h3', null, 'Other factions'), h('div', { class: 'col' }, others.map(Q => { const qa = HX.primaryAff(Q); return h('div', { class: 'slot' }, h('div', { class: 'meta' }, h('div', { class: 'a' }, CIVS[Q.civ].name), h('div', { class: 'b' }, HX.AFFINITIES.map(A => `${A.glyph}${HX.affLevel(Q, A.key)}`).join('  ') + (qa ? ` · leans ${HX.AFFINITIES.find(A => A.key === qa).name}` : '')))); }))] : null,
    (P.story || []).length ? [h('h3', null, 'Choices made'), h('div', { class: 'col' }, (P.story || []).filter(k => P.storyChoices && P.storyChoices[k] !== undefined).map(k => { const S = HX.STORY.find(x => x.key === k), c = S.choices[P.storyChoices[k]]; return h('div', { class: 'note', style: 'margin:0' }, `${S.glyph} ${S.title}: ${c.label}. ${c.text}`); }))] : null,
    h('div', { class: 'bar' }, h('button', { class: 'pri', onclick: back || backToMap }, 'Done'))));
}

// ---------- story quests ----------
function showPendingStory() {
  const G = UI.G; if (!G || UI.busy) return false;
  const st = HX.pendingStory(G, UI.pid); if (!st) return false;
  Sound.play('faith');
  $('modal').replaceChildren(h('div', { class: 'dlg event' }, h('div', { class: 'evk' }, 'Story'), h('h4', null, `${st.glyph} ${st.title}`), h('p', null, st.text),
    (() => { const pa = HX.primaryAff(G.players[UI.pid]), A = pa && HX.AFFINITIES.find(x => x.key === pa); return h('div', { class: 'note', style: 'margin:0 0 6px' }, A ? `Your colony leans ${A.glyph} ${A.name} (level ${HX.affLevel(G.players[UI.pid], pa)}). Each answer is permanent.` : 'Each answer is permanent and nudges you toward one affinity.'); })(),
    h('div', { class: 'col' }, st.choices.map(o => { const A = o.aff && HX.AFFINITIES.find(x => x.key === o.aff);
      return h('button', { class: 'belief', style: A ? `border-left:4px solid ${A.color}` : '', onclick: () => { if (HX.resolveStory(G, UI.pid, o.i)) { closeModal(); Sound.play('policy'); flushLog(); updateHUD(); refreshAll(); setTimeout(showPendingEvent, 300); } } },
        h('div', { class: 'a' }, (A ? A.glyph + ' ' : '') + o.label), h('div', { class: 'b' }, o.text)); }))));
  return true;
}

// ---------- landfall ----------
function showLandfall() {
  const G = UI.G; if (!G) return;
  const P = G.players[UI.pid]; if (P.landed || !P.landing || G.cities.some(c => c.owner === UI.pid)) return;
  const sites = P.landing.map(t => HX.landingInfo(G, UI.pid, t));
  const names = ['The ark\'s target', 'Alternate site', 'Second alternate'];
  renderer.landing = P.landing;
  const card = (L, i) => h('div', { class: 'card landcard' },
    h('div', { class: 'a' }, `${i === 0 ? '🎯' : '🛬'} ${names[i] || 'Option'} · ${L.terrain}`),
    h('div', { class: 'b' }, `Site value ${L.score} · nearby 🌾${L.f} ⚙️${L.p} 💠${L.g}`),
    h('div', null, L.coast ? h('span', { class: 'sitechip' }, '🌊 Coast') : null, L.fresh ? h('span', { class: 'sitechip' }, '💧 Fresh water') : null,
      L.lux ? h('span', { class: 'sitechip' }, `💎 ${L.lux} luxury`) : null, L.strat ? h('span', { class: 'sitechip' }, `⚙️ ${L.strat} strategic`) : null,
      L.veil ? h('span', { class: 'sitechip' }, `🌫️ ${L.veil} Veil`) : h('span', { class: 'sitechip' }, 'No Veil')),
    h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { onclick: () => { closeModal(); renderer.centerOn(L.tile, true); toast('Open Choose landing site again when you are ready.', -1, 2600); } }, '👁 View'),
      h('button', { class: 'pri grow', onclick: () => { closeModal(); HX.chooseLanding(G, UI.pid, i); renderer.landing = null; Sound.play('found'); const s = G.units.find(u => u.owner === UI.pid && UNITS[u.type].founds); if (s) { renderer.centerOn(s.tile, true); setSel({ k: 'unit', id: s.id }); } refreshAll(); setTimeout(checkTips, 600); setTimeout(showPendingEvent, 400); } }, 'Land here')));
  $('modal').replaceChildren(h('div', { class: 'dlg' }, h('div', { class: 'evk' }, 'Landfall'), h('h4', null, 'Choose where the ark comes down'),
    h('p', null, 'Orbital scans found three landing sites. Your Colony Pod, troops and Explorers land together. You can found your first colony on the spot or walk a little farther.'),
    h('div', { class: 'landcards', style: 'max-height:60vh;overflow-y:auto' }, sites.map(card))));
}

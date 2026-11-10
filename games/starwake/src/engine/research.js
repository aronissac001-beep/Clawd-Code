// ===== research.js : tech cards, research progress, traditions, edicts, timed modifiers =====
function techInfo(id) {
  if (id && id.startsWith('rep_')) { const s = id.slice(4); return { id, name: REPEATABLE[s].name, stream: s, tier: 6, un: { mods: REPEATABLE[s].mods }, rep: true }; }
  return TECHS[id];
}
SW.techInfo = techInfo;
function techCost(G, e, id) {
  const t = techInfo(id); const m = empMods(G, e);
  let base = t.rep ? 11000 + 1600 * (e.rep[t.stream] || 0) : TIER_COST[t.tier] * (t.id === 'wakefield' ? 2.5 : 1);
  const sp = sprawlInfo(G, e);
  if (!t.rep) base *= 1 + 0.035 * streamCount(e, t.stream);
  return Math.round(base * (1 + sp.over * 0.009) * (1 + mv(m, 'techCost%') / 100));
}
SW.techCost = techCost;
function streamCount(e, stream) { let n = 0; for (const id in e.techs) { const t = TECHS[id]; if (t && t.stream === stream && !t.hidden) n++; } return n; }
function availableTechs(G, e, stream) {
  const n = streamCount(e, stream);
  return TECH_LIST.map(x => TECHS[x[0]]).filter(t => t.stream === stream && !e.techs[t.id] && (!t.pre || e.techs[t.pre]) && n >= TIER_NEED[t.tier]);
}
SW.availableTechs = availableTechs;
function techWeight(G, e, t) {
  let w = 10 / (1 + (t.tier - 1) * 0.35);
  const u = t.un, P = e.persona ? PERSONAS[e.persona] : null;
  if (P) {
    if ((u.comp || u.hull || u.sb) && P.fleet > 1.1) w *= 1.6;
    if (u.mods && (u.mods['research%'] || u.mods['techCost%']) && P.research > 1.1) w *= 1.6;
    if (u.mods && (u.mods['hab+'] || u.mods['growth%'] || u.mods['outpostCost%']) && P.expand > 1.1) w *= 1.5;
  }
  if (u.flag === 'beacons') w *= 1.5;
  return w;
}
function drawOptions(G, e, stream) {
  const r = e.research[stream];
  const avail = availableTechs(G, e, stream).filter(t => !r.opts.includes(t.id));
  const out = [];
  while (out.length < 3 && avail.length) {
    const t = rweighted(G, avail, x => techWeight(G, e, x));
    out.push(t.id); avail.splice(avail.indexOf(t), 1);
  }
  if (out.length < 3) out.push('rep_' + stream);
  r.opts = out;
}
SW.drawOptions = drawOptions;
function chooseTech(G, e, stream, id) {
  const r = e.research[stream];
  if (!r.opts.includes(id)) return 'Not offered';
  r.cur = id; return null;
}
SW.chooseTech = chooseTech;
function completeTech(G, e, id) {
  const t = techInfo(id);
  if (t.rep) e.rep[t.stream] = (e.rep[t.stream] || 0) + 1; else e.techs[id] = 1;
  e.stats.techs++;
  dirty(e);
  if (t.un && (t.un.comp || t.un.hull)) autoDesigns(G, e);
  if (!e.ai) log(G, e.id, `Research complete: ${t.name}${t.rep ? ' ' + e.rep[t.stream] : ''}.`, -1, 'tech');
  if (t.un && t.un.flag === 'beacons') log(G, -1, `${e.name} has mastered Wakefield Theory and can attune the Wake Beacons.`, -1, 'major');
}
SW.completeTech = completeTech;
function monthlyResearch(G, e) {
  const net = empireEcon(G, e).net;
  for (const k of RESEARCH) {
    const r = e.research[k];
    r.prog += Math.max(0, net[k] || 0);
    if (!r.opts.length) drawOptions(G, e, k);
    if (!r.cur) {
      if (e.ai || e.autoResearch) r.cur = aiPickTech(G, e, k);
      else { const cheapest = Math.min(...r.opts.map(id => techCost(G, e, id))); r.prog = Math.min(r.prog, cheapest * 1.5); continue; }
    }
    const cost = techCost(G, e, r.cur);
    if (r.prog >= cost) {
      r.prog -= cost; completeTech(G, e, r.cur); r.cur = null;
      r.prog = Math.min(r.prog, 200);
      drawOptions(G, e, k);
      if (e.ai || e.autoResearch) r.cur = aiPickTech(G, e, k);
    }
  }
}
SW.researchMonths = (G, e, stream) => {
  const r = e.research[stream]; if (!r.cur) return Infinity; const net = empireEcon(G, e).net[stream] || 0;
  const left = techCost(G, e, r.cur) - r.prog; return left <= 0 ? 0 : net > 0 ? Math.ceil(left / net) : Infinity;
};

// ---------- traditions ----------
function tradPicks(e) { let n = 0; for (const k in e.trads) n += e.trads[k]; return n; }
function tradCost(G, e) {
  const m = empMods(G, e), sp = sprawlInfo(G, e);
  const n = tradPicks(e);
  return Math.round((80 + 55 * n) * (1 + n * 0.04) * (1 + sp.over * 0.009) * (1 + mv(m, 'tradCost%') / 100));
}
SW.tradCost = tradCost;
function canTradition(G, e, tree) {
  const T = TRADITIONS[tree]; if (!T) return 'Unknown';
  const n = e.trads[tree] || 0; if (n > T.nodes.length) return 'Completed';
  if (e.res.unity < tradCost(G, e)) return 'Not enough unity';
  return null;
}
function takeTradition(G, e, tree) {
  const err = canTradition(G, e, tree); if (err) return err;
  e.res.unity -= tradCost(G, e);
  e.trads[tree] = (e.trads[tree] || 0) + 1;
  dirty(e);
  const n = e.trads[tree], T = TRADITIONS[tree];
  if (!e.ai) log(G, e.id, n === 1 ? `Adopted the ${T.name} traditions.` : n > T.nodes.length ? `${T.name} traditions completed!` : `Tradition gained: ${T.nodes[n - 2].name}.`, -1, 'trad');
  return null;
}
SW.canTradition = canTradition; SW.takeTradition = takeTradition;
// Legacy Works: a repeatable unity sink once three tradition trees are complete
function legacyOpen(e) { return TRADITION_KEYS.filter(k => (e.trads[k] || 0) > TRADITIONS[k].nodes.length).length >= 3; }
function legacyCost(G, e) { return Math.round(tradCost(G, e) * (1 + (e.legacy || 0) * 0.15)); }
function takeLegacy(G, e) {
  if (!legacyOpen(e)) return 'Complete three tradition trees first';
  const c = legacyCost(G, e); if (e.res.unity < c) return 'Not enough unity';
  e.res.unity -= c; e.legacy = (e.legacy || 0) + 1; dirty(e);
  if (!e.ai) log(G, e.id, `Legacy Work ${e.legacy} completed.`, -1, 'trad');
  return null;
}
SW.legacyOpen = legacyOpen; SW.legacyCost = legacyCost; SW.takeLegacy = takeLegacy;

// ---------- edicts ----------
function edictSlots(G, e) { return 2 + mv(empMods(G, e), 'edicts+'); }
function activeEdicts(G, e) { return Object.keys(e.edicts).filter(k => e.edicts[k] > G.day); }
function edictCost(G, e, k) { return Math.round(EDICTS[k].cost * (1 + colonies(G, e).length * 0.04)); }
function canEdict(G, e, k) {
  if (!EDICTS[k]) return 'Unknown';
  if (e.edicts[k] > G.day) return 'Already active';
  if (activeEdicts(G, e).length >= edictSlots(G, e)) return 'No free edict slot';
  if (e.res.influence < edictCost(G, e, k)) return 'Not enough influence';
  return null;
}
function enactEdict(G, e, k) {
  const err = canEdict(G, e, k); if (err) return err;
  e.res.influence -= edictCost(G, e, k); e.edicts[k] = G.day + EDICTS[k].days; dirty(e);
  if (!e.ai) log(G, e.id, `Edict enacted: ${EDICTS[k].name}.`, -1, 'trad');
  return null;
}
function cancelEdict(G, e, k) { if (e.edicts[k] > G.day) { e.edicts[k] = G.day; dirty(e); } }
SW.edictSlots = edictSlots; SW.activeEdicts = activeEdicts; SW.edictCost = edictCost; SW.canEdict = canEdict; SW.enactEdict = enactEdict; SW.cancelEdict = cancelEdict;
function addTimed(G, e, name, mods, days) { e.timed.push({ name, mods, until: G.day + days }); dirty(e); }
function expireTimed(G, e) {
  const n = e.timed.length; e.timed = e.timed.filter(t => t.until > G.day); if (e.timed.length !== n) dirty(e);
  for (const k in e.edicts) if (e.edicts[k] <= G.day) { delete e.edicts[k]; dirty(e); if (!e.ai) log(G, e.id, `Edict expired: ${EDICTS[k].name}.`, -1, 'info'); }
}
SW.addTimed = addTimed;

// ---------- ascension perks ----------
function perkSlots(e) { return Math.min(5, Math.floor(tradPicks(e) / 7)); }
function canPerk(G, e, k) {
  const P = PERKS[k]; if (!P) return 'Unknown';
  if ((e.perks || []).includes(k)) return 'Already taken';
  if ((e.perks || []).length >= perkSlots(e)) return 'No free slot: one opens for every seven traditions';
  if (P.needs && !e.techs[P.needs]) return 'Requires ' + TECHS[P.needs].name;
  return null;
}
function takePerk(G, e, k) {
  const err = canPerk(G, e, k); if (err) return err;
  e.perks = (e.perks || []).concat([k]); dirty(e);
  log(G, e.ai ? e.id : e.id, `${e.name} has embraced ${PERKS[k].name}.`, -1, e.ai ? 'info' : 'trad');
  return null;
}
SW.perkSlots = perkSlots; SW.canPerk = canPerk; SW.takePerk = takePerk;

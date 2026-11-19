// ===== politics.js : the Colony Council: three factions, their demands, support, perks and unrest =====
// Once the colony has 25 people, colonists sort themselves into three factions by what they do.
// Each faction makes demands with deadlines; meeting one wins support, failing or refusing loses it.
// High support grants a perk; low support brings unrest. Demands compete, so choosing whom to please matters.
const FACTIONS = {
  hearth: { name: 'The Hearth', icon: 'home', color: '#ffb35c', desc: 'Families, farmers and the Kessa-born. They want homes, services and a gentler pace.',
    perk: { comfort: 6, birth: 0.15 }, perkText: '+6 comfort, +15% births', unrest: { comfort: -6 }, unrestText: '-6 comfort', specs: ['botanist', 'none', 'security'] },
  forge: { name: 'The Forge', icon: 'industry', color: '#e88a3c', desc: 'Engineers and miners. They want output, exports and self-reliance.',
    perk: { factory: 0.12, mine: 0.08 }, perkText: '+12% factories, +8% mining', unrest: { factory: -0.12 }, unrestText: '-12% factories', specs: ['engineer', 'geologist'] },
  lantern: { name: 'The Lantern', icon: 'research', color: '#b48cff', desc: 'Scientists and medics. They want discovery: research, surveys, anomalies.',
    perk: { research: 0.12, health: 0.1 }, perkText: '+12% research, faster healing', unrest: { research: -0.12 }, unrestText: '-12% research', specs: ['scientist', 'medic'] },
};
// demands: how to measure progress from a snapshot taken when the demand is made
const DEMANDS = {
  service: { f: 'hearth', make: () => ({ need: 1, sols: 8, text: 'Open a new service module (canteen, lounge, gym, clinic and so on).' }), have: (G, d) => serviceCount(G) - d.base, base: G => serviceCount(G) },
  homes: { f: 'hearth', make: G => ({ need: 8, sols: 8, text: 'Add 8 more beds.' }), have: (G, d) => bedCount(G) - d.base, base: G => bedCount(G) },
  nonight: { f: 'hearth', make: () => ({ need: 4, sols: 7, text: 'Close every night shift for 4 sols in a row.' }), have: (G, d) => d.got || 0, base: () => 0, hourly: true },
  parts: { f: 'forge', make: G => ({ need: 40 + 10 * Math.floor(G.colonists.length / 25), sols: 8, text: '' }), have: (G, d) => d.got || 0, base: () => 0, hourly: true, label: d => 'Make ' + d.need + ' parts.' },
  exports: { f: 'forge', make: G => ({ need: 600, sols: 9, text: 'Earn 600 funding from exports.' }), have: (G, d) => G.st.exportFunds - d.base, base: G => G.st.exportFunds },
  factory: { f: 'forge', make: () => ({ need: 1, sols: 8, text: 'Build another factory or extractor.' }), have: (G, d) => industryCount(G) - d.base, base: G => industryCount(G) },
  tech: { f: 'lantern', make: () => ({ need: 2, sols: 9, text: 'Complete 2 technologies.' }), have: (G, d) => techCount(G) - d.base, base: G => techCount(G) },
  survey: { f: 'lantern', make: () => ({ need: 2, sols: 9, text: 'Survey 2 more sectors.' }), have: (G, d) => G.sectors.filter(s => s.st).length - d.base, base: G => G.sectors.filter(s => s.st).length },
  anomaly: { f: 'lantern', make: () => ({ need: 1, sols: 10, text: 'Investigate an anomaly with the Pathfinder.' }), have: (G, d) => G.st.anomalies - d.base, base: G => G.st.anomalies, cond: G => G.anomalies.some(a => !a.done && scannedAt(G, a.x, a.y)) },
};
function serviceCount(G) { return G.buildings.filter(b => b.mod && b.built && MODULES[b.t].service).length; }
function bedCount(G) { let n = 0; for (const b of G.buildings) if (b.mod && b.built && MODULES[b.t].housing) n += MODULES[b.t].housing; return n; }
function industryCount(G) { return G.buildings.filter(b => !b.mod && b.built && BUILDINGS[b.t].cat === 'industry').length; }
function factionOf(c) { if (c.born !== undefined) return 'hearth'; for (const k in FACTIONS) if (FACTIONS[k].specs.includes(c.spec)) return k; return 'hearth'; }
function factionSizes(G) { const n = { hearth: 0, forge: 0, lantern: 0 }; for (const c of G.colonists) if (stage(c) !== 'child') n[factionOf(c)]++; return n; }
// perks and unrest feed the colony's modifiers
function councilMods(G) { const m = {}; if (!G.council) return m; for (const k in FACTIONS) { const s = G.council.sup[k], o = s >= 65 ? FACTIONS[k].perk : s < 25 ? FACTIONS[k].unrest : null; if (o) for (const x in o) m[x] = (m[x] || 0) + o[x]; } return m; }
function councilState(G, k) { const s = G.council.sup[k]; return s >= 65 ? 'perk' : s < 25 ? 'unrest' : 'calm'; }
function setSupport(G, k, d, why) {
  const C = G.council, before = councilState(G, k);
  C.sup[k] = clamp(Math.round((C.sup[k] + d) * 10) / 10, 0, 100);
  const after = councilState(G, k);
  if (before !== after) {
    computeMods(G);
    log(G, FACTIONS[k].name + (after === 'perk' ? ' is pleased with the colony: ' + FACTIONS[k].perkText + '.' : after === 'unrest' ? ' is angry and protests: ' + FACTIONS[k].unrestText + ' until support recovers.' : ' has calmed down.'), after === 'unrest' ? 'bad' : after === 'perk' ? 'good' : 'info');
  } else if (why) log(G, FACTIONS[k].name + ' support ' + (d > 0 ? 'rises' : 'falls') + ' (' + why + ').', d > 0 ? 'good' : 'warn');
}
function newDemand(G, k) {
  const r = rng(G), kinds = Object.keys(DEMANDS).filter(x => DEMANDS[x].f === k && (!DEMANDS[x].cond || DEMANDS[x].cond(G)) && x !== G.council.last[k]);
  if (!kinds.length) return;
  const kind = r.pick(kinds), D = DEMANDS[kind], m = D.make(G);
  const d = { id: G.nextId++, f: k, kind, need: m.need, due: G.tick + m.sols * HOURS_PER_SOL, base: D.base(G), got: 0, text: m.text || (D.label ? D.label(m) : '') };
  if (D.label) d.text = D.label(d);
  G.council.dem[k] = d; G.council.last[k] = kind;
  log(G, FACTIONS[k].name + ' demands: ' + d.text + ' Due sol ' + solOf(d.due) + '. See People → Council.', 'info');
  fx(G, { k: 'contract' });
}
function demandProgress(G, d) { return DEMANDS[d.kind].have(G, d); }
// the council forms, then each faction speaks up every 9-14 sols
function politicsHour(G) {
  if (!G.council) {
    if (G.colonists.length < 25) return;
    G.council = { sup: { hearth: 50, forge: 50, lantern: 50 }, dem: {}, next: {}, last: {}, won: 0, lost: 0 };
    const r = rng(G); for (const k in FACTIONS) G.council.next[k] = G.tick + (2 + r.int(8)) * HOURS_PER_SOL;
    log(G, 'With 25 colonists, Kessa forms a Colony Council. Three factions now speak for their members and will make demands. See People → Council.', 'good');
    computeMods(G); return;
  }
  const C = G.council;
  for (const k in FACTIONS) {
    const d = C.dem[k];
    if (d) {
      if (DEMANDS[d.kind].hourly) {
        if (d.kind === 'parts') d.got += (G._hr && G._hr.prod.parts) || 0;
        if (d.kind === 'nonight' && G.tick % HOURS_PER_SOL === 0) d.got = G.buildings.some(b => b.built && b.shifts && b.shifts[2]) ? 0 : d.got + 1;
      }
      if (demandProgress(G, d) >= d.need) { C.dem[k] = null; C.won++; setSupport(G, k, 16, null); log(G, FACTIONS[k].name + ': demand met (' + d.text.replace(/\.$/, '') + '). Support ' + Math.round(C.sup[k]) + '.', 'good'); C.next[k] = G.tick + (9 + rng(G).int(6)) * HOURS_PER_SOL; }
      else if (G.tick >= d.due) { C.dem[k] = null; C.lost++; setSupport(G, k, -14, null); log(G, FACTIONS[k].name + ': demand ignored (' + d.text.replace(/\.$/, '') + '). Support ' + Math.round(C.sup[k]) + '.', 'warn'); C.next[k] = G.tick + (9 + rng(G).int(6)) * HOURS_PER_SOL; }
    } else if (G.tick >= C.next[k]) newDemand(G, k);
  }
  // support drifts slowly back toward the middle
  if (G.tick % HOURS_PER_SOL === 0) for (const k in FACTIONS) { const s = C.sup[k]; if (Math.abs(s - 50) > 0.5) C.sup[k] = Math.round((s + (50 - s) * 0.04) * 10) / 10; }
}
function refuseDemand(G, k) {
  const C = G.council, d = C && C.dem[k]; if (!d) return { err: 'No demand from that faction.' };
  C.dem[k] = null; C.lost++; setSupport(G, k, -8, 'demand refused'); C.next[k] = G.tick + (8 + rng(G).int(6)) * HOURS_PER_SOL;
  return { ok: true };
}
Object.assign(KC, { FACTIONS, DEMANDS, factionOf, factionSizes, councilMods, councilState, demandProgress, refuseDemand });

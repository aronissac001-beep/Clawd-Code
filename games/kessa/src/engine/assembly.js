// ===== assembly.js : the Colony Assembly. At 60 colonists the council becomes a legislature: a form of government
// sets how its 15 seats are shared, laws from five fields pass or fail on the factions' votes, crises can repeal them,
// and a declaration of Independence needs the Assembly's backing.
const ASM = { pop: 60, seats: 15, maxLaws: 4, cooldown: 4, backing: 35 };
const GOVS = {
  commonwealth: { name: 'Commonwealth', desc: 'Seats follow faction size. Every voice counts the same.', bias: { hearth: 1, forge: 1, lantern: 1 } },
  guild: { name: 'Guild Compact', desc: 'The workshops hold the purse: the Forge gets half again its share of seats.', bias: { hearth: 1, forge: 1.5, lantern: 1 } },
  academy: { name: 'Academy Rule', desc: 'Learning leads: the Lantern gets half again its share of seats.', bias: { hearth: 1, forge: 1, lantern: 1.5 } },
  moot: { name: 'Hearth Moot', desc: 'Households gather to decide: the Hearth gets half again its share of seats.', bias: { hearth: 1.5, forge: 1, lantern: 1 } }
};
// stance: +1 the faction wants it, -1 it opposes it
const LAWS = {
  shortshifts: { f: 'labor', name: 'Short Shifts', mods: { morale: 6, factory: -0.1 }, text: '+6 morale, factories −10%', st: { hearth: 1, forge: -1, lantern: 0 } },
  drive: { f: 'labor', name: 'Production Drive', mods: { factory: 0.2, morale: -5 }, text: 'factories +20%, −5 morale', st: { hearth: -1, forge: 1, lantern: 0 } },
  openhomes: { f: 'rights', name: 'Open Housing Act', mods: { comfort: 6, funding: -0.1 }, text: '+6 comfort, stipend −10%', st: { hearth: 1, forge: 0, lantern: 0 } },
  freevoice: { f: 'rights', name: 'Free Voice Charter', mods: { morale: 4, homesick: -0.3, export: -0.1 }, text: '+4 morale, fewer homesick, exports −10%', st: { hearth: 0, forge: -1, lantern: 1 } },
  openlabs: { f: 'research', name: 'Open Laboratories', mods: { research: 0.2, funding: -0.05 }, text: 'research +20%, stipend −5%', st: { hearth: 0, forge: -1, lantern: 1 } },
  applied: { f: 'research', name: 'Applied Science Mandate', mods: { research: 0.08, factory: 0.08, morale: -2 }, text: 'research and factories +8%, −2 morale', st: { hearth: 0, forge: 1, lantern: -1 } },
  quotas: { f: 'economy', name: 'Export Quotas', mods: { export: 0.2, comfort: -3 }, text: 'exports +20%, −3 comfort', st: { hearth: -1, forge: 1, lantern: 0 } },
  commons: { f: 'economy', name: 'Common Granary', mods: { farm: 0.15, factory: -0.05 }, text: 'farms +15%, factories −5%', st: { hearth: 1, forge: -1, lantern: 0 } },
  wardens: { f: 'security', name: 'Hazard Wardens', mods: { maint: -0.12, morale: -2 }, text: 'upkeep 12% slower, −2 morale', st: { hearth: 0, forge: 1, lantern: -1 } },
  clinics: { f: 'security', name: 'Public Clinics', mods: { health: 0.15, funding: -0.08 }, text: 'faster healing, stipend −8%', st: { hearth: 1, forge: 0, lantern: 1 } }
};
const LAW_FIELDS = { labor: 'Labor', rights: 'Rights', research: 'Research', economy: 'Economy', security: 'Security' };
function asmRng(G, k) { return RNG.fromSeed(G.seed + '/assembly/' + k + '/' + (G.assembly ? G.assembly.n : 0)); }
// seats: 15, shared by faction size times the government's bias (largest remainders)
function seats(G) {
  const A = G.assembly, sz = factionSizes(G), bias = GOVS[(A && A.gov) || 'commonwealth'].bias, w = {}; let tot = 0;
  for (const k in FACTIONS) { w[k] = (sz[k] + 1) * bias[k]; tot += w[k]; }
  const out = {}, rem = []; let used = 0;
  for (const k in FACTIONS) { const x = w[k] / tot * ASM.seats; out[k] = Math.floor(x); used += out[k]; rem.push([x - out[k], k]); }
  rem.sort((a, b) => b[0] - a[0]); for (let i = 0; used < ASM.seats; i++, used++) out[rem[i % 3][1]]++;
  return out;
}
// how a faction votes on a law: its stance, shifted by how it feels about the colony (support)
function yesShare(G, k, law, repeal) { const st = LAWS[law].st[k] * (repeal ? -1 : 1); return clamp(0.5 + 0.38 * st + (G.council.sup[k] - 50) / 120, 0, 1); }
function countVote(G, law, repeal) { const s = seats(G); let yes = 0; const by = {}; for (const k in FACTIONS) { const y = Math.round(s[k] * yesShare(G, k, law, repeal)); by[k] = [y, s[k]]; yes += y; } return { yes, of: ASM.seats, pass: yes * 2 > ASM.seats, by }; }
function assemblyHour(G) {
  if (!G.council) return;
  if (!G.assembly) {
    if (G.colonists.length < ASM.pop) return;
    G.assembly = { gov: null, since: G.tick, laws: {}, next: 0, n: 0, crisisAt: G.tick + 18 * HOURS_PER_SOL, history: [] };
    log(G, 'The council has grown into the Colony Assembly: 15 seats, shared among the factions. Choose a form of government (People → Council).', 'good'); fx(G, { k: 'milestone' });
    return;
  }
  const A = G.assembly;
  // with no choice after 5 sols, the Assembly settles on a Commonwealth
  if (!A.gov && G.tick - A.since > 5 * HOURS_PER_SOL) chooseGov(G, 'commonwealth');
  // a political crisis: a faction that is angry and opposes a law forces a repeal vote it wins
  if (G.tick >= A.crisisAt) {
    A.crisisAt = G.tick + (16 + asmRng(G, 'crisis').int(10)) * HOURS_PER_SOL;
    for (const k in FACTIONS) {
      if (G.council.sup[k] >= 30) continue;
      const law = Object.keys(A.laws).find(l => LAWS[l].st[k] < 0); if (!law) continue;
      delete A.laws[law]; A.n++; A.history.push({ t: G.tick, law, k: 'crisis' }); computeMods(G);
      log(G, 'Political crisis: ' + FACTIONS[k].name + ' walked out of the Assembly until ' + LAWS[law].name + ' was repealed.', 'bad');
      setSupport(G, k, 8, 'their law was repealed'); break;
    }
  }
}
function chooseGov(G, gov) {
  const A = G.assembly; if (!A || !GOVS[gov]) return { err: 'No Assembly yet.' }; if (A.gov) return { err: 'The government is already chosen.' };
  A.gov = gov; log(G, 'The Assembly adopts a ' + GOVS[gov].name + '. ' + GOVS[gov].desc, 'info');
  for (const k in FACTIONS) if (GOVS[gov].bias[k] > 1) setSupport(G, k, 10, 'the new government favours them');
  return { ok: true };
}
function lawCheck(G, law, repeal) {
  const A = G.assembly; if (!A || !A.gov) return { ok: false, why: 'The Assembly must first choose a government.' };
  if (!LAWS[law]) return { ok: false, why: 'No such law.' };
  if (G.tick < A.next) return { ok: false, why: 'The Assembly sits again in ' + Math.ceil((A.next - G.tick) / 24) + ' sols.' };
  if (!repeal && A.laws[law]) return { ok: false, why: 'Already law.' };
  if (repeal && !A.laws[law]) return { ok: false, why: 'Not in force.' };
  if (!repeal && Object.keys(A.laws).length >= ASM.maxLaws) return { ok: false, why: 'At most ' + ASM.maxLaws + ' laws at once: repeal one first.' };
  if (!repeal && Object.keys(A.laws).some(l => LAWS[l].f === LAWS[law].f)) return { ok: false, why: 'Already a ' + LAW_FIELDS[LAWS[law].f].toLowerCase() + ' law in force.' };
  return { ok: true };
}
// put a law (or its repeal) to the vote. It passes with a majority of the 15 seats; winners and losers remember it.
function propose(G, law, repeal) {
  const c = lawCheck(G, law, repeal); if (!c.ok) return { err: c.why };
  const A = G.assembly, v = countVote(G, law, repeal); A.next = G.tick + ASM.cooldown * HOURS_PER_SOL; A.n++;
  A.history.push({ t: G.tick, law, k: repeal ? 'repeal' : 'pass', yes: v.yes, ok: v.pass }); if (A.history.length > 30) A.history.shift();
  if (v.pass) {
    if (repeal) delete A.laws[law]; else A.laws[law] = G.tick;
    for (const k in FACTIONS) { const st = LAWS[law].st[k] * (repeal ? -1 : 1); if (st) setSupport(G, k, st > 0 ? 5 : -6, (st > 0 ? 'won' : 'lost') + ' the vote on ' + LAWS[law].name); }
    computeMods(G); log(G, (repeal ? 'Repealed: ' : 'New law: ') + LAWS[law].name + ' (' + v.yes + ' of 15 seats).', 'good');
  } else log(G, 'The Assembly voted down ' + (repeal ? 'the repeal of ' : '') + LAWS[law].name + ' (' + v.yes + ' of 15 seats).', 'warn');
  return { ok: true, pass: v.pass, vote: v };
}
function assemblyMods(G) { const m = {}, A = G.assembly; if (!A) return m; for (const l in A.laws) for (const [k, v] of Object.entries(LAWS[l].mods)) m[k] = (m[k] || 0) + v; return m; }
// the seat-weighted mood of the Assembly; a declaration of Independence needs it at 35 or more
function backing(G) { if (!G.assembly) return 100; const s = seats(G); let t = 0; for (const k in FACTIONS) t += s[k] * G.council.sup[k]; return Math.round(t / ASM.seats); }
Object.assign(KC, { ASM, GOVS, LAWS, LAW_FIELDS, seats, countVote, yesShare, assemblyHour, chooseGov, lawCheck, propose, assemblyMods, backing });

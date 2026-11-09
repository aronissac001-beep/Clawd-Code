// ===== diplomacy.js : attitudes, trades, borders, alliances =====
const DIP = { dealTurns: 20, obTurns: 30, allyTurns: 30, denounceTurns: 30, offerTurns: 4 };
const PERSONA_WARMTH = { aurelian: 0, thornwall: 0, sunreach: -1, meridian: 1, verdant: 1, emberforge: 0 };

function rel(G, a, b) { const k = warKey(a, b); return G.dip[k] || (G.dip[k] = { ob: 0, ally: 0, den: {}, m: {} }); }
function memOf(G, actor, other) { const r = rel(G, actor, other); return r.m[actor] || (r.m[actor] = { decl: [], broke: -999, demand: -999, refused: -999 }); }
function hasOB(G, a, b) { const r = G.dip[warKey(a, b)]; return !!r && r.ob > G.turn; }
function allied(G, a, b) { if (a === b) return false; const r = G.dip[warKey(a, b)]; return !!r && r.ally > G.turn; }
function alliesOf(G, pid) { return majorPlayers(G).filter(Q => Q.alive && allied(G, pid, Q.id)).map(Q => Q.id); }
function denounced(G, by, target) { const r = G.dip[warKey(by, target)]; return !!r && r.den[by] !== undefined && G.turn - r.den[by] < DIP.denounceTurns; }

// ---- resources that can be traded ----
function luxSources(G, pid) {
  const m = G.map, out = {};
  for (const c of G.cities) if (c.owner === pid) for (const t of c.tiles) {
    const r = m.res[t];
    if (r >= 0 && RES[r].kind === 'luxury' && m.improv[t] === IMPI[RES_IMPROV[RES[r].key]]) out[RES[r].key] = (out[RES[r].key] || 0) + 1;
  }
  return out;
}
function stratSources(G, pid) {
  const m = G.map, out = { horses: 0, iron: 0, saltpeter: 0 };
  for (const c of G.cities) if (c.owner === pid) for (const t of c.tiles) {
    const r = m.res[t];
    if (r >= 0 && RES[r].kind === 'strategic' && resVisible(G, pid, r) && m.improv[t] === IMPI[RES_IMPROV[RES[r].key]]) out[RES[r].key]++;
  }
  return out;
}
function flows(G, pid) {
  const f = { luxOut: {}, luxIn: {}, strOut: {}, strIn: {} };
  for (const d of G.deals || []) {
    if (d.kind === 'lux') { if (d.from === pid) f.luxOut[d.key] = (f.luxOut[d.key] || 0) + 1; if (d.to === pid) f.luxIn[d.key] = (f.luxIn[d.key] || 0) + 1; }
    if (d.kind === 'strat') { if (d.from === pid) f.strOut[d.key] = (f.strOut[d.key] || 0) + 1; if (d.to === pid) f.strIn[d.key] = (f.strIn[d.key] || 0) + 1; }
  }
  return f;
}
function spareLux(G, pid) { const s = luxSources(G, pid), f = flows(G, pid), out = []; for (const k in s) if (s[k] - (f.luxOut[k] || 0) >= 2) out.push(k); return out; }
function anyLuxToGive(G, pid) { const s = luxSources(G, pid), f = flows(G, pid), out = []; for (const k in s) if (s[k] - (f.luxOut[k] || 0) >= 1) out.push(k); return out; }
function stratToGive(G, pid) { const s = stratSources(G, pid), f = flows(G, pid), out = []; for (const k in s) if (s[k] - (f.strOut[k] || 0) >= 1) out.push(k); return out; }

// ---- attitude ----
const ATT_LEVELS = [[6, 'Devoted', '😊'], [3, 'Friendly', '🙂'], [-1, 'Neutral', '😐'], [-5, 'Wary', '😒'], [-99, 'Hostile', '😠']];
function attitudeLabel(score) { for (const [min, name, face] of ATT_LEVELS) if (score >= min) return { name, face }; return { name: 'Hostile', face: '😠' }; }
function attitude(G, me, them) {
  G._att = G._att && G._att.turn === G.turn ? G._att : { turn: G.turn, map: new Map() };
  const ck = me + '>' + them, hit = G._att.map.get(ck); if (hit) return hit;
  const reasons = [], add = (text, v) => { if (v) reasons.push([text, v]); };
  const M = G.players[me], g = G._grid;
  if (!M.human) add('Our character', PERSONA_WARMTH[civKey(M)] || 0);
  if (atWar(G, me, them)) add('We are at war', -8);
  const mt = memOf(G, them, me);
  const wars = mt.decl.filter(t => G.turn - t < 60).length; if (wars) add('They attacked us before', -Math.min(6, 3 * wars));
  if (G.turn - mt.broke < 60) add('They broke a treaty', -3);
  if (denounced(G, them, me)) add('They denounced us', -4);
  if (denounced(G, me, them)) add('We denounced them', -2);
  if (G.turn - mt.demand < 40) add('They demanded tribute', -2);
  let close = 0;
  for (const a of G.cities) if (a.owner === me) for (const b of G.cities) if (b.owner === them && g.dist(a.tile, b.tile) <= 6) close++;
  if (close) add('Our borders press together', -Math.min(4, close));
  const T = G.players[them];
  if (T.religion !== null) {
    let n = 0; for (const c of G.cities) if (c.owner === me && cityReligion(G, c).major === T.religion && M.religion !== T.religion) n++;
    if (n) add('They spread their faith in our cities', -Math.min(3, n));
  }
  const capM = G.cities.find(c => c.owner === me && c.capital), capT = G.cities.find(c => c.owner === them && c.capital);
  if (capM && capT) { const a = cityReligion(G, capM).major, b = cityReligion(G, capT).major; if (a !== null && a === b) add('We share a faith', 2); }
  const routes = G.routes.filter(r => { const x = cityById(G, r.from), y = cityById(G, r.to); return x && y && ((x.owner === me && y.owner === them) || (x.owner === them && y.owner === me)); }).length;
  if (routes) add('Trade routes connect us', Math.min(3, routes));
  if ((G.deals || []).some(d => (d.from === me && d.to === them) || (d.from === them && d.to === me))) add('We have trade deals', 1);
  if (hasOB(G, me, them)) add('Open borders', 1);
  if (allied(G, me, them)) add('We are allies', 3);
  if (majorPlayers(G).some(X => X.id !== me && X.id !== them && X.alive && atWar(G, me, X.id) && atWar(G, them, X.id))) add('We fight a common enemy', 2);
  if (!wars && !atWar(G, me, them) && G.turn > 60) add('A long peace', 1);
  const pm = militaryPower(G, me), pt = militaryPower(G, them);
  if (pt > pm * 2.2) add('Their army frightens us', -1);
  let score = 0; for (const [, v] of reasons) score += v;
  const out = Object.assign({ score, reasons }, attitudeLabel(score));
  G._att.map.set(ck, out);
  return out;
}

// ---- deals ----
// item: { by: pid giving (-1 = both), kind: gold|gpt|lux|strat|ob|ally|peace|war, key, amount, target }
function itemLabel(G, it) {
  switch (it.kind) {
    case 'gold': return `${it.amount} gold`;
    case 'gpt': return `${it.amount} gold per turn for ${DIP.dealTurns} turns`;
    case 'lux': case 'strat': return `${RES[RESI[it.key]].glyph} ${RES[RESI[it.key]].name} for ${DIP.dealTurns} turns`;
    case 'ob': return `Open borders for ${DIP.obTurns} turns`;
    case 'ally': return `Alliance for ${DIP.allyTurns} turns`;
    case 'peace': return 'Peace treaty';
    case 'war': return `War against the ${CIVS[G.players[it.target].civ].name}`;
  }
  return it.kind;
}
function itemStatus(G, a, b, it) {
  const giver = it.by === -1 ? a : it.by, recv = giver === a ? b : a, P = G.players[giver];
  switch (it.kind) {
    case 'gold': return it.amount > 0 && P.gold >= it.amount ? { ok: true } : { ok: false, why: 'Not enough gold.' };
    case 'gpt': return it.amount > 0 && (P.lastGold || 0) >= it.amount ? { ok: true } : { ok: false, why: 'Income too low.' };
    case 'lux': return anyLuxToGive(G, giver).includes(it.key) && !G.deals.some(d => d.kind === 'lux' && d.from === giver && d.to === recv && d.key === it.key) ? { ok: true } : { ok: false, why: 'No copy to spare.' };
    case 'strat': return stratToGive(G, giver).includes(it.key) ? { ok: true } : { ok: false, why: 'No source to spare.' };
    case 'ob': return !atWar(G, a, b) && !hasOB(G, a, b) ? { ok: true } : { ok: false, why: 'Not possible now.' };
    case 'ally': return !atWar(G, a, b) && !allied(G, a, b) ? { ok: true } : { ok: false, why: 'Not possible now.' };
    case 'peace': return atWar(G, a, b) ? { ok: true } : { ok: false, why: 'You are not at war.' };
    case 'war': { const ws = warStatus(G, giver, it.target); return it.target !== recv && ws.ok && !allied(G, giver, it.target) ? { ok: true } : { ok: false, why: ws.why || 'Not possible.' }; }
  }
  return { ok: false, why: 'Unknown item.' };
}
// How much the deal is worth to pid (positive = good for pid).
function dealValue(G, pid, other, items) {
  const P = G.players[pid], att = attitude(G, pid, other).score, hap = civHappiness(G, pid).net;
  const mine = luxSources(G, pid), fl = flows(G, pid), have = new Set(luxuriesOf(G, pid));
  let v = 0;
  for (const it of items) {
    const giving = it.by === pid, sign = giving ? -1 : 1;
    switch (it.kind) {
      case 'gold': v += sign * it.amount; break;
      case 'gpt': v += sign * it.amount * DIP.dealTurns * 0.75; break;
      case 'lux':
        if (giving) v -= (mine[it.key] || 0) - (fl.luxOut[it.key] || 0) >= 2 ? 35 : 160;
        else v += have.has(it.key) ? 10 : (hap < 2 ? 110 : 75);
        break;
      case 'strat': { const room = resourceRoom(G, pid, it.key); v += giving ? -(room.free >= 2 ? 30 : 90) : (room.free < 1 ? 70 : 30); break; }
      case 'ob': v += att >= 0 ? 15 : att >= -3 ? -15 : -80; if (P.aiw && cityById(G, P.aiw.city) && cityById(G, P.aiw.city).owner === other) v -= 200; break;
      case 'ally': v += att >= 6 ? 40 : att >= 4 ? 0 : -400; break;
      case 'peace': v += peaceAcceptable(G, other, pid).ok ? 60 : -120; break;
      case 'war': {
        if (giving) { const t = it.target, a2 = attitude(G, pid, t).score; v += a2 <= -2 && militaryPower(G, pid) >= militaryPower(G, t) * 0.8 ? 10 : -300; }
        else v += attitude(G, pid, it.target).score <= -2 ? 60 : 5;
        break;
      }
    }
  }
  v += att * 4;
  return v;
}
function dealVerdict(G, ai, other, items) {
  for (const it of items) { const st = itemStatus(G, other, ai, it); if (!st.ok) return { ok: false, why: `${itemLabel(G, it)}: ${st.why}` }; }
  if (!items.length) return { ok: false, why: 'Add something to the deal.' };
  const v = dealValue(G, ai, other, items);
  if (v >= 0) return { ok: true, v };
  const need = Math.ceil(-v / 10) * 10;
  return { ok: false, v, need, why: need <= 400 ? `They would want about ${need} more gold.` : 'They will not consider this.' };
}
function executeDeal(G, a, b, items) {
  const r = rel(G, a, b);
  for (const it of items) {
    const giver = it.by === -1 ? a : it.by, recv = giver === a ? b : a;
    switch (it.kind) {
      case 'gold': G.players[giver].gold -= it.amount; G.players[recv].gold += it.amount; break;
      case 'gpt': case 'lux': case 'strat': G.deals.push({ id: G.nextId++, from: giver, to: recv, kind: it.kind, key: it.key, amount: it.amount, until: G.turn + DIP.dealTurns }); break;
      case 'ob': r.ob = G.turn + DIP.obTurns; break;
      case 'ally': r.ally = G.turn + DIP.allyTurns; r.ob = Math.max(r.ob, G.turn + DIP.allyTurns); break;
      case 'peace': makePeace(G, a, b); break;
      case 'war': declareWar(G, giver, it.target); break;
    }
  }
  for (const pid of [a, b]) { for (const c of ownCities(G, pid)) assignWorkers(G, c); computeVisibility(G, pid); }
  G._att = null;
  const A = CIVS[G.players[a].civ], B = CIVS[G.players[b].civ];
  for (const [me, them] of [[a, b], [b, a]]) if (G.players[me].human) logEvent(G, me, `Deal with the ${(me === a ? B : A).name}: ${items.map(it => itemLabel(G, it) + (it.by === -1 ? '' : it.by === me ? ' (you give)' : ' (they give)')).join('; ')}.`, -1);
}
function cancelDealsBetween(G, a, b) {
  G.deals = G.deals.filter(d => !((d.from === a && d.to === b) || (d.from === b && d.to === a)));
  const r = rel(G, a, b); r.ob = 0; r.ally = 0;
}

// ---- treaties and war hooks ----
function onWarDeclared(G, a, b) {
  const r = rel(G, a, b);
  if (r.ob > G.turn || r.ally > G.turn) memOf(G, a, b).broke = G.turn;
  memOf(G, a, b).decl.push(G.turn);
  cancelDealsBetween(G, a, b);
  G._att = null;
  // allies are called in
  for (const ally of alliesOf(G, b)) {
    if (ally === a) continue;
    if (G.players[ally].human) G.offers.push({ id: G.nextId++, kind: 'joinwar', from: b, to: ally, target: a, turn: G.turn });
    else if (warStatus(G, ally, a).ok && attitude(G, ally, a).score < 3) declareWar(G, ally, a);
  }
}
function onPeace(G, a, b) { expelUnits(G, a, b); expelUnits(G, b, a); G._att = null; }
function denounce(G, a, b) {
  if (atWar(G, a, b) || denounced(G, a, b)) return false;
  rel(G, a, b).den[a] = G.turn; G._att = null;
  for (const Q of G.players) if (Q.human && (Q.met.includes(a) || Q.id === a)) logEvent(G, Q.id, Q.id === a ? `You denounced the ${CIVS[G.players[b].civ].name}.` : Q.id === b ? `The ${CIVS[G.players[a].civ].name} denounced you!` : `The ${CIVS[G.players[a].civ].name} denounced the ${CIVS[G.players[b].civ].name}.`, -1);
  return true;
}
function cancelAlliance(G, a, b) { const r = rel(G, a, b); if (r.ally <= G.turn) return false; r.ally = 0; memOf(G, a, b).broke = G.turn; G._att = null; if (G.players[b].human) logEvent(G, b, `The ${CIVS[G.players[a].civ].name} ended your alliance.`, -1); return true; }
// Units with no right to be in someone's land are sent home.
function expelUnits(G, pid, owner) {
  if (atWar(G, pid, owner) || hasOB(G, pid, owner)) return;
  const g = G._grid;
  for (const u of G.units.slice()) {
    if (u.owner !== pid || !UNITS[u.type].military || UNITS[u.type].cls === 'recon' || G.map.owner[u.tile] !== owner) continue;
    const home = ownCities(G, pid).sort((x, y) => g.dist(x.tile, u.tile) - g.dist(y.tile, u.tile))[0];
    if (!home) { removeUnit(G, u); continue; }
    const spot = g.within(home.tile, 4).find(t => passableFor(G, u, t) && (G.map.owner[t] === pid || G.map.owner[t] < 0) && !G._mil.has(t));
    if (spot === undefined) { removeUnit(G, u); continue; }
    const m = occMap(G, u); if (m.get(u.tile) === u) m.delete(u.tile); u.tile = spot; m.set(spot, u); u.moves = 0;
  }
  computeVisibility(G, pid);
}
// Military units may not enter the land of a civ they are at peace with, unless borders are open.
function bordersClosed(G, u, t) {
  const o = G.map.owner[t];
  if (o < 0 || o === u.owner || o === G._openFor || !UNITS[u.type].military || UNITS[u.type].cls === 'recon' || isBarb(G, u.owner) || isBarb(G, o)) return false;
  return !atWar(G, u.owner, o) && !hasOB(G, u.owner, o);
}

// ---- each round ----
function dipRound(G) {
  const live = [];
  for (const d of G.deals) {
    const P = G.players[d.from], Q = G.players[d.to];
    if (!P.alive || !Q.alive || d.until <= G.turn) { if (Q.human || P.human) for (const x of [P, Q]) if (x.human) logEvent(G, x.id, `A trade deal with the ${CIVS[(x === P ? Q : P).civ].name} ended.`, -1); continue; }
    if (d.kind === 'gpt') {
      if (P.gold < d.amount) { for (const x of [P, Q]) if (x.human) logEvent(G, x.id, 'A gold-per-turn deal was cancelled: the payer ran out of gold.', -1); memOf(G, d.from, d.to).broke = G.turn; continue; }
      P.gold -= d.amount; Q.gold += d.amount;
    }
    live.push(d);
  }
  G.deals = live;
  for (const k in G.dip) {
    const r = G.dip[k], [a, b] = k.split('-').map(Number);
    if (r.ob && r.ob === G.turn) { for (const x of [a, b]) if (G.players[x].human) logEvent(G, x, `Open borders with the ${CIVS[G.players[x === a ? b : a].civ].name} expired.`, -1); expelUnits(G, a, b); expelUnits(G, b, a); }
    if (r.ally && r.ally === G.turn) for (const x of [a, b]) if (G.players[x].human) logEvent(G, x, `Your alliance with the ${CIVS[G.players[x === a ? b : a].civ].name} expired. Renew it in Diplomacy.`, -1);
  }
  G.offers = G.offers.filter(o => G.turn - o.turn <= DIP.offerTurns);
  G._att = null;
}

// ---- tribute ----
function tributeAmount(G, from, to) { return Math.min(Math.floor(G.players[to].gold), Math.round((40 + G.turn / 3) * paceOf(G))); }
// Will AI 'to' pay tribute demanded by 'from'?
function tributeAcceptable(G, from, to) {
  if (atWar(G, from, to)) return { ok: false, why: 'Not while at war.' };
  if (G.turn - memOf(G, from, to).demand < 20) return { ok: false, why: 'You demanded tribute too recently.' };
  const amt = tributeAmount(G, from, to);
  if (amt < 10) return { ok: false, why: 'They have nothing to give.' };
  return militaryPower(G, from) >= militaryPower(G, to) * 1.8 ? { ok: true, amount: amt } : { ok: false, why: 'They are not afraid of you.', amount: amt };
}
function demandTribute(G, from, to) {
  const st = tributeAcceptable(G, from, to);
  memOf(G, from, to).demand = G.turn; G._att = null;
  if (G.players[to].human) { G.offers.push({ id: G.nextId++, kind: 'tribute', from, to, amount: tributeAmount(G, from, to), turn: G.turn }); logEvent(G, to, `The ${CIVS[G.players[from].civ].name} demand tribute. Answer in Diplomacy.`, -1); return { ok: true, pending: true }; }
  if (st.ok) { G.players[to].gold -= st.amount; G.players[from].gold += st.amount; if (G.players[from].human) logEvent(G, from, `The ${CIVS[G.players[to].civ].name} paid ${st.amount} gold in tribute.`, -1); }
  else memOf(G, to, from).refused = G.turn;
  return st;
}

// ---- answering offers made to a human ----
function answerOffer(G, id, yes) {
  const i = G.offers.findIndex(o => o.id === id); if (i < 0) return false;
  const o = G.offers[i]; G.offers.splice(i, 1);
  if (o.kind === 'peace' || !o.kind) { if (yes && atWar(G, o.from, o.to)) makePeace(G, o.from, o.to); }
  else if (o.kind === 'deal') { if (yes) { const ok = o.items.every(it => itemStatus(G, o.from, o.to, it).ok); if (ok) executeDeal(G, o.from, o.to, o.items); else return false; } }
  else if (o.kind === 'tribute') {
    if (yes) { const amt = Math.min(o.amount, Math.floor(G.players[o.to].gold)); G.players[o.to].gold -= amt; G.players[o.from].gold += amt; }
    else { memOf(G, o.to, o.from).refused = G.turn; G._att = null; }
  } else if (o.kind === 'joinwar') { if (yes && warStatus(G, o.to, o.target).ok) declareWar(G, o.to, o.target); }
  else if (o.kind === 'ally') { if (yes) executeDeal(G, o.from, o.to, [{ by: -1, kind: 'ally' }]); }
  return true;
}

// ---- AI diplomacy ----
function aiDiplomacy(G, pid) {
  const P = G.players[pid];
  if ((G.turn + pid) % 3 !== 0 || G.turn < 15) return;
  const others = majorPlayers(G).filter(Q => Q.id !== pid && Q.alive && P.met.includes(Q.id));
  const hasOffer = to => G.offers.some(o => o.from === pid && o.to === to);
  for (const Q of others) {
    const att = attitude(G, pid, Q.id).score, war = atWar(G, pid, Q.id);
    if (war) continue;
    // denounce the hated
    if (att <= -7 && !denounced(G, pid, Q.id) && G._rng.chance(0.4)) { denounce(G, pid, Q.id); continue; }
    // tribute from the weak and disliked
    if (att <= -3 && G.turn - memOf(G, pid, Q.id).demand > 40 && militaryPower(G, pid) > militaryPower(G, Q.id) * 2 && G._rng.chance(0.25)) {
      const st = demandTribute(G, pid, Q.id);
      if (!st.ok && !st.pending && G._rng.chance(0.5)) declareWar(G, pid, Q.id);
      continue;
    }
    const proposals = [];
    // luxury swap: something we lack for something they lack
    const myGive = spareLux(G, pid).filter(k => !luxuriesOf(G, Q.id).has(k));
    const theirGive = (Q.human ? anyLuxToGive(G, Q.id) : spareLux(G, Q.id)).filter(k => !luxuriesOf(G, pid).has(k));
    if (myGive.length && theirGive.length) proposals.push([{ by: pid, kind: 'lux', key: myGive[0] }, { by: Q.id, kind: 'lux', key: theirGive[0] }]);
    else if (theirGive.length && P.gold > 150 && !Q.human) proposals.push([{ by: Q.id, kind: 'lux', key: theirGive[0] }, { by: pid, kind: 'gold', amount: 90 }]);
    else if (theirGive.length && P.gold > 150 && Q.human) proposals.push([{ by: Q.id, kind: 'lux', key: theirGive[0] }, { by: pid, kind: 'gold', amount: 70 }]);
    if (att >= 1 && !hasOB(G, pid, Q.id)) proposals.push([{ by: -1, kind: 'ob' }]);
    if (att >= 6 && !allied(G, pid, Q.id)) proposals.push([{ by: -1, kind: 'ally' }]);
    for (const items of proposals) {
      if (!items.every(it => itemStatus(G, pid, Q.id, it).ok)) continue;
      if (dealValue(G, pid, Q.id, items) < 0) continue;
      if (Q.human) { if (!hasOffer(Q.id) && G._rng.chance(0.35)) { G.offers.push({ id: G.nextId++, kind: 'deal', from: pid, to: Q.id, items, turn: G.turn }); logEvent(G, Q.id, `The ${CIVS[P.civ].name} propose a deal. Answer in Diplomacy.`, -1); } break; }
      if (dealValue(G, Q.id, pid, items) >= 0) { executeDeal(G, pid, Q.id, items); break; }
    }
  }
}

Object.assign(HX, {
  warKey, attitude, hasOB, allied, bordersClosed, dealValue, luxuriesOfSet: (G, pid) => luxuriesOf(G, pid), alliesOf, denounced, itemLabel, itemStatus, dealVerdict, executeDeal, denounce, cancelAlliance,
  demandTribute, tributeAcceptable, tributeAmount, answerOffer, luxSources, stratSources, spareLux, anyLuxToGive, stratToGive, flows, DIP,
});

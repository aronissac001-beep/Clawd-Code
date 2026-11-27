// Threats in the UI (owner I; doc 9.4, 9.5, 10.1, 10.6): the threat chip, the omen letter, the
// Imminent slowdown, the raid peek card and the drafted orders. Every view comes from H's read-only
// warnings.js (threatViews / threatChip / omenText); every change is a command (draft, order).
//   chipView(s)              -> { text, label, stage, hours, tone } | null   for the top bar chip
//   threatWatch(s)           -> { poll() -> [{ kind: 'omen' | 'imminent' | 'active' | 'end', view }] }
//                               stage changes seen since the last poll (UI memory; letters already
//                               shown are remembered per colony in localStorage 'ec2.letters.<id>')
//   omenLetter(ctx, v, first)   the omen letter (a card sheet): text, edge, hours; the first one carries
//                               the coach lines on warnings, drafting and light (10.9, day 2 18:00)
//   foeAt(s, wx, wy, zoom)   the nearest hostile within 22 pt of a world point, or null
//   draftAll(ctx) / orderDrafted(ctx, target)   the draft and order commands for every drafted colonist
//   raidPeek(ctx, sel)       the raid peek card: composition, Draft all, Jump to edge
import { h, icon, onTap } from './kit.js';
import { TILE } from '../game/core/grid.js';
import { TICKS_PER_MIN } from '../game/core/time.js';
import { nemesisCard, nemesisOf } from './letters.js';
import { fullName } from '../game/threat/nemesis.js';
import { incidentDef } from '../game/threat/incidents.js';
import { linksOf, mechState, isLever, isGate } from '../game/world/mechanisms.js';
import { structDef } from '../game/world/defs.js';
import { threatViews, threatChip, omenText, composition } from '../game/threat/warnings.js';
import { D, zS, W, PLANE } from '../game/core/grid.js';
import { DATA as CAUSES } from '../data/causes.js';
import { levelText } from '../game/tools/levels.js';
import { levelName } from './levels.js';

// ---- Stage Z3.5: threats on levels (EMBERCROWN-FORTRESS.md 4.x, 2.10) ---------------------------------
//   threatZ(v)               the level (absolute z) a threat enters at (its edge voxel), null at D = 1
//   causeName(s, v)          the live cause behind a threat ("Woken seep", "Opened cavern"), or null
//   routeChevrons(s, v?)     where the route preview changes level: [{ i (voxel), x, y, from, to }]
//   leverLinks(s, id)        a lever's linked gates with their levels; leverActs(ctx, b) its peek actions
const CAUSE_NAME = Object.freeze(Object.fromEntries(CAUSES.cause.map((c) => [c.id, c.name])));
export function threatZ(v) {
  if (D <= 1 || !v) return null;
  return v.edge ? (v.edge.z !== undefined ? v.edge.z : 0) : zS;
}
export function causeName(s, v) {
  if (!v) return null;
  const e = s.st.queue.find((q) => q.id === v.id || q.raid === v.id);
  const r = s.raids.find((q) => q.id === v.id);
  const c = (e && e.cause) || (r && r.cause) || null;
  return c ? CAUSE_NAME[c[0]] || null : null;
}
const zOf = (i) => (i / PLANE) | 0;
/** Level changes along a route (the stair chevrons). v: a threat view; default the first one with a route. */
export function routeChevrons(s, v = null) {
  if (D <= 1) return [];
  const view = v || threatViews(s).find((q) => q.route && q.route.length > 1);
  const r = view && view.route;
  if (!r || r.length < 2) return [];
  const out = [];
  for (let j = 1; j < r.length; j++) {
    const a = zOf(r[j - 1]), b = zOf(r[j]);
    if (a === b) continue;
    const p = r[j - 1] % PLANE, q = r[j] % PLANE;
    out.push({ i: r[j - 1], x: p % W, y: (p / W) | 0, from: a, to: b });   // leaving level a toward b
    out.push({ i: r[j], x: q % W, y: (q / W) | 0, from: b, to: a, back: true });   // arriving: back toward where it came from
  }
  return out;
}

/** The chip: "Hollow horde: 14 h" shortened to fit (icon + "14h"); aria label in full. */
export function chipView(s) {
  const v = threatChip(s);
  if (!v) return null;
  // the last hour counts in minutes (play-test: "1h" stood still from 20:00 to the arrival at 21:00)
  const mins = Math.max(0, Math.ceil((v.arriveTick - s.tick) / TICKS_PER_MIN));
  const short = v.stage === 'active' ? 'here' : v.stage === 'retreat' ? 'fleeing' : mins < 60 ? `${mins}m` : `${v.hours}h`;
  const tone = v.stage === 'active' || v.stage === 'imminent' ? 'bad' : v.stage === 'retreat' ? '' : 'warn';
  const label = v.stage === 'active' ? `${v.name} on the map${v.onMap ? ': ' + v.onMap : ''}` : v.stage === 'retreat' ? `${v.name} fleeing at dawn` : `${v.name} in ${mins < 60 ? mins + ' minutes' : v.hours + ' hours'} from the ${v.edge ? v.edge.word : 'edge'}`;
  const z = threatZ(v), cause = causeName(s, v);
  const deep = z !== null && z !== zS;
  const lvl = z !== null ? levelName(z) : '';
  return { text: deep ? `${short} ${levelText(z)}` : short, label: label + (lvl ? `, ${lvl}` : '') + (cause ? `. Cause: ${cause}` : ''), stage: v.stage, hours: v.hours, tone, view: v, z, cause };
}

const LKEY = (s) => 'ec2.letters.' + (s.id || 'colony');
function loadSeen(s) { try { const v = JSON.parse(localStorage.getItem(LKEY(s)) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
function saveSeen(s, v) { try { localStorage.setItem(LKEY(s), JSON.stringify(v.slice(-40))); } catch (_) { /* private mode */ } }

/** Stage changes of the warned and live threats since the last poll. */
export function threatWatch(s) {
  const stages = new Map(), last = new Map();   // last: the latest view of each threat (the end toast names its kind)
  const seen = new Set(loadSeen(s));
  // what is already on the map when the shell opens is not news (a continued colony)
  for (const v of threatViews(s)) stages.set(v.id, v.stage);
  return {
    seen,
    poll() {
      const out = [];
      const now = threatViews(s);
      const ids = new Set();
      for (const v of now) {
        ids.add(v.id);
        const was = stages.get(v.id);
        if (v.stage === 'omen' && !seen.has(v.id)) { seen.add(v.id); saveSeen(s, [...seen]); out.push({ kind: 'omen', view: v }); }
        else if (was !== v.stage && (v.stage === 'imminent' || v.stage === 'active')) out.push({ kind: v.stage, view: v });
        stages.set(v.id, v.stage); last.set(v.id, v);
      }
      for (const [id] of stages) if (!ids.has(id)) { stages.delete(id); out.push({ kind: 'end', view: last.get(id) || { id } }); last.delete(id); }
      return out;
    },
    markSeen(id) { seen.add(id); saveSeen(s, [...seen]); },
  };
}

/** Is this the colony's first omen (no major in the history yet)? */
export const firstOmen = (s) => !s.st.history.some((x) => x.cat === 'major') && s.raids.filter((r) => r.stage !== 'warned').length === 0;

/** How to meet each kind of threat (by the incident's first tag): one short paragraph on every omen
 *  after the first, so each new raid kind is explained the first time it comes (X 2.7 play-test: the
 *  reaver omen offered braziers, which only matter against the Hollow). */
export const TACTICS = Object.freeze({
  hollow: 'The Hollow come for the Hearth at night and hate the light: braziers on their side, draft at dusk and hold by the fire. At dawn they flee.',
  breach: 'The Hollow come up through your tunnels, not from the edge: light the tunnels, shut the doors and hold the tunnel mouth.',
  rift: 'A Rift spawns Hollow every night until a colonist with Lore 6 or more closes it, guarded, in an hour of channelling.',
  reaver: 'Reavers come by day for your people, then your stores. Draft fighters behind walls or barricades: cover halves the hits they take. They flee when half have fallen or their captain is down.',
  thief: 'Thieves grab the most valuable stacks and run for the edge. Draft and cut them off; a strongbox holds them up three times as long.',
  beast: 'Maddened beasts hunt your people, not your stores. Draft everyone together and fight them in a doorway, one at a time.',
  sapper: 'Sappers dig through rock and walls toward your stores; their planned tunnel shows on the route. Meet them where it comes out.',
  siege: 'A siege camp sets up out of range and builds an engine. Break the camp before the assault, or wall up and wait them out.',
});
const HOLLOWISH = new Set(['hollow', 'breach', 'rift']);
const tagOf = (v) => { const d = incidentDef(v.inc); const t = (d && d.tags) || []; return t.find((x) => TACTICS[x]) || null; };
/** The one-line order on the Imminent toast, by kind (X 2.7 play-test: a thief's toast said "hold by the fire"). */
const SHORT = Object.freeze({
  hollow: 'Draft everyone and hold by the fire.', breach: 'Draft everyone and hold the tunnel mouth.', rift: 'Draft a guard and send a lore-wise colonist to close the Rift.',
  reaver: 'Draft your fighters behind walls.', thief: 'Draft a few to cut them off from the edge.', beast: 'Draft everyone together, in a doorway.',
  sapper: 'Draft everyone where their tunnel comes out.', siege: 'Draft everyone and break the camp.',
});
export const imminentAdvice = (v) => SHORT[tagOf(v)] || SHORT.hollow;
/** The raid-over toast: the Hollow flee, the others are gone. */
export const endText = (v) => (!tagOf(v) || HOLLOWISH.has(tagOf(v)) ? 'The Hollow are gone. Undraft to send everyone back to work.' : 'The raid is over. Undraft to send everyone back to work.');

/** The omen letter (10.6: a card sheet with text and choices). onClose() resumes the speed. */
export function omenLetter(ctx, v, opts = {}) {
  const s = ctx.s;
  const first = opts.first !== undefined ? opts.first : firstOmen(s);
  ctx.openSheet(`Omen: ${nemesisOf(s, v) ? fullName(nemesisOf(s, v)) : v.name}`, (el) => {
    el.classList.add('ec-letter');
    el.append(h('div.ec-letter-ic', { html: icon('omen') }), h('p.ec-letter-t', { text: omenText(s, v) }));
    const facts = h('div.ec-facts');
    const row = (k, val) => facts.append(h('div.ec-fact', null, h('span', { text: k }), h('b', { text: val })));
    row('Arrives in', `${v.hours} hours`);
    row('From', `the ${v.edge ? v.edge.word : 'edge'}`);
    if (threatZ(v) !== null) row('Level', levelName(threatZ(v)));
    if (causeName(s, v)) row('Cause', causeName(s, v));
    if (v.size) row('Size', v.size.text);
    if (v.prey !== null && v.prey !== undefined) { const c = s.col.find((x) => x.id === v.prey); if (c) row('Hunting for', c.name); }
    el.append(facts);
    // the nemesis omen card (9.10): a returning enemy leads this raid
    const nem = nemesisOf(s, v);
    if (nem) el.append(h('h3.ec-sub', { text: 'Led by a nemesis' }), nemesisCard(ctx, nem));
    // the first omen teaches the raid before its buttons (play-test: "Got it" was tapped before the text was seen)
    if (first) {
      el.append(h('h3.ec-sub', { text: 'The first night' }),
        h('p.ec-bio-d', { text: 'The chip at the top counts down. The red marker on the map edge shows where they come from; their route shows a few hours before.' }),
        h('p.ec-bio-d', { text: 'They come for the Hearth. It shoots at them at night, and on lit ground they are easier to hurt: place 2 braziers by the Hearth on their side, and keep it fed.' }),
        h('p.ec-bio-d', { text: 'When they are close, draft everyone (tap a portrait, then Draft) and tap the ground by the Hearth, on their side, to hold there. Whoever falls is downed, not dead, and is carried to bed. At dawn the Hollow flee.' }));
    }
    const tag = tagOf(v);
    if (!first && tag) el.append(h('h3.ec-sub', { text: 'How to meet them' }), h('p.ec-bio-d', { text: TACTICS[tag] }));
    const acts = h('div.ec-peek-acts');
    const btn = (label, act, fn) => { const b = h('button.ec-act', { type: 'button', 'data-act': act, text: label }); onTap(b, fn); acts.append(b); };
    btn('Show the edge', 'letter-edge', () => { ctx.closeSheet(); jumpToEdge(ctx, v); });
    // braziers only matter against the Hollow (light hurts them); other raids get the draft
    if (!tag || HOLLOWISH.has(tag)) btn('Braziers', 'letter-braziers', () => { ctx.closeSheet(); ctx.startTool({ kind: 'place', def: 'brazier' }); });
    else if (ctx.draftAll) btn('Draft all', 'letter-draft', () => { ctx.closeSheet(); ctx.draftAll(); });
    btn('Got it', 'letter-ok', () => ctx.closeSheet());
    el.append(acts);
  }, { onClose: opts.onClose, letter: true });
}

/** Centre the camera on the threat's edge marker (or its nearest hostile once on the map). */
export function jumpToEdge(ctx, v) {
  const s = ctx.s;
  if (v && v.stage === 'active') {
    const raid = s.raids.find((r) => r.id === v.id);
    const f = raid && s.foes.find((x) => raid.members.includes(x.id));
    if (f) { if (D > 1 && ctx.setLevel) ctx.setLevel(f.z | 0); ctx.centerOn(f.x, f.y); return true; }
  }
  if (v && v.edge && D > 1 && ctx.setLevel) ctx.setLevel(threatZ(v));
  if (v && v.edge) { ctx.centerOn((v.edge.x + 0.5) * TILE, (v.edge.y + 0.5) * TILE); return true; }
  return false;
}

/** The nearest hostile within 22 pt (screen) of a world point. */
export function foeAt(s, wx, wy, zoom) {
  const r = Math.max(22 / Math.max(0.05, zoom), 14);
  let best = null, bd = r * r;
  for (const f of s.foes) { const d = (f.x - wx) ** 2 + (f.y - wy) ** 2; if (d <= bd) { bd = d; best = f; } }
  return best;
}

/** Draft every able colonist (not downed, not breaking). Returns the command result. */
export function draftAll(ctx) {
  const ids = ctx.s.col.filter((c) => !c.hp.dead && !c.hp.down && !c.drafted).map((c) => c.id);
  if (!ids.length) {
    // all already drafted: still select them, so the next tap on the ground orders the group (play-test)
    if (ctx.s.col.some((c) => c.drafted && !c.hp.dead)) { ctx.select({ kind: 'drafted' }); ctx.toast('Everyone who can fight is drafted. Tap the ground to move them.'); }
    else ctx.toast('Nobody can be drafted now.');
    return null;
  }
  const r = ctx.send({ t: 'draft', colIds: ids, on: true }, ids.length === 1 ? 'Drafted.' : `${ids.length} drafted. Tap the ground to move them, a hostile to attack.`);
  if (r && r.ok) ctx.select({ kind: 'drafted' });
  return r;
}
export const draftedIds = (s) => s.col.filter((c) => c.drafted && !c.hp.dead).map((c) => c.id);

/** Order the drafted colonists in the selection: move to a tile, or attack a hostile. */
export function orderDrafted(ctx, ids, target) {
  if (!ids.length) return null;
  const cmd = target.foe ? { t: 'order', colIds: ids, kind: 'attack', target: { id: target.foe.id, kind: 'foe' } } : { t: 'order', colIds: ids, kind: 'move', target: target.z === undefined ? { x: target.x, y: target.y } : { x: target.x, y: target.y, z: target.z } };   // at D > 1 the level shown (4.4)
  const r = ctx.send(cmd, null, true);
  if (r && r.ok) ctx.orderLine(ids, target);
  else ctx.toast(`They cannot go there${r && r.reason ? ': ' + r.reason : ''}.`, 'bad');
  return r;
}

/** Peek card content for a raid ({ kind: 'raid', id }) or the drafted group ({ kind: 'drafted' }). */
export function threatPeek(ctx, sel) {
  const s = ctx.s;
  if (sel.kind === 'drafted') {
    const ids = draftedIds(s);
    if (!ids.length) return null;
    const names = ids.map((id) => s.col.find((c) => c.id === id).name.split(' ')[0]);
    const head = h('div.ec-peek-head', null, h('span.ec-peek-ic', { html: icon('sword') }),
      h('div.ec-peek-txt', null, h('div.ec-peek-name', null, h('b', { text: ids.length === 1 ? `${names[0]}, drafted` : `${ids.length} drafted` })),
        h('div.ec-peek-sub', { text: 'Tap the ground to move, a hostile to attack.' })));
    return { head, acts: [
      ['Hold', () => ctx.send({ t: 'order', colIds: ids, kind: 'hold' }, 'Holding: they strike what comes.'), 'hold'],
      ['Draft all', () => draftAll(ctx), 'draft-all'],
      ['Undraft', () => { ctx.send({ t: 'draft', colIds: ids, on: false }, 'Back to work.'); ctx.closePeek(); }, 'undraft-all'],
    ] };
  }
  const views = threatViews(s);
  const v = views.find((x) => x.id === sel.id) || views[0];
  if (!v) return null;
  const comp = v.comp || (v.size ? [{ name: v.types ? v.types.join(', ') : 'Hollow', n: v.size.text }] : null);
  const z = threatZ(v), cause = causeName(s, v);
  const sub = (v.stage === 'active' ? `On the map: ${v.onMap}` : v.stage === 'retreat' ? 'Fleeing at dawn' : `In ${v.hours} h from the ${v.edge ? v.edge.word : 'edge'}`)
    + (z !== null ? ` · ${levelName(z)}` : '') + (cause ? ` · ${cause}` : '');
  const head = h('div.ec-peek-head', null, h('span.ec-peek-ic.bad', { html: icon('horde') }),
    h('div.ec-peek-txt', null, h('div.ec-peek-name', null, h('b', { text: v.name })),
      h('div.ec-peek-sub', { text: comp ? `${sub} · ${comp.map((c) => `${c.n} ${c.name}`).join(', ')}` : sub })));
  return { head, acts: [
    ['Draft all', () => draftAll(ctx), 'draft-all'],
    [z !== null && z !== zS ? `Go to ${levelName(z)}` : 'Jump to edge', () => jumpToEdge(ctx, v), 'jump-edge'],
    ['Close', () => ctx.closePeek(), 'close-peek'],
  ] };
}

/** Composition text of a raid's members on the map (for toasts). */
export function raidText(s, raid) {
  const kinds = raid.members.map((id) => { const f = s.foes.find((x) => x.id === id); return f ? f.kind : null; }).filter(Boolean);
  return composition(kinds).map((c) => `${c.n} ${c.name}`).join(', ');
}

// ---- the lever-link UI (Z3.5; 2.8 Z3: a link is a building pair, so a lever may sit on any level) -------
const MODE_WORD = ['closed', 'held open', 'locked'];
const LEVER_R = 24;   // tiles: link candidates within this square radius, on any level
const bname = (b) => { const d = structDef(b.def); return (d && d.name) || b.def; };
/** A lever's linked gates, doors, floodgates and bridges: [{ b, name, z, level }], sorted by id. */
export function leverLinks(s, id) {
  return linksOf(s, id).map((b) => ({ b, name: bname(b), z: b.z | 0, level: D > 1 ? levelName(b.z | 0) : null }));
}
/** Unlinked gates a lever could take (near it in plan, any level), nearest first then id. */
export function linkCandidates(s, id, max = 6) {
  const lv = s.bld[id];
  if (!lv) return [];
  const out = [];
  for (const b of s.bld) {
    if (!b || b.id === id || !isGate(b) || b.link === id) continue;
    const d = Math.max(Math.abs(b.x - lv.x), Math.abs(b.y - lv.y));
    if (d > LEVER_R) continue;
    out.push({ b, d: d + Math.abs((b.z | 0) - (lv.z | 0)) });
  }
  out.sort((p, q) => p.d - q.d || p.b.id - q.b.id);
  return out.slice(0, max).map(({ b }) => ({ b, name: bname(b), z: b.z | 0, level: D > 1 ? levelName(b.z | 0) : null, linked: b.link !== null && b.link !== undefined }));
}
/** Extra peek actions for a finished lever: Pull, Links. [label, fn, act] rows (peek.js appends them). */
export function leverActs(ctx, b) {
  if (!b || b.st !== 'done' || !isLever(b)) return [];
  return [
    ['Pull', () => { const r = ctx.send({ t: 'lever', bId: b.id }, null, true); if (r && r.ok) ctx.toast(`Lever pulled: gates ${MODE_WORD[r.mode] || 'closed'}.`); else ctx.toast(`It will not move${r && r.reason ? ': ' + r.reason : ''}.`, 'bad'); }, 'lever-pull'],
    ['Links', () => openLeverLinks(ctx, b.id), 'lever-links'],
  ];
}
/** The lever sheet: its mode, each linked gate with its level (Go switches the view there), Unlink, and the
 *  candidates to Link. Every change is a command (lever, link). */
export function openLeverLinks(ctx, id) {
  const s = ctx.s;
  const go = (b) => { ctx.closeSheet(); if (D > 1 && ctx.setLevel) ctx.setLevel(b.z | 0); ctx.centerOn((b.x + 0.5) * TILE, (b.y + 0.5) * TILE); };
  const btn = (text, act, fn) => { const e = h('button.ec-act', { type: 'button', 'data-act': act, text, style: { padding: '0 14px' } }); onTap(e, fn); return e; };
  const refresh = () => (ctx.refreshSheet ? ctx.refreshSheet() : null);
  ctx.openSheet('Lever links', (el) => {
    const lv = s.bld[id];
    if (!lv) { el.append(h('p', { text: 'The lever is gone.' })); return; }
    el.append(h('p.ec-lever-t', { text: `Holds its gates ${MODE_WORD[mechState(s, id)] || 'closed'}${D > 1 ? ` · ${levelName(lv.z | 0)}` : ''}. A lever drives up to 4 gates, floodgates or bridges on any level.` }));
    el.append(btn('Pull the lever', 'lever-pull', () => { ctx.send({ t: 'lever', bId: id }, null, true); refresh(); }));
    const rowOf = (x, acts) => h('div.ec-lever-row', { style: { display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px', flexWrap: 'wrap' } },
      h('span', { style: { flex: '1 1 140px', fontSize: '15px' }, text: x.level !== null ? `${x.name} · ${x.level}` : x.name }), ...acts);
    const ls = leverLinks(s, id);
    el.append(h('h3', { text: ls.length ? 'Linked' : 'Nothing linked yet' }));
    for (const x of ls) el.append(rowOf(x, [btn('Go', 'lever-go', () => go(x.b)), btn('Unlink', 'lever-unlink', () => { ctx.send({ t: 'link', bId: x.b.id, to: null }, 'Unlinked.', true); refresh(); })]));
    const cs = ls.length < 4 ? linkCandidates(s, id) : [];
    if (cs.length) el.append(h('h3', { text: 'Link a gate' }));
    for (const x of cs) el.append(rowOf(x, [btn('Go', 'lever-go', () => go(x.b)), btn(x.linked ? 'Move link' : 'Link', 'lever-link', () => { const r = ctx.send({ t: 'link', bId: x.b.id, to: id }, null, true); if (!(r && r.ok)) ctx.toast(`Cannot link${r && r.reason ? ': ' + r.reason : ''}.`, 'bad'); refresh(); })]));
  });
}

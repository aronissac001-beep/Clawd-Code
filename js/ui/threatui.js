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
import { threatViews, threatChip, omenText, composition } from '../game/threat/warnings.js';

/** The chip: "Hollow horde: 14 h" shortened to fit (icon + "14h"); aria label in full. */
export function chipView(s) {
  const v = threatChip(s);
  if (!v) return null;
  const short = v.stage === 'active' ? 'here' : v.stage === 'retreat' ? 'fleeing' : `${v.hours}h`;
  const tone = v.stage === 'active' || v.stage === 'imminent' ? 'bad' : v.stage === 'retreat' ? '' : 'warn';
  const label = v.stage === 'active' ? `${v.name} on the map${v.onMap ? ': ' + v.onMap : ''}` : v.stage === 'retreat' ? `${v.name} fleeing at dawn` : `${v.name} in ${v.hours} hours from the ${v.edge ? v.edge.word : 'edge'}`;
  return { text: short, label, stage: v.stage, hours: v.hours, tone, view: v };
}

const LKEY = (s) => 'ec2.letters.' + (s.id || 'colony');
function loadSeen(s) { try { const v = JSON.parse(localStorage.getItem(LKEY(s)) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
function saveSeen(s, v) { try { localStorage.setItem(LKEY(s), JSON.stringify(v.slice(-40))); } catch (_) { /* private mode */ } }

/** Stage changes of the warned and live threats since the last poll. */
export function threatWatch(s) {
  const stages = new Map();
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
        stages.set(v.id, v.stage);
      }
      for (const [id] of stages) if (!ids.has(id)) { stages.delete(id); out.push({ kind: 'end', view: { id } }); }
      return out;
    },
    markSeen(id) { seen.add(id); saveSeen(s, [...seen]); },
  };
}

/** Is this the colony's first omen (no major in the history yet)? */
export const firstOmen = (s) => !s.st.history.some((x) => x.cat === 'major') && s.raids.filter((r) => r.stage !== 'warned').length === 0;

/** The omen letter (10.6: a card sheet with text and choices). onClose() resumes the speed. */
export function omenLetter(ctx, v, opts = {}) {
  const s = ctx.s;
  const first = opts.first !== undefined ? opts.first : firstOmen(s);
  ctx.openSheet(`Omen: ${v.name}`, (el) => {
    el.classList.add('ec-letter');
    el.append(h('div.ec-letter-ic', { html: icon('omen') }), h('p.ec-letter-t', { text: omenText(s, v) }));
    const facts = h('div.ec-facts');
    const row = (k, val) => facts.append(h('div.ec-fact', null, h('span', { text: k }), h('b', { text: val })));
    row('Arrives in', `${v.hours} hours`);
    row('From', `the ${v.edge ? v.edge.word : 'edge'}`);
    if (v.size) row('Size', v.size.text);
    if (v.prey !== null && v.prey !== undefined) { const c = s.col.find((x) => x.id === v.prey); if (c) row('Hunting for', c.name); }
    el.append(facts);
    const acts = h('div.ec-peek-acts');
    const btn = (label, act, fn) => { const b = h('button.ec-act', { type: 'button', 'data-act': act, text: label }); onTap(b, fn); acts.append(b); };
    btn('Show the edge', 'letter-edge', () => { ctx.closeSheet(); jumpToEdge(ctx, v); });
    btn('Braziers', 'letter-braziers', () => { ctx.closeSheet(); ctx.startTool({ kind: 'place', def: 'brazier' }); });
    btn('Got it', 'letter-ok', () => ctx.closeSheet());
    el.append(acts);
    if (first) {
      el.append(h('h3.ec-sub', { text: 'The first night' }),
        h('p.ec-bio-d', { text: 'The chip at the top counts down. The red marker on the map edge shows where they come from; their route shows a few hours before.' }),
        h('p.ec-bio-d', { text: 'The Hollow hate light. Place 2 braziers by your door, keep the Hearth fed, and when they are close, draft everyone (tap a portrait, then Draft) and Hold by the fire.' }));
    }
  }, { onClose: opts.onClose, letter: true });
}

/** Centre the camera on the threat's edge marker (or its nearest hostile once on the map). */
export function jumpToEdge(ctx, v) {
  const s = ctx.s;
  if (v && v.stage === 'active') {
    const raid = s.raids.find((r) => r.id === v.id);
    const f = raid && s.foes.find((x) => raid.members.includes(x.id));
    if (f) { ctx.centerOn(f.x, f.y); return true; }
  }
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
  if (!ids.length) { ctx.toast(ctx.s.col.some((c) => c.drafted) ? 'Everyone who can fight is drafted.' : 'Nobody can be drafted now.'); return null; }
  const r = ctx.send({ t: 'draft', colIds: ids, on: true }, ids.length === 1 ? 'Drafted.' : `${ids.length} drafted. Tap the ground to move them, a hostile to attack.`);
  if (r && r.ok) ctx.select({ kind: 'drafted' });
  return r;
}
export const draftedIds = (s) => s.col.filter((c) => c.drafted && !c.hp.dead).map((c) => c.id);

/** Order the drafted colonists in the selection: move to a tile, or attack a hostile. */
export function orderDrafted(ctx, ids, target) {
  if (!ids.length) return null;
  const cmd = target.foe ? { t: 'order', colIds: ids, kind: 'attack', target: { id: target.foe.id, kind: 'foe' } } : { t: 'order', colIds: ids, kind: 'move', target: { x: target.x, y: target.y } };
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
  const sub = v.stage === 'active' ? `On the map: ${v.onMap}` : v.stage === 'retreat' ? 'Fleeing at dawn' : `In ${v.hours} h from the ${v.edge ? v.edge.word : 'edge'}`;
  const head = h('div.ec-peek-head', null, h('span.ec-peek-ic.bad', { html: icon('horde') }),
    h('div.ec-peek-txt', null, h('div.ec-peek-name', null, h('b', { text: v.name })),
      h('div.ec-peek-sub', { text: comp ? `${sub} · ${comp.map((c) => `${c.n} ${c.name}`).join(', ')}` : sub })));
  return { head, acts: [
    ['Draft all', () => draftAll(ctx), 'draft-all'],
    ['Jump to edge', () => jumpToEdge(ctx, v), 'jump-edge'],
    ['Close', () => ctx.closePeek(), 'close-peek'],
  ] };
}

/** Composition text of a raid's members on the map (for toasts). */
export function raidText(s, raid) {
  const kinds = raid.members.map((id) => { const f = s.foes.find((x) => x.id === id); return f ? f.kind : null; }).filter(Boolean);
  return composition(kinds).map((c) => `${c.n} ${c.name}`).join(', ');
}

// The Military tab (owner I; EMBERCROWN-FORTRESS.md 3.8, Stage Z2.5): Colony > Military. The alert level
// (Peace, Muster, Shelter), then one card per squad: its members, Drilled, its standing order with a level
// badge, its uniform (tap a slot to cycle what it asks for), its training schedule for this season, and
// what it lacks ("First Watch lacks 2 helms"). Read-only views of F's people/draft.js; every change is a
// command (squad, order with squad, alert; C3 v3).
//   militaryTab(el, ctx)          fill the tab (colonyui.js adds 'Military' to COLONY_TABS)
//   militaryTap(ctx, tile)        the world tap while a Station or Patrol pick is open: true when used
//   militaryPicking()             the open pick ({ squad, kind, pts }) or null (the shell's tap hint)
import { h, onTap, icon } from './kit.js';
import { def } from '../game/core/content.js';
import { idx, relLevel, W, PLANE } from '../game/core/grid.js';
import { seasonOf, SEASON_NAMES } from '../game/core/time.js';
import {
  squadList, squadMil, uniformOf, uniformShortfall, squadDrilled, drillsThisSeason, alertLevel, maxSquads,
  UNIFORM_KEYS, ALERTS, MIL, drillSite, marshalOf,
} from '../game/people/draft.js';

const ALERT_TEXT = {
  peace: 'Peace: soldiers work, and drill on their schedule.',
  muster: 'Muster: soldiers drop work, fetch their uniforms from the armoury racks and stand to.',
  shelter: 'Shelter: soldiers muster and everyone else goes to the Refuge until Peace.',
};
const SLOT_LABEL = { weapon: 'Weapon', helm: 'Helm', body: 'Body', legs: 'Legs', shield: 'Shield' };
/** What a slot may ask for, in tap order: nothing, any, then the item kinds that fit. */
const SLOT_KINDS = {
  weapon: ['spear', 'axe', 'sword', 'maul', 'halberd', 'shortbow', 'longbow', 'crossbow'],
  helm: ['leathercap', 'ironhelm', 'steelhelm'],
  body: ['jerkin', 'gambeson', 'mailshirt'],
  legs: ['boots'],
  shield: ['woodshield', 'ironshield', 'towershield'],
};
const ORDER_TEXT = { station: 'Stationed', patrol: 'Patrolling', defendRefuge: 'Defending the Refuge', guard: 'Guarding', move: 'Holding a point' };
const kindName = (k) => (k === 'any' ? 'Any' : ((def('item', k) || { name: k }).name));
const levelBadge = (i) => { const z = Math.floor(i / PLANE), r = relLevel(z); return r === 0 ? 'surface' : r > 0 ? `+${r}` : String(r); };
const pt = (i) => { const z = Math.floor(i / PLANE), p = i - z * PLANE; return `${p % W}, ${Math.floor(p / W)} (${levelBadge(i)})`; };

let pick = null;
export const militaryPicking = () => pick;
/** A world tap during a Station or Patrol pick. Station sends on the first point; Patrol collects 2-4. */
export function militaryTap(ctx, tile) {
  if (!pick || !tile) return false;
  pick.pts.push(idx(tile.x, tile.y, tile.z | 0));
  if (pick.kind === 'station') return finishPick(ctx);
  if (pick.pts.length >= 4) return finishPick(ctx);
  ctx.toast(`Point ${pick.pts.length} set. Tap the next${pick.pts.length >= 2 ? ', or tap Done in the Military tab' : ''}.`);
  return true;
}
function finishPick(ctx) {
  const p = pick;
  pick = null;
  if (!p || (p.kind === 'patrol' && p.pts.length < 2)) { ctx.toast('A patrol needs 2 to 4 points.', 'bad'); return true; }
  ctx.send({ t: 'order', kind: p.kind, squad: p.squad, pts: p.pts }, p.kind === 'station' ? 'Stationed: they stay there until relieved.' : `Patrolling ${p.pts.length} points in a loop.`);
  return true;
}
function startPick(ctx, squad, kind) {
  pick = { squad, kind, pts: [] };
  ctx.closeSheet();
  ctx.toast(kind === 'station' ? 'Tap the ground where the squad stands. Change level first for a hall below.' : 'Tap 2 to 4 points, on any level. They walk them in a loop.');
}

function seg(label, items, cur, act, fn) {
  const g = h('div.ec-seg', { role: 'radiogroup', 'aria-label': label });
  for (const [v, text] of items) {
    const b = h('button.ec-seg-b' + (cur === v ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': cur === v ? 'true' : 'false', 'data-act': `${act}-${v}`, text });
    onTap(b, () => fn(v));
    g.append(b);
  }
  return g;
}
const btn = (text, act, fn, extra = '') => { const b = h('button.ec-act' + extra, { type: 'button', 'data-act': act, text }); onTap(b, fn); return b; };

/** Fill the Military tab. */
export function militaryTab(el, ctx) {
  const s = ctx.s;
  const level = alertLevel(s);
  el.append(h('h3.ec-sub', { text: 'Alert' }),
    seg('Alert level', ALERTS.map((a) => [a, a[0].toUpperCase() + a.slice(1)]), level, 'alert', (v) => { ctx.send({ t: 'alert', level: v }, ALERT_TEXT[v]); ctx.refreshSheet(); }),
    h('p.ec-note', { text: ALERT_TEXT[level] }));
  if (pick) {
    el.append(h('p.ec-note', { text: `Picking ${pick.kind === 'patrol' ? 'patrol points' : 'a station'}: ${pick.pts.length} set.` }),
      h('div.ec-row', null, pick.kind === 'patrol' && pick.pts.length >= 2 ? btn('Done', 'pick-done', () => { finishPick(ctx); ctx.refreshSheet(); }) : null,
        btn('Cancel', 'pick-cancel', () => { pick = null; ctx.refreshSheet(); })));
  }
  const squads = squadList(s);
  const lacks = uniformShortfall(s);
  if (lacks.length) el.append(h('div.ec-facts', null, ...lacks.map((x) => h('div.ec-fact.bad', null, h('span', { html: icon('shield') }), h('b', { text: x.text })))));
  if (!squads.length) {
    el.append(h('p.ec-note', { text: 'No squads yet. Give someone the Soldier role (People) and they join the First Watch.' }));
    return;
  }
  const season = seasonOf(s.tick);
  for (const sq of squads) {
    const e = squadMil(s, sq.id), u = uniformOf(s, sq.id), o = e ? e[3] : null;
    const card = h('section', { 'data-squad': String(sq.id), style: { borderTop: '1.5px solid var(--line)', marginTop: '8px', paddingTop: '4px' } });
    const names = sq.members.map((id) => { const c = s.col.find((x) => x.id === id); return c ? c.name.split(' ')[0] : '?'; });
    card.append(h('div.ec-peek-head', null, h('span.ec-peek-ic', { html: icon('sword') }),
      h('div.ec-peek-txt', null, h('div.ec-peek-name', null, h('b', { text: sq.name }), squadDrilled(s, sq.id) ? h('span.ec-row-s', { text: ' Drilled', style: { color: 'var(--good)', fontWeight: '600' } }) : null),
        h('div.ec-peek-sub', { text: names.length ? names.join(', ') : 'Nobody yet' }))));
    // the standing order
    const ord = o ? `${ORDER_TEXT[o.kind] || o.kind}${o.pts && o.pts.length ? ': ' + o.pts.map(pt).join(' > ') : ''}` : 'No standing order: on Muster they gather at the barracks.';
    card.append(h('p.ec-note', { text: ord }),
      h('div.ec-row', null,
        btn('Station', `sq${sq.id}-station`, () => startPick(ctx, sq.id, 'station')),
        btn('Patrol', `sq${sq.id}-patrol`, () => startPick(ctx, sq.id, 'patrol')),
        btn('Refuge', `sq${sq.id}-refuge`, () => { ctx.send({ t: 'order', kind: 'defendRefuge', squad: sq.id }, 'They stand at the Refuge doors.'); ctx.refreshSheet(); }),
        o ? btn('Relieve', `sq${sq.id}-relieve`, () => { ctx.send({ t: 'order', kind: 'hold', squad: sq.id }, 'Relieved: off duty at Peace.'); ctx.refreshSheet(); }) : null));
    // the uniform
    const grid = h('div.ec-facts');
    for (const key of UNIFORM_KEYS) {
      const spec = u[key];
      const b = h('button.ec-fact.ec-tap', { type: 'button', 'data-act': `sq${sq.id}-u-${key}`, 'aria-label': `${SLOT_LABEL[key]}: ${spec ? kindName(spec[0]) : 'none'}. Tap to change.`, style: { minHeight: '44px', width: '100%', background: 'none', border: 'none', borderBottom: '1px solid rgba(201, 151, 62, 0.12)', padding: '0', font: 'inherit' } },
        h('span', { text: SLOT_LABEL[key] }), h('b', { text: spec ? kindName(spec[0]) : 'None' }));
      onTap(b, () => {
        const opts = [null, 'any', ...SLOT_KINDS[key]];
        const cur = spec ? opts.indexOf(spec[0]) : 0;
        const next = opts[(cur + 1) % opts.length];
        ctx.send({ t: 'squad', id: sq.id, uniform: { [key]: next === null ? null : [next, spec ? spec[1] : 0, null] } });
        ctx.refreshSheet();
      });
      grid.append(b);
    }
    card.append(h('h3.ec-sub', { text: 'Uniform' }), grid);
    // training this season
    const n = e ? e[2][season] | 0 : 0;
    const site = drillSite(s);
    card.append(h('h3.ec-sub', { text: `Training in ${SEASON_NAMES[season]}` }),
      h('div.ec-row', null,
        btn('-', `sq${sq.id}-train-less`, () => { const a = e ? e[2].slice() : [0, 0, 0, 0]; a[season] = Math.max(0, n - 1); ctx.send({ t: 'squad', id: sq.id, sched: a }); ctx.refreshSheet(); }),
        h('b', { text: n ? `${n} days in 10` : 'No drill', style: { flex: '2', textAlign: 'center', fontSize: '16px' } }),
        btn('+', `sq${sq.id}-train-more`, () => { const a = e ? e[2].slice() : [0, 0, 0, 0]; a[season] = Math.min(10, n + 1); ctx.send({ t: 'squad', id: sq.id, sched: a }); ctx.refreshSheet(); })),
      h('p.ec-note', { text: marshalOf(s) === null ? 'Drilling needs a Marshal: appoint one in Offices.' : !site ? 'Drilling needs a training yard, or a barracks with a drill post.'
        : `${drillsThisSeason(s, sq.id)} of ${MIL.drilledAt} drills this season for Drilled: it holds formation and does not break.` }));
    el.append(card);
  }
  if (squads.length < maxSquads(s)) el.append(h('p.ec-note', { text: `Up to ${maxSquads(s)} squads${maxSquads(s) < 6 ? '; a War Room allows 6' : ''}. New soldiers join the First Watch.` }));
}

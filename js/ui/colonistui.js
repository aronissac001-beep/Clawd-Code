// Colonist inspection (owner I; doc 10.5). The peek card comes first (peek.js); a second tap or a
// drag up opens this sheet: a header (name, profession and rank, role chips, mood bar, current job,
// Draft / Follow / Locate) and tabs. Stage 1a fills Skills (15 rows: level bar, passion, XP to next;
// tap a row for what the skill does) and Bio (ancestry, backstory, traits, attributes); Needs,
// Health, Gear, Social and Log arrive with those systems. Swipe the header for the next colonist.
import { h, onTap, icon } from './kit.js';
import { def } from '../game/core/content.js';
import { SKILL_IDS, ATTR_IDS, FIX } from '../game/core/schema.js';
import { MAX_LVL, XP_FIX, xpFor, rankOf, bestSkill, speedPct } from '../game/people/skills.js';
import { disabledWork } from '../game/people/roles.js';
import { roleChips } from './rolesui.js';

export const COLONIST_TABS = Object.freeze(['Skills', 'Bio', 'Needs', 'Health', 'Gear', 'Social', 'Log']);
const LATER = { Needs: 'Needs (food, rest, joy, warmth, light) come with the first night.', Health: 'Wounds and healing come with the first night.',
  Gear: 'Clothes and weapons come in a later update.', Social: 'Friends and rivals come in a later update.', Log: 'The colonist log comes with the Chronicle.' };
const JOB_TEXT = { mine: 'Mining', chop: 'Chopping wood', craft: 'Crafting', deliver: 'Hauling to a build', construct: 'Building', deconstruct: 'Taking down', haul: 'Hauling' };
const ATTR_NAME = { might: 'Might', wits: 'Wits', grace: 'Grace' };

/** "Mining" / "Idle" / "Drafted": the colonist's current job in a few words. */
export function jobText(c) {
  if (c.drafted) return 'Drafted';
  if (!c.job) return 'Idle';
  return JOB_TEXT[c.job.type] || c.job.type.charAt(0).toUpperCase() + c.job.type.slice(1);
}
/** "Mason, Apprentice": the profession title from the best skill, with its rank. */
export function profession(c) {
  const best = bestSkill(c), d = def('skill', best);
  const lvl = c.sk[SKILL_IDS.indexOf(best)][0];
  const prof = { mining: 'Miner', construction: 'Builder', woodcraft: 'Carpenter', masonry: 'Mason', smithing: 'Smith', tailoring: 'Tailor', cooking: 'Cook',
    growing: 'Grower', animals: 'Herder', medicine: 'Healer', melee: 'Fighter', archery: 'Archer', social: 'Speaker', lore: 'Scholar', art: 'Artist' }[best] || (d ? d.name : best);
  const rank = rankOf(lvl);
  return rank ? `${prof}, ${rank}` : prof;
}

/** Header block of the colonist sheet. ctx: shell context; nav(dir) moves to the next colonist. */
export function colonistHeader(ctx, c, nav) {
  const mood = Math.round(c.mood / FIX);
  const head = h('div.ec-chead', { 'aria-label': `${c.name}, swipe for the next colonist` },
    ctx.portrait(c, 52),
    h('div.ec-chead-t', null,
      h('div.ec-chead-n', { text: c.name }),
      h('div.ec-peek-sub', { text: `${profession(c)} · ${jobText(c)}` }),
      h('div.ec-moodbar.big', { role: 'meter', 'aria-label': `Mood ${mood}`, 'aria-valuenow': String(mood), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('i', { style: { width: mood + '%' } }))));
  let x0 = null;
  head.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  head.addEventListener('pointerup', (e) => { if (x0 !== null && Math.abs(e.clientX - x0) > 50) nav(e.clientX < x0 ? 1 : -1); x0 = null; });
  const acts = h('div.ec-peek-acts');
  const btn = (label, act, fn) => { const b = h('button.ec-act', { type: 'button', 'data-act': act, text: label }); onTap(b, fn); return b; };
  acts.append(
    btn(c.drafted ? 'Undraft' : 'Draft', 'draft', () => { ctx.send({ t: 'draft', colIds: [c.id], on: !c.drafted }, c.drafted ? 'Back to work.' : 'Drafted.'); ctx.refreshSheet(); }),
    btn(ctx.following() === c.id ? 'Unfollow' : 'Follow', 'follow', () => { ctx.follow(ctx.following() === c.id ? null : c.id); ctx.refreshSheet(); }),
    btn('Locate', 'locate', () => { ctx.closeSheet(); ctx.centerOn(c.x, c.y); ctx.select({ kind: 'colonist', id: c.id }); }),
  );
  return h('div.ec-chead-wrap', null, head, roleChips(ctx, c), acts);
}

/** Fill one tab of the colonist sheet. */
export function colonistTab(el, ctx, c, tab) {
  if (tab === 'Skills') return skillsTab(el, ctx, c);
  if (tab === 'Bio') return bioTab(el, ctx, c);
  el.append(h('p.ec-note', { text: LATER[tab] || 'Comes in a later update.' }));
}

function flames(n) {
  return n ? h('span.ec-flames', { 'aria-label': n === 2 ? 'burning passion' : 'keen' , html: icon('flame') + (n === 2 ? icon('flame') : '') }) : h('span.ec-flames');
}
function skillsTab(el, ctx, c) {
  const off = new Set(disabledWork(c));
  const list = h('div.ec-skills', { role: 'list' });
  SKILL_IDS.forEach((id, k) => {
    const [lvl, xp, passion] = c.sk[k];
    const d = def('skill', id) || { name: id, work: [] };
    const next = lvl >= MAX_LVL ? 0 : xpFor(lvl + 1);
    const pct = Math.round((lvl / MAX_LVL) * 100);
    const works = (d.work || []).map((w) => (def('worktype', w) || { name: w }).name);
    const dead = works.length && (d.work || []).every((w) => off.has(['care', 'animals', 'cook', 'build', 'grow', 'mine', 'chop', 'smith', 'craft', 'tailor', 'art', 'lore', 'haul'].indexOf(w)));
    const row = h('button.ec-skill' + (dead ? '.off' : ''), { type: 'button', role: 'listitem', 'data-act': 'skill-' + id, 'aria-label': `${d.name} level ${lvl}` },
      h('span.ec-skill-n', { text: d.name }),
      flames(passion),
      h('span.ec-skill-bar', null, h('i', { style: { width: pct + '%' } })),
      h('b.ec-skill-l', { text: String(lvl) }),
      h('span.ec-skill-x', { text: lvl >= MAX_LVL ? 'Max' : `${Math.floor(xp / XP_FIX)}/${next}` }));
    onTap(row, () => {
      const rank = rankOf(lvl);
      ctx.toast(`${d.name}${rank ? ' (' + rank + ')' : ''}: works at ${speedPct(lvl)}% speed${works.length ? ' on ' + works.join(', ') : ''}.${passion === 2 ? ' Burning passion: learns fastest.' : passion === 1 ? ' Keen: learns faster.' : ''}${dead ? ' Their past rules this work out.' : ''}`);
    });
    list.append(row);
  });
  el.append(h('p.ec-note', { text: 'Level, passion and XP to the next level. Tap a skill for what it does.' }), list);
}

function bioTab(el, ctx, c) {
  const anc = def('ancestry', c.anc);
  const sec = (title, ...kids) => h('section.ec-bio', null, h('h3.ec-sub', { text: title }), ...kids);
  el.append(sec('Who', h('p.ec-bio-t', { text: `${c.name}, ${c.age}. ${anc ? anc.name + '.' : ''}` }), anc && anc.text ? h('p.ec-bio-d', { text: anc.text }) : null));
  const at = h('div.ec-attrs');
  ATTR_IDS.forEach((a, k) => at.append(h('div.ec-attr', null, h('span', { text: ATTR_NAME[a] || a }), h('b', { text: String(c.at[k]) }))));
  el.append(sec('Attributes', at));
  const bs = (c.bs || []).map((id) => def('backstory', id)).filter(Boolean);
  el.append(sec('Story', ...bs.map((b) => h('div.ec-bio-item', null, h('b', { text: `${b.slot === 'child' ? 'Childhood' : 'Adulthood'}: ${b.name}` }), h('p.ec-bio-d', { text: b.text || '' }),
    b.disables && b.disables.length ? h('p.ec-bio-warn', { text: `Will not ${b.disables.map((w) => ((def('worktype', w) || { name: w }).name).toLowerCase()).join(' or ')}.` }) : null))));
  const tr = (c.traits || []).map((id) => def('trait', id)).filter(Boolean);
  el.append(sec('Traits', ...(tr.length ? tr.map((t) => h('div.ec-bio-item', null, h('b', { text: t.name }), h('p.ec-bio-d', { text: t.text || '' }))) : [h('p.ec-bio-d', { text: 'No traits.' })])));
}

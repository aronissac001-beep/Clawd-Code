// Colonist inspection (owner I; doc 10.5). The peek card comes first (peek.js); a second tap or a
// drag up opens this sheet: a header (name, profession and rank, role chips, mood bar, current job,
// Draft / Follow / Locate) and tabs:
//   Needs   up to 5 bars (food, rest, joy, warmth, light), mood with the break line, the top 6 thoughts
//   Skills  15 rows (level bar, passion, XP to next; tap: what it does), the perks earned, and the next
//           perks with their progress ("Next: Seam Follower, mined 112 of 150 ore"). Perks are earned by
//           doing (EMBERCROWN-FORTRESS.md 3.1, F10): nothing is ever picked
//   Health  state, blood, the six parts, wounds (tended, bleeding, infected), illness, Grey Taint, scars
//   Gear    the worn slots and the outfit picker (E's outfit command), the soldier duty toggle
//   Social  the 5 strongest relations (F's social.strongest), friends, rivals, lovers, kin
//   Log     the Chronicle lines that name the colonist, newest first
//   Bio     ancestry, backstory, traits with their plain-language effects, attributes, age
// Swipe the header for the next colonist.
import { colonistThumb } from './thumbs.js';
import { h, onTap, icon } from './kit.js';
import { def } from '../game/core/content.js';
import { SKILL_IDS, ATTR_IDS, FIX } from '../game/core/schema.js';
import { MAX_LVL, XP_FIX, xpFor, rankOf, bestSkill, speedPct } from '../game/people/skills.js';
import { disabledWork } from '../game/people/roles.js';
import { roleChips } from './rolesui.js';
import { NEED_IDS, PART_IDS, PART_HP } from '../game/core/schema.js';
import { activeNeeds } from '../game/people/needs.js';
import { thoughtValue } from '../game/people/mood.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../game/core/time.js';
import { all } from '../game/core/content.js';
import { nextPerks } from '../game/people/perks.js';
import { strongest } from '../game/people/social.js';
import { chronLine } from '../game/colony/chronicle.js';
import { scheduleName } from '../game/people/roles.js';
import { describe as psyDescribe, prefLines, goalLine } from '../game/people/personality.js';
import { lifeStage, parentsOf, childrenOf } from '../game/people/family.js';
/** F's ember record: met is the tick the demand was met, or -1 (null in older records). */
const emberMet = (em) => typeof em.met === 'number' ? em.met >= 0 : !!em.met;

const NEED_HINT = { food: 'Eats meals or raw food from a stockpile. Starving drains health.', rest: 'Sleeps at night, best in a bed.', light: 'Darkness brings dread. Torches, braziers and the Hearth keep it away.',
  joy: 'Rises in joy hours: chats, ale, games, a fine room. Low joy breaks sooner.', warmth: 'Falls in the cold: a fire, a roof and walls, warm clothes.' };
const PART_NAME = { head: 'Head', torso: 'Torso', larm: 'Left arm', rarm: 'Right arm', lleg: 'Left leg', rleg: 'Right leg' };
const WOUND_NAME = { cut: 'Cut', stab: 'Stab wound', blunt: 'Bruise', burn: 'Burn', bite: 'Bite', frost: 'Frostbite', taint: 'Taint' };

/** Needs (10.5): one bar per need active in this build, then the top 6 thoughts with value and time left. */
function needsTab(el, ctx, c) {
  const act = activeNeeds();
  const list = h('div.ec-needs', { role: 'list' });
  for (const id of act) {
    const k = NEED_IDS.indexOf(id);
    if (k < 0) continue;
    const v = Math.max(0, Math.min(100, Math.round(c.need[k] / FIX)));
    const d = def('need', id) || { name: id };
    const tone = v < 15 ? 'bad' : v < 35 ? 'warn' : 'good';
    const row = h('button.ec-need.' + tone, { type: 'button', role: 'listitem', 'data-act': 'need-' + id, 'aria-label': `${d.name} ${v}` },
      h('span.ec-need-n', { text: d.name }), h('span.ec-skill-bar', null, h('i', { style: { width: v + '%' } })), h('b.ec-skill-l', { text: String(v) }));
    onTap(row, () => ctx.toast(`${d.name}: ${d.text || NEED_HINT[id] || ''}`.trim()));
    list.append(row);
  }
  if (!act.length) list.append(h('p.ec-note', { text: 'Needs are off in this build.' }));
  el.append(list);
  const mood = Math.round(c.mood / FIX);
  el.append(h('h3.ec-sub', { text: `Mood ${mood}${c.breakState ? ' · on a break' : mood < 25 ? ' · close to a break' : ''}` }));
  const th = (c.thoughts || []).map(([id, left, stack]) => {
    const d = def('thought', id) || { label: id, value: 0 };
    const val = Math.round(thoughtValue([id, left, stack]) / FIX);
    return { id, d, val, left, stack };
  }).sort((a, b) => Math.abs(b.val) - Math.abs(a.val) || (a.id < b.id ? -1 : 1)).slice(0, 6);
  if (!th.length) el.append(h('p.ec-note', { text: 'No strong thoughts right now.' }));
  for (const t of th) {
    const when = t.left < 0 ? 'while it lasts' : `${Math.max(1, Math.ceil(t.left / TICKS_PER_HOUR))} h left`;
    el.append(h('div.ec-thought.' + (t.val < 0 ? 'bad' : 'good'), { role: 'listitem' },
      h('span.ec-thought-n', { text: `${t.d.label || t.d.name || t.id}${t.stack > 1 ? ' x' + t.stack : ''}` }),
      h('span.ec-thought-w', { text: when }), h('b', { text: (t.val > 0 ? '+' : '') + t.val })));
  }
}

/** Health (10.5, simple health in 1b): state, blood, the six parts with their HP, the wound list. */
function healthTab(el, ctx, c) {
  const hp = c.hp || {};
  const blood = Math.round((hp.blood || 0) / FIX);
  const state = hp.dead ? 'Dead' : hp.down ? 'Downed: a colonist with Care carries them to a bed' : (hp.wounds || []).some((w) => w.tended === 0) ? 'Hurt' : 'Healthy';
  const facts = h('div.ec-facts');
  facts.append(h('div.ec-fact', null, h('span', { text: 'State' }), h('b', { text: state })), h('div.ec-fact', null, h('span', { text: 'Blood' }), h('b', { text: blood + '%' })));
  el.append(facts);
  const body = h('div.ec-needs', { role: 'list' });
  PART_IDS.forEach((p, k) => {
    const cur = Math.max(0, (hp.parts && hp.parts[k]) | 0), max = PART_HP[k];
    const pct = Math.round((cur / max) * 100);
    const tone = pct < 40 ? 'bad' : pct < 100 ? 'warn' : 'good';
    body.append(h('div.ec-need.' + tone, { role: 'listitem', 'aria-label': `${PART_NAME[p]} ${cur} of ${max}` },
      h('span.ec-need-n', { text: PART_NAME[p] }), h('span.ec-skill-bar', null, h('i', { style: { width: pct + '%' } })), h('b.ec-skill-l', { text: `${cur}/${max}` })));
  });
  el.append(h('h3.ec-sub', { text: 'Body' }), body);
  const wounds = hp.wounds || [];
  el.append(h('h3.ec-sub', { text: wounds.length ? 'Wounds' : 'No wounds' }));
  for (const w of wounds) {
    const inf = (w.infected | 0) > 0;
    const tended = inf ? `infected ${Math.round((w.infected | 0) / FIX) || w.infected}%` : w.tended > 0 ? 'tended' : w.bleed > 0 ? 'bleeding' : 'untended';
    el.append(h('div.ec-thought.' + (w.tended > 0 && !inf ? 'good' : 'bad'), null, h('span.ec-thought-n', { text: `${WOUND_NAME[w.kind] || w.kind}, ${(PART_NAME[PART_IDS[w.part]] || '').toLowerCase()}` }),
      h('span.ec-thought-w', { text: tended }), h('b', { text: String(w.dmg) })));
  }
  if (wounds.length) el.append(h('p.ec-note', { text: 'A doctor (Care work) tends wounds: an untended cut infects after 12 hours. A bed and an infirmary heal faster.' }));
  // Stage 2: illness, the Grey Taint, scars
  const ill = hp.illness;
  if (ill) {
    const d = def('illness', ill.id) || def('incident', ill.id) || { name: ill.id === 'grey_cough' ? 'Grey Cough' : ill.id };
    el.append(h('h3.ec-sub', { text: 'Illness' }), h('div.ec-facts', null,
      h('div.ec-fact', null, h('span', { text: d.name }), h('b', { text: `Severity ${Math.round((ill.sev | 0) / FIX)}%` })),
      h('div.ec-fact', null, h('span', { text: 'Immunity' }), h('b', { text: `${Math.round((ill.imm | 0) / FIX)}%` }))),
      h('p.ec-note', { text: 'Bed rest slows it; immunity at 100% cures it. It spreads to those who sleep in the same room.' }));
  }
  const taint = Math.round((hp.taint | 0) / FIX);
  if (taint > 0) el.append(h('h3.ec-sub', { text: 'Grey Taint' }), h('div.ec-need.bad', { role: 'meter', 'aria-label': `Taint ${taint}` }, h('span.ec-need-n', { text: 'Taint' }), h('span.ec-skill-bar', null, h('i', { style: { width: taint + '%' } })), h('b.ec-skill-l', { text: taint + '%' })),
    h('p.ec-note', { text: 'A Hollow blow left the grey in them. Bed rest near a Hearth of level 2 or more draws it out; at 100% they turn.' }));
  if (hp.scars && hp.scars.length) el.append(h('p.ec-note', { text: `Scars: ${hp.scars.map((p) => (PART_NAME[PART_IDS[p]] || '').toLowerCase()).join(', ')} (each slows work a little).` }));
}

export const COLONIST_TABS = Object.freeze(['Needs', 'Skills', 'Health', 'Gear', 'Social', 'Log', 'Bio']);
const LATER = {};
const JOB_TEXT = { tame: 'Taming', hunt: 'Hunting', milk: 'Milking', shear: 'Shearing', slaughter: 'Slaughtering', clean: 'Cleaning', firefight: 'Fighting a fire', tend: 'Tending the hurt',
  research: 'Studying', lore: 'Studying', art: 'Making art', tailor: 'Tailoring', brew: 'Brewing', smith: 'Smithing', joy: 'Relaxing', chat: 'Chatting', dress: 'Changing clothes', ember: 'Seized by the Ember',
  mine: 'Mining', chop: 'Chopping wood', craft: 'Crafting', deliver: 'Hauling to a build', construct: 'Building', deconstruct: 'Taking down', haul: 'Hauling',
  eat: 'Eating', sleep: 'Sleeping', refuel: 'Feeding the fire', rescue: 'Carrying someone to bed', bedrest: 'Resting in bed', sow: 'Sowing', harvest: 'Harvesting', cook: 'Cooking', sulk: 'Sulking', binge: 'Comfort eating' };
const ORDER_TEXT = { move: 'Drafted: moving', attack: 'Drafted: attacking', hold: 'Drafted: holding' };
const ATTR_NAME = { might: 'Might', wits: 'Wits', grace: 'Grace' };
const SCHED_WORD = { day: 'Day shift', early: 'Early risers', night: 'Night watch', custom: 'Custom' };
const safeSched = (c) => { try { return scheduleName(c.sched); } catch (_) { return 'custom'; } };

/** "Mining" / "Idle" / "Drafted": the colonist's current job in a few words. */
export function jobText(c) {
  if (c.hp && c.hp.dead) return 'Dead';
  if (c.hp && c.hp.down) return 'Downed';
  if (c.drafted) return (c.job && c.job.type === 'order' && ORDER_TEXT[c.job.order]) || 'Drafted';
  if (c.breakState) return 'Having a break';
  // an idle colonist found nothing their roles allow (think fell through to wandering): say so, the
  // usual answer to "why is she standing there?" is a role (Colony > Work)
  if (!c.job || c.job.type === 'idle') return 'Idle: no role work';
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
  // the medallion: the colonist's own pixel figure in a brass ring (its colour the mood), the role ribbon under the name
  const por = ctx.portrait(c, 64), fig = colonistThumb(c, 64);
  if (fig) { por.classList.add('has-fig'); por.append(fig); }
  const head = h('div.ec-chead', { 'aria-label': `${c.name}, swipe for the next colonist` },
    h('span.ec-medal', null, por),
    h('div.ec-chead-t', null,
      h('div.ec-chead-n', null, h('span.ec-ribbon', { text: profession(c) })),
      h('div.ec-peek-sub', { text: `${c.age}, ${(def('ancestry', c.anc) || { name: '' }).name} · ${jobText(c)}` }),
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
  // Stage 2: the Ember-touched demand, one tap away from the header
  const extra = [];
  const em = ctx.s.colony.ember;
  if (em && em.colId === c.id && ctx.openDemand) extra.push(btn(emberMet(em) ? 'Ember-touched: at work' : 'Ember-touched: the demand', 'col-demand', () => ctx.openDemand()));
  return h('div.ec-chead-wrap', null, head, roleChips(ctx, c), acts, extra.length ? h('div.ec-peek-acts', null, ...extra) : null);
}

/** Fill one tab of the colonist sheet. */
export function colonistTab(el, ctx, c, tab) {
  if (tab === 'Skills') return skillsTab(el, ctx, c);
  if (tab === 'Bio') return bioTab(el, ctx, c);
  if (tab === 'Needs') return needsTab(el, ctx, c);
  if (tab === 'Health') return healthTab(el, ctx, c);
  if (tab === 'Gear') return gearTab(el, ctx, c);
  if (tab === 'Social') return socialTab(el, ctx, c);
  if (tab === 'Log') return logTab(el, ctx, c);
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
  perksBlock(el, ctx, c);
}

/**
 * Perks (EMBERCROWN-FORTRESS.md 3.1): the perks earned, in the order they came, then the nearest perks
 * still to come with what is left: "Next: Seam Follower, mined 112 of 150 ore". No choice, no card.
 */
const NEXT_SHOWN = 3;
/** "Seam Follower, mined 112 of 150 ore" (the level first while it is short). */
export function nextPerkText(st) {
  const sk = def('skill', st.skill) || { name: st.skill };
  const deeds = st.deeds.filter((d) => !d.met || st.any).map((d) => d.prog).filter(Boolean);
  const parts = [];
  if (!st.levelOk) parts.push(`${sk.name} ${st.lvl} (now ${st.have})`);
  if (!st.deedsOk && deeds.length) parts.push(deeds.join(st.any ? ' or ' : ' and '));
  return `${st.name}, ${parts.length ? parts.join(', and ') : 'learned within the hour'}`;
}
/** How near a perk is (0..1): the level and the best deed share, level first. */
const nearness = (st) => {
  const share = Math.max(0, ...st.deeds.map((d) => Math.min(1, d.have / Math.max(1, d.n))));
  return (st.levelOk ? 1 : Math.min(0.99, st.have / Math.max(1, st.lvl))) * 2 + (st.deedsOk ? 1 : share);
};
function perksBlock(el, ctx, c) {
  const known = (c.perks || []).map((id) => def('perk', id)).filter(Boolean);
  el.append(h('h3.ec-sub', { text: known.length ? `Perks (${known.length})` : 'No perks yet' }));
  for (const p of known) el.append(h('div.ec-bio-item.ec-perk-held', null, h('b', { text: `${p.name} (${(def('skill', p.skill) || { name: p.skill }).name} ${p.lvl})` }), h('p.ec-bio-d', { text: p.text || '' })));
  let next = [];
  try { next = nextPerks(c).sort((a, b) => nearness(b) - nearness(a) || a.lvl - b.lvl).slice(0, NEXT_SHOWN); } catch (_) { next = []; }
  if (next.length) {
    el.append(h('h3.ec-sub', { text: 'Next' }));
    for (const st of next) {
      const p = def('perk', st.id) || { text: '' };
      el.append(h('div.ec-perk-next', { role: 'note' }, h('p.ec-perk-next-t', { text: `Next: ${nextPerkText(st)}` }), p.text ? h('p.ec-bio-d', { text: p.text }) : null));
    }
  }
  el.append(h('p.ec-note', { text: 'Perks are earned by doing: a colonist learns one when the skill reaches its level and the deed is done. Nothing is chosen, and any number can be held.' }));
}

const SLOT_NAME = { body: 'Body', outer: 'Outer', head: 'Head', feet: 'Feet', hands: 'Hands', trinket: 'Trinket', weapon: 'Weapon' };
/** Gear (6.6): the worn slots, the outfit picker (Worker, Soldier, Any) and soldier duty. */
function gearTab(el, ctx, c) {
  const g = c.gear || { slots: {}, outfit: null };
  const slots = g.slots || {};
  const facts = h('div.ec-facts');
  for (const k of Object.keys(SLOT_NAME)) {
    const v = slots[k];
    const kind = v && typeof v === 'object' ? v.k : v;
    const d = kind ? def('item', kind) : null;
    const mat = v && typeof v === 'object' && v.m ? (def('material', v.m) || { name: v.m }).name + ' ' : '';
    facts.append(h('div.ec-fact', null, h('span', { text: SLOT_NAME[k] }), h('b', { text: d ? `${mat}${d.name}`.replace(/^./, (x) => x.toUpperCase()) : 'Nothing' })));
  }
  el.append(facts);
  const outfits = all('outfit');
  const cur = g.outfit || (c.soldier ? 'soldier' : 'worker');
  if (outfits.length) {
    el.append(h('h3.ec-sub', { text: 'Outfit' }));
    const seg = h('div.ec-seg', { role: 'radiogroup', 'aria-label': 'Outfit' });
    for (const o of outfits) {
      const b = h('button.ec-seg-b' + (cur === o.id ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': cur === o.id ? 'true' : 'false', 'data-act': 'outfit-' + o.id, text: o.name });
      onTap(b, () => { ctx.send({ t: 'outfit', colId: c.id, outfit: o.id }, `${c.name.split(' ')[0]} wears the ${o.name} outfit.`); ctx.refreshSheet(); });
      seg.append(b);
    }
    el.append(seg, h('p.ec-note', { text: 'Colonists fetch the best clothes and armour their outfit allows (an armoury rack first). Only soldiers carry weapons.' }));
  }
  const sol = h('button.ec-row.ec-toggle', { type: 'button', role: 'switch', 'aria-checked': c.soldier ? 'true' : 'false', 'data-act': 'soldier' }, h('span.ec-row-n', { text: 'Soldier duty' }), h('span.ec-row-s', { text: c.soldier ? 'On' : 'Off' }));
  onTap(sol, () => { ctx.send({ t: 'soldier', colId: c.id, on: !c.soldier }, c.soldier ? 'Off soldier duty.' : 'On soldier duty: drafts with Draft all and trains in quiet hours.'); ctx.refreshSheet(); });
  el.append(sol);
}

const REL_WORD = { kin: 'Kin', friend: 'Friend', rival: 'Rival', lover: 'Lover', spouse: 'Spouse' };
/** Social (4.7): the 5 strongest relations. */
function socialTab(el, ctx, c) {
  const s = ctx.s;
  let rows = [];
  try { rows = strongest(s, c.id, 5); } catch (_) { rows = []; }
  if (!rows.length) { el.append(h('p.ec-note', { text: 'No strong feelings yet. Colonists chat while they work and eat together; friends and rivals grow from that.' })); return; }
  for (const r of rows) {
    const [oid, op, kind] = r;   // F's strongest(): [colId, opinion, kind]
    const other = s.col.find((x) => x.id === oid) || null;
    if (!other) continue;
    const row = h('button.ec-thought.' + (op < 0 ? 'bad' : 'good'), { type: 'button', 'data-act': 'rel' },
      h('span.ec-thought-n', { text: other.name }), h('span.ec-thought-w', { text: kind ? REL_WORD[kind] || kind : op >= 0 ? 'Warm' : 'Cold' }), h('b', { text: (op > 0 ? '+' : '') + op }));
    onTap(row, () => { ctx.select({ kind: 'colonist', id: other.id }, false, true); ctx.closeSheet(); ctx.centerOn(other.x, other.y); });
    el.append(row);
  }
  el.append(h('p.ec-note', { text: 'Opinion from -100 to 100. Friends lift each other\'s mood; rivals fight.' }));
}

/** Log: the Chronicle lines that name this colonist (newest first), then their own log. */
function logTab(el, ctx, c) {
  const s = ctx.s, first = c.name.split(' ')[0];
  const lines = [];
  for (let k = s.chron.length - 1; k >= 0 && lines.length < 20; k--) {
    const e = s.chron[k], a = e[3] || {};
    const hit = a.colId === c.id || a.col === c.id || Object.values(a).some((v) => v === c.name || v === first);
    if (hit) lines.push(e);
  }
  for (const x of (c.log || []).slice(-20).reverse()) if (lines.length < 20) lines.push([x.tick || x[0] || 0, 'log', null, null, x.text || x[1] || '']);
  if (!lines.length) { el.append(h('p.ec-note', { text: `Nothing written about ${first} yet. Deeds, wounds and artifacts land here.` })); return; }
  for (const e of lines) {
    const d = (Math.floor((e[0] | 0) / TICKS_PER_DAY) + 1);
    el.append(h('div.ec-log', null, h('span.ec-log-d', { text: `Day ${d}` }), h('span.ec-log-t', { text: e[4] || chronLine(e) })));
  }
}

function bioTab(el, ctx, c) {
  const anc = def('ancestry', c.anc);
  const sec = (title, ...kids) => h('section.ec-bio', null, h('h3.ec-sub', { text: title }), ...kids);
  el.append(sec('Who', h('p.ec-bio-t', { text: `${c.name}, ${c.age}. ${anc ? anc.name + '.' : ''} ${profession(c)}.` }), anc && anc.text ? h('p.ec-bio-d', { text: anc.text }) : null,
    h('p.ec-bio-d', { text: `Schedule: ${SCHED_WORD[safeSched(c)] || 'Custom'} (Colony > Schedule).` })));
  const at = h('div.ec-attrs');
  ATTR_IDS.forEach((a, k) => at.append(h('div.ec-attr', null, h('span', { text: ATTR_NAME[a] || a }), h('b', { text: String(c.at[k]) }))));
  el.append(sec('Attributes', at));
  // Z2 (3.2, 3.13): who they are inside, what they like, their life goal, and their family
  const ctxS = ctx.s;
  let psy = [], pref = null, goal = null;
  try { psy = psyDescribe(ctxS, c); pref = prefLines(ctxS, c); goal = goalLine(ctxS, c); } catch (_) { psy = []; }
  if (psy.length || pref || goal) {
    el.append(sec('Personality', ...psy.slice(0, 6).map((t) => h('p.ec-bio-d.ec-psy', { text: t })),
      pref && pref.likes.length ? h('p.ec-bio-d', { text: `Likes ${pref.likes.join(', ').toLowerCase()}.${pref.dislikes ? ` Dislikes ${pref.dislikes.toLowerCase()}.` : ''}` }) : null,
      goal ? h('p.ec-bio-d', { text: `Life goal: ${goal.label}${goal.met ? ' (done)' : ''}.` }) : null));
  }
  const stage = lifeStage(c), nameOfId = (id) => { const o = ctxS.col.find((x) => x.id === id); return o ? o.name.split(' ')[0] : 'someone'; };
  let par = [], kids = [];
  try { par = parentsOf(ctxS, c.id); kids = childrenOf(ctxS, c.id) || []; } catch (_) { par = []; }
  if (stage !== 'adult' || par.length || kids.length) {
    el.append(sec('Family', stage !== 'adult' ? h('p.ec-bio-d', { text: stage === 'child' ? 'A child: plays and learns by watching, does no work, never soldiers.' : 'A teen: works at half speed, never soldiers.' }) : null,
      par.length ? h('p.ec-bio-d', { text: `Child of ${par.map(nameOfId).join(' and ')}.` }) : null,
      kids.length ? h('p.ec-bio-d', { text: `Children: ${kids.map((k) => nameOfId(typeof k === 'object' ? k.id : k)).join(', ')}.` }) : null));
  }
  const bs = (c.bs || []).map((id) => def('backstory', id)).filter(Boolean);
  el.append(sec('Story', ...bs.map((b) => h('div.ec-bio-item', null, h('b', { text: `${b.slot === 'child' ? 'Childhood' : 'Adulthood'}: ${b.name}` }), h('p.ec-bio-d', { text: b.text || '' }),
    b.disables && b.disables.length ? h('p.ec-bio-warn', { text: `Will not ${b.disables.map((w) => ((def('worktype', w) || { name: w }).name).toLowerCase()).join(' or ')}.` }) : null))));
  const tr = (c.traits || []).map((id) => def('trait', id)).filter(Boolean);
  el.append(sec('Traits', ...(tr.length ? tr.map((t) => h('div.ec-bio-item', null, h('b', { text: t.name }), h('p.ec-bio-d', { text: t.text || '' }))) : [h('p.ec-bio-d', { text: 'No traits.' })])));
}

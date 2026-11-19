// Alerts (owner I; doc 10.6): conditions shown while they hold, as the right-edge icon stack (4
// visible, "+N"). Tap: jump to the subject. Long-press: explain, with "Snooze 1 day".
// Rules (most urgent first): raid, fire, starving, bleeding, downed, infection, taint rising, cold,
// mood break risk, demand unmet (Ember-touched), letter waiting, manhunter, idle colonists, no doctor,
// food < 3 days, Hearth fuel < 1 day, unburied corpses, stockpile full, bed missing, perk to choose,
// trader here, cave-in rumbling.
// UI only: alerts read state and never write it. Idle is timed on the UI side (a colonist idle for
// a game hour or more), snoozes are per colony in localStorage ('ec2.snooze.<id>'), in game ticks.
// A target: { colonist } | { building } | { tile: [x, y] } | { threat } | { animal } | { zone } |
// { open: 'letters' | 'demand' | 'trade' | 'skills' (with colonist) | 'work' }.
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../game/core/time.js';
import { FIX, NEED_IDS, WORK_IDS } from '../game/core/schema.js';
import { W } from '../game/core/grid.js';
import { threatChip } from '../game/threat/warnings.js';
import { foodDays } from '../data/advice.js';
/** F's ember record: met is the tick the demand was met, or -1 (null in older records). */
const emberMet = (em) => typeof em.met === 'number' ? em.met >= 0 : !!em.met;

const IDLE_TICKS = TICKS_PER_HOUR;   // idle for a game hour before the alert shows (jobs change often)
const first = (c) => (c.name || '?').split(' ')[0];
const alive = (s) => s.col.filter((c) => !c.hp.dead);
const isIdle = (c) => !c.drafted && !c.hp.down && !c.breakState && (!c.job || c.job.type === 'idle');
const NEED = Object.fromEntries(NEED_IDS.map((n, i) => [n, i]));
const stage2 = (s) => !!(s.colony && s.colony.world);   // B's world record exists from the first Stage 2 tick
const safe = (f, d = null) => { try { return f(); } catch (_) { return d; } };
const tileOf = (x, y) => [Math.floor(x / 32), Math.floor(y / 32)];

/** Hearth fuel in ticks, or null without a lit Hearth. */
export function hearthFuel(s) {
  const h = s.colony.hearth;
  if (!h || h.id === null || h.id === undefined || !s.bld[h.id]) return null;
  return h.fuel | 0;
}
const bleeding = (c) => (c.hp.wounds || []).some((w) => w.tended === 0 && (w.bleed | 0) > 0);
const infected = (c) => (c.hp.wounds || []).some((w) => (w.infected | 0) > 0);

/**
 * The alert rules. Each: id, icon, tone, test(s, view, extra) -> null | { text, why, target, tone? }.
 * extra: { letters (UI letter tracker), demand } from the shell.
 */
export const ALERT_RULES = Object.freeze([
  {
    id: 'raid', icon: 'horde', tone: 'bad',
    test(s) {
      const v = threatChip(s);
      if (!v || !(v.stage === 'imminent' || v.stage === 'active')) return null;
      const n = v.onMap !== null && v.onMap !== undefined ? v.onMap : v.size ? v.size.n : 0;
      const text = v.stage === 'active' ? `${v.name} on the map: ${n}` : `${v.name} in ${v.hours} h from the ${v.edge ? v.edge.word : 'edge'}`;
      return { text, why: 'Draft your colonists (tap a portrait, then Draft) and hold by the braziers. Tap to see where it comes from.', target: { threat: true } };
    },
  },
  {
    id: 'fire', icon: 'flame', tone: 'bad',
    test(s) {
      const f = s.colony.world && s.colony.world.fire;
      if (!f || !f.length) return null;
      const i = f[0][0];
      return { text: f.length === 1 ? 'A fire is burning' : `${f.length} tiles on fire`, why: 'Colonists put out fires in the home area by themselves; rain helps. Wood, plants and wooden floors burn; stone does not.', target: { tile: [i % W, (i / W) | 0] } };
    },
  },
  {
    id: 'starving', icon: 'hunger', tone: 'bad',
    test(s) {
      const c = alive(s).find((x) => x.need && x.need[0] <= 0);
      if (!c) return null;
      return { text: `${first(c)} is starving`, why: 'No food: health drains away. Cook meals at a campfire, grow crops, keep food in a stockpile.', target: { colonist: c.id } };
    },
  },
  {
    id: 'bleeding', icon: 'heart', tone: 'bad',
    test(s) {
      const c = alive(s).find(bleeding);
      if (!c) return null;
      return { text: `${first(c)} is bleeding`, why: 'A doctor (Care work) tends the wound and stops the bleeding. In bed it clots faster.', target: { colonist: c.id } };
    },
  },
  {
    id: 'downed', icon: 'heart', tone: 'bad',
    test(s) {
      const c = alive(s).find((x) => x.hp.down);
      if (!c) return null;
      return { text: `${first(c)} is down`, why: 'Someone with Care carries them to a bed. Keep a free bed near the Hearth.', target: { colonist: c.id } };
    },
  },
  {
    id: 'infection', icon: 'heart', tone: 'warn',
    test(s) {
      const c = alive(s).find(infected);
      if (!c) return null;
      return { text: `${first(c)} has an infection`, why: 'Tend it at least once a day (Care work); an infirmary and medicine help. At 100% it kills.', target: { open: 'health', colonist: c.id } };
    },
  },
  {
    id: 'taint', icon: 'skull', tone: 'bad',
    test(s) {
      const c = alive(s).find((x) => (x.hp.taint | 0) > 0);
      if (!c) return null;
      return { text: `Grey Taint in ${first(c)}: ${Math.round((c.hp.taint | 0) / FIX)}%`, why: 'Bed rest near a Hearth of level 2 or more draws it out. At 100% they turn into a Husk.', target: { open: 'health', colonist: c.id } };
    },
  },
  {
    id: 'cold', icon: 'deepcold', tone: 'warn',
    test(s) {
      if (!stage2(s)) return null;
      const c = alive(s).find((x) => x.need && x.need[NEED.warmth] !== undefined && x.need[NEED.warmth] < 15 * FIX);
      if (!c) return null;
      return { text: `${first(c)} is freezing`, why: 'Cold hurts: build walls and a roof, a fireplace or a campfire inside, and warm clothes.', target: { colonist: c.id } };
    },
  },
  {
    id: 'mood', icon: 'alert', tone: 'warn',
    test(s) {
      const c = alive(s).find((x) => !x.breakState && x.mood < 20 * FIX);
      const b = alive(s).find((x) => x.breakState);
      if (b) return { text: `${first(b)} is having a break`, tone: 'bad', why: 'They will snap out of it. A good room, meals, joy hours and friends keep mood up.', target: { colonist: b.id } };
      if (!c) return null;
      return { text: `${first(c)} is close to a break`, why: 'Low mood: check their thoughts (Needs tab). Better meals, a fine bedroom and joy hours help.', target: { open: 'needs', colonist: c.id } };
    },
  },
  {
    id: 'demand', icon: 'flame', tone: 'warn',
    test(s) {
      const em = s.colony.ember;
      if (!em || emberMet(em)) return null;
      const c = s.col.find((x) => x.id === em.colId);
      const days = em.deadline !== undefined ? Math.max(0, Math.ceil((em.deadline - s.tick) / TICKS_PER_DAY)) : null;
      return { text: `${c ? first(c) : 'Someone'}'s demand${days !== null ? `: ${days} days left` : ''}`, why: 'An Ember-touched crafter waits for materials. Met: a named masterwork. Not met: a major break.', target: { open: 'demand' } };
    },
  },
  {
    id: 'letter', icon: 'book', tone: 'warn',
    test(s, view, x) {
      const wait = x && x.letters ? x.letters.waiting() : [];
      if (wait.length) return { text: wait.length === 1 ? `A letter waits: ${wait[0].title || 'a choice'}` : `${wait.length} letters wait for an answer`, why: 'Letters with choices take their default when the time runs out.', target: { open: 'letters' } };
      const un = x && x.letters ? x.letters.unread() : [];
      if (un.length) return { text: un.length === 1 ? `New letter: ${un[0].title || 'news'}` : `${un.length} new letters`, tone: '', why: 'News of the hold. Tap to read.', target: { open: 'letter' } };
      return null;
    },
  },
  {
    id: 'manhunter', icon: 'sword', tone: 'bad',
    test(s) {
      const a = s.anim.find((x) => x.st && x.st.mode === 'manhunt');
      if (!a) return null;
      return { text: 'A beast is hunting colonists', why: 'Draft your fighters and kill it, or keep everyone indoors behind closed doors.', target: { animal: a.id } };
    },
  },
  {
    id: 'idle', icon: 'alert', tone: 'warn',
    test(s, view) {
      const idle = alive(s).filter((c) => isIdle(c) && view.idleSince.has(c.id) && s.tick - view.idleSince.get(c.id) >= IDLE_TICKS);
      if (!idle.length) return null;
      return { text: idle.length === 1 ? `${first(idle[0])} is idle` : `${idle.length} colonists are idle`,
        why: 'Nothing their roles allow can be done. Give them a role with more work (Colony > Work), or mark rock, trees or blueprints.', target: { colonist: idle[0].id } };
    },
  },
  {
    id: 'nodoctor', icon: 'heart', tone: 'warn',
    test(s) {
      if (!stage2(s)) return null;
      const hurt = alive(s).some((c) => bleeding(c) || infected(c) || c.hp.down);
      const k = WORK_IDS.indexOf('care');
      if (!hurt || alive(s).some((c) => !c.hp.down && c.prio[k] >= 1 && c.prio[k] <= 2)) return null;
      return { text: 'No doctor for the hurt', why: 'Nobody has Care at priority 1 or 2. Give someone the Doctor role.', target: { open: 'work' } };
    },
  },
  {
    id: 'food', icon: 'food', tone: 'warn',
    test(s) {
      if (s.tick < TICKS_PER_DAY) return null;
      const d = safe(() => foodDays(s), 99);
      if (d >= 3) return null;
      return { text: `Food for ${Math.max(0, Math.floor(d))} days`, why: 'Grow crops (Zones > Grow), hunt (Orders > Hunt), cook meals and keep a food store.', target: { open: 'stock' } };
    },
  },
  {
    id: 'hearth', icon: 'flame', tone: 'warn',
    test(s) {
      const f = hearthFuel(s);
      if (f === null || f >= TICKS_PER_DAY) return null;
      const hours = Math.floor(f / TICKS_PER_HOUR);
      return { text: f <= 0 ? 'The Hearth is out' : `Hearth fuel: ${hours} h left`, tone: f <= 0 ? 'bad' : 'warn',
        why: 'Haulers bring wood to the Hearth by themselves when there is wood in a stockpile. A cold Hearth gives no light and no night shot.', target: { building: s.colony.hearth.id } };
    },
  },
  {
    id: 'corpse', icon: 'skull', tone: 'warn',
    test(s) {
      if (!stage2(s)) return null;
      const it = s.items.find((x) => x && x.k === 'corpse');
      if (!it) return null;
      return { text: 'The dead lie unburied', why: 'Build a grave (Build > Utility): haulers bury the dead. Unburied, they may rise as Husks.', target: { tile: [it.x, it.y] } };
    },
  },
  {
    id: 'stockfull', icon: 'crate', tone: 'warn',
    test(s) {
      if (!stage2(s) || !s.rt.zoneFree || !s.rt.zoneFree.lists) return null;
      const stores = s.zones.filter((z) => z.type === 'stockpile');
      if (!stores.length) return null;
      const lists = s.rt.zoneFree.lists;
      const full = stores.every((z) => { const l = lists.find((x) => x.id === z.id); return l && l.cells.length === 0; });
      if (!full) return null;
      return { text: 'Stockpiles are full', why: 'Haulers have nowhere to put things. Expand a stockpile or build shelves.', target: { zone: stores[0].id } };
    },
  },
  {
    id: 'bed', icon: 'bed', tone: 'warn',
    test(s) {
      if (!stage2(s) || s.tick < TICKS_PER_DAY) return null;
      const beds = s.bld.filter((b) => b && b.st === 'done' && /bed|cot|bunk|bedroll|infirmary/.test(b.def)).length;
      const n = alive(s).length;
      if (beds >= n) return null;
      return { text: `${n - beds} without a bed`, why: 'Sleeping on the floor sours mood. Build beds (Build > Housing) or stamp a bedroom.', target: { open: 'build' } };
    },
  },
  {
    id: 'perk', icon: 'trophy', tone: '',
    test(s, view, x) {
      const c = x && x.perkOf ? alive(s).find((cc) => x.perkOf(cc)) : null;
      if (!c) return null;
      return { text: `${first(c)} can choose a perk`, why: 'A key skill reached 10 or 20: two perks to pick from in the Skills tab.', target: { open: 'skills', colonist: c.id } };
    },
  },
  {
    id: 'trader', icon: 'merchant', tone: '',
    test(s) {
      const v = s.colony.trade && s.colony.trade.visits ? s.colony.trade.visits.find((x) => x.until > s.tick) : null;
      if (!v) return null;
      return { text: 'A trader is here', why: 'They stay one day. Tap to trade: coins, goods, and goodwill with their faction.', target: { open: 'trade' } };
    },
  },
  {
    id: 'rumble', icon: 'alert', tone: 'bad',
    test(s) {
      const q = s.colony.world && s.colony.world.caveQ;
      if (!q || !q.length) return null;
      const i = q[0][0];
      return { text: 'The rock is rumbling', why: 'A roof lost its support: it will fall. Get clear, then build pillars, props or walls within 4 tiles.', target: { tile: [i % W, (i / W) | 0] } };
    },
  },
]);

const KEY = (s) => 'ec2.snooze.' + (s.id || 'colony');
function loadSnooze(s) { try { const v = JSON.parse(localStorage.getItem(KEY(s)) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; } }
function saveSnooze(s, v) { try { localStorage.setItem(KEY(s), JSON.stringify(v)); } catch (_) { /* private mode: snoozes last this session */ } }

/** The alert tracker for one colony: update() once a second, list() for the stack. extra: see ALERT_RULES. */
export function alertTracker(s, extra = null) {
  const view = { idleSince: new Map() };
  let snooze = loadSnooze(s);
  let cur = [];
  return {
    view,
    update() {
      for (const c of s.col) {
        if (isIdle(c)) { if (!view.idleSince.has(c.id)) view.idleSince.set(c.id, s.tick); }
        else view.idleSince.delete(c.id);
      }
      const out = [];
      for (const r of ALERT_RULES) {
        if ((snooze[r.id] | 0) > s.tick) continue;
        const a = safe(() => r.test(s, view, extra));
        if (a) out.push({ id: r.id, icon: r.icon, tone: a.tone !== undefined ? a.tone : r.tone, text: a.text, why: a.why, target: a.target });
      }
      cur = out;
      return out;
    },
    list: () => cur,
    snooze(id, ticks = TICKS_PER_DAY) { snooze[id] = s.tick + ticks; saveSnooze(s, snooze); cur = cur.filter((a) => a.id !== id); },
    key: () => cur.map((a) => `${a.id}:${a.tone}:${a.text}`).join('|'),
  };
}

/** Mood ring colour band for a colonist (portraits). */
export const moodPct = (c) => Math.max(0, Math.min(100, (c.mood || 0) / FIX));
void tileOf;

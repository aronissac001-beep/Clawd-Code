// Nemeses (doc 9.10): raiders who survive and come back. Owner H. Stage 2.
//
// s.st.nemeses = [Nemesis] (schema C2: { id, name, epithet, kind, affixes, scar, grudge, returns,
// nextTick }), at most CAPS.nemeses (6) alive: making a seventh retires the oldest (lowest id) with
// a `nemesis` event ('retired').
//   Made from: a reaver captain who flees or is ransomed, a Gloom Hound alpha or an elite Hollow
//   (warden affix) that breaks off wounded or is alive at dawn (raiders.js escapeElite). The name and
//   epithet come from its kind and its worst wound (text ids nem_* in incidents.js / text/nemesis.js);
//   scar = that wound kind; grudge = the colonist who dealt it the most damage (foe.st.by).
//   Returns after 1-2 seasons leading a major of its kind (incidentFor; the storyteller schedules it
//   with entry.nem), with +1 affix per return (AFFIXES order) and its grudge target in the cast.
//   Killing it writes a Chronicle line and drops a named trophy (its weapon, else a fang of bone).
//   A nemesis that kills its grudge target gains a title and returns once more (it is due again at
//   once, and its next return is not counted against it).
// The returns count and the title live in the entity (returns, epithet); s.st.nemTitle = [nemId]
// marks those that took a title.
// W3.4 (EMBERCROWN-WORLD.md 2.7, raids row): a raid from a civ is led by a living world figure (the leader foe
// carries st.fig and st.civ). When that leader becomes a nemesis, the record takes the figure's name, an epithet of
// its civ and one affix per FIG_DEEDS_PER_AFFIX of its past deeds (at most 2); s.st.nemFig = [[nemId, figId, civId]]
// keeps the link (the world key wf<figId>). The realm record itself is read from s.rt.realm (9.3 step 5, class
// "input"), only when its wid matches s.realm.wid; a hold without one never reaches this path.

import { newNemesis } from '../core/schema.js';
import { nextId, colById } from '../core/state.js';
import { nextU32 } from '../core/rand.js';
import { TICKS_PER_DAY, DAYS_PER_SEASON } from '../core/time.js';
import { emit } from '../core/events.js';
import { BUS } from '../core/bus.js';
import { addChron } from '../colony/chronicle.js';
import { bal, variants, def } from './defs.js';
import { sendLetter, textOf } from './letters.js';
import { DATA as NAMES } from '../../data/names.js';

export const AFFIXES = Object.freeze(['armoured', 'swift', 'rallying', 'burning']);

// ---- the realm record (W3.4) ------------------------------------------------------------------------------
/** The hold's decoded realm record with history (s.rt.realm, wid-checked), or null: the legacy paths run. */
export function realmRecord(s) {
  const R = s && s.realm && s.rt ? s.rt.realm : null;
  if (!R || (R.wid >>> 0) !== (s.realm.wid >>> 0) || !R.tables || !Array.isArray(R.tables.civs) || !R.tables.civs.length) return null;
  return R;
}
const NAME_ROWS = Object.freeze(Object.fromEntries(NAMES.names.map((r) => [r.id, r])));
/** A world figure's name ('first family' from its people's name table; W3.2 may give a richer one). */
export function figureName(f) {
  if (!f || !Array.isArray(f.nm)) return 'a stranger';
  const r = NAME_ROWS[f.people] || NAME_ROWS.human, a = r.first[f.nm[0] % r.first.length], b = r.family[(f.nm[1] | 0) % r.family.length];
  return b ? `${a} ${b}` : a;
}
/** A civ's name as a sentence noun: 'the Ashfen Clans', 'the Kingdom of Merwick'. */
export const civLabel = (c) => (!c ? 'raiders' : c.name.startsWith('the ') ? c.name : `the ${c.name}`);
export const FIG_DEEDS_PER_AFFIX = 2;
/** The world link of a nemesis ([nemId, figId, civId]) or null. */
export const nemFigOf = (s, nemId) => ((s.st && s.st.nemFig) || []).find((r) => r[0] === nemId) || null;
const pickText = (s, id, fallback) => { const v = variants(id); return v.length ? v[nextU32(s, 'names') % v.length] : fallback; };

/** The major a nemesis of this kind leads when it returns. */
export function incidentFor(n) {
  const k = typeof n === 'string' ? n : n.kind;
  if (k && k.startsWith('reaver')) return 'reaver_raid';
  if (k === 'gutter_thief' || k === 'delver') return k === 'delver' ? 'sapper_raid' : 'thieves';
  if (k === 'wolf' || k === 'boar' || k === 'cave_spider' || k === 'great_spider') return 'manhunters';
  return 'hollow_horde';
}
export const nemesisById = (s, id) => s.st.nemeses.find((n) => n.id === id) || null;

/** Name and epithet for a new nemesis of this kind with this worst wound kind. */
function naming(s, kind, scar) {
  const hollow = !kind.startsWith('reaver') && kind !== 'gutter_thief' && kind !== 'delver';
  let name;
  if (kind === 'gloom_hound' || kind === 'wolf') name = pickText(s, 'nem_hound_name', 'The Grey Alpha');
  else if (hollow) name = pickText(s, 'nem_hollow_name', 'The Pale Warden');
  else name = pickText(s, 'nem_name', 'Vask');
  const ep = scar === 'bite' || scar === 'cut' ? (kind === 'gloom_hound' || kind === 'wolf' ? 'nem_epithet_ear' : 'nem_epithet_scar')
    : scar === 'fire' || scar === 'burn' ? 'nem_epithet_ash' : 'nem_epithet_jaw';
  return { name, epithet: pickText(s, ep, '') };
}
export const fullName = (n) => (n.epithet ? `${n.name} ${n.epithet}` : n.name);

/** The colonist who dealt this foe the most damage (foe.st.by = [[colId, dmg]]), ties by lower id; or null. */
export function grudgeOf(foe) {
  const by = foe && foe.st && foe.st.by;
  if (!by || !by.length) return null;
  let best = null, bd = -1;
  for (const [id, d] of by) if (d > bd || (d === bd && id < best)) { bd = d; best = id; }
  return best;
}
/** Its worst wound kind (foe.st.wk = [[kind, dmg]]), or null. */
export function scarOf(foe) {
  const wk = foe && foe.st && foe.st.wk;
  if (!wk || !wk.length) return null;
  let best = null, bd = -1;
  for (const [k, d] of wk) if (d > bd) { bd = d; best = k; }
  return best;
}

/** Make a nemesis from a surviving foe. grudge: the colonist who wounded it most (or null). */
export function makeNemesis(s, foe, { grudge = grudgeOf(foe), scar = scarOf(foe) } = {}) {
  const cap = bal('caps').nemeses || 6;
  while (s.st.nemeses.length >= cap) {
    const old = s.st.nemeses.shift();
    emit(s, 'nemesis', { nemId: old.id, what: 'retired' });
  }
  const seasons = 1 + (nextU32(s, 'story') % 2);
  // W3.4: a leader who is a world figure keeps its own name; its past deeds seed the affixes
  const R = foe.st && Number.isInteger(foe.st.fig) ? realmRecord(s) : null, fig = R ? R.tables.figures[foe.st.fig] || null : null;
  const civ = fig && R.tables.civs[fig.civ] ? R.tables.civs[fig.civ] : null;
  const nm = fig ? { name: figureName(fig), epithet: `of ${civLabel(civ)}` } : naming(s, foe.kind || 'husk', scar);
  const seed = fig ? AFFIXES.slice(0, Math.min(2, Math.floor((fig.deeds || []).length / FIG_DEEDS_PER_AFFIX))) : [];
  const n = newNemesis(nextId(s, 'nem'), {
    name: nm.name, epithet: nm.epithet, kind: foe.kind, affixes: seed,
    scar, grudge, returns: 0, nextTick: s.tick + seasons * DAYS_PER_SEASON * TICKS_PER_DAY,
  });
  s.st.nemeses.push(n);
  if (fig) (s.st.nemFig || (s.st.nemFig = [])).push([n.id, fig.id, fig.civ]);
  if (s.st.nemFig) s.st.nemFig = s.st.nemFig.filter((r) => s.st.nemeses.some((x) => x.id === r[0]));
  emit(s, 'nemesis', { nemId: n.id, what: 'made' });
  const c = grudge !== null ? colById(s, grudge) : null;
  sendLetter(s, 'nemesis', { title: fullName(n), text: textOf('nem_made', { nemesis: fullName(n), target: c ? c.name : 'the hold' }, '{nemesis} escaped.'), data: { nemId: n.id } });
  return n;
}
/** Nemeses whose return is due, by id. */
export const dueNemeses = (s) => s.st.nemeses.filter((n) => n.nextTick <= s.tick);
/** A nemesis leads a raid: one more return and one more affix (in AFFIXES order). */
export function markReturn(s, n) {
  n.returns++;
  const next = AFFIXES.find((a) => !n.affixes.includes(a));
  if (next) n.affixes.push(next);
  n.nextTick = s.tick + (1 + (nextU32(s, 'story') % 2)) * DAYS_PER_SEASON * TICKS_PER_DAY;
  emit(s, 'nemesis', { nemId: n.id, what: 'returns' });
  const c = n.grudge !== null ? colById(s, n.grudge) : null;
  sendLetter(s, 'nemesis', { title: fullName(n), text: textOf('nem_returns', { nemesis: fullName(n), target: c && !c.hp.dead ? c.name : 'the hold' }, '{nemesis} returns.'), data: { nemId: n.id } });
}
/** A nemesis leaving the map alive again (it fled): it will be back (its nextTick stands). */
export function escaped(s, n) { emit(s, 'nemesis', { nemId: n.id, what: 'escaped' }); }

const GEAR_NAME = { club: 'club', spear: 'spear', sword: 'sword', shortbow: 'bow', crossbow: 'crossbow', pick: 'pick' };
/** The nemesis died: Chronicle, the named trophy at (tx, ty), the event. Returns the trophy item kind. */
export function slay(s, nemId, killer = null, at = null, spawnItem = null, gear = null) {
  const i = s.st.nemeses.findIndex((n) => n.id === nemId);
  if (i < 0) return null;
  const n = s.st.nemeses[i];
  s.st.nemeses.splice(i, 1);
  emit(s, 'nemesis', { nemId, what: 'slain' });
  const kc = killer && Array.isArray(killer.sk) ? killer : null;
  addChron(s, 'nemesis', 'nem_slain', { nemesis: fullName(n), killer: kc ? kc.name : 'the hold' });
  sendLetter(s, 'nemesis', { title: fullName(n), text: textOf('nem_slain', { nemesis: fullName(n), killer: kc ? kc.name : 'the hold' }, '{nemesis} is dead.'), data: { nemId } });
  let kind = null;
  if (at && spawnItem) {
    kind = gear && def('item', gear) ? gear : def('item', 'bone') ? 'bone' : null;
    if (kind) spawnItem(s, kind, kind === gear ? 'iron' : null, 0, 1, at[0], at[1], { name: `${n.name}'s ${GEAR_NAME[kind] || 'fang'}`, z: at[2] | 0 });
  }
  return kind;
}

/** BUS.kill: a nemesis that killed its grudge target takes a title and is due back at once. */
function onKill(s, victim, killer) {
  if (!victim || !Array.isArray(victim.sk) || !killer || killer.nem === null || killer.nem === undefined) return;
  const n = nemesisById(s, killer.nem);
  if (!n || n.grudge !== victim.id) return;
  const t = s.st.nemTitle || (s.st.nemTitle = []);
  if (t.includes(n.id)) return;
  t.push(n.id);
  n.epithet = pickText(s, 'nem_title', 'Bane of the Hold');
  n.grudge = null;
  n.nextTick = Math.min(n.nextTick, s.tick + DAYS_PER_SEASON * TICKS_PER_DAY);
  emit(s, 'nemesis', { nemId: n.id, what: 'titled' });
}
export function installNemesis() { if (!BUS.kill.includes(onKill)) BUS.kill.push(onKill); }

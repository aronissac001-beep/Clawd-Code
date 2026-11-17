// Contract C8 (owner A; reviewers D, I; provisional until the 1a fun review): event names and
// payloads (doc 13.3). The sim calls emit(s, name, data); the controller drains the queue once
// per frame and hands events to FX, audio, the Chronicle and toasts. The sim never reads the
// queue (rt class 'output' in C13), so events cannot affect determinism.

/** Event name -> payload fields (documentation and dev checks). Add new names at the end. */
export const EVENTS = Object.freeze({
  mined: ['i', 'mat', 'ore', 'colId'],
  oreFound: ['i', 'ore'],
  discovery: ['kind', 'i'],
  built: ['bId', 'def'],
  crafted: ['itemId', 'k', 'q', 'colId'],
  masterwork: ['itemId', 'colId'],
  artifact: ['itemId', 'colId', 'name'],
  hauled: ['itemId', 'colId'],
  ate: ['colId', 'k'],
  slept: ['colId', 'bed'],
  broke: ['colId', 'brk'],
  inspired: ['colId', 'kind'],
  emberTouched: ['colId', 'bId'],
  wounded: ['id', 'part', 'kind', 'dmg'],
  downed: ['id'],
  died: ['id', 'cause', 'killer'],
  raidWarn: ['raidId', 'arriveTick'],
  raidStage: ['raidId', 'stage'],
  raidEnd: ['raidId', 'result'],
  nemesis: ['nemId', 'what'],
  fireStart: ['i'],
  caveIn: ['i', 'tiles'],
  tierUp: ['tier'],
  rankUp: ['colId', 'skill', 'lvl'],
  letter: ['letterId', 'kind'],
  caveRumble: ['tiles'],   // support lost: tiles crack and rumble, then collapse (3.4); emitted by world/support.js
});
export const EVENT_NAMES = Object.freeze(Object.keys(EVENTS));

/** Queue an event on s.rt.events. Unknown names throw (they would never reach a subscriber). */
export function emit(s, name, data = null) {
  if (!(name in EVENTS)) throw new Error(`events: unknown event ${name}`);
  const q = s.rt && s.rt.events;
  if (q) q.push({ name, tick: s.tick, data });
}

/** Take every queued event (controller, once per frame). */
export function drain(s) {
  const q = s.rt.events;
  if (!q.length) return [];
  const out = q.slice();
  q.length = 0;
  return out;
}

// ---- Subscriptions (UI side; the sim never subscribes) ---------------------------------------
const subs = new Map();
export function on(name, fn) {
  if (name !== '*' && !(name in EVENTS)) throw new Error(`events: unknown event ${name}`);
  if (!subs.has(name)) subs.set(name, []);
  subs.get(name).push(fn);
  return () => { const l = subs.get(name); const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
}
/** Drain and dispatch to subscribers; returns the drained list. */
export function dispatch(s) {
  const evs = drain(s);
  for (const e of evs) {
    const l = subs.get(e.name); if (l) for (const fn of l) fn(e);
    const all = subs.get('*'); if (all) for (const fn of all) fn(e);
  }
  return evs;
}

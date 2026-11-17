// Relationships (light; doc 4.7). Owner F. Provisional API; chats arrive in Stage 2.
//
// s.rel (C2) maps a pair key to [op, kind]: key = a x 1024 + b with a < b (colonist ids), stored
// as an object key (a string in JSON). op -100..100; kind null | 'kin' | 'friend' | 'rival' |
// 'lover' | 'spouse'. friend and rival follow op (>= 40, <= -40); kin, lover and spouse are set
// by events and kept. Sim code never iterates s.rel's keys: lists go over s.col in id order.

export const REL_KINDS = Object.freeze(['kin', 'friend', 'rival', 'lover', 'spouse']);
export const FRIEND_OP = 40, RIVAL_OP = -40, PAIR_SPAN = 1024;

export const pairKey = (a, b) => (a < b ? a * PAIR_SPAN + b : b * PAIR_SPAN + a);
export function relation(s, a, b) { return s.rel[pairKey(a, b)] || null; }
export const opinion = (s, a, b) => { const r = relation(s, a, b); return r ? r[0] : 0; };
export const kindOf = (s, a, b) => { const r = relation(s, a, b); return r ? r[1] : null; };

const derived = (op, kind) => (kind === 'kin' || kind === 'lover' || kind === 'spouse' ? kind : op >= FRIEND_OP ? 'friend' : op <= RIVAL_OP ? 'rival' : null);

/** Change the pair's opinion by d (clamped), updating friend / rival. Returns the new opinion. */
export function addOpinion(s, a, b, d) {
  if (a === b) return 0;
  const k = pairKey(a, b);
  const r = s.rel[k] || [0, null];
  const op = Math.max(-100, Math.min(100, r[0] + d));
  const kind = derived(op, r[1]);
  if (op === 0 && kind === null) delete s.rel[k]; else s.rel[k] = [op, kind];
  return op;
}
/** Set a lasting kind (kin, lover, spouse); null clears it back to the opinion-derived kind. */
export function setKind(s, a, b, kind) {
  const k = pairKey(a, b);
  const r = s.rel[k] || [0, null];
  s.rel[k] = [r[0], kind === null ? derived(r[0], null) : kind];
}

/** The colonist's n strongest relations as [[otherId, op, kind]], by |op| then id (the Social tab). */
export function strongest(s, colId, n = 5) {
  const out = [];
  for (const c of s.col) {
    if (c.id === colId) continue;
    const r = relation(s, colId, c.id);
    if (r) out.push([c.id, r[0], r[1]]);
  }
  out.sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]) || x[0] - y[0]);
  return out.slice(0, n);
}

/** Drop every relation of a colonist who left the colony for good (not on death: grief needs them). */
export function forget(s, colId) {
  for (const c of s.col) if (c.id !== colId) delete s.rel[pairKey(colId, c.id)];
}

/** Tick system (slot 'social'). Stage 2: chats within 3 tiles during joy and meals. */
export function socialSystem() {}

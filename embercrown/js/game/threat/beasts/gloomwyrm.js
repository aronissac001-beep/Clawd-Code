// Great beast (legend): Gloomwyrm (EMBERCROWN-FORTRESS.md 3.12; step Z3.3). Owner H.
// Lair: a cliff eyrie in the heights. Cause: Rumour of wealth summed >= wyrmRumour (it is a hoarder).
// Body (js/data/beasts.js legend row): winged; breath of fire (sets fires, ignites stockpiles); darkness aura;
// it comes from the sky at a surface edge. No scripted phases: it flees to its eyrie when hurt.

export const BEAST = Object.freeze({
  id: 'gloomwyrm',
  legend: true,
  /** The waking cause now ([kind, subject, weight]) or null (pure in s). */
  cause(s, b, cs, { K }) {
    let w = 0, sub = null;
    for (const c of cs) if (c[0] === 'rumour') { w += c[2]; if (sub === null) sub = c[1]; }
    return w >= K.wyrmRumour ? ['rumour', sub, w] : null;
  },
});

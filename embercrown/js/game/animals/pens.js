// Pens (doc 7.5): pen zones keep tamed animals. Owner K. Stage 2 feature; Stage 0 skeleton.
// a.pen is a zone id of type 'pen' (E's zones). Acceptance in Stage 2: a tamed goat stays in its pen.

export const penZones = (s) => s.zones.filter((z) => z.type === 'pen');
export const penOf = (s, a) => (a.pen === null ? null : s.zones.find((z) => z.id === a.pen && z.type === 'pen') || null);
/** Assign an animal to a pen zone (null to release). */
export function assignPen(s, a, zoneId) {
  if (zoneId === null) { a.pen = null; return true; }
  if (!penZones(s).some((z) => z.id === zoneId)) return false;
  a.pen = zoneId;
  return true;
}
/** Tick system (slot 'animals'). Stage 2: penned animals wander only inside their pen. */
export function pensSystem() {}

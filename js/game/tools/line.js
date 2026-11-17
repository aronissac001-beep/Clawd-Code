// Line tools (owner I; doc 10.2, 10.3, 13.1 `js/game/tools/line.js`): wall lines and painted floors.
// Pure helpers between the gesture layer and the `placeLine` command (C3): a drag from tile A to
// tile B becomes a straight, axis-locked line (walls must touch side by side to close a room, so a
// diagonal drag snaps to its longer axis), and a dragged floor rectangle becomes one serpentine
// path (placeLine needs touching tiles). No DOM, no clocks, no state writes.

/** The most tiles one placeLine command takes (C3 linePath). */
export const MAX_LINE = 512;

/**
 * Straight line of tiles from a to b along the longer axis (a tie goes horizontal). [[x, y], ...],
 * starting at a, at most MAX_LINE tiles.
 */
export function linePath(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const out = [];
  if (Math.abs(dx) >= Math.abs(dy)) {
    const st = dx >= 0 ? 1 : -1;
    for (let k = 0; k <= Math.abs(dx) && out.length < MAX_LINE; k++) out.push([a.x + k * st, a.y]);
  } else {
    const st = dy >= 0 ? 1 : -1;
    for (let k = 0; k <= Math.abs(dy) && out.length < MAX_LINE; k++) out.push([a.x, a.y + k * st]);
  }
  return out;
}

/** End tile of the axis-locked line from a towards b. */
export function lineEnd(a, b) {
  const p = linePath(a, b);
  const e = p[p.length - 1];
  return { x: e[0], y: e[1] };
}

/**
 * Serpentine path over a rectangle (row by row, alternating direction) so that every step touches
 * the last: one placeLine command paints a floor rectangle. Truncated at MAX_LINE tiles.
 */
export function rectPath(r) {
  const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1);
  const out = [];
  for (let y = y0, row = 0; y <= y1; y++, row++) {
    if (row % 2 === 0) { for (let x = x0; x <= x1 && out.length < MAX_LINE; x++) out.push([x, y]); }
    else { for (let x = x1; x >= x0 && out.length < MAX_LINE; x--) out.push([x, y]); }
    if (out.length >= MAX_LINE) break;
  }
  return out;
}

/** "Wall line: 7 tiles" style label for the loupe. */
export function lineLabel(path) {
  const n = path.length;
  return `${n} ${n === 1 ? 'tile' : 'tiles'}`;
}

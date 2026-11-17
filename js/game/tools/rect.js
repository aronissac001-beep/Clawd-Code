// Rectangle tools (owner I; doc 10.2, 10.3, 13.1 `js/game/tools/rect.js`): designations and zones.
// Pure helpers between the gesture layer (js/ui/shell.js) and the commands (C3, core/commands.js):
// a drag from tile A to tile B becomes a clipped rectangle, a label for the loupe and one command.
// No DOM, no clocks: the UI feeds tile coordinates in and sends what comes out.
import { W, H, TILE, clamp } from '../core/grid.js';

/** World point (world units) -> tile coordinates clamped to the map. */
export function tileAt(wx, wy) {
  return { x: clamp(Math.floor(wx / TILE), 0, W - 1), y: clamp(Math.floor(wy / TILE), 0, H - 1) };
}
/** Normalised rectangle {x0,y0,x1,y1} (inclusive) spanning tiles a and b. */
export function rectOf(a, b) {
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}
export const rectW = (r) => r.x1 - r.x0 + 1;
export const rectH = (r) => r.y1 - r.y0 + 1;
/** "6 x 4, 24 tiles" (the loupe's size line, 10.2). */
export function rectLabel(r) {
  const n = rectW(r) * rectH(r);
  return `${rectW(r)} x ${rectH(r)}, ${n} ${n === 1 ? 'tile' : 'tiles'}`;
}
/** Tool definitions: id -> { name, kind (designation kind), shape }. Only rectangle tools in Stage 0. */
export const RECT_TOOLS = Object.freeze({
  mine: { name: 'Mine', kind: 'mine', shape: 'rect' },
  chop: { name: 'Chop', kind: 'chop', shape: 'rect' },
  harvest: { name: 'Harvest', kind: 'harvest', shape: 'rect' },
  cancel: { name: 'Cancel', kind: null, shape: 'rect' },
});
/**
 * The command for one finished stroke. mode 'add' or 'remove' (the tool bar chips; a long-press
 * stroke is 'remove' too, 10.2). Cancel clears every designation kind in the rectangle.
 */
export function strokeCommand(toolId, rect, mode = 'add') {
  const t = RECT_TOOLS[toolId];
  if (!t) return null;
  const r = { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 };
  if (!t.kind) return { t: 'cancelRect', rect: r, kinds: ['mine', 'chop', 'harvest', 'smooth', 'engrave', 'prospect'] };
  return { t: 'designate', kind: t.kind, rect: r, add: mode !== 'remove' };
}
/** The inverse of a designate stroke (the tool bar's Undo, last 5 s). null when there is none. */
export function undoCommand(cmd) {
  if (!cmd || cmd.t !== 'designate') return null;
  return { ...cmd, rect: { ...cmd.rect }, add: !cmd.add };
}

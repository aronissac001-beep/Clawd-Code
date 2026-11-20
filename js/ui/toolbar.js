// Tool sessions and the tool bar (owner I; doc 10.1 "Tool bar", 10.2, 10.3, 10.11).
// A tool replaces the bottom tabs while it is active: its name, mode chips, Undo (last 5 s) and
// Done; the speed button stays. The shell (shell.js) turns gestures into tile coordinates and
// calls the session: tap(tile), strokeStart(a, erase), strokeMove(b), strokeEnd(cancelled).
// Every change is a command (C3) sent through ctx.send; previews are drawn on the world canvas
// through BUS.draw.overlay (draw(g, s, view)), so the loupe shows them too.
//
// Kinds:  rect   designations, cancel, deconstruct, forbid (Orders)       commit on release
//         carve  Carve hall (pattern and smooth chips)                     pending plan, Done commits
//         stamp  room stamps (floor, furnish, bench chips; drag the door)  pending plan, Done commits
//         place  one structure: tap or drag the ghost (rotate, material)   commit on release
//         line   wall lines                                                commit on release
//         floor  floor rectangles                                          commit on release
//         zone   stockpile new / expand / shrink, delete by tap            commit on release
//         paste  a copied room at the finger (rotate)                      commit on release
//         pick   Haul, Hunt, Tame (Orders): tap a stack or an animal; the nearest colonist who
//                does that work takes it first (the prioritise command)        commit on tap
//         vert   Stairs, Ramp, Channel (Orders; Stage Z1, a map with levels)  Stairs: pending, Done
//                commits (tap = a 1 x 1 stair, drag = up to 3 x 3); Ramp, Channel: commit on release
// Levels (Stage Z1, EMBERCROWN-FORTRESS.md 4.4): every tool works on the view level (ctx.z(); rect.z in the
// commands). A "Levels" chip on Mine, Carve hall and Channel opens a row of 1 | 2 | 3 | 5 levels with Down | Up
// (Channel: down only); a change after a stroke re-applies that stroke with the new count. Stairs show their
// depth row at once (Down 1 | 2 | 3 | 5 | 10, Up 1 | 2 | 3) and remember the last depth (UI memory). With
// Levels above 1, "Cancel all levels" clears the last stroke on every level of its stack. The row is t.row().
// On a D = 1 map no command carries z, levels or dir, so the Stage 2.9 commands are byte-identical.
import { TILE, W, PLANE, idx, TER_MINEABLE } from '../game/core/grid.js';
import { CANCEL_KINDS } from '../game/core/commands.js';
import { stackPlan, stackLabel } from '../game/tools/levels.js';
import { WORK_IDS } from '../game/core/schema.js';
import { def, all, structDef } from '../game/core/content.js';
import { rectOf, rectLabel, strokeCommand, undoCommand, RECT_TOOLS } from '../game/tools/rect.js';
import { linePath, rectPath, lineLabel } from '../game/tools/line.js';
import { ghost, placeShape, anchorFor, nextRot, matChoices, floorChoices, costText, needsText, NEEDS_FLOOR } from '../game/tools/place.js';
import { stampPlan, stampCommand, stampLabel, snapDoor, benchDefs } from '../game/tools/stamp.js';
import { carvePlan, carveCommand, carveLabel, CARVE_PATTERNS } from '../game/tools/carve.js';
import { pastePlan, pasteCommand, pasteAnchor, templateById } from '../game/tools/copy.js';
import { planUnsupported } from '../game/world/support.js';
import { availableIn } from '../data/schema.js';
import { STAGE } from './stage.js';

const T = TILE;
const UNDO_MS = 5000;
const now = () => performance.now();

const ZONE_NAMES = { stockpile: 'Stockpile', grow: 'Grow zone', pen: 'Pen', dump: 'Dump', home: 'Home area', burial: 'Burial', area: 'Allowed area' };
const ZONE_HINT = { pen: 'Fence it in; tamed animals live here', dump: 'Haulers take chunks and corpses here', home: 'Colonists fight fires here first' };
/** Tap tools of the Orders menu: the target, the work type and the words for the toast. */
export const PICK_TOOLS = Object.freeze({
  haul: { name: 'Haul', work: 'haul', workName: 'hauling', verb: 'haul', miss: 'Tap a stack on the ground.', hint: 'Haul: tap a stack and the nearest hauler carries it next' },
  hunt: { name: 'Hunt', work: 'animals', workName: 'animal work', verb: 'hunt', miss: 'Tap a wild animal.', hint: 'Hunt: tap a wild animal. Boars and wolves fight back' },
  tame: { name: 'Tame', work: 'animals', workName: 'animal work', verb: 'tame', miss: 'Tap a wild animal.', hint: 'Tame: tap a wild animal. It needs a pen with room' },
});
/** Zone presets of the stockpile (items.js zonePreset), data order. */
export const presets = () => all('zonePreset');
/** The Orders tools of a map with levels (4.4). */
export const VERT_TOOLS = Object.freeze({
  stairs: { name: 'Stairs', hint: 'Stairs: tap a tile for a 1 x 1 stair (drag for up to 3 x 3), pick the depth, then Done' },
  ramp: { name: 'Ramp', hint: 'Ramp: drag over rock beside open floor. A ramp joins this level to the one above' },
  channel: { name: 'Channel', hint: 'Channel: drag over floor. It opens the floor to the level below, top first' },
});
/** Depth chips of the Stairs tool: [levels below or above the view level, dir]. */
export const STAIR_DEPTHS = Object.freeze([[1, 'down'], [2, 'down'], [3, 'down'], [5, 'down'], [10, 'down'], [1, 'up'], [2, 'up'], [3, 'up']]);
export const LEVEL_COUNTS = Object.freeze([1, 2, 3, 5]);
/** UI memory of the level tools (never saved): the Stairs depth is remembered across sessions (4.4). */
export const LEVEL_MEM = { stairs: { n: 1, dir: 'down' } };
const VERT_CANCEL = ['stairs', 'ramp', 'channel'];
export const presetName = (id) => { const p = def('zonePreset', id); return p ? p.name : 'All'; };

/**
 * Create a tool session.
 * @param {object} spec  { kind, id?, def?, mat?, rot?, stamp?, preset?, zoneId?, op?, templateId?, pattern? }
 * @param {object} ctx   shell context: { s, send(cmd) -> res, toast(text, tone), redraw(), endTool() }
 */
export function createTool(spec, ctx) {
  const s = ctx.s;
  const t = {
    kind: spec.kind, spec, mode: 'add', stroke: null, pending: null, undo: null, risky: false,
    name: '', chips: () => [], ...spec,
  };
  const undoable = (cmds) => { t.undo = cmds && cmds.length ? { cmds, until: now() + UNDO_MS } : null; ctx.refreshBar(); if (t.undo) setTimeout(() => ctx.refreshBar(), UNDO_MS + 60); };
  t.canUndo = () => !!(t.undo && now() < t.undo.until) || !!t.pending;
  t.doUndo = () => {
    if (t.pending) { t.pending = null; ctx.toast('Plan cleared.'); ctx.redraw(); ctx.refreshBar(); return; }
    if (!t.undo || now() >= t.undo.until) return;
    for (const c of t.undo.cmds) ctx.send(c);
    t.undo = null; ctx.toast('Undone.'); ctx.refreshBar(); ctx.redraw();
  };
  const sendOk = (cmd, inverse) => {
    const r = ctx.send(cmd);
    if (r && r.ok) undoable(inverse ? inverse(r) : null);
    return r;
  };
  const deconIds = (r) => (r && r.ids && r.ids.length ? [{ t: 'deconstruct', ids: r.ids.slice() }] : []);
  // ---- levels (Stage Z1): the view level and the Levels chip ----------------------------------------
  const deep = !!ctx.deep;
  const zv = () => (deep && ctx.z ? ctx.z() : 0);
  /** A rect for a command: with levels, on the view level. */
  const zr = (r) => (deep ? { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, z: zv() } : r);
  t.lv = { n: 1, dir: 'down', open: false, last: null };
  /** The Levels chip (Mine, Carve hall, Channel): it opens or closes the row. */
  const levelsChip = (canUp = true) => ({ id: 'levels', icon: 'up', label: t.lv.n > 1 ? `Levels ${t.lv.n}${canUp && t.lv.dir === 'up' ? ' Up' : ''}` : 'Levels', on: t.lv.open || t.lv.n > 1, act: () => { t.lv.open = !t.lv.open; ctx.refreshBar(); } });
  /** The row under the Levels chip: counts, Down | Up, and Cancel all levels. onChange re-applies the last stroke. */
  const levelsRow = (canUp, onChange) => {
    if (!t.lv.open) return [];
    const out = LEVEL_COUNTS.map((n) => ({ id: 'lv-' + n, label: String(n), on: t.lv.n === n, act: () => { t.lv.n = n; onChange(); ctx.refreshBar(); ctx.hint(); } }));
    if (canUp) out.push({ id: 'lv-dir', label: t.lv.dir === 'up' ? 'Up' : 'Down', on: t.lv.dir === 'up', act: () => { t.lv.dir = t.lv.dir === 'up' ? 'down' : 'up'; onChange(); ctx.refreshBar(); ctx.hint(); } });
    if (t.lv.n > 1 && t.lv.last) out.push({ id: 'lv-cancel', label: 'Cancel all levels', wide: true, act: () => cancelAllLevels() });
    return out;
  };
  /** Add the view level and the Levels count to a designate or carve command. */
  const withLevels = (cmd, canUp = true) => {
    if (!deep) return cmd;
    cmd.rect = zr(cmd.rect);
    if (t.lv.n > 1) { cmd.levels = t.lv.n; cmd.dir = canUp ? t.lv.dir : 'down'; }
    return cmd;
  };
  function cancelAllLevels() {
    const L0 = t.lv.last;
    if (!L0) return;
    const zs = stackPlan(s, L0.rect, L0.rect.z, L0.kind, L0.levels || 1, L0.dir).zs;
    let n = 0;
    for (const z of zs) { const r = ctx.send({ t: 'cancelRect', rect: { ...L0.rect, z }, kinds: [L0.kind] }, null, true); if (r && r.ok) n += r.n | 0 || 1; }
    t.lv.last = null; t.undo = null;
    ctx.toast(n ? `Cancelled on ${zs.length} levels.` : 'Nothing to cancel there.');
    ctx.refreshBar(); ctx.redraw();
  }
  /** After a Levels change: undo the last stroke and send it again with the new count (Mine 5 x 5 > Levels > 2). */
  const reapply = (apply) => {
    const L0 = t.lv.last;
    if (!L0 || !t.undo || now() >= t.undo.until) return;
    for (const c of t.undo.cmds) ctx.send(c, null, true);
    t.undo = null; t.lv.last = null;
    apply(L0.rect0, false);
  };

  // ---- rect: Orders designations --------------------------------------------------------------
  if (t.kind === 'rect') {
    const tool = RECT_TOOLS[t.id];
    t.name = tool.name;
    const leveled = deep && t.id === 'mine';
    t.row = () => (leveled ? levelsRow(true, () => reapply(apply)) : []);
    t.chips = () => {
      const out = [];
      if (leveled) out.push(levelsChip(true));
      if (tool.cmd !== 'cancel') out.push({ id: 'mode', icon: t.mode === 'add' ? 'plus' : 'minus', label: t.id === 'forbid' ? (t.mode === 'add' ? 'Forbid' : 'Allow') : t.id === 'deconstruct' ? (t.mode === 'add' ? 'Remove' : 'Keep') : (t.mode === 'add' ? 'Add' : 'Remove'), on: t.mode === 'remove', act: () => { t.mode = t.mode === 'add' ? 'remove' : 'add'; ctx.refreshBar(); ctx.hint(); } });
      if (t.id === 'mine') out.push({ id: 'risky', icon: 'alert', label: 'Risky', on: t.risky, act: () => { t.risky = !t.risky; ctx.refreshBar(); ctx.toast(t.risky ? 'Risky mining: tiles that leave a roof unsupported are mined too.' : 'Safe mining: unsupported tiles wait.'); } });
      return out;
    };
    function apply(rect, erase) {
      const mode = erase ? 'remove' : t.mode;
      const cmd = strokeCommand(t.id, rect, mode);
      if (deep) {
        if (cmd.t === 'designate') withLevels(cmd);
        else if (cmd.rect) cmd.rect = zr(cmd.rect);
        // the Cancel tool clears the vertical digs too, once the command spec lists them (A, C3 v3)
        if (cmd.t === 'cancelRect' && tool.cmd === 'cancel') for (const k of VERT_CANCEL) if (CANCEL_KINDS.includes(k)) cmd.kinds.push(k);
      }
      const r = ctx.send(cmd);
      if (!r || !r.ok) return r;
      const inv = [];
      const u = undoCommand(cmd); if (u) inv.push(u);
      if (t.id === 'mine' && t.risky && mode === 'add') { const rc = { t: 'designate', kind: 'risky', rect: cmd.rect, add: true }; if (cmd.levels) { rc.levels = cmd.levels; rc.dir = cmd.dir; } if (ctx.send(rc, null, true).ok) inv.push({ ...rc, add: false }); }
      undoable(inv);
      if (leveled && mode === 'add') t.lv.last = { rect0: rect, rect: cmd.rect, kind: 'mine', levels: cmd.levels || 1, dir: cmd.dir || 'down' };
      t.last = `${tool.name}: ${rectLabel(rect)}`;
      return r;
    }
    t.tap = (tile) => apply(rectOf(tile, tile), false);
    t.strokeStart = (a, erase) => { t.stroke = { a, b: a, rect: rectOf(a, a), erase }; };
    t.strokeMove = (b) => { const st = t.stroke; st.b = b; st.rect = rectOf(st.a, b); };
    t.strokeEnd = (cancelled) => { const st = t.stroke; t.stroke = null; t.stripeKey = null; ctx.setStripes(null); if (!cancelled && st) apply(st.rect, st.erase); };
    t.label = () => (t.stroke ? `${t.stroke.erase || t.mode === 'remove' ? 'Remove: ' : ''}${leveled && t.lv.n > 1 ? stackLabel(stackPlan(s, t.stroke.rect, zv(), 'mine', t.lv.n, t.lv.dir)) : rectLabel(t.stroke.rect)}` : '');
    t.preview = () => {
      if (!t.stroke) return null;
      if (t.id === 'mine' && !t.stroke.erase && t.mode === 'add' && !t.risky) {
        const q = t.stroke.rect, extra = [];
        const key = `${q.x0},${q.y0},${q.x1},${q.y1}`;
        if (t.stripeKey !== key && (q.x1 - q.x0 + 1) * (q.y1 - q.y0 + 1) <= 2500) {
          t.stripeKey = key;
          for (let y = q.y0; y <= q.y1; y++) for (let x = q.x0; x <= q.x1; x++) { const i = idx(x, y, zv()); if (TER_MINEABLE[s.L.terrain[i]]) extra.push(i); }
          ctx.setStripes(planUnsupported(s, { x0: q.x0 - 4, y0: q.y0 - 4, x1: q.x1 + 4, y1: q.y1 + 4 }, extra));
        }
      }
      return { rect: t.stroke.rect, ok: !(t.stroke.erase || t.mode === 'remove') };
    };
    t.hintText = () => `${tool.name}: drag over the map${tool.cmd === 'designate' || tool.cmd === 'forbid' ? '. Long-press then drag to remove' : ''}`;
    return t;
  }

  // ---- carve: Carve hall ----------------------------------------------------------------------
  if (t.kind === 'carve') {
    t.name = 'Carve hall';
    t.pattern = t.pattern || 'natural'; t.smooth = false;
    t.row = () => (deep ? levelsRow(true, () => { replan(); }) : []);
    t.chips = () => [
      ...(deep ? [levelsChip(true)] : []),
      { id: 'pattern', icon: t.pattern === 'prop' ? 'prop' : t.pattern === 'pillar' ? 'pillar' : 'carve', label: CARVE_PATTERNS.find((p) => p.id === t.pattern).short, on: true, act: () => {
        const k = CARVE_PATTERNS.findIndex((p) => p.id === t.pattern); t.pattern = CARVE_PATTERNS[(k + 1) % CARVE_PATTERNS.length].id;
        replan(); ctx.toast(CARVE_PATTERNS.find((p) => p.id === t.pattern).name + ': ' + CARVE_PATTERNS.find((p) => p.id === t.pattern).text); ctx.refreshBar(); } },
      { id: 'smooth', icon: 'stone', label: 'Smooth', on: t.smooth, act: () => { t.smooth = !t.smooth; replan(); ctx.refreshBar(); } },
    ];
    const opts = (rect) => (deep ? { rect: zr(rect), pattern: t.pattern, smooth: t.smooth, levels: t.lv.n, dir: t.lv.dir } : { rect, pattern: t.pattern, smooth: t.smooth });
    const replan = () => { if (t.pending) { t.pending.plan = carvePlan(s, opts(t.pending.rect)); ctx.hint(); ctx.redraw(); } };
    const commit = () => {
      const p = t.pending; if (!p) return null;
      t.pending = null;
      if (!p.plan.ok) { ctx.toast(p.plan.why, 'bad'); return null; }
      const cmd = carveCommand(opts(p.rect));
      return sendOk(cmd, (r) => {
        if (cmd.levels > 1) t.lv.last = { rect0: p.rect, rect: cmd.rect, kind: 'mine', levels: cmd.levels, dir: cmd.dir };
        const inv = [{ t: 'cancelRect', rect: cmd.rect, kinds: ['mine', 'smooth'] }];
        if (cmd.smooth) inv.push({ t: 'cancelRect', rect: { x0: Math.max(0, cmd.rect.x0 - 1), y0: Math.max(0, cmd.rect.y0 - 1), x1: Math.min(W - 1, cmd.rect.x1 + 1), y1: Math.min(s.h - 1, cmd.rect.y1 + 1) }, kinds: ['smooth'] });
        if (r.built && r.built.length) inv.push({ t: 'deconstruct', ids: r.built.slice() });
        return inv;
      });
    };
    t.commit = commit;
    t.tap = () => { if (t.pending) ctx.toast('Drag over the rock to plan another hall, or Done to carve.'); };
    t.strokeStart = (a) => { if (t.pending) commit(); t.stroke = { a, b: a, rect: rectOf(a, a) }; t.pending = { rect: t.stroke.rect, plan: carvePlan(s, opts(t.stroke.rect)) }; };
    t.strokeMove = (b) => { const st = t.stroke; st.b = b; st.rect = rectOf(st.a, b); t.pending = { rect: st.rect, plan: carvePlan(s, opts(st.rect)) }; };
    t.strokeEnd = (cancelled) => { t.stroke = null; if (cancelled) t.pending = null; ctx.refreshBar(); };
    t.label = () => (t.pending ? carveLabel(opts(t.pending.rect), t.pending.plan) + (deep && t.lv.n > 1 ? ` · ${t.lv.n} levels ${t.lv.dir}` : '') : '');
    t.done = () => commit();
    t.draw = (g, view) => { if (t.pending) drawCarve(g, view, t.pending); };
    t.hintText = () => (t.pending ? carveLabel(opts(t.pending.rect), t.pending.plan) + '. Done to carve' : 'Carve hall: drag a rectangle on the rock');
    return t;
  }

  // ---- stamp: room stamps ----------------------------------------------------------------------
  if (t.kind === 'stamp') {
    const sd = def('stamp', t.stamp);
    t.name = sd ? sd.name : 'Room';
    t.furnish = true;
    const floors = floorChoices(s);
    t.floorMat = floors[0].id;
    const walls = matChoices(s, structDef('wall'));
    t.wallMat = (walls.find((m) => m.id === 'wood') || walls[0] || { id: null }).id;
    const benches = sd && sd.bench ? benchDefs().filter((d) => availableIn(d, STAGE) && d.id !== 'campfire') : [];
    t.bench = benches.length ? benches[0].id : null;
    const cyc = (list, cur) => list[(list.findIndex((x) => x.id === cur) + 1) % list.length].id;
    t.chips = () => {
      const out = [];
      if (benches.length) out.push({ id: 'bench', icon: 'saw', label: structDef(t.bench).name.replace(/'s bench$/, ''), on: true, act: () => { t.bench = cyc(benches, t.bench); replan(); ctx.refreshBar(); } });
      else if (sd && sd.furnish && sd.furnish.length) out.push({ id: 'furnish', icon: 'bed', label: 'Furnish', on: t.furnish, act: () => { t.furnish = !t.furnish; replan(); ctx.refreshBar(); } });
      if (walls.length > 1) out.push({ id: 'walls', icon: 'wall', label: (walls.find((m) => m.id === t.wallMat) || walls[0]).name.replace('Any stone', 'Stone'), on: false, act: () => { t.wallMat = cyc(walls, t.wallMat); replan(); ctx.refreshBar(); ctx.toast(`Walls: ${(walls.find((m) => m.id === t.wallMat) || {}).name}`); } });
      if (floors.length > 1) out.push({ id: 'floor', icon: 'floor', label: floors.find((f) => f.id === t.floorMat).name, on: false, act: () => { t.floorMat = cyc(floors, t.floorMat); replan(); ctx.refreshBar(); } });
      return out;
    };
    const opts = (rect, door) => ({ kind: t.stamp, rect, furnish: t.furnish, wallMat: t.wallMat || null, floorMat: t.floorMat === 'wood' ? null : t.floorMat, door: door || null, bench: t.bench });
    const replan = () => { if (t.pending) { t.pending.plan = stampPlan(s, opts(t.pending.rect, t.pending.door)); ctx.hint(); ctx.redraw(); } };
    const commit = () => {
      const p = t.pending; if (!p) return null;
      t.pending = null;
      if (!p.plan.ok) { ctx.toast(p.plan.why, 'bad'); return null; }
      const o = opts(p.rect, p.door);
      return sendOk(stampCommand(o, p.plan), (r) => { const inv = deconIds(r); if (r.zoneId) inv.push({ t: 'zone', op: 'delete', zoneId: r.zoneId }); return inv; });
    };
    t.commit = commit;
    t.tap = (tile) => {
      if (t.pending && t.pending.plan.door && Math.max(Math.abs(tile.x - t.pending.plan.door.x), Math.abs(tile.y - t.pending.plan.door.y)) <= 1) { ctx.toast('Drag the door marker along a wall to move it.'); return; }
      if (t.pending) ctx.toast('Done builds this room. Drag elsewhere for another.');
      else ctx.toast(`Drag a rectangle for the ${t.name.toLowerCase()} (at least 3 x 3).`);
    };
    t.strokeStart = (a) => {
      const p = t.pending;
      if (p && p.plan.door && Math.max(Math.abs(a.x - p.plan.door.x), Math.abs(a.y - p.plan.door.y)) <= 1) { t.stroke = { door: true }; return; }
      if (p) commit();
      t.stroke = { a, b: a, rect: rectOf(a, a) };
      t.pending = { rect: t.stroke.rect, door: null, plan: stampPlan(s, opts(t.stroke.rect, null)) };
    };
    t.strokeMove = (b) => {
      const st = t.stroke;
      if (st.door) { const d = snapDoor(t.pending.plan.q, b.x, b.y); if (d) { t.pending.door = d; replan(); } return; }
      st.b = b; st.rect = rectOf(st.a, b);
      t.pending = { rect: st.rect, door: null, plan: stampPlan(s, opts(st.rect, null)) };
    };
    t.strokeEnd = (cancelled) => { const st = t.stroke; t.stroke = null; if (cancelled && st && !st.door) t.pending = null; ctx.refreshBar(); };
    t.label = () => (t.pending ? stampLabel(opts(t.pending.rect, t.pending.door), t.pending.plan) : '');
    t.done = () => commit();
    t.draw = (g, view) => { if (t.pending) drawStamp(g, view, t.pending.plan); };
    t.hintText = () => {
      if (!t.pending) return `${t.name}: drag a rectangle (at least 3 x 3)`;
      const p = t.pending.plan;
      return p.ok ? `${stampLabel(opts(t.pending.rect, t.pending.door), p)}${Object.keys(p.need).length ? '. ' + needsText(p.need) : ''}` : stampLabel(opts(t.pending.rect), p);
    };
    return t;
  }

  // ---- place / line / floor: one structure def --------------------------------------------------
  if (t.kind === 'place') {
    const d = structDef(t.def);
    t.name = d.name;
    t.rot = 0;
    const mats = matChoices(s, d);
    t.mat = mats.length ? (mats.find((m) => m.id === 'wood') || mats[0]).id : null;
    const shape = placeShape(d);
    t.shape = shape;
    t.chips = () => {
      const out = [];
      if (nextRot(d, 0) !== 0) out.push({ id: 'rotate', label: 'Rotate', icon: 'rotate', on: false, act: () => { t.rot = nextRot(d, t.rot); if (t.ghost) t.ghost = at(t.ghost.tile); ctx.redraw(); } });
      if (mats.length > 1) out.push({ id: 'mat', icon: 'wall', label: (mats.find((m) => m.id === t.mat) || mats[0]).name.replace('Any stone', 'Stone'), on: false, act: () => { t.mat = mats[(mats.findIndex((m) => m.id === t.mat) + 1) % mats.length].id; ctx.refreshBar(); ctx.hint(); } });
      return out;
    };
    const at = (tile) => { const a = anchorFor(d, tile, t.rot); return { tile, ...a, ...ghost(s, t.def, a.x, a.y, t.rot, deep ? zv() : null) }; };
    const placeAt = (tile) => {
      const g0 = at(tile);
      if (deep && g0.why === NEEDS_FLOOR) { ctx.toast(NEEDS_FLOOR + '.', 'bad'); return null; }   // 4.4: never over open air
      const cmd = { t: 'place', def: t.def, x: g0.x, y: g0.y, rot: t.rot };
      if (deep) cmd.z = zv();
      if (t.mat) cmd.mat = t.mat;
      return sendOk(cmd, (r) => (r.id !== undefined ? [{ t: 'deconstruct', ids: [r.id] }] : []));
    };
    const placePath = (path) => {
      if (path.length === 1) return placeAt({ x: path[0][0], y: path[0][1] });
      const cmd = { t: 'placeLine', def: t.def, path };
      if (t.mat) cmd.mat = t.mat;
      return sendOk(cmd, deconIds);
    };
    t.tap = (tile) => { t.ghost = null; placeAt(tile); };
    t.strokeStart = (a) => {
      if (shape === 'single') { t.stroke = { single: true }; t.ghost = at(a); return; }
      t.stroke = { a, b: a, path: [[a.x, a.y]], rect: rectOf(a, a) };
    };
    t.strokeMove = (b) => {
      const st = t.stroke;
      if (st.single) { t.ghost = at(b); return; }
      st.b = b;
      if (shape === 'line') st.path = linePath(st.a, b);
      else { st.rect = rectOf(st.a, b); st.path = rectPath(st.rect); }
      st.ghosts = st.path.map(([x, y]) => ({ i: idx(x, y, zv()), ok: !ghost(s, t.def, x, y, 0, deep ? zv() : null).why }));
    };
    t.strokeEnd = (cancelled) => {
      const st = t.stroke; t.stroke = null;
      if (cancelled || !st) { t.ghost = null; return; }
      if (st.single) { const g0 = t.ghost; t.ghost = null; if (g0) placeAt(g0.tile); return; }
      placePath(st.path);
    };
    t.label = () => {
      const st = t.stroke;
      if (!st) return '';
      if (st.single) return t.ghost ? (t.ghost.ok ? d.name : t.ghost.why) : '';
      return shape === 'line' ? `${d.name}: ${lineLabel(st.path)}` : `${d.name}: ${rectLabel(st.rect)}`;
    };
    t.draw = (g, view) => {
      const st = t.stroke;
      if (t.ghost) drawGhost(g, view, t.ghost.tiles, t.ghost.ok, d);
      else if (st && st.ghosts) for (const q of st.ghosts) tileBox(g, view, q.i, q.ok ? OK_FILL : BAD_FILL, q.ok ? OK_LINE : BAD_LINE);
    };
    t.hintText = () => `${d.name}: ${shape === 'line' ? 'drag a line' : shape === 'rect' ? 'drag an area' : 'tap or drag to place'}. ${costText(d, t.mat === null && d.costByMat ? null : t.mat || undefined)}`;
    return t;
  }

  // ---- zone: stockpiles ----------------------------------------------------------------------------
  if (t.kind === 'zone') {
    t.op = t.op || 'new';
    t.type = t.type || 'stockpile';
    t.preset = t.preset || (t.type === 'dump' ? 'dump' : 'all');
    const grow = t.type === 'grow', stock = t.type === 'stockpile';
    const cropList = grow ? all('plant').filter((p) => p.sow) : [];
    t.crop = t.crop || (cropList[0] ? cropList[0].id : null);
    const names = { new: ZONE_NAMES[t.type] || 'Zone', expand: 'Expand zone', shrink: 'Shrink zone', delete: 'Delete zone' };
    t.name = names[t.op];
    // levels (4.4): "Add to zone: Main store" when a zone of this type already exists (on any level)
    const same = deep && t.op === 'new' ? s.zones.filter((z) => z.type === t.type) : [];
    t.chips = () => {
      if (t.op === 'expand' && t.addTo) return [{ id: 'addto', icon: 'crate', label: `Add to ${t.addTo.name || 'zone'}`, on: true, act: () => { t.op = 'new'; t.zoneId = null; t.addTo = null; t.name = names.new; ctx.refreshBar(); ctx.hint(); } }];
      if (t.op !== 'new') return [];
      if (same.length) {
        const z0 = same[same.length - 1];
        const add = { id: 'addto', icon: 'crate', label: `Add to ${z0.name || 'zone'}`, on: false, act: () => { t.op = 'expand'; t.zoneId = z0.id; t.addTo = z0; t.name = `Add to ${z0.name || 'zone'}`; ctx.refreshBar(); ctx.hint(); } };
        const base = grow || stock ? null : add;
        if (base) return [base];
      }
      if (grow && cropList.length > 1) return [{ id: 'crop', icon: 'farm', label: (def('plant', t.crop) || { name: 'Crop' }).name, on: true, act: () => { t.crop = cropList[(cropList.findIndex((p) => p.id === t.crop) + 1) % cropList.length].id; ctx.refreshBar(); ctx.hint(); } }];
      if (!stock) return [];
      const pre = [{ id: 'preset', icon: 'crate', label: presetName(t.preset), on: true, act: () => { const ps = presets(); t.preset = ps[(ps.findIndex((p) => p.id === t.preset) + 1) % ps.length].id; ctx.refreshBar(); ctx.hint(); } }];
      if (same.length) { const z0 = same[same.length - 1]; pre.push({ id: 'addto', icon: 'crate', label: `Add to ${z0.name || 'zone'}`, on: false, act: () => { t.op = 'expand'; t.zoneId = z0.id; t.addTo = z0; t.name = `Add to ${z0.name || 'zone'}`; ctx.refreshBar(); ctx.hint(); } }); }
      return pre;
    };
    const newCmd = (rect) => (stock || t.type === 'dump' ? { t: 'zone', op: 'new', type: t.type, rect: zr(rect), preset: t.preset } : { t: 'zone', op: 'new', type: t.type, rect: zr(rect) });
    const zoneUnder = (tile) => s.L.zone[idx(tile.x, tile.y, zv())] || 0;
    const apply = (rect, erase, start) => {
      if (t.op === 'delete') {
        const z = zoneUnder(start);
        if (!z) { ctx.toast('Tap a zone to delete it.'); return null; }
        return ctx.send({ t: 'zone', op: 'delete', zoneId: z }, 'Zone deleted.');
      }
      if (t.op === 'new' && !erase) {
        const r0 = sendOk(newCmd(rect), (r) => { if (r.zoneId) { t.lastZone = r.zoneId; return [{ t: 'zone', op: 'delete', zoneId: r.zoneId }]; } return []; });
        // the crop chip: a new grow zone sows that crop (zoneCfg; hearthroot is the default)
        if (grow && r0 && r0.ok && r0.zoneId && t.crop && t.crop !== 'hearthroot') ctx.send({ t: 'zoneCfg', zoneId: r0.zoneId, patch: { crop: t.crop } }, null, true);
        return r0;
      }
      let zid = t.zoneId || zoneUnder(start) || 0;
      if (!zid) {   // the zone with the most tiles under the rectangle (lowest id on a tie), else the last one made
        const n = new Map();
        for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++) { const z = s.L.zone[idx(x, y, zv())]; if (z) n.set(z, (n.get(z) || 0) + 1); }
        let best = 0, bn = 0;
        for (const [z, k] of [...n].sort((a, b) => a[0] - b[0])) if (k > bn) { bn = k; best = z; }
        zid = best || t.lastZone || 0;
      }
      if (!zid || !s.zones.some((z) => z.id === zid)) { ctx.toast('Start the drag on the zone to change.'); return null; }
      const op = erase || t.op === 'shrink' ? 'shrink' : 'expand';
      const zrect = zr(rect);
      return sendOk({ t: 'zone', op, zoneId: zid, rect: zrect }, () => [{ t: 'zone', op: op === 'expand' ? 'shrink' : 'expand', zoneId: zid, rect: zrect }]);
    };
    t.tap = (tile) => apply(rectOf(tile, tile), false, tile);
    t.strokeStart = (a, erase) => { t.stroke = { a, b: a, rect: rectOf(a, a), erase }; };
    t.strokeMove = (b) => { const st = t.stroke; st.b = b; st.rect = rectOf(st.a, b); };
    t.strokeEnd = (cancelled) => { const st = t.stroke; t.stroke = null; if (!cancelled && st) apply(st.rect, st.erase, st.a); };
    t.label = () => (t.stroke ? `${t.stroke.erase || t.op === 'shrink' ? 'Shrink: ' : ''}${rectLabel(t.stroke.rect)}` : '');
    t.preview = () => (t.stroke && t.op !== 'delete' ? { rect: t.stroke.rect, ok: !(t.stroke.erase || t.op === 'shrink') } : null);
    t.overlay = 'zones';
    t.hintText = () => (t.op === 'new' ? (grow ? `Grow zone: drag over grass or soil. Growers sow ${(def('plant', t.crop) || { name: 'hearthroot' }).name.toLowerCase()}` : stock ? `Stockpile (${presetName(t.preset)}): drag an area` : `${t.name}: drag an area. ${ZONE_HINT[t.type] || ''}`) : t.op === 'delete' ? 'Tap a zone to delete it' : `${t.name}: drag from the zone`);
    return t;
  }

  // ---- pick: Haul, Hunt, Tame by tap -------------------------------------------------------------------
  if (t.kind === 'pick') {
    const P = PICK_TOOLS[t.id];
    t.name = P.name;
    t.chips = () => [];
    const target = (tile) => {
      const wx = (tile.x + 0.5) * T, wy = (tile.y + 0.5) * T;
      if (t.id === 'haul') { const i = s.rt.itemAt ? s.rt.itemAt[idx(tile.x, tile.y)] : -1; const it = i >= 0 ? s.items[i] : null; return it && !it.f ? { id: it.id, kind: 'item', at: [wx, wy], name: (def('item', it.k) || { name: it.k }).name } : null; }
      let best = null, bd = (1.4 * T) ** 2;
      for (const a of s.anim) {
        if (t.id === 'tame' && a.tame) continue;
        if (t.id === 'hunt' && a.tame) continue;
        const d = (a.x - wx) ** 2 + (a.y - wy) ** 2; if (d < bd) { bd = d; best = a; }
      }
      return best ? { id: best.id, kind: 'anim', at: [best.x, best.y], name: (def('animal', best.kind) || { name: best.kind }).name } : null;
    };
    t.tap = (tile) => {
      const tg = target(tile);
      if (!tg) { ctx.toast(P.miss); return null; }
      const k = WORK_IDS.indexOf(P.work);
      let col = null, bd = Infinity;
      for (const c of s.col) {
        if (c.drafted || c.hp.dead || c.hp.down || c.prio[k] === 0) continue;
        const d = (c.x - tg.at[0]) ** 2 + (c.y - tg.at[1]) ** 2; if (d < bd) { bd = d; col = c; }
      }
      if (!col) { ctx.toast(`Nobody does ${P.workName} now: give someone a role with it (Colony > Work).`, 'bad'); return null; }
      return ctx.send({ t: 'prioritise', colId: col.id, target: { id: tg.id, kind: tg.kind }, work: P.work }, `${col.name.split(' ')[0]} will ${P.verb} the ${tg.name.toLowerCase()}.`);
    };
    t.strokeStart = () => { t.stroke = { pan: true }; };
    t.strokeMove = () => {};
    t.strokeEnd = (cancelled) => { t.stroke = null; void cancelled; };
    t.label = () => '';
    t.hintText = () => P.hint;
    return t;
  }

  // ---- vert: Stairs, Ramp, Channel (Stage Z1, 4.4) ---------------------------------------------------------
  if (t.kind === 'vert') {
    const V = VERT_TOOLS[t.id];
    t.name = V.name;
    if (t.id === 'stairs') {
      const mem = LEVEL_MEM.stairs;
      const depthLabel = () => `${mem.dir === 'up' ? 'Up' : 'Down'} ${mem.n}`;
      const plan = (rect) => stackPlan(s, rect, zv(), 'stairs', mem.n + 1, mem.dir);
      t.row = () => STAIR_DEPTHS.map(([n, dir]) => ({ id: `depth-${dir}-${n}`, label: `${dir === 'up' ? 'Up' : 'Down'} ${n}`, on: mem.n === n && mem.dir === dir, act: () => { mem.n = n; mem.dir = dir; if (t.pending) t.pending.plan = plan(t.pending.rect); ctx.refreshBar(); ctx.hint(); ctx.redraw(); } }));
      t.chips = () => [];
      const clamp3 = (a, b) => { const r = rectOf(a, b); return { x0: r.x0, y0: r.y0, x1: Math.min(r.x1, r.x0 + 2), y1: Math.min(r.y1, r.y0 + 2) }; };
      const commit = () => {
        const p = t.pending; if (!p) return null;
        t.pending = null;
        const cmd = { t: 'designate', kind: 'stairs', rect: zr(p.rect), add: true, levels: mem.n + 1, dir: mem.dir };
        const r = ctx.send(cmd, `Stairs ${depthLabel().toLowerCase()} marked.`);
        if (r && r.ok) undoable([{ ...cmd, add: false }]);
        return r;
      };
      t.commit = commit;
      t.tap = (tile) => { const rect = rectOf(tile, tile); t.pending = { rect, plan: plan(rect) }; ctx.refreshBar(); ctx.redraw(); };
      t.strokeStart = (a) => { t.stroke = { a, b: a }; const rect = rectOf(a, a); t.pending = { rect, plan: plan(rect) }; };
      t.strokeMove = (b) => { t.stroke.b = b; const rect = clamp3(t.stroke.a, b); t.pending = { rect, plan: plan(rect) }; };
      t.strokeEnd = (cancelled) => { t.stroke = null; if (cancelled) t.pending = null; ctx.refreshBar(); };
      t.label = () => (t.pending ? `${depthLabel()}: ${stackLabel(t.pending.plan)}` : '');
      t.done = () => commit();
      t.draw = (g, view) => { if (t.pending) drawStack(g, view, t.pending); };
      t.hintText = () => (t.pending ? `Stairs ${depthLabel()}: ${stackLabel(t.pending.plan)}. Done to mark` : V.hint);
      return t;
    }
    // Ramp (the view level) and Channel (Levels, down only): commit on release
    const chan = t.id === 'channel';
    t.row = () => (chan ? levelsRow(false, () => reapply(apply)) : []);
    t.chips = () => [...(chan ? [levelsChip(false)] : []), { id: 'mode', icon: t.mode === 'add' ? 'plus' : 'minus', label: t.mode === 'add' ? 'Add' : 'Remove', on: t.mode === 'remove', act: () => { t.mode = t.mode === 'add' ? 'remove' : 'add'; ctx.refreshBar(); ctx.hint(); } }];
    function apply(rect, erase) {
      const add = !(erase || t.mode === 'remove');
      const cmd = { t: 'designate', kind: t.id, rect: zr(rect), add };
      if (chan && t.lv.n > 1) { cmd.levels = t.lv.n; cmd.dir = 'down'; }
      const r = ctx.send(cmd);
      if (!r || !r.ok) return r;
      undoable([{ ...cmd, rect: { ...cmd.rect }, add: !add }]);
      if (chan && add) t.lv.last = { rect0: rect, rect: cmd.rect, kind: 'channel', levels: cmd.levels || 1, dir: 'down' };
      return r;
    }
    t.tap = (tile) => apply(rectOf(tile, tile), false);
    t.strokeStart = (a, erase) => { t.stroke = { a, b: a, rect: rectOf(a, a), erase }; };
    t.strokeMove = (b) => { const st = t.stroke; st.b = b; st.rect = rectOf(st.a, b); };
    t.strokeEnd = (cancelled) => { const st = t.stroke; t.stroke = null; if (!cancelled && st) apply(st.rect, st.erase); };
    t.label = () => (t.stroke ? `${t.stroke.erase || t.mode === 'remove' ? 'Remove: ' : ''}${chan && t.lv.n > 1 ? stackLabel(stackPlan(s, t.stroke.rect, zv(), 'channel', t.lv.n, 'down')) : rectLabel(t.stroke.rect)}` : '');
    t.preview = () => (t.stroke ? { rect: t.stroke.rect, ok: !(t.stroke.erase || t.mode === 'remove') } : null);
    t.hintText = () => V.hint + (chan && t.lv.n > 1 ? ` (${t.lv.n} levels)` : '');
    return t;
  }

  // ---- paste: a copied room -------------------------------------------------------------------------
  if (t.kind === 'paste') {
    const tm = templateById(s, t.templateId);
    t.name = tm ? `Paste ${tm.name}` : 'Paste';
    t.rot = 0;
    t.chips = () => [{ id: 'rotate', label: 'Rotate', icon: 'rotate', on: false, act: () => { t.rot = (t.rot + 1) & 3; if (t.ghost) t.ghost = at(t.ghost.tile); ctx.redraw(); } }];
    const at = (tile) => { const a = pasteAnchor(tm, tile, t.rot); return { tile, ...a, plan: pastePlan(s, tm, a.x, a.y, t.rot) }; };
    const put = (tile) => { const g0 = at(tile); if (!g0.plan.ok) { ctx.toast(g0.plan.why, 'bad'); return null; } return sendOk(pasteCommand(tm, g0.x, g0.y, t.rot), deconIds); };
    t.tap = (tile) => { t.ghost = null; put(tile); };
    t.strokeStart = (a) => { t.stroke = { single: true }; t.ghost = at(a); };
    t.strokeMove = (b) => { t.ghost = at(b); };
    t.strokeEnd = (cancelled) => { const g0 = t.ghost; t.ghost = null; t.stroke = null; if (!cancelled && g0) put(g0.tile); };
    t.label = () => (t.ghost ? `${t.ghost.plan.n} of ${t.ghost.plan.cells.length} parts fit` : '');
    t.draw = (g, view) => { if (t.ghost) for (const c of t.ghost.plan.cells) for (const i of c.tiles) tileBox(g, view, i, c.ok ? (c.wall ? WALL_FILL : OK_FILL) : BAD_FILL, c.ok ? OK_LINE : BAD_LINE); };
    t.hintText = () => (tm ? `${t.name}: tap or drag to place. Rotate turns it` : 'That room template is gone');
    return t;
  }
  throw new Error(`toolbar: unknown tool kind ${t.kind}`);
}

// ---- preview drawing (world units; view.z is the zoom) ------------------------------------------------
const OK_FILL = 'rgba(120,230,120,0.30)', OK_LINE = 'rgba(170,255,170,0.95)';
const BAD_FILL = 'rgba(240,80,70,0.38)', BAD_LINE = 'rgba(255,130,120,0.95)';
const WALL_FILL = 'rgba(214,160,80,0.55)', WALL_LINE = 'rgba(255,214,140,0.95)';
const FLOOR_FILL = 'rgba(150,200,255,0.20)';
const FURN_FILL = 'rgba(120,230,190,0.42)', FURN_LINE = 'rgba(180,255,220,0.95)';
function tileBox(g, view, i, fill, line) {
  const p = i % PLANE, x = (p % W) * T, y = ((p / W) | 0) * T, k = 1 / view.z;
  if (fill) { g.fillStyle = fill; g.fillRect(x, y, T, T); }
  if (line) { g.strokeStyle = line; g.lineWidth = 1.5 * k; g.strokeRect(x + 1, y + 1, T - 2, T - 2); }
}
function drawGhost(g, view, tiles, ok, d) {
  if (!tiles.length) return;
  for (const i of tiles) tileBox(g, view, i, ok ? OK_FILL : BAD_FILL, null);
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const i0 of tiles) { const i = i0 % PLANE, x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const k = 1 / view.z;
  g.strokeStyle = ok ? OK_LINE : BAD_LINE; g.lineWidth = 2.5 * k;
  g.strokeRect(x0 * T + 1, y0 * T + 1, (x1 - x0 + 1) * T - 2, (y1 - y0 + 1) * T - 2);
  label(g, view, d ? d.name.charAt(0) : '', (x0 + x1 + 1) / 2 * T, (y0 + y1 + 1) / 2 * T);
}
function label(g, view, text, cx, cy) {
  if (!text) return;
  g.save();
  g.font = `700 ${Math.round(14)}px -apple-system, system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(20,16,20,0.85)'; g.fillText(text, cx + 1, cy + 1);
  g.fillStyle = '#fff6dc'; g.fillText(text, cx, cy);
  g.restore();
}
function outline(g, view, q, color, dash) {
  const k = 1 / view.z;
  g.save(); g.strokeStyle = color; g.lineWidth = 2.5 * k;
  if (dash) g.setLineDash([6 * k, 5 * k]);
  g.strokeRect(q.x0 * T, q.y0 * T, (q.x1 - q.x0 + 1) * T, (q.y1 - q.y0 + 1) * T);
  g.restore();
}
function drawStamp(g, view, plan) {
  const k = 1 / view.z;
  outline(g, view, plan.q, plan.ok ? 'rgba(255,214,140,0.9)' : BAD_LINE, true);
  if (!plan.inner) return;
  for (const f of plan.floors) tileBox(g, view, f.i, f.ok ? FLOOR_FILL : BAD_FILL, null);
  for (const w of plan.walls) {
    if (w.st === 'new') tileBox(g, view, w.i, WALL_FILL, WALL_LINE);
    else if (w.st === 'blocked') tileBox(g, view, w.i, BAD_FILL, BAD_LINE);
    else tileBox(g, view, w.i, null, 'rgba(255,214,140,0.35)');
  }
  for (const f of plan.furniture) {
    if (!f.tiles.length) continue;
    const d = structDef(f.def);
    for (const i of f.tiles) tileBox(g, view, i, f.ok ? FURN_FILL : BAD_FILL, null);
    const x0 = f.x * T, y0 = f.y * T;
    const [w, h] = (f.rot & 1) ? [(d.size || [1, 1])[1], (d.size || [1, 1])[0]] : (d.size || [1, 1]);
    g.strokeStyle = FURN_LINE; g.lineWidth = 2 * k; g.strokeRect(x0 + 2, y0 + 2, w * T - 4, h * T - 4);
    label(g, view, d ? d.name.charAt(0) : '?', x0 + (w * T) / 2, y0 + (h * T) / 2);
  }
  if (plan.door) {
    // the door marker: a brass door with a ring that says "drag me"
    const x = plan.door.x * T, y = plan.door.y * T;
    g.fillStyle = plan.door.ok ? 'rgba(242,176,78,0.95)' : BAD_FILL;
    g.fillRect(x + 6, y + 3, T - 12, T - 6);
    g.fillStyle = '#3a2414'; g.beginPath(); g.arc(x + T - 11, y + T / 2, 2.4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,240,200,0.95)'; g.lineWidth = 2.5 * k;
    g.beginPath(); g.arc(x + T / 2, y + T / 2, T * 0.72, 0, Math.PI * 2); g.stroke();
  }
}
function drawCarve(g, view, p) {
  const plan = p.plan, k = 1 / view.z;
  for (const i of plan.mine) tileBox(g, view, i, 'rgba(255,214,120,0.30)', null);
  for (const i of plan.smooth) tileBox(g, view, i, null, 'rgba(190,220,255,0.7)');
  for (const i0 of plan.keep) {
    const i = i0 % PLANE, x = (i % W + 0.5) * T, y = (((i / W) | 0) + 0.5) * T;
    g.fillStyle = 'rgba(70,60,80,0.95)'; g.beginPath(); g.arc(x, y, T * 0.4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,214,140,0.95)'; g.lineWidth = 2.5 * k; g.stroke();
  }
  for (const i0 of plan.built) {
    const i = i0 % PLANE, x = (i % W + 0.5) * T, y = (((i / W) | 0) + 0.5) * T;
    g.fillStyle = 'rgba(150,200,255,0.85)'; g.beginPath(); g.arc(x, y, T * 0.34, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(20,30,50,0.9)'; g.lineWidth = 2 * k; g.stroke();
  }
  outline(g, view, plan.q, plan.ok ? 'rgba(255,214,140,0.95)' : BAD_LINE, true);
}
/** A Stairs plan (4.4): the footprint, the depth and the red end mark where the stack stops. */
function drawStack(g, view, p) {
  const q = p.rect, k = 1 / view.z;
  const stop = p.plan.stop !== null;
  g.save();
  g.fillStyle = 'rgba(242,176,78,0.30)';
  g.fillRect(q.x0 * T, q.y0 * T, (q.x1 - q.x0 + 1) * T, (q.y1 - q.y0 + 1) * T);
  outline(g, view, q, stop ? BAD_LINE : 'rgba(255,214,140,0.95)', true);
  const n = p.plan.zs.length - 1;
  label(g, view, n > 0 ? `${n}` : '0', (q.x0 + q.x1 + 1) / 2 * T, (q.y0 + q.y1 + 1) / 2 * T);
  if (stop) {   // the red end mark: an X in the corner
    const x = (q.x1 + 1) * T - 10, y = q.y0 * T + 10;
    g.strokeStyle = BAD_LINE; g.lineWidth = 3 * k;
    g.beginPath(); g.moveTo(x - 6, y - 6); g.lineTo(x + 6, y + 6); g.moveTo(x + 6, y - 6); g.lineTo(x - 6, y + 6); g.stroke();
  }
  g.restore();
}

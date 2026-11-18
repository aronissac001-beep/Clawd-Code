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
import { TILE, W, idx, TER_MINEABLE } from '../game/core/grid.js';
import { def, all, structDef } from '../game/core/content.js';
import { rectOf, rectLabel, strokeCommand, undoCommand, RECT_TOOLS } from '../game/tools/rect.js';
import { linePath, rectPath, lineLabel } from '../game/tools/line.js';
import { ghost, placeShape, anchorFor, nextRot, matChoices, floorChoices, costText, needsText } from '../game/tools/place.js';
import { stampPlan, stampCommand, stampLabel, snapDoor, benchDefs } from '../game/tools/stamp.js';
import { carvePlan, carveCommand, carveLabel, CARVE_PATTERNS } from '../game/tools/carve.js';
import { pastePlan, pasteCommand, pasteAnchor, templateById } from '../game/tools/copy.js';
import { planUnsupported } from '../game/world/support.js';
import { availableIn } from '../data/schema.js';
import { STAGE } from './stage.js';

const T = TILE;
const UNDO_MS = 5000;
const now = () => performance.now();

/** Zone presets of the stockpile (items.js zonePreset), data order. */
export const presets = () => all('zonePreset');
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

  // ---- rect: Orders designations --------------------------------------------------------------
  if (t.kind === 'rect') {
    const tool = RECT_TOOLS[t.id];
    t.name = tool.name;
    t.chips = () => {
      const out = [];
      if (tool.cmd !== 'cancel') out.push({ id: 'mode', icon: t.mode === 'add' ? 'plus' : 'minus', label: t.id === 'forbid' ? (t.mode === 'add' ? 'Forbid' : 'Allow') : t.id === 'deconstruct' ? (t.mode === 'add' ? 'Remove' : 'Keep') : (t.mode === 'add' ? 'Add' : 'Remove'), on: t.mode === 'remove', act: () => { t.mode = t.mode === 'add' ? 'remove' : 'add'; ctx.refreshBar(); ctx.hint(); } });
      if (t.id === 'mine') out.push({ id: 'risky', icon: 'alert', label: 'Risky', on: t.risky, act: () => { t.risky = !t.risky; ctx.refreshBar(); ctx.toast(t.risky ? 'Risky mining: tiles that leave a roof unsupported are mined too.' : 'Safe mining: unsupported tiles wait.'); } });
      return out;
    };
    const apply = (rect, erase) => {
      const mode = erase ? 'remove' : t.mode;
      const cmd = strokeCommand(t.id, rect, mode);
      const r = ctx.send(cmd);
      if (!r || !r.ok) return r;
      const inv = [];
      const u = undoCommand(cmd); if (u) inv.push(u);
      if (t.id === 'mine' && t.risky && mode === 'add') { const rc = { t: 'designate', kind: 'risky', rect: cmd.rect, add: true }; if (ctx.send(rc, null, true).ok) inv.push({ ...rc, add: false }); }
      undoable(inv);
      t.last = `${tool.name}: ${rectLabel(rect)}`;
      return r;
    };
    t.tap = (tile) => apply(rectOf(tile, tile), false);
    t.strokeStart = (a, erase) => { t.stroke = { a, b: a, rect: rectOf(a, a), erase }; };
    t.strokeMove = (b) => { const st = t.stroke; st.b = b; st.rect = rectOf(st.a, b); };
    t.strokeEnd = (cancelled) => { const st = t.stroke; t.stroke = null; t.stripeKey = null; ctx.setStripes(null); if (!cancelled && st) apply(st.rect, st.erase); };
    t.label = () => (t.stroke ? `${t.stroke.erase || t.mode === 'remove' ? 'Remove: ' : ''}${rectLabel(t.stroke.rect)}` : '');
    t.preview = () => {
      if (!t.stroke) return null;
      if (t.id === 'mine' && !t.stroke.erase && t.mode === 'add' && !t.risky) {
        const q = t.stroke.rect, extra = [];
        const key = `${q.x0},${q.y0},${q.x1},${q.y1}`;
        if (t.stripeKey !== key && (q.x1 - q.x0 + 1) * (q.y1 - q.y0 + 1) <= 2500) {
          t.stripeKey = key;
          for (let y = q.y0; y <= q.y1; y++) for (let x = q.x0; x <= q.x1; x++) { const i = idx(x, y); if (TER_MINEABLE[s.L.terrain[i]]) extra.push(i); }
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
    t.chips = () => [
      { id: 'pattern', icon: t.pattern === 'prop' ? 'prop' : t.pattern === 'pillar' ? 'pillar' : 'carve', label: CARVE_PATTERNS.find((p) => p.id === t.pattern).short, on: true, act: () => {
        const k = CARVE_PATTERNS.findIndex((p) => p.id === t.pattern); t.pattern = CARVE_PATTERNS[(k + 1) % CARVE_PATTERNS.length].id;
        replan(); ctx.toast(CARVE_PATTERNS.find((p) => p.id === t.pattern).name + ': ' + CARVE_PATTERNS.find((p) => p.id === t.pattern).text); ctx.refreshBar(); } },
      { id: 'smooth', icon: 'stone', label: 'Smooth', on: t.smooth, act: () => { t.smooth = !t.smooth; replan(); ctx.refreshBar(); } },
    ];
    const opts = (rect) => ({ rect, pattern: t.pattern, smooth: t.smooth });
    const replan = () => { if (t.pending) { t.pending.plan = carvePlan(s, opts(t.pending.rect)); ctx.hint(); ctx.redraw(); } };
    const commit = () => {
      const p = t.pending; if (!p) return null;
      t.pending = null;
      if (!p.plan.ok) { ctx.toast(p.plan.why, 'bad'); return null; }
      const cmd = carveCommand(opts(p.rect));
      return sendOk(cmd, (r) => {
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
    t.label = () => (t.pending ? carveLabel(opts(t.pending.rect), t.pending.plan) : '');
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
    const at = (tile) => { const a = anchorFor(d, tile, t.rot); return { tile, ...a, ...ghost(s, t.def, a.x, a.y, t.rot) }; };
    const placeAt = (tile) => {
      const g0 = at(tile);
      const cmd = { t: 'place', def: t.def, x: g0.x, y: g0.y, rot: t.rot };
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
      st.ghosts = st.path.map(([x, y]) => ({ i: idx(x, y), ok: !ghost(s, t.def, x, y, 0).why }));
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
    t.preset = t.preset || 'all';
    const grow = t.type === 'grow';
    const names = { new: grow ? 'Grow zone' : 'Stockpile', expand: 'Expand zone', shrink: 'Shrink zone', delete: 'Delete zone' };
    t.name = names[t.op];
    t.chips = () => {
      if (t.op !== 'new' || grow) return [];
      return [{ id: 'preset', icon: 'crate', label: presetName(t.preset), on: true, act: () => { const ps = presets(); t.preset = ps[(ps.findIndex((p) => p.id === t.preset) + 1) % ps.length].id; ctx.refreshBar(); ctx.hint(); } }];
    };
    const zoneUnder = (tile) => s.L.zone[idx(tile.x, tile.y)] || 0;
    const apply = (rect, erase, start) => {
      if (t.op === 'delete') {
        const z = zoneUnder(start);
        if (!z) { ctx.toast('Tap a zone to delete it.'); return null; }
        return ctx.send({ t: 'zone', op: 'delete', zoneId: z }, 'Zone deleted.');
      }
      if (t.op === 'new' && !erase) {
        return sendOk(grow ? { t: 'zone', op: 'new', type: 'grow', rect } : { t: 'zone', op: 'new', type: 'stockpile', rect, preset: t.preset }, (r) => { if (r.zoneId) { t.lastZone = r.zoneId; return [{ t: 'zone', op: 'delete', zoneId: r.zoneId }]; } return []; });
      }
      let zid = t.zoneId || zoneUnder(start) || 0;
      if (!zid) {   // the zone with the most tiles under the rectangle (lowest id on a tie), else the last one made
        const n = new Map();
        for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++) { const z = s.L.zone[idx(x, y)]; if (z) n.set(z, (n.get(z) || 0) + 1); }
        let best = 0, bn = 0;
        for (const [z, k] of [...n].sort((a, b) => a[0] - b[0])) if (k > bn) { bn = k; best = z; }
        zid = best || t.lastZone || 0;
      }
      if (!zid || !s.zones.some((z) => z.id === zid)) { ctx.toast('Start the drag on the zone to change.'); return null; }
      const op = erase || t.op === 'shrink' ? 'shrink' : 'expand';
      return sendOk({ t: 'zone', op, zoneId: zid, rect }, () => [{ t: 'zone', op: op === 'expand' ? 'shrink' : 'expand', zoneId: zid, rect }]);
    };
    t.tap = (tile) => apply(rectOf(tile, tile), false, tile);
    t.strokeStart = (a, erase) => { t.stroke = { a, b: a, rect: rectOf(a, a), erase }; };
    t.strokeMove = (b) => { const st = t.stroke; st.b = b; st.rect = rectOf(st.a, b); };
    t.strokeEnd = (cancelled) => { const st = t.stroke; t.stroke = null; if (!cancelled && st) apply(st.rect, st.erase, st.a); };
    t.label = () => (t.stroke ? `${t.stroke.erase || t.op === 'shrink' ? 'Shrink: ' : ''}${rectLabel(t.stroke.rect)}` : '');
    t.preview = () => (t.stroke && t.op !== 'delete' ? { rect: t.stroke.rect, ok: !(t.stroke.erase || t.op === 'shrink') } : null);
    t.overlay = 'zones';
    t.hintText = () => (t.op === 'new' ? (grow ? 'Grow zone: drag over grass or soil. Growers sow hearthroot.' : `Stockpile (${presetName(t.preset)}): drag an area`) : t.op === 'delete' ? 'Tap a zone to delete it' : `${t.name}: drag from the zone`);
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
  const x = (i % W) * T, y = ((i / W) | 0) * T, k = 1 / view.z;
  if (fill) { g.fillStyle = fill; g.fillRect(x, y, T, T); }
  if (line) { g.strokeStyle = line; g.lineWidth = 1.5 * k; g.strokeRect(x + 1, y + 1, T - 2, T - 2); }
}
function drawGhost(g, view, tiles, ok, d) {
  if (!tiles.length) return;
  for (const i of tiles) tileBox(g, view, i, ok ? OK_FILL : BAD_FILL, null);
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const i of tiles) { const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
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
  for (const i of plan.keep) {
    const x = (i % W + 0.5) * T, y = (((i / W) | 0) + 0.5) * T;
    g.fillStyle = 'rgba(70,60,80,0.95)'; g.beginPath(); g.arc(x, y, T * 0.4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,214,140,0.95)'; g.lineWidth = 2.5 * k; g.stroke();
  }
  for (const i of plan.built) {
    const x = (i % W + 0.5) * T, y = (((i / W) | 0) + 0.5) * T;
    g.fillStyle = 'rgba(150,200,255,0.85)'; g.beginPath(); g.arc(x, y, T * 0.34, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(20,30,50,0.9)'; g.lineWidth = 2 * k; g.stroke();
  }
  outline(g, view, plan.q, plan.ok ? 'rgba(255,214,140,0.95)' : BAD_LINE, true);
}

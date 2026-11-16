'use strict';
// ============================================================================
// ZONEFALL — guided first run. Each step has a mode it applies to, a short
// instruction, a completion test and an optional world target (drawn as a
// bouncing pointer + off-screen arrow). Progress lives in run.tut; finishing
// (or skipping) sets meta.tutDone so later runs start without it.
// ============================================================================

const Tut = {
  t: 0,
  steps: [
    { mode: 'base', text: 'Walk to a tree (left thumb) and HOLD the ✋ button to chop wood.', done: g => g.run.gathered.wood >= 30, target: g => Tut.nearestObj(o => o.type === 'tree') },
    { mode: 'base', text: 'Now mine a boulder for stone — hold ✋ next to it.', done: g => g.run.gathered.stone >= 30, target: g => Tut.nearestObj(o => o.type === 'rock') },
    { mode: 'base', text: 'Tap BUILD → Wooden Wall, then DRAG across the ground to lay a row of walls near your Cupboard.', done: g => Tut.count(s => s.type.startsWith('wall')) >= 5, target: g => Tut.core() },
    { mode: 'base', text: 'Close the box around the Cupboard and add a Wooden Door — you can walk through it, raiders cannot.', done: g => Tut.count(s => s.type.startsWith('door')) >= 1 && Tut.count(s => s.type.startsWith('wall')) >= 9, target: g => Tut.core() },
    { mode: 'base', text: 'Stand at the Cupboard and tap ✋ (or BASE) → Craft → Stone Hatchet. Tools gather much faster.', done: g => Tut.hasItem('hatchet') || Tut.hasItem('salv_axe'), target: g => Tut.core() },
    { mode: 'base', text: 'Tap DEPLOY and pick Pine Outskirts. Bring a gun — check BAG first.', done: g => g.mode === 'zone' },
    { mode: 'zone', text: 'Search containers (they sparkle) and pick up loot. Watch for red ! — enemies have spotted you.', done: g => g.run.looted >= 3, target: g => Tut.nearestContainer() },
    { mode: 'zone', text: 'Get out alive: stand inside a green EXFIL ring for 6 seconds before the Emission.', done: g => g.mode !== 'zone', target: g => Tut.nearestExtract() },
    { mode: 'raid', text: 'Night raid! Raiders target your Cupboard. Shoot them before they break through.', done: g => g.mode === 'base' && g.run.day >= 2 },
  ],
  get idx() { return Game.run ? Game.run.tut : -1; },
  active() { return Game.run && Game.run.tut >= 0 && Game.run.tut < this.steps.length; },
  update(dt) {
    Game.tutTarget = null;
    if (!this.active()) return;
    // a raid can arrive before the zone steps (player skipped the expedition)
    if (Game.mode === 'raid' && this.idx < 8) Game.run.tut = 8;
    const st = this.steps[this.idx]; if (!st) return;
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.25;
      if (st.done(Game)) {
        Game.run.tut++; Sfx.win(); UI.toast('✓ ' + (this.idx >= this.steps.length ? 'Tutorial complete — good luck out there.' : 'Done!'), 'good');
        if (this.idx >= this.steps.length) this.finish();
        UI.updateTut(); return;
      }
      this.tgt = st.mode === Game.mode && st.target ? st.target(Game) : null;
    }
    if (st.mode === Game.mode) Game.tutTarget = this.tgt || null;
  },
  text() {
    if (!this.active()) return '';
    const st = this.steps[this.idx]; if (st.mode !== Game.mode && !(st.mode === 'base' && Game.mode === 'base')) return '';
    return st.text;
  },
  finish() { Game.run.tut = -1; Game.meta.tutDone = true; Save.writeMeta(Game.meta); UI.updateTut(); },
  // ---- helpers
  nearestObj(fn) { const p = Game.player, m = Game.map; let b = null, bd = 1e12; for (const o of m.objs) { if (!fn(o)) continue; const d = dist2(p.x, p.y, o.x, o.y); if (d < bd) { bd = d; b = o; } } return b && { x: b.x, y: b.y }; },
  nearestContainer() { const p = Game.player; let b = null, bd = 1e12; for (const c of Game.map.containers) { if (c.broken || c.type === 'corpse' || (c.items && c.searched >= c.items.length && c.items.length === 0)) continue; const d = dist2(p.x, p.y, c.x, c.y); if (d < bd) { bd = d; b = c; } } return b && { x: b.x, y: b.y }; },
  nearestExtract() { const p = Game.player; let b = null, bd = 1e12; for (const e of Game.map.extracts) { const d = dist2(p.x, p.y, e.x, e.y); if (d < bd) { bd = d; b = e; } } return b && { x: b.x, y: b.y }; },
  core() { const c = Game.map.coreTile; return c && { x: c.tx * TILE + 16, y: c.ty * TILE + 16 }; },
  count(fn) { return Game.map.struct ? Game.map.struct.filter(s => s && fn(s)).length : 0; },
  hasItem(id) { const p = Game.player; return Game.stashCount(id) > 0 || Game.countItem(id) > 0 || (p.equip.melee && p.equip.melee.id === id); },
};

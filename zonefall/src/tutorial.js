// ZONEFALL 3 — first-run objectives (a short guided path through the core loop)
import { G } from './state.js';
import { Sfx } from './audio.js';
import { Save } from './save.js';
import { Build } from './build.js';

const STEPS = [
  { text: 'Hit trees for <b>wood</b>: stand next to one and <b>hold the action button</b> (or swing with the right stick). Get 150 wood.', check: p => p.inv.count('wood') >= 150 },
  { text: 'Hit rocks and ore nodes for <b>stone</b>. Get 100 stone.', check: p => p.inv.count('stone') >= 100 },
  { text: 'Open <b>Craft</b> and make a <b>Stone Hatchet</b> or <b>Pickaxe</b> — they gather much faster. Tap it on your belt to hold it.', ev: 'craft', match: id => id === 'hatchet' || id === 'pickaxe' },
  { text: 'Tap the <b>hammer</b> to build. Place <b>2 foundations</b> next to each other (tap the ground, then PLACE).', check: () => countPieces('foundation') >= 2 },
  { text: 'Surround them: build <b>walls</b> on the edges and one <b>doorway</b>.', check: () => countPieces('wall') + countPieces('window') >= 4 && countPieces('doorway') >= 1 },
  { text: 'Doors tab → put a <b>Wooden Door</b> in the doorway. Walk into it: it swings open and closes behind you.', check: () => G.doors.some(d => d.owner === 'player') },
  { text: 'Items tab → place a <b>Tool Cupboard</b> inside. It claims the land — and raiders will come for it at night.', check: () => !!Build.tc },
  { text: 'Place a <b>Sleeping Bag</b> inside so you respawn at home. Add a <b>Roof</b> to keep the base hidden.', check: () => Build.deploys.some(d => d.type === 'sleeping_bag' || d.type === 'bed') },
  { text: 'Follow a <b>road</b> and <b>smash barrels</b> for scrap and components (3 barrels).', check: () => (G.run.stats.barrels || 0) >= 3 },
  { text: 'Upgrade your walls to <b>wood or stone</b> (hammer → tap a wall → Upgrade all) before night falls.', check: () => [...Build.edges.values()].some(p => p.owner === 'player' && p.tier !== 'twig') },
  { text: 'Survive the night raid: defend your <b>Tool Cupboard</b>.', ev: 'raid' },
];
function countPieces(type) { let n = 0; if (type === 'foundation') { for (const c of Build.cells.values()) if (c.found && c.found.owner === 'player') n++; return n; } for (const p of Build.edges.values()) if (p.owner === 'player' && p.type === type) n++; return n; }

export const Tut = {
  step: 0, done: false,
  start(step) { this.step = step || 0; this.done = this.step < 0; },
  text() { if (this.done || this.step < 0 || !STEPS[this.step]) return ''; return '<span class="n">' + (this.step + 1) + '/' + STEPS.length + '</span><span class="tx">' + STEPS[this.step].text + '</span><span class="sk" id="tut-skip">skip</span>'; },
  tick() {
    if (this.done || !G.player) return; const s = STEPS[this.step]; if (!s) return this.finish();
    if (s.check && s.check(G.player)) this.next();
  },
  event(ev, a) {
    if (ev === 'give' && a === 'scrap') { }
    if (ev === 'barrel') G.run.stats.barrels = (G.run.stats.barrels || 0) + 1;
    if (this.done) return; const s = STEPS[this.step]; if (!s || !s.ev) return;
    if (s.ev === ev && (!s.match || s.match(a))) this.next();
  },
  next() { this.step++; G.run.tut = this.step; Sfx.win(); if (this.step >= STEPS.length) this.finish(); else G.ui.toast('Objective complete', 'good'); },
  finish() { this.done = true; G.run.tut = -1; G.meta.tutDone = true; Save.writeMeta(G.meta); G.ui.toast('You know the basics. Explore the monuments, build up — survive.', 'good'); },
};

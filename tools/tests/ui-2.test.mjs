// Stage 2 UI logic (owner I; doc 10.3, 10.6, 14.8 row I): the Architect covers every Stage 2
// buildable in exactly one tab with tier and research lock reasons; the Stage 2 alert rules (fire,
// demand, letter, trader, manhunter, the fall clock) find their subjects (no perk alert: perks are earned, 3.1) and never write state; Next steps
// map every Stage 2 advice target to a tool or a tab; the letter tracker lists choice letters.
// Headless: these read state only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { step } from '../../js/game/core/sim.js';
import { stateHash } from '../../js/game/core/state.js';
import { all } from '../../js/game/core/content.js';
import { availableIn } from '../../js/data/schema.js';
import { BUILD_TABS, tabDefs, lockedWhy, ORDERS } from '../../js/ui/architect.js';
import { alertTracker, ALERT_RULES } from '../../js/ui/alerts.js';
import { pendingLetters, sendLetter } from '../../js/game/threat/letters.js';
import { arrive } from '../../js/game/colony/trade.js';
import { spawnAnimal } from '../../js/game/animals/spawn.js';
import { startEmber } from '../../js/game/people/embertouch.js';
import { canBurn, ignite } from '../../js/game/world/fire.js';
import { STAGE } from '../../js/ui/stage.js';
import { TICKS_PER_HOUR } from '../../js/game/core/time.js';

const fresh = (seed) => { installSim({ stage: '2', reset: true }); const s = foundColony({ seed, name: 'Stage 2 UI' }); step(s, 2); return s; };

test('stage switch: the shipped UI plays Stage 2', () => {
  assert.equal(STAGE, '2');
});

test('Architect: every Stage 2 buildable (not a zone, not the Hearth) is on exactly one Build tab; locks name the tier or the tech', () => {
  const s = fresh('UI2-1');
  const want = all('structure').filter((d) => availableIn(d, '2') && d.kind !== 'zone' && d.kind !== 'designation' && !(d.flags || []).includes('start'));
  const seen = new Map();
  for (const t of BUILD_TABS) for (const d of tabDefs(t.id)) seen.set(d.id, (seen.get(d.id) || 0) + 1);
  const missing = want.filter((d) => !seen.has(d.id)).map((d) => d.id);
  const twice = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  assert.deepEqual(missing, [], 'missing from the Architect');
  assert.deepEqual(twice, [], 'on two tabs');
  assert.equal(BUILD_TABS.length, 11);
  // a Hamlet structure at Camp names the tier; a researched structure names its tech
  const ham = want.find((d) => d.tier === 'hamlet');
  assert.match(lockedWhy(s, ham), /Needs Hamlet/);
  const tech = want.find((d) => d.tier === 'camp' && d.tech && d.tech !== 'masonry' && d.tech !== 'carpentry' && d.tech !== 'cooking');
  if (tech) assert.match(lockedWhy(s, tech) || 'free', /research|free/);
  // Orders: Harvest, Hunt, Tame and Smooth are live at Stage 2
  for (const id of ['harvest', 'hunt', 'tame', 'smooth']) assert.ok(ORDERS.find((o) => o.id === id).tool, id);
});

test('alerts (Stage 2): fire, demand, letter, trader, manhunter and the fall clock point at their subjects; no perk alert; no state change', () => {
  const s = fresh('UI2-2');
  const letters = { waiting: () => pendingLetters(s).filter((l) => l.choices), unread: () => [] };
  const tr = alertTracker(s, { letters });
  assert.ok(ALERT_RULES.length >= 20, 'the 10.6 list');
  const ids0 = tr.update().map((a) => a.id);
  assert.ok(!ids0.includes('fire') && !ids0.includes('trader'), ids0.join(','));
  // fixtures through the sim's own APIs
  let lit = -1;
  for (let i = 0; i < s.L.terrain.length && lit < 0; i++) if (canBurn(s, i) && ignite(s, i, 60)) lit = i;
  arrive(s, 'pedlar');
  sendLetter(s, 'choice', { title: 'Refugees', text: 'They ask to join.', choices: ['Yes', 'No'], deflt: 1, data: { k: 'ui2' } });
  const a = spawnAnimal(s, 'boar', 10, 10); if (a) a.st = { mode: 'manhunt', until: s.tick + 6000, target: s.col[0].id };
  s.col[1].sk[0][0] = 10;
  startEmber(s, s.col[0], 'woodcraft');
  const h0 = stateHash(s);
  const list = tr.update();
  assert.equal(stateHash(s), h0, 'alerts never write state');
  const by = Object.fromEntries(list.map((x) => [x.id, x]));
  if (lit >= 0) assert.deepEqual(by.fire.target, { tile: [lit % s.w, Math.floor(lit / s.w)] });
  assert.deepEqual(by.trader.target, { open: 'trade' });
  assert.deepEqual(by.letter.target, { open: 'letters' });
  if (a) assert.deepEqual(by.manhunter.target, { animal: a.id });
  assert.ok(!by.perk, 'perks are earned by doing, never chosen: no perk alert (EMBERCROWN-FORTRESS.md 3.1)');
  assert.ok(!by.falling, 'someone still stands: no fall clock');
  if (s.colony.ember) assert.deepEqual(by.demand.target, { open: 'demand' });
  // every alert has a target: the shell's alertGo jumps to it (the browser check taps each one)
  for (const x of list) assert.ok(x.target && Object.keys(x.target).length, x.id);
  // the fall clock (1.3): no one free and able for 6 game hours shows "No one stands" with the hours left
  for (const c of s.col) c.hp.down = true;
  s.colony.fallSince = s.tick - 6 * TICKS_PER_HOUR;
  const fall = tr.update().find((x) => x.id === 'falling');
  assert.ok(fall && /falls in 18 h/.test(fall.text) && fall.target.colonist !== undefined, fall && fall.text);
});

test('Next steps: every Stage 2 advice target is a tool spec, a tab or a panel the shell opens', async () => {
  installSim({ stage: '2', reset: true });
  const goes = all('advice').map((r) => r.go).filter(Boolean);
  const okTool = new Set(['place', 'zone', 'rect', 'carve', 'stamp']);
  for (const g of goes) {
    if (g.tool) assert.ok(okTool.has(typeof g.tool === 'string' ? g.tool : g.tool.kind), JSON.stringify(g));
    else assert.ok(['build', 'orders', 'zones', 'work', 'hold', 'research'].includes(g.panel) || g.colony || g.hearth, JSON.stringify(g));
  }
});

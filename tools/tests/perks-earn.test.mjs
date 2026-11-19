// Perks by deeds (EMBERCROWN-FORTRESS.md 3.1, F10; step S9.3, owners F and G). No perk is picked: a colonist
// earns one when the skill level is reached AND the deed is done (js/data/deeds-col.js PERK_EARN, counted in
// col.done by js/game/people/coldeeds.js), checked once a game hour, with a toast line, a Chronicle line and
// a log line and no letter.
// Oracle: the 3.1 table. Until A's schema carries col.done (requested in the S9.3 report), the test adds the
// field to the schema in this process only, the way A will (a positional counter array), so the counting,
// the save and the reload are exercised for real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELDS, SKILL_IDS } from '../../js/game/core/schema.js';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { tick } from '../../js/game/core/sim.js';
import { applyCommand, COMMANDS } from '../../js/game/core/commands.js';
import { stateHash } from '../../js/game/core/state.js';
import { TICKS_PER_HOUR } from '../../js/game/core/time.js';
import { TER, W, H } from '../../js/game/core/grid.js';
import { saveBlobSync, loadBlobSync } from '../../js/game/save/colonysave.js';
import { mineTile } from '../../js/game/world/terrain.js';
import { depositId } from '../../js/game/world/defs.js';
import { killFoe } from '../../js/game/threat/raiders.js';
import { newFoe } from '../../js/game/core/schema.js';
import { CONTENT } from '../../js/data/index.js';
import { COL_DEEDS, DONE_LEN, PERK_EARN, DEED_RULES } from '../../js/data/deeds-col.js';
import { perks, skills } from '../../js/game/people/index.js';
import { didDeed, deedCount, colDeedsSystem } from '../../js/game/people/coldeeds.js';
import { emit } from '../../js/game/core/events.js';
import { tapEvents } from '../../js/game/colony/ledger.js';
import { addBuilding, removeBuilding } from '../../js/game/core/apply.js';
import { makeJob, KEY } from '../../js/game/work/jobs.js';

const SCHEMA_HAS_DONE = FIELDS.col.some((f) => f.name === 'done');
if (!SCHEMA_HAS_DONE) FIELDS.col.push({ name: 'done', type: 'json', def: () => new Array(DONE_LEN).fill(0), core: false });

function colony(seed = 'perks-earn') {
  installSim({ stage: '2', reset: true });
  const s = foundColony({ seed, name: 'Deed Hold' });
  s.st.queue.length = 0;
  return s;
}
/** Tick through the next hourly earn check (the tick whose s.tick is a whole hour), the storyteller kept quiet. */
function toNextHour(s) {
  do { s.st.queue.length = 0; tick(s); } while (s.tick % TICKS_PER_HOUR !== 0);
}
const setLevel = (c, skill, lvl) => { c.sk[SKILL_IDS.indexOf(skill)][0] = lvl; c.sk[SKILL_IDS.indexOf(skill)][1] = 0; };
const perkLetters = (s) => s.rt.events.filter((e) => e.name === 'letter' && e.data && e.data.kind === 'perk');

test('data: every one of the 33 perks has its 3.1 earn rule at its own level; deed slots are unique and fit col.done', () => {
  const list = CONTENT.all('perk');
  assert.equal(list.length, 33);
  const ids = new Set(COL_DEEDS.map((d) => d.id)), slots = new Set(COL_DEEDS.map((d) => d.slot));
  assert.equal(ids.size, COL_DEEDS.length, 'deed ids unique');
  assert.equal(slots.size, COL_DEEDS.length, 'deed slots unique');
  for (const d of COL_DEEDS) {
    assert.ok(Number.isInteger(d.slot) && d.slot >= 0 && d.slot < DONE_LEN, `${d.id} slot`);
    if (!d.internal) { assert.ok(/\{n\}/.test(d.past) && /\{have\}/.test(d.prog) && /\{n\}/.test(d.prog), `${d.id} texts`); assert.ok(!/[^\x20-\x7e]/.test(d.past + d.prog), `${d.id}: plain text`); }
  }
  for (const p of list) {
    const e = PERK_EARN[p.id];
    assert.ok(e, `${p.id} has an earn rule`);
    assert.equal(e.lvl, p.lvl, `${p.id}: earned at its own level (no perk before its level)`);
    const deeds = e.all || e.any;
    assert.ok(deeds && deeds.length && !(e.all && e.any), `${p.id}: all or any`);
    for (const d of deeds) { assert.ok(ids.has(d.deed) && !COL_DEEDS.find((x) => x.id === d.deed).internal, `${p.id}: deed ${d.deed}`); assert.ok(Number.isInteger(d.n) && d.n > 0); }
  }
  assert.deepEqual(Object.keys(PERK_EARN).sort(), list.map((p) => p.id).sort(), 'no earn rule for a missing perk');
  // the 3.1 table, spot checks
  assert.deepEqual(PERK_EARN.seam_follower, { lvl: 10, all: [{ deed: 'ore_mined', n: 150 }] });
  assert.deepEqual(PERK_EARN.cave_sense.any.map((d) => [d.deed, d.n]), [['caveins_near', 2], ['mined', 400]]);
  assert.deepEqual(PERK_EARN.warcry, { lvl: 20, all: [{ deed: 'kills', n: 60 }] });
  assert.deepEqual(PERK_EARN.hearth_cook, { lvl: 15, all: [{ deed: 'fine_meals', n: 200 }] });
});

test('Seam Follower: Mining 10 and 150 ore mined earns it within the hour, with no letter; a toast line, a Chronicle line and a log line', () => {
  const s = colony();
  const c = s.col[0];
  setLevel(c, 'mining', 10);
  didDeed(s, c, 'ore_mined', 149);
  toNextHour(s);
  assert.ok(!c.perks.includes('seam_follower'), '149 of 150: not yet');
  // the 150th ore tile, mined for real by this colonist (B's onMined hook counts it)
  let ore = -1;
  const iron = depositId('iron');
  for (let i = 0; i < W * H && ore < 0; i++) if (s.L.terrain[i] === TER.ROCK) { ore = i; }
  assert.ok(ore >= 0, 'a rock tile');
  s.L.ore[ore] = iron;
  const minedBefore = deedCount(c, 'mined');
  assert.ok(mineTile(s, ore, c.id));
  assert.equal(deedCount(c, 'ore_mined'), 150);
  assert.equal(deedCount(c, 'mined'), minedBefore + 1, 'mined rock counts too');
  s.rt.events.length = 0;
  toNextHour(s);
  assert.ok(c.perks.includes('seam_follower'), 'earned');
  assert.ok(perks.hasGrant(c, 'seamFollower'), 'and it acts (hasGrant)');
  assert.equal(perkLetters(s).length, 0, 'no perk letter');
  const first = c.name.split(' ')[0];
  const line = s.chron.find((e) => e[2] === 'chron_perk');
  assert.ok(line, 'a Chronicle line');
  assert.deepEqual([line[3].name, line[3].perk], [first, 'Seam Follower']);
  const log = c.log[c.log.length - 1];
  assert.match(log.text, new RegExp(`^${first} has learned Seam Follower: followed 150 ore seams\\.$`));
  assert.equal(perks.grantText(c, 'seam_follower'), `${first} has learned Seam Follower: followed 150 ore seams`);
  assert.ok(!c.perks.includes('cave_sense'), 'Cave Sense needs its own deed');
});

test('no perk before its level: 1,000 ore at Mining 9 earns nothing until Mining 10; signature perks wait for their deed too', () => {
  const s = colony('perks-level');
  const c = s.col[1];
  setLevel(c, 'mining', 9);
  didDeed(s, c, 'ore_mined', 1000);
  didDeed(s, c, 'mined', 1000);
  for (let h = 0; h < 6; h++) toNextHour(s);
  assert.deepEqual(c.perks.filter((p) => CONTENT.get('perk', p).skill === 'mining'), [], 'nothing at Mining 9');
  // the old signature rule (granted on reaching 15) is gone: Cooking 15 alone earns nothing
  const ci = SKILL_IDS.indexOf('cooking');
  c.sk[ci] = [14, 0, 1, 0];
  while (c.sk[ci][0] < 15) { c.sk[ci][3] = 0; skills.awardXp(s, c, 'cooking', 2400); }
  setLevel(c, 'mining', 10);
  toNextHour(s);
  assert.ok(c.perks.includes('seam_follower') && c.perks.includes('cave_sense'), 'both perks of the old pair, earned together');
  assert.ok(!c.perks.includes('hearth_cook'), 'Hearth Cook needs 200 fine meals');
  const next = perks.nextPerks(c, { skill: 'cooking' })[0];
  assert.equal(next.id, 'hearth_cook');
  assert.equal(next.text, 'Hearth Cook: cooked 0 of 200 fine meals');
  didDeed(s, c, 'fine_meals', 200);
  toNextHour(s);
  assert.ok(c.perks.includes('hearth_cook'));
  assert.equal(perkLetters(s).length, 0);
  assert.deepEqual(perks.pendingChoices(c), [], 'there are no choices');
  if ('perk' in COMMANDS) assert.equal(applyCommand(s, { t: 'perk', colId: c.id, perk: 'stonefriend' }).ok, false, 'a perk cannot be picked');
  assert.ok(!c.perks.includes('stonefriend'));
});

test('the Skills tab line: "next: Seam Follower, mined 112 of 150 ore" (level first while it is short)', () => {
  const s = colony('perks-next');
  const c = s.col[0];
  setLevel(c, 'mining', 4);
  didDeed(s, c, 'ore_mined', 112);
  const seam = perks.nextPerks(c, { skill: 'mining' }).find((p) => p.id === 'seam_follower');
  assert.equal(seam.text, 'Seam Follower: Mining 10, mined 112 of 150 ore');
  setLevel(c, 'mining', 12);
  assert.equal(perks.nextPerks(c, { skill: 'mining' }).find((p) => p.id === 'seam_follower').text, 'Seam Follower: mined 112 of 150 ore');
  assert.equal(perks.nextPerks(c, { skill: 'mining' }).find((p) => p.id === 'cave_sense').text, 'Cave Sense: near 0 of 2 cave-ins or mined 0 of 400 tiles of rock');
});

test('a hall: the miner of the last tile of a carve plan of 40+ tiles is credited once', () => {
  const s = colony('perks-hall');
  const c = s.col[0];
  // an 8 x 5 block of rock well away from the Hearth, with a carve plan over it (A's plan shape)
  const x0 = 4, y0 = 4, rect = { x0, y0, x1: x0 + 7, y1: y0 + 4 };
  const tiles = [];
  for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++) { const i = y * W + x; s.L.terrain[i] = TER.ROCK; s.L.ore[i] = 0; tiles.push(i); }
  s.colony.plans.push({ id: 99, kind: 'carve', rect, pattern: 'none', pillars: [], natural: [], built: [], tick: s.tick });
  for (const i of tiles.slice(0, -1)) assert.ok(mineTile(s, i, s.col[1].id));
  assert.equal(deedCount(s.col[1], 'halls_carved'), 0, 'not done yet');
  assert.ok(mineTile(s, tiles[tiles.length - 1], c.id));
  assert.equal(deedCount(c, 'halls_carved'), 1);
  assert.equal(deedCount(s.col[1], 'mined'), 39);
});

test('kills count from BUS.kill: foes slain, elites felled, and the smith whose blade slew the Hollow', () => {
  const s = colony('perks-kills');
  const [a, smith] = s.col;
  a.gear.slots.weapon = { k: 'sword', m: 'iron', q: 2, n: 1, maker: smith.id };
  const foe = (kind) => { const f = newFoe(s.next.foe++, kind, { x: a.x + 32, y: a.y, hp: { hp: 1, max: 40 }, st: {} }); s.foes.push(f); return f; };
  killFoe(s, foe('husk'), a);
  killFoe(s, foe('hollow_knight'), a);
  killFoe(s, foe('wolf'), a);
  assert.equal(deedCount(a, 'kills'), 3);
  assert.equal(deedCount(a, 'elites_felled'), 1, 'the Hollow Knight (90 points) is an elite');
  assert.equal(deedCount(smith, 'forged_kills'), 2, 'two Hollow fell to the smith\'s blade; the wolf is no Hollow');
  setLevel(a, 'melee', 20);
  didDeed(s, a, 'kills', 57);
  toNextHour(s);
  assert.ok(a.perks.includes('warcry'), 'Melee 20 and 60 foes');
});

test('this tick\'s events count for the colonist who did them: walls, props, traps, smelting, forging, garments, fine meals, harvests, tamings; downed then up is a recovery', () => {
  const s = colony('perks-events');
  const [a, b] = s.col;
  s.rt.events.length = 0;
  const ev = (name, data) => emit(s, name, data);
  ev('built', { bId: 1, def: 'wall', colId: a.id }); ev('built', { bId: 2, def: 'prop', colId: a.id }); ev('built', { bId: 3, def: 'pillar', colId: b.id });
  ev('built', { bId: 4, def: 'spiketrap', colId: b.id }); ev('built', { bId: 5, def: 'wall', colId: null });
  ev('crafted', { itemId: 1, k: 'ingot', q: 0, colId: a.id }); ev('crafted', { itemId: 2, k: 'sword', q: 3, colId: a.id }); ev('crafted', { itemId: 3, k: 'sword', q: 4, colId: a.id });
  ev('crafted', { itemId: 4, k: 'sword', q: 1, colId: a.id }); ev('crafted', { itemId: 5, k: 'tunic', q: 2, colId: b.id }); ev('crafted', { itemId: 6, k: 'finemeal', q: 0, colId: b.id });
  ev('crafted', { itemId: 7, k: 'meal', q: 0, colId: b.id }); ev('harvested', { colId: b.id, k: 'berries', n: 3 }); ev('tamed', { colId: b.id, animId: 1 }); ev('downed', { id: b.id });
  tapEvents(s);
  const got = (c, ids) => ids.map((id) => deedCount(c, id));
  assert.deepEqual(got(a, ['walls_built', 'supports_built', 'ore_smelted', 'forged_fine', 'forged_master', 'garments']), [1, 1, 1, 2, 1, 0]);
  assert.deepEqual(got(b, ['supports_built', 'traps_set', 'garments', 'fine_meals', 'harvested', 'tamed', 'recovered']), [1, 1, 1, 1, 1, 1, 0]);
  s.st.queue.length = 0; tick(s);
  assert.equal(deedCount(a, 'walls_built'), 1, 'an event counts once (the tap reads only its own tick)');
  // b stands again: at the next hourly pass, one recovery
  b.hp.down = false;
  s.tick = Math.ceil((s.tick + 1) / TICKS_PER_HOUR) * TICKS_PER_HOUR;
  colDeedsSystem(s); colDeedsSystem(s);
  assert.equal(deedCount(b, 'recovered'), 1);
  // deconstruction: the colonist whose deconstruct job targets the building
  const w = addBuilding(s, 'wall', a.x / 32 + 3 | 0, a.y / 32 | 0, 0, null);
  w.st = 'done'; w.dcon = true;
  a.job = makeJob('deconstruct', KEY.BLD + w.id, []);
  removeBuilding(s, w);
  a.job = null;
  assert.equal(deedCount(a, 'deconstructed'), 1);
});

test('counters are saved state: save, reload and continue to the same hash; the counts survive', () => {
  const s = colony('perks-save');
  const c = s.col[0];
  setLevel(c, 'construction', 10);
  didDeed(s, c, 'supports_built', 19);
  didDeed(s, c, 'deconstructed', 59);
  for (let k = 0; k < 300; k++) tick(s);
  const blob = saveBlobSync(s);
  const r = loadBlobSync(blob);
  assert.equal(stateHash(r), stateHash(s), 'reload hashes as saved');
  const rc = r.col.find((x) => x.id === c.id);
  assert.equal(deedCount(rc, 'supports_built'), 19);
  for (const x of [s, r]) { didDeed(x, x.col.find((y) => y.id === c.id), 'supports_built'); didDeed(x, x.col.find((y) => y.id === c.id), 'deconstructed'); }
  for (let k = 0; k < TICKS_PER_HOUR + 5; k++) { tick(s); tick(r); }
  assert.equal(stateHash(r), stateHash(s), 'continued identically');
  for (const x of [s, r]) { const y = x.col.find((z) => z.id === c.id); assert.ok(y.perks.includes('quick_shoring') && y.perks.includes('salvager'), 'both Construction 10 perks'); }
  void DEED_RULES;
});

test('the Stage 2.9 migration helper: an old pending choice settles on the nearer deed, else the first perk', () => {
  const col = { id: 7, name: 'Bryn Ashdown', perks: [], sk: SKILL_IDS.map(() => [0, 0, 0, 0]) };
  col.sk[SKILL_IDS.indexOf('smithing')][0] = 11;
  col.sk[SKILL_IDS.indexOf('mining')][0] = 10;
  const ch = perks.legacyChoices(col);
  assert.deepEqual(ch.map((x) => [x.skill, x.lvl, x.options]), [['mining', 10, ['cave_sense', 'seam_follower']], ['smithing', 10, ['reforger', 'temperer']]]);
  assert.equal(perks.settleChoice(col, ['cave_sense', 'seam_follower'], {}), 'cave_sense', 'no measure: the first perk');
  const items = [{ k: 'sword', q: 3, maker: 7 }, { k: 'sword', q: 4, maker: 7 }, { k: 'sword', q: 4, maker: 8 }];
  assert.equal(perks.settleChoice(col, ['reforger', 'temperer'], { items }), 'temperer', 'Superior blades made: nearer to Temperer');
  const e = perks.settledChronEntry(100, col, 'temperer');
  assert.deepEqual(e, [100, 'perk', 'chron_perk_settled', { colId: 7, name: 'Bryn', perk: 'Temperer' }]);
});

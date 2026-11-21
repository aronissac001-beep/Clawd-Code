// Step Z2.4 (EMBERCROWN-FORTRESS.md 3.7, 3.10, 8.4): renown, the hold verbs (research by doing, the winch), the
// add-on audit and the surviving add-ons, the deep chains. Owners K (renown, verbs), E (add-on logic), G (data).
//   node tools/validate-data.mjs && node --test tools/tests/renown.test.mjs
// Oracle rows scripted here: no structure or recipe reads renown; every add-on row names its verb. (Bot targets,
// measured by the step's report run with the dark modules wired in by hand: Known for something by day 150 on 4
// of 5 seeds; the winch used >= 50 times by day 100 needs haul.js and bot v4.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installSim, foundColony, findSite } from '../../js/game/core/setup.js';
import { tick } from '../../js/game/core/sim.js';
import { installContent } from '../../js/game/core/content.js';
import { registerSystem, tickSystems, BUS } from '../../js/game/core/bus.js';
import { addBuilding } from '../../js/game/core/apply.js';
import { stateHash } from '../../js/game/core/state.js';
import { idx, TER, zS, PLANE } from '../../js/game/core/grid.js';
import { TICKS_PER_HOUR } from '../../js/game/core/time.js';
import { saveBlobSync, loadBlobSync } from '../../js/game/save/colonysave.js';
import { completeBuilding } from '../../js/game/work/construct.js';
import { spawn, stacksOn, getItem, spawnAt } from '../../js/game/work/items.js';
import { setTerrain } from '../../js/game/world/terrain.js';
import { hasTech } from '../../js/game/colony/research.js';
import { tierIndex } from '../../js/game/colony/tiers.js';
import { generateColonist, spawnColonist } from '../../js/game/people/colonists.js';
import { SK } from '../../js/game/people/skills.js';
import { buildRegistry, SCHEMAS } from '../../js/data/schema.js';
import { ENTRIES, CONTENT } from '../../js/data/index.js';
import * as DA from '../../js/data/addons.js';
import { STAGED as ITEMS_STAGED } from '../../js/data/items.js';
import { STAGED as RECIPES_STAGED } from '../../js/data/recipes.js';
import { DATA as DREN } from '../../js/data/renown.js';
import * as R from '../../js/game/colony/renown.js';
import * as AD from '../../js/game/work/addons.js';
import * as DISC from '../../js/game/colony/verbs/discovery.js';
import * as WI from '../../js/game/colony/verbs/winch.js';
import { TICK_IDS, verbsSystem } from '../../js/game/colony/verbs/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// the staged structure rows (G adds them to structures/workshops.js and utility.js; Z2.9 owns those files)
// and the staged items, recipes and add-on rows (traded categories: they join DATA at the Z2 switch)
const REG = buildRegistry([...ENTRIES,
  { path: 'z24-staged.js', owner: 'G', mod: { DATA: { item: ITEMS_STAGED.item, recipe: RECIPES_STAGED.recipe, addon: DA.STAGED.addon } } },
  { path: 'structures/workshops.js', owner: 'G', mod: { DATA: { structure: DA.STRUCTURES.filter((d) => d.cat === 'workshops') } } },
  { path: 'structures/utility.js', owner: 'G', mod: { DATA: { structure: DA.STRUCTURES.filter((d) => d.cat === 'utility') } } }]);

function colony(seed = 'K-Z24', d = 1) {
  installSim({ stage: '2', reset: true });
  installContent({ reg: REG });
  return foundColony({ seed, name: 'Renown Hold', d });
}
const hearth = (s) => s.bld[s.colony.hearth.id];
function built(s, defId, x, y, z = 0, rot = 0) {
  const b = addBuilding(s, defId, x, y, rot, null, z ? { z } : {});
  completeBuilding(s, b);
  return b;
}
function site(s, w, h, dx = 6, dy = 6) { const hb = hearth(s); return findSite(s, hb.x + dx, hb.y + dy, w, h, 1); }
function master(s, skill) { const h = hearth(s), c = generateColonist(s); spawnColonist(s, c, h.x, h.y + 2); c.sk[SK[skill]][0] = 15; return c; }
const ev = (s, name, data) => ({ name, tick: s.tick, data });

// ---- Data: the audit, verbs, no renown gates ------------------------------------------------------------------
test('Z2.4 data: the staged rows validate; the audit covers all 36 specialisations; every add-on names its verb', () => {
  assert.deepEqual(REG.errors, []);
  assert.equal(DA.AUDIT.length, 36);
  assert.equal(new Set(DA.AUDIT.map((a) => a.spec)).size, 36);
  const rows = new Set(DA.ALL_ADDONS.map((a) => a.id));
  for (const a of DA.AUDIT) {
    assert.ok(a.verdict === 'addon' || a.verdict === 'dropped', a.spec);
    if (a.verdict === 'addon') { assert.ok(rows.has(a.addon), `${a.spec}: ${a.addon}`); assert.ok(a.verb, a.spec); if (a.also) assert.ok(rows.has(a.also)); }
    else assert.ok(a.why && a.why.length > 10, `${a.spec}: a dropped specialisation says why`);
  }
  const kept = DA.AUDIT.filter((a) => a.verdict === 'addon').length;
  assert.ok(kept >= 12 && kept <= 18, `about 15 of 36 survive (${kept})`);
  for (const a of DA.ALL_ADDONS) {
    assert.ok(DA.VERB_OF[a.id] && DA.VERB_OF[a.id].length > 2, `add-on '${a.id}' names its verb`);
    if (a.form === 'structure') assert.ok(REG.get('structure', a.id), `add-on structure '${a.id}' has a staged row`);
    else assert.ok(AD.MASTER_SKILL[a.id], `master set '${a.id}' names its skill`);
  }
  assert.deepEqual(Object.keys(DA.VERB_OF).sort(), [...rows].sort());
  assert.ok(REG.get('structure', 'winch'));
  // nothing staged is live yet (it would change caravan stock), and nothing live names a staged row
  for (const it of ITEMS_STAGED.item) assert.equal(CONTENT.get('item', it.id), null, `${it.id} is staged`);
  for (const r of CONTENT.all('recipe')) for (const x of [...r.in, ...r.out]) if (x.k) assert.ok(CONTENT.get('item', x.k), `${r.id}: ${x.k}`);
});

test('Z2.4 oracle: no structure or recipe reads renown (data and code)', () => {
  const domains = new Set(DREN.renown.map((d) => d.id));
  for (const kind of ['structure', 'recipe', 'addon', 'tech', 'room']) {
    assert.ok(!Object.keys(SCHEMAS[kind].fields).some((f) => /renown|known/i.test(f)), `${kind} schema has no renown field`);
    for (const d of REG.all(kind)) {
      const j = JSON.stringify(d);
      assert.ok(!/renown|knownFor/i.test(j), `${kind} '${d.id}' names renown`);
    }
  }
  void domains;
  // code: renown.js is imported only by steering readers (visitors, causes, letters, UI) and the colony index
  const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const ALLOWED = /colony\/(index|visitors|renown)\.js$|threat\/(causes|storyteller|letters)\.js$|^js\/ui\//;
  for (const f of walk(join(ROOT, 'js')).filter((p) => p.endsWith('.js'))) {
    const rel = relative(ROOT, f).split('\\').join('/');
    const src = readFileSync(f, 'utf8');
    if (rel.startsWith('js/data/')) continue;
    if (/from '[^']*colony\/renown\.js'|from '\.\/renown\.js'|from '\.\.\/renown\.js'/.test(src)) assert.ok(ALLOWED.test(rel), `${rel} imports renown.js (only steering may)`);
  }
});

test('Z2.4 chains: every new recipe names real items, benches and techs; the add-on recipes are dark (stage 3)', () => {
  const ids = ['grind_lens', 'make_glass_lantern', 'make_storage_urn', 'render_ash', 'make_lye', 'make_soap', 'carve_bonecraft', 'carve_shellcraft',
    'dimroot_wort', 'glowcap_spirit', 'weave_silk', 'harden_lamellar', 'shell_lamellar', 'make_embersteel', 'forge_emberward', 'make_electrum', 'melt_weapons'];
  for (const id of ids) assert.ok(REG.get('recipe', id), id);
  for (const r of REG.all('recipe')) if (r.addon && r.id !== 'ashlar_blocks') assert.equal(r.stage, '3', `${r.id}: an add-on recipe waits for its add-on structure`);
  for (const m of ['shankwood', 'spidersilk', 'shell', 'electrum', 'embersteel']) assert.ok(REG.get('material', m), m);
  assert.equal(REG.get('recipe', 'make_embersteel').out[0].mat, 'embersteel');
  assert.equal(REG.get('recipe', 'weave_silk').out[0].mat, 'spidersilk');
  assert.deepEqual([...DA.EMBERPROOF].sort(), ['emberhood', 'emberward']);
});

// ---- Renown -----------------------------------------------------------------------------------------------------
test('Z2.4 renown: points from deeds, the season roll (decay 25%), thresholds, the median rule, at most two', () => {
  const s = colony();
  assert.equal(s.colony.renown, undefined, 'a new hold has no renown record until the system runs');
  R.ensureRenown(s);
  const r = s.colony.renown;
  for (let k = 0; k < 30; k++) R.renownTap(s, ev(s, 'masterwork', {}));       // 360 smithing
  R.renownTap(s, ev(s, 'artifact', {}));                                     // +40
  assert.equal(r.acc[0], 400);
  R.rollSeason(s);
  assert.deepEqual(r.known, ['smithing']);
  assert.equal(R.epithetOf(s), 'the Forge under the Mountain');
  // decay: 400 -> 300 (< 400 threshold) but hysteresis keeps it one season, then it goes
  R.rollSeason(s);
  assert.equal(r.pts[0], 300);
  assert.deepEqual(r.known, ['smithing'], 'one season of hysteresis');
  R.rollSeason(s);
  assert.deepEqual(r.known, [], 'gone after a second season below');
  // the median rule: three domains high -> none stands out
  for (const d of ['smithing', 'growing', 'lore', 'arms']) R.addRenown(s, d, 500);
  R.rollSeason(s);
  assert.deepEqual(r.known, [], 'no domain above 1.5x the median of the others');
  // two stand out, a third smaller: at most two, the highest
  const s2 = colony('K-Z24b');
  R.addRenown(s2, 'arms', 900); R.addRenown(s2, 'delving', 800); R.addRenown(s2, 'lore', 700);
  R.rollSeason(s2);
  assert.deepEqual(s2.colony.renown.known, ['arms', 'delving']);
  assert.equal(R.causeLean(s2, 'grievance'), 125);
  assert.equal(R.causeLean(s2, 'opened_cavern'), 125);
  assert.equal(R.causeLean(s2, 'rumour'), 100);
  const w = R.visitorWeights(s2);
  assert.equal(w.arms, 3); assert.equal(w.smithing, 1);
  assert.deepEqual(R.visitorFor(s2, 0), R.visitorFor(s2, 0), 'a visitor is a pure function of the roll');
  assert.equal(R.renownLines(s2).length, 6);
});

test('Z2.4 renown: level, cavern and tech deeds; ledger kills and trades fold in at the roll; free techs do not count', () => {
  const s = colony();
  R.ensureRenown(s);
  const r = s.colony.renown;
  R.renownTap(s, ev(s, 'researched', { tech: 'masonry' }));     // cost 0: no lore
  assert.equal(r.acc[2], 0);
  R.renownTap(s, ev(s, 'researched', { tech: 'steel' }));
  assert.equal(r.acc[2], R.PTS.researched);
  R.renownTap(s, ev(s, 'discovery', { kind: 'cavern', i: 0 }));
  assert.equal(r.acc[5], R.PTS.cavern);
  s.colony.ledger.total = { ...(s.colony.ledger.total || {}), kills: 10, traded: 4, raidsRepelled: 1 };
  r.led = { kills: 0, traded: 0, raids: 0 };
  R.rollSeason(s);
  assert.equal(r.pts[4], 10 * R.PTS.kill + R.PTS.raid);
  assert.equal(r.pts[3], 4 * R.PTS.trade);
});

test('Z2.4 renown: the hourly system rolls at each season, saves and loads, and an old save continues', () => {
  const s = colony();
  if (!tickSystems().some((x) => x.name === 'renown')) registerSystem('colony', 'renown', R.renownSystem, 145);
  R.installRenown();
  const old = loadBlobSync(saveBlobSync(s));          // a save from before Z2.4 (no renown record)
  for (let t = 0; t < TICKS_PER_HOUR + 1; t++) tick(s);
  assert.ok(s.colony.renown, 'created on the first hour');
  R.addRenown(s, 'growing', 500);
  const was = s.colony.renown.season;
  s.colony.renown.season = was - 1;                   // as if a season's turn had just passed (no tick jump)
  for (let t = 0; t < TICKS_PER_HOUR; t++) tick(s);
  assert.equal(s.colony.renown.season, was);
  assert.ok(R.isKnownFor(s, 'growing'));
  const s2 = loadBlobSync(saveBlobSync(s));
  assert.equal(stateHash(s2), stateHash(s));
  assert.deepEqual(s2.colony.renown, s.colony.renown);
  for (let t = 0; t < TICKS_PER_HOUR; t++) { tick(s); tick(s2); }
  assert.equal(stateHash(s2), stateHash(s));
  for (let t = 0; t < TICKS_PER_HOUR + 1; t++) tick(old);
  assert.ok(old.colony.renown && old.colony.renown.v === 1, 'an old save gains a record and continues');
  R.uninstallRenown();
});

// ---- Research by doing -----------------------------------------------------------------------------------------
test('Z2.4 research by doing: a third of the techs, every kind, real techs; mining sand discovers glassblowing', () => {
  installContent({ reg: REG });
  const techs = REG.all('tech');
  const share = DISC.WHEN.length / techs.length;
  assert.ok(share >= 0.3 && share <= 0.4, `about a third (${DISC.WHEN.length}/${techs.length})`);
  assert.equal(new Set(DISC.WHEN.map((w) => w.tech)).size, DISC.WHEN.length);
  for (const w of DISC.WHEN) { assert.ok(REG.get('tech', w.tech), w.tech); assert.ok(DISC.WHEN_KINDS.includes(w.by)); if (w.mat && w.by === 'mine') assert.ok(REG.get('material', w.mat) || w.mat === 'sand' || w.mat === 'marble'); }
  for (const k of DISC.WHEN_KINDS) assert.ok(DISC.WHEN.some((w) => w.by === k), `kind ${k}`);
  assert.ok(TICK_IDS.includes('discovery') && TICK_IDS.includes('winch'));
  const s = colony();
  assert.ok(!hasTech(s, 'glassblowing'));
  for (let k = 0; k < 29; k++) DISC.discoveryTap(s, ev(s, 'mined', { i: 0, mat: 'sand', ore: 0, colId: null }));
  assert.ok(!hasTech(s, 'glassblowing'));
  DISC.discoveryTap(s, ev(s, 'mined', { i: 0, mat: 'sand', ore: 0, colId: null }));
  assert.ok(!hasTech(s, 'glassblowing'), 'the Hold era is not open yet: found, waiting');
  assert.deepEqual(s.colony.byDoing.found, ['glassblowing']);
  s.colony.tier = tierIndex('village');
  s.tick = Math.ceil((s.tick + 1) / TICKS_PER_HOUR) * TICKS_PER_HOUR;
  DISC.VERB.tick(s);
  assert.ok(hasTech(s, 'glassblowing'), 'learned at the first hour its era is open');
  assert.deepEqual(s.colony.byDoing.found, []);
  // tablets and scholars, in WHEN order
  assert.equal(DISC.discoveredByTablet(s), 'mechanisms');
  assert.ok(hasTech(s, 'mechanisms'));
  assert.equal(DISC.discoveredByTablet(s), 'siegecraft');
  assert.equal(DISC.discoveredByTablet(s), null);
  assert.equal(DISC.discoveredByScholar(s), 'medicine2');
  // crafting: 12 iron ingot stacks discover smithing (an open era once the Hamlet tier is reached)
  const s2 = colony('K-Z24c');
  s2.colony.tier = tierIndex('hamlet');
  const h = hearth(s2);
  for (let k = 0; k < 12; k++) { const id = spawn(s2, 'ingot', 'iron', 0, 1, h.x + 3, h.y + 3); DISC.discoveryTap(s2, ev(s2, 'crafted', { itemId: id, k: 'ingot', q: 0, colId: null })); }
  assert.ok(hasTech(s2, 'smithing'));
});

// ---- Add-ons ---------------------------------------------------------------------------------------------------
test('Z2.4 add-ons: a structure add-on opens its recipes beside its bench only; a master set while a Master lives', () => {
  const s = colony();
  AD.installAddons();
  const [fx, fy] = site(s, 4, 2);
  const forge = built(s, 'forge', fx, fy);
  const fw = CONTENT.get('structure', 'forge').size[0];
  assert.deepEqual(AD.addonsOf(s, forge), []);
  const war = REG.get('recipe', 'forge_warpick'), brig = REG.get('recipe', 'forge_brigandine'), sword = REG.get('recipe', 'forge_sword');
  assert.ok(!AD.addonOpen(s, forge, war) && !AD.addonOpen(s, forge, brig) && AD.addonOpen(s, forge, sword));
  // placement: beside the forge only
  const far = AD.addonPlaceWhy(s, REG.get('structure', 'armourer_stand'), fx + fw + 5, fy, 0, 0);
  assert.match(far, /beside a Forge/);
  assert.equal(AD.addonPlaceWhy(s, REG.get('structure', 'armourer_stand'), fx + fw, fy, 0, 0), null);
  s.tick++;
  built(s, 'armourer_stand', fx + fw, fy);
  assert.deepEqual(AD.addonsOf(s, forge), ['armourer_stand']);
  assert.ok(AD.addonOpen(s, forge, brig) && AD.benchHasRule(s, forge, 'refit') && !AD.benchHasRule(s, forge, 'temper'));
  s.tick++;
  master(s, 'smithing');
  assert.ok(AD.addonOpen(s, forge, war), 'the Weaponsmith\'s set opens with a Master smith');
  assert.deepEqual(AD.addonLines(s, forge).filter((l) => l[2]).map((l) => l[1]), ['the war pick and glaive', 'refit']);
  // the ember forge needs an ember pool beside it
  const why = AD.addonPlaceWhy(s, REG.get('structure', 'ember_forge'), fx, fy + 2, 0, 0);
  assert.match(why, /ember pool/);
  if (!s.L.fluid) s.L.fluid = new Uint8Array(s.L.terrain.length);   // a D = 1 test world has no fluid layer
  s.L.fluid[idx(fx + 2, fy + 3, 0)] = 8 | 4;
  assert.equal(AD.addonPlaceWhy(s, REG.get('structure', 'ember_forge'), fx, fy + 2, 0, 0), null);
  s.tick++;
  built(s, 'ember_forge', fx, fy + 2);
  assert.ok(AD.needsNoFuel(s, forge) && AD.extraQualityRolls(s, forge) === 1);
  assert.ok(AD.addonOpen(s, forge, REG.get('recipe', 'make_embersteel')));
  assert.ok(AD.isEmberproof('emberward') && !AD.isEmberproof('mailshirt'));
  AD.uninstallAddons();
  assert.ok(!BUS.canPlace.some((f) => f.name === 'placeHook'));
});

// ---- The winch -------------------------------------------------------------------------------------------------
test('Z2.4 winch: stacks on the landing ride down the shaft, 2 s a level, up to 3 a trip; landed stacks stay; save mid-trip', () => {
  const s = colony('K-Z24w', 20);
  if (!tickSystems().some((x) => x.name === 'verbs')) registerSystem('colony', 'verbs', verbsSystem, 130);   // colony/index.js: verbs is off in installSim today
  const z = zS;
  const hb = hearth(s);
  const [x, y] = findSite(s, hb.x + 8, hb.y + 4, 1, 3, 1);
  // a shaft: three open levels under (x, y), a floor at z - 4
  setTerrain(s, idx(x, y, z - 4), TER.ROUGH);
  for (let k = 1; k <= 3; k++) setTerrain(s, idx(x, y, z - k), TER.AIR);
  assert.equal(WI.shaftFoot(s, x, y, z), z - 4);
  assert.equal(WI.winchPlaceWhy(s, REG.get('structure', 'winch'), x, y, 0, z), null);
  assert.match(WI.winchPlaceWhy(s, REG.get('structure', 'winch'), x + 3, y, 0, z) || '', /shaft/);
  const b = built(s, 'winch', x, y, z);
  const land = WI.landingOf(b), foot = idx(x, y, z - 4);
  spawnAt(s, 'stone', null, 0, 5, land);              // a ground tile holds one stack (a crate on the landing holds more)
  const onLand = () => stacksOn(s, land).length;
  assert.equal(onLand(), 1);
  let t0 = s.tick;
  while (!s.colony.winch || !s.colony.winch.trips.length) { tick(s); assert.ok(s.tick - t0 < 100, 'loads within the scan'); }
  const trip = s.colony.winch.trips[0];
  assert.equal(trip.dir, 'down');
  assert.equal(trip.cargo.length, 1);
  assert.equal(trip.eta - s.tick, 4 * WI.WINCH.ticksPerLevel, '2 s a level');
  assert.equal(onLand(), 0);
  // save mid-trip
  const s2 = loadBlobSync(saveBlobSync(s));
  assert.equal(stateHash(s2), stateHash(s));
  for (let t = 0; t < 4 * WI.WINCH.ticksPerLevel + 1; t++) { tick(s); tick(s2); }
  assert.equal(stateHash(s2), stateHash(s));
  const atFoot = stacksOn(s, foot).map((id) => getItem(s, id));
  assert.equal(atFoot.length, 1);
  assert.equal(atFoot[0].k, 'stone');
  assert.deepEqual(s.colony.winch.landed[b.id], [atFoot[0].id]);
  // the landed stack is not sent back up; a new stack on the landing goes down next
  for (let t = 0; t < 200; t++) tick(s);
  assert.equal(s.colony.winch.uses, 1, 'a landed stack stays put');
  spawnAt(s, 'wood', null, 0, 5, land);
  for (let t = 0; t < 400; t++) tick(s);
  assert.equal(s.colony.winch.uses, 2);
  assert.equal(onLand(), 0);
  assert.ok(WI.winchUses(s) === 2 && WI.winchRoute(s, land, foot) === b && WI.winchRoute(s, foot, land) === b);
  assert.equal(WI.winchEnd(s, b, z - 4), foot);
  void PLANE;
});

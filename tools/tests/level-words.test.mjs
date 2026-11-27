// W0.2 (EMBERCROWN-WORLD.md 12.2, 11 items 4 and 6; owner I): letters, alerts and peek lines name levels as the
// HUD does: "Surface" for the surface, else the chip number and the band plate word ("-3 Outer", "+2 Heights"),
// never "Level -3". Checked on the three W0 fixtures (every alert rule, the threat chip, the omen letter and the
// raid peek of every threat, every colonist peek, every lever's links) and on a deep breach, a flood and an ember
// flow staged on a fresh 20-level hold. Also: the section view's compass words and when it is offered, the
// speed button's face and the idle line that names the role.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---- a minimal DOM: enough for kit.js h(), onTap and the sheet and peek builders (text is what we read) ----
class Node { constructor() { this.childNodes = []; this.parentNode = null; } get firstChild() { return this.childNodes[0] || null; } get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  append(...ks) { for (const k of ks) { const n = k instanceof Node ? k : new Text(String(k)); n.parentNode = this; this.childNodes.push(n); } }
  appendChild(n) { this.append(n); return n; } prepend(...ks) { const old = this.childNodes; this.childNodes = []; this.append(...ks); this.childNodes.push(...old); }
  removeChild(n) { this.childNodes = this.childNodes.filter((x) => x !== n); return n; } remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.childNodes = []; if (v !== '' && v !== null && v !== undefined) this.append(String(v)); } }
class Text extends Node { constructor(t) { super(); this.t = t; } get textContent() { return this.t; } set textContent(v) { this.t = String(v); } }
class El extends Node {
  constructor(tag) { super(); this.tagName = tag.toUpperCase(); this.attrs = {}; this.dataset = {}; this.className = ''; this.hidden = false;
    this.style = { setProperty() {}, removeProperty() {} };
    const cl = new Set(); this.classList = { add: (...c) => c.forEach((x) => cl.add(x)), remove: (...c) => c.forEach((x) => cl.delete(x)), toggle: (c, on) => { if (on === undefined ? !cl.has(c) : on) cl.add(c); else cl.delete(c); }, contains: (c) => cl.has(c) }; }
  set innerHTML(v) { this.childNodes = []; } get innerHTML() { return ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; } removeAttribute(k) { delete this.attrs[k]; }
  addEventListener() {} removeEventListener() {} querySelector() { return null; } querySelectorAll() { return []; } focus() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 44, height: 44, right: 44, bottom: 44 }; }
}
globalThis.Node = Node;
globalThis.document = globalThis.document || { createElement: (t) => new El(t), createTextNode: (t) => new Text(t), body: new El('body'), documentElement: new El('html') };

const { loadBlob } = await import('../../js/game/save/colonysave.js');
const { installSim, foundColony } = await import('../../js/game/core/setup.js');
const G = await import('../../js/game/core/grid.js');   // zS is a live binding: read G.zS after the map size is set
const { idx } = G;
const { newEntry } = await import('../../js/game/threat/incidents.js');
const { threatViews } = await import('../../js/game/threat/warnings.js');
const { isLever } = await import('../../js/game/world/mechanisms.js');
const { ensureWorld } = await import('../../js/game/world/worldrec.js');
const { levelName, levelWord, sectionReady } = await import('../../js/ui/levels.js');
const { levelSummary } = await import('../../js/game/tools/levels.js');
const { ALERT_RULES } = await import('../../js/ui/alerts.js');
const { chipView, threatPeek, omenLetter, leverLinks } = await import('../../js/ui/threatui.js');
const { peekContent, peekJob } = await import('../../js/ui/peek.js');
const { cutWords } = await import('../../js/ui/section.js');
const { speedFace } = await import('../../js/ui/speed.js');

const FIX = new URL('../fixtures/', import.meta.url);
const NAMES = ['v4-z3-day120', 'v4-z3-flood', 'v4-z3-beast'];
const OLD = /\bLevel [-+]?\d/;                     // the old wording: "Level -3", "Level +5", "Level 0"
const textOf = (n) => (n && n.textContent) || '';
const ctxOf = (s, out) => ({ s, deep: true, portrait: () => new El('span'), openSheet: (title, fill) => { const el = new El('div'); fill(el); out.push(title, textOf(el)); },
  closeSheet() {}, closePeek() {}, send() {}, toast() {}, select() {}, centerOn() {}, setLevel() {}, refreshSheet() {} });

/** Every letter, alert and peek line the UI would show for this state. [kind, text, z|null] rows. */
function lines(s) {
  const out = [], sheet = [];
  const ctx = ctxOf(s, sheet);
  const view = { idleSince: new Map(s.col.map((c) => [c.id, -1e9])) };
  for (const r of ALERT_RULES) {
    let a = null; try { a = r.test(s, view); } catch (_) { a = null; }
    if (a) out.push(['alert ' + r.id, `${a.text} ${a.why || ''}`, a.target && a.target.tile ? a.target.tile[2] : null]);
  }
  const chip = chipView(s);
  if (chip) out.push(['chip', chip.label, chip.z]);
  let views = []; try { views = threatViews(s); } catch (_) { views = []; }
  for (const v of views) {
    sheet.length = 0;
    omenLetter(ctx, v, { first: false });
    out.push(['omen letter', sheet.join(' '), null]);
    const p = threatPeek(ctx, { kind: 'raid', id: v.id });
    if (p) out.push(['raid peek', textOf(p.head) + ' ' + p.acts.map((x) => x[0]).join(' '), null]);
  }
  for (const c of s.col) {
    if (!c || (c.hp && c.hp.dead)) continue;
    const p = peekContent(ctx, { kind: 'colonist', id: c.id });
    if (p) out.push(['colonist peek', textOf(p.head), c.z | 0]);
  }
  for (const b of s.bld) if (b && isLever(b)) for (const x of leverLinks(s, b.id)) out.push(['lever link', `${x.name} · ${x.level}`, x.z]);
  return out;
}
function check(name, rows) {
  for (const [kind, text, z] of rows) {
    assert.doesNotMatch(text, OLD, `${name} ${kind}: "${text.slice(0, 120)}"`);
    if (z !== null && z !== undefined && (kind === 'colonist peek' || kind === 'chip' || /alert (breach|flood|ember)/.test(kind))) assert.ok(text.includes(levelName(z)), `${name} ${kind} names ${levelName(z)}: "${text.slice(0, 120)}"`);
  }
}

test('levelName: the HUD words ("Surface", "-3 Outer", "+2 Heights"), and levelWord is the same', () => {
  installSim({ stage: '2', reset: true, checks: false });
  foundColony({ seed: 'LW', name: 'Word Hold', d: 20 });
  assert.equal(levelName(G.zS), 'Surface');
  assert.equal(levelName(G.zS - 3), '-3 Outer');
  assert.equal(levelName(G.zS - 9), '-9 Mere');
  assert.equal(levelName(G.zS + 2), '+2 Heights');
  assert.equal(levelWord(G.zS - 13), '-13 Reach');
});

for (const name of NAMES) {
  test(`${name}: every letter, alert and peek line names levels as the HUD does`, async () => {
    installSim({ stage: '2' });
    const s = await loadBlob(new Uint8Array(readFileSync(new URL(`${name}.ecsave`, FIX))));
    const rows = lines(s);
    check(name, rows);
    const kinds = {}; for (const [k] of rows) kinds[k] = (kinds[k] || 0) + 1;
    const deep = rows.filter((r) => r[0] === 'colonist peek' && r[2] !== G.zS).length;
    assert.ok(rows.filter((r) => r[0] === 'colonist peek').length > 0, 'colonist peeks');
    console.log(`# ${name}: ${rows.length} lines ${JSON.stringify(kinds)}; ${deep} colonists below or above the surface`);
  });
}

test('a deep breach, a flood and an ember flow on a fresh hold: chip, alerts, omen letter and raid peek', () => {
  installSim({ stage: '2', reset: true, checks: false });
  const s = foundColony({ seed: 'Z35', name: 'Deep Hold', d: 20 });
  const i = idx(40, 50, G.zS - 13);
  s.st.queue.push(newEntry(901, 'deep_breach', s.tick, s.tick + 9 * 600, { stage: 'sighted', plan: { pts: 100, edge: { side: 'deep', i }, goal: 'people', members: ['husk'] }, cause: ['seep', 'seep'], why: 'A seep woke.' }));
  const w = ensureWorld(s);
  const a = idx(20, 20, G.zS - 3), b = idx(30, 30, G.zS - 9), src = idx(5, 5, G.zS - 1);
  s.L.fluid[src] = 16 | 7; s.L.fluid[a] = 5; s.L.fluid[b] = 8 | 3;
  w.fluid = { act: [src, a, b].sort((p, q) => p - q), idle: [0, 0, 0], q: [], cur: 0 };
  const rows = lines(s);
  check('fresh', rows);
  const by = (k) => rows.find((r) => r[0] === k);
  assert.match(by('chip')[1], /-13 Reach/);
  assert.match(by('alert breach')[1], /-13 Reach/);
  assert.match(by('alert flood')[1], /^Flooding at -3 Outer/);
  assert.match(by('alert ember')[1], /^Ember flowing at -9 Mere/);
  assert.match(by('omen letter')[1], /-13 Reach/);
  assert.match(by('raid peek')[1], /-13 Reach.*Go to -13 Reach/);
});

test('the section view: compass words, "Turn", and offered once two levels are explored', () => {
  installSim({ stage: '2', reset: true, checks: false });
  const s = foundColony({ seed: 'SV', name: 'Cut Hold', d: 20 });
  assert.deepEqual(cutWords('x', 61), { title: 'Facing north', where: 'Through the centre', turn: 'Turn the cut to face east' });
  assert.equal(cutWords('x', 5).where, 'Near the north edge');
  assert.deepEqual([cutWords('y', 120).title, cutWords('y', 120).where], ['Facing east', 'Near the east edge']);
  assert.equal(cutWords('y', 40).where, 'West of centre');
  const src = readFileSync(new URL('../../js/ui/section.js', import.meta.url), 'utf8');
  assert.ok(!/N-S|W-E|west to east`|Row \$\{/.test(src), 'no axis codes or row numbers in the section view');
  for (const c of s.col) c.z = G.zS;
  const sum = levelSummary(s);
  sum.dug.fill(0);
  assert.equal(sectionReady(sum), false, 'only the surface: no section view');
  sum.dug[G.zS - 2] = 1;
  assert.equal(sectionReady(sum), true, 'a second level opened: the section view is offered');
});

test('the speed face shows the state; the idle line names the role', () => {
  assert.deepEqual([0, 1, 2, 3, 5].map(speedFace), ['II', '1x', '2x', '3x', '5x']);
  const c = { hp: {}, drafted: false, job: null, role: ['builder', null] };
  assert.equal(peekJob(c), 'Idle: no Builder work');
  assert.equal(peekJob({ ...c, job: { type: 'idle' }, role: ['miner', null] }), 'Idle: no Miner work');
});

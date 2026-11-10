// Coach marks. The first region of the first run is a guided Act 1 (CORE
// steps), and every later system gets one short intro the first time it
// appears (INTROS): the Realm Map, drafts, the Beacon, Blood Moons, heroes,
// territory, seasons, decrees, events, Merchant, Shrine, combos, the Citadel,
// the modes and each Phase 4 blueprint.
//
// Rules: one tip on screen at a time (a single slot shared by every screen),
// each tip is shown once (ids persist in meta.coachDone), a pulsing ring points
// at the real control, and the tip card is placed where it does not cover that
// control. Tips inside dialogs are inline notes, so they never cover a button.
// "Skip all tips" silences everything until Settings > Reset tips.
//
// UI only: reads game state and the DOM, never changes the simulation.
import { el, tapButton } from './dom.js';
import { BUS } from '../game/hooks.js';
import { BUILDINGS, CATEGORIES } from '../data/buildings.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const now = () => performance.now();
/** Element on screen (not display:none, not inside a .hidden box)? */
function shown(e) {
  if (!e || !e.isConnected || e.closest('.hidden')) return false;
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
const first = (sel) => $$(sel).find(shown) || null;
const day = (c) => c.phase === 'day';

// ---- Guided Act 1: the first region of the first run --------------------------------------
// `done` names a controller event that completes the step; otherwise it has "Got it".
const CORE = [
  { id: 'farm', text: 'Your people need food. Drag a Farm from the build bar onto open land, then tap the check mark.',
    target: () => first('.item[data-type="farm"]') || first('.tab[data-cat="economy"]'), done: 'placed:farm', when: day },
  { id: 'lumber', text: 'Villagers build on their own. Next, place a Lumber Camp near trees: its ring shows the trees it can reach.',
    target: () => first('.item[data-type="lumber"]') || first('.tab[data-cat="economy"]'), done: 'placed:lumber', when: (c) => day(c) && isDone('farm') },
  { id: 'pan', text: 'Drag the map to look around and pinch to zoom. Long-press anything to learn what it is.',
    when: (c) => day(c) && isDone('lumber') },
  { id: 'house', text: 'Houses raise your population cap and pay gold. Newcomers arrive while there is food and room.',
    target: () => first('.item[data-type="house"]') || first('.tab[data-cat="economy"]'), done: 'placed:house', when: (c) => day(c) && isDone('lumber') },
  { id: 'callnight', text: 'Build while the sun is up. When you are ready, Call the Night here, or wait for dusk.',
    target: () => first('.controls .hbtn[aria-label="Call the night"]'), when: (c) => day(c) && c.night === 0 && isDone('house') },
  { id: 'dusk', text: 'Dusk: the red markers at the screen edge show where the Hollow will strike, and how many. Villagers head inside.',
    when: (c) => c.phase === 'dusk' },
  { id: 'sov', text: 'Tap the Sovereign portrait to give orders; time slows. Then tap the ground to move, or a foe to attack.',
    target: () => first('.portraitbox .portrait'), done: 'select:sov', when: (c) => c.phase === 'night' },
  { id: 'nova', text: 'Heartflame Nova blasts every Hollow near the Sovereign. Use it when they crowd in.',
    target: () => first('.abilities .hbtn[aria-label="Heartflame Nova"]'), when: (c) => c.phase === 'night' && c.flags.has('nightmid') },
  { id: 'dawn', text: 'You held the night! Your objective is up here. Meet it, then Light the Beacon to move on.',
    target: () => first('.objective'), when: (c) => day(c) && c.night >= 1 },
  { id: 'defense', text: 'Watchtowers shoot on their own and Walls slow the Hollow. Braziers light the dark; Barracks train squads.',
    target: () => first('.tab[data-cat="defense"]'), when: (c) => day(c) && c.night >= 1 },
];
for (const t of CORE) { t.core = true; t.where = 'region'; }

// ---- One-time intros ------------------------------------------------------------------------
// Short purpose lines for the Phase 4 blueprints, shown when one is first learned.
const BP_TEXT = {
  windmill: 'Farms in its range grow more food.',
  fisher: 'Build it beside a river: it brings food with no villager.',
  mine: 'Place it near grey rock: it digs stone with a vein of gold.',
  temple: 'Morale settles higher, and soldiers and heroes nearby heal.',
  library: 'Every draft and Dawn Offering shows one more option.',
  alchemist: 'It turns spare wood into gold while you hold over 60 wood.',
  obelisk: 'Hollow near it take more magic damage, and it lights the ground.',
  sunspire: 'A Wonder: once finished, every night of the run is 30% shorter.',
  worldforge: 'A Wonder: once finished, your fighters take less damage all run.',
  moonwell: 'A Wonder: once finished, Blood Moons turn into blessings.',
  archery: 'Once built, tap it to train Archers and Crossbowmen.',
  stable: 'Once built, tap it to train Knights, and Scouts who lift the fog.',
  siegeworks: 'Once built, tap it for Ballista Carts and Battlemages.',
};
/** The first Phase 4 blueprint this region knows that has not been introduced yet. */
function newBlueprint(c) {
  const list = c.s && c.s.blueprints;
  if (!list) return null;
  for (const t of list) if (BP_TEXT[t] && BUILDINGS[t] && !isDone('bp-' + t)) return t;
  return null;
}
function bpTarget(t) {
  const def = BUILDINGS[t];
  return first(`.item[data-type="${t}"]`) || (def && first(`.tab[data-cat="${def.cat}"]`));
}

// Inline notes go into a dialog (or a screen column), right under its lead text.
const inDialog = (cls) => (c) => !!(c.modal && c.modal.classList.contains(cls));
function dialogSpot(c) {
  const d = c.modal;
  const after = $(':scope > .lead', d) || $(':scope > h2', d);
  return { parent: d, after };
}

const INTROS = [
  // Screens: main menu, New Realm, Realm Map.
  { id: 'citadel', where: 'inline', text: 'You banked Embers. Spend them in the Ember Citadel on lasting upgrades: new peoples, blueprints and perks.',
    when: (c) => !c.modal && !c.region && (c.meta.embers || 0) > 0 && (c.meta.runs || 0) >= 1 && !!first('[data-menu="citadel"]'),
    target: () => first('[data-menu="citadel"]'), spot: () => { const r = $('.menu-row'); return r && { parent: r.parentNode, after: r }; } },
  { id: 'setup', where: 'inline', text: 'New here? Campaign is the full journey across three acts. Choose a people below, then start your first realm.',
    when: (c) => !c.modal && !!first('.modeseg button.on[data-k="campaign"]'), spot: modeSpot },
  { id: 'mode-endless', where: 'inline', text: 'Endless: one region and no Beacon. Hold as many nights as you can; every 6 nights the Hollow grow stronger.',
    when: (c) => !c.modal && !!first('.modeseg button.on[data-k="endless"]'), spot: modeSpot },
  { id: 'mode-daily', where: 'inline', text: 'Daily Realm: everyone gets the same realm today. Your best score per day is kept below.',
    when: (c) => !c.modal && !!first('.modeseg button.on[data-k="daily"]'), spot: modeSpot },
  { id: 'map', where: 'screen', text: 'This is the Realm Map. Tap a glowing node to see what waits there, then travel. The grey front follows one step behind.',
    when: (c) => !c.modal && !c.region && !!first('.rm-node.s-next'), target: () => $$('.rm-node.s-next').filter(shown),
    doneWhen: () => !!first('.rm-panel') },
  // Dialogs on the road.
  { id: 'draft', where: 'inline', text: 'What you pick stays learned for the whole run. Another draft comes every second dawn.', when: inDialog('rs-draft'), spot: dialogSpot },
  { id: 'merchant', where: 'inline', text: 'Relics and blueprints bought here last the whole run. Unspent gold travels on with you.', when: inDialog('rs-shop'), spot: dialogSpot },
  { id: 'shrine', where: 'inline', text: 'Pick one gift. The Wheel of Fortune shows its odds before you spin.', when: inDialog('rs-shrine'), spot: dialogSpot },
  { id: 'mystery', where: 'inline', text: 'A choice marked with a % is a gamble at those odds. The others are certain.', when: (c) => !c.region && inDialog('rs-event')(c), spot: dialogSpot },
  { id: 'regionevent', where: 'inline', text: 'Your storyteller sends events like this. Each choice lists exactly what it does.', when: (c) => c.region && inDialog('rs-event')(c), spot: dialogSpot },
  { id: 'beaconpick', where: 'inline', text: 'A Beacon bonus lasts for the whole run. Pick the one that suits your realm.', when: inDialog('rs-beacon'), spot: dialogSpot },
  { id: 'decree', where: 'inline', text: 'The Path of the Flame and the Path of the Iron Crown lock each other at tier 3. Not ready? Tap Not now.', when: inDialog('dcr'), spot: dialogSpot },
  // In a region. Earlier entries win when several are due at once.
  { id: 'beacon', where: 'region', text: 'The objective is met! Light the Beacon to move on safely, or stay a night for more Embers.',
    when: (c) => c.phase !== 'night' && !!first('.beacon-btn'), target: () => first('.beacon-btn') },
  { id: 'bloodmoon', where: 'region', text: 'A Blood Moon rises tonight: a double wave led by an elite that does not flee at dawn. The moon counts down to each one.',
    when: (c) => (day(c) || c.phase === 'dusk') && !!(c.s.wave && c.s.wave.blood), target: () => first('.moon') },
  { id: 'endless', where: 'region', text: 'Endless has no Beacon. Hold as long as you can; every 6 nights the Hollow grow as if a new act began.',
    when: (c) => day(c) && c.s.objective && c.s.objective.type === 'endless', target: () => first('.objective') },
  { id: 'omen', where: 'region', text: 'An omen changes tonight\'s wave. Tap the omen button to read it before dusk.',
    when: (c) => day(c) && c.settled && !!first('.hbtn.omen'), target: () => first('.hbtn.omen') },
  { id: 'combo', where: 'region', text: 'You found a combo: some arrangements of buildings transform. The Codex remembers every one you discover.',
    when: (c) => c.phase !== 'night' && c.flagAge('combo') > 3000 },
  { id: 'winter', where: 'region', text: 'Winter: farms freeze, food upkeep rises by half and Houses burn wood. Units outside your land fight weaker.',
    when: (c) => day(c) && c.season === 'winter', target: () => first('.ssn-wheel') },
  { id: 'bp', where: 'region', text: (c) => { const t = c.bp, d = BUILDINGS[t], cat = CATEGORIES.find((k) => k.id === d.cat); return `New blueprint: the ${d.name}${cat ? `, in the ${cat.name} tab` : ''}. ${BP_TEXT[t]}`; },
    key: (c) => 'bp-' + c.bp, when: (c) => day(c) && c.settled && !!(c.bp = newBlueprint(c)), target: (c) => bpTarget(newBlueprint(c)) },
  { id: 'heroes', where: 'region', text: 'Heroes fight and explore on their own. Tap a hero portrait for its card and a one-time Rally order.',
    when: (c) => day(c) && c.settled && c.night >= 1 && !!first('.portrait.hero'), target: () => first('.portrait.hero') },
  { id: 'bounty', where: 'region', text: 'Steer heroes with bounty flags: attack, explore, defend or avoid. Bigger bounties draw more heroes.',
    when: (c) => day(c) && c.settled && c.night >= 1 && isDone('heroes') && !!first('.hbtn.bounty'), target: () => first('.hbtn.bounty') },
  { id: 'territory', where: 'region', text: 'You can only build inside your land, within the gold border. Tap ground outside it to claim the next zone.',
    when: (c) => day(c) && c.settled && c.night >= 1 && c.s.ext && !!c.s.ext.territory },
  { id: 'seasons', where: 'region', text: 'Seasons turn every 2 days; the wheel shows what comes next. Winter freezes farms, so store food before it.',
    when: (c) => day(c) && c.settled && c.night >= 2 && !!first('.ssn-wheel'), target: () => first('.ssn-wheel') },
  { id: 'mood', where: 'region', text: 'Morale speeds work. Dread grows with deaths and the dark; if it reaches 100, your people abandon you.',
    when: (c) => day(c) && c.settled && c.night >= 2 && !!first('.moodm'), target: () => $$('.moodm').filter(shown) },
];
function modeSpot() { const seg = $('.modeseg'); const p = seg && seg.nextElementSibling; return seg && { parent: seg.parentNode, after: p && p.matches('p.hint') ? p : seg }; }

const ALL = [...CORE, ...INTROS];

// ---- Persistence ----------------------------------------------------------------------------
const M = {
  cur: null,          // { tip, key, node, rings, inline, shownAt, seen }
  lastEnd: 0,         // when the last tip went away (tips never follow each other instantly)
  off: false,         // switched off for this page session (test tools set coach.enabled = false)
  coach: null,        // the live region Coach
  flags: new Set(), flagT: Object.create(null),
  suppressed: false, cardOpen: false,
  raf: 0, lastPoll: 0, modalT: 0,
};
function app() { return (typeof window !== 'undefined' && window.embercrown) || null; }
function meta() { const a = app(); return (a && a.meta) || {}; }
function saveMeta() { const a = app(); if (a && a.saveMeta) a.saveMeta(a.meta); }
function doneList() { const m = meta(); if (!Array.isArray(m.coachDone)) m.coachDone = []; return m.coachDone; }
function isDone(id) { return doneList().includes(id); }
function markDone(id) { const l = doneList(); if (!l.includes(id)) { l.push(id); checkCore(); saveMeta(); } }
function checkCore() { const m = meta(); if (!m.tutorialDone && CORE.every((t) => m.coachDone.includes(t.id))) m.tutorialDone = true; }
/** "Skip all tips" holds until Settings > Reset tips (which clears tutorialDone). */
function skipped() {
  const m = meta();
  if (m.coachSkip && !m.tutorialDone) { delete m.coachSkip; saveMeta(); }
  return !!m.coachSkip;
}
function skipAll() {
  const m = meta();
  m.coachSkip = true; m.tutorialDone = true;
  saveMeta();
  end(false);
}

// ---- Context for the `when` tests -----------------------------------------------------------
function context() {
  const a = app();
  if (!a) return null;
  const ctl = a.ctl;
  const region = !!(ctl && ctl.active && ctl.s);
  const s = region ? ctl.s : null;
  const modal = a.modal && a.modal.open ? $('#modal > .dialog') : null;
  const c = {
    app: a, meta: a.meta || {}, ctl, s, region, modal,
    phase: s ? s.cycle.phase : null, night: s ? s.cycle.night : 0,
    flags: M.flags, flagAge: (f) => (M.flagT[f] ? now() - M.flagT[f] : -1),
    // A region has "settled" a few seconds after it opens (no pile-up of intros on arrival).
    settled: !!(M.coach && now() - M.coach.startT > 4000),
    season: s && BUS.query && BUS.query.season ? BUS.query.season(s) : null,
  };
  return c;
}

// ---- The single tip slot --------------------------------------------------------------------
function textOf(tip, c) { return typeof tip.text === 'function' ? tip.text(c) : tip.text; }
function keyOf(tip, c) { return tip.key ? tip.key(c) : tip.id; }
function targetsOf(tip, c) {
  if (!tip.target) return [];
  const t = tip.target(c);
  return (Array.isArray(t) ? t : [t]).filter(shown);
}

function buildBody(tip, c, cls) {
  const n = el('div', cls);
  n.appendChild(el('div', 'cm-text')).textContent = textOf(tip, c);
  const acts = el('div', 'cm-actions');
  const skip = el('button', 'cbtn', 'Skip all tips');
  tapButton(skip, () => skipAll());
  const ok = el('button', 'cbtn gold', tip.done ? 'Hide' : 'Got it');
  tapButton(ok, () => end(true));
  acts.append(skip, ok);
  n.appendChild(acts);
  return n;
}

function show(tip, c) {
  const key = keyOf(tip, c);
  const cur = { tip, key, node: null, rings: [], inline: tip.where === 'inline', shownAt: now(), seen: 0, lastSeenT: now() };
  if (cur.inline) {
    const spot = tip.spot(c);
    if (!spot || !spot.parent) return false;
    const n = buildBody(tip, c, 'cm-note panel');
    spot.parent.insertBefore(n, spot.after ? spot.after.nextSibling : spot.parent.firstChild);
    cur.node = n;
    markDone(key); // a note inside a dialog is read with it
  } else {
    const root = document.getElementById('root') || document.body;
    const wrap = el('div', 'cm-wrap');
    wrap.appendChild(buildBody(tip, c, 'cm-card panel'));
    root.appendChild(wrap);
    cur.node = wrap;
  }
  M.cur = cur;
  for (const t of targetsOf(tip, c)) revealInScroller(t);
  place();
  if (tip.target) startRings();
  return true;
}

/** Ends the current tip. read=true records it as seen for good. */
function end(read) {
  const cur = M.cur;
  if (!cur) return;
  M.cur = null;
  if (read) markDone(cur.key);
  if (cur.node) cur.node.remove();
  for (const r of cur.rings) r.remove();
  M.lastEnd = now();
}

/** Takes a card off screen without spending it, unless it was visible long enough to read. */
function shelve() {
  const cur = M.cur;
  if (!cur) return;
  const read = !cur.tip.done && cur.seen > 3500;
  end(read);
}

// Build-bar items sit in a horizontal scroller: bring the target into view.
function revealInScroller(t) {
  const sc = t.closest('.items');
  if (!sc || sc.scrollWidth <= sc.clientWidth) return;
  const a = sc.getBoundingClientRect(), b = t.getBoundingClientRect();
  if (b.left < a.left) sc.scrollLeft -= a.left - b.left + 8;
  else if (b.right > a.right) sc.scrollLeft += b.right - a.right + 8;
}

// ---- Placement: the card goes where it covers neither its target nor the HUD -----------------
function rectOf(e) { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }
function overlap(a, b) { const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t); return w > 0 && h > 0 ? w * h : 0; }

function place() {
  const cur = M.cur;
  if (!cur || cur.inline || !cur.node) return;
  const root = document.getElementById('root') || document.body;
  const R = root.getBoundingClientRect();
  const W = R.width, H = R.height;
  const wrap = cur.node;
  const c = context();
  const targets = c ? targetsOf(cur.tip, c).map(rectOf) : [];
  const avoidSel = c && c.region
    ? ['.top', '.corner', '.bottom', '.abilities', '.minimap', '.beacon-btn', '.bossbar', '.card']
    : ['.rm-top', '.rm-id', '.rm-panel'];
  const avoid = [];
  for (const s of avoidSel) for (const e of $$(s)) if (shown(e)) avoid.push(rectOf(e));
  // Free band between the top and bottom HUD.
  let top = 8 + R.top, bot = R.bottom - 8;
  if (c && c.region) {
    const tb = $$('.top, .corner').filter(shown).map((e) => e.getBoundingClientRect().bottom);
    const bb = $$('.bottom').filter(shown).map((e) => e.getBoundingClientRect().top);
    if (tb.length) top = Math.max(...tb) + 8;
    if (bb.length) bot = Math.min(...bb) - 8;
  } else {
    const tb = $$('.rm-top').filter(shown).map((e) => e.getBoundingClientRect().bottom);
    if (tb.length) top = Math.max(...tb) + 8;
  }
  const portrait = H > W;
  const pad = 14;
  const rail = $$('.abilities').filter(shown).map((e) => e.getBoundingClientRect())[0];
  const railW = c && c.region && rail ? rail.width + 12 : 0;
  const w = Math.round(portrait ? Math.min(380, W - 2 * pad - railW) : Math.min(340, W * 0.42));
  wrap.style.width = w + 'px';
  const h = wrap.offsetHeight;
  const lefty = document.body.classList.contains('lefty');
  const xl = R.left + pad + (lefty && portrait ? railW : 0), xr = R.right - pad - w - (lefty ? 0 : railW);
  const xc = R.left + (W - w) / 2;
  const yt = top, yb = Math.max(top, bot - h);
  const cands = portrait
    ? [[xl, yb], [xl, yt], [xc, (yt + yb) / 2]]
    : [[xl, yt], [xr, yt], [xl, yb], [xr, yb]];
  if (portrait && !(c && c.region)) cands.unshift([xc, yt], [xc, yb]);
  let best = null;
  for (const [x, y] of cands) {
    const box = { l: x, t: y, r: x + w, b: y + h };
    let score = 0;
    for (const t of targets) score += overlap(box, t) * 20;
    for (const a of avoid) score += overlap(box, a);
    if (!best || score < best.score) best = { x, y, score };
  }
  wrap.style.left = Math.round(best.x - R.left) + 'px';
  wrap.style.top = Math.round(best.y - R.top) + 'px';
}

// ---- Rings on the real controls -------------------------------------------------------------
function startRings() {
  if (M.raf) return;
  const loop = () => {
    M.raf = 0;
    const cur = M.cur;
    if (!cur || !cur.tip.target) { return; }
    drawRings();
    M.raf = requestAnimationFrame(loop);
  };
  M.raf = requestAnimationFrame(loop);
}
function drawRings() {
  const cur = M.cur, c = context();
  if (!cur || !c) return;
  const hidden = cur.node && cur.node.style.visibility === 'hidden';
  const ts = hidden ? [] : targetsOf(cur.tip, c).slice(0, 6);
  const root = document.getElementById('root') || document.body;
  const R = root.getBoundingClientRect();
  while (cur.rings.length < ts.length) { const r = el('div', 'cm-ring'); root.appendChild(r); cur.rings.push(r); }
  cur.rings.forEach((r, i) => {
    const t = ts[i];
    if (!t) { r.style.display = 'none'; return; }
    const b = t.getBoundingClientRect();
    const round = getComputedStyle(t).borderRadius;
    r.style.display = '';
    r.style.left = Math.round(b.left - R.left - 4) + 'px';
    r.style.top = Math.round(b.top - R.top - 4) + 'px';
    r.style.width = Math.round(b.width + 8) + 'px';
    r.style.height = Math.round(b.height + 8) + 'px';
    r.style.borderRadius = round && round !== '0px' ? `calc(${round} + 4px)` : '10px';
  });
}

// ---- The poll: keep the current tip honest, or pick the next one ----------------------------
function poll() {
  M.lastPoll = now();
  if (typeof document === 'undefined') return;
  if (M.off || skipped()) { if (M.cur) end(false); return; }
  const c = context();
  if (!c) return;
  const cur = M.cur;
  if (cur) {
    const t = cur.tip;
    const t0 = now(), dt = t0 - cur.lastSeenT; cur.lastSeenT = t0;
    if (cur.inline) {
      // A note on a screen stays put under a passing dialog (Settings over the menu).
      const cc = t.spot === dialogSpot ? c : { ...c, modal: null };
      if (!cur.node.isConnected || !t.when(cc)) end(false);
      return;
    }
    // A card belongs to its scene; a dialog opening over it hands the slot to the dialog's note.
    const wrongScene = t.where === 'region' ? !c.region : c.region;
    const busy = c.modal || (c.s && (c.s.pending || c.s.outcome));
    if (wrongScene || busy || !t.when(c) || (t.core && meta().tutorialDone)) { shelve(); }
    else if (t.doneWhen && t.doneWhen(c)) end(true);
    else {
      const hold = t.where === 'region' && (M.suppressed || M.cardOpen);
      cur.node.style.visibility = hold ? 'hidden' : '';
      if (!hold) cur.seen += dt;
      place();
      return;
    }
  }
  if (M.cur) return;
  // Cards wait a moment after any dialog or due choice, so they never flash between two dialogs.
  if (c.modal || (c.s && (c.s.pending || c.s.outcome))) M.modalT = now();
  const calm = now() - (M.modalT || 0) > 700 && now() - M.lastEnd > 1200;
  const m = meta();
  for (const tip of ALL) {
    if (tip.core && m.tutorialDone) continue;
    if (tip.core && !c.region) continue;
    if (tip.where === 'region' && (!c.region || c.modal || M.suppressed || M.cardOpen)) continue;
    if (tip.where === 'screen' && (c.region || c.modal)) continue;
    if (tip.where !== 'inline' && !calm) continue;
    if (!tip.key && isDone(tip.id)) continue;
    let ok = false;
    try { ok = !!tip.when(c); } catch (_) { ok = false; }
    if (!ok) continue;
    if (tip.key && isDone(tip.key(c))) continue;
    if (show(tip, c)) return;
  }
}

if (typeof window !== 'undefined') {
  setInterval(() => { if (now() - M.lastPoll > 200) poll(); }, 250);
  window.addEventListener('resize', () => setTimeout(place, 150));
  // Tapping the highlighted control means the tip did its job (steps with a `done` event
  // wait for that event instead: tapping the Farm button is not yet placing a Farm).
  window.addEventListener('pointerdown', (e) => {
    const cur = M.cur, c = cur && context();
    if (!c || cur.tip.done || !cur.tip.target || !(e.target instanceof Element)) return;
    if (targetsOf(cur.tip, c).some((t) => t.contains(e.target))) end(true);
  }, true);
}

// Simulation events that open an intro (UI side only).
BUS.fx.push((ctl, e) => {
  if (e.t === 'combo' && e.good !== false) { M.flags.add('combo'); M.flagT.combo = M.flagT.combo || now(); }
});

// ---- The region-facing API the controller uses ----------------------------------------------
export class Coach {
  constructor(root, metaObj, save) {
    this.root = root; this.save = save;
    this.flags = M.flags;
    this.startT = now();
    M.coach = this;
    M.suppressed = false; M.cardOpen = false;
  }
  /** False once tips are skipped or switched off; setting false hides tips for this session. */
  get enabled() { return !M.off && !skipped(); }
  set enabled(v) { if (!v) { M.off = true; end(false); } }
  event(name) {
    if (M.coach !== this) return; // a timer from an older region
    M.flags.add(name);
    const cur = M.cur;
    if (cur && cur.tip.done === name) end(true);
    else if (!meta().tutorialDone) {
      // Did the step's job before its tip came up: count it as learned.
      for (const t of CORE) if (t.done === name && !(cur && cur.tip === t)) markDone(t.id);
    }
    this.next();
  }
  next() { setTimeout(poll, 0); }
  position() { place(); }
  update(phase, cardOpen) {
    M.cardOpen = !!cardOpen;
    if (now() - M.lastPoll > 150) poll();
  }
  finish() { end(true); this.next(); }
  /** Hidden (not dismissed) while the player is placing a building. */
  suppress(on) { M.suppressed = !!on; if (M.cur && !M.cur.inline && M.cur.tip.where === 'region') M.cur.node.style.visibility = on ? 'hidden' : ''; }
  hide() { shelve(); }
  persist() { saveMeta(); }
  reset() {
    shelve();
    for (const f of ['dusk', 'night', 'nightmid', 'day2', 'dawnclosed']) M.flags.delete(f);
    this.startT = now();
  }
}

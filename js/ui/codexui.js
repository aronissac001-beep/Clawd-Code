// The Codex (Bestiary, Relics, Combos, Events, Buildings, Heroes) and the Feats screen.
// Full-screen DOM screens opened from the main menu (BUS.menu entries registered by
// js/game/meta/records.js). Pure UI: reads app.meta, never touches a simulation.
// Portraits are drawn with the game's own sprite code (unit sprites, boss/rift art hooks,
// BUS.draw.entity custom kinds, building sprites) and cached per type.
import { BUS, ART_HOOKS } from '../game/hooks.js';
import { ENEMIES } from '../data/enemies.js';
import { RELICS, RARITIES } from '../data/relics.js';
import { COMBOS } from '../data/combos.js';
import { EVENTS } from '../data/events.js';
import { REGION_EVENTS } from '../data/regionevents.js';
import { BUILDINGS } from '../data/buildings.js';
import { HERO_CLASSES } from '../data/heroes.js';
import { FACTIONS } from '../data/factions.js';
import { MATCHUPS } from '../data/balance.js';
import { ACH_GROUPS, activeAchievements } from '../data/achievements.js';
import { UNIT_ART, unitSprite, buildingSprite, BUILDING_ART } from '../engine/sprites.js';
import { el, tapButton, costHtml } from './dom.js';
import { icon } from './icons.js';
import { ensureMeta, achStatus, achEmbers, catchUp } from '../game/meta/records.js';

const DMG_NAME = { blade: 'Blades', pierce: 'Arrows', crush: 'Mauls', fire: 'Fire', magic: 'Magic' };
const TAG_NAME = { hollow: 'Hollow', infantry: 'Infantry', beast: 'Beast', spirit: 'Spirit', armored: 'Armored', boss: 'Boss', rift: 'Rift', lair: 'Den' };
const CAT_NAME = { economy: 'Economy', defense: 'Defense', military: 'Military', wonder: 'Wonders', faith: 'Faith', civic: 'Civic' };
const HERALDRY = { field: '#7a2a2a', charge: '#e8c25a', second: '#2a4a7a', division: 'plain', sigil: 'sun', name: 'Codex' };

// ---- Screen scaffolding --------------------------------------------------------------------
function screenShell(app, title, cls) {
  const root = el('div', `screen cx-screen ${cls || ''}`);
  const top = el('div', 'cx-top');
  const head = el('div', 'cx-head');
  const back = el('button', 'hbtn cx-back', icon('x'));
  back.setAttribute('aria-label', 'Back to the menu');
  tapButton(back, () => app.toMenu());
  const h = el('h2', 'cx-title'); h.textContent = title;
  const sum = el('div', 'cx-sum');
  head.append(back, h, sum);
  top.appendChild(head);
  const list = el('div', 'cx-list');
  root.append(top, list);
  const screens = document.getElementById('screens');
  if (screens) { screens.innerHTML = ''; screens.appendChild(root); }
  return { root, top, head, sum, list };
}

// ---- Portraits ------------------------------------------------------------------------------
const art = new Map(); // key -> canvas (cropped colour art) | null
const sil = new Map(); // key -> silhouette canvas

function fakeMover(type, def, kind) {
  return {
    id: 7, kind, type, cls: type, x: 0, y: 0, px: 0, py: 0, z: 0, hp: def.hp || 100, maxHp: def.hp || 100,
    r: def.radius || 8, face: 1, anim: 0, hitT: 0, atkT: 0, cd: 0, alive: true, scale: 1, phase: 1, ang: 0.4,
    flying: false, level: 1, perks: [], lairKind: def.lairKind || undefined, weak: null, pose: null, poseT: 0,
  };
}

/** Draw a world-space art function onto a big scratch canvas and crop it to its pixels. */
// One shared scratch canvas: iOS Safari frees canvas memory late, so dozens of 2-3 MB scratch
// canvases on the first Codex open could hit its canvas memory cap.
let scratch = null, scratchG = null;
function cropDraw(draw, k = 2, W = 720, H = 720, ox = 360, oy = 500) {
  if (!scratch) { scratch = document.createElement('canvas'); scratchG = null; }
  if (scratch.width !== W || scratch.height !== H) { scratch.width = W; scratch.height = H; }
  const c = scratch;
  const g = scratchG || (scratchG = c.getContext('2d', { willReadFrequently: true }));
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, W, H);
  g.setTransform(k, 0, 0, k, ox, oy);
  g.lineJoin = 'round'; g.lineCap = 'round';
  try { draw(g, k); } finally { g.restore(); }
  g.setTransform(1, 0, 0, 1, 0, 0);
  const d = g.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W * 4;
    for (let x = 0; x < W; x++) if (d[row + x * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function enemyArt(type) {
  const key = 'e:' + type;
  if (art.has(key)) return art.get(key);
  const def = ENEMIES[type];
  let out = null;
  try {
    const e = fakeMover(type, def || {}, 'enemy');
    if (def && def.boss) e.boss = true;
    if (def && def.stationary) e.stationary = true;
    const custom = BUS.draw.entity[type];
    if (def && def.boss && ART_HOOKS.drawBoss) out = cropDraw((g, k) => ART_HOOKS.drawBoss(g, e, 0, 0, 1, k), 1, 900, 900, 450, 600);
    else if (custom) out = cropDraw((g, k) => custom(g, e, 0, 0, 1, k));
    else if (type === 'rift' && ART_HOOKS.drawRift) out = cropDraw((g, k) => ART_HOOKS.drawRift(g, e, 0, 0, 1, k));
    else if (UNIT_ART[type]) out = cropDraw((g, k) => { const sp = unitSprite(type, 0, false, k); g.drawImage(sp.c, -sp.ax, -sp.ay, sp.w, sp.h); }, 3);
  } catch (err) { console.error('codex portrait', type, err); out = null; }
  art.set(key, out);
  return out;
}

function heroArt(cls) {
  const key = 'h:' + cls;
  if (art.has(key)) return art.get(key);
  let out = null;
  try {
    const draw = BUS.draw.entity.hero;
    const def = HERO_CLASSES[cls] || {};
    if (draw) out = cropDraw((g, k) => draw(g, fakeMover(cls, def, "hero"), 0, 0, 1, k), 3);
    else if (UNIT_ART[cls]) out = cropDraw((g, k) => { const sp = unitSprite(cls, 0, false, k); g.drawImage(sp.c, -sp.ax, -sp.ay, sp.w, sp.h); }, 3);
  } catch (err) { console.error('codex portrait', cls, err); out = null; }
  art.set(key, out);
  return out;
}

function buildingArt(type) {
  const key = 'b:' + type;
  if (art.has(key)) return art.get(key);
  let out = null;
  try {
    if (BUILDING_ART[type]) {
      const sp = buildingSprite(type, 0, 2, HERALDRY);
      out = document.createElement('canvas'); out.width = sp.c.width; out.height = sp.c.height;
      out.getContext('2d').drawImage(sp.c, 0, 0);
    }
  } catch (err) { console.error('codex portrait', type, err); out = null; }
  art.set(key, out);
  return out;
}

function silhouette(key, src) {
  if (sil.has(key)) return sil.get(key);
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#4a4252';
  g.fillRect(0, 0, c.width, c.height);
  sil.set(key, c);
  return c;
}

/** A portrait canvas (CSS size px) showing src fitted, or null if there is no art. */
function portrait(key, src, known, px = 72) {
  if (!src) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = el('canvas', 'cx-art');
  c.width = Math.round(px * dpr); c.height = Math.round(px * dpr);
  const g = c.getContext('2d');
  const img = known ? src : silhouette(key, src);
  const pad = 4 * dpr, box = c.width - pad * 2;
  const k = Math.min(box / img.width, box / img.height);
  const w = img.width * k, h = img.height * k;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, (c.width - w) / 2, c.height - pad - h, w, h);
  return c;
}

function iconArt(name, color, known) {
  const d = el('div', 'cx-icon' + (known ? '' : ' unknown'), icon(known ? name || 'info' : 'lock'));
  if (known && color) d.style.color = color;
  return d;
}

// ---- Entry cards -----------------------------------------------------------------------------------
function card(entry) {
  const c = el('div', 'cx-card' + (entry.known ? '' : ' locked'));
  const pic = el('div', 'cx-pic');
  pic.appendChild(entry.pic || iconArt(entry.icon, entry.color, entry.known));
  const body = el('div', 'cx-body');
  const name = el('div', 'cx-name');
  name.textContent = entry.known ? entry.name : '???';
  if (entry.known && entry.color) name.style.color = entry.color;
  body.appendChild(name);
  if (entry.sub) { const s = el('div', 'cx-subline'); s.textContent = entry.sub; body.appendChild(s); }
  if (entry.text) { const t = el('div', 'cx-text' + (entry.hint ? ' hint-text' : '')); t.textContent = entry.text; body.appendChild(t); }
  for (const l of entry.lines || []) {
    const p = el('div', 'cx-line');
    if (l.label) { const b = el('b'); b.textContent = l.label + ' '; p.appendChild(b); }
    if (l.html) p.insertAdjacentHTML('beforeend', l.html); else p.appendChild(document.createTextNode(l.text));
    if (l.cls) p.classList.add(l.cls);
    body.appendChild(p);
  }
  if (entry.chips && entry.chips.length) {
    const ch = el('div', 'cx-chips');
    for (const x of entry.chips) { const s = el('span', 'cx-chip'); s.textContent = x; ch.appendChild(s); }
    body.appendChild(ch);
  }
  c.append(pic, body);
  if (entry.clamp) {
    c.classList.add('clamp');
    tapButton(c, () => c.classList.toggle('open'), { sound: '' });
  }
  return c;
}

// ---- Tab builders: each returns { sections: [{ title, entries }], have, total } ---------------------
function matchup(def) {
  const weak = [], strong = [];
  for (const dt of Object.keys(MATCHUPS)) {
    let m = 1;
    for (const tag of def.tags || []) if (MATCHUPS[dt][tag]) m *= MATCHUPS[dt][tag];
    const v = Math.round(m * 100) / 100;
    if (v > 1.04) weak.push(`${DMG_NAME[dt] || dt} x${v}`);
    else if (v < 0.96) strong.push(`${DMG_NAME[dt] || dt} x${v}`);
  }
  return { weak, strong };
}
function speedWord(v) { return v == null ? '' : v >= 2 ? 'very fast' : v >= 1.5 ? 'fast' : v >= 1 ? 'steady' : v > 0 ? 'slow' : 'never moves'; }

function bestiary(meta) {
  const C = meta.codex;
  const groups = { hollow: [], beast: [], boss: [], structure: [] };
  for (const type of Object.keys(ENEMIES)) {
    const def = ENEMIES[type];
    const tags = def.tags || [];
    const g = def.boss ? 'boss' : def.stationary ? 'structure' : tags.includes('hollow') ? 'hollow' : 'beast';
    const kills = C.enemies[type] || 0;
    const known = kills > 0 || (def.boss && C.bosses.includes(type));
    const src = enemyArt(type);
    const e = { known, name: def.name || type, icon: def.boss ? 'wyrm' : def.stationary ? 'mystery' : 'skull', pic: portrait('e:' + type, src, known) };
    if (known) {
      const mu = matchup(def);
      e.sub = `${def.stationary ? 'Destroyed' : 'Slain'}: ${kills.toLocaleString()}`;
      e.text = def.desc || '';
      e.lines = [
        { label: 'Health', text: `${def.hp}${def.dmg ? ` · Hits for ${def.dmg} (${(DMG_NAME[def.dmgType] || def.dmgType || '').toLowerCase()})` : ''}${def.stationary ? '' : ` · ${speedWord(def.speed)}`}${def.flying ? ' · flies' : ''}${def.phase ? ' · slips through dark walls' : ''}` },
      ];
      if (def.weak) e.lines.push({ label: 'Counter', text: def.weak, cls: 'good' });
      if (mu.weak.length) e.lines.push({ label: 'Weak to', text: mu.weak.join(', '), cls: 'good' });
      if (mu.strong.length) e.lines.push({ label: 'Resists', text: mu.strong.join(', '), cls: 'bad' });
      e.chips = tags.filter((t) => TAG_NAME[t] && t !== 'boss').map((t) => TAG_NAME[t]);
    } else {
      e.text = def.boss ? 'Defeat this foe to learn its secrets.' : def.stationary ? 'Destroy one to learn more.' : 'Slay one to learn more.';
    }
    groups[g].push(e);
  }
  const sections = [
    { title: 'The Hollow', entries: groups.hollow },
    { title: 'Wild Beasts', entries: groups.beast },
    { title: 'Bosses', entries: groups.boss },
    { title: 'Structures', entries: groups.structure },
  ].filter((s) => s.entries.length);
  return finish(sections);
}

function relics(meta) {
  const have = meta.codex.relics;
  const order = ['common', 'rare', 'legendary', 'cursed'];
  const by = {};
  for (const id of Object.keys(RELICS)) { const r = RELICS[id]; (by[r.rarity] || (by[r.rarity] = [])).push(r); }
  const keys = [...order.filter((k) => by[k]), ...Object.keys(by).filter((k) => !order.includes(k))];
  const sections = keys.map((rar) => {
    const R = RARITIES[rar] || { label: rar, color: '#ccc' };
    return {
      title: `${R.label} relics`,
      entries: by[rar].map((r) => {
        const known = have.includes(r.id);
        return known
          ? { known, name: r.name, icon: r.icon, color: R.color, sub: R.label + (r.set ? ` · ${r.set}` : ''), text: r.text }
          : { known, icon: r.icon, text: `An undiscovered ${R.label.toLowerCase()} relic.` };
      }),
    };
  });
  return finish(sections);
}

function combos(meta) {
  const have = meta.combos || [];
  const good = [], bad = [];
  for (const id of Object.keys(COMBOS)) {
    const c = COMBOS[id];
    const known = have.includes(id);
    const e = known
      ? { known, name: c.name, icon: c.icon, color: c.color, sub: c.good === false ? 'Ill omen' : 'Combo', text: c.text }
      : { known, icon: c.icon, text: c.hint ? `“${c.hint}”` : 'An arrangement not yet found.', hint: true };
    (c.good === false ? bad : good).push(e);
  }
  return finish([{ title: 'Combos', entries: good }, { title: 'Ill omens', entries: bad }].filter((s) => s.entries.length));
}

function events(meta) {
  const run = meta.codex.events, reg = meta.codex.regionEvents;
  const mk = (ev, known, where) => (known
    ? { known, name: ev.title, icon: ev.icon || 'mystery', sub: where, text: ev.text, clamp: true }
    : { known, icon: ev.icon, text: where === 'On the road' ? 'A tale still untold on the road.' : 'Something that has not yet happened in your lands.' });
  return finish([
    { title: 'On the road', entries: Object.values(EVENTS).map((ev) => mk(ev, run.includes(ev.id), 'On the road')) },
    { title: 'In your lands', entries: REGION_EVENTS.map((ev) => mk(ev, reg.includes(ev.id), 'In your lands')) },
  ]);
}

function buildings(meta) {
  const have = meta.codex.buildings;
  const by = {};
  for (const type of Object.keys(BUILDINGS)) {
    const d = BUILDINGS[type];
    if (!d.cat) continue;
    const cat = d.wonder ? 'wonder' : d.cat;
    (by[cat] || (by[cat] = [])).push(type);
  }
  const order = ['economy', 'defense', 'military', 'wonder'];
  const keys = [...order.filter((k) => by[k]), ...Object.keys(by).filter((k) => !order.includes(k))];
  return finish(keys.map((cat) => ({
    title: CAT_NAME[cat] || cat.charAt(0).toUpperCase() + cat.slice(1),
    entries: by[cat].map((type) => {
      const d = BUILDINGS[type];
      const known = have.includes(type);
      const fac = d.faction && FACTIONS[d.faction] ? `${FACTIONS[d.faction].name} only` : '';
      const e = { known, name: d.name, icon: 'hammer', pic: portrait('b:' + type, buildingArt(type), known) };
      if (known) {
        e.sub = [CAT_NAME[cat] || cat, fac].filter(Boolean).join(' · ');
        e.text = d.desc || '';
        const cost = d.levels && d.levels[0] && d.levels[0].cost;
        if (cost && Object.keys(cost).length) e.lines = [{ label: 'Cost', html: costHtml(cost) }];
        if (d.levels && d.levels.length > 1) (e.lines || (e.lines = [])).push({ label: 'Levels', text: String(d.levels.length) });
      } else e.text = fac ? `Raise it to learn more. (${fac})` : 'Raise one to learn more.';
      return e;
    }),
  })));
}

function heroes(meta) {
  const have = meta.codex.heroes;
  return finish([{
    title: 'Heroes',
    entries: Object.keys(HERO_CLASSES).map((cls) => {
      const h = HERO_CLASSES[cls];
      const known = have.includes(cls);
      const e = { known, name: h.name, icon: 'crown', color: known ? h.color : null, pic: portrait('h:' + cls, heroArt(cls), known) };
      if (known) {
        e.sub = h.role || '';
        e.text = h.desc || '';
        e.lines = [{ label: 'Health', text: `${h.hp} · Hits for ${h.dmg} (${(DMG_NAME[h.dmgType] || h.dmgType || '').toLowerCase()})${h.ranged ? ' · ranged' : ''}` }];
        if (h.ability) e.lines.push({ label: h.ability.name, text: h.ability.text });
      } else e.text = 'Recruit one to learn more.';
      return e;
    }),
  }]);
}

function finish(sections) {
  let have = 0, total = 0;
  for (const s of sections) for (const e of s.entries) { total++; if (e.known) have++; }
  return { sections, have, total };
}

export const CODEX_TABS = [
  { id: 'bestiary', label: 'Bestiary', build: bestiary },
  { id: 'relics', label: 'Relics', build: relics },
  { id: 'combos', label: 'Combos', build: combos },
  { id: 'events', label: 'Events', build: events },
  { id: 'buildings', label: 'Buildings', build: buildings },
  { id: 'heroes', label: 'Heroes', build: heroes },
];

/** Discovered/total counts for every Codex tab (cheap: no portraits). */
export function codexCounts(meta) {
  ensureMeta(meta);
  const out = {};
  const C = meta.codex;
  let h = 0, t = 0;
  for (const type of Object.keys(ENEMIES)) { t++; if ((C.enemies[type] || 0) > 0 || (ENEMIES[type].boss && C.bosses.includes(type))) h++; }
  out.bestiary = [h, t];
  out.relics = [Object.keys(RELICS).filter((id) => C.relics.includes(id)).length, Object.keys(RELICS).length];
  out.combos = [Object.keys(COMBOS).filter((id) => (meta.combos || []).includes(id)).length, Object.keys(COMBOS).length];
  out.events = [Object.values(EVENTS).filter((e) => C.events.includes(e.id)).length + REGION_EVENTS.filter((e) => C.regionEvents.includes(e.id)).length, Object.keys(EVENTS).length + REGION_EVENTS.length];
  const bt = Object.keys(BUILDINGS).filter((k) => BUILDINGS[k].cat);
  out.buildings = [bt.filter((k) => C.buildings.includes(k)).length, bt.length];
  out.heroes = [Object.keys(HERO_CLASSES).filter((k) => C.heroes.includes(k)).length, Object.keys(HERO_CLASSES).length];
  return out;
}

// ---- Codex screen ------------------------------------------------------------------------------------
let lastTab = 'bestiary';
export function openCodex(app, tab) {
  const meta = ensureMeta(app.meta);
  catchUp(app);
  const sh = screenShell(app, 'Codex', 'cx-codex');
  const counts = codexCounts(meta);
  let have = 0, total = 0;
  for (const k in counts) { have += counts[k][0]; total += counts[k][1]; }
  sh.sum.textContent = `${have}/${total} discovered`;
  const tabs = el('div', 'cx-tabs');
  tabs.setAttribute('role', 'tablist');
  sh.top.appendChild(tabs);
  const show = (id) => {
    lastTab = id;
    for (const b of tabs.children) { const on = b.dataset.k === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }
    const T = CODEX_TABS.find((x) => x.id === id) || CODEX_TABS[0];
    const data = T.build(meta);
    renderSections(sh.list, data.sections);
    sh.list.scrollTop = 0;
  };
  for (const T of CODEX_TABS) {
    const [h, t] = counts[T.id];
    const b = el('button', 'cx-tab');
    b.dataset.k = T.id;
    b.setAttribute('role', 'tab');
    b.innerHTML = '<span class="l"></span><span class="n"></span>';
    b.querySelector('.l').textContent = T.label;
    b.querySelector('.n').textContent = `${h}/${t}`;
    b.setAttribute('aria-label', `${T.label} ${h} of ${t}`);
    tapButton(b, () => show(T.id));
    tabs.appendChild(b);
  }
  show(tab || lastTab);
  return sh.root;
}

function renderSections(list, sections) {
  list.innerHTML = '';
  for (const s of sections) {
    const known = s.entries.filter((e) => e.known).length;
    const h = el('h3', 'cx-sec');
    h.textContent = `${s.title} · ${known}/${s.entries.length}`;
    list.appendChild(h);
    const grid = el('div', 'cx-grid');
    for (const e of s.entries) grid.appendChild(card(e));
    list.appendChild(grid);
  }
}

// ---- Feats screen ------------------------------------------------------------------------------------
function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function openFeats(app) {
  const meta = ensureMeta(app.meta);
  catchUp(app);
  const sh = screenShell(app, 'Feats', 'cx-feats');
  const list = activeAchievements();
  const done = list.filter((a) => meta.ach[a.id]).length;
  const possible = list.reduce((n, a) => n + a.reward, 0);
  sh.sum.textContent = `${done}/${list.length} earned · ${achEmbers(meta)}/${possible} Embers`;
  const bar = el('div', 'cx-total');
  bar.innerHTML = '<div class="cx-total-l"></div><div class="cx-bar"><i></i></div>';
  bar.querySelector('.cx-total-l').innerHTML = `${icon('trophy')}<span></span>`;
  bar.querySelector('.cx-total-l span').textContent = `${done} of ${list.length} Feats · ${achEmbers(meta)} Embers earned`;
  bar.querySelector('.cx-bar i').style.width = `${list.length ? Math.round((done / list.length) * 100) : 0}%`;
  sh.list.appendChild(bar);
  const groups = [...ACH_GROUPS, ...new Set(list.map((a) => a.group).filter((g) => !ACH_GROUPS.includes(g)))];
  for (const g of groups) {
    const items = list.filter((a) => (a.group || 'Milestones') === g);
    if (!items.length) continue;
    const h = el('h3', 'cx-sec');
    h.textContent = `${g} · ${items.filter((a) => meta.ach[a.id]).length}/${items.length}`;
    sh.list.appendChild(h);
    const grid = el('div', 'cx-grid');
    for (const a of items) grid.appendChild(featCard(meta, a));
    sh.list.appendChild(grid);
  }
  return sh.root;
}

function featCard(meta, a) {
  const st = achStatus(meta, a);
  const c = el('div', 'cx-card cx-feat' + (st.done ? ' earned' : ' locked'));
  c.dataset.id = a.id;
  const pic = el('div', 'cx-pic');
  const med = el('div', 'cx-medal' + (st.done ? ' on' : ''), icon(a.icon || 'trophy'));
  if (!st.done) med.appendChild(el('span', 'cx-lock', icon('lock')));
  pic.appendChild(med);
  const body = el('div', 'cx-body');
  const top = el('div', 'cx-name');
  top.textContent = a.name;
  const rw = el('span', 'cx-reward'); rw.textContent = `+${a.reward}`;
  rw.insertAdjacentHTML('afterbegin', icon('flame'));
  rw.setAttribute('aria-label', `${a.reward} Embers`);
  top.appendChild(rw);
  body.appendChild(top);
  const t = el('div', 'cx-text'); t.textContent = a.text; body.appendChild(t);
  if (st.done) {
    const d = el('div', 'cx-line earn'); d.textContent = `Earned ${fmtDate(st.at)}`; body.appendChild(d);
  } else if (st.target != null && st.target > 1) {
    const p = el('div', 'cx-prog');
    p.innerHTML = '<div class="cx-bar"><i></i></div><span></span>';
    p.querySelector('i').style.width = `${Math.round((st.progress / st.target) * 100)}%`;
    p.querySelector('span').textContent = `${Math.floor(st.progress).toLocaleString()} / ${st.target.toLocaleString()}`;
    body.appendChild(p);
  }
  c.append(pic, body);
  return c;
}

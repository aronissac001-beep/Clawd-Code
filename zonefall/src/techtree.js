// ============================================================================
// ZONEFALL — the workbench tech tree (Rust-style): at a workbench of tier N you
// can spend scrap to learn the blueprints of tier N or lower without owning the
// item. Each tier is a small tree: a few branches, each a short chain where a
// blueprint needs the one above it. Learned blueprints live in G.run.bps (the
// same list the Research Table and found blueprints use).
//
//   TECH[tier] = [{ name, nodes: [[recipeId, scrap], ...] }]   one branch per column
//   techNodes(tier) -> [{ id, cost, pre, branch, col, row }]  (blueprint recipes that are in no
//                      branch go in an "Other" column, so a new blueprint can always be learned)
//   techState(p, node, wb) -> 'learned' | 'ready' | 'poor' | 'locked' | 'bench'
//   unlockTech(p, id) -> true when learned
//   techTreeBody(ui, body, tier)   the Tech tree tab of the craft window
// ============================================================================
import { G } from './state.js';
import { ITEMS, RECIPES, RECIPE, RESEARCH_COST } from './data.js';
import { Build } from './build.js';
import { Sfx } from './audio.js';
import { haveCount, spend } from './player.js';
import { el } from './util.js';

/* global ART */
const artLib = () => (typeof ART !== 'undefined' ? ART : window.ART) || null;
const ic = id => { const A = artLib(); return A && A.iconURL ? A.iconURL(id) : ''; };
const nm = id => ITEMS[id] ? ITEMS[id].name : id;

// costs: dearer than the Research Table (75 / 175 / 350 scrap plus the item itself); deeper and stronger is dearer
export const TECH = {
  1: [
    { name: 'Sidearms', nodes: [['revolver', 100], ['semi_pistol', 125], ['att_silencer', 120]] },
    { name: 'Explosives', nodes: [['grenade', 110]] },
    { name: 'Survival', nodes: [['antirad', 80], ['helm_gas', 95]] },
  ],
  2: [
    { name: 'Close quarters', nodes: [['pump', 220], ['smg', 260], ['magnum', 280]] },
    { name: 'Rifles', nodes: [['semi_rifle', 270], ['att_scope4', 240], ['att_extmag', 230]] },
    { name: 'Sights', nodes: [['att_holo', 210], ['att_laser', 200]] },
    { name: 'Medic & armour', nodes: [['stim', 200], ['vest_plate', 300]] },
    { name: 'Explosives', nodes: [['supply_signal', 250], ['rocket', 300]] },
  ],
  3: [
    { name: 'Assault', nodes: [['lancer', 450], ['ar', 520], ['lmg', 600]] },
    { name: 'Marksman', nodes: [['hunting', 450], ['sniper', 560], ['att_scope8', 480]] },
    { name: 'Close quarters', nodes: [['tac_smg', 420], ['auto_shotgun', 500]] },
    { name: 'Armour', nodes: [['vest_heavy', 520]] },
    { name: 'Explosives', nodes: [['rocket_launcher', 550], ['c4', 600]] },
  ],
};
const DEFAULT_COST = { 1: 100, 2: 250, 3: 500 };

const cache = {};
/** the nodes of one tier's tree, in columns (branches) and rows (depth) */
export function techNodes(tier) {
  if (cache[tier]) return cache[tier];
  const out = [], seen = new Set();
  (TECH[tier] || []).forEach((br, col) => {
    let pre = null;
    br.nodes.forEach(([id, cost], row) => {
      const r = RECIPE[id]; if (!r || !r.bp || r.wb !== tier || seen.has(id)) return;
      seen.add(id); out.push({ id, cost, pre, branch: br.name, col, row }); pre = id;
    });
  });
  // any other blueprint of this tier (added later by another module) still gets a node
  let col = (TECH[tier] || []).length, row = 0;
  for (const r of RECIPES) if (r.bp && r.wb === tier && !seen.has(r.id)) { seen.add(r.id); out.push({ id: r.id, cost: DEFAULT_COST[tier] || 250, pre: null, branch: 'Other', col, row: row++ }); if (row >= 3) { row = 0; col++; } }
  return (cache[tier] = out);
}
export function techNode(id) { for (const t of [1, 2, 3]) { const n = techNodes(t).find(q => q.id === id); if (n) return n; } return null; }
const learned = id => !!(G.run && G.run.bps && G.run.bps.includes(id));
/** learned | ready (can unlock now) | poor (not enough scrap) | locked (needs the blueprint above) | bench (needs a better workbench) */
export function techState(p, n, wb) {
  if (learned(n.id)) return 'learned';
  if (n.pre && !learned(n.pre)) return 'locked';
  if ((RECIPE[n.id].wb || 1) > wb) return 'bench';
  return haveCount(p, 'scrap') >= n.cost ? 'ready' : 'poor';
}
/** spend the scrap and learn the blueprint (at a workbench of that tier or better) */
export function unlockTech(p, id) {
  const n = techNode(id); if (!n || !p || p.dead) return false;
  const st = techState(p, n, Build.wbTier(p.x, p.z));
  if (st !== 'ready') { Sfx.deny(); if (G.ui) G.ui.toast(st === 'learned' ? 'Already learned' : st === 'locked' ? 'Learn ' + nm(RECIPE[n.pre].out) + ' first' : st === 'bench' ? 'Needs a Workbench T' + RECIPE[id].wb + ' nearby' : 'Not enough scrap (' + n.cost + ')'); return false; }
  spend(p, { scrap: n.cost });
  G.run.bps.push(id);
  Sfx.win(); if (G.ui) G.ui.toast('Learned ' + nm(RECIPE[id].out) + ' — craft it at a Workbench T' + RECIPE[id].wb, 'good');
  if (G.onCraft) try { G.onCraft('bp_' + id); } catch (e) { }
  return true;
}

const STATE_TXT = { learned: '✓ Learned', ready: 'Unlock', poor: 'Need scrap', locked: 'Locked', bench: 'Workbench' };
/** the Tech tree tab: tier tabs, the tree for that tier, and a bar with the picked blueprint and its Unlock button */
export function techTreeBody(ui, body, tier) {
  const p = G.player; const wb = Build.wbTier(p.x, p.z); const scrap = haveCount(p, 'scrap');
  tier = tier || ui.techTier || Math.max(1, wb || 1); ui.techTier = tier;
  const wrap = el('div', 'tt');
  // tier tabs + scrap
  const top = el('div', 'tt-top');
  for (const t of [1, 2, 3]) {
    const N = techNodes(t), got = N.filter(n => learned(n.id)).length;
    const b = el('button', 'tt-tier' + (t === tier ? ' on' : '') + (t > wb ? ' far' : ''), 'Workbench T' + t + ' <small>' + got + '/' + N.length + '</small>');
    b.onclick = () => { ui.techTier = t; ui.techSel = null; ui.rebuild(); }; top.appendChild(b);
  }
  top.appendChild(el('span', 'tt-scrap', '<img src="' + ic('scrap') + '"><b>' + scrap + '</b> scrap'));
  wrap.appendChild(top);
  const nodes = techNodes(tier);
  if (tier > wb) wrap.appendChild(el('div', 'tt-warn', wb ? 'You are at a Workbench T' + wb + '. Stand by a Workbench T' + tier + ' to unlock these.' : 'Stand by a Workbench T' + tier + ' (yours, within 9 m) to unlock these.'));
  // the picked node: what you tapped, else the first one you can unlock, else the first not learned
  let sel = nodes.find(n => n.id === ui.techSel) || nodes.find(n => techState(p, n, wb) === 'ready') || nodes.find(n => !learned(n.id)) || nodes[0];
  if (sel) ui.techSel = sel.id;
  // the tree: a root bar, then one column per branch
  const tree = el('div', 'tt-tree');
  const cols = Math.max(1, ...nodes.map(n => n.col + 1));
  tree.style.setProperty('--cols', cols);
  const root = el('div', 'tt-root', 'Workbench T' + tier); tree.appendChild(root);
  for (let c = 0; c < cols; c++) {
    const colN = nodes.filter(n => n.col === c).sort((a, b) => a.row - b.row); if (!colN.length) continue;
    const col = el('div', 'tt-col');
    col.appendChild(el('div', 'tt-link top', ''));
    col.appendChild(el('div', 'tt-br', colN[0].branch));
    colN.forEach((n, i) => {
      const st = techState(p, n, wb);
      if (i > 0) col.appendChild(el('div', 'tt-link' + (learned(colN[i - 1].id) ? ' on' : ''), ''));
      const r = RECIPE[n.id];
      const d = el('button', 'tt-n ' + st + (sel && sel.id === n.id ? ' sel' : ''));
      d.innerHTML = '<img src="' + ic(r.out) + '"><span><b>' + nm(r.out) + '</b><small>' + (st === 'learned' ? '✓ Learned' : st === 'locked' ? '🔒 ' + nm(RECIPE[n.pre].out) : n.cost + ' scrap') + '</small></span>';
      d.title = nm(r.out) + ' — ' + STATE_TXT[st];
      d.onclick = () => { ui.techSel = n.id; Sfx.click(); ui.rebuild(); };
      col.appendChild(d);
    });
    tree.appendChild(col);
  }
  wrap.appendChild(tree);
  // the bar: picked blueprint, what it costs to craft, and the Unlock button
  if (sel) {
    const r = RECIPE[sel.id], st = techState(p, sel, wb);
    const bar = el('div', 'tt-bar ' + st);
    const why = st === 'learned' ? 'Learned. Craft it at a Workbench T' + r.wb + '.' : st === 'locked' ? 'Learn ' + nm(RECIPE[sel.pre].out) + ' first.' : st === 'bench' ? 'Needs a Workbench T' + r.wb + ' nearby.' : st === 'poor' ? 'You need ' + (sel.cost - scrap) + ' more scrap.' : 'Spend ' + sel.cost + ' scrap to learn it for good.';
    const costTxt = Object.entries(r.cost).map(([k, v]) => v + ' ' + nm(k)).join(' · ');
    bar.innerHTML = '<img src="' + ic(r.out) + '"><div class="tt-bt"><b>' + nm(r.out) + '</b><small>Crafts from ' + costTxt + '</small><small class="tt-why">' + why + '</small></div>';
    const b = el('button', st === 'ready' ? 'primary' : '', st === 'learned' ? '✓ Learned' : 'Unlock · ' + sel.cost);
    b.disabled = st !== 'ready';
    b.onclick = () => { if (unlockTech(p, sel.id)) { const nx = nodes.find(n => n.pre === sel.id); ui.techSel = nx ? nx.id : sel.id; } ui.rebuild(); };
    bar.appendChild(b);
    wrap.appendChild(bar);
  }
  wrap.appendChild(el('p', 'dim small tt-foot', 'Scrap from your Tool Cupboard and boxes counts when you are inside your claim. The Research Table is cheaper (' + RESEARCH_COST[1] + ' / ' + RESEARCH_COST[2] + ' / ' + RESEARCH_COST[3] + ' scrap) but uses up the item.'));
  body.appendChild(wrap);
}

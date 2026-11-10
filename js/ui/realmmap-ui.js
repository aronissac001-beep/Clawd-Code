// The Realm Map screen: the act's road drawn as nodes and curved routes, the
// Hollowing fog creeping behind the player, a status strip and a node panel.
import { el, tapButton, iconBtn, fmt } from './dom.js';
import { icon } from './icons.js';
import { banner as drawBanner } from '../engine/sprites.js';
import { NODE_TYPES, OBJECTIVES, actName, reachable, isSwallowed, nodeTypeFor, bossObjective } from '../game/realmmap.js';
import { BUS } from '../game/hooks.js';
import { RELICS, RARITIES } from '../data/relics.js';

const NODE = 56;          // node button size (px)
const BOSS = 72;
const MIN_GAP_L = 88;     // minimum distance between steps, landscape
const MIN_GAP_P = 84;     // portrait
const LANE_MIN = 74;      // minimum cross-axis room per lane (node + label)
const SHORT = { survive: 'Survive', rift: 'Rift', prosperity: 'Prosper', edict: 'Edict', boss: 'Boss' };
const SVGNS = 'http://www.w3.org/2000/svg';

/** Plain-words lines describing what a node offers. */
export function nodeOffers(node, act = 1) {
  const T = nodeTypeFor(node.type, act);
  const lines = [];
  if (node.type === 'region' || node.type === 'cursed' || node.type === 'ruin') lines.push(OBJECTIVES[node.objectiveType] || OBJECTIVES.survive);
  if (node.type === 'boss') lines.push(bossObjective(act));
  lines.push(T.offer);
  return lines;
}

function nodeLabel(node) {
  if (node.type === 'region') return SHORT[node.objectiveType] || 'Region';
  if (node.type === 'boss') return 'Boss';
  if (node.type === 'cursed') return 'Cursed';
  return NODE_TYPES[node.type].name.split(' ')[0];
}

// Let native scrolling through: main.js blocks touchmove outside whitelisted panels.
function allowScroll(e) { e.addEventListener('touchmove', (ev) => ev.stopPropagation(), { passive: true }); }

export function renderRealmMap(container, run, handlers = {}) {
  container.classList.add('rm-screen');
  container.innerHTML = '';
  const reduce = () => document.body.classList.contains('reduce-motion');

  // ---- status strip (readouts are inert; only buttons take taps)
  const top = el('div', 'rm-top');
  const her = el('canvas', 'rm-her'); her.width = 60; her.height = 80;
  const act = el('div', 'rm-act panel');
  const hp = el('div', 'rm-hp panel', `<span class="rm-heart">${icon('heart')}</span><span class="rm-bar"><i></i></span><b></b>`);
  const gold = el('div', 'rm-stat panel', `<span style="color:var(--c-gold)">${icon('gold')}</span><b></b>`);
  const emb = el('div', 'rm-stat panel', `<span class="rm-ember">${icon('flame')}</span><b></b>`);
  gold.title = 'Gold'; emb.title = 'Embers this run';
  const relics = el('div', 'rm-relics');
  allowScroll(relics);
  const menu = iconBtn('menu', 'Menu', 'rm-menu');
  tapButton(menu, () => handlers.onMenu && handlers.onMenu());
  const left = el('div', 'rm-id');
  left.append(her, act);
  top.append(left, hp, gold, emb, relics, menu);

  // ---- map board
  const scroll = el('div', 'rm-scroll');
  allowScroll(scroll);
  const board = el('div', 'rm-board');
  scroll.appendChild(board);
  const probe = el('div', 'rm-probe'); // reads the safe-area paddings as px

  // ---- node panel
  const panel = el('div', 'rm-panel panel hidden');
  allowScroll(panel);

  container.append(top, scroll, panel, probe);

  let sel = null;
  let lastLayout = '';
  const state = { run };

  // Tap on empty map space closes the panel (drags scroll instead).
  let downAt = null;
  scroll.addEventListener('pointerdown', (e) => { downAt = e.target.closest('.rm-node') ? null : [e.clientX, e.clientY]; });
  scroll.addEventListener('pointerup', (e) => {
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 12) closePanel();
    downAt = null;
  });

  function drawStatus() {
    const r = state.run, map = r.map;
    const g = her.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 60, 80);
    if (r.heraldry) { g.save(); g.scale(2.5, 2.5); drawBanner(g, 2, 2, 20, 28, r.heraldry); g.restore(); her.title = r.heraldry.name || ''; }
    const node = r.pos ? map.nodes[r.pos] : null;
    const total = map.steps.length - 1;
    const where = !node ? 'Setting out' : node.type === 'boss' ? nodeTypeFor('boss', map.act || r.act || 1).name : `Step ${node.step + 1}/${total}`;
    act.innerHTML = `<b>${actName(map.act || r.act || 1)}</b><span>–</span><span>${where}</span>`;
    const max = Math.max(1, r.sov ? r.sov.maxHp : 1), cur = Math.max(0, r.sov ? Math.ceil(r.sov.hp) : 0);
    const f = Math.max(0, Math.min(1, cur / max));
    const bar = hp.querySelector('i');
    bar.style.width = (f * 100).toFixed(1) + '%';
    hp.classList.toggle('low', f < 0.35);
    hp.querySelector('b').textContent = `${cur}/${max}`;
    hp.title = 'Sovereign health';
    gold.querySelector('b').textContent = fmt(r.gold || 0);
    emb.querySelector('b').textContent = fmt(r.embers || 0);
    relics.innerHTML = '';
    const owned = r.relics || [];
    if (!owned.length) relics.appendChild(el('span', 'rm-none', 'No relics yet'));
    for (const x of owned) {
      const R = RELICS[x.id] || { name: x.id, icon: 'relic', rarity: 'common' };
      const b = el('button', 'rm-relic' + (x.used ? ' used' : '') + ' r-' + R.rarity, icon(R.icon || 'relic'));
      b.style.setProperty('--rc', (RARITIES[R.rarity] || {}).color || '#c9c2b4');
      b.setAttribute('aria-label', R.name); b.title = R.name;
      const fire = () => handlers.onRelic && handlers.onRelic(x.id);
      tapButton(b, fire, { longpress: fire });
      relics.appendChild(b);
    }
  }

  // Board geometry: steps along the main axis, lanes across it.
  function geometry() {
    const map = state.run.map;
    const W = scroll.clientWidth, H = scroll.clientHeight;
    const ps = getComputedStyle(probe);
    const pl = parseFloat(ps.paddingLeft) || 20, pr = parseFloat(ps.paddingRight) || 20, pb = parseFloat(ps.paddingBottom) || 14;
    const land = W >= H;
    const cols = map.steps.length;
    const maxLanes = Math.max(...map.steps.map((c) => c.length));
    const m = BOSS / 2 + 10;
    let bw, bh, main, cross;
    if (land) {
      const gap = Math.max(MIN_GAP_L, (W - pl - pr - 2 * m) / (cols - 1));
      bw = Math.ceil(pl + pr + 2 * m + gap * (cols - 1));
      const span = Math.max(LANE_MIN * maxLanes, H - 30);
      bh = Math.ceil(span + 30);
      main = (s) => pl + m + s * gap;
      cross = (x) => 8 + x * span;
    } else {
      const gap = Math.max(MIN_GAP_P, (H - pb - 2 * m - 8) / (cols - 1));
      bh = Math.ceil(pb + 2 * m + 8 + gap * (cols - 1));
      const span = Math.max(LANE_MIN * maxLanes, W - pl - pr);
      bw = Math.ceil(span + pl + pr);
      main = (s) => bh - pb - m - s * gap;
      cross = (x) => pl + x * span;
    }
    // Lanes sit evenly across the column; the map's own jitter only nudges them.
    const lx = (n) => { const len = map.steps[n.step].length, even = (n.lane + 0.5) / len; return even + (n.x - even) * 0.35; };
    const pos = (n) => (land ? [main(n.step), cross(lx(n))] : [cross(lx(n)), main(n.step)]);
    return { land, bw, bh, pos, main, W, H };
  }

  function edgePath(a, b, land) {
    const [x1, y1] = a, [x2, y2] = b;
    if (land) { const d = (x2 - x1) * 0.5; return `M${x1} ${y1}C${x1 + d} ${y1} ${x2 - d} ${y2} ${x2} ${y2}`; }
    const d = (y2 - y1) * 0.5;
    return `M${x1} ${y1}C${x1} ${y1 + d} ${x2} ${y2 - d} ${x2} ${y2}`;
  }

  function drawBoard(keepScroll) {
    const r = state.run, map = r.map;
    const G = geometry();
    const prevL = scroll.scrollLeft, prevT = scroll.scrollTop;
    board.innerHTML = '';
    board.style.width = G.bw + 'px'; board.style.height = G.bh + 'px';
    board.classList.toggle('land', G.land); board.classList.toggle('port', !G.land);
    const visited = r.visited || [];
    const front = r.front || 0;
    const next = new Set(r.outcome ? [] : reachable(map, r.pos));
    const travelled = new Set();
    for (let i = 1; i < visited.length; i++) travelled.add(visited[i - 1] + '>' + visited[i]);

    // Edges
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'rm-edges');
    svg.setAttribute('width', G.bw); svg.setAttribute('height', G.bh);
    svg.setAttribute('viewBox', `0 0 ${G.bw} ${G.bh}`);
    const layers = { dim: [], lost: [], travel: [], avail: [] };
    for (const col of map.steps) for (const id of col) {
      const n = map.nodes[id];
      for (const t of n.next) {
        const key = id + '>' + t;
        let cls = 'dim';
        if (travelled.has(key)) cls = 'travel';
        else if (id === r.pos && next.has(t)) cls = 'avail';
        else if (isSwallowed(map, t, front, visited) || isSwallowed(map, id, front, visited)) cls = 'lost';
        layers[cls].push(edgePath(G.pos(n), G.pos(map.nodes[t]), G.land));
      }
    }
    for (const cls of ['lost', 'dim', 'travel', 'avail']) for (const d of layers[cls]) {
      if (cls === 'avail' || cls === 'travel') {
        const glow = document.createElementNS(SVGNS, 'path');
        glow.setAttribute('d', d); glow.setAttribute('class', 'e-glow e-' + cls);
        svg.appendChild(glow);
      }
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', d); p.setAttribute('class', 'e e-' + cls);
      svg.appendChild(p);
    }
    board.appendChild(svg);

    // The Hollowing: fog over every step behind the front.
    if (front > 0) {
      const fog = el('div', 'rm-fog');
      const edge = (G.main(front - 1) + G.main(front)) / 2;
      const fade = 46;
      if (G.land) { fog.style.left = '0px'; fog.style.top = '0px'; fog.style.height = G.bh + 'px'; fog.style.width = Math.max(0, edge + fade) + 'px'; }
      else { fog.style.left = '0px'; fog.style.width = G.bw + 'px'; fog.style.top = Math.max(0, edge - fade) + 'px'; fog.style.height = (G.bh - edge + fade) + 'px'; }
      fog.innerHTML = '<i class="f1"></i><i class="f2"></i>';
      board.appendChild(fog);
    }

    // Nodes
    for (const col of map.steps) for (const id of col) {
      const n = map.nodes[id];
      const T = nodeTypeFor(n.type, map.act || 1);
      const [x, y] = G.pos(n);
      const size = n.type === 'boss' ? BOSS : NODE;
      const b = el('button', 'rm-node t-' + n.type, `<span class="rm-disc">${icon(T.icon)}</span><span class="rm-lbl"></span>`);
      b.querySelector('.rm-lbl').textContent = nodeLabel(n);
      b.style.left = (x - size / 2) + 'px'; b.style.top = (y - size / 2) + 'px';
      b.style.width = size + 'px'; b.style.height = size + 'px';
      b.dataset.id = id;
      const st = nodeState(n);
      b.classList.add('s-' + st);
      if (id === sel) b.classList.add('sel');
      b.setAttribute('aria-label', `${T.name}${n.objectiveType && n.type !== 'boss' ? ': ' + OBJECTIVES[n.objectiveType] : ''}`);
      tapButton(b, () => openPanel(id));
      board.appendChild(b);
    }

    if (keepScroll) { scroll.scrollLeft = prevL; scroll.scrollTop = prevT; }
    else focusCurrent(G, false);
  }

  function nodeState(n) {
    const r = state.run;
    if (n.id === r.pos) return 'here';
    if ((r.visited || []).includes(n.id)) return 'visited';
    if (isSwallowed(r.map, n.id, r.front || 0, r.visited)) return 'swallowed';
    if (!r.outcome && reachable(r.map, r.pos).includes(n.id)) return 'next';
    return 'later';
  }

  // Scroll so the player's position and next choices are in view.
  function focusCurrent(G, smooth) {
    const r = state.run;
    const step = r.pos ? r.map.nodes[r.pos].step : 0;
    const target = G.main(Math.min(r.map.steps.length - 1, step + (r.pos ? 0.5 : 0)));
    const opts = { behavior: smooth && !reduce() ? 'smooth' : 'auto' };
    if (G.land) scroll.scrollTo({ left: Math.max(0, target - G.W * 0.4), ...opts });
    else scroll.scrollTo({ top: Math.max(0, target - G.H * 0.6), ...opts });
  }

  function openPanel(id) {
    const r = state.run, n = r.map.nodes[id];
    if (!n) return;
    sel = id;
    for (const b of board.querySelectorAll('.rm-node')) b.classList.toggle('sel', b.dataset.id === id);
    const T = nodeTypeFor(n.type, r.map.act || r.act || 1);
    const st = nodeState(n);
    panel.className = 'rm-panel panel t-' + n.type;
    panel.innerHTML = '';
    const head = el('div', 'rm-ph', `<span class="rm-disc">${icon(T.icon)}</span><div><h3></h3><span class="rm-chip"></span></div>`);
    head.querySelector('h3').textContent = T.name;
    const chip = head.querySelector('.rm-chip');
    chip.textContent = { here: 'You are here', visited: 'Visited', swallowed: 'Swallowed by the Hollowing', next: 'On your road', later: 'Further ahead' }[st];
    chip.classList.add('c-' + st);
    const x = el('button', 'rm-x', icon('x')); x.setAttribute('aria-label', 'Close');
    tapButton(x, closePanel);
    panel.append(head, x);
    panel.appendChild(el('p', 'rm-blurb', T.blurb));
    const ul = el('ul', 'rm-offers');
    for (const line of nodeOffers(n, r.map.act || r.act || 1)) { const li = el('li', '', icon(n.type === 'cursed' && line === T.offer ? 'skull' : 'check')); li.appendChild(document.createTextNode(line)); ul.appendChild(li); }
    panel.appendChild(ul);
    if (n.biome === 'ruins' && n.type !== 'boss') panel.appendChild(el('p', 'rm-note', 'Terrain: the Ruined Marches.'));
    // Plug-ins (region modifiers and the like) describe what else waits there.
    for (const f of BUS.mapNode) for (const line of f(n) || []) panel.appendChild(el('p', 'rm-note')).textContent = line;
    if (st === 'next') {
      const go = el('button', 'big-btn rm-go', icon('play') + '<span>Travel</span>');
      tapButton(go, () => handlers.onTravel && handlers.onTravel(id), { sound: 'ok' });
      panel.appendChild(go);
    } else {
      const why = { here: 'Your Sovereign stands here.', visited: 'You have already passed through.', swallowed: 'The Hollowing has devoured this place. There is no way back.', later: 'Not reachable from where you stand yet.' }[st];
      panel.appendChild(el('p', 'rm-note', why));
    }
    panel.classList.remove('hidden');
    reveal(id);
  }

  // Make room beside/below the panel and scroll the chosen node out from under it.
  function reveal(id) {
    const b = board.querySelector(`.rm-node[data-id="${id}"]`);
    if (!b) return;
    const land = board.classList.contains('land');
    const pr = panel.getBoundingClientRect(), nr = b.getBoundingClientRect(), sr = scroll.getBoundingClientRect();
    board.style.marginRight = land ? Math.ceil(pr.width + 16) + 'px' : '';
    board.style.marginBottom = land ? '' : Math.ceil(pr.height + 16) + 'px';
    const opts = { behavior: reduce() ? 'auto' : 'smooth' };
    if (land && nr.right + 12 > pr.left) scroll.scrollBy({ left: nr.right + 12 - pr.left, ...opts });
    if (!land && nr.bottom + 34 > pr.top) scroll.scrollBy({ top: nr.bottom + 34 - pr.top, ...opts }); // 34: room for the label
    else if (!land && nr.top < sr.top) scroll.scrollBy({ top: nr.top - sr.top - 12, ...opts });
  }

  function closePanel() {
    if (panel.classList.contains('hidden')) return;
    sel = null;
    panel.classList.add('hidden');
    board.style.marginRight = ''; board.style.marginBottom = '';
    for (const b of board.querySelectorAll('.rm-node.sel')) b.classList.remove('sel');
  }

  function layout(force) {
    const key = scroll.clientWidth + 'x' + scroll.clientHeight;
    if (!force && key === lastLayout) return;
    const first = !lastLayout;
    lastLayout = key;
    drawBoard(!first);
    if (!first) focusCurrent(geometry(), false);
  }

  let ro = null, onWin = null;
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => layout(false)); ro.observe(scroll); }
  else { onWin = () => layout(false); window.addEventListener('resize', onWin); }

  drawStatus();
  layout(true);

  return {
    update(nextRun) {
      if (nextRun) state.run = nextRun;
      closePanel();
      drawStatus();
      drawBoard(true);
      focusCurrent(geometry(), true);
    },
    openNode: openPanel,
    closePanel,
    destroy() {
      if (ro) ro.disconnect();
      if (onWin) window.removeEventListener('resize', onWin);
      container.innerHTML = '';
      container.classList.remove('rm-screen');
    },
  };
}

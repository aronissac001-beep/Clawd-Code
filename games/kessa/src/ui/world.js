// ===== world.js (ui) : the World tab. A drawn regional map of Kessa with the rival colonies, remote sites and expeditions;
// the rivalry board and the race; trade offers; and the expedition planner. =====
const SPEC_ICON = { engineer: 'engineer', scientist: 'scientist', botanist: 'botanist', medic: 'medic', security: 'security', geologist: 'geologist', none: 'none' };
// icons drawn on the map are parsed once into Path2D lists
const ICON_PATHS = new Map();
function iconPaths(name) {
  let list = ICON_PATHS.get(name); if (list) return list; list = [];
  const box = document.createElement('div'); box.innerHTML = '<svg>' + (ICONS[name] || ICONS.none) + '</svg>';
  for (const el of box.firstChild.children) {
    const a = n => parseFloat(el.getAttribute(n) || '0'); let p = null;
    if (el.tagName === 'path') p = new Path2D(el.getAttribute('d'));
    else if (el.tagName === 'circle') { p = new Path2D(); p.arc(a('cx'), a('cy'), a('r'), 0, Math.PI * 2); }
    else if (el.tagName === 'ellipse') { p = new Path2D(); const t = /rotate\((-?[\d.]+)/.exec(el.getAttribute('transform') || ''); p.ellipse(a('cx'), a('cy'), a('rx'), a('ry'), t ? +t[1] * Math.PI / 180 : 0, 0, Math.PI * 2); }
    else if (el.tagName === 'rect') { p = new Path2D(); p.rect(a('x'), a('y'), a('width'), a('height')); }
    if (p) list.push([p, el.getAttribute('fill') === 'currentColor']);
  }
  ICON_PATHS.set(name, list); return list;
}
function mapIcon(c, name, x, y, size, col) { c.save(); c.translate(x - size / 2, y - size / 2); c.scale(size / 24, size / 24); c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2; c.lineCap = 'round'; c.lineJoin = 'round'; for (const [p, f] of iconPaths(name)) { if (f) c.fill(p); c.stroke(p); } c.restore(); }
// ---------- the regional map: terrain baked once per look, markers drawn live ----------
const WMAP = { key: '', base: null, raf: 0, sel: null };
function worldNames(G) {
  const r = KC.RNG.fromSeed(G.seed + '/names'), A = ['Amber', 'Ashen', 'Cinder', 'Dusk', 'Ember', 'Frost', 'Hollow', 'Mica', 'Onyx', 'Pale', 'Quiet', 'Rime', 'Rust', 'Salt', 'Slate', 'Umber', 'Veil', 'Wind'], B = ['Basin', 'Shelf', 'Steppe', 'Reach', 'Plain', 'Flats', 'Uplands', 'Scarp', 'Barrens', 'Waste'];
  const out = []; for (let i = 0; i < 5; i++) out.push({ t: r.pick(A) + ' ' + r.pick(B), x: 0.12 + r.next() * 0.76, y: 0.14 + r.next() * 0.72, a: r.range(-0.25, 0.25) });
  return out;
}
function worldBase(G, W0, H0, dpr) {
  const T = G.terra || { warm: 0, water: 0, life: 0, veil: 0 }, key = [G.seed, W0, H0, dpr, Math.round(T.warm / 10), Math.round(T.water / 10), Math.round(T.life / 10)].join('|');
  if (WMAP.key === key && WMAP.base) return WMAP.base;
  const W = Math.round(W0 * dpr), H = Math.round(H0 * dpr), cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d'), nz = makeNoise(KC.RNG.fromSeed(G.seed + '/worldmap')), img = c.createImageData(W, H), d = img.data;
  const sea = clamp((T.water - 20) / 80, 0, 0.5), cap = clamp(T.warm / 70, 0, 0.7), green = clamp(T.life / 70, 0, 0.85);
  const step = 2, e = new Float32Array(Math.ceil(W / step + 1) * Math.ceil(H / step + 1)), gw = Math.ceil(W / step + 1);
  for (let gy = 0, py = 0; py <= H + step; gy++, py += step) for (let gx = 0, px = 0; px <= W + step; gx++, px += step) { const u = px / W * 4.2, v = py / H * 2.4; if (gy * gw + gx < e.length) e[gy * gw + gx] = nz.fbm(u + 5, v + 3, 5) * 0.5 + 0.5 + nz.ridge(u * 1.6 + 9, v * 1.6, 3) * 0.18 - 0.09; }
  const E = (px, py) => { const gx = Math.min(gw - 2, Math.floor(px / step)), gy = Math.min(Math.floor(e.length / gw) - 2, Math.floor(py / step)), fx = px / step - gx, fy = py / step - gy, i = gy * gw + gx; return (e[i] * (1 - fx) + e[i + 1] * fx) * (1 - fy) + (e[i + gw] * (1 - fx) + e[i + gw + 1] * fx) * fy; };
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const i = (py * W + px) * 4, h0 = E(px, py), lit = clamp(0.92 + (E(px + 2, py + 2) - h0) * -16, 0.55, 1.35), lat = Math.abs(py / H - 0.5) * 2;
    let col;
    // relief by altitude band from the shared palette, blended across each band edge so the map reads as smooth terrain
    const PW = PAL.world, bands = [[0.36, PW.low], [0.5, PW.plain], [0.62, PW.mid], [0.72, PW.high], [9, PW.peak]], mixc = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    if (h0 < 0.36 + sea * 0.4) col = h0 < 0.3 + sea * 0.4 && sea > 0 ? mixc(PW.seaDeep, PW.seaShallow, clamp((h0 - 0.2) / (0.1 + sea * 0.4), 0, 1)) : sea > 0 ? PW.seaShallow : PW.low;
    else { let i = 1; while (h0 >= bands[i][0]) i++; const lo = bands[i - 1][0], k = clamp((h0 - lo) / 0.03, 0, 1); col = mixc(bands[i - 1][1], bands[i][1], 0.5 + 0.5 * k); }
    // frost at the high latitudes, thinner as Kessa warms
    const frost = lat - (0.78 + cap * 0.2) + nz.fbm(px / W * 9, py / H * 5, 2) * 0.08;
    if (frost > 0) { const k = clamp(frost * 9, 0, 0.9); col = [col[0] * (1 - k) + PAL.world.ice[0] * k, col[1] * (1 - k) + PAL.world.ice[1] * k, col[2] * (1 - k) + PAL.world.ice[2] * k]; }
    if (green > 0 && h0 >= 0.36 + sea * 0.4) { const gv = nz.fbm(px / W * 6 + 20, py / H * 4, 3) * 0.5 + 0.5; if (gv < green * 0.8) { const k = clamp((green * 0.8 - gv) * 3, 0, 0.7); col = [col[0] * (1 - k) + PAL.world.green[0] * k, col[1] * (1 - k) + PAL.world.green[1] * k, col[2] * (1 - k) + PAL.world.green[2] * k]; } }
    // contour lines
    const band = (h0 * 14) % 1; const cl = band < 0.07 ? 0.82 : 1;
    d[i] = clamp(col[0] * lit * cl, 0, 255); d[i + 1] = clamp(col[1] * lit * cl, 0, 255); d[i + 2] = clamp(col[2] * lit * cl, 0, 255); d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  c.scale(dpr, dpr);
  // craters with lit far rims
  const rr = KC.RNG.fromSeed(G.seed + '/wcraters');
  for (let k = 0; k < 16; k++) { const x = rr.next() * W0, y = rr.next() * H0, r = 3 + rr.next() * (k < 3 ? 16 : 7); c.fillStyle = 'rgba(40,24,16,.28)'; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.strokeStyle = 'rgba(255,230,190,.35)'; c.lineWidth = 1.1; c.beginPath(); c.arc(x, y, r, Math.PI * 1.05, Math.PI * 1.85); c.stroke(); c.strokeStyle = 'rgba(30,16,10,.4)'; c.beginPath(); c.arc(x, y, r, 0.1, Math.PI * 0.9); c.stroke(); }
  // graticule, region names, compass and scale
  c.strokeStyle = 'rgba(255,240,220,.1)'; c.lineWidth = 1; c.beginPath(); for (let k = 1; k < 6; k++) { c.moveTo(W0 * k / 6, 0); c.lineTo(W0 * k / 6, H0); } for (let k = 1; k < 4; k++) { c.moveTo(0, H0 * k / 4); c.lineTo(W0, H0 * k / 4); } c.stroke();
  c.font = 'italic 600 9px -apple-system, system-ui, sans-serif'; c.textAlign = 'center';
  for (const n of worldNames(G)) { c.save(); c.translate(n.x * W0, n.y * H0); c.rotate(n.a); c.fillStyle = 'rgba(40,22,12,.55)'; c.fillText(n.t.toUpperCase().split('').join(String.fromCharCode(8202)), 0.6, 0.6); c.fillStyle = 'rgba(255,236,210,.55)'; c.fillText(n.t.toUpperCase().split('').join(String.fromCharCode(8202)), 0, 0); c.restore(); }
  const cx = W0 - 22, cy = 22; c.strokeStyle = 'rgba(255,236,210,.7)'; c.fillStyle = 'rgba(20,12,8,.45)'; c.beginPath(); c.arc(cx, cy, 13, 0, 7); c.fill(); c.stroke();
  c.fillStyle = '#ffc68a'; c.beginPath(); c.moveTo(cx, cy - 11); c.lineTo(cx + 3.5, cy); c.lineTo(cx, cy + 3); c.lineTo(cx - 3.5, cy); c.fill(); c.fillStyle = 'rgba(255,236,210,.6)'; c.beginPath(); c.moveTo(cx, cy + 11); c.lineTo(cx + 3.5, cy); c.lineTo(cx, cy - 3); c.lineTo(cx - 3.5, cy); c.fill();
  c.font = '700 8px -apple-system, system-ui, sans-serif'; c.fillStyle = '#ffe6c4'; c.fillText('N', cx, cy - 15);
  c.fillStyle = 'rgba(20,12,8,.62)'; roundRect(c, 8, H0 - 22, 62, 16, 5); c.fill(); c.fillStyle = '#ffe6c4'; c.fillRect(13, H0 - 10, 24, 2.5); c.fillStyle = 'rgba(255,230,200,.45)'; c.fillRect(37, H0 - 10, 26, 2.5); c.font = '700 8px -apple-system, system-ui, sans-serif'; c.textAlign = 'left'; c.fillStyle = '#ffe6c4'; c.fillText('400 km', 13, H0 - 13);
  // vignette
  const v = c.createRadialGradient(W0 / 2, H0 / 2, Math.min(W0, H0) * 0.35, W0 / 2, H0 / 2, Math.max(W0, H0) * 0.7); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(10,6,4,.55)'); c.fillStyle = v; c.fillRect(0, 0, W0, H0);
  WMAP.key = key; WMAP.base = cv; return cv;
}
// where each thing sits on the map, in canvas px
function worldMarkers(G, W0, H0) {
  const Wd = KC.worldOf(G), out = [];
  out.push({ k: 'home', id: 0, x: Wd.home.x * W0, y: Wd.home.y * H0, r: 13 });
  for (const rv of Wd.rivals) out.push({ k: 'rival', id: rv.k, x: rv.x * W0, y: rv.y * H0, r: 12, rv });
  for (const s of Wd.sites) if (!s.claimed || s.claimed === 'you' || (KC.solOf(G.tick) - (s.by || 0) < 30)) out.push({ k: 'site', id: s.id, x: s.x * W0, y: s.y * H0, r: 11, s });
  return out;
}
function drawWorldMap(cv, G, t) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), W0 = cv._w, H0 = cv._h, c = cv.getContext('2d'), Wd = KC.worldOf(G);
  c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(worldBase(G, W0, H0, dpr), 0, 0); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const mk = worldMarkers(G, W0, H0), at = (k, id) => mk.find(m => m.k === k && m.id === id), home = at('home', 0);
  // routes: your expedition and rival expeditions, dashed arcs with a moving craft
  const arc = (a, b, col, prog, w) => { const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - Math.hypot(b.x - a.x, b.y - a.y) * 0.25; c.strokeStyle = col; c.lineWidth = w || 1.4; c.setLineDash([4, 4]); c.lineDashOffset = -t * 12; c.beginPath(); c.moveTo(a.x, a.y); c.quadraticCurveTo(mx, my, b.x, b.y); c.stroke(); c.setLineDash([]); if (prog !== undefined) { const u = clamp(prog, 0, 1), x = (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * mx + u * u * b.x, y = (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * my + u * u * b.y; return [x, y]; } return null; };
  for (const s of Wd.sites) if (s.rv) { const rvm = at('rival', s.rv.r), sm = at('site', s.id); if (rvm && sm) { const rv = KC.rivalOf(G, s.rv.r); arc(rvm, sm, hexA(KC.RIVALS[rv.k].color, 0.7), undefined, 1.1); } }
  for (const e of Wd.exps) {
    const sm = at('site', e.site); if (!sm) continue;
    const total = e.travel * 24, prog = e.phase === 'out' ? 1 - e.t / total : e.phase === 'work' ? 1 : e.t / total;
    const p = arc(home, sm, 'rgba(255,198,138,.9)', prog, 1.8);
    if (p && e.phase !== 'work') { c.save(); c.translate(p[0], p[1]); c.fillStyle = 'rgba(255,170,90,.35)'; c.beginPath(); c.arc(0, 0, 7 + Math.sin(t * 6) * 1.5, 0, 7); c.fill(); c.restore(); mapIcon(c, 'skimmer', p[0], p[1], 13, '#fff2de'); }
  }
  // sites
  for (const m of mk) if (m.k === 'site') {
    const s = m.s, D = KC.SITES[s.kind], mine = s.claimed === 'you', gone = s.claimed && !mine, sel = WMAP.sel && WMAP.sel.k === 'site' && WMAP.sel.id === s.id;
    if (!gone) { const ph = (t * 0.7 + s.id * 0.3) % 1; c.strokeStyle = 'rgba(143,214,245,' + (0.5 * (1 - ph)).toFixed(2) + ')'; c.lineWidth = 1.2; c.beginPath(); c.arc(m.x, m.y, 9 + ph * 9, 0, 7); c.stroke(); }
    c.fillStyle = gone ? 'rgba(40,34,30,.85)' : mine ? 'rgba(40,70,40,.92)' : 'rgba(18,30,38,.92)'; c.strokeStyle = sel ? '#ffc68a' : gone ? 'rgba(160,150,140,.7)' : mine ? '#8fdc8a' : '#8fd6f5'; c.lineWidth = sel ? 2.4 : 1.5;
    c.beginPath(); c.moveTo(m.x, m.y - 10); c.lineTo(m.x + 10, m.y); c.lineTo(m.x, m.y + 10); c.lineTo(m.x - 10, m.y); c.closePath(); c.fill(); c.stroke();
    mapIcon(c, D.icon, m.x, m.y, 11, gone ? '#9a9088' : '#eaf6ff');
    if (s.claimed && s.claimed !== 'lost') { const col = mine ? '#8fdc8a' : KC.RIVALS[s.claimed].color; c.strokeStyle = '#1a120c'; c.lineWidth = 1; c.fillStyle = col; c.beginPath(); c.moveTo(m.x + 6, m.y - 6); c.lineTo(m.x + 6, m.y - 19); c.lineTo(m.x + 14, m.y - 16); c.lineTo(m.x + 6, m.y - 13); c.fill(); c.strokeStyle = col; c.beginPath(); c.moveTo(m.x + 6, m.y - 6); c.lineTo(m.x + 6, m.y - 19); c.stroke(); }
    if (s.fades && !s.claimed && Math.sin(t * 5) > 0) { c.fillStyle = '#ff8070'; c.beginPath(); c.arc(m.x - 8, m.y - 8, 2.6, 0, 7); c.fill(); }
  }
  // colonies: a small cluster of domes that grows with population, in each colony's colour
  const colony = (m, col, pop, label, sel, you) => {
    const n = clamp(1 + Math.floor(pop / 40), 1, 5);
    if (you) { const g = c.createRadialGradient(m.x, m.y, 2, m.x, m.y, 26); g.addColorStop(0, 'rgba(255,190,110,.55)'); g.addColorStop(1, 'rgba(255,150,60,0)'); c.fillStyle = g; c.beginPath(); c.arc(m.x, m.y, 26, 0, 7); c.fill(); }
    c.fillStyle = 'rgba(12,8,6,.6)'; c.beginPath(); c.ellipse(m.x, m.y + 4, 15, 6, 0, 0, 7); c.fill();
    for (let k = 0; k < n; k++) { const ox = [0, -7, 7, -3.5, 3.5][k], oy = [0, 2, 2, -3, -3][k], r = [7, 5, 5, 4, 4][k]; c.fillStyle = col; c.beginPath(); c.arc(m.x + ox, m.y + oy + 3, r, Math.PI, 0); c.fill(); c.fillStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.arc(m.x + ox - r * 0.3, m.y + oy + 3 - r * 0.4, r * 0.35, 0, 7); c.fill(); }
    if (sel) { c.strokeStyle = '#ffc68a'; c.lineWidth = 2; c.beginPath(); c.arc(m.x, m.y, 16, 0, 7); c.stroke(); }
    c.font = '700 10px -apple-system, system-ui, sans-serif'; c.textAlign = 'center'; const tw = c.measureText(label).width + 10;
    c.fillStyle = 'rgba(14,10,8,.78)'; roundRect(c, m.x - tw / 2, m.y + 9, tw, 14, 6); c.fill(); c.fillStyle = you ? '#ffc68a' : col; c.fillText(label, m.x, m.y + 19.5);
  };
  for (const m of mk) if (m.k === 'rival') colony(m, KC.RIVALS[m.rv.k].color, m.rv.pop, m.rv.name, WMAP.sel && WMAP.sel.k === 'rival' && WMAP.sel.id === m.id);
  colony(home, PAL.ui.amber, G.colonists.length, 'You', WMAP.sel && WMAP.sel.k === 'home', true);
}
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
function worldMapCanvas(G, w, h) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), cv = document.createElement('canvas');
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; cv.className = 'worldmap'; cv._w = w; cv._h = h;
  drawWorldMap(cv, G, performance.now() / 1000);
  cv.addEventListener('click', ev => {
    const r = cv.getBoundingClientRect(), x = (ev.clientX - r.left) * w / r.width, y = (ev.clientY - r.top) * h / r.height;
    let best = null, bd = 26; for (const m of worldMarkers(G, w, h)) { const d = Math.hypot(m.x - x, m.y - y); if (d < bd) { bd = d; best = m; } }
    WMAP.sel = best ? { k: best.k, id: best.id } : null; Sound.play('tap'); drawWorldMap(cv, G, performance.now() / 1000); Sheet.render(false);
  });
  // gentle animation while the map is on screen
  cancelAnimationFrame(WMAP.raf);
  let last = 0; const tick = now => { if (!cv.isConnected) { const live = document.querySelector('#sheet canvas.worldmap'); if (!live) return; } if (now - last > 50) { last = now; const live = document.querySelector('#sheet canvas.worldmap'); if (live) drawWorldMap(live, G, now / 1000); } WMAP.raf = requestAnimationFrame(tick); };
  WMAP.raf = requestAnimationFrame(tick);
  return cv;
}
// ---------- the panel ----------
const specChip = (sp, ok) => h('span', { class: 'chip' + (ok === false ? ' bad' : ok ? ' good' : '') }, ic(SPEC_ICON[sp] || 'none'), SPECS[sp] ? SPECS[sp].name : sp);
const rivalDot = col => h('span', { class: 'dot', style: 'background:' + col });
function relName(v) { return v >= 70 ? 'friendly' : v >= 45 ? 'cordial' : v >= 25 ? 'cool' : 'hostile'; }
function siteStatus(G, s) {
  const W = KC.worldOf(G), sol = KC.solOf(G.tick);
  if (s.claimed === 'you') return ['Worked by your crew', 'good', 'yours'];
  if (s.claimed === 'lost') return ['The beacon fell silent', 'bad', 'lost'];
  if (s.claimed) return ['Claimed by ' + KC.rivalOf(G, s.claimed).name, 'bad', 'taken'];
  if (s.exp) { const e = W.exps.find(x => x.id === s.exp); return [e && e.phase === 'work' ? 'Your crew is at work here' : 'Your expedition is on its way', 'good', e && e.phase === 'work' ? 'at work' : 'en route']; }
  if (s.rv) { const n = Math.max(1, Math.ceil((s.rv.at - G.tick) / 24)); return [KC.rivalOf(G, s.rv.r).name + ' arrives in ' + n + ' sols', 'warn', 'rival ' + n + ' sols']; }
  if (s.fades) { const n = Math.max(0, s.fades - sol); return ['Beacon fades in ' + n + ' sols', 'warn', 'fades ' + n + ' sols']; }
  return ['Open', '', ''];
}
Object.assign(Panels, {
  world(tab) {
    const G = UI.G;
    KC.worldOf(G);
    Sheet.show({ tab: 'world', title: 'Kessa', kicker: 'The wider world', icon: 'world', iconCls: 'res-water', tall: true, live: true,
      tabs: [['map', 'Map'], ['rivals', 'Rivals'], ['trade', 'Trade' + (G.world.offers.length ? ' •' : '')], ['exp', 'Expeditions']], tabK: tab || this._wt || 'map', body: k => {
        this._wt = k;
        if (k === 'rivals') return this.rivalsBody();
        if (k === 'trade') return this.tradeBody();
        if (k === 'exp') return this.expBody();
        return this.mapBody();
      } });
  },
  mapBody() {
    const G = UI.G, Wd = G.world, out = [], w = Math.min(window.innerWidth, 600) - 26, hgt = Math.round(w * 0.66);
    out.push(h('div', { class: 'card mapcard' }, worldMapCanvas(G, w, hgt),
      h('div', { class: 'row wrap legend' }, h('span', { class: 'lg' }, h('i', { class: 'dia open' }), 'open site'), h('span', { class: 'lg' }, h('i', { class: 'dia mine' }), 'worked by you'), h('span', { class: 'lg' }, h('i', { class: 'dia gone' }), 'taken'), h('span', { class: 'lg' }, h('i', { class: 'route' }), 'expedition'))));
    const sel = WMAP.sel;
    if (sel && sel.k === 'site') { const s = Wd.sites.find(x => x.id === sel.id); if (s) out.push(this.siteCard(s, true)); }
    else if (sel && sel.k === 'rival') { const rv = KC.rivalOf(G, sel.id); if (rv) out.push(this.rivalCard(rv)); }
    else if (sel && sel.k === 'home') out.push(h('div', { class: 'card', style: 'margin-top:8px' }, h5t('domes', 'res-funds', 'Your colony'), h('p', null, G.colonists.length + ' colonists, ' + KC.techCount(G) + ' technologies. ' + (Wd.exps.length ? 'Your skimmer is away.' : KC.padOf(G) ? 'The skimmer is on its pad.' : 'No Expedition Pad yet.'))));
    else out.push(h('p', { class: 'small mut', style: 'margin:8px 2px' }, 'Tap a colony or a site on the map. Sites are reached by expedition rockets from an Expedition Pad; rivals send their own crews, and whoever works a site first takes it.'));
    out.push(sec('Remote sites'));
    const open = Wd.sites.filter(s => !s.claimed).sort((a, b) => KC.siteTravel(G, a) - KC.siteTravel(G, b));
    const list = h('div', { class: 'list' });
    for (const s of open) { const D = KC.SITES[s.kind], st = siteStatus(G, s); list.appendChild(h('div', { class: 'it tap', 'data-site': s.id, onclick: () => { WMAP.sel = { k: 'site', id: s.id }; Sound.play('tap'); Sheet.render(true); $('#sheet .sh-body').scrollTop = 0; } }, h('div', { class: 'avatar' }, ic(D.icon, 'res-water')), h('div', { class: 'grow' }, h('div', null, D.name), h('div', { class: 'sub' }, KC.siteTravel(G, s) + ' sol' + (KC.siteTravel(G, s) > 1 ? 's' : '') + ' away · ' + KC.rewardText(D.reward))), st[2] ? h('span', { class: 'st ' + st[1] }, st[2]) : null)); }
    if (!open.length) list.appendChild(emptyState('xpad', 'No open sites', 'Orbital scans find new sites every week or so.'));
    out.push(list);
    return out;
  },
  siteCard(s, withBtn) {
    const G = UI.G, D = KC.SITES[s.kind], st = siteStatus(G, s), chk = KC.expCheck(G, s.id);
    return h('div', { class: 'card', style: 'margin-top:8px', 'data-sitecard': s.id }, h5t(D.icon, 'res-water', D.name), h('p', null, D.text),
      h('div', { class: 'row wrap', style: 'gap:4px;margin:6px 0' }, ...D.crew.map(sp => specChip(sp)), D.drones ? h('span', { class: 'chip' }, ic('build'), D.drones + ' drones') : null, D.rover ? h('span', { class: 'chip' }, ic('people'), 'Pathfinder') : null),
      kv('Trip', KC.siteTravel(G, s) + ' sols each way + ' + D.sols + ' on site'), kv('Risk', Math.round(D.risk * 100) + '%' + (chk.chance ? ' · success ' + Math.round(chk.chance * 100) + '%' : ''), D.risk >= 0.3 ? 'warnc' : ''),
      kv('Reward', KC.rewardText(D.reward)), kv('Status', st[0], st[1] === 'bad' ? 'bad' : st[1] === 'warn' ? 'warnc' : st[1] === 'good' ? 'good' : ''),
      withBtn && !s.claimed && !s.exp ? h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'pri grow', 'data-plan': s.id, onclick: () => { UI.wexp = { site: s.id, ids: null }; this._wt = 'exp'; Sound.play('tap'); Sheet.render(true); } }, 'Plan an expedition')) : null);
  },
  rivalCard(rv) {
    const G = UI.G, R0 = KC.RIVALS[rv.k];
    return h('div', { class: 'card', style: 'margin-top:8px', 'data-rivalcard': rv.k }, h('h5', { class: 'row', style: 'gap:6px' }, rivalDot(R0.color), rv.name), h('p', null, 'Backed by ' + SPONSORS[rv.k].name + '. ' + R0.desc),
      kv('Colonists', String(Math.floor(rv.pop))), kv('Domes', String(rv.domes)), kv('Technologies', String(Math.floor(rv.techs))), kv('Status', rv.st === 'free' ? 'independent' : rv.st),
      h('div', { class: 'gauge' }, h('div', { class: 'row small' }, h('b', { class: 'grow' }, 'Relations'), h('span', null, Math.round(rv.rel) + ' · ' + relName(rv.rel))), h('div', { class: 'bar' + (rv.rel < 30 ? ' bad' : rv.rel < 50 ? ' warn' : '') }, h('i', { style: 'width:' + Math.round(rv.rel) + '%' }))),
      h('p', { class: 'small mut' }, 'Trades and help raise relations; better relations bring more and better offers. Hostile rivals poach colonists.'));
  },
  rivalsBody() {
    const G = UI.G, Wd = G.world, out = [], board = KC.rivalBoard(G);
    out.push(sec('Rivalry board'));
    const tbl = h('div', { class: 'card board' }, h('div', { class: 'brow bhead' }, h('span', null, 'Colony'), h('span', null, 'Pop'), h('span', null, 'Domes'), h('span', null, 'Techs')));
    for (const r of board.sort((a, b) => b.pop - a.pop)) tbl.appendChild(h('div', { class: 'brow' + (r.you ? ' you' : ''), 'data-board': r.k }, h('span', { class: 'row', style: 'gap:6px;min-width:0' }, rivalDot(r.you ? '#f2a65a' : r.color), h('b', { class: 'nm' }, r.name), r.st === 'struggling' ? h('span', { class: 'chip bad' }, 'hit') : r.st === 'free' ? h('span', { class: 'chip good' }, 'free') : null), h('span', null, String(r.pop)), h('span', null, String(r.domes)), h('span', null, String(r.techs))));
    out.push(tbl);
    out.push(sec('The race'));
    const list = h('div', { class: 'list' });
    for (const R0 of KC.RACES) {
      const w = Wd.races[R0.k], lead = KC.raceLeader(G, R0.k);
      const who = w ? (w.who === 'you' ? 'You' : KC.rivalOf(G, w.who).name) : null;
      list.appendChild(h('div', { class: 'it', 'data-race': R0.k }, h('div', { class: 'stg' + (w && w.who === 'you' ? ' on' : '') + (w && w.who !== 'you' ? ' lost' : '') }, w ? (w.who === 'you' ? '✓' : '×') : ''),
        h('div', { class: 'grow' }, h('div', { class: 'small' }, h('b', null, R0.name), R0.prize ? ' · prize ' + R0.prize : ''), w ? h('div', { class: 'sub' }, who + ' got there first, on sol ' + w.sol + '.') : h('div', null, h('div', { class: 'sub' }, 'Leader: ' + (lead.who === 'you' ? 'you' : KC.rivalOf(G, lead.who).name) + ' · you ' + Math.round(lead.you * 100) + '%'), barEl(lead.you, lead.who === 'you' ? '' : 'warn')))));
    }
    out.push(list);
    if (Wd.relics.length) { out.push(sec('Relics')); for (const k of Wd.relics) out.push(kv(KC.RELICS[k].name, KC.RELICS[k].text.split('. ').slice(-1)[0])); }
    out.push(sec('News from Kessa'));
    const news = Wd.log.slice(-8).reverse();
    if (!news.length) out.push(h('p', { class: 'small mut' }, 'Nothing yet. The other colonies are still landing.'));
    for (const n of news) out.push(h('div', { class: 'kv' }, h('span', { class: 'small' }, n.m), h('span', { class: 'sub' }, 'sol ' + KC.solOf(n.t))));
    return out;
  },
  tradeBody() {
    const G = UI.G, Wd = G.world, out = [];
    if (!Wd.offers.length) out.push(emptyState('depot', 'No offers right now', G.st.everColonists ? 'Rival colonies send offers every few sols. Better relations bring better prices.' : 'Rivals start trading once your first colonists arrive.'));
    for (const o of Wd.offers) {
      const rv = KC.rivalOf(G, o.r), chk = KC.offerCheck(G, o), col = KC.RIVALS[o.r].color;
      out.push(h('div', { class: 'card offer', 'data-offer': o.id, style: 'margin-bottom:8px;border-left:4px solid ' + col }, h('h5', { class: 'row', style: 'gap:6px' }, rivalDot(col), rv.name, h('span', { class: 'sub', style: 'margin-left:auto' }, 'expires in ' + Math.max(1, Math.round((o.until - G.tick))) + ' h')),
        h('div', { class: 'row', style: 'gap:10px;margin:6px 0' }, h('div', { class: 'grow' }, h('div', { class: 'sub' }, 'You get'), offerGoods(o.give)), ic('trade', 'res-funds'), h('div', { class: 'grow', style: 'text-align:right' }, h('div', { class: 'sub' }, 'You pay'), offerGoods(o.take, G))),
        chk.ok ? null : h('p', { class: 'small warnc' }, chk.why),
        h('div', { class: 'row' }, h('button', { class: 'grow', onclick: () => { KC.declineOffer(G, o.id); Sound.play('tap'); Sheet.render(true); } }, 'Decline'), h('button', { class: 'pri grow', 'data-accept': o.id, disabled: !chk.ok, onclick: () => { const r = KC.acceptOffer(G, o.id); if (r.err) { HUD.toast(r.err, 'bad'); Sound.play('error'); return; } Sound.play('good'); HUD.toast('Trade done with ' + rv.name + '.', 'good'); HUD.update(); Sheet.render(true); } }, 'Accept'))));
    }
    out.push(sec('Relations'));
    for (const rv of Wd.rivals) out.push(h('div', { class: 'gauge' }, h('div', { class: 'row small' }, rivalDot(KC.RIVALS[rv.k].color), h('b', { class: 'grow' }, rv.name), h('span', null, relName(rv.rel) + ' · ' + rv.trades + ' trades')), h('div', { class: 'bar' + (rv.rel < 30 ? ' bad' : rv.rel < 50 ? ' warn' : '') }, h('i', { style: 'width:' + Math.round(rv.rel) + '%' }))));
    return out;
  },
  expBody() {
    const G = UI.G, Wd = G.world, out = [], pad = KC.padOf(G);
    if (!pad) {
      out.push(emptyState('xpad', 'No Expedition Pad yet', 'Build one (Build → Base) to send a skimmer rocket with a crew and drones to the remote sites on the map.', h('button', { class: 'pri', 'data-buildpad': '1', onclick: () => UI.beginBuild('xpad') }, 'Build an Expedition Pad')));
    }
    for (const e of Wd.exps) {
      const s = Wd.sites.find(x => x.id === e.site), D = KC.SITES[s.kind], total = (2 * e.travel + D.sols) * 24, done = e.phase === 'out' ? e.travel * 24 - e.t : e.phase === 'work' ? e.travel * 24 + D.sols * 24 - e.t : e.travel * 24 + D.sols * 24 + e.travel * 24 - e.t;
      out.push(h('div', { class: 'card', 'data-exp': e.id }, h5t('skimmer', 'res-fuel', 'Expedition to the ' + D.name.toLowerCase()), h('p', null, { out: 'Flying out', work: 'At work on the site', back: 'Flying home' }[e.phase] + ' · back in about ' + Math.max(1, Math.ceil((total - done) / 24)) + ' sols'), barEl(done / total),
        h('div', { class: 'row wrap', style: 'gap:4px;margin-top:6px' }, ...e.crew.map(c => h('span', { class: 'chip' }, ic(SPEC_ICON[c.spec] || 'none'), c.name)), e.drones ? h('span', { class: 'chip' }, ic('build'), e.drones + ' drones') : null, e.rover ? h('span', { class: 'chip' }, ic('people'), 'Pathfinder') : null),
        kv('Odds of full success', Math.round(e.chance * 100) + '%'), e.res ? kv('Report', e.res.kind === 'success' ? 'success' : e.res.kind === 'partial' ? 'done, one hurt' : e.res.kind === 'claimed' ? 'site already taken' : 'accident', e.res.kind === 'success' ? 'good' : 'warnc') : null));
    }
    const open = Wd.sites.filter(s => !s.claimed && !s.exp);
    UI.wexp = UI.wexp && open.some(s => s.id === UI.wexp.site) ? UI.wexp : (open[0] ? { site: open[0].id, ids: null } : null);
    if (!open.length) { out.push(emptyState('xpad', 'No open sites', 'New sites turn up every week or so (World → Map).')); return out; }
    out.push(sec('Choose a site'));
    const pick = h('div', { class: 'row wrap sitepick' });
    for (const s of open) pick.appendChild(h('button', { class: UI.wexp.site === s.id ? 'on' : '', 'data-pick-site': s.id, onclick: () => { UI.wexp = { site: s.id, ids: null }; Sound.play('tap'); Sheet.render(true); } }, ic(KC.SITES[s.kind].icon), KC.SITES[s.kind].name));
    out.push(pick);
    const s = open.find(x => x.id === UI.wexp.site), D = KC.SITES[s.kind], chk = KC.expCheck(G, s.id);
    if (!UI.wexp.ids || UI.wexp.ids.length !== chk.crew.length || UI.wexp.ids.some(id => !KC.cById(G, id))) UI.wexp.ids = chk.crew.map(x => x.id);
    const ids = UI.wexp.ids, seats = h('div', { class: 'list' }), crewCard = h('div', { class: 'card', 'data-crew': '1' }, h5t('people', 'res-oxygen', 'Crew'), seats);
    D.crew.forEach((sp, i) => {
      const c = KC.cById(G, ids[i]), match = c && c.spec === sp;
      seats.appendChild(h('div', { class: 'it seat' }, h('div', { class: 'avatar' }, ic(SPEC_ICON[sp], match ? 'res-food' : 'res-fuel')), h('div', { class: 'grow' }, h('div', null, c ? c.name : 'Nobody available'), h('div', { class: 'sub' }, 'Seat: ' + SPECS[sp].name.toLowerCase() + (c ? ' · ' + (match ? 'qualified' : (SPECS[c.spec] ? SPECS[c.spec].name.toLowerCase() : c.spec) + ', stand-in −12%') + ' · health ' + Math.round(c.health) : ''))),
        h('button', { 'data-swap': i, disabled: !c, onclick: () => { const cands = G.colonists.filter(x => KC.canWork(x) && x.health > 60 && !x.leaving && (x.id === ids[i] || !ids.includes(x.id))).sort((a, b) => ((b.spec === sp) - (a.spec === sp)) || ((b.health + b.morale) - (a.health + a.morale)) || (a.id - b.id)); const j = cands.findIndex(x => x.id === ids[i]); const nx = cands[(j + 1) % cands.length]; if (nx) ids[i] = nx.id; Sound.play('tap'); Sheet.render(true); } }, 'Swap')));
    });
    out.push(crewCard);
    const stand = D.crew.filter((sp, i) => { const c = KC.cById(G, ids[i]); return c && c.spec !== sp; }).length, chance = KC.expChance(G, s, stand, 0);
    out.push(h('div', { class: 'card', style: 'margin-top:8px' }, kv('Fuel', chk.fuel + ' (have ' + fmt(G.res.fuel) + ')', G.res.fuel >= chk.fuel ? '' : 'bad'), D.drones ? kv('Drones', D.drones + ' (' + KC.dronesFree(G) + ' in hubs)') : null, D.rover ? kv('Vehicle', 'the Pathfinder') : null,
      kv('Trip', chk.travel + ' sols out, ' + D.sols + ' on site, ' + chk.travel + ' back'), kv('Success', Math.round(chance * 100) + '%', chance < 0.55 ? 'warnc' : 'good'), kv('Reward', KC.rewardText(D.reward)),
      chk.ok ? null : h('p', { class: 'small warnc' }, chk.why),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'pri grow', 'data-launch-exp': s.id, disabled: !chk.ok, onclick: () => { const r = KC.launchExpedition(G, s.id, ids); if (r.err) { HUD.toast(r.err, 'bad'); Sound.play('error'); return; } Sound.play('rocket'); HUD.toast('The skimmer is away. Watch its route on the map.', 'good'); UI.wexp = null; this._wt = 'map'; WMAP.sel = { k: 'site', id: s.id }; Sheet.render(true); } }, 'Launch expedition'))));
    out.push(h('p', { class: 'small mut', style: 'margin:8px 2px' }, 'The crew and drones are away for the whole trip: they do not work or count towards your population until they return. Stand-ins without the right specialization lower the odds. Medics bring everyone home healthier.'));
    return out;
  },
});
function offerGoods(o, G) { return h('div', { class: 'row wrap', style: 'gap:4px 10px' }, ...Object.entries(o).map(([k, n]) => k === 'rp' ? icv('rp', fmt(n)) : icv(k, fmt(n), G && (k === 'funds' ? G.funds : G.res[k]) < n ? 'no' : ''))); }
// ---------- the Rail Station and Expedition Pad panels ----------
Object.assign(Panels, {
  stationBody(b) {
    const G = UI.G, R0 = KC.railOf(G), out = [sec('Monorail')];
    const N0 = [...R0.nets.values()].find(n => n.st.includes(b));
    if (!N0 || N0.st.length < 2) out.push(h('p', { class: 'small mut' }, 'Not on a line yet. Lay track to another station and a train starts running between them.'));
    else {
      const trains = (G.trains || []).filter(t => t.line === N0.key), run = KC.lineRunning(N0);
      out.push(kv('Line', N0.st.length + ' stations · ' + trains.length + ' train' + (trains.length > 1 ? 's' : '')), kv('Status', run ? 'running' : 'stopped: a station has no power or is broken', run ? 'good' : 'bad'));
      out.push(kv('Commuters (whole network)', String(G._railPax || 0)), kv('Extractors shipping by rail', String(G._freight ? G._freight.size : 0)));
    }
    const others = G.buildings.filter(x => x.t === 'station' && x !== b);
    if (!others.length) out.push(h('p', { class: 'small' }, 'Build a second Rail Station where you need one (by a far mine, hub or dome), then tap this station again to lay track to it.'), h('button', { class: 'pri', 'data-newstation': '1', onclick: () => UI.beginBuild('station') }, 'Place another station'));
    for (const o of others) {
      const same = N0 && N0.st.includes(o) && b.built && o.built, r = same ? null : KC.railRoute(G, b.id, o.id), dist = Math.round(Math.hypot(o.x - b.x, o.y - b.y));
      out.push(h('div', { class: 'row railrow', style: 'margin-top:6px' }, h('div', { class: 'grow' }, h('div', null, 'Station #' + o.id + (o.built ? '' : ' (site)')), h('div', { class: 'sub' }, same ? 'On this line' : r.err ? r.err : r.n ? r.n + ' new tiles · ' + costText(r.cost) : 'Track already laid · ' + dist + ' tiles away')),
        same ? h('span', { class: 'st' }, 'linked') : h('button', { class: 'pri', 'data-lay': o.id, disabled: !!(r && (r.err || !r.n)), onclick: () => { const res = KC.layTrack(G, b.id, o.id); if (res.err) { HUD.toast(res.err, 'bad'); Sound.play('error'); return; } Sound.play('place'); HUD.toast(res.n + ' tiles of track planned. Drones lay it.', 'good'); Sheet.render(true); } }, 'Lay track')));
    }
    return out;
  },
  padBody(b) {
    const G = UI.G, W = KC.worldOf(G), e = W.exps[0], out = [sec('Skimmer')];
    if (e) { const s = W.sites.find(x => x.id === e.site); out.push(kv('Away at', KC.SITES[s.kind].name), kv('Crew', e.crew.map(c => c.name).join(', '))); }
    else out.push(kv('Status', b.built ? 'on the pad, ready' : 'waiting for the pad'), kv('Open sites', String(W.sites.filter(s => !s.claimed).length)));
    out.push(h('button', { class: e ? '' : 'pri', 'data-openexp': '1', style: 'margin-top:8px;width:100%', onclick: () => Panels.world('exp') }, e ? 'Follow the expedition' : 'Plan an expedition'));
    return out;
  },
});

// ===== app.js : game session, time, main loop, engine events =====
const HOUR_MS = 2200;
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, ''); else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  return el;
}
const fmt = v => { const a = Math.abs(v); return a >= 10000 ? (v / 1000).toFixed(1) + 'k' : a >= 100 ? Math.round(v) + '' : a >= 10 ? (Math.round(v * 10) / 10) + '' : (Math.round(v * 10) / 10) + ''; };
const fmtSigned = v => (v > 0.05 ? '+' : '') + fmt(v);
const UI = {
  G: null, speed: 1, prevSpeed: 1, acc: 0, last: 0, lastDraw: 0, lastHud: 0, mode: null, input: null, logSeen: 0, techPip: false,
  start(G) {
    this.G = G; R.setGame(G); this.acc = 0; this.mode = null; R.sel = null; R.ghost = null; R.overlay = 'none';
    this.logSeen = G.log.length;
    $('#hud').hidden = false; Screens.closeAll(); Sheet.close();
    this.setSpeed(G.over && !G.over.continued ? 0 : 1);
    HUD.build(); HUD.update(true);
    Tips.reset();
  },
  setSpeed(s) {
    this.speed = s; $$('#speed button').forEach(b => b.classList.toggle('on', +b.dataset.sp === s));
  },
  togglePause() { if (this.speed) { this.prevSpeed = this.speed; this.setSpeed(0); } else this.setSpeed(this.prevSpeed || 1); },
  loop(now) {
    requestAnimationFrame(t => this.loop(t));
    const dt = Math.min(100, now - (this.last || now)); this.last = now;
    if (this.input) this.input.tick(dt);
    const G = this.G;
    if (G && this.speed > 0 && !(G.over && !G.over.continued) && !Modal.open) {
      this.acc += dt * this.speed;
      let n = 0;
      while (this.acc >= HOUR_MS && n < 12) {
        KC.step(G); this.acc -= HOUR_MS; n++;
        this.drainFx();
        if (G.tick % 24 === 0) this.onSol();
        if (G.over && !G.over.continued) { this.acc = 0; break; }
      }
      if (n >= 12) this.acc = 0;
    }
    // adaptive frame pacing: slower devices draw less often instead of stalling input
    if (G && now - this.lastDraw > (this.drawGap || 30)) { this.lastDraw = now; const t0 = performance.now(); R.frame(now, G ? this.acc / HOUR_MS : 0); const ft = performance.now() - t0; this.ft = (this.ft || ft) * 0.9 + ft * 0.1; this.drawGap = clamp(this.ft * 1.7, 30, 70); }
    if (G && now - this.lastHud > 250) { this.lastHud = now; HUD.update(); Sheet.refresh(); Tips.check(); }
  },
  onSol() {
    const G = this.G;
    if (Settings.get('autosave')) { const err = Saves.write('auto', G); if (err && !this._saveWarned) { this._saveWarned = true; HUD.toast(err, 'bad'); } }
  },
  drainFx() {
    const G = this.G, list = G._fx || []; G._fx = [];
    for (const e of list) {
      if (e.k === 'log') { const l = e.e; if (l.k === 'bad' || l.k === 'warn' || l.k === 'good') HUD.toast(l.m, l.k, l); }
      else if (e.k === 'meteor') { R.addAnim({ k: 'meteor', x: e.x, y: e.y, dur: 1.7 }); Sound.play('meteor'); }
      else if (e.k === 'intercept') { const l = G.buildings.filter(b => b.t === 'lance').sort((a, b) => Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(b.x - e.x, b.y - e.y))[0]; if (l) { const z = R.buildingZ(l); R.addAnim({ k: 'intercept', x: e.x, y: e.y, lx: isoX(l.x + 0.5, l.y + 0.5), ly: isoY(l.x + 0.5, l.y + 0.5, z + 14), dur: 1 }); } }
      else if (e.k === 'built') { const b = KC.bById(G, e.id); if (b && !b.mod) R.addAnim({ k: 'built', x: b.x + b.s / 2 - 0.5, y: b.y + b.s / 2 - 0.5, dur: 1.2 }); Sound.play('built'); }
      else if (e.k === 'land' || e.k === 'launch') Sound.play('rocket');
      else if (e.k === 'tech') { Sound.play('tech'); this.techPip = !G.research.cur; }
      else if (e.k === 'milestone') Sound.play('good');
      else if (e.k === 'birth') Sound.play('birth');
      else if (e.k === 'warn') Sound.play('warn');
      else if (e.k === 'hazard') { Sound.play('bad'); }
      else if (e.k === 'death' || e.k === 'break') Sound.play('error');
      else if (e.k === 'event') { Sound.play('warn'); setTimeout(() => { if (!Modal.open) Screens.event(); }, 200); }
      else if (e.k === 'contract') { Sound.play('open'); HUD.toast('New sponsor contract offered. Rockets → Sponsor.', 'info'); }
      else if (e.k === 'over') { this.setSpeed(0); Saves.write('auto', G); setTimeout(() => Screens.end(), 400); }
    }
    Sound.setStorm(!!KC.hazardActive(G, 'dust'));
  },
  // ----- map taps -----
  tap(sx, sy) {
    Sound.unlock();
    const G = this.G; if (!G) return;
    const m = this.mode;
    if (m && m.k === 'build') { const t = R.screenToTile(sx, sy); const s = BUILDINGS[m.type].size; this.ghostAt(t.x - Math.floor((s - 1) / 2), t.y - Math.floor((s - 1) / 2)); return; }
    if (m && m.k === 'line') { const t = R.screenToTile(sx, sy); this.lineTap(t.x, t.y); return; }
    if (m && m.k === 'move') { const t = R.screenToTile(sx, sy); m.to = [t.x, t.y]; R.sel = { k: 'tile', x: t.x, y: t.y }; Place.render(); return; }
    if (R.overlay === 'survey') { const t = R.screenToTile(sx, sy); if (t.x >= 0 && t.y >= 0 && t.x < MAP_N && t.y < MAP_N) { const s = KC.sectorOf(t.x, t.y); Panels.sector(KC.sectorIndex(s.sx, s.sy)); } return; }
    const p = R.pick(sx, sy);
    if (!p) { this.select(null); return; }
    this.select(p);
  },
  select(p) {
    R.sel = p; Sound.play('tap');
    if (!p) { Sheet.close(); return; }
    if (p.k === 'b') { const b = KC.bById(this.G, p.id); if (b) Panels.building(b); }
    else if (p.k === 'v') Panels.vehicle(p.id);
    else if (p.k === 'a') Panels.anomaly(p.id);
    else Panels.tile(p.x, p.y);
  },
  // ----- placement -----
  beginBuild(type) {
    this.mode = { k: BUILDINGS[type].line ? 'line' : 'build', type, kind: BUILDINGS[type].line };
    Sheet.close(); R.sel = null;
    if (this.mode.k === 'build') {
      const t = R.screenToTile(R.w / 2, R.h * 0.45), s = BUILDINGS[type].size;
      // extractors start on the nearest usable deposit; other buildings on the nearest valid spot
      const sp = this.findSpot(type, t.x, t.y);
      if (sp) { this.ghostAt(sp.x, sp.y); if (BUILDINGS[type].deposit || Math.hypot(sp.x - t.x, sp.y - t.y) > 6) R.centerOn(sp.x + s / 2, sp.y + s / 2); }
      else this.ghostAt(t.x - Math.floor((s - 1) / 2), t.y - Math.floor((s - 1) / 2));
    }
    else { R.ghost = { line: true, tiles: [] }; Place.render(); }
  },
  findSpot(type, cx, cy, avoid) {
    const G = this.G, s = BUILDINGS[type].size, hubs = KC.hubsOf(G);
    let best = null, bd = 1e9;
    for (let r = 0; r < 26 && !(best && bd < 100); r++) for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
      if (avoid && avoid.has(y * MAP_N + x)) continue;
      if (!KC.canPlace(G, type, x, y).ok) continue;
      const c = { x: x + s / 2, y: y + s / 2 }, inR = hubs.some(h2 => KC.cheb(h2.x, h2.y, c.x, c.y) <= h2.r + 0.5) || BUILDINGS[type].hub, d = Math.hypot(x - cx, y - cy) + (inR ? 0 : 100);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    return best;
  },
  ghostAt(x, y) {
    const m = this.mode, G = this.G, s = BUILDINGS[m.type].size;
    x = clamp(x, 0, MAP_N - s); y = clamp(y, 0, MAP_N - s);
    const c = KC.canPlace(G, m.type, x, y);
    R.ghost = { type: m.type, x, y, ok: c.ok, why: c.why };
    Place.render();
  },
  lineTap(x, y) {
    const m = this.mode; if (x < 0 || y < 0 || x >= MAP_N || y >= MAP_N) return;
    if (!m.start || m.end) { m.start = [x, y]; m.end = null; R.ghost = { line: true, start: m.start, tiles: [[x, y]], ok: true }; }
    else { m.end = [x, y]; const tiles = KC.linePath(m.start[0], m.start[1], x, y); const c = KC.checkLine(this.G, m.kind, tiles); R.ghost = { line: true, start: m.start, tiles, ok: c.ok, why: c.why, cost: c.cost, n: c.n }; }
    Place.render();
  },
  confirmPlace() {
    const m = this.mode, G = this.G; if (!m) return;
    if (m.k === 'build') {
      const g = R.ghost; if (!g || !g.ok) { Sound.play('error'); return; }
      const b = KC.place(G, m.type, g.x, g.y);
      if (b.err) { HUD.toast(b.err, 'bad'); Sound.play('error'); return; }
      Sound.play('place');
      // buildings that do not touch the grid get cable and pipe planned to it automatically
      if (Settings.get('autoConnect') !== false && !touchesGrid(G, g.x, g.y, b.s) && (BUILDINGS[m.type].use || BUILDINGS[m.type].make || BUILDINGS[m.type].gen || BUILDINGS[m.type].dome || BUILDINGS[m.type].battery || BUILDINGS[m.type].tank)) {
        const r = KC.autoConnectSite(G, b.id); if (r.ok) HUD.toast('Cable and pipe planned to the grid: ' + r.tiles + ' tiles.', 'info'); else HUD.toast('Could not route a line to the grid: ' + r.err, 'warn');
      }
      // move the ghost to the next free spot nearby, so several can be placed quickly
      const nx = this.findSpot(m.type, g.x, g.y); if (nx) this.ghostAt(nx.x, nx.y); else this.ghostAt(g.x, g.y);
      Tips.check();
    } else if (m.k === 'line') {
      if (!m.end) return;
      const r = KC.placeLine(G, m.kind, R.ghost.tiles);
      if (r.err) { HUD.toast(r.err, 'bad'); Sound.play('error'); return; }
      Sound.play('place'); m.start = m.end; m.end = null; R.ghost = { line: true, start: m.start, tiles: [m.start], ok: true }; Place.render();
    } else if (m.k === 'move') {
      if (!m.to) return;
      const r = KC.moveVehicle(G, m.vid, m.to[0], m.to[1]);
      if (r.err) { HUD.toast(r.err, 'bad'); Sound.play('error'); return; }
      Sound.play('place'); this.cancelMode(); R.sel = { k: 'v', id: m.vid };
    }
  },
  cancelMode() { this.mode = null; R.ghost = null; Place.hide(); },
};

'use strict';
// ============================================================================
// ZONEFALL — renderer. Draws the world at low "art" resolution (1 art px =
// 2 world units, a tile = 16 art px) into an offscreen canvas, depth-sorts
// everything for a 3/4 view, adds roofs, lighting and a colour grade, then
// upscales with nearest-neighbour (and sub-pixel camera offset for smooth
// scrolling). Text, joysticks and markers are drawn afterwards at full res.
// ============================================================================

const R = {
  AP: 2, t: 0, flashes: [], anims: [], silCache: new Map(), shadowCache: new Map(), motes: [],

  init(canvas) {
    this.cv = canvas; this.g = canvas.getContext('2d');
    [this.lc, this.lg] = ART.canvas(8, 8);
    [this.dk, this.dg] = ART.canvas(8, 8);
  },
  resize() {
    const dpr = window.devicePixelRatio || 1; this.dpr = dpr;
    this.cv.width = Math.round(innerWidth * dpr); this.cv.height = Math.round(innerHeight * dpr);
    const target = innerHeight < 520 ? 196 : innerHeight < 820 ? 232 : 270; // art px visible vertically
    this.s = Math.max(2, Math.round(this.cv.height / target));
    this.LW = Math.ceil(this.cv.width / this.s) + 2; this.LH = Math.ceil(this.cv.height / this.s) + 2;
    for (const c of [this.lc, this.dk]) { c.width = this.LW; c.height = this.LH; }
    this.lg.imageSmoothingEnabled = false; this.dg.imageSmoothingEnabled = false;
    this.css = this.s / dpr; // css px per art px
    this.vign = null;
  },
  // ---- projection (css pixels) ---------------------------------------------
  camArt() { const c = Game.cam; return { x: (c.x + c.kx) / this.AP - this.cv.width / this.s / 2, y: (c.y + c.ky) / this.AP - this.cv.height / this.s / 2 }; },
  worldToScreen(x, y) { const c = this.camArt(); return { x: (x / this.AP - c.x) * this.css, y: (y / this.AP - c.y) * this.css }; },
  screenToWorld(x, y) { const c = this.camArt(); return { x: (x / this.css + c.x) * this.AP, y: (y / this.css + c.y) * this.AP }; },
  viewWorld() { return { w: this.cv.width / this.s * this.AP, h: this.cv.height / this.s * this.AP }; },
  clampCamera() {
    const m = Game.map; if (!m) return; const v = this.viewWorld(); const MW = m.w * TILE, MH = m.h * TILE, c = Game.cam;
    c.x = MW > v.w ? clamp(c.x, v.w / 2, MW - v.w / 2) : MW / 2;
    c.y = MH > v.h ? clamp(c.y, v.h / 2 - 20, MH - v.h / 2) : MH / 2;
  },

  // ---- sprite helpers --------------------------------------------------------
  spr(name) { return ART.get(name); },
  variant(base, v) { // base0..N lookup with modulo
    let n = 0; while (ART.has(base + n)) n++;
    return n ? ART.get(base + (v % n)) : (ART.get(base) || null);
  },
  sil(canvas, col = '#ffffff') {
    let m = this.silCache.get(canvas); if (!m) { m = {}; this.silCache.set(canvas, m); }
    return m[col] || (m[col] = ART.silhouette(canvas, col));
  },
  shadow(w) {
    w = Math.max(4, Math.round(w)); let c = this.shadowCache.get(w); if (c) return c;
    const h = Math.max(2, Math.round(w * 0.32)); const [cv, g] = ART.canvas(w, h);
    ART.ellipse(g, (w - 1) / 2, (h - 1) / 2, (w - 1) / 2, (h - 1) / 2, 'rgba(10,8,20,0.32)');
    this.shadowCache.set(w, cv); return cv;
  },
  // ---- ground prerender ----------------------------------------------------
  buildGround(m) {
    const W = m.w * 16, H = m.h * 16; const [c, g] = ART.canvas(W, H); m.ground = c; m.gctx = g;
    const gname = m.zone ? (m.zone.gset || 'forest') : 'base';
    const set = (ART.groundSet && ART.groundSet(gname)) || [];
    const rnd = ART.rng((m.zone ? m.zone.tier * 97 : 7) + m.w);
    const pick = (base, v) => this.variant(base, v);
    for (let ty = 0; ty < m.h; ty++) for (let tx = 0; tx < m.w; tx++) {
      const i = m.idx(tx, ty), t = m.tiles[i], x = tx * 16, y = ty * 16;
      const nz = (Math.sin(tx * 0.37 + ty * 0.21) + Math.cos(tx * 0.13 - ty * 0.29) + 2) / 4;
      let s = null;
      if (t === T.GROUND || t === T.FENCE) s = set.length ? set[Math.floor(nz * set.length * 0.999 + rnd() * 1.6) % set.length] : null;
      else if (t === T.ROAD) s = (tx + ty) % 9 === 0 ? ART.get('road_line') : pick('road', (rnd() * 8) | 0);
      else if (t === T.CONCRETE) s = pick('concrete', (rnd() * 6) | 0);
      else if (t === T.WATER) s = ART.get('water0');
      else if (t === T.FLOOR || t === T.WALL || t === T.KEYDOOR) s = m.fkind[i] === 1 ? pick('floor_tile', (rnd() * 4) | 0) : m.fkind[i] === 2 ? pick('concrete', (rnd() * 6) | 0) : pick('floor_wood', (rnd() * 4) | 0);
      if (s) g.drawImage(s.c || s, x, y);
      else { g.fillStyle = t === T.WATER ? '#1d3b45' : t === T.ROAD ? '#4a4a48' : t === T.CONCRETE ? '#5c5c58' : t === T.FLOOR ? '#5a4a38' : '#3a4a2e'; g.fillRect(x, y, 16, 16); }
      // shoreline + wall occlusion shadows
      if (t === T.WATER && m.t(tx, ty - 1) !== T.WATER) { const sh = ART.get('shore'); if (sh) g.drawImage(sh.c, x, y); else ART.rect(g, x, y, 16, 2, 'rgba(0,0,0,.35)'); }
      if (t !== T.WALL && (m.t(tx, ty - 1) === T.WALL || m.t(tx, ty - 1) === T.KEYDOOR)) { g.fillStyle = 'rgba(10,8,20,.28)'; g.fillRect(x, y, 16, 3); g.fillStyle = 'rgba(10,8,20,.14)'; g.fillRect(x, y + 3, 16, 2); }
      // decoration
      if ((t === T.GROUND) && rnd() < 0.22) { const d = rnd() < 0.85 ? pick('tuft', (rnd() * 8) | 0) : pick('flower', (rnd() * 4) | 0); if (d) g.drawImage(d.c, x + ((rnd() * 10) | 0), y + ((rnd() * 10) | 0)); }
      if ((t === T.ROAD || t === T.CONCRETE) && rnd() < 0.05) { const d = pick('debris', (rnd() * 6) | 0); if (d) g.drawImage(d.c, x + ((rnd() * 6) | 0), y + ((rnd() * 8) | 0)); }
    }
  },
  decal(name, x, y) {
    const m = Game.map; if (!m || !m.gctx) return;
    const map = { blood: 'fx_blood', goo: 'fx_goo', debris: 'debris' };
    const s = map[name] ? this.variant(map[name], (Math.random() * 9) | 0) : ART.get(name === 'scorch' ? 'fx_scorch' : name);
    const ax = Math.round(x / this.AP), ay = Math.round(y / this.AP);
    if (s) m.gctx.drawImage(s.c, ax - s.ox, ay - s.oy);
    else { m.gctx.fillStyle = name === 'goo' ? '#3a4a22' : name === 'scorch' ? 'rgba(10,8,6,.5)' : '#5a1010'; m.gctx.fillRect(ax - 3, ay - 2, 6, 4); }
  },
  // short-lived sprite animations (explosions etc.)
  anim(base, x, y, frames, fps = 16) { this.anims.push({ base, x, y, frames, fps, t: 0 }); },
  flash(x, y, ang) { this.flashes.push({ x, y, ang, life: 0.06, f: (Math.random() * 3) | 0 }); },

  // ---- actors ----------------------------------------------------------------
  actorArt(e, isPlayer) {
    if (isPlayer) return Game.playerArt || (Game.playerArt = ART.character ? ART.character(Game.playerLook()) : null);
    if (e.art) return e.art;
    const t = e.type;
    if (e.def.kind === 'beast' || t === 'lurker') e.art = ART.beast ? ART.beast(t) : null;
    else e.art = ART.character && ART.LOOKS ? ART.character(ART.LOOKS[t] || ART.LOOKS.scav) : null;
    return e.art;
  },
  heldWeapon(e, isPlayer) {
    if (isPlayer) { const it = Game.activeItem(); return it ? it.id : 'fists'; }
    if (e.gun) return e.gun; if (e.def.rocket) return 'rpg'; if (e.type === 'thug') return 'machete'; if (e.type === 'ironjack') return e.gun;
    return null;
  },
  handWorld(e, art, right) {
    if (!art || !art.hand) return { x: e.x, y: e.y - 10 };
    const hx = right ? art.hand.x : art.w - 1 - art.hand.x;
    return { x: e.x + (hx - art.ox) * this.AP, y: e.y + (art.hand.y - art.oy) * this.AP };
  },
  // world position of a weapon's muzzle for an actor (used for bullets/flash)
  muzzleWorld(e, isPlayer) {
    const art = this.actorArt(e, isPlayer); const right = Math.cos(e.ang) >= 0;
    const h = this.handWorld(e, art, right); const id = this.heldWeapon(e, isPlayer);
    const w = id && ART.weapon ? ART.weapon(id) : null;
    const lx = w ? (w.mx - w.gx) : 10, ly = w ? (w.my - w.gy) * (right ? 1 : -1) : 0;
    const c = Math.cos(e.ang), s = Math.sin(e.ang);
    return { x: h.x + (lx * c - ly * s) * this.AP, y: h.y + (lx * s + ly * c) * this.AP };
  },
  // bullets travel in "feet space" (so they collide with walls/footprints);
  // this returns the muzzle point shifted down to feet level plus the visual point.
  shotOrigin(e, isPlayer) {
    const art = this.actorArt(e, isPlayer); const right = Math.cos(e.ang) >= 0; const h = this.handWorld(e, art, right);
    const v = this.muzzleWorld(e, isPlayer); return { x: v.x, y: v.y + (e.y - h.y), vx: v.x, vy: v.y };
  },
  drawActor(g, e, isPlayer, ix, iy, ov) {
    const art = this.actorArt(e, isPlayer); const ax = Math.round(e.x / this.AP) - ix, ay = Math.round(e.y / this.AP) - iy;
    // movement-driven animation
    const d = e._px === undefined ? 0 : Math.hypot(e.x - e._px, e.y - e._py); e._px = e.x; e._py = e.y;
    e._anim = (e._anim || 0) + d; e._still = d > 0.2 ? 0 : (e._still || 0) + 1;
    const right = Math.cos(e.ang) >= 0;
    let alpha = 1;
    if (!isPlayer && e.def.stealth) alpha = (e.state === 'combat' || e.hurtT > 0) ? 0.55 + Math.sin(this.t * 12) * 0.2 : 0.18;
    if (isPlayer && e.invuln > 0) alpha = (Math.floor(this.t * 12) % 2) ? 0.5 : 1;
    g.globalAlpha = alpha;
    const sw = art ? art.w * 0.55 : 12; const sh = this.shadow(sw); g.drawImage(sh, ax - (sh.width >> 1), ay - (sh.height >> 1));
    if (!art) { ART.disc(g, ax, ay - 7, 5, isPlayer ? '#c9b37a' : e.def.col); g.globalAlpha = 1; return; }
    const set = right ? art.right : art.left;
    let fr;
    if (e.hurtT > 0 && set.hurt) fr = set.hurt;
    else if (e._still < 4) fr = set.walk[Math.floor(e._anim / 9) % set.walk.length];
    else if (!isPlayer && e.meleeCd > 0.5 / (e.def.melee ? e.def.melee.rate : 1) && set.attack && e.state === 'combat') fr = set.attack;
    else fr = set.idle[Math.floor(this.t * 2 + (e.id || 0) * 7) % set.idle.length];
    // weapon (behind body when aiming up)
    const wid = this.heldWeapon(e, isPlayer); const wsp = wid && ART.weapon ? ART.weapon(wid) : null;
    const up = Math.sin(e.ang) < -0.35;
    const drawW = () => {
      if (!wsp) return; const h = this.handWorld(e, art, right);
      let ang = e.ang, back = 0;
      if (isPlayer && e.swingAnim > 0) { ang += Math.sin((1 - e.swingAnim / 0.18) * Math.PI) * 1.4; }
      if (isPlayer) back = e.recoil * 2.2; else if (e.fireCd > 0 && WEAPONS[wid] && e.fireCd > 1 / WEAPONS[wid].rof) back = 1;
      g.save(); g.translate(Math.round(h.x / this.AP) - ix + 0.5, Math.round(h.y / this.AP) - iy + 0.5); g.rotate(ang); if (!right) g.scale(1, -1);
      g.drawImage(wsp.c, -wsp.gx - Math.round(back), -wsp.gy); g.restore();
    };
    if (up) drawW();
    g.drawImage(fr, ax - art.ox, ay - art.oy);
    if (!up) drawW();
    g.globalAlpha = 1;
    // overlay info (hi-res pass)
    if (!isPlayer) {
      const top = ay - art.oy;
      if (e.hp < e.maxhp || e.def.boss) ov.bars.push({ x: ax, y: top - 3, f: clamp(e.hp / e.maxhp, 0, 1), boss: e.def.boss, w: e.def.boss ? 20 : 12 });
      if (e.state === 'combat' && e.alertFlash > 0) ov.marks.push({ x: ax, y: top - 6, c: '!' });
      else if (e.state === 'alert' || e.state === 'search') ov.marks.push({ x: ax, y: top - 6, c: '?' });
      if (e.def.boss) ov.names.push({ x: ax, y: top - 9, s: e.def.name });
    }
  },

  // ---- main frame ------------------------------------------------------------
  render(dt) {
    const m = Game.map, p = Game.player, g = this.lg; if (!m || !m.ground) return;
    this.t += dt;
    const sh = Game.shakeA ? Game.shakeA * 0.5 : 0;
    const ca = this.camArt(); ca.x += sh ? rand(-sh, sh) : 0; ca.y += sh ? rand(-sh, sh) : 0;
    const ix = Math.floor(ca.x), iy = Math.floor(ca.y), fx = ca.x - ix, fy = ca.y - iy;
    const LW = this.LW, LH = this.LH, AP = this.AP;
    const inV = (ax, ay, pad = 40) => ax > ix - pad && ax < ix + LW + pad && ay > iy - pad && ay < iy + LH + pad + 20;
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.fillStyle = '#0c0b10'; g.fillRect(0, 0, LW, LH);
    // ground
    const gx0 = Math.max(0, ix), gy0 = Math.max(0, iy), gx1 = Math.min(m.ground.width, ix + LW), gy1 = Math.min(m.ground.height, iy + LH);
    if (gx1 > gx0 && gy1 > gy0) g.drawImage(m.ground, gx0, gy0, gx1 - gx0, gy1 - gy0, gx0 - ix, gy0 - iy, gx1 - gx0, gy1 - gy0);
    const tx0 = Math.max(0, (ix >> 4) - 1), ty0 = Math.max(0, (iy >> 4) - 1), tx1 = Math.min(m.w - 1, ((ix + LW) >> 4) + 1), ty1 = Math.min(m.h - 1, ((iy + LH) >> 4) + 2);
    // animated water
    const w1 = ART.get('water1');
    if (w1 && Math.floor(this.t * 1.6) % 2) for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (m.tiles[m.idx(tx, ty)] === T.WATER) g.drawImage(w1.c, tx * 16 - ix, ty * 16 - iy);
    // ---- flat ground-level layer
    for (const z of m.radZones) {
      const ax = z.x / AP - ix, ay = z.y / AP - iy, r = z.r / AP; if (ax < -r || ay < -r || ax > LW + r || ay > LH + r) continue;
      const gr = g.createRadialGradient(ax, ay, 0, ax, ay, r); gr.addColorStop(0, 'rgba(150,210,40,.20)'); gr.addColorStop(1, 'rgba(150,210,40,0)');
      g.fillStyle = gr; g.fillRect(ax - r, ay - r, r * 2, r * 2);
    }
    for (const e of m.extracts) {
      const ax = Math.round(e.x / AP) - ix, ay = Math.round(e.y / AP) - iy, r = e.r / AP; if (ax < -40 || ay < -40 || ax > LW + 40 || ay > LH + 40) continue;
      g.fillStyle = 'rgba(99,199,77,.12)'; ART.ellipse(g, ax, ay, r, r * 0.75, 'rgba(99,199,77,.10)');
      for (let k = 0; k < 28; k++) { const a = k / 28 * 6.283 + this.t * 0.6; if (k % 2) continue; ART.px(g, ax + Math.cos(a) * r, ay + Math.sin(a) * r * 0.75, '#63c74d'); }
    }
    if (m.struct) for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const s = m.struct[m.idx(tx, ty)]; if (!s) continue;
      if (s.type === 'spikes') { const sp = ART.get('b_spikes'); if (sp) g.drawImage(sp.c, tx * 16 - ix, ty * 16 - iy); else ART.rect(g, tx * 16 - ix + 2, ty * 16 - iy + 2, 12, 12, '#5a4020'); }
      if (s.type === 'landmine') { const sp = ART.get('b_landmine'); if (sp) g.drawImage(sp.c, tx * 16 - ix + 8 - sp.ox, ty * 16 - iy + 10 - sp.oy); else ART.disc(g, tx * 16 - ix + 8, ty * 16 - iy + 8, 3, '#3a4030'); }
    }
    // claim ring (base)
    if (m.kind === 'base' && m.coreTile && (Game.buildMode || Game.mode === 'base')) {
      const r = CORE_LEVELS[Game.run.coreLvl].r; const cx = m.coreTile.tx * 16 + 8 - ix, cy = m.coreTile.ty * 16 + 8 - iy; const rr = (r + 0.5) * 16;
      for (let k = 0; k < 160; k++) { if (k % 3) continue; const a = k / 160 * 6.283 + this.t * 0.05; ART.px(g, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, Game.buildMode ? 'rgba(254,174,52,.8)' : 'rgba(234,212,170,.35)'); }
    }
    // live explosives: blinking danger ring so the player can dodge
    for (const t of Game.throwables) {
      if (t.kind === 'rocket') continue; const r = (t.kind === 'satchel' ? 70 : 100) / AP; const ax = t.x / AP - ix, ay = t.y / AP - iy;
      if (Math.floor(this.t * 8) % 2) continue;
      for (let k = 0; k < 40; k++) { const a = k / 40 * 6.283; ART.px(g, ax + Math.cos(a) * r, ay + Math.sin(a) * r * 0.75, 'rgba(228,59,68,.85)'); }
    }
    // anomalies
    for (const a of m.anoms) { const ax = a.x / AP - ix, ay = a.y / AP - iy; if (ax > -40 && ay > -40 && ax < LW + 40 && ay < LH + 40) this.drawAnom(g, a, ax, ay, dt); }
    // corpses & drop bags (flat)
    for (const c of m.containers) {
      if (c.type !== 'corpse' || c.broken) continue; const ax = Math.round(c.x / AP) - ix, ay = Math.round(c.y / AP) - iy; if (ax < -30 || ay < -30 || ax > LW + 30 || ay > LH + 30) continue;
      if (c.corpse && c.corpse.art) { const set = c.corpse.right ? c.corpse.art.right : c.corpse.art.left; const s = set.dead; if (s) g.drawImage(s, ax - (s.ox ?? (s.width >> 1)), ay - (s.oy ?? (s.height - 1)) + 2); }
      else { const s = ART.get('lootbag'); if (s) g.drawImage(s.c, ax - s.ox, ay - s.oy); else ART.disc(g, ax, ay - 3, 3, '#7a5a32'); }
      if (c.items && c.items.length) this.sparkle(g, ax, ay - 8, c);
    }
    // ground loot
    for (const gi of m.groundItems || []) {
      const ax = Math.round(gi.x / AP) - ix, ay = Math.round(gi.y / AP) - iy; if (ax < -20 || ay < -20 || ax > LW + 20 || ay > LH + 20) continue;
      const ic = ART.icon ? ART.icon(gi.item.id) : null; const bob = Math.round(Math.sin(this.t * 3 + gi.x) * 1);
      const s2 = this.shadow(10); g.drawImage(s2, ax - 5, ay - 1);
      if (ic) g.drawImage(ic, ax - 8, ay - 14 + bob); else ART.rect(g, ax - 3, ay - 6, 6, 5, '#d8b048');
      this.sparkle(g, ax, ay - 14, gi);
    }
    // ---- depth-sorted layer
    const list = []; const ov = { bars: [], marks: [], names: [] };
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const i = m.idx(tx, ty), t = m.tiles[i];
      if (t === T.WALL || t === T.FENCE || t === T.KEYDOOR) list.push({ y: (ty + 1) * TILE - 0.5, k: 0, tx, ty, t });
      if (m.struct) { const s = m.struct[i]; if (s && s.type !== 'spikes' && s.type !== 'landmine') list.push({ y: (ty + 1) * TILE - 0.4, k: 1, s }); }
    }
    for (const o of m.objs) if (inV(o.x / AP, o.y / AP, 60)) list.push({ y: o.y, k: 2, o });
    for (const c of m.containers) if (c.type !== 'corpse' && !c.broken && inV(c.x / AP, c.y / AP)) list.push({ y: c.y, k: 3, c });
    for (const e of Game.enemies) if (!e.dead && (e.visible || e.seenT > 0) && inV(e.x / AP, e.y / AP)) list.push({ y: e.y, k: 4, e });
    if (p && !p.dead) list.push({ y: p.y, k: 5 });
    for (const t of Game.throwables) list.push({ y: t.y, k: 6, t });
    list.sort((a, b) => a.y - b.y);
    const kd = {}; for (const k of m.keydoors) kd[k.ty * m.w + k.tx] = k;
    for (const it of list) {
      switch (it.k) {
        case 0: this.drawWallTile(g, m, it.tx, it.ty, it.t, kd, ix, iy); break;
        case 1: this.drawStruct(g, it.s, ix, iy, ov); break;
        case 2: this.drawObj(g, it.o, ix, iy, dt); break;
        case 3: this.drawContainer(g, it.c, ix, iy); break;
        case 4: this.drawActor(g, it.e, false, ix, iy, ov); break;
        case 5: this.drawActor(g, p, true, ix, iy, ov); break;
        case 6: this.drawThrowable(g, it.t, ix, iy); break;
      }
    }
    // bullets (pixel tracers)
    for (const b of Game.bullets) {
      const BH = b.h ?? 8; const x0 = (b.px ?? b.x) / AP - ix, y0 = (b.py ?? b.y) / AP - iy - BH, x1 = b.x / AP - ix, y1 = b.y / AP - iy - BH;
      ART.line(g, x0, y0, x1, y1, b.owner === 'enemy' ? '#ff9a5a' : '#fff2a8'); ART.px(g, x1, y1, '#ffffff');
    }
    // muzzle flashes
    for (const f of this.flashes) {
      f.life -= dt; const s = ART.get('fx_muzzle' + f.f); const ax = f.x / AP - ix, ay = f.y / AP - iy;
      if (s) { g.save(); g.translate(Math.round(ax), Math.round(ay)); g.rotate(f.ang); g.drawImage(s.c, -s.ox, -s.oy); g.restore(); } else ART.disc(g, ax, ay, 2, '#fff2a0');
    }
    this.flashes = this.flashes.filter(f => f.life > 0);
    // particles
    for (const q of Game.particles) {
      const ax = q.x / AP - ix, ay = q.y / AP - iy; if (ax < -8 || ay < -8 || ax > LW + 8 || ay > LH + 8) continue;
      const a = clamp(q.life / q.max, 0, 1);
      if (q.smoke) { const s = ART.get('fx_smoke' + (q.f ?? (q.f = (Math.random() * 3) | 0))); g.globalAlpha = a * 0.7; if (s) g.drawImage(s.c, Math.round(ax - s.w / 2), Math.round(ay - s.h / 2)); else ART.disc(g, ax, ay, 2, q.col); g.globalAlpha = 1; }
      else { const sz = Math.max(1, Math.round(q.size / AP)); g.globalAlpha = Math.min(1, a * 1.5); g.fillStyle = q.col; g.fillRect(Math.round(ax - sz / 2), Math.round(ay - sz / 2), sz, sz); g.globalAlpha = 1; }
    }
    // sprite animations
    for (const a of this.anims) {
      a.t += dt; const f = Math.floor(a.t * a.fps); if (f >= a.frames) { a.done = true; continue; }
      const s = ART.get(a.base + f); const ax = Math.round(a.x / AP) - ix, ay = Math.round(a.y / AP) - iy;
      if (s) g.drawImage(s.c, ax - s.ox, ay - s.oy); else ART.disc(g, ax, ay, 10 - f, f < 2 ? '#fff0a0' : '#ff7a30');
    }
    this.anims = this.anims.filter(a => !a.done);
    // aim laser
    if (p && !p.dead && !Game.buildMode) {
      const aim = Game.aimInput();
      if (aim.active && Input.aim.id !== null) {
        const mz = this.muzzleWorld(p, true); let x = mz.x, y = mz.y; const c = Math.cos(p.ang), s = Math.sin(p.ang);
        for (let k = 0; k < 70; k++) { x += c * 6; y += s * 6; if (m.opaqueAt(Math.floor(x / TILE), Math.floor(y / TILE))) break; if (k % 2 === 0) ART.px(g, x / AP - ix, y / AP - iy, aim.fire ? 'rgba(255,90,70,.8)' : 'rgba(255,90,70,.45)'); }
      }
    }
    // interact prompt arrow
    const ia = Game.interact;
    if (ia && !Game.buildMode && p && !p.dead) {
      const o = ia.o; let wx = o.x, wy = o.y; if (ia.kind === 'keydoor') { wx = o.tx * TILE + 16; wy = o.ty * TILE; } if (ia.kind === 'struct') wy -= 10;
      const ax = Math.round(wx / AP) - ix, ay = Math.round(wy / AP) - iy - 18 + Math.round(Math.sin(this.t * 6) * 1.5);
      for (let r = 0; r < 4; r++) ART.rect(g, ax - 3 + r, ay + r, 7 - r * 2, 1, r === 3 ? '#feae34' : '#fff');
    }
    // tutorial pointer
    if (Game.tutTarget && p) this.pointer(g, Game.tutTarget, ix, iy);
    // build ghosts
    if (Game.buildMode) this.drawBuildGhosts(g, ix, iy);
    // roofs
    for (const rf of m.roofs) this.drawRoof(g, rf, ix, iy, dt);
    // ambient motes
    this.drawMotes(g, dt, ix, iy);
    // ---- lighting & grade
    const dark = this.darkness();
    if (dark > 0.02) this.drawLighting(g, dark, ix, iy);
    this.grade(g);
    // ---- upscale
    const G = this.g; G.setTransform(1, 0, 0, 1, 0, 0); G.imageSmoothingEnabled = false;
    G.drawImage(this.lc, 0, 0, LW, LH, -Math.round(fx * this.s), -Math.round(fy * this.s), LW * this.s, LH * this.s);
    // ---- hi-res overlay
    G.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.overlay(G, ov, ix + fx, iy + fy);
  },

  // ---- pieces ----------------------------------------------------------------
  sparkle(g, ax, ay, o) {
    const ph = (this.t * 1.3 + (o.x || 0) * 0.013) % 2.2; if (ph > 0.6) return;
    const k = ph < 0.3 ? 1 : 0; ART.px(g, ax, ay, '#fff'); if (k) { ART.px(g, ax - 1, ay, '#feae34'); ART.px(g, ax + 1, ay, '#feae34'); ART.px(g, ax, ay - 1, '#feae34'); ART.px(g, ax, ay + 1, '#feae34'); }
  },
  wallSprite(m, tx, ty, t, kd) {
    if (t === T.FENCE) return ART.get('fence');
    if (t === T.KEYDOOR) { const k = kd[ty * m.w + tx]; return ART.get('keydoor_' + (k ? k.key.split('_')[1] : 'green')); }
    const wk = m.wkind[m.idx(tx, ty)]; return ART.get(wk === 1 ? 'wall_plank' : wk === 2 ? 'wall_concrete' : 'wall_brick');
  },
  drawWallTile(g, m, tx, ty, t, kd, ix, iy) {
    const x = tx * 16 - ix, y = ty * 16 - iy;
    if (t === T.FENCE && m.t(tx - 1, ty) !== T.FENCE && m.t(tx + 1, ty) !== T.FENCE) { // vertical fence run
      const f = ART.get('fence'); if (f) { g.drawImage(f.c, 0, 0, 2, f.h, x + 7, y - f.oy, 2, f.h); }
      for (let k = 0; k < 16; k += 2) { ART.px(g, x + 6, y - 6 + k + (k % 4 ? 1 : 0), 'rgba(192,203,220,.55)'); ART.px(g, x + 9, y - 6 + k + (k % 4 ? 0 : 1), 'rgba(139,155,180,.55)'); }
      ART.line(g, x + 7, y - 6, x + 7, y + 10, 'rgba(192,203,220,.35)'); return;
    }
    const s = this.wallSprite(m, tx, ty, t, kd);
    if (s) { g.drawImage(s.c, x - s.ox, y - s.oy + (t === T.FENCE ? 0 : 0)); }
    else { ART.rect(g, x, y - 10, 16, 16, '#4a4440'); ART.rect(g, x, y + 6, 16, 10, '#2a2826'); }
  },
  drawStruct(g, s, ix, iy, ov) {
    const x = s.tx * 16 - ix, y = s.ty * 16 - iy; const t = s.type;
    let name = 'b_' + t;
    if (t === 'campfire') name = 'b_campfire' + (Math.floor(this.t * 8) % 3);
    else if (t === 'furnace') name = 'b_furnace' + (Math.floor(this.t * 6) % 2);
    else if (t === 'recycler' || t === 'quarry') name = 'b_' + t + (Math.floor(this.t * 4) % 2);
    const sp = ART.get(name) || ART.get('b_' + t + '0');
    const sh = this.shadow(14); g.drawImage(sh, x + 1, y + 13);
    if (sp) {
      const src = s.hitT > 0 ? this.sil(sp.c) : sp.c;
      g.drawImage(src, x - sp.ox, y - sp.oy);
    } else { ART.rect(g, x + 1, y - 6, 14, 20, '#666'); }
    const td = STRUCTS[t].turret;
    if (td) {
      const mt = (ART.TURRET_MOUNT || {})['b_' + t] || { x: 8, y: 4 };
      const head = ART.get(mt.head || (t === 'auto_turret' ? 'b_turret_gun' : 'b_shotgun_gun'));
      const hx = x - (sp ? sp.ox : 0) + mt.x, hy = y - (sp ? sp.oy : 0) + mt.y;
      if (head) { g.save(); g.translate(hx, hy); g.rotate(s.ang); if (Math.cos(s.ang) < 0) g.scale(1, -1); g.drawImage(head.c, -head.ox, -head.oy); g.restore(); }
      if (s.noAmmo && Game.mode === 'raid') ov.marks.push({ x: x + 8, y: hy - 8, c: 'NO AMMO', col: '#ff6a5a' });
    }
    if (s.hp < s.maxhp && (Game.buildMode || Game.mode === 'raid')) ov.bars.push({ x: x + 8, y: y - (sp ? sp.oy : 10) - 2, f: clamp(s.hp / s.maxhp, 0, 1), w: 12, struct: true });
  },
  objSprite(o) {
    if (o.spr !== undefined) return o.spr;
    const v = o.v || 0; let s = null;
    switch (o.type) {
      case 'tree': s = this.variant('tree_' + (o.style || 'pine'), v); break;
      case 'rock': s = this.variant('rock', v); break;
      case 'ore_metal': s = this.variant('ore_metal', v); break;
      case 'ore_sulfur': s = this.variant('ore_sulfur', v); break;
      case 'bush': s = this.variant('bush', v); break;
      case 'car': s = this.variant('car', v); break;
      default: s = ART.get(o.type) || null;
    }
    o.spr = s; return s;
  },
  drawObj(g, o, ix, iy, dt) {
    const s = this.objSprite(o); const ax = Math.round(o.x / this.AP) - ix, ay = Math.round(o.y / this.AP) - iy;
    let sx = 0; if (o.shake > 0) { o.shake -= dt; sx = (Math.floor(this.t * 40) % 2) ? 1 : -1; }
    if (!s) { ART.disc(g, ax, ay - 5, Math.round(o.r / this.AP), o.type === 'tree' ? '#2a4022' : '#7d8086'); return; }
    const big = s.w > 14; if (o.type !== 'bush') { const sh = this.shadow(Math.min(40, s.w * (o.type === 'tree' ? 0.6 : 0.8))); g.drawImage(sh, ax - (sh.width >> 1), ay - (sh.height >> 1)); }
    // fade trees/large props that hide the player
    const p = Game.player; let a = 1;
    if (p && big && (o.type === 'tree' || o.type === 'tower' || o.type === 'dish')) {
      const px = p.x / this.AP - ix, py = p.y / this.AP - iy;
      if (p.y < o.y && px > ax - s.ox && px < ax - s.ox + s.w && py > ay - s.oy && py - 8 < ay) a = 0.45;
    }
    g.globalAlpha = a; g.drawImage(s.c, ax - s.ox + sx, ay - s.oy); g.globalAlpha = 1;
  },
  drawContainer(g, c, ix, iy) {
    const names = { barrel: c.red ? 'barrel_red' : 'barrel', crate: 'crate', toolbox: 'toolbox', medbox: 'medbox', ammobox: 'ammobox', military: 'military', elite: 'elite', cache: 'cache' };
    const s = ART.get(names[c.type]); const ax = Math.round(c.x / this.AP) - ix, ay = Math.round(c.y / this.AP) - iy;
    const sh = this.shadow(s ? s.w * 0.9 : 10); g.drawImage(sh, ax - (sh.width >> 1), ay - (sh.height >> 1));
    const empty = c.items && c.items.length === 0 && c.searched > 0;
    if (empty) g.globalAlpha = 0.55;
    if (s) g.drawImage(s.c, ax - s.ox, ay - s.oy); else ART.rect(g, ax - 6, ay - 10, 12, 10, CONTAINERS[c.type].col);
    g.globalAlpha = 1;
    if (!empty && c.type !== 'barrel' && (!c.items || c.searched < c.items.length)) this.sparkle(g, ax + 4, ay - (s ? s.oy : 10) - 2, c);
  },
  drawThrowable(g, t, ix, iy) {
    const ax = Math.round(t.x / this.AP) - ix, ay = Math.round(t.y / this.AP) - iy;
    if (t.kind === 'rocket') { const s = ART.get('fx_rocket'); if (s) { g.save(); g.translate(ax, ay); g.rotate(Math.atan2(t.vy, t.vx)); g.drawImage(s.c, -s.w / 2, -s.h / 2); g.restore(); } else ART.rect(g, ax - 2, ay - 1, 4, 2, '#ccc'); return; }
    const s = ART.get(t.kind === 'satchel' ? 'fx_satchel' : 'fx_grenade');
    const hop = t.kind === 'grenade' ? Math.round(Math.abs(Math.sin(t.fuse * 6)) * 4 * Math.min(1, Math.hypot(t.vx, t.vy) / 200)) : 0;
    g.drawImage(this.shadow(5), ax - 2, ay - 1);
    if (s) g.drawImage(s.c, ax - (s.w >> 1), ay - s.h - hop); else ART.disc(g, ax, ay - 2 - hop, 2, '#4a5a2a');
    if (t.kind === 'satchel' && (t.blink || 0) < 0.12) ART.px(g, ax, ay - 5, '#ff3030');
  },
  drawAnom(g, a, ax, ay, dt) {
    a.ph += dt; if (a.flash > 0) a.flash -= dt;
    const r = a.r / this.AP;
    const col = a.kind === 'burner' ? ['#f77622', '#feae34', '#e43b44'] : a.kind === 'electro' ? ['#2ce8f5', '#c0cbdc', '#0099db'] : ['#b55088', '#c0cbdc', '#68386c'];
    const n = 26;
    for (let i = 0; i < n; i++) {
      const k = (i * 0.618 + a.ph * (a.kind === 'gravity' ? 0.25 : 0.4)) % 1; let rr, ang;
      if (a.kind === 'gravity') { rr = r * (1 - k); ang = i * 2.39 + k * 6; }
      else if (a.kind === 'burner') { rr = r * 0.5 * ((i * 0.37) % 1); ang = i * 2.39; }
      else { rr = r * 0.6 * ((i * 0.53 + Math.sin(a.ph * 7 + i)) % 1); ang = i * 2.39 + a.ph * 3; }
      let x = ax + Math.cos(ang) * rr, y = ay + Math.sin(ang) * rr * 0.7;
      if (a.kind === 'burner') y -= k * 10;
      g.globalAlpha = a.kind === 'burner' ? 1 - k : 0.85; ART.px(g, x, y, col[i % 3]);
    }
    g.globalAlpha = 0.18 + (a.flash > 0 ? 0.4 : 0); ART.ellipse(g, ax, ay, Math.round(r * 0.55), Math.round(r * 0.4), col[2]); g.globalAlpha = 1;
    if (a.kind === 'electro' && Math.random() < 0.06) { let x = ax, y = ay; for (let k = 0; k < 4; k++) { const nx = x + rand(-8, 8), ny = y + rand(-6, 6); ART.line(g, x, y, nx, ny, '#c0f8ff'); x = nx; y = ny; } }
    if (a.art) { const c = ITEMS[a.art].col; const b = Math.sin(a.ph * 4) > 0; ART.disc(g, ax, ay - 2, 1, c); if (b) { ART.px(g, ax, ay - 4, '#fff'); ART.px(g, ax - 2, ay - 2, c); ART.px(g, ax + 2, ay - 2, c); } }
  },
  drawRoof(g, rf, ix, iy, dt) {
    const p = Game.player; const inside = p && p.x >= rf.x * TILE && p.x < (rf.x + rf.w) * TILE && p.y >= rf.y * TILE - 8 && p.y < (rf.y + rf.h) * TILE;
    rf.a = rf.a === undefined ? 1 : lerp(rf.a, inside ? 0 : 1, 1 - Math.exp(-10 * dt));
    if (rf.a < 0.03) return;
    const x0 = rf.x * 16 - ix, y0 = rf.y * 16 - iy - 10, W = rf.w * 16, H = rf.h * 16;
    if (x0 > this.LW || y0 > this.LH || x0 + W < 0 || y0 + H < 0) return;
    const tex = ART.get(rf.kind) || null;
    g.globalAlpha = rf.a;
    if (tex) { for (let y = 0; y < H; y += 16) for (let x = 0; x < W; x += 16) g.drawImage(tex.c, 0, 0, Math.min(16, W - x), Math.min(16, H - y), x0 + x, y0 + y, Math.min(16, W - x), Math.min(16, H - y)); }
    else { ART.rect(g, x0, y0, W, H, '#6a3a2a'); }
    // eaves: dark rim + highlight on the top edge + shadow on the bottom
    ART.rect(g, x0, y0, W, 1, 'rgba(255,255,255,.18)'); ART.rect(g, x0, y0 + H - 2, W, 2, 'rgba(10,8,20,.45)');
    ART.rect(g, x0, y0, 1, H, 'rgba(255,255,255,.08)'); ART.rect(g, x0 + W - 1, y0, 1, H, 'rgba(10,8,20,.35)');
    if (rf.kind !== 'roof_flat' && rf.h >= 3) ART.rect(g, x0 + 1, y0 + (H >> 1), W - 2, 1, 'rgba(10,8,20,.35)'); // ridge
    g.globalAlpha = 1;
  },
  pointer(g, tgt, ix, iy) {
    const ax = Math.round(tgt.x / this.AP) - ix, ay = Math.round(tgt.y / this.AP) - iy - 22 + Math.round(Math.sin(this.t * 5) * 2);
    if (ax > 4 && ay > 4 && ax < this.LW - 4 && ay < this.LH - 4) {
      for (let r = 0; r < 5; r++) ART.rect(g, ax - 4 + r, ay + r, 9 - r * 2, 1, r % 2 ? '#feae34' : '#fee761');
      ART.rect(g, ax - 1, ay - 5, 3, 5, '#feae34');
    }
  },
  drawBuildGhosts(g, ix, iy) {
    for (const gh of Game.buildGhosts || []) {
      const x = gh.tx * 16 - ix, y = gh.ty * 16 - iy;
      const t = Game.buildSel; const sp = STRUCTS[t] ? ART.get('b_' + t) || ART.get('b_' + t + '0') : null;
      if (sp && STRUCTS[t]) { g.globalAlpha = 0.65; g.drawImage(gh.ok ? sp.c : this.sil(sp.c, '#e43b44'), x - sp.ox, y - sp.oy); g.globalAlpha = 1; }
      g.fillStyle = gh.ok ? 'rgba(99,199,77,.28)' : 'rgba(228,59,68,.32)'; g.fillRect(x, y, 16, 16);
      ART.rect(g, x, y, 16, 1, gh.ok ? '#63c74d' : '#e43b44'); ART.rect(g, x, y + 15, 16, 1, gh.ok ? '#63c74d' : '#e43b44');
      ART.rect(g, x, y, 1, 16, gh.ok ? '#63c74d' : '#e43b44'); ART.rect(g, x + 15, y, 1, 16, gh.ok ? '#63c74d' : '#e43b44');
    }
  },
  drawMotes(g, dt, ix, iy) {
    const m = Game.map; const kind = Game.mode === 'raid' ? 'night' : m.zone ? m.zone.mote || 'dust' : 'pollen';
    const want = kind === 'night' ? 30 : 40;
    while (this.motes.length < want) this.motes.push({ x: Math.random() * this.LW, y: Math.random() * this.LH, vx: rand(-4, 4), vy: rand(-2, 4), ph: Math.random() * 6 });
    const col = kind === 'ash' ? '#c0cbdc' : kind === 'night' ? '#2ce8f5' : kind === 'leaf' ? '#d77643' : '#ead4aa';
    for (const q of this.motes) {
      q.ph += dt; q.x += (q.vx + Math.sin(q.ph) * 3) * dt; q.y += (q.vy + (kind === 'ash' ? 6 : 0)) * dt;
      if (q.x < 0) q.x += this.LW; if (q.x > this.LW) q.x -= this.LW; if (q.y < 0) q.y += this.LH; if (q.y > this.LH) q.y -= this.LH;
      g.globalAlpha = kind === 'night' ? (Math.sin(q.ph * 3) > 0.6 ? 0.9 : 0) : 0.35; ART.px(g, q.x, q.y, col);
    }
    g.globalAlpha = 1;
  },
  darkness() {
    if (Game.mode === 'raid') return 0.62;
    if (Game.mode === 'menu') return 0.35;
    if (Game.zs) { const t = Game.zs.time; if (t < 110) return clamp((110 - t) / 110 * 0.5, 0, 0.5) + (Game.zs.emission ? 0.08 : 0); }
    return 0;
  },
  drawLighting(g, dark, ix, iy) {
    const D = this.dg, W = this.LW, H = this.LH, m = Game.map, AP = this.AP;
    D.globalCompositeOperation = 'source-over'; D.clearRect(0, 0, W, H); D.fillStyle = Game.mode === 'raid' ? `rgba(8,12,34,${dark})` : `rgba(20,10,24,${dark})`; D.fillRect(0, 0, W, H);
    D.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, a = 1) => {
      const sx = x / AP - ix, sy = y / AP - iy, rr = r / AP; if (sx < -rr || sy < -rr || sx > W + rr || sy > H + rr) return;
      const gr = D.createRadialGradient(sx, sy, 0, sx, sy, rr); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(0.6, `rgba(0,0,0,${a * 0.6})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      D.fillStyle = gr; D.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
    };
    const p = Game.player;
    if (p && !p.dead) {
      hole(p.x, p.y, 130, 0.85);
      const sx = p.x / AP - ix, sy = p.y / AP - iy, Rr = 360 / AP;
      const gr = D.createRadialGradient(sx, sy, 0, sx, sy, Rr); gr.addColorStop(0, 'rgba(0,0,0,.95)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      D.fillStyle = gr; D.beginPath(); D.moveTo(sx, sy); D.arc(sx, sy, Rr, p.ang - 0.45, p.ang + 0.45); D.closePath(); D.fill();
    }
    const glows = [];
    if (m.struct) for (const s of m.struct) { if (!s) continue; const d = STRUCTS[s.type]; if (d.light) { const fl = 1 + Math.sin(this.t * 9 + s.tx) * 0.04; hole(s.x, s.y, d.light * TILE * fl); glows.push([s.x, s.y, d.light * TILE * 0.6, s.type === 'floodlight' ? 'rgba(192,203,220,.16)' : 'rgba(247,118,34,.22)']); } }
    for (const l of Game.lights) { const a = clamp(l.life / l.max, 0, 1); hole(l.x, l.y, l.r, a); glows.push([l.x, l.y, l.r * 0.5, `rgba(254,174,52,${0.25 * a})`]); }
    for (const a of m.anoms) { hole(a.x, a.y, 70, 0.4); }
    for (const e of m.extracts) { hole(e.x, e.y, 90, 0.5); glows.push([e.x, e.y, 60, 'rgba(99,199,77,.18)']); }
    if (Game.mode === 'raid') for (const e of Game.enemies) if (!e.dead && e.def.raider) { hole(e.x, e.y - 8, 80, 0.6); glows.push([e.x, e.y - 8, 40, 'rgba(247,118,34,.18)']); }
    D.globalCompositeOperation = 'source-over';
    g.drawImage(this.dk, 0, 0);
    g.globalCompositeOperation = 'lighter';
    for (const [x, y, r, col] of glows) { const sx = x / AP - ix, sy = y / AP - iy, rr = r / AP; if (sx < -rr || sy < -rr || sx > W + rr || sy > H + rr) continue; const gr = g.createRadialGradient(sx, sy, 0, sx, sy, rr); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(sx - rr, sy - rr, rr * 2, rr * 2); }
    g.globalCompositeOperation = 'source-over';
  },
  grade(g) {
    const m = Game.map; let tint = m.zone ? m.zone.tint : '#e8e0d0';
    if (Game.zs && Game.zs.time < 110 && !Game.zs.emission) tint = ART.mix(tint, '#f0a070', clamp((110 - Game.zs.time) / 110, 0, 0.7));
    if (tint) { g.globalCompositeOperation = 'multiply'; g.fillStyle = tint; g.fillRect(0, 0, this.LW, this.LH); g.globalCompositeOperation = 'source-over'; }
    if (Game.zs && Game.zs.emission) {
      g.fillStyle = `rgba(180,20,30,${0.16 + Math.sin(this.t * 3) * 0.07})`; g.fillRect(0, 0, this.LW, this.LH);
      if (Math.random() < 0.012) Game.emFlash = 0.15;
    }
    if (Game.emFlash > 0) { Game.emFlash -= 1 / 60; g.fillStyle = `rgba(255,220,220,${Game.emFlash * 2})`; g.fillRect(0, 0, this.LW, this.LH); }
    const p = Game.player; if (p && p.hurtT > 0) { g.fillStyle = `rgba(162,38,51,${p.hurtT * 0.5})`; g.fillRect(0, 0, this.LW, this.LH); }
    if (p && p.hp < p.maxhp * 0.3 && !p.dead) { g.fillStyle = `rgba(120,0,10,${0.12 + Math.sin(this.t * 4) * 0.06})`; g.fillRect(0, 0, this.LW, this.LH); }
    if (!this.vign) {
      const [v, vg] = ART.canvas(this.LW, this.LH);
      const gr = vg.createRadialGradient(this.LW / 2, this.LH / 2, Math.min(this.LW, this.LH) * 0.3, this.LW / 2, this.LH / 2, Math.max(this.LW, this.LH) * 0.68);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(8,6,16,.6)'); vg.fillStyle = gr; vg.fillRect(0, 0, this.LW, this.LH); this.vign = v;
    }
    g.drawImage(this.vign, 0, 0);
  },

  // ---- hi-res overlay ----------------------------------------------------------
  overlay(G, ov, cax, cay) {
    const c = this.css; const toS = (ax, ay) => [(ax + Math.floor(cax) - cax) * c, (ay + Math.floor(cay) - cay) * c];
    G.textAlign = 'center'; G.lineJoin = 'round';
    // enemy health bars
    for (const b of ov.bars) {
      const [x, y] = toS(b.x, b.y); const w = b.w * c, h = Math.max(3, c * 0.9);
      G.fillStyle = 'rgba(10,8,20,.75)'; G.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
      G.fillStyle = b.struct ? (b.f > 0.5 ? '#63c74d' : b.f > 0.25 ? '#feae34' : '#e43b44') : b.boss ? '#feae34' : '#e43b44'; G.fillRect(x - w / 2, y, w * b.f, h);
    }
    G.font = `900 ${Math.round(c * 5)}px system-ui, sans-serif`;
    for (const mk of ov.marks) {
      const [x, y] = toS(mk.x, mk.y); const small = mk.c.length > 1; if (small) G.font = `800 ${Math.round(c * 3)}px system-ui, sans-serif`;
      G.lineWidth = Math.max(2, c * 0.8); G.strokeStyle = '#181425'; G.strokeText(mk.c, x, y); G.fillStyle = mk.col || (mk.c === '!' ? '#e43b44' : '#fee761'); G.fillText(mk.c, x, y);
      if (small) G.font = `900 ${Math.round(c * 5)}px system-ui, sans-serif`;
    }
    G.font = `800 ${Math.round(c * 3.2)}px system-ui, sans-serif`;
    for (const n of ov.names) { const [x, y] = toS(n.x, n.y); G.lineWidth = 3; G.strokeStyle = '#181425'; G.strokeText(n.s, x, y); G.fillStyle = '#feae34'; G.fillText(n.s, x, y); }
    // floating texts
    G.font = `800 ${Math.round(c * 3.6)}px system-ui, sans-serif`;
    for (const t of Game.texts) {
      const s = this.worldToScreen(t.x, t.y); G.globalAlpha = clamp(t.life * 1.6, 0, 1);
      G.lineWidth = 3; G.strokeStyle = '#181425'; G.strokeText(t.txt, s.x, s.y); G.fillStyle = t.col; G.fillText(t.txt, s.x, s.y);
    }
    G.globalAlpha = 1;
    // extraction labels
    const m = Game.map;
    if (Game.mode === 'zone') { G.font = `700 ${Math.round(c * 2.6)}px system-ui, sans-serif`; for (const e of m.extracts) { const s = this.worldToScreen(e.x, e.y - e.r - 8); if (s.x < -50 || s.y < -20 || s.x > innerWidth + 50 || s.y > innerHeight + 20) continue; G.lineWidth = 3; G.strokeStyle = '#181425'; G.strokeText('EXFIL · ' + e.name, s.x, s.y); G.fillStyle = '#9af08a'; G.fillText('EXFIL · ' + e.name, s.x, s.y); } }
    // damage direction
    const p = Game.player;
    if (p && p.hitDirs) {
      const s = this.worldToScreen(p.x, p.y);
      for (const h of p.hitDirs) { h.t -= 1 / 60; if (h.t <= 0) continue; G.strokeStyle = `rgba(228,59,68,${h.t})`; G.lineWidth = 6; G.beginPath(); G.arc(s.x, s.y, 70, h.ang - 0.35, h.ang + 0.35); G.stroke(); }
      p.hitDirs = p.hitDirs.filter(h => h.t > 0);
    }
    // hit marker
    if (Game.hitMark > 0 && p) {
      Game.hitMark -= 1 / 60; const aimS = this.worldToScreen(p.x + Math.cos(p.ang) * 120, p.y + Math.sin(p.ang) * 120);
      G.strokeStyle = Game.killMark ? '#e43b44' : '#fff'; G.lineWidth = 2.5; const k = 6, q = 12;
      G.beginPath(); for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { G.moveTo(aimS.x + dx * k, aimS.y + dy * k); G.lineTo(aimS.x + dx * q, aimS.y + dy * q); } G.stroke();
    }
    this.drawSticks(G);
    if (p) this.drawMarkers(G);
  },
  drawSticks(G) {
    if (Game.mode === 'menu' || UI.modalOpen) return;
    const R0 = Input.STICK_R;
    const ghost = (x, y, label) => { G.globalAlpha = 0.16; G.strokeStyle = '#fff'; G.lineWidth = 2; G.beginPath(); G.arc(x, y, R0, 0, 7); G.stroke(); G.globalAlpha = 0.22; G.fillStyle = '#fff'; G.beginPath(); G.arc(x, y, R0 * 0.38, 0, 7); G.fill(); G.globalAlpha = 0.35; G.font = '700 10px system-ui'; G.textAlign = 'center'; G.fillText(label, x, y + R0 + 14); G.globalAlpha = 1; };
    const home = Input.homes();
    if (Input.touchMode || !Input.mouse.used) {
      if (Input.move.id === null) ghost(home.mx, home.my, 'MOVE');
      if (Input.aim.id === null && !Game.buildMode) ghost(home.ax, home.ay, 'AIM · FIRE');
    }
    for (const s of [Input.move, Input.aim]) {
      if (s.id === null) continue; const isAim = s === Input.aim;
      G.globalAlpha = 0.3; G.strokeStyle = '#fff'; G.lineWidth = 2; G.beginPath(); G.arc(s.ox, s.oy, R0, 0, 7); G.stroke();
      if (isAim) { G.globalAlpha = 0.45; G.strokeStyle = '#e43b44'; G.setLineDash([4, 5]); G.beginPath(); G.arc(s.ox, s.oy, R0 * Input.FIRE_T, 0, 7); G.stroke(); G.setLineDash([]); }
      const k = Math.min(1, 1 / Math.max(1e-6, Math.hypot(s.x, s.y)));
      const kx = s.ox + s.x * R0 * Math.min(1, k), ky = s.oy + s.y * R0 * Math.min(1, k);
      G.globalAlpha = 0.55; G.fillStyle = isAim ? (s.mag > Input.FIRE_T ? '#e43b44' : '#feae34') : '#fff';
      G.beginPath(); G.arc(kx, ky, R0 * 0.4, 0, 7); G.fill(); G.globalAlpha = 1;
    }
    if (!Input.touchMode && Input.mouse.used && !Game.buildMode) {
      G.strokeStyle = 'rgba(255,240,200,.9)'; G.lineWidth = 1.5; const { x, y } = Input.mouse;
      G.beginPath(); G.arc(x, y, 7, 0, 7); G.moveTo(x - 12, y); G.lineTo(x - 4, y); G.moveTo(x + 4, y); G.lineTo(x + 12, y); G.moveTo(x, y - 12); G.lineTo(x, y - 4); G.moveTo(x, y + 4); G.lineTo(x, y + 12); G.stroke();
    }
  },
  drawMarkers(G) {
    const p = Game.player, W = innerWidth, H = innerHeight;
    const marker = (wx, wy, col, label) => {
      const s = this.worldToScreen(wx, wy); const mg = 34;
      if (s.x > mg && s.y > mg && s.x < W - mg && s.y < H - mg) return;
      const cx = W / 2, cy = H / 2, a = Math.atan2(s.y - cy, s.x - cx);
      const k = Math.min((W / 2 - mg) / Math.abs(Math.cos(a) || 1e-6), (H / 2 - mg) / Math.abs(Math.sin(a) || 1e-6));
      const x = cx + Math.cos(a) * k, y = cy + Math.sin(a) * k;
      G.save(); G.translate(x, y); G.rotate(a); G.fillStyle = col; G.strokeStyle = '#181425'; G.lineWidth = 2; G.beginPath(); G.moveTo(13, 0); G.lineTo(-7, -9); G.lineTo(-3, 0); G.lineTo(-7, 9); G.closePath(); G.stroke(); G.fill(); G.restore();
      if (label) { G.font = '800 11px system-ui'; G.textAlign = 'center'; G.lineWidth = 3; G.strokeStyle = '#181425'; G.strokeText(label, x - Math.cos(a) * 22, y - Math.sin(a) * 22 + 4); G.fillStyle = col; G.fillText(label, x - Math.cos(a) * 22, y - Math.sin(a) * 22 + 4); }
    };
    if (Game.mode === 'zone') for (const e of Game.map.extracts) marker(e.x, e.y, '#7af06a', Math.round(dist(p.x, p.y, e.x, e.y) / TILE) + 'm');
    if (Game.mode === 'raid') {
      for (const e of Game.enemies) if (!e.dead) marker(e.x, e.y, '#e43b44');
      const core = Game.map.coreTile; if (Game.rs && Game.rs.coreHitT > 0) marker(core.tx * TILE + 16, core.ty * TILE + 16, '#feae34', 'CUPBOARD!');
      if (Game.rs && Game.rs.t < 0) for (const w of Game.rs.waves) { const S = Game.map.w * TILE; const pt = [[S / 2, 0], [S, S / 2], [S / 2, S], [0, S / 2]][w.dir]; marker(pt[0], pt[1], '#ff7a5a', 'RAID'); }
    }
    if (Game.tutTarget) marker(Game.tutTarget.x, Game.tutTarget.y, '#fee761', '');
  },
};

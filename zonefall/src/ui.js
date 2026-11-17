// ============================================================================
// ZONEFALL 3 — UI: HUD, overlay canvas (sticks, floating text, markers,
// throw arcs), hotbar, inventory, loot/storage/oven/shop/recycler/research
// windows, crafting, build bar, map, menus, death + game over screens.
// ============================================================================
import { G } from './state.js';
import { ITEMS, RECIPES, RECIPE, WEAPONS, DEPLOY, DEPLOY_ORDER, PIECES, PIECE_ORDER, DOORS, HIGHWALLS, TIER, TIERS, RECYCLE, RESEARCH_COST, SHOPS, PERKS, MONUMENTS, OVENS, TIPS, RAR_COL, VERSION, THROWN, CELL } from './data.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Save } from './save.js';
import { Build } from './build.js';
import { $, el, clamp, dist, fmtTime, pick } from './util.js';
import { useItem, refreshLook, refreshHeld, heldStack, craft, canCraft, haveCount, spend, quickHeal, startReload, countAmmo, tryPlace, canAfford, give, lookPoint } from './player.js';
import { Live } from './world/live.js';
import { WORLD } from './world/gen.js';

/* global ART */
const artLib = () => (typeof ART !== 'undefined' ? ART : window.ART) || null;
const ic = id => { const A = artLib(); return A && A.iconURL ? A.iconURL(id) : ''; };
const ui = (n, t) => { const A = artLib(); return A && A.uiIconURL ? A.uiIconURL(n, t) : ''; };
const rarCls = id => 'c-' + ((ITEMS[id] && ITEMS[id].rar) || 'common');
const nm = id => ITEMS[id] ? ITEMS[id].name : id;

export const UI = {
  floats: [], toasts: [],
  init() {
    this.ov = $('#overlay'); this.g = this.ov.getContext('2d'); this.resize(); addEventListener('resize', () => this.resize());
    this.mini = $('#minimap'); this.mg = this.mini.getContext('2d');
    // HUD buttons
    const B = (sel, name, opts) => { const e = $(sel); if (e) Input.bindButton(e, name, opts); return e; };
    B('#b-interact', 'interact'); B('#b-reload', 'reload'); B('#b-heal', 'heal');
    B('#b-fire', 'fire', { look: true }); B('#b-fire2', 'fire', { look: true }); B('#b-ads', 'ads', { toggle: true, look: true }); B('#b-jump', 'jump'); B('#b-crouch', 'crouch', { toggle: true });
    Input.blocked = () => !!G.uiBlock; Input.canLock = () => G.mode === 'play' && !G.uiBlock && !G.paused;
    $('#b-build').addEventListener('click', () => this.toggleBuild());
    $('#b-bag').addEventListener('click', () => this.openInventory());
    $('#b-craft').addEventListener('click', () => this.openCraft());
    $('#b-map').addEventListener('click', () => this.openMap());
    $('#b-pause').addEventListener('click', () => this.openPause());
    this.mini.addEventListener('click', () => this.openMap());
    // hotbar
    const hb = $('#hotbar'); this.hbSlots = [];
    for (let i = 0; i < 6; i++) {
      const s = el('div', 'hs'); s.innerHTML = '<img><b></b><i></i><u>' + (i + 1) + '</u>'; hb.appendChild(s); this.hbSlots.push(s);
      const tap = e => { e.preventDefault(); e.stopPropagation(); Sfx.unlock(); this.selectSlot(i); };
      s.addEventListener('touchstart', tap, { passive: false }); s.addEventListener('mousedown', tap);
    }
    // icons
    const setI = (sel, n) => { const e = $(sel + ' img'); if (e) e.src = ui(n); };
    setI('#b-reload', 'reload'); setI('#b-heal', 'heal'); setI('#b-build', 'hammer'); setI('#b-bag', 'bag'); setI('#b-craft', 'craft'); setI('#b-map', 'map'); setI('#b-pause', 'pause'); setI('#b-interact', 'hand'); setI('#b-fire', 'target'); setI('#b-fire2', 'target'); setI('#b-ads', 'eye');
    for (const [k, n] of [['hp', 'heart'], ['food', 'food'], ['water', 'drop']]) { const e = $('#bar-' + k + ' img'); if (e) e.src = ui(n); }
    this.sheet = $('#sheet');
    document.addEventListener('keydown', e => {
      if (G.mode !== 'play') return; const k = e.key.toLowerCase();
      if (k === 'escape') { if (this.sheetOpen) this.closeSheet(); else if (G.buildMode) this.toggleBuild(); else this.openPause(); }
      if (k === 'tab' || k === 'i') { e.preventDefault(); this.sheetOpen ? this.closeSheet() : this.openInventory(); }
      if (k === 'q' && !G.buildMode) this.sheetOpen ? this.closeSheet() : this.openCraft();
      if (k === 'm' || k === 'g') this.sheetOpen ? this.closeSheet() : this.openMap();
      if (k === 'b') this.toggleBuild();
    });
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && G.mode === 'play' && !G.uiBlock && !G.paused && !Input.touchMode && !(G.player && G.player.dead)) this.openPause(); });
    this.menu();
  },
  resize() { const d = Math.min(2, devicePixelRatio || 1); this.ov.width = innerWidth * d; this.ov.height = innerHeight * d; this.ov.style.width = innerWidth + 'px'; this.ov.style.height = innerHeight + 'px'; this.dpr = d; },
  showHud(on) { $('#hud').classList.toggle('hidden', !on); $('#overlay').classList.toggle('hidden', !on); },
  // ---------------------------------------------------------------- feedback
  toast(msg, kind = '') {
    const t = el('div', 'toast ' + kind, msg); $('#toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600); setTimeout(() => t.remove(), 3100);
    while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
  },
  banner(big, small) { const b = $('#banner'); b.innerHTML = '<b>' + big + '</b><small>' + (small || '') + '</small>'; b.classList.remove('hidden'); b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; clearTimeout(this._bt); this._bt = setTimeout(() => b.classList.add('hidden'), 3600); },
  floatText(text, x, y, z, col) { this.floats.push({ text, x, y, z, t: 0, col: col || '#fff' }); if (this.floats.length > 14) this.floats.shift(); },
  hurtFlash(d, dir) { const v = $('#hurt'); v.style.opacity = Math.min(0.85, 0.25 + d / 30); clearTimeout(this._hf); this._hf = setTimeout(() => v.style.opacity = 0, 160); if (dir !== null && G.player) this.hitDirs = (this.hitDirs || []).concat([{ a: dir + Math.PI, t: 0 }]); },
  /** floating comic damage number over an actor the player hit (pellets within 0.15 s add up) */
  dmgNum(a, d, crit, h) {
    const L = this.dmgNums || (this.dmgNums = []);
    const last = L.find(n => n.a === a && n.t < 0.15);
    if (last) { last.n += d; last.crit = last.crit || crit; last.t = 0; return; }
    if (L.length > 24) L.shift();
    L.push({ a, n: d, crit, t: 0, x: a.x, y: a.y + h, z: a.z, ox: (Math.random() < 0.5 ? -1 : 1) * (18 + Math.random() * 30), oy: 0 });
  },
  /** the living actor nearest the centre of the view (within its body width) that you can see */
  aimedActor(p, R) {
    const cam = R.camera.position, f = R.forward(this._fwd || (this._fwd = cam.clone()));
    let best = null, bd = 1e9;
    for (const a of G.actors) {
      if (a.dead || a === p || a.def.invuln || a.heli) continue;
      const vx = a.x - cam.x, vy = a.y + (a.kind === 'animal' ? 0.7 : 1.1) - cam.y, vz = a.z - cam.z;
      const along = vx * f.x + vy * f.y + vz * f.z; if (along < 0.5 || along > 70) continue;
      const px = vx - f.x * along, py = vy - f.y * along, pz = vz - f.z * along;
      const perp = Math.sqrt(px * px + py * py + pz * pz), tol = (a.r || 0.45) + 0.35 + along * 0.004;
      if (perp < tol && along < bd) { bd = along; best = a; }
    }
    if (best && G.phys && G.phys.raycast) {
      const h = G.phys.raycast(p.x, p.z, best.x, best.z, c => !c.off && c.opaque && c.ref !== best && c.kind !== 'tree');
      if (h && (h.t ?? 1) < 0.96) best = null;
    }
    return best;
  },
  hitMarker(crit) { this.hm = { t: 0, crit }; Sfx.tone && Sfx.tone(crit ? 1500 : 1100, 0.04, 0.06, 'square'); },
  /** speech bubble above an actor + a line in the chat log */
  say(actor, name, text) {
    if (!actor) return; this.bubbles = this.bubbles || [];
    this.bubbles = this.bubbles.filter(b => b.a !== actor); this.bubbles.push({ a: actor, text, t: 0 });
    const team = actor.bot && actor.bot.team; const hostile = actor.bot && G.bots && G.bots.hostileToPlayer(actor.bot);
    const line = el('div', 'chatl', '<b style="color:' + (team ? '#8fe07a' : hostile ? '#ff9080' : '#9fd0ff') + '">' + name + ':</b> ' + text);
    const log = $('#chatlog'); log.appendChild(line); while (log.children.length > 5) log.firstChild.remove(); setTimeout(() => line.classList.add('out'), 9000); setTimeout(() => line.remove(), 9600);
  },
  botDialog(b) {
    const p = G.player;
    this.openSheet(b.name, body => {
      const mood = b.team ? 'Your teammate.' : b.rel > 0.5 ? 'Friendly.' : b.rel > 0 ? 'Cautious but calm.' : 'Wary of you.';
      body.appendChild(el('p', '', `<b>${b.name}</b> — ${mood} ${b.home ? 'Has a base nearby.' : 'Still settling in.'} Kills: ${b.kills}.`));
      const acts = el('div', 'acts');
      const A = (label, fn, cls) => { const x = el('button', cls || '', label); x.onclick = () => { fn(); this.rebuild(); }; acts.appendChild(x); };
      A(b.team ? 'Leave team' : 'Invite to team', () => { const ok = G.bots.askTeam(b); if (ok) this.toast(b.name + ' joined your team', 'good'); }, b.team ? 'danger' : 'primary');
      const gifts = ['cooked_meat', 'bandage', 'arrow', 'wood', 'stone', 'cloth', 'pistol_ammo', 'water_bottle'].filter(id => p.inv.count(id));
      for (const id of gifts.slice(0, 4)) { const n = Math.min(p.inv.count(id), ['wood', 'stone', 'cloth'].includes(id) ? 100 : id === 'arrow' || id === 'pistol_ammo' ? 10 : 1); A('Give ' + n + ' ' + nm(id), () => { p.inv.take(id, n); G.bots.gift(b, id, n); }); }
      A('Wave', () => { this.say(b.actor, b.name, b.rel > 0 ? 'o/' : '...'); b.rel = Math.min(1, b.rel + 0.03); });
      body.appendChild(acts);
      body.appendChild(el('p', 'dim small', 'Survivors gather, build bases, loot and fight just like you. Gifts make them friendlier; shooting them makes enemies. Up to two can join your team — they follow you, fight with you and help defend at night.'));
    });
  },
  killFeed(name) { const k = el('div', 'kf', '✕ ' + name); $('#killfeed').appendChild(k); setTimeout(() => k.remove(), 3000); },
  // ---------------------------------------------------------------- per frame
  tick(dt) {
    if (document.body.classList.contains('touch') !== !!Input.touchMode) document.body.classList.toggle('touch', !!Input.touchMode);
    if (G.mode !== 'play' || !G.player) return;
    const p = G.player;
    this.hudT = (this.hudT || 0) - dt; if (this.hudT <= 0) { this.hudT = 0.1; this.updateHud(); }
    if (Input.pressed.heal) quickHeal(p);
    if (Input.pressed.bag) this.sheetOpen ? this.closeSheet() : this.openInventory();
    for (let i = 1; i <= 6; i++) if (Input.pressed['slot' + i]) this.selectSlot(i - 1);
    if (Input.pressed.build) this.toggleBuild();
    if (G.buildMode) this.buildTick(dt);
    if (Input.wheel && !G.buildMode && !G.uiBlock) { const p2 = G.player; for (let k = 0; k < 6; k++) { const n = (p2.sel + (Input.wheel > 0 ? 1 : 5) * (k + 1)) % 6; if (p2.inv.belt.slots[n]) { this.selectSlot(n); break; } } }
    if (this.sheetOpen && this.sheetRefresh) { this.srT = (this.srT || 0) - dt; if (this.srT <= 0) { this.srT = 0.5; this.sheetRefresh(); } }
  },
  updateHud() {
    const p = G.player; if (!p) return;
    const bar = (k, v, max) => { const e = $('#bar-' + k); e.querySelector('i').style.width = clamp(v / max * 100, 0, 100) + '%'; e.querySelector('b').textContent = Math.ceil(v); e.classList.toggle('low', v / max < 0.25); };
    bar('hp', p.hp, p.maxhp); bar('food', p.food, 100); bar('water', p.water, 100);
    // status chips
    const chips = [];
    if (p.bleed > 0) chips.push('<span class="st bad">BLEEDING</span>');
    if (p.rad > 1) chips.push('<span class="st rad">RAD ' + Math.round(p.rad) + '</span>');
    if (p.inSafe) chips.push('<span class="st good">SAFE ZONE</span>');
    if (p.hostileT > 0) chips.push('<span class="st bad">HOSTILE ' + Math.ceil(p.hostileT) + '</span>');
    if (Build.inPrivilege(p.x, p.z)) chips.push('<span class="st good">CLAIMED</span>');
    if (p.food < 15) chips.push('<span class="st bad">STARVING</span>'); if (p.water < 15) chips.push('<span class="st bad">THIRSTY</span>');
    if (G.raid) chips.push('<span class="st bad">RAID ' + Math.max(0, G.raid.actors.filter(a => !a.dead && !a.removed).length) + ' LEFT</span>');
    if (p.queue.length) chips.push('<span class="st">CRAFTING ' + nm(p.queue[0].r.out) + ' ' + Math.round(p.queue[0].t / p.queue[0].time * 100) + '%' + (p.queue.length > 1 ? ' +' + (p.queue.length - 1) : '') + '</span>');
    const ch = chips.join(''); if (ch !== this._chips) { $('#chips').innerHTML = ch; this._chips = ch; }
    // clock
    const c = G.clock; const hh = Math.floor(c * 24), mm = Math.floor((c * 24 - hh) * 60);
    const isNight = c > 0.78 || c < 0.22;
    $('#clock').innerHTML = '<img src="' + ui(isNight ? 'moon' : 'sun') + '">Day ' + G.day + ' · ' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    // hotbar
    for (let i = 0; i < 6; i++) {
      const s = p.inv.belt.slots[i]; const e = this.hbSlots[i];
      e.classList.toggle('sel', i === p.sel);
      const img = e.querySelector('img'), b = e.querySelector('b'), bar = e.querySelector('i');
      const key = s ? s.id + '|' + s.n + '|' + (s.ammo ?? '') : '';
      if (e._k === key) continue; e._k = key;
      if (!s) { img.style.visibility = 'hidden'; b.textContent = ''; bar.style.width = '0'; continue; }
      img.style.visibility = 'visible'; img.src = ic(s.id);
      const W = WEAPONS[s.id]; b.textContent = W ? (s.ammo || 0) + '/' + countAmmo(p, s.id) : s.n > 1 ? s.n : '';
      bar.style.width = W ? (s.ammo || 0) / W.mag * 100 + '%' : '0';
    }
    // interact button
    const it = G.interact; const bi = $('#b-interact');
    bi.classList.toggle('dim', !it);
    const lab = it ? it.label : ''; if (bi._l !== lab) { bi._l = lab; bi.querySelector('.lab').textContent = lab; bi.querySelector('.lab').style.display = lab ? '' : 'none'; if (it) bi.querySelector('img').src = ui(it.icon || 'hand'); }
    // centre prompt (what you are looking at)
    const pr = $('#prompt'); const ptxt = it && !G.buildMode ? (Input.touchMode ? it.label : '[E] ' + it.label) : '';
    if (pr._t !== ptxt) { pr._t = ptxt; pr.textContent = ptxt; pr.classList.toggle('hidden', !ptxt); }
    // ammo panel
    const s = heldStack(p); const W = s && WEAPONS[s.id]; const am = $('#ammo');
    const atxt = W ? '<b>' + (s.ammo || 0) + '</b><small>/ ' + countAmmo(p, s.id) + '</small><i>' + nm(s.id) + '</i>' : s ? '<i>' + nm(s.id) + (s.n > 1 ? ' ×' + s.n : '') + '</i>' : '<i>Fists</i>';
    if (am._t !== atxt) { am._t = atxt; am.innerHTML = atxt; }
    am.classList.toggle('low', !!(W && (s.ammo || 0) <= Math.ceil(W.mag * 0.25)));
    $('#b-reload').classList.toggle('hidden', !W);
    $('#b-ads').classList.toggle('hidden', !(W || (s && ITEMS[s.id].cat === 'throw')));
    const meds = p.inv.count('bandage') + p.inv.count('medkit') + p.inv.count('stim') + p.inv.count('antirad');
    $('#b-heal .cnt').textContent = meds; $('#b-heal').classList.toggle('dim', !meds);
    if (G.tut) { const t = G.tut.text(); if (t !== this._tut) { this._tut = t; $('#tut').innerHTML = t || ''; } }
  },
  selectSlot(i) {
    const p = G.player; if (!p || p.dead) return;
    const s = p.inv.belt.slots[i];
    if (s && ITEMS[s.id].use && !['gun', 'melee', 'throw'].includes(ITEMS[s.id].cat)) { useItem(p, p.inv.belt, i); this.updateHud(); return; }
    p.sel = i; refreshHeld(p); Sfx.click(); Input.setHeld('ads', false, $('#b-ads')); this.updateHud();
  },
  refreshAll() { for (const s of this.hbSlots) s._k = null; this.updateHud(); },
  // ---------------------------------------------------------------- overlay
  preRender(dt) {
    const g = this.g, d = this.dpr; g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, innerWidth, innerHeight);
    if (G.mode !== 'play' || !G.player) return;
    const p = G.player, R = G.rend;
    // speech bubbles + survivor name tags
    if (this.bubbles) for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i]; b.t += dt; if (b.t > 4 || b.a.removed) { this.bubbles.splice(i, 1); continue; }
      const s = R.project(b.a.x, b.a.y + 2.5, b.a.z); if (!s.vis) continue;
      g.font = '700 12px -apple-system,system-ui,sans-serif'; const w = g.measureText(b.text).width + 14;
      g.globalAlpha = Math.min(1, (4 - b.t) * 2); g.fillStyle = 'rgba(255,255,255,.92)'; roundRect(g, s.x - w / 2, s.y - 26, w, 20, 8); g.fill();
      g.beginPath(); g.moveTo(s.x - 5, s.y - 6); g.lineTo(s.x + 5, s.y - 6); g.lineTo(s.x, s.y); g.fill();
      g.fillStyle = '#1a1820'; g.textAlign = 'center'; g.fillText(b.text, s.x, s.y - 12); g.globalAlpha = 1;
    }
    for (const a of G.actors) {
      if (!a.bot || a.dead) continue; const dd = (a.x - p.x) ** 2 + (a.z - p.z) ** 2; if (dd > (a.bot.team ? 60 * 60 : 13 * 13)) continue;
      const s = R.project(a.x, a.y + 2.2, a.z); if (!s.vis) continue;
      const hostile = G.bots.hostileToPlayer(a.bot);
      g.font = '800 11px system-ui'; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(a.bot.name, s.x, s.y); g.fillStyle = a.bot.team ? '#8fe07a' : hostile ? '#ff9080' : '#cfe6ff'; g.fillText(a.bot.name, s.x, s.y);
    }
    // floating texts
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i]; f.t += dt; if (f.t > 1.4) { this.floats.splice(i, 1); continue; }
      const s = R.project(f.x, f.y + f.t * 0.8, f.z); if (!s.vis) continue;
      g.globalAlpha = 1 - Math.max(0, f.t - 0.9) / 0.5; g.font = '800 13px -apple-system,system-ui,sans-serif'; g.textAlign = 'center';
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(f.text, s.x, s.y); g.fillStyle = f.col; g.fillText(f.text, s.x, s.y);
    }
    g.globalAlpha = 1;
    // health bars on damaged structures under the cursor / enemies near
    // whoever is under the crosshair gets a comic name tag + health bar (line of sight only)
    const aimed = this.aimedActor(p, R);
    for (const a of G.actors) {
      if (a.dead || a === p || a.def.invuln || a.heli) continue;
      const isAim = a === aimed; if (!isAim && (a.hp >= a.maxhp || (a.x - p.x) ** 2 + (a.z - p.z) ** 2 > 900)) continue;
      const s = R.project(a.x, a.y + (a.kind === 'animal' ? 1.45 : 2.2), a.z); if (!s.vis) continue;
      const w = isAim ? 64 : 40, k = Math.max(0, a.hp / a.maxhp);
      const col = a.team === 'hostile' || (a.bot && G.bots.hostileToPlayer(a.bot)) ? '#ff4a3a' : a.kind === 'animal' ? '#ffc928' : '#86e64a';
      g.fillStyle = '#120c10'; g.fillRect(s.x - w / 2 - 2, s.y - 2, w + 4, 9);
      g.fillStyle = '#3a3046'; g.fillRect(s.x - w / 2, s.y, w, 5); g.fillStyle = a.boss ? '#ffa21e' : col; g.fillRect(s.x - w / 2, s.y, w * k, 5);
      g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(s.x - w / 2, s.y, w * k, 2);
      if (isAim || a.boss) {
        const nm = a.bot ? a.bot.name : a.name || a.def.name; g.textAlign = 'center'; g.lineJoin = 'round';
        g.font = 'italic 900 13px "Avenir Next Condensed","Arial Black",system-ui'; g.lineWidth = 4; g.strokeStyle = '#120c10'; g.strokeText(nm, s.x, s.y - 6); g.fillStyle = a.boss ? '#ffc928' : '#fff6e2'; g.fillText(nm, s.x, s.y - 6);
      }
    }
    for (const o of [...Build.edges.values(), ...G.doors, ...Build.deploys]) {
      if (!o.hitT || o.dead) continue; o.hitT -= dt * 0.25; if (o.hitT <= 0) { o.hitT = 0; continue; }
      const x = o.x ?? (o.mesh ? o.mesh.position.x : 0), z = o.z ?? (o.mesh ? o.mesh.position.z : 0);
      const s = R.project(x, (o.base ?? o.y ?? 0) + 2.8, z); if (!s.vis) continue;
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(s.x - 22, s.y, 44, 6); g.fillStyle = '#e0c040'; g.fillRect(s.x - 21, s.y + 1, 42 * Math.max(0, o.hp / o.maxhp), 4);
    }
    // floating damage numbers (comic pop-ups)
    if (this.dmgNums && this.dmgNums.length) {
      g.textAlign = 'center'; g.lineJoin = 'round';
      for (let i = this.dmgNums.length - 1; i >= 0; i--) {
        const n = this.dmgNums[i]; n.t += dt; if (n.t > 1.05) { this.dmgNums.splice(i, 1); continue; }
        const s = R.project(n.x, n.y + n.t * 0.9, n.z); if (!s.vis) continue;
        const pop = n.t < 0.09 ? 1 + (0.09 - n.t) * 7 : 1, size = (n.crit ? 25 : 19) * pop;
        g.globalAlpha = n.t > 0.7 ? Math.max(0, (1.05 - n.t) / 0.35) : 1;
        const x = s.x + n.ox * Math.min(1, n.t * 4), y = s.y;
        g.font = `italic 900 ${size | 0}px "Avenir Next Condensed","Arial Black",system-ui`;
        const txt = String(Math.max(1, Math.round(n.n)));
        g.lineWidth = 5; g.strokeStyle = '#120c10'; g.strokeText(txt, x, y);
        g.fillStyle = n.crit ? '#ff5a2a' : '#fff1a0'; g.fillText(txt, x, y);
        if (n.crit) { g.font = 'italic 900 12px "Avenir Next Condensed","Arial Black",system-ui'; g.lineWidth = 4; g.strokeText('CRITICAL!', x, y - size * 0.9); g.fillStyle = '#ffc928'; g.fillText('CRITICAL!', x, y - size * 0.9); }
      }
      g.globalAlpha = 1;
    }
    // crosshair state (DOM) + hit marker at the centre
    this.crosshair(dt);
    // damage direction arcs around the screen centre (relative to where you look)
    if (this.hitDirs) for (let i = this.hitDirs.length - 1; i >= 0; i--) {
      const h = this.hitDirs[i]; h.t += dt; if (h.t > 0.9) { this.hitDirs.splice(i, 1); continue; }
      const rel = h.a - p.yaw - Math.PI / 2; // 0 = straight ahead (up on screen)
      g.strokeStyle = 'rgba(230,40,40,' + (1 - h.t / 0.9) * 0.85 + ')'; g.lineWidth = 7; g.beginPath(); g.arc(innerWidth / 2, innerHeight / 2, 90, rel - 0.35, rel + 0.35); g.stroke();
    }
    this.drawCompass(g, p);
    // off-screen markers: base, airdrop, death bag
    const mk = [];
    if (Build.tc) mk.push({ x: Build.tc.x, z: Build.tc.z, icon: 'tc', col: '#7ad070', label: 'Base' });
    if (G.airdrop && G.airdrop.phase !== 'fly') mk.push({ x: G.airdrop.x, z: G.airdrop.z, icon: 'airdrop', col: '#ff8060', label: 'Drop' });
    if (G.deathBag && G.drops.includes(G.deathBag)) mk.push({ x: G.deathBag.x, z: G.deathBag.z, icon: 'skull', col: '#e0e0e0', label: 'Bag' });
    for (const m of mk) {
      const dd = dist(p.x, p.z, m.x, m.z); if (dd < 14) continue;
      const s = R.project(m.x, G.W.height(m.x, m.z) + 2, m.z); let x = s.x, y = s.y; const pad = 46;
      const on = s.vis && x > pad && x < innerWidth - pad && y > pad + 30 && y < innerHeight - pad;
      if (!on) { const cx = innerWidth / 2, cy = innerHeight / 2; let dx = x - cx, dy = y - cy; if (!s.vis) { dx = -dx; dy = -dy; } const k = Math.min((innerWidth / 2 - pad) / Math.abs(dx || 1), (innerHeight / 2 - pad) / Math.abs(dy || 1)); x = cx + dx * k; y = cy + dy * k; }
      g.fillStyle = 'rgba(15,14,20,.75)'; g.beginPath(); g.arc(x, y, 15, 0, 7); g.fill(); g.strokeStyle = m.col; g.lineWidth = 2; g.stroke();
      const im = this.imgCache(ui(m.icon)); if (im.complete) { g.imageSmoothingEnabled = false; g.drawImage(im, x - 10, y - 10, 20, 20); }
      g.font = '700 10px system-ui'; g.textAlign = 'center'; g.fillStyle = '#fff'; g.fillText(Math.round(dd) + 'm', x, y + 27);
    }
    // sticks (touch)
    if (Input.touchMode) this.drawSticks(g);
    this.drawMinimap();
  },
  crosshair(dt) {
    const p = G.player, x = $('#xhair'); if (!x) return;
    const s = heldStack(p); const W = s && WEAPONS[s.id];
    const gap = W ? 7 + (p.bloom || 0) * 22 + Math.min(1, p.speedNow / 4.5) * 9 * (p.ads > 0.5 ? 0.2 : 1) + (p.airY > 0 ? 10 : 0) - (p.crouch ? 2 : 0) : 4;
    x.style.setProperty('--gap', (p.ads > 0.6 && W ? Math.max(2, gap * 0.3) : gap).toFixed(1) + 'px');
    x.classList.toggle('melee', !W); x.classList.toggle('ads', p.ads > 0.6 && !!W); x.classList.toggle('scope', p.ads > 0.8 && s && s.id === 'hunting');
    x.classList.toggle('hidden', p.dead || !!G.buildMode && false);
    if (this.hm) { this.hm.t += dt; x.classList.toggle('hit', this.hm.t < 0.18); x.classList.toggle('crit', this.hm.t < 0.18 && this.hm.crit); }
    $('#scope').classList.toggle('hidden', !(p.ads > 0.85 && s && s.id === 'hunting'));
  },
  drawCompass(g, p) {
    const w = Math.min(320, innerWidth * 0.36), cx = innerWidth / 2, y = 30 + (this.safeTop || 0); const fov = Math.PI * 0.9;
    g.save(); g.fillStyle = 'rgba(28,22,34,.72)'; g.strokeStyle = '#120c10'; g.lineWidth = 3; roundRect(g, cx - w / 2, y - 12, w, 22, 5); g.fill(); g.stroke(); g.beginPath(); g.rect(cx - w / 2, y - 14, w, 30); g.clip();
    const yaw = p.yaw; // 0 = east (+X); north = -Z = yaw -PI/2
    const mark = (ang, label, col, big) => { const d = Math.atan2(Math.sin(ang - yaw), Math.cos(ang - yaw)); if (Math.abs(d) > fov / 2) return; const x = cx + d / (fov / 2) * (w / 2); g.font = (big ? '900 13px' : '800 10px') + ' "Avenir Next Condensed", system-ui'; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = '#120c10'; g.strokeText(label, x, y + 4); g.fillStyle = col; g.fillText(label, x, y + 4); };
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; const d = Math.atan2(Math.sin(a - yaw), Math.cos(a - yaw)); if (Math.abs(d) > fov / 2) continue; const x = cx + d / (fov / 2) * (w / 2); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x - 0.5, y + 6, 1, i % 3 === 0 ? 5 : 3); }
    mark(-Math.PI / 2, 'N', '#ff5a3a', true); mark(0, 'E', '#fff', true); mark(Math.PI / 2, 'S', '#fff', true); mark(Math.PI, 'W', '#fff', true);
    mark(-Math.PI / 4, 'NE', '#ccc'); mark(Math.PI / 4, 'SE', '#ccc'); mark(3 * Math.PI / 4, 'SW', '#ccc'); mark(-3 * Math.PI / 4, 'NW', '#ccc');
    if (Build.tc) mark(Math.atan2(Build.tc.z - p.z, Build.tc.x - p.x), '⌂', '#7ad070', true);
    if (G.airdrop && G.airdrop.phase !== 'fly') mark(Math.atan2(G.airdrop.z - p.z, G.airdrop.x - p.x), '▼', '#ff8060', true);
    if (G.deathBag && G.drops.includes(G.deathBag)) mark(Math.atan2(G.deathBag.z - p.z, G.deathBag.x - p.x), '✝', '#fff', true);
    g.restore();
    g.fillStyle = '#ffc928'; g.strokeStyle = '#120c10'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 6, y - 15); g.lineTo(cx + 6, y - 15); g.lineTo(cx, y - 7); g.closePath(); g.stroke(); g.fill();
  },
  imgCache(src) { this._ic = this._ic || {}; if (!this._ic[src]) { const i = new Image(); i.src = src; this._ic[src] = i; } return this._ic[src]; },
  drawSticks(g) {
    const H = Input.homes(), R0 = Input.STICK_R;
    const stick = (s, hx, hy, col) => {
      const on = s.id !== null; const ox = on ? s.ox : hx, oy = on ? s.oy : hy;
      g.globalAlpha = on ? 0.6 : 0.22; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(ox, oy, R0, 0, 7); g.stroke();
      g.fillStyle = col; g.beginPath(); g.arc(on ? s.cx : ox, on ? s.cy : oy, R0 * 0.42, 0, 7); g.fill(); g.globalAlpha = 1;
    };
    stick(Input.move, H.mx, H.my, 'rgba(255,255,255,.6)');
  },
  drawMinimap() {
    const g = this.mg, c = this.mini, p = G.player; if (!G.mapCanvas || !p) return;
    const S = c.width, R = 70; const sc = G.mapCanvas.width / WORLD;
    g.save(); g.clearRect(0, 0, S, S); g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, 7); g.clip();
    g.imageSmoothingEnabled = true; g.drawImage(G.mapCanvas, (p.x - R) * sc, (p.z - R) * sc, R * 2 * sc, R * 2 * sc, 0, 0, S, S);
    const toM = (x, z) => [(x - p.x) / R * S / 2 + S / 2, (z - p.z) / R * S / 2 + S / 2];
    for (const m of G.monuments) { const [x, y] = toM(m.x, m.z); g.fillStyle = 'rgba(255,230,160,.85)'; g.fillRect(x - 2, y - 2, 4, 4); }
    if (Build.tc) { const [x, y] = toM(Build.tc.x, Build.tc.z); g.fillStyle = '#7ad070'; g.fillRect(x - 3, y - 3, 6, 6); }
    if (G.airdrop && G.airdrop.phase !== 'fly') { const [x, y] = toM(G.airdrop.x, G.airdrop.z); g.fillStyle = '#ff6040'; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); }
    for (const a of G.actors) if (a.team === 'raider' && !a.dead) { const [x, y] = toM(a.x, a.z); g.fillStyle = '#ff3030'; g.fillRect(x - 1.5, y - 1.5, 3, 3); }
    for (const a of G.actors) if (a.heli && !a.dead) { const [x, y] = toM(a.x, a.z); g.strokeStyle = '#ff4040'; g.lineWidth = 2; g.beginPath(); g.moveTo(x - 4, y - 4); g.lineTo(x + 4, y + 4); g.moveTo(x + 4, y - 4); g.lineTo(x - 4, y + 4); g.stroke(); }
    for (const a of G.actors) if (a.bot && a.bot.team && !a.dead) { const [x, y] = toM(a.x, a.z); g.fillStyle = '#8fe07a'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
    g.restore();
    // player arrow
    g.save(); g.translate(S / 2, S / 2); g.rotate(p.ang); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(7, 0); g.lineTo(-5, 4.5); g.lineTo(-2.5, 0); g.lineTo(-5, -4.5); g.closePath(); g.fill(); g.stroke(); g.restore();
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, 7); g.stroke();
    g.font = '800 10px system-ui'; g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText('N', S / 2, 11);
  },
  // ---------------------------------------------------------------- sheets (modal windows)
  openSheet(title, build, opts = {}) {
    Sfx.ui(); this.sheetOpen = true; G.uiBlock = true; this.sheetRefresh = null;
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { }
    Input.held.fire = false; Input.held.ads = false; $('#b-ads') && $('#b-ads').classList.remove('on');
    const sh = this.sheet; sh.innerHTML = ''; sh.className = 'sheet ' + (opts.cls || '');
    const head = el('div', 'sh-head'); head.innerHTML = '<b>' + title + '</b>';
    const x = el('button', 'sh-x', '✕'); x.onclick = () => this.closeSheet(); head.appendChild(x);
    if (opts.tabs) { const tb = el('div', 'tabs'); for (const t of opts.tabs) { const b = el('button', t.on ? 'on' : '', t.label); b.onclick = t.fn; tb.appendChild(b); } head.insertBefore(tb, x); }
    const body = el('div', 'sh-body'); sh.appendChild(head); sh.appendChild(body);
    $('#shade').classList.remove('hidden'); sh.classList.remove('hidden');
    build(body); this.curBuild = () => { body.innerHTML = ''; build(body); };
    return body;
  },
  closeSheet() { if (!this.sheetOpen) return; this.sheetOpen = false; G.uiBlock = false; this.sheet.classList.add('hidden'); $('#shade').classList.add('hidden'); if (this.onClose) { const f = this.onClose; this.onClose = null; f(); } this.sel = null; refreshHeld(G.player); this.refreshAll(); },
  rebuild() { if (this.curBuild) this.curBuild(); },
  slotEl(s, extra) {
    const d = el('div', 'slot' + (s ? ' ' + rarCls(s.id) : ' empty') + (extra || ''));
    if (s) { d.innerHTML = '<img src="' + ic(s.id) + '">' + (s.n > 1 ? '<b>' + s.n + '</b>' : '') + (WEAPONS[s.id] ? '<i style="width:' + (s.ammo || 0) / WEAPONS[s.id].mag * 100 + '%"></i>' : ''); d.title = nm(s.id); }
    return d;
  },
  /** grid of an Inv. onTap(i, stack) */
  grid(inv, onTap, cls = '', sel) {
    const g = el('div', 'grid ' + cls);
    inv.slots.forEach((s, i) => { const d = this.slotEl(s, sel && sel.inv === inv && sel.i === i ? ' picked' : ''); d.onclick = () => onTap(i, s); g.appendChild(d); });
    return g;
  },
  // ---------------------------------------------------------------- inventory
  openInventory(side) {
    const p = G.player; if (!p || p.dead) return;
    this.sel = null;
    this.openSheet('Inventory', body => this.invBody(body, side), { cls: 'wide', tabs: [{ label: 'Inventory', on: true, fn: () => this.openInventory(side) }, { label: 'Craft', fn: () => this.openCraft() }] });
  },
  invBody(body, side) {
    const p = G.player; const inv = p.inv;
    const wrap = el('div', 'inv-wrap');
    const left = el('div', 'inv-left');
    // equipment
    const eq = el('div', 'equip');
    for (const [k, label] of [['helmet', 'Head'], ['armor', 'Body'], ['bag', 'Bag']]) {
      const s = inv.equip[k]; const d = this.slotEl(s, ' eqs'); if (!s) d.innerHTML = '<small>' + label + '</small>';
      d.onclick = () => { if (s) { const left = inv.main.addStack(s) || inv.belt.addStack(s); if (left) { Live.dropItem(p.x, p.z, s.id, s.n); } inv.equip[k] = null; refreshLook(p); this.rebuild(); } };
      eq.appendChild(d);
    }
    for (let i = 0; i < 2; i++) { const s = inv.arts[i]; const d = this.slotEl(s, ' eqs art'); if (!s) d.innerHTML = '<small>Artifact</small>'; d.onclick = () => { if (s) { inv.main.addStack(s); inv.arts[i] = null; refreshLook(p); this.rebuild(); } }; eq.appendChild(d); }
    left.appendChild(eq);
    const stats = el('div', 'stats'); stats.innerHTML = `Armor <b>${Math.round(inv.armorVal() * 100)}%</b> · Rad resist <b>${Math.round(inv.radRes() * 100)}%</b> · HP <b>${Math.ceil(p.hp)}/${p.maxhp}</b>`;
    left.appendChild(stats);
    left.appendChild(el('div', 'lbl', 'Belt'));
    left.appendChild(this.grid(inv.belt, (i, s) => this.tapSlot(inv.belt, i, side), 'belt', this.sel));
    left.appendChild(el('div', 'lbl', 'Backpack (' + inv.main.size + ')'));
    left.appendChild(this.grid(inv.main, (i, s) => this.tapSlot(inv.main, i, side), 'main', this.sel));
    wrap.appendChild(left);
    // detail / side panel
    const right = el('div', 'inv-right');
    if (side) { right.appendChild(el('div', 'lbl', side.title)); right.appendChild(this.grid(side.inv, (i, s) => this.tapSide(side, i), 'side', this.sel)); const ta = el('button', 'primary', 'Take all'); ta.onclick = () => { this.takeAll(side.inv); side.onChange && side.onChange(); }; right.appendChild(ta); if (side.extra) side.extra(right); }
    right.appendChild(this.detail(side));
    wrap.appendChild(right);
    body.appendChild(wrap);
  },
  detail(side) {
    const d = el('div', 'detail'); const s = this.sel && this.sel.inv.slots[this.sel.i];
    if (!s) { d.innerHTML = '<p class="dim">Tap an item to select it. Tap another slot to move it there.' + (side ? ' Tap items in the other box to take them.' : '') + '</p>'; return d; }
    const def = ITEMS[s.id]; const p = G.player;
    let info = '<div class="dt-h"><img src="' + ic(s.id) + '"><div><b class="' + rarCls(s.id) + '">' + def.name + '</b><small>' + (def.desc || catName(def.cat)) + '</small></div></div>';
    const W = WEAPONS[s.id]; if (W) info += `<small class="dim">Damage ${W.dmg}${W.pellets ? '×' + W.pellets : ''} · Mag ${W.mag} · ${nm(W.ammo)}</small>`;
    if (def.armor) info += `<small class="dim">Armor ${Math.round(def.armor * 100)}%${def.rad ? ' · Rad ' + Math.round(def.rad * 100) + '%' : ''}</small>`;
    d.innerHTML = info;
    const acts = el('div', 'acts'); const A = (label, fn, cls) => { const b = el('button', cls || '', label); b.onclick = () => { fn(); this.rebuild(); }; acts.appendChild(b); };
    const inv = this.sel.inv, i = this.sel.i;
    if (def.use) A('Use', () => { useItem(p, inv, i); this.sel = null; }, 'primary');
    if (['armor', 'helmet', 'bag'].includes(def.cat)) A('Equip', () => { const k = def.cat; const old = p.inv.equip[k]; p.inv.equip[k] = s; inv.slots[i] = old || null; refreshLook(p); this.sel = null; Sfx.pickup(); }, 'primary');
    if (def.cat === 'art') A('Equip', () => { const k = p.inv.arts[0] ? (p.inv.arts[1] ? 0 : 1) : 0; const old = p.inv.arts[k]; p.inv.arts[k] = s; inv.slots[i] = old || null; refreshLook(p); this.sel = null; }, 'primary');
    if (def.cat === 'bp') A('Learn', () => { if (!G.run.bps.includes(def.teach)) { G.run.bps.push(def.teach); this.toast('Learned ' + nm(RECIPE[def.teach].out), 'good'); Sfx.win(); } inv.slots[i] = null; this.sel = null; }, 'primary');
    if (W && (s.ammo || 0) > 0) A('Unload', () => { p.inv.add(s.ammoId || W.ammo, s.ammo); s.ammo = 0; });
    if (s.n > 1) A('Split', () => { const h = Math.floor(s.n / 2); const k = inv.slots.indexOf(null); if (k < 0) return; s.n -= h; inv.slots[k] = { id: s.id, n: h }; });
    if (side) A('Move →', () => { const left = side.inv.addStack(s); inv.slots[i] = left; this.sel = null; side.onChange && side.onChange(); });
    A('Drop', () => { Live.dropItem(p.x + Math.cos(p.ang), p.z + Math.sin(p.ang), s.id, s.n, s.ammo !== undefined ? { ammo: s.ammo } : null); inv.slots[i] = null; this.sel = null; refreshHeld(p); }, 'danger');
    d.appendChild(acts); return d;
  },
  tapSlot(inv, i, side) {
    const s = inv.slots[i];
    if (this.sel && (this.sel.inv !== inv || this.sel.i !== i)) { // move / swap / merge
      const a = this.sel.inv, ai = this.sel.i; const A = a.slots[ai], Bs = inv.slots[i];
      if (A && Bs && A.id === Bs.id && (ITEMS[A.id].stack || 1) > 1) { const st = ITEMS[A.id].stack; const k = Math.min(A.n, st - Bs.n); Bs.n += k; A.n -= k; if (A.n <= 0) a.slots[ai] = null; }
      else { a.slots[ai] = Bs || null; inv.slots[i] = A; }
      this.sel = null; Sfx.click(); refreshHeld(G.player); this.rebuild(); if (side && side.onChange) side.onChange(); return;
    }
    if (this.sel && this.sel.inv === inv && this.sel.i === i) { this.sel = null; this.rebuild(); return; }
    if (s) { this.sel = { inv, i }; Sfx.click(); this.rebuild(); }
  },
  tapSide(side, i) {
    const s = side.inv.slots[i];
    if (this.sel && this.sel.inv !== side.inv) { this.tapSlot(side.inv, i, side); return; }
    if (!s) return;
    const left = G.player.inv.addStack(s); side.inv.slots[i] = left; Sfx.pickup(); this.sel = null;
    if (left) this.toast('Inventory full');
    side.onChange && side.onChange(); this.rebuild();
  },
  takeAll(inv) { let full = false; for (let i = 0; i < inv.slots.length; i++) { const s = inv.slots[i]; if (!s) continue; const left = G.player.inv.addStack(s); inv.slots[i] = left; if (left) full = true; } Sfx.pickup(); if (full) this.toast('Inventory full'); this.rebuild(); this.refreshAll(); },
  // ---------------------------------------------------------------- loot / storage / ovens
  openLoot(inv, title, onChange, search = 0) {
    const go = () => { this.openInventory({ inv, title, onChange: () => { onChange && onChange(); } }); this.onClose = onChange; };
    if (search > 0.05) { this.searchBar(search, go); } else go();
  },
  searchBar(t, done) { const p = $('#prog'); p.classList.remove('hidden'); p.querySelector('i').style.width = '0'; const t0 = performance.now(); const tick = () => { const k = (performance.now() - t0) / 1000 / t; p.querySelector('i').style.width = Math.min(100, k * 100) + '%'; if (k >= 1) { p.classList.add('hidden'); done(); } else requestAnimationFrame(tick); }; tick(); },
  openStorage(d, title) {
    const extra = d.type === 'tc' ? (right) => { const n = el('p', 'dim small', 'Your claim: ' + 'resources stored here feed turrets and building. Raiders come for this cupboard every night — if it is destroyed the run ends.'); right.appendChild(n); } : null;
    this.openInventory({ inv: d.inv, title, extra });
  },
  openOven(d) {
    const O = OVENS[DEPLOY[d.type].oven];
    this.openInventory({
      inv: d.inv, title: DEPLOY[d.type].name + (d.state.lit ? ' (burning)' : ''), extra: right => {
        const b = el('button', d.state.lit ? 'danger' : 'primary', d.state.lit ? 'Extinguish' : 'Light it'); b.onclick = () => { if (!d.state.lit && d.inv.count(O.fuel) <= 0) { this.toast('Add ' + nm(O.fuel) + ' as fuel'); return; } d.state.lit = !d.state.lit; Sfx.click(); this.rebuild(); }; right.appendChild(b);
        const q = el('div', 'quick'); q.appendChild(el('span', 'dim small', 'Quick add: '));
        const add = id => { const b2 = el('button', 'mini', '+' + nm(id)); b2.onclick = () => { const n = G.player.inv.count(id); if (!n) return; const k = Math.min(n, d.inv.room(id)); G.player.inv.take(id, k); d.inv.add(id, k); this.rebuild(); }; q.appendChild(b2); };
        for (const k of [O.fuel, ...Object.keys(O.cooks).filter(k => k !== O.fuel)]) if (G.player.inv.count(k)) add(k);
        right.appendChild(q);
        right.appendChild(el('p', 'dim small', d.type === 'furnace' ? 'Burns wood. Smelts metal ore → metal fragments, sulfur ore → sulfur, HQ ore → HQ metal, wood → charcoal.' : 'Burns wood. Cooks raw meat; makes charcoal.'));
      },
    });
    this.sheetRefresh = () => this.rebuild();
  },
  // ---------------------------------------------------------------- crafting
  openCraft(cat) {
    const p = G.player; if (!p || p.dead) return; this.craftCat = cat || this.craftCat || 'all';
    this.openSheet('Craft', body => {
      const wb = Build.wbTier(p.x, p.z);
      const cats = [['all', 'All'], ['tools', 'Tools'], ['weapons', 'Weapons'], ['ammo', 'Ammo & Explosives'], ['gear', 'Clothing'], ['med', 'Medical & Food'], ['res', 'Resources']];
      const tabs = el('div', 'cats'); for (const [k, l] of cats) { const b = el('button', this.craftCat === k ? 'on' : '', l); b.onclick = () => { this.craftCat = k; this.rebuild(); }; tabs.appendChild(b); }
      body.appendChild(tabs);
      body.appendChild(el('p', 'dim small', 'Workbench nearby: ' + (wb ? 'T' + wb : 'none') + (Build.inPrivilege(p.x, p.z) ? ' · using resources from your Tool Cupboard & boxes too' : '')));
      const list = el('div', 'recipes');
      for (const r of RECIPES) {
        const def = ITEMS[r.out]; const c = recipeCat(def);
        if (this.craftCat !== 'all' && c !== this.craftCat) continue;
        const locked = r.bp && !G.run.bps.includes(r.id); const why = canCraft(p, r);
        const row = el('div', 'rec' + (why ? ' no' : '') + (locked ? ' locked' : ''));
        row.innerHTML = `<img src="${ic(r.out)}"><div class="rt"><b class="${rarCls(r.out)}">${def.name}${r.n > 1 ? ' ×' + r.n : ''}</b><small>${Object.entries(r.cost).map(([k, v]) => `<span class="${haveCount(p, k) >= v ? '' : 'bad'}">${v} ${nm(k)}</span>`).join(' · ')}</small>${locked ? '<small class="lockt">Blueprint needed (research or find one)</small>' : r.wb ? '<small class="dim">Workbench T' + r.wb + '</small>' : ''}</div>`;
        const b = el('button', why ? '' : 'primary', 'Craft'); b.disabled = !!why; b.onclick = e => { e.stopPropagation(); craft(p, r, 1); this.rebuild(); };
        row.appendChild(b);
        if (!why && !r.bp && ITEMS[r.out].stack > 1) { const b5 = el('button', '', '×5'); b5.disabled = !!canCraft(p, r, 5); b5.onclick = e => { e.stopPropagation(); craft(p, r, 5); this.rebuild(); }; row.appendChild(b5); }
        list.appendChild(row);
      }
      body.appendChild(list);
      if (p.queue.length) { const q = el('div', 'queue'); q.innerHTML = 'Queue: ' + p.queue.map(x => nm(x.r.out) + (x.n > 1 ? ' ×' + x.n : '')).join(', '); body.appendChild(q); }
    }, { cls: 'wide', tabs: [{ label: 'Inventory', fn: () => this.openInventory() }, { label: 'Craft', on: true, fn: () => this.openCraft() }] });
    this.sheetRefresh = () => { if (G.player.queue.length) this.rebuild(); };
  },
  openResearch() {
    this.openSheet('Research Table', body => {
      body.appendChild(el('p', 'dim', 'Spend scrap to permanently learn how to craft an item you own.'));
      const list = el('div', 'recipes'); const p = G.player; let any = false;
      for (const s of p.inv.all()) {
        const r = RECIPES.find(q => q.out === s.id && q.bp); if (!r || G.run.bps.includes(r.id) || list.querySelector('[data-id="' + r.id + '"]')) continue; any = true;
        const cost = RESEARCH_COST[r.wb] || 75; const row = el('div', 'rec'); row.dataset.id = r.id;
        row.innerHTML = `<img src="${ic(r.out)}"><div class="rt"><b>${nm(r.out)}</b><small>${cost} Scrap (item is consumed)</small></div>`;
        const b = el('button', 'primary', 'Research'); b.disabled = haveCount(p, 'scrap') < cost;
        b.onclick = () => { spend(p, { scrap: cost }); p.inv.take(r.out, 1); G.run.bps.push(r.id); Sfx.win(); this.toast('Learned ' + nm(r.out), 'good'); this.rebuild(); };
        row.appendChild(b); list.appendChild(row);
      }
      if (!any) list.appendChild(el('p', 'dim', 'Nothing to research. Bring weapons, armour or tools that need blueprints.'));
      body.appendChild(list);
    });
  },
  openRecycler() {
    this.openSheet('Recycler', body => {
      body.appendChild(el('p', 'dim', 'Break components, weapons, armour and valuables down into scrap and resources.'));
      const list = el('div', 'recipes'); const p = G.player; let any = false; const seen = new Set();
      for (const s of p.inv.all()) {
        const R = RECYCLE[s.id]; if (!R || seen.has(s.id)) continue; seen.add(s.id); any = true; const n = p.inv.count(s.id);
        const row = el('div', 'rec'); row.innerHTML = `<img src="${ic(s.id)}"><div class="rt"><b>${nm(s.id)} ×${n}</b><small>→ ${Object.entries(R).map(([k, v]) => v + ' ' + nm(k)).join(', ')} each</small></div>`;
        const b = el('button', 'primary', 'Recycle all'); b.onclick = () => { const k = p.inv.take(s.id, n); for (const [id, v] of Object.entries(R)) give(p, id, v * k); Sfx.craft(); this.rebuild(); };
        row.appendChild(b); list.appendChild(row);
      }
      if (!any) list.appendChild(el('p', 'dim', 'Nothing to recycle. Loot barrels and crates for components.'));
      body.appendChild(list);
    });
  },
  openShop(shopId) {
    const S = SHOPS[shopId] || SHOPS.general;
    this.openSheet(S.name, body => {
      const p = G.player; body.appendChild(el('p', 'dim', 'You have <b>' + p.inv.count('scrap') + '</b> scrap.'));
      const list = el('div', 'recipes');
      for (const [id, n, price] of S.stock) {
        const row = el('div', 'rec'); row.innerHTML = `<img src="${ic(id)}"><div class="rt"><b class="${rarCls(id)}">${nm(id)}${n > 1 ? ' ×' + n : ''}</b><small>${price} scrap</small></div>`;
        const b = el('button', 'primary', 'Buy'); b.disabled = p.inv.count('scrap') < price; b.onclick = () => { p.inv.take('scrap', price); give(p, id, n); Sfx.pickup(); this.rebuild(); };
        row.appendChild(b); list.appendChild(row);
      }
      body.appendChild(list);
      // sell valuables
      const sell = p.inv.all().filter(s => ITEMS[s.id].cat === 'val');
      if (sell.length) {
        body.appendChild(el('div', 'lbl', 'Sell valuables'));
        const l2 = el('div', 'recipes'); const seen = new Set();
        for (const s of sell) { if (seen.has(s.id)) continue; seen.add(s.id); const n = p.inv.count(s.id), v = Math.round(ITEMS[s.id].val * 0.5); const row = el('div', 'rec'); row.innerHTML = `<img src="${ic(s.id)}"><div class="rt"><b>${nm(s.id)} ×${n}</b><small>${v} scrap each</small></div>`; const b = el('button', 'primary', 'Sell all'); b.onclick = () => { const k = p.inv.take(s.id, n); give(p, 'scrap', k * v); Sfx.pickup(); this.rebuild(); }; row.appendChild(b); l2.appendChild(row); }
        body.appendChild(l2);
      }
    });
  },
  // ---------------------------------------------------------------- map
  openMap() {
    this.openSheet('Map', body => {
      const c = el('canvas', 'bigmap'); const S = Math.min(innerHeight - 90, innerWidth - 40, 900); c.width = S * 2; c.height = S * 2; c.style.width = S + 'px'; c.style.height = S + 'px';
      body.appendChild(c); const g = c.getContext('2d'); g.scale(2, 2);
      g.drawImage(G.mapCanvas, 0, 0, S, S); const k = S / WORLD;
      g.textAlign = 'center';
      for (const m of G.monuments) {
        const x = m.x * k, y = m.z * k; const t = MONUMENTS[m.type].tier; g.fillStyle = ['#7ad070', '#e0d8b0', '#e0b050', '#e07040', '#e04040'][t] || '#fff';
        g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1; g.stroke();
        g.font = '700 10px system-ui'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(m.name, x, y - 7); g.fillStyle = '#fff'; g.fillText(m.name, x, y - 7);
      }
      if (Build.tc) { g.fillStyle = '#7ad070'; g.fillRect(Build.tc.x * k - 5, Build.tc.z * k - 5, 10, 10); g.font = '800 10px system-ui'; g.fillText('BASE', Build.tc.x * k, Build.tc.z * k + 16); }
      for (const d of Build.deploys) if (d.owner === 'player' && (d.type === 'sleeping_bag' || d.type === 'bed')) { g.fillStyle = '#80c0ff'; g.fillRect(d.x * k - 3, d.z * k - 3, 6, 6); }
      if (G.airdrop && G.airdrop.phase !== 'fly') { g.fillStyle = '#ff6040'; g.beginPath(); g.arc(G.airdrop.x * k, G.airdrop.z * k, 6, 0, 7); g.fill(); }
      if (G.deathBag && G.drops.includes(G.deathBag)) { g.fillStyle = '#fff'; g.font = '800 12px system-ui'; g.fillText('✝', G.deathBag.x * k, G.deathBag.z * k + 4); }
      const p = G.player; g.save(); g.translate(p.x * k, p.z * k); g.rotate(p.ang); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.beginPath(); g.moveTo(9, 0); g.lineTo(-6, 6); g.lineTo(-3, 0); g.lineTo(-6, -6); g.closePath(); g.fill(); g.stroke(); g.restore();
      const leg = el('div', 'legend', '<span style="color:#7ad070">■</span> Safe zone / base · <span style="color:#e0d8b0">●</span> Tier 1 · <span style="color:#e0b050">●</span> Tier 2 (keycards) · <span style="color:#e07040">●</span> Tier 3 · <span style="color:#e04040">●</span> Reactor');
      body.appendChild(leg);
    }, { cls: 'mapsheet' });
  },
  // ---------------------------------------------------------------- build mode
  toggleBuild() {
    const p = G.player; if (!p || p.dead) return;
    if (G.buildMode) { G.buildMode = null; document.body.classList.remove('building'); this.clearGhost(); this.highlight(null); refreshHeld(p); $('#buildbar').classList.add('hidden'); return; }
    if (this.sheetOpen) this.closeSheet();
    G.buildMode = { type: this.lastBuild || 'foundation', tier: this.lastTier || 'twig', ry: 0, cursor: null, hammer: false, cat: this.lastCat || 'build' };
    document.body.classList.add('building'); refreshHeld(p); $('#buildbar').classList.remove('hidden'); this.renderBuildBar();
    if (G.tut) G.tut.event('buildmode');
  },
  renderBuildBar() {
    const bm = G.buildMode; const bar = $('#buildbar'); bar.innerHTML = ''; const p = G.player;
    const cats = el('div', 'bcats');
    for (const [k, l, icn] of [['build', 'Build', 'foundation'], ['doors', 'Doors', 'door'], ['walls', 'Walls', 'highwall'], ['items', 'Items', 'box'], ['defense', 'Defense', 'turret']]) {
      const b = el('button', bm.cat === k && !bm.hammer ? 'on' : ''); b.innerHTML = '<img src="' + ui(icn) + '"><span>' + l + '</span>'; b.onclick = () => { bm.cat = k; bm.hammer = false; this.lastCat = k; const first = this.catItems(k)[0]; if (first && !this.catItems(k).includes(bm.type)) { bm.type = first; } this.clearGhost(); this.renderBuildBar(); }; cats.appendChild(b);
    }
    const hb = el('button', bm.hammer ? 'on' : ''); hb.innerHTML = '<img src="' + ui('hammer') + '"><span>Hammer</span>'; hb.onclick = () => { bm.hammer = !bm.hammer; this.clearGhost(); this.renderBuildBar(); }; cats.appendChild(hb);
    const xb = el('button', 'exit'); xb.innerHTML = '<img src="' + ui('close') + '"><span>Done</span>'; xb.onclick = () => this.toggleBuild(); cats.appendChild(xb);
    bar.appendChild(cats);
    if (bm.hammer) {
      const info = el('div', 'bhint', this.hamSel ? '' : 'Look at a piece and press FIRE to select it: upgrade, repair, rotate or remove.'); bar.appendChild(info);
      if (this.hamSel) bar.appendChild(this.hammerPanel(this.hamSel));
      return;
    }
    const items = el('div', 'bitems');
    for (const t of this.catItems(bm.cat)) {
      const def = PIECES[t] || DOORS[t] || HIGHWALLS[t] || DEPLOY[t]; const tier = PIECES[t] ? bm.tier : null; const cost = Build.costOf(t, tier || 'twig');
      const ok = canAfford(p, cost);
      const b = el('button', 'bi' + (bm.type === t ? ' on' : '') + (ok ? '' : ' poor'));
      b.innerHTML = '<img src="' + ui(glyphFor(t)) + '"><span>' + (def.name || t) + '</span><small>' + Object.entries(cost).map(([k, v]) => v + ' ' + shortName(k)).join(' ') + '</small>';
      b.onclick = () => { bm.type = t; this.lastBuild = t; this.clearGhost(); this.renderBuildBar(); };
      items.appendChild(b);
    }
    bar.appendChild(items);
    const row = el('div', 'brow');
    if (PIECES[bm.type]) {
      const tiers = el('div', 'tiers');
      for (const t of TIERS) { const b = el('button', bm.tier === t ? 'on' : '', TIER[t].name); b.style.borderColor = TIER[t].col; b.onclick = () => { bm.tier = t; this.lastTier = t; this.clearGhost(); this.renderBuildBar(); }; tiers.appendChild(b); }
      row.appendChild(tiers);
    }
    if (DEPLOY[bm.type]) { const r = el('button', '', '⟳ Rotate'); r.onclick = () => { bm.ry = (bm.ry + Math.PI / 2) % (Math.PI * 2); }; row.appendChild(r); }
    const pl = el('button', 'primary place', 'PLACE'); pl.onclick = () => this.placeAtCursor(); row.appendChild(pl);
    bar.appendChild(row);
    const d = PIECES[bm.type] || DOORS[bm.type] || HIGHWALLS[bm.type] || DEPLOY[bm.type];
    bar.appendChild(el('div', 'bhint', (d && d.desc ? d.desc + ' ' : '') + (Input.touchMode ? 'Look where you want it · FIRE places it.' : 'Look where you want it · click places · R rotates.')));
  },
  catItems(cat) {
    if (cat === 'build') return PIECE_ORDER;
    if (cat === 'doors') return ['door_wood', 'door_metal', 'door_armored'];
    if (cat === 'walls') return ['highwall_wood', 'highwall_stone', 'gate_wood', 'gate_stone'];
    if (cat === 'defense') return ['spikes', 'landmine', 'shotgun_trap', 'auto_turret', 'floodlight'];
    return DEPLOY_ORDER.filter(t => !['spikes', 'landmine', 'shotgun_trap', 'auto_turret', 'floodlight'].includes(t));
  },
  buildTick(dt) {
    const bm = G.buildMode; const p = G.player; if (!bm || !p) return;
    if (Input.pressed.rotate || (Input.pressed.reload && !bm.hammer)) bm.ry = (bm.ry + Math.PI / 2) % (Math.PI * 2);
    if (Input.pressed.hammer) { bm.hammer = !bm.hammer; this.hamSel = null; this.renderBuildBar(); }
    // first person: build where the crosshair meets the ground or a floor
    const lp = lookPoint(p, bm.hammer ? 6 : 10); bm.cursor = { x: lp.x, z: lp.z };
    if (bm.hammer) {
      const t = this.hammerTarget(p);
      if (t !== this.hamLook) { this.hamLook = t; }
      if (Input.pressed.fire && !G.uiBlock) { this.hamSel = t; G.game.hammerT = 1; this.renderBuildBar(); if (t) Sfx.click(); }
      this.highlight(t);
    } else {
      this.highlight(null);
      if (Input.pressed.fire && !G.uiBlock) { this.placeAtCursor(); G.game.hammerT = 1; }
    }
    this.updateGhost();
  },
  /** building piece / deployable / door the player is looking at (within reach) */
  hammerTarget(p) {
    let best = null, bs = 9;
    const ey = p.y + p.eye, cp = Math.cos(p.pitch), fx = Math.cos(p.yaw) * cp, fz = Math.sin(p.yaw) * cp, fy = Math.sin(p.pitch);
    const test = (o, x, y, z, r) => { // distance from the view ray to the object's centre
      const vx = x - p.x, vy = y - ey, vz = z - p.z; const t = vx * fx + vy * fy + vz * fz; if (t < 0.3 || t > 6.5) return;
      const dx = vx - fx * t, dy = vy - fy * t, dz = vz - fz * t; const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
      const sc = d + t * 0.05; if (d < 0.6 && sc < bs) { bs = sc; best = o; }
    };
    for (const pc of Build.edges.values()) if (pc.owner === 'player') { const [cx, cz] = Build.edgeCenter(pc.edge, pc.ci, pc.cj); test(pc, cx, (pc.base ?? pc.level) + 1.3, cz, 1.3); }
    for (const c of Build.cells.values()) { if (c.found && c.found.owner === 'player') test(c.found, c.found.ci * 3 + 1.5, c.found.level + 0.5, c.found.cj * 3 + 1.5, 1.4); if (c.ceil && c.ceil.owner === 'player') test(c.ceil, c.ceil.ci * 3 + 1.5, c.ceil.level + 3.3, c.ceil.cj * 3 + 1.5, 1.4); }
    for (const d of G.doors) if (d.owner === 'player') test(d, d.x, d.y + 1.1, d.z, 0.8);
    for (const d of Build.deploys) if (d.owner === 'player') test(d, d.x, d.y + 0.6, d.z, 0.6);
    return best;
  },
  highlight(o) {
    if (this._hl === o) return; this._hl = o;
    if (!this.hlBox) { this.hlBox = new THREE.BoxHelper(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)), 0xffd27a); this.hlBox.material.depthTest = false; this.hlBox.renderOrder = 10; }
    if (!o) { G.scene.remove(this.hlBox); return; }
    const m = o.sk === 'door' ? o.mesh.root : o.mesh; if (!m) { G.scene.remove(this.hlBox); return; }
    const was = m.visible; m.visible = true; this.hlBox.setFromObject(m); m.visible = was; G.scene.add(this.hlBox);
  },
  placeAtCursor() {
    const bm = G.buildMode; const p = G.player; if (!bm || !bm.cursor) return;
    if (dist(p.x, p.z, bm.cursor.x, bm.cursor.z) > 12.5) { this.toast('Too far away'); return; }
    const t = Build.target(bm.type, bm.cursor.x, bm.cursor.z, bm.ry);
    const r = tryPlace(p, bm.type, t, bm.tier);
    if (r) this.renderBuildBar();
  },
  placeLine(L) {
    const bm = G.buildMode; const p = G.player; const n = Math.max(1, Math.ceil(dist(L.x0, L.z0, L.x1, L.z1) / 1.5)); const done = new Set(); let placed = 0;
    for (let i = 0; i <= n; i++) {
      const x = L.x0 + (L.x1 - L.x0) * i / n, z = L.z0 + (L.z1 - L.z0) * i / n;
      const t = Build.target(bm.type, x, z, bm.ry); const key = JSON.stringify(t); if (done.has(key)) continue; done.add(key);
      if (dist(p.x, p.z, x, z) > 16) continue;
      if (!Build.check(bm.type, t).ok) continue;
      if (!canAfford(p, Build.costOf(bm.type, bm.tier))) { this.toast('Not enough resources'); break; }
      if (tryPlace(p, bm.type, t, bm.tier)) placed++;
    }
    if (placed) this.renderBuildBar();
  },
  updateGhost() {
    const bm = G.buildMode; if (!bm) return;
    if (bm.hammer) { this.clearGhost(); return; }
    const t = Build.target(bm.type, bm.cursor.x, bm.cursor.z, bm.ry); const chk = Build.check(bm.type, t);
    const key = bm.type + '|' + bm.tier;
    if (!this.ghost || this.ghost.key !== key) { this.clearGhost(); this.ghost = { key, obj: makeGhost(bm.type, bm.tier) }; G.scene.add(this.ghost.obj); }
    const o = this.ghost.obj; const ok = chk.ok && canAfford(G.player, Build.costOf(bm.type, bm.tier));
    setGhostColor(o, ok);
    if (PIECES[bm.type] && PIECES[bm.type].kind === 'cell') { const f = Build.found(t.ci, t.cj); const lv = bm.type === 'foundation' ? (chk.level ?? Build.levelFor(t.ci, t.cj).level ?? G.W.height(t.ci * CELL + 1.5, t.cj * CELL + 1.5)) : (f ? f.level + 0.6 : 0); o.position.set(t.ci * CELL + 1.5, lv || 0, t.cj * CELL + 1.5); o.rotation.y = 0; }
    else if (t.edge) { const [cx, cz] = Build.edgeCenter(t.edge, t.ci, t.cj); const cells = Build.edgeCells(t.edge, t.ci, t.cj); const f = Build.found(...cells[0]) || Build.found(...cells[1]); o.position.set(cx, f && !HIGHWALLS[bm.type] && !DOORS[bm.type] ? f.level + 0.6 : G.W.height(cx, cz), cz); o.rotation.y = t.edge === 'h' ? 0 : -Math.PI / 2; if (t.piece && DOORS[bm.type]) o.position.y = t.piece.base ?? t.piece.level; }
    else if (t.none) { o.position.set(bm.cursor.x, Build.floorY(bm.cursor.x, bm.cursor.z), bm.cursor.z); }
    else { o.position.set(t.x, Build.floorY(t.x, t.z), t.z); o.rotation.y = -bm.ry; }
    const hint = $('#bwhy'); const why = !chk.ok ? chk.why : !ok ? 'Not enough resources' : ''; if (hint._w !== why) { hint._w = why; hint.textContent = why; hint.classList.toggle('hidden', !why); }
  },
  clearGhost() { if (this.ghost) { G.scene.remove(this.ghost.obj); this.ghost = null; } const h = $('#bwhy'); if (h) h.classList.add('hidden'); },
  hammerPick(x, z) {
    if (x === undefined) { this.hamSel = this.hammerTarget(G.player); this.renderBuildBar(); return; }
    let best = null, bd = 2.2 * 2.2;
    const consider = (o, ox, oz) => { const d = (ox - x) ** 2 + (oz - z) ** 2; if (d < bd) { bd = d; best = o; } };
    for (const p of Build.edges.values()) if (p.owner === 'player') { const [cx, cz] = Build.edgeCenter(p.edge, p.ci, p.cj); consider(p, cx, cz); }
    for (const c of Build.cells.values()) { if (c.found && c.found.owner === 'player') consider(c.found, c.found.ci * 3 + 1.5, c.found.cj * 3 + 1.5); if (c.ceil) consider(c.ceil, c.ceil.ci * 3 + 1.5, c.ceil.cj * 3 + 1.5); }
    for (const d of G.doors) if (d.owner === 'player') consider(d, d.x, d.z);
    for (const d of Build.deploys) if (d.owner === 'player') consider(d, d.x, d.z);
    this.hamSel = best; this.renderBuildBar();
  },
  hammerPanel(o) {
    const p = G.player; const box = el('div', 'hpanel');
    const name = o.sk === 'piece' ? (PIECES[o.type] ? TIER[o.tier].name + ' ' + PIECES[o.type].name : HIGHWALLS[o.hw] ? HIGHWALLS[o.hw].name : o.type) : o.sk === 'door' ? DOORS[o.kind].name : DEPLOY[o.type].name;
    box.appendChild(el('div', 'hname', `<b>${name}</b> <small>${Math.ceil(o.hp)}/${o.maxhp} HP</small>`));
    const acts = el('div', 'acts');
    const A = (label, fn, cls, dis) => { const b = el('button', cls || '', label); b.disabled = !!dis; b.onclick = () => { fn(); this.renderBuildBar(); this.refreshAll(); }; acts.appendChild(b); };
    if (o.sk === 'piece' && PIECES[o.type]) {
      const i = TIERS.indexOf(o.tier);
      for (let k = i + 1; k < TIERS.length; k++) { const t = TIERS[k]; const cost = Build.costOf(o.type, t); A('→ ' + TIER[t].name + ' (' + Object.entries(cost).map(([a, b]) => b + ' ' + shortName(a)).join(' ') + ')', () => { if (!canAfford(p, cost)) { this.toast('Not enough resources'); return; } spend(p, cost); Build.upgrade(o, t); }, k === i + 1 ? 'primary' : '', !canAfford(p, cost)); }
      // upgrade the whole building
      const all = [...Build.edges.values(), ...[...Build.cells.values()].flatMap(c => [c.found, c.ceil])].filter(q => q && q.owner === 'player' && PIECES[q.type] && TIERS.indexOf(q.tier) < TIERS.indexOf(o.tier === 'armored' ? 'armored' : TIERS[Math.min(4, i + 1)]));
      if (i < 4 && all.length > 1) {
        const tgt = TIERS[i + 1]; const tot = {}; for (const q of all) { if (TIERS.indexOf(q.tier) >= i + 1) continue; for (const [a, b] of Object.entries(Build.costOf(q.type, tgt))) tot[a] = (tot[a] || 0) + b; }
        A('Upgrade all to ' + TIER[tgt].name + ' (' + Object.entries(tot).map(([a, b]) => b + ' ' + shortName(a)).join(' ') + ')', () => { if (!canAfford(p, tot)) { this.toast('Not enough resources'); return; } spend(p, tot); for (const q of all) if (TIERS.indexOf(q.tier) < i + 1) Build.upgrade(q, tgt); }, '', !canAfford(p, tot));
      }
    }
    if (o.hp < o.maxhp) { const base = o.sk === 'door' ? DOORS[o.kind].cost : o.sk === 'deploy' ? DEPLOY[o.type].cost : Build.costOf(o.hw || o.type, o.tier); const cost = {}; for (const [a, b] of Object.entries(base)) cost[a] = Math.max(1, Math.ceil(b * 0.5 * (1 - o.hp / o.maxhp))); A('Repair (' + Object.entries(cost).map(([a, b]) => b + ' ' + shortName(a)).join(' ') + ')', () => { if (!canAfford(p, cost)) { this.toast('Not enough resources'); return; } spend(p, cost); o.hp = o.maxhp; Sfx.build(); }, '', !canAfford(p, cost)); }
    if (o.sk === 'door') A('Flip hinge', () => { o.flip = !o.flip; o.mesh.root.rotation.y += Math.PI; });
    if (o.sk === 'deploy') A('Rotate', () => { o.ry = (o.ry + Math.PI / 2) % (Math.PI * 2); o.mesh.rotation.y = -o.ry; });
    A('Remove (50% refund)', () => {
      const base = o.sk === 'door' ? DOORS[o.kind].cost : o.sk === 'deploy' ? DEPLOY[o.type].cost : Build.costOf(o.hw || o.type, o.tier);
      for (const [a, b] of Object.entries(base)) give(p, a, Math.floor(b * 0.5 * (o.hp / o.maxhp)));
      if (o.sk === 'door') { import('./doors.js').then(m => { m.removeDoor(o); if (o.piece) o.piece.door = null; Build.dirty = true; }); }
      else if (o.sk === 'deploy') { if (o.inv) Live.dropInv(o.x, o.z, o.inv, 'bag', 900); if (o === Build.tc) { this.toast('Tool Cupboard removed — your land is unclaimed', 'bad'); } Build.removeDeploy(o, true); }
      else Build.destroy(o, true);
      this.hamSel = null;
    }, 'danger');
    box.appendChild(acts); return box;
  },
  // ---------------------------------------------------------------- menus
  menu() {
    G.mode = 'menu'; this.showHud(false);
    const m = $('#menu'); m.classList.remove('hidden'); const has = Save.has();
    m.innerHTML = `<div class="logo"><h1>ZONEFALL</h1><p>Open-world survival · Build · Raid · Survive</p></div>
      <div class="mbtns">${has ? '<button class="primary" id="m-cont">Continue</button>' : ''}<button class="${has ? '' : 'primary'}" id="m-new">New Run</button>
      <button id="m-perks">Perks <small>(${G.meta.points} pts)</small></button><button id="m-help">How to play</button><button id="m-set">Settings</button></div>
      <p class="mfoot">Best: day ${G.meta.best} · Runs ${G.meta.runs} · v${VERSION}</p><p class="mtip">${pick(TIPS)}</p>`;
    const go = fn => () => { Sfx.unlock(); m.classList.add('hidden'); fn(); };
    if (has) $('#m-cont').onclick = go(() => this.loading(() => G.game.continueRun()));
    $('#m-new').onclick = () => { if (has && !confirm('Start a new run? Your current run will be lost.')) return; go(() => this.loading(() => G.game.newRun()))(); };
    $('#m-perks').onclick = () => this.perksScreen();
    $('#m-help').onclick = () => this.helpScreen();
    $('#m-set').onclick = () => this.settingsScreen(() => this.menu());
  },
  loading(fn) {
    const l = $('#loading'); l.classList.remove('hidden'); l.innerHTML = '<div class="spin"></div><p>Generating the island…</p>';
    setTimeout(() => { try { fn(); } catch (e) { console.error(e); alert('Failed to start: ' + e.message); } l.classList.add('hidden'); }, 60);
  },
  perksScreen() {
    const m = $('#menu'); const M = G.meta;
    m.innerHTML = `<h2>Perks</h2><p class="dim">Points: <b>${M.points}</b> — earned at the end of every run. Unlocked perks apply to new runs.</p><div class="perks"></div><button id="pk-back">Back</button>`;
    const box = m.querySelector('.perks');
    for (const pk of PERKS) {
      const own = M.perks.includes(pk.id); const d = el('div', 'perk' + (own ? ' own' : ''), `<b>${pk.name}</b><small>${pk.desc}</small>`);
      const b = el('button', own ? '' : 'primary', own ? 'Owned' : pk.cost + ' pts'); b.disabled = own || M.points < pk.cost;
      b.onclick = () => { M.points -= pk.cost; M.perks.push(pk.id); Save.writeMeta(M); Sfx.win(); this.perksScreen(); };
      d.appendChild(b); box.appendChild(d);
    }
    $('#pk-back').onclick = () => this.menu();
  },
  helpScreen() {
    const m = $('#menu');
    m.innerHTML = `<h2>How to play</h2><div class="help">
      <p><b>Survive the island.</b> You wash up on a beach with a rock and a torch. Hit trees and rocks for wood and stone (look at them and hold the hand button), pick hemp for cloth, hunt animals for meat and leather. Keep an eye on <b>health, food and water</b>.</p>
      <p><b>Build like you mean it.</b> Open the hammer menu: lay 3 m foundations, then walls, doorways, windows and roofs on their edges. Put real doors in doorways — they swing open when you walk into them and close behind you; raiders have to break them. Upgrade twig → wood → stone → sheet metal → armored.</p>
      <p><b>Claim it.</b> A Tool Cupboard on your foundations claims the land, stops decay and stores resources for turrets. Every night raiders come for it — each night bigger. If the cupboard is destroyed, the run ends.</p>
      <p><b>Explore monuments.</b> Gas stations and supermarkets have recyclers; the Dish Array, Harbor, Train Yard, Water Treatment, Airfield, Garrison 9 and the Reactor Sector hold military loot behind keycard doors (some need a fuse or a lever). Haven Market is a safe trading post. Outlaw Forts can be raided with satchels or C4.</p>
      <p><b>Controls (touch):</b> left thumb moves (push the stick all the way forward to sprint), drag anywhere on the right to look. FIRE shoots / swings / throws (drag on it to keep aiming), the eye button aims down sights, ⤒ jumps, ⤓ crouches, the hand button uses or gathers (hold). Tap belt slots to switch, eat or heal. <b>Keyboard:</b> WASD, mouse look (click to lock), left click fire, right click aim, Space jump, C crouch, Shift sprint, E use, R reload, 1–6 belt, B build, Tab inventory, Q craft, M map.</p>
      <p class="dim">Tip: Add Zonefall to your Home Screen (Share → Add to Home Screen) and play in landscape.</p></div><button id="h-back">Back</button>`;
    $('#h-back').onclick = () => this.menu();
  },
  settingsScreen(back) {
    const host = G.mode === 'play' ? this.openSheet('Settings', b => b) : null;
    const box = host || $('#menu'); const S = G.settings;
    box.innerHTML = (host ? '' : '<h2>Settings</h2>') + `<div class="settings">
      <label>Graphics <select id="s-gfx"><option value="low">Low (fastest)</option><option value="med">Medium</option><option value="high">High</option></select></label>
      <label>Sound <input type="checkbox" id="s-snd"></label>
      <label>Volume <input type="range" id="s-vol" min="0" max="1" step="0.05"></label>
      <label>Look sensitivity <input type="range" id="s-sens" min="0.3" max="2.5" step="0.05"></label>
      <label>Field of view <input type="range" id="s-fov" min="60" max="95" step="1"></label>
      <label>Invert look up/down <input type="checkbox" id="s-inv"></label>
      <label>Aim assist (touch) <input type="checkbox" id="s-aa"></label>
      <label>Doors close behind you <input type="checkbox" id="s-door"></label>
      <label>Gun flashlight at night <input type="checkbox" id="s-fl"></label>
      <label>Something look broken? <button id="s-repair" class="mini">Repair (reload fresh)</button></label>
      </div>` + (host ? '' : '<button id="s-back">Back</button>');
    const q = s => box.querySelector(s);
    q('#s-gfx').value = S.gfx; q('#s-snd').checked = S.sound; q('#s-vol').value = S.volume; q('#s-sens').value = S.sens || 1; q('#s-fov').value = S.fov || 72; q('#s-inv').checked = !!S.invert; q('#s-aa').checked = S.aimAssist !== false; q('#s-door').checked = S.autoClose !== false; q('#s-fl').checked = S.flashlight !== false;
    const save = () => { S.gfx = q('#s-gfx').value; S.sound = q('#s-snd').checked; S.volume = +q('#s-vol').value; S.sens = +q('#s-sens').value; S.fov = +q('#s-fov').value; S.invert = q('#s-inv').checked; S.aimAssist = q('#s-aa').checked; G.rend.setFov(S.fov); S.autoClose = q('#s-door').checked; S.flashlight = q('#s-fl').checked; Sfx.enabled = S.sound; Sfx.setVolume(S.volume); Save.writeSettings(S); if (G.rend.level !== S.gfx) G.rend.setLevel(S.gfx); };
    box.querySelectorAll('select,input').forEach(e => e.onchange = save);
    q('#s-repair').onclick = async () => { // drop cached files + service worker, keep saves, reload from the network
      try { if (G.mode === 'play') G.game.save(); } catch (e) { }
      try { const rs = await navigator.serviceWorker.getRegistrations(); for (const r of rs) await r.unregister(); } catch (e) { }
      try { for (const k of await caches.keys()) await caches.delete(k); } catch (e) { }
      location.reload();
    };
    if (!host) q('#s-back').onclick = back;
  },
  openPause() {
    G.paused = true;
    this.openSheet('Paused', body => {
      body.innerHTML = `<div class="pause"><p>Day ${G.day} · Kills ${G.run.kills} · Raids beaten ${G.run.raidsBeaten}</p>
        <button class="primary" id="p-res">Resume</button><button id="p-set">Settings</button><button id="p-help">Tips</button><button id="p-menu">Save & quit to menu</button><button class="danger" id="p-end">Abandon run</button></div>`;
      $('#p-res').onclick = () => this.closeSheet();
      $('#p-set').onclick = () => this.settingsScreen();
      $('#p-help').onclick = () => { this.toast(pick(TIPS)); };
      $('#p-menu').onclick = () => { G.game.save(); this.closeSheet(); G.mode = 'menu'; this.menu(); };
      $('#p-end').onclick = () => { if (confirm('Abandon this run? You still earn perk points.')) { this.closeSheet(); G.game.endRun('You abandoned the run.'); } };
    });
    this.onClose = () => { G.paused = false; };
  },
  deathScreen(by) {
    const d = $('#death'); d.classList.remove('hidden'); G.uiBlock = true;
    const opts = G.game.respawnOptions();
    d.innerHTML = `<h2>YOU DIED</h2><p>Killed by ${by}. Your gear is in a bag where you fell.</p><div class="resp"></div>`;
    const box = d.querySelector('.resp');
    const done = () => { d.classList.add('hidden'); G.uiBlock = false; };
    for (const o of opts) { const b = el('button', o.cd > 0 ? '' : 'primary', o.label + (o.cd > 0 ? ' (' + Math.ceil(o.cd) + 's)' : '')); b.disabled = o.cd > 0; b.onclick = () => { done(); G.game.respawn(o.d); }; box.appendChild(b); }
    const b = el('button', opts.length ? '' : 'primary', 'Random beach'); b.onclick = () => { done(); G.game.respawn(null); }; box.appendChild(b);
    clearInterval(this._dsi); this._dsi = setInterval(() => { if (d.classList.contains('hidden')) { clearInterval(this._dsi); return; } G.t += 0; const o2 = G.game.respawnOptions(); [...box.children].forEach((btn, i) => { const o = o2[i]; if (o) { btn.disabled = o.cd > 0; btn.textContent = o.label + (o.cd > 0 ? ' (' + Math.ceil(o.cd) + 's)' : ''); btn.className = o.cd > 0 ? '' : 'primary'; } }); }, 500);
  },
  gameOver(r) {
    this.showHud(false); if (this.sheetOpen) this.closeSheet();
    const d = $('#death'); d.classList.remove('hidden');
    d.innerHTML = `<h2>RUN OVER</h2><p>${r.reason}</p><div class="sum"><span>Days survived <b>${r.day}</b></span><span>Kills <b>${r.kills}</b></span><span>Raids repelled <b>${r.raids}</b></span><span>Containers looted <b>${r.looted}</b></span><span>Deaths <b>${r.deaths}</b></span><span>Score <b>${r.score}</b></span></div><p class="good">+${r.pts} perk points</p><button class="primary" id="go-menu">Main menu</button>`;
    $('#go-menu').onclick = () => { d.classList.add('hidden'); G.uiBlock = false; this.menu(); };
  },
};

function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function catName(c) { return { res: 'Resource', comp: 'Component', val: 'Valuable — sell at Haven Market or recycle', food: 'Food', drink: 'Drink', med: 'Medical', ammo: 'Ammunition', throw: 'Throwable', gun: 'Weapon', melee: 'Tool / melee', armor: 'Body armour', helmet: 'Headgear', bag: 'Backpack', key: 'Keycard — opens monument vaults', art: 'Artifact', bp: 'Blueprint' }[c] || c; }
function recipeCat(def) { const c = def.cat; if (c === 'melee') return 'tools'; if (c === 'gun') return 'weapons'; if (c === 'ammo' || c === 'throw') return 'ammo'; if (['armor', 'helmet', 'bag'].includes(c)) return 'gear'; if (['med', 'food', 'drink'].includes(c)) return 'med'; if (c === 'res') return 'res'; return 'res'; }
function shortName(k) { return { wood: 'wood', stone: 'stone', metal: 'metal', hqm: 'HQM', cloth: 'cloth', scrap: 'scrap', gears: 'gears', circuit: 'circuit', pipe: 'pipe', low_fuel: 'fuel', gunpowder: 'gp', leather: 'leather' }[k] || nm(k); }
function glyphFor(t) {
  return { foundation: 'foundation', wall: 'wall', doorway: 'doorway', window: 'window', lowwall: 'lowwall', ceiling: 'ceiling', door_wood: 'door', door_metal: 'door', door_armored: 'door', highwall_wood: 'highwall', highwall_stone: 'highwall', gate_wood: 'gate', gate_stone: 'gate',
    tc: 'tc', sleeping_bag: 'sleepingbag', campfire: 'campfire', box_small: 'box', box_large: 'box', furnace: 'furnace', workbench1: 'workbench', workbench2: 'workbench', workbench3: 'workbench', research: 'research', recycler: 'recycle', bed: 'bed', water_barrel: 'drop', planter: 'planter', lantern: 'light', floodlight: 'light', spikes: 'trap', landmine: 'mine', shotgun_trap: 'turret', auto_turret: 'turret', quarry: 'quarry' }[t] || 'build';
}
// ---------------------------------------------------------------- ghosts
import { THREE, M } from './gfx/materials.js';
let GM = null;
export function setUiModels(m) { GM = m; }
const ghostOk = new THREE.MeshBasicMaterial({ color: '#60ff90', transparent: true, opacity: 0.38, depthWrite: false });
const ghostBad = new THREE.MeshBasicMaterial({ color: '#ff5050', transparent: true, opacity: 0.38, depthWrite: false });
function makeGhost(type, tier) {
  let o = null;
  try {
    if (PIECES[type]) o = GM.makePiece(type, tier);
    else if (HIGHWALLS[type]) o = GM.makePiece('highwall', HIGHWALLS[type].tier);
    else if (DOORS[type]) { const d = GM.makeDoor(type, {}); o = d.root; }
    else if (DEPLOY[type]) o = GM.makeDeployable(type);
  } catch (e) { o = null; }
  if (!o) { o = new THREE.Group(); M.add(o, M.box(PIECES[type] && PIECES[type].kind === 'cell' ? 3 : 3, type === 'foundation' ? 0.6 : 2.6, type === 'foundation' ? 3 : 0.2), ghostOk, 0, type === 'foundation' ? 0.3 : 1.3, 0); }
  o.traverse(c => { if (c.isMesh) { c.material = ghostOk; c.castShadow = false; c.receiveShadow = false; c.renderOrder = 9; } });
  return o;
}
function setGhostColor(o, ok) { if (o.userData.ok === ok) return; o.userData.ok = ok; o.traverse(c => { if (c.isMesh) c.material = ok ? ghostOk : ghostBad; }); }
void RAR_COL; void fmtTime; void startReload; void TIERS;

// ============================================================================
// ZONEFALL 3 — UI: HUD, overlay canvas (sticks, floating text, markers,
// throw arcs), hotbar, inventory, loot/storage/oven/shop/recycler/research
// windows, crafting, build bar, map, menus, death + game over screens.
// ============================================================================
import { Fishing } from './fishing.js';
import { G } from './state.js';
import { ITEMS, RECIPES, RECIPE, WEAPONS, DEPLOY, DEPLOY_ORDER, PIECES, PIECE_ORDER, DOORS, HIGHWALLS, TIER, TIERS, RECYCLE, RESEARCH_COST, SHOPS, MONUMENTS, OVENS, TIPS, RAR_COL, VERSION, THROWN, CELL } from './data.js';
import { ATTACH, ATT_SLOTS, ATT_SLOT_NAME, attAllowed, attFx, gunMag, gunReload, MELEE, AMMO_MOD } from './data.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Music } from './music.js';
import { Save } from './save.js';
import { Build } from './build.js';
import { $, el, clamp, dist, fmtTime, pick } from './util.js';
import { buildMapCanvas } from './gfx/terrain.js';
import { useItem, refreshLook, refreshHeld, heldStack, craft, canCraft, haveCount, spend, quickHeal, startReload, countAmmo, tryPlace, canAfford, give, lookPoint, sightReticle, gunKick } from './player.js';
import { canAttach, attachTo, detachFrom, stackExtra } from './inventory.js';
import { Live } from './world/live.js';
import { WORLD } from './world/gen.js';
import { Net } from './net.js';
import { Profile, openCreator } from './profile.js';

/* global ART */
const artLib = () => (typeof ART !== 'undefined' ? ART : window.ART) || null;
const ic = id => { const A = artLib(); return A && A.iconURL ? A.iconURL(id) : ''; };
const ui = (n, t) => { const A = artLib(); return A && A.uiIconURL ? A.uiIconURL(n, t) : ''; };
const rarCls = id => 'c-' + ((ITEMS[id] && ITEMS[id].rar) || 'common');
const nm = id => ITEMS[id] ? ITEMS[id].name : id;
/** does equipment slot `key` ('helmet' | 'armor' | 'bag' | 'art0' | 'art1') take this item? */
const eqAccepts = (key, def) => !!def && (key.startsWith('art') ? def.cat === 'art' : def.cat === key);

export const UI = {
  floats: [], toasts: [],
  init() {
    this.ov = $('#overlay'); this.g = this.ov.getContext('2d'); this.resize(); addEventListener('resize', () => this.resize());
    this.mini = $('#minimap'); this.mg = this.mini.getContext('2d');
    // HUD buttons
    const B = (sel, name, opts) => { const e = $(sel); if (e) Input.bindButton(e, name, opts); return e; };
    B('#b-interact', 'interact'); B('#b-reload', 'reload'); B('#b-heal', 'heal');
    B('#b-fire', 'fire', { look: true }); B('#b-fire2', 'fire', { look: true }); B('#b-ads', 'ads', { toggle: true, look: true }); B('#b-jump', 'jump'); B('#b-crouch', 'crouch', { toggle: true }); B('#b-up', 'up'); B('#b-down', 'down');
    Input.blocked = () => !!G.uiBlock; Input.canLock = () => G.mode === 'play' && !G.uiBlock && !G.paused;
    $('#b-build').addEventListener('click', () => this.toggleBuild());
    $('#b-bag').addEventListener('click', () => this.openInventory());
    $('#b-craft').addEventListener('click', () => this.openCraft());
    $('#b-map').addEventListener('click', () => this.openMap());
    $('#b-pause').addEventListener('click', () => this.openPause());
    this.mini.addEventListener('click', () => this.openMap());
    this.fastTaps(); this.dragInit();
    // co-op chat
    $('#b-chat').addEventListener('click', () => this.toggleChat());
    const qc = $('#quickchat'); for (const t of ['👋 Hi!', 'Follow me', 'Over here!', 'Help!', 'Thanks', 'Let\'s build', 'Raid time 💣', 'GG']) { const b = el('button', 'mini', t); b.onclick = () => { Net.chat(t); this.toggleChat(false); }; qc.appendChild(b); }
    $('#chatsend').addEventListener('click', () => this.sendChat()); $('#chatx').addEventListener('click', () => this.toggleChat(false));
    Net.onChange = () => { if (this.coopRefresh) this.coopRefresh(); };
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
      const k0 = e.key.toLowerCase();
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) {
        if (e.target.id === 'chatin' && k0 === 'enter') { e.preventDefault(); this.sendChat(); }
        if (e.target.id === 'chatin' && k0 === 'escape') this.toggleChat(false);
        return; // typing: no game shortcuts
      }
      if (G.mode !== 'play') return; const k = k0;
      if (k === 'enter' && Net.active) { e.preventDefault(); this.toggleChat(true); return; }
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
  hitMarker(crit) { this.hm = { t: 0, crit }; if (Sfx.hitmark) Sfx.hitmark(crit); },
  toggleChat(on) {
    const box = $('#chatbox'); const show = on === undefined ? box.classList.contains('hidden') : on;
    box.classList.toggle('hidden', !show);
    if (show) { try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { } if (!Input.touchMode) setTimeout(() => $('#chatin').focus(), 30); }
    else $('#chatin').blur();
  },
  sendChat() { const i = $('#chatin'); const t = i.value; i.value = ''; if (t.trim()) Net.chat(t); this.toggleChat(false); },
  /** a chat line from a player (plain text only — never HTML from the network) */
  chatLine(name, text, me) {
    const line = el('div', 'chatl'); const b = document.createElement('b'); b.className = me ? 'me' : 'pl'; b.textContent = name + ': '; line.appendChild(b); line.appendChild(document.createTextNode(text));
    const log = $('#chatlog'); log.appendChild(line); while (log.children.length > 6) log.firstChild.remove(); setTimeout(() => line.classList.add('out'), 12000); setTimeout(() => line.remove(), 12600);
  },
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
  /**
   * Instant taps for every tappable thing (HUD, build bar, menus, inventory slots).
   * iOS only sends the synthetic 'click' for single-finger taps and after a delay, so with a
   * thumb on the move stick these buttons used to ignore taps. We fire the click ourselves on
   * touchend (if the finger didn't slide off or scroll) and suppress the late synthetic one.
   */
  fastTaps() {
    const SEL = 'button, .slot, .rec, [data-tap], #minimap';
    const live = new Map();
    const opts = { passive: true, capture: true };
    document.addEventListener('touchstart', e => {
      for (const t of e.changedTouches) {
        const el = t.target && t.target.closest ? t.target.closest(SEL) : null;
        if (!el || el.dataset.held || el.disabled) continue;
        live.set(t.identifier, { el, x: t.clientX, y: t.clientY }); el.classList.add('pressing');
      }
    }, opts);
    document.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) { const s = live.get(t.identifier); if (s && Math.hypot(t.clientX - s.x, t.clientY - s.y) > 14) { s.el.classList.remove('pressing'); live.delete(t.identifier); } }
    }, opts);
    const end = (e, fire) => {
      for (const t of e.changedTouches) {
        const s = live.get(t.identifier); if (!s) continue; live.delete(t.identifier); s.el.classList.remove('pressing');
        if (!fire || !s.el.isConnected || s.el.disabled) continue;
        const over = document.elementFromPoint(t.clientX, t.clientY);
        if (!over || !(over === s.el || s.el.contains(over))) continue;
        if (e.cancelable) e.preventDefault();
        Sfx.unlock(); s.el.click();
      }
    };
    document.addEventListener('touchend', e => end(e, true), { passive: false, capture: true });
    document.addEventListener('touchcancel', e => end(e, false), opts);
  },
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
    const mb = $('#mpbadge'); if (mb) { mb.classList.toggle('hidden', !Net.active); if (Net.active) mb.textContent = 'CO-OP · ' + Net.code + ' · ' + Net.count + ' player' + (Net.count > 1 ? 's' : '') + (Net.pvp ? ' · PvP' : ''); }
    const v = p.vehicle, vh = $('#vhud');
    if (v && vh) {
      const spd = Math.round((v.kind === 'heli' ? Math.hypot(v.vx, v.vz) : Math.abs(v.speed)) * 3.6);
      const alt = v.kind === 'heli' ? Math.max(0, Math.round(v.y - Math.max(0, G.W.height(v.x, v.z)))) : null;
      vh.innerHTML = '<span class="vn">' + v.K.name.toUpperCase() + '</span><b>' + spd + '</b><small>km/h</small>' + (alt !== null ? '<b>' + alt + '</b><small>m</small>' : '') +
        (v.K.fuel ? '<span class="fl">FUEL</span><span class="fb"><i style="width:' + clamp(v.fuel / (v.K.fuel * 1.6) * 100, 0, 100) + '%"></i></span>' : '') + (v.boat && v.ground > 0.55 ? '<span class="fl">AGROUND</span>' : '') + '<span class="fl">' + (v.K.hpLabel || 'HULL') + '</span><span class="fb hp"><i style="width:' + clamp(v.hp / v.K.hp * 100, 0, 100) + '%"></i></span>' +
        (v.K.stamT ? '<span class="fl">' + (v.winded ? 'WINDED' : 'STAMINA') + '</span><span class="fb"><i style="width:' + clamp(v.stam * 100, 0, 100) + '%"></i></span>' : '') +
        (v.kind === 'heli' && v.rpm < 0.8 ? '<span class="fl">SPOOLING…</span>' : '');
      vh.classList.remove('hidden');
    } else if (vh) vh.classList.add('hidden');
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
      bar.style.width = W ? Math.min(100, (s.ammo || 0) / (gunMag(s) || W.mag) * 100) + '%' : '0';
    }
    // interact button
    const it = G.interact; const bi = $('#b-interact');
    bi.classList.toggle('dim', !it);
    const lab = it ? it.label : ''; if (bi._l !== lab) { bi._l = lab; bi.querySelector('.lab').textContent = lab; bi.querySelector('.lab').style.display = lab ? '' : 'none'; if (it) bi.querySelector('img').src = ui(it.icon || 'hand'); }
    // centre prompt (what you are looking at)
    // fishing: status line, and tension / catch bars while reeling
    const fh = Fishing.hud(), fe = $('#fish');
    if (fe) {
      if (!fh) { if (!fe.classList.contains('hidden')) { fe.classList.add('hidden'); $('#b-fire') && $('#b-fire').classList.remove('pulse'); } }
      else {
        fe.classList.remove('hidden'); fe.querySelector('b').textContent = fh.label || '';
        fe.classList.toggle('bars', !!fh.bar);
        if (fh.bar) { const t = Math.min(1, fh.tension || 0); const ti = fe.querySelector('.t'); ti.style.width = (t * 100) + '%'; ti.classList.toggle('hot', t >= 0.75); fe.querySelector('.pg').style.width = (Math.min(1, fh.progress || 0) * 100) + '%'; }
        $('#b-fire') && $('#b-fire').classList.toggle('pulse', fh.state === 'bite');
      }
    }
    const pr = $('#prompt'); const ptxt = it && !G.buildMode ? (Input.touchMode ? it.label : '[E] ' + it.label) : '';
    if (pr._t !== ptxt) { pr._t = ptxt; pr.textContent = ptxt; pr.classList.toggle('hidden', !ptxt); }
    // ammo panel
    const s = heldStack(p); const W = s && WEAPONS[s.id]; const am = $('#ammo');
    const atxt = W ? '<b>' + (s.ammo || 0) + '</b><small>/ ' + countAmmo(p, s.id) + '</small><i>' + nm(s.id) + '</i>' : s ? '<i>' + nm(s.id) + (s.n > 1 ? ' ×' + s.n : '') + '</i>' : '<i>Fists</i>';
    if (am._t !== atxt) { am._t = atxt; am.innerHTML = atxt; }
    am.classList.toggle('low', !!(W && (s.ammo || 0) <= Math.ceil(gunMag(s) * 0.25)));
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
    // other players in co-op: always-on name tags (+ health)
    if (Net.active) for (const pl of Net.players.values()) {
      const a = pl.actor; if (!a || (a.x - p.x) ** 2 + (a.z - p.z) ** 2 > 220 * 220) continue;
      const s = R.project(a.x, a.y + (pl.veh ? 2.6 : 2.25), a.z); if (!s.vis) continue;
      g.textAlign = 'center'; g.lineJoin = 'round'; g.font = 'italic 900 13px "Avenir Next Condensed","Arial Black",system-ui';
      g.lineWidth = 4; g.strokeStyle = '#120c10'; g.strokeText(pl.name, s.x, s.y - 6); g.fillStyle = Net.pvp ? '#ff8a6a' : '#9cf0ff'; g.fillText(pl.name, s.x, s.y - 6);
      if (!a.dead) { const w = 44, k = Math.max(0, Math.min(1, (pl.hp ?? 100) / 100)); g.fillStyle = '#120c10'; g.fillRect(s.x - w / 2 - 2, s.y - 2, w + 4, 8); g.fillStyle = '#3a3046'; g.fillRect(s.x - w / 2, s.y, w, 4); g.fillStyle = '#86e64a'; g.fillRect(s.x - w / 2, s.y, w * k, 4); }
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
    if (G.cargo && G.cargo.docked) mk.push({ x: G.cargo.x, z: G.cargo.z, icon: 'stash', col: '#4ac0ff', label: 'Ship' });
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
    x.classList.toggle('melee', !W); x.classList.toggle('ads', p.ads > 0.6 && !!W); x.classList.toggle('scope', sightReticle(p)); // scopes and holo sights bring their own reticle
    x.classList.toggle('hidden', p.dead || !!G.buildMode && false);
    if (this.hm) { this.hm.t += dt; x.classList.toggle('hit', this.hm.t < 0.18); x.classList.toggle('crit', this.hm.t < 0.18 && this.hm.crit); }
    $('#scope').classList.toggle('hidden', !!G.vm || !(p.ads > 0.85 && s && s.id === 'hunting')); // the viewmodel draws its own scope
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
    if (G.cargo) mark(Math.atan2(G.cargo.z - p.z, G.cargo.x - p.x), '⛴', '#4ac0ff', true);
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
    if (G.vehicles) for (const m of G.vehicles.markers()) { if (m.mine) continue; const [x, y] = toM(m.x, m.z); g.fillStyle = m.kind === 'heli' ? '#ff8a1e' : '#2bb3a8'; g.strokeStyle = '#120c10'; g.lineWidth = 1.5; if (m.kind === 'heli') { g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); g.stroke(); } else if (m.boat) { const yw = m.yaw || 0; g.fillStyle = m.kind === 'motorboat' ? '#4ac0ff' : '#f0d890'; g.beginPath(); g.moveTo(x + Math.cos(yw) * 5, y + Math.sin(yw) * 5); g.lineTo(x + Math.cos(yw + 2.5) * 4, y + Math.sin(yw + 2.5) * 4); g.lineTo(x + Math.cos(yw - 2.5) * 4, y + Math.sin(yw - 2.5) * 4); g.closePath(); g.fill(); g.stroke(); } else { g.fillRect(x - 3, y - 3, 6, 6); g.strokeRect(x - 3, y - 3, 6, 6); } }
    if (G.cargo) { const T = G.cargo.mapInfo(); const [x, y] = toM(T.x, T.z); g.save(); g.translate(x, y); g.rotate(T.ang); g.fillStyle = '#2f6fb0'; g.strokeStyle = '#120c10'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(9, 0); g.lineTo(4, -3.5); g.lineTo(-8, -3.5); g.lineTo(-8, 3.5); g.lineTo(4, 3.5); g.closePath(); g.fill(); g.stroke(); g.restore(); }
    if (G.train) { const T = G.train.mapInfo(); const [x, y] = toM(T.x, T.z); g.save(); g.translate(x, y); g.rotate(T.ang); g.fillStyle = '#d8432f'; g.strokeStyle = '#120c10'; g.lineWidth = 1.5; g.fillRect(-6, -3, 12, 6); g.strokeRect(-6, -3, 12, 6); g.restore(); }
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
  /** one item slot: icon, count, loaded-ammo bar, attachment pips, rarity colour */
  slotEl(s, extra) {
    const d = el('div', 'slot' + (s ? ' ' + rarCls(s.id) : ' empty') + (extra || ''));
    if (s) {
      const W = WEAPONS[s.id], na = s.att ? Object.keys(s.att).length : 0;
      d.innerHTML = '<img src="' + ic(s.id) + '">' + (s.n > 1 ? '<b>' + s.n + '</b>' : '') + (W ? '<i style="width:' + Math.min(100, (s.ammo || 0) / (gunMag(s) || W.mag) * 100) + '%"></i>' : '') + (na ? '<u class="pips">' + '<s></s>'.repeat(na) + '</u>' : '');
      d.title = nm(s.id) + (na ? ' + ' + Object.values(s.att).map(nm).join(', ') : '');
    }
    return d;
  },
  /** grid of an Inv. onTap(i, stack). The belt gets slot numbers and marks the slot in hand; with an attachment
   *  (or a gun) selected, the guns it fits (or the attachments that fit it) are outlined. */
  grid(inv, onTap, cls = '', sel) {
    const g = el('div', 'grid ' + cls);
    const gid = (this.dragGrids || (this.dragGrids = new Map())).size + 1; this.dragGrids.set(gid, inv);
    const P = G.player, belt = P && inv === P.inv.belt, ss = sel && sel.inv && sel.inv.slots[sel.i];
    const fits = q => ss && q && q !== ss && ((ATTACH[ss.id] && WEAPONS[q.id] && canAttach(q.id, ss.id)) || (WEAPONS[ss.id] && ATTACH[q.id] && canAttach(ss.id, q.id)));
    inv.slots.forEach((s, i) => {
      const d = this.slotEl(s, (sel && sel.inv === inv && sel.i === i ? ' picked' : '') + (belt && i === P.sel ? ' inhand' : '') + (fits(s) ? ' can-att' : '')); d.dataset.di = gid + ':' + i;
      if (belt) d.insertAdjacentHTML('beforeend', '<em class="bn">' + (i + 1) + '</em>');
      d.onclick = () => { if (this.drag && performance.now() < this.drag.mute) return; onTap(i, s); };
      g.appendChild(d);
    });
    return g;
  },
  // ---------------------------------------------------------------- item movement helpers
  /** move / merge / swap one slot onto another (any two inventories) */
  moveSlot(a, ai, b, bi) {
    if (a === b && ai === bi) return false;
    const A = a.slots[ai], Bs = b.slots[bi]; if (!A) return false;
    if (Bs && A.id === Bs.id && (ITEMS[A.id].stack || 1) > 1) { const st = ITEMS[A.id].stack; const k = Math.min(A.n, st - Bs.n); if (k <= 0) { a.slots[ai] = Bs; b.slots[bi] = A; } else { Bs.n += k; A.n -= k; if (A.n <= 0) a.slots[ai] = null; } }
    else { a.slots[ai] = Bs || null; b.slots[bi] = A; }
    return true;
  },
  /** the other place an item naturally goes: the open box, or belt <-> backpack */
  quickMove(inv, i, side) {
    const s = inv.slots[i]; if (!s) return; const P = G.player.inv;
    let dest = side && inv !== side.inv ? side.inv : side && inv === side.inv ? null : inv === P.belt ? P.main : P.belt;
    const left = dest ? dest.addStack(s) : P.addStack(s);
    if (left && left.n === s.n) { this.toast(dest === side?.inv ? 'That box is full' : 'No room'); return; }
    inv.slots[i] = left; Sfx.pickup();
    if (side && side.onChange) side.onChange();
  },
  /** tidy an inventory: merge stacks, then order by kind and name */
  sortInv(inv) {
    const CAT = ['gun', 'melee', 'att', 'ammo', 'throw', 'med', 'food', 'drink', 'armor', 'helmet', 'bag', 'res', 'comp', 'val', 'key', 'bp', 'art'];
    const RR = { legendary: 0, epic: 1, rare: 2, uncommon: 3 };
    const out = [], merged = new Map();
    for (const s of inv.items()) {
      const def = ITEMS[s.id]; if (!def) { out.push(s); continue; }
      const st = def.stack || 1; const plain = st > 1 && Object.keys(s).every(k => k === 'id' || k === 'n');
      if (plain) merged.set(s.id, (merged.get(s.id) || 0) + s.n); else out.push(s);
    }
    for (const [id, n] of merged) { const st = ITEMS[id].stack || 1; for (let k = n; k > 0; k -= st) out.push({ id, n: Math.min(st, k) }); }
    const ci = id => { const c = ITEMS[id] ? ITEMS[id].cat : ''; const k = CAT.indexOf(c); return k < 0 ? CAT.length : k; };
    out.sort((a, b) => ci(a.id) - ci(b.id) || (RR[ITEMS[a.id]?.rar] ?? 4) - (RR[ITEMS[b.id]?.rar] ?? 4) || nm(a.id).localeCompare(nm(b.id)) || b.n - a.n);
    if (out.length > inv.slots.length) return false;
    inv.clear(); out.forEach((s, i) => { inv.slots[i] = s; });
    Sfx.click(); return true;
  },
  /** move everything from the backpack into a box (belt stays put); matching = only items the box already holds */
  deposit(side, matching) {
    const P = G.player.inv, has = new Set(side.inv.items().map(s => s.id)); let moved = 0, full = false;
    for (let i = 0; i < P.main.slots.length; i++) {
      const s = P.main.slots[i]; if (!s || (matching && !has.has(s.id))) continue;
      const left = side.inv.addStack(s); if (!left || left.n < s.n) moved++; if (left) full = true; P.main.slots[i] = left;
    }
    if (moved) Sfx.pickup(); else Sfx.deny();
    this.toast(moved ? (full ? 'Box is full — moved what fits' : matching ? 'Stacked matching items' : 'Deposited your backpack') : (matching ? 'Nothing matches what is in there' : full ? 'That box is full' : 'Backpack is empty'));
    if (side.onChange) side.onChange();
  },
  /** press-and-drag items between any slots (mouse: drag at once; touch: hold briefly so swipes still scroll).
   *  Targets: any grid slot (move / merge / swap; an attachment dropped on a gun it fits is fitted), the equipment
   *  slots (armour, helmet, bag, artifacts), the selected gun's attachment slots, and the open box. While dragging,
   *  every place it can go is outlined (attachment fits in yellow) and the rest is dimmed. */
  dragInit() {
    const D = this.drag = { st: null, mute: 0 }; const ghost = el('div', 'drag-ghost hidden'); document.body.appendChild(ghost);
    const ref = node => { const k = node && node.dataset && node.dataset.di; if (!k) return null; const [g, i] = k.split(':').map(Number); const inv = this.dragGrids && this.dragGrids.get(g); return inv ? { inv, i } : null; };
    const target = (x, y) => {
      const o = document.elementFromPoint(x, y); if (!o || !o.closest) return null;
      const sl = o.closest('.slot[data-di]'); if (sl) return { el: sl, ref: ref(sl) };
      const eq = o.closest('[data-eq]'); if (eq) return { el: eq, eq: eq.dataset.eq };
      const as = o.closest('[data-aslot]'); if (as) return { el: as, aslot: as.dataset.aslot };
      const box = o.closest('.side-box'); return box && this.curSide ? { el: box, side: true } : null;
    };
    const fitsGun = (s, q) => !!(s && q && ATTACH[s.id] && WEAPONS[q.id] && canAttach(q.id, s.id));
    const canDrop = (s, t) => {
      if (!s || !t) return false;
      if (t.eq) return eqAccepts(t.eq, ITEMS[s.id]);
      if (t.aslot) { const g = this.selGun(); return !!(g && ATTACH[s.id] && ATTACH[s.id].slot === t.aslot && canAttach(g.id, s.id)); }
      if (t.side) return !!this.curSide;
      return !!t.ref;
    };
    const MARKS = ['dnd-ok', 'dnd-att', 'dnd-no'];
    let hot = null; const setHot = e => { if (hot === e) return; if (hot) hot.classList.remove('drop-hot'); hot = e; if (hot) hot.classList.add('drop-hot'); };
    const start = () => {
      const st = D.st; if (!st || st.on) return; st.on = true; st.el.classList.add('dragging'); st.el.classList.remove('pressing');
      const s = st.ref.inv.slots[st.ref.i]; ghost.className = 'drag-ghost ' + (s ? rarCls(s.id) : ''); ghost.innerHTML = s ? '<img src="' + ic(s.id) + '">' + (s.n > 1 ? '<b>' + s.n + '</b>' : '') : '';
      ghost.style.transform = `translate(${st.x - 28}px,${st.y - 28}px)`; if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) { }
      // show every drop target
      if (this.sheet) {
        this.sheet.classList.add('dnd');
        for (const e of this.sheet.querySelectorAll('.slot[data-di],[data-eq],[data-aslot],.side-box')) {
          if (e === st.el) continue;
          const t = e.dataset.di ? { ref: ref(e) } : e.dataset.eq ? { eq: e.dataset.eq } : e.dataset.aslot ? { aslot: e.dataset.aslot } : { side: true };
          if (!canDrop(s, t)) { e.classList.add('dnd-no'); continue; }
          e.classList.add(t.aslot || (t.ref && fitsGun(s, t.ref.inv.slots[t.ref.i])) ? 'dnd-att' : 'dnd-ok');
        }
      }
    };
    const stop = () => {
      clearTimeout(D.timer); if (D.st && D.st.el) D.st.el.classList.remove('dragging'); D.st = null; ghost.classList.add('hidden'); setHot(null);
      if (this.sheet) { this.sheet.classList.remove('dnd'); for (const e of this.sheet.querySelectorAll('.dnd-ok,.dnd-att,.dnd-no')) e.classList.remove(...MARKS); }
    };
    document.addEventListener('pointerdown', e => {
      if (!this.sheetOpen || e.button > 0) return; const sl = e.target.closest ? e.target.closest('.slot[data-di]') : null; const r = ref(sl);
      if (!r || !r.inv.slots[r.i]) return; stop();
      D.st = { ref: r, el: sl, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, pid: e.pointerId, on: false, touch: e.pointerType !== 'mouse' };
      if (D.st.touch) D.timer = setTimeout(start, 210);
    }, true);
    document.addEventListener('pointermove', e => {
      const st = D.st; if (!st || e.pointerId !== st.pid) return; st.x = e.clientX; st.y = e.clientY; const m = Math.hypot(st.x - st.x0, st.y - st.y0);
      if (!st.on) { if (!st.touch && m > 6) start(); else if (st.touch && m > 10) { stop(); return; } else return; }
      ghost.style.transform = `translate(${st.x - 28}px,${st.y - 28}px)`; const t = target(st.x, st.y);
      setHot(t && t.el && t.el !== st.el && canDrop(st.ref.inv.slots[st.ref.i], t) ? t.el : null);
    }, true);
    const up = e => {
      const st = D.st; if (!st || e.pointerId !== st.pid) return; if (!st.on) { stop(); return; }
      const t = target(e.clientX, e.clientY), a = st.ref.inv, ai = st.ref.i; stop(); D.mute = performance.now() + 350;
      const s0 = a.slots[ai];
      if (!t || !s0 || !canDrop(s0, t)) return;
      let ok = false, keepSel = null;
      if (t.eq) ok = this.equipFrom(a, ai, t.eq);
      else if (t.aslot) { ok = this.fitAtt(a, ai, this.selGun()); keepSel = this.sel; }
      else if (t.ref) {
        const q = t.ref.inv.slots[t.ref.i];
        if (fitsGun(s0, q)) { ok = this.fitAtt(a, ai, q); keepSel = { inv: t.ref.inv, i: t.ref.i, t: 0 }; }   // dropped on a gun it fits: fit it, show that gun
        else ok = this.moveSlot(a, ai, t.ref.inv, t.ref.i);
      } else if (t.side && this.curSide && a !== this.curSide.inv) { const left = this.curSide.inv.addStack(a.slots[ai]); ok = !left || left.n < a.slots[ai].n; a.slots[ai] = left; }
      if (!ok) return;
      Sfx.click(); this.sel = keepSel; refreshHeld(G.player);
      const side = this.curSide; if (side && side.onChange && (a === side.inv || (t.ref && t.ref.inv === side.inv) || t.side)) side.onChange();
      this.rebuild();
    };
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', e => { if (D.st && e.pointerId === D.st.pid && !D.st.on) stop(); else if (D.st && D.st.on) up(e); }, true);
    // while dragging on touch, stop the sheet from scrolling under the finger
    document.addEventListener('touchmove', e => { if (D.st && D.st.on && e.cancelable) e.preventDefault(); }, { passive: false, capture: true });
  },
  // ---------------------------------------------------------------- inventory
  // Layout: equipment column (head / body / bag / 2 artifacts + armour, rad, HP) | belt (numbered, the slot in
  // hand marked) + backpack | the open box (if any) and the item detail pane: stats with a comparison to what you
  // hold or wear, rarity, the gun's attachment slots, and actions (use, equip, fit, unload, split, move, drop).
  openInventory(side) {
    const p = G.player; if (!p || p.dead) return;
    this.sel = null; this.attPick = null;
    this.openSheet('Inventory', body => this.invBody(body, side), { cls: 'wide inv', tabs: [{ label: 'Inventory', on: true, fn: () => this.openInventory(side) }, { label: 'Craft', fn: () => this.openCraft() }] });
  },
  invBody(body, side) {
    const p = G.player; const inv = p.inv; this.curSide = side || null; if (this.dragGrids) this.dragGrids.clear();
    if (this.sel && !this.sel.inv.slots[this.sel.i]) this.sel = null;
    const wrap = el('div', 'inv-wrap' + (side ? ' has-side' : ''));
    // ---- equipment
    const eqc = el('div', 'inv-eq');
    const eq = el('div', 'equip');
    const eqSlot = (key, s, label, ghost, onTap) => {
      const w = el('div', 'eqw'); const d = this.slotEl(s, ' eqs' + (key.startsWith('art') ? ' art' : '')); d.dataset.eq = key;
      if (!s) d.innerHTML = '<img class="ghost" src="' + ic(ghost) + '">';
      d.title = s ? nm(s.id) + ' (tap to take off)' : label + ': drag ' + (key.startsWith('art') ? 'an artifact' : 'one') + ' here';
      d.onclick = () => { if (this.drag && performance.now() < this.drag.mute) return; if (s) onTap(); };
      w.appendChild(d); w.appendChild(el('small', '', label)); eq.appendChild(w);
    };
    // taking something off puts it in the backpack (selected, so its details show) or drops it if full
    const unequip = (s, clear) => { clear(); const k = inv.main.slots.indexOf(null); if (k >= 0) { inv.main.slots[k] = s; this.sel = { inv: inv.main, i: k, t: 0 }; } else { const left = inv.belt.addStack(s); if (left) { Live.dropItem(p.x, p.z, s.id, s.n, stackExtra(s)); this.toast('No room: dropped ' + nm(s.id)); } } refreshLook(p); Sfx.click(); this.rebuild(); };
    for (const [k, label, ghost] of [['helmet', 'Head', 'helm_mil'], ['armor', 'Body', 'vest_plate'], ['bag', 'Bag', 'bag_ruck']]) { const s = inv.equip[k]; eqSlot(k, s, label, ghost, () => unequip(s, () => { inv.equip[k] = null; })); }
    for (let i = 0; i < 2; i++) { const s = inv.arts[i]; eqSlot('art' + i, s, 'Artifact', 'art_pearl', () => unequip(s, () => { inv.arts[i] = null; })); }
    eqc.appendChild(eq);
    const stats = el('span', 'stats');
    stats.innerHTML = `<span title="Armour"><img src="${ui('shield')}"><b>${Math.round(inv.armorVal() * 100)}%</b></span><span title="Radiation resistance"><img src="${ui('rad')}"><b>${Math.round(inv.radRes() * 100)}%</b></span>`;
    wrap.appendChild(eqc);
    // ---- belt + backpack
    const left = el('div', 'inv-left');
    const beltBox = el('div', 'belt-box');
    const bh = el('div', 'lbl lbl-row'); bh.innerHTML = '<span>Belt</span><small class="dim">quick slots · <i class="inhand-key"></i> in hand</small>'; beltBox.appendChild(bh);
    beltBox.appendChild(this.grid(inv.belt, (i, s) => this.tapSlot(inv.belt, i, side), 'belt', this.sel));
    left.appendChild(beltBox);
    const bl = el('div', 'lbl lbl-row'); bl.appendChild(el('span', '', 'Backpack (' + inv.main.slots.length + ')')); bl.appendChild(stats);   // + what you wear adds up to
    const sb = el('button', 'mini', '⇅ Sort'); sb.onclick = () => { this.sel = null; if (!this.sortInv(inv.main)) this.toast('Too full to sort'); this.rebuild(); }; bl.appendChild(sb); left.appendChild(bl);
    left.appendChild(this.grid(inv.main, (i, s) => this.tapSlot(inv.main, i, side), 'main', this.sel));
    wrap.appendChild(left);
    // ---- the open box, then the item details
    const right = el('div', 'inv-right');
    if (side) {
      const box = el('div', 'side-box');
      const sl = el('div', 'lbl lbl-row'); sl.appendChild(el('span', '', side.title));
      const ss = el('button', 'mini', '⇅ Sort'); ss.onclick = () => { this.sel = null; if (this.sortInv(side.inv)) side.onChange && side.onChange(); this.rebuild(); }; sl.appendChild(ss); box.appendChild(sl);
      box.appendChild(this.grid(side.inv, (i, s) => this.tapSide(side, i), 'side', this.sel));
      const row = el('div', 'acts inv-acts');
      const ta = el('button', 'primary', 'Take all'); ta.onclick = () => { this.takeAll(side.inv); side.onChange && side.onChange(); }; row.appendChild(ta);
      if (!side.noDeposit) {
        const dp = el('button', '', 'Deposit all'); dp.onclick = () => { this.sel = null; this.deposit(side, false); this.rebuild(); this.refreshAll(); }; row.appendChild(dp);
        const sm = el('button', '', 'Stack matching'); sm.onclick = () => { this.sel = null; this.deposit(side, true); this.rebuild(); this.refreshAll(); }; row.appendChild(sm);
      }
      box.appendChild(row);
      right.appendChild(box);
      if (side.extra) side.extra(right);
    }
    right.appendChild(this.detail(side));
    wrap.appendChild(right);
    body.appendChild(wrap);
  },
  /** the selected stack if it is a gun */
  selGun() { const S = this.sel, g = S && S.inv.slots[S.i]; return g && WEAPONS[g.id] ? g : null; },
  /** put the item at inv[i] into an equipment slot ('helmet' | 'armor' | 'bag' | 'art0' | 'art1'); what was there goes back to inv[i] */
  equipFrom(inv, i, key) {
    const s = inv.slots[i], P = G.player.inv; if (!s || !eqAccepts(key, ITEMS[s.id])) return false;
    if (key.startsWith('art')) { const j = +key.slice(3) || 0; const old = P.arts[j]; P.arts[j] = s; inv.slots[i] = old || null; }
    else { const old = P.equip[key]; P.equip[key] = s; inv.slots[i] = old || null; }
    refreshLook(G.player); Sfx.pickup(); return true;
  },
  /** fit the attachment at inv[i] onto gun stack g; the one it replaces takes its place */
  fitAtt(inv, i, g) {
    const a = inv.slots[i]; if (!a || !g || !canAttach(g.id, a.id)) { Sfx.deny(); return false; }
    inv.slots[i] = null; const old = attachTo(g, a.id);
    if (old) inv.slots[i] = { id: old, n: 1 };
    this.attPick = null; refreshHeld(G.player); Sfx.craft(); this.toast(nm(a.id) + ' fitted' + (old ? ' (swapped for ' + nm(old) + ')' : ''), 'good');
    return true;
  },
  /** take the attachment in `slot` off gun stack g into the inventory (or onto the ground if full) */
  detachAtt(g, slot) {
    const p = G.player, P = p.inv; const id = detachFrom(g, slot); if (!id) return false;
    const W = WEAPONS[g.id], mag = gunMag(g);
    if ((g.ammo || 0) > mag) { const extra = g.ammo - mag; g.ammo = mag; const lo = P.add(g.ammoId || W.ammo, extra); if (lo) Live.dropItem(p.x, p.z, g.ammoId || W.ammo, lo); }   // the rounds an extended mag held
    if (P.add(id, 1)) { Live.dropItem(p.x, p.z, id, 1); this.toast('No room: dropped ' + nm(id)); }
    refreshHeld(p); Sfx.click(); return true;
  },
  /** stat rows for a stack: [label, value, text, better ('hi' | 'lo' | ''), bar max] */
  statRows(s) {
    const def = ITEMS[s.id]; if (!def) return [];
    const W = WEAPONS[s.id], R = [];
    if (W) {
      const F = attFx(s), pel = W.pellets || 1, hip = W.spread * F.hip * F.spread, ads = W.spread * 0.28 * F.ads * F.spread, acc = (v, ref) => Math.max(0, Math.round(100 * (1 - v / ref)));
      R.push(['Damage', W.dmg * pel, pel > 1 ? W.dmg + '×' + pel : String(W.dmg), 'hi', 130]);
      R.push(['Fire rate', Math.round(W.rof * 60), Math.round(W.rof * 60) + ' rpm', 'hi', 700]);
      if (!W.rocket) R.push(['Magazine', gunMag(s), String(gunMag(s)), 'hi', 60]);
      R.push(['Reload', +gunReload(s).toFixed(1), gunReload(s).toFixed(1) + ' s', 'lo', 6]);
      R.push(['Range', Math.round(W.range * F.range), Math.round(W.range * F.range) + ' m', 'hi', 100]);
      R.push(['Hip fire', acc(hip, 0.3), acc(hip, 0.3) + '%', 'hi', 100]);
      R.push(['Aimed', acc(ads, 0.08), acc(ads, 0.08) + '%' + (F.sight ? ' ' + F.zoom + 'x' : ''), 'hi', 100]);
      const k = gunKick(s); R.push(['Recoil', +(k * 1000).toFixed(0), k < 0.012 ? 'Low' : k < 0.03 ? 'Medium' : k < 0.055 ? 'High' : 'Heavy', 'lo', 80]);
      R.push(['Heard from', Math.round(W.noise * F.noise), Math.round(W.noise * F.noise) + ' m', 'lo', 80]);
    } else if (MELEE[s.id]) {
      const Mw = MELEE[s.id];
      R.push(['Damage', Mw.dmg, String(Mw.dmg), 'hi', 40], ['Swings / s', Mw.rate, Mw.rate.toFixed(1), 'hi', 2.4], ['Reach', Mw.reach, Mw.reach.toFixed(1) + ' m', 'hi', 2], ['Wood', Mw.wood, Math.round(Mw.wood * 100) + '%', 'hi', 2], ['Ore', Mw.ore, Math.round(Mw.ore * 100) + '%', 'hi', 2]);
    } else if (def.cat === 'armor' || def.cat === 'helmet') {
      R.push(['Armour', Math.round((def.armor || 0) * 100), Math.round((def.armor || 0) * 100) + '%', 'hi', 60]);
      R.push(['Radiation', Math.round((def.rad || 0) * 100), Math.round((def.rad || 0) * 100) + '%', 'hi', 75]);
      if (def.cat === 'helmet') R.push(['Head shots', Math.round((def.crit || 0) * 100), Math.round((def.crit || 0) * 100) + '%', 'hi', 100]);
      if (def.spd) R.push(['Speed', Math.round((def.spd - 1) * 100), Math.round((def.spd - 1) * 100) + '%', 'hi', 0]);
    } else if (def.cat === 'bag') R.push(['Extra slots', def.slots || 0, '+' + (def.slots || 0), 'hi', 18]);
    else if (def.use) {
      const u = def.use;
      if (u.hp) R.push(['Health', u.hp, (u.hp > 0 ? '+' : '') + u.hp, 'hi', 0]);
      if (u.food) R.push(['Food', u.food, (u.food > 0 ? '+' : '') + u.food, 'hi', 0]);
      if (u.water) R.push(['Water', u.water, (u.water > 0 ? '+' : '') + u.water, 'hi', 0]);
      if (u.rad) R.push(['Radiation', u.rad, String(u.rad), 'lo', 0]);
      if (u.bleed) R.push(['Bleeding', 1, 'Stops it', '', 0]);
      if (u.speed) R.push(['Speed boost', u.speed, u.speed + ' s', 'hi', 0]);
      R.push(['Takes', u.time, u.time.toFixed(1) + ' s', 'lo', 0]);
    } else if (def.cat === 'ammo') {
      const guns = Object.keys(WEAPONS).filter(g => WEAPONS[g].ammo === s.id || WEAPONS[g].alt === s.id).map(nm);
      const md = AMMO_MOD[s.id]; if (md) R.push(['Armour piercing', Math.round(md.pen * 100), '+' + Math.round(md.pen * 100) + '%', 'hi', 0]);
      if (guns.length) R.push(['Used by', 0, guns.join(', '), '', 0]);
    }
    if (def.val && !['res'].includes(def.cat)) R.push(['Value', def.val, Math.round(def.val) + ' scrap', '', 0]);
    return R;
  },
  /** what to compare a stack with: the gun / tool in hand, or the armour / bag worn in that slot */
  compareWith(s) {
    const p = G.player, def = ITEMS[s.id]; if (!def) return null;
    const held = heldStack(p);
    if (WEAPONS[s.id]) return held && held !== s && WEAPONS[held.id] ? held : null;
    if (MELEE[s.id]) return held && held !== s && MELEE[held.id] ? held : null;
    if (['armor', 'helmet', 'bag'].includes(def.cat)) { const w = p.inv.equip[def.cat]; return w && w !== s ? w : null; }
    return null;
  },
  /** a gun's attachment slots (tap a fitted one to take it off) and the attachments you carry that fit it */
  attPanel(g) {
    const box = el('div', 'att-panel'); const ok = attAllowed(g.id), P = G.player.inv;
    const hd = el('div', 'lbl lbl-row'); hd.innerHTML = '<span>Attachments</span><small class="dim">' + (g.att ? 'tap one to take it off' : 'drag or tap one in') + '</small>'; box.appendChild(hd);
    const row = el('div', 'att-slots');
    const GHOST = { sight: 'att_holo', muzzle: 'att_silencer', rail: 'att_flashlight', mag: 'att_extmag' };
    for (const slot of ATT_SLOTS) {
      const fits = ok.filter(a => ATTACH[a].slot === slot), cur = g.att && g.att[slot];
      const d = el('div', 'slot aslot' + (cur ? ' ' + rarCls(cur) : ' empty') + (fits.length ? '' : ' locked') + (this.attPick === slot ? ' picked' : '')); d.dataset.aslot = slot;
      d.innerHTML = (cur ? '<img src="' + ic(cur) + '">' : '<img class="ghost" src="' + ic(fits[0] || GHOST[slot]) + '">') + '<small>' + ATT_SLOT_NAME[slot] + '</small>';
      d.title = cur ? nm(cur) + ' — tap to take it off' : fits.length ? ATT_SLOT_NAME[slot] + ': ' + fits.map(nm).join(', ') : 'No ' + ATT_SLOT_NAME[slot].toLowerCase() + ' mount on this gun';
      d.onclick = () => { if (cur) this.detachAtt(g, slot); else if (fits.length) this.attPick = this.attPick === slot ? null : slot; this.rebuild(); };
      row.appendChild(d);
    }
    box.appendChild(row);
    const have = [];
    for (const v of [P.belt, P.main]) v.slots.forEach((q, i) => { if (q && ATTACH[q.id] && ok.includes(q.id) && (!this.attPick || ATTACH[q.id].slot === this.attPick)) have.push([v, i, q]); });
    if (have.length) {
      const hr = el('div', 'att-have');
      for (const [v, i, q] of have) { const e = this.slotEl(q, ' mini'); e.title = 'Fit ' + nm(q.id); e.onclick = () => { if (this.fitAtt(v, i, g)) this.rebuild(); }; hr.appendChild(e); }
      box.appendChild(hr);
    } else box.appendChild(el('div', 'dim small att-none', this.attPick ? 'You carry nothing for this slot.' : 'Takes: ' + ok.map(nm).join(', ') + '.'));
    return box;
  },
  detail(side) {
    const d = el('div', 'detail'); const s = this.sel && this.sel.inv.slots[this.sel.i];
    if (!s) { d.innerHTML = '<p class="dim">Tap an item to see what it does and compare it with what you hold. Tap another slot to move it there. Double-tap to send it ' + (side ? 'to the other side' : 'between belt and backpack') + '. Press and hold to drag (the places it can go light up).' + (side ? ' Tap items in the box to take them.' : ' Tap a gun to fit attachments.') + '</p>'; return d; }
    const def = ITEMS[s.id]; const p = G.player; const rar = def.rar || 'common';
    d.classList.add('r-' + rar);
    const held = heldStack(p) === s;
    let h = '<div class="dt-h"><div class="dt-ic ' + rarCls(s.id) + '"><img src="' + ic(s.id) + '"></div><div class="dt-t"><b class="' + rarCls(s.id) + '">' + def.name + (s.n > 1 ? ' ×' + s.n : '') + '</b>' +
      '<small><span class="rar ' + rarCls(s.id) + '">' + rar[0].toUpperCase() + rar.slice(1) + '</span> · ' + catName(def.cat).split(' — ')[0] + (held ? ' · <span class="good">in hand</span>' : '') + '</small></div></div>';
    if (def.desc) h += '<p class="dt-desc">' + def.desc + '</p>';
    const W = WEAPONS[s.id];
    if (W && !W.rocket && !W.arrow) h += '<div class="dt-load"><span>Loaded</span><i><u style="width:' + Math.min(100, (s.ammo || 0) / gunMag(s) * 100) + '%"></u></i><b>' + (s.ammo || 0) + ' / ' + gunMag(s) + '</b><small>' + nm(s.ammoId || W.ammo) + '</small></div>';
    // stats, with the difference to what you hold / wear (a gun's attachment slots go in between, near the top)
    const rows = this.statRows(s), cmp = this.compareWith(s), cr = cmp ? this.statRows(cmp) : null;
    if (W && attAllowed(s.id).length) h += '<div class="att-mount"></div>';
    if (rows.length) {
      h += '<div class="dt-stats">' + (cmp ? '<div class="dt-vs">vs ' + nm(cmp.id) + '</div>' : '');
      for (const [label, v, txt, dir, max] of rows) {
        let delta = '';
        const o = cr && cr.find(r => r[0] === label);
        if (o && dir && Math.abs(v - o[1]) > 1e-6) { const dv = v - o[1], good = dir === 'hi' ? dv > 0 : dv < 0; delta = '<em class="' + (good ? 'good' : 'bad') + '">' + (good ? '▲' : '▼') + '</em>'; }
        const bar = max > 0 ? '<i><u style="width:' + clamp(v / max, 0.03, 1) * 100 + '%"></u>' + (o && max > 0 ? '<s style="left:' + clamp(o[1] / max, 0, 1) * 100 + '%"></s>' : '') + '</i>' : '';
        h += '<div class="st-r' + (bar ? '' : ' nobar') + '"><span>' + label + '</span>' + bar + '<b>' + txt + '</b>' + delta + '</div>';
      }
      h += '</div>';
    }
    // an attachment: what it does and which of your guns it fits
    if (def.cat === 'att' && ATTACH[s.id]) {
      const A = ATTACH[s.id], fx = [], pc = m => (m > 1 ? '+' : '−') + Math.round(Math.abs(m - 1) * 100) + '%';
      if (A.zoom) fx.push(['good', A.zoom + 'x zoom when aiming']);
      if (A.ads) fx.push([A.ads < 1 ? 'good' : 'bad', 'Aimed spread ' + pc(A.ads)]);
      if (A.hip) fx.push([A.hip < 1 ? 'good' : 'bad', 'Hip-fire spread ' + pc(A.hip)]);
      if (A.spread) fx.push([A.spread < 1 ? 'good' : 'bad', 'Spread ' + pc(A.spread)]);
      if (A.recoil) fx.push([A.recoil < 1 ? 'good' : 'bad', 'Recoil ' + pc(A.recoil)]);
      if (A.noise) fx.push(['good', 'Heard ' + pc(A.noise) + ' as far away']);
      if (A.flash === 0) fx.push(['good', 'No muzzle flash']);
      if (A.range) fx.push([A.range > 1 ? 'good' : 'bad', 'Range ' + pc(A.range)]);
      if (A.mag) fx.push(['good', 'Magazine ' + pc(A.mag)]);
      if (A.reload) fx.push([A.reload < 1 ? 'good' : 'bad', 'Reload time ' + pc(A.reload)]);
      if (A.laser) fx.push(['good', 'Red laser dot on the target']);
      if (A.light) fx.push(['good', 'Bright beam at night']);
      h += '<div class="att-fx"><small class="dim">' + ATT_SLOT_NAME[A.slot] + ' attachment</small>' + fx.map(([c, t]) => '<span class="' + c + '">' + t + '</span>').join('') + '</div>';
      const mine = p.inv.all().filter(q => WEAPONS[q.id] && canAttach(q.id, s.id));
      const fitsAll = Object.keys(WEAPONS).filter(g => canAttach(g, s.id)).map(nm);
      h += '<p class="dim small">Fits: ' + fitsAll.join(', ') + '.</p>';
      d.innerHTML = h;
      if (mine.length) {
        const row = el('div', 'acts');
        for (const g of mine.slice(0, 3)) { const b = el('button', 'primary', 'Fit to ' + nm(g.id)); b.onclick = () => { const v = this.sel.inv, i = this.sel.i; if (this.fitAtt(v, i, g)) { const where = [p.inv.belt, p.inv.main].find(x => x.slots.includes(g)); this.sel = where ? { inv: where, i: where.slots.indexOf(g), t: 0 } : null; } this.rebuild(); }; row.appendChild(b); }
        d.appendChild(row);
      }
    } else d.innerHTML = h;
    // a gun: its attachment slots
    const am = d.querySelector('.att-mount'); if (am) am.replaceWith(this.attPanel(s));
    // actions
    const acts = el('div', 'acts'); const A = (label, fn, cls) => { const b = el('button', cls || '', label); b.onclick = () => { fn(); this.rebuild(); }; acts.appendChild(b); return b; };
    const inv = this.sel.inv, i = this.sel.i;
    if (def.use) A('Use', () => { useItem(p, inv, i); this.sel = null; }, 'primary');
    if (['armor', 'helmet', 'bag'].includes(def.cat)) A('Equip', () => { this.equipFrom(inv, i, def.cat); this.sel = null; }, 'primary');
    if (def.cat === 'art') A('Equip', () => { const k = p.inv.arts[0] ? (p.inv.arts[1] ? 0 : 1) : 0; this.equipFrom(inv, i, 'art' + k); this.sel = null; }, 'primary');
    if (def.cat === 'bp') A('Learn', () => { if (!G.run.bps.includes(def.teach)) { G.run.bps.push(def.teach); this.toast('Learned ' + nm(RECIPE[def.teach].out), 'good'); Sfx.win(); } inv.slots[i] = null; this.sel = null; }, 'primary');
    if (W && (s.ammo || 0) > 0) A('Unload', () => { p.inv.add(s.ammoId || W.ammo, s.ammo); s.ammo = 0; });
    if (W && s.att) A('Strip attachments', () => { for (const k of ATT_SLOTS) if (s.att && s.att[k]) this.detachAtt(s, k); });
    if (s.n > 1) {
      const split = h2 => { const k = inv.slots.indexOf(null); if (k < 0) { this.toast('No empty slot'); return; } s.n -= h2; inv.slots[k] = { id: s.id, n: h2 }; };
      A('Split ½', () => split(Math.floor(s.n / 2))); A('Take 1', () => split(1));
    }
    if (side) A('Move →', () => { const left = side.inv.addStack(s); inv.slots[i] = left; this.sel = null; side.onChange && side.onChange(); });
    A('Drop', () => { Live.dropItem(p.x + Math.cos(p.ang), p.z + Math.sin(p.ang), s.id, s.n, stackExtra(s)); inv.slots[i] = null; this.sel = null; refreshHeld(p); }, 'danger');
    d.appendChild(acts);
    // split any amount off with a slider
    if (s.n > 2) {
      const sp = el('div', 'split'); const r = document.createElement('input'); r.type = 'range'; r.min = 1; r.max = s.n - 1; r.value = Math.floor(s.n / 2); r.setAttribute('aria-label', 'How many to split off');
      const go = el('button', 'mini', 'Split off ' + r.value);
      r.oninput = () => { go.textContent = 'Split off ' + r.value; };
      go.onclick = () => { const k = inv.slots.indexOf(null); if (k < 0) { this.toast('No empty slot'); return; } const n = clamp(+r.value | 0, 1, s.n - 1); s.n -= n; inv.slots[k] = { id: s.id, n }; Sfx.click(); this.rebuild(); };
      sp.appendChild(r); sp.appendChild(go); d.appendChild(sp);
    }
    return d;
  },
  tapSlot(inv, i, side) {
    const s = inv.slots[i];
    if (this.sel && (this.sel.inv !== inv || this.sel.i !== i)) {
      const a = this.sel.inv.slots[this.sel.i];
      // attachments: an attachment then a gun it fits (or a gun then an attachment for it) fits it
      if (a && s && ATTACH[a.id] && WEAPONS[s.id] && canAttach(s.id, a.id)) { this.fitAtt(this.sel.inv, this.sel.i, s); this.sel = { inv, i, t: 0 }; this.rebuild(); if (side && side.onChange) side.onChange(); return; }
      if (a && s && WEAPONS[a.id] && ATTACH[s.id] && canAttach(a.id, s.id)) { this.fitAtt(inv, i, a); this.rebuild(); if (side && side.onChange) side.onChange(); return; }
      // move / swap / merge
      this.moveSlot(this.sel.inv, this.sel.i, inv, i);
      this.sel = null; Sfx.click(); refreshHeld(G.player); this.rebuild(); if (side && side.onChange) side.onChange(); return;
    }
    if (this.sel && this.sel.inv === inv && this.sel.i === i) {
      if (performance.now() - (this.sel.t || 0) < 420) this.quickMove(inv, i, side); // double tap: quick move
      this.sel = null; refreshHeld(G.player); this.rebuild(); this.refreshAll(); return;
    }
    if (s) { this.sel = { inv, i, t: performance.now() }; this.attPick = null; Sfx.click(); this.rebuild(); }
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
    const extra = d.type === 'tc' ? (right) => {
      // upkeep: what the base costs per day, how long the stock lasts, and whether it is decaying
      const u = Build.upkeep(d); const box = el('div', 'upkeep'); const res = Object.keys(u.perDay);
      const days = v => v >= 99 ? '99+ days' : v >= 2 ? Math.floor(v) + ' days' : v >= 1 ? '1 day ' + Math.round((v - 1) * 24) + ' h' : Math.max(0, Math.round(v * 24)) + ' h';
      const dying = res.some(k => d.inv.count(k) < 1) || (d.state.unpaid && d.state.unpaid.length);
      let h = '<b>Upkeep</b> <small>' + u.pieces + ' pieces protected</small>';
      if (!res.length) h += '<div class="dim small">Nothing to keep up yet.</div>';
      else {
        h += '<div class="uk-l ' + (dying ? 'bad' : u.lasts < 1 ? 'warn' : 'good') + '">' + (dying ? 'Not enough materials — your base is decaying!' : 'Lasts ' + days(u.lasts)) + '</div>';
        for (const k of res) { const have = d.inv.count(k), per = u.perDay[k]; h += '<div class="uk-r"><span>' + nm(k) + '</span><span>' + Math.ceil(per) + ' / day</span><span>' + have + ' stored · ' + days(have / per) + '</span></div>'; }
      }
      h += '<p class="dim small">Every day the cupboard takes a share of what the base cost to build: wood for wood and twig, stone for stone, metal fragments for sheet metal, HQM for armored (doors and high walls count too). The share grows with the base: 6% for the first 12 pieces, 10% up to 40, 15% up to 100, 22% beyond. If it runs dry the base decays, twig first.</p>';
      box.innerHTML = h; right.appendChild(box);
      if (d.owner === 'player') right.appendChild(el('p', 'dim small', 'Your claim: resources stored here feed turrets, building and upkeep. If the cupboard is destroyed, the land is unclaimed and the base starts to decay.'));
    } : null;
    this.openInventory({ inv: d.inv, title, extra });
  },
  openOven(d) {
    const O = OVENS[DEPLOY[d.type].oven];
    this.openInventory({
      inv: d.inv, noDeposit: true, title: DEPLOY[d.type].name + (d.state.lit ? ' (burning)' : ''), extra: right => {
        const b = el('button', d.state.lit ? 'danger' : 'primary', d.state.lit ? 'Extinguish' : 'Light it'); b.onclick = () => { if (!d.state.lit && d.inv.count(O.fuel) <= 0) { this.toast('Add ' + nm(O.fuel) + ' as fuel'); return; } d.state.lit = !d.state.lit; Sfx.click(); this.rebuild(); }; right.appendChild(b);
        const q = el('div', 'quick'); q.appendChild(el('span', 'dim small', 'Quick add: '));
        const add = id => { const b2 = el('button', 'mini', '+' + nm(id)); b2.onclick = () => { const n = G.player.inv.count(id); if (!n) return; const k = Math.min(n, d.inv.room(id)); G.player.inv.take(id, k); d.inv.add(id, k); this.rebuild(); }; q.appendChild(b2); };
        for (const k of [O.fuel, ...Object.keys(O.cooks).filter(k => k !== O.fuel)]) if (G.player.inv.count(k)) add(k);
        right.appendChild(q);
        right.appendChild(el('p', 'dim small', d.type === 'furnace' ? 'Burns wood. Smelts metal ore → metal fragments, sulfur ore → sulfur, HQ ore → HQ metal, wood → charcoal.' : 'Burns wood. Cooks raw meat and fish; makes charcoal.'));
      },
    });
    this.sheetRefresh = () => this.rebuild();
  },
  // ---------------------------------------------------------------- crafting
  openCraft(cat) {
    const p = G.player; if (!p || p.dead) return; this.craftCat = cat || this.craftCat || 'all';
    this.openSheet('Craft', body => {
      const wb = Build.wbTier(p.x, p.z);
      const cats = [['all', 'All'], ['tools', 'Tools'], ['weapons', 'Weapons'], ['att', 'Attachments'], ['ammo', 'Ammo & Explosives'], ['gear', 'Clothing'], ['med', 'Medical & Food'], ['res', 'Resources']];
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
      // sell valuables (and whatever else this vendor deals in, e.g. the fishmonger buys fish at full value)
      const special = id => !!(S.buys && S.buys.includes(id));
      const sell = p.inv.all().filter(s => ITEMS[s.id] && (ITEMS[s.id].cat === 'val' || special(s.id)));
      if (sell.length) {
        body.appendChild(el('div', 'lbl', S.buys ? 'Sell your catch & valuables' : 'Sell valuables'));
        const l2 = el('div', 'recipes'); const seen = new Set();
        for (const s of sell) { if (seen.has(s.id)) continue; seen.add(s.id); const n = p.inv.count(s.id), v = Math.max(1, Math.round(ITEMS[s.id].val * (special(s.id) ? (S.rate || 1) : 0.5))); const row = el('div', 'rec'); row.innerHTML = `<img src="${ic(s.id)}"><div class="rt"><b>${nm(s.id)} ×${n}</b><small>${v} scrap each</small></div>`; const b = el('button', 'primary', 'Sell all'); b.onclick = () => { const k = p.inv.take(s.id, n); give(p, 'scrap', k * v); Sfx.pickup(); this.rebuild(); }; row.appendChild(b); l2.appendChild(row); }
        body.appendChild(l2);
      }
    });
  },
  // ---------------------------------------------------------------- map
  openMap() {
    // the big map: a calm base map, one icon shape + colour per kind of place, layers you can switch, zoom + pan
    const CAT = { haven: 'safe', fishvillage: 'safe', reactor: 'reactor', fort: 'outlaw', cave: 'nature', deepcave: 'nature', arch: 'nature', spires: 'nature' };
    const catOf = m => CAT[m.type] || ((MONUMENTS[m.type].tier || 0) >= 2 ? 'mil' : 'loot');
    const CARD = { green: '#5fd068', blue: '#4aa8ff', red: '#ff5a4a' };
    const icon = (g, cat, x, y, sc = 1, card) => {
      g.save(); g.translate(x, y); g.scale(sc, sc); g.lineWidth = 1.4; g.strokeStyle = '#120c10';
      if (cat === 'safe') { g.fillStyle = '#3fae54'; g.beginPath(); g.arc(0, 0, 6, 0, 7); g.fill(); g.stroke(); g.fillStyle = '#fff'; g.fillRect(-1.4, -4, 2.8, 8); g.fillRect(-4, -1.4, 8, 2.8); }
      else if (cat === 'reactor') { g.fillStyle = '#ffd23a'; g.beginPath(); g.arc(0, 0, 6.5, 0, 7); g.fill(); g.stroke(); g.fillStyle = '#120c10'; for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 5, k * 2.094 - 0.5, k * 2.094 + 0.5); g.closePath(); g.fill(); } g.fillStyle = '#ffd23a'; g.beginPath(); g.arc(0, 0, 1.4, 0, 7); g.fill(); }
      else if (cat === 'mil') { g.fillStyle = '#e8743a'; g.beginPath(); g.moveTo(0, -7); g.lineTo(6.5, 0); g.lineTo(0, 7); g.lineTo(-6.5, 0); g.closePath(); g.fill(); g.stroke(); if (card) { g.fillStyle = CARD[card] || '#fff'; g.beginPath(); g.arc(0, 0, 2.4, 0, 7); g.fill(); g.lineWidth = 0.8; g.stroke(); } }
      else if (cat === 'outlaw') { g.fillStyle = '#7a1f1a'; g.fillRect(-5, -5, 10, 10); g.strokeRect(-5, -5, 10, 10); g.strokeStyle = '#ffd0c8'; g.lineWidth = 1.8; g.beginPath(); g.moveTo(-3, -3); g.lineTo(3, 3); g.moveTo(3, -3); g.lineTo(-3, 3); g.stroke(); }
      else if (cat === 'nature') { g.fillStyle = '#9a7650'; g.beginPath(); g.moveTo(0, -6); g.lineTo(6, 5); g.lineTo(-6, 5); g.closePath(); g.fill(); g.stroke(); }
      else { g.fillStyle = '#f2e6c8'; g.beginPath(); g.roundRect ? g.roundRect(-4.5, -4.5, 9, 9, 2) : g.rect(-4.5, -4.5, 9, 9); g.fill(); g.stroke(); g.fillStyle = '#5a4a3a'; g.fillRect(-1.5, -1.5, 3, 3); }
      g.restore();
    };
    let L; try { L = JSON.parse(localStorage.getItem('zf_map_layers') || 'null'); } catch (e) { L = null; }
    L = Object.assign({ names: true, vehicles: false, transport: true, events: true }, L || {});
    this.openSheet('Map', body => {
      const land = innerWidth > innerHeight;
      const S = Math.max(220, Math.min(innerHeight - (land ? 64 : 150), innerWidth - (land ? 214 : 40), 900));
      if (!G.mapCanvasHi || G.mapCanvasHi.src !== G.mapCanvas) { try { G.mapCanvasHi = buildMapCanvas(G.W, 1024); G.mapCanvasHi.src = G.mapCanvas; } catch (e) { G.mapCanvasHi = G.mapCanvas; } }
      const wrap = el('div', 'mapwrap'); body.appendChild(wrap);
      const c = el('canvas', 'bigmap'); c.width = S * 2; c.height = S * 2; c.style.width = S + 'px'; c.style.height = S + 'px'; c.style.touchAction = 'none'; wrap.appendChild(c);
      const side = el('div', 'mapside'); wrap.appendChild(side);
      const g = c.getContext('2d'); const view = { zoom: 1, cx: WORLD / 2, cz: WORLD / 2 };
      const ZOOMS = [1, 2, 4];
      const draw = () => {
        const z = view.zoom, span = WORLD / z; view.cx = clamp(view.cx, span / 2, WORLD - span / 2); view.cz = clamp(view.cz, span / 2, WORLD - span / 2);
        const ox = view.cx - span / 2, oz = view.cz - span / 2, k = S / span;
        const X = x => (x - ox) * k, Y = y => (y - oz) * k, on = (x, y, m = 0) => x > -m && y > -m && x < S + m && y < S + m;
        g.setTransform(2, 0, 0, 2, 0, 0); g.clearRect(0, 0, S, S);
        const mc = G.mapCanvasHi || G.mapCanvas, r = mc.width / WORLD; g.imageSmoothingEnabled = true; g.drawImage(mc, ox * r, oz * r, span * r, span * r, 0, 0, S, S);
        g.textAlign = 'center';
        const rects = [];
        const label = (text, x, y, font, color, force, overIcons) => {
          if (!on(x, y, 30)) return; g.font = font; const w = g.measureText(text).width + 4, h = 12, R = [x - w / 2, y - h + 2, x + w / 2, y + 3];
          if (!force && rects.some(q => (!overIcons || !q.icon) && R[0] < q[2] && R[2] > q[0] && R[1] < q[3] && R[3] > q[1])) return;
          rects.push(R); g.lineWidth = 3; g.strokeStyle = 'rgba(18,12,16,.78)'; g.strokeText(text, x, y); g.fillStyle = color; g.fillText(text, x, y);
        };
        const isc = Math.min(1.5, 0.85 + z * 0.17);
        const mons = G.monuments.slice().sort((a, b) => ['safe', 'reactor', 'mil', 'outlaw', 'loot', 'nature'].indexOf(catOf(a)) - ['safe', 'reactor', 'mil', 'outlaw', 'loot', 'nature'].indexOf(catOf(b)));
        // icons first, so labels can be laid out around them
        for (const m of mons) { const x = X(m.x), y = Y(m.z); if (!on(x, y, 8)) continue; icon(g, catOf(m), x, y, isc, MONUMENTS[m.type].card); const ir = [x - 7 * isc, y - 7 * isc, x + 7 * isc, y + 7 * isc]; ir.icon = true; rects.push(ir); }
        if (L.transport && G.train) {
          for (const st of G.train.stations) { const x = X(st.x), y = Y(st.z); if (!on(x, y, 6)) continue; g.fillStyle = '#ffc928'; g.strokeStyle = '#2a2420'; g.lineWidth = 1.5; g.fillRect(x - 3.5, y - 3.5, 7, 7); g.strokeRect(x - 3.5, y - 3.5, 7, 7); }
          const T = G.train.mapInfo(); g.save(); g.translate(X(T.x), Y(T.z)); g.rotate(T.ang); g.fillStyle = '#d8432f'; g.strokeStyle = '#120c10'; g.lineWidth = 2; g.fillRect(-9, -4, 18, 8); g.strokeRect(-9, -4, 18, 8); g.restore();
          if (G.cargo) { const C = G.cargo.mapInfo(); g.save(); g.translate(X(C.x), Y(C.z)); g.rotate(C.ang); g.fillStyle = '#2f6fb0'; g.strokeStyle = '#120c10'; g.lineWidth = 2; g.beginPath(); g.moveTo(14, 0); g.lineTo(6, -5); g.lineTo(-12, -5); g.lineTo(-12, 5); g.lineTo(6, 5); g.closePath(); g.fill(); g.stroke(); g.restore(); }
        }
        if (L.vehicles && G.vehicles) for (const m of G.vehicles.markers()) { const x = X(m.x), y = Y(m.z); if (!on(x, y, 6)) continue; g.strokeStyle = '#120c10'; g.lineWidth = 1.2;
          if (m.kind === 'heli') { g.fillStyle = '#ff8a1e'; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); g.stroke(); }
          else if (m.boat) { g.fillStyle = m.kind === 'motorboat' ? '#4ac0ff' : '#f0d890'; g.save(); g.translate(x, y); g.rotate(m.yaw || 0); g.beginPath(); g.moveTo(5, 0); g.lineTo(-4, -3); g.lineTo(-4, 3); g.closePath(); g.fill(); g.stroke(); g.restore(); }
          else if (m.kind === 'horse') { g.fillStyle = '#c8945a'; g.beginPath(); g.arc(x, y, 2.8, 0, 7); g.fill(); g.stroke(); }
          else { g.fillStyle = '#2bb3a8'; g.fillRect(x - 2.8, y - 2.8, 5.6, 5.6); g.strokeRect(x - 2.8, y - 2.8, 5.6, 5.6); } }
        // events
        if (L.events) {
          const pulse = (x, y, col, txt) => { if (!on(x, y, 10)) return; g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 9, 0, 7); g.stroke(); g.fillStyle = col; g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.fill(); label(txt, x, y - 12, '800 10px system-ui', col, true); };
          if (G.airdrop && G.airdrop.phase !== 'fly') pulse(X(G.airdrop.x), Y(G.airdrop.z), '#ff7050', 'Airdrop');
          const LC = G.events && G.events.lockedCrate; if (LC && LC.phase !== 'done') pulse(X(LC.x), Y(LC.z), '#ffd23a', 'Locked crate');
          for (const a of G.actors) if (a.heli && a.type === 'heli' && !a.dead) pulse(X(a.x), Y(a.z), '#ff4a3a', 'Attack heli');
          if (G.cargo && L.transport) { const C = G.cargo.mapInfo(); label('Cargo ship', X(C.x), Y(C.z) - 11, 'bold 10px system-ui', '#cfe6ff', true); }
        }
        // you and yours
        for (const d of Build.deploys) if (d.owner === 'player' && (d.type === 'sleeping_bag' || d.type === 'bed')) { g.fillStyle = '#80c0ff'; g.strokeStyle = '#120c10'; g.lineWidth = 1; g.fillRect(X(d.x) - 3, Y(d.z) - 3, 6, 6); g.strokeRect(X(d.x) - 3, Y(d.z) - 3, 6, 6); }
        if (Build.tc) { const x = X(Build.tc.x), y = Y(Build.tc.z); g.fillStyle = '#7ad070'; g.strokeStyle = '#120c10'; g.lineWidth = 1.5; g.fillRect(x - 5, y - 5, 10, 10); g.strokeRect(x - 5, y - 5, 10, 10); label('BASE', x, y + 16, '800 10px system-ui', '#9ff090', true); }
        if (G.deathBag && G.drops.includes(G.deathBag)) { g.fillStyle = '#fff'; g.font = '800 13px system-ui'; g.fillText('✝', X(G.deathBag.x), Y(G.deathBag.z) + 4); }
        if (G.net && G.net.players) for (const pl of G.net.players.values()) if (pl.actor) { const x = X(pl.actor.x), y = Y(pl.actor.z); g.fillStyle = '#ffd23a'; g.strokeStyle = '#120c10'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); g.stroke(); label(pl.name, x, y - 8, '800 10px system-ui', '#ffe680', true); }
        // names: the big sites always, the rest once you zoom in (and only where they fit)
        if (L.names) {
          for (const m of mons) { const cat = catOf(m); if (z < 2 && !(cat === 'safe' || cat === 'reactor' || cat === 'mil')) continue; label(m.name, X(m.x), Y(m.z) - 9 - 7 * isc, '700 10px system-ui', cat === 'mil' ? '#ffd2b0' : cat === 'safe' ? '#c8ffc8' : '#fff', false, cat === 'safe' || cat === 'reactor' || cat === 'mil'); }
          if (L.transport && G.train && z >= 2) for (const st of G.train.stations) label(st.name, X(st.x), Y(st.z) + 14, 'italic 800 10px system-ui', '#ffc928', false);
        }
        const p = G.player; g.save(); g.translate(X(p.x), Y(p.z)); g.rotate(p.ang); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(9, 0); g.lineTo(-6, 6); g.lineTo(-3, 0); g.lineTo(-6, -6); g.closePath(); g.fill(); g.stroke(); g.restore();
        zlab.textContent = z + '×';
      };
      // zoom: buttons, tap to zoom in on a spot, drag to pan when zoomed
      const zoomTo = (nz, wx, wz) => { view.zoom = nz; if (wx !== undefined) { view.cx = wx; view.cz = wz; } if (nz === 1) { view.cx = view.cz = WORLD / 2; } draw(); };
      let down = null, moved = false;
      c.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz }; moved = false; c.setPointerCapture && c.setPointerCapture(e.pointerId); });
      c.addEventListener('pointermove', e => { if (!down || view.zoom === 1) return; const dx = e.clientX - down.x, dy = e.clientY - down.y; if (Math.hypot(dx, dy) > 6) moved = true; if (!moved) return; const sc = (WORLD / view.zoom) / S; view.cx = down.cx - dx * sc; view.cz = down.cz - dy * sc; draw(); });
      c.addEventListener('pointerup', e => { if (!down) return; const was = down; down = null; if (moved) return; const rc = c.getBoundingClientRect(), u = (e.clientX - rc.left) / rc.width, v = (e.clientY - rc.top) / rc.height; const span = WORLD / view.zoom, wx = view.cx - span / 2 + u * span, wz = view.cz - span / 2 + v * span; void was;
        const zi = ZOOMS.indexOf(view.zoom); zoomTo(ZOOMS[(zi + 1) % ZOOMS.length], wx, wz); Sfx.ui && Sfx.ui(); });
      const zrow = el('div', 'mapzoom'); side.appendChild(zrow);
      const zb = (t, f) => { const b = el('button', 'mini', t); b.onclick = f; zrow.appendChild(b); return b; };
      zb('−', () => { const zi = ZOOMS.indexOf(view.zoom); if (zi > 0) zoomTo(ZOOMS[zi - 1]); }); const zlab = el('span', 'zlab', '1×'); zrow.appendChild(zlab); zb('+', () => { const zi = ZOOMS.indexOf(view.zoom); if (zi < ZOOMS.length - 1) zoomTo(ZOOMS[zi + 1], G.player.x, G.player.z); });
      zb('◎', () => zoomTo(Math.max(2, view.zoom), G.player.x, G.player.z));
      side.appendChild(el('div', 'maphint', 'Tap to zoom · drag to move'));
      // layers
      const lay = el('div', 'maplayers'); side.appendChild(lay);
      for (const [key, name] of [['names', 'Names'], ['transport', 'Train & ship'], ['events', 'Events'], ['vehicles', 'Vehicles']]) {
        const b = el('button', 'chip' + (L[key] ? ' on' : ''), name); b.onclick = () => { L[key] = !L[key]; b.classList.toggle('on', L[key]); try { localStorage.setItem('zf_map_layers', JSON.stringify(L)); } catch (e) { } draw(); }; lay.appendChild(b);
      }
      // legend with the real icons
      const leg = el('div', 'legend'); side.appendChild(leg);
      for (const [cat, name, card] of [['safe', 'Safe zone'], ['loot', 'Loot site'], ['mil', 'Military (keycard)', 'green'], ['reactor', 'Reactor'], ['outlaw', 'Outlaw fort'], ['nature', 'Cave / rocks']]) {
        const row = el('div', 'legrow'); const ic = el('canvas'); ic.width = ic.height = 36; ic.style.width = ic.style.height = '18px'; const gg = ic.getContext('2d'); gg.scale(2, 2); icon(gg, cat, 9, 9, 1, card); row.appendChild(ic); row.appendChild(el('span', '', name)); leg.appendChild(row);
      }
      draw();
    }, { cls: 'mapsheet' });
  },
  // ---------------------------------------------------------------- build mode
  toggleBuild() {
    const p = G.player; if (!p || p.dead) return;
    if (p.vehicle && !G.buildMode) { this.toast('Get out to build'); return; }
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
      b.innerHTML = '<img src="' + glyphURL(t) + '"><span>' + (def.name || t) + '</span><small>' + Object.entries(cost).map(([k, v]) => '<i>' + v + ' ' + shortName(k) + '</i>').join(' ') + '</small>'; // one chip per resource: they wrap instead of running off the button
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
    if ((DEPLOY[bm.type] && !DEPLOY[bm.type].ladder) || bm.type === 'stairs') { const r = el('button', '', '⟳ Rotate'); r.onclick = () => { bm.ry = (bm.ry + Math.PI / 2) % (Math.PI * 2); }; row.appendChild(r); }
    const pl = el('button', 'primary place', 'PLACE'); pl.onclick = () => this.placeAtCursor(); row.appendChild(pl);
    bar.appendChild(row);
    const d = PIECES[bm.type] || DOORS[bm.type] || HIGHWALLS[bm.type] || DEPLOY[bm.type];
    bar.appendChild(el('div', 'bhint', (d && d.desc ? d.desc + ' ' : '') + (Input.touchMode ? 'Look where you want it · FIRE places it.' : 'Look where you want it · click places · R rotates.')));
  },
  catItems(cat) {
    if (cat === 'build') return [...PIECE_ORDER, 'ladder'];
    if (cat === 'doors') return ['door_wood', 'door_metal', 'door_armored'];
    if (cat === 'walls') return ['highwall_wood', 'highwall_stone', 'gate_wood', 'gate_stone'];
    if (cat === 'defense') return ['spikes', 'landmine', 'shotgun_trap', 'auto_turret', 'floodlight'];
    return DEPLOY_ORDER.filter(t => !['spikes', 'landmine', 'shotgun_trap', 'auto_turret', 'floodlight', 'ladder'].includes(t));
  },
  buildTick(dt) {
    const bm = G.buildMode; const p = G.player; if (!bm || !p) return;
    if (Input.pressed.rotate || (Input.pressed.reload && !bm.hammer)) bm.ry = (bm.ry + Math.PI / 2) % (Math.PI * 2);
    if (Input.pressed.hammer) { bm.hammer = !bm.hammer; this.hamSel = null; this.renderBuildBar(); }
    // first person: build where the crosshair meets the ground or a floor
    const lp = lookPoint(p, bm.hammer ? 6 : 10); bm.cursor = { x: lp.x, z: lp.z, y: lp.y };
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
    for (const pc of Build.allPieces()) {
      if (pc.owner !== 'player') continue; const [cx, cz] = Build.pieceXZ(pc);
      if (pc.edge) test(pc, cx, (pc.base ?? pc.level) + 1.3, cz, 1.3);
      else if (pc.type === 'foundation' || pc.type === 'tri_foundation') test(pc, cx, pc.level + 0.5, cz, pc.tk ? 1.0 : 1.4);
      else if (pc.type === 'stairs') test(pc, cx, pc.base + 1.4, cz, 1.3);
      else test(pc, cx, pc.base + 2.7, cz, pc.tk ? 1.0 : 1.4);
    }
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
    const t = Build.target(bm.type, bm.cursor.x, bm.cursor.z, bm.ry, bm.cursor.y);
    const r = tryPlace(p, bm.type, t, bm.tier);
    if (r) this.renderBuildBar();
  },
  placeLine(L) {
    const bm = G.buildMode; const p = G.player; const n = Math.max(1, Math.ceil(dist(L.x0, L.z0, L.x1, L.z1) / 1.5)); const done = new Set(); let placed = 0;
    for (let i = 0; i <= n; i++) {
      const x = L.x0 + (L.x1 - L.x0) * i / n, z = L.z0 + (L.z1 - L.z0) * i / n;
      const t = Build.target(bm.type, x, z, bm.ry, bm.cursor ? bm.cursor.y : undefined); const key = JSON.stringify(t); if (done.has(key)) continue; done.add(key);
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
    const t = Build.target(bm.type, bm.cursor.x, bm.cursor.z, bm.ry, bm.cursor.y); const chk = Build.check(bm.type, t);
    const lad = DEPLOY[bm.type] && DEPLOY[bm.type].ladder;
    const key = bm.type + '|' + bm.tier + (lad && !t.none ? '|' + Math.round((t.top - t.y0) * 10) : '');
    if (!this.ghost || this.ghost.key !== key) { this.clearGhost(); this.ghost = { key, obj: lad && !t.none && GM && GM.makeLadder ? ghostify(GM.makeLadder(t.top - t.y0)) : makeGhost(bm.type, bm.tier) }; G.scene.add(this.ghost.obj); }
    const o = this.ghost.obj; const ok = chk.ok && canAfford(G.player, Build.costOf(bm.type, bm.tier));
    setGhostColor(o, ok);
    const pose = Build.ghostPose(bm.type, t);
    if (pose) { o.position.set(pose.x, pose.y, pose.z); o.rotation.y = pose.ry; if (bm.type === 'foundation' && chk.level !== undefined) o.position.y = chk.level; }
    else if (t.none) { o.position.set(bm.cursor.x, Build.floorY(bm.cursor.x, bm.cursor.z, bm.cursor.y), bm.cursor.z); }
    else if (lad) { o.position.set(t.x, t.y0, t.z); o.rotation.y = -t.ry; }
    else { o.position.set(t.x, Build.floorY(t.x, t.z, bm.cursor.y), t.z); o.rotation.y = -bm.ry; }
    const hint = $('#bwhy'); const why = !chk.ok ? chk.why : !ok ? 'Not enough resources' : ''; if (hint._w !== why) { hint._w = why; hint.textContent = why; hint.classList.toggle('hidden', !why); }
  },
  clearGhost() { if (this.ghost) { G.scene.remove(this.ghost.obj); this.ghost = null; } const h = $('#bwhy'); if (h) h.classList.add('hidden'); },
  hammerPick(x, z) {
    if (x === undefined) { this.hamSel = this.hammerTarget(G.player); this.renderBuildBar(); return; }
    let best = null, bd = 2.2 * 2.2;
    const consider = (o, ox, oz) => { const d = (ox - x) ** 2 + (oz - z) ** 2; if (d < bd) { bd = d; best = o; } };
    for (const p of Build.allPieces()) if (p.owner === 'player') { const [cx, cz] = Build.pieceXZ(p); consider(p, cx, cz); }
    for (const d of G.doors) if (d.owner === 'player') consider(d, d.x, d.z);
    for (const d of Build.deploys) if (d.owner === 'player') consider(d, d.x, d.z);
    this.hamSel = best; this.renderBuildBar();
  },
  hammerPanel(o) {
    const p = G.player; const box = el('div', 'hpanel');
    const name = (o.sk === 'piece' ? (PIECES[o.type] ? TIER[o.tier].name + ' ' + PIECES[o.type].name : HIGHWALLS[o.hw] ? HIGHWALLS[o.hw].name : o.type) : o.sk === 'door' ? DOORS[o.kind].name : DEPLOY[o.type].name) + (o.sk === 'piece' && o.st ? ' · storey ' + (o.st + 1) : '');
    box.appendChild(el('div', 'hname', `<b>${name}</b> <small>${Math.ceil(o.hp)}/${o.maxhp} HP</small>`));
    const acts = el('div', 'acts');
    const A = (label, fn, cls, dis) => { const b = el('button', cls || '', label); b.disabled = !!dis; b.onclick = () => { fn(); this.renderBuildBar(); this.refreshAll(); }; acts.appendChild(b); };
    if (o.sk === 'piece' && PIECES[o.type]) {
      const i = TIERS.indexOf(o.tier);
      for (let k = i + 1; k < TIERS.length; k++) { const t = TIERS[k]; const cost = Build.costOf(o.type, t); A('→ ' + TIER[t].name + ' (' + Object.entries(cost).map(([a, b]) => b + ' ' + shortName(a)).join(' ') + ')', () => { if (!canAfford(p, cost)) { this.toast('Not enough resources'); return; } spend(p, cost); Build.upgrade(o, t); }, k === i + 1 ? 'primary' : '', !canAfford(p, cost)); }
      // upgrade the whole building
      const all = Build.allPieces().filter(q => q && q.owner === 'player' && PIECES[q.type] && TIERS.indexOf(q.tier) < TIERS.indexOf(o.tier === 'armored' ? 'armored' : TIERS[Math.min(4, i + 1)]));
      if (i < 4 && all.length > 1) {
        const tgt = TIERS[i + 1]; const tot = {}; for (const q of all) { if (TIERS.indexOf(q.tier) >= i + 1) continue; for (const [a, b] of Object.entries(Build.costOf(q.type, tgt))) tot[a] = (tot[a] || 0) + b; }
        A('Upgrade all to ' + TIER[tgt].name + ' (' + Object.entries(tot).map(([a, b]) => b + ' ' + shortName(a)).join(' ') + ')', () => { if (!canAfford(p, tot)) { this.toast('Not enough resources'); return; } spend(p, tot); for (const q of all) if (TIERS.indexOf(q.tier) < i + 1) Build.upgrade(q, tgt); }, '', !canAfford(p, tot));
      }
    }
    if (o.hp < o.maxhp) { const base = o.sk === 'door' ? DOORS[o.kind].cost : o.sk === 'deploy' ? DEPLOY[o.type].cost : Build.costOf(o.hw || o.type, o.tier); const cost = {}; for (const [a, b] of Object.entries(base)) cost[a] = Math.max(1, Math.ceil(b * 0.5 * (1 - o.hp / o.maxhp))); A('Repair (' + Object.entries(cost).map(([a, b]) => b + ' ' + shortName(a)).join(' ') + ')', () => { if (!canAfford(p, cost)) { this.toast('Not enough resources'); return; } spend(p, cost); o.hp = o.maxhp; Sfx.build(); }, '', !canAfford(p, cost)); }
    if (o.sk === 'door') A('Flip hinge', () => { o.flip = !o.flip; o.mesh.root.rotation.y += Math.PI; });
    if (o.sk === 'deploy' && o.type !== 'ladder') A('Rotate', () => { o.ry = (o.ry + Math.PI / 2) % (Math.PI * 2); o.mesh.rotation.y = -o.ry; });
    if (o.sk === 'piece' && o.type === 'stairs') A('Rotate', () => { o.dir = ((o.dir || 0) + 1) % 4; Build._rebuild(o); });
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
    m.innerHTML = `<div class="home"><div class="home-l"><div class="logo"><h1>ZONEFALL</h1><p>Open-world survival · Build · Raid · Survive</p></div>
      <p class="mfoot">v${VERSION}</p><p class="mtip">${pick(TIPS)}</p></div>
      <div class="mbtns">${has ? '<button class="primary" id="m-cont">Continue</button>' : ''}<button class="${has ? '' : 'primary'}" id="m-new">New island</button>
      <button id="m-coop">👥 Play with friends</button><button id="m-prof">👤 ${escapeHtml(Profile.name)}</button>
      <button id="m-help">How to play</button><button id="m-set">Settings</button></div></div>`;
    const go = fn => () => { Sfx.unlock(); m.classList.add('hidden'); fn(); };
    const needProfile = fn => () => { if (!(Profile.data || Profile.load()).created) openCreator(this, { first: true, onDone: () => { this.menu(); fn(); } }); else fn(); };
    if (has) $('#m-cont').onclick = needProfile(go(() => this.loading(() => G.game.continueRun())));
    $('#m-new').onclick = needProfile(() => { if (has && !confirm('Start on a new island? Your current island and base will be lost.')) return; go(() => this.loading(() => G.game.newRun()))(); });
    $('#m-coop').onclick = needProfile(() => this.openCoop());
    $('#m-prof').onclick = () => openCreator(this, { onDone: () => this.menu() });
    $('#m-help').onclick = () => this.helpScreen();
    $('#m-set').onclick = () => this.settingsScreen(() => this.menu());
  },
  /** host / join a co-op game (works from the main menu and in game) */
  openCoop() {
    const inGame = G.mode === 'play';
    const box = inGame ? this.openSheet('Play with friends', b => b) : $('#menu');
    // the join form keeps its code and status across re-renders (the network layer re-renders on every change)
    const S = { msg: '', bad: false, code: '', joining: false };
    const render = () => {
      if (!box.isConnected) { this.coopRefresh = null; return; }
      if (S.joining && !Net.role) return; // don't wipe the form mid-join
      const head = inGame ? '' : '<h2>Play with friends</h2>';
      if (Net.role) {
        const list = [`<div>⭐ ${escapeHtml(Net.role === 'host' ? Profile.name + ' (you, host)' : 'Host')}</div>`, ...[...Net.players.values()].map(p => `<div>${escapeHtml(p.name)}${p.id === 0 ? ' (host)' : ''}</div>`)];
        if (Net.role === 'guest') list.splice(0, 1, `<div>⭐ ${escapeHtml(Profile.name)} (you)</div>`);
        const live = Net.role === 'host' ? (Net.status === 'open' ? '<p class="small" style="text-align:center;margin:0;color:#86e64a">● Room open — friends can join now</p>' : '<p class="small" style="text-align:center;margin:0;color:#ffc928">● Reconnecting the room… keep Zonefall open on screen</p>') : '';
        box.innerHTML = head + `<div class="coop"><p class="dim small" style="text-align:center;margin:0">Room code — share it with your friends</p><div class="code">${Net.code}</div>${live}
          ${Net.role === 'host' ? '<p class="dim small" style="text-align:center;margin:0">Tip: keep this screen open until everyone has joined. Switching apps can pause the room on iPhone (it reconnects when you come back).</p>' : ''}
          <div class="pl">${list.join('')}</div>
          ${Net.role === 'host' ? `<label class="row" style="justify-content:space-between"><b>PvP (friendly fire)</b><input type="checkbox" id="co-pvp" ${Net.pvp ? 'checked' : ''} style="flex:none;width:24px;height:24px"></label>` : `<p class="dim small">PvP is ${Net.pvp ? 'ON' : 'OFF'} (the host decides). Your co-op progress isn't saved — your solo run is safe.</p>`}
          <div class="row">${inGame ? '<button class="primary" id="co-ok" style="flex:1">Back to the game</button>' : ''}<button class="danger" id="co-leave">${Net.role === 'host' ? 'End co-op' : 'Leave'}</button></div></div>`;
        const pv = box.querySelector('#co-pvp'); if (pv) pv.onchange = () => Net.setPvp(pv.checked);
        if (box.querySelector('#co-ok')) box.querySelector('#co-ok').onclick = () => this.closeSheet();
        box.querySelector('#co-leave').onclick = () => { Net.leave(); render(); };
        return;
      }
      box.innerHTML = head + `<div class="coop">
        <p class="small" style="margin:0">Up to 4 players. Everyone plays on the host's island and starts next to them. It connects phone-to-phone, so keep the game open while friends play.</p>
        <button class="primary" id="co-host">⭐ Host a game</button>
        <div class="row"><input id="co-code" maxlength="5" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false"><button class="primary" id="co-join">Join</button></div>
        <p class="st small" id="co-st"></p>
        <p class="dim small" style="margin:0">Both phones need to be online and on the same version. If joining fails, check the code and keep the host's game open on screen.</p>${inGame ? '' : '<button id="co-back">Back</button>'}</div>`;
      const st = box.querySelector('#co-st'), ci = box.querySelector('#co-code');
      ci.value = S.code; ci.oninput = () => { S.code = ci.value; };
      const show = () => { const el2 = box.querySelector('#co-st') || st; el2.textContent = S.msg; el2.classList.toggle('bad', S.bad); };
      const busy = t => { S.msg = t; S.bad = false; show(); };
      const fail = e => { S.msg = '⚠ ' + (e && e.message || e); S.bad = true; show(); };
      show();
      box.querySelector('#co-host').onclick = async () => {
        busy('Opening a room…');
        try {
          if (!inGame) { $('#menu').classList.add('hidden'); await new Promise(r => this.loading(() => { if (Save.has()) G.game.continueRun(); else G.game.newRun(); r(); })); }
          await Net.host();
          if (!inGame) this.openCoop(); else render();
          this.toast('Room ' + Net.code + ' is open — tell your friends the code', 'good');
        } catch (e) { if (!inGame) { this.openCoop(); this.toast('Could not host: ' + (e.message || e.type), 'bad'); } else fail(e); }
      };
      box.querySelector('#co-join').onclick = async () => {
        if (S.joining) return;
        const code = ci.value; S.code = code; busy('Looking for room ' + code.toUpperCase() + '…');
        S.joining = true;
        try {
          await Net.join(code, w => {
            S.joining = false;
            if (inGame) this.closeSheet();
            $('#menu').classList.add('hidden');
            G.netGuest = true;
            G.game.newRun(w.seed); G.run.coop = true;
            const P = G.player; const a = Math.random() * 6.28; P.x = w.host.x + Math.cos(a) * 3; P.z = w.host.z + Math.sin(a) * 3; P.y = G.build.floorY(P.x, P.z); P.yaw = P.ang = a + Math.PI;
            G.clock = w.clock; G.day = w.day; G.run.day = w.day; G.weather = w.weather || 0;
            this.toast('Joined ' + (w.players.find(q => q.id === 0) || { profile: { name: 'the host' } }).profile.name + '\'s island!', 'good');
          }, t => busy(t));
        } catch (e) { S.joining = false; render(); fail(e); }
        S.joining = false;
      };
      if (box.querySelector('#co-back')) box.querySelector('#co-back').onclick = () => { this.coopRefresh = null; this.menu(); };
    };
    this.coopRefresh = render; render();
    if (inGame) this.onClose = () => { this.coopRefresh = null; };
  },
  loading(fn) {
    const l = $('#loading'); l.classList.remove('hidden'); l.innerHTML = '<div class="spin"></div><p>Generating the island…</p>';
    setTimeout(() => { try { fn(); } catch (e) { console.error(e); alert('Failed to start: ' + e.message); } l.classList.add('hidden'); }, 60);
  },
  helpScreen() {
    const m = $('#menu');
    m.innerHTML = `<h2>How to play</h2><div class="help">
      <p><b>Survive the island.</b> You wash up on a beach with a rock and a torch. Hit trees and rocks for wood and stone (look at them and hold the hand button), pick hemp for cloth, hunt animals for meat and leather. Keep an eye on <b>health, food and water</b>.</p>
      <p><b>Build like you mean it.</b> Open the hammer menu: lay 3 m foundations, then walls, doorways, windows and roofs on their edges. Put real doors in doorways — they swing open when you walk into them and close behind you; raiders have to break them. Stairs, ladders and triangle pieces let you shape it how you like. Upgrade twig → wood → stone → sheet metal → armored.</p>
      <p><b>Claim it.</b> A Tool Cupboard on your foundations claims the land and stops decay. Keep it stocked: every day it takes a share of what the base cost to build (upkeep). Other survivors on the island build too, and now and then one who has gathered enough explosives will try to raid you, so lock your doors and upgrade your walls.</p>
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
      <label>Comic ink outlines <input type="checkbox" id="s-ink"></label>
      <label>Sound <input type="checkbox" id="s-snd"></label>
      <label>Volume <input type="range" id="s-vol" min="0" max="1" step="0.05"></label>
      <label>Music <input type="range" id="s-mus" min="0" max="1" step="0.05"></label>
      <label>Look sensitivity <input type="range" id="s-sens" min="0.3" max="2.5" step="0.05"></label>
      <label>Field of view <input type="range" id="s-fov" min="60" max="95" step="1"></label>
      <label>Invert look up/down <input type="checkbox" id="s-inv"></label>
      <label>Aim assist (touch) <input type="checkbox" id="s-aa"></label>
      <label>Doors close behind you <input type="checkbox" id="s-door"></label>
      <label>Gun flashlight at night <input type="checkbox" id="s-fl"></label>
      <label>Smashed barrels go straight to your pockets <input type="checkbox" id="s-al"></label>
      <label>Something look broken? <button id="s-repair" class="mini">Repair (reload fresh)</button></label>
      </div>` + (host ? '' : '<button id="s-back">Back</button>');
    const q = s => box.querySelector(s);
    q('#s-gfx').value = S.gfx; q('#s-snd').checked = S.sound; q('#s-vol').value = S.volume; q('#s-mus').value = S.music ?? 0.55; q('#s-sens').value = S.sens || 1; q('#s-fov').value = S.fov || 72; q('#s-inv').checked = !!S.invert; q('#s-aa').checked = S.aimAssist !== false; q('#s-door').checked = S.autoClose !== false; q('#s-fl').checked = S.flashlight !== false; q('#s-ink').checked = S.ink !== false; q('#s-al').checked = S.autoLoot !== false;
    const save = () => { S.gfx = q('#s-gfx').value; S.sound = q('#s-snd').checked; S.volume = +q('#s-vol').value; S.music = +q('#s-mus').value; Music.setLevel(S.music); S.sens = +q('#s-sens').value; S.fov = +q('#s-fov').value; S.invert = q('#s-inv').checked; S.aimAssist = q('#s-aa').checked; G.rend.setFov(S.fov); S.autoClose = q('#s-door').checked; S.flashlight = q('#s-fl').checked; S.ink = q('#s-ink').checked; G.rend.inkOn = S.ink; S.autoLoot = q('#s-al').checked; Sfx.enabled = S.sound; Sfx.setVolume(S.volume); Save.writeSettings(S); if (G.rend.level !== S.gfx) G.rend.setLevel(S.gfx); };
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
      body.innerHTML = `<div class="pause"><p>Day ${G.day} · Kills ${G.run.kills}</p>
        <button class="primary" id="p-res">Resume</button><button id="p-coop">👥 ${Net.active ? 'Co-op (' + Net.code + ')' : 'Invite friends'}</button><button id="p-prof">👤 Profile</button><button id="p-set">Settings</button><button id="p-help">Tips</button><button id="p-menu">Save & quit to menu</button></div>`;
      $('#p-res').onclick = () => this.closeSheet();
      $('#p-set').onclick = () => this.settingsScreen();
      $('#p-coop').onclick = () => this.openCoop();
      $('#p-prof').onclick = () => openCreator(this);
      $('#p-help').onclick = () => { this.toast(pick(TIPS)); };
      $('#p-menu').onclick = () => { G.game.save(); if (Net.active) Net.leave(true); this.closeSheet(); G.mode = 'menu'; this.menu(); };
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
};

function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function catName(c) { return { res: 'Resource', comp: 'Component', val: 'Valuable — sell at Haven Market or recycle', food: 'Food', drink: 'Drink', med: 'Medical', ammo: 'Ammunition', throw: 'Throwable', gun: 'Weapon', melee: 'Tool / melee', armor: 'Body armour', helmet: 'Headgear', bag: 'Backpack', key: 'Keycard — opens monument vaults', art: 'Artifact', bp: 'Blueprint', att: 'Weapon attachment' }[c] || c; }
function recipeCat(def) { const c = def.cat; if (c === 'melee') return 'tools'; if (c === 'gun') return 'weapons'; if (c === 'att') return 'att'; if (c === 'ammo' || c === 'throw') return 'ammo'; if (['armor', 'helmet', 'bag'].includes(c)) return 'gear'; if (['med', 'food', 'drink'].includes(c)) return 'med'; if (c === 'res') return 'res'; return 'res'; }
function shortName(k) { return { wood: 'wood', stone: 'stone', metal: 'metal', hqm: 'HQM', cloth: 'cloth', scrap: 'scrap', gears: 'gears', circuit: 'circuit', pipe: 'pipe', low_fuel: 'fuel', gunpowder: 'gp', leather: 'leather' }[k] || nm(k); }
const GLYPHS = {
  stairs: ['..........hh', '..........hs', '........hhhs', '........hsms', '......hhhsms', '......hsmmms', '....hhhsmmms', '....hsmmmmms', '..hhhsmmmmms', '..hsmmmmmmms', 'hhhsmmmmmmms', 'ssssssssssss'],
  trifound: ['......hh......', '.....hhhh.....', '....hhhhhh....', '...hhhhhhhh...', '..hhhhhhhhhh..', '.hhhhhhhhhhhh.', 'hhhhhhhhhhhhhh', 'ssssssssssssss', 'mmmmmmmmmmmmmm'],
  triceil: ['......hh......', '.....hssh.....', '....hs..sh....', '...hs....sh...', '..hs......sh..', '.hs........sh.', 'hhhhhhhhhhhhhh', 'ssssssssssssss'],
  ladder: ['hs......hs', 'hs......hs', 'hhhhhhhhhs', 'hsssssssss', 'hs......hs', 'hhhhhhhhhs', 'hsssssssss', 'hs......hs', 'hhhhhhhhhs', 'hsssssssss', 'hs......hs', 'hs......hs'],
};
const glyphCache = {};
/** a 16 px UI glyph: the icon library's, or one of ours (stairs, ladder) in the same style */
function glyphURL(t) {
  const name = glyphFor(t); const rows = GLYPHS[name]; if (!rows) return ui(name);
  if (glyphCache[name]) return glyphCache[name];
  const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); const col = { h: '#ffffff', s: '#c0cbdc', m: '#8b9bb4' };
  const ox = Math.floor((16 - rows[0].length) / 2), oy = Math.floor((16 - rows.length) / 2); const on = (x, y) => !!(rows[y - oy] && rows[y - oy][x - ox] && rows[y - oy][x - ox] !== '.');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (on(x, y)) { g.fillStyle = col[rows[y - oy][x - ox]] || '#fff'; g.fillRect(x, y, 1, 1); }
    else if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) { g.fillStyle = '#181425'; g.fillRect(x, y, 1, 1); }
  }
  return (glyphCache[name] = c.toDataURL());
}
function glyphFor(t) {
  return { foundation: 'foundation', wall: 'wall', doorway: 'doorway', window: 'window', lowwall: 'lowwall', ceiling: 'ceiling', door_wood: 'door', door_metal: 'door', door_armored: 'door', highwall_wood: 'highwall', highwall_stone: 'highwall', gate_wood: 'gate', gate_stone: 'gate',
    stairs: 'stairs', ladder: 'ladder', tri_foundation: 'trifound', tri_ceiling: 'triceil', tc: 'tc', sleeping_bag: 'sleepingbag', campfire: 'campfire', box_small: 'box', box_large: 'box', furnace: 'furnace', workbench1: 'workbench', workbench2: 'workbench', workbench3: 'workbench', research: 'research', recycler: 'recycle', bed: 'bed', water_barrel: 'drop', planter: 'planter', lantern: 'light', floodlight: 'light', spikes: 'trap', landmine: 'mine', shotgun_trap: 'turret', auto_turret: 'turret', quarry: 'quarry' }[t] || 'build';
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
function ghostify(o) { o.traverse(c => { if (c.isMesh) { c.material = ghostOk; c.castShadow = false; c.receiveShadow = false; c.renderOrder = 9; } }); return o; }
function setGhostColor(o, ok) { if (o.userData.ok === ok) return; o.userData.ok = ok; o.traverse(c => { if (c.isMesh) c.material = ok ? ghostOk : ghostBad; }); }
void RAR_COL; void fmtTime; void startReload; void TIERS;

function escapeHtml(t) { return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

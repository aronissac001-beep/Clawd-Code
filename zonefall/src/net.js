// ============================================================================
// ZONEFALL 4 — peer-to-peer co-op (stage 1). No game server: one phone hosts,
// friends join with a 5-letter room code. WebRTC data channels via PeerJS (its
// free public matchmaking server only introduces the peers; game traffic goes
// phone-to-phone). The host relays everything, so guests only talk to the host.
//
// What is shared: everyone plays on the host's island seed and starts beside the
// host; you see each other (your profile name + look), what you hold, your
// vehicles; shots and melee are replicated (the victim's own game decides hits,
// so PvP works without trusting positions); deaths go to the kill feed; chat;
// the host's day/night clock and weather. Each phone still runs its own
// wildlife, NPCs, loot and base (stage 2 will share the world).
// ============================================================================
import { G } from './state.js';
import { THREE } from './gfx/materials.js';
import { WEAPONS, VERSION } from './data.js';
import { spawnActor, removeActor } from './actors.js';
import { spawnProjectile, hurt } from './combat.js';
import { Sfx } from './audio.js';
import { Profile, cleanName, cleanLook } from './profile.js';
import { buildVehicleModel } from './vehicles.js';
import { NW } from './networld.js';
import { Live } from './world/live.js';
import { Inv, PlayerInv } from './inventory.js';
import { Cargo } from './cargo.js';
G.netWorld = NW;
const NO_RELAY = new Set(['wset', 'ahit', 'copen', 'cbreak', 'boom', 'asig', 'hack', 'venter', 'vdmg', 'gsave']); // guest -> host requests (the host re-broadcasts the results itself)
import { clamp, lerp, rand } from './util.js';

const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PREFIX = 'zonefall4-';
const SEND_HZ = 12, DELAY = 0.12; // interpolation delay (s)

function loadPeerLib() {
  if (window.Peer) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = './lib/peerjs.min.js'; s.onload = () => res(); s.onerror = () => rej(new Error('Could not load the networking library')); document.head.appendChild(s); });
}
/**
 * Connection helpers. STUN lets two phones find each other's public address; when either sits behind
 * mobile data or a strict router (very common) that isn't enough and the traffic has to go through a
 * TURN relay. PeerJS runs free relays — keep them (an earlier STUN-only list left them out, so phones
 * on different networks often couldn't connect at all). TCP variants help on networks that block UDP.
 */
const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478', 'turn:eu-0.turn.peerjs.com:3478?transport=tcp', 'turn:us-0.turn.peerjs.com:3478?transport=tcp'], username: 'peerjs', credential: 'peerjsp' },
  ],
  sdpSemantics: 'unified-plan',
};
function peerOpts() {
  const u = new URLSearchParams(location.search); const host = u.get('peerhost');
  return host ? { host, port: +(u.get('peerport') || 9000), path: u.get('peerpath') || '/', secure: false, debug: 1, config: ICE } : { debug: 1, config: ICE, pingInterval: 4000 };
}
const sameVersion = v => String(v || '') === VERSION;
const r4 = v => Math.round(v * 1e4) / 1e4, r2 = v => Math.round(v * 100) / 100;

export const Net = {
  role: null, peer: null, code: '', me: 0, pvp: false, // co-op by default; the host can switch PvP on
  conns: new Map(),      // host: guestId -> conn
  conn: null,            // guest: the connection to the host
  players: new Map(),    // id -> { id, name, look, actor, buf: [], veh: mesh|null, hp, dead }
  nextId: 1, sendT: 0, timeT: 0, onChange: null,
  get active() { return !!this.role; },
  get count() { return this.players.size + (this.role ? 1 : 0); },
  // ---------------------------------------------------------------- hosting / joining
  async host() {
    await loadPeerLib();
    // our own registration token: re-registering the same room after a dropped link is then accepted at once
    // (with a new token the server would say "ID taken" until it notices the old link is dead, up to a minute)
    this.token = Array.from({ length: 16 }, () => ALPH[Math.floor(Math.random() * ALPH.length)]).join('').toLowerCase();
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = Array.from({ length: 5 }, () => ALPH[Math.floor(Math.random() * ALPH.length)]).join('');
      try { await this.openPeer(PREFIX + code, this.token); this.code = code; break; }
      catch (e) { if (attempt === 3 || !/unavailable-id|taken/i.test(String(e.type || e.message))) throw e; }
    }
    this.role = 'host'; this.me = 0; G.net = this;
    this.peer.on('connection', c => this.acceptGuest(c));
    this.keepAlive();
    this.changed(); return this.code;
  },
  /** the room only exists while the host is registered with the matchmaking server. iOS drops that link when
   *  you switch apps (e.g. to text the code), so keep checking and re-register under the same code. */
  keepAlive() {
    clearInterval(this.aliveT);
    this.aliveT = setInterval(() => this.revive(), 3000);
    if (!this.visHook) { this.visHook = () => { if (document.visibilityState === 'visible') this.revive(); }; document.addEventListener('visibilitychange', this.visHook); addEventListener('online', this.visHook); }
  },
  async revive() {
    if (this.role !== 'host' || this.reviving) return;
    const p = this.peer;
    if (p && !p.destroyed && p.disconnected) { try { p.reconnect(); } catch (e) { } this.changed(); return; }
    if (p && !p.destroyed) return;
    // the peer is gone: register the same room code again. The server can keep the old one "taken" for up
    // to a minute after a phone drops off, so this just tries again every few seconds (keepAlive's timer).
    this.reviving = true; this.changed();
    try { const np = await this.openPeer(PREFIX + this.code, this.token); if (this.role === 'host') np.on('connection', c => this.acceptGuest(c)); else try { np.destroy(); } catch (e) { } }
    catch (e) { } finally { this.reviving = false; this.changed(); }
  },
  /** host status line for the co-op screen */
  get status() {
    if (this.role !== 'host') return '';
    const p = this.peer; if (this.reviving || !p || p.destroyed || p.disconnected) return 'reconnecting';
    return 'open';
  },
  openPeer(id, token) {
    return new Promise((res, rej) => {
      const o = peerOpts(); if (token) o.token = token;
      const p = id ? new window.Peer(id, o) : new window.Peer(o);
      let opened = false; // errors before 'open' belong to this attempt; after it, to the running game
      const to = setTimeout(() => { if (opened) return; rej(Object.assign(new Error('Could not reach the matchmaking server — check your internet'), { type: 'network' })); try { p.destroy(); } catch (e) { } }, 12000);
      p.on('open', () => { if (opened) { if (this.role === 'host') this.changed(); return; } opened = true; clearTimeout(to); this.peer = p; res(p); });
      p.on('error', e => { if (!opened) { clearTimeout(to); rej(e); try { p.destroy(); } catch (x) { } } else if (this.peer === p) this.peerError(e); });
      p.on('disconnected', () => { if (this.role === 'host' && this.peer === p && !p.destroyed) { try { p.reconnect(); } catch (e) { } this.changed(); } });
    });
  },
  peerError(e) {
    console.warn('net', e.type, e.message);
    if (this.role === 'host' && (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' || e.type === 'socket-closed')) { this.changed(); return; } // revive() handles it
    if (e.type === 'network' || e.type === 'server-error') G.ui && G.ui.toast('Network trouble: ' + (e.message || e.type), 'bad');
  },
  acceptGuest(c) {
    if (this.conns.size >= 3) { c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); }); return; }
    const id = this.nextId++; c.zfId = id;
    c.on('data', m => { m = this.unchunk(c, m); if (m) this.fromGuest(c, m); });
    c.on('close', () => this.dropGuest(c)); c.on('error', () => this.dropGuest(c));
  },
  dropGuest(c) {
    if (!this.conns.has(c.zfId)) return; this.conns.delete(c.zfId); NW.sent.delete(c.zfId);
    const pl = this.players.get(c.zfId); this.removePlayer(c.zfId);
    this.broadcast({ t: 'leave', id: c.zfId }); if (pl) G.ui.toast(pl.name + ' left', 'bad');
    this.changed();
  },
  async join(code, onWelcome, onStatus) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) throw new Error('Room codes are 5 letters');
    if (this.role || this.peer) this.leave(true);
    await loadPeerLib();
    // a host that just switched apps may be re-registering: try a few times before giving up
    let last = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt && onStatus) onStatus('Still looking for room ' + code + '… (try ' + (attempt + 1) + ' of 4)');
      try { return await this.joinOnce(code, onWelcome, onStatus); }
      catch (e) { last = e; this.leave(true); if (!e.retry) break; await new Promise(r => setTimeout(r, 3000)); }
    }
    throw last;
  },
  async joinOnce(code, onWelcome, onStatus) {
    await this.openPeer(null);
    return new Promise((res, rej) => {
      let done = false; const fail = (msg, retry) => { if (done) return; done = true; clearTimeout(to); rej(Object.assign(new Error(msg), { retry: !!retry })); };
      const c = this.peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      const to = setTimeout(() => fail('Found the room but couldn\'t connect to your friend\'s phone. Try again, or try both on the same Wi-Fi.', true), 25000);
      this.peer.on('error', e => { if (e.type === 'peer-unavailable') fail('No game with code ' + code + '. Check the code, and keep Zonefall open on the host\'s screen while you join.', true); else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') fail('Lost the matchmaking server — check your internet and try again.', true); });
      c.on('error', e => fail('Connection error: ' + (e && (e.message || e.type) || 'unknown') + '. Try again.', true));
      c.on('iceStateChanged', s => { if (onStatus && s === 'checking') onStatus('Found room ' + code + ' — connecting to your friend\'s phone…'); if (s === 'failed') fail('Couldn\'t open a connection between your phones (the network blocked it). Try again, or switch one phone to Wi-Fi / mobile data.', true); });
      c.on('open', () => { if (onStatus) onStatus('Connected — loading the host\'s island…'); c.send({ t: 'hello', v: VERSION, profile: Profile.public() }); });
      c.on('data', m => {
        m = this.unchunk(c, m); if (!m) return;
        if (m && m.t === 'ver') { fail('Version mismatch: the host has ' + String(m.host || '?').slice(0, 12) + ', you have ' + VERSION + '. Both of you: close Zonefall completely and reopen it to update.'); this.leave(true); return; }
        if (m && m.t === 'full') { fail('That game is full (4 players)'); this.leave(true); return; }
        if (m && m.t === 'welcome' && !sameVersion(m.v)) { fail('Version mismatch: the host has ' + String(m.v || 'an older version').slice(0, 20) + ', you have ' + VERSION + '. Both of you: close Zonefall completely and reopen it to update.'); this.leave(true); return; }
        if (m && m.t === 'welcome') done = true;
        if (m && m.t === 'welcome') { clearTimeout(to); this.role = 'guest'; this.conn = c; this.code = code; this.me = m.you; this.pvp = !!m.pvp; G.net = this; onWelcome(m); for (const p of m.players || []) if (p.id !== this.me) this.addPlayer(p.id, p.profile); this.changed(); res(m); return; }
        this.handle(m, false);
      });
      c.on('close', () => { if (this.role === 'guest') { G.ui.toast('The host closed the game — you\'re playing solo now', 'bad'); this.leave(true); } });
    });
  },
  /** guest: my character on this island, for the host to keep */
  guestState() {
    const P = G.player; if (!P || P.dead || !P.inv) return null;
    const r2 = v => Math.round(v * 100) / 100;
    return { x: r2(P.x), z: r2(P.z), hp: Math.round(P.hp), food: Math.round(P.food), water: Math.round(P.water), rad: Math.round(P.rad || 0), sel: P.sel | 0, inv: P.inv.toJSON() };
  },
  sendGuestState() { if (this.role !== 'guest') return; const st = this.guestState(); if (st) this.send({ t: 'gsave', st }); },
  /** host: remember a friend's character in this run (saved with the island) */
  keepGuest(m) {
    const c = this.conns.get(m.id); const uid = c && c.zfUid; if (!uid || !m.st || typeof m.st !== 'object') return;
    const st = m.st; if (![st.x, st.z, st.hp].every(Number.isFinite)) return;
    const pl = this.players.get(m.id);
    G.run.guests = G.run.guests || {};
    G.run.guests[uid] = { name: pl ? pl.name : '?', x: st.x, z: st.z, hp: clamp(st.hp, 1, 100), food: clamp(+st.food || 50, 0, 100), water: clamp(+st.water || 50, 0, 100), rad: clamp(+st.rad || 0, 0, 100), sel: st.sel | 0, inv: st.inv, day: G.day };
    const ids = Object.keys(G.run.guests); if (ids.length > 12) delete G.run.guests[ids[0]]; // keep it small
  },
  /** guest: the host gave my character back */
  applyRestore(st) {
    try {
      const P = G.player; if (!P || !st || !st.inv) return;
      P.inv = PlayerInv.from(st.inv); P.hp = clamp(+st.hp || 100, 1, P.maxhp || 100); P.food = clamp(+st.food || 70, 0, 100); P.water = clamp(+st.water || 70, 0, 100); P.rad = +st.rad || 0; P.sel = st.sel | 0;
      if ([st.x, st.z].every(Number.isFinite)) { P.x = st.x; P.z = st.z; P.y = G.build.floorY(P.x, P.z); }
      if (G.game && G.game.refreshPlayer) G.game.refreshPlayer(); else if (G.refreshPlayer) G.refreshPlayer();
      G.ui.toast('Welcome back — your kit from last time is here', 'good');
    } catch (e) { console.warn('restore', e); }
  },
  leave(silent) {
    if (this.role === 'guest') this.sendGuestState();
    this.restored = false;
    clearInterval(this.aliveT); this.reviving = false;
    if (this.role === 'host') this.broadcast({ t: 'bye' });
    for (const c of this.conns.values()) try { c.close(); } catch (e) { }
    if (this.conn) try { this.conn.close(); } catch (e) { }
    if (this.peer) try { this.peer.destroy(); } catch (e) { }
    for (const id of [...this.players.keys()]) this.removePlayer(id);
    NW.reset();
    this.role = null; this.peer = null; this.conn = null; this.conns.clear(); this.code = ''; G.net = null; G.netGuest = false;
    if (!silent && G.ui) G.ui.toast('Left the co-op game');
    this.changed();
  },
  changed() { if (this.onChange) try { this.onChange(); } catch (e) { } document.body.classList.toggle('mp', !!this.role); },
  // ---------------------------------------------------------------- messaging
  /** send on one data channel; big messages (world snapshots) go in 12 KB pieces — data channels choke on large frames */
  sendConn(c, m) {
    if (!c || !c.open) return;
    const s = JSON.stringify(m);
    try {
      if (s.length <= 12000) { c.send(m); return; }
      const id = (this.ckId = (this.ckId || 0) + 1), n = Math.ceil(s.length / 12000);
      for (let i = 0; i < n; i++) c.send({ t: 'ck', id, i, n, d: s.slice(i * 12000, (i + 1) * 12000) });
    } catch (e) { console.warn('net send', e); }
  },
  /** put chunked messages back together (returns the whole message, or null while waiting) */
  unchunk(c, m) {
    if (!m || m.t !== 'ck') return m;
    const box = c.zfChunks || (c.zfChunks = new Map()); let e = box.get(m.id);
    if (!e) { e = { n: m.n | 0, got: 0, parts: [] }; box.set(m.id, e); }
    if (e.n > 400 || typeof m.d !== 'string') { box.delete(m.id); return null; }
    if (e.parts[m.i] === undefined) { e.parts[m.i] = m.d; e.got++; }
    if (e.got < e.n) return null;
    box.delete(m.id); try { return JSON.parse(e.parts.join('')); } catch (x) { return null; }
  },
  send(m) { // from me to everyone
    if (this.role === 'host') this.broadcast(Object.assign({ id: 0 }, m));
    else if (this.role === 'guest' && this.conn && this.conn.open) this.sendConn(this.conn, m);
  },
  sendTo(id, m) { const c = this.conns.get(id); if (c && c.open) this.sendConn(c, m); },
  broadcast(m, except) { for (const [id, c] of this.conns) if (id !== except && c.open) this.sendConn(c, m); },
  fromGuest(c, m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      if (this.conns.has(c.zfId)) return;
      if (!sameVersion(m.v)) { try { c.send({ t: 'ver', host: VERSION }); } catch (e) { } setTimeout(() => { try { c.close(); } catch (e) { } }, 500); G.ui && G.ui.toast('A friend tried to join on a different version (' + String(m.v || '?').slice(0, 12) + ') — you both need ' + VERSION, 'bad'); return; }
      this.conns.set(c.zfId, c);
      const prof = { name: cleanName(m.profile && m.profile.name), look: cleanLook(m.profile && m.profile.look) };
      const uid = m.profile && typeof m.profile.uid === 'string' ? m.profile.uid.replace(/[^a-z0-9]/gi, '').slice(0, 24) : '';
      const P = G.player;
      const welcome = { t: 'welcome', v: VERSION, you: c.zfId, seed: G.run.seed, clock: G.clock, day: G.day, weather: G.weather || 0, pvp: this.pvp, host: { x: P.x, z: P.z }, players: [{ id: 0, profile: Profile.public() }, ...[...this.players.values()].map(p => ({ id: p.id, profile: { name: p.name, look: p.look } }))] };
      this.sendConn(c, welcome); this.sendConn(c, NW.snapshot());
      // a friend who has played here before gets their character back (kit, health, where they were)
      c.zfUid = uid; const rec = uid && G.run && G.run.guests && G.run.guests[uid];
      if (rec && rec.inv) this.sendConn(c, { t: 'restore', st: rec });
      this.addPlayer(c.zfId, prof); this.broadcast({ t: 'join', id: c.zfId, profile: prof }, c.zfId);
      G.ui.toast(prof.name + ' joined your game!', 'good'); Sfx.win(); this.changed(); return;
    }
    m.id = c.zfId;                       // never trust a guest's claimed id
    if (m.t === 'time' || m.t === 'pvp' || m.t === 'welcome') return; // host-only messages
    this.handle(m, true);
    if (!NO_RELAY.has(m.t)) this.broadcast(m, c.zfId);
  },
  handle(m, fromGuest) {
    if (!m || typeof m !== 'object') return;
    const pl = this.players.get(m.id);
    switch (m.t) {
      case 'join': if (m.id !== this.me) { this.addPlayer(m.id, m.profile); G.ui.toast(cleanName(m.profile && m.profile.name) + ' joined', 'good'); } break;
      case 'leave': { const p2 = this.players.get(m.id); this.removePlayer(m.id); if (p2) G.ui.toast(p2.name + ' left', 'bad'); break; }
      case 'bye': // the host's island is gone: back to your own (what you carried there is kept for next time)
        G.ui.toast('The host ended the game — back to your own island', 'bad'); this.leave(true);
        setTimeout(() => { try { if (G.mode === 'play') { G.netGuest = false; if (G.run) G.run.coop = false; if (G.game.hasSave && !G.game.hasSave()) { G.mode = 'menu'; G.ui.menu(); } else G.game.continueRun(); } } catch (e) { G.mode = 'menu'; G.ui.menu(); } }, 2500);
        break;
      case 'restore': if (this.role === 'guest' && m.st && !this.restored) { this.restored = true; this.applyRestore(m.st); } break;
      case 'gsave': if (this.role === 'host' && fromGuest) this.keepGuest(m); break;
      case 'profile': if (pl) { pl.name = cleanName(m.profile && m.profile.name); pl.look = cleanLook(m.profile && m.profile.look); if (pl.actor) { pl.actor.rig.setLook(pl.look); pl.actor.name = pl.name; } } break;
      case 'st': if (pl) this.snapshot(pl, m); break;
      case 'shot': if (pl) this.remoteShot(pl, m); break;
      case 'mhit': if (m.npc && m.to === this.me && G.player && !G.player.dead) { const P = G.player, src = NW.mirrors.get(m.npc) || null; hurt(P, clamp(+m.dmg || 0, 0, 120), { owner: src, kind: 'melee', bleed: m.bleed || 0, dir: src ? Math.atan2(P.z - src.z, P.x - src.x) : undefined }); break; }
        if (m.to === this.me && pl && G.player && !G.player.dead && this.pvp) { const P = G.player; hurt(P, clamp(+m.dmg || 0, 0, 80), { owner: pl.actor, kind: 'melee', dir: Math.atan2(P.z - pl.actor.z, P.x - pl.actor.x) }); } break;
      case 'hurt': if (m.by === this.me) { const v = this.players.get(m.id); if (v && v.actor && G.ui) { G.ui.hitMarker(!!m.crit); G.ui.dmgNum(v.actor, clamp(+m.dmg || 0, 0, 999), !!m.crit, 2.0); } } break;
      case 'died': if (pl) { const by = m.by === this.me ? 'You' : m.by === undefined || m.by === null ? null : (this.players.get(m.by) || {}).name; G.ui.killFeed((by || 'The island') + ' ✕ ' + pl.name); } break;
      case 'chat': if (pl) this.showChat(pl, String(m.text || '').slice(0, 120)); break;
      case 'time': if (this.role === 'guest') { G.clock = +m.clock || G.clock; G.day = m.day | 0 || G.day; if (G.run) G.run.day = G.day; if (m.weather !== undefined) { G.weather = +m.weather; if (G.game && G.game.wx) G.game.wx.target = +m.weather; } } break;
      // ---- shared world (stage 2)
      case 'wsnap': if (this.role === 'guest') NW.applySnapshot(m); break;
      case 'wd': if (this.role === 'guest') NW.fromHost(m); break;
      case 'wset': if (this.role === 'host') NW.fromGuest(m); break;
      case 'aadd': if (this.role === 'guest') NW.addMirror(m); break;
      case 'arem': if (this.role === 'guest') NW.removeMirror(m.aid); break;
      case 'ast': if (this.role === 'guest' && Array.isArray(m.a)) NW.mirrorStates(m.a); break;
      case 'nshot': if (this.role === 'guest') NW.mirrorShot(m); break;
      case 'copen': if (this.role === 'host') { const c = G.containers.find(q => q.id === m.cid); if (c && !c.gone) { Live.lootOf(c); if (!c.openedAt) c.openedAt = G.t; } NW.diffT = 0; } break;
      case 'cbreak': if (this.role === 'host') { const c = G.containers.find(q => q.id === m.cid); if (c && !c.gone) Live.breakContainer(c, pl ? pl.actor : null, { auto: !!m.al }); } break;
      case 'loot': if (this.role === 'guest' && Array.isArray(m.items) && G.player && !G.player.dead) { const inv = Inv.from(m.items.slice(0, 24), 24); const left = Live.autoLoot(inv, +m.x || G.player.x, +m.y || G.player.y + 1, +m.z || G.player.z); if (!left.empty()) Live.dropInv(G.player.x, G.player.z, left, 'item', 600, G.player.y + 0.5); } break;
      case 'ahit': if (this.role === 'host') { const a = G.actors.find(q => q.id === m.aid && !q.dead); if (a && pl) hurt(a, clamp(+m.dmg || 0, 0, 2000), { owner: pl.actor, crit: !!m.crit, pen: clamp(+m.pen || 0, 0, 1), kind: String(m.kind || ''), bleed: clamp(+m.bleed || 0, 0, 1), dir: Math.atan2(a.z - pl.actor.z, a.x - pl.actor.x) }); } break;
      case 'boom': if (G.explodeNet) G.explodeNet(m, fromGuest ? m.id : null); break;
      case 'train': if (this.role === 'guest' && G.train) { const T = G.train; if (Math.abs(T.s - m.s) > 3 || T.state !== m.st) { T.s = +m.s; T.v = +m.v; T.state = m.st; T.t = +m.tt; T.next = m.nx | 0; } } break;
      case 'kf': if (this.role === 'guest' && G.ui) G.ui.killFeed(String(m.text || '').slice(0, 80)); break;
      case 'adrop': if (this.role === 'guest' && G.onNetAirdrop && [m.x, m.z, m.ang].every(Number.isFinite)) G.onNetAirdrop(m.x, m.z, m.ang); break;
      case 'asig': if (this.role === 'host' && G.onSupplySignal && [m.x, m.z].every(Number.isFinite)) G.onSupplySignal(clamp(m.x, 0, 1400), clamp(m.z, 0, 1400)); break;
      case 'cadd': if (this.role === 'guest') NW.addContainer(m.c); break;
      case 'crem': if (this.role === 'guest' && Array.isArray(m.ids)) NW.removeContainers(m.ids); break;
      case 'cargo': if (this.role === 'guest') Cargo.fromHost(m); break;
      // shared vehicles: the host owns them; whoever drives one moves it
      case 'vst': if (this.role === 'guest' && G.vehicles) { for (const r of Array.isArray(m.v) ? m.v : []) G.vehicles.netApply(r); for (const nid of Array.isArray(m.rm) ? m.rm : []) G.vehicles.netRemove(nid); } break;
      case 'venter': if (this.role === 'host' && G.vehicles) { const v = G.vehicles.byNid(m.nid); if (!v || v.dead || v.driver || (v.netDriver != null && v.netDriver !== m.id)) this.sendTo(m.id, { t: 'vdeny', nid: m.nid }); else { v.netDriver = m.id; v.stT = performance.now() / 1000; } } break;
      case 'vdeny': if (this.role === 'guest' && G.vehicles && G.player && G.player.vehicle && G.player.vehicle.nid === m.nid) { G.vehicles.exit(G.player, false); G.ui.toast('Someone else got in first', 'bad'); } break;
      case 'vexit': if (G.vehicles) G.vehicles.netRelease(m.nid, m.id, m); break;
      case 'vdmg': if (this.role === 'host' && G.vehicles) { const v = G.vehicles.byNid(m.nid); if (v && !v.dead) G.vehicles.damage(v, clamp(+m.n || 0, 0, 2000), String(m.why || '').slice(0, 12)); } break;
      case 'vwreck': if (this.role === 'guest' && G.vehicles) { const v = G.vehicles.byNid(m.nid); if (v && !v.dead) G.vehicles.wreck(v); } break;
      case 'hack': if (this.role === 'host' && G.cargo) { const c = G.containers.find(q => q.id === m.cid); if (c && c.locked && !c.hackEnd) G.cargo.startHack(c, pl ? pl.actor : null); } break;
      case 'note': if (this.role === 'guest' && G.ui) G.ui.toast(String(m.text || '').slice(0, 120), m.kind === 'bad' ? 'bad' : m.kind === 'good' ? 'good' : undefined); break;
      case 'pvp': this.pvp = !!m.on; for (const p of this.players.values()) if (p.actor) p.actor.team = this.pvp ? 'remote' : 'player'; G.ui.toast(this.pvp ? 'PvP is ON — friendly fire hurts' : 'PvP is OFF — you can\'t hurt each other'); break;
    }
  },
  // ---------------------------------------------------------------- remote players
  addPlayer(id, profile) {
    if (id === this.me || this.players.has(id)) return;
    const name = cleanName(profile && profile.name), look = cleanLook(profile && profile.look);
    const P = G.player; const x = P ? P.x + 2 : 0, z = P ? P.z + 2 : 0;
    const a = spawnActor('survivor', x, z, { team: this.pvp ? 'remote' : 'player', look });
    a.remote = id; a.name = name; a.def = Object.assign({}, a.def, { name, sight: 0 }); a.hp = a.maxhp = 100;
    this.players.set(id, { id, name, look, actor: a, buf: [], veh: null, vehKind: null, hp: 100, dead: false });
  },
  removePlayer(id) {
    const p = this.players.get(id); if (!p) return;
    if (p.actor) removeActor(p.actor); if (p.veh) G.scene.remove(p.veh.root);
    if (G.vehicles) G.vehicles.netReleaseAll(id); // whatever they were driving stays where they left it
    this.players.delete(id);
  },
  snapshot(pl, m) {
    const s = { t: performance.now() / 1000, x: +m.x, y: +m.y, z: +m.z, yaw: +m.yaw, cr: !!m.cr, held: m.held || null, ads: +m.ads || 0, dead: !!m.dead, hp: +m.hp, spd: +m.spd || 0, veh: m.veh || null, ride: Array.isArray(m.ride) ? [m.ride[0], m.ride[1] | 0] : null };
    if (![s.x, s.y, s.z, s.yaw].every(Number.isFinite)) return;
    pl.buf.push(s); if (pl.buf.length > 20) pl.buf.shift();
    if (pl.actor) pl.actor.netVeh = s.veh; // lets the host's enemies ignore a friend flying overhead
  },
  // ---------------------------------------------------------------- my events
  shot(id, x, y, z, pellets) { if (!this.role) return; this.send({ t: 'shot', w: id, o: [r2(x), r2(y), r2(z)], p: pellets.map(q => [r4(q[0]), r4(q[1])]) }); },
  melee(target, dmg) { if (this.role && target && target.remote !== undefined) this.send({ t: 'mhit', to: target.remote, dmg: Math.round(dmg) }); },
  hurtBy(owner, dmg, crit) { if (this.role && owner && owner.remote !== undefined) this.send({ t: 'hurt', by: owner.remote, dmg: Math.round(dmg), crit: !!crit }); },
  died(by) { if (this.role) this.send({ t: 'died', by: by && by.remote !== undefined ? by.remote : null }); },
  chat(text) { text = String(text || '').replace(/[<>]/g, '').trim().slice(0, 120); if (!text || !this.role) return; this.send({ t: 'chat', text }); this.showChat({ name: Profile.name, actor: G.player, me: true }, text); },
  /** host: an NPC / animal hit a remote player in melee */
  npcMelee(target, dmg, npc, bleed) { if (this.role === 'host' && target && target.remote !== undefined) { const c = this.conns.get(target.remote); if (c && c.open) this.sendConn(c, { t: 'mhit', to: target.remote, npc: npc ? npc.id : 0, dmg: Math.round(dmg), bleed: bleed || 0 }); } },
  note(text, kind) { if (this.role === 'host') this.broadcast({ t: 'note', text, kind }); },
  kf(text) { if (this.role === 'host') this.broadcast({ t: 'kf', text }); },
  /** who the world should be alive around: me + everyone else in the game */
  anchors() { const out = G.player ? [G.player] : []; if (this.role === 'host') for (const p of this.players.values()) if (p.actor && !p.actor.dead) out.push(p.actor); return out; },
  setPvp(on) { if (this.role !== 'host') return; this.pvp = !!on; this.broadcast({ t: 'pvp', on: this.pvp }); this.handle({ t: 'pvp', on: this.pvp }); },
  profileChanged() { if (this.role) this.send({ t: 'profile', profile: Profile.public() }); },
  showChat(pl, text) {
    if (G.ui && G.ui.chatLine) G.ui.chatLine(pl.name, text, pl.me);
    if (pl.actor && G.ui && !pl.me) { G.ui.bubbles = G.ui.bubbles || []; G.ui.bubbles.push({ a: pl.actor, text, t: 0 }); }
    Sfx.ui && Sfx.ui();
  },
  // ---------------------------------------------------------------- per frame
  tick(dt) {
    if (!this.role) return;
    NW.tick(dt);
    const P = G.player;
    // send my state
    this.sendT -= dt;
    if (P && this.sendT <= 0) {
      this.sendT = 1 / SEND_HZ;
      const s = P.inv && P.inv.belt.slots[P.sel]; const v = P.vehicle;
      this.send({ t: 'st', x: r2(P.x), y: r2(P.y), z: r2(P.z), yaw: r4(P.yaw), cr: !!P.crouch, held: s ? s.id : null, ads: r2(P.ads || 0), dead: !!P.dead, hp: Math.round(P.hp), spd: r2(P.speedNow || 0), veh: v ? { id: v.nid, f: Math.round(v.fuel), k: v.kind, x: r2(v.x), y: r2(v.y), z: r2(v.z), yaw: r4(v.yaw), p: r4(v.pitch), r: r4(v.roll), rpm: r2(v.rpm) } : null, ride: P.ride && P.ride.v.nid ? [P.ride.v.nid, P.ride.i] : null });
    }
    if (this.role === 'guest' && (this.gsT = (this.gsT ?? 8) - dt) <= 0) { this.gsT = 20; this.sendGuestState(); }
    if (this.role === 'host' && (this.timeT -= dt) <= 0) { this.timeT = 4; this.broadcast({ t: 'time', clock: G.clock, day: G.day, weather: G.weather || 0 }); }
    // move the remote players (interpolated ~120 ms in the past)
    const now = performance.now() / 1000 - DELAY;
    for (const pl of this.players.values()) {
      const a = pl.actor; const B = pl.buf; if (!a || !B.length) continue;
      // pick the two snapshots around the playback time; past the newest one, nudge ahead a little (max 0.1 s)
      let s0, s1, k;
      const last = B[B.length - 1];
      if (now >= last.t) { s0 = B.length > 1 ? B[B.length - 2] : last; s1 = last; k = s1.t > s0.t ? 1 + clamp((now - s1.t) / (s1.t - s0.t), 0, 1) * clamp(0.1 / (s1.t - s0.t), 0, 1) : 1; }
      else if (now <= B[0].t) { s0 = s1 = B[0]; k = 1; }
      else { s0 = B[0]; s1 = last; for (let i = 0; i < B.length - 1; i++) if (B[i].t <= now && B[i + 1].t >= now) { s0 = B[i]; s1 = B[i + 1]; break; } k = s1.t > s0.t ? (now - s0.t) / (s1.t - s0.t) : 1; }
      if (Math.hypot(s1.x - s0.x, s1.z - s0.z) > 25) { s0 = s1; k = 1; } // teleports / respawns: snap
      const ox = a.x, oz = a.z;
      a.x = lerp(s0.x, s1.x, k); a.y = lerp(s0.y, s1.y, k); a.z = lerp(s0.z, s1.z, k);
      let dy = s1.yaw - s0.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); a.ang = s0.yaw + dy * k;
      a.speedNow = s1.veh ? 0 : Math.min(7, Math.hypot(a.x - ox, a.z - oz) / Math.max(dt, 1e-3));
      a.st.aim = !!s1.held && !!WEAPONS[s1.held] && !s1.veh; a.st.crouch = s1.cr || !!s1.veh; // drivers and riders sit pl.hp = s1.hp;
      if (a._held !== s1.held) { a._held = s1.held; try { a.rig.setHeld(s1.veh ? null : s1.held); } catch (e) { } a.held = s1.held; a.gunStack = WEAPONS[s1.held] ? { id: s1.held } : null; }
      if (s1.dead && !a.dead) { a.dead = true; a.deadT = 0; } else if (!s1.dead && a.dead) { a.dead = false; a.deadT = 0; }
      // their vehicle: the shared one (same id on every phone), smoothed like they are
      let v = s1.veh;
      const sv = v && v.id !== undefined && G.vehicles ? G.vehicles.byNid(v.id) : null;
      if (pl.vehNid !== undefined && (!sv || pl.vehNid !== v.id)) { if (G.vehicles) G.vehicles.netRelease(pl.vehNid, pl.id); pl.vehNid = undefined; }
      if (sv && !sv.dead) {
        const v0 = s0.veh && s0.veh.id === v.id ? s0.veh : v, kk = Math.min(k, 1.2), la = (a, b) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * kk;
        const st = { x: lerp(v0.x, v.x, kk), y: lerp(v0.y, v.y, kk), z: lerp(v0.z, v.z, kk), yaw: la(v0.yaw, v.yaw), p: la(v0.p || 0, v.p || 0), r: la(v0.r || 0, v.r || 0), rpm: v.rpm || 0, f: +v.f };
        if (G.vehicles.netDrive(sv, st, dt, pl.id)) { pl.vehNid = v.id; if (pl.veh) { G.scene.remove(pl.veh.root); pl.veh = null; pl.vehKind = null; } v = st; v.k = sv.kind; }
        if ((pl.sndT = (pl.sndT || 0) - dt) <= 0 && G.player) { pl.sndT = v.k === 'heli' ? 0.1 : 0.14; const vol = Sfx.vol(v.x, v.z, 90); if (vol > 0.03 && (v.rpm || 0) > 0.05) Sfx.noise(0.08, v.k === 'heli' ? 200 : 120, 1.5, 0.08 * vol, 'lowpass'); }
        continue;
      }
      if (v && (!pl.veh || pl.vehKind !== v.k)) { if (pl.veh) G.scene.remove(pl.veh.root); pl.veh = buildVehicleModel(v.k); pl.vehKind = v.k; G.scene.add(pl.veh.root); }
      if (!v && pl.veh) { G.scene.remove(pl.veh.root); pl.veh = null; pl.vehKind = null; }
      if (v && pl.veh) {
        const r = pl.veh.root; r.position.set(v.x, v.y, v.z); r.rotation.set(0, -v.yaw, 0); r.rotateZ(v.p || 0); r.rotateX(v.r || 0);
        if (pl.veh.rotor) { pl.veh.rotor.rotation.y += dt * (v.rpm || 0) * 38; pl.veh.tail.rotation.z += dt * (v.rpm || 0) * 60; pl.veh.blur.visible = (v.rpm || 0) > 0.6; pl.veh.blades.visible = (v.rpm || 0) <= 0.6; }
        if (pl.veh.wheels) for (const w of pl.veh.wheels) w.rotation.z -= dt * 8;
        if (pl.veh.tick) try { pl.veh.tick(dt, v); } catch (e) { }
        if ((pl.sndT = (pl.sndT || 0) - dt) <= 0 && G.player) { pl.sndT = v.k === 'heli' ? 0.1 : 0.14; const vol = Sfx.vol(v.x, v.z, 90); if (vol > 0.03) Sfx.noise(0.08, v.k === 'heli' ? 200 : 120, 1.5, 0.08 * vol, 'lowpass'); }
      }
    }
    this.seatRiders();
  },
  /** friends riding as passengers sit exactly in their seat on my copy of the vehicle */
  seatRiders() {
    if (!G.vehicles) return;
    for (const pl of this.players.values()) {
      const a = pl.actor, B = pl.buf; if (!a || !B.length) continue;
      const r = B[B.length - 1].ride, v = r ? G.vehicles.byNid(r[0]) : null;
      if (pl.rideKey && (!v || pl.rideKey !== r[0] + ':' + r[1])) { const [nid, i] = pl.rideKey.split(':').map(Number); const ov = G.vehicles.byNid(nid); if (ov && ov.seats && ov.seats[i] && ov.seats[i].who === pl.id) ov.seats[i] = null; pl.rideKey = null; a.netHeliRide = false; }
      if (!v || v.dead || !v.K.pass[r[1]]) continue;
      G.vehicles.netSeat(v, r[1], pl.id); pl.rideKey = r[0] + ':' + r[1];
      const sp = G.vehicles.seatPos(v, r[1]); a.x = sp.x; a.z = sp.z; a.y = sp.y - 0.45; a.st.crouch = true; a.speedNow = 0; a.netHeliRide = v.kind === 'heli';
    }
  },
  remoteShot(pl, m) {
    const W = WEAPONS[m.w]; const a = pl.actor; if (!W || !a || !Array.isArray(m.p) || !Array.isArray(m.o)) return;
    const [x, y, z] = m.o.map(Number); if (![x, y, z].every(Number.isFinite)) return;
    const kind = W.arrow ? 'arrow' : W.rocket ? 'rocket' : 'bullet';
    for (const q of m.p.slice(0, 12)) {
      const ang = +q[0], pitch = +q[1]; if (!Number.isFinite(ang) || !Number.isFinite(pitch)) continue;
      spawnProjectile({ x, z, y, ang, pitch, v3: true, speed: W.speed, dmg: W.dmg, pen: W.pen || 0, range: W.range * 1.15, owner: a, team: a.team, kind, wid: m.w, remote: true });
    }
    a.st.recoil = 1;
    if (G.fx && !W.arrow) G.fx.muzzle(x + Math.cos(+m.p[0][0]) * 0.8, y - 0.2, z + Math.sin(+m.p[0][0]) * 0.8, +m.p[0][0], W.rocket ? 2 : 1);
    Sfx.shot(W.sfx, x, z);
  },
};
void THREE; void rand;

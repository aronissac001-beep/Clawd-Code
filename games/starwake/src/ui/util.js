// ===== util.js : DOM helpers, icons, formatting, settings, saves (localStorage, compressed) =====
const $ = id => document.getElementById(id);
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
// ---------- icons (inline SVG) ----------
const ICON_PATHS = {
  energy: ['#ffd65a', 'M9.5 1 3 9.2h4.2L6 15l7-8.4H8.6z'],
  minerals: ['#ff8a5c', 'M8 1l5.5 4.2L11.3 15H4.7L2.5 5.2zM8 1v14M2.5 5.2h11'],
  food: ['#7ee07a', 'M2.5 13.5C2.5 6 7.5 2 14 2c0 7.5-4.5 11.5-11.5 11.5zM2.5 13.5 9 7'],
  alloys: ['#b9a7ff', 'M1.5 12 4.5 6.5h7l3 5.5zM4.5 6.5 6 3.5h4l1.5 3'],
  goods: ['#ffae5c', 'M2 4.8 8 2l6 2.8v6.6L8 14l-6-2.6zM2 4.8 8 7.6l6-2.8M8 7.6V14'],
  influence: ['#d58cff', 'M3.5 15V1.5M3.5 2h9l-2.2 3.2L12.5 8.5h-9'],
  unity: ['#ff7fb6', 'M8 1.2l1.9 4.4 4.8.4-3.6 3.1 1.1 4.7L8 11.3l-4.2 2.5 1.1-4.7L1.3 6l4.8-.4z'],
  lumen: ['#6fc3ff', 'M8 4.2a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6zM8 1v1.8M8 13.2V15M1 8h1.8M13.2 8H15M3 3l1.3 1.3M11.7 11.7 13 13M13 3l-1.3 1.3M4.3 11.7 3 13'],
  vita: ['#73f0b0', 'M5 1.5c0 4 6 4.5 6 8.5s-6 3.5-6 4.5M11 1.5c0 4-6 4.5-6 8.5M5.5 4h5M5.5 12h5'],
  forge: ['#ffb35c', 'M8 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM7 1h2l.4 1.9 1.6.7 1.6-1 1.4 1.4-1 1.6.7 1.6L15 7v2l-1.9.4-.7 1.6 1 1.6-1.4 1.4-1.6-1-1.6.7L9 15H7l-.4-1.9L5 12.4l-1.6 1L2 12l1-1.6L2.3 9 .4 8.6V7l1.9-.4L3 5 2 3.4 3.4 2 5 3l1.6-.7z'],
  research: ['#8fd8ff', 'M6 1.5h4M6.8 1.5v4.3L2.6 13a1.2 1.2 0 0 0 1 1.8h8.8a1.2 1.2 0 0 0 1-1.8L9.2 5.8V1.5M4.4 10h7.2'],
  menu: ['#e8eaff', 'M2 4h12M2 8h12M2 12h12'],
  pause: ['#e8eaff', 'M5 3v10M11 3v10'],
  list: ['currentColor', 'M5.5 4H14M5.5 8H14M5.5 12H14M2 4h.5M2 8h.5M2 12h.5'],
  crown: ['currentColor', 'M2 12.5 1.5 4.5l3.8 3L8 2.5l2.7 5 3.8-3-.5 8zM2 14.5h12'],
  hands: ['currentColor', 'M1.5 7.5 4.5 4l3.5 1.5L11.5 4l3 3.5M4.5 4v6l3 3 3-3V4M7.5 8l1.5 1.5'],
  ship: ['currentColor', 'M8 1.5 12.5 13 8 11 3.5 13zM8 11v3.5'],
  bell: ['currentColor', 'M4 11.5V7a4 4 0 0 1 8 0v4.5l1.5 1.5h-11zM6.5 14.5h3'],
  galaxy: ['currentColor', 'M8 6.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM8 2c4 0 6 2.5 5.5 5M8 14c-4 0-6-2.5-5.5-5M2.5 9C2.2 5 5 3.3 7.5 4M13.5 7c.3 4-2.5 5.7-5 5'],
  system: ['currentColor', 'M8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM13.5 8a1 1 0 1 1 0 .1'],
  home: ['currentColor', 'M2 8 8 2.5 14 8M3.5 6.8V14h9V6.8M6.5 14v-4h3v4'],
  alert: ['currentColor', 'M8 1.5 15 14H1zM8 6v4M8 11.8v.4'],
  close: ['currentColor', 'M3.5 3.5l9 9M12.5 3.5l-9 9'],
  back: ['currentColor', 'M10 2.5 4.5 8l5.5 5.5'],
  plus: ['currentColor', 'M8 3v10M3 8h10'],
  minus: ['currentColor', 'M3 8h10'],
  swords: ['currentColor', 'M2 2l8 8M14 2 6 10M9 11l-1.5 1.5L10 15l1.5-1.5M7 11l1.5 1.5L6 15l-1.5-1.5'],
  star: ['currentColor', 'M8 1.2l1.9 4.4 4.8.4-3.6 3.1 1.1 4.7L8 11.3l-4.2 2.5 1.1-4.7L1.3 6l4.8-.4z'],
  gear: ['currentColor', 'M8 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM7 1h2l.4 1.9 1.6.7 1.6-1 1.4 1.4-1 1.6.7 1.6L15 7v2l-1.9.4-.7 1.6 1 1.6-1.4 1.4-1.6-1-1.6.7L9 15H7l-.4-1.9L5 12.4l-1.6 1L2 12l1-1.6L2.3 9 .4 8.6V7l1.9-.4L3 5 2 3.4 3.4 2 5 3l1.6-.7z'],
  help: ['currentColor', 'M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM6 6.2C6 4 10 4 10 6.2c0 1.6-2 1.6-2 3.3M8 11.6v.4'],
  pops: ['#cfd6ff', 'M8 2.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 14c0-3 2.2-5 5-5s5 2 5 5z'],
  stab: ['#9be8c4', 'M8 1.5 14 4v4c0 3.5-2.6 5.8-6 6.5C4.6 13.8 2 11.5 2 8V4z'],
  power: ['#ff8f9c', 'M2 2l8 8M14 2 6 10M9 11l-1.5 1.5L10 15l1.5-1.5M7 11l1.5 1.5L6 15l-1.5-1.5'],
};
function icon(name, cls) {
  const d = ICON_PATHS[name] || ICON_PATHS.help, filled = /^(energy|unity|star|alloys|food)$/.test(name);
  const color = d[0];
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 16 16'); el.setAttribute('class', 'i' + (cls ? ' ' + cls : ''));
  el.innerHTML = filled ? `<path d="${d[1]}" fill="${color}" stroke="${color}" stroke-width=".6" stroke-linejoin="round"/>` : `<path d="${d[1]}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  return el;
}
function fmt(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 10000) return Math.round(n / 1000) + 'k';
  if (a >= 1000) return (n / 1000).toFixed(1) + 'k';
  if (a < 10 && a % 1) return n.toFixed(1);
  return String(Math.round(n));
}
function fmtS(n) { return (n >= 0 ? '+' : '−') + fmt(Math.abs(n)); }
function costText(c) { return Object.keys(c).filter(r => c[r]).map(r => fmt(c[r]) + ' ' + RES_INFO[r].name.toLowerCase().replace(' research', '')).join(', '); }
function costEls(c) { return Object.keys(c).filter(r => c[r]).map(r => h('span', { class: 'chip' }, icon(r), fmt(c[r]))); }
function yearsDays(d) { if (d === Infinity) return '∞'; if (d < 60) return Math.ceil(d) + ' days'; if (d < 720) return Math.round(d / 30) + ' months'; return (d / 360).toFixed(1) + ' years'; }
function pct(v) { return Math.round(v * 100) + '%'; }

// ---------- storage ----------
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { localStorage.setItem(k, v); },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } },
};
const Settings = {
  data: { sfx: true, music: true, vol: 0.7, names: true, effects: true, tips: true, tipsSeen: [], autosave: 180, speed: 1, autoCol: true, lastCfg: null, fps: 60 },
  load() { try { Object.assign(this.data, JSON.parse(LS.get('starwake.settings') || '{}')); } catch (e) { /* defaults */ } },
  get(k) { return this.data[k]; },
  set(k, v) { this.data[k] = v; try { LS.set('starwake.settings', JSON.stringify(this.data)); } catch (e) { /* storage unavailable */ } },
};
Settings.load();
// LZW over UTF-16 code units, 15-bit output codes kept in a safe range for localStorage
const LZ = {
  pack(str) {
    const dict = new Map(); let next = 256, w = '', out = [];
    for (let i = 0; i < str.length; i++) {
      const c = str[i], wc = w + c;
      if (dict.has(wc) || (wc.length === 1 && wc.charCodeAt(0) < 256)) { w = wc; continue; }
      out.push(w.length === 1 ? w.charCodeAt(0) : dict.get(w));
      if (next < 32767) dict.set(wc, next++); else { dict.clear(); next = 256; }
      w = c;
    }
    if (w) out.push(w.length === 1 ? w.charCodeAt(0) : dict.get(w));
    return out;
  },
  unpack(codes) {
    let dict = []; let next = 256; const ch = c => c < 256 ? String.fromCharCode(c) : dict[c];
    if (!codes.length) return '';
    let w = ch(codes[0]), out = [w];
    for (let i = 1; i < codes.length; i++) {
      const k = codes[i];
      let entry;
      if (k < 256) entry = String.fromCharCode(k); else if (dict[k] !== undefined && k < next) entry = dict[k]; else if (k === next) entry = w + w[0]; else throw new Error('Bad save data');
      out.push(entry);
      if (next < 32767) dict[next++] = w + entry[0]; else { dict = []; next = 256; }
      w = entry;
    }
    return out.join('');
  },
  // non-ASCII characters are escaped first so every input code unit is < 256
  esc(s) { return s.replace(/[^\x00-\xff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')); },
  toStore(str) { const codes = this.pack(this.esc(str)); let s = ''; for (let i = 0; i < codes.length; i += 4096) s += String.fromCharCode.apply(null, codes.slice(i, i + 4096).map(c => c + 0x100)); return 'Z1' + s; },
  fromStore(s) { if (!s.startsWith('Z1')) return s; const codes = []; for (let i = 2; i < s.length; i++) codes.push(s.charCodeAt(i) - 0x100); return this.unpack(codes); },
  toText(str) {
    const codes = this.pack(this.esc(str)); let bin = '';
    for (const c of codes) bin += String.fromCharCode(c >> 8, c & 255);
    return 'SWK1:' + btoa(bin);
  },
  fromText(t) {
    t = t.trim(); if (!t.startsWith('SWK1:')) throw new Error('Not a Starwake save code');
    const bin = atob(t.slice(5).replace(/\s+/g, '')); const codes = [];
    for (let i = 0; i + 1 < bin.length; i += 2) codes.push((bin.charCodeAt(i) << 8) | bin.charCodeAt(i + 1));
    return this.unpack(codes);
  },
};
const Saves = {
  AUTO: ['auto1', 'auto2', 'auto3'], MANUAL: ['m1', 'm2', 'm3', 'm4', 'm5'],
  key(s) { return 'starwake.save.' + s; },
  meta(s) { try { return JSON.parse(LS.get(this.key(s) + '.meta')); } catch (e) { return null; } },
  read(s) { const d = LS.get(this.key(s)); if (!d) return null; return LZ.fromStore(d); },
  write(s, G) {
    try {
      const json = SW.serializeGame(G), data = LZ.toStore(json), e = G.empires[UI.pid];
      const meta = { day: G.day, name: e.name, size: G.cfg.size, date: Date.now(), cols: SW.colonies(G, e).length, bytes: data.length * 2, over: G.over };
      try { LS.set(this.key(s), data); }
      catch (err) {
        const olds = this.AUTO.filter(x => x !== s && this.meta(x)).sort((a, b) => this.meta(a).date - this.meta(b).date);
        if (!olds.length) throw err;
        let ok = false; for (const x of olds) { this.remove(x); try { LS.set(this.key(s), data); ok = true; break; } catch (e2) { /* still full */ } }
        if (!ok) throw err;
      }
      LS.set(this.key(s) + '.meta', JSON.stringify(meta));
      return null;
    } catch (err) {
      return /quota/i.test(String(err && (err.name + err.message))) ? 'Storage is full. Delete an old save and try again.' : 'Could not save: ' + (err && err.message || err);
    }
  },
  remove(s) { LS.del(this.key(s)); LS.del(this.key(s) + '.meta'); },
  pickAuto() { let best = this.AUTO[0], bd = Infinity; for (const s of this.AUTO) { const m = this.meta(s); const d = m ? m.date : -1; if (d < bd) { bd = d; best = s; } } return best; },
  latest() { let best = null, bd = -1; for (const s of this.AUTO.concat(this.MANUAL)) { const m = this.meta(s); if (m && !m.over && m.date > bd) { bd = m.date; best = s; } } return best; },
};

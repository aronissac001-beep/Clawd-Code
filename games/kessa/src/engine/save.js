// ===== save.js : serialization (JSON with run-length encoded grids) =====
function rle(a) { let out = '', i = 0; while (i < a.length) { const v = a[i]; let n = 1; while (i + n < a.length && a[i + n] === v && n < 4000) n++; out += v + (n > 1 ? '*' + n : '') + ','; i += n; } return out; }
function unrle(s, N) { const a = new Uint8Array(N); let i = 0; for (const tok of s.split(',')) { if (!tok) continue; const [v, n] = tok.split('*'); const c = n ? +n : 1; a.fill(+v, i, i + c); i += c; } return a; }
function serialize(G) {
  syncRng(G);
  return JSON.stringify(G, (k, v) => {
    if (k && k[0] === '_') return undefined;
    if (v && v.constructor && v.constructor.name === 'Uint8Array') return { u8: rle(v) };
    return v;
  });
}
function deserialize(str) {
  const G = JSON.parse(str);
  if (!G || G.format !== SAVE_FORMAT || !G.seed) throw new Error('Not a Kessa Colony save');
  for (const k of ['cable', 'pipe']) G[k] = unrle(G[k].u8, MAP_N * MAP_N);
  hydrate(G);
  G._jobsDirty = false;
  return G;
}
function exportText(G) { const s = serialize(G); return 'KESSA1:' + btoa(unescape(encodeURIComponent(s))); }
function importText(t) {
  t = String(t).trim();
  if (t.startsWith('KESSA1:')) t = decodeURIComponent(escape(atob(t.slice(7).replace(/\s+/g, ''))));
  return deserialize(t);
}
Object.assign(KC, { serialize, deserialize, exportText, importText });

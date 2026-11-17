const R = new URL('../../../classic/js/', import.meta.url).href;
const size = +(process.argv[2] || 128);
const { BAL } = await import(R + 'data/balance.js'); BAL.mapSize = size;
await import(R + 'game/content.js');
const { createRun } = await import(R + 'game/state.js');
const { N, idx } = await import(R + 'game/grid.js');
const zlib = await import('node:zlib');
const s = createRun({ seedText: 'BENCH-1' });
const NN = N * N;
// Layered per-tile encoding: terrain(u8), node kind+variant(u8), node amount(u8), fog(bit), occ is derivable from buildings.
const ter = s.terrain, nk = new Uint8Array(NN), na = new Uint8Array(NN), fog = new Uint8Array(NN >> 3);
for (const n of s.nodes) { const i = idx(n.tx, n.ty); nk[i] = (n.kind === 'tree' ? 1 : 2) | ((n.v & 15) << 2); na[i] = Math.min(255, n.amount); }
for (let i = 0; i < NN; i++) if (s.fog[i]) fog[i >> 3] |= 1 << (i & 7);
const raw = Buffer.concat([Buffer.from(ter), Buffer.from(nk), Buffer.from(na), Buffer.from(fog)]);
const def = zlib.deflateRawSync(raw, { level: 9 });
console.log(`N=${N} raw layers ${raw.length} B, deflate ${def.length} B, base64 ${Math.ceil(def.length / 3) * 4} B (vs JSON of same ${JSON.stringify({ t: Array.from(ter), n: s.nodes, f: Array.from(s.fog) }).length} B)`);
// Worst-ish case: 3 depth layers (surface + 2 underground) with tunnels, items per tile u16
const layers = 3; const items = new Uint16Array(NN);
for (let i = 0; i < 600; i++) items[(i * 7919) % NN] = 1 + (i % 40);
const raw2 = Buffer.concat([...Array(layers)].flatMap(() => [Buffer.from(ter), Buffer.from(nk), Buffer.from(na)]).concat([Buffer.from(items.buffer)]));
console.log(`  ${layers} layers + item grid raw ${raw2.length} B, deflate ${zlib.deflateRawSync(raw2, { level: 9 }).length} B`);

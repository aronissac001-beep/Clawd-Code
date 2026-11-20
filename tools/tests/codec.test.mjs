import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../js/game/save/codec.js';

const sample = (n) => { const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = i % 9 < 5 ? 9 : (i * 131) & 255; return a; };

test('crc32 matches the IEEE check value', () => {
  assert.equal(C.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('RLE round trips edge sizes', () => {
  for (const n of [0, 1, 2, 3, 4, 127, 128, 129, 130, 131, 1000, 65537]) {
    const a = sample(n); assert.deepEqual(C.rleDecode(C.rleEncode(a)), a, String(n));
    const z = new Uint8Array(n); assert.deepEqual(C.rleDecode(C.rleEncode(z)), z, 'zeros ' + n);
  }
});

test('blob round trip with deflate, RLE and none; text form', async () => {
  const p = sample(40000), h = { stateVersion: 1, w: 128, h: 128, tick: 123456 };
  for (const comp of [C.COMP.DEFLATE, C.COMP.RLE, C.COMP.NONE]) {
    const b = await C.encodeBlob(h, p, comp);
    const { header, payload } = await C.decodeBlob(b);
    assert.equal(header.comp, comp); assert.equal(header.tick, 123456); assert.equal(header.w, 128);
    assert.deepEqual(payload, p);
    assert.deepEqual(C.textToBlob(C.blobToText(b)), b);
  }
  const sync = C.encodeBlobSync(h, p);
  assert.deepEqual(C.decodeBlobSync(sync).payload, p);
});

test('damaged, foreign and newer blobs are refused with a readable reason', async () => {
  const b = await C.encodeBlob({ stateVersion: 1, w: 128, h: 128, tick: 1 }, sample(500), C.COMP.RLE);
  const bad = b.slice(); bad[bad.length - 3] ^= 0xff;
  assert.throws(() => C.readHeader(bad), /damaged/);
  assert.throws(() => C.readHeader(new Uint8Array(40)), /Not an Embercrown save/);
  const newer = b.slice(); newer[4] = 99;
  assert.throws(() => C.readHeader(newer), /newer/);
  assert.throws(() => C.textToBlob('hello'), /EC2:/);
});

test('payload framing keeps the 11.3 layer order', () => {
  const layers = {}; for (const l of ['terrain', 'mat', 'ore', 'floor', 'roof', 'plant', 'growth', 'blight', 'zone', 'desig', 'fog', 'known']) layers[l] = sample(l === 'fog' || l === 'known' ? 32 : 256);
  const f = C.framePayload(layers, '{"a":1}', '{"b":2}');
  const u = C.unframePayload(f);
  assert.deepEqual(u.layers, layers); assert.equal(u.entities, '{"a":1}'); assert.equal(u.runtime, '{"b":2}');
  assert.equal(f[0], 1); // terrain first
});

// ---- EC3 (EMBERCROWN-FORTRESS.md 5.1; Stage Z1 step E8) ---------------------------------------------------
import { stubFortress, digFortress, deepPath } from './fortress-stub.mjs';
import { saveBlob, loadBlob, saveBlobSync, loadBlobSync, snapshot } from '../../js/game/save/colonysave.js';
import { createColony, stateHash, checkState } from '../../js/game/core/state.js';

const rnd = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

test('EC3 chunk XOR: encode then apply restores every layer, on aligned and ragged maps, bytes and bitsets', () => {
  for (const [w, h, d] of [[128, 128, 3], [40, 24, 3], [16, 16, 1], [96, 80, 2]]) {
    const g = C.chunkGeom(w, h, d), r = rnd(w * 7 + d);
    assert.equal(g.mapBytes, Math.ceil(Math.ceil(w / 16) * Math.ceil(h / 16) * d / 8));
    for (const bitset of [false, true]) {
      const len = bitset ? (g.n + 7) >> 3 : g.n;
      const base = new Uint8Array(len).map(() => (r() < 0.5 ? (r() * 256) | 0 : 0));
      const cur = base.slice();
      for (let k = 0; k < 40; k++) { const i = (r() * len) | 0; cur[i] ^= 1 + ((r() * 255) | 0); }
      if (bitset && g.n & 7) { cur[len - 1] &= (1 << (g.n & 7)) - 1; base[len - 1] &= (1 << (g.n & 7)) - 1; }
      for (const b of [base, null]) {
        const enc = C.xorEncode(g, cur, b, bitset);
        const out = C.xorApply(g, b ? b.slice() : new Uint8Array(len), enc, bitset);
        assert.deepEqual(out, cur, `${w}x${h}x${d} ${bitset ? 'bits' : 'bytes'} ${b ? 'xor' : 'zero'}`);
      }
      assert.equal(C.xorEncode(g, base, base, bitset).length, g.mapBytes, 'an unchanged layer is only its bitmap');
    }
  }
  assert.equal(C.chunkGeom(128, 128, 20).mapBytes, 160, '160 B bitmap at D = 20 (5.1)');
});

test('EC3 header: 85 bytes, every field round-trips; damaged and newer blobs are refused; EC3 text form', async () => {
  const h = { format: 3, stateVersion: 3, w: 128, h: 128, d: 20, zS: 14, genVersion: 7, worldKind: 3, flags: 1, tick: 987654, pristineId: 0xdeadbeef, pristineCrc: [...Array(13).keys()].map((k) => (k * 0x1234567) >>> 0) };
  const b = await C.encodeBlob(h, sample(3000), C.COMP.RLE);
  assert.equal(C.HEADER3_BYTES, 85); assert.equal(C.blobKind(b), 'EC3');
  const { header } = C.readHeader3(b);
  for (const k of ['stateVersion', 'w', 'h', 'd', 'zS', 'genVersion', 'worldKind', 'flags', 'tick', 'pristineId']) assert.equal(header[k], h[k], k);
  assert.deepEqual(header.pristineCrc, h.pristineCrc);
  assert.deepEqual((await C.decodeAny(b)).payload, sample(3000));
  const bad = b.slice(); bad[bad.length - 2] ^= 0x40; assert.throws(() => C.readHeader3(bad), /damaged/);
  const newer = b.slice(); newer[4] = 9; assert.throws(() => C.readHeader3(newer), /newer/);
  const t = C.blobToText(b); assert.ok(t.startsWith('EC3:')); assert.deepEqual(C.textToBlob(t), b);
  assert.equal(C.blobKind(await C.encodeBlob({ stateVersion: 3, w: 128, h: 128, tick: 1 }, sample(10))), 'EC2');
});

test('a 20-level stub fortress round-trips byte-identical (deflate and RLE), to the same hash, u32 paths kept', async () => {
  const s = digFortress(stubFortress(7)); deepPath(s);
  assert.deepEqual(checkState(s), []);
  const h0 = stateHash(s);
  const b = await saveBlob(s);
  assert.equal(C.blobKind(b), 'EC3');
  const s2 = await loadBlob(b);
  assert.equal(stateHash(s2), h0);
  assert.equal(s2.d, 20); assert.equal(s2.zS, 14);
  assert.ok(s2.col[0].path.tiles instanceof Uint32Array && s2.col[0].path.tiles[14] === 60 * 128 + 60, 'the path reaches z = 0');
  assert.ok(s2.col[0].path.tiles[0] > 65535 && s2.col[0].path.i === 3 && s2.col[1].path.i === -1);
  assert.deepEqual(s2.L.fluid, s.L.fluid);
  assert.deepEqual(await saveBlob(s2), b, 'save, load, save: byte-identical');
  const r = saveBlobSync(s);
  assert.deepEqual(saveBlobSync(loadBlobSync(r)), r, 'RLE quick-save byte-identical');
  // raw encodings (0, 1) still load
  const { header, payload } = snapshot(s, { raw: true });
  assert.equal(stateHash(loadBlobSync(C.encodeBlobSync(header, payload, C.COMP.NONE))), h0);
});

test('EC3 sizes: the map payload of the dug stub fortress is far below 30 KB; a D = 1 colony still saves EC2', async () => {
  const s = digFortress(stubFortress(7));
  const { payload } = snapshot(s);
  const sec = C.unframePayload3(payload, false);
  const layerBytes = C.LAYERS3.reduce((n, l) => n + 6 + sec.layers[l.name].bytes.length, 0);
  const mapDeflated = (await C.deflateRaw(payload.subarray(0, layerBytes))).length;
  assert.ok(mapDeflated < 30 * 1024, `map payload ${mapDeflated} B deflated`);
  const t0 = performance.now(); for (let k = 0; k < 5; k++) snapshot(s); const ms = (performance.now() - t0) / 5;
  console.log(`# EC3 stub fortress: map ${layerBytes} B raw, ${mapDeflated} B deflated; blob ${(await saveBlob(s)).length} B; snapshot ${ms.toFixed(1)} ms`);
  const flat = createColony(3);
  assert.equal(C.blobKind(await saveBlob(flat)), 'EC2');
  assert.equal(stateHash(await loadBlob(await saveBlob(flat))), stateHash(flat));
});

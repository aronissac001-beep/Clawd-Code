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

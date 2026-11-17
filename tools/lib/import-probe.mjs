// Child process for check-imports: import ONE module with traps installed and report what the
// import did. Prints one JSON line: { ok, error, allocs, globals, timers, console }.
//   node tools/lib/import-probe.mjs <absolute or repo-relative path>
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const THRESH = 4096; // elements: anything this big at import is a map-sized buffer (D1)
const file = resolve(process.argv[2]);
const report = { file: process.argv[2], ok: true, error: null, allocs: [], globals: [], timers: 0, console: 0 };
const before = new Set(Object.getOwnPropertyNames(globalThis));
const saved = {};
const TYPED = ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array'];
const where = () => (new Error().stack || '').split('\n').slice(3, 5).map((l) => l.trim()).join(' < ');
for (const name of TYPED) {
  const Orig = globalThis[name];
  saved[name] = Orig;
  globalThis[name] = new Proxy(Orig, { construct(t, args, nt) { if (typeof args[0] === 'number' && args[0] >= THRESH) report.allocs.push(`${name}(${args[0]}) at ${where()}`); return Reflect.construct(t, args, nt === globalThis[name] ? t : nt); } });
}
for (const name of ['Array', 'ArrayBuffer']) {
  const Orig = globalThis[name];
  saved[name] = Orig;
  const chk = (args) => { if (typeof args[0] === 'number' && args.length === 1 && args[0] >= (name === 'ArrayBuffer' ? THRESH * 4 : THRESH)) report.allocs.push(`${name}(${args[0]}) at ${where()}`); };
  globalThis[name] = new Proxy(Orig, { construct(t, args) { chk(args); return Reflect.construct(t, args); }, apply(t, self, args) { chk(args); return Reflect.apply(t, self, args); } });
}
for (const name of ['setTimeout', 'setInterval', 'setImmediate']) {
  const Orig = globalThis[name]; saved[name] = Orig;
  globalThis[name] = (...a) => { report.timers++; return Orig(...a); };
}
const con = {};
for (const k of ['log', 'warn', 'error', 'info']) { con[k] = console[k]; console[k] = () => { report.console++; }; }
try {
  await import(pathToFileURL(file).href);
} catch (e) {
  report.ok = false; report.error = (e && (e.stack || e.message)) ? String(e.stack || e.message).split('\n').slice(0, 4).join(' | ') : String(e);
}
for (const k of Object.keys(saved)) globalThis[k] = saved[k];
for (const k of Object.keys(con)) console[k] = con[k];
report.globals = Object.getOwnPropertyNames(globalThis).filter((k) => !before.has(k));
process.stdout.write(JSON.stringify(report) + '\n');
// A module that left timers or handles open must not keep the probe alive.
process.exit(0);

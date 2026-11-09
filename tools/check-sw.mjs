// Verifies sw.js lists every shipped file (and nothing missing on disk).
//   node tools/check-sw.mjs
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
const sw = readFileSync('sw.js', 'utf8');
const listed = new Set([...sw.matchAll(/'(\.\/[^']*)'/g)].map((m) => m[1]));
const walk = (d) => readdirSync(d).flatMap((f) => { const p = d + '/' + f; return statSync(p).isDirectory() ? walk(p) : [p]; });
const shipped = ['css', 'js', 'icons'].flatMap(walk).map((p) => './' + p);
let bad = 0;
for (const f of shipped) if (!listed.has(f)) { console.log('missing from sw.js:', f); bad++; }
for (const f of listed) if (f !== './' && !existsSync(f.slice(2))) { console.log('listed but not on disk:', f); bad++; }
console.log(bad ? `${bad} problem(s)` : `sw.js OK (${listed.size} entries)`);
process.exit(bad ? 1 : 0);

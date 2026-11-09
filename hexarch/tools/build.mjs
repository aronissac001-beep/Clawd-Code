// Inlines the source files into one self-contained HTML file: docs/hexarch/index.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineSource } from './load-engine.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = p => fs.readFileSync(path.join(here, '../src', p), 'utf8');
const UI_FILES = ['storage.js', 'render.js', 'input.js', 'app.js', 'menus.js'];
const ui = UI_FILES.map(f => src('ui/' + f)).join('\n');
const engine = engineSource();
for (const [name, code] of [['engine', engine], ['ui', ui]]) if (/<\/script/i.test(code)) throw new Error(name + ' contains a closing script tag');
let html = src('index.template.html');
html = html.replace('/*@@CSS@@*/', () => src('ui/style.css')).replace('/*@@ENGINE@@*/', () => engine).replace('/*@@UI@@*/', () => ui);
const out = path.join(here, '../../docs/hexarch/index.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`wrote ${path.relative(process.cwd(), out)} (${(html.length / 1024).toFixed(0)} KB, ${html.split('\n').length} lines)`);

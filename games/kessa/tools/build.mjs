// Inlines the sources into one self-contained HTML file: docs/kessa/index.html
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { engineSource, ENGINE_FILES } from './load-engine.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = p => fs.readFileSync(path.join(here, '../src', p), 'utf8');
export const UI_FILES = ['storage.js', 'audio.js', 'art.js', 'render.js', 'input.js', 'app.js', 'hud.js', 'panels.js', 'panels2.js', 'menus.js', 'tips.js', 'main.js'];
// refuse to build a page with a syntax error in any source file
for (const f of ENGINE_FILES) new vm.Script(src('engine/' + f), { filename: 'engine/' + f });
for (const f of UI_FILES) new vm.Script(src('ui/' + f), { filename: 'ui/' + f });
const engine = engineSource(), ui = UI_FILES.map(f => src('ui/' + f)).join('\n');
new vm.Script(engine + '\n' + ui, { filename: 'combined.js' });
for (const [name, code] of [['engine', engine], ['ui', ui]]) if (/<\/script/i.test(code)) throw new Error(name + ' contains a closing script tag');
let html = src('index.template.html');
html = html.replace('/*@@CSS@@*/', () => src('ui/style.css')).replace('/*@@ENGINE@@*/', () => engine).replace('/*@@UI@@*/', () => ui);
const ext = html.match(/(src|href)\s*=\s*["']https?:[^"']*/g);
if (ext) throw new Error('external resource referenced: ' + ext.join(', '));
const out = path.join(here, '../../../docs/kessa/index.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`wrote ${path.relative(process.cwd(), out)} (${(html.length / 1024).toFixed(0)} KB, ${html.split('\n').length} lines)`);

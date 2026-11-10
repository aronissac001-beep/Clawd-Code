// Inlines the source files into one self-contained HTML file: docs/exodus/index.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineSource } from './load-engine.mjs';
import vm from 'node:vm';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = p => fs.readFileSync(path.join(here, '../src', p), 'utf8');
const UI_FILES = ['storage.js', 'audio.js', 'sprites.js', 'render.js', 'input.js', 'app.js', 'screens.js', 'webui.js', 'victory.js', 'tips.js', 'quotes.js', 'codex.js', 'rogue.js', 'menus.js'];
const ui = UI_FILES.map(f => src('ui/' + f)).join('\n');
const engine = engineSource();
for (const [name, code] of [['engine', engine], ['ui', ui]]) if (/<\/script/i.test(code)) throw new Error(name + ' contains a closing script tag');
// refuse to build a page with a syntax error in any source file
for (const f of UI_FILES) new vm.Script(src('ui/' + f), { filename: 'ui/' + f });
new vm.Script(engine + '\n' + ui, { filename: 'combined.js' });
let html = src('index.template.html');
html = html.replace('/*@@CSS@@*/', () => src('ui/style.css')).replace('/*@@ENGINE@@*/', () => engine).replace('/*@@UI@@*/', () => ui);
const out = path.join(here, '../../../docs/exodus/index.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`wrote ${path.relative(process.cwd(), out)} (${(html.length / 1024).toFixed(0)} KB, ${html.split('\n').length} lines)`);

// Optional: a body-only variant for hosts that supply their own document head (claude.ai artifacts).
if (process.env.ARTIFACT_OUT) {
  const style = html.match(/<style>[\s\S]*?<\/style>/)[0].replace('<style>', '<style>\n:root { color-scheme: dark; }');
  const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
  const page = '<title>Hexarch: Exodus</title>\n<meta name="apple-mobile-web-app-title" content="Exodus">\n<meta name="theme-color" content="#0a0716">\n' +
    '<link rel="apple-touch-icon" id="touchicon" href="data:,">\n' + style + '\n' + body;
  fs.writeFileSync(process.env.ARTIFACT_OUT, page);
  console.log(`wrote ${process.env.ARTIFACT_OUT} (${(page.length / 1024).toFixed(0)} KB)`);
}

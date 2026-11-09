// Loads the engine scripts into a VM context for headless tests and simulation.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
export const ENGINE_FILES = ['core.js', 'data.js', 'mapgen.js', 'game.js', 'ai.js'];
export function engineSource() {
  return ENGINE_FILES.map(f => fs.readFileSync(path.join(here, '../src/engine', f), 'utf8')).join('\n');
}
export function loadEngine() {
  const ctx = vm.createContext({ console, btoa, atob, Math, Date });
  vm.runInContext(engineSource(), ctx, { filename: 'engine.js' });
  const ev = (s) => vm.runInContext(s, ctx);
  return { HX: ctx.HX, ev, ctx };
}

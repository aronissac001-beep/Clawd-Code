// Loads the engine scripts into a VM context for headless tests and simulation.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
export const ENGINE_FILES = ['core.js', 'data.js', 'techdata.js', 'shipdata.js', 'galaxy.js', 'game.js', 'economy.js', 'research.js', 'ships.js', 'combat.js', 'diplomacy.js', 'events.js', 'actors.js', 'victory.js', 'ai.js'];
export function engineSource() {
  const dir = process.env.STARWAKE_ENGINE_DIR || path.join(here, '../src/engine');
  return ENGINE_FILES.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
}
export function loadEngine() {
  const ctx = vm.createContext({ console, Math, Date, JSON });
  vm.runInContext(engineSource() + '\n;globalThis.__ev = (s) => eval(s);', ctx, { filename: 'engine.js' });
  const ev = (s) => ctx.__ev(s);
  return { SW: ctx.SW, ev, ctx };
}

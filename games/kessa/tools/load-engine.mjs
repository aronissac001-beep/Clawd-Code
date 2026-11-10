// Loads the engine scripts into a VM context for headless tests and the bot player.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
export const ENGINE_FILES = ['core.js', 'data.js', 'tech.js', 'mapgen.js', 'game.js', 'sim.js', 'colonists.js', 'rockets.js', 'vehicles.js', 'hazards.js', 'goals.js', 'save.js'];
export function engineSource() {
  return ENGINE_FILES.map(f => fs.readFileSync(path.join(here, '../src/engine', f), 'utf8')).join('\n');
}
export function loadEngine(withBot = true) {
  const ctx = vm.createContext({ console, btoa, atob, escape, unescape, Math, Date });
  vm.runInContext(engineSource(), ctx, { filename: 'engine.js' });
  if (withBot) vm.runInContext(fs.readFileSync(path.join(here, 'bot.js'), 'utf8'), ctx, { filename: 'bot.js' });
  const ev = (s) => vm.runInContext(s, ctx);
  return { KC: ctx.KC, ev, ctx };
}

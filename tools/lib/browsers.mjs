// Playwright browser launch helpers. The gate's browser checks run in WebKit (JavaScriptCore, the
// iPhone engine); when the WebKit build is not installed they say so (exit code 2 = unavailable)
// instead of passing, and can run in Chromium as a stand-in with --browser=chromium.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
const pw = createRequire(import.meta.url)('playwright');

export const installed = (name) => { try { return existsSync(pw[name].executablePath()); } catch (_) { return false; } };
export const UNAVAILABLE = 2;

/** Launch `name` ('webkit' | 'chromium'). Returns null when that browser is not installed. */
export async function launch(name = 'webkit') {
  if (!pw[name] || !installed(name)) return null;
  return pw[name].launch();
}
export const devices = pw.devices;
export function browserArg(def = 'webkit') {
  const a = process.argv.find((x) => x.startsWith('--browser='));
  return a ? a.split('=')[1] : def;
}

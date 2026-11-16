// ============================================================================
// ZONEFALL 3 — boot: load model modules (with graceful fallbacks), wire them
// into every system, start the renderer + menu, register the service worker.
// ============================================================================
import { G } from './state.js';
import { ITEMS } from './data.js';
import { Game } from './game.js';
import { UI, setUiModels } from './ui.js';
import { Tut } from './tutorial.js';
import { setActorModels } from './actors.js';
import { setBuildModels } from './build.js';
import { setDoorModels } from './doors.js';
import { setLiveModels } from './world/live.js';
import { setVegModels } from './gfx/veg.js';
import { Bots } from './bots.js';
import { $ } from './util.js';
import { Build } from './build.js';
import { Live } from './world/live.js';
import * as PL from './player.js';
import { spawnActor } from './actors.js';
import * as EV from './events.js';
import * as CB from './combat.js';

async function boot() {
  const status = t => { const l = document.querySelector('#loading p'); if (l) l.textContent = t; };
  status('Loading models…');
  let chars = null, world = null, mons = null;
  try { chars = await import('./gfx/models_chars.js'); } catch (e) { console.warn('character models unavailable', e); }
  try { world = await import('./gfx/models_world.js'); } catch (e) { console.warn('world models unavailable', e); }
  try { mons = await import('./world/monuments.js'); } catch (e) { console.warn('monument layouts unavailable', e); }
  const Models = Object.assign({}, world || {}, chars || {});
  G.models = Models;
  setActorModels(chars ? Models : null); setBuildModels(world ? Models : null); setDoorModels(world ? Models : null); setVegModels(world ? Models : null);
  setLiveModels(world ? Models : null, mons ? mons.LAYOUTS : null); setUiModels(Models);
  // pixel icons (classic scripts)
  window.ITEMS = ITEMS; try { window.ART && ART.init(); } catch (e) { console.warn(e); }
  G.ui = UI; G.game = Game; G.tut = Tut; G.bots = Bots;
  status('Generating the island…');
  await new Promise(r => setTimeout(r, 30));
  Game.init($('#view'));
  // a world for the title-screen flyover
  let seed = (Math.random() * 1e9) | 0; try { const sv = JSON.parse(localStorage.getItem('zonefall_run_v3')); if (sv && sv.run) seed = sv.run.seed; } catch (e) { }
  try { Game.setupWorld(seed); } catch (e) { console.error(e); }
  G.mode = 'menu';
  UI.init();
  $('#loading').classList.add('hidden');
  // tutorial skip
  $('#tut').addEventListener('click', e => { if (e.target && e.target.id === 'tut-skip') Tut.finish(); });
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('visibilitychange', () => { if (document.hidden && G.mode === 'play') Game.save(); });
  addEventListener('pagehide', () => { if (G.mode === 'play') Game.save(); });
  document.title = 'Zonefall';
  window.__ZF = G; G.build = Build; window.__ZT = { Build, Live, PL, spawnActor, EV, CB }; // debugging / tests
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !location.search.includes('nosw')) navigator.serviceWorker.register('./sw.js').catch(() => { });
}
boot().catch(e => { console.error(e); const l = document.querySelector('#loading p'); if (l) l.textContent = 'Failed to start: ' + e.message; });

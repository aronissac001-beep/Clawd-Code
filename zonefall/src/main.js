// ============================================================================
// ZONEFALL 3 — boot: load model modules (with graceful fallbacks), wire them
// into every system, start the renderer + menu, register the service worker.
// ============================================================================
import { registerFishingIcons } from './fishing.js';
import { registerWeaponsIcons } from './weapons_extra.js';
import { Cargo } from './cargo.js';
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
  let vmMod = null, skyMod = null, grassMod = null, waterMod = null;
  try { vmMod = await import('./fp/viewmodel.js'); } catch (e) { console.warn('viewmodel unavailable', e); }
  try { skyMod = await import('./gfx/sky.js'); } catch (e) { console.warn('sky unavailable', e); }
  try { grassMod = await import('./gfx/grass.js'); } catch (e) { console.warn('grass unavailable', e); }
  try { waterMod = await import('./gfx/water.js'); } catch (e) { console.warn('water unavailable', e); }
  G.fpMods = { Grass: grassMod && grassMod.Grass, makeWater: waterMod && waterMod.makeWater };
  const Models = Object.assign({}, world || {}, chars || {});
  G.models = Models;
  setActorModels(chars ? Models : null); setBuildModels(world ? Models : null); setDoorModels(world ? Models : null); setVegModels(world ? Models : null);
  setLiveModels(world ? Models : null, mons ? mons.LAYOUTS : null); setUiModels(Models);
  // pixel icons (classic scripts)
  window.ITEMS = ITEMS;
  /* global ART */ try { const A = typeof ART !== 'undefined' ? ART : window.ART; if (A) { window.ART = A; A.ready = false; A.init(); try { registerFishingIcons(A); } catch (e) { console.warn('fish icons', e); } try { registerWeaponsIcons(A); } catch (e) { console.warn('weapon icons', e); } } else console.warn('icon library missing'); } catch (e) { console.warn(e); }
  G.ui = UI; G.game = Game; G.tut = Tut; G.bots = Bots;
  status('Generating the island…');
  await new Promise(r => setTimeout(r, 30));
  Game.init($('#view'));
  // eye-level sky (kept across worlds) + first-person viewmodel
  if (skyMod && skyMod.Sky) { try { const before = new Set(G.scene.children); G.rend.sky = new skyMod.Sky(G.scene); G.keepObjs = G.scene.children.filter(o => !before.has(o)); } catch (e) { console.warn('sky failed', e); G.rend.sky = null; } }
  if (vmMod && vmMod.ViewModel) { try { G.vm = new vmMod.ViewModel(chars ? { makeHeld: chars.makeHeld, HELD_INFO: chars.HELD_INFO } : null); G.rend.overlay = { active: () => !!(G.vm && !G.vm.hidden && G.mode === 'play'), render: (r, aspect) => { if (G.vm && !G.vm.hidden && G.mode === 'play') G.vm.render(r, aspect, G.rend.camera); }, get camera() { return G.vm ? G.vm.camera : null; } }; } catch (e) { console.warn('viewmodel failed', e); G.vm = null; } }
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
  window.__ZF = G; G.build = Build; window.__ZT = { Build, Live, PL, spawnActor, EV, CB, Cargo }; // debugging / tests
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !location.search.includes('nosw')) navigator.serviceWorker.register('./sw.js').catch(() => { });
}
boot().catch(e => { console.error(e); const l = document.querySelector('#loading p'); if (l) l.textContent = 'Failed to start: ' + e.message; });

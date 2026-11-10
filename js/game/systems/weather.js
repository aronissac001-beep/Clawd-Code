// Weather (Phase 3): each dawn the region RNG rolls the weather two days ahead,
// so the forecast is always known 1-2 days in advance:
//   s.ext.weather = { today, queue: [tomorrow, dayAfter], next, bolt, strike, strikes }
// and the forecast carries over to the next region (run.ext.wxCarry = { day, kinds }).
// Kinds: clear, rain, fog, storm, heat (summer only), snow (winter only), with
// season weights and the storyteller's taste for extremes (WEATHER below).
// Storms throw telegraphed lightning: a 2 s warning circle (bolt), then a strike
// that hurts everything within a tile. Deterministic: region RNG only.
import { BUS } from '../hooks.js';
import { T, N, distToRect } from '../grid.js';
import { emit, hurt, hurtBuilding } from './common.js';
import { SEASONS, seasonIndexForDay, calendarDay, register as registerSeasons } from './seasons.js';

/** Tuning for every kind of weather. */
export const WEATHER = {
  kinds: ['clear', 'rain', 'fog', 'storm', 'heat', 'snow'],
  // Relative chances per season (index 0 spring .. 3 winter).
  weights: {
    spring: { clear: 4, rain: 3, fog: 2, storm: 1, heat: 0, snow: 0 },
    summer: { clear: 5, rain: 1.5, fog: 0.5, storm: 1.5, heat: 2, snow: 0 },
    autumn: { clear: 3, rain: 3, fog: 2.5, storm: 1.5, heat: 0, snow: 0 },
    winter: { clear: 3.5, rain: 0, fog: 2, storm: 0.5, heat: 0, snow: 3.5 },
  },
  extreme: { storm: 1, heat: 1, snow: 1 },          // scaled by the storyteller
  storyteller: { jester: 2, gentle: 0.5 },          // multiplier on extreme weights
  firstDayClear: true,                              // the run's very first day is fair
  clear: { name: 'Clear', text: 'Fair skies. No effects.' },
  rain: { name: 'Rain', fire: 0.75, farm: 1.2, text: 'Fire deals 25% less damage; farms yield 20% more.' },
  fog: { name: 'Fog', sight: 0.6, text: 'Sight is cut to 60%: the fog of war lifts more slowly.' },
  storm: {
    name: 'Storm', every: [6, 12], warn: 2, dmg: 60, radius: 1, dmgType: 'magic', near: 2,
    text: 'Lightning strikes every 6-12 s. A circle marks each strike 2 s ahead; anything within a tile takes 60 damage.',
  },
  heat: { name: 'Heat Wave', upkeep: 1.15, farm: 0.85, text: 'Food upkeep +15%; farms yield 15% less.' },
  snow: { name: 'Snow', work: 0.9, text: 'Villagers work 10% slower.' },
};

// ---- State ---------------------------------------------------------------------------------
/** Region weather state (plain JSON). Created at region start, lazily for old saves. */
export function weatherState(s, carry = null) {
  let w = s.ext.weather;
  if (!w) {
    const d = calendarDay(s);
    w = s.ext.weather = { today: 'clear', queue: [], next: 0, bolt: null, strike: null, strikes: 0 };
    if (carry && carry.day === d && carry.kinds && carry.kinds.length >= 2) {
      // The previous region's forecast for these days comes true here as well.
      w.today = carry.kinds[0];
      w.queue.push(carry.kinds[1], rollWeather(s, d + 2));
    } else {
      w.today = rollWeather(s, d);
      if (WEATHER.firstDayClear && d === 0) w.today = 'clear';
      w.queue.push(rollWeather(s, d + 1), rollWeather(s, d + 2));
    }
    w.next = stormGap(s);
  }
  return w;
}

/** Weather valid for the season of that day (heat only in summer, snow only in winter). */
function fit(s, kind, day) {
  const si = seasonIndexForDay(s, day);
  if (kind === 'heat' && si !== 1) return 'clear';
  if (kind === 'snow' && si !== 3) return 'clear';
  return kind;
}
/** Today's effective weather kind. */
export function weatherToday(s) {
  const w = s.ext && s.ext.weather;
  return w ? fit(s, w.today, calendarDay(s)) : 'clear';
}
/** [tomorrow, dayAfter] effective kinds. */
export function forecast(s) {
  const w = s.ext && s.ext.weather; // read-only: the UI calls this too
  if (!w) return ['clear', 'clear'];
  const d = calendarDay(s);
  return [fit(s, w.queue[0] || 'clear', d + 1), fit(s, w.queue[1] || 'clear', d + 2)];
}

/** Season- and storyteller-weighted roll for a calendar day (uses the region RNG). */
export function rollWeather(s, day) {
  const key = SEASONS.order[seasonIndexForDay(s, day)];
  const wt = WEATHER.weights[key];
  const ex = WEATHER.storyteller[s.storyteller] || 1;
  let total = 0;
  for (const k of WEATHER.kinds) total += (wt[k] || 0) * (WEATHER.extreme[k] ? ex : 1);
  let r = s.rt.rng.next() * total;
  for (const k of WEATHER.kinds) {
    const v = (wt[k] || 0) * (WEATHER.extreme[k] ? ex : 1);
    if (v <= 0) continue;
    r -= v;
    if (r <= 0) return k;
  }
  return 'clear';
}
function stormGap(s) { const e = WEATHER.storm.every; return s.rt.rng.float(e[0], e[1]); }

// ---- Effects ---------------------------------------------------------------------------------
function dmgMult(s, a, t, type) { return type === 'fire' && weatherToday(s) === 'rain' ? WEATHER.rain.fire : 1; }
function farmMult(s) {
  const k = weatherToday(s);
  return k === 'rain' ? WEATHER.rain.farm : k === 'heat' ? WEATHER.heat.farm : 1;
}
function upkeepMult(s) { return weatherToday(s) === 'heat' ? WEATHER.heat.upkeep : 1; }
function sightMult(s) { return weatherToday(s) === 'fog' ? WEATHER.fog.sight : 1; }
function workMult(s) { return weatherToday(s) === 'snow' ? WEATHER.snow.work : 1; }

// ---- Lightning ---------------------------------------------------------------------------------
/** Pick a tile near a random building or unit (none: nothing to strike). */
function pickStrike(s) {
  const B = s.buildings, S = s.soldiers, H = s.heroes || [], E = s.enemies;
  const n = B.length + S.length + H.length + E.length + (s.sovereign && s.sovereign.alive ? 1 : 0);
  if (!n) return null;
  const r = s.rt.rng;
  let i = r.int(0, n - 1), x, y;
  if (i < B.length) { const b = B[i]; x = (b.tx + b.size / 2) * T; y = (b.ty + b.size / 2) * T; }
  else if ((i -= B.length) < S.length) { x = S[i].x; y = S[i].y; }
  else if ((i -= S.length) < H.length) { x = H[i].x; y = H[i].y; }
  else if ((i -= H.length) < E.length) { x = E[i].x; y = E[i].y; }
  else { x = s.sovereign.x; y = s.sovereign.y; }
  const near = WEATHER.storm.near;
  const tx = Math.max(1, Math.min(N - 2, Math.floor(x / T) + r.int(-near, near)));
  const ty = Math.max(1, Math.min(N - 2, Math.floor(y / T) + r.int(-near, near)));
  return { x: tx * T + T / 2, y: ty * T + T / 2 };
}

function strikeAt(s, x, y) {
  const W = WEATHER.storm;
  const R = W.radius * T;
  const hit = (e) => {
    if (!e || !e.alive) return;
    const dx = e.x - x, dy = e.y - y, rr = R + (e.r || 0);
    if (dx * dx + dy * dy <= rr * rr) hurt(s, e, W.dmg, W.dmgType, null, x, y, null);
  };
  for (let i = 0; i < s.villagers.length; i++) { const v = s.villagers[i]; if (v.st !== 'sheltered') hit(v); }
  for (let i = 0; i < s.soldiers.length; i++) hit(s.soldiers[i]);
  if (s.heroes) for (let i = 0; i < s.heroes.length; i++) if (!s.heroes[i].away) hit(s.heroes[i]);
  for (let i = 0; i < s.enemies.length; i++) hit(s.enemies[i]);
  hit(s.sovereign);
  // Buildings (iterate a copy: a strike may destroy one).
  const bs = s.buildings;
  for (let i = bs.length - 1; i >= 0; i--) { const b = bs[i]; if (b && b.alive && distToRect(x, y, b) <= R) hurtBuilding(s, b, W.dmg, W.dmgType); }
  const w = s.ext.weather;
  w.strike = { x, y, t: s.time };
  w.strikes = (w.strikes || 0) + 1;
  emit(s, { t: 'lightning', x, y });
}

function onTick(s, dt) {
  const w = s.ext.weather || weatherState(s);
  // A telegraphed bolt always lands, even if the sky clears meanwhile.
  if (w.bolt) {
    w.bolt.t -= dt;
    if (w.bolt.t <= 1e-9) { const b = w.bolt; w.bolt = null; strikeAt(s, b.x, b.y); }
  }
  if (weatherToday(s) !== 'storm') return;
  w.next -= dt;
  if (w.next > 0 || w.bolt) return;
  w.next = stormGap(s);
  const p = pickStrike(s);
  if (!p) return;
  w.bolt = { x: p.x, y: p.y, t: WEATHER.storm.warn, warn: WEATHER.storm.warn, at: s.time };
}

function onPhase(s, phase) {
  if (phase !== 'dawn') return;
  const w = weatherState(s);
  const d = calendarDay(s);
  w.today = w.queue.length ? w.queue.shift() : rollWeather(s, d);
  while (w.queue.length < 2) w.queue.push(rollWeather(s, d + 1 + w.queue.length));
  w.next = stormGap(s);
  const now = weatherToday(s), tom = forecast(s)[0];
  if (now !== 'clear') emit(s, { t: 'toast', text: `Today: ${WEATHER[now].name}. ${WEATHER[now].text}`, tone: now === 'storm' || now === 'heat' ? 'bad' : '', icon: now === 'heat' ? 'sun' : 'info' });
  if (tom === 'storm') emit(s, { t: 'toast', text: 'Thunderheads gather: a storm tomorrow.', tone: 'bad', icon: 'info' });
}

function onRegionInit(s, ctx) {
  if (s.ext.weather) delete s.ext.weather;
  const run = ctx && ctx.run;
  weatherState(s, run && run.ext ? run.ext.wxCarry : null);
}
/** Hand the region's forecast to the next region (it starts on the day after the last dawn). */
function onRunRegionEnd(run, s) {
  const w = s.ext && s.ext.weather;
  if (!w || !run) return;
  const ext = run.ext || (run.ext = {});
  ext.wxCarry = { day: calendarDay(s) + 1, kinds: [w.queue[0] || 'clear', w.queue[1] || 'clear'] };
}

/** Debug: force today's weather (and optionally the queue). */
function cmdWeatherDebug(s, c) {
  const w = weatherState(s);
  if (c.today && WEATHER.kinds.includes(c.today)) w.today = c.today;
  if (Array.isArray(c.queue)) w.queue = c.queue.filter((k) => WEATHER.kinds.includes(k)).slice(0, 2);
  while (w.queue.length < 2) w.queue.push('clear');
  if (c.strikeNow) { w.next = 0; }
  return { ok: true };
}

// ---- Registration --------------------------------------------------------------------------
let done = false;
export function register() {
  if (done) return;
  done = true;
  registerSeasons(); // the calendar must be set up before the first roll
  BUS.query.weather = (s) => weatherToday(s);
  BUS.regionInit.push(onRegionInit);
  BUS.runRegionEnd.push(onRunRegionEnd);
  BUS.tick.push(onTick);
  BUS.phase.push(onPhase);
  BUS.dmgMult.push(dmgMult);
  BUS.farmMult.push(farmMult);
  BUS.upkeepMult.push(upkeepMult);
  BUS.sightMult.push(sightMult);
  BUS.workMult.push(workMult);
  BUS.commands.weatherDebug = cmdWeatherDebug;
}


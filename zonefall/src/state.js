// ZONEFALL 3 — shared mutable game state (one object every module imports)
export const G = {
  W: null, phys: null, rend: null, scene: null,
  mode: 'menu',           // menu | play | dead | over
  paused: false,
  t: 0,                   // seconds since run start
  clock: 0.3,             // 0..1 time of day
  day: 1,
  player: null,
  actors: [], projectiles: [], throwns: [], drops: [], containers: [], nodes: [], doors: [], rooms: [], rads: [], lights: [], uses: [],
  anomalies: [], safes: [], labels: [], spawns: [], monuments: [], events: [],
  meta: null, settings: null, run: null,
  ui: null, fx: null, build: null,
  night: 0, raid: null,
};
export default G;

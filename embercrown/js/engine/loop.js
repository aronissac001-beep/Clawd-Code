// Fixed-timestep simulation with interpolated rendering.
// `timeScale` covers pause (0), slow-motion orders (0.25) and speed-up (2x, 3x):
// faster speeds simply run more fixed ticks per frame, so results are identical.
//
// Hit-stop (rework stream G): hitStop(ms) freezes the picture for a beat after a heavy kill.
// It is render-time only: while frozen, the simulation's time keeps accruing in the
// accumulator and the owed ticks run as soon as the picture moves again, so the sim sees
// exactly the same ticks (determinism) and no game time is lost.
//
// Render throttle (owner C, doc 12.4 "Battery"). `fpsFor()` returns the frame-rate target for this
// moment: 60 while panning, zooming, a sheet or card animates, or combat is on screen; 30 otherwise
// (and always with Battery saver, and at 5x); at most 10 paused and still; 0 while a full-screen
// menu covers the canvas (no draws). The simulation is unaffected: ticks still run from the
// accumulator on every animation frame, so a skipped picture never skips sim time, and 1x and 5x
// stay identical. `poke()` (input) draws on the next frame whatever the target. `dps` counts the
// pictures drawn over the last second (render-check: still camera 30 +- 2; paused <= 10; menu 0).
export class Loop {
  constructor({ step, update, render, maxTicksPerFrame = 10, fpsFor = null }) {
    this.step = step;
    this.update = update;
    this.render = render;
    this.fpsFor = fpsFor;
    this.maxTicks = maxTicksPerFrame;
    this.lastDraw = 0; this.renderDt = 0; this.poked = true;
    this.draws = 0; this.dps = 0; this.dpsT = 0; this.skipped = 0; this.target = 60;
    this.acc = 0;
    this.last = 0;
    this.running = false;
    this.timeScale = 1;
    this.fps = 60; this.tickMs = 0; this.frameMs = 0;
    this.frameNow = 0;          // timestamp of the frame being run
    this.freezeUntil = 0;       // hit-stop: no picture motion until this timestamp
    this.nextStopAt = 0;        // hit-stops never chain back to back
    this.alpha = 0;             // interpolation of the last drawn picture (kept while frozen)
    this.stops = 0;             // hit-stops played (tests)
    this._frame = this._frame.bind(this);
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._frame);
  }
  stop() { this.running = false; }
  /** Freeze the picture for `ms` milliseconds (render only; see the header). */
  hitStop(ms) {
    const now = this.frameNow || performance.now();
    if (now < this.nextStopAt || !(ms > 0)) return;
    this.freezeUntil = Math.max(this.freezeUntil, now + Math.min(120, ms));
    this.nextStopAt = this.freezeUntil + 220;
    this.stops++;
  }
  get frozen() { return this.frameNow < this.freezeUntil; }
  /** Draw on the next frame regardless of the throttle (a touch, a tool change). */
  poke() { this.poked = true; }
  /** Throttle: is a picture due at `now` for the current target? Counts draws per second. */
  _due(now) {
    const fps = this.fpsFor ? this.fpsFor() : 60;
    this.target = fps;
    if (now - this.dpsT >= 1000) { this.dps = this.draws * 1000 / Math.max(1, now - this.dpsT); this.draws = 0; this.dpsT = now; }
    if (this.poked) { this.poked = false; return fps > 0; }
    if (fps <= 0) return false;
    // 4 ms slack: 30 fps lands on every second 60 Hz frame, 60 fps on every 60 Hz frame and on every
    // second frame of a 120 Hz display (ProMotion), so the target is a cap, never exceeded
    return now - this.lastDraw >= 1000 / fps - 4;
  }
  _draw(now, alpha, dt) { this.lastDraw = now; this.draws++; this.render(alpha, dt); }
  _frame(now) {
    if (!this.running) return;
    this.frameNow = now;
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25; // tab was asleep: don't fast-forward
    this.fps += (1 / Math.max(dt, 0.001) - this.fps) * 0.05;
    this.acc += dt * this.timeScale;
    if (now < this.freezeUntil) {
      // Frozen: the same picture again (no time passes for particles or animation). The
      // simulation time keeps accruing and is paid back on the next moving frame.
      if (this.acc > this.step * this.maxTicks) this.acc = this.step * this.maxTicks;
      if (this._due(now)) this._draw(now, this.alpha, 0);
      requestAnimationFrame(this._frame);
      return;
    }
    let n = 0;
    const t0 = performance.now();
    while (this.acc >= this.step && n < this.maxTicks) {
      this.update(this.step);
      this.acc -= this.step;
      n++;
      if (this.freezeUntil > now) break; // a tick started a hit-stop: show that moment
    }
    if (n === this.maxTicks) this.acc = 0;
    const t1 = performance.now();
    if (n) this.tickMs += ((t1 - t0) / n - this.tickMs) * 0.1;
    this.alpha = Math.min(1, this.acc / this.step);
    this.renderDt += dt;
    if (this._due(now)) {
      const rdt = Math.min(0.25, this.renderDt);
      this.renderDt = 0;
      this._draw(now, this.alpha, rdt);
      this.frameMs += (performance.now() - t1 - this.frameMs) * 0.1;
    } else this.skipped++;
    requestAnimationFrame(this._frame);
  }
}

/**
 * The 12.4 frame-rate rule as a pure function, for `fpsFor`:
 *   covered (a full-screen menu) -> 0; Battery saver or 5x -> 30 at most; moving (pan, zoom, a sheet
 *   or card animating) or combat on screen -> 60; paused and still -> 10; otherwise 30.
 * @param {{ covered?: boolean, saver?: boolean, fast?: boolean, moving?: boolean, combat?: boolean, paused?: boolean }} f
 * @param {{ active: number, idle: number, paused: number, saver: number, fast: number }} [fps]
 */
export function fpsTarget(f, fps = { active: 60, idle: 30, paused: 10, saver: 30, fast: 30 }) {
  if (f.covered) return 0;
  let v = f.moving || f.combat ? fps.active : f.paused ? fps.paused : fps.idle;
  if (f.saver) v = Math.min(v, fps.saver);
  if (f.fast) v = Math.min(v, fps.fast);
  return v;
}

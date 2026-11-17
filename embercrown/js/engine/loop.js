// Fixed-timestep simulation with interpolated rendering.
// `timeScale` covers pause (0), slow-motion orders (0.25) and speed-up (2x, 3x):
// faster speeds simply run more fixed ticks per frame, so results are identical.
//
// Hit-stop (rework stream G): hitStop(ms) freezes the picture for a beat after a heavy kill.
// It is render-time only: while frozen, the simulation's time keeps accruing in the
// accumulator and the owed ticks run as soon as the picture moves again, so the sim sees
// exactly the same ticks (determinism) and no game time is lost.
export class Loop {
  constructor({ step, update, render, maxTicksPerFrame = 10 }) {
    this.step = step;
    this.update = update;
    this.render = render;
    this.maxTicks = maxTicksPerFrame;
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
      this.render(this.alpha, 0);
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
    this.render(this.alpha, dt);
    this.frameMs += (performance.now() - t1 - this.frameMs) * 0.1;
    requestAnimationFrame(this._frame);
  }
}

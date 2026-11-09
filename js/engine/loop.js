// Fixed-timestep simulation with interpolated rendering.
// `timeScale` covers pause (0), slow-motion orders (0.25) and speed-up (2x, 3x):
// faster speeds simply run more fixed ticks per frame, so results are identical.
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
    this._frame = this._frame.bind(this);
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._frame);
  }
  stop() { this.running = false; }
  _frame(now) {
    if (!this.running) return;
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25; // tab was asleep: don't fast-forward
    this.fps += (1 / Math.max(dt, 0.001) - this.fps) * 0.05;
    this.acc += dt * this.timeScale;
    let n = 0;
    const t0 = performance.now();
    while (this.acc >= this.step && n < this.maxTicks) {
      this.update(this.step);
      this.acc -= this.step;
      n++;
    }
    if (n === this.maxTicks) this.acc = 0;
    const t1 = performance.now();
    if (n) this.tickMs += ((t1 - t0) / n - this.tickMs) * 0.1;
    this.render(this.acc / this.step, dt);
    this.frameMs += (performance.now() - t1 - this.frameMs) * 0.1;
    requestAnimationFrame(this._frame);
  }
}

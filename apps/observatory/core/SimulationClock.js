export class SimulationClock {
  constructor({ fixedDt = 1 / 60, maxSubSteps = 8 } = {}) {
    if (!(fixedDt > 0)) throw new TypeError("fixedDt must be greater than zero");
    this.fixedDt = fixedDt;
    this.maxSubSteps = maxSubSteps;
    this.reset();
  }

  reset() {
    this.running = false;
    this.frame = 0;
    this.time = 0;
    this.accumulator = 0;
    this.lastTimestamp = null;
  }

  play() {
    this.running = true;
    this.lastTimestamp = null;
  }

  pause() {
    this.running = false;
    this.lastTimestamp = null;
    this.accumulator = 0;
  }

  toggle() {
    this.running ? this.pause() : this.play();
    return this.running;
  }

  advance() {
    this.frame += 1;
    this.time = this.frame * this.fixedDt;
  }

  consume(timestampMs) {
    if (!this.running) return 0;
    if (this.lastTimestamp == null) {
      this.lastTimestamp = timestampMs;
      return 0;
    }
    const elapsed = Math.min(Math.max((timestampMs - this.lastTimestamp) / 1000, 0), 0.25);
    this.lastTimestamp = timestampMs;
    this.accumulator += elapsed;
    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < this.maxSubSteps) {
      this.accumulator -= this.fixedDt;
      steps += 1;
    }
    if (steps === this.maxSubSteps) this.accumulator = Math.min(this.accumulator, this.fixedDt);
    return steps;
  }
}

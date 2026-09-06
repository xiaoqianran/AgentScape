const positiveFinite = (value) => Number.isFinite(value) && value > 0;

export class SimulationClock {
  constructor({ fixedDt = 1 / 60, maxSubSteps = 8, maxFrameDelta = 0.25 } = {}) {
    if (!positiveFinite(fixedDt)) throw new TypeError('fixedDt must be greater than zero');
    if (!Number.isInteger(maxSubSteps) || maxSubSteps < 1) throw new TypeError('maxSubSteps must be a positive integer');
    if (!positiveFinite(maxFrameDelta)) throw new TypeError('maxFrameDelta must be greater than zero');
    this.fixedDt = fixedDt;
    this.maxSubSteps = maxSubSteps;
    this.maxFrameDelta = maxFrameDelta;
    this.reset();
  }

  reset() {
    this.running = false;
    this.tick = 0;
    this.time = 0;
    this.accumulator = 0;
    this.lastTimestamp = null;
    return this.snapshot();
  }

  play() {
    this.running = true;
    this.lastTimestamp = null;
    return true;
  }

  pause() {
    this.running = false;
    this.lastTimestamp = null;
    this.accumulator = 0;
    return true;
  }

  consume(timestampMs) {
    if (!this.running || !Number.isFinite(timestampMs)) return 0;
    if (this.lastTimestamp == null) {
      this.lastTimestamp = timestampMs;
      return 0;
    }

    const elapsed = Math.min(Math.max((timestampMs - this.lastTimestamp) / 1000, 0), this.maxFrameDelta);
    this.lastTimestamp = timestampMs;
    this.accumulator += elapsed;

    let steps = 0;
    while (this.accumulator + Number.EPSILON >= this.fixedDt && steps < this.maxSubSteps) {
      this.accumulator -= this.fixedDt;
      steps += 1;
    }
    if (steps === this.maxSubSteps) this.accumulator = Math.min(this.accumulator, this.fixedDt);
    return steps;
  }

  advance() {
    this.tick += 1;
    this.time = this.tick * this.fixedDt;
    return this.tick;
  }

  snapshot() {
    return {
      fixedDt: this.fixedDt,
      tick: this.tick,
      time: this.time
    };
  }

  restore(snapshot = {}) {
    if (!snapshot || typeof snapshot !== 'object') throw new TypeError('SimulationClock snapshot must be an object');
    if (snapshot.fixedDt !== this.fixedDt) {
      const error = new Error(`SimulationClock fixedDt mismatch: ${snapshot.fixedDt} != ${this.fixedDt}`);
      error.code = 'SIMULATION_FIXED_DT_MISMATCH';
      throw error;
    }
    if (!Number.isInteger(snapshot.tick) || snapshot.tick < 0) throw new TypeError('SimulationClock snapshot tick must be a non-negative integer');
    this.tick = snapshot.tick;
    this.time = this.tick * this.fixedDt;
    this.accumulator = 0;
    this.lastTimestamp = null;
    return this.snapshot();
  }
}

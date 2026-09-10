export class ScenarioRunner {
  constructor({ clock, createContext, onStep = null } = {}) {
    if (!clock || typeof createContext !== "function") throw new TypeError("ScenarioRunner requires clock and createContext");
    this.clock = clock;
    this.createContext = createContext;
    this.onStep = onStep;
    this.scenario = null;
    this.context = null;
  }

  async load(scenario) {
    await this.disposeContext();
    this.clock.reset();
    this.scenario = scenario;
    this.context = await this.createContext(scenario);
    await scenario.setup(this.context);
    this.context.scene?.updateMatrixWorld?.(true);
    return this.context;
  }

  step(count = 1) {
    if (!this.context) return;
    for (let i = 0; i < count; i += 1) {
      const started = performance.now();
      this.context.step(this.clock.fixedDt);
      this.clock.advance();
      this.context.lastStepMs = performance.now() - started;
      this.scenario?.afterStep?.(this.context, this.clock);
      this.onStep?.(this.context, this.clock);
    }
  }

  tick(timestampMs) {
    const count = this.clock.consume(timestampMs);
    if (count) this.step(count);
    return count;
  }

  assertions() {
    return this.scenario?.assertions?.(this.context, this.clock) || [];
  }

  async reset() {
    if (!this.scenario) return null;
    return this.load(this.scenario);
  }

  async replayTo(frame, { maxFrames = 20000 } = {}) {
    if (!Number.isInteger(frame) || frame < 0) throw new TypeError("Replay frame must be a non-negative integer");
    if (frame > maxFrames) throw new RangeError(`Replay frame exceeds limit: ${frame} > ${maxFrames}`);
    await this.reset();
    if (frame) this.step(frame);
    return this.context;
  }

  async disposeContext() {
    if (!this.context) return;
    await this.context.dispose?.();
    this.context = null;
  }

  async dispose() {
    this.clock.pause();
    await this.disposeContext();
  }
}

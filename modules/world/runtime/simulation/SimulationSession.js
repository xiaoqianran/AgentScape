import { SimulationClock } from './SimulationClock.js';

export const SIMULATION_SESSION_SCHEMA = 'agentscape.simulation-session';
export const SIMULATION_SESSION_VERSION = 1;

export class SimulationSession {
  constructor({
    fixedDt = 1 / 60,
    maxSubSteps = 8,
    executeStep,
    snapshotWorld = null,
    restoreWorld = null,
    events = null
  } = {}) {
    if (typeof executeStep !== 'function') throw new TypeError('SimulationSession requires executeStep');
    if (snapshotWorld !== null && typeof snapshotWorld !== 'function') throw new TypeError('snapshotWorld must be a function');
    if (restoreWorld !== null && typeof restoreWorld !== 'function') throw new TypeError('restoreWorld must be a function');
    this.clock = new SimulationClock({ fixedDt, maxSubSteps });
    this.executeStep = executeStep;
    this.snapshotWorld = snapshotWorld;
    this.restoreWorld = restoreWorld;
    this.events = events;
  }

  get fixedDt() { return this.clock.fixedDt; }
  get tick() { return this.clock.tick; }
  get time() { return this.clock.time; }
  get running() { return this.clock.running; }

  reset() {
    const clock = this.clock.reset();
    this.events?.emit?.('simulation.reset', { tick:clock.tick, time:clock.time, fixedDt:clock.fixedDt });
    return clock;
  }

  play() { return this.clock.play(); }
  pause() { return this.clock.pause(); }

  step() {
    const tick = this.clock.tick + 1;
    const time = tick * this.fixedDt;
    this.executeStep(this.fixedDt, { tick, time });
    this.clock.advance();
    return { tick:this.tick, time:this.time, dt:this.fixedDt };
  }

  pump(timestampMs = performance.now()) {
    const count = this.clock.consume(timestampMs);
    for (let index = 0; index < count; index += 1) this.step();
    return count;
  }

  snapshot() {
    if (!this.snapshotWorld) throw new Error('SimulationSession snapshotWorld is not configured');
    return {
      schema: SIMULATION_SESSION_SCHEMA,
      schemaVersion: SIMULATION_SESSION_VERSION,
      exact: false,
      scope: 'canonical-world+clock',
      clock: this.clock.snapshot(),
      world: this.snapshotWorld()
    };
  }

  async restore(snapshot) {
    this.validateSnapshot(snapshot);
    if (!this.restoreWorld) throw new Error('SimulationSession restoreWorld is not configured');
    const wasRunning = this.running;
    this.pause();
    await this.restoreWorld(snapshot.world);
    this.clock.restore(snapshot.clock);
    if (wasRunning) this.play();
    this.events?.emit?.('simulation.restored', {
      tick:this.tick,
      time:this.time,
      fixedDt:this.fixedDt,
      exact:false
    });
    return snapshot;
  }

  validateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') throw new TypeError('SimulationSession snapshot must be an object');
    if (snapshot.schema !== SIMULATION_SESSION_SCHEMA || snapshot.schemaVersion !== SIMULATION_SESSION_VERSION) {
      throw new Error('Unsupported SimulationSession snapshot');
    }
    if (snapshot.exact !== false || snapshot.scope !== 'canonical-world+clock') {
      throw new Error('SimulationSession v1 only accepts canonical-world+clock snapshots');
    }
    if (!snapshot.world || typeof snapshot.world !== 'object') throw new TypeError('SimulationSession snapshot requires world state');
    return snapshot;
  }
}

export class FrameCadence {
  constructor({ debugHz = 15, telemetryHz = 5 } = {}) {
    this.debugInterval = 1000 / debugHz;
    this.telemetryInterval = 1000 / telemetryHz;
    this.lastDebug = -Infinity;
    this.lastTelemetry = -Infinity;
  }

  reset(timestamp = performance.now()) {
    this.lastDebug = timestamp - this.debugInterval;
    this.lastTelemetry = timestamp - this.telemetryInterval;
  }

  shouldDebug(timestamp) {
    if (timestamp - this.lastDebug < this.debugInterval) return false;
    this.lastDebug = timestamp;
    return true;
  }

  shouldTelemetry(timestamp) {
    if (timestamp - this.lastTelemetry < this.telemetryInterval) return false;
    this.lastTelemetry = timestamp;
    return true;
  }
}

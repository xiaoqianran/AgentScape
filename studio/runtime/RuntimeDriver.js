export class RuntimeDriver {
  constructor(world, {
    requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
    cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
    now = () => performance.now(),
    windowTarget = globalThis.window,
    syncInput = null
  } = {}) {
    if (!world?.simulation) throw new TypeError('RuntimeDriver requires world.simulation');
    if (!world?.rendering) throw new TypeError('RuntimeDriver requires world.rendering');
    if (typeof requestFrame !== 'function') throw new TypeError('RuntimeDriver requires requestAnimationFrame');
    if (typeof cancelFrame !== 'function') throw new TypeError('RuntimeDriver requires cancelAnimationFrame');
    if (syncInput !== null && typeof syncInput !== 'function') throw new TypeError('RuntimeDriver syncInput must be a function');
    this.world = world;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.now = now;
    this.windowTarget = windowTarget;
    this.syncInput = syncInput;
    this.frameId = null;
    this.running = false;
    this.unsubscribeDeviceLost = null;
    this.onResize = () => this.world.resize?.();
  }

  start() {
    if (this.running) return this;
    this.running = true;
    this.world.simulation.play();
    this.world.resize?.();
    this.windowTarget?.addEventListener?.('resize', this.onResize);
    this.unsubscribeDeviceLost = this.world.events?.on?.('renderer.device-lost', () => this.stop()) || null;
    this.frameId = this.requestFrame(this.frame);
    return this;
  }

  frame = (timestamp) => {
    if (!this.running) return;
    const frameTime = Number.isFinite(timestamp) ? timestamp : this.now();
    this.syncInput?.(frameTime);
    this.world.simulation.pump(frameTime);
    this.world.rendering.update?.();
    this.world.rendering.render?.(frameTime);
    if (this.running) this.frameId = this.requestFrame(this.frame);
  };

  stop() {
    if (!this.running && this.frameId == null) return false;
    this.running = false;
    if (this.frameId != null) this.cancelFrame(this.frameId);
    this.frameId = null;
    this.windowTarget?.removeEventListener?.('resize', this.onResize);
    this.unsubscribeDeviceLost?.();
    this.unsubscribeDeviceLost = null;
    this.world.simulation.pause();
    return true;
  }

  dispose() {
    this.stop();
    this.world = null;
  }
}

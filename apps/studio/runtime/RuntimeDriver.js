export class RuntimeDriver {
  constructor(world, {
    requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
    cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
    now = () => performance.now(),
    windowTarget = globalThis.window,
    syncInput = null,
    authoring = null,
    shouldRender = () => true
  } = {}) {
    if (!world?.simulation) throw new TypeError('RuntimeDriver requires world.simulation');
    if (!world?.rendering) throw new TypeError('RuntimeDriver requires world.rendering');
    if (typeof requestFrame !== 'function') throw new TypeError('RuntimeDriver requires requestAnimationFrame');
    if (typeof cancelFrame !== 'function') throw new TypeError('RuntimeDriver requires cancelAnimationFrame');
    if (syncInput !== null && typeof syncInput !== 'function') throw new TypeError('RuntimeDriver syncInput must be a function');
    if (typeof shouldRender !== 'function') throw new TypeError('RuntimeDriver shouldRender must be a function');
    if (authoring !== null && typeof authoring?.update !== 'function') throw new TypeError('RuntimeDriver authoring must expose update(delta, elapsed)');
    this.world = world;
    this.authoring = authoring;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.now = now;
    this.windowTarget = windowTarget;
    this.syncInput = syncInput;
    this.shouldRender = shouldRender;
    this.frameId = null;
    this.running = false;
    this.frameStartTime = null;
    this.lastFrameTime = null;
    this.unsubscribeDeviceLost = null;
    this.onResize = () => this.world.rendering.resize?.();
  }

  start() {
    if (this.running) return this;
    this.running = true;
    this.frameStartTime = null;
    this.lastFrameTime = null;
    this.world.simulation.play();
    this.world.rendering.resize?.();
    this.windowTarget?.addEventListener?.('resize', this.onResize);
    this.unsubscribeDeviceLost = this.world.events?.on?.('renderer.device-lost', () => this.stop()) || null;
    this.frameId = this.requestFrame(this.frame);
    return this;
  }

  frame = (timestamp) => {
    if (!this.running) return;
    const frameTime = Number.isFinite(timestamp) ? timestamp : this.now();

    if (this.frameStartTime == null) this.frameStartTime = frameTime;
    const delta = this.lastFrameTime == null ? 0 : Math.max(0, (frameTime - this.lastFrameTime) / 1000);
    const elapsed = Math.max(0, (frameTime - this.frameStartTime) / 1000);
    this.lastFrameTime = frameTime;

    try {
      this.syncInput?.(frameTime);
      this.world.simulation.pump(frameTime);
      this.authoring?.update(delta, elapsed);
      if (this.shouldRender()) {
        this.world.rendering.update?.();
        this.world.rendering.render?.(frameTime);
      }
    } catch (error) {
      // 帧处理失败后立即清理运行状态，避免界面显示为运行中却停止刷新。
      this.stop();
      this.world.events?.emit?.('renderer.error', {
        type:'RuntimeFrameError',
        message:error instanceof Error ? error.message : String(error)
      });
      return;
    }
    if (this.running) this.frameId = this.requestFrame(this.frame);
  };

  stop() {
    if (!this.running && this.frameId == null) return false;
    this.running = false;
    if (this.frameId != null) this.cancelFrame(this.frameId);
    this.frameId = null;
    this.frameStartTime = null;
    this.lastFrameTime = null;
    this.windowTarget?.removeEventListener?.('resize', this.onResize);
    this.unsubscribeDeviceLost?.();
    this.unsubscribeDeviceLost = null;
    this.world.simulation.pause();
    return true;
  }

  dispose() {
    this.stop();
    this.authoring = null;
    this.world = null;
  }
}

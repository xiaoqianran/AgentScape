export class AutosaveController {
  constructor({ runtime, store, delayMs = 500 } = {}) {
    this.runtime = runtime;
    this.store = store;
    this.delayMs = delayMs;
    this.timer = null;
    this.enabled = true;
    this.unsubscribers = [];
    this.lastError = null;
  }

  start() {
    const schedule = () => this.schedule();
    for (const event of ['history.recorded', 'history.applied', 'scene.restored']) {
      this.unsubscribers.push(this.runtime.events.on(event, schedule));
    }
    return this;
  }

  schedule() {
    if (!this.enabled) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      try { this.flush(); }
      catch { /* flush emits scene.autosave.failed; a timer must not throw globally. */ }
    }, this.delayMs);
  }

  cancelPending() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.enabled) return null;
    let stage = 'serialize';
    let scene;
    try {
      scene = this.runtime.serialize({ name: 'AgentScape Autosave' });
      stage = 'storage';
      this.store.save(scene);
      this.lastError = null;
    } catch (error) {
      const code = error?.name === 'QuotaExceededError' ? 'AUTOSAVE_QUOTA_EXCEEDED' : 'AUTOSAVE_FAILED';
      this.lastError = { code, stage, message: error?.message || String(error) };
      try { this.runtime.events.emit('scene.autosave.failed', { ...this.lastError, key:this.store.key || null }); }
      catch { /* Preserve the original storage error if a listener throws. */ }
      throw error;
    }
    this.runtime.events.emit('scene.autosaved', { objects: scene.objects?.length ?? 0, savedAt: scene.metadata?.savedAt ?? new Date().toISOString() });
    return scene;
  }

  dispose() {
    this.cancelPending();
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
  }
}

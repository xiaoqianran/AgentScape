export class AutosaveController {
  constructor({ runtime, store, delayMs = 500 } = {}) {
    this.runtime = runtime;
    this.store = store;
    this.delayMs = delayMs;
    this.timer = null;
    this.enabled = true;
    this.unsubscribers = [];
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
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.enabled) return null;
    const scene = this.runtime.serialize({ name: 'AgentScape Autosave' });
    this.store.save(scene);
    this.runtime.events.emit('scene.autosaved', { objects: scene.objects?.length ?? 0, savedAt: scene.metadata?.savedAt ?? new Date().toISOString() });
    return scene;
  }

  dispose() {
    clearTimeout(this.timer);
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
  }
}

export class RunsPanel {
  constructor() {
    this.runs = [];
    this.listeners = new Set();
    this.viewSnapshot = Object.freeze({ runs:this.runs });
  }

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = () => this.viewSnapshot;

  emit() {
    this.viewSnapshot = Object.freeze({ runs:this.runs });
    for (const listener of this.listeners) listener();
  }

  addRun(run) {
    this.runs = [{ ...run, createdAt:Date.now() }, ...this.runs].slice(0,50);
    this.emit();
  }

  dispose() {
    this.listeners.clear();
  }
}

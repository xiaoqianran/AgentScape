export class PipelineEngine {
  constructor({ events = null, trace = null } = {}) {
    this.events = events;
    this.trace = trace;
    this.stages = new Map();
  }

  register(name, handler) {
    if (this.stages.has(name)) throw new Error(`Pipeline stage already exists: ${name}`);
    this.stages.set(name, handler);
    return this;
  }

  async run(input, { stages, context = {} } = {}) {
    const selected = stages || [...this.stages.keys()];
    let state = { input, artifacts: {}, reports: {}, ...context };
    const timeline = [];
    for (const name of selected) {
      const handler = this.stages.get(name);
      if (!handler) throw new Error(`Unknown pipeline stage: ${name}`);
      const started = performance.now();
      this.events?.emit('pipeline.stage.started', { name });
      this.trace?.emit('pipeline.stage.started', { name }, { actor: 'pipeline' });
      state = await handler(state) || state;
      const elapsedMs = Math.round(performance.now() - started);
      timeline.push({ name, elapsedMs });
      this.events?.emit('pipeline.stage.completed', { name, elapsedMs });
      this.trace?.emit('pipeline.stage.completed', { name, elapsedMs }, { actor: 'pipeline' });
    }
    return { state, timeline };
  }
}

import { buildTaskObservation } from './buildTaskObservation.js';

export class AgentTools {
  constructor(runtime, { profile = 'builder', actor = 'agent' } = {}) {
    this.runtime = runtime;
    this.profile = profile;
    this.actor = actor;
  }

  definitions() { return this.runtime.skills.definitions(); }
  executionPolicy(name, result) { return this.runtime.skills.executionPolicy(name, result); }
  taskObservation(state = {}) { return buildTaskObservation(this.runtime,{ actor:this.actor,...state }); }
  recordSequence(payload) {
    this.runtime.events.emit('agent.sequence', payload);
    this.runtime.trace?.emit('agent.sequence', payload, { actor:this.actor });
  }
  async call(name, args = {}, internalContext = {}) {
    this.runtime.events.emit('tool.called', { name, args });
    const response = await this.runtime.skills.invoke(name, args, { ...internalContext, profile:this.profile, actor:this.actor });
    if (!response.success) throw Object.assign(new Error(response.error.message), { code: response.error.code });
    return response.result;
  }
}

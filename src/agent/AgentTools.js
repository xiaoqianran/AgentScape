import { TOOL_CATALOG } from './toolCatalog.js';

export class AgentTools {
  constructor(runtime, { profile = 'builder', actor = 'agent' } = {}) {
    this.runtime = runtime;
    this.profile = profile;
    this.actor = actor;
  }

  schema() { return Object.entries(TOOL_CATALOG).map(([name, def]) => `${name}(${def.required.join(', ')})`); }

  validate(name, args = {}) {
    const def = TOOL_CATALOG[name];
    if (!def) throw Object.assign(new Error(`Invalid tool call: ${name}`), { code: 'INVALID_TOOL_CALL' });
    const missing = def.required.filter((key) => args[key] == null);
    if (missing.length) throw Object.assign(new Error(`Invalid tool call: ${name}; missing ${missing.join(', ')}`), { code: 'INVALID_TOOL_CALL' });
  }

  async call(name, args = {}) {
    this.validate(name, args);
    this.runtime.events.emit('tool.called', { name, args });
    const response = await this.runtime.skills.invoke(name, args, { profile: this.profile, actor: this.actor });
    if (!response.success) throw Object.assign(new Error(response.error.message), { code: response.error.code });
    return response.result;
  }
}

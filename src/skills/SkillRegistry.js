const objectSchema = (skill) => ({
  type: 'object',
  properties: skill.properties || {},
  required: skill.required || [],
  additionalProperties: false
});

export class SkillRegistry {
  constructor({ policy, trace, runtime } = {}) {
    this.policy = policy;
    this.trace = trace;
    this.runtime = runtime;
    this.skills = new Map();
  }

  register(skill) {
    if (!skill?.name || typeof skill.handler !== 'function') throw new Error('Skill requires name and handler');
    if (this.skills.has(skill.name)) throw new Error(`Skill already registered: ${skill.name}`);
    this.skills.set(skill.name, { version: '1.0.0', permissions: [], required: [], properties: {}, mutates: false, agent: true, ...skill });
    return this;
  }

  get(name) { return this.skills.get(name); }

  definitions() {
    return [...this.skills.values()]
      .filter((skill) => skill.agent)
      .map((skill) => ({ name: skill.name, description: skill.description, parameters: objectSchema(skill) }));
  }


  async invoke(name, input = {}, context = {}) {
    const skill = this.skills.get(name);
    if (!skill) return { success: false, error: { code: 'not_found', message: `Unknown skill: ${name}` } };

    const missing = skill.required.filter((key) => input?.[key] == null);
    if (missing.length) return { success: false, error: { code: 'invalid_input', message: `Missing required fields: ${missing.join(', ')}` } };
    const validation = skill.validate?.(input);
    if (validation?.ok === false) return { success: false, error: { code: 'invalid_input', message: validation.message } };

    const actor = context.actor || 'agent';
    const decision = this.policy?.evaluate({ profile: context.profile || 'builder', required: skill.permissions }) ?? { allow: true, missing: [] };
    const policyEvent = this.trace?.emit('policy.decision', { skill: name, allow: decision.allow, missing: decision.missing }, { actor });
    if (!decision.allow) return { success: false, error: { code: 'forbidden', message: `Missing permissions: ${decision.missing.join(', ')}` } };

    const execute = () => skill.handler(input, { runtime: this.runtime, registry: this, context });
    try {
      const result = skill.mutates && this.runtime?.mutate && !context.skipHistory
        ? await this.runtime.mutate(`skill:${name}`, execute, { source: actor, skill: name, input })
        : await execute();
      this.trace?.emit('skill.executed', { skill: name, version: skill.version, input, result: result ?? { ok: true } }, { actor, causedBy: policyEvent ? [policyEvent.seq] : [] });
      return { success: true, result: result ?? { ok: true } };
    } catch (error) {
      this.trace?.emit('skill.failed', { skill: name, input, error: error.message, code: error.code }, { actor });
      return { success: false, error: { code: error.code || 'handler_error', message: error.message } };
    }
  }
}

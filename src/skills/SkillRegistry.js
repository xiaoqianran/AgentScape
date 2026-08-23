const objectSchema = (skill) => ({
  type: 'object',
  properties: skill.properties || {},
  required: skill.required || [],
  additionalProperties: false
});

const VERIFIED_STATUSES = new Set(['action-completed', 'arrived', 'held', 'placed', 'dropped']);
const BLOCKED_STATUSES = new Set(['blocked', 'unreachable', 'interaction-blocked', 'pickup-blocked', 'place-blocked']);
const FAILED_STATUSES = new Set(['action-failed', 'place-failed']);
const UNVERIFIED_STATUSES = new Set(['action-unverified', 'place-unverified', 'cancelled']);
const REQUESTED_STATUSES = new Set(['moving', 'interaction-requested']);

function classifyResult(result) {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const toolError = typeof result.error === 'string'
      || (result.error && typeof result.error === 'object' && (result.error.code || result.code));
    if (toolError) return { state:'error', verified:false, reason:result.code || result.error?.code || 'TOOL_ERROR' };
    if (result.committed === false || result.rolledBack === true) return { state:'failed', verified:false, reason:result.reason || 'BATCH_NOT_COMMITTED' };
    if (result.committed === true && result.rolledBack === false) return { state:'verified', verified:true, status:'committed' };
    const status = typeof result.status === 'string' ? result.status : null;
    if (status) {
      if (VERIFIED_STATUSES.has(status)) {
        const contractVerified = status === 'action-completed'
          ? result.targetReached === true && result.settled === true
          : status === 'placed'
            ? result.supportVerified === true && result.settled === true
            : true;
        return contractVerified
          ? { state:'verified', verified:true, status }
          : { state:'unverified', verified:false, status, reason:'POST_CONDITION_NOT_VERIFIED' };
      }
      if (BLOCKED_STATUSES.has(status) || status.endsWith('-blocked')) return { state:'blocked', verified:false, status, reason:result.reason || null };
      if (FAILED_STATUSES.has(status) || status.endsWith('-failed')) return { state:'failed', verified:false, status, reason:result.reason || null };
      if (UNVERIFIED_STATUSES.has(status) || status.endsWith('-unverified')) return { state:'unverified', verified:false, status, reason:result.reason || null };
      if (REQUESTED_STATUSES.has(status) || status.endsWith('-requested')) return { state:'requested', verified:false, status, reason:result.reason || null };
      if (status === 'empty') return { state:'noop', verified:false, status, reason:'NO_ACTIVE_OBJECT' };
      if (status === 'recovery-stale') return { state:'noop', verified:false, status, reason:result.reason || 'RECOVERY_STALE' };
    }
    if (result.requested === true) return { state:'requested', verified:false, reason:'REQUEST_ONLY' };
    if (result.ok === false) return { state:'failed', verified:false, reason:result.reason || 'RESULT_NOT_OK' };
  }
  return { state:'accepted', verified:null };
}

const BATCH_REJECT_STATES = new Set(['blocked', 'failed', 'unverified', 'requested', 'error', 'noop']);

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
    this.skills.set(skill.name, { version:'1.0.0', permissions:[], required:[], properties:{}, mutates:false, batchable:true, auxiliary:false, agent:true, ...skill });
    return this;
  }

  get(name) { return this.skills.get(name); }

  definitions() {
    return [...this.skills.values()]
      .filter((skill) => skill.agent)
      .map((skill) => ({ name:skill.name, description:skill.description, parameters:objectSchema(skill) }));
  }

  authorization(name, context = {}) {
    const skill=this.skills.get(name);
    if (!skill) return {allow:false,profile:context.profile || 'builder',missing:[],required:[],reason:'SKILL_NOT_FOUND'};
    const profile=context.profile || 'builder';
    const decision=this.policy?.evaluate({profile,required:skill.permissions}) ?? {allow:true,profile,missing:[]};
    return { ...decision, required:[...skill.permissions] };
  }

  executionPolicy(name, result) {
    const skill = this.skills.get(name);
    const outcome = classifyResult(result);
    const mutates = Boolean(skill?.mutates);
    return {
      mutates,
      barrier:mutates,
      auxiliary:Boolean(skill?.auxiliary),
      tracksUnresolved:!skill?.auxiliary,
      batchable:skill?.batchable !== false,
      batchAcceptable:!BATCH_REJECT_STATES.has(outcome.state),
      outcome
    };
  }

  async invoke(name, input = {}, context = {}) {
    const skill = this.skills.get(name);
    if (!skill) return { success:false, error:{ code:'not_found', message:`Unknown skill: ${name}` } };

    const missing = skill.required.filter((key) => input?.[key] == null);
    if (missing.length) return { success:false, error:{ code:'invalid_input', message:`Missing required fields: ${missing.join(', ')}` } };
    const validation = skill.validate?.(input);
    if (validation?.ok === false) return { success:false, error:{ code:'invalid_input', message:validation.message } };

    const actor = context.actor || 'agent';
    const decision = this.authorization(name,context);
    const policyEvent = this.trace?.emit('policy.decision', { skill:name, allow:decision.allow, missing:decision.missing }, { actor });
    if (!decision.allow) return { success:false, error:{ code:'forbidden', message:`Missing permissions: ${decision.missing.join(', ')}` } };

    const execute = () => skill.handler(input, { runtime:this.runtime, registry:this, context });
    try {
      const result = skill.mutates && this.runtime?.mutate && !context.skipHistory
        ? await this.runtime.mutate(`skill:${name}`, execute, { source:actor, skill:name, input })
        : await execute();
      this.trace?.emit('skill.executed', { skill:name, version:skill.version, input, result:result ?? { ok:true } }, { actor, causedBy:policyEvent ? [policyEvent.seq] : [] });
      return { success:true, result:result ?? { ok:true } };
    } catch (error) {
      this.trace?.emit('skill.failed', { skill:name, input, error:error.message, code:error.code }, { actor });
      return { success:false, error:{ code:error.code || 'handler_error', message:error.message } };
    }
  }
}

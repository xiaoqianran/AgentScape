import * as z from 'zod/v4';

const fail = code => Object.assign(new Error(code), { code });
const identifier = z.string().min(1).max(256);
// Callback state remains owned by the project. Only JSON values cross tools/save boundaries.
export function projectJson(value) {
  const visit = (item, ancestors = new Set()) => {
    if (item === null || ['string', 'boolean'].includes(typeof item)) return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (!item || typeof item !== 'object' || ancestors.has(item)
      || (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item)))) throw fail('PROJECT_VALUE_NOT_JSON');
    const next = new Set(ancestors).add(item);
    for (const value of Object.values(item)) visit(value, next);
  };
  visit(value);
  return structuredClone(value);
}

/** Project-defined behavior, not a second ObjectStore or physics engine. */
export class ProjectCapabilities {
  constructor(runtime) { this.runtime = runtime; this.entities = new Map(); this.closed = false; }
  assertOpen() { if (this.closed) throw fail('PROJECT_CAPABILITIES_CLOSED'); }
  has(id) { return this.entities.has(id); }
  registerEntity({ id, label = id, description = '', object = null, read = () => ({}) }) {
    this.assertOpen(); identifier.parse(id);
    if (this.has(id) || this.runtime.store.has(id) || this.runtime.affordances.get(id)) throw fail('PROJECT_ENTITY_CONFLICT');
    if (typeof read !== 'function' || (object && !object.isObject3D)) throw fail('PROJECT_ENTITY_INVALID');
    const entry = { id, label: z.string().parse(label), description: z.string().parse(description), object, read, actions: new Map() };
    this.read(entry); this.entities.set(id, entry);
    return () => { if (this.entities.get(id) === entry) this.entities.delete(id); };
  }
  registerAction({ target, name, description = '', parameters = { type: 'object', properties: {}, additionalProperties: false }, execute, verify, available, timeoutMs = 60_000 }) {
    this.assertOpen(); identifier.parse(name);
    const entry = this.entities.get(target);
    if (!entry) throw fail('PROJECT_ENTITY_NOT_FOUND');
    if (entry.actions.has(name)) throw fail('PROJECT_ACTION_CONFLICT');
    if (typeof execute !== 'function' || (verify != null && typeof verify !== 'function') || (available != null && typeof available !== 'function')) throw fail('PROJECT_ACTION_INVALID');
    if (timeoutMs !== null && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw fail('PROJECT_ACTION_TIMEOUT_INVALID');
    const schema = projectJson(parameters);
    if (schema.type !== 'object') throw fail('PROJECT_ACTION_SCHEMA_INVALID');
    const action = { name, description: z.string().parse(description), parameters: schema,
      validate: z.fromJSONSchema(schema), execute, verify, available, timeoutMs };
    entry.actions.set(name, action);
    return () => { if (entry.actions.get(name) === action) entry.actions.delete(name); };
  }
  read(entry) {
    const state = projectJson(entry.read());
    if (!state || Array.isArray(state) || typeof state !== 'object') throw fail('PROJECT_STATE_INVALID');
    return state;
  }
  readState(id) { const entry = this.entities.get(id); return entry ? this.read(entry) : null; }
  timeoutFor(target, name) { return this.entities.get(target)?.actions.get(name)?.timeoutMs; }
  inspect(id, { actor } = {}) {
    this.assertOpen(); const entry = this.entities.get(id);
    if (!entry) throw fail('PROJECT_ENTITY_NOT_FOUND');
    const context = { actor, target: id, object: entry.object };
    return { schema: 'agentscape.project-entity', schemaVersion: 1, source: 'project', id,
      label: entry.label, description: entry.description, state: this.read(entry),
      actions: [...entry.actions.values()].map(action => ({ action: 'custom', name: action.name,
        description: action.description, parameters: projectJson(action.parameters), execution: 'project-action',
        available: action.available ? action.available(context) === true : true,
        verification: action.verify ? 'project-defined' : 'unverified' })), physicsVerified: false };
  }
  list(options) { this.assertOpen(); return { total: this.entities.size, entities: [...this.entities.keys()].map(id => this.inspect(id, options)) }; }
  async execute({ target, name, args = {}, actor }, { signal } = {}) {
    this.assertOpen(); const entry = this.entities.get(target), action = entry?.actions.get(name);
    if (!action) throw fail('PROJECT_ACTION_NOT_FOUND');
    const parsed = action.validate.safeParse(args);
    if (!parsed.success) throw fail('PROJECT_ACTION_ARGUMENTS_INVALID');
    const context = { actor, target, object: entry.object, signal };
    if (signal?.aborted) throw fail('PROJECT_ACTION_CANCELLED');
    if (action.available && action.available(context) !== true) throw fail('PROJECT_ACTION_UNAVAILABLE');
    const before = this.read(entry);
    const value = await action.execute(parsed.data, context);
    if (signal?.aborted) throw fail('PROJECT_ACTION_CANCELLED');
    if (this.entities.get(target) !== entry || entry.actions.get(name) !== action) throw fail('PROJECT_ACTION_CHANGED');
    const after = this.read(entry), output = value === undefined ? null : projectJson(value);
    const evidence = action.verify ? await action.verify({ args: parsed.data, before, after, value: output }, context) : null;
    if (signal?.aborted) throw fail('PROJECT_ACTION_CANCELLED');
    if (this.entities.get(target) !== entry || entry.actions.get(name) !== action) throw fail('PROJECT_ACTION_CHANGED');
    const verified = evidence === true || (evidence?.verified === true);
    const result = { status: 'project-action-completed', targetId: target, action: name,
      executed: true, verified, physicsVerified: false, evidenceKind: action.verify ? 'project-defined' : 'none',
      verificationRequested: Boolean(action.verify), before, after, value: output,
      evidence: evidence == null ? null : projectJson(evidence) };
    this.runtime.events.emit('project.action.completed', result);
    return result;
  }
  dispose() { this.closed = true; this.entities.clear(); }
}

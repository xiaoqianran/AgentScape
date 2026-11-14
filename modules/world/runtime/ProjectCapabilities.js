import * as z from 'zod/v4';
import { ProjectStateMachine } from './behavior/ProjectStateMachine.js';

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
  constructor(runtime) { this.runtime = runtime; this.entities = new Map(); this.stateMachines = new Map(); this.closed = false; }
  assertOpen() { if (this.closed) throw fail('PROJECT_CAPABILITIES_CLOSED'); }
  has(id) { return this.entities.has(id); }
  attachmentOf(id) { return this.entities.get(id)?.attachedTo || null; }
  hasAction(id, name) { const entry=this.entities.get(id);
    return Boolean(entry && (!entry.attachedTo || this.attachmentRecord(entry))
      && [...entry.actions.keys()].some(value => value.toUpperCase() === String(name).toUpperCase())); }
  attachmentRecord(entry) {
    const current=entry.attachedTo === 'runtime' && this.runtime.store.has(entry.id)
      ? this.runtime.store.get(entry.id) : null;
    return current && current === entry.attachedRecord ? current : null;
  }
  actionObject(entry) { return entry.object || this.attachmentRecord(entry)?.object || null; }
  registerEntity({ id, label = id, description = '', object = null, read = () => ({}), attachTo = null }) {
    this.assertOpen(); identifier.parse(id);
    if (attachTo != null && attachTo !== 'runtime') throw fail('PROJECT_ATTACHMENT_INVALID');
    if (this.has(id) || this.runtime.affordances.get(id)) throw fail('PROJECT_ENTITY_CONFLICT');
    if (attachTo === 'runtime' ? !this.runtime.store.has(id) : this.runtime.store.has(id)) {
      throw fail(attachTo ? 'PROJECT_ATTACHMENT_TARGET_NOT_FOUND' : 'PROJECT_ENTITY_CONFLICT');
    }
    if (typeof read !== 'function' || (object && !object.isObject3D)) throw fail('PROJECT_ENTITY_INVALID');
    const entry = { id, label: z.string().parse(label), description: z.string().parse(description),
      object, read, attachedTo: attachTo,
      ...(attachTo ? {attachedRecord:this.runtime.store.get(id)} : {}), actions: new Map() };
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
  /** One declarative entity, arbitrary guarded transitions, and an optional simulation clock. */
  registerStateMachine({ id, label = id, description = '', object = null, attachTo = null, initialState, transitions, timers, ranges, onChange, verifyVisual }) {
    this.assertOpen();
    const machine = new ProjectStateMachine({ object, initialState, transitions, timers, ranges, onChange, verifyVisual });
    const removeEntity = this.registerEntity({ id, label, description, object, attachTo, read:() => machine.read() });
    const removeActions = [];
    try {
      for (const transition of machine.listedActions()) {
        const name = transition.name;
        removeActions.push(this.registerAction({ target:id, name, description:transition.description,
          available:() => machine.available(name),
          execute:() => {
            const result = machine.execute(name);
            if (result.changed) this.runtime.events.emit('project.machine.changed', {id,kind:'action',name,state:result.state});
            return result;
          },
          verify:({after,value}) => ({
            verified:value?.changed === true && JSON.stringify(after) === JSON.stringify(value.state),
            kind:'state-machine-transition', transition:name
          })
        }));
      }
    } catch (err) { for (const undo of removeActions.reverse()) undo(); removeEntity(); throw err; }
    this.stateMachines.set(id, machine);
    const dispose = () => {
      if (this.stateMachines.get(id) !== machine) return;
      this.stateMachines.delete(id);
      for (const undo of removeActions.reverse()) undo();
      removeEntity();
    };
    return Object.freeze({
      read:() => machine.read(),
      advance:seconds => {
        this.assertOpen();
        if (this.stateMachines.get(id) !== machine) throw fail('PROJECT_MACHINE_NOT_FOUND');
        const result = machine.advance(seconds);
        if (result.changed) this.runtime.events.emit('project.machine.changed', {id,kind:'clock',state:result.state,completed:result.completed});
        return result;
      },
      dispose
    });
  }

  exportStateMachines() {
    this.assertOpen();
    if (!this.stateMachines.size) return null;
    return {schema:'agentscape.project-machine-state',schemaVersion:1,
      entities:Object.fromEntries([...this.stateMachines].map(([id,machine]) => [id,machine.read()]))};
  }

  /** Validate every target first; failed visual sync restores prior machine states. */
  restoreStateMachines(snapshot) {
    this.assertOpen();
    if (!snapshot || snapshot.schema !== 'agentscape.project-machine-state' || snapshot.schemaVersion !== 1
      || !snapshot.entities || typeof snapshot.entities !== 'object' || Array.isArray(snapshot.entities)
      || Object.keys(snapshot).some(key => !['schema','schemaVersion','entities'].includes(key))) throw fail('PROJECT_MACHINE_SNAPSHOT_INVALID');
    projectJson(snapshot);
    const desired = [];
    for (const [id,state] of Object.entries(snapshot.entities)) {
      const machine = this.stateMachines.get(id);
      if (!machine) throw fail('PROJECT_MACHINE_NOT_FOUND');
      desired.push([id,machine,machine.validate(state)]);
    }
    // Avoid silently losing machines whose callbacks were not installed during setup.
    if (desired.length !== this.stateMachines.size) throw fail('PROJECT_MACHINE_SNAPSHOT_INVALID');
    const before = desired.map(([,machine]) => machine.read());
    try { for (const [,machine,state] of desired) machine.restore(state); }
    catch (failure) {
      for (let i=desired.length-1;i>=0;i--) try { desired[i][1].restore(before[i]); } catch { /* preserve failure */ }
      throw failure;
    }
  }

  read(entry) {
    const state = projectJson(entry.read());
    if (!state || Array.isArray(state) || typeof state !== 'object') throw fail('PROJECT_STATE_INVALID');
    return state;
  }
  readState(id) { const entry = this.entities.get(id); return entry && (!entry.attachedTo || this.attachmentRecord(entry)) ? this.read(entry) : null; }
  timeoutFor(target, name) { return this.entities.get(target)?.actions.get(name)?.timeoutMs; }
  inspect(id, { actor } = {}) {
    this.assertOpen(); const entry = this.entities.get(id);
    if (!entry) throw fail('PROJECT_ENTITY_NOT_FOUND');
    const attached = !entry.attachedTo || Boolean(this.attachmentRecord(entry));
    const context = { actor, target: id, object: this.actionObject(entry) };
    return { schema: 'agentscape.project-entity', schemaVersion: 1, source: 'project', id,
      ...(entry.attachedTo ? { attachedTo:entry.attachedTo, attachmentStatus:attached?'ready':'stale' } : {}),
      label: entry.label, description: entry.description, state:attached?this.read(entry):{},
      actions: [...entry.actions.values()].map(action => ({ action: 'custom', name: action.name,
        description: action.description, parameters: projectJson(action.parameters), execution: 'project-action',
        available:attached && (action.available ? action.available(context) === true : true),
        ...(!attached ? { reason:'PROJECT_ATTACHMENT_TARGET_MISSING' } : {}),
        verification: action.verify ? 'project-defined' : 'unverified' })), physicsVerified: false };
  }
  list(options) { this.assertOpen(); return { total: this.entities.size, entities: [...this.entities.keys()].map(id => this.inspect(id, options)) }; }
  async execute({ target, name, args = {}, actor }, { signal } = {}) {
    this.assertOpen(); const entry = this.entities.get(target), action = entry?.actions.get(name);
    if (!action) throw fail('PROJECT_ACTION_NOT_FOUND');
    const parsed = action.validate.safeParse(args);
    if (!parsed.success) throw fail('PROJECT_ACTION_ARGUMENTS_INVALID');
    const attachment = entry.attachedTo ? this.attachmentRecord(entry) : null;
    if (entry.attachedTo && !attachment) throw fail('PROJECT_ATTACHMENT_TARGET_MISSING');
    const context = { actor, target, object: this.actionObject(entry), signal };
    const assertStable = () => {
      if (entry.attachedTo && this.attachmentRecord(entry) !== attachment) throw fail('PROJECT_ATTACHMENT_TARGET_CHANGED');
    };
    if (signal?.aborted) throw fail('PROJECT_ACTION_CANCELLED');
    if (action.available && action.available(context) !== true) throw fail('PROJECT_ACTION_UNAVAILABLE');
    const before = this.read(entry);
    const value = await action.execute(parsed.data, context);
    if (signal?.aborted) throw fail('PROJECT_ACTION_CANCELLED');
    if (this.entities.get(target) !== entry || entry.actions.get(name) !== action) throw fail('PROJECT_ACTION_CHANGED');
    assertStable();
    const after = this.read(entry), output = value === undefined ? null : projectJson(value);
    const evidence = action.verify ? await action.verify({ args: parsed.data, before, after, value: output }, context) : null;
    if (signal?.aborted) throw fail('PROJECT_ACTION_CANCELLED');
    if (this.entities.get(target) !== entry || entry.actions.get(name) !== action) throw fail('PROJECT_ACTION_CHANGED');
    assertStable();
    const verified = evidence === true || (evidence?.verified === true);
    const result = { status: 'project-action-completed', targetId: target, action: name,
      executed: true, verified, physicsVerified: false, evidenceKind: action.verify ? 'project-defined' : 'none',
      verificationRequested: Boolean(action.verify), before, after, value: output,
      evidence: evidence == null ? null : projectJson(evidence) };
    this.runtime.events.emit('project.action.completed', result);
    return result;
  }
  dispose() { this.closed = true; this.stateMachines.clear(); this.entities.clear(); }
}

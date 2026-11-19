import { EventBus } from '../../../foundation/EventBus.js';

const VALID_PHASES = Object.freeze([
  'created',
  'validated',
  'visual-mounted',
  'semantic-registered',
  'physics-registered',
  'spatial-registered',
  'audio-registered',
  'active',
  'removing',
  'removed',
]);

const clone = value => value == null ? value : structuredClone(value);

const normalizeCapabilities = capabilities => [...new Set(
  (Array.isArray(capabilities) ? capabilities : [capabilities])
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => value.trim()),
)];

/**
 * Stable runtime identity for visual objects and their optional capabilities.
 * The registry does not own rendering, physics, audio, or host resources. It
 * records the shared identity and lifecycle so those systems can coordinate on
 * the same entity without requiring a general-purpose ECS.
 */
export class EntityCapabilityRegistry {
  constructor({ events = new EventBus() } = {}) {
    this.events = events;
    this.items = new Map();
  }

  register({
    id,
    object = null,
    source = 'runtime',
    assetId = null,
    manifest = null,
    state = {},
    capabilities = [],
    phase = 'created',
    transformAuthority = 'static',
    metadata = {},
  } = {}) {
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('Entity id must be a non-empty string');
    if (!VALID_PHASES.includes(phase)) throw new TypeError(`Unknown entity lifecycle phase: ${phase}`);
    if (this.items.has(id)) {
      const error = new Error(`Duplicate entity id: ${id}`);
      error.code = 'ENTITY_ID_CONFLICT';
      throw error;
    }
    const entity = {
      id,
      object,
      source,
      assetId,
      manifest: clone(manifest),
      state,
      capabilities: normalizeCapabilities(capabilities),
      phase,
      transformAuthority,
      metadata: clone(metadata) || {},
    };
    this.items.set(id, entity);
    this.events.emit('entity.registered', this.describe(id));
    return entity;
  }

  get(id) { return this.items.get(id) || null; }
  has(id) { return this.items.has(id); }
  list({ capability = null, source = null, phase = null } = {}) {
    return [...this.items.values()]
      .filter(entity => !capability || entity.capabilities.includes(capability))
      .filter(entity => !source || entity.source === source)
      .filter(entity => !phase || entity.phase === phase)
      .map(entity => this.describe(entity.id));
  }

  setObject(id, object) {
    const entity = this.require(id);
    entity.object = object;
    return entity;
  }

  setPhase(id, phase) {
    const entity = this.require(id);
    if (!VALID_PHASES.includes(phase)) throw new TypeError(`Unknown entity lifecycle phase: ${phase}`);
    const previous = entity.phase;
    entity.phase = phase;
    this.events.emit('entity.phase-changed', { id, previous, phase });
    return entity;
  }

  addCapabilities(id, capabilities) {
    const entity = this.require(id);
    entity.capabilities = normalizeCapabilities([...entity.capabilities, ...normalizeCapabilities(capabilities)]);
    this.events.emit('entity.capabilities-changed', { id, capabilities: [...entity.capabilities] });
    return entity;
  }

  removeCapabilities(id, capabilities) {
    const entity = this.require(id);
    const removed = new Set(normalizeCapabilities(capabilities));
    entity.capabilities = entity.capabilities.filter(capability => !removed.has(capability));
    this.events.emit('entity.capabilities-changed', { id, capabilities: [...entity.capabilities] });
    return entity;
  }

  describe(id) {
    const entity = this.require(id);
    return {
      id: entity.id,
      source: entity.source,
      assetId: entity.assetId,
      capabilities: [...entity.capabilities],
      phase: entity.phase,
      transformAuthority: entity.transformAuthority,
      metadata: clone(entity.metadata),
    };
  }

  unregister(id, { reason = 'removed' } = {}) {
    const entity = this.items.get(id);
    if (!entity) return false;
    entity.phase = 'removing';
    this.events.emit('entity.removing', { id, reason });
    this.items.delete(id);
    this.events.emit('entity.removed', { id, reason });
    return true;
  }

  require(id) {
    const entity = this.get(id);
    if (!entity) {
      const error = new Error(`Entity not found: ${id}`);
      error.code = 'ENTITY_NOT_FOUND';
      throw error;
    }
    return entity;
  }

  clear(reason = 'registry-cleared') {
    for (const id of [...this.items.keys()]) this.unregister(id, { reason });
  }
}

export { VALID_PHASES };

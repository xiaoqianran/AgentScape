import { EmbodiedGenAdapter } from '../adapters/EmbodiedGenAdapter.js';

const PROVIDER_STATUS = new Set(['available', 'experimental', 'disabled', 'deprecated']);
const PROVIDER_HEALTH = new Set(['healthy', 'degraded', 'unknown', 'unavailable']);
const AUTH_MODES = new Set(['none', 'connector-session', 'provider-secret', 'user-managed']);

const copyArray = (value = []) => [...new Set((Array.isArray(value) ? value : [value]).filter(Boolean).map(String))];
const clone = (value) => value == null ? value : structuredClone(value);

function requiredString(value, field) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`Provider contract requires ${field}`);
  return text;
}

function normalizeCapability(providerId, capability = {}) {
  const operation = requiredString(capability.operation, 'capability.operation');
  if (!operation.startsWith(`${providerId}.`) || !/\.v\d+$/.test(operation)) {
    throw new Error(`Capability operation must use stable provider-scoped ID: ${providerId}.<domain>.<operation>.v<major>`);
  }
  const status = capability.status || 'disabled';
  if (!PROVIDER_STATUS.has(status)) throw new Error(`Unsupported capability status: ${status}`);
  const authMode = capability.prerequisites?.authMode || 'none';
  if (!AUTH_MODES.has(authMode)) throw new Error(`Unsupported provider auth mode: ${authMode}`);

  return {
    operation,
    provider: providerId,
    version: String(capability.version || operation.match(/\.v(\d+)$/)?.[1] || '1'),
    displayName: String(capability.displayName || operation),
    category: String(capability.category || 'generation'),
    status,
    input: {
      types: copyArray(capability.input?.types),
      schema: clone(capability.input?.schema || null),
      limits: clone(capability.input?.limits || null)
    },
    output: {
      roles: copyArray(capability.output?.roles),
      required: copyArray(capability.output?.required),
      optional: copyArray(capability.output?.optional)
    },
    profiles: clone(capability.profiles || {}),
    optionsSchema: clone(capability.optionsSchema || null),
    execution: {
      async: Boolean(capability.execution?.async),
      stages: copyArray(capability.execution?.stages),
      durationClass: capability.execution?.durationClass || 'unknown',
      costClass: capability.execution?.costClass || 'unknown'
    },
    prerequisites: {
      authMode,
      connection: Boolean(capability.prerequisites?.connection),
      license: capability.prerequisites?.license || null
    },
    support: {
      cancel: Boolean(capability.support?.cancel),
      resume: Boolean(capability.support?.resume),
      idempotency: Boolean(capability.support?.idempotency)
    },
    artifactTransport: capability.artifactTransport || 'inline-json',
    consumption: clone(capability.consumption || null),
    warnings: copyArray(capability.warnings),
    deprecation: clone(capability.deprecation || null)
  };
}

function normalizeProvider(provider = {}) {
  const id = requiredString(provider.id, 'provider.id');
  const status = provider.status || 'disabled';
  const health = provider.health || 'unknown';
  if (!PROVIDER_STATUS.has(status)) throw new Error(`Unsupported provider status: ${status}`);
  if (!PROVIDER_HEALTH.has(health)) throw new Error(`Unsupported provider health: ${health}`);
  const capabilities = (provider.capabilities || []).map((capability) => normalizeCapability(id, capability));
  const operations = new Set();
  for (const capability of capabilities) {
    if (operations.has(capability.operation)) throw new Error(`Duplicate provider capability: ${capability.operation}`);
    operations.add(capability.operation);
  }
  return {
    id,
    displayName: String(provider.displayName || id),
    version: String(provider.version || '1'),
    implementationRevision: provider.implementationRevision || null,
    health,
    status,
    contractVersion: String(provider.contractVersion || '1'),
    artifactTransport: provider.artifactTransport || null,
    deprecation: clone(provider.deprecation || null),
    capabilities
  };
}

export class ProviderRegistry {
  constructor({ providers = [] } = {}) {
    this.providers = new Map();
    this.bindings = new Map();
    for (const provider of providers) this.registerProvider(provider);
  }

  registerProvider(provider) {
    const normalized = normalizeProvider(provider);
    if (this.providers.has(normalized.id)) throw new Error(`Provider already registered: ${normalized.id}`);
    this.providers.set(normalized.id, normalized);
    return this.getProvider(normalized.id);
  }

  hasProvider(id) { return this.providers.has(id); }

  getProvider(id) {
    const provider = this.providers.get(id);
    return provider ? clone(provider) : null;
  }

  listProviders({ includeDisabled = true } = {}) {
    return [...this.providers.values()]
      .filter((provider) => includeDisabled || provider.status === 'available')
      .map(clone)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  bindCapability(operation, binding = {}) {
    const capability = this.getCapability(operation);
    if (!capability) throw new Error(`Cannot bind unknown provider capability: ${operation}`);
    if (binding.execute != null && typeof binding.execute !== 'function') throw new Error(`Capability execute binding must be a function: ${operation}`);
    if (binding.consume != null && typeof binding.consume !== 'function') throw new Error(`Capability consume binding must be a function: ${operation}`);
    this.bindings.set(operation, { execute: binding.execute || null, consume: binding.consume || null });
    return capability;
  }

  getCapability(operation) {
    for (const provider of this.providers.values()) {
      const capability = provider.capabilities.find((item) => item.operation === operation);
      if (capability) return clone(capability);
    }
    return null;
  }

  findCapabilities({ provider, operation, input, output, availableOnly = false, executableOnly = false } = {}) {
    const matches = [];
    for (const entry of this.providers.values()) {
      if (provider && entry.id !== provider) continue;
      if (availableOnly && (entry.status !== 'available' || entry.health === 'unavailable')) continue;
      for (const capability of entry.capabilities) {
        if (operation && capability.operation !== operation) continue;
        if (availableOnly && capability.status !== 'available') continue;
        if (input && !capability.input.types.includes(input)) continue;
        if (output && !capability.output.roles.includes(output)) continue;
        if (executableOnly && typeof this.bindings.get(capability.operation)?.execute !== 'function') continue;
        matches.push(clone(capability));
      }
    }
    return matches;
  }

  resolveCapability(criteria = {}) {
    return this.findCapabilities({ ...criteria, availableOnly: criteria.availableOnly ?? true, executableOnly: criteria.executableOnly ?? true })[0] || null;
  }

  async execute(capabilityOrOperation, request) {
    const operation = typeof capabilityOrOperation === 'string' ? capabilityOrOperation : capabilityOrOperation?.operation;
    const capability = this.getCapability(operation);
    if (!capability) throw new Error(`Unknown provider capability: ${operation || '<missing>'}`);
    const binding = this.bindings.get(operation);
    if (!binding?.execute) throw new Error(`Provider capability is not executable: ${operation}`);
    return binding.execute(clone(request), capability);
  }

  async consume(capabilityOrOperation, result, context = {}) {
    const operation = typeof capabilityOrOperation === 'string' ? capabilityOrOperation : capabilityOrOperation?.operation;
    const capability = this.getCapability(operation);
    if (!capability) throw new Error(`Unknown provider capability: ${operation || '<missing>'}`);
    const binding = this.bindings.get(operation);
    if (!binding?.consume) throw new Error(`Provider capability has no registered consumer: ${operation}`);
    return binding.consume(result, { ...context, capability });
  }
}

export function createDefaultProviderRegistry({ generator = null, embodiedGenAdapter = new EmbodiedGenAdapter() } = {}) {
  const configured = Boolean(generator?.isConfigured?.());
  const transportStatus = configured ? 'available' : 'disabled';
  const transportHealth = configured ? 'unknown' : 'unavailable';
  const registry = new ProviderRegistry({ providers: [
    {
      id: 'local-catalog', version: '1', status: 'available', health: 'healthy', artifactTransport: 'local',
      capabilities: [{
        operation: 'local-catalog.asset.search.v1', status: 'available', category: 'asset-discovery',
        input: { types: ['query-text'] }, output: { roles: ['asset-ref'] },
        execution: { async: false, durationClass: 'local', costClass: 'none' },
        artifactTransport: 'local'
      }]
    },
    {
      id: 'legacy-http-generator', version: '1', status: transportStatus, health: transportHealth, artifactTransport: 'inline-json',
      capabilities: [{
        operation: 'legacy-http-generator.asset.text_to_3d.v1', status: transportStatus, category: 'asset-generation',
        input: { types: ['text'] }, output: { roles: ['asset'] },
        execution: { async: false, stages: ['generate'], durationClass: 'long', costClass: 'unknown' },
        prerequisites: { authMode: 'none' }, support: { cancel: false, resume: false, idempotency: false },
        consumption: { kind: 'runtime-manifest' }, artifactTransport: 'inline-json'
      }]
    },
    {
      id: 'modal-2d', version: '1', status: 'disabled', health: 'unknown', artifactTransport: 'connector-artifact',
      capabilities: [{
        operation: 'modal-2d.image.text_to_image.v1', status: 'disabled', category: 'image-generation',
        input: { types: ['text'] }, output: { roles: ['image'] },
        execution: { async: true, stages: ['queued', 'running', 'artifact'], durationClass: 'medium', costClass: 'gpu' },
        prerequisites: { authMode: 'connector-session', connection: true }, support: { cancel: true, idempotency: true },
        artifactTransport: 'connector-artifact'
      }]
    },
    {
      id: 'modal-3d', version: '1', status: 'disabled', health: 'unknown', artifactTransport: 'connector-artifact',
      capabilities: [{
        operation: 'modal-3d.asset.image_to_3d.v1', status: 'disabled', category: 'asset-generation',
        input: { types: ['image', 'rgba'] }, output: { roles: ['asset'] },
        execution: { async: true, stages: ['queued', 'running', 'artifact'], durationClass: 'long', costClass: 'gpu' },
        prerequisites: { authMode: 'connector-session', connection: true }, support: { cancel: true, idempotency: true },
        artifactTransport: 'connector-artifact'
      }]
    },
    {
      id: 'embodiedgen', version: '1', status: transportStatus, health: transportHealth, artifactTransport: 'inline-json',
      capabilities: [{
        operation: 'embodiedgen.asset.text_to_3d.v1', status: transportStatus, category: 'asset-generation',
        input: { types: ['text'] }, output: { roles: ['asset'] },
        execution: { async: false, stages: ['generate'], durationClass: 'long', costClass: 'unknown' },
        prerequisites: { authMode: 'none' }, support: { cancel: false, resume: false, idempotency: false },
        consumption: { kind: 'embodiedgen-adapter' }, artifactTransport: 'inline-json'
      }]
    }
  ] });

  if (configured) {
    const execute = (request) => generator.generate(request);
    registry.bindCapability('legacy-http-generator.asset.text_to_3d.v1', { execute });
    registry.bindCapability('embodiedgen.asset.text_to_3d.v1', {
      execute,
      consume: (result, { request = {} } = {}) => {
        const payload = result?.payload || result;
        return embodiedGenAdapter.toManifest(payload, { id: request.id, glbUrl: result?.glbUrl });
      }
    });
  }
  return registry;
}

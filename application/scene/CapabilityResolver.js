import { sceneError } from './SceneContracts.js';

/**
 * Read-only capability projection for assets, environment contracts and
 * executable Code Project entities. The underlying owners retain their state.
 */
export function describeCapabilities(inspection) {
  return (inspection.actions || []).map(action => {
    const name = action.name || action.action;
    return {
      id: [inspection.id, action.partName || '$root', name].join(':'),
      target: inspection.id,
      name,
      action: 'invoke',
      source: inspection.source,
      executor: action.execution,
      ...(action.partName ? { partName: action.partName } : {}),
      ...(action.capabilitySource ? { capabilitySource: action.capabilitySource } : {}),
      ...(action.graspVerified === false ? { graspVerified:false } : {}),
      description: action.description || '',
      parameters: structuredClone(action.parameters || {}),
      available: action.available ?? null,
      ...(action.reason ? { reason: action.reason } : {}),
      ...(action.canApproach ? { canApproach: true } : {}),
      verification: action.contract?.verifierTarget?.type
        || action.verification || inspection.evidenceKind || 'unverified'
    };
  });
}

export function inspectCapabilities(world, target, { actor } = {}) {
  const physical = world.affordances?.inspect(target, { actorId: actor }) || null;
  const project = world.projectCapabilities?.has(target)
    ? world.projectCapabilities.inspect(target, { actor }) : null;
  if (!physical && !project) return null;
  if (!physical || !project) {
    const inspection = physical || project;
    return { ...inspection, capabilities:describeCapabilities(inspection) };
  }

  // A single logical entity can expose independent physical and project state.
  // No provider state is copied back into the other provider.
  const stateProviders = { [physical.source]:structuredClone(physical.state || {}),
    project:structuredClone(project.state || {}) };
  const collisions = Object.keys(stateProviders.project).filter(key => Object.hasOwn(stateProviders[physical.source], key));
  const state = { ...stateProviders[physical.source] };
  for (const [key, value] of Object.entries(stateProviders.project)) {
    if (!Object.hasOwn(state, key)) state[key] = value;
  }
  const entries = [...describeCapabilities(physical), ...describeCapabilities(project)];
  const counts = new Map();
  for (const entry of entries) counts.set(entry.id, (counts.get(entry.id) || 0) + 1);
  const capabilities = entries.map(entry => ({
    ...entry, ...(counts.get(entry.id) > 1 ? {id:entry.id + ':' + entry.source} : {})
  }));
  return { ...physical, source:'composite', providers:[physical.source,'project'],
    state, stateProviders, stateConflicts:collisions,
    actions:[...(physical.actions || []),...(project.actions || []).map(action => ({...action,source:'project'}))],
    capabilities };
}

/** Resolve a registered action without ever inferring permission from its name. */
export function resolveCapability(world, { target, name, actor, partName, source }) {
  const inspection = inspectCapabilities(world, target, { actor });
  if (!inspection) throw sceneError('OBJECT_NOT_FOUND');
  const matches = inspection.capabilities.filter(entry =>
    entry.name === name && (partName == null || entry.partName === partName)
    && (source == null || entry.source === source));
  if (!matches.length) throw sceneError('ACTION_UNSUPPORTED');
  if (matches.length !== 1) {
    if (new Set(matches.map(item => item.source)).size > 1) throw sceneError('ACTION_SOURCE_REQUIRED');
    throw sceneError('ACTION_PART_REQUIRED');
  }
  const capability = matches[0];
  if (!['interaction', 'world-action', 'project-action'].includes(capability.executor))
    throw sceneError('ACTION_NOT_INVOKABLE');
  return { source: capability.source, capability };
}

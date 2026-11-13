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
  const inspection = world.projectCapabilities?.has(target)
    ? world.projectCapabilities.inspect(target, { actor })
    : world.affordances?.inspect(target, { actorId: actor });
  if (!inspection) return null;
  return { ...inspection, capabilities: describeCapabilities(inspection) };
}

/** Resolve a registered action without ever inferring permission from its name. */
export function resolveCapability(world, { target, name, actor, partName }) {
  const inspection = inspectCapabilities(world, target, { actor });
  if (!inspection) throw sceneError('OBJECT_NOT_FOUND');
  const matches = inspection.capabilities.filter(entry =>
    entry.name === name && (partName == null || entry.partName === partName));
  if (!matches.length) throw sceneError('ACTION_UNSUPPORTED');
  if (matches.length !== 1) throw sceneError('ACTION_PART_REQUIRED');
  const capability = matches[0];
  if (!['interaction', 'world-action', 'project-action'].includes(capability.executor))
    throw sceneError('ACTION_NOT_INVOKABLE');
  return { source: inspection.source, capability };
}

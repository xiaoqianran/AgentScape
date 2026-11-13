import { sceneError } from './SceneContracts.js';

// Compatibility adapters for historical physical Scene commands.
// New articulation names execute from their manifest contract without adding
// entries here; new Code Project / environment actions have their own executors.
const common = request => ({ action: request.name, actor: request.actor, target: request.target });
const withArgs = request => ({ ...common(request), args: { ...request.args } });

const legacyAdapters = new Map([
  ['pickup', common],
  ['place', request => ({
    ...common(request),
    ...(request.args.surfaceId != null ? { surfaceId: request.args.surfaceId } : {})
  })],
  ['open', request => ({
    ...common(request),
    ...(request.partName ? { partName: request.partName } : {})
  })],
  ['close', request => ({
    ...common(request),
    ...(request.partName ? { partName: request.partName } : {})
  })],
  ['push', withArgs],
  ['drag', withArgs],
  ['rotate', withArgs],
  ['slide', request => ({
    ...withArgs(request),
    args: { ...request.args, part: request.args.part ?? request.partName }
  })],
  ['rotateJoint', request => ({
    ...withArgs(request),
    args: { ...request.args, part: request.args.part ?? request.partName }
  })]
]);

export function legacyPhysicalRequest(request) {
  const adapter = legacyAdapters.get(request.name);
  if (!adapter) throw sceneError('ACTION_EXECUTOR_UNAVAILABLE');
  return adapter(request);
}

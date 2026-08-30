const clone = (value) => value == null ? value : structuredClone(value);

export function evaluateWorldAdmission({
  validation = null,
  acceptance = null,
  assetAdmission = null,
  layoutAdmission = null,
  behaviorAdmission = null,
  physicsAdmission = null,
  relationAdmission = null
} = {}) {
  const hard = validation?.counts?.hard || 0;
  const advisory = validation?.counts?.advisory || 0;
  const acceptanceRejected = acceptance?.status === 'world-incomplete';
  const rejected = [assetAdmission, layoutAdmission, behaviorAdmission, physicsAdmission, relationAdmission]
    .some((admission) => admission?.status === 'rejected');
  const provisional = advisory
    || assetAdmission?.status === 'provisional'
    || layoutAdmission?.status === 'provisional';

  return {
    status: hard || rejected || acceptanceRejected ? 'rejected' : provisional ? 'provisional' : 'ready',
    reasons: [
      ...(hard ? [`VALIDATION_HARD:${hard}`] : []),
      ...(advisory ? [`VALIDATION_ADVISORY:${advisory}`] : []),
      ...(assetAdmission?.status === 'rejected' ? ['ASSET_UNRESOLVED'] : []),
      ...(assetAdmission?.status === 'provisional' ? ['ASSET_PROVISIONAL'] : []),
      ...(layoutAdmission?.status === 'rejected' ? [layoutAdmission.reason || 'LAYOUT_REJECTED'] : []),
      ...(layoutAdmission?.status === 'provisional' ? ['LAYOUT_PROVISIONAL'] : []),
      ...(behaviorAdmission?.status === 'rejected' ? [behaviorAdmission.reason || behaviorAdmission.issues?.[0]?.code || 'BEHAVIOR_REJECTED'] : []),
      ...(physicsAdmission?.status === 'rejected' ? [physicsAdmission.reason || physicsAdmission.issues?.[0]?.code || 'PHYSICS_REJECTED'] : []),
      ...(relationAdmission?.status === 'rejected' ? [relationAdmission.reason || 'RELATION_REJECTED'] : []),
      ...(acceptanceRejected ? ['WORLD_ACCEPTANCE_FAILED'] : [])
    ],
    validation: { hard, advisory },
    ...(assetAdmission ? { assets:clone(assetAdmission) } : {}),
    ...(layoutAdmission ? { layout:clone(layoutAdmission) } : {}),
    ...(behaviorAdmission ? { behavior:clone(behaviorAdmission) } : {}),
    ...(physicsAdmission ? { physics:clone(physicsAdmission) } : {}),
    ...(relationAdmission ? { relations:clone(relationAdmission) } : {}),
    ...(acceptance ? { acceptance:clone(acceptance) } : {})
  };
}

// The application owns the active lab; these helpers keep teardown and debug
// wiring separate from routing and presentation without owning Runtime truth.
export function disposeLabProbes(app) {
  for (const [key, reset] of [
    ['residentCullingProbe', 'setResidentCullingResult'],
    ['indirectDrawProbe', 'setIndirectDrawResult'],
    ['compactionProbe', 'setCompactionResult']
  ]) {
    const probe = app[key];
    if (!probe) continue;
    probe.scene?.remove(probe.result.mesh);
    probe.result.dispose?.();
    app[key] = null;
    app.shell[reset](null);
  }
}

export const DEBUG_SETTERS = Object.freeze({
  native:'setNativeDebug', manifest:'setManifestDebug', difference:'setDifferenceDebug',
  normalized:'setNormalizedDebug', velocity:'setVelocityDebug', joint:'setJointDebug',
  contact:'setContactDebug', bounds:'setBoundsDebug', ray:'setRayDebug',
  'spatial-query':'setSpatialQueryDebug', navmesh:'setNavMeshDebug', path:'setPathDebug',
  endpoints:'setEndpointsDebug', obstacles:'setObstaclesDebug',
  'interaction-los':'setInteractionLosDebug', 'interaction-support':'setInteractionSupportDebug',
  'interaction-state':'setInteractionStateDebug', 'agent-tool':'setAgentToolDebug',
  labels:'setWorldLabelsVisible', grid:'setGridVisible'
});

export function applyLabDebugLayers(lab, refs) {
  for (const [layer, setter] of Object.entries(DEBUG_SETTERS)) {
    const input = refs[`${layer}-debug`];
    if (input) lab[setter]?.(input.checked);
  }
}

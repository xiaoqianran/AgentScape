const round = (value, digits = 3) => Number.isFinite(value) ? Number(value.toFixed(digits)) : value;
const roundVec = (value) => Array.isArray(value) ? value.map((item) => round(item)) : value;

const relevantIds = (actor, lastMutation, unresolved = []) => {
  const ids = new Set(actor ? [actor] : []);
  const addArgs = (args = {}) => {
    for (const key of ['actorId','id','targetId','supportId','instanceId']) if (typeof args[key] === 'string') ids.add(args[key]);
  };
  addArgs(lastMutation?.args);
  for (const entry of unresolved) addArgs(entry?.args);
  return [...ids];
};

const compactRelations = (runtime, ids, limit = 8) => {
  if (!runtime.sceneGraph || !ids.length) return [];
  runtime.sceneGraph.update();
  const relevant = new Set(ids);
  const edges = [];
  for (const edge of runtime.sceneGraph.list()) {
    if (!relevant.has(edge.subject) && !relevant.has(edge.object)) continue;
    edges.push({
      subject:edge.subject,predicate:edge.predicate,object:edge.object,
      ...(edge.meta?.distance != null ? { distance:round(edge.meta.distance) } : {}),
      ...(edge.meta?.surfaceId ? { surfaceId:edge.meta.surfaceId } : {})
    });
    if (edges.length >= limit) break;
  }
  return edges;
};

const recoveryHints = (focusMutation) => {
  const outcome = focusMutation?.outcome;
  if (!outcome || ['verified','accepted'].includes(outcome.state)) return [];
  const reason = outcome.reason || outcome.status || outcome.state;
  const hint = (tool, purpose) => ({ tool,purpose,status:'provisional',basedOn:reason });
  if (['STALL','LIMIT_VIOLATION','TIMEOUT','JOINT_STATE_UNAVAILABLE'].includes(reason)) {
    return [{ action:'report-incomplete-or-retry-after-world-change', purpose:'Live articulation evidence is already embedded in this task observation; do not repeat articulation reads unless the world changes.', status:'provisional', basedOn:reason }];
  }
  if (['CARRIED_OBJECT_BLOCKED','APPROACH_FAILED','NO_INTERACTION_POSE'].includes(reason)) {
    return [{ action:'replan-from-current-pose', purpose:'Current locomotion and carry state are already embedded; choose a different verified route/action or report blocked.', status:'provisional', basedOn:reason }];
  }
  if (['PLACE_TRANSFER_BLOCKED','CARRY_REORIENT_BLOCKED','RELEASE_OUT_OF_RANGE','NO_FREE_SURFACE_SPACE_AFTER_APPROACH'].includes(reason)) {
    return [hint('findFreeSpace','Re-evaluate support-surface free space; any subsequent place attempt must still pass embodied reach and collision checks.')];
  }
  if (['SUPPORT_NOT_REACHED','SETTLE_TIMEOUT'].includes(reason)) {
    return [{ action:'report-unverified-or-retry-place', purpose:'Relevant support relations are already embedded when available; do not claim success without a new verified place outcome.', status:'provisional', basedOn:reason }];
  }
  if (String(reason).includes('PATH') || String(reason).includes('NAVIGATION')) {
    return [hint('suggestNavigationActions','Request provisional action-aware navigation diagnosis, then re-query the real path after any world change.')];
  }
  return [{ purpose:'Re-observe the failed semantic step before any dependent mutation.', status:'provisional', basedOn:reason }];
};

export function buildTaskObservation(runtime, {
  actor = 'agent_01',
  lastMutation = null,
  unresolvedMutations = [],
  maxRelations = 8
} = {}) {
  const ids = relevantIds(actor,lastMutation,unresolvedMutations);
  const objects = [];
  for (const id of ids) {
    if (!runtime.store?.has(id)) continue;
    const record = runtime.store.get(id);
    const position = runtime.physics?.getPosition(id) || record.object?.position?.toArray?.() || null;
    objects.push({ id, asset:record.assetId, type:record.manifest?.type, ...(position ? {position:roundVec(position)} : {}) });
  }

  const focusMutation=(lastMutation && !['verified','accepted'].includes(lastMutation.outcome?.state)) ? lastMutation : unresolvedMutations.at(-1);
  const observation = {
    schema:'agentscape.task-observation.v1',
    actor:{ id:actor },
    lastMutation:lastMutation ? structuredClone(lastMutation) : null,
    unresolvedMutations:unresolvedMutations.map((entry)=>structuredClone(entry)),
    objects,
    relations:compactRelations(runtime,ids,maxRelations),
    recoveryHints:recoveryHints(focusMutation)
  };

  if (runtime.store?.has(actor)) {
    const position = runtime.physics?.getPosition(actor) || runtime.store.get(actor).object?.position?.toArray?.();
    if (position) observation.actor.position=roundVec(position);
    if (runtime.locomotion?.status) observation.actor.navigation=runtime.locomotion.status(actor);
    if (runtime.interactions?.carryStatus) observation.actor.carry=runtime.interactions.carryStatus(actor);
  }

  const articulation = [];
  for (const id of ids) {
    if (!runtime.store?.has(id)) continue;
    const parts = runtime.store.get(id).manifest?.parts || {};
    if (!Object.values(parts).some((part)=>part?.joint && part?.physics && Object.keys(part.targets || {}).length)) continue;
    try {
      const status = runtime.interactions.articulationStatus(id);
      articulation.push({
        id:status.id,
        parts:(status.parts || []).map((part)=>({
          partName:part.partName,status:part.status,
          requestedAction:part.requestedAction ?? null,verifiedAction:part.verifiedAction ?? null,
          ...(part.live ? { live:{
            coordinate:round(part.live.coordinate),target:round(part.live.target),error:round(part.live.error),tolerance:round(part.live.tolerance),coordinateReference:part.live.coordinateReference
          } } : {}),
          ...(part.last ? { last:{
            status:part.last.status,reason:part.last.reason || null,targetReached:part.last.targetReached ?? null,settled:part.last.settled ?? null,
            ...(part.last.attribution ? { attribution:{
              status:part.last.attribution.status,
              evidence:part.last.attribution.evidence,
              blockerCandidates:(part.last.attribution.blockerCandidates || []).map((item)=>structuredClone(item)),
              contactEvidence:(part.last.attribution.contactEvidence || []).slice(0,4).map((item)=>({
                source:structuredClone(item.source),target:structuredClone(item.target),
                contactCount:item.contactCount,activeContactCount:item.activeContactCount,minDistance:round(item.minDistance),totalImpulse:round(item.totalImpulse),normal:roundVec(item.normal)
              }))
            } } : {})
          } } : {})
        }))
      });
    } catch {}
  }
  if (articulation.length) observation.articulation=articulation;
  const focusTargetId=focusMutation?.args?.targetId || focusMutation?.args?.id || null;
  const focusPartName=focusMutation?.args?.partName || null;
  const focusReason=focusMutation?.outcome?.reason || focusMutation?.outcome?.status || null;
  const attributedFailure=focusReason==='STALL' ? articulation.flatMap((entry)=>entry.parts.map((part)=>({id:entry.id,part})))
    .find(({id,part})=>id===focusTargetId && (!focusPartName || part.partName===focusPartName) && part.last?.reason==='STALL' && part.last?.attribution?.status==='contact-evidence' && part.last.attribution.blockerCandidates?.length) : null;
  if (attributedFailure) observation.recoveryHints=[{
    tool:'suggestRecoveryActions',
    args:{actorId:actor,targetId:attributedFailure.id,partName:attributedFailure.part.partName},
    purpose:'Evaluate current contact blocker candidates against embodied capability and Policy before any recovery mutation.',
    status:'provisional',basedOn:'current-contact-at-failure'
  }];

  return observation;
}

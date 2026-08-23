const candidateKey = (candidate={}) => candidate.kind === 'object'
  ? `object:${candidate.objectId}:${candidate.partName || '$root'}:${candidate.colliderIndex ?? -1}`
  : `environment:${candidate.environmentId}:${candidate.colliderIndex ?? -1}`;

const currentExternalTargets = (runtime,targetId,partName) => new Set(
  (runtime.physics.articulationContacts?.(targetId,partName) || [])
    .filter((contact)=>contact.external)
    .map((contact)=>candidateKey(contact.target))
);

const denied = (candidate, reason, details={}) => ({
  blocker:structuredClone(candidate),eligible:false,status:'ineligible',reason,...details
});

export async function buildRecoveryProposals(runtime,registry,{
  actorId,targetId,partName=null,profile='builder'
}={}) {
  const articulation=runtime.interactions.articulationStatus(targetId,partName);
  const failedPart=(articulation.parts || []).find((part)=>partName ? part.partName===partName : part.last?.reason==='STALL');
  const last=failedPart?.last;
  if (!failedPart || last?.reason!=='STALL') return {
    status:'recovery-unavailable',reason:'NO_STALL_FAILURE',actorId,targetId,partName:partName || failedPart?.partName || null,proposals:[]
  };
  const attribution=last.attribution;
  if (attribution?.status!=='contact-evidence' || !(attribution.blockerCandidates || []).length) return {
    status:'recovery-unavailable',reason:'NO_CONTACT_BLOCKER_CANDIDATE',actorId,targetId,partName:failedPart.partName,proposals:[]
  };

  const currentTargets=currentExternalTargets(runtime,targetId,failedPart.partName);
  const authorization=registry.authorization('recoverPickupBlocker',{profile});
  const proposals=[];
  for (const candidate of attribution.blockerCandidates) {
    if (candidate.kind==='environment') {
      proposals.push(denied(candidate,'ENVIRONMENT_IMMOVABLE'));
      continue;
    }
    if (candidate.kind!=='object' || !candidate.objectId || !runtime.store.has(candidate.objectId)) {
      proposals.push(denied(candidate,'BLOCKER_OBJECT_UNAVAILABLE'));
      continue;
    }
    if ((candidate.partName || '$root')!=='$root') {
      proposals.push(denied(candidate,'ARTICULATED_PART_RECOVERY_UNSUPPORTED'));
      continue;
    }
    if (!currentTargets.has(candidateKey(candidate))) {
      proposals.push(denied(candidate,'CONTACT_EVIDENCE_STALE',{status:'stale'}));
      continue;
    }
    if (!authorization.allow) {
      proposals.push({
        blocker:structuredClone(candidate),eligible:false,status:'denied',reason:'POLICY_DENIED',
        policy:{allow:false,profile:authorization.profile,missing:[...authorization.missing]}
      });
      continue;
    }
    let pickupPlan;
    try {
      runtime.interactions.assertAgentCarryable(actorId,candidate.objectId);
      pickupPlan=await runtime.interactions.findPickupPlan(actorId,candidate.objectId);
    } catch (error) {
      proposals.push(denied(candidate,error.details?.reason || error.code || 'BLOCKER_NOT_CARRYABLE'));
      continue;
    }
    if (!pickupPlan?.transfer?.clear) {
      proposals.push(denied(candidate,'PICKUP_TRANSFER_BLOCKED'));
      continue;
    }
    const retryAction=last.action || 'open';
    proposals.push({
      blocker:structuredClone(candidate),eligible:true,status:'provisional',recovery:'pickup-blocker',
      evidence:'current-contact-at-failure',
      policy:{allow:true,profile:authorization.profile,missing:[]},
      preflight:{pose:structuredClone(pickupPlan.pose),transfer:{clear:true}},
      tool:'recoverPickupBlocker',args:{actorId,targetId,partName:failedPart.partName,blockerId:candidate.objectId},
      verification:{
        required:'retry-original-post-condition',
        tool:'approachAndInteract',
        args:{actorId,targetId,action:retryAction,partName:failedPart.partName},
        success:{status:'action-completed',targetReached:true,settled:true}
      }
    });
  }
  const eligible=proposals.filter((proposal)=>proposal.eligible);
  return {
    status:eligible.length ? 'recovery-proposed' : 'recovery-unavailable',
    actorId,targetId,partName:failedPart.partName,originalAction:last.action || null,
    evidence:'current-contact-at-failure',proposals
  };
}

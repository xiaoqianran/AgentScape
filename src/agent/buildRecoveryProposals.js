const candidateKey = (candidate={}) => candidate.kind === 'object'
  ? `object:${candidate.objectId}:${candidate.partName || '$root'}`
  : `environment:${candidate.environmentId}:${candidate.colliderIndex ?? -1}`;

const currentExternalEvidence = (runtime,targetId,partName) => {
  const evidence=new Map();
  for (const contact of runtime.physics.articulationContacts?.(targetId,partName) || []) {
    if (!contact.external) continue;
    const target=contact.target || {};
    if (!['object','environment'].includes(target.kind)) continue;
    const key=candidateKey(target);
    const current=evidence.get(key) || {
      pairCount:0,contactCount:0,activeContactCount:0,minDistance:null,totalImpulse:0,colliderIndices:new Set()
    };
    current.pairCount+=1;
    current.contactCount+=Number(contact.contactCount) || 0;
    current.activeContactCount+=Number(contact.activeContactCount) || 0;
    if (Number.isFinite(contact.minDistance)) current.minDistance=current.minDistance == null
      ? contact.minDistance : Math.min(current.minDistance,contact.minDistance);
    current.totalImpulse+=Number(contact.totalImpulse) || 0;
    if (target.colliderIndex != null) current.colliderIndices.add(target.colliderIndex);
    evidence.set(key,current);
  }
  return new Map([...evidence].map(([key,value])=>[key,{
    pairCount:value.pairCount,
    contactCount:value.contactCount,
    activeContactCount:value.activeContactCount,
    minDistance:value.minDistance,
    totalImpulse:value.totalImpulse,
    colliderIndices:[...value.colliderIndices].sort((a,b)=>a-b)
  }]));
};

const candidateType = (candidate={}) => {
  if (candidate.kind==='environment') return 'environment-collider';
  if (candidate.kind==='object' && (candidate.partName || '$root')!=='$root') return 'articulated-part';
  if (candidate.kind==='object') return 'object-root';
  return 'unknown';
};

const denied = (candidate, reason, details={}) => ({
  blocker:structuredClone(candidate),candidateType:candidateType(candidate),eligible:false,status:'ineligible',reason,...details
});

const routeCostOf = (proposal) => Number.isFinite(proposal?.preflight?.pose?.routeCost)
  ? proposal.preflight.pose.routeCost : Infinity;

const originalVerification = (actorId,targetId,failedPart,last) => ({
  required:'retry-original-post-condition',
  tool:'approachAndInteract',
  args:{actorId,targetId,action:last.action || 'open',partName:failedPart.partName},
  success:{status:'action-completed',targetReached:true,settled:true}
});

const articulatedRecovery = async (runtime,registry,{actorId,targetId,failedPart,last,candidate,currentContact,profile}) => {
  const record=runtime.store.get(candidate.objectId);
  const blockerPartName=candidate.partName;
  const part=record?.manifest?.parts?.[blockerPartName];
  if (!part?.joint || !part.physics || !Object.keys(part.targets || {}).length) {
    return denied(candidate,'ARTICULATED_PART_UNAVAILABLE',{currentContact});
  }
  let blockerStatus;
  try {
    blockerStatus=runtime.interactions.articulationStatus(candidate.objectId,blockerPartName).parts?.find((value)=>value.partName===blockerPartName) || null;
  } catch {
    return denied(candidate,'ARTICULATED_STATE_UNAVAILABLE',{currentContact});
  }
  if (!blockerStatus?.verifiedAction) return denied(candidate,'ARTICULATED_STATE_UNVERIFIED',{currentContact,blockerState:blockerStatus});
  if (blockerStatus.requestedAction || blockerStatus.status==='moving') {
    return denied(candidate,'ARTICULATED_ACTION_PENDING',{currentContact,blockerState:blockerStatus});
  }
  const actions=(part.actions || []).filter((action)=>
    action!==blockerStatus.verifiedAction
    && ['open','close'].includes(action)
    && record.manifest.actions?.includes(action)
    && Number.isFinite(part.targets?.[action])
  );
  if (!actions.length) return denied(candidate,'NO_ALTERNATE_ARTICULATED_ACTION',{currentContact,blockerState:blockerStatus});
  if (actions.length!==1) return denied(candidate,'AMBIGUOUS_ARTICULATED_RECOVERY',{currentContact,blockerState:blockerStatus,alternateActions:actions});
  const blockerAction=actions[0];
  const authorization=registry.authorization('recoverArticulatedBlocker',{profile});
  if (!authorization.allow) return {
    blocker:structuredClone(candidate),candidateType:candidateType(candidate),eligible:false,status:'denied',reason:'POLICY_DENIED',currentContact,
    blockerState:structuredClone(blockerStatus),blockerAction,
    policy:{allow:false,profile:authorization.profile,missing:[...authorization.missing]}
  };
  let pose;
  try {
    pose=await runtime.interactions.findInteractionPose(actorId,candidate.objectId,{action:blockerAction,partName:blockerPartName});
  } catch (error) {
    return denied(candidate,error.details?.reason || error.code || 'ARTICULATED_RECOVERY_PREFLIGHT_FAILED',{
      currentContact,blockerState:blockerStatus,blockerAction
    });
  }
  if (!pose) return denied(candidate,'NO_INTERACTION_POSE',{currentContact,blockerState:blockerStatus,blockerAction});
  return {
    blocker:structuredClone(candidate),candidateType:candidateType(candidate),eligible:true,status:'provisional',recovery:'articulated-blocker',
    evidence:'current-contact-at-failure',currentContact,
    blockerState:{
      partName:blockerPartName,status:blockerStatus.status,requestedAction:null,verifiedAction:blockerStatus.verifiedAction,
      ...(blockerStatus.live ? {live:structuredClone(blockerStatus.live)} : {})
    },
    blockerAction,
    policy:{allow:true,profile:authorization.profile,missing:[]},
    preflight:{pose:structuredClone(pose),actionSweep:{checked:true,clear:true,partName:blockerPartName}},
    rankingEvidence:{causal:false,recoveryRouteCost:Number.isFinite(pose.routeCost)?pose.routeCost:null},
    tool:'recoverArticulatedBlocker',
    args:{actorId,targetId,partName:failedPart.partName,blockerId:candidate.objectId,blockerPartName,blockerAction},
    verification:originalVerification(actorId,targetId,failedPart,last)
  };
};

const rankProposals = (proposals) => {
  const eligible=proposals.filter((proposal)=>proposal.eligible).sort((a,b)=>
    routeCostOf(a)-routeCostOf(b) || candidateKey(a.blocker).localeCompare(candidateKey(b.blocker))
  );
  eligible.forEach((proposal,index)=>{proposal.rank=index+1;});
  const ineligible=proposals.filter((proposal)=>!proposal.eligible).sort((a,b)=>
    candidateKey(a.blocker).localeCompare(candidateKey(b.blocker))
  );
  return [...eligible,...ineligible];
};

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

  const currentEvidence=currentExternalEvidence(runtime,targetId,failedPart.partName);
  const authorization=registry.authorization('recoverPickupBlocker',{profile});
  const proposals=[];
  for (const candidate of attribution.blockerCandidates) {
    const currentContact=currentEvidence.get(candidateKey(candidate)) || null;
    if (candidate.kind==='environment') {
      proposals.push(denied(candidate,'ENVIRONMENT_IMMOVABLE',{currentContact}));
      continue;
    }
    if (candidate.kind!=='object' || !candidate.objectId || !runtime.store.has(candidate.objectId)) {
      proposals.push(denied(candidate,'BLOCKER_OBJECT_UNAVAILABLE',{currentContact}));
      continue;
    }
    if (!currentContact) {
      proposals.push(denied(candidate,'CONTACT_EVIDENCE_STALE',{status:'stale',currentContact:null}));
      continue;
    }
    if ((candidate.partName || '$root')!=='$root') {
      proposals.push(await articulatedRecovery(runtime,registry,{actorId,targetId,failedPart,last,candidate,currentContact,profile}));
      continue;
    }
    if (!authorization.allow) {
      proposals.push({
        blocker:structuredClone(candidate),candidateType:candidateType(candidate),eligible:false,status:'denied',reason:'POLICY_DENIED',currentContact,
        policy:{allow:false,profile:authorization.profile,missing:[...authorization.missing]}
      });
      continue;
    }
    let pickupPlan;
    try {
      runtime.interactions.assertAgentCarryable(actorId,candidate.objectId);
      pickupPlan=await runtime.interactions.findPickupPlan(actorId,candidate.objectId);
    } catch (error) {
      proposals.push(denied(candidate,error.details?.reason || error.code || 'BLOCKER_NOT_CARRYABLE',{currentContact}));
      continue;
    }
    if (!pickupPlan?.transfer?.clear) {
      proposals.push(denied(candidate,'PICKUP_TRANSFER_BLOCKED',{currentContact}));
      continue;
    }
    const retryAction=last.action || 'open';
    proposals.push({
      blocker:structuredClone(candidate),candidateType:candidateType(candidate),eligible:true,status:'provisional',recovery:'pickup-blocker',
      evidence:'current-contact-at-failure',currentContact,
      policy:{allow:true,profile:authorization.profile,missing:[]},
      preflight:{pose:structuredClone(pickupPlan.pose),transfer:{clear:true}},
      rankingEvidence:{causal:false,pickupRouteCost:Number.isFinite(pickupPlan.pose?.routeCost)?pickupPlan.pose.routeCost:null},
      tool:'recoverPickupBlocker',args:{actorId,targetId,partName:failedPart.partName,blockerId:candidate.objectId},
      verification:originalVerification(actorId,targetId,failedPart,{...last,action:retryAction})
    });
  }
  const ranked=rankProposals(proposals);
  const eligible=ranked.filter((proposal)=>proposal.eligible);
  let cleanupRecommended=null;
  const heldRecovery=runtime.interactions.recoveryHeldStatus?.(actorId) || null;
  if (!eligible.length && heldRecovery?.targetId===targetId && ranked.some((proposal)=>proposal.reason==='HANDS_FULL')) {
    const cleanupAuthorization=registry.authorization('cleanupRecoveryBlocker',{profile});
    if (!cleanupAuthorization.allow) {
      cleanupRecommended={
        status:'denied',reason:'POLICY_DENIED',blockerId:heldRecovery.blockerId,
        policy:{allow:false,profile:cleanupAuthorization.profile,missing:[...cleanupAuthorization.missing]}
      };
    } else {
      const cleanupPlan=await runtime.interactions.findRecoveryCleanupPlan(actorId,targetId,{
        partName:failedPart.partName,action:last.action || heldRecovery.action,blockerId:heldRecovery.blockerId
      });
      cleanupRecommended=cleanupPlan.status==='cleanup-proposed' ? {
        status:'provisional',reason:'HANDS_FULL_WITH_RECOVERY_BLOCKER',
        blockerId:heldRecovery.blockerId,
        policy:{allow:true,profile:cleanupAuthorization.profile,missing:[]},
        tool:'cleanupRecoveryBlocker',
        args:{actorId,targetId,partName:failedPart.partName,action:last.action || heldRecovery.action,blockerId:heldRecovery.blockerId},
        plan:cleanupPlan,
        verification:{required:'replan-recovery-after-cleanup',cleanupStatus:'recovery-cleaned'}
      } : {status:'unavailable',reason:cleanupPlan.reason || 'NO_SAFE_CLEANUP_SPACE',blockerId:heldRecovery.blockerId,plan:cleanupPlan};
    }
  }
  return {
    status:eligible.length ? 'recovery-proposed' : (cleanupRecommended?.status==='provisional' ? 'recovery-cleanup-proposed' : 'recovery-unavailable'),
    actorId,targetId,partName:failedPart.partName,originalAction:last.action || null,
    evidence:'current-contact-at-failure',
    ranking:{
      strategy:'eligible-recovery-route-cost-v2',causal:false,
      criteria:['eligible','recoveryRouteCostAsc','stableBlockerKeyAsc']
    },
    recommended:eligible[0] ? {
      rank:1,blocker:structuredClone(eligible[0].blocker),tool:eligible[0].tool,args:structuredClone(eligible[0].args)
    } : null,
    ...(cleanupRecommended ? {cleanupRecommended} : {}),
    proposals:ranked
  };
}

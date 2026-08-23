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

const boundsOverlap = (a,b) => {
  if (!a?.min || !a?.max || !b?.min || !b?.max) return {available:false,intersects:false,volume:null};
  const extents=[0,1,2].map((index)=>Math.max(0,Math.min(a.max[index],b.max[index])-Math.max(a.min[index],b.min[index])));
  const intersects=extents.every((value)=>value>1e-9);
  return {available:true,intersects,volume:intersects ? extents[0]*extents[1]*extents[2] : 0};
};

const counterfactualTuple = (evidence) => [
  evidence.targetSweepClear ? 1 : 0,
  evidence.overlapReduction,
  -evidence.targetOverlapVolume,
  -evidence.actionSweepOverlapVolume
];

const compareCounterfactual = (a,b) => {
  const ta=counterfactualTuple(a.counterfactual),tb=counterfactualTuple(b.counterfactual);
  for(let i=0;i<ta.length;i++) if (ta[i]!==tb[i]) return tb[i]-ta[i];
  return (a.pose?.routeCost ?? Infinity)-(b.pose?.routeCost ?? Infinity) || a.action.localeCompare(b.action);
};

const sameCounterfactualDecision = (a,b) => {
  if (!a || !b) return false;
  const ta=counterfactualTuple(a.counterfactual),tb=counterfactualTuple(b.counterfactual);
  const routeA=a.pose?.routeCost ?? Infinity,routeB=b.pose?.routeCost ?? Infinity;
  const sameRoute=Number.isFinite(routeA)&&Number.isFinite(routeB) ? Math.abs(routeA-routeB)<=1e-9 : routeA===routeB;
  return ta.every((value,index)=>Math.abs(value-tb[index])<=1e-9) && sameRoute;
};

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
  const authorization=registry.authorization('recoverArticulatedBlocker',{profile});
  if (!authorization.allow) return {
    blocker:structuredClone(candidate),candidateType:candidateType(candidate),eligible:false,status:'denied',reason:'POLICY_DENIED',currentContact,
    blockerState:structuredClone(blockerStatus),
    ...(actions.length===1?{blockerAction:actions[0]}:{alternateActions:[...actions]}),
    policy:{allow:false,profile:authorization.profile,missing:[...authorization.missing]}
  };

  let actionCandidates=[];
  if (actions.length===1) {
    const blockerAction=actions[0];
    let pose;
    try {
      pose=await runtime.interactions.findInteractionPose(actorId,candidate.objectId,{action:blockerAction,partName:blockerPartName});
    } catch (error) {
      return denied(candidate,error.details?.reason || error.code || 'ARTICULATED_RECOVERY_PREFLIGHT_FAILED',{
        currentContact,blockerState:blockerStatus,blockerAction
      });
    }
    if (!pose) return denied(candidate,'NO_INTERACTION_POSE',{currentContact,blockerState:blockerStatus,blockerAction});
    actionCandidates=[{action:blockerAction,pose,counterfactual:null}];
  } else {
    const originalAction=last.action || 'open';
    const originalSweep=runtime.interactions.actionSweepBounds?.(targetId,originalAction,failedPart.partName);
    const currentPose=runtime.interactions.actionSweepBounds?.(candidate.objectId,blockerStatus.verifiedAction,blockerPartName,1);
    if (!originalSweep?.checked || !currentPose?.checked) return denied(candidate,'COUNTERFACTUAL_EVIDENCE_UNAVAILABLE',{
      currentContact,blockerState:blockerStatus,alternateActions:[...actions],
      counterfactual:{causal:false,originalSweepChecked:Boolean(originalSweep?.checked),currentPoseChecked:Boolean(currentPose?.checked)}
    });
    const currentOverlap=boundsOverlap(originalSweep.bounds,currentPose.bounds);
    if (!currentOverlap.available || !currentOverlap.intersects || !(currentOverlap.volume>0)) return denied(candidate,'COUNTERFACTUAL_EVIDENCE_INSUFFICIENT',{
      currentContact,blockerState:blockerStatus,alternateActions:[...actions],
      counterfactual:{causal:false,currentOverlapVolume:currentOverlap.volume,originalSweep:structuredClone(originalSweep.bounds),currentPose:structuredClone(currentPose.bounds)}
    });
    for (const action of actions) {
      const actionSweep=runtime.interactions.actionSweepBounds?.(candidate.objectId,action,blockerPartName);
      const targetPose=runtime.interactions.actionSweepBounds?.(candidate.objectId,action,blockerPartName,1);
      if (!actionSweep?.checked || !targetPose?.checked) {
        actionCandidates.push({action,executable:false,reason:'ACTION_GEOMETRY_UNAVAILABLE'});
        continue;
      }
      let pose=null;
      try { pose=await runtime.interactions.findInteractionPose(actorId,candidate.objectId,{action,partName:blockerPartName}); }
      catch (error) {
        actionCandidates.push({action,executable:false,reason:error.details?.reason || error.code || 'ARTICULATED_RECOVERY_PREFLIGHT_FAILED'});
        continue;
      }
      if (!pose) {
        actionCandidates.push({action,executable:false,reason:'NO_INTERACTION_POSE'});
        continue;
      }
      const targetOverlap=boundsOverlap(originalSweep.bounds,targetPose.bounds);
      const actionOverlap=boundsOverlap(originalSweep.bounds,actionSweep.bounds);
      if (!targetOverlap.available || !actionOverlap.available) {
        actionCandidates.push({action,executable:false,reason:'ACTION_GEOMETRY_UNAVAILABLE'});
        continue;
      }
      const overlapReduction=Math.max(0,currentOverlap.volume-targetOverlap.volume);
      actionCandidates.push({
        action,executable:true,pose,
        counterfactual:{
          causal:false,geometry:'three-aabb',
          currentOverlapVolume:Number(currentOverlap.volume.toFixed(6)),
          targetOverlapVolume:Number(targetOverlap.volume.toFixed(6)),
          overlapReduction:Number(overlapReduction.toFixed(6)),
          targetSweepClear:!targetOverlap.intersects,
          actionSweepOverlapVolume:Number(actionOverlap.volume.toFixed(6)),
          targetBounds:structuredClone(targetPose.bounds),
          actionSweepBounds:structuredClone(actionSweep.bounds)
        }
      });
    }
    const viable=actionCandidates.filter((item)=>item.executable && item.counterfactual.overlapReduction>1e-9).sort(compareCounterfactual);
    const rankedActions=actionCandidates.map((item)=>structuredClone(item));
    if (!viable.length) return denied(candidate,'NO_COUNTERFACTUAL_CLEARANCE_GAIN',{
      currentContact,blockerState:blockerStatus,alternateActions:[...actions],
      actionRanking:{strategy:'articulated-target-sweep-counterfactual-v1',causal:false,criteria:['targetSweepClearDesc','overlapReductionDesc','targetOverlapVolumeAsc','actionSweepOverlapVolumeAsc','routeCostAsc'],actions:rankedActions}
    });
    if (sameCounterfactualDecision(viable[0],viable[1])) return denied(candidate,'COUNTERFACTUAL_ACTION_TIE',{
      currentContact,blockerState:blockerStatus,alternateActions:[...actions],
      actionRanking:{strategy:'articulated-target-sweep-counterfactual-v1',causal:false,criteria:['targetSweepClearDesc','overlapReductionDesc','targetOverlapVolumeAsc','actionSweepOverlapVolumeAsc','routeCostAsc'],tiedActions:[viable[0].action,viable[1].action],actions:rankedActions}
    });
    viable.forEach((item,index)=>{ const target=rankedActions.find((entry)=>entry.action===item.action); if(target) target.rank=index+1; });
    actionCandidates=[{...viable[0],actionRanking:{
      strategy:'articulated-target-sweep-counterfactual-v1',causal:false,
      criteria:['targetSweepClearDesc','overlapReductionDesc','targetOverlapVolumeAsc','actionSweepOverlapVolumeAsc','routeCostAsc'],
      current:{action:blockerStatus.verifiedAction,overlapVolume:Number(currentOverlap.volume.toFixed(6)),bounds:structuredClone(currentPose.bounds)},
      originalSweep:structuredClone(originalSweep.bounds),
      actions:rankedActions
    }}];
  }

  const selected=actionCandidates[0];
  const blockerAction=selected.action;
  return {
    blocker:structuredClone(candidate),candidateType:candidateType(candidate),eligible:true,status:'provisional',recovery:'articulated-blocker',
    evidence:'current-contact-at-failure',currentContact,
    blockerState:{
      partName:blockerPartName,status:blockerStatus.status,requestedAction:null,verifiedAction:blockerStatus.verifiedAction,
      ...(blockerStatus.live ? {live:structuredClone(blockerStatus.live)} : {})
    },
    blockerAction,
    ...(selected.actionRanking?{actionRanking:selected.actionRanking}:{}),
    policy:{allow:true,profile:authorization.profile,missing:[]},
    preflight:{pose:structuredClone(selected.pose),actionSweep:{checked:true,clear:true,partName:blockerPartName}},
    rankingEvidence:{causal:false,recoveryRouteCost:Number.isFinite(selected.pose.routeCost)?selected.pose.routeCost:null},
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

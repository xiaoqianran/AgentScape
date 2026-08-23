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

const physicsCounterfactualTuple = (evidence) => [
  evidence.targetSweepClear ? 1 : 0,
  evidence.conflictReduction,
  -evidence.target.conflictSamples,
  -evidence.target.pairIntersections,
  -evidence.action.conflictSamplePairs,
  -evidence.action.pairIntersections
];

const comparePhysicsCounterfactual = (a,b) => {
  const ta=physicsCounterfactualTuple(a.physicsCounterfactual),tb=physicsCounterfactualTuple(b.physicsCounterfactual);
  for(let i=0;i<ta.length;i++) if (ta[i]!==tb[i]) return tb[i]-ta[i];
  return (a.pose?.routeCost ?? Infinity)-(b.pose?.routeCost ?? Infinity) || a.action.localeCompare(b.action);
};

const samePhysicsCounterfactualDecision = (a,b) => {
  if (!a || !b) return false;
  const ta=physicsCounterfactualTuple(a.physicsCounterfactual),tb=physicsCounterfactualTuple(b.physicsCounterfactual);
  const routeA=a.pose?.routeCost ?? Infinity,routeB=b.pose?.routeCost ?? Infinity;
  const sameRoute=Number.isFinite(routeA)&&Number.isFinite(routeB) ? Math.abs(routeA-routeB)<=1e-9 : routeA===routeB;
  return ta.every((value,index)=>value===tb[index]) && sameRoute;
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
    const originalRecord=runtime.store.get(targetId);
    const originalTarget=originalRecord?.manifest?.parts?.[failedPart.partName]?.targets?.[originalAction];
    const originalSweep=runtime.interactions.actionSweepBounds?.(targetId,originalAction,failedPart.partName);
    const currentPose=runtime.interactions.actionSweepBounds?.(candidate.objectId,blockerStatus.verifiedAction,blockerPartName,1);
    const visualAvailable=Boolean(originalSweep?.checked && currentPose?.checked);
    const currentOverlap=visualAvailable ? boundsOverlap(originalSweep.bounds,currentPose.bounds) : {available:false,intersects:false,volume:null};
    const physicsCapable=Number.isFinite(originalTarget) && typeof runtime.physics?.articulationPairCounterfactual==='function';
    if (!physicsCapable && (!visualAvailable || !currentOverlap.available || !currentOverlap.intersects || !(currentOverlap.volume>0))) {
      return denied(candidate,visualAvailable?'COUNTERFACTUAL_EVIDENCE_INSUFFICIENT':'COUNTERFACTUAL_EVIDENCE_UNAVAILABLE',{
        currentContact,blockerState:blockerStatus,alternateActions:[...actions],
        counterfactual:{
          causal:false,physicsFallbackReason:'PHYSICS_COUNTERFACTUAL_UNAVAILABLE',
          ...(visualAvailable?{currentOverlapVolume:currentOverlap.volume,originalSweep:structuredClone(originalSweep.bounds),currentPose:structuredClone(currentPose.bounds)}:{originalSweepChecked:Boolean(originalSweep?.checked),currentPoseChecked:Boolean(currentPose?.checked)})
        }
      });
    }

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
      const targetOverlap=visualAvailable ? boundsOverlap(originalSweep.bounds,targetPose.bounds) : {available:false,intersects:false,volume:null};
      const actionOverlap=visualAvailable ? boundsOverlap(originalSweep.bounds,actionSweep.bounds) : {available:false,intersects:false,volume:null};
      const visualCounterfactual=visualAvailable && currentOverlap.available && targetOverlap.available && actionOverlap.available ? {
        causal:false,geometry:'three-aabb',
        currentOverlapVolume:Number((currentOverlap.volume || 0).toFixed(6)),
        targetOverlapVolume:Number((targetOverlap.volume || 0).toFixed(6)),
        overlapReduction:Number(Math.max(0,(currentOverlap.volume || 0)-(targetOverlap.volume || 0)).toFixed(6)),
        targetSweepClear:!targetOverlap.intersects,
        actionSweepOverlapVolume:Number((actionOverlap.volume || 0).toFixed(6)),
        targetBounds:structuredClone(targetPose.bounds),
        actionSweepBounds:structuredClone(actionSweep.bounds)
      } : null;
      let physicsCounterfactual={checked:false,reason:'PHYSICS_COUNTERFACTUAL_UNAVAILABLE'};
      if (physicsCapable) {
        try {
          physicsCounterfactual=runtime.physics.articulationPairCounterfactual(
            targetId,failedPart.partName,originalTarget,
            candidate.objectId,blockerPartName,part.targets[action]
          ) || physicsCounterfactual;
        } catch (error) {
          physicsCounterfactual={checked:false,reason:error.code || 'PHYSICS_COUNTERFACTUAL_ERROR'};
        }
      }
      actionCandidates.push({action,executable:true,pose,visualCounterfactual,physicsCounterfactual});
    }

    const executable=actionCandidates.filter((item)=>item.executable);
    const physicsCurrent=executable.map((item)=>item.physicsCounterfactual?.current).filter(Boolean);
    const physicsBaselineConsistent=physicsCurrent.length===executable.length && physicsCurrent.every((value)=>
      value.conflictSamples===physicsCurrent[0]?.conflictSamples && value.pairIntersections===physicsCurrent[0]?.pairIntersections
    );
    let physicsReady=Boolean(executable.length)
      && executable.every((item)=>item.physicsCounterfactual?.checked && item.physicsCounterfactual.current?.conflictSamples>0)
      && physicsBaselineConsistent;
    let physicsConvergence=null,physicsConvergenceFallbackReason=null;
    const physicsViable=physicsReady ? executable.filter((item)=>item.physicsCounterfactual.conflictReduction>0).sort(comparePhysicsCounterfactual) : [];
    if (physicsReady && physicsViable.length && typeof runtime.physics?.articulationPairCounterfactualConvergence==='function') {
      const top=physicsViable[0];
      try {
        const raw=runtime.physics.articulationPairCounterfactualConvergence(
          targetId,failedPart.partName,originalTarget,
          candidate.objectId,blockerPartName,part.targets[top.action]
        );
        if (raw?.checked) {
          physicsConvergence={
            status:raw.status,causal:false,
            qualitative:structuredClone(raw.qualitative),
            samples:{base:structuredClone(raw.base?.samples || null),dense:structuredClone(raw.dense?.samples || null)},
            ratios:structuredClone(raw.ratios || null),maxRatioDrift:raw.maxRatioDrift
          };
          if (raw.status!=='stable') {
            physicsReady=false;
            physicsConvergenceFallbackReason='PHYSICS_COUNTERFACTUAL_UNSTABLE';
          }
        } else {
          physicsReady=false;
          physicsConvergenceFallbackReason='PHYSICS_COUNTERFACTUAL_CONVERGENCE_UNAVAILABLE';
        }
      } catch {
        physicsReady=false;
        physicsConvergenceFallbackReason='PHYSICS_COUNTERFACTUAL_CONVERGENCE_ERROR';
      }
    }
    let viable,rankedActions,strategy,criteria,basis,fallbackReason=null,currentEvidence;
    if (physicsReady) {
      viable=physicsViable;
      rankedActions=actionCandidates.map((item)=>structuredClone(item));
      strategy='articulated-rapier-shape-counterfactual-v2';
      basis='rapier-shape-pairs';
      criteria=['targetSweepClearDesc','conflictReductionDesc','targetConflictSamplesAsc','targetPairIntersectionsAsc','actionConflictSamplePairsAsc','actionPairIntersectionsAsc','routeCostAsc'];
      currentEvidence={
        action:blockerStatus.verifiedAction,
        conflictSamples:executable[0].physicsCounterfactual.current.conflictSamples,
        pairIntersections:executable[0].physicsCounterfactual.current.pairIntersections
      };
    } else {
      fallbackReason=physicsConvergenceFallbackReason || (!executable.length ? 'NO_EXECUTABLE_ACTION'
        : executable.some((item)=>!item.physicsCounterfactual?.checked) ? 'PHYSICS_COUNTERFACTUAL_PARTIAL_COVERAGE'
        : !physicsBaselineConsistent ? 'PHYSICS_COUNTERFACTUAL_BASELINE_INCONSISTENT'
        : 'PHYSICS_COUNTERFACTUAL_BASELINE_INSUFFICIENT');
      if (!visualAvailable) return denied(candidate,'COUNTERFACTUAL_EVIDENCE_UNAVAILABLE',{
        currentContact,blockerState:blockerStatus,alternateActions:[...actions],
        counterfactual:{causal:false,physicsFallbackReason:fallbackReason,originalSweepChecked:Boolean(originalSweep?.checked),currentPoseChecked:Boolean(currentPose?.checked)}
      });
      if (!currentOverlap.available || !currentOverlap.intersects || !(currentOverlap.volume>0)) return denied(candidate,'COUNTERFACTUAL_EVIDENCE_INSUFFICIENT',{
        currentContact,blockerState:blockerStatus,alternateActions:[...actions],
        counterfactual:{causal:false,physicsFallbackReason:fallbackReason,currentOverlapVolume:currentOverlap.volume,originalSweep:structuredClone(originalSweep.bounds),currentPose:structuredClone(currentPose.bounds)}
      });
      viable=executable.filter((item)=>item.visualCounterfactual?.overlapReduction>1e-9).map((item)=>({...item,counterfactual:item.visualCounterfactual})).sort(compareCounterfactual);
      rankedActions=actionCandidates.map((item)=>structuredClone(item));
      strategy='articulated-target-sweep-counterfactual-v1';
      basis='three-aabb-fallback';
      criteria=['targetSweepClearDesc','overlapReductionDesc','targetOverlapVolumeAsc','actionSweepOverlapVolumeAsc','routeCostAsc'];
      currentEvidence={action:blockerStatus.verifiedAction,overlapVolume:Number(currentOverlap.volume.toFixed(6)),bounds:structuredClone(currentPose.bounds)};
    }

    if (!viable.length) return denied(candidate,'NO_COUNTERFACTUAL_CLEARANCE_GAIN',{
      currentContact,blockerState:blockerStatus,alternateActions:[...actions],
      actionRanking:{strategy,basis,causal:false,criteria,...(fallbackReason?{fallbackReason}:{}),...(physicsConvergence?{convergence:physicsConvergence}:{}),actions:rankedActions}
    });
    const tied=physicsReady ? samePhysicsCounterfactualDecision(viable[0],viable[1]) : sameCounterfactualDecision(viable[0],viable[1]);
    if (tied) return denied(candidate,'COUNTERFACTUAL_ACTION_TIE',{
      currentContact,blockerState:blockerStatus,alternateActions:[...actions],
      actionRanking:{strategy,basis,causal:false,criteria,...(fallbackReason?{fallbackReason}:{}),...(physicsConvergence?{convergence:physicsConvergence}:{}),tiedActions:[viable[0].action,viable[1].action],actions:rankedActions}
    });
    viable.forEach((item,index)=>{ const target=rankedActions.find((entry)=>entry.action===item.action); if(target) target.rank=index+1; });
    actionCandidates=[{...viable[0],actionRanking:{
      strategy,basis,causal:false,criteria,...(fallbackReason?{fallbackReason}:{}),...(physicsConvergence?{convergence:physicsConvergence}:{}),
      current:currentEvidence,
      ...(visualAvailable?{originalSweep:structuredClone(originalSweep.bounds)}:{}),
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

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
    if ((candidate.partName || '$root')!=='$root') {
      proposals.push(denied(candidate,'ARTICULATED_PART_RECOVERY_UNSUPPORTED',{currentContact}));
      continue;
    }
    if (!currentContact) {
      proposals.push(denied(candidate,'CONTACT_EVIDENCE_STALE',{status:'stale',currentContact:null}));
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
      verification:{
        required:'retry-original-post-condition',
        tool:'approachAndInteract',
        args:{actorId,targetId,action:retryAction,partName:failedPart.partName},
        success:{status:'action-completed',targetReached:true,settled:true}
      }
    });
  }
  const ranked=rankProposals(proposals);
  const eligible=ranked.filter((proposal)=>proposal.eligible);
  return {
    status:eligible.length ? 'recovery-proposed' : 'recovery-unavailable',
    actorId,targetId,partName:failedPart.partName,originalAction:last.action || null,
    evidence:'current-contact-at-failure',
    ranking:{
      strategy:'eligible-pickup-route-cost-v1',causal:false,
      criteria:['eligible','pickupRouteCostAsc','stableBlockerKeyAsc']
    },
    recommended:eligible[0] ? {
      rank:1,blocker:structuredClone(eligible[0].blocker),tool:eligible[0].tool,args:structuredClone(eligible[0].args)
    } : null,
    proposals:ranked
  };
}

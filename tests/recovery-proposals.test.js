import { describe, expect, it, vi } from 'vitest';
import { buildRecoveryProposals } from '../src/agent/buildRecoveryProposals.js';

const blockerCandidate={kind:'object',objectId:'blocker_01',partName:'$root',colliderIndex:0};
const environmentCandidate={kind:'environment',environmentId:'monument-hall',colliderIndex:4};

function setup({candidates=[blockerCandidate],current=[blockerCandidate],allow=true,cleanupAllow=allow,carryError=null,planCosts={},recoveryHeld=null,cleanupPlan=null}={}){
  const records=new Map([
    ['agent_01',{id:'agent_01',assetId:'agent',manifest:{actions:['navigate']},state:{}}],
    ['cabinet_01',{id:'cabinet_01',assetId:'cabinet',manifest:{actions:['open','close']},state:{}}],
    ['blocker_01',{id:'blocker_01',assetId:'blocker',manifest:{actions:['pickup','drop'],physics:{body:'dynamic'}},state:{}}],
    ['blocker_02',{id:'blocker_02',assetId:'blocker',manifest:{actions:['pickup','drop'],physics:{body:'dynamic'}},state:{}}],
    ['articulated_01',{id:'articulated_01',assetId:'cabinet',manifest:{actions:['open','close'],physics:{body:'fixed'}},state:{}}]
  ]);
  const runtime={
    store:{has:(id)=>records.has(id),get:(id)=>records.get(id)},
    physics:{articulationContacts:vi.fn(()=>current.map((item)=>item?.target ? item : ({external:true,target:item,contactCount:1,activeContactCount:1,minDistance:-.001,totalImpulse:1})))},
    interactions:{
      articulationStatus:vi.fn(()=>({id:'cabinet_01',parts:[{
        partName:'door',status:'action-failed',last:{status:'action-failed',reason:'STALL',action:'open',attribution:{status:'contact-evidence',blockerCandidates:candidates}}
      }]})),
      assertAgentCarryable:vi.fn(()=>{if(carryError) throw Object.assign(new Error(carryError),{code:'CARRY_UNAVAILABLE',details:{reason:carryError}});}),
      findPickupPlan:vi.fn(async(_actor,id)=>({pose:{status:'approach-pose',position:[1,0,1],routeCost:planCosts[id] ?? 1},transfer:{clear:true}})),
      recoveryHeldStatus:vi.fn(()=>recoveryHeld),
      findRecoveryCleanupPlan:vi.fn(async()=>cleanupPlan || {status:'cleanup-unavailable',reason:'NO_SAFE_CLEANUP_SPACE'})
    }
  };
  const registry={authorization:vi.fn((name)=>{
    const granted=name==='cleanupRecoveryBlocker'?cleanupAllow:allow;
    return {allow:granted,profile:'builder',missing:granted?[]:['world.write'],required:['world.write','spatial.read','physics.read']};
  })};
  return {runtime,registry};
}

describe('verified recovery proposals',()=>{
  it('proposes embodied pickup only for a currently contacting carryable object and makes original retry explicit',async()=>{
    const {runtime,registry}=setup();
    const result=await buildRecoveryProposals(runtime,registry,{actorId:'agent_01',targetId:'cabinet_01'});
    expect(result).toMatchObject({status:'recovery-proposed',partName:'door',originalAction:'open',evidence:'current-contact-at-failure'});
    expect(result.proposals).toEqual([expect.objectContaining({
      blocker:blockerCandidate,eligible:true,status:'provisional',recovery:'pickup-blocker',
      tool:'recoverPickupBlocker',args:{actorId:'agent_01',targetId:'cabinet_01',partName:'door',blockerId:'blocker_01'},
      policy:{allow:true,profile:'builder',missing:[]},
      verification:{
        required:'retry-original-post-condition',tool:'approachAndInteract',
        args:{actorId:'agent_01',targetId:'cabinet_01',action:'open',partName:'door'},
        success:{status:'action-completed',targetReached:true,settled:true}
      }
    })]);
    expect(runtime.interactions.assertAgentCarryable).toHaveBeenCalledWith('agent_01','blocker_01');
  });

  it('never proposes moving an environment blocker',async()=>{
    const {runtime,registry}=setup({candidates:[environmentCandidate],current:[environmentCandidate]});
    const result=await buildRecoveryProposals(runtime,registry,{actorId:'agent_01',targetId:'cabinet_01'});
    expect(result).toMatchObject({status:'recovery-unavailable',proposals:[{eligible:false,status:'ineligible',reason:'ENVIRONMENT_IMMOVABLE',blocker:environmentCandidate}]});
    expect(runtime.interactions.assertAgentCarryable).not.toHaveBeenCalled();
  });

  it('rejects stale contact evidence instead of executing a historical blocker proposal',async()=>{
    const {runtime,registry}=setup({current:[]});
    const result=await buildRecoveryProposals(runtime,registry,{actorId:'agent_01',targetId:'cabinet_01'});
    expect(result.proposals[0]).toMatchObject({eligible:false,status:'stale',reason:'CONTACT_EVIDENCE_STALE'});
  });

  it('surfaces policy denial before capability execution',async()=>{
    const {runtime,registry}=setup({allow:false});
    const result=await buildRecoveryProposals(runtime,registry,{actorId:'agent_01',targetId:'cabinet_01',profile:'viewer'});
    expect(result.proposals[0]).toMatchObject({eligible:false,status:'denied',reason:'POLICY_DENIED',policy:{allow:false,missing:['world.write']}});
    expect(runtime.interactions.assertAgentCarryable).not.toHaveBeenCalled();
  });

  it('keeps a non-carryable object ineligible with the Runtime reason',async()=>{
    const {runtime,registry}=setup({carryError:'TARGET_NOT_DYNAMIC'});
    const result=await buildRecoveryProposals(runtime,registry,{actorId:'agent_01',targetId:'cabinet_01'});
    expect(result.proposals[0]).toMatchObject({eligible:false,status:'ineligible',reason:'TARGET_NOT_DYNAMIC'});
  });

  it('ranks multiple eligible blockers by executable pickup route cost without treating contact force as causality',async()=>{
    const blocker2={kind:'object',objectId:'blocker_02',partName:'$root',colliderIndex:0};
    const current=[
      {external:true,target:{...blockerCandidate,colliderIndex:1},contactCount:3,activeContactCount:3,minDistance:-.02,totalImpulse:100},
      {external:true,target:blocker2,contactCount:1,activeContactCount:1,minDistance:-.001,totalImpulse:1},
      {external:true,target:environmentCandidate,contactCount:2,activeContactCount:2,minDistance:-.01,totalImpulse:20}
    ];
    const {runtime,registry}=setup({
      candidates:[blockerCandidate,blocker2,environmentCandidate],current,
      planCosts:{blocker_01:5,blocker_02:2}
    });
    const result=await buildRecoveryProposals(runtime,registry,{actorId:'agent_01',targetId:'cabinet_01'});
    expect(result.ranking).toEqual({
      strategy:'eligible-pickup-route-cost-v1',causal:false,
      criteria:['eligible','pickupRouteCostAsc','stableBlockerKeyAsc']
    });
    expect(result.recommended).toMatchObject({rank:1,blocker:{objectId:'blocker_02'},tool:'recoverPickupBlocker',args:{blockerId:'blocker_02'}});
    expect(result.proposals.slice(0,2).map((proposal)=>[proposal.blocker.objectId,proposal.rank,proposal.rankingEvidence.pickupRouteCost])).toEqual([
      ['blocker_02',1,2],['blocker_01',2,5]
    ]);
    const blocker1=result.proposals.find((proposal)=>proposal.blocker.objectId==='blocker_01');
    expect(blocker1.currentContact).toMatchObject({
      pairCount:1,contactCount:3,activeContactCount:3,minDistance:-.02,totalImpulse:100,colliderIndices:[1]
    });
    expect(blocker1.blocker.colliderIndex).toBe(0);
    expect(result.proposals.at(-1)).toMatchObject({candidateType:'environment-collider',eligible:false,reason:'ENVIRONMENT_IMMOVABLE'});
  });

  it('uses a stable blocker key only as a deterministic tie-break when pickup route costs are equal',async()=>{
    const blocker2={kind:'object',objectId:'blocker_02',partName:'$root',colliderIndex:0};
    const {runtime,registry}=setup({candidates:[blocker2,blockerCandidate],current:[blocker2,blockerCandidate],planCosts:{blocker_01:3,blocker_02:3}});
    const result=await buildRecoveryProposals(runtime,registry,{actorId:'agent_01',targetId:'cabinet_01'});
    expect(result.proposals.filter((proposal)=>proposal.eligible).map((proposal)=>proposal.blocker.objectId)).toEqual(['blocker_01','blocker_02']);
  });


  it('types an articulated Part blocker explicitly instead of treating it as a movable root object',async()=>{
    const articulated={kind:'object',objectId:'articulated_01',partName:'door',colliderIndex:0};
    const {runtime,registry}=setup({candidates:[articulated],current:[articulated]});
    const result=await buildRecoveryProposals(runtime,registry,{actorId:'agent_01',targetId:'cabinet_01'});
    expect(result).toMatchObject({
      status:'recovery-unavailable',recommended:null,
      proposals:[{candidateType:'articulated-part',eligible:false,status:'ineligible',reason:'ARTICULATED_PART_RECOVERY_UNSUPPORTED'}]
    });
    expect(runtime.interactions.findPickupPlan).not.toHaveBeenCalled();
  });


  it('offers cleanup when the next blocker is HANDS_FULL only because the Agent still holds a prior recovery blocker',async()=>{
    const held={blockerId:'blocker_02',targetId:'cabinet_01',partName:'door',action:'open'};
    const cleanup={status:'cleanup-proposed',actorId:'agent_01',targetId:'cabinet_01',partName:'door',action:'open',blockerId:'blocker_02',pose:{status:'approach-pose',position:[2,0,2],routeCost:1},release:[2,0.05,2],preflight:{sweepClear:true,endpointClear:true}};
    const {runtime,registry}=setup({carryError:'HANDS_FULL',recoveryHeld:held,cleanupPlan:cleanup});
    const result=await buildRecoveryProposals(runtime,registry,{actorId:'agent_01',targetId:'cabinet_01'});
    expect(result).toMatchObject({
      status:'recovery-cleanup-proposed',recommended:null,
      cleanupRecommended:{
        status:'provisional',reason:'HANDS_FULL_WITH_RECOVERY_BLOCKER',blockerId:'blocker_02',tool:'cleanupRecoveryBlocker',
        args:{actorId:'agent_01',targetId:'cabinet_01',partName:'door',action:'open',blockerId:'blocker_02'},
        verification:{required:'replan-recovery-after-cleanup',cleanupStatus:'recovery-cleaned'}
      }
    });
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({blocker:{objectId:'blocker_01'},eligible:false,reason:'HANDS_FULL'});
    expect(runtime.interactions.findRecoveryCleanupPlan).toHaveBeenCalledWith('agent_01','cabinet_01',{partName:'door',action:'open',blockerId:'blocker_02'});
  });

  it('does not offer cleanup for an unrelated held object without recovery provenance',async()=>{
    const {runtime,registry}=setup({carryError:'HANDS_FULL',recoveryHeld:null});
    const result=await buildRecoveryProposals(runtime,registry,{actorId:'agent_01',targetId:'cabinet_01'});
    expect(result.status).toBe('recovery-unavailable');
    expect(result).not.toHaveProperty('cleanupRecommended');
    expect(runtime.interactions.findRecoveryCleanupPlan).not.toHaveBeenCalled();
  });


  it('does not expose an executable cleanup proposal when cleanup Policy is denied',async()=>{
    const held={blockerId:'blocker_02',targetId:'cabinet_01',partName:'door',action:'open'};
    const cleanup={status:'cleanup-proposed',actorId:'agent_01',targetId:'cabinet_01',partName:'door',action:'open',blockerId:'blocker_02',pose:{status:'approach-pose',position:[2,0,2],routeCost:1},release:[2,0.05,2],preflight:{sweepClear:true,endpointClear:true}};
    const {runtime,registry}=setup({carryError:'HANDS_FULL',recoveryHeld:held,cleanupPlan:cleanup,cleanupAllow:false});
    const result=await buildRecoveryProposals(runtime,registry,{actorId:'agent_01',targetId:'cabinet_01'});
    expect(result.status).toBe('recovery-unavailable');
    expect(result.cleanupRecommended).toMatchObject({
      status:'denied',reason:'POLICY_DENIED',blockerId:'blocker_02',
      policy:{allow:false,profile:'builder',missing:['world.write']}
    });
    expect(result.cleanupRecommended).not.toHaveProperty('tool');
    expect(runtime.interactions.findRecoveryCleanupPlan).not.toHaveBeenCalled();
  });

});

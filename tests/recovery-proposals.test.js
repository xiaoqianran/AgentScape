import { describe, expect, it, vi } from 'vitest';
import { buildRecoveryProposals } from '../src/agent/buildRecoveryProposals.js';

const blockerCandidate={kind:'object',objectId:'blocker_01',partName:'$root',colliderIndex:0};
const environmentCandidate={kind:'environment',environmentId:'monument-hall',colliderIndex:4};

function setup({candidates=[blockerCandidate],current=[blockerCandidate],allow=true,articulatedAllow=allow,cleanupAllow=allow,carryError=null,planCosts={},recoveryHeld=null,cleanupPlan=null,articulatedStatus=null,articulatedActions=['open','close'],actionGeometry={},physicsCounterfactual=null}={}){
  const records=new Map([
    ['agent_01',{id:'agent_01',assetId:'agent',manifest:{actions:['navigate']},state:{}}],
    ['cabinet_01',{id:'cabinet_01',assetId:'cabinet',manifest:{actions:['open','close'],parts:{door:{node:'Door',actions:['open','close'],targets:{open:-1,close:0},physics:{body:'dynamic',colliders:[{}]},joint:{type:'revolute'}}}},state:{parts:{door:'close'}}}],
    ['blocker_01',{id:'blocker_01',assetId:'blocker',manifest:{actions:['pickup','drop'],physics:{body:'dynamic'}},state:{}}],
    ['blocker_02',{id:'blocker_02',assetId:'blocker',manifest:{actions:['pickup','drop'],physics:{body:'dynamic'}},state:{}}],
    ['articulated_01',{id:'articulated_01',assetId:'cabinet',manifest:{
      actions:[...new Set(['open','close',...articulatedActions])],physics:{body:'fixed'},
      parts:{door:{node:'Door',actions:articulatedActions,targets:Object.fromEntries(articulatedActions.map((action,index)=>[action,index===0?-1:index===1?0:.5])),physics:{body:'dynamic',colliders:[{shape:'box',halfExtents:[.4,.8,.05]}]},joint:{type:'revolute',axis:[0,1,0],limits:[-1,0]}}}
    },state:{parts:{door:'close'}}}]
  ]);
  const runtime={
    store:{has:(id)=>records.has(id),get:(id)=>records.get(id)},
    physics:{
      articulationContacts:vi.fn(()=>current.map((item)=>item?.target ? item : ({external:true,target:item,contactCount:1,activeContactCount:1,minDistance:-.001,totalImpulse:1}))),
      ...(physicsCounterfactual ? {articulationPairCounterfactual:vi.fn(physicsCounterfactual)} : {})
    },
    interactions:{
      articulationStatus:vi.fn((id)=>id==='articulated_01'
        ? {id,parts:[articulatedStatus || {partName:'door',status:'verified-state',requestedAction:null,verifiedAction:'close',live:{coordinate:0,target:0,error:0,tolerance:.08}}]}
        : {id:'cabinet_01',parts:[{
          partName:'door',status:'action-failed',last:{status:'action-failed',reason:'STALL',action:'open',attribution:{status:'contact-evidence',blockerCandidates:candidates}}
        }]}),
      assertAgentCarryable:vi.fn(()=>{if(carryError) throw Object.assign(new Error(carryError),{code:'CARRY_UNAVAILABLE',details:{reason:carryError}});}),
      findPickupPlan:vi.fn(async(_actor,id)=>({pose:{status:'approach-pose',position:[1,0,1],routeCost:planCosts[id] ?? 1},transfer:{clear:true}})),
      findInteractionPose:vi.fn(async(_actor,id,{action,partName})=>({status:'approach-pose',position:[2,0,2],routeCost:planCosts[`${id}:${partName}:${action}`] ?? planCosts[id] ?? 1,actionSweep:{checked:true,clear:true,partName}})),
      actionSweepBounds:vi.fn((id,action,partName,samples=9)=>{
        const key=`${id}:${action}:${samples===1?'target':'sweep'}`;
        const bounds=actionGeometry[key] || actionGeometry[`${id}:${action}`] || {min:[0,0,0],max:[1,1,1]};
        return {checked:true,partName,action,bounds};
      }),
      recoveryHeldStatus:vi.fn(()=>recoveryHeld),
      findRecoveryCleanupPlan:vi.fn(async()=>cleanupPlan || {status:'cleanup-unavailable',reason:'NO_SAFE_CLEANUP_SPACE'})
    }
  };
  const registry={authorization:vi.fn((name)=>{
    const granted=name==='cleanupRecoveryBlocker'?cleanupAllow:name==='recoverArticulatedBlocker'?articulatedAllow:allow;
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
      strategy:'eligible-recovery-route-cost-v2',causal:false,
      criteria:['eligible','recoveryRouteCostAsc','stableBlockerKeyAsc']
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


  it('proposes a verified unique alternate action for a current articulated Part blocker',async()=>{
    const articulated={kind:'object',objectId:'articulated_01',partName:'door',colliderIndex:0};
    const {runtime,registry}=setup({candidates:[articulated],current:[articulated],planCosts:{'articulated_01:door:open':2.5}});
    const result=await buildRecoveryProposals(runtime,registry,{actorId:'agent_01',targetId:'cabinet_01'});
    expect(result).toMatchObject({
      status:'recovery-proposed',
      ranking:{strategy:'eligible-recovery-route-cost-v2',causal:false},
      recommended:{rank:1,blocker:{objectId:'articulated_01',partName:'door'},tool:'recoverArticulatedBlocker',args:{blockerAction:'open'}},
      proposals:[{
        candidateType:'articulated-part',eligible:true,status:'provisional',recovery:'articulated-blocker',rank:1,
        blockerState:{partName:'door',status:'verified-state',requestedAction:null,verifiedAction:'close'},blockerAction:'open',
        tool:'recoverArticulatedBlocker',args:{actorId:'agent_01',targetId:'cabinet_01',partName:'door',blockerId:'articulated_01',blockerPartName:'door',blockerAction:'open'},
        rankingEvidence:{causal:false,recoveryRouteCost:2.5},
        verification:{required:'retry-original-post-condition',tool:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open',partName:'door'}}
      }]
    });
    expect(runtime.interactions.findInteractionPose).toHaveBeenCalledWith('agent_01','articulated_01',{action:'open',partName:'door'});
    expect(runtime.interactions.findPickupPlan).not.toHaveBeenCalled();
  });

  it('rejects an articulated blocker whose current Part state is not verified',async()=>{
    const articulated={kind:'object',objectId:'articulated_01',partName:'door',colliderIndex:0};
    const {runtime,registry}=setup({candidates:[articulated],current:[articulated],articulatedStatus:{partName:'door',status:'idle',requestedAction:null,verifiedAction:null}});
    const result=await buildRecoveryProposals(runtime,registry,{actorId:'agent_01',targetId:'cabinet_01'});
    expect(result.proposals[0]).toMatchObject({candidateType:'articulated-part',eligible:false,reason:'ARTICULATED_STATE_UNVERIFIED'});
    expect(runtime.interactions.findInteractionPose).not.toHaveBeenCalled();
  });

  it('rejects an articulated blocker while another Part action is pending',async()=>{
    const articulated={kind:'object',objectId:'articulated_01',partName:'door',colliderIndex:0};
    const {runtime,registry}=setup({candidates:[articulated],current:[articulated],articulatedStatus:{partName:'door',status:'moving',requestedAction:'open',verifiedAction:'close'}});
    const result=await buildRecoveryProposals(runtime,registry,{actorId:'agent_01',targetId:'cabinet_01'});
    expect(result.proposals[0]).toMatchObject({eligible:false,reason:'ARTICULATED_ACTION_PENDING'});
  });

  it('selects the alternate articulated action with explicit counterfactual target-sweep clearance evidence',async()=>{
    const articulated={kind:'object',objectId:'articulated_01',partName:'door',colliderIndex:0};
    const actionGeometry={
      'cabinet_01:open:sweep':{min:[0,0,0],max:[2,2,2]},
      'articulated_01:ajar:target':{min:[.5,.2,.5],max:[1.5,1.8,1.5]},
      'articulated_01:open:target':{min:[.4,.2,.4],max:[1.4,1.8,1.4]},
      'articulated_01:open:sweep':{min:[.2,.1,.2],max:[1.6,1.9,1.6]},
      'articulated_01:close:target':{min:[3,.2,.4],max:[4,1.8,1.4]},
      'articulated_01:close:sweep':{min:[.8,.1,.2],max:[4,1.9,1.6]}
    };
    const {runtime,registry}=setup({
      candidates:[articulated],current:[articulated],articulatedActions:['open','close','ajar'],actionGeometry,
      articulatedStatus:{partName:'door',status:'verified-state',requestedAction:null,verifiedAction:'ajar'},
      planCosts:{'articulated_01:door:open':1,'articulated_01:door:close':3}
    });
    const result=await buildRecoveryProposals(runtime,registry,{actorId:'agent_01',targetId:'cabinet_01'});
    expect(result).toMatchObject({
      status:'recovery-proposed',
      recommended:{tool:'recoverArticulatedBlocker',args:{blockerAction:'close'}},
      proposals:[{
        eligible:true,recovery:'articulated-blocker',blockerAction:'close',
        actionRanking:{
          strategy:'articulated-target-sweep-counterfactual-v1',basis:'three-aabb-fallback',causal:false,fallbackReason:'PHYSICS_COUNTERFACTUAL_PARTIAL_COVERAGE',
          current:{action:'ajar'},
          actions:[
            expect.objectContaining({action:'open',executable:true,visualCounterfactual:expect.objectContaining({targetSweepClear:false})}),
            expect.objectContaining({action:'close',executable:true,rank:1,visualCounterfactual:expect.objectContaining({targetSweepClear:true})})
          ]
        }
      }]
    });
    const chosen=result.proposals[0];
    const open=chosen.actionRanking.actions.find((item)=>item.action==='open');
    const close=chosen.actionRanking.actions.find((item)=>item.action==='close');
    expect(open.visualCounterfactual.targetSweepClear).toBe(false);
    expect(open.visualCounterfactual.overlapReduction).toBe(0);
    expect(open.rank).toBeUndefined();
    expect(close.visualCounterfactual.targetOverlapVolume).toBe(0);
    expect(close.visualCounterfactual.overlapReduction).toBeGreaterThan(open.visualCounterfactual.overlapReduction);
  });

  it('rejects multi-action articulated recovery when current AABB evidence does not show the blocker occupying the original sweep',async()=>{
    const articulated={kind:'object',objectId:'articulated_01',partName:'door',colliderIndex:0};
    const {runtime,registry}=setup({
      candidates:[articulated],current:[articulated],articulatedActions:['open','close','ajar'],
      articulatedStatus:{partName:'door',status:'verified-state',requestedAction:null,verifiedAction:'ajar'},
      actionGeometry:{
        'cabinet_01:open:sweep':{min:[0,0,0],max:[1,1,1]},
        'articulated_01:ajar:target':{min:[3,0,3],max:[4,1,4]}
      }
    });
    const result=await buildRecoveryProposals(runtime,registry,{actorId:'agent_01',targetId:'cabinet_01'});
    expect(result.proposals[0]).toMatchObject({eligible:false,reason:'COUNTERFACTUAL_EVIDENCE_INSUFFICIENT'});
    expect(runtime.interactions.findInteractionPose).not.toHaveBeenCalled();
  });

  it('rejects a true counterfactual tie instead of breaking it by action name',async()=>{
    const articulated={kind:'object',objectId:'articulated_01',partName:'door',colliderIndex:0};
    const sameTarget={min:[2.5,.2,.5],max:[3.5,1.8,1.5]};
    const sameSweep={min:[.5,.1,.3],max:[3.5,1.9,1.7]};
    const {runtime,registry}=setup({
      candidates:[articulated],current:[articulated],articulatedActions:['open','close','ajar'],
      articulatedStatus:{partName:'door',status:'verified-state',requestedAction:null,verifiedAction:'ajar'},
      planCosts:{'articulated_01:door:open':2,'articulated_01:door:close':2},
      actionGeometry:{
        'cabinet_01:open:sweep':{min:[0,0,0],max:[2,2,2]},
        'articulated_01:ajar:target':{min:[.5,.2,.5],max:[1.5,1.8,1.5]},
        'articulated_01:open:target':sameTarget,'articulated_01:close:target':sameTarget,
        'articulated_01:open:sweep':sameSweep,'articulated_01:close:sweep':sameSweep
      }
    });
    const result=await buildRecoveryProposals(runtime,registry,{actorId:'agent_01',targetId:'cabinet_01'});
    expect(result.proposals[0]).toMatchObject({
      eligible:false,reason:'COUNTERFACTUAL_ACTION_TIE',
      actionRanking:{strategy:'articulated-target-sweep-counterfactual-v1',causal:false,tiedActions:['close','open']}
    });
    expect(result.proposals[0].actionRanking.actions.every((item)=>item.rank==null)).toBe(true);
  });


  it('refuses Physics ranking when alternate actions disagree about the same current conflict baseline',async()=>{
    const articulated={kind:'object',objectId:'articulated_01',partName:'door',colliderIndex:0};
    let calls=0;
    const physicsCounterfactual=()=>{
      calls++;
      return {
        checked:true,geometry:'rapier-shape-pairs',causal:false,samples:17,
        current:{conflictSamples:calls===1?10:11,pairIntersections:calls===1?10:11},
        target:{conflictSamples:calls===1?8:0,pairIntersections:calls===1?8:0},
        action:{conflictSamplePairs:20,pairIntersections:20},
        targetSweepClear:calls===2,conflictReduction:calls===1?2:11
      };
    };
    const actionGeometry={
      'cabinet_01:open:sweep':{min:[0,0,0],max:[2,2,2]},
      'articulated_01:ajar:target':{min:[.5,.2,.5],max:[1.5,1.8,1.5]},
      'articulated_01:open:target':{min:[.4,.2,.4],max:[1.4,1.8,1.4]},
      'articulated_01:open:sweep':{min:[.2,.1,.2],max:[1.6,1.9,1.6]},
      'articulated_01:close:target':{min:[3,.2,.4],max:[4,1.8,1.4]},
      'articulated_01:close:sweep':{min:[.8,.1,.2],max:[4,1.9,1.6]}
    };
    const {runtime,registry}=setup({
      candidates:[articulated],current:[articulated],articulatedActions:['open','close','ajar'],actionGeometry,physicsCounterfactual,
      articulatedStatus:{partName:'door',status:'verified-state',requestedAction:null,verifiedAction:'ajar'}
    });
    const result=await buildRecoveryProposals(runtime,registry,{actorId:'agent_01',targetId:'cabinet_01'});
    expect(result).toMatchObject({
      status:'recovery-proposed',
      recommended:{args:{blockerAction:'close'}},
      proposals:[{
        actionRanking:{strategy:'articulated-target-sweep-counterfactual-v1',basis:'three-aabb-fallback',fallbackReason:'PHYSICS_COUNTERFACTUAL_BASELINE_INCONSISTENT',causal:false}
      }]
    });
  });

  it('prefers Rapier shape-pair evidence when it conflicts with Three AABB action ranking',async()=>{
    const articulated={kind:'object',objectId:'articulated_01',partName:'door',colliderIndex:0};
    const actionGeometry={
      'cabinet_01:open:sweep':{min:[0,0,0],max:[2,2,2]},
      'articulated_01:ajar:target':{min:[.5,.2,.5],max:[1.5,1.8,1.5]},
      // Visual evidence deliberately favors open.
      'articulated_01:open:target':{min:[3,.2,.4],max:[4,1.8,1.4]},
      'articulated_01:open:sweep':{min:[.8,.1,.2],max:[4,1.9,1.6]},
      'articulated_01:close:target':{min:[.5,.2,.5],max:[1.5,1.8,1.5]},
      'articulated_01:close:sweep':{min:[.2,.1,.2],max:[1.6,1.9,1.6]}
    };
    const physicsCounterfactual=(_originalId,_originalPart,_originalTarget,_blockerId,_blockerPart,blockerTarget)=>{
      const close=blockerTarget===0;
      return {
        checked:true,geometry:'rapier-shape-pairs',causal:false,samples:17,
        current:{conflictSamples:10,pairIntersections:10},
        target:close?{conflictSamples:0,pairIntersections:0}:{conflictSamples:9,pairIntersections:9},
        action:close?{conflictSamplePairs:12,pairIntersections:12}:{conflictSamplePairs:40,pairIntersections:40},
        targetSweepClear:close,
        conflictReduction:close?10:1
      };
    };
    const {runtime,registry}=setup({
      candidates:[articulated],current:[articulated],articulatedActions:['open','close','ajar'],actionGeometry,physicsCounterfactual,
      articulatedStatus:{partName:'door',status:'verified-state',requestedAction:null,verifiedAction:'ajar'},
      planCosts:{'articulated_01:door:open':1,'articulated_01:door:close':4}
    });
    const result=await buildRecoveryProposals(runtime,registry,{actorId:'agent_01',targetId:'cabinet_01'});
    expect(result).toMatchObject({
      status:'recovery-proposed',
      recommended:{tool:'recoverArticulatedBlocker',args:{blockerAction:'close'}},
      proposals:[{
        blockerAction:'close',
        actionRanking:{strategy:'articulated-rapier-shape-counterfactual-v2',basis:'rapier-shape-pairs',causal:false,current:{action:'ajar',conflictSamples:10,pairIntersections:10}}
      }]
    });
    const ranking=result.proposals[0].actionRanking;
    const open=ranking.actions.find((item)=>item.action==='open');
    const close=ranking.actions.find((item)=>item.action==='close');
    expect(open.visualCounterfactual.targetSweepClear).toBe(true);
    expect(close.visualCounterfactual.targetSweepClear).toBe(false);
    expect(open.physicsCounterfactual.targetSweepClear).toBe(false);
    expect(close.physicsCounterfactual.targetSweepClear).toBe(true);
    expect(close.rank).toBe(1);
    expect(open.rank).toBe(2);
    expect(runtime.physics.articulationPairCounterfactual).toHaveBeenCalledTimes(2);
  });

  it('ranks articulated and pickup recoveries by route cost without making a causal claim',async()=>{
    const articulated={kind:'object',objectId:'articulated_01',partName:'door',colliderIndex:0};
    const {runtime,registry}=setup({
      candidates:[blockerCandidate,articulated],current:[blockerCandidate,articulated],
      planCosts:{blocker_01:4,'articulated_01:door:open':1.5}
    });
    const result=await buildRecoveryProposals(runtime,registry,{actorId:'agent_01',targetId:'cabinet_01'});
    expect(result.ranking).toMatchObject({strategy:'eligible-recovery-route-cost-v2',causal:false});
    expect(result.recommended).toMatchObject({blocker:{objectId:'articulated_01'},tool:'recoverArticulatedBlocker'});
    expect(result.proposals.filter((item)=>item.eligible).map((item)=>[item.recovery,item.rank])).toEqual([
      ['articulated-blocker',1],['pickup-blocker',2]
    ]);
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


  it('denies an otherwise executable articulated recovery at proposal time when Policy forbids it',async()=>{
    const articulated={kind:'object',objectId:'articulated_01',partName:'door',colliderIndex:0};
    const {runtime,registry}=setup({candidates:[articulated],current:[articulated],articulatedAllow:false});
    const result=await buildRecoveryProposals(runtime,registry,{actorId:'agent_01',targetId:'cabinet_01'});
    expect(result).toMatchObject({
      status:'recovery-unavailable',recommended:null,
      proposals:[{
        candidateType:'articulated-part',eligible:false,status:'denied',reason:'POLICY_DENIED',blockerAction:'open',
        policy:{allow:false,profile:'builder',missing:['world.write']}
      }]
    });
    expect(runtime.interactions.findInteractionPose).not.toHaveBeenCalled();
  });

});

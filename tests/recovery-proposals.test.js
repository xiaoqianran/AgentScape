import { describe, expect, it, vi } from 'vitest';
import { buildRecoveryProposals } from '../src/agent/buildRecoveryProposals.js';

const blockerCandidate={kind:'object',objectId:'blocker_01',partName:'$root',colliderIndex:0};
const environmentCandidate={kind:'environment',environmentId:'monument-hall',colliderIndex:4};

function setup({candidates=[blockerCandidate],current=[blockerCandidate],allow=true,carryError=null}={}){
  const records=new Map([
    ['agent_01',{id:'agent_01',assetId:'agent',manifest:{actions:['navigate']},state:{}}],
    ['cabinet_01',{id:'cabinet_01',assetId:'cabinet',manifest:{actions:['open','close']},state:{}}],
    ['blocker_01',{id:'blocker_01',assetId:'blocker',manifest:{actions:['pickup','drop'],physics:{body:'dynamic'}},state:{}}]
  ]);
  const runtime={
    store:{has:(id)=>records.has(id),get:(id)=>records.get(id)},
    physics:{articulationContacts:vi.fn(()=>current.map((target)=>({external:true,target})))},
    interactions:{
      articulationStatus:vi.fn(()=>({id:'cabinet_01',parts:[{
        partName:'door',status:'action-failed',last:{status:'action-failed',reason:'STALL',action:'open',attribution:{status:'contact-evidence',blockerCandidates:candidates}}
      }]})),
      assertAgentCarryable:vi.fn(()=>{if(carryError) throw Object.assign(new Error(carryError),{code:'CARRY_UNAVAILABLE',details:{reason:carryError}});}),
      findPickupPlan:vi.fn(async()=>({pose:{status:'approach-pose',position:[1,0,1]},transfer:{clear:true}}))
    }
  };
  const registry={authorization:vi.fn(()=>({allow,profile:'builder',missing:allow?[]:['world.write'],required:['world.write','spatial.read','physics.read']}))};
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
});
